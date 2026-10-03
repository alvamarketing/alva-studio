const deliveryLabels = Object.freeze({
  delivered: 'Entregue',
  pending: 'Pendente',
  failed: 'Falhou',
});

export function displayLeadAnswer(value) {
  if (value === null || value === undefined || value === '') return '—';
  // A caixa de marcar do formulário chega como verdadeiro ou falso.
  if (value === true) return 'Sim';
  if (value === false) return 'Não';
  if (Array.isArray(value)) return value.map(displayLeadAnswer).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function normalizeLeadRow({
  id = '', answers = {}, submittedAt = '', webhookStatus = '',
  sourceId = '', sourceVersionId = '', sourceName = '', sourcePath = '',
  captureId = '', captureName = '', fields = [],
} = {}) {
  const snapshotFields = Array.isArray(fields)
    ? fields
      .filter((field) => field && field.id !== undefined && field.id !== null)
      .map((field) => ({ id: String(field.id), title: field.title === undefined || field.title === null ? '' : String(field.title) }))
    : [];
  const fieldTitles = new Map(snapshotFields.map((field) => [field.id, field.title]));
  const normalized = {
    id: String(id),
    submittedAt: String(submittedAt),
    deliveryLabel: deliveryLabels[webhookStatus] || 'Não enviado',
    sourceKind: 'page',
    sourceId: String(sourceId),
    sourceVersionId: String(sourceVersionId),
    sourceName: String(sourceName),
    sourcePath: String(sourcePath),
    captureId: String(captureId),
    captureName: String(captureName),
    fields: snapshotFields,
    answers: Object.entries(answers && typeof answers === 'object' ? answers : {})
      .map(([field, value]) => ({
        ...(snapshotFields.length ? { id: field } : {}),
        field: fieldTitles.get(field) || field,
        value: displayLeadAnswer(value),
      })),
  };
  return normalized;
}

export function leadsCsvUrl(projectId, source) {
  if (!source?.sourceId) return '';
  const params = { sourceKind: 'page', sourceId: String(source.sourceId) };
  if (source.captureId) params.captureId = String(source.captureId);
  return `/api/projects/${encodeURIComponent(String(projectId))}/leads.csv?${new URLSearchParams(params)}`;
}

export function leadsListModel({ phase = 'ready', rows = [], error = '' } = {}) {
  if (phase === 'loading') return { status: 'loading', message: 'Carregando leads…' };
  if (phase === 'error') return { status: 'error', message: error || 'Não foi possível carregar os leads.' };
  if (!rows.length) return { status: 'empty', message: 'Nenhum lead encontrado.' };
  return { status: 'ready', message: '' };
}
