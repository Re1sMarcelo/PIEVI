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

export async function requestJson<T>(url: string, token?: string, options: RequestInit = {}, timeoutMs = 12_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body===undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
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
