# Contrato ESP32 ↔ backend — PIEVI MQTT v1

Este é o contrato de implementação para o firmware e a integração MQTT da API. Substitui os exemplos MQTT propostos no guia de 03/11. A API já implementa o transporte MQTT e a persistência; os modos de execução são descritos no [ambiente integrado](ambiente-integrado.md). Para instalar no notebook após clone e testar com hardware, siga o [guia presencial](../GUIA-TESTE-ESP-FISICO.md). A validação de sensores, relés e firmware real permanece pendente do ensaio físico.

Este texto fixa as regras do protocolo. Referências históricas à evolução do banco devem ser lidas junto à [persistência implementada](persistencia-postgresql.md), que documenta a migração 004 já disponível.

Os payloads completos estão em [protocol/mqtt/v1/examples](../protocol/mqtt/v1/examples/index.json). O [schema JSON](../protocol/mqtt/v1/schema.json) verifica estrutura, tipos, faixas e campos obrigatórios. O validador `api/src/mqtt/protocol.ts` acrescenta relações entre campos. Firmware e handlers precisam também cumprir as regras de sessão e segurança deste texto.

## 1. Fluxo e responsabilidades

```text
Sensores/relés ↔ ESP32 ↔ broker MQTT ↔ API ↔ PostgreSQL
                                      ↕
                                     App
```

A pasta `api` é o backend do app e também contém o cliente MQTT. O ESP não recebe `DATABASE_URL`, token do operador nem senha do PostgreSQL. O ESP autentica no broker com credenciais próprias e só acessa os tópicos de sua bancada. O backend valida o dispositivo já provisionado; mensagens não criam dispositivos automaticamente.

O firmware mede, calibra, executa AUTO, protege os atuadores e responde aos pedidos. O backend autoriza pedidos do app, registra autor/sessão, publica comandos, persiste mensagens e apresenta o estado informado. O app consulta a API. Aceitar um comando não é confirmação de saída ligada.

## 2. Transporte

Perfil de bancada: MQTT **3.1.1**, JSON UTF-8, QoS **1** em todos os tópicos, payload máximo **32 KiB**, bancada inicial `bancada-01`. O protocolo admite reentrega, portanto os IDs abaixo são obrigatórios. As propriedades de QoS, retain, sessões e Last Will seguem a [especificação OASIS MQTT 3.1.1](https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/os/mqtt-v3.1.1-os.html).

| Tópico | Publicador → assinante | Retain | Uso |
| --- | --- | --- | --- |
| `pievi/v1/devices/{deviceId}/telemetry` | ESP → API | false | Amostra de sensores |
| `pievi/v1/devices/{deviceId}/state` | ESP → API | false | Estado completo observado e sincronização |
| `pievi/v1/devices/{deviceId}/events` | ESP → API | false | Ciclo, alerta, FSM e calibração |
| `pievi/v1/devices/{deviceId}/acks` | ESP → API | false | Resultado de comando |
| `pievi/v1/devices/{deviceId}/presence` | ESP/broker → API | true | Conexão e Last Will |
| `pievi/v1/devices/{deviceId}/commands` | API → ESP | false | Pedido de atuação ou configuração |
| `pievi/v1/devices/{deviceId}/sync` | API → ESP | false | Desafio para obter estado atual |
| `pievi/v1/devices/{deviceId}/receipts` | API → ESP | false | Confirmação da persistência de uma mensagem |

Os tópicos antigos `devices/...` são exemplos legados e não serão aceitos pelo adaptador v1. O ESP só publica nos cinco primeiros tópicos e só assina `commands`, `sync` e `receipts`; a API recebe as permissões inversas. A identidade autenticada no broker deve corresponder ao `deviceId` do tópico e do JSON.

Client ID do ESP: `pievi-esp-{deviceId}`; uma única instância por bancada. Client ID da API de bancada: `pievi-api-local`; uma única instância desse ambiente. ESP usa **cleanSession=true**, evitando fila de comandos durante desconexão. API usa **cleanSession=false**, com sessão persistente no broker; limites de fila e armazenamento serão configurados no ambiente. Duplicidade de client IDs em duas máquinas não é suportada.

Keep Alive: **30 s**. Telemetria e estado completo: **a cada 15 s**, com novo `messageId`, mesmo sem mudança. Estado também é enviado imediatamente após alterar saída, modo, proteção, configuração ou alertas. Eventos e ACKs são imediatos. A aquisição e o controle local devem respeitar os sensores e temporizadores físicos; publicação não é o relógio de controle.

