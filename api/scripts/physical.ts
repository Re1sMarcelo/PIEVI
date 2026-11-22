import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { startPhysicalBench } from '../src/physical/index.js';
import { physicalDataDir, readPhysicalSettings } from '../src/physical/settings.js';
import { describeDatabaseUrl } from '../src/physical/database.js';

// Deliberately does not load api/.env, .env.compose, the laboratory, or the virtual ESP.
let bench: Awaited<ReturnType<typeof startPhysicalBench>> | undefined;
let ownsLock = false;
const lock = join(physicalDataDir, 'physical.lock');
const cleanup = () => { if (ownsLock) { try { unlinkSync(lock); } catch {} ownsLock = false; } };
try {
  const settings = readPhysicalSettings();
  mkdirSync(physicalDataDir, { recursive: true });
  try {
    const pid = Number(readFileSync(lock, 'utf8'));
    if (!Number.isInteger(pid) || pid < 1) throw new Error('Lock da bancada inválido; confira se outra instância está rodando.');
    try { process.kill(pid, 0); throw new Error('A bancada física já está em execução. Encerre pelo Ctrl+C no outro terminal.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; unlinkSync(lock); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const descriptor = openSync(lock, 'wx'); ownsLock = true;
  try { writeFileSync(descriptor, String(process.pid)); } finally { closeSync(descriptor); }
  bench = await startPhysicalBench(settings, { dataDir: physicalDataDir });
  const banco = settings.databaseUrl ? `Banco PostgreSQL externo: ${describeDatabaseUrl(settings.databaseUrl)}` : `Banco PostgreSQL embarcado/PGlite: ${physicalDataDir}`;
  console.log(`Bancada FÍSICA iniciada; ESP virtual desativado neste processo.\nAPI local: ${bench.url}\n${banco}\nNenhum comando de bomba ou configuração foi enviado. Aguardando o ESP real.`);
  if (settings.lanIp) console.log(`API no celular: http://${settings.lanIp}:${settings.apiPort}\nBroker para o ESP: ${settings.brokerMode === 'local' ? `mqtt://${settings.lanIp}:${settings.mqttPort}` : 'externo, conforme combinado com o colega'}`);
  const interfaces = Object.values(networkInterfaces()).flat().filter(Boolean);
  if (settings.lanIp && !interfaces.some(address => address?.address === settings.lanIp)) console.warn('LAN_IP não está nas interfaces deste notebook. Atualize .env.physical antes de abrir o app.');
  console.log('Login e credenciais MQTT: consulte .env.physical. Ctrl+C encerra API/broker e preserva o banco.');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    void bench!.stop().then(() => { cleanup(); process.exit(0); }, () => { cleanup(); process.exit(1); });
  });
} catch (error) {
  await bench?.stop(); cleanup();
  const code = (error as NodeJS.ErrnoException).code;
  console.error(code === 'EADDRINUSE' ? 'Porta ocupada. Encerre dev:api, lab, outro broker ou Compose antes de iniciar a bancada física.' : error instanceof Error ? error.message : 'Não foi possível iniciar a bancada física.');
  process.exitCode = 1;
}
