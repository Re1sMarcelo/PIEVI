import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { tokenHash } from '../src/auth/store.js';
import { migrate } from '../src/persistence/migrations.js';
import { PostgresDeviceStore, payloadHash } from '../src/persistence/store.js';
import type { Sql, TransactionDatabase } from '../src/persistence/database.js';
import { DEFAULT_CONFIG } from '../src/controlConfig.js';
import { MQTT_EXAMPLES } from '../src/mqtt/examples.js';
import { mqttTopic, validateMqttPacket } from '../src/mqtt/protocol.js';

let db: PGlite; let database: TransactionDatabase; let store: PostgresDeviceStore;
let device: string; let user: string;
const token='a'.repeat(64); const bootId='00000000-0000-4000-8000-000000000001'; const connectionId='00000000-0000-4000-8000-000000000002';
let sequence=0;
const query=<T extends Record<string,any> = Record<string,any>>(sql:string,values?:any[])=>db.query<T>(sql,values);
function sample(name: string, changes: Record<string, any> = {}) {
  const p=structuredClone(MQTT_EXAMPLES.find(e=>e.name===name)!.payload);
  p.bootId=bootId; p.bootNumber=1; p.connectionId=connectionId;
  p.sequence=++sequence; p.messageId=`${p.bootId}:${p.sequence}`;
  if (p.clockReliable) p.occurredAt=new Date().toISOString();
  return {...p,...changes};
}
const ingest = (p: Record<string,any>, channel: 'telemetry'|'state'|'events'|'acks'='state') => store.ingest(mqttTopic('bancada-01',channel),JSON.stringify(p),{authenticatedDeviceId:'bancada-01'});
async function sync() {
  const request=await store.createSyncRequest('bancada-01');
  const p=sample('state',{syncId:request.syncId,activeConfigVersion:0});
  assert.equal((await ingest(p)).status,'stored'); return p;
}
async function applied() {
  await sync();
  const request=await store.createCommand('bancada-01',token,{commandId:randomUUID(),action:'APPLY_CONFIG',pumpId:null,config:structuredClone(DEFAULT_CONFIG)});
  const ack=sample('ack-config',{commandId:request.payload.commandId,appliedConfigVersion:request.payload.configVersion});
  assert.equal((await ingest(ack,'acks')).status,'stored');
  await ingest(sample('state',{activeConfigVersion:request.payload.configVersion}));
  await ingest(sample('telemetry'),'telemetry');
  return request;
}
before(async()=>{
  db=new PGlite();
  for (const file of ['001_schema.sql','002_catalogo_alertas.sql']) await db.exec(await readFile(new URL(`../../db/${file}`,import.meta.url),'utf8'));
  await db.exec(`INSERT INTO dispositivos(identificador,nome,chip_id) VALUES ('legado','Legado','legado-chip');
    INSERT INTO acionamentos(dispositivo_id,mensagem_id,id_externo,atuador,inicio,fim,origem)
    SELECT id,'legacy-message','legacy-cycle','irrigacao','2026-01-01T12:00:00Z','2026-01-01T12:00:12Z','auto' FROM dispositivos;
    INSERT INTO alertas(dispositivo_id,mensagem_id,id_externo,codigo,severidade,mensagem,acao_sugerida,aberto_em)
    SELECT id,'legacy-alert-message','legacy-alert','UR_ALTA','aviso','Alerta legado','Ventilar','2026-01-01T12:00:00Z' FROM dispositivos;`);
  database={ transaction: work=>db.transaction(async tx=>work({ query: async <T extends Record<string,any>>(sql: string, values?: any[])=>{
    if (values) return tx.query<T>(sql,values);
    const result=await tx.exec(sql); return { rows:(result.at(-1)?.rows ?? []) as T[] };
  } } as Sql)) };
  assert.equal((await migrate(database,false))[0].status,'pendente');
  assert.equal((await migrate(database,true))[0].status,'aplicada');
  assert.equal(Number((await query('SELECT duracao_s FROM acionamentos')).rows[0].duracao_s),12);
  assert.equal((await query('SELECT concluido FROM acionamentos')).rows[0].concluido,true);
  assert.deepEqual((await query('SELECT aberto_em,aberto_no_esp_em FROM alertas')).rows[0].aberto_em,(await query('SELECT aberto_no_esp_em FROM alertas')).rows[0].aberto_no_esp_em);
  assert.equal((await query('SELECT mqtt_habilitado FROM dispositivos')).rows[0].mqtt_habilitado,false);
  store=new PostgresDeviceStore(database);
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec('TRUNCATE usuarios,dispositivos CASCADE');
  user=(await query<{id:string}>(`INSERT INTO usuarios(usuario,nome,senha_hash) VALUES ('operador','Operador',$1) RETURNING id`,['a'.repeat(32)+':'+ 'b'.repeat(128)])).rows[0].id;
  device=(await query<{id:string}>(`INSERT INTO dispositivos(identificador,nome,chip_id,mqtt_habilitado) VALUES ('bancada-01','Bancada','virtual:bancada-01',true) RETURNING id`)).rows[0].id;
  await query('INSERT INTO dispositivo_usuarios(dispositivo_id,usuario_id) VALUES ($1,$2)',[device,user]);
  await query('INSERT INTO sessoes(usuario_id,token_hash) VALUES ($1,$2)',[user,tokenHash(token)]);
  sequence=0;
});
test('migração reaplicada é no-op e preserva dados legados',async()=>{
  assert.equal((await migrate(database,true))[0].status,'ja_aplicada');
  assert.equal((await query('SELECT * FROM usuarios')).rows.length,1);
});
test('telemetria, calibração pendente e reentrega canônica não duplicam registros',async()=>{
  const p=sample('telemetry');
  assert.equal((await ingest(p,'telemetry')).status,'stored');
  const reversed=Object.fromEntries(Object.entries(p).reverse());
  assert.equal(payloadHash(p),payloadHash(reversed));
  assert.equal((await ingest(reversed,'telemetry')).status,'duplicate');
  let readings=(await query('SELECT * FROM leituras')).rows;
  assert.equal(readings.length,1); assert.equal(readings[0].calibracao_id,null);
  await ingest(sample('calibration'),'events');
  readings=(await query('SELECT * FROM leituras')).rows;
  assert.ok(readings[0].calibracao_id);
  assert.equal((await ingest({...p,airTemperatureC:29},'telemetry')).status,'rejected');
  assert.equal((await query('SELECT * FROM mqtt_conflitos')).rows.length,1);
  assert.equal((await query('SELECT * FROM leituras')).rows[0].temp_ar,'28.4');
});
test('só o desafio correto assume estado e replay não renova presença',async()=>{
  const request=await store.createSyncRequest('bancada-01');
  const old=sample('state-manual');
  await ingest(old);
  assert.equal((await query('SELECT * FROM estado_atual')).rows.length,0);
  const live=sample('state',{syncId:request.syncId}); await ingest(live);
  const time=(await query('SELECT ultimo_contato FROM dispositivos')).rows[0].ultimo_contato;
  await ingest(old);
  assert.equal((await query('SELECT ligado FROM estado_atual WHERE atuador=\'irrigacao\'')).rows[0].ligado,false);
  assert.deepEqual((await query('SELECT ultimo_contato FROM dispositivos')).rows[0].ultimo_contato,time);
});
test('fim de ciclo antes do início e sem UTC preserva duração monotônica e não inventa início',async()=>{
  const finished=sample('cycle-unsynchronized'); await ingest(finished,'events');
  const started=sample('cycle-started',{cycleId:finished.cycleId,source:'auto',commandId:null,startedAt:null});
  await ingest(started,'events');
  const cycle=(await query('SELECT * FROM acionamentos')).rows[0];
  assert.equal(cycle.inicio,null); assert.equal(cycle.fim,null); assert.equal(cycle.duracao_s,null);
  assert.equal(Number(cycle.duracao_monotonica_s),100); assert.equal(cycle.concluido,true);
});
test('configuração só é aplicada na confirmação; comando e ACK não fabricam saída ligada',async()=>{
  const cfg=await applied();
  assert.equal(cfg.command.status,'pendente');
  assert.equal((await query('SELECT versao FROM config_atual')).rows[0].versao,1);
  assert.equal((await query('SELECT pausa_nevoa_min FROM config_historico')).rows[0].pausa_nevoa_min,5);
  const command=await store.createCommand('bancada-01',token,{commandId:randomUUID(),action:'MANUAL_ON',pumpId:'B1',durationSeconds:30});
  const ack=sample('ack-accepted',{commandId:command.payload.commandId}); await ingest(ack,'acks');
  assert.equal((await query('SELECT ligado FROM estado_atual WHERE atuador=\'irrigacao\'')).rows[0].ligado,false);
  assert.equal((await query('SELECT status FROM comandos WHERE id=$1',[command.command.id])).rows[0].status,'aceito');
  const replay=await store.createCommand('bancada-01',token,{commandId:command.payload.commandId,action:'MANUAL_ON',pumpId:'B1',durationSeconds:30});
  assert.equal(replay.duplicate,true);
  await assert.rejects(()=>store.createCommand('bancada-01',token,{commandId:command.payload.commandId,action:'MANUAL_ON',pumpId:'B1',durationSeconds:31}));
});
test('recibos válidos estão na outbox somente após transação e rejeição de domínio não deixa efeito parcial',async()=>{
  const p=sample('ack-accepted',{commandId:'unknown-command'});
  const result=await ingest(p,'acks'); assert.equal(result.status,'rejected');
  assert.equal(validateMqttPacket(mqttTopic('bancada-01','receipts'),JSON.stringify(result.receipt),false).ok,true);
  assert.equal((await query('SELECT * FROM comando_confirmacoes')).rows.length,0);
  assert.equal((await query('SELECT resultado FROM mqtt_mensagens')).rows[0].resultado,'rejeitada');
  assert.equal((await query('SELECT * FROM mqtt_saida')).rows.length,1);
});
test('checksum divergente impede migração silenciosa',async()=>{
  const checksum=(await query('SELECT checksum FROM schema_migrations')).rows[0].checksum;
  await query("UPDATE schema_migrations SET checksum=$1",['0'.repeat(64)]);
  try { await assert.rejects(()=>migrate(database,true),/Checksum divergente/); }
  finally { await query('UPDATE schema_migrations SET checksum=$1',[checksum]); }
});
test('falha SQL depois da inbox reverte tudo e permite reentrega com o mesmo ID',async()=>{
  await db.exec(`CREATE FUNCTION fail_reading_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure' USING ERRCODE='40001'; END $$;
    CREATE TRIGGER fail_reading BEFORE INSERT ON leituras FOR EACH ROW EXECUTE FUNCTION fail_reading_test();`);
  const p=sample('telemetry');
  try {
    await assert.rejects(()=>ingest(p,'telemetry'));
    for (const table of ['mqtt_mensagens','mqtt_saida','leituras','mqtt_boots']) assert.equal((await query(`SELECT * FROM ${table}`)).rows.length,0,table);
  } finally { await db.exec('DROP TRIGGER fail_reading ON leituras; DROP FUNCTION fail_reading_test();'); }
  assert.equal((await ingest(p,'telemetry')).status,'stored');
});
test('ingestões concorrentes da mesma mensagem possuem um único efeito',async()=>{
  const p=sample('telemetry'); const results=await Promise.all([ingest(p,'telemetry'),ingest(p,'telemetry')]);
  assert.deepEqual(new Set(results.map(r=>r.status)),new Set(['stored','duplicate']));
  assert.equal((await query('SELECT * FROM leituras')).rows.length,1);
});
test('identidade errada, JSON inválido e bancada desabilitada não geram recibo nem escrita',async()=>{
  const p=sample('telemetry');
  await assert.rejects(()=>store.ingest(mqttTopic('bancada-01','telemetry'),JSON.stringify(p),{authenticatedDeviceId:'outra'}));
  await assert.rejects(()=>store.ingest(mqttTopic('bancada-01','telemetry'),'{}',{authenticatedDeviceId:'bancada-01'}));
  await query('UPDATE dispositivos SET mqtt_habilitado=false');
  await assert.rejects(()=>ingest(p,'telemetry'));
  assert.equal((await query('SELECT * FROM mqtt_mensagens')).rows.length,0);
});
test('leitura sem hora confiável mantém ts NULL e flags de qualidade',async()=>{
  await ingest(sample('telemetry-unavailable'),'telemetry');
  const row=(await query('SELECT * FROM leituras')).rows[0];
  assert.equal(row.ts,null); assert.equal(row.hora_confiavel,false); assert.equal(row.umid_solo,null); assert.ok(row.recebido_em);
});
test('novo boot invalida lease anterior e contador regressivo não assume a conexão atual',async()=>{
  await applied();
  const newer=sample('telemetry',{bootId:randomUUID(),bootNumber:2}); newer.messageId=`${newer.bootId}:${newer.sequence}`;
  await ingest(newer,'telemetry');
  await assert.rejects(()=>store.createCommand('bancada-01',token,{commandId:randomUUID(),action:'TEST',pumpId:'B1'}),/Sessão/);
  const request=await store.createSyncRequest('bancada-01');
  assert.equal((await ingest(sample('state',{syncId:request.syncId}))).status,'rejected');
  const next=sample('state',{syncId:request.syncId,bootId:newer.bootId,bootNumber:2,connectionId:randomUUID()}); next.messageId=`${next.bootId}:${next.sequence}`;
  assert.equal((await ingest(next)).status,'stored');
  assert.equal((await query('SELECT boot_numero FROM mqtt_sessoes')).rows[0].boot_numero,2);
});
test('alerta reconhecido continua ativo; snapshot resolve e abertura tardia não reabre',async()=>{
  await sync(); const delayed=sample('alert-opened'); const opened=sample('alert-opened');
  await ingest(opened,'events');
  const acknowledged=await store.acknowledgeAlert('bancada-01',token,opened.episodeId);
  assert.ok(acknowledged.reconhecido_em); assert.equal(acknowledged.resolvido_em,null);
  await ingest(sample('state'));
  await ingest(delayed,'events');
  const row=(await query('SELECT * FROM alertas WHERE id_externo=$1',[opened.episodeId])).rows[0];
  assert.ok(row.resolvido_em); assert.equal(row.reconhecido_por,user); assert.equal(row.resolvido_no_esp_em,null);
  await assert.rejects(()=>store.acknowledgeAlert('bancada-01',token,opened.episodeId));
});
test('abertura histórica omitida por snapshot recente entra como encerrada',async()=>{
  await sync(); const delayed=sample('alert-opened'); await ingest(sample('state'));
  await ingest(delayed,'events');
  assert.ok((await query('SELECT resolvido_em FROM alertas')).rows[0].resolvido_em);
});
test('conclusão antes de aceite e aceite tardio não regridem comando terminal',async()=>{
  await applied();
  const command=await store.createCommand('bancada-01',token,{commandId:randomUUID(),action:'AUTO',pumpId:'B1'});
  await ingest(sample('ack-completed',{commandId:command.payload.commandId}),'acks');
  await ingest(sample('ack-accepted',{commandId:command.payload.commandId}),'acks');
  assert.equal((await query('SELECT status FROM comandos WHERE id=$1',[command.command.id])).rows[0].status,'concluido');
  assert.equal((await query('SELECT * FROM comando_confirmacoes WHERE comando_id=$1',[command.command.id])).rows.length,2);
});
test('ACK de versão errada é auditado e não aprova configuração; estado desconhecido não cria versão',async()=>{
  await sync();
  const cfg=await store.createCommand('bancada-01',token,{commandId:randomUUID(),action:'APPLY_CONFIG',pumpId:null,config:structuredClone(DEFAULT_CONFIG)});
  assert.equal((await ingest(sample('ack-config',{commandId:cfg.payload.commandId,appliedConfigVersion:2}),'acks')).status,'rejected');
  assert.equal((await query('SELECT * FROM config_atual')).rows.length,0);
  await ingest(sample('state',{activeConfigVersion:99}));
  assert.equal((await query('SELECT * FROM config_atual')).rows.length,0);
  await ingest(sample('state',{activeConfigVersion:1}));
  assert.equal((await query('SELECT versao FROM config_atual')).rows[0].versao,1);
});
test('rejeição da configuração preserva versão anterior e motivo',async()=>{
  await applied();
  const cfg=await store.createCommand('bancada-01',token,{commandId:randomUUID(),action:'APPLY_CONFIG',pumpId:null,config:{...DEFAULT_CONFIG,rootAlertTemperatureC:27}});
  await ingest(sample('ack-rejected',{commandId:cfg.payload.commandId}),'acks');
  assert.equal((await query('SELECT versao FROM config_atual')).rows[0].versao,1);
  const row=(await query('SELECT * FROM config_historico WHERE versao=2')).rows[0];
  assert.ok(row.rejeitada_em); assert.ok(row.motivo_rejeicao);
});
test('presença retida não assume estado e Will de conexão antiga não derruba a nova',async()=>{
  const presence=structuredClone(MQTT_EXAMPLES.find(e=>e.name==='presence-online')!.payload);
  await store.ingest(mqttTopic('bancada-01','presence'),JSON.stringify(presence),{authenticatedDeviceId:'bancada-01',retained:true});
  assert.equal((await query('SELECT online FROM dispositivos')).rows[0].online,false);
  await sync();
  await store.ingest(mqttTopic('bancada-01','presence'),JSON.stringify({...presence,online:false,connectionId:randomUUID()}),{authenticatedDeviceId:'bancada-01',retained:true});
  assert.equal((await query('SELECT online FROM dispositivos')).rows[0].online,true);
});
test('offline exige novo desafio e alerta backend não é resolvido por evento local',async()=>{
  await sync();
  await query("UPDATE mqtt_sessoes SET ultimo_contato=clock_timestamp()-interval '46 seconds'");
  await store.sweepOffline();
  assert.equal((await query("SELECT * FROM alertas WHERE codigo='OFFLINE' AND resolvido_em IS NULL")).rows.length,1);
  await ingest(sample('state'));
  assert.equal((await query('SELECT online FROM dispositivos')).rows[0].online,false);
  await sync();
  assert.equal((await query("SELECT * FROM alertas WHERE codigo='OFFLINE' AND resolvido_em IS NULL")).rows.length,0);
});
test('reinício invalida pedidos ainda não aceitos e não republica atuação',async()=>{
  await applied();
  const command=await store.createCommand('bancada-01',token,{commandId:randomUUID(),action:'TEST',pumpId:'B1'});
  await store.invalidateSessions();
  assert.equal((await query('SELECT status FROM comandos WHERE id=$1',[command.command.id])).rows[0].status,'expirado');
  assert.ok(!(await store.pendingPublications()).some(row=>row.canal==='commands'));
});
test('sessão revogada bloqueia autoria e hora inválida bloqueia novos comandos',async()=>{
  await applied();
  await ingest(sample('state',{clockReliable:false,occurredAt:null,activeConfigVersion:1}));
  await assert.rejects(()=>store.createCommand('bancada-01',token,{commandId:randomUUID(),action:'TEST',pumpId:'B1'}),/hora confiável/);
  await query("UPDATE sessoes SET revogado_em=clock_timestamp(),motivo_revogacao='teste'");
  await assert.rejects(()=>store.acknowledgeAlert('bancada-01',token,randomUUID()),/vínculo/);
});
test('estado anterior ao aceite não conclui manual; AUTO novo reconcilia ACK final perdido e libera exceção',async()=>{
  await applied();
  const command=await store.createCommand('bancada-01',token,{commandId:randomUUID(),action:'IGNORE_FLOAT',pumpId:'B1',durationSeconds:10,supervisionConfirmed:true});
  const older=sample('state');
  await ingest(sample('ack-accepted',{commandId:command.payload.commandId}),'acks');
  await ingest(older);
  assert.equal((await query('SELECT status FROM comandos WHERE id=$1',[command.command.id])).rows[0].status,'aceito');
  await ingest(sample('state'));
  assert.equal((await query('SELECT status FROM comandos WHERE id=$1',[command.command.id])).rows[0].status,'concluido');
  await store.createCommand('bancada-01',token,{commandId:randomUUID(),action:'IGNORE_FLOAT',pumpId:'B1',durationSeconds:10,supervisionConfirmed:true});
});
test('ciclo concluído reconcilia comando aceito sem modificar saída atual',async()=>{
  await applied();
  const command=await store.createCommand('bancada-01',token,{commandId:randomUUID(),action:'MANUAL_ON',pumpId:'B1',durationSeconds:120});
  await ingest(sample('ack-accepted',{commandId:command.payload.commandId}),'acks');
  await ingest(sample('cycle-finished',{commandId:command.payload.commandId}),'events');
  assert.equal((await query('SELECT status FROM comandos WHERE id=$1',[command.command.id])).rows[0].status,'concluido');
  assert.equal((await query('SELECT ligado FROM estado_atual WHERE atuador=\'irrigacao\'')).rows[0].ligado,false);
});
test('expiração e publicação não fabricam conclusão; ACK aceito pode concluir depois da validade inicial',async()=>{
  await applied();
  const pending=await store.createCommand('bancada-01',token,{commandId:randomUUID(),action:'TEST',pumpId:'B2'});
  const packet=(await store.pendingPublications()).find(row=>row.comando_id===pending.command.id)!;
  await store.markPublished(packet.id);
  assert.equal((await query('SELECT status FROM comandos WHERE id=$1',[pending.command.id])).rows[0].status,'enviado');
  await ingest(sample('ack-accepted',{commandId:pending.payload.commandId}),'acks');
  await query("UPDATE comandos SET criado_em=criado_em-interval '1 minute',valido_ate=valido_ate-interval '1 minute' WHERE id=$1",[pending.command.id]);
  await store.pendingPublications();
  assert.equal((await query('SELECT status FROM comandos WHERE id=$1',[pending.command.id])).rows[0].status,'aceito');
  await ingest(sample('ack-completed',{commandId:pending.payload.commandId}),'acks');
  assert.equal((await query('SELECT status FROM comandos WHERE id=$1',[pending.command.id])).rows[0].status,'concluido');
  const expired=await store.createCommand('bancada-01',token,{commandId:randomUUID(),action:'TEST',pumpId:'B1'});
  await query("UPDATE comandos SET criado_em=criado_em-interval '1 minute',valido_ate=valido_ate-interval '1 minute' WHERE id=$1",[expired.command.id]);
  await store.pendingPublications();
  await ingest(sample('ack-accepted',{commandId:expired.payload.commandId}),'acks');
  assert.equal((await query('SELECT status FROM comandos WHERE id=$1',[expired.command.id])).rows[0].status,'expirado');
});
test('telemetria não faz estado antigo parecer recente e nível baixo impede ligar',async()=>{
  await applied();
  await query("UPDATE mqtt_sessoes SET estado_recebido_em=clock_timestamp()-interval '46 seconds'");
  await ingest(sample('telemetry'),'telemetry');
  await assert.rejects(()=>store.createCommand('bancada-01',token,{commandId:randomUUID(),action:'TEST',pumpId:'B1'}),/Estado das bombas/);
  await ingest(sample('state'));
  await ingest(sample('telemetry',{waterLevel:'LOW'}),'telemetry');
  await assert.rejects(()=>store.createCommand('bancada-01',token,{commandId:randomUUID(),action:'MANUAL_ON',pumpId:'B1',durationSeconds:10}),/Nível baixo/);
  await store.createCommand('bancada-01',token,{commandId:randomUUID(),action:'IGNORE_FLOAT',pumpId:'B1',durationSeconds:10,supervisionConfirmed:true});
});
test('emergência não permite B2 em UR95 e ignorar boia não ignora DHT',async()=>{
  await applied();
  await ingest(sample('telemetry',{waterLevel:'LOW',airTemperatureC:36,airHumidityPercent:95}),'telemetry');
  await assert.rejects(()=>store.createCommand('bancada-01',token,{commandId:randomUUID(),action:'IGNORE_FLOAT',pumpId:'B2',durationSeconds:10,supervisionConfirmed:true}),/DHT22/);
});
