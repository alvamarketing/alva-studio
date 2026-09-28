# Alva Studio

Construtor visual de landing pages, quizzes e funis da Alva Marketing. O editor é o Puck (React, confinado ao editor); a página publicada é HTML desenhado pelo servidor a partir do esquema `alva/1`. O editor antigo (GrapesJS) saiu em 28/09/2026. A fundação SaaS usa PostgreSQL para separar empresas, membros, projetos, páginas, respostas e sessões. O logo e a identidade visual atuais do Studio são preservados.

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
- Páginas (landing e quiz) ligadas a empresa e projeto, com rotas únicas e validação de caminhos reservados.
- Controle de revisão concorrente, exclusão lógica e snapshots imutáveis das páginas publicadas.
- Respostas das capturas vinculadas à versão da página que as recebeu.
- API que devolve `404` para recursos de outra empresa e exige capacidade para escrita, respostas e administração.

O estado do editor (esquema `alva/1`) é chamado `editorState` na API SaaS e `editor_state` no banco. Ele não deve ser confundido com um **Projeto do Studio** nem com um **Projeto da Vercel**.

## Captura e respostas

Landing e quiz são páginas do esquema `alva/1`. O formulário de uma landing e as etapas de um quiz viram, na publicação, a captura da versão (`page_versions.capture_schema`); a página publicada envia para `/api/public/pages/.../captures/<id>/submissions`, pelo gateway assinado. O servidor valida as respostas contra a captura congelada — num quiz, refazendo o caminho das etapas — e só então grava em `page_submissions`, enfileira o webhook da página e a conversão. O formulário dinâmico antigo (tabela `forms`, rota `/f/...`) saiu em 28/09/2026.

### Coletor interno de analytics

O Studio coleta visitas, origem, UTMs, click IDs, conversões e marcos de VSL no próprio PostgreSQL, isolados por empresa e projeto. O `tracker.js` é servido de primeira parte e não usa cookie nem serviço externo; o navegador envia somente caminho, query filtrada, domínio de referência e identificadores/eventos estruturados. Nome, e-mail, telefone, arquivos e respostas abertas são rejeitados e nunca entram em `analytics_*`. Sessões e eventos brutos são retidos por 90 dias, enquanto agregados diários permanecem por até 24 meses. Páginas públicas usam CSP com nonce por resposta, e o coletor aceita somente origens publicadas e trackers provisionados para o projeto.

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

## Voltar atrás

A importação dos JSONs locais (`server/import-local.mjs`) serviu à transição para o banco e saiu em 28/09, junto com o formulário antigo: ela importava `forms.json` e `form-submissions.json` para tabelas que a migração 028 removeu.

O rollback seguro do corte é restaurar a cópia do banco anterior ou apontar novamente para o snapshot local preservado. Não existe rollback SQL automático para migrações de produção: toda migração nova precisa de plano de restauração do backup antes de ser aplicada.

Depois do corte, todas as sessões devem ser encerradas e os usuários entram novamente. Credenciais Vercel antigas não são importadas: o proprietário ou administrador deverá reconectar a Vercel quando a integração por projeto estiver disponível.

## Vercel e integrações

O conector Vercel atual pertence ao modo local e cifra o token em disco. A integração Vercel SaaS, por empresa e projeto, com cofre de segredos, domínio compartilhado por rotas e publicação atômica ainda está pendente. O painel SaaS responde que essa configuração está em preparação para evitar sugerir que existe uma conexão real.

Aurora e mídia continuam etapas próprias. O MCP V1 permite criar, listar e revogar chaves por projeto, guardando somente hash, prefixo, escopos, validade e auditoria; o segredo `alva_` é mostrado uma única vez. O endpoint expõe somente consulta de projeto/páginas/quizzes/conteúdo e criação idempotente de rascunhos, com rate limit persistente e isolamento revalidado. Não há publicação, cobrança, domínio, equipe, tracking, analytics, mídia, créditos, modelos, WaveSpeed, Apps ou Lab via MCP. A cobrança V1 usa um único plano recorrente por empresa, com checkout hospedado Asaas, sandbox por padrão e dados comerciais definidos somente pelo servidor. O webhook público aceita no máximo 64 KB, exige token de ao menos 32 caracteres em comparação de tempo constante, deduplica pelo ID de evento Asaas, persiste apenas inbox sanitizada e confirma acesso somente no worker após reconsulta. Não há carteira, créditos, pacotes, mídia ou Apps/Lab neste contrato.

## Runtime comercial

Os motores internos comerciais nascem desligados. Somente o valor literal
`true` ativa cada flag; qualquer valor ausente ou diferente mantém o recurso
indisponível:

- `CONVERSIONS_ENABLED`
- `MEDIA_PIPELINE_ENABLED`
- `BILLING_ENFORCEMENT`

A exceção é `PIXELS_ENABLED`, ligada por padrão: sem ela a página publicada não tem
pixel do navegador nem banner de consentimento, e o lead não é deduplicado entre
navegador e servidor. Só o valor literal `false` a desliga.

As flags não provisionam serviços, não expõem painéis nem tornam uma integração
ativa por si mesmas. O analytics é nativo do Studio e não depende de flag: o
Umami saiu, e o coletor Node existente registra os eventos sempre. A entrega
de conversões seguiu o mesmo caminho — o runtime NVS saiu, e o Studio entrega
direto às plataformas de anúncio —, mas essa camada continua atrás de
`CONVERSIONS_ENABLED`.

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
`POST /api/billing/webhook/asaas` com o token do mesmo ambiente. O `studio-worker`,
no papel de cobrança (`--role=…,billing`), é o único que consulta
pagamentos/assinaturas no provedor e valida pagamento, referência externa, valor, moeda, ambiente,
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
