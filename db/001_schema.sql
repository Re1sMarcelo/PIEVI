-- PIEVI: modelo inicial revisado para PostgreSQL 17+.
-- Referência original preservada: tmp/db/db_PIEVI.txt.
-- Executar somente em banco vazio, após revisar docs/revisao-modelo-banco.md.
-- Este arquivo não é uma migração de um banco existente.
BEGIN;
SET LOCAL TIME ZONE 'UTC';

-- IDENTIDADE E SESSÕES -------------------------------------------------------
CREATE TABLE usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario text NOT NULL CHECK (usuario = btrim(usuario) AND char_length(usuario) BETWEEN 3 AND 100),
  nome text NOT NULL CHECK (char_length(btrim(nome)) > 0),
  email text CHECK (email = btrim(email) AND char_length(email) <= 254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  senha_hash text NOT NULL CHECK (senha_hash ~ '^[0-9a-f]{32}:[0-9a-f]{128}$'),
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  senha_alterada_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX usuarios_usuario_normalizado_uq ON usuarios (lower(usuario));
CREATE UNIQUE INDEX usuarios_email_normalizado_uq ON usuarios (lower(email)) WHERE email IS NOT NULL;
COMMENT ON COLUMN usuarios.senha_hash IS 'Formato scrypt atual da API: salt hexadecimal de 16 bytes:hash hexadecimal de 64 bytes. Nunca senha em texto puro.';
COMMENT ON COLUMN usuarios.email IS 'E-mail opcional, aceito como alternativa ao usuario no login com a mesma senha. Não implica cadastro público ou recuperação por e-mail.';

CREATE TABLE sessoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL DEFAULT (now() + interval '8 hours'),
  revogado_em timestamptz,
  motivo_revogacao text,
  UNIQUE (id, usuario_id),
  CHECK (expira_em > criado_em),
  CHECK (revogado_em IS NULL OR revogado_em >= criado_em),
  CHECK ((revogado_em IS NULL) = (motivo_revogacao IS NULL))
);
CREATE INDEX sessoes_usuario_expiracao_idx ON sessoes (usuario_id, expira_em) WHERE revogado_em IS NULL;
COMMENT ON COLUMN sessoes.token_hash IS 'SHA-256 hexadecimal do token aleatório de 32 bytes. O token original fica somente no cliente e na resposta de login.';

CREATE FUNCTION atualizar_credenciais_usuario() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em := clock_timestamp();
  IF NEW.senha_hash IS DISTINCT FROM OLD.senha_hash THEN
    NEW.senha_alterada_em := clock_timestamp();
  END IF;
  IF NEW.senha_hash IS DISTINCT FROM OLD.senha_hash OR (OLD.ativo AND NOT NEW.ativo) THEN
    UPDATE sessoes
      SET revogado_em = clock_timestamp(),
          motivo_revogacao = CASE WHEN NOT NEW.ativo THEN 'usuario_desativado' ELSE 'credenciais_alteradas' END
      WHERE usuario_id = OLD.id AND revogado_em IS NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER usuarios_credenciais_trg BEFORE UPDATE ON usuarios
  FOR EACH ROW EXECUTE FUNCTION atualizar_credenciais_usuario();

-- DISPOSITIVOS E VÍNCULO DO OPERADOR -----------------------------------------
CREATE TABLE dispositivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identificador text NOT NULL UNIQUE CHECK (char_length(btrim(identificador)) > 0), -- API: bancada-01
  nome text NOT NULL CHECK (char_length(btrim(nome)) > 0),
  chip_id text NOT NULL UNIQUE CHECK (char_length(btrim(chip_id)) > 0),
  fuso_horario text NOT NULL DEFAULT 'America/Sao_Paulo',
  fw_versao text,
  ultimo_contato timestamptz,
  online boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT online OR ultimo_contato IS NOT NULL)
);

CREATE TABLE dispositivo_usuarios (
  dispositivo_id uuid NOT NULL REFERENCES dispositivos(id) ON DELETE RESTRICT,
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  ativo boolean NOT NULL DEFAULT true,
  vinculado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dispositivo_id, usuario_id)
);
CREATE INDEX dispositivo_usuarios_usuario_idx ON dispositivo_usuarios (usuario_id);
COMMENT ON TABLE dispositivo_usuarios IS 'Associação do operador à bancada. Sem hierarquia de perfis na versão aprovada; revogar por ativo=false preserva auditoria.';

