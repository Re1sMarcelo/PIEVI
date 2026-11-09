import type { TransactionDatabase } from '../persistence/database.js';
import { isPasswordHash } from '../auth/password.js';

// Only for a separate development database, never for replacing a live operator.
export async function provisionCompose(database: TransactionDatabase, username: string, passwordHash: string) {
  if (!/^[a-zA-Z0-9_.-]{3,100}$/.test(username) || !isPasswordHash(passwordHash)) {
    throw new Error('Usuário ou hash do operador inválido. Execute setup:compose.');
  }
  return database.transaction(async sql => {
    await sql.query('LOCK TABLE usuarios, dispositivos IN SHARE ROW EXCLUSIVE MODE');
    const users = (await sql.query('SELECT id,usuario FROM usuarios WHERE ativo')).rows;
    if (users.length && (users.length !== 1 || users[0].usuario !== username)) {
      throw new Error('O banco já contém outro operador ativo. Nenhuma credencial foi alterada.');
    }
    const device = (await sql.query("SELECT id,chip_id,mqtt_habilitado FROM dispositivos WHERE identificador='bancada-01'")).rows[0];
    if (device && (device.chip_id !== 'virtual:bancada-01' || !device.mqtt_habilitado)) {
      throw new Error('A bancada existente não pertence ao ambiente MQTT virtual.');
    }
    const user = users[0] ?? (await sql.query(
      "INSERT INTO usuarios(usuario,nome,senha_hash) VALUES ($1,'Operador local',$2) RETURNING id", [username, passwordHash],
    )).rows[0];
    const target = device ?? (await sql.query(`INSERT INTO dispositivos(identificador,nome,chip_id,mqtt_habilitado)
      VALUES ('bancada-01','ESP virtual via MQTT','virtual:bancada-01',true) RETURNING id`)).rows[0];
    await sql.query('INSERT INTO dispositivo_usuarios(dispositivo_id,usuario_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [target.id, user.id]);
    const link = (await sql.query('SELECT ativo FROM dispositivo_usuarios WHERE dispositivo_id=$1 AND usuario_id=$2', [target.id, user.id])).rows[0];
    if (!link.ativo) throw new Error('Vínculo revogado. O provisionamento não reativa acessos.');
    return { createdOperator: users.length === 0 };
  });
}
