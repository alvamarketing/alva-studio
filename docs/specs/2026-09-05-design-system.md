# Sistema de design do Alva Studio — desenho

> "Uma pasta só de CSS onde estão todos os elementos, todas as cores, todas as maneiras de construir; tudo que for construído usa ela como base; como é feito um campo de texto, quais ícones são usados; assim a gente garante a unidade e as coisas não se perdem." — decisão do dono, 05/09/2026.

O `AGENTS.md` já declara o wireframe como **contrato visual**, não inspiração. Esta spec transforma esse contrato em código compartilhado.

## O tamanho real do buraco

Medido no repositório hoje, não estimado:

- O CSS do wireframe tem **23.764 bytes**, em **dois** blocos `<style>` (20.949 + 2.815). Os 70 KB são o HTML inteiro, com marcação e conteúdo de exemplo.
- O wireframe usa **161 classes**. Os quatro CSS do app usam **246**. **Apenas 15 são as mesmas**: `button`, `primary`, `ghost`, `icon-button`, `nav-item`, `surface`, `surface-head`, `eyebrow`, `chart`, `journey`, `analytics-card`, `project-columns`, `project-switcher`, `material-symbols-outlined`, `vsl-preview`.
- Ou seja: **146 classes do contrato visual não existem no produto** — entre elas `.member-row`, `.usage-bar`, `.plan-hero`, `.settings-nav`, `.project-sidebar`, `.project-rule`, `.stage-row`, `.status-pill`, `.tree-row`, `.option-card`, `.vsl-step`, `.token-set`, `.segmented`, `.field`, `.control`, `.toggle`.
- Os quatro CSS somam **1.041 valores `px` literais** e **46 cores literais**; há **76 cores literais no JS**, das quais 74 em `templates.js`.
- O wireframe usa **54 ícones** Material Symbols distintos; o app renderiza **21**.
- Contagens medidas em 05/09/2026 sobre a árvore de trabalho. Elas se movem enquanto outros nós estão em andamento — recontar antes de usar como linha de base do teste de literais.

"Empresa e equipe" (`owner.js` + `owner.css`) diverge do wireframe porque a seção inteira depende de `.plan-hero`, `.usage-bar`, `.member-row` e `.settings-nav` — nenhuma delas existe. Não é desalinhamento de detalhe: é uma tela construída sem as peças.

### Conflitos de token — decididos pelo dono em 05/09/2026

**O wireframe vence sempre.** Não há teste de contraste condicionando nada; os valores abaixo são os do sistema:

1. **Cor de linha** — `--alva-line: #e1e7ef` (era `#e7ecf3`).
2. **Cor de fundo** — `--alva-cloud: #f6f8fb` (era `#f7f9fc`).
3. **Azul de superfície** — `--alva-surface-alt: #edf4ff` (era `#eef4ff`).
4. **Verde de sucesso** — `--alva-positive: #20a464` (era `#198044`).
5. **Vermelho de erro** — `--alva-negative: #e5484d` (era `#ba3535`).
6. **Família tipográfica** — `--font-sans: Inter` (era Instrument Sans). Inter é a fonte canônica do produto.
7. **Raio** — **um só, 12px**, como no wireframe. A escala de quatro do app (botão 12, campo 14, cartão 20, seção 28) é substituída, não herdada. Decisão tomada, não divergência aberta.

Os **nomes** continuam `--alva-*`: eles já sustentam 246 classes e o tema escuro, e `--blue`/`--ink` são genéricos demais para um arquivo compartilhado. Muda o valor, não o nome.

Regra fechada: **valores vêm do wireframe, nomes vêm do app, sem exceção.**

**O app tem tema escuro (`styles.css`, `:root[data-color-scheme='dark']`) e o wireframe não tem.** O tema escuro não se perde: ele passa a ser parte do sistema, e cada token novo nasce com os dois valores. Perder o escuro seria regressão, não simplificação.

---

## 1. A pasta `packages/studio/public/design/`

