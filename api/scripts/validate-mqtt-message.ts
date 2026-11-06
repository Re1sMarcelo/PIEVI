import { readFileSync, statSync } from 'node:fs';
import { MQTT_MAX_PAYLOAD_BYTES, validateMqttPacket } from '../src/mqtt/protocol.js';

const args = process.argv.slice(2);
const value = (flag: string) => args.indexOf(flag) >= 0 ? args[args.indexOf(flag) + 1] : undefined;
const topic = value('--topic');
const file = value('--file');
if (!topic || !file) {
  process.stderr.write('Uso: npm.cmd run contract:validate -w api -- --topic pievi/v1/devices/bancada-01/telemetry --file ../protocol/mqtt/v1/examples/telemetry.json [--retained]\n');
  process.exit(2);
}
try {
  if (statSync(file).size > MQTT_MAX_PAYLOAD_BYTES) throw new Error('Arquivo acima de 32 KiB.');
  const result = validateMqttPacket(topic, readFileSync(file), args.includes('--retained'));
  process.stdout.write(`${JSON.stringify(result.ok ? { ok: true, channel: result.channel, deviceId: result.deviceId } : result)}\n`);
  if (!result.ok) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Não foi possível ler a mensagem.'}\n`);
  process.exitCode = 1;
}
