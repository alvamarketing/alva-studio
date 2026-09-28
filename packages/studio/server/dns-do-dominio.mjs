// Qual registro de DNS o domínio do projeto precisa, a partir do que a Vercel recomenda
// (GET /v6/domains/{domain}/config). Domínio raiz (cliente.com.br) usa registro A;
// subdomínio (lp.cliente.com.br) usa CNAME, com o valor que é único por projeto.

// Sufixos de dois níveis mais comuns para clientes da agência. Sem eles, "cliente.com.br"
// pareceria subdomínio de "com.br".
const SUFIXOS_DE_DOIS_NIVEIS = new Set([
  'com.br', 'net.br', 'org.br', 'art.br', 'blog.br', 'eco.br', 'edu.br', 'gov.br', 'ind.br', 'inf.br', 'med.br', 'adv.br', 'arq.br', 'eng.br', 'emp.br', 'log.br', 'tur.br',
  'co.uk', 'org.uk', 'com.au', 'com.ar', 'com.mx', 'com.pt', 'co.jp',
]);

export function dominioRaiz(dominio) {
  const partes = String(dominio ?? '').toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (partes.length <= 2) return true;
  return partes.length === 3 && SUFIXOS_DE_DOIS_NIVEIS.has(partes.slice(-2).join('.'));
}

const primeiro = (lista) => [...(Array.isArray(lista) ? lista : [])].sort((a, b) => Number(a.rank) - Number(b.rank))[0];

export function registroRecomendado(dominio, config) {
  const nome = String(dominio).toLowerCase().replace(/\.$/, '');
  const raiz = dominioRaiz(nome);
  const ip = primeiro(config?.recommendedIPv4)?.value;
  const cname = primeiro(config?.recommendedCNAME)?.value;
  const partes = nome.split('.');
  const tamanhoDaRaiz = SUFIXOS_DE_DOIS_NIVEIS.has(partes.slice(-2).join('.')) ? 3 : 2;
  return {
    dominio: nome,
    tipo: raiz ? 'A' : 'CNAME',
    nome: raiz ? '@' : partes.slice(0, partes.length - tamanhoDaRaiz).join('.'),
    valor: raiz ? String((Array.isArray(ip) ? ip[0] : ip) ?? '') : String(cname ?? '').replace(/\.$/, ''),
    pronto: config?.misconfigured === false,
    vistoComo: config?.configuredBy ?? null,
  };
}
