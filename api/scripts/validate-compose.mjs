import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../../', import.meta.url));
function compose(args) {
  const result = spawnSync('docker', ['compose', '--env-file', '.env.compose', ...args], { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
compose(['run', '--rm', 'validate']);
compose(['stop', 'api', 'esp-virtual', 'broker']);
compose(['restart', 'postgres']);
compose(['up', '-d', '--wait', 'api', 'esp-virtual']);
compose(['run', '--rm', 'validate', 'node', '--import', 'tsx', 'scripts/validate-compose.ts', '--resume']);
console.log('Relatório: tmp/compose-validation/latest.json');
