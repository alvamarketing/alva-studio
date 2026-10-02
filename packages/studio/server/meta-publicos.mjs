// Os públicos personalizados de site que o Studio sabe montar na Meta, e a regra de cada um.
//
// Só entra aqui o evento que o pixel do navegador realmente dispara hoje (ver
// publication-runtime.mjs: o lead com o nome padrão e os quatro eventos da VSL). A Meta
// monta o público com o que o pixel recebeu; um público de um evento que nunca chega ficaria
// vazio para sempre, e o dono acharia que o remarketing está rodando. O quiz, por exemplo,
// não dispara evento próprio no pixel — só o lead dele — e por isso não tem público aqui.
// Um teste confere cada evento do catálogo contra o código do carregador.
//
// A exclusão não é uma regra de exclusão da Meta: é o público "Virou lead", que o dono
// escolhe em "Excluir" no conjunto de anúncios (a documentação descreve a exclusão como
// escolha de targeting no Gerenciador de Anúncios). Assim quem já virou lead sai do
// remarketing sem o Studio precisar mexer em conjunto de anúncio nenhum.
// https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/guides/website-custom-audiences
import { nomeNaPlataforma } from './nomes-de-evento.mjs';

// `retention_days` da Meta vai de 1 a 180 (página de Website Custom Audiences). A página de
// regras fala em até 365 dias no `retention_seconds`; ficamos no limite menor, o que vale
// para os dois parâmetros.
export const RETENCAO_MAXIMA_DIAS = 180;
const SEGUNDOS_POR_DIA = 86_400;

const NOME_DO_LEAD = nomeNaPlataforma('meta', 'lead');

// `marco`: a VSL manda o marco de retenção (25, 50, 75, 100) no parâmetro `value` do evento
// `vsl_progress`. "Assistiu pelo menos N%" é `value >= N`: quem chegou a 75% também passou
// por 50%, e o público de 50% não pode perdê-lo se o evento de 50% for descartado.
const publico = (dados) => Object.freeze(dados);

export const PUBLICOS = Object.freeze([
  publico({
    chave: 'vsl_iniciou', nome: 'Começou a assistir a VSL', evento: 'vsl_start', retencaoDias: 30, uso: 'remarketing',
    descricao: 'Quem apertou o play na VSL. Serve para lembrar quem começou e não terminou.',
  }),
  publico({
    chave: 'vsl_50', nome: 'Assistiu 50% da VSL', evento: 'vsl_progress', marco: 50, retencaoDias: 30, uso: 'remarketing',
    descricao: 'Quem chegou à metade da VSL ou além. Interesse real, ainda sem ter virado lead.',
  }),
  publico({
    chave: 'vsl_75', nome: 'Assistiu 75% da VSL', evento: 'vsl_progress', marco: 75, retencaoDias: 30, uso: 'remarketing',
    descricao: 'Quem passou de três quartos da VSL: já ouviu quase toda a oferta.',
  }),
  publico({
    chave: 'vsl_completa', nome: 'Assistiu a VSL toda', evento: 'vsl_complete', retencaoDias: 30, uso: 'remarketing',
    descricao: 'Quem terminou a VSL. O público mais quente antes do clique no botão.',
  }),
  publico({
    chave: 'vsl_cta', nome: 'Clicou no botão da VSL', evento: 'vsl_cta_click', retencaoDias: 30, uso: 'remarketing',
    descricao: 'Quem clicou no botão de ação da VSL e talvez não tenha concluído.',
  }),
  publico({
    chave: 'lead', nome: 'Virou lead', evento: NOME_DO_LEAD, retencaoDias: RETENCAO_MAXIMA_DIAS, uso: 'exclusao',
    descricao: 'Quem deixou o contato. Escolha este público em "Excluir" nos conjuntos de anúncio de remarketing para não insistir com quem já converteu.',
  }),
]);

export function publicoPorChave(chave) {
  return PUBLICOS.find((item) => item.chave === chave) ?? null;
}

// A regra no formato que a Meta documenta para público de site:
// https://developers.facebook.com/documentation/ads-commerce/marketing-api/audiences/guides/audience-rules
// O evento entra como filtro `event` e o marco como filtro sobre o parâmetro `value`, no
// mesmo formato aninhado do exemplo de `ViewContent` com `price >= 100` dessa página.
export function regraDoPublico(definicao, pixelId) {
  if (!definicao) throw Object.assign(new Error('Público desconhecido.'), { status: 400 });
  if (!/^\d{1,20}$/.test(String(pixelId ?? ''))) throw Object.assign(new Error('Informe o ID do pixel da Meta antes de criar públicos.'), { status: 409 });
  const filtros = [{ field: 'event', operator: 'eq', value: definicao.evento }];
  if (definicao.marco !== undefined) filtros.push({ operator: 'or', filters: [{ field: 'value', operator: '>=', value: String(definicao.marco) }] });
  return {
    inclusions: {
      operator: 'or',
      rules: [{
        event_sources: [{ id: String(pixelId), type: 'pixel' }],
        retention_seconds: definicao.retencaoDias * SEGUNDOS_POR_DIA,
        filter: { operator: 'and', filters: filtros },
      }],
    },
  };
}
