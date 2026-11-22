// Relogio unico da API: o do banco. Os horarios gravados (ultimo contato, validade de sync/comando, recebimento)
// vem de clock_timestamp() no PostgreSQL; compara-los com o relogio do computador da API falha quando os dois
// divergem (ex.: banco no Railway com hora certa e notebook adiantado). Com PGlite o desvio e ~0.
import type { TransactionDatabase } from './database.js';

let offsetMs = 0;

/** Agora no relogio do banco (ms desde 1970), sem consulta: relogio local + desvio medido. */
export function dbNow() { return Date.now() + offsetMs; }
export function dbClockOffsetMs() { return offsetMs; }

/** Mede o desvio banco - computador (metade do tempo de ida e volta compensada). */
export async function syncDbClock(database: TransactionDatabase) {
  const sent = Date.now();
  const row = await database.transaction(db => db.query<{ now: Date | string }>('SELECT clock_timestamp() AS now'));
  const received = Date.now();
  const server = new Date(row.rows[0].now as any).getTime();
  if (Number.isFinite(server)) offsetMs = Math.round(server - (sent + received) / 2);
  return offsetMs;
}
