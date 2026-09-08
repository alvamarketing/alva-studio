import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quizRuntimeScript, quizRuntimeCss } from '../public/quiz-runtime.js';

const jsdomPath = new URL('../../../node_modules/.pnpm/jsdom@27.4.0/node_modules/jsdom/lib/api.js', import.meta.url);

// O runtime é o que transforma a página publicada em quiz: esconde tudo menos a etapa
// atual, prende o botão de cada seção ao avanço e junta as respostas até o fim.

const pagina = (corpo, destino) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${quizRuntimeCss}</style></head>`
  + `<body data-alva-quiz="true">${corpo}<script>${quizRuntimeScript({ destino })}</script></body></html>`;

async function abrir(corpo, { envios = [], destino = '/api/respostas' } = {}) {
  const { JSDOM } = await import(jsdomPath);
  const dom = new JSDOM(pagina(corpo, destino), {
    url: 'https://exemplo.test/quiz',
    runScripts: 'dangerously',
    beforeParse(window) {
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
  <section id="a"><h1>Abertura</h1><button data-alva-quiz-next>Começar</button></section>
  <section id="b"><label>Nome<input name="nome" required></label><button data-alva-quiz-next>Continuar</button></section>
  <section id="c"><h2>Obrigado</h2></section>`;

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
  const { JSDOM } = await import(jsdomPath);
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

test('quiz sem destino configurado não tenta enviar para lugar nenhum', async () => {
  const envios = [];
  const dom = await abrir(TRES_ETAPAS, { envios, destino: '' });
  const { document } = dom.window;
  document.querySelector('#a button').click();
  document.querySelector('[name="nome"]').value = 'Taian';
  document.querySelector('#b button').click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(envios.length, 0, 'sem destino, avançar continua funcionando e nada é enviado');
  assert.deepEqual(visiveis(document), ['c']);
  dom.window.close();
});
