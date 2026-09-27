// Um navegador mínimo: o bastante para o carregador de pixels rodar, com as filas dos
// SDKs à vista. Os `<meta>` da página ficam em `metas`.
export function navegador({ metas = {}, estadoDoConsentimento, window = {} } = {}) {
  const atributos = new Map();
  const scripts = [];
  const botoes = [];
  const pagina = { estadoDoConsentimento };
  const document = {
    documentElement: { getAttribute: (nome) => atributos.get(nome) ?? null, setAttribute: (nome, valor) => atributos.set(nome, valor) },
    createElement: (tag) => {
      const ouvintes = new Map();
      const no = { tag, dataset: {}, append() {}, remove() {}, setAttribute() {}, addEventListener: (nome, ouvinte) => ouvintes.set(nome, ouvinte), clicar: () => ouvintes.get('click')?.() };
      if (tag === 'button') botoes.push(no);
      return no;
    },
    head: { appendChild: (no) => scripts.push(no) },
    body: { appendChild() {} },
    querySelectorAll: () => [],
    querySelector: (seletor) => {
      const nome = /^meta\[name="([^"]+)"\]$/.exec(seletor)?.[1];
      return nome && metas[nome] !== undefined ? { content: metas[nome], getAttribute: (atributo) => (atributo === 'content' ? metas[nome] : null) } : null;
    },
  };
  const fetch = async () => ({ ok: true, json: async () => ({ state: pagina.estadoDoConsentimento }) });
  return Object.assign(pagina, { window, document, fetch, scripts, botoes });
}

export async function rodarCarregador(fonte, pagina) {
  new Function('window', 'document', 'fetch', fonte)(pagina.window, pagina.document, pagina.fetch);
  for (let volta = 0; volta < 5; volta += 1) await new Promise((resolve) => setImmediate(resolve));
  return pagina;
}
