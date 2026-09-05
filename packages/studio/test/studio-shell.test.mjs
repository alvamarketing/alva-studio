import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStudioShell } from '../public/studio-shell.js';

const companies = [
  { id: 'company-a', name: 'Alva A', role: 'owner' },
  { id: 'company-b', name: 'Alva B', role: 'editor' },
];

const session = (companyId = 'company-a', projectId = 'project-a') => ({
  authenticated: true,
  user: { id: 'user-1', displayName: 'Tai' },
  currentCompanyId: companyId,
  currentProjectId: projectId,
});

function apiFor({ current = session(), projects = [{ id: 'project-a', companyId: 'company-a', name: 'Principal' }] } = {}) {
  const calls = [];
  return {
    calls,
    api: async (path, method = 'GET', payload) => {
      calls.push({ path, method, payload });
      if (path === '/session' && method === 'GET') return current;
      if (path === '/companies') return companies;
      if (path === '/projects') return projects;
      if (path === '/session' && method === 'PATCH') return current;
      throw new Error(`Chamada inesperada: ${method} ${path}`);
    },
  };
}

test('inicializa empresa e projeto ativos a partir da sessão persistida', async () => {
  const fixture = apiFor();
  const shell = createStudioShell({ api: fixture.api });

  await shell.initialize();

  assert.deepEqual(shell.state(), {
    phase: 'ready',
    session: session(),
    companies,
    projects: [{ id: 'project-a', companyId: 'company-a', name: 'Principal' }],
    currentCompany: companies[0],
    currentProject: { id: 'project-a', companyId: 'company-a', name: 'Principal' },
    error: '',
  });
  assert.deepEqual(fixture.calls.map((call) => call.path), ['/session', '/companies', '/projects']);
});

test('troca de empresa limpa o projeto anterior antes de carregar e usa somente o projeto confirmado', async () => {
  let shell;
  const transitions = [];
  const api = async (path, method = 'GET', payload) => {
    if (path === '/session' && method === 'GET') return session();
    if (path === '/companies') return companies;
    if (path === '/projects' && method === 'GET') {
      if (shell.state().phase === 'loading' && shell.state().projects.length === 0 && shell.state().currentProject === null)
        transitions.push('limpo-antes-da-lista');
      return [{ id: 'project-b', companyId: 'company-b', name: 'Campanha B' }];
    }
    if (path === '/session' && method === 'PATCH') {
      assert.deepEqual(payload, { companyId: 'company-b' });
      return session('company-b', 'project-b');
    }
    throw new Error(`Chamada inesperada: ${method} ${path}`);
  };
  shell = createStudioShell({
    api,
    beforeContextChange: async () => transitions.push('editores-fechados'),
    onContextChanged: async (next) => transitions.push(`contexto-${next.currentProject.id}`),
  });
  await shell.initialize();
  transitions.length = 0;

  await shell.selectCompany('company-b');

  assert.deepEqual(transitions, ['editores-fechados', 'limpo-antes-da-lista', 'contexto-project-b']);
  assert.equal(shell.state().currentCompany.id, 'company-b');
  assert.equal(shell.state().currentProject.id, 'project-b');
});

test('troca de projeto persiste o contexto e não mantém dados anteriores quando falha', async () => {
  const fixture = apiFor({
    projects: [
      { id: 'project-a', companyId: 'company-a', name: 'Principal' },
      { id: 'project-b', companyId: 'company-a', name: 'Secundário' },
    ],
  });
  const shell = createStudioShell({
    api: async (path, method, payload) => {
      if (path === '/session' && method === 'PATCH') {
        assert.deepEqual(payload, { companyId: 'company-a', projectId: 'project-b' });
        throw new Error('Sessão expirada');
      }
      return fixture.api(path, method, payload);
    },
  });
  await shell.initialize();

  await assert.rejects(() => shell.selectProject('project-b'), /Sessão expirada/);

  assert.deepEqual(shell.state(), {
    phase: 'error',
    session: null,
    companies: [],
    projects: [],
    currentCompany: null,
    currentProject: null,
    error: 'Sessão expirada',
  });
});

test('serializa PATCHes e mantém a sessão persistida na última seleção', async () => {
  let persisted = session();
  let resolveFirstPatch;
  const patches = [];
  const shell = createStudioShell({
    api: async (path, method = 'GET', payload) => {
      if (path === '/session' && method === 'GET') return persisted;
      if (path === '/companies') return companies;
      if (path === '/projects') {
        return persisted.currentCompanyId === 'company-b'
          ? [{ id: 'project-b', companyId: 'company-b', name: 'Projeto B' }]
          : [{ id: 'project-a', companyId: 'company-a', name: 'Projeto A' }];
      }
      if (path === '/session' && method === 'PATCH') {
        patches.push(payload);
        if (patches.length === 1)
          return new Promise((resolve) => {
            resolveFirstPatch = () => {
              persisted = session('company-b', 'project-b');
              resolve(persisted);
            };
          });
        persisted = session('company-a', 'project-a');
        return persisted;
      }
      throw new Error(`Chamada inesperada: ${method} ${path}`);
    },
  });
  await shell.initialize();

  const first = shell.selectCompany('company-b');
  await Promise.resolve();
  await Promise.resolve();
  const latest = shell.selectCompany('company-a');
  await Promise.resolve();
  await Promise.resolve();
  resolveFirstPatch();
  await Promise.all([first, latest]);

  assert.deepEqual(patches, [{ companyId: 'company-b' }, { companyId: 'company-a' }]);
  assert.equal(persisted.currentCompanyId, 'company-a');
  assert.equal(persisted.currentProjectId, 'project-a');
  assert.equal(shell.state().currentCompany.id, 'company-a');
  assert.equal(shell.state().currentProject.id, 'project-a');
});

