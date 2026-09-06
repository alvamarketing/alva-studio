import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { Publisher } from './publisher.mjs';
import { Auth } from './auth.mjs';
import { FormStore } from './form-store.mjs';
import { renderDynamicForm, renderCompletion } from './dynamic-form.mjs';
import { SessionService } from './session-service.mjs';
import { createProjectApi } from './project-api.mjs';
import { CompanyRepository } from './repositories/company-repository.mjs';
import { ProjectRepository } from './repositories/project-repository.mjs';
import { ContentRepository } from './repositories/content-repository.mjs';
import { VideoRepository } from './repositories/video-repository.mjs';
import { AnalyticsRepository } from './repositories/analytics-repository.mjs';
import { parseCollectPayload, createCollectLimiter } from './analytics-collect.mjs';
import { createNonce, formContentSecurityPolicy } from './content-security-policy.mjs';
import { validateWebhookUrl } from './outbound-webhook.mjs';
import { WebhookDeliveryRepository } from './repositories/webhook-repository.mjs';
import { startWebhookWorker } from './webhook-worker.mjs';
import { normalizeRoute } from './domain/access.mjs';
import { createDatabase, migrate } from './db/postgres.mjs';
import { PublicationSnapshotBuilder, extractVslReferences } from './publication-snapshot.mjs';
import { resolvePublishedVslReferencesForRender } from './vsl-reference.mjs';
import { PublicationService } from './publication-service.mjs';
import { AuditRepository, DeploymentRepository, ProjectDomainRepository, ProjectIntegrationRepository, SecretVault } from './repositories/publication-repository.mjs';
import { customDomainOriginAllowed, publicSubmissionCors } from './publication-cors.mjs';
import { renderVslPage, vslContentSecurityPolicy } from './vsl-public.mjs';
import { readRuntimeFlags } from './runtime-flags.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const error = (message, status) => Object.assign(new Error(message), { status });

function decodedSegment(value) {
  const decoded = decodeURIComponent(value);
  if (!decoded || decoded.includes('/') || decoded.includes('\\')) throw new Error('segmento inválido');
  return decoded;
}

function encodedRoute(route) {
  return route === '/' ? '' : route.slice(1).split('/').map(encodeURIComponent).join('/');
}

