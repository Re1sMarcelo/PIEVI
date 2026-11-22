# Operação em nuvem: API no Railway + broker EMQX Cloud

Objetivo: o ESP32 e o app passam a depender só da internet. O notebook deixa de ser servidor.

```
ESP32 ──Wi-Fi/internet──► EMQX Cloud (mqtts 8883) ◄──► API (Railway) ──rede interna──► PostgreSQL (Railway)
                                                            ▲
                                                 App (HTTPS, qualquer rede)
```

| Peça | Antes (bancada local) | Depois (nuvem) |
|---|---|---|
| Broker MQTT | Aedes no notebook, porta 1884 | EMQX Cloud, TLS na porta 8883 |
| API | `physical:up` no notebook | Serviço Docker no Railway (`railway.json` + `Dockerfile`) |
| Banco | PostgreSQL do Railway (URL pública) | O mesmo banco, pela rede interna do Railway |
| App | Expo Go → `http://IP-do-notebook:3000` | Expo Go → `https://...up.railway.app` |

O banco **já está migrado** (esquema PIEVI em `public`, PIVI antigo em `pivi_legado`). O operador e a bancada também já estão cadastrados.

Configuração local: `.env.cloud` na raiz, fora do Git. O modelo é `.env.cloud.example`. Nenhum script imprime senhas.

> **Uma API por vez.** A API do Railway e o `physical:up` usando o banco do Railway disputam a mesma sessão MQTT. Com a nuvem no ar, não rode `physical:up` com `PHYSICAL_DATABASE_URL` preenchido.

---

## 1. EMQX Cloud (console: cloud-intl.emqx.com)

1. **Deployment ligado.** Em *Deployments*, o status precisa estar **Running**. Se estiver *Stopped*, use **Start**. Se tiver sido excluído, crie um **Serverless** e copie o novo endereço para `EMQX_HOST` em `.env.cloud`, sem `mqtts://` e sem porta.
2. **Usuários** (*Access Control → Authentication*). As senhas estão em `.env.cloud`; abra o arquivo no editor para copiar.
   | Usuário | Senha (`.env.cloud`) | Quem usa |
   |---|---|---|
   | valor de `MQTT_API_USERNAME` | `MQTT_API_PASSWORD` | API no Railway |
   | `bancada-01` | `MQTT_ESP_PASSWORD` | ESP32 |
3. **Permissões** (*Access Control → Authorization*, por usuário):
   | Usuário | Ação | Tópico | Permissão |
   |---|---|---|---|
   | API | Subscribe | `pievi/v1/devices/bancada-01/telemetry` · `state` · `events` · `acks` · `presence` | Allow |
   | API | Publish | `pievi/v1/devices/bancada-01/commands` · `sync` · `receipts` | Allow |
   | bancada-01 | Publish | `pievi/v1/devices/bancada-01/telemetry` · `state` · `events` · `acks` · `presence` | Allow |
   | bancada-01 | Subscribe | `pievi/v1/devices/bancada-01/commands` · `sync` · `receipts` | Allow |
   | bancada-01 | Publish | `pievi/v1/devices/bancada-01/commands` | **Deny** |
4. **Conferir:**
   ```
   npm.cmd run cloud:emqx -w api
   ```
   Testa rede, TLS, login dos dois usuários, a entrega em cada tópico e o bloqueio do ESP publicando comandos.

## 2. API no Railway (console: railway.com, mesmo projeto do PostgreSQL)

1. **New → GitHub Repo →** este repositório, na branch com estas mudanças. O Railway lê o `railway.json` (build pelo `Dockerfile` da raiz, healthcheck em `/health`, 1 réplica).
2. **Variáveis:**
   ```
   npm.cmd run cloud:railway-vars -w api
   ```
   O comando gera `tmp/cloud/railway-variables.env`, que contém senhas e não deve ser compartilhado. No serviço: *Variables → Raw Editor*, cole o conteúdo e use *Update Variables*. `DATABASE_URL` usa a referência `${{Postgres.DATABASE_URL}}` (rede interna); se o serviço do banco tiver outro nome, troque `Postgres`.
3. **Domínio:** *Settings → Networking → Generate Domain* (porta 3000). Copie `https://...up.railway.app` para `CLOUD_API_URL` em `.env.cloud`.
4. **Conferir:**
   ```
   npm.cmd run cloud:check -w api -- --infra
   ```
   Antes do ESP migrar, os itens do ESP aparecem como pendentes. O relatório vai para `tmp/cloud/latest-check.json`.

## 3. Firmware no EMQX (com a bancada ligada)

1. Gere o `secrets.h` apontando para o EMQX:
   ```
   powershell -ExecutionPolicy Bypass -File firmware\tools\gerar-secrets.ps1 -Nuvem
   ```
2. Compile e grave **com as cargas desconectadas**, pelo mesmo procedimento de antes (upload sem apagar a flash: NVS, calibração e configuração são preservadas).
3. No monitor serial: `[MQTT] conectando a mqtts://...` e depois `[MQTT] conectado`. Em seguida rode `npm.cmd run cloud:check -w api`.

TLS: o certificado do EMQX é validado pelo pacote de certificados do ESP-IDF já embutido no core 3.3.x. Não é preciso colar o CA.

## 4. App

```
npm.cmd run cloud:mobile -w api              (celular na mesma rede Wi-Fi do notebook)
npm.cmd run cloud:mobile -w api -- --tunnel  (celular em qualquer rede)
```
Os dados vêm do Railway. No Expo Go, o notebook ainda serve o código do app (Metro). Para não depender dele nem disso, a próxima etapa é publicar o app com EAS (Update ou build instalável).

## Voltar para a bancada local

Os comandos de sempre continuam funcionando. Pare o serviço da API no Railway, gere o `secrets.h` sem `-Nuvem`, grave o firmware e rode `physical:up`.
