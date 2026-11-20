// Valida, com o validador da API, cada payload que o firmware imprimiu na serial (linhas ">> <topico> <json>").
// Uso (pasta api): npx tsx scripts/validate-serial-log.ts ../tmp/physical-bench/serial.log
import { readFileSync } from 'node:fs';
import { validateMqttPacket } from '../src/mqtt/protocol.js';

const file = process.argv[2];
if (!file) { console.error('Informe o arquivo de log da serial.'); process.exit(2); }
const counts = new Map<string, { ok: number; bad: number }>();
let failures = 0;
for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
  const m = /^>> (\S+) (\{.*\})$/.exec(line);
  if (!m) continue;
  const [, topic, body] = m;
  const channel = topic.split('/').pop() ?? '?';
  const result = validateMqttPacket(topic, body, false);
  const c = counts.get(channel) ?? { ok: 0, bad: 0 };
  if (result.ok) c.ok++; else { c.bad++; failures++; if (failures <= 20) console.log(`INVALIDO ${channel}: ${result.error}\n  ${body.slice(0, 300)}`); }
  counts.set(channel, c);
}
for (const [ch, c] of counts) console.log(`${ch.padEnd(10)} validos=${c.ok} invalidos=${c.bad}`);
if (!counts.size) { console.log('Nenhum payload encontrado (ative "payloads on" na serial).'); process.exit(1); }
process.exit(failures ? 1 : 0);
