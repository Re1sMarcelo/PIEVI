# PIEVI - Guia do banco para ESP32 e sensores

**Destinatário:** responsável pelo firmware, sensores e atuadores da estufa.\
**Versão:** 1.0 | **Data:** 03/11/2026.\
**Base:** esquema SQL e código presentes no repositório nesta data.

> **Integração física — referência atual:** use o [Contrato MQTT v1](contrato-mqtt-v1.md) e os [exemplos JSON versionados](../protocol/mqtt/v1/README.md). Eles substituem os payloads e tópicos propostos neste guia de 03/11. A [entrega do ambiente integrado](entrega-ambiente-integrado.md) registra as etapas e o que já está implementado. O PDF de 03/11 continua sendo uma cópia datada e não contém esse contrato novo.

## 1. Como usar este guia

O ESP32 coleta as leituras, executa a automação local e publica mensagens MQTT. O backend recebe essas mensagens, valida os dados e grava no PostgreSQL. Para integrar o firmware, implemente os dados e comportamentos descritos aqui e combine com o responsável pelo backend o contrato final das mensagens.

**O ESP32 não precisa de usuário, senha ou conexão direta com o PostgreSQL.** A conexão `DATABASE_URL` pertence ao backend. O dispositivo precisará do endereço do broker MQTT, credenciais próprias e identificação da bancada, ainda a serem definidos para a integração física.

Este guia diferencia três situações:

| Situação | O que existe |
| --- | --- |
| Implementado no repositório | Esquema PostgreSQL, catálogo de alertas, testes SQL e autenticação persistente quando há `DATABASE_URL`. |
| Arquitetura aprovada, integração pendente | MQTT entre ESP32 e backend; persistência de leituras, estado, comandos, configurações e alertas. Hoje esses recursos são simulados em memória. |
| Exemplos propostos neste guia | Payloads completos para o firmware, incluindo qualidade do relógio/solo/raiz e IDs de ciclos e episódios. Precisam ser alinhados e implementados nos dois lados. |

Não há atualmente uma rota HTTP de ingestão de sensores nem um consumidor MQTT implementado na API. `GET /v1/devices/:deviceId/telemetry` consulta o simulador; essa rota não recebe medições. Os exemplos MQTT abaixo orientam a próxima integração e ainda não podem ser enviados à API atual como se fossem suportados.

## 2. Arquitetura e responsabilidades

```text
Sensores / boia -> ESP32 <-> Broker MQTT <-> Backend <-> PostgreSQL
                                              ^
                                              |
                                         Aplicativo
```

| Componente | Responsabilidade |
| --- | --- |
| ESP32 | Medir, calibrar, indicar qualidade, controlar B1/B2, aplicar temporizadores e proteções, confirmar comandos e informar estado observado. Continuar em AUTO offline com a última configuração válida. |
| MQTT | Transportar telemetria, estado, eventos, presença, comandos e confirmações. |
| Backend | Identificar o dispositivo, validar e deduplicar mensagens, mapear nomes, persistir dados, verificar permissões e encaminhar pedidos. |
| PostgreSQL | Guardar histórico, vínculos, resultados e configuração aplicada; impor integridade e faixas dos campos. |
| Aplicativo | Mostrar informações e solicitar operações por meio da API, com sessão do operador. |

O banco não lê sensores nem desliga bombas. Os limites físicos e intertravamentos precisam funcionar no ESP32 mesmo sem Wi-Fi, broker, API ou banco.

## 3. Identificadores e convenções

| Identificador | Exemplo | Uso |
| --- | --- | --- |
| `deviceId` | `bancada-01` | Identidade pública da bancada na API e nos tópicos MQTT; corresponde a `dispositivos.identificador`. |
| `dispositivos.id` | UUID gerado pelo banco | Chave interna usada em `dispositivo_id` nas tabelas. O backend resolve a partir de `deviceId`. |
| `chip_id` | Identificação única do ESP32 | Identidade física cadastrada pelo backend. Não confundir com nome da bancada ou UUID. |
| `messageId` | `esp01-boot7-000123` | Identidade de uma mensagem lógica. Reenvio conserva o mesmo ID e conteúdo. Deve continuar único após reinícios. |
| `commandId` | `cmd-b1-20261103-001` | Identidade externa de um pedido, criada pelo cliente; corresponde a `comandos.id_externo`. |
| `cycleId` | `ciclo-boot7-0042` | Nome proposto para a identidade estável do acionamento; corresponde a `acionamentos.id_externo`. |
| `episodeId` | `nivel-boot7-0003` | Nome proposto para a identidade estável do episódio de alerta; corresponde a `alertas.id_externo`. |

**B1 = irrigação = `irrigacao`. B2 = névoa = `nevoa`.** No JSON do aplicativo são usados `B1` e `B2`; nas tabelas, `irrigacao` e `nevoa`.

Use números JSON sem unidade embutida: `28.4`, e não `"28,4 °C"`. Temperatura em °C, umidade em %, duração em segundos quando o campo termina em `_s`, minutos quando termina em `_min`. Booleanos são `true`/`false`; sensor indisponível usa `null`.

Horários de eventos usam ISO 8601 em UTC, por exemplo `2026-11-03T15:00:00Z`. As colunas de instantes são `timestamptz`. `ts`/`ocorrido_em` vêm do dispositivo; `recebido_em` é atribuído pelo backend/banco. A agenda de irrigação usa `time` local no fuso do dispositivo, padrão `America/Sao_Paulo`.

IDs internos `bigint` devem ser tratados como strings em JSON quando expostos, para evitar perda de precisão. O ESP32 responde usando `commandId`, sem precisar conhecer o `comandos.id` numérico.

## 4. Estrutura do banco e relacionamentos

O esquema possui **16 tabelas e uma view**. Todas as tabelas de operação se vinculam à bancada. As FKs usam `ON DELETE RESTRICT`, preservando referências do histórico.

| Tabela / view | Chave e relação principal | Finalidade |
| --- | --- | --- |
| `usuarios` | PK `id` UUID | Operador: usuário, nome, e-mail opcional, hash de senha, ativo e datas. Gerenciada pelo backend. |
| `sessoes` | PK `id` UUID; FK `usuario_id` | Hash do token, expiração e revogação da sessão. Gerenciada pelo backend. |
| `dispositivos` | PK `id` UUID; únicos `identificador`, `chip_id` | Cadastro, firmware, fuso, último contato e presença da bancada. |
| `dispositivo_usuarios` | PK (`dispositivo_id`, `usuario_id`) | Vínculo ativo do operador com a bancada, sem divisão de perfis. |
| `comandos` | PK `id` bigint; único (dispositivo, `id_externo`) | Pedido, autor/sessão, parâmetros, validade e resultado. |
| `comando_confirmacoes` | PK `id` bigint; FK composta para comando e dispositivo | Cada aceite, recusa ou conclusão enviado pelo ESP32. |
| `config_historico` | PK `id` bigint; único (dispositivo, `versao`) | Versões solicitadas, aplicadas ou rejeitadas da configuração. |
| `config_atual` (view) | Uma linha por dispositivo com versão aplicada | Maior versão confirmada pelo ESP32. Pode não retornar linha antes da primeira aplicação. |
| `irrigacao_programada` | PK `id` bigint; FK (configuração, dispositivo) | Horários locais e duração do fallback associado à versão. |
| `calibracoes` | PK `id` bigint; FK dispositivo | Histórico do ADC seco e em água do sensor de solo. |
| `leituras` | PK `id` bigint; único (dispositivo, `mensagem_id`) | Amostras dos sensores, nível, qualidade e horários. |
| `estado_atual` | PK (`dispositivo_id`, `atuador`) | Último estado observado de B1 e B2. |
| `acionamentos` | PK `id` bigint; único (dispositivo, `id_externo`) | Ciclos reais, início, fim, duração e origem. |
| `transicoes_fsm` | PK `id` bigint; FK dispositivo | Mudanças das máquinas de estado de irrigação, névoa e substrato. |
| `eventos` | PK `id` bigint; FK dispositivo | Histórico operacional com contexto em JSON. |
| `tipos_alerta` | PK `codigo` texto | Catálogo dos 20 códigos de alerta. |
| `alertas` | PK `id` bigint; único (dispositivo, `id_externo`) | Episódios: abertura, resolução e reconhecimento pelo operador. |

