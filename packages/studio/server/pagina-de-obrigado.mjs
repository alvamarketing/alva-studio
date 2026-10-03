import { escape, quizIconFont } from '../public/quiz-elements.js';

const CONVERSAO = /^[a-z_]{1,40}:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A página de obrigado é o único ponto que todo envio atravessa depois que o servidor
// gravou o lead — e o único que conhece o id que o servidor manda às plataformas. Com os
// pixels ligados, ela diz qual conversão aconteceu e carrega os pixels, que disparam o
// evento com esse mesmo id; é isso que deixa a plataforma contar navegador e servidor
// como um lead só.
function avisoDeConversao(conversao) {
  if (!conversao) return { cabeca: '', corpo: '' };
  const valor = `${conversao.evento}:${conversao.id}`;
  if (!CONVERSAO.test(valor) || !/^[A-Za-z0-9._:-]{1,120}$/.test(String(conversao.publicationId ?? ''))) return { cabeca: '', corpo: '' };
  return {
    cabeca: `<meta name="alva-conversion" content="${valor}">`,
    corpo: `<script src="/_alva/runtime.js?publicationId=${encodeURIComponent(conversao.publicationId)}" defer></script>`,
  };
}

// Redirecionar depois do envio: a página de obrigado leva a pessoa ao endereço escolhido no
// formulário. Não é um 303: o gateway da Vercel segue redirecionamento sozinho e devolveria
// a página de destino no lugar desta. Com os pixels a carregar, a ida espera 2 segundos para
// o lead chegar a eles; sem, é imediata. O link fica para quem tem o refresh bloqueado.
const DESTINO = /^https?:\/\/[^\s"'<>\\]{1,1000}$/i;
function ida(redirecionar, conversao) {
  if (!DESTINO.test(String(redirecionar ?? ''))) return { cabeca: '', corpo: '' };
  const url = escape(redirecionar);
  return {
    cabeca: `<meta http-equiv="refresh" content="${conversao ? 2 : 0};url=${url}">`,
    corpo: `<p><a href="${url}">Continuar</a></p>`,
  };
}

export function renderCompletion(title, message, { nonce, conversao, redirecionar } = {}) {
  void nonce;
  const aviso = avisoDeConversao(conversao);
  const destino = ida(redirecionar, aviso.cabeca ? conversao : null);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title>${quizIconFont()}<style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 80% 20%,#dbe9ff,transparent 35%),#f7f9fc;color:#101828;font-family:Inter,system-ui,sans-serif}.card{width:min(620px,100%);padding:55px;background:#fff;border:1px solid #e7ecf3;border-radius:24px;box-shadow:0 24px 70px #10182814;animation:enter .6s both}.mark{display:grid;place-items:center;width:54px;height:54px;border-radius:50%;background:#eaf2ff;color:#286eea;font-size:26px}h1{font-size:clamp(34px,6vw,54px);letter-spacing:-.04em;margin:28px 0 12px}p{color:#667085;font-size:17px;line-height:1.65}@keyframes enter{from{opacity:0;transform:translateY(25px)}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}</style>${aviso.cabeca}${destino.cabeca}</head><body><main class="card"><div class="mark material-symbols-outlined">check_circle</div><h1>${escape(title)}</h1><p>${escape(message)}</p>${destino.corpo}</main>${aviso.corpo}</body></html>`;
}
