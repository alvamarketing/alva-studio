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

As flags comerciais ficam literalmente em `false`: esta entrega inicia apenas
a infraestrutura. Ela não provisiona Umami ou NVS, não envia eventos e não
habilita pipeline de mídia. O NVS é uma base PHP com health checks e consulta
real ao MariaDB; o Core e suas APIs entram em tarefa posterior. O
`studio-worker` executa a fila de webhooks fora do processo web. O
`studio-media-worker` só registra heartbeat e conectividade PostgreSQL até a
tarefa de mídia.

## Subir e verificar

O `studio-web` aplica as migrações antes de abrir a porta. Consulte
`/health/live` para processo vivo e `/health/ready` para processo com
PostgreSQL acessível. Um 503 de readiness não expõe detalhes da conexão.

```sh
docker compose --env-file /caminho/runtime.env -p alva-runtime-teste -f runtime/compose.yaml up -d --build
curl --fail http://127.0.0.1:4178/health/live
curl --fail http://127.0.0.1:4178/health/ready
```

Use nome de projeto isolado para não tocar serviços existentes. Confira as oito
health checks antes de usar o runtime. Umami valida `/api/heartbeat` com status
200; a prontidão NVS consulta o MariaDB e só aprova JSON com `status: ready`.

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
saúde dos três serviços, interrompe `studio-web`, `studio-worker`,
`studio-media-worker`, `umami` e `nvs` antes da primeira escrita e os religa
por trap mesmo em falha. Uma falha durante a aplicação ainda exige restaurar
novamente o mesmo backup nos três bancos. Antes de restaurar, gere um backup
novo do estado atual para recuperação. O dump MariaDB usa somente o banco e
usuário `nvs`, sem bancos de sistema nem a conta root.
