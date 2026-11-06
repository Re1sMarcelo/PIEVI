import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulator } from '../src/simulator.js';
import { DEFAULT_CONFIG, configError, inIrrigationWindow } from '../src/controlConfig.js';
import { createApp } from '../src/app.js';
import { MemoryAuthStore } from '../src/auth/store.js';
import type { CommandAction, PumpId } from '../src/contracts.js';

function bench(date = '2026-11-05T09:59:30Z') {
  let now = Date.parse(date), sequence = 0;
  const sim = new Simulator(() => now);
  return { sim, setTime: (date: string) => { now = Date.parse(date); sim.recordTelemetry(); },
    command: (pumpId: PumpId, action: CommandAction, durationSeconds?: number, supervisionConfirmed?: boolean) => sim.issueCommand({ commandId: `control-test-${++sequence}`, pumpId, action, durationSeconds, supervisionConfirmed, expiresAt: new Date(now + sim.getSnapshot().simulationClockOffsetMs + 5000).toISOString() }) };
}

test('validação segue faixas do modelo revisado e rejeita horários/durações ambíguos', () => {
  assert.equal(configError(DEFAULT_CONFIG), null);
  for (const change of [
    { soilMinPercent: 70, soilMaxPercent: 74 }, { irrigationMaxSeconds: 301 }, { irrigationCooldownMinutes: 4 },
    { irrigationMaxCyclesPerDay: 41 }, { fogHysteresisC: 0 }, { manualFogSeconds: 61 }, { manualIrrigationSeconds: 301 },
    { rootAlertTemperatureC: 36 }, { lowWaterBlocksPumps: false }, { irrigationWindowStart: '24:00' },
    { irrigationWindowEnabled: true, irrigationWindowStart: '06:00', irrigationWindowEnd: '06:00' },
    { irrigationSchedule: [{ time: '07:00', durationSeconds: 0, enabled: true }] },
    { irrigationSchedule: [{ time: '7:00', durationSeconds: 60, enabled: true }] },
    { irrigationSchedule: [{ time: '07:00', durationSeconds: 60, enabled: true }, { time: '07:00', durationSeconds: 60, enabled: false }] },
    { irrigationSchedule: [{ time: '07:00', durationSeconds: 60, enabled: 'true' }] }, { unexpected: 1 },
  ]) assert.ok(configError({ ...DEFAULT_CONFIG, ...change }), JSON.stringify(change));
});

test('janela normal e janela que atravessa meia-noite têm fim exclusivo', () => {
  const config = { ...DEFAULT_CONFIG, irrigationWindowEnabled: true };
  assert.equal(inIrrigationWindow('06:00', config), true); assert.equal(inIrrigationWindow('17:00', config), false);
  config.irrigationWindowStart = '22:00'; config.irrigationWindowEnd = '06:00';
  for (const time of ['22:00', '23:59', '00:00', '05:59']) assert.equal(inIrrigationWindow(time, config), true);
  assert.equal(inIrrigationWindow('12:00', config), false); assert.equal(inIrrigationWindow('06:00', config), false);
});

test('agenda opera por falha de solo, no fuso local, uma vez por horário', () => {
  const b = bench(); b.sim.setScenario('soil_failure');
  b.sim.updateConfig({ irrigationSchedule: [{ time: '07:00', durationSeconds: 10, enabled: true }] });
  b.sim.advanceTime(30);
  assert.equal(b.sim.getSnapshot().pumps.B1.isOn, true);
  assert.equal(b.sim.getSnapshot().irrigationCyclesToday, 1);
  b.sim.advanceTime(10); assert.equal(b.sim.getSnapshot().pumps.B1.isOn, false);
  b.sim.updateConfig(b.sim.getConfig()); b.sim.getSnapshot();
  assert.equal(b.sim.getSnapshot().irrigationCyclesToday, 1);
  assert.ok(b.sim.getEvents().some(e => e.description.includes('horário de reserva')));
});

test('agenda não aciona com sensor saudável e não recupera horário perdido', () => {
  const b = bench(); b.sim.advanceTime(30); assert.equal(b.sim.getSnapshot().pumps.B1.isOn, false);
  b.setTime('2026-11-05T10:02:00Z'); b.sim.setScenario('soil_failure');
  assert.equal(b.sim.getSnapshot().pumps.B1.isOn, false);
});

