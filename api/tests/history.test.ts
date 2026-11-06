import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulator, DEVICE_ID } from '../src/simulator.js';
import { createApp } from '../src/app.js';
import { MemoryAuthStore } from '../src/auth/store.js';

test('histórico diferencia saídas, pedidos, conclusão e configurações sem misturar bombas', () => {
  const sim = new Simulator(() => Date.parse('2026-11-06T12:00:00Z'));
  sim.issueCommand({ commandId: 'history-b1-command', pumpId: 'B1', action: 'TEST', expiresAt: '2026-11-06T12:00:05Z' });
  sim.advanceTime(10);
  sim.updateConfig({ rootAlertTemperatureC: 27 });
  const history = sim.getHistory();
  assert.deepEqual(history.events.filter(e => e.kind === 'actuation').map(e => [e.pumpId, e.outputOn]), [['B1', false], ['B1', true]]);
  assert.ok(history.events.some(e => e.commandId === 'history-b1-command' && e.commandStatus === 'completed'));
  assert.ok(history.events.some(e => e.kind === 'configuration' && e.configVersion === 2));
  assert.equal(history.events.find(e => e.kind === 'configuration')?.appliedConfig?.rootAlertTemperatureC, 27);
  assert.ok(!history.events.some(e => e.pumpId === 'B2'));
  history.events.length = 0;
  assert.ok(sim.getHistory().events.length > 0);
});

test('reconhecimento preserva alerta ativo; resolução conserva episódio e impede novo reconhecimento', () => {
  const sim = new Simulator(); sim.setScenario('low_water');
  const id = sim.getSnapshot().activeAlerts.find(a => a.code === 'NIVEL_BAIXO')!.id;
  assert.ok(sim.acknowledgeAlert(id)?.acknowledgedAt);
  const firstAck = sim.acknowledgeAlert(id)?.acknowledgedAt;
  assert.equal(sim.getSnapshot().activeAlerts.find(a => a.id === id)?.acknowledgedAt, firstAck);
  sim.setScenario('normal');
  assert.ok(!sim.getSnapshot().activeAlerts.some(a => a.id === id));
  const resolved = sim.getHistory().alerts.find(a => a.id === id)!;
  assert.ok(resolved.endedAt); assert.equal(resolved.acknowledgedAt, firstAck);
  assert.equal(sim.acknowledgeAlert(id), null);
  sim.setScenario('low_water');
  assert.notEqual(sim.getSnapshot().activeAlerts.find(a => a.code === 'NIVEL_BAIXO')!.id, id);
});

test('histórico autenticado entrega além da primeira página de 50 e respeita retenção', async () => {
  const app = createApp({ authStore: new MemoryAuthStore('demo', undefined, true, DEVICE_ID), logger: false });
  try {
    const url = '/v1/devices/bancada-01/history';
    assert.equal((await app.inject({ url })).statusCode, 401);
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username: 'demo', password: 'demo' } });
    const headers = { authorization: `Bearer ${login.json().token}` };
    await app.inject({ method: 'PUT', url: '/v1/devices/bancada-01/simulation', headers, payload: { advanceSeconds: 3600 } });
    const response = await app.inject({ url, headers });
    assert.equal(response.statusCode, 200);
    const data = response.json();
    assert.equal(data.telemetry.length, 200);
    assert.ok(data.events.length > 50); assert.ok(data.events.length <= 200);
    assert.equal(new Set(data.telemetry.map((t: { id: string }) => t.id)).size, 200);
    assert.ok(data.events.some((e: { kind: string }) => e.kind === 'simulation'));
    assert.ok([403, 404].includes((await app.inject({ url: '/v1/devices/other/history', headers })).statusCode));
  } finally { await app.close(); }
});
