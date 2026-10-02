import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { adotarBloco, alternarManual, devolverBlocoSimples, esqueletoDoBloco, pintarPlataformas } from '../public/plataformas-ui.js';
import { destinosDeConversaoModel } from '../public/studio-dashboard.js';

// O cartão "Plataformas" (02/10/2026): um bloco por plataforma, com logo, nome, uma linha de
// status e a ação. O preenchimento manual de todas continua alcançável.
function montar(destinos = [], { entregas = [], pode = true, salvar, remover, erro, aviso } = {}) {
  const janela = new JSDOM('<section id="painel"><div id="tracking-destinations" class="providers"></div></section>');
  const doc = janela.window.document;
  const raiz = doc.querySelector('#tracking-destinations');
  const chamadas = [];
  const opcoes = {
    salvar: salvar ?? (async (destino, dados) => { chamadas.push(['salvar', destino.provider, Object.fromEntries(dados)]); }),
    remover: remover ?? (async (provider) => { chamadas.push(['remover', provider]); }),
    erro, aviso,
  };
  const pintar = (novos = destinos) => pintarPlataformas(raiz, destinosDeConversaoModel(novos, entregas, pode), opcoes);
  pintar();
  return { janela, doc, raiz, chamadas, pintar };
}
const bloco = (raiz, provider) => raiz.querySelector(`:scope > [data-provider="${provider}"]`);
const botaoComTexto = (raiz, texto) => [...raiz.querySelectorAll('button')].find((item) => item.textContent.trim() === texto);

test('os cinco blocos aparecem na ordem, com logo, nome e uma linha de status; a Meta é larga', () => {
  const { raiz, janela } = montar();
  assert.ok(raiz.classList.contains('plataformas-grade'));
  const blocos = [...raiz.querySelectorAll(':scope > .plataforma')];
  assert.deepEqual(blocos.map((item) => item.dataset.provider), ['meta', 'tiktok', 'google', 'linkedin', 'taboola']);
  assert.deepEqual(blocos.map((item) => item.querySelector('.plataforma-nome').textContent), ['Meta', 'TikTok', 'Google Ads', 'LinkedIn', 'Taboola']);
  for (const item of blocos) {
    assert.equal(item.querySelectorAll('.plataforma-status').length, 1, `${item.dataset.provider}: uma linha de status`);
    assert.ok(item.querySelector('.plataforma-cabeca > .plataforma-logo'), `${item.dataset.provider}: logo no quadrado`);
  }
  assert.ok(bloco(raiz, 'meta').classList.contains('plataforma-larga'));
  assert.equal(raiz.querySelectorAll('.plataforma-larga').length, 1);
  janela.window.close();
});

test('logos: Meta, TikTok e Google Ads do simple-icons; LinkedIn e Taboola com a inicial', () => {
  const { raiz, janela } = montar();
  for (const provider of ['meta', 'tiktok', 'google']) assert.ok(bloco(raiz, provider).querySelector('.plataforma-cabeca > .plataforma-logo svg path'), provider);
  assert.equal(bloco(raiz, 'linkedin').querySelector('.plataforma-cabeca > .plataforma-logo').textContent, 'in');
  assert.equal(bloco(raiz, 'taboola').querySelector('.plataforma-cabeca > .plataforma-logo').textContent, 'Tb');
  assert.ok(bloco(raiz, 'linkedin').querySelector('.plataforma-logo').classList.contains('sem-logo'));
  janela.window.close();
});

test('em breve: TikTok, Google, LinkedIn e Taboola sem configuração têm "Conectar com…" desativado e explicado', () => {
  const { raiz, janela } = montar();
  for (const [provider, texto] of [['tiktok', 'Conectar com o TikTok'], ['google', 'Conectar com o Google'], ['linkedin', 'Conectar com o LinkedIn'], ['taboola', 'Conectar com a Taboola']]) {
    const item = bloco(raiz, provider);
    assert.ok(item.classList.contains('em-breve'), provider);
    const oficial = item.querySelector('.plataforma-oficial');
    const nomeAcessivel = [...oficial.children].filter((filho) => filho.getAttribute('aria-hidden') !== 'true').map((filho) => filho.textContent).join('');
    assert.equal(nomeAcessivel, texto, 'o logo do botão é decorativo; o nome é o texto');
    assert.equal(oficial.getAttribute('aria-disabled'), 'true');
    const explicacao = item.ownerDocument.getElementById(oficial.getAttribute('aria-describedby'));
    assert.match(explicacao.textContent, /Conexão direta em breve/);
    assert.ok([...item.querySelectorAll('.role-chip')].some((c) => c.textContent === 'Em breve'));
  }
  // A Meta não é "em breve": ela conecta pelo cartão da conexão, ou fica só no manual.
  assert.equal(bloco(raiz, 'meta').classList.contains('em-breve'), false);
  assert.equal(bloco(raiz, 'meta').querySelector('.plataforma-oficial'), null);
  janela.window.close();
});

