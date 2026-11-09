import { createDatabasePool } from '../src/database.js';
import { postgresDatabase } from '../src/persistence/database.js';
import { migrate } from '../src/persistence/migrations.js';
import { provisionCompose } from '../src/lab/provision.js';

if (process.env.PIEVI_COMPOSE_SETUP !== '1' || process.env.NODE_ENV === 'production' || !process.env.DATABASE_URL) {
  throw new Error('Execute este provisionamento somente pelo Compose de desenvolvimento.');
}
const pool = createDatabasePool(process.env.DATABASE_URL);
pool.on('error', () => process.stderr.write('PostgreSQL indisponível.\n'));
try {
  const database = postgresDatabase(pool);
  await migrate(database, true);
  const result = await provisionCompose(database, process.env.OPERATOR_USERNAME ?? '', process.env.OPERATOR_PASSWORD_HASH ?? '');
  console.log(result.createdOperator ? 'Banco migrado e operador local provisionado.' : 'Banco conferido; operador e credenciais preservados.');
} catch (error) {
  const failure = error as Error & { code?: string };
  console.error(failure.code ? `Provisionamento não confirmado (${failure.code}).` : failure.message);
  process.exitCode = 1;
} finally { await pool.end(); }
