# Menezes Gestão — regras do projeto

Plataforma SaaS **white-label** de operações comerciais (CRM, WhatsApp, telefonia, fila de ligações, rotina e
desempenho da equipe), em português do Brasil.

Documentos de referência (leia antes de qualquer fase):
- `PROMPT_MESTRE.md` — instrução permanente do agente: princípios, estrutura, definição de pronto, checklists.
- `ESPECIFICACAO.md` — o produto (funcional). Fonte da verdade das regras de negócio.
- `ARCHITECTURE.md` — como o sistema está montado hoje. `DECISIONS.md` — ADRs. `TECH_DEBT.md` — dívida registrada.
- Precedência: regra funcional aprovada → especificação → arquitetura → decisões → implementação → preferência do agente.

## Princípios inegociáveis
1. **Multiempresa desde a primeira linha:** `empresa_id` em toda tabela de negócio, filtro injetado numa camada
   única e Row Level Security no PostgreSQL.
2. **Nada de regra de cliente no código.** Diferenças entre empresas = configuração (marca, vocabulário, funis,
   campos, resultados, módulos por plano).
3. **Fornecedores atrás de interfaces** (mensagens, telefonia, avisos, arquivos), cada um com versão de
   demonstração que funciona sem conta externa.
4. **Registro automático:** toda ação publica um evento; histórico, metas, mapa de atividades e tempo real derivam
   dos eventos.
5. **Nada some:** excluir = arquivar com lixeira; exclusão definitiva só por administrador, com auditoria.
   Migrações aditivas e idempotentes.
6. **Telefone normalizado** (E.164, regra do nono dígito) é a chave de deduplicação em contatos, conversas e filas.
   Webhook repetido nunca duplica nada.
7. **Celular primeiro:** toda tela funciona em 360 px; app instalável (PWA) com push.
8. **Segurança:** permissão checada no servidor em toda rota; segredos só em variáveis de ambiente ou
   criptografados (AES-256-GCM) no banco — nunca em código, log ou chat.
9. **Português claro** na interface; mensagens de erro dizem o que a pessoa pode fazer.
10. **Lições do sistema de origem:** sem variáveis globais no front, sem `innerHTML`, sem segredo com valor padrão,
    sem `setInterval` para rotinas (use fila de jobs), sem listagem sem paginação, sem JSON acima de 1 MB
    (arquivos vão por upload próprio) e sem módulo que falhe em silêncio.

## Pilha e estrutura
Node.js 20 + TypeScript, Fastify, PostgreSQL + Drizzle, Zod, React + Vite como PWA, SSE, pg-boss, Vitest e Playwright
(ADR-001). Monorepo npm workspaces (ADR-005): `apps/api` (módulos por domínio: rotas → serviço → repositório),
`apps/web` (features), `packages/shared` (contrato da API e catálogos), `database/migrations`, `tests/`.
Mudanças de pilha: propor antes.

## Como trabalhar
- Siga o roteiro de fases de `ESPECIFICACAO.md`, uma por vez. No início de cada fase, apresente o plano
  (o que entra, tabelas, rotas, testes dos critérios de pronto) e espere o ok.
- Commits pequenos (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`); testes junto com o código.
  Antes de abrir PR: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`.
- Contrato da API em `@mg/shared` (Zod): toda rota valida entrada, devolve DTO e aparece no OpenAPI.
  Erro sempre `{ error: { code, message, details } }`.
- Ao fim de cada fase, atualize `README.md`, `ROADMAP.md`, `ARCHITECTURE.md`/`DECISIONS.md` quando mudar algo e
  `TECH_DEBT.md`. Responda ao analista no formato da seção 157 do Prompt Mestre.
- Nunca peça senha ou token no chat: diga qual variável de ambiente criar.
- Ambiguidade: escolha o padrão mais simples, siga e anote; pergunte só se mudar o modelo de dados.
- Antes de declarar pronto, releia o diff procurando vazamento entre empresas, rota sem permissão, duplicação por
  telefone, texto em inglês na interface e tela quebrada no celular.

## Deploy
Railway publica a cada merge na `main` (`railway.json`). Healthcheck em `/api/health`. Em produção o servidor
não sobe sem `SESSION_SECRET`, `CRM_CHAVE` e `DATABASE_URL`.
