// A audiência do visitante — país, dispositivo, navegador — derivada só dos cabeçalhos.
//
// Este módulo substitui o que o Umami fazia server-side. O cuidado é o mesmo do resto do
// coletor: nada de dado pessoal persistido. O IP nunca é lido aqui — o país já vem pronto
// no cabeçalho que a Cloudflare injeta. Do user-agent sai apenas a classe do aparelho e a
// família do navegador, nunca a string crua.

// A Cloudflare manda estes quando não consegue geolocalizar; não são países.
const PAIS_DESCONHECIDO = new Set(['XX', 'T1', 'A1', 'A2']);

function pais(headers) {
  const bruto = String(headers['cf-ipcountry'] || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(bruto) || PAIS_DESCONHECIDO.has(bruto)) return null;
  return bruto;
}

function dispositivo(ua) {
  if (/\bTablet\b|\biPad\b|Android(?!.*\bMobile\b)/i.test(ua)) return 'tablet';
  if (/Mobi|\biPhone\b|\biPod\b|Android.*\bMobile\b/i.test(ua)) return 'mobile';
  return 'desktop';
}

function navegador(ua) {
  // Ordem importa: Edge e Opera se anunciam também como Chrome; Chrome também como Safari.
  if (/\bEdg\//i.test(ua)) return 'Edge';
  if (/\bOPR\/|\bOpera\b/i.test(ua)) return 'Opera';
  if (/\bFirefox\//i.test(ua)) return 'Firefox';
  if (/\bChrome\//i.test(ua)) return 'Chrome';
  if (/\bSafari\//i.test(ua)) return 'Safari';
  return null;
}

export function derivarAudiencia(headers = {}) {
  const ua = String(headers['user-agent'] || '').trim();
  return {
    country: pais(headers),
    // Cidade exigiria o IP ou um cabeçalho pago; fica de fora por ora, sem inventar.
    city: null,
    device: ua ? dispositivo(ua) : null,
    browser: ua ? navegador(ua) : null,
  };
}
