# Decisões de arquitetura (ADR)

Toda decisão significativa fica registrada aqui (Prompt Mestre, seção 69). Ordem de precedência em caso de
conflito: regra funcional aprovada → especificação técnica → arquitetura aprovada → decisões registradas →
implementação atual.

---

# ADR-001 — Pilha

## Contexto
O `CLAUDE.md` e a especificação sugerem Node.js + TypeScript, PostgreSQL, React como PWA, SSE, fila de jobs, Vitest e Playwright.

## Problema
Escolher as bibliotecas concretas, que a especificação deixa abertas (Fastify ou NestJS, Prisma ou Drizzle, BullMQ ou pg-boss).

## Decisão
Fastify 5, Drizzle ORM com `pg`, pg-boss 10 (fila no próprio PostgreSQL), Zod 4, React 19 + Vite 7 + vite-plugin-pwa,
Vitest 4 e Playwright. Node.js ≥ 20.19.

## Alternativas
NestJS (mais estrutura pronta, mais peso e mágica); Prisma (gerador de migrações, mas RLS e papéis ficam de fora);
BullMQ (exige Redis — uma peça a mais sem necessidade medida, ver Prompt Mestre §43).

## Consequências
Um único banco para dados e jobs; menos serviços para operar. A organização em camadas é feita por convenção
(ADR-005), não por framework.

---

# ADR-002 — Isolamento multiempresa: camada única + Row Level Security

## Contexto
Princípios 001/002: `empresa_id` em toda tabela de negócio e isolamento na aplicação **e** no banco.

## Problema
Garantir que uma consulta que esqueça o filtro não vaze dados, sem impedir login, migrações e jobs, que
precisam enxergar além de uma empresa.

## Decisão
- Todo código de negócio acessa o banco por `comEmpresa(banco, empresaId, fn)`: abre transação,
  `SET LOCAL ROLE mg_app` e `set_config('app.empresa_id', …)`.
- RLS em toda tabela com `empresa_id`: `empresa_id = app_empresa_id()`. Sem contexto, nada aparece.
- `mg_app` não tem `BYPASSRLS`, não tem `DELETE` (exceto `permissao`, ADR-006) e não lê senha, sessões nem tokens.
- O caminho do sistema (`comoSistema`) usa o dono das tabelas: login, sessões, tokens, migrações, jobs, criação de empresa.

## Alternativas
`FORCE ROW LEVEL SECURITY` para todos (o login e os jobs precisariam de exceções nas políticas); banco por empresa
(fica para o modo "instância dedicada", com o mesmo código).

## Consequências
Duas barreiras testadas: `tests/integration/rls.test.ts` (direto no banco) e `tests/integration/isolamento.test.ts`
(todas as rotas, A → B e B → A). Tabela nova com `empresa_id` sem RLS faz o teste falhar.

---

# ADR-003 — Migrações SQL escritas à mão, aditivas e idempotentes

## Contexto
Princípios 018/019 e a lição do sistema de origem (migrações rodando a cada início, sem perda de dados).

## Problema
RLS, papéis, permissões por coluna, gatilhos e CHECKs não cabem bem em geradores de migração.

## Decisão
Arquivos em `database/migrations/NNNN_nome.sql`, escritos para rodar duas vezes sem efeito (`IF NOT EXISTS`,
`DROP POLICY IF EXISTS`, `ON CONFLICT DO NOTHING`). O servidor aplica as pendentes ao iniciar, com
`pg_advisory_lock`; `npm run db:migrate` faz o mesmo à mão. `apps/api/src/infra/esquema.ts` (Drizzle) espelha as
tabelas para as consultas; a fonte da verdade é o SQL. Remoção de coluna sempre em duas etapas.

## Alternativas
drizzle-kit gerando SQL (pouco controle sobre idempotência e RLS).

## Consequências
Cada migração precisa de revisão manual; o teste de migrações reaplica o SQL para provar idempotência.

---

# ADR-004 — Toda rota declara o acesso; checagem antes da validação

## Contexto
Princípio 003: autenticação → empresa → perfil → permissão → escopo em toda operação, no servidor.

## Decisão
Cada rota `/api` declara `config.acesso`: `{ publica }`, `{ autenticada }` ou `{ modulo, acao }`. O gancho
`onRoute` impede o servidor de subir com rota sem declaração. O gancho `preValidation` checa CSRF, sessão, módulo
ativo e permissão **antes** de validar o corpo (quem não pode não recebe nem detalhe de validação). O escopo
concedido vai para `req.escopo` e vira filtro SQL (`filtroUsuariosVisiveis`). RLS protege o isolamento; RBAC
protege a capacidade de ação (Prompt Mestre §112).

## Consequências
Rota nova entra automaticamente na varredura de isolamento e na documentação OpenAPI.

---

# ADR-005 — Monorepo com npm workspaces e módulos por domínio

## Contexto
Prompt Mestre §31–34: `apps/`, `packages/`, `database/`, `docs/`, `tests/`; backend e frontend por domínio.

## Decisão
- `apps/api` (servidor), `apps/web` (front), `packages/shared` (`@mg/shared`: catálogo de permissões, marca, erros,
  DTOs/contrato, slug, datas), `database/` (migrações, seeds, docker), `tests/` (integração e e2e).
- Backend: `apps/api/src/modulos/<dominio>/` com `*.rotas.ts` (apresentação, fina), `*.servico.ts` (aplicação e
  regras) e `*.repositorio.ts` (consultas). `infra/` guarda banco, jobs, erros, paginação e criptografia.
  Diretórios por camada só quando o módulo crescer (não criar estrutura vazia, §33).
