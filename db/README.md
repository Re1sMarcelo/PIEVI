# Modelo PostgreSQL do PIEVI

Modelo revisado a partir de [`tmp/db/db_PIEVI.txt`](../tmp/db/db_PIEVI.txt), preservado como referência original. A [revisão detalhada](../docs/revisao-modelo-banco.md) explica as correções, os limites de responsabilidade do banco e a política aprovada de operador único com cadastro controlado.

Para o responsável pelo firmware e sensores, consulte o [guia de integração ESP32 e banco](../docs/guia-banco-esp32-sensores.md), com estrutura, dicionário de campos, exemplos MQTT, consultas SQL e roteiro de bancada. A [versão em PDF](../output/pdf/PIEVI-guia-banco-ESP32-sensores.pdf) está pronta para compartilhar.

| Arquivo | Finalidade |
| --- | --- |
| `001_schema.sql` | Estrutura inicial: identidade, sessões, dispositivos, comandos, configuração, telemetria e histórico |
| `002_catalogo_alertas.sql` | Catálogo dos 20 alertas do documento de estados, com as decisões aprovadas |
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
