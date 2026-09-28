// As configurações da conta: cada aba com o seu assunto. Antes, Empresa, Equipe e Plano
// mostravam o mesmo bloco (o conteúdo era movido entre elas), e o token da Vercel vivia
// escondido atrás de um botão numa aba que a engrenagem nunca abria — enquanto a tela de
// Publicação mandava justamente para lá.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { ABAS_DA_CONTA, mostrarSecoesDaAba, settingsAccess } from '../public/owner.js';

test('a conta tem uma aba por assunto, e Integrações é uma delas', () => {
  assert.deepEqual(ABAS_DA_CONTA.map(([chave]) => chave), ['account', 'company', 'team', 'integrations', 'billing']);
  assert.equal(ABAS_DA_CONTA[0][1], 'Conta');
  assert.equal(ABAS_DA_CONTA[3][1], 'Integrações');
});

test('a aba pedida é respeitada, inclusive a de integrações', () => {
  assert.equal(settingsAccess({ canManageIntegration: true, requestedTab: 'integrations' }).tab, 'integrations');
  assert.equal(settingsAccess({ canManageIntegration: true, requestedTab: 'team' }).tab, 'team');
  // Sem permissão de integração, quem pede integrações cai na conta em vez de ver um painel vazio.
  assert.equal(settingsAccess({ canManageIntegration: false, requestedTab: 'integrations' }).tab, 'account');
});

test('cada aba mostra só as seções do seu assunto', () => {
  const { window } = new JSDOM(`<div id="c">
    <section data-settings-area="company"><h2>Projetos</h2></section>
    <section data-settings-area="team"><h2>Equipe</h2></section>
    <section data-settings-area="billing"><h2>Plano e cobrança</h2></section>
  </div>`);
  const conteudo = window.document.querySelector('#c');
  const visiveis = () => [...conteudo.querySelectorAll('[data-settings-area]')].filter((s) => !s.hidden).map((s) => s.dataset.settingsArea);
  mostrarSecoesDaAba(conteudo, 'team');
  assert.deepEqual(visiveis(), ['team']);
  mostrarSecoesDaAba(conteudo, 'billing');
  assert.deepEqual(visiveis(), ['billing']);
  mostrarSecoesDaAba(conteudo, 'company');
  assert.deepEqual(visiveis(), ['company']);
  window.close();
});

test('as licenças de terceiros aparecem uma vez, não em toda aba', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const secao = html.slice(html.indexOf('id="settings-view"'), html.indexOf('</section>', html.indexOf('id="settings-view"')));
  assert.match(secao, /Licenças de terceiros/);
  assert.match(secao, /data-settings-area="account"/, 'o bloco pertence a uma aba, como qualquer outra seção');
});

test('a engrenagem abre a conta, não desvia para outra aba', async () => {
  const owner = await readFile(new URL('../public/owner.js', import.meta.url), 'utf8');
  assert.doesNotMatch(owner, /tab === 'account' \? 'company' : tab/);
});

test('o token da Vercel mora na aba Integrações, não escondido atrás de um botão', async () => {
  const owner = await readFile(new URL('../public/owner.js', import.meta.url), 'utf8');
  assert.match(owner, /panel-integrations/);
  assert.doesNotMatch(owner, /id="account-publication"[^-]/, 'o botão-porta "Conectar a Vercel" deixa de existir');
});

test('todo ícone das abas tem desenho: o nome cru não aparece no lugar dele', async () => {
  const { ABAS_DO_PROJETO } = await import('../public/projeto-configuracoes.js');
  const icones = await readFile(new URL('../public/icones.js', import.meta.url), 'utf8');
  for (const [, rotulo, icone] of [...ABAS_DA_CONTA, ...ABAS_DO_PROJETO])
    assert.match(icones, new RegExp(`"${icone}"`), `falta o ícone ${icone} (aba ${rotulo})`);
});

test('cada aba tem o seu título: o cabeçalho não diz "Empresa e equipe" na aba de Integrações', async () => {
  const { tituloDaAba } = await import('../public/owner.js');
  assert.equal(tituloDaAba('account'), 'Sua conta');
  assert.equal(tituloDaAba('company'), 'Empresa');
  assert.equal(tituloDaAba('team'), 'Equipe e acessos');
  assert.equal(tituloDaAba('integrations'), 'Integrações');
  assert.equal(tituloDaAba('billing'), 'Plano e cobrança');
});

test('o bloco da empresa repintado continua obedecendo a aba aberta', async () => {
  const owner = await readFile(new URL('../public/owner.js', import.meta.url), 'utf8');
  assert.match(owner, /new MutationObserver\(\(\) => \{[^}]*\}\)\.observe\(\$\('#settings-company-content'\)/);
  assert.match(owner, /mostrarSecoesDaAba\(settingsContainer, abaAtual\)/, 'a repintura reaplica a aba');
});

test('a nota de licenças vem depois do que a pessoa foi fazer ali', async () => {
  const css = await readFile(new URL('../public/owner.css', import.meta.url), 'utf8');
  const regra = css.slice(css.indexOf("#settings-view > [data-settings-area='account']"));
  assert.match(regra.slice(0, regra.indexOf('}')), /order: 2/);
});

test('os blocos das configurações têm todos a mesma largura', async () => {
  const css = await readFile(new URL('../public/owner.css', import.meta.url), 'utf8');
  const regra = css.slice(css.indexOf('#settings-view {\n  display: grid'));
  assert.match(regra.slice(0, regra.indexOf('}')), /grid-template-columns: minmax\(0, \d+px\)/);
  assert.doesNotMatch(css, /#settings-view #panel-account,\n#settings-view #panel-company/, 'largura por painel volta a divergir');
});

test('nenhum bloco das configurações carrega largura própria no atributo style', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const tela = html.slice(html.indexOf('id="settings-view"'), html.indexOf('id="project-view"'));
  assert.doesNotMatch(tela, /style="[^"]*max-width/, 'a medida é do grid da página');
});

test('a empresa é carregada em qualquer aba: a lateral não fica em "Carregando"', async () => {
  const owner = await readFile(new URL('../public/owner.js', import.meta.url), 'utf8');
  const trecho = owner.slice(owner.indexOf('function selectTab'), owner.indexOf('function applyIntegrationAccess'));
  assert.doesNotMatch(trecho, /includes\(tab\)\) \{\s*placeCompanyContent[\s\S]*onCompanySettings\(\)/, 'carregar a empresa não pode depender da aba');
  assert.match(trecho, /onCompanySettings\(\)/);
});

test('a lateral recebe o nome da empresa depois que ele chega do servidor', async () => {
  const owner = await readFile(new URL('../public/owner.js', import.meta.url), 'utf8');
  assert.match(owner, /Promise\.resolve\(onCompanySettings\(\)\)\.then\(syncCompanyDetails\)/);
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const bloco = app.slice(app.indexOf('onCompanySettings: () =>'), app.indexOf('onSettingsClosed:'));
  assert.match(bloco, /return Promise\.all\(/, 'sem devolver a promessa, quem chamou não tem o que esperar');
});