-- COMANDOS: pedido e confirmação não são o estado físico da bomba. ------------
CREATE TABLE comandos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispositivo_id uuid NOT NULL REFERENCES dispositivos(id) ON DELETE RESTRICT,
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  sessao_id uuid NOT NULL,
  id_externo text NOT NULL CHECK (char_length(id_externo) BETWEEN 8 AND 100),
  tipo text NOT NULL CHECK (tipo IN ('manual_on','manual_off','voltar_auto','reset_falha','testar_bomba','ignorar_boia','config')),
  atuador text CHECK (atuador IN ('irrigacao','nevoa')),
  duracao_s integer,
  supervisao_confirmada boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload) = 'object'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  valido_ate timestamptz NOT NULL DEFAULT (now() + interval '10 seconds'),
  enviado_em timestamptz,
  confirmado_em timestamptz,
  finalizado_em timestamptz,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','enviado','aceito','concluido','expirado','rejeitado')),
  motivo_resultado text,
  UNIQUE (dispositivo_id, id_externo),
  UNIQUE (id, dispositivo_id),
  UNIQUE (id, dispositivo_id, usuario_id),
  UNIQUE (id, dispositivo_id, atuador),
  FOREIGN KEY (dispositivo_id, usuario_id) REFERENCES dispositivo_usuarios(dispositivo_id, usuario_id) ON DELETE RESTRICT,
  FOREIGN KEY (sessao_id, usuario_id) REFERENCES sessoes(id, usuario_id) ON DELETE RESTRICT,
  CHECK ((tipo = 'config' AND atuador IS NULL) OR (tipo <> 'config' AND atuador IS NOT NULL)),
  -- Tentativas rejeitadas/expiradas também são auditadas, mesmo com duração inválida.
  CHECK (status IN ('rejeitado','expirado') OR (
    (tipo = 'manual_on' AND duracao_s IS NOT NULL AND duracao_s BETWEEN 1 AND CASE WHEN atuador = 'irrigacao' THEN 300 ELSE 60 END)
    OR (tipo = 'manual_off' AND duracao_s IS NOT NULL AND duracao_s BETWEEN 1 AND 3600)
    OR (tipo = 'testar_bomba' AND duracao_s IS NOT NULL AND duracao_s = 10)
    OR (tipo = 'ignorar_boia' AND duracao_s IS NOT NULL AND duracao_s BETWEEN 1 AND CASE WHEN atuador = 'irrigacao' THEN 120 ELSE 60 END)
    OR (tipo IN ('voltar_auto','reset_falha','config') AND duracao_s IS NULL)
  )),
  CHECK (status IN ('rejeitado','expirado') OR valido_ate > criado_em),
  CHECK (tipo <> 'ignorar_boia' OR status IN ('rejeitado','expirado') OR supervisao_confirmada),
  CHECK (enviado_em IS NULL OR enviado_em >= criado_em),
  CHECK (confirmado_em IS NULL OR confirmado_em >= criado_em),
  CHECK (finalizado_em IS NULL OR finalizado_em >= criado_em),
  CHECK (status NOT IN ('aceito','concluido') OR confirmado_em IS NOT NULL),
  CHECK (status <> 'enviado' OR enviado_em IS NOT NULL),
  CHECK ((status IN ('concluido','expirado','rejeitado')) = (finalizado_em IS NOT NULL)),
  CHECK (status <> 'rejeitado' OR char_length(btrim(motivo_resultado)) > 0 AND motivo_resultado IS NOT NULL)
);
CREATE INDEX comandos_dispositivo_criacao_idx ON comandos (dispositivo_id, criado_em DESC);
CREATE INDEX comandos_expiracao_idx ON comandos (valido_ate) WHERE status IN ('pendente','enviado');
CREATE INDEX comandos_usuario_idx ON comandos (usuario_id);
CREATE INDEX comandos_sessao_usuario_idx ON comandos (sessao_id, usuario_id);
CREATE UNIQUE INDEX comandos_excecao_boia_ativa_uq ON comandos (dispositivo_id)
  WHERE tipo = 'ignorar_boia' AND status IN ('pendente','enviado','aceito');
