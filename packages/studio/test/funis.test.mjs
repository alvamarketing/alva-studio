// A aba Funis: o desenho, a validação e as páginas que cada etapa cria.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destinosDaEtapa, grafoDoModelo, normalizarGrafo } from '../public/funil.js';
import { modelosDeFunil } from '../public/funis-modelos.js';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
import { FunnelRepository } from '../server/repositories/funnel-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

const tripwire = modelosDeFunil.find((modelo) => modelo.id === 'funil-tripwire-slo');

test('o desenho recusa id repetido, larga seta solta e tipo desconhecido vira nota', () => {
  assert.throws(() => normalizarGrafo({ nos: [{ id: 'a' }, { id: 'a' }] }), /repetido/);
  const grafo = normalizarGrafo({ nos: [{ id: 'a', k: 'pagina' }, { id: 'b', k: 'inventado', link: 'javascript:alert(1)' }], setas: [{ de: 'a', para: 'b' }, { de: 'a', para: 'z' }] });
  assert.equal(grafo.nos[1].k, 'nota');
  assert.equal(grafo.nos[1].link, undefined, 'link só https, mailto ou tel');
  assert.equal(grafo.setas.length, 1);
});

test('no upsell, o "sim" segue em frente e o "não" vai para o downsell', () => {
  const grafo = grafoDoModelo(tripwire);
  const upsell = grafo.nos.find((no) => no.k === 'upsellpg');
  const rotas = { upsellpg: '/upsell', downsell: '/downsell', obrigado: '/obrigado' };
  const destinos = destinosDaEtapa(grafo, upsell.id, (no) => rotas[no.k]);
  assert.equal(destinos.alternativa, '/downsell');
  assert.notEqual(destinos.proxima, '/downsell');
});

test('funil do modelo Tripwire: cria as páginas ligadas, uma vez só', { timeout: 60_000 }, async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  t.after(() => database.close());
  const dono = (await database.query("INSERT INTO users (email,password_hash,display_name) VALUES ('fn@alva.test','hash','Dono') RETURNING id")).rows[0];
  const empresa = (await database.query("INSERT INTO companies (name,slug) VALUES ('Agência','agencia') RETURNING id")).rows[0];
  const projeto = (await database.query("INSERT INTO projects (company_id,name,slug,created_by) VALUES ($1,'Projeto','projeto',$2) RETURNING id", [empresa.id, dono.id])).rows[0];
  await database.query("INSERT INTO company_memberships (company_id,user_id,role,joined_at) VALUES ($1,$2,'owner',now())", [empresa.id, dono.id]);
  const escopo = { companyId: empresa.id, projectId: projeto.id, actorId: dono.id };
  const content = new ContentRepository(database, { publicOrigin: 'https://studio.example.test' });
  const funis = new FunnelRepository(database, { content });

  const funil = await funis.criar({ ...escopo, name: 'Ebook de receitas', modelId: tripwire.id });
  assert.equal(funil.name, 'Ebook de receitas');
  assert.equal(funil.graph.nos.length, tripwire.nos.length);

  const { funnel, criadas } = await funis.criarPaginas({ ...escopo, funnelId: funil.id });
  const paginasDoModelo = funil.graph.nos.filter((no) => ['pagina', 'upsellpg', 'downsell', 'obrigado'].includes(no.k));
  assert.equal(criadas.length, paginasDoModelo.length);
  assert.ok(funnel.graph.nos.filter((no) => no.pageId).length === criadas.length, 'cada etapa guarda a página criada');
  assert.ok(criadas.every((pagina) => pagina.route.startsWith('/ebook-de-receitas-')));

  // O "não, obrigado" do upsell aponta para a página do downsell que acabou de nascer.
  const upsell = criadas.find((pagina) => funnel.graph.nos.find((no) => no.id === pagina.etapaId).k === 'upsellpg');
  const downsell = criadas.find((pagina) => funnel.graph.nos.find((no) => no.id === pagina.etapaId).k === 'downsell');
  const html = (await database.query('SELECT rendered_html FROM pages WHERE id = $1', [upsell.pageId])).rows[0].rendered_html;
  assert.match(html, new RegExp(`<a href="${downsell.route}" class="cta"[^>]*>Não, obrigado</a>`));

  const denovo = await funis.criarPaginas({ ...escopo, funnelId: funil.id });
  assert.equal(denovo.criadas.length, 0, 'etapa que já tem página não cria outra');

  await assert.rejects(funis.salvar({ ...escopo, funnelId: funil.id, revision: funil.revision, name: 'x', graph: funnel.graph }), /outra aba/);
  const salvo = await funis.salvar({ ...escopo, funnelId: funil.id, revision: funnel.revision, name: 'Ebook (v2)', graph: funnel.graph });
  assert.equal(salvo.name, 'Ebook (v2)');
  assert.equal((await funis.listar(escopo)).length, 1);
});

test('organizar põe cada etapa na coluna da sua distância desde o começo, e laço não empurra', async () => {
  const { organizarGrafo, ESPACO_ENTRE_COLUNAS } = await import('../public/funil.js');
  const grafo = normalizarGrafo({
    nos: [{ id: 'a', k: 'meta', x: 900, y: 40 }, { id: 'b', k: 'pagina', x: 10, y: 500 }, { id: 'c', k: 'checkout', x: 333, y: 7 }, { id: 'd', k: 'upsellpg', x: 5, y: 5 }, { id: 'e', k: 'downsell', x: 5, y: 5 }],
    setas: [{ de: 'a', para: 'b' }, { de: 'b', para: 'c' }, { de: 'c', para: 'd' }, { de: 'c', para: 'e' }, { de: 'e', para: 'b', rotulo: 'volta' }],
  });
  const organizado = organizarGrafo(grafo);
  const x = Object.fromEntries(organizado.nos.map((no) => [no.id, no.x / ESPACO_ENTRE_COLUNAS]));
  assert.deepEqual(x, { a: 0, b: 1, c: 2, d: 3, e: 3 });
  const y = Object.fromEntries(organizado.nos.map((no) => [no.id, no.y]));
  assert.notEqual(y.d, y.e, 'duas etapas na mesma coluna não se sobrepõem');
  assert.equal(y.a, 0, 'coluna de uma etapa fica centralizada');
});

test('todo modelo da galeria organiza sem sobrepor etapas', async () => {
  const { organizarGrafo } = await import('../public/funil.js');
  for (const modelo of modelosDeFunil) {
    const posicoes = organizarGrafo(grafoDoModelo(modelo)).nos.map((no) => `${no.x},${no.y}`);
    assert.equal(new Set(posicoes).size, posicoes.length, modelo.nome);
  }
});
