export type PumpId = 'B1' | 'B2';
export type PumpMode = 'AUTO' | 'MANUAL_ON' | 'MANUAL_OFF';
export type CommandAction = PumpMode | 'TEST' | 'RESET_FAULT' | 'IGNORE_FLOAT';
export type CommandStatus = 'pending' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'completed';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface Telemetry {
  id: string;
  deviceId: string;
  occurredAt: string;
  airTemperatureC: number | null;
  airHumidityPercent: number | null;
  substrateTemperatureC: number | null;
  soilMoisturePercent: number | null;
  waterLevel: 'OK' | 'LOW';
  dhtReliable: boolean;
  soilReliable: boolean;
  rootReliable: boolean;
  clockReliable: boolean;
  timeBasis?: 'device' | 'received';
}

export interface PumpState {
  id: PumpId;
  mode: PumpMode;
  isOn: boolean;
  expiresAt: string | null;
  blockedReason: string | null;
  faultCode: string | null;
  floatOverrideUntil: string | null;
}

export interface Alert {
  id: string;
  deviceId: string;
  code: string;
  severity: AlertSeverity;
  title: string;
  suggestedAction: string;
  startedAt: string;
  endedAt: string | null;
  acknowledgedAt: string | null;
  startedAtBasis?: 'device' | 'received';
  endedAtBasis?: 'device' | 'received';
}

export interface DeviceEvent {
  id: string;
  deviceId: string;
  occurredAt: string;
  kind: 'reading' | 'command' | 'alert' | 'mode_change' | 'actuation' | 'configuration' | 'simulation' | 'connection';
  description: string;
  origin: 'simulator' | 'operator' | 'esp32';
  pumpId?: PumpId;
  outputOn?: boolean;
  commandId?: string;
  commandStatus?: CommandStatus;
  configVersion?: number;
  appliedConfig?: Config;
}

export interface DeviceHistory {
  telemetry: Telemetry[];
  events: DeviceEvent[];
  alerts: Alert[];
}

export interface Config {
  soilMinPercent: number;
  soilMaxPercent: number;
  fogTemperatureOnC: number;
  fogHumidityMinPercent: number;
  fogHumidityBlockPercent: number;
  emergencyTemperatureC: number;
  fogPulseSeconds: number;
  fogPauseSeconds: number;
  lowWaterBlocksPumps: true;
  irrigationMaxSeconds: number;
  irrigationCooldownMinutes: number;
  irrigationMaxCyclesPerDay: number;
  irrigationWindowEnabled: boolean;
  irrigationWindowStart: string;
  irrigationWindowEnd: string;
  irrigationSchedule: IrrigationSchedule[];
  fogHysteresisC: number;
  rootAlertTemperatureC: number;
  manualIrrigationSeconds: number;
  manualFogSeconds: number;
}

export interface IrrigationSchedule { time: string; durationSeconds: number; enabled: boolean }

export interface Snapshot {
  deviceId: string;
  online: boolean;
  lastSeenAt: string;
  simulation: boolean;
  mode?: 'simulator' | 'mqtt' | 'mqtt-virtual';
  configApplied?: boolean;
  telemetry: Telemetry;
  pumps: Record<PumpId, PumpState>;
  activeAlerts: Alert[];
  config: Config;
  simulationScenario: SimulationScenario;
  scenarioControlsEnabled: boolean;
  configVersion: number;
  configAppliedAt: string | null;
  timeZone: string;
  irrigationCyclesToday: number;
  simulationClockOffsetMs: number;
}

export interface ConfigSubmission { commandId: string; requestedVersion: number; status: CommandStatus }

export type SimulationScenario = 'normal' | 'dry_soil' | 'wet_soil' | 'low_water' | 'heat' | 'heat_humid' | 'high_humidity' | 'dht_failure' | 'soil_failure' | 'root_failure' | 'offline' | 'stale' | 'clock_failure' | 'soil_clock_failure' | 'irrigation_failure' | 'fog_failure';

export interface CommandRequest {
  commandId: string;
  pumpId: PumpId;
  action: CommandAction;
  expiresAt: string;
  durationSeconds?: number;
  supervisionConfirmed?: boolean;
}

export interface CommandResult extends CommandRequest {
  deviceId: string;
  createdAt: string;
  status: CommandStatus;
  reason: string | null;
  completedAt: string | null;
}

export interface ListResponse<T> {
  items: T[];
  nextCursor: string | null;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  username: string;
}
