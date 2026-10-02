// O token da conexão da empresa, para quem envia à Meta em nome de um projeto: a Conversions
// API (worker) e os públicos. Decifra na hora e assina com a prova do segredo do app (D8);
// nada disso é guardado fora do cofre.
//
// Decisão de 02/10/2026 (muda a D3 da spec): a CAPI usa o token da conexão mesmo sendo de
// usuário (≈60 dias). Por isso este módulo é rígido com o vencimento: token vencido, conexão
// marcada para reconectar ou desfeita devolvem `null`, e quem chama falha de forma visível.
import { diasParaVencer } from './meta-config.mjs';
import { provaDoSegredo } from './meta-conexao-cliente.mjs';

export function criarTokenDaConexao({ conexoes, configuracao, agora = () => Date.now() }) {
  if (!conexoes) throw new Error('Repositório das conexões da Meta obrigatório.');

  async function marcarParaReconectar({ companyId, motivo = null }) {
    await conexoes.marcarParaReconectar({ companyId, motivo });
  }

  return {
    // Sem o app da Meta no ambiente (META_APP_SECRET) não há como assinar a chamada.
    configurado: Boolean(configuracao),

    async resolver(companyId) {
      if (!configuracao) return null;
      let conexao;
      try {
        conexao = await conexoes.comToken(companyId);
      } catch {
        // Cofre que não decifra (chave trocada, linha adulterada) é conexão inutilizável.
        return null;
      }
      if (!conexao || conexao.status !== 'connected' || !conexao.token) return null;
      const dias = diasParaVencer(conexao.expiraEm, agora());
      if (dias !== null && dias <= 0) {
        await marcarParaReconectar({ companyId, motivo: 'token_vencido' });
        return null;
      }
      // `assinar` gera uma prova nova a cada chamada (vence em 5 minutos): quem faz várias
      // chamadas seguidas, como os públicos, não reaproveita uma prova velha.
      const assinar = () => provaDoSegredo({ token: conexao.token, appSecret: configuracao.appSecret, agora: agora() });
      return { conexaoId: conexao.id, token: conexao.token, ...assinar(), assinar };
    },

    marcarParaReconectar,
  };
}
