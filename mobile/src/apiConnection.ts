export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function resolveApiBaseUrl(configuredUrl: string | undefined, hostUri: string | undefined, web: boolean) {
  if (configuredUrl?.trim()) return configuredUrl.trim().replace(/\/+$/, '');
  if (web) return '/api';
  if (!hostUri) return 'http://localhost:3000';

  const url = new URL(hostUri.includes('://') ? hostUri : `http://${hostUri}`);
  const host = url.hostname;
  const local = host === 'localhost' || host === '[::1]' || host.endsWith('.local') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  // Both ngrok and the SDK 58 tunnel expose Metro's /api proxy over HTTPS.
  if (!local) return `https://${url.host}/api`;
  return `http://${host}:3000`;
}

/** Filled by requestJson when given: when the request left/arrived and the server's HTTP Date header. */
export interface ResponseTiming { sentAt?: number; receivedAt?: number; serverDateMs?: number }

/**
 * Server clock minus phone clock, in ms, from the HTTP Date header (1 s resolution: +500 ms centres it).
 * The API stamps lastSeenAt/expiry with its own clock; a skewed notebook or phone otherwise makes fresh
 * data look stale and fresh requests look expired. Returns 0 when the header is missing.
 */
export function serverClockOffset(timing: ResponseTiming) {
  if (timing.serverDateMs === undefined || !Number.isFinite(timing.serverDateMs) || timing.sentAt === undefined || timing.receivedAt === undefined) return 0;
  return Math.round(timing.serverDateMs + 500 - (timing.sentAt + timing.receivedAt) / 2);
}

export async function requestJson<T>(url: string, token?: string, options: RequestInit = {}, timeoutMs = 12_000, timing?: ResponseTiming): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (timing) timing.sentAt = Date.now();
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body===undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
    if (timing) {
      timing.receivedAt = Date.now();
      const date = response.headers?.get?.('date');
      timing.serverDateMs = date ? Date.parse(date) : undefined;
    }
    const body = await response.json().catch(() => null) as (T & { error?: string; reason?: string }) | null;
    if (!response.ok) throw new ApiError(
      response.status === 502 || response.status === 504
        ? 'A API está indisponível. Confira se o terminal da API está rodando e tente novamente.'
        : body?.reason ?? body?.error ?? `Erro ao acessar o servidor (HTTP ${response.status}).`,
      response.status,
    );
    if (body === null) throw new Error('Resposta inválida da API. Confira a conexão e tente novamente.');
    return body;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('A API demorou para responder. Confira se ela está rodando e tente novamente.');
    if (error instanceof TypeError) throw new Error('Não foi possível conectar à API. Confira a conexão e o terminal da API.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
