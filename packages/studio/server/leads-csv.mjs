function valueForCsv(value) {
  if (Array.isArray(value)) return value.map(valueForCsv).join('; ');
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function cell(value) {
  const text = valueForCsv(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function renderLeadsCsv({ formName, fields, submissions }) {
  const columns = [
    { kind: 'metadata', key: 'submittedAt', title: 'Recebida em' },
    { kind: 'metadata', key: 'sourceName', title: 'Formulário' },
  ];
  if (submissions.some((submission) => submission.sourceKind === 'page'))
    columns.push({ kind: 'metadata', key: 'captureName', title: 'Captura' });
  const fieldsBySubmission = new Map();
  const addColumn = (field, submission) => {
    if (!field?.id) return;
    const title = String(field.title ?? field.id);
    const key = `${field.id}\u0000${title}`;
    let column = columns.find((item) => item.key === key);
    if (!column) {
      const sameTitle = columns.some((item) => item.title === title);
      const version = submission?.sourceVersionId ? ` (${submission.sourceVersionId})` : '';
      column = { kind: 'field', key, id: field.id, title: sameTitle ? `${title}${version || ` (${field.id})`}` : title };
      columns.push(column);
    }
    return column;
  };
  for (const field of (Array.isArray(fields) ? fields : [])) addColumn(field);
  for (const submission of submissions) {
    const known = new Map();
    for (const field of (Array.isArray(submission.fields) ? submission.fields : [])) {
      const column = addColumn(field, submission);
      if (column) known.set(field.id, column.key);
    }
    for (const id of Object.keys(submission.answers ?? {})) {
      if (!known.has(id)) {
        const current = columns.find((column) => column.id === id);
        known.set(id, current?.key ?? addColumn({ id, title: id }, submission)?.key);
      }
    }
    fieldsBySubmission.set(submission, known);
  }
  const rows = [columns.map((column) => cell(column.title)).join(',')];
  for (const submission of submissions) {
    rows.push(columns.map((column) => {
      if (column.kind === 'metadata' && column.key === 'submittedAt') return cell(submission.submittedAt);
      if (column.kind === 'metadata' && column.key === 'sourceName') return cell(submission.formName ?? submission.sourceName ?? formName);
      if (column.kind === 'metadata' && column.key === 'captureName') return cell(submission.captureName ?? '');
      return cell(fieldsBySubmission.get(submission)?.get(column.id) === column.key ? submission.answers?.[column.id] : '');
    }).join(','));
  }
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}
