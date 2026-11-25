# Levantamento para o Capítulo 3 (Resultados) — PIEVI

Fontes: código do repositório (commit `33199fe`, `main`), banco PostgreSQL do Railway (consultado em 25/11/2026), logs em `tmp/`.
Referências no formato `arquivo:linha`. Horários de banco em UTC; Brasília = UTC−3.
Consultas de H1–H4: `docs/analise/hipoteses.sql`.

**Avisos que afetam o texto do capítulo:**
- Os limiares do enunciado (30 °C e 60 %) **não coincidem integralmente com o código**. A névoa liga com T > **28 °C**; a irrigação liga com **umidade do substrato < 60 %** (itens 5 e 20).
- O app **não tem notificação push** (item 15). H3 só pode ser medido até a exibição no app aberto.
- Os dados existentes cobrem cerca de **2,3 h de ensaios de bancada** (20/11 e 22/11), **não 14 dias** (seção D).
- O comentário do firmware identifica o sensor de solo como **HD-38** (que é resistivo), não capacitivo (item 2). Confirme o modelo.

---

## A. Extraído do código e da configuração

### 1. Placa
- "ESP32 DevKit 30 pinos"; placa no IDE: "ESP32 Dev Module" — `firmware/pievi_esp32/pievi_esp32.ino:2`, `:8`.
- Chip lido por esptool: **ESP32-D0WD-V3 rev v3.1**, conversor USB CH9102 — `tmp/physical-bench/registro-2026-11-20.md:7`.

### 2. Pinos
| Função | GPIO | Modo | Fonte |
|---|---|---|---|
| Sensor de umidade do solo ("HD-38", saída AO) | 34 | ADC1, 12 bits, atenuação 11 dB, média de 8 leituras | `pievi_esp32.ino:42`, `:252`, `:193` |
| DHT22 (DATA, pull-up 10 kΩ para 3V3) | 16 | digital, protocolo DHT | `pievi_esp32.ino:43`, `:52` |
| DS18B20 (DATA, pull-up 4,7 kΩ para 3V3) | 4 | 1-Wire, conversão assíncrona, 12 bits | `pievi_esp32.ino:44`, `:53-54`, `:243` |
| Boia | 19 | entrada com pull-up interno; 1 = nível baixo/circuito aberto, 0 = com água | `pievi_esp32.ino:45`, `:252` |
| Relé da bomba de irrigação (B1, relé K2) | 27 | saída, relé ativo em nível baixo | `pievi_esp32.ino:40`, `:46`, `:247` |
| Relé da bomba de névoa/aspersão (B2, relé K1) | 26 | saída, relé ativo em nível baixo | `pievi_esp32.ino:41`, `:46`, `:248` |

As saídas são escritas como "desligado" antes do `pinMode(OUTPUT)` (`:247-248`).

### 3. Ferramentas e bibliotecas
- **Ferramentas:** Arduino IDE **2.3.10**, com arduino-cli **1.5.1** embutido. Fonte: `package.json` do IDE instalado e `arduino-cli version` no notebook de build.
- **Núcleo:** Arduino-ESP32 **3.3.12**, com ESP-IDF **5.5.5** (`CONFIG_IDF_INIT_VERSION` em `firmware/build/sdkconfig`).
- **Bibliotecas** (`arduino-cli lib list`; os includes estão em `pievi_esp32.ino:15-26`):
  - ArduinoJson **7.4.2**;
  - DHT sensor library **1.4.7**;
  - Adafruit Unified Sensor **1.1.15**;
  - OneWire **2.3.8**;
  - DallasTemperature **4.0.5**;
  - MQTT: cliente nativo do ESP-IDF (`mqtt_client.h`), sem biblioteca externa (`pievi_esp32.ino:10`);
  - Preferences/NVS, WiFi e SNTP, todos do núcleo.

### 4. Intervalos
- **Leitura dos sensores:** a cada **2,5 s** (`SAMPLE_MS = 2500`, `pievi_esp32.ino:48`).
- **Telemetria MQTT:** publicação periódica a cada **10 s**, ou antecipada quando há mudança perceptível, com no mínimo **3 s** entre envios. A mudança de nível da boia é publicada **imediatamente** (`pievi_v1.h:173`, `:193`).
- **Estado MQTT:** publicado a cada 10 s e logo após cada mudança de estado, com 300 ms de intervalo mínimo (`pievi_v1.h:169-170`).
- **Reenvio sem recibo da API:** a cada 5 s (`pievi_v1.h:193`).
- Até 22/11 19:15 UTC o intervalo periódico era de 15 s, e o envio antecipado tinha 7,5 s de intervalo mínimo (commit `d4233a4`).

