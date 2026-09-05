# Task 1 — Estado do shell e troca segura de contexto

## Resumo

- Adicionado `createStudioShell`, sem dependência do DOM, para carregar sessão, empresas e projetos, expor o contexto confirmado e verificar capacidades por papel.
- A troca de empresa ou projeto salva e fecha os editores antes do `PATCH /api/session`, limpa imediatamente o projeto anterior e ignora respostas de requisições antigas.
- O editor de landing page e o editor de formulário retornam ao projeto que originou o conteúdo.

## Testes

- RED confirmado: `node --test packages/studio/test/studio-shell.test.mjs` falhou porque `studio-shell.js` ainda não existia.
- GREEN e regressão: `node --test packages/studio/test/studio-shell.test.mjs packages/studio/test/editor-controls.test.mjs packages/studio/test/forms-ui.test.mjs` — 22 testes aprovados.
- Sintaxe e espaços: `node --check` nos três módulos alterados e `git diff --check` — aprovados.

## Commit

`feat: adiciona contexto persistente ao shell do Studio`

## Riscos

- O seletor visual de empresa/projeto será conectado na Task 3; esta tarefa entrega o módulo e o ciclo seguro que ele consumirá.
- Alterações concorrentes de API e repositórios foram preservadas e ficaram fora deste commit.
