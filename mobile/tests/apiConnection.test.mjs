import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, requestJson, resolveApiBaseUrl, serverClockOffset } from '../src/apiConnection.ts';
import {createServer} from 'node:http';

test('endereço configurado tem prioridade, inclusive no navegador', () => {
  assert.equal(resolveApiBaseUrl(' https://api.example.com/ ', '192.168.1.10:8081', true), 'https://api.example.com');
});

test('POST sem corpo funciona em servidor que recusa JSON vazio',async()=>{
  const server=createServer((request,response)=>{
    let body='';request.on('data',chunk=>body+=chunk);request.on('end',()=>{
      const invalid=request.headers['content-type']==='application/json' && !body;
      response.writeHead(invalid ? 400 : 200,{'Content-Type':'application/json'});response.end(JSON.stringify(invalid ? {error:'JSON vazio'} : {ok:true}));
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{assert.deepEqual(await requestJson(`http://127.0.0.1:${server.address().port}/ack`,'token',{method:'POST'}),{ok:true});}
  finally{await new Promise(resolve=>server.close(resolve));}
});

test('rede local usa a API na porta 3000 e navegador usa o proxy', () => {
  assert.equal(resolveApiBaseUrl('', '192.168.1.10:8081', false), 'http://192.168.1.10:3000');
  assert.equal(resolveApiBaseUrl('', '10.0.0.2:8081', false), 'http://10.0.0.2:3000');
  assert.equal(resolveApiBaseUrl('', '172.20.0.2:8081', false), 'http://172.20.0.2:3000');
  assert.equal(resolveApiBaseUrl('', undefined, true), '/api');
});

test('ngrok e outros provedores públicos usam HTTPS e proxy, nunca a porta 3000 remota', () => {
  for (const host of ['sessao.exp.direct', 'sessao.ngrok-free.app', 'sessao.tunnel.example.com']) {
    assert.equal(resolveApiBaseUrl('', host, false), `https://${host}/api`);
  }
});

test('hostUri com protocolo não é interpretado como hostname http', () => {
  assert.equal(resolveApiBaseUrl('', 'exp://sessao.exp.direct', false), 'https://sessao.exp.direct/api');
  assert.equal(resolveApiBaseUrl('', 'http://192.168.1.5:8081', false), 'http://192.168.1.5:3000');
});

test('requisição transmite sessão e retorna o JSON', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://example.com/api/health');
    assert.equal(options.headers.Authorization, 'Bearer token-de-teste');
    assert.equal(options.method, 'POST');
    return Response.json({ ok: true });
  });
  assert.deepEqual(await requestJson('https://example.com/api/health', 'token-de-teste', { method: 'POST' }), { ok: true });
});

test('401 é preservado para invalidar uma sessão salva', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Sessão expirada.' }, { status: 401 }));
  await assert.rejects(requestJson('https://example.com'), error => error instanceof ApiError && error.status === 401);
});

test('proxy indisponível com resposta HTML produz orientação sobre a API', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>Bad gateway</html>', { status: 502 }));
  await assert.rejects(requestJson('https://example.com'), /terminal da API/);
});

test('API inacessível produz erro de conexão legível', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Network request failed'); });
  await assert.rejects(requestJson('https://example.com'), /Não foi possível conectar/);
});

test('requisição pendente é interrompida no prazo, liberando login e carregamento', async (t) => {
  let aborted = false;
  t.mock.method(globalThis, 'fetch', (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
  }));
  await assert.rejects(requestJson('https://example.com', undefined, {}, 20), /demorou para responder/);
  assert.equal(aborted, true);
});

test('diferença de relógio vem do cabeçalho Date da API (notebook adiantado 16 s)', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('Date', new Date(Date.now() + 16_000).toUTCString());
    res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const timing = {};
    await requestJson(`http://127.0.0.1:${server.address().port}/`, undefined, {}, 2000, timing);
    const offset = serverClockOffset(timing);
    assert.ok(offset > 14_500 && offset < 17_500, `offset ${offset}`);
  } finally { server.close(); }
});

test('sem cabeçalho Date a correção de relógio é zero', () => {
  assert.equal(serverClockOffset({}), 0);
  assert.equal(serverClockOffset({ sentAt: 1000, receivedAt: 1100, serverDateMs: NaN }), 0);
});
