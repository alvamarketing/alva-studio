# Alva Tracking: auditoria do NVS e desenho da absorção

Data: 2026-09-26
Estado: auditoria concluída, desenho proposto

## O que o tracking faz, em uma frase

Conta às plataformas de anúncio o que aconteceu no site, **pelo servidor em vez do
navegador**, para que a campanha otimize em cima de conversões que o navegador sozinho
perderia.

O pixel no navegador perde uma fatia grande dos eventos — bloqueador de anúncio, ITP do
Safari, fim do cookie de terceiros. O servidor não é bloqueado. O mesmo evento vai pelos
dois caminhos com o **mesmo identificador**, e a plataforma conta uma vez só.

Isso é diferente do Alva Analytics, e um não substitui o outro:

| | Alva Analytics | Alva Tracking |
|---|---|---|
| para quem | para você decidir | para o algoritmo do Meta aprender |
| pergunta | quantos entraram, onde saíram | quem converteu, de qual anúncio |
| destino | a tela do Studio | Graph API, Events API |

O que os dois compartilham é a **origem do dado**: o mesmo visitante, o mesmo evento. É
daí que sai a economia desta absorção.

## Auditoria: o que existe hoje

### O Core PHP é código morto

O submódulo `nvs-core` tem **12.248 linhas** e **nenhuma é executada** pelo Studio.

O gateway em `runtime/nvs/public/router.php` tem quatro rotas — `/health/live`,
`/health/ready`, `/internal/v1/*` e `/ingest.php` — e todas resolvem em classes `Alva*`
carregadas de `alva/bootstrap.php`. Nenhum `require` alcança o vendor. O `nvs.js`
servido publicamente é o wrapper de **17 linhas** em `public/lib/`, não o script de 798
linhas do Core.

O nome engana: `CoreMetaAdapter` não usa o Core. Ele monta o payload da Conversions API
sozinho, em 22 linhas, e posta em `graph.facebook.com/v20.0/{pixel}/events`. O
`MetaClient.php` do Core, com 562 linhas, faz a mesma coisa e nunca é chamado.

### O que está vivo: 478 linhas

| arquivo | linhas | função |
|---|---|---|
| `alva/bootstrap.php` | 182 | PDO, cifra AES-GCM dos segredos, HMAC do canal interno, migrações, laço do outbox |
| `alva/destinations/` | 222 | seis adaptadores: Meta, TikTok, Google, LinkedIn, Taboola, mais contrato e registro |
| `public/router.php` | 33 | as quatro rotas |
| `alva/migrations/` | 16 | cinco tabelas MariaDB |
| `public/lib/nvs.js` | 17 | wrapper do navegador |
| `alva/bin/outbox-worker.php` | 8 | laço do worker |

**Veredito: descartável o Core inteiro. Aproveitável a camada Alva, que é pequena.**

### O que o Studio já tem

- `nvs_commercial_outbox` — fila com unicidade por `(company, project, property, tracking_event_id, event_name, destination)`
- `NvsCommercialOutboxRepository` — enfileiramento com `ON CONFLICT DO NOTHING`
- `commercial-events-worker.mjs` — o laço de entrega
- `tracking_bindings`, `tracking_destinations` — provisionamento e destinos cifrados
- o coletor próprio, que desde 2026-09-25 enfileira eventos de VSL no outbox

A fila, a cifra, a unicidade e o worker **já existem em Node**. O que falta é o envio HTTP
aos destinos, que hoje mora nos seis adaptadores PHP.

## O problema dos disparos inflados

Caso real relatado pelo dono: num cliente, o pixel do navegador registrou **15** leads e o
servidor **23.000**. Isso não é falha de deduplicação — é ordem de grandeza demais para
ser evento repetido. É o servidor disparando onde não devia.

A regra oficial da Meta, verificada na documentação da Conversions API:

> Se encontrarmos a mesma combinação de chaves de servidor (`event_id` e `event_name`) e
> combinação de chaves de navegador (`eventID` e `event`) enviadas ao mesmo Pixel ID em
> **48 horas**, descartaremos os eventos subsequentes.

Ou seja: a Meta só deduplica o que chega com **o mesmo `event_id`**. Se o servidor gera um
identificador novo a cada disparo, a Meta vê 23.000 eventos distintos e conta todos —
exatamente o buraco sem fundo descrito.

Daí as três travas que o desenho precisa ter, e só a primeira depende da Meta:

1. **O `event_id` nasce uma vez, no navegador**, viaja com o evento e é reusado pelo
   servidor. Retentativa reusa o mesmo — nunca gera outro.
2. **Unicidade na fila**, por `(propriedade, event_id, destino)`. O Studio já tem.
3. **O disparo é declarado, não inferido.** Um evento comercial sai porque alguém marcou
   aquele botão como conversão, não porque houve um pageview.

A terceira é a que faltava no modelo antigo e é o que o dono pediu: o envio precisa ser uma
escolha explícita de quem monta a página.

## O desenho proposto

### Pixels no projeto, não na página

Cada projeto é um cliente. Em Configurações do projeto entram as credenciais de cada
destino — Meta, Google, TikTok, Taboola, LinkedIn — uma vez. A página publicada já sai
marcada, sem Tag Manager, sem a pessoa colar script.

### O que enviar, escolhido no editor

- **Pageview** é automático em toda página publicada.
- **Os demais são declarados no elemento.** Ao selecionar um botão, o inspetor mostra
  "enviar conversão" e qual: lead, compra, início de checkout.
- **Marcos de vídeo** (25%, 50%, 75%, conclusão) são uma opção da própria VSL.

Isso também resolve a dúvida de "métrica primária ou secundária": quem monta escolhe o
evento, e o Studio manda o mesmo evento para todos os destinos configurados.

### A absorção

Os seis adaptadores viram módulos Node, no mesmo contrato do que já existe. O que **não**
se traz: `nvs.js` do Core, `ingest.php`, `BrowserRepository`, `EventRepository`, os
dashboards (`dashboard-data`, `journey`, `server-metrics`, `core-status`), o `setup.php` e
os tradutores de gateway.

Sobre os gateways de pagamento: o `NvspayTranslator` é do gateway próprio do autor do NVS
e não interessa. Hotmart e Kiwify têm tradutor lá, e o dono quer também **Hubla**. Esses
entram como webhooks do Studio — um trabalho separado da absorção do envio.

### SDK oficial ou HTTP direto

O SDK Node da Meta (`facebook-nodejs-business-sdk`) existe, mas é grande e cobre a API de
marketing inteira. Para postar um evento numa rota, os 22 linhas do adaptador atual fazem o
mesmo com menos dependência e mais controle sobre retentativa. **Recomendação: HTTP direto,
como já é hoje**, com a versão da API fixada e um teste por destino.

## O que sobra de ganho

Sai o submódulo `nvs-core` inteiro, o gateway PHP, o worker PHP e o MariaDB. O Studio cai
para **três containers definitivos**, e a linguagem passa a ser uma só.
