import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVslUI, fetchVslForEdit, mountVslPreview, parseVslFormValues, previewVslSource, sourceInputModel, vslListModel, vslStatusLabel, vslUiAccessPolicy } from '../public/vsl-ui.js';

test('configuração de VSL apresenta quatro etapas, avançado e prévia responsiva', async () => {
  const [html, css, ui] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/vsl-ui.js', import.meta.url), 'utf8'),
  ]);
  for (const field of ['name', 'sourceUrl', 'sourceType', 'posterUrl', 'accentColor', 'aspectRatio', 'captionsUrl', 'ctaText', 'ctaUrl', 'ctaSeconds', 'autoplayMuted', 'resumeEnabled'])
    assert.match(html, new RegExp(`name="${field}"`));
  assert.match(html, /1<\/span> Vídeo[\s\S]*2<\/span> Visual[\s\S]*3<\/span> Reprodução[\s\S]*4<\/span> CTA/);
  assert.match(html, /<details><summary>Opções avançadas<\/summary>/);
  assert.match(html, /id="vsl-preview"/);
  assert.match(css, /\.vsl-editor-layout\s*\{[\s\S]*grid-template-columns/);
  assert.match(css, /\.vsl-preview-screen[\s\S]*min-height/);
  assert.match(css, /@media\s*\(min-width:\s*621px\) and \(max-width:\s*900px\)[\s\S]*\.vsl-editor-layout\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(ui, /updatePreview/);
  assert.match(ui, /screen\.style\.aspectRatio/);
  assert.match(ui, /vsl-preview-accent/);
  assert.match(ui, /vsl-preview-playback/);
  assert.match(ui, /após \$\{ctaSeconds\}s/);
});

test('modelo da tela de VSL traduz rascunho, publicada e alterações pendentes', () => {
  assert.equal(vslStatusLabel({ publishedVersionId: null, lockVersion: 0 }), 'Rascunho');
  assert.equal(vslStatusLabel({ publishedVersionId: 'version-1', lockVersion: 0 }), 'Publicada');
  assert.equal(vslStatusLabel({ publishedVersionId: 'version-1', lockVersion: 2, publishedLockVersion: 1 }), 'Alterações não publicadas');
  assert.deepEqual(vslListModel([{ id: 'a', name: 'VSL', publishedVersionId: null }]), [{ id: 'a', name: 'VSL', publishedVersionId: null, status: 'Rascunho' }]);
});

test('edição por resumo busca o registro completo antes de preencher o formulário', async () => {
  const requests = [];
  const video = await fetchVslForEdit({ api: async (path) => { requests.push(path); return { sourceUrl: 'https://media.test/vsl.mp4', lockVersion: 3 }; }, projectId: 'project-1', videoId: 'video-1' });
  assert.deepEqual(requests, ['/projects/project-1/videos/video-1']);
  assert.equal(video.sourceUrl, 'https://media.test/vsl.mp4');
});

test('formulário preserva CTA no segundo zero', () => {
  assert.equal(parseVslFormValues({ ctaSeconds: '0', autoplayMuted: 'on', resumeEnabled: 'on' }).ctaSeconds, 0);
});

test('destino de CTA digitado como domínio simples fica pronto para salvar', () => {
  assert.equal(parseVslFormValues({ ctaUrl: 'google.com' }).ctaUrl, 'https://google.com');
});

test('campo de mídia aceita URL nos formatos nativos e URL ou ID nos provedores', () => {
  assert.deepEqual(sourceInputModel('mp4'), { label: 'URL da mídia', placeholder: 'https://…', inputMode: 'url' });
  assert.deepEqual(sourceInputModel('hls'), { label: 'URL da mídia', placeholder: 'https://…/video.m3u8', inputMode: 'url' });
  assert.deepEqual(sourceInputModel('youtube'), { label: 'URL ou ID do YouTube', placeholder: 'https://youtu.be/… ou ID', inputMode: 'text' });
  assert.deepEqual(sourceInputModel('vimeo'), { label: 'URL ou ID do Vimeo', placeholder: 'https://vimeo.com/… ou ID', inputMode: 'text' });
});

test('prévia transforma apenas IDs de provedores em URLs oficiais de embed', () => {
  assert.equal(previewVslSource('youtube', 'dQw4w9WgXcQ'), 'https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1');
  assert.equal(previewVslSource('vimeo', '123456'), 'https://player.vimeo.com/video/123456');
  assert.equal(previewVslSource('mp4', 'https://media.example.test/video.mp4'), 'https://media.example.test/video.mp4');
  assert.equal(previewVslSource('youtube', '<script>'), '');
});

test('prévia monta o adapter real com uma origem de provedor normalizada', () => {
  const calls = [];
  const result = mountVslPreview({
    container: {}, sourceType: 'youtube', sourceUrl: 'dQw4w9WgXcQ', config: { aspectRatio: '16:9' },
    mountPlayer: (container, config) => { calls.push([container, config]); return { destroy() {} }; },
  });
  assert.equal(typeof result.destroy, 'function');
  assert.deepEqual(calls, [[{}, {
    aspectRatio: '16:9', sourceType: 'youtube', sourceUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1', autoplayMuted: false, resumeEnabled: false,
  }]]);
});

test('abrir VSL resolve o shell depois do bootstrap', async () => {
  const originalDocument = globalThis.document;
  const view = { hidden: true };
  const list = { replaceChildren() {}, textContent: '' };
  const status = { textContent: '' };
  globalThis.document = { querySelector(selector) { return { '#vsl-view': view, '#vsl-list': list, '#vsl-status': status }[selector] ?? null; } };
  let shell = null;
  const requests = [];
  try {
    const ui = createVslUI({ getShell: () => shell, api: async (path) => { requests.push(path); return []; } });
    shell = { state: () => ({ currentProject: { id: 'project-1' } }) };
    await ui.show();
    assert.equal(view.hidden, false);
    assert.deepEqual(requests, ['/projects/project-1/videos']);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('tela de VSL não expõe URL da mídia nem JSON na lista visual', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../public/vsl-ui.js', import.meta.url), 'utf8');
  assert.match(source, /vsl-list-row/);
  assert.match(source, /Publicado|Publicada/);
  assert.doesNotMatch(source, /JSON\.stringify\(video\)/);
});

test('publicação da VSL depende de deployment.publish separadamente do CRUD', () => {
  assert.deepEqual(vslUiAccessPolicy({ hasVideo: true, can: (capability) => capability === 'deployment.publish' }), { canEdit: false, canPublish: true });
  assert.deepEqual(vslUiAccessPolicy({ hasVideo: true, can: (capability) => capability === 'video.write' }), { canEdit: true, canPublish: false });
  assert.deepEqual(vslUiAccessPolicy({ hasVideo: true, can: () => true }), { canEdit: true, canPublish: true });
  assert.deepEqual(vslUiAccessPolicy({ hasVideo: false, can: () => true }), { canEdit: true, canPublish: false });
});
