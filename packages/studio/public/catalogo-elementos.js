// A folha que desenha os elementos, separada da folha que pinta a página.
//
// Ela nasceu no editor de quiz que saiu em 2026-09-09 e continuou correta: cartão de
// escolha com estado, escala com bolha, área de envio pontilhada. O que faltava era
// alguém carregá-la. A paleta sai em variáveis para o mesmo elemento servir a um modelo
// claro e a um escuro sem uma segunda folha. Todos os valores vêm de
// quiz-elements.js:107 (a folha de origem) — nenhum valor novo, nem o token canônico
// do design system: --alva-el-ink usa o #111827 legado da origem, não o #101828 de
// packages/studio/public/styles.css, porque esta tarefa não muda o formulário publicado.
const paleta = `:root{--alva-el-accent:#286eea;--alva-el-accent2:#8a63ff;--alva-el-accent-soft:#eef4ff;--alva-el-ink:#111827;--alva-el-muted:#667085;--alva-el-line:#dce5f1;--alva-el-surface:#ffffff}`;

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

const regras = `.element-icon{display:grid;width:44px;height:44px;place-items:center;margin:0 auto 12px;border-radius:14px;background:#eaf1ff;color:var(--alva-el-accent);font-size:24px}.description{font-size:16px;line-height:1.55;color:var(--alva-el-muted);text-align:center;margin:9px auto 2px;max-width:650px}.answer{width:100%;border-width:1px;border-style:solid;${molduraCor('var(--alva-el-line)')};border-radius:17px;padding:17px 18px;background:#fff;color:var(--alva-el-ink);font:inherit;font-size:17px;outline:none;resize:vertical;box-shadow:0 5px 15px #1b315b0a}.answer:focus{${molduraCor('var(--alva-el-accent)')};box-shadow:0 0 0 4px #286eea16}.alva-form .answer:focus{${molduraCor('var(--field-border)')};box-shadow:none}textarea.answer{min-height:115px}.answer-wrap{display:block;margin:0 0 18px;font-size:13px;font-weight:600;color:var(--alva-el-ink)}.choices{display:grid;gap:11px}.choice{display:flex;align-items:center;gap:12px;border-width:1px;border-style:solid;${molduraCor('var(--alva-el-line)')};border-radius:16px;padding:15px 17px;cursor:pointer;background:#fff;transition:.2s}.choice:hover,.choice:has(input:checked){${molduraCor('var(--alva-el-accent)')};background:#eef4ff;transform:translateY(-2px);box-shadow:0 10px 25px #286eea15}.choice input{accent-color:var(--alva-el-accent)}.choice-key{display:grid;place-items:center;width:28px;height:28px;border-width:1px;border-style:solid;${molduraCor('var(--alva-el-line)')};border-radius:9px;font-size:12px}.image-choices{grid-template-columns:repeat(auto-fit,minmax(145px,1fr))}.image-choices>:is(h1,h2,h3,p){grid-column:1/-1}.choice-image{padding:0;overflow:hidden;display:grid;grid-template-rows:145px auto;position:relative}.choice-image img{width:100%;height:145px;object-fit:cover}.choice-image input{position:absolute;top:12px;left:12px;width:20px;height:20px}.choice-image>span:last-child{padding:15px;font-weight:700}.choice-visual{display:grid;place-items:center;font-size:54px;background:linear-gradient(145deg,#eaf1ff,#f3eefe);color:var(--alva-el-accent)}.scale{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:16px}.scale input{width:100%;accent-color:var(--alva-el-accent)}.scale output{display:grid;place-items:center;width:52px;height:52px;border-radius:16px;background:#eaf2ff;color:var(--alva-el-accent);font-size:22px;font-weight:800}.upload{display:grid;place-items:center;gap:7px;padding:30px;border:2px dashed #c8d6eb;border-radius:18px;text-align:center;cursor:pointer}.step-media,.native-video,.media-placeholder{width:100%;min-height:230px;border-radius:20px;object-fit:cover}.media-placeholder{display:grid;place-items:center;background:#edf3fc;color:var(--alva-el-muted)}.video{position:relative;padding-top:56.25%;border-radius:20px;overflow:hidden}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}.native-video{display:block;width:100%;border-radius:20px;background:#111}.custom-cta{display:flex;align-items:center;justify-content:center;gap:9px;padding:16px 22px;border-radius:15px;background:var(--alva-el-accent);color:#fff;text-decoration:none;font-weight:800}.statement-line{width:74px;height:5px;border-radius:5px;background:linear-gradient(90deg,var(--alva-el-accent),var(--alva-el-accent2));margin:18px auto 0}.chart{margin:6px 0}.bar-row{display:grid;grid-template-columns:minmax(75px,auto) 1fr 40px;gap:12px;align-items:center;margin:13px 0}.bar-row>i{height:13px;background:#edf1f7;border-radius:20px;overflow:hidden}.bar-row b{display:block;height:100%;width:var(--value);background:linear-gradient(90deg,var(--alva-el-accent),#31c7a3);border-radius:inherit;animation:grow 1s}.bar-row span,.bar-row strong,.legend{font-size:12px}.chart-donut{display:flex;align-items:center;justify-content:center;gap:30px}.donut{width:180px;aspect-ratio:1;border-radius:50%;background:conic-gradient(var(--segments));display:grid;place-items:center;position:relative}.donut:before{content:'';position:absolute;inset:30px;border-radius:50%;background:#fff}.donut strong,.donut span{z-index:1;grid-area:1/1}.donut strong{font-size:28px}.donut span{transform:translateY(22px);color:var(--alva-el-muted);font-size:11px}.legend{display:grid;gap:8px}.legend span{display:flex;align-items:center;gap:8px}.legend i{width:9px;height:9px;border-radius:50%;background:var(--color)}.loader{display:grid;place-items:center;gap:16px;padding:24px}.countdown{display:grid;place-items:center;padding:18px;border-width:1px;border-style:solid;${molduraCor('var(--alva-el-line)')};border-radius:18px;background:linear-gradient(145deg,#f8fbff,#f2efff)}.countdown strong{font-size:clamp(30px,6vw,54px);font-variant-numeric:tabular-nums;letter-spacing:.06em;color:var(--alva-el-accent)}.countdown[data-finished]{opacity:.65}.timer-toggle{display:grid;place-items:center;width:38px;height:38px;margin-top:10px;border:0;border-radius:50%;background:var(--alva-el-accent);color:#fff;cursor:pointer}.loader span{width:58px;height:58px;border:6px solid #e8eef8;border-top-color:var(--alva-el-accent);border-radius:50%;animation:spin .85s linear infinite}@keyframes grow{from{width:0}}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:600px){.image-choices{grid-template-columns:1fr 1fr}.choice-image{grid-template-rows:115px auto}.choice-image img{height:115px}.chart-donut{align-items:flex-start;flex-direction:column}.donut{width:150px}}`;