### 5. Lógica automática (valores padrão de `pievi_core.h:33-38`; configuração v1 aplicada com os mesmos valores, tabela `config_atual`)
- **Irrigação (B1)** — `pievi_core.h:459-484`:
  - **Liga:** umidade do substrato < `soloMin` = **60 %**, com sensor confiável, menos de 20 ciclos no dia e janela de horário (desativada por padrão) (`:473-477`).
  - **Desliga:** ao atingir `soloMax` = **75 %**, ou ao completar **300 s** por ciclo (`:480-481`).
  - **Depois de cada ciclo:** pausa (cooldown) de **10 min**.
  - **Depois de reiniciar a placa:** pausa de **2 min** antes do automático poder ligar (`:335`).
  - **Falha de efeito:** após 3 ciclos sem aumento do solo acima de 5 pontos, o sistema entra em falha e para o automático.
- **Névoa (B2)** — `pievi_core.h:537-548`:
  - **Liga:** T_ar > `tempNevoaOn` = **28 °C**, **ou** UR < `urMinNevoa` = **50 %**, e sempre com UR < **90 %** (trava de umidade) (`:537-541`).
  - **Desliga:** por **histerese** (T ≤ 28 − 3 = **25 °C** e UR ≥ 60 %), pela trava de UR ≥ 90 %, ou pelo fim do pulso de **60 s** (`:544-546`).
  - **Depois do pulso:** pausa de **5 min**.
  - **Emergência de calor:** acima de **35 °C**, ciclos de 30 s ligado e 2 min desligado, com corte imediato se UR ≥ 95 % (`:532`, `:559-564`).
- **Tempo mínimo:** não existe. **Tempos máximos contínuos:** B1 300 s, B2 60 s (`pievi_core.h:126`). **Limite por hora:** 15 min ligado para cada bomba (`:128`, `:608-612`).
- **Agenda de reserva:** só é usada com o sensor de solo inválido por mais de 60 s: 07:00, 12:00 e 16:00, 60 s cada (`:42`, `:498-509`).

### 6. Bloqueio pela boia
- **Vale para as duas bombas, em modo automático e manual** (`pievi_core.h:600-602`, comentário "agua (inclui manual, exceto ignorar boia)").
- Um comando manual com nível baixo é recusado (`:244`). Um manual em andamento é interrompido quando o nível cai (`:435`).
- **Filtro da boia:** 5 s seguidos baixo para bloquear e 10 s seguidos OK para liberar (`:366-368`).
- A exceção "ignorar boia" (`IGNORE_FLOAT`) **é recusada por este firmware** (`pievi_v1.h:342`).

### 7. Modo manual
- **Comandos:** chegam pelo tópico `pievi/v1/devices/bancada-01/commands`, em JSON (`pievi_v1.h:309-344`).
  - Campos: `commandId`, `pumpId`, `action` (`MANUAL_ON`, `MANUAL_OFF`, `AUTO`, `TEST`, `RESET_FAULT`, `APPLY_CONFIG`), `durationSeconds`, `createdAt`, `expiresAt` (validade máxima de 10 s) e o boot/conexão de destino.
  - O ESP recusa comando vencido (`:326`), comando sem hora confiável (`:323`) e alvo de outro boot ou conexão (`:321`).
- **Confirmação:** vai pelo tópico `.../acks`, com `status` = `accepted`, `rejected` (com motivo) ou `completed` (`pievi_v1.h:297-302`).
- **Estado dos atuadores:** vai pelo tópico `.../state`: modo, ligado/desligado, estado da máquina, motivo de bloqueio e fim do manual (exemplos em `tmp/cloud/serial-emqx.log`).

### 8. Reconexão e operação sem rede
- **Wi-Fi:** reconexão automática (`WiFi.setAutoReconnect(true)`, `pievi_esp32.ino:267`).
- **MQTT:** reconexão própria, com espera crescente de 2 s até 30 s e recriação do cliente após 20 s sem resposta (`pievi_esp32.ino:142-161`). O cliente antigo é desmontado em segundo plano para não disparar o watchdog de 15 s (`:95-110`, `:272`).
- **A lógica automática roda localmente, mesmo sem conexão.** O MQTT só reporta e recebe pedidos (`pievi_esp32.ino:4`, decisão em `pievi_core.h`).
- **Mensagens sem conexão:** ficam numa fila de até 32 mensagens ou 64 KiB. Telemetria e estado guardam só a mais recente (`pievi_v1.h:203`).

