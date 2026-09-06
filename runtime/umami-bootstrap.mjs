import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const username = process.env.UMAMI_USERNAME;
if (!username || !/^[a-z0-9._-]+$/.test(username)) throw new Error('UMAMI_USERNAME inválido.');
if (!process.env.UMAMI_PASSWORD) throw new Error('UMAMI_PASSWORD é obrigatório.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória.');

const sql = `
\\getenv technical_username UMAMI_USERNAME
\\getenv technical_password UMAMI_PASSWORD
BEGIN;
INSERT INTO "user" ("user_id", "username", "password", "role", "display_name")
VALUES (gen_random_uuid(), :'technical_username', crypt(:'technical_password', gen_salt('bf')), 'user', 'Tracking Provisioner')
ON CONFLICT ("username") DO UPDATE
SET "password" = EXCLUDED."password", "role" = EXCLUDED."role", "display_name" = EXCLUDED."display_name", "deleted_at" = NULL, "updated_at" = CURRENT_TIMESTAMP;
DELETE FROM "user"
WHERE "username" = 'admin'
  AND "password" = '$2b$10$BUli0c.muyCW1ErNJc3jL.vFRFtFJWrT8/GcR4A.sUdCznaXiqFXa';
COMMIT;
`;

const database = new URL(process.env.DATABASE_URL);
const child = spawn('psql', ['-v', 'ON_ERROR_STOP=1'], {
  stdio: ['pipe', 'inherit', 'inherit'],
  env: {
    ...process.env,
    PGHOST: database.hostname,
    PGPORT: database.port || '5432',
    PGDATABASE: database.pathname.slice(1),
    PGUSER: decodeURIComponent(database.username),
    PGPASSWORD: decodeURIComponent(database.password),
  },
});
if (process.env.UMAMI_BOOTSTRAP_ASSERT_ARGV === 'true') {
  const argv = readFileSync(`/proc/${child.pid}/cmdline`, 'utf8');
  if (argv.includes(process.env.UMAMI_PASSWORD) || argv.includes(database.password)) throw new Error('Bootstrap técnico expôs segredo em argv.');
}
child.stdin.end(sql);
await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('Bootstrap técnico Umami falhou.')));
});
