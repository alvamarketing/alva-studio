# Relatório da Task 2 — bloco VSL no editor de landing pages

## Implementação

- Adicionado o bloco `VSL` à categoria `Mídia`, com estado inicial “Escolha uma VSL publicada” e ícone próprio.
- Criado o componente GrapesJS `vsl`: o estado mantém `type: 'vsl'` e `publicId`, enquanto o canvas renderiza a prévia visual em um iframe efêmero com `${PUBLIC_ORIGIN}/embed/v/:publicId`.
- O editor carrega `GET /projects/:projectId/videos` somente com `video.read` e filtra VSLs sem versão publicada. A seleção e edição da referência exigem `page.write`; `video.write` não é consultado.
- Referências inválidas permanecem visíveis com mensagem simples para correção. URLs, CTA, configuração e versão não são copiados para o estado do consumidor.
- Mantida a compatibilidade com páginas GrapesJS/legadas; atributos extras de uma referência carregada são reduzidos ao identificador público.

## TDD e validação

1. RED — `node --test packages/studio/test/editor-controls.test.mjs`
   - Falhou antes da implementação porque os novos exports do contrato do bloco ainda não existiam.
2. GREEN — `node --test packages/studio/test/editor-controls.test.mjs packages/studio/test/project-content.test.mjs packages/studio/test/templates.test.mjs`
   - 29 testes, 29 passaram, 0 falharam.
3. Sintaxe — `node --check packages/studio/public/editor-shell.js packages/studio/public/app.js packages/studio/public/templates.js`
   - Sem erros.
4. Higiene — `git diff --check`
   - Sem erros.

### Verificação de regressão

- `node --test packages/studio/test/*.test.mjs`: 224 testes, 224 passaram, 0 falharam.