test('termina o callback de um contexto antes de iniciar o próximo', async () => {
  let persisted = session();
  let releaseCallback;
  let callbackStarted;
  const firstCallback = new Promise((resolve) => (callbackStarted = resolve));
  const events = [];
  const shell = createStudioShell({
    api: async (path, method = 'GET', payload) => {
      if (path === '/session' && method === 'GET') return persisted;
      if (path === '/companies') return companies;
      if (path === '/projects')
        return persisted.currentCompanyId === 'company-b'
          ? [{ id: 'project-b', companyId: 'company-b', name: 'Projeto B' }]
          : [{ id: 'project-a', companyId: 'company-a', name: 'Projeto A' }];
      if (path === '/session' && method === 'PATCH') {
        persisted = payload.companyId === 'company-b' ? session('company-b', 'project-b') : session();
        events.push(`patch-${persisted.currentCompanyId}`);
        return persisted;
      }
      throw new Error(`Chamada inesperada: ${method} ${path}`);
    },
    onContextChanged: async (next) => {
      events.push(`callback-${next.currentCompany.id}`);
      if (next.currentCompany.id === 'company-b') {
        callbackStarted();
        await new Promise((resolve) => (releaseCallback = resolve));
      }
      events.push(`render-${next.currentCompany.id}`);
    },
  });
  await shell.initialize();

  const first = shell.selectCompany('company-b');
  await firstCallback;
  const latest = shell.selectCompany('company-a');
  await Promise.resolve();
  assert.deepEqual(events, ['patch-company-b', 'callback-company-b']);
  releaseCallback();
  await Promise.all([first, latest]);

  assert.deepEqual(events, [
    'patch-company-b',
    'callback-company-b',
    'render-company-b',
    'patch-company-a',
    'callback-company-a',
    'render-company-a',
  ]);
});

test('ignora a falha de uma seleção superada', async () => {
  let persisted = session();
  let rejectFirstPatch;
  let patchCount = 0;
  const shell = createStudioShell({
    api: async (path, method = 'GET') => {
      if (path === '/session' && method === 'GET') return persisted;
      if (path === '/companies') return companies;
      if (path === '/projects')
        return [{ id: 'project-a', companyId: 'company-a', name: 'Projeto A' }];
      if (path === '/session' && method === 'PATCH') {
        patchCount++;
        if (patchCount === 1)
          return new Promise((_, reject) => {
            rejectFirstPatch = () => reject(new Error('Rede indisponível'));
          });
        persisted = session('company-a', 'project-a');
        return persisted;
      }
      throw new Error(`Chamada inesperada: ${method} ${path}`);
    },
  });
  await shell.initialize();

  const stale = shell.selectCompany('company-b');
  await Promise.resolve();
  await Promise.resolve();
  const latest = shell.selectCompany('company-a');
  rejectFirstPatch();
  await Promise.all([stale, latest]);

  assert.equal(shell.state().phase, 'ready');
  assert.equal(shell.state().currentCompany.id, 'company-a');
  assert.equal(shell.state().error, '');
});

test('shell mantém capacidades de VSL alinhadas por papel', async () => {
  for (const [role, expected] of Object.entries({
    owner: { read: true, write: true, publish: true },
    admin: { read: true, write: true, publish: true },
    editor: { read: true, write: true, publish: false },
    analyst: { read: true, write: false, publish: false },
    viewer: { read: false, write: false, publish: false },
  })) {
    const shell = createStudioShell({ api: async (path) => {
      if (path === '/session') return { authenticated: true, role, currentCompanyId: 'company-1', currentProjectId: 'project-1' };
      if (path === '/companies') return [{ id: 'company-1', role }];
      return [{ id: 'project-1' }];
    } });
    await shell.initialize();
    assert.equal(shell.can('video.read'), expected.read, role);
    assert.equal(shell.can('video.write'), expected.write, role);
    assert.equal(shell.can('deployment.publish'), expected.publish, role);
  }
});

test('deriva capacidades dos papéis conhecidos e bloqueia viewer', async () => {
  const expected = {
    owner: ['company.manage', 'billing.manage', 'member.manage', 'project.manage', 'page.write', 'form.write', 'video.read', 'video.write', 'submission.read', 'integration.manage', 'deployment.publish'],
    admin: ['member.manage', 'project.manage', 'page.write', 'form.write', 'video.read', 'video.write', 'submission.read', 'integration.manage', 'deployment.publish'],
    editor: ['page.write', 'form.write', 'video.read', 'video.write', 'submission.read'],
    analyst: ['submission.read', 'analytics.read', 'video.read'],
    viewer: [],
  };
  const allCapabilities = [...new Set(Object.values(expected).flat())];
  for (const [role, capabilities] of Object.entries(expected)) {
    for (const capability of allCapabilities) {
      const roleShell = createStudioShell({
        api: async (path) => {
          if (path === '/session') return session();
          if (path === '/companies') return [{ id: 'company-a', name: 'Alva', role }];
          if (path === '/projects') return [{ id: 'project-a', companyId: 'company-a', name: 'Principal' }];
          throw new Error(`Chamada inesperada: ${path}`);
        },
      });
      await roleShell.initialize();
      assert.equal(roleShell.can(capability), capabilities.includes(capability), `${role} ${capability}`);
    }
  }
});
