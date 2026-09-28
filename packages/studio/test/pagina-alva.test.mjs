// A página no esquema do Alva, do salvar ao lead.
//
// O editor novo (Puck) salva o esquema; o servidor desenha o HTML publicado a partir dele
// e descobre os formulários caminhando pela árvore. Antes, o HTML vinha pronto do
// navegador e os campos eram achados num formato interno do GrapesJS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMATO_ALVA, capturasDoEstado, documentoDaPagina, normalizarEstadoAlva, paginaInicial } from '../public/pagina-alva.js';
import { extractVslReferences } from '../server/publication-snapshot.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pagina = () => ({
  formato: FORMATO_ALVA,
  root: { title: 'Oferta' },
  content: [
    { type: 'section', children: [
      { type: 'heading', props: { text: 'Fale com a gente', level: 1 } },
      { type: 'button', props: { text: 'Ver planos', href: '#planos' } },
      { type: 'vsl', props: { publicId: 'vsl_abc123' } },
      { type: 'form', props: { submitLabel: 'Quero falar' }, children: [
        { type: 'field', props: { label: 'Nome', name: 'nome', fieldType: 'text', required: true } },
        { type: 'field', props: { label: 'E-mail', name: 'email', fieldType: 'email', required: true } },
        { type: 'field', props: { label: 'WhatsApp', name: 'whatsapp', fieldType: 'tel' } },
      ] },
    ] },
  ],
});

test('todo formulário ganha um identificador estável, e o que já tem fica', () => {
  const estado = normalizarEstadoAlva(pagina());
  const formulario = estado.content[0].children[3];
  assert.match(formulario.id, UUID);
  assert.equal(normalizarEstadoAlva(estado).content[0].children[3].id, formulario.id);
});

test('o documento publicado sai do servidor, com as folhas, o formulário marcado e a VSL', () => {
  const html = documentoDaPagina(normalizarEstadoAlva(pagina()));
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Oferta<\/title>/);
  assert.match(html, /\.alva-form\{/, 'folha do formulário');
  assert.match(html, /\.alva-secao\{/, 'folha dos elementos');
  assert.match(html, /<form class="alva-form" data-alva-capture-id="[0-9a-f-]{36}"/);
  assert.match(html, /<a href="#planos" class="cta">Ver planos<\/a>/);
  assert.match(html, /data-alva-vsl="vsl_abc123"/);
});

test('os campos viram a captura no formato que a publicação valida', () => {
  const estado = normalizarEstadoAlva(pagina());
  const { forms } = capturasDoEstado(estado, { webhook: '' });
  assert.equal(forms.length, 1);
  assert.equal(forms[0].captureId, estado.content[0].children[3].id);
  assert.equal(forms[0].name, 'Fale com a gente');
  assert.deepEqual(forms[0].fields, [
    { id: 'nome', type: 'short_text', title: 'Nome', required: true },
    { id: 'email', type: 'email', title: 'E-mail', required: true },
    { id: 'whatsapp', type: 'short_text', title: 'WhatsApp', required: false },
  ]);
});

test('a publicação encontra a VSL do esquema', () => {
  assert.deepEqual(extractVslReferences(pagina()).map((ref) => ref.publicId), ['vsl_abc123']);
});

test('salvar no esquema, publicar e receber o lead', { timeout: 60_000 }, async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  t.after(() => database.close());
  const dono = (await database.query("INSERT INTO users (email,password_hash,display_name) VALUES ('pa@alva.test','hash','Dono') RETURNING id")).rows[0];
  const empresa = (await database.query("INSERT INTO companies (name,slug) VALUES ('Agência','agencia') RETURNING id")).rows[0];
  const projeto = (await database.query("INSERT INTO projects (company_id,name,slug,created_by) VALUES ($1,'Projeto','projeto',$2) RETURNING id", [empresa.id, dono.id])).rows[0];
  await database.query("INSERT INTO company_memberships (company_id,user_id,role,joined_at) VALUES ($1,$2,'owner',now())", [empresa.id, dono.id]);
  await database.query("INSERT INTO project_domains (company_id,project_id,environment,domain,is_canonical,verification_status) VALUES ($1,$2,'production','lp.exemplo.test',true,'verified')", [empresa.id, projeto.id]);
  const content = new ContentRepository(database, { publicOrigin: 'https://studio.example.test' });
  const escopo = { companyId: empresa.id, projectId: projeto.id, actorId: dono.id };

  const semVsl = pagina();
  semVsl.content[0].children.splice(2, 1);
  // O HTML que o navegador mandar é ignorado: quem desenha é o servidor.
  const criada = await content.createPage({ ...escopo, name: 'Oferta', route: '/oferta', editorState: semVsl, renderedHtml: '<p>forjado</p>' });
  assert.doesNotMatch(criada.renderedHtml, /forjado/);
  assert.match(criada.renderedHtml, /data-alva-capture-id/);

  const editada = await content.updatePage({ ...escopo, pageId: criada.id, lockVersion: criada.lockVersion, editorState: { ...criada.editorState, root: { title: 'Nova oferta' } }, renderedHtml: '<p>forjado</p>' });
  assert.match(editada.renderedHtml, /<title>Nova oferta<\/title>/);

  await content.publishPage({ ...escopo, pageId: editada.id, lockVersion: editada.lockVersion });
  const versao = (await database.query('SELECT id, capture_schema FROM page_versions WHERE page_id = $1', [editada.id])).rows[0];
  const captura = versao.capture_schema.forms[0];
  assert.deepEqual(captura.fields.map((campo) => campo.id), ['nome', 'email', 'whatsapp']);

  const lead = await content.submitPublishedPageCapture({
    companyId: empresa.id, projectId: projeto.id, pageId: editada.id, pageVersionId: versao.id, captureId: captura.captureId,
    input: { answers: { nome: 'Ana', email: 'ana@exemplo.test', whatsapp: '11987654321' } }, origin: 'https://lp.exemplo.test',
  });
  assert.match(lead.eventId, UUID);
});

test('a landing nova já nasce capturando lead', () => {
  const estado = normalizarEstadoAlva(paginaInicial('Minha oferta'));
  assert.equal(estado.root.title, 'Minha oferta');
  assert.deepEqual(capturasDoEstado(estado).forms[0].fields.map((campo) => campo.id), ['nome', 'email', 'whatsapp']);
  assert.match(documentoDaPagina(estado), /<a href="#contato" class="cta">/);
});

// O editor (Puck) quebra com item sem id, e os sinais por bloco vão precisar dela.
test('todo nó ganha identidade estável e única', () => {
  const estado = normalizarEstadoAlva(paginaInicial('x'));
  const ids = [];
  const coletar = (nos) => nos.forEach((no) => { ids.push(no.id); coletar(no.children); });
  coletar(estado.content);
  assert.ok(ids.every(Boolean));
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(normalizarEstadoAlva(estado), estado, 'normalizar de novo não muda nada');
});
