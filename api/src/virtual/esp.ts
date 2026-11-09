import { randomUUID } from 'node:crypto';
import { connect, type MqttClient } from 'mqtt';
import { Simulator } from '../simulator.js';
import type { Config, PumpId, SimulationScenario, Snapshot } from '../contracts.js';
import { mqttTopic, validateMqttPacket } from '../mqtt/protocol.js';
import { canonicalJson } from '../persistence/store.js';
import { DomainRejection } from '../persistence/domain.js';
import { configError } from '../controlConfig.js';
import type { BrokerSettings } from '../integrated/worker.js';
import { publishConfirmed } from '../integrated/publish.js';

export interface VirtualNvs { bootNumber:number; configVersion:number; config:Config; calibrationId:string }
type Packet=Record<string,any>;
export class VirtualESP {
  readonly bootId=randomUUID(); private connectionId=randomUUID(); private sequence=0; private started=performance.now();
  private client?:MqttClient; private timer?:ReturnType<typeof setInterval>; private reconnect?:ReturnType<typeof setTimeout>; private stopped=false;
  private engine=new Simulator(); private lastSensor=0; private lastPublish=0; private scenarioName:SimulationScenario='normal';
  private seenEvents=new Set<string>(); private alerts=new Map<string,Packet>(); private cycles:Partial<Record<PumpId,Packet>>={};
  private commands=new Map<string,{payload:Packet;status:string;reason:string|null;appliedVersion:number|null}>();
  private activeCommands:Partial<Record<PumpId,Packet>>={}; private modeStarts:Partial<Record<PumpId,string>>={};
  private pending=new Map<string,{topic:string;body:string;channel:string;sent:number}>();
  readonly status={connected:false,lastError:null as string|null,receivedCommands:0,receipts:0,droppedMessages:0};
  constructor(readonly options:{deviceId:string;broker:BrokerSettings;nvs:VirtualNvs;saveNvs?:(nvs:VirtualNvs)=>void;publishMs?:number}) {
    this.engine.updateConfig(options.nvs.config);this.seenEvents=new Set(this.engine.getEvents().map(e=>e.id));
  }
  scenario=()=>this.scenarioName;
  private envelope(type:string) {
    const sequence=++this.sequence; const reliable=this.engine.getSnapshot().telemetry.clockReliable;
    return {schemaVersion:1,type,deviceId:this.options.deviceId,bootId:this.bootId,bootNumber:this.options.nvs.bootNumber,
      connectionId:this.connectionId,sequence,messageId:`${this.bootId}:${sequence}`,uptimeMs:Math.floor(performance.now()-this.started),
      clockReliable:reliable,occurredAt:reliable ? new Date().toISOString() : null};
  }
  private send(channel:'telemetry'|'state'|'events'|'acks',payload:Packet) {
    const topic=mqttTopic(this.options.deviceId,channel);const body=JSON.stringify(payload);
    const validation=validateMqttPacket(topic,body,false);
    if(!validation.ok){this.status.lastError=validation.error;return;}
    if(channel==='telemetry'||channel==='state') for(const [id,entry] of this.pending) if(entry.channel===channel)this.pending.delete(id);
    this.pending.set(payload.messageId,{topic,body,channel,sent:0});
    const queued=()=>[...this.pending].filter(([,p])=>p.channel==='events'||p.channel==='acks');
    while(queued().length>32 || [...this.pending.values()].reduce((sum,p)=>sum+Buffer.byteLength(p.body),0)>65536) {
      const oldest=queued()[0];if(!oldest)break;this.pending.delete(oldest[0]);this.status.droppedMessages++;
    }
    this.flush();
  }
  private flush() {
    if(!this.client?.connected || this.scenarioName==='offline' || this.scenarioName==='stale')return;
    for(const entry of this.pending.values()) if(Date.now()-entry.sent>=5000) {
      entry.sent=Date.now();void this.client.publishAsync(entry.topic,entry.body,{qos:1,retain:false}).catch(()=>{this.status.lastError='Publicação pendente; será reenviada.';});
    }
  }
  private measurements(s:Snapshot) {return {airTemperatureC:s.telemetry.dhtReliable ? s.telemetry.airTemperatureC : null,airHumidityPercent:s.telemetry.dhtReliable ? s.telemetry.airHumidityPercent : null,soilMoisturePercent:s.telemetry.soilReliable ? s.telemetry.soilMoisturePercent : null};}
  private alertPayload(a:Snapshot['activeAlerts'][number]) {
    return {episodeId:a.id,code:a.code,pumpId:a.code==='IRRIG_FALHA' ? 'B1' : a.code==='NEVOA_FALHA' ? 'B2' : null,
      severity:a.severity,startedAt:a.startedAt,detail:a.suggestedAction.slice(0,256)};
  }
  private syncOutputs() {
    const s=this.engine.getSnapshot();
    const events=this.engine.getEvents();const fresh=events.filter(e=>!this.seenEvents.has(e.id)).reverse();this.seenEvents=new Set(events.map(e=>e.id));
    for(const e of fresh) {
      if(e.kind==='actuation' && e.pumpId) {
        const id=e.pumpId;
        if(e.outputOn) {
          const cmd=this.activeCommands[id];const manual=s.pumps[id].mode==='MANUAL_ON';
          const source=manual ? cmd?.action==='TEST'||cmd?.action==='IGNORE_FLOAT' ? 'test' : 'manual' : id==='B1' ? s.telemetry.soilReliable ? 'auto' : 'fallback' : (s.telemetry.airTemperatureC ?? 0)>=s.config.emergencyTemperatureC ? 'emergency' : 'auto';
          const cycle={eventType:'cycle',cycleId:randomUUID(),pumpId:id,source,commandId:manual ? cmd?.commandId ?? null : null,reason:e.description,
            startedAt:s.telemetry.clockReliable ? e.occurredAt : null,endedAt:null,elapsedSeconds:null,measurementsBefore:this.measurements(s),measurementsAfter:null,_start:performance.now()};
          this.cycles[id]=cycle;const {_start,...wire}=cycle;this.send('events',{...this.envelope('event'),...wire,phase:'started'});
        } else if(this.cycles[id]) {
          const {_start,...wire}=this.cycles[id]!;
          this.send('events',{...this.envelope('event'),...wire,phase:'finished',reason:e.description,endedAt:s.telemetry.clockReliable ? e.occurredAt : null,elapsedSeconds:Math.max(0,(performance.now()-_start)/1000),measurementsAfter:this.measurements(s)});
          delete this.cycles[id];
        }
      }
      if(e.kind==='command' && e.commandStatus==='completed' && e.commandId) {
        const c=this.commands.get(e.commandId);if(c && c.status==='accepted'){c.status='completed';c.reason='Tratamento do comando encerrado pelo temporizador ou substituição.';this.ack(c);}
      }
    }
    const current=new Map(s.activeAlerts.filter(a=>a.code!=='OFFLINE').map(a=>[a.id,this.alertPayload(a)]));
    for(const [id,a] of current) {
      const old=this.alerts.get(id);
      if(!old || canonicalJson(old)!==canonicalJson(a)) this.send('events',{...this.envelope('event'),eventType:'alert',phase:old ? 'updated' : 'opened',...a,endedAt:null});
    }
    for(const [id,a] of this.alerts) if(!current.has(id))this.send('events',{...this.envelope('event'),eventType:'alert',phase:'resolved',...a,endedAt:s.telemetry.clockReliable ? new Date().toISOString() : null});
    const changed=fresh.some(e=>e.kind==='actuation'||e.kind==='mode_change') || canonicalJson([...current])!==canonicalJson([...this.alerts]);
    this.alerts=current;
    if(changed && this.status.connected && !['offline','stale'].includes(this.scenarioName))this.publishState();
  }
  private publishTelemetry() {
    const t=this.engine.getSnapshot().telemetry;
    this.send('telemetry',{...this.envelope('telemetry'),airTemperatureC:t.dhtReliable ? t.airTemperatureC : null,airHumidityPercent:t.dhtReliable ? t.airHumidityPercent : null,
      substrateTemperatureC:t.rootReliable ? t.substrateTemperatureC : null,soilMoisturePercent:t.soilReliable ? t.soilMoisturePercent : null,
      soilMoistureAdc:t.soilReliable && t.soilMoisturePercent!==null ? Math.round(3000-t.soilMoisturePercent*18) : null,waterLevel:t.waterLevel,
      dhtReliable:t.dhtReliable,rootReliable:t.rootReliable,soilReliable:t.soilReliable,activeCalibrationId:this.options.nvs.calibrationId});
  }
  private publishState(syncId:string|null=null) {
    const s=this.engine.getSnapshot();const pumps:Packet={};
    for(const id of ['B1','B2'] as const) {
      const p=s.pumps[id];const manual=p.mode!=='AUTO';
      pumps[id]={mode:p.mode,isOn:p.isOn,fsmState:manual ? p.mode : p.faultCode ? 'FAULT' : p.blockedReason ? 'BLOCKED' : p.isOn ? 'RUNNING' : 'IDLE',
        modeStartedAt:manual ? this.modeStarts[id] ?? new Date().toISOString() : null,expiresAt:manual ? p.expiresAt : null,
        remainingSeconds:manual && p.expiresAt ? Math.max(0,Math.ceil((Date.parse(p.expiresAt)-Date.now())/1000)) : null,
        blockedReason:p.blockedReason,faultCode:p.faultCode,floatOverrideUntil:p.floatOverrideUntil,feedback:'relay_output'};
    }
    this.send('state',{...this.envelope('state'),syncId,activeConfigVersion:this.options.nvs.configVersion,firmwareVersion:'pievi-esp-virtual-1.0.0',droppedMessages:this.status.droppedMessages,pumps,activeAlerts:s.activeAlerts.filter(a=>a.code!=='OFFLINE').map(a=>this.alertPayload(a))});
  }
  private ack(c:{payload:Packet;status:string;reason:string|null;appliedVersion:number|null}) {
    this.send('acks',{...this.envelope('ack'),connectionId:c.payload.targetConnectionId,commandId:c.payload.commandId,status:c.status,reason:c.reason,appliedConfigVersion:c.appliedVersion});
  }
  private command(p:Packet) {
    this.status.receivedCommands++;
    const cached=this.commands.get(p.commandId);
    if(cached) {
      if(canonicalJson(cached.payload)===canonicalJson(p))this.ack(cached);
      else this.ack({payload:p,status:'rejected',reason:'commandId reutilizado com outro conteúdo.',appliedVersion:null});
      return;
    }
    const c={payload:p,status:'rejected',reason:null as string|null,appliedVersion:null as number|null};this.commands.set(p.commandId,c);
    if(p.targetBootId!==this.bootId || p.targetBootNumber!==this.options.nvs.bootNumber || p.targetConnectionId!==this.connectionId)c.reason='Alvo de boot/conexão diferente.';
    else if(Date.parse(p.expiresAt)<=Date.now())c.reason='Comando vencido.';
    else if(!this.engine.getSnapshot().telemetry.clockReliable)c.reason='Relógio sem hora confiável.';
    else if(p.action==='APPLY_CONFIG') {
      if(p.configVersion<this.options.nvs.configVersion || p.configVersion===this.options.nvs.configVersion && canonicalJson(p.config)!==canonicalJson(this.options.nvs.config))c.reason='Versão antiga ou conteúdo conflitante.';
      else if(configError(p.config))c.reason='Configuração recusada pelo controlador.';
      else {
        const next={...this.options.nvs,configVersion:p.configVersion,config:structuredClone(p.config)};
        try {
          this.options.saveNvs?.(next);
          if(!this.engine.updateConfig(p.config))throw new Error('Controlador indisponível.');
          this.options.nvs=next;c.status='completed';c.appliedVersion=p.configVersion;
        }
        catch {c.reason='Não foi possível aplicar/persistir a configuração virtual.';this.engine.updateConfig(this.options.nvs.config);try{this.options.saveNvs?.(this.options.nvs);}catch{}}
      }
    } else {
      const id=p.pumpId as PumpId;
      const result=this.engine.issueCommand({commandId:p.commandId,pumpId:id,action:p.action,expiresAt:p.expiresAt,
        ...(p.durationSeconds===null ? {} : {durationSeconds:p.durationSeconds}),supervisionConfirmed:p.supervisionConfirmed});
      if(result.status==='accepted'||result.status==='completed') {
        this.activeCommands[id]=p;
        // The controller computes expiresAt while processing the request. Recording
        // the start before that call can make a maximum timer exceed its contract
        // by milliseconds and prevent every subsequent state from being sent.
        this.modeStarts[id]=new Date().toISOString();
      }
      c.status=result.status==='expired' ? 'rejected' : result.status;c.reason=result.reason;
    }
    this.ack(c);this.syncOutputs();this.publishState();this.publishTelemetry();
  }
  private connect() {
    if(this.stopped || this.scenarioName==='offline')return;
    this.connectionId=randomUUID();const presence={schemaVersion:1,type:'presence',deviceId:this.options.deviceId,bootId:this.bootId,bootNumber:this.options.nvs.bootNumber,connectionId:this.connectionId,online:false};
    const client=connect(this.options.broker.url,{protocolVersion:4,clientId:this.options.broker.clientId,username:this.options.broker.username,password:this.options.broker.password,
      clean:true,keepalive:30,reconnectPeriod:0,connectTimeout:5000,queueQoSZero:false,will:{topic:mqttTopic(this.options.deviceId,'presence'),payload:Buffer.from(JSON.stringify(presence)),qos:1,retain:true}});
    this.client=client;
    client.on('error',()=>{this.status.lastError='ESP virtual sem conexão com o broker';});
    client.on('close',()=>{this.status.connected=false;if(!this.stopped && this.scenarioName!=='offline')this.reconnect=setTimeout(()=>this.connect(),1000);});
    client.on('connect',()=>{void (async()=>{
      await client.subscribeAsync(['commands','sync','receipts'].map(c=>mqttTopic(this.options.deviceId,c as any)),{qos:1});
      this.status.connected=true;this.status.lastError=null;
      await client.publishAsync(mqttTopic(this.options.deviceId,'presence'),JSON.stringify({...presence,online:true}),{qos:1,retain:true});
      this.send('events',{...this.envelope('event'),eventType:'calibration',calibrationId:this.options.nvs.calibrationId,adcDry:3000,adcWater:1200});
      if(this.scenarioName!=='stale'){this.syncOutputs();this.publishState();this.publishTelemetry();}
    })().catch(()=>{this.status.lastError='Não foi possível assinar os tópicos do ESP virtual.';});});
    client.on('message',(topic,bytes,packet)=>{
      const parsed=validateMqttPacket(topic,bytes,packet.retain);if(!parsed.ok){this.status.lastError=parsed.error;return;}
      const p=parsed.payload;
      if(parsed.channel==='receipts' && p.sourceBootId===this.bootId) {this.pending.delete(p.sourceMessageId);this.status.receipts++;if(p.status==='rejected')this.status.lastError=p.reason;}
      if(parsed.channel==='sync' && this.scenarioName!=='stale' && Date.parse(p.expiresAt)>Date.now())this.publishState(p.syncId);
      if(parsed.channel==='commands' && this.scenarioName!=='stale')this.command(p);
    });
  }
  async start() {
    this.connect();
    this.timer=setInterval(()=>{
      if(Date.now()-this.lastSensor>=1000){this.engine.recordTelemetry();this.lastSensor=Date.now();} else this.engine.tick();
      this.syncOutputs();
      if(this.status.connected && !['offline','stale'].includes(this.scenarioName) && Date.now()-this.lastPublish>=(this.options.publishMs ?? 2000)) {
        this.publishTelemetry();this.publishState();this.lastPublish=Date.now();
      }
      this.flush();
    },100);this.timer.unref();
  }
  async setScenario(value:unknown) {
    if(!this.engine.setScenario(value))throw new DomainRejection('Cenário virtual inválido.');
    this.scenarioName=value as SimulationScenario;this.syncOutputs();
    if(this.scenarioName==='offline') {if(this.reconnect)clearTimeout(this.reconnect);await this.client?.endAsync(true);}
    else if(!this.client?.connected) this.connect();
    else if(this.scenarioName!=='stale'){this.publishTelemetry();this.publishState();}
  }
  async stop() {
    this.stopped=true;if(this.timer)clearInterval(this.timer);if(this.reconnect)clearTimeout(this.reconnect);
    if(this.client?.connected) await publishConfirmed(this.client,mqttTopic(this.options.deviceId,'presence'),JSON.stringify({schemaVersion:1,type:'presence',deviceId:this.options.deviceId,bootId:this.bootId,bootNumber:this.options.nvs.bootNumber,connectionId:this.connectionId,online:false}),true).catch(()=>undefined);
    await this.client?.endAsync(true);this.status.connected=false;
  }
}
