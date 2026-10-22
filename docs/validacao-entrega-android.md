# Validação da entrega Android — 22/10/2026

## Resultado executado nesta máquina

- `npm.cmd run check`: tipos do mobile, backend, scripts e testes aprovados.
- `npm.cmd run build:api`: backend compilado.
- `npm.cmd run test:auth -w api`: 18 testes aprovados de autenticação local persistente.
- `npm.cmd run test:google -w api`: 12 testes aprovados de autenticação Google, vínculo e solicitações.
- `npm.cmd run test:db`: 18 testes aprovados do esquema/consultas SQL.
- `npm.cmd run test:simulator -w api`: limites, expiração, idempotência e configuração aprovados.
- `npx.cmd expo install --check`: dependências alinhadas ao SDK 57.
- `npx.cmd expo export --platform android`: bundle Android gerado com sucesso.
- `expo prebuild --platform android --no-install`: projeto nativo Android gerado em cópia isolada em `tmp/google-native-check`, sem alterar os fontes principais.
- `expo-modules-autolinking react-native-config --platform android --json`: confirmou resolução Android de `react-native-nitro-google-signin` e `react-native-nitro-modules` nessa cópia.

Os 48 testes SQL/API usam PostgreSQL isolado via PGlite. Os testes Google geram JWTs RSA com chave de teste local e usam a biblioteca Google real com as chaves públicas de teste: assinatura, emissor, destinatário, validade e nonce são efetivamente verificados. Não há credencial Google real embutida ou bypass de verificação na aplicação.

## Limites dessa validação

Não foi compilado/instalado um APK completo no Android físico e não foi feita seleção de uma conta Google real nesta máquina. O ambiente do colega precisa registrar clientes OAuth, certificado SHA-1, seu operador e banco, gerar/instalar a development build e realizar esse teste. O [guia](../GUIA-ANDROID-EXPO-GO.md) contém os passos completos.

A geração de bundle e de projeto nativo valida etapas distintas da compilação Gradle/NDK e do comportamento no aparelho. Elas não são uma afirmação de que a autenticação real já foi executada no celular.

A extensão `003_google_auth.sql` foi validada nos testes isolados; não foi aplicada automaticamente ao banco PIEVI do autor. A API local mantém o login persistente existente e deixa Google desabilitado enquanto `GOOGLE_CLIENT_IDS` não for configurado. O modo demo sem PostgreSQL continua disponível na cópia do colega, conforme o guia.

## Dependências

`npm audit` reportou alertas na árvore de ferramentas do Expo/Metro/React Native e dependências transitivas, incluindo `node-forge` e `braces`, sem correção compatível indicada para toda a cadeia nesta versão SDK 57. Não foi executado `npm audit fix --force` nem atualizado o SDK fora do escopo. A entrega é de desenvolvimento; os testes funcionais acima não equivalem a uma auditoria de segurança de produção.

## Materiais entregues

O ZIP e o primeiro commit incluem fontes, lockfile, SQL, testes, exemplos de ambiente, documentação e referências de design/requisitos. Não incluem `.env` reais, senhas, tokens, keystores, dependências instaladas, caches, logs ou bundles de execução.
