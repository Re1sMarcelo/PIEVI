import { createHash, randomUUID } from 'node:crypto';
import { tokenHash } from '../auth/store.js';
import type { Config } from '../contracts.js';
import { mqttTopic, validateMqttPacket } from '../mqtt/protocol.js';
import type { TransactionDatabase, Sql } from './database.js';
import { DomainRejection, actuator, iso, persistAck, persistEvent, persistState, persistTelemetry, type Context, type Payload } from './domain.js';

export { DomainRejection } from './domain.js';
export function canonicalJson(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}
export const payloadHash = (payload: unknown) => createHash('sha256').update(canonicalJson(payload)).digest('hex');
export interface IngestResult { status: 'stored' | 'duplicate' | 'rejected' | 'presence'; reason: string | null; receipt: Payload | null }
export interface CommandInput {
  commandId: string; action: string; pumpId: 'B1' | 'B2' | null;
  durationSeconds?: number | null; supervisionConfirmed?: boolean; config?: Config;
  expectedAppliedVersion?: number;
}

export class PostgresDeviceStore {
  constructor(private readonly database: TransactionDatabase) {}
  private async device(db: Sql, deviceId: string) {
    const d = (await db.query('SELECT * FROM dispositivos WHERE identificador=$1 FOR UPDATE', [deviceId])).rows[0];
    if (!d || !d.mqtt_habilitado) throw new DomainRejection('Dispositivo não provisionado/habilitado para MQTT.');
    await db.query('INSERT INTO mqtt_sessoes(dispositivo_id) VALUES ($1) ON CONFLICT DO NOTHING', [d.id]);
    const s = (await db.query('SELECT * FROM mqtt_sessoes WHERE dispositivo_id=$1', [d.id])).rows[0];
    const now = iso((await db.query('SELECT clock_timestamp() AS now')).rows[0].now)!;
    return { d, s, now };
  }
  private live(s: Payload, now: string, p?: Payload) {
    return !!s.sincronizada_em && Number(s.boot_numero) === Number(s.maior_boot)
      && Date.parse(iso(s.ultimo_contato) ?? '') > Date.parse(now) - 45000
      && (!p || s.boot_id === p.bootId && s.conexao_id === p.connectionId && Number(s.boot_numero) === p.bootNumber);
  }
  private async identity(db: Sql, device: string, token: string) {
    if (!/^[0-9a-f]{64}$/.test(token)) throw new DomainRejection('Sessão de operador inválida.');
    const identity = (await db.query(`SELECT s.id AS session_id,u.id AS user_id FROM sessoes s
      JOIN usuarios u ON u.id=s.usuario_id JOIN dispositivo_usuarios du ON du.usuario_id=u.id
      WHERE s.token_hash=$1 AND s.revogado_em IS NULL AND s.expira_em>clock_timestamp()
      AND u.ativo AND du.ativo AND du.dispositivo_id=$2 FOR SHARE OF s,u,du`, [tokenHash(token),device])).rows[0];
    if (!identity) throw new DomainRejection('Operador sem sessão/vínculo ativo com a bancada.');
    return identity;
  }
  async enableDevice(deviceId: string, chipId: string) {
    if (!chipId.trim() || chipId.startsWith('simulator:')) throw new DomainRejection('Informe chip_id físico ou virtual explícito, diferente do simulador interno.');
    return this.database.transaction(async db => {
      const old = (await db.query('SELECT * FROM dispositivos WHERE identificador=$1 FOR UPDATE', [deviceId])).rows[0];
      if (!old) throw new DomainRejection('Cadastre a bancada e seu vínculo de operador antes de habilitar MQTT.');
      if (!old.chip_id.startsWith('simulator:') && old.chip_id !== chipId) throw new DomainRejection('A bancada já pertence a outro chip_id. Reprovisionamento exige procedimento próprio.');
      await db.query('UPDATE dispositivos SET chip_id=$2,mqtt_habilitado=true,online=false WHERE id=$1', [old.id,chipId]);
      await db.query('UPDATE mqtt_sessoes SET sincronizada_em=NULL,sync_id=NULL,sync_expira_em=NULL WHERE dispositivo_id=$1', [old.id]);
      return { deviceId, enabled: true };
    });
  }
  private async enqueue(db: Sql, device: string, channel: 'commands' | 'sync' | 'receipts', deviceId: string, payload: Payload, commandId: string | null = null) {
    await db.query(`INSERT INTO mqtt_saida(dispositivo_id,comando_id,canal,topico,payload,valido_ate)
      VALUES ($1,$2,$3,$4,$5,$6)`, [device,commandId,channel,mqttTopic(deviceId,channel),JSON.stringify(payload),payload.expiresAt ?? null]);
  }
  async createSyncRequest(deviceId: string) {
    return this.database.transaction(async db => {
      const { d,now } = await this.device(db,deviceId);
      const payload = { schemaVersion:1,type:'sync',deviceId,messageId:randomUUID(),syncId:randomUUID(),createdAt:now,expiresAt:new Date(Date.parse(now)+10000).toISOString() };
      await db.query('UPDATE mqtt_sessoes SET sync_id=$2,sync_expira_em=$3,sincronizada_em=NULL WHERE dispositivo_id=$1', [d.id,payload.syncId,payload.expiresAt]);
      await db.query('UPDATE dispositivos SET online=false WHERE id=$1', [d.id]);
      await db.query("UPDATE mqtt_saida SET cancelado_em=$2 WHERE dispositivo_id=$1 AND canal='sync' AND publicado_em IS NULL AND cancelado_em IS NULL", [d.id,now]);
      await this.enqueue(db,d.id,'sync',deviceId,payload);
      return payload;
    });
  }
  async ingest(topic: string, raw: string | Uint8Array, options: { authenticatedDeviceId: string; retained?: boolean }): Promise<IngestResult> {
    const validated = validateMqttPacket(topic,raw,options.retained ?? false);
    if (!validated.ok) throw new DomainRejection(validated.error);
    const { channel,deviceId,payload:p } = validated;
    if (deviceId !== options.authenticatedDeviceId) throw new DomainRejection('Identidade autenticada difere do tópico.');
    if (!['telemetry','state','events','acks','presence'].includes(channel)) throw new DomainRejection('Canal não é publicado pelo ESP.');
    return this.database.transaction(async db => {
      const { d,s,now } = await this.device(db,deviceId);
      if (channel === 'presence') {
        await db.query(`INSERT INTO eventos(dispositivo_id,mensagem_id,tipo,origem,descricao,detalhes)
          VALUES ($1,$2,'conexao','esp32',$3,$4) ON CONFLICT(dispositivo_id,mensagem_id) DO NOTHING`,
        [d.id,`presence:${p.connectionId}:${p.online}`,p.online ? 'Presença online recebida; exige sync.' : 'Presença offline recebida.',JSON.stringify(p)]);
        if (!p.online && s.conexao_id === p.connectionId && s.boot_id === p.bootId) {
          await db.query('UPDATE mqtt_sessoes SET sincronizada_em=NULL WHERE dispositivo_id=$1', [d.id]);
          await db.query('UPDATE dispositivos SET online=false WHERE id=$1', [d.id]);
        }
        return { status:'presence', reason:null, receipt:null };
      }
      const digest = payloadHash({ channel,payload:p });
      const previous = (await db.query('SELECT hash,resultado,motivo FROM mqtt_mensagens WHERE dispositivo_id=$1 AND mensagem_id=$2', [d.id,p.messageId])).rows[0];
      let status: 'stored' | 'duplicate' | 'rejected' = 'stored'; let reason: string | null = null;
      if (previous) {
        if (previous.hash !== digest) {
          status='rejected'; reason='messageId reutilizado com conteúdo/canal diferente.';
          await db.query(`INSERT INTO mqtt_conflitos(dispositivo_id,mensagem_id,hash,payload,motivo) VALUES ($1,$2,$3,$4,$5)
            ON CONFLICT(dispositivo_id,mensagem_id,hash) DO NOTHING`, [d.id,p.messageId,digest,JSON.stringify(p),reason]);
        } else { status=previous.resultado === 'processada' ? 'duplicate' : 'rejected'; reason=previous.motivo; }
      } else {
        await db.query(`INSERT INTO mqtt_mensagens(dispositivo_id,mensagem_id,canal,topico,payload,hash,boot_id,boot_numero,
          conexao_id,sequencia,ocorrido_em,recebido_em,resultado) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'processada')`,
        [d.id,p.messageId,channel,topic,JSON.stringify(p),digest,p.bootId,p.bootNumber,p.connectionId,p.sequence,p.occurredAt,now]);
        await db.query('SAVEPOINT domain_write');
        try {
          const knownBoots = (await db.query('SELECT numero,boot_id FROM mqtt_boots WHERE dispositivo_id=$1 AND (numero=$2 OR boot_id=$3)', [d.id,p.bootNumber,p.bootId])).rows;
          if (knownBoots.some(b => b.numero !== p.bootNumber || b.boot_id !== p.bootId)) throw new DomainRejection('bootNumber/bootId conflitante. Reprovisione explicitamente.');
          if (!knownBoots.length) await db.query('INSERT INTO mqtt_boots(dispositivo_id,numero,boot_id) VALUES ($1,$2,$3)', [d.id,p.bootNumber,p.bootId]);
          s.maior_boot=Math.max(Number(s.maior_boot),p.bootNumber);
          await db.query('UPDATE mqtt_sessoes SET maior_boot=$2 WHERE dispositivo_id=$1', [d.id,s.maior_boot]);
          const ctx: Context = { db,device:d.id,now,session:s,payload:p,live:this.live(s,now,p) };
          if (channel === 'telemetry') await persistTelemetry(ctx);
          if (channel === 'state') await persistState(ctx);
          if (channel === 'events') await persistEvent(ctx);
          if (channel === 'acks') await persistAck(ctx);
          await db.query('RELEASE SAVEPOINT domain_write');
        } catch (error) {
          if (!(error instanceof DomainRejection)) throw error; // Transient SQL/connection failures roll everything back; no receipt.
          await db.query('ROLLBACK TO SAVEPOINT domain_write');
          await db.query('RELEASE SAVEPOINT domain_write');
          status='rejected'; reason=error.message;
          await db.query("UPDATE mqtt_mensagens SET resultado='rejeitada',motivo=$3 WHERE dispositivo_id=$1 AND mensagem_id=$2", [d.id,p.messageId,reason]);
        }
      }
      const receipt = { schemaVersion:1,type:'receipt',deviceId,messageId:randomUUID(),sourceMessageId:p.messageId,
        sourceBootId:p.bootId,sourceBootNumber:p.bootNumber,status,reason,processedAt:now };
      await this.enqueue(db,d.id,'receipts',deviceId,receipt);
      return { status,reason,receipt }; // transaction() returns only after COMMIT succeeds.
    });
  }
  async createCommand(deviceId: string, token: string, input: CommandInput) {
    return this.database.transaction(async db => {
      const { d,s,now } = await this.device(db,deviceId);
      const identity = await this.identity(db,d.id,token);
      const duration = input.action === 'MANUAL_OFF' ? 3600 : input.action === 'TEST' ? 10 : ['AUTO','RESET_FAULT','APPLY_CONFIG'].includes(input.action) ? null : input.durationSeconds;
      const logical = { action:input.action,pumpId:input.pumpId,durationSeconds:duration,supervisionConfirmed:input.supervisionConfirmed ?? false,
        ...(input.action === 'APPLY_CONFIG' ? { config:input.config,timeZone:d.fuso_horario } : {}) };
      if (duration === undefined || input.action === 'APPLY_CONFIG' && !input.config) throw new DomainRejection('Pedido incompleto.');
      const hash = payloadHash(logical);
      const old = (await db.query('SELECT * FROM comandos WHERE dispositivo_id=$1 AND id_externo=$2', [d.id,input.commandId])).rows[0];
      if (old) {
        if (old.requisicao_hash !== hash || old.usuario_id !== identity.user_id) throw new DomainRejection('commandId reutilizado com outro conteúdo/autor.');
        return { command:old, payload:old.payload, duplicate:true };
      }
      if (!this.live(s,now)) throw new DomainRejection('Sessão do ESP sem sincronização recente.');
      if (Date.parse(iso(s.estado_recebido_em) ?? '') <= Date.parse(now)-45000 || !s.estado_recebido_em) throw new DomainRejection('Estado das bombas sem atualização recente.');
      if (!s.hora_confiavel) throw new DomainRejection('ESP sem hora confiável para validar o comando.');
      const applied = (await db.query('SELECT * FROM config_atual WHERE dispositivo_id=$1', [d.id])).rows[0];
      if (input.action==='APPLY_CONFIG') {
        if (input.expectedAppliedVersion!==undefined && input.expectedAppliedVersion!==Number(applied?.versao ?? 0)) throw new DomainRejection('A configuração foi alterada. Recarregue a versão aplicada.');
        const pending=(await db.query(`SELECT 1 FROM comandos WHERE dispositivo_id=$1 AND tipo='config' AND
          (status='aceito' OR status IN ('pendente','enviado') AND valido_ate>clock_timestamp())`,[d.id])).rows.length;
        if (pending) throw new DomainRejection('Existe configuração aguardando confirmação. Aguarde antes de enviar outra.');
      }
      if (input.action !== 'APPLY_CONFIG' && (!applied || Number(applied.versao) !== Number(s.config_versao))) throw new DomainRejection(applied ? 'Configuração aplicada ainda não reconciliada.' : 'Aplique a configuração em Controle antes de acionar as bombas.');
      if (['MANUAL_ON','TEST','IGNORE_FLOAT'].includes(input.action)) {
        if (!s.leitura_recebida_em || Date.parse(iso(s.leitura_recebida_em)!)<=Date.parse(now)-45000) throw new DomainRejection('Sensores sem atualização recente.');
        const reading=(await db.query('SELECT * FROM leituras WHERE dispositivo_id=$1 AND id=$2',[d.id,s.leitura_id])).rows[0];
        if (!reading || !reading.nivel_ok && input.action!=='IGNORE_FLOAT') throw new DomainRejection('Nível baixo ou leitura indisponível bloqueia acionamento.');
        const pumps=(await db.query('SELECT * FROM estado_atual WHERE dispositivo_id=$1',[d.id])).rows;
        const other=pumps.find(b=>b.atuador!==actuator(input.pumpId));
        if (other && (other.boia_ignorada_ate && Date.parse(iso(other.boia_ignorada_ate)!)>Date.parse(now) || input.action==='IGNORE_FLOAT' && other.ligado)) throw new DomainRejection('Exceção supervisionada exige exclusividade entre bombas.');
        if (input.pumpId==='B2') {
          const emergency=Number(reading.temp_ar)>=Number(applied.temp_emergencia);
          if (!reading.dht_confiavel || Number(reading.umid_ar)>=(emergency ? 95 : Number(applied.ur_trava_nevoa))) throw new DomainRejection('DHT22 ou umidade do ar bloqueia B2.');
        }
      }
      const version = input.action === 'APPLY_CONFIG' ? Number((await db.query('SELECT coalesce(max(versao),0)+1 AS version FROM config_historico WHERE dispositivo_id=$1', [d.id])).rows[0].version) : null;
      const payload = { schemaVersion:1,type:'command',deviceId,messageId:randomUUID(),commandId:input.commandId,createdAt:now,
        expiresAt:new Date(Date.parse(now)+10000).toISOString(),targetBootId:s.boot_id,targetBootNumber:s.boot_numero,targetConnectionId:s.conexao_id,
        ...logical,...(version ? { configVersion:version } : {}) };
      const validation=validateMqttPacket(mqttTopic(deviceId,'commands'),JSON.stringify(payload),false);
      if (!validation.ok) throw new DomainRejection(validation.error);
      if (input.action === 'IGNORE_FLOAT' && (await db.query(`SELECT 1 FROM comandos WHERE dispositivo_id=$1 AND tipo='ignorar_boia' AND status IN ('pendente','enviado','aceito')`, [d.id])).rows.length) throw new DomainRejection('Já existe teste supervisionado pendente/ativo.');
      const types: Payload = { MANUAL_ON:'manual_on',MANUAL_OFF:'manual_off',AUTO:'voltar_auto',RESET_FAULT:'reset_falha',TEST:'testar_bomba',IGNORE_FLOAT:'ignorar_boia',APPLY_CONFIG:'config' };
      const command = (await db.query(`INSERT INTO comandos(dispositivo_id,usuario_id,sessao_id,id_externo,tipo,atuador,duracao_s,
        supervisao_confirmada,payload,criado_em,valido_ate,requisicao_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [d.id,identity.user_id,identity.session_id,input.commandId,types[input.action],actuator(input.pumpId),duration,
        logical.supervisionConfirmed,JSON.stringify(payload),now,payload.expiresAt,hash])).rows[0];
      if (version) await this.insertConfig(db,d.id,identity.user_id,command.id,version,input.config!,now);
      await this.enqueue(db,d.id,'commands',deviceId,payload,command.id);
      return { command,payload,duplicate:false };
    });
  }
  private async insertConfig(db: Sql, device: string, user: string, command: string, version: number, c: Config, now: string) {
    const row: Payload = { dispositivo_id:device,versao:version,alterado_por:user,comando_id:command,criado_em:now,
      solo_min:c.soilMinPercent,solo_max:c.soilMaxPercent,irrig_max_s:c.irrigationMaxSeconds,cooldown_irrig_min:c.irrigationCooldownMinutes,
      irrig_max_ciclos_dia:c.irrigationMaxCyclesPerDay,janela_irrig_ativa:c.irrigationWindowEnabled,janela_inicio:c.irrigationWindowStart,janela_fim:c.irrigationWindowEnd,
      temp_nevoa_on:c.fogTemperatureOnC,histerese_nevoa:c.fogHysteresisC,ur_min_nevoa:c.fogHumidityMinPercent,ur_trava_nevoa:c.fogHumidityBlockPercent,
      pulso_nevoa_s:c.fogPulseSeconds,pausa_nevoa_min:c.fogPauseSeconds/60,temp_emergencia:c.emergencyTemperatureC,temp_raiz_alerta:c.rootAlertTemperatureC,
      bloquear_bombas_sem_agua:c.lowWaterBlocksPumps,manual_irrig_s:c.manualIrrigationSeconds,manual_nevoa_s:c.manualFogSeconds };
    const keys=Object.keys(row);
    const config=(await db.query(`INSERT INTO config_historico(${keys.join(',')}) VALUES (${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING id`,Object.values(row))).rows[0];
    for (const schedule of c.irrigationSchedule) await db.query(`INSERT INTO irrigacao_programada(configuracao_id,dispositivo_id,horario_local,duracao_s,habilitada) VALUES ($1,$2,$3,$4,$5)`, [config.id,device,schedule.time,schedule.durationSeconds,schedule.enabled]);
  }
  async acknowledgeAlert(deviceId: string, token: string, episodeId: string) {
    return this.database.transaction(async db => {
      const {d,now}=await this.device(db,deviceId); const identity=await this.identity(db,d.id,token);
      const row=(await db.query('SELECT * FROM alertas WHERE dispositivo_id=$1 AND id_externo=$2 AND resolvido_em IS NULL', [d.id,episodeId])).rows[0];
      if (!row) throw new DomainRejection('Alerta ativo não encontrado.');
      if (!row.reconhecido_em) await db.query('UPDATE alertas SET reconhecido_em=$2,reconhecido_por=$3 WHERE id=$1', [row.id,now,identity.user_id]);
      return (await db.query('SELECT * FROM alertas WHERE id=$1', [row.id])).rows[0];
    });
  }
  async invalidateSessions() {
    return this.database.transaction(async db => {
      await db.query('SELECT id FROM dispositivos WHERE mqtt_habilitado ORDER BY id FOR UPDATE');
      await db.query('UPDATE mqtt_sessoes SET sincronizada_em=NULL,sync_id=NULL,sync_expira_em=NULL');
      await db.query('UPDATE dispositivos SET online=false WHERE mqtt_habilitado');
      await db.query(`UPDATE comandos SET status='expirado',finalizado_em=clock_timestamp(),motivo_resultado='Backend reiniciado; pedido não será republicado.'
        WHERE status IN ('pendente','enviado') AND requisicao_hash IS NOT NULL AND dispositivo_id IN (SELECT id FROM dispositivos WHERE mqtt_habilitado)`);
      await db.query(`UPDATE mqtt_saida SET cancelado_em=clock_timestamp() WHERE canal IN ('commands','sync') AND publicado_em IS NULL AND cancelado_em IS NULL`);
    });
  }
  async sweepOffline() {
    return this.database.transaction(async db => {
      const devices=(await db.query(`SELECT d.id FROM dispositivos d JOIN mqtt_sessoes s ON s.dispositivo_id=d.id
        WHERE d.mqtt_habilitado AND (s.ultimo_contato IS NULL OR s.ultimo_contato<=clock_timestamp()-interval '45 seconds') ORDER BY d.id FOR UPDATE OF d`)).rows;
      for (const d of devices) {
        await db.query('UPDATE mqtt_sessoes SET sincronizada_em=NULL WHERE dispositivo_id=$1',[d.id]);
        await db.query('UPDATE dispositivos SET online=false WHERE id=$1',[d.id]);
        const active=(await db.query("SELECT 1 FROM alertas WHERE dispositivo_id=$1 AND codigo='OFFLINE' AND atuador IS NULL AND resolvido_em IS NULL",[d.id])).rows.length;
        if (!active) await db.query(`INSERT INTO alertas(dispositivo_id,mensagem_id,id_externo,codigo,severidade,mensagem,acao_sugerida,origem)
          SELECT $1,$2,$2,codigo,severidade,mensagem,acao_sugerida,'backend' FROM tipos_alerta WHERE codigo='OFFLINE'`,[d.id,`offline:${randomUUID()}`]);
      }
      return devices.length;
    });
  }
  async pendingPublications(limit=50) {
    if (!Number.isInteger(limit) || limit<1 || limit>100) throw new DomainRejection('Limite inválido.');
    return this.database.transaction(async db => {
      await db.query(`UPDATE comandos SET status='expirado',finalizado_em=clock_timestamp(),motivo_resultado='Prazo para aceite encerrado.'
        WHERE status IN ('pendente','enviado') AND requisicao_hash IS NOT NULL AND valido_ate<=clock_timestamp()`);
      await db.query(`UPDATE mqtt_saida SET cancelado_em=clock_timestamp() WHERE publicado_em IS NULL AND cancelado_em IS NULL
        AND (valido_ate<=clock_timestamp() OR comando_id IN (SELECT id FROM comandos WHERE status IN ('expirado','rejeitado','concluido')))`);
      return (await db.query(`SELECT o.* FROM mqtt_saida o JOIN dispositivos d ON d.id=o.dispositivo_id
        LEFT JOIN mqtt_sessoes s ON s.dispositivo_id=d.id WHERE o.publicado_em IS NULL AND o.cancelado_em IS NULL
        AND d.mqtt_habilitado AND (o.canal<>'commands' OR (s.sincronizada_em IS NOT NULL AND s.ultimo_contato>clock_timestamp()-interval '45 seconds'
          AND o.payload->>'targetBootId'=s.boot_id::text AND o.payload->>'targetConnectionId'=s.conexao_id::text AND s.boot_numero=s.maior_boot))
        ORDER BY o.criado_em,o.id LIMIT $1`, [limit])).rows;
    });
  }
  async markPublished(id: string) {
    return this.database.transaction(async db => {
      const row=(await db.query(`UPDATE mqtt_saida SET publicado_em=coalesce(publicado_em,clock_timestamp()) WHERE id=$1 AND cancelado_em IS NULL RETURNING comando_id`, [id])).rows[0];
      if (row?.comando_id) await db.query(`UPDATE comandos SET status='enviado',enviado_em=clock_timestamp() WHERE id=$1 AND status='pendente'`, [row.comando_id]);
    });
  }
  async readHistory(deviceId: string, limit=100) {
    if (!Number.isInteger(limit) || limit<1 || limit>500) throw new DomainRejection('Limite inválido.');
    return this.database.transaction(async db => {
      const {d}=await this.device(db,deviceId);
      const result: Record<string,Payload[]> = {};
      for (const table of ['leituras','eventos','alertas','acionamentos','config_historico','comandos']) {
        result[table]=(await db.query(`SELECT * FROM ${table} WHERE dispositivo_id=$1 ORDER BY id DESC LIMIT $2`, [d.id,limit])).rows;
      }
      return result;
    });
  }
}
