# Entrega do ambiente integrado — trabalho em etapas

Objetivo: o colega recebe o mesmo repositório, inicia PostgreSQL, broker e API na própria máquina, abre o app e testa com ESP físico ou ESP virtual.

| Etapa | Entrega | Situação |
| --- | --- | --- |
| 1 | Contrato MQTT v1, exemplos JSON, regras de conexão e validação executável | Implementada neste repositório; não conectada às rotas atuais |
| 2 | Migração incremental e repositório PostgreSQL para ingestão, deduplicação, ordenação, estados, comandos, configurações e histórico | Próxima etapa |
| 3 | Cliente MQTT da API, modo integrado do app/API e ESP virtual seguindo o mesmo contrato | Pendente |
| 4 | Docker Compose com PostgreSQL, broker e API, provisionamento local, instruções para Expo, ensaio completo e pacote de entrega | Pendente |

## O que pode ser usado agora

O [contrato MQTT v1](contrato-mqtt-v1.md) e a pasta [protocol/mqtt/v1](../protocol/mqtt/v1/README.md) são a referência comum para o firmware e a futura API integrada. Incluem leituras, estado de B1/B2, comandos, configuração completa, confirmações, ciclos, alertas, calibração, FSM, presença e sincronização de sessão.

O aplicativo permanece usando o simulador em memória. A autenticação mantém seu funcionamento atual. Nenhum banco existente foi migrado e nenhum broker foi iniciado nesta etapa. O guia PDF de 03/11 é uma referência datada do modelo, não a especificação MQTT v1.

## Critérios da próxima etapa

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

Portas, imagens Docker, credenciais locais e scripts de inicialização serão definidos e testados na etapa do ambiente. Não usar segredos da máquina do desenvolvedor no pacote.
