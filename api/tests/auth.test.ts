import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { PostgresAuthStore, tokenHash } from '../src/auth/store.js';
import { hashPassword } from '../src/auth/password.js';

const password = 'Senha própria para testar!';
let db: PGlite;
let available = true;
let beforeSession: (() => Promise<void>) | undefined;
let app: FastifyInstance;
let operatorId: string;
let deviceId: string;
const executor = { query: async (sql: string, values?: unknown[]) => {
  if (!available) throw new Error('Falha de conexão simulada');
  if (beforeSession && sql.startsWith('WITH usuario_validado')) {
    const action = beforeSession; beforeSession = undefined; await action();
  }
  return db.query(sql, values);
} } as unknown as Pick<Pool, 'query'>;
const newApp = () => createApp({ authStore: new PostgresAuthStore(executor), logger: false });

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('../../db/001_schema.sql', import.meta.url), 'utf8'));
});
beforeEach(async () => {
  available = true;
  beforeSession = undefined;
  await db.exec('BEGIN');
  operatorId = (await db.query<{id: string}>(`INSERT INTO usuarios(usuario,nome,senha_hash) VALUES ('operador','Operador da bancada',$1) RETURNING id`, [await hashPassword(password)])).rows[0].id;
  deviceId = (await db.query<{id: string}>(`INSERT INTO dispositivos(identificador,nome,chip_id) VALUES ('bancada-01','Bancada simulada','simulator:bancada-01') RETURNING id`)).rows[0].id;
  await db.query('INSERT INTO dispositivo_usuarios(dispositivo_id,usuario_id) VALUES ($1,$2)', [deviceId, operatorId]);
  app = newApp();
  await app.ready();
});
afterEach(async () => { available = true; await app.close(); await db.exec('ROLLBACK'); });
after(async () => { await db.close(); });

async function login(username = 'operador', suppliedPassword = password) {
  return app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username, password: suppliedPassword } });
}
async function bearer() {
  const response = await login(); assert.equal(response.statusCode, 200);
  return { authorization: `Bearer ${response.json().token}` };
}

test('login normaliza usuário, grava só hash do token e usa expiração de oito horas', async () => {
  const response = await login('  OPERADOR  ');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const session = response.json();
  assert.deepEqual(Object.keys(session).sort(), ['expiresAt','token','username']);
  assert.equal(session.username, 'operador');
  assert.match(session.token, /^[0-9a-f]{64}$/);
  const saved = (await db.query<{token_hash:string; seconds:number}>(`SELECT token_hash, extract(epoch from expira_em-criado_em)::int AS seconds FROM sessoes`)).rows[0];
  assert.equal(saved.token_hash, tokenHash(session.token));
  assert.notEqual(saved.token_hash, session.token);
  assert.equal(saved.seconds, 28800);
});

test('senha errada, usuário ausente ou injeção SQL não criam sessão', async () => {
  for (const [username, secret] of [['operador','errada'],['ausente',password],["' OR true --",password]]) {
    const response = await login(username, secret);
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: 'Credenciais inválidas.' });
  }
  assert.equal((await db.query<{count:number}>('SELECT count(*)::int AS count FROM sessoes')).rows[0].count, 0);
});

test('entrada inválida é recusada antes de autenticar', async () => {
  for (const payload of [{}, {username: {},password}, {username:'x'.repeat(255),password}, {username:'operador',password:''}, {username:'operador',password:'x'.repeat(1025)}]) {
    assert.equal((await app.inject({method:'POST',url:'/v1/auth/login',payload})).statusCode,400);
  }
});