```
design/
  tokens.css       cor, tipografia, espaçamento, raio, sombra, motion — só custom properties
  components.css   toda peça visual, com todos os estados
  icons.mjs        allowlist de ícones + helper de marcação
  behavior.mjs     só o comportamento que CSS não faz
  README.md        como usar, como propor peça nova
```

**`tokens.css`** — o único arquivo do produto onde uma cor ou uma medida aparece como literal. Contém `:root` (claro) e `:root[data-color-scheme='dark']`, com os mesmos nomes. Além das cores já existentes, formaliza o que hoje está espalhado em 1.041 literais: escala de espaçamento (`--space-1` a `--space-8`), escala tipográfica (`--text-display`, `--text-title`, `--text-body`, `--text-small`, `--text-eyebrow`, cada um com tamanho, peso e altura de linha), o raio único, sombras e `--motion`. Nada de seletor de elemento aqui.

**`components.css`** — a peça e todos os seus estados. O wireframe mostra quase só o estado normal: o arquivo inteiro tem **uma única regra `:hover` e nenhuma `:focus`**. O sistema tem de completar isso, e completar é decisão de design, não improviso de quem implementa. Cada peça abaixo entrega **normal, foco visível, erro, desabilitado e carregando**:

- **Botões** — `.button` com `.primary`, `.ghost`, `.dashed`, e `.icon-button`. Vindos de "Botões" na Biblioteca visual.
- **Campos** — `.field` (rótulo + controle), `.control` para `input`, `textarea` e `select`, e `.toggle`. Vindos de "Campos". É a resposta literal ao "como é feito um campo de texto".
- **Seleção** — `.vsl-choice` / `.segmented`: grupo de botões com um ativo, usado no Tipo e na Proporção da VSL e em qualquer escolha curta.
- **Item da árvore** — `.tree`, `.tree-row` com `.parent`, `.child`, `.active`, `.drag`, `.type-icon`. Vindo de "Item da árvore".
- **Opção visual** — `.option-edit`, `.option-card`, `.avatar`. Vindo de "Opção visual".
- **Cartão** — `.surface` e `.surface-head`, as duas que já existem nos dois lados e viram a base de todo bloco.
- **Pílula de status** — `.status-pill`, com variação neutra, positiva, atenção e negativa.
- **Barra de uso** — `.usage`, `.usage-head`, `.usage-bar`. Consumida por "Empresa e equipe" e pela gestão de empresas do superadmin.
- **Linha de membro** — `.member-row`, `.member-avatar`, `.role`.
- **Navegação lateral** — `.project-sidebar`, `.nav-item`, `.nav-label`, `.side-footer`, `.settings-nav`, `.project-switcher`.
- **Cabeçalhos** — `.eyebrow`, `.project-heading`, `.home-header`, `.section-title`, `.helper`.

**`icons.mjs`** — conjunto único, Material Symbols Outlined, já servido pela fonte que a CSP autoriza (`content-security-policy.mjs` libera `fonts.googleapis.com` e `fonts.gstatic.com`). Exporta `ICONS`, a lista fechada dos nomes permitidos — os 55 do wireframe mais os do app que ainda não têm equivalente lá — e um helper que monta `<span class="material-symbols-outlined">`. Ícone fora da lista é erro de teste, não escolha de quem implementa. Dois ícones para a mesma ideia (`folder` e `folder_open` e `folder_special`) só coexistem se significarem coisas diferentes, e o README diz qual é qual.

**`behavior.mjs`** — o mínimo. Hoje só duas coisas pedem JS: o grupo de seleção (mover o `.active`, `aria-checked`, navegação por seta) e o `.toggle` (`aria-pressed`). Tudo o mais é CSS. Se este arquivo crescer, é sinal de que uma peça foi mal desenhada.

