import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPageExportHtml, ensureQuizCapture, editorialTreeEntries, sectionInsertionTarget } from '../public/editor-shell.js';
import { normalizeForms } from '../public/templates.js';
import { extractPageCaptureSchema } from '../server/page-capture-schema.mjs';

// Publicar a mesma página como quiz é uma decisão de quem monta, não outro editor: o
// HTML é o mesmo, e o que muda é a marca no corpo e o script que navega entre as seções.

const PAGINA = '<main><section id="a"><button data-alva-quiz-next>Ir</button></section><section id="b">Fim</section></main>';

test('página normal continua sem nada de quiz', () => {
  const html = buildPageExportHtml({ title: 'LP', html: PAGINA, css: '' });
  assert.doesNotMatch(html, /data-alva-quiz="true"/);
  assert.doesNotMatch(html, /alva-quiz-progresso/);
});

test('publicada como quiz, a página leva a marca e a navegação', () => {
  const html = buildPageExportHtml({ title: 'Quiz', html: PAGINA, css: '', quiz: true });
  assert.match(html, /<body data-alva-quiz="true">/, 'sem a marca o runtime não age');
  assert.match(html, /alva-quiz-progresso/, 'o estilo das etapas vai junto');
  assert.match(html, /data-alva-quiz-next/);
});

test('o destino das respostas entra no script publicado', () => {
  const html = buildPageExportHtml({ title: 'Quiz', html: PAGINA, css: '', quiz: true, quizDestino: 'https://api.alva.test/r/123' });
  assert.match(html, /https:\/\/api\.alva\.test\/r\/123/);
});

test('sem destino a página vai ao ar mesmo assim, só não envia', () => {
  const html = buildPageExportHtml({ title: 'Quiz', html: PAGINA, css: '', quiz: true });
  assert.match(html, /<body data-alva-quiz="true">/);
  assert.doesNotMatch(html, /undefined/, 'destino ausente não pode virar a palavra undefined na página');
});

test('o título e o conteúdo continuam sendo os da página', () => {
  const html = buildPageExportHtml({ title: 'Meu quiz', html: PAGINA, css: '.hero{color:red}', quiz: true });
  assert.match(html, /<title>Meu quiz<\/title>/);
  assert.match(html, /\.hero\{color:red\}/);
  assert.match(html, /<section id="a">/);
});

test('o app publica com a mecânica quando a página está marcada como quiz', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  // Sem passar a marca adiante, um quiz sobe como landing rolável: todas as etapas de uma
  // vez, sem botão que leve à seguinte.
  assert.match(app, /quiz: page\?\.kind === 'quiz'/);
});

test('quiz aberto no editor compartilhado ativa os blocos próprios de quiz', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /quizCanvas: page\.kind === 'quiz'/);
});

test('runtime publicado mostra falha HTTP de captura em vez de ignorá-la', async () => {
  const { JSDOM } = await import('jsdom');
  const html = buildPageExportHtml({
    title: 'Quiz', quiz: true, quizDestino: 'https://studio.test/captures/quiz', css: '',
    html: '<section><button data-alva-quiz-next>Continuar</button></section><section><h2>Fim</h2></section>',
  });
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://studio.test/quiz', beforeParse(window) {
    window.scrollTo = () => {};
    window.fetch = async () => ({ ok: false, status: 500 });
  } });
  dom.window.document.querySelector('button').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(dom.window.document.querySelector('[data-alva-quiz-erro]').textContent, /Não foi possível enviar/);
  dom.window.close();
});

test('runtime usa a action da captura publicada e só abre conclusão após confirmação', async () => {
  const { JSDOM } = await import('jsdom');
  const html = buildPageExportHtml({
    title: 'Quiz', quiz: true, css: '',
    html: '<form data-alva-capture-id="11111111-1111-4111-8111-111111111111" action="/api/public/pages/captures/submissions"><section><input name="email" value="lead@example.test"><button data-alva-quiz-next>Continuar</button></section><section><h2>Fim</h2></section></form>',
  });
  const requests = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://studio.test/quiz', beforeParse(window) {
    window.scrollTo = () => {};
    window.fetch = async (url, options) => { requests.push([url, JSON.parse(options.body)]); return { ok: true }; };
  } });
  dom.window.document.querySelector('button').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/api/public/pages/captures/submissions');
  assert.deepEqual(requests[0][1].answers, { email: 'lead@example.test' });
  assert.match(requests[0][1].trackingEventId, /^[0-9a-f-]{36}$/i, 'retry conserva este identificador na mesma sessão');
  assert.equal(dom.window.document.querySelectorAll('section')[1].hidden, false);
  dom.window.close();
});


