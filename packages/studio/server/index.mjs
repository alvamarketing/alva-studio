import { ipDoVisitante } from './ip-do-visitante.mjs';
import { createServer } from 'node:http';
import { blocoDeTokens } from './tokens-css.mjs';
import { FunnelRepository } from './repositories/funnel-repository.mjs';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { Publisher } from './publisher.mjs';
import { Auth } from './auth.mjs';
import { renderCompletion } from './pagina-de-obrigado.mjs';
import { SessionService } from './session-service.mjs';
import { createProjectApi } from './project-api.mjs';
import { CompanyRepository } from './repositories/company-repository.mjs';
import { ProjectRepository } from './repositories/project-repository.mjs';
import { ContentRepository } from './repositories/content-repository.mjs';
import { VideoRepository } from './repositories/video-repository.mjs';
import { AnalyticsRepository } from './repositories/analytics-repository.mjs';
import { parseCollectPayload, createCollectLimiter } from './analytics-collect.mjs';
import { derivarAudiencia } from './analytics-audiencia.mjs';
import { createNonce, formContentSecurityPolicy } from './content-security-policy.mjs';
import { validateWebhookUrl } from './outbound-webhook.mjs';
import { WebhookDeliveryRepository } from './repositories/webhook-repository.mjs';
import { startWebhookWorker } from './webhook-worker.mjs';
import { normalizeRoute } from './domain/access.mjs';
import { createDatabase, migrate } from './db/postgres.mjs';
import { PublicationSnapshotBuilder } from './publication-snapshot.mjs';
import { PublicationService } from './publication-service.mjs';
import { AuditRepository, DeploymentRepository, ProjectDomainRepository, ProjectIntegrationRepository, SecretVault } from './repositories/publication-repository.mjs';
import { TrackingRepository } from './repositories/tracking-repository.mjs';
import { ConversionsOutboxRepository } from './repositories/conversions-outbox-repository.mjs';
import { PublicationRuntimeRepository } from './repositories/publication-runtime-repository.mjs';
import { RuntimeConsentGateway } from './runtime-consent-gateway.mjs';
import { createRuntimeLoader } from './publication-runtime.mjs';
import { resolveConsentState } from './conversion-consent-policy.mjs';
import { runtimeManifest, cookiesDosPixels, verifiedRuntimeAttribution, verifyRuntimeGatewayEnvelope } from './runtime-gateway-security.mjs';
import { customDomainOriginAllowed, publicSubmissionCors } from './publication-cors.mjs';
import { medirEstaVisita, renderVslPage, vslContentSecurityPolicy } from './vsl-public.mjs';
import { CloudflareStream } from './cloudflare-stream.mjs';
import { readRuntimeFlags, requiredTrackingEngines } from './runtime-flags.mjs';
import { billingRuntimeEnvironment } from './runtime-flags.mjs';
import { AsaasClient } from './asaas-client.mjs';
import { BillingRepository } from './repositories/billing-repository.mjs';
import { BillingService } from './billing-service.mjs';
import { acceptBillingWebhook } from './billing-webhook.mjs';
import { BillingPolicy } from './billing-policy.mjs';
import { McpKeyRepository } from './repositories/mcp-repository.mjs';
import { createMcpServer } from './mcp-server.mjs';
import { ImageRepository } from './repositories/image-repository.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const error = (message, status) => Object.assign(new Error(message), { status });
const EVENTOS_DE_CONVERSAO = new Set(['vsl_start', 'vsl_progress', 'vsl_complete', 'vsl_cta_click']);

export function eventoDeConversaoVsl(normalized, input) {
  const payload = normalized?.payload;
  if (!payload || !EVENTOS_DE_CONVERSAO.has(payload.name)) return null;
  const trackingEventId = input?.payload?.data?.trackingEventId;
  if (typeof trackingEventId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trackingEventId)) return null;
  const data = payload.data || {};
  return {
    trackingEventId,
    eventName: payload.name,
    params: {
      ...(data.publicId ? { content_id: data.publicId } : {}),
      ...(Number.isInteger(data.value) ? { value: data.value } : {}),
    },
  };
}

function decodedSegment(value) {
  const decoded = decodeURIComponent(value);
  if (!decoded || decoded.includes('/') || decoded.includes('\\')) throw new Error('segmento inválido');
  return decoded;
}