test('desabilitar horário, remover agenda ou ficar fora da janela impede fallback', () => {
  for (const change of [
    { irrigationSchedule: [] },
    { irrigationSchedule: [{ time: '07:00', durationSeconds: 60, enabled: false }] },
    { irrigationWindowEnabled: true, irrigationWindowStart: '08:00', irrigationWindowEnd: '17:00' },
  ]) {
    const b = bench(); b.sim.setScenario('soil_failure'); b.sim.updateConfig(change); b.sim.advanceTime(30);
    assert.equal(b.sim.getSnapshot().pumps.B1.isOn, false);
  }
});

test('hora inválida suspende agenda; sensor saudável continua ignorando janela', () => {
  const b = bench(); b.sim.setScenario('soil_clock_failure'); b.sim.advanceTime(30);
  assert.equal(b.sim.getSnapshot().pumps.B1.isOn, false);
  assert.ok(b.sim.getSnapshot().activeAlerts.some(a => a.code === 'HORA_INVALIDA'));
  assert.equal(b.command('B1', 'MANUAL_ON', 10).status, 'rejected');
  b.sim.setScenario('clock_failure');
  assert.ok(b.sim.updateConfig({ soilMinPercent: 80, soilMaxPercent: 85, irrigationWindowEnabled: true, irrigationWindowStart: '22:00', irrigationWindowEnd: '06:00' }));
  assert.equal(b.sim.getSnapshot().pumps.B1.isOn, true);
});

test('limite diário e cooldown valem na agenda e não zeram ao salvar configuração', () => {
  const b = bench(); b.sim.setScenario('soil_failure');
  b.sim.updateConfig({ irrigationCooldownMinutes: 5, irrigationMaxCyclesPerDay: 5,
    irrigationSchedule: ['07:00', '07:06', '07:12', '07:18', '07:24', '07:30'].map(time => ({ time, durationSeconds: 1, enabled: true })) });
  b.sim.advanceTime(30);
  for (let i = 0; i < 5; i++) b.sim.advanceTime(360);
  assert.equal(b.sim.getSnapshot().irrigationCyclesToday, 5);
  assert.equal(b.sim.getSnapshot().pumps.B1.isOn, false);
  b.sim.updateConfig(b.sim.getConfig()); assert.equal(b.sim.getSnapshot().irrigationCyclesToday, 5);
});

test('B1 respeita duração máxima configurada e manual ignora janela, sem exceder teto', () => {
  const b = bench(); b.sim.updateConfig({ irrigationMaxSeconds: 30 }); b.sim.setScenario('dry_soil');
  b.sim.advanceTime(30); assert.equal(b.sim.getSnapshot().pumps.B1.isOn, false);
  b.sim.updateConfig({ irrigationWindowEnabled: true, irrigationWindowStart: '22:00', irrigationWindowEnd: '06:00' });
  assert.equal(b.command('B1', 'MANUAL_ON', 40).status, 'accepted');
  b.sim.advanceTime(40); assert.equal(b.sim.getSnapshot().pumps.B1.mode, 'AUTO');
});

test('manual OFF expira em uma hora e comandos funcionam após avançar relógio', () => {
  const b = bench(); b.command('B2', 'MANUAL_OFF');
  b.sim.advanceTime(3600); assert.equal(b.sim.getSnapshot().pumps.B2.mode, 'AUTO');
  assert.equal(b.command('B2', 'TEST').status, 'accepted');
  b.sim.advanceTime(10); assert.equal(b.sim.getSnapshot().pumps.B2.isOn, false);
});

test('comandos repetidos diferentes não prorrogam o teto contínuo de B2', () => {
  const b = bench(); b.command('B2', 'MANUAL_ON', 60); b.sim.advanceTime(30);
  b.command('B2', 'MANUAL_ON', 60); b.sim.advanceTime(30);
  assert.equal(b.sim.getSnapshot().pumps.B2.isOn, false);
});

