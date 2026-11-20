import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { PostgresAuthStore } from '../auth/store.js';
import { IntegratedRuntime } from '../integrated/runtime.js';
import { startLocalBroker } from '../lab/broker.js';
import { openPhysicalDatabase } from './database.js';
import { validatePhysicalIdentity, type PhysicalSettings } from './settings.js';

// This entry point never imports or creates VirtualESP and never sends an actuation/configuration command.
export async function startPhysicalBench(settings: PhysicalSettings, options: { dataDir?: string; host?: string; apiPort?: number; brokerPort?: number } = {}) {
  if (process.env.NODE_ENV === 'production') throw new Error('A bancada física local é exclusiva de desenvolvimento.');
  await validatePhysicalIdentity(settings);
  if (options.dataDir) mkdirSync(options.dataDir, { recursive: true });
  const data = await openPhysicalDatabase({ chipId: settings.chipId, username: settings.operatorUsername, passwordHash: settings.operatorPasswordHash },
    options.dataDir ? join(options.dataDir, 'postgres') : undefined);
  let broker: Awaited<ReturnType<typeof startLocalBroker>> | undefined;
  let app: ReturnType<typeof createApp> | undefined;
  let closed = false;
  const stop = async () => {
    if (closed) return;
    closed = true;
    try { await app?.close(); }
    finally { try { await broker?.close(); } finally { await data.db.close(); } }
  };
  try {
    const host = options.host ?? '0.0.0.0';
    if (settings.brokerMode === 'local') broker = await startLocalBroker(settings.deviceId, options.brokerPort ?? settings.mqttPort, {
      host, apiPassword: settings.apiPassword, espPassword: settings.espPassword,
    });
    const runtime = new IntegratedRuntime({ database: data.database, deviceId: settings.deviceId, virtual: false, storage: 'pglite',
      broker: broker?.api ?? { url: settings.brokerUrl, username: settings.apiUsername, password: settings.apiPassword, clientId: settings.apiClientId } });
    app = createApp({ authStore: new PostgresAuthStore(data.queryProxy), integrated: runtime, logger: false });
    await app.listen({ host, port: options.apiPort ?? settings.apiPort });
    const url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
    return { app, runtime, db: data.db, broker, url, stop };
  } catch (error) { await stop(); throw error; }
}
