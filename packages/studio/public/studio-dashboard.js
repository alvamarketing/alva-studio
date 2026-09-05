export function isProjectSlug(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value ?? ''));
}

export function applyDashboardNavigation(navigation, active) {
  for (const [name, element] of Object.entries(navigation)) {
    const current = name === active;
    element.classList.toggle('nav-active', current);
    if (current) element.setAttribute('aria-current', 'page');
    else element.removeAttribute('aria-current');
  }
}

export function canCreateProject(shell) {
  return Boolean(shell?.can?.('project.manage'));
}

export function dashboardModel({ phase = 'empty', error = '', companies = [], projects = [] } = {}) {
  if (phase === 'loading') return { status: 'loading', message: 'Carregando seu Studio…', companies: [], projects: [], activity: [] };
  if (phase === 'error') return { status: 'error', message: error || 'Não foi possível carregar seu Studio.', companies: [], projects: [], activity: [] };
  if (!companies.length && !projects.length) return { status: 'empty', message: 'Você ainda não tem empresas ou projetos disponíveis.', companies: [], projects: [], activity: [] };
  return { status: 'ready', message: '', companies, projects, activity: [...projects].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))) };
}

export function filterProjectContent(content = [], filter = 'all') {
  const kind = filter === 'pages' ? 'page' : filter === 'forms' ? 'form' : '';
  return kind ? content.filter((item) => item.kind === kind) : [...content];
}

export function projectOverviewModel(overview, { phase = 'ready', error = '' } = {}) {
  if (phase === 'loading') return { status: 'loading', message: 'Carregando projeto…', content: [], metrics: [], modules: [] };
  if (phase === 'error') return { status: 'error', message: error || 'Não foi possível carregar este projeto.', content: [], metrics: [], modules: [] };
  if (!overview?.project) return { status: 'empty', message: 'Escolha ou crie um projeto para continuar.', content: [], metrics: [], modules: [] };

  const counts = overview.counts || {};
  const content = (overview.content || []).map((item) => ({
    ...item,
    status: item.published ? 'Publicado' : 'Rascunho',
    responses: Number(item.submissionCount || 0),
  }));
  const published = Number(counts.publishedPages || 0) + Number(counts.publishedForms || 0);
  const configured = (value) => value === 'configured' ? 'Configurado' : 'Ainda não configurado';
  return {
    status: content.length ? 'ready' : 'empty',
    message: content.length ? '' : 'Este projeto ainda não tem conteúdos.',
    title: overview.project.name,
    slug: overview.project.slug,
    project: overview.project,
    metrics: [
      ['Landing pages', Number(counts.pages || 0)],
      ['Formulários', Number(counts.forms || 0)],
      ['Publicados', published],
      ['Respostas', Number(counts.submissions || 0)],
    ],
    content,
    domain: overview.domain?.verificationStatus === 'verified'
      ? { label: overview.domain.domain, state: 'verified' }
      : { label: 'Domínio ainda não verificado', state: 'pending' },
    modules: [
      ['Analytics', configured(overview.integrations?.analytics)],
      ['Rastreamento', 'Em breve'],
      ['Publicação', configured(overview.integrations?.vercel)],
      ['Agentes', configured(overview.integrations?.agents)],
    ],
  };
}

export function roleLabel(role) {
  return ({ owner: 'Proprietário', admin: 'Administrador', editor: 'Editor', analyst: 'Analista', viewer: 'Visualizador' })[role] || 'Membro';
}

function errorMessage(error) {
  return error instanceof Error && error.message ? error.message : 'Não foi possível atualizar a empresa.';
}

function loadingState(state) {
  return { ...state, phase: 'loading', projects: [], currentProject: null, error: '' };
}

function failedState(state, error) {
  return {
    phase: 'error',
    session: state.session ?? null,
    companies: [],
    projects: [],
    currentCompany: null,
    currentProject: null,
    error: errorMessage(error),
  };
}

export function createDashboardContextFlow({ shell, renderState, renderSwitcher }) {
  if (!shell || typeof shell.state !== 'function' || typeof shell.selectCompany !== 'function')
    throw new Error('O contexto do Studio é obrigatório.');
  if (typeof renderState !== 'function' || typeof renderSwitcher !== 'function')
    throw new Error('Os renderizadores do dashboard são obrigatórios.');

  let confirmed = shell.state();

  const confirm = () => {
    confirmed = shell.state();
    renderSwitcher(confirmed, { selectedCompanyId: confirmed.currentCompany?.id || '', disabled: false });
    return confirmed;
  };

  return {
    async selectCompany(companyId) {
      const previous = confirmed;
      renderState(loadingState(previous));
      renderSwitcher(previous, { selectedCompanyId: companyId, disabled: true });
      try {
        return await shell.selectCompany(companyId);
      } catch (error) {
        renderState(failedState(previous, error));
        renderSwitcher(previous, { selectedCompanyId: previous.currentCompany?.id || '', disabled: false });
        throw error;
      }
    },
    confirm,
    bootstrap: confirm,
  };
}

export function createProjectSubmission({ createProject, selectProject, closeDialog, showError }) {
  if ([createProject, selectProject, closeDialog, showError].some((value) => typeof value !== 'function'))
    throw new Error('Os controles de criação de projeto são obrigatórios.');

  return {
    async submit(input) {
      let project;
      try {
        project = await createProject(input);
        await selectProject(project.id);
        closeDialog();
        showError('');
        return project;
      } catch (error) {
        if (project) {
          const message = `O projeto “${project.name}” foi criado, mas não foi possível selecioná-lo: ${errorMessage(error)}`;
          showError(message);
          throw new Error(message, { cause: error });
        }
        showError(errorMessage(error));
        throw error;
      }
    },
  };
}
