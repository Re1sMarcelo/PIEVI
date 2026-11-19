# Registro do teste presencial — ESP32

Copiar para `tmp/physical-bench/registro-2026-11-20.md`. Não registrar senhas/tokens. Seguir `GUIA-TESTE-ESP-FISICO.md`.

- Data, horários e participantes:
- Commit da API/app e versão do firmware:
- Notebook/IP e broker/porta (sem credenciais):
- Chip físico / deviceId / client ID:
- Configuração aplicada (versão):
- Calibração solo (ID / ADC seco / ADC água):

Marcar **PASSOU / FALHOU / NÃO TESTADO** e anotar evidência/horário.

| Teste | Resultado | Evidência / observação |
| --- | --- | --- |
| ESP virtual parado; API mode=mqtt, simulation=false | | |
| Acesso API no celular; QR e login físico | | |
| Presença + resposta sync + novas leituras/estado | | |
| Ar, raiz, solo calibrado e boia conferidos | | |
| Relógio confiável e configuração confirmada >= 1 | | |
| Saídas seguras ao iniciar; polaridade/GPIO corretos | | |
| physical:check aprovado antes de energizar | | |
| B1 10 s: saída, corte e histórico | | |
| B2 5 s: saída, corte e histórico | | |
| MANUAL_OFF e retorno AUTO | | |
| Nível baixo/circuito aberto bloqueia/corta ambas | | |
| Falha DHT bloqueia B2; recuperação após 3 leituras | | |
| Falha/recuperação do solo e calibração | | |
| Reconhecer alerta não resolve condição ativa | | |
| Falha de rede não impede corte temporizado local | | |
| Offline e bloqueio de novos comandos | | |
| Reconexão exige sync e não repete comandos | | |
| Reinício ESP preserva NVS e incrementa boot | | |
| Reinício API preserva dados e não repete atuações | | |
| Reabrir app, login/sessão e histórico | | |
| Tetos B1 300 s / B2 60 s, se ensaiados | | |
| Diagnóstico final, saídas seguras e backup | | |

## Pendências

- App/API:
- Firmware/hardware:
- Testes não executados e motivo:
- Próximo passo e responsável:
- Decisão: aprovado / aprovado com pendências / reprovado:
