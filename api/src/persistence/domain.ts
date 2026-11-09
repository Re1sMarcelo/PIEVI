import type { Sql } from './database.js';

export type Payload = Record<string, any>;
export class DomainRejection extends Error {}
export const actuator = (id: string | null) => id === null ? null : id === 'B1' ? 'irrigacao' : 'nevoa';
export const severity = (value: string) => value === 'critical' ? 'critico' : value === 'warning' ? 'aviso' : 'info';
export const iso = (value: any): string | null => value == null ? null : new Date(value).toISOString();
export interface Context {
  db: Sql; device: string; now: string; session: Payload; payload: Payload; live: boolean;
}
export async function event(ctx: Context, kind: string, description: string, details: Payload = ctx.payload) {
  await ctx.db.query(`INSERT INTO eventos(dispositivo_id,mensagem_id,tipo,origem,descricao,detalhes,ocorrido_em,recebido_em)
    VALUES ($1,$2,$3,'esp32',$4,$5,$6,$7) ON CONFLICT(dispositivo_id,mensagem_id) DO NOTHING`,
  [ctx.device, ctx.payload.messageId, kind, description, JSON.stringify(details), ctx.payload.occurredAt, ctx.now]);
}
export async function renew(ctx: Context) {
  await ctx.db.query('UPDATE mqtt_sessoes SET ultimo_contato=$2 WHERE dispositivo_id=$1', [ctx.device, ctx.now]);
  await ctx.db.query('UPDATE dispositivos SET online=true,ultimo_contato=$2 WHERE id=$1', [ctx.device, ctx.now]);
  ctx.session.ultimo_contato = ctx.now;
}
export async function applyKnownConfig(ctx: Context, version: number) {
  if (!version) return;
  await ctx.db.query(`UPDATE config_historico h SET aplicada_no_esp=true,aplicada_em=$3 FROM comandos c
    WHERE h.dispositivo_id=$1 AND h.versao=$2 AND NOT h.aplicada_no_esp AND h.rejeitada_em IS NULL AND h.criado_em <= $3
    AND c.id=h.comando_id AND c.dispositivo_id=h.dispositivo_id AND c.tipo='config' AND c.status<>'rejeitado'
    AND c.payload->>'action'='APPLY_CONFIG' AND c.payload->'configVersion'=to_jsonb(h.versao)`, [ctx.device, version, ctx.now]);
}
export async function persistTelemetry(ctx: Context) {
  const { db, device, payload: p, session: s } = ctx;
  const inserted = await db.query(`INSERT INTO leituras(dispositivo_id,mensagem_id,ts,hora_confiavel,temp_ar,umid_ar,temp_raiz,
    umid_solo,umid_solo_adc,nivel_ok,dht_confiavel,raiz_confiavel,solo_confiavel,recebido_em,calibracao_externa,calibracao_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
      (SELECT id FROM calibracoes WHERE dispositivo_id=$1 AND id_externo=$15)) RETURNING id`,
  [device,p.messageId,p.occurredAt,p.clockReliable,p.airTemperatureC,p.airHumidityPercent,p.substrateTemperatureC,p.soilMoisturePercent,
    p.soilMoistureAdc,p.waterLevel === 'OK',p.dhtReliable,p.rootReliable,p.soilReliable,ctx.now,p.activeCalibrationId]);
  if (ctx.live && p.sequence > Number(s.leitura_seq)) {
    await db.query('UPDATE mqtt_sessoes SET leitura_seq=$2,leitura_id=$3,leitura_recebida_em=$4 WHERE dispositivo_id=$1', [device,p.sequence,inserted.rows[0].id,ctx.now]);
    await renew(ctx);
  }
}
async function upsertAlert(ctx: Context, a: Payload, resolved: boolean, historical: boolean) {
  const { db, device, payload: p } = ctx;
  const existing = (await db.query('SELECT * FROM alertas WHERE dispositivo_id=$1 AND id_externo=$2', [device,a.episodeId])).rows[0];
  const pump = actuator(a.pumpId);
  if (existing && (existing.codigo !== a.code || existing.atuador !== pump)) throw new DomainRejection('episodeId reutilizado para outro código/atuador.');
  if (existing) {
    const newer = Number(existing.esp_boot_numero ?? 0) < p.bootNumber || Number(existing.esp_boot_numero) === p.bootNumber && Number(existing.esp_sequencia ?? 0) < p.sequence;
    // A terminal episode never reopens, including after restart or late opening.
    if (newer || existing.aberto_no_esp_em === null) {
      await db.query(`UPDATE alertas SET aberto_no_esp_em=coalesce(aberto_no_esp_em,$3),
        resolvido_no_esp_em=coalesce(resolvido_no_esp_em,$4),
        resolvido_em=CASE WHEN resolvido_em IS NULL AND $5 THEN $6 ELSE resolvido_em END,
        severidade=CASE WHEN $7 THEN $8 ELSE severidade END,
        detalhe=CASE WHEN $7 THEN $9 ELSE detalhe END,
        esp_boot_numero=CASE WHEN $7 THEN $10 ELSE esp_boot_numero END,
        esp_boot_id=CASE WHEN $7 THEN $11 ELSE esp_boot_id END,
        esp_sequencia=CASE WHEN $7 THEN $12 ELSE esp_sequencia END
        WHERE dispositivo_id=$1 AND id_externo=$2`,
      [device,a.episodeId,a.startedAt,a.endedAt ?? null,resolved && newer && !historical,ctx.now,newer && !historical,severity(a.severity),
        JSON.stringify({ text: a.detail, historical }),p.bootNumber,p.bootId,p.sequence]);
    }
    return;
  }
  // The active unique slot is reconciled only by a newer, live observation.
  const occupant = (await db.query(`SELECT id FROM alertas WHERE dispositivo_id=$1 AND codigo=$2
    AND atuador IS NOT DISTINCT FROM $3 AND resolvido_em IS NULL`, [device,a.code,pump])).rows[0];
  let closed = resolved || historical;
  if (occupant && !closed) {
    await db.query(`UPDATE alertas SET resolvido_em=$2,detalhe=detalhe || '{"resolution":"replaced_episode"}'::jsonb
      WHERE id=$1 AND origem='esp32'`, [occupant.id,ctx.now]);
    const stillOccupied = (await db.query('SELECT 1 FROM alertas WHERE id=$1 AND resolvido_em IS NULL', [occupant.id])).rows.length;
    if (stillOccupied) closed = true; // Preserve legacy/backend episode; do not corrupt its acknowledgement.
  }
  const catalogue = (await db.query('SELECT * FROM tipos_alerta WHERE codigo=$1', [a.code])).rows[0];
  if (!catalogue) throw new DomainRejection('Código de alerta não cadastrado.');
  await db.query(`INSERT INTO alertas(dispositivo_id,mensagem_id,id_externo,codigo,atuador,severidade,mensagem,acao_sugerida,
    detalhe,aberto_em,resolvido_em,aberto_no_esp_em,resolvido_no_esp_em,origem,esp_boot_numero,esp_boot_id,esp_sequencia)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'esp32',$14,$15,$16)`,
  [device,`${p.messageId}:alert:${a.episodeId}`,a.episodeId,a.code,pump,severity(a.severity),catalogue.mensagem,catalogue.acao_sugerida,
    JSON.stringify({ text: a.detail, historical }),ctx.now,closed ? ctx.now : null,a.startedAt,a.endedAt ?? null,p.bootNumber,p.bootId,p.sequence]);
}
export async function persistState(ctx: Context) {
  const { db, device, session: s, payload: p } = ctx;
  const challenge = p.syncId && p.syncId === s.sync_id && new Date(s.sync_expira_em).getTime() > Date.parse(ctx.now);
  if (challenge) {
    if (p.bootNumber < Number(s.maior_boot)) throw new DomainRejection('Boot anterior ao checkpoint persistido.');
    const sameConnection = s.boot_id === p.bootId && s.conexao_id === p.connectionId;
    if (sameConnection && p.sequence <= Number(s.estado_seq)) throw new DomainRejection('Resposta sync não é um estado novo.');
    await db.query(`UPDATE mqtt_sessoes SET boot_numero=$2,boot_id=$3,conexao_id=$4,sincronizada_em=$5,
      sync_id=NULL,sync_expira_em=NULL,estado_seq=CASE WHEN $6 THEN estado_seq ELSE 0 END,
      leitura_seq=CASE WHEN $6 THEN leitura_seq ELSE 0 END,leitura_id=CASE WHEN $6 THEN leitura_id ELSE NULL END,
      leitura_recebida_em=CASE WHEN $6 THEN leitura_recebida_em ELSE NULL END,
      alerta_seq=CASE WHEN $6 THEN alerta_seq ELSE 0 END WHERE dispositivo_id=$1`,
    [device,p.bootNumber,p.bootId,p.connectionId,ctx.now,sameConnection]);
    if (!sameConnection) { s.estado_seq=0; s.leitura_seq=0; s.alerta_seq=0; }
    s.boot_id=p.bootId; s.boot_numero=p.bootNumber; s.conexao_id=p.connectionId;
    ctx.live = true;
    await db.query(`UPDATE alertas SET resolvido_em=$2 WHERE dispositivo_id=$1 AND codigo='OFFLINE' AND origem='backend' AND resolvido_em IS NULL`, [device,ctx.now]);
  }
  if (!ctx.live || p.sequence <= Number(s.estado_seq)) {
    await event(ctx,'mudanca_modo','Estado histórico recebido; não substituiu o estado atual.'); return;
  }
  const before = (await db.query('SELECT atuador,modo,ligado FROM estado_atual WHERE dispositivo_id=$1', [device])).rows;
  for (const id of ['B1','B2']) {
    const b = p.pumps[id];
    await db.query(`INSERT INTO estado_atual(dispositivo_id,atuador,estado_fsm,modo,ligado,modo_iniciado_em,expira_em,mensagem_id,
      atualizado_em,recebido_em,hora_confiavel,restante_s,bloqueio,falha,boia_ignorada_ate,feedback)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT(dispositivo_id,atuador) DO UPDATE SET estado_fsm=excluded.estado_fsm,modo=excluded.modo,ligado=excluded.ligado,
      modo_iniciado_em=excluded.modo_iniciado_em,expira_em=excluded.expira_em,mensagem_id=excluded.mensagem_id,
      atualizado_em=excluded.atualizado_em,recebido_em=excluded.recebido_em,hora_confiavel=excluded.hora_confiavel,
      restante_s=excluded.restante_s,bloqueio=excluded.bloqueio,falha=excluded.falha,boia_ignorada_ate=excluded.boia_ignorada_ate,feedback=excluded.feedback`,
    [device,actuator(id),b.fsmState,b.mode,b.isOn,b.modeStartedAt,b.expiresAt,p.messageId,p.occurredAt,ctx.now,p.clockReliable,
      b.remainingSeconds,b.blockedReason,b.faultCode,b.floatOverrideUntil,b.feedback]);
  }
  const changedPumps=['B1','B2'].filter(id=>{ const old=before.find(row=>row.atuador===actuator(id)); return !old || old.modo!==p.pumps[id].mode || old.ligado!==p.pumps[id].isOn; });
  if (changedPumps.length) {
    await event(ctx,'mudanca_modo','Estado observado de B1/B2 atualizado pelo ESP.',{...p,changedPumps});
  }
  if (p.sequence > Number(s.alerta_seq)) {
    const ids = p.activeAlerts.map((a: Payload) => a.episodeId);
    await db.query(`UPDATE alertas SET resolvido_em=$2,detalhe=detalhe || '{"resolution":"state_snapshot"}'::jsonb
      WHERE dispositivo_id=$1 AND origem='esp32' AND resolvido_em IS NULL AND NOT (id_externo=ANY($3::text[]))`, [device,ctx.now,ids]);
    for (const alert of p.activeAlerts) await upsertAlert(ctx,alert,false,false);
    await db.query('UPDATE mqtt_sessoes SET alerta_seq=$2 WHERE dispositivo_id=$1', [device,p.sequence]);
  }
  await applyKnownConfig(ctx,p.activeConfigVersion);
  await db.query('UPDATE mqtt_sessoes SET estado_seq=$2,config_versao=$3,hora_confiavel=$4,estado_recebido_em=$5 WHERE dispositivo_id=$1', [device,p.sequence,p.activeConfigVersion,p.clockReliable,ctx.now]);
  await db.query('UPDATE dispositivos SET fw_versao=$2 WHERE id=$1', [device,p.firmwareVersion]);
  const accepted=(await db.query(`SELECT id,tipo,atuador,payload,aceite_sequencia FROM comandos
    WHERE dispositivo_id=$1 AND status='aceito' AND tipo IN ('manual_on','manual_off','testar_bomba','ignorar_boia')`,[device])).rows;
  for (const command of accepted) {
    const b=p.pumps[command.atuador==='irrigacao' ? 'B1' : 'B2'];
    if (command.payload.targetBootId!==p.bootId || b.mode==='AUTO' && command.aceite_sequencia!==null && p.sequence>Number(command.aceite_sequencia)) {
      await db.query(`UPDATE comandos SET status='concluido',finalizado_em=$2,motivo_resultado='Tratamento encerrado conforme estado reconciliado; consulte as saídas observadas.' WHERE id=$1`,[command.id,ctx.now]);
    }
  }
  await renew(ctx);
}
async function persistCycle(ctx: Context) {
  const { db,device,payload:p } = ctx;
  const old = (await db.query('SELECT * FROM acionamentos WHERE dispositivo_id=$1 AND id_externo=$2', [device,p.cycleId])).rows[0];
  const source = p.source === 'emergency' ? 'emergencia' : p.source === 'test' ? 'teste' : p.source;
  const command = p.commandId ? (await db.query('SELECT id,atuador,payload,status FROM comandos WHERE dispositivo_id=$1 AND id_externo=$2', [device,p.commandId])).rows[0] : null;
  if (command && command.atuador !== actuator(p.pumpId)) throw new DomainRejection('Ciclo aponta comando de outra bomba.');
  if (command && (command.payload.targetBootId!==p.bootId || command.payload.targetBootNumber!==p.bootNumber)) throw new DomainRejection('Ciclo aponta comando de outro boot.');
  if (old && (old.atuador !== actuator(p.pumpId) || old.origem !== source || old.comando_externo !== p.commandId)) throw new DomainRejection('cycleId reutilizado com outra identidade.');
  const b = p.measurementsBefore; const a = p.measurementsAfter;
  if (!old) {
    await db.query(`INSERT INTO acionamentos(dispositivo_id,mensagem_id,id_externo,atuador,inicio,fim,origem,motivo,
      solo_antes,solo_depois,temp_antes,temp_depois,ur_antes,ur_depois,comando_id,comando_externo,duracao_monotonica_s,
      concluido,inicio_recebido_em,fim_recebido_em) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [device,p.messageId,p.cycleId,actuator(p.pumpId),p.startedAt,p.endedAt,source,p.reason,b.soilMoisturePercent,a?.soilMoisturePercent ?? null,
      b.airTemperatureC,a?.airTemperatureC ?? null,b.airHumidityPercent,a?.airHumidityPercent ?? null,command?.id ?? null,p.commandId,
      p.elapsedSeconds,p.phase === 'finished',ctx.now,p.phase === 'finished' ? ctx.now : null]);
  } else if (!old.concluido && p.phase === 'finished') {
    await db.query(`UPDATE acionamentos SET inicio=coalesce(inicio,$3),fim=$4,motivo=$5,solo_depois=$6,temp_depois=$7,ur_depois=$8,
      duracao_monotonica_s=$9,concluido=true,fim_recebido_em=$10,comando_id=coalesce(comando_id,$11) WHERE dispositivo_id=$1 AND id_externo=$2`,
    [device,p.cycleId,p.startedAt,p.endedAt,p.reason,a.soilMoisturePercent,a.airTemperatureC,a.airHumidityPercent,p.elapsedSeconds,ctx.now,command?.id ?? null]);
  } else if (old.inicio === null && p.startedAt !== null) {
    await db.query('UPDATE acionamentos SET inicio=$3 WHERE dispositivo_id=$1 AND id_externo=$2', [device,p.cycleId,p.startedAt]);
  }
  if (p.phase==='finished' && command?.status==='aceito') {
    await db.query(`UPDATE comandos SET status='concluido',finalizado_em=$2,motivo_resultado=$3 WHERE id=$1`,[command.id,ctx.now,p.reason]);
  }
  await event(ctx,'mudanca_modo',`${p.pumpId}: ciclo ${p.phase === 'finished' ? 'encerrado' : 'iniciado'}.`);
}
export async function persistEvent(ctx: Context) {
  const { db,device,payload:p,session:s } = ctx;
  if (p.eventType === 'cycle') await persistCycle(ctx);
  if (p.eventType === 'alert') {
    const newer = ctx.live && p.sequence > Number(s.alerta_seq);
    const hasCurrent = s.boot_id !== null;
    await upsertAlert(ctx,p,p.phase === 'resolved',!newer && hasCurrent);
    if (newer) await db.query('UPDATE mqtt_sessoes SET alerta_seq=$2 WHERE dispositivo_id=$1', [device,p.sequence]);
    await event(ctx,'alerta',`${p.code}: ${p.phase}.`);
  }
  if (p.eventType === 'calibration') {
    const old = (await db.query('SELECT id,adc_seco,adc_agua FROM calibracoes WHERE dispositivo_id=$1 AND id_externo=$2', [device,p.calibrationId])).rows[0];
    if (old && (old.adc_seco !== p.adcDry || old.adc_agua !== p.adcWater)) throw new DomainRejection('calibrationId reutilizado com outros ADCs.');
    const calibration = old ?? (await db.query(`INSERT INTO calibracoes(dispositivo_id,id_externo,adc_seco,adc_agua) VALUES ($1,$2,$3,$4) RETURNING id`, [device,p.calibrationId,p.adcDry,p.adcWater])).rows[0];
    await db.query('UPDATE leituras SET calibracao_id=$3 WHERE dispositivo_id=$1 AND calibracao_externa=$2 AND calibracao_id IS NULL', [device,p.calibrationId,calibration.id]);
    await event(ctx,'calibracao','Calibração do solo recebida.');
  }
  if (p.eventType === 'fsm_transition') {
    await db.query(`INSERT INTO transicoes_fsm(dispositivo_id,mensagem_id,maquina,de_estado,para_estado,motivo,ts,recebido_em)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [device,p.messageId,p.machine === 'irrigation' ? 'irrigacao' : p.machine === 'fog' ? 'nevoa' : 'substrato',p.fromState,p.toState,p.reason,p.occurredAt,ctx.now]);
    await event(ctx,'mudanca_modo',`${p.machine}: ${p.toState}.`);
  }
}
export async function persistAck(ctx: Context) {
  const { db,device,payload:p } = ctx;
  const command = (await db.query('SELECT * FROM comandos WHERE dispositivo_id=$1 AND id_externo=$2', [device,p.commandId])).rows[0];
  if (!command) throw new DomainRejection('ACK sem comando autorizado conhecido.');
  const request = command.payload;
  if (request.targetBootId !== p.bootId || request.targetBootNumber !== p.bootNumber || request.targetConnectionId !== p.connectionId) throw new DomainRejection('ACK de boot/conexão diferente do alvo do comando.');
  if (p.appliedConfigVersion !== null && (request.action !== 'APPLY_CONFIG' || p.appliedConfigVersion !== request.configVersion)) throw new DomainRejection('ACK informa versão diferente da configuração solicitada.');
  if (request.action === 'APPLY_CONFIG' && p.status === 'completed' && p.appliedConfigVersion !== request.configVersion) throw new DomainRejection('Configuração concluída sem versão aplicada correspondente.');
  const status = p.status === 'accepted' ? 'aceito' : p.status === 'rejected' ? 'rejeitado' : 'concluido';
  await db.query(`INSERT INTO comando_confirmacoes(comando_id,dispositivo_id,mensagem_id,resultado,motivo,ocorrido_em,recebido_em)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [command.id,device,p.messageId,status,p.reason,p.occurredAt,ctx.now]);
  if (!['concluido','rejeitado','expirado'].includes(command.status)) {
    const expired = ['pendente','enviado'].includes(command.status) && Date.parse(iso(command.valido_ate)!) <= Date.parse(ctx.now);
    const next = expired ? 'expirado' : command.status === 'aceito' && p.status === 'accepted' ? 'aceito' : status;
    await db.query(`UPDATE comandos SET status=$2,confirmado_em=CASE WHEN $2 IN ('aceito','concluido') THEN coalesce(confirmado_em,$3) ELSE confirmado_em END,
      finalizado_em=CASE WHEN $2 IN ('concluido','rejeitado','expirado') THEN $3 ELSE NULL END,motivo_resultado=$4,
      aceite_sequencia=CASE WHEN $2 IN ('aceito','concluido') THEN greatest(coalesce(aceite_sequencia,0),$5) ELSE aceite_sequencia END WHERE id=$1`,
    [command.id,next,ctx.now,expired ? 'Confirmação recebida após validade do pedido.' : p.reason,p.sequence]);
    if (request.action === 'APPLY_CONFIG' && !expired) {
      if (p.status === 'completed') await applyKnownConfig(ctx,request.configVersion);
      if (p.status === 'rejected') await db.query(`UPDATE config_historico SET rejeitada_em=$3,motivo_rejeicao=$4
        WHERE dispositivo_id=$1 AND versao=$2 AND NOT aplicada_no_esp`, [device,request.configVersion,ctx.now,p.reason]);
    }
  }
  await event(ctx,request.action === 'APPLY_CONFIG' ? 'configuracao' : 'comando',`${p.commandId}: ${p.status}.`);
}
