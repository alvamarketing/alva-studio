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

export const embedVideoCss = `.alva-embed-video{position:relative;aspect-ratio:16/9;min-height:180px;overflow:hidden;border:1px solid #d9e1dc;border-radius:20px;background:#111}.alva-embed-video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}.alva-embed-video-placeholder{display:none;margin:0;min-height:180px;place-items:center;padding:24px;background:#f3f5f2;color:#607068;text-align:center}.alva-embed-video[data-alva-video-empty="true"] iframe{display:none}.alva-embed-video[data-alva-video-empty="true"] .alva-embed-video-placeholder{display:grid}`;

/** Add only a class; never rebuild imported forms or their fields. Safe to call after load/drop. */
export function normalizeForms(editor, uuid = () => globalThis.crypto?.randomUUID?.()) {
  const wrapper = editor?.getWrapper?.();
  if (!wrapper) return 0;
  const forms = [];
  const seen = new Set();
  const addForm = (component) => {
    if (!component || seen.has(component)) return;
    seen.add(component);
    if (String(component.get?.('tagName') || '').toLowerCase() === 'form') forms.push(component);
    (component.components?.().models || []).forEach(addForm);
  };
  // Component#find does not include newly appended native form components in
  // headless GrapesJS. Use both paths so imported and newly inserted models work.
  (wrapper.find?.('form') || []).forEach((form) => {
    if (!seen.has(form)) { seen.add(form); forms.push(form); }
  });
  addForm(wrapper);
  const captureIds = new Set();
  for (const form of forms) {
    const attrs = form.getAttributes?.() || {};
    const classes = String(attrs.class || '').split(/\s+/).filter(Boolean);
    const captureId = String(attrs['data-alva-capture-id'] || '').trim();
    const validCaptureId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(captureId);
    const next = {};
    if (!classes.includes('alva-form')) next.class = [...classes, 'alva-form'].join(' ');
    if (!validCaptureId || captureIds.has(captureId)) {
      const generated = uuid();
      if (!generated) throw new Error('Não foi possível identificar o formulário.');
      next['data-alva-capture-id'] = generated;
      captureIds.add(generated);
    } else captureIds.add(captureId);
    if (Object.keys(next).length) form.addAttributes?.(next);
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

export function syncFormDelivery(form, webhook = '') {
  const attrs = form?.getAttributes?.() || {};
  const next = {};
  if (attrs.method !== 'post') next.method = 'post';
  if (attrs.action !== (webhook || '#')) next.action = webhook || '#';
  // The editor parser intentionally strips inline handlers. Re-adding onsubmit
  // during every save would create a fresh history mutation after an undo.
  if (webhook && Object.hasOwn(attrs, 'onsubmit')) form.removeAttributes?.('onsubmit');
  if (Object.keys(next).length) form.addAttributes?.(next);
  return Object.keys(next).length + (webhook && Object.hasOwn(attrs, 'onsubmit') ? 1 : 0);
}

const form = (button = 'Solicitar contato', theme = 'light') =>
  `<form class="alva-form" data-theme="${theme}" method="post" action="#" onsubmit="return false"><h3>Vamos conversar?</h3><p>Edite esta mensagem para explicar o que acontece depois do envio.</p><label>Seu nome<input type="text" name="nome" placeholder="Como podemos chamar você?" autocomplete="name" required></label><label>E-mail<input type="email" name="email" placeholder="voce@empresa.com.br" autocomplete="email" required></label><label>WhatsApp<input type="tel" name="telefone" placeholder="DDD + número" autocomplete="tel"></label><button type="submit">${button}</button><small>Inclua o link da política de privacidade. A medição usa identificadores pseudônimos de atribuição e processamento limitado sem autorização de PII direta.</small></form>`;
const nav = '<nav class="nav"><strong>SUA MARCA</strong><a href="#contato">Vamos conversar ↗</a></nav>';
const footer =
  '<footer class="lp-footer"><strong>SUA MARCA</strong><span>Edite aqui os dados e links da sua empresa.</span></footer>';
const benefits =
  '<section class="benefits"><p class="kicker">BENEFÍCIOS DA SUA SOLUÇÃO</p><h2>O que faz sentido<br>para o seu cliente?</h2><div class="cards"><article><span>01 /</span><h3>[Primeiro benefício]</h3><p>Descreva uma vantagem real da sua solução, com linguagem simples.</p></article><article><span>02 /</span><h3>[Segundo benefício]</h3><p>Explique o que muda na experiência de quem escolhe sua empresa.</p></article><article><span>03 /</span><h3>[Terceiro benefício]</h3><p>Acrescente um diferencial verificável e relevante para seu público.</p></article></div></section>';
const faq =
  '<section class="faq"><p class="kicker">DÚVIDAS FREQUENTES</p><h2>Antes do próximo passo.</h2><details open><summary>[Pergunta sobre a solução]</summary><p>Edite com uma resposta clara e baseada na sua oferta.</p></details><details><summary>[Pergunta sobre o atendimento]</summary><p>Descreva como funciona seu processo de atendimento.</p></details><details><summary>[Pergunta sobre condições]</summary><p>Inclua apenas condições confirmadas da sua oferta.</p></details></section>';
const contact = `<section id="contato" class="contact"><div><p class="kicker">SEU PRÓXIMO PASSO</p><h2>Conte o que<br>você precisa.</h2><p>Edite a orientação de contato para seu cliente.</p></div>${form()}</section>`;
export const chartCss = `.alva-chart{padding:28px;border:1px solid #d9e1dc;border-radius:18px;background:#fff}.alva-chart-bars{display:flex;align-items:end;gap:18px;height:var(--alva-chart-height,230px)}.alva-chart-bars div{display:flex;flex:1;flex-direction:column;justify-content:end;gap:9px;height:100%;text-align:center}.alva-chart-bars i{display:block;height:var(--value);border-radius:9px 9px 3px 3px;background:linear-gradient(var(--alva-bar-from,#286eea),var(--alva-bar-to,#80d6c2));animation:alva-grow .9s both}.alva-chart-bars small{font-size:12px}.alva-donut{display:grid;place-items:center;width:260px;max-width:80vw;aspect-ratio:1;margin:auto;border-radius:50%;background:conic-gradient(var(--alva-chart-segments,#286eea 0 52%,#80d6c2 52% 78%,#ffc76b 78%));position:relative}.alva-donut:after{content:'';position:absolute;inset:24%;border-radius:50%;background:#fff}.alva-donut strong{position:relative;z-index:1}`;

/** Add graph styles to imported pages without replacing their existing CSS. */
export const chartDonutBackgroundCss = `.alva-donut-background{background-image:conic-gradient(#286eea 0 52%,#80d6c2 52% 78%,#ffc76b 78% 100%)}`;

export function donutBackgroundFromData(value) {
  const fallback = [['Visitas', 52], ['Contatos', 26], ['Vendas', 22]];
  let rows = fallback;
  try {
    const parsed = JSON.parse(String(value || ''));
    if (Array.isArray(parsed) && parsed.length >= 2) rows = parsed.slice(0, 8);
  } catch {}
  const values = rows.map((row) => Number(row?.[1] ?? row?.value));
  if (values.some((number) => !Number.isFinite(number) || number < 0)) values.splice(0, values.length, ...fallback.map((row) => row[1]));
  const total = values.reduce((sum, number) => sum + number, 0);
  const safeValues = total > 0 && Number.isFinite(total) ? values : fallback.map((row) => row[1]);
  const safeTotal = safeValues.reduce((sum, number) => sum + number, 0);
  const colors = ['#286eea', '#80d6c2', '#ffc76b', '#8f7ee8', '#ed8bb3', '#66b9e8', '#9ac85c', '#dca768'];
  let start = 0;
  const stops = safeValues.map((number, index) => {
    const end = start + (number / safeTotal) * 100;
    const stop = `${colors[index]} ${start}% ${end}%`;
    start = end;
    return stop;
  });
  return `conic-gradient(${stops.join(',')})`;
}

export function normalizeCharts(editor) {
  const css = editor?.getCss?.() || '';
  const donutRules = (css.match(/\.alva-donut(?![:\w-])\s*\{[^}]*}/g) || []).join('');
  const backgroundValues = [...donutRules.matchAll(/background(?:-image)?\s*:\s*([^;}]+)/gi)].map((match) => match[1]);
  const hasDonutBackground = backgroundValues.some((value) => !/^none\b/i.test(value) && !value.includes('--alva-chart-segments'));
  const hasNormalizedBackground = /\.alva-donut-background\s*\{[^}]*background-image\s*:\s*conic-gradient/i.test(css);
  const needsBase = !(css.includes('.alva-chart-bars') && css.includes('.alva-donut') && (hasDonutBackground || hasNormalizedBackground));
  if (needsBase) {
    // GrapesJS merges same-selector rules. Reapply the project declarations after
    // installing the missing base so an imported chart keeps its own design.
    const custom = editor?.Css?.getAll?.().map((rule) => ({
      selector: rule.selectorsToString?.(),
      style: { ...rule.getStyle?.() },
    })) || [];
    const added = editor?.addStyle?.(chartCss + chartDonutBackgroundCss) || [];
    added.forEach((rule) => {
      const selector = rule.selectorsToString?.();
      custom.filter((entry) => entry.selector === selector).forEach((entry) => rule.addStyle?.(entry.style));
    });
  }
  const applyBackgroundClass = (component) => {
    if ((component?.getClasses?.() || []).includes('alva-donut')) {
      component.addClass?.('alva-donut-background');
      const style = component.getStyle?.() || {};
      const background = String(style.background || '');
      const backgroundImage = String(style['background-image'] || '');
      const values = [background, backgroundImage].filter(Boolean);
      const legacyFallback = 'conic-gradient(#286eea, #80d6c2, #ffc76b)';
      const hasLegacyFallback = values.includes(legacyFallback);
      const hasOnlyMissingBackground = !values.length || values.every((value) => value === 'none' || value.includes('--alva-chart-segments'));
      const needsBackground = hasLegacyFallback || (hasOnlyMissingBackground && !hasDonutBackground);
      if (needsBackground)
        component.addStyle?.({ background: donutBackgroundFromData(component.getAttributes?.()['data-alva-chart-data']) });
    }
    (component?.components?.().models || []).forEach(applyBackgroundClass);
  };
  applyBackgroundClass(editor?.getWrapper?.());
  return needsBase;
}
// Regras de comportamento do editor — movimento, ícone, gráficos e VSL. Ficam separadas do
// visual porque precisam valer em toda página, inclusive nas salvas antes de existirem:
// o visual só é aplicado uma vez, na criação, e congela com a página.
export const RUNTIME_CSS_VERSION = 3;

