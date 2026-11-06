import type { Alert, DeviceEvent, DeviceHistory, Telemetry } from '../../api/src/contracts';
import { CONFIG_FIELDS } from '../../api/src/controlConfig';

export type HistoryCategory = 'readings' | 'B1' | 'B2' | 'alerts' | 'configuration' | 'system';
export type HistoryPeriod = 'hour' | 'today' | 'all';
export type SensorKey = 'airTemperatureC' | 'airHumidityPercent' | 'soilMoisturePercent' | 'substrateTemperatureC' | 'waterLevel';
export const sensors: { key: SensorKey; label: string; unit: string; quality?: keyof Pick<Telemetry, 'dhtReliable' | 'soilReliable' | 'rootReliable'> }[] = [
  { key: 'airTemperatureC', label: 'Temperatura do ar', unit: ' °C', quality: 'dhtReliable' },
  { key: 'airHumidityPercent', label: 'Umidade do ar', unit: '%', quality: 'dhtReliable' },
  { key: 'soilMoisturePercent', label: 'Umidade do solo', unit: '%', quality: 'soilReliable' },
  { key: 'substrateTemperatureC', label: 'Temperatura do substrato', unit: ' °C', quality: 'rootReliable' },
  { key: 'waterLevel', label: 'Reservatório', unit: '' },
];
export interface DetailField { label: string; value: string }
export interface HistoryRow { id: string; time: string; title: string; summary: string; state?: string; details: DetailField[] }
export const severityLabel = { critical: 'Crítico', warning: 'Atenção', info: 'Informação' };
const severityOrder = { critical: 0, warning: 1, info: 2 };
export function sortedActiveAlerts(alerts: Alert[]) {
  return alerts.filter(a => !a.endedAt).sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || Date.parse(b.startedAt) - Date.parse(a.startedAt));
}
export function dateLabel(time: string, timeZone: string, includeTime = true) {
  if (!Number.isFinite(Date.parse(time))) return 'Horário indisponível';
  return new Date(time).toLocaleString('pt-BR', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric', ...(includeTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } as const : {}) });
}
function startOfPeriod(period: HistoryPeriod, now: number, timeZone: string) {
  if (period === 'all') return -Infinity;
  if (period === 'hour') return now - 3600_000;
  // Find local midnight using calendar parts, respecting the device's timezone.
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const part = (name: string) => Number(parts.find(p => p.type === name)?.value ?? 0);
  return now - (part('hour') * 3600 + part('minute') * 60 + part('second')) * 1000 - now % 1000;
}
export function alertDetails(alert: Alert, timeZone: string): DetailField[] {
  return [
    { label: 'Situação', value: alert.endedAt ? 'Resolvido' : 'Ativo' },
    { label: 'Prioridade', value: severityLabel[alert.severity] },
    { label: 'O que fazer', value: alert.suggestedAction },
    { label: 'Início', value: dateLabel(alert.startedAt, timeZone) },
    { label: 'Resolução', value: alert.endedAt ? dateLabel(alert.endedAt, timeZone) : 'A condição continua ativa' },
    { label: 'Reconhecimento', value: alert.acknowledgedAt ? dateLabel(alert.acknowledgedAt, timeZone) : 'Ainda não reconhecido' },
    { label: 'Código', value: alert.code },
  ];
}
const eventLabel: Record<DeviceEvent['kind'], string> = {
  actuation: 'Acionamento', command: 'Comando', mode_change: 'Mudança de modo', alert: 'Alerta',
  reading: 'Leitura', configuration: 'Configuração', simulation: 'Simulação',
};
const commandLabel = { accepted: 'Aceito', completed: 'Concluído', rejected: 'Recusado', expired: 'Expirado' };
const originLabel = { simulator: 'Simulador', operator: 'Operador', esp32: 'ESP32' };
export function historyRows(data: DeviceHistory, category: HistoryCategory, sensorKey: SensorKey, period: HistoryPeriod, now: number, timeZone: string): HistoryRow[] {
  const from = startOfPeriod(period, now, timeZone);
  const inPeriod = (time: string) => Date.parse(time) >= from && Date.parse(time) <= now;
  let rows: HistoryRow[];
  if (category === 'readings') {
    const sensor = sensors.find(s => s.key === sensorKey)!;
    rows = data.telemetry.filter(t => inPeriod(t.occurredAt)).map(t => {
      const raw = t[sensorKey];
      const valid = raw !== null && (!sensor.quality || t[sensor.quality]);
      const value = !valid ? 'Sem leitura confiável' : sensorKey === 'waterLevel' ? raw === 'OK' ? 'Nível adequado' : 'Nível baixo' : `${Number(raw).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${sensor.unit}`;
      return { id: t.id, time: t.occurredAt, title: value, summary: sensor.label, details: [
        { label: sensor.label, value }, { label: 'Qualidade', value: valid ? 'Leitura confiável' : 'Sensor indisponível' },
        { label: 'Registrada em', value: dateLabel(t.occurredAt, timeZone) },
        { label: 'Relógio', value: t.clockReliable ? 'Hora confiável' : 'Hora do dispositivo não confiável' },
        ...(sensorKey === 'waterLevel' ? [{ label: 'Medição', value: 'Indicação da boia. Não representa percentual de água.' }] : []),
      ] };
    });
  } else if (category === 'alerts') {
    rows = data.alerts.filter(a => Date.parse(a.startedAt) <= now && (!a.endedAt || Date.parse(a.endedAt) >= from)).map(a => ({
      id: a.id, time: a.startedAt, title: a.title, summary: severityLabel[a.severity], state: a.endedAt ? 'Resolvido' : 'Ativo', details: alertDetails(a, timeZone),
    }));
  } else {
    rows = data.events.filter(e => inPeriod(e.occurredAt) && (category === 'B1' || category === 'B2' ? e.pumpId === category : category === 'configuration' ? e.kind === 'configuration' : !e.pumpId && !['reading', 'alert', 'configuration'].includes(e.kind))).map(e => ({
      id: e.id, time: e.occurredAt, title: e.description, summary: eventLabel[e.kind],
      state: e.commandStatus ? commandLabel[e.commandStatus] : undefined,
      details: [
        { label: 'Registro', value: e.description }, { label: 'Tipo', value: eventLabel[e.kind] },
        { label: 'Data e hora', value: dateLabel(e.occurredAt, timeZone) }, { label: 'Origem', value: originLabel[e.origin] },
        ...(e.outputOn !== undefined ? [{ label: 'Saída observada naquele instante', value: e.outputOn ? 'Ligada' : 'Desligada' }] : []),
        ...(e.commandStatus ? [{ label: 'Resultado do comando', value: commandLabel[e.commandStatus] }] : []),
        ...(e.commandId ? [{ label: 'Identificador do comando', value: e.commandId }] : []),
        ...(e.appliedConfig ? [
          ...CONFIG_FIELDS.map(field => ({ label: field.label, value: `${e.appliedConfig![field.key]} ${field.unit}` })),
          { label: 'Janela da irrigação', value: e.appliedConfig.irrigationWindowEnabled ? `${e.appliedConfig.irrigationWindowStart}–${e.appliedConfig.irrigationWindowEnd}` : 'Sem restrição de horário' },
          { label: 'Horários de reserva', value: e.appliedConfig.irrigationSchedule.map(row => `${row.time} · ${row.durationSeconds} s · ${row.enabled ? 'habilitado' : 'desativado'}`).join('\n') || 'Sem horários cadastrados' },
        ] : []),
      ],
    }));
  }
  return rows.sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}
