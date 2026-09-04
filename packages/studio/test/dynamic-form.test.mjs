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

test('renderiza mídia, múltipla escolha, escala, arquivo, CTA, gráfico, ícones e movimento', () => {
  const rich = structuredClone(form);
  rich.steps = [
    { id: 'interesses', type: 'multiple_choice', title: 'Interesses', description: '', required: true, options: ['Sites', 'Anúncios'], icon: 'task_alt', motion: 'slide-left' },
    { id: 'escala', type: 'scale', title: 'Nota', description: '', required: false, range: { min: 1, max: 5 }, icon: 'star', motion: 'zoom-in' },
    { id: 'arquivo', type: 'file', title: 'Anexe', description: '', required: false, placeholder: '', icon: 'cloud_upload', motion: 'fade-up' },
    { id: 'imagem', type: 'image', title: 'Uma imagem', description: '', required: false, mediaUrl: 'https://example.com/a.jpg', icon: 'image', motion: 'float' },
    { id: 'grafico', type: 'chart', title: 'Resultados', description: '', required: false, chart: { type: 'bar', labels: ['A', 'B'], values: [25, 75] }, icon: 'analytics', motion: 'fade-up' },
    { id: 'acao', type: 'cta', title: 'Vamos?', description: '', required: false, buttonLabel: 'Conversar', buttonUrl: 'https://example.com', icon: 'arrow_forward', motion: 'fade-up' },
  ];
  const html = renderDynamicForm(rich, '/api/public/forms/123/submit');
  assert.match(html, /Material\+Symbols\+Outlined/);
  assert.match(html, /data-motion="slide-left"/);
  assert.match(html, /type="checkbox" name="interesses"/);
  assert.match(html, /type="range"/);
  assert.match(html, /type="file"/);
  assert.match(html, /class="step-media"/);
  assert.match(html, /class="chart chart-bar"/);
  assert.match(html, /href="https:\/\/example.com"/);
  assert.match(html, /prefers-reduced-motion/);
});