Comandos e sync têm validade de no máximo **10 s**. Backend considera sem estado recente após **45 s**. Esse perfil é o ponto inicial de bancada, sujeito aos ensaios físicos. LWT não substitui esse prazo.

## 3. Identidade, relógio e reentrega

Mensagens de telemetria, estado, eventos e ACKs possuem:

| Campo | Regra |
| --- | --- |
| `schemaVersion` | Inteiro fixo `1` |
| `type` | `telemetry`, `state`, `event` ou `ack`, coerente com o tópico |
| `deviceId` | Slug de 1–63 caracteres: minúsculas, números e hífen; igual ao provisionamento |
| `bootNumber` | Inteiro 1–2147483647, incrementado e persistido em NVS antes de cada inicialização operacional |
| `bootId` | UUID v4 minúsculo, novo a cada boot; não muda ao reconectar Wi-Fi/MQTT |
| `connectionId` | UUID v4 novo a cada conexão MQTT |
| `sequence` | Inteiro 1–2147483647, incrementado para cada nova mensagem desses quatro tópicos, compartilhado entre eles |
| `messageId` | Exatamente `{bootId}:{sequence}` |
| `uptimeMs` | Inteiro monotônico em ms desde o boot; usar contador estendido, sem voltar a zero no wrap de `millis()` |
| `clockReliable` | Booleano: relógio UTC confiável para os eventos atuais |
| `occurredAt` | UTC `YYYY-MM-DDTHH:mm:ssZ` ou com `.sss`; obrigatório quando confiável e `null` quando não confiável |

Não usar nomes de sensores ou endereços MAC como IDs de mensagem. Reenvio mantém tópico, envelope e conteúdo idênticos, inclusive `connectionId` original. Não aumentar `sequence` para uma reentrega. Ao esgotar o contador de sequência, iniciar novo boot controlado com novo `bootNumber` e `bootId`; nunca reutilizar IDs. Não zerar NVS para “resolver” uma rejeição: reset/factory flash que perde o contador requer reprovisionamento explícito no backend. Mesmo `bootNumber` com outro `bootId` é conflito, e número inferior ao já conhecido não pode assumir a sessão atual.

O backend registra recebimento separadamente, deduplica por dispositivo + `messageId` e detecta reutilização com conteúdo diferente. O hash deve usar representação JSON canônica, sem depender da ordem das chaves. Não ordenar recebimento somente por relógio UTC. Checkpoints por fluxo evitam que estado antigo sobrescreva o atual; a sequência global identifica mensagens, mas um evento atrasado não deve impedir a ingestão de outra categoria.

Sem UTC confiável, não inventar `occurredAt`. A API poderá apresentar horário de recebimento, explicitamente identificado. Instantes conhecidos de início de ciclos/alertas podem continuar preenchidos mesmo que o relógio tenha perdido qualidade depois; instantes desconhecidos ficam `null`.

## 4. Presença e sincronização do estado atual

`presence` tem formato próprio: versão, tipo, dispositivo, `bootId`, `bootNumber`, `connectionId`, `online`. Não possui timestamp nem sequência, pois o Last Will é montado antes de uma eventual queda. Registrar no CONNECT o payload offline com QoS 1 e retain=true; após conectar, publicar online com a mesma identidade da conexão e retain=true. Antes de desconexão voluntária, publicar offline e só então desconectar.

**Presence online retido não comprova que o ESP está online agora.** Ele é apenas um indício para iniciar a sincronização. Presence offline só invalida a conexão com o mesmo `connectionId`; um Will atrasado de outra conexão não derruba a atual.

Handshake obrigatório:

1. API conecta/retoma MQTT e assina os tópicos. Ao iniciar ou detectar conexão ainda não sincronizada, publica `sync` com `syncId` UUID v4, criação e validade de até 10 s.
2. ESP responde imediatamente com um `state` novo contendo esse `syncId` e o estado atual completo. Pode responder mesmo sem hora confiável; sync nunca atua uma saída.
3. API só assume a sessão como atual ao receber o desafio pendente correspondente, dentro do prazo de recebimento, para dispositivo autorizado e boot não anterior ao checkpoint persistido. Desafios são de uso único. A resposta estabelece o `connectionId` atual e o checkpoint de sequência de estado.
4. Demais estados/telemetrias dessa sessão, com sequências novas em seus respectivos fluxos, renovam a comunicação. Duplicatas, mensagens de conexão anterior e replay de histórico não renovam a presença nem substituem estado.
5. Após 45 s sem comunicação nova válida, invalidar a sessão para comandos e gerar OFFLINE no backend. Exigir novo sync para recuperá-la. Ao reiniciar a API, repetir o handshake; não liberar atuação só porque existem dados no banco ou na fila do broker.

