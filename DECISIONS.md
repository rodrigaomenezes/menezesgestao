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

# ADR-030 — Vocabulário com gênero e frases com marcadores

## Decisão
Os nomes que mudam por segmento são 7 termos (contato, oportunidade, oferta, entrega, prestador, colaborador,
unidade), cada um com singular, plural e gênero, guardados no JSON `empresa.vocabulario` (chaves `x`, `x_plural`,
`x_genero`; aditivo, sem migração). Um só lugar monta os textos: `texto()` em `@mg/shared`, com marcadores —
`{Contato}`/`{contatos}` (termo com a inicial como escrita), `{Nova oportunidade}`/`{do contato}` (as palavras antes
do termo concordam com o gênero dele, partindo da forma masculina ou feminina) e `{o|a:contato}` (escolha por
gênero). `{{variavel}}` de mensagens e chaves desconhecidas não são tocados. Uso: o tratador de erros aplica o
vocabulário de quem pediu em `message` e `details`; textos gravados fora de uma requisição (avisos, execuções de
automação, relatório de importação) são montados ao gravar; nas telas, `useVocabulario().t()`. Catálogos do
contrato (gatilhos, indicadores, escopos, status) também usam marcadores e passam por `t()` ao exibir. Um teste de
unidade varre `apps/web/src` e falha com termo fixo. Trocar de segmento renomeia (termos voltam ao padrão do
pacote) e cria campos típicos com `ON CONFLICT DO NOTHING`; nunca mexe em funis nem dados.

## Por quê
Uma frase como "Novo {termo}" quebra no feminino ("Novo matrícula") e mensagens do servidor ficavam com "contato"
fixo. Gênero explícito evita adivinhar pela terminação; marcadores mantêm o texto legível no código e o mesmo
mecanismo serve ao servidor e ao front. Alternativa descartada: i18n completo com chaves por frase — pesado demais
para trocar 7 palavras, e não resolve a concordância sozinho.

# ADR-031 — Início por pessoa: só a ordem dos blocos no banco

## Decisão
O catálogo de blocos (12) vive no contrato (`@mg/shared/dto-inicio.ts`), com o que cada um exige (módulo × ação).
A tabela `inicio_pessoa` guarda só a lista ordenada de ids por pessoa × empresa (RLS por empresa); `null` = padrão
do perfil, montado na hora pelas permissões (gestão, financeiro ou atendimento). O servidor recusa bloco sem
permissão ao salvar e filtra ao ler: perder uma permissão tira o bloco sem apagar a escolha. Voltar ao padrão grava
`null` (nada é apagado). Cada bloco busca os próprios dados nas rotas que já existem; os da rotina dividem uma
consulta só. Fonte servida pelo app (`@fontsource-variable`, só latim), no precache do PWA.

## Por quê
Padrão automático foi a escolha do analista: nenhuma tela nova para o administrador e o Início certo desde o
primeiro acesso. Guardar só a ordem deixa o catálogo evoluir sem migração.

# ADR-032 — Motor BRE dentro do menezesgestao, como módulo por plano

## Decisão
O motor BRE (ETR BRE-ETR-001 v0.2) roda só no menezesgestao; o sistema do Robson recebe apenas documentação de telas.
Entra como módulo `bre` do catálogo (plano Completo), com permissões próprias. As listas fechadas da doutrina
(estágios, estados do cliente, categorias de Break, temperatura, resultado, reentrada, encerramento) vivem no
contrato (`@mg/shared/dto-bre.ts`) e em CHECK no banco; os números (dias, tentativas, horas, pós-venda) ficam em
`bre_config` por empresa, com versão. O funil continua configurável: a etapa ganha `marco_bre` e o motor lê o marco,
nunca o nome (DEC-012). Break tem registro próprio, com motivo configurável dentro da categoria fixa (DEC-013). O
SQ-BRE vai reaproveitar a Qualidade (DEC-014). A IA chega na 8.2, atrás de interface, com Claude como provedor real.
As regras ficam no servidor (serviço `modulos/bre`), nunca só no prompt.

