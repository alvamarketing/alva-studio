# Task 7 — política de consentimento para conversões

Data: 2026-09-06 · `policyVersion: 1`

## Contrato server-side

O gateway resolve `pending`, `denied` ou `granted` exclusivamente do registro
server-side ligado ao manifesto de runtime (projeto, domínio, ambiente, snapshot,
publicação e `policyVersion`). Qualquer estado de consentimento ou hash enviado
pelo navegador é ignorado ou recusado; o browser nunca declara consentimento nem
envia hash.

Eventos comerciais/NVS são sempre persistidos e deduplicados no Studio,
encaminhados ao NVS e enviados aos adaptadores externos habilitados nos três
estados. Somente flags técnicas desligadas ou providers não habilitados
bloqueiam egress; isso não impede a persistência local nem o `tracking_event_id`.

`pending` e `denied` permitem somente evento, `tracking_event_id`, tempo,
conteúdo, valor/moeda e IDs pseudônimos de atribuição da allowlist fechada.
`granted` também permite hashes normalizados, gerados exclusivamente no
servidor. Revogação/invalidação afeta apenas eventos futuros e nunca enriquece
eventos retroativamente.

## Allowlist fechada por adaptador

| Adaptador | IDs pseudônimos aceitos | Campos externos canônicos |
|---|---|---|
| Meta | `fbc`, `fbp` | `fbc`, `fbp` |
| Google | `gclid`, `gbraid`, `wbraid` | `gclid`, `gbraid`, `wbraid` |
| TikTok | `ttclid` | `ttclid` |
| LinkedIn | `li_fat_id` | `linkedin_tracking_uuid` |
| Taboola | `tblci` | `taboola_click_id` |

Campos e IDs desconhecidos são obrigatoriamente recusados, nunca repassados por
fallback. Click IDs são identificadores pseudônimos de atribuição permitidos em
`pending`/`denied`, mesmo quando o egress de pixel no browser está bloqueado.

Google mapeia `pending` e `denied` para `ad_user_data=denied`,
`ad_personalization=denied`, `ad_storage=denied` e `analytics_storage=denied`.
`granted` mapeia os quatro sinais para `granted` na V1 de consentimento único.
Não usar `ads_data_redaction`, pois esta política permite IDs de atribuição.

## Matriz

| Estado | Persistência Studio/NVS | Dados adicionais | Egress externo |
|---|---|---|---|
| `pending` | Sempre, deduplicada e encaminhada ao NVS | IDs pseudônimos allowlisted; sem PII/hash | Adaptadores habilitados recebem o payload mínimo |
| `denied` | Sempre, deduplicada e encaminhada ao NVS | IDs pseudônimos allowlisted; sem PII/hash | Adaptadores habilitados recebem o payload mínimo |
| `granted` | Sempre, deduplicada e encaminhada ao NVS | Hashes normalizados server-side | Adaptadores habilitados recebem o payload conforme allowlist |

## Testes obrigatórios

1. Os três estados persistem e deduplicam pelo `tracking_event_id`.
2. Estado/hash forjado no browser é recusado ou ignorado; o gateway usa apenas o manifesto server-side.
3. `pending`/`denied` recusam PII direta, hashes, IP, user-agent, dados aninhados e arrays.
4. Cada adaptador aceita somente sua allowlist e recusa campos desconhecidos.
5. `granted` gera hashes normalizados somente no servidor.
6. Mudança de `policyVersion`, projeto, domínio, ambiente, snapshot ou publicação invalida a chave e não reutiliza aceite antigo.
7. Revogação afeta apenas eventos futuros; nenhum evento histórico é enriquecido.
8. Dois tenants e preview/production permanecem isolados; somente flags técnicas ou providers desabilitados bloqueiam egress.
9. Google recebe o mapeamento dos quatro sinais por estado, sem ads data redaction.
10. UI explica IDs pseudônimos e processamento limitado sem autorização de PII direta.
11. Teste parametrizado de Meta, Google, TikTok, LinkedIn e Taboola nos estados `pending`, `denied` e `granted` comprova uma chamada por adaptador/estado, preserva `tracking_event_id`, mantém pending/denied sem PII/hash e só elimina egress quando a flag técnica ou o provider está desligado.

Preservar HMAC, nonce, replay, CSP, isolamento, deduplicação e ausência de IP/UA.
