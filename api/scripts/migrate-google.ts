import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createDatabasePool } from '../src/database.js';
if(existsSync('.env')) process.loadEnvFile('.env');
if(!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL na sua base de desenvolvimento.');
const pool=createDatabasePool(process.env.DATABASE_URL);
pool.on('error',()=>process.stderr.write('Conexão PostgreSQL interrompida.\n'));
try {
  const client=await pool.connect();
  try {
    // O script contém sua própria transação. Não recria nem remove tabelas existentes.
    await client.query(await readFile(new URL('../../db/003_google_auth.sql',import.meta.url),'utf8'));
    console.log('Migração Google aplicada: identidades e solicitações pendentes.');
  } catch(error) { await client.query('ROLLBACK');throw error; } finally { client.release(); }
} catch(error) {
  const code=(error as {code?:string}).code;
  process.stderr.write(code==='42P07'?'As tabelas Google já existem; nenhuma alteração foi aplicada.\n':`Falha na migração (${code ?? 'conexão'}).\n`);
  process.exitCode=1;
} finally {await pool.end();}
