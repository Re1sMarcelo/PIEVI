import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../app.js';
import { PostgresAuthStore } from '../auth/store.js';
import { IntegratedRuntime } from '../integrated/runtime.js';
import { VirtualESP } from '../virtual/esp.js';
import { virtualNvs } from '../virtual/nvs.js';
import { startLocalBroker } from './broker.js';
import { openLabDatabase } from './database.js';

export async function waitFor<T>(read:()=>Promise<T>,predicate:(value:T)=>boolean,timeoutMs=20000):Promise<T> {
  const until=Date.now()+timeoutMs;
  while(Date.now()<until){const value=await read();if(predicate(value))return value;await new Promise(r=>setTimeout(r,100));}
  throw new Error('Tempo excedido aguardando confirmação do fluxo integrado.');
}
export async function startLab(options:{dataDir?:string;apiPort?:number;brokerPort?:number;host?:string;logger?:boolean}={}) {
  if(process.env.NODE_ENV==='production')throw new Error('O laboratório é exclusivo de desenvolvimento.');
  if(options.dataDir)mkdirSync(options.dataDir,{recursive:true});
  const data=await openLabDatabase(options.dataDir ? join(options.dataDir,'postgres') : undefined);
  let broker:Awaited<ReturnType<typeof startLocalBroker>>|undefined;let app:ReturnType<typeof createApp>|undefined;let esp:VirtualESP|undefined;let closed=false;
  const stop=async()=>{if(closed)return;closed=true;await esp?.stop();await app?.close();await broker?.close();await data.db.close();};
  try {
    broker=await startLocalBroker('bancada-01',options.brokerPort ?? 1883);
    const nvs=virtualNvs(options.dataDir ? join(options.dataDir,'esp-nvs.json') : undefined);
    esp=new VirtualESP({deviceId:'bancada-01',broker:broker.esp,nvs:nvs.value,saveNvs:nvs.save});
    const virtual=esp;
    const runtime=new IntegratedRuntime({database:data.database,deviceId:'bancada-01',broker:broker.api,virtual:true,storage:'pglite',controller:{scenario:()=>virtual.scenario(),setScenario:s=>virtual.setScenario(s)}});
    app=createApp({authStore:new PostgresAuthStore(data.queryProxy),integrated:runtime,logger:options.logger ?? false});
    await app.listen({port:options.apiPort ?? 3000,host:options.host ?? '0.0.0.0'});
    const port=(app.server.address() as {port:number}).port;const url=`http://127.0.0.1:${port}`;
    await esp.start();
    await waitFor(()=>runtime.snapshot(),s=>s.online && s.telemetry.id!=='unavailable' && Date.now()-Date.parse(s.lastSeenAt)<45000).catch(error=>{throw new Error(`${error.message} ${JSON.stringify({mqtt:runtime.health(),esp:virtual.status})}`);});
    const login=await fetch(`${url}/v1/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data.credentials)});
    if(!login.ok)throw new Error('Não foi possível autenticar o operador local do laboratório.');
    const session=await login.json() as {token:string};
    const snapshot=await runtime.snapshot();
    if(!snapshot.configApplied) {
      const response=await fetch(`${url}/v1/devices/bancada-01/config`,{method:'PUT',headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json','If-Match':`"${snapshot.configVersion}"`},body:JSON.stringify(snapshot.config)});
      if(!response.ok)throw new Error('Não foi possível solicitar configuração inicial no laboratório.');
      const submission=await response.json() as {commandId:string};
      await waitFor(()=>runtime.reader.command(submission.commandId),c=>c?.status==='completed');
      await waitFor(()=>runtime.snapshot(),s=>!!s.configApplied);
    }
    return{app,runtime,esp,db:data.db,broker,credentials:data.credentials,url,token:session.token,stop};
  }catch(error){await stop();throw error;}
}