Um novo `presence` não deve substituir sozinho boot/checkpoint. Mensagens antigas podem alimentar o histórico após deduplicação; não podem promover o dispositivo a online. O marcador retain recebido identifica replay retido, mas a implementação também deve obedecer ao retain=false na publicação dos demais tópicos.

## 5. Telemetria e calibração

Campos: `airTemperatureC`, `airHumidityPercent`, `substrateTemperatureC`, `soilMoisturePercent`, `soilMoistureAdc`, `waterLevel`, `dhtReliable`, `rootReliable`, `soilReliable`, `activeCalibrationId`, mais o envelope.

Temperaturas: -10 a 60 °C; umidades: 0–100%; precisão publicada de uma casa decimal. ADC: inteiro 0–4095 ou null. Números não carregam unidade, vírgula decimal ou texto. `waterLevel` é `OK` ou `LOW`; circuito aberto da boia equivale a LOW. Não é percentual do reservatório.

Qualidade falsa exige `null` nos respectivos valores; qualidade verdadeira exige números válidos. Nunca enviar NaN, infinito, -127, 85 como sentinela do DS18B20 ou zero fabricado. Durante as três leituras de recuperação do DHT, qualidade permanece falsa e valores publicados permanecem null até a liberação. Solo confiável exige `activeCalibrationId` não nulo.

O evento de calibração informa `calibrationId` UUID, `adcDry` e `adcWater`, distintos, ambos 0–4095. Referência v1: `percent = clamp(100 * (adcDry - adcAtual) / (adcDry - adcWater), 0, 100)`, arredondado a uma casa. Funciona nas duas polaridades do ADC; sua estabilidade física ainda deve ser ensaiada. Publicar o evento antes da primeira amostra que usa essa calibração. Se o backend ainda não a recebeu, preserva a mensagem e sinaliza a referência pendente; não descarta o ADC nem marca o solo como calibrado por conta própria. Sem calibração válida, publicar solo não confiável.

## 6. Estado completo

`state` inclui `syncId` UUID ou null, `firmwareVersion`, `droppedMessages`, `activeConfigVersion`, `pumps.B1`, `pumps.B2` e `activeAlerts`. Versão `0` significa configuração de fábrica sem versão do backend; não pode ser mostrada como configuração aplicada do operador. Nesse estado, o backend permite enviar a primeira configuração, mas bloqueia pedidos remotos de atuação até confirmar a versão 1 ou superior. AUTO local segue os presets embarcados e as proteções.

Cada bomba contém `mode`, `isOn`, `fsmState`, `modeStartedAt`, `expiresAt`, `remainingSeconds`, `blockedReason`, `faultCode`, `floatOverrideUntil` e `feedback`.

- Modos: AUTO / MANUAL_ON / MANUAL_OFF. AUTO possui todos os campos de temporizador manual null; pode estar ligada ou desligada conforme a automação.
- Modos manuais possuem início UTC, expiração UTC e segundos restantes inteiros. Acionamento B1 até 300 s e B2 até 60 s; MANUAL_OFF até uma hora. O ESP usa contador monotônico para cortar a saída; nunca depende do app para desligar.
- Se perder hora confiável, o perfil v1 encerra os modos manuais, desliga a saída e retorna a AUTO, que continua sujeita às proteções. A agenda de reserva é suspensa; automação por sensores pode continuar ignorando a janela de horário.
- `floatOverrideUntil` identifica exclusivamente o teste supervisionado ativo, limitado ao prazo do manual, a 120 s em B1 e 60 s em B2.
- `feedback=relay_output` significa estado conhecido da saída de controle do relé. `independent_sensor` só pode ser usado se existir medição independente implementada e validada. Não afirmar fluxo de água confirmado sem sensor apropriado.
- FSM de bomba: IDLE, RUNNING, PAUSED, MANUAL_ON, MANUAL_OFF, BLOCKED ou FAULT. `blockedReason` é texto ou null; falhas conhecidas de bomba são IRRIG_FALHA, NEVOA_FALHA ou BOMBA_PRESA.

O backend não deve descartar um estado observado só porque ele denuncia uma proteção que falhou: saída ligada com ordem de desligamento, por exemplo, precisa gerar evidência e tratamento de falha. Intertravamentos são obrigação do firmware; o validador de estado não fabrica uma saída desligada.

