# Alva Studio

Construtor visual de landing pages e formulários dinâmicos da Alva Marketing, criado sobre o GrapesJS 0.23.6. A fundação SaaS usa PostgreSQL para separar empresas, membros, projetos, páginas, formulários, respostas e sessões. O logo e a identidade visual atuais do Studio são preservados.

## Dois modos durante a transição

`pnpm --ignore-workspace start` é o caminho SaaS. Ele exige `DATABASE_URL`, abre a conexão PostgreSQL, executa as migrações antes de aceitar requisições e encerra o pool ao desligar. Usuários podem participar de empresas, escolher um projeto atual e acessar somente o conteúdo autorizado daquele projeto.

O modo JSON existe apenas para migração ou rollback local: use `pnpm --ignore-workspace start:legacy`. Ele mantém a conta única e os dados em disco. Não o exponha como serviço público nem o use para novas gravações depois do corte SaaS.

## Executar localmente

Requer Node.js 22 ou superior e pnpm 9.

```sh
cd packages/studio
pnpm --ignore-workspace install --frozen-lockfile
pnpm --ignore-workspace start
```

Antes de iniciar, defina `DATABASE_URL` no ambiente ou em `.env`; nunca a registre em logs, documentos versionados ou no navegador. Abra o endereço impresso, normalmente http://127.0.0.1:4178. Para acessar um snapshot JSON apenas durante migração ou rollback, rode `pnpm --ignore-workspace start:legacy`.

Em produção, `/api/setup` só aceita requisições feitas do próprio servidor (sem `PUBLIC_ORIGIN` e a partir de loopback). Para criar a primeira conta remotamente, rode `pnpm --ignore-workspace bootstrap:owner` com `DATABASE_URL`, `OWNER_NAME`, `OWNER_EMAIL` e, opcionalmente, `OWNER_COMPANY_NAME`/`OWNER_COMPANY_SLUG` no ambiente; a senha é lida do stdin e nunca deve ser passada por argumento ou variável de ambiente. O comando é idempotente: se a conta já existir, nada é alterado.

## Fundação SaaS comprovada

- Empresas, memberships e os papéis proprietário, administrador, editor e analista.
- Projetos por empresa, com concessão específica para editor e analista.
- Sessões persistentes e revogáveis; cada sessão mantém a empresa e o projeto atual.
- Páginas e formulários ligados a empresa e projeto, com rotas únicas e validação de caminhos reservados.
- Controle de revisão concorrente, exclusão lógica e snapshots imutáveis de páginas e formulários publicados.
- Respostas de formulários vinculadas à versão que as recebeu.
- API que devolve `404` para recursos de outra empresa e exige capacidade para escrita, respostas e administração.
- Importação local transacional, com checksum e repetição segura.

O documento do GrapesJS agora é chamado `editorState` na API SaaS e `editor_state` no banco. Ele não deve ser confundido com um **Projeto do Studio** nem com um **Projeto da Vercel**.

## Editor e formulários existentes

O Studio mantém páginas criáveis, duplicáveis, renomeáveis e removíveis, modelos, editor visual em português, prévia, download de HTML, blocos de formulário e seção de aparência. Os formulários dinâmicos continuam oferecendo texto, e-mail, telefone, escolhas, data, número, escala, endereço, arquivo, imagem, vídeo, tela informativa, CTA e gráficos; elementos podem usar Material Symbols e movimento.

No modo SaaS, salvar o formulário mantém um rascunho; publicar é uma ação explícita de quem tem permissão de publicação. A rota pública local usa empresa, projeto e formulário, como `/f/<empresa>/<projeto>/<formulario>`. Em um domínio conectado, o servidor aceita publicamente somente o `GET` dessa experiência e o `POST` da submissão; o painel e as demais rotas continuam fechados.

A submissão é persistida antes do webhook. Nesta fundação, configurar o destino valida somente uma URL HTTPS sem credenciais; não há consulta DNS, bloqueio de endereço privado ou proteção contra DNS rebinding ainda. A entrega assíncrona permanece com estado `pending` e não faz saída de rede. Validação de destino completa e o worker de entrega são próximas etapas. O webhook não recebe credenciais do Studio.

