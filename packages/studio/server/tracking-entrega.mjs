// A entrega de um evento comercial ao destino, em Node.
//
// Substitui o gateway PHP: o Studio passa a falar direto com Meta, TikTok, Google,
// LinkedIn e Taboola, em vez de mandar o evento para um serviço intermediário que fazia
// a mesma chamada.
//
// O que esta camada decide é uma coisa só: se vale insistir. Insistir no que não melhora
// — credencial errada, corpo recusado — só gasta tentativa e atrasa a fila. Não insistir
// no que é transitório perde conversão de verdade.
//
// O que ela nunca faz é mexer no identificador do evento. Ele vem da fila, foi gerado uma
// vez quando o visitante agiu, e é o mesmo em toda tentativa. É assim que a plataforma
// reconhece a repetição e conta uma conversão só.

import { destinoPara } from './tracking-destinos.mjs';

const TEMPO_LIMITE_MS = 12_000;

// 408 e 429 são a plataforma pedindo para esperar; 5xx é ela com problema. O resto é
// defeito nosso, e defeito nosso não se conserta repetindo.
const STATUS_QUE_MERECEM_OUTRA_TENTATIVA = new Set([408, 429]);

export function classificarResposta({ status, erroDeRede = false } = {}) {
  if (erroDeRede) return { retentar: true, motivo: 'transport_error' };
  if (status >= 200 && status < 300) return { retentar: false, motivo: null };
  if (status >= 500 || STATUS_QUE_MERECEM_OUTRA_TENTATIVA.has(status)) return { retentar: true, motivo: `destination_unavailable_${status}` };
  return { retentar: false, motivo: `destination_rejected_${status}` };
}

export async function entregarEvento({
  destino,
  evento,
  credenciais = {},
  fetchImpl = fetch,
  tempoLimiteMs = TEMPO_LIMITE_MS,
} = {}) {
  let pedido;
  try {
    pedido = destinoPara(destino).requisicao(evento, credenciais);
  } catch (erro) {
    // Credencial ausente ou identificador faltando: repetir daria o mesmo resultado.
    return { entregue: false, retentar: false, motivo: erro.message };
  }

  const cabecalhos = Object.fromEntries(
    (pedido.cabecalhos || []).map((linha) => {
      const separador = linha.indexOf(':');
      return [linha.slice(0, separador).trim(), linha.slice(separador + 1).trim()];
    }),
  );
  if (pedido.corpo !== null && pedido.corpo !== undefined) cabecalhos['Content-Type'] = 'application/json';

  let resposta;
  try {
    resposta = await fetchImpl(pedido.url, {
      method: pedido.metodo,
      headers: cabecalhos,
      ...(pedido.corpo === null || pedido.corpo === undefined ? {} : { body: JSON.stringify(pedido.corpo) }),
      signal: AbortSignal.timeout(tempoLimiteMs),
    });
  } catch {
    return { entregue: false, retentar: true, motivo: 'transport_error' };
  }

  const { retentar, motivo } = classificarResposta({ status: resposta.status });
  if (!motivo) return { entregue: true, status: resposta.status };
  return { entregue: false, retentar, motivo, status: resposta.status };
}
