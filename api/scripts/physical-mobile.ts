import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { readPhysicalSettings } from '../src/physical/settings.js';

try {
  const settings = readPhysicalSettings();
  if (!settings.lanIp) throw new Error('Preencha LAN_IP em .env.physical com o IPv4 do notebook na rede da estufa.');
  if (!Object.values(networkInterfaces()).flat().some(address => address?.address === settings.lanIp)) throw new Error('LAN_IP não pertence às interfaces atuais deste notebook. Confira o Wi-Fi e atualize .env.physical.');
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve('expo/package.json')), 'bin', 'cli');
  const url = `http://${settings.lanIp}:${settings.apiPort}`;
  console.log(`App da bancada física → ${url}. Escaneie o QR no Expo Go. As URLs antigas de mobile/.env são ignoradas neste comando.`);
  const child = spawn(process.execPath, [cli, 'start', '--go', '--offline', '--clear', '--port', '8081'], {
    cwd: fileURLToPath(new URL('../../mobile/', import.meta.url)), stdio: 'inherit',
    env: { ...process.env, EXPO_PUBLIC_API_URL: url, REACT_NATIVE_PACKAGER_HOSTNAME: settings.lanIp },
  });
  child.on('error', () => { console.error('Não foi possível iniciar o Expo. Execute npm.cmd ci na raiz.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} catch (error) { console.error(error instanceof Error ? error.message : 'Falha ao iniciar app físico.'); process.exitCode = 1; }
