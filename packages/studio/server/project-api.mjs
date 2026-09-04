import { normalizeProjectSlug, normalizeRoute } from './domain/access.mjs';

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

function rejectsLegacyProject(input) {
  if (Object.hasOwn(input ?? {}, 'project')) throw fail('Use editorState para o estado do editor.', 400);
}

function routeFor(name) {
  return normalizeRoute(normalizeProjectSlug(name || `conteudo-${crypto.randomUUID().slice(0, 8)}`));
}

function pageInput(input = {}) {
  return {
    name: input.name,
    route: input.route,
    template: input.template,
    editorState: input.editorState,
    renderedHtml: input.renderedHtml,
    lockVersion: input.lockVersion,
  };
}

function formInput(input = {}) {
  return {
    name: input.name,
    route: input.route,
    draftSchema: input.draftSchema,
    lockVersion: input.lockVersion,
  };
}

function legacyPage(page, settings = {}) {
  return {
    ...page,
    project: page.editorState,
    html: page.renderedHtml,
    revision: page.lockVersion,
    deployment: null,
    domain: settings.domain ?? '',
    webhook: settings.webhook ?? '',
  };
}

function initialLegacyForm() {
  return {
    headerElements: [],
    steps: [{
      id: crypto.randomUUID(),
      title: 'Nova etapa',
      elements: [{ id: crypto.randomUUID(), type: 'short_text', title: 'Sua resposta', required: true }],
    }],
    completion: { title: 'Obrigado!', message: 'Recebemos suas respostas.' },
    webhook: '',
  };
}

