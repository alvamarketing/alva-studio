import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { Publisher } from './publisher.mjs';
import { Auth } from './auth.mjs';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const error = (message, status) => Object.assign(new Error(message), { status });
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
export function createApp({
  dataDir = process.env.DATA_DIR || join(root, '.data'),
  publisher: injectedPublisher,
  authOptions,
  publicOrigin = process.env.PUBLIC_ORIGIN,
} = {}) {
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (url.protocol !== 'https:' || url.origin !== publicOrigin || url.username || url.password)
      throw new Error('PUBLIC_ORIGIN deve ser uma origem HTTPS exata.');
  }
  const auth = new Auth(dataDir, authOptions);
  const getPublisher = async () => injectedPublisher || new Publisher(await auth.credentials());
  const store = new Store(dataDir);
  const publishing = new Set();
  const files = {
    '/': ['public/index.html', 'text/html'],
    '/owner.js': ['public/owner.js', 'text/javascript'],
    '/owner.css': ['public/owner.css', 'text/css'],
    '/editor-shell.js': ['public/editor-shell.js', 'text/javascript'],
    '/editor-shell.css': ['public/editor-shell.css', 'text/css'],
    '/app.js': ['public/app.js', 'text/javascript'],
    '/save-cycle.js': ['public/save-cycle.js', 'text/javascript'],
    '/styles.css': ['public/styles.css', 'text/css'],
    '/templates.js': ['public/templates.js', 'text/javascript'],
    '/vendor/grapes.min.js': ['node_modules/grapesjs/dist/grapes.min.js', 'text/javascript'],
    '/vendor/grapes.min.css': ['node_modules/grapesjs/dist/css/grapes.min.css', 'text/css'],
    '/vendor/pt.js': ['node_modules/grapesjs/locale/pt.js', 'text/javascript'],
  };
  return createServer(async (req, res) => {
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
      if (publicOrigin ? req.headers.host !== new URL(publicOrigin).host : !localHost)
        throw error('Endereço não permitido.', 403);
      const origin = req.headers.origin;
      const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if ((origin && origin !== expectedOrigin) || (mutation && origin !== expectedOrigin))
        throw error('Origem não permitida.', 403);
      if (req.headers['sec-fetch-site'] === 'cross-site') throw error('Origem não permitida.', 403);
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'no-referrer');
      const path = new URL(req.url, 'http://' + expected).pathname;
      const secure = Boolean(publicOrigin);
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
        json({ error: e.status ? e.message : 'Não foi possível concluir. Tente novamente.' }, e.status || 500);
      else res.end();
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4178);
  const host = process.env.HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !process.env.PUBLIC_ORIGIN)
    throw new Error('HOST externo exige PUBLIC_ORIGIN HTTPS.');
  const app = createApp();
  app.listen(port, host, () => console.log(`Alva Studio: http://127.0.0.1:${port}`));
}
