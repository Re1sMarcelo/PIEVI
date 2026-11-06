import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CONFIG } from '../../api/src/controlConfig.ts';
import { Simulator } from '../../api/src/simulator.ts';
import { controlBlock, createControlDraft, nextMinuteTime, parseControlDraft, parseNumber } from '../src/controlModel.ts';
import { hasRecentState } from '../src/dashboardModel.ts';

test('formulário converte decimal com vírgula sem transformar vazio em zero', () => {
  assert.equal(parseNumber(' 28,5 '), 28.5);
  for (const value of ['', ' ', '1e2', '12abc', '1.2.3']) assert.equal(Number.isNaN(parseNumber(value)), true);
  const draft = createControlDraft(DEFAULT_CONFIG); draft.numbers.fogTemperatureOnC = '28,5';
  assert.equal(parseControlDraft(draft, DEFAULT_CONFIG).config.fogTemperatureOnC, 28.5);
  draft.numbers.soilMinPercent = ''; assert.ok(parseControlDraft(draft, DEFAULT_CONFIG).error);
});

test('rascunho independente preserva configuração aplicada e valida agenda antes de enviar', () => {
  const draft = createControlDraft(DEFAULT_CONFIG); draft.schedule[0].time = '25:00';
  assert.equal(DEFAULT_CONFIG.irrigationSchedule[0].time, '07:00');
  assert.ok(parseControlDraft(draft, DEFAULT_CONFIG).error);
  draft.schedule[0].time = '08:00'; draft.schedule[1].time = '08:00';
  assert.match(parseControlDraft(draft, DEFAULT_CONFIG).error, /duplicado/);
});

test('agenda removida e janela desativada são configurações válidas', () => {
  const draft = createControlDraft(DEFAULT_CONFIG); draft.schedule = [];
  const parsed = parseControlDraft(draft, DEFAULT_CONFIG);
  assert.equal(parsed.error, undefined); assert.deepEqual(parsed.config.irrigationSchedule, []);
});

test('próximo minuto usa o fuso da bancada, inclusive na virada do dia', () => {
  assert.equal(nextMinuteTime(Date.parse('2026-11-06T02:59:40Z'), 'America/Sao_Paulo'), '00:00');
});

test('água bloqueia manual, mas a exceção supervisionada não ignora DHT ou outra bomba', () => {
  const now = Date.parse('2026-11-05T12:00:00Z'), sim = new Simulator(() => now);
  sim.setScenario('low_water'); let snapshot = sim.getSnapshot();
  assert.ok(controlBlock(snapshot, 'B1', 'MANUAL_ON', true, now));
  assert.equal(controlBlock(snapshot, 'B1', 'MANUAL_OFF', true, now), null);
  assert.equal(controlBlock(snapshot, 'B1', 'IGNORE_FLOAT', true, now), null);
  snapshot.pumps.B2.isOn = true; assert.ok(controlBlock(snapshot, 'B1', 'IGNORE_FLOAT', true, now));
  sim.setScenario('dht_failure'); snapshot = sim.getSnapshot();
  assert.ok(controlBlock(snapshot, 'B2', 'IGNORE_FLOAT', true, now));
});

test('falha de bomba permite teste manual, mas hora inválida e estado antigo impedem comandos', () => {
  const now = Date.parse('2026-11-05T12:00:00Z'), sim = new Simulator(() => now);
  sim.setScenario('fog_failure'); assert.equal(controlBlock(sim.getSnapshot(), 'B2', 'TEST', true, now), null);
  sim.setScenario('clock_failure'); assert.ok(controlBlock(sim.getSnapshot(), 'B1', 'MANUAL_ON', true, now));
  sim.setScenario('offline'); assert.ok(controlBlock(sim.getSnapshot(), 'B1', 'AUTO', true, now));
});

test('avanço simulado não faz as novas leituras parecerem futuras ou antigas', () => {
  const now = Date.parse('2026-11-05T12:00:00Z'), sim = new Simulator(() => now);
  sim.advanceTime(600); const snapshot = sim.getSnapshot();
  const displayClock = now + snapshot.simulationClockOffsetMs;
  assert.equal(hasRecentState(snapshot, true, displayClock), true);
  assert.equal(controlBlock(snapshot, 'B1', 'MANUAL_ON', true, displayClock), null);
});
