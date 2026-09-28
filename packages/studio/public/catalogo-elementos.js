// A folha que desenha os elementos, separada da folha que pinta a página.
//
// Ela nasceu no editor de quiz que saiu em 2026-09-09 e continuou correta: cartão de
// escolha com estado, escala com bolha, área de envio pontilhada. O que faltava era
// alguém carregá-la. A paleta sai em variáveis para o mesmo elemento servir a um modelo
// claro e a um escuro sem uma segunda folha. Todos os valores vêm de
// quiz-elements.js:107 (a folha de origem) — nenhum valor novo, nem o token canônico
// do design system: --alva-el-ink usa o #101828 legado da origem, não o #101828 de
// packages/studio/public/styles.css, porque esta tarefa não muda o formulário publicado.
// --alva-el-surface e --alva-el-accent-soft ficaram declarados e contornados até
// 2026-09-12: as regras escreviam #ffffff e #ffffff literalmente a poucos caracteres deles,
// o que tornava falsa a promessa acima de servir um modelo claro e um escuro sem segunda
// folha — trocar a paleta deixava de trocar a superfície. Agora saem por var(), e em
// background-color e não no atalho background: atalho com var() dentro não sobrevive ao
// serializador do GrapesJS (ver a prova em catalogo-elementos.test.mjs).
const paleta = `:root{--alva-el-accent:#286eea;--alva-el-accent2:#5B8CFF;--alva-el-accent-soft:#ffffff;--alva-el-ink:#101828;--alva-el-muted:#667085;--alva-el-line:#EAF2FF;--alva-el-surface:#ffffff}`;

// A última regra é @media(max-width:600px), o mesmo breakpoint que quiz-elements.js usa
// para as regras de página. São dois blocos porque cada folha precisa fechar o próprio
// @media sozinha (esta aqui roda sem quiz-elements.js no editor da Tarefa 2) — mas todo
// override cujo seletor-alvo é um destes de elemento mora AQUI, junto da base, nunca no
// @media de quiz-elements.js: base e override do mesmo seletor em módulos diferentes foi
// o bug que inverteu a cascata de .chart-donut/.donut (corrigido em 2026-09-12).
// .alva-form .answer:focus (0,3,0) é o único trecho aqui que existe por causa de OUTRA
// folha: dentro do formulário, o campo avulso ainda carrega .answer, e .answer:focus
// (0,2,0) se aplicava sozinho — formCss só tem regra para :focus-visible (outline), não
// para :focus puro — então um clique deixava esse campo com borda azul e brilho
// diferentes dos irmãos do mesmo formulário. Os dois valores abaixo são cópia literal do
// que .alva-form input já tem em repouso em templates.js (var(--field-border) e
// box-shadow:none): o campo aninhado, ao ganhar foco, só volta a parecer com o formulário
// ao redor — nenhum valor novo. Achado da revisão de 2026-09-12 (rodada 1 da Tarefa 6).
//
// A moldura sai em longhand (border-width/border-style/border-color) e não no atalho
// `border`. Motivo: o GrapesJS reserializa a folha ao injetá-la no canvas e um ATALHO com
// var() vira pending-substitution no CSSOM, serializa vazio e some — `border:1px solid
// var(--alva-el-line)` sumia inteiro de .answer, .choice e .choice-key, no canvas e no
// HTML salvo, enquanto .upload sobrevivia por declarar cor literal. Sem border-style, o
// estado escolhido — que só troca border-color — não tinha o que colorir. Longhand com
// var() sobrevive à reserialização; atalho, não. Achado D3 do gate visual de 2026-09-12.
// border-color TAMBÉM é atalho (das quatro faces), e também some com var() dentro. Medido
// no Chrome: de `border-width:1px;border-style:solid;${molduraCor('var(--alva-el-line)')}` o
// canvas recebia só as duas primeiras, e a moldura caía em currentColor. Daí este
// gerador: uma cor, quatro faces, nenhum atalho. Vale para a moldura em repouso e para a
// dos estados — é a declaração do estado que mostra qual opção está escolhida.
const molduraCor = (cor) => `border-top-color:${cor};border-right-color:${cor};border-bottom-color:${cor};border-left-color:${cor}`;

