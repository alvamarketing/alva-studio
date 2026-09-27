// A entrada de lead de ponta a ponta, pelo caminho de produção.
//
// A auditoria de 27/09 achou dois defeitos graves com a mesma origem: cada peça era
// testada com entrada inventada, e nenhum teste atravessava o caminho que a produção
// usa. Este arquivo existe para isso. Ele não assina requisição à mão nem enfileira
// direto: roda o gateway de verdade (`forwardRuntimeGatewayRequest`, o mesmo que é
// publicado na Vercel) nos dois passos que a pessoa faz — carregar a página vinda do
// anúncio e enviar o formulário — e lê o que chegou ao banco e o que sairia para cada
// plataforma.
//
// O relatório completo de cada cenário vai para `ENTRADA_DE_LEADS_RELATORIO`, quando a
// variável existir. As asserções são só do que precisa valer hoje; o que é defeito
// conhecido é observado e relatado, não afirmado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { writeFile } from 'node:fs/promises';

import { createApp } from '../server/index.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
import { PublicationRuntimeRepository } from '../server/repositories/publication-runtime-repository.mjs';
import { SecretVault } from '../server/repositories/publication-repository.mjs';
import { TrackingRepository } from '../server/repositories/tracking-repository.mjs';
import { buildPublishableSnapshot } from '../server/publication-snapshot.mjs';
import { buildRuntimeManifest } from '../server/publication-runtime.mjs';
import { derivePublicationRuntimeKey, forwardRuntimeGatewayRequest, runtimeGatewayArtifacts } from '../server/vercel-runtime-gateway.mjs';
import { destinoPara } from '../server/tracking-destinos.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

const STUDIO = 'https://studio.example.test';
const DOMINIO = 'lp.example.test';
const RAIZ = 'raiz-hmac-da-simulacao-de-leads';
const CHAVE_MESTRA = 'b'.repeat(64);
// Na produção, o proxy na frente do Studio anota em `x-forwarded-for` o IP de quem o
// chamou. Para uma captura, quem chama é a função da Vercel — e é esse o endereço que
// o Studio enxerga. Um IP público fixo representa a função.
const IP_DA_FUNCAO_VERCEL = '76.76.21.21';
const UA_DO_FETCH_DA_FUNCAO = 'undici';

const CREDENCIAIS = {
  meta: { pixel_id: '123456', access_token: 'token-meta' },
  tiktok: { pixel_code: 'PXTIKTOK', access_token: 'token-tiktok' },
  google: { operating_account_id: '1234567890', conversion_action_id: '987', oauth_access_token: 'token-google' },
};

