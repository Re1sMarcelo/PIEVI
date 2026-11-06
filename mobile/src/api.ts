import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { requestJson, resolveApiBaseUrl } from './apiConnection';
export { ApiError } from './apiConnection';
import type {
  Alert,
  CommandAction,
  CommandResult,
  Config,
  DeviceEvent,
  DeviceHistory,
  ListResponse,
  LoginResponse,
  PumpId,
  Snapshot,
  Telemetry,
  SimulationScenario,
} from '../../api/src/contracts';

export function getApiBaseUrl() {
  return resolveApiBaseUrl(process.env.EXPO_PUBLIC_API_URL, Constants.expoConfig?.hostUri, __DEV__ && Platform.OS === 'web');
}

const devicePath = '/v1/devices/bancada-01';

async function request<T>(path: string, token?: string, options: RequestInit = {}): Promise<T> {
  return requestJson<T>(`${getApiBaseUrl()}${path}`, token, options);
}

export const api = {
  login: (username: string, password: string) => request<LoginResponse>('/v1/auth/login', undefined, {
    method: 'POST', body: JSON.stringify({ username, password }),
  }),
  logout: (token: string) => request<{ ok: boolean }>('/v1/auth/logout', token, { method: 'POST' }),
  snapshot: (token: string) => request<Snapshot>(`${devicePath}/snapshot`, token),
  history: (token: string) => request<DeviceHistory>(`${devicePath}/history`, token),
  simulation: (token: string, scenario: SimulationScenario) => request<Snapshot>(`${devicePath}/simulation`, token, {
    method: 'PUT', body: JSON.stringify({ scenario }),
  }),
  advanceSimulation: (token: string, advanceSeconds: number) => request<Snapshot>(`${devicePath}/simulation`, token, {
    method: 'PUT', body: JSON.stringify({ advanceSeconds }),
  }),
  telemetry: (token: string) => request<ListResponse<Telemetry>>(`${devicePath}/telemetry`, token),
  events: (token: string) => request<ListResponse<DeviceEvent>>(`${devicePath}/events`, token),
  alerts: (token: string) => request<ListResponse<Alert>>(`${devicePath}/alerts`, token),
  acknowledge: (token: string, id: string) => request<Alert>(`${devicePath}/alerts/${id}/ack`, token, { method: 'POST' }),
  updateConfig: (token: string, config: Partial<Config>, expectedVersion?: number) => request<Config>(`${devicePath}/config`, token, {
    method: 'PUT', body: JSON.stringify(config), headers: expectedVersion === undefined ? {} : { 'If-Match': `"${expectedVersion}"` },
  }),
  command: (token: string, pumpId: PumpId, action: CommandAction, durationSeconds?: number, supervisionConfirmed?: boolean, clockOffsetMs = 0) => {
    const commandId = `${Date.now()}-${Math.random().toString(36).slice(2)}-${pumpId}`;
    return request<CommandResult>(`${devicePath}/commands`, token, {
      method: 'POST',
      body: JSON.stringify({ commandId, pumpId, action, durationSeconds, supervisionConfirmed, expiresAt: new Date(Date.now() + clockOffsetMs + 10_000).toISOString() }),
    });
  },
};
