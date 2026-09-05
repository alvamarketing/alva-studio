import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { renderDynamicForm, renderCompletion } from '../server/dynamic-form.mjs';
import { normalizeFormInput } from '../server/form-store.mjs';
import { parseCollectPayload } from '../server/analytics-collect.mjs';

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

test('renderiza uma tela composta com campos, escolha visual e avanço automático configurável', () => {
  const composed = {
    ...form,
    steps: [{
      id: 'inicio',
      title: 'Começo',
      motion: 'zoom-in',
      autoAdvance: false,
      elements: [
        { id: 'headline', type: 'statement', title: 'Bem-vindo', description: 'Responda para começar.', icon: 'waving_hand' },
        { id: 'nome', type: 'short_text', title: 'Seu nome', placeholder: 'Digite seu nome', required: true },
        { id: 'perfil', type: 'image_choice', title: 'Escolha um perfil', required: true, options: [
          { label: 'Empresa', imageUrl: 'https://example.com/empresa.jpg', icon: 'business' },
          { label: 'Profissional', imageUrl: '', icon: 'person' },
        ] },
      ],
    }],
  };
  const html = renderDynamicForm(composed, '/api/public/forms/123/submit');
  assert.match(html, /data-screen="0"/);
  assert.match(html, /class="screen-elements"/);
  assert.match(html, /name="nome"/);
  assert.match(html, /name="perfil"/);
  assert.match(html, /choice-image/);
  assert.match(html, /empresa\.jpg/);
  assert.match(html, /data-auto-advance="false"/);
});

test('mantém um topo compartilhado e troca somente a microlanding de cada etapa', () => {
  const microLanding = {
    ...form,
    headerElements: [
      { id: 'marca', type: 'logo', title: 'Marca Exemplo', mediaUrl: 'https://example.com/logo.svg', altText: 'Marca da campanha', width: 144 },
      { id: 'contexto', type: 'statement', title: 'Diagnóstico personalizado', description: 'Descubra a melhor rota para você.' },
      { id: 'progresso', type: 'progress', title: 'Progresso', showValue: true },
      { id: 'oferta', type: 'countdown', title: 'Oferta termina em', duration: 3600, targetAt: '2030-12-31T23:59:59.000Z', completionLabel: 'Oferta encerrada' },
      { id: 'tempo', type: 'timer', title: 'Seu tempo', durationSeconds: 90, timerDirection: 'down', autoStart: false },
    ],
    steps: [
      {
        id: 'captura', title: 'Boas-vindas', elements: [
          { id: 'chamada', type: 'statement', title: 'Vamos começar?', description: 'Leva menos de um minuto.', icon: 'waving_hand' },
          { id: 'nome', type: 'short_text', title: 'Seu nome', placeholder: 'Digite seu nome', required: true },
          { id: 'telefone', type: 'phone', title: 'Telefone', placeholder: 'DDD + número', required: true },
        ],
      },
      {
        id: 'conteudo', title: 'Seu resultado', columns: 2, elements: [
          { id: 'video', type: 'video', title: 'Veja como funciona', mediaUrl: 'https://www.youtube.com/embed/abc' },
          { id: 'tempo', type: 'countdown', title: 'Condição disponível por', duration: 90, icon: 'timer' },
          { id: 'grafico', type: 'chart', title: 'Seu potencial', chart: { type: 'bar', labels: ['Agora', 'Meta'], values: [25, 80] } },
        ],
      },
    ],
  };
  const html = renderDynamicForm(microLanding, '/submit');
  assert.equal((html.match(/class="funnel-header"/g) || []).length, 1);
  assert.match(html, /class="funnel-logo" src="https:\/\/example\.com\/logo\.svg"/);
  assert.match(html, /alt="Marca da campanha" style="width:144px"/);
  assert.match(html, /Diagnóstico personalizado/);
  assert.equal((html.match(/role="progressbar"/g) || []).length, 1);
  assert.match(html, /class="progress-value">1\/2/);
  assert.match(html, /data-target-at="2030-12-31T23:59:59.000Z"/);
  assert.match(html, /data-auto-start="false"/);
  assert.match(html, /class="timer-toggle"/);
  assert.match(html, /data-screen="0"/);
  assert.match(html, /data-screen="1"/);
  assert.match(html, /data-columns="2"/);
  assert.match(html, /class="countdown" data-countdown="90"/);
  assert.match(html, /function startCountdowns/);
});

