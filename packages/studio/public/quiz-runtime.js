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
  // O destino sai daqui como texto: quem publica decide para onde as respostas vão.
  return `(()=>{
  const corpo = document.body;
  // Sem a marca, esta é uma landing comum e o runtime não encosta nela.
  if (!corpo || corpo.dataset.alvaQuiz !== 'true') return;
  const etapas = [...document.querySelectorAll('section')];
  if (etapas.length < 2) return;

  const destino = ${JSON.stringify(destino)};
  const respostas = {};
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
    for (const campo of camposDa(etapa)) {
      if (!campo.name) continue;
      if (campo.type === 'checkbox') {
        if (!campo.checked) continue;
        respostas[campo.name] = [...(respostas[campo.name] || []), campo.value];
      } else if (campo.type === 'radio') {
        if (campo.checked) respostas[campo.name] = campo.value;
      } else {
        const valor = String(campo.value || '').trim();
        if (valor !== '') respostas[campo.name] = valor;
      }
    }
  };

  const avisar = (etapa, campo) => {
    let aviso = etapa.querySelector('[data-alva-quiz-erro]');
    if (!aviso) {
      aviso = document.createElement('p');
      aviso.setAttribute('data-alva-quiz-erro', '');
      aviso.setAttribute('role', 'alert');
      (campo?.closest('label') || etapa).after(aviso);
    }
    aviso.textContent = 'Responda para continuar.';
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

  const enviar = async () => {
    if (!destino) return;
    try {
      await fetch(destino, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: respostas }),
      });
    } catch {
      // A pessoa já chegou ao fim: não vale segurar a tela por causa do envio.
    }
  };

  const avancar = async (etapa) => {
    const pendente = faltaResposta(etapa);
    if (pendente) { avisar(etapa, pendente); return; }
    etapa.querySelector('[data-alva-quiz-erro]')?.remove();
    guardar(etapa);
    const proxima = atual + 1;
    if (proxima >= etapas.length) return;
    mostrar(proxima);
    // O envio acontece ao chegar na última etapa, que é a de encerramento.
    if (proxima === etapas.length - 1) await enviar();
  };

  corpo.addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-alva-quiz-next]');
    if (!botao) return;
    const etapa = botao.closest('section');
    if (!etapa || etapa !== etapas[atual]) return;
    evento.preventDefault();
    avancar(etapa);
  });

  mostrar(0);
})();`;
}
