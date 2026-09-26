// O cliente que entrega o evento comercial direto ao destino, sem gateway no meio.
//
// Ocupa o lugar do NvsClient, que mandava o evento para um serviço PHP que fazia esta
// mesma chamada. A interface é a mesma — `sendEvent(entrega)` — para o worker da fila não
// precisar saber quem entrega.
//
// A credencial nunca é guardada aqui: ela é lida cifrada e decifrada a cada entrega pelo
// repositório de tracking, no escopo daquele projeto e ambiente.

import { entregarEvento } from './tracking-entrega.mjs';

export function criarClienteDeDestinos({ tracking, fetchImpl = fetch, tempoLimiteMs } = {}) {
  if (!tracking?.conversionDestinations) throw new Error('O cliente de destinos exige o repositório de tracking.');

  return {
    async sendEvent(entrega) {
      const destino = String(entrega?.destination || '');
      const credenciaisPorProvedor = await tracking.conversionDestinations({
        companyId: entrega.companyId,
        projectId: entrega.projectId,
        environment: entrega.environment,
      });
      const credenciais = credenciaisPorProvedor?.[destino];
      // Sem credencial o evento não tem para onde ir. Falhar como permanente evita gastar
      // as tentativas da fila repetindo uma configuração que ninguém corrigiu ainda.
      if (!credenciais) throw Object.assign(new Error('destination_not_configured'), { retentar: false });

      const resultado = await entregarEvento({
        destino,
        evento: entrega.payload,
        credenciais,
        fetchImpl,
        ...(tempoLimiteMs ? { tempoLimiteMs } : {}),
      });
      if (resultado.entregue) return resultado;
      throw Object.assign(new Error(resultado.motivo || 'delivery_failed'), { retentar: resultado.retentar === true });
    },
  };
}
