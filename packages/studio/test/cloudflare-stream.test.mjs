import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CloudflareStream } from '../server/cloudflare-stream.mjs';

// O vídeo vai do navegador direto para a Cloudflare: o Studio só pede o endereço de
// envio e depois pergunta se já ficou pronto. Assim nosso servidor nunca toca no
// arquivo — sem limite de upload, sem disco, sem fila de conversão.

const resposta = (status, corpo) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => corpo,
});

const cliente = (respostas) => {
  const chamadas = [];
  const stream = new CloudflareStream({
    accountId: 'conta-1',
    apiToken: 'token-1',
    fetcher: async (url, opcoes) => {
      chamadas.push({ url: String(url), method: opcoes?.method || 'GET', corpo: opcoes?.body ? JSON.parse(opcoes.body) : null, headers: opcoes?.headers });
      return respostas.shift() ?? resposta(404, { success: false, errors: [{ message: 'sem resposta preparada' }] });
    },
  });
  return { stream, chamadas };
};

test('pedir o envio devolve endereço e identificador do vídeo', async () => {
  const { stream, chamadas } = cliente([
    resposta(200, { success: true, result: { uploadURL: 'https://upload.videodelivery.net/abc', uid: 'abc' } }),
  ]);
  const envio = await stream.criarEnvioDireto({ duracaoMaximaSegundos: 3600, nome: 'Minha VSL' });
  assert.equal(envio.uploadUrl, 'https://upload.videodelivery.net/abc');
  assert.equal(envio.uid, 'abc');
  assert.match(chamadas[0].url, /accounts\/conta-1\/stream\/direct_upload$/);
  assert.equal(chamadas[0].method, 'POST');
  assert.equal(chamadas[0].corpo.maxDurationSeconds, 3600);
});

test('o token vai no cabeçalho, nunca na URL', async () => {
  const { stream, chamadas } = cliente([resposta(200, { success: true, result: { uploadURL: 'u', uid: 'a' } })]);
  await stream.criarEnvioDireto({ duracaoMaximaSegundos: 60 });
  assert.match(chamadas[0].headers.Authorization, /^Bearer token-1$/);
  assert.doesNotMatch(chamadas[0].url, /token-1/, 'token em URL vaza em log de servidor e histórico');
});

test('o vídeo em conversão ainda não tem endereço de reprodução', async () => {
  const { stream } = cliente([
    resposta(200, { success: true, result: { uid: 'abc', readyToStream: false, status: { state: 'inprogress' }, duration: -1 } }),
  ]);
  const situacao = await stream.consultar('abc');
  assert.equal(situacao.pronto, false);
  assert.equal(situacao.estado, 'inprogress');
  assert.equal(situacao.hlsUrl, '');
});

test('o vídeo pronto entrega o endereço, a miniatura e a duração', async () => {
  const { stream } = cliente([
    resposta(200, {
      success: true,
      result: {
        uid: 'abc', readyToStream: true, status: { state: 'ready' }, duration: 612.4,
        playback: { hls: 'https://customer-x.cloudflarestream.com/abc/manifest/video.m3u8' },
        thumbnail: 'https://customer-x.cloudflarestream.com/abc/thumbnails/thumbnail.jpg',
      },
    }),
  ]);
  const situacao = await stream.consultar('abc');
  assert.equal(situacao.pronto, true);
  assert.equal(situacao.hlsUrl, 'https://customer-x.cloudflarestream.com/abc/manifest/video.m3u8');
  assert.equal(situacao.miniaturaUrl, 'https://customer-x.cloudflarestream.com/abc/thumbnails/thumbnail.jpg');
  assert.equal(situacao.duracaoSegundos, 612);
});

test('a conversão que falhou é dita, não devolvida como "ainda processando"', async () => {
  const { stream } = cliente([
    resposta(200, { success: true, result: { uid: 'abc', readyToStream: false, status: { state: 'error', errorReasonText: 'Arquivo corrompido' } } }),
  ]);
  const situacao = await stream.consultar('abc');
  assert.equal(situacao.estado, 'error');
  assert.equal(situacao.falhou, true);
  assert.match(situacao.motivo, /corrompido/);
});

test('erro da Cloudflare vira mensagem legível, não um objeto cru', async () => {
  const { stream } = cliente([resposta(403, { success: false, errors: [{ message: 'Authentication error' }] })]);
  await assert.rejects(() => stream.criarEnvioDireto({ duracaoMaximaSegundos: 60 }), /Cloudflare/);
});

test('sem credencial configurada, a recusa acontece aqui e não lá', async () => {
  const semConta = new CloudflareStream({ accountId: '', apiToken: 'x', fetcher: async () => resposta(200, {}) });
  await assert.rejects(() => semConta.criarEnvioDireto({ duracaoMaximaSegundos: 60 }), /Cloudflare/i);
  assert.equal(new CloudflareStream({ accountId: 'a', apiToken: 'b' }).configurado, true);
  assert.equal(new CloudflareStream({}).configurado, false);
});

test('só o dono do vídeo pode restringir onde ele toca', async () => {
  const { stream, chamadas } = cliente([resposta(200, { success: true, result: { uid: 'abc' } })]);
  await stream.restringirOrigens('abc', ['minhaempresa.com.br']);
  assert.equal(chamadas[0].method, 'POST');
  assert.deepEqual(chamadas[0].corpo.allowedOrigins, ['minhaempresa.com.br']);
});

test('as rotas de envio exigem permissão de escrever vídeo', async () => {
  const { readFile } = await import('node:fs/promises');
  const fonte = await readFile(new URL('../server/project-api.mjs', import.meta.url), 'utf8');
  const bloco = fonte.slice(fonte.indexOf('const envioDeVideo'), fonte.indexOf('const video = path.match'));
  assert.match(bloco, /authorize\(context, 'video\.write', projectId\)/);
  assert.match(bloco, /videoHosting\?\.configurado/, 'sem credencial a recusa é clara, não um erro da Cloudflare');
  assert.doesNotMatch(bloco, /req\.pipe|formidable|multipart/, 'o arquivo não passa pelo nosso servidor');
});

test('a hospedagem sai do ambiente, para configurar na VPS sem tocar em código', async () => {
  const { readFile } = await import('node:fs/promises');
  const fonte = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8');
  assert.match(fonte, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(fonte, /CLOUDFLARE_STREAM_TOKEN/);
  assert.match(fonte, /runtimeFlags\.mediaPipeline[\s\S]{0,120}new CloudflareStream/, 'desligada junto com o resto da mídia');
});
