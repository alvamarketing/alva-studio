import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderVslPage, vslContentSecurityPolicy } from '../server/vsl-public.mjs';
import { createApp } from '../server/index.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { VideoRepository } from '../server/repositories/video-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

const video = {
  publicId: 'public-vsl-123456', versionId: 2, name: 'Oferta <especial>', sourceUrl: 'https://media.example.test/path/vsl.m3u8', sourceType: 'hls',
  posterUrl: 'https://media.example.test/poster.jpg', captionsUrl: 'https://media.example.test/captions.vtt', accentColor: '#286eea', aspectRatio: '16:9',
  autoplayMuted: true, resumeEnabled: true, ctaText: 'Comprar', ctaUrl: '/checkout?from=vsl', ctaSeconds: 42,
};

test('renderizador público escapa HTML, configura CSP por origem e usa player local', () => {
  const html = renderVslPage(video);
  assert.match(html, /Oferta &lt;especial&gt;/);
  assert.match(html, /src="\/vsl-player\.js"/);
  assert.match(html, /data-vsl-config=/);
  assert.doesNotMatch(html, /\/video\//);
  const policy = vslContentSecurityPolicy(video.sourceUrl, { embed: false });
  assert.match(policy, /media-src 'self' https:\/\/media\.example\.test/);
  assert.match(policy, /connect-src 'self' https:\/\/media\.example\.test/);
  assert.match(policy, /frame-ancestors 'none'/);
});

test('embed permite ancestrais HTTPS, mantém proporção e inclui allow autoplay', () => {
  const html = renderVslPage({ ...video, aspectRatio: '9:16' }, { embed: true });
  assert.match(html, /allow="autoplay"/);
  assert.match(html, /aspect-ratio:9\/16/);
  assert.match(vslContentSecurityPolicy(video.sourceUrl, { embed: true }), /frame-ancestors https:/);
});

test('rotas HTTP servem somente versão publicada e o hls.js local', async (t) => {
  const { connectionString } = await postgresFixture(t);
  const database = createDatabase({ connectionString });
  await migrate(database);
  const user = (await database.query("INSERT INTO users (email, password_hash, display_name) VALUES ('public-vsl@alva.test', 'hash', 'Pessoa') RETURNING id")).rows[0];
  const company = (await database.query("INSERT INTO companies (name, slug) VALUES ('Público', 'publico') RETURNING id")).rows[0];
  await database.query("INSERT INTO company_memberships (company_id, user_id, role, joined_at) VALUES ($1, $2, 'owner', now())", [company.id, user.id]);
  const project = (await database.query("INSERT INTO projects (company_id, name, slug, created_by) VALUES ($1, 'Projeto público', 'projeto-publico', $2) RETURNING id", [company.id, user.id])).rows[0];
  const repository = new VideoRepository(database);
  const created = await repository.createVideo({ companyId: company.id, projectId: project.id, actorId: user.id, name: 'VSL pública', sourceUrl: 'https://media.example.test/vsl.m3u8', sourceType: 'hls' });
  await repository.publishVideo({ companyId: company.id, projectId: project.id, actorId: user.id, videoId: created.id, lockVersion: 0 });
  const server = createApp({ database });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections?.(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(`${base}/v/${created.publicId}`, { headers: { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://embedder.example.test' } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /VSL pública/);
  assert.doesNotMatch(html, new RegExp(created.id));
  assert.match(page.headers.get('content-security-policy'), /media-src 'self' https:\/\/media\.example\.test/);
  const embed = await fetch(`${base}/embed/v/${created.publicId}`);
  assert.equal(embed.status, 200);
  assert.equal(embed.headers.get('x-frame-options'), null);
  assert.equal((await fetch(`${base}/v/missing-public-id`)).status, 404);
  assert.equal((await fetch(`${base}/vendor/hls.min.js`)).status, 200);
  assert.equal((await fetch(`${base}/vsl-ui.js`)).status, 200);
  await database.close();
});