// O botão é elemento do catálogo, então a regra dele mora aqui — e não em templateCss,
// onde morou até 2026-09-12. A paleta do quiz é `[...blocks, ...quizBlocks]`, então
// `button` sempre foi arrastável para dentro de um quiz; mas templateCss é justamente a
// folha que o canvas do quiz não recebe, e .cta também não está em runtimeCss. Resultado:
// dos nove elementos do catálogo, oito chegavam desenhados nos dois canvases e o botão
// nascia sem regra no quiz, no editor e no publicado. Os valores são cópia literal do que
// templateCss declarava; os modelos continuam vestindo o botão por seletor mais
// específico (.offer-top .cta, .b2b-page .cta, .plan .cta…), que vence por especificidade
// e não por ordem de folha — por isso a landing não muda de aparência com a mudança.
const regraDoBotao = `.cta{display:inline-block;padding:17px 24px;background:#d7ec95;border:0;border-radius:7px;color:#203a32;font-weight:700;text-decoration:none;font-size:14px;cursor:pointer}`;

// Só espaçamento: cor, tamanho de fonte e família continuam vindo do modelo da página em
// que o elemento cair, para ele herdar a paleta de onde for solto, não trazer a sua.
const regrasDeConteudo = `.alva-secao{padding:60px 7%;min-height:140px}.alva-titulo{margin:0 0 16px}.alva-texto{margin:0 0 16px;max-width:70ch}@media(max-width:760px){.alva-secao{padding:40px 6%}}`;

