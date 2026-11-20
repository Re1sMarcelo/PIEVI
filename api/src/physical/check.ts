import type { Snapshot } from '../contracts.js';

interface Check { name: string; status: 'ok' | 'pending' | 'failed'; detail: string }
export async function checkPhysicalBench(options: { url: string; username: string; password: string; infrastructureOnly?: boolean }) {
  const checks: Check[] = [];
  const record = (name: string, pass: boolean, detail: string, pending = false) => checks.push({ name, status: pass ? 'ok' : pending ? 'pending' : 'failed', detail });
  let token: string | undefined;
  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${options.url}${path}`, { ...init, signal: AbortSignal.timeout(8000), headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers,
    } });
    if (!response.ok) throw new Error(`HTTP ${response.status} em ${path}`);
    return response.json();
  };
  try {
    const health = await request('/health');
    record('Modo físico', health.mode === 'mqtt' && health.simulation === false && health.storage === 'pglite', 'Esperado mode=mqtt, simulation=false e storage=pglite.');
    record('Broker', health.status === 'ok' && health.mqtt?.ready === true, 'A API precisa estar conectada e inscrita nos tópicos MQTT.');
    const login = await request('/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: options.username, password: options.password }) });
    token = login.token;
    record('Login', typeof token === 'string', 'Login e sessão persistente do operador.');
    const snapshot: Snapshot = await request('/v1/devices/bancada-01/snapshot');
    record('Simulação desativada', snapshot.simulation === false && snapshot.mode === 'mqtt' && snapshot.scenarioControlsEnabled === false, 'Sem controles de cenários virtuais.');
    const history = await request('/v1/devices/bancada-01/history');
    record('Histórico', Array.isArray(history.telemetry) && Array.isArray(history.events) && Array.isArray(history.alerts), 'Consulta do histórico gravado no banco local.');
    const pending = !!options.infrastructureOnly;
    record('ESP sincronizado', snapshot.online, 'O firmware precisa responder ao desafio sync.', pending);
    record('Dados recentes', snapshot.telemetry.id !== 'unavailable' && Date.now() - Date.parse(snapshot.lastSeenAt) < 45000, 'Telemetria e estado precisam estar atualizados (menos de 45 s).', pending);
    record('Relógio do ESP', snapshot.telemetry.clockReliable, 'Sem UTC confiável o ESP recusa comandos, inclusive configuração.', pending);
    record('Sensores e calibração', snapshot.telemetry.dhtReliable && snapshot.telemetry.rootReliable && snapshot.telemetry.soilReliable, 'Conferir sensores e evento de calibração do solo.', pending);
    record('Nível de água', snapshot.telemetry.waterLevel === 'OK', 'Nível LOW bloqueia as bombas; conferir fisicamente a boia.', pending);
    record('Configuração confirmada', snapshot.configApplied === true && snapshot.configVersion > 0, 'Revisar e aplicar a configuração pelo app, aguardando confirmação.', pending);
    record('Saídas desligadas', !snapshot.pumps.B1.isOn && !snapshot.pumps.B2.isOn, 'Estado informado pelo ESP; confirmar relés e bombas fisicamente.', pending);
  } catch (error) { record('Acesso à API', false, error instanceof Error ? error.message : 'Falha de comunicação.'); }
  finally {
    if (token) await request('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
  }
  return { createdAt: new Date().toISOString(), scope: options.infrastructureOnly ? 'infrastructure' : 'bench',
    ok: checks.every(check => check.status !== 'failed'), readyForManualTests: checks.every(check => check.status === 'ok'),
    sendsActuationCommands: false, checks };
}
