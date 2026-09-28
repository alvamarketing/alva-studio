// O registro de DNS exato do domínio do projeto, perguntado à Vercel
// (GET /v6/domains/{domain}/config: recommendedIPv4, recommendedCNAME, misconfigured —
// vercel.com/docs/rest-api, "Get a Domain's configuration"). A pessoa não precisa abrir a
// Vercel para saber o que criar no provedor do domínio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Publisher } from '../server/publisher.mjs';
import { dominioRaiz, registroRecomendado } from '../server/dns-do-dominio.mjs';

const respostaDaVercel = { configuredBy: null, misconfigured: true, acceptedChallenges: ['http-01'], recommendedIPv4: [{ rank: 2, value: ['76.76.21.9'] }, { rank: 1, value: ['76.76.21.21'] }], recommendedCNAME: [{ rank: 1, value: 'd1d4fc829fe7bc7c.vercel-dns-017.com.' }, { rank: 2, value: 'cname.vercel-dns.com.' }] };

test('a consulta vai ao endpoint de configuração do domínio, com o projeto e o time', async () => {
  const chamadas = [];
  const publisher = new Publisher({ token: 't', teamId: 'team_1', fetcher: async (url, opcoes) => { chamadas.push([url, opcoes.method]); return { ok: true, json: async () => respostaDaVercel, headers: new Headers() }; } });
  const config = await publisher.domainConfig({ projectId: 'prj_1', domain: 'lp.cliente.com.br' });
  assert.equal(chamadas[0][1], 'GET');
  const url = new URL(chamadas[0][0]);
  assert.equal(url.pathname, '/v6/domains/lp.cliente.com.br/config');
  assert.equal(url.searchParams.get('projectIdOrName'), 'prj_1');
  assert.equal(url.searchParams.get('teamId'), 'team_1');
  assert.equal(config.misconfigured, true);
});

test('domínio raiz reconhece sufixos de dois níveis, como .com.br', () => {
  assert.equal(dominioRaiz('cnajunteai.com.br'), true);
  assert.equal(dominioRaiz('lp.cnajunteai.com.br'), false);
  assert.equal(dominioRaiz('exemplo.com'), true);
  assert.equal(dominioRaiz('www.exemplo.com'), false);
  assert.equal(dominioRaiz('exemplo.co.uk'), true);
});

test('raiz pede A com o IP de rank 1; subdomínio pede CNAME com o valor de rank 1, sem o ponto final', () => {
  assert.deepEqual(registroRecomendado('cnajunteai.com.br', respostaDaVercel), { dominio: 'cnajunteai.com.br', tipo: 'A', nome: '@', valor: '76.76.21.21', pronto: false, vistoComo: null });
  assert.deepEqual(registroRecomendado('lp.cnajunteai.com.br', { ...respostaDaVercel, misconfigured: false, configuredBy: 'CNAME' }), { dominio: 'lp.cnajunteai.com.br', tipo: 'CNAME', nome: 'lp', valor: 'd1d4fc829fe7bc7c.vercel-dns-017.com', pronto: true, vistoComo: 'CNAME' });
});

test('o serviço pergunta pelo domínio atual do projeto, no projeto dele na Vercel', async () => {
  const { PublicationService } = await import('../server/publication-service.mjs');
  const pedidos = [];
  const servico = new PublicationService({
    integrations: { credentials: async () => ({ token: 't', teamId: '', vercelProjectId: 'prj_cna' }) },
    domains: { atual: async ({ projectId }) => (projectId === 'p1' ? { domain: 'lp.cnajunteai.com.br', verificationStatus: 'pending' } : null) },
    publisherFactory: () => ({ domainConfig: async (entrada) => { pedidos.push(entrada); return respostaDaVercel; } }),
  });
  const dns = await servico.dns({ companyId: 'c1', projectId: 'p1' });
  assert.deepEqual(pedidos, [{ projectId: 'prj_cna', domain: 'lp.cnajunteai.com.br' }]);
  assert.equal(dns.tipo, 'CNAME');
  assert.equal(dns.nome, 'lp');
  assert.deepEqual(await servico.dns({ companyId: 'c1', projectId: 'sem-dominio' }), { dominio: null });
});
