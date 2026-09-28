// O IP de quem fez a requisição. Na VPS o Studio fica atrás do Traefik: o endereço do socket
// é o do proxy, igual para todo visitante — o limite de tentativas do login e o visitante
// único do analytics tratariam todo mundo como uma pessoa só. O proxy acrescenta o IP que
// o conectou ao fim do X-Forwarded-For; o que vem antes o visitante pode ter escrito, o
// último não. Só vale com TRUST_PROXY=true (compose.vps.yaml): sem proxy na frente, o
// cabeçalho inteiro seria do visitante.
export function ipDoVisitante(req, { atrasDeProxy = process.env.TRUST_PROXY === 'true' } = {}) {
  const socket = req?.socket?.remoteAddress ?? null;
  if (!atrasDeProxy) return socket;
  const ultimo = String(req?.headers?.['x-forwarded-for'] ?? '').split(',').map((parte) => parte.trim()).filter(Boolean).at(-1);
  return ultimo || socket;
}