const regras = `.element-icon{display:grid;width:44px;height:44px;place-items:center;margin:0 auto 12px;border-radius:14px;background:#EAF2FF;color:var(--alva-el-accent);font-size:24px}.description{font-size:16px;line-height:1.55;color:var(--alva-el-muted);text-align:center;margin:9px auto 2px;max-width:650px}.answer{width:100%;border-width:1px;border-style:solid;${molduraCor('var(--alva-el-line)')};border-radius:17px;padding:17px 18px;background-color:var(--alva-el-surface);color:var(--alva-el-ink);font:inherit;font-size:17px;outline:none;resize:vertical;box-shadow:0 5px 15px #1b315b0a}.answer:focus{${molduraCor('var(--alva-el-accent)')};box-shadow:0 0 0 4px #286eea16}.alva-form .answer:focus{${molduraCor('var(--field-border)')};box-shadow:none}textarea.answer{min-height:115px}.answer-wrap{display:block;margin:0 0 18px;font-size:13px;font-weight:600;color:var(--alva-el-ink)}.choices{display:grid;gap:11px}.choice{display:flex;align-items:center;gap:12px;border-width:1px;border-style:solid;${molduraCor('var(--alva-el-line)')};border-radius:16px;padding:15px 17px;cursor:pointer;background-color:var(--alva-el-surface);transition:.2s}.choice:hover,.choice:has(input:checked){${molduraCor('var(--alva-el-accent)')};background-color:var(--alva-el-accent-soft);transform:translateY(-2px);box-shadow:0 10px 25px #286eea15}.choice input{accent-color:var(--alva-el-accent)}.choice-key{display:grid;place-items:center;width:28px;height:28px;border-width:1px;border-style:solid;${molduraCor('var(--alva-el-line)')};border-radius:9px;font-size:12px}.image-choices{grid-template-columns:repeat(auto-fit,minmax(145px,1fr))}.image-choices>:is(h1,h2,h3,p){grid-column:1/-1}.choice-image{padding:0;overflow:hidden;display:grid;grid-template-rows:145px auto;position:relative}.choice-image img{width:100%;height:145px;object-fit:cover}.choice-image input{position:absolute;top:12px;left:12px;width:20px;height:20px}.choice-image>span:last-child{padding:15px;font-weight:700}.choice-visual{display:grid;place-items:center;font-size:54px;background:linear-gradient(145deg,#EAF2FF,#ffffff);color:var(--alva-el-accent)}.scale{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:16px}.scale input{width:100%;accent-color:var(--alva-el-accent)}.scale output{display:grid;place-items:center;width:52px;height:52px;border-radius:16px;background:#eaf2ff;color:var(--alva-el-accent);font-size:22px;font-weight:800}.upload{display:grid;place-items:center;gap:7px;padding:30px;border:2px dashed #EAF2FF;border-radius:18px;text-align:center;cursor:pointer}.step-media,.native-video,.media-placeholder{width:100%;min-height:230px;border-radius:20px;object-fit:cover}.media-placeholder{display:grid;place-items:center;background:#EAF2FF;color:var(--alva-el-muted)}.video{position:relative;padding-top:56.25%;border-radius:20px;overflow:hidden}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}.native-video{display:block;width:100%;border-radius:20px;background:#101828}.custom-cta{display:flex;align-items:center;justify-content:center;gap:9px;padding:16px 22px;border-radius:15px;background:var(--alva-el-accent);color:#ffffff;text-decoration:none;font-weight:800}.statement-line{width:74px;height:5px;border-radius:5px;background:linear-gradient(90deg,var(--alva-el-accent),var(--alva-el-accent2));margin:18px auto 0}.chart{margin:6px 0}.bar-row{display:grid;grid-template-columns:minmax(75px,auto) 1fr 40px;gap:12px;align-items:center;margin:13px 0}.bar-row>i{height:13px;background:#EAF2FF;border-radius:20px;overflow:hidden}.bar-row b{display:block;height:100%;width:var(--value);background:linear-gradient(90deg,var(--alva-el-accent),#286EEA);border-radius:inherit;animation:grow 1s}.bar-row span,.bar-row strong,.legend{font-size:12px}.chart-donut{display:flex;align-items:center;justify-content:center;gap:30px}.donut{width:180px;aspect-ratio:1;border-radius:50%;background:conic-gradient(var(--segments));display:grid;place-items:center;position:relative}.donut:before{content:'';position:absolute;inset:30px;border-radius:50%;background-color:var(--alva-el-surface)}.donut strong,.donut span{z-index:1;grid-area:1/1}.donut strong{font-size:28px}.donut span{transform:translateY(22px);color:var(--alva-el-muted);font-size:11px}.legend{display:grid;gap:8px}.legend span{display:flex;align-items:center;gap:8px}.legend i{width:9px;height:9px;border-radius:50%;background:var(--color)}.loader{display:grid;place-items:center;gap:16px;padding:24px}.countdown{display:grid;place-items:center;padding:18px;border-width:1px;border-style:solid;${molduraCor('var(--alva-el-line)')};border-radius:18px;background:linear-gradient(145deg,#ffffff,#ffffff)}.countdown strong{font-size:clamp(30px,6vw,54px);font-variant-numeric:tabular-nums;letter-spacing:.06em;color:var(--alva-el-accent)}.countdown[data-finished]{opacity:.65}.timer-toggle{display:grid;place-items:center;width:38px;height:38px;margin-top:10px;border:0;border-radius:50%;background:var(--alva-el-accent);color:#ffffff;cursor:pointer}.loader span{width:58px;height:58px;border:6px solid #EAF2FF;border-top-color:var(--alva-el-accent);border-radius:50%;animation:spin .85s linear infinite}@keyframes grow{from{width:0}}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:600px){.image-choices{grid-template-columns:1fr 1fr}.choice-image{grid-template-rows:115px auto}.choice-image img{height:115px}.chart-donut{align-items:flex-start;flex-direction:column}.donut{width:150px}}`;

