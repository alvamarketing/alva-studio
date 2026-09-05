import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectApi } from '../server/project-api.mjs';

function setup() {
  const calls = [];
  const videos = {
    listVideos: async (input) => { calls.push(['list', input]); return [{ id: 'v1' }]; },
    getVideo: async (input) => { calls.push(['get', input]); return { id: input.videoId }; },
    createVideo: async (input) => { calls.push(['create', input]); return { id: 'v1', ...input }; },
    updateVideo: async (input) => { calls.push(['update', input]); return { id: input.videoId, ...input }; },
    duplicateVideo: async (input) => { calls.push(['duplicate', input]); return { id: 'v2' }; },
    removeVideo: async (input) => { calls.push(['remove', input]); return { ok: true }; },
    publishVideo: async (input) => { calls.push(['publish', input]); return { id: 'version-1', versionNumber: 1 }; },
  };
  const sessionService = {
    require: async () => ({ companyId: 'company-1', user: { id: 'user-1' }, currentProjectId: 'project-1' }),
    authorize: async (...input) => calls.push(['authorize', ...input]),
  };
  const api = createProjectApi({
    sessionService, videos, body: async (req) => req.bodyValue,
  });
  return { api, videos, calls };
}

async function request(api, path, method, bodyValue = {}) {
  const result = [];
  await api({ req: { bodyValue }, res: {}, path, method, json: (data, status = 200) => { result.push({ data, status }); return result.at(-1); } });
  return result[0];
}

test('API do projeto expõe CRUD de VSL e exige as capacidades corretas', async () => {
  const { api, calls } = setup();
  assert.deepEqual((await request(api, '/api/projects/project-1/videos', 'GET')).data, [{ id: 'v1' }]);
  assert.deepEqual((await request(api, '/api/projects/project-1/videos/v1', 'GET')).data, { id: 'v1' });
  await request(api, '/api/projects/project-1/videos', 'POST', { name: 'Nova', sourceUrl: 'https://media.test/a.mp4' });
  await request(api, '/api/projects/project-1/videos/v1', 'PUT', { lockVersion: 0, name: 'Editada' });
  await request(api, '/api/projects/project-1/videos/v1/duplicate', 'POST');
  await request(api, '/api/projects/project-1/videos/v1', 'DELETE');
  await request(api, '/api/projects/project-1/videos/v1/publish', 'POST', { lockVersion: 1 });
  assert.deepEqual(calls.filter(([kind]) => ['create', 'update', 'duplicate', 'remove', 'publish'].includes(kind)).map(([kind, input]) => [kind, input.videoId, input.actorId]), [
    ['create', undefined, 'user-1'], ['update', 'v1', 'user-1'], ['duplicate', 'v1', 'user-1'], ['remove', 'v1', 'user-1'], ['publish', 'v1', 'user-1'],
  ]);
  assert.equal(calls.filter(([kind, , capability]) => kind === 'authorize' && capability === 'video.read').length, 2);
});

test('API bloqueia leitura de VSL quando video.read é negado', async () => {
  const calls = [];
  const api = createProjectApi({
    sessionService: {
      require: async () => ({ companyId: 'company-1', user: { id: 'user-1' }, currentProjectId: 'project-1' }),
      authorize: async (...input) => { calls.push(['authorize', ...input]); if (input[1] === 'video.read') throw Object.assign(new Error('Sem permissão'), { status: 403 }); },
    },
    videos: { listVideos: async () => { throw new Error('não deveria consultar o repositório'); } },
    body: async (req) => req.bodyValue,
  });
  await assert.rejects(() => request(api, '/api/projects/project-1/videos', 'GET'), /Sem permissão/);
  assert.deepEqual(calls.map(([, , capability]) => capability), [null, 'video.read']);
});
