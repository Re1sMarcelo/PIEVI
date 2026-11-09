# PostgreSQL operacional — etapa 2

Implementação da migração incremental e da gravação do contrato MQTT v1 com o driver `pg`. O consumidor MQTT e as rotas integradas já estão disponíveis: veja o [guia de execução](ambiente-integrado.md). `DATABASE_URL` isoladamente habilita a autenticação persistente; o modo operacional integrado exige `PIEVI_DEVICE_MODE=mqtt` e as variáveis do broker. O modo padrão continua `simulator`.

## Aplicar a migração

Pré-requisito: PostgreSQL com `db/001_schema.sql` e `db/002_catalogo_alertas.sql` já aplicados. O arquivo 001 continua sendo apenas para banco vazio. A numeração 003 era da integração Google cancelada; a nova migração usa `db/migrations/004_mqtt_persistence.sql`, sem remover tabelas antigas.

Na raiz, usando o destino configurado em `api/.env`:

```powershell
# Consulta o plano, sem criar tabelas ou aplicar a migração.
npm.cmd run db:migrate -w api

# Aplica no DATABASE_URL configurado.
npm.cmd run db:migrate -w api -- --apply
```

Confira o destino e mantenha backup antes de aplicar em banco com dados importantes. O runner usa transação, lock transacional e checksum em `schema_migrations`. Reexecutar não reaplica a alteração; modificar uma migração já aplicada provoca erro. Alterações futuras exigem outro arquivo. Não há downgrade destrutivo automático.

O runner exige o modelo base e o catálogo completo. Não inicializa um banco vazio silenciosamente. Em tabelas grandes, ALTER/UPDATE e índices podem exigir uma janela de manutenção; timeout ou erro cancela a transação.

## Estrutura acrescentada

| Tabela | Finalidade |
| --- | --- |
| mqtt_boots | Contadores de boot e identidades UUID, com verificação de conflito |
| mqtt_sessoes | Sync pendente, sessão atual e checkpoints de estado, leitura e alertas |
| mqtt_mensagens | Inbox: payload validado, hash canônico, envelope, recebimento e resultado |
| mqtt_conflitos | Evidência de messageId repetido com conteúdo diferente |
| mqtt_saida | Outbox transacional de comandos, sync e recibos, aguardando publicação |
| schema_migrations | Controle de aplicação e checksum |

As tabelas operacionais recebem vínculo externo de calibração, feedback de saída, bloqueios, duração monotônica de ciclos e instantes físicos de alertas separados dos horários operacionais. Usuários, sessões, vínculos e histórico legado são preservados.

`dispositivos.mqtt_habilitado` começa em false. Nenhum cadastro é liberado automaticamente. `acionamentos.inicio` aceita NULL; `duracao_s` continua calculada de fim-início, e `duracao_monotonica_s` guarda a duração medida no ESP, inclusive incidentes acima dos tetos físicos. `aberto_em`/`resolvido_em` são horários operacionais dos novos registros de alerta MQTT; `aberto_no_esp_em`/`resolvido_no_esp_em` preservam instantes físicos, podendo ficar NULL. O histórico legado mantém seus dados originais.

## Preparar a bancada

Dispositivo e vínculo de operador devem existir. O provisionamento disponível pode ter criado `bancada-01` com chip `simulator:bancada-01`. Para substituir esse marcador por uma identidade explícita de desenvolvimento:

```powershell
npm.cmd run device:db -w api -- enable --device bancada-01 --chip-id virtual:bancada-01
```

Para o hardware, informe a identidade física acordada. O comando não troca silenciosamente um chip já associado a outro dispositivo. Perda do contador de boot ou troca de hardware exige reprovisionamento planejado; não zerar checkpoints manualmente para contornar rejeição.

Essas ferramentas são administração local com credencial de banco, não endpoints públicos nem comandos a executar no ESP. Arquivos .env reais não entram no pacote versionado.

## Gravação real por arquivo, sem broker

Para conferir a gravação com o driver PostgreSQL antes da etapa MQTT:

```powershell
npm.cmd run device:db -w api -- ingest --device bancada-01 --topic pievi/v1/devices/bancada-01/telemetry --file ../protocol/mqtt/v1/examples/telemetry.json
npm.cmd run device:db -w api -- history --device bancada-01
```

O caminho é relativo ao workspace `api`. Os exemplos possuem horários e IDs fictícios; use somente em bancada de desenvolvimento, sem misturar seus contadores com firmware real. A CLI é local e `--device` identifica a bancada autorizada pelo administrador. No transporte MQTT, a identidade depende das credenciais e ACLs do broker; o worker assina apenas os tópicos da bancada configurada e não confia apenas no JSON recebido.

Repetir o arquivo retorna duplicate, sem outra leitura. Mesmo messageId com conteúdo diferente retorna rejected e registra o conflito. O resultado só retorna após COMMIT. `history` mostra até 100 registros de cada categoria e seu último registro.

