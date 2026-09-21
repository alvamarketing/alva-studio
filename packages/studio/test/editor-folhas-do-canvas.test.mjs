import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import grapesjs from 'grapesjs';
import { documentoDeModelo, folhasDoCanvas, podarFolhaDeFormulario } from '../public/editor-shell.js';
import { formCss, getTemplate, normalizeForms, templateCss, templates } from '../public/templates.js';
import { catalogo, elementosCss } from '../public/catalogo-elementos.js';
import { quizCanvasCss } from '../public/quiz-elements.js';

test('o canvas do quiz veste a pele do quiz publicado, não a da landing', () => {
  const { folhas } = folhasDoCanvas({ quizCanvas: true, cssExistente: '' });
  assert.deepEqual(folhas, [quizCanvasCss]);
  // quizCanvasCss já traz a folha dos elementos dentro: o cartão de escolha continua
  // desenhado sem precisar de uma segunda folha.
  assert.ok(folhas.join('').includes('.choice{'), 'a folha dos elementos viaja dentro da pele do quiz');
});

test('a folha da landing não entra no quiz, porque a raiz do quiz é um .alva-form', () => {
  // templateCss termina em ${formCss}. Com ele dentro, `.alva-form label{display:block}`
  // (0,1,1) vence `.choice{display:flex}` (0,1,0) e o cartão vira rádio empilhado; e
  // `.alva-form input{display:block}` vence o [hidden] do navegador, devolvendo o
  // "Choose File" nativo. Achados D1 e D2 do gate visual de 2026-09-12.
  const folha = folhasDoCanvas({ quizCanvas: true, cssExistente: '' }).folhas.join('');
  assert.ok(!folha.includes(templateCss), 'a folha do modelo da landing não entra no quiz');
  assert.ok(!folha.includes(formCss), 'formCss não entra no quiz por nenhum caminho');
  assert.ok(!folha.includes('.alva-form label'), 'nada no quiz achata o rótulo do cartão');
  assert.ok(!folha.includes('.alva-form input'), 'nada no quiz redesenha o input escondido');
});