Relações principais:

```text
usuarios -> sessoes
usuarios <-> dispositivo_usuarios <-> dispositivos
dispositivo + operador + sessao -> comandos -> comando_confirmacoes
comandos -> acionamentos (quando o ciclo nasceu de um comando)
dispositivos -> config_historico -> irrigacao_programada
config_historico -> config_atual (maior versao aplicada)
dispositivos -> leituras / estado_atual / calibracoes
dispositivos -> acionamentos / transicoes_fsm / eventos / alertas
tipos_alerta -> alertas
```

Os detalhes de todas as colunas, defaults e constraints estão em `db/001_schema.sql`; este guia detalha os campos necessários à integração. O cadastro de dispositivo deve existir antes de receber telemetria. Se já houver `bancada-01` cadastrada com `chip_id=simulator:bancada-01`, o backend deve revisar o cadastro e o vínculo antes de associar o hardware real.

## 5. Telemetria: dados que o ESP32 deve enviar

Cada amostra vira uma linha em `leituras`. O backend preenche o UUID do dispositivo e o horário de recebimento; `id` é gerado pelo banco.

| Coluna em `leituras` | Tipo SQL / unidade | Regra |
| --- | --- | --- |
| `mensagem_id` | `text`, obrigatório | Não vazio; único por dispositivo nesta tabela. |
| `ts` | `timestamptz`, aceita NULL | Horário da medição; obrigatório quando `hora_confiavel=true`. |
| `recebido_em` | `timestamptz`, obrigatório | Default `now()`; o ESP32 não fornece esse horário. |
| `hora_confiavel` | `boolean`, obrigatório | Indica se o relógio do dispositivo é confiável. |
| `temp_ar` | `numeric(4,1)`, °C | -10 a 60; pode ser NULL se inválida. |
| `umid_ar` | `numeric(4,1)`, % | 0 a 100; pode ser NULL se inválida. |
| `temp_raiz` | `numeric(4,1)`, °C | -10 a 60; pode ser NULL se inválida. |
| `umid_solo` | `numeric(4,1)`, % | 0 a 100; umidade já convertida/calibrada. |
| `umid_solo_adc` | `integer`, ADC | 0 a 4095; opcional. É recomendável enviá-lo para diagnóstico. |
| `nivel_ok` | `boolean`, obrigatório | `false` para nível baixo ou circuito aberto da boia. Não é percentual de água. |
| `dht_confiavel` | `boolean`, obrigatório | Se `true`, `temp_ar` e `umid_ar` devem estar preenchidos. |
| `raiz_confiavel` | `boolean`, obrigatório | Se `true`, `temp_raiz` deve estar preenchida. |
| `solo_confiavel` | `boolean`, obrigatório | Se `true`, `umid_solo` deve estar preenchida. |

### Exemplo proposto: amostra válida

Tópico: `devices/bancada-01/telemetry`. Os nomes existentes no contrato do app foram reaproveitados; os campos adicionais são uma proposta para completar o mapeamento do banco.

```json
{
  "schemaVersion": 1,
  "deviceId": "bancada-01",
  "messageId": "esp01-boot7-000123",
  "occurredAt": "2026-11-03T15:00:00Z",
  "clockReliable": true,
  "airTemperatureC": 28.4,
  "airHumidityPercent": 62.1,
  "substrateTemperatureC": 24.8,
  "soilMoisturePercent": 66.5,
  "soilMoistureAdc": 1820,
  "waterLevel": "OK",
  "dhtReliable": true,
  "rootReliable": true,
  "soilReliable": true
}
```

Mapeamento: `messageId -> mensagem_id`; `occurredAt -> ts`; `clockReliable -> hora_confiavel`; `airTemperatureC -> temp_ar`; `airHumidityPercent -> umid_ar`; `substrateTemperatureC -> temp_raiz`; `soilMoisturePercent -> umid_solo`; `soilMoistureAdc -> umid_solo_adc`; `waterLevel=OK/LOW -> nivel_ok=true/false`; `dhtReliable/rootReliable/soilReliable -> dht_confiavel/raiz_confiavel/solo_confiavel`.

### Exemplo proposto: sensores e relógio indisponíveis

```json
{
  "schemaVersion": 1,
  "deviceId": "bancada-01",
  "messageId": "esp01-boot8-000001",
  "occurredAt": null,
  "clockReliable": false,
  "airTemperatureC": null,
  "airHumidityPercent": null,
  "substrateTemperatureC": null,
  "soilMoisturePercent": null,
  "soilMoistureAdc": null,
  "waterLevel": "LOW",
  "dhtReliable": false,
  "rootReliable": false,
  "soilReliable": false
}
```

Não enviar `NaN`, infinito, string vazia, -127 ou 85 como valor de falha do DS18B20. Use `null` e qualidade `false`. Não substituir falha por zero nem inventar horário. Se uma leitura antiga for mantida para diagnóstico, marcar sua qualidade como falsa e não utilizá-la como leitura atual válida.

Sem hora confiável, o backend pode exibir `recebido_em`, identificado como horário de recepção. Isso não libera o fallback agendado. A frequência de amostragem/publicação ainda precisa ser combinada; os 15 s documentados são o preset de heartbeat, não um contrato definitivo de amostragem física.

## 6. Calibração do sensor de solo

`calibracoes` guarda `dispositivo_id`, `sensor='solo'`, `adc_seco`, `adc_agua` e `criado_em`, além do `id` automático. Os dois ADCs são inteiros entre 0 e 4095 e precisam ser diferentes.

O modelo suporta somente calibração do sensor de solo. A fórmula de conversão, filtragem, identificação da calibração ativa e protocolo de aplicação ainda precisam ser acordados com o firmware. Não há coluna `calibracao_id` em `leituras`; se for necessária rastreabilidade exata entre amostra e calibração, será preciso evoluir o modelo. Enviar o ADC bruto e o percentual ajuda a verificar a conversão.

## 7. Estado de B1/B2 e histórico de acionamentos

### Estado atual

`estado_atual` tem uma linha por dispositivo/atuador. Campos: `estado_fsm`, `modo`, `ligado`, `modo_iniciado_em`, `expira_em`, `mensagem_id`, `atualizado_em` e `recebido_em`.

