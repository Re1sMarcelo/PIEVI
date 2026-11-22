import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { isIP } from 'node:net';
import { isPasswordHash, verifyPassword } from '../auth/password.js';

export const physicalSettingsFile = fileURLToPath(new URL('../../../.env.physical', import.meta.url));
export const physicalDataDir = fileURLToPath(new URL('../../../tmp/physical-bench/', import.meta.url));

export interface PhysicalSettings {
  deviceId: 'bancada-01'; chipId: string; lanIp: string; apiPort: number; mqttPort: number;
  brokerMode: 'local' | 'external'; brokerUrl: string;
  apiUsername: string; apiPassword: string; apiClientId: string; espPassword: string;
  operatorUsername: string; operatorPassword: string; operatorPasswordHash: string;
  /** Opcional: PostgreSQL externo (postgresql://...). Vazio = PGlite embarcado em tmp/physical-bench/. */
  databaseUrl?: string;
}

export function readPhysicalSettings(file = physicalSettingsFile): PhysicalSettings {
  let values: NodeJS.Dict<string>;
  try { values = parseEnv(readFileSync(file, 'utf8')); }
  catch { throw new Error('Não foi possível ler .env.physical. Execute npm.cmd run setup:physical.'); }
  const required = (key: string) => {
    const value = values[key]?.trim();
    if (!value) throw new Error(`Preencha ${key} em .env.physical.`);
    return value;
  };
  const port = (key: string) => {
    const value = required(key);
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error(`${key} deve ser uma porta entre 1 e 65535.`);
    return Number(value);
  };
  if (required('DEVICE_ID') !== 'bancada-01') throw new Error('O app desta bancada usa DEVICE_ID=bancada-01.');
  const chipId = values.PHYSICAL_CHIP_ID?.trim() ?? '';
  if (chipId && (/^(virtual|simulator):/i.test(chipId) || chipId.length > 200)) throw new Error('PHYSICAL_CHIP_ID deve identificar o hardware real, sem prefixo virtual: ou simulator:.');
  const lanIp = values.LAN_IP?.trim() ?? '';
  if (lanIp && (isIP(lanIp) !== 4 || /^(0\.|127\.|169\.254\.)/.test(lanIp))) throw new Error('LAN_IP deve ser o IPv4 do notebook na rede da estufa.');
  const brokerMode = required('MQTT_BROKER_MODE');
  if (brokerMode !== 'local' && brokerMode !== 'external') throw new Error('MQTT_BROKER_MODE deve ser local ou external.');
  const mqttPort = port('MQTT_PORT');
  let brokerUrl = `mqtt://127.0.0.1:${mqttPort}`;
  if (brokerMode === 'external') {
    brokerUrl = required('MQTT_URL');
    let url: URL;
    try { url = new URL(brokerUrl); } catch { throw new Error('MQTT_URL inválida.'); }
    if (!['mqtt:', 'mqtts:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('Use MQTT_URL=mqtt://HOST:PORTA ou mqtts://HOST:PORTA, com credenciais nos campos separados.');
  }
  const operatorUsername = required('OPERATOR_USERNAME');
  const operatorPasswordHash = required('OPERATOR_PASSWORD_HASH');
  if (!/^[a-zA-Z0-9_.-]{3,100}$/.test(operatorUsername) || !isPasswordHash(operatorPasswordHash)) throw new Error('Credenciais do operador inválidas em .env.physical.');
  const databaseUrl = values.PHYSICAL_DATABASE_URL?.trim() ?? '';
  if (databaseUrl) {
    let url: URL;
    try { url = new URL(databaseUrl); } catch { throw new Error('PHYSICAL_DATABASE_URL inválida.'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) throw new Error('Use PHYSICAL_DATABASE_URL=postgresql://USUARIO:SENHA@HOST:PORTA/BANCO, ou deixe vazio para o banco embarcado.');
  }
  return { deviceId: 'bancada-01', chipId, lanIp, apiPort: port('API_PORT'), mqttPort, brokerMode, brokerUrl, databaseUrl,
    apiUsername: brokerMode === 'local' ? 'api-local' : required('MQTT_API_USERNAME'),
    apiClientId: brokerMode === 'local' ? 'pievi-api-local' : required('MQTT_API_CLIENT_ID'),
    apiPassword: required('MQTT_API_PASSWORD'), espPassword: required('MQTT_ESP_PASSWORD'),
    operatorUsername, operatorPassword: required('OPERATOR_PASSWORD'), operatorPasswordHash };
}

export async function validatePhysicalIdentity(settings: PhysicalSettings) {
  if (!settings.chipId) throw new Error('Preencha PHYSICAL_CHIP_ID em .env.physical com a identidade combinada com seu colega. Não use uma identidade fictícia para abrir o banco da bancada.');
  if (!await verifyPassword(settings.operatorPassword, settings.operatorPasswordHash)) throw new Error('OPERATOR_PASSWORD não corresponde ao hash. Preserve as credenciais geradas pelo setup.');
}
