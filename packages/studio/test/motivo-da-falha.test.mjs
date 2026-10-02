// O motivo da falha, e a tela dizendo a verdade sobre cada entrega.
//
// Critério 12 do rastreamento: "Se a Meta recusar o evento por credencial errada, a tela
// mostra que o envio falhou e o motivo, em vez de mostrá-lo como enviado." A fila já
// gravava o motivo; a tela não o mostrava — e mostrava "Encerrada", que pode ser lido
// como "terminou". No mesmo painel havia mais duas afirmações falsas: "destinos
// concluídos" listava também os que falharam, e "hashes gerados no servidor" aparecia
// mesmo sem consentimento, quando nenhum hash é gerado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoDaEntrega, motivoDaFalha, passosDaJornada, trackingEventsModel } from '../public/studio-dashboard.js';

test('credencial recusada vira uma frase que diz o que conferir, e onde', () => {
  for (const codigo of ['destination_rejected_401', 'destination_rejected_403']) {
    assert.match(motivoDaFalha(codigo, 'Meta'), /recusou a credencial/i);
    assert.match(motivoDaFalha(codigo, 'Meta'), /Meta.*na aba Plataformas das Configurações do projeto/);
  }
});

// A conferência na tela, em 27/09, mostrou o Google Ads falhando com "confira o token do
// pixel": o Google não tem pixel nem token com esse nome. A frase tem de valer para
// qualquer destino.
test('o motivo nomeia o destino que falhou, sem falar de pixel a quem não tem', () => {
  const frase = motivoDaFalha('destination_rejected_401', 'Google Ads');
  assert.match(frase, /Google Ads/);
  assert.doesNotMatch(frase, /pixel/i);
  assert.doesNotMatch(motivoDaFalha('destination_rejected_404', 'Google Ads'), /pixel/i);
  assert.doesNotMatch(motivoDaFalha('destination_not_configured', 'LinkedIn'), /pixel/i);
});

test('cada motivo conhecido tem uma frase, e o desconhecido não vaza código', () => {
  assert.match(motivoDaFalha('destination_rejected_404', 'Meta'), /não encontrou/i);
  assert.match(motivoDaFalha('destination_rejected_400'), /recusou o evento/i);
  assert.match(motivoDaFalha('destination_unavailable_503'), /indisponível.*tenta de novo/i);
  assert.match(motivoDaFalha('destination_unavailable_429'), /tenta de novo/i);
  assert.match(motivoDaFalha('transport_error'), /tenta de novo/i);
  assert.match(motivoDaFalha('destination_not_configured'), /sem credencial/i);
  assert.equal(motivoDaFalha('qualquer_coisa_interna'), 'O envio falhou.');
  assert.equal(motivoDaFalha(null), '');
});

test('entrega que falhou diz "Falhou" e o motivo; a entregue não tem motivo', () => {
  assert.deepEqual(estadoDaEntrega({ destination: 'meta', status: 'dead', lastError: 'destination_rejected_401' }), {
    destino: 'meta', nome: 'Meta', rotulo: 'Falhou', estado: 'error', motivo: motivoDaFalha('destination_rejected_401', 'Meta'),
  });
  assert.deepEqual(estadoDaEntrega({ destination: 'google', status: 'delivered', lastError: null }), {
    destino: 'google', nome: 'Google Ads', rotulo: 'Entregue', estado: 'ok', motivo: '',
  });
  assert.equal(estadoDaEntrega({ destination: 'tiktok', status: 'retry', lastError: 'destination_unavailable_503' }).rotulo, 'Nova tentativa');
});

// "Destinos concluídos" listava todos os destinos do evento, inclusive os que falharam.
test('o evento guarda o estado de cada destino, não só os nomes', () => {
  const [evento] = trackingEventsModel([
    { id: '1', eventRef: 'e1', eventName: 'lead', destination: 'meta', status: 'delivered', consentState: 'pending', createdAt: '2026-09-27T10:00:00Z' },
    { id: '2', eventRef: 'e1', eventName: 'lead', destination: 'google', status: 'dead', lastError: 'destination_rejected_401', consentState: 'pending', createdAt: '2026-09-27T10:00:00Z' },
  ]);
  assert.equal(evento.status, 'Falhou');
  assert.deepEqual(evento.entregas.map((entrega) => [entrega.destino, entrega.rotulo]), [['meta', 'Entregue'], ['google', 'Falhou']]);
  assert.match(evento.entregas[1].motivo, /recusou a credencial/i);
});

test('a jornada lista cada destino com seu estado, e o motivo de quem falhou', () => {
  const [evento] = trackingEventsModel([
    { id: '1', eventRef: 'e1', eventName: 'lead', destination: 'meta', status: 'delivered', consentState: 'pending', createdAt: '2026-09-27T10:00:00Z' },
    { id: '2', eventRef: 'e1', eventName: 'lead', destination: 'google', status: 'dead', lastError: 'destination_rejected_401', consentState: 'pending', createdAt: '2026-09-27T10:00:00Z' },
  ]);
  const passos = passosDaJornada(evento);
  const destinos = passos.find((passo) => passo.nome === 'Destinos');
  assert.ok(destinos, 'a jornada precisa de um passo com os destinos');
  assert.doesNotMatch(destinos.detalhe, /conclu/i, 'não pode chamar de concluído o que falhou');
  assert.match(destinos.detalhe, /Meta · Entregue/);
  assert.match(destinos.detalhe, /Google Ads · Falhou — .*credencial/i);
});

// Sem consentimento concedido, o servidor não gera hash de contato nenhum.
test('a jornada só fala em hash de contato quando ele foi gerado', () => {
  const evento = (consentState) => trackingEventsModel([{ id: '1', eventRef: 'e1', eventName: 'lead', destination: 'meta', status: 'delivered', consentState, createdAt: '2026-09-27T10:00:00Z' }])[0];
  const consentimento = (estado) => passosDaJornada(evento(estado)).find((passo) => passo.nome === 'Consentimento').detalhe;
  assert.match(consentimento('granted'), /hash/i);
  for (const estado of ['pending', 'denied']) {
    assert.doesNotMatch(consentimento(estado), /hash/i, `${estado}: afirmaria um hash que não existe`);
    assert.match(consentimento(estado), /sem e-mail nem telefone/i);
  }
});

test('nenhuma tela usa mais "Encerrada" para dizer que falhou', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const arquivo of ['../public/app.js', '../public/studio-dashboard.js', '../public/index.html']) {
    const fonte = await readFile(new URL(arquivo, import.meta.url), 'utf8');
    assert.doesNotMatch(fonte, /Encerrad[ao]/, `${arquivo} ainda chama falha de encerrada`);
  }
});

test('a coluna de consentimento fala como o resto da tela, não em código', () => {
  const rotulos = ['granted', 'pending', 'denied'].map((estado) => trackingEventsModel([
    { id: estado, eventRef: estado, eventName: 'lead', destination: 'meta', status: 'delivered', consentState: estado },
  ])[0].consentLabel);
  assert.deepEqual(rotulos, ['Concedido', 'Aguardando decisão', 'Negado']);
});