COMMENT ON COLUMN comandos.id_externo IS 'ID gerado pelo cliente (commandId). Uma repetição consulta o resultado existente; não gera novo acionamento.';
COMMENT ON COLUMN comandos.confirmado_em IS 'Recebimento da confirmação do ESP32; não comprova, por si só, saída física ligada.';

CREATE TABLE comando_confirmacoes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  comando_id bigint NOT NULL,
  dispositivo_id uuid NOT NULL,
  mensagem_id text NOT NULL CHECK (char_length(btrim(mensagem_id)) > 0),
  resultado text NOT NULL CHECK (resultado IN ('aceito','rejeitado','concluido')),
  motivo text,
  ocorrido_em timestamptz,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dispositivo_id, mensagem_id),
  FOREIGN KEY (comando_id, dispositivo_id) REFERENCES comandos(id, dispositivo_id) ON DELETE RESTRICT
);
CREATE INDEX comando_confirmacoes_comando_idx ON comando_confirmacoes (comando_id, recebido_em);

-- CONFIGURAÇÃO SOLICITADA E CONFIGURAÇÃO APLICADA -----------------------------
CREATE TABLE config_historico (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispositivo_id uuid NOT NULL REFERENCES dispositivos(id) ON DELETE RESTRICT,
  versao integer NOT NULL CHECK (versao > 0),
  solo_min numeric NOT NULL DEFAULT 60 CHECK (solo_min BETWEEN 30 AND 80),
  solo_max numeric NOT NULL DEFAULT 75 CHECK (solo_max BETWEEN 50 AND 95),
  irrig_max_s integer NOT NULL DEFAULT 300 CHECK (irrig_max_s BETWEEN 30 AND 300),
  cooldown_irrig_min integer NOT NULL DEFAULT 10 CHECK (cooldown_irrig_min BETWEEN 5 AND 30),
  irrig_max_ciclos_dia integer NOT NULL DEFAULT 20 CHECK (irrig_max_ciclos_dia BETWEEN 5 AND 40),
  janela_irrig_ativa boolean NOT NULL DEFAULT false,
  janela_inicio time NOT NULL DEFAULT '06:00',
  janela_fim time NOT NULL DEFAULT '17:00',
  temp_nevoa_on numeric NOT NULL DEFAULT 28 CHECK (temp_nevoa_on BETWEEN 22 AND 40),
  histerese_nevoa numeric NOT NULL DEFAULT 3 CHECK (histerese_nevoa BETWEEN 1 AND 6),
  ur_min_nevoa numeric NOT NULL DEFAULT 50 CHECK (ur_min_nevoa BETWEEN 30 AND 70),
  ur_trava_nevoa numeric NOT NULL DEFAULT 90 CHECK (ur_trava_nevoa BETWEEN 80 AND 98),
  pulso_nevoa_s integer NOT NULL DEFAULT 60 CHECK (pulso_nevoa_s BETWEEN 10 AND 60),
  pausa_nevoa_min integer NOT NULL DEFAULT 5 CHECK (pausa_nevoa_min BETWEEN 1 AND 30),
  temp_emergencia numeric NOT NULL DEFAULT 35 CHECK (temp_emergencia BETWEEN 30 AND 45),
  temp_raiz_alerta numeric NOT NULL DEFAULT 26 CHECK (temp_raiz_alerta BETWEEN 20 AND 35),
  bloquear_bombas_sem_agua boolean NOT NULL DEFAULT true CHECK (bloquear_bombas_sem_agua),
  manual_irrig_s integer NOT NULL DEFAULT 120 CHECK (manual_irrig_s BETWEEN 10 AND 300),
  manual_nevoa_s integer NOT NULL DEFAULT 30 CHECK (manual_nevoa_s BETWEEN 5 AND 60),
  alterado_por uuid,
  comando_id bigint,
  aplicada_no_esp boolean NOT NULL DEFAULT false,
  aplicada_em timestamptz,
  rejeitada_em timestamptz,
  motivo_rejeicao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dispositivo_id, versao),
  UNIQUE (id, dispositivo_id),
  FOREIGN KEY (dispositivo_id, alterado_por) REFERENCES dispositivo_usuarios(dispositivo_id, usuario_id) ON DELETE RESTRICT,
  FOREIGN KEY (comando_id, dispositivo_id, alterado_por) REFERENCES comandos(id, dispositivo_id, usuario_id) ON DELETE RESTRICT,
  CHECK (solo_max >= solo_min + 5),
  CHECK (NOT janela_irrig_ativa OR janela_inicio <> janela_fim),
  CHECK (aplicada_no_esp = (aplicada_em IS NOT NULL)),
  CHECK (rejeitada_em IS NULL OR NOT aplicada_no_esp),
  CHECK ((rejeitada_em IS NULL) = (motivo_rejeicao IS NULL)),
  CHECK (motivo_rejeicao IS NULL OR char_length(btrim(motivo_rejeicao)) > 0),
  CHECK (comando_id IS NULL OR alterado_por IS NOT NULL),
  CHECK (aplicada_em IS NULL OR aplicada_em >= criado_em),
  CHECK (rejeitada_em IS NULL OR rejeitada_em >= criado_em)
);
COMMENT ON COLUMN config_historico.alterado_por IS 'NULL somente para configuração inicial/padrão recebida do firmware; alterações do app identificam o operador.';

