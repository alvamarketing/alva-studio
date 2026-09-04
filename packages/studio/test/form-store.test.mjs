import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

test('normaliza os novos elementos, movimentos, ícones e dados de gráfico', async (t) => {
  const store = await setup(t);
  const form = await store.create({ name: 'Diagnóstico vivo' });
  const updated = await store.update(form.id, {
    revision: 0,
    steps: [
      { id: 'interesses', type: 'multiple_choice', title: 'Interesses', options: ['Sites', 'Tráfego'], required: true, icon: 'task_alt', motion: 'slide-left' },
      { id: 'nota', type: 'scale', title: 'Sua nota', min: 0, max: 5, icon: 'star', motion: 'zoom-in' },
      { id: 'grafico', type: 'chart', title: 'Seus resultados', chart: { type: 'bar', labels: ['Visitas', 'Leads'], values: [80, 45] }, icon: 'analytics', motion: 'float' },
      { id: 'video', type: 'video', title: 'Veja como funciona', mediaUrl: 'https://www.youtube.com/embed/abc123', icon: 'play_circle' },
      { id: 'acao', type: 'cta', title: 'Pronto para conversar?', buttonLabel: 'Falar agora', buttonUrl: 'https://example.com', icon: 'arrow_forward' },
    ],
  });
  assert.deepEqual(updated.steps[1].range, { min: 0, max: 5 });
  assert.deepEqual(updated.steps[2].chart.values, [80, 45]);
  assert.equal(updated.steps[0].motion, 'slide-left');
  assert.equal(updated.steps[4].buttonLabel, 'Falar agora');
  const submission = await store.submit(updated.id, { answers: { interesses: ['Sites', 'Tráfego'], nota: '4' } });
  assert.deepEqual(submission.answers.interesses, ['Sites', 'Tráfego']);
  assert.equal(submission.answers.nota, '4');
  assert.equal(submission.answers.grafico, '');
});

test('aceita arquivo permitido e rejeita conteúdo executável', async (t) => {
  const store = await setup(t);
  const form = await store.create({ name: 'Documentos' });
  const updated = await store.update(form.id, { revision: 0, steps: [{ id: 'arquivo', type: 'file', title: 'Seu arquivo', required: true }] });
  const saved = await store.submit(updated.id, { answers: { arquivo: { name: 'briefing.pdf', type: 'application/pdf', data: 'data:application/pdf;base64,SGVsbG8=' } } });
  assert.equal(saved.answers.arquivo.name, 'briefing.pdf');
  await assert.rejects(() => store.submit(updated.id, { answers: { arquivo: { name: 'ataque.html', type: 'text/html', data: 'data:text/html;base64,SGVsbG8=' } } }), /imagem, PDF ou documento/);
});

test('uma etapa pode combinar vários elementos e preserva formulários antigos', async (t) => {
  const store = await setup(t);
  const form = await store.create({ name: 'Diagnóstico composto' });
  const updated = await store.update(form.id, {
    revision: 0,
    steps: [{
      id: 'boas-vindas',
      title: 'Boas-vindas',
      motion: 'fade-up',
      elements: [
        { id: 'titulo', type: 'statement', title: 'Vamos começar?', description: 'Leva menos de um minuto.' },
        { id: 'nome', type: 'short_text', title: 'Seu nome', placeholder: 'Como podemos chamar você?', required: true },
        { id: 'contato', type: 'phone', title: 'WhatsApp', placeholder: 'DDD + número', required: true },
        { id: 'canal', type: 'single_choice', title: 'Como prefere conversar?', options: ['WhatsApp', 'E-mail'], required: true },
      ],
    }],
  });
  assert.equal(updated.steps[0].elements.length, 4);
  assert.equal(updated.steps[0].elements[2].type, 'phone');
  const submission = await store.submit(updated.id, { answers: { nome: 'Pessoa Teste', contato: '11900000000', canal: 'WhatsApp' } });
  assert.equal(submission.answers.nome, 'Pessoa Teste');
  assert.equal(submission.answers.canal, 'WhatsApp');
  assert.equal(submission.answers.titulo, '');
});

