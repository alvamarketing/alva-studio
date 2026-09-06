# Runtime Docker/Coolify

Somente `studio-web` publica `127.0.0.1:4178`; bancos, Umami e NVS não
expõem portas. O Compose usa sua rede padrão, preservando o egress necessário
para o Studio e workers. Em Coolify, configure o proxy somente para
`studio-web` e não crie rotas públicas para bancos ou painéis dos motores.

## Variáveis

Copie `runtime/.env.example` para um cofre/variáveis do ambiente e substitua
cada marcador por um valor hexadecimal aleatório. Não versione esse arquivo e
não passe segredo por argumentos. `STUDIO_DATABASE_URL` usa a mesma senha de
`STUDIO_POSTGRES_PASSWORD` e aponta para `studio-postgres`. Defina
`PUBLIC_ORIGIN` com a URL HTTPS final do Coolify. A composição exige esse
valor; forneça uma origem HTTPS explícita também em desenvolvimento e testes.

As flags comerciais ficam literalmente em `false`: esta entrega não provisiona
Umami, não envia eventos e não habilita pipeline de mídia. O NVS incorpora o
Core 0.3.10 e aplica seu schema mais as migrações Alva antes de responder como
pronto. As únicas APIs de controle são `/internal/v1/properties`,
`/internal/v1/events` e `/internal/v1/status`; todas exigem HMAC SHA-256 sobre
`timestamp + "\n" + nonce + "\n" + corpo`, janela de cinco minutos e nonce
persistido. O gateway não expõe segredos. Cada evento entra em uma outbox
transacional por propriedade, evento e destino; o envio externo permanece
desligado por `NVS_OUTBOX_DELIVERY_ENABLED=false` até o provisionamento
explícito de uma propriedade. O
`studio-worker` executa a fila de webhooks fora do processo web. O
`studio-media-worker` só registra heartbeat e conectividade PostgreSQL até a
tarefa de mídia.

O Umami cria ou atualiza a conta técnica indicada por `UMAMI_USERNAME` e
`UMAMI_PASSWORD` com a role mínima `user`, diretamente no banco, depois das
migrações e antes de abrir o servidor. Essa role cria e consulta somente os
websites que possui, como confirma o teste de contrato. O bootstrap usa hash
bcrypt no PostgreSQL e remove apenas o usuário seed conhecido da imagem pinada;
ele não autentica com credenciais padrão nem depende de cadastro manual. O
bootstrap entrega a senha ao cliente PostgreSQL somente por ambiente do
processo filho, sem colocá-la em argumentos. A
imagem instala o cliente PostgreSQL `postgresql18-client=18.6-r0` sobre a base
Alpine já pinada, deixando a ferramenta de bootstrap reproduzível.
`TRACKING_MASTER_KEY` é exclusiva do control plane
e precisa estar disponível tanto no `studio-web` para o gate de publicação
quanto no worker de provisionamento. As flags `UMAMI_RUNTIME_ENABLED`,
`NVS_RUNTIME_ENABLED` e `TRACKING_PROVISION_ENABLED` exigem valor literal
`true` e continuam desligadas até aceite operacional.

## Cobrança Asaas V1

O runtime inicia em `ASAAS_ENVIRONMENT=sandbox`. Guarde
`ASAAS_SANDBOX_API_KEY` e `ASAAS_SANDBOX_WEBHOOK_TOKEN` separadamente de
`ASAAS_PRODUCTION_API_KEY` e `ASAAS_PRODUCTION_WEBHOOK_TOKEN`; os valores
nunca devem aparecer em comando, log ou arquivo versionado. Não ative produção
até homologar o sandbox e promover o plano de produção de `draft`.

O proxy HTTPS entrega `POST /api/billing/webhook/asaas` ao `studio-web`.
Essa rota só autentica o token em tempo constante e coloca o evento sanitizado
na inbox, rejeitando corpo acima de 64 KB. `studio-billing-worker` reconsulta
o Asaas e só então atualiza pagamento, assinatura e entitlement. O worker usa
a chave do ambiente declarado; não compartilhe uma chave entre os dois
ambientes. Um evento em revisão requer inspeção do pedido e da resposta do
provedor no banco, sem tentar liberar entitlement manualmente.

## Subir e verificar

O `studio-web` aplica as migrações antes de abrir a porta. Consulte
`/health/live` para processo vivo e `/health/ready` para processo com
PostgreSQL acessível. Um 503 de readiness não expõe detalhes da conexão.

```sh
docker compose --env-file /caminho/runtime.env -p alva-runtime-teste -f runtime/compose.yaml up -d --build
curl --fail http://127.0.0.1:4178/health/live
curl --fail http://127.0.0.1:4178/health/ready
```

