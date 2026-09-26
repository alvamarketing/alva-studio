import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPOS_DE_DESTINO, configuracaoParaSalvar, destinosDeConversaoModel } from '../public/studio-dashboard.js';
import { CAMPOS_EXIGIDOS_POR_DESTINO, CAMPOS_POR_DESTINO } from '../server/repositories/tracking-repository.mjs';

// A tela não inventa o que cada plataforma pede: ela desenha o mesmo contrato que o
// servidor valida. Campo a mais e o salvamento volta recusado; campo a menos e a pessoa
// preenche tudo para ouvir que faltou algo. Este teste é a trava contra as duas listas
// andarem separadas.
test('os campos do formulário são exatamente os que o servidor aceita', () => {
  for (const [destino, campos] of Object.entries(CAMPOS_DE_DESTINO)) {
    assert.deepEqual(
      campos.map((campo) => campo.name).sort(),
      [...CAMPOS_POR_DESTINO[destino]].sort(),
      `campos de ${destino}`,
    );
  }
  assert.deepEqual(Object.keys(CAMPOS_DE_DESTINO).sort(), Object.keys(CAMPOS_POR_DESTINO).sort());
});

test('o que o servidor exige aparece marcado como obrigatório', () => {
  for (const [destino, campos] of Object.entries(CAMPOS_DE_DESTINO)) {
    assert.deepEqual(
      campos.filter((campo) => campo.required).map((campo) => campo.name).sort(),
      [...CAMPOS_EXIGIDOS_POR_DESTINO[destino]].sort(),
      `obrigatórios de ${destino}`,
    );
  }
});

// Token é o campo que não pode voltar do servidor nem ser reexibido. O formulário precisa
// saber quais são, para pedi-los de novo em vez de fingir que já os tem.
test('todo campo de segredo é marcado, e nenhum deles é público', () => {
  const segredos = Object.values(CAMPOS_DE_DESTINO).flat().filter((campo) => campo.secret).map((campo) => campo.name);
  assert.deepEqual([...new Set(segredos)].sort(), ['access_token', 'oauth_access_token']);
  assert.equal(Object.values(CAMPOS_DE_DESTINO).flat().some((campo) => campo.secret && campo.public), false);
});

test('os cinco destinos aparecem, configurados ou não', () => {
  const modelo = destinosDeConversaoModel([], []);
  assert.deepEqual(modelo.map((linha) => linha.provider), ['meta', 'tiktok', 'google', 'linkedin', 'taboola']);
  assert.deepEqual([...new Set(modelo.map((linha) => linha.stateLabel))], ['Não configurado']);
  assert.equal(modelo.every((linha) => linha.configured === false), true);
});

test('o destino configurado mostra o identificador público, nunca o token', () => {
  const modelo = destinosDeConversaoModel(
    [{ provider: 'meta', environment: 'production', configured: true, publicConfiguration: { pixel_id: '99887766' }, updatedAt: '2026-09-26T10:00:00.000Z' }],
    [],
  );
  const meta = modelo.find((linha) => linha.provider === 'meta');
  assert.equal(meta.configured, true);
  assert.equal(meta.stateLabel, 'Configurado');
  assert.equal(meta.publicValue, '99887766');
  // A palavra "token" aparece — é o nome do campo a pedir. O que não pode aparecer é
  // valor: nenhum campo de segredo carrega conteúdo neste modelo, nem vindo do servidor.
  assert.equal(modelo.flatMap((linha) => linha.fields).some((campo) => 'value' in campo), false);
  assert.equal(JSON.stringify(modelo).includes('99887766'), true, 'o id público aparece');
});

// Configurado e entregando são coisas diferentes: credencial salva que nunca entregou é
// exatamente o caso que a pessoa precisa enxergar para desconfiar.
test('quem já entregou aparece como enviando, e quem só tem credencial não', () => {
  const destinos = [
    { provider: 'meta', environment: 'production', configured: true, publicConfiguration: { pixel_id: '1' }, updatedAt: '2026-09-26T10:00:00.000Z' },
    { provider: 'tiktok', environment: 'production', configured: true, publicConfiguration: { pixel_code: 'abc' }, updatedAt: '2026-09-26T10:00:00.000Z' },
  ];
  const modelo = destinosDeConversaoModel(destinos, [{ destination: 'meta', status: 'delivered' }]);
  assert.equal(modelo.find((linha) => linha.provider === 'meta').stateLabel, 'Enviando');
  assert.equal(modelo.find((linha) => linha.provider === 'tiktok').stateLabel, 'Configurado');
});

// A Taboola entrega pelo clique que vem na URL: não há credencial para guardar. Um
// formulário vazio com botão "Salvar" seria um convite a procurar o que não existe.
test('Taboola ativa sem credencial, e diz isso em vez de mostrar formulário vazio', () => {
  const taboola = destinosDeConversaoModel([], []).find((linha) => linha.provider === 'taboola');
  assert.deepEqual(taboola.fields, []);
  assert.equal(taboola.semCredencial, true);
});

