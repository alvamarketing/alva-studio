// Quem pode criar a conta de dono no primeiro acesso.
//
// Um Studio num endereço público não pode ser de quem chegar primeiro: entre subir e o dono
// abrir a tela, qualquer um poderia criar a conta. Em produção a criação exige o código de
// instalação (SETUP_CODE), que só existe na configuração do servidor. Sem endereço público
// (na máquina de quem desenvolve), vale só o acesso pelo próprio computador.
import { timingSafeEqual } from 'node:crypto';

const falhar = (mensagem, status = 403) => Object.assign(new Error(mensagem), { status, statusCode: status });

export function exigeCodigoDeInstalacao({ publicOrigin }) {
  return Boolean(publicOrigin);
}

export function conferirCriacaoDeConta({ publicOrigin, codigoEsperado, codigoInformado, acessoLocal }) {
  if (!exigeCodigoDeInstalacao({ publicOrigin })) {
    if (!acessoLocal) throw falhar('Abra o Studio pelo próprio computador para criar a conta.');
    return true;
  }
  const esperado = String(codigoEsperado ?? '');
  if (esperado.length < 16) throw falhar('Este Studio ainda não tem código de instalação. Defina SETUP_CODE na configuração do servidor.');
  const informado = Buffer.from(String(codigoInformado ?? '').trim());
  const certo = Buffer.from(esperado);
  if (informado.length !== certo.length || !timingSafeEqual(informado, certo)) throw falhar('Código de instalação inválido.');
  return true;
}
