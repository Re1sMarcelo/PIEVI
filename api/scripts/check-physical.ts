import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkPhysicalBench } from '../src/physical/check.js';
import { physicalDataDir, readPhysicalSettings } from '../src/physical/settings.js';

try {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--infra') || args.length > 1) throw new Error('Uso: physical:check [--infra].');
  const settings = readPhysicalSettings();
  const report = await checkPhysicalBench({ url: `http://127.0.0.1:${settings.apiPort}`, username: settings.operatorUsername,
    password: settings.operatorPassword, infrastructureOnly: args.includes('--infra') });
  mkdirSync(physicalDataDir, { recursive: true });
  const file = join(physicalDataDir, 'latest-check.json');
  writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
  for (const check of report.checks) console.log(`${check.status.toUpperCase()} · ${check.name}: ${check.detail}`);
  console.log(`Resultado: ${report.readyForManualTests ? 'Pré-condições de software atendidas; executar checklist físico supervisionado.' : report.ok ? 'Infraestrutura conferida; ainda há itens pendentes no ESP.' : 'Há falhas a resolver antes do ensaio.'}\nRelatório: ${file}\nEsta verificação não envia comandos às bombas.`);
  process.exitCode = report.ok ? 0 : 1;
} catch (error) { console.error(error instanceof Error ? error.message : 'Falha na conferência.'); process.exitCode = 1; }
