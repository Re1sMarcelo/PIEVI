import { randomUUID } from 'node:crypto';
import type { Alert, CommandRequest, CommandResult, Config, DeviceEvent, PumpId, PumpState, Snapshot, Telemetry, SimulationScenario } from './contracts.js';
import { configError, DEFAULT_CONFIG, inIrrigationWindow, localTimeParts } from './controlConfig.js';

export const DEVICE_ID = 'bancada-01';
const scenarios: SimulationScenario[] = ['normal', 'dry_soil', 'wet_soil', 'low_water', 'heat', 'heat_humid', 'high_humidity', 'dht_failure', 'soil_failure', 'root_failure', 'offline', 'stale', 'clock_failure', 'soil_clock_failure', 'irrigation_failure', 'fog_failure'];
const commandNames = { AUTO: 'Voltar ao automático', MANUAL_ON: 'Ligar manualmente', MANUAL_OFF: 'Desligar por uma hora', TEST: 'Teste de 10 segundos', RESET_FAULT: 'Rearmar falha', IGNORE_FLOAT: 'Teste supervisionado da boia' };

export class Simulator {
  private sequence = 0;
  private telemetry: Telemetry[] = [];
  private events: DeviceEvent[] = [];
  private alerts: Alert[] = [];
  private commands = new Map<string, CommandResult>();
  private activeCommands: Partial<Record<PumpId, string>> = {};
  private scenario: SimulationScenario = 'normal';
  private lastTick = 0;
  private soil = 67;
  private dhtValidReadings = 3;
  private stops: Record<PumpId, number> = { B1: 0, B2: 0 };
  private runUntil: Record<PumpId, number> = { B1: 0, B2: 0 };
  private day = '';
  private irrigationCycles = 0;
  private humidityHighSince: number | null = null;
  private humidityCriticalSince: number | null = null;
  private soilInvalidSince: number | null = null;
  private executedSchedules = new Set<string>();
  private version = 1;
  private appliedAt = '';
  private irrigationSource: 'sensor' | 'schedule' = 'sensor';
  private clockOffset = 0;
  private onSince: Record<PumpId, number | null> = { B1: null, B2: null };
  private readonly clock: () => number;
  private pumps: Record<PumpId, PumpState> = {
    B1: { id: 'B1', mode: 'AUTO', isOn: false, expiresAt: null, blockedReason: null, faultCode: null, floatOverrideUntil: null },
    B2: { id: 'B2', mode: 'AUTO', isOn: false, expiresAt: null, blockedReason: null, faultCode: null, floatOverrideUntil: null },
  };
  private config: Config = structuredClone(DEFAULT_CONFIG);
  constructor(clock: () => number = () => Date.now()) { this.clock = () => clock() + this.clockOffset; this.appliedAt = this.iso(); this.recordTelemetry(); }
  tick() { this.evaluate(); }
  advanceTime(seconds: unknown): Snapshot | null {
    if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 1 || seconds > 3600) return null;
    for (let remaining = seconds; remaining > 0;) {
      const deadlines = Object.values(this.pumps).flatMap(pump => pump.expiresAt ? [Date.parse(pump.expiresAt)] : pump.isOn ? [this.runUntil[pump.id]] : []).filter(deadline => deadline > this.clock());
      const step = Math.min(15, remaining, ...deadlines.map(deadline => (deadline - this.clock()) / 1000));
      this.clockOffset += step * 1000; remaining -= step; this.recordTelemetry();
    }
    this.addEvent('simulation', `Relógio do simulador avançado em ${seconds} s.`, 'operator');
    return this.getSnapshot();
  }
  private iso(time = this.clock()) { return new Date(time).toISOString(); }
  private addEvent(kind: DeviceEvent['kind'], description: string, origin: DeviceEvent['origin'] = 'simulator', context: Partial<Pick<DeviceEvent, 'pumpId' | 'outputOn' | 'commandId' | 'commandStatus' | 'configVersion' | 'appliedConfig'>> = {}) {
    this.events.unshift({ id: randomUUID(), deviceId: DEVICE_ID, occurredAt: this.iso(), kind, description, origin, ...context });
    this.events = this.events.slice(0, 200);
  }
  private completeCommand(id: PumpId) {
    const commandId = this.activeCommands[id];
    const command = commandId ? this.commands.get(commandId) : undefined;
    if (command?.status === 'accepted') {
      command.status = 'completed'; command.completedAt = this.iso();
      this.addEvent('command', `${id}: comando encerrado; confira os acionamentos registrados.`, 'simulator', { pumpId: id, commandId, commandStatus: 'completed' });
    }
    delete this.activeCommands[id];
  }
  private setOutput(id: PumpId, on: boolean, reason: string) {
    const pump = this.pumps[id];
    if (pump.isOn === on) return;
    pump.isOn = on;
    this.onSince[id] = on ? this.clock() : null;
    if (!on) this.stops[id] = this.clock();
    this.addEvent('actuation', `${id} ${on ? 'ligada' : 'desligada'}: ${reason}.`, 'simulator', { pumpId: id, outputOn: on });
  }
  private alert(code: string, active: boolean, title: string, action: string, severity: Alert['severity'] = 'warning') {
    const existing = this.alerts.find(a => a.code === code && !a.endedAt);
    if (active && !existing) {
      this.alerts.unshift({ id: randomUUID(), deviceId: DEVICE_ID, code, severity, title, suggestedAction: action,
        startedAt: this.iso(), endedAt: null, acknowledgedAt: null });
      this.addEvent('alert', `${title}. ${action}`);
    } else if (!active && existing) { existing.endedAt = this.iso(); this.addEvent('alert', `${existing.title}: condição resolvida.`); }
    else if (active && existing) existing.severity = severity;
    this.alerts = [...this.alerts.filter(a => !a.endedAt), ...this.alerts.filter(a => a.endedAt).slice(0, 200)];
  }
  setScenario(value: unknown): Snapshot | null {
    if (!scenarios.includes(value as SimulationScenario)) return null;
    this.scenario = value as SimulationScenario;
    for (const id of ['B1', 'B2'] as const) {
      this.setOutput(id, false, 'troca de cenário'); this.completeCommand(id);
      this.pumps[id].mode = 'AUTO'; this.pumps[id].expiresAt = null;
      this.pumps[id].floatOverrideUntil = null;
      this.pumps[id].faultCode = null;
      this.runUntil[id] = 0; this.stops[id] = 0;
    }
    this.pumps.B1.faultCode = this.scenario === 'irrigation_failure' ? 'IRRIG_FALHA' : null;
    this.pumps.B2.faultCode = this.scenario === 'fog_failure' ? 'NEVOA_FALHA' : null;
    this.soilInvalidSince = this.scenario === 'soil_failure' || this.scenario === 'soil_clock_failure' ? this.clock() - 60_001 : null;
    this.soil = this.scenario === 'dry_soil' || this.scenario === 'irrigation_failure' ? this.config.soilMinPercent - 8 : this.scenario === 'wet_soil' ? Math.min(98, this.config.soilMaxPercent + 8) : 67;
    this.lastTick = this.clock();
    this.humidityHighSince = this.scenario === 'high_humidity' ? this.clock() - 1_800_000 : null;
    this.humidityCriticalSince = this.humidityHighSince;
    if (this.scenario === 'offline' || this.scenario === 'stale') {
      this.telemetry.unshift({ ...this.telemetry[0], id: randomUUID(), occurredAt: this.iso(this.clock() - 60_000) });
      this.telemetry = this.telemetry.slice(0, 200);
    }
    this.addEvent('simulation', `Cenário de simulação selecionado: ${this.scenario}.`, 'operator');
    this.recordTelemetry(); return this.getSnapshot();
  }
  recordTelemetry() {
    if (this.scenario === 'offline' || this.scenario === 'stale') { this.evaluate(); return; }
    const time = this.clock();
    const elapsed = this.lastTick ? Math.max(0, Math.min(300, (time - this.lastTick) / 1000)) : 0;
    if (this.pumps.B1.isOn) this.soil = Math.min(100, this.soil + elapsed * 0.15);
    this.lastTick = time;
    this.sequence++;
    const wave = Math.sin(this.sequence / 5) * .3;
    const failedDht = this.scenario === 'dht_failure';
    this.dhtValidReadings = failedDht ? 0 : Math.min(3, this.dhtValidReadings + 1);
    this.telemetry.unshift({
      id: randomUUID(), deviceId: DEVICE_ID, occurredAt: this.iso(),
      airTemperatureC: failedDht ? null : Number(((this.scenario === 'heat' || this.scenario === 'heat_humid' ? this.config.emergencyTemperatureC + 1 : 26.4) + wave).toFixed(1)),
      airHumidityPercent: failedDht ? null : this.scenario === 'high_humidity' ? 99 : this.scenario === 'heat_humid' ? 95 : this.scenario === 'heat' ? 92 : Number((62 + wave).toFixed(1)),
      substrateTemperatureC: this.scenario === 'root_failure' ? null : Number((24.8 + wave).toFixed(1)),
      soilMoisturePercent: this.scenario === 'soil_failure' || this.scenario === 'soil_clock_failure' ? null : Number(this.soil.toFixed(1)),
      waterLevel: this.scenario === 'low_water' ? 'LOW' : 'OK', dhtReliable: !failedDht && this.dhtValidReadings >= 3,
      soilReliable: this.scenario !== 'soil_failure' && this.scenario !== 'soil_clock_failure', rootReliable: this.scenario !== 'root_failure', clockReliable: this.scenario !== 'clock_failure' && this.scenario !== 'soil_clock_failure',
    });
    this.telemetry = this.telemetry.slice(0, 200); this.evaluate();
    if (this.sequence % 4 === 0) this.addEvent('reading', 'Nova leitura recebida da bancada simulada.');
  }
  private evaluate() {
    const t = this.telemetry[0]; if (!t) return;
    const time = this.clock();
    const local = localTimeParts(time);
    if (local.date !== this.day) { this.day = local.date; this.irrigationCycles = 0; this.executedSchedules.clear(); }
    const stale = this.scenario === 'offline' || this.scenario === 'stale' || time - Date.parse(t.occurredAt) > 45_000;
    const emergency = t.dhtReliable && t.airTemperatureC !== null && t.airTemperatureC >= this.config.emergencyTemperatureC;
    const override = (id: PumpId) => !!this.pumps[id].floatOverrideUntil && Date.parse(this.pumps[id].floatOverrideUntil!) > time;
    this.pumps.B1.blockedReason = stale ? 'Sem estado recente do dispositivo' : t.waterLevel === 'LOW' && !override('B1') ? 'Reservatório com nível baixo' : this.pumps.B1.faultCode ? 'Falha de irrigação: automático suspenso' : !t.soilReliable ? (t.clockReliable ? 'Sensor de solo inválido: aguardando agenda de reserva' : 'Sem hora confiável: agenda de reserva suspensa') : null;
    this.pumps.B2.blockedReason = stale ? 'Sem estado recente do dispositivo' : t.waterLevel === 'LOW' && !override('B2') ? 'Reservatório com nível baixo' : !t.dhtReliable ? 'DHT22 sem leitura confiável; aguarde 3 leituras válidas' : (t.airHumidityPercent ?? 100) >= (emergency ? 95 : this.config.fogHumidityBlockPercent) ? 'Umidade do ar bloqueia a névoa' : this.pumps.B2.faultCode ? 'Falha de névoa: automático suspenso' : null;
    if (stale) {
      this.alert('OFFLINE', this.scenario === 'offline' || time - Date.parse(t.occurredAt) > 45_000, 'Dispositivo sem comunicação recente', 'Verifique energia, rede e conexão.', 'critical');
      return;
    }
    this.alert('OFFLINE', false, '', '');
    if (t.soilReliable) this.soilInvalidSince = null; else this.soilInvalidSince ??= time;
    const due = this.config.irrigationSchedule.find(row => row.enabled && row.time === local.time && !this.executedSchedules.has(`${local.date}/${row.time}`));
    for (const id of ['B1', 'B2'] as const) {
      const pump = this.pumps[id];
      const safetyBlocked = (t.waterLevel === 'LOW' && !override(id)) || (id === 'B2' && (!t.dhtReliable || (t.airHumidityPercent ?? 100) >= (emergency ? 95 : this.config.fogHumidityBlockPercent)));
      if (safetyBlocked || (pump.faultCode && pump.mode === 'AUTO')) this.setOutput(id, false, pump.blockedReason ?? 'proteção local');
      if (pump.isOn && this.onSince[id] !== null && time - this.onSince[id]! >= (id === 'B1' ? 300_000 : 60_000)) {
        this.setOutput(id, false, 'teto físico contínuo atingido'); this.completeCommand(id);
        pump.mode = 'AUTO'; pump.expiresAt = null; pump.floatOverrideUntil = null;
      }
      if (pump.expiresAt && Date.parse(pump.expiresAt) <= time) {
        this.setOutput(id, false, 'temporizador encerrado'); this.completeCommand(id);
        pump.mode = 'AUTO'; pump.expiresAt = null; pump.floatOverrideUntil = null;
        this.addEvent('mode_change', `${id} voltou a AUTO após expiração do modo manual.`, 'simulator', { pumpId: id });
      }
      if (pump.mode !== 'AUTO') continue;
      const windowAllowed = !t.clockReliable || inIrrigationWindow(local.time, this.config);
      const fogRecovered = id === 'B2' && t.dhtReliable && (t.airTemperatureC ?? 100) <= this.config.fogTemperatureOnC - this.config.fogHysteresisC && (t.airHumidityPercent ?? 0) >= this.config.fogHumidityMinPercent + 10;
      if (pump.isOn && (time >= this.runUntil[id] || (id === 'B1' && (t.soilMoisturePercent ?? 0) >= this.config.soilMaxPercent) || (id === 'B1' && !windowAllowed) || (id === 'B1' && ((!t.soilReliable && this.irrigationSource === 'sensor') || (!t.clockReliable && this.irrigationSource === 'schedule'))) || fogRecovered)) this.setOutput(id, false, 'fim do ciclo automático');
      const canStart = !safetyBlocked && !pump.faultCode && !pump.isOn && !override(id === 'B1' ? 'B2' : 'B1');
      const fallbackReady = !t.soilReliable && this.soilInvalidSince !== null && time - this.soilInvalidSince > 60_000 && t.clockReliable && !!due;
      if (id === 'B1' && canStart && windowAllowed && ((t.soilReliable && (t.soilMoisturePercent ?? 100) < this.config.soilMinPercent) || fallbackReady) && time - this.stops.B1 >= this.config.irrigationCooldownMinutes * 60_000 && this.irrigationCycles < this.config.irrigationMaxCyclesPerDay) {
        this.irrigationCycles++;
        const duration = fallbackReady && due ? Math.min(due.durationSeconds, this.config.irrigationMaxSeconds) : this.config.irrigationMaxSeconds;
        if (fallbackReady && due) this.executedSchedules.add(`${local.date}/${due.time}`);
        this.irrigationSource = fallbackReady ? 'schedule' : 'sensor';
        this.runUntil.B1 = time + duration * 1000; this.setOutput(id, true, fallbackReady ? 'horário de reserva por falha do sensor de solo' : 'solo abaixo do mínimo configurado');
      }
      if (id === 'B2' && canStart && (emergency || (t.airTemperatureC ?? 0) >= this.config.fogTemperatureOnC || (t.airHumidityPercent ?? 100) < this.config.fogHumidityMinPercent) && time - this.stops.B2 >= this.config.fogPauseSeconds * 1000) {
        this.runUntil.B2 = time + this.config.fogPulseSeconds * 1000; this.setOutput(id, true, emergency ? 'pulso de emergência de calor' : 'pulso automático');
      }
    }
    this.alert('NIVEL_BAIXO', t.waterLevel === 'LOW', 'Reservatório com nível baixo', 'Reabasteça e confira a boia. Bombas bloqueadas, exceto teste supervisionado temporizado.', 'critical');
    this.alert('DHT_FALHA', !t.dhtReliable, 'Sensor de ar sem leitura confiável', 'Verifique o DHT22. B2 libera após 3 leituras válidas consecutivas.', 'critical');
    this.alert('SOLO_FALHA', !t.soilReliable, 'Sensor de solo sem leitura confiável', 'Confira o sensor e sua calibração. A agenda de reserva depende de hora confiável, água e limites.', 'critical');
    this.alert('DS18_FALHA', !t.rootReliable, 'Sensor do substrato sem leitura confiável', 'Confira o sensor de temperatura e sua fiação.');
    this.alert('CALOR_EMERG', emergency, 'Emergência de calor', 'Ventile a estufa. A névoa respeita os limites de umidade e de água.', 'critical');
    const rootWasHigh = this.alerts.some(a => a.code === 'TEMP_RAIZ_ALTA' && !a.endedAt);
    this.alert('TEMP_RAIZ_ALTA', t.rootReliable && (t.substrateTemperatureC ?? 0) > this.config.rootAlertTemperatureC - (rootWasHigh ? 2 : 0), 'Temperatura do substrato elevada', 'Verifique ventilação e sombreamento.');
    this.alert('HORA_INVALIDA', !t.clockReliable, 'Relógio sem hora confiável', 'A agenda de reserva está suspensa. Restaure a sincronização do relógio.');
    this.alert('IRRIG_FALHA', !!this.pumps.B1.faultCode, 'Falha de irrigação', 'Confira bomba, mangueira e sensor; faça um teste supervisionado antes de rearmar.', 'critical');
    this.alert('NEVOA_FALHA', !!this.pumps.B2.faultCode, 'Falha de névoa', 'Confira bomba e bicos; faça um teste supervisionado antes de rearmar.', 'critical');
    if (t.dhtReliable && (t.airHumidityPercent ?? 0) > 85) this.humidityHighSince ??= time;
    else this.humidityHighSince = null;
    if (t.dhtReliable && (t.airHumidityPercent ?? 0) >= 98) this.humidityCriticalSince ??= time;
    else this.humidityCriticalSince = null;
    this.alert('UR_ALTA', this.humidityHighSince !== null && time - this.humidityHighSince >= 1_800_000,
      'Umidade do ar elevada por 30 minutos', 'Ventile a estufa. A névoa permanece sujeita ao bloqueio por umidade.', this.humidityCriticalSince !== null && time - this.humidityCriticalSince >= 1_800_000 ? 'critical' : 'warning');
    this.alert('MODO_MANUAL', Object.values(this.pumps).some(p => p.mode !== 'AUTO'), 'Modo manual temporizado', 'Acompanhe o temporizador ou retorne ao automático.', 'info');
  }
  getSnapshot(): Snapshot {
    this.evaluate();
    return structuredClone({ deviceId: DEVICE_ID, online: this.scenario !== 'offline', lastSeenAt: this.telemetry[0].occurredAt,
      simulation: true, simulationScenario: this.scenario, scenarioControlsEnabled: process.env.NODE_ENV !== 'production',
      configVersion: this.version, configAppliedAt: this.appliedAt, timeZone: 'America/Sao_Paulo', irrigationCyclesToday: this.irrigationCycles,
      simulationClockOffsetMs: this.clockOffset,
      telemetry: this.telemetry[0], pumps: this.pumps, activeAlerts: this.alerts.filter(a => !a.endedAt), config: this.config });
  }
  getTelemetry() { return structuredClone(this.telemetry); }
  getEvents() { this.evaluate(); return structuredClone(this.events); }
  getAlerts() { this.evaluate(); return structuredClone(this.alerts); }
  getHistory() { this.evaluate(); return structuredClone({ telemetry: this.telemetry, events: this.events, alerts: this.alerts }); }
  getConfig() { return structuredClone(this.config); }
  getCommand(id: string) { this.evaluate(); return structuredClone(this.commands.get(id)); }
  acknowledgeAlert(id: string): Alert | null {
    this.evaluate();
    const alert = this.alerts.find(a => a.id === id && !a.endedAt); if (!alert) return null;
    if (!alert.acknowledgedAt) { alert.acknowledgedAt = this.iso(); this.addEvent('alert', `${alert.title}: reconhecido pelo operador.`, 'operator'); }
    return structuredClone(alert);
  }
  updateConfig(input: Partial<Config>): Config | null {
    const next = { ...this.config, ...input };
    const error = configError(next);
    if (error) { this.alert('CONFIG_INVALIDA', true, 'Configuração recusada', error); return null; }
    if (this.scenario === 'offline' || this.scenario === 'stale' || this.clock() - Date.parse(this.telemetry[0].occurredAt) > 45_000) return null;
    this.config = structuredClone(next); this.version++; this.appliedAt = this.iso();
    this.alert('CONFIG_INVALIDA', false, '', '');
    this.addEvent('configuration', `Configuração v${this.version} confirmada e aplicada pelo simulador.`, 'operator', { configVersion: this.version, appliedConfig: structuredClone(this.config) });
    this.evaluate(); return this.getConfig();
  }
  issueCommand(input: CommandRequest): CommandResult {
    this.evaluate();
    const existing = this.commands.get(input.commandId);
    if (existing) {
      if (existing.pumpId !== input.pumpId || existing.action !== input.action || existing.durationSeconds !== input.durationSeconds || existing.expiresAt !== input.expiresAt || existing.supervisionConfirmed !== input.supervisionConfirmed)
        return { ...input, deviceId: DEVICE_ID, createdAt: this.iso(), status: 'rejected', reason: 'ID de comando reutilizado com conteúdo diferente.', completedAt: this.iso() };
      return structuredClone(existing);
    }
    const result: CommandResult = { ...input, deviceId: DEVICE_ID, createdAt: this.iso(), status: 'rejected', reason: null, completedAt: null };
    const expiry = Date.parse(input.expiresAt);
    const pump = input.pumpId === 'B1' || input.pumpId === 'B2' ? this.pumps[input.pumpId] : undefined;
    if (!Number.isFinite(expiry) || expiry <= this.clock() || expiry > this.clock() + 10_000) { result.status = 'expired'; result.reason = 'Comando vencido ou validade superior a 10 segundos.'; }
    else if (!pump || !['AUTO', 'MANUAL_ON', 'MANUAL_OFF', 'TEST', 'RESET_FAULT', 'IGNORE_FLOAT'].includes(input.action)) result.reason = 'Bomba ou ação inválida.';
    else {
      const duration = input.action === 'MANUAL_OFF' ? 3600 : input.action === 'TEST' ? 10 : input.durationSeconds;
      const max = input.pumpId === 'B1' ? 300 : 60;
      const turningOn = input.action === 'MANUAL_ON' || input.action === 'TEST' || input.action === 'IGNORE_FLOAT';
      const otherId = input.pumpId === 'B1' ? 'B2' : 'B1';
      const other = this.pumps[otherId];
      const specialLimit = input.pumpId === 'B1' ? 120 : 60;
      const ignoreFloat = input.action === 'IGNORE_FLOAT';
      const waterBlocked = this.telemetry[0].waterLevel === 'LOW' && !ignoreFloat;
      const emergency = (this.telemetry[0].airTemperatureC ?? 0) >= this.config.emergencyTemperatureC;
      const dhtBlocked = input.pumpId === 'B2' && (!this.telemetry[0].dhtReliable || (this.telemetry[0].airHumidityPercent ?? 100) >= (emergency ? 95 : this.config.fogHumidityBlockPercent));
      if (input.action === 'MANUAL_ON' && (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 1 || duration > max)) result.reason = `Duração inválida: máximo de ${max} segundos para ${input.pumpId}.`;
      else if (ignoreFloat && (input.supervisionConfirmed !== true || !Number.isInteger(duration) || duration! < 1 || duration! > specialLimit)) result.reason = `Exceção da boia exige supervisão confirmada e duração de 1 a ${specialLimit} s.`;
      else if (this.scenario === 'offline' || this.scenario === 'stale' || this.clock() - Date.parse(this.telemetry[0].occurredAt) > 45_000) result.reason = 'Dispositivo sem estado recente; comando não enviado.';
      else if (!this.telemetry[0].clockReliable) result.reason = 'Sem hora confiável para validar a expiração do comando.';
      else if (turningOn && (waterBlocked || dhtBlocked)) result.reason = waterBlocked ? 'Nível baixo bloqueia as bombas.' : 'DHT22 ou umidade do ar bloqueia B2.';
      else if (turningOn && other.floatOverrideUntil && Date.parse(other.floatOverrideUntil) > this.clock()) result.reason = 'Há uma exceção supervisionada ativa na outra bomba.';
      else if (ignoreFloat && other.isOn) result.reason = 'Desligue a outra bomba antes do teste supervisionado.';
      else {
        this.completeCommand(input.pumpId);
        if (input.action === 'RESET_FAULT') pump.faultCode = null;
        pump.mode = input.action === 'MANUAL_OFF' ? 'MANUAL_OFF' : turningOn ? 'MANUAL_ON' : 'AUTO';
        const physicalDeadline = (this.onSince[input.pumpId] ?? this.clock()) + max * 1000;
        const overrideDeadline = ignoreFloat ? Math.min(this.clock() + duration! * 1000, pump.floatOverrideUntil ? Date.parse(pump.floatOverrideUntil) : Infinity) : null;
        pump.floatOverrideUntil = overrideDeadline !== null ? this.iso(overrideDeadline) : null;
        this.setOutput(input.pumpId, turningOn, 'comando confirmado pelo simulador');
        pump.expiresAt = pump.mode === 'AUTO' ? null : this.iso(turningOn ? Math.min(this.clock() + (duration ?? 0) * 1000, physicalDeadline, overrideDeadline ?? Infinity) : this.clock() + 3600_000);
        result.status = pump.mode === 'AUTO' ? 'completed' : 'accepted';
        if (result.status === 'completed') result.completedAt = this.iso();
        else this.activeCommands[input.pumpId] = input.commandId;
        this.addEvent('command', `${commandNames[input.action]}: confirmado para ${input.pumpId}${duration ? ` por ${duration} s` : ''}${ignoreFloat ? ' (supervisão presencial confirmada)' : ''}.`, 'operator', { pumpId: input.pumpId, commandId: input.commandId, commandStatus: result.status });
      }
    }
    if (result.status === 'rejected' || result.status === 'expired') { result.completedAt = this.iso(); this.addEvent('command', `Pedido ${commandNames[input.action] ?? input.action} para ${input.pumpId} recusado: ${result.reason}`, 'operator', { pumpId: pump ? input.pumpId : undefined, commandId: input.commandId, commandStatus: result.status }); }
    this.commands.set(input.commandId, result);
    this.evaluate(); return structuredClone(result);
  }
}
