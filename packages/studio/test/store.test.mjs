import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.mjs';
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'alva-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, store: new Store(dir) };
}
test('salvar e reabrir preserva projeto e revisão', async (t) => {
  const { dir, store } = await fixture(t);
  const p = await store.create({ name: 'Alva Marketing' });
  const saved = await store.update(p.id, {
    revision: 0,
    project: { pages: [{ component: 'Olá' }] },
    html: '<h1>Olá</h1>',
  });
  assert.equal(saved.revision, 1);
  assert.deepEqual((await new Store(dir).get(p.id)).project, saved.project);
});
test('duplicar preserva conteúdo e não compartilha domínio ou publicação', async (t) => {
  const { store } = await fixture(t);
  let p = await store.create({ name: 'CMA' });
  p = await store.update(p.id, { revision: 0, project: { pages: [{ component: 'CMA' }] }, domain: 'lp.example.com' });
  const copy = await store.duplicate(p.id);
  assert.notEqual(copy.id, p.id);
  assert.deepEqual(copy.project, p.project);
  assert.equal(copy.domain, '');
  assert.equal(copy.deployment, null);
  await store.remove(copy.id);
  assert.equal((await store.list()).length, 1);
});
test('revisão antiga e caminhos arbitrários são rejeitados', async (t) => {
  const { store } = await fixture(t);
  const p = await store.create({ name: 'LP' });
  await store.update(p.id, { revision: 0, name: 'LP nova' });
  await assert.rejects(() => store.update(p.id, { revision: 0, name: 'antiga' }), /outra aba/);
  await assert.rejects(() => store.get('../secret'), /Página inválida/);
});
test('mutações concorrentes da mesma revisão não apagam mudanças', async (t) => {
  const { store } = await fixture(t);
  const p = await store.create({ name: 'LP' });
  const r = await Promise.allSettled([
    store.update(p.id, { revision: 0, name: 'A' }),
    store.update(p.id, { revision: 0, name: 'B' }),
  ]);
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
});

test('status antigo não substitui uma publicação mais recente', async (t) => {
  const { store } = await fixture(t);
  const p = await store.create({ name: 'LP' });
  await store.setDeployment(p.id, { id: 'dpl_B', state: 'QUEUED' });
  await store.setDeployment(p.id, { id: 'dpl_A', state: 'READY' }, 'dpl_A');
  assert.equal((await store.get(p.id)).deployment.id, 'dpl_B');
});
