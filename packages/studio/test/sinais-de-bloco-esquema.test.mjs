// Etapa 7, passo 1: cada bloco da página publicada carrega a identidade estável do nó.
// É por ela que o tracker diz "este bloco" sem nunca ler o conteúdo dele.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderNode, renderTree, FORMATO_ID_DE_BLOCO } from '../public/page-schema.js';
import { documentoDaPagina, normalizarEstadoAlva } from '../public/pagina-alva.js';
import { alvaParaPuck, puckParaAlva } from '../public/puck-conversao.js';

const ID_DO_FORM = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
const estado = () => normalizarEstadoAlva({
  formato: 'alva/1', root: { title: 'Oferta' },
  content: [
    { id: 'secao-topo', type: 'section', props: {}, children: [
      { id: 'titulo-1', type: 'heading', props: { text: 'Olá', level: 1 }, children: [] },
      { id: 'botao-1', type: 'button', props: { text: 'Quero', href: '#contato' }, children: [] },
    ] },
    { id: 'secao-contato', type: 'section', props: {}, children: [
      { id: ID_DO_FORM, type: 'form', props: { submitLabel: 'Enviar' }, children: [
        { id: 'campo-email', type: 'field', props: { label: 'E-mail', name: 'email', fieldType: 'email', required: true }, children: [] },
      ] },
    ] },
  ],
});
const idsDe = (html) => [...html.matchAll(/data-alva-bloco="([^"]+)"/g)].map((m) => m[1]);

test('o bloco com caixa leva o id do nó em data-alva-bloco', () => {
  assert.equal(
    renderNode({ id: 'texto-1', type: 'text', props: { text: 'x' } }),
    '<div class="alva-bloco" data-alva-bloco="texto-1"><p class="alva-texto">x</p></div>',
  );
});

test('a seção e a etapa do quiz também levam o id, porque são os blocos que a página perde', () => {
  assert.match(renderNode({ id: 'secao-1', type: 'section', props: {}, children: [] }), /^<section class="alva-secao" data-alva-bloco="secao-1">/);
  assert.match(renderNode({ id: 'etapa-1', type: 'etapa', props: {}, children: [] }), /data-alva-bloco="etapa-1"/);
});

test('o campo de captura nunca é medido: nada do que a pessoa digita ganha um marcador', () => {
  const html = renderTree(estado().content);
  assert.equal(html.includes('data-alva-bloco="campo-email"'), false);
  assert.doesNotMatch(html, /<(label|input|textarea)[^>]*data-alva-bloco/);
});

test('sem id, a saída é a de sempre: o visual e os testes de render não mudam', () => {
  assert.equal(renderNode({ type: 'text', props: { text: 'x' } }), '<div class="alva-bloco"><p class="alva-texto">x</p></div>');
});

test('um id fora do formato aceito pelo coletor não vira atributo', () => {
  for (const ruim of ['a b', 'x"onload="1', '<b>', 'ç', 'a'.repeat(81)]) {
    const html = renderNode({ id: ruim, type: 'text', props: { text: 'x' } });
    assert.equal(html.includes('data-alva-bloco'), false, ruim);
  }
  assert.match('titulo_1-A', FORMATO_ID_DE_BLOCO);
});

test('a página publicada tem um marcador por bloco, todos distintos', () => {
  const ids = idsDe(documentoDaPagina(estado()));
  assert.deepEqual([...ids].sort(), ['botao-1', 'secao-contato', 'secao-topo', 'titulo-1', ID_DO_FORM].sort());
  assert.equal(new Set(ids).size, ids.length);
});

test('o id é estável entre salvamentos: ida e volta pelo Puck devolve os mesmos marcadores', () => {
  const antes = documentoDaPagina(estado());
  const depois = documentoDaPagina(normalizarEstadoAlva(puckParaAlva(alvaParaPuck(estado()))));
  assert.equal(depois, antes);
  // Editar o texto de um bloco não troca a identidade dele.
  const editado = estado();
  editado.content[0].children[0].props.text = 'Outro título';
  assert.deepEqual(idsDe(documentoDaPagina(normalizarEstadoAlva(puckParaAlva(alvaParaPuck(editado))))), idsDe(antes));
});

test('normalizar de novo não gera identidade nova', () => {
  const uma = normalizarEstadoAlva(estado());
  assert.deepEqual(normalizarEstadoAlva(uma), uma);
});

test('a prévia do editor não carrega o script de medição, nem o do tracker', () => {
  const html = documentoDaPagina(estado(), { previa: true, publicOrigin: 'https://studio.example.test' });
  assert.doesNotMatch(html, /tracker\.js|data-alva-tracker|sendBeacon|IntersectionObserver/);
});