`modo` aceita `AUTO`, `MANUAL_ON` e `MANUAL_OFF`. Em AUTO, `expira_em` deve ser NULL. Nos modos manuais, início e expiração são obrigatórios, com expiração posterior ao início. O banco guarda a expiração absoluta; o app calcula a contagem regressiva.

Exemplo proposto no tópico `devices/bancada-01/state`:

```json
{
  "schemaVersion": 1,
  "deviceId": "bancada-01",
  "messageId": "esp01-boot7-000124",
  "occurredAt": "2026-11-03T15:00:01Z",
  "activeConfigVersion": 1,
  "pumps": {
    "B1": {
      "id": "B1",
      "mode": "MANUAL_ON",
      "isOn": true,
      "fsmState": "MANUAL_ON",
      "modeStartedAt": "2026-11-03T15:00:01Z",
      "expiresAt": "2026-11-03T15:02:01Z"
    },
    "B2": {
      "id": "B2",
      "mode": "AUTO",
      "isOn": false,
      "fsmState": "IDLE",
      "modeStartedAt": null,
      "expiresAt": null
    }
  }
}
```

`fsmState` é ilustrativo: o SQL aceita texto não vazio, mas o vocabulário das FSMs precisa ser fechado com o firmware. O backend converte `mode -> modo`, `isOn -> ligado`, `modeStartedAt -> modo_iniciado_em`, `expiresAt -> expira_em` e `occurredAt -> atualizado_em`. `activeConfigVersion` participa da reconciliação da configuração; não há essa coluna em `estado_atual`.

**Enviar ou aceitar comando não altera `ligado`.** Esse valor vem do estado informado pelo ESP32. Se o hardware só conhece a saída do relé e não possui sensor de corrente/fluxo, informar o estado conhecido e registrar essa limitação; não afirmar que existe confirmação independente do bombeamento.

### Acionamentos

`acionamentos` registra `id_externo` do ciclo, `mensagem_id` inicial, `atuador`, `inicio`, `fim`, `origem`, `motivo`, `comando_id` opcional e medições antes/depois (`solo_antes/depois`, `temp_antes/depois`, `ur_antes/depois`).

O ESP32 deve comunicar o início e o fim com o mesmo `cycleId`. Cada mensagem tem seu próprio `messageId`. O backend cria o ciclo no início e atualiza a mesma linha no fim, resolvendo `commandId` para `comando_id` quando houver. Ciclos autônomos podem ter `comando_id=NULL`.

`origem` aceita `auto`, `manual`, `fallback`, `emergencia` e `teste`. `duracao_s` é gerada pelo banco a partir de `fim - inicio`; não deve ser enviada em um INSERT/UPDATE dessa coluna. Antes do fim, duração é NULL. Se um incidente durar além do teto, registrar o tempo observado integralmente; o histórico não deve esconder a falha.

`transicoes_fsm` registra `maquina` (`irrigacao`, `nevoa` ou `substrato`), `de_estado` opcional, `para_estado` obrigatório, `motivo`, `ts`, `mensagem_id` e recebimento.

Exemplo proposto em `devices/bancada-01/events`, para início de ciclo:

```json
{
  "schemaVersion": 1,
  "deviceId": "bancada-01",
  "messageId": "esp01-boot7-000125",
  "occurredAt": "2026-11-03T15:00:01Z",
  "eventType": "cycle_started",
  "cycleId": "ciclo-boot7-0042",
  "pumpId": "B1",
  "origin": "manual",
  "commandId": "cmd-b1-20261103-001"
}
```

Para o término, usar novo `messageId`, `eventType="cycle_finished"`, o mesmo `cycleId` e o horário do fim em `occurredAt`. Esses nomes de evento são propostas de transporte, não valores aceitos diretamente em `eventos.tipo`.

Início/fim de ciclo exigem horários no esquema atual. O procedimento para ciclos ocorridos sem hora confiável precisa ser definido antes da integração: não fabricar horários. Preservar o relato e sua qualidade no histórico operacional é uma alternativa a avaliar até existir um mapeamento apropriado.

## 8. Comandos e confirmações

O backend cria `comandos`, registrando dispositivo, operador, sessão, `id_externo`, `tipo`, `atuador`, duração, payload, criação e validade. O ESP32 recebe o pedido pelo MQTT e publica o resultado.

| Tipo em `comandos` | Bomba | Duração elegível no SQL |
| --- | --- | --- |
| `manual_on` | Obrigatória | B1: 1 a 300 s; B2: 1 a 60 s. Padrão aprovado de B1: 120 s. |
| `manual_off` | Obrigatória | 1 a 3600 s. Comportamento aprovado: expirar após 1 hora. |
| `voltar_auto` | Obrigatória | NULL. |
| `reset_falha` | Obrigatória | NULL. |
| `testar_bomba` | Obrigatória | Exatamente 10 s. |
| `ignorar_boia` | Obrigatória | B1: 1 a 120 s; B2: 1 a 60 s; exige supervisão confirmada. |
| `config` | NULL | NULL; parâmetros no payload/versionamento. |

O contrato HTTP do simulador foi ampliado após a versão original deste guia: oferece `AUTO/MANUAL_ON/MANUAL_OFF/TEST/RESET_FAULT/IGNORE_FLOAT`. O PUT de configuração versiona os parâmetros e a agenda no simulador em memória. Isso ainda não é persistência operacional nem entrega MQTT ao ESP. O formato da integração física é o do contrato MQTT v1 referenciado no início.

### Exemplo proposto de pedido e resposta

Backend publica em `devices/bancada-01/commands`:

```json
{
  "schemaVersion": 1,
  "deviceId": "bancada-01",
  "messageId": "backend-cmd-0001",
  "occurredAt": "2026-11-03T15:00:00Z",
  "commandId": "cmd-b1-20261103-001",
  "pumpId": "B1",
  "action": "MANUAL_ON",
  "createdAt": "2026-11-03T15:00:00Z",
  "expiresAt": "2026-11-03T15:00:10Z",
  "durationSeconds": 120
}
```

ESP32 publica em `devices/bancada-01/acks`:

```json
{
  "schemaVersion": 1,
  "deviceId": "bancada-01",
  "messageId": "esp01-boot7-000126",
  "occurredAt": "2026-11-03T15:00:01Z",
  "commandId": "cmd-b1-20261103-001",
  "status": "accepted",
  "reason": null
}
```

`expiresAt` do pedido é o prazo para aceitar/iniciar o comando. A duração de 120 s define o período manual após o início; a expiração desse modo vai no estado. São dois prazos diferentes.

O backend converte `accepted/rejected/completed -> aceito/rejeitado/concluido`, gravando a mensagem em `comando_confirmacoes`. A tabela tem `comando_id`, `dispositivo_id`, `mensagem_id`, `resultado`, `motivo`, `ocorrido_em` e `recebido_em`.

Ciclo esperado do pedido: `pendente -> enviado -> aceito -> concluido`. Há saídas para `rejeitado` ou `expirado`. O SQL valida campos e alguns estados, mas não implementa sozinho a máquina completa de transições.

O backend precisa preencher `enviado_em` para `enviado`, `confirmado_em` para `aceito/concluido`, `finalizado_em` para estados terminais e `motivo_resultado` não vazio para rejeição. Atualizações relacionadas devem ocorrer em transação.

No ESP32:

