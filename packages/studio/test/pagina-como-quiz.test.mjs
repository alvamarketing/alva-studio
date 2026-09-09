import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postgresFixture } from './postgres-fixture.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';

// Um quiz passa a ser uma página com uma marca. Mesmo editor, mesmos elementos, mesmo
// salvamento — o que muda é como ela é publicada e onde aparece na navegação.

async function palco(t) {
  const { connectionString } = await postgresFixture(t);
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const database = createDatabase({ connectionString });
  await migrate(database);
  t.after(() => database.close());
  const empresa = (await database.query(`INSERT INTO companies (name, slug) VALUES ('Alva','alva-kind') RETURNING id`)).rows[0].id;
  const dono = (await database.query(`INSERT INTO users (email, password_hash, display_name) VALUES ('k@alva.test','x','K') RETURNING id`)).rows[0].id;
  await database.query(`INSERT INTO company_memberships (company_id, user_id, role, status) VALUES ($1,$2,'owner','active')`, [empresa, dono]);
  const projeto = (await database.query(`INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1,'P','p-kind',$2) RETURNING id`, [empresa, dono])).rows[0].id;
  return { database, empresa, projeto, dono, content: new ContentRepository(database) };
}

test('página nasce como página, sem precisar dizer nada', async (t) => {
  const { content, empresa, projeto, dono } = await palco(t);
  const pagina = await content.createPage({ companyId: empresa, projectId: projeto, actorId: dono, name: 'LP', route: '/lp', editorState: {}, renderedHtml: '<main></main>' });
  assert.equal(pagina.kind, 'page');
});

test('a mesma criação faz um quiz quando pedida assim', async (t) => {
  const { content, empresa, projeto, dono } = await palco(t);
  const quiz = await content.createPage({ companyId: empresa, projectId: projeto, actorId: dono, name: 'Diagnóstico', route: '/diagnostico', editorState: {}, renderedHtml: '<main></main>', kind: 'quiz' });
  assert.equal(quiz.kind, 'quiz');
});

test('a marca sobrevive à releitura, que é o que a lista usa', async (t) => {
  const { content, empresa, projeto, dono } = await palco(t);
  const criado = await content.createPage({ companyId: empresa, projectId: projeto, actorId: dono, name: 'Q', route: '/q', editorState: {}, renderedHtml: '<main></main>', kind: 'quiz' });
  const relido = await content.getPage({ companyId: empresa, projectId: projeto, actorId: dono, pageId: criado.id });
  assert.equal(relido.kind, 'quiz');
  const lista = await content.listPages({ companyId: empresa, projectId: projeto, actorId: dono });
  assert.equal(lista.find((p) => p.id === criado.id).kind, 'quiz');
});

test('valor fora dos dois conhecidos é recusado, para a lista não ficar com órfãos', async (t) => {
  const { content, empresa, projeto, dono } = await palco(t);
  await assert.rejects(
    () => content.createPage({ companyId: empresa, projectId: projeto, actorId: dono, name: 'X', route: '/x', editorState: {}, renderedHtml: '<main></main>', kind: 'formulario' }),
    /tipo/i,
  );
});

// Acima o repositório; daqui para baixo o caminho que o navegador realmente percorre.
// A marca só serve se sobreviver ao POST e voltar na listagem — é dela que a tela de
// Quizzes decide o que mostrar.

