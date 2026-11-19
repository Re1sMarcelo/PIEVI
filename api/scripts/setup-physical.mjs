import { randomBytes, scryptSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';

const file = fileURLToPath(new URL('../../.env.physical', import.meta.url));
const password = randomBytes(16).toString('hex');
const salt = randomBytes(16);
const passwordHash = `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
try {
  writeFileSync(file, [
    '# Bancada ESP físico. Arquivo local: não versionar nem enviar inteiro ao colega.',
    '# Preencha com a identidade física combinada com o responsável pelo firmware.',
    'PHYSICAL_CHIP_ID=',
    '# IPv4 do notebook na rede da estufa. Atualize ao trocar de rede.',
    'LAN_IP=',
    'DEVICE_ID=bancada-01',
    'API_PORT=3000',
    '# local: broker neste notebook; external: broker já mantido pelo colega.',
    'MQTT_BROKER_MODE=local',
    'MQTT_PORT=1883',
    '# Usado apenas em external. Informar o endereço alcançável pelo notebook.',
    'MQTT_URL=',
    'MQTT_API_USERNAME=api-local',
    'MQTT_API_CLIENT_ID=pievi-api-local',
    `MQTT_API_PASSWORD=${randomBytes(24).toString('hex')}`,
    'MQTT_ESP_USERNAME=bancada-01',
    'MQTT_ESP_CLIENT_ID=pievi-esp-bancada-01',
    `MQTT_ESP_PASSWORD=${randomBytes(24).toString('hex')}`,
    'OPERATOR_USERNAME=operador',
    `OPERATOR_PASSWORD=${password}`,
    `OPERATOR_PASSWORD_HASH=${passwordHash}`,
    '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  console.log('Criado .env.physical com credenciais próprias. Preencha PHYSICAL_CHIP_ID e LAN_IP; consulte o guia GUIA-TESTE-ESP-FISICO.md.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env.physical já existe; identidade e credenciais preservadas.');
}
console.log('IPv4 disponíveis (escolha a interface que alcança celular e ESP):');
for (const [name, addresses] of Object.entries(networkInterfaces())) for (const address of addresses ?? []) {
  if (address.family === 'IPv4' && !address.internal) console.log(`  ${name}: ${address.address}`);
}