test('cada plataforma tem o caminho manual: "Preencher manualmente" abre o formulário de antes', () => {
  const { raiz, doc, janela } = montar();
  const campos = { meta: 'pixel_id', tiktok: 'pixel_code', google: 'operating_account_id', linkedin: 'conversion_urn', taboola: 'account_id' };
  for (const [provider, campo] of Object.entries(campos)) {
    const item = bloco(raiz, provider);
    const abrir = item.querySelector('.plataforma-manual-botao');
    assert.equal(abrir.textContent, 'Preencher manualmente');
    const formulario = item.querySelector('.plataforma-formulario');
    assert.equal(formulario.hidden, true);
    assert.equal(abrir.getAttribute('aria-controls'), formulario.id);
    abrir.click();
    assert.equal(formulario.hidden, false, provider);
    assert.equal(abrir.getAttribute('aria-expanded'), 'true');
    assert.ok(formulario.querySelector(`form.provider-form input[name="${campo}"]`), `${provider}: ${campo}`);
    assert.equal(doc.activeElement?.name, campo, 'o cursor vai para o primeiro campo');
    abrir.click();
    assert.equal(formulario.hidden, true);
  }
  janela.window.close();
});

test('configurada à mão: o bloco não fica transparente, diz o estado e oferece "Editar" com Salvar e Remover', async () => {
  const destinos = [
    { provider: 'tiktok', configured: true, publicConfiguration: { pixel_code: 'C4ABC' }, updatedAt: '2026-09-26T10:00:00.000Z' },
    { provider: 'taboola', configured: true, publicConfiguration: { account_id: '123' }, updatedAt: '2026-09-26T10:00:00.000Z' },
  ];
  const { raiz, chamadas, janela } = montar(destinos, { entregas: [{ destination: 'tiktok' }] });
  const tiktok = bloco(raiz, 'tiktok');
  assert.equal(tiktok.classList.contains('em-breve'), false);
  assert.equal(tiktok.querySelector('.plataforma-oficial'), null);
  assert.equal(tiktok.querySelector('.plataforma-status').textContent, 'Events API · C4ABC');
  const estado = tiktok.querySelector('.plataforma-acoes .role-chip');
  assert.equal(estado.textContent, 'Enviando');
  assert.ok(estado.classList.contains('positivo'));
  assert.equal(bloco(raiz, 'taboola').querySelector('.plataforma-acoes .role-chip').textContent, 'Configurado');
  const editar = tiktok.querySelector('.plataforma-manual-botao');
  assert.equal(editar.textContent, 'Editar');
  editar.click();
  const form = tiktok.querySelector('form.provider-form');
  assert.equal(form.elements.pixel_code.value, 'C4ABC');
  assert.equal(form.elements.access_token.value, '', 'o token nunca volta');
  assert.match(form.elements.access_token.placeholder, /Guardado/);
  form.elements.pixel_code.value = 'C4XYZ';
  form.dispatchEvent(new janela.window.Event('submit', { cancelable: true }));
  await new Promise((resolver) => setTimeout(resolver, 0));
  assert.deepEqual(chamadas[0], ['salvar', 'tiktok', { pixel_code: 'C4XYZ', access_token: '', test_event_code: '' }]);
  botaoComTexto(tiktok, 'Remover').click();
  assert.deepEqual(chamadas[1], ['remover', 'tiktok']);
  janela.window.close();
});

