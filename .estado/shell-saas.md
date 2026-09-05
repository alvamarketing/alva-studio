# Gate funcional — shell SaaS

Data: 2026-09-04

- Suíte: `node --test --test-concurrency=1 packages/studio/test/*.test.mjs`
- Resultado: 148 testes aprovados, 0 falhas.
- Sintaxe: `node --check` em `app.js`, `forms.js` e `studio-dashboard.js`; `git diff --check` sem apontamentos.
- Viewports cobertos pelo contrato responsivo: desktop 1440×900 e celular 390×844. O shell mantém a barra lateral no desktop e usa drawer no celular, com superfícies em uma coluna e controles mínimos de 44 px.
- Acessibilidade coberta: foco visível, navegação com `aria-current`, estados com `role="status"`/`role="alert"`, Escape fecha o drawer e devolve foco ao botão que o abriu. Diálogos nativos devolvem foco ao acionador ao fechar.

## Limitação conhecida

A inspeção visual interativa final nos dois viewports será repetida pelo coordenador; este registro comprova o gate funcional automatizado e as regras de layout implementadas.
