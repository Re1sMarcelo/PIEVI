import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { before, beforeEach, after, afterEach, test } from 'node:test';
import { OAuth2Client } from 'google-auth-library';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { PostgresAuthStore, tokenHash } from '../src/auth/store.js';
import { GoogleAuthService, GoogleRepository, GoogleTokenVerifier } from '../src/auth/google.js';
import { hashPassword } from '../src/auth/password.js';

const audience='123456-test.apps.googleusercontent.com';
const password='Senha própria do teste Google!';
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();
let db:PGlite,app:FastifyInstance,userId:string,client:OAuth2Client;
const executor={query:(sql:string,values?:unknown[])=>db.query(sql,values),release:()=>{}};
const pool={...executor,connect:async()=>executor} as unknown as Pool;

function jwt(nonce:string,claims:Record<string,unknown>={}) {
  const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test-key',typ:'JWT'})).toString('base64url');
  const body=Buffer.from(JSON.stringify({iss:'https://accounts.google.com',aud:audience,sub:'google-operador-01',
    email:'operador@gmail.com',email_verified:true,name:'Operador',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,nonce,...claims})).toString('base64url');
  const data=`${header}.${body}`;
  return `${data}.${createSign('RSA-SHA256').update(data).sign(keys.privateKey,'base64url')}`;
}
before(async()=>{
  db=new PGlite();
  for(const file of ['001_schema.sql','003_google_auth.sql']) await db.exec(await readFile(new URL(`../../db/${file}`,import.meta.url),'utf8'));
});
beforeEach(async()=>{
  await db.exec('TRUNCATE usuarios,dispositivos,solicitacoes_acesso RESTART IDENTITY CASCADE');
  userId=(await db.query<{id:string}>(`INSERT INTO usuarios(usuario,nome,email,senha_hash) VALUES('operador','Operador','operador@gmail.com',$1) RETURNING id`,[await hashPassword(password)])).rows[0].id;
  const device=(await db.query<{id:string}>(`INSERT INTO dispositivos(identificador,nome,chip_id) VALUES('bancada-01','Bancada','simulator:bancada-01') RETURNING id`)).rows[0];
  await db.query('INSERT INTO dispositivo_usuarios(dispositivo_id,usuario_id) VALUES($1,$2)',[device.id,userId]);
  client=new OAuth2Client();
  client.getFederatedSignonCertsAsync=async()=>({certs:{'test-key':publicKey},format:'PEM' as Awaited<ReturnType<OAuth2Client['getFederatedSignonCertsAsync']>>['format']});
  app=createApp({authStore:new PostgresAuthStore(pool),googleAuth:new GoogleAuthService(new GoogleRepository(pool),new GoogleTokenVerifier([audience],client)),logger:false});
  await app.ready();
});
afterEach(async()=>{await app.close();});
after(async()=>{await db.close();});
async function login(claims:Record<string,unknown>={},localPassword?:string){
  const challenge=(await app.inject({method:'POST',url:'/v1/auth/google/challenge'})).json();
  return app.inject({method:'POST',url:'/v1/auth/google/login',payload:{challengeId:challenge.challengeId,idToken:jwt(challenge.nonce,claims),password:localPassword}});
}
const counts=async()=> (await db.query<{users:number;sessions:number;requests:number;identities:number}>(`SELECT
  (SELECT count(*)::int FROM usuarios) AS users,(SELECT count(*)::int FROM sessoes) AS sessions,
  (SELECT count(*)::int FROM solicitacoes_acesso) AS requests,(SELECT count(*)::int FROM identidades_externas) AS identities`)).rows[0];
const confirm=(ticket:string)=>app.inject({method:'POST',url:'/v1/auth/google/requests',payload:{requestTicket:ticket}});

