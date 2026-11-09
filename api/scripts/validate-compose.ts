import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createDatabasePool } from '../src/database.js';
import { postgresDatabase } from '../src/persistence/database.js';
import { validateVirtualDeployment } from '../src/lab/validateDeployment.js';
import { waitFor } from '../src/lab/index.js';
import type { DeviceHistory, Snapshot } from '../src/contracts.js';

if (process.env.PIEVI_VALIDATE_VIRTUAL !== '1' || !process.env.DATABASE_URL) throw new Error('Use o serviço validate do Compose virtual.');
const url = process.env.VALIDATION_API_URL!;
const pool = createDatabasePool(process.env.DATABASE_URL);
pool.on('error', () => process.stderr.write('PostgreSQL indisponível na validação.\n'));
try {
  await mkdir('/reports', { recursive: true });
  if (process.argv.includes('--resume')) {
    const checkpoint = JSON.parse(await readFile('/validation/checkpoint.json', 'utf8')) as { token: string; configVersion: number; commandIds: string[] };
    const snapshot = async () => {
      const response = await fetch(`${url}/v1/devices/bancada-01/snapshot`, { headers: { Authorization: `Bearer ${checkpoint.token}` }, signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200, 'Sessão do operador precisa sobreviver ao reinício.');
      return await response.json() as Snapshot;
    };
    await waitFor(snapshot, s => s.online && !!s.configApplied && s.configVersion === checkpoint.configVersion && !s.pumps.B1.isOn && !s.pumps.B2.isOn, 45000);
    const response = await fetch(`${url}/v1/devices/bancada-01/history`, { headers: { Authorization: `Bearer ${checkpoint.token}` }, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    const history = await response.json() as DeviceHistory;
    for (const id of checkpoint.commandIds) {
      assert.ok(history.events.some(e => e.commandId === id));
      const result = await pool.query('SELECT count(*)::int total FROM acionamentos a JOIN comandos c ON c.id=a.comando_id WHERE c.id_externo=$1', [id]);
      assert.equal(result.rows[0].total, 1, 'Reinício não pode repetir o acionamento.');
    }
    const report = JSON.parse(await readFile('/reports/latest.json', 'utf8'));
    report.checks.push('Reinício de PostgreSQL, broker, API e ESP preserva sessão, configuração e histórico sem repetir acionamentos');
    report.ok = true;
    report.restartPending = false;
    report.checkedAt = new Date().toISOString();
    await writeFile('/reports/latest.json', JSON.stringify(report, null, 2));
    console.log(`VALIDAÇÃO COMPOSE CONCLUÍDA · ${report.checks.length} verificações`);
  } else {
    await writeFile('/reports/latest.json', JSON.stringify({ ok: false, checkedAt: new Date().toISOString(), checks: [], restartPending: true }, null, 2));
    const { checkpoint, ...report } = await validateVirtualDeployment({ url, database: postgresDatabase(pool),
      username: process.env.OPERATOR_USERNAME!, password: process.env.OPERATOR_PASSWORD!, requirePostgres: true });
    await mkdir('/validation', { recursive: true });
    await writeFile('/validation/checkpoint.json', JSON.stringify(checkpoint), { mode: 0o600 });
    await writeFile('/reports/latest.json', JSON.stringify({ ...report, ok: false, restartPending: true }, null, 2));
    for (const check of report.checks) console.log(`OK · ${check}`);
  }
} catch (error) {
  const failure = error as Error & { code?: string };
  console.error(failure.code ? `Validação não concluída (${failure.code}).` : failure.message);
  process.exitCode = 1;
} finally { await pool.end(); }
