# Decisões aprovadas

Estas decisões foram confirmadas pelo responsável pelo projeto em 21/10/2026, com a política de cadastro reafirmada em 22/10/2026. Parâmetros numéricos ainda não listados aqui seguem pendentes de aprovação.

1. Nível baixo ou circuito aberto da boia bloqueia B1 e B2. Ignorar boia é permitido somente para teste supervisionado, por até 2 minutos, uma bomba por vez, com registro de quem acionou.
2. Em calor extremo, a névoa pode operar em pulsos com umidade relativa entre 90% e 95%; para em UR igual ou superior a 95%, nível baixo ou falha de segurança.
3. MANUAL_ON é sempre temporizado. MANUAL_OFF expira após 1 hora. Ambos obedecem às proteções locais do ESP32.
4. O primeiro protótipo terá um único operador autenticado, sem perfis diferentes.
5. A fatia simulada mostrará alertas dentro do app. Notificações push e a meta de entrega em até 30 segundos ficam para a integração posterior.
6. O primeiro protótipo terá Painel, Histórico, Alertas e Configurações/Controle, com B1 e B2 separados e expiração visível.
7. O contrato MQTT/API terá ID, validade e confirmação de comandos. O broker e as credenciais serão escolhidos antes da integração com o ESP32 real.
8. Os valores sugeridos no PDF de estados serão presets editáveis e provisórios para a bancada, sujeitos à validação física. Entre eles: solo 60/75%, névoa a 28 °C ou UR abaixo de 50%, pulso 60 s, pausa 5 min e emergência a 35 °C.
9. Cada pulso de B2 tem teto físico de 60 s, inclusive em modo manual e emergência.
10. B1 em MANUAL_ON tem duração padrão de 120 s e teto físico de 300 s por acionamento.
11. Se o relógio do ESP32 perder hora confiável, o fallback agendado do sensor de solo é suspenso e um alerta é gerado. A automação independente de horário pode continuar.
12. O protótipo terá login de um operador com usuário e senha, hash da senha no backend e sessão por token com expiração.
13. Comandos manuais pendentes expiram e não são executados após reconexão. O app sincroniza e mostra primeiro o estado real do ESP32.
14. A arquitetura e os contratos em `docs/arquitetura-proposta.md` foram aprovados como base para a primeira fatia simulada. O broker e as credenciais serão decididos antes da integração real.
15. Se o DHT22 perder confiabilidade, novos acionamentos de B2 ficam bloqueados em AUTO e manual, com alerta. B2 é liberada após 3 leituras válidas consecutivas.
16. UR acima de 85% durante 30 minutos gera alerta de atenção. UR igual ou superior a 98% durante 30 minutos mantém B2 bloqueada e gera alerta crítico; a emergência de calor já corta B2 imediatamente em UR igual ou superior a 95%.
17. Heartbeat de 15 s, indicação OFFLINE após 45 s sem comunicação e validade de 10 s para comando manual são presets provisórios para validação na bancada.
18. Manter operador único com cadastro/provisionamento controlado, login por usuário e senha e sem cadastro público no aplicativo. Não haverá divisão em perfis admin, operador e leitor neste protótipo. Política confirmada em 22/10/2026 após a revisão do modelo de banco.
19. Em 22/10/2026, o responsável solicitou permitir login por usuário **ou e-mail cadastrado**, usando a mesma senha. O e-mail permanece opcional e é associado à conta por procedimento controlado. O acesso continua restrito ao operador único.
20. O responsável pediu autenticação Google com acesso controlado e solicitações pendentes. **Pedido cancelado em 23/10/2026; ver decisão 23.**
21. Em 23/10/2026, o responsável pediu uma opção Google compatível com Expo Go em iPhone e Android. **Pedido cancelado em 23/10/2026; ver decisão 23.**
22. Em 23/10/2026, após confirmação de Expo Go 58.0.5 no iPhone e incompatibilidade com o SDK 57 do projeto, o responsável aprovou migrar para Expo SDK 58, React Native 0.88 e React 19.3. A atualização mantém Expo Go em iPhone/Android e as decisões funcionais anteriores.
23. Em 23/10/2026, o responsável cancelou o login Google. O login local por usuário ou e-mail cadastrado e senha permanece ativo.
