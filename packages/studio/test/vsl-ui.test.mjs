import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVslUI, fetchVslForEdit, parseVslFormValues, vslListModel, vslStatusLabel, vslUiAccessPolicy } from '../public/vsl-ui.js';

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