### Coletor interno de analytics

O Studio coleta visitas, origem, UTMs, click IDs, conversões por formulário e marcos de VSL no próprio PostgreSQL, isolados por empresa e projeto. O `tracker.js` é servido de primeira parte e não usa cookie nem serviço externo; o navegador envia somente caminho, query filtrada, domínio de referência e identificadores/eventos estruturados. Nome, e-mail, telefone, arquivos e respostas abertas são rejeitados e nunca entram em `analytics_*`. Sessões e eventos brutos são retidos por 90 dias, enquanto agregados diários permanecem por até 24 meses. Páginas públicas usam CSP com nonce por resposta, e o coletor aceita somente origens publicadas e trackers provisionados para o projeto.

Nome, e-mail, telefone, arquivos e respostas abertas nunca entram no Analytics interno, em URLs, em UTMs ou em logs. O canal de conversões de mídia usa identificadores pseudônimos de atribuição e processamento limitado sem autorização de PII direta; nos estados `pending` e `denied`, envia somente o evento, tempo, conteúdo, valor/moeda e IDs permitidos por adaptador. Em `granted`, hashes SHA-256 de e-mail e telefone normalizados são produzidos somente no servidor. Nunca PII em claro, endereço IP ou user agent. Cada projeto declara a empresa cliente como controladora e a Alva Marketing como operadora, com URL de política de privacidade obrigatória antes de qualquer envio de conversão.

## Preparar o PostgreSQL

Crie um banco PostgreSQL dedicado e uma credencial de aplicação com acesso somente a esse banco. Instale as dependências do Studio e use `createDatabase({ connectionString })` seguido de `migrate(database)` de `server/db/postgres.mjs`. O migrador bloqueia execuções concorrentes, registra a versão e o SHA-256 de cada arquivo em `schema_migrations` e falha se uma migração aplicada for alterada.

As migrações atuais são aplicadas em ordem e nunca devem ser editadas depois de usadas em um banco compartilhado:

1. `001_saas_foundation.sql`: empresas, usuários, memberships, sessões, projetos, rotas, conteúdo, versões, respostas, domínios, integrações, segredos, execução de publicação e auditoria.
2. `002_invitations.sql`: convites de membros.
3. `003_published_content_routes.sql`: caminho preservado no snapshot publicado.
4. `004_local_imports.sql`: registro de checksum e relatório da importação local.
5. `005_session_project_context.sql`: projeto atual da sessão.

Para uma mudança futura, crie uma nova migração numerada. Não altere uma migração já registrada: o checksum foi criado para interromper exatamente esse caso.

## Inspecionar, importar e voltar atrás

Os arquivos locais tratados pela transição são `owner.json`, `pages.json`, `forms.json` e `form-submissions.json`, no diretório configurado por `DATA_DIR` ou em `packages/studio/.data/`.

1. Pare as gravações locais e copie o diretório inteiro para um local imutável. Preserve também `secret.key`, mesmo que ele não seja importado para o banco.
2. Rode `inspectLocalData(dir)` de `server/import-local.mjs`. A inspeção retorna validade, problemas, tamanho e SHA-256 por arquivo, além de um checksum consolidado; ela não abre transação nem escreve no banco.
3. Em uma cópia do banco de destino, rode `importLocalData({ dir, database, ownerPassword })`. A senha local é conferida antes da transação. A importação preserva UUIDs, revisões e datas, cria a empresa Alva Marketing e o projeto inicial e registra o checksum em `local_imports`.
4. Compare as contagens de páginas, formulários e respostas com o relatório retornado. Repetir a importação do mesmo conjunto retorna o relatório armazenado e não duplica registros.
5. Só então direcione o processo SaaS ao banco migrado. O JSON original fica guardado como snapshot de rollback e não deve receber novas gravações depois do corte.

O rollback seguro do corte é restaurar a cópia do banco anterior ou apontar novamente para o snapshot local preservado. Não existe rollback SQL automático para migrações de produção: toda migração nova precisa de plano de restauração do backup antes de ser aplicada.

