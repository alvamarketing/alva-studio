// "Conectar com o Facebook": a ordem das coisas. Quem fala com a Meta é o cliente; quem
// guarda é o repositório; aqui se decide o que acontece antes de quê — e a regra que mais
// importa: o `state` é conferido e consumido ANTES de qualquer chamada à Meta. Uma volta
// forjada, repetida ou de outra sessão não chega a gastar o código de ninguém.
// Contrato: docs/specs/2026-10-02-conectar-com-facebook.md.
import { randomBytes } from 'node:crypto';
import { ESCOPOS, PRAZOS } from './meta-config.mjs';
import { assinarState, lerState, segredoDoState, sha256 } from './meta-oauth-state.mjs';

const CODIGO = /^[\x21-\x7e]{1,2048}$/;
const ERRO_DO_DIALOGO = /^[a-z_]{1,64}$/;

function recusa(mensagem, status = 400) { return Object.assign(new Error(mensagem), { status, statusCode: status }); }

// Uma mensagem só para toda volta que não confere: a pessoa não precisa (e quem forja não
// deve) saber se foi a assinatura, o prazo, a sessão ou o reuso.
const voltaInvalida = () => recusa('A volta do Facebook não confere com este acesso. Clique em "Conectar com o Facebook" de novo.');

export function criarServicoDeConexaoMeta({ repository, cliente, configuracao, chaveMestra, agora = () => Date.now(), aleatorio = randomBytes }) {
  const segredo = segredoDoState(chaveMestra);

  async function estado({ companyId }) {
    const conexao = await repository.publica(companyId);
    if (!conexao) return { conectado: false, tipoDeToken: configuracao.tipoDeToken };
    return {
      conectado: true,
      ...conexao,
      precisaReconectar: conexao.status === 'needs_reconnect',
      permissoesFaltando: ESCOPOS.filter((escopo) => !conexao.escopos.includes(escopo)),
    };
  }

  return {
    estado,

    // Gera o state, guarda o hash do nonce e devolve o endereço do diálogo. A tela navega
    // para ele na mesma aba (D9).
    async iniciar({ companyId, projectId, userId, sessionId, origem }) {
      const nonce = aleatorio(32).toString('base64url');
      const expiraEm = agora() + PRAZOS.stateMs;
      const redirectUri = configuracao.redirecionamento(origem);
      try {
        await repository.registrarState({
          nonceHash: sha256(nonce), companyId, projectId, userId, sessionHash: sha256(sessionId), redirectUri, expiraEm: new Date(expiraEm),
        });
      } catch (erro) {
        // A chave estrangeira (empresa, projeto) recusa projeto de outra empresa.
        if (erro?.code === '23503' || erro?.code === '22P02') throw recusa('Projeto não encontrado.', 404);
        throw erro;
      }
      const state = assinarState({ nonce, companyId, projectId, userId, sessionId, expiraEm }, segredo);
      return { url: cliente.urlDeAutorizacao({ state, redirectUri }) };
    },

    // Empresa, pessoa e sessão vêm do contexto autenticado, nunca do corpo: é o que impede
    // alguém de concluir, na sessão de outra pessoa, uma autorização que ele mesmo começou.
    async concluir({ companyId, userId, sessionId, code, error, state }) {
      const dados = lerState(state, segredo, { agora: agora() });
      if (!dados) throw voltaInvalida();
      const sessionHash = sha256(sessionId);
      if (dados.companyId !== companyId || dados.userId !== userId || dados.sessionHash !== sessionHash) throw voltaInvalida();
      const consumido = await repository.consumirState({ nonceHash: sha256(dados.nonce), companyId, userId, sessionHash });
      if (!consumido) throw voltaInvalida();

      // A pessoa cancelou (ou o Facebook não concluiu): nada é gravado, e o state já não serve.
      // https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow#nonjscancel
      if (error !== undefined && error !== null && error !== '') {
        const motivo = ERRO_DO_DIALOGO.test(String(error)) ? String(error) : 'desconhecido';
        return {
          estado: 'cancelado',
          projectId: consumido.projectId,
          aviso: motivo === 'access_denied' ? 'Você cancelou no Facebook. Nada foi conectado.' : 'O Facebook não concluiu a autorização. Nada foi conectado.',
        };
      }
      if (typeof code !== 'string' || !CODIGO.test(code)) throw voltaInvalida();

      const trocado = await cliente.trocarCodigo({ code, redirectUri: consumido.redirectUri });
      // D3: token de usuário vira de longa duração (≈60 dias); o de sistema não vence.
      const final = configuracao.tipoDeToken === 'user' ? await cliente.estenderToken(trocado.token) : trocado;
      const perfil = await cliente.quemSou(final.token);
      const { concedidas } = await cliente.permissoes(final.token);
      const conexao = await repository.salvar({
        companyId, metaUserId: perfil.id, nome: perfil.nome, tipoDeToken: configuracao.tipoDeToken, token: final.token,
        escopos: concedidas, clientBusinessId: perfil.clientBusinessId, expiraEm: final.expiraEm ?? trocado.expiraEm ?? null, conectadoPor: userId,
      });
      return { estado: 'conectado', projectId: consumido.projectId, conexao };
    },

    // Apaga a conexão daqui primeiro: a Meta fora do ar não pode prender o dono a uma conexão
    // que ele quer desfazer. Depois, se ninguém mais no Studio usa a mesma pessoa da Meta,
    // desautoriza o app lá — revogar derruba todo token dela, inclusive o de outra empresa.
    // Públicos e escolhas dos projetos ficam (D10).
    async desconectar({ companyId }) {
      const removida = await repository.remover(companyId);
      if (removida?.token) {
        const outras = await repository.outrasEmpresasDoUsuario({ metaUserId: removida.metaUserId, companyId });
        if (outras === 0) await cliente.revogar({ token: removida.token, metaUserId: removida.metaUserId }).catch(() => {});
      }
      return { conectado: false, tipoDeToken: configuracao.tipoDeToken };
    },

    // Token recusado pela Meta (190/102): a conexão continua, mas a tela pede novo login.
    async marcarParaReconectar({ companyId, motivo = null }) {
      await repository.marcarParaReconectar({ companyId, motivo });
    },
  };
}
