# Menu Controle - operação sem estufa

Implementação de 05/11/2026. Sensores, relés e confirmações são simulados na API. Nenhum equipamento físico ou tabela do banco operacional é alterado. A autenticação existente continua funcionando.

## Abrir a versão nova

Na raiz do projeto, mantenha dois terminais:

```powershell
npm.cmd run dev:api
```

```powershell
npm.cmd run start -w mobile -- --go --tunnel ngrok --port 8081 --clear
```

Entre com sua conta, abra **Controle** e use as abas **Manual**, **Sensores** e **Horários**. A configuração aplicada, versão, data, fuso, relógio simulado e contagem diária aparecem no início.

## Manual

Cada bomba tem modo independente. Toda operação pede confirmação e é validada novamente na API:

| Ação | Comportamento |
| --- | --- |
| Ligar por tempo | B1: 1 a 300 s; B2: 1 a 60 s. Duração escolhida no campo da bomba. |
| Desligar por 1 h | Desliga e mantém MANUAL_OFF por uma hora; depois volta ao AUTO. |
| Voltar ao AUTO | Devolve o controle aos sensores e regras aplicadas; pode iniciar imediatamente. |
| Testar 10 s | Aciona temporariamente, mantendo as proteções de água e do DHT/UR de B2. |
| Rearmar falha | Limpa a falha simulada da bomba e retorna ao AUTO. Não representa reparo físico. |
| Ignorar boia | Exceção supervisionada: B1 até 120 s, B2 até 60 s, uma bomba por vez. Exige confirmar presença/supervisão. Não desliga permanentemente a proteção de água nem ignora as proteções de B2. |

Repetir comandos novos de ligar não estende o teto contínuo de B1/B2; repetir a exceção não prorroga seu prazo inicial. Um mesmo commandId não executa outra vez e não pode ser reaproveitado com parâmetros diferentes.

O relógio precisa ser confiável para validar comandos remotos. Sem estado recente, o app bloqueia os controles. O estado ligado vem da confirmação e do snapshot do simulador.

Os padrões manuais configuráveis são B1 de 10 a 300 s e B2 de 5 a 60 s, conforme o modelo revisado. Esses padrões alimentam os atalhos do Painel; o comando individual pode escolher outra duração dentro do teto físico.

## Sensores

Os campos exibem unidade e faixa aceita. Decisões aprovadas prevalecem sobre limites antigos do PDF.

| Grupo | Parâmetros |
| --- | --- |
| Irrigação | Solo mínimo 30–80%; máximo 50–95%, pelo menos 5 pontos acima do mínimo; ciclo 30–300 s; pausa 5–30 min; máximo de 5–40 ciclos/dia. |
| Névoa | Temperatura de acionamento 22–40 °C; histerese 1–6 °C; UR mínima 30–70%; trava de UR 80–98%; pulso 10–60 s; pausa 60–1800 s; emergência 30–45 °C. |
| Substrato | Alerta de temperatura 20–35 °C, com recuperação de 2 °C. Apenas alerta, sem acionar bomba. |

B1 liga abaixo do mínimo e para no máximo ou no limite de tempo. B2 inicia por temperatura alta **ou** UR baixa; para por recuperação das condições, limite de pulso ou proteção. Na emergência, a UR de 95% impede névoa. Falha do DHT22 bloqueia B2 e exige três amostras válidas para recuperação.

O bloqueio por água é obrigatório. Campo vazio não é convertido em zero; decimais com vírgula são aceitos onde cabem números fracionários. Durações, contagens e pausas inteiras rejeitam frações.

## Horários

Há dois recursos distintos previstos no documento:

1. **Janela de irrigação:** restringe o AUTO de B1 ao intervalo configurado. Início inclusivo e fim exclusivo. Janela 22:00–06:00 atravessa meia-noite. Manual ignora janela e cooldown, mantendo proteções.
2. **Agenda de reserva (fallback):** usada somente quando o sensor de solo está inválido há mais de 60 s. É diária e usa `America/Sao_Paulo`. Os presets são 07:00, 12:00 e 16:00, por 60 s. É possível adicionar, editar, habilitar, desabilitar e remover horários.

A agenda não gera irrigação extra quando o sensor está saudável. Respeita água, duração máxima de B1, cooldown, janela e limite diário. Sem hora confiável, a agenda é suspensa; a irrigação por sensor pode continuar ignorando a janela, conforme a regra do documento.

Cada horário executa no máximo uma vez por dia. Não há recuperação de horários perdidos. Editar/salvar a configuração não zera a contagem diária nem repete um horário já executado. Horários duplicados são recusados, inclusive entre linhas desabilitadas, acompanhando a unicidade do modelo SQL.

## Aplicação e versões

As alterações ficam em rascunho até **Revisar e aplicar configuração**. Parâmetros e agenda são validados juntos, de forma atômica. Na recusa, a configuração anterior permanece aplicada. O app só mostra a nova versão depois da confirmação e consulta do snapshot.

