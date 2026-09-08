import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createConfirmDialog } from '../public/confirm-dialog.js';

// O confirm() nativo é suprimido por navegador e por contexto embutido: quando isso
// acontece ele devolve false sem mostrar nada, e a ação simplesmente não acontece —
// sem diálogo, sem erro, sem aviso. Foi assim que Excluir página parou de funcionar.

const palco = () => {
  const eventos = {};
  const dialog = {
    open: false, returnValue: '',
    showModal() { this.open = true; }, close(valor) { this.open = false; this.returnValue = valor ?? ''; },
    addEventListener(nome, fn) { (eventos[nome] ||= []).push(fn); },
    disparar(nome) { for (const fn of eventos[nome] || []) fn(); },
  };
  const criar = () => ({ textContent: '', className: '', dataset: {}, hidden: false, focus() { this.focado = true; } });
  const nos = { titulo: criar(), descricao: criar(), confirmar: criar(), cancelar: criar() };
  return { dialog, nos };
};

test('confirmar devolve verdadeiro só depois que a pessoa confirma', async () => {
  const { dialog, nos } = palco();
  const confirmar = createConfirmDialog({ dialog, ...nos });
  const resposta = confirmar({ titulo: 'Excluir página', confirmar: 'Excluir' });
  assert.equal(dialog.open, true, 'o diálogo precisa aparecer, ao contrário do confirm() suprimido');
  nos.confirmar.onclick();
  assert.equal(await resposta, true);
  assert.equal(dialog.open, false);
});

test('cancelar devolve falso e não executa a ação', async () => {
  const { dialog, nos } = palco();
  const confirmar = createConfirmDialog({ dialog, ...nos });
  const resposta = confirmar({ titulo: 'Excluir página' });
  nos.cancelar.onclick();
  assert.equal(await resposta, false);
});

test('fechar pelo Esc devolve falso, sem deixar a promessa pendurada', async () => {
  const { dialog, nos } = palco();
  const confirmar = createConfirmDialog({ dialog, ...nos });
  const resposta = confirmar({ titulo: 'Excluir página' });
  dialog.disparar('close');
  assert.equal(await resposta, false);
});

test('o diálogo diz o que vai acontecer, com o verbo da ação no botão', async () => {
  const { dialog, nos } = palco();
  const confirmar = createConfirmDialog({ dialog, ...nos });
  confirmar({ titulo: 'Excluir “aaa”?', descricao: 'A publicação na Vercel continua no ar.', confirmar: 'Excluir', perigo: true });
  assert.equal(nos.titulo.textContent, 'Excluir “aaa”?');
  assert.equal(nos.descricao.textContent, 'A publicação na Vercel continua no ar.');
  assert.equal(nos.confirmar.textContent, 'Excluir', 'o botão repete o verbo da ação, não diz "OK"');
  assert.match(nos.confirmar.className, /perigo/, 'ação destrutiva precisa se parecer destrutiva');
  nos.cancelar.onclick();
});

test('sem descrição a linha some, em vez de abrir um espaço vazio', async () => {
  const { dialog, nos } = palco();
  const confirmar = createConfirmDialog({ dialog, ...nos });
  confirmar({ titulo: 'Publicar?' });
  assert.equal(nos.descricao.hidden, true);
  nos.cancelar.onclick();
});

test('o foco começa em cancelar: destruir precisa ser deliberado', async () => {
  const { dialog, nos } = palco();
  const confirmar = createConfirmDialog({ dialog, ...nos });
  confirmar({ titulo: 'Excluir', perigo: true });
  assert.equal(nos.cancelar.focado, true);
  nos.cancelar.onclick();
});

test('nenhuma ação do Studio depende mais do confirm() do navegador', async () => {
  for (const arquivo of ['app.js', 'forms.js', 'owner.js']) {
    const fonte = await readFile(new URL(`../public/${arquivo}`, import.meta.url), 'utf8');
    const nativos = [...fonte.matchAll(/(?:^|[^.\w])(?:window\.)?(confirm|alert|prompt)\(/g)]
      .filter((achado) => !/dashboardContextFlow|\.confirm\(/.test(fonte.slice(Math.max(0, achado.index - 30), achado.index + 10)));
    assert.deepEqual(nativos.map((achado) => achado[1]), [], `${arquivo} ainda usa diálogo nativo, que o navegador pode suprimir sem avisar`);
  }
});
