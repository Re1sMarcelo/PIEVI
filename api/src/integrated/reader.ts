import type { Alert, CommandAction, CommandResult, Config, DeviceEvent, DeviceHistory, PumpId, Snapshot, Telemetry } from '../contracts.js';
import { DEFAULT_CONFIG } from '../controlConfig.js';
import type { Sql, TransactionDatabase } from '../persistence/database.js';
import { DomainRejection, iso, type Payload } from '../persistence/domain.js';
import { dbNow } from '../persistence/clock.js';

const pumpId=(value:string):PumpId=>value==='irrigacao' ? 'B1' : 'B2';
const actions:Record<string,CommandAction>={manual_on:'MANUAL_ON',manual_off:'MANUAL_OFF',voltar_auto:'AUTO',reset_falha:'RESET_FAULT',testar_bomba:'TEST',ignorar_boia:'IGNORE_FLOAT'};
const statuses:Record<string,CommandResult['status']>={pendente:'pending',enviado:'sent',aceito:'accepted',concluido:'completed',expirado:'expired',rejeitado:'rejected'};
export function commandDto(row:Payload):CommandResult {
  return {commandId:row.id_externo,deviceId:row.identificador ?? row.payload.deviceId,pumpId:row.atuador ? pumpId(row.atuador) : null as any,
    action:actions[row.tipo] ?? 'APPLY_CONFIG' as any,expiresAt:iso(row.valido_ate)!,createdAt:iso(row.criado_em)!,
    completedAt:iso(row.finalizado_em),status:statuses[row.status],reason:row.motivo_resultado,
    ...(row.duracao_s===null ? {} : {durationSeconds:Number(row.duracao_s)}),supervisionConfirmed:row.supervisao_confirmada};
}
function telemetryDto(row:Payload|undefined,deviceId:string):Telemetry {
  if (!row) return {id:'unavailable',deviceId,occurredAt:new Date(0).toISOString(),airTemperatureC:null,airHumidityPercent:null,substrateTemperatureC:null,
    soilMoisturePercent:null,waterLevel:'LOW',dhtReliable:false,soilReliable:false,rootReliable:false,clockReliable:false,timeBasis:'received'};
  const n=(key:string)=>row[key]===null ? null : Number(row[key]);
  return {id:String(row.id),deviceId,occurredAt:iso(row.ts ?? row.recebido_em)!,airTemperatureC:n('temp_ar'),airHumidityPercent:n('umid_ar'),
    substrateTemperatureC:n('temp_raiz'),soilMoisturePercent:n('umid_solo'),waterLevel:row.nivel_ok ? 'OK' : 'LOW',
    dhtReliable:row.dht_confiavel,rootReliable:row.raiz_confiavel,soilReliable:row.solo_confiavel && (!row.calibracao_externa || row.calibracao_id!==null),
    clockReliable:row.hora_confiavel,timeBasis:row.ts ? 'device' : 'received'};
}
function alertDto(row:Payload,deviceId:string):Alert {
  return {id:row.id_externo,deviceId,code:row.codigo,severity:row.severidade==='critico' ? 'critical' : row.severidade==='aviso' ? 'warning' : 'info',
    title:row.mensagem,suggestedAction:row.acao_sugerida,startedAt:iso(row.aberto_no_esp_em ?? row.aberto_em)!,
    endedAt:iso(row.resolvido_no_esp_em ?? row.resolvido_em),acknowledgedAt:iso(row.reconhecido_em),
    startedAtBasis:row.aberto_no_esp_em ? 'device' : 'received',endedAtBasis:row.resolvido_no_esp_em ? 'device' : 'received'};
}
export async function configDto(db:Sql,row:Payload|undefined):Promise<Config> {
  if (!row) return structuredClone(DEFAULT_CONFIG);
  const schedules=(await db.query('SELECT * FROM irrigacao_programada WHERE configuracao_id=$1 ORDER BY horario_local',[row.id])).rows;
  return {soilMinPercent:Number(row.solo_min),soilMaxPercent:Number(row.solo_max),fogTemperatureOnC:Number(row.temp_nevoa_on),
    fogHumidityMinPercent:Number(row.ur_min_nevoa),fogHumidityBlockPercent:Number(row.ur_trava_nevoa),emergencyTemperatureC:Number(row.temp_emergencia),
    fogPulseSeconds:row.pulso_nevoa_s,fogPauseSeconds:row.pausa_nevoa_min*60,lowWaterBlocksPumps:true,irrigationMaxSeconds:row.irrig_max_s,
    irrigationCooldownMinutes:row.cooldown_irrig_min,irrigationMaxCyclesPerDay:row.irrig_max_ciclos_dia,irrigationWindowEnabled:row.janela_irrig_ativa,
    irrigationWindowStart:String(row.janela_inicio).slice(0,5),irrigationWindowEnd:String(row.janela_fim).slice(0,5),
    irrigationSchedule:schedules.map(s=>({time:String(s.horario_local).slice(0,5),durationSeconds:s.duracao_s,enabled:s.habilitada})),
    fogHysteresisC:Number(row.histerese_nevoa),rootAlertTemperatureC:Number(row.temp_raiz_alerta),manualIrrigationSeconds:row.manual_irrig_s,manualFogSeconds:row.manual_nevoa_s};
}
export class IntegratedReader {
  constructor(private readonly database:TransactionDatabase,private readonly deviceId:string) {}
  async metadata() {
    return this.database.transaction(async db=>(await db.query(`SELECT d.id,d.identificador,d.mqtt_habilitado,d.online,s.* FROM dispositivos d
      LEFT JOIN mqtt_sessoes s ON s.dispositivo_id=d.id WHERE d.identificador=$1`,[this.deviceId])).rows[0]);
  }
  async snapshot(brokerReady:boolean,virtual:boolean):Promise<Snapshot> {
    return this.database.transaction(async db=>{
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const d=(await db.query(`SELECT d.id,d.fuso_horario,d.online,s.* FROM dispositivos d LEFT JOIN mqtt_sessoes s ON s.dispositivo_id=d.id
        WHERE d.identificador=$1 AND d.mqtt_habilitado`,[this.deviceId])).rows[0];
      if (!d) throw new DomainRejection('Bancada não habilitada para MQTT.');
      const device=d.dispositivo_id ?? d.id;
      const now=dbNow(); const recent=(value:any)=>!!value && now-Date.parse(iso(value)!)<=45000;
      const online=brokerReady && d.online && !!d.sincronizada_em && d.maior_boot===d.boot_numero && recent(d.ultimo_contato);
      const cfg=(await db.query('SELECT * FROM config_atual WHERE dispositivo_id=$1',[device])).rows[0];
      const reading=d.leitura_id ? (await db.query('SELECT * FROM leituras WHERE id=$1',[d.leitura_id])).rows[0] : undefined;
      const states=(await db.query('SELECT * FROM estado_atual WHERE dispositivo_id=$1',[device])).rows;
      const alerts=(await db.query('SELECT * FROM alertas WHERE dispositivo_id=$1 AND resolvido_em IS NULL ORDER BY aberto_em DESC',[device])).rows;
      const cycles=(await db.query(`SELECT count(*)::int total FROM acionamentos WHERE dispositivo_id=$1 AND atuador='irrigacao' AND origem IN ('auto','fallback')
        AND coalesce(inicio,inicio_recebido_em)>=(date_trunc('day',clock_timestamp() AT TIME ZONE $2) AT TIME ZONE $2)`,[device,d.fuso_horario])).rows[0].total;
      const lastSeen=d.estado_recebido_em && d.leitura_recebida_em ? new Date(Math.min(Date.parse(iso(d.estado_recebido_em)!),Date.parse(iso(d.leitura_recebida_em)!))).toISOString() : new Date(0).toISOString();
      const pumps={} as Snapshot['pumps'];
      for (const id of ['B1','B2'] as const) {
        const state=states.find(s=>s.atuador===(id==='B1' ? 'irrigacao' : 'nevoa'));
        pumps[id]={id,mode:state?.modo ?? 'AUTO',isOn:state?.ligado ?? false,expiresAt:iso(state?.expira_em),
          blockedReason:online && recent(d.estado_recebido_em) ? state?.bloqueio ?? null : 'Sem estado recente do ESP',faultCode:state?.falha ?? null,floatOverrideUntil:iso(state?.boia_ignorada_ate)};
      }
      return {deviceId:this.deviceId,online,lastSeenAt:lastSeen,simulation:virtual,mode:virtual ? 'mqtt-virtual' : 'mqtt',
        telemetry:telemetryDto(reading,this.deviceId),pumps,activeAlerts:alerts.map(a=>alertDto(a,this.deviceId)),config:await configDto(db,cfg),
        configVersion:cfg?.versao ?? 0,configApplied:!!cfg && d.config_versao===cfg.versao,configAppliedAt:iso(cfg?.aplicada_em),
        timeZone:d.fuso_horario,irrigationCyclesToday:cycles,simulationScenario:'normal',scenarioControlsEnabled:false,simulationClockOffsetMs:0};
    });
  }
  async history():Promise<DeviceHistory> {
    return this.database.transaction(async db=>{
      await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const device=(await db.query('SELECT id FROM dispositivos WHERE identificador=$1',[this.deviceId])).rows[0]?.id;
      if (!device) throw new DomainRejection('Bancada não encontrada.');
      const readings=(await db.query('SELECT * FROM leituras WHERE dispositivo_id=$1 ORDER BY id DESC LIMIT 500',[device])).rows;
      const alerts=(await db.query('SELECT * FROM alertas WHERE dispositivo_id=$1 ORDER BY id DESC LIMIT 500',[device])).rows;
      const rows=(await db.query('SELECT * FROM eventos WHERE dispositivo_id=$1 ORDER BY id DESC LIMIT 500',[device])).rows;
      const events:DeviceEvent[]=[];
      for (const row of rows) {
        const p=row.detalhes; const base={id:String(row.id),deviceId:this.deviceId,occurredAt:iso(row.ocorrido_em ?? row.recebido_em)!,description:row.descricao,origin:row.origem==='operador' ? 'operator' as const : 'esp32' as const};
        if (p.type==='state' && p.changedPumps) {
          for (const id of p.changedPumps as PumpId[]) events.push({...base,id:`${row.id}:${id}`,kind:'actuation',pumpId:id,outputOn:p.pumps[id].isOn,description:`${id} ${p.pumps[id].isOn ? 'ligada' : 'desligada'} · ${p.pumps[id].mode==='AUTO' ? 'automático' : 'manual'}`});
        } else if (p.eventType==='cycle') events.push({...base,kind:'actuation',pumpId:p.pumpId,description:`${p.pumpId}: ciclo ${p.phase==='finished' ? 'encerrado' : 'iniciado'} · ${p.reason}`});
        else if (p.type==='ack') {
          const command=(await db.query('SELECT * FROM comandos WHERE dispositivo_id=$1 AND id_externo=$2',[device,p.commandId])).rows[0];
          if (command?.tipo==='config' && p.status==='completed' && p.appliedConfigVersion) {
            const config=(await db.query('SELECT * FROM config_historico WHERE dispositivo_id=$1 AND versao=$2 AND aplicada_no_esp',[device,p.appliedConfigVersion])).rows[0];
            if (config) events.push({...base,kind:'configuration',configVersion:config.versao,appliedConfig:await configDto(db,config),description:`Configuração v${config.versao} aplicada pelo ESP.`});
          } else events.push({...base,kind:'command',pumpId:command?.atuador ? pumpId(command.atuador) : undefined,commandId:p.commandId,commandStatus:p.status});
        } else events.push({...base,kind:row.tipo==='alerta' ? 'alert' : row.tipo==='conexao' ? 'connection' : 'mode_change',...(p.machine==='irrigation' ? {pumpId:'B1' as const} : p.machine==='fog' ? {pumpId:'B2' as const} : {})});
      }
      // A reconciled state may confirm an applied config even if the ACK was lost.
      const configs=(await db.query('SELECT * FROM config_historico WHERE dispositivo_id=$1 AND aplicada_no_esp ORDER BY versao DESC LIMIT 100',[device])).rows;
      for (const c of configs) if (!events.some(e=>e.kind==='configuration' && e.configVersion===c.versao)) events.push({id:`config:${c.id}`,deviceId:this.deviceId,occurredAt:iso(c.aplicada_em)!,kind:'configuration',origin:'esp32',description:`Configuração v${c.versao} confirmada.`,configVersion:c.versao,appliedConfig:await configDto(db,c)});
      return {telemetry:readings.map(r=>telemetryDto(r,this.deviceId)),alerts:alerts.map(a=>alertDto(a,this.deviceId)),events:events.sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt))};
    });
  }
  async command(commandId:string) {
    return this.database.transaction(async db=>{
      const row=(await db.query(`SELECT c.* FROM comandos c JOIN dispositivos d ON d.id=c.dispositivo_id WHERE d.identificador=$1 AND c.id_externo=$2`,[this.deviceId,commandId])).rows[0];
      return row ? commandDto(row) : null;
    });
  }
}
