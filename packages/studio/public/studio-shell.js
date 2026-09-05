export const CLIENT_ROLE_CAPABILITIES = Object.freeze({
  owner: Object.freeze([
    'company.manage',
    'billing.manage',
    'member.manage',
    'project.manage',
    'page.write',
    'form.write',
    'video.read',
    'video.write',
    'submission.read',
    'integration.manage',
    'deployment.publish',
  ]),
  admin: Object.freeze([
    'member.manage',
    'project.manage',
    'page.write',
    'form.write',
    'video.read',
    'video.write',
    'submission.read',
    'integration.manage',
    'deployment.publish',
  ]),
  editor: Object.freeze(['page.write', 'form.write', 'video.read', 'video.write', 'submission.read']),
  analyst: Object.freeze(['submission.read', 'analytics.read', 'video.read']),
  viewer: Object.freeze([]),
});

export function vslCapabilityPolicy({ can = () => false, consumer = 'page' } = {}) {
  const read = Boolean(can('video.read'));
  const consumerWrite = Boolean(can(consumer === 'form' ? 'form.write' : 'page.write'));
  return {
    canList: read,
    canSelect: read && consumerWrite,
    canEditConsumer: consumerWrite,
    canManageVideo: Boolean(can('video.write')),
    canPublish: Boolean(can('deployment.publish')),
  };
}

function emptyState(phase = 'empty', error = '') {
  return {
    phase,
    session: null,
    companies: [],
    projects: [],
    currentCompany: null,
    currentProject: null,
    error,
  };
}

function snapshot(value) {
  return {
    ...value,
    session: value.session && { ...value.session },
    companies: value.companies.map((company) => ({ ...company })),
    projects: value.projects.map((project) => ({ ...project })),
    currentCompany: value.currentCompany && { ...value.currentCompany },
    currentProject: value.currentProject && { ...value.currentProject },
  };
}

function message(error) {
  return error instanceof Error && error.message ? error.message : 'Não foi possível atualizar o contexto.';
}

export function createStudioShell({ api, beforeContextChange = async () => {}, onContextChanged = async () => {} } = {}) {
  if (typeof api !== 'function') throw new Error('A API do Studio é obrigatória.');

  let current = emptyState();
  let requestVersion = 0;
  let contextQueue = Promise.resolve();

  const update = (next) => {
    current = next;
    return state();
  };

  const state = () => snapshot(current);

  const apply = (session, companies, projects) => {
    const currentCompany = companies.find((company) => company.id === session.currentCompanyId) ?? null;
    const currentProject = projects.find((project) => project.id === session.currentProjectId) ?? null;
    return update({
      phase: currentCompany ? (projects.length ? 'ready' : 'empty') : 'empty',
      session,
      companies,
      projects,
      currentCompany,
      currentProject,
      error: '',
    });
  };

  const failed = (error, version) => {
    if (version === requestVersion) update(emptyState('error', message(error)));
    if (version === requestVersion) throw error;
    return state();
  };

  async function initialize() {
    const version = ++requestVersion;
    update(emptyState('loading'));
    try {
      const session = await api('/session');
      if (version !== requestVersion) return state();
      if (!session?.authenticated) return update(emptyState());
      const companies = await api('/companies');
      if (version !== requestVersion) return state();
      const projects = await api('/projects');
      if (version !== requestVersion) return state();
      return apply(session, companies, projects);
    } catch (error) {
      return failed(error, version);
    }
  }

  async function change(payload, version) {
    try {
      if (version !== requestVersion) return state();
      await beforeContextChange();
      if (version !== requestVersion) return state();
      update({ ...emptyState('loading'), companies: current.companies.map((company) => ({ ...company })) });
      const session = await api('/session', 'PATCH', payload);
      if (version !== requestVersion) return state();
      const companies = session.companies ?? current.companies;
      const projects = await api('/projects');
      if (version !== requestVersion) return state();
      const next = apply(session, companies, projects);
      await onContextChanged(next);
      return state();
    } catch (error) {
      return failed(error, version);
    }
  }

  function queueChange(payload) {
    const version = ++requestVersion;
    const run = () => change(payload, version);
    const result = contextQueue.then(run, run);
    contextQueue = result.catch(() => {});
    return result;
  }

  function selectCompany(companyId) {
    return queueChange({ companyId });
  }

  function selectProject(projectId) {
    const companyId = current.session?.currentCompanyId ?? current.currentCompany?.id;
    if (!companyId) return Promise.reject(new Error('Escolha uma empresa antes do projeto.'));
    return queueChange({ companyId, projectId });
  }

  function can(capability) {
    const role = current.currentCompany?.role ?? current.session?.role ?? 'viewer';
    return CLIENT_ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
  }

  return { initialize, selectCompany, selectProject, state, can };
}
