import type { Config } from './contracts.js';

export const DEFAULT_CONFIG: Config = {
  soilMinPercent: 60, soilMaxPercent: 75, fogTemperatureOnC: 28, fogHumidityMinPercent: 50,
  fogHumidityBlockPercent: 90, emergencyTemperatureC: 35, fogPulseSeconds: 60,
  fogPauseSeconds: 300, lowWaterBlocksPumps: true,
  irrigationMaxSeconds: 300, irrigationCooldownMinutes: 10, irrigationMaxCyclesPerDay: 20,
  irrigationWindowEnabled: false, irrigationWindowStart: '06:00', irrigationWindowEnd: '17:00',
  irrigationSchedule: ['07:00', '12:00', '16:00'].map(time => ({ time, durationSeconds: 60, enabled: true })),
  fogHysteresisC: 3, rootAlertTemperatureC: 26, manualIrrigationSeconds: 120, manualFogSeconds: 30,
};

export type NumericConfigKey = { [K in keyof Config]: Config[K] extends number ? K : never }[keyof Config];
export const CONFIG_FIELDS: { key: NumericConfigKey; label: string; unit: string; min: number; max: number; integer?: boolean; group: 'irrigation' | 'fog' | 'manual' | 'root' }[] = [
  { key: 'soilMinPercent', label: 'Ligar abaixo de', unit: '% de umidade do solo', min: 30, max: 80, group: 'irrigation' },
  { key: 'soilMaxPercent', label: 'Desligar ao atingir', unit: '% de umidade do solo', min: 50, max: 95, group: 'irrigation' },
  { key: 'irrigationMaxSeconds', label: 'Tempo máximo por ciclo', unit: 's', min: 30, max: 300, integer: true, group: 'irrigation' },
  { key: 'irrigationCooldownMinutes', label: 'Espera entre ciclos', unit: 'min', min: 5, max: 30, integer: true, group: 'irrigation' },
  { key: 'irrigationMaxCyclesPerDay', label: 'Máximo de ciclos por dia', unit: 'ciclos', min: 5, max: 40, integer: true, group: 'irrigation' },
  { key: 'fogTemperatureOnC', label: 'Ligar por temperatura a partir de', unit: '°C', min: 22, max: 40, group: 'fog' },
  { key: 'fogHysteresisC', label: 'Redução de temperatura para desligar', unit: '°C de histerese', min: 1, max: 6, group: 'fog' },
  { key: 'fogHumidityMinPercent', label: 'Ligar por umidade do ar abaixo de', unit: '% de UR', min: 30, max: 70, group: 'fog' },
  { key: 'fogHumidityBlockPercent', label: 'Bloquear névoa por UR a partir de', unit: '% de UR', min: 80, max: 98, group: 'fog' },
  { key: 'fogPulseSeconds', label: 'Duração máxima do pulso', unit: 's', min: 10, max: 60, integer: true, group: 'fog' },
  { key: 'fogPauseSeconds', label: 'Pausa entre pulsos', unit: 's (múltiplos de 60)', min: 60, max: 1800, integer: true, group: 'fog' },
  { key: 'emergencyTemperatureC', label: 'Emergência de calor a partir de', unit: '°C', min: 30, max: 45, group: 'fog' },
  { key: 'rootAlertTemperatureC', label: 'Alertar temperatura do substrato acima de', unit: '°C', min: 20, max: 35, group: 'root' },
  { key: 'manualIrrigationSeconds', label: 'Tempo manual padrão de B1', unit: 's', min: 10, max: 300, integer: true, group: 'manual' },
  { key: 'manualFogSeconds', label: 'Tempo manual padrão de B2', unit: 's', min: 5, max: 60, integer: true, group: 'manual' },
];
export function isTime(value: unknown): value is string { return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
export function inIrrigationWindow(time: string, config: Config) {
  if (!config.irrigationWindowEnabled) return true;
  return config.irrigationWindowStart < config.irrigationWindowEnd
    ? time >= config.irrigationWindowStart && time < config.irrigationWindowEnd
    : time >= config.irrigationWindowStart || time < config.irrigationWindowEnd;
}
export function configError(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Configuração inválida.';
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !Object.hasOwn(DEFAULT_CONFIG, key))) return 'A configuração contém um campo desconhecido.';
  for (const field of CONFIG_FIELDS) {
    const n = value[field.key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < field.min || n > field.max || (field.integer && !Number.isInteger(n))) return `${field.label}: informe ${field.integer ? 'um inteiro' : 'um número'} entre ${field.min} e ${field.max} ${field.unit}.`;
  }
  if ((value.soilMaxPercent as number) < (value.soilMinPercent as number) + 5) return 'O máximo do solo deve ser pelo menos 5 pontos maior que o mínimo.';
  if ((value.fogPauseSeconds as number) % 60 !== 0) return 'A pausa da névoa deve ser um múltiplo de 60 s, compatível com os minutos inteiros do banco.';
  if (value.lowWaterBlocksPumps !== true) return 'O bloqueio por falta de água deve permanecer ativo.';
  if (typeof value.irrigationWindowEnabled !== 'boolean' || !isTime(value.irrigationWindowStart) || !isTime(value.irrigationWindowEnd)) return 'Informe horários da janela no formato HH:mm.';
  if (value.irrigationWindowEnabled && value.irrigationWindowStart === value.irrigationWindowEnd) return 'O início e o fim da janela precisam ser diferentes.';
  if (!Array.isArray(value.irrigationSchedule)) return 'A agenda de reserva deve ser uma lista.';
  if (value.irrigationSchedule.length > 24) return 'A agenda de reserva aceita até 24 horários.';
  const times = new Set<string>();
  for (const row of value.irrigationSchedule) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !['time', 'durationSeconds', 'enabled'].includes(key))) return 'Horário de reserva inválido.';
    if (!isTime(row.time) || typeof row.enabled !== 'boolean' || !Number.isInteger(row.durationSeconds) || row.durationSeconds < 1 || row.durationSeconds > 300) return 'Cada horário exige HH:mm, duração inteira de 1 a 300 s e indicação de habilitado.';
    if (times.has(row.time)) return `Horário de reserva duplicado: ${row.time}.`;
    times.add(row.time);
  }
  return null;
}

export function localTimeParts(time: number, timeZone = 'America/Sao_Paulo') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(time);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}