test('retry de checkbox reaproveita o payload sem duplicar valores', async () => {
  const { JSDOM } = await import('jsdom');
  const html = buildPageExportHtml({ title: 'Quiz', quiz: true, css: '', html: '<form data-alva-capture-id="11111111-1111-4111-8111-111111111111" action="/captures"><section><input type="checkbox" name="interesse" value="A" checked><button data-alva-quiz-next>Continuar</button></section><section><h2>Fim</h2></section></form>' });
  const payloads = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://studio.test/quiz', beforeParse(window) { window.scrollTo = () => {}; window.fetch = async (_url, options) => { payloads.push(JSON.parse(options.body)); return { ok: payloads.length > 1 }; }; } });
  const button = dom.window.document.querySelector('button');
  button.click(); await new Promise((resolve) => setTimeout(resolve, 0));
  button.click(); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(payloads.map((payload) => payload.answers), [{ interesse: ['A'] }, { interesse: ['A'] }]);
  assert.equal(dom.window.document.querySelectorAll('section')[1].hidden, false);
  dom.window.close();
});

test('Enter no formulário segue a mesma confirmação da etapa', async () => {
  const { JSDOM } = await import('jsdom');
  const html = buildPageExportHtml({ title: 'Quiz', quiz: true, css: '', html: '<form data-alva-capture-id="11111111-1111-4111-8111-111111111111" action="/captures"><section><input name="email" value="lead@example.test"></section><section><h2>Fim</h2></section></form>' });
  let calls = 0;
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://studio.test/quiz', beforeParse(window) { window.scrollTo = () => {}; window.fetch = async () => { calls += 1; return { ok: true }; }; } });
  dom.window.document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  assert.equal(dom.window.document.querySelectorAll('section')[1].hidden, false);
  dom.window.close();
});

test('quiz sem captura publicada não mostra a conclusão nem simula sucesso', async () => {
  const { JSDOM } = await import('jsdom');
  const html = buildPageExportHtml({
    title: 'Quiz', quiz: true, css: '',
    html: '<section><button data-alva-quiz-next>Continuar</button></section><section><h2>Fim</h2></section>',
  });
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://studio.test/quiz', beforeParse(window) { window.scrollTo = () => {}; } });
  dom.window.document.querySelector('button').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dom.window.document.querySelectorAll('section')[1].hidden, true);
  assert.match(dom.window.document.querySelector('[data-alva-quiz-erro]').textContent, /ainda não tem uma captura publicada/);
  dom.window.close();
});


test('quiz persistido agrupa etapas num único contrato de captura estável', async () => {
  const { default: grapesjs } = await import('grapesjs');
  const editor = grapesjs.init({ headless: true, storageManager: false });
  try {
    const wrapper = editor.getWrapper();
    const first = wrapper.append({ tagName: 'section', components: [{ tagName: 'form', attributes: { class: 'alva-form legado', action: '#', method: 'post' }, components: [{ tagName: 'label', components: [{ type: 'textnode', content: 'E-mail' }, { tagName: 'input', attributes: { name: 'email', type: 'email', required: '' } }] }] }] })[0];
    const visualForm = first.components().at(0); visualForm.addStyle({ background: 'red' });
    wrapper.append({ tagName: 'section', components: [{ tagName: 'button', components: [{ type: 'textnode', content: 'Continuar' }] }] });
    assert.equal(ensureQuizCapture(editor, () => '11111111-1111-4111-8111-111111111111'), true);
    assert.equal(visualForm.get('tagName'), 'div', 'form antigo vira grupo visual, sem aninhar forms');
    assert.equal(visualForm.getAttributes().class, 'alva-form legado');
    assert.equal(visualForm.getAttributes().action, undefined);
    assert.equal(visualForm.getStyle().background, 'red');
    normalizeForms(editor);
    const state = editor.getProjectData();
    const schema = extractPageCaptureSchema(state);
    assert.equal(schema.forms.length, 1);
    assert.deepEqual(schema.forms[0].fields.map((field) => field.id), ['email']);
    assert.match(editor.getHtml(), /data-alva-quiz-capture="true"/);
    assert.match(editor.getHtml(), /<form[^>]*><section/);
    assert.equal(ensureQuizCapture(editor), false, 'reabrir/salvar não troca a captura');
    assert.equal(extractPageCaptureSchema(editor.getProjectData()).forms[0].captureId, schema.forms[0].captureId);
    const capture = editor.getWrapper().components().at(0);
    const tree = editorialTreeEntries(editor.getWrapper(), null, { quizCapture: true });
    assert.equal(tree.length, 2, 'a captura raiz não vira uma seção/folha da árvore');
    assert.equal(tree.flatMap((section) => section.elements).some((element) => element.component === capture), false);
    assert.equal(sectionInsertionTarget(editor.getWrapper(), editor.getWrapper(), { quizCapture: true }).target, capture);
    assert.equal(sectionInsertionTarget(capture.components().at(0), editor.getWrapper(), { quizCapture: true }).target, capture);
    const reopened = grapesjs.init({ headless: true, storageManager: false });
    try {
      reopened.loadProjectData(editor.getProjectData());
      assert.equal(ensureQuizCapture(reopened), false);
      const reopenedCapture = reopened.getWrapper().components().at(0);
      assert.equal(editorialTreeEntries(reopened.getWrapper(), null, { quizCapture: true }).length, 2);
      assert.equal(sectionInsertionTarget(reopened.getWrapper(), reopened.getWrapper(), { quizCapture: true }).target, reopenedCapture);
    } finally { reopened.destroy(); }
  } finally { editor.destroy(); }
});
