import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configDaPrevia, midiaMudou } from '../public/vsl-previa.js';
import { cssDoPlayer } from '../public/vsl-player-css.js';

const valores = {
  name: 'VSL de lançamento', sourceUrl: 'https://media.test/a.m3u8', sourceType: 'hls',
  posterUrl: 'https://media.test/capa.jpg', accentColor: '#286eea', aspectRatio: '9:16',
  autoplayMuted: true, resumeEnabled: true, ctaText: 'Comece agora', ctaUrl: '/diagnostico', ctaSeconds: 42,
  opcoes: { ctaSubtexto: 'Vagas limitadas', somInteligente: true },
};

test('a prévia recebe a mesma configuração que a VSL publicada teria', () => {
  const config = configDaPrevia(valores);
  assert.equal(config.sourceUrl, 'https://media.test/a.m3u8');
  assert.equal(config.sourceType, 'hls');
  assert.equal(config.ctaText, 'Comece agora');
  assert.equal(config.ctaSeconds, 42);
  assert.equal(config.aspectRatio, '9:16');
  assert.equal(config.opcoes.ctaSubtexto, 'Vagas limitadas');
  assert.equal(config.opcoes.perguntarAoRetomar, true, 'opção não preenchida vem do padrão');
  // Na prévia o CTA aparece desde o início: quem configura quer vê-lo, não esperar 42s.
  assert.equal(config.mostrarCtaSempre, true);
  // A retomada da prévia não escreve no navegador de quem edita.
  assert.equal(config.storage, null);
});

test('destino do CTA vazio não impede a prévia de mostrar o botão', () => {
  const config = configDaPrevia({ ...valores, ctaUrl: '' });
  assert.equal(config.ctaText, 'Comece agora');
  assert.equal(config.ctaUrl, '#');
});

test('sem texto de CTA não há botão na prévia', () => {
  assert.equal(configDaPrevia({ ...valores, ctaText: '' }).ctaText, '');
});

test('só troca de mídia recarrega o vídeo; mudar cor ou CTA não', () => {
  const antes = configDaPrevia(valores);
  assert.equal(midiaMudou(antes, configDaPrevia({ ...valores, accentColor: '#ff0000', ctaText: 'Outro' })), false);
  assert.equal(midiaMudou(antes, configDaPrevia({ ...valores, sourceUrl: 'https://media.test/b.mp4', sourceType: 'mp4' })), true);
  assert.equal(midiaMudou(antes, configDaPrevia({ ...valores, posterUrl: 'https://media.test/outra.jpg' })), true);
  assert.equal(midiaMudou(null, antes), true);
});

test('o visual do player vem de um lugar só: a página publicada e a prévia usam o mesmo CSS', () => {
  const css = cssDoPlayer('#ff0000');
  for (const classe of ['.vsl-player', '.vsl-video', '.vsl-cta', '.vsl-som', '.vsl-retomar', '.vsl-controls', '.vsl-seek']) {
    assert.match(css, new RegExp(classe.replace('.', '\\.') + '[{,: ]'), `${classe} faz parte do player`);
  }
  assert.match(css, /#ff0000/);
  assert.doesNotMatch(css, /\.vsl-page|\.vsl-embed/, 'o que é da página publicada não entra aqui');
});

// --- A lista de VSLs no mesmo cartão das páginas e dos quizzes ---
import { cartaoDaVsl } from '../public/vsl-previa.js';

const vsl = {
  id: 'v1', name: 'VSL de <lançamento>', sourceType: 'hls', status: 'Publicada',
  posterUrl: 'https://media.test/capa.jpg', aspectRatio: '9:16',
};

test('a VSL aparece no cartão do site, com a capa do vídeo em cima', () => {
  const html = cartaoDaVsl(vsl, { podeEditar: true });
  assert.match(html, /class="page-card[^"]*"/);
  assert.match(html, /class="thumbnail"/);
  assert.match(html, /<img[^>]+src="https:\/\/media\.test\/capa\.jpg"/);
  assert.match(html, /class="card-top"/);
  assert.match(html, /<h3>VSL de &lt;lançamento&gt;<\/h3>/);
  assert.match(html, /class="badge">Publicada</);
  assert.match(html, /class="card-action[^"]*edit"[^>]*data-vsl="v1"/);
});

test('sem capa, o cartão mostra o lugar do vídeo em vez de uma imagem quebrada', () => {
  const html = cartaoDaVsl({ ...vsl, posterUrl: '' }, { podeEditar: true });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /class="blank"/);
});

test('sem permissão de escrever, o cartão abre para ver e não oferece editar', () => {
  const html = cartaoDaVsl(vsl, { podeEditar: false });
  assert.match(html, /Visualizar/);
  assert.doesNotMatch(html, /class="card-action[^"]*edit"/);
});

test('capa com endereço estranho não vira atributo solto no cartão', () => {
  const html = cartaoDaVsl({ ...vsl, posterUrl: 'javascript:alert(1)' }, { podeEditar: true });
  assert.doesNotMatch(html, /javascript:/);
});

test('a prévia não emite evento de medição: quem configura não é visitante', () => {
  assert.equal(configDaPrevia(valores).medir, false);
});
