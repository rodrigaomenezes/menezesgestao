# Motor BRE — Análise para desenvolvimento

Documento técnico para quem vai implementar ou portar o motor BRE. A fonte funcional é a ETR BRE-ETR-001 v0.2
(doutrina BRE v1.0); a implementação de referência está no menezesgestao (PR #22, ADR-032). Tudo abaixo descreve o
que já roda e foi testado, e marca o que ainda falta.

## 1. O que é

Um conjunto de regras comerciais que acompanha cada cliente e cada conversa:

1. Classifica o cliente todo dia (Recente, Ativo, Prestes a dormir, Inativo).
2. Monta a fila do dia só com quem pode ser contatado hoje (respeitando tentativas, silêncio e "não contatar").
3. Registra cada conversa em 30 segundos (8 campos), com Break quando houve quebra.
4. Programa reentradas, retornos e pós-venda sozinho.
5. Controla o funil pelas transições da doutrina.
6. Com IA: lê a conversa e pré-preenche o registro; o motor filtra o que as regras proíbem; a pessoa confirma.
7. Chama uma pessoa quando a conversa pede (escalonamento) e para as automações daquele cliente.
8. Mede a qualidade de cada atendimento (SQ-BRE) e o desempenho de cada pessoa no mês (BPI), com alerta de coaching.

Princípio central: **a IA sugere, o motor decide, a pessoa confirma.** Nenhuma regra vive só no prompt.

## 2. Arquitetura

```
Tela (React)  ──►  API /api/bre/*  ──►  Serviço do motor (regras)  ──►  PostgreSQL (RLS por empresa)
                                         │
                                         ├─► Provedor de IA (interface): Claude | Demonstração
                                         └─► Fila de jobs (pg-boss): estado diário, silêncio horário
```

| Peça | Arquivo | Papel |
| --- | --- | --- |
| Contrato | `packages/shared/src/dto-bre.ts` | Listas fechadas, limites padrão, regras puras, DTOs e validação (Zod) |
| Migrações | `database/migrations/0011_bre.sql`, `0012_bre_ia.sql`, `0013_bre_desempenho.sql` | Tabelas, CHECK das listas, RLS |
| Serviço | `apps/api/src/modulos/bre/bre.servico.ts` | Regras do motor, IA e escalonamento |
| Desempenho | `apps/api/src/modulos/bre/desempenho.servico.ts` | SQ-BRE, BPI, ranking e coaching |
| Rotas | `apps/api/src/modulos/bre/bre.rotas.ts` | API com permissão por rota |
| IA | `apps/api/src/modulos/bre/ia.ts` | Interface + Claude + demonstração |
| Funil | `apps/api/src/modulos/crm/oportunidades.servico.ts` | Bloqueio de transição pelo marco |
| Telas | `apps/web/src/features/bre/Bre.tsx`, `features/qualidade/SqBre.tsx` | Fila do dia, registro, escalonamentos, reentradas, BPI, limites; SQ-BRE |
| Testes | `packages/shared/src/dto-bre.test.ts`, `tests/integration/bre*.test.ts`, `tests/e2e/bre.spec.ts` | Critérios de aceite |

Requisitos de plataforma: multiempresa (toda tabela com `empresa_id` + RLS), fila de jobs (nada de `setInterval`),
auditoria + evento em toda ação, listas paginadas, segredos só em variável de ambiente.

## 3. Listas fechadas (códigos estáveis)

Os códigos nunca mudam; os nomes na tela passam pelo vocabulário da empresa.

| Lista | Códigos |
| --- | --- |
| Marco do funil (8) | `LEAD_IDENTIFIED`, `DIAGNOSIS`, `INTEREST`, `PROPOSAL`, `NEGOTIATION`, `SALE`, `REENTRY`, `CLOSED` |
| Estado do cliente (4) | `RECENT`, `ACTIVE`, `ABOUT_TO_SLEEP`, `INACTIVE` |
| Categoria de Break (9) | `A_TIME`, `B_PRODUCT`, `C_FINANCIAL`, `D_TRUST`, `E_PROCESS`, `F_COMPETITOR`, `G_OTHER`, `PRIOR_EXPERIENCE`, `NO_INTEREST` |
| Resultado do contato (5) | `PURCHASED`, `ADVANCED`, `REPLIED_NO_ADVANCE`, `NO_REPLY`, `OPTED_OUT` |
| Temperatura (4) | `COLD`, `WARM`, `HOT`, `READY_TO_BUY` |
| Estado emocional (5) | `CURIOUS`, `INTERESTED`, `WARY`, `EXCITED`, `CONVINCED` |
| Os três "sim" | `CONFIRMATION`, `AGREEMENT`, `VISUALIZATION` |
| Próxima ação (7) | `SEND_CATALOG`, `SEND_SAMPLE`, `WAIT_STOCK`, `CALL_BACK`, `REMINDER`, `SCHEDULE_TALK`, `CLOSE_NO_INTEREST` |
| Tipo de reentrada (5) | `TIME`, `EVENT`, `PROFILE`, `BEHAVIOR`, `RELATIONSHIP` |
| Critério de encerramento (6) | `PURCHASE_DONE`, `CUSTOMER_REQUESTED`, `CONTACT_BLOCKED`, `NO_INTEREST_PERMANENT`, `PROFILE_MISMATCH`, `MAX_ATTEMPTS` |
| Escalonamento (4) | `READY_TO_BUY`, `TECHNICAL_HELP`, `VIP`, `COMPLAINT` |

Transições permitidas do funil (só quando as duas etapas têm marco; ficar na mesma é sempre permitido):

| De | Para |
| --- | --- |
| LEAD_IDENTIFIED | DIAGNOSIS, CLOSED |
| DIAGNOSIS | INTEREST, REENTRY, CLOSED |
| INTEREST | PROPOSAL, DIAGNOSIS, REENTRY |
| PROPOSAL | NEGOTIATION, SALE, REENTRY |
| NEGOTIATION | SALE, PROPOSAL, REENTRY |
| SALE | REENTRY |
| REENTRY | DIAGNOSIS, INTEREST, CLOSED |
| CLOSED | REENTRY |

## 4. Regras do motor

Números entre colchetes são o padrão; cada empresa ajusta em `bre_config` (seção 6).

### 4.1 Estado do cliente (job diário, 03:07)
Base: vendas **confirmadas** do cliente — quantidade e data da última (usada como data de entrega).

```
sem compra                      → null (fora do motor)
dias > inativoApos [120]        → INACTIVE
1 compra:  dias ≤ recenteAte [45] → RECENT,  senão ABOUT_TO_SLEEP
2+ compras: dias ≤ ativoAte [60]  → ACTIVE,  senão ABOUT_TO_SLEEP
```
Cada mudança de estado gera o evento `bre.estado_cliente_alterado`.

### 4.2 Bloqueios de tentativa (registro com resultado `NO_REPLY` e fila do dia)
Na ordem, o primeiro que valer recusa a tentativa com a mensagem indicada:
1. `nao_contatar` ligado → "{O contato} pediu para não ser contatado…" (fixo, não configurável). As mensagens usam o
   vocabulário da empresa: numa escola, "O aluno pediu…".
2. Cliente `RECENT` e entrega há menos de `horasAntesDoPrimeiroContato` [48 h].
3. Ciclo aberto com última tentativa há menos de `horasEntreTentativas` [48 h].
4. Último ciclo encerrado **sem resposta** há menos de `diasEntreCiclos` [15 dias] — **exceto** se houver data
   combinada: reentrada pendente vencendo até hoje, ou retorno registrado para hoje.

Respostas do cliente (qualquer resultado diferente de `NO_REPLY`) nunca são bloqueadas.

### 4.3 Ciclo de contato
- No máximo **um ciclo aberto por cliente** (índice único parcial).
- `NO_REPLY` soma 1 tentativa; na `tentativasPorCiclo`ª [3] o ciclo fecha com `MAX_ATTEMPTS` e o motor programa
  uma reentrada `TIME` para hoje + `diasEntreCiclos`.
- Outro resultado registra a resposta (zera o silêncio).
- `PURCHASED` fecha o ciclo com `PURCHASE_DONE`; `OPTED_OUT` fecha com `CUSTOMER_REQUESTED` e liga `nao_contatar`.
- Job horário (minuto 11): ciclo com tentativa sem resposta há mais de `diasSilencioEncerra` [7] dias fecha com
  `SILENCE` e programa reentrada `TIME`.

### 4.4 Break (Regra de Ouro)
Obrigatório: categoria + motivo **da mesma categoria** + comentário (3 a 1.000 caracteres). O motor grava o marco
do funil onde a quebra aconteceu e aplica a ação padrão:

| Categoria | Ação padrão do motor |
| --- | --- |
| A_TIME | Reentrada `TIME` em 30 dias |
| C_FINANCIAL | Reentrada `EVENT` "Próxima campanha" |
| D_TRUST | Reentrada `TIME` em 7 dias |
| NO_INTEREST | Reentrada `TIME` em 90 dias (reduz a frequência) |
| B_PRODUCT | Não oferecer itens semelhantes (texto, sem reentrada) |
| F_COMPETITOR | Registrar marca, preço e motivo |
| PRIOR_EXPERIENCE | Acionar especialista |
| E_PROCESS | Seguir a regra de silêncio |
| G_OTHER | Seguir o comentário |

Motivos são lista por empresa; na primeira leitura a empresa recebe os motivos padrão da doutrina.

### 4.5 Registro da conversa (8 campos)
Obrigatórios: resultado, temperatura, próxima ação e data do retorno (dispensada em `CLOSE_NO_INTEREST` e
`OPTED_OUT`). Opcionais: estado emocional, os três "sim", interesse e produto (do catálogo), Break, oportunidade,
conversa, segundos gastos (meta: 30 s). Efeitos:
- data do retorno → tarefa "Retorno: …" para quem registrou;
- `PURCHASED` → tarefas de pós-venda em D+2, 5, 10, 20, 30 [`diasPosVenda`] para o responsável do cliente;
- conversa e ofertas só são aceitas se forem da mesma empresa.

### 4.6 Encerramento guiado
Exige um dos 6 critérios + temperatura + checklist completo (motivo compreendido, CRM atualizado, temperatura
definida, próximo gatilho, data/evento de reentrada, nada sem registro). Faltando item, recusa listando o que
falta. Pode programar reentrada no mesmo passo. `CUSTOMER_REQUESTED` e `CONTACT_BLOCKED` ligam `nao_contatar`.

### 4.7 IA (sugestão)
1. Cliente com `nao_contatar` ou anonimizado → recusa; nada vai para a IA.
2. Envia as últimas 100 mensagens de texto (cliente/atendente) ao provedor.
3. Valida a saída contra o contrato; código fora das listas = erro claro, a pessoa preenche à mão.
4. Filtros do motor (com motivo devolvido em `bloqueios`):
   - desconto para cliente `RECENT` → descartado;
   - desconto sem diagnóstico concluído (nenhuma oportunidade em INTEREST/PROPOSAL/NEGOTIATION/SALE) → descartado;
   - oferta com menos de 3 "sim" → descartada.
5. Grava em `analise_bre` (provedor, versão da doutrina, saída, bloqueios). A pessoa confere e salva o registro.

Se a IA apontar uma das 4 situações de escalonamento, o motor abre o escalonamento (seção 4.8).

Provedor: Claude via SDK oficial (`@anthropic-ai/sdk`), saída estruturada pelo mesmo esquema Zod, fallback de recusa
no servidor; sem chave, demonstração por palavras-chave (funciona sem conta).

### 4.8 Escalonamento (BR-017)
- Origem: a IA (campo `escalonamento` da análise) ou a pessoa (campo "Precisa de uma pessoa?" no registro).
- Um aberto por cliente × situação (índice único parcial); pedir de novo não duplica.
- Avisa o responsável pelo cliente e o gestor da equipe dele (notificação + push).
- Enquanto aberto, a automação "enviar mensagem" ignora o cliente ("está com uma pessoa").
- Fecha com "Resolvido" (quem vê o cliente pelo escopo).

### 4.9 SQ-BRE (D-05, D-06)
- Fica no módulo Qualidade e exige também o módulo BRE. Quem só vê o próprio (vendedor) não avalia; ninguém avalia
  o próprio atendimento; o avaliado é quem está atribuído à conversa.
- "SQ-BRE" na conversa: a IA dá a prévia (0 a 20 em Humanização, Diagnóstico, Inteligência, Valor e Próximo passo).
  Uma prévia aberta por conversa: pedir de novo devolve a mesma. "Não contatar" e anonimizado não vão para a IA.
- O supervisor confirma (pode ajustar cada pilar) com feedback; a prévia e a confirmada ficam lado a lado e a
  auditoria guarda as duas notas. A pessoa avaliada recebe aviso. Uma confirmação só.
- Faixas: 95+ Excelência · 85–94 Muito bom · 70–84 Bom · 50–69 Regular · < 50 Requer reciclagem.

### 4.10 BPI, ranking e coaching (D-13, D-14, D-15)
Calculado na consulta, por pessoa, no mês (fuso da empresa). Cada pilar vai de 0 a 100:

| Pilar (peso) | Fonte e fórmula |
| --- | --- |
| Receita (30) | Vendas confirmadas da pessoa ÷ meta mensal × 100, teto 100. Sem meta configurada → fora do BPI |
| Pipeline (20) | Oportunidades abertas no início do período que avançaram ≥ 1 etapa (evento de etapa para ordem maior) ÷ abertas no início × 100 |
| Inteligência (20) | Média de (completude ÷ 80%) e (enriquecimento ÷ 70%), teto 100 cada. Completude = campos opcionais do registro preenchidos ÷ 4; enriquecimento = registros com dado novo ÷ registros |
| Qualidade (20) | Média do SQ-BRE confirmado no período |
| Relacionamento (10) | Tarefas do motor (retorno e pós-venda) vencidas no período feitas até o dia do vencimento ÷ vencidas × 100 |

- Pilar sem dados no período fica fora e os pesos dos demais são redistribuídos (nunca vira zero por falta de dado).
- Receita zero só conta para quem atendeu no período; quem não atende (dono, financeiro) fica fora do BPI.
- A meta é mensal; em período menor (semana do coaching) vale a fração dos dias.
- Faixas: 95+ Elite · 90–94 Excelente · 80–89 Muito bom · 70–79 Adequado · < 70 Plano de desenvolvimento.
- Ranking: maior BPI primeiro; escopo "próprio" vê só a própria linha.
- Coaching (job toda segunda, 07:13): pilar abaixo de 70 nas duas últimas semanas completas (segunda a domingo)
  gera um alerta por pessoa × pilar × semana e avisa o gestor da equipe. Rodar de novo não duplica.

## 5. Banco de dados

Todas com `empresa_id`, RLS (`empresa_id = app_empresa_id()`) e só INSERT/SELECT/UPDATE para o papel da aplicação.

| Tabela / coluna | Campos principais | Observação |
| --- | --- | --- |
| `etapa.marco_bre` | text, CHECK nos 8 códigos | Liga o funil configurável à doutrina |
| `contato` (+4) | `estado_bre`, `estado_bre_em`, `compras_qtd`, `ultima_entrega_em` | Índice `(empresa_id, estado_bre)`; usa `nao_contatar` e `anonimizado_em` existentes |
| `motivo_perda.categoria_bre` | text | Relatórios de perda × Break |
| `oportunidade.encerramento_bre` | jsonb | Critério, temperatura, checklist, autor, data |
| `bre_config` | `empresa_id` PK, `config` jsonb, `versao` | Limites da empresa; cada gravação soma 1 na versão e audita antes/depois |
| `motivo_break` | `categoria`, `nome`, `arquivado_em` | Lista configurável dentro da categoria fixa |
| `ciclo_contato` | `tentativas`, `ultima_tentativa_em`, `ultima_resposta_em`, `encerrado_em`, `motivo_encerramento`, `sem_resposta` | Único aberto por cliente |
| `registro_bre` | os 8 campos + `ciclo_id`, `marco`, `sins` jsonb, `segundos` | Um por conversa registrada |
| `break_bre` | `categoria`, `motivo_id`, `comentario`, `marco`, `acao_padrao` | Regra de Ouro |
| `reentrada` | `tipo`, `prevista_para` ou `condicao`, `motivo`, `break_id`, `status` | CHECK: data ou condição |
| `analise_bre` | `provedor`, `doutrina`, `saida` jsonb, `bloqueios` jsonb | Somente inserção |
| `sq_bre` | `previa` jsonb, `nota_previa`, `confirmada` jsonb, `nota`, `feedback`, `confirmada_por/em` | Uma prévia aberta por conversa; CHECK confirmada/nota/data juntas |
| `escalonamento` | `situacao`, `origem` (ia/manual), `observacao`, `status`, `resolvido_por/em` | Um aberto por cliente × situação |
| `coaching_alerta` | `usuario_id`, `pilar`, `semana`, `notas` | Único por pessoa × pilar × semana |
| `tarefa.origem_bre` | `retorno` ou `pos_venda` | Pilar Relacionamento |

A permissão `permissao.modulo` passa a aceitar `bre`.

## 6. Limites por empresa (`bre_config`)

| Chave | Padrão | Regra |
| --- | --- | --- |
| `recenteAte` / `ativoAte` / `inativoApos` | 45 / 60 / 120 dias | Estado do cliente (Inativo > os outros dois) |
| `horasAntesDoPrimeiroContato` | 48 | Cliente recente |
| `tentativasPorCiclo` | 3 | Encerra o ciclo |
| `horasEntreTentativas` | 48 | Espera entre tentativas |
| `diasSilencioEncerra` | 7 | Job de silêncio |
| `diasEntreCiclos` | 15 | Intervalo após ciclo sem resposta |
| `diasPosVenda` | [2, 5, 10, 20, 30] | Agenda de pós-venda |
| `concordanciaParaAutomacao` / `amostraParaAutomacao` | 85% / 200 | Liberação da automação (ainda não usado) |
| `metaReceitaCentavos` | sem meta | Pilar Receita do BPI (por pessoa, no mês) |

## 7. API

Todas exigem sessão, empresa e o módulo `bre`; erro sempre `{ error: { code, message, details } }`.

| Método e rota | Permissão | Faz |
| --- | --- | --- |
| `GET /api/bre/config` | bre:ver | Limites + versão |
| `PUT /api/bre/config` | bre:administrar | Ajusta limites (parcial) |
| `GET /api/bre/motivos` | bre:ver | Motivos por categoria (semeia na 1ª vez) |
| `POST /api/bre/motivos` · `PATCH /api/bre/motivos/:id` | bre:administrar | Cria, renomeia, arquiva |
| `POST /api/bre/registros` | bre:criar | Registro da conversa (seção 4.5) |
| `POST /api/bre/conversas/:id/analisar` | bre:criar | Sugestão da IA (seção 4.7) |
| `GET /api/bre/breaks?contatoId` | bre:ver | Breaks, paginado |
| `GET /api/bre/fila-do-dia` | bre:ver | Quem pode ser contatado hoje, paginado |
| `GET /api/bre/reentradas?status` · `POST` · `PATCH /:id` | ver / criar / editar | Lista, programa, conclui ou cancela |
| `POST /api/bre/oportunidades/:id/encerrar` | bre:editar | Encerramento guiado |
| `GET /api/bre/escalonamentos?status` · `PATCH /:id` | bre:ver / bre:editar | Lista paginada; marca como resolvido |
| `GET /api/bre/desempenho?mes=AAAA-MM` | bre:ver | BPI por pessoa, ranking e pilares em coaching |
| `GET /api/qualidade/sq-bre?status` | qualidade:ver (+ módulo bre) | Prévias e notas confirmadas, paginado |
| `POST /api/qualidade/sq-bre` | qualidade:criar, escopo além do próprio | Prévia da IA para a conversa |
| `POST /api/qualidade/sq-bre/:id/confirmar` | qualidade:criar, escopo além do próprio | Nota confirmada + feedback |

Escopo: perfil "próprio" só vê e registra clientes da própria carteira (`contato.responsavel_id`); equipe, unidade
e empresa seguem o filtro de escopo do sistema. Perfis padrão: dono administra, gestor edita, vendedor só o próprio.

## 8. Telas

- **Motor BRE** (menu Resultados): "Precisa de uma pessoa" (escalonamentos abertos); fila do dia com "Registrar
  conversa"; reentradas com Feita/Cancelar; Desempenho (BPI) do mês; limites da empresa e meta de receita (só
  administrador).