export const runtimeCss = `:root{--alva-runtime:3}.alva-carousel{position:relative;margin-top:32px}.alva-carousel-track{display:flex;gap:20px;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;padding:4px;scrollbar-width:none}.alva-carousel-track::-webkit-scrollbar{display:none}.alva-testimonial{flex:0 0 min(420px,84%);scroll-snap-align:center;margin:0;padding:28px;border:1px solid var(--alva-testimonial-border,#d9e1dc);border-radius:18px;background:var(--alva-testimonial-bg,#fff);box-shadow:0 10px 30px rgb(16 24 40 / 5%)}.alva-testimonial blockquote{margin:14px 0 18px;padding:0;border:0;background:none}.alva-testimonial blockquote p{margin:0;font-size:16px;line-height:1.6}.alva-testimonial figcaption{color:#607068;font-size:13px;font-style:italic}.alva-stars{color:var(--alva-stars-color,#ffb84d);font-size:16px;letter-spacing:3px}.alva-carousel-nav{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}.alva-carousel-button{width:38px;height:38px;border:1px solid #d9e1dc;border-radius:50%;background:#fff;color:#203a32;font-size:18px;line-height:1;cursor:pointer}.alva-carousel-button:hover{background:#f1f1e9}.faq details{border:1px solid #e0e5df;border-radius:14px;background:#fff;padding:18px 20px;margin-bottom:10px}.faq summary{display:flex;align-items:center;justify-content:space-between;gap:16px;font-weight:700;cursor:pointer;list-style:none}.faq summary::-webkit-details-marker{display:none}.faq summary::after{content:'+';font-size:20px;font-weight:400;color:#6b805e;transition:transform .2s}.faq details[open] summary::after{content:'–'}.faq details p{margin:14px 0 0;color:#617269}.material-symbols-outlined{font-size:var(--alva-icon-size,48px)}.alva-chart{padding:28px;border:1px solid #d9e1dc;border-radius:18px;background:#fff}.alva-chart-bars{display:flex;align-items:end;gap:18px;height:var(--alva-chart-height,230px)}.alva-chart-bars div{display:flex;flex:1;flex-direction:column;justify-content:end;gap:9px;height:100%;text-align:center}.alva-chart-bars i{display:block;height:var(--value);border-radius:9px 9px 3px 3px;background:linear-gradient(var(--alva-bar-from,#286eea),var(--alva-bar-to,#80d6c2));animation:alva-grow .9s both}.alva-chart-bars small{font-size:12px}.alva-donut{display:grid;place-items:center;width:min(260px,80vw);aspect-ratio:1;margin:auto;border-radius:50%;background:conic-gradient(#286eea 0 52%,#80d6c2 52% 78%,#ffc76b 78%);position:relative}.alva-donut:after{content:'';position:absolute;inset:24%;border-radius:50%;background:#fff}.alva-donut strong{position:relative;z-index:1}.alva-vsl{width:100%;min-height:220px;display:grid;place-items:center;overflow:hidden;border:1px solid #d9e1dc;border-radius:16px;background:#f3f5f2}.alva-vsl-frame{display:block;width:100%;min-height:220px;aspect-ratio:16/9;border:0;background:#101828}.alva-vsl-empty{padding:28px;color:#607068;text-align:center}[data-alva-motion]{animation-duration:var(--alva-duration,.65s);animation-delay:var(--alva-delay,0s);animation-fill-mode:both}[data-alva-motion='fade-up']{animation-name:alva-fade-up}[data-alva-motion='slide-left']{animation-name:alva-slide-left}[data-alva-motion='zoom-in']{animation-name:alva-zoom-in}[data-alva-motion='float']{animation:alva-float var(--alva-duration,3s) ease-in-out var(--alva-delay,0s) infinite}.cards article>span.material-symbols-outlined{font-size:var(--alva-icon-size,48px)}@keyframes alva-fade-up{from{opacity:0;transform:translateY(28px)}}@keyframes alva-slide-left{from{opacity:0;transform:translateX(48px)}}@keyframes alva-zoom-in{from{opacity:0;transform:scale(.92)}}@keyframes alva-float{50%{transform:translateY(-8px)}}@keyframes alva-grow{from{height:0}}@media(prefers-reduced-motion:reduce){[data-alva-motion],.alva-chart-bars i{animation:none!important}}`;

