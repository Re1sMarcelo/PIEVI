import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../src/auth/password.js';
import { startPhysicalBench } from '../src/physical/index.js';
import { checkPhysicalBench } from '../src/physical/check.js';
import { readPhysicalSettings, type PhysicalSettings } from '../src/physical/settings.js';
import { openPhysicalDatabase, provisionPhysical } from '../src/physical/database.js';
import { virtualNvs } from '../src/virtual/nvs.js';
import { VirtualESP } from '../src/virtual/esp.js';
import { waitFor } from '../src/lab/index.js';
import { startLocalBroker } from '../src/lab/broker.js';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../tmp/physical-tests/', import.meta.url));
mkdirSync(root, { recursive: true });
async function settings(): Promise<PhysicalSettings> {
  const password = 'senha-exclusiva-do-teste-123';
  return { deviceId: 'bancada-01', chipId: 'test-hardware-only', lanIp: '', apiPort: 3000, mqttPort: 1883, brokerMode: 'local',
    brokerUrl: 'mqtt://127.0.0.1:1883', apiUsername: 'api-local', apiClientId: 'pievi-api-local', apiPassword: randomUUID(),
    espPassword: randomUUID(), operatorUsername: 'operador', operatorPassword: password, operatorPasswordHash: await hashPassword(password) };
}

test('setup é repetível em clone novo e valida configuração sem usar os .env anteriores', async () => {
  const folder = mkdtempSync(join(root, 'settings-'));
  const configFile = join(folder, '.env.physical');
  const setup = fileURLToPath(new URL('../scripts/setup-physical.mjs', import.meta.url));
  // Run a copy in a temporary repository-shaped folder so this test never changes the real .env.physical.
  const scriptDir = join(folder, 'api', 'scripts'); mkdirSync(scriptDir, { recursive: true });
  const copy = join(scriptDir, 'setup-physical.mjs'); writeFileSync(copy, readFileSync(setup));
  execFileSync(process.execPath, [copy]);
  const original = readFileSync(configFile, 'utf8');
  execFileSync(process.execPath, [copy]);
  assert.equal(readFileSync(configFile, 'utf8'), original);
  const parsed = readPhysicalSettings(configFile);
  assert.equal(parsed.chipId, '');
  await assert.rejects(startPhysicalBench(parsed), /PHYSICAL_CHIP_ID/);
  writeFileSync(configFile, original.replace('DEVICE_ID=bancada-01', 'DEVICE_ID=outra-bancada'));
  assert.throws(() => readPhysicalSettings(configFile), /DEVICE_ID=bancada-01/);
  writeFileSync(configFile, original.replace('PHYSICAL_CHIP_ID=', 'PHYSICAL_CHIP_ID=virtual:bancada-01'));
  assert.throws(() => readPhysicalSettings(configFile), /hardware real/);
});

