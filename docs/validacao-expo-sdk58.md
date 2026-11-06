# Validação da migração para Expo SDK 58 — 23/10/2026

O responsável aprovou a migração após confirmar Expo Go 58.0.5 no iPhone com iOS 26.3. O túnel também registrou `Exponent-Sdk-Version: 58.0.0`, incompatível com o SDK 57 anterior do projeto. Proposta aprovada: `proposta-atualizacao-expo58.md`.

## Implementado

- Expo 58.0.17, React Native 0.88.0, React/React DOM 19.3.0 e tipos React 19.3.0.
- Módulos Expo, SVG e safe-area alinhados ao catálogo do SDK 58; package-lock atualizado.
- Referências de rolagem e campo de senha usam `ScrollViewInstance` e `TextInputInstance`, conforme os tipos do React Native 0.88.
- Requisito Node alinhado às versões aceitas pelo React Native: linha 22 a partir de 22.13, linha 24 a partir de 24.3 ou Node 26+. Máquina validada com Node 22.20.0.
- Guias atualizados para SDK 58 e `--tunnel ngrok`, mantendo o túnel de desenvolvimento já usado, sem exigir login Expo. O novo túnel padrão do SDK 58 exige login; não foi adotado nesta migração.

## Verificações concluídas

| Verificação | Resultado |
| --- | --- |
| Instalação de dependências e resolução de versões | Aprovada |
| `npm.cmd run check` | Mobile, API, scripts e testes aprovados |
| `npm.cmd run build:api` | Aprovado |
| `npx.cmd expo install --check` em mobile | Dependências alinhadas |
| Autenticação local + integrações adicionais da versão então testada | 48 testes aprovados |
| Modelo SQL isolado | 18 testes aprovados |
| Smoke do simulador | Aprovado |
| Manifestos públicos iOS/Android | HTTP 200; SDK 58.0.0 |
| Bundle iOS pelo túnel HTTPS | HTTP 200; 4.356.234 bytes |
| Bundle Android pelo túnel HTTPS | HTTP 200; 4.364.922 bytes |
| API pública pelo proxy `/api/health` | HTTP 200; authStorage postgres |

Total: 66 testes existentes aprovados. Os testes de banco usam PGlite isolado, sem modificar o banco PIEVI.

Expo Doctor 1.21.5: **19/20 verificações aprovadas**. A consulta de metadados ao React Native Directory retornou erro de servidor nas duas tentativas, incluindo execução com `--verbose`. As verificações de versões, pares, duplicatas, configuração Expo e Metro passaram. A consulta externa permanece sem conclusão; não equivale a um problema identificado nas dependências do app.

`npm audit` reportou seis alertas na árvore de dependências (dois moderados, quatro altos, nenhum crítico), relacionados ao CLI/certificados/node-forge e ngrok/uuid. Não foi executado `audit fix --force`; uma recomendação automática de retornar para Expo 44 não é compatível com esta migração. Isso não representa auditoria de segurança completa.

## Execução e limites

Expo foi iniciado com `--go --tunnel ngrok --port 8081 --clear`. O endereço registrado naquela execução era `exp://jd5rrtw-marceloreis2003-8081.exp.direct`; endereços de túnel são temporários.

O bundle foi servido e baixado pelo computador. A abertura física no iPhone após a migração ainda precisa ser confirmada pelo responsável; não afirmar que o fechamento foi resolvido somente com esses testes. Esta validação registrava funcionalidades Google que foram removidas posteriormente. Login local permanece disponível.

Nenhuma migração SQL, alteração de senha, publicação ou commit foi feita nesta etapa. Os ZIPs anteriores são snapshots do SDK 57 e não incluem esta migração.

Referências: [guia oficial da migração](https://expo.dev/blog/how-to-upgrade-to-sdk-58), [changelog SDK 58](https://expo.dev/changelog/sdk-58).
