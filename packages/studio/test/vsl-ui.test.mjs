import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vslListModel, vslStatusLabel } from '../public/vsl-ui.js';

test('modelo da tela de VSL traduz rascunho, publicada e alterações pendentes', () => {
  assert.equal(vslStatusLabel({ publishedVersionId: null, lockVersion: 0 }), 'Rascunho');
  assert.equal(vslStatusLabel({ publishedVersionId: 'version-1', lockVersion: 0 }), 'Publicada');
  assert.equal(vslStatusLabel({ publishedVersionId: 'version-1', lockVersion: 2, publishedLockVersion: 1 }), 'Alterações não publicadas');
  assert.deepEqual(vslListModel([{ id: 'a', name: 'VSL', publishedVersionId: null }]), [{ id: 'a', name: 'VSL', publishedVersionId: null, status: 'Rascunho' }]);
});
