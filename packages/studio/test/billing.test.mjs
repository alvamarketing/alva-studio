import assert from 'node:assert/strict';
import test from 'node:test';

import { asaasCheckoutBody, asaasCheckoutUrl, paymentConfirmed, nextMonthlyPeriod } from '../server/asaas-client.mjs';

test('checkout recorrente usa contrato congelado e callback local do Studio', () => {
  const body = asaasCheckoutBody({
    id: '8b80ba38-b3c4-4a7f-a9e6-3e22dbfc5269',
    name: 'Alva Studio Profissional',
    amountCents: 4900,
    currency: 'BRL',
    environment: 'sandbox',
  }, 'https://studio.alva.test', '2026-09-06');

  assert.deepEqual(body.billingTypes, ['CREDIT_CARD']);
  assert.deepEqual(body.chargeTypes, ['RECURRENT']);
  assert.equal(body.externalReference, '8b80ba38-b3c4-4a7f-a9e6-3e22dbfc5269');
  assert.equal(body.items[0].value, 49);
  assert.equal(body.subscription.cycle, 'MONTHLY');
  assert.match(body.callback.successUrl, /\/billing\?payment=return&order=8b80ba38/);
});

test('URL de checkout somente aceita o host oficial do ambiente', () => {
  assert.equal(asaasCheckoutUrl({ id: 'checkout_123' }, 'sandbox'), 'https://sandbox.asaas.com/checkoutSession/show?id=checkout_123');
  assert.equal(asaasCheckoutUrl({ id: 'checkout_123' }, 'production'), 'https://asaas.com/checkoutSession/show?id=checkout_123');
  assert.throws(() => asaasCheckoutUrl({ id: '../outro' }, 'sandbox'), /checkout/i);
});

test('somente pagamentos confirmados ou recebidos concedem acesso', () => {
  for (const status of ['PENDING', 'OVERDUE', 'AUTHORIZED', 'REFUNDED', 'CHARGEBACK_REQUESTED'])
    assert.equal(paymentConfirmed(status), false);
  assert.equal(paymentConfirmed('CONFIRMED'), true);
  assert.equal(paymentConfirmed('RECEIVED'), true);
});

test('período recorrente preserva o último dia possível do mês', () => {
  assert.equal(nextMonthlyPeriod('2026-01-31'), '2026-02-28T12:00:00.000Z');
  assert.equal(nextMonthlyPeriod('2028-01-31'), '2028-02-29T12:00:00.000Z');
  assert.throws(() => nextMonthlyPeriod('31/01/2026'), /Vencimento/);
});
