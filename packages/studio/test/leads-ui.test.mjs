import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayLeadAnswer, leadsCsvUrl, leadsListModel, normalizeLeadRow } from '../public/leads-ui.js';

const htmlPath = new URL('../public/index.html', import.meta.url);
const appPath = new URL('../public/app.js', import.meta.url);

test('normaliza uma resposta de lead para células de leitura segura', () => {
  const row = normalizeLeadRow({
    id: 'lead-1', formId: 'form-1', formName: 'Diagnóstico',
    submittedAt: '2026-09-05T11:00:00.000Z', webhookStatus: 'delivered',
    answers: { nome: '<Ana>', interesses: ['Sites', 'Tráfego'], vazio: null },
  });

  assert.deepEqual(row, {
    id: 'lead-1', formId: 'form-1', formName: 'Diagnóstico',
    submittedAt: '2026-09-05T11:00:00.000Z', deliveryLabel: 'Entregue',
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

test('separa os estados de carregamento, erro e lista vazia de leads', () => {
  assert.deepEqual(leadsListModel({ phase: 'loading' }), { status: 'loading', message: 'Carregando leads…' });
  assert.deepEqual(leadsListModel({ phase: 'error', error: 'Sem acesso' }), { status: 'error', message: 'Sem acesso' });
  assert.deepEqual(leadsListModel({ rows: [] }), { status: 'empty', message: 'Nenhum lead encontrado.' });
  assert.deepEqual(leadsListModel({ rows: [{ id: 'lead-1' }] }), { status: 'ready', message: '' });
});

test('a visão de projeto oferece Leads somente com permissão, estados e controles acessíveis', async () => {
  const [html, app] = await Promise.all([readFile(htmlPath, 'utf8'), readFile(appPath, 'utf8')]);

  assert.match(html, /data-project-filter="leads"[^>]*>Leads/);
  assert.match(html, /id="project-leads-controls"/);
  assert.match(html, /id="project-leads-form"[^>]*aria-label="Filtrar leads por formulário"/);
  assert.match(html, /id="project-leads-export"[^>]*download/);
  assert.match(app, /studioShell\?\.can\?\.\('submission\.read'\)/);
  assert.match(app, /api\(`\/projects\/\$\{state\.currentProject\.id\}\/leads/);
  assert.match(app, /nextCursor/);
  assert.match(app, /textContent = answer\.value/);
});
