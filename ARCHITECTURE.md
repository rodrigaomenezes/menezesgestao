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

Painéis (ADR-043): filtros de tela no endereço (`apps/web/src/app/filtros-url.ts`) e peças de painel sem biblioteca de
gráficos (`apps/web/src/ui/paineis.tsx`); o servidor entrega um resumo por filtro (`/api/desempenho/resumo`) e o
"por trás do número" paginado (`/api/desempenho/eventos`), sempre dos eventos e no escopo de quem pede. Os outros
painéis ficam no módulo dono do dado, cada um num serviço próprio (`crm/painel-funil`, `receita/painel-vendas`,
`telefonia/painel-ligacoes`, `qualidade/painel-qualidade`, `bre/painel-breaks`), e usam de `operacao/comum.ts` só o fuso e o intervalo
(`intervaloDoPainel`, `instantesDoPeriodo`); a lista abaixo de cada painel é a rota de listagem do módulo.
Listas no front usam `usePaginado` (`ui/ui.tsx`): só a resposta do último pedido vale e recarregar (tempo real)
traz de uma vez o que já estava na tela (até 100), para a lista não encolher nem a tela pular.

Limite entre módulos (ADR-041): o repositório é interno do módulo dono; outro módulo chama o serviço. O lint barra
importação do repositório de outro módulo, sem exceções; interfaces públicas: `crm/carteira.ts` (contato na carteira,
responsável) e `permissoes/interface.ts` (permissões do perfil, criar perfil com permissões). Regras permanentes:
`docs/POLITICA_ENGENHARIA.md`.

## Repositório

