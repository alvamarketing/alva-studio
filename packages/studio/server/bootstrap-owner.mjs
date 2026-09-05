import { pathToFileURL } from 'node:url';

import { createDatabase, migrate } from './db/postgres.mjs';
import { SessionService } from './session-service.mjs';

export async function bootstrapOwner({
  connectionString,
  name,
  email,
  password,
  companyName,
  companySlug,
  createDatabaseFn = createDatabase,
  migrateFn = migrate,
} = {}) {
  if (typeof connectionString !== 'string' || !connectionString.trim())
    throw new Error('Informe a conexão PostgreSQL para criar a primeira conta.');
  let database;
  try {
    database = createDatabaseFn({ connectionString });
    await migrateFn(database);
    const sessions = new SessionService(database);
    if (await sessions.setupRequired()) {
      const context = await sessions.setup({ name, email, password, companyName, companySlug });
      const company = await database.query('SELECT slug FROM companies WHERE id = $1', [context.companyId]);
      return { created: true, email: context.user.email, companySlug: company.rows[0].slug };
    }
    return { created: false };
  } catch (error) {
    if ((error?.status ?? error?.statusCode) === 409) return { created: false };
    throw error;
  } finally {
    await database?.close?.().catch(() => {});
  }
}

async function readStdin(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const password = await readStdin(process.stdin);
    const result = await bootstrapOwner({
      connectionString: process.env.DATABASE_URL,
      name: process.env.OWNER_NAME,
      email: process.env.OWNER_EMAIL,
      password,
      companyName: process.env.OWNER_COMPANY_NAME,
      companySlug: process.env.OWNER_COMPANY_SLUG,
    });
    console.log(
      result.created
        ? `Conta inicial criada: ${result.email} (${result.companySlug}).`
        : 'Conta inicial já existia; nenhuma alteração feita.',
    );
  } catch {
    console.error('Não foi possível criar a conta inicial.');
    process.exitCode = 1;
  }
}
