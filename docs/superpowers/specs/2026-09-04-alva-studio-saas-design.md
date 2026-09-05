# Alva Studio SaaS — Design de Produto e Arquitetura

## Objetivo

Transformar o Alva Studio local e individual em um SaaS multiusuário no qual empresas organizam projetos que reúnem landing pages, formulários dinâmicos, publicação, domínio, Analytics, rastreamento e acesso por agentes.

A referência visual aprovada está em `docs/wireframes/alva-studio-ui-reference.html`. Os handoffs do IZI e do Aurora são referências de contratos e segurança. Preços, créditos, nomes, limites e regras comerciais não são copiados.

## Hierarquia do produto

```text
Usuário
└── participação em uma ou mais Empresas
    ├── equipe, papéis, assinatura e limites
    ├── chaves de agentes
    └── Projetos
        ├── landing pages com rotas
        ├── formulários dinâmicos com rotas
        ├── domínio e publicação Vercel
        ├── Analytics, UTMs e mapa
        └── rastreamento e conversões
```

Uma assinatura pertence à empresa. Um usuário pode participar de várias empresas. Conteúdo, dados, integrações e auditoria sempre carregam o identificador da empresa e do projeto.

## Terminologia obrigatória

- **Projeto do Studio:** agrupador interno que representa um site, campanha ou funil publicável.
- **Estado do editor:** documento JSON do GrapesJS atualmente armazenado em `page.project`; passa a se chamar `editorState` na API nova e `editor_state` no banco.
- **Projeto da Vercel:** destino externo associado ao projeto do Studio; usa `vercelProjectId` na API e `vercel_project_id` no banco.
- **Rota:** caminho único de uma landing page ou formulário dentro do projeto, como `/`, `/imobiliarias` ou `/diagnostico`.

Os três significados não podem compartilhar o nome `project` em contratos novos.

## Stack

- JavaScript ESM em Node.js 22 ou superior.
- GrapesJS 0.23.6 como motor do editor de landing pages.
- PostgreSQL como fonte transacional do SaaS.
- Armazenamento de objetos compatível com S3 para uploads e ativos grandes.
- HTML, CSS e módulos JavaScript no painel, mantendo o produto sem dependência de WordPress.
- `node:test` para testes unitários, HTTP e de integração.
- Vercel como destino opcional das páginas publicadas.

O modo JSON atual permanece somente como fonte de importação e compatibilidade de desenvolvimento durante a migração. Ele não recebe gravações depois do corte para o SaaS.

## Modelo de dados

### Identidade e empresas

- `users`: identidade, e-mail normalizado, senha derivada, estado e datas.
- `companies`: empresa pagante, slug, estado e datas.
- `company_memberships`: relação usuário/empresa, papel, estado, convite e entrada.
- `project_grants`: projetos permitidos para membros que não administram a empresa inteira.
- `invitations`: convite com hash do segredo, papel, validade e aceite.
- `sessions`: hash do token, usuário, empresa atual, validade e revogação.

### Projetos e conteúdo

- `projects`: empresa, nome, slug, estado, criador e datas.
- `pages`: empresa, projeto, nome, rota, template, `editor_state`, HTML renderizado, revisão e exclusão lógica.
- `page_versions`: snapshot imutável do estado e HTML publicado.
- `forms`: empresa, projeto, nome, rota, schema de rascunho, revisão e versão publicada.
- `form_versions`: schema público imutável.
- `form_submissions`: empresa, projeto, formulário, versão, respostas, `tracking_event_id`, estado de tracking e data.
- `submission_files`: arquivo privado no armazenamento de objetos, MIME, nome e tamanho.

### Publicação e integrações

- `project_domains`: projeto, ambiente, domínio canônico, aliases e estado de verificação.
- `project_integrations`: referências públicas e configuração não secreta por provedor e ambiente.
- `company_secrets`: segredo cifrado ou referência a cofre, versão e rotação.
- `deployment_runs`: projeto, ambiente, hash do snapshot, idempotência, estado, ator, identificadores externos e datas.
- `audit_events`: empresa, projeto opcional, ator humano ou agente, ação, recurso, revisão e resultado.

### Agentes e cobrança

- `agent_keys`: empresa, projeto opcional, hash da chave, prefixo, escopos, limites, validade e revogação.
- `agent_runs`: pedido, idempotência, estado, erro e datas.
- `plans`: catálogo versionado do Studio.
- `billing_accounts`: empresa e cliente correspondente no Asaas.
- `payment_orders`, `subscriptions`, `payments` e `billing_events`: ciclo financeiro auditável.
- `entitlements`: limites efetivos da empresa.

Carteira e créditos entram somente quando o Studio vender consumo variável. Planos de assinatura por recursos usam `entitlements` sem uma carteira artificial.

## Papéis e capacidades

| Capacidade | Proprietário | Administrador | Editor | Analista |
|---|---:|---:|---:|---:|
| Ver projetos e conteúdo | sim | sim | atribuídos | atribuídos |
| Criar e editar conteúdo | sim | sim | atribuídos | não |
| Ver respostas | sim | sim | atribuídos | atribuídos |
| Publicar e conectar domínio | sim | sim | não | não |
| Configurar tracking e integrações | sim | sim | não | não |
| Gerenciar equipe | sim | sim, sem alterar proprietário | não | não |
| Gerenciar cobrança ou excluir empresa | sim | não | não | não |

O backend autoriza capacidades como `page.write`, `submission.read` e `deployment.publish`. Comparações diretas de nomes de papel não ficam espalhadas pelas rotas. A empresa define o papel e uma concessão por projeto limita onde Editor e Analista atuam.

