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

---

# ADR-013 — Arquivos atrás de interface; primeiro provedor guarda no banco

## Contexto
A importação precisa guardar a planilha enviada para o job processar (e reprocessar em nova tentativa). O Railway
não tem disco persistente compartilhado sem volume, e o Prompt Mestre pede fornecedores atrás de interfaces.

## Decisão
`ProvedorArquivos` (`gravar`, `ler`) com o provedor `banco`: conteúdo em `arquivo.conteudo` (bytea), isolado por
empresa com RLS. Upload por multipart (até 10 MB), separado do limite de 1 MB do JSON.

## Alternativas
S3/R2 desde já (exige conta e segredo externos antes de haver mídia); disco local (some a cada deploy).

## Consequências
Simples e transacional para planilhas. Mídia de conversas (fase 2) troca para um provedor de objetos sem mudar
quem usa a interface (ver `TECH_DEBT.md`).

---

# ADR-014 — Importação idempotente pelo telefone, em fila

## Decisão
Envio → prévia (cabeçalho e 5 linhas) → mapeamento confirmado → job `crm.importacao` em lotes de 500. Cada linha é
decidida pelo telefone normalizado: novo, atualizado (se a opção estiver marcada e algo mudou), sem mudança ou
ignorado com motivo (sem nome, telefone inválido, contato na lixeira, contato da carteira de outra pessoa). Repetir
a importação ou o job não duplica nada. Eventos da importação são "silenciosos" (não disparam tempo real linha a
linha); ao fim, um evento `importacao.concluida` e uma notificação para quem importou.

## Consequências
O relatório guarda até 200 motivos de linhas ignoradas. Duas importações simultâneas do mesmo telefone são
resolvidas pelo índice único do banco (uma delas falha e o job tenta de novo).

---

# ADR-015 — Mensagens atrás de interface; entrada idempotente e deduplicada

## Decisão
`ProvedorMensagens` (conectar, estado, enviar texto/mídia/áudio, baixar mídia) com três provedores. Tudo que entra
vira o mesmo `EventoEntrada`. A entrada procura a conversa em cascata: (1) id da mensagem já visto → ignora;
(2) id do cliente no provedor (`ids_externos`); (3) telefone E.164 com e sem nono dígito; (4) contato com esse
telefone. Só então cria contato e conversa. Corridas (dois webhooks do mesmo cliente novo) são resolvidas pelos
índices únicos + nova tentativa. A saída é gravada como "pendente" e enviada por job (novas tentativas; erro
definitivo, como número sem WhatsApp, não repete). Mídia recebida é baixada por job (o webhook responde rápido).

## Consequências
Trocar de provedor não muda caixa de entrada, automações nem histórico. Conversa sem dono é da fila de todos que
atendem (o tempo real também avisa quem tem escopo "próprio"); quem responde assume a conversa.

---

# ADR-016 — Conexão por QR code (biblioteca não oficial)

## Contexto
Pedido do produto: além da API oficial, oferecer conexão por QR para empresas pequenas.

## Decisão
Provedor `qr` com a Baileys **6.7.24** (linha estável, versão fixa — a 7.0 ainda é candidata). O estado de
autenticação fica na tabela `canal_sessao`, cifrado item a item com `CRM_CHAVE` (nada em disco). O socket vive no
processo do servidor; ao subir, os canais conectados religam sozinhos; ao cair, tenta de novo com espera crescente
e, se o celular desconectar, o administrador é notificado.

## Riscos aceitos e mitigação
- Vai contra os termos do WhatsApp: o número pode ser bloqueado. A tela avisa ao criar o canal; a API oficial é a
  recomendação para operação séria.
- Quebra quando o WhatsApp muda o protocolo: versão fixa, Dependabot e `npm audit` no CI.
- Licença: a dependência `libsignal` é **GPL-3.0**. Rodar como SaaS no nosso servidor não distribui o software;
  instalar o sistema no servidor de um cliente (on-premise) exigiria revisar a licença antes.
- Só uma instância pode segurar cada número: em réplicas extras, `WHATSAPP_QR_ATIVO=nao` (ver `TECH_DEBT.md`).

---

# ADR-017 — Fila com reserva exclusiva no banco

## Contexto
Até 20 pessoas pedem "o próximo" da mesma fila ao mesmo tempo; ninguém pode ligar para o mesmo contato.

## Decisão
"Pegar o próximo" é um único comando SQL: CTE com `SELECT … FOR UPDATE OF fi SKIP LOCKED LIMIT 1` + `UPDATE`
condicional que grava `reservado_por` e `reservado_ate` (minutos configuráveis por fila). Reserva vencida volta
sozinha para a fila (a consulta trata `reservado_ate < now()` como livre). A ordem é prioridade, retorno agendado e
`ordem` (identidade), para respeitar a chegada mesmo dentro de um lote. O filtro de carteira e "não contatar" é
aplicado dentro da mesma consulta.