test('Google Gmail cadastrado vincula sub e emite sessão PIEVI válida sem expor token no banco',async()=>{
  const response=await login();assert.equal(response.statusCode,200);const result=response.json();
  assert.equal(result.status,'authenticated');assert.equal(result.session.username,'operador');
  const linked=(await db.query<{subject:string;usuario_id:string}>('SELECT subject,usuario_id FROM identidades_externas')).rows[0];
  assert.deepEqual(linked,{subject:'google-operador-01',usuario_id:userId});
  const session=(await db.query<{token_hash:string}>('SELECT token_hash FROM sessoes')).rows[0];
  assert.equal(session.token_hash,tokenHash(result.session.token));
  assert.equal((await app.inject({url:'/v1/devices/bancada-01/snapshot',headers:{authorization:`Bearer ${result.session.token}`}})).statusCode,200);
});
test('identidade já vinculada usa sub estável mesmo após mudança do e-mail Google',async()=>{
  assert.equal((await login()).json().status,'authenticated');
  const response=await login({email:'outro-email@gmail.com'});
  assert.equal(response.json().session.username,'operador');
  assert.equal((await counts()).identities,1);
});
test('assinatura, emissor, cliente, expiração, nonce e e-mail verificado são obrigatórios',async()=>{
  for(const claims of [{iss:'https://atacante.example'},{aud:'outro.apps.googleusercontent.com'},{exp:1},{nonce:'nonce-de-outro-fluxo'},{email_verified:false},{email_verified:'false'}]){
    assert.equal((await login(claims)).statusCode,401);
  }
  const challenge=(await app.inject({method:'POST',url:'/v1/auth/google/challenge'})).json();
  const token=jwt(challenge.nonce);const corrupt=token.slice(0,-20)+'AAAAAAAAAAAAAAAAAAAA';
  assert.equal((await app.inject({method:'POST',url:'/v1/auth/google/login',payload:{challengeId:challenge.challengeId,idToken:corrupt}})).statusCode,401);
  assert.deepEqual(await counts(),{users:1,sessions:0,requests:0,identities:0});
});
test('desafio Google só pode ser consumido uma vez',async()=>{
  const challenge=(await app.inject({method:'POST',url:'/v1/auth/google/challenge'})).json();
  const payload={challengeId:challenge.challengeId,idToken:jwt(challenge.nonce)};
  assert.equal((await app.inject({method:'POST',url:'/v1/auth/google/login',payload})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/v1/auth/google/login',payload})).statusCode,401);
  assert.equal((await counts()).sessions,1);
});
test('pessoa sem cadastro só cria pedido depois de confirmar; pedido não cria operador ou sessão',async()=>{
  const claims={sub:'google-novo-01',email:'novo@gmail.com',name:'Novo interessado'};
  const initial=(await login(claims)).json();assert.equal(initial.status,'not_registered');
  assert.deepEqual(await counts(),{users:1,sessions:0,requests:0,identities:0});
  const response=await confirm(initial.requestTicket);assert.equal(response.statusCode,202);assert.equal(response.json().status,'pending');
  assert.deepEqual(await counts(),{users:1,sessions:0,requests:1,identities:0});
  assert.equal((await confirm(initial.requestTicket)).statusCode,401);
  const next=(await login(claims)).json();assert.equal(next.status,'pending');assert.equal(next.requestId,response.json().requestId);
  assert.equal((await app.inject({url:'/v1/devices/bancada-01/snapshot',headers:{authorization:`Bearer ${initial.requestTicket}`}})).statusCode,401);
});
test('confirmações independentes da mesma identidade deduplicam o pedido',async()=>{
  const claims={sub:'google-novo-02',email:'novo2@gmail.com'};
  const first=(await login(claims)).json(),second=(await login(claims)).json();
  const a=await confirm(first.requestTicket),b=await confirm(second.requestTicket);
  assert.equal(a.json().requestId,b.json().requestId);assert.equal((await counts()).requests,1);
});
test('conta desativada é recusada e não pode virar nova solicitação',async()=>{
  await db.query('UPDATE usuarios SET ativo=false WHERE id=$1',[userId]);
  assert.equal((await login()).statusCode,403);assert.equal((await counts()).requests,0);
});
test('e-mail externo ao Gmail/Workspace exige senha da conta antes do primeiro vínculo',async()=>{
  await db.query('UPDATE usuarios SET email=$1 WHERE id=$2',['operador@example.com',userId]);
  const claims={email:'operador@example.com'};
  assert.equal((await login(claims)).json().status,'link_required');
  assert.equal((await login(claims,'errada')).json().status,'link_required');
  assert.equal((await counts()).identities,0);
  assert.equal((await login(claims,password)).json().status,'authenticated');
});
test('outra identidade Google não substitui vínculo existente',async()=>{
  assert.equal((await login()).json().status,'authenticated');
  assert.equal((await login({sub:'outra-identidade-google'})).statusCode,403);
  assert.equal((await counts()).identities,1);
});
test('desafio vencido não autentica e não escreve dados',async()=>{
  const challenge=(await app.inject({method:'POST',url:'/v1/auth/google/challenge'})).json();
  const token=jwt(challenge.nonce);const current=Date.now;Date.now=()=>current()+6*60*1000;
  try{assert.equal((await app.inject({method:'POST',url:'/v1/auth/google/login',payload:{challengeId:challenge.challengeId,idToken:token}})).statusCode,401);}
  finally{Date.now=current;}
  assert.equal((await counts()).sessions,0);
});
test('falha ao obter chaves Google não libera acesso ou ativa demo',async()=>{
  client.getFederatedSignonCertsAsync=async()=>{throw Object.assign(new Error('offline'),{code:'ENOTFOUND'});};
  assert.equal((await login()).statusCode,503);assert.equal((await counts()).sessions,0);
});
test('API sem credencial Google informa indisponibilidade sem quebrar login local',async()=>{
  await app.close();app=createApp({authStore:new PostgresAuthStore(pool),logger:false});await app.ready();
  assert.equal((await app.inject({method:'POST',url:'/v1/auth/google/challenge'})).statusCode,503);
  assert.equal((await app.inject({method:'POST',url:'/v1/auth/login',payload:{username:'operador',password}})).statusCode,200);
});
