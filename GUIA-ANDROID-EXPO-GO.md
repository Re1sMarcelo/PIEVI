# PIEVI: testar no Android com Expo Go

Guia para o colega que recebeu o projeto e para a IA que vai ajudá-lo. Conferido com o código em 22/10/2026.

## O que este guia executa

O app atual funciona no **Expo Go para Android**, sem gerar APK, instalar Android Studio ou preparar development build. Você verá login, Painel, Histórico, Alertas e Controle de uma **bancada simulada**.

O caminho principal usa login **demo / demo**, API local e dados em memória. Não precisa instalar PostgreSQL, configurar ESP32, MQTT, Railway ou usar a conta pessoal do autor.

**O login Google está implementado para Android**, mas exige credenciais Google, banco e uma development build própria. Essas configurações pertencem ao ambiente do colega e não acompanham o ZIP. A seção “Testar o login Google no Android” abaixo contém o passo a passo. O teste demo continua funcionando no Expo Go sem banco.

| O que testar | Precisa instalar PostgreSQL? | Funciona no código atual? | Aplicativo no Android |
| --- | --- | --- | --- |
| Telas, painel e controles simulados, com login demo/demo | **Não** | Sim | Expo Go |
| Usuário ou e-mail + senha própria, com contas/sessões persistidas | Sim, ou usar uma base PostgreSQL própria já disponível | Sim | Expo Go |
| Entrar com Google ou enviar solicitação de cadastro | **Sim**, banco próprio com a extensão Google | Implementado; configurar clientes OAuth e gerar o APK de desenvolvimento | Development build; não funciona no Expo Go |

**Para testar telas e controles simulados, siga os passos 1 a 7: nenhum banco de dados é necessário.** O cadastro pessoal do autor não acompanha os arquivos. Para testar Google, siga também a seção específica no final; o modo demo não ativa o Google.

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

