import { JSDOM } from 'jsdom';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import grapesjs from 'grapesjs';
import { elementoPorId } from '../public/catalogo-elementos.js';
import { editorialElementLabel, setTextNodeContent } from '../public/editor-shell.js';

// A Escala e o Arquivo ganharam visual próprio e, no caminho, deixaram de ser <label> com
// texto solto. O inspetor só oferece controles de campo para <label> ou <input>; sem isso
// a Escala virou "Bloco de conteúdo" sem controle nenhum e a pergunta sumiu da marcação.
const comEditor = async (fn) => {
  const dom = new JSDOM('<!doctype html>');
  const anterior = { window: globalThis.window, document: globalThis.document, DOMParser: globalThis.DOMParser, Node: globalThis.Node };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, DOMParser: dom.window.DOMParser, Node: dom.window.Node });
  const editor = grapesjs.init({ headless: true, storageManager: false });
  try { return await fn(editor); } finally { editor.destroy(); Object.assign(globalThis, anterior); }
};
const tagOf = (m) => String(m?.get?.('tagName') || '').toLowerCase();
const filhos = (m) => m?.components?.().models || [];
const descendentes = (m) => filhos(m).flatMap((f) => [f, ...descendentes(f)]);
const comClasse = (raiz, classe) => descendentes(raiz).find((d) => d.getClasses?.().includes(classe));

for (const [id, pergunta, classe, nome] of [
  ['quiz-range', 'Como você avalia?', 'scale', 'campo_escala'],
  ['quiz-file', 'Envie um arquivo', 'upload', 'campo_arquivo'],
]) {
  test(`${id} nasce como campo, com a pergunta editável`, () => comEditor((editor) => {
    const [raiz] = editor.getWrapper().append(elementoPorId(id).render());
    assert.equal(tagOf(raiz), 'label', 'o inspetor só oferece controles de campo para <label> ou <input>');
    assert.equal(editorialElementLabel(raiz), 'Campo');
    const texto = filhos(raiz).find((f) => f.is('textnode'));
    assert.ok(texto, 'sem texto solto no label, "Nome mostrado acima do campo" não tem o que editar');
    assert.equal(texto.get('content').trim(), pergunta);
    assert.ok(comClasse(raiz, classe), `o visual .${classe} precisa continuar lá`);
    assert.ok(descendentes(raiz).some((d) => tagOf(d) === 'input' && d.getAttributes().name === nome), `a resposta ${nome} não pode sumir`);
  }));

  test(`${id}: editar a pergunta não injeta texto dentro do visual`, () => comEditor((editor) => {
    const [raiz] = editor.getWrapper().append(elementoPorId(id).render());
    const visualAntes = comClasse(raiz, classe).toHTML();
    setTextNodeContent(filhos(raiz).find((f) => f.is('textnode')), 'Qual é a sua nota?');
    assert.match(editor.getHtml(), new RegExp(`Qual é a sua nota\\?<span class="${classe}"`));
    assert.equal(comClasse(raiz, classe).toHTML(), visualAntes);
  }));
}
