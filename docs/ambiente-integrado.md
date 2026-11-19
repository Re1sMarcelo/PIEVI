# Executar o ambiente integrado

**ESP físico, inclusive em outro notebook após clone:** siga o [guia presencial](../GUIA-TESTE-ESP-FISICO.md). Os comandos `setup:physical`, `physical:up`, `physical:mobile` e `physical:check` usam configuração e banco locais próprios, sem ESP virtual e sem exigir Docker. Esse banco PostgreSQL/PGlite não é o servidor externo de `api/.env`.

O app pode usar três modos. Escolha um por vez para não disputar a porta 3000.

| Modo | Iniciar na raiz | Dados e transporte | Cenários no app |
| --- | --- | --- | --- |
| Simulador de telas | `npm.cmd run dev:api` | Memória; depende de `api/.env` para autenticação | Sim |
| Laboratório integrado | `npm.cmd run lab` | PostgreSQL/PGlite em disco + broker Aedes MQTT/TCP + ESP virtual, no mesmo processo | Sim; relógio real |
| Compose integrado | Comandos abaixo | PostgreSQL 17 + Mosquitto + API + ESP virtual em containers separados | Não; controles e configuração continuam disponíveis |

O laboratório e o Compose usam bancos próprios. Não leem nem migram o PostgreSQL configurado em `api/.env`. O login Google foi retirado; o acesso continua por usuário ou e-mail e senha local.

## Instalação nova com Docker

Pré-requisitos: Docker Desktop com engine Linux iniciado, Docker Compose e Node.js compatível com o projeto. Execute em uma cópia do repositório ou no pacote de entrega extraído. O primeiro build baixa imagens e dependências.

```powershell
npm.cmd run setup:compose
npm.cmd run compose:up
npm.cmd run validate:compose
```

`setup:compose` cria `.env.compose` com senhas aleatórias independentes para banco, API no broker, ESP e operador. O usuário inicial é `operador`; consulte `OPERATOR_PASSWORD` no arquivo para entrar. O hash scrypt é usado no provisionamento. Repetir o setup preserva o arquivo; repetir o provisionamento preserva a conta e não redefine a senha. Não inclua esse arquivo em uma entrega.

O Compose inicializa `001_schema.sql` e o catálogo 002 somente em volume PostgreSQL vazio. O serviço `bootstrap` aplica a migração incremental 004 com checksum e cria o operador, a bancada virtual e seu vínculo. A inicialização recusa outro operador, outro chip ou vínculo revogado. Não aponte esse ambiente para um banco existente.

O comando de validação solicita e confirma a configuração inicial, aciona B1/B2 virtuais por dois segundos, confere estado, término, deduplicação e histórico no PostgreSQL. Depois para API/ESP/broker, reinicia PostgreSQL e inicia os demais serviços novamente. Confere sessão, configuração, histórico e ausência de repetição dos acionamentos. **Execute sem outros testes manuais simultâneos.** O relatório fica em `tmp/compose-validation/latest.json`; o token transitório do ensaio fica em volume interno separado.

Para verificar os serviços ou encerrar mantendo os dados:

```powershell
docker compose --env-file .env.compose ps
docker compose --env-file .env.compose logs --tail 50 api
npm.cmd run compose:down
```

Os serviços `bootstrap` e `broker-init` devem terminar com código 0; PostgreSQL, broker e API devem ficar saudáveis. O ESP fica em execução e sua sincronização é conferida pelo ensaio. Volumes `postgres-data` e `esp-nvs` preservam banco, configuração e contador de boot. Preserve ambos: apagar somente a NVS faz o contador regredir e o banco recusar o ESP.

`.env.compose` também precisa ser preservado: gerar novas senhas não altera as credenciais já gravadas no volume PostgreSQL nem a conta do operador. Não use `down -v` para uma parada normal.

## Abrir no Expo Go

Instale as dependências mobile na raiz:

```powershell
npm.cmd ci
npm.cmd run dev:mobile
```

