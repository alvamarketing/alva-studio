# Fidelidade visual ao wireframe

- Estado: concluído e aprovado em 2026-09-06.
- Referência canônica: `docs/wireframes/alva-studio-ui-reference.html`.
- Plano: `docs/plans/2026-09-06-wireframe-fidelity-plan.md`.
- Decisão: o wireframe é contrato visual, não inspiração.
- Blocos concluídos: design system/Home/Projeto; landing; quiz; configurações e listas.

## Decisões preservadas

- O conteúdo real das páginas e quizzes permanece intacto; os exemplos do wireframe definem o shell, a hierarquia e os componentes, não substituem dados do usuário.
- A página de Configurações mantém a navegação lateral prevista na seção canônica correspondente.
- A Biblioteca visual é a fonte do design system e não aparece como rota comercial.
- A VSL permanece preservada como V2 e oculta enquanto a flag estiver desligada.

## Gates independentes

- Quiz: aprovado em `/tmp/alva-ui-rereview-quiz.md`.
- Landing: aprovado em `/tmp/alva-ui-rereview-landing-r2.md`.
- Home e Projeto: aprovado em `/tmp/alva-ui-rereview-dashboard-r2.md`.
- Shell e listas: aprovado em `/tmp/alva-ui-rereview-shell-lists-r2.md`.
- Configurações: aprovado em `/tmp/alva-ui-rereview-settings-r4.md`.
- Overflow e cabeçalhos responsivos: aprovado em `/tmp/alva-ui-review-overflow-r3.md`.
- Verificação visual integrada: desktop aprovado; as duas falhas mobile encontradas foram corrigidas e aprovadas em `/tmp/alva-ui-mobile-final-review.md`, com conferência em 433 px e 355 px.
- Navegação da Home com projeto ativo: aprovada em `/tmp/alva-home-integrations-review-r2.md`; menu confirmado no navegador com Visão geral, Páginas, Quizzes, Analytics, Rastreamento, Publicação e Agentes.

## Verificação final

- `pnpm test:studio`: 530 testes aprovados, 0 falhas após a correção final da navegação.
- `git diff --check`: aprovado.
- Relatórios: `/tmp/alva-ui-full-tests-final.md` e `/tmp/alva-home-integrations-full-tests.md`.
