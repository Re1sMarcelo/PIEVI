-- Catálogo inicial a partir do PDF de estados e das decisões aprovadas.
-- Os episódios em alertas guardam a severidade, mensagem e ação de cada ocorrência.
BEGIN;
INSERT INTO tipos_alerta (codigo, severidade, mensagem, acao_sugerida) VALUES
  ('NIVEL_BAIXO', 'critico', 'Reservatório abaixo da boia ou circuito aberto. Bombas bloqueadas.', 'Reabastecer e verificar a boia e sua fiação.'),
  ('TEMP_RAIZ_ALTA', 'aviso', 'Temperatura do substrato acima do limite.', 'Sombrear, ventilar e avaliar a bancada.'),
  ('CALOR_EMERG', 'critico', 'Temperatura do ar em emergência de calor.', 'Abrir a lona e ventilar. A névoa continua sujeita aos intertravamentos.'),
  ('GEADA', 'aviso', 'Temperatura do ar abaixo de 5 °C.', 'Proteger as plantas; a lona não garante proteção contra geada.'),
  ('UR_ALTA', 'aviso', 'Umidade relativa elevada por tempo prolongado.', 'Ventilar a estufa. O episódio é crítico quando UR ≥98% por 30 minutos.'),
  ('DHT_FALHA', 'critico', 'DHT22 sem leitura confiável. Novos acionamentos de B2 bloqueados.', 'Verificar o sensor e a fiação. Liberação após três leituras válidas consecutivas.'),
  ('DS18_FALHA', 'aviso', 'Sensor de temperatura do substrato sem leitura válida.', 'Verificar o sensor e sua fiação.'),
  ('SOLO_FALHA', 'critico', 'Sensor de umidade do solo sem leitura válida.', 'Verificar o sensor. O fallback depende de hora confiável e respeita os limites.'),
  ('BOIA_SUSPEITA', 'aviso', 'Comportamento da boia incompatível com a operação observada.', 'Limpar e conferir a boia e o reservatório.'),
  ('IRRIG_FALHA', 'critico', 'Três ciclos de irrigação sem efeito. Automático suspenso.', 'Verificar bomba, filtro, mangueira e sensor antes de testar ou rearmar.'),
  ('NEVOA_FALHA', 'critico', 'Três pulsos de névoa sem efeito. Automático suspenso.', 'Verificar bomba e bicos; ventilar manualmente.'),
  ('BICO_ENTUPIDO', 'aviso', 'Efeito da névoa abaixo do esperado.', 'Limpar os microaspersores e verificar a filtragem.'),
  ('VAZAMENTO_SUSPEITO', 'critico', 'Queda do nível incompatível com a operação esperada.', 'Procurar vazamento, reparar e reabastecer.'),
  ('BOMBA_PRESA', 'critico', 'Suspeita de bomba ou relé que não desliga.', 'Desligar a alimentação e verificar relé e proteção.'),
  ('BOMBA_TEMPO_EXCEDIDO', 'aviso', 'Limite de tempo de operação atingido.', 'Conferir nível de água, configuração e proteções.'),
  ('REINICIO', 'aviso', 'ESP32 reiniciou.', 'Consultar o motivo e verificar alimentação e estabilidade.'),
  ('OFFLINE', 'critico', 'Sem comunicação recente com o ESP32.', 'Checar energia, Wi-Fi e broker MQTT.'),
  ('HORA_INVALIDA', 'aviso', 'ESP32 sem hora confiável. Fallback agendado suspenso.', 'Restabelecer a sincronização do relógio.'),
  ('CONFIG_INVALIDA', 'aviso', 'Configuração recusada ou inválida.', 'Conferir os parâmetros e manter a última configuração válida.'),
  ('MODO_MANUAL', 'info', 'Equipamento em modo manual temporizado.', 'Acompanhar a expiração ou retornar ao modo automático.');
COMMIT;
