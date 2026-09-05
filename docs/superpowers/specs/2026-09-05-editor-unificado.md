# Editor unificado: página, quiz e VSL sobre uma base comum — desenho

> "Página e quiz são quase idênticos: o que diverge é que um é em etapas e o outro é página única. Os elementos de cada página, a edição de tamanho, de fonte, de todo o resto, é praticamente igual — não precisaria criar do zero." — decisão do dono, 05/09/2026.

O `design_system` ([spec](2026-09-05-design-system.md)) unifica a **aparência**. Esta spec unifica a **função**: quais elementos existem, quais propriedades cada um aceita e quem edita isso. São problemas irmãos e o segundo depende do primeiro.

---

## 1. Diagnóstico: o que já é comum e o que está duplicado

### O que de fato compartilham

Quase nada de código. `public/templates.js` é o catálogo **só do editor de páginas**: `blocks` (`:136`) alimenta o GrapesJS, e `templateCss` (`:66`) é o CSS que vai para a página publicada. O quiz não importa nada dele. A única ponte real entre os três motores é a **referência de VSL** — `data-alva-vsl`, resolvida por `server/vsl-reference.mjs` tanto para páginas quanto para quizzes.

### O que está duplicado, com endereço

**Movimentos — a mesma lista de cinco, declarada em quatro lugares, com uma divergência que é bug.**

| Onde | Forma |
| --- | --- |
| `public/forms.js:31` | `MOTIONS` com rótulos, para o quiz |
| `server/form-store.mjs:12` | `MOTIONS` como `Set`, validação do quiz |
| `server/publication-snapshot.mjs:58` | `VSL_MOTION_VALUES`, **sem `'none'`** |
| `public/editor-shell.js` (seção "Movimento") | mesma lista, mais duração e atraso |

O CSS dos movimentos está escrito **duas vezes**: em `templates.js` (`[data-alva-motion='fade-up']` e os `@keyframes`) para páginas, e em `server/dynamic-form.mjs` (`.screen[data-active][data-motion=…]` e `.screen-element[data-motion=…]`) para o quiz.

> **Bug encontrado nesta análise.** Escolher "Sem movimento" num elemento de VSL dentro do quiz salva sem erro — `form-store.mjs:79` aceita `'none'` — mas a publicação falha com `Referência de VSL inválida.` (400), porque `canonicalVslReference` em `publication-snapshot.mjs:68` rejeita `'none'`. O formulário fica impublicável e a mensagem não diz por quê. Um catálogo único elimina a classe inteira desse defeito.

**Gráficos — duas implementações que não se parecem.** Páginas: blocos `bar-chart` e `donut-chart` em `templates.js:136+`, com CSS `.alva-chart`, `.alva-chart-bars`, `.alva-donut`. Quiz: função `chart()` em `server/dynamic-form.mjs:16-26`, com CSS `.chart-bar`, `.chart-donut`, cores próprias em array literal. Mesmo conceito, zero código em comum.

**Ícones — três listas.** `public/forms.js:30` tem 23 nomes com rótulo; `server/form-store.mjs` valida por regex `^[a-z_]{2,40}$` (aceita qualquer coisa); `templates.js` traz o bloco `icon` fixo em `star`. O `design_system` já apurou que o app usa 21 ícones e o wireframe 55.

**Elementos — dois catálogos que se sobrepõem.** `public/forms.js:5-28` define 23 tipos para o quiz (`TYPES`), espelhados em `server/form-store.mjs`. `templates.js:136` define ~16 blocos para páginas. Sobrepõem-se em: título, texto, imagem, vídeo/VSL, botão/CTA, ícone, gráfico, campo de formulário. Cada par foi escrito do zero, separado.

**VSL — dois blocos para uma coisa.** `templates.js:152` para páginas; `public/forms.js:221` para o quiz, com o próprio seletor de movimento.

### A assimetria que o dono sentiu

Não é impressão: os dois editores oferecem coisas diferentes.

