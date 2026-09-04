export async function flushChanges(isDirty, saveOnce) {
  do {
    await saveOnce();
  } while (isDirty());
}
