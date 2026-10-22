import { randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import type { Pool, PoolClient } from 'pg';
import type { GoogleLoginResult, LoginResponse } from '../contracts.js';
import { AuthDatabaseError, tokenHash } from './store.js';
import { verifyPassword } from './password.js';

export interface GoogleIdentity { subject: string; email: string; name: string | null; authoritativeEmail: boolean }
export interface GoogleVerifier { verify(token: string, nonce: string): Promise<GoogleIdentity> }
export class GoogleTokenError extends Error { constructor() { super('Identidade Google inválida ou expirada. Tente entrar novamente.'); } }
export class GoogleBusyError extends Error { constructor() { super('Login Google temporariamente indisponível. Tente novamente.'); } }

export class GoogleTokenVerifier implements GoogleVerifier {
  constructor(private readonly audiences: string[], private readonly client = new OAuth2Client()) {
    if (!audiences.length || audiences.some(value => !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(value))) {
      throw new Error('Configure GOOGLE_CLIENT_IDS com IDs OAuth Web válidos.');
    }
    client.transporter.defaults.timeout = 10000;
  }
  async verify(token: string, nonce: string): Promise<GoogleIdentity> {
    try {
      const ticket = await this.client.verifyIdToken({ idToken: token, audience: this.audiences });
      const payload = ticket.getPayload();
      if (!payload || !/^[!-~]{1,255}$/.test(payload.sub) || !payload.email || payload.email_verified !== true ||
        payload.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ||
        payload.nonce !== nonce || payload.exp <= Date.now() / 1000) throw new GoogleTokenError();
      const email = payload.email.trim().toLowerCase();
      return { subject: payload.sub, email, name: payload.name?.slice(0, 200) ?? null,
        authoritativeEmail: email.endsWith('@gmail.com') || !!payload.hd };
    } catch (error) {
      const failure = error as { code?: string; response?: { status?: number } };
      if (['ENOTFOUND','ECONNRESET','ETIMEDOUT'].includes(failure.code ?? '') || (failure.response?.status ?? 0) >= 500) throw new GoogleBusyError();
      throw new GoogleTokenError();
    }
  }
}

type RepositoryResult = { status: 'authenticated'; session: LoginResponse } |
  { status: 'not_registered' } | { status: 'link_required' } | { status: 'denied' } | { status: 'pending'; requestId: string };

export class GoogleRepository {
  constructor(private readonly pool: Pick<Pool, 'connect' | 'query'>) {}
  async initialize(): Promise<void> {
    await this.pool.query('SELECT provedor,subject,usuario_id FROM public.identidades_externas LIMIT 0');
    await this.pool.query('SELECT id,google_sub,email,nome,status FROM public.solicitacoes_acesso LIMIT 0');
  }
  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect(); await client.query('BEGIN');
      const value = await action(client); await client.query('COMMIT'); return value;
    } catch { if (client) await client.query('ROLLBACK').catch(() => {}); throw new AuthDatabaseError(); }
    finally { client?.release(); }
  }
  async login(identity: GoogleIdentity, password?: string): Promise<RepositoryResult> {
    return this.transaction(async client => {
      const linked = await client.query<{id:string;usuario:string;ativo:boolean}>(`SELECT u.id,u.usuario,u.ativo
        FROM public.identidades_externas i JOIN public.usuarios u ON u.id=i.usuario_id
        WHERE i.provedor='google' AND i.subject=$1 FOR UPDATE OF u`,[identity.subject]);
      let user = linked.rows[0];
      if (!user) {
        const matching = await client.query<{id:string;usuario:string;ativo:boolean;senha_hash:string}>(
          'SELECT id,usuario,ativo,senha_hash FROM public.usuarios WHERE lower(email)=lower($1) FOR UPDATE',[identity.email]);
        const candidate = matching.rows[0];
        if (!candidate) {
          const pending = await client.query<{id:string}>('SELECT id FROM public.solicitacoes_acesso WHERE google_sub=$1',[identity.subject]);
          return pending.rows[0] ? { status:'pending',requestId:pending.rows[0].id } : { status:'not_registered' };
        }
        if (!candidate.ativo) return { status:'denied' };
        if (!identity.authoritativeEmail && (!password || !await verifyPassword(password,candidate.senha_hash))) return { status:'link_required' };
        const other = await client.query<{subject:string}>(`SELECT subject FROM public.identidades_externas WHERE usuario_id=$1 AND provedor='google'`,[candidate.id]);
        if (other.rows[0] && other.rows[0].subject !== identity.subject) return { status:'denied' };
        await client.query(`INSERT INTO public.identidades_externas(provedor,subject,usuario_id) VALUES ('google',$1,$2)
          ON CONFLICT (provedor,subject) DO NOTHING`,[identity.subject,candidate.id]);
        const owner = await client.query<{usuario_id:string}>(`SELECT usuario_id FROM public.identidades_externas WHERE provedor='google' AND subject=$1`,[identity.subject]);
        if (owner.rows[0]?.usuario_id !== candidate.id) return { status:'denied' };
        user = candidate;
      }
      if (!user.ativo) return { status:'denied' };
      const token = randomBytes(32).toString('hex');
      const session = await client.query<{expira_em:Date}>(`INSERT INTO public.sessoes(usuario_id,token_hash) VALUES($1,$2) RETURNING expira_em`,[user.id,tokenHash(token)]);
      await client.query(`UPDATE public.identidades_externas SET ultimo_acesso=clock_timestamp() WHERE provedor='google' AND subject=$1`,[identity.subject]);
      return { status:'authenticated',session:{token,username:user.usuario,expiresAt:session.rows[0].expira_em.toISOString()} };
    });
  }
  async requestAccess(identity: GoogleIdentity): Promise<{ status:'pending'; requestId:string } | { status:'denied' }> {
    return this.transaction(async client => {
      const existing = await client.query(`SELECT 1 FROM public.usuarios u LEFT JOIN public.identidades_externas i ON i.usuario_id=u.id
        WHERE lower(u.email)=lower($1) OR (i.provedor='google' AND i.subject=$2) LIMIT 1`,[identity.email,identity.subject]);
      if (existing.rows.length) return { status:'denied' };
      const result = await client.query<{id:string}>(`INSERT INTO public.solicitacoes_acesso(google_sub,email,nome) VALUES($1,$2,$3)
        ON CONFLICT(google_sub) DO UPDATE SET email=EXCLUDED.email,nome=EXCLUDED.nome,atualizado_em=clock_timestamp() RETURNING id`,
        [identity.subject,identity.email,identity.name]);
      return {status:'pending',requestId:result.rows[0].id};
    });
  }
}

