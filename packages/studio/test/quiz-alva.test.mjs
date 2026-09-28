// O quiz no esquema do Alva: o mesmo editor (Puck) e o mesmo desenhador da landing, com
// etapas no lugar de seções, perguntas de escolha e ramificação por resposta.
//
// Antes, o quiz era projectData do GrapesJS, publicado como um formulário de uma etapa só:
// as engines de ramificação e cálculo existiam e ninguém as usava. Aqui cada etapa vira uma
// etapa da captura, e a opção que "leva a outra etapa" vira regra que o servidor confere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { capturasDoEstado, documentoDaPagina, estadoDoQuiz, normalizarEstadoAlva } from '../public/pagina-alva.js';
import { renderNode } from '../public/page-schema.js';
import { validatePageCaptureAnswers } from '../server/page-capture-schema.mjs';
import { alvaParaPuck, puckParaAlva } from '../public/puck-conversao.js';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Quatro etapas: a pergunta da etapa 1 manda "Já tenho" direto para o contato (etapa 3),
// pulando a etapa 2, que tem pergunta obrigatória. A última é a tela final.
const quiz = () => normalizarEstadoAlva({
  formato: 'alva/1',
  root: { title: 'Diagnóstico', tipo: 'quiz' },
  content: [
    { id: 'etapa-1', type: 'etapa', props: {}, children: [
      { id: 'titulo-1', type: 'heading', props: { text: 'Você já tem site?', level: 1 }, children: [] },
      { id: 'escolha-site', type: 'escolha', props: { pergunta: 'Você já tem site?', name: 'tem_site', obrigatoria: true, avancar: true, opcoes: [
        { rotulo: 'Ainda não', icone: 'close' },
        { rotulo: 'Já tenho', icone: 'check', destino: 'etapa-3' },
      ] }, children: [] },
    ] },
    { id: 'etapa-2', type: 'etapa', props: {}, children: [
      { id: 'escolha-prazo', type: 'escolha', props: { pergunta: 'Para quando?', name: 'prazo', obrigatoria: true, opcoes: [{ rotulo: 'Este mês' }, { rotulo: 'Sem pressa' }] }, children: [] },
      { id: 'botao-2', type: 'button', props: { text: 'Continuar', href: '#' }, children: [] },
    ] },
    { id: 'etapa-3', type: 'etapa', props: {}, children: [
      { id: 'campo-email', type: 'field', props: { label: 'E-mail', name: 'email', fieldType: 'email', required: true }, children: [] },
      { id: 'escolha-canais', type: 'escolha', props: { pergunta: 'Onde você anuncia?', name: 'canais', multipla: true, opcoes: [{ rotulo: 'Meta' }, { rotulo: 'Google' }] }, children: [] },
      { id: 'botao-3', type: 'button', props: { text: 'Ver resultado', href: '#' }, children: [] },
    ] },
    { id: 'etapa-4', type: 'etapa', props: {}, children: [
      { id: 'titulo-4', type: 'heading', props: { text: 'Pronto! Falamos com você.', level: 2 }, children: [] },
    ] },
  ],
});

test('o quiz guarda o tipo e ganha uma captura estável na raiz', () => {
  const estado = quiz();
  assert.equal(estado.root.tipo, 'quiz');
  assert.match(estado.root.captureId, UUID);
  assert.equal(normalizarEstadoAlva(estado).root.captureId, estado.root.captureId, 'normalizar de novo não troca a captura');
  assert.equal(normalizarEstadoAlva({ formato: 'alva/1', root: { title: 'x' }, content: [] }).root.tipo, undefined, 'landing continua landing');
});

test('o quiz passa pelo editor (Puck) e volta igual', () => {
  const estado = quiz();
  assert.deepEqual(normalizarEstadoAlva(puckParaAlva(alvaParaPuck(estado))), estado);
});

test('a pergunta de escolha vira opções clicáveis, com o destino da ramificação', () => {
  const html = renderNode(quiz().content[0].children[1]);
  assert.match(html, /<fieldset class="alva-escolha[^"]*" data-alva-quiz-question data-alva-quiz-required>/);
  assert.match(html, /<legend class="alva-escolha-pergunta">Você já tem site\?<\/legend>/);
  assert.match(html, /<input type="radio" name="tem_site" value="Ainda não" required data-alva-avanca>/);
  assert.match(html, /<input type="radio" name="tem_site" value="Já tenho" required data-alva-avanca data-alva-destino="etapa-3">/);
  assert.match(html, /<span class="material-symbols-outlined" aria-hidden="true">check<\/span>/);
  const multipla = renderNode(quiz().content[2].children[1]);
  assert.match(multipla, /<input type="checkbox" name="canais" value="Meta">/);
});