1. Validar dispositivo, ação, bomba, prazo, duração e intertravamentos antes de executar.
2. Não executar novamente um `commandId` repetido. Informar o resultado conhecido sem novo acionamento; a política exata de resposta deve ser acordada.
3. Rejeitar comando vencido ou inseguro com motivo. Sem hora confiável, a validação de prazo exige uma política segura a definir; não executar pedido cuja validade não possa ser comprovada.
4. Emitir aceite/recusa, publicar o estado observado e, ao terminar, emitir conclusão e fechamento do ciclo.
5. Não executar pedidos vencidos após reconexão. Uma confirmação tardia é auditada, sem reativar pedido expirado.

## 9. Configuração e agenda de fallback

Cada nova configuração gera uma versão positiva e única por dispositivo em `config_historico`. Uma versão enviada permanece pendente até o ESP32 confirmar sua aplicação. O backend só então preenche `aplicada_no_esp=true` e `aplicada_em`.

Na recusa, preencher `rejeitada_em` e `motivo_rejeicao`, mantendo `aplicada_no_esp=false`. O firmware conserva a última configuração válida. A view `config_atual` seleciona a maior versão aplicada, não a última solicitação criada.

| Campo SQL | Padrão | Faixa / regra |
| --- | --- | --- |
| `solo_min` | 60% | 30 a 80%. |
| `solo_max` | 75% | 50 a 95%; no mínimo `solo_min + 5`. |
| `irrig_max_s` | 300 s | 30 a 300 s. |
| `cooldown_irrig_min` | 10 min | 5 a 30 min. |
| `irrig_max_ciclos_dia` | 20 | 5 a 40 ciclos. |
| `janela_irrig_ativa` | false | Se ativa, início e fim diferentes. |
| `janela_inicio` / `janela_fim` | 06:00 / 17:00 | Horários locais; a semântica de janela que cruza meia-noite precisa ser alinhada. |
| `temp_nevoa_on` | 28 °C | 22 a 40 °C. |
| `histerese_nevoa` | 3 °C | 1 a 6 °C. |
| `ur_min_nevoa` | 50% | 30 a 70%. |
| `ur_trava_nevoa` | 90% | 80 a 98%; não substitui os cortes fixos de segurança. |
| `pulso_nevoa_s` | 60 s | 10 a 60 s. |
| `pausa_nevoa_min` | 5 min | 1 a 30 min. |
| `temp_emergencia` | 35 °C | 30 a 45 °C. |
| `temp_raiz_alerta` | 26 °C | 20 a 35 °C. |
| `bloquear_bombas_sem_agua` | true | Só aceita true. A exceção supervisionada é um comando temporário. |
| `manual_irrig_s` | 120 s | 10 a 300 s. |
| `manual_nevoa_s` | 30 s | 5 a 60 s. |

Esses valores são presets para validação física. São defaults do esquema; não comprovam que uma bancada já foi provisionada com eles.

Outros campos de controle: `versao`, `alterado_por`, `comando_id`, `criado_em`, `aplicada_no_esp`, `aplicada_em`, `rejeitada_em` e `motivo_rejeicao`. Configuração inicial recebida do firmware pode ter autor NULL; alterações do aplicativo devem identificar o operador e, quando associado, o comando do mesmo autor/dispositivo.

Mapeamentos do contrato atual: `soilMinPercent -> solo_min`; `soilMaxPercent -> solo_max`; `fogTemperatureOnC -> temp_nevoa_on`; `fogHumidityMinPercent -> ur_min_nevoa`; `fogHumidityBlockPercent -> ur_trava_nevoa`; `emergencyTemperatureC -> temp_emergencia`; `fogPulseSeconds -> pulso_nevoa_s`; `lowWaterBlocksPumps -> bloquear_bombas_sem_agua`. **`fogPauseSeconds` está em segundos, mas `pausa_nevoa_min` em minutos: 300 s = 5 min.** Validar a conversão sem arredondamento silencioso.

### Agenda

`irrigacao_programada` guarda `configuracao_id`, `dispositivo_id`, `horario_local`, `duracao_s` (1 a 300 s, padrão 60) e `habilitada` (padrão true). O par (configuração, horário) é único. Configuração e agenda precisam ser gravadas juntas em transação.

O fallback sugerido nos documentos é 07:00, 12:00 e 16:00, 60 s, sujeito à validação de bancada. Esses horários não são inseridos automaticamente pelo SQL. A agenda é um fallback para falha do sensor de solo e continua sujeita ao nível de água, limites e contagem diária. Sem hora confiável, suspendê-la e emitir `HORA_INVALIDA`.

O payload versionado da configuração completa, da agenda e de sua confirmação foi definido no contrato MQTT v1. O tipo `Config` atual do app já foi ampliado. Implementar o transporte e persistir a versão aplicada no banco continuam sendo etapas pendentes da integração física.

## 10. Alertas e eventos operacionais

O catálogo `tipos_alerta` define código, severidade padrão, mensagem e ação sugerida. `alertas` guarda uma cópia desses dados em cada episódio, mais `detalhe` JSON, `atuador` opcional, `aberto_em`, `resolvido_em`, `reconhecido_por` e `reconhecido_em`.

Abrir e resolver o mesmo episódio usa o mesmo `episodeId`, com mensagens distintas. Há no máximo um episódio aberto por dispositivo/código/atuador; para alerta geral, `atuador=NULL`. Uma nova ocorrência após resolução usa outro ID.

**Reconhecer significa que o operador tomou ciência.** Somente a resolução da condição preenche `resolvido_em`. A severidade pertence ao episódio e pode mudar, como em `UR_ALTA`.

| Código | Severidade padrão | Significado / observação |
| --- | --- | --- |
| `NIVEL_BAIXO` | critico | Nível baixo ou circuito aberto; bloqueia as bombas. |
| `TEMP_RAIZ_ALTA` | aviso | Substrato acima do limite. |
| `CALOR_EMERG` | critico | Emergência de calor; névoa segue intertravamentos. |
| `GEADA` | aviso | Temperatura do ar abaixo de 5 °C. |
| `UR_ALTA` | aviso | UR elevada por tempo prolongado; pode escalar a crítico. |
| `DHT_FALHA` | critico | DHT22 sem leitura confiável. |
| `DS18_FALHA` | aviso | Temperatura do substrato inválida. |
| `SOLO_FALHA` | critico | Sensor de solo inválido; fallback condicionado. |
| `BOIA_SUSPEITA` | aviso | Comportamento inconsistente da boia. |
| `IRRIG_FALHA` | critico | Três ciclos de irrigação sem efeito. |
| `NEVOA_FALHA` | critico | Três pulsos de névoa sem efeito. |
| `BICO_ENTUPIDO` | aviso | Efeito da névoa abaixo do esperado. |
| `VAZAMENTO_SUSPEITO` | critico | Queda de nível incompatível com a operação. |
| `BOMBA_PRESA` | critico | Suspeita de bomba/relé que não desliga. |
| `BOMBA_TEMPO_EXCEDIDO` | aviso | Limite de operação atingido. |
| `REINICIO` | aviso | Reinício do ESP32. |
| `OFFLINE` | critico | Ausência de comunicação recente. |
| `HORA_INVALIDA` | aviso | Sem hora confiável; fallback suspenso. |
| `CONFIG_INVALIDA` | aviso | Configuração recusada/inválida. |
| `MODO_MANUAL` | info | Modo manual temporizado. |

Exemplo proposto em `devices/bancada-01/events`:

