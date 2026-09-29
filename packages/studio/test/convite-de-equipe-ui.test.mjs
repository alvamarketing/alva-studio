// A interface do convite: o formulário na aba "Equipe e acessos" e a tela que quem recebe o
// link abre para criar a conta. Sem servidor de e-mail, o link é mostrado para quem convida
// copiar e enviar — o mesmo caminho que o n8n oferece quando não há SMTP configurado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { formularioDeConvite, textoDoConvite } from '../public/equipe-ui.js';

test('o convite pede e-mail e papel, e só esses papéis', () => {
  const { window } = new JSDOM('<div id="alvo"></div>');
  const doc = window.document;
  const bloco = formularioDeConvite(doc, { convidar: async () => ({}) });
  doc.querySelector('#alvo').append(bloco);
  assert.ok(bloco.querySelector('input[type="email"][name="email"]'));
  const papeis = [...bloco.querySelectorAll('select[name="role"] option')].map((o) => o.value);
  assert.deepEqual(papeis, ['editor', 'analyst', 'admin']);
  window.close();
});

test('depois de convidar, o link aparece para copiar e enviar', async () => {
  const { window } = new JSDOM('<div id="alvo"></div>');
  globalThis.navigator ??= {};
  const doc = window.document;
  const pedidos = [];
  const bloco = formularioDeConvite(doc, {
    convidar: async (dados) => { pedidos.push(dados); return { email: dados.email, link: 'https://studio.test/convite?codigo=abc' }; },
  });
  doc.querySelector('#alvo').append(bloco);
  bloco.querySelector('input[name="email"]').value = 'pessoa@empresa.test';
  bloco.querySelector('select[name="role"]').value = 'admin';
  await bloco.aoEnviar(new window.Event('submit'));
  assert.deepEqual(pedidos, [{ email: 'pessoa@empresa.test', role: 'admin' }]);
  const link = bloco.querySelector('.convite-link');
  assert.equal(link.value, 'https://studio.test/convite?codigo=abc');
  assert.match(bloco.textContent, /pessoa@empresa\.test/);
  window.close();
});

test('erro do servidor aparece na tela, não no console', async () => {
  const { window } = new JSDOM('<div id="alvo"></div>');
  const doc = window.document;
  const bloco = formularioDeConvite(doc, { convidar: async () => { throw new Error('Este e-mail já participa da empresa.'); } });
  doc.querySelector('#alvo').append(bloco);
  bloco.querySelector('input[name="email"]').value = 'repetido@empresa.test';
  await bloco.aoEnviar(new window.Event('submit'));
  assert.match(bloco.querySelector('.form-error').textContent, /já participa/);
  window.close();
});

test('a tela do convite diz para quem ele é e pede nome e senha', () => {
  assert.deepEqual(textoDoConvite({ email: 'novo@empresa.test', companyName: 'Alva', role: 'editor' }), {
    titulo: 'Você foi convidado para a Alva',
    descricao: 'Crie sua senha para entrar como editor com o e-mail novo@empresa.test.',
  });
  assert.match(textoDoConvite({ email: 'a@b.c', companyName: 'X', role: 'analyst' }).descricao, /analista/);
});

test('a página do convite existe e é servida', async () => {
  const html = await readFile(new URL('../public/convite.html', import.meta.url), 'utf8');
  assert.match(html, /name="password"/);
  assert.match(html, /name="name"/);
  const index = await readFile(new URL('../server/index.mjs', import.meta.url), 'utf8');
  assert.match(index, /'\/convite': \['public\/convite\.html', 'text\/html'\]/);
});

test('a aba Equipe monta o convite e some o aviso que prometia convites para depois', async () => {
  const owner = await readFile(new URL('../public/owner.js', import.meta.url), 'utf8');
  assert.doesNotMatch(owner, /Convites estarão disponíveis quando a gestão de equipe/);
  assert.match(owner, /formularioDeConvite\(document/);
  assert.match(owner, /\/companies\/\$\{empresaAtual\(\)\}\/invitations/);
  assert.match(owner, /session\?\.currentCompanyId/, 'a empresa vem do que a sessão devolve');
});
