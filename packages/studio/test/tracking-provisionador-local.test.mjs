import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarProvisionadorLocal } from '../server/tracking-provisionador-local.mjs';

// Provisionar deixou de ser criar uma propriedade num serviço externo: o Studio entrega
// direto aos destinos, então basta haver credencial configurada. O identificador da
// propriedade continua existindo porque o payload o carrega, mas é derivado do próprio
// binding — mesma entrada, mesmo identificador, sem rede.

test('deriva o identificador do binding, sem chamar serviço nenhum', async () => {
  const provisionador = criarProvisionadorLocal({
    tracking: { conversionDestinations: async () => ({ meta: { pixel_id: '1', access_token: 't' } }) },
  });
  const resultado = await provisionador.provision({
    companyId: 'c1', projectId: 'p1', environment: 'production',
    bindingId: '3f0a562e-c2e3-4885-a33a-791a88880efa',
  });
  assert.equal(resultado.remoteId, 'alva_3f0a562ec2e34885a33a791a88880efa');
});

test('o mesmo binding dá sempre o mesmo identificador', async () => {
  const provisionador = criarProvisionadorLocal({
    tracking: { conversionDestinations: async () => ({ meta: {} }) },
  });
  const entrada = { companyId: 'c1', projectId: 'p1', environment: 'production', bindingId: 'aaaa-bbbb' };
  const primeiro = await provisionador.provision(entrada);
  const segundo = await provisionador.provision(entrada);
  assert.equal(primeiro.remoteId, segundo.remoteId);
});

test('sem nenhum destino configurado, recusa em vez de marcar pronto', async () => {
  const provisionador = criarProvisionadorLocal({ tracking: { conversionDestinations: async () => ({}) } });
  await assert.rejects(
    () => provisionador.provision({ companyId: 'c1', projectId: 'p1', environment: 'production', bindingId: 'b1' }),
    /nenhum destino/i,
  );
});

test('destino desconhecido não passa: só os cinco que sabemos entregar', async () => {
  const provisionador = criarProvisionadorLocal({
    tracking: { conversionDestinations: async () => ({ pinterest: { token: 'x' } }) },
  });
  await assert.rejects(
    () => provisionador.provision({ companyId: 'c1', projectId: 'p1', environment: 'production', bindingId: 'b1' }),
    /pinterest/,
  );
});
