import { DEFAULT_CONFIG } from '../controlConfig.js';
import type { MqttChannel } from './schema.js';

export interface ProtocolExample { name: string; channel: MqttChannel; retain: boolean; payload: Record<string, any> }
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const deviceId = 'bancada-01';
let sequence = 0;
const esp = (type: string) => {
  sequence++;
  return { schemaVersion: 1, type, deviceId, bootId: id(1), bootNumber: 1, connectionId: id(2), sequence,
    messageId: `${id(1)}:${sequence}`, uptimeMs: 60000 + sequence * 1000, clockReliable: true, occurredAt: '2026-11-06T12:00:01Z' };
};
const backend = (type: string, n: number) => ({ schemaVersion: 1, type, deviceId, messageId: id(n), createdAt: '2026-11-06T12:00:00Z', expiresAt: '2026-11-06T12:00:10Z' });
const target = { targetBootId: id(1), targetBootNumber: 1, targetConnectionId: id(2) };
const measurements = { airTemperatureC: 28.4, airHumidityPercent: 62.1, soilMoisturePercent: 66.5 };
const defaultPump = { mode: 'AUTO', isOn: false, fsmState: 'IDLE', modeStartedAt: null, expiresAt: null,
  remainingSeconds: null, blockedReason: null, faultCode: null, floatOverrideUntil: null, feedback: 'relay_output' };
const alert = { episodeId: id(30), code: 'NIVEL_BAIXO', pumpId: null, severity: 'critical', startedAt: '2026-11-06T12:00:01Z', detail: 'Boia indica nível baixo ou circuito aberto.' };
const sample = (name: string, channel: MqttChannel, payload: Record<string, any>, retain = false): ProtocolExample => ({ name, channel, payload, retain });
const telemetry = { ...esp('telemetry'), ...measurements, substrateTemperatureC: 24.8, soilMoistureAdc: 1803,
  waterLevel: 'OK', dhtReliable: true, soilReliable: true, rootReliable: true, activeCalibrationId: id(3) };
const unknownSensors = { ...esp('telemetry'), clockReliable: false, occurredAt: null, airTemperatureC: null, airHumidityPercent: null,
  substrateTemperatureC: null, soilMoisturePercent: null, soilMoistureAdc: null, waterLevel: 'LOW',
  dhtReliable: false, soilReliable: false, rootReliable: false, activeCalibrationId: null };
const cycle = { eventType: 'cycle', cycleId: id(40), pumpId: 'B1', source: 'manual', commandId: 'cmd-b1-20261106-001', reason: 'Pedido manual validado.',
  startedAt: '2026-11-06T12:00:01Z', endedAt: null, elapsedSeconds: null, measurementsBefore: measurements, measurementsAfter: null };