CREATE VIEW config_atual AS
  SELECT DISTINCT ON (dispositivo_id) * FROM config_historico
  WHERE aplicada_no_esp
  ORDER BY dispositivo_id, versao DESC;

CREATE TABLE irrigacao_programada (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  configuracao_id bigint NOT NULL,
  dispositivo_id uuid NOT NULL,
  horario_local time NOT NULL,
  duracao_s integer NOT NULL DEFAULT 60 CHECK (duracao_s BETWEEN 1 AND 300),
  habilitada boolean NOT NULL DEFAULT true,
  UNIQUE (configuracao_id, horario_local),
  FOREIGN KEY (configuracao_id, dispositivo_id) REFERENCES config_historico(id, dispositivo_id) ON DELETE RESTRICT
);
COMMENT ON TABLE irrigacao_programada IS 'Fallback do sensor de solo. Horário no fuso do dispositivo; execução suspensa se o ESP32 não tiver hora confiável. Respeita limites, bloqueios e contagem diária.';

CREATE TABLE calibracoes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispositivo_id uuid NOT NULL REFERENCES dispositivos(id) ON DELETE RESTRICT,
  sensor text NOT NULL DEFAULT 'solo' CHECK (sensor = 'solo'),
  adc_seco integer NOT NULL CHECK (adc_seco BETWEEN 0 AND 4095),
  adc_agua integer NOT NULL CHECK (adc_agua BETWEEN 0 AND 4095),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (adc_seco <> adc_agua)
);
CREATE INDEX calibracoes_dispositivo_criacao_idx ON calibracoes (dispositivo_id, criado_em DESC);

-- TELEMETRIA E ESTADO EFETIVAMENTE INFORMADO PELO ESP32 -----------------------
CREATE TABLE leituras (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispositivo_id uuid NOT NULL REFERENCES dispositivos(id) ON DELETE RESTRICT,
  mensagem_id text NOT NULL CHECK (char_length(btrim(mensagem_id)) > 0),
  ts timestamptz,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  hora_confiavel boolean NOT NULL,
  temp_ar numeric(4,1) CHECK (temp_ar BETWEEN -10 AND 60),
  umid_ar numeric(4,1) CHECK (umid_ar BETWEEN 0 AND 100),
  temp_raiz numeric(4,1) CHECK (temp_raiz BETWEEN -10 AND 60),
  umid_solo numeric(4,1) CHECK (umid_solo BETWEEN 0 AND 100),
  umid_solo_adc integer CHECK (umid_solo_adc BETWEEN 0 AND 4095),
  nivel_ok boolean NOT NULL,
  dht_confiavel boolean NOT NULL,
  raiz_confiavel boolean NOT NULL,
  solo_confiavel boolean NOT NULL,
  UNIQUE (dispositivo_id, mensagem_id),
  CHECK (NOT hora_confiavel OR ts IS NOT NULL),
  CHECK (NOT dht_confiavel OR (temp_ar IS NOT NULL AND umid_ar IS NOT NULL)),
  CHECK (NOT raiz_confiavel OR temp_raiz IS NOT NULL),
  CHECK (NOT solo_confiavel OR umid_solo IS NOT NULL)
);
CREATE INDEX leituras_dispositivo_tempo_idx ON leituras (dispositivo_id, ts DESC NULLS LAST, id DESC);
COMMENT ON COLUMN leituras.mensagem_id IS 'messageId do MQTT. Duas mensagens diferentes no mesmo instante são preservadas; reentrega da mesma mensagem é deduplicada.';
COMMENT ON COLUMN leituras.ts IS 'Horário informado pelo dispositivo. Se ausente/não confiável, mostrar recebido_em com a qualidade explícita; não usar para fallback agendado.';
COMMENT ON COLUMN leituras.nivel_ok IS 'false tanto para nível baixo quanto para circuito aberto da boia. Não representa porcentagem do reservatório.';
COMMENT ON COLUMN leituras.temp_raiz IS 'Leitura inválida é NULL, nunca o sentinela -127 ou 85. Valores retidos com qualidade=false não são tratados como leitura atual válida.';

