# Histórico e Alertas na simulação

As duas telas usam a API simulada e atualizam automaticamente a cada cinco segundos. Também é possível puxar a tela para atualizar. Ainda não existe persistência operacional no PostgreSQL nem integração física com o ESP/MQTT.

## Histórico

Escolha uma categoria para abrir os registros, sem misturar todos na mesma lista:

- **Leituras:** temperatura do ar, umidade do ar, umidade do solo, temperatura do substrato ou reservatório. Cada sensor possui sua própria seleção. Leituras sem qualidade aparecem como indisponíveis.
- **Irrigação · B1:** comandos, recusas, conclusões, mudanças de modo e saídas ligadas/desligadas de B1.
- **Névoa · B2:** os mesmos tipos de registro, exclusivos de B2.
- **Alertas:** episódios ativos e resolvidos, com início, resolução, reconhecimento, prioridade e orientação.
- **Configurações:** versões aplicadas e os parâmetros e horários que estavam naquela versão.
- **Sistema:** seleção de cenários e avanços do relógio simulado.

Há filtros **Tudo**, **Última hora** e **Hoje**. As datas usam o fuso da bancada. No histórico de alertas, um episódio entra no período se estava ativo nele, mesmo que tenha começado antes. Registros são ordenados do mais recente para o mais antigo e exibidos em lotes de 20; use **Mostrar mais registros** para continuar. Toque no registro para ver os detalhes.

O histórico é somente para consulta. Uma saída ligada/desligada representa o estado naquele instante. Um comando aceito, isoladamente, não comprova um novo acionamento nem bombeamento físico.

## Alertas

O menu mostra somente episódios sem data de resolução, com críticos primeiro. Reconhecer um alerta registra ciência do operador e preserva a condição ativa. O alerta sai automaticamente desta tela quando a condição é resolvida e continua no Histórico. Não é possível reconhecer um episódio já resolvido. Se a condição reaparecer, será um novo episódio.

Toque em **Ver orientação** para consultar a ação sugerida e reconhecer o alerta. Sem dados recentes, a tela informa que os alertas refletem a última atualização; uma lista vazia nesse estado não confirma normalidade.

## Roteiro sem hardware

1. Em **Controle → Testar sem a estufa**, escolha **Nível baixo**.
2. Abra **Alertas**, consulte a orientação e reconheça o alerta. Ele continua ativo.
3. Volte ao Controle e escolha **Normal**. Após a atualização, o alerta desaparece de Alertas e aparece como resolvido em **Histórico → Alertas**, preservando o reconhecimento.
4. Em Controle, faça um **Teste 10 s** de B1 em **Mais opções**, avance 10 s e consulte **Histórico → Irrigação · B1**. Confira comando, saída ligada, saída desligada e conclusão. B2 não deve receber esses registros.
5. Repita com B2; os registros aparecem em **Névoa · B2**.
6. Altere um parâmetro válido em Sensores e aplique. Confira a versão e seus valores em **Histórico → Configurações**.
7. Avance o relógio e compare os filtros de período e cada sensor em Leituras. Cenários de falha devem produzir “Sem leitura confiável”, sem fabricar zero.

## Retenção e API

`GET /v1/devices/:deviceId/history` exige autenticação e acesso à bancada. Retorna `{ telemetry, events, alerts }` com todos os registros retidos pela simulação, evitando truncar a tela na primeira página de 50 das rotas antigas. O snapshot continua sendo a fonte dos alertas ativos.

São mantidas até 200 leituras, 200 eventos e 200 episódios resolvidos, além dos alertas ativos. Tudo fica em memória e reiniciar a API limpa esses registros. Histórico permanente e consultas de grandes períodos dependem da futura persistência no banco. O layout ainda precisa de conferência em um telefone físico.

Validação automatizada:

```powershell
node --import tsx --test api/tests/history.test.ts mobile/tests/activityModel.test.mjs
```
