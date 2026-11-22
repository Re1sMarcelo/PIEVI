import { Pool } from 'pg';

/**
 * TLS do PostgreSQL:
 *  - rede interna do Railway (*.railway.internal) e localhost: sem TLS;
 *  - proxy publico do Railway (*.proxy.rlwy.net) ou sslmode=require: TLS sem conferir a cadeia (certificado proprio do Railway);
 *  - sslmode=verify-full: TLS conferindo a cadeia.
 */
export function databaseSsl(connectionString: string) {
  let url: URL;
  try { url = new URL(connectionString); } catch { return undefined; }
  const mode = url.searchParams.get('sslmode');
  if (mode === 'disable') return undefined;
  if (mode === 'verify-full' || mode === 'verify-ca') return { rejectUnauthorized: true };
  if (mode === 'require' || /\.proxy\.rlwy\.net$|\.railway\.app$/.test(url.hostname)) return { rejectUnauthorized: false };
  return undefined;
}

export function createDatabasePool(connectionString: string): Pool {
  // sslmode e tratado por databaseSsl; tira da URL para o pg nao sobrepor a regra.
  const url = (() => { try { const u = new URL(connectionString); u.searchParams.delete('sslmode'); return u.toString(); } catch { return connectionString; } })();
  return new Pool({ connectionString: url, ssl: databaseSsl(connectionString), max: 5, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000, statement_timeout: 10000,
    options: '-c search_path=public -c timezone=UTC' });
}
