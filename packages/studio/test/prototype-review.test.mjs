import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const reviewScript = await readFile(new URL('../../../docs/wireframes/prototype-review.js', import.meta.url), 'utf8');
const referenceHtml = await readFile(new URL('../../../docs/wireframes/alva-studio-ui-reference.html', import.meta.url), 'utf8');
const reviewCss = await readFile(new URL('../../../docs/wireframes/prototype-review.css', import.meta.url), 'utf8');

function boot() {
  const dom = new JSDOM('<!doctype html><body><button id="reviewed"><svg><path d="M0 0"/></svg><span>Revisar</span></button></body>', {
    url: 'https://example.test/alva-studio-ui-reference.html',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  window.Blob = class ReviewBlob {
    constructor(parts) { this.parts = parts; }
  };
  window.URL.createObjectURL = () => 'blob:review';
  window.URL.revokeObjectURL = () => {};
  vm.runInContext(reviewScript, dom.getInternalVMContext());
  return { dom, window, button: window.document.querySelector('#reviewed') };
}

function activate(window) {
  window.document.querySelector('.review-toolbar button').click();
}

function bootReference(saved = null) {
  const dom = new JSDOM(referenceHtml, { url: 'https://example.test/alva-studio-ui-reference.html', runScripts: 'outside-only' });
  const { window } = dom;
  window.HTMLElement.prototype.scrollIntoView = () => {};
  if (saved) window.localStorage.setItem('alva-prototype-review:alva-studio-ui-reference.html', saved);
  for (const script of window.document.querySelectorAll('script:not([src])')) vm.runInContext(script.textContent, dom.getInternalVMContext());
  vm.runInContext(reviewScript, dom.getInternalVMContext());
  return { dom, window };
}

test('modo de revisão persiste, exporta e importa propostas válidas', async () => {
  const first = boot();
  activate(first.window);
  first.button.dispatchEvent(new first.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  first.window.document.querySelector('input[name="name"]').value = 'CTA revisado';
  first.window.document.querySelector('.save').click();

  const stored = JSON.parse(first.window.localStorage.getItem('alva-prototype-review:alva-studio-ui-reference.html'));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].name, 'CTA revisado');

  let exportedPromise;
  first.window.document.createElement = new Proxy(first.window.document.createElement, {
    apply(target, thisArg, args) {
      const element = Reflect.apply(target, thisArg, args);
      if (args[0] === 'a') element.click = () => {
        exportedPromise = Promise.resolve(JSON.parse(first.window.URL.createObjectURL.lastPayload.parts[0]));
      };
      return element;
    },
  });
  first.window.URL.createObjectURL = blob => { first.window.URL.createObjectURL.lastPayload = blob; return 'blob:review'; };
  first.window.document.querySelector('.review-toolbar button:nth-child(2)').click();
  const exported = await exportedPromise;
  assert.equal(exported.format, 'alva-prototype-review');
  assert.equal(exported.proposals.length, 1);

  const second = boot();
  const file = { text: async () => JSON.stringify(exported) };
  const input = second.window.document.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new second.window.Event('change'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(JSON.parse(second.window.localStorage.getItem('alva-prototype-review:alva-studio-ui-reference.html')).length, 1);
});

test('importação inválida não altera propostas e revisão não muta filhos do ícone', async () => {
  const { window, button } = boot();
  const before = button.innerHTML;
  activate(window);
  button.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(button.innerHTML, before);

  const input = window.document.querySelector('input[type="file"]');
  const file = { text: async () => '{"format":"wrong","proposals":[]}' };
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new window.Event('change'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(window.localStorage.length, 0);
  assert.match(window.document.querySelector('.review-status').textContent, /inválido/i);
});

test('HTML real preserva ícone, restaura proposta no reload e mantém a rota após renomear', () => {
  const first = bootReference();
  const nav = [...first.window.document.querySelectorAll('.project-sidebar .nav-item')].find(el => /Páginas/.test(el.textContent));
  const icon = nav.querySelector('.material-symbols-outlined');
  activate(first.window);
  nav.dispatchEvent(new first.window.MouseEvent('mouseover', { bubbles: true }));
  nav.dispatchEvent(new first.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  first.window.document.querySelector('input[name="name"]').value = 'Acervo';
  first.window.document.querySelector('.save').click();
  assert.equal(nav.querySelector('span:last-child').textContent.trim(), 'Acervo');
  assert.equal(nav.querySelector('.material-symbols-outlined'), icon);
  const saved = first.window.localStorage.getItem('alva-prototype-review:alva-studio-ui-reference.html');

  const second = bootReference(saved);
  const restoredNav = [...second.window.document.querySelectorAll('.project-sidebar .nav-item')].find(el => /Acervo/.test(el.textContent));
  assert.equal(restoredNav.querySelector('span:last-child').textContent.trim(), 'Acervo');
  restoredNav.dispatchEvent(new second.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(second.window.document.querySelector('#view-landing').classList.contains('active'), true);

  activate(second.window);
  restoredNav.dispatchEvent(new second.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  [...second.window.document.querySelectorAll('.review-panel button')].find(button => /Remover proposta/.test(button.textContent)).click();
  assert.equal(restoredNav.querySelector('span:last-child').textContent.trim(), 'Páginas');
});

test('HTML real navega, explica ações sem backend e alterna controles locais', () => {
  const { window } = bootReference();
  const doc = window.document;
  doc.querySelector('[data-review-id="r0013"]').click();
  assert.equal(doc.querySelector('#view-project').classList.contains('active'), true);
  doc.querySelector('[data-review-id="r0130"]').click();
  assert.equal(doc.querySelector('.prototype-help').hidden, false);
  assert.match(doc.querySelector('.prototype-help').textContent, /nenhuma chave é criada/i);
  doc.querySelector('.prototype-help button').click();
  doc.querySelector('[data-review-id="r0134"]').click();
  assert.equal(doc.querySelector('#view-home').classList.contains('active'), true);
  const theme = doc.querySelector('[data-review-id="r0022"]');
  theme.click();
  assert.equal(doc.body.classList.contains('prototype-theme-dark'), true);
  assert.equal(theme.getAttribute('aria-pressed'), 'true');
  const collapse = doc.querySelector('[data-review-id="r0023"]');
  collapse.click();
  assert.equal(doc.body.classList.contains('prototype-sidebar-collapsed'), true);
});

test('HTML real oferece tooltip normal e configurações sem executar ação em revisão', () => {
  const { window } = bootReference();
  const doc = window.document;
  const agents = doc.querySelector('[data-review-id="r0017"]');
  agents.focus();
  assert.equal(doc.querySelector('.prototype-tooltip').hidden, false);
  assert.match(doc.querySelector('.prototype-tooltip').textContent, /Agentes/);
  doc.querySelector('[data-review-id="r0021"]').click();
  doc.querySelector('[data-review-id="r0385"]').click();
  assert.equal(doc.querySelector('#view-settings').classList.contains('active'), true);
  assert.equal(doc.querySelector('[data-review-id="r0394"]').classList.contains('active'), true);
  doc.querySelector('[data-review-id="r0387"]').click();
  assert.equal(doc.querySelector('.prototype-help').hidden, false);
  doc.querySelector('.prototype-help button').click();
  activate(window);
  doc.querySelector('[data-review-id="r0013"]').click();
  assert.equal(doc.querySelector('#view-project').classList.contains('active'), false);
  assert.equal(doc.querySelector('.review-panel').hidden, false);
});

test('HTML real explica ações genéricas e descreve abas superiores', () => {
  const { window } = bootReference();
  const doc = window.document;
  const homeTab = doc.querySelector('[data-view="home"]');
  assert.equal(homeTab.getAttribute('aria-describedby'), 'prototype-action-tip');
  homeTab.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
  assert.equal(doc.querySelector('.prototype-tooltip').hidden, false);
  doc.querySelector('[data-review-id="r0026"]').click();
  assert.equal(doc.querySelector('.prototype-help').hidden, false);
  assert.match(doc.querySelector('.prototype-help').textContent, /nenhum projeto é criado/i);
  doc.querySelector('.prototype-help button').click();
  doc.querySelector('[data-review-id="r0021"]').click();
  doc.querySelector('[data-review-id="r0397"]').click();
  assert.equal(doc.querySelector('.prototype-help').hidden, false);
  assert.match(doc.querySelector('.prototype-help').textContent, /não grava alterações/i);
});

test('CSS de aparência altera a grade da barra e mantém contraste das superfícies', () => {
  assert.match(reviewCss, /\.prototype-sidebar-collapsed \.home-layout,\.prototype-sidebar-collapsed \.project-layout\{grid-template-columns:64px minmax\(0,1fr\)\}/);
  assert.match(reviewCss, /\.prototype-theme-dark \.square-project[\s\S]*background:var\(--white\)!important;color:var\(--ink\)!important/);
});

test('proposta salva atualiza a explicação exibida do próprio controle', () => {
  const { window } = bootReference();
  const doc = window.document;
  const agents = doc.querySelector('[data-review-id="r0017"]');
  activate(window);
  agents.click();
  doc.querySelector('textarea[name="why"]').value = 'Minha explicação revisada';
  doc.querySelector('.save').click();
  activate(window);
  agents.dispatchEvent(new window.MouseEvent('mouseenter', { bubbles: true }));
  assert.match(doc.querySelector('.prototype-tooltip').textContent, /Minha explicação revisada/);
});

test('controle nativo de adicionar opção continua funcional sem abrir ajuda', () => {
  const { window } = bootReference();
  const doc = window.document;
  doc.querySelector('[data-view="form"]').click();
  assert.equal(doc.querySelectorAll('.option-edit').length, 3);
  doc.querySelector('#add-option').click();
  assert.equal(doc.querySelectorAll('.option-edit').length, 4);
  assert.equal(doc.querySelector('.prototype-help').hidden, true);
});
