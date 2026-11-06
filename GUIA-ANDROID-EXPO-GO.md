# PIEVI: testar no celular com Expo Go (Android e iPhone)

Guia para o colega que recebeu o projeto e para a IA que vai ajudá-lo. Atualizado para Expo SDK 58 em 23/10/2026.

## O que este guia executa

O app atual funciona no **Expo Go para Android**, sem gerar APK, instalar Android Studio ou preparar development build. Você verá login, Painel, Histórico, Alertas e Controle de uma **bancada simulada**.

O caminho principal usa login **demo / demo**, API local e dados em memória. Não precisa instalar PostgreSQL, configurar ESP32, MQTT, Railway ou usar a conta pessoal do autor.

| O que testar | Precisa instalar PostgreSQL? | Funciona no código atual? | Aplicativo no Android |
| --- | --- | --- | --- |
| Telas, painel e controles simulados, com login demo/demo | **Não** | Sim | Expo Go |
| Usuário ou e-mail + senha própria, com contas/sessões persistidas | Sim, ou usar uma base PostgreSQL própria já disponível | Sim | Expo Go |

**Para testar telas e controles simulados, siga os passos 1 a 7: nenhum banco de dados é necessário.** O cadastro pessoal do autor não acompanha os arquivos.

## 1. O que receber e instalar

Receba a pasta do projeto com, pelo menos:

```text
PIEVI/
  package.json
  package-lock.json
  api/
    package.json
    .env.example
    src/
    scripts/
    tests/
    tsconfig.json
    tsconfig.check.json
  mobile/
    package.json
    .env.example
    app.json
    App.tsx
    index.ts
    metro.config.js
    tsconfig.json
    src/
  db/
  docs/
  GUIA-ANDROID-EXPO-GO.md
```

Preserve os demais arquivos de código/configuração que acompanham o projeto. `tmp/` contém material de trabalho do autor e não é necessário para executar o app.

Ao preparar a cópia, **exclua `api/.env`, `mobile/.env`, `node_modules`, `.expo`, pastas `dist` e logs**. Os `.env` do autor contêm configuração particular; `.gitignore` não exclui arquivos automaticamente de um ZIP criado manualmente. A máquina do colega terá seus próprios arquivos locais, descritos abaixo.

No computador, instale:

