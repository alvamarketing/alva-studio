# Task 6 — eventos comerciais NVS

## Entrega

- A submissão persistida cria `lead` na outbox transacional, com o
  `tracking_event_id` da submissão e propriedade derivada do ambiente publicado.
- Contato é normalizado e convertido em SHA-256 somente no servidor; a fila e o
  painel não carregam respostas, IP ou user-agent.
- A fila tem deduplicação por propriedade/evento/destino, lease, backoff,
  tentativas e estado `dead`, com erros reduzidos antes de persistir.
- Eventos VSL recebem UUID no browser uma única vez por emissão; o gateway
  valida-o, não o encaminha ao Umami e o reutiliza na outbox NVS. O browser não
  informa empresa, projeto, propriedade nem destino.
- Origens repetidas de deployments READY no mesmo ambiente são tratadas como
  uma origem; somente preview+production para a mesma origem é ambíguo.
- Produtores internos transacionais aceitam `initiate_checkout` e `purchase`
  somente com UUID já persistido pelo registro servidor e `transaction_id`,
  valor finito não-negativo e moeda ISO. A Task 9 deve conectá-los aos pontos
  reais de checkout e webhook de pagamento; até lá não há evento financeiro
  de produção.
- O painel Conversões requer `analytics.read` e mostra apenas evento, ambiente,
  status, tentativas e erro sanitizado.

## Validação

- `node --test packages/studio/test/nvs-commercial-outbox.test.mjs packages/studio/test/umami-gateway.test.mjs` — 8 pass, 0 fail.
- Integração descartável NVS 0.3.10 + MariaDB (`alva-task6-final`) — `PASS: NVS hardened integration`, incluindo hash pré-normalizado e evento VSL interno.
- Após o ajuste visual final, `pnpm test:studio` — 433 pass, 0 fail.
- `php -l runtime/nvs/alva/bootstrap.php` e `git diff --check` passaram. As imagens e recursos efêmeros `alva-task6-nvs-*` foram removidos.

## Interface

O painel reutiliza a estrutura e tokens do wireframe. Uma prévia SaaS isolada com conta, empresa, projeto e conversões fictícios foi validada no navegador em 919×863: as linhas de Lead e VSL exibiram ícone, ambiente, estado, tentativa e erro em regiões legíveis, com rótulos completos na árvore de acessibilidade. A validação formal do produto em 1440×900 e 390×844 permanece no gate visual da Task 11.

## Fix round 2 — origem repetida no mesmo ambiente (2026-09-06)

- Corrigida `ContentRepository.publicationEnvironment` para usar `UNION`, deduplicando a mesma origem encontrada em domínio verificado e deployment READY do mesmo ambiente.
- Adicionado teste com PostgreSQL real: referências preview duplicadas retornam `preview`; a mesma origem em preview e production retorna `null` e preserva a recusa da conversão.
- Validação: `node --test packages/studio/test/nvs-commercial-outbox.test.mjs` — 6 pass, 0 fail; `git diff --check` — limpo.

## Ajuste visual — lista de Conversões (2026-09-06)

- Itens de conversão agora reutilizam `project-content-row`, com ícone, evento, ambiente, estado traduzido, tentativa e erro em linha própria; nenhum identificador técnico é exibido.
- Filtros móveis usam faixa horizontal compacta e uniforme, sem forçar o sexto item a ocupar uma linha isolada.
- Teste estrutural/acessível adicionado em `studio-dashboard.test.mjs`.
- Validação: `node --test packages/studio/test/studio-dashboard.test.mjs` — 27 pass, 0 fail; `git diff --check` — limpo.

## Fechamento

- Integração real descartável NVS 0.3.10 + MariaDB: aprovada.
- Suíte Studio final: 433/433.
- Sintaxe Node/PHP, `git diff --check`, scan de arquivos sensíveis e limpeza dos recursos descartáveis: aprovados.
- Revisão independente final: Spec ✅; Quality Approved; nenhum P0, P1 ou P2.