export function parsePageCaptureRequest(path, method, domainScope) {
  if (!['POST', 'OPTIONS'].includes(method)) return null;
  const prefix = '/api/public/pages';
  const match = path.match(/^\/api\/public\/pages(?:\/(.*))?\/captures\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/submissions$/i);
  if (!match) return null;
  try {
    const segments = match[1] ? match[1].split('/').map(decodedSegment) : [];
    let companySlug; let projectSlug; let routeSegments = segments;
    if (!domainScope) {
      if (segments.length < 2 || !segments.slice(0, 2).every((segment) => /^[a-z0-9-]{1,80}$/.test(segment))) return null;
      [companySlug, projectSlug] = segments;
      routeSegments = segments.slice(2);
    }
    return { companySlug, projectSlug, route: normalizeRoute(routeSegments.length ? `/${routeSegments.join('/')}` : '/'), captureId: match[2] };
  } catch { return null; }
}
async function runtimeNamespaceMatches(database, manifest, companySlug, projectSlug) {
  if (!companySlug || !projectSlug) return true;
  if (!database || !manifest?.companyId || !manifest?.projectId) return false;
  const { rows } = await database.query(
    `SELECT company.slug AS company_slug, project.slug AS project_slug
       FROM projects project
       JOIN companies company ON company.id = project.company_id
      WHERE company.id = $1 AND project.id = $2 AND project.company_id = $1
      LIMIT 1`,
    [manifest.companyId, manifest.projectId],
  );
  return rows.length === 1 && rows[0].company_slug === companySlug && rows[0].project_slug === projectSlug;
}
// O visitante de uma captura publicada vem só de `runtimeGateway.client`: o IP e o
// navegador que o gateway leu da Vercel e assinou. Antes vinham do `x-forwarded-for` desta
// requisição — que, para uma captura, é o endereço da função da Vercel, igual para todo
// visitante. Sem assinatura, nada é enviado: nada é melhor que dado falso.
// Quem enviou. Pelo gateway, o visitante assinado — o IP e o navegador que chegam ao
// Studio ali são os da função da Vercel. Sem gateway, quem faz a requisição é o próprio
// navegador da pessoa, e o navegador dela vale.
// O IP não: atrás de um proxy, o endereço do socket é o do proxy, e a Meta pede o IP real.
// Quem fez a requisição, para reconhecer o mesmo envio repetido. Não sai do Studio: vira
// hash na chave de reenvio. Por isso, sem gateway, o endereço do socket serve aqui.
export function remetenteDoEnvio(req, gateway) {
  if (gateway) return gateway.client ?? {};
  return { ip: req.socket?.remoteAddress ?? null, userAgent: typeof req.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null };
}

export function clienteDoEnvio(req, gateway) {
  if (gateway) return gateway.client ?? {};
  return { ip: null, userAgent: typeof req.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null };
}

