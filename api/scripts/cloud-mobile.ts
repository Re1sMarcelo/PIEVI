// Abre o app no Expo Go falando com a API do Railway (nao com o notebook).
// O notebook so serve o pacote JavaScript do app (Metro); os dados vem da nuvem.
//   npm.cmd run cloud:mobile -w api            -> celular na mesma rede Wi-Fi do notebook
//   npm.cmd run cloud:mobile -w api -- --tunnel -> celular em qualquer rede (usa o tunel do Expo)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCloudSettings } from '../src/cloud/settings.js';

try {
  const cloud = readCloudSettings();
  if (!cloud.apiUrl) throw new Error('Preencha CLOUD_API_URL em .env.cloud com o dominio publico do servico no Railway.');
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve('expo/package.json')), 'bin', 'cli');
  const tunnel = process.argv.includes('--tunnel');
  console.log(`App -> ${cloud.apiUrl} (API no Railway). Escaneie o QR no Expo Go.${tunnel ? ' Modo tunel.' : ' Celular na mesma rede Wi-Fi do notebook.'}`);
  const child = spawn(process.execPath, [cli, 'start', '--go', '--clear', '--port', '8081', ...(tunnel ? ['--tunnel'] : ['--lan'])], {
    cwd: fileURLToPath(new URL('../../mobile/', import.meta.url)), stdio: 'inherit',
    env: { ...process.env, EXPO_PUBLIC_API_URL: cloud.apiUrl },
  });
  child.on('error', () => { console.error('Nao foi possivel iniciar o Expo. Execute npm.cmd ci na raiz.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} catch (error) { console.error(error instanceof Error ? error.message : 'Falha ao iniciar o app.'); process.exitCode = 1; }