export const elementosCss = paleta + regras + regraDoBotao + regrasDeConteudo;

// O catálogo dá dono ao HTML dos elementos: cada entrada carrega o seletor que a alcança
// em alguma folha do sistema (esta ou templateCss), o que permite ao teste provar que
// nenhum elemento nasce sem regra — o defeito que originou este plano.
export const catalogo = [
  { id: 'section', nome: 'Seção', grupo: 'Estrutura', icone: 'view_day', seletor: '.alva-secao', registro: 'pagina',
    descricao: 'Uma faixa nova da página, para separar um assunto do outro.',
    render: () => '<section class="alva-secao"><h2 class="alva-titulo">Uma nova seção</h2><p class="alva-texto">Conte sua história aqui.</p></section>' },
  { id: 'heading', nome: 'Título', grupo: 'Conteúdo', icone: 'title', seletor: '.alva-titulo', registro: 'pagina',
    descricao: 'Um título para anunciar o que vem a seguir.',
    render: () => '<h2 class="alva-titulo">Seu próximo grande título</h2>' },
  { id: 'text', nome: 'Texto', grupo: 'Conteúdo', icone: 'notes', seletor: '.alva-texto', registro: 'pagina',
    descricao: 'Um parágrafo para explicar sua ideia.',
    render: () => '<p class="alva-texto">Uma mensagem simples para apresentar sua solução.</p>' },
  { id: 'button', nome: 'Botão', grupo: 'Conteúdo', icone: 'smart_button', seletor: '.cta', registro: 'pagina',
    descricao: 'Um convite para a pessoa dar o próximo passo.',
    render: () => '<a href="#contato" class="cta">Quero saber mais ↗</a>' },
  { id: 'icon', nome: 'Ícone', grupo: 'Conteúdo', icone: 'star', seletor: '.material-symbols-outlined', registro: 'pagina',
    descricao: 'Um símbolo para reforçar uma ideia rapidamente.',
    render: () => '<span class="material-symbols-outlined" aria-hidden="true">star</span>' },
  { id: 'input', nome: 'Campo de texto', grupo: 'Captação', icone: 'text_fields', seletor: '.answer', registro: 'pagina',
    descricao: 'Uma pergunta com espaço para a pessoa escrever a resposta.',
    render: () => '<label class="answer-wrap">Novo campo<input class="answer" name="novo_campo" type="text" placeholder="Digite aqui"></label>' },
  { id: 'quiz-select', nome: 'Lista de opções', grupo: 'Captação', icone: 'list', seletor: '.answer', registro: 'quiz',
    descricao: 'Uma pergunta com resposta escolhida numa lista.',
    render: () => '<label class="answer-wrap">Nova pergunta<select class="answer" name="campo_lista"><option value="Opção 1">Opção 1</option><option value="Opção 2">Opção 2</option></select></label>' },
  { id: 'quiz-range', nome: 'Escala', grupo: 'Captação', icone: 'linear_scale', seletor: '.scale', registro: 'quiz',
    descricao: 'Uma nota de um a dez, movendo um controle.',
    render: () => '<div class="scale"><span>1</span><input type="range" name="campo_escala" min="1" max="10" value="5" oninput="this.nextElementSibling.value=this.value"><output>5</output></div>' },
  { id: 'quiz-file', nome: 'Arquivo', grupo: 'Captação', icone: 'upload_file', seletor: '.upload', registro: 'quiz',
    descricao: 'Um espaço para a pessoa enviar um arquivo.',
    render: () => '<label class="upload"><span class="material-symbols-outlined" aria-hidden="true">upload_file</span><span>Escolher arquivo</span><input type="file" name="campo_arquivo" hidden></label>' },
];

export const elementoPorId = (id) => catalogo.find((elemento) => elemento.id === id);
