import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MQTT_SCHEMA } from '../src/mqtt/schema.js';
import { MQTT_EXAMPLES } from '../src/mqtt/examples.js';
import { mqttTopic, validateMqttPacket } from '../src/mqtt/protocol.js';

const root = new URL('../../protocol/mqtt/v1/', import.meta.url);
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const files = new Map<string, string>([['schema.json', json(MQTT_SCHEMA)]]);
for (const example of MQTT_EXAMPLES) {
  const validation = validateMqttPacket(mqttTopic(example.payload.deviceId, example.channel), json(example.payload), example.retain);
  if (!validation.ok) throw new Error(`${example.name}: ${validation.error}`);
  files.set(`examples/${example.name}.json`, json(example.payload));
}
files.set('examples/index.json', json(MQTT_EXAMPLES.map(example => ({
  file: `${example.name}.json`, topic: mqttTopic(example.payload.deviceId, example.channel), qos: 1, retain: example.retain,
  publisher: ['commands', 'sync', 'receipts'].includes(example.channel) ? 'backend' : 'esp32',
}))));
for (const [path, content] of files) {
  const target = new URL(path, root);
  if (process.argv.includes('--check')) {
    if (await readFile(target, 'utf8') !== content) throw new Error(`Contrato exportado desatualizado: ${fileURLToPath(target)}`);
  } else {
    await mkdir(new URL('./', target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
}
process.stdout.write(`Contrato MQTT v1: ${files.size} arquivos ${process.argv.includes('--check') ? 'conferidos' : 'exportados'}, sem conexão com banco ou broker.\n`);