test('e-mail e usuário autenticam a mesma conta, sem diferenciar maiúsculas ou espaços externos', async () => {
  await db.query('UPDATE usuarios SET email=$1 WHERE id=$2',['operador@example.com',operatorId]);
  const byEmail = await login('  OPERADOR@EXAMPLE.COM  ');
  const byUsername = await login('operador');
  assert.equal(byEmail.statusCode,200); assert.equal(byUsername.statusCode,200);
  assert.equal(byEmail.json().username,'operador');
  assert.notEqual(byEmail.json().token,byUsername.json().token);
  const owners = (await db.query<{usuario_id:string}>('SELECT DISTINCT usuario_id FROM sessoes')).rows;
  assert.deepEqual(owners,[{usuario_id:operatorId}]);
  const headers={authorization:`Bearer ${byEmail.json().token}`};
  assert.equal((await app.inject({url:'/v1/devices/bancada-01/snapshot',headers})).statusCode,200);
});

test('e-mail desconhecido, senha incorreta ou conta desativada usam o mesmo erro', async () => {
  await db.query('UPDATE usuarios SET email=$1 WHERE id=$2',['operador@example.com',operatorId]);
  for(const [identifier,secret] of [['operador@example.com','senha incorreta'],['ausente@example.com',password]]) {
    const response=await login(identifier,secret);
    assert.equal(response.statusCode,401);
    assert.deepEqual(response.json(),{error:'Credenciais inválidas.'});
  }
  await db.query('UPDATE usuarios SET ativo=false WHERE id=$1',[operatorId]);
  const response=await login('operador@example.com');
  assert.equal(response.statusCode,401);
  assert.deepEqual(response.json(),{error:'Credenciais inválidas.'});
  assert.equal((await db.query<{count:number}>('SELECT count(*)::int AS count FROM sessoes')).rows[0].count,0);
});

test('e-mail com mais de 100 caracteres cabe no limite de 254 do identificador', async () => {
  const email=`${'a'.repeat(60)}@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.com`;
  assert.ok(email.length>100 && email.length<=254);
  await db.query('UPDATE usuarios SET email=$1 WHERE id=$2',[email,operatorId]);
  assert.equal((await login(email)).statusCode,200);
});

test('identificador que corresponde a duas contas é recusado', async () => {
  await db.query('UPDATE usuarios SET email=$1 WHERE id=$2',['operador@example.com',operatorId]);
  // Simula inconsistência inserida fora do provisionamento controlado.
  await db.query(`INSERT INTO usuarios(usuario,nome,senha_hash) VALUES ($1,'Outra conta',$2)`,
    ['operador@example.com',await hashPassword('Outra senha para a conta!')]);
  assert.equal((await login('operador@example.com')).statusCode,401);
  assert.equal((await db.query<{count:number}>('SELECT count(*)::int AS count FROM sessoes')).rows[0].count,0);
});

test('e-mail alterado durante o login é revalidado antes de criar sessão', async () => {
  await db.query('UPDATE usuarios SET email=$1 WHERE id=$2',['antigo@example.com',operatorId]);
  beforeSession=async()=>{await db.query('UPDATE usuarios SET email=$1 WHERE id=$2',['novo@example.com',operatorId]);};
  assert.equal((await login('antigo@example.com')).statusCode,401);
  assert.equal((await db.query<{count:number}>('SELECT count(*)::int AS count FROM sessoes')).rows[0].count,0);
  assert.equal((await login('novo@example.com')).statusCode,200);
});

test('usuário com formato de e-mail continua sendo um identificador válido', async () => {
  await db.query('UPDATE usuarios SET usuario=$1,email=$2 WHERE id=$3',['usuario@example.com','contato@example.com',operatorId]);
  for(const identifier of ['usuario@example.com','contato@example.com']) {
    const response=await login(identifier);
    assert.equal(response.statusCode,200);
    assert.equal(response.json().username,'usuario@example.com');
  }
});

test('sessão continua válida após recriar a API', async () => {
  const headers = await bearer();
  await app.close();
  app = newApp(); await app.ready();
  const response = await app.inject({url:'/v1/devices/bancada-01/snapshot',headers});
  assert.equal(response.statusCode,200);
  assert.equal(response.json().simulation,true);
});

