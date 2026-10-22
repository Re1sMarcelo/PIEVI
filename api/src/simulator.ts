import { randomUUID } from 'node:crypto';
import type {
  Alert,
  CommandRequest,
  CommandResult,
  Config,
  DeviceEvent,
  PumpId,
  PumpState,
  Snapshot,
  Telemetry,
} from './contracts.js';

export const DEVICE_ID = 'bancada-01';

const now = () => new Date().toISOString();

export class Simulator {
  private sequence = 0;
  private telemetry: Telemetry[] = [];
  private events: DeviceEvent[] = [];
  private alerts: Alert[] = [];
  private commands = new Map<string, CommandResult>();
  private pumps: Record<PumpId, PumpState> = {
    B1: { id: 'B1', mode: 'AUTO', isOn: false, expiresAt: null },
    B2: { id: 'B2', mode: 'AUTO', isOn: false, expiresAt: null },
  };
  private config: Config = {
    soilMinPercent: 60,
    soilMaxPercent: 75,
    fogTemperatureOnC: 28,
    fogHumidityMinPercent: 50,
    fogHumidityBlockPercent: 90,
    emergencyTemperatureC: 35,
    fogPulseSeconds: 60,
    fogPauseSeconds: 300,
    lowWaterBlocksPumps: true,
  };

  constructor() {
    this.recordTelemetry();
    this.alerts.push({
      id: randomUUID(),
      deviceId: DEVICE_ID,
      code: 'TEMP_RAIZ_ALTA',
      severity: 'warning',
      title: 'Temperatura da raiz elevada',
      suggestedAction: 'Verifique a ventilação e o sombreamento do substrato.',
      startedAt: new Date(Date.now() - 3_600_000).toISOString(),
      endedAt: null,
      acknowledgedAt: null,
    });
    this.addEvent('alert', 'TEMP_RAIZ_ALTA detectado; nenhuma bomba é acionada.', 'simulator');
  }

  private addEvent(kind: DeviceEvent['kind'], description: string, origin: DeviceEvent['origin']) {
    this.events.unshift({ id: randomUUID(), deviceId: DEVICE_ID, occurredAt: now(), kind, description, origin });
    this.events = this.events.slice(0, 200);
  }

  recordTelemetry() {
    this.sequence += 1;
    const wave = Math.sin(this.sequence / 5);
    this.telemetry.unshift({
      id: randomUUID(),
      deviceId: DEVICE_ID,
      occurredAt: now(),
      airTemperatureC: Number((26.4 + wave * 0.4).toFixed(1)),
      airHumidityPercent: Number((62 + wave * 1.5).toFixed(1)),
      substrateTemperatureC: Number((26.4 + wave * 0.2).toFixed(1)),
      soilMoisturePercent: Number((67 + wave * 0.5).toFixed(1)),
      waterLevel: 'OK',
      dhtReliable: true,
    });
    this.telemetry = this.telemetry.slice(0, 200);
    if (this.sequence % 4 === 0) this.addEvent('reading', 'Nova leitura recebida da bancada simulada.', 'simulator');
    this.expireModes();
  }

  private expireModes() {
    const current = Date.now();
    for (const pump of Object.values(this.pumps)) {
      if (pump.expiresAt && Date.parse(pump.expiresAt) <= current) {
        pump.mode = 'AUTO';
        pump.isOn = false;
        pump.expiresAt = null;
        this.addEvent('mode_change', `${pump.id} voltou a AUTO após expiração do modo manual.`, 'simulator');
      }
    }
    for (const command of this.commands.values()) {
      if (command.status === 'accepted' && command.completedAt === null) {
        const pump = this.pumps[command.pumpId];
        if (pump.mode === 'AUTO' && command.action !== 'AUTO') {
          command.status = 'completed';
          command.completedAt = now();
        }
      }
    }
  }

  getSnapshot(): Snapshot {
    this.expireModes();
    return {
      deviceId: DEVICE_ID,
      online: true,
      lastSeenAt: this.telemetry[0].occurredAt,
      simulation: true,
      telemetry: this.telemetry[0],
      pumps: structuredClone(this.pumps),
      activeAlerts: this.alerts.filter((alert) => !alert.endedAt),
      config: { ...this.config },
    };
  }