**Restrição descoberta e que muda a forma da entrega.** As páginas públicas de formulário **não podem linkar `/design/tokens.css`**: `server/dynamic-form.mjs` embute todo o CSS numa constante e o snapshot publicado vai para a Vercel como HTML autocontido, servido em domínio do cliente. Então `tokens.css` e a parte de `components.css` que as páginas públicas usam precisam ser **consumíveis como arquivo e como string** — um módulo que exporta o texto, importado pelo `dynamic-form.mjs`, e um `.css` servido para o painel. Uma fonte, dois consumos. Sem isso, o público e o privado divergem de novo em um mês.

---

## 2. A "Biblioteca visual" viva, dentro do app

Rota autenticada dentro da SPA (uma `<section>` como as outras em `public/index.html`, alcançável pelas Configurações), reproduzindo a seção **"Biblioteca visual"** do wireframe: Tipografia, Botões, Cores, Campos, Item da árvore, Opção visual — mais os cartões das peças que o wireframe não isolou (status, barra de uso, linha de membro, navegação, cabeçalhos), e **cada peça mostrada em todos os seus estados**.

Ela não é documentação: é a superfície de verificação. A regra do `AGENTS.md` pede screenshot lado a lado com o wireframe; a Biblioteca viva é o lado esquerdo dessa comparação, para todas as peças de uma vez, em vez de uma tela por vez. É autenticada porque não tem dado de empresa nenhum, mas também não precisa estar exposta.

Fecha com a `legend-note` do próprio wireframe: *"árvore organiza, canvas mostra o resultado e inspetor edita. Um componente não repete a função de outro painel."*

---

## 3. Regra de composição

1. **Tela nova usa só classes de `design/`.** Nenhuma tela declara cor, tamanho, raio ou sombra.
2. **Peça que não existe entra primeiro na biblioteca**, com aprovação do dono, e só depois é usada. É a mesma regra que o `AGENTS.md` já aplica a token — agora vale para componente.
3. **Literal é proibido fora de `design/`.**

### Como isso é testado, e por que não pode ser um teste que só falha

Um teste que varre `public/*.css` e `public/*.js` procurando `#rrggbb` e `Npx` fora de `design/` encontraria **mais de mil ocorrências no primeiro dia** e ficaria vermelho para sempre — o que na prática significa desligado. O desenho é outro:

- `test/design-tokens.test.mjs` varre `public/**/*.css` e `public/**/*.js`, ignora `public/design/`, e compara o resultado com `test/fixtures/design-baseline.json`, que registra a contagem por arquivo.
- **Arquivo novo entra com zero.** Arquivo existente pode diminuir, nunca aumentar. Aumentou, o teste falha e diz qual arquivo e quanto.
- Cada migração de tela derruba um pedaço da baseline. Quando todos os arquivos chegam a zero, a baseline é apagada e a regra vira absoluta.
- **Exceções que precisam estar escritas, não descobertas:** `public/design/tokens.css` (é lá que os literais moram) e `public/templates.js` (são modelos de landing page — conteúdo do cliente, não interface do produto; os 66 hex de lá não são dívida de design).

---

## 4. Migração das telas existentes

Uma tela por vez, por seção do wireframe, cada uma com verificação visual em navegador e screenshot, como exige o `AGENTS.md`. **As classes antigas coexistem com as novas até a última migração**, e só então `styles.css`, `editor-shell.css`, `forms.css` e `owner.css` perdem o que sobrou. Nada sai do ar no meio.

Ordem proposta, do menos acoplado ao mais acoplado:

1. **Biblioteca visual** — a própria fonte, primeiro. Sem ela as outras não têm com o que comparar.
2. **"Empresa e equipe"** (`owner.js`, `owner.css`) — a mais divergente e a menos acoplada; nenhum editor depende dela. É onde `.plan-hero`, `.usage-bar`, `.member-row` e `.settings-nav` nascem de verdade.
3. **Home** — "Histórico", `.square-projects`, `.quick-grid`.
4. **Projeto** — "Conteúdos do projeto", "Estrutura do projeto", "Visitas nos últimos 7 dias".
5. **"Configure sua VSL"** — já tem plano próprio; ver §5.
6. **Editores** (`editor-shell.css`, 12,9 KB) — árvore, canvas e inspetor. O maior e o mais acoplado, por último no painel.
7. **Páginas públicas de formulário** (`forms.css` e o CSS embutido em `dynamic-form.mjs`) — separado dos demais porque é HTML servido e publicado, e porque é aqui que a forma "CSS como string" da §1 é exercitada.

