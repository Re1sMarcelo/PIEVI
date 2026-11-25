-- Consultas de H1 a H4 sobre o banco da API (PostgreSQL, esquema public).
-- Horários: ts/inicio/aberto_no_esp_em = relógio do ESP (NTP, resolução de 1 s);
--           criado_em/confirmado_em/recebido_em/aberto_em = relógio do PostgreSQL (clock_timestamp, resolução de µs).
-- Parâmetros: ajuste o período em :ini/:fim (aqui, todo o histórico).

-- H1-a) Irrigação (B1): tempo entre o instante em que a condição ficou satisfeita
--        (solo < solo_min E nível OK) e o início do ciclo automático.
--        Condição satisfeita = o mais tarde entre a última leitura com solo >= mínimo (antes do ciclo)
--        e o fim do último alerta NIVEL_BAIXO (antes do ciclo). Pausas legítimas (cooldown) entram no tempo.
WITH cfg AS (SELECT solo_min FROM config_atual LIMIT 1),
ciclos AS (SELECT inicio FROM acionamentos WHERE atuador = 'irrigacao' AND origem = 'auto'),
gatilho AS (
  SELECT c.inicio,
    GREATEST(
      -- início da sequência atual de solo seco: 1ª leitura após a última com solo >= mínimo
      (SELECT min(l.ts) FROM leituras l WHERE l.ts <= c.inicio AND l.solo_confiavel
         AND l.ts > coalesce((SELECT max(l2.ts) FROM leituras l2, cfg WHERE l2.ts <= c.inicio AND l2.solo_confiavel AND l2.umid_solo >= cfg.solo_min), '-infinity')),
      (SELECT max(a.resolvido_no_esp_em) FROM alertas a WHERE a.codigo = 'NIVEL_BAIXO' AND a.resolvido_no_esp_em <= c.inicio)
    ) AS condicao_em
  FROM ciclos c)
SELECT count(*) AS n,
  count(*) FILTER (WHERE extract(epoch FROM inicio - condicao_em) <= 60) AS ate_60s,
  round(100.0 * count(*) FILTER (WHERE extract(epoch FROM inicio - condicao_em) <= 60) / nullif(count(*), 0), 1) AS pct,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM inicio - condicao_em)) AS mediana_s,
  max(extract(epoch FROM inicio - condicao_em)) AS maximo_s
FROM gatilho;

-- H1-b) Névoa (B2) por temperatura: leituras com temp_ar acima de temp_nevoa_on e ciclos automáticos de névoa.
SELECT (SELECT count(*) FROM leituras, config_atual WHERE temp_ar > temp_nevoa_on) AS leituras_acima_do_limiar,
       (SELECT count(*) FROM acionamentos WHERE atuador = 'nevoa' AND origem IN ('auto', 'emergencia')) AS ciclos_auto_nevoa;

-- H2) Comando -> confirmação do ESP, por tipo e atuador.
--     criado_em = chegada do pedido na API; confirmado_em = chegada do ack "accepted" do ESP (relógio do banco).
--     Comandos do app têm id_externo "<epoch>-<aleatório>-<bomba>"; os demais vieram de scripts de teste.
SELECT tipo, atuador, (id_externo ~ '^[0-9]+-') AS veio_do_app, count(*) AS n,
  count(*) FILTER (WHERE extract(epoch FROM confirmado_em - criado_em) <= 10) AS ate_10s,
  round(100.0 * count(*) FILTER (WHERE extract(epoch FROM confirmado_em - criado_em) <= 10) / count(*), 1) AS pct,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM confirmado_em - criado_em))::numeric, 2) AS mediana_s,
  round(max(extract(epoch FROM confirmado_em - criado_em))::numeric, 2) AS maximo_s
FROM comandos WHERE confirmado_em IS NOT NULL
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;

-- H3-a) Boia: mudança no ESP (aberto_no_esp_em, já após o filtro de 5 s) -> registro no banco (aberto_em).
--        O app mostra o nível na próxima consulta (polling de 2 s): somar até 2 s.
SELECT count(*) AS n,
  round(percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM aberto_em - aberto_no_esp_em))::numeric, 2) AS mediana_s,
  round(max(extract(epoch FROM aberto_em - aberto_no_esp_em))::numeric, 2) AS maximo_s
-- (somente após a API ir para o Railway, 22/11 18:55 UTC)
FROM alertas WHERE codigo = 'NIVEL_BAIXO' AND aberto_no_esp_em IS NOT NULL AND aberto_em >= '2026-11-22T18:55:00Z';

-- H3-b) Alguma bomba ficou ligada durante nível crítico? (tolerância de 2 s: resolução de 1 s do ESP)
--        Alerta encerrado por reinício do ESP não tem resolvido_no_esp_em: usa resolvido_em (fechamento pela API).
SELECT a.id AS alerta, x.atuador, x.origem, x.inicio, x.fim, a.aberto_no_esp_em, coalesce(a.resolvido_no_esp_em, a.resolvido_em) AS fim_alerta
FROM alertas a JOIN acionamentos x
  ON x.inicio < coalesce(a.resolvido_no_esp_em, a.resolvido_em, 'infinity') AND coalesce(x.fim, 'infinity') > coalesce(a.aberto_no_esp_em, a.aberto_em) + interval '2 seconds'
WHERE a.codigo = 'NIVEL_BAIXO';

-- H4) Perda de leituras: janelas contínuas (sem lacuna > 60 s); previstas = duração / heartbeat; lacunas > 1,5 x heartbeat.
--     Heartbeat: 15 s até o firmware de 22/11 19:15 UTC; 10 s depois.
WITH l AS (SELECT ts, ts - lag(ts) OVER (ORDER BY ts) AS gap, lag(ts) OVER (ORDER BY ts) AS anterior FROM leituras WHERE ts IS NOT NULL),
j AS (SELECT ts, gap, sum(CASE WHEN gap IS NULL OR gap > interval '60 seconds'
        OR (ts >= '2026-11-22T19:15:00Z' AND anterior < '2026-11-22T19:15:00Z') THEN 1 ELSE 0 END) OVER (ORDER BY ts) AS janela FROM l)
SELECT janela, min(ts) AS inicio, max(ts) AS fim, count(*) AS registradas,
  CASE WHEN min(ts) >= '2026-11-22T19:15:00Z' THEN 10 ELSE 15 END AS heartbeat_s,
  floor(extract(epoch FROM max(ts) - min(ts)) / CASE WHEN min(ts) >= '2026-11-22T19:15:00Z' THEN 10 ELSE 15 END) + 1 AS previstas_min,
  count(*) FILTER (WHERE gap > (CASE WHEN ts >= '2026-11-22T19:15:00Z' THEN 15 ELSE 22.5 END) * interval '1 second' AND gap <= interval '60 seconds') AS lacunas
FROM j GROUP BY janela HAVING count(*) > 5 ORDER BY janela;

-- H4-b) Leituras inválidas por sensor (sensor presente na mensagem, mas sem valor confiável).
SELECT count(*) AS total,
  count(*) FILTER (WHERE NOT dht_confiavel) AS dht22_invalidas,
  count(*) FILTER (WHERE NOT raiz_confiavel) AS ds18b20_invalidas,
  count(*) FILTER (WHERE NOT solo_confiavel) AS solo_invalidas
FROM leituras;