| | Editor de páginas (`editor-shell.js`) | Editor de quiz (`forms.js`) |
| --- | --- | --- |
| Conteúdo | sim | sim |
| Espaçamento | "Respiro acima/abaixo/laterais", "Cantos arredondados" (`:1139`) | **nenhum** |
| Largura | "Largura", Automática/… (`:1176`) | só `width` do logo |
| Alinhamento | À esquerda / Centralizado / À direita | **nenhum** |
| Movimento | cinco + **duração e atraso** | cinco, sem duração nem atraso |
| Tipografia e cor | via style manager do GrapesJS | **nenhum** |

**"Fontes muito grandes que não dá pra editar, tamanho único, tudo dentro de uma caixa"** tem endereço exato: em `server/dynamic-form.mjs` o CSS é uma constante de servidor com `.screen-element h1{font-size:clamp(32px,5vw,52px)}` e `.card{border-radius:30px;padding:clamp(26px,5vw,58px)}`. O tamanho não é editável porque **não existe controle nenhum** — é literal numa string do servidor, e o editor do quiz nunca expôs tipografia.

---

## 2. Três opções

**(A) O quiz passa a rodar sobre o GrapesJS, com mecânica de etapas.**
Um editor só, um documento só. Mas o quiz não guarda HTML: guarda `schema.steps[].elements[]`, e é isso que sustenta três contratos vivos — `validateFormAnswers` monta a resposta **exclusivamente** a partir dos campos declarados no schema, indexados por `step.id` (`server/form-answer-validation.mjs:16-18`); a submissão grava `form_version_id` e amarra a resposta à versão que a validou (`content-repository.mjs:848`, `:850`); e `form_versions` é **imutável por gatilho** (`001_saas_foundation.sql:286-298`). Migrar o formato significaria reescrever versões publicadas que o banco proíbe reescrever, ou manter dois renderizadores para sempre. Formulários no ar quebrariam e respostas antigas perderiam o schema que as validou.

**(B) Camada compartilhada de "elementos + editor de propriedades", consumida pelos dois motores; o quiz mantém a renderização atual.** ✅ **Confirmada pelo dono em 05/09/2026.**
O catálogo, o esquema de propriedades e o inspetor viram código único. O GrapesJS continua sendo o motor da página; `dynamic-form.mjs` continua sendo o renderizador do quiz. O `schema.steps[].elements[]` não muda de forma — logo, formulário publicado, snapshot imutável e resposta vinculada à versão continuam válidos sem migração nenhuma. O que muda é de onde vêm as definições e quem desenha o inspetor. Resolve as duplicações da §1 e a assimetria de propriedades, que é o que o dono pediu.
Custo honesto: continuam existindo dois renderizadores, e cada elemento novo precisa de um adaptador em cada um. O ganho é que a **definição** é uma só.

**(C) Manter separados e só alinhar o catálogo.**
Barato e quase inútil: não dá tipografia ao quiz, não elimina os dois gráficos, não conserta o bug do `'none'`. Adia o problema mantendo o custo.

**Decisão: B**, confirmada pelo dono em 05/09/2026. É a única que entrega o que ele descreveu sem tocar em dado publicado. A partir daqui, A e C ficam registradas só como alternativas descartadas — e o aceite "resposta antiga continua validando" existe para impedir que uma task deslize de volta para A sem perceber.

---

## 3. Contrato do catálogo único

`packages/studio/public/design/elements.mjs` — ao lado do `design_system`, porque um elemento é a composição de peças visuais dele.

Cada elemento é um registro declarativo:

```
{ id, rotulo, icone, grupo, propriedades: [...], respondeAlgo: bool,
  motores: { pagina: 'como vira bloco GrapesJS', quiz: 'como vira elemento de etapa' } }
```

Catálogo comum: **título, texto, imagem, vídeo/VSL, botão/CTA, escolha, escala, gráfico, ícone/emoji, divisor, formulário**. Cada um declara suas propriedades a partir de um vocabulário fechado, e é isso que fecha a assimetria:

