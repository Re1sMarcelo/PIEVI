// Confere o EMQX Cloud antes de ligar API/ESP: rede, TLS, login dos dois usuarios e ACL dos topicos pievi/v1.
// Nao imprime senhas. Publica so mensagens de teste ({"teste":"acl"}), que a API descarta por estarem fora do contrato.
// Uso: npm.cmd run cloud:emqx -w api
import { connect as tcpConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import mqtt from 'mqtt';
import { mqttTopic } from '../src/mqtt/protocol.js';
import { readCloudSettings } from '../src/cloud/settings.js';

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
const record = (name: string, ok: boolean, detail: string) => { results.push({ name, ok, detail }); console.log(`${ok ? 'OK    ' : 'FALHOU'} · ${name}: ${detail}`); };

function probeTcp(host: string, port: number) {
  return new Promise<boolean>(resolve => {
    const socket = tcpConnect({ host, port }); socket.setTimeout(6000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => resolve(false));
  });
}
function probeTls(host: string, port: number) {
  return new Promise<string | null>(resolve => {
    const socket = tlsConnect({ host, port, servername: host }, () => {
      const cert = socket.getPeerCertificate(true); const chain: string[] = []; let x: any = cert;
      for (let i = 0; i < 4 && x?.subject; i++) { chain.push(x.subject.CN ?? x.subject.O); if (x.issuerCertificate === x) break; x = x.issuerCertificate; }
      socket.end(); resolve(socket.authorized ? chain.join(' <- ') : null);
    });
    socket.setTimeout(8000, () => { socket.destroy(); resolve(null); });
    socket.on('error', () => resolve(null));
  });
}
function login(url: string, username: string, password: string, clientId: string) {
  return new Promise<mqtt.MqttClient>((resolve, reject) => {
    const client = mqtt.connect(url, { protocolVersion: 5, username, password, clientId, clean: true, connectTimeout: 8000, reconnectPeriod: 0 });
    client.once('connect', () => resolve(client));
    client.once('error', error => { client.end(true); reject(error); });
  });
}
/** true = mensagem chegou ao outro lado (ACL libera publicar e assinar). */
async function delivered(from: mqtt.MqttClient, to: mqtt.MqttClient, topic: string) {
  const granted = await to.subscribeAsync(topic, { qos: 1 }).catch(() => []);
  if (!granted.length || granted[0].qos > 2) return { subscribed: false, received: false };
  const marker = `acl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const received = new Promise<boolean>(resolve => {
    const timer = setTimeout(() => { to.off('message', onMessage); resolve(false); }, 3000);
    const onMessage = (t: string, payload: Buffer) => { if (t === topic && payload.toString().includes(marker)) { clearTimeout(timer); to.off('message', onMessage); resolve(true); } };
    to.on('message', onMessage);
  });
  await from.publishAsync(topic, JSON.stringify({ teste: 'acl', marker }), { qos: 1 }).catch(() => undefined);
  const ok = await received; await to.unsubscribeAsync(topic).catch(() => undefined);
  return { subscribed: true, received: ok };
}

try {
  const s = readCloudSettings();
  const tcp = await probeTcp(s.emqxHost, s.emqxPort);
  record('Rede', tcp, tcp ? `porta ${s.emqxPort} aberta` : `porta ${s.emqxPort} sem resposta: deployment parado/excluido no EMQX Cloud ou endereco errado`);
  if (!tcp) throw new Error('stop');
  const chain = await probeTls(s.emqxHost, s.emqxPort);
  record('TLS', !!chain, chain ? `certificado valido (${chain})` : 'certificado invalido ou handshake falhou');
  if (!chain) throw new Error('stop');
  let api: mqtt.MqttClient | undefined, esp: mqtt.MqttClient | undefined;
  try { api = await login(s.mqttUrl, s.apiUsername, s.apiPassword, `${s.apiClientId}-teste`); record('Login da API', true, `usuario ${s.apiUsername}`); }
  catch (error) { record('Login da API', false, `usuario ${s.apiUsername}: ${(error as Error).message} (confira Authentication no EMQX)`); }
  try { esp = await login(s.mqttUrl, s.espUsername, s.espPassword, `${s.espClientId}-teste`); record('Login do ESP', true, `usuario ${s.espUsername}`); }
  catch (error) { record('Login do ESP', false, `usuario ${s.espUsername}: ${(error as Error).message} (confira Authentication no EMQX)`); }
  if (api && esp) {
    for (const channel of ['telemetry', 'state', 'events', 'acks', 'presence'] as const) {
      const r = await delivered(esp, api, mqttTopic(s.deviceId, channel));
      record(`ACL ESP -> API (${channel})`, r.received, r.received ? 'entregue' : r.subscribed ? 'nao entregue: falta liberar publish do ESP' : 'API sem permissao de subscribe');
    }
    for (const channel of ['commands', 'sync', 'receipts'] as const) {
      const r = await delivered(api, esp, mqttTopic(s.deviceId, channel));
      record(`ACL API -> ESP (${channel})`, r.received, r.received ? 'entregue' : r.subscribed ? 'nao entregue: falta liberar publish da API' : 'ESP sem permissao de subscribe');
    }
    const forged = await delivered(esp, api, mqttTopic(s.deviceId, 'commands'));
    record('ACL bloqueia ESP publicando comandos', !forged.received, forged.received ? 'o ESP conseguiu publicar em commands: restrinja a ACL' : 'bloqueado (correto)');
  }
  await Promise.all([api?.endAsync(true), esp?.endAsync(true)]);
} catch (error) { if ((error as Error).message !== 'stop') record('Execucao', false, error instanceof Error ? error.message : 'falha'); }
const ok = results.length > 0 && results.every(r => r.ok);
console.log(ok ? '\nEMQX pronto para a API e o ESP.' : '\nEMQX ainda nao esta pronto: veja os itens FALHOU (GUIA-NUVEM.md, passo 1).');
process.exitCode = ok ? 0 : 1;