```json
{
  "schemaVersion": 1,
  "deviceId": "bancada-01",
  "messageId": "esp01-boot7-000127",
  "occurredAt": "2026-11-03T15:03:00Z",
  "eventType": "alert_opened",
  "episodeId": "nivel-boot7-0003",
  "code": "NIVEL_BAIXO",
  "severity": "critical",
  "pumpId": null,
  "details": { "waterLevel": "LOW" }
}
```

O backend converte `critical/warning/info -> critico/aviso/info`, busca mensagem e ação no catálogo e cria o episódio. Resolução proposta: novo `messageId`, `eventType="alert_resolved"`, mesmo `episodeId` e instante da resolução. Em cada fechamento, atualizar o episódio e registrar o evento em transação.

`eventos` aceita `tipo=leitura/comando/alerta/mudanca_modo/conexao/reinicio/configuracao/calibracao` e `origem=esp32/operador/backend/simulador`. Seus campos incluem `mensagem_id`, descrição, `detalhes` JSON, `ocorrido_em`, recebimento e usuário opcional; origem operador exige usuário.

`eventType` dos exemplos é um discriminador MQTT proposto e deve ser traduzido. Por exemplo, `alert_opened/alert_resolved` geram `tipo='alerta'`; os ciclos têm sua estrutura própria em `acionamentos`. Se forem necessários vários eventos da mesma mensagem na tabela `eventos`, será preciso definir IDs derivados por subevento: o par (dispositivo, `mensagem_id`) é único nessa tabela. Nunca registrar credenciais ou tokens nos detalhes.

## 11. MQTT, reentrega, presença e ordenação

| Tópico proposto | Quem publica | Destino principal no banco |
| --- | --- | --- |
| `devices/{id}/telemetry` | ESP32 | `leituras`. |
| `devices/{id}/state` | ESP32 | `estado_atual` e reconciliação de configuração. |
| `devices/{id}/events` | ESP32 | `acionamentos`, `transicoes_fsm`, `alertas` e/ou `eventos`, conforme mensagem. |
| `devices/{id}/presence` | ESP32 / Last Will | `dispositivos.online`, `ultimo_contato` e histórico de conexão. |
| `devices/{id}/commands` | Backend | Transporte do pedido já registrado em `comandos`. |
| `devices/{id}/acks` | ESP32 | `comando_confirmacoes` e resultado do comando. |

Usar envelope versionado: `schemaVersion`, `deviceId`, `messageId`, `occurredAt`. O formato final e o tratamento de `occurredAt=null` por tipo de mensagem ainda precisam ser implementados.

Comandos e confirmações: **QoS 1**, com possibilidade de reentrega. Comandos: **retain=false**. QoS/retain dos demais tópicos, TLS, ACLs e limite de payload ainda precisam ser fechados. As credenciais do dispositivo devem restringir seu acesso aos tópicos da própria bancada.

Regras de processamento:

1. `deviceId` do payload deve corresponder ao tópico e à identidade autenticada. Não cadastrar dispositivos desconhecidos automaticamente com base na mensagem.
2. Reentrega conserva `messageId` e conteúdo. Uma nova amostra tem novo ID, mesmo com o mesmo horário. As constraints de deduplicação são por tabela e dispositivo.
3. Mesmo `commandId` com parâmetros diferentes é conflito; não reinterpretar como novo pedido.
4. Mensagens de término/resolução têm novo `messageId` e conservam o ID do ciclo/episódio. Atualizar o registro existente, sem duplicar o histórico.
5. O backend deve evitar que mensagem atrasada sobrescreva estado/configuração mais recente. Definir uma estratégia entre reinícios, por exemplo ID de boot e sequência, antes da integração; esses campos ainda não existem no esquema.
6. Tratar término que chega antes do início, ACK repetido e ACK tardio. As constraints não implementam essa reconciliação automaticamente.

Presets de bancada: heartbeat a cada **15 s**, OFFLINE após **45 s** sem contato e validade de **10 s** para comando manual. Esses tempos são provisórios. Last Will complementa o heartbeat; `online` é um cache, e o backend também deve avaliar `ultimo_contato`.

Após reconexão, publicar estado observado e versão de configuração aplicada. Preservar segurança local e não executar pedidos expirados. A política de buffer offline, sua capacidade e o descarte de mensagens precisam ser definidos com o responsável pelo backend.

## 12. Regras locais de segurança que o banco não executa

| Condição | Comportamento aprovado do ESP32 |
| --- | --- |
| Nível baixo ou circuito aberto | Bloquear B1 e B2. |
| Ignorar boia | Só teste supervisionado, uma bomba por vez; B1 até 120 s, B2 até 60 s, com auditoria do operador. |
| MANUAL_ON B1 | Padrão 120 s; teto físico 300 s. |
| Pulso B2 | Teto físico 60 s, inclusive manual e emergência. |
| MANUAL_OFF | Expira após 1 hora. |
| DHT22 não confiável | Bloquear novos acionamentos de B2 em AUTO e manual; liberar após três leituras válidas consecutivas. |
| Emergência de calor | Pode usar névoa entre UR 90% e 95%, respeitando proteções; cortar imediatamente em UR maior ou igual a 95%. |
| UR acima de 85% por 30 min | Gerar alerta de atenção. |
| UR maior ou igual a 98% por 30 min | Alerta crítico e B2 bloqueada. |
| Sem hora confiável | Suspender fallback agendado e emitir alerta; automação independente de horário pode continuar. |
| Queda de comunicação | Continuar AUTO local com a última configuração válida. |

As faixas do banco validam dados e pedidos; a aplicação precisa impor também as decisões funcionais. Exemplo: o SQL admite `manual_off` entre 1 e 3600 s para armazenar o pedido, mas a regra aprovada de uso é uma hora. Nunca assumir que um INSERT válido equivale a uma operação autorizada ou fisicamente segura.

## 13. Consultas para conferir a integração

Estes SELECTs são para o colega responsável pelo backend/banco ou para acompanhamento de bancada. Não devem ser executados pelo ESP32. São consultas de leitura; não usam credenciais reais neste documento.

Últimas amostras da bancada:

```sql
SELECT l.mensagem_id, l.ts, l.recebido_em, l.hora_confiavel,
       l.temp_ar, l.umid_ar, l.temp_raiz, l.umid_solo,
       l.umid_solo_adc, l.nivel_ok,
       l.dht_confiavel, l.raiz_confiavel, l.solo_confiavel
FROM leituras AS l
JOIN dispositivos AS d ON d.id = l.dispositivo_id
WHERE d.identificador = 'bancada-01'
ORDER BY l.recebido_em DESC, l.id DESC
LIMIT 20;
```

Estado observado das bombas:

```sql
SELECT e.atuador, e.modo, e.ligado, e.estado_fsm,
       e.modo_iniciado_em, e.expira_em, e.recebido_em
FROM estado_atual AS e
JOIN dispositivos AS d ON d.id = e.dispositivo_id
WHERE d.identificador = 'bancada-01';
```

Configuração aplicada e sua agenda:

```sql
SELECT c.*
FROM config_atual AS c
JOIN dispositivos AS d ON d.id = c.dispositivo_id
WHERE d.identificador = 'bancada-01';

SELECT a.horario_local, a.duracao_s, a.habilitada
FROM irrigacao_programada AS a
JOIN config_atual AS c
  ON c.id = a.configuracao_id
 AND c.dispositivo_id = a.dispositivo_id
JOIN dispositivos AS d ON d.id = c.dispositivo_id
WHERE d.identificador = 'bancada-01'
ORDER BY a.horario_local;
```