- **Registro** (modal, também na conversa): os campos da seção 4.5, "Precisa de uma pessoa?" e, na conversa,
  "Sugerir com IA".
- **Conversa**: botão "SQ-BRE" para quem avalia; **Qualidade**: lista SQ-BRE com "Confirmar" nas prévias.
- **Configurar CRM → etapa**: campo "Marco BRE".
- Tudo funciona em 360 px; textos passam pelo vocabulário da empresa.

## 9. Critérios de aceite (automatizados)

| Teste | Cenário |
| --- | --- |
| AT-013 | 1 compra há 50 dias → Prestes a dormir; 2 compras, última há 50 → Ativo; evento gerado |
| AT-014 | Entrega hoje não entra na fila; há 10 dias entra |
| AT-015 | Lead → Venda recusado com a lista de destinos; Lead → Diagnóstico aceito |
| AT-016 | Encerramento com checklist incompleto recusado, listando o item |
| AT-017 | Break sem motivo recusado; Financeiro gera reentrada "Próxima campanha"; motivo de outra categoria recusado |
| AT-020/021 | 3 tentativas fecham o ciclo; nova tentativa antes de 15 dias recusada; data combinada libera |
| AT-022 | "Não contatar" sai da fila e recusa tentativa |
| Silêncio | 8 dias sem resposta: ciclo fecha `SILENCE` + reentrada |
| Pós-venda | Venda cria retorno + 5 tarefas na ordem certa |
| Config/isolamento | Limite impossível recusado; nova versão; vendedor não altera; outra empresa e outra carteira não acessam |
| IA | Demonstração sugere; desconto e oferta descartados com motivo; "não contatar" não vai para a IA |
| AT-018 | Saída da IA com código fora das listas ou nota fora da escala é recusada |
| AT-019 | Prévia da IA, supervisor confirma 68, as duas notas na auditoria, BPI usa 68; prévia repetida devolve a mesma |
| AT-024 | Cliente ativo sem diagnóstico não recebe desconto; com oportunidade em Interesse, recebe |
| AT-025 | BPI com dados conhecidos: receita 50, pipeline 50, inteligência 81,3, relacionamento 50, qualidade sem dados → 57,8; pesos 30/20/20/20/10 e faixas em teste unitário |
| AT-026 | 2 semanas abaixo de 70 → um alerta ao gestor; rodar de novo não duplica; 1 semana só → nada; dono e financeiro fora |
| Escalonamento | Reclamação pela IA abre um só, avisa responsável e gestor; outra carteira não vê nem resolve; pela pessoa no registro |

