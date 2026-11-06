// Canonical, language-neutral contract. Export JSON with npm run contract:export -w api.
import { CONFIG_FIELDS } from '../controlConfig.js';

type Schema = Record<string, unknown>;
const object = (properties: Record<string, Schema>) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const text = (maxLength = 256): Schema => ({ type: 'string', minLength: 1, maxLength });
const integer = (minimum: number, maximum = 2147483647): Schema => ({ type: 'integer', minimum, maximum });
const choice = (...values: (string | boolean | number | null)[]): Schema => ({ enum: values });
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });
const bool: Schema = { type: 'boolean' };
const uuid: Schema = { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' };
const timestamp: Schema = { type: 'string', format: 'date-time', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{3})?Z$' };
const deviceId: Schema = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,62}$' };
const externalId: Schema = { type: 'string', minLength: 8, maxLength: 100, pattern: '^[A-Za-z0-9:_-]+$' };
const pumpId = choice('B1', 'B2');
const number = (minimum: number, maximum: number): Schema => ({ type: 'number', minimum, maximum, multipleOf: 0.1 });
const temp = nullable(number(-10, 60));
const percent = nullable(number(0, 100));
export const ALERT_CODES = ['NIVEL_BAIXO', 'TEMP_RAIZ_ALTA', 'CALOR_EMERG', 'GEADA', 'UR_ALTA', 'DHT_FALHA', 'DS18_FALHA', 'SOLO_FALHA', 'BOIA_SUSPEITA', 'IRRIG_FALHA', 'NEVOA_FALHA', 'BICO_ENTUPIDO', 'VAZAMENTO_SUSPEITO', 'BOMBA_PRESA', 'BOMBA_TEMPO_EXCEDIDO', 'REINICIO', 'OFFLINE', 'HORA_INVALIDA', 'CONFIG_INVALIDA', 'MODO_MANUAL'] as const;
export const PUMP_FSM = ['IDLE', 'RUNNING', 'PAUSED', 'MANUAL_ON', 'MANUAL_OFF', 'BLOCKED', 'FAULT'] as const;
const esp = (type: string) => ({ schemaVersion: { const: 1 }, type: { const: type }, deviceId,
  bootId: uuid, bootNumber: integer(1), connectionId: uuid, sequence: integer(1), messageId: text(60),
  uptimeMs: integer(0, Number.MAX_SAFE_INTEGER), clockReliable: bool, occurredAt: nullable(timestamp) });
const backend = (type: string) => ({ schemaVersion: { const: 1 }, type: { const: type }, deviceId, messageId: uuid, createdAt: timestamp, expiresAt: timestamp });
const target = { targetBootId: uuid, targetBootNumber: integer(1), targetConnectionId: uuid };
const measurements = object({ airTemperatureC: temp, airHumidityPercent: percent, soilMoisturePercent: percent });
const alertFields = { episodeId: uuid, code: choice(...ALERT_CODES.filter(c => c !== 'OFFLINE')), pumpId: nullable(pumpId),
  severity: choice('info', 'warning', 'critical'), startedAt: nullable(timestamp), detail: { type: 'string', maxLength: 256 } };
const pump = object({ mode: choice('AUTO', 'MANUAL_ON', 'MANUAL_OFF'), isOn: bool, fsmState: choice(...PUMP_FSM),
  modeStartedAt: nullable(timestamp), expiresAt: nullable(timestamp), remainingSeconds: nullable(integer(0, 3600)),
  blockedReason: nullable(text()), faultCode: nullable(choice('IRRIG_FALHA', 'NEVOA_FALHA', 'BOMBA_PRESA')),
  floatOverrideUntil: nullable(timestamp), feedback: choice('relay_output', 'independent_sensor') });

