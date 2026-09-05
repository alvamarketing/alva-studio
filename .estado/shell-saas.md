# Gate do shell SaaS — aprovado

Data: 2026-09-05

- Suíte: `node --test --test-concurrency=1 packages/studio/test/*.test.mjs`
- Resultado: 153 testes aprovados, 0 falhas.
- Sintaxe: `node --check` em `app.js`, `forms.js` e `studio-dashboard.js`; `git diff --check` sem apontamentos.
- Viewports inspecionados com o servidor SaaS real e PostgreSQL efêmero: desktop 1440×900 e celular 390×844. Home, Empresa, Projeto e Landing pages não apresentaram overflow horizontal. O shell mantém a barra lateral no desktop e usa drawer no celular, com superfícies em uma coluna e controles mínimos de 44 px.
- Acessibilidade coberta: foco visível, navegação com `aria-current`, estados com `role="status"`/`role="alert"`, Escape fecha o drawer e devolve foco ao botão que o abriu. Quando fechado, o drawer usa `inert` e `aria-hidden`; aberto, prende Tab e Shift+Tab. Diálogos nativos devolvem foco ao acionador ao fechar.
- Verificação comportamental no celular: aberto com `is-open`, `aria-hidden=false`, `inert=false` e `aria-expanded=true`; após Escape, sem `is-open`, `aria-hidden=true`, `inert=true`, `aria-expanded=false` e foco devolvido a `#mobile-menu`.
- Revisão independente final: aprovada após a correção do estado visual do drawer.