## Por quê
O menezesgestao já tem multiempresa, WhatsApp, fila, tarefas, vendas e eventos: o motor só acrescenta regras. Marco
na etapa preserva o princípio de "tudo é configuração" sem perder a doutrina; e a 8.1 sem IA deixa o processo ser
validado antes da automação, como o próprio livro pede.

# ADR-033 — SQ-BRE na Qualidade, BPI calculado na consulta e escalonamento que para a automação

## Decisão
O SQ-BRE mora no módulo Qualidade (rotas `/api/qualidade/sq-bre`, permissão de Qualidade) e só existe com o motor BRE
ligado. Tabela própria `sq_bre`, com a prévia da IA e a nota confirmada lado a lado; uma prévia aberta por conversa.
O BPI não tem tabela: é calculado na consulta a partir das vendas confirmadas, do funil (eventos de etapa), dos
registros BRE, do SQ-BRE confirmado e das tarefas do motor (`tarefa.origem_bre`). Pilar sem dados sai do cálculo e os
pesos dos demais são redistribuídos; a meta mensal de receita vale proporcional aos dias do período; quem não atendeu
no período (dono, financeiro) fica fora. O coaching roda toda segunda (job) e grava `coaching_alerta` único por
pessoa × pilar × semana. O escalonamento é único por cliente × situação enquanto aberto, avisa o responsável e o
gestor da equipe e faz as automações ignorarem o envio de mensagem para o cliente.

## Por quê
Reaproveitar a Qualidade mantém um lugar só para avaliar atendimento, sem misturar a escala 0–10 dos critérios livres
com os 5 pilares × 20 da doutrina. Calcular o BPI na hora evita números duplicados que divergem dos registros; se o
volume pedir, o caminho é a visão materializada já prevista (item 25 da dívida).

# ADR-034 — Campos de inteligência, concordância IA × equipe e LGPD nos testes

## Decisão
Os campos de inteligência do método BRE são campos personalizados do contato marcados (`inteligencia_bre`): cada
empresa escolhe os seus (perfume favorito, curso de interesse…) sem código. Eles alimentam o "falta saber" do
registro (FR-006) e a completude do pilar Inteligência; sem campos marcados, vale a regra anterior. A concordância
IA × equipe (DEC-010) compara, na amostra mais recente da empresa, a sugestão da IA com o que a pessoa registrou
(resultado, temperatura, categoria do Break) e a prévia do SQ-BRE com a nota confirmada (até 5 pontos); "liberado"
exige amostra mínima, o percentual da empresa em todos os campos e nenhuma sugestão barrada pelas regras. Por
decisão do analista, a conversa vai aberta para a IA nos primeiros testes; o envio mascarado entra antes do uso real.

## Por quê
Reaproveitar os campos personalizados mantém "tudo é configuração" e evita um segundo cadastro de campos. Medir
contra o que a própria equipe registrou dá um número que o gestor entende e não depende de rotular conversas à parte.

# ADR-035 — Automação BRE por modelo de texto, travada pela concordância

## Decisão
A Fase 4 da ETR entra como automações por modelo de texto da empresa (`bre_automacao`): pós-venda D+N, aniversário
(campo de data escolhido) e reentrada combinada do dia. Não usam IA. Ligar exige o painel IA × equipe liberado
(DEC-010), e a liberação é conferida de novo a cada execução: se a concordância cair, nada sai. Cada candidato passa
pelas mesmas travas do registro (`bloqueioDeTentativa`), por "não contatar", escalonamento aberto, cadastro arquivado
ou anonimizado e telefone. `bre_automacao_execucao` é única por automação × cliente × referência (venda, ano ou
reentrada) e guarda o motivo do pulo no vocabulário da empresa. Rotina diária às 09:17 (fuso de São Paulo) e "Rodar
agora" para o administrador.

## Por quê
A doutrina só automatiza o que não exige julgamento (lembretes, aniversários, confirmação de entrega). Amarrar à
concordância mantém a ordem que o livro pede — validar o processo antes de escalar — e a trava em cada execução
impede que uma piora passe despercebida.

# ADR-036 — IA do motor BRE pela fila de jobs e BPI guardado

