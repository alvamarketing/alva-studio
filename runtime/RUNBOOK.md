# Runtime Docker/Coolify

Somente `studio-web` publica `127.0.0.1:4178`; o banco não
expõe porta. O Compose usa sua rede padrão, preservando o egress necessário
para o Studio e workers. Em Coolify, configure o proxy somente para
`studio-web` e não crie rotas públicas para o banco.

## Na máquina

`runtime/subir-local.sh` sobe Studio, worker e Postgres, esperando todos ficarem
saudáveis; `--parar` derruba sem apagar dados. `--tunel` abre também um túnel
rápido da Cloudflare (`compose.tunel.yaml`, sem conta) e grava o endereço
`https://….trycloudflare.com` como `PUBLIC_ORIGIN`: é o que permite a uma página
publicada na internet mandar visita e lead para o Studio local. O endereço muda a
cada subida, e enquanto o túnel está de pé o domínio local deixa de autenticar. Na
primeira vez ele gera `runtime/.env` (fora do git) com segredos aleatórios e as
flags comerciais desligadas.

O Studio fica em `https://alva.orb.local`. Não há proxy no meio: o OrbStack dá ao
container o domínio e um certificado em que o Mac já confia, o que satisfaz a
exigência de `PUBLIC_ORIGIN` em HTTPS e de cookie de sessão `Secure` sem aviso no
navegador. O endereço aparece como link clicável no container `studio-web`.

A tela de primeiro acesso não cria a conta quando `PUBLIC_ORIGIN` está definido;
use o bootstrap dentro do container:

    printf '<senha>' | docker exec -i -e OWNER_NAME=… -e OWNER_EMAIL=… alva-studio-studio-web-1 node server/bootstrap-owner.mjs

## Variáveis

Copie `runtime/.env.example` para um cofre/variáveis do ambiente e substitua
cada marcador por um valor hexadecimal aleatório. Não versione esse arquivo e
não passe segredo por argumentos. `STUDIO_DATABASE_URL` usa a mesma senha de
`STUDIO_POSTGRES_PASSWORD` e aponta para `studio-postgres`. Defina
`PUBLIC_ORIGIN` com a URL HTTPS final do Coolify. A composição exige esse
valor; forneça uma origem HTTPS explícita também em desenvolvimento e testes.

As flags comerciais ficam literalmente em `false`: esta entrega não provisiona
eventos e não habilita pipeline de mídia. A entrega de conversões acontece
dentro do próprio Studio, sem gateway externo: cada evento entra na
`conversions_outbox`, uma linha por destino configurado (Meta, TikTok, Google,
LinkedIn ou Taboola), e o envio externo permanece desligado por
`CONVERSIONS_ENABLED=false` até o provisionamento explícito de um destino. O
`studio-worker` executa a fila de webhooks, o provisionamento de tracking, a
entrega de conversões e a reconsulta de cobrança fora do processo web, num
processo só (`--role=webhook,tracking,billing`). Eram quatro containers
rodando este mesmo arquivo, e o quarto — mídia — não tinha trabalho: só
migrava e batia heartbeat.

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
quanto no worker de provisionamento. As flags
`CONVERSIONS_ENABLED` e `TRACKING_PROVISION_ENABLED` exigem valor literal
`true` e continuam desligadas até aceite operacional.
`VERCEL_MASTER_KEY` é a chave mestra não vazia do cofre que cifra os tokens de
integração Vercel no Studio. Gere uma chave aleatória longa, guarde-a no cofre
do ambiente e mantenha o mesmo valor entre reinícios; ela não é o token da
Vercel e nunca entra no navegador, snapshots ou publicação.

## Cobrança Asaas V1

O runtime inicia em `ASAAS_ENVIRONMENT=sandbox`. Guarde
`ASAAS_SANDBOX_API_KEY` e `ASAAS_SANDBOX_WEBHOOK_TOKEN` separadamente de
`ASAAS_PRODUCTION_API_KEY` e `ASAAS_PRODUCTION_WEBHOOK_TOKEN`; os valores
nunca devem aparecer em comando, log ou arquivo versionado. Não ative produção
até homologar o sandbox e promover o plano de produção de `draft`.

O proxy HTTPS entrega `POST /api/billing/webhook/asaas` ao `studio-web`.
Essa rota só autentica o token em tempo constante e coloca o evento sanitizado
na inbox, rejeitando corpo acima de 64 KB. O `studio-worker`, no papel de cobrança, reconsulta
o Asaas e só então atualiza pagamento, assinatura e entitlement. O worker usa
a chave do ambiente declarado; não compartilhe uma chave entre os dois
ambientes. Um evento em revisão requer inspeção do pedido e da resposta do
provedor no banco, sem tentar liberar entitlement manualmente.

## Subir e verificar

### Ordem do primeiro staging

