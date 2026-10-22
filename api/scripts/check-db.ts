import { existsSync } from 'node:fs';
import { createDatabasePool } from '../src/database.js';
import { PostgresAuthStore } from '../src/auth/store.js';

if (existsSync('.env')) process.loadEnvFile('.env');
if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL em api/.env.');
const pool = createDatabasePool(process.env.DATABASE_URL);
pool.on('error', () => process.stderr.write('Conexão com PostgreSQL interrompida.\n'));
try {
  await new PostgresAuthStore(pool).initialize();
  const result = await pool.query(`SELECT current_database() AS banco,
    current_setting('server_version') AS versao, current_schema() AS schema,
    (SELECT count(*)::int FROM public.usuarios WHERE ativo) AS operadores_ativos,
    (SELECT count(*)::int FROM public.dispositivos) AS dispositivos,
    (SELECT count(*)::int FROM public.dispositivo_usuarios WHERE ativo) AS vinculos_ativos`);
  console.log(JSON.stringify(result.rows[0], null, 2));
} catch (error) {
  const failure = error as Error & { code?: string };
  process.stderr.write(failure.code ? `Falha na conferência PostgreSQL (${failure.code}).\n` : `${failure.message}\n`);
  process.exitCode = 1;
} finally { await pool.end(); }
