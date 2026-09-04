import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDynamicForm } from '../server/dynamic-form.mjs';

const form = {
  id: '123',
  name: 'Diagnóstico <Comercial>',
  steps: [
    { id: 'nome', type: 'short_text', title: 'Qual seu nome?', description: 'Conte para nós', required: true, placeholder: 'Seu nome', options: [] },
    { id: 'perfil', type: 'single_choice', title: 'Qual perfil?', description: '', required: true, placeholder: '', options: ['Empresa', 'Profissional'] },
  ],
  completion: { title: 'Tudo certo!', message: 'Recebemos suas respostas.' },
};

test('gera experiência sequencial acessível e autocontida', () => {
  const html = renderDynamicForm(form, '/api/public/forms/123/submit');
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Diagnóstico &lt;Comercial&gt;/);
  assert.doesNotMatch(html, /Diagnóstico <Comercial>/);
  assert.match(html, /data-dynamic-form/);
  assert.match(html, /data-step="0"/);
  assert.match(html, /data-step="1"/);
  assert.match(html, /aria-label="Progresso do formulário"/);
  assert.match(html, /name="nome"/);
  assert.match(html, /name="perfil"/);
  assert.match(html, /value="Empresa"/);
  assert.match(html, /action="\/api\/public\/forms\/123\/submit"/);
  assert.match(html, /Tudo certo!/);
  assert.match(html, /function showStep/);
});

test('escapa conteúdo inserido pelo dono', () => {
  const unsafe = structuredClone(form);
  unsafe.steps[0].title = '<img src=x onerror=alert(1)>';
  unsafe.steps[1].options = ['<script>alert(1)</script>', 'Ok'];
  const html = renderDynamicForm(unsafe, 'https://studio.example/api/submit');
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
