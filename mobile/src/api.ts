import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type {
  Alert,
  CommandAction,
  CommandResult,
  Config,
  DeviceEvent,
  ListResponse,
  LoginResponse,
  GoogleChallenge,
  GoogleLoginResult,
  PumpId,
  Snapshot,
  Telemetry,
} from '../../api/src/contracts';

function getApiBaseUrl() {
  const configuredUrl = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configuredUrl) return configuredUrl.replace(/\/$/, '');
  if (__DEV__ && Platform.OS === 'web') return '/api';

  const hostUri = Constants.expoConfig?.hostUri;
  if (!hostUri) return 'http://localhost:3000';

  const host = new URL(`http://${hostUri}`).hostname;
  return host.endsWith('.exp.direct')
    ? `https://${host}/api`
    : `http://${host}:3000`;
}

const baseUrl = getApiBaseUrl();
const devicePath = '/v1/devices/bancada-01';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request<T>(path: string, token?: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = await response.json() as T & { error?: string; reason?: string };
  if (!response.ok) throw new ApiError(body.reason ?? body.error ?? `HTTP ${response.status}`, response.status);
  return body;
}

export const api = {
  googleChallenge:()=>request<GoogleChallenge>('/v1/auth/google/challenge',undefined,{method:'POST'}),
  googleLogin:(challengeId:string,idToken:string,password?:string)=>request<GoogleLoginResult>('/v1/auth/google/login',undefined,{
    method:'POST',body:JSON.stringify({challengeId,idToken,password:password||undefined}),
  }),
  requestGoogleAccess:(requestTicket:string)=>request<{status:'pending';requestId:string}>('/v1/auth/google/requests',undefined,{
    method:'POST',body:JSON.stringify({requestTicket}),
  }),
  login: (username: string, password: string) => request<LoginResponse>('/v1/auth/login', undefined, {
    method: 'POST', body: JSON.stringify({ username, password }),
  }),
  logout: (token: string) => request<{ ok: boolean }>('/v1/auth/logout', token, { method: 'POST' }),
  snapshot: (token: string) => request<Snapshot>(`${devicePath}/snapshot`, token),
  telemetry: (token: string) => request<ListResponse<Telemetry>>(`${devicePath}/telemetry`, token),
  events: (token: string) => request<ListResponse<DeviceEvent>>(`${devicePath}/events`, token),
  alerts: (token: string) => request<ListResponse<Alert>>(`${devicePath}/alerts`, token),
  acknowledge: (token: string, id: string) => request<Alert>(`${devicePath}/alerts/${id}/ack`, token, { method: 'POST' }),
  updateConfig: (token: string, config: Partial<Config>) => request<Config>(`${devicePath}/config`, token, {
    method: 'PUT', body: JSON.stringify(config),
  }),
  command: (token: string, pumpId: PumpId, action: CommandAction, durationSeconds?: number) => {
    const commandId = `${Date.now()}-${Math.random().toString(36).slice(2)}-${pumpId}`;
    return request<CommandResult>(`${devicePath}/commands`, token, {
      method: 'POST',
      body: JSON.stringify({ commandId, pumpId, action, durationSeconds, expiresAt: new Date(Date.now() + 10_000).toISOString() }),
    });
  },
};
