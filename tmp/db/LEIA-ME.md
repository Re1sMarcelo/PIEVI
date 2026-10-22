# Modelo de banco PIEVI

O arquivo `db_PIEVI.txt` é o modelo original recebido e foi preservado sem alterações.

O esquema revisado, pronto para avaliação em banco vazio, está em [`../../db/001_schema.sql`](../../db/001_schema.sql). O catálogo de alertas está em [`../../db/002_catalogo_alertas.sql`](../../db/002_catalogo_alertas.sql), e as consultas de referência para autenticação estão em [`../../db/consultas-autenticacao.sql`](../../db/consultas-autenticacao.sql).

A análise das mudanças e das decisões ainda pendentes está em [`../../docs/revisao-modelo-banco.md`](../../docs/revisao-modelo-banco.md). A suíte de integração SQL é executada na raiz com `npm.cmd run test:db`.

A API já usa o PostgreSQL local para login, sessões e vínculo do operador à bancada quando `DATABASE_URL` está configurada; consulte o [guia local](../../docs/autenticacao-local.md). Os dados e controles do simulador continuam em memória. Estes scripts criam uma base vazia; não os execute novamente em uma base existente sem antes criar e revisar uma migração específica.
