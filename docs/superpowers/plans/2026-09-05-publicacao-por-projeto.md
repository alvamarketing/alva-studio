# Publicação por projeto — plano comercial

**Objetivo:** publicar, em um único projeto Vercel, todas as landing pages e formulários publicados de um projeto do Studio, preservando rotas, separando prévia e produção e mantendo credenciais fora do navegador.

**Arquitetura:** o Studio monta um snapshot determinístico a partir das versões imutáveis já existentes. Uma conexão Vercel pertence ao projeto; o token cifrado pertence à empresa. Cada envio cria ou reutiliza uma execução idempotente em `deployment_runs`. O deploy leva um arquivo por rota e só recebe estado `ready` após confirmação da Vercel. Formulários estáticos enviam respostas ao endpoint público do Studio.

## Restrições

- Reutilizar `project_routes`, `page_versions`, `form_versions`, `project_integrations`, `company_secrets`, `deployment_runs` e `audit_events`.
- Nunca devolver token, texto cifrado ou cabeçalho de autorização em API, HTML, logs ou erros.
- Prévia não altera produção. Produção exige ação humana explícita e um snapshot já validado.
- Uma publicação sempre contém todas as rotas publicadas do projeto; atualizar uma rota não remove as demais.
- Não adicionar rollback, fila, CDN, múltiplos provedores ou automação de produção neste módulo.

## 1. Snapshot publicável

- Criar um builder que carregue todas as versões publicadas do projeto, ordene pelas rotas e gere `{manifest, files, hash}` estável.
- Página usa o HTML salvo. Formulário usa o renderizador atual e uma URL pública absoluta para submissão.
- Rejeitar snapshot vazio, rota inválida/duplicada e conteúdo de outra empresa.
- Testar página + formulário, múltiplas rotas, estabilidade do hash e isolamento.

## 2. Conexão Vercel por projeto

- Criar repositório para salvar `teamId`, projeto externo e estado em `project_integrations`.
- Guardar o token cifrado em `company_secrets`, com uma chave mestra do ambiente e leitura somente no servidor.
- Ativar configuração e teste de conexão nas APIs SaaS existentes, com DTO sem segredo e permissões atuais.
- Testar troca/desconexão, duas empresas e ausência de segredo nas respostas.

## 3. Execução idempotente e publicador

- Generalizar `Publisher` para arquivos múltiplos, projeto estável e ambientes `preview`/`production`.
- Criar `DeploymentRepository`: a chave única combina ambiente e hash; repetição devolve a execução existente.
- Persistir ID/URL/estado externo antes de consultar; aceitar `READY`, `ERROR`, `CANCELED` e `BLOCKED` como terminais.
- Aplicar tentativas limitadas somente em `429`, timeout e `5xx`, respeitando cabeçalhos de limite.

## 4. API de publicação

- Adicionar endpoints do projeto para criar prévia, consultar execução, publicar em produção e configurar domínio.
- Criar auditoria de solicitação, sucesso e falha; owner/admin mantêm as capacidades já definidas.
- Só promover o snapshot validado para produção. Domínio/alias só depois de `READY`.
- Manter os botões legados dos editores encaminhando ao fluxo do projeto, sem publicar uma rota isolada.

## 5. Tela e homologação

- Implementar a seção Publicação no projeto com conexão, resumo das rotas, botão de prévia, confirmação de produção, estado e domínio.
- Exibir linguagem simples: “Preparando”, “No ar” e “Falhou”, mantendo o detalhe técnico recolhido.
- Validar desktop e celular; rodar testes focais durante as tarefas e a suíte completa somente ao final.
- Homologação real para após revisão do resultado: conectar uma conta Vercel, obter `READY`, abrir duas rotas e confirmar uma resposta de formulário.

**Gate:** preview e produção preservam todas as rotas, não misturam empresas, repetem o mesmo snapshot sem novo deploy e não expõem credenciais.
