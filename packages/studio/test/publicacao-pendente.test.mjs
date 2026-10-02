// "Existem alterações que ainda não foram publicadas": o botão Publicar fica amarelo, como no
// RD Station. A página no ar só muda quando se publica de novo — o HTML publicado é o que foi
// gerado quando ela foi salva, e os pixels ficam gravados no momento da publicação.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
import { PublicationService } from '../server/publication-service.mjs';
import { pixelsDesatualizados } from '../server/publicacao-pendente.mjs';
import { estadoDoPublicar } from '../public/publicacao-pendente.js';
import { paginaInicial } from '../public/pagina-alva.js';
import { postgresFixture } from './postgres-fixture.mjs';

test('página: publicar zera o aviso, salvar de novo o acende, publicar outra vez o apaga', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  t.after(() => database.close());
  const dono = (await database.query("INSERT INTO users (email,password_hash,display_name) VALUES ('p@alva.test','hash','Dono') RETURNING id")).rows[0];
  const empresa = (await database.query("INSERT INTO companies (name,slug) VALUES ('Agência','agencia') RETURNING id")).rows[0];
  const projeto = (await database.query("INSERT INTO projects (company_id,name,slug,created_by) VALUES ($1,'Lançamento','lancamento',$2) RETURNING id", [empresa.id, dono.id])).rows[0];
  await database.query("INSERT INTO company_memberships (company_id,user_id,role,joined_at) VALUES ($1,$2,'owner',now())", [empresa.id, dono.id]);
  const content = new ContentRepository(database, { publicOrigin: 'https://studio.example.test' });
  const escopo = { companyId: empresa.id, projectId: projeto.id, actorId: dono.id };

  const rascunho = await content.createPage({ ...escopo, name: 'Oferta', route: '/oferta', editorState: paginaInicial('Oferta') });
  assert.equal(rascunho.unpublishedChanges, false, 'rascunho nunca publicado não tem "alteração não publicada": ele só não foi publicado');
  assert.equal(rascunho.publishedVersionId, null);

  await content.publishPage({ ...escopo, pageId: rascunho.id, lockVersion: rascunho.lockVersion });
  const publicada = await content.getPage({ ...escopo, pageId: rascunho.id });
  assert.equal(publicada.unpublishedChanges, false, 'recém-publicada está em dia');
  assert.equal(publicada.publishedLockVersion, publicada.lockVersion);

  const estado = JSON.parse(JSON.stringify(publicada.editorState));
  estado.root.title = 'Oferta nova';
  const salva = await content.updatePage({ ...escopo, pageId: rascunho.id, lockVersion: publicada.lockVersion, editorState: estado });
  assert.equal(salva.unpublishedChanges, true, 'salvou depois de publicar: o que está no ar já não é o que está salvo');
  assert.equal(salva.publishedVersionId, publicada.publishedVersionId, 'continua no ar com a versão antiga');

  await content.publishPage({ ...escopo, pageId: rascunho.id, lockVersion: salva.lockVersion });
  assert.equal((await content.getPage({ ...escopo, pageId: rascunho.id })).unpublishedChanges, false);
});

test('a migração faz as páginas que já estão no ar começarem em dia, sem acender o aviso em todas', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  t.after(() => database.close());
  const colunas = (await database.query("SELECT column_name FROM information_schema.columns WHERE table_name='pages' AND column_name='published_lock_version'")).rowCount;
  assert.equal(colunas, 1);
});

test('pixels: mudou o que está no ar, só publicando de novo vale', () => {
  const noAr = [{ provider: 'meta', id: '111' }, { provider: 'tiktok', id: 'ABC' }];
  assert.equal(pixelsDesatualizados(noAr, [{ provider: 'tiktok', id: 'ABC' }, { provider: 'meta', id: '111' }]), false, 'a ordem não importa');
  assert.equal(pixelsDesatualizados(noAr, [{ provider: 'meta', id: '222' }, { provider: 'tiktok', id: 'ABC' }]), true, 'trocou o id');
  assert.equal(pixelsDesatualizados(noAr, [...noAr, { provider: 'ga4', id: 'G-1234' }]), true, 'ligou um novo');
  assert.equal(pixelsDesatualizados(noAr, [{ provider: 'meta', id: '111' }]), true, 'desligou um');
  assert.equal(pixelsDesatualizados([], []), false);
  assert.equal(pixelsDesatualizados(null, [{ provider: 'meta', id: '1' }]), true);
});

