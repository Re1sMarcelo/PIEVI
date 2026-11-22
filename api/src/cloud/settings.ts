// Configuracao local da operacao em nuvem (Railway + EMQX Cloud): .env.cloud na raiz, fora do Git.
// Os scripts cloud:* leem daqui; o servico no Railway recebe as mesmas chaves como variaveis (cloud:railway-vars).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const cloudSettingsFile = fileURLToPath(new URL('../../../.env.cloud', import.meta.url));
export const cloudDataDir = fileURLToPath(new URL('../../../tmp/cloud/', import.meta.url));

export interface CloudSettings {
  deviceId: 'bancada-01';
  /** URL publica HTTPS da API no Railway (vazia ate o primeiro deploy). */
  apiUrl: string;
  emqxHost: string; emqxPort: number; mqttUrl: string;
  apiUsername: string; apiPassword: string; apiClientId: string;
  espUsername: string; espPassword: string; espClientId: string;
  /** URL publica do Postgres do Railway (scripts no notebook). No servico do Railway use a referencia interna. */
  databasePublicUrl: string;
}

export function readCloudSettings(file = cloudSettingsFile): CloudSettings {
  if (!existsSync(file)) throw new Error('Arquivo .env.cloud ausente na raiz. Copie .env.cloud.example e preencha (ver GUIA-NUVEM.md).');
  const values = parseEnv(readFileSync(file, 'utf8'));
  const required = (key: string) => {
    const value = values[key]?.trim();
    if (!value) throw new Error(`Preencha ${key} em .env.cloud.`);
    return value;
  };
  const emqxHost = required('EMQX_HOST');
  if (!/^[a-z0-9.-]+$/i.test(emqxHost)) throw new Error('EMQX_HOST deve ser so o endereco (sem mqtts:// e sem porta).');
  const emqxPort = Number(values.EMQX_PORT?.trim() || 8883);
  if (!Number.isInteger(emqxPort) || emqxPort < 1 || emqxPort > 65535) throw new Error('EMQX_PORT invalida.');
  const apiUrl = (values.CLOUD_API_URL?.trim() ?? '').replace(/\/+$/, '');
  if (apiUrl && !/^https:\/\/[a-z0-9.-]+$/i.test(apiUrl)) throw new Error('CLOUD_API_URL deve ser https://DOMINIO (sem caminho).');
  const databasePublicUrl = values.DATABASE_PUBLIC_URL?.trim() ?? '';
  if (databasePublicUrl && !/^postgres(ql)?:\/\//.test(databasePublicUrl)) throw new Error('DATABASE_PUBLIC_URL deve comecar com postgresql://');
  if ((values.DEVICE_ID?.trim() || 'bancada-01') !== 'bancada-01') throw new Error('O app desta bancada usa DEVICE_ID=bancada-01.');
  return { deviceId: 'bancada-01', apiUrl, emqxHost, emqxPort, mqttUrl: `mqtts://${emqxHost}:${emqxPort}`,
    apiUsername: required('MQTT_API_USERNAME'), apiPassword: required('MQTT_API_PASSWORD'),
    apiClientId: values.MQTT_API_CLIENT_ID?.trim() || 'pievi-api-cloud',
    espUsername: values.MQTT_ESP_USERNAME?.trim() || 'bancada-01', espPassword: required('MQTT_ESP_PASSWORD'),
    espClientId: values.MQTT_ESP_CLIENT_ID?.trim() || 'pievi-esp-bancada-01', databasePublicUrl };
}