Resultado de um pedido e alertas ainda abertos:

```sql
SELECT c.id_externo, c.tipo, c.atuador, c.status,
       c.valido_ate, c.confirmado_em, c.motivo_resultado
FROM comandos AS c
JOIN dispositivos AS d ON d.id = c.dispositivo_id
WHERE d.identificador = 'bancada-01'
  AND c.id_externo = 'cmd-b1-20261103-001';

SELECT a.id_externo, a.codigo, a.atuador, a.severidade,
       a.aberto_em, a.reconhecido_em
FROM alertas AS a
JOIN dispositivos AS d ON d.id = a.dispositivo_id
WHERE d.identificador = 'bancada-01'
  AND a.resolvido_em IS NULL
ORDER BY a.aberto_em DESC;
```

## 14. Roteiro para integrar e testar na bancada

1. Backend: conferir o banco e cadastrar o ESP32 com `identificador`, `chip_id` real e vínculo do operador. Confirmar o destino PostgreSQL; Railway é previsto, mas não foi verificado por este guia.
2. Equipe: fechar broker, credenciais, tópicos, versão dos payloads, vocabulário de FSM e política de relógio/ordenação. Os exemplos deste guia são a base de alinhamento.
3. Firmware: publicar uma amostra válida, uma amostra sem sensores e uma amostra sem hora. Backend: validar e persistir em `leituras`.
4. Reenviar a mesma mensagem e confirmar que existe somente uma linha; enviar outra com o mesmo horário e novo ID e confirmar que ambas são preservadas.
5. Publicar estado separado de B1/B2. Conferir que pedido ou ACK de aceite, isoladamente, não liga a bomba no estado armazenado.
6. Enviar comando válido, vencido, repetido e inseguro. Conferir recusa com motivo, temporizador local, conclusão e histórico do ciclo. Testar ACK tardio sem reativação.
7. Aplicar uma configuração válida e rejeitar outra. Confirmar que `config_atual` permanece na última versão efetivamente aplicada; conferir segundos/minutos e agenda associada.
8. Abrir, reconhecer e resolver alerta. Verificar que reconhecimento não encerra o episódio e que a resolução atualiza o mesmo ID.
9. Desconectar a rede e reiniciar o ESP32. Conferir AUTO local, proteções, IDs sem colisão, reconciliação do estado e ausência de execução de comandos vencidos.

### Preparação e verificação do modelo pelo backend

O esquema-base está em `db/001_schema.sql` e o catálogo em `db/002_catalogo_alertas.sql`. A ordem de criação é essa, somente em banco vazio. Para uma base existente, preparar migração específica após inspeção; esses scripts não convertem tabelas existentes.

Para validar o modelo isoladamente, na raiz do projeto:

```powershell
npm.cmd run test:db
```

Os testes usam PostgreSQL em memória via PGlite, sem `DATABASE_URL` e sem acessar o banco da aplicação. O esquema declara compatibilidade com PostgreSQL 17+; a versão do destino deve ser confirmada pelo responsável. Validar o SQL não comprova que MQTT, firmware ou ingestão estejam implementados.

## 15. Arquivos de referência e pendências

Fontes usadas nesta versão:

| Arquivo no repositório | O que consultar |
| --- | --- |
| `db/001_schema.sql` | Todas as colunas, tipos, defaults, FKs, índices, checks e view. |
| `db/002_catalogo_alertas.sql` | Códigos, severidades, mensagens e ações padrão. |
| `db/README.md` | Criação, validação e estado da persistência. |
| `docs/decisoes-aprovadas.md` | Regras de operação e segurança aprovadas. |
| `docs/arquitetura-proposta.md` | Arquitetura, rotas e tópicos MQTT propostos. |
| `docs/revisao-modelo-banco.md` | Mapeamentos, responsabilidades e limites do esquema. |
| `api/src/contracts.ts` | Contratos TypeScript atuais do aplicativo/API simulada. |
| `api/src/app.ts` | Rotas implementadas e uso atual do simulador. |
| `api/scripts/provision-operator.ts` | Provisionamento atual vinculado à bancada simulada. |

Pendências para a integração física: implementar consumidor MQTT e persistência do domínio; fechar payloads e confirmações de configuração; definir ordenação e reconciliação entre reinícios; definir relógio inválido para comandos e ciclos; fechar calibração e sua aplicação; definir buffer offline, TLS/ACLs e parâmetros de conexão. Credenciais reais devem ser entregues por canal próprio, sem anexar os arquivos `.env` ao guia.

Este documento descreve o esquema e o código do repositório. Não foi feita consulta nem alteração no PostgreSQL local ou remoto para produzi-lo.

## Anexo A. Dicionário completo de colunas

Referência extraída do esquema-base em PostgreSQL isolado. Não representa inspeção do banco implantado. `NULL?=não` indica campo obrigatório; `-` indica ausência de default, não ausência de obrigatoriedade. As chaves e regras de uso estão nas seções anteriores; todas as constraints podem ser consultadas em `db/001_schema.sql`.

### acionamentos

| Campo | Tipo SQL | NULL? | Default / geração |
| --- | --- | --- | --- |
| `id` | `bigint` | não | `IDENTITY ALWAYS` |
| `dispositivo_id` | `uuid` | não | - |
| `mensagem_id` | `text` | não | - |
| `id_externo` | `text` | não | - |
| `atuador` | `text` | não | - |
| `inicio` | `timestamp with time zone` | não | - |
| `fim` | `timestamp with time zone` | sim | - |
| `duracao_s` | `numeric` | sim | `GENERATED: EXTRACT(epoch FROM (fim - inicio))` |
| `origem` | `text` | não | - |
| `motivo` | `text` | sim | - |
| `solo_antes` | `numeric` | sim | - |
| `solo_depois` | `numeric` | sim | - |
| `temp_antes` | `numeric` | sim | - |
| `temp_depois` | `numeric` | sim | - |
| `ur_antes` | `numeric` | sim | - |
| `ur_depois` | `numeric` | sim | - |
| `comando_id` | `bigint` | sim | - |

- `FOREIGN KEY (comando_id, dispositivo_id, atuador) REFERENCES comandos(id, dispositivo_id, atuador) ON DELETE RESTRICT`
- `FOREIGN KEY (dispositivo_id) REFERENCES dispositivos(id) ON DELETE RESTRICT`
- `PRIMARY KEY (id)`
- `UNIQUE (dispositivo_id, id_externo)`
- `UNIQUE (dispositivo_id, mensagem_id)`

### alertas

| Campo | Tipo SQL | NULL? | Default / geração |
| --- | --- | --- | --- |
| `id` | `bigint` | não | `IDENTITY ALWAYS` |
| `dispositivo_id` | `uuid` | não | - |
| `mensagem_id` | `text` | não | - |
| `id_externo` | `text` | não | - |
| `codigo` | `text` | não | - |
| `atuador` | `text` | sim | - |
| `severidade` | `text` | não | - |
| `mensagem` | `text` | não | - |
| `acao_sugerida` | `text` | não | - |
| `detalhe` | `jsonb` | não | `'{}'::jsonb` |
| `aberto_em` | `timestamp with time zone` | não | `now()` |
| `resolvido_em` | `timestamp with time zone` | sim | - |
| `reconhecido_por` | `uuid` | sim | - |
| `reconhecido_em` | `timestamp with time zone` | sim | - |

