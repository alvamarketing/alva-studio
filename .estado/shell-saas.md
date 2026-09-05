# Gate do shell SaaS — pendente de inspeção visual

Data: 2026-09-04

- Suíte: `node --test --test-concurrency=1 packages/studio/test/*.test.mjs`
- Resultado: 153 testes aprovados, 0 falhas.
- Sintaxe: `node --check` em `app.js`, `forms.js` e `studio-dashboard.js`; `git diff --check` sem apontamentos.
- Viewports cobertos pelo contrato responsivo: desktop 1440×900 e celular 390×844. O shell mantém a barra lateral no desktop e usa drawer no celular, com superfícies em uma coluna e controles mínimos de 44 px.
- Acessibilidade coberta: foco visível, navegação com `aria-current`, estados com `role="status"`/`role="alert"`, Escape fecha o drawer e devolve foco ao botão que o abriu. Quando fechado, o drawer usa `inert` e `aria-hidden`; aberto, prende Tab e Shift+Tab. Diálogos nativos devolvem foco ao acionador ao fechar.

## Limitação conhecida

A inspeção visual interativa final nos dois viewports ainda é necessária para Home, Empresa, Projeto, página e formulário. Até essa homologação, `shell_saas` permanece pendente.
