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

// A lista de Quizzes é a lista de Páginas com outro filtro. Quem foi criada antes da marca
// existir é página: sem esse padrão, o Studio esconderia o trabalho antigo de todo mundo.
export function conteudoDaLista(paginas = [], tipo = 'page') {
  return (Array.isArray(paginas) ? paginas : []).filter((pagina) => (pagina?.kind || 'page') === tipo);
}

const TEXTOS = {
  page: {
    eyebrow: 'BIBLIOTECA VISUAL',
    titulo: 'Landing pages',
    descricao: 'Monte, edite e publique. Um espaço para cada campanha.',
    botao: '＋ Nova landing page',
    busca: 'Buscar uma página…',
    singular: 'página',
    plural: 'páginas',
    contexto: 'Landing',
    voltar: 'Minhas páginas',
    nomeDoConteudo: 'Nome da página',
    comecar: 'UMA NOVA CAMPANHA',
    criar: 'Criar página',
    rodape: 'Feito para tirar suas campanhas do papel.',
    vazio: 'Sua próxima campanha começa aqui.',
    ajudaVazio: 'Escolha um modelo, dê a sua cara e prepare a publicação.<br>A primeira landing page está a um clique.',
    naoEncontrado: 'Nenhuma página encontrada.',
  },
  quiz: {
    eyebrow: 'PERGUNTAS EM ETAPAS',
    titulo: 'Quizzes',
    descricao: 'Cada seção é uma etapa. O botão da seção leva à seguinte, até o encerramento.',
    botao: '＋ Novo quiz',
    busca: 'Buscar um quiz…',
    singular: 'quiz',
    plural: 'quizzes',
    contexto: 'Quiz',
    voltar: 'Meus quizzes',
    nomeDoConteudo: 'Nome do quiz',
    comecar: 'UM NOVO QUIZ',
    criar: 'Criar quiz',
    rodape: 'Uma pergunta por vez é o que mantém alguém respondendo até o fim.',
    vazio: 'Seu primeiro quiz começa aqui.',
    ajudaVazio: 'Um quiz é uma página em etapas: cada seção é uma pergunta e o botão leva à seguinte.<br>Monte no mesmo editor das páginas.',
    naoEncontrado: 'Nenhum quiz encontrado.',
  },
};

export function textosDaLista(tipo = 'page') {
  return TEXTOS[tipo] || TEXTOS.page;
}

export function contagemDaLista(quantidade, tipo = 'page') {
  const textos = textosDaLista(tipo);
  return `${quantidade} ${quantidade === 1 ? textos.singular : textos.plural}`;
}