### 9. Horário
- **NTP:** `configTime` com os servidores `pool.ntp.org`, `time.google.com` e `a.st1.ntp.br` (`pievi_esp32.ino:269`). A hora só é considerada confiável depois do NTP e de 01/01/2026 (`:177`).
- **O ESP carimba `occurredAt` em UTC, com resolução de 1 s** (`pievi_v1.h:228`). Sem hora confiável, o campo vai nulo.
- **A API e o banco gravam o recebimento** (`recebido_em`, `criado_em` e `confirmado_em`) com `clock_timestamp()` do PostgreSQL.

### 10. Calibração do solo
- **Fórmula:** `% = (ADC_seco − ADC) × 100 / (ADC_seco − ADC_água)`, limitada a 0–100 (`pievi_core.h:357`).
- **Valores usados:** **seco = 4095**, **água = 794** (tabela `calibracoes`, criada em 20/11/2026 20:06 UTC).
- **Padrão de fábrica, antes de calibrar:** 4095/600 (`pievi_core.h:274`).
- **Calibração pelo serial:** comandos `cal seco` e `cal agua` (`pievi_esp32.ino:13`, `:212-229`). Sem calibração, o solo é marcado como não confiável (`pievi_core.h:7`).

### 11. Tópicos MQTT
Prefixo: `pievi/v1/devices/bancada-01/` (`api/src/mqtt/protocol.ts:9`).

- **QoS:** 1 em todos os tópicos (`pievi_esp32.ino:69`, `api/src/integrated/worker.ts:27`).
- **Retain:** só em `presence`.
- **LWT:** em `presence`, com `{online:false}`, QoS 1 e retain (`pievi_esp32.ino:113`, `:127-131`).
- **Sessão:** limpa no ESP (`:126`) e persistente na API (`worker.ts:19`).
- **Keepalive:** 30 s (`:125`).

| Tópico | Sentido | Conteúdo |
|---|---|---|
| `telemetry` | ESP → API | temperatura e UR do ar, temperatura do substrato, solo em % e ADC, nível (`OK`/`LOW`), qualidade de cada sensor, hora confiável |
| `state` | ESP → API | modo e estado de B1/B2 (ligado, estado da máquina, bloqueio, falha, fim do manual), alertas ativos, versão da configuração; `syncId` quando responde à sincronização |
| `events` | ESP → API | ciclos (início/fim), alertas (aberto/resolvido), transições das máquinas de estado, calibração, configuração |
| `acks` | ESP → API | `commandId`, `status` (`accepted`/`rejected`/`completed`), motivo |
| `presence` | ESP → API | `online`, `connectionId` (retain + LWT) |
| `commands` | API → ESP | comandos manuais e `APPLY_CONFIG` |
| `sync` | API → ESP | desafio de sincronização (`syncId`, validade de 10 s) |
| `receipts` | API → ESP | recibo de gravação de cada mensagem (`stored`/`duplicate`/`rejected`), que libera a fila do ESP |

Todas as mensagens têm envelope comum: `schemaVersion`, `deviceId`, `bootId`, `bootNumber`, `connectionId`, `sequence`, `messageId` e `occurredAt`. O esquema está em `protocol/mqtt/v1/schema.json`.

### 12. EMQX
- **Hospedagem:** **EMQX Cloud, deployment Dedicated na AWS** (endereço `*.ala.dedicated.aws.emqxcloud.com`, campo `EMQX_HOST` de `.env.cloud`). A API REST é a `/api/v5`, ou seja, da linha EMQX 5.
- **Versão exata: NÃO ENCONTRADA.** A chave de API não tem permissão para `/nodes`. Consulte em Deployment Overview, no console do EMQX.
- **Autenticação:** usuário e senha no banco interno do EMQX (`password_based:built_in_database`), com os usuários `backend` (API) e `bancada-01` (ESP).
- **TLS:** ativo, porta **8883**. Cadeia `*.ala.dedicated.aws.emqxcloud.com` ← YR2 ← Root YR ← ISRG Root X1 (teste `cloud:emqx`). No ESP, o certificado é validado pelo pacote de certificados do ESP-IDF (`pievi_esp32.ino:25-28`, `:115-118`).
- **ACL:** regras por usuário no banco interno (consultadas por API em 22/11):
  - o ESP só publica nos tópicos ESP → API e só assina `commands`, `sync` e `receipts`;
  - a API faz o inverso;
  - publicar em `commands` é **negado** ao ESP;
  - a última regra de cada usuário nega todo o resto (`#`).

