import type { FastifyInstance } from 'fastify';
import type { Config, CommandRequest } from '../contracts.js';
import { configError } from '../controlConfig.js';
import { commandDto } from './reader.js';
import type { IntegratedRuntime } from './runtime.js';
import { DomainRejection } from '../persistence/store.js';
import { dbNow } from '../persistence/clock.js';

export function registerIntegratedRoutes(app:FastifyInstance,runtime:IntegratedRuntime) {
  const root='/v1/devices/:deviceId'; const device=runtime.options.deviceId;
  const token=(request:any)=>request.headers.authorization!.match(/^Bearer\s+([0-9a-f]{64})$/i)![1];
  app.addHook('preHandler',async(request,reply)=>{
    const id=(request.params as {deviceId?:string}).deviceId;
    if (id && id!==device) return reply.code(404).send({error:'Dispositivo não encontrado.'});
  });
  app.get(`${root}/snapshot`,async()=>runtime.snapshot());
  app.get(`${root}/history`,async()=>runtime.reader.history());
  for (const [path,key] of [['telemetry','telemetry'],['events','events'],['alerts','alerts']] as const) {
    app.get(`${root}/${path}`,async()=>({items:(await runtime.reader.history())[key],nextCursor:null}));
  }
  app.get(`${root}/config`,async(_request,reply)=>{const snapshot=await runtime.snapshot();reply.header('ETag',`"${snapshot.configVersion}"`);return snapshot.config;});
  app.put(`${root}/config`,async(request,reply)=>{
    const body=request.body; if (!body || typeof body!=='object' || Array.isArray(body)) return reply.code(400).send({error:'Configuração inválida.'});
    const current=await runtime.snapshot(); const config={...current.config,...body} as Config;
    const error=configError(config);if(error)return reply.code(400).send({error});
    const expected=request.headers['if-match'];
    if (expected!==undefined && !/^"\d+"$/.test(String(expected))) return reply.code(400).send({error:'If-Match inválido.'});
    const result=await runtime.submitConfig(token(request),config,expected===undefined ? undefined : Number(String(expected).slice(1,-1)));
    return reply.code(202).send(result);
  });
  app.post(`${root}/commands`,async(request,reply)=>{
    const body=request.body as Partial<CommandRequest>|null;
    if (!body || !['B1','B2'].includes(body.pumpId as string) || !['AUTO','MANUAL_ON','MANUAL_OFF','TEST','RESET_FAULT','IGNORE_FLOAT'].includes(body.action as string)
      || typeof body.commandId!=='string' || typeof body.expiresAt!=='string') return reply.code(400).send({error:'Comando inválido.'});
    if (Date.parse(body.expiresAt)<=dbNow() || !Number.isFinite(Date.parse(body.expiresAt))) return reply.code(422).send({error:'Pedido do aplicativo vencido. Atualize e tente novamente.'});
    if (!runtime.worker.status.ready) throw new DomainRejection('Broker MQTT indisponível.');
    const result=await runtime.store.createCommand(device,token(request),{commandId:body.commandId,action:body.action!,pumpId:body.pumpId!,durationSeconds:body.durationSeconds,supervisionConfirmed:body.supervisionConfirmed});
    const command=commandDto(result.command);return reply.code(command.status==='completed' ? 200 : 202).send(command);
  });
  app.get(`${root}/commands/:commandId`,async(request,reply)=>{
    await runtime.store.pendingPublications(); // materialize deadlines even while a broker is unavailable
    const command=await runtime.reader.command((request.params as any).commandId);
    return command ?? reply.code(404).send({error:'Comando não encontrado.'});
  });
  app.post(`${root}/alerts/:alertId/ack`,async(request)=>{
    await runtime.store.acknowledgeAlert(device,token(request),(request.params as any).alertId);
    return (await runtime.reader.history()).alerts.find(a=>a.id===(request.params as any).alertId);
  });
  app.put(`${root}/simulation`,async(request,reply)=>{
    if (!runtime.options.controller) return reply.code(404).send({error:'Controle virtual não habilitado neste ambiente.'});
    const body=request.body as any;
    if (body?.advanceSeconds!==undefined) return reply.code(400).send({error:'No fluxo MQTT o relógio é real. Aguarde o temporizador.'});
    await runtime.options.controller.setScenario(body?.scenario);
    return runtime.snapshot();
  });
}
