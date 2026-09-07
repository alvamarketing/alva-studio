import { embedVideoCss } from './templates.js';
export const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export function materialSymbolsFontUrl(origin = '') {
  if (!origin) return '/material-symbols-outlined.woff2';
  try {
    const url = new URL(origin);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return `${url.origin}/material-symbols-outlined.woff2`;
  } catch {}
  return '/material-symbols-outlined.woff2';
}

export function materialSymbolsFontCss(origin = '') {
  return `@font-face{font-family:'Material Symbols Outlined';font-style:normal;font-weight:500;src:url('${materialSymbolsFontUrl(origin)}') format('woff2')}.material-symbols-outlined{font-family:'Material Symbols Outlined';font-weight:normal;font-style:normal;font-variation-settings:'FILL' 0,'wght' 500,'GRAD' 0,'opsz' 24;font-feature-settings:'liga';-webkit-font-smoothing:antialiased}`;
}

export const quizIconFont = (origin = '') => `<style>${materialSymbolsFontCss(origin)}</style>`;

const optionData = (option) => typeof option === 'string' ? { label: option, imageUrl: '', icon: '' } : option;

function choices(element, multiple = false, visual = false) {
  return `<div class="choices${visual ? ' image-choices' : ''}" data-quiz-question="${escape(element.title)}"${multiple ? ` data-quiz-required="${element.required ? 'true' : 'false'}"` : ''}>${element.options.map((raw, index) => {
    const option = optionData(raw);
    const art = option.imageUrl ? `<img src="${escape(option.imageUrl)}" alt="">` : `<span class="choice-visual material-symbols-outlined">${escape(option.icon || element.icon || 'radio_button_checked')}</span>`;
    return `<label class="choice${visual ? ' choice-image' : ''}"><input data-answer type="${multiple ? 'checkbox' : 'radio'}" name="${escape(element.id)}" value="${escape(option.label)}"${element.required && !multiple ? ' required' : ''}>${visual ? art : `<span class="choice-key">${index + 1}</span>`}<span>${escape(option.label)}</span></label>`;
  }).join('')}</div>`;
}

function chart(element) {
  const { labels = [], values = [], type = 'bar' } = element.chart || {};
  if (type === 'donut') {
    const total = values.reduce((sum, value) => sum + value, 0) || 1;
    const colors = ['#286eea', '#9b7cff', '#31c7a3', '#ffbd4a', '#ff6b77', '#43a5ff', '#a9ca62', '#ef7bc8'];
    let cursor = 0;
    const stops = values.map((value, index) => { const start = cursor; cursor += value / total * 100; return `${colors[index]} ${start}% ${cursor}%`; }).join(',');
    return `<div class="chart chart-donut"><div class="donut" style="--segments:${escape(stops)}"><strong>${Math.round(total)}</strong><span>total</span></div><div class="legend">${labels.map((label, index) => `<span><i style="--color:${colors[index]}"></i>${escape(label)} · ${values[index]}</span>`).join('')}</div></div>`;
  }
  return `<div class="chart chart-bar">${values.map((value, index) => `<div class="bar-row"><span>${escape(labels[index])}</span><i><b style="--value:${Math.min(100, value)}%"></b></i><strong>${value}</strong></div>`).join('')}</div>`;
}

function vslEmbedUrl(vslEmbedUrls, publicId) {
  if (!publicId || !vslEmbedUrls) return '';
  const value = vslEmbedUrls instanceof Map ? vslEmbedUrls.get(publicId) : vslEmbedUrls[publicId];
  const url = typeof value === 'string' ? value : value?.embedUrl;
  return /^https?:\/\/[^\s]+$/i.test(String(url || '')) ? String(url) : '';
}

function vslControl(element, vslEmbedUrls) {
  const src = vslEmbedUrl(vslEmbedUrls, element.publicId);
  if (!src) return '<div class="vsl-embed vsl-embed-fallback" role="status">Esta VSL não está disponível no momento.</div>';
  return `<div class="vsl-embed" data-vsl-public-id="${escape(element.publicId)}"><iframe class="vsl-embed-frame" src="${escape(src)}" title="${escape(element.title || 'VSL')}" allow="autoplay; fullscreen; picture-in-picture" loading="lazy" allowfullscreen></iframe></div>`;
}

