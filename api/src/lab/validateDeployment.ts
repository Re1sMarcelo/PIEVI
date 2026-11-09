import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { CommandResult, ConfigSubmission, DeviceHistory, Snapshot } from '../contracts.js';
import { waitFor } from './index.js';
import type { TransactionDatabase } from '../persistence/database.js';

export async function validateVirtualDeployment(options: {
  url: string; username: string; password: string; database: TransactionDatabase; requirePostgres?: boolean;
}) {
  const root = '/v1/devices/bancada-01';
  const checks: string[] = [];
  const request = async <T>(path: string, token?: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${options.url}${path}`, {
      method, signal: AbortSignal.timeout(5000),
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.ok(response.ok, `HTTP ${response.status} em ${path}: ${await response.clone().text()}`);
    return await response.json() as T;
  };
  const health = await request<{ mode: string; storage: string; mqtt: { ready: boolean } }>('/health');
  assert.equal(health.mode, 'mqtt-virtual', 'Este ensaio só pode atuar em um ESP virtual.');
  assert.equal(health.mqtt.ready, true);
  if (options.requirePostgres) assert.equal(health.storage, 'postgres');
  const session = await request<{ token: string }>('/v1/auth/login', undefined, 'POST', {
    username: options.username, password: options.password,
  });
  const snapshot = () => request<Snapshot>(`${root}/snapshot`, session.token);
  let current = await waitFor(snapshot, s => s.online && s.telemetry.soilReliable && s.telemetry.waterLevel === 'OK', 30000);
  checks.push('API autenticada e ESP virtual sincronizado pelo broker');
  const submission = await request<ConfigSubmission>(`${root}/config`, session.token, 'PUT', current.config, { 'If-Match': `"${current.configVersion}"` });
  await waitFor(() => request<CommandResult>(`${root}/commands/${submission.commandId}`, session.token), c => c.status === 'completed');
  current = await waitFor(snapshot, s => !!s.configApplied && s.configVersion === submission.requestedVersion);
  checks.push('Configuração confirmada pelo ESP e reconciliada no banco');
  const commandIds: string[] = [];
  for (const pumpId of ['B1', 'B2'] as const) {
    const commandId = randomUUID();
    const body = { commandId, pumpId, action: 'MANUAL_ON', durationSeconds: 2, expiresAt: new Date(Date.now() + 10000).toISOString() };
    await request(`${root}/commands`, session.token, 'POST', body);
    await waitFor(snapshot, s => s.pumps[pumpId].isOn);
    await waitFor(() => request<CommandResult>(`${root}/commands/${commandId}`, session.token), c => c.status === 'completed');
    await waitFor(snapshot, s => !s.pumps[pumpId].isOn);
    await request(`${root}/commands`, session.token, 'POST', body);
    const counts = await options.database.transaction(async sql => (await sql.query<{ commands: number; cycles: number }>(
      `SELECT (SELECT count(*)::int FROM comandos WHERE id_externo=$1) commands,
        (SELECT count(*)::int FROM acionamentos a JOIN comandos c ON c.id=a.comando_id WHERE c.id_externo=$1) cycles`, [commandId],
    )).rows[0]);
    assert.equal(counts.commands, 1);
    assert.equal(counts.cycles, 1);
    commandIds.push(commandId);
    checks.push(`${pumpId}: estado ligado/desligado, término e reentrega sem novo acionamento`);
  }
  const history = await request<DeviceHistory>(`${root}/history`, session.token);
  for (const commandId of commandIds) assert.ok(history.events.some(e => e.commandId === commandId));
  checks.push('Histórico HTTP corresponde aos comandos persistidos');
  return { checks, checkedAt: new Date().toISOString(), storage: health.storage,
    checkpoint: { token: session.token, configVersion: current.configVersion, commandIds } };
}