test('o documento do quiz marca o corpo, junta as etapas numa captura e leva o runtime com nonce', () => {
  const estado = quiz();
  const html = documentoDaPagina(estado);
  assert.match(html, /<body data-alva-quiz="true" data-alva-quiz-voltar="true">/);
  assert.match(html, new RegExp(`<form class="alva-quiz" data-alva-capture-id="${estado.root.captureId}" action="#" method="post" novalidate>`));
  assert.equal((html.match(/<section class="alva-secao alva-etapa"/g) || []).length, 4);
  assert.match(html, /<script nonce="__ALVA_RUNTIME_NONCE__">/, 'a CSP da página publicada só roda script com o nonce');
  assert.match(html, /\.alva-opcao:has\(input:checked\)/, 'escolhido é visualmente diferente de passar o cursor');
});

test('a captura do quiz tem uma etapa por tela e a regra da opção que ramifica', () => {
  const estado = quiz();
  const { forms } = capturasDoEstado(estado);
  assert.equal(forms.length, 1);
  const [captura] = forms;
  assert.equal(captura.captureId, estado.root.captureId);
  assert.equal(captura.name, 'Diagnóstico');
  assert.deepEqual(captura.fields.map((campo) => [campo.id, campo.type, campo.required]), [
    ['tem_site', 'single_choice', true], ['prazo', 'single_choice', true], ['email', 'email', true], ['canais', 'multiple_choice', false],
  ]);
  assert.deepEqual(captura.fields[0].options, ['Ainda não', 'Já tenho']);
  assert.deepEqual(captura.steps.map((etapa) => etapa.id), ['etapa-1', 'etapa-2', 'etapa-3', 'etapa-4']);
  assert.deepEqual(captura.steps[0].branching, { rules: [{ fieldId: 'tem_site', operator: 'equals', value: 'Já tenho', nextScreenId: 'etapa-3' }] });
});

test('o servidor aceita o caminho que pulou a etapa e recusa o que deixou obrigatória em branco', () => {
  const [captura] = capturasDoEstado(quiz()).forms;
  const pulou = validatePageCaptureAnswers(captura, { answers: { tem_site: 'Já tenho', email: 'ana@exemplo.test', canais: ['Meta'] } });
  assert.equal(pulou.email, 'ana@exemplo.test');
  assert.throws(() => validatePageCaptureAnswers(captura, { answers: { tem_site: 'Ainda não', email: 'ana@exemplo.test' } }), /Para quando/);
  assert.throws(() => validatePageCaptureAnswers(captura, { answers: { tem_site: 'Talvez', email: 'ana@exemplo.test' } }), /resposta válida/);
});

test('opção que aponta para etapa anterior é recusada ao montar a captura', () => {
  const estado = quiz();
  estado.content[2].children[1].props.opcoes[0].destino = 'etapa-1';
  assert.throws(() => capturasDoEstado(estado), /anterior/);
});

