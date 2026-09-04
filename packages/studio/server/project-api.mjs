function fail(message, status = 400) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

function rejectsLegacyProject(input) {
  if (Object.hasOwn(input ?? {}, 'project')) throw fail('Use editorState para o estado do editor.', 400);
}

export function createProjectApi({ sessionService, companies, projects, content, body, secure = false }) {
  return async function projectApi({ req, res, path, method, json }) {
    if (method === 'GET' && path === '/api/session') return json(await sessionService.state(req));
    if (method === 'POST' && path === '/api/setup') {
      const context = await sessionService.setup(await body(req));
      await sessionService.issue(res, context, secure);
      return json(await sessionService.stateFor(context), 201);
    }
    if (method === 'POST' && path === '/api/login') {
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

    if (!path.startsWith('/api/')) return false;
    const context = await sessionService.require(req);
    if (method === 'GET' && path === '/api/companies') return json(await sessionService.companiesFor(context.user.id));
    if (method === 'GET' && path === '/api/projects') return json(await projects.listForUser({ companyId: context.companyId, userId: context.user.id }));
    if (method === 'POST' && path === '/api/projects') {
      await sessionService.authorize(context, 'project.manage');
      const input = await body(req);
      rejectsLegacyProject(input);
      return json(await projects.create({ companyId: context.companyId, actorUserId: context.user.id, name: input.name, slug: input.slug }), 201);
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
        return json(await projects.update({ companyId: context.companyId, projectId, actorUserId: context.user.id, name: input.name, slug: input.slug }));
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
        return json(kind === 'pages'
          ? await content.createPage({ companyId: context.companyId, projectId, actorId: context.user.id, ...input })
          : await content.createForm({ companyId: context.companyId, projectId, actorId: context.user.id, ...input }), 201);
      }
    }

    if (path === '/api/pages' || path === '/api/forms') {
      const projectId = context.currentProjectId;
      if (!projectId) throw fail('Escolha um projeto ativo.', 409);
      const kind = path.endsWith('/pages') ? 'pages' : 'forms';
      await sessionService.authorize(context, null, projectId);
      if (method === 'GET') return json(kind === 'pages'
        ? await content.listPages({ companyId: context.companyId, projectId, actorId: context.user.id })
        : await content.listForms({ companyId: context.companyId, projectId, actorId: context.user.id }));
      if (method === 'POST') {
        await sessionService.authorize(context, kind === 'pages' ? 'page.write' : 'form.write', projectId);
        const input = await body(req);
        rejectsLegacyProject(input);
        return json(kind === 'pages'
          ? await content.createPage({ companyId: context.companyId, projectId, actorId: context.user.id, ...input })
          : await content.createForm({ companyId: context.companyId, projectId, actorId: context.user.id, ...input }), 201);
      }
    }
    return false;
  };
}
