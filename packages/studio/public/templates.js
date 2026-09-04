// Original catalog. Copy is deliberately editable; no performance claims or testimonials are invented.
export const formCss = `
.alva-form{--alva-form-base:1;--form-bg:#ffffff;--form-fg:#213c34;--form-muted:#5c7067;--field-bg:#f8faf7;--field-border:#cbd5cc;--button-bg:#d7ec95;--button-fg:#203a32;box-sizing:border-box;display:block;width:100%;min-width:0;margin:0;padding:32px;background:var(--form-bg);color:var(--form-fg);border-radius:16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;text-align:left}
.alva-form[data-theme="dark"]{--form-bg:#203c34;--form-fg:#f6f8f0;--form-muted:#c6d4cb;--field-bg:#f9fbf7;--field-border:#98afa0}
.alva-form[data-theme="transparent"]{--form-bg:transparent;--form-fg:inherit;--form-muted:inherit}
.alva-form *{box-sizing:border-box}
.alva-form h2,.alva-form h3{color:inherit;font-size:24px;line-height:1.25;margin:0 0 12px;letter-spacing:-.5px}
.alva-form p{color:var(--form-muted);font-size:14px;line-height:1.6;margin:0 0 20px}
.alva-form label{position:static;display:block;width:auto;margin:0 0 18px;padding:0;color:var(--form-fg);font-size:13px;line-height:1.5;font-weight:600;letter-spacing:normal;text-align:left}
.alva-form label span{position:static;font-size:inherit;line-height:inherit;letter-spacing:normal}
.alva-form input,.alva-form select,.alva-form textarea{position:static;display:block;width:100%;max-width:100%;min-width:0;height:auto;margin:7px 0 0;padding:13px 14px;border:1px solid var(--field-border);border-radius:7px;background:var(--field-bg);color:#203a32;font-family:inherit;font-size:16px;font-weight:400;line-height:1.4;letter-spacing:normal;box-shadow:none}
.alva-form input::placeholder,.alva-form textarea::placeholder{color:#66786e;opacity:1}
.alva-form input[type="checkbox"],.alva-form input[type="radio"]{display:inline-block;width:18px;height:18px;margin:0 8px 0 0;padding:0;vertical-align:middle;accent-color:#42634f}
.alva-form input[type="hidden"]{display:none}
.alva-form textarea{min-height:110px;resize:vertical}
.alva-form button,.alva-form input[type="submit"]{position:static;display:block;width:100%;margin:8px 0 0;padding:15px 20px;border:0;border-radius:7px;background:var(--button-bg);color:var(--button-fg);font-family:inherit;font-size:15px;font-weight:700;line-height:1.4;text-align:center;letter-spacing:normal;cursor:pointer}
.alva-form small{position:static;display:block;margin:15px 0 0;padding:0;color:var(--form-muted);font-size:11px;line-height:1.6;letter-spacing:normal}
.alva-form :is(input,textarea,select,button):focus-visible{outline:3px solid #6c9867;outline-offset:3px}
@media(max-width:600px){.alva-form{padding:24px}}
`;

/** Add only a class; never rebuild imported forms or their fields. Safe to call after load/drop. */
export function normalizeForms(editor) {
  const wrapper = editor?.getWrapper?.();
  if (!wrapper) return 0;
  const forms = wrapper.find?.('form') || [];
  if (String(wrapper.get?.('tagName') || '').toLowerCase() === 'form') forms.unshift(wrapper);
  for (const form of forms) {
    if (typeof form.addClass === 'function') form.addClass('alva-form');
    else {
      const attrs = form.getAttributes?.() || {};
      const classes = new Set(
        String(attrs.class || '')
          .split(/\s+/)
          .filter(Boolean),
      );
      classes.add('alva-form');
      form.addAttributes?.({ class: [...classes].join(' ') });
    }
  }
  // Inspect the project rather than caching editor identity: loading a different project resets CSS.
  const css = editor.getCss?.() || '';
  if (forms.length && !/--alva-form-base\s*:\s*1(?:\s*[;}])/.test(css)) {
    // GrapesJS merges equal selectors. Restore user declarations after filling base rules.
    const rules = editor.Css?.getAll?.();
    const custom =
      rules
        ?.filter?.((rule) => rule.selectorsToString?.().includes('.alva-form'))
        .map((rule) => ({ rule, style: { ...rule.getStyle() } })) || [];
    editor.addStyle?.(formCss);
    for (const { rule, style } of custom) rule.addStyle?.(style);
  }
  return forms.length;
}