- **Node.js 24.x, versão 24.3.0 ou superior dessa linha**, com npm, pelo [site oficial](https://nodejs.org/en/download). Também é compatível Node 22.13.0 ou superior da linha 22. Esses mínimos vêm do React Native instalado no projeto.
- Um editor, como VS Code, se quiser consultar o código. Git é necessário apenas se receber por repositório.

No celular, instale **Expo Go compatível com SDK 58** pela Play Store (Android) ou App Store (iPhone), publicado pela Expo. O projeto está em **Expo SDK 58**; o Expo Go precisa ser compatível com esse SDK. Consulte [expo.dev/go](https://expo.dev/go) caso seja necessário localizar a versão Android compatível.

Os comandos abaixo são para **Windows/PowerShell**. Em macOS/Linux, use `npm` e `npx` no lugar de `npm.cmd` e `npx.cmd`, e adapte os caminhos.

## 2. Instalar as dependências do projeto

Abra um PowerShell na raiz da cópia recebida. Nos exemplos, a pasta é `C:\PIEVI`; substitua se estiver em outro local.

```powershell
cd C:\PIEVI
node --version
npm.cmd --version
npm.cmd ci
```

Instale **na raiz**: o projeto usa npm workspaces (`api` e `mobile`) e um único `package-lock.json`. Não rode instalação separada em cada pasta nem troque o gerenciador de pacotes.

## 3. Configurar o modo demo na cópia do colega

Crie `api/.env` com exatamente estas opções para o teste:

```dotenv
PORT=3000
NODE_ENV=development
PIEVI_DEMO_AUTH=1
```

Nesse modo, **não defina `DATABASE_URL`, `OPERATOR_USERNAME` ou `OPERATOR_PASSWORD_HASH`**. Se `DATABASE_URL` estiver presente no arquivo ou nas variáveis do processo, a API escolherá o PostgreSQL e não aceitará automaticamente demo/demo.

Crie `mobile/.env` com:

```dotenv
EXPO_PUBLIC_API_URL=
```

Deixar a variável vazia permite ao app descobrir o computador pelo Expo e usar o proxy quando estiver em túnel. Não copie um IP ou um endereço `exp.direct` da máquina do autor.

Se essas cópias já tiverem `.env` próprios, confira seu conteúdo antes de ajustar. As configurações deste guia se aplicam ao ambiente demo do colega.

## 4. Iniciar a API — terminal 1

Na raiz do projeto:

```powershell
cd C:\PIEVI
npm.cmd run dev:api
```

Mantenha esse terminal aberto. No navegador do computador, abra:

```text
http://localhost:3000/health
```

A resposta esperada é:

```json
{"status":"ok","authStorage":"memory","simulation":true}
```

Se aparecer `authStorage: "postgres"`, existe uma configuração de banco no ambiente. Para este teste, retire essa configuração **da cópia/processo do colega** e reinicie a API. O banco do autor não é necessário.

Se houver uma variável `DATABASE_URL` herdada do Windows, pode removê-la apenas deste terminal antes de iniciar a API:

```powershell
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
```

Isso não remove dados nem configurações globais; altera somente o ambiente do PowerShell atual. Confira também o `.env`, pois o servidor o carrega ao iniciar.

## 5. Iniciar o Expo — terminal 2

Escolha **um** dos caminhos abaixo. O comando `--go` seleciona explicitamente Expo Go.

### Caminho A: rede local

Use quando o Android e o computador estiverem em redes que conseguem se comunicar. O computador pode estar no cabo e o celular no Wi-Fi do mesmo roteador; isso depende da configuração da rede. Wi-Fi de visitantes pode bloquear o acesso.

```powershell
cd C:\PIEVI
npm.cmd run start -w mobile -- --go --lan --port 8081
```

Se o Firewall do Windows perguntar, permita o acesso do Node.js na rede privada que está usando.

### Caminho B: túnel, para redes diferentes ou com bloqueio

Se a rede local não funcionar, encerre o Expo do caminho A com `Ctrl+C` e execute:

```powershell
cd C:\PIEVI
npm.cmd run start -w mobile -- --go --tunnel ngrok --port 8081
```

Aguarde o túnel ficar pronto e o QR aparecer. O túnel pode abrir mais devagar que a rede local e exige internet nos dois aparelhos. `@expo/ngrok` já está declarado como dependência do projeto e será instalado pelo `npm ci`.

Neste projeto, o túnel também encaminha as chamadas da API: `mobile/metro.config.js` envia `/api/*` para a API local em `127.0.0.1:3000`. Não é necessário abrir outro túnel de backend.

Enquanto o túnel estiver ativo, sua URL permite acessar os endpoints do simulador pela internet, sujeitos ao login demo. Use esse caminho para testar a cópia simulada; encerre o Expo com `Ctrl+C` ao terminar.

## 6. Abrir no Android e fazer login

1. Mantenha **API e Expo** abertos no computador.
2. No Android, abra o **Expo Go** e use **Scan QR code / Ler QR code**. No iPhone, leia o QR pela Câmera e abra no Expo Go.
3. Leia o **QR atual do terminal do Expo no computador do colega**. Não use PNGs antigos da pasta `tmp`, QR de outra sessão ou endereços do autor.
4. Aguarde o primeiro carregamento do bundle.
5. No campo **Usuário ou e-mail**, digite `demo`. Na senha, digite `demo`.

Não há um e-mail demo cadastrado: use o usuário `demo` nesse modo. E-mail com senha própria depende da opção PostgreSQL descrita adiante.

Você deve conseguir navegar pelo Painel, Histórico, Alertas e Controle. Os dados são simulados. Os comandos B1/B2 atuam no simulador; nenhum ESP32 está conectado. Reiniciar a API no modo demo apaga sessões e alterações mantidas em memória.

## 7. Conferir a API pelo caminho usado pelo app

No computador, com ambos os terminais ativos, abra:

```text
http://localhost:8081/api/health
```

Ela deve retornar o mesmo resultado de `/health` na porta 3000. Se receber 502, o Expo está ativo, mas não conseguiu falar com a API na porta 3000.

No caminho de rede local, teste também pelo navegador do Android:

```text
http://IP_DO_COMPUTADOR:3000/health
```

Use `ipconfig` no Windows para descobrir o IPv4 da conexão ativa. `localhost` no celular é o próprio celular, não o computador.

Se a descoberta automática selecionar o IP errado em rede local, defina **na cópia do colega**:

```dotenv
EXPO_PUBLIC_API_URL=http://IP_DO_COMPUTADOR:3000
```

Substitua pelo IPv4 real. Pare e reinicie o Expo após mudar o `.env`. Para voltar ao túnel, deixe `EXPO_PUBLIC_API_URL` vazio novamente; uma URL explícita tem prioridade sobre a descoberta automática.

## Problemas comuns

| Problema | O que conferir |
| --- | --- |
| `npm.ps1` bloqueado | Use os comandos `npm.cmd`/`npx.cmd` deste guia; não precisa alterar a política do PowerShell. |
| Instalação falha por versão Node | Confira `node --version`, instale uma versão compatível e abra um novo terminal. Execute `npm.cmd ci` na raiz. |
| Expo Go diz que o SDK é incompatível | O projeto é SDK 58. Confira a versão do Expo Go e instale a compatível. Não rebaixe o projeto automaticamente. |
| QR dá timeout ou não abre | Use o QR atual; teste o túnel. No modo LAN, confira rede privada, firewall, VPN e isolamento do Wi-Fi. |
| App abre, mas o login dá `fetch failed` ou erro de rede | Confira `/health`, `/api/health` e o conteúdo de `mobile/.env`. A API precisa continuar aberta. |
| Login demo/demo dá credenciais inválidas | Confira `PIEVI_DEMO_AUTH=1`, `NODE_ENV=development`, ausência de `DATABASE_URL` e de credenciais próprias no modo demo; reinicie a API. |
| Porta 3000 ocupada | Verifique se a API já está aberta. Reutilize a instância ou encerre o processo correspondente. O proxy usa 3000; não mude só a porta da API. |
| Porta 8081 ocupada | Encerre uma instância antiga do Expo ou utilize a instância correta. Evite iniciar vários terminais com QRs diferentes. |
| Mudança de configuração não aparece | Pare o Expo e inicie novamente; se preciso, acrescente `--clear` ao comando escolhido. |
| Sessão antiga expirada | Volte ao login e entre novamente. O modo em memória perde sessões ao reiniciar a API. |
| Abre diretamente no painel | Uma sessão salva válida permite retomar o app. O app agora valida essa sessão na API antes de abrir o painel; use o botão Sair para acessar o login. |
| Carregamento demora ou fica sem dados | As requisições têm limite de 12 s. Confira API e proxy; uma falha ao validar a sessão salva apresenta o login com a mensagem de conexão. Para ngrok, reinicie com `npm.cmd run start -w mobile -- --go --tunnel ngrok --port 8081 --clear`. |
| Usuário/e-mail pessoal do autor não entra | Isso é esperado no demo. A conta pessoal está no banco local do autor, não nos arquivos de código. Use demo/demo ou provisione seu próprio banco. |

## Opcional: testar com PostgreSQL e senha própria

Faça isso somente se precisar testar a persistência de autenticação; não é necessário para abrir no Expo Go.

1. Instale PostgreSQL 17 ou superior e crie uma base vazia própria.
2. Nessa base, execute `db/001_schema.sql` e `db/002_catalogo_alertas.sql`, nessa ordem. Os scripts iniciais não são uma migração para tabelas já existentes.
3. Configure `DATABASE_URL` em `api/.env` com as credenciais da sua base. O servidor usa o schema `public`.
4. Na raiz, execute `npm.cmd run db:check -w api`.
5. Execute `npm.cmd run provision:operator -w api`. Cadastre seu usuário, e-mail opcional e senha no terminal.
6. Reinicie a API e entre com o usuário ou e-mail criado e a mesma senha. Nesse modo, demo/demo deixa de ser uma alternativa automática.

Só um operador ativo é permitido. As sessões passam a ser persistidas no banco; os dados e comandos da bancada continuam no simulador em memória. Detalhes em [docs/autenticacao-local.md](docs/autenticacao-local.md).

## Instruções para a IA que receber este projeto

Há dois caminhos de login local: **demo sem banco** e **usuário ou e-mail e senha com banco PostgreSQL**. O app não oferece autenticação Google.

- Leia este guia e os `package.json` da raiz, `api` e `mobile`; identifique o sistema operacional e a pasta real da cópia antes de usar comandos.
- Use o lockfile e os npm workspaces existentes. Preserve Expo SDK 58 e as versões compatíveis do projeto.
- Crie `.env` locais de demonstração sem copiar credenciais do autor. Não imprima senhas, hashes de senha, tokens ou `DATABASE_URL` real.
- Inicie a API na 3000 e o Expo explicitamente com `--go`. Teste `/health` antes de diagnosticar o app, e `/api/health` para verificar o proxy.
- Mantenha API e Expo em execução para o teste no celular. Informe qual QR é o atual e se o caminho é LAN ou túnel.
- A aprovação de novos cadastros continua pendente; não crie perfis, contas adicionais ativas ou rotas de aprovação sem decisão do responsável.
- Se a dependência do túnel for solicitada, confira primeiro se `npm ci` foi concluído e se `@expo/ngrok` está instalado no workspace `mobile`; não instale ferramentas globais sem necessidade.
- As decisões funcionais aprovadas estão em `docs/decisoes-aprovadas.md`. Novos perfis, usuários simultâneos, aprovação de cadastros e liberação de acesso exigem decisão do responsável.
- O contexto histórico está em `contexto-codex-cli.md`, mas IPs, PIDs, QRs e URLs de túnel de lá pertencem à máquina/sessão do autor. Descubra os valores atuais nesta máquina.
- Antes de encerrar, informe os comandos executados, a URL de saúde, o modo de autenticação e qualquer erro ainda pendente. Não diga que testou em Android físico se não houve teste no aparelho.

Verificações disponíveis: `npm.cmd run check`, `npm.cmd run build:api`, `npm.cmd run test:auth -w api`, `npm.cmd run test:connection -w mobile` e `npm.cmd run test:db`. Os testes SQL usam PostgreSQL isolado em memória; não dependem de uma instalação PostgreSQL local.

## Referências oficiais

- [Executar o projeto e usar túnel no Expo](https://docs.expo.dev/get-started/start-developing/).
- [Expo Go compatível para Android](https://expo.dev/go).
