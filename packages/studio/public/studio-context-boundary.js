export function createStudioContextBoundary({
  savePage,
  closePageEditor,
  clearPageList,
  closeFormEditor,
  resetForms,
}) {
  return {
    async close() {
      await savePage();
      closePageEditor();
      clearPageList();
      await closeFormEditor();
      resetForms();
    },
  };
}