function parsePublicFormRequest(path, method, domainScope) {
  let encoded;
  if (method === 'GET') {
    if (path === '/f') encoded = '';
    else if (path.startsWith('/f/')) encoded = path.slice(3);
    else return null;
    if (encoded.endsWith('/')) encoded = encoded.slice(0, -1);
  } else if (method === 'POST' || method === 'OPTIONS') {
    const prefix = '/api/public/forms';
    const suffix = '/submissions';
    if ((path !== prefix && !path.startsWith(`${prefix}/`)) || !path.endsWith(suffix)) return null;
    encoded = path.slice(prefix.length, -suffix.length);
    if (encoded.startsWith('/')) encoded = encoded.slice(1);
    if (encoded.endsWith('/')) encoded = encoded.slice(0, -1);
  } else return null;

  try {
    const segments = encoded === '' ? [] : encoded.split('/').map(decodedSegment);
    let companySlug;
    let projectSlug;
    let routeSegments = segments;
    if (!domainScope) {
      if (segments.length < 2 || !segments.slice(0, 2).every((segment) => /^[a-z0-9-]{1,80}$/.test(segment))) return null;
      [companySlug, projectSlug] = segments;
      routeSegments = segments.slice(2);
    }
    const route = normalizeRoute(routeSegments.length ? `/${routeSegments.join('/')}` : '/');
    const routePath = encodedRoute(route);
    const namespace = domainScope
      ? ''
      : `/${encodeURIComponent(companySlug)}/${encodeURIComponent(projectSlug)}`;
    return {
      companySlug,
      projectSlug,
      route,
      action: `/api/public/forms${namespace}${routePath ? `/${routePath}` : ''}/submissions`,
    };
  } catch {
    return null;
  }
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw error('Envie JSON.', 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw error('Página muito grande. Use URLs para imagens.', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  } catch {
    throw error('JSON inválido.', 400);
  }
}
async function publicAnswers(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 5 * 1024 * 1024) throw error('Resposta muito grande.', 413);
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString();
  if (req.headers['content-type']?.startsWith('application/json')) {
    try { return JSON.parse(raw || '{}'); } catch { throw error('Resposta inválida.', 400); }
  }
  if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) throw error('Envie o formulário no formato esperado.', 415);
  return { answers: Object.fromEntries(new URLSearchParams(raw)) };
}
async function collectBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    // Teto generoso: parseCollectPayload já recusa acima de 64 KB com a mensagem
    // e o status corretos; este limite é só uma rede de segurança contra leitura ilimitada.
    if (size > 128 * 1024) throw error('Corpo muito grande.', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// getPublicVideo() propositalmente não devolve companyId/projectId (dado interno, não público);
// resolvemos o tracker do projeto direto pelo public_id do vídeo, sem tocar em video-repository.mjs.
async function trackerPublicIdForVideo(database, videoPublicId) {
  const { rows } = await database.query(
    `SELECT website.tracker_public_id
       FROM videos video
       JOIN analytics_websites website
         ON website.company_id = video.company_id AND website.project_id = video.project_id AND website.environment = 'production'
      WHERE video.public_id = $1`,
    [videoPublicId],
  );
  return rows[0]?.tracker_public_id || null;
}

async function trackerPublicIdForProject(database, companyId, projectId) {
  const { rows } = await database.query(
    `SELECT tracker_public_id FROM analytics_websites
      WHERE company_id = $1 AND project_id = $2 AND environment = 'production' LIMIT 1`,
    [companyId, projectId],
  );
  return rows[0]?.tracker_public_id || null;
}

// Mesmo padrão de startWebhookWorker: laço independente do ciclo de requisição,
// unref() para não segurar o processo vivo, e parado explicitamente no close do servidor.
function startAnalyticsRetentionWorker({ analytics, intervalMs = 24 * 60 * 60 * 1000 }) {
  let stopped = false;
  const runOnce = () => analytics.purgeExpired();
  const tick = async () => {
    if (stopped) return;
    try { await runOnce(); } catch { /* um tick com erro não deve interromper o próximo */ }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return {
    stop: () => { stopped = true; clearInterval(timer); },
    runOnce,
  };
}

export function createApp({
  dataDir = process.env.DATA_DIR || join(root, '.data'),
  publisher: injectedPublisher,
  authOptions,
  database,
  sessionOptions,
  publicOrigin = process.env.PUBLIC_ORIGIN,
  webhookFetch,
  dnsLookup,
  webhookTimeoutMs,
  webhookIntervalMs,
  analyticsRetentionIntervalMs,
  collectLimiterOptions,
  runtimeFlags = readRuntimeFlags(),
} = {}) {
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (url.protocol !== 'https:' || url.origin !== publicOrigin || url.username || url.password)
      throw new Error('PUBLIC_ORIGIN deve ser uma origem HTTPS exata.');
  }
  const auth = new Auth(dataDir, authOptions);
  const getPublisher = async () => injectedPublisher || new Publisher(await auth.credentials());
  const store = new Store(dataDir);
  const formStore = new FormStore(dataDir);
  const content = database ? new ContentRepository(database, { publicOrigin }) : null;
  const videos = database ? new VideoRepository(database) : null;
  const analytics = database ? new AnalyticsRepository(database) : null;
  const collectLimiter = createCollectLimiter(collectLimiterOptions);
  const analyticsRetention = analytics
    ? startAnalyticsRetentionWorker({
      analytics,
      ...(analyticsRetentionIntervalMs === undefined ? {} : { intervalMs: analyticsRetentionIntervalMs }),
    })
    : null;
  const webhookWorker = database
    ? startWebhookWorker({
      repository: new WebhookDeliveryRepository(database),
      dnsLookup,
      fetchImpl: webhookFetch,
      ...(webhookTimeoutMs === undefined ? {} : { timeoutMs: webhookTimeoutMs }),
      ...(webhookIntervalMs === undefined ? {} : { intervalMs: webhookIntervalMs }),
    })
    : null;
  const integrations = database && process.env.VERCEL_MASTER_KEY ? new ProjectIntegrationRepository(database, { vault: new SecretVault() }) : null;
  const deployments = database ? new DeploymentRepository(database) : null;
  const publication = database
    ? new PublicationService({
      snapshotBuilder: new PublicationSnapshotBuilder({ database, publicOrigin }),
      integrations,
      deployments,
      publisherFactory: (credentials) => injectedPublisher || new Publisher(credentials),
      audit: new AuditRepository(database),
      domains: new ProjectDomainRepository(database),
    })
    : null;
  const projectApi = database
    ? createProjectApi({
      sessionService: new SessionService(database, sessionOptions),
      companies: new CompanyRepository(database),
      projects: new ProjectRepository(database),
      content,
      videos,
      analytics,
      body,
      secure: Boolean(publicOrigin),
      limit: (address) => auth.limit(address),
      validateWebhook: validateWebhookUrl,
      integrations,
      publication,
      runtimeFlags,
      setupAllowed: (req) => {
        const expected = `127.0.0.1:${req.socket.localPort}`;
        const localHost = req.headers.host === expected || req.headers.host === `localhost:${req.socket.localPort}`;
        return !publicOrigin && localHost && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
      },
    })
    : null;
  const publishing = new Set();
  const files = {
    '/': ['public/index.html', 'text/html'],
    '/owner.js': ['public/owner.js', 'text/javascript'],
    '/owner.css': ['public/owner.css', 'text/css'],
    '/editor-shell.js': ['public/editor-shell.js', 'text/javascript'],
    '/editor-shell.css': ['public/editor-shell.css', 'text/css'],
    '/app.js': ['public/app.js', 'text/javascript'],
    '/ui-preferences.js': ['public/ui-preferences.js', 'text/javascript'],
    '/forms.js': ['public/forms.js', 'text/javascript'],
    '/editor-workspace.js': ['public/editor-workspace.js', 'text/javascript'],
    '/studio-shell.js': ['public/studio-shell.js', 'text/javascript'],
    '/studio-context-boundary.js': ['public/studio-context-boundary.js', 'text/javascript'],
    '/context-list.js': ['public/context-list.js', 'text/javascript'],
    '/studio-dashboard.js': ['public/studio-dashboard.js', 'text/javascript'],
    '/forms.css': ['public/forms.css', 'text/css'],
    '/save-cycle.js': ['public/save-cycle.js', 'text/javascript'],
    '/styles.css': ['public/styles.css', 'text/css'],
    '/templates.js': ['public/templates.js', 'text/javascript'],
    '/vendor/grapes.min.js': ['node_modules/grapesjs/dist/grapes.min.js', 'text/javascript'],
    '/vendor/grapes.min.css': ['node_modules/grapesjs/dist/css/grapes.min.css', 'text/css'],
    '/vendor/pt.js': ['node_modules/grapesjs/locale/pt.js', 'text/javascript'],
    '/vsl-player.js': ['public/vsl-player.js', 'text/javascript'],
    '/tracker.js': ['public/tracker.js', 'text/javascript'],
    '/vsl-ui.js': ['public/vsl-ui.js', 'text/javascript'],
    '/leads-ui.js': ['public/leads-ui.js', 'text/javascript'],
    '/vendor/hls.min.js': ['node_modules/hls.js/dist/hls.min.js', 'text/javascript'],
  };
  const server = createServer(async (req, res) => {
    const json = (data, status = 200) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(data));
    };
    try {
      const expected = '127.0.0.1:' + res.socket.localPort;
      const localHost = req.headers.host === expected || req.headers.host === 'localhost:' + res.socket.localPort;
      const expectedOrigin = publicOrigin || 'http://' + req.headers.host;
      const path = new URL(req.url, 'http://' + expected).pathname;
      const publicVsl = req.method === 'GET' ? path.match(/^\/(embed\/)?v\/([^/]+)$/) : null;
      const studioHost = publicOrigin && req.headers.host === new URL(publicOrigin).host;
      const domainScope = Boolean(publicOrigin && !studioHost);
      const publicFormRequest = content ? parsePublicFormRequest(path, req.method, domainScope) : null;
      const legacyPublicSubmission = !content && req.method === 'POST' && /^\/api\/public\/forms\/[^/]+\/submit$/.test(path);
      const publicSubmission = legacyPublicSubmission || Boolean(publicFormRequest && req.method === 'POST');
      const publicDomainRead = Boolean(publicFormRequest && domainScope && req.method === 'GET');
      const publicDomainRequest = Boolean(publicFormRequest && domainScope);
      const publicProjectSubmission = Boolean(publicFormRequest && !domainScope && (req.method === 'POST' || req.method === 'OPTIONS'));
      const publicCollect = path === '/api/public/collect' && (req.method === 'POST' || req.method === 'OPTIONS');
      if (publicOrigin ? (!studioHost && !publicDomainRequest) : !localHost)
        throw error('Endereço não permitido.', 403);
      const origin = req.headers.origin;
      const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (!publicSubmission && !publicDomainRead && !publicProjectSubmission && !publicCollect && !publicVsl && ((origin && origin !== expectedOrigin) || (mutation && origin !== expectedOrigin)))
        throw error('Origem não permitida.', 403);
      // Navegação de nível superior (clique em link de outro site) não é um ataque cross-site: libera fora de /api/.
      const topLevelNavigation = req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document' && !path.startsWith('/api/');
      if (!publicSubmission && !publicDomainRead && !publicProjectSubmission && !publicCollect && !publicVsl && !topLevelNavigation && req.headers['sec-fetch-site'] === 'cross-site') throw error('Origem não permitida.', 403);
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      const secure = Boolean(publicOrigin);
      // Report-Only por enquanto: só reporta violação, nunca bloqueia — a migração para modo
      // reforçado é decisão futura, depois que todo script inline aceitar o nonce.
      const publicHtmlNonce = (actionOrigin) => {
        const nonce = createNonce();
        res.setHeader('Content-Security-Policy-Report-Only', formContentSecurityPolicy({
          nonce, studioOrigin: publicOrigin || expectedOrigin, actionOrigin, reportOnly: true,
        }));
        return nonce;
      };
      if (content && publicProjectSubmission) {
        const requestOrigin = req.headers.origin;
        const allowedOrigins = requestOrigin && requestOrigin !== expectedOrigin
          ? await content.publicationOrigins({ companySlug: publicFormRequest.companySlug, projectSlug: publicFormRequest.projectSlug })
          : [];
        const cors = publicSubmissionCors({ method: req.method, origin: requestOrigin, expectedOrigin, allowedOrigins });
        if (!cors.allowed) throw error('Origem não autorizada para este projeto.', 403);
        if (cors.corsOrigin) {
          res.setHeader('Access-Control-Allow-Origin', cors.corsOrigin);
          res.setHeader('Vary', 'Origin');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        }
        if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      }
      if (content && publicDomainRequest && !customDomainOriginAllowed(origin, req.headers.host))
        throw error('Origem não autorizada para este domínio.', 403);
      if (analytics && content && publicCollect) {
        if (req.method === 'OPTIONS') {
          // O preflight não traz tracker_public_id, portanto não pode abrir uma origem arbitrária.
          // O tracker usa text/plain (simple request); requests com preflight só continuam na origem
          // do próprio Studio e o POST ainda valida tracker + domínio publicado abaixo.
          if (origin === expectedOrigin) res.setHeader('Vary', 'Origin');
          res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.writeHead(204);
          return res.end();
        }
        // Gate barato por IP antes de ler/parsear qualquer corpo: descarta abuso sem tocar no banco.
        if (!collectLimiter.allow({ ip: req.socket.remoteAddress })) throw error('Muitos eventos. Tente novamente em instantes.', 429);
        // O escopo (empresa/projeto) vem sempre de resolveWebsite(), nunca do corpo enviado pelo navegador.
        const { trackerPublicId, event } = parseCollectPayload(await collectBody(req), req.headers['content-type']);
        if (!collectLimiter.allow({ ip: req.socket.remoteAddress, trackerPublicId })) throw error('Muitos eventos. Tente novamente em instantes.', 429);
        const website = await analytics.resolveWebsite({ trackerPublicId });
        const allowedOrigins = website && origin && origin !== expectedOrigin
          ? await content.publicationOrigins({ companySlug: website.companySlug, projectSlug: website.projectSlug })
          : [];
        const cors = publicSubmissionCors({ method: 'POST', origin, expectedOrigin, allowedOrigins });
        // Tracker inexistente e origem não autorizada respondem igual: um 404 aqui vazaria se um
        // tracker_public_id qualquer existe ou não para quem tenta adivinhar um (revisão de segurança).
        if (!website || !cors.allowed) throw error('Não foi possível registrar o evento.', 403);
        if (cors.corsOrigin) {
          res.setHeader('Access-Control-Allow-Origin', cors.corsOrigin);
          res.setHeader('Vary', 'Origin');
        }
        const visitorHash = analytics.visitorHash({
          websiteId: website.websiteId,
          address: req.socket.remoteAddress,
          userAgent: req.headers['user-agent'],
        });
        await analytics.ingest({
          websiteId: website.websiteId,
          companyId: website.companyId,
          projectId: website.projectId,
          visitorHash,
          event: {
            type: event.event_name === 'pageview' ? 'pageview' : 'custom',
            eventName: event.event_name,
            urlPath: event.url_path,
            urlQuery: event.url_query,
            referrer: event.referrer,
            eventData: event.event_data,
          },
        });
        // Nenhuma resposta do coletor devolve conteúdo — só status, para não vazar nada ao visitante.
        res.writeHead(204);
        return res.end();
      }
      if (projectApi && path.startsWith('/api/') && !path.startsWith('/api/public/')) {
        const handled = await projectApi({ req, res, path, method: req.method, json });
        if (handled !== false) return handled;
      }
      if (content && videos && publicVsl) {
        const embed = Boolean(publicVsl[1]);
        const video = await videos.getPublicVideo(publicVsl[2]);
        res.removeHeader('X-Frame-Options');
        res.setHeader('Content-Security-Policy', vslContentSecurityPolicy(video.sourceUrl, { embed, posterUrl: video.posterUrl, captionsUrl: video.captionsUrl, studioOrigin: publicOrigin || expectedOrigin }));
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        const trackerPublicId = analytics ? await trackerPublicIdForVideo(database, publicVsl[2]) : null;
        return res.end(renderVslPage(video, { embed, publicOrigin: publicOrigin || expectedOrigin, trackerPublicId }));
      }
      if (req.method === 'GET' && path === '/api/session') return json(await auth.state(req));
      if (req.method === 'POST' && (path === '/api/setup' || path === '/api/login')) {
        auth.limit(req.socket.remoteAddress);
        if (
          path === '/api/setup' &&
          (publicOrigin || !localHost || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress))
        )
          throw error('Crie a conta primeiro pelo servidor local.', 403);
        const input = await body(req);
        const owner = path === '/api/setup' ? await auth.setup(input) : await auth.login(input);
        auth.issue(res, secure);
        return json({ setupRequired: false, authenticated: true, owner }, path === '/api/setup' ? 201 : 200);
      }
      if (req.method === 'GET' && content && publicFormRequest) {
        const form = domainScope
          ? await content.publicFormForDomain({ host: req.headers.host, route: publicFormRequest.route })
          : await content.publicFormForProject({
            companySlug: publicFormRequest.companySlug,
            projectSlug: publicFormRequest.projectSlug,
            route: publicFormRequest.route,
          });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        const resolved = await resolvePublishedVslReferencesForRender({
          database, companyId: form.companyId, projectId: form.projectId, publicOrigin: publicOrigin || expectedOrigin,
          references: extractVslReferences(form),
        });
        const vslEmbedUrls = new Map([...resolved].map(([publicId, value]) => [publicId, value.embedUrl]));
        const nonce = publicHtmlNonce(`${publicOrigin || expectedOrigin}${publicFormRequest.action}`);
        const trackerPublicId = analytics ? await trackerPublicIdForProject(database, form.companyId, form.projectId) : null;
        return res.end(renderDynamicForm(form, publicFormRequest.action, { vslEmbedUrls, nonce, trackerPublicId }));
      }
      const localForm = !content && path.match(/^\/f\/([a-z0-9-]+)$/);
      if (req.method === 'GET' && localForm) {
        const form = await formStore.getBySlug(localForm[1]);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        const action = `/api/public/forms/${form.id}/submit`;
        const nonce = publicHtmlNonce(`${expectedOrigin}${action}`);
        return res.end(renderDynamicForm(form, action, { nonce }));
      }
      const submission = path.match(/^\/api\/public\/forms\/([^/]+)\/submit$/);
      if (req.method === 'POST' && content && publicFormRequest) {
        const input = await publicAnswers(req);
        const saved = domainScope
          ? await content.submitPublicFormForDomain({ host: req.headers.host, route: publicFormRequest.route, input })
          : await content.submitPublicFormForProject({
            companySlug: publicFormRequest.companySlug,
            projectSlug: publicFormRequest.projectSlug,
            route: publicFormRequest.route,
            input,
          });
        await analytics?.recordLead({
          companyId: saved.form.companyId,
          projectId: saved.form.projectId,
          formId: saved.form.id,
          trackingEventId: saved.eventId,
          urlPath: publicFormRequest.route,
        });
        const form = { ...saved.schema, id: saved.form.id, name: saved.form.name, slug: saved.form.slug };
        // A entrega do webhook é enfileirada por submitPublishedForm (mesma transação da
        // submissão) e processada de forma assíncrona pelo webhookWorker — a resposta ao
        // visitante nunca espera uma tentativa de rede de saída.
        if (saved.webhookDelivery) res.setHeader('X-Webhook-Delivery', saved.webhookDelivery.status);
        const completion = form.completion || { title: 'Obrigado!', message: 'Recebemos suas respostas.' };
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        const nonce = publicHtmlNonce(`${publicOrigin || expectedOrigin}${publicFormRequest.action}`);
        return res.end(renderCompletion(completion.title, completion.message, { nonce }));
      }
      if (content && submission) throw error('Formulário publicado não encontrado.', 404);
      if (req.method === 'POST' && submission) {
        const form = await formStore.get(submission[1]);
        const saved = await formStore.submit(form.id, await publicAnswers(req));
        if (form.webhook) res.setHeader('X-Webhook-Delivery', 'pending');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        const nonce = publicHtmlNonce(`${expectedOrigin}/api/public/forms/${submission[1]}/submit`);
        return res.end(renderCompletion(form.completion.title, form.completion.message, { nonce }));
      }
      if (path.startsWith('/api/') && !(await auth.state(req)).authenticated)
        throw error('Entre na sua conta para continuar.', 401);
      if (req.method === 'POST' && path === '/api/logout') {
        await body(req);
        auth.logout(req, res, secure);
        return json({ ok: true });
      }
      if (req.method === 'PUT' && path === '/api/account') {
        auth.limit(req.socket.remoteAddress);
        const owner = await auth.account(await body(req));
        auth.issue(res, secure);
        return json({ setupRequired: false, authenticated: true, owner });
      }
      if (req.method === 'GET' && path === '/api/settings') return json(await auth.settings());
      if (req.method === 'PUT' && path === '/api/settings/vercel')
        return json(await auth.settingsUpdate(await body(req)));
      if (req.method === 'POST' && path === '/api/settings/vercel/test') {
        await body(req);
        return json(await (await getPublisher()).testConnection());
      }
      if (req.method === 'GET' && path === '/api/config')
        return json({ vercelConnected: (await getPublisher()).connected });
      if (path === '/api/forms') {
        if (req.method === 'GET') return json(await formStore.list());
        if (req.method === 'POST') return json(await formStore.create(await body(req)), 201);
      }
      const formMatch = path.match(/^\/api\/forms\/([^/]+)(?:\/(duplicate|submissions))?$/);
      if (formMatch) {
        const [, id, action] = formMatch;
        if (req.method === 'GET' && !action) return json(await formStore.get(id));
        if (req.method === 'PUT' && !action) return json(await formStore.update(id, await body(req)));
        if (req.method === 'DELETE' && !action) {
          await body(req);
          return json(await formStore.remove(id));
        }
        if (req.method === 'POST' && action === 'duplicate') {
          await body(req);
          return json(await formStore.duplicate(id), 201);
        }
        if (req.method === 'GET' && action === 'submissions') return json(await formStore.submissions(id));
      }
      if (path === '/api/pages') {
        if (req.method === 'GET') return json(await store.list());
        if (req.method === 'POST') return json(await store.create(await body(req)), 201);
      }
      const match = path.match(/^\/api\/pages\/([^/]+)(?:\/(duplicate|publish|status|domain))?$/);
      if (match) {
        const [, id, action] = match;
        if (req.method === 'GET' && !action) return json(await store.get(id));
        if (req.method === 'PUT' && !action) return json(await store.update(id, await body(req)));
        if (req.method === 'DELETE' && !action) {
          await body(req);
          if (publishing.has(id)) throw error('Espere a publicação terminar.', 409);
          return json(await store.remove(id));
        }
        if (req.method === 'POST' && action === 'duplicate') {
          await body(req);
          return json(await store.duplicate(id), 201);
        }
        if (req.method === 'POST' && action === 'publish') {
          const publisher = await getPublisher();
          const input = await body(req);
          if (publishing.has(id)) throw error('Já existe uma publicação em andamento.', 409);
          publishing.add(id);
          try {
            const page = await store.get(id);
            if (input.revision !== page.revision) throw error('Salve a versão atual antes de publicar.', 409);
            const result = await publisher.publish(page);
            await store.setDeployment(id, result);
            return json(result);
          } finally {
            publishing.delete(id);
          }
        }
        if (req.method === 'GET' && action === 'status') {
          const page = await store.get(id);
          if (!page.deployment) return json(null);
          const publisher = await getPublisher();
          const state = await publisher.status(page.deployment.id);
          const deployment = { ...page.deployment, ...state };
          const current = await store.setDeployment(id, deployment, page.deployment.id);
          return json(current.deployment);
        }
        if (req.method === 'POST' && action === 'domain') {
          await body(req);
          const publisher = await getPublisher();
          return json(await publisher.domain(await store.get(id)));
        }
      }
      if (req.method === 'GET' && files[path]) {
        const [file, type] = files[path];
        res.setHeader('Content-Type', type + '; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        const content = await readFile(join(root, file));
        return res.end(
          path === '/vendor/pt.js'
            ? '(()=>{const exports={};' + content.toString() + ';window.alvaLocale=exports.default;})();'
            : content,
        );
      }
      throw error('Não encontrado.', 404);
    } catch (e) {
      if (!res.headersSent)
        json({ error: (e.status || e.statusCode) ? e.message : 'Não foi possível concluir. Tente novamente.' }, e.status || e.statusCode || 500);
      else res.end();
    }
  });
  if (webhookWorker) {
    server.webhookWorker = webhookWorker;
    server.once('close', () => webhookWorker.stop());
  }
  if (analyticsRetention) {
    server.analyticsRetention = analyticsRetention;
    server.once('close', () => analyticsRetention.stop());
  }
  return server;
}
function validateHost(host, publicOrigin) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !process.env.PUBLIC_ORIGIN)
    throw new Error('HOST externo exige PUBLIC_ORIGIN HTTPS.');
}

