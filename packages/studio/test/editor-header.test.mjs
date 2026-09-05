import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const htmlPath = new URL('../public/index.html', import.meta.url);
const cssPath = new URL('../public/styles.css', import.meta.url);
const ownerCssPath = new URL('../public/owner.css', import.meta.url);
const ownerJsPath = new URL('../public/owner.js', import.meta.url);

test('ações do editor usam ícones com nome acessível e ajuda no hover', async () => {
  const html = await readFile(htmlPath, 'utf8');
  const actionIds = ['back', 'settings', 'preview', 'download', 'save', 'publish'];

  for (const id of actionIds) {
    const button = html.match(new RegExp(`<button[^>]*id="${id}"[\\s\\S]*?</button>`))?.[0];
    assert.ok(button, `botão #${id} existe`);
    assert.match(button, /aria-label="[^"]+"/, `#${id} tem nome acessível`);
    assert.match(button, /title="[^"]+"/, `#${id} tem label no hover`);
    assert.match(button, /data-tooltip="[^"]+"/, `#${id} tem tooltip visual`);
    assert.match(button, /<svg[\s>]/, `#${id} usa ícone vetorial`);
  }

  assert.match(html, /class="device-control"[^>]*data-tooltip="[^"]+"/);
  assert.doesNotMatch(html, /id="editor-account"/);
});

test('tema do Studio declara os tokens canônicos da Alva', async () => {
  const css = await readFile(cssPath, 'utf8');

  assert.match(css, /--alva-blue:\s*#286eea/i);
  assert.match(css, /--alva-cloud:\s*#f7f9fc/i);
  assert.match(css, /--alva-ink:\s*#101828/i);
  assert.match(css, /--alva-line:\s*#e7ecf3/i);
  assert.match(css, /--font-sans:\s*['"]Instrument Sans['"]/i);
  assert.match(css, /--alva-positive:\s*#198044/i);
  assert.match(css, /--alva-positive-bg:\s*#e4f8e8/i);
  assert.match(css, /--alva-warning:\s*#9d5900/i);
  assert.match(css, /--alva-warning-bg:\s*#ffefdd/i);
  assert.match(css, /--alva-negative:\s*#ba3535/i);
  assert.match(css, /--alva-negative-bg:\s*#ffebe8/i);
});

test('textos pequenos essenciais usam Slate e Soft fica apenas decorativo', async () => {
  const [css, ownerCss] = await Promise.all([readFile(cssPath, 'utf8'), readFile(ownerCssPath, 'utf8')]);
  const essentialSelectors = [
    '.workspace-label',
    '.sidebar-footer',
    '.list-tools span',
    '.card-content p',
    'footer',
  ];

  for (const selector of essentialSelectors) {
    const rule = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*\\{[^}]+\\}`))?.[0];
    assert.ok(rule, `regra ${selector} existe`);
    assert.match(rule, /color:\s*var\(--alva-muted\)/, `${selector} usa Slate`);
  }
  assert.match(ownerCss, /\.access-story small\s*\{[^}]*color:\s*var\(--alva-muted\)/s);
  assert.match(ownerCss, /\.optional\s*\{[^}]*color:\s*var\(--alva-muted\)/s);
});

test('tooltips das extremidades permanecem dentro da viewport', async () => {
  const css = await readFile(cssPath, 'utf8');

  assert.match(css, /#back\[data-tooltip\]::after\s*\{[^}]*left:\s*0[^}]*transform:\s*none/s);
  assert.match(css, /#publish\[data-tooltip\]::after\s*\{[^}]*right:\s*0[^}]*left:\s*auto[^}]*transform:\s*none/s);
});

test('dashboard e acesso usam o símbolo oficial com wordmark e Studio separados', async () => {
  const [html, ownerJs] = await Promise.all([readFile(htmlPath, 'utf8'), readFile(ownerJsPath, 'utf8')]);
  const signature =
    /<svg[^>]+class="brand-symbol"[^>]*>[\s\S]*?<use href="#alva-symbol"[^>]*>[\s\S]*?<\/svg>\s*<strong>ALVA<\/strong>\s*<span>Studio<\/span>/;

  assert.match(html, signature);
  assert.match(ownerJs, signature);
});

test('menu do dashboard não interfere no painel lateral do editor', async () => {
  const css = await readFile(cssPath, 'utf8');

  assert.doesNotMatch(css, /(?:^|\})\s*aside\s*\{/m);
  assert.match(css, /#dashboard\s*>\s*aside\s*\{/);
});

test('rodapé do menu concentra configurações, aparência e recolhimento', async () => {
  const [html, css] = await Promise.all([readFile(htmlPath, 'utf8'), readFile(cssPath, 'utf8')]);
  const footer = html.match(/<div class="sidebar-footer">[\s\S]*?<\/div>\s*<\/aside>/)?.[0];

  assert.ok(footer, 'rodapé da barra lateral existe');
  assert.match(footer, /id="app-settings"/);
  assert.match(footer, /id="appearance-theme"/);
  assert.match(footer, /class="sidebar-theme"/);
  assert.match(footer, /aria-label="Aparência: Sistema"/);
  assert.doesNotMatch(footer, /<select/);
  assert.match(footer, /id="sidebar-toggle"[^>]*aria-expanded="true"/);
  assert.doesNotMatch(html, /class="aside-bottom"/);
  assert.match(css, /data-sidebar-collapsed=['"]true['"]/);
  assert.match(css, /data-color-scheme=['"]dark['"]/);
  assert.match(css, /\.sidebar-footer\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\.sidebar-footer \.sidebar-label\s*\{[^}]*display:\s*none/s);
  assert.match(footer, />computer<\/span>/);
  assert.match(footer, />left_panel_close<\/span>/);
});

test('quizzes permanecem como destino principal do menu', async () => {
  const html = await readFile(htmlPath, 'utf8');
  const sidebar = html.match(/<section id="dashboard"[\s\S]*?<\/aside>/)?.[0] || '';
  assert.match(sidebar, /id="nav-pages"/);
  assert.match(sidebar, /id="nav-forms"/);
  assert.match(sidebar, /Quizzes/);
  assert.match(sidebar, /Páginas/);
  assert.match(sidebar, /Histórico/);
});
