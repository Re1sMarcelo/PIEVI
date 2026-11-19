# Teste presencial com ESP32 — PIEVI

Roteiro para 20/11/2026. Execute no **notebook que será levado à estufa**, depois de clonar a versão que contém este guia. Comandos para PowerShell, na raiz do projeto. Use `npm.cmd` no Windows.

## 1. O que este modo inicia

```text
ESP físico ↔ MQTT/TCP ↔ API ↔ PostgreSQL embarcado/PGlite em disco
                        ↕
                 App no Expo Go
```

`physical:up` inicia a API e, por padrão, um broker MQTT no notebook. **Não inicia ESP virtual, não fabrica leituras e não envia comandos às bombas ou aplica configurações automaticamente.** Os controles de cenários virtuais ficam desabilitados. AUTO já programado no firmware pode funcionar independentemente da API: iniciar com as cargas desconectadas.

O banco PostgreSQL embarcado/PGlite fica em `tmp/physical-bench/postgres/`. Usa o mesmo esquema, migração e regras da integração MQTT e persiste o ensaio sem Docker, instalação de PostgreSQL ou internet. **Este banco local é separado do PostgreSQL externo de `api/.env` e dos bancos do Compose/laboratório.** Os registros presenciais ficarão no notebook. Para usar um servidor PostgreSQL externo, existe o modo MQTT de `docs/ambiente-integrado.md`; não iniciar os dois na porta 3000.

A bancada lê somente `.env.physical`, sem carregar `api/.env` ou `.env.compose`. O comando do app físico fixa a URL correta, mesmo que `mobile/.env` contenha uma URL antiga.

## 2. Fazer hoje no notebook, com internet

- [ ] Instalar Git e Node.js compatível: Node 24.x a partir de 24.3 ou Node 22.x a partir de 22.13.
- [ ] Instalar/abrir no celular Expo Go compatível com o SDK 58 deste projeto.
- [ ] Clonar a branch/versão que contém este guia e instalar as dependências. Se o repositório for privado, autenticar no GitHub no notebook.

```powershell
git clone --branch preparo-esp-fisico https://github.com/Re1sMarcelo/PIEVI.git
cd PIEVI
# Confirmar que GUIA-TESTE-ESP-FISICO.md e o comando setup:physical existem.
npm.cmd ci
npm.cmd run setup:physical
npm.cmd run check
npm.cmd run build:api
npm.cmd run test:physical
```

O clone **não traz `.env`, senhas, banco, NVS ou `node_modules` desta outra máquina**. `setup:physical` cria `.env.physical` com senhas próprias do notebook; repetir preserva o arquivo. Não copiar configurações privadas da máquina anterior.

- [ ] Pedir ao colega a identidade física do ESP para `PHYSICAL_CHIP_ID`, por exemplo a identificação de chip/MAC anotada por ele. É um vínculo administrativo do banco, não um campo adicional a inventar no JSON. O `deviceId` do protocolo e do app será **`bancada-01`**.
- [ ] Confirmar que o firmware segue `docs/contrato-mqtt-v1.md`, `protocol/mqtt/v1/schema.json` e a pasta de exemplos. A introdução antiga do contrato foi atualizada; não usar os payloads legados do guia de 03/11.
- [ ] Combinar onde estará o broker. Padrão deste guia: no notebook. Para broker do colega, seção 6.
- [ ] Fazer a primeira abertura do Expo no notebook ainda hoje, depois de preencher `LAN_IP`; testar o QR no celular na rede disponível. Finalizar instalação/downloads antes de sair.
- [ ] Levar carregador, cabo USB, acesso à rede, firmware e documentos. O app/API de bancada não precisam de servidor na nuvem para o ensaio.

Os testes automatizados usam bancos e clientes MQTT de ensaio isolados. Não conectam na placa nem no banco presencial e não comprovam GPIOs/relés/sensores reais.

## 3. Preparar a identidade e conferir infraestrutura

Abrir `.env.physical`, preencher `PHYSICAL_CHIP_ID` com a identidade real combinada e preservar as senhas geradas. Não usar identidade fictícia para inicializar o banco presencial. Depois:

