import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { waitFor, type startLab } from './index.js';
import type { Snapshot, DeviceHistory, CommandResult } from '../contracts.js';

export async function validateIntegratedLab(lab:Awaited<ReturnType<typeof startLab>>,log:(message:string)=>void=()=>{}) {
  const checks:string[]=[];const pass=(name:string)=>{checks.push(name);log(`OK · ${name}`);};
  const root='/v1/devices/bancada-01';
  const request=async(path:string,method='GET',body?:unknown,extra:Record<string,string>={})=>{
    const response=await fetch(`${lab.url}${path}`,{method,headers:{Authorization:`Bearer ${lab.token}`,...(body===undefined ? {} : {'Content-Type':'application/json'}),...extra},...(body===undefined ? {} : {body:JSON.stringify(body)})});
    const data=await response.json() as any;return {status:response.status,data};
  };
  const snapshot=async()=>(await request(`${root}/snapshot`)).data as Snapshot;
  const command=async(id:string)=>(await request(`${root}/commands/${id}`)).data as CommandResult;
  const send=async(pumpId:'B1'|'B2',action:string,durationSeconds?:number,commandId=randomUUID())=>{
    const body={commandId,pumpId,action,durationSeconds,expiresAt:new Date(Date.now()+10000).toISOString()};
    const response=await request(`${root}/commands`,'POST',body);assert.ok([200,202].includes(response.status),JSON.stringify(response.data));return {commandId,body};
  };
  const health=(await request('/health')).data;assert.equal(health.mode,'mqtt-virtual');assert.equal(health.mqtt.ready,true);
  const initial=await snapshot();assert.ok(initial.configApplied);assert.equal(initial.online,true);assert.ok(initial.telemetry.airTemperatureC!==null);pass('API autenticada, MQTT sincronizado e leituras persistidas');
  const on=await send('B1','MANUAL_ON',30);
  await waitFor(snapshot,s=>s.pumps.B1.isOn);
  const off=await send('B1','MANUAL_OFF');
  await waitFor(snapshot,s=>!s.pumps.B1.isOn && s.pumps.B1.mode==='MANUAL_OFF').catch(async error=>{
    const current=await snapshot();
    throw new Error(`${error.message} ${JSON.stringify({command:await command(off.commandId),pump:current.pumps.B1,mqtt:lab.runtime.health(),esp:lab.esp.status})}`);
  });
  await waitFor(()=>command(off.commandId),c=>c.status==='accepted');
  pass('B1 liga e desliga com estado informado pelo ESP');
  await send('B1','AUTO');await waitFor(snapshot,s=>s.pumps.B1.mode==='AUTO');
  const pulse=await send('B2','MANUAL_ON',2);await waitFor(snapshot,s=>s.pumps.B2.isOn);await waitFor(()=>command(pulse.commandId),c=>c.status==='completed');await waitFor(snapshot,s=>!s.pumps.B2.isOn);pass('B2 respeita o temporizador e confirma o término');
  const replay=await request(`${root}/commands`,'POST',pulse.body);assert.ok([200,202].includes(replay.status));
  const rows=await lab.db.query<{total:number}>('SELECT count(*)::int total FROM comandos WHERE id_externo=$1',[pulse.commandId]);assert.equal(rows.rows[0].total,1);pass('Reentrega de comando não gera outro pedido ou acionamento');
  const cycles=await lab.db.query<{total:number}>(`SELECT count(*)::int total FROM acionamentos a JOIN comandos c ON c.id=a.comando_id WHERE c.id_externo=$1`,[pulse.commandId]);assert.equal(cycles.rows[0].total,1);
  await request(`${root}/simulation`,'PUT',{scenario:'low_water'});
  const low=await waitFor(snapshot,s=>s.telemetry.waterLevel==='LOW' && s.activeAlerts.some(a=>a.code==='NIVEL_BAIXO'));
  const blocked=await request(`${root}/commands`,'POST',{commandId:randomUUID(),pumpId:'B1',action:'MANUAL_ON',durationSeconds:10,expiresAt:new Date(Date.now()+10000).toISOString()});assert.equal(blocked.status,409);
  const alert=low.activeAlerts.find(a=>a.code==='NIVEL_BAIXO')!;
  assert.equal((await request(`${root}/alerts/${alert.id}/ack`,'POST')).status,200);
  const acked=await snapshot();assert.ok(acked.activeAlerts.find(a=>a.id===alert.id)?.acknowledgedAt);pass('Nível baixo bloqueia bombas e reconhecer mantém o alerta ativo');
  await request(`${root}/simulation`,'PUT',{scenario:'normal'});await waitFor(snapshot,s=>s.telemetry.waterLevel==='OK' && !s.activeAlerts.some(a=>a.id===alert.id));
  const history=(await request(`${root}/history`)).data as DeviceHistory;
  assert.ok(history.alerts.find(a=>a.id===alert.id)?.endedAt);assert.ok(history.alerts.find(a=>a.id===alert.id)?.acknowledgedAt);
  assert.ok(history.events.some(e=>e.pumpId==='B1'&&e.outputOn===true));assert.ok(history.events.some(e=>e.pumpId==='B1'&&e.outputOn===false));pass('Alerta resolvido e acionamentos permanecem no histórico PostgreSQL');
  const before=await snapshot();const config={...before.config,rootAlertTemperatureC:before.config.rootAlertTemperatureC===27 ? 26 : 27};
  const submission=await request(`${root}/config`,'PUT',config,{'If-Match':`"${before.configVersion}"`});assert.equal(submission.status,202);
  await waitFor(()=>command(submission.data.commandId),c=>c.status==='completed');
  await waitFor(snapshot,s=>s.configVersion===submission.data.requestedVersion && !!s.configApplied);
  assert.equal((await request(`${root}/config`,'PUT',before.config,{'If-Match':`"${before.configVersion}"`})).status,409);pass('Configuração só é aplicada após confirmação e conflitos são recusados');
  const audits=await lab.db.query<{resultado:string}>('SELECT resultado FROM mqtt_mensagens');assert.ok(audits.rows.length>0);assert.ok(lab.esp.status.receipts>0);assert.equal(lab.esp.status.lastError,null);
  pass('Mensagens e recibos de gravação confirmam o caminho MQTT completo');
  return {ok:true,checkedAt:new Date().toISOString(),checks,storage:'postgresql-pglite',mqtt:'3.1.1/TCP',messageCount:audits.rows.length,commandId:on.commandId};
}