async function palcoHttp(t) {
  const { connectionString } = await postgresFixture(t);
  const { createDatabase, migrate } = await import('../server/db/postgres.mjs');
  const { createApp } = await import('../server/index.mjs');
  const { scrypt: scryptCallback, randomBytes } = await import('node:crypto');
  const { promisify } = await import('node:util');
  const scrypt = promisify(scryptCallback);
  const database = createDatabase({ connectionString });
  await migrate(database);
  t.after(() => database.close());
  const salt = randomBytes(16).toString('hex');
  const senha = 'senha-de-teste-forte';
  const password_hash = JSON.stringify({ salt, hash: (await scrypt(senha, salt, 64)).toString('hex') });
  const dono = (await database.query(`INSERT INTO users (email, password_hash, display_name) VALUES ('http@alva.test',$1,'H') RETURNING id`, [password_hash])).rows[0].id;
  const empresa = (await database.query(`INSERT INTO companies (name, slug) VALUES ('Alva','alva-http') RETURNING id`)).rows[0].id;
  await database.query(`INSERT INTO company_memberships (company_id, user_id, role, joined_at) VALUES ($1,$2,'owner',now())`, [empresa, dono]);
  const projeto = (await database.query(`INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1,'P','p-http',$2) RETURNING id`, [empresa, dono])).rows[0].id;
  const servidor = createApp({ database, sessionOptions: { sessionTTL: 60_000 } });
  await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => servidor.close(resolve)));
  const base = `http://127.0.0.1:${servidor.address().port}`;
  let cookie = '';
  const pedir = async (caminho, method = 'GET', corpo) => {
    const resposta = await fetch(base + caminho, {
      method,
      headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
    if (resposta.headers.has('set-cookie')) cookie = resposta.headers.get('set-cookie').split(';')[0];
    return resposta;
  };
  await pedir('/api/login', 'POST', { email: 'http@alva.test', password: senha });
  return { pedir, projeto };
}

test('criar pela API com a marca devolve um quiz, e a listagem repete a marca', async (t) => {
  const { pedir, projeto } = await palcoHttp(t);
  const criacao = await pedir(`/api/projects/${projeto}/pages`, 'POST', {
    name: 'Diagnóstico', route: '/diagnostico', editorState: {}, renderedHtml: '<main></main>', kind: 'quiz',
  });
  const corpo = await criacao.text();
  assert.equal(criacao.status, 201, corpo);
  assert.equal(JSON.parse(corpo).kind, 'quiz');
  const lista = await (await pedir(`/api/projects/${projeto}/pages`)).json();
  assert.equal(lista[0].kind, 'quiz');
});

test('salvar um quiz não o rebaixa a página comum', async (t) => {
  const { pedir, projeto } = await palcoHttp(t);
  const quiz = await (await pedir(`/api/projects/${projeto}/pages`, 'POST', {
    name: 'Q', route: '/q', editorState: {}, renderedHtml: '<main></main>', kind: 'quiz',
  })).json();
  const salvo = await pedir(`/api/pages/${quiz.id}`, 'PUT', {
    lockVersion: quiz.lockVersion, renderedHtml: '<main>oi</main>',
  });
  const depois = await salvo.text();
  assert.equal(salvo.status, 200, depois);
  assert.equal(JSON.parse(depois).kind, 'quiz');
});

// O painel do projeto conta e lista o que existe. Se o quiz virasse só "mais uma página"
// ali, o cartão de Quizzes marcaria zero mesmo com quizzes montados.

test('o painel do projeto conta o quiz como quiz, não como página', async (t) => {
  const { content, empresa, projeto, dono, database } = await palco(t);
  const { ProjectRepository } = await import('../server/repositories/project-repository.mjs');
  await content.createPage({ companyId: empresa, projectId: projeto, actorId: dono, name: 'LP', route: '/lp', editorState: {}, renderedHtml: '<main></main>' });
  const quiz = await content.createPage({ companyId: empresa, projectId: projeto, actorId: dono, name: 'Diagnóstico', route: '/diagnostico', editorState: {}, renderedHtml: '<main></main>', kind: 'quiz' });
  const painel = await new ProjectRepository(database).overview({ companyId: empresa, projectId: projeto, userId: dono });
  assert.equal(painel.counts.pages, 1);
  assert.equal(painel.counts.forms, 1);
  assert.equal(painel.content.find((item) => item.id === quiz.id).kind, 'form');
});

test('o formulário do editor antigo não aparece mais no painel', async (t) => {
  const { content, empresa, projeto, dono, database } = await palco(t);
  const { ProjectRepository } = await import('../server/repositories/project-repository.mjs');
  const antigo = await content.createForm({ companyId: empresa, projectId: projeto, actorId: dono, name: 'Quiz antigo', route: '/antigo', draftSchema: {
    steps: [{ id: 'e1', type: 'short_text', title: 'Nome', required: true }],
    completion: { title: 'Obrigado!', message: 'Recebemos.' },
  } });
  const painel = await new ProjectRepository(database).overview({ companyId: empresa, projectId: projeto, userId: dono });
  assert.equal(painel.counts.forms, 0);
  assert.equal(painel.content.some((item) => item.id === antigo.id), false);
});
