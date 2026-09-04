import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Publisher } from '../server/publisher.mjs';
test('publica no mesmo projeto e inclui HTML sem expor token', async () => {
  const calls = [];
  const transport = async (url, opts) => {
    calls.push({ url, opts });
    return new Response(JSON.stringify({ id: 'dpl_1', url: 'lp.vercel.app', readyState: 'QUEUED' }));
  };
  const pub = new Publisher({ token: 'private-token', fetcher: transport });
  await pub.publish({ id: 'abc-123', html: '<h1>Alva</h1>', domain: '' });
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.name, 'alva-abc-123');
  assert.equal(body.target, 'production');
  assert.equal(body.files[0].file, 'index.html');
  assert.equal(body.files[0].data, '<h1>Alva</h1>');
  assert.ok(!calls[0].opts.body.includes('private-token'));
});
test('sem credencial não simula publicação', async () => {
  await assert.rejects(() => new Publisher({}).publish({ id: 'a', html: 'x' }), /Conecte a Vercel/);
});
test('erros da plataforma não devolvem corpo potencialmente sensível', async () => {
  const pub = new Publisher({ token: 'secret', fetcher: async () => new Response('secret', { status: 401 }) });
  await assert.rejects(
    () => pub.publish({ id: 'a', html: 'x' }),
    (error) => error.message.includes('401') && !error.message.includes('secret'),
  );
});
test('republicação e domínio usam vínculo explícito do projeto', async () => {
  const calls = [];
  const pub = new Publisher({
    token: 'token',
    teamId: 'team_123',
    fetcher: async (url, opts) => {
      calls.push({ url, opts });
      return new Response(
        JSON.stringify({
          id: 'dpl_next',
          projectId: 'prj_stable',
          url: 'stable.vercel.app',
          name: 'lp.example.com',
          verified: false,
        }),
      );
    },
  });
  const page = {
    id: 'abc-123',
    revision: 2,
    html: '<h1>Nova</h1>',
    domain: 'lp.example.com',
    deployment: { projectId: 'prj_stable' },
  };
  const result = await pub.publish(page);
  assert.equal(JSON.parse(calls[0].opts.body).project, 'prj_stable');
  assert.equal(result.projectId, 'prj_stable');
  await pub.domain(page);
  assert.match(calls[1].url, /\/projects\/prj_stable\/domains\?teamId=team_123/);
});
test('verificação de conexão consulta usuário e equipe sem retornar token', async () => {
  const calls = [];
  const pub = new Publisher({
    token: 'secret',
    teamId: 'team_123',
    fetcher: async (url) => {
      calls.push(url);
      return new Response(
        JSON.stringify(
          url.includes('/user')
            ? { user: { name: 'Tai', email: 'tai@example.com', token: 'secret' } }
            : { id: 'team_123', name: 'Alva Marketing', secret: 'secret' },
        ),
      );
    },
  });
  const result = await pub.testConnection();
  assert.deepEqual(result, {
    ok: true,
    account: { name: 'Tai', email: 'tai@example.com' },
    team: { id: 'team_123', name: 'Alva Marketing' },
  });
  assert.equal(calls.length, 2);
  assert.ok(!JSON.stringify(result).includes('secret'));
});
