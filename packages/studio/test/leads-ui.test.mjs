import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayLeadAnswer, leadsCsvUrl, leadsListModel, normalizeLeadRow } from '../public/leads-ui.js';

const htmlPath = new URL('../public/index.html', import.meta.url);
const appPath = new URL('../public/app.js', import.meta.url);
const stylesPath = new URL('../public/styles.css', import.meta.url);

test('normaliza uma resposta de lead para células de leitura segura', () => {
  const row = normalizeLeadRow({
    id: 'lead-1', formId: 'form-1', formName: 'Diagnóstico',
    submittedAt: '2026-09-05T11:00:00.000Z', webhookStatus: 'delivered',
    answers: { nome: '<Ana>', interesses: ['Sites', 'Tráfego'], vazio: null },
  });

  assert.deepEqual(row, {
    id: 'lead-1', formId: 'form-1', formName: 'Diagnóstico',
    submittedAt: '2026-09-05T11:00:00.000Z', deliveryLabel: 'Entregue',
    sourceKind: 'form', sourceId: 'form-1', sourceVersionId: '', sourceName: 'Diagnóstico', sourcePath: '',
    captureId: '', captureName: '', fields: [],
    answers: [
      { field: 'nome', value: '<Ana>' },
      { field: 'interesses', value: 'Sites, Tráfego' },
      { field: 'vazio', value: '—' },
    ],
  });
  assert.equal(displayLeadAnswer({ objeto: true }), '{"objeto":true}');
});

test('gera exportação CSV para o projeto e formulário selecionados', () => {
  assert.equal(
    leadsCsvUrl('project/a', 'form & 1'),
    '/api/projects/project%2Fa/leads.csv?formId=form+%26+1',
  );
  assert.equal(leadsCsvUrl('project-a', ''), '');
});

test('normaliza origem page com captura, campos do snapshot, arrays e labels históricos', () => {
  const row = normalizeLeadRow({
    id: 'lead-page-1', sourceKind: 'page', sourceId: 'page/1', sourceVersionId: 'version & 2',
    sourceName: 'Landing histórica', sourcePath: '/captacao', captureId: 'capture-1', captureName: 'Contato',
    fields: [{ id: 'email', title: 'E-mail' }, { id: 'sem-titulo' }],
    answers: { email: 'ana@example.test', 'sem-titulo': null, outro: ['A', 'B'] },
  });

  assert.deepEqual(row, {
    id: 'lead-page-1', formId: '', formName: '', submittedAt: '', deliveryLabel: 'Não enviado',
    sourceKind: 'page', sourceId: 'page/1', sourceVersionId: 'version & 2', sourceName: 'Landing histórica', sourcePath: '/captacao',
    captureId: 'capture-1', captureName: 'Contato',
    fields: [{ id: 'email', title: 'E-mail' }, { id: 'sem-titulo', title: '' }],
    answers: [
      { id: 'email', field: 'E-mail', value: 'ana@example.test' },
      { id: 'sem-titulo', field: 'sem-titulo', value: '—' },
      { id: 'outro', field: 'outro', value: 'A, B' },
    ],
  });
});

test('gera CSV por origem page e exige sourceId no filtro em objeto', () => {
  assert.equal(
    leadsCsvUrl('project/a', { sourceKind: 'page', sourceId: 'page/1', captureId: 'capture & 1' }),
    '/api/projects/project%2Fa/leads.csv?sourceKind=page&sourceId=page%2F1&captureId=capture+%26+1',
  );
  assert.equal(leadsCsvUrl('project-a', { sourceKind: 'page', captureId: 'capture-1' }), '');
  assert.equal(
    leadsCsvUrl('project-a', { sourceKind: 'form', sourceId: 'form-1' }),
    '/api/projects/project-a/leads.csv?sourceKind=form&sourceId=form-1',
  );
});

test('separa os estados de carregamento, erro e lista vazia de leads', () => {
  assert.deepEqual(leadsListModel({ phase: 'loading' }), { status: 'loading', message: 'Carregando leads…' });
  assert.deepEqual(leadsListModel({ phase: 'error', error: 'Sem acesso' }), { status: 'error', message: 'Sem acesso' });
  assert.deepEqual(leadsListModel({ rows: [] }), { status: 'empty', message: 'Nenhum lead encontrado.' });
  assert.deepEqual(leadsListModel({ rows: [{ id: 'lead-1' }] }), { status: 'ready', message: '' });
});

test('a visão de projeto oferece Leads somente com permissão, estados e controles acessíveis', async () => {
  const [html, app, styles] = await Promise.all([readFile(htmlPath, 'utf8'), readFile(appPath, 'utf8'), readFile(stylesPath, 'utf8')]);

  assert.match(html, /data-project-filter="leads"[^>]*>Leads/);
  assert.match(html, /id="project-leads-controls"/);
  assert.match(html, /id="project-leads-form"[^>]*aria-label="Filtrar leads por origem"/);
  assert.match(html, /id="project-leads-export"[^>]*download/);
  assert.match(html, /As respostas ficam disponíveis no Studio/);
  assert.match(html, /Opcionalmente, envie uma cópia em JSON para seu CRM ou automação/);
  assert.match(app, /studioShell\?\.can\?\.\('submission\.read'\)/);
  assert.match(app, /api\(`\/projects\/\$\{state\.currentProject\.id\}\/leads/);
  assert.match(app, /params\.set\('sourceKind', leadsSource\.sourceKind\)/);
  assert.match(app, /result\.projectSubmissions \|\| result/);
  assert.match(app, /new Intl\.DateTimeFormat\('pt-BR'/);
  assert.match(app, /metric\.label === 'LEADS' && studioShell\?\.can\?\.\('submission\.read'\)/);
  assert.match(app, /item\.setAttribute\('role', 'button'\)/);
  assert.match(app, /item\.onclick = \(\) => selectProjectContentFilter\('leads'\)/);
  assert.match(app, /item\.onkeydown = \(event\) =>/);
  assert.match(app, /Leads do projeto/);
  assert.match(app, /Voltar aos conteúdos/);
  assert.match(app, /projectView\.dataset\.contentView = 'leads'/);
  assert.match(app, /delete projectView\.dataset\.contentView/);
  assert.match(styles, /#project-view\[data-content-view='leads'\] \.project-columns/);
  assert.match(styles, /#project-view\[data-content-view='leads'\] #project-publication/);
  assert.match(styles, /#project-view\[data-content-view='leads'\] #analytics-panel/);
  assert.doesNotMatch(app, /Configure o destino do formulário antes de publicar/);
  assert.match(app, /nextCursor/);
  assert.match(app, /textContent = answer\.value/);
});