- **Tipografia** — `tamanho` numa **escala nomeada de quatro** (`--text-display`, `--text-title`, `--text-body`, `--text-small`, do `tokens.css`), mais `peso` e `altura de linha`. Escala, não pixel solto: o dono quer poder editar, não quer 40 tamanhos. O `--text-eyebrow` do `design_system` é um estilo de rótulo, não um quinto tamanho — ele não aparece no seletor do editor.
- **Cor** — só tokens do `design_system`. Sem seletor livre de hexadecimal.
- **Base fixada pelo dono em 05/09/2026:** os tokens são **Inter**, **raio único de 12 px** e as **cores do wireframe**. O catálogo herda isso e não negocia: um elemento não declara família, nem raio próprio, nem cor fora dos tokens.
- **Espaçamento** — respiro acima, abaixo e laterais, na escala `--space-*`.
- **Alinhamento** — esquerda, centro, direita.
- **Largura da caixa** — automática, conteúdo, total.
- **Movimento** — os cinco de sempre, **com duração e atraso**, como o editor de páginas já tem e o quiz não tinha. Lista declarada **uma vez**, importada pelos quatro lugares da §1; `'none'` passa a valer nos três validadores, o que fecha o bug.
- **Raio e sombra** — tokens, para "sair da caixa" quando a peça pedir.

`elements.mjs` é ESM puro, sem DOM, importável pelo cliente **e** pelo servidor — `form-store.mjs` e `dynamic-form.mjs` passam a validar e renderizar a partir dele, em vez de listas próprias.

**Editor de propriedades único** (`public/design/inspector.mjs`): recebe um elemento e o registro do catálogo, e desenha os controles com as classes do `design_system`. Os dois editores passam a montá-lo em vez de escrever `<label>` na mão. É o fim do `data-field` improvisado de `forms.js` e da seção de estilo escrita à parte em `editor-shell.js`.

---

## 4. A pele do quiz

Base comum não significa telas iguais. O quiz ganha uma **pele** por cima do mesmo catálogo — o que muda são valores de token e variantes de componente, nunca elementos paralelos:

- **Gráficos desenhados e coloridos** — a variante lúdica do mesmo elemento `gráfico`: barras com cantos redondos, paleta de acento em vez de monocromático, animação de crescimento. A página usa a variante sóbria. Mesmo elemento, `variante: 'ludica'`.
- **Emoji grande** — o elemento `ícone/emoji` aceita emoji nativo além do Material Symbols, com tamanho na escala `--text-display`. É a peça mais barata de todas e a que mais muda o tom.
- **Fotos claras** — o elemento `imagem` ganha `ajuste: 'clara'`: proporção fixa, `object-fit: cover`, sem sombra pesada.
- **Animação** — a duração e o atraso que a §3 traz para o quiz são o que permite entrada encadeada em vez de tudo aparecendo junto.
- **Sair da caixa** — hoje toda etapa vive dentro de `.card`. A pele permite `largura: total` e fundo por token, para a etapa ocupar a tela quando o elemento pedir.

**Confirmado pelo dono em 05/09/2026: a pele é variante dos mesmos elementos, nunca peça exclusiva do quiz.** Duas regras que sustentam isso: **nenhuma cor ou tamanho literal** — tudo token, como manda o `design_system`; e **nenhum elemento exclusivo do quiz** — se uma peça só serve ao quiz, ela é uma *variante*, não um elemento novo. Gamificação é combinação de elementos comuns com uma pele, não um catálogo paralelo.

---

## 5. Campo de imagem único e o gancho de geração

Hoje imagem aparece em pelo menos quatro lugares com formas diferentes: bloco `image` de `templates.js`, campo "Escolher imagem do computador" (`editor-shell.js:980`), `mediaUrl` do quiz (`forms.js`), `imageUrl` das opções visuais e poster da VSL (`vsl-ui.js`).

Vira um componente único, `campoImagem`, com três origens: **URL**, **enviar arquivo** (o R2 de `midia_r2_upload`) e **gerar por IA**. A terceira entra por uma interface de provedor:

```
gerarImagem({ prompt, proporcao, projeto }) → { url, providerId, custo? }
```

**Provedor decidido: WaveSpeed** (dono, 05/09/2026) — é o que a plataforma dele já usa, então a interface nasce com WaveSpeed como primeiro provedor em vez de um adaptador hipotético. A interface continua existindo porque trocar de provedor não pode significar reescrever o campo, mas ela não é mais uma abstração à espera de dono.

