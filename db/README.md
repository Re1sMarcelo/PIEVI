# Modelo PostgreSQL do PIEVI

Modelo revisado a partir de [`tmp/db/db_PIEVI.txt`](../tmp/db/db_PIEVI.txt), preservado como referência original. A [revisão detalhada](../docs/revisao-modelo-banco.md) explica as correções, os limites de responsabilidade do banco e a política aprovada de operador único com cadastro controlado.

| Arquivo | Finalidade |
| --- | --- |
| `001_schema.sql` | Estrutura inicial: identidade, sessões, dispositivos, comandos, configuração, telemetria e histórico |
| `002_catalogo_alertas.sql` | Catálogo dos 20 alertas do documento de estados, com as decisões aprovadas |
| `003_google_auth.sql` | Extensão opcional para vincular identidades Google e guardar solicitações pendentes; sem aprovação automática |
| `consultas-autenticacao.sql` | Exemplos parametrizados para cadastro controlado, login, sessão e autorização por bancada |
| `tests/schema.test.mjs` | Cenários de integração SQL em PostgreSQL isolado com PGlite |

## Validação local

Na raiz, após instalar as dependências:

```powershell
npm.cmd run test:db
```

Os testes criam um banco em memória, carregam o esquema e o catálogo, verificam os cenários e descartam esse banco. Não usam `DATABASE_URL` nem conectam ao Railway. O mecanismo testado é PostgreSQL 18.6 via PGlite 0.5.11; o SQL usa recursos disponíveis no PostgreSQL 17+. A versão de produção deverá ser confirmada antes da implantação.

## Criação futura

O destino previsto na documentação é PostgreSQL no Railway. `001_schema.sql` e `002_catalogo_alertas.sql` são scripts iniciais para banco vazio, nessa ordem. Cada um usa transação. O banco não recebe uma conta `demo` ou senha padrão por esses scripts.

Se já houver tabelas/dados, preparar uma migração `ALTER TABLE` específica após inspecionar o banco. O modelo revisado altera chaves, campos obrigatórios e estruturas do original; executá-lo sobre uma base existente não faz essa conversão.

`consultas-autenticacao.sql` é material para o repositório da API: seus `PREPARE`s são locais à conexão e não precisam ser carregados como migração. O cadastro permanece controlado no escopo aprovado; o arquivo não disponibiliza uma rota pública de cadastro.

## Estado da aplicação

A autenticação da API já usa PostgreSQL quando `DATABASE_URL` está configurada: usuário, sessões e autorização por bancada são consultados no banco. O [guia de autenticação local](../docs/autenticacao-local.md) explica o provisionamento controlado do operador. Leituras, comandos, configuração e alertas continuam no simulador em memória; a persistência desses recursos será integrada depois.

Para testar Google no Android, aplique também `003_google_auth.sql` uma vez com `npm.cmd run db:migrate-google -w api` e configure o ID OAuth Web. Siga a seção Google do [guia Android](../GUIA-ANDROID-EXPO-GO.md). A extensão não altera contas/senhas existentes e não libera novos operadores.