---

## 5. Impacto nos nós em andamento

Três frentes desenham tela agora, e todas passam a depender de `design_system`. Isso tem um custo que precisa ser dito em vez de escondido: **fazer um nó em execução depender de um nó que ainda não existe ou o bloqueia, ou é mentira.** A saída honesta:

- **`tracking_coletor`, Task 10 ("Visitas nos últimos 7 dias")** — está em execução hoje. Se `design_system` não estiver pronto quando ela chegar, ela entrega com as classes atuais e a dívida entra explicitamente no `.estado/tracking_coletor.md`; a tela é migrada no item 4 da §4. Não vale segurar o nó.
- **`plataforma_superadmin`** — a aba *Armazenamento* e a gestão de empresas consomem `.usage`, `.usage-bar`, `.member-row` e `.settings-nav`, exatamente as peças que o item 2 da §4 cria. Ordenar `design_system` antes dele economiza construir essas peças duas vezes.
- **Mídia, Task 8 ("Configure sua VSL")** — já vai converter `<fieldset><legend>` em `section.vsl-step`, `<select>` em `.vsl-choice` e o chip `.vsl-step-number`. **Essas três peças pertencem ao sistema, não à tela.** Se `design_system` sair antes, a Task 8 consome; se sair depois, a Task 8 as cria e o sistema as absorve — e nesse caso a spec de mídia é a fonte, não o contrário.

Regra geral: `design_system` **não** vira dependência retroativa de nó já `feito`. Ele é dependência dos nós de migração, e os nós em execução registram a dívida.

---

## 6. Nós propostos para o grafo

Texto para o dono aplicar em `produto/grafo.yaml` — **não editado aqui**. Tipos conforme o esquema real do `vibe` (`comando`, `arquivo` ou `tela`; `espera` só aceita `exit N` ou `contem: …`).

```yaml
  - id: design_system
    estado: pendente
    faz: Criar a pasta public/design com tokens, componentes com todos os estados, allowlist de icones e a Biblioteca visual viva
    depende:
      - editores_saas
    produz: tokens.css com os valores do wireframe e raio unico, components.css, icons.mjs, behavior.mjs, pagina Biblioteca visual e teste de baseline de literais
    passa_quando:
      tipo: comando
      comando: node --test packages/studio/test/design-tokens.test.mjs packages/studio/test/design-library.test.mjs
      espera: exit 0

  - id: design_migracao_painel
    estado: pendente
    faz: Migrar Empresa e equipe, Home e Projeto para as classes do sistema, sem quebrar o que esta no ar
    depende:
      - design_system
    produz: Tres telas do painel usando so classes de design/, com baseline de literais reduzida
    passa_quando:
      tipo: arquivo
      caminho: .estado/design_migracao_painel.md
      casa: "Prova: tres telas migradas, tokens do wireframe e raio unico, baseline reduzida, screenshots conferidos, [0-9]+ testes verdes"

  - id: design_migracao_editores
    estado: pendente
    faz: Migrar os editores de pagina e formulario e a tela Configure sua VSL
    depende:
      - design_migracao_painel
    produz: Arvore, canvas, inspetor e configuracao de VSL sobre o sistema
    passa_quando:
      tipo: arquivo
      caminho: .estado/design_migracao_editores.md
      casa: "Prova: editores migrados, tokens do wireframe e raio unico, baseline reduzida, screenshots conferidos, [0-9]+ testes verdes"

  - id: design_publico
    estado: pendente
    faz: Levar tokens e componentes as paginas publicas de formulario, que embutem CSS e nao podem linkar arquivo
    depende:
      - design_migracao_editores
    produz: Fonte unica consumida como arquivo no painel e como string no dynamic-form, baseline zerada e CSS antigo removido
    passa_quando:
      tipo: comando
      comando: node --test packages/studio/test/design-tokens.test.mjs packages/studio/test/dynamic-form.test.mjs
      espera: exit 0
```