**A chave da API é segredo global write-only**, gravada pelo painel de plataforma em `global_secrets`, no mesmo padrão dos cartões de integração descritos em [`2026-09-05-superadmin-global-design.md`](2026-09-05-superadmin-global-design.md): o campo aceita escrita, nunca devolve o valor, e a tela mostra "configurado em ‹data›" com um botão "Substituir". Ela nunca chega ao navegador — a chamada ao provedor sai do servidor.

**O MCP WaveSpeed configurado no ambiente é referência, não caminho de execução.** Ele serve para consultar catálogo de modelos, nomes e parâmetros durante o desenho. O runtime do produto chama a API do provedor a partir do servidor, com a credencial do cofre global e as defesas de egress que `outbound-webhook.mjs` já implementa. Um MCP de ambiente de desenvolvimento não é dependência de produção.

Requisitos que valem para qualquer provedor: a imagem gerada é **persistida no R2 do projeto** antes de entrar no conteúdo, para que a publicação nunca dependa de URL temporária de terceiro; e cada geração é atribuída a empresa e projeto, para medição de consumo.

## 6. Ordem, nós e riscos

**Ordem.** `design_system` primeiro — sem tokens e componentes, o inspetor único não tem com que desenhar. Depois `editor_catalogo` (o catálogo e o inspetor), depois a adoção por motor. `midia_r2_upload` precisa existir antes de `campoImagem` ter a origem "enviar arquivo", e `plataforma_superadmin` antes de `geracao_imagens` ter onde guardar credencial. `tracking_coletor` não é afetado: ele mede eventos, não desenha elemento.

```yaml
  - id: editor_catalogo
    estado: pendente
    faz: Criar o catalogo unico de elementos e o editor de propriedades sobre os tokens do design system
    depende:
      - design_system
    produz: elements.mjs e inspector.mjs, com movimentos, icones e graficos declarados uma unica vez
    passa_quando:
      tipo: comando
      comando: node --test packages/studio/test/editor-catalogo.test.mjs packages/studio/test/dynamic-form.test.mjs
      espera: exit 0

  - id: editor_quiz_unificado
    estado: pendente
    faz: Fazer o editor de quiz consumir o catalogo e o inspetor, ganhando tipografia, espacamento, alinhamento e largura
    depende:
      - editor_catalogo
    produz: Quiz com as mesmas propriedades da pagina, sem mudar o formato do schema publicado
    passa_quando:
      tipo: arquivo
      caminho: .estado/editor_quiz_unificado.md
      casa: "Prova: schema publicado inalterado, respostas antigas validas, tela conferida contra o wireframe, [0-9]+ testes verdes"

  - id: editor_pagina_unificado
    estado: pendente
    faz: Fazer o editor de paginas consumir o mesmo catalogo e inspetor no lugar dos blocos e da secao de estilo proprios
    depende:
      - editor_quiz_unificado
    produz: Um catalogo so para os dois motores, com templates.js reduzido a modelos de pagina
    passa_quando:
      tipo: comando
      comando: node --test packages/studio/test/editor-controls.test.mjs packages/studio/test/templates.test.mjs
      espera: exit 0

  - id: quiz_pele_ludica
    estado: pendente
    faz: Aplicar a pele do quiz: graficos coloridos, emoji grande, fotos claras, animacao encadeada e etapa fora da caixa
    depende:
      - editor_quiz_unificado
    produz: Variantes ludicas dos elementos comuns, sem elemento exclusivo do quiz
    passa_quando:
      tipo: arquivo
      caminho: .estado/quiz_pele_ludica.md
      casa: "Prova: variantes sem literal, sem elemento exclusivo, screenshots conferidos, [0-9]+ testes verdes"

  - id: geracao_imagens
    estado: pendente
    faz: Dar ao campo de imagem a origem gerar por IA, atras de uma interface de provedor
    depende:
      - editor_catalogo
      - midia_r2_upload
      - plataforma_superadmin
    produz: Interface gerarImagem com WaveSpeed como primeiro provedor, chave no cofre global, imagem persistida no R2 do projeto e consumo atribuido
    passa_quando:
      tipo: comando
      comando: node --test packages/studio/test/geracao-imagens.test.mjs
      espera: exit 0
```

### Fases e aceite testável