const form = (button = 'Solicitar contato', theme = 'light') =>
  `<form class="alva-form" data-theme="${theme}" method="post" action="#" onsubmit="return false"><h3>Vamos conversar?</h3><p>Edite esta mensagem para explicar o que acontece depois do envio.</p><label>Seu nome<input type="text" name="nome" placeholder="Como podemos chamar você?" autocomplete="name" required></label><label>E-mail<input type="email" name="email" placeholder="voce@empresa.com.br" autocomplete="email" required></label><label>WhatsApp<input type="tel" name="telefone" placeholder="DDD + número" autocomplete="tel"></label><button type="submit">${button}</button><small>Inclua aqui a orientação de privacidade e o link da sua política.</small></form>`;
const nav = '<nav class="nav"><strong>SUA MARCA</strong><a href="#contato">Vamos conversar ↗</a></nav>';
const footer =
  '<footer class="lp-footer"><strong>SUA MARCA</strong><span>Edite aqui os dados e links da sua empresa.</span></footer>';
const benefits =
  '<section class="benefits"><p class="kicker">BENEFÍCIOS DA SUA SOLUÇÃO</p><h2>O que faz sentido<br>para o seu cliente?</h2><div class="cards"><article><span>01 /</span><h3>[Primeiro benefício]</h3><p>Descreva uma vantagem real da sua solução, com linguagem simples.</p></article><article><span>02 /</span><h3>[Segundo benefício]</h3><p>Explique o que muda na experiência de quem escolhe sua empresa.</p></article><article><span>03 /</span><h3>[Terceiro benefício]</h3><p>Acrescente um diferencial verificável e relevante para seu público.</p></article></div></section>';
const faq =
  '<section class="faq"><p class="kicker">DÚVIDAS FREQUENTES</p><h2>Antes do próximo passo.</h2><details open><summary>[Pergunta sobre a solução]</summary><p>Edite com uma resposta clara e baseada na sua oferta.</p></details><details><summary>[Pergunta sobre o atendimento]</summary><p>Descreva como funciona seu processo de atendimento.</p></details><details><summary>[Pergunta sobre condições]</summary><p>Inclua apenas condições confirmadas da sua oferta.</p></details></section>';
