import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import type { LoginResponse } from '../contracts.js';
import { hashPassword, isPasswordHash, verifyPassword } from './password.js';

export interface SessionIdentity { userId: string; username: string }

export interface AuthStore {
  readonly storage: 'postgres' | 'memory';
  initialize(): Promise<void>;
  login(identifier: string, password: string): Promise<LoginResponse | null>;
  session(token: string): Promise<SessionIdentity | null>;
  canAccessDevice(token: string, deviceId: string): Promise<boolean>;
  logout(token: string): Promise<void>;
  close(): Promise<void>;
}

const tokenFormat = /^[0-9a-f]{64}$/;
export const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

export class AuthDatabaseError extends Error {
  constructor() { super('Não foi possível consultar a autenticação no PostgreSQL.'); }
}

export class PostgresAuthStore implements AuthStore {
  readonly storage = 'postgres';
  constructor(private readonly db: Pick<Pool, 'query'>, private readonly disconnect = async () => {}) {}

  async initialize(): Promise<void> {
    // Confere as colunas exigidas sem criar/alterar tabelas ou contas.
    await this.db.query(`SELECT u.id, u.usuario, u.email, u.senha_hash, u.ativo,
      s.token_hash, s.expira_em, s.revogado_em, s.motivo_revogacao,
      du.ativo, d.identificador FROM public.usuarios u
      LEFT JOIN public.sessoes s ON s.usuario_id = u.id
      LEFT JOIN public.dispositivo_usuarios du ON du.usuario_id = u.id
      LEFT JOIN public.dispositivos d ON d.id = du.dispositivo_id LIMIT 0`);
    const result = await this.db.query<{ total: number }>(`SELECT count(*)::int AS total FROM public.usuarios WHERE ativo`);
    if (result.rows[0].total > 1) throw new Error('O protótipo permite apenas um operador ativo. Revise o provisionamento.');
  }

  private async query<Row extends Record<string, any>>(sql: string, values: unknown[]) {
    try { return await this.db.query<Row>(sql, values); }
    catch { throw new AuthDatabaseError(); }
  }

  async login(identifier: string, password: string): Promise<LoginResponse | null> {
    const users = await this.query<{ id: string; usuario: string; senha_hash: string }>(
      `SELECT id, usuario, senha_hash FROM public.usuarios WHERE ativo
       AND (lower(usuario) = lower(btrim($1)) OR lower(email) = lower(btrim($1))) LIMIT 2`, [identifier]);
    // Se um identificador corresponder a duas contas, não escolher uma delas.
    const user = users.rows.length === 1 ? users.rows[0] : undefined;
    if (!await verifyPassword(password, user?.senha_hash) || !user) return null;
    const token = randomBytes(32).toString('hex');
    // O bloqueio/revalidação impede criar sessão com a senha trocada durante o login.
    const sessions = await this.query<{ expira_em: Date }>(`WITH usuario_validado AS (
      SELECT id FROM public.usuarios WHERE id = $1 AND ativo AND senha_hash = $3
      AND (lower(usuario) = lower(btrim($4)) OR lower(email) = lower(btrim($4))) FOR UPDATE
    ) INSERT INTO public.sessoes (usuario_id, token_hash)
      SELECT id, $2 FROM usuario_validado RETURNING expira_em`, [user.id, tokenHash(token), user.senha_hash, identifier]);
    if (!sessions.rows[0]) return null;
    return { token, username: user.usuario, expiresAt: sessions.rows[0].expira_em.toISOString() };
  }

  async session(token: string): Promise<SessionIdentity | null> {
    if (!tokenFormat.test(token)) return null;
    const result = await this.query<{ userId: string; username: string }>(
      `SELECT u.id AS "userId", u.usuario AS username FROM public.sessoes s
       JOIN public.usuarios u ON u.id = s.usuario_id WHERE s.token_hash = $1
       AND s.revogado_em IS NULL AND s.expira_em > clock_timestamp() AND u.ativo`, [tokenHash(token)]);
    return result.rows[0] ?? null;
  }

  async canAccessDevice(token: string, deviceId: string): Promise<boolean> {
    if (!tokenFormat.test(token)) return false;
    const result = await this.query(`SELECT 1 FROM public.sessoes s
      JOIN public.usuarios u ON u.id = s.usuario_id
      JOIN public.dispositivo_usuarios du ON du.usuario_id = u.id
      JOIN public.dispositivos d ON d.id = du.dispositivo_id
      WHERE s.token_hash = $1 AND d.identificador = $2 AND u.ativo AND du.ativo
      AND s.revogado_em IS NULL AND s.expira_em > clock_timestamp()`, [tokenHash(token), deviceId]);
    return result.rows.length > 0;
  }

  async logout(token: string): Promise<void> {
    if (!tokenFormat.test(token)) return;
    await this.query(`UPDATE public.sessoes SET revogado_em = clock_timestamp(), motivo_revogacao = 'logout'
      WHERE token_hash = $1 AND revogado_em IS NULL`, [tokenHash(token)]);
  }

  async close(): Promise<void> { await this.disconnect(); }
}

// Modo local sem DATABASE_URL, mantido para o simulador isolado.
export class MemoryAuthStore implements AuthStore {
  readonly storage = 'memory';
  private sessions = new Map<string, { username: string; expiresAt: number }>();
  private passwordHash = '';
  constructor(private readonly username: string, private readonly configuredHash: string | undefined,
    private readonly demo: boolean, private readonly deviceId: string) {
    if (!username || (!demo && !configuredHash)) throw new Error('Configure as credenciais do operador.');
    if (configuredHash && !isPasswordHash(configuredHash)) throw new Error('OPERATOR_PASSWORD_HASH inválido.');
  }
  async initialize(): Promise<void> { this.passwordHash = this.configuredHash ?? await hashPassword('demo'); }
  async login(username: string, password: string): Promise<LoginResponse | null> {
    const valid = await verifyPassword(password, this.passwordHash);
    if (username !== this.username || !valid) return null;
    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
    this.sessions.set(tokenHash(token), { username, expiresAt });
    return { token, username, expiresAt: new Date(expiresAt).toISOString() };
  }
  async session(token: string): Promise<SessionIdentity | null> {
    if (!tokenFormat.test(token)) return null;
    const key = tokenHash(token);
    const value = this.sessions.get(key);
    if (!value || value.expiresAt <= Date.now()) { this.sessions.delete(key); return null; }
    return { userId: value.username, username: value.username };
  }
  async canAccessDevice(token: string, deviceId: string): Promise<boolean> {
    return deviceId === this.deviceId && !!await this.session(token);
  }
  async logout(token: string): Promise<void> { this.sessions.delete(tokenHash(token)); }
  async close(): Promise<void> { this.sessions.clear(); }
}
