# Manter segurança local e descartar comandos vencidos

O ESP32 mantém as proteções e a automação local mesmo sem rede. Comandos manuais têm ID e validade; os pendentes expiram e não são executados após a reconexão. Se a hora confiável se perder, o fallback agendado de irrigação é suspenso com alerta. A decisão evita acionamentos atrasados ou baseados em horário incerto, ao custo de suspender parte da automação até a sincronização.