No celular Android, instale **Expo Go** pela Play Store, publicado pela Expo. O projeto está em **Expo SDK 57**; o Expo Go precisa ser compatível com esse SDK. Consulte [expo.dev/go](https://expo.dev/go) caso seja necessário localizar a versão Android compatível.

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
{"status":"ok","authStorage":"memory","simulation":true,"googleAuthEnabled":false}
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
npm.cmd run start -w mobile -- --go --tunnel --port 8081
```

Aguarde o túnel ficar pronto e o QR aparecer. O túnel pode abrir mais devagar que a rede local e exige internet nos dois aparelhos. `@expo/ngrok` já está declarado como dependência do projeto e será instalado pelo `npm ci`.

Neste projeto, o túnel também encaminha as chamadas da API: `mobile/metro.config.js` envia `/api/*` para a API local em `127.0.0.1:3000`. Não é necessário abrir outro túnel de backend.

Enquanto o túnel estiver ativo, sua URL permite acessar os endpoints do simulador pela internet, sujeitos ao login demo. Use esse caminho para testar a cópia simulada; encerre o Expo com `Ctrl+C` ao terminar.

## 6. Abrir no Android e fazer login

1. Mantenha **API e Expo** abertos no computador.
2. Abra o **Expo Go** no Android e use **Scan QR code / Ler QR code**.
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
| Expo Go diz que o SDK é incompatível | O projeto é SDK 57. Confira a versão do Expo Go e instale a compatível. Não rebaixe o projeto automaticamente. |
| QR dá timeout ou não abre | Use o QR atual; teste o túnel. No modo LAN, confira rede privada, firewall, VPN e isolamento do Wi-Fi. |
| App abre, mas o login dá `fetch failed` ou erro de rede | Confira `/health`, `/api/health` e o conteúdo de `mobile/.env`. A API precisa continuar aberta. |
| Login demo/demo dá credenciais inválidas | Confira `PIEVI_DEMO_AUTH=1`, `NODE_ENV=development`, ausência de `DATABASE_URL` e de credenciais próprias no modo demo; reinicie a API. |
| Porta 3000 ocupada | Verifique se a API já está aberta. Reutilize a instância ou encerre o processo correspondente. O proxy usa 3000; não mude só a porta da API. |
| Porta 8081 ocupada | Encerre uma instância antiga do Expo ou utilize a instância correta. Evite iniciar vários terminais com QRs diferentes. |
| Mudança de configuração não aparece | Pare o Expo e inicie novamente; se preciso, acrescente `--clear` ao comando escolhido. |
| Sessão antiga expirada | Volte ao login e entre novamente. O modo em memória perde sessões ao reiniciar a API. |
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

## Testar o login Google no Android

### O Google precisa do nosso banco para autenticar?

O Google confirma a identidade da conta nos servidores dele; ele não usa o banco PIEVI para verificar a senha Google. **Mas autenticar no Google não cadastra nem autoriza automaticamente uma pessoa no PIEVI.**

Nesta implementação, a API consulta/persiste a conta autorizada, o vínculo da identidade Google, a sessão e, para uma pessoa desconhecida, a solicitação de cadastro. Portanto, **o teste completo Google do PIEVI usa PostgreSQL**. Um teste isolado do SDK Google sem banco não demonstra a autorização nem a solicitação persistida do PIEVI.

### A. Preparar o banco do colega

Instale PostgreSQL 17 ou superior e crie uma base vazia própria, por exemplo `PIEVI_TESTE`. Pelo pgAdmin ou cliente SQL, conectado nessa base, execute `db/001_schema.sql` e `db/002_catalogo_alertas.sql`, nessa ordem. Não execute esses scripts iniciais sobre tabelas já existentes.

Configure `api/.env` na sua cópia:

```dotenv
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://postgres:SUA_SENHA_LOCAL@localhost:5432/PIEVI_TESTE
```

Na raiz:

```powershell
npm.cmd run db:check -w api
npm.cmd run db:migrate-google -w api
npm.cmd run provision:operator -w api
```

A migração Google cria `identidades_externas` e `solicitacoes_acesso`. Execute-a uma vez por base, depois de `001_schema.sql`. O provisionamento pede seu usuário, nome, **seu Gmail que será selecionado no Google** e uma senha local do PIEVI. Essa senha local é separada da senha Google. Só um operador ativo é permitido; se já houver um, não crie outra conta nem altere a regra por conta própria.

Para contas existentes, confirme no banco que `usuarios.email` contém o endereço Google pretendido. O cadastro do autor não foi exportado; crie seu operador na sua base.

### B. Gerar e instalar o APK de desenvolvimento

As dependências `expo-dev-client`, `react-native-nitro-google-signin` e `react-native-nitro-modules` já estão declaradas e são instaladas por `npm ci`. `mobile/eas.json` já possui o perfil `development`, que gera APK. O package Android de desenvolvimento em `mobile/app.json` é **`com.pievi.mobile.dev`**. Use exatamente esse valor ao registrar o cliente Google.

O caminho abaixo usa compilação na nuvem EAS, sem exigir Android Studio no computador. É necessário entrar na sua conta Expo e dispor de acesso/cota EAS. Não exige assinatura Apple nem publicação na Play Store. Qualquer contratação ou serviço pago deve ser decidido por você, não pela IA.

No PowerShell:

```powershell
cd C:\PIEVI\mobile
# Para uma cópia recebida por ZIP, sem metadados Git:
$env:EAS_NO_VCS="1"
$env:EAS_PROJECT_ROOT=(Resolve-Path ..).Path
npx.cmd eas-cli@latest login
npx.cmd eas-cli@latest build:configure --platform android
npx.cmd eas-cli@latest build --platform android --profile development
```

Adapte `C:\PIEVI` ao local real. A raiz do EAS deve incluir o monorepo, não só `mobile`, para preservar o lockfile e os workspaces. O assistente poderá criar/vincular um projeto Expo da sua conta e adicionar seu `projectId` à configuração. Quando pedir a assinatura Android, use uma keystore de desenvolvimento própria/gerenciada pelo EAS. Não envie keystore, `credentials.json` ou senhas para outra pessoa ou para o GitHub.

Quando a compilação terminar, abra **o link de instalação desse APK** no Android e instale o **PIEVI**. Se o Android solicitar permissão, autorize a instalação para o navegador usado. Esse é um app próprio; não o abra pelo Expo Go. O APK pode ser gerado antes de preencher o ID Web Google, pois a development build carrega o JavaScript atualizado do Metro depois.

### C. Configurar Google Cloud com os clientes corretos

1. No [Google Cloud Console](https://console.cloud.google.com/), crie ou selecione seu projeto de teste.
2. Configure a tela de consentimento/Google Auth Platform com nome, contato e público do app. Se estiver em modo de testes, inclua como testadores as contas Google que pretende usar.
3. Crie um **OAuth client do tipo Web application**. Copie o **Client ID**, terminado em `.apps.googleusercontent.com`. O fluxo implementado verifica ID token e **não exige client secret** no app ou na API. Não coloque segredo do cliente no mobile.
4. Descubra o **SHA-1 da assinatura do APK instalado**, usando as credenciais Android desse mesmo projeto/perfil no EAS:

   ```powershell
   npx.cmd eas-cli@latest credentials --platform android
   ```

   Selecione o perfil `development` e consulte o certificado/keystore usado na build. Anote o fingerprint SHA-1. Se o painel do Expo já o exibir, pode copiá-lo de lá. Se tiver apenas a keystore, `keytool -list -v -keystore CAMINHO_DA_KEYSTORE` mostra o SHA-1; a senha é informada no terminal, nunca no código.

5. No mesmo projeto Google Cloud, crie o **OAuth client do tipo Android** com package `com.pievi.mobile.dev` e esse SHA-1. Se gerar o APK por outra keystore, registre também seu SHA-1. O certificado precisa corresponder ao APK realmente instalado.
6. Configure as duas pontas com o **mesmo ID do cliente Web**. O ID Android serve para registrar package/certificado; não o use como `webClientId`.

Em `api/.env`, adicione:

```dotenv
GOOGLE_CLIENT_IDS=SEU_CLIENT_ID_WEB.apps.googleusercontent.com
```

Em `mobile/.env`:

```dotenv
EXPO_PUBLIC_API_URL=
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=SEU_CLIENT_ID_WEB.apps.googleusercontent.com
```

Essa implementação Android usa o ID Web explícito. Não exige Firebase ou arquivo `google-services.json`. O módulo Android inclui Credential Manager/Google Play Services e é vinculado automaticamente na build.

### D. Executar e entrar com Google

Reinicie a API na raiz, no terminal 1:

```powershell
cd C:\PIEVI
npm.cmd run dev:api
```

Confira `http://localhost:3000/health`: deve informar `authStorage: "postgres"` e **`googleAuthEnabled: true`**. Se a API não iniciar, confira a conexão, a aplicação de `003_google_auth.sql` e o ID OAuth Web. Não habilite demo como alternativa para resolver uma falha Google.

No terminal 2, também na raiz:

```powershell
npm.cmd run start -w mobile -- --dev-client --tunnel --port 8081
```

Para rede local, use `--lan` no lugar de `--tunnel`, com os mesmos cuidados de rede já explicados neste guia. Leia o QR atual para abrir **no PIEVI development build**, ou abra o PIEVI instalado e selecione o servidor. A API deve continuar na porta 3000.

Na tela de login, toque em **Continuar com Google** e selecione a conta correspondente ao e-mail do operador criado. Não digite sua senha Google nos campos do PIEVI. Para Gmail/Workspace válido e autorizado, a API cria uma sessão PIEVI e abre o Painel. Para uma conta Google com e-mail de terceiro, o primeiro vínculo pode exigir a senha **local PIEVI** para confirmar a conta existente.

### E. Conferir solicitação de pessoa ainda não cadastrada

Selecione outra conta Google, incluída como testadora no projeto Google Cloud. O app perguntará se deseja enviar nome/e-mail para análise. Ao confirmar, a API grava uma solicitação pendente. Repetir a entrada mostra o pedido existente; não cria vários usuários/pedidos.

O estado fica na sua base, consultável por SQL:

```sql
SELECT id, email, nome, status, criado_em
FROM public.solicitacoes_acesso
ORDER BY criado_em DESC;
```

Ainda não há tela de aprovação, envio de e-mail ou liberação de novos usuários. Essas decisões continuam com o responsável. O pedido **não** cria operador ativo nem autoriza acesso a controles. O login de uma conta autorizada é funcional independentemente dessa decisão futura.

### Erros específicos do Google

| Erro/sintoma | Conferência |
| --- | --- |
| Google exige development build | Abra o PIEVI instalado pelo APK, não o Expo Go. |
| Módulo Nitro/Google ausente | Refaça e reinstale a development build depois de adicionar as dependências nativas. Metro sozinho não atualiza o APK. |
| `DEVELOPER_ERROR` ou configuração Google inválida | Confira package, SHA-1 da assinatura instalada, cliente Web no `.env` e clientes no mesmo projeto Google Cloud. |
| Google não permite a conta de teste | Inclua-a nos testadores da tela de consentimento; confira o público do projeto Google. |
| `googleAuthEnabled: false` | Configure `GOOGLE_CLIENT_IDS` no backend e reinicie a API. |
| Tabela `identidades_externas`/`solicitacoes_acesso` não existe | Aplique a extensão Google na base configurada, uma vez, com `npm.cmd run db:migrate-google -w api`. |
| Desafio/identidade expirou | Toque em Continuar com Google novamente. Desafios e confirmações são temporários e de uso único. |
| Cadastro aguarda análise | Isso é o resultado esperado para quem não tem conta autorizada; consulte a fila SQL. |
| Conta desativada não entra | O Google não reativa contas nem contorna a autorização local. |

### O que foi validado nesta entrega

Passaram typecheck, build da API, exportação do bundle Android, geração nativa Android em cópia isolada e resolução/autolinking dos módulos Google/Nitro. Os testes Google verificam JWTs RSA assinados com uma chave local de teste usando a biblioteca Google real, incluindo falhas de assinatura, nonce, cliente, emissor e expiração. Os testes SQL usam PostgreSQL isolado em memória.

**Não houve teste com conta Google real no aparelho nem compilação de APK instalado**, pois os IDs OAuth/certificados do ambiente de teste e o Android físico pertencem ao colega. Os passos B a E são a configuração e validação final no ambiente dele.

## Instruções para a IA que receber este projeto

Há dois caminhos: **demo no Expo Go, sem banco**, e **Google na development build Android, com banco e OAuth**. Siga o caminho pedido pelo colega; se a tarefa inclui Google, complete a seção Google em vez de encerrar após testar demo/demo. O código já está implementado: configure o ambiente e teste, sem recriar a funcionalidade.

- Leia este guia e os `package.json` da raiz, `api` e `mobile`; identifique o sistema operacional e a pasta real da cópia antes de usar comandos.
- Use o lockfile e os npm workspaces existentes. Preserve Expo SDK 57 e as versões compatíveis do projeto.
- Crie `.env` locais de demonstração sem copiar credenciais do autor. Não imprima senhas, hashes de senha, tokens ou `DATABASE_URL` real.
- Inicie a API na 3000 e o Expo explicitamente com `--go`. Teste `/health` antes de diagnosticar o app, e `/api/health` para verificar o proxy.
- Mantenha API e Expo em execução para o teste no celular. Informe qual QR é o atual e se o caminho é LAN ou túnel.
- Para testar só o modo demo, use Expo Go e dispense banco/EAS. Para testar Google, siga a seção correspondente: o código está implementado, mas depende da base, das credenciais OAuth e da development build do colega.
- A aprovação de novos cadastros continua pendente; não crie perfis, contas adicionais ativas ou rotas de aprovação sem decisão do responsável.
- Se a dependência do túnel for solicitada, confira primeiro se `npm ci` foi concluído e se `@expo/ngrok` está instalado no workspace `mobile`; não instale ferramentas globais sem necessidade.
- As decisões funcionais aprovadas estão em `docs/decisoes-aprovadas.md`. Novos perfis, usuários simultâneos, aprovação de cadastros e liberação de acesso exigem decisão do responsável.
- O contexto histórico está em `contexto-codex-cli.md`, mas IPs, PIDs, QRs e URLs de túnel de lá pertencem à máquina/sessão do autor. Descubra os valores atuais nesta máquina.
- Antes de encerrar, informe os comandos executados, a URL de saúde, o modo de autenticação e qualquer erro ainda pendente. Não diga que testou em Android físico se não houve teste no aparelho.

Verificações disponíveis: `npm.cmd run check`, `npm.cmd run build:api`, `npm.cmd run test:auth -w api`, `npm.cmd run test:google -w api` e `npm.cmd run test:db`. Os testes SQL usam PostgreSQL isolado em memória; não dependem de uma instalação PostgreSQL local. Eles não substituem a entrada real pelo seletor Google no Android configurado.

## Referências oficiais

- [Executar o projeto e usar túnel no Expo](https://docs.expo.dev/get-started/start-developing/).
- [Expo Go compatível para Android](https://expo.dev/go).
- [Login Google e necessidade de development build](https://docs.expo.dev/guides/google-authentication/).