test('o quiz novo nasce na página branca aprovada, não numa caixa', () => {
  // Aprovado pelo Taian em 2026-09-21, depois de recusar a etapa dentro de um cartão:
  // página 100% branca, coluna centralizada, nada em volta da etapa. A coluna mora na
  // SEÇÃO, e não no <form>, porque a raiz de captura nasce com display:contents.
  const folha = folhasDoCanvas({ quizCanvas: true, cssExistente: '' }).folhas.join('');
  assert.match(folha, /body\{[^}]*background-color:#ffffff/);
  // chromeCss pinta o :root de --cloud; sem isto a página fica cinza abaixo do conteúdo.
  assert.match(folha, /:root\{[^}]*background-color:#ffffff/);
  assert.match(folha, /body\{[^}]*font-family:"Instrument Sans"/);
  const secao = folha.match(/\[data-alva-quiz-capture\]>section\{([^}]*)\}/)?.[1] || '';
  assert.match(secao, /max-width:440px/, 'a etapa não vira coluna');
  assert.match(secao, /margin:0 auto/, 'a coluna não fica no centro');
  assert.doesNotMatch(secao, /box-shadow:0|border:1px|background-color/, 'a etapa voltou a ser caixa');
  // O foco do campo dentro da captura usava --field-border, que só existe em formCss.
  assert.match(folha, /--field-border:#286EEA/);
  // `.alva-form` é podado do projeto ao reabrir o quiz (podarFolhaDeFormulario): a pele
  // não pode depender dele, senão some na segunda abertura.
  assert.ok(![...folha.matchAll(/(?:^|\})([^{}@]+)\{/g)].some((m) => m[1].includes('.alva-form') && !m[1].includes('.answer:focus')), 'a pele depende de .alva-form');
});

test('a landing continua exatamente como estava', () => {
  const { folhas, normalizarFormularios } = folhasDoCanvas({ quizCanvas: false, cssExistente: '' });
  assert.deepEqual(folhas, [elementosCss, templateCss]);
  assert.equal(normalizarFormularios, true);
});

test('uma página que já tem o modelo não recebe o modelo de novo', () => {
  const { folhas } = folhasDoCanvas({ quizCanvas: false, cssExistente: '.hero-grid{display:grid}' });
  assert.ok(!folhas.includes(templateCss), 'não reaplica o modelo por cima do trabalho salvo');
});

test('só a landing normaliza formulários', () => {
  // normalizeForms injeta formCss por conta própria assim que acha um <form>, e a raiz do
  // quiz é um <form>. No quiz quem cuida do formulário é ensureQuizCapture.
  assert.equal(folhasDoCanvas({ quizCanvas: true, cssExistente: '' }).normalizarFormularios, false);
  assert.equal(folhasDoCanvas({ quizCanvas: false, cssExistente: '' }).normalizarFormularios, true);
});

test('uma página que já tem a folha dos elementos não a recebe de novo', () => {
  const { folhas } = folhasDoCanvas({ quizCanvas: false, cssExistente: ':root{--alva-el-accent:#286eea}' });
  assert.ok(!folhas.includes(elementosCss));
});

test('um quiz já vestido não recebe a pele de novo', () => {
  const { folhas } = folhasDoCanvas({ quizCanvas: true, cssExistente: ':root{--cloud:#f7f9fd}' });
  assert.deepEqual(folhas, []);
});

test('ninguém chama normalizeForms no quiz por fora de folhasDoCanvas', async () => {
  const { readFile } = await import('node:fs/promises');
  // A decisão precisa morar num lugar só. Uma chamada solta de normalizeForms no caminho
  // do quiz reintroduz formCss mesmo com folhasDoCanvas correto — e havia três: abrir o
  // editor, inserir um bloco e SALVAR. A do salvamento era a pior: gravava a folha dentro
  // do projeto, e o cartão de escolha voltava achatado na reabertura.
  for (const arquivo of ['../public/editor-shell.js', '../public/app.js']) {
    const fonte = await readFile(new URL(arquivo, import.meta.url), 'utf8');
    for (const chamada of fonte.matchAll(/normalizeForms\(editor\)/g)) {
      const contexto = fonte.slice(Math.max(0, chamada.index - 320), chamada.index);
      assert.match(contexto, /normalizarFormularios/, `${arquivo}: toda chamada de normalizeForms passa por folhasDoCanvas`);
    }
  }
});

test('a pele do quiz sobrevive ao GrapesJS sem trazer a folha do formulário', () => {
  const dom = new JSDOM('<!doctype html>');
  const anterior = { window: globalThis.window, document: globalThis.document, DOMParser: globalThis.DOMParser, Node: globalThis.Node };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node });
  const editor = grapesjs.init({ headless: true, storageManager: false });
  try {
    editor.setComponents('<form class="alva-form" data-alva-quiz-capture="true"><section><div class="choices"><label class="choice"><input type="radio" name="q"><span class="choice-key">1</span><span>Opção 1</span></label></div><label class="upload"><span>Escolher arquivo</span><input type="file" name="arq" hidden></label></section></form>');
    const { folhas, normalizarFormularios } = folhasDoCanvas({ quizCanvas: true, cssExistente: editor.getCss() });
    folhas.forEach((folha) => editor.addStyle(folha));
    if (normalizarFormularios) normalizeForms(editor);
    const css = editor.getCss();
    assert.ok(!css.includes('.alva-form label'), 'formCss entrou no quiz e achataria o cartão');
    assert.ok(!/\.alva-form input/.test(css), 'formCss entrou e o "Choose File" voltaria');
    assert.match(css, /\.choice\{[^}]*display:flex/, 'o cartão de escolha continua sendo cartão');
    assert.ok(css.includes('--cloud:#f7f9fd'), 'a marca de que a pele já foi aplicada chega ao canvas');
    // O GrapesJS devolve a cor normalizada pelo CSSOM, em rgb().
    assert.match(css, /body\{[^}]*background-color:rgb\(255, 255, 255\)/, 'o fundo branco do quiz sobrevive à serialização');
    assert.match(css, /\[data-alva-quiz-capture\] ?> ?section\{[^}]*max-width:440px/, 'a coluna do quiz sobrevive à serialização');
    // A segunda passada é o que acontece a cada bloco inserido: não pode reaplicar nada.
    assert.deepEqual(folhasDoCanvas({ quizCanvas: true, cssExistente: css }).folhas, []);
  } finally {
    editor.destroy();
    Object.assign(globalThis, anterior);
    dom.window.close();
  }
});

