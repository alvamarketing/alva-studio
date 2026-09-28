// Fundo livre na seção e vídeo por link: o que o dono edita, e o que o esquema recusa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderNode, enderecoDoVideo } from '../public/page-schema.js';

test('seção com cor, imagem de fundo e cor do texto', () => {
  const html = renderNode({ type: 'section', props: { corDeFundo: '#0B3D2E', corDoTexto: '#ffffff', imagemDeFundo: 'https://studio.exemplo/i/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e' }, children: [] });
  assert.match(html, /style="background-color:#0B3D2E;background-image:url\(&quot;https:\/\/studio\.exemplo\/i\/3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e&quot;\);background-size:cover;background-position:center;color:#ffffff"/);
});

// O estilo é CSS dentro de um atributo: cor fora do formato e endereço com aspas ou
// parênteses fechariam o url() e abririam CSS de quem digitou.
test('cor e imagem fora do formato não entram no estilo', () => {
  for (const props of [{ corDeFundo: 'red;position:fixed' }, { imagemDeFundo: 'https://x.test/a.png");background:url(javascript:1' }, { imagemDeFundo: 'javascript:alert(1)' }, { corDoTexto: 'expression(1)' }]) {
    assert.doesNotMatch(renderNode({ type: 'section', props, children: [] }), /style=/, JSON.stringify(props));
  }
});

test('vídeo do YouTube e do Vimeo vira o player embutido', () => {
  assert.equal(enderecoDoVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(enderecoDoVideo('https://youtu.be/dQw4w9WgXcQ?t=10'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(enderecoDoVideo('https://youtube.com/shorts/dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(enderecoDoVideo('https://vimeo.com/76979871'), 'https://player.vimeo.com/video/76979871');
  assert.equal(enderecoDoVideo('https://exemplo.test/video.mp4'), null);
  const html = renderNode({ type: 'video', props: { url: 'https://youtu.be/dQw4w9WgXcQ' }, children: [] });
  assert.match(html, /<div class="alva-embed-video"><iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ"/);
  // O YouTube recusa o player sem a origem de quem incorpora (erro 153), e o Studio serve
  // tudo com no-referrer: o iframe precisa pedir a sua própria política.
  assert.match(html, /referrerpolicy="strict-origin-when-cross-origin"/);
});

test('vídeo sem link válido mostra o aviso para colar o link, em vez de quebrar', () => {
  assert.match(renderNode({ type: 'video', props: { url: '' }, children: [] }), /data-alva-video-empty="true"/);
});
