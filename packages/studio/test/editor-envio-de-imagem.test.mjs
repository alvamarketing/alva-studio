// O envio de imagem do editor. O Puck grava o valor de um campo no bloco que estiver
// selecionado quando o valor chega; o envio é assíncrono, e quem clicava em outro bloco
// durante o envio mandava o endereço para esse outro bloco (ou para a raiz) — a imagem
// ficava vazia, e vazia ela não aparecia no canvas. O envio grava no bloco que o pediu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { aceitarArquivosSoltos, chaveDoEnvio, enviarImagemPara, estadoDoEnvio, ouvirEnvios, rotuloDoEnvio } from '../editor/envios-de-imagem.js';

// Um Puck de mentira: a árvore, o que está selecionado e o que foi despachado.
function puckFalso({ itens, selecionado = null, raiz = { props: { title: 'T' } } }) {
  const despachos = [];
  const api = {
    get selectedItem() { return itens.find((item) => item.props.id === api.selecionado) ?? null; },
    selecionado,
    appState: { data: { root: raiz } },
    getItemById: (id) => itens.find((item) => item.props.id === id),
    getSelectorForId: (id) => { const i = itens.findIndex((item) => item.props.id === id); return i < 0 ? undefined : { index: i, zone: 'secao-1:itens' }; },
    dispatch: (acao) => despachos.push(acao),
  };
  return { api, getPuck: () => api, despachos };
}
const adiado = () => { let resolver; let rejeitar; const promessa = new Promise((r, j) => { resolver = r; rejeitar = j; }); return { promessa, resolver, rejeitar }; };

test('o endereço vai para a imagem que pediu, mesmo com outro bloco selecionado no fim', async () => {
  const { api, getPuck, despachos } = puckFalso({ itens: [{ type: 'image', props: { id: 'img-1', src: '', alt: '' } }, { type: 'heading', props: { id: 'tit-1', text: 'Oi' } }], selecionado: 'img-1' });
  const envio = adiado();
  const pronto = enviarImagemPara({ getPuck, id: 'img-1', nome: 'src', arquivo: {}, enviarImagem: () => envio.promessa });
  assert.equal(estadoDoEnvio(chaveDoEnvio('img-1', 'src'))?.fase, 'enviando');
  api.selecionado = 'tit-1';
  envio.resolver('/i/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e');
  await pronto;
  assert.equal(despachos.length, 1);
  assert.equal(despachos[0].type, 'replace');
  assert.equal(despachos[0].destinationIndex, 0);
  assert.equal(despachos[0].destinationZone, 'secao-1:itens');
  assert.equal(despachos[0].data.props.id, 'img-1');
  assert.equal(despachos[0].data.props.src, '/i/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e');
  assert.equal(estadoDoEnvio(chaveDoEnvio('img-1', 'src')), undefined);
});

test('ainda selecionada, a imagem recebe o endereço pelo caminho normal do campo', async () => {
  const { getPuck, despachos } = puckFalso({ itens: [{ type: 'image', props: { id: 'img-1', src: '' } }], selecionado: 'img-1' });
  const recebidos = [];
  await enviarImagemPara({ getPuck, id: 'img-1', nome: 'src', arquivo: {}, enviarImagem: async () => '/i/a', aoMudar: (valor) => recebidos.push(valor) });
  assert.deepEqual(recebidos, ['/i/a']);
  assert.equal(despachos.length, 0);
});

test('campo da raiz (logo do quiz) grava na raiz, mesmo com um bloco selecionado no fim', async () => {
  const { api, getPuck, despachos } = puckFalso({ itens: [{ type: 'heading', props: { id: 'tit-1' } }], raiz: { props: { title: 'Quiz', logo: '' } } });
  const envio = adiado();
  const pronto = enviarImagemPara({ getPuck, id: null, nome: 'logo', arquivo: {}, enviarImagem: () => envio.promessa, aoMudar: () => assert.fail('não pode gravar no bloco selecionado') });
  api.selecionado = 'tit-1';
  envio.resolver('/i/b');
  await pronto;
  assert.equal(despachos[0].type, 'replaceRoot');
  assert.deepEqual(despachos[0].root.props, { title: 'Quiz', logo: '/i/b' });
});

