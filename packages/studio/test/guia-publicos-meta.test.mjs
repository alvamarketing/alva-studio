// O guia "Como configurar os públicos da Meta", agora um pop-up dentro do Studio.
//
// A primeira versão foi uma página solta, em outra aba, com blocos demais e sem um único link
// para os lugares da Meta onde a pessoa tem de ir — ela tinha de adivinhar onde aceitar os
// termos, onde achar o número da conta, onde gerar a chave. Este guia leva a pessoa pela mão:
// cada passo tem o botão que abre o lugar certo, e os endereços são os dos artigos oficiais.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { PUBLICOS } from '../server/meta-publicos.mjs';
import { LINKS_DA_META, PASSOS, abrirGuiaPublicosMeta, linkDosTermos } from '../public/guia-publicos-meta.js';

const ler = (caminho) => readFile(new URL(caminho, import.meta.url), 'utf8');

function montar() {
  const dom = new JSDOM('<body></body>', { pretendToBeVisual: true });
  const { window } = dom;
  // O jsdom não implementa <dialog>: o essencial do navegador, só para o teste.
  window.HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
  return { window, doc: window.document };
}

test('o guia é um pop-up (dialog) do próprio Studio, com título, botão de fechar e foco no que importa', () => {
  const { doc, window } = montar();
  const dialogo = abrirGuiaPublicosMeta(doc);
  assert.equal(dialogo.tagName, 'DIALOG');
  assert.ok(dialogo.hasAttribute('open'));
  assert.match(dialogo.querySelector('h2').textContent, /públicos da Meta/i);
  assert.ok(dialogo.querySelector('button[aria-label="Fechar"]'));
  assert.equal(dialogo.getAttribute('aria-labelledby'), dialogo.querySelector('h2').id);
  // Abrir de novo reaproveita o mesmo pop-up, em vez de empilhar cópias.
  abrirGuiaPublicosMeta(doc);
  assert.equal(doc.querySelectorAll('dialog.guia-dialog').length, 1);
  window.close();
});

test('cada passo tem título, explicação e botões que levam ao lugar certo da Meta', () => {
  assert.ok(PASSOS.length >= 5);
  for (const passo of PASSOS) {
    assert.ok(passo.titulo && passo.texto, `o passo "${passo.titulo}" precisa de título e texto`);
  }
  const { doc } = montar();
  const dialogo = abrirGuiaPublicosMeta(doc);
  const links = [...dialogo.querySelectorAll('a[href^="https://"]')].map((a) => a.getAttribute('href'));
  for (const alvo of [
    LINKS_DA_META.gerenciadorDeAnuncios, LINKS_DA_META.configuracoesDoNegocio, LINKS_DA_META.gerenciadorDeEventos,
    LINKS_DA_META.ajudaNumeroDaConta, LINKS_DA_META.ajudaUsuariosDoSistema, LINKS_DA_META.docGerarToken, LINKS_DA_META.docTermos, LINKS_DA_META.docPublicosDeSite,
  ]) assert.ok(links.includes(alvo), `falta o link para ${alvo}`);
});