Use nome de projeto isolado para não tocar serviços existentes. Confira os nove
health checks antes de usar o runtime. Umami valida `/api/heartbeat` com status
200; a prontidão NVS consulta o MariaDB e só aprova JSON com `status: ready`.

O contrato da imagem Umami 3.3.1 pode ser reproduzido sem segredos reais:

```sh
runtime/umami-contract-test.sh
```

Ele usa containers e volumes descartáveis, autentica a conta técnica, confirma
que `POST /api/websites` aceita o UUID estável do binding e que `GET` devolve
os mesmos campos. A imagem pinada responde `500` ao POST duplicado; o cliente
trata esse conflito por leitura e reconciliação do website existente.

## Backup, restauração e prova de persistência

O backup exporta os três bancos em SQL e gera `SHA256SUMS`; ele falha se o
diretório de destino já existir. A restauração exige confirmação literal e
valida todos os hashes antes de escrever. Os scripts aceitam `--env-file` e
`--project-name` para operar a mesma composição isolada.

```sh
runtime/backup.sh --env-file /caminho/runtime.env --project-name alva-runtime-teste --output-dir /caminho/novo/backup-AAAA-MM-DD
runtime/restore.sh --env-file /caminho/runtime.env --project-name alva-runtime-teste --input-dir /caminho/novo/backup-AAAA-MM-DD --confirm-restore
```

Para homologar persistência, crie uma linha descartável em cada banco, reinicie
somente os três serviços de banco e confira as linhas. Depois faça backup,
altere as linhas, restaure e confira os valores originais. Os volumes nomeados
`studio-postgres-data`, `umami-postgres-data` e `nvs-mariadb-data` não devem
ser removidos durante esse procedimento.

A restauração não é atômica entre os três bancos. O script confirma hashes e a
saúde dos três serviços, interrompe antes da primeira escrita somente os
writers que já estavam ativos (`studio-web`, workers, `umami`, `nvs` e a fila
NVS) e os religa por trap mesmo em falha. Uma falha durante a aplicação ainda
exige restaurar novamente o mesmo backup nos três bancos. Antes de restaurar,
gere um backup novo do estado atual para recuperação. O dump MariaDB usa
somente o banco e usuário `nvs`, sem bancos de sistema nem a conta root.

O restore captura quais writers estavam em execução e religa somente esses
serviços. Assim, o ensaio dos bancos não inicia web, workers ou motores que não
estavam ativos. O ensaio local reproduzível usa somente valores fictícios,
projeto Docker único e imagens já disponíveis, sem pull:

```sh
runtime/backup-restore-local-test.sh
```

Ele sobe apenas `studio-postgres`, `umami-postgres` e `nvs-mariadb`, cria uma
probe distinta em cada banco, executa `backup.sh`, altera as probes e executa
`restore.sh --confirm-restore`. O runner valida `SHA256SUMS`, os três valores
originais e que nenhum writer foi criado; o cleanup remove containers, volumes
e arquivos temporários desse projeto isolado.

## Certificação local da V1

A matriz local é descartável e não usa produção, DNS, Vercel, Asaas, segredos
reais nem egress. Execute somente no checkout de desenvolvimento:

```sh
node --test packages/studio/test/commercial-certification.test.mjs
```

Ela cria dois tenants em um PostgreSQL efêmero e percorre criação, provisão de
tracking com clientes falsos, publicação falsa, visita, lead, conversão,
cobrança falsa e MCP. Também confirma isolamento entre tenants, flags
comerciais desligadas por padrão e que uma falha de publicação preserva a
última publicação pronta. O teste faz backup, mutação e restauração reais de
uma tabela descartável nesse PostgreSQL por `pg_dump` e `psql`.

Cada tenant possui página, quiz, prévia, submissão e checkout próprios. A
matriz tenta cruzar publicação, rota pública, outbox, cobrança e MCP e exige
que os recursos do outro tenant não sejam lidos nem operados. Depois das
submissões com consentimento `pending` e `denied`, ela lê o `payload` real em
`nvs_commercial_outbox`: preserva `tracking_event_id` e `fbc`, mas não permite
nome, e-mail, telefone, respostas, hashes nem chaves equivalentes, inclusive
em objetos aninhados.

O inventário de segredos da matriz fica em
`runtime/commercial-local-certification.mjs`; ele contém somente nomes,
localizações e finalidades. Valores nunca entram em documentação, testes ou
logs.

Esta é uma evidência local, não a certificação comercial final. A restauração
coordenada dos três bancos por `backup.sh` e `restore.sh` foi exercitada no
Compose descartável. Vercel de staging, Asaas Sandbox e revisão visual
independente continuam pendentes. A VSL própria pertence à V2 e não integra os
critérios da V1.