### 13. API
- **Tecnologia:** Node.js **24** (`Dockerfile:1`), TypeScript **6.0.3**, Fastify **5.12.7**, cliente MQTT `mqtt` **5.16.1**, `pg` **8.23.1** e `ajv` **8.20.0** (validação do contrato) — `api/package.json`.
- **Hospedagem:** serviço Docker no Railway (`railway.json`).
- **Endpoints** (`api/src/app.ts:63-83`, `api/src/integrated/routes.ts:16-49`):

| Método e rota | Função |
|---|---|
| `GET /health` | estado da API, do MQTT e do banco (público) |
| `POST /v1/auth/login` · `POST /v1/auth/logout` | sessão |
| `GET /v1/devices/:id/snapshot` | leituras recentes, estado dos atuadores, alertas ativos, configuração |
| `GET /v1/devices/:id/history` | histórico (telemetria, eventos, alertas) |
| `GET /v1/devices/:id/telemetry` · `/events` · `/alerts` | listas do histórico |
| `GET /v1/devices/:id/config` · `PUT /v1/devices/:id/config` | ler e aplicar a configuração (`If-Match` com a versão) |
| `POST /v1/devices/:id/commands` | enviar comando (ligar, desligar, voltar ao automático, teste, rearme) |
| `GET /v1/devices/:id/commands/:commandId` | acompanhar o comando até a confirmação do ESP |
| `POST /v1/devices/:id/alerts/:alertId/ack` | reconhecer alerta |

- **Autenticação do app:** login com usuário e senha (hash **scrypt**, `api/src/auth/password.ts:1-4`). A API devolve um token aleatório de 64 hexadecimais, que o app envia como `Authorization: Bearer` (`app.ts:53`). A sessão vale **8 h** (`db/001_schema.sql:30`).
- **Credenciais:** ficam em variáveis de ambiente do serviço no Railway: `DATABASE_URL` (referência interna ao Postgres), `MQTT_URL`, `MQTT_API_USERNAME`, `MQTT_API_PASSWORD` e `MQTT_API_CLIENT_ID` (`api/src/server.ts:13-16`; geradas por `api/scripts/cloud-railway-vars.ts`).
- **Recebimento MQTT:** a API assina `telemetry`, `state`, `events`, `acks` e `presence` com QoS 1 e sessão persistente (`worker.ts:19`, `:27`). Valida cada mensagem pelo contrato e grava no banco.
- **Envio de comandos:** a API grava o comando numa fila no banco (`mqtt_saida`). Um laço a cada 250 ms publica com QoS 1 e espera o PUBACK (`worker.ts:51`, `:83-86`; `publish.ts:2`).

### 14. Banco
- **Versão:** PostgreSQL **18.6** (`SHOW server_version`), imagem `postgres-ssl:18` do Railway.
- **Esquema:** `db/001_schema.sql` e migrações seguintes.
- **Tabelas e campos principais** (`[ts]` = data e hora; `→` = chave estrangeira):

```
usuarios(id, usuario, nome, email, senha_hash, ativo, criado_em[ts], ...)
sessoes(id, usuario_id→usuarios, token_hash, criado_em[ts], expira_em[ts], revogado_em[ts])
dispositivos(id, identificador, nome, chip_id, fuso_horario, fw_versao, ultimo_contato[ts], online, mqtt_habilitado)
dispositivo_usuarios(dispositivo_id→dispositivos, usuario_id→usuarios, ativo, vinculado_em[ts])
leituras(id, dispositivo_id, mensagem_id, ts[ts]=hora do ESP, recebido_em[ts]=hora do banco, temp_ar, umid_ar, temp_raiz,
         umid_solo, umid_solo_adc, nivel_ok, dht_confiavel, raiz_confiavel, solo_confiavel, calibracao_id→calibracoes)
calibracoes(id, dispositivo_id→dispositivos, sensor, adc_seco, adc_agua, criado_em[ts])
comandos(id, dispositivo_id, usuario_id, sessao_id→sessoes, id_externo, tipo, atuador, duracao_s, payload,
         criado_em[ts], valido_ate[ts], enviado_em[ts], confirmado_em[ts], finalizado_em[ts], status, motivo_resultado)
comando_confirmacoes(id, comando_id→comandos, resultado, motivo, ocorrido_em[ts]=ESP, recebido_em[ts]=banco)
acionamentos(id, comando_id→comandos, atuador, origem, motivo, inicio[ts], fim[ts], duracao_s,
             solo/temp/ur antes e depois, inicio_recebido_em[ts], fim_recebido_em[ts])
alertas(id, codigo→tipos_alerta, atuador, severidade, aberto_no_esp_em[ts], resolvido_no_esp_em[ts],
        aberto_em[ts], resolvido_em[ts], reconhecido_por, reconhecido_em[ts])
tipos_alerta(codigo, severidade, mensagem, acao_sugerida)
eventos(id, tipo, origem, descricao, detalhes, ocorrido_em[ts], recebido_em[ts])
transicoes_fsm(id, maquina, de_estado, para_estado, motivo, ts[ts], recebido_em[ts])
estado_atual(dispositivo_id, atuador, estado_fsm, modo, ligado, modo_iniciado_em[ts], expira_em[ts], atualizado_em[ts], recebido_em[ts])
config_atual / config_historico(versao, solo_min, solo_max, temp_nevoa_on, ..., aplicada_no_esp, aplicada_em[ts])
irrigacao_programada(configuracao_id→config_historico, horario_local, duracao_s, habilitada)
mqtt_mensagens(id, canal, topico, payload, boot_id, sequencia, ocorrido_em[ts], recebido_em[ts], resultado)
mqtt_saida(id, comando_id→comandos, topico, payload, criado_em[ts], publicado_em[ts])
mqtt_sessoes(...sincronizada_em[ts], ultimo_contato[ts]...), mqtt_boots, mqtt_conflitos, schema_migrations
```