const contact = `<section id="contato" class="contact"><div><p class="kicker">SEU PRÓXIMO PASSO</p><h2>Conte o que<br>você precisa.</h2><p>Edite a orientação de contato para seu cliente.</p></div>${form()}</section>`;
export const templateCss = `*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:#203a32;font-family:Arial,Helvetica,sans-serif;background:#faf9f5}a{color:inherit}h1,h2,h3,p{margin-top:0}h1{font-size:clamp(38px,5.2vw,72px);line-height:1.04;letter-spacing:-2.5px;max-width:820px}h2{font-size:clamp(28px,3.5vw,44px);letter-spacing:-1.2px;line-height:1.12}p{line-height:1.7}.hero{padding:30px 7% 80px;background:#f1f1e9}.nav{display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:70px}.nav strong{font-size:15px;letter-spacing:2px}.nav a{text-decoration:none;font-size:14px}.hero-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:64px;align-items:center}.hero-grid>*{min-width:0}.kicker{font-size:11px;letter-spacing:2px;font-weight:700;margin-bottom:24px}.lead{font-size:18px;line-height:1.7;max-width:580px;color:#607068}.cta{display:inline-block;padding:17px 24px;background:#d7ec95;border:0;border-radius:7px;color:#203a32;font-weight:700;text-decoration:none;font-size:14px;cursor:pointer}.hero-art{position:relative;min-height:360px;border-radius:130px 12px 12px;background:#264e42;color:#e4eacb;padding:42px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end}.art-circle{position:absolute;border:1px solid #779277;width:300px;height:300px;border-radius:50%;top:-70px;right:-80px;box-shadow:0 0 0 35px #ffffff08,0 0 0 70px #ffffff05}.hero-art>.art-title{font-size:32px;line-height:1.2;position:relative}.hero-art>.art-caption{font-size:10px;letter-spacing:2px;margin-top:32px}.benefits,.faq,.testimonials{padding:80px 7%}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:32px;margin-top:44px}.cards article{border-top:1px solid #cdd3c9;padding-top:24px}.cards article>span{color:#6b805e;font-size:12px}.cards h3{margin-top:28px;font-size:20px}.cards p{color:#617269;font-size:15px}.contact{padding:70px 7%;background:#e9eddf;display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center}.faq{max-width:1100px;margin:auto}.faq details{border-bottom:1px solid #cdd3c9;padding:22px 0}.faq summary{font-weight:700;cursor:pointer}.faq details p{margin:16px 0 0}.lp-footer{padding:30px 7%;font-size:12px;display:flex;gap:24px;justify-content:space-between}.lp-footer span{color:#637168}.editor-note{font-size:12px;color:#637168}.testimonials blockquote{margin:24px 0;padding:28px;border-left:3px solid #819475;background:#f0f1ea}.material-symbols-outlined{font-family:'Material Symbols Outlined';font-weight:normal;font-style:normal;font-size:48px;line-height:1;letter-spacing:normal;text-transform:none;white-space:nowrap;word-wrap:normal;direction:ltr;font-feature-settings:'liga';font-variation-settings:'FILL' 0,'wght' 450,'GRAD' 0,'opsz' 48}.alva-chart{padding:28px;border:1px solid #d9e1dc;border-radius:18px;background:#fff}.alva-chart-bars{display:flex;align-items:end;gap:18px;height:230px}.alva-chart-bars div{display:flex;flex:1;flex-direction:column;justify-content:end;gap:9px;height:100%;text-align:center}.alva-chart-bars i{display:block;height:var(--value);border-radius:9px 9px 3px 3px;background:linear-gradient(#286eea,#80d6c2);animation:alva-grow .9s both}.alva-chart-bars small{font-size:12px}.alva-donut{display:grid;place-items:center;width:min(260px,80vw);aspect-ratio:1;margin:auto;border-radius:50%;background:conic-gradient(#286eea 0 52%,#80d6c2 52% 78%,#ffc76b 78%);position:relative}.alva-donut:after{content:'';position:absolute;inset:24%;border-radius:50%;background:#fff}.alva-donut strong{position:relative;z-index:1}[data-alva-motion]{animation-duration:var(--alva-duration,.65s);animation-delay:var(--alva-delay,0s);animation-fill-mode:both}[data-alva-motion='fade-up']{animation-name:alva-fade-up}[data-alva-motion='slide-left']{animation-name:alva-slide-left}[data-alva-motion='zoom-in']{animation-name:alva-zoom-in}[data-alva-motion='float']{animation:alva-float var(--alva-duration,3s) ease-in-out var(--alva-delay,0s) infinite}@keyframes alva-fade-up{from{opacity:0;transform:translateY(28px)}}@keyframes alva-slide-left{from{opacity:0;transform:translateX(48px)}}@keyframes alva-zoom-in{from{opacity:0;transform:scale(.92)}}@keyframes alva-float{50%{transform:translateY(-8px)}}@keyframes alva-grow{from{height:0}}@media(prefers-reduced-motion:reduce){[data-alva-motion],.alva-chart-bars i{animation:none!important}}@media(max-width:760px){.hero-grid,.contact,.cards{grid-template-columns:1fr;gap:30px}.nav{margin-bottom:42px}.hero{padding-bottom:44px}.hero-art{min-height:260px}.benefits,.faq,.testimonials{padding:48px 7%}.contact{padding:44px 7%}.lp-footer{flex-direction:column}h1{letter-spacing:-1.5px}}${formCss}`;

