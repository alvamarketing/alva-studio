// O `state` do login da Meta: prova de que a volta do Facebook é a continuação de um clique
// feito aqui, pela mesma pessoa, na mesma sessão e empresa. A assinatura impede forjar; a
// linha em meta_oauth_states (consumida uma vez) impede repetir. Contrato na spec,
// "Arquitetura › state".
import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

const VERSAO = 1;
// D7: o segredo vem da chave-mestra do rastreamento, por HKDF com rótulo próprio. Não há
// variável nova para configurar, e vazar o segredo do state não revela a chave dos cofres.
const ROTULO = 'alva/meta-oauth-state/v1';
// Um state honesto tem ~300 caracteres; o teto só existe para não processar lixo grande.
const TAMANHO_MAXIMO = 2048;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export const sha256 = (valor) => createHash('sha256').update(String(valor)).digest('hex');

export function segredoDoState(chaveMestra) {
  if (typeof chaveMestra !== 'string' || !chaveMestra.trim()) throw new Error('A TRACKING_MASTER_KEY é obrigatória para conectar com a Meta.');
  return Buffer.from(hkdfSync('sha256', chaveMestra, Buffer.alloc(0), ROTULO, 32));
}

const assinatura = (payload, segredo) => createHmac('sha256', segredo).update(payload).digest();

export function assinarState({ nonce, companyId, projectId, userId, sessionId, expiraEm }, segredo) {
  const payload = Buffer.from(JSON.stringify({
    v: VERSAO, n: nonce, c: companyId, p: projectId, u: userId, s: sha256(sessionId), exp: Math.floor(expiraEm / 1000),
  })).toString('base64url');
  return `${payload}.${assinatura(payload, segredo).toString('base64url')}`;
}

// Devolve os dados ou null. Não diz por que recusou: para quem forja, "assinatura errada" e
// "vencido" são a mesma resposta.
export function lerState(state, segredo, { agora = Date.now() } = {}) {
  if (typeof state !== 'string' || state.length > TAMANHO_MAXIMO) return null;
  const partes = state.split('.');
  if (partes.length !== 2 || !BASE64URL.test(partes[0]) || !BASE64URL.test(partes[1])) return null;
  const [payload, recebida] = partes;
  const esperada = assinatura(payload, segredo);
  const dada = Buffer.from(recebida, 'base64url');
  // Comparação em tempo constante: o tempo da resposta não pode ensinar a assinatura byte a byte.
  if (dada.length !== esperada.length || !timingSafeEqual(dada, esperada)) return null;
  let dados;
  try { dados = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (dados?.v !== VERSAO) return null;
  const textos = [dados.n, dados.c, dados.p, dados.u, dados.s];
  if (textos.some((valor) => typeof valor !== 'string' || !valor) || !Number.isInteger(dados.exp)) return null;
  if (dados.exp * 1000 <= agora) return null;
  return { nonce: dados.n, companyId: dados.c, projectId: dados.p, userId: dados.u, sessionHash: dados.s, expiraEm: dados.exp * 1000 };
}
