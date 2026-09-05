function fail(message = 'Informe um webhook HTTPS válido.', status = 400) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

// A entrega remota fica pendente nesta fundação: validar formato não abre egress.
export function validateWebhookUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 2000) throw fail();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw fail();
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw fail();
  return url.toString();
}
