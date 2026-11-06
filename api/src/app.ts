import Fastify, { type FastifyError } from 'fastify';
import type { CommandRequest, Config, DeviceEvent, LoginResponse, Telemetry } from './contracts.js';
import { DEVICE_ID, Simulator } from './simulator.js';
import { AuthDatabaseError, MemoryAuthStore, PostgresAuthStore, type AuthStore } from './auth/store.js';
import { createDatabasePool } from './database.js';
import { configError } from './controlConfig.js';

export function createApp(options: { authStore?: AuthStore; logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const simulator = new Simulator();
  const timer = setInterval(() => simulator.recordTelemetry(), 15_000);
  timer.unref();
  const controlTimer = setInterval(() => simulator.tick(), 1000);
  controlTimer.unref();
  const demoAuth = process.env.NODE_ENV !== 'production' && process.env.PIEVI_DEMO_AUTH === '1';
  const auth = options.authStore ?? (() => {
    if (process.env.DATABASE_URL) {
      const pool = createDatabasePool(process.env.DATABASE_URL);
      pool.on('error', () => app.log.error('Conexão ociosa com PostgreSQL interrompida.'));
      return new PostgresAuthStore(pool, () => pool.end());
    }
    if (process.env.NODE_ENV === 'production') throw new Error('Configure DATABASE_URL para produção.');
    return new MemoryAuthStore(process.env.OPERATOR_USERNAME ?? (demoAuth ? 'demo' : ''),
      process.env.OPERATOR_PASSWORD_HASH, demoAuth, DEVICE_ID);
  })();
  app.addHook('onReady', async () => {
    await auth.initialize();
    app.log.info({ authStorage: auth.storage }, 'Autenticação inicializada.');
  });
  app.addHook('onClose', async () => { clearInterval(timer); clearInterval(controlTimer); await auth.close(); });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AuthDatabaseError) {
      request.log.error('PostgreSQL indisponível para autenticação.');
      return reply.code(503).send({ error: 'Autenticação temporariamente indisponível. Tente novamente.' });
    }
    const failure = error instanceof Error ? error as FastifyError : undefined;
    if (failure?.statusCode && failure.statusCode < 500) return reply.code(failure.statusCode).send({ error: 'Requisição inválida.' });
    request.log.error({ code: failure?.code }, 'Falha ao processar requisição.');
    return reply.code(500).send({ error: 'Não foi possível processar a requisição.' });
  });

  app.addHook('preHandler', async (request, reply) => {
    if (['/health','/v1/auth/login'].includes(request.routeOptions.url ?? '')) return;
    const token = request.headers.authorization?.match(/^Bearer\s+([0-9a-f]{64})$/i)?.[1];
    if (!token || !await auth.session(token)) {
      return reply.code(401).send({ error: 'Sessão ausente ou expirada.' });
    }
    const { deviceId } = request.params as { deviceId?: string };
    if (deviceId && !await auth.canAccessDevice(token, deviceId)) {
      return reply.code(403).send({ error: 'Operador sem acesso a esta bancada.' });
    }
  });

  app.get('/health', async () => ({ status: 'ok', authStorage: auth.storage, simulation: true }));

  app.post('/v1/auth/login', async (request, reply): Promise<LoginResponse | { error: string }> => {
    const body = request.body as { username?: unknown; password?: unknown } | null;
    if (typeof body?.username !== 'string' || typeof body?.password !== 'string' ||
      body.username.trim().length < 3 || body.username.trim().length > 254 || !body.password.length ||
      Buffer.byteLength(body.password, 'utf8') > 1024) return reply.code(400).send({ error: 'Informe usuário ou e-mail e senha válidos.' });
    const session = await auth.login(body.username, body.password);
    if (!session) {
      reply.code(401);
      return { error: 'Credenciais inválidas.' };
    }
    reply.header('Cache-Control', 'no-store');
    return session;
  });

  app.post('/v1/auth/logout', async (request) => {
    const token = request.headers.authorization?.match(/^Bearer\s+([0-9a-f]{64})$/i)?.[1];
    if (token) await auth.logout(token);
    return { ok: true };
  });

  app.get('/v1/devices/:deviceId/snapshot', async (request, reply) => {
    if (!isDevice(request.params)) return reply.code(404).send({ error: 'Dispositivo não encontrado.' });
    return simulator.getSnapshot();
  });

  app.put('/v1/devices/:deviceId/simulation', async (request, reply) => {
    if (process.env.NODE_ENV === 'production' || !isDevice(request.params)) return reply.code(404).send({ error: 'Recurso indisponível.' });
    const input = request.body as { scenario?: unknown; advanceSeconds?: unknown } | null;
    const snapshot = input?.advanceSeconds !== undefined && input.scenario === undefined
      ? simulator.advanceTime(input.advanceSeconds) : input?.advanceSeconds === undefined ? simulator.setScenario(input?.scenario) : null;
    if (!snapshot) return reply.code(400).send({ error: 'Cenário de simulação inválido.' });
    return snapshot;
  });

  app.get('/v1/devices/:deviceId/telemetry', async (request, reply) => {
    if (!isDevice(request.params)) return reply.code(404).send({ error: 'Dispositivo não encontrado.' });
    const page = paginate(simulator.getTelemetry(), request.query, (item: Telemetry) => item.occurredAt);
    if (!page) return reply.code(400).send({ error: 'Período ou paginação inválidos.' });
    return page;
  });

  app.get('/v1/devices/:deviceId/events', async (request, reply) => {
    if (!isDevice(request.params)) return reply.code(404).send({ error: 'Dispositivo não encontrado.' });
    const page = paginate(simulator.getEvents(), request.query, (item: DeviceEvent) => item.occurredAt);
    if (!page) return reply.code(400).send({ error: 'Período ou paginação inválidos.' });
    return page;
  });

  app.get('/v1/devices/:deviceId/alerts', async (request, reply) => {
    if (!isDevice(request.params)) return reply.code(404).send({ error: 'Dispositivo não encontrado.' });
    return { items: simulator.getAlerts() };
  });

  app.get('/v1/devices/:deviceId/history', async (request, reply) => {
    if (!isDevice(request.params)) return reply.code(404).send({ error: 'Dispositivo não encontrado.' });
    return simulator.getHistory();
  });

  app.post('/v1/devices/:deviceId/alerts/:alertId/ack', async (request, reply) => {
    if (!isDevice(request.params)) return reply.code(404).send({ error: 'Dispositivo não encontrado.' });
    const { alertId } = request.params as { alertId: string };
    const alert = simulator.acknowledgeAlert(alertId);
    if (!alert) return reply.code(404).send({ error: 'Alerta não encontrado.' });
    return alert;
  });

  app.get('/v1/devices/:deviceId/config', async (request, reply) => {
    if (!isDevice(request.params)) return reply.code(404).send({ error: 'Dispositivo não encontrado.' });
    reply.header('ETag', `"${simulator.getSnapshot().configVersion}"`);
    return simulator.getConfig();
  });

  app.put('/v1/devices/:deviceId/config', async (request, reply) => {
    if (!isDevice(request.params)) return reply.code(404).send({ error: 'Dispositivo não encontrado.' });
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply.code(400).send({ error: 'Configuração inválida.' });
    const expected = request.headers['if-match'];
    if (expected !== undefined && expected !== `"${simulator.getSnapshot().configVersion}"`) return reply.code(409).send({ error: 'A configuração foi alterada em outra sessão. Recarregue a versão aplicada antes de salvar.' });
    const validationError = configError({ ...simulator.getConfig(), ...body });
    const config = simulator.updateConfig(body as Partial<Config>);
    if (!config) return reply.code(validationError ? 400 : 409).send({ error: validationError ?? 'Configuração não aplicada: dispositivo sem estado recente. Reconecte e tente novamente.' });
    return config;
  });

  app.post('/v1/devices/:deviceId/commands', async (request, reply) => {
    if (!isDevice(request.params)) return reply.code(404).send({ error: 'Dispositivo não encontrado.' });
    const body = request.body as Partial<CommandRequest> | null;
    if (!body || typeof body.commandId !== 'string' || body.commandId.length < 8 || body.commandId.length > 100 ||
      typeof body.pumpId !== 'string' || typeof body.action !== 'string' || typeof body.expiresAt !== 'string') {
      return reply.code(400).send({ error: 'Comando inválido.' });
    }
    const command = simulator.issueCommand(body as CommandRequest);
    return reply.code(command.status === 'accepted' ? 202 : command.status === 'completed' ? 200 : 422).send(command);
  });

  app.get('/v1/devices/:deviceId/commands/:commandId', async (request, reply) => {
    if (!isDevice(request.params)) return reply.code(404).send({ error: 'Dispositivo não encontrado.' });
    const { commandId } = request.params as { commandId: string };
    const command = simulator.getCommand(commandId);
    if (!command) return reply.code(404).send({ error: 'Comando não encontrado.' });
    return command;
  });

  return app;
}

function isDevice(params: unknown): boolean {
  return (params as { deviceId?: unknown }).deviceId === DEVICE_ID;
}

function paginate<T>(items: T[], query: unknown, timestamp: (item: T) => string) {
  const input = query as { from?: string; to?: string; before?: string; limit?: string };
  const limit = input.limit === undefined ? 50 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return null;
  const from = input.from === undefined ? -Infinity : Date.parse(input.from);
  const to = input.to === undefined ? Infinity : Date.parse(input.to);
  const before = input.before === undefined ? Infinity : Date.parse(input.before);
  if (Number.isNaN(from) || Number.isNaN(to) || Number.isNaN(before) || from > to) return null;
  const filtered = items.filter((item) => {
    const time = Date.parse(timestamp(item));
    return time >= from && time <= to && time < before;
  });
  const page = filtered.slice(0, limit);
  return { items: page, nextCursor: filtered.length > limit ? timestamp(page[page.length - 1]) : null };
}
