import { Pool } from 'pg';

export function createDatabasePool(connectionString: string): Pool {
  return new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000, statement_timeout: 10000,
    options: '-c search_path=public -c timezone=UTC' });
}
