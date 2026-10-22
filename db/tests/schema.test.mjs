import assert from 'node:assert/strict';
import { createHash, randomBytes, scryptSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

let db;
let fixture;
const salt = randomBytes(16);
const passwordHash = `${salt.toString('hex')}:${scryptSync('senha-apenas-dos-testes', salt, 64).toString('hex')}`;
const otherHash = `${salt.toString('hex')}:${scryptSync('outra-senha-dos-testes', salt, 64).toString('hex')}`;
const tokenHash = createHash('sha256').update(randomBytes(32)).digest('hex');
const secondTokenHash = createHash('sha256').update(randomBytes(32)).digest('hex');
const commandCreated = '2026-10-22T12:00:00Z';
const commandExpiry = '2026-10-22T12:00:10Z';

async function insert(table, data) {
  const keys = Object.keys(data);
  const result = await db.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(',')}) RETURNING *`, Object.values(data));
  return result.rows[0];
}

async function rejects(action, code = '23514') {
  await db.exec('SAVEPOINT invalid_case');
  let failure;
  try { await action(); } catch (error) { failure = error; }
  await db.exec('ROLLBACK TO SAVEPOINT invalid_case; RELEASE SAVEPOINT invalid_case');
  assert.ok(failure, 'A operação inválida deveria ter sido recusada.');
  assert.equal(failure.code, code, failure.message);
}

const command = (overrides = {}) => insert('comandos', {
  dispositivo_id: fixture.device.id, usuario_id: fixture.user.id, sessao_id: fixture.session.id,
  id_externo: randomBytes(8).toString('hex'), tipo: 'manual_on', atuador: 'irrigacao',
  duracao_s: 120, criado_em: commandCreated, valido_ate: commandExpiry, ...overrides,
});
const config = (overrides = {}) => insert('config_historico', {
  dispositivo_id: fixture.device.id, versao: 1, alterado_por: fixture.user.id, ...overrides,
});
const reading = (overrides = {}) => insert('leituras', {
  dispositivo_id: fixture.device.id, mensagem_id: randomBytes(8).toString('hex'),
  ts: commandCreated, hora_confiavel: true, temp_ar: 28, umid_ar: 60, temp_raiz: 25,
  umid_solo: 65, nivel_ok: true, dht_confiavel: true, raiz_confiavel: true, solo_confiavel: true,
  ...overrides,
});
const alert = (overrides = {}) => insert('alertas', {
  dispositivo_id: fixture.device.id, mensagem_id: randomBytes(8).toString('hex'),
  id_externo: randomBytes(8).toString('hex'),
  codigo: 'UR_ALTA', severidade: 'aviso', mensagem: 'UR alta', acao_sugerida: 'Ventilar', ...overrides,
});

before(async () => {
  db = new PGlite();
  for (const file of ['../001_schema.sql', '../002_catalogo_alertas.sql', '../consultas-autenticacao.sql']) {
    await db.exec(await readFile(new URL(file, import.meta.url), 'utf8'));
  }
  console.log((await db.query('SELECT version() AS versao')).rows[0].versao);
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('BEGIN');
  const user = await insert('usuarios', { usuario: 'demo', nome: 'Operador', senha_hash: passwordHash });
  const secondUser = await insert('usuarios', { usuario: 'outro', nome: 'Outro operador', email: 'outro@example.com', senha_hash: passwordHash });
  const device = await insert('dispositivos', { identificador: 'bancada-01', nome: 'Bancada', chip_id: 'esp32-01' });
  const secondDevice = await insert('dispositivos', { identificador: 'bancada-02', nome: 'Outra bancada', chip_id: 'esp32-02' });
  await insert('dispositivo_usuarios', { dispositivo_id: device.id, usuario_id: user.id });
  await insert('dispositivo_usuarios', { dispositivo_id: secondDevice.id, usuario_id: secondUser.id });
  const session = await insert('sessoes', { usuario_id: user.id, token_hash: tokenHash });
  const secondSession = await insert('sessoes', { usuario_id: secondUser.id, token_hash: secondTokenHash });
  fixture = { user, secondUser, device, secondDevice, session, secondSession };
});
afterEach(async () => { await db.exec('ROLLBACK'); });

test('login por usuário/e-mail, contato opcional, unicidade e hash de senha', async () => {
  assert.equal(fixture.user.email, null);
  assert.equal((await db.query("EXECUTE buscar_usuario_login(' DEMO ')")).rows[0].id, fixture.user.id);
  assert.equal((await db.query("EXECUTE buscar_usuario_login(' OUTRO@EXAMPLE.COM ')")).rows[0].id, fixture.secondUser.id);
  await rejects(() => insert('usuarios', { usuario: 'DEMO', nome: 'Duplicado', senha_hash: passwordHash }), '23505');
  await rejects(() => db.query('UPDATE usuarios SET email=$1 WHERE id=$2', ['OUTRO@EXAMPLE.COM', fixture.user.id]), '23505');
  await rejects(() => db.query('UPDATE usuarios SET senha_hash=$1 WHERE id=$2', ['senha-em-texto', fixture.user.id]));
  await rejects(() => db.query('UPDATE usuarios SET nome=NULL WHERE id=$1', [fixture.user.id]), '23502');
});

test('sessões persistem apenas verificador e expiram/revogam no servidor', async () => {
  assert.equal((await db.query(`EXECUTE validar_sessao('${tokenHash}')`)).rows.length, 1);
  const sessionColumns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='sessoes'")).rows.map(row => row.column_name);
  assert.ok(sessionColumns.includes('token_hash'));
  assert.ok(!sessionColumns.includes('token'));
  await rejects(() => insert('sessoes', { usuario_id: fixture.user.id, token_hash: 'token-original' }));
  await db.query(`EXECUTE encerrar_sessao('${tokenHash}')`);
  assert.equal((await db.query(`EXECUTE validar_sessao('${tokenHash}')`)).rows.length, 0);
  await db.query("UPDATE sessoes SET criado_em=now()-interval '2 hours', expira_em=now()-interval '1 hour' WHERE id=$1", [fixture.secondSession.id]);
  assert.equal((await db.query(`EXECUTE validar_sessao('${secondTokenHash}')`)).rows.length, 0);
});

test('troca de senha revoga sessões e impede login com hash verificado antes da troca', async () => {
  await db.query('UPDATE usuarios SET senha_hash=$1 WHERE id=$2', [otherHash, fixture.user.id]);
  assert.equal((await db.query(`EXECUTE validar_sessao('${tokenHash}')`)).rows.length, 0);
  const newTokenHash = 'c'.repeat(64);
  assert.equal((await db.query(`EXECUTE criar_sessao('${fixture.user.id}','${newTokenHash}','${passwordHash}','demo')`)).rows.length, 0);
  assert.equal((await db.query(`EXECUTE criar_sessao('${fixture.user.id}','${newTokenHash}','${otherHash}','demo')`)).rows.length, 1);
  assert.equal((await db.query(`EXECUTE validar_sessao('${newTokenHash}')`)).rows.length, 1);
});

test('desativação de usuário não deixa sessão utilizável nem cria nova sessão', async () => {
  await db.query('UPDATE usuarios SET ativo=false WHERE id=$1', [fixture.user.id]);
  assert.equal((await db.query(`EXECUTE validar_sessao('${tokenHash}')`)).rows.length, 0);
  assert.equal((await db.query(`EXECUTE criar_sessao('${fixture.user.id}','${'d'.repeat(64)}','${passwordHash}','demo')`)).rows.length, 0);
});

test('autorização é por bancada e vínculo ativo, além do token', async () => {
  assert.equal((await db.query(`EXECUTE autorizar_dispositivo('${tokenHash}','bancada-01')`)).rows.length, 1);
  assert.equal((await db.query(`EXECUTE autorizar_dispositivo('${tokenHash}','bancada-02')`)).rows.length, 0);
  await db.query('UPDATE dispositivo_usuarios SET ativo=false WHERE dispositivo_id=$1', [fixture.device.id]);
  assert.equal((await db.query(`EXECUTE autorizar_dispositivo('${tokenHash}','bancada-01')`)).rows.length, 0);
});

test('ID externo é idempotente por dispositivo e sessão deve pertencer ao autor', async () => {
  await command({ id_externo: 'cliente-comando-01' });
  await rejects(() => command({ id_externo: 'cliente-comando-01' }), '23505');
  await rejects(() => command({ sessao_id: fixture.secondSession.id }), '23503');
  await rejects(() => command({ dispositivo_id: fixture.secondDevice.id }), '23503');
});

test('tetos de B1, B2, teste de 10s e MANUAL_OFF de uma hora', async () => {
  await command({ duracao_s: 300 });
  await command({ atuador: 'nevoa', duracao_s: 60 });
  await command({ tipo: 'manual_off', duracao_s: 3600 });
  await command({ tipo: 'testar_bomba', duracao_s: 10 });
  await rejects(() => command({ duracao_s: 301 }));
  await rejects(() => command({ atuador: 'nevoa', duracao_s: 61 }));
  await rejects(() => command({ tipo: 'manual_off', duracao_s: 3601 }));
  await rejects(() => command({ tipo: 'testar_bomba', duracao_s: 11 }));
  await rejects(() => command({ duracao_s: null }));
});

test('tentativas inseguras rejeitadas e comandos já vencidos permanecem auditáveis', async () => {
  await command({ atuador: 'nevoa', duracao_s: 120, status: 'rejeitado', motivo_resultado: 'Teto excedido', finalizado_em: commandCreated });
  await command({ status: 'expirado', valido_ate: '2026-10-22T11:59:00Z', finalizado_em: commandCreated });
  await rejects(() => command({ status: 'rejeitado', finalizado_em: commandCreated }));
  await rejects(() => command({ valido_ate: '2026-10-22T11:59:00Z' }));
});

test('ignorar boia exige confirmação, respeita tetos e reserva uma bomba por vez', async () => {
  await rejects(() => command({ tipo: 'ignorar_boia', duracao_s: 120 }));
  const first = await command({ tipo: 'ignorar_boia', supervisao_confirmada: true, duracao_s: 120 });
  await rejects(() => command({ tipo: 'ignorar_boia', supervisao_confirmada: true, atuador: 'nevoa', duracao_s: 60 }), '23505');
  await db.query("UPDATE comandos SET status='concluido', confirmado_em=$1, finalizado_em=$1 WHERE id=$2", [commandExpiry, first.id]);
  await rejects(() => command({ tipo: 'ignorar_boia', supervisao_confirmada: true, atuador: 'nevoa', duracao_s: 61 }));
  await command({ tipo: 'ignorar_boia', supervisao_confirmada: true, atuador: 'nevoa', duracao_s: 60 });
});

test('configuração atual usa somente a maior versão confirmada pelo ESP32', async () => {
  const first = await config({ aplicada_no_esp: true, aplicada_em: new Date() });
  const next = await config({ versao: 2 });
  assert.equal((await db.query('SELECT versao FROM config_atual')).rows[0].versao, 1);
  await db.query('UPDATE config_historico SET aplicada_no_esp=true, aplicada_em=clock_timestamp() WHERE id=$1', [next.id]);
  await db.query("UPDATE config_historico SET aplicada_em=clock_timestamp()+interval '1 second' WHERE id=$1", [first.id]);
  assert.equal((await db.query('SELECT versao FROM config_atual')).rows[0].versao, 2);
});

test('configuração valida faixas, boia obrigatória e fallback ligado à versão/bancada', async () => {
  await rejects(() => config({ bloquear_bombas_sem_agua: false }));
  await rejects(() => config({ solo_min: 60, solo_max: 64 }));
  await rejects(() => config({ irrig_max_s: 301 }));
  await rejects(() => config({ pulso_nevoa_s: 61 }));
  await rejects(() => config({ manual_nevoa_s: 120 }));
  const current = await config();
  await insert('irrigacao_programada', { configuracao_id: current.id, dispositivo_id: fixture.device.id, horario_local: '07:00' });
  await rejects(() => insert('irrigacao_programada', { configuracao_id: current.id, dispositivo_id: fixture.secondDevice.id, horario_local: '12:00' }), '23503');
});

test('alteração de configuração mantém o mesmo autor e dispositivo do comando', async () => {
  const request = await command({ tipo: 'config', atuador: null, duracao_s: null });
  await insert('dispositivo_usuarios', { dispositivo_id: fixture.device.id, usuario_id: fixture.secondUser.id });
  await rejects(() => config({ comando_id: request.id, alterado_por: fixture.secondUser.id }), '23503');
  await config({ comando_id: request.id });
});

test('telemetria deduplica por mensagem e preserva duas amostras com mesmo horário', async () => {
  await reading({ mensagem_id: 'mqtt-01' });
  await reading({ mensagem_id: 'mqtt-02' });
  await rejects(() => reading({ mensagem_id: 'mqtt-01' }), '23505');
  assert.equal((await db.query('SELECT count(*)::int AS total FROM leituras')).rows[0].total, 2);
});

test('sensores/relógio inválidos não viram valores fictícios ou sentinelas', async () => {
  await reading({ hora_confiavel: false, ts: null, temp_ar: null, umid_ar: null, temp_raiz: null, umid_solo: null, dht_confiavel: false, raiz_confiavel: false, solo_confiavel: false, nivel_ok: false });
  await rejects(() => reading({ temp_ar: null }));
  await rejects(() => reading({ temp_raiz: -127 }));
  await rejects(() => reading({ temp_raiz: 85 }));
  await rejects(() => reading({ umid_ar: 101 }));
  await rejects(() => reading({ ts: null }));
});

test('estado manual exige expiração absoluta e preserva anomalia relatada pelo hardware', async () => {
  const state = { dispositivo_id: fixture.device.id, atuador: 'nevoa', estado_fsm: 'IDLE', modo: 'MANUAL_OFF', ligado: true, mensagem_id: 'estado-01' };
  await rejects(() => insert('estado_atual', state));
  await insert('estado_atual', { ...state, modo_iniciado_em: commandCreated, expira_em: '2026-10-22T13:00:00Z' });
  // Ligada em MANUAL_OFF é evidência de anomalia: não ocultar o estado físico.
  assert.equal((await db.query('SELECT ligado FROM estado_atual')).rows[0].ligado, true);
});

test('acionamento liga ao comando da mesma bomba/bancada; duração real pode exceder teto', async () => {
  const request = await command();
  const activation = { dispositivo_id: fixture.device.id, mensagem_id: 'acionamento-01', id_externo: 'ciclo-esp32-01', atuador: 'irrigacao', inicio: commandCreated, fim: '2026-10-22T12:07:00Z', origem: 'manual', comando_id: request.id };
  await rejects(() => insert('acionamentos', { ...activation, dispositivo_id: fixture.secondDevice.id }), '23503');
  await rejects(() => insert('acionamentos', { ...activation, atuador: 'nevoa' }), '23503');
  const recorded = await insert('acionamentos', activation);
  assert.equal(Number(recorded.duracao_s), 420);
});

test('alerta reconhecido continua ativo; severidade pertence ao episódio e pode ser crítica', async () => {
  await rejects(() => alert({ reconhecido_em: new Date() }));
  const episode = await alert({ severidade: 'critico', reconhecido_por: fixture.user.id, reconhecido_em: new Date() });
  assert.equal(episode.resolvido_em, null);
  await rejects(() => alert(), '23505');
  await alert({ codigo: 'BOMBA_PRESA', atuador: 'irrigacao' });
  await alert({ codigo: 'BOMBA_PRESA', atuador: 'nevoa' });
});

test('confirmação tardia é auditável e não altera comando expirado nem estado observado', async () => {
  const expired = await command({ status: 'expirado', finalizado_em: commandCreated });
  await insert('comando_confirmacoes', { comando_id: expired.id, dispositivo_id: fixture.device.id, mensagem_id: 'ack-tardio', resultado: 'aceito' });
  assert.equal((await db.query('SELECT status FROM comandos WHERE id=$1', [expired.id])).rows[0].status, 'expirado');
  assert.equal((await db.query('SELECT count(*)::int AS total FROM estado_atual')).rows[0].total, 0);
});
