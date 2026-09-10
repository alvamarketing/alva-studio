// O runtime que transforma a página publicada em quiz.
//
// A página é a mesma landing: as seções, os elementos e o visual saem do editor de
// páginas. O que este script acrescenta é a regra de navegação — mostra uma etapa por
// vez, prende o botão de cada seção ao avanço e junta as respostas até o fim.
//
// Vai como texto para dentro do HTML publicado, então não pode depender de módulos nem
// de nada do Studio: o que está aqui é tudo o que ele terá.

export const quizRuntimeCss = `
[data-alva-quiz] [hidden] { display: none !important; }
[data-alva-quiz] .alva-quiz-progresso {
  position: sticky; top: 0; z-index: 9;
  height: 4px; background: rgb(16 24 40 / 8%);
}
[data-alva-quiz] .alva-quiz-progresso i {
  display: block; height: 100%; width: 0;
  background: var(--alva-quiz-cor, #286eea);
  transition: width .25s ease;
}
[data-alva-quiz] [data-alva-quiz-erro] {
  margin: 10px 0 0; color: #ba3535; font-size: 14px;
}
`;

export function quizRuntimeScript({ destino = '' } = {}) {
  // O snapshot publicado reescreve a action da captura para o gateway assinado. O runtime
  // usa essa action, sem transformar o webhook do editor em endpoint público.
  return `(()=>{
  const corpo = document.body;
  // Sem a marca, esta é uma landing comum e o runtime não encosta nela.
  if (!corpo || corpo.dataset.alvaQuiz !== 'true') return;
  const etapas = [...document.querySelectorAll('section')];
  if (etapas.length < 2) return;

  const destinoConfigurado = ${JSON.stringify(destino)};
  const respostas = {};
  const captura = document.querySelector('form[data-alva-capture-id]');
  // Uma tentativa conserva o mesmo identificador mesmo quando a rede falha depois de
  // receber a requisição; o gateway devolve a mesma captura sem duplicar a conversão.
  const trackingEventId = globalThis.crypto?.randomUUID?.() || '';
  let atual = 0;

  const barra = document.createElement('div');
  barra.className = 'alva-quiz-progresso';
  barra.innerHTML = '<i></i>';
  corpo.prepend(barra);

  const camposDa = (etapa) => [...etapa.querySelectorAll('input, select, textarea')];

  const faltaResposta = (etapa) => {
    const grupos = new Map();
    for (const campo of camposDa(etapa)) {
      if (!campo.required) continue;
      const chave = campo.name || campo.id || Math.random();
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(campo);
    }
    for (const grupo of grupos.values()) {
      const escolha = ['radio', 'checkbox'].includes(grupo[0].type);
      const ok = escolha ? grupo.some((c) => c.checked) : grupo.some((c) => String(c.value || '').trim() !== '');
      if (!ok) return grupo[0];
    }
    return null;
  };

  const guardar = (etapa) => {
    const nomes = new Set();
    const valores = {};
    for (const campo of camposDa(etapa)) {
      if (!campo.name) continue;
      nomes.add(campo.name);
      if (campo.type === 'checkbox') {
        if (campo.checked) (valores[campo.name] ||= []).push(campo.value);
      } else if (campo.type === 'radio') {
        if (campo.checked) valores[campo.name] = campo.value;
      } else {
        const valor = String(campo.value || '').trim();
        if (valor !== '') valores[campo.name] = valor;
      }
    }
    // Voltar e editar uma etapa substitui seu grupo inteiro; retries nunca acumulam
    // checkbox e um rádio desmarcado não deixa a resposta anterior escondida.
    nomes.forEach((nome) => delete respostas[nome]);
    Object.assign(respostas, valores);
  };

  const avisar = (etapa, campo, mensagem = 'Responda para continuar.') => {
    let aviso = etapa.querySelector('[data-alva-quiz-erro]');
    if (!aviso) {
      aviso = document.createElement('p');
      aviso.setAttribute('data-alva-quiz-erro', '');
      aviso.setAttribute('role', 'alert');
      etapa.append(aviso);
    }
    aviso.textContent = mensagem;
    campo?.focus?.();
  };

  const mostrar = (indice) => {
    atual = indice;
    etapas.forEach((etapa, i) => { etapa.hidden = i !== indice; });
    barra.firstElementChild.style.width = Math.round(((indice + 1) / etapas.length) * 100) + '%';
    // Quem avançou espera ver o começo da etapa nova, não o meio da página.
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const foco = etapas[indice].querySelector('h1, h2, [tabindex], input, select, textarea');
    if (foco && foco.focus) try { foco.focus({ preventScroll: true }); } catch {}
  };

  const enviar = async (etapa) => {
    const destino = destinoConfigurado || captura?.getAttribute('action') || '';
    if (!destino || destino === '#') {
      avisar(etapa, null, 'Este quiz ainda não tem uma captura publicada.');
      return false;
    }
    try {
      const resposta = await fetch(destino, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: respostas, ...(trackingEventId ? { trackingEventId } : {}) }),
      });
      if (!resposta.ok) throw new Error('Resposta inválida do servidor.');
      return true;
    } catch {
      avisar(etapa, null, 'Não foi possível enviar suas respostas. Tente novamente.');
      return false;
    }
  };

  const avancar = async (etapa) => {
    const pendente = faltaResposta(etapa);
    if (pendente) { avisar(etapa, pendente); return; }
    etapa.querySelector('[data-alva-quiz-erro]')?.remove();
    guardar(etapa);
    const proxima = atual + 1;
    if (proxima >= etapas.length) return;
    // A etapa final só aparece depois da captura confirmada. Em falha, a pessoa fica na
    // etapa atual e pode tentar novamente sem perder as respostas preenchidas.
    if (proxima === etapas.length - 1 && !await enviar(etapa)) return;
    mostrar(proxima);
  };

  // O quiz é montado no editor de páginas, com botões comuns. Por isso qualquer botão da
  // etapa avança; a marcação explícita continua valendo para quem quiser ser exato, e
  // links que levam para fora seguem levando.
  const avanca = (alvo) => {
    const marcado = alvo.closest('[data-alva-quiz-next]');
    if (marcado) return marcado;
    const botao = alvo.closest('button, a, [role="button"]');
    if (!botao) return null;
    if (botao.tagName === 'A') {
      const href = botao.getAttribute('href') || '';
      return href === '' || href.startsWith('#') ? botao : null;
    }
    return botao;
  };

  corpo.addEventListener('click', (evento) => {
    const botao = avanca(evento.target);
    if (!botao) return;
    const etapa = botao.closest('section');
    if (!etapa || etapa !== etapas[atual]) return;
    evento.preventDefault();
    avancar(etapa);
  });
  // Enter num campo do form raiz deve passar pela mesma validação e confirmação do botão.
  // Sem isso o navegador enviaria a action nativa antes de completar as etapas.
  captura?.addEventListener('submit', (evento) => {
    evento.preventDefault();
    avancar(etapas[atual]);
  });

  mostrar(0);
})();`;
}