test('o modelo semeia o quiz sem a folha do formulário', async () => {
  const { readFile } = await import('node:fs/promises');
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  const inicio = fonte.indexOf('editor.setComponents(html)');
  assert.match(fonte.slice(inicio, inicio + 900), /editor\.setStyle\(quizCanvas \? css\.split\(formCss\)\.join\(''\) : css\)/);
  // folhasDoCanvas decide o que o editor ACRESCENTA; o modelo decide com o que a página
  // nova NASCE, e é outro caminho para a mesma folha. O modelo "Página em branco" é
  // formCss puro: sem esta poda o quiz em branco já abre com `.alva-form label` dentro e
  // o cartão de escolha nasce achatado, com blockStyles correto e tudo.
  assert.equal(getTemplate('blank').css, formCss);
  assert.equal(getTemplate('blank').css.split(formCss).join(''), '');
  assert.ok(getTemplate('services').css.includes(formCss), 'os modelos de página terminam em formCss');
  const semFormulario = getTemplate('services').css.split(formCss).join('');
  assert.ok(!semFormulario.includes('.alva-form label'), 'a poda tira o que achata o cartão');
  assert.ok(semFormulario.includes('.hero-grid'), 'e deixa o resto do modelo de pé');
});

const comDom = (corpo) => {
  const dom = new JSDOM('<!doctype html>');
  const anterior = { window: globalThis.window, document: globalThis.document, DOMParser: globalThis.DOMParser, Node: globalThis.Node };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node });
  try {
    return corpo();
  } finally {
    Object.assign(globalThis, anterior);
    dom.window.close();
  }
};

// Um projeto como o banco tem hoje: salvo pela main, com formCss GRAVADO dentro. Não dá
// para fabricar isso por string, porque o projeto guarda regras, não texto — é justamente
// por isso que a poda por substring do modelo (css.split(formCss)) não alcança este caso.
const projetoSalvoComFormCss = (html) => comDom(() => {
  const editor = grapesjs.init({ headless: true, storageManager: false });
  try {
    editor.setComponents(html);
    editor.addStyle(formCss);
    editor.addStyle(elementosCss);
    return JSON.parse(JSON.stringify(editor.getProjectData()));
  } finally {
    editor.destroy();
  }
});

const cssAoReabrir = (projeto, { quizCanvas }) => comDom(() => {
  const editor = grapesjs.init({ headless: true, storageManager: false });
  try {
    editor.loadProjectData(projeto);
    if (quizCanvas) podarFolhaDeFormulario(editor);
    return editor.getCss();
  } finally {
    editor.destroy();
  }
});

const quizHtml = '<form class="alva-form" data-alva-quiz-capture="true"><div class="choices"><label class="choice"><input type="radio" name="q"><span class="choice-key">1</span><span>Opção 1</span></label></div></form>';
const landingHtml = '<main><form class="alva-form"><label>Seu nome<input type="text" name="campo_nome"></label></form></main>';

