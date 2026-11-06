import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulator, DEVICE_ID } from '../src/simulator.js';
import { createApp } from '../src/app.js';
import { MemoryAuthStore } from '../src/auth/store.js';
import type { CommandAction, PumpId } from '../src/contracts.js';

function bench() {
  let time = Date.parse('2026-11-04T12:00:00Z');
  const simulator = new Simulator(() => time);
  let sequence = 0;
  return { simulator, advance: (seconds: number) => { time += seconds * 1000; },
    command: (pumpId: PumpId, action: CommandAction, durationSeconds?: number) => simulator.issueCommand({
      commandId: `test-command-${++sequence}`, pumpId, action, durationSeconds,
      expiresAt: new Date(time + 5000).toISOString(),
    }) };
}

test('normal começa sem alertas artificiais; qualidade e quatro medições válidas', () => {
  const { simulator } = bench(); const s = simulator.getSnapshot();
  assert.equal(s.activeAlerts.length, 0);
  assert.ok(s.telemetry.dhtReliable && s.telemetry.soilReliable && s.telemetry.rootReliable);
  assert.equal(s.pumps.B1.isOn, false); assert.equal(s.pumps.B2.isOn, false);
});

test('solo seco aciona AUTO, umidade sobe e a irrigação para no máximo', () => {
  const b = bench(); b.simulator.setScenario('dry_soil');
  assert.equal(b.simulator.getSnapshot().pumps.B1.isOn, true);
  const before = b.simulator.getSnapshot().telemetry.soilMoisturePercent!;
  b.advance(160); b.simulator.recordTelemetry();
  const after = b.simulator.getSnapshot();
  assert.ok(after.telemetry.soilMoisturePercent! > before);
  assert.equal(after.pumps.B1.isOn, false);
});

test('nível baixo bloqueia ligar/testar B1 e B2; ACK não resolve o alerta', () => {
  const b = bench(); b.simulator.setScenario('low_water');
  for (const id of ['B1', 'B2'] as const) {
    assert.equal(b.command(id, 'MANUAL_ON', 30).status, 'rejected');
    assert.equal(b.command(id, 'TEST').status, 'rejected');
    assert.equal(b.simulator.getSnapshot().pumps[id].isOn, false);
  }
  const alert = b.simulator.getSnapshot().activeAlerts.find(a => a.code === 'NIVEL_BAIXO')!;
  b.simulator.acknowledgeAlert(alert.id);
  assert.ok(b.simulator.getSnapshot().activeAlerts.find(a => a.id === alert.id)?.acknowledgedAt);
  b.simulator.setScenario('normal');
  assert.ok(b.simulator.getAlerts().find(a => a.id === alert.id)?.endedAt);
});

test('falha DHT bloqueia B2 e libera somente após três leituras válidas', () => {
  const b = bench(); b.simulator.setScenario('dht_failure');
  assert.equal(b.simulator.getSnapshot().telemetry.airTemperatureC, null);
  assert.equal(b.command('B2', 'TEST').status, 'rejected');
  b.simulator.setScenario('normal'); // first valid measurement
  assert.equal(b.command('B2', 'TEST').status, 'rejected');
  b.simulator.recordTelemetry(); assert.equal(b.command('B2', 'TEST').status, 'rejected');
  b.simulator.recordTelemetry(); assert.equal(b.command('B2', 'TEST').status, 'accepted');
});

test('calor permite névoa em UR 92%; pulso para em 60 s e respeita pausa', () => {
  const b = bench(); b.simulator.setScenario('heat');
  assert.equal(b.simulator.getSnapshot().telemetry.airHumidityPercent, 92);
  assert.equal(b.simulator.getSnapshot().pumps.B2.isOn, true);
  b.advance(60); b.simulator.recordTelemetry();
  assert.equal(b.simulator.getSnapshot().pumps.B2.isOn, false);
  b.advance(299); b.simulator.recordTelemetry();
  assert.equal(b.simulator.getSnapshot().pumps.B2.isOn, false);
  b.advance(1); b.simulator.recordTelemetry();
  assert.equal(b.simulator.getSnapshot().pumps.B2.isOn, true);
});

test('UR alta prolongada bloqueia névoa e abre alerta crítico', () => {
  const b = bench(); b.simulator.setScenario('high_humidity');
  assert.equal(b.command('B2', 'MANUAL_ON', 30).status, 'rejected');
  assert.equal(b.simulator.getSnapshot().activeAlerts.find(a => a.code === 'UR_ALTA')?.severity, 'critical');
});

test('emergência não autoriza névoa em UR de 95%', () => {
  const b = bench(); b.simulator.setScenario('heat_humid');
  assert.equal(b.simulator.getSnapshot().pumps.B2.isOn, false);
  assert.ok(b.simulator.getSnapshot().activeAlerts.some(a => a.code === 'CALOR_EMERG'));
  assert.equal(b.command('B2', 'TEST').status, 'rejected');
});