// O botão é elemento do catálogo, então a regra dele mora aqui — e não em templateCss,
// onde morou até 2026-09-12. A paleta do quiz é `[...blocks, ...quizBlocks]`, então
// `button` sempre foi arrastável para dentro de um quiz; mas templateCss é justamente a
// folha que o canvas do quiz não recebe, e .cta também não está em runtimeCss. Resultado:
// dos nove elementos do catálogo, oito chegavam desenhados nos dois canvases e o botão
// nascia sem regra no quiz, no editor e no publicado. Os valores são cópia literal do que
// templateCss declarava; os modelos continuam vestindo o botão por seletor mais
// específico (.offer-top .cta, .b2b-page .cta, .plan .cta…), que vence por especificidade
// e não por ordem de folha — por isso a landing não muda de aparência com a mudança.
const regraDoBotao = `.cta{display:inline-flex;align-items:center;gap:9px;padding:15px 22px;background:#286EEA;border:0;border-radius:12px;color:#ffffff;font-weight:600;text-decoration:none;font-size:15px;cursor:pointer;box-shadow:0 8px 22px rgba(40,110,234,.20);transition:transform .15s ease,box-shadow .15s ease}.cta:hover{transform:translateY(-1px);box-shadow:0 12px 26px rgba(40,110,234,.28)}`;

// Só espaçamento: cor, tamanho de fonte e família continuam vindo do modelo da página em
// que o elemento cair, para ele herdar a paleta de onde for solto, não trazer a sua.
const regrasDeConteudo = `.alva-secao{padding:60px 7%;min-height:140px}.alva-titulo{margin:0 0 16px}.alva-texto{margin:0 0 16px;max-width:70ch}.alva-colunas{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:32px;align-items:start}.alva-imagem{display:block;max-width:100%;height:auto;border-radius:20px}.alva-secao-suave{background:#F7F9FC}.alva-secao-escura{background:#101828;color:#ffffff}.alva-secao-escura .alva-texto{color:#CDD6E3}.alva-colunas-3{grid-template-columns:repeat(3,minmax(0,1fr))}.alva-colunas>.alva-secao{padding:0;min-height:0}.alva-conteudo>.alva-secao{flex:0 0 100%;min-width:0}.alva-respiro-p{padding-top:32px;padding-bottom:32px}.alva-respiro-g{padding-top:96px;padding-bottom:96px}.alva-conteudo{row-gap:16px}.alva-espaco-p{row-gap:8px}.alva-espaco-g{row-gap:32px}.alva-conteudo-centro{justify-content:center;text-align:center}.alva-conteudo-centro .alva-texto,.alva-conteudo-centro .alva-imagem,.alva-conteudo-centro .alva-titulo,.alva-a-centro .alva-titulo{margin-left:auto;margin-right:auto}.alva-linha{display:flex;align-items:center;gap:24px}.alva-linha>.alva-bloco{flex:1 1 0;min-width:0}.alva-colunas-1-3-2-3{grid-template-columns:1fr 2fr}.alva-colunas-2-3-1-3{grid-template-columns:2fr 1fr}.alva-m-topo-p{margin-top:8px}.alva-m-topo-m{margin-top:24px}.alva-m-topo-g{margin-top:48px}.alva-m-base-p{margin-bottom:8px}.alva-m-base-m{margin-bottom:24px}.alva-m-base-g{margin-bottom:48px}.alva-pagina{display:flex;flex-wrap:wrap}.alva-pagina>*{flex:0 0 100%;min-width:0}.alva-conteudo{max-width:1120px;margin:0 auto;display:flex;flex-wrap:wrap;align-items:flex-start;column-gap:24px}.alva-bloco{flex:0 0 100%;min-width:0;box-sizing:border-box}.alva-l-3-4{flex-basis:calc(75% - 6px)}.alva-l-2-3{flex-basis:calc(66.666% - 8px)}.alva-l-1-2{flex-basis:calc(50% - 12px)}.alva-l-1-3{flex-basis:calc(33.333% - 16px)}.alva-l-1-4{flex-basis:calc(25% - 18px)}.alva-a-centro{text-align:center}.alva-a-centro .alva-texto,.alva-a-centro .alva-imagem{margin-left:auto;margin-right:auto}.alva-a-direita{text-align:right}.alva-a-direita .alva-texto,.alva-a-direita .alva-imagem{margin-left:auto}@supports (animation-timeline:view()){[data-alva-motion]{animation-timeline:view();animation-range:entry 0% cover 30%}}@media(max-width:760px){.alva-secao{padding:40px 6%}.alva-colunas,.alva-colunas-3{grid-template-columns:1fr}.alva-bloco{flex-basis:100%}.alva-linha{flex-direction:column;align-items:stretch}.alva-colunas-1-3-2-3,.alva-colunas-2-3-1-3{grid-template-columns:1fr}.alva-respiro-g{padding-top:56px;padding-bottom:56px}}`;

