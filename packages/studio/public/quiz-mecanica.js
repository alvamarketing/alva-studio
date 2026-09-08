// A mecânica do quiz, sem DOM e sem editor.
//
// O quiz não é um produto separado: é a mesma landing page com uma regra por cima. Cada
// seção vira uma etapa, só uma aparece por vez, e o botão da seção leva à próxima até o
// encerramento. Por isso esta camada não sabe nada de GrapesJS, de canvas nem de HTML —
// ela decide o que está na tela, e o mesmo raciocínio vale no editor e na página no ar.

export function etapasDoQuiz(secoes = []) {
  const lista = Array.isArray(secoes) ? secoes : [];
  return lista.map((secao, indice) => ({
    ...secao,
    indice,
    primeira: indice === 0,
    ultima: indice === lista.length - 1,
  }));
}

export function proximaEtapa(indiceAtual, total) {
  const proxima = Number(indiceAtual) + 1;
  // Depois da última vem o encerramento, não outra etapa: devolver o índice seguinte
  // aqui faria a página tentar mostrar uma seção que não existe.
  return proxima < Number(total) ? proxima : null;
}

const marcavel = (campo) => ['radio', 'checkbox'].includes(campo?.type);

export function faltamRespostas(campos = []) {
  const obrigatorios = (campos || []).filter((campo) => campo?.required);
  const porNome = new Map();
  for (const campo of obrigatorios) {
    if (!porNome.has(campo.name)) porNome.set(campo.name, []);
    porNome.get(campo.name).push(campo);
  }
  for (const grupo of porNome.values()) {
    // Numa escolha, o obrigatório é ter uma marcada — não é cada opção estar preenchida.
    const respondido = marcavel(grupo[0])
      ? grupo.some((campo) => campo.checked)
      : grupo.some((campo) => String(campo.value ?? '').trim() !== '');
    if (!respondido) return true;
  }
  return false;
}

export function respostasDaEtapa(campos = []) {
  const respostas = {};
  for (const campo of campos || []) {
    if (!campo?.name) continue;
    if (campo.type === 'checkbox') {
      if (!campo.checked) continue;
      respostas[campo.name] = [...(respostas[campo.name] || []), campo.value];
      continue;
    }
    if (campo.type === 'radio') {
      if (campo.checked) respostas[campo.name] = campo.value;
      continue;
    }
    const valor = String(campo.value ?? '').trim();
    if (valor !== '') respostas[campo.name] = valor;
  }
  return respostas;
}

// Aviso de autoria: uma seção sem botão trava o quiz ali, e quem monta só descobriria
// isso testando a página publicada.
export function secoesSemAvanco(secoes = [], { ultimaEncerra = false } = {}) {
  const lista = Array.isArray(secoes) ? secoes : [];
  return lista
    .filter((secao, indice) => {
      const ehUltima = indice === lista.length - 1;
      if (ehUltima && ultimaEncerra) return false;
      return !secao?.botao;
    })
    .map((secao) => secao.id);
}