```
apps/api/src
  app.ts, server.ts, config.ts      montagem, inicialização (falha cedo), configuração
  infra/                             banco (comEmpresa/comoSistema, depoisDoCommit), esquema Drizzle, migrador, jobs,
                                     log.ts (logs JSON sem dados pessoais), backup.ts (conferência da cópia),
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
    marca/         dominio.ts (host → empresa, cache de 60 s), marca pública, cores (contraste), logos, ícone,
                   domínio próprio, vocabulário (vocabulario.ts lê os termos para textos gravados fora de uma
                   requisição); whitelabel.rotas.ts reúne as rotas da fase 6 e a troca de segmento
    onboarding/    cadastro aberto, assistente de 5 passos, segmentos, dados de exemplo
    cobranca/      interface ProvedorCobranca (provedor de demonstração), assinatura, faturas, ciclo diário (job)
    automacoes/    regras quando/se/então; varredura dos eventos por job (uma execução por regra × evento)
    auth/          (fase 7) duas-etapas.servico.ts: TOTP (infra/seguranca/totp.ts), código por e-mail,
                   códigos de recuperação, desafio em cookie próprio, regra da empresa
    lgpd/          exportar e anonimizar o titular; retenção por empresa e limpeza do sistema (job diário)
    inicio/        (fase 7.6) Início por pessoa: ordem dos blocos em inicio_pessoa (null = padrão do perfil,
                   montado de permissões por inicioPadrao em @mg/shared/dto-inicio.ts)
    push/          interface ProvedorPush (web-push com VAPID ou demonstração), inscrições, varredura por job
  cli/                               criar-empresa, dados-exemplo, caixa-de-saida, migrar, desligar-duas-etapas,
                                     conferir-backup, chaves-push
apps/web/src
  app/        api (cliente), sessão, tema, fonte.css (Plus Jakarta Sans local), tempo real,
              vocabulario.ts (useVocabulario: termos e t() das telas),
              casca (menu, sino, aviso de sem conexão),
              offline.ts (cache dos dados limpo no login/logout, inscrição de push); public/sw-push.js
  ui/         campos, listas paginadas, modal, confirmação, avisos (toast)
  features/   acesso, inicio, usuarios, permissoes, empresa, auditoria, notificacoes, conta,
              crm (contatos, ficha, funil/kanban, tarefas, importar, configurar), conversas,
              telefonia (ProvedorTelefone: treino, celular, SIP/JsSIP; painel da ligação), fila (discador),
              operacao (rotina no Início, agenda, horas, desempenho, mapa, scripts),
              receita (vendas, comissões, catálogo), qualidade, pesquisa (inclusive a página pública /p/:token),
              whitelabel (cadastro, primeiros passos, marca, segmento e termos, plano, automações)
packages/shared/src                 @mg/shared: catálogo, marca, erros, DTOs (Zod, inclusive dto-crm), slug, datas, telefone,
                                    vocabulario.ts (termos com gênero e frases com marcadores, ADR-030)
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
6. Resposta recortada pelo DTO; erro sempre `{ error: { code, message, details } }`, com `message` e `details`
   montados no vocabulário da empresa de quem pediu (`{Contato} não encontrad{o|a:contato}` → "Paciente não
   encontrado").
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
- White-label: `empresa.dominio` tem índice único em `lower(dominio)`; `empresa.onboarding` (jsonb) guarda o
  passo do assistente. `assinatura` (uma por empresa) e `fatura` (única por assinatura × vencimento: o ciclo
  diário pode rodar de novo sem duplicar). `automacao_execucao` é única por `(regra_id, evento_id)` e não aceita
  UPDATE — o mesmo evento nunca dispara a mesma regra duas vezes.
- Segurança e LGPD: `desafio_login` e `push_inscricao` são só do sistema (sem leitura para mg_app); o segredo do
  app autenticador e as chaves do navegador vão cifrados; códigos de recuperação só como HMAC. `evento` e
  `auditoria` continuam somente inserção — a única exceção é a anonimização, que troca o conteúdo
  (`dados`/`antes`/`depois`) com `app.lgpd_redacao` ligado na transação do sistema (ADR-027).
- Push: `notificacao.entregue_em` (chegou a uma tela aberta pelo tempo real) e `push_em` (já processada);
  `so_celular` para avisos de ligação.
- Motor BRE (ADR-032): `etapa.marco_bre` liga o funil configurável aos estágios da doutrina; `contato.estado_bre`
  é recalculado todo dia por job a partir das vendas confirmadas; `ciclo_contato` tem no máximo um aberto por
  cliente (índice único parcial); `registro_bre`, `break_bre` e `reentrada` guardam o registro de 30 s, a Regra de
  Ouro e o retorno combinado. Os limites de cada empresa ficam em `bre_config` (versão + auditoria). Os bloqueios
  da fila do dia e do registro são as mesmas regras, em SQL para a lista e em código para o registro.
  Na 8.2: `analise_bre` (o que a IA sugeriu e o que o motor descartou), `sq_bre` (prévia e nota confirmada lado a
  lado), `escalonamento` (um aberto por cliente × situação), `coaching_alerta` (um por pessoa × pilar × semana) e
  `tarefa.origem_bre`. O BPI não tem tabela: sai dessas fontes na consulta (ADR-033).
  Na 8.3: `campo_personalizado.inteligencia_bre` marca os campos de inteligência (ADR-034); a concordância IA ×
  equipe é calculada na consulta, juntando cada registro à última análise da mesma conversa.
  Na 8.4: `bre_automacao` (modelo de texto, canal, dias ou campo) e `bre_automacao_execucao` (única por automação ×
  cliente × referência). O envio usa o mesmo serviço de saída das conversas (fila de jobs) (ADR-035).
  Na 8.5: pedidos à IA pela fila `bre.ia` (`analise_bre.status` processando/pronta/falhou, `ms`, `tokens_*`; `sq_bre`
  com prévia que pode faltar) e o BPI guardado em `bre_bpi` (cache por empresa × mês × pessoa) (ADR-036).
  Depois da 8.5: `oferta.categoria/estoque/lancamento_em`; `bre_automacao` com `LANCAMENTO`/`ESTOQUE`,
  `limite_estoque` e `modelo_*`; `mensagem.modelo` (nome, idioma, parâmetros já preenchidos) vira o conteúdo
  `modelo` do provedor — template na API oficial, texto no QR e na demonstração (ADR-037). Venda e troca de etapa
  também marcam o BPI guardado para recalcular.
  Na 8.6 (`modulos/recebimentos`, migração 0018): `conta_cobranca` (uma por empresa; credenciais e token do webhook
  cifrados com `CRM_CHAVE`), `cobranca` (uma em aberto por venda) e `cobranca_aviso` (cada aviso do provedor uma vez
  só). Provedores atrás de `ProvedorRecebimento` (demonstração, Asaas). Webhook `POST /api/webhooks/cobranca/:empresaId`
  com token no cabeçalho. Diferente de `modulos/cobranca`, que é a assinatura da empresa na plataforma (ADR-038).
- Fase 9 (migração 0019, ADR-039): o contexto da sessão traz a situação da assinatura (status, dias de atraso, só
  consulta) e o `preValidation` recusa gravação quando só consulta (rotas `liberadaNoBloqueio` passam). Limites em
  `modulos/cobranca/limites.ts` (`exigirLimite`, chamado em convites, restaurar pessoa, canais e arquivos).
  `modulos/plataforma` (painel, só `PLATAFORMA_ADMINS`), `modulos/termos` (documentos, aceite em `termo_aceite`,
  suporte e status públicos). Na tela: faixa `AvisoAssinatura` na casca, portão de aceite em `main.tsx`, ajuda em
  `@mg/shared/ajuda.ts`.
- Demonstração (migração 0020, ADR-040): `modulos/demonstracao` — `roteiros.ts` (conteúdo por segmento),
  `aleatorio.ts` (sorteio com semente), `gerador.ts` (empresa + segmento pela função do assistente + 90 dias de
  movimento numa transação, com os eventos que alimentam metas, mapa, ranking e BPI), fila `demonstracao.gerar`,
  tabela `demonstracao` (pedidos) e `empresa.demonstracao`. Acesso por cookie httpOnly assinado com a chave.
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
