import { randomUUID } from 'node:crypto';
import type { Config, SimulationScenario } from '../contracts.js';
import type { TransactionDatabase } from '../persistence/database.js';
import { DomainRejection, PostgresDeviceStore } from '../persistence/store.js';
import { IntegratedReader } from './reader.js';
import { MqttWorker, type BrokerSettings } from './worker.js';
import { dbClockOffsetMs, syncDbClock } from '../persistence/clock.js';
export interface VirtualController { scenario:()=>SimulationScenario; setScenario:(scenario:unknown)=>Promise<void> }
export class IntegratedRuntime {
  readonly store:PostgresDeviceStore; readonly reader:IntegratedReader; readonly worker:MqttWorker;
  constructor(readonly options:{database:TransactionDatabase;deviceId:string;broker:BrokerSettings;virtual?:boolean;controller?:VirtualController;storage?:'postgres'|'pglite'}) {
    this.store=new PostgresDeviceStore(options.database);this.reader=new IntegratedReader(options.database,options.deviceId);
    this.worker=new MqttWorker(this.store,this.reader,options.deviceId,options.broker);
  }
  private clockTimer?:ReturnType<typeof setInterval>;
  async start() {
    const m=await this.reader.metadata(); if (!m?.mqtt_habilitado) throw new DomainRejection('Execute a migração e habilite a bancada MQTT antes de iniciar o modo integrado.');
    await syncDbClock(this.options.database);   // relogio de referencia = banco (ver persistence/clock.ts)
    this.clockTimer=setInterval(()=>{void syncDbClock(this.options.database).catch(()=>undefined);},60_000); this.clockTimer.unref();
    await this.worker.start();
  }
  async stop() {if(this.clockTimer)clearInterval(this.clockTimer);await this.worker.stop();}
  health() {return {mode:this.options.virtual ? 'mqtt-virtual' : 'mqtt',storage:this.options.storage ?? 'postgres',dbClockOffsetMs:dbClockOffsetMs(),mqtt:{...this.worker.status}};}
  async snapshot() {
    const snapshot=await this.reader.snapshot(this.worker.status.ready,this.options.virtual ?? false);
    snapshot.scenarioControlsEnabled=!!this.options.controller;
    snapshot.simulationScenario=this.options.controller?.scenario() ?? 'normal';
    return snapshot;
  }
  async submitConfig(token:string,config:Config,expectedVersion?:number) {
    if (!this.worker.status.ready) throw new DomainRejection('Broker MQTT indisponível.');
    const result=await this.store.createCommand(this.options.deviceId,token,{commandId:randomUUID(),action:'APPLY_CONFIG',pumpId:null,config,expectedAppliedVersion:expectedVersion});
    return {commandId:result.payload.commandId,requestedVersion:result.payload.configVersion,status:'pending' as const};
  }
}
