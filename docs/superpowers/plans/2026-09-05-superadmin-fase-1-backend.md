# Superadmin — fase 1, backend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dar ao dono da plataforma um cofre global e uma superfície `/api/platform/*` que configuram o que não pertence a nenhuma empresa — bucket R2, chave do WaveSpeed, origem pública, gestão de empresas — sem que nenhuma rota devolva segredo nem conteúdo de cliente. **Sem tela.**

**Architecture:** o superadmin é membro `owner` de uma empresa (é o que permite ter sessão, dado que `sessions.company_id` é `NOT NULL` com FK composta e gatilho de membership ativa) e a autoridade de plataforma vem de uma tabela à parte, `platform_admins`. O cofre passa a ter dois níveis: a **KEK** vive só no ambiente e envelopa a **DEK**, que vive em `global_secrets` com `scope='vault'` e é quem cifra todo segredo — global e de empresa. Isso torna rotacionar a KEK uma operação de uma linha. `platform-api.mjs` é despachado em `server/index.mjs` **antes** do `projectApi`, porque a linha `server/index.mjs:367` captura todo `/api/` não público e o `projectApi` termina em 404.

**Tech Stack:** JavaScript ESM, Node.js 22, PostgreSQL, `node:test`, sem framework adicional.

**Spec:** `docs/superpowers/specs/2026-09-05-superadmin-global-design.md`, seções "Cofre global", "O que fica obrigatoriamente no ambiente", "Superfície `/api/platform/*`" e "Auditoria e isolamento"; fases 1, 2 (sem tela) e 3.

## Global Constraints

- **A tela é fase 2 e não entra aqui.** Ela espera o nó `design_system` migrar "Empresa e equipe", porque é dessa migração que saem `.plan-hero`, `.usage-bar`, `.member-row` e `.settings-nav` — nenhuma existe hoje. Construir tela agora seria construí-la duas vezes.
- **`server/index.mjs` e `server/project-api.mjs` só podem ser tocados depois do commit do `tracking_coletor`**, que está em fechamento e tem os dois modificados na árvore de trabalho. A Task 12 é a única que mexe em `index.mjs`; ela é a última fila justamente por isso. Ao chegar nela, releia o arquivo: a linha de captura `/api/` já se moveu de 366 para 367 desde que a spec foi escrita.
- **Numeração de migração.** Em disco, a maior é `011_analytics_collector.sql`. **012 e 013 estão reservadas** pela spec de mídia (`012_media_providers.sql` e `013_secrets_por_projeto.sql`), que ainda não foram criadas. Este plano usa **014**. Confira o diretório antes de criar o arquivo: `postgres.mjs:45` deriva a versão do prefixo, e dois arquivos com o mesmo prefixo colapsam na mesma versão e derrubam o boot. Se 014 estiver tomada, use a próxima livre. Buracos na numeração são inofensivos — o migrador aplica o que ainda não registrou —, mas se a 012 for criada depois da 014 já aplicada, ela roda fora de ordem cronológica; por isso as duas devem ser independentes, e são.
- **Ordem obrigatória e bloqueante do cofre:** o `SecretVault` vira chaveiro real **antes** de existir qualquer segunda versão de chave, e a recifragem só roda depois disso. Recifrar com um cofre que ignora `keyVersion` transforma falha no meio em perda definitiva.
- **Write-only sem exceção.** Nenhuma rota devolve `encrypted_value` nem texto claro, nem mascarado, nem parcial, nem tamanho, nem hash. A leitura devolve `{ configurado, configuradoEm, keyVersion }`.
- **Isolamento.** Nenhuma rota de `/api/platform/*` devolve página, formulário, resposta, lead, VSL ou evento de analytics. O que o superadmin vê de cada empresa é agregado contado no servidor.
- **Sem sessão é 401; com sessão e sem `platform_admins` é 404**, não 403 — a existência do painel não se confirma a quem não é dono.
- Toda produção segue RED → GREEN → REFACTOR. Quem implementa não faz a revisão de aceite.
- Suites com `postgresFixture(t)` exigem Docker. O padrão é `const { connectionString } = await postgresFixture(t); const database = createDatabase({ connectionString }); t.after(() => database.close()); await migrate(database);` dentro de cada `test(...)`.

