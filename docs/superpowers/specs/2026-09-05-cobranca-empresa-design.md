# Cobrança empresarial do Alva Studio — desenho do nó `cobranca_empresa`

## Objetivo

Disponibilizar uma única assinatura recorrente do Alva Studio por empresa, com Checkout hospedado do Asaas que coleta os dados cadastrais no próprio provedor, confirmação exclusiva por inbox de webhook e worker reconsultado, e limites efetivos aplicados no servidor quando o enforcement estiver habilitado. A compra é feita pelo Proprietário da empresa; usuários, memberships e projetos nunca são unidades de cobrança.

O nó entrega o que o grafo exige: checkout hospedado, webhook idempotente e um plano comercial por empresa. Ele não ativa produção, não realiza compra real, não altera a conta Asaas e não acrescenta créditos, pacotes avulsos, add-ons, trial, cupom, nota fiscal ou cobrança por uso.

A dependência `tracking_coletor` já está `feito` e certificada em `.estado/tracking_coletor.md`; esta especificação não reabre seu escopo.

## Contexto que o desenho preserva

O Studio já é multiempresa: `companies` é a fronteira de tenant, `company_memberships` atribui papéis a usuários e `projects` pertencem à empresa. Uma sessão já carrega a empresa atual e o servidor deriva dela todo o escopo; recursos de outra empresa respondem 404. A capacidade `billing.manage` já existe somente para `owner` em `server/domain/access.mjs` e no espelho do cliente.

Isso fixa quatro regras:

1. Uma empresa pode ter uma assinatura ativa; um usuário pode administrar a cobrança de cada empresa da qual é proprietário, sem que uma delas dê acesso financeiro a outra.
2. A assinatura concede acesso à empresa inteira, incluindo seus membros e projetos autorizados. Não existe plano por usuário nem por projeto.
3. O navegador solicita uma ação de cobrança, mas nunca escolhe valor, moeda, limite, empresa, estado financeiro ou entitlement.
4. Páginas e formulários já publicados continuam públicos quando a empresa fica sem acesso. O produto não despublica, remove domínio ou apaga conteúdo por inadimplência neste primeiro corte.

## Oferta inicial

O catálogo inicial possui exatamente um item: **Alva Studio Essencial**, recorrência mensal em BRL, sem períodos promocionais e sem componentes opcionais. Seus entitlements são congelados no contrato no momento da primeira cobrança confirmada:

| Entitlement | Limite Essencial |
|---|---:|
| Projetos ativos | 5 |
| Membros ativos | 10 |
| Domínios publicados | 5 |

`plan_code = "studio-essential-v1"`, `interval = "monthly"` e os três limites são valores do catálogo no servidor. A composição também guarda `price_cents`, `currency = "BRL"` e nome comercial no pedido e na assinatura. O preço não foi aprovado no material de origem deste repositório; por isso o plano nasce `draft` e nenhuma chamada ao Asaas é permitida enquanto o catálogo estiver draft, tiver preço fictício ou a ativação daquele ambiente estiver inválida. Fixtures usam valores de teste somente contra cliente simulado, nunca em egress.

Para habilitar egress em Sandbox, o operador precisa configurar plano `active`, preço real de homologação em centavos e `BILLING_ENFORCEMENT=sandbox`. Para habilitar produção, além disso precisa registrar no banco `approved_by_user_id`, `approved_at`, plano, preço e data do checklist de ativação. A ausência de qualquer um desses campos recusa checkout **antes** de criar customer, checkout ou assinatura. Essa é uma trava comercial, não um segundo plano.

Armazenamento, eventos de analytics e demais recursos não entram como limite comercial neste nó. Não devem ser apresentados como ilimitados, limitados ou cobrados até haver política própria.

## Estados e acesso efetivo

`subscriptions.status` é restrito a `pending_checkout`, `active`, `past_due`, `cancel_at_period_end`, `canceled` e `suspended`. O estado é informação do contrato; o acesso é calculado na tabela separada `entitlements` para que as rotas não precisem inferir regras financeiras. `grace_until` pertence ao contrato e só é criado para atraso: o padrão automático de sete dias vale apenas no Sandbox; produção exige `grace_days`, aprovador e data registrados na ativação antes que qualquer grace seja concedido.

