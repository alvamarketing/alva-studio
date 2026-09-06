import assert from 'node:assert/strict';
import test from 'node:test';

import { BillingService } from '../server/billing-service.mjs';

function order(overrides = {}) {
  return { id: '8b80ba38-b3c4-4a7f-a9e6-3e22dbfc5269', companyId: 'company-1', environment: 'sandbox', name: 'Alva Studio Profissional', amountCents: 4900, currency: 'BRL', status: 'creating', checkoutUrl: null, ...overrides };
}

test('checkout persiste referência antes do egress e devolve URL validada', async () => {
  const calls = [];
  const repository = {
    createOrGetOrder: async () => order(),
    claimCheckout: async () => ({ claimed: true, order: order({ status: 'submitting' }) }),
    saveCheckout: async (input) => { calls.push(input); return order({ status: 'pending', checkoutId: input.checkoutId, checkoutUrl: input.checkoutUrl }); },
  };
  const client = { createCheckout: async (body) => { calls.push(body); return { id: 'checkout_123' }; } };
  const service = new BillingService({ repository, clientFactory: () => client, site: 'https://studio.alva.test', environment: 'sandbox', today: () => '2026-09-06' });

  const result = await service.checkout({ companyId: 'company-1', idempotencyKey: 'checkout-001' });

  assert.equal(result.status, 'pending');
  assert.equal(result.checkoutUrl, 'https://sandbox.asaas.com/checkoutSession/show?id=checkout_123');
  assert.equal(calls[0].externalReference, '8b80ba38-b3c4-4a7f-a9e6-3e22dbfc5269');
  assert.equal(calls[1].checkoutId, 'checkout_123');
});

test('falha do Asaas preserva pedido submetido para conciliação posterior', async () => {
  let saved = false;
  const repository = {
    createOrGetOrder: async () => order(),
    claimCheckout: async () => ({ claimed: true, order: order({ status: 'submitting' }) }),
    saveCheckout: async () => { saved = true; },
  };
  const service = new BillingService({ repository, clientFactory: () => ({ createCheckout: async () => { throw new Error('timeout'); } }), site: 'https://studio.alva.test', environment: 'sandbox' });

  await assert.rejects(() => service.checkout({ companyId: 'company-1', idempotencyKey: 'checkout-timeout' }), /indisponível|timeout/i);
  assert.equal(saved, false);
});