---

### Task 1: Migração 014 — plataforma, cofre global e auditoria própria

**Files:**
- Create: `packages/studio/server/db/migrations/014_platform_admin.sql`
- Test: `packages/studio/test/database-schema.test.mjs`

**Interfaces:**
- `platform_admins (user_id uuid PK REFERENCES users(id), granted_by uuid REFERENCES users(id), granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz)`.
- `global_settings (key varchar(80) PK, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES users(id))`.
- `global_secrets (id uuid PK DEFAULT gen_random_uuid(), scope varchar(40) NOT NULL, name varchar(80) NOT NULL, encrypted_value text NOT NULL, key_version integer NOT NULL CHECK (key_version > 0), created_at, rotated_at, updated_by uuid REFERENCES users(id), UNIQUE (scope, name, key_version))`.
- `platform_audit_events (id uuid PK, actor_user_id uuid REFERENCES users(id), action varchar(80) NOT NULL, target_type varchar(40), target_id varchar(120), result varchar(20) NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now())` — **sem `company_id`**, porque ação de plataforma não tem empresa e `audit_events` (`001_saas_foundation.sql:363-377`) exige uma.
- Índice `platform_audit_events (created_at DESC)`.

- [ ] **Step 1: Escrever os testes que falham**

  Em `database-schema.test.mjs`: as quatro tabelas existem; `global_secrets` recusa `key_version = 0`; a unicidade `(scope, name, key_version)` permite duas versões do mesmo segredo e recusa a terceira igual; `platform_admins` recusa `user_id` inexistente; `platform_audit_events` aceita evento **sem** empresa; e o `metadata` tem default `{}`.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/database-schema.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/database-schema.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): schema de plataforma, cofre global e auditoria`

**Pronto quando:** a suite passa e `migrate()` roda duas vezes sem erro de checksum.

---

### Task 2: `SecretVault` vira chaveiro real — pré-requisito bloqueante

**Files:**
- Modify: `packages/studio/server/repositories/publication-repository.mjs`
- Test: `packages/studio/test/publication-service.test.mjs`
- Create: `packages/studio/test/secret-vault.test.mjs`

**Interfaces:**
- Hoje `publication-repository.mjs:12-37` grava `keyVersion: 1` fixo no `encrypt` e **ignora** o campo no `decrypt`, derivando a chave sempre da mesma variável. Passa a: `new SecretVault({ keys: Map<version, Buffer>, currentVersion })`; `encrypt` sempre grava na versão corrente e registra `keyVersion`; `decrypt` escolhe a chave **pela versão gravada na linha** e falha claramente se a versão não estiver no chaveiro.
- Compatibilidade: linha antiga sem `keyVersion` legível é tratada como versão 1.
- `keyFrom()` continua aceitando `ALVA_MASTER_KEY` com `VERCEL_MASTER_KEY` como nome legado.

- [ ] **Step 1: Escrever os testes que falham**

  Sem banco. Provar, **no mesmo processo**: uma linha cifrada em `keyVersion: 1` e outra em `2` são ambas decifradas corretamente; `encrypt` grava sempre na corrente; decifrar linha cuja versão não está no chaveiro dá erro nomeado, não `undefined`; linha legada sem `keyVersion` é lida como versão 1; e trocar a versão corrente não torna ilegível nada já gravado.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/secret-vault.test.mjs packages/studio/test/publication-service.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Não mude ainda de onde vêm as chaves — só o chaveiro. KEK/DEK é a Task 3.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/secret-vault.test.mjs packages/studio/test/publication-service.test.mjs`

- [ ] **Step 5: Commit** — `refactor(studio): SecretVault passa a respeitar keyVersion`