Use Expo Go compatível com SDK 58 e escaneie o QR mostrado pelo Expo. Para rede local, computador e celular precisam se alcançar na mesma rede. `mobile/.env` pode manter `EXPO_PUBLIC_API_URL` vazio: o app descobre a máquina pelo Expo e usa a API na porta 3000. Para fixar o endereço, use `EXPO_PUBLIC_API_URL=http://IP_DO_COMPUTADOR:3000`; `localhost` no celular aponta para o celular.

Para túnel, com o Compose na porta padrão 3000 e sem URL fixa em `mobile/.env`:

```powershell
npm.cmd run start -w mobile -- --go --tunnel ngrok --port 8081
```

O proxy do Metro encaminha `/api` para `127.0.0.1:3000`. Ao usar túnel, a API fica acessível pelo endereço público durante a sessão. Entre com o operador de `.env.compose`, que é independente da sua conta no banco antigo. Teste login, Painel, Controle, Histórico, Alertas e logout. Antes do primeiro comando, execute a validação ou revise e aplique a configuração no menu Controle, aguardando confirmação do ESP.

O Compose publica a API em `0.0.0.0:3000` para permitir acesso local pelo celular; o firewall da máquina precisa permitir essa conexão. O broker fica em `127.0.0.1:1883`, e o PostgreSQL não publica porta no host. Para testar apenas no computador, ajuste `API_BIND=127.0.0.1` em `.env.compose`. Portas alternativas podem ser definidas por `API_PORT`/`MQTT_PORT`; nesse caso fixe a URL correta no mobile. O proxy do Metro usa a porta 3000.

## Laboratório sem Docker

```powershell
npm.cmd ci
npm.cmd run lab
```

Login exclusivo de desenvolvimento: `operador` / `estufa-local-123`. O banco fica em `tmp/integrated-lab/postgres`, e a NVS em `tmp/integrated-lab/esp-nvs.json`. Esse modo não carrega `api/.env` e não usa as credenciais do Compose.

Abra o app pelo Expo como acima. Em **Controle → Testar sem a estufa**, provoque nível baixo, falhas de sensor, calor e recuperação. Leituras, comandos, estados e recibos percorrem MQTT/TCP real; a automação física é representada pelo ESP virtual. O tempo não pode ser adiantado nesse modo. `Ctrl+C` encerra os serviços.

```powershell
npm.cmd run validate:integrated
```

Esse ensaio usa outro banco isolado em `tmp/integrated-validation`, portas dinâmicas e verifica também alertas, reconhecimento e recuperação. Seu relatório fica em `tmp/integrated-validation/latest.json`.

## Preparação para ESP físico

O firmware deve implementar o [contrato MQTT v1](contrato-mqtt-v1.md), incluindo boot persistente, sincronização, prazo e idempotência dos comandos, estados, alertas, ciclos e recibos. ACK não representa saída ligada: o app acompanha o estado informado pelo ESP.

O Compose entregue é uma bancada virtual. Sua identidade `virtual:bancada-01`, NVS, credenciais e banco não devem ser reaproveitados silenciosamente em hardware. Para uma bancada física, use cadastro e vínculo próprios, migração incremental, identidade explícita com `device:db enable` e broker alcançável pelo ESP, com credenciais e ACLs correspondentes. `api/.env.example` documenta o modo `PIEVI_DEVICE_MODE=mqtt`; omita `MQTT_DEVICE_KIND=virtual` ao conectar hardware. A API pode ser iniciada com `npm.cmd run dev:api` nesse ambiente preparado.

Não mantenha ESP virtual e físico com o mesmo clientId ou identidade no broker. A validação física, os relés e a confirmação elétrica continuam pendentes. As proteções finais e a operação AUTO sem rede pertencem ao firmware.

## Entregar uma cópia

```powershell
npm.cmd run package:delivery
```

Execute esse comando na cópia de desenvolvimento com Git. O script PowerShell gera ZIP e SHA-256 em `output/entrega`. Inclui código e documentação atuais, mesmo antes do commit. Exclui configurações reais, credenciais, bancos, NVS, logs, dependências, bundles, `.git` e material temporário. A cópia extraída gera as próprias credenciais com `setup:compose`. O pacote contém código-fonte para Expo Go; não é um APK.
