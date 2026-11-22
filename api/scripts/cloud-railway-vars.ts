// Gera tmp/cloud/railway-variables.env para colar no servico da API no Railway (Variables -> Raw Editor).
// O arquivo contem senhas: fica so no notebook (tmp/ fora do Git). Nao imprime valores.
// Uso: npm.cmd run cloud:railway-vars -w api
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cloudDataDir, readCloudSettings } from '../src/cloud/settings.js';

try {
  const s = readCloudSettings();
  const vars: Record<string, string> = {
    NODE_ENV: 'production',
    PIEVI_DEVICE_MODE: 'mqtt',
    DEVICE_ID: s.deviceId,
    // Referencia ao servico Postgres do mesmo projeto (rede interna, sem TLS). Ajuste "Postgres" se o servico tiver outro nome.
    DATABASE_URL: '${{Postgres.DATABASE_URL}}',
    MQTT_URL: s.mqttUrl,
    MQTT_API_USERNAME: s.apiUsername,
    MQTT_API_PASSWORD: s.apiPassword,
    MQTT_API_CLIENT_ID: s.apiClientId,
  };
  mkdirSync(cloudDataDir, { recursive: true });
  const file = join(cloudDataDir, 'railway-variables.env');
  writeFileSync(file, Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', 'utf8');
  console.log(`Variaveis do servico da API: ${Object.keys(vars).join(', ')}.\nArquivo (com senhas, nao compartilhar): ${file}\nRailway -> servico da API -> Variables -> Raw Editor -> colar o conteudo -> Update Variables.`);
} catch (error) { console.error(error instanceof Error ? error.message : 'Falha.'); process.exitCode = 1; }