**Pronto quando:** o teste de leitura v1 e v2 no mesmo processo passa. **Nenhuma task de recifragem começa antes disto.**

---

### Task 3: KEK no ambiente, DEK no cofre

**Files:**
- Modify: `packages/studio/server/repositories/publication-repository.mjs`
- Create: `packages/studio/server/platform-vault.mjs`
- Create: `packages/studio/test/platform-vault.test.mjs`

**Interfaces:**
- Produces: `loadDataKey({ database, masterKey })` → abre a linha `global_secrets` com `scope='vault'`, `name='dek'`, desenvelopando com a KEK; cria a DEK na primeira execução.
- Produces: `wrapDataKeyWith({ dataKey, masterKeys })` → envelopa a mesma DEK sob **duas** KEKs, para a rotação em duas fases.
- Todo segredo — global e de empresa — passa a ser cifrado com a **DEK**, nunca com a KEK.
- Rotação da KEK em duas fases: `rotate` grava a DEK envelopada nas duas; `confirm` apaga o envelope antigo depois que o servidor subiu com a nova.

- [ ] **Step 1: Escrever os testes que falham**

  Com `postgresFixture(t)`: primeira execução cria a DEK; segunda reusa a mesma; a DEK envelopada nas duas KEKs abre com qualquer uma; `confirm` remove o envelope antigo e a KEK antiga deixa de abrir; **rotacionar a KEK não altera nenhuma linha de `company_secrets` nem de `global_secrets` além do envelope da DEK** — comparar as linhas antes e depois; KEK ausente falha no boot com mensagem clara, não com stack.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/platform-vault.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/platform-vault.test.mjs packages/studio/test/secret-vault.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): KEK no ambiente e DEK no cofre global`

**Pronto quando:** rotacionar a KEK toca exatamente uma linha, provado por comparação antes/depois.

---

### Task 4: Recifragem em lotes, com retomada e plano de recuperação

**Files:**
- Create: `packages/studio/server/platform-rekey.mjs`
- Create: `packages/studio/test/platform-rekey.test.mjs`
- Modify: `packages/studio/README.md` (só o procedimento de recuperação)

**Interfaces:**
- Produces: `rekeySecrets({ database, vault, targetVersion, batchSize = 50, onProgress })` → `{ convertidos, restantes }`. Percorre `company_secrets` e `global_secrets`, **em lotes, nunca numa transação única** — transação única travaria escrita.
- Cada lote é idempotente pela `keyVersion` de destino: linha já na versão alvo é pulada.
- Interromper no meio deixa tudo legível: convertidas pela nova, restantes pela antiga — é o chaveiro da Task 2 que garante isso.
- O README ganha o procedimento: dump do cofre imediatamente antes, janela de manutenção, chave antiga preservada até a última linha confirmada, e como retomar.

- [ ] **Step 1: Escrever os testes que falham**

  Com `postgresFixture(t)`: 120 segredos e `batchSize: 50` convertem em três lotes; **interromper depois do primeiro lote deixa todas as 120 linhas legíveis**, as 50 pela nova e as 70 pela antiga; retomar converte só as 70 e não reprocessa as 50; rodar duas vezes seguidas é idempotente; falha no meio de um lote não deixa linha com `key_version` novo e conteúdo antigo.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/platform-rekey.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/platform-rekey.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): recifragem de segredos em lotes com retomada`

**Pronto quando:** o teste de interrupção passa e o procedimento de recuperação está escrito no README.

---

### Task 5: `platform-repository.mjs`

**Files:**
- Create: `packages/studio/server/repositories/platform-repository.mjs`
- Create: `packages/studio/test/platform-repository.test.mjs`

