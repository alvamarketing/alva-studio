# Trabalho pronto que não está na main

A branch `codex/alva-studio-resgate-2026-09-06` (`f85866c`, 10/09) carrega três
frentes que nunca entraram na main. Não é rascunho perdido: tem migração, código e
teste. Está aqui porque trabalho que só existe no nome de uma branch é trabalho que
se refaz do zero daqui a três meses.

## O que tem

**Cobrança pela Asaas** — `server/asaas-billing.mjs`, migração `billing_company`,
testes `asaas-billing` e `billing-schema`, mais a spec e o plano. A main já tem
`billing-service.mjs` e `billing-policy.mjs`; falta o cliente da Asaas em si, que é
o que faz o botão "Abrir checkout" sair do lugar.

**Pixels de rastreamento** — `server/pixel-registry.mjs`,
`repositories/pixel-repository.mjs`, migração `tracking_pixels`, três testes, spec e
plano.

**Provedores de vídeo** — `server/media-source.mjs` e os adaptadores de player
(`vsl-adapters.js`, `youtube-adapter.js`, `vimeo-adapter.js`), migração
`media_providers`, dois testes. Complementa a hospedagem própria na Cloudflare
Stream, que a main já tem: aqui é tocar vídeo que mora no YouTube ou no Vimeo.

## O que morde na hora de integrar

As três migrações nasceram como `013`, `014` e `015`. Esses números já pertencem a
outras migrações na main (`tracking_provisioning`, `umami_cutover`,
`nvs_commercial_outbox`), e a validação por checksum não perdoa: renumere para o fim
da fila antes de qualquer coisa.

`forms.js` e `forms-ui.test.mjs` também aparecem no diff da branch. Esses ficaram
para trás de propósito — são o editor de quiz antigo, removido quando o quiz virou
uma página com marca.

## Como olhar sem misturar

```sh
git diff main codex/alva-studio-resgate-2026-09-06 -- packages/studio/server packages/studio/test
```
