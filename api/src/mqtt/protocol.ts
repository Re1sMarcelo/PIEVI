import { Ajv } from 'ajv';
import { configError } from '../controlConfig.js';
import { MQTT_SCHEMA, MQTT_SCHEMAS, type MqttChannel } from './schema.js';

export const MQTT_MAX_PAYLOAD_BYTES = 32768;
export const MQTT_POLICY = { qos: 1 as const, heartbeatSeconds: 15, offlineSeconds: 45, requestValiditySeconds: 10, keepaliveSeconds: 30 };
export function mqttTopic(deviceId: string, channel: MqttChannel) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(deviceId)) throw new Error('deviceId inválido.');
  return `pievi/v1/devices/${deviceId}/${channel}`;
}
export function mqttTopicParts(topic: string): { deviceId: string; channel: MqttChannel } | null {
  const match = /^pievi\/v1\/devices\/([a-z0-9][a-z0-9-]{0,62})\/([a-z]+)$/.exec(topic);
  return match && Object.hasOwn(MQTT_SCHEMAS, match[2]) ? { deviceId: match[1], channel: match[2] as MqttChannel } : null;
}
const ajv = new Ajv({ strict: true, allErrors: false, multipleOfPrecision: 8 });
ajv.addFormat('date-time', {
  type: 'string', validate: (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19),
});
ajv.addSchema(MQTT_SCHEMA);
const validators = Object.fromEntries(Object.keys(MQTT_SCHEMAS).map(channel => [channel, ajv.compile({ $ref: `urn:pievi:mqtt:1#/definitions/${channel}` })]));
type Payload = Record<string, any>;
export type ValidationResult = { ok: true; channel: MqttChannel; deviceId: string; payload: Payload } | { ok: false; error: string };
function semanticError(p: Payload, channel: MqttChannel): string | null {
  if (['telemetry', 'state', 'events', 'acks'].includes(channel)) {
    if (p.messageId !== `${p.bootId}:${p.sequence}`) return 'messageId deve ser bootId:sequence.';
    if (p.clockReliable !== (p.occurredAt !== null)) return 'occurredAt deve ser UTC com hora confiável, ou null sem ela.';
  }
  if (channel === 'telemetry') {
    if (p.dhtReliable ? p.airTemperatureC === null || p.airHumidityPercent === null : p.airTemperatureC !== null || p.airHumidityPercent !== null) return 'DHT22: valores e qualidade incompatíveis.';
    if (p.soilReliable !== (p.soilMoisturePercent !== null) || p.rootReliable !== (p.substrateTemperatureC !== null)) return 'Solo/substrato: valor e qualidade incompatíveis.';
    if (p.soilReliable && p.activeCalibrationId === null) return 'Solo confiável exige identificação da calibração.';
  }
  if (channel === 'commands' || channel === 'sync') {
    const ttl = Date.parse(p.expiresAt) - Date.parse(p.createdAt);
    if (ttl <= 0 || ttl > 10000) return 'Validade deve ser positiva e de até 10 segundos.';
    if (channel === 'commands') {
      if (p.pumpId === 'B2' && p.durationSeconds > 60 && p.action !== 'MANUAL_OFF') return 'B2 tem teto de 60 segundos.';
      if (p.action === 'APPLY_CONFIG') return configError(p.config);
    }
  }
  if (channel === 'state') {
    const episodes = new Set<string>(); const slots = new Set<string>();
    for (const alert of p.activeAlerts) {
      const slot = `${alert.code}/${alert.pumpId}`;
      if (episodes.has(alert.episodeId) || slots.has(slot)) return 'Alerta ativo duplicado.';
      episodes.add(alert.episodeId); slots.add(slot);
    }
    for (const id of ['B1', 'B2']) {
      const pump = p.pumps[id];
      if (pump.mode === 'AUTO') {
        if (pump.modeStartedAt !== null || pump.expiresAt !== null || pump.remainingSeconds !== null || pump.floatOverrideUntil !== null) return 'AUTO não possui temporizador manual.';
      } else {
        if (!p.clockReliable || pump.modeStartedAt === null || pump.expiresAt === null || pump.remainingSeconds === null) return 'Modo manual exige hora e temporizador confiáveis.';
        const duration = (Date.parse(pump.expiresAt) - Date.parse(pump.modeStartedAt)) / 1000;
        const limit = pump.mode === 'MANUAL_OFF' ? 3600 : id === 'B1' ? 300 : 60;
        if (duration <= 0 || duration > limit || pump.remainingSeconds > limit) return 'Temporizador manual excede o teto.';
      }
      if (pump.floatOverrideUntil !== null && (pump.mode !== 'MANUAL_ON' || Date.parse(pump.floatOverrideUntil) > Date.parse(pump.expiresAt) || Date.parse(pump.floatOverrideUntil) - Date.parse(pump.modeStartedAt) > (id === 'B1' ? 120000 : 60000))) return 'Exceção da boia incompatível com o modo/prazo.';
    }
  }
  if (channel === 'acks') {
    if (p.status === 'rejected' && (p.reason === null || !p.reason.trim())) return 'Recusa exige motivo.';
    if (p.appliedConfigVersion !== null && p.status !== 'completed') return 'Versão aplicada somente em confirmação concluída.';
  }
  if (channel === 'receipts') {
    if (!p.sourceMessageId.startsWith(`${p.sourceBootId}:`) || !/^[1-9][0-9]{0,9}$/.test(p.sourceMessageId.slice(37)) || Number(p.sourceMessageId.slice(37)) > 2147483647) return 'Recibo deve identificar uma mensagem do boot de origem.';
    if (p.status === 'rejected' && (p.reason === null || !p.reason.trim())) return 'Recibo de rejeição exige motivo.';
  }
  if (channel === 'events') {
    if (p.eventType === 'cycle') {
      if (p.phase === 'started' && (p.endedAt !== null || p.elapsedSeconds !== null || p.measurementsAfter !== null)) return 'Início de ciclo não possui término.';
      if (p.phase === 'finished' && (p.elapsedSeconds === null || p.measurementsAfter === null)) return 'Fim exige duração monotônica e medições finais.';
      if (p.phase === 'finished' && p.clockReliable && p.endedAt === null) return 'Ciclo concluído com hora confiável exige fim UTC.';
      if (p.startedAt !== null && p.endedAt !== null && Date.parse(p.endedAt) < Date.parse(p.startedAt)) return 'Fim anterior ao início.';
      if (['manual', 'test'].includes(p.source) !== (p.commandId !== null)) return 'Origem manual/teste exige commandId; automação não possui comando.';
    }
    if (p.eventType === 'alert') {
      if (p.phase !== 'resolved' && p.endedAt !== null) return 'Alerta ativo não possui resolução.';
      if (p.phase === 'resolved' && p.clockReliable && p.endedAt === null) return 'Resolução com hora confiável exige fim UTC.';
      if (p.startedAt !== null && p.endedAt !== null && Date.parse(p.endedAt) < Date.parse(p.startedAt)) return 'Resolução anterior à abertura.';
    }
    if (p.eventType === 'calibration' && p.adcDry === p.adcWater) return 'Calibração exige dois ADCs diferentes.';
    if (p.eventType === 'fsm_transition') {
      const root = ['NORMAL', 'HIGH', 'SENSOR_FAULT'];
      if (p.machine === 'substrate' ? !root.includes(p.toState) || p.fromState !== null && !root.includes(p.fromState) : root.includes(p.toState) || root.includes(p.fromState)) return 'Estado fora do vocabulário da máquina.';
    }
  }
  return null;
}

/** Structure only: session ordering, DB dedupe, expiry-at-receipt and hardware interlocks belong to their handlers. */
export function validateMqttPacket(topic: string, raw: string | Uint8Array, retained: boolean): ValidationResult {
  const parts = mqttTopicParts(topic);
  if (!parts) return { ok: false, error: 'Tópico fora do contrato v1.' };
  if (retained && parts.channel !== 'presence') return { ok: false, error: 'retain permitido somente para presence.' };
  const bytes = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
  if (bytes.byteLength > MQTT_MAX_PAYLOAD_BYTES || bytes.byteLength === 0) return { ok: false, error: 'Payload vazio ou acima de 32 KiB.' };
  let payload: Payload;
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return { ok: false, error: 'JSON/UTF-8 inválido.' }; }
  if (!validators[parts.channel](payload)) return { ok: false, error: `Payload incompatível com ${parts.channel}: ${ajv.errorsText(validators[parts.channel].errors)}.` };
  if (payload.deviceId !== parts.deviceId) return { ok: false, error: 'deviceId difere do tópico.' };
  const error = semanticError(payload, parts.channel);
  return error ? { ok: false, error } : { ok: true, ...parts, payload };
}