**Interfaces:**
- `isPlatformAdmin(userId)` → boolean, ignorando revogados.
- `grantAdmin({ actorUserId, userId })` / `revokeAdmin({ actorUserId, userId })` — **recusa autoconcessão** e **recusa revogar o último ativo**.
- `readSettings()` / `writeSetting({ key, value, actorUserId })`.
- `secretStatus({ scope })` → `[{ scope, name, configuradoEm, keyVersion }]` — **nunca** o valor.
- `putSecret({ scope, name, plaintext, actorUserId })` / `deleteSecret({ scope, name, actorUserId })`.
- `recordEvent({ actorUserId, action, targetType, targetId, result, metadata })`.
- `companies({ limit, cursor })` → id, nome, slug, estado, contagem de projetos e membros, bytes no R2 e eventos no período — **agregados, nunca conteúdo**.
- `setCompanyStatus({ companyId, status, actorUserId })`.

- [ ] **Step 1: Escrever os testes que falham**

  Com `postgresFixture(t)`: `grantAdmin` para si mesmo é recusado; revogar o último ativo é recusado; revogar o penúltimo funciona; `secretStatus` nunca traz `encrypted_value` nem texto claro; `putSecret` duas vezes no mesmo `(scope, name)` mantém uma linha por versão; `companies` devolve contagem e **nenhum título de página, formulário ou VSL**; `recordEvent` grava `metadata` sem valor de segredo.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/platform-repository.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/platform-repository.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): repositório de plataforma com cofre write-only`

**Pronto quando:** nenhuma função do arquivo devolve `encrypted_value` em nenhum caminho.

---

### Task 6: `isPlatformAdmin()` no contexto de sessão

**Files:**
- Modify: `packages/studio/server/session-service.mjs`
- Test: `packages/studio/test/server.test.mjs`

**Interfaces:**
- `require(req)` passa a devolver também `isPlatformAdmin`, resolvido por consulta a `platform_admins` — **nunca** por papel de empresa.
- `state(req)` **não** expõe o campo: a SPA não precisa saber, e expor confirmaria a existência do painel a quem não é dono.

- [ ] **Step 1: Escrever os testes que falham**

  Com `postgresFixture(t)`: `require` de um owner comum devolve `isPlatformAdmin: false`; depois de `grantAdmin`, `true`; revogar volta a `false` sem precisar de novo login; `GET /api/session` **não** contém o campo em nenhuma das situações.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/server.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/server.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): contexto de sessão reconhece administrador de plataforma`

**Pronto quando:** a suite passa e `/api/session` continua com a mesma forma de antes.

---

### Task 7: Primeiro superadmin pelo CLI

**Files:**
- Modify: `packages/studio/server/bootstrap-owner.mjs`
- Test: `packages/studio/test/bootstrap-owner.test.mjs`

**Interfaces:**
- `bootstrapOwner({ ..., platformAdmin = false })` — quando verdadeiro, concede `platform_admins` ao usuário criado; quando a conta inicial já existe (`created: false`), pode ainda assim conceder, para o caso de a plataforma já ter sido instalada antes desta fase.
- CLI: flag `--platform-admin` em `process.argv`, sem variável de ambiente nova.
- **O painel nunca concede o primeiro acesso.** Só o CLI, por quem já tem `DATABASE_URL`.

