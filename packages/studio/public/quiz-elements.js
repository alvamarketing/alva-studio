export const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export function materialSymbolsFontUrl(origin = '') {
  if (!origin) return '/material-symbols-outlined.woff2';
  try {
    const url = new URL(origin);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return `${url.origin}/material-symbols-outlined.woff2`;
  } catch {}
  return '/material-symbols-outlined.woff2';
}

export function materialSymbolsFontCss(origin = '') {
  return `@font-face{font-family:'Material Symbols Outlined';font-style:normal;font-weight:500;src:url('${materialSymbolsFontUrl(origin)}') format('woff2')}.material-symbols-outlined{font-family:'Material Symbols Outlined';font-weight:normal;font-style:normal;font-variation-settings:'FILL' 0,'wght' 500,'GRAD' 0,'opsz' 24;font-feature-settings:'liga';-webkit-font-smoothing:antialiased}`;
}

export const quizIconFont = (origin = '') => `<style>${materialSymbolsFontCss(origin)}</style>`;

// Os tipos que desenham só decoração: eles não produzem campo de resposta nenhum na tela
// publicada, e a validação do servidor não pode cobrá-los — um tipo decorativo marcado
// como obrigatório exigia resposta de algo que a pessoa não tem como preencher nem
// enxergar, e o quiz ficava impossível de enviar.
export const TIPOS_SEM_RESPOSTA = new Set([
  'image', 'video', 'vsl', 'logo', 'statement', 'title', 'heading', 'text', 'paragraph',
]);
