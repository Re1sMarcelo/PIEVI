import type { Pool } from 'pg';

export interface Sql {
  query<T extends Record<string, any> = Record<string, any>>(sql: string, values?: any[]): Promise<{ rows: T[] }>;
}
export interface TransactionDatabase { transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T> }
export function postgresDatabase(pool: Pool): TransactionDatabase {
  return { async transaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  } };
}
