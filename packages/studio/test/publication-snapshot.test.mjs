import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPublishableSnapshot, extractVslReferences } from '../server/publication-snapshot.mjs';

function database(rows, videoRows = []) {
  return { query: async (text) => ({ rows: /FROM videos/i.test(text) ? videoRows : rows }) };
}

test('snapshot inclui todas as páginas e formulários publicados em ordem estável', async () => {
  const rows = [
    {
      kind: 'form', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha',
      content_id: 'form-1', version_id: 'form-version-1', version_number: 2, path: '/captura',
      schema: { steps: [{ id: 'email', elements: [{ id: 'email', type: 'email', title: 'E-mail', required: true }] }] },
    },
    {
      kind: 'page', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha',
      content_id: 'page-1', version_id: 'page-version-1', version_number: 3, path: '/',
      rendered_html: '<h1>Alva</h1>', editor_state: { title: 'Alva' },
    },
  ];
  const snapshot = await buildPublishableSnapshot({ database: database(rows), companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test' });
  assert.deepEqual(snapshot.manifest.map((item) => item.path), ['/', '/captura']);
  assert.deepEqual(snapshot.files.map((item) => item.file), ['index.html', 'captura/index.html']);
  assert.match(snapshot.files[1].data, /https:\/\/studio\.alva\.test\/api\/public\/forms\/alva\/campanha\/captura\/submissions/);
  assert.equal(snapshot.files[0].data, '<h1>Alva</h1>');
  assert.match(snapshot.hash, /^[a-f0-9]{64}$/);
  const repeat = await buildPublishableSnapshot({ database: database([...rows].reverse()), companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test' });
  assert.equal(repeat.hash, snapshot.hash);
  assert.deepEqual(repeat.files, snapshot.files);
});

test('snapshot rejeita vazio, rota duplicada e registros de outra empresa', async () => {
  await assert.rejects(
    () => buildPublishableSnapshot({ database: database([]), companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test' }),
    /nenhuma rota publicada/i,
  );
  const duplicate = [
    { kind: 'page', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha', content_id: 'p1', version_id: 'v1', version_number: 1, path: '/Oferta', rendered_html: '<h1>1</h1>' },
    { kind: 'form', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha', content_id: 'f1', version_id: 'v2', version_number: 1, path: '/oferta', schema: { steps: [{ id: 'step', elements: [{ id: 'email', type: 'email', title: 'E-mail' }] }] } },
  ];
  await assert.rejects(
    () => buildPublishableSnapshot({ database: database(duplicate), companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test' }),
    /rota duplicada/i,
  );
  const foreign = [{ ...duplicate[0], company_id: 'company-b' }];
  await assert.rejects(
    () => buildPublishableSnapshot({ database: database(foreign), companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test' }),
    /nenhuma rota publicada|outra empresa/i,
  );
});

test('snapshot extrai a referência canônica do componente GrapesJS e aceita somente a versão publicada', async () => {
  const rows = [{
    kind: 'page', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha',
    content_id: 'page-vsl', version_id: 'page-version-vsl', version_number: 1, path: '/vsl',
    rendered_html: '<div data-alva-vsl="public-vsl-123456"></div>',
    editor_state: {
      components: [{ type: 'vsl', publicId: 'public-vsl-123456', tagName: 'div', droppable: false, attributes: { 'data-alva-vsl': 'public-vsl-123456' } }],
    },
  }];
  const snapshot = await buildPublishableSnapshot({
    database: database(rows, [{ public_id: 'public-vsl-123456', version_number: 2 }]),
    companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test',
  });
  assert.equal(snapshot.manifest[0].path, '/vsl');
});

test('snapshot mantém publicação estrita quando uma VSL referenciada não está publicada', async () => {
  const rows = [{
    kind: 'form', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha',
    content_id: 'form-vsl-missing', version_id: 'form-version-vsl-missing', version_number: 1, path: '/captura',
    schema: { steps: [{ id: 'vsl-screen', elements: [{ id: 'vsl', type: 'vsl', publicId: 'public-vsl-missing', title: 'Oferta' }] }] },
  }];
  await assert.rejects(
    () => buildPublishableSnapshot({ database: database(rows), companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test' }),
    (error) => error.status === 409 && /publique a VSL/i.test(error.message),
  );
});

test('snapshot rejeita conflito entre publicId do componente e data-alva-vsl', async () => {
  const rows = [{
    kind: 'page', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha',
    content_id: 'page-vsl-conflito', version_id: 'page-version-vsl-conflito', version_number: 1, path: '/vsl-conflito',
    rendered_html: '<div data-alva-vsl="public-vsl-a"></div>',
    editor_state: {
      components: [{ type: 'vsl', publicId: 'public-vsl-a', attributes: { 'data-alva-vsl': 'public-vsl-b' } }],
    },
  }];
  await assert.rejects(
    () => buildPublishableSnapshot({ database: database(rows, [{ public_id: 'public-vsl-a', version_number: 1 }]), companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test' }),
    /referência de VSL inválida/i,
  );
});

test('snapshot publica VSL GrapesJS com movimento estrutural e não aceita atributos arbitrários ou configuração', async () => {
  const rows = [{
    kind: 'page', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha',
    content_id: 'page-vsl-motion', version_id: 'page-version-vsl-motion', version_number: 1, path: '/vsl-motion',
    rendered_html: '<div data-alva-vsl="public-vsl-motion" data-alva-motion="float"></div>',
    editor_state: {
      components: [{ type: 'vsl', publicId: 'public-vsl-motion', tagName: 'div', droppable: false, attributes: {
        'data-alva-vsl': 'public-vsl-motion', 'data-alva-motion': 'float',
      } }],
    },
  }];
  const snapshot = await buildPublishableSnapshot({
    database: database(rows, [{ public_id: 'public-vsl-motion', version_number: 1 }]),
    companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test',
  });
  assert.equal(snapshot.manifest[0].path, '/vsl-motion');
  assert.deepEqual(extractVslReferences(rows[0].editor_state), [{ type: 'vsl', publicId: 'public-vsl-motion' }]);

  for (const attributes of [
    { 'data-alva-vsl': 'public-vsl-motion', 'data-alva-unknown': 'x' },
    { 'data-alva-vsl': 'public-vsl-motion', 'data-alva-motion': 'bounce' },
  ]) {
    await assert.rejects(
      () => buildPublishableSnapshot({
        database: database([{ ...rows[0], editor_state: { components: [{ type: 'vsl', publicId: 'public-vsl-motion', attributes, config: { autoplay: true } }] } }], [{ public_id: 'public-vsl-motion', version_number: 1 }]),
        companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test',
      }),
      /referência de VSL inválida/i,
    );
  }
  await assert.rejects(
    () => buildPublishableSnapshot({
      database: database([{ ...rows[0], editor_state: { components: [{ type: 'vsl', publicId: 'public-vsl-motion', attributes: { 'data-alva-vsl': 'public-vsl-motion', 'data-alva-motion': 'float' }, config: { autoplay: true } }] } }], [{ public_id: 'public-vsl-motion', version_number: 1 }]),
      companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test',
    }),
    /referência de VSL inválida/i,
  );
});

test('snapshot injeta no HTML da página somente o embed absoluto da versão publicada', async () => {
  const rows = [{
    kind: 'page', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha',
    content_id: 'page-vsl-html', version_id: 'page-version-vsl-html', version_number: 1, path: '/vsl-html',
    rendered_html: '<section><div data-alva-vsl="public-vsl-123456"><iframe src="https://draft.example/v.mp4"></iframe></div></section>',
    editor_state: { components: [{ type: 'vsl', publicId: 'public-vsl-123456' }] },
  }];
  const snapshot = await buildPublishableSnapshot({
    database: database(rows, [{ public_id: 'public-vsl-123456', version_number: 4 }]),
    companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test',
  });
  const html = snapshot.files[0].data;
  assert.match(html, /<iframe[^>]+src="https:\/\/studio\.alva\.test\/embed\/v\/public-vsl-123456"/i);
  assert.doesNotMatch(html, /draft\.example|sourceUrl|version_id|page-version-vsl-html/i);
});

test('snapshot preserva documento completo e troca marcador pela origem pública do servidor', async () => {
  const rows = [{
    kind: 'page', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha',
    content_id: 'page-vsl-document', version_id: 'page-version-vsl-document', version_number: 1, path: '/vsl-document',
    rendered_html: '<!doctype html><html><head><style>.hero{color:red}</style></head><body><main><div data-alva-vsl="public-vsl-document"></div></main><script>window.ready=true</script></body></html>',
    editor_state: { components: [{ type: 'vsl', publicId: 'public-vsl-document' }] },
  }];
  const snapshot = await buildPublishableSnapshot({
    database: database(rows, [{ public_id: 'public-vsl-document', version_number: 2 }]),
    companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://public.example.test',
  });
  const html = snapshot.files[0].data;
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /\.hero\{color:red\}/);
  assert.match(html, /window\.ready=true/);
  assert.match(html, /src="https:\/\/public\.example\.test\/embed\/v\/public-vsl-document"/i);
  assert.doesNotMatch(html, /data-alva-vsl/);
});

test('snapshot reescreve apenas iframe legado que aponta para VSL conhecida', async () => {
  const rows = [{
    kind: 'page', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha',
    content_id: 'page-vsl-legacy', version_id: 'page-version-vsl-legacy', version_number: 1, path: '/vsl-legacy',
    rendered_html: '<main><iframe class="alva-vsl-frame" src="https://client.example.test/embed/v/public-vsl-legacy" title="VSL"></iframe><iframe class="alva-vsl-frame" src="https://evil.example.test/embed/v/outro" title="VSL"></iframe></main>',
    editor_state: { components: [{ type: 'vsl', publicId: 'public-vsl-legacy' }] },
  }];
  const snapshot = await buildPublishableSnapshot({
    database: database(rows, [{ public_id: 'public-vsl-legacy', version_number: 3 }]),
    companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://public.example.test',
  });
  const html = snapshot.files[0].data;
  assert.match(html, /src="https:\/\/public\.example\.test\/embed\/v\/public-vsl-legacy"/i);
  assert.match(html, /https:\/\/evil\.example\.test\/embed\/v\/outro/);
});

test('publicação transforma somente nós reais e preserva byte a byte comentários e raw text', async () => {
  const rows = [{
    kind: 'page', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha',
    content_id: 'page-vsl-raw-text', version_id: 'page-version-vsl-raw-text', version_number: 1, path: '/vsl-raw-text',
    rendered_html: '<!-- <div data-alva-vsl="public-vsl-raw-text"></div> --><script>const x = \'<iframe class="alva-vsl-frame" src="https://client.example/embed/v/public-vsl-raw-text"></iframe>\';</script><style>.x{content:"<div data-alva-vsl=\\\'public-vsl-raw-text\\\'></div>"}</style><template><div data-alva-vsl="public-vsl-raw-text"></div></template><main><div data-alva-vsl="public-vsl-raw-text"></div><iframe class="alva-vsl-frame" src="https://client.example/embed/v/public-vsl-raw-text"></iframe></main>',
    editor_state: { components: [{ type: 'vsl', publicId: 'public-vsl-raw-text' }] },
  }];
  const snapshot = await buildPublishableSnapshot({
    database: database(rows, [{ public_id: 'public-vsl-raw-text', version_number: 1 }]),
    companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://public.example.test',
  });
  const html = snapshot.files[0].data;
  assert.match(html, /<!-- <div data-alva-vsl="public-vsl-raw-text"><\/div> -->/);
  assert.match(html, /const x = \'<iframe class="alva-vsl-frame" src="https:\/\/client\.example\/embed\/v\/public-vsl-raw-text"><\/iframe>\';/);
  assert.match(html, /<template><div data-alva-vsl="public-vsl-raw-text"><\/div><\/template>/);
  assert.equal((html.match(/src="https:\/\/public\.example\.test\/embed\/v\/public-vsl-raw-text"/g) || []).length, 2);
});

test('publicação preserva HTML malformado em vez de aplicar substituição parcial', async () => {
  for (const renderedHtml of [
    '<main><div data-alva-vsl="public-vsl-malformed><span></main>',
    '<main><div data-alva-vsl=<script>alert(1)</script>></div></main>',
    '<main><div data-alva-vsl></div></main>',
  ]) {
    const rows = [{
      kind: 'page', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha',
      content_id: 'page-vsl-malformed', version_id: 'page-version-vsl-malformed', version_number: 1, path: '/vsl-malformed',
      rendered_html: renderedHtml,
      editor_state: { components: [{ type: 'vsl', publicId: 'public-vsl-malformed' }] },
    }];
    const snapshot = await buildPublishableSnapshot({
      database: database(rows, [{ public_id: 'public-vsl-malformed', version_number: 1 }]),
      companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://public.example.test',
    });
    assert.equal(snapshot.files[0].data, renderedHtml);
  }
});

test('publicação é atômica e preserva o documento inteiro quando há erro depois de um nó válido', async () => {
  for (const renderedHtml of [
    '<main><div data-alva-vsl="public-vsl-before-error"></div><div data-alva-vsl="public-vsl-broken><span>bad</main>',
    '<main><div data-alva-vsl="public-vsl-before-error"></div><div data-alva-vsl="public-vsl-broken"><span>bad</div></main>',
    '<main><div data-alva-vsl="public-vsl-before-error"/><section></section></main>',
    '<main><div data-alva-vsl="public-vsl-before-error"></div><iframe class="alva-vsl-frame" src="https://client.example/embed/v/public-vsl-before-error"/></main>',
  ]) {
    const rows = [{
      kind: 'page', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha',
      content_id: 'page-vsl-atomic', version_id: 'page-version-vsl-atomic', version_number: 1, path: '/vsl-atomic',
      rendered_html: renderedHtml,
      editor_state: { components: [{ type: 'vsl', publicId: 'public-vsl-before-error' }] },
    }];
    const snapshot = await buildPublishableSnapshot({
      database: database(rows, [{ public_id: 'public-vsl-before-error', version_number: 1 }]),
      companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://public.example.test',
    });
    assert.equal(snapshot.files[0].data, renderedHtml);
  }
});

test('publicação protege CDATA e falha atomicamente quando CDATA não termina', async () => {
  const valid = '<![CDATA[<div data-alva-vsl="public-vsl-cdata"></div>]]><main><div data-alva-vsl="public-vsl-real"></div></main>';
  const rows = [{
    kind: 'page', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha',
    content_id: 'page-vsl-cdata', version_id: 'page-version-vsl-cdata', version_number: 1, path: '/vsl-cdata',
    rendered_html: valid,
    editor_state: { components: [{ type: 'vsl', publicId: 'public-vsl-real' }] },
  }];
  const snapshot = await buildPublishableSnapshot({
    database: database(rows, [{ public_id: 'public-vsl-real', version_number: 1 }]),
    companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://public.example.test',
  });
  assert.match(snapshot.files[0].data, /<!\[CDATA\[<div data-alva-vsl="public-vsl-cdata"><\/div>\]\]>/);
  assert.match(snapshot.files[0].data, /public\.example\.test\/embed\/v\/public-vsl-real/);
  const malformed = { ...rows[0], rendered_html: '<main><div data-alva-vsl="public-vsl-before-cdata"></div><![CDATA[<div data-alva-vsl="public-vsl-cdata"></div>' };
  const malformedSnapshot = await buildPublishableSnapshot({
    database: database([malformed], [{ public_id: 'public-vsl-before-cdata', version_number: 1 }]),
    companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://public.example.test',
  });
  assert.equal(malformedSnapshot.files[0].data, malformed.rendered_html);
});

test('snapshot deduplica VSL repetida entre página e formulário', async () => {
  const rows = [
    {
      kind: 'page', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha',
      content_id: 'page-vsl-dup', version_id: 'page-version-vsl-dup', version_number: 1, path: '/pagina',
      rendered_html: '<div data-alva-vsl="public-vsl-duplicate"></div>',
      editor_state: { components: [{ type: 'vsl', publicId: 'public-vsl-duplicate' }] },
    },
    {
      kind: 'form', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha',
      content_id: 'form-vsl-dup', version_id: 'form-version-vsl-dup', version_number: 1, path: '/formulario',
      schema: { steps: [{ id: 'step', elements: [{ id: 'vsl', type: 'vsl', publicId: 'public-vsl-duplicate' }] }] },
    },
  ];
  let videoQueries = 0;
  const db = { query: async (text) => {
    if (/FROM videos/i.test(text)) videoQueries += 1;
    return { rows: /FROM videos/i.test(text) ? [{ public_id: 'public-vsl-duplicate', version_number: 2 }] : rows };
  } };
  const snapshot = await buildPublishableSnapshot({ database: db, companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test' });
  assert.equal(videoQueries, 1);
  assert.match(snapshot.files[1].data, /https:\/\/studio\.alva\.test\/embed\/v\/public-vsl-duplicate/);
});

test('snapshot bloqueia VSL sem versão publicada com conflito acionável antes de gerar arquivos', async () => {
  const rows = [{
    kind: 'form', company_id: 'company-a', project_id: 'project-a', company_slug: 'alva', project_slug: 'campanha',
    content_id: 'form-vsl-draft', version_id: 'form-version-vsl-draft', version_number: 1, path: '/captura',
    schema: { steps: [{ id: 'step', elements: [{ id: 'vsl', type: 'vsl', publicId: 'public-vsl-draft' }] }] },
  }];
  await assert.rejects(
    () => buildPublishableSnapshot({ database: database(rows), companyId: 'company-a', projectId: 'project-a', publicOrigin: 'https://studio.alva.test' }),
    (error) => error.status === 409 && /publique a VSL|versão publicada|projeto/i.test(error.message),
  );
});
