import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Simulator } from '../../api/src/simulator.ts';
import { dashboardStatus, hasRecentState, pumpControlBlock, readingAge } from '../src/dashboardModel.ts';

const clock = Date.parse('2026-11-04T12:00:00Z');
const sample = scenario => { const sim = new Simulator(() => clock); if (scenario) sim.setScenario(scenario); return sim.getSnapshot(); };

test('dados antigos, dispositivo offline e falha na API não aparecem saudáveis', () => {
  const s = sample();
  assert.equal(hasRecentState(s, true, clock), true);
  for (const [snapshot, connected, time] of [[s, false, clock], [s, true, clock + 46_000], [sample('offline'), true, clock], [sample('stale'), true, clock]]) {
    assert.equal(hasRecentState(snapshot, connected, time), false);
    assert.equal(dashboardStatus(snapshot, connected, time).warning, true);
    assert.ok(pumpControlBlock(snapshot, 'B1', connected, time));
    assert.ok(pumpControlBlock(snapshot, 'B2', connected, time));
  }
});

test('alerta de calor e cada falha de sensor têm prioridade sobre faixa saudável de solo', () => {
  for (const scenario of ['heat', 'low_water', 'soil_failure', 'dht_failure', 'root_failure', 'high_humidity']) {
    assert.equal(dashboardStatus(sample(scenario), true, clock).warning, true, scenario);
  }
  assert.equal(dashboardStatus(sample('normal'), true, clock).warning, false);
});

test('bloqueios do controle distinguem nível baixo, DHT e falha do solo', () => {
  assert.ok(pumpControlBlock(sample('low_water'), 'B1', true, clock));
  assert.ok(pumpControlBlock(sample('low_water'), 'B2', true, clock));
  assert.ok(pumpControlBlock(sample('dht_failure'), 'B2', true, clock));
  assert.equal(pumpControlBlock(sample('soil_failure'), 'B1', true, clock), null);
});

test('banner de solo seco informa o acionamento e solo úmido informa espera', () => {
  assert.match(dashboardStatus(sample('dry_soil'), true, clock).text, /irrigação automática em andamento/);
  assert.match(dashboardStatus(sample('wet_soil'), true, clock).text, /em espera/);
});

test('idade de atualização é formatada sem valores negativos e com fallback', () => {
  assert.equal(readingAge(new Date(clock - 5000).toISOString(), clock), 'há 5 s');
  assert.equal(readingAge(new Date(clock - 120000).toISOString(), clock), 'há 2 min');
  assert.equal(readingAge(new Date(clock + 5000).toISOString(), clock), 'há 0 s');
  assert.equal(readingAge('inválido', clock), 'Horário indisponível');
});
