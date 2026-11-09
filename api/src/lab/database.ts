import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { migrate } from '../persistence/migrations.js';
import type { Sql, TransactionDatabase } from '../persistence/database.js';
import { hashPassword } from '../auth/password.js';

export async function openLabDatabase(folder?:string) {
  const db=new PGlite(folder);
  const database:TransactionDatabase={transaction:work=>db.transaction(async tx=>work({query:async<T extends Record<string,any>>(sql:string,values?:any[])=>{
    if(values)return tx.query<T>(sql,values);const result=await tx.exec(sql);return{rows:(result.at(-1)?.rows ?? []) as T[]};
  }} as Sql))};
  try {
    const exists=(await db.query<{name:string|null}>("SELECT to_regclass('public.usuarios')::text name")).rows[0].name;
    if(!exists)for(const file of ['001_schema.sql','002_catalogo_alertas.sql'])await db.exec(await readFile(new URL(`../../../db/${file}`,import.meta.url),'utf8'));
    await migrate(database,true);
    const username='operador';const password='estufa-local-123';
    await database.transaction(async sql=>{
      const users=(await sql.query('SELECT id,usuario FROM usuarios WHERE ativo')).rows;
      if(users.length && (users.length!==1 || users[0].usuario!==username))throw new Error('O banco do laboratório contém outro operador. Use uma pasta de laboratório separada.');
      const user=users[0] ?? (await sql.query(`INSERT INTO usuarios(usuario,nome,senha_hash) VALUES ($1,'Operador do laboratório',$2) RETURNING id`,[username,await hashPassword(password)])).rows[0];
      await sql.query(`INSERT INTO dispositivos(identificador,nome,chip_id,mqtt_habilitado) VALUES ('bancada-01','ESP virtual via MQTT','virtual:bancada-01',true) ON CONFLICT(identificador) DO NOTHING`);
      const device=(await sql.query("SELECT id,chip_id FROM dispositivos WHERE identificador='bancada-01'")).rows[0];
      if(device.chip_id!=='virtual:bancada-01')throw new Error('Este banco não pertence ao laboratório virtual.');
      await sql.query('INSERT INTO dispositivo_usuarios(dispositivo_id,usuario_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',[device.id,user.id]);
    });
    const queryProxy={query:(sql:string,params?:any[])=>db.query(sql,params)} as unknown as Pick<Pool,'query'>;
    return{db,database,queryProxy,credentials:{username,password}};
  }catch(error){await db.close();throw error;}
}
