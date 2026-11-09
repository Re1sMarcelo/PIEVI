# Validação do ambiente integrado — 09/11/2026

Ambiente executado em Windows, Docker Desktop com engine Linux, Node 22.20 no host e Node 24 no container da API. A bancada usada em todos os ensaios foi virtual. O PostgreSQL anterior do usuário não foi alterado.

| Verificação | Resultado |
| --- | --- |
| TypeScript mobile/API/scripts/testes e build da API | Aprovados |
| Contrato MQTT v1 | 12 testes aprovados; 32 arquivos exportados conferidos |
| Persistência e esquema SQL | 26 testes de persistência e 18 de esquema aprovados |
| Autenticação, simulador, painel e controle | Suítes aprovadas |
| Provisionamento Compose | 2 testes aprovados, incluindo preservação de senha e recusa de chip/operador/vínculo incompatíveis |
| Integração com broker Aedes/TCP e PGlite | 5 testes aprovados, incluindo atraso determinístico nos temporizadores máximos |
| Roteiro completo do laboratório | 9 verificações aprovadas, incluindo alertas, reconhecimento, configurações e reinício |
| Compose com PostgreSQL 17 e Mosquitto | Build, inicialização nova e reutilização aprovados; 6 verificações de funcionamento e persistência |
| Cliente mobile | Testes de conexão, confirmação de comandos, painel e controle aprovados; bundle Android exportado |

O teste Compose usa o driver `pg` pela rede do Docker. Confere comandos B1/B2, saída informada pelo ESP, término, configuração aplicada, histórico e deduplicação por SQL. Reinicia PostgreSQL, broker, API e ESP, reutiliza a sessão anterior e confirma que não houve outro acionamento para os comandos concluídos.

Dois problemas foram corrigidos durante a validação: o arquivo de senhas do Mosquitto agora é substituído atomicamente ao reiniciar o provisionamento; o ESP virtual registra o início manual após o controlador calcular o prazo, evitando exceder o contrato por milissegundos. Pedidos recusados preservam os metadados do modo anterior.

Relatórios locais: `tmp/compose-validation/latest.json` e `tmp/integrated-validation/latest.json`. O bundle Android ficou em `tmp/expo-integrated-android`. O pacote de entrega é gerado com SHA-256 em `output/entrega`; a inspeção do ZIP confere a ausência de configurações reais e valores privados das configurações locais.

Não houve execução física no celular, validação de relés/sensores, implementação de firmware ESP32 ou implantação em produção. Os testes PGlite serializam transações; não substituem um ensaio de carga ou de concorrência entre múltiplos workers. O ambiente entregue usa um único worker.