test('escolha única só avança automaticamente quando é a única entrada obrigatória da tela', () => {
  const composed = {
    ...form,
    steps: [
      { id: 'agrupada', autoAdvance: true, elements: [
        { id: 'nome', type: 'short_text', title: 'Nome', required: true },
        { id: 'perfil', type: 'single_choice', title: 'Perfil', required: true, options: ['A', 'B'] },
      ] },
      { id: 'so-escolha', autoAdvance: true, elements: [
        { id: 'objetivo', type: 'single_choice', title: 'Objetivo', required: true, options: ['C', 'D'] },
      ] },
    ],
  };
  const html = renderDynamicForm(composed, '/submit');
  assert.match(html, /function canAutoAdvance/);
  assert.match(html, /querySelectorAll\('\[data-answer\]'/);
});

test('normaliza VSL como referência pública mínima e migra etapa legada', () => {
  const normalized = normalizeFormInput({
    steps: [{
      id: 'vsl-legada', type: 'vsl', publicId: ' public-vsl-123 ', title: 'Assista à oferta',
      description: 'Veja a explicação antes de continuar.', motion: 'slide-left', advanceAfterCta: true,
    }],
  });
  assert.deepEqual(normalized.steps[0], {
    id: 'vsl-legada', type: 'vsl', title: 'Assista à oferta', description: 'Veja a explicação antes de continuar.',
    required: false, publicId: 'public-vsl-123', motion: 'slide-left', advanceAfterCta: true,
  });
  assert.throws(() => normalizeFormInput({ steps: [{ id: 'vsl', type: 'vsl', publicId: 'public-vsl', sourceUrl: 'https://cdn.test/video.mp4' }] }), /referência|VSL/i);
});

test('renderiza VSL com embed absoluto resolvido e fallback acessível sem expor configuração', () => {
  const composed = {
    ...form,
    headerElements: [{ id: 'top-vsl', type: 'vsl', publicId: 'public-vsl-top', title: 'Oferta em vídeo', description: 'Assista', motion: 'float' }],
    steps: [{ id: 'oferta', title: 'Sua oferta', elements: [{ id: 'vsl', type: 'vsl', publicId: 'public-vsl-123', title: 'Conheça a oferta', description: 'Uma explicação rápida.', motion: 'fade-up' }] }],
  };
  const html = renderDynamicForm(composed, '/submit', {
    vslEmbedUrls: new Map([
      ['public-vsl-top', 'https://studio.example.test/embed/v/public-vsl-top'],
      ['public-vsl-123', 'https://studio.example.test/embed/v/public-vsl-123'],
    ]),
  });
  assert.equal((html.match(/class="vsl-embed"/g) || []).length, 2);
  assert.match(html, /<iframe[^>]+src="https:\/\/studio\.example\.test\/embed\/v\/public-vsl-123"/);
  assert.match(html, /title="Conheça a oferta"/);
  assert.match(html, /data-motion="fade-up"/);
  assert.match(html, /\.screen-element\[data-motion=fade-up\]/);
  assert.match(html, /\.screen-element\[data-motion=slide-left\]/);
  assert.match(html, /\.screen-element\[data-motion=zoom-in\]/);
  assert.match(html, /\.screen-element\[data-motion=float\]/);
  assert.match(html, /prefers-reduced-motion:reduce\).*\.screen-element\[data-motion\]/);
  assert.doesNotMatch(html, /sourceUrl|posterUrl|ctaText|ctaUrl|video\.mp4/);

  const missing = renderDynamicForm({ ...form, steps: [{ id: 'sem-vsl', type: 'vsl', publicId: 'missing-vsl', title: 'Oferta' }] }, '/submit', { vslEmbedUrls: new Map() });
  assert.match(missing, /VSL não está disponível|VSL não encontrada|publique a VSL/i);
  assert.match(missing, /role="status"|role="alert"/);
});