O rascunho é preservado ao alternar entre Painel, Controle e suas abas. Uma versão mais recente aplicada por outra sessão gera conflito; o usuário precisa recarregar a aplicada antes de salvar. Recarregar com rascunho pede confirmação de descarte. Logout encerra a sessão e descarta o formulário local.

Nesta etapa, configurações, agenda, histórico e comandos ficam em memória. Reiniciar a API restaura os presets e o relógio. Integração MQTT/ESP32 e persistência de configuração no PostgreSQL são etapas futuras. Não há migração SQL nesta entrega.

## Testar sem esperar tempo real

Ao final de Controle, abra **Testar sem a estufa**. Esses recursos só ficam disponíveis em desenvolvimento e exigem sessão e vínculo com a bancada.

- Escolher um cenário modifica somente a bancada simulada e encerra os modos manuais anteriores. A configuração e a contagem diária são mantidas.
- **Avançar 10 s / 1 min / 10 min / 1 h** move o relógio do simulador, processando amostras, agenda e temporizadores. Não altera o relógio do Windows, a expiração da sessão ou o banco.
- O relógio avançado aparece na tela; novas leituras e comandos usam esse mesmo tempo lógico. Outros clientes conectados à mesma API também veem o cenário e o avanço.

### Teste da agenda

1. Em Horários, mantenha a janela desativada para este teste.
2. Clique **Adicionar próximo minuto**, deixe habilitado e com 60 s.
3. Aplique a configuração e aguarde a versão confirmada.
4. Em Testar sem a estufa, selecione **Falha no solo**. Esse preset representa uma falha já estabelecida há mais de 60 s.
5. Clique **Avançar 1 min**. B1 deve iniciar no horário de reserva. Consulte seu estado e o contador diário.
6. Avance mais 1 min: o ciclo deve encerrar. Os eventos aparecem em Histórico.
7. Reaplique a configuração ou atualize: o mesmo horário não deve repetir.

Se o horário já estiver na agenda, edite essa linha ou escolha outro minuto. Se houver cooldown de um ciclo anterior, avance 10 min antes de montar um novo teste e cadastre novamente o próximo minuto.

### Outros testes

| Teste | Procedimento / resultado |
| --- | --- |
| Sensor saudável | Normal + horário do próximo minuto + avançar: não irriga apenas pela agenda. |
| Sensor e hora inválidos | Escolha Solo + hora inválidos: agenda suspensa, alerta HORA_INVALIDA e comandos remotos indisponíveis. |
| Solo seco | Ajuste limites, aplique e escolha Solo seco: B1 inicia conforme demanda, janela, pausa e limite diário. |
| Manual | Ligue uma bomba por 10 s e avance 10 s: volta ao AUTO, sujeito às condições automáticas. |
| MANUAL_OFF | Desligue por 1 h e avance 1 h: retorna ao AUTO. |
| Nível baixo | Ligar/testar normalmente é bloqueado; exceção só com supervisão confirmada e uma bomba por vez. |
| Falha B1/B2 | Automático suspenso; diagnóstico manual permitido se demais proteções estiverem válidas. Rearme encerra a falha simulada. |
| Configuração inválida | Máximo de solo menor que mínimo + 5, duração excessiva, hora inválida ou duplicada: não aplica. |
| Offline | Estado desconhecido, sem envio de comando/configuração. Normal restaura a comunicação simulada. |

Os cenários de falha de bomba são fixtures de falha já detectada; o simulador não valida motor, relé, consumo elétrico, vazão, partida elétrica escalonada ou defeito físico. Os valores são aproximações para desenvolvimento da interface, não calibração ou validação da estufa.

## Contratos e testes

- `api/src/controlConfig.ts`: presets, faixas, validação e interpretação da janela.
- `PUT /v1/devices/:deviceId/config`: mesma configuração, com agenda; `If-Match: "versão"` impede sobrescrita concorrente. GET retorna ETag. Snapshot informa versão e data aplicada.
- `PUT /v1/devices/:deviceId/simulation`: recebe um `scenario` **ou** `advanceSeconds` inteiro de 1 a 3600. Indisponível em produção.
- `RESET_FAULT` e `IGNORE_FLOAT` complementam AUTO, MANUAL_ON, MANUAL_OFF e TEST. Exceção exige `supervisionConfirmed=true` e duração válida.
- `npm.cmd run test:control -w api` e `npm.cmd run test:control -w mobile` cobrem regras da agenda, validação, limites, exceção e conversão dos formulários.
- TypeScript, build da API, testes existentes e bundles Android/iOS/web também foram verificados.

A revisão visual automatizada pelo navegador estava indisponível. A conferência final de layout, teclado e navegação no aparelho ainda deve ser feita pelo responsável.
