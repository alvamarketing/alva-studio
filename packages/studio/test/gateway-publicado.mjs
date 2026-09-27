// O gateway que roda na Vercel, executado como a Vercel o executa: o módulo publicado, com
// as regras de rewrite do `vercel.json` gerado na mesma publicação.
//
// Até 27/09 os testes de ponta a ponta usavam uma segunda cópia do gateway, escrita em
// Node, que se dizia "o mesmo gateway publicado". Não era: ela assinava a query junto com
// o caminho, e o módulo publicado não. Um teste que prova o caminho de produção roda o
// código de produção.
export async function gatewayPublicado({ artefato, env, fetchImpl, dominio }) {
  const fonte = artefato.files.find((arquivo) => /module\.exports=\{handler\}/.test(String(arquivo.data ?? ''))).data;
  const { rewrites } = JSON.parse(artefato.files.find((arquivo) => arquivo.file === 'vercel.json').data);
  const modulo = { exports: {} };
  const crypto = await import('node:crypto');
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', 'process', 'fetch', 'Buffer', 'URL', fonte)(
    (nome) => { if (nome === 'node:crypto') return crypto; throw new Error(`require inesperado: ${nome}`); },
    modulo, modulo.exports, { env }, fetchImpl, Buffer, URL,
  );
  const reescrever = (endereco) => {
    const url = new URL(endereco, `https://${dominio}`);
    for (const { source, destination } of rewrites) {
      const prefixo = source.replace(/:path\*$/, '');
      if (source.endsWith(':path*') && url.pathname.startsWith(prefixo)) return destination.replace(/:path\*$/, '') + url.pathname.slice(prefixo.length) + url.search;
    }
    return endereco;
  };
  return async ({ method = 'GET', path, headers = {}, body }) => {
    const pedido = { url: reescrever(path), method, headers: { host: dominio, ...headers }, async *[Symbol.asyncIterator]() { if (body?.length) yield body; } };
    const resposta = { statusCode: 200, headers: {}, corpo: '', setHeader(nome, valor) { this.headers[nome.toLowerCase()] = valor; }, end(dados) { this.corpo = dados ?? ''; } };
    await modulo.exports.handler(pedido, resposta);
    const corpo = Buffer.isBuffer(resposta.corpo) ? resposta.corpo : Buffer.from(String(resposta.corpo));
    return { status: resposta.statusCode, headers: resposta.headers, body: corpo, text: corpo.toString() };
  };
}
