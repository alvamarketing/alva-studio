import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FormStore } from '../server/form-store.mjs';

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'alva-forms-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return new FormStore(dir);
}

test('cria, lista, edita, duplica e exclui formulários isolados', async (t) => {
  const store = await setup(t);
  const form = await store.create({ name: 'Diagnóstico Comercial' });
  assert.equal(form.name, 'Diagnóstico Comercial');
  assert.match(form.slug, /^diagnostico-comercial-/);
  assert.equal(form.steps.length, 1);

  const updated = await store.update(form.id, {
    revision: 0,
    name: 'Diagnóstico de Vendas',
    webhook: 'https://example.com/hook',
    completion: { title: 'Tudo certo!', message: 'Vamos analisar suas respostas.' },
    steps: [
      { id: 'nome', type: 'short_text', title: 'Qual é o seu nome?', required: true, placeholder: 'Seu nome' },
      {
        id: 'momento',
        type: 'single_choice',
        title: 'Qual é o seu momento?',
        required: true,
        options: ['Começando', 'Já vendo', 'Quero escalar'],
      },
    ],
  });
  assert.equal(updated.revision, 1);
  assert.equal(updated.steps[1].options.length, 3);
  await assert.rejects(() => store.update(form.id, { revision: 0, name: 'Antigo' }), /outra aba/);

  const copy = await store.duplicate(form.id);
  assert.notEqual(copy.id, form.id);
  assert.equal(copy.name, 'Diagnóstico de Vendas — cópia');
  assert.equal(copy.webhook, '');
  assert.equal((await store.list()).length, 2);
  await store.remove(copy.id);
  assert.equal((await store.list()).length, 1);
});

test('valida schema e mantém apenas respostas previstas', async (t) => {
  const store = await setup(t);
  const form = await store.create({ name: 'Qualificação' });
  const updated = await store.update(form.id, {
    revision: 0,
    steps: [
      { id: 'email', type: 'email', title: 'Seu e-mail', required: true },
      { id: 'perfil', type: 'single_choice', title: 'Seu perfil', options: ['Empresa', 'Profissional'] },
    ],
  });
  await assert.rejects(
    () => store.submit(updated.id, { answers: { email: '', perfil: 'Empresa' } }),
    /Responda “Seu e-mail”/,
  );
  await assert.rejects(
    () => store.submit(updated.id, { answers: { email: 'a@b.com', perfil: 'Valor inválido' } }),
    /resposta válida/,
  );
  const submission = await store.submit(updated.id, {
    answers: { email: ' pessoa@example.com ', perfil: 'Empresa', administrador: 'ignorar' },
  });
  assert.deepEqual(submission.answers, { email: 'pessoa@example.com', perfil: 'Empresa' });
  assert.equal((await store.submissions(updated.id)).length, 1);
  await assert.rejects(
    () => store.update(updated.id, { revision: updated.revision, steps: [{ id: '__proto__', type: 'short_text', title: 'Campo' }] }),
    /Identificador/,
  );
});