function legacyForm(form) {
  const schema = form.draftSchema ?? initialLegacyForm();
  return {
    ...form,
    slug: form.route.replace(/^\//, ''),
    headerElements: schema.headerElements ?? [],
    steps: schema.steps ?? [],
    completion: schema.completion ?? initialLegacyForm().completion,
    webhook: schema.webhook ?? '',
    revision: form.lockVersion,
    stepCount: (schema.steps ?? []).length,
    submissionCount: form.submissionCount ?? 0,
  };
}

function legacyFormPatch(input, form) {
  const schema = { ...(form.draftSchema ?? initialLegacyForm()) };
  for (const key of ['headerElements', 'steps', 'completion', 'webhook']) {
    if (Object.hasOwn(input, key)) schema[key] = input[key];
  }
  return {
    name: input.name ?? form.name,
    route: input.slug ?? input.route ?? form.route,
    draftSchema: schema,
    lockVersion: input.revision ?? input.lockVersion,
  };
}

function pendingVercel() {
  return { connected: false, tokenConfigured: false, teamId: '', source: null, pending: true };
}

async function legacyPageFor(content, context, page) {
  const settings = await content.pageSettings({
    companyId: context.companyId, projectId: page.projectId, actorId: context.user.id, pageId: page.id,
  });
  return legacyPage(page, settings);
}

async function publishLegacyForm(content, context, projectId, form) {
  await content.publishForm({ companyId: context.companyId, projectId, actorId: context.user.id, formId: form.id });
  return legacyForm(await content.getForm({
    companyId: context.companyId, projectId, actorId: context.user.id, formId: form.id,
  }));
}

export function createProjectApi({
  sessionService,
  companies,
  projects,
  content,
  body,
  secure = false,
  limit,
  setupAllowed = () => true,
}) {
  return async function projectApi({ req, res, path, method, json }) {
    if (method === 'GET' && path === '/api/session') return json(await sessionService.state(req));
    if (method === 'POST' && path === '/api/setup') {
      limit?.(req.socket.remoteAddress);
      if (!setupAllowed(req)) throw fail('Crie a conta primeiro pelo servidor local.', 403);
      const context = await sessionService.setup(await body(req));
      await sessionService.issue(res, context, secure);
      return json(await sessionService.stateFor(context), 201);
    }
    if (method === 'POST' && path === '/api/login') {
      limit?.(req.socket.remoteAddress);
      const context = await sessionService.login(await body(req));
      await sessionService.issue(res, context, secure);
      return json(await sessionService.stateFor(context));
    }
    if (method === 'PATCH' && path === '/api/session') return json(await sessionService.changeContext(req, await body(req)));
    if (method === 'POST' && path === '/api/logout') {
      await sessionService.require(req);
      await body(req);
      await sessionService.logout(req, res, secure);
      return json({ ok: true });
    }
    if (method === 'PUT' && path === '/api/account') return json(await sessionService.account(req, await body(req), res, secure));

    const context = await sessionService.require(req);
    if (method === 'GET' && path === '/api/config') return json({ vercelConnected: false, pending: true });
    if (method === 'GET' && path === '/api/settings') return json({ vercel: pendingVercel() });
    if (method === 'PUT' && path === '/api/settings/vercel') {
      await body(req);
      throw fail('A conexão Vercel por projeto ainda está pendente.', 409);
    }
    if (method === 'POST' && path === '/api/settings/vercel/test') {
      await body(req);
      throw fail('A conexão Vercel por projeto ainda está pendente.', 409);
    }
    if (method === 'GET' && path === '/api/companies') return json(await sessionService.companiesFor(context.user.id));
    if (method === 'GET' && path === '/api/projects') return json(await projects.listForUser({ companyId: context.companyId, userId: context.user.id }));
    if (method === 'POST' && path === '/api/projects') {
      await sessionService.authorize(context, 'project.manage');
      const input = await body(req);
      rejectsLegacyProject(input);
      return json(await projects.create({
        name: input.name,
        slug: input.slug,
        companyId: context.companyId,
        actorUserId: context.user.id,
      }), 201);
    }

    const members = path.match(/^\/api\/companies\/([^/]+)\/members$/);
    if (members && method === 'GET') {
      if (members[1] !== context.companyId) throw fail('Empresa não encontrada.', 404);
      await sessionService.authorize(context, 'member.manage');
      return json(await companies.members({ companyId: context.companyId, actorUserId: context.user.id }));
    }

    const project = path.match(/^\/api\/projects\/([^/]+)$/);
    if (project) {
      const projectId = project[1];
      await sessionService.authorize(context, null, projectId);
      if (method === 'GET') return json(await projects.getAuthorized({ companyId: context.companyId, projectId, userId: context.user.id }));
      if (method === 'PUT') {
        await sessionService.authorize(context, 'project.manage', projectId);
        const input = await body(req);
        rejectsLegacyProject(input);
        return json(await projects.update({
          name: input.name,
          slug: input.slug,
          companyId: context.companyId,
          projectId,
          actorUserId: context.user.id,
        }));
      }
      if (method === 'DELETE') {
        await sessionService.authorize(context, 'project.manage', projectId);
        await body(req);
        const archived = await projects.archive({ companyId: context.companyId, projectId, actorUserId: context.user.id });
        await sessionService.clearCurrentProject(projectId);
        return json(archived);
      }
    }

    const collection = path.match(/^\/api\/projects\/([^/]+)\/(pages|forms)$/);
    if (collection) {
      const [, projectId, kind] = collection;
      await sessionService.authorize(context, null, projectId);
      if (method === 'GET') {
        return json(kind === 'pages'
          ? await content.listPages({ companyId: context.companyId, projectId, actorId: context.user.id })
          : await content.listForms({ companyId: context.companyId, projectId, actorId: context.user.id }));
      }
      if (method === 'POST') {
        await sessionService.authorize(context, kind === 'pages' ? 'page.write' : 'form.write', projectId);
        const input = await body(req);
        rejectsLegacyProject(input);
        const record = kind === 'pages'
          ? await content.createPage({ ...pageInput(input), companyId: context.companyId, projectId, actorId: context.user.id })
          : await content.createForm({ ...formInput(input), companyId: context.companyId, projectId, actorId: context.user.id });
        return json(record, 201);
      }
    }

    const legacy = path.match(/^\/api\/(pages|forms)(?:\/([^/]+)(?:\/(duplicate|publish|status|domain|submissions))?)?$/);
    if (!legacy) throw fail('Não encontrado.', 404);
    const [, kind, id, action] = legacy;
    const projectId = context.currentProjectId;
    if (!projectId) throw fail('Escolha um projeto ativo.', 409);
    await sessionService.authorize(context, null, projectId);
    const isPage = kind === 'pages';
    const capability = isPage ? 'page.write' : 'form.write';

    if (!id) {
      if (method === 'GET') {
        const records = isPage
          ? await content.listPages({ companyId: context.companyId, projectId, actorId: context.user.id })
          : await content.listForms({ companyId: context.companyId, projectId, actorId: context.user.id });
        return json(isPage
          ? await Promise.all(records.map((page) => legacyPageFor(content, context, page)))
          : records.map(legacyForm));
      }
      if (method === 'POST') {
        await sessionService.authorize(context, capability, projectId);
        const input = await body(req);
        const record = isPage
          ? await content.createPage({
            name: input.name,
            route: input.route ?? routeFor(input.name),
            template: input.template,
            editorState: input.editorState ?? input.project,
            renderedHtml: input.renderedHtml ?? input.html,
            companyId: context.companyId,
            projectId,
            actorId: context.user.id,
          })
          : await content.createForm({
            name: input.name,
            route: input.route ?? input.slug ?? routeFor(input.name),
            draftSchema: input.draftSchema ?? initialLegacyForm(),
            companyId: context.companyId,
            projectId,
            actorId: context.user.id,
          });
        return json(isPage ? legacyPage(record) : await publishLegacyForm(content, context, projectId, record), 201);
      }
    }

    if (!action) {
      if (method === 'GET') {
        const record = isPage
          ? await content.getPage({ companyId: context.companyId, projectId, actorId: context.user.id, pageId: id })
          : await content.getForm({ companyId: context.companyId, projectId, actorId: context.user.id, formId: id });
        return json(isPage ? await legacyPageFor(content, context, record) : legacyForm(record));
      }
      if (method === 'PUT') {
        await sessionService.authorize(context, capability, projectId);
        const input = await body(req);
        if (isPage) content.validatePageSettings({ domain: input.domain, webhook: input.webhook });
        const record = isPage
          ? await content.updatePage({
            name: input.name,
            route: input.route,
            template: input.template,
            editorState: input.editorState ?? input.project,
            renderedHtml: input.renderedHtml ?? input.html,
            lockVersion: input.lockVersion ?? input.revision,
            companyId: context.companyId,
            projectId,
            actorId: context.user.id,
            pageId: id,
          })
          : await content.updateForm({
            ...legacyFormPatch(input, await content.getForm({ companyId: context.companyId, projectId, actorId: context.user.id, formId: id })),
            companyId: context.companyId,
            projectId,
            actorId: context.user.id,
            formId: id,
          });
        const settings = isPage
          ? await content.updatePageSettings({
            companyId: context.companyId, projectId, actorId: context.user.id, pageId: id,
            domain: input.domain, webhook: input.webhook,
          })
          : null;
        return json(isPage ? legacyPage(record, settings) : await publishLegacyForm(content, context, projectId, record));
      }
      if (method === 'DELETE') {
        await sessionService.authorize(context, capability, projectId);
        await body(req);
        const record = isPage
          ? await content.removePage({ companyId: context.companyId, projectId, actorId: context.user.id, pageId: id })
          : await content.removeForm({ companyId: context.companyId, projectId, actorId: context.user.id, formId: id });
        return json(record);
      }
    }

    if (method === 'POST' && action === 'duplicate') {
      await sessionService.authorize(context, capability, projectId);
      await body(req);
      const record = isPage
        ? await content.duplicatePage({ companyId: context.companyId, projectId, actorId: context.user.id, pageId: id })
        : await content.duplicateForm({ companyId: context.companyId, projectId, actorId: context.user.id, formId: id });
      return json(isPage ? legacyPage(record) : await publishLegacyForm(content, context, projectId, record), 201);
    }
    if (!isPage && method === 'GET' && action === 'submissions') {
      await sessionService.authorize(context, 'submission.read', projectId);
      return json(await content.submissions({ companyId: context.companyId, projectId, actorId: context.user.id, formId: id }));
    }
    if (isPage && ['publish', 'status', 'domain'].includes(action)) {
      if (method === 'POST') await body(req);
      throw fail('A publicação Vercel por projeto ainda está pendente.', 409);
    }
    throw fail('Não encontrado.', 404);
  };
}
