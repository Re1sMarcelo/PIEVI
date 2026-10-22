import { existsSync } from 'node:fs';
import { createApp } from './app.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const app = createApp();
const port = Number(process.env.PORT ?? 3000);

try {
  await app.listen({ host: '0.0.0.0', port });
} catch (error) {
  app.log.error({ code: (error as { code?: string }).code, message: (error as Error).message }, 'Não foi possível iniciar a API.');
  await app.close();
  process.exit(1);
}