export const configSchema = object({
  ...Object.fromEntries(CONFIG_FIELDS.map(field => [field.key, { type: field.integer ? 'integer' : 'number', minimum: field.min, maximum: field.max, ...(field.key === 'fogPauseSeconds' ? { multipleOf: 60 } : {}) }])),
  lowWaterBlocksPumps: { const: true }, irrigationWindowEnabled: bool,
  irrigationWindowStart: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
  irrigationWindowEnd: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
  irrigationSchedule: { type: 'array', maxItems: 24, items: object({ time: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }, durationSeconds: integer(1, 300), enabled: bool }) },
});
const pumpCommand = (action: string, durationSeconds: Schema, supervisionConfirmed = false) => object({
  ...backend('command'), ...target, commandId: externalId, action: { const: action }, pumpId,
  durationSeconds, supervisionConfirmed: { const: supervisionConfirmed },
});
export const MQTT_SCHEMAS = {
  telemetry: object({ ...esp('telemetry'), airTemperatureC: temp, airHumidityPercent: percent, substrateTemperatureC: temp,
    soilMoisturePercent: percent, soilMoistureAdc: nullable(integer(0, 4095)), waterLevel: choice('OK', 'LOW'),
    dhtReliable: bool, soilReliable: bool, rootReliable: bool, activeCalibrationId: nullable(uuid) }),
  state: object({ ...esp('state'), syncId: nullable(uuid), activeConfigVersion: integer(0), firmwareVersion: text(64), droppedMessages: integer(0),
    pumps: object({ B1: pump, B2: pump }), activeAlerts: { type: 'array', maxItems: 64, items: object(alertFields) } }),
  events: { oneOf: [
    object({ ...esp('event'), eventType: { const: 'cycle' }, phase: choice('started', 'finished'), cycleId: uuid, pumpId,
      source: choice('auto', 'manual', 'fallback', 'emergency', 'test'), commandId: nullable(externalId), reason: text(),
      startedAt: nullable(timestamp), endedAt: nullable(timestamp), elapsedSeconds: nullable({ type: 'number', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      measurementsBefore: measurements, measurementsAfter: nullable(measurements) }),
    object({ ...esp('event'), eventType: { const: 'alert' }, phase: choice('opened', 'updated', 'resolved'), ...alertFields, endedAt: nullable(timestamp) }),
    object({ ...esp('event'), eventType: { const: 'fsm_transition' }, machine: choice('irrigation', 'fog', 'substrate'),
      fromState: nullable(choice(...PUMP_FSM, 'NORMAL', 'HIGH', 'SENSOR_FAULT')), toState: choice(...PUMP_FSM, 'NORMAL', 'HIGH', 'SENSOR_FAULT'), reason: text() }),
    object({ ...esp('event'), eventType: { const: 'calibration' }, calibrationId: uuid, adcDry: integer(0, 4095), adcWater: integer(0, 4095) }),
  ] },
  acks: object({ ...esp('ack'), commandId: externalId, status: choice('accepted', 'rejected', 'completed'),
    reason: nullable(text()), appliedConfigVersion: nullable(integer(1)) }),
  presence: object({ schemaVersion: { const: 1 }, type: { const: 'presence' }, deviceId, bootId: uuid, bootNumber: integer(1), connectionId: uuid, online: bool }),
  commands: { oneOf: [
    pumpCommand('MANUAL_ON', integer(1, 300)), pumpCommand('MANUAL_OFF', { const: 3600 }), pumpCommand('TEST', { const: 10 }),
    pumpCommand('AUTO', { type: 'null' }), pumpCommand('RESET_FAULT', { type: 'null' }), pumpCommand('IGNORE_FLOAT', integer(1, 120), true),
    object({ ...backend('command'), ...target, commandId: externalId, action: { const: 'APPLY_CONFIG' }, pumpId: { type: 'null' },
      durationSeconds: { type: 'null' }, supervisionConfirmed: { const: false }, configVersion: integer(1), timeZone: { const: 'America/Sao_Paulo' }, config: configSchema }),
  ] },
  sync: object({ ...backend('sync'), syncId: uuid }),
  receipts: object({ schemaVersion: { const: 1 }, type: { const: 'receipt' }, deviceId, messageId: uuid,
    sourceMessageId: text(60), sourceBootId: uuid, sourceBootNumber: integer(1),
    status: choice('stored', 'duplicate', 'rejected'), reason: nullable(text()), processedAt: timestamp }),
} as const;
export type MqttChannel = keyof typeof MQTT_SCHEMAS;
export const MQTT_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'urn:pievi:mqtt:1',
  title: 'PIEVI MQTT v1',
  description: 'Payloads somente. As regras semânticas, de identidade e sessão estão em docs/contrato-mqtt-v1.md e protocol.ts.',
  definitions: MQTT_SCHEMAS,
  oneOf: Object.keys(MQTT_SCHEMAS).map(channel => ({ $ref: `#/definitions/${channel}` })),
};
