# Leads e webhook — plano curto

**Objetivo:** tornar respostas utilizáveis comercialmente antes de construir uma fila avançada.

**Dependências:** `editores_saas` e `publicacao_por_projeto` concluídos.

## Corte inicial

1. Listar respostas reais por formulário e projeto, com paginação e permissões existentes.
2. Exportar CSV com cabeçalhos estáveis, codificação UTF-8 e somente os campos daquele formulário.
3. Permitir uma URL HTTPS de webhook por formulário, validada e armazenada sem segredos no navegador.
4. Após persistir a resposta, fazer uma entrega simples com timeout, identificador do evento e estado visível no Studio.
5. Cobrir isolamento entre empresas, URL inválida, timeout e resposta remota de erro sem perder o lead salvo.

## Validação

- O lead aparece no Studio e no CSV mesmo se o webhook falhar.
- O destino recebe um evento do projeto correto, sem credenciais em logs.
- Editor/analista sem permissão não altera o destino.
- A homologação usa servidor local controlado; nenhum egress externo real.

## Depois, somente quando o volume justificar

Fila durável, leases, várias tentativas, DNS pinning e auditoria completa pertencem ao nó `worker_webhook` e não bloqueiam o fluxo comercial inicial.
