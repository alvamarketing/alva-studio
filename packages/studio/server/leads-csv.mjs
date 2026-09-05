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
  const currentFields = Array.isArray(fields) ? fields : [];
  const currentIds = new Set(currentFields.map((field) => field.id));
  const historicalIds = [...new Set(submissions.flatMap((submission) => Object.keys(submission.answers ?? {})))]
    .filter((id) => !currentIds.has(id))
    .sort();
  const columns = [
    { id: 'submittedAt', title: 'Recebida em' },
    { id: 'formName', title: 'Formulário' },
    ...currentFields,
    ...historicalIds.map((id) => ({ id, title: id })),
  ];
  const rows = [columns.map((column) => cell(column.title)).join(',')];
  for (const submission of submissions) {
    rows.push(columns.map((column) => {
      if (column.id === 'submittedAt') return cell(submission.submittedAt);
      if (column.id === 'formName') return cell(submission.formName ?? formName);
      return cell(submission.answers?.[column.id]);
    }).join(','));
  }
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}
