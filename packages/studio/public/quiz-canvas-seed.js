import { chartCss } from './templates.js';
import { quizCanvasCss, renderQuizElement } from './quiz-elements.js';

// The first canvas is an exact, editable projection of the legacy schema.  It
// deliberately has no form wrapper: the public quiz owns the single submit.
const jsonAttribute = (value) => escapeAttribute(JSON.stringify(value));
const escapeAttribute = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function legacyChart(element, fixed = false) {
  const chart = element.chart && typeof element.chart === 'object' ? element.chart : {};
  const type = chart.type === 'donut' ? 'donut' : 'bar';
  const labels = Array.isArray(chart.labels) ? chart.labels : [];
  const values = Array.isArray(chart.values) ? chart.values : [];
  const id = escapeAttribute(element.id);
  const title = escapeAttribute(element.title || 'Resultados');
  const data = labels.map((label, index) => { const number = Number(values[index]); return [label, Number.isFinite(number) ? number : 0]; });
  if (type === 'donut') {
    return `<div class="screen-element element-chart${fixed ? ' fixed-element' : ''}" data-element-id="${id}"><div class="alva-chart"><div class="alva-donut alva-donut-background" data-quiz-type="chart" data-quiz-chart-type="donut" data-element-id="${id}" data-alva-chart-data="${jsonAttribute(data)}"><strong>${title}</strong></div></div></div>`;
  }
  const bars = data.map(([label, value]) => `<div><i style="--value:${value}%"></i><small>${escapeAttribute(label)}</small></div>`).join('');
  return `<div class="screen-element element-chart${fixed ? ' fixed-element' : ''}" data-element-id="${id}"><h3>${title}</h3><div class="alva-chart alva-chart-bars" data-quiz-type="chart" data-quiz-chart-type="bar">${bars}</div></div>`;
}

function legacyElement(element, fixed, options) {
  if (element?.type === 'chart') return legacyChart(element, fixed);
  const html = renderQuizElement(element, fixed, options);
  const type = element?.type;
  if (['single_choice', 'multiple_choice', 'image_choice'].includes(type))
    return html.replace('<div class="choices', `<div data-quiz-type="${type}" class="choices`);
  return html;
}

export function seedQuizCanvas(elements = [], { header = false, vslEmbedUrls } = {}) {
  const rows = Array.isArray(elements) ? elements : [];
  const body = rows.map((element) => legacyElement(element, header, { vslEmbedUrls })).join('');
  return {
    version: 1,
    html: header ? `<header class="funnel-header"><div class="fixed-elements">${body}</div></header>` : body,
    css: `${quizCanvasCss}${chartCss}`,
  };
}

export function canvasSnapshot(editor) {
  return {
    version: 1,
    editorState: structuredClone(editor.getProjectData()),
    html: editor.getHtml(),
    css: editor.getCss(),
  };
}
