# Correção de origem da VSL

## Escopo

Correção implementada a partir do `HEAD 17db316` para manter `rendered_html` como documento canônico completo (doctype, CSS e JavaScript), preservando marcadores `data-alva-vsl` até a publicação.

## Evidência RED

Os testes adicionados foram executados antes da implementação:

- `editor-controls.test.mjs`: 25 passaram, 2 falharam. `buildPageExportHtml` materializou o iframe mesmo com `materializeVsl: false`; o salvamento ainda não usava documento canônico e a miniatura ainda atribuía o HTML bruto diretamente ao `srcdoc`.
- `publication-snapshot.test.mjs`: 10 passaram, 1 falhou. Um iframe legado `alva-vsl-frame` com publicId conhecido manteve a origem do cliente.

As falhas foram reproduzidas com mensagens assertivas sobre esses comportamentos, antes de qualquer alteração de produção.

## Implementação

- `buildPageExportHtml` aceita `materializeVsl` explícito; `false` preserva o marcador e mantém CSS/JS/doctype.
- O salvamento usa um documento canônico completo; preview e download continuam materializando com a origem local.
- Miniaturas materializam o HTML salvo antes de atribuir `srcdoc`.
- Publicação substitui marcadores pelo embed baseado em `PUBLIC_ORIGIN` e reescreve apenas iframes legados com classe `alva-vsl-frame`, URL HTTP(S), caminho `/embed/v/<publicId>` conhecido e referência publicada resolvida. Iframes arbitrários permanecem intactos.

## Validação

- Focais: `editor-controls.test.mjs`, `publication-snapshot.test.mjs` e `project-content.test.mjs` — todos verdes.
- Suíte serial: `node --test --test-concurrency=1 packages/studio/test/*.test.mjs` — **257 testes passando, 0 falhas**.
- Sintaxe: `node --check` nos quatro módulos de produção alterados — passou.
- Integridade do patch: `git diff --check` — passou.

## Round 1 — proteção do tokenizador

### Evidência RED

Os testes de regressão para comentários, `script`, `style`, `template`, `textarea` e `title` falharam antes da correção: o renderer global substituiu marcadores literais e iframes dentro dessas regiões. O caso equivalente de publicação também alterou strings protegidas no snapshot.

### Correção

`packages/studio/vsl-html.js` passou a concentrar um tokenizador conservador compartilhado pelo cliente e pelo servidor. Ele preserva comentários e raw text integralmente, entende aspas em atributos, só substitui elementos reais completos e devolve HTML malformado sem transformação parcial. A publicação usa o mesmo caminho para o fallback de iframe legado, limitado a iframes reais com referência publicada conhecida. O módulo foi incluído no mapa HTTP do servidor para que o grafo de imports do app continue servível.

### Cobertura adicional

- marcador e iframe literal dentro de comentário, `script` e `style` preservados byte a byte;
- marcadores dentro de `template`, `textarea` e `title` preservados;
- nós reais antes e depois materializados nos dois lados;
- atributos sem fechamento e valores não quotados malformados preservados;
- CSS e JavaScript continuam íntegros.
- tags sem valor, atributos não quotados inválidos e tentativas de injeção são preservados sem substituição parcial.

### Validação da rodada

- Focais cliente, snapshot/publicação e servidor: **51 passando, 0 falhas**.
- Suíte serial após a correção: **261 testes passando, 0 falhas**.
- Grafo HTTP inclui `/vsl-html.js`; `node --check` e `git diff --check` passaram.