Leituras recebidas antes da calibração são preservadas com referência externa pendente; o vínculo é preenchido quando o evento de calibração chegar. Valores e flags declarados pelo ESP são mantidos. O consumidor deve indicar quando a calibração referenciada ainda não foi resolvida.

## Estado atual e sessão

```powershell
npm.cmd run device:db -w api -- sync --device bancada-01
```

O comando grava e mostra um desafio com validade de 10 s, colocando-o na outbox. A CLI não publica diretamente. Quando o worker integrado está em execução, ele publica a outbox e o ESP responde com state contendo syncId.

State sem desafio correspondente entra no histórico/inbox, mas não assume o estado atual. A resposta válida estabelece boot e conexão. Mensagens anteriores, duplicadas ou de outra conexão não renovam presença. Após 45 s sem dados novos, comandos são bloqueados; `sweepOffline()` invalida a sessão e gera OFFLINE. Novo sync é necessário para recuperação.

O estado de B1/B2 só muda pela mensagem de estado confirmada. Pedido, publicação e ACK não ligam uma bomba no banco. Uma saída observada que denuncia relé preso também é preservada como evidência.

Estado e telemetria têm horários de recebimento separados. Chegar uma leitura nova não torna o estado antigo das bombas recente, e vice-versa. Novos acionamentos exigem ambos recentes, nível/qualidade compatíveis e as proteções conhecidas, incluindo corte de B2 em UR95 na emergência. IGNORE_FLOAT não ignora DHT nem exclusividade. O firmware continua responsável pela verificação física final.

## Comandos, configurações e alertas

`PostgresDeviceStore.createCommand()` valida token, vínculo, sincronização e versão aplicada dentro da transação. O backend gera prazo, alvo de boot/conexão e versão de configuração; comando, agenda e outbox são gravados juntos. O token nunca entra no payload MQTT. A API HTTP usa esse método no modo integrado.

Mesmo commandId e conteúdo retorna o pedido existente sem outra publicação. Mesmo ID com conteúdo/autor diferente é recusado. Configuração fica solicitada até ACK completed correspondente ou estado reconciliado de uma versão conhecida. Versão desconhecida ou rejeitada não é aprovada automaticamente.

Comando concluído não regride para aceito. Pedido não aceito no prazo permanece expirado mesmo com ACK tardio; pedido já aceito pode terminar depois dos dez segundos iniciais. Ciclo concluído e estado AUTO posterior ao aceite reconciliam confirmação final perdida, sem fabricar uma saída desligada. Ciclo com commandId desconhecido preserva a referência externa, sem criar pedido autorizado.

`acknowledgeAlert()` valida operador e registra ciência, sem resolver. Snapshot de alertas locais resolve episódios ausentes, preservando reconhecimento e OFFLINE do backend. Evento antigo não reabre episódio encerrado. A interface integrada deverá mostrar a qualidade temporal dos instantes físicos.

## Fluxo usado pelo transporte MQTT

```ts
const store = new PostgresDeviceStore(postgresDatabase(pool));
// Inicialização/reconexão do backend:
await store.invalidateSessions();
await store.createSyncRequest('bancada-01');

await store.ingest(topic, bytes, { authenticatedDeviceId, retained });

for (const packet of await store.pendingPublications()) {
  await mqttPublish(packet.topico, packet.payload); // QoS 1, retain=false
  await store.markPublished(packet.id);            // após confirmação do broker
}
await store.sweepOffline();
```

`mqttPublish` no exemplo é ilustrativo; a implementação está em `api/src/integrated/worker.ts`, com confirmação QoS 1, publicação sem retain e varredura periódica de offline. Outbox só é visível a outra conexão depois do COMMIT. Erro transitório de SQL reverte inbox e domínio e não gera recibo. Rejeição definitiva preserva a inbox rejeitada e cria recibo rejected. Perda da resposta após COMMIT é recuperada por reentrega idêntica e deduplicação.

Use um único worker por ambiente nesta fase. Escritas são serializadas por dispositivo. `invalidateSessions()` cancela pedidos integrados ainda não aceitos e a publicação pendente, evitando atuação após reinício; pedidos aceitos continuam auditáveis. Retenção do histórico permanente, limpeza da inbox/outbox e múltiplos workers serão tratados depois do protótipo funcional.

## Validação e limites

```powershell
npm.cmd run test:persistence -w api
npm.cmd run check
npm.cmd run build:api
```

Os testes executam SQL no PostgreSQL isolado do PGlite, sem ler DATABASE_URL: migração/reaplicação, legado, checksum, rollback após falha injetada, reentrega, conflitos, horários desconhecidos, calibração, ordenação, reinício, configurações, comandos e alertas.

PGlite serializa as transações desses testes. Em 09/11/2026, o ensaio Compose também validou a conexão TCP do driver `pg` com PostgreSQL 17, comandos, histórico e reinício dos serviços. Concorrência com múltiplos workers continua fora do escopo. Nenhuma migração foi executada no banco anterior configurado pelo usuário; o Compose usa volume próprio.