```powershell
# Terminal 1 — manter aberto
npm.cmd run physical:up
```

```powershell
# Terminal 2 — não aciona bombas
npm.cmd run physical:check -- --infra
```

API, broker, login e histórico devem passar. Sem ESP, sincronização, leituras, relógio, sensores e configuração aparecerão como **pendentes**. Isso é esperado, mas não aprova a integração física. O relatório fica em `tmp/physical-bench/latest-check.json`.

Em `http://localhost:3000/health`, conferir `mode=mqtt`, `simulation=false`, `storage=pglite` e `mqtt.ready=true`. `/health` pode estar `ok` com ESP desconectado: confirma a infraestrutura, não a placa. A API envia desafios de sincronização, mas nenhum comando de atuação/configuração por conta própria.

## 4. Ao chegar: rede e ESP virtual desligado

1. Conectar notebook, ESP e celular à rede combinada, com comunicação permitida entre os dispositivos. Evitar Wi-Fi de visitantes com isolamento. Se necessário, usar um roteador/hotspot que permita essa comunicação.
2. Encerrar com **Ctrl+C**, nos respectivos terminais, qualquer `dev:api`, `lab` ou `virtual:esp`. Encerrar o Expo não encerra uma API em outro terminal.
3. Se o Compose virtual estiver rodando **nesse notebook**, parar preservando os volumes:

   ```powershell
   npm.cmd run compose:down
   ```

   Em clone novo sem Docker/Compose iniciado, pular. Não usar `down -v`. Se outro computador tiver um ESP virtual no broker escolhido, ele também deve ser parado. Não pode haver dois clientes com identidade `bancada-01` e client ID `pievi-esp-bancada-01` no mesmo broker.
4. Rodar `ipconfig` e anotar o **IPv4 do notebook na interface que alcança celular/ESP**. Não copiar IP de VPN, Docker, WSL ou outro computador.
5. Preencher `LAN_IP` em `.env.physical`, por exemplo `LAN_IP=192.168.1.25`, substituindo pelo IP real. Atualizar e reiniciar o comando do app ao mudar de rede/IP.
6. Permitir Node.js no Firewall do Windows na rede privada autorizada. Portas necessárias: **3000/TCP** (API), **1883/TCP** (broker local) e **8081/TCP** (Expo). Essa permissão será feita no notebook, inclusive pelo aviso do Windows, se aparecer.
7. Abrir no navegador do celular `http://IP_DO_NOTEBOOK:3000/health`. Se não abrir, resolver rede/firewall antes de investigar o firmware. Do computador do colega, `Test-NetConnection IP_DO_NOTEBOOK -Port 1883` ajuda a conferir o broker; isso não comprova o Wi-Fi da placa.

Manter notebook ligado, conectado ao carregador e sem suspensão. O broker local usa MQTT/TCP autenticado, sem TLS, para a rede privada da bancada.

## 5. Broker no notebook (padrão)

Manter em `.env.physical`:

```dotenv
DEVICE_ID=bancada-01
MQTT_BROKER_MODE=local
API_PORT=3000
MQTT_PORT=1883
```

As senhas reais já foram geradas pelo setup. API e ESP têm contas distintas. No modo local, nomes de usuário/client IDs são fixos. Passar ao colega **somente os dados do ESP**:

| Configuração do firmware | Valor |
| --- | --- |
| Wi-Fi | SSID e senha da rede combinada |
| Host do broker | IPv4 real do notebook (`LAN_IP`); nunca localhost/0.0.0.0 |
| Porta | `MQTT_PORT`, padrão 1883 |
| Usuário MQTT | `bancada-01` |
| Senha MQTT | Valor de `MQTT_ESP_PASSWORD` no arquivo local |
| Client ID | `pievi-esp-bancada-01` |
| deviceId | `bancada-01` |
| Prefixo dos tópicos | `pievi/v1/devices/bancada-01/` |
| Protocolo | MQTT 3.1.1, QoS 1, cleanSession=true, keepalive 30 s |
| Retain | Somente presence; demais tópicos sem retain |