test('imagem apagada durante o envio: nada é gravado em lugar nenhum', async () => {
  const fake = puckFalso({ itens: [{ type: 'image', props: { id: 'img-1', src: '' } }], selecionado: 'img-1' });
  const envio = adiado();
  const pronto = enviarImagemPara({ getPuck: fake.getPuck, id: 'img-1', nome: 'src', arquivo: {}, enviarImagem: () => envio.promessa, aoMudar: () => assert.fail('apagada') });
  fake.api.getItemById = () => undefined;
  fake.api.getSelectorForId = () => undefined;
  fake.api.selecionado = null;
  envio.resolver('/i/c');
  await pronto;
  assert.equal(fake.despachos.length, 0);
});

test('falha no envio fica registrada com a mensagem, até a próxima tentativa', async () => {
  const { getPuck } = puckFalso({ itens: [{ type: 'image', props: { id: 'img-2', src: '' } }], selecionado: 'img-2' });
  const chave = chaveDoEnvio('img-2', 'src');
  const avisos = [];
  const parar = ouvirEnvios(() => avisos.push(estadoDoEnvio(chave)?.fase));
  await enviarImagemPara({ getPuck, id: 'img-2', nome: 'src', arquivo: {}, enviarImagem: async () => { throw new Error('A imagem passa de 5 MB. Reduza e tente de novo.'); } });
  assert.deepEqual(estadoDoEnvio(chave), { fase: 'erro', mensagem: 'A imagem passa de 5 MB. Reduza e tente de novo.' });
  assert.deepEqual(avisos, ['enviando', 'erro']);
  parar();
});

test('o texto do lugar da imagem acompanha o envio', () => {
  assert.equal(rotuloDoEnvio(undefined).texto, 'Escolher imagem');
  assert.equal(rotuloDoEnvio({ fase: 'enviando' }).texto, 'Enviando…');
  assert.deepEqual(rotuloDoEnvio({ fase: 'erro', mensagem: 'Use uma imagem PNG, JPEG, WebP ou GIF.' }), { fase: 'erro', texto: 'Use uma imagem PNG, JPEG, WebP ou GIF.', dica: 'Escolha outra imagem.' });
});

test('a chave separa campo e bloco; campo da raiz usa "raiz"', () => {
  assert.equal(chaveDoEnvio('img-1', 'src'), 'img-1:src');
  assert.equal(chaveDoEnvio(null, 'logo'), 'raiz:logo');
});

// Arquivo solto da área de trabalho: sem quem o receba, o navegador abria o arquivo numa aba.
function soltarArquivo(doc, alvo, arquivos = [{ name: 'foto.png' }], tipos = ['Files']) {
  const evento = new doc.defaultView.Event('drop', { bubbles: true, cancelable: true });
  evento.dataTransfer = { types: tipos, files: arquivos, dropEffect: 'none' };
  alvo.dispatchEvent(evento);
  return evento;
}

test('arquivo solto em cima de um bloco Imagem vai para ela; em outro lugar, o editor avisa onde soltar', async () => {
  const { window } = new JSDOM('<div data-puck-component="img-9"><div class="alva-imagem-vazia"><span>Escolher imagem</span></div></div><div data-puck-component="tit-9"><h2>Oi</h2></div>');
  const doc = window.document;
  const { getPuck, despachos } = puckFalso({ itens: [{ type: 'image', props: { id: 'img-9', src: '' } }, { type: 'heading', props: { id: 'tit-9' } }] });
  const avisos = [];
  const enviados = [];
  const parar = aceitarArquivosSoltos(doc, { getPuck, aviso: (texto) => avisos.push(texto), enviarImagem: async (arquivo) => { enviados.push(arquivo.name); return '/i/solta'; } });

  const naImagem = soltarArquivo(doc, doc.querySelector('span'));
  assert.equal(naImagem.defaultPrevented, true, 'o navegador não pode abrir o arquivo');
  await new Promise((resolver) => setTimeout(resolver, 0));
  assert.deepEqual(enviados, ['foto.png']);
  assert.equal(despachos.at(-1).data.props.src, '/i/solta');

  const noTitulo = soltarArquivo(doc, doc.querySelector('h2'));
  assert.equal(noTitulo.defaultPrevented, true);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /bloco Imagem/);

  const arrastoQueNaoEArquivo = soltarArquivo(doc, doc.querySelector('h2'), [], ['text/plain']);
  assert.equal(arrastoQueNaoEArquivo.defaultPrevented, false, 'arrasto que não é arquivo segue livre');
  parar();
  assert.equal(soltarArquivo(doc, doc.querySelector('span')).defaultPrevented, false);
});
