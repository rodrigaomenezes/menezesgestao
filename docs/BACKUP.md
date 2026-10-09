# Backup e restauração do banco

Decisão: ADR-028. Os backups diários são os do próprio Railway; este roteiro prova que eles voltam.

## 1. Ligar os backups (uma vez)

No Railway, abra o serviço **Postgres** → aba **Backups** → crie os agendamentos **Diário** e **Semanal**
(os backups do Railway dependem do plano pago). Os backups ficam junto do volume do banco.

## 2. Testar a restauração (todo mês, e antes de qualquer mudança grande)

Restaurar por cima do banco de produção não é teste. Teste numa cópia:

1. Crie um banco vazio para o teste (no Railway: **New → Database → PostgreSQL**, num ambiente separado; ou um
   PostgreSQL 16 no seu computador).
2. Copie os dados de produção para ele. Pelo terminal (com o PostgreSQL 16 instalado), usando as URLs públicas
   dos dois bancos (Railway → Postgres → Variables → `DATABASE_PUBLIC_URL`):
   ```bash
   pg_dump --format=custom --file copia.dump "<URL do banco de produção>"
   pg_restore --dbname "<URL do banco de teste>" --exit-on-error copia.dump
   ```
   Para testar um backup do Railway em vez da cópia lógica: restaure o backup no banco de teste pelo painel.
3. Confira a cópia contra a original:
   ```bash
   DATABASE_URL="<URL do banco de teste>" REFERENCIA_URL="<URL do banco de produção>" npm run backup:conferir
   ```
   O comando confere as migrações, se a separação entre empresas (Row Level Security) veio junto e se nenhuma
   tabela tem menos linhas que a original. Mostra só números — nenhum dado pessoal. Sai com erro se algo não
   conferir.
4. Apague o banco de teste e o arquivo `copia.dump` (eles têm dados pessoais).

O mesmo roteiro roda no CI a cada PR (`tests/integration/backup.test.ts`): cópia → banco novo → conferência.

## 3. Restaurar de verdade (incidente)

1. Pare a escrita: tire o app do ar (no serviço do app, remova o deploy ativo ou escale para zero) para ninguém
   gravar durante a volta.
2. Restaure o backup escolhido pelo painel do Postgres (aba **Backups → Restore**) e aplique a mudança.
3. Rode `DATABASE_URL=<produção> npm run backup:conferir` e, se as migrações estiverem atrás, `npm run db:migrate`.
4. Suba o app de novo e confira `/api/health`.
5. Registre o incidente: o que se perdeu entre o backup e a falha (o histórico de eventos ajuda a refazer).