ESP publica `telemetry`, `state`, `events`, `acks`, `presence`; assina `commands`, `sync`, `receipts`. Broker restringe os canais e identidade. API usa `api-local`, `MQTT_API_PASSWORD`, `pievi-api-local`, com permissões inversas. Não enviar o arquivo completo, senha do operador, hash ou dados de banco ao firmware.

Iniciar em terminais separados:

```powershell
# Terminal 1
npm.cmd run physical:up
```

```powershell
# Terminal 2
npm.cmd run physical:mobile
```

```powershell
# Terminal 3 — antes do ESP conectar
npm.cmd run physical:check -- --infra
```

O comando do app exige `LAN_IP` válido no notebook, abre Expo Go em LAN/sem consultas externas, fixa a API em `http://LAN_IP:API_PORT` e limpa o cache. Escanear o QR pelo celular. O telefone precisa alcançar o Metro e a API na rede local.

Entrar com `OPERATOR_USERNAME` e `OPERATOR_PASSWORD` de `.env.physical`. É o operador desta bancada, diferente do demo e do banco anterior.

## 6. Se o colega já possui broker

Parar `physical:up` com Ctrl+C, editar `.env.physical` e reiniciar:

```dotenv
MQTT_BROKER_MODE=external
MQTT_URL=mqtt://IP_DO_BROKER:1883
MQTT_API_USERNAME=USUARIO_DA_API
MQTT_API_PASSWORD=SENHA_DA_API
MQTT_API_CLIENT_ID=pievi-api-local
```

Nesse modo **não há broker local**. O responsável pelo broker fornece endereço/porta e cria a conta da API com ACL inversa à do ESP. Credenciais do ESP ficam no firmware; `MQTT_ESP_PASSWORD` local não muda o broker externo. `LAN_IP` continua sendo o IP do notebook da API para o celular. Manter `deviceId=bancada-01` e conferir sessão persistente/fila da API segundo o contrato.

`mqtts://` com certificado validado pelo sistema também é aceito. O comando não instala certificados privados nem configura o servidor do colega.

## 7. Checklist presencial — nesta ordem

Copiar o [checklist para registro](docs/checklist-esp-fisico.md) para `tmp/physical-bench/registro-2026-11-20.md`. Marcar PASSOU/FALHOU/NÃO TESTADO, horário e evidência sem senhas. ACK confirma aceite: conferir também o estado publicado e o efeito físico.

### A. Comunicação e configuração, com cargas desconectadas

- [ ] API acessível no notebook/celular; mode=mqtt, simulation=false.
- [ ] App abre pelo QR, faz login físico e mostra estufa conectada, sem cenários virtuais.
- [ ] ESP conecta, publica presença e responde ao sync. Presença online sozinha não aprova a sincronização.
- [ ] Painel recebe leituras e estado a cada 15 s. Alterar uma condição de forma controlada e observar atualização.
- [ ] Conferir sensores de ar/raiz/solo e boia com a montagem. Solo exige evento de calibração antes das amostras correspondentes. Falha deve aparecer como indisponível, sem zero inventado.
- [ ] Conferir UTC confiável no ESP e fuso America/Sao_Paulo para janela/agenda. Sem hora confiável, o ESP recusa comandos e configurações.
- [ ] Em Controle, revisar limites com o colega e definir B1 manual **10 s** e B2 manual **5 s** (mínimos do app). Revisar gatilhos AUTO antes de energizar.
- [ ] Revisar e aplicar configuração pelo app; aguardar confirmação e versão >= 1. `configApplied=true`; versão 0 bloqueia atuações remotas.
- [ ] Conferir B1/B2 desligadas, GPIOs e polaridade dos relés. O firmware deve iniciar as saídas em condição segura.

Agora rodar `npm.cmd run physical:check`. Todos os itens devem ficar OK. O diagnóstico confere comunicação, dados recentes, hora, sensores, nível, configuração e saídas informadas. **Não verifica eletricamente os relés e não aciona bombas.**

### B. Acionamento supervisionado

- [ ] Conferir água e montagem; testar **B1 por 10 s** e observar relé/bomba, estado no app e corte físico no prazo.
- [ ] Testar **B2 por 5 s**, conferindo os mesmos itens. Investigar bloqueios de qualidade, AUTO/pausa ou proteção antes de insistir.
- [ ] Conferir início/fim no Histórico com a bomba correta e estado informado pelo ESP.
- [ ] Testar MANUAL_OFF e retorno AUTO. AUTO pode acionar conforme sensores: acompanhar fisicamente.