- Front: `apps/web/src/{app, ui, features/<dominio>}`.
- Adaptações registradas: comandos de linha (`criar-empresa`, `caixa-de-saida`, `migrar`, `dados-exemplo`) ficam em
  `apps/api/src/cli` porque usam o código da API e precisam ser compilados para produção; testes de unidade ficam
  ao lado do código (`*.test.ts`), os de integração e e2e em `tests/`.
- `@mg/shared` é consumido do código-fonte em desenvolvimento e testes (condição `development`) e do `dist` em produção.

## Alternativas
Pacote único (como na fase 0); Turborepo/Nx (ferramenta a mais sem necessidade agora).

## Consequências
`npm run build` compila na ordem shared → api → web. `npm run typecheck` checa os quatro projetos TypeScript.

---

# ADR-006 — Permissões em tabela própria

## Contexto
Na fase 0 as permissões ficavam em JSON (`perfil.permissoes`). Princípio 015: JSONB é para extensibilidade, não
para substituir modelagem; permissão é estrutural.

## Decisão
Tabela `permissao (perfil_id, modulo, acao, escopo)` com `UNIQUE (perfil_id, modulo, acao)` e `CHECK` nos três
catálogos; RLS por empresa. Trocar as permissões de um perfil remove e recria as linhas daquele perfil — é a
única tabela em que `mg_app` tem `DELETE`; o antes/depois completo vai para a auditoria. A migração 0002 copiou o
JSON; a coluna `perfil.permissoes` não é mais usada e será removida numa migração futura (compatibilidade, §23).

## Alternativas
Manter JSON (sem integridade no banco); versões de permissão com `arquivado_em` (complexidade sem requisito).

## Consequências
Módulo novo exige atualizar o catálogo em `@mg/shared` **e** o `CHECK` em uma migração.

---

# ADR-007 — Contrato da API: esquemas Zod compartilhados, DTOs, OpenAPI e erro padrão

## Contexto
Prompt Mestre §36–39 e §121: validar toda entrada, devolver DTOs, documentação OpenAPI fiel ao código, padrão único de erro.

## Decisão
- Entradas e saídas são esquemas Zod em `@mg/shared` (`dto.ts`). As rotas os usam com `fastify-type-provider-zod`:
  a entrada é validada e a **saída é recortada pelo esquema** (campo que não está no DTO não sai).
- Serviços montam DTOs explícitos (datas em ISO 8601 UTC); nada de devolver a linha do ORM.
- `/api/openapi.json` é gerado dos mesmos esquemas; um teste garante que toda rota está documentada.
- Erro sempre `{ "error": { "code", "message", "details"? } }`, com códigos estáveis em `CODIGOS_ERRO`. Sem stack trace.

## Consequências
O front usa os tipos do contrato (`EuDto`, `UsuarioDto`…) e decide por `code`, não por texto.

---

# ADR-008 — Eventos na transação, tempo real por SSE

## Decisão
`publicar()` grava em `evento` (somente inserção) e chama `pg_notify` dentro da mesma transação: o aviso só sai
depois do COMMIT. Cada instância escuta o canal (`LISTEN`) e entrega às suas conexões SSE conforme empresa,
permissão de "ver" e escopo. Auditoria e evento têm gatilhos que barram `UPDATE`, `DELETE` e `TRUNCATE`.

## Alternativas
WebSocket (bidirecional sem necessidade); fila externa (Redis) para fan-out.

---

# ADR-009 — Jobs e avisos

## Decisão
pg-boss com tentativas limitadas (5, espera crescente) e fila de falhas (`falhas`, dead-letter). E-mails são
enfileirados dentro da transação da ação (o job só existe se ela confirmar) e com conteúdo cifrado (AES-256-GCM),
porque levam links de acesso. O provedor de avisos informa saúde (`ONLINE`, `OFFLINE`, `DEGRADED`,
`CONFIGURATION_ERROR`) em `/api/health`. Sem SMTP, o provedor de demonstração guarda na caixa de saída.

---

# ADR-010 — Branches e ambientes

## Contexto
O Prompt Mestre sugere `main` + `develop` + `feature/*`; o Railway publica a cada merge na `main`.

## Decisão
`main` + branches de trabalho, uma fase (ou correção) por PR. Homologação = **PR Environments** do Railway (cada PR
ganha ambiente próprio com banco próprio), sem branch `develop`. Commits no padrão `feat:`, `fix:`, `refactor:`,
`test:`, `docs:`, `chore:`.

## Consequências
Merge só com CI verde (lint, typecheck, unidade, integração, build, e2e em 5 larguras).

---

# ADR-011 — Identificador (slug) da empresa

## Decisão
`empresa.slug` único, gerado do nome sem acentos (`Clínica São José` → `clinica-sao-jose`; repetido ganha `-2`),
editável pelo dono (3–40 caracteres, minúsculas, números e hífen). Base para subdomínio/domínio próprio (fase 6).
O RLS impede ver os slugs das outras empresas; a unicidade é garantida pelo índice único do banco.

---

# ADR-012 — Convenções de dados

## Decisão
- **Data/hora:** `timestamptz(3)` (UTC, milissegundos); a API devolve ISO 8601; a tela mostra no fuso da empresa.
- **Dinheiro:** inteiro em centavos (`bigint`) no banco e na API; formatação só na tela.
- **Percentual:** `numeric(7,4)` como fração (0,10 = 10%), sem float.
- **Estados e catálogos fechados:** constantes em `@mg/shared` + `CHECK` no banco. Listas que a empresa configura
  (etapas, resultados, tipos de base) viram tabelas, nunca enum.
- **Identificadores:** UUID em toda entidade; nada sequencial exposto.
