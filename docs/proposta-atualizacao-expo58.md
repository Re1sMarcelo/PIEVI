# Atualização proposta para compatibilidade com o iPhone

Status: aprovada pelo responsável em 23/10/2026 com a resposta “pode migrar”; implementação e validação registradas em `validacao-expo-sdk58.md`.

## Evidência

Em 23/10/2026, o túnel recebeu as tentativas do iPhone com `Exponent-Sdk-Version: 58.0.0` e aplicativo Expo Go 58.0.5. O responsável confirmou Expo Go 58.0.5 e iOS 26.3. O manifesto do PIEVI anuncia `exposdk:57.0.0`; seu pacote Expo é 57.0.31.

As tentativas do iPhone consultaram o manifesto, sem baixar o bundle. O build e o download feitos pelo computador passaram, mas não comprovam execução no aparelho. A incompatibilidade de SDK está confirmada; sem o relatório nativo do iPhone, não se pode afirmar que ela explica sozinha o fechamento do processo.

## Alteração proposta

Atualizar o mobile para Expo SDK 58 e alinhar suas dependências com o catálogo oficial do pacote `expo@58.0.17`, consultado no registro npm:

| Pacote | Atual | Alvo |
| --- | --- | --- |
| Expo | 57.0.31 | ~58.0.17 |
| React / React DOM | 19.2.3 | 19.3.0 |
| React Native | 0.86.3 | 0.88.0 |
| expo-constants | ~57.0.22 | ~58.0.13 |
| expo-linear-gradient | ~57.0.2 | ~58.0.3 |
| expo-secure-store | ~57.0.4 | ~58.0.2 |
| expo-status-bar | ~57.0.1 | ~58.0.4 |
| react-native-safe-area-context | ~5.7.0 | ~5.10.1 |
| react-native-svg | 15.15.4 | 15.16.0 |
| @expo/metro-runtime | ~57.0.17 | ~58.0.15 |

Aplicar as adaptações exigidas pelo TypeScript do React Native 0.88, atualizar o lockfile e os guias de execução. Validar o encaminhamento `/api` do Metro e o túnel do novo CLI. Preservar autenticação, banco e decisões funcionais. Continuar usando Expo Go no iPhone e Android.

## Verificação após aprovação

- Checagem TypeScript, compatibilidade de pacotes e Expo Doctor.
- Testes existentes afetados, build da API e bundles iOS/Android.
- Manifesto público anunciando SDK 58, download dos bundles e API pública respondendo.
- Substituir somente `tmp/api_qr.png` se o túnel mudar; confirmar abertura no iPhone com o responsável.

A migração de React Native/React pode exigir ajustes de código; as verificações no computador não substituem o teste físico. Não haverá commit/publicação automática nesta etapa.

Referências oficiais: [guia de atualização](https://expo.dev/blog/how-to-upgrade-to-sdk-58), [compatibilidade do Expo Go](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/), [changelog SDK 58](https://expo.dev/changelog/sdk-58).
