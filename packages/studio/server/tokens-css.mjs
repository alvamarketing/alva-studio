// O primeiro bloco `:root` de styles.css: os tokens visuais, sem as regras globais.
export function blocoDeTokens(css) {
  const inicio = css.indexOf(':root {');
  const fim = css.indexOf('\n}', inicio);
  if (inicio < 0 || fim < 0) throw new Error('styles.css sem bloco :root.');
  return css.slice(inicio, fim + 2) + '\n';
}
