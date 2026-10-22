-- Exemplos parametrizados para implementar o repositório da API.
-- São PREPAREs por conexão, não uma migração e não um cadastro público.
-- A API valida entrada, autorização e hash de senha fora do banco.

PREPARE cadastrar_operador(text, text, text, text) AS
  INSERT INTO usuarios (usuario, nome, email, senha_hash)
  VALUES ($1, $2, $3, $4)
  RETURNING id, usuario, nome, email;
-- $1 usuario, $2 nome, $3 e-mail opcional para contato/login, $4 hash gerado no backend.
-- Provisionamento inicial/controlado. Associar à bancada na mesma transação.

PREPARE buscar_usuario_login(text) AS
  SELECT id, usuario, senha_hash FROM usuarios
  WHERE ativo AND (lower(usuario) = lower(btrim($1)) OR lower(email) = lower(btrim($1))) LIMIT 2;
-- $1 aceita usuário ou e-mail. Só autenticar se retornar exatamente uma conta.
-- Comparar a senha com scrypt e timingSafeEqual no backend.
-- Resposta de erro ao app é a mesma para usuário ausente/desativado/senha errada.

PREPARE criar_sessao(uuid, text, text, text) AS
  WITH usuario_validado AS (
    SELECT id FROM usuarios
    WHERE id = $1 AND ativo AND senha_hash = $3
      AND (lower(usuario) = lower(btrim($4)) OR lower(email) = lower(btrim($4)))
    FOR UPDATE
  )
  INSERT INTO sessoes (usuario_id, token_hash)
  SELECT id, $2 FROM usuario_validado
  RETURNING id, criado_em, expira_em;
-- $2 = SHA-256 do token; $3 = hash de senha verificado; $4 = usuário/e-mail informado.
-- Revalidar sob bloqueio evita criar sessão com credencial trocada em paralelo.
-- Retornar o token original uma única vez; o cliente mantém o SecureStore.

PREPARE validar_sessao(text) AS
  SELECT s.id AS sessao_id, u.id AS usuario_id, u.usuario
  FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
  WHERE s.token_hash = $1 AND s.revogado_em IS NULL
    AND s.expira_em > clock_timestamp() AND u.ativo;

PREPARE autorizar_dispositivo(text, text) AS
  SELECT s.id AS sessao_id, u.id AS usuario_id, d.id AS dispositivo_id
  FROM sessoes s
  JOIN usuarios u ON u.id = s.usuario_id
  JOIN dispositivo_usuarios du ON du.usuario_id = u.id
  JOIN dispositivos d ON d.id = du.dispositivo_id
  WHERE s.token_hash = $1 AND d.identificador = $2
    AND s.revogado_em IS NULL AND s.expira_em > clock_timestamp()
    AND u.ativo AND du.ativo;
-- Usar a autorização por dispositivo em TODAS as rotas da bancada.
-- FKs preservam vínculos históricos, mas não substituem este controle de acesso.

PREPARE encerrar_sessao(text) AS
  UPDATE sessoes SET revogado_em = clock_timestamp(), motivo_revogacao = 'logout'
  WHERE token_hash = $1 AND revogado_em IS NULL;

-- Troca de senha ou desativação de usuário revogam as sessões pelo trigger.
-- Antes de produção, implementar limite de tentativas de login. Não registrar segredos.