| Fase | Aceite |
| --- | --- |
| `editor_catalogo` | A lista de movimentos existe **uma vez** e é importada por `forms.js`, `form-store.mjs`, `publication-snapshot.mjs` e `editor-shell.js`; `'none'` é aceito nos três validadores e o bug do VSL no quiz tem teste de regressão; ícone fora da allowlist é recusado; um gráfico é declarado uma vez e renderiza nos dois motores. |
| `editor_quiz_unificado` | O quiz expõe tamanho, fonte, cor, espaçamento, alinhamento, largura e movimento com duração; **o JSON de um formulário publicado antes da mudança continua validando resposta byte a byte**; nenhuma migração de `form_versions`; verificação visual contra "Vamos conhecer você?" e "Escolha visual" do wireframe. |
| `editor_pagina_unificado` | `templates.js` fica só com modelos de página; nenhum elemento é declarado em dois lugares; as páginas publicadas continuam idênticas. |
| `quiz_pele_ludica` | Nenhum literal de cor ou tamanho; nenhum elemento exclusivo do quiz; comparação visual em desktop e 375 px. |
| `geracao_imagens` | A chave do WaveSpeed vem de `global_secrets` e **nunca aparece em resposta de API nem no cliente**; trocar de provedor não toca o componente de campo; a imagem gerada está no R2 do projeto antes de entrar no conteúdo; a chamada sai do servidor, com as defesas de egress de `outbound-webhook.mjs`. |

### Riscos

1. **Reescrever o renderizador do quiz por engano.** A opção B vale porque `schema.steps[].elements[]` **não muda**. Se uma task começar a mudar o formato do schema, ela saiu da opção aprovada e vira a opção A, com formulários publicados no meio. O aceite "resposta antiga continua validando" é a trava.
2. **O catálogo virar denominador comum.** Se toda propriedade precisar servir aos dois motores, o resultado é pobre nos dois. Por isso o registro declara `motores` por elemento: uma propriedade pode existir só num, desde que declarada.
3. **A pele lúdica virar catálogo paralelo.** A regra "variante, nunca elemento novo" é o que impede; sem ela, em três meses há dois sistemas de novo.
4. **Dependência em cadeia longa.** `geracao_imagens` depende de três nós — `editor_catalogo`, `midia_r2_upload` e `plataforma_superadmin` — e o último é obrigatório desde que a chave virou segredo global. Se a geração for pedida antes, o caminho curto é a origem "URL" continuar valendo e a imagem gerada ser colada à mão — pior, mas destravável sem quebrar o desenho.
5. **`design_system` atrasar.** Este nó inteiro fica parado sem tokens. Se `design_system` escorregar, `editor_catalogo` pode começar pelo que é ESM puro — movimentos, ícones e definição de elementos — e deixar o inspetor para depois.

---

## 7. Decisões fixadas e o que ainda está aberto

**Fixado pelo dono em 05/09/2026** — não reabrir sem nova decisão:

1. Opção **B**: camada compartilhada, renderização do quiz mantida.
2. A pele lúdica é **variante** dos mesmos elementos; nenhuma peça exclusiva do quiz.
3. Tipografia por **escala nomeada de quatro tamanhos**, sobre os tokens do `design_system` — **Inter**, **raio único de 12 px**, **cores do wireframe**.
4. Geração de imagem por **WaveSpeed**, com a chave como **segredo global write-only** do painel de plataforma; o MCP do ambiente é referência de modelos e parâmetros, não caminho de execução.

**Ainda depende do dono:**

- **Os quatro valores da escala tipográfica.** Ele fixou família, raio e cores, não os tamanhos. Sem eles, `editor_catalogo` não fecha o seletor.
- **Se `templates.js` migra para tokens.** O `design_system` isentou o arquivo por ser conteúdo de cliente — mas são os modelos de landing page que o produto entrega, com paleta e tipografia próprias. Manter isento significa que um modelo pronto não obedece ao sistema; migrar significa reescrever os modelos.
- **Quando a geração de imagem entra.** Hoje ela é o último nó da cadeia. Antecipá-la é possível pelo caminho curto do risco 4, com o custo lá descrito.
- **Cota e custo de geração por empresa.** As cotas de armazenamento já existem; geração é outro consumo, e ninguém decidiu se tem teto.
