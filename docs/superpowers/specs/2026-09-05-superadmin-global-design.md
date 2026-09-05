# Painel de plataforma (superadmin) — desenho global

## Objetivo

Dar ao dono da plataforma uma superfície separada para configurar o que não pertence a nenhuma empresa: o bucket R2 da Alva, a chave-mestra e a origem pública, as credenciais globais de tracking que não são por projeto, e a gestão das empresas. Hoje essas coisas moram no `.env` do servidor ou em lugar nenhum, e mudar qualquer uma exige deploy.

O painel é para uma pessoa só, acima de todas as empresas. Ele não é um papel de empresa promovido: é ortogonal ao `ROLE_CAPABILITIES` de `server/domain/access.mjs`, que descreve o que alguém pode fazer **dentro** de uma empresa.

## O papel de plataforma

Tabela `platform_admins`, não uma flag em `users`:

- `platform_admins (user_id uuid PK REFERENCES users(id), granted_at, granted_by uuid REFERENCES users(id), revoked_at)`.
- Uma tabela dá histórico de concessão e revogação, permite mais de um administrador no futuro sem alterar `users`, e mantém `users` — que o login e o `bootstrap-owner.mjs` já leem — intocada.
- Nenhuma capacidade nova entra em `ROLE_CAPABILITIES`. A verificação é `isPlatformAdmin(userId)`, por consulta, jamais `hasCapability(role, 'platform.manage')`. Papel de empresa nunca concede acesso de plataforma, e o contrário também não.

**Restrição que decide o primeiro corte.** `sessions.company_id` e `sessions.membership_id` são `NOT NULL` com FK composta para `company_memberships`, e o gatilho `sessions_require_active_membership` exige membership ativa (`001_saas_foundation.sql:42-55` e `:213-215`). Um superadmin sem empresa **não consegue ter sessão**. Portanto, no primeiro corte o superadmin também é membro `owner` de uma empresa — a Alva Marketing — e `/api/platform/*` simplesmente ignora o contexto de empresa da sessão, checando só `platform_admins`. Tornar o contexto de sessão nulável exigiria reescrever o gatilho e a FK. **Decidido pelo dono em 05/09/2026: o superadmin também é `owner` de uma empresa e o painel checa só `platform_admins`; sessão sem empresa fica fora do escopo**, e a separação de identidades vira dívida registrada, não trabalho pendente.

## Bootstrap seguro do primeiro superadmin

Reutilizar `server/bootstrap-owner.mjs`, que já cria a primeira conta pela linha de comando, lendo a senha do stdin, fora do navegador e com acesso ao banco. Estender com uma opção `--platform-admin` que insere em `platform_admins` dentro da mesma transação da criação do usuário.

A regra é dura: **o painel nunca concede o primeiro acesso de plataforma.** Só o CLI, executado por quem já tem o servidor e a `DATABASE_URL`. Concessões seguintes acontecem pelo painel, por um superadmin já existente, com auditoria, e autoconcessão é recusada. Revogar o último superadmin ativo é recusado — senão a plataforma fica sem dono e só volta pelo CLI.

Isso também evita inventar um segundo caminho de bootstrap: hoje `setupAllowed` em `server/index.mjs` já restringe `POST /api/setup` a `127.0.0.1` sem `PUBLIC_ORIGIN`, e esse caminho continua sendo só da primeira conta de empresa.

## Cofre global e a chave que ele mesmo rotaciona

Duas tabelas:

- `global_settings (key varchar PK, value jsonb NOT NULL, updated_at, updated_by uuid REFERENCES users(id))` — o que não é segredo: origem pública, nome do bucket, host público do bucket, limites e cotas padrão.
- `global_secrets (id uuid PK, scope varchar, name varchar, encrypted_value text, key_version int, created_at, rotated_at, updated_by, UNIQUE (scope, name, key_version))` — o que é segredo. `scope` separa `r2`, `wavespeed`, `meta`, `google`, `tiktok`, `linkedin`, `taboola` e `vault`.

**Write-only, sem exceção.** Nenhum endpoint devolve `encrypted_value` nem o texto claro, nem mascarado, nem parcial. A leitura devolve apenas `{ configurado: true, configuradoEm, keyVersion }`. Quem perdeu o segredo gera outro no provedor. A tela reflete isso: campo para salvar, e depois de salvo só "configurado em <data>" e um botão "Substituir" que reabre o campo vazio.

