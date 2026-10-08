# Arquitetura

Visão de como o sistema está montado hoje. As regras de trabalho estão em `PROMPT_MESTRE.md` e `CLAUDE.md`; as
decisões e seus motivos, em `DECISIONS.md`; o produto, em `ESPECIFICACAO.md`.

## Visão geral

```
navegador / app instalado (PWA)
        │  HTTPS, cookie de sessão HttpOnly, CSRF, SSE
        ▼
apps/api (Fastify) ── rotas finas ─► serviços (regras) ─► repositórios (Drizzle) ─► PostgreSQL (RLS)
        │                                  │
        │                                  ├─► registrar(): auditoria + evento (mesma transação)
        │                                  └─► jobs (pg-boss): e-mail cifrado, rotinas agendadas
        ▼
provedores atrás de interfaces (avisos: demonstração | SMTP; arquivos: banco; próximos: mensagens, telefonia)
```

Um único serviço no Railway: o Fastify serve a API e o front compilado (`apps/web/dist`).

## Repositório

```
apps/api/src
  app.ts, server.ts, config.ts      montagem, inicialização (falha cedo), configuração
  infra/                             banco (comEmpresa/comoSistema), esquema Drizzle, migrador, jobs,
                                     erros (ErroApp), paginação por cursor, criptografia e senhas
  modulos/<dominio>/                 *.rotas.ts → *.servico.ts → *.repositorio.ts
    acesso/        sessão, CSRF, permissão × escopo (preValidation), filtro de escopo
    auth/          login, sessões, recuperação de senha, aceite de convite
    empresas/      empresa, slug, marca, unidades, criação de empresa, semente
    usuarios/      pessoas (vínculos), convites, equipes
    permissoes/    perfis e tabela permissao
    auditoria/     registrar/auditar, consulta da auditoria
    eventos/       publicar (pg_notify), tempo real (SSE)
    notificacoes/  sino
    avisos/        interface de e-mail + provedores, com status de saúde
    sistema/       saúde, marca pública, OpenAPI
    arquivos/      interface ProvedorArquivos (provedor "banco": bytea por empresa, com RLS)
    crm/           configuração (funis, etapas, etiquetas, motivos, campos), contatos, oportunidades e kanban,
                   tarefas e notas, importação (planilha → fila crm.importacao), carteira, campos personalizados
  cli/                               criar-empresa, dados-exemplo, caixa-de-saida, migrar
apps/web/src
  app/        api (cliente), sessão, tema, tempo real, casca (menu, sino, aviso de sem conexão)
  ui/         campos, listas paginadas, modal, confirmação, avisos (toast)
  features/   acesso, inicio, usuarios, permissoes, empresa, auditoria, notificacoes, conta,
              crm (contatos, ficha, funil/kanban, tarefas, importar, configurar)
packages/shared/src                 @mg/shared: catálogo, marca, erros, DTOs (Zod, inclusive dto-crm), slug, datas, telefone
database/   migrations/ (SQL), seeds/ (JSON fictício), docker/
tests/      integration/ (Vitest + PostgreSQL real), e2e/ (Playwright, 5 larguras), apoio/
```

## Caminho de uma requisição

1. `onRequest`: limite por IP; cookie de CSRF.
2. `preValidation` (módulo `acesso`): CSRF em toda escrita → sessão → empresa ativa → módulo ativo no plano →
   permissão módulo × ação → escopo em `req.escopo`.
3. Validação do corpo/consulta/parâmetros pelo esquema Zod do contrato.
4. Rota chama o serviço com o contexto (`ContextoEmpresa`), o escopo e a origem (ator, IP, dispositivo).
5. Serviço abre `comEmpresa()` (papel `mg_app`, RLS), aplica as regras, chama o repositório e `registrar()`
   (auditoria + evento) na mesma transação.
6. Resposta recortada pelo DTO; erro sempre `{ error: { code, message, details } }`.
7. Depois do COMMIT, o PostgreSQL entrega o `pg_notify`; cada instância repassa por SSE a quem pode ver.

## Dados

- Toda tabela de negócio: `id` UUID, `empresa_id`, `criado_em`, `atualizado_em`, `arquivado_em` quando cabe, `criado_por`.
- Usuário é global (`usuario`); o vínculo liga usuário × empresa × perfil × unidade × equipe.
- Permissões: `permissao (perfil × módulo × ação × escopo)` com CHECK nos catálogos.
- `evento` e `auditoria` são somente inserção (gatilhos).
- CRM: `contato` tem índice único `(empresa_id, telefone)` com telefone em E.164 (CHECK no banco) — a chave de
  deduplicação. A carteira é `contato.responsavel_id`, filtrada pelo escopo. `evento.contato_id` liga o histórico.
- Campos personalizados: definição em `campo_personalizado`, valores em `campos jsonb` validados pelo serviço.
- Sessões e tokens guardam só o HMAC (`SESSION_SECRET`); conteúdo sensível de jobs vai cifrado (`CRM_CHAVE`).

## Segurança

Cookie `HttpOnly` + `SameSite=Lax` + `Secure` (https), CSRF por double submit, CSP/HSTS (helmet), limite de
requisições, bloqueio progressivo de login, Argon2id, RLS, RBAC com escopo, segredos só em variáveis de ambiente,
token de links fora do log, JSON até 1 MB.

## Testes

| Tipo | Onde | Comando |
| --- | --- | --- |
| Unidade | `apps/*/src/**/*.test.ts`, `packages/*/src/**/*.test.ts` | `npm run test:unit` |
| Integração (banco real) | `tests/integration` | `npm run test:integration` |
| Ponta a ponta (360, 390, 768, 1024, 1440 px) | `tests/e2e` | `npm run test:e2e` |

Testes permanentes de plataforma: isolamento A ↔ B em todas as rotas, RLS no banco, somente inserção da
auditoria, idempotência das migrações, contrato (erro, DTO, OpenAPI).