const metaConfigurado = destinosDeConversaoModel(
  [{ provider: 'meta', environment: 'production', configured: true, publicConfiguration: { pixel_id: '1' }, updatedAt: '2026-09-26T10:00:00.000Z' }],
  [],
).find((linha) => linha.provider === 'meta');
const metaNovo = destinosDeConversaoModel([], []).find((linha) => linha.provider === 'meta');

// Corrigir o ID do pixel sem ter o token à mão é o caso comum de quem cuida de vários
// projetos. Se o campo em branco apagasse o token, cada correção viraria uma ida ao
// painel da plataforma.
test('num destino já configurado, token em branco significa manter — não apagar', () => {
  const enviado = configuracaoParaSalvar(metaConfigurado, { pixel_id: '55443322', access_token: '' });
  assert.deepEqual(enviado, { pixel_id: '55443322' });
});

test('num destino novo, o campo em branco sobe vazio para o servidor recusar', () => {
  const enviado = configuracaoParaSalvar(metaNovo, { pixel_id: '55443322', access_token: '' });
  assert.deepEqual(enviado, { pixel_id: '55443322' });
  assert.equal('access_token' in enviado, false);
});

test('o token digitado sobe, e espaço em volta não vira credencial', () => {
  assert.deepEqual(
    configuracaoParaSalvar(metaConfigurado, { pixel_id: ' 1 ', access_token: '  segredo-novo  ' }),
    { pixel_id: '1', access_token: 'segredo-novo' },
  );
});

test('campo que não pertence ao destino não sobe, mesmo se vier no formulário', () => {
  const enviado = configuracaoParaSalvar(metaConfigurado, { pixel_id: '1', conversion_urn: 'urn:lla:llaPartnerConversion:9' });
  assert.deepEqual(Object.keys(enviado), ['pixel_id']);
});

test('a Taboola sobe configuração vazia, que é o que ativá-la significa', () => {
  const taboola = destinosDeConversaoModel([], []).find((linha) => linha.provider === 'taboola');
  assert.deepEqual(configuracaoParaSalvar(taboola, {}), {});
});

// A tela de rastreamento abre com permissão de leitura de analytics, mas gravar credencial
// exige integrações. Sem essa distinção, quem só lê preencheria um formulário inteiro para
// receber 403 no envio.
test('sem permissão de integrações, o destino aparece sem formulário para preencher', () => {
  const modelo = destinosDeConversaoModel(
    [{ provider: 'meta', environment: 'production', configured: true, publicConfiguration: { pixel_id: '1' }, updatedAt: null }],
    [],
    false,
  );
  assert.equal(modelo.every((linha) => linha.editable === false), true);
  assert.deepEqual([...new Set(modelo.map((linha) => linha.fields.length))], [0]);
  // O estado continua visível: quem lê precisa saber se o projeto está configurado.
  assert.equal(modelo.find((linha) => linha.provider === 'meta').stateLabel, 'Configurado');
  assert.equal(modelo.find((linha) => linha.provider === 'meta').publicValue, '1');
});

const { readFile } = await import('node:fs/promises');
const markup = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

test('a tela fala com as três rotas de destino, e o segredo só sobe — nunca é pedido de volta', () => {
  assert.match(app, /tracking\/destinations\?environment=/);
  assert.match(app, /tracking\/destinations\/\$\{destino\.provider\}`, 'PUT'/);
  assert.match(app, /tracking\/destinations\/\$\{provider\}`, 'DELETE'/);
  // O campo de segredo nasce vazio: em nenhum lugar a tela preenche um input a partir de
  // algo que tenha vindo do servidor além da configuração pública.
  assert.doesNotMatch(app, /entrada\.value = .*(access_token|oauth_access_token|secret)/);
});

test('o bloco de destinos explica que prévia e produção têm credenciais separadas', () => {
  assert.match(markup, /id="tracking-destinations-title">Destinos<\/h2>/);
  assert.match(markup, /Prévia e produção guardam credenciais separadas/);
});

// A Biblioteca visual é a seção que rege esta tela, já que o wireframe não a desenha:
// nada de cor, raio ou tamanho inventado aqui.
test('o formulário usa apenas tokens que já existem', () => {
  const regra = css.match(/\.tracking-view \.provider-form input \{[^}]*\}/)?.[0] ?? '';
  assert.notEqual(regra, '', 'a regra do campo precisa existir');
  assert.doesNotMatch(regra, /#[0-9a-fA-F]{3,8}\b/, 'cor literal no lugar de token');
  for (const token of ['var(--alva-line)', 'var(--alva-ink)', 'var(--radius-sm)', 'var(--text-sm)']) {
    assert.ok(regra.includes(token), `esperava ${token} em ${regra}`);
  }
});
