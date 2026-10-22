import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = readFileSync(new URL('../src/simulator.ts', import.meta.url), 'utf8');
const javascript = stripTypeScriptTypes(source);
const { Simulator } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const simulator = new Simulator();

function command(commandId, pumpId, action, durationSeconds, expiresAt = new Date(Date.now() + 5000).toISOString()) {
  return simulator.issueCommand({ commandId, pumpId, action, durationSeconds, expiresAt });
}

assert.equal(command('command-b1-valid', 'B1', 'MANUAL_ON', 120).status, 'accepted');
assert.equal(simulator.getSnapshot().pumps.B1.isOn, true);
assert.ok(simulator.getSnapshot().pumps.B1.expiresAt);
assert.equal(command('command-b1-too-long', 'B1', 'MANUAL_ON', 301).status, 'rejected');
assert.equal(command('command-b2-too-long', 'B2', 'MANUAL_ON', 61).status, 'rejected');
assert.equal(command('command-expired', 'B1', 'MANUAL_ON', 10, new Date(Date.now() - 1000).toISOString()).status, 'expired');
assert.equal(command('command-b1-valid', 'B1', 'MANUAL_OFF').action, 'MANUAL_ON');
assert.equal(command('command-b1-off', 'B1', 'MANUAL_OFF').status, 'accepted');
assert.equal(simulator.getSnapshot().pumps.B1.isOn, false);
assert.equal(simulator.updateConfig({ lowWaterBlocksPumps: false }), null);
assert.equal(simulator.updateConfig({ fogPulseSeconds: 61 }), null);
assert.equal(simulator.updateConfig({ soilMinPercent: 62, soilMaxPercent: 76 })?.soilMinPercent, 62);
assert.equal(command('command-b2-on', 'B2', 'MANUAL_ON', 30).status, 'accepted');
const currentTime = Date.now;
Date.now = () => currentTime() + 31_000;
try {
  assert.equal(simulator.getSnapshot().pumps.B2.mode, 'AUTO');
  assert.equal(simulator.getSnapshot().pumps.B2.isOn, false);
} finally {
  Date.now = currentTime;
}

process.stdout.write('Simulador: limites, expiração, idempotência e configuração OK.\n');