test('mantém uma camada fixa editável com logo, progresso, countdown e timer', async (t) => {
  const store = await setup(t);
  const form = await store.create({ name: 'Funil persistente' });
  assert.deepEqual(form.headerElements.map(({ type }) => type), ['logo', 'progress']);

  const updated = await store.update(form.id, {
    revision: form.revision,
    headerElements: [
      { id: 'marca', type: 'logo', title: 'Logo da campanha', mediaUrl: 'https://example.com/logo.svg', altText: 'Marca Exemplo', width: 144 },
      { id: 'andamento', type: 'progress', title: 'Seu progresso', showValue: true },
      { id: 'oferta', type: 'countdown', title: 'A oferta termina em', targetAt: '2030-12-31T23:59:59-03:00', duration: 3600, completionLabel: 'Oferta encerrada' },
      { id: 'tempo', type: 'timer', title: 'Tempo restante', durationSeconds: 90, timerDirection: 'down', autoStart: false },
    ],
  });

  assert.equal(updated.headerElements[0].mediaUrl, 'https://example.com/logo.svg');
  assert.equal(updated.headerElements[0].altText, 'Marca Exemplo');
  assert.equal(updated.headerElements[0].width, 144);
  assert.equal(updated.headerElements[1].showValue, true);
  assert.equal(updated.headerElements[2].targetAt, '2031-01-01T02:59:59.000Z');
  assert.equal(updated.headerElements[2].duration, 3600);
  assert.equal(updated.headerElements[2].completionLabel, 'Oferta encerrada');
  assert.equal(updated.headerElements[3].durationSeconds, 90);
  assert.equal(updated.headerElements[3].timerDirection, 'down');
  assert.equal(updated.headerElements[3].autoStart, false);

  const copy = await store.duplicate(updated.id);
  assert.deepEqual(copy.headerElements, updated.headerElements);
});

test('formulários antigos recebem camada fixa padrão sem perder as etapas', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'alva-forms-legacy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new FormStore(dir);
  const id = '11111111-1111-4111-8111-111111111111';
  await writeFile(join(dir, 'forms.json'), JSON.stringify([{
    id,
    name: 'Formulário antigo',
    slug: 'formulario-antigo',
    steps: [{ id: 'nome', type: 'short_text', title: 'Seu nome', required: true, options: [], range: { min: 1, max: 10 }, chart: { type: 'bar', labels: [], values: [] } }],
    completion: { title: 'Obrigado!', message: 'Recebemos suas respostas.' },
    webhook: '',
    revision: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }]));

  const legacy = await store.get(id);
  assert.deepEqual(legacy.headerElements.map(({ type }) => type), ['logo', 'progress']);
  assert.equal(legacy.steps[0].title, 'Seu nome');

  const updated = await store.update(id, { revision: 0, name: 'Formulário migrado' });
  assert.deepEqual(updated.headerElements.map(({ type }) => type), ['logo', 'progress']);
  assert.equal(updated.steps[0].title, 'Seu nome');
});

test('rejeita configurações inválidas da camada fixa', async (t) => {
  const store = await setup(t);
  const form = await store.create({ name: 'Validação do topo' });
  await assert.rejects(() => store.update(form.id, {
    revision: 0,
    headerElements: [{ id: 'relogio', type: 'timer', title: 'Tempo', durationSeconds: 0 }],
  }), /duração/i);
  await assert.rejects(() => store.update(form.id, {
    revision: 0,
    headerElements: [{ id: 'oferta', type: 'countdown', title: 'Oferta', targetAt: 'amanhã' }],
  }), /data final/i);
  await assert.rejects(() => store.update(form.id, {
    revision: 0,
    headerElements: [{ id: 'marca', type: 'short_text', title: 'Campo indevido' }],
  }), /camada fixa/i);
});
