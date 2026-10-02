// Os públicos automáticos da Meta, por projeto: o que o catálogo oferece, o que já foi criado,
// o que falta para criar. Quem fala com a Graph API é o cliente; quem guarda é o repositório;
// aqui só se decide a ordem — e a regra de não criar o mesmo público duas vezes.
import { PUBLICOS, publicoPorChave, regraDoPublico } from './meta-publicos.mjs';
import { criarClienteDePublicos, MetaApiError } from './meta-publicos-cliente.mjs';

const CONTA = /^\d{1,20}$/;
const CREDENCIAL = /^[A-Za-z0-9._~+\/=:-]{1,4096}$/;

function recusa(mensagem, status = 400) { return Object.assign(new Error(mensagem), { status, statusCode: status }); }

// O nome na Meta leva um prefixo: numa conta com dezenas de públicos, o dono precisa ver
// quais vieram do Studio — e é o nome que serve de chave para reconhecer o que já foi criado.
export const nomeNaMeta = (definicao) => `Alva · ${definicao.nome}`;

// `tokenDaConexao` (meta-token-da-conexao.mjs): quando o projeto escolheu a conta pela
// conexão da empresa, o token é o dela, resolvido na hora. Sem escolha pela conexão, vale a
// credencial colada de sempre.
export function criarServicoDePublicos({ repository, tracking, fetch: buscar = globalThis.fetch, tokenDaConexao = null }) {
  // Duas sincronizações do mesmo projeto ao mesmo tempo listariam a conta antes de qualquer
  // uma criar, e criariam o público em dobro. Dentro deste processo elas esperam a vez.
  const emAndamento = new Map();
  const naVez = (chave, tarefa) => {
    const anterior = emAndamento.get(chave) ?? Promise.resolve();
    const atual = anterior.catch(() => {}).then(tarefa);
    emAndamento.set(chave, atual);
    atual.finally(() => { if (emAndamento.get(chave) === atual) emAndamento.delete(chave); }).catch(() => {});
    return atual;
  };

  // O pixel é o que o projeto já configurou para a Meta em produção; não se pede de novo.
  async function pixelDoProjeto({ companyId, projectId }) {
    const destinos = await tracking.destinationsFor({ companyId, projectId, environment: 'production' });
    const id = destinos.find((item) => item.provider === 'meta' && item.configured)?.publicConfiguration?.pixel_id;
    return typeof id === 'string' && id ? id : null;
  }

  return {
    async estado(escopo) {
      const [credenciais, registrados, pixelId] = await Promise.all([
        repository.credenciaisPublicas(escopo), repository.listar(escopo), pixelDoProjeto(escopo),
      ]);
      const porChave = new Map(registrados.map((item) => [item.chave, item]));
      // O que falta, na ordem em que se resolve: cada item diz o que é e onde se consegue.
      const faltando = [];
      if (!pixelId) faltando.push({ chave: 'pixel', titulo: 'Pixel da Meta', onde: 'Configure o pixel da Meta no bloco "Meta", em "Plataformas", nesta aba. Os públicos são montados com os eventos que ele recebe.' });
      if (credenciais?.origem === 'connection' && !(await tokenDaConexao?.resolver(escopo.companyId).catch(() => null))) faltando.push({
        chave: 'conexao',
        titulo: 'Conta da Meta conectada',
        onde: 'A conta de anúncios deste projeto foi escolhida pela conexão com o Facebook, e a conexão precisa ser refeita. Clique em "Reconectar" no bloco da Meta, em "Plataformas", acima.',
      });
      if (!credenciais) faltando.push({
        chave: 'credenciais',
        titulo: 'ID da conta de anúncios e token de acesso',
        onde: 'O ID da conta de anúncios está no Gerenciador de Anúncios (número da conta, só dígitos). O token vem do Gerenciador de Negócios: crie um usuário do sistema, dê a ele acesso à conta de anúncios e gere um token com a permissão ads_management. Não serve o token que já enviamos para a Conversions API: aquele é do pixel e não cria públicos. Antes, aceite os Termos de Públicos Personalizados na conta de anúncios.',
      });
      return {
        credenciais: { configuradas: Boolean(credenciais), adAccountId: credenciais?.adAccountId ?? null, origem: credenciais ? credenciais.origem ?? 'manual' : null },
        pixelId,
        faltando,
        publicos: PUBLICOS.map((definicao) => {
          const registro = porChave.get(definicao.chave);
          return {
            chave: definicao.chave, nome: definicao.nome, descricao: definicao.descricao, uso: definicao.uso,
            evento: definicao.evento, retencaoDias: definicao.retencaoDias,
            estado: !registro ? 'nao_criado' : registro.status === 'created' ? 'criado' : 'erro',
            metaId: registro?.status === 'created' ? registro.metaId : null,
            erro: registro?.status === 'error' ? registro.erro : null,
            atualizadoEm: registro?.atualizadoEm ?? null,
          };
        }),
      };
    },

    async salvarCredenciais({ companyId, projectId, adAccountId, token }) {
      const conta = String(adAccountId ?? '').trim().replace(/^act_/i, '');
      if (!CONTA.test(conta)) throw recusa('Informe o ID numérico da conta de anúncios.');
      const segredo = token === undefined || token === null || token === '' ? null : String(token).trim();
      if (segredo !== null && !CREDENCIAL.test(segredo)) throw recusa('O token da Meta tem caracteres inválidos.');
      await repository.salvarCredenciais({ companyId, projectId, adAccountId: conta, token: segredo });
      return { configuradas: true, adAccountId: conta };
    },

    async removerCredenciais(escopo) {
      await repository.removerCredenciais(escopo);
      return { configuradas: false, adAccountId: null };
    },

    // Cria na Meta os públicos escolhidos que ainda não existem. Um que já foi criado não é
    // refeito; um que a conta já tem com o mesmo nome e o mesmo pixel é adotado (acontece
    // quando o dono desligou e religou, ou trocou de conta e voltou). O erro de um público
    // fica nele e a rodada segue — salvo erro de credencial ou permissão, que se repetiria
    // em todos: aí a rodada para e o mesmo motivo vai para o que sobrou.
    async sincronizar({ companyId, projectId, chaves }) {
      const escopo = { companyId, projectId };
      if (!Array.isArray(chaves) || chaves.length === 0) throw recusa('Escolha ao menos um público.');
      const definicoes = [...new Set(chaves)].map((chave) => publicoPorChave(chave) ?? (() => { throw recusa('Público desconhecido.'); })());
      return naVez(`${companyId}:${projectId}`, async () => {
        const credenciais = await repository.credenciais(escopo);
        if (!credenciais) throw recusa('Falta o token de acesso da Meta e o ID da conta de anúncios.', 409);
        const pixelId = await pixelDoProjeto(escopo);
        if (!pixelId) throw recusa('Falta o pixel da Meta neste projeto. Configure-o no bloco "Meta", em "Plataformas", antes de criar públicos.', 409);
        const pelaConexao = credenciais.origem === 'connection';
        let acesso = { token: credenciais.token, prova: null };
        if (pelaConexao) {
          const resolvido = await tokenDaConexao?.resolver(companyId);
          if (!resolvido) throw recusa('A conta da Meta conectada precisa ser conectada de novo. Clique em "Reconectar" no bloco da Meta, em "Plataformas".', 409);
          acesso = { token: resolvido.token, prova: resolvido.assinar ?? resolvido };
        }
        const cliente = criarClienteDePublicos({ fetch: buscar, token: acesso.token, contaDeAnuncios: credenciais.adAccountId, prova: acesso.prova, pelaConexao });
        const registrados = new Map((await repository.listar(escopo)).map((item) => [item.chave, item]));
        let naConta = null;
        const resultados = [];
        let falhaFatal = null;
        for (const definicao of definicoes) {
          const registro = registrados.get(definicao.chave);
          if (registro?.status === 'created') { resultados.push({ chave: definicao.chave, estado: 'criado', metaId: registro.metaId }); continue; }
          if (falhaFatal) {
            await repository.gravar({ ...escopo, chave: definicao.chave, status: 'error', erro: falhaFatal.message });
            resultados.push({ chave: definicao.chave, estado: 'erro', erro: falhaFatal.message });
            continue;
          }
          const nome = nomeNaMeta(definicao);
          try {
            const regra = regraDoPublico(definicao, pixelId);
            naConta ??= await cliente.listar();
            const existente = naConta.find((item) => item.nome === nome);
            let metaId;
            if (existente) {
              if (existente.pixelId && existente.pixelId !== pixelId) throw new MetaApiError('Já existe na conta um público com este nome ligado a outro pixel. Renomeie ou apague esse público na Meta e tente de novo.');
              metaId = existente.id;
            } else {
              ({ id: metaId } = await cliente.criar({ nome, regra }));
              naConta.push({ id: metaId, nome, pixelId });
            }
            await repository.gravar({ ...escopo, chave: definicao.chave, status: 'created', metaId, definicao: { nome, regra } });
            resultados.push({ chave: definicao.chave, estado: 'criado', metaId });
          } catch (erro) {
            if (!(erro instanceof MetaApiError)) throw erro;
            // Token da conexão recusado (190): a conexão inteira passa a pedir "Reconectar".
            if (pelaConexao && (erro.code === 190 || erro.code === 102)) await tokenDaConexao?.marcarParaReconectar({ companyId, motivo: 'publicos_token_recusado' }).catch(() => {});
            await repository.gravar({ ...escopo, chave: definicao.chave, status: 'error', erro: erro.message });
            resultados.push({ chave: definicao.chave, estado: 'erro', erro: erro.message });
            if (erro.fatal) falhaFatal = erro;
          }
        }
        return { resultados };
      });
    },

    // Desligar é esquecer o registro. O público continua na Meta: apagá-lo derrubaria
    // qualquer conjunto de anúncios que o use, e quem decide isso é o dono, no Gerenciador.
    async esquecer({ companyId, projectId, chave }) {
      if (!publicoPorChave(chave)) throw recusa('Público desconhecido.');
      await repository.esquecer({ companyId, projectId, chave });
      return { chave, estado: 'nao_criado' };
    },
  };
}