- **Campos de data e hora:**
  - leituras: `ts` e `recebido_em`;
  - comandos: `criado_em`, `enviado_em`, `confirmado_em` e `finalizado_em`;
  - confirmações: `ocorrido_em` e `recebido_em`;
  - eventos de nível: alertas `NIVEL_BAIXO` (`aberto_no_esp_em`, `resolvido_no_esp_em`, `aberto_em`, `resolvido_em`) e `leituras.nivel_ok`.

### 15. App
- **Tecnologia:** React Native **0.88.1**, React **19.3.0**, Expo SDK **58.0.23**, TypeScript **6.0.3** (raiz do repositório).
- **Bibliotecas** (`mobile/package.json`): `expo-secure-store` (token da sessão), `expo-updates`, `react-native-svg`, `react-native-safe-area-context`, `expo-linear-gradient`.
- **Distribuição:** EAS Update, aberto no Expo Go (projeto `@marceloreis2003/pievi`, `mobile/app.json`).
- **Telas** (`mobile/src/ui/Navigation.tsx:10-12`; `mobile/App.tsx:283-286`):
  - Login.
  - **Painel:** leituras, estado das bombas, situação geral e tendência do solo.
  - **Controle:** comandos das bombas e edição e aplicação da configuração.
  - **Histórico:** leituras, eventos e ciclos.
  - **Alertas:** lista e reconhecimento.
- **Atualização por polling:** o estado é consultado a cada **2 s** e o histórico a cada **15 s** (`mobile/App.tsx:34-35`). Não há WebSocket nem push.
- **Notificação de nível crítico:**
  - **Não há notificação do sistema operacional.** O projeto não tem `expo-notifications` nem código de segundo plano, e as notificações push constam como trabalho futuro (`docs/arquitetura-proposta.md:68`).
  - O nível crítico aparece **dentro do app aberto**: faixa "Nível baixo · bombas bloqueadas" (`mobile/src/dashboardModel.ts:22`), alerta crítico na tela Alertas e bloqueio dos botões de ligar (`dashboardModel.ts:10`).
  - **Não funciona em segundo plano nem com o app fechado.**

### 16. Atuadores e modos no app
- Comanda **B1 (irrigação)** e **B2 (névoa/aspersão)**: ligar por N segundos, desligar (manual desligado por 1 h), **voltar ao automático**, teste de 10 s e rearme de falha (`mobile/src/ui/ControlScreen.tsx:151-156`).
- Há botão "Voltar ao automático" (`:156`). O modo de cada bomba (Automático, Manual ligado, Manual desligado) aparece na tela (`:19`).

---

## B. Testes de bancada (evidências existentes)

O registro formal (`tmp/physical-bench/registro-2026-11-20.md`) é de **20/11, antes do firmware v1**: todos os itens do ESP constam como "NÃO TESTADO". **Os ensaios de 20/11 (fim da tarde) e de 22/11 não foram registrados em documento.** As evidências abaixo vêm do banco, dos logs seriais e do `tmp/cloud/monitor-testes.log`. Os resultados "aprovado" têm como critério apenas o funcionamento observado nesses dados. A confirmação física (bomba bombeando, água saindo) **foi relatada por você durante os ensaios e precisa entrar no seu registro**.