- `FOREIGN KEY (codigo) REFERENCES tipos_alerta(codigo) ON DELETE RESTRICT`
- `FOREIGN KEY (dispositivo_id) REFERENCES dispositivos(id) ON DELETE RESTRICT`
- `FOREIGN KEY (dispositivo_id, reconhecido_por) REFERENCES dispositivo_usuarios(dispositivo_id, usuario_id) ON DELETE RESTRICT`
- `PRIMARY KEY (id)`
- `UNIQUE (dispositivo_id, id_externo)`
- `UNIQUE (dispositivo_id, mensagem_id)`

### calibracoes

| Campo | Tipo SQL | NULL? | Default / geração |
| --- | --- | --- | --- |
| `id` | `bigint` | não | `IDENTITY ALWAYS` |
| `dispositivo_id` | `uuid` | não | - |
| `sensor` | `text` | não | `'solo'::text` |
| `adc_seco` | `integer` | não | - |
| `adc_agua` | `integer` | não | - |
| `criado_em` | `timestamp with time zone` | não | `now()` |

- `FOREIGN KEY (dispositivo_id) REFERENCES dispositivos(id) ON DELETE RESTRICT`
- `PRIMARY KEY (id)`

### comando_confirmacoes

| Campo | Tipo SQL | NULL? | Default / geração |
| --- | --- | --- | --- |
| `id` | `bigint` | não | `IDENTITY ALWAYS` |
| `comando_id` | `bigint` | não | - |
| `dispositivo_id` | `uuid` | não | - |
| `mensagem_id` | `text` | não | - |
| `resultado` | `text` | não | - |
| `motivo` | `text` | sim | - |
| `ocorrido_em` | `timestamp with time zone` | sim | - |
| `recebido_em` | `timestamp with time zone` | não | `now()` |

- `FOREIGN KEY (comando_id, dispositivo_id) REFERENCES comandos(id, dispositivo_id) ON DELETE RESTRICT`
- `PRIMARY KEY (id)`
- `UNIQUE (dispositivo_id, mensagem_id)`

### comandos

| Campo | Tipo SQL | NULL? | Default / geração |
| --- | --- | --- | --- |
| `id` | `bigint` | não | `IDENTITY ALWAYS` |
| `dispositivo_id` | `uuid` | não | - |
| `usuario_id` | `uuid` | não | - |
| `sessao_id` | `uuid` | não | - |
| `id_externo` | `text` | não | - |
| `tipo` | `text` | não | - |
| `atuador` | `text` | sim | - |
| `duracao_s` | `integer` | sim | - |
| `supervisao_confirmada` | `boolean` | não | `false` |
| `payload` | `jsonb` | não | `'{}'::jsonb` |
| `criado_em` | `timestamp with time zone` | não | `now()` |
| `valido_ate` | `timestamp with time zone` | não | `(now() + '00:00:10'::interval)` |
| `enviado_em` | `timestamp with time zone` | sim | - |
| `confirmado_em` | `timestamp with time zone` | sim | - |
| `finalizado_em` | `timestamp with time zone` | sim | - |
| `status` | `text` | não | `'pendente'::text` |
| `motivo_resultado` | `text` | sim | - |

- `FOREIGN KEY (dispositivo_id) REFERENCES dispositivos(id) ON DELETE RESTRICT`
- `FOREIGN KEY (dispositivo_id, usuario_id) REFERENCES dispositivo_usuarios(dispositivo_id, usuario_id) ON DELETE RESTRICT`
- `FOREIGN KEY (sessao_id, usuario_id) REFERENCES sessoes(id, usuario_id) ON DELETE RESTRICT`
- `FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT`
- `PRIMARY KEY (id)`
- `UNIQUE (dispositivo_id, id_externo)`
- `UNIQUE (id, dispositivo_id, atuador)`
- `UNIQUE (id, dispositivo_id)`
- `UNIQUE (id, dispositivo_id, usuario_id)`

### config_historico

| Campo | Tipo SQL | NULL? | Default / geração |
| --- | --- | --- | --- |
| `id` | `bigint` | não | `IDENTITY ALWAYS` |
| `dispositivo_id` | `uuid` | não | - |
| `versao` | `integer` | não | - |
| `solo_min` | `numeric` | não | `60` |
| `solo_max` | `numeric` | não | `75` |
| `irrig_max_s` | `integer` | não | `300` |
| `cooldown_irrig_min` | `integer` | não | `10` |
| `irrig_max_ciclos_dia` | `integer` | não | `20` |
| `janela_irrig_ativa` | `boolean` | não | `false` |
| `janela_inicio` | `time without time zone` | não | `'06:00:00'::time without time zone` |
| `janela_fim` | `time without time zone` | não | `'17:00:00'::time without time zone` |
| `temp_nevoa_on` | `numeric` | não | `28` |
| `histerese_nevoa` | `numeric` | não | `3` |
| `ur_min_nevoa` | `numeric` | não | `50` |
| `ur_trava_nevoa` | `numeric` | não | `90` |
| `pulso_nevoa_s` | `integer` | não | `60` |
| `pausa_nevoa_min` | `integer` | não | `5` |
| `temp_emergencia` | `numeric` | não | `35` |
| `temp_raiz_alerta` | `numeric` | não | `26` |
| `bloquear_bombas_sem_agua` | `boolean` | não | `true` |
| `manual_irrig_s` | `integer` | não | `120` |
| `manual_nevoa_s` | `integer` | não | `30` |
| `alterado_por` | `uuid` | sim | - |
| `comando_id` | `bigint` | sim | - |
| `aplicada_no_esp` | `boolean` | não | `false` |
| `aplicada_em` | `timestamp with time zone` | sim | - |
| `rejeitada_em` | `timestamp with time zone` | sim | - |
| `motivo_rejeicao` | `text` | sim | - |
| `criado_em` | `timestamp with time zone` | não | `now()` |

- `FOREIGN KEY (comando_id, dispositivo_id, alterado_por) REFERENCES comandos(id, dispositivo_id, usuario_id) ON DELETE RESTRICT`
- `FOREIGN KEY (dispositivo_id, alterado_por) REFERENCES dispositivo_usuarios(dispositivo_id, usuario_id) ON DELETE RESTRICT`
- `FOREIGN KEY (dispositivo_id) REFERENCES dispositivos(id) ON DELETE RESTRICT`
- `PRIMARY KEY (id)`
- `UNIQUE (dispositivo_id, versao)`
- `UNIQUE (id, dispositivo_id)`

### dispositivo_usuarios

| Campo | Tipo SQL | NULL? | Default / geração |
| --- | --- | --- | --- |
| `dispositivo_id` | `uuid` | não | - |
| `usuario_id` | `uuid` | não | - |
| `ativo` | `boolean` | não | `true` |
| `vinculado_em` | `timestamp with time zone` | não | `now()` |

- `FOREIGN KEY (dispositivo_id) REFERENCES dispositivos(id) ON DELETE RESTRICT`
- `FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT`
- `PRIMARY KEY (dispositivo_id, usuario_id)`

### dispositivos