test('o serviço de publicação avisa que os pixels mudaram depois da última publicação em produção', async () => {
  const fabricar = ({ manifesto, atuais, ligado = true }) => new PublicationService({
    runtimeEnabled: ligado,
    runtimeManifests: { current: async () => manifesto },
    tracking: { publicProviders: async () => atuais },
  });
  const escopo = { companyId: 'c', projectId: 'p' };
  const noAr = { providers: [{ provider: 'meta', id: '111' }] };
  assert.equal(await fabricar({ manifesto: noAr, atuais: [{ provider: 'meta', id: '111' }] }).pixelsPendentes(escopo), false);
  assert.equal(await fabricar({ manifesto: noAr, atuais: [{ provider: 'meta', id: '999' }] }).pixelsPendentes(escopo), true);
  assert.equal(await fabricar({ manifesto: null, atuais: [{ provider: 'meta', id: '999' }] }).pixelsPendentes(escopo), false, 'nada publicado em produção: não há o que desatualizar');
  assert.equal(await fabricar({ manifesto: noAr, atuais: [], ligado: false }).pixelsPendentes(escopo), false, 'sem o recurso de pixels ligado não há aviso');
});

test('botão Publicar: amarelo só quando há algo no ar que está desatualizado', () => {
  assert.deepEqual(estadoDoPublicar({ publicada: false, alteracoesNaoPublicadas: false, alteracoesNaoSalvas: false }), { pendente: false, rotulo: 'Publicar', dica: '' });
  assert.equal(estadoDoPublicar({ publicada: true, alteracoesNaoPublicadas: false, alteracoesNaoSalvas: false }).pendente, false);
  const salvaNaoPublicada = estadoDoPublicar({ publicada: true, alteracoesNaoPublicadas: true, alteracoesNaoSalvas: false });
  assert.equal(salvaNaoPublicada.pendente, true);
  assert.equal(salvaNaoPublicada.rotulo, 'Publicar alterações');
  assert.match(salvaNaoPublicada.dica, /no ar/);
  assert.match(salvaNaoPublicada.dica, /publicada/i);
  assert.equal(estadoDoPublicar({ publicada: true, alteracoesNaoPublicadas: false, alteracoesNaoSalvas: true }).pendente, true, 'o que ainda nem foi salvo também não está no ar');
  assert.equal(estadoDoPublicar({ publicada: false, alteracoesNaoPublicadas: true, alteracoesNaoSalvas: true }).pendente, false, 'página nunca publicada: nada no ar para desatualizar');
  const pixels = estadoDoPublicar({ publicada: true, alteracoesNaoPublicadas: false, alteracoesNaoSalvas: false, pixelsPendentes: true });
  assert.equal(pixels.pendente, true);
  assert.match(pixels.dica, /pixel/i);
});

import { readFile } from 'node:fs/promises';

test('o editor, a lista de páginas e a tela de Publicação usam o mesmo aviso amarelo', async () => {
  const editor = await readFile(new URL('../editor/main.jsx', import.meta.url), 'utf8');
  assert.match(editor, /estadoDoPublicar\(/);
  assert.match(editor, /alva-acao-pendente/);
  assert.match(editor, /unpublishedChanges/);
  // Depois de publicar o servidor é quem diz que está em dia: o editor relê a página.
  assert.match(editor, /setPagina\(await api\(`\/pages\//);
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /p\.unpublishedChanges/);
  assert.match(app, /pixelsPendentes === true/);
  const html = await readFile(new URL('../public/editor.html', import.meta.url), 'utf8');
  assert.match(html, /\.alva-acao-pendente \{[^}]*var\(--alva-warning-bg\)/);
});

test('o amarelo usa só os tokens de aviso que já existem', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  for (const seletor of ['.publication-pendente', '.badge.badge-pendente', ".publication-state[data-state='pending']"]) {
    const linha = css.split('\n').find((l) => l.startsWith(seletor));
    assert.ok(linha, `falta a regra de ${seletor}`);
    assert.match(linha, /var\(--alva-warning/);
    assert.doesNotMatch(linha, /#[0-9a-fA-F]{3,8}\b/, 'sem cor escrita à mão');
  }
});