test('os endereços da Meta são os que conferimos: portal oficial, sem inventar caminho', () => {
  assert.equal(LINKS_DA_META.gerenciadorDeAnuncios, 'https://adsmanager.facebook.com/');
  assert.equal(LINKS_DA_META.configuracoesDoNegocio, 'https://business.facebook.com/settings');
  assert.equal(LINKS_DA_META.ajudaNumeroDaConta, 'https://www.facebook.com/business/help/1492627900875762');
  assert.equal(LINKS_DA_META.ajudaUsuariosDoSistema, 'https://www.facebook.com/business/help/503306463479099');
  for (const endereco of Object.values(LINKS_DA_META)) assert.match(endereco, /^https:\/\/(?:[a-z]+\.)?(?:facebook\.com)\//);
});

test('todo link externo abre em outra aba sem vazar a janela, e tem o ícone de "sai do Studio"', () => {
  const { doc } = montar();
  const dialogo = abrirGuiaPublicosMeta(doc);
  const externos = [...dialogo.querySelectorAll('a[href^="https://"]')];
  assert.ok(externos.length >= 8);
  for (const link of externos) {
    assert.equal(link.target, '_blank');
    assert.match(link.rel, /noopener/);
    assert.ok(link.querySelector('.material-symbols-outlined')?.textContent === 'open_in_new', `o link "${link.textContent.trim()}" mostra que abre fora`);
  }
});

test('o link dos termos só abre depois que a pessoa digita o número da conta, e só com dígitos', () => {
  assert.equal(linkDosTermos(''), null);
  assert.equal(linkDosTermos('abc'), null);
  assert.equal(linkDosTermos('9876543210'), 'https://business.facebook.com/ads/manage/customaudiences/tos/?act=9876543210');
  assert.equal(linkDosTermos(' act_9876 54321 '), 'https://business.facebook.com/ads/manage/customaudiences/tos/?act=987654321', 'tira o que não é dígito: quem cola "act_123" não erra');
  const { doc, window } = montar();
  const dialogo = abrirGuiaPublicosMeta(doc);
  const campo = dialogo.querySelector('input[name="numero-da-conta"]');
  const botao = () => dialogo.querySelector('[data-link-dos-termos]');
  assert.ok(botao().hasAttribute('aria-disabled'), 'sem número, o botão não leva a lugar nenhum');
  assert.equal(botao().getAttribute('href'), null);
  campo.value = '1234567890';
  campo.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(botao().getAttribute('href'), 'https://business.facebook.com/ads/manage/customaudiences/tos/?act=1234567890');
  assert.equal(botao().hasAttribute('aria-disabled'), false);
  window.close();
});

test('o guia cobre os seis públicos, o aviso da chave e o que fazer quando algo falha', () => {
  const { doc } = montar();
  const texto = abrirGuiaPublicosMeta(doc).textContent;
  for (const publico of PUBLICOS) assert.ok(texto.includes(publico.nome), `falta "${publico.nome}"`);
  assert.match(texto, /ads_management/);
  assert.match(texto, /Termos de Públicos Personalizados/);
  assert.match(texto, /não serve|outra chave/i);
  assert.match(texto, /excluir/i);
  assert.match(texto, /só esquece|não apaga/i);
  assert.match(texto, /portfólio empresarial/i, 'o nome que a Meta usa hoje, e não o antigo');
});

test('o guia não vira um mural de caixinhas: o essencial são os passos, o resto é recolhível', () => {
  const { doc } = montar();
  const dialogo = abrirGuiaPublicosMeta(doc);
  assert.ok(dialogo.querySelector('ol.guia-passos'));
  assert.ok(dialogo.querySelectorAll('details').length >= 4, 'público, anúncios, "se algo der errado" e teste ficam recolhidos');
  assert.equal(dialogo.querySelectorAll('.surface, .page-block, .list-card').length, 0, 'sem cartão dentro de cartão');
});

test('o passo do pixel leva a pessoa até Rastreamento, dentro do Studio', () => {
  const { doc, window } = montar();
  const recebidos = [];
  doc.addEventListener('alva:abrir-config', (evento) => recebidos.push(evento.detail));
  const dialogo = abrirGuiaPublicosMeta(doc);
  dialogo.querySelector('[data-ir-para="pixel"]').click();
  assert.deepEqual(recebidos, [{ assunto: 'pixel' }]);
  assert.equal(dialogo.hasAttribute('open'), false, 'o pop-up fecha para a pessoa ver a tela');
  window.close();
});

test('os ícones do guia existem no conjunto Lucide do Studio', async () => {
  const icones = await ler('../public/icones.js');
  for (const nome of ['open_in_new', 'close', 'help', 'check_circle']) assert.match(icones, new RegExp(`"${nome}"`), `falta o ícone ${nome}`);
});

test('o botão "Saiba como configurar o público da Meta" aparece onde a pessoa vai procurar, e abre o pop-up', async () => {
  const texto = 'Saiba como configurar o público da Meta';
  for (const [arquivo, onde] of [['../public/publicos-meta-ui.js', 'no cartão dos públicos'], ['../public/projeto-leads.js', 'na aba Leads das configurações'], ['../public/index.html', 'na tela de Leads']]) {
    const fonte = await ler(arquivo);
    assert.ok(fonte.includes(texto), onde);
    assert.ok(fonte.includes('data-guia="publicos-meta"') || fonte.includes("'data-guia', 'publicos-meta'") || fonte.includes("dataset.guia = 'publicos-meta'"), `${onde}: o botão chama o pop-up`);
    assert.doesNotMatch(fonte, /href="\/ajuda\/publicos-meta"|href = '\/ajuda\/publicos-meta'/, `${onde}: sem link para página solta`);
  }
  const app = await ler('../public/app.js');
  assert.match(app, /\[data-guia="publicos-meta"\]/);
  assert.match(app, /alva:abrir-config/);
});

test('a página solta saiu: não há mais rota nem arquivo do guia antigo', async () => {
  await assert.rejects(access(new URL('../public/ajuda-publicos-meta.html', import.meta.url)));
  const index = await ler('../server/index.mjs');
  assert.doesNotMatch(index, /ajuda\/publicos-meta/);
  assert.match(index, /'\/guia-publicos-meta\.js'/, 'o módulo do pop-up é entregue');
});

test('o estilo do pop-up usa só os tokens do Studio', async () => {
  const css = await ler('../public/owner.css');
  const bloco = css.slice(css.indexOf('/* Guia dos públicos da Meta'));
  assert.ok(bloco.length > 200);
  assert.doesNotMatch(bloco, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(bloco, /border-radius: *\d/);
});