**A chave que se rotaciona.** O paradoxo é conhecido: o painel que guarda a chave-mestra não pode guardar a chave que o decifra. A saída é separar chave de envelopamento de chave de dados:

- A **KEK** vive no ambiente e em nenhum outro lugar.
- A **DEK** vive em `global_secrets` com `scope='vault'`, envelopada pela KEK.
- Todo segredo — global e de empresa — passa a ser cifrado com a DEK, não com a KEK.

Com isso, **rotacionar a KEK reenvelopa uma linha só**, em milissegundos, sem tocar em nenhum segredo. O fluxo tem duas fases, porque o ambiente é do operador, não do painel: o painel recebe a nova KEK e grava a DEK envelopada nas duas KEKs ao mesmo tempo; o operador troca a variável e reinicia; o painel confirma que o servidor subiu com a nova e apaga o envelope antigo. Enquanto as duas existem, nada quebra — e se o operador desistir, a KEK antiga ainda abre.

**Rotacionar a DEK** é a operação cara: decifra todos os segredos com a versão atual, recifra com a nova e incrementa `key_version`. É o que o dono chamou de "recifrar segredos", é o botão que precisa de confirmação por escrito, e tem duas condições — a do parágrafo seguinte e a janela de manutenção.

**Pré-requisito explícito, e bloqueante.** Nada de recifragem antes de o `SecretVault` virar um chaveiro real. Hoje, em `server/repositories/publication-repository.mjs:12-37`, ele grava `keyVersion: 1` fixo no `encrypt` e **ignora** esse campo no `decrypt`, derivando a chave sempre da mesma variável de ambiente. Um cofre que não sabe com qual versão cada linha foi cifrada não pode conviver com duas versões, e recifrar nesse estado transforma qualquer falha no meio do caminho em perda definitiva: as linhas já reescritas não abrem com a chave antiga e as restantes não abrem com a nova.

A ordem obrigatória é: (1) o chaveiro passa a decifrar pela `keyVersion` gravada na linha e a cifrar sempre na versão corrente, com teste que prova leitura de linha v1 e v2 no mesmo processo; (2) só então a recifragem roda. Ela acontece em janela de manutenção, em lotes com retomada — não numa transação única, que travaria escrita —, cada lote idempotente pela `keyVersion` de destino, e com plano de recuperação escrito antes de começar: dump do cofre imediatamente antes, e a chave antiga preservada até a última linha ser confirmada.

## O que fica obrigatoriamente no ambiente

Só o que é necessário para o servidor conseguir chegar ao banco e abrir o cofre:

1. `DATABASE_URL` — não se lê configuração de um banco ao qual não se conecta.
2. A **KEK**, como `ALVA_MASTER_KEY`, aceitando `VERCEL_MASTER_KEY` como nome legado durante a transição. É a raiz da cadeia e não pode morar dentro do que ela cifra.
3. `PORT` e `HOST` — precisam existir antes de qualquer consulta, para abrir o socket.

Tudo o mais sai do `.env`. `PUBLIC_ORIGIN` passa a viver em `global_settings`, com a variável de ambiente rebaixada a **override de emergência**: se estiver definida, ela vence e o painel mostra "definida no ambiente, não editável aqui". Trocar a origem pelo painel exige digitá-la duas vezes e só grava depois que o próprio servidor consegue uma resposta 200 de `https://<nova>/api/platform/health`; o valor novo entra no próximo boot, nunca no meio de uma requisição. Errar a origem tranca todo mundo para fora, e a recuperação documentada é definir a variável de ambiente de novo e reiniciar.