| Campo | Tipo SQL | NULL? | Default / geração |
| --- | --- | --- | --- |
| `id` | `uuid` | não | `gen_random_uuid()` |
| `identificador` | `text` | não | - |
| `nome` | `text` | não | - |
| `chip_id` | `text` | não | - |
| `fuso_horario` | `text` | não | `'America/Sao_Paulo'::text` |
| `fw_versao` | `text` | sim | - |
| `ultimo_contato` | `timestamp with time zone` | sim | - |
| `online` | `boolean` | não | `false` |
| `criado_em` | `timestamp with time zone` | não | `now()` |

- `PRIMARY KEY (id)`
- `UNIQUE (chip_id)`
- `UNIQUE (identificador)`

### estado_atual

| Campo | Tipo SQL | NULL? | Default / geração |
| --- | --- | --- | --- |
| `dispositivo_id` | `uuid` | não | - |
| `atuador` | `text` | não | - |
| `estado_fsm` | `text` | não | - |
| `modo` | `text` | não | - |
| `ligado` | `boolean` | não | - |
| `modo_iniciado_em` | `timestamp with time zone` | sim | - |
| `expira_em` | `timestamp with time zone` | sim | - |
| `mensagem_id` | `text` | não | - |
| `atualizado_em` | `timestamp with time zone` | sim | - |
| `recebido_em` | `timestamp with time zone` | não | `now()` |

- `FOREIGN KEY (dispositivo_id) REFERENCES dispositivos(id) ON DELETE RESTRICT`
- `PRIMARY KEY (dispositivo_id, atuador)`

### eventos

| Campo | Tipo SQL | NULL? | Default / geração |
| --- | --- | --- | --- |
| `id` | `bigint` | não | `IDENTITY ALWAYS` |
| `dispositivo_id` | `uuid` | não | - |
| `mensagem_id` | `text` | não | - |
| `usuario_id` | `uuid` | sim | - |
| `tipo` | `text` | não | - |
| `origem` | `text` | não | - |
| `descricao` | `text` | não | - |
| `detalhes` | `jsonb` | não | `'{}'::jsonb` |
| `ocorrido_em` | `timestamp with time zone` | sim | - |
| `recebido_em` | `timestamp with time zone` | não | `now()` |

- `FOREIGN KEY (dispositivo_id) REFERENCES dispositivos(id) ON DELETE RESTRICT`
- `FOREIGN KEY (dispositivo_id, usuario_id) REFERENCES dispositivo_usuarios(dispositivo_id, usuario_id) ON DELETE RESTRICT`
- `PRIMARY KEY (id)`
- `UNIQUE (dispositivo_id, mensagem_id)`

### irrigacao_programada

| Campo | Tipo SQL | NULL? | Default / geração |
| --- | --- | --- | --- |
| `id` | `bigint` | não | `IDENTITY ALWAYS` |
| `configuracao_id` | `bigint` | não | - |
| `dispositivo_id` | `uuid` | não | - |
| `horario_local` | `time without time zone` | não | - |
| `duracao_s` | `integer` | não | `60` |
| `habilitada` | `boolean` | não | `true` |

- `FOREIGN KEY (configuracao_id, dispositivo_id) REFERENCES config_historico(id, dispositivo_id) ON DELETE RESTRICT`
- `PRIMARY KEY (id)`
- `UNIQUE (configuracao_id, horario_local)`

### leituras

| Campo | Tipo SQL | NULL? | Default / geração |
| --- | --- | --- | --- |
| `id` | `bigint` | não | `IDENTITY ALWAYS` |
| `dispositivo_id` | `uuid` | não | - |
| `mensagem_id` | `text` | não | - |
| `ts` | `timestamp with time zone` | sim | - |
| `recebido_em` | `timestamp with time zone` | não | `now()` |
| `hora_confiavel` | `boolean` | não | - |
| `temp_ar` | `numeric(4,1)` | sim | - |
| `umid_ar` | `numeric(4,1)` | sim | - |
| `temp_raiz` | `numeric(4,1)` | sim | - |
| `umid_solo` | `numeric(4,1)` | sim | - |
| `umid_solo_adc` | `integer` | sim | - |
| `nivel_ok` | `boolean` | não | - |
| `dht_confiavel` | `boolean` | não | - |
| `raiz_confiavel` | `boolean` | não | - |
| `solo_confiavel` | `boolean` | não | - |

- `FOREIGN KEY (dispositivo_id) REFERENCES dispositivos(id) ON DELETE RESTRICT`
- `PRIMARY KEY (id)`
- `UNIQUE (dispositivo_id, mensagem_id)`

### sessoes

| Campo | Tipo SQL | NULL? | Default / geração |
| --- | --- | --- | --- |
| `id` | `uuid` | não | `gen_random_uuid()` |
| `usuario_id` | `uuid` | não | - |
| `token_hash` | `text` | não | - |
| `criado_em` | `timestamp with time zone` | não | `now()` |
| `expira_em` | `timestamp with time zone` | não | `(now() + '08:00:00'::interval)` |
| `revogado_em` | `timestamp with time zone` | sim | - |
| `motivo_revogacao` | `text` | sim | - |

- `FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT`
- `PRIMARY KEY (id)`
- `UNIQUE (id, usuario_id)`
- `UNIQUE (token_hash)`

### tipos_alerta

| Campo | Tipo SQL | NULL? | Default / geração |
| --- | --- | --- | --- |
| `codigo` | `text` | não | - |
| `severidade` | `text` | não | - |
| `mensagem` | `text` | não | - |
| `acao_sugerida` | `text` | não | - |

- `PRIMARY KEY (codigo)`

### transicoes_fsm

| Campo | Tipo SQL | NULL? | Default / geração |
| --- | --- | --- | --- |
| `id` | `bigint` | não | `IDENTITY ALWAYS` |
| `dispositivo_id` | `uuid` | não | - |
| `mensagem_id` | `text` | não | - |
| `maquina` | `text` | não | - |
| `de_estado` | `text` | sim | - |
| `para_estado` | `text` | não | - |
| `motivo` | `text` | sim | - |
| `ts` | `timestamp with time zone` | sim | - |
| `recebido_em` | `timestamp with time zone` | não | `now()` |

- `FOREIGN KEY (dispositivo_id) REFERENCES dispositivos(id) ON DELETE RESTRICT`
- `PRIMARY KEY (id)`
- `UNIQUE (dispositivo_id, mensagem_id)`

### usuarios

| Campo | Tipo SQL | NULL? | Default / geração |
| --- | --- | --- | --- |
| `id` | `uuid` | não | `gen_random_uuid()` |
| `usuario` | `text` | não | - |
| `nome` | `text` | não | - |
| `email` | `text` | sim | - |
| `senha_hash` | `text` | não | - |
| `ativo` | `boolean` | não | `true` |
| `criado_em` | `timestamp with time zone` | não | `now()` |
| `atualizado_em` | `timestamp with time zone` | não | `now()` |
| `senha_alterada_em` | `timestamp with time zone` | não | `now()` |

- `PRIMARY KEY (id)`

### config_atual (view)

Retorna as mesmas colunas de `config_historico`, filtrando `aplicada_no_esp=true` e escolhendo a maior `versao` por dispositivo. Não recebe INSERT/UPDATE do firmware. A agenda é consultada separadamente em `irrigacao_programada`.
