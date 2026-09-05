# Task 4 — Projeto, conteúdos e responsividade

## Entrega

- A seleção de projeto abre uma visão geral alimentada por `GET /api/projects/:id/overview`.
- A tela mostra nome, slug, domínio verificado, contagens reais, estado de publicação, respostas de formulários e conteúdos unificados.
- Os filtros de Visão geral, Landing pages e Formulários mantêm o conteúdo autorizado e cada linha abre o editor correspondente já existente.
- Analytics, Rastreamento, Publicação e Agentes expõem somente seus estados públicos: “Configurado”, “Ainda não configurado” ou “Em breve”.
- A barra lateral torna-se drawer no celular. Fechada, fica inerte e oculta à árvore de acessibilidade; aberta, prende Tab e Shift+Tab. Escape, backdrop e navegação fecham o drawer e devolvem o foco ao botão que o abriu.
- O servidor público entrega todo o grafo de imports do app. O comando padrão inicia o SaaS com PostgreSQL obrigatório, migra antes de escutar e fecha a conexão ao encerrar; o JSON ficou em `start:legacy` para migração e rollback.
- Papéis sem `page.write` ou `form.write` veem somente o estado de leitura, sem ações de edição falsas.
- A interface usa uma coluna no celular, evita overflow horizontal e mantém controles interativos de pelo menos 44 px.

## TDD

- RED confirmado: os testes novos falharam pela ausência de `filterProjectContent` e `projectOverviewModel`.
- GREEN confirmado: os modelos tratam projeto carregando, erro, vazio e conteúdo real; o controlador de drawer trata foco e teclado; o smoke HTTP percorre os imports efetivamente servidos.

## Verificação

```text
node --test --test-concurrency=1 packages/studio/test/*.test.mjs
153 passed, 0 failed
```

Também foram executados `node --check` em `app.js`, `forms.js` e `studio-dashboard.js`, além de `git diff --check`, sem erros.

## Limite

A inspeção visual interativa final nos viewports 1440×900 e 390×844 ainda é necessária. `shell_saas` foi devolvido a `pendente` até a homologação do coordenador.

## Fix round 1

- O mapa estático passou a entregar os quatro módulos que o app importa diretamente e o smoke HTTP percorre o grafo de imports até confirmar cada resposta.
- O comando padrão do pacote agora inicia o SaaS: exige `DATABASE_URL`, cria a conexão, migra antes de servir e fecha o pool no desligamento ou se o boot falhar. O modo JSON permanece somente em `start:legacy`.
- O drawer móvel usa `inert` e `aria-hidden` fechado; aberto, mantém Tab e Shift+Tab dentro dele. Navegação, backdrop e Escape o fecham, e Escape devolve foco ao acionador.
- Ações de editar/duplicar/excluir de páginas e formulários só aparecem para papéis com a capacidade de escrita correspondente. Os demais veem “Somente leitura”.
- Foram adicionados testes do grafo HTTP, sequência/erro de boot SaaS, capacidades por tipo de conteúdo e controlador do drawer.

Verificação do fix: `node --test --test-concurrency=1 packages/studio/test/*.test.mjs` — 153 aprovados, 0 falhas.
