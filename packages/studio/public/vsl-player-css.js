// O visual do player da VSL num lugar só: a página publicada (server/vsl-public.mjs) e a
// prévia do Studio (public/vsl-previa.js) usam este mesmo CSS. Duas cópias divergiriam, e a
// prévia deixaria de valer como prévia. Só o que é do player entra aqui; o que é da página
// publicada — corpo, título, código de incorporar — fica lá.
const cor = (valor) => (/^#[0-9a-f]{6}$/i.test(String(valor ?? '')) ? String(valor) : '#286eea');

export function cssDoPlayer(accentColor) {
  const destaque = cor(accentColor);
  return `.vsl-player{height:100%;display:flex;flex-direction:column;background:#000;font-family:system-ui,sans-serif}`
    + `.vsl-frame{position:relative;min-height:0;flex:1}`
    + `.vsl-video{width:100%;height:100%;display:block;background:#000;object-fit:contain}`
    + `.vsl-cta{position:absolute;left:50%;bottom:14%;transform:translateX(-50%);max-width:86%;padding:13px 22px;border-radius:999px;background:${destaque};color:#fff;text-decoration:none;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`
    + `.vsl-cta span,.vsl-cta small{display:block;text-align:center}`
    + `.vsl-cta small{font-weight:500;font-size:.78em;opacity:.9;margin-top:2px}`
    + `.vsl-som{position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:12px;width:100%;border:0;padding:24px;background:rgb(0 0 0 / 45%);color:#fff;font:700 clamp(16px,3.2vw,26px)/1.2 system-ui,sans-serif;cursor:pointer;text-align:center}`
    + `.vsl-som svg{width:clamp(40px,8vw,72px);height:auto;animation:vsl-pulso 1.6s ease-in-out infinite}`
    + `@keyframes vsl-pulso{50%{transform:scale(1.12)}}`
    + `.vsl-retomar{position:absolute;inset:0;display:grid;place-content:center;gap:10px;padding:24px;background:rgb(0 0 0 / 72%);color:#fff;text-align:center}`
    + `.vsl-retomar p{margin:0 0 6px;font-weight:700;font-size:clamp(15px,2.6vw,20px)}`
    + `.vsl-retomar button{border:0;border-radius:999px;padding:12px 22px;font:600 15px system-ui,sans-serif;cursor:pointer}`
    + `.vsl-retomar-sim{background:${destaque};color:#fff}`
    + `.vsl-retomar-nao{background:rgb(255 255 255 / 14%);color:#fff}`
    + `.vsl-player [hidden]{display:none!important}`
    + `.vsl-controls{display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:10px 12px;background:#111827}`
    + `.vsl-controls button{border:0;background:transparent;color:#fff;padding:6px;font:inherit;cursor:pointer}`
    + `.vsl-seek{flex:1;min-width:0;accent-color:${destaque}}`
    + `.vsl-time{font-variant-numeric:tabular-nums;font-size:12px;color:#c7d2e3}`
    + `.vsl-status{margin:0;padding:5px 12px;background:#111827;color:#fecaca;overflow-wrap:anywhere;white-space:normal}`
    + `.vsl-status:empty{display:none}`
    + `@media(max-width:520px){.vsl-seek{order:10;flex-basis:100%;width:100%}}`
    + `@media(prefers-reduced-motion:reduce){.vsl-som svg{animation:none}}`;
}
