import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { createDatabasePool } from './database.js';
import { PostgresAuthStore } from './auth/store.js';
import { postgresDatabase } from './persistence/database.js';
import { IntegratedRuntime } from './integrated/runtime.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const mode=process.env.PIEVI_DEVICE_MODE ?? 'simulator';
if (!['simulator','mqtt'].includes(mode)) throw new Error('PIEVI_DEVICE_MODE deve ser simulator ou mqtt.');
const integratedOptions=(()=>{
  if(mode!=='mqtt') return {};
  if(!process.env.DATABASE_URL || !process.env.MQTT_URL || !process.env.MQTT_API_USERNAME || !process.env.MQTT_API_PASSWORD) throw new Error('Modo mqtt exige DATABASE_URL, MQTT_URL, MQTT_API_USERNAME e MQTT_API_PASSWORD.');
  const pool=createDatabasePool(process.env.DATABASE_URL);pool.on('error',()=>process.stderr.write('PostgreSQL indisponível.\n'));
  return {authStore:new PostgresAuthStore(pool,()=>pool.end()),integrated:new IntegratedRuntime({database:postgresDatabase(pool),deviceId:process.env.DEVICE_ID ?? 'bancada-01',
    virtual:process.env.MQTT_DEVICE_KIND==='virtual',broker:{url:process.env.MQTT_URL,username:process.env.MQTT_API_USERNAME,password:process.env.MQTT_API_PASSWORD,clientId:process.env.MQTT_API_CLIENT_ID ?? 'pievi-api-local'}})};
})();
const app = createApp(integratedOptions);
const port = Number(process.env.PORT ?? 3000);

try {
  await app.listen({ host: '0.0.0.0', port });
} catch (error) {
  app.log.error({ code: (error as { code?: string }).code, message: (error as Error).message }, 'Não foi possível iniciar a API.');
  await app.close();
  process.exit(1);
}
for(const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=>{void app.close().then(()=>process.exit(0));});
