import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulator } from '../../api/src/simulator.ts';
import { historyRows, sortedActiveAlerts } from '../src/activityModel.ts';

const now = Date.parse('2026-11-06T12:00:00Z');
const zone = 'America/Sao_Paulo';
const rows = (data, category, sensor = 'airTemperatureC', period = 'all') => historyRows(data, category, sensor, period, now, zone);

test('categoria das bombas não depende da descrição e distingue pedidos de saída observada', () => {
  const data = { telemetry: [], alerts: [], events: [
    { id: '1', kind: 'command', pumpId: 'B1', commandStatus: 'rejected', occurredAt: '2026-11-06T11:00:00Z', description: 'B2 citado na justificativa', origin: 'operator' },
    { id: '2', kind: 'actuation', pumpId: 'B2', outputOn: true, occurredAt: '2026-11-06T11:01:00Z', description: 'Saída ligada', origin: 'simulator' },
    { id: '3', kind: 'configuration', occurredAt: '2026-11-06T11:02:00Z', description: 'Nova configuração', origin: 'operator' },
  ] };
  assert.deepEqual(rows(data, 'B1').map(r => r.id), ['1']);
  assert.equal(rows(data, 'B1')[0].state, 'Recusado');
  assert.deepEqual(rows(data, 'B2').map(r => r.id), ['2']);
  assert.deepEqual(rows(data, 'configuration').map(r => r.id), ['3']);
  assert.equal(rows(data, 'system').length, 0);
});

test('leitura indisponível não aparece como zero ou leitura válida retida; reservatório não vira percentual', () => {
  const sim = new Simulator(() => now); sim.setScenario('dht_failure');
  const data = sim.getHistory();
  assert.equal(rows(data, 'readings')[0].title, 'Sem leitura confiável');
  assert.equal(rows(data, 'readings', 'waterLevel')[0].title, 'Nível adequado');
  const soil = rows(data, 'readings', 'soilMoisturePercent')[0];
  assert.ok(soil.title.endsWith('%')); assert.equal(soil.summary, 'Umidade do solo');
});

test('somente ativos na tela de alertas, ordenados por prioridade; reconhecido continua ativo', () => {
  const alert = (id, severity, endedAt = null, acknowledgedAt = null) => ({ id, severity, startedAt: '2026-11-06T11:00:00Z', endedAt, acknowledgedAt });
  const data = [alert('info', 'info'), alert('closed', 'critical', '2026-11-06T11:30:00Z'), alert('ack', 'critical', null, '2026-11-06T11:01:00Z'), alert('warning', 'warning')];
  assert.deepEqual(sortedActiveAlerts(data).map(a => a.id), ['ack', 'warning', 'info']);
  assert.equal(data.length, 4);
});

test('hoje usa o fuso da bancada e última hora respeita limites inclusivos', () => {
  const data = { alerts: [], events: [], telemetry: ['2026-11-06T02:59:59Z', '2026-11-06T03:00:00Z', '2026-11-06T11:00:00Z', '2026-11-06T12:00:01Z'].map((occurredAt, i) => ({ id: String(i), occurredAt, airTemperatureC: 25, dhtReliable: true, clockReliable: true })) };
  assert.deepEqual(rows(data, 'readings', 'airTemperatureC', 'today').map(r => r.id), ['2', '1']);
  assert.deepEqual(rows(data, 'readings', 'airTemperatureC', 'hour').map(r => r.id), ['2']);
});

test('histórico de alertas inclui episódios ativos e resolvidos durante o período e preserva o reconhecimento', () => {
  const sim = new Simulator(() => now); sim.setScenario('low_water');
  const id = sim.getSnapshot().activeAlerts[0].id; sim.acknowledgeAlert(id); sim.setScenario('normal');
  const history = sim.getHistory();
  const resolved = rows(history, 'alerts')[0];
  assert.equal(resolved.state, 'Resolvido');
  assert.notEqual(resolved.details.find(d => d.label === 'Reconhecimento').value, 'Ainda não reconhecido');
  history.alerts = [
    { ...history.alerts[0], id: 'active-old', startedAt: '2026-11-01T12:00:00Z', endedAt: null },
    { ...history.alerts[0], id: 'resolved-today', startedAt: '2026-11-01T12:00:00Z', endedAt: '2026-11-06T10:00:00Z' },
    { ...history.alerts[0], id: 'resolved-old', startedAt: '2026-11-01T12:00:00Z', endedAt: '2026-11-02T10:00:00Z' },
  ];
  assert.deepEqual(new Set(rows(history, 'alerts', 'airTemperatureC', 'today').map(r => r.id)), new Set(['active-old', 'resolved-today']));
});
