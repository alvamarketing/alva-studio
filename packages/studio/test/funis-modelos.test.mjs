// Os modelos de funil e as páginas que cada etapa cria.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelosDeFunil } from '../public/funis-modelos.js';
import { TIPOS_DE_ETAPA, etapaViraPagina, paginaDaEtapa } from '../public/funis-etapas.js';
import { capturasDoEstado, documentoDaPagina, normalizarEstadoAlva } from '../public/pagina-alva.js';

test('os modelos da Jornada chegam inteiros: etapas com tipo conhecido e setas entre etapas que existem', () => {
  assert.ok(modelosDeFunil.length >= 20);
  for (const modelo of modelosDeFunil) {
    const ids = new Set(modelo.nos.map((no) => no.id));
    for (const no of modelo.nos) assert.ok(TIPOS_DE_ETAPA[no.k], `${modelo.nome}: tipo desconhecido "${no.k}"`);
    for (const seta of modelo.setas) assert.ok(ids.has(seta.de) && ids.has(seta.para), `${modelo.nome}: seta solta`);
  }
});

test('toda etapa que vira página, em todo modelo, gera uma página que o Studio desenha', () => {
  let paginas = 0;
  for (const modelo of modelosDeFunil) for (const etapa of modelo.nos.filter((no) => etapaViraPagina(no.k))) {
    const { kind, editorState } = paginaDaEtapa(etapa, { proxima: '/proxima', alternativa: '/outra' });
    const estado = normalizarEstadoAlva(editorState);
    const html = documentoDaPagina(estado);
    assert.match(html, /^<!doctype html>/, `${modelo.nome} › ${etapa.nome}`);
    if (kind === 'quiz') assert.equal(capturasDoEstado(estado).forms.length, 1);
    paginas += 1;
  }
  assert.ok(paginas > 30, `só ${paginas} páginas`);
});

test('o upsell leva o "sim" à próxima etapa e o "não" à alternativa', () => {
  const html = documentoDaPagina(normalizarEstadoAlva(paginaDaEtapa({ k: 'upsellpg', nome: 'Mentoria', texto: '• Acompanhamento semanal' }, { proxima: '/obrigado', alternativa: '/downsell' }).editorState));
  assert.match(html, /<a href="\/obrigado" class="cta"[^>]*>Sim, quero adicionar<\/a>/);
  assert.match(html, /<a href="\/downsell" class="cta"[^>]*>Não, obrigado<\/a>/);
  assert.match(html, /Acompanhamento semanal/, 'a descrição da etapa vira texto da página');
});

test('a aplicação vira um quiz com pergunta de qualificação', () => {
  const { kind, editorState } = paginaDaEtapa({ k: 'formulario', nome: 'Aplicação da mentoria', texto: '' });
  assert.equal(kind, 'quiz');
  const [captura] = capturasDoEstado(normalizarEstadoAlva(editorState)).forms;
  assert.ok(captura.fields.some((campo) => campo.type === 'single_choice' && campo.options.includes('Acima de R$ 500 mil')));
});
