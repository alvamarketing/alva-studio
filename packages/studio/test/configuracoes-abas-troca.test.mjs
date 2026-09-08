import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { selectSettingsTab } from '../public/owner.js';

// Quem esconde e mostra os painéis é selectSettingsTab, procurando as abas dentro do
// "tabList" que recebe. Enquanto a navegação vivia na barra lateral, esse tabList era a
// barra. Ao mover as abas para o topo, ele passou a procurar num lugar onde não há
// nenhuma: as abas trocavam de cor e o painel embaixo continuava o mesmo.

const palco = () => {
  const botoes = ['account', 'company', 'team', 'billing'].map((chave) => {
    const atributos = {};
    return {
      chave,
      dataset: { settingsSidebarTab: chave },
      tabIndex: -1,
      setAttribute: (nome, valor) => { atributos[nome] = valor; },
      atributos,
    };
  });
  const paineis = Object.fromEntries(botoes.map((b) => [b.chave, { hidden: true }]));
  return {
    botoes,
    paineis,
    faixa: { querySelectorAll: () => botoes },
    container: { querySelector: (seletor) => paineis[seletor.replace('#panel-', '')] || null },
  };
};

test('escolher uma aba mostra o painel dela e esconde os outros', () => {
  const { faixa, container, paineis } = palco();
  selectSettingsTab({ container, tabList: faixa, requestedTab: 'company', canManageIntegration: true });
  assert.equal(paineis.company.hidden, false);
  assert.equal(paineis.account.hidden, true);
  assert.equal(paineis.team.hidden, true);
});

test('a aba escolhida é a única marcada e a única alcançável por tabulação', () => {
  const { faixa, container, botoes } = palco();
  selectSettingsTab({ container, tabList: faixa, requestedTab: 'team', canManageIntegration: true });
  const marcadas = botoes.filter((b) => b.atributos['aria-selected'] === 'true');
  assert.deepEqual(marcadas.map((b) => b.chave), ['team']);
  assert.equal(botoes.find((b) => b.chave === 'team').tabIndex, 0);
  assert.equal(botoes.find((b) => b.chave === 'account').tabIndex, -1);
});

test('a lista de abas passada é a faixa do topo, não a barra lateral', async () => {
  const fonte = await readFile(new URL('../public/owner.js', import.meta.url), 'utf8');
  const inicio = fonte.indexOf('const faixaDeAbas');
  const chamada = fonte.slice(inicio, inicio + 340);
  assert.doesNotMatch(chamada, /tabList: settingsSidebar/, 'as abas saíram da barra lateral; procurar lá não acha nenhuma');
  assert.match(chamada, /settings-tabs/, 'o tabList precisa apontar para onde as abas moram agora');
});
