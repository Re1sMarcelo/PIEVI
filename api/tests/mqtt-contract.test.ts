import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { MQTT_EXAMPLES } from '../src/mqtt/examples.js';
import { ALERT_CODES } from '../src/mqtt/schema.js';
import { MQTT_MAX_PAYLOAD_BYTES, mqttTopic, mqttTopicParts, validateMqttPacket } from '../src/mqtt/protocol.js';
import { configError, DEFAULT_CONFIG } from '../src/controlConfig.js';

function example(name: string) { return structuredClone(MQTT_EXAMPLES.find(e => e.name === name)!); }
function validate(name: string, mutate: (payload: Record<string, any>) => void = () => {}) {
  const e = example(name); mutate(e.payload);
  return validateMqttPacket(mqttTopic(e.payload.deviceId, e.channel), JSON.stringify(e.payload), e.retain);
}
test('todos os exemplos independentes de firmware/API respeitam o contrato', () => {
  for (const e of MQTT_EXAMPLES) assert.equal(validate(e.name).ok, true, e.name);
});
test('versão, canal, identidade, tipos e campos desconhecidos não passam silenciosamente', () => {
  for (const mutate of [(p: any) => p.schemaVersion = 2, (p: any) => p.soilMoisturePercent = '66.5', (p: any) => p.extra = 123, (p: any) => delete p.rootReliable]) assert.equal(validate('telemetry', mutate).ok, false);
  const e = example('telemetry');
  assert.equal(validateMqttPacket(mqttTopic('outra-bancada', 'telemetry'), JSON.stringify(e.payload), false).ok, false);
  assert.equal(validateMqttPacket(mqttTopic('bancada-01', 'state'), JSON.stringify(e.payload), false).ok, false);
  assert.equal(mqttTopicParts('devices/bancada-01/telemetry'), null);
  assert.throws(() => mqttTopic('../escape', 'telemetry'));
});
test('mensagens retidas, JSON, UTF-8 e tamanho têm limites explícitos', () => {
  const topic = mqttTopic('bancada-01', 'telemetry');
  assert.equal(validateMqttPacket(topic, JSON.stringify(example('telemetry').payload), true).ok, false);
  for (const raw of ['', '{', 'null', 'x'.repeat(MQTT_MAX_PAYLOAD_BYTES + 1), new Uint8Array([0xff])]) assert.equal(validateMqttPacket(topic, raw, false).ok, false);
  assert.equal(validate('presence-offline').ok, true);
});
test('IDs de reentrega e datas inválidas/normalizadas são recusados', () => {
  for (const mutate of [(p: any) => p.sequence++, (p: any) => p.occurredAt = '2026-02-30T12:00:00Z', (p: any) => p.occurredAt = '2026-11-06T09:00:00-03:00']) assert.equal(validate('telemetry', mutate).ok, false);
});
test('qualidade não permite sentinelas, zero fabricado ou solo sem calibração', () => {
  for (const mutate of [(p: any) => p.substrateTemperatureC = -127, (p: any) => p.substrateTemperatureC = 85, (p: any) => p.clockReliable = false, (p: any) => p.dhtReliable = false, (p: any) => p.activeCalibrationId = null]) assert.equal(validate('telemetry', mutate).ok, false);
  assert.equal(validate('telemetry-unavailable', p => p.soilMoisturePercent = 0).ok, false);
});
test('comandos respeitam teto de B2, exceção supervisionada e validade de até 10s', () => {
  assert.equal(validate('command-manual_on', p => p.pumpId = 'B2').ok, false);
  assert.equal(validate('command-manual_on', p => { p.pumpId = 'B2'; p.durationSeconds = 60; }).ok, true);
  assert.equal(validate('command-ignore_float', p => p.supervisionConfirmed = false).ok, false);
  assert.equal(validate('command-manual_off', p => p.durationSeconds = 60).ok, false);
  assert.equal(validate('command-auto', p => p.durationSeconds = 10).ok, false);
  assert.equal(validate('command-test', p => p.expiresAt = '2026-11-06T12:00:11Z').ok, false);
  assert.equal(validate('command-test', p => p.expiresAt = p.createdAt).ok, false);
});
test('configuração inteira segue SQL: minutos exatos, agenda sem duplicação, histerese e bloqueio', () => {
  for (const mutate of [(p: any) => p.config.fogPauseSeconds = 61, (p: any) => p.config.lowWaterBlocksPumps = false, (p: any) => p.config.soilMaxPercent = 61, (p: any) => p.config.irrigationSchedule.push(p.config.irrigationSchedule[0]), (p: any) => delete p.config.rootAlertTemperatureC]) assert.equal(validate('command-config', mutate).ok, false);
  assert.ok(configError({ ...DEFAULT_CONFIG, fogPauseSeconds: 61 }));
  assert.ok(configError({ ...DEFAULT_CONFIG, irrigationSchedule: Array(25).fill(DEFAULT_CONFIG.irrigationSchedule[0]) }));
});
test('estado valida temporizadores e episódios mas preserva evidência de relé preso', () => {
  assert.equal(validate('state-manual', p => p.pumps.B1.expiresAt = '2026-11-06T13:00:01Z').ok, false);
  assert.equal(validate('state-alert', p => p.activeAlerts.push(p.activeAlerts[0])).ok, false);
  assert.equal(validate('state', p => { p.pumps.B1.isOn = true; p.pumps.B1.faultCode = 'BOMBA_PRESA'; }).ok, true);
});
test('fim de ciclo é autossuficiente, duração observada não é truncada pelo teto físico', () => {
  assert.equal(validate('cycle-finished', p => { p.elapsedSeconds = 400; p.endedAt = '2026-11-06T12:06:41Z'; }).ok, true);
  assert.equal(validate('cycle-started', p => p.elapsedSeconds = 0).ok, false);
  assert.equal(validate('cycle-finished', p => p.elapsedSeconds = null).ok, false);
  assert.equal(validate('cycle-finished', p => p.startedAt = '2026-11-06T13:00:00Z').ok, false);
  assert.equal(validate('cycle-unsynchronized').ok, true);
});
test('recusa exige motivo e versão aplicada pertence somente ao ACK concluído', () => {
  assert.equal(validate('ack-rejected', p => p.reason = ' ').ok, false);
  assert.equal(validate('ack-config', p => p.status = 'accepted').ok, false);
});
test('recibos de persistência identificam a mensagem original e recusa exige motivo', () => {
  assert.equal(validate('receipt-stored').ok, true);
  assert.equal(validate('receipt-stored', p => p.sourceBootId = '00000000-0000-4000-8000-000000000002').ok, false);
  assert.equal(validate('receipt-rejected', p => p.reason = null).ok, false);
});
test('catálogo SQL e enum de alertas permanecem alinhados; OFFLINE pertence ao backend', () => {
  const sql = readFileSync(new URL('../../db/002_catalogo_alertas.sql', import.meta.url), 'utf8');
  assert.deepEqual(new Set([...sql.matchAll(/\('([A-Z0-9_]+)',/g)].map(m => m[1])), new Set(ALERT_CODES));
  assert.equal(validate('alert-opened', p => p.code = 'OFFLINE').ok, false);
  assert.equal(validate('calibration', p => p.adcDry = p.adcWater).ok, false);
});