export const templateCss = `*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:#203a32;font-family:Arial,Helvetica,sans-serif;background:#faf9f5}a{color:inherit}h1,h2,h3,p{margin-top:0}h1{font-size:clamp(38px,5.2vw,72px);line-height:1.04;letter-spacing:-2.5px;max-width:820px}h2{font-size:clamp(28px,3.5vw,44px);letter-spacing:-1.2px;line-height:1.12}p{line-height:1.7}.hero{padding:30px 7% 80px;background:#f1f1e9}.nav{display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:70px}.nav strong{font-size:15px;letter-spacing:2px}.nav a{text-decoration:none;font-size:14px}.hero-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:64px;align-items:center}.hero-grid>*{min-width:0}.kicker{font-size:11px;letter-spacing:2px;font-weight:700;margin-bottom:24px}.lead{font-size:18px;line-height:1.7;max-width:580px;color:#607068}.cta{display:inline-block;padding:17px 24px;background:#d7ec95;border:0;border-radius:7px;color:#203a32;font-weight:700;text-decoration:none;font-size:14px;cursor:pointer}.hero-art{position:relative;min-height:360px;border-radius:130px 12px 12px;background:#264e42;color:#e4eacb;padding:42px;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end}.art-circle{position:absolute;border:1px solid #779277;width:300px;height:300px;border-radius:50%;top:-70px;right:-80px;box-shadow:0 0 0 35px #ffffff08,0 0 0 70px #ffffff05}.hero-art>.art-title{font-size:32px;line-height:1.2;position:relative}.hero-art>.art-caption{font-size:10px;letter-spacing:2px;margin-top:32px}.benefits,.faq,.testimonials{padding:80px 7%}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:32px;margin-top:44px}.cards article{border-top:1px solid #cdd3c9;padding-top:24px}.cards article>span{color:#6b805e;font-size:12px}.cards article>span.material-symbols-outlined{font-size:var(--alva-icon-size,48px)}.cards h3{margin-top:28px;font-size:20px}.cards p{color:#617269;font-size:15px}.contact{padding:70px 7%;background:#e9eddf;display:grid;grid-template-columns:1fr 1fr;gap:64px;align-items:center}.faq{max-width:1100px;margin:auto}.faq details{border-bottom:1px solid #cdd3c9;padding:22px 0}.faq summary{font-weight:700;cursor:pointer}.faq details p{margin:16px 0 0}.lp-footer{padding:30px 7%;font-size:12px;display:flex;gap:24px;justify-content:space-between}.lp-footer span{color:#637168}.editor-note{font-size:12px;color:#637168}.testimonials blockquote{margin:24px 0;padding:28px;border-left:3px solid #819475;background:#f0f1ea}.material-symbols-outlined{font-family:'Material Symbols Outlined';font-weight:normal;font-style:normal;font-size:var(--alva-icon-size,48px);line-height:1;letter-spacing:normal;text-transform:none;white-space:nowrap;word-wrap:normal;direction:ltr;font-feature-settings:'liga';font-variation-settings:'FILL' 0,'wght' 450,'GRAD' 0,'opsz' 48}.alva-chart{padding:28px;border:1px solid #d9e1dc;border-radius:18px;background:#fff}.alva-chart-bars{display:flex;align-items:end;gap:18px;height:var(--alva-chart-height,230px)}.alva-chart-bars div{display:flex;flex:1;flex-direction:column;justify-content:end;gap:9px;height:100%;text-align:center}.alva-chart-bars i{display:block;height:var(--value);border-radius:9px 9px 3px 3px;background:linear-gradient(var(--alva-bar-from,#286eea),var(--alva-bar-to,#80d6c2));animation:alva-grow .9s both}.alva-chart-bars small{font-size:12px}.alva-donut{display:grid;place-items:center;width:min(260px,80vw);aspect-ratio:1;margin:auto;border-radius:50%;background:conic-gradient(#286eea 0 52%,#80d6c2 52% 78%,#ffc76b 78%);position:relative}.alva-donut:after{content:'';position:absolute;inset:24%;border-radius:50%;background:#fff}.alva-donut strong{position:relative;z-index:1}.alva-vsl{width:100%;min-height:220px;display:grid;place-items:center;overflow:hidden;border:1px solid #d9e1dc;border-radius:16px;background:#f3f5f2}.alva-vsl-frame{display:block;width:100%;min-height:220px;aspect-ratio:16/9;border:0;background:#101828}.alva-vsl-empty{padding:28px;color:#607068;text-align:center}[data-alva-motion]{animation-duration:var(--alva-duration,.65s);animation-delay:var(--alva-delay,0s);animation-fill-mode:both}[data-alva-motion='fade-up']{animation-name:alva-fade-up}[data-alva-motion='slide-left']{animation-name:alva-slide-left}[data-alva-motion='zoom-in']{animation-name:alva-zoom-in}[data-alva-motion='float']{animation:alva-float var(--alva-duration,3s) ease-in-out var(--alva-delay,0s) infinite}@keyframes alva-fade-up{from{opacity:0;transform:translateY(28px)}}@keyframes alva-slide-left{from{opacity:0;transform:translateX(48px)}}@keyframes alva-zoom-in{from{opacity:0;transform:scale(.92)}}@keyframes alva-float{50%{transform:translateY(-8px)}}@keyframes alva-grow{from{height:0}}@media(prefers-reduced-motion:reduce){[data-alva-motion],.alva-chart-bars i{animation:none!important}}@media(max-width:760px){.hero-grid,.contact,.cards{grid-template-columns:1fr;gap:30px}.nav{margin-bottom:42px}.hero{padding-bottom:44px}.hero-art{min-height:260px}.benefits,.faq,.testimonials{padding:48px 7%}.contact{padding:44px 7%}.lp-footer{flex-direction:column}h1{letter-spacing:-1.5px}}${formCss}${embedVideoCss}`;