`activeAlerts` é uma lista completa dos episódios locais ainda ativos, incluindo código, episódio, severidade, bomba ou null, início conhecido ou null e detalhe. Não contém OFFLINE, que pertence ao backend. No estado novo confirmado, a lista permite reconciliar resoluções perdidas durante desconexão. Um mesmo par código+bomba só tem um episódio ativo. O cursor de alertas considera a sequência de estados e eventos de alerta; um evento mais antigo que o snapshot já aplicado é histórico e não reabre uma condição encerrada.

## 7. Comandos e confirmação

Backend publica `command` com `messageId` UUID v4, `commandId` estável de 8–100 caracteres (letras, números, `_`, `-`, `:`), `createdAt`, `expiresAt`, `targetBootId`, `targetBootNumber` e `targetConnectionId`. Os três alvos precisam coincidir com a sessão sincronizada do ESP. A API normaliza o pedido do app para este formato completo.

| Ação | pumpId | durationSeconds | supervisionConfirmed |
| --- | --- | --- | --- |
| MANUAL_ON | B1/B2 | 1–300 / 1–60 | false |
| MANUAL_OFF | B1/B2 | 3600 | false |
| TEST | B1/B2 | 10 | false |
| AUTO | B1/B2 | null | false |
| RESET_FAULT | B1/B2 | null | false |
| IGNORE_FLOAT | B1/B2 | 1–120 / 1–60 | true |
| APPLY_CONFIG | null | null | false |

O prazo é para aceitar/iniciar, não para completar o ciclo. Comando recebido após a expiração, com alvo diferente, JSON inválido ou proteção impedindo atuação é recusado. Sem hora confiável, ESP recusa todo comando, incluindo configuração; sync continua permitido para informar essa situação. A API só envia atuação após sessão e configuração aplicadas estarem reconciliadas.

Manter deduplicação de `commandId` durante todo o boot, inclusive entre reconexões. Repetição idêntica retorna o resultado conhecido e não religa nem estende temporizador; mesmo ID com conteúdo diferente é conflito e nunca atua. Após reboot, a identificação do alvo impede executar comandos antigos, mesmo que a memória de comandos tenha sido perdida. API não republica pedidos de atuação pendentes após seu próprio reinício. Novos pedidos precisam de nova autorização do operador e sessão sincronizada.

`ack` informa `commandId`, `status=accepted/rejected/completed`, `reason` texto ou null e `appliedConfigVersion` inteiro ou null. Rejeição exige motivo. Prazo vencido é `rejected` no ESP, com motivo; o backend pode manter seu próprio estado `expirado` no comando. ACK sem commandId conhecido é auditado e não cria um pedido autorizado.

Sequência normal: pedido registrado → publicação → accepted → estado/ciclo → completed. AUTO e RESET_FAULT podem responder completed diretamente. Conclusão pode chegar antes do aceite por reentrega/atraso: nunca regredir estado terminal para aceito. Aceite tardio de comando já expirado é auditado e não o reativa. Uma conclusão após os 10 s é normal para um ciclo aceito no prazo.

`completed` significa que o tratamento do comando terminou; `reason` explica interrupção, proteção, substituição ou término natural. O estado observado e os ciclos mostram o que aconteceu. Um ACK nunca modifica `isOn` sozinho.

O backend preserva a autoria do operador e da sessão no banco; esses dados não são necessários no payload do ESP. Supervisão só pode ser confirmada pela ação explícita do operador no app. IGNORE_FLOAT permite uma única bomba, respeita os demais bloqueios e não prorroga tetos contínuos.

## 8. Configuração versionada

APPLY_CONFIG carrega `configVersion` positivo, `timeZone=America/Sao_Paulo` e o objeto `config` completo, sem campos desconhecidos. Chaves e faixas são as de `Config`/`CONFIG_FIELDS` no projeto e aparecem integralmente no exemplo `command-config.json`. O esquema JSON descreve cada uma; o validador também confere histerese do solo, janela e duplicação de horários.

Agenda: até 24 entradas `{ time: "HH:mm", durationSeconds: 1..300, enabled: boolean }`, sem horários duplicados, mesmo desabilitados. É fallback apenas com sensor de solo inválido há mais de 60 s e relógio confiável. Não executar horários perdidos; respeitar água, janela, pausa e máximo diário. Salvar configuração não zera a contagem do dia.

