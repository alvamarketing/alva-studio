// O envio de imagem do editor, visto pelo campo e pelo canvas.
//
// O Puck grava o valor de um campo no bloco que estiver selecionado na hora em que o valor
// chega (createOnChange lê o selectedItem do momento). O envio leva o tempo da rede; quem
// clicava em outro bloco durante ele mandava o endereço para esse outro bloco, e a imagem
// ficava vazia. Aqui o envio lembra quem o pediu e grava nele. O estado de cada envio fica
// num registro pequeno, para o canvas mostrar "Enviando…" ou o erro no lugar da imagem.
import { setDeep } from '@puckeditor/core';

const estados = new Map();
const ouvintes = new Set();
const avisar = () => ouvintes.forEach((ouvinte) => ouvinte());

export const chaveDoEnvio = (id, nome) => `${id ?? 'raiz'}:${nome}`;
export const estadoDoEnvio = (chave) => estados.get(chave);
export function ouvirEnvios(ouvinte) {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}
function marcar(chave, estado) {
  if (estado) estados.set(chave, estado); else estados.delete(chave);
  avisar();
}
// Digitar ou remover o endereço encerra o erro de um envio anterior.
export function limparEnvio(chave) { marcar(chave, null); }

// O Puck lança erro (não devolve undefined) quando o bloco já foi apagado.
function ler(tarefa) { try { return tarefa(); } catch { return null; } }

export function rotuloDoEnvio(envio) {
  if (envio?.fase === 'enviando') return { fase: 'enviando', texto: 'Enviando…' };
  if (envio?.fase === 'erro') return { fase: 'erro', texto: envio.mensagem || 'Não foi possível enviar a imagem.', dica: 'Escolha outra imagem.' };
  return { fase: 'vazia', texto: 'Escolher imagem' };
}

// `id` é o bloco dono do campo (null para a raiz da página); `nome`, o caminho do campo.
// Com o dono ainda selecionado, o valor segue pelo onChange do campo (o caminho normal do
// Puck, com resolveData); senão, é gravado direto no dono. Dono apagado: nada é gravado.
export async function enviarImagemPara({ getPuck, id, nome, arquivo, enviarImagem, aoMudar }) {
  const chave = chaveDoEnvio(id, nome);
  marcar(chave, { fase: 'enviando' });
  let endereco;
  try {
    endereco = await enviarImagem(arquivo);
  } catch (erro) {
    marcar(chave, { fase: 'erro', mensagem: erro?.message || 'Não foi possível enviar a imagem.' });
    return null;
  }
  // Seja qual for o caminho, o estado "Enviando…" sai: preso, ele desabilita o botão até recarregar.
  try {
    const api = getPuck();
    const selecionado = api.selectedItem?.props?.id ?? null;
    if (aoMudar && selecionado === id) aoMudar(endereco);
    else if (id === null) {
      const raiz = api.appState.data.root;
      api.dispatch({ type: 'replaceRoot', root: { ...raiz, props: setDeep(raiz.props ?? {}, nome, endereco) }, recordHistory: true });
    } else {
      const lugar = ler(() => api.getSelectorForId(id));
      const item = lugar ? ler(() => api.getItemById(id)) : null;
      if (item && lugar) api.dispatch({ type: 'replace', destinationIndex: lugar.index, destinationZone: lugar.zone, data: { ...item, props: setDeep(item.props, nome, endereco) } });
    }
  } finally {
    marcar(chave, null);
  }
  return endereco;
}

// Arquivo arrastado da área de trabalho para o editor. Sem quem o receba, o navegador abre o
// arquivo numa aba nova e a pessoa fica sem imagem no editor. Em cima de um bloco Imagem, o
// arquivo vai para ele; em qualquer outro lugar, o editor diz onde soltar.
const temArquivo = (evento) => Array.from(evento.dataTransfer?.types ?? []).includes('Files');
export function aceitarArquivosSoltos(doc, { getPuck, enviarImagem, aviso }) {
  const imagemSob = (alvo) => {
    const id = alvo?.closest?.('[data-puck-component]')?.getAttribute('data-puck-component');
    return id && getPuck().getItemById(id)?.type === 'image' ? id : null;
  };
  // "copy" em todo lugar: com "none" o navegador nem dispara o drop, e o aviso de onde
  // soltar nunca chegaria.
  const sobre = (evento) => {
    if (!temArquivo(evento)) return;
    evento.preventDefault();
    evento.dataTransfer.dropEffect = 'copy';
  };
  const soltar = (evento) => {
    if (!temArquivo(evento)) return;
    evento.preventDefault();
    const id = imagemSob(evento.target);
    const arquivo = evento.dataTransfer.files?.[0];
    if (id && arquivo) enviarImagemPara({ getPuck, id, nome: 'src', arquivo, enviarImagem });
    else aviso('Para usar uma imagem do computador, solte o arquivo em cima de um bloco Imagem.');
  };
  doc.addEventListener('dragover', sobre);
  doc.addEventListener('drop', soltar);
  return () => { doc.removeEventListener('dragover', sobre); doc.removeEventListener('drop', soltar); };
}
