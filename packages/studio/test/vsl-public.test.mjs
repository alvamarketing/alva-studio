import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderVslPage, vslContentSecurityPolicy } from '../server/vsl-public.mjs';
import { createApp } from '../server/index.mjs';
import { createDatabase, migrate } from '../server/db/postgres.mjs';
import { VideoRepository } from '../server/repositories/video-repository.mjs';
import { postgresFixture } from './postgres-fixture.mjs';

const video = {
  publicId: 'public-vsl-123456', versionNumber: 2, name: 'Oferta <especial>', sourceUrl: 'https://media.example.test/path/vsl.m3u8', sourceType: 'hls',
  posterUrl: 'https://media.example.test/poster.jpg', captionsUrl: 'https://media.example.test/captions.vtt', accentColor: '#286eea', aspectRatio: '16:9',
  autoplayMuted: true, resumeEnabled: true, ctaText: 'Comprar', ctaUrl: '/checkout?from=vsl', ctaSeconds: 42,
};

test('renderizador público escapa HTML, configura CSP por origem e usa player local', () => {
  const html = renderVslPage(video, { publicOrigin: 'https://studio.example.test' });
  assert.match(html, /Oferta &lt;especial&gt;/);
  assert.match(html, /src="\/vsl-player\.js"/);
  assert.match(html, /data-vsl-config=/);
  assert.doesNotMatch(html, /versionId/);
  assert.match(html, /https:\/\/studio\.example\.test\/embed\/v\/public-vsl-123456/);
  assert.match(html, /title=&quot;Oferta &amp;lt;especial&amp;gt;&quot;/);
  assert.doesNotMatch(html, /\/video\//);
  const policy = vslContentSecurityPolicy(video.sourceUrl, { embed: false, posterUrl: 'https://images.example.test/poster.jpg', captionsUrl: 'https://captions.example.test/captions.vtt' });
  assert.match(policy, /media-src 'self' https:\/\/media\.example\.test https:\/\/captions\.example\.test/);
  assert.match(policy, /connect-src 'self' https:\/\/media\.example\.test https:\/\/captions\.example\.test/);
  assert.match(policy, /img-src 'self' https:\/\/images\.example\.test data:/);
  assert.doesNotMatch(policy, /\*/);
  assert.match(policy, /frame-ancestors 'none'/);
});

test('publica os marcos configurados e versionados da VSL, não o literal fixo', () => {
  function decode(html) {
    return JSON.parse(html.match(/data-vsl-config="([^"]*)"/)[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  }
  const comMarcos = renderVslPage({ ...video, milestones: [50, 90] }, { publicOrigin: 'https://studio.example.test' });
  assert.deepEqual(decode(comMarcos).milestones, [50, 90]);
  const semMarcos = renderVslPage({ ...video, milestones: [] }, { publicOrigin: 'https://studio.example.test' });
  assert.deepEqual(decode(semMarcos).milestones, [25, 50, 75, 100]);
});

test('CSP da VSL ganha a origem do Studio em connect-src quando informada, sem abrir script-src', () => {
  const semOrigemDoStudio = vslContentSecurityPolicy(video.sourceUrl, {});
  assert.doesNotMatch(semOrigemDoStudio, /https:\/\/studio\.example\.test/);
  const comOrigemDoStudio = vslContentSecurityPolicy(video.sourceUrl, { studioOrigin: 'https://studio.example.test' });
  const connectSrc = comOrigemDoStudio.match(/connect-src ([^;]+);/)[1];
  assert.match(connectSrc, /'self'/);
  assert.match(connectSrc, /https:\/\/media\.example\.test/);
  assert.match(connectSrc, /https:\/\/studio\.example\.test/);
  assert.match(comOrigemDoStudio, /(^|; )script-src 'self'(;|$)/);
  assert.doesNotMatch(comOrigemDoStudio, /script-src[^;]*studio\.example\.test/);
});

test('renderVslPage inclui o tracker de primeira parte quando há trackerPublicId, e preserva o HTML de hoje sem ele', () => {
  const comTracker = renderVslPage(video, { publicOrigin: 'https://studio.example.test', trackerPublicId: 'trk_vsl_123' });
  assert.match(comTracker, /<script src="\/tracker\.js" data-alva-tracker="trk_vsl_123"><\/script>/);
  assert.match(comTracker, /<\/script><\/body><\/html>$/, 'o tracker entra depois do script do player, no fim do body');

  const semTracker = renderVslPage(video, { publicOrigin: 'https://studio.example.test' });
  assert.doesNotMatch(semTracker, /tracker\.js/);
});

test('embed permite ancestrais HTTPS, mantém proporção e inclui allow autoplay', () => {
  const html = renderVslPage({ ...video, aspectRatio: '9:16' }, { embed: true });
  assert.match(html, /allow="autoplay"/);
  assert.match(html, /aspect-ratio:9\/16/);
  assert.match(vslContentSecurityPolicy(video.sourceUrl, { embed: true, posterUrl: video.posterUrl, captionsUrl: video.captionsUrl }), /frame-ancestors https:/);
});

test('CSP da VSL adiciona apenas as origens estáticas do provedor', () => {
  const youtube = vslContentSecurityPolicy('https://www.youtube.com/embed/dQw4w9WgXcQ?bad=;inject', { sourceType: 'youtube' });
  assert.match(youtube, /frame-src https:\/\/www\.youtube\.com/);
  assert.match(youtube, /script-src 'self' https:\/\/www\.youtube\.com/);
  assert.doesNotMatch(youtube.match(/script-src [^;]+/)[0], /unsafe-inline|nonce-/);
  assert.doesNotMatch(youtube, /inject/);
  const vimeo = vslContentSecurityPolicy('https://player.vimeo.com/video/123456', { sourceType: 'vimeo' });
  assert.match(vimeo, /frame-src https:\/\/player\.vimeo\.com/);
  assert.match(vimeo, /script-src 'self' https:\/\/player\.vimeo\.com/);
});

test('CSP de provedor não aceita a origem dinâmica da URL de mídia', () => {
  for (const sourceType of ['youtube', 'vimeo']) {
    const policy = vslContentSecurityPolicy('https://evil.tld/video.m3u8', { sourceType, studioOrigin: 'https://studio.example.test' });
    assert.doesNotMatch(policy, /evil\.tld/, `${sourceType} não pode liberar a origem colada em nenhuma diretiva`);
    assert.doesNotMatch(policy, /studio\.example\.test/, `${sourceType} usa somente as origens estáticas do provedor`);
  }
  const native = vslContentSecurityPolicy('https://media.example.test/video.mp4', { sourceType: 'mp4' });
  assert.match(native, /media\.example\.test/, 'MP4 continua usando sua origem dinâmica já validada');
});

test('CSP de MP4 preserva exatamente a saída atual', () => {
  const policy = vslContentSecurityPolicy('https://media.example.test/video.mp4', {
    posterUrl: 'https://images.example.test/poster.jpg',
    captionsUrl: 'https://captions.example.test/captions.vtt',
    studioOrigin: 'https://studio.example.test',
  });
  assert.equal(
    policy,
    [
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://images.example.test data:; ",
      "media-src 'self' https://media.example.test https://captions.example.test; ",
      "connect-src 'self' https://media.example.test https://captions.example.test https://studio.example.test; frame-ancestors 'none'",
    ].join(''),
  );
});

test('player público reorganiza controles e quebra mensagens em telas estreitas', () => {
  const html = renderVslPage(video);
  assert.match(html, /\.vsl-media\{[^}]*height:100%/);
  assert.match(html, /\.vsl-controls\{[^}]*flex-wrap:wrap/);
  assert.match(html, /\.vsl-seek\{[^}]*min-width:0/);
  assert.match(html, /\.vsl-status\{[^}]*overflow-wrap:anywhere/);
  assert.match(html, /@media\(max-width:520px\)/);
});

test('iframe injetado pela API do YouTube ocupa o player responsivo', () => {
  const html = renderVslPage({
    ...video,
    sourceType: 'youtube',
    sourceUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ?enablejsapi=1',
  });
  assert.match(html, /\.vsl-provider-frame,\.vsl-provider-frame iframe\{width:100%;height:100%;border:0\}/);
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
  assert.match(html, new RegExp(`http://127\.0\.0\.1:${server.address().port}/embed/v/${created.publicId}`));
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
