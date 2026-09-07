# Captura de formulários da Landing — estado incremental

**Objetivo:** uma Landing publicada pode ter vários formulários capturados pelo Studio. A identidade é `captureId`, nunca nome ou posição DOM.

## Incrementos implementados

1. **Persistência e runtime:** backend com UUID estável, schema congelado por versão, `page_submissions`, outbox/webhook por origem e validação por empresa/projeto/página/versão. A captura é independente dos pixels e demais destinos de tracking.
2. **Gateway e conteúdo:** caminhos de captura passam pelo mapa de conteúdos e gateway HTTP, com a origem resolvida pela publicação/snapshot. O fluxo integrado de banco + HTTP passou; o teste de quatro UUIDs persistidos após salvar/reabrir também passou.
3. **Leads e interface:** Leads/CSV unificados por `sourceKind`, `sourceId`, `sourceVersionId` e `captureId`, com rótulos de campos históricos; nomes de conteúdo usam o valor atual quando a versão não tem nome. O frontend filtra quizzes, landing pages e capturas no bloco **“Conteúdos do projeto”**, reutilizando a UI existente e sem redesenho.

## Evidência de fechamento deste bloco

- A revisão independente `/tmp/alva-capture-final-review.md` aprovou o bloco; o status do webhook foi corrigido com consulta à fila.
- A suíte full com Node 24.17.0 concluiu 574 testes aprovados, 0 falhas e 0 skips em 42.602,97325 ms; log em `/tmp/alva-capture-suite-release.log` e exit 0. Esse run ocorreu antes dos últimos ajustes de acesso/modo Leads; depois deles, os testes focados passaram 6/6, o `node --check` passou e a QA manual confirmou o fluxo.
- O servidor do Studio foi reiniciado na sessão 51020, as migrações aditivas 019/020 foram aplicadas e `/health/ready` respondeu 200. O banco local não foi reiniciado.
- A QA no navegador confirmou o clique em LEADS → lista, título e origem, seleção de quiz, link CSV e retorno para “Conteúdos do projeto”. Quatro UUIDs de captura permaneceram após salvar/reabrir.
- O ambiente do usuário tem 0 leads; dados fictícios foram validados em banco descartável + HTTP.

## Trabalho restante

- Publicar na Vercel e validar egress real. Antes do deploy, separar a impressão de conteúdo comparável do `snapshotHash` de deploy: `PublicationService.production` compara `preview.snapshotHash` com o hash de produção, e os testes read-only confirmaram que a mesma fórmula com nonce HTML por ambiente gera hashes diferentes. O isolamento do `SnapshotHMAC` deve permanecer.
- Fechar o quiz compartilhando o editor e continuar as etapas 7–18.
- Não há afirmação de produção externa, V1 certificada ou comparação de screenshots arquivada.

O plano não declara idempotência HTTP.