## Decisão
Os pedidos à IA (sugestão do registro e prévia do SQ-BRE) entram na fila de jobs (`bre.ia`): a rota valida,
grava a análise "processando" e devolve 202; o trabalhador chama a IA fora de transação, aplica as regras e grava o
resultado com tempo e tokens, avisando quem pediu em tempo real. Recusa ou resposta fora do contrato viram "falhou"
com o motivo; erro passageiro volta para a fila (até 3 tentativas); pedido parado há mais de 10 minutos é lido como
falha. Prévia que falhou não trava a avaliação: o supervisor dá a nota mesmo assim. Cada empresa tem limite de pedidos
por hora (`limiteIaPorHora`, padrão 300). O BPI do mês fica em `bre_bpi` (cache por empresa × mês × pessoa, com a
posição na empresa): recalculado de hora em hora, quando tem mais de 10 minutos, a pedido ("Recalcular agora") ou
logo depois de uma ação do motor que muda pilar (registro, nota SQ-BRE). A leitura é paginada pela posição e filtrada
pelo escopo. O mascaramento para a IA passa a cobrir também o nome do cliente e endereços.

## Por quê
Uma chamada de IA pode levar segundos ou falhar; segurar a requisição HTTP e a transação por esse tempo derruba a
experiência e o banco. O cache do BPI é descartável (sempre recalculável das fontes) e tira o cálculo pesado do
caminho de cada abertura de tela.

# ADR-037 — Catálogo com categoria e estoque; mensagem modelo nas automações

## Decisão
O item do catálogo (`oferta`) ganha `categoria`, `estoque` (vazio = não controla) e `lancamento_em`. A venda
confirmada baixa uma unidade e o cancelamento de uma venda confirmada devolve (nunca abaixo de zero). As automações
do BRE ganham "lançamento compatível" e "alerta de estoque", em que **compatível = já comprou outro item da mesma
categoria** (comparação sem maiúsculas). A automação pode sair como **mensagem modelo** aprovada na Meta: guarda o
nome, o idioma e a ordem das variáveis; cada mensagem grava `mensagem.modelo` com os parâmetros já preenchidos e o
texto como prévia. O provedor recebe o conteúdo `modelo`: a API oficial manda `template`; QR e demonstração mandam o
texto. Venda e troca de etapa marcam o BPI guardado para recalcular.

## Por quê
Categoria é configuração da empresa (sem regra de cliente no código) e basta para o "compatível" do livro sem criar
cadastro de preferências agora. Mensagem modelo é o único caminho da API oficial fora da janela de 24 h; guardar a
prévia mantém a conversa legível em qualquer provedor.

# ADR-038 — Cobrança dos clientes pelo provedor da própria empresa

## Decisão
Cada empresa conecta o provedor de cobrança dela (`conta_cobranca`, uma por empresa): a chave é testada no provedor,
guardada cifrada (AES-256-GCM, `CRM_CHAVE`) e só os 4 últimos caracteres voltam para a tela. A cobrança nasce da
venda aguardando pagamento (Pix, boleto ou link; uma em aberto por venda), é criada no provedor fora da transação e o
dinheiro cai na conta da empresa. O aviso do provedor chega em `/api/webhooks/cobranca/:empresaId` com o token da
conta no cabeçalho (comparação em tempo constante); cada aviso é gravado em `cobranca_aviso` e processado uma vez só.
Pagamento confirmado **confirma a venda sozinho** (estoque, evento `venda.confirmada`, BPI), como a confirmação manual.
Primeiro provedor real: Asaas (sandbox e produção); a demonstração simula o pagamento pelo mesmo caminho do aviso.
Fica num módulo próprio (`recebimentos`), separado da assinatura da empresa na plataforma (`modulos/cobranca`).

## Por quê
O dinheiro é do cliente da plataforma, não nosso: cada empresa usa o próprio agente financeiro. Interface por
provedor deixa somar Mercado Pago, Pagar.me ou Stripe sem mexer em vendas. Idempotência por evento porque provedores
reenviam avisos.

# ADR-039 — Pronto para vender: bloqueio gradual, limites por plano, painel da plataforma e termos versionados

