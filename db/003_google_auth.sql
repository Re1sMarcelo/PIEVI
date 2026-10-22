-- Extensão opcional para login Google. Aplicar após 001_schema.sql.
-- Não altera senhas, contas autorizadas ou permissões existentes.
BEGIN;
SET LOCAL search_path = public;
CREATE TABLE identidades_externas (
  provedor text NOT NULL CHECK (provedor = 'google'),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 255),
  usuario_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  vinculado_em timestamptz NOT NULL DEFAULT now(),
  ultimo_acesso timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provedor, subject),
  UNIQUE (usuario_id, provedor)
);
COMMENT ON TABLE identidades_externas IS 'Vínculo estável pelo sub do Google. E-mail não substitui essa chave nem concede acesso à bancada.';

CREATE TABLE solicitacoes_acesso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub text NOT NULL UNIQUE CHECK (char_length(google_sub) BETWEEN 1 AND 255),
  email text NOT NULL CHECK (char_length(email) <= 254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  nome text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status = 'pendente'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE solicitacoes_acesso IS 'Pedidos confirmados pelo solicitante após autenticação Google. Só fila pendente; aprovação/avisos dependem da decisão do responsável. Não cria usuário ativo.';
CREATE INDEX solicitacoes_acesso_criacao_idx ON solicitacoes_acesso (criado_em DESC);
COMMIT;
