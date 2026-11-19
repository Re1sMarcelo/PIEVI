# Preparação para o ensaio físico — 19/11/2026

Preparação executada em Windows com Node.js 22.20.0. A placa do colega não estava conectada. Não foram usados o banco externo de `api/.env` nem o banco presencial: os ensaios automatizados usam bancos/portas isolados.

| Verificação | Resultado |
| --- | --- |
| TypeScript app/API/scripts/testes e build da API | Aprovados |
| Bancada física local | 4 testes aprovados: setup repetível de clone novo, início offline sem atuações, preservação de identidade/conta/banco e fluxo com broker externo |
| Integração MQTT existente e ACL | 5 testes aprovados |
| Contrato MQTT | 12 testes aprovados; 32 arquivos exportados conferidos |
| App: conexão, painel e controle | 22 testes aprovados |
| Bundle Android pelo Metro/Hermes | Exportado em `tmp/physical-android`; metadata aponta para bundle `.hbc` gerado |
| Encaminhamento de `--infra` pelo comando raiz | Conferido; sem `.env.physical` neste computador, orienta executar `setup:physical` |
| Pacote de entrega | Guia, checklist e código físico presentes; sem `.env` reais, banco, dependências ou Git |

O fluxo do modo físico foi validado por cliente MQTT de ensaio em teste isolado: presença/sync, telemetria, calibração, configuração confirmada, comando temporizado, recibos, histórico e repetição do mesmo comando sem outro acionamento. O código que inicia a bancada física não instancia esse cliente, não simula sensores e não envia comandos de bomba/configuração automaticamente.

O modo presencial usa PostgreSQL embarcado/PGlite em disco. Não exige Docker e não usa o servidor PostgreSQL externo. Não equivale a um ensaio de carga em servidor PostgreSQL ou a operação em produção. O broker local é autenticado, tem ACL por canal/client ID e fica alcançável na rede da bancada, com credenciais estáveis no `.env.physical` gerado no notebook.

Continuam para o local: instalação e permissões no notebook, comunicação pela rede da estufa, compatibilidade efetiva do firmware, calibração e qualidade física das leituras, GPIOs/relés, bombas, cortes locais, falhas de rede e coleta das evidências. Seguir o [guia presencial](../GUIA-TESTE-ESP-FISICO.md) e preencher o [checklist](checklist-esp-fisico.md).
