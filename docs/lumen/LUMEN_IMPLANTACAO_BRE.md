# Lumen Operações — implantação do motor BRE

> **Para quem é:** para o agente (ou a pessoa) que vai implementar o BRE no repositório `lumenoperacoes`.
> **De onde vem:** do motor BRE do Menezes Gestão (Fases 8 a 8.6, em produção e com testes), traduzido para a
> pilha do Lumen (JavaScript CommonJS, Express, SQLite, front em JS puro) e para a escola (aluno, consultor,
> matrícula, aula experimental).
> **Pré-requisito:** as etapas E0 a E3 e E8 de [`LUMEN_EVOLUCAO_ESTRUTURA.md`](./LUMEN_EVOLUCAO_ESTRUTURA.md)
> (testes, migrações numeradas, agendador único, erro padronizado e `CLAUDE.md`). E4 (serviço do funil + eventos)
> é necessária na fase B2.
> **O que já vem pronto e testado:** o código dos Apêndices A a H roda (24 testes passando em Node 22 com
> better-sqlite3 11 e SQLite 3.49). Copie os arquivos como estão; o que é esboço está marcado como **esboço**.

## 0. Como usar

1. Copie `docs/lumen/` para `docs/` do Lumen.
2. Na sessão de desenvolvimento do Lumen, cole:

```text
Leia docs/LUMEN_IMPLANTACAO_BRE.md inteiro (e a parte de estrutura em docs/LUMEN_EVOLUCAO_ESTRUTURA.md).
Implante o motor BRE pela seção 14, uma fase por vez (B0 a B6). Antes de cada fase, apresente o plano
(arquivos, tabelas, rotas, testes dos critérios de pronto) e espere meu ok. Os Apêndices têm código já testado:
copie para os caminhos indicados sem reescrever; se precisar mudar algo, mude com teste. Não troque a pilha.
Não ligue a IA real sem a variável ANTHROPIC_API_KEY no Railway — sem ela, use a IA de demonstração.
Ao fim de cada fase: npm test verde, tela conferida em 360 px e o relatório da seção 17.
```

## 1. O que é o BRE (em uma página)

BRE é a doutrina comercial que transforma cada conversa com aluno em **dado estruturado** e a partir desse dado
decide **quando** falar de novo, **o que** oferecer e **como** está o desempenho de cada consultor.

- **Registro de 30 segundos:** depois de cada conversa, o consultor marca 8 campos (resultado, temperatura,
  estado emocional, os três "sim", interesse, próxima ação, data do retorno e, se houve recusa, o **Break**).
- **Break (Regra de Ouro):** toda recusa tem categoria + motivo + comentário com as palavras do aluno. A categoria
  decide a reentrada (ex.: "Tempo" → volta em 30 dias).
- **Ciclo de contato:** até 3 tentativas sem resposta, 48 h entre elas; depois o ciclo fecha e o aluno descansa
  15 dias. Silêncio de 7 dias também fecha.
- **Estado do aluno:** Recente / Ativo / Prestes a dormir / Inativo, pela quantidade de matrículas e dias desde a
  última. Recente não recebe desconto e não é abordado nas primeiras 48 h.
- **IA sugere, motor decide, pessoa confirma:** a IA lê a conversa e propõe o registro; o motor descarta o que
  fere a doutrina (desconto para recente, oferta sem os três "sim"); o consultor confere e salva.
- **Escalonamento:** reclamação, aluno pronto para fechar, VIP ou dúvida técnica avisam o gestor na hora.
- **SQ-BRE:** nota de qualidade da conversa (5 pilares × 20). A IA dá a prévia; só o gestor confirma.
- **BPI:** índice de desempenho do consultor (Receita 30, Pipeline 20, Inteligência 20, Qualidade 20,
  Relacionamento 10), ranking do mês e alerta de coaching.
- **Automação** (último passo): pós-venda e reentrada por WhatsApp, só depois de a IA concordar com a equipe em
  ≥ 85% de uma amostra de 200 casos.

## 2. Princípios desta implantação

1. **Regra pura separada do banco.** Tudo que decide fica em `lib/bre/regras.js` (Apêndice A) e é testado sem
   banco. O serviço (`lib/bre/motor.js`, Apêndice C) só lê, grava e aplica.
2. **Modo observação primeiro.** `bloquearTransicoes = false`: mover card "fora da doutrina" é registrado e avisado,
   não barrado. O gestor liga o bloqueio depois de 2–4 semanas de uso.
3. **Nada some.** Registros e Breaks são só de inserção (gatilho no banco). Errou? Registre de novo.
4. **Repetir nunca duplica:** um ciclo aberto por aluno, um escalonamento aberto por aluno × situação, uma prévia
   SQ aberta por conversa, uma execução por automação × aluno × referência — todos por índice único.
5. **"Não contatar" é absoluto:** não vai para a IA, não entra na fila do dia, não recebe automação, tentativa é
   recusada. Herdado da lista `fila_nao_ligar`.
6. **A IA nunca recebe dado pessoal** (`mascararDadosIa = true` no Lumen): nome, e-mail, telefone, CPF, CEP e
   endereço viram marcadores antes de sair.
7. **Sem conta externa, tudo funciona:** sem `ANTHROPIC_API_KEY`, a IA de demonstração (palavras-chave) responde no
   mesmo formato.
8. **Uma rotina = uma entrada no agendador único.** Nada de `setInterval` novo.
9. **Escopo:** consultor (`vendedor`) só vê e registra alunos da própria carteira (`crm_contatos.vendedor_id`);
   `gestor` vê tudo (`crm.veTudo` / `bre.ver.todos`).

## 3. A doutrina no Lumen — mapa de conceitos

| Conceito BRE | No Lumen | Observação |
| --- | --- | --- |
| Cliente | `crm_contatos` (aluno ou interessado) | A tela diz "aluno" |
| Responsável pelo cliente | `crm_contatos.vendedor_id` | Recebe tarefas de pós-venda e avisos |
| Oportunidade | `crm_negocios` | `temperatura` do Lumen é `quente/morno/frio` (mapa abaixo) |
| Etapa → marco | `crm_etapas.marco_bre` (coluna nova) | Preenchida para as 6 etapas padrão; gestor ajusta |
| Venda confirmada | `crm_negocios.status = 'ganho'` com `venda_id` → `vendas.data_venda` | `vendas` não tem `contato_id`; o vínculo é o negócio ganho |
| Conversa | `wa_conversas` + `wa_mensagens` | Janela de 24 h: `wa_conversas.ultima_entrada_em` |
| Tarefa | `crm_atividades` com `origem_bre` (coluna nova) | Retorno, pós-venda, reentrada |
| Histórico | `crm_timeline` (tipo `bre`) via `crm.timeline` | |
| Aviso em tempo real | `crm.avisar(vendedorId, evento, dados)` (dono + gestores) e `lib/push.js` | |
| Qualidade (SQ-BRE) | Tabela `bre_sq` + sugestão de criar Observação em `registros_monitoramento` | Não muda o Monitoramento atual |
| Metas / KPIs | `routes/desempenho.js` (`KPIS`) + `crm_metas` | BPI e SQ entram como KPIs novos |
| Não contatar | `crm_contatos.nao_contatar` (coluna nova) + `fila_nao_ligar` | A migração liga para quem já está na lista |
| Equipe | Não existe tabela de equipes | "Gestor da equipe" = todos com papel `gestor` |
| Empresa | Uma só | **Sem `empresa_id`** (o Lumen é de uma escola) |

**Temperatura:** `COLD → frio`, `WARM → morno`, `HOT → quente`, `READY_TO_BUY → quente` (o registro guarda o
código completo; o card do funil recebe o equivalente). Função: `regras.temperaturaDoNegocio`.

**Marcos padrão** (migração 002, Apêndice F):

| Etapa do Lumen | Marco |
| --- | --- |
| Novo lead, Primeiro contato | `LEAD_IDENTIFIED` |
| Diagnóstico | `DIAGNOSIS` |
| Aula experimental | `INTEREST` |
| Proposta enviada | `PROPOSAL` |
| Negociação | `NEGOTIATION` |
| (status `ganho`) | `SALE` |
| (status `perdido`) | `CLOSED` |
| (`reabrir`) | `REENTRY` |

## 4. Arquitetura (arquivos)

```
lib/agendador.js            ← agendador único (Apêndice D) — já criado na etapa E2
lib/bre/regras.js           ← listas, limites e regras puras (Apêndice A)
lib/bre/motor.js            ← serviço: registro, ciclo, Break, reentrada, escalonamento, rotinas (Apêndice C)
lib/bre/ia.js               ← IA atrás de interface: Claude ou demonstração (Apêndice B)
lib/bre/fila-ia.js          ← trabalhador da tabela-fila bre_analises (esboço, seção 9.3)
lib/bre/desempenho.js       ← SQ-BRE, BPI, ranking, coaching, concordância (seção 6.8–6.10)
lib/bre/automacao.js        ← pós-venda e reentrada por WhatsApp (seção 6.12)
lib/bre/ganchos.js          ← ouve os eventos do CRM e do WhatsApp (seção 11)
routes/bre.js               ← só HTTP (seção 8)
db/bre.sql                  ← tabelas novas, idempotente (Apêndice E)
db/migracoes/002_bre.js     ← colunas novas, marcos, permissões (Apêndice F)
public/bre.js, public/bre.css ← telas (seção 12)
test/ajuda-banco.js, test/bre/*.test.js ← testes (Apêndices G e H)
```

Dependências entre módulos (setas = "usa"):

```
routes/bre.js ─► lib/bre/motor.js ─► lib/bre/regras.js
      │                 ▲
      ├──► lib/bre/desempenho.js ─► regras.js
      └──► lib/bre/fila-ia.js ─► lib/bre/ia.js ─► regras.js (+ @anthropic-ai/sdk, carregado só se houver chave)
lib/bre/ganchos.js ─► motor.js       (ouvido pelos eventos de lib/crm/servico.js e routes/whatsapp.js)
lib/agendador.js ◄── server.js registra as rotinas do BRE
```

`regras.js` não importa nada. O CRM **não importa o BRE**: publica eventos e o BRE ouve (etapa E4). Desligar o BRE =
não registrar os ouvintes nem montar a rota.

## 5. Listas fechadas

Os códigos (em inglês, estáveis, iguais aos do Menezes Gestão) ficam no banco e nunca mudam; o nome em português é
o que a tela mostra. Fonte única: `lib/bre/regras.js`.

| Lista | Códigos |
| --- | --- |
| Marcos | `LEAD_IDENTIFIED`, `DIAGNOSIS`, `INTEREST`, `PROPOSAL`, `NEGOTIATION`, `SALE`, `REENTRY`, `CLOSED` |
| Estado do aluno | `RECENT`, `ACTIVE`, `ABOUT_TO_SLEEP`, `INACTIVE` |
| Resultado | `PURCHASED`, `ADVANCED`, `REPLIED_NO_ADVANCE`, `NO_REPLY`, `OPTED_OUT` |
| Temperatura | `COLD`, `WARM`, `HOT`, `READY_TO_BUY` |
| Estado emocional | `CURIOUS`, `INTERESTED`, `WARY`, `EXCITED`, `CONVINCED` |
| Três "sim" | `CONFIRMATION`, `AGREEMENT`, `VISUALIZATION` |
| Próxima ação | `SEND_CATALOG` (material/planos), `SEND_SAMPLE` (aula experimental), `WAIT_STOCK` (aguardar vaga/turma), `CALL_BACK`, `REMINDER`, `SCHEDULE_TALK`, `CLOSE_NO_INTEREST` |
| Categoria do Break | `A_TIME`, `B_PRODUCT`, `C_FINANCIAL`, `D_TRUST`, `E_PROCESS`, `F_COMPETITOR`, `G_OTHER`, `PRIOR_EXPERIENCE`, `NO_INTEREST` |
| Reentrada | `TIME`, `EVENT`, `PROFILE`, `BEHAVIOR`, `RELATIONSHIP` |
| Escalonamento | `READY_TO_BUY`, `TECHNICAL_HELP`, `VIP`, `COMPLAINT` |
| Critério de encerramento | `PURCHASE_DONE`, `CUSTOMER_REQUESTED`, `CONTACT_BLOCKED`, `NO_INTEREST_PERMANENT`, `PROFILE_MISMATCH`, `MAX_ATTEMPTS` |

Transições permitidas entre marcos: `regras.TRANSICOES` (ex.: `DIAGNOSIS → INTEREST | REENTRY | CLOSED`). Ficar no
mesmo marco é sempre permitido; etapa sem marco não é julgada.

## 6. Regras do motor (adaptadas ao Lumen)

Números entre colchetes são o padrão; o gestor ajusta em `bre_config` (validado por `regras.validarConfig`, com
mínimo e máximo de cada limite em `regras.LIMITES`).

### 6.1 Estado do aluno — rotina diária 03:07 (`motor.rotinaEstadoCliente`)
Matrículas = negócios `ganho` não excluídos; data = `vendas.data_venda` do `venda_id`, ou `fechado_em`.
```
sem matrícula → null (fora do motor)
dias > inativoApos [120] → INACTIVE
1 matrícula:  dias ≤ recenteAte [45] → RECENT, senão ABOUT_TO_SLEEP
2+:           dias ≤ ativoAte [60]  → ACTIVE, senão ABOUT_TO_SLEEP
```
Grava só quem mudou (`estado_bre`, `estado_bre_em`, `compras_qtd`, `ultima_compra_em`) e escreve na timeline.

### 6.2 Bloqueios de tentativa (`regras.bloqueioDeTentativa`)
Só para resultado `NO_REPLY` e para a fila do dia. Na ordem, o primeiro que valer recusa (HTTP 409) com a mensagem:
1. `nao_contatar` → "O aluno pediu para não ser contatado…"
2. `RECENT` e matrícula há menos de [48 h].
3. Ciclo aberto com tentativa há menos de [48 h].
4. Último ciclo fechado sem resposta há menos de [15 dias] — **exceto** com data combinada (reentrada pendente
   vencendo até hoje ou retorno registrado para hoje).

Resposta do aluno (qualquer outro resultado) nunca é bloqueada.

### 6.3 Ciclo de contato (`motor.registrarConversa`, `motor.rotinaSilencio`)
- Um ciclo aberto por aluno (índice único parcial). `NO_REPLY` soma tentativa; na [3ª] fecha `MAX_ATTEMPTS` e
  programa reentrada `TIME` em hoje + [15] dias.
- Outro resultado registra resposta. `PURCHASED` fecha `PURCHASE_DONE`; `OPTED_OUT` fecha `CUSTOMER_REQUESTED`,
  liga `nao_contatar`, cancela reentradas pendentes e **também insere o telefone em `fila_nao_ligar`** (ver 11.4).
- Rotina horária (minuto 11): tentativa sem resposta há mais de [7] dias fecha `SILENCE` e programa reentrada.

### 6.4 Break — Regra de Ouro
Categoria + motivo **da mesma categoria** + comentário (3 a 1.000 caracteres). O motor grava o marco da etapa e
aplica a ação padrão (`regras.acaoPadraoBreak`):

| Categoria | Ação |
| --- | --- |
| A — Tempo | Reentrada `TIME` em 30 dias |
| C — Financeiro | Reentrada `EVENT` "Próxima campanha" |
| D — Confiança | Reentrada `TIME` em 7 dias |
| Sem interesse | Reentrada `TIME` em 90 dias |
| B — Produto | "Não oferecer planos semelhantes" (sem reentrada) |
| F — Concorrência | "Registrar escola, preço e motivo" |
| Experiência anterior | "Acionar o coordenador" |
| E — Processo | Seguir a regra de silêncio |
| G — Outros | Seguir o comentário |

Motivos são lista editável pelo gestor; na primeira leitura entram os padrões (`regras.MOTIVOS_BREAK_PADRAO`).

### 6.5 Registro de 30 segundos (`regras.validarRegistro` + `motor.registrarConversa`)
Obrigatórios: resultado, temperatura, próxima ação e data do retorno (dispensada em `CLOSE_NO_INTEREST` e
`OPTED_OUT`). Opcionais: estado emocional, três "sim", interesse, Break, negócio, conversa, escalonamento, segundos
gastos (meta 30 s). Efeitos numa transação só:
- tarefa "Retorno: {aluno}" em `crm_atividades` (`origem_bre = 'retorno'`, 09:00 do dia) para quem registrou;
- `PURCHASED` → tarefas "Pós-venda D+n" em D+2, 5, 10, 20, 30 [`diasPosVenda`] para o dono da carteira;
- temperatura do negócio atualizada (`quente/morno/frio`);
- linha na timeline ("Registro BRE: Avançou · Quente · Break: Preço").

### 6.6 Encerramento guiado (`regras.validarEncerramento`)
Substitui o "perdido" simples **quando o gestor quiser** (botão "Encerrar (BRE)" ao lado do "Perdido"). Exige
critério + temperatura + checklist completo (motivo compreendido, CRM atualizado, temperatura definida, próximo
gatilho, data/evento de reentrada, nada sem registro); faltando item, recusa listando o que falta. Grava JSON em
`crm_negocios.encerramento_bre`, marca o negócio `perdido` (motivo = nome do critério) ou `ganho` (`PURCHASE_DONE`),
pode programar reentrada no mesmo passo. `CUSTOMER_REQUESTED` e `CONTACT_BLOCKED` ligam `nao_contatar`.

### 6.7 IA (sugestão do registro)
1. Aluno com `nao_contatar` → recusa; nada vai para a IA.
2. Últimas 100 mensagens de texto da conversa (`wa_mensagens`; áudio/imagem viram "[áudio]"/"[imagem]"),
   marcadas "aluno"/"consultor", **mascaradas** (`regras.mascararDadosPessoais`, com o nome do contato).
3. Saída conferida (`regras.validarSaidaIa`); código fora das listas = falha clara, a pessoa preenche à mão.
4. Filtros do motor (`regras.filtrarSugestao`), com o motivo em `bloqueios`: desconto para `RECENT`; desconto sem
   diagnóstico (nenhum negócio aberto em `INTEREST/PROPOSAL/NEGOTIATION` nem ganho); oferta com menos de 3 "sim".
5. Se a IA apontar escalonamento, o motor abre (origem `ia`), sem duplicar.
6. A tela preenche o formulário com a sugestão; a pessoa confere e salva (o registro guarda `analise_id`).

### 6.8 Escalonamento
Origem IA ou manual ("Precisa de uma pessoa?"). Um aberto por aluno × situação. Avisa o dono da carteira e todos os
gestores (`crm.avisar` + push com `avisarSeFechado`). Enquanto aberto, a automação ignora o aluno. Fecha com
"Resolvido" (gestor ou dono da carteira).

### 6.9 SQ-BRE (qualidade)
- Botão "SQ-BRE" na conversa, só para quem tem `bre.avaliar`. Ninguém avalia o próprio atendimento (CHECK no banco);
  avaliado = consultor da conversa.
- A IA dá a prévia (0–20 em H, D, I, V, P). Uma prévia aberta por conversa.
- O gestor confirma (ajusta pilares) com feedback; prévia e confirmada ficam lado a lado; o avaliado recebe aviso.
- Faixas: 95+ Excelência · 85–94 Muito bom · 70–84 Bom · 50–69 Regular · < 50 Requer reciclagem.
- **Ponte com o Monitoramento Comercial:** ao confirmar, botão "Criar observação" abre o formulário atual de
  `registros_monitoramento` já preenchido (categoria sugerida pela faixa: < 50 → "Erro Grave", 95+ → "Elogio"/"Boa
  prática"), e grava `bre_sq.monitoramento_id`. Não cria sozinho.

### 6.10 BPI, ranking e coaching (`lib/bre/desempenho.js`)
Por consultor, no mês (fuso de São Paulo). Pilares 0–100:

| Pilar (peso) | Fonte no Lumen |
| --- | --- |
| Receita (30) | Soma de `vendas.valor_pago` do mês do consultor ÷ meta. Meta: `crm_metas` (kpi `receita`, mês, vendedor; 0 = equipe dividida) ou `bre_config.metaReceitaReais`. Sem meta → pilar fora |
| Pipeline (20) | Negócios abertos no início do mês que avançaram ≥ 1 etapa para ordem maior (`bre_movimentos`) ÷ abertos no início |
| Inteligência (20) | Média de (completude ÷ 80%) e (enriquecimento ÷ 70%), teto 100 cada. Completude = opcionais preenchidos ÷ 4 (emocional, sins, interesse, negócio); enriquecimento = registros com dado novo ÷ registros |
| Qualidade (20) | Média do SQ-BRE confirmado no mês |
| Relacionamento (10) | Tarefas `origem_bre` vencidas no mês e concluídas até o dia ÷ vencidas |

Pilar sem dado fica fora e os pesos se redistribuem (`regras.calcularBpi`). Faixas: 95+ Elite · 90–94 Excelente ·
80–89 Muito bom · 70–79 Adequado · < 70 Plano de desenvolvimento. Cache em `bre_bpi` (recalcula a cada hora, a
pedido, ou marcando `calculado_em = NULL` após registro, nota SQ, venda e troca de etapa). Coaching: rotina segunda
07:13 — pilar < 70 nas duas últimas semanas completas gera uma linha em `bre_coaching` (único por pessoa × pilar ×
semana) e avisa os gestores. **Também entra em `routes/desempenho.js`** como KPIs `bpi` e `sq_bre`.

### 6.11 Concordância IA × equipe
Na amostra mais recente [200]: resultado, temperatura e categoria do Break (última análise antes do registro, mesma
conversa) iguais; SQ prévia × confirmada com diferença ≤ 5. "Liberado" exige amostra mínima, ≥ [85%] em todos e
nenhuma sugestão barrada na amostra. Tela só informa.

### 6.12 Automação (último passo)
| Tipo | Quem recebe hoje | Referência (não repete) |
| --- | --- | --- |
| `POS_VENDA` | Aluno com matrícula há exatamente N dias | A venda |
| `REENTRADA` | Aluno com reentrada `TIME` vencendo hoje | A reentrada |

Pula (grava `ignorada` com o motivo): `nao_contatar`, escalonamento aberto, sem conversa na conta escolhida.
Dentro da janela de 24 h envia o texto (`{nome}`, `{consultor}`, `{plano}`); fora dela, só com modelo aprovado
(`template_nome`), senão pula. Envia pela função existente `enviarMensagem(conv, msg, null)` (autor `null` =
automático). Liga só com a concordância liberada. Rotina diária 09:23 (horário comercial).

### 6.13 LGPD
`mascararDadosIa = true` desde o início. Antes de ligar a chave real: aviso aos alunos (termos/contrato da escola),
contrato do provedor sem uso para treino, e retenção (rotina mensal que apaga `bre_analises.saida` com mais de 12
meses, mantendo códigos e notas).

### 6.14 Robustez
- IA pela **tabela-fila** (`bre_analises.status = 'processando'`), 202 na hora; trabalhador a cada minuto pelo
  agendador; até 3 tentativas para erro passageiro; "processando" há > 10 min = falhou.
- Limite por hora de pedidos à IA [300].
- Mover card, ganho, perdido e venda invalidam o cache do BPI (só a linha do consultor, só o mês).

## 7. Banco de dados

Tabelas novas em `db/bre.sql` (Apêndice E), carregado no boot logo depois de `crm.sql`:

| Tabela | Para quê | Trava no banco |
| --- | --- | --- |
| `bre_config` | Limites (JSON, linha única) | `CHECK (id = 1)` |
| `bre_motivos_break` | Motivos por categoria | Único por categoria × nome ativo |
| `bre_ciclos` | Ciclo de contato | **Um aberto por aluno** |
| `bre_analises` | Pedido à IA + fila | Índice `(status, criado_em)` |
| `bre_registros` | Registro de 30 s | **Só inserção** (gatilhos) |
| `bre_breaks` | Breaks | **Só inserção** |
| `bre_reentradas` | Reentradas programadas | Data ou condição obrigatória |
| `bre_sq` | Prévia e nota SQ-BRE | Uma aberta por conversa; ninguém confirma a própria |
| `bre_escalonamentos` | Precisa de uma pessoa | Um aberto por aluno × situação |
| `bre_movimentos` | Troca de etapa (pilar Pipeline) | — |
| `bre_coaching` | Alertas de coaching | Único por pessoa × pilar × semana |
| `bre_bpi` | Cache do BPI | PK mês × pessoa |
| `bre_automacoes`, `bre_automacao_execucoes` | Automação | Execução única por automação × aluno × referência |

Colunas novas e permissões em `db/migracoes/002_bre.js` (Apêndice F), pelo executor da etapa E1:
`crm_contatos.estado_bre/estado_bre_em/compras_qtd/ultima_compra_em/nao_contatar`, `crm_etapas.marco_bre`,
`crm_negocios.encerramento_bre`, `crm_atividades.origem_bre`.

**Permissões** (padrão do `PERMISSOES_CRM`):

| Permissão | gestor | vendedor | O que libera |
| --- | --- | --- | --- |
| `bre.usar` | ✔ | ✔ | Registrar, fila do dia, reentradas, pedir IA — **só a própria carteira** |
| `bre.ver.todos` | ✔ | | Ver a equipe inteira, escalonamentos, ranking |
| `bre.gerenciar` | ✔ | | Limites, motivos, marcos, automações, concordância |
| `bre.avaliar` | ✔ | | Prévia e confirmação SQ-BRE |

Datas: o que o sistema carimba é UTC (`datetime('now')`); o que a pessoa escolhe (retorno, reentrada) é data local
`AAAA-MM-DD`; tarefas usam o formato local do Lumen `AAAA-MM-DDTHH:MM`.

## 8. API (`routes/bre.js`, montada em `/api/bre`)

Todas com `requireAuth`; permissão por rota; carteira conferida com `crm.podeVerContato(req.user, req.userPermissions, contato)`.
Erro no formato da etapa E3 (`{ error, codigo, detalhes: { campo } }`). Listas paginadas (`?cursor&limite`).

| Método e rota | Permissão | Faz |
| --- | --- | --- |
| `GET /config` · `PUT /config` | bre.usar · bre.gerenciar | Limites (parcial, validado) |
| `GET /motivos` · `POST /motivos` · `PATCH /motivos/:id` | bre.usar · bre.gerenciar | Motivos (semeia na 1ª vez); arquivar = `deleted_at` |
| `GET /listas` | bre.usar | Todas as listas fechadas com nomes (o front não repete códigos) |
| `POST /registros` | bre.usar | Registro de 30 s (6.5) |
| `GET /contatos/:id/resumo` | bre.usar | Estado, ciclo, último registro, reentradas, Breaks (paginado) |
| `POST /conversas/:id/analisar` | bre.usar | Pede a sugestão da IA → 202 `{ analiseId }` |
| `GET /analises/:id` | bre.usar | `processando` / `pronta` (sugestão + bloqueios) / `falhou` (motivo) |
| `GET /fila-do-dia` | bre.usar | Quem pode ser contatado hoje, já sem os bloqueados, paginado |
| `GET /reentradas` · `POST` · `PATCH /:id` | bre.usar | Lista, programa, conclui ou cancela |
| `POST /negocios/:id/encerrar` | bre.usar | Encerramento guiado (6.6) |
| `GET /escalonamentos` · `PATCH /:id` | bre.ver.todos (dono vê os seus) | Lista; "Resolvido" |
| `POST /conversas/:id/sq` · `GET /sq` · `GET /sq/:id` · `POST /sq/:id/confirmar` | bre.avaliar | SQ-BRE |
| `GET /desempenho?mes=AAAA-MM` | bre.usar (vendedor só a própria linha) | BPI, ranking, coaching, `calculadoEm` |
| `GET /concordancia` | bre.gerenciar | Concordância e liberação |
| `GET /automacoes` · `POST` · `PATCH /:id` · `GET /automacoes/execucoes` · `POST /automacoes/executar` | bre.gerenciar | Automação |
| `GET /saude` | bre.gerenciar | Fila da IA, rotinas, último erro |

Exemplo de rota (padrão para todas):

```js
// routes/bre.js — só HTTP. A regra está em lib/bre/motor.js.
"use strict";
const express = require("express");
const { db } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { audit } = require("../middleware/audit");
const crm = require("../lib/crm");
const { horaLocal } = require("../lib/comum");
const motor = require("../lib/bre/motor");
const { rota, ErroDeNegocio } = require("../lib/http");

const router = express.Router();
router.use(requireAuth);

const ctx = () => ({
  db,
  agora: () => Date.now(),
  hoje: () => horaLocal().slice(0, 10),
  efeitos: { timeline: crm.timeline, avisar: crm.avisar },
});
// ErroBre do motor vira o erro padrão da etapa E3.
const traduzir = (e) => { if (e instanceof motor.ErroBre) throw new ErroDeNegocio(e.status, "bre", e.message, { campo: e.campo }); throw e; };

router.post("/registros", requirePermission("bre.usar"), rota((req, res) => {
  const contatoId = Number(req.body.contatoId);
  const contato = db.prepare("SELECT id, vendedor_id, deleted_at FROM crm_contatos WHERE id = ?").get(contatoId);
  // 404 (e não 403) para não revelar que o aluno existe em outra carteira.
  if (!crm.podeVerContato(req.user, req.userPermissions, contato)) throw new ErroDeNegocio(404, "nao_encontrado", "Aluno não encontrado.");
  let r;
  try { r = motor.registrarConversa(ctx(), req.user, { ...req.body, contatoId }); } catch (e) { traduzir(e); }
  audit({ userId: req.user.id, entity: "bre_registro", entityId: r.id, action: "criar" });
  res.status(201).json(r);
}));

module.exports = router;
```

> `crm.podeVerContato(user, perms, contato)` é a função que o CRM já usa (`lib/crm.js:75`): gestor com
> `crm.ver.todos` vê tudo; o consultor vê os alunos da carteira dele, os sem dono e os que têm negócio dele.
> `req.userPermissions` é preenchido por `requirePermission`.

## 9. IA

### 9.1 Provedor (`lib/bre/ia.js`, Apêndice B)
- **Claude** quando `ANTHROPIC_API_KEY` existe; modelo em `BRE_IA_MODELO` (padrão `claude-opus-5-5`).
  Usa o SDK oficial `@anthropic-ai/sdk` (instalar: `npm i @anthropic-ai/sdk`), carregado só quando há chave.
- Saída estruturada (`output_config.format` com o esquema JSON `ESQUEMA`) — a API garante o formato; o servidor
  ainda confere os valores (`validarSaidaIa`).
- `effort: "low"` (tarefa de extração, barata e rápida), instruções com `cache_control` (cache do prompt),
  fallback do lado do servidor (`server-side-fallback-2026-07-01`) para recusas.
- `stop_reason` `refusal` ou `max_tokens` → `IaIndisponivel` com mensagem clara; erro passageiro (limite, rede,
  servidor) → a fila tenta de novo (`ehPassageiro`).
- **Demonstração** sem chave: regras por palavras-chave, mesmo formato. Tudo funciona sem conta.

### 9.2 Configurar a chave
Crie no Railway (serviço do Lumen → **Variables**) a variável `ANTHROPIC_API_KEY` com a chave gerada no Console da
Anthropic (console.anthropic.com → API Keys). Opcional: `BRE_IA_MODELO`. Nunca cole a chave no código, no chat ou
no PR. Sem a variável, o BRE usa a demonstração.

### 9.3 Fila da IA (`lib/bre/fila-ia.js`) — **esboço**
```js
// Rotina "bre_fila_ia" (intervalo 1 min). Pega até 5 pedidos, um por vez (uma réplica só).
async function drenarFilaIa({ db, provedor, mascarar, aoFicarPronta }) {
  // 1) "processando" há mais de 10 min sem terminar = falhou (servidor caiu no meio)
  db.prepare(`UPDATE bre_analises SET status = 'falhou', erro = 'A análise demorou demais. Peça de novo.', concluida_em = datetime('now')
              WHERE status = 'processando' AND iniciada_em < datetime('now', '-10 minutes')`).run();
  const pendentes = db.prepare(`SELECT * FROM bre_analises WHERE status = 'processando' AND iniciada_em IS NULL
                                ORDER BY criado_em LIMIT 5`).all();
  for (const a of pendentes) {
    // 2) "pega" o pedido: só um trabalhador consegue (UPDATE condicional)
    const pegou = db.prepare("UPDATE bre_analises SET iniciada_em = datetime('now'), tentativas = tentativas + 1 WHERE id = ? AND iniciada_em IS NULL").run(a.id).changes;
    if (!pegou) continue;
    const inicio = Date.now();
    try {
      const mensagens = lerConversa(db, a.conversa_id, a.contato_id, mascarar); // últimas 100, mascaradas
      const { saida, tokens } = await provedor.analisar(mensagens);
      const invalidos = regras.validarSaidaIa(saida);
      if (invalidos.length) throw new IaIndisponivel(`A IA respondeu fora das listas (${invalidos.join(", ")}). Preencha manualmente.`);
      const { sugestao, bloqueios } = regras.filtrarSugestao(saida, contextoDoAluno(db, a.contato_id));
      db.prepare(`UPDATE bre_analises SET status = 'pronta', provedor = ?, saida = ?, bloqueios = ?, ms = ?, tokens_entrada = ?, tokens_saida = ?,
                  concluida_em = datetime('now') WHERE id = ?`)
        .run(provedor.nome, JSON.stringify(sugestao), JSON.stringify(bloqueios), Date.now() - inicio, tokens?.entrada ?? null, tokens?.saida ?? null, a.id);
      if (sugestao.escalonamento) motor.abrirEscalonamento(ctx, { contatoId: a.contato_id, conversaId: a.conversa_id, situacao: sugestao.escalonamento, origem: "ia" });
      aoFicarPronta(a); // publicar(a.pedido_por, "bre.analise_pronta", { id: a.id })
    } catch (e) {
      if (ia.ehPassageiro(e) && a.tentativas + 1 < 3) {
        db.prepare("UPDATE bre_analises SET iniciada_em = NULL WHERE id = ?").run(a.id); // volta para a fila
      } else {
        db.prepare("UPDATE bre_analises SET status = 'falhou', erro = ?, concluida_em = datetime('now') WHERE id = ?")
          .run(e instanceof IaIndisponivel ? e.message : "A IA não respondeu. Preencha o registro manualmente.", a.id);
        if (!(e instanceof IaIndisponivel)) console.error("[BRE] IA falhou:", e);
      }
    }
  }
}
```
A rota `POST /conversas/:id/analisar` confere carteira, `nao_contatar` e o limite por hora
(`SELECT COUNT(*) FROM bre_analises WHERE criado_em > datetime('now','-1 hour')`), insere com `status = 'processando'`
e devolve 202. A tela recebe o SSE `bre.analise_pronta` e, de reserva, consulta `GET /analises/:id` com espera
crescente (1 s, 2 s, 4 s… até 90 s).

## 10. Rotinas (agendador único, Apêndice D)

Registradas no `server.js` depois do `listen`:

| Nome | Regra | Faz |
| --- | --- | --- |
| `bre_estado_cliente` | diária 03:07 | `motor.rotinaEstadoCliente` |
| `bre_silencio` | horária, minuto 11 | `motor.rotinaSilencio` |
| `bre_fila_ia` | intervalo 1 min | `drenarFilaIa` |
| `bre_bpi` | horária, minuto 41 | Recalcula o BPI velho do mês |
| `bre_coaching` | diária 07:13 (só age na segunda) | Alertas de coaching |
| `bre_automacao` | diária 09:23 | Pós-venda e reentrada (só automações ligadas) |
| `bre_retencao` | diária 04:37 (age no dia 1º) | Apaga `saida` de análises com > 12 meses |

```js
const { criarAgendador } = require("./lib/agendador");
const motor = require("./lib/bre/motor");
const agendador = criarAgendador({ db, horaLocal });
const ctxBre = () => ({ db, agora: () => Date.now(), hoje: () => horaLocal().slice(0, 10), efeitos: { timeline: crm.timeline, avisar: crm.avisar } });
agendador.registrar("bre_estado_cliente", { tipo: "diaria", hora: "03:07" }, () => motor.rotinaEstadoCliente(ctxBre()));
agendador.registrar("bre_silencio", { tipo: "horaria", minuto: 11 }, () => motor.rotinaSilencio(ctxBre()));
// … demais rotinas …
agendador.iniciar();
```

## 11. Ganchos no código que já existe

O BRE se liga por eventos (etapa E4), em `lib/bre/ganchos.js`. Pontos exatos:

### 11.1 Funil (`routes/crm.js` → `lib/crm/servico.js`)
| Ação | Linha atual | Evento | O BRE faz |
| --- | --- | --- | --- |
| Mover card | `POST /negocios/:id/mover` (~238) | `crm.negocio_movido { negocio, deEtapa, paraEtapa, usuarioId }` | Grava `bre_movimentos` com os marcos; se `transicaoPermitida` = falso: com `bloquearTransicoes` lança erro (a transação desfaz a movimentação e a tela mostra "Pela doutrina, de Diagnóstico só se vai para Interesse, Reentrada ou Encerrado"); sem bloqueio grava `permitido = 0` e avisa o gestor. Invalida o BPI |
| Ganho | `POST /negocios/:id/ganho` (~262) | `crm.negocio_ganho` | Fecha ciclo aberto `PURCHASE_DONE`; recalcula estado do aluno na hora; invalida BPI |
| Perdido | `/perdido` | `crm.negocio_perdido` | Se o perdido não veio do encerramento guiado, a tela sugere registrar o Break (não obriga) |
| Reabrir | `/reabrir` | `crm.negocio_reaberto` | Movimento para `REENTRY` |

### 11.2 WhatsApp (`routes/whatsapp.js`)
- `receberMensagem` (~154): mensagem do aluno → se há ciclo aberto, grava `ultima_resposta_em` (o silêncio
  conta da última tentativa sem resposta). Nunca chama a IA sozinho.
- `enviarMensagem(conv, msg, autor)` (~487): a automação chama com `autor = null`. Respeita o 409
  `janela_fechada` (`janelaAberta`, linha ~20: conexão por QR não tem janela; API oficial tem 24 h desde
  `ultima_entrada_em`): fora da janela, só com modelo aprovado.

### 11.3 Tela da conversa (`public/crm-chat.js`)
Botões novos no topo da conversa: **"Registrar (BRE)"** (abre o modal com o aluno já escolhido), **"Sugerir com IA"**
e, para quem tem `bre.avaliar`, **"SQ-BRE"**. Faixa discreta no topo: estado do aluno, ciclo (tentativas 1/3) e
escalonamento aberto.

### 11.4 "Não contatar" × `fila_nao_ligar`
`OPTED_OUT` e encerramento por `CUSTOMER_REQUESTED`/`CONTACT_BLOCKED` gravam `crm_contatos.nao_contatar = 1` **e**
`INSERT OR IGNORE INTO fila_nao_ligar (telefone)` — a fila de ligações já respeita essa lista. Remover da lista só
pelo gestor, com auditoria.

### 11.5 Desempenho (`routes/desempenho.js`)
Acrescentar ao catálogo `KPIS` os itens `bpi` (média do mês) e `sq_bre` (média confirmada), lendo de
`lib/bre/desempenho.js`. Metas por `crm_metas` como os demais KPIs.

### 11.6 Monitoramento Comercial
Ponte da seção 6.9 (sugestão de Observação a partir do SQ-BRE). A skill de monitoramento que hoje lança Observações
continua igual; o SQ-BRE não substitui o Monitoramento.

### 11.7 `server.js`
`app.use("/api/bre", require("./routes/bre"))` junto dos demais (sem `try/catch` — etapa E5), registrar ganchos e
rotinas. `public/index.html`: `<section id="bre">` e `<script src="bre.js">`; item "Motor BRE" no menu para quem tem
`bre.usar`.

## 12. Telas (`public/bre.js`, `public/bre.css`)

Regras: sem `innerHTML` com dado (ajudante `h()` da etapa E6), tudo dentro de uma IIFE, listas com "Carregar mais",
tempo real recarregando só o bloco afetado, 360 px.

| Tela | Conteúdo |
| --- | --- |
| **Motor BRE → Hoje** | "Precisa de uma pessoa" (escalonamentos abertos, gestor); **Fila do dia** (alunos que podem ser contatados, com motivo: retorno, reentrada, pós-venda) com "Registrar"; Reentradas vencendo (Feita / Cancelar) |
| **Registro (modal)** | Os 8 campos em uma tela: resultado e temperatura em botões grandes, "sim" como chips, próxima ação, data (atalhos Amanhã / 3 dias / 1 semana), Break recolhível (categoria → motivos da categoria → comentário), "Precisa de uma pessoa?", cronômetro discreto (meta 30 s). Com sugestão da IA: campos vêm marcados com "sugerido" e os bloqueios aparecem em amarelo |
| **Aluno (ficha do CRM)** | Bloco BRE: estado, ciclo, últimos registros, Breaks, reentradas; "Encerrar (BRE)" no negócio |
| **Desempenho** | BPI do mês por consultor (ranking; consultor vê só a própria linha), pilares em barras, coaching; filtro de mês |
| **Qualidade** | Lista SQ-BRE (prévias e confirmadas), "Confirmar" com ajuste por pilar e feedback, "Criar observação" |
| **Configurar (gestor)** | Limites (com mínimo/máximo), meta de receita, marco de cada etapa, motivos de Break, "IA × equipe", automações, saúde da fila |

Textos sempre em português e no vocabulário da escola: aluno, consultor, matrícula, aula experimental, plano.

## 13. Testes e critérios de aceite

Os Apêndices G e H já cobrem (24 testes): regras puras, IA de demonstração e formato, esquema do banco
(idempotente, travas), agendador (horários, atraso, erro registrado) e motor (ciclo, bloqueios, Break, pós-venda,
não contatar, escalonamento, silêncio, estado).

Critérios que cada fase acrescenta (escrever o teste junto com o código):

| Código | Critério | Fase |
| --- | --- | --- |
| AT-013 | 3 tentativas sem resposta fecham o ciclo e programam reentrada | B1 ✔ (pronto) |
| AT-014 | 48 h entre tentativas; 15 dias entre ciclos salvo data combinada | B1 ✔ |
| AT-015 | Recente não é abordado em 48 h nem recebe desconto | B1 ✔ / B3 |
| AT-016 | Break exige motivo da mesma categoria e comentário | B1 ✔ |
| AT-017 | Estado do aluno pelas matrículas | B1 ✔ |
| AT-018 | Oferta sem 3 "sim" é descartada da sugestão | B3 ✔ (regra) |
| AT-020/021/022 | Encerramento guiado recusa sem checklist e liga não contatar | B2 |
| AT-024 | Mascaramento: nada de nome, e-mail, telefone, CPF, endereço chega à IA | B3 ✔ (regra) |
| AT-025 | Limites da config validados | B1 ✔ |
| R-01 | Vendedor não registra nem lê aluno de outra carteira (404) | B1 |
| R-02 | Toda rota do BRE recusa sem a permissão (403) | B1 |
| R-03 | Mover card fora da doutrina: observação grava e avisa; bloqueio desfaz | B2 |
| R-04 | IA: 202 → pronta; recusa → falhou com motivo; passageiro → tenta de novo; > 10 min → falhou | B3 |
| R-05 | Limite por hora da IA | B3 |
| R-06 | SQ: ninguém confirma a própria; uma prévia por conversa | B4 |
| R-07 | BPI redistribui pesos sem dado; vendedor vê só a própria linha | B4 |
| R-08 | Coaching não duplica ao rodar de novo | B4 |
| R-09 | Automação: não repete, pula não contatar e escalonado, respeita janela de 24 h | B6 |
| R-10 | Telas BRE sem `innerHTML`, funcionando em 360 px | B5 |

## 14. Plano por fases

Cada fase = um PR, com plano antes e relatório depois.

| Fase | Entra | Pronto quando |
| --- | --- | --- |
| **B0 — Base** | Apêndices A, D, E, F, G/H copiados; `db/bre.sql` no boot; migração 002; permissões; `GET /listas`, `GET/PUT /config`, motivos | `npm test` com os 24 testes; banco de produção copiado sobe sem erro (testar com uma cópia do Volume) |
| **B1 — Registro e ciclo** | `motor.js` (Apêndice C), `POST /registros`, resumo do aluno, fila do dia, reentradas, rotinas estado e silêncio, modal de registro na conversa e na ficha | R-01, R-02 e AT-013 a 017 verdes; consultor registra em ≤ 30 s no celular |
| **B2 — Funil** | Serviço do funil + eventos (E4), `bre_movimentos`, modo observação, encerramento guiado, marcos editáveis, `nao_contatar` ↔ `fila_nao_ligar` | R-03, AT-020 a 022 |
| **B3 — IA** | `ia.js` (Apêndice B), fila da IA, "Sugerir com IA", escalonamento pela IA, limite por hora, saúde | R-04, R-05; funciona sem chave (demonstração) |
| **B4 — Qualidade e desempenho** | SQ-BRE, ponte com Monitoramento, BPI + cache, ranking, coaching, KPIs no Desempenho | R-06 a R-08 |
| **B5 — Telas finais** | Motor BRE → Hoje, Desempenho, Configurar; aviso de escalonamento por push | R-10; revisão em 360 px de todas as telas |
| **B6 — Automação** | Concordância, automações pós-venda e reentrada (desligadas até liberar) | R-09; nenhuma mensagem sai sem concordância liberada |

**Ordem de ligar em produção:** B0–B2 com `bloquearTransicoes = false` (2–4 semanas de observação) → B3 com a IA de
demonstração → chave real depois do item LGPD (6.13) → B4/B5 → B6 só com a concordância liberada.

## 15. Variáveis de ambiente

| Variável | Obrigatória | Para quê |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Não (sem ela: demonstração) | IA do BRE (Claude) |
| `BRE_IA_MODELO` | Não (padrão `claude-opus-5-5`) | Trocar o modelo sem mudar código |
| `TZ` | Já usado pelo Lumen | O BRE usa `horaLocal()` do `lib/comum.js` |

## 16. Riscos e decisões pendentes (para o dono decidir)

| # | Ponto | Padrão adotado aqui | Quando decidir |
| --- | --- | --- | --- |
| 1 | `vendas` não tem `contato_id` | Matrícula = negócio `ganho` com `venda_id`. Venda lançada sem negócio não conta para o estado do aluno | Antes de B1. Alternativa: coluna `vendas.contato_id` preenchida na tela de venda |
| 2 | `fila_leads` (fila de ligações) × `crm_contatos` | O BRE trabalha só com `crm_contatos`; a fila continua igual e respeita `nao_contatar` via `fila_nao_ligar` | B5: decidir se o resultado da ligação vira registro BRE |
| 3 | Sem tabela de equipes | Escalonamento e coaching avisam todos os gestores | Se crescer a equipe |
| 4 | Temperatura de 3 níveis no funil | `READY_TO_BUY` vira `quente` no card; o registro guarda o código | — |
| 5 | Modo observação | `bloquearTransicoes = false` | Após 2–4 semanas |
| 6 | IA e LGPD | Mascaramento ligado; chave só depois do aviso aos alunos | Antes da chave real |
| 7 | Marco das etapas novas | Etapa criada depois fica sem marco (não julgada) até o gestor escolher | — |
| 8 | Custo da IA | `effort: "low"`, cache das instruções, limite 300/h | Revisar após 1 mês de uso |

## 17. Relatório ao fim de cada fase

Responder no formato:
1. **O que entrou** (lista curta, em português de negócio).
2. **Arquivos modificados** e a responsabilidade de cada um.
3. **Dependências afetadas** (quem chama o que mudou; o que precisou ajustar).
4. **Otimizações** (consultas evitadas, cache, índices).
5. **Testes executados** (comando e resultado) e o que foi conferido em 360 px.
6. **Pendências e decisões** para o dono.

---

# Apêndices — código testado

Copie para os caminhos indicados. Rodar: `npm i better-sqlite3@11` (já existe no Lumen) e `node --test`.
Resultado esperado: `# pass 24`, `# fail 0`.

## Apêndice A — `lib/bre/regras.js` (Listas, limites e regras puras)

````js
// Motor BRE — listas fechadas da doutrina, limites padrão e regras PURAS (sem banco, sem HTTP, sem data atual
// implícita). Tudo que decide algo no motor passa por aqui e é coberto por test/bre/regras.test.js.
// Os códigos nunca mudam; os nomes são o que a tela mostra.
"use strict";

const lista = (itens) => itens.map((i) => i.codigo);

// 3.1 — marcos do funil (o motor lê o marco da etapa, nunca o nome) e transições permitidas.
const MARCOS = [
  { codigo: "LEAD_IDENTIFIED", nome: "Lead identificado" },
  { codigo: "DIAGNOSIS", nome: "Diagnóstico" },
  { codigo: "INTEREST", nome: "Interesse" },
  { codigo: "PROPOSAL", nome: "Proposta" },
  { codigo: "NEGOTIATION", nome: "Negociação" },
  { codigo: "SALE", nome: "Venda" },
  { codigo: "REENTRY", nome: "Reentrada" },
  { codigo: "CLOSED", nome: "Encerrado" },
];
const TRANSICOES = {
  LEAD_IDENTIFIED: ["DIAGNOSIS", "CLOSED"],
  DIAGNOSIS: ["INTEREST", "REENTRY", "CLOSED"],
  INTEREST: ["PROPOSAL", "DIAGNOSIS", "REENTRY"],
  PROPOSAL: ["NEGOTIATION", "SALE", "REENTRY"],
  NEGOTIATION: ["SALE", "PROPOSAL", "REENTRY"],
  SALE: ["REENTRY"],
  REENTRY: ["DIAGNOSIS", "INTEREST", "CLOSED"],
  CLOSED: ["REENTRY"],
};
/** Ficar no mesmo marco é sempre permitido; sem marco de um dos lados, o motor não opina (null). */
function transicaoPermitida(de, para) {
  if (!de || !para) return true;
  return de === para || (TRANSICOES[de] || []).includes(para);
}
const nomeMarco = (c) => (MARCOS.find((m) => m.codigo === c) || {}).nome || c;

const ESTADOS_CLIENTE = [
  { codigo: "RECENT", nome: "Recente" },
  { codigo: "ACTIVE", nome: "Ativo" },
  { codigo: "ABOUT_TO_SLEEP", nome: "Prestes a dormir" },
  { codigo: "INACTIVE", nome: "Inativo" },
];
const CATEGORIAS_BREAK = [
  { codigo: "A_TIME", nome: "A — Tempo" },
  { codigo: "B_PRODUCT", nome: "B — Produto" },
  { codigo: "C_FINANCIAL", nome: "C — Financeiro" },
  { codigo: "D_TRUST", nome: "D — Confiança" },
  { codigo: "E_PROCESS", nome: "E — Processo" },
  { codigo: "F_COMPETITOR", nome: "F — Concorrência" },
  { codigo: "G_OTHER", nome: "G — Outros" },
  { codigo: "PRIOR_EXPERIENCE", nome: "Experiência anterior" },
  { codigo: "NO_INTEREST", nome: "Sem interesse" },
];
/** Motivos que o sistema cria na primeira vez (o gestor ajusta depois, sempre dentro da categoria). */
const MOTIVOS_BREAK_PADRAO = {
  A_TIME: ["Ainda não experimentou", "Está viajando", "Vai decidir depois", "Aguardando salário"],
  B_PRODUCT: ["Não gostou", "Esperava outra coisa", "Desempenho abaixo do esperado"],
  C_FINANCIAL: ["Preço", "Prioridade", "Parcelamento", "Orçamento"],
  D_TRUST: ["Ainda inseguro", "Vai pesquisar", "Quer comparar", "Nunca comprou antes"],
  E_PROCESS: ["Não respondeu", "Visualizou", "Mudou de número", "Contato inválido"],
  F_COMPETITOR: ["Comprou em outro lugar", "Recebeu presente", "Melhor condição"],
  G_OTHER: ["Outro motivo"],
  PRIOR_EXPERIENCE: ["Problema em compra ou atendimento anterior"],
  NO_INTEREST: ["Mudou de perfil", "Não quer mais o produto"],
};
const ESTADOS_EMOCIONAIS = [
  { codigo: "CURIOUS", nome: "Curioso" },
  { codigo: "INTERESTED", nome: "Interessado" },
  { codigo: "WARY", nome: "Receoso" },
  { codigo: "EXCITED", nome: "Entusiasmado" },
  { codigo: "CONVINCED", nome: "Convencido" },
];
const TEMPERATURAS = [
  { codigo: "COLD", nome: "Fria", lumen: "frio" },
  { codigo: "WARM", nome: "Morna", lumen: "morno" },
  { codigo: "HOT", nome: "Quente", lumen: "quente" },
  { codigo: "READY_TO_BUY", nome: "Pronta para comprar", lumen: "quente" },
];
/** O negócio do Lumen guarda quente/morno/frio; o registro BRE guarda o código completo. */
const temperaturaDoNegocio = (codigo) => (TEMPERATURAS.find((t) => t.codigo === codigo) || {}).lumen || null;
const RESULTADOS = [
  { codigo: "PURCHASED", nome: "Comprou" },
  { codigo: "ADVANCED", nome: "Avançou" },
  { codigo: "REPLIED_NO_ADVANCE", nome: "Respondeu sem avançar" },
  { codigo: "NO_REPLY", nome: "Não respondeu" },
  { codigo: "OPTED_OUT", nome: "Pediu para não ser contatado" },
];
const TIPOS_REENTRADA = [
  { codigo: "TIME", nome: "Tempo" },
  { codigo: "EVENT", nome: "Evento" },
  { codigo: "PROFILE", nome: "Perfil" },
  { codigo: "BEHAVIOR", nome: "Comportamento" },
  { codigo: "RELATIONSHIP", nome: "Evolução do relacionamento" },
];
const ESCALONAMENTOS = [
  { codigo: "READY_TO_BUY", nome: "Pronto para comprar" },
  { codigo: "TECHNICAL_HELP", nome: "Precisa de ajuda técnica" },
  { codigo: "VIP", nome: "VIP" },
  { codigo: "COMPLAINT", nome: "Reclamação" },
];
const CRITERIOS_ENCERRAMENTO = [
  { codigo: "PURCHASE_DONE", nome: "Compra realizada" },
  { codigo: "CUSTOMER_REQUESTED", nome: "Cliente pediu para encerrar" },
  { codigo: "CONTACT_BLOCKED", nome: "Bloqueou o contato" },
  { codigo: "NO_INTEREST_PERMANENT", nome: "Sem interesse permanente" },
  { codigo: "PROFILE_MISMATCH", nome: "Mudança de perfil incompatível" },
  { codigo: "MAX_ATTEMPTS", nome: "Tentativa máxima atingida" },
];
const CHECKLIST_ENCERRAMENTO = [
  { codigo: "motivoCompreendido", nome: "Motivo compreendido" },
  { codigo: "crmAtualizado", nome: "CRM atualizado" },
  { codigo: "temperaturaDefinida", nome: "Temperatura definida" },
  { codigo: "proximoGatilho", nome: "Próximo gatilho definido" },
  { codigo: "reentradaDefinida", nome: "Data ou evento de reentrada" },
  { codigo: "nadaSemRegistro", nome: "Nenhuma informação sem registro" },
];
const SINS = [
  { codigo: "CONFIRMATION", nome: "Confirmação" },
  { codigo: "AGREEMENT", nome: "Concordância" },
  { codigo: "VISUALIZATION", nome: "Visualização" },
];
const PROXIMAS_ACOES = [
  { codigo: "SEND_CATALOG", nome: "Enviar material / planos" },
  { codigo: "SEND_SAMPLE", nome: "Oferecer aula experimental" },
  { codigo: "WAIT_STOCK", nome: "Aguardar vaga / turma" },
  { codigo: "CALL_BACK", nome: "Retornar depois" },
  { codigo: "REMINDER", nome: "Criar lembrete" },
  { codigo: "SCHEDULE_TALK", nome: "Marcar nova conversa" },
  { codigo: "CLOSE_NO_INTEREST", nome: "Encerrar por falta de interesse" },
];

// Limites ajustáveis pelo gestor (bre_config). Cada chave: padrão, mínimo, máximo.
const LIMITES = {
  recenteAte: [45, 1, 365],
  ativoAte: [60, 1, 365],
  inativoApos: [120, 2, 730],
  horasAntesDoPrimeiroContato: [48, 0, 240],
  tentativasPorCiclo: [3, 1, 10],
  horasEntreTentativas: [48, 1, 240],
  diasSilencioEncerra: [7, 1, 60],
  diasEntreCiclos: [15, 1, 180],
  concordanciaParaAutomacao: [85, 50, 100],
  amostraParaAutomacao: [200, 20, 5000],
  limiteIaPorHora: [300, 1, 10000],
};
const CONFIG_PADRAO = Object.freeze({
  ...Object.fromEntries(Object.entries(LIMITES).map(([k, [padrao]]) => [k, padrao])),
  diasPosVenda: [2, 5, 10, 20, 30],
  mascararDadosIa: true, // no Lumen nasce LIGADO: a IA nunca recebe telefone, e-mail, CPF, nome ou endereço
  metaReceitaReais: null, // pilar Receita do BPI (por pessoa, no mês); null = fora do BPI
  bloquearTransicoes: false, // implantação: primeiro só avisa; o gestor liga o bloqueio depois
});

/** Valida uma alteração PARCIAL da config. Devolve { ok, config, erro } — nunca lança. */
function validarConfig(atual, alteracao) {
  const nova = { ...atual };
  for (const [chave, valor] of Object.entries(alteracao || {})) {
    if (chave in LIMITES) {
      const [, min, max] = LIMITES[chave];
      if (!Number.isInteger(valor) || valor < min || valor > max) return { ok: false, erro: `${chave}: use um número inteiro de ${min} a ${max}.` };
      nova[chave] = valor;
    } else if (chave === "diasPosVenda") {
      if (!Array.isArray(valor) || valor.length > 10 || valor.some((d) => !Number.isInteger(d) || d < 1 || d > 365)) {
        return { ok: false, erro: "Dias do pós-venda: até 10 números de 1 a 365." };
      }
      nova.diasPosVenda = [...new Set(valor)].sort((a, b) => a - b);
    } else if (chave === "mascararDadosIa" || chave === "bloquearTransicoes") {
      if (typeof valor !== "boolean") return { ok: false, erro: `${chave}: use sim ou não.` };
      nova[chave] = valor;
    } else if (chave === "metaReceitaReais") {
      if (valor !== null && (typeof valor !== "number" || valor < 0 || valor > 10_000_000)) return { ok: false, erro: "Meta de receita: valor em reais, de 0 a 10 milhões, ou vazio." };
      nova.metaReceitaReais = valor;
    } else {
      return { ok: false, erro: `Configuração desconhecida: ${chave}.` };
    }
  }
  if (!(nova.recenteAte < nova.inativoApos && nova.ativoAte < nova.inativoApos)) {
    return { ok: false, erro: "O limite de Inativo precisa ser maior que os de Recente e Ativo." };
  }
  return { ok: true, config: nova };
}

/** D-01 — estado pela quantidade de compras e pelos dias desde a última. null = nunca comprou (fora do motor). */
function estadoCliente(compras, diasDesdeUltima, c = CONFIG_PADRAO) {
  if (compras < 1 || diasDesdeUltima === null || diasDesdeUltima === undefined) return null;
  if (diasDesdeUltima > c.inativoApos) return "INACTIVE";
  if (compras === 1) return diasDesdeUltima <= c.recenteAte ? "RECENT" : "ABOUT_TO_SLEEP";
  return diasDesdeUltima <= c.ativoAte ? "ACTIVE" : "ABOUT_TO_SLEEP";
}

/** Ação automática de cada categoria de Break (Regra de Ouro). */
function acaoPadraoBreak(categoria) {
  switch (categoria) {
    case "A_TIME":
      return { reentrada: { tipo: "TIME", dias: 30, condicao: null }, texto: "Retorno em 30 dias" };
    case "C_FINANCIAL":
      return { reentrada: { tipo: "EVENT", dias: null, condicao: "Próxima campanha" }, texto: "Reentrada na próxima campanha" };
    case "D_TRUST":
      return { reentrada: { tipo: "TIME", dias: 7, condicao: null }, texto: "Retorno com prova de confiança em 7 dias" };
    case "NO_INTEREST":
      return { reentrada: { tipo: "TIME", dias: 90, condicao: null }, texto: "Reduzir a frequência: retorno em 90 dias" };
    case "B_PRODUCT":
      return { reentrada: null, texto: "Não oferecer planos semelhantes" };
    case "F_COMPETITOR":
      return { reentrada: null, texto: "Registrar escola, preço e motivo" };
    case "PRIOR_EXPERIENCE":
      return { reentrada: null, texto: "Acionar o coordenador" };
    case "E_PROCESS":
      return { reentrada: null, texto: "Seguir a regra de silêncio; contato inválido corrige o cadastro" };
    case "G_OTHER":
      return { reentrada: null, texto: "Seguir o comentário registrado" };
    default:
      return null;
  }
}

/**
 * Bloqueio de nova tentativa (resultado NO_REPLY e fila do dia). Recebe o retrato do cliente já lido do banco e
 * "agora" em milissegundos; devolve a mensagem do primeiro bloqueio que valer, ou null.
 * cliente: { naoContatar, estado, ultimaCompraEm (ms|null), cicloAberto: {ultimaTentativaEm}|null,
 *            ultimoCicloSemRespostaEm (ms|null), temDataCombinadaHoje (bool) }
 */
function bloqueioDeTentativa(cliente, agora, c = CONFIG_PADRAO) {
  const H = 3_600_000;
  if (cliente.naoContatar) return "O aluno pediu para não ser contatado. Só fale de novo quando ele mandar mensagem.";
  if (cliente.estado === "RECENT" && cliente.ultimaCompraEm && agora - cliente.ultimaCompraEm < c.horasAntesDoPrimeiroContato * H) {
    return `Compra recente: espere ${c.horasAntesDoPrimeiroContato} h depois da matrícula para o primeiro contato.`;
  }
  if (cliente.cicloAberto && cliente.cicloAberto.ultimaTentativaEm && agora - cliente.cicloAberto.ultimaTentativaEm < c.horasEntreTentativas * H) {
    return `Já houve tentativa há menos de ${c.horasEntreTentativas} h. Espere antes de tentar de novo.`;
  }
  if (!cliente.temDataCombinadaHoje && cliente.ultimoCicloSemRespostaEm && agora - cliente.ultimoCicloSemRespostaEm < c.diasEntreCiclos * 24 * H) {
    return `O último ciclo terminou sem resposta. Novo ciclo só depois de ${c.diasEntreCiclos} dias (ou numa data combinada).`;
  }
  return null;
}

const ehCodigo = (listaCodigos, v) => typeof v === "string" && lista(listaCodigos).includes(v);
const dataValida = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`));

/** Valida o registro de 30 segundos. Devolve { ok, dados } ou { ok:false, erro, campo }. */
function validarRegistro(e) {
  const r = e || {};
  const falha = (campo, erro) => ({ ok: false, campo, erro });
  if (!Number.isInteger(r.contatoId)) return falha("contatoId", "Escolha o aluno.");
  if (!ehCodigo(RESULTADOS, r.resultado)) return falha("resultado", "Escolha o resultado do contato.");
  if (!ehCodigo(TEMPERATURAS, r.temperatura)) return falha("temperatura", "Escolha a temperatura da conversa.");
  if (r.estadoEmocional != null && !ehCodigo(ESTADOS_EMOCIONAIS, r.estadoEmocional)) return falha("estadoEmocional", "Estado emocional inválido.");
  const sins = r.sins || [];
  if (!Array.isArray(sins) || sins.length > 3 || sins.some((s) => !ehCodigo(SINS, s)) || new Set(sins).size !== sins.length) return falha("sins", "Marque só os três \"sim\" da lista.");
  if (!ehCodigo(PROXIMAS_ACOES, r.proximaAcao)) return falha("proximaAcao", "Escolha a próxima ação.");
  const semRetorno = r.proximaAcao === "CLOSE_NO_INTEREST" || r.resultado === "OPTED_OUT";
  if (!semRetorno && !dataValida(r.retornoEm)) return falha("retornoEm", "Diga a data do retorno.");
  if (r.escalonamento != null && !ehCodigo(ESCALONAMENTOS, r.escalonamento)) return falha("escalonamento", "Situação de escalonamento inválida.");
  if (r.segundos != null && (!Number.isInteger(r.segundos) || r.segundos < 0 || r.segundos > 36000)) return falha("segundos", "Tempo de registro inválido.");
  if (r.break != null) {
    const b = r.break;
    if (!ehCodigo(CATEGORIAS_BREAK, b.categoria)) return falha("break.categoria", "Escolha a categoria do Break.");
    if (!Number.isInteger(b.motivoId)) return falha("break.motivoId", "Escolha o motivo do Break.");
    const comentario = typeof b.comentario === "string" ? b.comentario.trim() : "";
    if (comentario.length < 3) return falha("break.comentario", "Comentário do Break: escreva o que o aluno disse.");
    if (comentario.length > 1000) return falha("break.comentario", "Comentário: no máximo 1.000 caracteres.");
  }
  return {
    ok: true,
    dados: {
      contatoId: r.contatoId,
      conversaId: Number.isInteger(r.conversaId) ? r.conversaId : null,
      negocioId: Number.isInteger(r.negocioId) ? r.negocioId : null,
      resultado: r.resultado,
      temperatura: r.temperatura,
      estadoEmocional: r.estadoEmocional || null,
      sins,
      interesse: typeof r.interesse === "string" ? r.interesse.trim().slice(0, 120) || null : null,
      proximaAcao: r.proximaAcao,
      retornoEm: semRetorno ? null : r.retornoEm,
      break: r.break ? { categoria: r.break.categoria, motivoId: r.break.motivoId, comentario: r.break.comentario.trim() } : null,
      escalonamento: r.escalonamento || null,
      segundos: r.segundos ?? null,
    },
  };
}

/** Encerramento guiado: critério, temperatura e checklist completo; devolve a lista do que falta. */
function validarEncerramento(e) {
  const r = e || {};
  if (!ehCodigo(CRITERIOS_ENCERRAMENTO, r.criterio)) return { ok: false, erro: "Escolha o critério de encerramento." };
  if (!ehCodigo(TEMPERATURAS, r.temperatura)) return { ok: false, erro: "Escolha a temperatura." };
  const faltando = CHECKLIST_ENCERRAMENTO.filter((i) => !(r.checklist && r.checklist[i.codigo] === true)).map((i) => i.nome);
  if (faltando.length) return { ok: false, erro: `Antes de encerrar, confirme: ${faltando.join(", ")}.`, faltando };
  return { ok: true, ligaNaoContatar: r.criterio === "CUSTOMER_REQUESTED" || r.criterio === "CONTACT_BLOCKED" };
}

// SQ-BRE — 5 pilares de 0 a 20. A IA dá a prévia; só a nota confirmada pelo supervisor conta.
const PILARES_SQ = [
  { codigo: "H", nome: "Humanização" },
  { codigo: "D", nome: "Diagnóstico" },
  { codigo: "I", nome: "Inteligência" },
  { codigo: "V", nome: "Valor" },
  { codigo: "P", nome: "Próximo passo" },
];
function validarNotasSq(n) {
  if (!n || typeof n !== "object") return false;
  return PILARES_SQ.every((p) => Number.isInteger(n[p.codigo]) && n[p.codigo] >= 0 && n[p.codigo] <= 20);
}
const somaSq = (n) => n.H + n.D + n.I + n.V + n.P;
function faixaSq(nota) {
  if (nota >= 95) return "Excelência";
  if (nota >= 85) return "Muito bom";
  if (nota >= 70) return "Bom";
  if (nota >= 50) return "Regular";
  return "Requer reciclagem";
}

// BPI — pilares de 0 a 100 com os pesos da doutrina. Pilar sem dados fica fora e os pesos são redistribuídos.
const PILARES_BPI = [
  { codigo: "receita", nome: "Receita", peso: 30 },
  { codigo: "pipeline", nome: "Pipeline", peso: 20 },
  { codigo: "inteligencia", nome: "Inteligência (CRM)", peso: 20 },
  { codigo: "qualidade", nome: "Qualidade", peso: 20 },
  { codigo: "relacionamento", nome: "Relacionamento", peso: 10 },
];
const contraMeta = (valor, meta) => (meta > 0 ? Math.min(100, (valor / meta) * 100) : 0);
function calcularBpi(notas) {
  const presentes = PILARES_BPI.filter((p) => notas[p.codigo] !== null && notas[p.codigo] !== undefined);
  const pesos = presentes.reduce((t, p) => t + p.peso, 0);
  if (!pesos) return null;
  return Math.round((presentes.reduce((t, p) => t + p.peso * notas[p.codigo], 0) / pesos) * 10) / 10;
}
function faixaBpi(bpi) {
  if (bpi >= 95) return "Elite";
  if (bpi >= 90) return "Excelente";
  if (bpi >= 80) return "Muito bom";
  if (bpi >= 70) return "Adequado";
  return "Plano de desenvolvimento";
}

/**
 * Filtros do motor sobre a sugestão da IA (a IA sugere, o motor decide). Devolve a sugestão já filtrada e os motivos.
 * contexto: { estado, temDiagnostico (oportunidade em INTEREST/PROPOSAL/NEGOTIATION/SALE) }
 */
function filtrarSugestao(saida, contexto) {
  const s = { ...saida };
  const bloqueios = [];
  if (s.sugereDesconto && contexto.estado === "RECENT") {
    s.sugereDesconto = false;
    bloqueios.push("Desconto descartado: aluno recente não recebe desconto.");
  }
  if (s.sugereDesconto && !contexto.temDiagnostico) {
    s.sugereDesconto = false;
    bloqueios.push("Desconto descartado: o diagnóstico ainda não foi concluído.");
  }
  if (s.sugereOferta && (s.sins || []).length < 3) {
    s.sugereOferta = false;
    bloqueios.push("Oferta descartada: ainda não vieram os três \"sim\".");
  }
  return { sugestao: s, bloqueios };
}

/** Confere a saída da IA contra as listas (o esquema da API já força a forma; isto garante os valores). */
function validarSaidaIa(s) {
  const erros = [];
  if (!s || typeof s !== "object") return ["Resposta vazia."];
  if (typeof s.resumo !== "string" || s.resumo.length > 1000) erros.push("resumo");
  if (!ehCodigo(RESULTADOS, s.resultado)) erros.push("resultado");
  if (!ehCodigo(TEMPERATURAS, s.temperatura)) erros.push("temperatura");
  if (s.estadoEmocional !== null && !ehCodigo(ESTADOS_EMOCIONAIS, s.estadoEmocional)) erros.push("estadoEmocional");
  if (!Array.isArray(s.sins) || s.sins.some((x) => !ehCodigo(SINS, x))) erros.push("sins");
  if (s.break !== null && (!s.break || !ehCodigo(CATEGORIAS_BREAK, s.break.categoria) || typeof s.break.comentario !== "string")) erros.push("break");
  if (!ehCodigo(PROXIMAS_ACOES, s.proximaAcao)) erros.push("proximaAcao");
  if (s.retornoEmDias !== null && (!Number.isInteger(s.retornoEmDias) || s.retornoEmDias < 0 || s.retornoEmDias > 365)) erros.push("retornoEmDias");
  if (typeof s.sugereOferta !== "boolean" || typeof s.sugereDesconto !== "boolean") erros.push("sugestões");
  if (s.escalonamento !== null && !ehCodigo(ESCALONAMENTOS, s.escalonamento)) erros.push("escalonamento");
  if (!validarNotasSq(s.sqBre)) erros.push("sqBre");
  if (!Array.isArray(s.incertezas) || s.incertezas.length > 10) erros.push("incertezas");
  return erros;
}

/**
 * LGPD — troca dados pessoais por marcadores antes de a conversa sair para a IA.
 * A ordem importa: e-mail, nome, endereço, documentos com pontuação e só então telefone (pega dígitos longos).
 */
function mascararDadosPessoais(texto, nomes = []) {
  const partes = [...new Set(nomes.flatMap((n) => String(n || "").split(/\s+/)).filter((p) => p.length >= 3))].map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  // E-mail antes do nome: senão "ana@x.com" viraria "[nome]@x.com" e o domínio vazaria.
  const semEmail = texto.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[e-mail]");
  const semNome = partes.length ? semEmail.replace(new RegExp(`(?<!\\p{L})(${partes.join("|")})(?!\\p{L})`, "giu"), "[nome]") : semEmail;
  return semNome
    .replace(/\b(rua|r\.|avenida|av\.?|travessa|tv\.|alameda|al\.|rodovia|estrada|praça|largo)\s+[^,\n]{2,60}(,\s*(n[ºo°.]?\s*)?\d+[a-z]?)?/giu, "[endereço]")
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[CPF]")
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, "[CNPJ]")
    .replace(/\b\d{5}-\d{3}\b/g, "[CEP]")
    .replace(/(\+?\(?\d[\d\s().-]{7,}\d)/g, (m) => (m.replace(/\D/g, "").length >= 8 ? "[telefone]" : m));
}

module.exports = {
  lista,
  MARCOS, TRANSICOES, transicaoPermitida, nomeMarco,
  ESTADOS_CLIENTE, CATEGORIAS_BREAK, MOTIVOS_BREAK_PADRAO, ESTADOS_EMOCIONAIS, TEMPERATURAS, temperaturaDoNegocio,
  RESULTADOS, TIPOS_REENTRADA, ESCALONAMENTOS, CRITERIOS_ENCERRAMENTO, CHECKLIST_ENCERRAMENTO, SINS, PROXIMAS_ACOES,
  LIMITES, CONFIG_PADRAO, validarConfig,
  estadoCliente, acaoPadraoBreak, bloqueioDeTentativa, validarRegistro, validarEncerramento,
  PILARES_SQ, validarNotasSq, somaSq, faixaSq,
  PILARES_BPI, contraMeta, calcularBpi, faixaBpi,
  filtrarSugestao, validarSaidaIa, mascararDadosPessoais,
};
````

## Apêndice B — `lib/bre/ia.js` (IA atrás de interface (Claude ou demonstração))

````js
// IA do motor BRE atrás de uma interface: Claude quando há ANTHROPIC_API_KEY; sem ela, a versão de demonstração
// (regras por palavras), que funciona sem conta. As duas devolvem o mesmo formato, conferido por regras.validarSaidaIa.
// A IA SUGERE; quem decide é o motor (regras.filtrarSugestao) e quem confirma é a pessoa.
"use strict";
const r = require("./regras");

class IaIndisponivel extends Error {}

const INSTRUCOES = `Você apoia consultores de uma escola de idiomas que seguem a doutrina comercial BRE. Leia a conversa de WhatsApp entre o consultor e o aluno (ou interessado) e preencha o registro pós-conversa usando só os códigos das listas do esquema.
- resultado: PURCHASED se matriculou/comprou; ADVANCED se avançou para o próximo passo; REPLIED_NO_ADVANCE se respondeu sem avançar; NO_REPLY se não respondeu; OPTED_OUT se pediu para não ser mais contatado.
- sins: só os "sim" que o aluno deu de fato: CONFIRMATION (confirmou a experiência), AGREEMENT (concordou com o que foi dito), VISUALIZATION (se imaginou estudando/usando).
- break: só se houve quebra (recusa, objeção, adiamento), com a categoria e, em comentario, o que o aluno disse com as palavras dele.
- sugereOferta e sugereDesconto: true só se a conversa pede uma oferta ou um desconto agora.
- escalonamento: READY_TO_BUY, TECHNICAL_HELP, VIP ou COMPLAINT quando a conversa precisa de uma pessoa; senão null.
- sqBre: nota prévia de qualidade do consultor, de 0 a 20 em cada pilar: H (humanização), D (diagnóstico), I (inteligência: quanto a conversa trouxe de dado novo), V (valor: benefício, diferença, recomendação personalizada, não vendeu só desconto), P (próximo passo: 20 com ação e data, 10 com ação sem data, 0 sem ação).
- resumo em português, factual, sem inventar preço, vaga, horário ou dado do aluno. O que não der para saber vai em incertezas.`;

const enumDe = (lista) => ({ type: "string", enum: r.lista(lista) });
const ouNulo = (esquema) => ({ anyOf: [esquema, { type: "null" }] });
/** Esquema JSON da saída (a API força o formato; os limites numéricos são conferidos no servidor). */
const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["resumo", "resultado", "temperatura", "estadoEmocional", "sins", "break", "proximaAcao", "retornoEmDias", "sugereOferta", "sugereDesconto", "escalonamento", "sqBre", "incertezas"],
  properties: {
    resumo: { type: "string" },
    resultado: enumDe(r.RESULTADOS),
    temperatura: enumDe(r.TEMPERATURAS),
    estadoEmocional: ouNulo(enumDe(r.ESTADOS_EMOCIONAIS)),
    sins: { type: "array", items: enumDe(r.SINS) },
    break: ouNulo({
      type: "object",
      additionalProperties: false,
      required: ["categoria", "comentario"],
      properties: { categoria: enumDe(r.CATEGORIAS_BREAK), comentario: { type: "string" } },
    }),
    proximaAcao: enumDe(r.PROXIMAS_ACOES),
    retornoEmDias: ouNulo({ type: "integer" }),
    sugereOferta: { type: "boolean" },
    sugereDesconto: { type: "boolean" },
    escalonamento: ouNulo(enumDe(r.ESCALONAMENTOS)),
    sqBre: {
      type: "object",
      additionalProperties: false,
      required: ["H", "D", "I", "V", "P"],
      properties: { H: { type: "integer" }, D: { type: "integer" }, I: { type: "integer" }, V: { type: "integer" }, P: { type: "integer" } },
    },
    incertezas: { type: "array", items: { type: "string" } },
  },
};

/** mensagens: [{ de: "cliente" | "atendente", texto }] — já mascaradas quando a config manda. */
function provedorDemonstracao() {
  return {
    nome: "demonstracao",
    async analisar(mensagens) {
      const cliente = mensagens.filter((m) => m.de === "cliente").map((m) => m.texto.toLowerCase()).join("\n");
      const atendente = mensagens.filter((m) => m.de === "atendente").map((m) => m.texto.toLowerCase()).join("\n");
      const tem = (re) => re.test(cliente);
      const saiu = tem(/não (me )?(mande|envie|chame)|parar de receber|sair da lista|não quero mais/);
      const caro = tem(/caro|preço|desconto|sem dinheiro|orçamento/);
      const comprou = tem(/matricul|fechado|pode mandar o contrato|vou fazer|quero começar/);
      const reclamou = tem(/reclama|péssim|horrível|problema com/);
      const respondeu = cliente.trim().length > 0;
      return {
        saida: {
          resumo: respondeu ? "Resumo da demonstração: houve resposta na conversa." : "Sem resposta na conversa.",
          resultado: saiu ? "OPTED_OUT" : comprou ? "PURCHASED" : !respondeu ? "NO_REPLY" : caro ? "REPLIED_NO_ADVANCE" : "ADVANCED",
          temperatura: comprou ? "READY_TO_BUY" : caro ? "WARM" : respondeu ? "HOT" : "COLD",
          estadoEmocional: caro ? "WARY" : respondeu ? "INTERESTED" : null,
          sins: comprou ? ["CONFIRMATION", "AGREEMENT", "VISUALIZATION"] : respondeu ? ["CONFIRMATION"] : [],
          break: caro && !comprou ? { categoria: "C_FINANCIAL", comentario: "Falou de preço." } : null,
          proximaAcao: saiu ? "CLOSE_NO_INTEREST" : caro ? "CALL_BACK" : "SEND_SAMPLE",
          retornoEmDias: saiu ? null : caro ? 30 : 3,
          sugereOferta: !saiu && respondeu,
          sugereDesconto: caro,
          escalonamento: reclamou ? "COMPLAINT" : comprou ? "READY_TO_BUY" : null,
          sqBre: { H: atendente ? 12 : 0, D: /\?/.test(atendente) ? 12 : 4, I: respondeu ? 8 : 0, V: caro ? 8 : 12, P: saiu ? 0 : 20 },
          incertezas: ["Análise de demonstração por palavras; configure ANTHROPIC_API_KEY para a análise completa."],
        },
      };
    },
  };
}

/** Claude com saída estruturada (JSON Schema); recusa vira IaIndisponivel com motivo claro, sem nova tentativa. */
function provedorClaude(chave, modelo) {
  // Carregado só aqui: sem chave, o SDK nem é importado.
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: chave, timeout: 120_000, maxRetries: 2 });
  return {
    nome: `claude:${modelo}`,
    async analisar(mensagens) {
      const conversa = mensagens.map((m) => `${m.de === "cliente" ? "Aluno" : "Consultor"}: ${m.texto}`).join("\n");
      const resposta = await client.beta.messages.create({
        model: modelo,
        max_tokens: 16000,
        // Recusa do modelo principal é refeita no modelo reserva, na mesma chamada.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: ESQUEMA } },
        system: [{ type: "text", text: INSTRUCOES, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `Conversa:\n${conversa}` }],
      });
      if (resposta.stop_reason === "refusal") throw new IaIndisponivel("A IA não analisou esta conversa. Preencha o registro manualmente.");
      if (resposta.stop_reason === "max_tokens") throw new IaIndisponivel("A resposta da IA veio incompleta. Tente de novo ou preencha manualmente.");
      const texto = (resposta.content.find((b) => b.type === "text") || {}).text;
      let saida;
      try {
        saida = JSON.parse(texto);
      } catch {
        throw new IaIndisponivel("A IA respondeu fora do formato. Preencha o registro manualmente.");
      }
      return { saida, tokens: { entrada: resposta.usage.input_tokens, saida: resposta.usage.output_tokens } };
    },
  };
}

function criarProvedorIa(env = process.env) {
  const chave = (env.ANTHROPIC_API_KEY || "").trim();
  return chave ? provedorClaude(chave, (env.BRE_IA_MODELO || "claude-opus-5-5").trim()) : provedorDemonstracao();
}

/**
 * Erro passageiro (rede, limite, servidor fora) volta para a fila tentar de novo; o resto vira "falhou" com motivo.
 * Usa as classes de erro do SDK, nunca o texto da mensagem.
 */
function ehPassageiro(erro) {
  let Anthropic;
  try {
    Anthropic = require("@anthropic-ai/sdk");
  } catch {
    return false;
  }
  return erro instanceof Anthropic.RateLimitError || erro instanceof Anthropic.APIConnectionError || erro instanceof Anthropic.InternalServerError;
}

module.exports = { IaIndisponivel, INSTRUCOES, ESQUEMA, provedorDemonstracao, provedorClaude, criarProvedorIa, ehPassageiro };
````

## Apêndice C — `lib/bre/motor.js` (Serviço do motor: registro, ciclo, Break, reentrada, escalonamento, rotinas)

````js
// Motor BRE — serviço: lê e grava no banco e aplica as regras puras de ./regras.js. Sem req/res.
// Tudo síncrono (better-sqlite3) e cada ação numa transação: ou grava tudo, ou nada.
// ctx = { db, agora: () => ms, hoje: () => "AAAA-MM-DD" (data local da escola),
//         efeitos: { timeline(contatoId, negocioId, tipo, texto, autorId), avisar(vendedorId, evento, dados) } }
"use strict";
const R = require("./regras");

class ErroBre extends Error {
  constructor(status, mensagem, campo) { super(mensagem); this.status = status; this.campo = campo || null; }
}

const utc = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19); // igual ao datetime('now') do SQLite
const ms = (texto) => (texto ? Date.parse(texto.replace(" ", "T") + "Z") : null);
const somarDias = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function lerConfig(db) {
  const linha = db.prepare("SELECT config FROM bre_config WHERE id = 1").get();
  return { ...R.CONFIG_PADRAO, ...(linha ? JSON.parse(linha.config) : {}) };
}

/** Motivos de Break: na primeira leitura semeia os padrões da doutrina (uma vez só). */
function motivos(db) {
  if (!db.prepare("SELECT 1 FROM bre_motivos_break LIMIT 1").get()) {
    const ins = db.prepare("INSERT INTO bre_motivos_break (categoria, nome) VALUES (?, ?)");
    db.transaction(() => { for (const [cat, nomes] of Object.entries(R.MOTIVOS_BREAK_PADRAO)) for (const n of nomes) ins.run(cat, n); })();
  }
  return db.prepare("SELECT id, categoria, nome FROM bre_motivos_break WHERE deleted_at IS NULL ORDER BY categoria, nome").all();
}

/** Retrato do aluno para os bloqueios de tentativa (seção 4.2 da doutrina). */
function retratoCliente(ctx, contatoId) {
  const { db } = ctx;
  const hoje = ctx.hoje();
  const c = db.prepare("SELECT nao_contatar, estado_bre, ultima_compra_em FROM crm_contatos WHERE id = ?").get(contatoId);
  const aberto = db.prepare("SELECT * FROM bre_ciclos WHERE contato_id = ? AND encerrado_em IS NULL").get(contatoId);
  const ultimo = db.prepare("SELECT encerrado_em FROM bre_ciclos WHERE contato_id = ? AND encerrado_em IS NOT NULL AND sem_resposta = 1 ORDER BY encerrado_em DESC LIMIT 1").get(contatoId);
  const combinada =
    db.prepare("SELECT 1 FROM bre_reentradas WHERE contato_id = ? AND status = 'pendente' AND prevista_para <= ?").get(contatoId, hoje) ||
    db.prepare("SELECT 1 FROM bre_registros WHERE contato_id = ? AND retorno_em = ?").get(contatoId, hoje);
  return {
    naoContatar: c.nao_contatar === 1,
    estado: c.estado_bre,
    ultimaCompraEm: c.ultima_compra_em ? Date.parse(`${c.ultima_compra_em.slice(0, 10)}T12:00:00Z`) : null,
    cicloAberto: aberto ? { id: aberto.id, tentativas: aberto.tentativas, ultimaTentativaEm: ms(aberto.ultima_tentativa_em) } : null,
    ultimoCicloSemRespostaEm: ultimo ? ms(ultimo.encerrado_em) : null,
    temDataCombinadaHoje: Boolean(combinada),
  };
}

function programarReentrada(ctx, { contatoId, tipo, dias, condicao, motivo, breakId, autorId }) {
  const prevista = dias != null ? somarDias(ctx.hoje(), dias) : null;
  return ctx.db
    .prepare("INSERT INTO bre_reentradas (contato_id, tipo, prevista_para, condicao, motivo, break_id, criado_por) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(contatoId, tipo, prevista, condicao || null, motivo.slice(0, 300), breakId || null, autorId || null).lastInsertRowid;
}

function criarTarefa(ctx, { contatoId, negocioId, vendedorId, titulo, dia, origem, autorId }) {
  ctx.db
    .prepare("INSERT INTO crm_atividades (negocio_id, contato_id, vendedor_id, tipo, titulo, vence_em, criado_por, origem_bre) VALUES (?, ?, ?, 'tarefa', ?, ?, ?, ?)")
    .run(negocioId || null, contatoId, vendedorId, titulo, `${dia}T09:00`, autorId || null, origem);
}

function fecharCiclo(ctx, cicloId, motivo, semResposta) {
  ctx.db.prepare("UPDATE bre_ciclos SET encerrado_em = ?, motivo_encerramento = ?, sem_resposta = ? WHERE id = ?").run(utc(ctx.agora()), motivo, semResposta ? 1 : 0, cicloId);
}

function abrirEscalonamento(ctx, { contatoId, conversaId, situacao, origem, autorId }) {
  const { changes } = ctx.db
    .prepare("INSERT OR IGNORE INTO bre_escalonamentos (contato_id, conversa_id, situacao, origem, criado_por) VALUES (?, ?, ?, ?, ?)")
    .run(contatoId, conversaId || null, situacao, origem, autorId || null);
  if (changes) {
    const dono = ctx.db.prepare("SELECT vendedor_id FROM crm_contatos WHERE id = ?").get(contatoId);
    ctx.efeitos.avisar(dono && dono.vendedor_id, "bre.escalonamento", { contato_id: contatoId, situacao });
  }
  return changes === 1;
}

/**
 * Registro de 30 segundos (seção 4.5): valida, aplica bloqueios, ciclo, Break, reentradas, tarefas e
 * escalonamento. usuario = { id }. Quem chama já conferiu a permissão e a carteira (podeVerContato).
 */
function registrarConversa(ctx, usuario, entrada) {
  const { db } = ctx;
  const v = R.validarRegistro(entrada);
  if (!v.ok) throw new ErroBre(400, v.erro, v.campo);
  const d = v.dados;
  const contato = db.prepare("SELECT id, nome, vendedor_id FROM crm_contatos WHERE id = ? AND deleted_at IS NULL").get(d.contatoId);
  if (!contato) throw new ErroBre(404, "Aluno não encontrado.", "contatoId");
  const config = lerConfig(db);
  const retrato = retratoCliente(ctx, d.contatoId);
  if (d.resultado === "NO_REPLY") {
    const bloqueio = R.bloqueioDeTentativa(retrato, ctx.agora(), config);
    if (bloqueio) throw new ErroBre(409, bloqueio, "resultado");
  }
  let motivo = null;
  if (d.break) {
    motivo = db.prepare("SELECT id, nome FROM bre_motivos_break WHERE id = ? AND categoria = ? AND deleted_at IS NULL").get(d.break.motivoId, d.break.categoria);
    if (!motivo) throw new ErroBre(400, "O motivo do Break precisa ser da categoria escolhida.", "break.motivoId");
  }
  let marco = null;
  if (d.negocioId) {
    const n = db.prepare("SELECT n.id, e.marco_bre FROM crm_negocios n JOIN crm_etapas e ON e.id = n.etapa_id WHERE n.id = ? AND n.contato_id = ?").get(d.negocioId, d.contatoId);
    if (!n) throw new ErroBre(400, "Esta oportunidade não é deste aluno.", "negocioId");
    marco = n.marco_bre;
  }

  return db.transaction(() => {
    const agora = utc(ctx.agora());
    // Ciclo: abre se não houver; NO_REPLY soma tentativa; qualquer outro resultado conta como resposta.
    let ciclo = retrato.cicloAberto;
    if (!ciclo) ciclo = { id: db.prepare("INSERT INTO bre_ciclos (contato_id) VALUES (?)").run(d.contatoId).lastInsertRowid, tentativas: 0 };
    if (d.resultado === "NO_REPLY") {
      db.prepare("UPDATE bre_ciclos SET tentativas = tentativas + 1, ultima_tentativa_em = ? WHERE id = ?").run(agora, ciclo.id);
    } else {
      db.prepare("UPDATE bre_ciclos SET ultima_resposta_em = ? WHERE id = ?").run(agora, ciclo.id);
    }
    const registroId = db
      .prepare(`INSERT INTO bre_registros (contato_id, autor_id, conversa_id, negocio_id, ciclo_id, analise_id, marco, resultado, temperatura,
                estado_emocional, sins, interesse, proxima_acao, retorno_em, segundos) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(d.contatoId, usuario.id, d.conversaId, d.negocioId, ciclo.id, Number.isInteger(entrada.analiseId) ? entrada.analiseId : null, marco,
        d.resultado, d.temperatura, d.estadoEmocional, JSON.stringify(d.sins), d.interesse, d.proximaAcao, d.retornoEm, d.segundos).lastInsertRowid;

    if (d.resultado === "NO_REPLY" && ciclo.tentativas + 1 >= config.tentativasPorCiclo) {
      fecharCiclo(ctx, ciclo.id, "MAX_ATTEMPTS", true);
      programarReentrada(ctx, { contatoId: d.contatoId, tipo: "TIME", dias: config.diasEntreCiclos, motivo: `Ciclo sem resposta após ${config.tentativasPorCiclo} tentativas`, autorId: usuario.id });
    } else if (d.resultado === "PURCHASED") {
      fecharCiclo(ctx, ciclo.id, "PURCHASE_DONE", false);
      for (const dias of config.diasPosVenda) {
        criarTarefa(ctx, { contatoId: d.contatoId, negocioId: d.negocioId, vendedorId: contato.vendedor_id || usuario.id, titulo: `Pós-venda D+${dias}: ${contato.nome}`, dia: somarDias(ctx.hoje(), dias), origem: "pos_venda", autorId: usuario.id });
      }
    } else if (d.resultado === "OPTED_OUT") {
      fecharCiclo(ctx, ciclo.id, "CUSTOMER_REQUESTED", false);
      db.prepare("UPDATE crm_contatos SET nao_contatar = 1 WHERE id = ?").run(d.contatoId);
      db.prepare("UPDATE bre_reentradas SET status = 'cancelada', concluida_em = ? WHERE contato_id = ? AND status = 'pendente'").run(agora, d.contatoId);
    }

    if (d.break) {
      const acao = R.acaoPadraoBreak(d.break.categoria);
      const breakId = db
        .prepare("INSERT INTO bre_breaks (contato_id, registro_id, negocio_id, categoria, motivo_id, comentario, marco, acao_padrao, autor_id) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(d.contatoId, registroId, d.negocioId, d.break.categoria, motivo.id, d.break.comentario, marco, acao.texto, usuario.id).lastInsertRowid;
      if (acao.reentrada && d.resultado !== "OPTED_OUT") {
        programarReentrada(ctx, { contatoId: d.contatoId, ...acao.reentrada, motivo: `Break: ${motivo.nome}`, breakId, autorId: usuario.id });
      }
    }
    if (d.retornoEm) {
      criarTarefa(ctx, { contatoId: d.contatoId, negocioId: d.negocioId, vendedorId: usuario.id, titulo: `Retorno: ${contato.nome}`, dia: d.retornoEm, origem: "retorno", autorId: usuario.id });
    }
    if (d.escalonamento) abrirEscalonamento(ctx, { contatoId: d.contatoId, conversaId: d.conversaId, situacao: d.escalonamento, origem: "manual", autorId: usuario.id });

    const temp = R.TEMPERATURAS.find((t) => t.codigo === d.temperatura);
    if (d.negocioId) db.prepare("UPDATE crm_negocios SET temperatura = ?, atualizado_em = datetime('now') WHERE id = ?").run(temp.lumen, d.negocioId);
    const res = R.RESULTADOS.find((r) => r.codigo === d.resultado);
    ctx.efeitos.timeline(d.contatoId, d.negocioId, "bre", `Registro BRE: ${res.nome} · ${temp.nome}${d.break ? ` · Break: ${motivo.nome}` : ""}`, usuario.id);
    return { id: registroId, cicloId: ciclo.id };
  })();
}

