# Painel da estufa com cenários simulados

Implementação de 04/11/2026. Mantém a autenticação existente e os dados operacionais em memória. Não exige ESP32 nem altera o banco da aplicação.

Atualização de 05/11/2026: o [menu Controle](controle-simulado.md) passou a executar a agenda de reserva e a permitir ajustar todos os parâmetros, testar falhas de bomba/relógio e avançar o tempo. Os cenários disponíveis agora são 16. As regras abaixo incorporam essa atualização.

## Usar no celular

1. Mantenha a API aberta: `npm.cmd run dev:api`.
2. Reinicie o Expo para carregar os contratos e a tela novos: `npm.cmd run start -w mobile -- --go --tunnel ngrok --port 8081 --clear`.
3. Entre com sua conta e abra **Painel**.
4. Ao final da tela, expanda **Bancada simulada** e escolha um cenário.

A seleção é compartilhada pelos clientes da mesma API em desenvolvimento. Trocar o cenário encerra acionamentos simulados anteriores e retorna as duas bombas para AUTO. A configuração editada é mantida; reiniciar a API apaga cenário, histórico, configurações e comandos em memória.

## Funcionalidades

- Leituras de temperatura do ar, UR, temperatura e umidade do substrato, com qualidade, unidades e data/idade da atualização.
- Reservatório representado pela boia (adequado/baixo), sem inventar percentual de água.
- Modos independentes de B1/B2 e indicação de operação automática, manual ou mista.
- Atualização periódica em 5 s e atualização por gesto; amostras do simulador em 15 s.
- Valores antigos sinalizados: perda da API, ESP offline ou amostra com mais de 45 s não aparentam estado atual válido.
- Toque nos cartões para consultar limites e detalhes. Toque nos equipamentos para abrir comandos com confirmação, retorno do simulador e temporizador.
- Ligar B1 por 120 s, B2 por 30 s, testar por 10 s, manter desligada por 1 h ou retornar ao automático.
- Alertas ativos com ação sugerida e reconhecimento. Reconhecer não resolve a condição; ao normalizar o cenário, o episódio é encerrado e preservado no histórico.
- Tendência de até 20 medições válidas de umidade do solo, acessos a Histórico, Alertas e Controle.

## Cenários disponíveis

| Cenário | Resultado esperado |
| --- | --- |
| Normal | Leituras válidas, solo na faixa e sem alerta artificial. |
| Solo seco | Solo abaixo do mínimo; B1 inicia em AUTO, a leitura sobe durante a irrigação e o ciclo para no limite superior ou no teto de 300 s. |
| Solo úmido | Solo acima da faixa; B1 não inicia automaticamente. |
| Nível baixo | Alerta crítico; B1/B2 não ligam por AUTO, manual ou teste. |
| Calor extremo | Temperatura acima do limite de emergência e UR de 92%; B2 pulsa por até 60 s, respeitando pausa configurada. |
| Calor + UR 95% | Névoa bloqueada apesar do calor; pedidos de ligar/testar B2 são recusados. |
| UR alta por 30 min | Fixture de UR a 99% por 30 min; alerta crítico e bloqueio de B2. O tempo anterior já faz parte deste cenário. |
| Falha no DHT22 | Valores do ar indisponíveis e B2 bloqueada. Após escolher um cenário válido, três amostras válidas consecutivas liberam B2 (a troca produz a primeira). |
| Falha no solo | Umidade indisponível; B1 usa a agenda de reserva com hora confiável e proteções. Teste/manual continuam sujeitos à água e ao tempo. |
| Falha no substrato | Temperatura do substrato indisponível com alerta; outros sensores continuam disponíveis. |
| ESP offline | API acessível, dispositivo offline e amostras congeladas, sem aceitar comandos remotos. |
| Leituras antigas | Presença online, mas amostras antigas: aviso de dados desatualizados e comandos indisponíveis. |
| Hora inválida | Suspende agenda; janela é ignorada na irrigação por sensor. Comandos remotos aguardam hora confiável. |
| Solo + hora inválidos | Sem sensor de solo e sem relógio confiável; não executa a agenda de reserva. |
| Falha B1 | Fixture de falha de irrigação; bloqueia automático e permite diagnóstico/rearme. |
| Falha B2 | Fixture de falha de névoa; bloqueia automático e permite diagnóstico/rearme. |

## Escopo do simulador

As respostas de sensores são aproximações para desenvolver a interface, não um modelo físico validado. A irrigação automática usa presets editáveis de teto 300 s, pausa 10 min e até 20 ciclos por dia no fuso de São Paulo. B2 usa os limites e pausa da configuração. O fallback agendado foi implementado no simulador em 05/11/2026. Calibração física, MQTT e persistência operacional continuam pendentes.

As decisões das bombas ficam no simulador da API; o app não liga uma saída só por ter enviado um pedido. Respostas de consultas anteriores a uma alteração são descartadas para evitar sobrescrever o estado novo. IDs repetidos não repetem o acionamento; reutilizar ID com parâmetros diferentes é recusado.

O endpoint autenticado `PUT /v1/devices/:deviceId/simulation` recebe `{ "scenario": "normal" }`, com IDs definidos em `api/src/contracts.ts`. Exige sessão e vínculo ativo com a bancada. Em `NODE_ENV=production`, o endpoint retorna 404 e os controles de cenário ficam ocultos.

## Validação

- `npm.cmd run check` e `npm.cmd run build:api`.
- `npm.cmd run test:dashboard -w api`: cenários, segurança, temporizadores, idempotência e autorização da rota.
- `npm.cmd run test:dashboard -w mobile`: estado recente, indicadores, prioridades e bloqueios dos controles.
- `npm.cmd run test:connection -w mobile`, `npm.cmd run test:simulator -w api` e `npm.cmd run test:auth -w api`.
- Bundles Android, iOS e web gerados pelo Metro.

A revisão visual automatizada não foi concluída: o acesso ao navegador estava indisponível e a janela nativa não permitiu captura/ativação. No aparelho, verificar cartões em tela estreita, rolagem, abertura/fechamento dos detalhes, confirmação dos comandos, contagem regressiva e mudança entre os 16 cenários.