function runtimeAttribution(cookie, gateway, rootSecret) {
  const value = String(cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('alva_runtime_attribution='))?.slice('alva_runtime_attribution='.length);
  // Os cookies do pixel da Meta são lidos no envio: na primeira visita eles ainda não
  // existiam quando a página carregou o runtime.
  return gateway ? { ...verifiedRuntimeAttribution(value, gateway.manifest, rootSecret), ...cookiesDosPixels(cookie) } : {};
}
async function rawBody(req, max = 8 * 1024 * 1024, tooLarge = 'Página muito grande. Use URLs para imagens.') {
  if (req.alvaRawBody) {
    if (req.alvaRawBody.length > max) throw error(tooLarge, 413);
    return req.alvaRawBody;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw error(tooLarge, 413);
    chunks.push(chunk);
  }
  req.alvaRawBody = Buffer.concat(chunks);
  return req.alvaRawBody;
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw error('Envie JSON.', 415);
  try {
    return JSON.parse((await rawBody(req)).toString() || '{}');
  } catch {
    throw error('JSON inválido.', 400);
  }
}
async function publicAnswers(req) {
  const raw = (await rawBody(req, 5 * 1024 * 1024, 'Resposta muito grande.')).toString();
  if (req.headers['content-type']?.startsWith('application/json')) {
    try { return JSON.parse(raw || '{}'); } catch { throw error('Resposta inválida.', 400); }
  }
  if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) throw error('Envie o formulário no formato esperado.', 415);
  const answers = {};
  for (const [key, value] of new URLSearchParams(raw)) answers[key] = Object.hasOwn(answers, key) ? [].concat(answers[key], value) : value;
  return { answers };
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
  webhookWorkerEnabled = process.env.WEBHOOK_WORKER_ENABLED !== 'false',
  analyticsRetentionIntervalMs,
  collectLimiterOptions,
  runtimeFlags = readRuntimeFlags(),
  runtimeHmacSecret = process.env.PUBLICATION_RUNTIME_HMAC_SECRET,
  billingOptions = {},
} = {}) {
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (url.protocol !== 'https:' || url.origin !== publicOrigin || url.username || url.password)
      throw new Error('PUBLIC_ORIGIN deve ser uma origem HTTPS exata.');
  }
  const auth = new Auth(dataDir, authOptions);
  const getPublisher = async () => injectedPublisher || new Publisher(await auth.credentials());
  const store = new Store(dataDir);
  let content = null;
  const videos = database ? new VideoRepository(database) : null;
  // Hospedagem do vídeo na conta Cloudflare de quem opera o Studio. Fica desligada até
  // as credenciais existirem no ambiente: sem elas o Studio segue aceitando URL externa.
  if (runtimeFlags.mediaPipeline && !(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_STREAM_TOKEN))
    console.warn(JSON.stringify({ level: 'warn', event: 'media.pipeline.sem_credenciais', message: 'MEDIA_PIPELINE_ENABLED=true sem CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_STREAM_TOKEN: o envio de VSL vai falhar.' }));
  const videoHosting = runtimeFlags.mediaPipeline
    ? new CloudflareStream({
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
        apiToken: process.env.CLOUDFLARE_STREAM_TOKEN || '',
      })
    : null;
  const analytics = database ? new AnalyticsRepository(database) : null;
  const collectLimiter = createCollectLimiter(collectLimiterOptions);
  const analyticsRetention = analytics
    ? startAnalyticsRetentionWorker({
      analytics,
      ...(analyticsRetentionIntervalMs === undefined ? {} : { intervalMs: analyticsRetentionIntervalMs }),
    })
    : null;
  const webhookWorker = database && webhookWorkerEnabled
    ? startWebhookWorker({
      repository: new WebhookDeliveryRepository(database),
      dnsLookup,
      fetchImpl: webhookFetch,
      ...(webhookTimeoutMs === undefined ? {} : { timeoutMs: webhookTimeoutMs }),
      ...(webhookIntervalMs === undefined ? {} : { intervalMs: webhookIntervalMs }),
    })
    : null;
  const integrations = database && process.env.VERCEL_MASTER_KEY ? new ProjectIntegrationRepository(database, { vault: new SecretVault() }) : null;
  const tracking = database && process.env.TRACKING_MASTER_KEY ? new TrackingRepository(database) : null;
  const images = database ? new ImageRepository(database, { publicOrigin }) : null;
  const commercialOutbox = runtimeFlags.conversions && database && process.env.TRACKING_MASTER_KEY
    ? new ConversionsOutboxRepository(database) : null;
  // Capturas publicadas precisam do manifesto e do envelope assinado mesmo sem pixels.
  // Consentimento e loader continuam sendo uma capacidade opt-in de pixels.
  const runtimeManifests = database ? new PublicationRuntimeRepository(database) : null;
  const runtimeConsents = runtimeFlags.pixels ? runtimeManifests : null;
  const runtimeConsentGateway = runtimeConsents ? new RuntimeConsentGateway({ repository: runtimeConsents }) : null;
  const billingEnvironment = billingOptions.environment || billingRuntimeEnvironment();
  const billingRepository = database ? new BillingRepository(database) : null;
  const billingApiKey = billingOptions.apiKey || (billingEnvironment === 'production' ? process.env.ASAAS_PRODUCTION_API_KEY : process.env.ASAAS_SANDBOX_API_KEY);
  const billingWebhookSecret = billingOptions.webhookSecret || (billingEnvironment === 'production' ? process.env.ASAAS_PRODUCTION_WEBHOOK_TOKEN : process.env.ASAAS_SANDBOX_WEBHOOK_TOKEN);
  const billingClientFactory = billingOptions.clientFactory || ((environment) => new AsaasClient({ environment, apiKey: billingApiKey }));
  const billing = billingRepository ? {
    repository: billingRepository,
    summary: (scope) => billingRepository.summary({ ...scope, environment: billingEnvironment }),
    service: billingApiKey && publicOrigin
      ? new BillingService({ repository: billingRepository, clientFactory: billingClientFactory, site: publicOrigin, environment: billingEnvironment, audit: new AuditRepository(database) })
      : null,
  } : null;
  const billingPolicy = billingRepository ? new BillingPolicy({ environment: billingEnvironment, enforcement: runtimeFlags.billingEnforcement, repository: billingRepository }) : null;
  const commercialConsentResolver = runtimeConsents ? async ({ companyId, projectId, environment, origin, publicationId, subjectId }) => {
    const manifest = runtimeManifest(await runtimeConsents.currentForOrigin({ publicationId, origin }));
    if (!manifest || manifest.companyId !== companyId || manifest.projectId !== projectId || manifest.environment !== environment) throw error('Escopo de consentimento inválido.', 403);
    const storedConsent = subjectId ? await runtimeConsents.currentConsent({ manifest, subjectId }) : null;
    return resolveConsentState({ manifest, storedConsent });
  } : null;
  content = database ? new ContentRepository(database, { publicOrigin, commercialOutbox, commercialConsentResolver }) : null;
  const deployments = database ? new DeploymentRepository(database) : null;
  const publication = database
    ? new PublicationService({
      snapshotBuilder: new PublicationSnapshotBuilder({ database, publicOrigin }),
      integrations,
      deployments,
      publisherFactory: (credentials) => injectedPublisher || new Publisher(credentials),
      audit: new AuditRepository(database),
      domains: new ProjectDomainRepository(database, { billingPolicy }),
      tracking,
      runtimeManifests,
      runtimeEnabled: runtimeFlags.pixels === true,
      runtimeOrigin: publicOrigin || 'http://127.0.0.1',
      runtimeHmacSecret,
      trackingRequiredEngines: requiredTrackingEngines(runtimeFlags),
      billingPolicy,
    })
    : null;
  const companies = database ? new CompanyRepository(database, { billingPolicy }) : null;
  const projects = database ? new ProjectRepository(database, { billingPolicy }) : null;
  const mcp = database ? createMcpServer({
    database,
    keys: new McpKeyRepository(database),
    projects,
    content,
  }) : null;
  const projectApi = database
    ? createProjectApi({
      sessionService: new SessionService(database, sessionOptions),
      companies,
      projects,
      content,
      videos,
      videoHosting,
      images,
      funnels: database ? new FunnelRepository(database, { content }) : null,
      analytics,
      tracking,
      commercialOutbox,
      body,
      secure: Boolean(publicOrigin),
      limit: (address) => auth.limit(address),
      validateWebhook: validateWebhookUrl,
      integrations,
      publication,
      runtimeFlags,
      billing,
      mcpKeys: new McpKeyRepository(database),
      mcpAudit: new AuditRepository(database),
    })
    : null;
  const publishing = new Set();
  const files = {
    '/': ['public/index.html', 'text/html'],
    '/third-party-licenses.html': ['public/third-party-licenses.html', 'text/html'],
    '/third-party-notices.txt': ['public/third-party-notices.txt', 'text/plain'],
    '/material-symbols-outlined.LICENSE': ['public/material-symbols-outlined.LICENSE', 'text/plain'],
    '/owner.js': ['public/owner.js', 'text/javascript'],
    '/owner.css': ['public/owner.css', 'text/css'],
    '/app.js': ['public/app.js', 'text/javascript'],
    '/ui-preferences.js': ['public/ui-preferences.js', 'text/javascript'],
    '/quiz-elements.js': ['public/quiz-elements.js', 'text/javascript'],
    '/catalogo-elementos.js': ['public/catalogo-elementos.js', 'text/javascript'],
    '/quiz-navigation.js': ['public/quiz-navigation.js', 'text/javascript'],
    '/editor-workspace.js': ['public/editor-workspace.js', 'text/javascript'],
    '/studio-shell.js': ['public/studio-shell.js', 'text/javascript'],
    '/studio-context-boundary.js': ['public/studio-context-boundary.js', 'text/javascript'],
    '/context-list.js': ['public/context-list.js', 'text/javascript'],
    '/studio-dashboard.js': ['public/studio-dashboard.js', 'text/javascript'],
    '/save-cycle.js': ['public/save-cycle.js', 'text/javascript'],
    '/styles.css': ['public/styles.css', 'text/css'],
    '/tokens.css': ['public/styles.css', 'text/css'],
    '/material-symbols.css': ['public/material-symbols.css', 'text/css'],
    '/material-symbols-outlined.woff2': ['public/material-symbols-outlined.woff2', 'font/woff2'],
    '/templates.js': ['public/templates.js', 'text/javascript'],
    '/vsl-player.js': ['public/vsl-player.js', 'text/javascript'],
    '/vsl-opcoes.js': ['public/vsl-opcoes.js', 'text/javascript'],
    '/vsl-player-css.js': ['public/vsl-player-css.js', 'text/javascript'],
    '/vsl-previa.js': ['public/vsl-previa.js', 'text/javascript'],
    '/projeto-configuracoes.js': ['public/projeto-configuracoes.js', 'text/javascript'],
    '/tracker.js': ['public/tracker.js', 'text/javascript'],
    '/vsl-ui.js': ['public/vsl-ui.js', 'text/javascript'],
    '/leads-ui.js': ['public/leads-ui.js', 'text/javascript'],
    '/view-route.js': ['public/view-route.js', 'text/javascript'],
    '/confirm-dialog.js': ['public/confirm-dialog.js', 'text/javascript'],
    '/vendor/hls.min.js': ['node_modules/hls.js/dist/hls.min.js', 'text/javascript'],
    '/vsl-retention-ui.js': ['public/vsl-retention-ui.js', 'text/javascript'],
    '/vsl-upload.js': ['public/vsl-upload.js', 'text/javascript'],
    '/quiz-runtime.js': ['public/quiz-runtime.js', 'text/javascript'],
    '/quiz-mecanica.js': ['public/quiz-mecanica.js', 'text/javascript'],
    // O editor de landing (Puck). React e o build moram só aqui; a página publicada é HTML puro.
    '/editor.html': ['public/editor.html', 'text/html'],
    '/pagina-alva.js': ['public/pagina-alva.js', 'text/javascript'],
    '/funil.html': ['public/funil.html', 'text/html'],
    '/build/funil.js': ['public/build/funil.js', 'text/javascript'],
    '/build/funil.css': ['public/build/funil.css', 'text/css'],
    '/funil.js': ['public/funil.js', 'text/javascript'],
    '/funis-etapas.js': ['public/funis-etapas.js', 'text/javascript'],
    '/funis-modelos.js': ['public/funis-modelos.js', 'text/javascript'],
    '/funis-view.js': ['public/funis-view.js', 'text/javascript'],
    '/icones.js': ['public/icones.js', 'text/javascript'],
    '/modelos-alva.js': ['public/modelos-alva.js', 'text/javascript'],
    '/page-schema.js': ['public/page-schema.js', 'text/javascript'],
    '/build/editor.js': ['public/build/editor.js', 'text/javascript'],
    '/build/editor.css': ['public/build/editor.css', 'text/css'],
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
      const gatewayHost = req.headers['x-alva-runtime-gateway'] === '1' ? req.headers['x-alva-public-host'] : null;
      const expectedOrigin = gatewayHost ? `https://${gatewayHost}` : publicOrigin || 'http://' + req.headers.host;
      const path = new URL(req.url, 'http://' + expected).pathname;
      // Saúde fica fora da autenticação para o orquestrador poder distinguir um
      // processo vivo de um banco pronto. A resposta não revela detalhes do banco.
      if (req.method === 'GET' && path === '/health/live') return json({ status: 'live' });
      if (req.method === 'GET' && path === '/health/ready') {
        try {
          if (!database) throw new Error('database unavailable');
          await database.query('SELECT 1');
          return json({ status: 'ready' });
        } catch {
          return json({ status: 'not_ready' }, 503);
        }
      }
      const publicVsl = req.method === 'GET' ? path.match(/^\/(embed\/)?v\/([^/]+)$/) : null;
      const previaDoStudio = new URL(req.url, 'http://' + expected).searchParams.get('previa') === '1';
      const publicFontAsset = req.method === 'GET' && path === '/material-symbols-outlined.woff2';
      const effectiveHost = gatewayHost || req.headers.host;
      const studioHost = publicOrigin && effectiveHost === new URL(publicOrigin).host;
      const domainScope = Boolean(publicOrigin && !studioHost);
      const pageCaptureRequest = content ? parsePageCaptureRequest(path, req.method, domainScope) : null;
      const publicSubmission = Boolean(pageCaptureRequest && req.method === 'POST');
      const publicDomainRequest = Boolean(pageCaptureRequest && domainScope);
      const publicProjectSubmission = Boolean(pageCaptureRequest && !domainScope && (req.method === 'POST' || req.method === 'OPTIONS'));
      const publicCollect = path === '/api/public/collect' && (req.method === 'POST' || req.method === 'OPTIONS');
      const publicBillingWebhook = Boolean(billingRepository && path === '/api/billing/webhook/asaas');
      const publicMcp = Boolean(mcp && path === '/mcp');
      const publicRuntimeConsent = runtimeConsentGateway && path === '/_alva/consent' && ['GET', 'POST'].includes(req.method);
      const publicRuntimeLoader = runtimeConsents && path === '/_alva/runtime.js' && req.method === 'GET';
      const runtimeGatewayProtected = Boolean(
        (runtimeConsents && (publicRuntimeConsent || publicRuntimeLoader))
        || (runtimeManifests && pageCaptureRequest && ['POST', 'OPTIONS'].includes(req.method)),
      );
      const runtimeGateway = runtimeGatewayProtected
        ? await verifyRuntimeGatewayEnvelope({ repository: pageCaptureRequest ? runtimeManifests : runtimeConsents, rootSecret: runtimeHmacSecret, method: req.method, path, headers: req.headers, body: await rawBody(req), now: Math.floor(Date.now() / 1000) })
        : null;
      if (publicOrigin ? (!studioHost && !publicDomainRequest && !publicRuntimeConsent && !publicRuntimeLoader) : !localHost)
        throw error('Endereço não permitido.', 403);
      const origin = req.headers.origin;
      const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if ((publicMcp && origin && origin !== expectedOrigin) || (!publicMcp && !publicBillingWebhook && !publicSubmission && !publicProjectSubmission && !publicCollect && !publicVsl && !publicRuntimeConsent && !publicRuntimeLoader && !publicFontAsset && ((origin && origin !== expectedOrigin) || (mutation && origin !== expectedOrigin))))
        throw error('Origem não permitida.', 403);
      // Navegação de nível superior (clique em link de outro site) não é um ataque cross-site: libera fora de /api/.
      const topLevelNavigation = req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document' && !path.startsWith('/api/');
      if (!publicMcp && !publicSubmission && !publicProjectSubmission && !publicCollect && !publicVsl && !publicRuntimeConsent && !publicRuntimeLoader && !publicFontAsset && !topLevelNavigation && req.headers['sec-fetch-site'] === 'cross-site') throw error('Origem não permitida.', 403);
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      const secure = Boolean(publicOrigin);
      if (publicBillingWebhook) {
        if (!studioHost && publicOrigin) throw error('Endereço não permitido.', 403);
        const contentLength = Number(req.headers['content-length']);
        if (Number.isFinite(contentLength) && contentLength > 64 * 1024) throw error('Corpo muito grande.', 413);
        const accepted = await acceptBillingWebhook({ method: req.method, headers: req.headers, raw: await rawBody(req, 64 * 1024, 'Corpo muito grande.'), secret: billingWebhookSecret, environment: billingEnvironment, repository: billingRepository });
        res.writeHead(accepted.status); return res.end();
      }
      if (publicMcp) {
        const contentLength = Number(req.headers['content-length']);
        if (Number.isFinite(contentLength) && contentLength > 64 * 1024) throw error('Corpo MCP muito grande.', 413);
        const response = await mcp.handle({ method: req.method, headers: req.headers, raw: req.method === 'POST' ? await rawBody(req, 64 * 1024, 'Corpo MCP muito grande.') : Buffer.alloc(0) });
        if (response.headers) for (const [name, value] of Object.entries(response.headers)) res.setHeader(name, value);
        if (response.body === null) { res.writeHead(response.status); return res.end(); }
        return json(response.body, response.status);
      }
      // Report-Only por enquanto: só reporta violação, nunca bloqueia — a migração para modo
      // reforçado é decisão futura, depois que todo script inline aceitar o nonce.
      // A página de obrigado só chama os pixels quando eles estão ligados e o envio veio
      // pela publicação verificada — é ela que diz qual publicação os carrega.
      const conversaoParaOsPixels = (id) => (runtimeFlags.pixels === true && runtimeGateway?.publicationId && id
        ? { evento: 'lead', id, publicationId: runtimeGateway.publicationId }
        : null);
      const publicHtmlNonce = (actionOrigin) => {
        const nonce = createNonce();
        res.setHeader('Content-Security-Policy-Report-Only', formContentSecurityPolicy({
          nonce, studioOrigin: publicOrigin || expectedOrigin, actionOrigin, reportOnly: true,
        }));
        return nonce;
      };
      if (publicRuntimeConsent) {
        const publicationId = new URL(req.url, `http://${expected}`).searchParams.get('publicationId') || '';
        if (publicationId !== runtimeGateway.publicationId) throw error('Publicação de runtime inválida.', 403);
        const cookie = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('alva_runtime_consent='))?.slice('alva_runtime_consent='.length);
        const subjectId = /^[A-Za-z0-9._~-]{16,160}$/.test(cookie || '') ? cookie : randomUUID();
        if (!cookie) res.setHeader('Set-Cookie', `alva_runtime_consent=${subjectId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure ? '; Secure' : ''}`);
        const runtimeOrigin = runtimeGateway.origin;
        const result = await runtimeConsentGateway.handle({ method: req.method, publicationId, origin: runtimeOrigin, subjectId, body: req.method === 'POST' ? await body(req) : undefined });
        return json(result);
      }
      if (publicRuntimeLoader) {
        const publicationId = new URL(req.url, `http://${expected}`).searchParams.get('publicationId') || '';
        const row = runtimeGateway.manifest;
        if (publicationId !== row.publicationId) throw error('Publicação de runtime inválida.', 403);
        const source = createRuntimeLoader({ publicationId: row.publicationId, snapshotHash: row.snapshotHash, policyVersion: row.policyVersion, origin: row.origin, domain: row.domain, environment: row.environment, providers: row.providers });
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(source);
      }
      if (content && publicProjectSubmission) {
        const requestOrigin = req.headers.origin;
        const allowedOrigins = requestOrigin && requestOrigin !== expectedOrigin
          ? await content.publicationOrigins({ companySlug: pageCaptureRequest.companySlug, projectSlug: pageCaptureRequest.projectSlug })
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
      if (content && publicDomainRequest && !customDomainOriginAllowed(origin, effectiveHost))
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
        if (!collectLimiter.allow({ ip: ipDoVisitante(req) })) throw error('Muitos eventos. Tente novamente em instantes.', 429);
        // O escopo (empresa/projeto) vem sempre de resolveWebsite(), nunca do corpo enviado pelo navegador.
        const { trackerPublicId, event } = parseCollectPayload(await collectBody(req), req.headers['content-type']);
        if (!collectLimiter.allow({ ip: ipDoVisitante(req), trackerPublicId })) throw error('Muitos eventos. Tente novamente em instantes.', 429);
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
          address: ipDoVisitante(req),
          userAgent: req.headers['user-agent'],
        });
        const registrado = await analytics.ingest({
          websiteId: website.websiteId,
          companyId: website.companyId,
          projectId: website.projectId,
          visitorHash,
          // País (Cloudflare), dispositivo e navegador (user-agent). O analytics guarda só
          // a classe derivada: o IP e o UA crus não entram em `analytics_sessions`.
          //
          // Eles entram, sim, na linha da fila de conversões logo abaixo, porque as
          // plataformas os contam entre os sinais mais fortes de correspondência — e saem
          // de lá assim que a entrega confirma (`markDelivered` apaga o campo `client`).
          // É a única retenção de dado identificável do Studio, e ela dura o tempo da fila.
          audience: derivarAudiencia(req.headers),
          event: {
            type: event.event_name === 'pageview' ? 'pageview' : 'custom',
            eventName: event.event_name,
            urlPath: event.url_path,
            urlQuery: event.url_query,
            referrer: event.referrer,
            eventData: event.event_data,
          },
        });
        // O envio para os destinos de conversão saía do gateway do Umami. Com o Umami
        // absorvido, é o coletor próprio que alimenta o outbox: sem isto, remover o
        // gateway calaria Meta e TikTok sem ninguém perceber.
        if (commercialOutbox && EVENTOS_DE_CONVERSAO.has(event.event_name)) {
          const dados = event.event_data || {};
          await database.transaction((client) => commercialOutbox.enqueue(client, {
            companyId: website.companyId,
            projectId: website.projectId,
            environment: 'production',
            trackingEventId: registrado.trackingEventId,
            eventName: event.event_name,
            // A sessão sabe de qual anúncio a pessoa veio; o evento de VSL não sabia, e por
            // isso chegava às plataformas sem atribuição nenhuma.
            attribution: registrado.aquisicao || {},
            contexto: { sourceUrl: cors.corsOrigin ? `${cors.corsOrigin}${event.url_path || ''}` : undefined },
            cliente: { ip: ipDoVisitante(req), userAgent: req.headers['user-agent'] },
            params: {
              ...(dados.publicId ? { content_id: dados.publicId } : {}),
              ...(Number.isInteger(dados.value) ? { value: dados.value } : {}),
            },
          }));
        }
        // Nenhuma resposta do coletor devolve conteúdo — só status, para não vazar nada ao visitante.
        res.writeHead(204);
        return res.end();
      }
      if (projectApi && path.startsWith('/api/') && !path.startsWith('/api/public/')) {
        const handled = await projectApi({ req, res, path, method: req.method, json });
        if (handled !== false) return handled;
      }
      if (runtimeFlags.mediaPipeline && content && videos && publicVsl) {
        const embed = Boolean(publicVsl[1]);
        const video = await videos.getPublicVideo(publicVsl[2]);
        res.removeHeader('X-Frame-Options');
        res.setHeader('Content-Security-Policy', vslContentSecurityPolicy(video.sourceUrl, { embed, posterUrl: video.posterUrl, captionsUrl: video.captionsUrl, studioOrigin: publicOrigin || expectedOrigin }));
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        const trackerPublicId = analytics ? await trackerPublicIdForVideo(database, publicVsl[2]) : null;
        const medir = medirEstaVisita({ previa: previaDoStudio, referer: req.headers.referer || req.headers.referrer || '', studioOrigin: publicOrigin || expectedOrigin });
        return res.end(renderVslPage(video, { embed, publicOrigin: publicOrigin || expectedOrigin, trackerPublicId, medir }));
      }
      if (req.method === 'GET' && path === '/api/session') return json(await auth.state(req));
      if (req.method === 'POST' && (path === '/api/setup' || path === '/api/login')) {
        auth.limit(ipDoVisitante(req));
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
      if (req.method === 'POST' && content && pageCaptureRequest) {
        if (!runtimeGateway) throw error('Captura publicada não encontrada.', 404);
        const manifest = runtimeGateway.manifest;
        const entry = Array.isArray(manifest.contents) && manifest.contents.find((item) => item?.type === 'page' && item.path === pageCaptureRequest.route && Array.isArray(item.captureIds) && item.captureIds.includes(pageCaptureRequest.captureId));
        if (!entry || !await runtimeNamespaceMatches(database, manifest, pageCaptureRequest.companySlug, pageCaptureRequest.projectSlug)) throw error('Captura publicada não encontrada.', 404);
        if (origin !== runtimeGateway.origin) throw error('Origem publicada obrigatória para conversões.', 403);
        const input = await publicAnswers(req);
        const subjectId = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('alva_runtime_consent='))?.slice('alva_runtime_consent='.length);
        const capturado = await content.submitPublishedPageCapture({ companyId: manifest.companyId, projectId: manifest.projectId, pageId: entry.contentId, pageVersionId: entry.versionId, captureId: pageCaptureRequest.captureId, input, origin, attribution: runtimeAttribution(req.headers.cookie, runtimeGateway, runtimeHmacSecret), cliente: clienteDoEnvio(req, runtimeGateway), remetente: remetenteDoEnvio(req, runtimeGateway), publicationId: runtimeGateway.publicationId, subjectId });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        const nonce = publicHtmlNonce(`${publicOrigin || expectedOrigin}${path}`);
        return res.end(renderCompletion('Obrigado!', 'Recebemos suas respostas.', { nonce, conversao: capturado?.reenvio ? null : conversaoParaOsPixels(capturado?.eventId) }));
      }
      if (path.startsWith('/api/') && !(await auth.state(req)).authenticated)
        throw error('Entre na sua conta para continuar.', 401);
      if (req.method === 'POST' && path === '/api/logout') {
        await body(req);
        auth.logout(req, res, secure);
        return json({ ok: true });
      }
      if (req.method === 'PUT' && path === '/api/account') {
        auth.limit(ipDoVisitante(req));
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
      // A imagem anexada no editor, servida para a página publicada (que mora em outro
      // domínio). Endereço por UUID, imutável, sem nada que rode no domínio do Studio.
      const imagemPublica = req.method === 'GET' && path.match(/^\/i\/([0-9a-f-]{36})$/i);
      if (imagemPublica && images) {
        const imagem = await images.buscar(imagemPublica[1]);
        if (!imagem) throw error('Imagem não encontrada.', 404);
        res.writeHead(200, {
          'Content-Type': imagem.content_type,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'",
          'Cross-Origin-Resource-Policy': 'cross-origin',
        });
        return res.end(imagem.bytes);
      }
      if (req.method === 'GET' && files[path]) {
        const [file, type] = files[path];
        res.setHeader('Content-Type', type.startsWith('font/') ? type : type + '; charset=utf-8');
        if (publicFontAsset) res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache');
        let content = await readFile(join(root, file));
        // O tracker é módulo (os testes o importam), mas a página o inclui como script comum,
        // e `export` ali derruba o arquivo inteiro. Entregue sem os `export`, num escopo próprio.
        if (path === '/tracker.js') content = `(() => {\n${String(content).replace(/^export /gm, '')}\n})();\n`;
        return res.end(
          path === '/tokens.css' ? blocoDeTokens(content.toString()) : content,
        );
      }
      throw error('Não encontrado.', 404);
    } catch (e) {
      if (!res.headersSent)
        json({ error: (e.status || e.statusCode) ? e.message : 'Não foi possível concluir. Tente novamente.', ...(e.code ? { code: e.code } : {}) }, e.status || e.statusCode || 500);
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