function control(element, options = {}) {
  const required = element.required ? ' required' : '';
  if (element.type === 'single_choice') return choices(element);
  if (element.type === 'multiple_choice') return choices(element, true);
  if (element.type === 'image_choice') return choices(element, false, true);
  if (element.type === 'long_text' || element.type === 'address') return `<textarea data-answer class="answer" name="${escape(element.id)}" placeholder="${escape(element.placeholder)}"${required}></textarea>`;
  if (element.type === 'scale') return `<div class="scale"><output>${element.range?.min ?? 1}</output><input data-answer type="range" name="${escape(element.id)}" min="${element.range?.min ?? 1}" max="${element.range?.max ?? 10}" value="${element.range?.min ?? 1}"${required}><span>${element.range?.max ?? 10}</span></div>`;
  if (element.type === 'file') return `<label class="upload"><span class="material-symbols-outlined">cloud_upload</span><strong>Escolher arquivo</strong><small>Imagem, PDF ou documento de até 3 MB</small><input data-answer type="file" name="${escape(element.id)}" accept="image/png,image/jpeg,image/webp,application/pdf,.doc,.docx"${required}></label>`;
  if (element.type === 'image') return element.mediaUrl ? `<img class="step-media" src="${escape(element.mediaUrl)}" alt="${escape(element.alt || element.title || '')}">` : '<div class="media-placeholder"><span class="material-symbols-outlined">image</span>Adicione uma imagem no editor</div>';
  if (element.type === 'video') {
    if (!element.mediaUrl) return '<div class="media-placeholder"><span class="material-symbols-outlined">play_circle</span>Adicione um vídeo no editor</div>';
    return /\.(mp4|webm|ogg)(\?.*)?$/i.test(element.mediaUrl)
      ? `<video class="native-video" src="${escape(element.mediaUrl)}" controls playsinline preload="metadata"></video>`
      : `<div class="video"><iframe src="${escape(element.mediaUrl)}" title="${escape(element.title)}" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  if (element.type === 'vsl') return vslControl(element, options.vslEmbedUrls);
  if (element.type === 'logo') return element.mediaUrl ? `<img class="funnel-logo" src="${escape(element.mediaUrl)}" alt="${escape(element.altText || element.alt || element.title || 'Logo')}" style="width:${Math.max(24, Math.min(600, Number(element.width) || 120))}px">` : `<span class="brand"><span class="brand-mark material-symbols-outlined">gesture</span>${escape(element.title || 'ALVA')}</span>`;
  if (element.type === 'countdown' || element.type === 'timer') {
    const duration = Math.max(0, Number(element.type === 'timer' ? element.durationSeconds : element.duration) || 60);
    const mode = element.type === 'timer' && element.timerDirection === 'up' ? 'up' : 'down';
    const target = element.type === 'countdown' ? escape(element.targetAt || '') : '';
    const autoStart = element.type === 'countdown' || element.autoStart !== false;
    return `<div class="countdown" data-countdown="${duration}" data-count-mode="${mode}" data-target-at="${target}" data-auto-start="${autoStart}" data-completion-label="${escape(element.completionLabel || 'Tempo encerrado')}" role="timer" aria-live="off"><strong data-countdown-value>${mode === 'up' ? '00:00' : formatDuration(duration)}</strong>${autoStart ? '' : '<button type="button" class="timer-toggle" aria-label="Iniciar cronômetro"><span class="material-symbols-outlined">play_arrow</span></button>'}</div>`;
  }
  if (element.type === 'progress') return '';
  if (element.type === 'chart') return chart(element);
  if (element.type === 'cta') return element.buttonUrl ? `<a class="custom-cta" href="${escape(element.buttonUrl)}" target="_blank" rel="noopener noreferrer">${escape(element.buttonLabel)} <span class="material-symbols-outlined">arrow_forward</span></a>` : '';
  if (element.type === 'loader') return '<div class="loader"><span></span><strong>Processando suas respostas…</strong></div>';
  if (['statement', 'title', 'heading'].includes(element.type)) return '<div class="statement-line"></div>';
  if (['text', 'paragraph'].includes(element.type)) return '';
  const type = element.type === 'email' ? 'email' : element.type === 'phone' ? 'tel' : element.type === 'date' ? 'date' : element.type === 'number' ? 'number' : 'text';
  const autocomplete = element.type === 'email' ? 'email' : element.type === 'phone' ? 'tel' : 'off';
  return `<input data-answer class="answer" type="${type}" name="${escape(element.id)}" placeholder="${escape(element.placeholder)}" autocomplete="${autocomplete}"${required}>`;
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  const rest = value % 60;
  return [hours, minutes, rest].filter((_, index) => hours || index).map((part) => String(part).padStart(2, '0')).join(':');
}

export function renderQuizElement(element, fixed = false, options = {}) {
  const type = element.type || 'text';
  if (type === 'logo') return `<div class="screen-element element-logo${fixed ? ' fixed-element' : ''}" data-element-id="${escape(element.id)}">${control(element, options)}</div>`;
  if (type === 'progress') return '';
  const heading = ['statement', 'title', 'heading'].includes(type) ? 'h1' : ['text', 'paragraph'].includes(type) ? '' : 'h3';
  const title = heading ? `<${heading}>${escape(element.title)}</${heading}>` : '';
  const body = element.description || (!heading ? element.title : '');
  const span = Math.max(1, Math.min(2, Number(element.span) || 1));
  return `<div class="screen-element element-${escape(type)}${fixed ? ' fixed-element' : ''}" data-element-id="${escape(element.id)}" data-span="${span}"${element.motion ? ` data-motion="${escape(element.motion)}"` : ''}>${element.icon ? `<span class="element-icon material-symbols-outlined">${escape(element.icon)}</span>` : ''}${title}${body ? `<p class="description">${escape(body)}</p>` : ''}${control(element, options)}</div>`;
}

const css = `:root{--accent:#286eea;--accent2:#8a63ff;--ink:#111827;--muted:#667085;--line:#dce5f1;--cloud:#f7f9fd;font-family:Inter,system-ui,sans-serif;color:var(--ink);background:var(--cloud)}*{box-sizing:border-box}.material-symbols-outlined{font-family:'Material Symbols Outlined';font-weight:normal;font-style:normal;font-variation-settings:'FILL' 0,'wght' 500,'GRAD' 0,'opsz' 24}body{margin:0;min-height:100vh;padding:28px;background:radial-gradient(circle at 12% 15%,#cfe0ff 0,transparent 27%),radial-gradient(circle at 88% 82%,#e6dcff 0,transparent 29%),linear-gradient(135deg,#fbfdff,#f3f6fc);background-size:120% 120%;animation:ambient 10s ease-in-out infinite alternate}.shell{width:min(940px,100%);position:relative}.shell:before,.shell:after{content:'';position:fixed;width:230px;height:230px;border-radius:50%;opacity:.34;z-index:-1;animation:orb 8s ease-in-out infinite}.shell:before{background:#7ca8ff;top:4%;right:5%}.shell:after{background:#9b7cff;bottom:3%;left:5%;animation-delay:-4s}.brand{display:flex;align-items:center;gap:9px;margin:0 auto 22px;width:max-content;font-weight:800;letter-spacing:.16em}.brand-mark{color:var(--accent);font-size:27px}.funnel-header{position:sticky;top:12px;z-index:10;margin-bottom:14px;padding:18px 22px 16px;border:1px solid #fff;border-radius:24px;background:#ffffffee;backdrop-filter:blur(18px);box-shadow:0 14px 45px #14213d12}.fixed-elements{display:flex;align-items:center;justify-content:center;gap:18px;min-height:36px;margin-bottom:14px}.fixed-elements .screen-element{display:flex;align-items:center;gap:10px}.fixed-elements .description{margin:0;text-align:left;font-size:13px}.fixed-elements h1{margin:0;font-size:18px;letter-spacing:-.02em}.fixed-elements .element-icon{width:34px;height:34px;margin:0}.funnel-logo{display:block;max-width:180px;max-height:48px;object-fit:contain}.funnel-header .progress{margin:0}.progress-row{display:flex;align-items:center;gap:12px}.progress-row .progress{flex:1}.progress-value{min-width:42px;color:var(--muted);font-size:11px;font-weight:800;text-align:right}.card{background:#ffffffec;backdrop-filter:blur(18px);border:1px solid #fff;border-radius:30px;padding:clamp(26px,5vw,58px);box-shadow:0 30px 100px #14213d1a;overflow:hidden}.progress{height:6px;background:#e9eef6;border-radius:999px;overflow:hidden;margin-bottom:38px}.progress span{display:block;width:0;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:inherit;transition:width .5s}.screen{max-width:760px;margin:auto}.screen-kicker{text-align:center;font-size:10px;letter-spacing:.18em;color:var(--accent);font-weight:800;margin:0 0 26px}.screen-elements{display:grid;gap:24px}.screen-elements[data-columns="2"]{grid-template-columns:repeat(2,minmax(0,1fr))}.screen-element[data-span="2"]{grid-column:1/-1}.screen-element{position:relative}.element-icon{display:grid;width:44px;height:44px;place-items:center;margin:0 auto 12px;border-radius:14px;background:#eaf1ff;color:var(--accent);font-size:24px}.screen-element h1{font-size:clamp(32px,5vw,52px);line-height:1.04;letter-spacing:-.045em;text-align:center;margin:0}.screen-element h3{font-size:15px;margin:0 0 8px}.description{font-size:16px;line-height:1.55;color:var(--muted);text-align:center;margin:9px auto 2px;max-width:650px}.answer{width:100%;border:1px solid var(--line);border-radius:17px;padding:17px 18px;background:#fff;color:var(--ink);font:inherit;font-size:17px;outline:none;resize:vertical;box-shadow:0 5px 15px #1b315b0a}.answer:focus{border-color:var(--accent);box-shadow:0 0 0 4px #286eea16}textarea.answer{min-height:115px}.choices{display:grid;gap:11px}.choice{display:flex;align-items:center;gap:12px;border:1px solid var(--line);border-radius:16px;padding:15px 17px;cursor:pointer;background:#fff;transition:.2s}.choice:hover,.choice:has(input:checked){border-color:var(--accent);background:#eef4ff;transform:translateY(-2px);box-shadow:0 10px 25px #286eea15}.choice input{accent-color:var(--accent)}.choice-key{display:grid;place-items:center;width:28px;height:28px;border:1px solid var(--line);border-radius:9px;font-size:12px}.image-choices{grid-template-columns:repeat(auto-fit,minmax(145px,1fr))}.image-choices>:is(h1,h2,h3,p){grid-column:1/-1}.choice-image{padding:0;overflow:hidden;display:grid;grid-template-rows:145px auto;position:relative}.choice-image img{width:100%;height:145px;object-fit:cover}.choice-image input{position:absolute;top:12px;left:12px;width:20px;height:20px}.choice-image>span:last-child{padding:15px;font-weight:700}.choice-visual{display:grid;place-items:center;font-size:54px;background:linear-gradient(145deg,#eaf1ff,#f3eefe);color:var(--accent)}.scale{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:16px}.scale input{width:100%;accent-color:var(--accent)}.scale output{display:grid;place-items:center;width:52px;height:52px;border-radius:16px;background:#eaf2ff;color:var(--accent);font-size:22px;font-weight:800}.upload{display:grid;place-items:center;gap:7px;padding:30px;border:2px dashed #c8d6eb;border-radius:18px;text-align:center;cursor:pointer}.step-media,.native-video,.media-placeholder{width:100%;min-height:230px;border-radius:20px;object-fit:cover}.media-placeholder{display:grid;place-items:center;background:#edf3fc;color:var(--muted)}.video{position:relative;padding-top:56.25%;border-radius:20px;overflow:hidden}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}.native-video{display:block;width:100%;border-radius:20px;background:#111}.custom-cta{display:flex;align-items:center;justify-content:center;gap:9px;padding:16px 22px;border-radius:15px;background:var(--accent);color:#fff;text-decoration:none;font-weight:800}.statement-line{width:74px;height:5px;border-radius:5px;background:linear-gradient(90deg,var(--accent),var(--accent2));margin:18px auto 0}.chart{margin:6px 0}.bar-row{display:grid;grid-template-columns:minmax(75px,auto) 1fr 40px;gap:12px;align-items:center;margin:13px 0}.bar-row>i{height:13px;background:#edf1f7;border-radius:20px;overflow:hidden}.bar-row b{display:block;height:100%;width:var(--value);background:linear-gradient(90deg,var(--accent),#31c7a3);border-radius:inherit;animation:grow 1s}.bar-row span,.bar-row strong,.legend{font-size:12px}.chart-donut{display:flex;align-items:center;justify-content:center;gap:30px}.donut{width:180px;aspect-ratio:1;border-radius:50%;background:conic-gradient(var(--segments));display:grid;place-items:center;position:relative}.donut:before{content:'';position:absolute;inset:30px;border-radius:50%;background:#fff}.donut strong,.donut span{z-index:1;grid-area:1/1}.donut strong{font-size:28px}.donut span{transform:translateY(22px);color:var(--muted);font-size:11px}.legend{display:grid;gap:8px}.legend span{display:flex;align-items:center;gap:8px}.legend i{width:9px;height:9px;border-radius:50%;background:var(--color)}.loader{display:grid;place-items:center;gap:16px;padding:24px}.countdown{display:grid;place-items:center;padding:18px;border:1px solid var(--line);border-radius:18px;background:linear-gradient(145deg,#f8fbff,#f2efff)}.countdown strong{font-size:clamp(30px,6vw,54px);font-variant-numeric:tabular-nums;letter-spacing:.06em;color:var(--accent)}.countdown[data-finished]{opacity:.65}.timer-toggle{display:grid;place-items:center;width:38px;height:38px;margin-top:10px;border:0;border-radius:50%;background:var(--accent);color:#fff;cursor:pointer}.loader span{width:58px;height:58px;border:6px solid #e8eef8;border-top-color:var(--accent);border-radius:50%;animation:spin .85s linear infinite}.actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:36px}.actions button{border:0;border-radius:14px;padding:14px 20px;font:inherit;font-weight:750;cursor:pointer}.back{background:transparent;color:var(--muted)}.next{display:flex;align-items:center;gap:5px;background:var(--accent);color:#fff;box-shadow:0 9px 24px #286eea36}.hint{text-align:center;color:var(--muted);font-size:11px;margin-top:16px}.screen[data-active][data-motion=fade-up]{animation:fadeUp .55s both}.screen[data-active][data-motion=slide-left]{animation:slideLeft .55s both}.screen[data-active][data-motion=zoom-in]{animation:zoomIn .5s both}.screen[data-active][data-motion=float] .screen-elements{animation:float 3.4s ease-in-out infinite}.error{color:#b42318;font-size:13px;margin-top:14px}@keyframes fadeUp{from{opacity:0;transform:translateY(26px)}}@keyframes slideLeft{from{opacity:0;transform:translateX(48px)}}@keyframes zoomIn{from{opacity:0;transform:scale(.94)}}@keyframes float{50%{transform:translateY(-7px)}}@keyframes grow{from{width:0}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes ambient{to{background-position:100% 100%}}@keyframes orb{50%{transform:translate(22px,-20px) scale(1.15)}}@media(max-width:600px){body{padding:12px}.funnel-header{top:6px;padding:14px}.fixed-elements{flex-wrap:wrap}.screen-elements[data-columns="2"]{grid-template-columns:1fr}.screen-element[data-span]{grid-column:auto}.card{padding:26px 19px}.screen-element h1{font-size:32px}.image-choices{grid-template-columns:1fr 1fr}.choice-image{grid-template-rows:115px auto}.choice-image img{height:115px}.chart-donut{align-items:flex-start;flex-direction:column}.donut{width:150px}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}`;

const vslCss = '.vsl-embed{width:100%;aspect-ratio:16/9;min-height:220px;overflow:hidden;border:1px solid var(--line);border-radius:20px;background:#111}.vsl-embed-frame{display:block;width:100%;height:100%;min-height:220px;border:0}.vsl-embed-fallback{display:grid;place-items:center;padding:24px;background:#edf3fc;color:var(--muted);text-align:center}' + embedVideoCss + '.screen-element[data-motion=fade-up]{animation:elementFadeUp .55s both}.screen-element[data-motion=slide-left]{animation:elementSlideLeft .55s both}.screen-element[data-motion=zoom-in]{animation:elementZoomIn .5s both}.screen-element[data-motion=float]{animation:elementFloat 3.4s ease-in-out infinite}@keyframes elementFadeUp{from{opacity:0;transform:translateY(20px)}}@keyframes elementSlideLeft{from{opacity:0;transform:translateX(34px)}}@keyframes elementZoomIn{from{opacity:0;transform:scale(.96)}}@keyframes elementFloat{50%{transform:translateY(-6px)}}@media(prefers-reduced-motion:reduce){.screen-element[data-motion]{animation:none!important}.vsl-embed{scroll-behavior:auto}}';

export const quizElementCss = css + vslCss;
// Canvas lives inside the public quiz chrome. Keep component tokens while
// neutralising the document-level backdrop that would otherwise repeat per step.
export const quizCanvasCss = `${quizElementCss}body{min-height:0;padding:0;background:transparent;animation:none}.shell,.card,.actions,.screen{max-width:none;margin:0;padding:0;background:transparent;box-shadow:none}`;