CREATE TABLE estado_atual (
  dispositivo_id uuid NOT NULL REFERENCES dispositivos(id) ON DELETE RESTRICT,
  atuador text NOT NULL CHECK (atuador IN ('irrigacao','nevoa')),
  estado_fsm text NOT NULL CHECK (char_length(btrim(estado_fsm)) > 0),
  modo text NOT NULL CHECK (modo IN ('AUTO','MANUAL_ON','MANUAL_OFF')),
  ligado boolean NOT NULL,
  modo_iniciado_em timestamptz,
  expira_em timestamptz,
  mensagem_id text NOT NULL CHECK (char_length(btrim(mensagem_id)) > 0),
  atualizado_em timestamptz,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dispositivo_id, atuador),
  CHECK ((modo = 'AUTO' AND expira_em IS NULL) OR (
    modo <> 'AUTO' AND modo_iniciado_em IS NOT NULL AND expira_em IS NOT NULL
    AND expira_em > modo_iniciado_em
  ))
);
COMMENT ON TABLE estado_atual IS 'Cache do estado observado, atualizado por estado/telemetria do ESP32; nunca pelo simples envio/aceite de comando. A API calcula a contagem regressiva a partir de expira_em.';

-- HISTÓRICO, ACIONAMENTOS E CONFIRMAÇÕES -------------------------------------
CREATE TABLE acionamentos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispositivo_id uuid NOT NULL REFERENCES dispositivos(id) ON DELETE RESTRICT,
  mensagem_id text NOT NULL CHECK (char_length(btrim(mensagem_id)) > 0),
  id_externo text NOT NULL CHECK (char_length(btrim(id_externo)) > 0),
  atuador text NOT NULL CHECK (atuador IN ('irrigacao','nevoa')),
  inicio timestamptz NOT NULL,
  fim timestamptz,
  duracao_s numeric GENERATED ALWAYS AS (extract(epoch FROM (fim - inicio))) STORED,
  origem text NOT NULL CHECK (origem IN ('auto','manual','fallback','emergencia','teste')),
  motivo text,
  solo_antes numeric, solo_depois numeric,
  temp_antes numeric, temp_depois numeric,
  ur_antes numeric, ur_depois numeric,
  comando_id bigint,
  UNIQUE (dispositivo_id, mensagem_id),
  UNIQUE (dispositivo_id, id_externo),
  FOREIGN KEY (comando_id, dispositivo_id, atuador) REFERENCES comandos(id, dispositivo_id, atuador) ON DELETE RESTRICT,
  CHECK (fim IS NULL OR fim >= inicio)
);
CREATE INDEX acionamentos_dispositivo_inicio_idx ON acionamentos (dispositivo_id, atuador, inicio DESC);
CREATE INDEX acionamentos_comando_idx ON acionamentos (comando_id) WHERE comando_id IS NOT NULL;
COMMENT ON COLUMN acionamentos.duracao_s IS 'Duração observada, calculada de fim-inicio. Pode ultrapassar o teto se houve falha física: o incidente precisa ser preservado, não recusado pelo banco.';
COMMENT ON COLUMN acionamentos.id_externo IS 'Identidade estável do ciclo, informada pelo ESP32. Início e fim atualizam o mesmo acionamento; mensagem_id identifica a mensagem inicial.';

