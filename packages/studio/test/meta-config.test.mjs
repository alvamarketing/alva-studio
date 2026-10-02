import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VERSAO_DA_GRAPH_API, URL_DO_DIALOGO, ESCOPOS, CAMINHO_DO_RETORNO, lerConfiguracaoDaMeta, tokenInvalido, faltaPermissao,
} from '../server/meta-config.mjs';
import { VERSAO_DA_GRAPH_API as VERSAO_REEXPORTADA } from '../server/tracking-destinos.mjs';

test('a versão da Graph API mora num lugar só e o rastreamento a reexporta', () => {
  assert.match(VERSAO_DA_GRAPH_API, /^v\d+\.\d+$/);
  assert.equal(VERSAO_REEXPORTADA, VERSAO_DA_GRAPH_API);
  assert.equal(URL_DO_DIALOGO, `https://www.facebook.com/${VERSAO_DA_GRAPH_API}/dialog/oauth`);
  assert.deepEqual([...ESCOPOS].sort(), ['ads_management', 'ads_read', 'business_management', 'pages_read_engagement', 'pages_show_list']);
});

test('sem META_APP_ID ou META_APP_SECRET o recurso fica desligado', () => {
  assert.equal(lerConfiguracaoDaMeta({}), null);
  assert.equal(lerConfiguracaoDaMeta({ META_APP_ID: '123' }), null);
  assert.equal(lerConfiguracaoDaMeta({ META_APP_SECRET: 'segredo' }), null);
  assert.equal(lerConfiguracaoDaMeta({ META_APP_ID: '  ', META_APP_SECRET: 'segredo' }), null);
});

test('com app id e segredo a configuração sai completa, com token de usuário por padrão', () => {
  const config = lerConfiguracaoDaMeta({ META_APP_ID: '123456', META_APP_SECRET: 'segredo-do-app' }, { publicOrigin: 'https://studio.alva.test' });
  assert.equal(config.appId, '123456');
  assert.equal(config.appSecret, 'segredo-do-app');
  assert.equal(config.tipoDeToken, 'user');
  assert.equal(config.configId, null);
  assert.equal(config.redirecionamento(), `https://studio.alva.test${CAMINHO_DO_RETORNO}`);
  assert.equal(CAMINHO_DO_RETORNO, '/conexoes/meta/retorno');
});

test('o redirect sempre deriva de PUBLIC_ORIGIN quando ela existe; sem ela, da origem da requisição', () => {
  const comOrigem = lerConfiguracaoDaMeta({ META_APP_ID: '1', META_APP_SECRET: 's' }, { publicOrigin: 'https://studio.alva.test' });
  assert.equal(comOrigem.redirecionamento('http://127.0.0.1:9999'), 'https://studio.alva.test/conexoes/meta/retorno');
  const local = lerConfiguracaoDaMeta({ META_APP_ID: '1', META_APP_SECRET: 's' });
  assert.equal(local.redirecionamento('http://127.0.0.1:9999'), 'http://127.0.0.1:9999/conexoes/meta/retorno');
});

test('tipo de token e configuration id vêm do ambiente; valor desconhecido é recusado', () => {
  const config = lerConfiguracaoDaMeta({ META_APP_ID: '1', META_APP_SECRET: 's', META_TOKEN_TYPE: 'system_user', META_LOGIN_CONFIG_ID: '987' });
  assert.equal(config.tipoDeToken, 'system_user');
  assert.equal(config.configId, '987');
  assert.throws(() => lerConfiguracaoDaMeta({ META_APP_ID: '1', META_APP_SECRET: 's', META_TOKEN_TYPE: 'pagina' }), /META_TOKEN_TYPE/);
  assert.throws(() => lerConfiguracaoDaMeta({ META_APP_ID: 'abc', META_APP_SECRET: 's' }), /META_APP_ID/);
  assert.throws(() => lerConfiguracaoDaMeta({ META_APP_ID: '1', META_APP_SECRET: 's', META_LOGIN_CONFIG_ID: 'x y' }), /META_LOGIN_CONFIG_ID/);
});

test('códigos de token inválido e de permissão ficam na configuração', () => {
  assert.equal(tokenInvalido({ code: 190 }), true);
  assert.equal(tokenInvalido({ code: 190, subcode: 463 }), true);
  assert.equal(tokenInvalido({ code: 102 }), true);
  assert.equal(tokenInvalido({ code: 100 }), false);
  assert.equal(faltaPermissao({ code: 10 }), true);
  assert.equal(faltaPermissao({ code: 200 }), true);
  assert.equal(faltaPermissao({ code: 299 }), true);
  assert.equal(faltaPermissao({ code: 300 }), false);
});

test('a configuração nunca mostra o segredo ao virar texto', () => {
  const config = lerConfiguracaoDaMeta({ META_APP_ID: '1', META_APP_SECRET: 'segredo-que-nao-aparece' });
  assert.doesNotMatch(JSON.stringify(config), /segredo-que-nao-aparece/);
  assert.doesNotMatch(String(config), /segredo-que-nao-aparece/);
});