1. Prepare um arquivo de ambiente no cofre do staging a partir de
   `runtime/.env.example`, incluindo `VERCEL_MASTER_KEY` e os demais valores
   exigidos pelo Compose. Use uma chave aleatória longa para o cofre Vercel e
   preserve-a entre reinícios; não é o token da Vercel.
2. Suba a composição com `runtime/compose.yaml` e confirme `/health/live` e
   `/health/ready`. Mantenha `MEDIA_PIPELINE_ENABLED=false` e
   `ASAAS_ENVIRONMENT=sandbox`; não configure chaves de produção neste ensaio.
3. Crie a primeira conta pelo comando existente
   `pnpm --ignore-workspace bootstrap:owner`, fornecendo `DATABASE_URL`,
   `OWNER_NAME` e `OWNER_EMAIL` no ambiente do processo; a senha entra pelo
   stdin e nunca por argumento ou arquivo versionado.
4. Em seguida, habilite no staging de teste as flags de provisionamento e dos
   motores (`CONVERSIONS_ENABLED` e
   `TRACKING_PROVISION_ENABLED`), cadastre uma propriedade de teste e conecte
   a Vercel de teste no Studio. Use somente URLs HTTPS de staging e publique
   uma prévia.
5. Faça uma visita com UTM, envie um lead de teste e observe a chegada no
   Studio em Analytics e Rastreamento. Qualquer envio para Meta Test Events
   exige aceite operacional separado e explícito; não é consequência de ligar
   o staging.

O `studio-web` aplica as migrações antes de abrir a porta. Consulte
`/health/live` para processo vivo e `/health/ready` para processo com
PostgreSQL acessível. Um 503 de readiness não expõe detalhes da conexão.

```sh
docker compose --env-file /caminho/runtime.env -p alva-runtime-teste -f runtime/compose.yaml up -d --build
curl --fail http://127.0.0.1:4178/health/live
curl --fail http://127.0.0.1:4178/health/ready
```

Use nome de projeto isolado para não tocar serviços existentes. Confira os três
health checks antes de usar o runtime.


Ele usa containers e volumes descartáveis, autentica a conta técnica, confirma
que `POST /api/websites` aceita o UUID estável do binding e que `GET` devolve
os mesmos campos. A imagem pinada responde `500` ao POST duplicado; o cliente
trata esse conflito por leitura e reconciliação do website existente.

## Backup, restauração e prova de persistência

O backup exporta o banco `studio-postgres` em SQL e gera `SHA256SUMS`; ele
falha se o diretório de destino já existir. A restauração exige confirmação
literal e valida o hash antes de escrever. Os scripts aceitam `--env-file` e
`--project-name` para operar a mesma composição isolada.

```sh
runtime/backup.sh --env-file /caminho/runtime.env --project-name alva-runtime-teste --output-dir /caminho/novo/backup-AAAA-MM-DD
runtime/restore.sh --env-file /caminho/runtime.env --project-name alva-runtime-teste --input-dir /caminho/novo/backup-AAAA-MM-DD --confirm-restore
```

Para homologar persistência, crie uma linha descartável no banco, reinicie
somente o serviço `studio-postgres` e confira a linha. Depois faça backup,
altere a linha, restaure e confira o valor original. O volume nomeado
`studio-postgres-data` não deve ser removido durante esse procedimento.

Com um só banco, a restauração é atômica. O script confirma o hash e a saúde
do serviço, interrompe antes da primeira escrita somente os writers que já
estavam ativos (`studio-web` e `studio-worker`) e os religa por trap mesmo em
falha. Uma falha durante a aplicação ainda exige restaurar novamente o mesmo
backup. Antes de restaurar, gere um backup novo do estado atual para
recuperação.

O restore captura quais writers estavam em execução e religa somente esses
serviços. Assim, o ensaio do banco não inicia web nem workers que não estavam
ativos. O ensaio local reproduzível usa somente valores fictícios, projeto
Docker único e imagens já disponíveis, sem pull:

```sh
runtime/backup-restore-local-test.sh
```

Ele sobe apenas `studio-postgres`, cria uma probe, executa `backup.sh`, altera
a probe e executa `restore.sh --confirm-restore`. O runner valida
`SHA256SUMS`, o valor original e que nenhum writer foi criado; o cleanup
remove containers, volumes e arquivos temporários desse projeto isolado.

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
`conversions_outbox`: preserva `tracking_event_id` e `fbc`, mas não permite
nome, e-mail, telefone, respostas, hashes nem chaves equivalentes, inclusive
em objetos aninhados.

O inventário de segredos da matriz fica em
`runtime/commercial-local-certification.mjs`; ele contém somente nomes,
localizações e finalidades. Valores nunca entram em documentação, testes ou
logs.

Esta é uma evidência local, não a certificação comercial final. A restauração
do banco por `backup.sh` e `restore.sh` foi exercitada no Compose descartável.
Vercel de staging, Asaas Sandbox e revisão visual
independente continuam pendentes. A VSL própria pertence à V2 e não integra os
critérios da V1.