| Estado da assinatura | Acesso da empresa | Transição que o confirma |
|---|---|---|
| `pending_checkout` | `read_only` | pedido criado, antes de pagamento confirmado |
| `active` | `active` | pagamento confirmado e reconsultado no Asaas |
| `cancel_at_period_end` | `active` até `current_period_end` | cancelamento solicitado pelo proprietário |
| `past_due` | `active` até `grace_until`, depois `read_only` | Asaas informa cobrança vencida ou período terminou sem confirmação |
| `canceled` | `read_only` | cancelamento efetivado ou período pago encerrado |
| `suspended` | `read_only` | suspensão administrativa futura, registrada explicitamente |

`BILLING_ENFORCEMENT` aceita somente `off`, `sandbox` ou `production` e fica **off por padrão**. Nesse estado, toda empresa existente recebe entitlement sintético `active`, com limites não aplicados, e continua operando exatamente como hoje. Um processo em `sandbox` só pode egressar e aplicar entitlement Sandbox; um processo em `production` só pode fazê-lo para produção depois de ativação completa. Só quando a configuração privada daquele ambiente é válida e o enforcement é ligado é que `active` e `read_only` passam a reger as rotas. `read_only` permite login, seleção de empresa, leitura e exportação já autorizadas, visualização de cobrança e ações de renovar/cancelar pelo Proprietário. Qualquer `POST`, `PUT`, `PATCH` ou `DELETE` que crie ou altere conteúdo, equipe, projeto, integração ou publicação recebe 402 com o código `billing_access_required`; o servidor mantém essa barreira mesmo que a interface esteja desatualizada. `POST /api/billing/checkout`, `POST /api/billing/cancel` e logout são as únicas mutações permitidas nesse estado. Rotas públicas não consultam entitlement.

Ao reduzir limite em uma futura versão de plano, o Studio não arquiva objetos automaticamente. O limite passa a impedir somente a próxima criação; a interface informa o uso atual. A primeira versão não oferece downgrade.

## Dados persistidos

Uma nova migração aditiva cria as seguintes tabelas, todas no PostgreSQL transacional já usado pelo Studio. Nenhuma migração existente é alterada.

### `plans`

Catálogo versionado, gerido apenas no servidor: `id`, `code` único, `name`, `currency`, `price_cents`, `interval`, `project_limit`, `member_limit`, `published_domain_limit`, `status` (`draft` ou `active`), `created_at` e `retired_at`. `price_cents` é inteiro positivo no banco; o adaptador só o converte a uma string decimal exata (`9900` → `"99.00"`) na chamada Asaas, nunca por ponto flutuante. Só há um código semeado nesta fase; `draft` impede todo egress.

### `billing_accounts`

Vínculo 1:1 entre `company_id` e o cliente do provedor, por ambiente: `id`, `company_id`, `provider = 'asaas'`, `provider_customer_id`, `environment` (`sandbox` ou `production`), datas. A linha só nasce ou ganha `provider_customer_id` depois da primeira cobrança reconsultada e confirmada. Há `UNIQUE (company_id, environment)` e `UNIQUE (environment, provider_customer_id)`. Dados pessoais do cliente não são duplicados aqui; o identificador externo é suficiente para reconciliação.

### `payment_orders`

Pedido criado antes da chamada remota: `id` UUID, `company_id`, `requested_by_user_id`, `plan_id`, cópia congelada de `plan_code`, `plan_name`, `amount_cents`, `currency`, `interval`, `limits jsonb`, `environment`, `external_reference`, `status` (`creating`, `submitting`, `pending`, `paid`, `failed`, `cancelled`), `provider_checkout_id`, `checkout_url`, `created_at`, `updated_at` e `expires_at`. `external_reference` é sempre `alva-studio:<environment>:<order_uuid>`, calculada e persistida com o pedido antes de egress, e nunca deriva de dado do browser. Ela é imutável e `UNIQUE (environment, external_reference)`, para separar tentativas e históricos de ciclos distintos da mesma empresa.