export const MQTT_EXAMPLES: ProtocolExample[] = [
  sample('telemetry', 'telemetry', telemetry),
  sample('telemetry-unavailable', 'telemetry', unknownSensors),
  sample('state', 'state', { ...esp('state'), syncId: id(50), activeConfigVersion: 1, firmwareVersion: 'esp32-dev-1.0.0', droppedMessages: 0,
    pumps: { B1: { ...defaultPump }, B2: { ...defaultPump } }, activeAlerts: [] }),
  sample('state-manual', 'state', { ...esp('state'), syncId: null, activeConfigVersion: 1, firmwareVersion: 'esp32-dev-1.0.0', droppedMessages: 0,
    pumps: { B1: { ...defaultPump, mode: 'MANUAL_ON', isOn: true, fsmState: 'MANUAL_ON', modeStartedAt: '2026-11-06T12:00:01Z', expiresAt: '2026-11-06T12:02:01Z', remainingSeconds: 120 }, B2: { ...defaultPump } }, activeAlerts: [] }),
  sample('state-alert', 'state', { ...esp('state'), syncId: null, activeConfigVersion: 1, firmwareVersion: 'esp32-dev-1.0.0', droppedMessages: 0,
    pumps: { B1: { ...defaultPump, fsmState: 'BLOCKED', blockedReason: 'Nível baixo' }, B2: { ...defaultPump, fsmState: 'BLOCKED', blockedReason: 'Nível baixo' } }, activeAlerts: [alert] }),
  sample('presence-online', 'presence', { schemaVersion: 1, type: 'presence', deviceId, bootId: id(1), bootNumber: 1, connectionId: id(2), online: true }, true),
  sample('presence-offline', 'presence', { schemaVersion: 1, type: 'presence', deviceId, bootId: id(1), bootNumber: 1, connectionId: id(2), online: false }, true),
  sample('sync', 'sync', { ...backend('sync', 51), syncId: id(50) }),
  sample('receipt-stored', 'receipts', { schemaVersion: 1, type: 'receipt', deviceId, messageId: id(52), sourceMessageId: `${id(1)}:1`, sourceBootId: id(1), sourceBootNumber: 1, status: 'stored', reason: null, processedAt: '2026-11-06T12:00:02Z' }),
  sample('receipt-duplicate', 'receipts', { schemaVersion: 1, type: 'receipt', deviceId, messageId: id(53), sourceMessageId: `${id(1)}:1`, sourceBootId: id(1), sourceBootNumber: 1, status: 'duplicate', reason: null, processedAt: '2026-11-06T12:00:03Z' }),
  sample('receipt-rejected', 'receipts', { schemaVersion: 1, type: 'receipt', deviceId, messageId: id(54), sourceMessageId: `${id(1)}:1`, sourceBootId: id(1), sourceBootNumber: 1, status: 'rejected', reason: 'messageId reutilizado com outro conteúdo.', processedAt: '2026-11-06T12:00:03Z' }),
  ...(['AUTO', 'MANUAL_ON', 'MANUAL_OFF', 'TEST', 'RESET_FAULT', 'IGNORE_FLOAT'] as const).map((action, index) => sample(`command-${action.toLowerCase()}`, 'commands', {
    ...backend('command', 60 + index), ...target, commandId: `cmd-b1-${action.toLowerCase()}-001`, pumpId: 'B1', action,
    durationSeconds: action === 'MANUAL_ON' || action === 'IGNORE_FLOAT' ? 120 : action === 'MANUAL_OFF' ? 3600 : action === 'TEST' ? 10 : null,
    supervisionConfirmed: action === 'IGNORE_FLOAT',
  })),
  sample('command-config', 'commands', { ...backend('command', 70), ...target, commandId: 'cmd-config-20261106-001', pumpId: null, action: 'APPLY_CONFIG',
    durationSeconds: null, supervisionConfirmed: false, configVersion: 1, timeZone: 'America/Sao_Paulo', config: structuredClone(DEFAULT_CONFIG) }),
  sample('ack-accepted', 'acks', { ...esp('ack'), commandId: 'cmd-b1-20261106-001', status: 'accepted', reason: null, appliedConfigVersion: null }),
  sample('ack-rejected', 'acks', { ...esp('ack'), commandId: 'cmd-b1-20261106-002', status: 'rejected', reason: 'Nível baixo bloqueia a bomba.', appliedConfigVersion: null }),
  sample('ack-completed', 'acks', { ...esp('ack'), commandId: 'cmd-b1-20261106-001', status: 'completed', reason: 'Temporizador encerrado.', appliedConfigVersion: null }),
  sample('ack-config', 'acks', { ...esp('ack'), commandId: 'cmd-config-20261106-001', status: 'completed', reason: null, appliedConfigVersion: 1 }),
  sample('cycle-started', 'events', { ...esp('event'), ...cycle, phase: 'started' }),
  sample('cycle-finished', 'events', { ...esp('event'), ...cycle, phase: 'finished', occurredAt: '2026-11-06T12:02:01Z', endedAt: '2026-11-06T12:02:01Z', elapsedSeconds: 120, measurementsAfter: { ...measurements, soilMoisturePercent: 73.2 } }),
  sample('cycle-unsynchronized', 'events', { ...esp('event'), ...cycle, phase: 'finished', clockReliable: false, occurredAt: null,
    source: 'auto', commandId: null, startedAt: null, endedAt: null, elapsedSeconds: 100, measurementsAfter: measurements }),
  sample('alert-opened', 'events', { ...esp('event'), eventType: 'alert', phase: 'opened', ...alert, endedAt: null }),
  sample('alert-updated', 'events', { ...esp('event'), eventType: 'alert', phase: 'updated', ...alert, code: 'UR_ALTA', pumpId: 'B2', detail: 'UR >=98% por 30 minutos.', endedAt: null }),
  sample('alert-resolved', 'events', { ...esp('event'), eventType: 'alert', phase: 'resolved', ...alert, occurredAt: '2026-11-06T12:05:00Z', endedAt: '2026-11-06T12:05:00Z' }),
  sample('fsm-transition', 'events', { ...esp('event'), eventType: 'fsm_transition', machine: 'irrigation', fromState: 'IDLE', toState: 'RUNNING', reason: 'Solo abaixo do mínimo.' }),
  sample('calibration', 'events', { ...esp('event'), eventType: 'calibration', calibrationId: id(3), adcDry: 3000, adcWater: 1200 }),
];
