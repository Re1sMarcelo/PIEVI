import { existsSync, readFileSync, statSync } from 'node:fs';
import { createDatabasePool } from '../src/database.js';
import { postgresDatabase } from '../src/persistence/database.js';
import { PostgresDeviceStore } from '../src/persistence/store.js';
import { MQTT_MAX_PAYLOAD_BYTES } from '../src/mqtt/protocol.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const args=process.argv.slice(2); const operation=args[0];
const argument=(flag:string)=>args.includes(flag) ? args[args.indexOf(flag)+1] : undefined;
const deviceId=argument('--device');
if (!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL em api/.env.');
if (!deviceId || !['enable','sync','ingest','history'].includes(operation)) throw new Error('Uso: device:db -- enable|sync|ingest|history --device bancada-01 [--chip-id ID] [--topic TOPICO --file JSON --retained]');
const pool=createDatabasePool(process.env.DATABASE_URL);
pool.on('error',()=>process.stderr.write('Conexão PostgreSQL interrompida.\n'));
const store=new PostgresDeviceStore(postgresDatabase(pool));
try {
  let result:unknown;
  if (operation==='enable') {
    const chip=argument('--chip-id'); if (!chip) throw new Error('enable exige --chip-id físico ou virtual explícito.');
    result=await store.enableDevice(deviceId,chip);
  } else if (operation==='sync') result=await store.createSyncRequest(deviceId);
  else if (operation==='history') {
    const history=await store.readHistory(deviceId);
    result=Object.fromEntries(Object.entries(history).map(([table,rows])=>[table,{returned:rows.length,latest:rows[0] ?? null}]));
  } else {
    const topic=argument('--topic'); const file=argument('--file');
    if (!topic || !file) throw new Error('ingest exige --topic e --file. Caminho relativo ao workspace api.');
    if (statSync(file).size>MQTT_MAX_PAYLOAD_BYTES) throw new Error('Payload acima de 32 KiB.');
    result=await store.ingest(topic,readFileSync(file),{authenticatedDeviceId:deviceId,retained:args.includes('--retained')});
  }
  console.log(JSON.stringify(result,null,2));
} catch (error) {
  const failure=error as Error & {code?:string};
  process.stderr.write(failure.code ? `Operação não confirmada (${failure.code}).\n` : `${failure.message}\n`);
  process.exitCode=1;
} finally { await pool.end(); }