export const services = `<main class="services-page"><section class="hero">${nav}<div class="hero-grid"><div><p class="kicker">[SEU SERVIÇO · SEU PÚBLICO]</p><h1>Uma solução para o próximo passo do seu negócio.</h1><p class="lead">Apresente seu serviço e o problema que ele ajuda a resolver. Troque este texto por uma proposta específica da sua empresa.</p><p class="editor-note">[Inclua aqui uma credencial real, se houver.]</p></div><div id="contato">${form('Quero conhecer o serviço')}</div></div></section>${benefits}${faq}${footer}</main>`;
const presentation = `<main class="presentation-page"><section class="hero">${nav}<div class="hero-grid"><div><p class="kicker">CONHEÇA A [SUA MARCA]</p><h1>Uma história que merece ser contada.</h1><p class="lead">Apresente a essência da empresa e o que orienta seu trabalho.</p><a class="cta" href="#historia">Conheça nossa abordagem ↓</a></div><div class="hero-art"><div class="art-circle"></div><span class="art-title">Seu propósito.<br>Sua identidade.</span><small class="art-caption">ESPAÇO PARA SUA MENSAGEM</small></div></div></section><section class="story" id="historia"><p class="kicker">NOSSA HISTÓRIA</p><h2>[O que trouxe sua empresa até aqui]</h2><p>Conte a origem, os princípios e a forma de trabalhar da sua empresa. Use fatos reais e exemplos que ajudem o visitante a conhecê-la.</p></section>${benefits}${contact}${footer}</main>`;
const offer = `<main class="offer-page"><section class="offer-top"><p class="kicker">[NOME DA OFERTA]</p><h1>Apresente sua oferta.<br>Deixe a escolha clara.</h1><p class="lead">Explique para quem é, o que está incluído e qual necessidade atende.</p><a href="#contato" class="cta">Quero saber as condições ↗</a></section><section class="offer-layout"><div><p class="kicker">O QUE ESTÁ INCLUÍDO</p><h2>[Nome da solução]</h2><ul class="offer-list"><li>[Primeira entrega incluída]</li><li>[Segunda entrega incluída]</li><li>[Formato e condições de atendimento]</li></ul><p class="offer-price">[Investimento e condições]</p><p>Preencha com os valores e condições confirmados. Remova este texto de orientação antes de publicar.</p></div><div id="contato">${form('Consultar a oferta', 'dark')}</div></section>${faq}${footer}</main>`;
const event = `<main class="event-page"><section class="event-hero"><nav class="nav"><strong>[NOME DO EVENTO]</strong><span>[Online ou presencial]</span></nav><p class="kicker">UM ENCONTRO SOBRE [TEMA]</p><h1>Uma ideia.<br>Um encontro.<br>Novas conversas.</h1><div class="event-meta"><p><strong>Quando</strong><br>[Data e horário]</p><p><strong>Onde</strong><br>[Local ou plataforma]</p></div><a class="cta" href="#contato">Quero participar ↓</a></section><section class="event-agenda"><div><p class="kicker">PROGRAMAÇÃO</p><h2>O que está na pauta?</h2><article><span>[Horário]</span><h3>[Tema da abertura]</h3><p>[Descrição e responsável confirmado]</p></article><article><span>[Horário]</span><h3>[Tema da conversa]</h3><p>[Descrição e responsável confirmado]</p></article></div><div id="contato">${form('Solicitar inscrição')}</div></section>${footer}</main>`;
const thanks = `<main class="thanks-page"><nav class="nav"><strong>SUA MARCA</strong></nav><section class="thanks-card"><div class="thanks-symbol" aria-hidden="true">✓</div><p class="kicker">PÁGINA DE CONFIRMAÇÃO</p><h1>Obrigado pelo seu interesse.</h1><p class="lead">[Explique aqui o próximo passo após a confirmação do envio.]</p><div class="next-step"><h2>E agora?</h2><p>[Informe o canal de retorno e o que a pessoa precisa fazer em seguida.]</p></div><a class="cta" href="/">Voltar ao início ↗</a><p class="editor-note">Configure esta página como destino apenas depois que o formulário confirmar o envio.</p></section>${footer}</main>`;
const b2b = `<main class="b2b-page"><section class="b2b-hero"><nav class="nav"><strong>[SUA MARCA]</strong><span>[Para quem é]</span></nav><div class="hero-grid"><div><p class="kicker">[SETOR · TAMANHO DA EMPRESA]</p><h1>O problema que a sua operação já conhece.</h1><p class="lead">Diga em uma frase o que muda na rotina de quem contrata. Fale do resultado, não da ferramenta.</p><ul class="b2b-points"><li>[Primeiro resultado mensurável]</li><li>[Segundo resultado mensurável]</li><li>[Prazo ou condição de entrega]</li></ul></div><div id="contato">${form('Falar com o time', 'dark')}</div></div></section><section class="logos"><p class="kicker">QUEM JÁ USA</p><div class="logo-row"><span>[CLIENTE 1]</span><span>[CLIENTE 2]</span><span>[CLIENTE 3]</span><span>[CLIENTE 4]</span><span>[CLIENTE 5]</span></div></section><section class="b2b-argument"><p class="kicker">POR QUE AGORA</p><h2>Explique o que acontece<br>se nada mudar.</h2><p class="lead">Um parágrafo sobre o custo de continuar como está. Concreto: horas, retrabalho, receita que não entra.</p></section><section class="b2b-stack"><p class="kicker">O QUE ESTÁ INCLUÍDO</p><h2>Tudo o que a operação precisa.</h2><ul class="stack-list"><li>[Primeira entrega]</li><li>[Segunda entrega]</li><li>[Terceira entrega]</li><li>[Quarta entrega]</li><li>[Suporte e acompanhamento]</li><li>[Relatórios e indicadores]</li></ul></section><section class="objections"><p class="kicker">O QUE COSTUMA PESAR NA DECISÃO</p><h2>As dúvidas que travam.</h2><div class="cards"><article><h3>["É caro para o nosso momento"]</h3><p>Responda com o critério de retorno que você usa com clientes parecidos.</p></article><article><h3>["Não temos gente para tocar"]</h3><p>Explique o que fica com você e o que fica com o cliente.</p></article><article><h3>["Já tentamos algo assim"]</h3><p>Diga o que é diferente aqui, sem falar mal de concorrente.</p></article></div></section>${faq}<section class="closing"><h2>[Uma frase que devolve a decisão para quem lê]</h2><p class="lead">Repita o próximo passo em uma linha e deixe claro que não custa nada começar a conversa.</p><a href="#contato" class="cta">Falar com o time ↗</a></section>${footer}</main>`;
const launch = `<main class="launch-page"><section class="launch-hero"><nav class="nav"><strong>[NOME DO LANÇAMENTO]</strong><span>[Data · Local ou online]</span></nav><p class="kicker">[TURMA · EDIÇÃO]</p><h1>Uma data marcada<br>muda o que se faz hoje.</h1><p class="lead">Diga em uma frase quem sai dali diferente, e como.</p><div class="countdown" data-countdown="0" data-target-at="" data-count-mode="down" data-completion-label="Inscrições encerradas"><span class="countdown-label">As inscrições encerram em</span><strong data-countdown-value>00:00:00</strong></div><a href="#planos" class="cta">Ver os planos ↗</a></section><section class="launch-video"><div class="alva-embed-video" data-alva-video-empty="true"><div class="alva-embed-video-placeholder">Cole a URL do vídeo de convite.</div></div></section><section id="planos" class="plans"><p class="kicker">ESCOLHA COMO PARTICIPAR</p><h2>Três formas de entrar.</h2><div class="plan-grid"><article class="plan"><h3>[BÁSICO]</h3><p class="plan-from">[De R$ 000]</p><p class="plan-price">[por 12x R$ 00]</p><ul><li>[O que inclui]</li><li>[O que inclui]</li></ul><a href="#inscricao" class="cta">Quero este</a></article><article class="plan featured"><span class="plan-tag">[MAIS ESCOLHIDO]</span><h3>[INTERMEDIÁRIO]</h3><p class="plan-from">[De R$ 000]</p><p class="plan-price">[por 12x R$ 00]</p><ul><li>[Tudo do anterior]</li><li>[O que só este tem]</li><li>[Bônus incluído]</li></ul><a href="#inscricao" class="cta">Quero este</a></article><article class="plan"><h3>[COMPLETO]</h3><p class="plan-from">[De R$ 000]</p><p class="plan-price">[por 12x R$ 00]</p><ul><li>[Tudo do anterior]</li><li>[O que só este tem]</li><li>[Acesso ou atendimento extra]</li></ul><a href="#inscricao" class="cta">Quero este</a></article></div></section><section class="guarantee"><p class="kicker">SEM RISCO PARA QUEM ENTRA</p><h2>[Sua garantia, em uma frase]</h2><p class="lead">Explique o prazo e como a pessoa pede o dinheiro de volta. Quanto mais simples, mais confiança.</p></section><section id="inscricao" class="launch-form"><div><p class="kicker">GARANTIR MINHA VAGA</p><h2>Últimos lugares.</h2><p>Edite com o que acontece depois do envio: contato, link de pagamento, grupo.</p></div>${form('Garantir minha vaga', 'dark')}</section>${footer}</main>`;

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
    id: 'b2b',
    name: 'Captação B2B · prova e objeções',
    description: 'Formulário na abertura, clientes que já usam e as dúvidas tratadas antes do fechamento.',
    category: 'Captação',
    html: b2b,
    css:
      templateCss +
      ' .b2b-page{background:#f4f6f8;color:#12222e}.b2b-hero{padding:30px 6% 70px;background:#12222e;color:#eef3f6}.b2b-hero .lead{color:#a9bccb}.b2b-hero .nav a,.b2b-hero .nav span{color:#a9bccb;font-size:13px}.b2b-points{margin:34px 0 0;padding-left:20px;line-height:2.2;color:#cfdde7}.b2b-page .cta{background:#3ddc97;color:#0b1a24}.logos{padding:36px 6%;background:#fff;border-bottom:1px solid #e0e7ec}.logos .kicker{margin-bottom:18px;color:#5d7383}.logo-row{display:flex;flex-wrap:wrap;gap:44px;align-items:center}.logo-row span{font-size:15px;font-weight:700;letter-spacing:1px;color:#8ea2b0}.b2b-argument{padding:80px 6%;max-width:900px}.b2b-stack{padding:80px 6%;background:#12222e;color:#eef3f6}.stack-list{margin:40px 0 0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(2,1fr);gap:0 48px}.stack-list li{padding:20px 0;border-bottom:1px solid #24404f;font-size:17px}.objections{padding:80px 6%}.objections .cards article{border-top:2px solid #12222e;padding-top:22px}.objections h3{font-size:18px;margin-top:0}.closing{padding:90px 6%;background:#3ddc97;color:#0b1a24;text-align:center}.closing .lead{margin:20px auto 32px;color:#14342c}.closing .cta{background:#12222e;color:#eef3f6}.b2b-page .alva-form{--button-bg:#3ddc97;--button-fg:#0b1a24;--form-bg:#0d1c26;--form-fg:#eef3f6;--form-muted:#a9bccb;--field-border:#2b4859}@media(max-width:760px){.b2b-hero{padding-bottom:44px}.stack-list{grid-template-columns:1fr}.b2b-argument,.b2b-stack,.objections{padding:48px 6%}.closing{padding:56px 6%}.logo-row{gap:24px}}',
  },
  {
    id: 'launch',
    name: 'Lançamento · planos e contagem',
    description: 'Data marcada, vídeo de convite e três planos lado a lado com um em destaque.',
    category: 'Conversão',
    html: launch,
    css:
      templateCss +
      ' .launch-page{background:#0d0b14;color:#f5f1ff}.launch-hero{padding:30px 6% 70px;text-align:center}.launch-hero .nav{justify-content:center;gap:14px;color:#a99cc9;font-size:13px}.launch-hero h1{margin:0 auto;font-size:clamp(42px,7vw,86px)}.launch-hero .lead{margin:22px auto 0;color:#bdb2d8}.countdown{display:inline-flex;flex-direction:column;gap:6px;margin:38px 0 26px;padding:18px 34px;border:1px solid #3b2f57;border-radius:14px;background:#171225}.countdown-label{font-size:11px;letter-spacing:2px;color:#a99cc9}.countdown strong{font-size:34px;letter-spacing:2px;font-variant-numeric:tabular-nums}.launch-page .cta{background:#f5d90a;color:#1a1626}.launch-video{padding:0 6% 70px;max-width:980px;margin:auto}.plans{padding:80px 6%;background:#f5f1ff;color:#1a1626}.plan-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:44px;align-items:start}.plan{padding:32px 26px;border:1px solid #d8cfe9;border-radius:16px;background:#fff}.plan h3{margin:0 0 18px;font-size:15px;letter-spacing:2px}.plan-from{margin:0;color:#7c7195;text-decoration:line-through;font-size:14px}.plan-price{margin:4px 0 22px;font-size:26px;font-weight:700}.plan ul{margin:0 0 26px;padding-left:18px;line-height:2;color:#4a4064;font-size:15px}.plan .cta{display:block;text-align:center;background:#1a1626;color:#f5f1ff}.plan.featured{padding-top:44px;border:2px solid #1a1626;position:relative;box-shadow:0 18px 40px rgba(26,22,38,.14)}.plan-tag{position:absolute;top:16px;left:26px;font-size:10px;letter-spacing:2px;font-weight:700;color:#7a6a12;background:#f5d90a;padding:5px 10px;border-radius:99px}.plan.featured .cta{background:#f5d90a;color:#1a1626}.guarantee{padding:80px 6%;text-align:center;max-width:860px;margin:auto}.guarantee .lead{margin:18px auto 0;color:#bdb2d8}.launch-form{padding:80px 6%;display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center;background:#171225}.launch-form p{color:#bdb2d8}.launch-page .lp-footer span{color:#8f84ad}.launch-page .alva-form{--button-bg:#f5d90a;--button-fg:#1a1626;--form-bg:#241d38;--form-fg:#f5f1ff;--form-muted:#bdb2d8;--field-border:#4a3f6b}.launch-video .alva-embed-video{border-radius:16px;background:#171225}.launch-video .alva-embed-video-placeholder{color:#bdb2d8}@media(max-width:760px){.plan-grid{grid-template-columns:1fr}.launch-form{grid-template-columns:1fr;padding:48px 6%;gap:30px}.plans,.guarantee{padding:48px 6%}.countdown{padding:14px 22px}.countdown strong{font-size:27px}}',
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

// O que cada peça faz, em uma linha, na língua de quem monta a página — não na de quem
// escreve html. É o texto que aparece embaixo do nome na biblioteca.
export const blockDescriptions = {
  section: 'Uma faixa nova da página, para separar um assunto do outro.',
  columns: 'Dois espaços lado a lado, para comparar ou dividir o conteúdo.',
  heading: 'Um título para anunciar o que vem a seguir.',
  text: 'Um parágrafo para explicar sua ideia.',
  image: 'Uma foto ou ilustração, enviada do seu computador.',
  vsl: 'Uma VSL criada aqui no Studio, com player e medição próprios.',
  button: 'Um convite para a pessoa dar o próximo passo.',
  icon: 'Um símbolo para reforçar uma ideia rapidamente.',
  form: 'Um formulário completo para receber contatos.',
  input: 'Uma pergunta com espaço para a pessoa escrever a resposta.',
};

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
  ['vsl', 'VSL do Studio', 'Mídia', { type: 'vsl', publicId: '', attributes: { 'data-alva-vsl': '' } }],
  ['button', 'Botão', 'Conteúdo', '<a href="#contato" class="cta">Quero saber mais ↗</a>'],
  ['icon', 'Ícone', 'Conteúdo', '<span class="material-symbols-outlined" aria-hidden="true">star</span>'],
  ['form', 'Formulário', 'Captação', form()],
  [
    'input',
    'Campo de texto',
    'Captação',
    '<label>Novo campo<input name="novo_campo" type="text" placeholder="Digite aqui"></label>',
  ],
];