Um índice parcial impõe um pedido aberto (`creating`, `submitting` ou `pending`) por empresa e ambiente. `submitting` não expira por relógio: ele representa uma chamada cujo resultado pode ter chegado ao Asaas e cuja resposta foi perdida. A criação e cada transição de pedido enfileiram reconciliação durável; o servidor jamais cria uma segunda assinatura automaticamente.

### `subscriptions`

Contrato por empresa: `id`, `company_id`, `plan_id`, cópias congeladas do plano e limites, `provider_subscription_id`, `environment`, `status`, `current_period_start`, `current_period_end`, `grace_until`, `cancel_at_period_end`, `canceled_at`, `last_payment_id`, `created_at`, `updated_at`. `provider_subscription_id` só é persistido após a primeira cobrança reconsultada com `externalReference` do pedido coincidente. `UNIQUE (environment, provider_subscription_id)` evita colisão entre ambientes. Um índice parcial impede duas assinaturas simultâneas em `pending_checkout`, `active`, `past_due` ou `cancel_at_period_end` para a mesma empresa e ambiente.

### `payments`, inbox e reconciliação

`payments` registra uma cobrança reconsultada: `id`, `company_id`, `subscription_id`, `order_id`, `provider`, `provider_payment_id`, `provider_status`, `amount_cents`, `currency`, `paid_at`, `due_date`, `environment`, `created_at`, com `UNIQUE (environment, provider_payment_id)`. Esse é o único identificador que produz efeito financeiro.

`billing_webhook_inbox` é a entrada autenticada e durável: `environment`, `provider_event_id`, `event_type`, `provider_payment_id`, `payload_sha256`, `received_at`, `status`, `attempt_count`, `processed_at`, `error_code`. Tem `UNIQUE (environment, provider_event_id)` e não guarda corpo bruto. `billing_reconciliation_jobs` tem `environment`, alvo (`order`, `inbox_event`, `subscription` ou `orphaned_event`), referências internas, `status`, tentativa, `next_attempt_at`, lease e erro sanitizado. Pedidos `submitting`/`pending`, renovações, eventos da inbox e eventos sem pedido local entram nessa fila; ela usa a mesma disciplina de lease, backoff e dead-letter do worker de webhook já existente.

`entitlements` tem uma linha por empresa e ambiente: `company_id`, `environment`, `subscription_id`, `access_state` (`active` ou `read_only`), `plan_code`, `limits jsonb`, `effective_until`, `updated_at`. Empresa sem linha recebe `read_only` quando enforcement está ligado e `active` quando está desligado. O valor persistido é uma projeção materializada do contrato confirmado e é atualizado na mesma transação que a confirmação financeira.

`billing_activation` guarda a trava por ambiente: `environment`, `enforcement_enabled`, `plan_code`, `approved_price_cents`, `approved_by_user_id`, `approved_at`, `checklist_completed_at`, `grace_days` e `updated_at`. Sandbox usa grace padrão de sete dias quando habilitado; produção exige todos os campos de aprovação e `grace_days` explícito. Essa linha é consultada antes de qualquer egress e antes de aplicar enforcement.

Todas as FKs que relacionam projeto ou empresa preservam o padrão de escopo do Studio. Valores monetários são inteiros em centavos, positivos, e a moeda é `BRL`. Nenhuma tabela financeira aceita `company_id` recebido do navegador.

## Checkout e cancelamento

O proprietário abre **Configurações → Empresa e equipe**, a seção literal `Empresa e equipe` do wireframe, e vê o cartão do plano. A interface obtém `GET /api/billing` para mostrar plano, limites de projetos/membros/domínios, estado de acesso, fim do período e estado do último pedido. Administrador, editor e analista veem o estado e a mensagem de que somente o Proprietário administra cobrança; não recebem botões que alterem contrato.

