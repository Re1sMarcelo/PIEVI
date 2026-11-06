import type { Config, IrrigationSchedule, PumpId, Snapshot, CommandAction } from '../../api/src/contracts';
import { CONFIG_FIELDS, configError, localTimeParts, type NumericConfigKey } from '../../api/src/controlConfig';
import { hasRecentState, pumpControlBlock } from './dashboardModel';

export interface ControlDraft {
  numbers: Record<NumericConfigKey, string>;
  windowEnabled: boolean; windowStart: string; windowEnd: string;
  schedule: { key: string; time: string; duration: string; enabled: boolean }[];
}
export function createControlDraft(config: Config): ControlDraft {
  return { numbers: Object.fromEntries(CONFIG_FIELDS.map(f => [f.key, String(config[f.key])])) as Record<NumericConfigKey, string>,
    windowEnabled: config.irrigationWindowEnabled, windowStart: config.irrigationWindowStart, windowEnd: config.irrigationWindowEnd,
    schedule: config.irrigationSchedule.map((row, index) => ({ key: `${index}-${row.time}`, time: row.time, duration: String(row.durationSeconds), enabled: row.enabled })) };
}
export function parseNumber(text: string) {
  const normalized = text.trim().replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(normalized) ? Number(normalized) : NaN;
}
export function parseControlDraft(draft: ControlDraft, applied: Config): { config?: Config; error?: string } {
  const values = Object.fromEntries(CONFIG_FIELDS.map(f => [f.key, parseNumber(draft.numbers[f.key])])) as Pick<Config, NumericConfigKey>;
  const schedule: IrrigationSchedule[] = draft.schedule.map(row => ({ time: row.time.trim(), durationSeconds: parseNumber(row.duration), enabled: row.enabled }));
  const config: Config = { ...applied, ...values, irrigationWindowEnabled: draft.windowEnabled, irrigationWindowStart: draft.windowStart.trim(), irrigationWindowEnd: draft.windowEnd.trim(), irrigationSchedule: schedule };
  const error = configError(config);
  return error ? { error } : { config };
}
export function controlBlock(snapshot: Snapshot, id: PumpId, action: CommandAction, connected: boolean, clock: number) {
  if (!hasRecentState(snapshot, connected, clock)) return 'Aguarde um estado recente do dispositivo.';
  if (!snapshot.telemetry.clockReliable) return 'O relógio precisa de hora confiável para validar o comando.';
  if (action === 'AUTO' || action === 'MANUAL_OFF' || action === 'RESET_FAULT') return null;
  const other = snapshot.pumps[id === 'B1' ? 'B2' : 'B1'];
  if (other.floatOverrideUntil && Date.parse(other.floatOverrideUntil) > clock) return 'A outra bomba está em teste supervisionado.';
  if (action === 'IGNORE_FLOAT') {
    if (other.isOn) return 'Desligue a outra bomba antes deste teste.';
    const withoutWaterBlock = { ...snapshot, telemetry: { ...snapshot.telemetry, waterLevel: 'OK' as const } };
    return pumpControlBlock(withoutWaterBlock, id, connected, clock);
  }
  return pumpControlBlock(snapshot, id, connected, clock);
}
export function nextMinuteTime(clock: number, timeZone: string) { return localTimeParts(clock + 60_000, timeZone).time; }
