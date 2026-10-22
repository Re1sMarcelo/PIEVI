# Arquitetura e contratos propostos

**Status: aprovada como base em 21/10/2026.** Esta especificação serve para a primeira fatia com dados simulados e para orientar a integração posterior com o ESP32. As regras de segurança serão executadas no firmware; o backend encaminha pedidos e registra resultados.

## Componentes

- **App Expo/React Native:** Painel, Histórico, Alertas e Configurações/Controle. Mostra a origem e o horário da última atualização, estado online/offline e contagem regressiva de MANUAL_ON/MANUAL_OFF.
- **API Fastify:** autentica um operador, valida pedidos, fornece estado, leituras, eventos, alertas e configuração. Na fatia simulada, usa dados e relógio simulados em memória.
- **PostgreSQL:** persistência prevista para sessões, telemetria, eventos, alertas, configuração e comandos na integração real.
- **Broker MQTT:** transporta telemetria, estado e eventos do ESP32, além dos pedidos de comando e confirmações. Provedor e credenciais ficam pendentes até a integração real.
- **ESP32:** autoridade para AUTO, temporizadores, limites físicos, intertravamentos e resultado de comandos. Guarda a última configuração válida e continua em AUTO offline.

## Modelo mínimo

Todos os registros têm `deviceId`, horário ISO 8601 em UTC e um identificador único quando precisarem ser deduplicados.

- **Telemetry:** temperatura do ar (°C), UR (%), temperatura do substrato (°C), umidade do solo (%), nível de água, qualidade de cada leitura.
- **DeviceState:** online/offline, última comunicação, modo e estado real de B1/B2, expiração do modo manual, configuração ativa e alertas ativos.
- **Event:** leitura relevante, acionamento, alteração de modo, falha ou reconexão; inclui origem (`esp32`, `operador` ou `simulador`).
- **Alert:** código, severidade, início/fim, estado ativo/reconhecido e ação sugerida.
- **Command:** ID, bomba, ação, duração quando aplicável, instante de criação e expiração, operador, estado (`pending`, `accepted`, `rejected`, `expired`, `completed`) e motivo do resultado.

## API proposta

Todas as rotas, exceto login e saúde, exigem `Authorization: Bearer <token>`. O login usa senha validada contra hash no backend; o token expira e pode ser revogado. O app guarda o token em armazenamento seguro do sistema.

Atualização aprovada em 22/10/2026: o login aceita usuário ou e-mail cadastrado, usando a mesma senha. O campo JSON `username` aceita ambos os identificadores para preservar o contrato; a resposta mantém o nome de usuário canônico. O cadastro segue controlado para o operador único.

| Método | Rota | Função |
| --- | --- | --- |
| POST | `/v1/auth/login` | Iniciar sessão |
| POST | `/v1/auth/logout` | Revogar sessão |
| GET | `/v1/devices/:deviceId/snapshot` | Estado atual e última telemetria |
| GET | `/v1/devices/:deviceId/telemetry` | Histórico paginado por período |
| GET | `/v1/devices/:deviceId/events` | Acionamentos e mudanças paginados |
| GET | `/v1/devices/:deviceId/alerts` | Alertas ativos e históricos |
| POST | `/v1/devices/:deviceId/alerts/:alertId/ack` | Reconhecer alerta |
| GET | `/v1/devices/:deviceId/config` | Configuração ativa e limites permitidos |
| PUT | `/v1/devices/:deviceId/config` | Solicitar nova configuração, sujeita à validação do ESP32 |
| POST | `/v1/devices/:deviceId/commands` | Pedir AUTO, MANUAL_ON, MANUAL_OFF, teste ou ignorar boia |
| GET | `/v1/devices/:deviceId/commands/:commandId` | Consultar confirmação e resultado |

Pedidos de comando recebem um ID gerado pelo cliente para idempotência. A API valida formato e permissões, mas só marca `accepted` quando o ESP32 confirmar. Um pedido sem confirmação não é exibido como bomba ligada. O app sempre reconcilia com o snapshot real após reconexão.

## MQTT proposto para a integração real

Tópicos por dispositivo, com payload JSON versionado (`schemaVersion`, `deviceId`, `messageId`, `occurredAt`).

| Tópico | Publicador | Conteúdo |
| --- | --- | --- |
| `devices/{id}/telemetry` | ESP32 | Leituras com qualidade |
| `devices/{id}/state` | ESP32 | Modos e saídas reais, configuração ativa |
| `devices/{id}/events` | ESP32 | Acionamentos e alertas |
| `devices/{id}/presence` | ESP32/Last Will | Online/offline |
| `devices/{id}/commands` | Backend | Pedido com ID, validade e parâmetros |
| `devices/{id}/acks` | ESP32 | ID do comando, aceite/recusa e motivo |

Comandos e confirmações usam QoS 1 e deduplicação por ID. O ESP32 rejeita comando vencido, duplicado ou inseguro. Mensagens de comando não são retidas; o estado publicado após reconexão prevalece. Como presets provisórios, o ESP32 envia heartbeat a cada 15 s, o app indica OFFLINE após 45 s sem comunicação e um comando manual vale por 10 s. A escolha do broker e esses tempos serão validados na bancada.

O heartbeat é um sinal periódico de presença emitido pelo ESP32. O Last Will do MQTT complementa esse sinal quando a conexão cai abruptamente. Se o DHT22 perder confiabilidade, B2 não aceita novo acionamento até ocorrerem 3 leituras válidas consecutivas. UR acima de 85% por 30 min gera alerta de atenção; UR igual ou superior a 98% por 30 min gera alerta crítico e mantém B2 bloqueada, sem alterar o corte imediato da emergência em 95%.

## Primeira fatia simulada

O backend gera snapshot, histórico e alertas de uma bancada fictícia. Pedidos manuais recebem confirmação simulada e têm expiração visível; o simulador aplica os tetos aprovados e nunca representa um pedido pendente como saída ligada. A UI marca claramente os dados como simulação. A integração PostgreSQL/MQTT, notificações push e o firmware entram depois, preservando os contratos aprovados.
