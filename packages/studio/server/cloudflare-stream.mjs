// Hospedagem de vídeo na conta Cloudflare de quem usa o Studio.
//
// O arquivo vai do navegador direto para a Cloudflare: o Studio só pede o endereço de
// envio e depois pergunta se já ficou pronto. Nosso servidor nunca toca no vídeo — sem
// limite de upload, sem disco e sem fila de conversão para manter.

const BASE = 'https://api.cloudflare.com/client/v4';

function fail(message, status = 502) {
  return Object.assign(new Error(message), { status, statusCode: status });
}

export class CloudflareStream {
  constructor({ accountId = '', apiToken = '', fetcher = fetch, timeoutMs = 20_000 } = {}) {
    this.accountId = accountId;
    this.apiToken = apiToken;
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
  }

  get configurado() {
    return Boolean(this.accountId && this.apiToken);
  }

  async request(caminho, corpo) {
    // Recusar aqui evita uma chamada que falharia lá com uma mensagem que não ajuda.
    if (!this.configurado)
      throw fail('Configure a conta Cloudflare no servidor para hospedar vídeos.', 409);
    let resposta;
    try {
      resposta = await this.fetcher(`${BASE}/accounts/${encodeURIComponent(this.accountId)}/stream${caminho}`, {
        method: corpo ? 'POST' : 'GET',
        // O token vai no cabeçalho: em URL ele vaza no log do servidor e no histórico.
        headers: { Authorization: `Bearer ${this.apiToken}`, 'Content-Type': 'application/json' },
        ...(corpo ? { body: JSON.stringify(corpo) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw fail('Não foi possível falar com a Cloudflare. Tente novamente.');
    }
    let dados = null;
    try {
      dados = await resposta.json();
    } catch {
      throw fail('A Cloudflare devolveu uma resposta inválida.');
    }
    if (!resposta.ok || dados?.success === false) {
      const motivo = dados?.errors?.[0]?.message || `erro ${resposta.status}`;
      throw fail(`A Cloudflare recusou a solicitação: ${motivo}`);
    }
    return dados.result || {};
  }

  // Endereço de uso único para o navegador enviar o arquivo.
  async criarEnvioDireto({ duracaoMaximaSegundos = 7200, nome = '' } = {}) {
    const result = await this.request('/direct_upload', {
      maxDurationSeconds: duracaoMaximaSegundos,
      ...(nome ? { meta: { name: nome } } : {}),
    });
    return { uploadUrl: result.uploadURL || '', uid: result.uid || '' };
  }

  async consultar(uid) {
    const result = await this.request(`/${encodeURIComponent(uid)}`);
    const estado = result.status?.state || '';
    return {
      uid: result.uid || uid,
      pronto: result.readyToStream === true,
      estado,
      // Conversão que falhou precisa ser dita: tratar como "ainda processando" deixa a
      // pessoa esperando por algo que nunca vai ficar pronto.
      falhou: estado === 'error',
      motivo: result.status?.errorReasonText || '',
      hlsUrl: result.playback?.hls || '',
      miniaturaUrl: result.thumbnail || '',
      duracaoSegundos: Number.isFinite(result.duration) && result.duration > 0 ? Math.round(result.duration) : 0,
    };
  }

  // Onde o vídeo pode tocar. Sem isto, quem copiar o endereço mostra o vídeo no site dele.
  async restringirOrigens(uid, origens = []) {
    return this.request(`/${encodeURIComponent(uid)}`, { allowedOrigins: origens });
  }
}
