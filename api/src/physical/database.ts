import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { migrate } from '../persistence/migrations.js';
import type { Sql, TransactionDatabase } from '../persistence/database.js';
import { isPasswordHash } from '../auth/password.js';

export interface PhysicalIdentity { chipId: string; username: string; passwordHash: string }

export async function provisionPhysical(database: TransactionDatabase, identity: PhysicalIdentity) {
  if (!identity.chipId.trim() || /^(virtual|simulator):/i.test(identity.chipId) || identity.chipId.length > 200 ||
      !/^[a-zA-Z0-9_.-]{3,100}$/.test(identity.username) || !isPasswordHash(identity.passwordHash)) throw new Error('Identidade física ou credenciais inválidas.');
  return database.transaction(async sql => {
    await sql.query('LOCK TABLE usuarios, dispositivos IN SHARE ROW EXCLUSIVE MODE');
    const users = (await sql.query('SELECT id,usuario,senha_hash FROM usuarios WHERE ativo')).rows;
    if (users.length && (users.length !== 1 || users[0].usuario !== identity.username || users[0].senha_hash !== identity.passwordHash)) {
      throw new Error('O banco físico já possui outro operador ou outras credenciais. Preserve .env.physical e o banco; nenhuma senha foi alterada.');
    }
    const device = (await sql.query("SELECT id,chip_id,mqtt_habilitado FROM dispositivos WHERE identificador='bancada-01'")).rows[0];
    if (device && (device.chip_id !== identity.chipId || !device.mqtt_habilitado)) throw new Error('Este banco já pertence a outro chip ou está desabilitado. Não reutilize banco virtual nem zere os checkpoints.');
    const user = users[0] ?? (await sql.query("INSERT INTO usuarios(usuario,nome,senha_hash) VALUES ($1,'Operador da estufa',$2) RETURNING id", [identity.username, identity.passwordHash])).rows[0];
    const target = device ?? (await sql.query("INSERT INTO dispositivos(identificador,nome,chip_id,mqtt_habilitado) VALUES ('bancada-01','ESP físico da estufa',$1,true) RETURNING id", [identity.chipId])).rows[0];
    await sql.query('INSERT INTO dispositivo_usuarios(dispositivo_id,usuario_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [target.id, user.id]);
    const link = (await sql.query('SELECT ativo FROM dispositivo_usuarios WHERE dispositivo_id=$1 AND usuario_id=$2', [target.id, user.id])).rows[0];
    if (!link.ativo) throw new Error('Vínculo revogado. O provisionamento físico não reativa acessos.');
    return { createdOperator: users.length === 0 };
  });
}

export async function openPhysicalDatabase(identity: PhysicalIdentity, folder?: string) {
  const db = new PGlite(folder);
  const database: TransactionDatabase = { transaction: work => db.transaction(async tx => work({
    query: async <T extends Record<string, any>>(sql: string, values?: any[]) => {
      if (values) return tx.query<T>(sql, values);
      const results = await tx.exec(sql);
      return { rows: (results.at(-1)?.rows ?? []) as T[] };
    },
  } as Sql)) };
  try {
    const exists = (await db.query<{ name: string | null }>("SELECT to_regclass('public.usuarios')::text name")).rows[0].name;
    if (!exists) for (const file of ['001_schema.sql', '002_catalogo_alertas.sql']) await db.exec(await readFile(new URL(`../../../db/${file}`, import.meta.url), 'utf8'));
    await migrate(database, true);
    await provisionPhysical(database, identity);
    const queryProxy = { query: (sql: string, params?: any[]) => db.query(sql, params) } as unknown as Pick<Pool, 'query'>;
    return { db, database, queryProxy };
  } catch (error) { await db.close(); throw error; }
}