CREATE TABLE transicoes_fsm (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispositivo_id uuid NOT NULL REFERENCES dispositivos(id) ON DELETE RESTRICT,
  mensagem_id text NOT NULL CHECK (char_length(btrim(mensagem_id)) > 0),
  maquina text NOT NULL CHECK (maquina IN ('irrigacao','nevoa','substrato')),
  de_estado text,
  para_estado text NOT NULL CHECK (char_length(btrim(para_estado)) > 0),
  motivo text,
  ts timestamptz,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dispositivo_id, mensagem_id)
);
CREATE INDEX transicoes_fsm_dispositivo_tempo_idx ON transicoes_fsm (dispositivo_id, recebido_em DESC);

CREATE TABLE eventos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispositivo_id uuid NOT NULL REFERENCES dispositivos(id) ON DELETE RESTRICT,
  mensagem_id text NOT NULL CHECK (char_length(btrim(mensagem_id)) > 0),
  usuario_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('leitura','comando','alerta','mudanca_modo','conexao','reinicio','configuracao','calibracao')),
  origem text NOT NULL CHECK (origem IN ('esp32','operador','backend','simulador')),
  descricao text NOT NULL CHECK (char_length(btrim(descricao)) > 0),
  detalhes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(detalhes) = 'object'),
  ocorrido_em timestamptz,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dispositivo_id, mensagem_id),
  FOREIGN KEY (dispositivo_id, usuario_id) REFERENCES dispositivo_usuarios(dispositivo_id, usuario_id) ON DELETE RESTRICT,
  CHECK (origem <> 'operador' OR usuario_id IS NOT NULL)
);
CREATE INDEX eventos_dispositivo_tempo_idx ON eventos (dispositivo_id, recebido_em DESC, id DESC);
COMMENT ON COLUMN eventos.detalhes IS 'Somente contexto operacional permitido pela API; nunca senha, hash de senha ou token de sessão.';

-- ALERTAS: reconhecer não é resolver a condição física. ----------------------
CREATE TABLE tipos_alerta (
  codigo text PRIMARY KEY CHECK (char_length(btrim(codigo)) > 0),
  severidade text NOT NULL CHECK (severidade IN ('critico','aviso','info')),
  mensagem text NOT NULL,
  acao_sugerida text NOT NULL
);

CREATE TABLE alertas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispositivo_id uuid NOT NULL REFERENCES dispositivos(id) ON DELETE RESTRICT,
  mensagem_id text NOT NULL CHECK (char_length(btrim(mensagem_id)) > 0),
  id_externo text NOT NULL CHECK (char_length(btrim(id_externo)) > 0),
  codigo text NOT NULL REFERENCES tipos_alerta(codigo) ON DELETE RESTRICT,
  atuador text CHECK (atuador IN ('irrigacao','nevoa')),
  severidade text NOT NULL CHECK (severidade IN ('critico','aviso','info')),
  mensagem text NOT NULL,
  acao_sugerida text NOT NULL,
  detalhe jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(detalhe) = 'object'),
  aberto_em timestamptz NOT NULL DEFAULT now(),
  resolvido_em timestamptz,
  reconhecido_por uuid,
  reconhecido_em timestamptz,
  UNIQUE (dispositivo_id, mensagem_id),
  UNIQUE (dispositivo_id, id_externo),
  FOREIGN KEY (dispositivo_id, reconhecido_por) REFERENCES dispositivo_usuarios(dispositivo_id, usuario_id) ON DELETE RESTRICT,
  CHECK (resolvido_em IS NULL OR resolvido_em >= aberto_em),
  CHECK (reconhecido_em IS NULL OR reconhecido_em >= aberto_em),
  CHECK ((reconhecido_por IS NULL) = (reconhecido_em IS NULL))
);
CREATE UNIQUE INDEX alertas_episodio_ativo_uq ON alertas (dispositivo_id, codigo, coalesce(atuador, 'dispositivo')) WHERE resolvido_em IS NULL;
CREATE INDEX alertas_dispositivo_abertura_idx ON alertas (dispositivo_id, aberto_em DESC);
COMMENT ON COLUMN alertas.severidade IS 'Severidade do episódio: UR_ALTA pode passar de aviso a crítico. O catálogo é apenas o padrão; mudanças futuras não reescrevem o histórico.';

COMMIT;
