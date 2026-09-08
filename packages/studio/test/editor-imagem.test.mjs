import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { imageAlignmentStyle } from '../public/editor-shell.js';

test('alinhar a imagem é margem, não texto: cada opção tem seu par de margens', () => {
  assert.deepEqual(imageAlignmentStyle('left'), { display: 'block', 'margin-left': '0', 'margin-right': 'auto' });
  assert.deepEqual(imageAlignmentStyle('center'), { display: 'block', 'margin-left': 'auto', 'margin-right': 'auto' });
  assert.deepEqual(imageAlignmentStyle('right'), { display: 'block', 'margin-left': 'auto', 'margin-right': '0' });
  assert.deepEqual(imageAlignmentStyle('qualquer'), imageAlignmentStyle('left'), 'valor desconhecido volta ao começo');
});

test('escolher a imagem vem antes do endereço, que é a saída técnica', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  const bloco = fonte.slice(fonte.indexOf("const upload = field(content, 'Escolher imagem"), fonte.indexOf("const upload = field(content, 'Escolher imagem") + 200);
  assert.ok(bloco.length > 0, 'o upload continua existindo');
  const posUpload = fonte.indexOf("'Escolher imagem do computador'");
  const posEndereco = fonte.indexOf("'Endereço da imagem (opcional)'");
  assert.ok(posUpload < posEndereco, 'subir o arquivo aparece primeiro');
});

test('o inspetor da imagem tem alinhamento', async () => {
  const fonte = await readFile(new URL('../public/editor-shell.js', import.meta.url), 'utf8');
  assert.match(fonte, /Alinhamento da imagem/);
  assert.match(fonte, /imageAlignmentStyle/);
});