export async function startSaaS({
  connectionString = process.env.DATABASE_URL,
  port = Number(process.env.PORT || 4178),
  host = process.env.HOST || '127.0.0.1',
  createDatabaseFn = createDatabase,
  migrateFn = migrate,
  appFactory = createApp,
  log = console.log,
} = {}) {
  if (typeof connectionString !== 'string' || !connectionString.trim())
    throw new Error('DATABASE_URL é obrigatória para iniciar o Studio SaaS. Use start:legacy apenas para migração ou rollback local.');
  validateHost(host, process.env.PUBLIC_ORIGIN);
  let database;
  let app;
  try {
    database = createDatabaseFn({ connectionString });
    await migrateFn(database);
    app = appFactory({ database });
    await new Promise((resolve, reject) => {
      app.once('error', reject);
      app.listen(port, host, () => {
        app.off('error', reject);
        resolve();
      });
    });
  } catch (startupError) {
    await database?.close?.().catch(() => {});
    throw startupError;
  }
  let closed = false;
  return {
    app,
    database,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((resolve) => app.close(resolve));
      await database.close();
    },
    address: () => app.address(),
    log: () => log(`Alva Studio SaaS: http://${host}:${app.address().port}`),
  };
}

export async function startLegacy({
  port = Number(process.env.PORT || 4178),
  host = process.env.HOST || '127.0.0.1',
  appFactory = createApp,
  log = console.log,
} = {}) {
  validateHost(host, process.env.PUBLIC_ORIGIN);
  const app = appFactory();
  await new Promise((resolve, reject) => {
    app.once('error', reject);
    app.listen(port, host, () => {
      app.off('error', reject);
      resolve();
    });
  });
  log(`Alva Studio legado: http://${host}:${app.address().port}`);
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const legacy = process.argv.includes('--legacy');
  try {
    const runtime = legacy ? { app: await startLegacy() } : await startSaaS();
    if (!legacy) runtime.log();
    const shutdown = async () => {
      if (runtime.close) await runtime.close();
      else await new Promise((resolve) => runtime.app.close(resolve));
      process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch {
    console.error(legacy ? 'Não foi possível iniciar o Studio legado.' : 'Não foi possível iniciar o Studio SaaS.');
    process.exitCode = 1;
  }
}