test('estados do manual continuam: modo de teste, token vencendo e "Precisa reconectar" em alerta', () => {
  const agora = Date.now();
  const destinos = [
    { provider: 'tiktok', configured: true, publicConfiguration: { pixel_code: 'C4', test_event_code: 'TEST1' } },
    { provider: 'linkedin', configured: true, publicConfiguration: {}, updatedAt: new Date(agora - 55 * 864e5).toISOString() },
    { provider: 'meta', configured: true, publicConfiguration: { pixel_id: '555', token_source: 'connection' }, conexao: { precisaReconectar: true } },
  ];
  const { raiz, janela } = montar(destinos);
  const rotulo = (provider) => bloco(raiz, provider).querySelector('.plataforma-acoes .role-chip');
  assert.equal(rotulo('tiktok').textContent, 'Modo de teste');
  assert.match(rotulo('linkedin').textContent, /Token vence em/);
  assert.equal(rotulo('meta').textContent, 'Precisa reconectar');
  for (const provider of ['tiktok', 'linkedin', 'meta']) assert.ok(rotulo(provider).classList.contains('alerta'), provider);
  janela.window.close();
});

test('erro ao salvar fica ao lado do formulário', async () => {
  const { raiz, janela } = montar([], { salvar: async () => { throw new Error('ID do pixel fora de formato.'); } });
  const tiktok = bloco(raiz, 'tiktok');
  tiktok.querySelector('.plataforma-manual-botao').click();
  tiktok.querySelector('form').dispatchEvent(new janela.window.Event('submit', { cancelable: true }));
  await new Promise((resolver) => setTimeout(resolver, 0));
  assert.match(tiktok.querySelector('.form-error').textContent, /fora de formato/);
  janela.window.close();
});

test('a grade se repinta sem recriar os blocos: o formulário aberto continua aberto', () => {
  const { raiz, pintar, janela } = montar();
  const tiktok = bloco(raiz, 'tiktok');
  tiktok.querySelector('.plataforma-manual-botao').click();
  pintar([{ provider: 'tiktok', configured: true, publicConfiguration: { pixel_code: 'C4' } }]);
  assert.equal(bloco(raiz, 'tiktok'), tiktok);
  assert.equal(tiktok.querySelector('.plataforma-formulario').hidden, false);
  assert.equal(tiktok.querySelector('.plataforma-manual-botao').textContent, 'Editar');
  assert.equal(raiz.querySelectorAll(':scope > .plataforma').length, 5);
  janela.window.close();
});

test('falha ao ler não vira "nada configurado"; entrega desligada é avisada', () => {
  const comErro = montar([], { erro: 'tempo esgotado' });
  assert.match(comErro.raiz.querySelector('.plataformas-aviso').textContent, /Não foi possível ler as plataformas deste ambiente: tempo esgotado/);
  assert.equal([...comErro.raiz.querySelectorAll(':scope > .plataforma')].every((item) => item.hidden), true);
  comErro.janela.window.close();
  const desligada = montar([], { aviso: 'A entrega de conversões está desligada neste ambiente.' });
  assert.match(desligada.raiz.querySelector('.plataformas-aviso').textContent, /desligada/);
  desligada.janela.window.close();
});

test('sem permissão de integrações: estado visível, nenhum formulário nem "Conectar"', () => {
  const { raiz, janela } = montar([{ provider: 'meta', configured: true, publicConfiguration: { pixel_id: '1' } }], { pode: false });
  assert.equal(raiz.querySelectorAll('form').length, 0);
  assert.equal(raiz.querySelectorAll('.plataforma-oficial').length, 0);
  assert.equal([...raiz.querySelectorAll('.plataforma-manual-botao')].every((item) => item.hidden), true);
  assert.equal(bloco(raiz, 'meta').querySelector('.role-chip').textContent, 'Configurado');
  assert.match(raiz.querySelector('.plataformas-aviso').textContent, /exige permissão de integrações/);
  janela.window.close();
});

