// A folha do lugar da imagem sem endereço, no canvas do editor (a página publicada omite a
// imagem). Segue o botão tracejado da "Biblioteca visual" e o "+ Escolher imagem" de
// "Configure sua VSL" no wireframe; só tokens de /tokens.css, que o iframe do canvas carrega.
// O giro do "Enviando…" usa o @keyframes spin que as folhas da página já trazem.
export const IMAGEM_VAZIA_CSS = [
  '.alva-imagem-vazia{display:grid;justify-items:center;align-content:center;gap:8px;min-height:180px;padding:24px;border:1px dashed var(--alva-blue-light);border-radius:var(--radius-lg);background:var(--alva-highlight);color:var(--alva-blue);font-family:var(--font-sans);font-size:var(--text-xl);font-weight:600;line-height:1.4;text-align:center}',
  '.alva-imagem-vazia:focus-visible{outline:2px solid var(--alva-blue);outline-offset:2px}',
  '.alva-imagem-vazia small{font-size:var(--text-lg);font-weight:400;color:var(--alva-muted)}',
  '.alva-imagem-vazia-erro{border-color:var(--alva-danger);background:var(--alva-negative-bg);color:var(--alva-danger)}',
  '.alva-imagem-vazia-enviando svg{animation:spin .85s linear infinite}',
  '@media(prefers-reduced-motion:reduce){.alva-imagem-vazia-enviando svg{animation:none}}',
].join('\n');