export const services = `<main class="services-page"><section class="hero">${nav}<div class="hero-grid"><div><p class="kicker">[SEU SERVIÇO · SEU PÚBLICO]</p><h1>Uma solução para o próximo passo do seu negócio.</h1><p class="lead">Apresente seu serviço e o problema que ele ajuda a resolver. Troque este texto por uma proposta específica da sua empresa.</p><p class="editor-note">[Inclua aqui uma credencial real, se houver.]</p></div><div id="contato">${form('Quero conhecer o serviço')}</div></div></section>${benefits}${faq}${footer}</main>`;
const presentation = `<main class="presentation-page"><section class="hero">${nav}<div class="hero-grid"><div><p class="kicker">CONHEÇA A [SUA MARCA]</p><h1>Uma história que merece ser contada.</h1><p class="lead">Apresente a essência da empresa e o que orienta seu trabalho.</p><a class="cta" href="#historia">Conheça nossa abordagem ↓</a></div><div class="hero-art"><div class="art-circle"></div><span class="art-title">Seu propósito.<br>Sua identidade.</span><small class="art-caption">ESPAÇO PARA SUA MENSAGEM</small></div></div></section><section class="story" id="historia"><p class="kicker">NOSSA HISTÓRIA</p><h2>[O que trouxe sua empresa até aqui]</h2><p>Conte a origem, os princípios e a forma de trabalhar da sua empresa. Use fatos reais e exemplos que ajudem o visitante a conhecê-la.</p></section>${benefits}${contact}${footer}</main>`;
const offer = `<main class="offer-page"><section class="offer-top"><p class="kicker">[NOME DA OFERTA]</p><h1>Apresente sua oferta.<br>Deixe a escolha clara.</h1><p class="lead">Explique para quem é, o que está incluído e qual necessidade atende.</p><a href="#contato" class="cta">Quero saber as condições ↗</a></section><section class="offer-layout"><div><p class="kicker">O QUE ESTÁ INCLUÍDO</p><h2>[Nome da solução]</h2><ul class="offer-list"><li>[Primeira entrega incluída]</li><li>[Segunda entrega incluída]</li><li>[Formato e condições de atendimento]</li></ul><p class="offer-price">[Investimento e condições]</p><p>Preencha com os valores e condições confirmados. Remova este texto de orientação antes de publicar.</p></div><div id="contato">${form('Consultar a oferta', 'dark')}</div></section>${faq}${footer}</main>`;
const event = `<main class="event-page"><section class="event-hero"><nav class="nav"><strong>[NOME DO EVENTO]</strong><span>[Online ou presencial]</span></nav><p class="kicker">UM ENCONTRO SOBRE [TEMA]</p><h1>Uma ideia.<br>Um encontro.<br>Novas conversas.</h1><div class="event-meta"><p><strong>Quando</strong><br>[Data e horário]</p><p><strong>Onde</strong><br>[Local ou plataforma]</p></div><a class="cta" href="#contato">Quero participar ↓</a></section><section class="event-agenda"><div><p class="kicker">PROGRAMAÇÃO</p><h2>O que está na pauta?</h2><article><span>[Horário]</span><h3>[Tema da abertura]</h3><p>[Descrição e responsável confirmado]</p></article><article><span>[Horário]</span><h3>[Tema da conversa]</h3><p>[Descrição e responsável confirmado]</p></article></div><div id="contato">${form('Solicitar inscrição')}</div></section>${footer}</main>`;
const thanks = `<main class="thanks-page"><nav class="nav"><strong>SUA MARCA</strong></nav><section class="thanks-card"><div class="thanks-symbol" aria-hidden="true">✓</div><p class="kicker">PÁGINA DE CONFIRMAÇÃO</p><h1>Obrigado pelo seu interesse.</h1><p class="lead">[Explique aqui o próximo passo após a confirmação do envio.]</p><div class="next-step"><h2>E agora?</h2><p>[Informe o canal de retorno e o que a pessoa precisa fazer em seguida.]</p></div><a class="cta" href="/">Voltar ao início ↗</a><p class="editor-note">Configure esta página como destino apenas depois que o formulário confirmar o envio.</p></section>${footer}</main>`;
export const templates = [
  {
    id: 'blank',
    name: 'Página em branco',
    description: 'Uma tela limpa para começar do seu jeito.',
    category: 'Livre',
    html: '',
    css: formCss,
  },
  {
    id: 'services',
    name: 'Serviços · contato na abertura',
    description: 'Proposta e formulário lado a lado, com benefícios e dúvidas.',
    category: 'Captação',
    html: services,
    css: templateCss,
  },
  {
    id: 'presentation',
    name: 'Apresentação da empresa',
    description: 'Identidade, história e benefícios antes do contato final.',
    category: 'Institucional',
    html: presentation,
    css:
      templateCss +
      ' .presentation-page .hero{background:#f4e9dc}.presentation-page .hero-art{background:#714d3b;color:#fff0d6}.story{padding:90px 14%;max-width:1200px}.story p:last-child{font-size:21px;line-height:1.8}.presentation-page .contact{background:#f1e5d7}',
  },
  {
    id: 'offer',
    name: 'Oferta direta',
    description: 'Uma oferta em destaque, entregas e consulta de condições.',
    category: 'Conversão',
    html: offer,
    css:
      templateCss +
      ' .offer-page{background:#f6f5f0;color:#232528}.offer-top{padding:90px 7%;text-align:center;background:#24282d;color:#fff}.offer-top h1,.offer-top .lead{margin-left:auto;margin-right:auto}.offer-top .lead{color:#c8cecb}.offer-top .cta{background:#ffc76b;color:#28251f}.offer-layout{padding:80px 7%;display:grid;grid-template-columns:1fr 1fr;gap:70px;align-items:start}.offer-list{padding-left:22px;line-height:2.5}.offer-price{font-size:28px;font-weight:bold}.offer-page .alva-form{--button-bg:#ffc76b}@media(max-width:760px){.offer-top{padding:55px 7%}.offer-layout{grid-template-columns:1fr;padding:48px 7%;gap:32px}}',
  },
  {
    id: 'event',
    name: 'Evento · inscrição',
    description: 'Data, local, programação e formulário para participantes.',
    category: 'Eventos',
    html: event,
    css:
      templateCss +
      ' .event-page{background:#f5f1ff;color:#312548}.event-hero{padding:30px 7% 75px;background:#382554;color:#fff}.event-hero h1{font-size:clamp(48px,8vw,100px)}.event-hero .cta{background:#ebcfff;color:#382554}.event-meta{display:flex;gap:65px;padding:15px 0}.event-meta p{color:#e1d3f2}.event-agenda{display:grid;grid-template-columns:1fr 1fr;gap:70px;padding:80px 7%;align-items:start}.event-agenda article{padding:24px 0;border-top:1px solid #cdbce4}.event-agenda article span{font-size:12px;color:#6a567e}.event-agenda article h3{margin:12px 0}.event-page .alva-form{--button-bg:#583b7e;--button-fg:#fff}@media(max-width:760px){.event-agenda{grid-template-columns:1fr;padding:48px 7%;gap:32px}.event-meta{gap:30px}}',
  },
  {
    id: 'thanks',
    name: 'Obrigado · próximos passos',
    description: 'Página de confirmação com orientação para continuar.',
    category: 'Pós-conversão',
    html: thanks,
    css:
      templateCss +
      ' .thanks-page{min-height:100vh;padding:30px 7% 0;background:#eaf0e5}.thanks-card{max-width:740px;text-align:center;margin:50px auto 90px}.thanks-card h1{font-size:clamp(40px,6vw,68px)}.thanks-card .lead{margin:0 auto 30px}.thanks-symbol{display:grid;place-items:center;width:76px;height:76px;background:#d2e899;border-radius:50%;font-size:38px;margin:0 auto 28px}.next-step{text-align:left;background:#fff;padding:28px;border-radius:14px;margin:30px 0}.next-step h2{font-size:23px}.thanks-card .editor-note{margin-top:24px}.thanks-page .lp-footer{padding-left:0;padding-right:0}',
  },
];
/** Exact catalog lookup: input is never interpolated into markup or selectors. */
export function getTemplate(id) {
  return templates.find((template) => template.id === id);
}