## Decisão
- **Preço por empresa, plano fixo** (decisão do analista), com limites no catálogo (`LIMITES_PLANOS` em `@mg/shared`):
  pessoas, canais e armazenamento, conferidos no servidor na transação que cria o recurso, com trava da linha da empresa.
  Uso calculado na hora (consultas indexadas por empresa), sem tabela de contadores: evita cache que desatualiza.
  Mídia recebida do cliente não conta para o bloqueio (nunca perder mensagem de cliente).
- **Bloqueio gradual**: a situação da assinatura entra no contexto da sessão (mesma consulta); regra única
  `ficaSomenteLeitura` (atraso > 7 dias, cancelada ou suspensa) usada no servidor e na tela. Bloqueio = gravação
  recusada (`ASSINATURA_SO_LEITURA`); rotas de pagar e trocar de plano marcadas `liberadaNoBloqueio`. Nada é apagado.
- **Painel da plataforma** sem novo papel no banco: lista de e-mails em `PLATAFORMA_ADMINS`, checada em toda rota;
  ações auditadas na empresa alvo. Suspensa não volta a ativa sozinha ao pagar.
- **Documentos legais** versionados no código (`VERSOES_DOCUMENTOS`), textos como módulo TS (vão no build);
  aceite em `termo_aceite` (só caminho do sistema, imutável): termos e privacidade por pessoa, contrato de dados pela
  empresa (quem administra). Exigência na tela (portão), não em cada rota: aceite não é permissão.
- **Ajuda própria** (artigos em `@mg/shared`, sem servidor) e **status** público a partir das mesmas checagens da saúde.
- **Redefinir duas etapas**: token `duas_etapas` por e-mail; só a confirmação da pessoa desliga (o administrador
  nunca desliga a segurança de outro sozinho).
- **Provedor da assinatura**: continua a demonstração atrás da interface (analista decide depois).

## Por quê
Vender exige cobrar sem perder o cliente por atraso curto e sem apagar dados; limites e painel dão controle comercial
sem regra de cliente no código; termos versionados dão prova de aceite exigida pela LGPD.

# ADR-040 — Demonstração com empresas de exemplo geradas, antes do login

## Decisão
Uma tela aberta (`/demonstracao`), ligada só quando o servidor tem `DEMONSTRACAO_CHAVE` (sem a variável: 404; vale
também em produção, por decisão do analista). A chave digitada vira um cookie httpOnly com validade e HMAC da própria
chave (trocar a chave derruba os acessos; nada de segredo no navegador). Cada segmento gera, pela fila de jobs, uma
**empresa separada** marcada `empresa.demonstracao`: o segmento é aplicado pela mesma função do assistente e o
movimento (90 dias, ~300 contatos) é inserido direto em lote numa transação, gravando também os **eventos** que o
sistema gravaria — os painéis leem eventos, então metas, mapa, ranking e BPI aparecem cheios sem código especial.
O sorteio tem semente por segmento (o mesmo exemplo sai igual), datas no fuso de São Paulo e em horário comercial.
Entrar com um clique (dono, gestor, vendedor, financeiro) só existe para empresa marcada como demonstração; elas ficam
fora do painel da plataforma e sem assinatura (sem cobrança e sem bloqueio).

## Por quê
Apresentar o produto com telas vivas e coerentes por ramo, sem tocar em dados reais e sem senha de exemplo no código.
Gerar pelo banco (em vez de chamar cada serviço) leva ~2 s por empresa; os eventos mantêm a mesma fonte da verdade.

# ADR-041 — Política Permanente de Engenharia em todos os sistemas

