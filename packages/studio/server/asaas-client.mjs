const ENVIRONMENTS = new Set(['sandbox', 'production']);

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

function environment(value) {
  if (!ENVIRONMENTS.has(value)) throw fail('Ambiente Asaas inválido.');
  return value;
}

function amount(value) {
  if (!Number.isInteger(value) || value < 1) throw fail('Preço do plano inválido.');
  return value / 100;
}

function publicOrigin(value) {
  const origin = new URL(value);
  if (origin.protocol !== 'https:' || origin.origin !== value || origin.username || origin.password)
    throw fail('Origem de cobrança inválida.');
  return origin;
}

export function asaasCheckoutBody(order, site, dueDate) {
  const origin = publicOrigin(site);
  environment(order?.environment);
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(order?.id || ''))) throw fail('Pedido inválido.');
  if (typeof order.name !== 'string' || !order.name || order.name.length > 200) throw fail('Plano inválido.');
  if (order.currency !== 'BRL') throw fail('Moeda do plano inválida.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw fail('Vencimento inválido.');
  const returnUrl = (payment) => `${origin.origin}/billing?payment=${payment}&order=${encodeURIComponent(order.id)}`;
  return {
    billingTypes: ['CREDIT_CARD'],
    chargeTypes: ['RECURRENT'],
    minutesToExpire: 60,
    externalReference: order.id,
    callback: { successUrl: returnUrl('return'), cancelUrl: returnUrl('cancelled'), expiredUrl: returnUrl('expired') },
    items: [{ name: order.name, description: 'Assinatura mensal Alva Studio', quantity: 1, value: amount(order.amountCents) }],
    subscription: { cycle: 'MONTHLY', nextDueDate: dueDate },
  };
}

export function asaasCheckoutUrl(checkout, currentEnvironment) {
  environment(currentEnvironment);
  const id = String(checkout?.id || '');
  if (!/^[a-zA-Z0-9_-]{4,120}$/.test(id)) throw fail('Checkout Asaas inválido.', 502);
  const host = currentEnvironment === 'sandbox' ? 'sandbox.asaas.com' : 'asaas.com';
  return `https://${host}/checkoutSession/show?id=${encodeURIComponent(id)}`;
}

export function paymentConfirmed(status) {
  return status === 'CONFIRMED' || status === 'RECEIVED';
}

export function nextMonthlyPeriod(dueDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw fail('Vencimento inválido.');
  const date = new Date(`${dueDate}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dueDate) throw fail('Vencimento inválido.');
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

export class AsaasClient {
  constructor({ environment: currentEnvironment = 'sandbox', apiKey, fetchImpl = globalThis.fetch, timeoutMs = 20_000 } = {}) {
    this.environment = environment(currentEnvironment);
    if (typeof apiKey !== 'string' || !apiKey) throw fail('Asaas não configurado.', 503);
    if (typeof fetchImpl !== 'function') throw fail('Cliente HTTP Asaas inválido.', 500);
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  origin() { return this.environment === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3'; }

  async request(path, method = 'GET', payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(`${this.origin()}${path}`, {
        method,
        headers: { access_token: this.apiKey, 'Content-Type': 'application/json', 'User-Agent': 'alva-studio-billing' },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) throw fail(`Asaas indisponível (${response.status}).`, 502);
      return response.status === 204 ? {} : response.json();
    } catch (error) {
      if (error?.status) throw error;
      throw fail('Asaas indisponível.', 502);
    } finally { clearTimeout(timer); }
  }

  createCheckout(payload) { return this.request('/checkouts', 'POST', payload); }
  getPayment(id) { return this.request(`/payments/${encodeURIComponent(id)}`); }
  getSubscription(id) { return this.request(`/subscriptions/${encodeURIComponent(id)}`); }
  async cancelSubscription(id) {
    try { return await this.request(`/subscriptions/${encodeURIComponent(id)}`, 'DELETE'); }
    catch (error) { if (error?.status === 502 && /\(404\)/.test(error.message || '')) return { deleted: true }; throw error; }
  }
}