/** Rotina horária (minuto 11): ciclo com tentativa e sem resposta há mais de N dias fecha por SILENCE. */
function rotinaSilencio(ctx) {
  const { db } = ctx;
  const config = lerConfig(db);
  const limite = utc(ctx.agora() - config.diasSilencioEncerra * 86_400_000);
  const ciclos = db
    .prepare(`SELECT id, contato_id FROM bre_ciclos WHERE encerrado_em IS NULL AND tentativas > 0 AND ultima_tentativa_em < ?
              AND (ultima_resposta_em IS NULL OR ultima_resposta_em < ultima_tentativa_em)`)
    .all(limite);
  db.transaction(() => {
    for (const c of ciclos) {
      fecharCiclo(ctx, c.id, "SILENCE", true);
      programarReentrada(ctx, { contatoId: c.contato_id, tipo: "TIME", dias: config.diasEntreCiclos, motivo: `Silêncio de ${config.diasSilencioEncerra} dias` });
    }
  })();
  return ciclos.length;
}

/**
 * Rotina diária (03:07): estado de cada aluno a partir das matrículas. No Lumen a venda não tem contato_id:
 * o vínculo é o negócio ganho (crm_negocios.venda_id); a data é a da venda, ou o fechamento do negócio.
 */
function rotinaEstadoCliente(ctx) {
  const { db } = ctx;
  const config = lerConfig(db);
  const hoje = ctx.hoje();
  const linhas = db
    .prepare(`SELECT c.id, c.estado_bre, COUNT(n.id) AS compras, MAX(COALESCE(v.data_venda, substr(n.fechado_em, 1, 10))) AS ultima
              FROM crm_contatos c
              LEFT JOIN crm_negocios n ON n.contato_id = c.id AND n.status = 'ganho' AND n.deleted_at IS NULL
              LEFT JOIN vendas v ON v.id = n.venda_id
              WHERE c.deleted_at IS NULL GROUP BY c.id`)
    .all();
  const atualizar = db.prepare("UPDATE crm_contatos SET estado_bre = ?, estado_bre_em = ?, compras_qtd = ?, ultima_compra_em = ? WHERE id = ?");
  let mudou = 0;
  db.transaction(() => {
    for (const l of linhas) {
      const dias = l.ultima ? Math.floor((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${l.ultima.slice(0, 10)}T12:00:00Z`)) / 86_400_000) : null;
      const estado = R.estadoCliente(l.compras, dias, config);
      if (estado === l.estado_bre) continue; // só grava o que mudou
      atualizar.run(estado, hoje, l.compras, l.ultima, l.id);
      ctx.efeitos.timeline(l.id, null, "bre", `Estado BRE: ${estado ? R.ESTADOS_CLIENTE.find((e) => e.codigo === estado).nome : "sem matrícula"}`, null);
      mudou++;
    }
  })();
  return mudou;
}

module.exports = { ErroBre, lerConfig, motivos, retratoCliente, registrarConversa, abrirEscalonamento, programarReentrada, rotinaSilencio, rotinaEstadoCliente, somarDias };
````

## Apêndice D — `lib/agendador.js` (Agendador único persistido)

````js
// Agendador ÚNICO do Lumen (nasce com o BRE; o backup e a limpeza da telefonia passam para ele na etapa E2). O Lumen não tem fila de jobs; em vez de vários setInterval espalhados, um só
// relógio (a cada 30 s, .unref()) decide pelo BANCO o que está na hora. Quem decide é a função pura rotinaDevida;
// o estado (última execução, último erro) fica na tabela rotinas, então reiniciar o servidor não perde nem repete nada.
// Requisito: uma réplica só (já é a regra do Lumen, pelo SSE em memória).
"use strict";

/**
 * Está na hora? regra: { tipo: "diaria", hora: "03:07" } | { tipo: "horaria", minuto: 11 } | { tipo: "intervalo", minutos: 1 }
 * agora e ultima: hora local "AAAA-MM-DD HH:MM" (ultima pode ser null). Rotina atrasada (servidor fora no horário)
 * roda assim que o servidor volta — uma vez só.
 */
function rotinaDevida(regra, agora, ultima) {
  const [dia, hhmm] = agora.split(" ");
  if (regra.tipo === "diaria") {
    const marco = `${dia} ${regra.hora}`;
    return agora >= marco && (!ultima || ultima < marco);
  }
  if (regra.tipo === "horaria") {
    const marco = `${dia} ${hhmm.slice(0, 2)}:${String(regra.minuto).padStart(2, "0")}`;
    return agora >= marco && (!ultima || ultima < marco);
  }
  if (regra.tipo === "intervalo") {
    if (!ultima) return true;
    const minutos = (Date.parse(agora.replace(" ", "T") + ":00Z") - Date.parse(ultima.replace(" ", "T") + ":00Z")) / 60_000;
    return minutos >= regra.minutos;
  }
  throw new Error(`Regra de rotina desconhecida: ${JSON.stringify(regra)}`);
}

/** horaLocal: função do lib/comum.js que devolve "AAAA-MM-DD HH:MM:SS" no fuso da empresa. */
function criarAgendador({ db, horaLocal, log = console }) {
  const rotinas = [];
  const rodando = new Set();
  let relogio = null;
  db.exec(`CREATE TABLE IF NOT EXISTS rotinas (
    nome            TEXT PRIMARY KEY,
    ultima_execucao TEXT,             -- hora LOCAL de início (AAAA-MM-DD HH:MM)
    ultimo_erro     TEXT,
    ultimo_erro_em  TEXT,
    duracao_ms      INTEGER
  )`);

  function registrar(nome, regra, fn) {
    rotinaDevida(regra, "2000-01-01 00:00", null); // valida a regra na hora de registrar
    db.prepare("INSERT OR IGNORE INTO rotinas (nome) VALUES (?)").run(nome);
    rotinas.push({ nome, regra, fn });
  }

  async function tique() {
    const agora = horaLocal().slice(0, 16);
    for (const r of rotinas) {
      if (rodando.has(r.nome)) continue; // a anterior ainda não terminou
      const { ultima_execucao: ultima } = db.prepare("SELECT ultima_execucao FROM rotinas WHERE nome = ?").get(r.nome);
      if (!rotinaDevida(r.regra, agora, ultima)) continue;
      rodando.add(r.nome);
      // Marca ANTES de rodar: se cair no meio, não repete em loop; o erro fica registrado para a tela de saúde.
      db.prepare("UPDATE rotinas SET ultima_execucao = ? WHERE nome = ?").run(agora, r.nome);
      const inicio = Date.now();
      try {
        await r.fn();
        db.prepare("UPDATE rotinas SET duracao_ms = ? WHERE nome = ?").run(Date.now() - inicio, r.nome);
      } catch (erro) {
        log.error(`[BRE] rotina ${r.nome} falhou:`, erro);
        db.prepare("UPDATE rotinas SET ultimo_erro = ?, ultimo_erro_em = ? WHERE nome = ?").run(String(erro && erro.message ? erro.message : erro).slice(0, 500), agora, r.nome);
      } finally {
        rodando.delete(r.nome);
      }
    }
  }

  return {
    registrar,
    tique,
    iniciar(segundos = 30) {
      if (relogio) return;
      relogio = setInterval(() => void tique(), segundos * 1000);
      relogio.unref();
    },
    parar() {
      clearInterval(relogio);
      relogio = null;
    },
    situacao: () => db.prepare("SELECT * FROM rotinas ORDER BY nome").all(),
  };
}

module.exports = { rotinaDevida, criarAgendador };
````

## Apêndice E — `db/bre.sql` (Tabelas novas (idempotente))

````sql
-- Motor BRE no Lumen Operações. Idempotente: roda a cada boot (CREATE ... IF NOT EXISTS), como db/crm.sql.
-- Colunas novas em tabelas que já existem vão na lista de ALTERs de db/index.js (ver seção 7 do guia).
-- Datas do sistema em UTC (datetime('now')); datas que a pessoa escolhe (retorno_em, prevista_para) em data local.
-- Nada some: arquivar é deleted_at; registros, breaks, análises e notas são só de inserção (gatilhos abaixo).

CREATE TABLE IF NOT EXISTS bre_config (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  config         TEXT NOT NULL DEFAULT '{}',          -- JSON validado por regras.validarConfig
  versao         INTEGER NOT NULL DEFAULT 1,
  atualizado_por INTEGER REFERENCES users(id),
  atualizado_em  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bre_motivos_break (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  categoria  TEXT NOT NULL CHECK (categoria IN ('A_TIME','B_PRODUCT','C_FINANCIAL','D_TRUST','E_PROCESS','F_COMPETITOR','G_OTHER','PRIOR_EXPERIENCE','NO_INTEREST')),
  nome       TEXT NOT NULL CHECK (length(nome) BETWEEN 1 AND 80),
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS bre_motivos_break_uk ON bre_motivos_break (categoria, lower(nome)) WHERE deleted_at IS NULL;

-- Ciclo de contato: no máximo UM aberto por aluno.
CREATE TABLE IF NOT EXISTS bre_ciclos (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  contato_id          INTEGER NOT NULL REFERENCES crm_contatos(id),
  aberto_em           TEXT NOT NULL DEFAULT (datetime('now')),
  tentativas          INTEGER NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  ultima_tentativa_em TEXT,
  ultima_resposta_em  TEXT,
  sem_resposta        INTEGER NOT NULL DEFAULT 0 CHECK (sem_resposta IN (0,1)),
  encerrado_em        TEXT,
  motivo_encerramento TEXT CHECK (motivo_encerramento IN ('MAX_ATTEMPTS','SILENCE','PURCHASE_DONE','CUSTOMER_REQUESTED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS bre_ciclos_aberto_uk ON bre_ciclos (contato_id) WHERE encerrado_em IS NULL;
CREATE INDEX IF NOT EXISTS bre_ciclos_contato_idx ON bre_ciclos (contato_id, encerrado_em);

-- Pedido à IA. É também a fila: o agendador pega os "processando" (tabela como fila, sem dependência nova).
CREATE TABLE IF NOT EXISTS bre_analises (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  conversa_id    INTEGER NOT NULL REFERENCES wa_conversas(id),
  contato_id     INTEGER NOT NULL REFERENCES crm_contatos(id),
  pedido_por     INTEGER NOT NULL REFERENCES users(id),
  tipo           TEXT NOT NULL DEFAULT 'registro' CHECK (tipo IN ('registro','sq')),
  provedor       TEXT,
  doutrina       TEXT NOT NULL DEFAULT 'BRE-v1.0 / ETR 0.2',
  status         TEXT NOT NULL DEFAULT 'processando' CHECK (status IN ('processando','pronta','falhou')),
  tentativas     INTEGER NOT NULL DEFAULT 0,
  iniciada_em    TEXT,
  saida          TEXT,                                -- JSON já filtrado pelo motor
  bloqueios      TEXT NOT NULL DEFAULT '[]',
  erro           TEXT,
  ms             INTEGER,
  tokens_entrada INTEGER,
  tokens_saida   INTEGER,
  criado_em      TEXT NOT NULL DEFAULT (datetime('now')),
  concluida_em   TEXT
);
CREATE INDEX IF NOT EXISTS bre_analises_fila_idx ON bre_analises (status, criado_em);

-- Registro de 30 segundos (os 8 campos). Só inserção.
CREATE TABLE IF NOT EXISTS bre_registros (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  contato_id       INTEGER NOT NULL REFERENCES crm_contatos(id),
  autor_id         INTEGER NOT NULL REFERENCES users(id),
  conversa_id      INTEGER REFERENCES wa_conversas(id),
  negocio_id       INTEGER REFERENCES crm_negocios(id),
  ciclo_id         INTEGER REFERENCES bre_ciclos(id),
  analise_id       INTEGER REFERENCES bre_analises(id),
  marco            TEXT,
  resultado        TEXT NOT NULL CHECK (resultado IN ('PURCHASED','ADVANCED','REPLIED_NO_ADVANCE','NO_REPLY','OPTED_OUT')),
  temperatura      TEXT NOT NULL CHECK (temperatura IN ('COLD','WARM','HOT','READY_TO_BUY')),
  estado_emocional TEXT CHECK (estado_emocional IN ('CURIOUS','INTERESTED','WARY','EXCITED','CONVINCED')),
  sins             TEXT NOT NULL DEFAULT '[]',
  interesse        TEXT,
  proxima_acao     TEXT NOT NULL CHECK (proxima_acao IN ('SEND_CATALOG','SEND_SAMPLE','WAIT_STOCK','CALL_BACK','REMINDER','SCHEDULE_TALK','CLOSE_NO_INTEREST')),
  retorno_em       TEXT,
  segundos         INTEGER,
  criado_em        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS bre_registros_contato_idx ON bre_registros (contato_id, criado_em);
CREATE INDEX IF NOT EXISTS bre_registros_autor_idx ON bre_registros (autor_id, criado_em);

-- Break (Regra de Ouro): categoria + motivo da MESMA categoria + comentário. Só inserção.
CREATE TABLE IF NOT EXISTS bre_breaks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contato_id  INTEGER NOT NULL REFERENCES crm_contatos(id),
  registro_id INTEGER REFERENCES bre_registros(id),
  negocio_id  INTEGER REFERENCES crm_negocios(id),
  categoria   TEXT NOT NULL,
  motivo_id   INTEGER NOT NULL REFERENCES bre_motivos_break(id),
  comentario  TEXT NOT NULL CHECK (length(comentario) BETWEEN 3 AND 1000),
  marco       TEXT,
  acao_padrao TEXT NOT NULL,
  autor_id    INTEGER NOT NULL REFERENCES users(id),
  criado_em   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS bre_breaks_contato_idx ON bre_breaks (contato_id, criado_em);

CREATE TABLE IF NOT EXISTS bre_reentradas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  contato_id    INTEGER NOT NULL REFERENCES crm_contatos(id),
  tipo          TEXT NOT NULL CHECK (tipo IN ('TIME','EVENT','PROFILE','BEHAVIOR','RELATIONSHIP')),
  prevista_para TEXT,                                  -- data local AAAA-MM-DD
  condicao      TEXT,
  motivo        TEXT NOT NULL CHECK (length(motivo) BETWEEN 1 AND 300),
  break_id      INTEGER REFERENCES bre_breaks(id),
  status        TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','feita','cancelada')),
  criado_por    INTEGER REFERENCES users(id),
  criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
  concluida_em  TEXT,
  CHECK (prevista_para IS NOT NULL OR condicao IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS bre_reentradas_pendentes_idx ON bre_reentradas (status, prevista_para);

-- SQ-BRE: prévia da IA + nota confirmada pelo gestor. Uma avaliação em aberto por conversa.
CREATE TABLE IF NOT EXISTS bre_sq (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversa_id      INTEGER NOT NULL REFERENCES wa_conversas(id),
  avaliado_id      INTEGER NOT NULL REFERENCES users(id),
  criado_por       INTEGER NOT NULL REFERENCES users(id),
  analise_id       INTEGER REFERENCES bre_analises(id),
  previa           TEXT,                               -- JSON {H,D,I,V,P}
  nota_previa      INTEGER,
  confirmada       TEXT,
  nota             INTEGER CHECK (nota IS NULL OR nota BETWEEN 0 AND 100),
  feedback         TEXT,
  confirmada_por   INTEGER REFERENCES users(id),
  confirmada_em    TEXT,
  monitoramento_id INTEGER REFERENCES registros_monitoramento(id),
  criado_em        TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((confirmada IS NULL) = (nota IS NULL) AND (nota IS NULL) = (confirmada_em IS NULL)),
  CHECK (avaliado_id <> confirmada_por)
);
CREATE UNIQUE INDEX IF NOT EXISTS bre_sq_aberta_uk ON bre_sq (conversa_id) WHERE confirmada_em IS NULL;

CREATE TABLE IF NOT EXISTS bre_escalonamentos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  contato_id   INTEGER NOT NULL REFERENCES crm_contatos(id),
  conversa_id  INTEGER REFERENCES wa_conversas(id),
  situacao     TEXT NOT NULL CHECK (situacao IN ('READY_TO_BUY','TECHNICAL_HELP','VIP','COMPLAINT')),
  origem       TEXT NOT NULL CHECK (origem IN ('ia','manual')),
  observacao   TEXT,
  status       TEXT NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','resolvido')),
  criado_por   INTEGER REFERENCES users(id),
  criado_em    TEXT NOT NULL DEFAULT (datetime('now')),
  resolvido_por INTEGER REFERENCES users(id),
  resolvido_em TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS bre_escalonamentos_aberto_uk ON bre_escalonamentos (contato_id, situacao) WHERE status = 'aberto';

-- Movimento entre etapas (fonte do pilar Pipeline do BPI), gravado no mesmo ponto que move o card.
CREATE TABLE IF NOT EXISTS bre_movimentos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  negocio_id    INTEGER NOT NULL REFERENCES crm_negocios(id),
  de_etapa_id   INTEGER REFERENCES crm_etapas(id),
  para_etapa_id INTEGER REFERENCES crm_etapas(id),
  de_marco      TEXT,
  para_marco    TEXT,
  permitido     INTEGER NOT NULL DEFAULT 1,            -- 0 = fora da doutrina (modo observação registra e avisa)
  vendedor_id   INTEGER REFERENCES users(id),
  criado_em     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS bre_movimentos_vendedor_idx ON bre_movimentos (vendedor_id, criado_em);

CREATE TABLE IF NOT EXISTS bre_coaching (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER NOT NULL REFERENCES users(id),
  pilar      TEXT NOT NULL,
  semana     TEXT NOT NULL,                            -- segunda-feira da semana, AAAA-MM-DD
  notas      TEXT NOT NULL,                            -- JSON das duas semanas
  criado_em  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (usuario_id, pilar, semana)
);

-- Cache do BPI (sempre recalculável das fontes). "-infinity" não existe no SQLite: velho = calculado_em NULL.
CREATE TABLE IF NOT EXISTS bre_bpi (
  mes          TEXT NOT NULL,                          -- AAAA-MM
  usuario_id   INTEGER NOT NULL REFERENCES users(id),
  posicao      INTEGER NOT NULL,
  pilares      TEXT NOT NULL,
  bpi          REAL,
  calculado_em TEXT,
  PRIMARY KEY (mes, usuario_id)
);

CREATE TABLE IF NOT EXISTS bre_automacoes (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo               TEXT NOT NULL CHECK (tipo IN ('POS_VENDA','REENTRADA')),
  nome               TEXT NOT NULL CHECK (length(nome) BETWEEN 1 AND 80),
  conta_id           INTEGER NOT NULL REFERENCES wa_contas(id),
  texto              TEXT NOT NULL CHECK (length(texto) BETWEEN 1 AND 1000),
  template_nome      TEXT,                             -- modelo aprovado na Meta (fora da janela de 24 h)
  template_idioma    TEXT NOT NULL DEFAULT 'pt_BR',
  template_parametros TEXT NOT NULL DEFAULT '[]',      -- ordem de {{1}}, {{2}}…: nome, consultor, plano
  dias               INTEGER CHECK (dias IS NULL OR dias BETWEEN 1 AND 365),
  ativa              INTEGER NOT NULL DEFAULT 0 CHECK (ativa IN (0,1)),
  criado_por         INTEGER REFERENCES users(id),
  criado_em          TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at         TEXT,
  CHECK (tipo <> 'POS_VENDA' OR dias IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS bre_automacao_execucoes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  automacao_id INTEGER NOT NULL REFERENCES bre_automacoes(id),
  contato_id   INTEGER NOT NULL REFERENCES crm_contatos(id),
  referencia   TEXT NOT NULL,                          -- a venda, a reentrada…: rodar de novo nunca repete
  status       TEXT NOT NULL CHECK (status IN ('enviada','ignorada')),
  detalhe      TEXT,
  mensagem_id  INTEGER REFERENCES wa_mensagens(id),
  criado_em    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (automacao_id, contato_id, referencia)
);

-- Só inserção: prova do que a equipe registrou e do que a IA sugeriu.
CREATE TRIGGER IF NOT EXISTS bre_registros_imutavel BEFORE UPDATE ON bre_registros
BEGIN SELECT RAISE(ABORT, 'Registro BRE não pode ser alterado: registre de novo.'); END;
CREATE TRIGGER IF NOT EXISTS bre_registros_sem_apagar BEFORE DELETE ON bre_registros
BEGIN SELECT RAISE(ABORT, 'Registro BRE não pode ser apagado.'); END;
CREATE TRIGGER IF NOT EXISTS bre_breaks_imutavel BEFORE UPDATE ON bre_breaks
BEGIN SELECT RAISE(ABORT, 'Break não pode ser alterado.'); END;
CREATE TRIGGER IF NOT EXISTS bre_breaks_sem_apagar BEFORE DELETE ON bre_breaks
BEGIN SELECT RAISE(ABORT, 'Break não pode ser apagado.'); END;
````

## Apêndice F — `db/migracoes/002_bre.js` (Colunas novas, marcos e permissões)

````js
// Motor BRE: colunas novas em tabelas que já existem, marco das etapas padrão e permissões.
// Roda uma vez (tabela migracoes), dentro de transação. As tabelas novas ficam em db/bre.sql (idempotente).
"use strict";

const PERMISSOES_BRE = [
  ["bre.usar", "Motor BRE: registrar conversas, ver a fila do dia e as reentradas da própria carteira", ["gestor", "vendedor"]],
  ["bre.ver.todos", "Motor BRE: ver registros, escalonamentos e desempenho de toda a equipe", ["gestor"]],
  ["bre.gerenciar", "Motor BRE: limites, motivos de Break, marcos das etapas e automações", ["gestor"]],
  ["bre.avaliar", "Motor BRE: confirmar a nota SQ-BRE das conversas da equipe", ["gestor"]],
];

// Etapas padrão do Lumen → marco da doutrina. Etapa criada depois fica sem marco até o gestor escolher.
const MARCOS_DAS_ETAPAS = {
  "Novo lead": "LEAD_IDENTIFIED",
  "Primeiro contato": "LEAD_IDENTIFIED",
  "Diagnóstico": "DIAGNOSIS",
  "Aula experimental": "INTEREST",
  "Proposta enviada": "PROPOSAL",
  "Negociação": "NEGOTIATION",
};

exports.aplicar = (db, { adicionarColuna }) => {
  adicionarColuna(db, "crm_contatos", "estado_bre", "TEXT CHECK (estado_bre IN ('RECENT','ACTIVE','ABOUT_TO_SLEEP','INACTIVE'))");
  adicionarColuna(db, "crm_contatos", "estado_bre_em", "TEXT");
  adicionarColuna(db, "crm_contatos", "compras_qtd", "INTEGER NOT NULL DEFAULT 0");
  adicionarColuna(db, "crm_contatos", "ultima_compra_em", "TEXT");
  adicionarColuna(db, "crm_contatos", "nao_contatar", "INTEGER NOT NULL DEFAULT 0");
  adicionarColuna(db, "crm_etapas", "marco_bre", "TEXT");
  adicionarColuna(db, "crm_negocios", "encerramento_bre", "TEXT"); // JSON: critério, temperatura, checklist, quem, quando
  adicionarColuna(db, "crm_atividades", "origem_bre", "TEXT");     // retorno | pos_venda | reentrada

  // Quem já está na lista "não ligar" da fila também não é contatado pelo motor.
  db.exec(`UPDATE crm_contatos SET nao_contatar = 1
           WHERE telefone IS NOT NULL AND telefone IN (SELECT telefone FROM fila_nao_ligar)`);

  const marcar = db.prepare("UPDATE crm_etapas SET marco_bre = ? WHERE nome = ? AND marco_bre IS NULL");
  for (const [nome, marco] of Object.entries(MARCOS_DAS_ETAPAS)) marcar.run(marco, nome);

  db.exec("CREATE INDEX IF NOT EXISTS idx_crm_contatos_estado_bre ON crm_contatos (estado_bre) WHERE deleted_at IS NULL");
  db.exec("CREATE INDEX IF NOT EXISTS idx_crm_ativ_origem_bre ON crm_atividades (origem_bre, vence_em) WHERE origem_bre IS NOT NULL");

  for (const [nome, desc, papeis] of PERMISSOES_BRE) {
    db.prepare("INSERT OR IGNORE INTO permissions (name, description) VALUES (?, ?)").run(nome, desc);
    const perm = db.prepare("SELECT id FROM permissions WHERE name = ?").get(nome);
    for (const papel of papeis) {
      const role = db.prepare("SELECT id FROM roles WHERE name = ?").get(papel);
      if (role) db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)").run(role.id, perm.id);
    }
  }
};
exports.PERMISSOES_BRE = PERMISSOES_BRE;
````

## Apêndice G — `test/ajuda-banco.js` (Banco de teste)

````js
// Banco de teste: as tabelas do Lumen que o BRE usa (forma resumida das reais), o db/bre.sql e a migração 002.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

function adicionarColuna(db, tabela, coluna, definicao) {
  if (!db.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name = ?").get(tabela, coluna)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
}

function bancoBre() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
    CREATE TABLE permissions (id INTEGER PRIMARY KEY, name TEXT UNIQUE, description TEXT);
    CREATE TABLE role_permissions (role_id INTEGER, permission_id INTEGER, PRIMARY KEY (role_id, permission_id));
    CREATE TABLE crm_contatos (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, telefone TEXT, vendedor_id INTEGER REFERENCES users(id), deleted_at TEXT);
    CREATE TABLE crm_etapas (id INTEGER PRIMARY KEY, nome TEXT, ordem INTEGER, ativo INTEGER DEFAULT 1);
    CREATE TABLE vendas (id INTEGER PRIMARY KEY, vendedor_id INTEGER, data_venda TEXT NOT NULL, valor_pago REAL DEFAULT 0);
    CREATE TABLE crm_negocios (id INTEGER PRIMARY KEY, contato_id INTEGER NOT NULL REFERENCES crm_contatos(id), etapa_id INTEGER REFERENCES crm_etapas(id),
      status TEXT NOT NULL DEFAULT 'aberto', vendedor_id INTEGER, temperatura TEXT DEFAULT 'morno', venda_id INTEGER REFERENCES vendas(id),
      fechado_em TEXT, atualizado_em TEXT, deleted_at TEXT);
    CREATE TABLE crm_atividades (id INTEGER PRIMARY KEY, negocio_id INTEGER, contato_id INTEGER, vendedor_id INTEGER NOT NULL, tipo TEXT NOT NULL DEFAULT 'tarefa',
      titulo TEXT NOT NULL, vence_em TEXT NOT NULL, concluida_em TEXT, criado_por INTEGER, deleted_at TEXT);
    CREATE TABLE fila_nao_ligar (telefone TEXT PRIMARY KEY);
    CREATE TABLE wa_contas (id INTEGER PRIMARY KEY);
    CREATE TABLE wa_conversas (id INTEGER PRIMARY KEY);
    CREATE TABLE wa_mensagens (id INTEGER PRIMARY KEY);
    CREATE TABLE registros_monitoramento (id INTEGER PRIMARY KEY);
    INSERT INTO roles (name) VALUES ('gestor'), ('vendedor'), ('professor');
    INSERT INTO users VALUES (1, 'Gestora'), (2, 'Consultor');
    INSERT INTO crm_contatos (id, nome, telefone, vendedor_id) VALUES (1, 'Ana Souza', '5511988887777', 2);
    INSERT INTO crm_etapas (id, nome, ordem) VALUES (1, 'Novo lead', 1), (2, 'Diagnóstico', 2), (3, 'Aula experimental', 3);`);
  const sql = fs.readFileSync(path.join(__dirname, "../db/bre.sql"), "utf8");
  db.exec(sql);
  db.exec(sql); // idempotente
  db.transaction(() => require("../db/migracoes/002_bre").aplicar(db, { adicionarColuna }))();
  return db;
}
module.exports = { bancoBre };
````

## Apêndice H1 — `test/bre/regras.test.js` (Testes das regras)

````js
// Critérios de aceite das regras puras do motor BRE. Rodar: node --test test/
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const r = require("../../lib/bre/regras");

const H = 3_600_000;
const D = 24 * H;
const AGORA = Date.UTC(2026, 9, 22, 15, 0, 0);

test("AT-013 estado do cliente: 1 compra há 50 dias = prestes a dormir; 2 compras, última há 50 = ativo", () => {
  assert.equal(r.estadoCliente(1, 50), "ABOUT_TO_SLEEP");
  assert.equal(r.estadoCliente(2, 50), "ACTIVE");
  assert.equal(r.estadoCliente(1, 10), "RECENT");
  assert.equal(r.estadoCliente(3, 121), "INACTIVE");
  assert.equal(r.estadoCliente(0, null), null);
});

test("AT-015 transições: Lead → Venda recusado; Lead → Diagnóstico aceito; sem marco não opina", () => {
  assert.equal(r.transicaoPermitida("LEAD_IDENTIFIED", "SALE"), false);
  assert.equal(r.transicaoPermitida("LEAD_IDENTIFIED", "DIAGNOSIS"), true);
  assert.equal(r.transicaoPermitida("PROPOSAL", "PROPOSAL"), true);
  assert.equal(r.transicaoPermitida(null, "SALE"), true);
});

test("AT-017 Break: categoria Financeiro gera reentrada na próxima campanha; comentário curto é recusado", () => {
  assert.deepEqual(r.acaoPadraoBreak("C_FINANCIAL").reentrada, { tipo: "EVENT", dias: null, condicao: "Próxima campanha" });
  const base = { contatoId: 1, resultado: "REPLIED_NO_ADVANCE", temperatura: "WARM", proximaAcao: "CALL_BACK", retornoEm: "2026-11-01" };
  assert.equal(r.validarRegistro({ ...base, break: { categoria: "C_FINANCIAL", motivoId: 3, comentario: "ok" } }).campo, "break.comentario");
  assert.equal(r.validarRegistro({ ...base, break: { categoria: "C_FINANCIAL", motivoId: 3, comentario: "Achou caro agora" } }).ok, true);
});

test("registro: retorno obrigatório, exceto encerrar ou pedir para sair", () => {
  const base = { contatoId: 1, resultado: "ADVANCED", temperatura: "HOT", proximaAcao: "CALL_BACK" };
  assert.equal(r.validarRegistro(base).campo, "retornoEm");
  assert.equal(r.validarRegistro({ ...base, resultado: "OPTED_OUT" }).ok, true);
  assert.equal(r.validarRegistro({ ...base, proximaAcao: "CLOSE_NO_INTEREST" }).ok, true);
  assert.equal(r.validarRegistro({ ...base, retornoEm: "2026-13-40" }).campo, "retornoEm");
  assert.equal(r.validarRegistro({ ...base, retornoEm: "2026-11-01", sins: ["CONFIRMATION", "CONFIRMATION"] }).campo, "sins");
});

test("AT-020/021/022 bloqueios: não contatar, recente < 48 h, 48 h entre tentativas, 15 dias entre ciclos (data combinada libera)", () => {
  assert.match(r.bloqueioDeTentativa({ naoContatar: true }, AGORA), /não ser contatado/);
  assert.match(r.bloqueioDeTentativa({ estado: "RECENT", ultimaCompraEm: AGORA - 10 * H }, AGORA), /48 h/);
  assert.equal(r.bloqueioDeTentativa({ estado: "RECENT", ultimaCompraEm: AGORA - 50 * H }, AGORA), null);
  assert.match(r.bloqueioDeTentativa({ cicloAberto: { ultimaTentativaEm: AGORA - 20 * H } }, AGORA), /menos de 48 h/);
  assert.match(r.bloqueioDeTentativa({ ultimoCicloSemRespostaEm: AGORA - 5 * D }, AGORA), /15 dias/);
  assert.equal(r.bloqueioDeTentativa({ ultimoCicloSemRespostaEm: AGORA - 5 * D, temDataCombinadaHoje: true }, AGORA), null);
});

test("AT-016 encerramento com checklist incompleto lista o que falta", () => {
  const v = r.validarEncerramento({ criterio: "MAX_ATTEMPTS", temperatura: "COLD", checklist: { motivoCompreendido: true } });
  assert.equal(v.ok, false);
  assert.ok(v.faltando.includes("CRM atualizado"));
  const tudo = Object.fromEntries(r.CHECKLIST_ENCERRAMENTO.map((i) => [i.codigo, true]));
  assert.deepEqual(r.validarEncerramento({ criterio: "CUSTOMER_REQUESTED", temperatura: "COLD", checklist: tudo }), { ok: true, ligaNaoContatar: true });
});

test("AT-024 IA: desconto para recente e sem diagnóstico é descartado; oferta sem três sim também", () => {
  const saida = { sugereDesconto: true, sugereOferta: true, sins: ["CONFIRMATION"] };
  const a = r.filtrarSugestao(saida, { estado: "RECENT", temDiagnostico: true });
  assert.equal(a.sugestao.sugereDesconto, false);
  assert.equal(a.sugestao.sugereOferta, false);
  assert.equal(a.bloqueios.length, 2);
  const b = r.filtrarSugestao({ ...saida, sins: ["CONFIRMATION", "AGREEMENT", "VISUALIZATION"] }, { estado: "ACTIVE", temDiagnostico: true });
  assert.equal(b.sugestao.sugereDesconto, true);
  assert.equal(b.sugestao.sugereOferta, true);
});

test("AT-018 saída da IA com código fora das listas é recusada", () => {
  const ok = {
    resumo: "x", resultado: "ADVANCED", temperatura: "HOT", estadoEmocional: null, sins: [], break: null, proximaAcao: "CALL_BACK",
    retornoEmDias: 3, sugereOferta: false, sugereDesconto: false, escalonamento: null, sqBre: { H: 10, D: 10, I: 10, V: 10, P: 20 }, incertezas: [],
  };
  assert.deepEqual(r.validarSaidaIa(ok), []);
  assert.deepEqual(r.validarSaidaIa({ ...ok, temperatura: "MORNA" }), ["temperatura"]);
  assert.deepEqual(r.validarSaidaIa({ ...ok, sqBre: { ...ok.sqBre, P: 25 } }), ["sqBre"]);
});

test("AT-025 BPI: pilar sem dados fica fora e os pesos se redistribuem", () => {
  assert.equal(r.calcularBpi({ receita: 50, pipeline: 50, inteligencia: 81.25, qualidade: null, relacionamento: 50 }), 57.8);
  assert.equal(r.calcularBpi({ receita: null, pipeline: null, inteligencia: null, qualidade: null, relacionamento: null }), null);
  assert.equal(r.faixaBpi(57.8), "Plano de desenvolvimento");
  assert.equal(r.faixaSq(r.somaSq({ H: 20, D: 18, I: 15, V: 17, P: 20 })), "Muito bom");
  assert.equal(r.contraMeta(15000, 10000), 100);
});

test("config: limite impossível é recusado com mensagem clara", () => {
  assert.equal(r.validarConfig(r.CONFIG_PADRAO, { recenteAte: 200 }).ok, false);
  assert.equal(r.validarConfig(r.CONFIG_PADRAO, { tentativasPorCiclo: 0 }).erro, "tentativasPorCiclo: use um número inteiro de 1 a 10.");
  assert.deepEqual(r.validarConfig(r.CONFIG_PADRAO, { diasPosVenda: [10, 2, 2] }).config.diasPosVenda, [2, 10]);
});

test("LGPD: mascaramento tira nome, telefone, e-mail, CPF e endereço", () => {
  const t = r.mascararDadosPessoais("Oi Ana Souza, meu zap é (11) 98765-4321, email ana@x.com, CPF 123.456.789-09, moro na Rua das Flores, 120", ["Ana Souza"]);
  assert.equal(t, "Oi [nome] [nome], meu zap é [telefone], email [e-mail], CPF [CPF], moro na [endereço]");
});
````

## Apêndice H2 — `test/bre/ia.test.js` (Testes da IA)

````js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const r = require("../../lib/bre/regras");
const ia = require("../../lib/bre/ia");

test("sem chave usa a demonstração, e a saída passa na validação das listas", async () => {
  const p = ia.criarProvedorIa({});
  assert.equal(p.nome, "demonstracao");
  const { saida } = await p.analisar([{ de: "atendente", texto: "Oi! Quer agendar uma aula experimental?" }, { de: "cliente", texto: "Achei caro, tem desconto?" }]);
  assert.deepEqual(r.validarSaidaIa(saida), []);
  assert.equal(saida.break.categoria, "C_FINANCIAL");
});

test("o esquema JSON exige todos os campos e só os códigos das listas", () => {
  assert.equal(ia.ESQUEMA.additionalProperties, false);
  assert.deepEqual(ia.ESQUEMA.required.sort(), Object.keys(ia.ESQUEMA.properties).sort());
  assert.deepEqual(ia.ESQUEMA.properties.temperatura.enum, ["COLD", "WARM", "HOT", "READY_TO_BUY"]);
});
````

## Apêndice H3 — `test/bre/banco.test.js` (Testes do esquema e do agendador)

````js
// O esquema db/bre.sql e a migração 002 rodam num SQLite novo e as travas do banco funcionam.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { rotinaDevida, criarAgendador } = require("../../lib/agendador");

const { bancoBre: banco } = require("../ajuda-banco");

test("esquema roda duas vezes; um ciclo aberto por aluno; registro é só inserção", () => {
  const db = banco();
  db.prepare("INSERT INTO bre_ciclos (contato_id) VALUES (1)").run();
  assert.throws(() => db.prepare("INSERT INTO bre_ciclos (contato_id) VALUES (1)").run(), /UNIQUE/);
  db.prepare("UPDATE bre_ciclos SET encerrado_em = datetime('now'), motivo_encerramento = 'MAX_ATTEMPTS'").run();
  db.prepare("INSERT INTO bre_ciclos (contato_id) VALUES (1)").run();
  const { lastInsertRowid } = db.prepare("INSERT INTO bre_registros (contato_id, autor_id, resultado, temperatura, proxima_acao) VALUES (1, 2, 'NO_REPLY', 'COLD', 'CALL_BACK')").run();
  assert.throws(() => db.prepare("UPDATE bre_registros SET temperatura = 'HOT' WHERE id = ?").run(lastInsertRowid), /não pode ser alterado/);
  assert.throws(() => db.prepare("DELETE FROM bre_registros").run(), /não pode ser apagado/);
  assert.throws(() => db.prepare("INSERT INTO bre_registros (contato_id, autor_id, resultado, temperatura, proxima_acao) VALUES (1, 2, 'TALVEZ', 'COLD', 'CALL_BACK')").run(), /CHECK/);
});

test("escalonamento: um aberto por aluno × situação; SQ-BRE: ninguém confirma a própria nota", () => {
  const db = banco();
  db.prepare("INSERT INTO bre_escalonamentos (contato_id, situacao, origem) VALUES (1, 'COMPLAINT', 'ia')").run();
  assert.throws(() => db.prepare("INSERT INTO bre_escalonamentos (contato_id, situacao, origem) VALUES (1, 'COMPLAINT', 'manual')").run(), /UNIQUE/);
  db.exec("INSERT INTO wa_conversas VALUES (10)");
  assert.throws(
    () => db.prepare("INSERT INTO bre_sq (conversa_id, avaliado_id, criado_por, confirmada, nota, confirmada_por, confirmada_em) VALUES (10, 2, 1, '{}', 80, 2, datetime('now'))").run(),
    /CHECK/,
  );
});

test("agendador: diária às 03:07 roda uma vez por dia, mesmo se o servidor voltou atrasado", () => {
  const diaria = { tipo: "diaria", hora: "03:07" };
  assert.equal(rotinaDevida(diaria, "2026-10-22 03:06", null), false);
  assert.equal(rotinaDevida(diaria, "2026-10-22 03:07", null), true);
  assert.equal(rotinaDevida(diaria, "2026-10-22 09:40", "2026-10-21 03:07"), true); // atrasada: roda ao voltar
  assert.equal(rotinaDevida(diaria, "2026-10-22 09:41", "2026-10-22 09:40"), false); // já rodou hoje
  const horaria = { tipo: "horaria", minuto: 11 };
  assert.equal(rotinaDevida(horaria, "2026-10-22 14:11", "2026-10-22 13:11"), true);
  assert.equal(rotinaDevida(horaria, "2026-10-22 14:30", "2026-10-22 14:11"), false);
  assert.equal(rotinaDevida({ tipo: "intervalo", minutos: 1 }, "2026-10-22 14:31", "2026-10-22 14:30"), true);
});

test("agendador: erro fica registrado (nada falha em silêncio) e não repete no mesmo horário", async () => {
  const db = banco();
  let hora = "2026-10-22 03:07:00";
  let execucoes = 0;
  const ag = criarAgendador({ db, horaLocal: () => hora, log: { error() {} } });
  ag.registrar("estado_cliente", { tipo: "diaria", hora: "03:07" }, async () => {
    execucoes++;
    throw new Error("banco ocupado");
  });
  await ag.tique();
  await ag.tique();
  assert.equal(execucoes, 1);
  assert.match(ag.situacao()[0].ultimo_erro, /banco ocupado/);
  hora = "2026-10-23 03:08:00";
  await ag.tique();
  assert.equal(execucoes, 2);
});
````

## Apêndice H4 — `test/bre/motor.test.js` (Testes do motor)

````js
// Motor BRE contra um SQLite real: ciclo, bloqueios, Break, pós-venda, "não contatar", silêncio e estado.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { bancoBre } = require("../ajuda-banco");
const M = require("../../lib/bre/motor");

const DIA = 86_400_000;
function contexto(db, inicio = "2026-10-22T13:00:00Z") {
  const relogio = { agora: Date.parse(inicio) };
  const avisos = [];
  const ctx = {
    db,
    agora: () => relogio.agora,
    hoje: () => new Date(relogio.agora - 3 * 3_600_000).toISOString().slice(0, 10), // America/Sao_Paulo
    efeitos: { timeline() {}, avisar: (para, evento, dados) => avisos.push({ para, evento, dados }) },
  };
  return { ctx, relogio, avisos };
}
const semResposta = { contatoId: 1, resultado: "NO_REPLY", temperatura: "COLD", proximaAcao: "CALL_BACK", retornoEm: "2026-10-24" };

test("migração 002: marcos das etapas padrão e permissões do BRE para gestor e vendedor", () => {
  const db = bancoBre();
  assert.equal(db.prepare("SELECT marco_bre FROM crm_etapas WHERE nome = 'Aula experimental'").get().marco_bre, "INTEREST");
  const doVendedor = db.prepare(`SELECT p.name FROM permissions p JOIN role_permissions rp ON rp.permission_id = p.id
    JOIN roles r ON r.id = rp.role_id WHERE r.name = 'vendedor' ORDER BY p.name`).all().map((l) => l.name);
  assert.deepEqual(doVendedor, ["bre.usar"]);
});

test("AT-013/014: três tentativas sem resposta fecham o ciclo e programam reentrada em 15 dias; intervalo de 48 h é respeitado", () => {
  const db = bancoBre();
  const { ctx, relogio } = contexto(db);
  M.registrarConversa(ctx, { id: 2 }, semResposta);
  assert.throws(() => M.registrarConversa(ctx, { id: 2 }, semResposta), (e) => e.status === 409 && /48 h/.test(e.message));
  relogio.agora += 2 * DIA;
  M.registrarConversa(ctx, { id: 2 }, semResposta);
  relogio.agora += 2 * DIA;
  M.registrarConversa(ctx, { id: 2 }, semResposta);
  const ciclo = db.prepare("SELECT * FROM bre_ciclos").get();
  assert.equal(ciclo.motivo_encerramento, "MAX_ATTEMPTS");
  assert.equal(ciclo.sem_resposta, 1);
  const r = db.prepare("SELECT tipo, prevista_para FROM bre_reentradas").get();
  assert.deepEqual(r, { tipo: "TIME", prevista_para: "2026-11-10" }); // 26/10 + 15 dias
  relogio.agora += 2 * DIA; // dentro dos 15 dias, sem data combinada: bloqueia novo ciclo
  assert.throws(() => M.registrarConversa(ctx, { id: 2 }, semResposta), /15 dias/);
  // Resposta do aluno nunca é bloqueada.
  M.registrarConversa(ctx, { id: 2 }, { ...semResposta, resultado: "REPLIED_NO_ADVANCE", temperatura: "WARM" });
});

test("Break: motivo tem de ser da categoria; A_TIME programa reentrada em 30 dias e gera a tarefa de retorno", () => {
  const db = bancoBre();
  const { ctx } = contexto(db);
  const ms = M.motivos(db);
  const deTempo = ms.find((m) => m.categoria === "A_TIME");
  const financeiro = ms.find((m) => m.categoria === "C_FINANCIAL");
  const base = { contatoId: 1, resultado: "REPLIED_NO_ADVANCE", temperatura: "WARM", proximaAcao: "CALL_BACK", retornoEm: "2026-11-05" };
  assert.throws(
    () => M.registrarConversa(ctx, { id: 2 }, { ...base, break: { categoria: "A_TIME", motivoId: financeiro.id, comentario: "Vai viajar" } }),
    (e) => e.campo === "break.motivoId",
  );
  M.registrarConversa(ctx, { id: 2 }, { ...base, break: { categoria: "A_TIME", motivoId: deTempo.id, comentario: "Volta de viagem em novembro" } });
  assert.equal(db.prepare("SELECT prevista_para FROM bre_reentradas").get().prevista_para, "2026-11-21");
  assert.equal(db.prepare("SELECT titulo, vence_em, origem_bre FROM crm_atividades").get().origem_bre, "retorno");
  assert.equal(M.motivos(db).length, ms.length); // semeia uma vez só
});

test("PURCHASED fecha o ciclo e cria o pós-venda D+2…D+30 para o dono da carteira; OPTED_OUT liga 'não contatar'", () => {
  const db = bancoBre();
  const { ctx } = contexto(db);
  M.registrarConversa(ctx, { id: 1 }, { contatoId: 1, resultado: "PURCHASED", temperatura: "READY_TO_BUY", proximaAcao: "REMINDER", retornoEm: "2026-10-24" });
  const pos = db.prepare("SELECT vendedor_id, vence_em FROM crm_atividades WHERE origem_bre = 'pos_venda' ORDER BY vence_em").all();
  assert.equal(pos.length, 5);
  assert.ok(pos.every((p) => p.vendedor_id === 2));
  assert.equal(pos[0].vence_em, "2026-10-24T09:00");
  M.registrarConversa(ctx, { id: 2 }, { contatoId: 1, resultado: "OPTED_OUT", temperatura: "COLD", proximaAcao: "CLOSE_NO_INTEREST" });
  assert.equal(db.prepare("SELECT nao_contatar FROM crm_contatos WHERE id = 1").get().nao_contatar, 1);
  assert.throws(() => M.registrarConversa(ctx, { id: 2 }, semResposta), /pediu para não ser contatado/);
});

test("escalonamento manual avisa uma vez só (pedir de novo não duplica)", () => {
  const db = bancoBre();
  const { ctx, avisos } = contexto(db);
  const reg = { contatoId: 1, resultado: "ADVANCED", temperatura: "HOT", proximaAcao: "SCHEDULE_TALK", retornoEm: "2026-10-23", escalonamento: "COMPLAINT" };
  M.registrarConversa(ctx, { id: 2 }, reg);
  M.registrarConversa(ctx, { id: 2 }, reg);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM bre_escalonamentos").get().n, 1);
  assert.equal(avisos.filter((a) => a.evento === "bre.escalonamento").length, 1);
});

test("rotinas: silêncio de 7 dias fecha o ciclo; estado do aluno vem do negócio ganho e só grava o que mudou", () => {
  const db = bancoBre();
  const { ctx, relogio } = contexto(db);
  M.registrarConversa(ctx, { id: 2 }, semResposta);
  relogio.agora += 8 * DIA;
  assert.equal(M.rotinaSilencio(ctx), 1);
  assert.equal(db.prepare("SELECT motivo_encerramento FROM bre_ciclos").get().motivo_encerramento, "SILENCE");
  assert.equal(M.rotinaSilencio(ctx), 0);

  db.exec(`INSERT INTO vendas (id, vendedor_id, data_venda) VALUES (1, 2, '2026-10-20');
           INSERT INTO crm_negocios (contato_id, etapa_id, status, venda_id) VALUES (1, 3, 'ganho', 1)`);
  assert.equal(M.rotinaEstadoCliente(ctx), 1);
  assert.equal(db.prepare("SELECT estado_bre FROM crm_contatos WHERE id = 1").get().estado_bre, "RECENT");
  assert.equal(M.rotinaEstadoCliente(ctx), 0);
});
````