// Chamadas HTTP ao app local, sempre com o Host do Studio — como o proxy entregaria.
function chamar(porta, { method, path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: porta, method, path, headers: { host: 'studio.example.test', ...headers } }, (res) => {
      const partes = []; res.on('data', (parte) => partes.push(parte));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(partes).toString() }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// O `fetch` que o gateway usa. Ele não muda nada do que o gateway decide: só leva a
// chamada ao app local e faz o que o proxy de produção faz — anotar o IP de quem chamou
// e deixar passar o user-agent do cliente HTTP da função.
function fetchDoGateway(porta) {
  return async (url, opcoes = {}) => {
    const destino = new URL(url);
    const resposta = await chamar(porta, {
      method: opcoes.method || 'GET',
      path: destino.pathname + destino.search,
      headers: { ...opcoes.headers, 'x-forwarded-for': IP_DA_FUNCAO_VERCEL, 'user-agent': UA_DO_FETCH_DA_FUNCAO },
      body: opcoes.body,
    });
    const cabecalhos = new Headers();
    for (const [nome, valor] of Object.entries(resposta.headers)) {
      for (const item of Array.isArray(valor) ? valor : [valor]) cabecalhos.append(nome, String(item));
    }
    return new Response(resposta.text, { status: resposta.status, headers: cabecalhos });
  };
}

// Os cenários. Cada um é uma pessoa chegando por um caminho diferente.
const CENARIOS = [
  // Anúncios pagos, com o identificador que cada plataforma põe na URL.
  { nome: 'Facebook · anúncio', plataforma: 'meta', url: '/oferta?fbclid=IwAR0fb_clique_1&utm_source=facebook&utm_medium=cpc&utm_campaign=lancamento_set&utm_content=criativo_a', fbp: 'fb.1.1727400000000.1111111111' },
  { nome: 'Instagram · anúncio', plataforma: 'meta', url: '/oferta?fbclid=PAZXh0bgNhZW0_ig&utm_source=ig&utm_medium=paid_social&utm_campaign=stories_set', fbp: 'fb.1.1727400000000.2222222222' },
  { nome: 'Facebook · sem pixel na página', plataforma: 'meta', url: '/oferta?fbclid=IwAR0sem_pixel&utm_source=facebook&utm_medium=cpc' },
  { nome: 'Google Ads · pesquisa', plataforma: 'google', url: '/oferta?gclid=Cj0KCQjw_google_1&utm_source=google&utm_medium=cpc&utm_campaign=marca&utm_term=agencia+de+marketing' },
  { nome: 'Google Ads · iOS (gbraid)', plataforma: 'google', url: '/oferta?gbraid=0AAAAA_gbraid_1&utm_source=google&utm_medium=cpc' },
  { nome: 'Google Ads · iOS web (wbraid)', plataforma: 'google', url: '/oferta?wbraid=CjkK_wbraid_1&utm_source=google&utm_medium=cpc' },
  { nome: 'TikTok · anúncio', plataforma: 'tiktok', url: '/oferta?ttclid=E.C.P.tiktok_clique_1&utm_source=tiktok&utm_medium=paid&utm_campaign=ugc_set' },
  // Sem anúncio.
  { nome: 'Direto (digitou o endereço)', plataforma: null, url: '/oferta' },
  { nome: 'Orgânico · busca Google', plataforma: null, url: '/oferta', referrer: 'https://www.google.com/' },
  { nome: 'Orgânico · post no Instagram', plataforma: null, url: '/oferta', referrer: 'https://l.instagram.com/' },
  { nome: 'Orgânico · link com UTM de e-mail', plataforma: null, url: '/oferta?utm_source=newsletter&utm_medium=email&utm_campaign=edicao_42' },
  // Variações de UTM — o que chega de verdade de gerenciador de anúncio, de planilha
  // colada à mão e de quem tenta quebrar o formulário.
  { nome: 'UTM · só a origem', plataforma: null, url: '/oferta?utm_source=facebook' },
  { nome: 'UTM · nome do parâmetro em maiúsculas', plataforma: null, url: '/oferta?UTM_SOURCE=Facebook&UTM_CAMPAIGN=Teste' },
  { nome: 'UTM · valor com espaço (%20 e +)', plataforma: null, url: '/oferta?utm_campaign=black%20friday&utm_content=banner+topo' },
  { nome: 'UTM · acentos', plataforma: null, url: '/oferta?utm_campaign=promo%C3%A7%C3%A3o_ver%C3%A3o' },
  { nome: 'UTM · emoji', plataforma: null, url: '/oferta?utm_campaign=%F0%9F%94%A5oferta' },
  { nome: 'UTM · valor vazio', plataforma: null, url: '/oferta?utm_source=&utm_campaign=vazio' },
  { nome: 'UTM · parâmetro repetido', plataforma: null, url: '/oferta?utm_source=primeiro&utm_source=segundo' },
  { nome: 'UTM · valor enorme (600 caracteres)', plataforma: null, url: `/oferta?utm_campaign=${'x'.repeat(600)}` },
  { nome: 'UTM · tentativa de script', plataforma: null, url: '/oferta?utm_campaign=%3Cscript%3Ealert(1)%3C%2Fscript%3E' },
  { nome: 'UTM · tentativa de SQL', plataforma: null, url: "/oferta?utm_term=%27%20OR%201%3D1--" },
  { nome: 'UTM · no fragmento (#), não na query', plataforma: null, url: '/oferta#utm_source=fragmento&fbclid=nao_deve_ler' },
  { nome: 'UTM · parâmetros fora do padrão', plataforma: null, url: '/oferta?utm_id=123&utm_source_platform=meta&utm_creative_format=video' },
  { nome: 'Clique · fbclid com caracteres estranhos', plataforma: 'meta', url: '/oferta?fbclid=IwAR%2Fcom%3Dsinais%26e%20espaco' },
  { nome: 'Clique · dois identificadores juntos', plataforma: 'meta', url: '/oferta?fbclid=IwAR_duplo&gclid=Cj0_duplo&utm_source=facebook' },
];

// Cada visitante tem o próprio navegador e o próprio IP, como na vida real. A Vercel
// entrega o IP à função em `x-real-ip`; é esse que tem de chegar à plataforma — não o do
// cliente HTTP da função, que o proxy continua anotando em `x-forwarded-for`.
const UA_DA_PESSOA = (indice) => `Mozilla/5.0 (iPhone; CPU iPhone OS 17_${indice} like Mac OS X) Safari/604.1`;
const IP_DA_PESSOA = (indice) => `189.68.172.${indice + 10}`;

test('entrada de leads de ponta a ponta, pelo gateway de verdade', { timeout: 120_000 }, async (t) => {
  const anterior = process.env.TRACKING_MASTER_KEY;
  process.env.TRACKING_MASTER_KEY = CHAVE_MESTRA;
  t.after(() => { if (anterior === undefined) delete process.env.TRACKING_MASTER_KEY; else process.env.TRACKING_MASTER_KEY = anterior; });

  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);

  // A empresa, o projeto e o domínio verificado de produção.
  const dono = (await database.query("INSERT INTO users (email,password_hash,display_name) VALUES ('leads@alva.test','hash','Dono') RETURNING id")).rows[0];
  const empresa = (await database.query("INSERT INTO companies (name,slug) VALUES ('Agência','agencia') RETURNING id")).rows[0];
  const projeto = (await database.query("INSERT INTO projects (company_id,name,slug,created_by) VALUES ($1,'Lançamento','lancamento',$2) RETURNING id", [empresa.id, dono.id])).rows[0];
  await database.query("INSERT INTO company_memberships (company_id,user_id,role,joined_at) VALUES ($1,$2,'owner',now())", [empresa.id, dono.id]);
  await database.query("INSERT INTO project_domains (company_id,project_id,environment,domain,is_canonical,verification_status) VALUES ($1,$2,'production',$3,true,'verified')", [empresa.id, projeto.id, DOMINIO]);

  // A landing com formulário de captura, publicada como a produção publica.
  const captureId = '22222222-2222-4222-8222-222222222222';
  const estado = { components: [{ tagName: 'form', attributes: { 'data-alva-capture-id': captureId }, components: [
    { tagName: 'label', components: [{ type: 'textnode', content: 'E-mail' }, { tagName: 'input', attributes: { name: 'email', type: 'email', required: '' } }] },
  ] }] };
  const content = new ContentRepository(database, { publicOrigin: STUDIO });
  const pagina = await content.createPage({ companyId: empresa.id, projectId: projeto.id, actorId: dono.id, name: 'Landing de lançamento', route: '/oferta', editorState: estado, renderedHtml: `<main><form data-alva-capture-id="${captureId}" action="#" onsubmit="return false"><input name="email" type="email"></form></main>` });
  await content.publishPage({ companyId: empresa.id, projectId: projeto.id, actorId: dono.id, pageId: pagina.id, lockVersion: pagina.lockVersion });
  const snapshot = await buildPublishableSnapshot({ database, companyId: empresa.id, projectId: projeto.id, publicOrigin: STUDIO, environment: 'production' });
  const publicationId = 'simulacao-de-leads';
  const artefato = runtimeGatewayArtifacts(snapshot.files, { publicationId, snapshotHash: snapshot.hash, environment: 'production', runtimeOrigin: STUDIO, runtimeHmacSecret: RAIZ, runtimeBootstrap: false });
  const acao = artefato.files.find((arquivo) => arquivo.file === 'oferta/index.html').data.match(/action="([^"]+)"/)[1];
  const manifesto = buildRuntimeManifest({ publicationId, snapshotHash: snapshot.hash, origin: `https://${DOMINIO}`, domain: DOMINIO, environment: 'production', contents: snapshot.manifest.map(({ path, type, contentId, versionId, captureIds }) => ({ path, type, contentId, versionId, captureIds: captureIds || [] })) });
  await new PublicationRuntimeRepository(database).saveManifest({ companyId: empresa.id, projectId: projeto.id, manifest: manifesto });

  // Os três destinos configurados, e o rastreamento pronto — como depois de alguém usar
  // a tela de pixels e o provisionamento rodar.
  const cofre = new SecretVault({ masterKey: CHAVE_MESTRA });
  const tracking = new TrackingRepository(database, { vault: cofre });
  for (const [provedor, configuracao] of Object.entries(CREDENCIAIS)) {
    await tracking.saveDestination({ companyId: empresa.id, projectId: projeto.id, environment: 'production', provider: provedor, configuration: configuracao });
  }
  await database.query(
    `UPDATE tracking_bindings SET status='ready', encrypted_remote_reference=$4 WHERE company_id=$1 AND project_id=$2 AND environment=$3 AND engine='conversions'`,
    [empresa.id, projeto.id, 'production', cofre.encrypt('alva_simulacao', `tracking-binding:${empresa.id}:${projeto.id}:production:conversions`)],
  );

  const app = createApp({ database, publicOrigin: STUDIO, runtimeFlags: { pixels: false, conversions: true }, runtimeHmacSecret: RAIZ });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => app.close(resolve)); await database.close(); });
  const porta = app.address().port;
  const chave = derivePublicationRuntimeKey(RAIZ, { publicationId, snapshotHash: manifesto.snapshotHash, environment: 'production' });
  const gateway = (pedido) => forwardRuntimeGatewayRequest({
    host: DOMINIO, publicationId, environment: 'production', derivedKey: chave, gatewayOrigin: STUDIO, fetchImpl: fetchDoGateway(porta), ...pedido,
  });

  const relatorio = [];
  for (const [indice, cenario] of CENARIOS.entries()) {
    const ua = UA_DA_PESSOA(indice);
    const ip = IP_DA_PESSOA(indice);
    const enderecoDaPagina = `https://${DOMINIO}${cenario.url}`;
    const cookiesDoNavegador = cenario.fbp ? `_fbp=${cenario.fbp}` : '';

    // 1. A pessoa abre a página vinda do anúncio. O navegador pede o carregador do
    //    runtime, e o gateway lê a URL da página (o Referer) para gravar a atribuição.
    const carregador = await gateway({
      method: 'GET', path: '/_alva/runtime.js',
      headers: { referer: enderecoDaPagina, 'user-agent': ua, 'x-real-ip': ip, ...(cookiesDoNavegador ? { cookie: cookiesDoNavegador } : {}) },
    });
    const cookieDeAtribuicao = [carregador.headers['set-cookie']].flat().filter(Boolean)
      .map((linha) => linha.split(';')[0]).find((par) => par.startsWith('alva_runtime_attribution='));

    // 2. O envio do formulário, pelo mesmo gateway, levando os cookies da página.
    const cookies = [cookiesDoNavegador, cookieDeAtribuicao].filter(Boolean).join('; ');
    const email = `lead${indice}@exemplo.test`;
    const envio = await gateway({
      method: 'POST', path: acao,
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `https://${DOMINIO}`, 'user-agent': ua, 'x-real-ip': ip, ...(cookies ? { cookie: cookies } : {}) },
      body: Buffer.from(`email=${encodeURIComponent(email)}`),
    });

    const submissao = (await database.query('SELECT tracking_event_id FROM page_submissions WHERE answers->>\'email\' = $1', [email])).rows[0];
    const naFila = submissao
      ? (await database.query('SELECT destination, payload FROM conversions_outbox WHERE tracking_event_id = $1 ORDER BY destination', [submissao.tracking_event_id])).rows
      : [];

    // O que sairia de fato para cada plataforma: o corpo montado pelo adaptador real.
    const saida = {};
    for (const linha of naFila) {
      try {
        const pedido = destinoPara(linha.destination).requisicao(linha.payload, CREDENCIAIS[linha.destination]);
        const dados = pedido.corpo?.data?.[0] ?? pedido.corpo?.events?.[0] ?? pedido.corpo;
        saida[linha.destination] = {
          vai: true,
          fbc: dados?.user_data?.fbc, fbp: dados?.user_data?.fbp,
          ip: dados?.user_data?.client_ip_address, ua: dados?.user_data?.client_user_agent,
          ttclid: dados?.user?.ttclid,
          gclid: dados?.adIdentifiers?.gclid, gbraid: dados?.adIdentifiers?.gbraid, wbraid: dados?.adIdentifiers?.wbraid,
          url: dados?.event_source_url,
          utm: Object.fromEntries(Object.entries(dados?.custom_data ?? dados?.properties ?? {}).filter(([nome]) => nome.startsWith('utm_'))),
        };
      } catch (erro) {
        saida[linha.destination] = { vai: false, motivo: erro.message };
      }
    }

    relatorio.push({
      cenario: cenario.nome, plataforma: cenario.plataforma, url: cenario.url,
      carregador: carregador.status, gravouAtribuicao: Boolean(cookieDeAtribuicao),
      envio: envio.status, leadCapturado: Boolean(submissao),
      filaDestinos: naFila.map((linha) => linha.destination),
      atribuicaoNaFila: naFila[0]?.payload?.attribution ?? null,
      clickIdsNaFila: naFila[0]?.payload?.click_ids ?? null,
      utmNaFila: Object.fromEntries(Object.entries(naFila[0]?.payload?.params ?? {}).filter(([chave]) => chave.startsWith('utm'))),
      clienteNaFila: naFila[0]?.payload?.client ?? null,
      uaDaPessoa: ua,
      ipDaPessoa: ip,
      saida,
    });
  }

  if (process.env.ENTRADA_DE_LEADS_RELATORIO) await writeFile(process.env.ENTRADA_DE_LEADS_RELATORIO, JSON.stringify(relatorio, null, 2));

  // O que precisa valer hoje.
  // Cada destino só recebe o que consegue atribuir. Meta e TikTok fazem a própria
  // correspondência e recebem todo lead; o Google só recebe quem veio de um anúncio dele.
  // Até 27/09 o Google recebia todos e recusava os que não eram dele, e a tela o mostraria
  // como quebrado.
  const DO_GOOGLE = new Set(['Google Ads · pesquisa', 'Google Ads · iOS (gbraid)', 'Google Ads · iOS web (wbraid)', 'Clique · dois identificadores juntos']);
  for (const linha of relatorio) {
    assert.equal(linha.leadCapturado, true, `${linha.cenario}: o lead não foi capturado (envio ${linha.envio})`);
    const esperados = DO_GOOGLE.has(linha.cenario) ? ['google', 'meta', 'tiktok'] : ['meta', 'tiktok'];
    assert.deepEqual(linha.filaDestinos, esperados, `${linha.cenario}: a fila endereçou os destinos errados`);
    for (const [destino, saida] of Object.entries(linha.saida)) {
      assert.equal(saida.vai, true, `${linha.cenario}: ${destino} está na fila mas recusaria o evento (${saida.motivo})`);
    }
  }
  const porNome = Object.fromEntries(relatorio.map((linha) => [linha.cenario, linha]));
  assert.match(porNome['Facebook · anúncio'].saida.meta.fbc ?? '', /^fb\.1\.\d+\.IwAR0fb_clique_1$/, 'o clique do Facebook não chegou à Meta');
  assert.equal(porNome['Facebook · anúncio'].saida.meta.fbp, 'fb.1.1727400000000.1111111111', 'o _fbp do navegador não chegou à Meta');
  assert.equal(porNome['TikTok · anúncio'].saida.tiktok.ttclid, 'E.C.P.tiktok_clique_1', 'o clique do TikTok não chegou ao TikTok');
  assert.equal(porNome['Google Ads · pesquisa'].saida.google.gclid, 'Cj0KCQjw_google_1', 'o clique do Google não chegou ao Google');
  for (const nome of ['Direto (digitou o endereço)', 'Orgânico · busca Google', 'Orgânico · post no Instagram']) {
    assert.equal(porNome[nome].clickIdsNaFila, null, `${nome}: tráfego sem anúncio não pode carregar identificador de clique`);
  }
  assert.equal(porNome['UTM · no fragmento (#), não na query'].clickIdsNaFila, null, 'o fragmento da URL não pode ser lido como atribuição');

  // O IP e o navegador que chegam à Meta são os de cada pessoa. Até 27/09 eram os da
  // função da Vercel, iguais para todo lead — este bloco era só relatado; o conserto do
  // gateway o transformou em asserção.
  for (const linha of relatorio) {
    assert.equal(linha.saida.meta.ip, linha.ipDaPessoa, `${linha.cenario}: o IP que chega à Meta não é o da pessoa`);
    assert.equal(linha.saida.meta.ua, linha.uaDaPessoa, `${linha.cenario}: o navegador que chega à Meta não é o da pessoa`);
  }
  // A UTM chega à plataforma. Até 27/09 chegava em 0 de 25 cenários; o gateway só
  // assinava o clique.
  assert.deepEqual(porNome['Facebook · anúncio'].saida.meta.utm, { utm_source: 'facebook', utm_medium: 'cpc', utm_campaign: 'lancamento_set', utm_content: 'criativo_a' });
  assert.deepEqual(porNome['Orgânico · link com UTM de e-mail'].saida.meta.utm, { utm_source: 'newsletter', utm_medium: 'email', utm_campaign: 'edicao_42' }, 'UTM sem clique de anúncio também chega');
  assert.deepEqual(porNome['UTM · acentos'].saida.meta.utm, { utm_campaign: 'promoção_verão' });
  assert.deepEqual(porNome['UTM · valor com espaço (%20 e +)'].saida.meta.utm, { utm_campaign: 'black friday', utm_content: 'banner topo' });
  assert.deepEqual(porNome['TikTok · anúncio'].saida.tiktok.utm, { utm_source: 'tiktok', utm_medium: 'paid', utm_campaign: 'ugc_set' });
  for (const nome of ['Direto (digitou o endereço)', 'UTM · no fragmento (#), não na query', 'UTM · valor enorme (600 caracteres)', 'UTM · nome do parâmetro em maiúsculas', 'UTM · parâmetros fora do padrão']) {
    assert.deepEqual(porNome[nome].saida.meta.utm, {}, `${nome}: não deveria levar UTM`);
  }

  const ipsEnviados = new Set(relatorio.map((linha) => linha.saida.meta.ip));
  assert.equal(ipsEnviados.size, relatorio.length, 'visitantes diferentes precisam chegar com IPs diferentes');
  assert.equal(ipsEnviados.has(IP_DA_FUNCAO_VERCEL), false, 'o IP da função da Vercel não pode chegar a plataforma nenhuma');
  assert.equal(relatorio.some((linha) => linha.saida.meta.ua === UA_DO_FETCH_DA_FUNCAO), false, 'o navegador da função não pode chegar a plataforma nenhuma');
});
