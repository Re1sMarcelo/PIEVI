import { randomBytes, scryptSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../../.env.compose', import.meta.url));
const password = randomBytes(18).toString('hex');
const salt = randomBytes(16);
const hash = `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
try {
  writeFileSync(file, [
    '# Credenciais exclusivas desta instalação de desenvolvimento. Não compartilhar.',
    `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}`,
    `MQTT_API_PASSWORD=${randomBytes(24).toString('hex')}`,
    `MQTT_ESP_PASSWORD=${randomBytes(24).toString('hex')}`,
    'OPERATOR_USERNAME=operador',
    `OPERATOR_PASSWORD=${password}`,
    `OPERATOR_PASSWORD_HASH=${hash}`,
    'API_PORT=3000',
    'MQTT_PORT=1883',
    'API_BIND=0.0.0.0',
    '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  console.log('Criado .env.compose. Consulte OPERATOR_USERNAME/OPERATOR_PASSWORD nesse arquivo para entrar no app.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('.env.compose já existe; credenciais preservadas.');
}