test('logout revoga sessão no banco e rejeita reutilização', async () => {
  const headers = await bearer();
  assert.equal((await app.inject({method:'POST',url:'/v1/auth/logout',headers})).statusCode,200);
  assert.equal((await app.inject({url:'/v1/devices/bancada-01/snapshot',headers})).statusCode,401);
  const saved = (await db.query<{motivo_revogacao:string;revogado_em:Date}>('SELECT motivo_revogacao,revogado_em FROM sessoes')).rows[0];
  assert.equal(saved.motivo_revogacao,'logout'); assert.ok(saved.revogado_em);
});

test('todas as rotas da bancada exigem vínculo ativo', async () => {
  const headers = await bearer();
  await db.query('UPDATE dispositivo_usuarios SET ativo=false WHERE usuario_id=$1',[operatorId]);
  const routes = [ ['GET','snapshot'], ['GET','telemetry'], ['GET','events'], ['GET','alerts'],
    ['GET','config'], ['PUT','config'], ['POST','alerts/qualquer/ack'], ['POST','commands'], ['GET','commands/qualquer'] ] as const;
  for(const [method,path] of routes) {
    const response = await app.inject({method,url:`/v1/devices/bancada-01/${path}`,headers});
    assert.equal(response.statusCode,403,`${method} ${path}`);
  }
  assert.equal((await app.inject({url:'/v1/devices/outra-bancada/snapshot',headers})).statusCode,403);
});

test('sessão vencida é recusada sem depender de limpeza periódica', async () => {
  const headers = await bearer();
  await db.exec(`UPDATE sessoes SET criado_em=now()-interval '10 hours', expira_em=now()-interval '2 hours'`);
  assert.equal((await app.inject({url:'/v1/devices/bancada-01/snapshot',headers})).statusCode,401);
});

test('troca de senha invalida token anterior e permite somente senha nova', async () => {
  const headers = await bearer();
  const newPassword = 'Nova senha própria para testar!';
  await db.query('UPDATE usuarios SET senha_hash=$1 WHERE id=$2',[await hashPassword(newPassword),operatorId]);
  assert.equal((await app.inject({url:'/v1/devices/bancada-01/snapshot',headers})).statusCode,401);
  assert.equal((await login()).statusCode,401);
  assert.equal((await login('operador',newPassword)).statusCode,200);
});

test('usuário desativado perde a sessão e não pode fazer novo login', async () => {
  const headers = await bearer();
  await db.query('UPDATE usuarios SET ativo=false WHERE id=$1',[operatorId]);
  assert.equal((await app.inject({url:'/v1/devices/bancada-01/snapshot',headers})).statusCode,401);
  assert.equal((await login()).statusCode,401);
});

test('senha trocada entre verificação e criação da sessão impede o login antigo', async () => {
  beforeSession = async () => { await db.query('UPDATE usuarios SET senha_hash=$1 WHERE id=$2',[await hashPassword('Senha alterada enquanto autentica!'),operatorId]); };
  assert.equal((await login()).statusCode,401);
  assert.equal((await db.query<{count:number}>('SELECT count(*)::int AS count FROM sessoes')).rows[0].count,0);
});

test('banco indisponível responde 503 e não recorre ao demo ou à memória', async () => {
  const headers = await bearer();
  available = false;
  assert.equal((await login()).statusCode,503);
  assert.equal((await login('demo','demo')).statusCode,503);
  assert.equal((await app.inject({url:'/v1/devices/bancada-01/snapshot',headers})).statusCode,503);
});

test('health é público e a API não disponibiliza cadastro público', async () => {
  assert.deepEqual((await app.inject({url:'/health?check=1'})).json(),{status:'ok',authStorage:'postgres',simulation:true});
  assert.equal((await app.inject({url:'/v1/devices/bancada-01/snapshot'})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/v1/auth/register',headers:await bearer(),payload:{}})).statusCode,404);
});
