# PIEVI MQTT v1 — material para o firmware

Leia o [contrato completo](../../../docs/contrato-mqtt-v1.md) antes de implementar. Este pacote define a comunicação; broker e ingestão ainda serão implementados nas próximas etapas da entrega.

- `schema.json`: JSON Schema draft-07, com uma definição por tópico.
- `examples/index.json`: nome de cada arquivo, tópico, publicador, QoS e retain.
- `examples/*.json`: payloads JSON que podem ser usados como referência no ESP32.

Os exemplos são casos independentes de formato, não uma captura cronológica de uma sessão real. IDs/horários são fictícios. Renove os IDs, horários e alvos ao publicar; os comandos de exemplo já estão vencidos.

Na raiz do repositório:

```powershell
npm.cmd run test:mqtt-contract -w api
npm.cmd run contract:check -w api
npm.cmd run contract:validate -w api -- --topic pievi/v1/devices/bancada-01/telemetry --file ../protocol/mqtt/v1/examples/telemetry.json
```

`--file` é relativo à pasta `api`, pois o comando usa esse workspace. A validação é local, sem credenciais, broker ou banco. Ela verifica estrutura e relações internas do payload. Não comprova que o dispositivo está autorizado, que uma sessão está sincronizada, que o pedido ainda está válido no recebimento ou que as proteções físicas funcionam.

Os arquivos JSON são gerados a partir de `api/src/mqtt/schema.ts` e `examples.ts`. Após uma alteração deliberada no contrato, execute `npm.cmd run contract:export -w api`, revise os JSONs e rode os testes. Alterações incompatíveis após a entrega do firmware exigem uma nova versão de contrato e de prefixo dos tópicos.
