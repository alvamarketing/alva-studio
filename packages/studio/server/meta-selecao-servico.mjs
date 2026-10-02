// A escolha da conta de anúncios e do pixel de um projeto, pela conexão da empresa (F2).
//
// A regra que mais importa: o servidor só aceita a conta e o pixel que a Meta devolveu para
// ESTA conexão. O id que chega do navegador é conferido contra a lista lida agora; um id
// qualquer (de outra empresa, inventado) não é gravado.
//
// Ao escolher, três coisas mudam juntas: o destino "Meta" do projeto passa a usar o pixel
// escolhido e o token da conexão (token_source 'connection', sem cópia do token), a
// credencial dos públicos passa a usar a mesma conta pela conexão, e a escolha fica gravada.
// Se havia pixel/token colados à mão, substituir exige confirmação explícita (D2).
// Contrato: docs/specs/2026-10-02-conectar-com-facebook.md.
import { AVISO_DE_VENCIMENTO_DIAS, diasParaVencer, linkDosTermos } from './meta-config.mjs';
import { soDigitosDaConta } from './meta-conexao-cliente.mjs';

const CONTA = /^\d{1,20}$/;

function recusa(mensagem, status = 400, code) {
  return Object.assign(new Error(mensagem), { status, statusCode: status, ...(code ? { code } : {}) });
}

export const CODIGO_MANUAL_EXISTENTE = 'meta_manual_existente';