export const elementosCss = paleta + regras + regraDoBotao + regrasDeConteudo;

// A pergunta de escolha do quiz (esquema do Alva). Fica fora de `elementosCss` porque só o
// quiz a usa. Os três estados são distintos: parado, cursor em cima (borda) e escolhido
// (borda cheia, fundo e marca) — antes, "em cima" e "escolhido" eram idênticos. As cores são
// as da paleta do Studio.
export const escolhaCss = `
.alva-quiz{display:contents}
.alva-quiz>*{flex:0 0 100%;min-width:0}
.alva-escolha{border:0;margin:0 auto;padding:0;min-width:0;width:100%;max-width:640px}
.alva-bloco:has(>.alva-escolha){width:100%;align-self:stretch}
.alva-conteudo-centro .alva-escolha-pergunta{text-align:center}
.alva-etapa .alva-conteudo>.answer-wrap,.alva-etapa .alva-conteudo>*:has(>.answer-wrap){flex:0 0 100%}
.alva-etapa .answer-wrap{display:grid;gap:6px;width:100%;box-sizing:border-box;padding-inline:max(0px,calc((100% - 520px) / 2));text-align:left}
.alva-escolha-pergunta{display:block;width:100%;margin:0 0 16px;padding:0;font-size:22px;font-weight:700;line-height:1.25;color:inherit}
.alva-opcoes{display:grid;gap:10px}
.alva-escolha-grade .alva-opcoes{grid-template-columns:repeat(2,minmax(0,1fr))}
.alva-opcao{position:relative;display:flex;align-items:center;gap:12px;min-height:56px;padding:14px 16px;border:1px solid #e1e7ef;border-radius:12px;background:#ffffff;color:#101828;font-size:16px;font-weight:600;text-align:left;cursor:pointer;transition:border-color .15s ease,background-color .15s ease,box-shadow .15s ease}
.alva-escolha-grade .alva-opcao{flex-direction:column;justify-content:center;text-align:center}
.alva-opcao input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.alva-opcao .material-symbols-outlined{font-size:24px;color:#286eea}
.alva-opcao-imagem{display:block;width:100%;max-height:160px;object-fit:cover;border-radius:8px}
@media (hover:hover){.alva-opcao:hover{border-color:#5b8cff}}
.alva-opcao:has(input:focus-visible){outline:2px solid #286eea;outline-offset:2px}
.alva-opcao:has(input:checked){border-color:#286eea;background:#edf4ff;box-shadow:inset 0 0 0 1px #286eea}
.alva-opcao:has(input:checked)::after{content:'check_circle';font-family:'Material Symbols Outlined';font-size:22px;line-height:1;color:#286eea;margin-left:auto}
.alva-escolha-grade .alva-opcao:has(input:checked)::after{position:absolute;top:8px;right:8px}
.alva-opcao:has(input:disabled){opacity:.5;cursor:not-allowed}
@media (max-width:640px){.alva-escolha-grade .alva-opcoes{grid-template-columns:1fr}}
`;
