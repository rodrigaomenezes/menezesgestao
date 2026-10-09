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
provedores atrás de interfaces (avisos: demonstração | SMTP; arquivos: banco; mensagens: demonstração | API oficial | QR;
próximo: telefonia)
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
    conversas/     canais (credenciais cifradas, conexão, estado), provedores/ (interface ProvedorMensagens:
                   demonstração, cloud-api, qr), entrada (deduplicação em cascata), envio (fila, follow-up),
                   caixa de entrada, respostas rápidas e automações, junção de duplicadas, áudio WebM→Ogg
    arquivos/      interface ProvedorArquivos (provedor "banco": bytea por empresa, com RLS)
    crm/           configuração (funis, etapas, etiquetas, motivos, campos), contatos, oportunidades e kanban,
                   tarefas e notas, importação (planilha → fila crm.importacao), carteira, campos personalizados
    fila/          filas, lotes, tipos de base, itens com reserva exclusiva (FOR UPDATE SKIP LOCKED), resultados
    telefonia/     configuração, ramais SIP, ligações (estados), gravação cifrada + link temporário, retenção (job)
    operacao/      rotina (agrega os módulos que o perfil vê) e check-list, agenda (lembrete por job), escala e
                   horas (ponto, validação, fechamento), indicadores.ts (contagem dos eventos), metas e desempenho,
                   mapa de atividades e atividades manuais, scripts
    receita/       ofertas e entregas (vaga com trava), vendas, calculo-comissao.ts (função pura, centavos),
                   regras, prévia e fechamento de comissão
    qualidade/     critérios e avaliações (nota ponderada, feedback no sino)
    pesquisa/      pesquisas, link público (rotas /api/publico/…) e resultados agregados
  cli/                               criar-empresa, dados-exemplo, caixa-de-saida, migrar
apps/web/src
  app/        api (cliente), sessão, tema, tempo real, casca (menu, sino, aviso de sem conexão)
  ui/         campos, listas paginadas, modal, confirmação, avisos (toast)
  features/   acesso, inicio, usuarios, permissoes, empresa, auditoria, notificacoes, conta,
              crm (contatos, ficha, funil/kanban, tarefas, importar, configurar), conversas,
              telefonia (ProvedorTelefone: treino, celular, SIP/JsSIP; painel da ligação), fila (discador),
              operacao (rotina no Início, agenda, horas, desempenho, mapa, scripts),
              receita (vendas, comissões, catálogo), qualidade, pesquisa (inclusive a página pública /p/:token)
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
- Conversas: `mensagem` tem índice único `(canal_id, id_externo)` — webhook repetido nunca duplica; `conversa` tem
  índice único `(canal_id, telefone)` entre as ativas e `ids_externos text[]` (GIN) com todos os ids do cliente no
  provedor. Duplicadas antigas são juntadas apontando `mesclada_em_id` (nada é apagado).
- Fila: `fila_item` tem índice único `(fila_id, contato_id)` (o serviço também recusa contato ativo em outra fila)
  e `ordem` (identidade) para a ordem de chegada. A reserva é `reservado_por` + `reservado_ate` (CHECK: os dois juntos).
- Ligações: `ligacao` guarda estado, provedor, duração e resultado; `ligacao_evento` é somente inserção.
  Gravação vai para `arquivo` cifrada com `CRM_CHAVE` e tem `gravacao_expira_em`.
- Operação: metas, desempenho e mapa NÃO têm tabela de números — são contados de `evento` (índices
  `(empresa_id, tipo, criado_em)` e `(empresa_id, ator_id, criado_em)`). `registro_horas` tem gatilho que recusa
  qualquer INSERT/UPDATE em mês com `fechamento_horas` ativo (reabrir = marcar `reaberto_em`, nada é apagado).
  Escala trocada é arquivada, não sobrescrita.
- Receita: `venda.data_venda` (dia no fuso da empresa) define o mês da comissão; `fechamento_comissao` +
  gatilho travam as vendas do mês; `comissao` é o retrato do fechamento (somente inserção). Vagas:
  `entrega` é travada (`FOR UPDATE`) antes de gravar a venda/participante; índice único de participante ativo.
- Pesquisa: `pesquisa.token` (aleatório, único) é a única chave pública; `resposta_pesquisa` é somente inserção.
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