test('falhas de solo e raiz não publicam zero nem fabricam leitura', () => {
  const b = bench(); b.simulator.setScenario('soil_failure');
  assert.equal(b.simulator.getSnapshot().telemetry.soilMoisturePercent, null);
  assert.equal(b.simulator.getSnapshot().pumps.B1.isOn, false);
  b.simulator.setScenario('root_failure');
  assert.equal(b.simulator.getSnapshot().telemetry.substrateTemperatureC, null);
  assert.ok(b.simulator.getSnapshot().activeAlerts.some(a => a.code === 'DS18_FALHA'));
});

test('offline e leituras antigas congelam amostra e não aceitam novos comandos', () => {
  const b = bench();
  for (const scenario of ['offline', 'stale'] as const) {
    b.simulator.setScenario(scenario); const s = b.simulator.getSnapshot();
    b.advance(60); b.simulator.recordTelemetry();
    assert.equal(b.simulator.getSnapshot().telemetry.id, s.telemetry.id);
    assert.equal(b.simulator.getSnapshot().lastSeenAt, s.lastSeenAt);
    assert.equal(b.command('B1', 'MANUAL_ON', 120).status, 'rejected');
    assert.equal(s.online, scenario !== 'offline');
  }
});

test('manual temporizado conclui comando e retorna AUTO; desligamento dura 1 h', () => {
  const b = bench(); const command = b.command('B1', 'MANUAL_ON', 10);
  b.advance(10); b.simulator.recordTelemetry();
  assert.equal(b.simulator.getCommand(command.commandId)?.status, 'completed');
  assert.equal(b.simulator.getSnapshot().pumps.B1.mode, 'AUTO');
  b.command('B1', 'MANUAL_OFF');
  assert.equal(Date.parse(b.simulator.getSnapshot().pumps.B1.expiresAt!) - Date.parse(b.simulator.getSnapshot().telemetry.occurredAt), 3_600_000);
});

test('reentrega idêntica não repete saída nem estende temporizador', () => {
  const b = bench(); const first = b.command('B1', 'MANUAL_ON', 120);
  b.advance(3); const copy = b.simulator.issueCommand(first);
  assert.equal(copy.createdAt, first.createdAt);
  assert.equal(b.simulator.getSnapshot().pumps.B1.expiresAt, new Date(Date.parse(first.createdAt) + 120_000).toISOString());
  assert.equal(b.simulator.issueCommand({ ...first, durationSeconds: 300 }).status, 'rejected');
});

test('cenário inválido não muda bancada; snapshot não permite mutação externa', () => {
  const b = bench(); assert.equal(b.simulator.setScenario('inventado'), null);
  const s = b.simulator.getSnapshot(); s.pumps.B1.isOn = true;
  assert.equal(b.simulator.getSnapshot().pumps.B1.isOn, false);
});

test('rota de cenário exige sessão, recusa cenário desconhecido e aceita seleção válida', async () => {
  const app = createApp({ authStore: new MemoryAuthStore('demo', undefined, true, DEVICE_ID), logger: false });
  try {
    const url = '/v1/devices/bancada-01/simulation';
    assert.equal((await app.inject({ method: 'PUT', url, payload: { scenario: 'low_water' } })).statusCode, 401);
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'demo', password: 'demo' } });
    const headers = { authorization: `Bearer ${login.json().token}` };
    assert.equal((await app.inject({ method: 'PUT', url, headers, payload: { scenario: 'nope' } })).statusCode, 400);
    const response = await app.inject({ method: 'PUT', url, headers, payload: { scenario: 'low_water' } });
    assert.equal(response.statusCode, 200); assert.equal(response.json().telemetry.waterLevel, 'LOW');
    const invalidPump = await app.inject({ method: 'POST', url: '/v1/devices/bancada-01/commands', headers,
      payload: { commandId: 'invalid-pump-001', pumpId: '__proto__', action: 'AUTO', expiresAt: new Date(Date.now() + 5000).toISOString() } });
    assert.equal(invalidPump.statusCode, 422);
    assert.equal(({} as { mode?: string }).mode, undefined);
  } finally { await app.close(); }
});

test('troca de cenário fica indisponível em produção', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const app = createApp({ authStore: new MemoryAuthStore('demo', undefined, true, DEVICE_ID), logger: false });
  try {
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'demo', password: 'demo' } });
    const headers = { authorization: `Bearer ${login.json().token}` };
    const snapshot = await app.inject({ url: '/v1/devices/bancada-01/snapshot', headers });
    assert.equal(snapshot.json().scenarioControlsEnabled, false);
    assert.equal((await app.inject({ method: 'PUT', url: '/v1/devices/bancada-01/simulation', headers, payload: { scenario: 'heat' } })).statusCode, 404);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});