Tentativas de acessar um recurso de outra empresa respondem como recurso inexistente. O servidor sempre deriva a empresa permitida da sessão ou chave; um identificador enviado pelo cliente nunca concede acesso.

## Publicação por projeto

Cada projeto do Studio corresponde a um projeto Vercel estável. O domínio pertence ao projeto. Landing pages e formulários escolhem apenas uma rota.

Uma publicação cria um snapshot atômico de todas as rotas publicadas. Publicar uma rota não pode apagar ou misturar versões de outras rotas. A geração valida caminhos duplicados, diferenças apenas por caixa ou barra, caminhos reservados e referências quebradas antes de chamar a Vercel.

Preview e produção são ambientes separados. Uma execução guarda revisão esperada, hash do snapshot e chave de idempotência. Repetir o mesmo pedido retorna a execução existente; reutilizar a chave com outro conteúdo falha. O estado `READY` da Vercel confirma a publicação.

Publicar em produção, conectar ou remover domínio e alterar DNS são ações auditadas e confirmadas explicitamente.

## Analytics e rastreamento

Cada projeto e ambiente corresponde a um site no Aurora. O publisher injeta uma instalação versionada em todas as rotas do snapshot.

- Umami é a fonte de pageviews, sessões, páginas, origem e cinco UTMs.
- NVS registra eventos comerciais e conversões; seus pageviews automáticos permanecem desligados.
- O mapa usa as rotas reais do projeto.
- Formulários podem emitir `form_start`, `form_step` e `form_error` sem respostas abertas.
- O evento `lead` só ocorre depois que o backend persiste a submissão.
- `tracking_event_id` é opaco, persistente e reutilizado na deduplicação.

Nome, e-mail, telefone, arquivos e respostas abertas não entram em URLs, UTMs, Umami ou logs. Correspondência de mídia com dados pessoais exige política específica e processamento no servidor.

## Agent first via MCP

O Studio expõe um endpoint MCP HTTP. A empresa cria uma chave, vê o segredo uma vez e escolhe projetos, escopos, validade e limites. O banco guarda somente o hash.

Escopos iniciais:

- `studio:read`
- `content:write`
- `forms:read`
- `forms:write`
- `analytics:read`
- `deploy:preview`
- `deploy:production`
- `domains:manage`

A primeira versão expõe leitura, rascunhos, validação e preview. Publicação em produção entra depois de fila, auditoria, revisão esperada e idempotência estarem comprovadas. Escrita financeira não entra no MCP inicial.

## Asaas e assinatura

A empresa é titular da assinatura; o usuário é o ator. Somente Proprietário ou um futuro papel financeiro cria checkout ou cancela renovação.

O servidor lê plano e preço do catálogo, congela o contrato no pedido e cria checkout hospedado. O retorno do navegador atualiza a interface, mas não libera recursos. O webhook autenticado reconsulta a cobrança no Asaas, confere ambiente, pedido, empresa, valor e identificador do pagamento e atualiza os entitlements em transação idempotente.

Sandbox e produção são isolados. Reembolso, chargeback, inadimplência, período de tolerância, retenção e exportação dependem da política comercial antes da ativação pública.

## Migração do Studio local

1. Criar backup imutável e manifesto SHA-256 dos arquivos locais.
2. Validar todos os registros com os normalizadores existentes.
3. Criar a empresa Alva Marketing e o primeiro usuário proprietário.
4. Criar um projeto padrão e importar páginas e formulários preservando UUIDs, revisões e datas.
5. Converter `page.project` para `pages.editor_state`.
6. Converter `page.deployment.projectId` para histórico de publicação externa.
7. Associar respostas à primeira versão importada do formulário.
8. Reconciliar contagens, vínculos e checksums.
9. Exigir novo login e reconexão da Vercel quando o segredo não puder ser rotacionado com segurança.
10. Manter o JSON como snapshot de rollback sem novas gravações.

O importador registra o checksum. Executá-lo novamente com o mesmo material não duplica dados.

## Experiência visual

- Home mostra projetos e atividade recente.
- Empresa reúne equipe, papéis, plano, cobrança e histórico.
- Projeto reúne conteúdos, publicação, domínio, Analytics, tracking e agentes.
- Landing Page e Formulário compartilham topbar, árvore, canvas e inspetor contextual.
- A árvore é a única representação hierárquica dos elementos.
- Apenas o elemento selecionado recebe contorno no canvas.
- Drag-and-drop possui alternativa completa por teclado e botões de movimento.
- No celular, o editor usa as abas Estrutura, Canvas e Editar; nenhuma coluna essencial desaparece.
- Estados fictícios do wireframe nunca são apresentados como dados reais.

## Sequência de entrega

1. Fundação relacional, tenancy, papéis, projetos, rotas e importação.
2. Shell visual de Home, Empresa e Projeto usando dados reais.
3. Shell compartilhado e redesenho dos dois editores.
4. Publicação Vercel por projeto e múltiplas rotas.
5. Aurora, Umami, NVS e conversões dos formulários.
6. MCP somente leitura, seguido por rascunho, preview e produção controlada.
7. Asaas Sandbox, entitlements e cobrança empresarial.
8. Homologação separada de publicação, tracking e pagamento antes da abertura pública.

## Critério para abertura do SaaS

Uma matriz automatizada precisa provar isolamento entre duas empresas em leitura, escrita, exclusão, respostas, integrações, agentes e publicação. Backups precisam ser restauráveis. Nenhum segredo pode aparecer no navegador, HTML publicado, logs ou Analytics. Cobrança, domínio e produção só são ativados depois de homologação nos ambientes de teste correspondentes.
