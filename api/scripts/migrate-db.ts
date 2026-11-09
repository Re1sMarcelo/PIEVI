import { existsSync } from 'node:fs';
import { createDatabasePool } from '../src/database.js';
import { postgresDatabase } from '../src/persistence/database.js';
import { migrate } from '../src/persistence/migrations.js';

if (existsSync('.env')) process.loadEnvFile('.env');
if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Use sem argumentos para planejar ou --apply para aplicar.');
if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL em api/.env.');
const pool = createDatabasePool(process.env.DATABASE_URL);
pool.on('error', () => process.stderr.write('Conexão PostgreSQL interrompida.\n'));
try {
  console.log(JSON.stringify(await migrate(postgresDatabase(pool), process.argv.includes('--apply')), null, 2));
} catch (error) {
  const failure = error as Error & { code?: string };
  process.stderr.write(failure.code ? `Migração não confirmada (${failure.code}).\n` : `${failure.message}\n`);
  process.exitCode = 1;
} finally { await pool.end(); }
