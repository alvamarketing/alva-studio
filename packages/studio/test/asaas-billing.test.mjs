import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingRuntimeConfig, createAsaasClient, validateCheckoutUrl } from '../server/asaas-billing.mjs';

const order = {
  id: '00000000-0000-4000-8000-000000000001',
  externalReference: 'alva-studio:sandbox:00000000-0000-4000-8000-000000000001',
  amountCents: 9900,
  planName: 'Alva Studio Essencial',
};

function response(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, text: async () => JSON.stringify(payload) };
}

test('checkout recorrente usa preço inteiro, referência do pedido e não coleta dados pessoais no Studio', async () => {
  const calls = [];
  const client = createAsaasClient({
    environment: 'sandbox', apiKey: 'key-secret-for-test', siteOrigin: 'https://studio.alva.test',
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response({ id: 'checkout-1', link: 'https://sandbox.asaas.com/checkoutSession/show/checkout-1' }); },
  });
  const checkout = await client.createSubscriptionCheckout({ order, nextDueDate: '2026-09-06' });
  const body = JSON.parse(calls[0].options.body);
  assert.equal(calls[0].url, 'https://api-sandbox.asaas.com/v3/checkouts');
  assert.equal(calls[0].options.headers.access_token, 'key-secret-for-test');
  assert.equal(body.externalReference, order.externalReference);
  assert.equal(body.subscription.cycle, 'MONTHLY');
  assert.equal(body.subscription.value, '99.00');
  assert.equal(body.items[0].value, '99.00');
  assert.equal(Object.hasOwn(body, 'customer'), false);
  assert.equal(Object.hasOwn(body, 'customerData'), false);
  assert.equal(checkout.id, 'checkout-1');
});

test('checkout de ciclo posterior usa somente customer reconciliado e nunca customerData', async () => {
  let body;
  const client = createAsaasClient({
    environment: 'sandbox', apiKey: 'key-secret-for-test', siteOrigin: 'https://studio.alva.test',
    fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return response({ id: 'checkout-2', link: 'https://sandbox.asaas.com/checkoutSession/show/checkout-2' }); },
  });
  await client.createSubscriptionCheckout({ order, customerId: 'cus_reconciled_123', nextDueDate: '2026-10-06' });
  assert.equal(body.customer, 'cus_reconciled_123');
  assert.equal(Object.hasOwn(body, 'customerData'), false);
});

test('cliente reconsulta pagamentos e encerra assinatura apenas por endDate', async () => {
  const calls = [];
  const client = createAsaasClient({
    environment: 'sandbox', apiKey: 'key-secret-for-test', siteOrigin: 'https://studio.alva.test',
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response({ data: [] }); },
  });
  await client.getPayment('pay_123');
  await client.findByExternalReference(order.externalReference);
  await client.listSubscriptionPayments('sub_123');
  await client.updateSubscriptionEndDate('sub_123', '2026-10-01');
  assert.equal(calls[0].url, 'https://api-sandbox.asaas.com/v3/payments/pay_123');
  assert.match(calls[1].url, /\/v3\/payments\?externalReference=alva-studio%3Asandbox%3A/);
  assert.equal(calls[2].url, 'https://api-sandbox.asaas.com/v3/subscriptions/sub_123/payments');
  assert.equal(calls[3].options.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[3].options.body), { endDate: '2026-10-01' });
  assert.equal(calls.some((call) => call.options.method === 'DELETE'), false);
});

test('valida hosts de checkout e configuração privada sem vazar segredo ou documento', () => {
  assert.equal(validateCheckoutUrl('https://sandbox.asaas.com/checkoutSession/show/id', 'sandbox'), 'https://sandbox.asaas.com/checkoutSession/show/id');
  assert.throws(() => validateCheckoutUrl('https://sandbox.asaas.com/checkoutSession/show/id', 'production'), /checkout/i);
  assert.throws(() => validateCheckoutUrl('http://sandbox.asaas.com/checkoutSession/show/id', 'sandbox'), /checkout/i);
  assert.throws(() => validateCheckoutUrl('https://attacker.test/checkout', 'sandbox'), /checkout/i);
  const sandbox = billingRuntimeConfig({
    ASAAS_SANDBOX_API_KEY: 'sandbox-key', ASAAS_SANDBOX_WEBHOOK_TOKEN: 'sandbox-token', ASAAS_SANDBOX_SITE_ORIGIN: 'https://studio.alva.test',
  }, 'sandbox');
  assert.equal(sandbox.environment, 'sandbox');
  assert.equal(sandbox.webhookToken, 'sandbox-token');
  assert.throws(
    () => billingRuntimeConfig({ ASAAS_SANDBOX_API_KEY: 'key-secret-for-test', ASAAS_SANDBOX_WEBHOOK_TOKEN: 'token-secret', ASAAS_SANDBOX_SITE_ORIGIN: 'https://studio.alva.test' }, 'production'),
    (error) => !/key-secret-for-test|token-secret|111\.111\.111-11/.test(error.message),
  );
  const config = billingRuntimeConfig({
    ASAAS_SANDBOX_API_KEY: 'sandbox-key', ASAAS_SANDBOX_WEBHOOK_TOKEN: 'sandbox-token', ASAAS_SANDBOX_SITE_ORIGIN: 'https://studio.alva.test',
    ASAAS_PRODUCTION_API_KEY: 'production-key', ASAAS_PRODUCTION_WEBHOOK_TOKEN: 'production-token', ASAAS_PRODUCTION_SITE_ORIGIN: 'https://studio.alva.test',
  }, 'production');
  assert.equal(config.baseUrl, 'https://api.asaas.com/v3');
  assert.equal(config.webhookToken, 'production-token');
});