### 17. Itens testados
| Item | Procedimento | Critério | Resultado |
|---|---|---|---|
| Sensor de solo | calibração `cal seco` (no ar) e `cal agua` (no copo); leituras contínuas | ADC distingue seco e água; % válida | **Aprovado (dados).** Seco 4095, água 794 (`calibracoes`); 908 leituras de 0 a 100 %; 19 inválidas (2,1 %) |
| DHT22 | leituras contínuas a cada 2,5 s | valores plausíveis; validade | **Aprovado (dados).** 24,9–26,2 °C; UR 70,9–81,9 %; 1 inválida em 908 (0,1 %) |
| DS18B20 | leituras contínuas | valores plausíveis | **Aprovado (dados).** 24,9–27,3 °C; 11 inválidas (1,2 %) |
| Boia | manipulação manual e jumper | nível no app; bloqueio das bombas | **Aprovado.** 16 episódios `NIVEL_BAIXO` abertos e fechados; corte das bombas (item 19) |
| Relé + bombas | B1 automática; B2 manual pelo app | ligar e desligar conforme a lógica | **Aprovado (dados + seu relato).** 9 acionamentos: 7 automáticos de B1 e 2 manuais de B2 (`acionamentos`) |
| Microaspersores | — | — | **NÃO ENCONTRADO.** Não há registro de vazão ou funcionamento dos bicos; só o acionamento elétrico de B2 |
| Comunicação MQTT | ESP ↔ EMQX (TLS) ↔ API | mensagens aceitas pelo contrato; ACL | **Aprovado.** 1.970 mensagens, todas "processada", 0 rejeitadas (`mqtt_mensagens`); teste `cloud:emqx` com todos os itens OK |
| Persistência PostgreSQL | gravação de tudo que chega | gravado e consultável | **Aprovado.** 908 leituras, 370 eventos, 30 alertas, 7 comandos, 13 confirmações |
| App | login, painel, comandos, pelo 4G (EAS Update) | dados no app; comandos executados | **Aprovado (seu relato + logs da API).** Comandos do app aceitos (item 19) |

### 18. Problemas encontrados e correções (histórico de commits e logs)
1. **Porta 1883 ocupada** pelo serviço Mosquitto do Windows: broker local movido para a porta 1884 (`registro-2026-11-20.md:8`).
2. **Relógio do notebook 15,9 s adiantado:** o app mostrava o ESP offline. Correção: relógio de referência do banco e do servidor (`api/src/persistence/clock.ts`, commit `8d46aca`).
3. **Gravação lenta pelo notebook no banco remoto** (cerca de 3 s por mensagem, atraso mediano de 12,4 s). Correção: API movida para o Railway, onde o atraso passou para cerca de 1,3 s.
4. **Deployment do EMQX parado** (portas MQTT sem resposta): religado no console.
5. **Reinício por watchdog** com TLS ao reconectar o MQTT (alerta `REINICIO` com motivo watchdog, 22/11 19:43 UTC). Correção: desmontar a conexão em segundo plano (commit `5d3d91e`).
6. **Pop-up de confirmação não fechava**, e comandos foram recusados porque a configuração não tinha sido aplicada (v0). Correção no app (commit `d4233a4`) e configuração v1 aplicada.
7. **Pausa de 10 min após reinício** impedia o automático logo depois de gravar o firmware: reduzida para 2 min (commit `5d3d91e`).
8. **Instabilidade da boia** ao segurá-la com a mão (troca de estado a cada poucos segundos), que o filtro de 5 s/10 s absorve. Solução: boia na água ou com jumper durante os ensaios.
9. Relé ativo em nível baixo, e a "bomba 2" da montagem é a irrigação, no GPIO 27 (`pievi_esp32.ino:40`, `:46`).

### 19. Latências medidas
- **Medição de 20/11** (`tmp/physical-bench/medicao-latencia.log`): idade média das leituras de 24,3 s. **Não use no capítulo**: foi feita com a API no notebook, com o relógio 15,9 s adiantado (problema 2).
- **Comando → confirmação** (H2 abaixo): 0,66 a 1,61 s.
- **Boia → banco** (H3 abaixo): mediana de 1,10 s.
- **Atraso das leituras até o banco** na nuvem: mediana de 1,3 s (medido em 22/11).

---

## C. Cálculos (dados de 20/11 e 22/11; consultas em `docs/analise/hipoteses.sql`)

