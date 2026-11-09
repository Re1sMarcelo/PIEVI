import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openLabDatabase } from '../src/lab/database.js';
import { provisionCompose } from '../src/lab/provision.js';
import { hashPassword } from '../src/auth/password.js';

test('provisionamento repetido preserva senha e recusa outro operador, chip ou vínculo revogado', async () => {
  const data = await openLabDatabase();
  try {
    const original = (await data.db.query('SELECT senha_hash FROM usuarios')).rows[0];
    const replacement = await hashPassword('outra-senha-local-123');
    assert.deepEqual(await provisionCompose(data.database, 'operador', replacement), { createdOperator: false });
    assert.deepEqual((await data.db.query('SELECT senha_hash FROM usuarios')).rows[0], original);
    await assert.rejects(provisionCompose(data.database, 'outro-operador', replacement), /outro operador/);
    await data.db.query("UPDATE dispositivos SET chip_id='hardware-fisico'");
    await assert.rejects(provisionCompose(data.database, 'operador', replacement), /não pertence/);
    await data.db.query("UPDATE dispositivos SET chip_id='virtual:bancada-01'");
    await data.db.query('UPDATE dispositivo_usuarios SET ativo=false');
    await assert.rejects(provisionCompose(data.database, 'operador', replacement), /Vínculo revogado/);
    assert.equal((await data.db.query<{ativo:boolean}>('SELECT ativo FROM dispositivo_usuarios')).rows[0].ativo, false);
  } finally { await data.db.close(); }
});

test('instalação nova cria operador e vínculo uma vez, e falha reverte provisionamento', async () => {
  const data = await openLabDatabase();
  try {
    await data.db.exec('TRUNCATE usuarios,dispositivos CASCADE');
    const hash = await hashPassword('nova-instalacao-local-123');
    await data.db.query("INSERT INTO dispositivos(identificador,nome,chip_id) VALUES ('bancada-01','Físico','hardware-fisico')");
    await assert.rejects(provisionCompose(data.database, 'operador', hash), /não pertence/);
    assert.equal((await data.db.query<{total:number}>('SELECT count(*)::int total FROM usuarios')).rows[0].total, 0);
    await data.db.query('DELETE FROM dispositivos');
    assert.deepEqual(await provisionCompose(data.database, 'operador', hash), { createdOperator: true });
    assert.deepEqual(await provisionCompose(data.database, 'operador', hash), { createdOperator: false });
    assert.equal((await data.db.query<{total:number}>('SELECT count(*)::int total FROM dispositivo_usuarios WHERE ativo')).rows[0].total, 1);
  } finally { await data.db.close(); }
});
