export function createContextList({ load, apply }) {
  let generation = 0;

  return {
    async refresh() {
      const request = ++generation;
      const items = await load();
      if (request !== generation) return false;
      apply(items);
      return true;
    },
    invalidate() {
      generation++;
    },
  };
}