// `transacao(fn)`: abre uma transação e passa o `client` a fn. As três gravações da escolha
// (destino, públicos, escolha) acontecem nela — falha no meio não apaga o token colado sem
// gravar a escolha. Sem ela (testes de unidade), as gravações seguem em sequência.
export function criarServicoDeSelecaoMeta({ conexoes, cliente, selecoes, tracking, publicos, agora = () => Date.now(), transacao = null }) {
  // A conexão com o token, pronta para chamar a Meta — ou o motivo de não estar.
  async function conexaoUtilizavel(companyId) {
    const conexao = await conexoes.comToken(companyId).catch(() => null);
    if (!conexao) throw recusa('Conecte a conta do Facebook antes de escolher a conta de anúncios.', 409);
    const dias = diasParaVencer(conexao.expiraEm, agora());
    if (dias !== null && dias <= 0 && conexao.status === 'connected') {
      await conexoes.marcarParaReconectar({ companyId, motivo: 'token_vencido' });
      conexao.status = 'needs_reconnect';
    }
    if (conexao.status !== 'connected') throw recusa('A Meta não aceita mais esta conexão. Clique em "Reconectar".', 409);
    return conexao;
  }

  // Toda chamada à Meta com o token da conexão passa por aqui: token recusado (190/102)
  // marca a conexão, e a tela passa a pedir "Reconectar" em vez de um erro solto.
  async function naMeta(companyId, tarefa) {
    try {
      return await tarefa();
    } catch (erro) {
      if (erro?.reconectar) await conexoes.marcarParaReconectar({ companyId, motivo: 'token_recusado' }).catch(() => {});
      throw erro;
    }
  }

  async function listarContas(companyId, conexao) {
    return naMeta(companyId, () => cliente.contasDeAnuncios(conexao.token));
  }

  async function destinoMeta(escopo) {
    if (!tracking) return null;
    const destinos = await tracking.destinationsFor({ ...escopo, environment: 'production' });
    const meta = destinos.find((item) => item.provider === 'meta');
    if (!meta?.configured) return { configurado: false, origem: null, pixelId: null };
    return {
      configurado: true,
      origem: meta.publicConfiguration?.token_source === 'connection' ? 'connection' : 'manual',
      pixelId: meta.publicConfiguration?.pixel_id ?? null,
    };
  }

  function vencimento(conexao) {
    const dias = diasParaVencer(conexao.expiraEm, agora());
    return { expiraEm: conexao.expiraEm ?? null, dias, venceEmBreve: dias !== null && dias <= AVISO_DE_VENCIMENTO_DIAS };
  }

  const servico = {
    async contasDeAnuncios({ companyId }) {
      const conexao = await conexaoUtilizavel(companyId);
      return { contas: await listarContas(companyId, conexao) };
    },

    async pixels({ companyId, adAccountId }) {
      const conta = soDigitosDaConta(adAccountId);
      if (!CONTA.test(conta)) throw recusa('Informe a conta de anúncios.');
      const conexao = await conexaoUtilizavel(companyId);
      const contas = await listarContas(companyId, conexao);
      if (!contas.some((item) => item.id === conta)) throw recusa('Esta conta de anúncios não aparece para a conta do Facebook conectada.', 404);
      return { pixels: await naMeta(companyId, () => cliente.pixels(conexao.token, conta)) };
    },

    // O estado do projeto para o cartão: quem está conectado, as Páginas, a escolha, de onde
    // vem o pixel/token do destino, o vencimento e os termos de públicos.
    async estado({ companyId, projectId }) {
      const escopo = { companyId, projectId };
      const [publica, escolha, destino, credencial] = await Promise.all([
        conexoes.publica(companyId), selecoes.ler(escopo), destinoMeta(escopo), publicos?.credenciaisPublicas?.(escopo) ?? null,
      ]);
      const base = {
        conectado: Boolean(publica),
        escolha,
        destino,
        publicos: credencial ? { adAccountId: credencial.adAccountId, origem: credencial.origem ?? 'manual' } : null,
        perfil: null,
        paginas: null,
        termos: null,
        vencimento: publica ? vencimento(publica) : null,
        precisaReconectar: publica ? publica.status !== 'connected' || (vencimento(publica).dias ?? 1) <= 0 : false,
      };
      if (!publica) return base;
      base.perfil = { nome: publica.nome };
      if (base.precisaReconectar) return base;
      let conexao;
      try { conexao = await conexaoUtilizavel(companyId); } catch { return { ...base, precisaReconectar: true }; }
      // As leituras abaixo são informativas: uma falha delas não esconde a escolha.
      const [paginas, termos] = await Promise.all([
        naMeta(companyId, () => cliente.paginas(conexao.token)).catch((erro) => ({ erro: erro.message, reconectar: Boolean(erro?.reconectar) })),
        escolha
          ? naMeta(companyId, () => cliente.termosAceitos(conexao.token, escolha.adAccountId))
            .then((aceitos) => ({ aceitos, link: aceitos ? null : linkDosTermos(escolha.adAccountId) }))
            .catch((erro) => ({ aceitos: null, link: linkDosTermos(escolha.adAccountId), erro: erro.message, reconectar: Boolean(erro?.reconectar) }))
          : null,
      ]);
      const recusou = paginas?.reconectar || termos?.reconectar;
      return {
        ...base,
        paginas: Array.isArray(paginas) ? paginas : [],
        erroPaginas: Array.isArray(paginas) ? null : paginas.erro,
        termos: termos ? { aceitos: termos.aceitos, link: termos.link, erro: termos.erro ?? null } : null,
        precisaReconectar: Boolean(recusou),
      };
    },

    async escolher({ companyId, projectId, userId, adAccountId, pixelId, substituirManual = false, automatica = false }) {
      const escopo = { companyId, projectId };
      const conta = soDigitosDaConta(adAccountId);
      const pixel = String(pixelId ?? '').trim();
      if (!CONTA.test(conta)) throw recusa('Escolha a conta de anúncios.');
      if (!CONTA.test(pixel)) throw recusa('Escolha o pixel.');
      const conexao = await conexaoUtilizavel(companyId);
      const contas = await listarContas(companyId, conexao);
      const contaEscolhida = contas.find((item) => item.id === conta);
      if (!contaEscolhida) throw recusa('Esta conta de anúncios não aparece para a conta do Facebook conectada.', 404);
      const pixels = await naMeta(companyId, () => cliente.pixels(conexao.token, conta));
      const pixelEscolhido = pixels.find((item) => item.id === pixel);
      if (!pixelEscolhido) throw recusa('Este pixel não pertence à conta de anúncios escolhida.', 404);

      // D2: pixel e token colados à mão só saem com confirmação explícita.
      const [destino, credencial] = await Promise.all([destinoMeta(escopo), publicos?.credenciaisPublicas?.(escopo) ?? null]);
      const temManual = destino?.origem === 'manual' || (credencial && (credencial.origem ?? 'manual') === 'manual');
      if (temManual && substituirManual !== true) {
        throw recusa('Este projeto já tem pixel ou token preenchidos à mão. Confirme para trocar pelos da conexão.', 409, CODIGO_MANUAL_EXISTENTE);
      }

      const gravar = async (client = undefined) => {
        const comCliente = client ? { client } : {};
        await tracking.saveDestination({ ...escopo, environment: 'production', provider: 'meta', configuration: { pixel_id: pixel }, tokenSource: 'connection', ...comCliente });
        if (publicos?.usarConexao) await publicos.usarConexao({ ...escopo, adAccountId: conta, connectionId: conexao.id, pixelId: pixel, ...comCliente });
        await selecoes.salvar({
          ...escopo, connectionId: conexao.id, adAccountId: conta, adAccountNome: contaEscolhida.nome,
          pixelId: pixel, pixelNome: pixelEscolhido.nome, automatica: automatica === true, userId, ...comCliente,
        });
      };
      if (transacao) await transacao(gravar);
      else await gravar();
      return servico.estado(escopo);
    },

    // Se a conexão do destino precisa de novo login — para a lista de Destinos mostrar.
    async precisaReconectar({ companyId }) {
      const publica = await conexoes.publica(companyId);
      if (!publica) return true;
      const dias = diasParaVencer(publica.expiraEm, agora());
      return publica.status !== 'connected' || (dias !== null && dias <= 0);
    },
  };
  return servico;
}
