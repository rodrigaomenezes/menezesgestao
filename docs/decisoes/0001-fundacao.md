# 0001 — Fundação: isolamento, acesso e registro

Data: 2026-10-08 · Fase 0

## Isolamento entre empresas

**Decisão:** duas barreiras. (1) O código de negócio só toca no banco por `comEmpresa(banco, empresaId, fn)`, que abre
uma transação, executa `SET LOCAL ROLE mg_app` e `set_config('app.empresa_id', …)`. (2) Toda tabela com `empresa_id`
tem RLS com a política `empresa_id = app_empresa_id()`; sem contexto, nada aparece.

**Por que papel próprio e não `FORCE ROW LEVEL SECURITY`:** o login, as sessões, as migrações e os jobs precisam
enxergar além de uma empresa. Com o dono das tabelas reservado a esse caminho (`comoSistema`) e o papel `mg_app` sem
`BYPASSRLS` para todo o resto, a regra fica clara e testável. `mg_app` não tem `DELETE` em nada, não lê senha
(permissão por coluna), sessões nem tokens.

**Como provamos:** `src/db/rls.test.ts` testa direto no banco; `src/isolamento.test.ts` percorre todas as rotas
registradas trocando `:id` por identificadores da outra empresa e compara um retrato dos dados dela antes e depois.
O teste foi validado desligando de propósito o RLS e o filtro de uma rota: ele falha.

## Banco e migrações

**Decisão:** Drizzle para as consultas; o esquema nasce de arquivos SQL em `migracoes/`, escritos para rodar duas
vezes sem efeito (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`, `CREATE OR REPLACE`). O servidor aplica as pendentes a cada
início, com `pg_advisory_lock`.

**Por quê:** RLS, papéis, permissões por coluna e gatilhos não cabem bem no gerador de migrações; SQL explícito é mais
fácil de revisar. Datas com precisão de milissegundos (`timestamptz(3)`) para o cursor de paginação ser exato.

## Acesso

- Toda rota `/api` declara `config.acesso`: `{ publica }`, `{ autenticada }` ou `{ modulo, acao }`. O gancho
  `onRoute` impede o servidor de subir com rota sem declaração.
- Permissões do perfil em JSON `{ modulo: { acao: escopo } }`. O escopo vira condição SQL (`filtroUsuariosVisiveis`).
- O perfil de Dono é protegido; sempre sobra uma pessoa ativa com ele. Dar um perfil que administra algo exige
  `usuarios:administrar`.
- Sessão: token aleatório no cookie `HttpOnly`, `SameSite=Lax`, `Secure` quando `APP_URL` é https; o banco guarda
  o HMAC (com `SESSION_SECRET`). CSRF por double submit (`mg_csrf` + cabeçalho `x-csrf-token`).
- Senha: Argon2id, mínimo de 10 caracteres; bloqueio a partir da 5ª falha (1, 2, 4… até 60 minutos) e limite por IP.

## Registro automático

- `registrar()` grava auditoria (antes/depois, sem campos sensíveis) e publica o evento na mesma transação.
- O evento avisa o tempo real por `pg_notify`, entregue pelo PostgreSQL só depois do COMMIT. Cada instância escuta o
  canal e entrega às suas conexões SSE conforme empresa, permissão de "ver" e escopo.
- `auditoria` e `evento` têm gatilhos que barram `UPDATE`, `DELETE` e `TRUNCATE` até para o dono do banco.

## Avisos e jobs

- Interface `ProvedorAvisos` com demonstração (grava em `aviso_saida`) e SMTP (nodemailer).
- E-mails vão pela fila pg-boss, enfileirados dentro da transação (o job só existe se a ação confirmar) e com o
  conteúdo cifrado em AES-256-GCM, porque levam links de acesso.
- Limpeza de sessões e tokens vencidos é um job agendado, nunca `setInterval`.

## Front

React + Vite + React Router, PWA com `vite-plugin-pwa` (só a casca em cache nesta fase). Sem variáveis globais nem
`innerHTML` (o lint barra). A marca da empresa vira variáveis CSS; a cor do texto sobre ela é escolhida pelo contraste.