`POST /api/billing/checkout` não recebe preço, plano, empresa, customer id ou subscription id. Ele usa a empresa da sessão, exige `billing.manage`, valida `billing_activation`, lê o único plano ativo do catálogo e, dentro de uma transação, bloqueia a empresa e cria/reutiliza o pedido. A sequência é:

1. recusar se houver assinatura ainda válida ou pedido `submitting`;
2. recusar antes de egress se o plano for draft, o preço não for igual ao aprovado, a ativação não trouxer autor/data/checklist exigidos ou o enforcement do ambiente não estiver válido;
3. inserir pedido congelado em `creating`;
4. reivindicar `creating → submitting` condicionalmente;
5. no primeiro ciclo, criar o Checkout hospedado mensal com `externalReference = alva-studio:<environment>:<order_uuid>` e **omitir** `customer` e `customerData`; o Asaas coleta e valida CPF/CNPJ no checkout, sem o Studio receber esses dados. Em ciclo posterior, só pode referenciar o `provider_customer_id` já reconciliado e continua sem `customerData`;
6. validar a URL devolvida contra HTTPS e os hostnames oficiais do Asaas do ambiente;
7. persistir somente checkout e mover para `pending` antes de devolver a URL; customer e subscription não são vinculados pela resposta de criação;
8. enfileirar reconciliação do pedido antes de devolver a URL.

Se a rede falhar após a chamada, o pedido fica `submitting` e a fila o reconcilia pelo `externalReference` daquele pedido. Nova tentativa não chama o provedor. Depois de cancelamento ou expiração, um novo pedido recebe novo UUID e nova referência, permitindo segundo ciclo sem cruzar o histórico do anterior. O retorno do browser apenas atualiza a tela por uma janela curta; não concede acesso nem altera o banco financeiro.

`POST /api/billing/cancel` também usa a empresa da sessão e exige `billing.manage`. Ele localiza a assinatura ativa daquela empresa e faz `UPDATE` no Asaas com `endDate = current_period_end`; nunca usa `DELETE` automático. Grava `cancel_at_period_end` idempotentemente, não aceita identificador externo do browser, não remove conteúdo e não corta o período já pago. Cobranças futuras já geradas depois de `endDate` não são canceladas, estornadas ou convertidas em acesso automaticamente: vão para revisão. `SUBSCRIPTION_DELETED` marca o contrato local como `canceled`; se chegar antes do período registrado, também gera revisão em vez de encurtar acesso silenciosamente.

## Webhook confiável e idempotente

As rotas públicas fixas são `POST /api/billing/webhooks/asaas/sandbox` e `POST /api/billing/webhooks/asaas/production`. Cada uma seleciona token, API base URL e ambiente privados próprios; ambiente no corpo nunca é lido. O handler:

1. limita o corpo e aceita somente `POST` JSON;
2. compara o token de webhook em tempo constante e responde 401 antes de ler banco ou chamar o provedor;
3. extrai somente `provider_event_id`, tipo e payment id e grava/reconhece a inbox por sua chave única;
4. enfileira a reconciliação e responde 200 rapidamente, inclusive em reentrega do mesmo `provider_event_id`;
5. o worker reconsulta a cobrança na API Asaas da rota e, na primeira cobrança, exige `externalReference` exatamente igual ao pedido antes de vincular customer e subscription. Em renovação, exige customer e subscription iguais aos vínculos persistidos; divergência vai para revisão sem efeito financeiro;
6. o worker confere id, referência, valor decimal e ambiente, abre uma única transação, bloqueia pedido/assinatura/entitlement e insere o pagamento por `provider_payment_id` único;
7. em `RECEIVED` ou `CONFIRMED`, atualiza a assinatura, grace e entitlement e marca o pedido pago; reentrega do mesmo pagamento não produz segundo efeito;
8. em atraso, cancelamento, reembolso, chargeback, `SUBSCRIPTION_DELETED` inesperado ou evento órfão, atualiza somente o estado suportado e mantém job com revisão/backoff. Reembolso e chargeback não desfazem conteúdo nem pagamento em silêncio;
9. depois do máximo de tentativas, o job fica dead-letter para revisão, sem apagar inbox ou pagamento.

