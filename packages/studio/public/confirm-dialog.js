// Confirmação de ação no padrão da plataforma.
//
// O confirm() do navegador não serve: em contexto embutido, com bloqueio de diálogos
// ou em automação, ele devolve false sem mostrar nada. A ação some sem diálogo, sem
// erro e sem aviso — foi o que aconteceu com Excluir página, Publicar na Vercel e as
// outras seis ações que dependiam dele.

export function createConfirmDialog({ dialog, titulo, descricao, confirmar, cancelar } = {}) {
  let resolver = null;

  const encerrar = (resposta) => {
    const pendente = resolver;
    resolver = null;
    if (dialog.open) dialog.close(resposta ? 'confirmado' : 'cancelado');
    pendente?.(resposta);
  };

  // Esc e clique fora fecham o diálogo por fora dos botões: sem isto a promessa
  // ficaria pendurada e a interface travada esperando uma resposta que não vem.
  dialog.addEventListener('close', () => encerrar(false));
  dialog.addEventListener('cancel', () => encerrar(false));
  confirmar.onclick = () => encerrar(true);
  cancelar.onclick = () => encerrar(false);

  return function perguntar({ titulo: texto, descricao: detalhe = '', confirmar: verbo = 'Confirmar', cancelar: recusa = 'Cancelar', perigo = false } = {}) {
    encerrar(false);
    titulo.textContent = texto;
    descricao.textContent = detalhe;
    descricao.hidden = !detalhe;
    confirmar.textContent = verbo;
    cancelar.textContent = recusa;
    confirmar.className = perigo ? 'primary perigo' : 'primary';
    dialog.showModal();
    // O foco começa em cancelar: quem chega no diálogo por engano sai apertando Enter.
    cancelar.focus();
    return new Promise((resolve) => { resolver = resolve; });
  };
}

// Instância única ligada ao markup do index.html, para os três arquivos do Studio
// usarem sem cada um montar o seu. Criada na primeira pergunta: no carregamento do
// módulo o dialog ainda pode não existir.
let perguntar = null;

export function confirmarAcao(opcoes) {
  if (!perguntar) {
    const dialog = document.querySelector('#confirm-dialog');
    if (!dialog) return Promise.resolve(false);
    perguntar = createConfirmDialog({
      dialog,
      titulo: dialog.querySelector('#confirm-dialog-title'),
      descricao: dialog.querySelector('#confirm-dialog-description'),
      confirmar: dialog.querySelector('#confirm-dialog-accept'),
      cancelar: dialog.querySelector('#confirm-dialog-cancel'),
    });
  }
  return perguntar(opcoes);
}