## Consequências
Sem trava em memória nem Redis; funciona com várias réplicas. O teste de 20 pedidos simultâneos falha se o
`SKIP LOCKED` for retirado.

---

# ADR-018 — Telefone atrás de interface no navegador; gravação cifrada

## Decisão
- `ProvedorTelefone` no front com três versões: treino (simulado, sem conta), celular do vendedor (`tel:` + duração
  informada ao voltar) e SIP/WebRTC (JsSIP 3.13.8, carregado só quando usado). O servidor só conhece estados da
  ligação (`TRANSICOES_LIGACAO`, compartilhado), então trocar de PABX não muda histórico nem fila.
- A senha do ramal fica cifrada (`CRM_CHAVE`) e é entregue apenas à própria pessoa, para o navegador registrar.
  A CSP passa a permitir `connect-src wss:` e `media-src blob:`.
- Gravação: conteúdo cifrado (AES-256-GCM) no provedor de arquivos; acesso por link HMAC de 5 minutos ligado à
  pessoa, cada acesso auditado (`gravacao.acessada`). Job diário `telefonia.retencao` apaga o conteúdo vencido —
  exceção deliberada ao "nada some", exigida pela LGPD; o registro da ligação continua.

---

# ADR-019 — Indicadores contados dos eventos, na hora da consulta

## Contexto
Critério de pronto da fase 4: metas e mapa calculados só de eventos. Um número digitado ou um contador guardado à
parte diverge da realidade e abre espaço para manipulação.

## Decisão
- O catálogo de indicadores fica em `@mg/shared` (nome e formato) e a definição em `operacao/indicadores.ts`: tipo
  de evento, filtro e quem recebe o crédito — quem fez (`ator_id`) ou o dono do registro (`responsavel_id`; a venda
  é de quem é dono da oportunidade, mesmo que outra pessoa tenha movido o card).
- Contatos importados de planilha não contam como cadastro; mensagens de automação não têm ator e não contam.
- Metas guardam só alvo × indicador × período × valor; o realizado é somado na consulta, no fuso da empresa
  (semana começa na segunda).
- O mapa conta as mesmas categorias por hora e soma os minutos das atividades lançadas à mão.

## Consequências
Sem tabela de agregados para manter coerente. Com volume grande, a consulta pode pesar: os índices novos cobrem o
caso comum e, se precisar, entra uma visão materializada atualizada por job (sem mudar a regra).

---

# ADR-020 — Fechamento de horas travado no banco

## Decisão
`fechamento_horas` (um ativo por empresa e mês) + gatilho `bloquear_periodo_fechado` em `registro_horas`: qualquer
INSERT ou UPDATE de um registro (pela data nova ou antiga) num mês fechado falha com `PERIODO_FECHADO`. O serviço
confere antes para dar a mensagem clara (409 `PERIODO_FECHADO`); o gatilho garante mesmo fora da API. Fechar exige
não haver registro em andamento ou aguardando validação. Reabrir exige motivo e fica na auditoria.
Fechar e reabrir pedem `agenda: administrar` (no perfil-base, só o dono); a empresa pode dar ao financeiro pela
tela de perfis. Validar horas é para quem enxerga além de si e nunca sobre as próprias horas.

---

# ADR-021 — Comissão: regra por oferta ou geral, faixa em escada, retrato no fechamento

## Decisão
- Cada venda confirmada do mês cai em uma regra: a da oferta dela; senão, a geral; senão, nenhuma (contada à
  parte e mostrada na tela). Uma regra ativa por oferta e uma geral (índice único).
- Regra por faixa: a faixa é escolhida pelo total do vendedor naquela regra no mês e o percentual dela vale para
  o total (escada, não progressiva) — é o formato mais comum e o mais fácil de conferir à mão.
- Conta em centavos inteiros com `BigInt`, arredondando meio centavo para cima uma vez por vendedor × regra
  (`receita/calculo-comissao.ts`, testada contra conta feita à mão).
- Fechar o mês grava o retrato (`comissao`) e trava as vendas do mês com gatilho (como as horas, ADR-020). Mudar
  regra depois não altera mês fechado. Fechar exige não haver venda aguardando pagamento no mês.
- Regras e fechamento: quem tem `vendas: editar` com escopo da empresa (financeiro e dono no perfil-base).

# ADR-022 — Pesquisa com link público

## Decisão
Token aleatório de 24 caracteres por pesquisa, nas rotas `/api/publico/pesquisas/:token` (acesso `publica`, com
CSRF nas escritas como as demais rotas abertas). A busca pelo token roda como sistema; a gravação, na empresa da
pesquisa (RLS). A resposta não guarda IP nem identifica quem respondeu; o limite de requisições por IP vale.

# ADR-023 — Marca e empresa pelo endereço

