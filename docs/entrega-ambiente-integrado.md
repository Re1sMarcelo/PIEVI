# Entrega do ambiente integrado — trabalho em etapas

Objetivo: o colega recebe o mesmo repositório, inicia PostgreSQL, broker e API na própria máquina, abre o app e testa com ESP físico ou ESP virtual.

| Etapa | Entrega | Situação |
| --- | --- | --- |
| 1 | Contrato MQTT v1, exemplos JSON, regras de conexão e validação executável | Implementada e usada no fluxo integrado |
| 2 | Migração incremental e repositório PostgreSQL para ingestão, deduplicação, ordenação, estados, comandos, configurações e histórico | Implementada e testada isoladamente; aplicação no destino via comando explícito |
| 3 | Cliente MQTT da API, modo integrado do app/API e ESP virtual seguindo o mesmo contrato | Implementada; validada com broker TCP e ESP virtual |
| 4 | Docker Compose com PostgreSQL, broker e API, provisionamento local, instruções para Expo, ensaio completo e pacote de entrega | Implementada para bancada virtual; validação do ESP físico pendente |

## O que pode ser usado agora

O [contrato MQTT v1](contrato-mqtt-v1.md) e a pasta [protocol/mqtt/v1](../protocol/mqtt/v1/README.md) são a referência comum para o firmware e a API integrada. Incluem leituras, estado de B1/B2, comandos, configuração completa, confirmações, ciclos, alertas, calibração, FSM, presença e sincronização de sessão.

O aplicativo aceita simulador em memória, laboratório MQTT com PGlite persistente ou API MQTT conectada ao PostgreSQL. A autenticação local é preservada. O [guia de execução](ambiente-integrado.md) descreve cada modo. O Compose usa banco e credenciais próprios; nenhum banco anterior do usuário foi migrado por essa entrega. O guia PDF de 03/11 é uma referência datada do modelo, não a especificação MQTT v1.

A [persistência PostgreSQL operacional](persistencia-postgresql.md) acrescenta a migração 004, ferramentas de aplicação/ingestão e o repositório transacional. O worker MQTT publica a outbox após commit, assina mensagens do ESP e exige nova sincronização após reconexão. O app aguarda ACK e estado do ESP, e só considera a configuração aplicada após confirmação.

## Critérios implementados na etapa de persistência

- Usar migração incremental; não reaplicar `001_schema.sql` em banco existente.
- Registrar payload recebido e resultado da ingestão em transação, com identidade de mensagem única e verificação de conflito de conteúdo.
- Persistir os checkpoints de boot, sessão e sequência. Reentrega pode repetir confirmação de transporte, mas não o efeito no banco ou a atuação.
- Preservar horário desconhecido e duração monotônica; não fabricar horários de ciclos. Evoluir os campos exigidos pelo modelo atual.
- Separar configuração solicitada da aplicada; registrar o operador/sessão dos pedidos.
- Disponibilizar testes isolados de persistência e reconciliação antes de conectar o broker.

## Ensaio final previsto

1. Máquina nova: iniciar os serviços conforme o guia de instalação e verificar a saúde de cada um.
2. ESP virtual: sincronizar, aplicar configuração, enviar leituras e abrir o app com o operador local.
3. App: ligar/desligar B1 e B2 e observar ACK, estado, ciclo e histórico persistido.
4. Sensores/alertas: provocar nível baixo, falhas e recuperação; confirmar que reconhecimento não resolve a condição.
5. Rede: duplicar e atrasar mensagens, reiniciar API/broker/ESP e conferir ausência de atuação indevida e preservação do histórico.
6. ESP físico: substituir o virtual sem mudar o contrato; conferir a saída dos relés e as limitações da confirmação física.

O Compose usa PostgreSQL 17, Mosquitto 2 e Node 24. A API publica a porta 3000 na rede local; o broker publica 1883 somente em loopback, e o banco não expõe porta no host. `setup:compose` gera credenciais aleatórias. `validate:compose` verifica o caminho HTTP → MQTT → ESP virtual → PostgreSQL e reinicia os serviços para conferir persistência e idempotência. `package:delivery` gera o ZIP de código sem configurações reais e dados locais.

O ensaio virtual com containers foi executado em 09/11/2026: seis verificações aprovadas, incluindo reinício de PostgreSQL, broker, API e ESP. Evidência local em `tmp/compose-validation/latest.json`. Teste no celular físico, validação elétrica e firmware ESP32 continuam pendentes. O Compose não é uma configuração de produção: TLS, backup, retenção e múltiplos workers exigem uma etapa própria.

Os demais checks e os problemas corrigidos estão na [validação do ambiente integrado](validacao-ambiente-integrado.md).
