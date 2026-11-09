import { randomUUID } from 'node:crypto';
import type { Config, SimulationScenario } from '../contracts.js';
import type { TransactionDatabase } from '../persistence/database.js';
import { DomainRejection, PostgresDeviceStore } from '../persistence/store.js';
import { IntegratedReader } from './reader.js';
import { MqttWorker, type BrokerSettings } from './worker.js';
export interface VirtualController { scenario:()=>SimulationScenario; setScenario:(scenario:unknown)=>Promise<void> }
export class IntegratedRuntime {
  readonly store:PostgresDeviceStore; readonly reader:IntegratedReader; readonly worker:MqttWorker;
  constructor(readonly options:{database:TransactionDatabase;deviceId:string;broker:BrokerSettings;virtual?:boolean;controller?:VirtualController;storage?:'postgres'|'pglite'}) {
    this.store=new PostgresDeviceStore(options.database);this.reader=new IntegratedReader(options.database,options.deviceId);
    this.worker=new MqttWorker(this.store,this.reader,options.deviceId,options.broker);
  }
  async start() {
    const m=await this.reader.metadata(); if (!m?.mqtt_habilitado) throw new DomainRejection('Execute a migração e habilite a bancada MQTT antes de iniciar o modo integrado.');
    await this.worker.start();
  }
  async stop() {await this.worker.stop();}
  health() {return {mode:this.options.virtual ? 'mqtt-virtual' : 'mqtt',storage:this.options.storage ?? 'postgres',mqtt:{...this.worker.status}};}
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