test('Meta pela conexão no manual: só o código de teste, e "Prefiro preencher manualmente" troca para o completo sem token guardado', () => {
  const { raiz, janela } = montar([{ provider: 'meta', configured: true, publicConfiguration: { pixel_id: '555', token_source: 'connection' } }]);
  const meta = bloco(raiz, 'meta');
  meta.querySelector('.plataforma-manual-botao').click();
  assert.deepEqual([...meta.querySelectorAll('form input')].map((item) => item.name), ['test_event_code']);
  botaoComTexto(meta, 'Prefiro preencher manualmente').click();
  const form = meta.querySelector('form.provider-form');
  assert.deepEqual([...form.querySelectorAll('input')].map((item) => item.name), ['pixel_id', 'access_token', 'test_event_code']);
  assert.equal(form.elements.access_token.required, true, 'sem token guardado, o token é exigido');
  assert.doesNotMatch(form.elements.access_token.placeholder, /^Guardado/);
  janela.window.close();
});

test('o cartão da conexão entra no lugar do bloco da Meta, leva o formulário e recebe o destino', () => {
  const { raiz, doc, pintar, janela } = montar([{ provider: 'meta', configured: true, publicConfiguration: { pixel_id: '1' } }]);
  const cartao = esqueletoDoBloco(doc, 'meta', 'Meta');
  cartao.dataset.dono = 'conexao';
  const recebidos = [];
  cartao.definirDestino = (destino) => recebidos.push(destino.stateLabel);
  adotarBloco(raiz, cartao);
  assert.equal(bloco(raiz, 'meta'), cartao);
  assert.ok(cartao.querySelector('.plataforma-formulario input[name="pixel_id"]'), 'o formulário manual veio junto');
  pintar([{ provider: 'meta', configured: true, publicConfiguration: { pixel_id: '2' } }]);
  assert.equal(bloco(raiz, 'meta'), cartao, 'repintar não troca o cartão pelo bloco simples');
  assert.equal(cartao.querySelector('.plataforma-formulario input[name="pixel_id"]').value, '2');
  assert.deepEqual(recebidos, ['Configurado', 'Configurado']);
  assert.equal(alternarManual(cartao), true);
  // Sem a conexão (app desligado, sem permissão), a Meta volta ao bloco simples.
  const simples = devolverBlocoSimples(cartao);
  assert.equal(bloco(raiz, 'meta'), simples);
  assert.equal(simples.querySelector('.plataforma-manual-botao').textContent, 'Editar');
  janela.window.close();
});

test('o módulo só usa tokens: nenhuma cor, nem style em linha; o segredo nunca é preenchido', async () => {
  const fonte = await readFile(new URL('../public/plataformas-ui.js', import.meta.url), 'utf8');
  assert.doesNotMatch(fonte, /#[0-9a-f]{3,8}\b|rgba?\(|\.style\.|style=|font-weight/i);
  assert.doesNotMatch(fonte, /entrada\.value = .*(access_token|oauth_access_token|secret)/);
  assert.match(fonte, /rotuloDoSegredo\(destino\)/);
  assert.match(fonte, /semTokenGuardado: true/);
});

// Só tokens no CSS novo (exceto o bloco --marca-*, testado em marcas.test.mjs): nenhuma cor
// literal, raio/sombra/tamanho de fonte por token, peso entre 400 e 800.
test('o CSS da grade e dos públicos só usa tokens existentes', async () => {
  const css = await readFile(new URL('../public/owner.css', import.meta.url), 'utf8');
  const trechos = [
    css.slice(css.indexOf('/* Cartão "Plataformas"'), css.indexOf('/* "Conta da Meta", F2')),
    css.slice(css.indexOf('/* Cartão enxuto: quadrado com ícone'), css.indexOf('.publico-meta-acao {')),
  ];
  for (const trecho of trechos) {
    assert.ok(trecho.length > 300, 'o trecho existe');
    const regras = trecho.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(regras, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|font-family|style=/i);
    for (const raio of regras.match(/border-radius:[^;]+/g) ?? []) assert.match(raio, /var\(--radius-/);
    for (const sombra of regras.match(/box-shadow:[^;]+/g) ?? []) assert.match(sombra, /var\(--(?:shadow|ring)-/);
    for (const tamanho of regras.match(/font-size:[^;]+/g) ?? []) assert.match(tamanho, /var\(--(?:text|icon)-/);
    for (const peso of regras.match(/font-weight:[^;]+/g) ?? []) {
      const valor = Number(peso.split(':')[1]);
      assert.ok(valor >= 400 && valor <= 800, peso);
    }
  }
});
