# Login salvo e conexão pelo túnel - 04/11/2026

O app abria o painel ao recuperar um token do SecureStore, antes de confirmar sua validade na API. As requisições não tinham timeout próprio e o endereço automático da API só reconhecia túneis `exp.direct`.

## Correções

- Validar a sessão salva com o snapshot antes de mostrar o painel. Sessão inválida retorna ao login; falha de rede apresenta o login com erro, preservando o token salvo para uma futura tentativa de restauração.
- Limitar cada requisição a 12 segundos e apresentar mensagens para rede, timeout e proxy indisponível.
- Encaminhar hosts públicos de desenvolvimento por HTTPS e `/api`, incluindo o túnel novo do SDK 58. Manter prioridade de `EXPO_PUBLIC_API_URL` e acesso LAN na porta 3000.
- Evitar consultas periódicas simultâneas e descartar respostas de uma sessão encerrada. Sair da interface sem esperar o logout remoto.
- Alinhar as dependências com o catálogo do Expo SDK 58: Expo 58.0.23, Constants 58.0.15, React Native 0.88.1, safe-area 5.11.1 e Metro runtime 58.0.17.

## Validação

- `npm.cmd run check`: mobile e API aprovados.
- `npm.cmd run test:connection -w mobile`: nove testes aprovados, incluindo túneis, 401, erro de rede, proxy e timeout.
- `npm.cmd exec -w mobile -- expo install --check`: dependências atualizadas.
- Metro isolado na porta 8083: bundles Android e iOS gerados com HTTP 200.
- Proxy `/api/health`: HTTP 200 com autenticação PostgreSQL; snapshot sem token: HTTP 401.
- API parada: proxy devolve HTTP 502, reproduzindo a falha de conexão.

Os testes do proxy foram locais; a abertura pelo túnel no celular precisa ser confirmada pelo usuário. Nenhum usuário, senha ou dado do banco foi alterado.

## Reteste no celular

Manter a API rodando com `npm.cmd run dev:api`. Reiniciar o Expo com `npm.cmd run start -w mobile -- --go --tunnel ngrok --port 8081 --clear`, usando o novo QR. Manter `EXPO_PUBLIC_API_URL` vazio para descoberta automática; uma URL explícita tem prioridade. Para ver o login quando a sessão salva ainda é válida, usar o botão Sair.