O identificador de pagamento, não o evento, é a chave final de idempotência. Dois eventos para o mesmo pagamento e duas requisições concorrentes não podem produzir duas linhas em `payments`, dois entitlements ou dois períodos. Na primeira confirmação, o worker só grava `provider_customer_id` e `provider_subscription_id` após conferir o `externalReference` do pedido. Renovação mensal usa novo `provider_payment_id`, exige os dois vínculos persistidos e atualiza `current_period_end` somente se a nova data for maior.

## Segredos, ambientes e auditoria

Chave da API Asaas, token do webhook e origem pública ficam exclusivamente no runtime do servidor, com credenciais separadas para Sandbox e produção. Nunca usam prefixo de variável exposta ao navegador, não entram em migração, fixture, resposta HTTP, URL, logs ou inbox. A implementação deverá integrar a fonte de segredos então vigente; não deve reutilizar `VERCEL_MASTER_KEY` como segredo Asaas.

O ambiente é passado de configuração privada ao adaptador e fica em todas as consultas financeiras. Sandbox e produção não compartilham customer, pedido, checkout, assinatura, pagamento, evento ou entitlement. A confirmação Sandbox é homologação: não liga o catálogo de produção e não movimenta dinheiro.

Criação de checkout, solicitação de cancelamento, confirmação de pagamento e bloqueio por cobrança geram `audit_events` da empresa com IDs internos e resultado, sem token, URL de checkout completa, cabeçalho ou dados pessoais do payload.

## Critérios de aceite

- Uma empresa só tem uma assinatura e um pedido aberto por ambiente; outra empresa e outro usuário nunca a leem, cancelam ou reutilizam.
- `externalReference` é imutável por pedido (`alva-studio:<environment>:<order_uuid>`), permitindo ciclo posterior da mesma empresa sem cruzar histórico. Primeiro Checkout omite `customer` e `customerData`; customer/subscription só são vinculados após cobrança reconsultada cuja referência coincide com o pedido.
- O navegador não consegue alterar preço, plano, limites, empresa, customer, subscription, ambiente ou estado de acesso.
- O retorno do checkout não concede acesso; somente `RECEIVED`/`CONFIRMED` reconsultado concede `active`.
- Mesmo pagamento entregue duas vezes, inclusive concorrentemente, cria um pagamento e atualiza entitlement uma vez.
- Renovação com novo pagamento preserva o contrato congelado e não reduz um fim de período posterior.
- URL de checkout não HTTPS ou fora dos hostnames permitidos é recusada; token ausente ou incorreto recebe 401; cada rota de webhook só aceita seu ambiente privado.
- Inbox deduplica `provider_event_id` e responde 200 rápido; worker reconsulta, faz retry de `submitting`, `pending`, renovação e órfãos; renovação com customer/subscription divergente vai para revisão; `provider_payment_id` continua a única chave de efeito financeiro.
- Enforcement desligado mantém todos os tenants atuais em acesso pleno. Ligá-lo exige configuração válida; `read_only` bloqueia toda mutação do produto fora das duas ações de billing e mantém leitura autorizada; conteúdo público existente permanece disponível.
- Limite de domínio conta somente `project_domains` com `environment = 'production'` e `verification_status = 'verified'`.
- Sandbox permanece isolado, e a certificação do nó registra uma assinatura Sandbox confirmada, webhook idempotente e a contagem de testes verdes exigida por `produto/grafo.yaml`.

## Riscos e fronteiras assumidas

O preço comercial ainda precisa de aprovação antes de ativação pública; não se deve ocultar essa ausência em código. A definição de estorno, chargeback, período de tolerância e suspensão administrativa também precisa de política do proprietário antes de automação com efeito financeiro. Até lá, reembolso/chargeback viram revisão, e não reversão automática.

O primeiro corte cria o adaptador Asaas e sua homologação Sandbox, mas não configura webhook, credenciais ou checkout na conta real. A etapa que fizer isso exige confirmação explícita porque afeta cobrança externa.