### C. Proteções e alertas

- [ ] Provocar nível baixo/circuito aberto da boia de forma controlada: bloquear/cortar ambas. Conferir alerta e recuperação após restaurar. Não usar ignorar boia para passar o teste.
- [ ] Falha DHT: B2 bloqueia e leituras ficam inválidas; recuperação após 3 leituras válidas consecutivas.
- [ ] Falha/recuperação do solo: conferir qualidade/calibração. Fallback agendado exige solo inválido há mais de 60 s, relógio confiável e demais proteções.
- [ ] Reconhecer alerta registra ciência sem encerrar uma condição ainda ativa. Resolver a causa e conferir encerramento do episódio no histórico.
- [ ] Se houver condições/tempo, ensaiar tetos locais B1 300 s e B2 60 s. Não são os primeiros ensaios; não forçar condições perigosas para validar calor/UR.

### D. Rede, reinício e persistência

- [ ] Durante acionamento curto supervisionado, desconectar Wi-Fi do ESP: saída desliga pelo temporizador local, sem depender do app.
- [ ] Desconectado, app/API bloqueiam novos acionamentos. Offline após cerca de 45 s sem dados; Last Will pode antecipar.
- [ ] Reconectar: novo sync e dados atuais, sem repetir comandos antigos. O colega pode verificar validade/idempotência com cliente de ensaio, sem reproduzir exemplos vencidos em bombas energizadas.
- [ ] Reiniciar ESP sem apagar NVS: boot aumenta e sincroniza. Se regravar apagando NVS, registrar e planejar reprovisionamento; não apagar checkpoints/banco para contornar rejeição.
- [ ] Com saídas seguras, parar API/broker com Ctrl+C e iniciar novamente: preservar configuração/histórico e sincronizar sem repetir atuações. Sessões continuam enquanto válidas.
- [ ] Reabrir app, conferir login/histórico e executar diagnóstico final com saídas desligadas.

## 8. Encerrar e preservar o ensaio

- [ ] Registrar commit da API/app (`git rev-parse --short HEAD`), firmware, chip, versão aplicada, resultados e pendências no checklist.
- [ ] Deixar bombas fisicamente seguras com o colega. Parar API não desliga AUTO no ESP.
- [ ] Parar Expo e physical:up com Ctrl+C, aguardando o término.
- [ ] Fazer backup privado de **`.env.physical` + toda a pasta `tmp/physical-bench/`, com processo parado**. O colega preserva NVS/configuração do firmware. Não recriar senhas nem apagar banco para limpar erro.
- [ ] Não commitar credenciais, banco, tokens ou capturas das senhas. O checklist em branco e o guia podem ser versionados.

## 9. Diagnóstico rápido

| Sintoma | Conferir |
| --- | --- |
| Comando physical não existe após clonar | Selecionar/baixar a branch/commit de preparação; conferir este guia e git log -1. |
| Falta PHYSICAL_CHIP_ID | Pedir identidade real ao colega e preencher antes de abrir o banco presencial. |
| Porta ocupada | Encerrar outra API/lab, broker ou Compose. |
| Celular não abre health/QR | LAN_IP, mesma rede, isolamento, firewall 3000/8081 e URL anunciada pelo Expo. |
| ESP não conecta ao broker local | IP do notebook, porta 1883, firewall, usuário/senha e client ID exatos. |
| MQTT conectado, ESP offline | Contrato v1, resposta ao sync, boot/NVS e novos state/telemetry; presença não basta. |
| Leituras chegam, comandos bloqueados | Hora, configuração aplicada, calibração, nível, qualidade, proteção e estado/telemetria recentes. |
| ID/boot rejeitado após regravar | Preservar dados e investigar NVS; reprovisionamento planejado, sem zerar checkpoints. |
| Volta online após reinício sem histórico anterior | Conferir pasta/banco e notebook usados; não confundir bancada local com Compose ou banco externo. |