`fogPauseSeconds` usa múltiplos de 60 entre 60 e 1800. Backend divide por 60 para `pausa_nevoa_min`; nunca arredonda silenciosamente. Os tetos físicos e o corte de emergência em UR ≥95% continuam fixos mesmo se o limite normal de UR configurado for maior.

ESP valida e aplica a versão inteira de forma atômica, salva configuração e versão em NVS, emite ACK completed com `appliedConfigVersion` e publica state com a mesma `activeConfigVersion`. ACK accepted de configuração ainda não a torna aplicada. Não aplicar parte da agenda. Versão mais baixa é recusada; versão igual com conteúdo diferente é conflito; versão igual e conteúdo idêntico é repetição sem efeito.

Backend registra a versão solicitada antes da publicação. Só marca a versão aplicada após confirmação compatível com pedido e versão. Estado pode reconciliar uma confirmação perdida somente se a versão e conteúdo esperado já foram registrados pelo backend; número desconhecido exige investigação, não aprovação automática. Sem resposta, manter a configuração anterior como aplicada e o pedido pendente/expirado conforme o caso.

## 9. Eventos autossuficientes

Um JSON por evento, com seu próprio messageId. Não enviar lotes dentro de `events`.

| eventType | Identidade e dados | Destino lógico |
| --- | --- | --- |
| cycle | cycleId UUID, phase started/finished, B1/B2, source, commandId ou null, motivo, início/fim conhecidos, duração monotônica, medições antes/depois | acionamentos + histórico da bomba |
| alert | episodeId UUID, phase opened/updated/resolved, código, bomba ou null, severidade, detalhe, início/fim conhecidos | alertas + eventos |
| fsm_transition | machine irrigation/fog/substrate, fromState ou null, toState, motivo | transicoes_fsm |
| calibration | calibrationId UUID, adcDry, adcWater | calibracoes + eventos |

Ciclo: `source=auto/manual/fallback/emergency/test`; manual e test exigem commandId e os demais usam null. Início tem fim, elapsedSeconds e measurementsAfter null. Término repete os dados iniciais, inclui elapsedSeconds monotônico e medições finais (cada valor pode ser null). Assim o backend consegue registrar o término antes do início. Mesma cycleId atualiza a mesma linha; um início atrasado não apaga o fim. Duração observada acima do teto é preservada como incidente, nunca truncada nem ocultada por rejeição de histórico.

Alerta: usar os códigos do catálogo SQL. OFFLINE é emitido apenas pelo backend. Severidades MQTT `critical/warning/info` mapeiam para `critico/aviso/info`. Textos de título e orientação vêm do catálogo; `detail` acrescenta contexto do ESP, sem credenciais. Uma atualização pode elevar a severidade do mesmo episódio, como UR_ALTA. Resolução repete os dados necessários para registrar um episódio cuja abertura não chegou. Reconhecimento pertence ao app/backend; firmware não resolve uma condição porque o operador a reconheceu. Condição reaparecida gera novo episodeId.

FSM: irrigation/fog usam o vocabulário de bombas da seção 6; substrate usa NORMAL/HIGH/SENSOR_FAULT. A calibração e eventos operacionais usam o mesmo envelope e não comandam saídas.

## 10. Falha de rede e segurança local

Sem conexão, manter AUTO com última configuração válida e proteções locais. B1 até 300 s, B2 até 60 s contínuos; comandos repetidos não renovam esses tetos. Falta de água/circuito aberto bloqueia as duas, salvo o teste supervisionado temporizado já descrito. DHT inválido bloqueia B2 até três leituras válidas. Emergência de calor só permite névoa abaixo de 95% UR. Preservar pausa e contagem diária.

Perfil inicial do buffer do ESP: até 32 mensagens de eventos/ACKs ou 64 KiB, o que ocorrer primeiro; descartar a mais antiga ao exceder e incrementar `droppedMessages` desde o boot. Telemetria e estado mantêm só o payload mais recente de cada tópico. O buffer é de RAM e não garante histórico durante queda de energia. Publicar primeiro estado novo de sincronização e depois o buffer, preservando IDs e conexão de origem. Histórico atrasado não renova o estado atual. Estado completo de alertas auxilia a recuperação; não inventar ciclos perdidos.

Para telemetria, estado, eventos e ACKs, retirar uma mensagem da fila somente após recibo da API, não após PUBACK do broker. Enquanto conectado, reenviar pendências a cada 5 s com o mesmo conteúdo. Sem conexão, aguardar reconexão, sem loop de publicação. Estado/telemetria novos substituem a pendência anterior do mesmo tópico; eventos/ACKs preservam a fila limitada descrita acima.