// O runtime de verdade, no documento de verdade.
async function abrir(estado, { envios = [], conversoes = [] } = {}) {
  const dom = new JSDOM(documentoDaPagina(estado).replace('action="#"', 'action="/api/public/pages/p/v/captures/c"'), {
    url: 'https://lp.exemplo.test/quiz',
    runScripts: 'dangerously',
    beforeParse(window) {
      window.scrollTo = () => {};
      window.fetch = async (...args) => { envios.push(args); return { ok: true, json: async () => ({}) }; };
      window.alvaRuntime = { conversao: (...args) => conversoes.push(args) };
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  return dom;
}
const visivel = (document) => [...document.querySelectorAll('section.alva-etapa')].filter((s) => !s.hidden).map((s) => s.dataset.alvaEtapa);
const esperar = () => new Promise((resolve) => setTimeout(resolve, 20));

test('escolher avança sozinho, a opção que ramifica pula a etapa e o fim envia o lead', async () => {
  const envios = []; const conversoes = [];
  const dom = await abrir(quiz(), { envios, conversoes });
  const { document } = dom.window;
  assert.deepEqual(visivel(document), ['etapa-1']);
  document.querySelector('input[value="Já tenho"]').click();
  await esperar();
  assert.deepEqual(visivel(document), ['etapa-3'], '"Já tenho" leva direto ao contato');
  document.querySelector('[data-alva-etapa="etapa-3"] a.cta').click();
  await esperar();
  assert.deepEqual(visivel(document), ['etapa-3'], 'e-mail obrigatório vazio segura');
  document.querySelector('input[name="email"]').value = 'ana@exemplo.test';
  document.querySelector('input[value="Google"]').click();
  document.querySelector('[data-alva-etapa="etapa-3"] a.cta').click();
  await esperar();
  assert.deepEqual(visivel(document), ['etapa-4']);
  assert.equal(envios.length, 1);
  assert.equal(envios[0][0], '/api/public/pages/p/v/captures/c');
  assert.deepEqual(JSON.parse(envios[0][1].body).answers, { tem_site: 'Já tenho', email: 'ana@exemplo.test', canais: ['Google'] });
  assert.equal(conversoes[0][0], 'lead');
  dom.window.close();
});

test('voltar desfaz o passo, e o que ficou fora do caminho não vai no envio', async () => {
  const envios = [];
  const dom = await abrir(quiz(), { envios });
  const { document } = dom.window;
  assert.equal(document.querySelector('[data-alva-etapa="etapa-1"] [data-alva-quiz-voltar]'), null, 'a primeira etapa não tem voltar');
  document.querySelector('input[value="Ainda não"]').click();
  await esperar();
  document.querySelector('input[value="Este mês"]').click();
  document.querySelector('[data-alva-etapa="etapa-2"] a.cta').click();
  await esperar();
  assert.deepEqual(visivel(document), ['etapa-3']);
  document.querySelector('[data-alva-etapa="etapa-3"] [data-alva-quiz-voltar]').click();
  await esperar();
  assert.deepEqual(visivel(document), ['etapa-2']);
  document.querySelector('[data-alva-etapa="etapa-2"] [data-alva-quiz-voltar]').click();
  await esperar();
  assert.deepEqual(visivel(document), ['etapa-1']);
  // Agora pelo atalho: a resposta da etapa 2 fica para trás.
  document.querySelector('input[value="Já tenho"]').click();
  await esperar();
  document.querySelector('input[name="email"]').value = 'ana@exemplo.test';
  document.querySelector('[data-alva-etapa="etapa-3"] a.cta').click();
  await esperar();
  assert.deepEqual(visivel(document), ['etapa-4']);
  assert.equal(document.querySelector('[data-alva-etapa="etapa-4"] [data-alva-quiz-voltar]'), null, 'a tela final não volta');
  const respostas = JSON.parse(envios[0][1].body).answers;
  assert.deepEqual(respostas, { tem_site: 'Já tenho', email: 'ana@exemplo.test' });
  const [captura] = capturasDoEstado(quiz()).forms;
  assert.ok(validatePageCaptureAnswers(captura, { answers: respostas }), 'o servidor aceita o que o runtime mandou');
  dom.window.close();
});

test('sem ramificação, segue para a etapa seguinte', async () => {
  const dom = await abrir(quiz());
  const { document } = dom.window;
  document.querySelector('input[value="Ainda não"]').click();
  await esperar();
  assert.deepEqual(visivel(document), ['etapa-2']);
  dom.window.close();
});

test('quiz novo nasce com abertura, pergunta, contato e tela final', () => {
  const estado = normalizarEstadoAlva(estadoDoQuiz('Meu quiz'));
  assert.equal(estado.root.tipo, 'quiz');
  assert.equal(estado.root.title, 'Meu quiz');
  assert.ok(estado.content.length >= 3);
  assert.ok(estado.content.every((etapa) => etapa.type === 'etapa'));
  const [captura] = capturasDoEstado(estado).forms;
  assert.ok(captura.fields.some((campo) => campo.type === 'single_choice'));
  assert.ok(captura.fields.some((campo) => campo.type === 'email'));
  assert.equal(captura.steps.at(-1).elements.length, 0, 'a última etapa é a tela final, sem pergunta');
});

test('quiz no esquema: salvar, publicar e receber o lead pelo caminho ramificado', { timeout: 60_000 }, async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  t.after(() => database.close());
  const dono = (await database.query("INSERT INTO users (email,password_hash,display_name) VALUES ('qa@alva.test','hash','Dono') RETURNING id")).rows[0];
  const empresa = (await database.query("INSERT INTO companies (name,slug) VALUES ('Agência','agencia') RETURNING id")).rows[0];
  const projeto = (await database.query("INSERT INTO projects (company_id,name,slug,created_by) VALUES ($1,'Projeto','projeto',$2) RETURNING id", [empresa.id, dono.id])).rows[0];
  await database.query("INSERT INTO company_memberships (company_id,user_id,role,joined_at) VALUES ($1,$2,'owner',now())", [empresa.id, dono.id]);
  await database.query("INSERT INTO project_domains (company_id,project_id,environment,domain,is_canonical,verification_status) VALUES ($1,$2,'production','lp.exemplo.test',true,'verified')", [empresa.id, projeto.id]);
  const content = new ContentRepository(database, { publicOrigin: 'https://studio.example.test' });
  const escopo = { companyId: empresa.id, projectId: projeto.id, actorId: dono.id };

  const criada = await content.createPage({ ...escopo, name: 'Diagnóstico', route: '/diagnostico', kind: 'quiz', editorState: quiz() });
  assert.match(criada.renderedHtml, /data-alva-quiz="true"/);
  await content.publishPage({ ...escopo, pageId: criada.id, lockVersion: criada.lockVersion });
  const versao = (await database.query('SELECT id, capture_schema FROM page_versions WHERE page_id = $1', [criada.id])).rows[0];
  const captura = versao.capture_schema.forms[0];
  assert.equal(captura.steps.length, 4);
  const lead = await content.submitPublishedPageCapture({
    companyId: empresa.id, projectId: projeto.id, pageId: criada.id, pageVersionId: versao.id, captureId: captura.captureId,
    input: { answers: { tem_site: 'Já tenho', email: 'ana@exemplo.test', canais: ['Meta'] } }, origin: 'https://lp.exemplo.test',
  });
  assert.match(lead.eventId, UUID);
});
