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

export function normalizeLeadRow({ id = '', formId = '', formName = '', answers = {}, submittedAt = '', webhookStatus = '' } = {}) {
  return {
    id: String(id),
    formId: String(formId),
    formName: String(formName),
    submittedAt: String(submittedAt),
    deliveryLabel: deliveryLabels[webhookStatus] || 'Não enviado',
    answers: Object.entries(answers && typeof answers === 'object' ? answers : {})
      .map(([field, value]) => ({ field, value: displayLeadAnswer(value) })),
  };
}

export function leadsCsvUrl(projectId, formId) {
  if (!formId) return '';
  const query = new URLSearchParams({ formId: String(formId) });
  return `/api/projects/${encodeURIComponent(String(projectId))}/leads.csv?${query}`;
}

export function leadsListModel({ phase = 'ready', rows = [], error = '' } = {}) {
  if (phase === 'loading') return { status: 'loading', message: 'Carregando leads…' };
  if (phase === 'error') return { status: 'error', message: error || 'Não foi possível carregar os leads.' };
  if (!rows.length) return { status: 'empty', message: 'Nenhum lead encontrado.' };
  return { status: 'ready', message: '' };
}