## Decisão
A política do analista (22/10/2026) vira regra permanente deste e dos demais sistemas: texto em
`docs/POLITICA_ENGENHARIA.md` (igual em todos os repositórios, com uma seção "Como cumprir neste projeto"), resumo no
`CLAUDE.md`, checklist no modelo de PR. Duas travas automáticas entram já: o lint proíbe um módulo de importar o
repositório de outro (7 exceções antigas registradas em TECH_DEBT #70) e o log de produção oculta também tokens no
caminho (`/p/…`, `/api/gravacoes/…`, `/api/publico/pesquisas/…`) e parâmetros terminados em `token`.

## Por quê
A regra escrita sem verificação se perde; as duas travas cobrem as falhas reais encontradas ao aplicar a política
(acesso ao SQL de outro módulo e token de acesso sem login gravado no log). Verificação de ciclos e medida de
desempenho ficam como recomendação até haver sinal concreto (item 13: sem ferramenta nova sem motivo).

# ADR-042 — Interfaces públicas entre módulos no lugar do repositório do vizinho

## Decisão
As 7 exceções do ADR-041 saíram. O CRM expõe `contatoNaCarteira` em `crm/carteira.ts` (contato visível no escopo de
quem pede), usado por agenda, vendas, ofertas e conversas. Permissões expõe `permissoes/interface.ts`
(`permissoesDoPerfil`, `criarPerfilComPermissoes`), usado por criar empresa, convites e usuários. O lint barra
importar `*.repositorio.js` de outro módulo, sem exceções.

## Por quê
Mudar a consulta de contatos ou de permissões não pode quebrar módulos vizinhos sem aviso; a interface tem
assinatura menor (recebe o contexto) e um dono só. Mesmo comportamento: as funções só delegam ao repositório.

# ADR-043 — Painéis do todo ao micro, sem biblioteca de gráficos

## Decisão
Todo número de painel é clicável e leva a um filtro mais fino, até a ação que o compõe e dali ao registro. Os
filtros ficam no endereço (`useFiltrosUrl`): "voltar" desfaz o clique, o link é compartilhável e cada filtro vira
uma etiqueta removível. Gráficos são componentes próprios em HTML/CSS (`ui/paineis.tsx`: número com variação,
ranking em barras, barras por dia), com uma cor só (a da marca), seleção por contorno e `aria-pressed`, variação com
seta e texto, "Ver como tabela" e teclado. O servidor responde um resumo por filtro (totais do período e do anterior,
série diária com zeros, ranking de até 20) e a lista paginada das ações (`/api/desempenho/eventos`), com o mesmo
escopo de permissão do painel. Intervalo livre até 92 dias.

## Por quê
Funil e Vendas seguem o mesmo padrão (`/api/funil/painel`, `/api/vendas/painel`, intervalo até 366 dias): cada ranking
ignora o próprio filtro (o escolhido continua visível no contexto) e respeita os demais; a lista abaixo é a rota de
listagem de sempre, com filtros novos aditivos (período de fechamento e de criação, motivo de perda, oferta). O funil
por etapa é retrato de agora (abertas hoje), não do período, e diz isso no título.

Mostrar o todo sem levar ao micro não ajuda a decidir. Biblioteca de gráficos traria peso e dependência para
barras simples (política, item 13); barras como botões dão foco, toque grande e leitor de tela de graça. Uma chamada
por mudança de filtro (e não uma por número) mantém a tela leve.

Adendo (entregas 3 e 4): Ligações (`/api/ligacoes/painel`: feitas, atendidas, taxa, tempo falado, por dia, por
resultado e por pessoa) e Qualidade (`/api/avaliacoes/painel`: avaliações, nota média, feedback não lido, por pessoa e
por critério, este do mais baixo ao mais alto, só leitura — `Ranking` sem `aoEscolher`). O Início, a Rotina, o BPI e as
Comissões não ganharam painel próprio: cada linha virou link para o painel que a explica, já filtrado. As listas com
filtro (Contatos, Tarefas, Conversas, Auditoria, Comissões) guardam o filtro no endereço; abrir um item e voltar
mantém o recorte, e a lista vazia diz como sair dele.

Adendo (entrega 5): Breaks do Motor BRE (`/api/bre/breaks/painel`: quantos e em quantos clientes, por dia, categoria,
motivo e quem registrou; a lista `/api/bre/breaks` ganhou período, categoria, motivo e autor, e o nome do contato e
de quem registrou). Filtros com prefixo `brk` no endereço, para conviver com os da BPI na mesma tela. `usePaginado`
passou a descartar respostas atrasadas e a recarregar sem encolher a lista. A auditoria aceita `deDia`/`ateDia`,
resolvidos na meia-noite do fuso da empresa (antes, na do aparelho).

Adendo (entrega 6): conversão entre etapas do funil por coorte — de quem entrou no período, quantas chegaram a cada
etapa aberta e quantas pararam ali. "Chegar" = a maior ordem de etapa aberta por onde passou (a atual e as dos eventos
`oportunidade.etapa_alterada`, de onde saiu e para onde foi); ganhar conta como passar por todas; pular etapa conta
como passar pelas do meio. A regra fica num lugar só (`crm/alcance-funil.ts`), usada pelo painel e pelo filtro
`parouEm` da lista, para os dois contarem igual. Sem tabela nova: o histórico já estava nos eventos.

# ADR-044 — O que vem da Konecta (requisitos v1.1) para o Menezes Gestão

## Decisão
O documento de requisitos da Konecta (`docs/konecta/REQUISITOS_KONECTA_v1.1.md`) passa a ser referência de
princípios para o Menezes Gestão, em entregas pequenas. Entrega 1 (princípios de DEV, sem mudar o modelo):
- **Erro no próprio campo** (critérios transversais, seção 10): o `details.campos` do 400 vira o erro de cada `<Campo>`
  e `<Escolha>` (borda e texto vermelhos, `aria-invalid`), com foco no primeiro; o resumo do topo só some quando até 3
  erros estão todos em campos que a tela mostra (`resumo(exibidos)`), para nenhuma mensagem sumir.
- **Bloqueio progressivo com contagem** (RF-SEC-002): o 429 traz `tenteEmSegundos`; a tela conta e libera sozinha.
- **Sem conexão, sem envio** (RNF-009): `useEnvio` desliga os formulários offline (contexto da Casca).
- **Carregando com esqueleto** (seção 7.4); **duplicidade aponta o existente** (RF-CRM-004, aviso âmbar com "Abrir o
  existente"); **limites visíveis** (RF-SAA-002): 50 campos personalizados por tipo e 200 etiquetas ativas, com
  contador na tela e recusa no servidor (arquivar libera vaga; restaurar ocupa).
- **Identificador de correlação** (RNF-024): `x-request-id` em toda resposta e em todo log da requisição; o do proxy
  só é aceito com formato seguro (sem quebra de linha no log).
- **Perfis da seção 3**: Empresário (vê tudo, trabalha nos contatos, sem exportar nem administrar), Supervisor (trabalha
  na equipe, sem administrar) e Auditor (só leitura, com auditoria). Nível novo "T" na matriz. Empresas novas nascem com
  eles; as existentes recebem pela migração 0021, gerada da própria matriz (idempotente).

## Onde o Menezes Gestão diverge da Konecta, de propósito
- **Vermelho de erro** `#b3261e` (não `#D93F2B`): o da Konecta em texto sobre fundo claro fica abaixo do contraste AA
  que o próprio documento exige (RNF-020).
- **Texto base 16 px** (não 14 px): o Menezes Gestão é celular primeiro, e 16 px evita o zoom automático do iOS nos
  campos. A Konecta é computador primeiro (seção 7.8).

## Próximas entregas (aprovadas)
2: documento CPF/CNPJ mascarado com revelação auditada e exportação com finalidade registrada (RF-MIG-002).
3: vários telefones, e-mails e endereços por registro (RF-CRM-002). 4: duplicados e fusão registrada (RF-CRM-008).

Adendo (entrega 2): **documento CPF/CNPJ** (RF-CRM-002, RNF-022) guardado cifrado (AES-256-GCM, `CRM_CHAVE`), com HMAC
para impedir o repetido (índice único, como o telefone) e achar pela busca, e só o final em claro para a máscara
(`•••.•••.123-45`). O número inteiro aparece por `POST /api/contatos/:id/documento/revelar`, que exige a mesma
permissão de exportar (`crm:exportar`, sem ação nova na matriz) e grava `contato.documento_revelado` a cada vez; no
pacote do titular (LGPD) vai inteiro. CPF/CNPJ não vai para o log nem para a auditoria (máscara em `ocultarTokens` e
na busca registrada). **Exportação** (RF-MIG-002): `GET /api/contatos/exportar` gera CSV para o Excel brasileiro
(`;`, BOM, proteção contra fórmula) com os mesmos filtros e carteira da lista, finalidade obrigatória, limite de 10 mil
linhas (acima, recusa e pede para filtrar) e registro `contatos.exportados` com finalidade, filtros e quantidade.