- [ ] **Step 1: Escrever os testes que falham**

  Com `postgresFixture(t)`: sem a flag, nenhuma linha em `platform_admins`; com a flag, exatamente uma; rodar duas vezes com a flag não duplica; com conta já existente e a flag, concede sem recriar a conta; o `granted_by` do primeiro é ele mesmo e isso **não** conta como autoconcessão pelo painel.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/bootstrap-owner.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/bootstrap-owner.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): CLI concede o primeiro administrador de plataforma`

**Pronto quando:** a suite passa e nenhuma rota HTTP consegue conceder o primeiro acesso.

---

### Task 8: `platform-api.mjs` — despachante, guarda e health

**Files:**
- Create: `packages/studio/server/platform-api.mjs`
- Create: `packages/studio/test/platform-api.test.mjs`

**Interfaces:**
- Produces: `createPlatformApi({ sessionService, platform, vault, probe })` → `async ({ req, res, path, method, json })`, devolvendo `false` para caminho fora de `/api/platform/`.
- **Guarda única, aplicada antes de qualquer rota:** sem sessão → 401; com sessão e sem `platform_admins` → **404**.
- `GET /api/platform/health` responde **sem sessão** e sem revelar nada além de `{ ok: true }` — é a sonda de origem da Task 9.
- `GET /api/platform/overview` — contadores e estado, sem conteúdo.
- **Deixe os três grupos de rota já referenciados por import** (`platform-settings.mjs`, `platform-secrets.mjs`, `platform-companies.mjs`), para que as Tasks 9, 10 e 11 só criem os próprios arquivos e não voltem a editar este.

- [ ] **Step 1: Escrever os testes que falham**

  Sem sessão, toda rota (menos `health`) responde 401; com sessão de owner comum, **404 em todas**, inclusive `overview`; com `platform_admins`, 200; `health` responde sem cookie; caminho fora de `/api/platform/` devolve `false`.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/platform-api.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/platform-api.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): superfície /api/platform com guarda de plataforma`

**Pronto quando:** owner comum recebe 404, nunca 403, em todas as rotas.

---

### Task 9: Configurações e as duas fases da KEK

**Files:**
- Create: `packages/studio/server/platform-settings.mjs`
- Create: `packages/studio/test/platform-settings.test.mjs`

**Interfaces:**
- `GET`/`PUT /api/platform/settings` — só o que não é segredo: origem pública, nome e host público do bucket, cotas padrão.
- **Origem pública:** só grava depois que o próprio servidor obtém 200 de `https://<nova>/api/platform/health`. Origem inválida é recusada **antes** de persistir. O valor novo entra no próximo boot, nunca no meio de uma requisição.
- Se `PUBLIC_ORIGIN` estiver no ambiente, ela **vence** e a resposta marca `origemNoAmbiente: true` — override de emergência, não configuração normal.
- `POST /api/platform/master-key/rotate` e `/confirm` — as duas fases da Task 3.
- A sonda usa as defesas de egress já existentes em `outbound-webhook.mjs` (`resolveAndValidateDestination` e `pinnedFetch`), **não** um `fetch` cru.

- [ ] **Step 1: Escrever os testes que falham**

  Sonda que devolve 500 impede a gravação; sonda 200 grava; origem sem HTTPS é recusada antes da sonda; com `PUBLIC_ORIGIN` no ambiente a gravação é recusada e a resposta traz `origemNoAmbiente`; `rotate` sem `confirm` mantém as duas KEKs válidas; cada alteração gera um `platform_audit_events`.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/platform-settings.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/platform-settings.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): configurações globais com sonda de origem e rotação de KEK`

**Pronto quando:** nenhum caminho grava origem sem a sonda ter passado.

---

### Task 10: Segredos write-only e auditoria

**Files:**
- Create: `packages/studio/server/platform-secrets.mjs`
- Create: `packages/studio/test/platform-secrets.test.mjs`

**Interfaces:**
- `GET /api/platform/secrets` → lista de `{ scope, name, configurado, configuradoEm, keyVersion }`. **Não existe `GET` de valor, em nenhuma forma.**
- `PUT /api/platform/secrets/:scope/:name` grava; `DELETE` remove. Escopos do primeiro corte: `r2` (`access_key_id`, `secret_access_key`) e `wavespeed` (`api_key`).
- Cada operação grava `platform_audit_events` cujo `metadata` traz escopo, nome e `key_version` — **nunca** valor, prefixo, tamanho ou hash.
- `:scope` e `:name` vêm de allowlist, não de texto livre.

- [ ] **Step 1: Escrever os testes que falham**

  Gravar um segredo e depois **varrer toda resposta de todas as rotas** procurando o texto claro — nenhuma pode contê-lo; `GET` de valor não existe (404 ou método não permitido); escopo fora da allowlist é recusado; o `metadata` do evento não contém o valor nem o tamanho; substituir gera nova versão e a listagem mostra a data nova.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/platform-secrets.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/platform-secrets.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): segredos globais write-only com auditoria`