test('sem nonce/trackerPublicId, o HTML do formulário é preservado byte a byte', () => {
  const html = renderDynamicForm(form, '/api/public/forms/123/submit');
  assert.equal(html.length, 18689);
  assert.equal(createHash('sha256').update(html).digest('hex'), '160435ef31bc85536d494d8376820fb42ebfca9cd9180ed415544bb5de259f45');
});

test('sem nonce, renderCompletion é preservado byte a byte', () => {
  const html = renderCompletion('Tudo certo!', 'Recebemos suas respostas.');
  assert.equal(html.length, 1240);
  assert.equal(createHash('sha256').update(html).digest('hex'), 'dc2ba647ceced6df839ddd2ecee6ad370ee6b30659bc24cebb6d6b17d98e21ca');
});

test('nonce aparece no script do runner e no script do tracker público', () => {
  const html = renderDynamicForm(form, '/api/public/forms/123/submit', { nonce: 'abc123', trackerPublicId: 'track-xyz' });
  assert.match(html, /<script nonce="abc123">/);
  assert.match(html, /<script src="\/tracker\.js" data-alva-tracker="track-xyz" nonce="abc123"><\/script>/);
});

test('runner instrumentado referencia form_start, form_step e form_submit_attempt sem ler valor de campo', () => {
  const html = renderDynamicForm(form, '/api/public/forms/123/submit', { trackerPublicId: 'track-xyz' });
  const scriptMatch = html.match(/<script(?: nonce="[^"]*")?>([\s\S]*?)<\/script>\s*(?:<script src="\/tracker\.js"|<\/body>)/);
  assert.ok(scriptMatch, 'script do runner deve estar presente');
  const runnerSource = scriptMatch[1];
  assert.match(runnerSource, /form_start/);
  assert.match(runnerSource, /form_step/);
  assert.match(runnerSource, /form_submit_attempt/);
  const iifeStart = runnerSource.indexOf('(()=>');
  const trackingHelperCode = iifeStart >= 0 ? runnerSource.slice(0, iifeStart) : runnerSource;
  assert.doesNotMatch(trackingHelperCode, /\.value/);
});

test('trackFormEvent do runner instrumentado gera payload plano aceito por parseCollectPayload', () => {
  const html = renderDynamicForm(form, '/api/public/forms/123/submit', { trackerPublicId: 'track-xyz' });
  const scriptMatch = html.match(/<script(?: nonce="[^"]*")?>([\s\S]*?)<\/script>\s*(?:<script src="\/tracker\.js"|<\/body>)/);
  assert.ok(scriptMatch, 'script do runner deve estar presente');
  const runnerSource = scriptMatch[1];
  const iifeStart = runnerSource.indexOf(`(()=>{const form=document.querySelector('form')`);
  assert.ok(iifeStart > 0, 'deve achar o início do runner original após o código de tracking');
  const trackingHelperCode = runnerSource.slice(0, iifeStart);

  const sentBodies = [];
  const context = {
    location: { pathname: '/f/alva/campanha/captura' },
    navigator: { sendBeacon: (url, body) => { sentBodies.push(body); return true; } },
    fetch: () => Promise.resolve(),
  };
  runInNewContext(trackingHelperCode, context);

  context.trackFormEvent('form_start');
  context.trackFormEvent('form_step');
  context.trackFormEvent('form_submit_attempt');

  assert.equal(sentBodies.length, 3);
  const names = sentBodies.map((body) => parseCollectPayload(body, 'text/plain').event.event_name);
  assert.deepEqual(names, ['form_start', 'form_step', 'form_submit_attempt']);
});

test('sem trackerPublicId, o runner não ganha instrumentação de eventos', () => {
  const html = renderDynamicForm(form, '/api/public/forms/123/submit', { nonce: 'abc123' });
  assert.doesNotMatch(html, /form_start/);
  assert.doesNotMatch(html, /form_step/);
  assert.doesNotMatch(html, /form_submit_attempt/);
  assert.doesNotMatch(html, /tracker\.js/);
});

test('renderCompletion também aceita nonce sem alterar a saída atual', () => {
  const html = renderCompletion('Tudo certo!', 'Recebemos suas respostas.', { nonce: 'zzz' });
  assert.equal(createHash('sha256').update(html).digest('hex'), 'dc2ba647ceced6df839ddd2ecee6ad370ee6b30659bc24cebb6d6b17d98e21ca');
});