export const blocks = [
  [
    'section',
    'Seção',
    'Estrutura',
    '<section style="padding:60px 7%;min-height:140px"><h2>Uma nova seção</h2><p>Conte sua história aqui.</p></section>',
  ],
  [
    'columns',
    'Duas colunas',
    'Estrutura',
    '<div style="display:flex;flex-wrap:wrap;gap:24px;padding:30px"><div style="flex:1;min-width:240px;min-height:100px"><h3>Primeira coluna</h3></div><div style="flex:1;min-width:240px;min-height:100px"><h3>Segunda coluna</h3></div></div>',
  ],
  ['heading', 'Título', 'Conteúdo', '<h2>Seu próximo grande título</h2>'],
  ['text', 'Texto', 'Conteúdo', '<p>Uma mensagem simples para apresentar sua solução.</p>'],
  ['image', 'Imagem', 'Conteúdo', { type: 'image' }],
  ['button', 'Botão', 'Conteúdo', '<a href="#contato" class="cta">Quero saber mais ↗</a>'],
  ['icon', 'Ícone', 'Conteúdo', '<span class="material-symbols-outlined" aria-hidden="true">star</span>'],
  ['bar-chart', 'Gráfico de barras', 'Gráficos', '<div class="alva-chart alva-chart-bars"><div><i style="--value:72%"></i><small>Visitas</small></div><div><i style="--value:48%"></i><small>Contatos</small></div><div><i style="--value:86%"></i><small>Vendas</small></div></div>'],
  ['donut-chart', 'Gráfico circular', 'Gráficos', '<div class="alva-chart"><div class="alva-donut"><strong>Resultados</strong></div></div>'],
  ['form', 'Formulário', 'Captação', form()],
  [
    'input',
    'Campo de texto',
    'Captação',
    '<label>Novo campo<input name="novo_campo" type="text" placeholder="Digite aqui"></label>',
  ],
  [
    'hero-section',
    'Abertura com formulário',
    'Seções prontas',
    `<section class="hero"><div class="hero-grid"><div><p class="kicker">[SUA SOLUÇÃO]</p><h1>Seu próximo grande título.</h1><p class="lead">Apresente sua proposta em uma frase clara.</p></div>${form()}</div></section>`,
  ],
  ['benefits-section', 'Benefícios', 'Seções prontas', benefits],
  [
    'testimonials-section',
    'Depoimento · preencher',
    'Seções prontas',
    '<section class="testimonials"><p class="kicker">EXPERIÊNCIAS REAIS</p><h2>[O que seus clientes dizem]</h2><blockquote><p>[Insira um depoimento real e autorizado. Este espaço é um placeholder.]</p><cite>[Nome e identificação autorizados]</cite></blockquote></section>',
  ],
  ['faq-section', 'Perguntas frequentes', 'Seções prontas', faq],
  ['contact-section', 'Contato', 'Seções prontas', contact],
];
