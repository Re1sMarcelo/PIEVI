import { connect, type MqttClient, type IClientOptions } from 'mqtt';
import { PostgresDeviceStore } from '../persistence/store.js';
import { IntegratedReader } from './reader.js';
import { mqttTopic } from '../mqtt/protocol.js';
import { publishConfirmed } from './publish.js';

export interface BrokerSettings { url:string; username:string; password:string; clientId:string }
export class MqttWorker {
  private client?:MqttClient; private timer?:ReturnType<typeof setInterval>; private stopped=false; private running=false;
  private inbound=Promise.resolve(); private generation=0; private lastSweep=0;
  private initializing=Promise.resolve();
  readonly status={connected:false,ready:false,lastError:null as string|null,received:0,rejected:0,published:0};
  constructor(private readonly store:PostgresDeviceStore,private readonly reader:IntegratedReader,private readonly deviceId:string,private readonly settings:BrokerSettings) {}
  async start() {
    await this.store.invalidateSessions();
    const options:IClientOptions={protocolVersion:4,clientId:this.settings.clientId,username:this.settings.username,password:this.settings.password,
      clean:false,keepalive:30,reconnectPeriod:1000,connectTimeout:5000,resubscribe:false,queueQoSZero:false};
    this.client=connect(this.settings.url,options);
    this.client.on('error',()=>{this.status.lastError='Falha de conexão MQTT';});
    this.client.on('close',()=>{this.generation++;this.status.connected=false;this.status.ready=false;});
    this.client.on('connect',()=>{
      const generation=++this.generation; this.status.connected=true; this.status.ready=false;
      this.initializing=(async()=>{
        await this.store.invalidateSessions();
        await this.client!.subscribeAsync(['telemetry','state','events','acks','presence'].map(c=>mqttTopic(this.deviceId,c as any)),{qos:1});
        await this.store.createSyncRequest(this.deviceId);
        if (!this.stopped && generation===this.generation) {this.status.ready=true;this.status.lastError=null;}
      })().catch(()=>{this.status.lastError='Não foi possível preparar a sessão MQTT/PostgreSQL';if(!this.stopped)this.client?.stream.destroy();});
    });
    this.client.on('message',(topic,bytes,packet)=>{
      if (this.stopped) return;
      this.inbound=this.inbound.then(async()=>{
        await this.initializing;
        if (this.stopped) return;
        const result=await this.store.ingest(topic,bytes,{authenticatedDeviceId:this.deviceId,retained:packet.retain});
        this.status.received++; if (result.status==='rejected') this.status.rejected++;
        if (result.status==='presence' && !packet.retain) {
          const p=JSON.parse(bytes.toString()); const m=await this.reader.metadata();
          if (p.online && m?.conexao_id!==p.connectionId) await this.store.createSyncRequest(this.deviceId);
        }
      }).catch(()=>{this.status.lastError='Mensagem não processada; o ESP poderá reenviar';});
    });
    this.timer=setInterval(()=>{void this.pump();},250); this.timer.unref();
  }
  private async pump() {
    if (this.stopped || this.running || !this.status.ready || !this.client?.connected) return;
    this.running=true;
    try {
      const m=await this.reader.metadata();
      const live=!!m?.sincronizada_em && m.maior_boot===m.boot_numero && m.ultimo_contato && Date.now()-new Date(m.ultimo_contato).getTime()<45000;
      if (!live && (!m?.sync_expira_em || new Date(m.sync_expira_em).getTime()<=Date.now())) await this.store.createSyncRequest(this.deviceId);
      for (const packet of await this.store.pendingPublications()) {
        if (!this.client.connected || this.stopped) break;
        await publishConfirmed(this.client,packet.topico,JSON.stringify(packet.payload));
        await this.store.markPublished(packet.id); this.status.published++;
      }
      if (Date.now()-this.lastSweep>5000) {await this.store.sweepOffline();this.lastSweep=Date.now();}
    } catch {this.status.lastError='Fila MQTT/PostgreSQL temporariamente indisponível';}
    finally {this.running=false;}
  }
  async stop() {
    this.stopped=true; this.generation++; this.status.ready=false;
    if (this.timer) clearInterval(this.timer);
    await this.inbound;
    while (this.running) await new Promise(resolve=>setTimeout(resolve,25));
    await this.client?.endAsync(true);
    this.status.connected=false;
  }
}
