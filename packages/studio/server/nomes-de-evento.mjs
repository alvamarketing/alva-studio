// O nome de cada evento em cada plataforma, num lugar só: o servidor (Conversions API,
// Events API) e o pixel do navegador leem daqui. A plataforma só junta as duas fontes de
// um mesmo lead quando o nome e o id coincidem — dois nomes escritos em dois lugares
// divergiriam em silêncio, e o lead seria contado duas vezes.
//
// O nome interno (`lead`) não é o nome padrão de nenhuma plataforma. A Meta documenta
// `Lead`, `InitiateCheckout` e `Purchase`; o TikTok renomeou `SubmitForm` para `Lead` e
// `CompletePayment` para `Purchase` em 2025. Eventos sem nome padrão (os da VSL) seguem
// com o nome interno, como eventos personalizados.
export const NOMES_PADRAO = Object.freeze({
  meta: Object.freeze({ lead: 'Lead', initiate_checkout: 'InitiateCheckout', purchase: 'Purchase' }),
  tiktok: Object.freeze({ lead: 'Lead', initiate_checkout: 'InitiateCheckout', purchase: 'Purchase' }),
});

export function nomeNaPlataforma(plataforma, evento) {
  return NOMES_PADRAO[plataforma]?.[evento] ?? evento;
}