Depois do corte, todas as sessões devem ser encerradas e os usuários entram novamente. Credenciais Vercel antigas não são importadas: o proprietário ou administrador deverá reconectar a Vercel quando a integração por projeto estiver disponível.

## Vercel e integrações

O conector Vercel atual pertence ao modo local e cifra o token em disco. A integração Vercel SaaS, por empresa e projeto, com cofre de segredos, domínio compartilhado por rotas e publicação atômica ainda está pendente. O painel SaaS responde que essa configuração está em preparação para evitar sugerir que existe uma conexão real.

Aurora, MCP/agentes e mídia continuam etapas próprias. A cobrança V1 usa um único plano recorrente por empresa, com checkout hospedado Asaas, sandbox por padrão e dados comerciais definidos somente pelo servidor. O webhook público aceita no máximo 64 KB, exige token de ao menos 32 caracteres em comparação de tempo constante, deduplica pelo ID de evento Asaas, persiste apenas inbox sanitizada e confirma acesso somente no worker após reconsulta. Não há carteira, créditos, pacotes, mídia ou Apps/Lab neste contrato.

## Runtime comercial

Os motores internos comerciais nascem desligados. Somente o valor literal
`true` ativa cada flag; qualquer valor ausente ou diferente mantém o recurso
indisponível:

- `UMAMI_RUNTIME_ENABLED`
- `NVS_RUNTIME_ENABLED`
- `PIXELS_ENABLED`
- `MEDIA_PIPELINE_ENABLED`
- `BILLING_ENFORCEMENT`

As flags não provisionam serviços, não expõem painéis nem tornam uma integração
ativa por si mesmas. O coletor Node existente continua registrando eventos
durante a migração; após o corte homologado para Umami e NVS reais, sua leitura
fica preservada por 90 dias.

### Cobrança Asaas V1

`ASAAS_ENVIRONMENT=sandbox` é o padrão. As chaves e tokens
`ASAAS_SANDBOX_*` e `ASAAS_PRODUCTION_*` são separados; nunca use um
segredo de produção no sandbox. O plano de produção nasce como `draft` e
recusa checkout até revisão operacional. O servidor fixa empresa, ambiente,
plano, preço e moeda BRL no pedido antes de chamar o provedor. Um timeout deixa
o pedido em `submitting` para reconciliação, evitando nova cobrança incerta.

Os limites são aplicados com lock transacional antes de criar projeto, convite
de membro ou reserva de domínio: 5 projetos, 10 membros (incluindo convites
pendentes) e 5 domínios. `BILLING_ENFORCEMENT=true` exige entitlement ativo
somente para publicação em produção; sem a flag, o comportamento histórico de
publicação é preservado. O cancelamento troca o estado para
`cancel_at_period_end` e preserva acesso até o período pago terminar.

Configure o webhook Asaas em
`POST /api/billing/webhook/asaas` com o token do mesmo ambiente. O processo
`studio-billing-worker` é o único que consulta pagamentos/assinaturas no
provedor e valida pagamento, referência externa, valor, moeda, ambiente,
cliente conhecido e assinatura antes de conceder entitlement. Falhas transitórias
e órfãos usam retry com disponibilidade/backoff e limite de tentativas;
divergências, reembolsos e chargebacks ficam em revisão e nunca liberam acesso.
Isso inclui reembolso solicitado/em andamento, disputa de chargeback e espera
de reversão de chargeback.

## Dados e segurança

O servidor escuta somente em `127.0.0.1` por padrão. Para operar atrás de um proxy HTTPS próprio, configure `HOST` e `PUBLIC_ORIGIN` com a origem pública exata. Segredos, tokens e senhas nunca devem entrar no navegador, HTML publicado, logs, fixtures ou Git.

Assets enviados pelo editor podem ser incorporados como base64; o salvamento local aceita até 8 MiB. Para páginas maiores, prefira URLs de mídia. A migração futura para armazenamento de objetos compatível com S3 é parte do shell SaaS.

## Verificar

```sh
cd packages/studio
node --test test/*.test.mjs
```

Os testes incluem duas empresas tentando ler, editar, excluir, publicar e consultar respostas uma da outra. A publicação Vercel usa transporte simulado e não altera uma conta real.
