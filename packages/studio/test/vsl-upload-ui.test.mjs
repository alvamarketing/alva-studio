import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { estadoDoEnvio, mensagemDoEnvio } from '../public/vsl-upload.js';

// Enviar um vídeo leva tempo: sobe o arquivo, a Cloudflare converte, e só então há
// endereço para tocar. Sem mostrar em que etapa está, a tela parece travada e a pessoa
// recarrega no meio — perdendo o envio.

test('cada etapa do envio tem um nome que a pessoa entende', () => {
  assert.equal(mensagemDoEnvio({ fase: 'ocioso' }), '');
  assert.match(mensagemDoEnvio({ fase: 'enviando', progresso: 42 }), /42%/);
  assert.match(mensagemDoEnvio({ fase: 'convertendo' }), /prepar|convert/i);
  assert.match(mensagemDoEnvio({ fase: 'pronto' }), /pronto|conclu/i);
  assert.match(mensagemDoEnvio({ fase: 'erro', motivo: 'Arquivo corrompido' }), /corrompido/);
});

test('a conversão que falhou não fica girando para sempre', () => {
  const estado = estadoDoEnvio({ pronto: false, falhou: true, motivo: 'Formato não suportado' });
  assert.equal(estado.fase, 'erro');
  assert.match(estado.motivo, /não suportado/);
  assert.equal(estado.continuarConsultando, false, 'insistir num vídeo que falhou é esperar para sempre');
});

test('enquanto converte, segue consultando', () => {
  const estado = estadoDoEnvio({ pronto: false, falhou: false, estado: 'inprogress' });
  assert.equal(estado.fase, 'convertendo');
  assert.equal(estado.continuarConsultando, true);
});

test('pronto entrega o endereço para gravar na VSL', () => {
  const estado = estadoDoEnvio({
    pronto: true, hlsUrl: 'https://c.cloudflarestream.com/a/manifest/video.m3u8',
    miniaturaUrl: 'https://c.cloudflarestream.com/a/thumbnails/thumbnail.jpg', duracaoSegundos: 600,
  });
  assert.equal(estado.fase, 'pronto');
  assert.equal(estado.continuarConsultando, false);
  assert.equal(estado.sourceUrl, 'https://c.cloudflarestream.com/a/manifest/video.m3u8');
  assert.equal(estado.sourceType, 'hls', 'o Stream entrega HLS, que é o que se ajusta à internet de quem assiste');
  assert.equal(estado.posterUrl, 'https://c.cloudflarestream.com/a/thumbnails/thumbnail.jpg');
});

test('a tela tem onde escolher o arquivo e mostrar o andamento', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="vsl-upload-input"/);
  assert.match(html, /id="vsl-upload-status"/);
  assert.match(html, /accept="video\//, 'escolher um PDF aqui só gera erro lá na frente');
});

test('o arquivo vai do navegador para a Cloudflare, sem escala no nosso servidor', async () => {
  const fonte = await readFile(new URL('../public/vsl-upload.js', import.meta.url), 'utf8');
  assert.match(fonte, /uploadUrl/);
  assert.doesNotMatch(fonte, /\/api\/.*videos.*body: *(arquivo|file|formData)/i, 'subir pelo nosso servidor limitaria o tamanho');
});

test('o formulário recebe o endereço quando a conversão termina', async () => {
  const fonte = await readFile(new URL('../public/vsl-ui.js', import.meta.url), 'utf8');
  const bloco = fonte.slice(fonte.indexOf('const ligarEnvioDeVideo'), fonte.indexOf('const showForm'));
  assert.match(bloco, /videos\/upload-url/);
  assert.match(bloco, /videos\/upload-status/);
  assert.match(bloco, /elements\.sourceUrl\.value = estado\.sourceUrl/, 'sem isto a pessoa envia e depois não sabe o que fazer');
  assert.match(bloco, /elements\.sourceType\.value = estado\.sourceType/);
});

test('a espera pela conversão tem fim', async () => {
  const fonte = await readFile(new URL('../public/vsl-ui.js', import.meta.url), 'utf8');
  const bloco = fonte.slice(fonte.indexOf('const ligarEnvioDeVideo'), fonte.indexOf('const showForm'));
  assert.match(bloco, /limite/, 'sem teto, um vídeo travado deixa a tela consultando para sempre');
  assert.match(bloco, /if \(!estado\.continuarConsultando\) break/);
});