## 10. O que falta

1. Painel de concordância IA × supervisor (DEC-010): comparar prévia × nota confirmada e sugestão × registro, e
   liberar a automação pelo percentual da empresa.
2. Telas: encerramento guiado no card da oportunidade e cadastro de motivos de Break (hoje só pela API).
3. Campos de inteligência configuráveis por segmento (o pilar Inteligência hoje usa os campos do registro).
4. Análise da IA pela fila de jobs (hoje é na hora) e BPI pré-calculado quando houver volume.

Riscos e decisões pendentes: a conversa vai inteira para a IA (DEC-009) — antes de cliente real, base legal,
aviso ao titular, contrato sem uso para treino e prazo de retenção; data de entrega hoje = data da venda; pontos por
item do SQ-BRE ainda são proposta (o supervisor dá a nota por pilar).

## 11. Portando para outro sistema

Para reproduzir o motor fora do menezesgestao, o mínimo é: as listas e regras puras de `dto-bre.ts` (copiáveis
como estão), as tabelas da seção 5 com isolamento por empresa, um agendador para os dois jobs, uma tabela de
tarefas para retorno e pós-venda, e uma fonte de vendas confirmadas por cliente. As regras da seção 4 devem ficar
no servidor e ser cobertas pelos testes da seção 9 antes de qualquer tela.
