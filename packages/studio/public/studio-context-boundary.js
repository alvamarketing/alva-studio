// Trocar de empresa ou de projeto não pode deixar o editor aberto sobre o conteúdo de
// outro contexto: o que estava sendo escrito é salvo antes de a tela ser desmontada.
export function createStudioContextBoundary({ savePage, closePageEditor, clearPageList }) {
  return {
    async close() {
      await savePage();
      closePageEditor();
      clearPageList();
    },
  };
}
