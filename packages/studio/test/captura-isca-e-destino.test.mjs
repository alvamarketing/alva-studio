// O formulário novo publicado, recebendo envio pelo gateway da Vercel: tipos novos de campo,
// isca contra robô e o que acontece depois do envio (mensagem própria ou outro endereço).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/index.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { ContentRepository } from '../server/repositories/content-repository.mjs';
import { PublicationRuntimeRepository } from '../server/repositories/publication-runtime-repository.mjs';
import { buildPublishableSnapshot } from '../server/publication-snapshot.mjs';
import { buildRuntimeManifest } from '../server/publication-runtime.mjs';
import { derivePublicationRuntimeKey, runtimeGatewayArtifacts } from '../server/vercel-runtime-gateway.mjs';
import { CAMPO_ISCA } from '../public/page-schema.js';
import { postgresFixture } from './postgres-fixture.mjs';
import { fetchAoStudio, gatewayPublicado } from './gateway-publicado.mjs';

const STUDIO = 'https://studio.example.test';
const DOMINIO = 'lp.isca.test';
const RAIZ = 'raiz-hmac-da-isca';
const COM_MENSAGEM = '11111111-1111-4111-8111-111111111111';
const COM_DESTINO = '22222222-2222-4222-8222-222222222222';
const no = (type, props, children = []) => ({ type, props, children });
const campos = () => [
  no('field', { label: 'Nome', name: 'nome', fieldType: 'text', required: true, largura: 'metade' }),
  no('field', { label: 'E-mail', name: 'email', fieldType: 'email', required: true, largura: 'metade' }),
  no('field', { label: 'Interesse', name: 'interesse', fieldType: 'select', required: true, opcoes: [{ rotulo: 'Sites' }, { rotulo: 'Tráfego' }] }),
  no('field', { label: 'Prefere', name: 'prefere', fieldType: 'radio', opcoes: [{ rotulo: 'WhatsApp' }, { rotulo: 'E-mail' }] }),
  no('field', { label: 'Aceito receber contato', name: 'aceito', fieldType: 'checkbox', required: true }),
];
const estado = {
  formato: 'alva/1',
  root: { title: 'Isca' },
  content: [
    no('section', { ancora: 'contato' }, [
      { id: COM_MENSAGEM, ...no('form', { submitLabel: 'Enviar', depoisDeEnviar: 'mensagem', mensagemDeSucesso: 'Valeu! Te chamamos hoje.' }, campos()) },
    ]),
    no('section', {}, [
      { id: COM_DESTINO, ...no('form', { submitLabel: 'Enviar', depoisDeEnviar: 'redirecionar', redirecionarPara: 'https://exemplo.test/obrigado' }, campos()) },
    ]),
  ],
};