## Decisão
O host da requisição decide a marca: `<slug>.DOMINIO_BASE` ou `empresa.dominio` (único, sem diferenciar
maiúsculas). A resolução fica em `marca/dominio.ts` com cache de 60 s por instância. Sem correspondência, vale a
marca padrão da plataforma. A marca pública (`/api/marca`), o manifest e o ícone do app saem do host; o login
usa a empresa do host quando o corpo não traz `empresaId`. A sessão continua amarrada ao vínculo — o host só
escolhe a marca e a empresa inicial, nunca dá acesso. Cores são recusadas abaixo de contraste 4,5:1 (WCAG AA).

## Consequências
Domínio próprio exige o CNAME do cliente e o cadastro do domínio no Railway (manual por enquanto).

# ADR-024 — Automações por varredura de eventos

## Decisão
Um job a cada minuto lê os eventos dos últimos 15 minutos e aplica as regras ativas da empresa. A execução é
gravada com chave única `(regra_id, evento_id)` antes da ação, na mesma transação — rodar de novo não repete.
Eventos gerados por uma automação levam `regraAutomacaoId` e são ignorados (sem cascata). Ações: criar tarefa,
mover etapa, avisar no sino e enviar mensagem (respeitando "não contatar").

## Consequências
Atraso de até um minuto; nada de `setInterval` nem gatilho no banco chamando código.

# ADR-025 — Cobrança atrás de interface, só demonstração por enquanto

## Decisão
`ProvedorCobranca` (criar cobrança, consultar) com o provedor `demonstracao`, que gera fatura sem link e permite
"pagar (simulado)". O cadastro abre `assinatura` em teste por 14 dias. O job diário `cobranca.ciclo` gera a fatura
do mês, marca vencidas e põe a assinatura em atraso. Trocar de plano muda os módulos da empresa na hora (esconde,
não apaga). Atraso hoje só mostra aviso; bloqueio fica para quando houver provedor real.

# ADR-026 — Login em duas etapas: TOTP próprio ou e-mail, desafio em cookie

## Decisão
A pessoa escolhe: app autenticador (TOTP, RFC 6238, implementado com `node:crypto`, sem dependência) ou código
de 6 dígitos por e-mail. A senha certa não abre sessão: cria um `desafio_login` (10 min, 5 tentativas) cujo
token vai num cookie HttpOnly com caminho `/api/auth`; código errado também conta para o bloqueio progressivo
da conta. O passo do TOTP usado é gravado (o mesmo código não vale duas vezes). 10 códigos de recuperação, só o
HMAC no banco. A empresa exige de ninguém, de administradores (quem administra usuários ou configurações) ou de
todos; quem é obrigado e não configurou só acessa rotas `autenticada` (configurar, sair). Quem exige precisa
ter ligado antes (não se tranca fora). Sem reset pelo administrador da empresa: a pessoa é global (vale em todas
as empresas); o suporte desliga pelo terminal (`desligar-duas-etapas`), com auditoria.

# ADR-027 — LGPD: anonimizar mantém os fatos

## Decisão
Anonimizar troca os dados pessoais por marcadores e apaga o conteúdo de mídias e gravações, sem apagar linhas:
metas, comissões e mapa (contados dos eventos) continuam fechando. No histórico, a única exceção ao "somente
inserção": com `app.lgpd_redacao = on` na transação do sistema, o gatilho aceita UPDATE que mude só
`evento.dados` ou `auditoria.antes/depois`. Vendas guardam o vínculo e a observação (obrigação fiscal; o mês
fechado é travado). Exportar fica na auditoria (quem e quando, sem o conteúdo). Retenção por empresa:
conteúdo de mensagens após N meses e anonimização de contatos arquivados há N meses; o sistema limpa caixa de
saída (7 dias), desafios (30 dias) e planilhas importadas (30 dias após terminar).

# ADR-028 — Backups do Railway, restauração provada

## Decisão
Os backups diários/semanais são os do Railway (sem bucket próprio por enquanto). A garantia vem do teste:
`npm run backup:conferir` compara migrações, RLS e contagens da cópia restaurada com a original, e o CI faz
`pg_dump` → banco novo → conferência a cada PR. Roteiro em `docs/BACKUP.md`.

# ADR-029 — Push para quem está fora e leitura offline

## Decisão
Web Push atrás de `ProvedorPush` (`web-push` com VAPID; sem chaves, demonstração na caixa de saída). Um job a
cada minuto manda as notificações não lidas que não chegaram a nenhuma tela aberta em 15 s (a instância que
entrega pelo tempo real marca `entregue_em`); `push_em` é marcado antes de enviar (sem duplicar entre
instâncias). Aviso de ligação (`so_celular`) só para inscrições de celular. Ao sair, o aparelho cancela a
inscrição. Offline: Workbox `NetworkFirst` nas consultas GET da API (fora mídias, gravações, exportações, tempo
real e push), cache `mg-dados` apagado quando a pessoa logada muda (login, logout). Somente leitura: escrever
offline mostra "sem conexão".

