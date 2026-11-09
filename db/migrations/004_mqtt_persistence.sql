-- Incremental sobre 001_schema.sql + 002_catalogo_alertas.sql.
-- Transação e checksum são controlados por npm run db:migrate -w api -- --apply.
ALTER TABLE dispositivos ADD COLUMN mqtt_habilitado boolean NOT NULL DEFAULT false;

CREATE TABLE mqtt_boots (
  dispositivo_id uuid NOT NULL REFERENCES dispositivos(id),
  numero integer NOT NULL CHECK (numero > 0),
  boot_id uuid NOT NULL,
  registrado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (dispositivo_id, numero), UNIQUE (dispositivo_id, boot_id)
);
CREATE TABLE mqtt_sessoes (
  dispositivo_id uuid PRIMARY KEY REFERENCES dispositivos(id),
  maior_boot integer NOT NULL DEFAULT 0,
  boot_numero integer, boot_id uuid, conexao_id uuid,
  sincronizada_em timestamptz, ultimo_contato timestamptz,
  estado_recebido_em timestamptz, leitura_recebida_em timestamptz,
  estado_seq bigint NOT NULL DEFAULT 0, leitura_seq bigint NOT NULL DEFAULT 0,
  alerta_seq bigint NOT NULL DEFAULT 0, config_versao integer NOT NULL DEFAULT 0,
  hora_confiavel boolean NOT NULL DEFAULT false,
  sync_id uuid, sync_expira_em timestamptz,
  leitura_id bigint REFERENCES leituras(id),
  CHECK ((sync_id IS NULL) = (sync_expira_em IS NULL)),
  CHECK (sincronizada_em IS NULL OR (boot_id IS NOT NULL AND boot_numero IS NOT NULL AND conexao_id IS NOT NULL))
);
CREATE TABLE mqtt_mensagens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispositivo_id uuid NOT NULL REFERENCES dispositivos(id),
  mensagem_id text NOT NULL, canal text NOT NULL CHECK (canal IN ('telemetry','state','events','acks')),
  topico text NOT NULL, payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  boot_id uuid NOT NULL, boot_numero integer NOT NULL, conexao_id uuid NOT NULL, sequencia bigint NOT NULL,
  ocorrido_em timestamptz, recebido_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  resultado text NOT NULL CHECK (resultado IN ('processada','rejeitada')),
  motivo text,
  UNIQUE (dispositivo_id, mensagem_id),
  CHECK (resultado <> 'rejeitada' OR motivo IS NOT NULL)
);
CREATE INDEX mqtt_mensagens_dispositivo_idx ON mqtt_mensagens(dispositivo_id, recebido_em DESC, id DESC);
CREATE TABLE mqtt_conflitos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dispositivo_id uuid NOT NULL REFERENCES dispositivos(id), mensagem_id text NOT NULL,
  hash text NOT NULL, payload jsonb NOT NULL, motivo text NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(dispositivo_id, mensagem_id, hash)
);
CREATE TABLE mqtt_saida (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dispositivo_id uuid NOT NULL REFERENCES dispositivos(id),
  comando_id bigint REFERENCES comandos(id), canal text NOT NULL CHECK (canal IN ('commands','sync','receipts')),
  topico text NOT NULL, payload jsonb NOT NULL, valido_ate timestamptz,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(), publicado_em timestamptz,
  cancelado_em timestamptz, CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX mqtt_saida_pendente_idx ON mqtt_saida(criado_em) WHERE publicado_em IS NULL AND cancelado_em IS NULL;
ALTER TABLE comandos ADD COLUMN requisicao_hash text;
ALTER TABLE comandos ADD COLUMN aceite_sequencia bigint;

ALTER TABLE calibracoes ADD COLUMN id_externo uuid;
ALTER TABLE calibracoes ADD CONSTRAINT calibracoes_id_dispositivo_uq UNIQUE(id, dispositivo_id);
CREATE UNIQUE INDEX calibracoes_externo_uq ON calibracoes(dispositivo_id, id_externo) WHERE id_externo IS NOT NULL;
ALTER TABLE leituras ADD COLUMN calibracao_externa uuid;
ALTER TABLE leituras ADD COLUMN calibracao_id bigint;
ALTER TABLE leituras ADD CONSTRAINT leituras_calibracao_fk FOREIGN KEY(calibracao_id,dispositivo_id) REFERENCES calibracoes(id,dispositivo_id);
ALTER TABLE estado_atual ADD COLUMN hora_confiavel boolean NOT NULL DEFAULT true;
ALTER TABLE estado_atual ADD COLUMN restante_s integer;
ALTER TABLE estado_atual ADD COLUMN bloqueio text;
ALTER TABLE estado_atual ADD COLUMN falha text;
ALTER TABLE estado_atual ADD COLUMN boia_ignorada_ate timestamptz;
ALTER TABLE estado_atual ADD COLUMN feedback text CHECK (feedback IN ('relay_output','independent_sensor'));

-- Não preencher instantes físicos desconhecidos com o horário de recebimento.
ALTER TABLE acionamentos ALTER COLUMN inicio DROP NOT NULL;
ALTER TABLE acionamentos ADD COLUMN duracao_monotonica_s numeric CHECK (duracao_monotonica_s >= 0);
ALTER TABLE acionamentos ADD COLUMN concluido boolean NOT NULL DEFAULT false;
UPDATE acionamentos SET concluido = fim IS NOT NULL;
ALTER TABLE acionamentos ADD COLUMN inicio_recebido_em timestamptz;
ALTER TABLE acionamentos ADD COLUMN fim_recebido_em timestamptz;
ALTER TABLE acionamentos ADD COLUMN comando_externo text;
COMMENT ON COLUMN acionamentos.duracao_monotonica_s IS 'Duração observada no ESP, independente de UTC. Pode ultrapassar tetos em incidentes. A duracao_s original continua calculada de fim-inicio quando conhecidos.';

-- aberto_em/resolvido_em continuam sendo a linha do tempo operacional do registro.
-- Os campos *_no_esp_em preservam o instante físico, inclusive NULL se desconhecido.
ALTER TABLE alertas ADD COLUMN aberto_no_esp_em timestamptz;
ALTER TABLE alertas ADD COLUMN resolvido_no_esp_em timestamptz;
ALTER TABLE alertas ADD COLUMN origem text NOT NULL DEFAULT 'legado' CHECK (origem IN ('esp32','backend','legado'));
ALTER TABLE alertas ADD COLUMN esp_boot_numero integer;
ALTER TABLE alertas ADD COLUMN esp_boot_id uuid;
ALTER TABLE alertas ADD COLUMN esp_sequencia bigint;
UPDATE alertas SET aberto_no_esp_em=aberto_em, resolvido_no_esp_em=resolvido_em;
COMMENT ON COLUMN alertas.aberto_em IS 'Abertura operacional no backend para novos episódios MQTT; instante físico separado em aberto_no_esp_em. Linhas legadas preservadas.';