  getTelemetry() { return this.telemetry.slice(); }
  getEvents() { this.expireModes(); return this.events.slice(); }
  getAlerts() { return this.alerts.slice(); }
  getConfig() { return { ...this.config }; }
  getCommand(id: string) { this.expireModes(); return this.commands.get(id); }

  acknowledgeAlert(id: string): Alert | null {
    const alert = this.alerts.find((item) => item.id === id);
    if (!alert) return null;
    alert.acknowledgedAt ??= now();
    return alert;
  }

  updateConfig(input: Partial<Config>): Config | null {
    const allowed = ['soilMinPercent', 'soilMaxPercent', 'fogTemperatureOnC', 'fogHumidityMinPercent', 'fogHumidityBlockPercent', 'emergencyTemperatureC', 'fogPulseSeconds', 'fogPauseSeconds'] as const;
    if (Object.keys(input).some((key) => !allowed.includes(key as typeof allowed[number]))) return null;
    const next = { ...this.config, ...input };
    if (allowed.some((key) => typeof next[key] !== 'number' || !Number.isFinite(next[key]))) return null;
    if (next.soilMinPercent < 30 || next.soilMinPercent > 80 || next.soilMaxPercent < next.soilMinPercent + 5 || next.soilMaxPercent > 95) return null;
    if (next.fogTemperatureOnC < 22 || next.fogTemperatureOnC > 40 || next.fogHumidityMinPercent < 30 || next.fogHumidityMinPercent > 70) return null;
    if (next.fogHumidityBlockPercent < 80 || next.fogHumidityBlockPercent > 98 || next.emergencyTemperatureC < 30 || next.emergencyTemperatureC > 45) return null;
    if (next.fogPulseSeconds < 10 || next.fogPulseSeconds > 60 || next.fogPauseSeconds < 60 || next.fogPauseSeconds > 1800) return null;
    this.config = next;
    this.addEvent('mode_change', 'Configuração simulada atualizada pelo operador.', 'operator');
    return this.getConfig();
  }

  issueCommand(input: CommandRequest): CommandResult {
    const existing = this.commands.get(input.commandId);
    if (existing) return existing;
    const createdAt = now();
    const result: CommandResult = { ...input, deviceId: DEVICE_ID, createdAt, status: 'rejected', reason: null, completedAt: null };
    const expiry = Date.parse(input.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 10_000) {
      result.status = 'expired';
      result.reason = 'Comando vencido ou validade superior a 10 segundos.';
    } else if (!['B1', 'B2'].includes(input.pumpId) || !['AUTO', 'MANUAL_ON', 'MANUAL_OFF', 'TEST'].includes(input.action)) {
      result.reason = 'Bomba ou ação inválida.';
    } else {
      const pump = this.pumps[input.pumpId];
      const duration = input.action === 'MANUAL_OFF' ? 3600 : input.action === 'TEST' ? 10 : input.durationSeconds;
      const max = input.pumpId === 'B1' ? 300 : 60;
      if (input.action === 'MANUAL_ON' && (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 1 || duration > max)) {
        result.reason = `Duração inválida: máximo de ${max} segundos para ${input.pumpId}.`;
      } else if (this.telemetry[0].waterLevel === 'LOW' && (input.action === 'MANUAL_ON' || input.action === 'TEST')) {
        result.reason = 'Nível baixo bloqueia as bombas.';
      } else if (!this.telemetry[0].dhtReliable && input.pumpId === 'B2' && (input.action === 'MANUAL_ON' || input.action === 'TEST')) {
        result.reason = 'DHT22 sem leitura confiável; B2 bloqueada.';
      } else {
        pump.mode = input.action === 'TEST' ? 'MANUAL_ON' : input.action;
        pump.isOn = input.action === 'MANUAL_ON' || input.action === 'TEST';
        pump.expiresAt = input.action === 'AUTO' ? null : new Date(Date.now() + (duration ?? 0) * 1000).toISOString();
        result.status = 'accepted';
        this.addEvent('command', `${input.action} confirmado para ${input.pumpId}${duration ? ` por ${duration} s` : ''}.`, 'operator');
      }
    }
    this.commands.set(input.commandId, result);
    return result;
  }
}
