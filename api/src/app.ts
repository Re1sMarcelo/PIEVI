import Fastify, { type FastifyError } from 'fastify';
import type { CommandRequest, Config, DeviceEvent, LoginResponse, Telemetry } from './contracts.js';
import { DEVICE_ID, Simulator } from './simulator.js';
import { AuthDatabaseError, MemoryAuthStore, PostgresAuthStore, type AuthStore } from './auth/store.js';
import { createDatabasePool } from './database.js';
import { GoogleAuthService, GoogleBusyError, GoogleRepository, GoogleTokenError, GoogleTokenVerifier } from './auth/google.js';

export function createApp(options: { authStore?: AuthStore; googleAuth?: GoogleAuthService; logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const simulator = new Simulator();
  const timer = setInterval(() => simulator.recordTelemetry(), 15_000);
  timer.unref();
  const demoAuth = process.env.NODE_ENV !== 'production' && process.env.PIEVI_DEMO_AUTH === '1';
  let configuredGoogle: GoogleAuthService | undefined;
  const auth = options.authStore ?? (() => {
    if (process.env.DATABASE_URL) {
      const pool = createDatabasePool(process.env.DATABASE_URL);
      pool.on('error', () => app.log.error('Conexão ociosa com PostgreSQL interrompida.'));
      const audiences = process.env.GOOGLE_CLIENT_IDS?.split(',').map(value=>value.trim()).filter(Boolean) ?? [];
      if(audiences.length) configuredGoogle=new GoogleAuthService(new GoogleRepository(pool),new GoogleTokenVerifier(audiences));
      return new PostgresAuthStore(pool, () => pool.end());
    }
    if (process.env.NODE_ENV === 'production') throw new Error('Configure DATABASE_URL para produção.');
    if (process.env.GOOGLE_CLIENT_IDS?.trim()) throw new Error('O login Google exige DATABASE_URL e a migração 003_google_auth.sql.');
    return new MemoryAuthStore(process.env.OPERATOR_USERNAME ?? (demoAuth ? 'demo' : ''),
      process.env.OPERATOR_PASSWORD_HASH, demoAuth, DEVICE_ID);
  })();
  const google = options.googleAuth ?? configuredGoogle;

  app.addHook('onReady', async () => {
    await auth.initialize();
    await google?.initialize();
    app.log.info({ authStorage: auth.storage }, 'Autenticação inicializada.');
  });
  app.addHook('onClose', async () => { clearInterval(timer); await auth.close(); });
  app.setErrorHandler((error, request, reply) => {
    if(error instanceof GoogleTokenError) return reply.code(401).send({error:error.message});
    if(error instanceof GoogleBusyError) return reply.code(503).send({error:error.message});
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
    if (['/health','/v1/auth/login','/v1/auth/google/challenge','/v1/auth/google/login','/v1/auth/google/requests'].includes(request.routeOptions.url ?? '')) return;
    const token = request.headers.authorization?.match(/^Bearer\s+([0-9a-f]{64})$/i)?.[1];
    if (!token || !await auth.session(token)) {
      return reply.code(401).send({ error: 'Sessão ausente ou expirada.' });
    }
    const { deviceId } = request.params as { deviceId?: string };
    if (deviceId && !await auth.canAccessDevice(token, deviceId)) {
      return reply.code(403).send({ error: 'Operador sem acesso a esta bancada.' });
    }
  });

  app.get('/health', async () => ({ status: 'ok', authStorage: auth.storage, simulation: true, googleAuthEnabled: !!google }));

  app.post('/v1/auth/google/challenge', async (_request,reply) => {
    if(!google) return reply.code(503).send({error:'Login Google não configurado nesta API.'});
    reply.header('Cache-Control','no-store'); return google.challenge();
  });
  app.post('/v1/auth/google/login', async (request,reply) => {
    if(!google) return reply.code(503).send({error:'Login Google não configurado nesta API.'});
    const body=request.body as {challengeId?:unknown;idToken?:unknown;password?:unknown}|null;
    if(typeof body?.challengeId!=='string'||!/^[0-9a-f]{64}$/.test(body.challengeId)||
      typeof body.idToken!=='string'||!body.idToken.length||body.idToken.length>16000||
      (body.password!==undefined&&(typeof body.password!=='string'||Buffer.byteLength(body.password,'utf8')>1024))) {
      return reply.code(400).send({error:'Solicitação de login Google inválida.'});
    }
    const result=await google.login(body.challengeId,body.idToken,body.password as string|undefined);
    reply.header('Cache-Control','no-store');
    if(result.status==='denied') return reply.code(403).send({error:'Esta conta não está autorizada para entrar.'});
    return result;
  });
  app.post('/v1/auth/google/requests', async (request,reply) => {
    if(!google) return reply.code(503).send({error:'Login Google não configurado nesta API.'});
    const body=request.body as {requestTicket?:unknown}|null;
    if(typeof body?.requestTicket!=='string'||!/^[0-9a-f]{64}$/.test(body.requestTicket)) return reply.code(400).send({error:'Confirmação de solicitação inválida.'});
    const result=await google.requestAccess(body.requestTicket);
    if(result.status==='denied') return reply.code(409).send({error:'O cadastro mudou. Entre novamente com Google para verificar seu acesso.'});
    reply.header('Cache-Control','no-store'); return reply.code(202).send(result);
  });

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

  app.post('/v1/devices/:deviceId/alerts/:alertId/ack', async (request, reply) => {
    if (!isDevice(request.params)) return reply.code(404).send({ error: 'Dispositivo não encontrado.' });
    const { alertId } = request.params as { alertId: string };
    const alert = simulator.acknowledgeAlert(alertId);
    if (!alert) return reply.code(404).send({ error: 'Alerta não encontrado.' });
    return alert;
  });

  app.get('/v1/devices/:deviceId/config', async (request, reply) => {
    if (!isDevice(request.params)) return reply.code(404).send({ error: 'Dispositivo não encontrado.' });
    return simulator.getConfig();
  });

  app.put('/v1/devices/:deviceId/config', async (request, reply) => {
    if (!isDevice(request.params)) return reply.code(404).send({ error: 'Dispositivo não encontrado.' });
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply.code(400).send({ error: 'Configuração inválida.' });
    const config = simulator.updateConfig(body as Partial<Config>);
    if (!config) return reply.code(400).send({ error: 'Configuração fora dos limites permitidos.' });
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
    return reply.code(command.status === 'accepted' ? 202 : 422).send(command);
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
