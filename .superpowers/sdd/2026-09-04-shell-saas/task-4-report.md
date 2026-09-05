# Task 4 — Projeto, conteúdos e responsividade

## Entrega

- A seleção de projeto abre uma visão geral alimentada por `GET /api/projects/:id/overview`.
- A tela mostra nome, slug, domínio verificado, contagens reais, estado de publicação, respostas de formulários e conteúdos unificados.
- Os filtros de Visão geral, Landing pages e Formulários mantêm o conteúdo autorizado e cada linha abre o editor correspondente já existente.
- Analytics, Rastreamento, Publicação e Agentes expõem somente seus estados públicos: “Configurado”, “Ainda não configurado” ou “Em breve”.
- A barra lateral torna-se drawer no celular. Escape fecha o drawer e devolve o foco ao botão que o abriu; diálogos nativos preservam seu retorno de foco.
- A interface usa uma coluna no celular, evita overflow horizontal e mantém controles interativos de pelo menos 44 px.

## TDD

- RED confirmado: os testes novos falharam pela ausência de `filterProjectContent` e `projectOverviewModel`.
- GREEN confirmado: os modelos tratam projeto carregando, erro, vazio e conteúdo real; a marcação da visão, filtros, estado assíncrono e drawer passou a satisfazer os contratos.

## Verificação

```text
node --test --test-concurrency=1 packages/studio/test/*.test.mjs
148 passed, 0 failed
```

Também foram executados `node --check` em `app.js`, `forms.js` e `studio-dashboard.js`, além de `git diff --check`, sem erros.

## Limite

A inspeção visual interativa final nos viewports 1440×900 e 390×844 será repetida pelo coordenador. O gate funcional está registrado em `.estado/shell-saas.md`.