### 20a. H1 — condição satisfeita → acionamento
- **Irrigação (umidade do substrato < 60 %):**
  - Resultado: **n = 7, os 7 ≤ 60 s (100 %), mediana 1 s, máximo 56 s.**
  - Definição da condição: o mais tarde entre o solo ficar abaixo de 60 % e a boia voltar a OK.
  - O máximo de 56 s ocorreu dentro da pausa pós-reinício.
  - Ressalva: os 7 ensaios usaram o sensor fora do substrato (0 %) e a boia manipulada. O estímulo foi a liberação da boia, não a secagem do solo.
- **Névoa por temperatura:** **n = 0.** Nenhuma leitura passou de 28 °C (a máxima foi 26,2 °C), e não há ciclo automático de névoa. **H1 para temperatura ainda não foi testado.**
- **Umidade do ar < 50 %:** n = 0 (a UR mínima foi 70,9 %).

### 20b. H2 — comando → confirmação do ESP (≤ 10 s)
Medido do instante em que o pedido chega à API (`criado_em`) até o "accepted" do ESP (`confirmado_em`), ambos no relógio do banco:

| Comando | Origem | n | ≤ 10 s | Mediana | Máximo |
|---|---|---|---|---|---|
| ligar névoa (`manual_on`) | app | 2 | 2 (100 %) | 1,40 s | 1,42 s |
| voltar ao automático (irrigação) | app | 1 | 1 | 0,66 s | 0,66 s |
| voltar ao automático (névoa) | app | 1 | 1 | 1,61 s | 1,61 s |
| desligar névoa (`manual_off`) | script de teste | 1 | 1 | 1,40 s | 1,40 s |
| voltar ao automático (névoa) | script de teste | 1 | 1 | 1,51 s | 1,51 s |
| aplicar configuração | script de teste | 1 | 1 | 1,29 s | 1,29 s |

**Ainda faltam:** ligar e desligar a irrigação pelo app (n = 0) e desligar a névoa pelo app (n = 0).

Os 11 toques feitos antes da configuração v1 foram recusados pela API (HTTP 409) e **não ficaram no banco**; só aparecem nos logs do Railway.

### 20c. H3 — boia → notificação
- **ESP (estado da boia já filtrado) → banco:** n = 10 (somente com a API no Railway), **mediana 1,10 s, máximo 1,98 s**.
- **Tempo até o app:** some até 2 s do polling, desde que o app esteja aberto.
- **Tempo total desde o movimento físico:** some também o filtro do ESP, de 5 s para nível baixo.
- **Notificação push:** **não existe.** Com o app fechado não há aviso.
- **Bomba ligada durante nível crítico:** **0 ocorrências** em 16 episódios (tolerância de 2 s). O manual da B2 foi interrompido quando o nível caiu (evento de 22/11 19:32:28 UTC: "interrompido: nivel de agua baixo").

### 20d. H4 — leituras previstas × registradas
"Previstas" = duração da janela ÷ intervalo periódico + 1. As registradas superam as previstas porque o ESP também envia quando a leitura muda. A perda é medida pelas **lacunas** maiores que 1,5 vez o intervalo periódico.

| Janela (UTC) | Intervalo periódico | Registradas | Previstas (mín.) | Lacunas |
|---|---|---|---|---|
| 20/11 20:06–20:13 | 15 s | 115 | 32 | 0 |
| 20/11 20:16–20:49 | 15 s | 212 | 131 | 3 |
| 22/11 18:35–19:14 | 15 s | 184 | 158 | 1 |
| 22/11 19:15–20:18 | 10 s | 390 | 380 | 3 |

- **Total:** 7 lacunas em 701 intervalos previstos (**cerca de 1,0 %**).
- **Leituras inválidas por sensor:** DHT22 0,1 %, DS18B20 1,2 %, solo 2,1 %.
- **Período: cerca de 2,3 h, não 14 dias.**

### 21. Precisão dos horários (< 1 s?)
**Não, ainda não para todos os tempos.**
- **Hora do ESP com resolução de 1 s** (truncada, `pievi_v1.h:228`): eventos medidos no relógio do ESP (`ts`, `inicio`, `aberto_no_esp_em`) têm erro de até 1 s. Em H1, por exemplo, o ciclo aparece no mesmo segundo da condição.
  - **Ajuste mínimo:** publicar `occurredAt` com milissegundos. O contrato já aceita `.mmm` (`protocol/mqtt/v1/schema.json:57`). Trocar `isoFromSec(epochMs()/1000)` por uma versão com milissegundos em `pievi_v1.h:228` e `:230`. É preciso regravar o firmware.