### Dry-run do `vibe`: os quatro nós foram conferidos, não presumidos

`produto/` foi copiado para um diretório temporário, os quatro nós acima inseridos lá tal como estão escritos, e o `vibe` rodado sobre a cópia. A pasta `produto/` real não foi tocada.

- **`vibe proximo`** aceitou o grafo com 18 nós e devolveu: `tracking_coletor, midia_cdn, design_system`. `design_system` entra liberado, porque `editores_saas` já está feito.
- **`vibe conferir <id> --antes`** registrou vermelho nos quatro, como esperado. Nenhum campo foi rejeitado pelo esquema: os dois nós `comando` passaram na validação de `espera: exit 0`, e os dois `arquivo` passaram na exigência de `caminho` + `casa`.
- Ressalva honesta sobre o vermelho dos nós `comando`: ele saiu como `Could not find 'packages/studio/test/design-tokens.test.mjs...'`. Isso prova que o **arquivo** não existe, não que o **comportamento** falta. Quem implementar deve criar o teste falhando primeiro e regravar o vermelho, para que o verde seguinte signifique alguma coisa.

### Fases e critérios de aceite testáveis

| Fase | Nó | Aceite |
| --- | --- | --- |
| 1 | `design_system` | `tokens.css` declara todo token nos dois temas, com os seis valores do wireframe e um único raio de 12px, e um teste falha se algum voltar ao valor antigo ou se aparecer um segundo raio; `components.css` entrega as onze peças com os cinco estados; `icons.mjs` recusa nome fora da lista; a Biblioteca visual renderiza todas as peças em todos os estados; a baseline de literais existe e o teste falha quando um arquivo aumenta. |
| 2 | `design_migracao_painel` | As três telas não têm nenhum literal próprio; screenshot lado a lado por seção do wireframe, em desktop e 375 px; o tema escuro continua correto nas três; nenhuma classe antiga foi removida ainda. |
| 3 | `design_migracao_editores` | Idem, mais: a árvore mantém foco e navegação por teclado que `editores_saas` já garantiu. |
| 4 | `design_publico` | A página pública e o painel renderizam a mesma peça a partir da mesma fonte; baseline zerada e apagada; os quatro CSS antigos removidos; nenhuma página publicada quebrou. |

### Riscos

1. **A migração parar no meio.** Quatro CSS antigos convivendo com o sistema é pior que qualquer um dos dois sozinho. A baseline que só encolhe é o que torna o meio-do-caminho visível; se ela ficar parada por semanas, isso é o sinal.
2. **Acessibilidade de sucesso e erro.** Os tons do wireframe (`#20a464`, `#e5484d`) são mais claros que os antigos do app e, em texto pequeno sobre branco, podem ficar abaixo de WCAG AA. Isso não reabre a escolha do token: é um risco de leitura a acompanhar na Biblioteca visual, onde as pílulas de status aparecem em todos os estados e o problema, se existir, fica visível.
3. **O tema escuro ser esquecido.** O wireframe não o tem; o produto tem. Cada peça nova nasce com os dois valores, e a Biblioteca visual precisa ser conferida nos dois temas.
4. **A regra virar burocracia.** Se propor peça nova for lento, as telas voltam a inventar classe. O README precisa dizer em quantos passos se propõe uma peça, e a resposta tem de ser "poucos".
5. **`templates.js` ser tratado como dívida.** São modelos de landing page, conteúdo do cliente. Varrer aquilo em busca de token seria quebrar o produto para satisfazer um teste.