test('quiz salvo com formCss dentro reabre sem ele, e o cartão de escolha volta a ser cartão', () => {
  // Na main, abrir OU salvar um quiz chamava normalizeForms(editor), que injeta formCss
  // assim que encontra um <form> — e a raiz de todo quiz é um. Todo quiz salvo desde que
  // quiz virou página carrega a folha dentro do projeto. folhasDoCanvas acrescenta a
  // folha certa mas não remove a gravada: `.alva-form label` (0,1,1) continua vencendo
  // `.choice` (0,1,0) e o cartão reabre achatado. Por isso a poda é ao CARREGAR.
  const projeto = projetoSalvoComFormCss(quizHtml);
  const antes = cssAoReabrir(projeto, { quizCanvas: false });
  assert.ok(antes.includes('.alva-form label'), 'o projeto de partida precisa mesmo ter formCss gravado');

  const depois = cssAoReabrir(projeto, { quizCanvas: true });
  assert.ok(!depois.includes('.alva-form label'), 'a folha gravada continuaria achatando o cartão de escolha');
  assert.ok(!/\.alva-form input/.test(depois), 'a folha gravada continuaria devolvendo o "Choose File" nativo');
  assert.ok(!/(^|})\.alva-form\s*\{/.test(depois), 'a regra raiz da folha do formulário também sai');
  assert.match(depois, /\.choice\{[^}]*display:flex/, 'o cartão de escolha continua desenhado');
  assert.ok(depois.includes('--alva-el-accent'), 'a poda tira só a folha do formulário, não a dos elementos');
});

test('landing salva com formCss dentro mantém o seu', () => {
  // A landing tem formulário de verdade — é o bloco "Formulário" — e formCss é a folha
  // que o desenha. Podar lá tiraria a diagramação do formulário da página.
  const projeto = projetoSalvoComFormCss(landingHtml);
  const css = cssAoReabrir(projeto, { quizCanvas: false });
  assert.ok(css.includes('.alva-form label'), 'a landing precisa da folha do formulário');
  assert.ok(/\.alva-form input/.test(css), 'a landing precisa da folha do formulário');
});

test('a poda do formCss gravado acontece ao carregar um quiz, e só ele', async () => {
  const { readFile } = await import('node:fs/promises');
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  for (const chamada of fonte.matchAll(/podarFolhaDeFormulario\(editor\)/g)) {
    const contexto = fonte.slice(Math.max(0, chamada.index - 200), chamada.index);
    assert.match(contexto, /quizCanvas/, 'toda poda é condicionada a quizCanvas: na landing ela tiraria a folha do formulário de verdade');
  }
  assert.match(fonte, /temProjetoSalvo\(project\)\) podarFolhaDeFormulario\(editor\)/, 'a poda é do projeto SALVO — a semente do modelo já sai podada em setStyle');
});

test('a miniatura do modelo veste as mesmas folhas que o canvas da landing', () => {
  // A galeria de modelos e o cartão da página desenham uma prévia com `template.css`
  // dentro de um <style>. Enquanto .cta morou em templateCss isso bastava; quando a
  // regra mudou para elementosCss, a miniatura passou a mostrar o botão como texto cru,
  // ainda que o canvas o desenhasse certo. Prévia que mente sobre o modelo é pior do que
  // prévia nenhuma: é por ela que a pessoa escolhe. Por isso o documento de prévia
  // compõe as folhas pelo MESMO folhasDoCanvas que o editor usa.
  for (const modelo of templates) {
    const documento = documentoDeModelo(modelo);
    for (const elemento of catalogo) {
      if (elemento.registro !== 'pagina') continue;
      const classe = elemento.seletor.slice(1);
      if (!new RegExp(`class="[^"]*\\b${classe}\\b`).test(modelo.html)) continue;
      assert.ok(
        documento.includes(`${elemento.seletor}{`) || documento.includes(`${elemento.seletor},`) || documento.includes(`${elemento.seletor} `),
        `a prévia do modelo ${modelo.id} usa ${elemento.seletor} e não traz regra para ele`,
      );
    }
  }
});

test('o documento de prévia é montado pelo app a partir de folhasDoCanvas', async () => {
  const { readFile } = await import('node:fs/promises');
  const fonte = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(fonte, /documentoDeModelo/, 'a prévia não pode remontar as folhas por conta própria');
  assert.ok(!/'<style>'\s*\+\s*\n?\s*template\.css/.test(fonte), 'a prévia não injeta template.css sozinho');
});