test('API física inicia offline, não gera atuações e diagnóstico não libera a bancada sem ESP', { timeout: 60000 }, async () => {
  const config = await settings();
  const bench = await startPhysicalBench(config, { host: '127.0.0.1', apiPort: 0, brokerPort: 0 });
  try {
    await waitFor(async () => bench.runtime.worker.status.ready, Boolean);
    const snapshot = await bench.runtime.snapshot();
    assert.equal(snapshot.mode, 'mqtt'); assert.equal(snapshot.simulation, false);
    assert.equal(snapshot.online, false); assert.equal(snapshot.scenarioControlsEnabled, false);
    assert.equal((await bench.db.query<{ total: number }>('SELECT count(*)::int total FROM comandos')).rows[0].total, 0);
    const credentials = { url: bench.url, username: config.operatorUsername, password: config.operatorPassword };
    const infra = await checkPhysicalBench({ ...credentials, infrastructureOnly: true });
    assert.ok(infra.checks.every(check => check.status !== 'failed'));
    assert.ok(infra.checks.some(check => check.name === 'ESP sincronizado' && check.status === 'pending'));
    const full = await checkPhysicalBench(credentials);
    assert.ok(full.checks.some(check => check.name === 'ESP sincronizado' && check.status === 'failed'));
    assert.equal((await bench.db.query<{ total: number }>('SELECT count(*)::int total FROM comandos')).rows[0].total, 0);
    const session = await fetch(`${bench.url}/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: config.operatorUsername, password: config.operatorPassword }) }).then(r => r.json()) as { token: string };
    const response = await fetch(`${bench.url}/v1/devices/bancada-01/simulation`, { method: 'PUT', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: 'low_water' }) });
    assert.equal(response.status, 404);
    const command = await fetch(`${bench.url}/v1/devices/bancada-01/commands`, { method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ commandId: randomUUID(), pumpId: 'B1', action: 'MANUAL_ON', durationSeconds: 1, expiresAt: new Date(Date.now() + 10000).toISOString() }) });
    assert.equal(command.status, 409);
    assert.equal((await bench.db.query<{ total: number }>('SELECT count(*)::int total FROM comandos')).rows[0].total, 0);
  } finally { await bench.stop(); }
});

test('identidade e senha persistem no reinício; outro chip e vínculo revogado não são substituídos', { timeout: 60000 }, async () => {
  const config = await settings();
  const folder = mkdtempSync(join(root, 'database-'));
  const identity = { chipId: config.chipId, username: config.operatorUsername, passwordHash: config.operatorPasswordHash };
  let data = await openPhysicalDatabase(identity, folder);
  try { await data.db.query("INSERT INTO eventos(dispositivo_id,mensagem_id,tipo,origem,descricao) SELECT id,'teste-persistente','conexao','backend','Registro de teste' FROM dispositivos"); }
  finally { await data.db.close(); }
  await assert.rejects(openPhysicalDatabase({ ...identity, chipId: 'outro-hardware' }, folder), /outro chip/);
  data = await openPhysicalDatabase(identity, folder);
  try {
    assert.equal((await data.db.query<{ total: number }>('SELECT count(*)::int total FROM eventos')).rows[0].total, 1);
    await assert.rejects(provisionPhysical(data.database, { ...identity, passwordHash: await hashPassword('outra-senha-do-teste') }), /credenciais/);
    await data.db.query('UPDATE dispositivo_usuarios SET ativo=false');
    await assert.rejects(provisionPhysical(data.database, identity), /revogado/);
    assert.equal((await data.db.query<{ ativo: boolean }>('SELECT ativo FROM dispositivo_usuarios')).rows[0].ativo, false);
  } finally { await data.db.close(); }
});

test('broker externo: cliente MQTT de ensaio valida handshake, configuração e comando no modo físico isolado', { timeout: 90000 }, async () => {
  // The protocol peer is a fixture only: production physical entry points never instantiate it.
  const config = await settings();
  const externalBroker = await startLocalBroker(config.deviceId, 0);
  config.brokerMode = 'external'; config.brokerUrl = externalBroker.api.url;
  config.apiPassword = externalBroker.api.password;
  let bench: Awaited<ReturnType<typeof startPhysicalBench>>;
  try { bench = await startPhysicalBench(config, { host: '127.0.0.1', apiPort: 0 }); }
  catch (error) { await externalBroker.close(); throw error; }
  assert.equal(bench.broker, undefined);
  const nvs = virtualNvs();
  const peer = new VirtualESP({ deviceId: config.deviceId, broker: externalBroker.esp, nvs: nvs.value, publishMs: 500 });
  try {
    await peer.start();
    await waitFor(() => bench.runtime.snapshot(), snapshot => snapshot.online && snapshot.telemetry.id !== 'unavailable');
    assert.equal((await bench.runtime.snapshot()).configApplied, false);
    const session = await fetch(`${bench.url}/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: config.operatorUsername, password: config.operatorPassword }) }).then(r => r.json()) as { token: string };
    const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
    const snapshot = await bench.runtime.snapshot();
    const response = await fetch(`${bench.url}/v1/devices/bancada-01/config`, { method: 'PUT', headers: { ...headers, 'If-Match': '"0"' }, body: JSON.stringify(snapshot.config) });
    assert.equal(response.status, 202, await response.text());
    await waitFor(() => bench.runtime.snapshot(), value => !!value.configApplied);
    const commandId = randomUUID();
    const request = () => fetch(`${bench.url}/v1/devices/bancada-01/commands`, { method: 'POST', headers, body: JSON.stringify({ commandId, pumpId: 'B1', action: 'MANUAL_ON', durationSeconds: 1, expiresAt: new Date(Date.now() + 10000).toISOString() }) });
    assert.equal((await request()).status, 202);
    await waitFor(() => bench.runtime.reader.command(commandId), command => command?.status === 'completed');
    await waitFor(() => bench.runtime.snapshot(), value => !value.pumps.B1.isOn);
    assert.equal((await request()).status, 200);
    assert.equal((await bench.db.query<{ total: number }>('SELECT count(*)::int total FROM acionamentos WHERE comando_id IS NOT NULL')).rows[0].total, 1);
    const report = await checkPhysicalBench({ url: bench.url, username: config.operatorUsername, password: config.operatorPassword });
    assert.ok(report.checks.every(check => check.status === 'ok'), JSON.stringify(report));
    assert.ok(peer.status.receipts > 0); assert.equal(peer.status.lastError, null);
  } finally { await peer.stop(); await bench.stop(); await externalBroker.close(); }
});
