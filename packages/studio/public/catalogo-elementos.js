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
const regras = `.element-icon{display:grid;width:44px;height:44px;place-items:center;margin:0 auto 12px;border-radius:14px;background:#eaf1ff;color:var(--alva-el-accent);font-size:24px}.description{font-size:16px;line-height:1.55;color:var(--alva-el-muted);text-align:center;margin:9px auto 2px;max-width:650px}.answer{width:100%;border:1px solid var(--alva-el-line);border-radius:17px;padding:17px 18px;background:#fff;color:var(--alva-el-ink);font:inherit;font-size:17px;outline:none;resize:vertical;box-shadow:0 5px 15px #1b315b0a}.answer:focus{border-color:var(--alva-el-accent);box-shadow:0 0 0 4px #286eea16}textarea.answer{min-height:115px}.answer-wrap{display:block;margin:0 0 18px;font-size:13px;font-weight:600;color:var(--alva-el-ink)}.choices{display:grid;gap:11px}.choice{display:flex;align-items:center;gap:12px;border:1px solid var(--alva-el-line);border-radius:16px;padding:15px 17px;cursor:pointer;background:#fff;transition:.2s}.choice:hover,.choice:has(input:checked){border-color:var(--alva-el-accent);background:#eef4ff;transform:translateY(-2px);box-shadow:0 10px 25px #286eea15}.choice input{accent-color:var(--alva-el-accent)}.choice-key{display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--alva-el-line);border-radius:9px;font-size:12px}.image-choices{grid-template-columns:repeat(auto-fit,minmax(145px,1fr))}.image-choices>:is(h1,h2,h3,p){grid-column:1/-1}.choice-image{padding:0;overflow:hidden;display:grid;grid-template-rows:145px auto;position:relative}.choice-image img{width:100%;height:145px;object-fit:cover}.choice-image input{position:absolute;top:12px;left:12px;width:20px;height:20px}.choice-image>span:last-child{padding:15px;font-weight:700}.choice-visual{display:grid;place-items:center;font-size:54px;background:linear-gradient(145deg,#eaf1ff,#f3eefe);color:var(--alva-el-accent)}.scale{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:16px}.scale input{width:100%;accent-color:var(--alva-el-accent)}.scale output{display:grid;place-items:center;width:52px;height:52px;border-radius:16px;background:#eaf2ff;color:var(--alva-el-accent);font-size:22px;font-weight:800}.upload{display:grid;place-items:center;gap:7px;padding:30px;border:2px dashed #c8d6eb;border-radius:18px;text-align:center;cursor:pointer}.step-media,.native-video,.media-placeholder{width:100%;min-height:230px;border-radius:20px;object-fit:cover}.media-placeholder{display:grid;place-items:center;background:#edf3fc;color:var(--alva-el-muted)}.video{position:relative;padding-top:56.25%;border-radius:20px;overflow:hidden}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}.native-video{display:block;width:100%;border-radius:20px;background:#111}.custom-cta{display:flex;align-items:center;justify-content:center;gap:9px;padding:16px 22px;border-radius:15px;background:var(--alva-el-accent);color:#fff;text-decoration:none;font-weight:800}.statement-line{width:74px;height:5px;border-radius:5px;background:linear-gradient(90deg,var(--alva-el-accent),var(--alva-el-accent2));margin:18px auto 0}.chart{margin:6px 0}.bar-row{display:grid;grid-template-columns:minmax(75px,auto) 1fr 40px;gap:12px;align-items:center;margin:13px 0}.bar-row>i{height:13px;background:#edf1f7;border-radius:20px;overflow:hidden}.bar-row b{display:block;height:100%;width:var(--value);background:linear-gradient(90deg,var(--alva-el-accent),#31c7a3);border-radius:inherit;animation:grow 1s}.bar-row span,.bar-row strong,.legend{font-size:12px}.chart-donut{display:flex;align-items:center;justify-content:center;gap:30px}.donut{width:180px;aspect-ratio:1;border-radius:50%;background:conic-gradient(var(--segments));display:grid;place-items:center;position:relative}.donut:before{content:'';position:absolute;inset:30px;border-radius:50%;background:#fff}.donut strong,.donut span{z-index:1;grid-area:1/1}.donut strong{font-size:28px}.donut span{transform:translateY(22px);color:var(--alva-el-muted);font-size:11px}.legend{display:grid;gap:8px}.legend span{display:flex;align-items:center;gap:8px}.legend i{width:9px;height:9px;border-radius:50%;background:var(--color)}.loader{display:grid;place-items:center;gap:16px;padding:24px}.countdown{display:grid;place-items:center;padding:18px;border:1px solid var(--alva-el-line);border-radius:18px;background:linear-gradient(145deg,#f8fbff,#f2efff)}.countdown strong{font-size:clamp(30px,6vw,54px);font-variant-numeric:tabular-nums;letter-spacing:.06em;color:var(--alva-el-accent)}.countdown[data-finished]{opacity:.65}.timer-toggle{display:grid;place-items:center;width:38px;height:38px;margin-top:10px;border:0;border-radius:50%;background:var(--alva-el-accent);color:#fff;cursor:pointer}.loader span{width:58px;height:58px;border:6px solid #e8eef8;border-top-color:var(--alva-el-accent);border-radius:50%;animation:spin .85s linear infinite}@keyframes grow{from{width:0}}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:600px){.image-choices{grid-template-columns:1fr 1fr}.choice-image{grid-template-rows:115px auto}.choice-image img{height:115px}.chart-donut{align-items:flex-start;flex-direction:column}.donut{width:150px}}`;

// Só espaçamento: cor, tamanho de fonte e família continuam vindo do modelo da página em
// que o elemento cair, para ele herdar a paleta de onde for solto, não trazer a sua.
const regrasDeConteudo = `.alva-secao{padding:60px 7%;min-height:140px}.alva-titulo{margin:0 0 16px}.alva-texto{margin:0 0 16px;max-width:70ch}@media(max-width:760px){.alva-secao{padding:40px 6%}}`;

export const elementosCss = paleta + regras + regrasDeConteudo;

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