- **Hora do toque no app:** não é registrada. H2 começa na chegada à API, então o trajeto celular → API (cerca de 0,3 s no 4G, não medido) fica de fora.
  - **Ajuste mínimo:** o app envia `clientSentAt` no corpo do comando, e a API grava esse campo em `comandos.payload`. Para comparar, alinhar o relógio do celular pelo cabeçalho `Date` (o app já calcula esse desvio em `mobile/src/apiConnection.ts`).
- **Relógios:** os horários do banco (µs) e do servidor (desvio de 1 a 3 ms medido em `/health`) servem para H2. O ESP usa NTP. A diferença entre o relógio do ESP e o do banco não foi medida.
- **Para H3 com notificação real:** implementar push (`expo-notifications` e envio pela API quando abrir `NIVEL_BAIXO`) e registrar o horário de envio e de recebimento.

---

## D. Perguntas que só você pode responder
1. Modelo exato do sensor de umidade do solo. O código diz "HD-38" (resistivo); o texto fala em capacitivo. Qual é?
2. Tipo da boia (vertical ou horizontal, NA ou NF) e tensão.
3. Relé: número de canais, modelo e tensão da bobina.
4. Bombas B1 e B2: tensão, potência e vazão. Quantidade e vazão dos microaspersores e gotejadores.
5. Fonte: tensão e corrente do buck e das fontes das bombas.
6. Número de bolsas, volume dos reservatórios e posição dos sensores (altura do DHT22, profundidade do DS18B20 e do sensor de solo).
7. Datas e duração do período de validação (mínimo de 14 dias): ainda não houve. Quais estímulos usará (aquecimento para passar de 28 °C, secagem do substrato, retirada de água) e quantas intervenções físicas fará?
8. Quais comandos foram enviados pelo celular no 4G (no 22/11, pelo menos a abertura pelo EAS Update foi no 4G)?
9. Tempo diário de manejo manual relatado pela administradora.
10. Celular usado nos testes: os ensaios foram em **iPhone com Expo Go**. Haverá teste em Android? Qual modelo e versão?
11. Quais proteções você considera ativas e quer declarar? No código estão ativas:
    - bloqueio pela boia (5 s / 10 s);
    - tempos máximos de 300 s (B1) e 60 s (B2);
    - limite de 15 min por hora;
    - trava de UR ≥ 90 %;
    - DHT inválido bloqueia a B2;
    - validade de 10 s dos comandos;
    - pausas após ciclo e após reinício;
    - watchdog de 15 s;
    - relés desligados no boot;
    - ACL no EMQX.

    Existe proteção física (fusível, disjuntor, diodo nos relés)?

---

## Resumo
**(1) Preenchido com fonte:**
- placa e chip;
- pinos e modos;
- ferramentas, núcleo e bibliotecas com versões;
- intervalos;
- lógica automática com limiares, histerese, pausas e tempos máximos;
- bloqueio pela boia;
- comandos e confirmações;
- reconexão;
- NTP e carimbo de hora;
- calibração e fórmula;
- tópicos MQTT;
- EMQX (hospedagem, autenticação, TLS, ACL);
- API (versões, endpoints, autenticação, credenciais);
- banco (versão, tabelas, campos);
- app (versões, telas, polling, comandos);
- H1 (irrigação), H2 (parcial), H3 (até o banco) e H4 (2,3 h).

**(2) NÃO ENCONTRADO:**
- versão exata do EMQX;
- funcionamento e vazão dos microaspersores;
- notificação push (não implementada);
- registro formal dos ensaios de 20/11 e 22/11;
- hora do toque no app;
- toda a especificação física (seção D);
- dados de um período de 14 dias.

**(3) Falta medir para comprovar H1–H4:**
- **H1:** ensaios de névoa com T > 28 °C (ou alterar o limiar para 30 °C, se for o do projeto) e ensaios de irrigação com secagem real do substrato, com vários ensaios por condição.
- **H2:** ligar e desligar a **irrigação** e desligar a **névoa** pelo app, com pelo menos 10 repetições de cada, parte no 4G. Para incluir o trecho celular → API, aplicar o ajuste `clientSentAt`.
- **H3:** decidir se "notificação" é a exibição no app aberto (já mensurável) ou push (precisa ser implementado). Repetir os episódios de boia com a bomba ligada.
- **H4:** rodar o período de validação de 14 dias com a placa alimentada sem o notebook, e depois executar `docs/analise/hipoteses.sql`.
- **Geral:** aplicar o ajuste de milissegundos no `occurredAt` antes do período de validação.