**Pronto quando:** a varredura pelo texto claro não encontra nada em nenhuma resposta.

---

### Task 11: Empresas — listar, ativar, suspender e uso

**Files:**
- Create: `packages/studio/server/platform-companies.mjs`
- Create: `packages/studio/test/platform-companies.test.mjs`

**Interfaces:**
- `GET /api/platform/companies` — id, nome, slug, estado, projetos, membros, bytes no R2 e eventos no período. **Agregados contados no servidor.**
- `POST /api/platform/companies/:id/suspend` e `/activate` — mudam `companies.status`, com auditoria.
- `GET /api/platform/audit` — a trilha, paginada.

- [ ] **Step 1: Escrever os testes que falham**

  Com duas empresas, cada uma com página, formulário, resposta e VSL: a listagem traz contagens corretas e **nenhum título, rota, resposta ou `publicId`**; suspender muda o status e gera evento; suspender empresa inexistente é 404; ativar de volta funciona; a auditoria pagina e não devolve segredo.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/platform-companies.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/platform-companies.test.mjs`

- [ ] **Step 5: Commit** — `feat(studio): gestão de empresas e trilha de auditoria da plataforma`

**Pronto quando:** a listagem não devolve nenhum campo de conteúdo.

---

### Task 12: Despachar `/api/platform/*` antes do `projectApi`

**Files:**
- Modify: `packages/studio/server/index.mjs`
- Test: `packages/studio/test/server.test.mjs`

**Interfaces:**
- `platform-api.mjs` é chamado **antes** da linha que hoje captura `/api/` (`server/index.mjs:367`); se devolver `false`, o fluxo segue como hoje.
- O painel só existe quando há banco, como o `projectApi`. Sem banco, `/api/platform/*` é 404 pelo caminho normal.

- [ ] **Step 1: Confirmar que `tracking_coletor` está commitado**

  `git status` limpo em `server/index.mjs` e `server/project-api.mjs`. **Se não estiver, pare.** Releia a linha de captura antes de editar.

- [ ] **Step 2: Escrever os testes que falham**

  `/api/platform/overview` com `platform_admins` responde 200 e **não** cai no 404 do `projectApi`; sem `platform_admins` responde 404; `/api/projects` continua funcionando exatamente como antes; `/api/public/forms/...` não é afetado.

- [ ] **Step 3: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/server.test.mjs packages/studio/test/project-api.test.mjs`

- [ ] **Step 4: Implementar o mínimo**

- [ ] **Step 5: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/server.test.mjs packages/studio/test/project-api.test.mjs`

- [ ] **Step 6: Commit** — `feat(studio): despachar rotas de plataforma antes da API de projeto`

**Pronto quando:** nenhuma rota existente mudou de comportamento.

---

### Task 13: Isolamento e varredura de vazamento, ponta a ponta

**Files:**
- Create: `packages/studio/test/platform-isolation.test.mjs`

**Interfaces:** nenhuma. Só teste.

- [ ] **Step 1: Escrever os testes que falham**

  Com duas empresas povoadas — páginas, formulários com respostas, VSLs publicadas, eventos de analytics — e um superadmin que é owner **só da primeira**: percorrer **todas** as rotas de `/api/platform/*` e provar que nenhuma resposta contém título de página, rota publicada, texto de resposta de formulário, e-mail de lead, `publicId` de VSL ou evento de analytics — de nenhuma das duas, **inclusive da empresa da qual ele é owner**. Gravar segredos nos dois escopos e provar que o texto claro não aparece em nenhuma resposta nem em nenhum `metadata` de auditoria.

- [ ] **Step 2: Rodar focado e confirmar RED**

  Run: `node --test packages/studio/test/platform-isolation.test.mjs`

- [ ] **Step 3: Implementar o mínimo**

  Se o teste já passar no RED, registre como resultado válido — significa que as tasks anteriores já cumpriram a regra.

- [ ] **Step 4: Rodar focado e confirmar GREEN**

  Run: `node --test packages/studio/test/platform-isolation.test.mjs`

- [ ] **Step 5: Commit** — `test(studio): isolamento do painel de plataforma`

**Pronto quando:** a varredura não encontra conteúdo de empresa nem segredo em nenhuma resposta.

---

### Task 14: Documentação e certificação

**Files:**
- Modify: `packages/studio/MAPA.md`, `packages/studio/server/MAPA.md`, `packages/studio/test/MAPA.md`
- Modify: `packages/studio/README.md`
- Create: `.estado/plataforma_cofre_global.md`, `.estado/plataforma_superadmin.md`, `.estado/plataforma_empresas.md`

- [ ] **Step 1: Suite completa, uma única vez**

  Run: `node --test --test-concurrency=1 packages/studio/test/*.test.mjs`

- [ ] **Step 2: Atualizar os mapas e o README**

  `server/MAPA.md` ganha `platform-api.mjs`, `platform-settings.mjs`, `platform-secrets.mjs`, `platform-companies.mjs`, `platform-vault.mjs`, `platform-rekey.mjs` e o repositório. O README passa a dizer que **só `DATABASE_URL` e a KEK ficam no ambiente**, que `PUBLIC_ORIGIN` é override de emergência, que o R2 não tem fallback de ambiente, e traz o procedimento de recuperação de KEK e de recifragem.

- [ ] **Step 3: Revisão independente de aceite**

  Quem construiu não confere. Verificar: nenhuma rota devolve segredo; owner comum recebe 404; a recifragem tem plano de recuperação escrito; nenhum teste anterior foi editado para passar; nenhuma migração aplicada foi alterada.

- [ ] **Step 4: Escrever as certificações**

  Com `status: feito`, ressalvas, e a linha exigida pelo `passa_quando` de cada nó. Rodar `vibe conferir` nos três e confirmar verde.

**Pronto quando:** a suite completa passa, os mapas refletem os arquivos novos e as três certificações estão verdes.

---

## Gate de homologação

Subir o Studio com PostgreSQL real e KEK no ambiente. Criar o primeiro superadmin pelo CLI. Gravar chave do R2 e do WaveSpeed pelo painel e confirmar que a listagem mostra só "configurado em ‹data›". Rotacionar a KEK em duas fases, reiniciar e confirmar que todos os segredos continuam legíveis. Rodar a recifragem, interrompê-la de propósito no meio, confirmar que tudo continua legível e retomar até o fim. Entrar com um owner comum e confirmar **404** em todas as rotas do painel. Confirmar que nenhuma resposta trouxe conteúdo de empresa.

## Ordem e paralelismo

- **Onda 1, dois terminais:** Task 1 (migração) e Task 2 (chaveiro) — arquivos disjuntos; a 2 não depende do schema novo.
- **Onda 2, quatro terminais:** Task 3 (depende de 1 e 2), Task 5 (depende de 1), Task 6 (depende de 1), Task 7 (depende de 1).
- **Onda 3, dois terminais:** Task 4 (depende de 3) e Task 8 (depende de 5 e 6).
- **Onda 4, três terminais:** Tasks 9, 10 e 11 — arquivos próprios; o despachante da Task 8 já os referencia, então nenhuma reedita `platform-api.mjs`.
- **Onda 5:** Task 12, sozinha — é a única que toca `server/index.mjs`, e só depois do commit do `tracking_coletor`.
- **Onda 6:** Task 13, sozinha.
- **Onda 7:** Task 14, sozinha.

Sem colisão em nenhuma onda: `publication-repository.mjs` só pelas Tasks 2 e 3, em ondas diferentes; `session-service.mjs` só pela 6; `bootstrap-owner.mjs` só pela 7; `platform-api.mjs` só pela 8; os três grupos de rota são arquivos separados; `index.mjs` só pela 12; e o README é tocado pela 4 (procedimento de recuperação) e pela 14 (o resto), em ondas distantes.