test('ignorar boia exige supervisão, é exclusivo e expira sem prorrogação repetida', () => {
  const b = bench(); b.sim.setScenario('low_water');
  assert.equal(b.command('B1', 'IGNORE_FLOAT', 120).status, 'rejected');
  assert.equal(b.command('B1', 'IGNORE_FLOAT', 121, true).status, 'rejected');
  assert.equal(b.command('B1', 'IGNORE_FLOAT', 120, true).status, 'accepted');
  assert.equal(b.sim.getSnapshot().pumps.B1.isOn, true);
  assert.equal(b.command('B2', 'IGNORE_FLOAT', 60, true).status, 'rejected');
  b.sim.advanceTime(60); assert.equal(b.command('B1', 'IGNORE_FLOAT', 120, true).status, 'accepted');
  b.sim.advanceTime(60); assert.equal(b.sim.getSnapshot().pumps.B1.isOn, false);
  assert.equal(b.sim.getSnapshot().pumps.B1.floatOverrideUntil, null);
  assert.ok(b.sim.getSnapshot().activeAlerts.some(a => a.code === 'NIVEL_BAIXO'));
});

test('falha de bomba bloqueia automático, mas permite diagnóstico e rearme', () => {
  const b = bench(); b.sim.setScenario('irrigation_failure');
  assert.equal(b.sim.getSnapshot().pumps.B1.isOn, false);
  assert.equal(b.command('B1', 'TEST').status, 'accepted'); b.sim.advanceTime(10);
  assert.ok(b.sim.getSnapshot().pumps.B1.faultCode);
  assert.equal(b.command('B1', 'RESET_FAULT').status, 'completed');
  assert.equal(b.sim.getSnapshot().pumps.B1.faultCode, null);
  assert.ok(!b.sim.getSnapshot().activeAlerts.some(a => a.code === 'IRRIG_FALHA'));
});

test('automático da outra bomba não inicia durante exceção supervisionada', () => {
  const b = bench(); b.sim.setScenario('heat');
  b.command('B2', 'MANUAL_OFF');
  assert.equal(b.command('B1', 'IGNORE_FLOAT', 30, true).status, 'accepted');
  assert.equal(b.command('B2', 'AUTO').status, 'completed');
  assert.equal(b.sim.getSnapshot().pumps.B2.isOn, false);
  assert.equal(b.command('B2', 'TEST').status, 'rejected');
});

test('configuração inválida é recusada atomicamente e a agenda não vaza por referência', () => {
  const b = bench(), initial = b.sim.getSnapshot();
  assert.equal(b.sim.updateConfig({ soilMinPercent: 65, irrigationMaxSeconds: 301 }), null);
  assert.equal(b.sim.getSnapshot().configVersion, initial.configVersion);
  assert.deepEqual(b.sim.getConfig(), initial.config);
  const copy = b.sim.getConfig(); copy.irrigationSchedule[0].time = '18:00';
  assert.equal(b.sim.getConfig().irrigationSchedule[0].time, '07:00');
  b.sim.setScenario('offline'); assert.equal(b.sim.updateConfig({ soilMinPercent: 61 }), null);
});

test('API aplica com versão, rejeita conflito e avanço de tempo exige autenticação', async () => {
  const app = createApp({ authStore: new MemoryAuthStore('demo', undefined, true, 'bancada-01'), logger: false });
  try {
    assert.equal((await app.inject({ method: 'PUT', url: '/v1/devices/bancada-01/simulation', payload: { advanceSeconds: 60 } })).statusCode, 401);
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'demo', password: 'demo' } });
    const headers = { authorization: `Bearer ${login.json().token}` };
    const url = '/v1/devices/bancada-01/config';
    const current = await app.inject({ url, headers }); assert.equal(current.headers.etag, '"1"');
    const saved = await app.inject({ method: 'PUT', url, headers: { ...headers, 'if-match': '"1"' }, payload: { manualFogSeconds: 25 } });
    assert.equal(saved.statusCode, 200);
    assert.equal((await app.inject({ method: 'PUT', url, headers: { ...headers, 'if-match': '"1"' }, payload: { manualFogSeconds: 20 } })).statusCode, 409);
    const advanced = await app.inject({ method: 'PUT', url: '/v1/devices/bancada-01/simulation', headers, payload: { advanceSeconds: 60 } });
    assert.equal(advanced.statusCode, 200); assert.equal(advanced.json().simulationClockOffsetMs, 60000);
    assert.equal((await app.inject({ method: 'PUT', url: '/v1/devices/bancada-01/simulation', headers, payload: { advanceSeconds: -1 } })).statusCode, 400);
  } finally { await app.close(); }
});
