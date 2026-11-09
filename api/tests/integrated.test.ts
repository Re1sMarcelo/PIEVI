import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startLab, waitFor } from '../src/lab/index.js';
import { randomUUID } from 'node:crypto';
import { validateIntegratedLab } from '../src/lab/validate.js';
import {startLocalBroker} from '../src/lab/broker.js';
import {connect} from 'mqtt';
import { validateVirtualDeployment } from '../src/lab/validateDeployment.js';
import type { Simulator } from '../src/simulator.js';

test('HTTP > API > MQTT TCP > ESP virtual > PostgreSQL > snapshot/histórico', {timeout:60000}, async()=>{
  const lab=await startLab({apiPort:0,brokerPort:0,host:'127.0.0.1'});
  try {
    const headers={Authorization:`Bearer ${lab.token}`,'Content-Type':'application/json'};
    const initial=await lab.runtime.snapshot();assert.equal(initial.configApplied,true);assert.equal(initial.mode,'mqtt-virtual');
    const commandId=randomUUID();
    const response=await fetch(`${lab.url}/v1/devices/bancada-01/commands`,{method:'POST',headers,body:JSON.stringify({commandId,pumpId:'B1',action:'MANUAL_ON',durationSeconds:2,expiresAt:new Date(Date.now()+10000).toISOString()})});
    assert.equal(response.status,202,await response.clone().text());
    await waitFor(()=>lab.runtime.snapshot(),s=>s.pumps.B1.isOn);
    await waitFor(()=>lab.runtime.reader.command(commandId),c=>c?.status==='completed');
    await waitFor(()=>lab.runtime.snapshot(),s=>!s.pumps.B1.isOn);
    const history=await lab.runtime.reader.history();
    assert.ok(history.events.some(e=>e.pumpId==='B1'&&e.kind==='actuation'&&e.outputOn===true));
    assert.ok(history.events.some(e=>e.pumpId==='B1'&&e.kind==='actuation'&&e.outputOn===false));
    assert.ok(lab.esp.status.receivedCommands>=2);assert.ok(lab.esp.status.receipts>0);
    assert.equal(lab.esp.status.lastError,null);
  }finally{await lab.stop();}
});

test('ACL impede ESP de publicar no tópico de comandos',{timeout:15000},async()=>{
  const broker=await startLocalBroker('bancada-01',0);
  const esp=connect(broker.esp.url,{protocolVersion:4,clientId:broker.esp.clientId,username:broker.esp.username,password:broker.esp.password,reconnectPeriod:0});
  esp.on('error',()=>undefined);
  try{
    await new Promise<void>((resolve,reject)=>{esp.once('connect',()=>resolve());esp.once('error',reject);});
    await esp.subscribeAsync('pievi/v1/devices/bancada-01/commands',{qos:1});
    let forwarded=false;esp.on('message',()=>{forwarded=true;});
    const closed=new Promise<void>(resolve=>{esp.once('close',()=>resolve());});
    esp.publish('pievi/v1/devices/bancada-01/commands','{}',{qos:1});
    await closed;assert.equal(forwarded,false);
  }finally{await esp.endAsync(true);await broker.close();}
});

test('roteiro integrado: cenários, segurança, reconhecimento, configuração e idempotência',{timeout:90000},async()=>{
  const lab=await startLab({apiPort:0,brokerPort:0,host:'127.0.0.1'});
  try{const report=await validateIntegratedLab(lab);assert.equal(report.ok,true);assert.equal(report.checks.length,8);}
  finally{await lab.stop();}
});

test('roteiro de entrega valida API e SQL sem acessar o simulador interno', {timeout:60000}, async()=>{
  const lab=await startLab({apiPort:0,brokerPort:0,host:'127.0.0.1'});
  try {
    const report=await validateVirtualDeployment({url:lab.url,...lab.credentials,database:lab.runtime.options.database});
    assert.equal(report.checks.length,5);
    assert.equal(report.checkpoint.commandIds.length,2);
  } finally {await lab.stop();}
});

test('atraso no controlador não invalida estado nos tetos de B1/B2 ou MANUAL_OFF', {timeout:30000}, async context=>{
  const lab=await startLab({apiPort:0,brokerPort:0,host:'127.0.0.1'});
  try {
    const engine=Reflect.get(lab.esp,'engine') as Simulator;
    const issue=engine.issueCommand.bind(engine);
    context.mock.method(engine,'issueCommand',(input:Parameters<Simulator['issueCommand']>[0])=>{
      const receivedAt=Date.now();
      while(Date.now()===receivedAt) { /* cross a millisecond before computing the deadline */ }
      return issue(input);
    });
    for(const pumpId of ['B1','B2'] as const) {
      for(const action of ['MANUAL_ON','MANUAL_OFF'] as const) {
        const response=await fetch(`${lab.url}/v1/devices/bancada-01/commands`,{method:'POST',headers:{Authorization:`Bearer ${lab.token}`,'Content-Type':'application/json'},
          body:JSON.stringify({commandId:randomUUID(),pumpId,action,durationSeconds:pumpId==='B1' ? 300 : 60,expiresAt:new Date(Date.now()+10000).toISOString()})});
        assert.equal(response.status,202,await response.text());
        await waitFor(()=>lab.runtime.snapshot(),s=>s.pumps[pumpId].mode===action && s.pumps[pumpId].isOn===(action==='MANUAL_ON'),5000);
        assert.equal(lab.esp.status.lastError,null);
      }
    }
  } finally {await lab.stop();}
});
