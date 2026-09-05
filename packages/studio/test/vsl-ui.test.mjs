import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchVslForEdit, vslListModel, vslStatusLabel } from '../public/vsl-ui.js';

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
