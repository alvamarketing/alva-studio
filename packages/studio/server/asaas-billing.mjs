const ASAAS_ENVIRONMENTS = {
  sandbox: {
    baseUrl: 'https://api-sandbox.asaas.com/v3',
    checkoutHost: 'sandbox.asaas.com',
  },
  production: {
    baseUrl: 'https://api.asaas.com/v3',
    checkoutHost: 'www.asaas.com',
  },
};

const MAX_RESPONSE_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function configurationError() {
  return new Error('Configuração de cobrança incompleta.');
}

function checkoutError() {
  return new Error('URL de checkout inválida.');
}

function communicationError() {
  return new Error('Falha na comunicação com cobrança.');
}

function environmentConfig(environment) {
  const config = ASAAS_ENVIRONMENTS[environment];
  if (!config) throw configurationError();
  return config;
}

function requiredValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validSiteOrigin(value) {
  if (!requiredValue(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

function normalizeOrigin(value) {
  return new URL(value).origin;
}

function decimalFromCents(cents) {
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('Pedido de cobrança inválido.');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

function validDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function safeId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[/?#\s]/.test(value);
}

function checkoutPayload({ environment, order, customerId, nextDueDate, siteOrigin }) {
  if (!order || !UUID.test(order.id) || !Number.isSafeInteger(order.amountCents) || !requiredValue(order.planName)) {
    throw new Error('Pedido de cobrança inválido.');
  }
  if (!validDate(nextDueDate)) throw new Error('Data de vencimento inválida.');

  const expectedReference = `alva-studio:${environment}:${order.id}`;
  if (order.externalReference !== expectedReference) throw new Error('Referência de cobrança inválida.');
  if (customerId !== undefined && !safeId(customerId)) throw new Error('Cliente de cobrança inválido.');

  const value = decimalFromCents(order.amountCents);
  const payload = {
    billingTypes: ['PIX', 'CREDIT_CARD'],
    chargeTypes: ['RECURRENT'],
    minutesToExpire: 60,
    externalReference: order.externalReference,
    callback: {
      successUrl: `${siteOrigin}/billing/checkout/success`,
      cancelUrl: `${siteOrigin}/billing/checkout/cancel`,
      expiredUrl: `${siteOrigin}/billing/checkout/expired`,
    },
    items: [{
      externalReference: order.id,
      name: order.planName.trim(),
      quantity: 1,
      value,
    }],
    subscription: {
      cycle: 'MONTHLY',
      value,
      nextDueDate,
    },
  };
  if (customerId) payload.customer = customerId;
  return payload;
}

function responseJson(response, text) {
  if (!response?.ok || text.length > MAX_RESPONSE_BYTES) throw communicationError();
  try {
    return text.length === 0 ? {} : JSON.parse(text);
  } catch {
    throw communicationError();
  }
}

export function validateCheckoutUrl(value, environment) {
  const { checkoutHost } = environmentConfig(environment);
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== checkoutHost || url.port || url.username || url.password || !url.pathname.startsWith('/checkoutSession/')) {
      throw checkoutError();
    }
    return url.toString();
  } catch (error) {
    if (error.message === 'URL de checkout inválida.') throw error;
    throw checkoutError();
  }
}

export function billingRuntimeConfig(env, selectedEnvironment) {
  const environments = selectedEnvironment ? [selectedEnvironment] : Object.keys(ASAAS_ENVIRONMENTS);
  const result = {};
  for (const environment of environments) {
    const prefix = `ASAAS_${environment.toUpperCase()}`;
    const apiKey = env?.[`${prefix}_API_KEY`];
    const webhookToken = env?.[`${prefix}_WEBHOOK_TOKEN`];
    const siteOrigin = env?.[`${prefix}_SITE_ORIGIN`];
    if (!requiredValue(apiKey) || !requiredValue(webhookToken) || !validSiteOrigin(siteOrigin)) throw configurationError();
    result[environment] = {
      environment,
      baseUrl: ASAAS_ENVIRONMENTS[environment].baseUrl,
      apiKey: apiKey.trim(),
      webhookToken: webhookToken.trim(),
      siteOrigin: normalizeOrigin(siteOrigin),
    };
  }
  return selectedEnvironment ? result[selectedEnvironment] : result;
}

export function createAsaasClient({ environment, apiKey, siteOrigin, fetchImpl = globalThis.fetch }) {
  const { baseUrl } = environmentConfig(environment);
  if (!requiredValue(apiKey) || !validSiteOrigin(siteOrigin) || typeof fetchImpl !== 'function') throw configurationError();
  const origin = normalizeOrigin(siteOrigin);

  async function request(path, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          access_token: apiKey.trim(),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(5_000),
      });
      const text = await response.text();
      return responseJson(response, text);
    } catch (error) {
      if (error?.message === 'Falha na comunicação com cobrança.') throw error;
      throw communicationError();
    }
  }

  return {
    async createSubscriptionCheckout({ order, customerId, nextDueDate }) {
      const payload = checkoutPayload({ environment, order, customerId, nextDueDate, siteOrigin: origin });
      const result = await request('/checkouts', { method: 'POST', body: payload });
      if (!safeId(result.id)) throw communicationError();
      return { id: result.id, url: validateCheckoutUrl(result.link, environment) };
    },
    getPayment(paymentId) {
      if (!safeId(paymentId)) throw new Error('Pagamento de cobrança inválido.');
      return request(`/payments/${encodeURIComponent(paymentId)}`);
    },
    findByExternalReference(externalReference) {
      if (!requiredValue(externalReference) || externalReference.length > 200) throw new Error('Referência de cobrança inválida.');
      return request(`/payments?externalReference=${encodeURIComponent(externalReference)}`);
    },
    listSubscriptionPayments(subscriptionId) {
      if (!safeId(subscriptionId)) throw new Error('Assinatura de cobrança inválida.');
      return request(`/subscriptions/${encodeURIComponent(subscriptionId)}/payments`);
    },
    updateSubscriptionEndDate(subscriptionId, endDate) {
      if (!safeId(subscriptionId)) throw new Error('Assinatura de cobrança inválida.');
      if (!validDate(endDate)) throw new Error('Data de encerramento inválida.');
      return request(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'PUT', body: { endDate } });
    },
  };
}
