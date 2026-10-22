# Horta semi-hidropônica

Termos usados para descrever a operação e a segurança da bancada e da futura estufa.

## Água e acionamento

**Boia de nível**:
Sensor que indica se há água disponível no reservatório para as bombas.
_Evitar_: sensor de umidade do solo

**Nível baixo**:
Condição em que a boia indica falta de água ou seu circuito está aberto.
_Evitar_: reservatório vazio

**B1**:
Bomba de irrigação do substrato.
_Evitar_: bomba de névoa

**B2**:
Bomba de névoa ou aspersão do ambiente.
_Evitar_: bomba de irrigação

**Ignorar boia**:
Exceção supervisionada para testar uma única bomba apesar da indicação de nível baixo.
_Evitar_: operação normal sem boia

## Modos de operação

**AUTO**:
Modo em que o ESP32 decide os acionamentos a partir das leituras e limites configurados.
_Evitar_: controle remoto contínuo

**MANUAL_ON**:
Pedido temporário para ligar uma bomba específica, sujeito às proteções do ESP32.
_Evitar_: bomba permanentemente ligada

**MANUAL_OFF**:
Pedido temporário para manter uma bomba específica desligada, sujeito às proteções do ESP32.
_Evitar_: desativação permanente

**Emergência de calor**:
Condição de temperatura do ar extrema em que a névoa usa pulsos especiais, respeitando o limite de UR e as proteções de segurança.
_Evitar_: temperatura alta do substrato

## Operação e acompanhamento

**Operador**:
Pessoa autenticada responsável por acompanhar a bancada, ajustar seus parâmetros e solicitar comandos. O protótipo aprovado tem um único operador, sem divisão de perfis.
_Evitar_: administrador, leitor

**Comando aceito**:
Pedido que o ESP32 confirmou como admissível. O aceite não comprova que a bomba esteja efetivamente ligada.
_Evitar_: acionamento confirmado

**Acionamento**:
Período de operação de uma bomba informado pelo dispositivo, com início e, quando encerrado, fim.
_Evitar_: pedido de comando

**Configuração aplicada**:
Conjunto de parâmetros cuja aplicação foi confirmada pelo ESP32. Uma configuração solicitada ainda sem confirmação não representa os limites em operação.
_Evitar_: última configuração enviada

**Reconhecimento de alerta**:
Registro de que o operador tomou ciência de um alerta. A condição que o originou pode continuar ativa até sua resolução.
_Evitar_: resolução do alerta
