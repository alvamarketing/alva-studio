import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsLoader, createSettingsOpenGuard, settingsAccess, validatePasswordConfirmation, vercelPayload } from '../public/owner.js';
const htmlPath = new URL('../public/index.html', import.meta.url);
const appPath = new URL('../public/app.js', import.meta.url);
const ownerPath = new URL('../public/owner.js', import.meta.url);

test('configurações são uma view interna acessível e reaproveitam o formulário existente', async () => {
  const [html, app, owner] = await Promise.all([readFile(htmlPath, 'utf8'), readFile(appPath, 'utf8'), readFile(ownerPath, 'utf8')]);
  assert.match(html, /id="app-settings"/);
  assert.match(html, /id="settings-view"/);
  assert.match(app, /settings:\s*'#settings-view'/);
  assert.match(app, /setDashboardView\('settings'\)/);
  assert.match(app, /setDashboardView\('settings', \{ settingsTab: 'vercel' \}\)/);
  assert.match(app, /await save\(\);[\s\S]*#dashboard'\)\.hidden = false;[\s\S]*setDashboardView\('settings', \{ settingsTab: 'vercel' \}\)/);
  assert.match(app, /\$\('#page-vercel-settings'\)\.onclick = action\(async/);
  assert.match(app, /button\.disabled = true;[\s\S]*finally \{\s*button\.disabled = false;/);
  assert.doesNotMatch(app, /finally \{[\s\S]*if \(!\$\('#editing'\)\.hidden\) button\.disabled = false/);
  assert.match(app, /await setDashboardView\('settings', \{ settingsTab: 'vercel' \}\)/);
  assert.match(app, /settingsMount:\s*\$\('#settings-view'\)/);
  assert.match(owner, /dialogNode\?\.tagName === 'DIALOG'/);
  assert.match(owner, /dialogNode\.replaceWith\(section\)/);
  assert.match(owner, /id="tab-account"/);
  assert.match(owner, /id = 'tab-company'/);
  assert.match(owner, /id="tab-vercel"/);
  assert.match(owner, /settingsGuard\.isCurrent/);
  assert.match(owner, /closeSettings/);
  assert.match(owner, /\(\$\('#tab-' \+ access\.tab\) \|\| dialog\.querySelector\('h2'\)\)\?\.focus\(\)/);
  assert.match(owner, /id="owner-logout"/);
});
test('abertura tardia de configurações é cancelada ao navegar', () => {
  const guard = createSettingsOpenGuard();
  const first = guard.begin();
  guard.cancel();
  assert.equal(guard.isCurrent(first), false);
  const second = guard.begin();
  assert.equal(guard.isCurrent(second), true);
});
test('fluxo Vercel libera o botão para o próximo editor', async () => {
  const app = await readFile(appPath, 'utf8');
  const flowStart = app.indexOf("$('#page-vercel-settings').onclick");
  const save = app.indexOf('await save();', flowStart);
  const dashboard = app.indexOf("$('#dashboard').hidden = false;", flowStart);
  const settings = app.indexOf("await setDashboardView('settings', { settingsTab: 'vercel' });", flowStart);
  const unlock = app.indexOf('button.disabled = false;', settings);
  assert.ok(flowStart >= 0 && save > flowStart && dashboard > save && settings > dashboard && unlock > settings);
});
test('a confirmação evita criar ou trocar senha digitada diferente', () => {
  assert.throws(() => validatePasswordConfirmation('frase-segura-123', 'outra-frase-123'), /não conferem/);
  assert.doesNotThrow(() => validatePasswordConfirmation('frase-segura-123', 'frase-segura-123'));
});
test('campo vazio de token mantém credencial existente, sem enviá-la de volta', () => {
  assert.deepEqual(vercelPayload({ token: '', teamId: ' team_example ' }), { teamId: 'team_example' });
  assert.deepEqual(vercelPayload({ token: ' new-token ', teamId: '' }), { token: 'new-token', teamId: '' });
});

test('editor e analista não carregam nem veem configurações de integração', async () => {
  let calls = 0;
  const load = createSettingsLoader({
    api: async () => { calls++; return { vercel: {} }; },
    canManageIntegration: () => false,
  });

  assert.equal(await load(), null);
  assert.equal(calls, 0);
  assert.deepEqual(settingsAccess({ canManageIntegration: false, requestedTab: 'vercel' }), { integration: false, tab: 'account' });
  assert.deepEqual(settingsAccess({ canManageIntegration: true, requestedTab: 'vercel' }), { integration: true, tab: 'vercel' });
});
