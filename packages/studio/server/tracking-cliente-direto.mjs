// O cliente que entrega o evento comercial direto ao destino, sem gateway no meio.
//
// Ocupa o lugar do NvsClient, que mandava o evento para um serviço PHP que fazia esta
// mesma chamada. A interface é a mesma — `sendEvent(entrega)` — para o worker da fila não
// precisar saber quem entrega.
//
// A credencial nunca é guardada aqui: ela é lida cifrada e decifrada a cada entrega pelo
// repositório de tracking, no escopo daquele projeto e ambiente.

import { entregarEvento } from './tracking-entrega.mjs';

// Destino da Meta configurado pela conexão (`token_source: 'connection'`) não guarda token:
// ele é resolvido a cada entrega pelo `tokenDaConexao` (meta-token-da-conexao.mjs). Se a
// conexão sumiu, venceu ou a Meta recusou o token, a entrega falha sem retentar e com um
// motivo próprio — a tela de eventos diz "reconecte", nunca uma falha muda.
export const MOTIVO_RECONECTAR = 'destination_connection_needs_reconnect';
export const MOTIVO_SEM_APP = 'destination_connection_unavailable';

export function criarClienteDeDestinos({ tracking, fetchImpl = fetch, tempoLimiteMs, tokenDaConexao = null } = {}) {
  if (!tracking?.conversionDestinations) throw new Error('O cliente de destinos exige o repositório de tracking.');

  async function credenciaisDaConexao(companyId, credenciais) {
    if (!tokenDaConexao?.configurado) throw Object.assign(new Error(MOTIVO_SEM_APP), { retentar: false });
    const resolvido = await tokenDaConexao.resolver(companyId);
    if (!resolvido) throw Object.assign(new Error(MOTIVO_RECONECTAR), { retentar: false });
    const { token_source: _origem, ...resto } = credenciais;
    return { ...resto, access_token: resolvido.token, appsecret_proof: resolvido.appsecret_proof, appsecret_time: resolvido.appsecret_time };
  }

  return {
    async sendEvent(entrega) {
      const destino = String(entrega?.destination || '');
      const credenciaisPorProvedor = await tracking.conversionDestinations({
        companyId: entrega.companyId,
        projectId: entrega.projectId,
        environment: entrega.environment,
      });
      const guardadas = credenciaisPorProvedor?.[destino];
      // Sem credencial o evento não tem para onde ir. Falhar como permanente evita gastar
      // as tentativas da fila repetindo uma configuração que ninguém corrigiu ainda.
      if (!guardadas) throw Object.assign(new Error('destination_not_configured'), { retentar: false });
      const pelaConexao = destino === 'meta' && guardadas.token_source === 'connection';
      const credenciais = pelaConexao ? await credenciaisDaConexao(entrega.companyId, guardadas) : guardadas;

      const resultado = await entregarEvento({
        destino,
        evento: entrega.payload,
        credenciais,
        fetchImpl,
        ...(tempoLimiteMs ? { tempoLimiteMs } : {}),
      });
      if (resultado.entregue) return resultado;
      // A Meta recusou o token da conexão (190/102): a conexão inteira fica "precisa
      // reconectar" — o cartão da Meta e os outros projetos passam a mostrar isso.
      if (pelaConexao && resultado.motivo === 'destination_credential_rejected') {
        await tokenDaConexao.marcarParaReconectar({ companyId: entrega.companyId, motivo: 'capi_token_recusado' }).catch(() => {});
        throw Object.assign(new Error(MOTIVO_RECONECTAR), { retentar: false });
      }
      throw Object.assign(new Error(resultado.motivo || 'delivery_failed'), { retentar: resultado.retentar === true });
    },
  };
}
