import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quizRuntimeScript, quizRuntimeCss } from '../public/quiz-runtime.js';


// O runtime é o que transforma a página publicada em quiz: esconde tudo menos a etapa
// atual, prende o botão de cada seção ao avanço e junta as respostas até o fim.

const pagina = (corpo, destino) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${quizRuntimeCss}</style></head>`
  + `<body data-alva-quiz="true">${corpo}<script>${quizRuntimeScript({ destino })}</script></body></html>`;

async function abrir(corpo, { envios = [], destino = '/api/respostas' } = {}) {
  const dom = new JSDOM(pagina(corpo, destino), {
    url: 'https://exemplo.test/quiz',
    runScripts: 'dangerously',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.fetch = async (...args) => {
        envios.push(args);
        return { ok: true, json: async () => ({}) };
      };
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  return dom;
}

const visiveis = (document) => [...document.querySelectorAll('section')].filter((s) => !s.hasAttribute('hidden')).map((s) => s.id);

const TRES_ETAPAS = `
  <form data-alva-capture-id="11111111-1111-4111-8111-111111111111" action="/api/respostas">
    <section id="a"><h1>Abertura</h1><button data-alva-quiz-next>Começar</button></section>
    <section id="b"><label>Nome<input name="nome" required></label><button data-alva-quiz-next>Continuar</button></section>
    <section id="c"><h2>Obrigado</h2></section>
  </form>`;
const TRES_ETAPAS_SEM_CAPTURA = TRES_ETAPAS.replace(/<\/?form[^>]*>/g, '');

test('só a primeira etapa aparece quando a página abre', async () => {
  const dom = await abrir(TRES_ETAPAS);
  assert.deepEqual(visiveis(dom.window.document), ['a']);
  dom.window.close();
});

test('o botão da seção leva à próxima etapa', async () => {
  const dom = await abrir(TRES_ETAPAS);
  const { document } = dom.window;
  document.querySelector('#a button').click();
  assert.deepEqual(visiveis(document), ['b']);
  dom.window.close();
});

test('campo obrigatório vazio segura o avanço na mesma etapa', async () => {
  const dom = await abrir(TRES_ETAPAS);
  const { document } = dom.window;
  document.querySelector('#a button').click();
  document.querySelector('#b button').click();
  assert.deepEqual(visiveis(document), ['b'], 'sem a resposta, continua onde estava');
  document.querySelector('[name="nome"]').value = 'Taian';
  document.querySelector('#b button').click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(visiveis(document), ['c']);
  dom.window.close();
});

test('chegar na última etapa envia as respostas juntas', async () => {
  const envios = [];
  const dom = await abrir(TRES_ETAPAS, { envios });
  const { document } = dom.window;
  document.querySelector('#a button').click();
  document.querySelector('[name="nome"]').value = 'Taian';
  document.querySelector('#b button').click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(envios.length, 1, 'as respostas vão uma vez, no fim');
  const corpo = JSON.parse(envios[0][1].body);
  assert.deepEqual(corpo.answers, { nome: 'Taian' });
  dom.window.close();
});

test('página que não é quiz não é tocada pelo runtime', async () => {
  const dom = new JSDOM(
    `<!doctype html><html><body><section id="a"></section><section id="b"></section><script>${quizRuntimeScript()}</script></body></html>`,
    { url: 'https://exemplo.test/', runScripts: 'dangerously' },
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(visiveis(dom.window.document), ['a', 'b'], 'sem a marca de quiz, a landing continua landing');
  dom.window.close();
});

test('sem javascript a página não fica em branco', () => {
  // Esconder as etapas pelo CSS deixaria a página vazia para quem tem script bloqueado.
  assert.doesNotMatch(quizRuntimeCss, /section\s*\{[^}]*display:\s*none/);
  assert.match(quizRuntimeCss, /\[hidden\]/, 'quem esconde é o runtime, marcando as etapas');
});

test('quiz sem captura publicada não tenta enviar nem finge conclusão', async () => {
  const envios = [];
  const dom = await abrir(TRES_ETAPAS_SEM_CAPTURA, { envios, destino: '' });
  const { document } = dom.window;
  document.querySelector('#a button').click();
  document.querySelector('[name="nome"]').value = 'Taian';
  document.querySelector('#b button').click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(envios.length, 0);
  assert.deepEqual(visiveis(document), ['b']);
  assert.match(document.querySelector('[data-alva-quiz-erro]').textContent, /ainda não tem uma captura publicada/);
  dom.window.close();
});

// Quem monta o quiz no editor de páginas arrasta um botão comum. Exigir uma marcação que
// só existe no HTML deixaria o quiz publicado preso na primeira etapa, sem saída visível.
test('um botão comum da seção também avança, sem marcação nenhuma', async () => {
  const dom = await abrir(`
    <section id="a"><h1>Abertura</h1><button>Começar</button></section>
    <section id="b"><h2>Fim</h2></section>`);
  const { document } = dom.window;
  document.querySelector('#a button').click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(visiveis(document), ['b']);
  dom.window.close();
});

test('link de âncora dentro da etapa avança em vez de rolar a página', async () => {
  const dom = await abrir(`
    <section id="a"><a class="cta" href="#b">Quero começar</a></section>
    <section id="b"><h2>Fim</h2></section>`);
  const { document } = dom.window;
  document.querySelector('#a a').click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(visiveis(document), ['b']);
  dom.window.close();
});

test('link para fora continua saindo da página', async () => {
  const dom = await abrir(`
    <section id="a"><a href="https://exemplo.test/outro">Política de privacidade</a><button>Continuar</button></section>
    <section id="b"><h2>Fim</h2></section>`);
  const { document } = dom.window;
  document.querySelector('#a a').click();
  assert.deepEqual(visiveis(document), ['a'], 'clicar num link externo não pode pular a etapa');
  dom.window.close();
});
