// Os pixels ficam gravados no manifesto no momento da publicação em produção
// (publication_runtime_manifests.providers). Mudar um pixel depois disso não muda a página
// que está no ar — só publicar de novo. Esta é a comparação que o Studio usa para avisar.
const normalizado = (lista) => JSON.stringify(
  (Array.isArray(lista) ? lista : [])
    .map(({ provider, id }) => ({ provider: String(provider), id: String(id) }))
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id)),
);

export function pixelsDesatualizados(noAr, atuais) {
  return normalizado(noAr) !== normalizado(atuais);
}
