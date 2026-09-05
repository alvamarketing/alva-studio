# Relatório da correção final — Task 5

## Contrato de origem da VSL

- O salvamento de página agora envia `editor.getHtml()`, mantendo o HTML bruto do editor e o marcador canônico `data-alva-vsl` no banco.
- `exportHtml()` continua materializando a VSL com `window.location.origin` somente para preview e download locais.
- A publicação resolve referências públicas a partir do `editor_state`/schema e reescreve tanto marcadores quanto iframes VSL previamente materializados para a origem validada no servidor (`PUBLIC_ORIGIN`). Uma origem do cliente nunca é reutilizada no snapshot publicado.

## Regressões cobertas

- HTML exportado no cliente usa uma origem diferente e não mantém o marcador materializado.
- Salvar, reabrir e atualizar a página preserva o marcador canônico.
- Snapshot com iframe já materializado no cliente produz somente o embed da origem pública do servidor.
- Preview e download continuam usando a exportação materializada.

## Verificação

- Focais: `node --test test/project-content.test.mjs test/publication-snapshot.test.mjs test/editor-controls.test.mjs` — 43/43 passaram.
- Suíte serial: `npm test -- --test-concurrency=1` — 255/255 passaram.
- Sintaxe: `node --check` nos módulos alterados — passou.
- Higiene: `git diff --check` — passou.

A validação visual com mídia real e publicação em destino conectado permanece limitada ao ambiente de testes; a cobertura automatizada valida o contrato de origem, persistência, preview/download e snapshot server-side.