As quatro variáveis de R2 que a spec de mídia fixou no ambiente (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_HOST`) saem do `.env`: conta, chaves e bucket passam a ser gravados pelo painel — as chaves em `global_secrets`, o nome do bucket e o host público em `global_settings`. Isso muda uma decisão anterior daquela spec, cujo argumento era que o cofre guarda segredo de tenant e este não é de tenant — argumento correto para `company_secrets` e resolvido por `global_secrets`, que é justamente o lugar que faltava. **Decidido pelo dono em 05/09/2026: conta, chaves e bucket do R2 ficam em `global_secrets`, gravados pelo painel, não no ambiente.** O bucket da Alva continua sendo o padrão. **`global_secrets` é a única fonte de verdade para o R2 — não há fallback de ambiente, nem para o arranque.** Sem credencial gravada no painel, o upload responde que o armazenamento ainda não foi configurado. No ambiente ficam só `DATABASE_URL` e a KEK; `PORT` e `HOST` são parâmetros de socket, não configuração.

## Superfície `/api/platform/*`

Um módulo `platform-api.mjs` despachado em `server/index.mjs` **antes** do `projectApi`, porque hoje a linha `server/index.mjs:366` captura todo `/api/` não público e o `projectApi` termina em 404 — sem preceder, nenhuma rota nova é alcançável.

- `GET /api/platform/overview` — contadores e estado, sem conteúdo de empresa.
- `GET /api/platform/settings` e `PUT /api/platform/settings` — só o que não é segredo.
- `PUT /api/platform/secrets/:scope/:name` grava; `DELETE` remove. Não existe `GET` de segredo, em nenhuma forma.
- `POST /api/platform/master-key/rotate` e `POST /api/platform/master-key/confirm` — as duas fases da KEK.
- `GET /api/platform/companies`, `POST /api/platform/companies/:id/suspend`, `POST /api/platform/companies/:id/activate`.
- `GET /api/platform/audit`.
- `GET /api/platform/health` — só para a sonda de origem; responde sem sessão e sem revelar nada.

A sessão, o cookie e as defesas de origem e `Sec-Fetch-Site` são as mesmas de hoje. A única diferença é a checagem de `platform_admins` antes de qualquer rota. Sem sessão é 401; com sessão e sem `platform_admins`, **404** — não 403 —, porque a existência do painel não precisa ser confirmada a quem não é dono.

## Auditoria e isolamento

Toda alteração vira um evento. `audit_events` não serve: tem `company_id NOT NULL REFERENCES companies(id)` (`001_saas_foundation.sql:363-377`) e ação de plataforma não tem empresa. Entra `platform_audit_events (id, actor_user_id, action, target_type, target_id, result, metadata jsonb, created_at)`. O `metadata` guarda escopo, nome e `key_version` — **nunca** o valor do segredo, nem prefixo, nem tamanho, nem hash.

Isolamento é a regra que mantém o painel defensável: **o superadmin não lê conteúdo das empresas.** Nenhuma rota de `/api/platform/*` devolve página, formulário, resposta, lead, VSL ou evento de analytics. O que ele vê de cada empresa é agregado contado no servidor — bytes no R2, eventos no período, projetos, membros, estado da assinatura. Para ver conteúdo, o caminho é o convite normal, que fica registrado na empresa. Não existe "entrar como" neste corte; se um dia existir, precisa de trilha visível para a empresa afetada.

## A tela, no padrão de "Empresa e equipe"

Reproduz exatamente a seção **"Empresa e equipe"** de `docs/wireframes/alva-studio-ui-reference.html` (`<section class="view" id="view-settings">`), trocando só o conteúdo. Nada de layout novo, nada de token novo — vale a "Regra de fidelidade visual" do `AGENTS.md`.

Bloco a bloco, na ordem do wireframe:

Atenção a uma armadilha do arquivo: existem duas telas parecidas. `#view-workspace` tem `h1` "Alva Marketing" e é **órfã** — nenhuma aba aponta para ela, o alias `{workspace:'settings'}` redireciona todo clique, e uma regra esconde os itens que levariam até lá. A tela viva, e a que vale como referência, é `#view-settings`. Do `#view-workspace` aproveitamos apenas dois padrões que ele tem e o outro não: a `.member-row` de quatro colunas, com `icon-button` de ações no fim, e os blocos `.plan-hero`/`.usage`/`.usage-bar` da "Cobrança".

1. **Barra lateral** `.project-sidebar` com `.alva-logo`, `.project-switcher` e itens `.nav-item`. No wireframe o switcher mostra "Alva Marketing" / "Conta" e o `.nav-label` é "CONFIGURAÇÕES", com Preferências, Empresa, Equipe e acessos, Plano e cobrança. Aqui vira "Plataforma Alva" / "Superadmin", `.nav-label` "PLATAFORMA", e os itens Armazenamento, Segurança, Integrações globais, Empresas.
2. **Cabeçalho** `.project-heading`: `.eyebrow` com "PLATAFORMA" no lugar de "CONFIGURAÇÕES"; `<h1>` "Configurações da plataforma" no lugar de "Empresa e equipe"; `.domain-pill` com ícone `verified` e o texto "Acesso de plataforma" no lugar de "Conta Alva Marketing"; à direita, o mesmo `button primary` "Salvar alterações".
3. **Abas** `.settings-nav`, com os mesmos `button`/`button active` do wireframe: "Armazenamento", "Segurança", "Integrações globais", "Empresas" — quatro no lugar dos três atuais.
4. **Grid** `.workspace-grid`, dois cartões `.surface` por aba, cada um com `.surface-head` (h2 + botão) e campos `.field` > `label` + `.control`, idênticos a "Dados da empresa".
   - *Armazenamento*: cartão "Bucket R2 da Alva" com "Nome do bucket", "Host público" e "Região" (`select`, como "Fuso horário"); cartão "Chaves do R2" com "Access Key ID" e "Secret Access Key" — os dois write-only, exibindo "configurado em <data>" e um `button` "Substituir" quando já existirem.
   - *Segurança*: cartão "Origem pública" com "Endereço público" e "Confirme o endereço"; cartão "Chave-mestra" com "Nova chave", o estado "versão N, rotacionada em <data>" e dois botões — "Rotacionar chave-mestra" e "Recifrar segredos", o segundo com confirmação escrita.
   - *Integrações globais*: um cartão por provedor de anúncio e um cartão **"Geração de imagens (WaveSpeed)"** com o campo "Chave de API", cada um só com campos write-only e o mesmo par "configurado em"/"Substituir".
   - *Empresas*: lista na variante de quatro colunas de `.member-row` — `.member-avatar` com as iniciais, nome e domínio em `strong`/`small`, `.role` com o estado ("Ativa", "Suspensa") e o `icon-button` `more_horiz` de ações. Ao lado, o cartão de uso reaproveita `.usage`, `.usage-head` e `.usage-bar`, que no wireframe mostram "Projetos 2 de 5", "Membros 3 de 10" e "Domínios publicados 2 de 5"; aqui os rótulos viram "Armazenamento", "Eventos no mês" e "Projetos", com a barra em `width` percentual como lá.
5. **Rodapé de regra** `.project-rule`, o retângulo escuro do wireframe, com o texto: "Segredo não se lê, se substitui. O painel guarda; quem perdeu, gera outro no provedor."

Estados de carregando, vazio e erro não existem no wireframe. Eles são construídos **com as classes e os tokens do `design_system`**, e com nada mais.

### O sistema de design é um nó, não uma cópia local

Decisão do dono em 05/09/2026: o `<style>` interno do wireframe será **portado para `packages/studio/public/` como sistema de design canônico**, num nó próprio do grafo, `design_system`. A partir dele, `.surface`, `.surface-head`, `.workspace-grid`, `.member-row`, `.member-avatar`, `.role`, `.settings-nav`, `.field`, `.control`, `.toggle`, `.button` e variantes, `.project-rule`, `.plan-hero`, `.usage`, `.usage-bar`, `.setup-row`, `.status-pill`, `.domain-pill` e `.eyebrow` deixam de ser marcação do wireframe e passam a ser o vocabulário real do produto.

A tela do superadmin usa **somente** classes e tokens desse sistema. Não reaproveita `styles.css`, `owner.css`, `forms.css` nem `editor-shell.css`; não define classe nova; não escreve valor de cor, raio, sombra, família ou tamanho fora do sistema. Se faltar um componente, o lugar de resolver é o `design_system`, não a tela — e isso é uma pergunta para o dono, como manda a "Regra de fidelidade visual" do `AGENTS.md`.

Por isso `plataforma_superadmin` **depende de `design_system`**. Portar o CSS antes de desenhar a primeira tela nova evita o caminho de sempre: a tela nasce com utilitários próprios, o sistema chega depois e a tela nunca é reescrita.

**O porte não é merge de folha de estilo: é reescrita de vocabulário.** O inventário independente mostra por quê. O wireframe define **161 classes** em ~23,8 KB e ~304 regras; as quatro folhas do Studio somam 3.151 linhas e 246 classes. Só **10 nomes existem dos dois lados** — `.surface`, `.surface-head`, `.eyebrow`, `.nav-item`, `.icon-button`, `.project-switcher`, `.project-columns`, `.chart`, `.journey` e `.analytics-card` —, e desses, `.chart`, `.journey`, `.surface`, `.surface-head` e `.analytics-card` já foram portados antes e são compatíveis, enquanto `.eyebrow`, `.nav-item`, `.icon-button`, `.project-switcher` e `.project-columns` têm o mesmo nome e semântica diferente (o Studio usa `.nav-active` em vez de `.active`, o switcher é um `select` e não um card, `.project-columns` já evoluiu para `minmax`).

O grosso do trabalho não é colisão, é **ausência**. As primitivas de formulário do wireframe — `.field`, `.control`, `.toggle` — **não existem em nenhuma das quatro folhas**, e o mesmo vale para quase todo o vocabulário da tela "Empresa e equipe": `.workspace-grid`, `.settings-nav`, `.plan-hero`, `.usage`, `.usage-bar`, `.usage-head`, `.project-rule`, `.domain-pill`, `.status-pill`, `.setup-row`, `.member-avatar`. Onde há equivalente, o nome é outro: `.member-row` virou `.member-item`/`.member-list`, `.role` virou `.role-chip`, `.tree-row` virou `.fe-tree-item` e `.dynamic-tree-item`. E a tela "Empresa e equipe" que existe hoje (`public/owner.js` e `owner.css`) usa um esquema próprio, `owner-*` e `settings-company-*`, sem nenhuma classe de layout do wireframe.

Duas consequências. A primeira: o painel do superadmin será a **primeira tela construída inteiramente sobre o `design_system`** — não há tela existente com que alinhar, e por isso ele é o melhor lugar para estrear o sistema. A segunda: o `design_system` é maior do que uma folha de estilo. Alinhar as telas que já existem exige reescrever nomes de classe e a marcação gerada em cerca de seis arquivos JS (`owner.js`, `templates.js`, `forms.js`, `editor-shell.js`, `studio-dashboard.js`, `studio-shell.js`) além dos quatro CSS. Esse alinhamento é trabalho do nó; o painel só depende da folha existir.

Nos tokens, **5 de 12 batem exatamente** (`--blue`, `--ink`, `--muted`, `--soft`, `--white`); `--line`, `--cloud`, `--blue-50`, `--success` e `--danger` divergem, a família muda (Inter no wireframe, `--font-sans` Instrument Sans no app), e `--r` e `--shadow` não têm equivalente 1:1 porque o Studio já os decompôs em quatro raios e três sombras. Nenhum dos dois tokeniza espaçamento ou tamanho de fonte.

**O app tem tema escuro e o wireframe não:** `public/ui-preferences.js` alterna sistema, claro e escuro e `styles.css` remapeia doze tokens em `:root[data-color-scheme='dark']`, enquanto o wireframe tem só a paleta clara — o `design_system` precisa definir os tokens dos dois temas, e toda regra portada referencia `--alva-*` em vez do hex do wireframe, senão o modo escuro quebra em silêncio.

A primeira entrega do nó é, portanto, a decisão escrita de cada um dos 10 nomes coincidentes — manter o do Studio, adotar o do wireframe ou renomear — e a lista das classes ausentes que o sistema passa a criar, antes de qualquer linha ser movida.

### A tela do painel não precisa de CSP própria

O painel é uma rota da SPA autenticada já servida em `/` a partir do mapa `files` de `server/index.mjs`. Ela é mesma origem, carrega só JavaScript de `'self'`, conversa exclusivamente por JSON com `/api/platform/*` e não renderiza HTML gerado por usuário nem script de terceiro. Não há superfície que justifique uma política separada — o painel herda a da SPA.

O que precisa ser registrado é a lacuna que ele revela: **a SPA hoje não tem CSP nenhuma.** As páginas públicas já têm — `/f/...` recebe `Content-Security-Policy-Report-Only` (`server/index.mjs:296`) e `/v/...` recebe a política do player (`:374`) —, mas o shell autenticado, que agora vai manipular segredo de plataforma, não recebe cabeçalho algum. Fechar isso não é trabalho deste nó: cabe ao `design_system`, que já reescreve o HTML e o CSS do shell, e pode reutilizar o `formContentSecurityPolicy` de `server/content-security-policy.mjs` sem inventar um segundo construtor.

## Efeito sobre os nós existentes

- **`midia_r2_upload`** deixa de ler as quatro variáveis de R2 do ambiente e passa a lê-las do cofre global; ganha dependência deste nó. Sem R2 configurado no painel, o upload responde que o armazenamento ainda não foi configurado, em vez de falhar na chamada à Cloudflare.
- **`tracking_conversoes`** passa a buscar aqui as credenciais de provedor que não são por projeto, e mantém no cofre de empresa as que são. Ganha dependência deste nó.
- **`geracao_imagens`** ganha dependência deste nó. O dono decidiu em 05/09/2026 que a geração de imagens por IA usa **WaveSpeed**; a chave de API vive em `global_secrets` com `scope='wavespeed'`, write-only como as demais, e nunca chega ao navegador — o servidor é quem chama o provedor, e a imagem gerada é persistida no R2 do projeto antes de entrar no conteúdo. A interface está desenhada em [`2026-09-05-editor-unificado.md`](2026-09-05-editor-unificado.md), que já registra "Provedor decidido: WaveSpeed" (linha 123).
- **`cobranca_empresa`** consome a listagem de empresas e as métricas de uso: suspender por inadimplência vira a mesma operação que o painel já expõe.

## Nós propostos para o grafo

Texto para `produto/grafo.yaml`, no formato dos demais. **Não apliquei nada ao arquivo.**

```yaml
  - id: design_system
    estado: pendente
    faz: Portar por merge seletivo o CSS interno do wireframe para packages/studio/public como sistema de design canônico, resolvendo as colisões de nome uma a uma
    depende:
      - shell_saas
    produz: Folha canônica com os componentes do wireframe escritos sobre os tokens --alva-*, tema claro e escuro, e CSP do shell autenticado
    passa_quando:
      tipo: arquivo
      caminho: .estado/design_system.md
      casa: "Prova: 10 nomes coincidentes decididos, classes ausentes criadas, nenhum hex literal fora dos tokens, dois temas, [0-9]+ testes verdes"
  - id: plataforma_cofre_global
    estado: pendente
    faz: Separar chave de envelopamento e chave de dados, criar o cofre global cifrado e a rotação em duas fases
    depende:
      - fundacao_saas
    produz: global_settings, global_secrets, SecretVault com chaveiro por versão e rotação de KEK e DEK
    passa_quando:
      tipo: comando
      comando: node --test packages/studio/test/platform-vault.test.mjs
      espera: exit 0
  - id: plataforma_superadmin
    estado: pendente
    faz: Criar o papel de plataforma, o bootstrap por CLI, a superfície /api/platform e a tela no padrão do wireframe
    depende:
      - plataforma_cofre_global
      - design_system
    produz: Painel de plataforma com segredos write-only, auditoria própria e nenhum acesso a conteúdo de empresa
    passa_quando:
      tipo: arquivo
      caminho: .estado/plataforma_superadmin.md
      casa: "Prova: segredo write-only, sem leitura de conteúdo, tela conferida contra o wireframe usando o design_system, [0-9]+ testes verdes"
  - id: plataforma_empresas
    estado: pendente
    faz: Listar empresas, ativar, suspender e medir armazenamento, eventos e projetos por empresa
    depende:
      - plataforma_superadmin
    produz: Gestão de empresas e métricas de uso que a cobrança vai consumir
    passa_quando:
      tipo: comando
      comando: node --test packages/studio/test/platform-companies.test.mjs
      espera: exit 0
```

Ordem resultante: **`design_system` → `plataforma_cofre_global` → `plataforma_superadmin` → `plataforma_empresas`**. Os dois primeiros são independentes entre si e podem ser construídos em paralelo — `design_system` só mexe em `public/`, o cofre só em `server/` —, mas os dois precisam estar prontos antes da tela.

E três arestas a acrescentar: `midia_r2_upload`, `tracking_conversoes` e `geracao_imagens` passam a depender de `plataforma_superadmin`; `cobranca_empresa` passa a depender também de `plataforma_empresas`.

`plataforma_cofre_global` não é o `cofre_por_projeto` proposto na spec de mídia: aquele conserta o endereçamento de `company_secrets` para segredo de tenant, este cria o lugar que faltava para segredo que não é de tenant. Os dois convivem e compartilham o mesmo `SecretVault` com chaveiro — por isso o cofre global vem primeiro. Os nós de mídia ainda não foram aplicados ao grafo, que hoje tem `midia_cdn` no lugar deles; a aresta para `midia_r2_upload` só existe depois que aquela proposta for aplicada.

## Fases

0. **Sistema de design.** Porte do `<style>` do wireframe, resolução das colisões de nome com as folhas atuais, tema escuro que o wireframe não tem, e a CSP do shell autenticado. Paralelo à fase 1.
1. **Cofre.** Primeiro o `SecretVault` vira chaveiro, com teste de leitura v1 e v2 no mesmo processo. Só depois KEK/DEK, `global_settings`, `global_secrets` e a recifragem em lotes do acervo de `company_secrets`, em janela com dump prévio. Nada de tela.
2. **Painel.** `platform_admins`, `--platform-admin` no CLI, `platform-api.mjs`, auditoria, e a tela com as abas Armazenamento, Segurança e Integrações globais, feita só com o `design_system`.
3. **Empresas.** Listagem, ativar, suspender e métricas de uso.

## Critérios de aceite

- Nenhuma rota de `/api/platform/*` devolve o valor de um segredo, em nenhuma forma; um teste percorre todas as respostas procurando o texto claro gravado e falha se o encontrar.
- Usuário sem `platform_admins` recebe 404 em todas as rotas do painel, inclusive com sessão válida de proprietário de empresa.
- O CLI cria o primeiro superadmin; o painel recusa autoconcessão e recusa revogar o último ativo.
- O chaveiro lê, no mesmo processo, uma linha gravada em `key_version` 1 e outra em 2, e sempre grava na corrente — provado **antes** de qualquer recifragem existir.
- Rotacionar a KEK não altera nenhuma linha de `global_secrets` ou `company_secrets` além do envelope da DEK; rotacionar a DEK incrementa `key_version` de todas e mantém todos os segredos decifráveis.
- Interromper a recifragem no meio deixa todas as linhas legíveis — as já convertidas pela chave nova, as restantes pela antiga — e retomar conclui sem reprocessar as convertidas.
- Origem pública só é gravada depois da sonda a `/api/platform/health`; origem inválida é recusada antes de persistir.
- Nenhuma resposta do painel contém página, formulário, resposta, lead, VSL ou evento de analytics de qualquer empresa.
- Cada alteração gera um `platform_audit_events` cujo `metadata` não contém valor, prefixo, tamanho nem hash do segredo.
- A tela do painel não emite CSP própria e a SPA passa a ter uma, construída pelo `design_system` com `formContentSecurityPolicy`.
- **Verificação visual em navegador**, conforme o `AGENTS.md`: a tela aberta lado a lado com a seção "Empresa e equipe" (`#view-settings`) do wireframe, em desktop e em 375 px, com screenshot anexado à certificação. A folha do `design_system` é a única fonte de estilo da tela: um teste falha se o painel referenciar classe que não pertence a ela, e nenhum token novo é criado em lugar nenhum.

## Riscos

O maior é trancar a plataforma para fora: errar a origem pública ou perder a KEK no meio de uma rotação deixa o produto inacessível. Por isso a rotação é em duas fases, a origem tem sonda e override de ambiente, e as duas coisas têm procedimento de recuperação escrito. O segundo é o painel virar um caminho lateral para os dados dos clientes — a regra de não ler conteúdo precisa ser testada, não apenas documentada. O terceiro é a recifragem em massa: com muitos segredos, a transação fica longa e trava escrita; a mitigação é recifrar em lotes com retomada, não numa transação só. O quarto é o porte do `design_system`, e ele é maior do que parece: das 161 classes do wireframe só 10 coincidem por nome com as folhas do Studio, e **cinco dessas têm semântica diferente** — `.nav-item` usa outro nome de estado, `.project-switcher` é outro componente, `.project-columns` já evoluiu para `minmax`. Um porte literal quebraria as cinco. O risco maior, porém, é de escopo: as primitivas `.field`, `.control` e `.toggle` e quase todo o vocabulário de "Empresa e equipe" não existem no app, e alinhar as telas atuais mexe em ~6 arquivos JS além dos 4 CSS. Some-se que só 5 dos 12 tokens de cor batem e que o wireframe não tem tema escuro: portar hex cru apaga o modo escuro sem erro visível. Por isso o nó começa pelo inventário e pela decisão escrita de cada colisão, e toda regra portada referencia `--alva-*`. O quinto é o superadmin depender de uma membership de empresa para ter sessão — decidido assim, funciona, mas mistura duas identidades no mesmo cookie, e a separação real fica como dívida registrada.