class TemporaryProofs<T> {
  private entries = new Map<string, { value:T; expiresAt:number }>();
  issue(value:T) {
    for (const [key,item] of this.entries) if (item.expiresAt <= Date.now()) this.entries.delete(key);
    if (this.entries.size >= 500) throw new GoogleBusyError();
    const token=randomBytes(32).toString('hex'); const expiresAt=Date.now()+5*60*1000;
    this.entries.set(tokenHash(token),{value,expiresAt});
    return {token,expiresAt:new Date(expiresAt).toISOString()};
  }
  consume(token:string):T {
    const key=tokenHash(token); const item=this.entries.get(key); this.entries.delete(key);
    if (!item || item.expiresAt<=Date.now()) throw new GoogleTokenError();
    return item.value;
  }
}

export class GoogleAuthService {
  private challenges=new TemporaryProofs<string>();
  private requests=new TemporaryProofs<GoogleIdentity>();
  constructor(private readonly repository:GoogleRepository, private readonly verifier:GoogleVerifier) {}
  async initialize() { await this.repository.initialize(); }
  challenge() {
    const nonce=randomBytes(32).toString('hex'); const proof=this.challenges.issue(nonce);
    return {challengeId:proof.token,nonce,expiresAt:proof.expiresAt};
  }
  async login(challengeId:string,idToken:string,password?:string):Promise<GoogleLoginResult> {
    const nonce=this.challenges.consume(challengeId);
    const identity=await this.verifier.verify(idToken,nonce);
    const result=await this.repository.login(identity,password);
    if(result.status==='not_registered') return {status:'not_registered',requestTicket:this.requests.issue(identity).token};
    return result;
  }
  async requestAccess(ticket:string) { return this.repository.requestAccess(this.requests.consume(ticket)); }
}
