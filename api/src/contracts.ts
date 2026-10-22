export type PumpId = 'B1' | 'B2';
export type PumpMode = 'AUTO' | 'MANUAL_ON' | 'MANUAL_OFF';
export type CommandAction = PumpMode | 'TEST';
export type CommandStatus = 'accepted' | 'rejected' | 'expired' | 'completed';
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
}

export interface PumpState {
  id: PumpId;
  mode: PumpMode;
  isOn: boolean;
  expiresAt: string | null;
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
}

export interface DeviceEvent {
  id: string;
  deviceId: string;
  occurredAt: string;
  kind: 'reading' | 'command' | 'alert' | 'mode_change';
  description: string;
  origin: 'simulator' | 'operator' | 'esp32';
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
}

export interface Snapshot {
  deviceId: string;
  online: boolean;
  lastSeenAt: string;
  simulation: true;
  telemetry: Telemetry;
  pumps: Record<PumpId, PumpState>;
  activeAlerts: Alert[];
  config: Config;
}

export interface CommandRequest {
  commandId: string;
  pumpId: PumpId;
  action: CommandAction;
  expiresAt: string;
  durationSeconds?: number;
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

export interface GoogleChallenge { challengeId: string; nonce: string; expiresAt: string }
export type GoogleLoginResult = { status: 'authenticated'; session: LoginResponse } |
  { status: 'not_registered'; requestTicket: string } | { status: 'pending'; requestId: string } |
  { status: 'link_required' | 'denied' };
