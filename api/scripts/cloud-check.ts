// Diagnostico da API publicada no Railway (mesmos itens de physical:check). Nao envia comandos as bombas.
// Operador: OPERATOR_USERNAME/OPERATOR_PASSWORD de .env.physical (o mesmo usuario do banco do Railway).
// Uso: npm.cmd run cloud:check -w api
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkPhysicalBench } from '../src/physical/check.js';
import { readPhysicalSettings } from '../src/physical/settings.js';
import { cloudDataDir, readCloudSettings } from '../src/cloud/settings.js';

try {
  const cloud = readCloudSettings();
  if (!cloud.apiUrl) throw new Error('Preencha CLOUD_API_URL em .env.cloud com o dominio publico do servico no Railway.');
  const bench = readPhysicalSettings();
  const report = await checkPhysicalBench({ url: cloud.apiUrl, username: bench.operatorUsername, password: bench.operatorPassword,
    infrastructureOnly: process.argv.includes('--infra') });
  mkdirSync(cloudDataDir, { recursive: true });
  const file = join(cloudDataDir, 'latest-check.json');
  writeFileSync(file, JSON.stringify({ ...report, apiUrl: cloud.apiUrl }, null, 2), 'utf8');
  for (const check of report.checks) console.log(`${check.status.toUpperCase()} · ${check.name}: ${check.detail}`);
  console.log(`API: ${cloud.apiUrl}\nRelatorio: ${file}`);
  process.exitCode = report.ok ? 0 : 1;
} catch (error) { console.error(error instanceof Error ? error.message : 'Falha na conferencia.'); process.exitCode = 1; }
