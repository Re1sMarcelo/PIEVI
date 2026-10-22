# Login com PostgreSQL local

A API usa o banco `PIEVI` no PostgreSQL local 17.6, com as tabelas de `db/001_schema.sql` no schema `public`. A conexão foi conferida em 22/10/2026. Railway continua sendo o destino previsto para hospedagem; esta etapa usa o banco local.

## Conexão

Em `api/.env`, configure a conexão real. O arquivo é local e ignorado pelo Git:

```dotenv
DATABASE_URL=postgresql://postgres:SUA_SENHA@localhost:5432/PIEVI
```

Se usuário ou senha tiver caracteres especiais de URL, codifique esses componentes na URI. A senha dessa conexão pertence ao PostgreSQL; a senha do operador do aplicativo é criada separadamente.

Na raiz `C:\PIEVI`, confira a conexão e o esquema sem alterar dados:

```powershell
npm.cmd run db:check -w api
```

O comando mostra banco, versão, schema e quantidade de operadores/dispositivos/vínculos. O pool da API define `search_path=public` e horário UTC para suas próprias conexões, sem mudar a configuração global do servidor.

## Primeiro operador

No PowerShell, na raiz do projeto:

```powershell
npm.cmd run provision:operator -w api
```

O comando pede usuário, nome, e-mail opcional para login e confirmação da senha, mascarada no terminal. A senha deve ter pelo menos 12 caracteres. Ele grava somente seu hash scrypt e cria o vínculo com `bancada-01`, identificada no banco como dispositivo **simulado**, em uma única transação.

O provisionamento serializa a criação e recusa uma segunda conta ativa. Ele não sobrescreve credenciais existentes nem transforma um dispositivo físico existente em simulador. Não cria uma rota pública de cadastro. A conta escolhida pelo responsável usa senha própria; nenhuma conta `demo` é criada automaticamente.

Para automação local controlada, o comando também aceita `--from-env` com `OPERATOR_USERNAME`, `OPERATOR_PASSWORD_HASH` e, opcionalmente, `OPERATOR_NAME` e `OPERATOR_EMAIL`. Para gerar o hash, existe `npm.cmd run hash-password -w api`. O modo interativo evita precisar guardar essas credenciais de provisionamento no `.env`.

## Uso no app

Inicie ou reinicie a API depois de configurar `DATABASE_URL`:

```powershell
npm.cmd run dev:api
```

Se a API já estiver rodando na porta 3000, use a instância existente ou encerre-a antes de abrir outra. O comando de provisionamento pode ser executado com a API em funcionamento; a conta recém-criada fica disponível sem reiniciar.

`GET /health` informa `authStorage: "postgres"` quando esse modo foi selecionado na inicialização. Esse endpoint indica que o servidor está atendendo; `db:check` realiza uma consulta ao banco. O proxy do Metro continua encaminhando `/api/*`, então o app pode usar a API pelo túnel Expo existente.

Entre com o usuário **ou o e-mail cadastrado**, usando a mesma senha. O campo do app é “Usuário ou e-mail”. Maiúsculas/minúsculas e espaços no começo/fim do identificador são tratados de forma equivalente; a senha é verificada exatamente como foi cadastrada. Sem e-mail associado, a conta continua acessível pelo usuário.

No JSON de `POST /v1/auth/login`, o campo existente `username` passa a aceitar qualquer um desses identificadores; a resposta continua trazendo o nome de usuário canônico. Um identificador que corresponda a duas contas é recusado. A criação da sessão revalida a senha e o identificador sob bloqueio da linha do usuário.

Tokens antigos do modo em memória serão recusados; o app volta ao login quando recebe 401. Com `DATABASE_URL`, `PIEVI_DEMO_AUTH` e as credenciais de ambiente não servem como alternativa de login: a conta e o hash são consultados no banco. Falha de consulta retorna 503 e não ativa autenticação em memória.

## Sessões e autorização

- Login retorna token aleatório de 32 bytes e expiração de 8 horas. O banco persiste apenas SHA-256 do token, associado ao operador.
- O app guarda o token original no SecureStore. A API valida expiração, revogação e usuário ativo em cada requisição protegida.
- Todas as rotas da bancada também exigem vínculo ativo do operador em `dispositivo_usuarios`.
- Logout revoga a sessão no banco. Troca do hash de senha ou desativação da conta revoga suas sessões pelo trigger do esquema.
- Sessões persistem após reiniciar a API. Leituras, controles, configuração e alertas do simulador continuam em memória e reiniciam com ele.

O código usa consultas parametrizadas e um pool com limite de conexões, seguindo a [documentação do node-postgres](https://node-postgres.com/features/queries). O provisionamento mantém a mesma conexão durante sua transação, conforme a [documentação de transações](https://node-postgres.com/features/transactions).

## Validação

`npm.cmd run test:auth -w api` executa 18 cenários com a API Fastify e SQL em PostgreSQL isolado via PGlite. Cobre login por usuário/e-mail, normalização e limites do identificador, ambiguidade entre contas, alteração concorrente do e-mail, credenciais, hash do token, persistência após recriação da API, logout, expiração, autorização de todas as rotas, desativação, troca de senha concorrente e banco indisponível. Não usa o banco local nem cria contas nele.

O banco local foi verificado por consultas de leitura. O catálogo `002_catalogo_alertas.sql` é independente da autenticação e ainda deve ser carregado antes da futura persistência dos alertas. A persistência do restante do simulador e a integração MQTT/ESP32 são etapas seguintes.
