const deliveryLabels = Object.freeze({
  delivered: 'Entregue',
  pending: 'Pendente',
  failed: 'Falhou',
});

export function displayLeadAnswer(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.map(displayLeadAnswer).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function normalizeLeadRow({
  id = '', formId = '', formName = '', answers = {}, submittedAt = '', webhookStatus = '',
  sourceKind = 'form', sourceId = '', sourceVersionId = '', sourceName = '', sourcePath = '',
  captureId = '', captureName = '', fields = [],
} = {}) {
  const kind = sourceKind === 'page' ? 'page' : 'form';
  const snapshotFields = Array.isArray(fields)
    ? fields
      .filter((field) => field && field.id !== undefined && field.id !== null)
      .map((field) => ({ id: String(field.id), title: field.title === undefined || field.title === null ? '' : String(field.title) }))
    : [];
  const fieldTitles = new Map(snapshotFields.map((field) => [field.id, field.title]));
  const normalized = {
    id: String(id),
    formId: String(formId),
    formName: String(formName),
    submittedAt: String(submittedAt),
    deliveryLabel: deliveryLabels[webhookStatus] || 'Não enviado',
    sourceKind: kind,
    sourceId: String(sourceId || (kind === 'form' ? formId : '')),
    sourceVersionId: String(sourceVersionId),
    sourceName: String(sourceName || formName),
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
  if (!source) return '';
  const query = typeof source === 'string'
    ? new URLSearchParams({ formId: source })
    : (() => {
      if (!source || !source.sourceId) return null;
      const params = { sourceKind: source.sourceKind || 'form', sourceId: String(source.sourceId) };
      if (source.captureId) params.captureId = String(source.captureId);
      return new URLSearchParams(params);
    })();
  if (!query) return '';
  return `/api/projects/${encodeURIComponent(String(projectId))}/leads.csv?${query}`;
}

export function leadsListModel({ phase = 'ready', rows = [], error = '' } = {}) {
  if (phase === 'loading') return { status: 'loading', message: 'Carregando leads…' };
  if (phase === 'error') return { status: 'error', message: error || 'Não foi possível carregar os leads.' };
  if (!rows.length) return { status: 'empty', message: 'Nenhum lead encontrado.' };
  return { status: 'ready', message: '' };
}
