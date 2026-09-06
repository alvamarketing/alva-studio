# Alva Studio — 2026-09-04

Original. Alva Studio é um construtor visual de landing pages e formulários dinâmicos da Alva Marketing, baseado em GrapesJS e sem WordPress. O produto evolui do painel individual local para um SaaS em que cada empresa organiza seus projetos publicáveis.

## Contrato atual

Uma empresa contém membros, papéis, assinatura futura, limites futuros e projetos. Um usuário pode participar de mais de uma empresa. Um projeto reúne landing pages, formulários dinâmicos, rotas, domínio, publicação, Analytics, rastreamento e agentes quando essas integrações forem ativadas.

Páginas e formulários carregam sempre `companyId` e `projectId`. O documento do GrapesJS passa a ser `editorState` na API e `editor_state` no PostgreSQL. Esse estado não é um projeto. O projeto externo da Vercel será nomeado explicitamente quando a integração por projeto for construída.

A fundação já usa PostgreSQL com migrações verificadas por checksum, empresas, memberships, concessões de projeto, sessões persistentes, páginas, formulários, rotas, versões imutáveis, respostas e importação idempotente do material JSON local. A rota local de formulário publicado é `/f/<empresa>/<projeto>/<formulario>`; um domínio conectado expõe somente o GET público e o POST de submissão. O acesso entre empresas responde como inexistente. O usuário deve receber uma nova sessão depois da migração.

O editor visual, modelos, formulários dinâmicos, respostas locais, exportação e publicação Vercel legada continuam como compatibilidade de desenvolvimento. O modo local é uma fonte de importação e rollback; ele não é a operação SaaS pública.

## Limites da fundação

O servidor padrão não liga automaticamente ao PostgreSQL: a composição de produção e o shell visual SaaS são próximos passos. Webhooks podem ser configurados com uma URL HTTPS sem credenciais, mas ainda não há resolução DNS, defesa contra SSRF ou DNS rebinding, nem entrega: a execução assíncrona fica `pending` e não faz egress nesta fundação. Vercel por empresa e projeto, domínio de múltiplas rotas, cofre de segredos, Aurora/Umami/NVS, tracking e Asaas ainda exigem suas homologações próprias. O MCP por projeto está limitado a consulta e rascunhos idempotentes, sem publicação, cobrança, domínio, equipe, tracking, analytics ou mídia; ele não pode ser exibido como uma automação de produção até a certificação final.

As referências de IZI, Aurora e Asaas informam contratos e segurança, mas preços, créditos, nomes comerciais, limites e fluxos daquele produto não foram copiados. Nenhuma publicação, DNS, evento de tracking ou cobrança real é executada sem uma homologação e confirmação próprias.

## Critério da próxima entrega

O shell SaaS deve aplicar o wireframe aprovado usando dados reais: Home, Empresa, Projeto, Landing page e Formulário. Antes de abertura pública, a matriz automatizada precisa provar que duas empresas não leem, escrevem, excluem, publicam nem veem respostas umas das outras; backups precisam restaurar; e nenhum segredo pode aparecer no navegador, HTML, logs ou Analytics.