`receipts` carrega `type=receipt`, UUID próprio em messageId, sourceMessageId, sourceBootId, sourceBootNumber, processedAt UTC, status e motivo. `stored` só é publicado depois do COMMIT da ingestão; `duplicate` só quando o mesmo conteúdo já foi processado e gravado; ambos liberam o item correspondente do buffer. `rejected` exige motivo e indica rejeição definitiva de uma mensagem estruturalmente válida; retirar esse item, registrar diagnóstico e corrigir a causa. Um recibo não atua saídas e não é um ACK de comando. Não emitir recibos de recibos ou presença. Recibos sem correspondência na fila são ignorados. Erro transitório de banco não produz stored/duplicate/rejected: manter pendência para reentrega. Payload sem envelope válido ou dispositivo não autorizado é descartado com diagnóstico, sem responder a uma identidade não comprovada.

Na inicialização, configurar relés em condição segura antes de conectar rede. Inspecionar o nível lógico de acionamento dos módulos reais; o contrato trabalha com `isOn` lógico, não GPIO HIGH/LOW. Não alterar GPIO por callback MQTT antes de validar estrutura, alvo, duplicação, prazo e intertravamentos.

## 11. Mapeamento ao banco e evolução necessária

| Mensagem | Mapeamento principal |
| --- | --- |
| telemetry | messageId→leituras.mensagem_id; occurredAt→ts; qualidade→*_confiavel; temperaturas/umidades/ADC→campos correspondentes; waterLevel OK/LOW→nivel_ok true/false |
| state | B1/B2→irrigacao/nevoa; mode→modo; isOn→ligado; fsmState→estado_fsm; temporizadores→modo_iniciado_em/expira_em; activeConfigVersion→reconciliação |
| commands/acks | commandId→comandos.id_externo; ack→comando_confirmacoes; ações→tipos SQL existentes; appliedConfigVersion→config_historico |
| cycle | cycleId→acionamentos.id_externo; source emergency→emergencia, test→teste; commandId resolvido para FK quando houver |
| alert | episodeId→alertas.id_externo; código/severidade→catálogo/episódio; reconhecimento mantido no backend |
| fsm_transition | irrigation/fog/substrate→irrigacao/nevoa/substrato |
| calibration | ADCs→calibracoes; preservar também calibrationId para rastreio |

O SQL inicial não contém todos os metadados v1. Na próxima etapa, uma migração incremental deverá criar inbox de mensagens e checkpoints de boot/conexão/sequência, preservar payload bruto validado e qualidade temporal, rastrear calibração externa, feedback e bloqueios. Ciclos com início desconhecido não cabem no atual `acionamentos.inicio NOT NULL`; duração monotônica não cabe sozinha na coluna gerada duracao_s. Alertas também precisam distinguir horário do fato de horário de recepção. Esses casos exigem evolução explícita; não preencher com hora inventada para satisfazer constraints.

Persistência e reconciliação devem ser transacionais. Ordem de chegada não define a verdade física. IDs e resultados do banco não devem ser sobrescritos por reentrega tardia. Pacotes inválidos têm diagnóstico sem expor segredos; PUBACK do MQTT apenas confirma transporte, não que uma transação no PostgreSQL foi concluída. A confirmação de persistência é o recibo descrito na seção 10. Falha da API após COMMIT e antes do recibo é recuperada pela reentrega idêntica e resposta duplicate.

## 12. Validar e compartilhar

Na raiz, após instalar as dependências:

```powershell
npm.cmd run test:mqtt-contract -w api
npm.cmd run contract:check -w api
npm.cmd run contract:validate -w api -- --topic pievi/v1/devices/bancada-01/telemetry --file ../protocol/mqtt/v1/examples/telemetry.json
```

Esses comandos não precisam de broker, estufa ou banco. Para conferir um JSON próprio, substitua o arquivo e o tópico. Caminhos de arquivo são relativos ao workspace `api`. Use `--retained` apenas para reproduzir o recebimento de pacote retido. O comando retorna código de saída 0 quando válido, 1 quando inválido e 2 para uso sem parâmetros.

Compartilhar este documento, o schema, os exemplos e as decisões de proteção. Credenciais e endereços reais pertencem aos arquivos locais da futura instalação, não aos exemplos versionados. Esta versão fixa o formato para desenvolvimento dos dois lados; mudanças incompatíveis após o início da implementação do firmware exigem `v2` ou migração acordada, não alteração silenciosa da v1.
