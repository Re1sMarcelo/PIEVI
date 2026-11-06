# PIEVI

Aplicativo React Native com Expo e TypeScript, e API Fastify com TypeScript. A primeira fatia usa uma bancada simulada: Painel, Histórico, Alertas, Controle e limites editáveis.

A [entrega do ambiente integrado](docs/entrega-ambiente-integrado.md) começou pelo [Contrato MQTT v1](docs/contrato-mqtt-v1.md), com [schema e exemplos para o ESP32](protocol/mqtt/v1/README.md). A integração MQTT/PostgreSQL e o ambiente Docker serão implementados nas etapas seguintes; a execução atual do app continua simulada.

**Recebeu o projeto para testar no celular Android?** Siga o [guia de execução com Expo Go](GUIA-ANDROID-EXPO-GO.md), incluindo a configuração demo sem PostgreSQL e as instruções para outra IA.

## Requisitos

- Node.js 24.x (24.3.0 ou superior) ou 22.x (22.13.0 ou superior)
- npm
- Expo Go compatível com SDK 58 no celular ou um emulador Android configurado

No PowerShell desta máquina, use `npm.cmd` porque a execução de `npm.ps1` está desabilitada.

## Instalação

Na raiz do projeto:

```powershell
npm.cmd install
```

Crie os arquivos locais `api/.env` e `mobile/.env` conforme o guia ou os exemplos. Deixe `EXPO_PUBLIC_API_URL` vazio para descoberta pelo Expo e uso do proxy no túnel. Para fixar o servidor em rede local, use o IP do computador; `localhost` no celular aponta para o próprio celular. Não compartilhe os `.env` reais ao repassar o projeto.

Com `DATABASE_URL` em `api/.env`, o login aceita usuário ou e-mail cadastrado e usa sessões no PostgreSQL. Confira a conexão com `npm.cmd run db:check -w api` e crie o operador único com `npm.cmd run provision:operator -w api`; o comando pede e-mail opcional e senha no terminal. Veja o [guia de autenticação local](docs/autenticacao-local.md). O arquivo `.env` é ignorado pelo Git.

Para rodar o simulador isolado sem `DATABASE_URL`, o modo local mantém `demo` / `demo` quando `PIEVI_DEMO_AUTH=1` e `NODE_ENV` não é `production`. Essa opção não substitui a autenticação do PostgreSQL quando a conexão está configurada.

## Desenvolvimento

Em terminais separados:

```powershell
npm.cmd run dev:api
npm.cmd run dev:mobile
```

A API responde em `http://localhost:3000/health`. O app mostra que os dados são simulados. Comandos de B1 e B2 são confirmados pelo simulador, sujeitos aos tetos de 300 s e 60 s, e a expiração do modo manual aparece em contagem regressiva.

## Verificação

```powershell
npm.cmd run check
npm.cmd run build:api
npm.cmd run test:simulator -w api
npm.cmd run test:auth -w api
```

As dependências precisam ser instaladas antes de executar os comandos acima. O mobile usa Expo SDK 58, React Native 0.88 e React 19.3. Veja a [validação da migração](docs/validacao-expo-sdk58.md). O SDK Android não foi encontrado neste computador; Expo Go em um aparelho físico pode ser usado sem ele.

As [decisões aprovadas](docs/decisoes-aprovadas.md) e a [arquitetura](docs/arquitetura-proposta.md) orientam a integração com PostgreSQL, MQTT e ESP32. A API usa autenticação persistente quando conectada ao banco; dados e comandos do simulador continuam em memória. O ambiente atual é de desenvolvimento.

O [Painel da estufa com cenários simulados](docs/painel-simulado.md) permite testar leituras, controles temporizados, alertas e falhas diretamente no app. Use **Controle → Testar sem a estufa** para escolher cenários de desenvolvimento. O [menu Controle simulado](docs/controle-simulado.md) inclui parâmetros por sensores, janela, agenda de reserva, duração manual, testes e avanço do relógio sem depender da estufa. O [Histórico e Alertas](docs/historico-alertas-simulados.md) separa os registros por categoria e mantém apenas condições ativas no menu Alertas.

## Modelo de banco

O [modelo PostgreSQL revisado](db/README.md) inclui usuários, sessões e o domínio da bancada. A [revisão do modelo](docs/revisao-modelo-banco.md) registra os ajustes e a política aprovada de operador único com cadastro controlado.

```powershell
npm.cmd run test:db
```

Esse comando valida o SQL em um PostgreSQL isolado em memória, sem acessar o Railway ou mudar o banco da aplicação.
