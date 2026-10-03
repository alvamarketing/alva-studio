// Sessão vencida nas telas separadas do Studio (editor, funil): a pessoa vai para o login e,
// depois de entrar, volta para onde estava. O endereço de volta vem da URL, então só vale o que
// está na lista abaixo: nada de outro site, de /api ou de caminho com '..'.
const PAGINAS_DE_VOLTA = new Set(['/editor.html', '/funil.html']);
const BASE = 'http://studio.invalido';

export function enderecoDeLogin({ pathname, search = '' }) {
  return `/?voltar=${encodeURIComponent(`${pathname}${search}`)}`;
}

export function destinoDeVolta(search = '') {
  const bruto = new URLSearchParams(search).get('voltar');
  if (!bruto || !bruto.startsWith('/') || bruto.startsWith('//') || bruto.includes('\\') || bruto.includes('..')) return null;
  let url;
  try { url = new URL(bruto, BASE); } catch { return null; }
  if (url.origin !== BASE || !PAGINAS_DE_VOLTA.has(url.pathname)) return null;
  return `${url.pathname}${url.search}`;
}