test('formulário publicado: tipos novos, isca e depois do envio', { timeout: 60_000 }, async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const dono = (await database.query("INSERT INTO users (email,password_hash,display_name) VALUES ('isca@alva.test','hash','Dono') RETURNING id")).rows[0];
  const empresa = (await database.query("INSERT INTO companies (name,slug) VALUES ('Agência','agencia') RETURNING id")).rows[0];
  const projeto = (await database.query("INSERT INTO projects (company_id,name,slug,created_by) VALUES ($1,'Lançamento','lancamento',$2) RETURNING id", [empresa.id, dono.id])).rows[0];
  await database.query("INSERT INTO company_memberships (company_id,user_id,role,joined_at) VALUES ($1,$2,'owner',now())", [empresa.id, dono.id]);
  await database.query("INSERT INTO project_domains (company_id,project_id,environment,domain,is_canonical,verification_status) VALUES ($1,$2,'production',$3,true,'verified')", [empresa.id, projeto.id, DOMINIO]);
  const content = new ContentRepository(database, { publicOrigin: STUDIO });
  const escopo = { companyId: empresa.id, projectId: projeto.id, actorId: dono.id };
  const pagina = await content.createPage({ ...escopo, name: 'Isca', route: '/isca', editorState: estado });
  await content.publishPage({ ...escopo, pageId: pagina.id, lockVersion: pagina.lockVersion });

  const snapshot = await buildPublishableSnapshot({ database, companyId: empresa.id, projectId: projeto.id, publicOrigin: STUDIO, environment: 'production' });
  const publicationId = 'isca-e-destino';
  const artefato = runtimeGatewayArtifacts(snapshot.files, { publicationId, snapshotHash: snapshot.hash, environment: 'production', runtimeOrigin: STUDIO, runtimeHmacSecret: RAIZ, runtimeBootstrap: true });
  const html = artefato.files.find((arquivo) => arquivo.file === 'isca/index.html').data;
  assert.match(html, /<section class="alva-secao" id="contato"/);
  assert.equal(html.match(new RegExp(`name="${CAMPO_ISCA}"`, 'g')).length, 2);
  assert.match(html, /<select class="answer" name="interesse" required>/);
  assert.match(html, /type="checkbox" name="aceito" value="sim" required/);
  const acao = (id) => html.match(new RegExp(`<form class="alva-form" data-alva-capture-id="${id}"[^>]*action="([^"]+)"`))?.[1];

  const manifesto = buildRuntimeManifest({ publicationId, snapshotHash: snapshot.hash, origin: `https://${DOMINIO}`, domain: DOMINIO, environment: 'production', contents: snapshot.manifest.map(({ path, type, contentId, versionId, captureIds }) => ({ path, type, contentId, versionId, captureIds: captureIds || [] })) });
  await new PublicationRuntimeRepository(database).saveManifest({ companyId: empresa.id, projectId: projeto.id, manifest: manifesto });
  const app = createApp({ database, publicOrigin: STUDIO, runtimeFlags: { pixels: false, conversions: false }, runtimeHmacSecret: RAIZ });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise((resolve) => app.close(resolve)); await database.close(); });
  const chave = derivePublicationRuntimeKey(RAIZ, { publicationId, snapshotHash: manifesto.snapshotHash, environment: 'production' });
  const gateway = await gatewayPublicado({ artefato, dominio: DOMINIO, fetchImpl: fetchAoStudio(app.address().port), env: { PUBLICATION_RUNTIME_DERIVED_KEY: chave, ALVA_RUNTIME_PUBLICATION_ID: publicationId, ALVA_RUNTIME_ENVIRONMENT: 'production', ALVA_RUNTIME_GATEWAY_ORIGIN: STUDIO } });
  let ip = 10;
  const enviar = (id, corpo) => gateway({
    method: 'POST', path: acao(id),
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `https://${DOMINIO}`, 'x-real-ip': `189.68.172.${ip += 1}`, 'user-agent': 'Mozilla/5.0' },
    body: Buffer.from(new URLSearchParams(corpo).toString()),
  });
  const leads = async () => (await database.query('SELECT capture_id, answers FROM page_submissions ORDER BY submitted_at')).rows;
  const valido = { nome: 'Ana', email: 'ana@exemplo.test', interesse: 'Tráfego', prefere: 'WhatsApp', aceito: 'sim', [CAMPO_ISCA]: '' };

  // Robô: preencheu a isca. Responde como sucesso, e nada é gravado.
  const robo = await enviar(COM_MENSAGEM, { ...valido, [CAMPO_ISCA]: 'https://spam.test' });
  assert.equal(robo.status, 200, robo.text);
  assert.match(robo.text, /Valeu! Te chamamos hoje\./);
  assert.deepEqual(await leads(), []);

  // Gente: grava com a caixa de marcar como booleana e mostra a mensagem do formulário.
  const pessoa = await enviar(COM_MENSAGEM, valido);
  assert.equal(pessoa.status, 200, pessoa.text);
  assert.match(pessoa.text, /Valeu! Te chamamos hoje\./);
  assert.deepEqual(await leads(), [{ capture_id: COM_MENSAGEM, answers: { nome: 'Ana', email: 'ana@exemplo.test', interesse: 'Tráfego', prefere: 'WhatsApp', aceito: true } }]);

  // Opção que não existe na lista, ou caixa obrigatória sem marcar: recusado, nada gravado.
  assert.equal((await enviar(COM_MENSAGEM, { ...valido, nome: 'Bia', interesse: 'Hackear' })).status, 400);
  const { aceito: _aceito, ...semAceite } = valido;
  assert.equal((await enviar(COM_MENSAGEM, { ...semAceite, nome: 'Caio' })).status, 400);
  assert.equal((await leads()).length, 1);

  // Redirecionar: a página de obrigado leva ao endereço escolhido (não segue redirecionamento).
  const indo = await enviar(COM_DESTINO, { ...valido, nome: 'Duda' });
  assert.equal(indo.status, 200, indo.text);
  assert.match(indo.text, /<meta http-equiv="refresh" content="0;url=https:\/\/exemplo.test\/obrigado">/);
  assert.equal((await leads()).length, 2);
});
