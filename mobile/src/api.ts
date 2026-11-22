import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { requestJson, resolveApiBaseUrl, serverClockOffset, type ResponseTiming } from './apiConnection';
import { waitForCommand } from './commandPolling';
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
  ConfigSubmission,
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
  // simulationClockOffsetMs passa a incluir a diferenca entre o relogio do servidor e o do celular:
  // idade das leituras e prazo dos comandos ficam no relogio da API, mesmo com notebook/celular desacertados.
  snapshot: async (token: string) => {
    const timing: ResponseTiming = {};
    const snapshot = await requestJson<Snapshot>(`${getApiBaseUrl()}${devicePath}/snapshot`, token, {}, undefined, timing);
    return { ...snapshot, simulationClockOffsetMs: (snapshot.simulationClockOffsetMs ?? 0) + serverClockOffset(timing) };
  },
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
  updateConfig: async (token: string, config: Partial<Config>, expectedVersion?: number) => {
    const result=await request<Config|ConfigSubmission>(`${devicePath}/config`, token, {
      method: 'PUT', body: JSON.stringify(config), headers: expectedVersion === undefined ? {} : { 'If-Match': `"${expectedVersion}"` },
    });
    if(!('commandId' in result))return result;
    await waitForCommand(()=>request<CommandResult>(`${devicePath}/commands/${result.commandId}`,token),'completed');
    for(let attempt=0;attempt<20;attempt++) {
      const snapshot=await request<Snapshot>(`${devicePath}/snapshot`,token);
      if(snapshot.configApplied && snapshot.configVersion===result.requestedVersion)return snapshot.config;
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    throw new Error('O ESP confirmou a configuração, mas o estado aplicado ainda não foi reconciliado. Atualize antes de reenviar.');
  },
  command: async (token: string, pumpId: PumpId, action: CommandAction, durationSeconds?: number, supervisionConfirmed?: boolean, clockOffsetMs = 0) => {
    const commandId = `${Date.now()}-${Math.random().toString(36).slice(2)}-${pumpId}`;
    const result=await request<CommandResult>(`${devicePath}/commands`, token, {
      method: 'POST',
      body: JSON.stringify({ commandId, pumpId, action, durationSeconds, supervisionConfirmed, expiresAt: new Date(Date.now() + clockOffsetMs + 10_000).toISOString() }),
    });
    return result.status==='pending'||result.status==='sent' ? waitForCommand(()=>request<CommandResult>(`${devicePath}/commands/${commandId}`,token),'accepted') : result;
  },
};
