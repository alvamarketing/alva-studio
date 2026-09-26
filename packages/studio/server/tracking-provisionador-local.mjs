// Provisionar um destino de conversão, sem serviço externo no meio.
//
// Antes isto era uma chamada de rede: o Studio pedia a um gateway PHP que criasse uma
// "propriedade", e esperava a resposta para marcar o binding como pronto. Com a entrega
// acontecendo aqui dentro, não há a quem pedir — estar pronto passa a significar uma
// coisa só: existe credencial de algum destino que sabemos entregar.
//
// O identificador da propriedade continua existindo porque o payload do evento o carrega,
// mas é derivado do próprio binding. Mesma entrada, mesmo identificador, sempre — sem
// depender de o serviço remoto lembrar o que respondeu da última vez.

import { DESTINOS } from './tracking-destinos.mjs';

function falhar(mensagem) {
  return Object.assign(new Error(mensagem), { status: 400, statusCode: 400 });
}

export function identificadorDaPropriedade(bindingId) {
  return `nvs_${String(bindingId ?? '').replace(/-/g, '')}`;
}

export function criarProvisionadorLocal({ tracking } = {}) {
  if (!tracking?.nvsDestinations) throw new Error('O provisionador exige o repositório de tracking.');

  return {
    async provision({ companyId, projectId, environment, bindingId } = {}) {
      const destinos = await tracking.nvsDestinations({ companyId, projectId, environment });
      const configurados = Object.keys(destinos || {});
      if (!configurados.length)
        throw falhar('Nenhum destino de conversão configurado neste projeto.');

      // Um destino que não sabemos entregar marcaria o projeto como pronto e depois falharia
      // em toda entrega, sem ninguém entender por quê.
      const desconhecido = configurados.find((provedor) => !DESTINOS[provedor]);
      if (desconhecido) throw falhar(`Destino de conversão desconhecido: ${desconhecido}.`);

      return { remoteId: identificadorDaPropriedade(bindingId) };
    },
  };
}
