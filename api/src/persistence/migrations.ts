import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { TransactionDatabase } from './database.js';
import { ALERT_CODES } from '../mqtt/schema.js';

export const migrationFiles = ['004_mqtt_persistence.sql'] as const;
export async function migrationSources() {
  return Promise.all(migrationFiles.map(async id => {
    const sql = await readFile(new URL(`../../../db/migrations/${id}`, import.meta.url), 'utf8');
    return { id, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}
export async function migrate(database: TransactionDatabase, apply = false) {
  const sources = await migrationSources();
  return database.transaction(async db => {
    // Transaction lock serializes concurrent migration runners in PostgreSQL.
    await db.query('SELECT pg_advisory_xact_lock(1769004)');
    await db.query(`SELECT d.identificador, d.chip_id, l.hora_confiavel, c.versao, a.id_externo
      FROM dispositivos d LEFT JOIN leituras l ON false LEFT JOIN config_historico c ON false LEFT JOIN alertas a ON false LIMIT 0`);
    const catalogue = await db.query<{ codigo: string }>('SELECT codigo FROM tipos_alerta');
    if (ALERT_CODES.some(code=>!catalogue.rows.some(row=>row.codigo===code))) throw new Error('Aplique o catálogo 002_catalogo_alertas.sql antes da migração incremental.');
    const journal = await db.query<{ name: string | null }>("SELECT to_regclass('public.schema_migrations')::text AS name");
    if (apply) await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY, checksum text NOT NULL, aplicada_em timestamptz NOT NULL DEFAULT clock_timestamp())`);
    const applied = journal.rows[0].name || apply ? (await db.query<{ id: string; checksum: string }>('SELECT id,checksum FROM schema_migrations')).rows : [];
    const result: { id: string; status: 'aplicada' | 'pendente' | 'ja_aplicada' }[] = [];
    for (const source of sources) {
      const existing = applied.find(m => m.id === source.id);
      if (existing && existing.checksum !== source.checksum) throw new Error(`Checksum divergente em ${source.id}. Crie outra migração; não altere a já aplicada.`);
      if (existing) { result.push({ id: source.id, status: 'ja_aplicada' }); continue; }
      if (apply) {
        await db.query(source.sql);
        await db.query('INSERT INTO schema_migrations(id,checksum) VALUES ($1,$2)', [source.id, source.checksum]);
      }
      result.push({ id: source.id, status: apply ? 'aplicada' : 'pendente' });
    }
    return result;
  });
}
