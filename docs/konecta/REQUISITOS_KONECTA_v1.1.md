# Plataforma Comercial Completa
## Documento de Requisitos Funcionais e Identidade Visual

**Finalidade:** material-base para levantamento, discovery, especificação detalhada e planejamento do desenvolvimento da ferramenta.  
**Versão:** 1.1  
**Data:** 08/10/2026  
**Status:** Documento de visão e requisitos de negócio — sujeito à validação com stakeholders.

---

## 1. Resumo executivo

A **Plataforma Comercial Completa** será uma central de operações comerciais que unifica CRM, atendimento omnichannel, WhatsApp, telefonia, discagem, campanhas, vendas, produtividade, qualidade, automações, inteligência comercial, entregas e pós-venda.

O produto deve substituir a operação fragmentada entre CRM, WhatsApp, planilhas, discadores, telefonia, tarefas, agenda, metas, comissões e relatórios. A premissa central é:

> Tudo o que acontece com um cliente deve estar dentro da mesma jornada comercial.

O sistema deverá ser completo para o gestor, simples para o vendedor e invisível para o cliente, mantendo uma linha do tempo única e acionável para cada relacionamento.

### 1.1 Objetivos de negócio

- Centralizar a história do cliente e reduzir informação dispersa.
- Aumentar velocidade de atendimento, produtividade e conversão.
- Dar ao vendedor clareza sobre a próxima ação prioritária.
- Dar ao gestor visão operacional em tempo real.
- Dar ao empresário visão de receita, conversão, perdas e previsão.
- Permitir configuração por segmento, empresa, unidade, equipe e plano.
- Criar base para automações, IA, BI e operação white-label.

### 1.2 Fora do escopo desta versão

Este documento define **o que o produto deve oferecer**, não a arquitetura, tecnologia, fornecedor de telefonia, provedor de mensagens, modelo de IA ou desenho definitivo de banco de dados. Essas decisões deverão ser tomadas no levantamento técnico e na priorização do MVP.

---

## 2. Visão da jornada comercial

A jornada principal deverá ser suportada de ponta a ponta:

**Captação → Lead → Distribuição → Atendimento → Qualificação → Oportunidade → Proposta → Negociação → Venda → Pagamento → Comissão → Entrega → Pós-venda → Recompra/Indicação**

Uma mudança na jornada poderá gerar eventos nos demais módulos. Exemplos:

- Novo lead: atribuir responsável, enviar mensagem inicial e criar tarefa.
- Lead sem resposta: criar follow-up após prazo configurado.
- Proposta aceita: registrar venda, acionar entrega e calcular comissão.
- Cliente marcado como “Não Contatar”: bloquear campanhas e contatos automáticos.
- Venda concluída: criar atividades de pós-venda, pesquisa e oportunidade de recompra.

---

## 3. Perfis e necessidades dos usuários

| Perfil | Objetivo principal | Acesso esperado |
|---|---|---|
| Administrador | Configurar empresa, usuários, permissões, integrações e auditoria | Empresa ou grupo de empresas |
| Empresário | Enxergar receita, conversão, campanhas, perdas e previsão | Visão executiva consolidada |
| Gestor | Acompanhar equipe, carteira, metas, qualidade e operação | Unidade, equipe ou empresa |
| Supervisor | Apoiar a operação e acompanhar a rotina | Equipe ou filas atribuídas |
| Vendedor/SDR | Trabalhar leads, conversas, ligações, tarefas, oportunidades e vendas | Própria carteira ou escopo autorizado |
| Operação/Prestador | Executar agenda, entregas, turmas e serviços | Atividades próprias |
| Financeiro | Consultar vendas, comissões e fechamento | Dados financeiros autorizados |
| Auditor/Compliance | Consultar histórico, alterações e tratamento de dados | Somente leitura e auditoria |

O acesso deverá respeitar **escopo por usuário**: próprio, equipe, unidade, empresa ou grupo, conforme perfil e permissão.

---

## 4. Requisitos funcionais

### 4.1 Administração, empresas e configuração

| ID | Requisito | Prioridade |
|---|---|---|
| RF-ADM-001 | O sistema deve permitir cadastrar uma ou mais empresas/unidades e seus dados básicos. | MVP |
| RF-ADM-002 | O sistema deve permitir configurar equipes, usuários, cargos, filas, produtos, serviços e nomenclaturas. | MVP |
| RF-ADM-003 | O administrador deve poder habilitar ou desabilitar módulos por empresa, plano ou unidade. | Alta |
| RF-ADM-004 | O sistema deve permitir campos personalizados, etiquetas, status e motivos configuráveis. | MVP |
| RF-ADM-005 | O sistema deve registrar auditoria de alterações relevantes, com usuário, data/hora, ação e valores afetados. | MVP |
| RF-ADM-006 | O sistema deve oferecer personalização white-label: nome, logo, ícone, cores, domínio e vocabulário. | Fase 2 |

### 4.2 Usuários, autenticação e permissões

| ID | Requisito | Prioridade |
|---|---|---|
| RF-ACE-001 | O sistema deve permitir login, recuperação de acesso, encerramento de sessão e gestão de perfil. | MVP |
| RF-ACE-002 | O administrador deve configurar permissões por módulo, ação e alcance de dados. | MVP |
| RF-ACE-003 | O sistema deve suportar perfis predefinidos e permissões customizadas. | Alta |
| RF-ACE-004 | O sistema deve exibir o status operacional do usuário: online, disponível, ocupado, em ligação, em atendimento e pausado. | Alta |
| RF-ACE-005 | O sistema deve registrar eventos de acesso e alterações de permissão. | MVP |

### 4.3 CRM, contatos e empresas

| ID | Requisito | Prioridade |
|---|---|---|
| RF-CRM-001 | O sistema deve cadastrar pessoas físicas, empresas e relacionamentos entre elas. | MVP |
| RF-CRM-002 | O cadastro deve suportar telefone, WhatsApp, e-mail, documentos, endereço, responsável, equipe, origem e etiquetas. | MVP |
| RF-CRM-003 | O sistema deve permitir campos personalizados por segmento, empresa ou tipo de registro. | MVP |
| RF-CRM-004 | O sistema deve identificar possíveis duplicidades e permitir fusão controlada de registros. | Alta |
| RF-CRM-005 | O sistema deve permitir importação, exportação, arquivamento e restauração de contatos. | MVP |
| RF-CRM-006 | O sistema deve disponibilizar uma linha do tempo única com conversas, ligações, tarefas, propostas, vendas, pesquisas e pós-venda. | MVP |
| RF-CRM-007 | O sistema deve permitir marcar o contato como “Não Contatar” e respeitar essa preferência em automações e campanhas. | MVP |

### 4.4 Leads e distribuição

| ID | Requisito | Prioridade |
|---|---|---|
| RF-LEAD-001 | O sistema deve registrar origem, campanha, produto de interesse, temperatura, prioridade e data de entrada do lead. | MVP |
| RF-LEAD-002 | O sistema deve registrar responsável, equipe, tentativas, última interação e próxima ação. | MVP |
| RF-LEAD-003 | O sistema deve distribuir leads por regras configuráveis, como rodízio, capacidade, produto, região, origem ou prioridade. | Alta |
| RF-LEAD-004 | O gestor deve poder redistribuir leads manualmente ou em massa, respeitando permissões. | Alta |
| RF-LEAD-005 | O sistema deve alertar sobre leads novos, parados, sem contato e próximos do SLA. | Alta |

### 4.5 Funis e oportunidades

| ID | Requisito | Prioridade |
|---|---|---|
| RF-FUN-001 | O sistema deve permitir múltiplos funis por empresa, produto, equipe ou processo. | MVP |
| RF-FUN-002 | O administrador deve configurar etapas, ordem, regras de entrada/saída, obrigatoriedades e motivos de perda. | MVP |
| RF-FUN-003 | O usuário deve visualizar oportunidades em Kanban e lista, com filtros, ordenação e busca. | MVP |
| RF-FUN-004 | O sistema deve permitir ações em massa, movimentação de etapa e registro de valor estimado. | Alta |
| RF-FUN-005 | O sistema deve calcular previsão, conversão por etapa, tempo de permanência e valor do funil. | Alta |
| RF-FUN-006 | Toda oportunidade deve estar vinculada a contato/empresa, responsável, produto, origem e histórico. | MVP |

### 4.6 Conversas omnichannel

| ID | Requisito | Prioridade |
|---|---|---|
| RF-CAN-001 | O sistema deve centralizar conversas de WhatsApp e, quando integrados, Instagram, Messenger, chat do site, SMS e e-mail. | MVP/Alta |
| RF-CAN-002 | O atendimento deve suportar texto, áudio, imagem, vídeo, documento, modelos e respostas rápidas, conforme canal. | MVP |
| RF-CAN-003 | O sistema deve vincular cada conversa ao contato, empresa, lead e oportunidade correspondentes. | MVP |
| RF-CAN-004 | O usuário deve atribuir, transferir, priorizar, etiquetar, pausar e encerrar atendimentos. | MVP |
| RF-CAN-005 | O atendente deve abrir tarefa ou oportunidade a partir da conversa. | MVP |
| RF-CAN-006 | O sistema deve exibir conversas pendentes, não respondidas e fora do SLA. | Alta |
| RF-CAN-007 | O sistema deve manter histórico de mensagens e status de entrega/leitura quando disponibilizado pelo canal. | Alta |

### 4.7 Telefonia e discagem

| ID | Requisito | Prioridade |
|---|---|---|
| RF-TEL-001 | O usuário deve iniciar ligação a partir do contato, funil, conversa, agenda ou fila. | Alta |
| RF-TEL-002 | A tela de ligação deve suportar espera, mudo, transferência, conferência e encerramento. | Alta |
| RF-TEL-003 | O sistema deve registrar automaticamente duração, resultado, responsável, data/hora e próximo contato. | MVP |
| RF-TEL-004 | O sistema deve permitir gravação quando legalmente permitida e configurada. | Fase 2 |
| RF-TEL-005 | O sistema deve criar campanhas de discagem com base, filas, prioridades e resultados padronizados. | Alta |
| RF-TEL-006 | O discador deve permitir modos automático, progressivo ou preditivo, conforme integração escolhida. | Fase 2 |
| RF-TEL-007 | O resultado de uma chamada deve poder atualizar o funil, criar tarefa ou converter em oportunidade. | Alta |

### 4.8 Campanhas, filas e automações

| ID | Requisito | Prioridade |
|---|---|---|
| RF-CMP-001 | O sistema deve criar campanhas de WhatsApp, ligação, e-mail, SMS, formulários ou ações combinadas. | Alta |
| RF-CMP-002 | O usuário deve importar ou selecionar bases de contatos com filtros e critérios de elegibilidade. | Alta |
| RF-CMP-003 | O sistema deve criar filas para leads novos, recuperação, renovação, clientes antigos, indicações e campanhas específicas. | Alta |
| RF-CMP-004 | O sistema deve oferecer automações no modelo “quando acontecer X, se condição Y, executar ação Z”. | Alta |
| RF-CMP-005 | As automações devem permitir envio de mensagem, distribuição, criação de tarefa, mudança de etapa, alerta e follow-up. | Alta |
| RF-CMP-006 | O sistema deve impedir disparos para contatos com preferência “Não Contatar” ou sem consentimento aplicável. | MVP |
| RF-CMP-007 | O sistema deve registrar execução, falha, tentativas e motivo de não execução de cada automação. | Alta |

### 4.9 Rotina, tarefas, agenda e scripts

| ID | Requisito | Prioridade |
|---|---|---|
| RF-ROT-001 | O sistema deve apresentar uma rotina diária com tarefas vencidas, leads novos, retornos, conversas pendentes, reuniões, propostas e metas. | MVP |
| RF-ROT-002 | O usuário deve criar, atribuir, priorizar, agendar, concluir e reagendar tarefas. | MVP |
| RF-ROT-003 | A agenda deve possuir visualização diária, semanal e mensal. | MVP |
| RF-ROT-004 | A agenda deve suportar reuniões, visitas, ligações, demonstrações e retornos. | MVP |
| RF-ROT-005 | O sistema deve permitir biblioteca de scripts por produto, etapa, campanha e situação. | Alta |
| RF-ROT-006 | O sistema deve exibir roteiro contextual durante conversa ou ligação, quando configurado. | Fase 2 |

### 4.10 Produtos, propostas, vendas e comissões

| ID | Requisito | Prioridade |
|---|---|---|
| RF-REC-001 | O sistema deve cadastrar produtos, serviços, planos, pacotes, assinaturas, cursos, turmas e projetos. | MVP |
| RF-REC-002 | O sistema deve criar propostas com itens, descontos, condições, validade, status e responsável. | MVP |
| RF-REC-003 | O sistema deve registrar envio, visualização, aceite, rejeição e expiração da proposta. | Alta |
| RF-REC-004 | O sistema deve registrar venda com cliente, vendedor, produto, valor, desconto, condição, pagamento, origem e campanha. | MVP |
| RF-REC-005 | O sistema deve calcular comissão por percentual, produto, faixa, meta, bônus ou campanha. | Alta |
| RF-REC-006 | O usuário autorizado deve consultar comissões previstas, realizadas e pagas. | Alta |
| RF-REC-007 | O sistema deve controlar entregas, turmas, vagas, agenda, profissionais, capacidade e ocupação, quando aplicável. | Fase 2 |
| RF-REC-008 | O sistema deve criar ações de pós-venda, renovação, recompra, indicação e pesquisa. | Alta |

### 4.11 Gestão, metas, qualidade e BI

| ID | Requisito | Prioridade |
|---|---|---|
| RF-GES-001 | O sistema deve permitir metas por vendedor, equipe, unidade, empresa e campanha. | MVP |
| RF-GES-002 | As metas devem contemplar ligações, atendimentos, leads, propostas, vendas, faturamento e indicadores configuráveis. | Alta |
| RF-GES-003 | O sistema deve exibir ranking diário, semanal, mensal e anual. | Alta |
| RF-GES-004 | O sistema deve permitir avaliar conversas e ligações por critérios, notas, comentários e feedback. | Alta |
| RF-GES-005 | O dashboard deve exibir produtividade, funil, receita, conversão, perdas, campanhas, metas e pontos de atenção. | MVP |
| RF-GES-006 | O sistema deve permitir filtros por período, equipe, unidade, produto, canal, origem e responsável. | MVP |
| RF-GES-007 | O sistema deve permitir exportar relatórios e dados conforme permissão. | Alta |
| RF-GES-008 | O sistema deve oferecer visão em tempo real de filas, chamadas, conversas pendentes e status da equipe. | Fase 2 |

### 4.12 IA como assistente comercial

| ID | Requisito | Prioridade |
|---|---|---|
| RF-IA-001 | Durante o atendimento, a IA poderá sugerir respostas, identificar intenção, objeções e interesse. | Fase 2 |
| RF-IA-002 | Após conversa ou ligação, a IA poderá gerar resumo, extrair dados e sugerir próxima ação. | Fase 2 |
| RF-IA-003 | A IA poderá apoiar análise de desempenho, riscos, oportunidades e padrões de perda. | Fase 3 |
| RF-IA-004 | O conteúdo de treinamento do assistente deverá ser baseado preferencialmente em FAQs aprovadas e fluxos documentados em Draw.io. | Fase 2 |
| RF-IA-005 | Toda sugestão gerada por IA deverá ser identificável, revisável e não poderá executar ações críticas sem regra/autorização definida. | Fase 2 |

### 4.13 Integrações

| ID | Requisito | Prioridade |
|---|---|---|
| RF-INT-001 | O sistema deve possuir camada de integrações para comunicação, telefonia, marketing, agenda, pagamentos, IA e documentos. | MVP |
| RF-INT-002 | Integrações de comunicação devem considerar WhatsApp, Instagram, Messenger, SMS e e-mail, conforme viabilidade e fornecedor. | MVP/Alta |
| RF-INT-003 | O sistema deve estar preparado para VoIP, centrais, discadores e operadoras. | Alta |
| RF-INT-004 | O sistema deve integrar ou receber leads de Google, Meta, landing pages e formulários. | Alta |
| RF-INT-005 | O sistema deve integrar agendas Google Calendar e Outlook quando aprovadas. | Alta |
| RF-INT-006 | O sistema deve permitir integração com gateways, bancos, plataformas de pagamento, transcrição, assinatura e armazenamento. | Fase 2 |
| RF-INT-007 | O sistema deve registrar logs de integração, sincronizações, erros, reprocessamentos e status de conexão. | MVP |

### 4.14 Privacidade, auditoria e LGPD

| ID | Requisito | Prioridade |
|---|---|---|
| RF-LGP-001 | O sistema deve permitir consultar, corrigir, exportar, anonimizar ou excluir dados quando aplicável. | MVP |
| RF-LGP-002 | O sistema deve registrar preferências de contato e consentimentos quando necessários. | MVP |
| RF-LGP-003 | O sistema deve controlar acesso a dados pessoais e sensíveis por perfil e alcance. | MVP |
| RF-LGP-004 | O sistema deve manter trilha de auditoria para ações relevantes e tratamento de dados. | MVP |
| RF-LGP-005 | O sistema deve permitir políticas de retenção e descarte a serem definidas no levantamento jurídico/técnico. | Alta |

---

## 5. Requisitos não funcionais

| ID | Categoria | Requisito verificável |
|---|---|---|
| RNF-001 | Segurança | Validar rigorosamente todas as entradas do usuário, usar consultas parametrizadas/ORM seguro e sanitizar saídas contra XSS. |
| RNF-002 | Sessão | Regenerar identificador de sessão após autenticação, expirar sessões conforme política e proteger credenciais. |
| RNF-003 | CSRF | Implementar proteção contra CSRF nas operações que alteram estado. |
| RNF-004 | Privacidade | Aplicar minimização, segregação por tenant/empresa e princípio do menor privilégio. |
| RNF-005 | Disponibilidade | Definir no levantamento metas de disponibilidade, janela de manutenção e comportamento em indisponibilidade de integrações. |
| RNF-006 | Performance | Definir SLAs para carregamento de dashboard, busca, abertura de conversa e movimentação de oportunidade. |
| RNF-007 | Escalabilidade | Suportar crescimento de usuários, empresas, mensagens, chamadas, campanhas e registros sem degradação não controlada. |
| RNF-008 | Observabilidade | Registrar logs estruturados de aplicação, integração, automação, auditoria e erros, com correlação por operação. |
| RNF-009 | Usabilidade | Ser responsivo, acessível e utilizável em desktop; avaliar experiência mobile no escopo do MVP. |
| RNF-010 | Acessibilidade | Definir conformidade-alvo, contraste, navegação por teclado, foco visível, textos alternativos e mensagens de erro claras. |
| RNF-011 | Compatibilidade | Validar navegadores suportados e funcionamento em diferentes resoluções. |
| RNF-012 | Qualidade | Manter testes unitários, integração, contrato de APIs, jornadas críticas e regressão visual. |
| RNF-013 | Manutenibilidade | Aplicar responsabilidade única, código legível, documentação de decisões e tratamento consistente de erros. |
| RNF-014 | Backup | Definir política de backup, restauração, retenção, RPO e RTO. |
| RNF-015 | Auditoria | Garantir que registros de auditoria não sejam editáveis por usuários comuns e possuam retenção definida. |

---

## 6. Regras de negócio iniciais

1. Toda interação relevante deve estar vinculada a um contato ou empresa, salvo eventos técnicos autorizados.
2. Toda oportunidade deve pertencer a um funil e a uma etapa válida.
3. Mudanças de etapa podem exigir campos obrigatórios, motivo de perda ou próxima ação.
4. Um contato “Não Contatar” não deve receber disparos ou contatos automáticos.
5. Uma ação feita em qualquer canal deve refletir na linha do tempo do cliente.
6. Distribuição de leads deve respeitar capacidade, disponibilidade, regras de equipe e permissões.
7. Dados financeiros e comissões só devem aparecer para perfis autorizados.
8. Ações de automação devem ser idempotentes ou possuir controle de duplicidade.
9. Falhas de integração devem ser visíveis, registradas e reprocessáveis quando possível.
10. Sugestões da IA não substituem validações de negócio nem autorização humana em ações críticas.
11. Campos, vocabulário, funis e scripts devem poder variar por segmento ou empresa, quando habilitados.
12. Exclusão, anonimização e exportação devem respeitar dependências, auditoria e legislação aplicável.

---

## 7. Identidade visual e diretrizes de experiência

> **Fonte de verdade:** a identidade visual está em `docs/Menezes Gestão — Interface.html` (folha "Fundamentos visuais" e telas). Esta seção resume o arquivo; em caso de diferença, vale o HTML. Levantamento de implementação: `frontend/docs/LEVANTAMENTO_2026-10-19.md`.

### 7.1 Posicionamento visual

A identidade deve comunicar **controle, clareza, produtividade e inteligência comercial**, sem parecer agressiva ou excessivamente financeira. A interface deve transmitir confiança para gestores e leveza para vendedores.

**Conceito:** uma central única que transforma dados e interações em próxima ação comercial.

### 7.2 Paleta de cores

| Uso | Cor | Hex | Aplicação |
|---|---|---|---|
| Destaque | Cor da marca da organização | padrão `#2F5BEA` | Ações principais, item ativo, progresso. Muda por organização |
| Destaque suave | Destaque a 8% | — | Fundo do item ativo |
| Fundo | Cinza quente | `#F7F7F5` | Fundo geral da aplicação |
| Superfície | Branco | `#FFFFFF` | Cards, campos, cabeçalho |
| Texto principal | Quase preto | `#1A1D23` | Títulos e conteúdo principal |
| Texto secundário | Cinza | `#5F6672` | Descrições, metadados e legendas |
| Borda | Cinza claro | `#E8E8E3` | Bordas e divisores |
| Sucesso | Verde-petróleo | `#0F7B6C` | Estados positivos (com texto ou ícone) |
| Atenção | Âmbar | `#B7791F` | Alertas |
| Erro | Vermelho | `#D93F2B` | Falha, bloqueio e ação destrutiva |

Destaques alternativos para organizações: `#0F7B6C`, `#B4462B`, `#6B46C1`.

**Regra:** cor nunca deve ser o único meio de transmitir status; combinar cor com texto, ícone ou padrão.

### 7.3 Tipografia

- **Fonte:** Plus Jakarta Sans, com fallback system-ui, -apple-system, “Segoe UI”, sans-serif. Servida pelo próprio projeto (sem CDN).
- **Título de página:** 28 px, peso 700.
- **Título de seção:** 20 px, peso 700.
- **Bloco:** 15 px, peso 600.
- **Texto padrão:** 14 px, peso 400.
- **Metadados:** 13 px, peso 400.
- Usar hierarquia consistente e evitar excesso de caixa alta.

### 7.4 Layout e componentes

- Navegação lateral persistente em desktop, com módulo ativo claramente indicado.
- Cabeçalho com contexto da empresa/unidade, busca global, notificações e perfil.
- Dashboard baseado em cards de indicadores, tabelas compactas, gráficos e listas de ação.
- Cards com raio de 14 px e controles com raio de 10 px, borda fina e sombra discreta.
- Botões com altura de 44 px; um só botão principal por tela, na cor de destaque; ações secundárias neutras; ações destrutivas vermelhas.
- Tabelas devem oferecer busca, filtros, ordenação, paginação e ações contextuais.
- Kanban deve destacar etapa, quantidade, valor, prioridade, responsável e próxima ação.
- Linha do tempo deve diferenciar mensagem, ligação, tarefa, proposta, venda e automação.
- Estados vazios devem explicar o próximo passo, não apenas informar ausência de dados.
- Feedback de sucesso/erro deve ser imediato e acionável.

### 7.5 Iconografia e linguagem visual

- Ícones lineares, simples e consistentes, com preenchimento apenas para estados selecionados.
- Evitar emojis como ícones de produto em produção.
- Usar ilustrações abstratas e discretas em onboarding e estados vazios.
- A interface deve priorizar densidade informacional controlada: mostrar o essencial e permitir aprofundamento.

### 7.6 Voz e microcopy

- Tom: direto, profissional, humano e orientado à ação.
- Preferir verbos: **Criar contato**, **Distribuir lead**, **Agendar retorno**, **Enviar proposta**, **Concluir tarefa**.
- Evitar mensagens culpabilizadoras; explicar o que ocorreu e como resolver.
- Exemplos: “Há 12 leads sem contato há mais de 24 horas” e “Não foi possível enviar. Tentar novamente”.
- Manter vocabulário configurável por segmento: cliente, aluno, paciente, comprador, interessado etc.

### 7.7 Experiências por perfil

- **Vendedor:** tela inicial responde “o que eu preciso fazer agora?”, com tarefas, leads, conversas, retornos e metas prioritárias.
- **Gestor:** tela inicial responde “o que está acontecendo?”, com produtividade, operação, funil, equipe, metas e alertas.
- **Empresário:** tela inicial responde “quanto estamos vendendo e por quê?”, com receita, conversão, campanhas, perdas e previsão.

### 7.8 Responsividade e acessibilidade visual

- Desktop como experiência operacional principal; responsividade para tablet e mobile deve ser definida no levantamento.
- Contraste mínimo conforme padrão de acessibilidade escolhido.
- Foco visível, navegação por teclado e áreas de clique adequadas.
- Não depender apenas de cor para status, prioridade, etapa ou erro.
- Componentes de telefonia e atendimento devem preservar legibilidade em telas menores.

---

## 8. Arquitetura de informação proposta

1. **Início/Dashboard**
2. **CRM** — contatos, empresas, leads, oportunidades, funis
3. **Conversas** — caixa de entrada, filas, canais e atendimento
4. **Telefonia** — ligações, filas, discador e campanhas
5. **Campanhas** — bases, jornadas, automações e resultados
6. **Rotina** — tarefas, agenda, scripts e ações recomendadas
7. **Vendas** — produtos, propostas, vendas, comissões e pós-venda
8. **Operação** — entregas, agenda, capacidade e serviços
9. **Gestão** — equipes, metas, ranking, qualidade e BI
10. **Relatórios** — indicadores, exportações e análises
11. **Integrações** — canais, telefonia, marketing, agenda, pagamentos e IA
12. **Administração** — empresa, usuários, permissões, white-label e auditoria

---

## 9. Priorização sugerida para o levantamento

### MVP recomendado

- Administração básica, usuários e permissões.
- CRM de contatos, empresas e leads.
- Funil com etapas configuráveis e visão Kanban/lista.
- Linha do tempo do cliente.
- Conversas do canal prioritário definido pelo negócio, preferencialmente WhatsApp.
- Tarefas, rotina diária e agenda básica.
- Produtos, propostas e registro de vendas.
- Dashboard operacional e metas essenciais.
- Importação/exportação, auditoria básica e “Não Contatar”.
- Integrações essenciais e logs de integração.

### Fase 2

- Telefonia integrada, discador e gravações autorizadas.
- Campanhas multicanal, filas e automações avançadas.
- Comissões completas, qualidade e ranking avançado.
- Entregas, capacidade e pós-venda estruturado.
- IA para resumo, sugestão de resposta e próxima ação.
- White-label e integrações adicionais.

### Fase 3

- BI avançado e previsões.
- Discagem preditiva, quando tecnicamente e legalmente viável.
- IA para análise gerencial e padrões de perda.
- Marketplace/ecossistema de integrações.
- Aplicativo mobile dedicado, caso validado no levantamento.

---

## 10. Critérios de aceite transversais

- O usuário só visualiza e altera dados compatíveis com seu perfil e alcance.
- Toda ação crítica apresenta confirmação, resultado e mensagem de erro compreensível.
- Toda interação relevante aparece na linha do tempo correta.
- Filtros, buscas e paginação mantêm contexto e não expõem dados indevidos.
- Campanhas e automações respeitam “Não Contatar”, consentimentos e regras de elegibilidade.
- Integrações informam estado, última sincronização e falha reprocessável quando aplicável.
- Dashboards mostram período, filtros ativos, origem dos indicadores e data de atualização.
- A interface atende à identidade visual definida e mantém consistência entre módulos.
- Jornadas críticas possuem testes automatizados e evidência de validação.

---

## 11. Perguntas para o levantamento com stakeholders

### Negócio e operação

- Qual é o segmento inicial e qual processo comercial será priorizado?
- Qual canal representa maior volume e maior impacto financeiro?
- Quais são os SLAs de primeiro contato, resposta e follow-up?
- Como o lead é distribuído atualmente? Existem regras por região, produto ou capacidade?
- Quais motivos de perda e etapas do funil são obrigatórios?

### Dados e governança

- Quais sistemas serão fonte oficial para contatos, vendas, pagamentos e agenda?
- Qual volume atual e projetado de contatos, mensagens, chamadas e usuários?
- Quais dados pessoais/sensíveis são tratados e por quanto tempo?
- Quem poderá exportar, anonimizar ou excluir dados?
- Quais eventos precisam de auditoria obrigatória?

### Integrações

- Qual provedor oficial de WhatsApp e telefonia será utilizado?
- Há necessidade de Instagram, Messenger, SMS, e-mail, Google, Meta, gateways e assinatura?
- Quais integrações precisam ser bidirecionais e quais apenas recebem dados?
- Como tratar indisponibilidade, duplicidade e reprocessamento?

### Gestão e receita

- Como metas, comissões, descontos e pagamentos são calculados hoje?
- Quais indicadores definem produtividade e qualidade?
- Quais relatórios são obrigatórios no primeiro release?
- Há diferentes regras por equipe, unidade, produto ou campanha?

### IA e conteúdo

- Quais FAQs estão aprovadas e quem será responsável por mantê-las?
- Quais fluxos devem ser documentados em Draw.io para treinamento do assistente?
- Em quais situações a IA pode sugerir e em quais pode executar?
- Como será feita a revisão humana e o monitoramento de respostas inadequadas?

### Identidade e experiência

- A plataforma terá marca própria, white-label ou ambas?
- Quais termos devem substituir “cliente”, “lead”, “venda” e “vendedor” em cada segmento?
- Quais dispositivos serão usados pela operação?
- Qual nível de acessibilidade e suporte mobile é obrigatório?

---

## 12. Indicadores de sucesso sugeridos

- Tempo médio até o primeiro contato.
- Percentual de leads contatados dentro do SLA.
- Taxa de conversão por etapa, canal, campanha e vendedor.
- Tempo médio de permanência no funil.
- Taxa de propostas aceitas e vendas concluídas.
- Receita, ticket médio e previsão de fechamento.
- Produtividade por vendedor e equipe.
- Taxa de follow-up realizado no prazo.
- Volume de conversas pendentes e tempo de resposta.
- Taxa de recompra, renovação, indicação e conclusão do pós-venda.
- Qualidade média de atendimentos e chamadas.
- Adoção dos módulos e redução do uso de planilhas/ferramentas paralelas.

---

## 13. Próximos passos recomendados

1. Validar visão, personas, segmento inicial e jornada prioritária.
2. Escolher o escopo do MVP e definir o que não será desenvolvido inicialmente.
3. Mapear processos atuais, exceções, regras e volumes reais.
4. Detalhar casos de uso e fluxos em BPMN/Draw.io, especialmente para atendimento, distribuição, funil, venda e pós-venda.
5. Definir integrações, fornecedores, limites de API e requisitos legais.
6. Criar protótipo navegável das telas principais conforme a identidade visual.
7. Transformar os requisitos em épicos, histórias de usuário, critérios de aceite e backlog priorizado.
8. Definir arquitetura, modelo de dados, estratégia de segurança, observabilidade, testes e implantação.
9. Executar validação com vendedores, gestores e direção antes do desenvolvimento completo.
10. Estabelecer governança de mudanças e versionamento deste documento.

---

## 14. Glossário inicial

- **Lead:** contato com potencial de compra ainda não qualificado.
- **Oportunidade:** possibilidade comercial qualificada em um funil.
- **Funil:** conjunto de etapas que representa um processo comercial.
- **Fila:** conjunto de registros aguardando distribuição ou ação.
- **SLA:** prazo acordado para atendimento ou execução.
- **Follow-up:** próxima ação planejada para manter a jornada ativa.
- **White-label:** personalização da plataforma para operar com a marca de outra empresa.
- **Omnichannel:** atendimento integrado em múltiplos canais com contexto compartilhado.
- **Escopo de dados:** limite de registros que um usuário pode consultar ou alterar.

---

**Observação final:** este documento deve ser tratado como base para levantamento. Requisitos marcados como “MVP”, “Alta”, “Fase 2” ou “Fase 3” precisam ser confirmados com os responsáveis pelo negócio, produto, jurídico, tecnologia e operação antes da elaboração da especificação técnica definitiva.


---

# ANEXO DE REVISÃO 1.1 — DECISÕES PARA TORNAR O DOCUMENTO EXECUTÁVEL

## A.1 Leitura da avaliação e decisões adotadas

A avaliação externa confirma a qualidade do documento de visão, mas identifica que ele ainda não deve ser usado como backlog de desenvolvimento sem uma redução de escopo e sem decisões de negócio. Este anexo passa a fazer parte do documento e **prevalece sobre qualquer prioridade ou formulação contraditória nas seções anteriores**.

### A.1.1 Decisões de escopo

- O segmento âncora continua sendo uma **decisão de negócio obrigatória** antes do desenvolvimento. O produto não deve tentar atender escola, clínica, consultoria, imobiliária e serviços simultaneamente no primeiro release.
- Para planejamento e prototipação, adota-se como jornada de referência provisória: **lead → conversa WhatsApp → qualificação → oportunidade → proposta → venda**.
- O MVP recomendado será limitado a uma organização, uma unidade operacional inicial, um canal prioritário de WhatsApp oficial e uma operação comercial simples.
- Ficam fora do MVP: telefonia, discador, IA generativa, white-label completo, campanhas multicanal, comissões avançadas, entrega/capacidade, BI avançado e aplicativo mobile dedicado.
- A inclusão de qualquer módulo fora desse recorte exige decisão formal de escopo, impacto, dependências e capacidade.

### A.1.2 Fases e priorização

A coluna **Prioridade** das tabelas anteriores deixa de ser usada para misturar urgência e fase. A classificação oficial passa a ser **uma única fase por requisito**:

| Fase | Significado | Critério |
|---|---|---|
| Now / MVP | Necessário para validar a jornada âncora | Sem ele, o fluxo lead–venda não funciona ou não é seguro |
| Next | Necessário para ampliar operação após validação | Aumenta escala, produtividade ou cobertura, mas não é indispensável ao primeiro fluxo |
| Later | Expansão ou sofisticação | Depende de volume, maturidade, dados ou integrações posteriores |
| Fora da versão | Não comprometer no ciclo atual | Deve ser reavaliado em planejamento futuro |

O produto só deve iniciar o desenvolvimento após confirmar: segmento, jornada, volume de usuários, volume de leads, provedor oficial de WhatsApp, regras de qualificação e critérios de sucesso.

### A.1.3 Mapa de fase do backlog existente

| Domínio | Now / MVP | Next | Later |
|---|---|---|---|
| Administração | ADM-001, ADM-002, ADM-004, ADM-005 | ADM-003 | ADM-006 |
| Acesso | ACE-001, ACE-002, ACE-003, ACE-005 | ACE-004 | MFA avançado/SSO, quando aplicável |
| CRM | CRM-001 a CRM-007 | — | — |
| Leads | LEAD-001, LEAD-002, LEAD-003, LEAD-005 | LEAD-004 | Roteamento avançado por capacidade/região |
| Funil | FUN-001, FUN-002, FUN-003, FUN-006 | FUN-004, FUN-005 | Funis avançados por múltiplas unidades |
| WhatsApp | CAN-001 somente WhatsApp oficial, CAN-002, CAN-003, CAN-004, CAN-005, CAN-006, CAN-007 | Outros canais e omnichannel completo | Orquestração multicanal avançada |
| Telefonia | — | TEL-001, TEL-003, TEL-007 | TEL-002, TEL-004, TEL-005, TEL-006 |
| Campanhas | — | CMP-002, CMP-003, CMP-004, CMP-005, CMP-006, CMP-007 | CMP-001 multicanal |
| Rotina | ROT-001, ROT-002 | ROT-003, ROT-004, ROT-005 | ROT-006 |
| Receita | REC-001, REC-002, REC-003, REC-004 | REC-008 | REC-005, REC-006, REC-007 |
| Gestão | GES-005, GES-006, GES-007 | GES-001, GES-002, GES-003, GES-004 | GES-008 |
| IA | — | IA-004, IA-005 | IA-001, IA-002, IA-003 |
| Integrações | INT-001, INT-007, INT-002 somente provedor WhatsApp | INT-004, INT-005 | INT-003, INT-006 |
| Privacidade | Todos os requisitos LGPD, auditoria e “Não Contatar” | — | — |

**Regra de consistência:** nenhum requisito deve ser simultaneamente Now, Next e Later. A priorização acima substitui os rótulos “MVP”, “Alta” e “Fase 2/Fase 3” usados anteriormente.

## A.2 Requisitos novos decorrentes da avaliação

### A.2.1 WhatsApp oficial e políticas de contato

| ID | Requisito | Fase |
|---|---|---|
| RF-WHA-001 | O sistema deve registrar o provedor oficial, conta, número, identificador externo e status de conexão do WhatsApp. | Now |
| RF-WHA-002 | O sistema deve controlar a janela de atendimento de 24 horas conforme regras vigentes do provedor, diferenciando mensagens iniciadas pelo cliente e pela empresa. | Now |
| RF-WHA-003 | Mensagens proativas fora da janela devem utilizar template aprovado e registrar template, versão, categoria e resultado do envio. | Now |
| RF-WHA-004 | O sistema deve registrar opt-in, origem, data, finalidade, canal e revogação de consentimento para contatos proativos. | Now |
| RF-WHA-005 | O sistema deve registrar custos e categoria da conversa quando disponibilizados pelo provedor. | Next |

### A.2.2 Qualificação, roteamento e SLA

| ID | Requisito | Fase |
|---|---|---|
| RF-QUA-001 | O sistema deve permitir definir critérios de qualificação e registrar respostas, pontuação, data, responsável e decisão lead → oportunidade. | Now |
| RF-ROT-007 | O sistema deve permitir regras de roteamento de conversas por fila, canal, horário, prioridade, equipe e capacidade. | Now |
| RF-SLA-001 | O sistema deve permitir configurar calendário de horário comercial, feriados e exceções por organização, unidade e fila. | Now |
| RF-SLA-002 | O sistema deve calcular SLA em horário útil e registrar início, pausa, retomada, vencimento e cumprimento. | Now |
| RF-SLA-003 | O sistema deve alertar e escalar conversas ou leads próximos do vencimento do SLA. | Next |

### A.2.3 Busca, notificações, API e migração

| ID | Requisito | Fase |
|---|---|---|
| RF-PLT-001 | O sistema deve oferecer busca global por pessoa, empresa, lead, oportunidade, conversa, proposta e venda, respeitando permissões. | Now |
| RF-PLT-002 | O sistema deve gerar notificações internas para atribuição, menção, vencimento, erro e mudança relevante de status. | Now |
| RF-API-001 | O sistema deve expor API versionada e autenticada para os recursos definidos no escopo do produto. | Next |
| RF-API-002 | O sistema deve oferecer webhooks configuráveis para eventos aprovados, com assinatura, retry e idempotência. | Next |
| RF-MIG-001 | O sistema deve executar importações por lote, com validação, prévia, relatório de erros, reprocessamento e rastreabilidade. | Now |
| RF-MIG-002 | O sistema deve registrar exportações por usuário, filtros, período, volume e finalidade. | Now |
| RF-CRM-008 | O sistema deve registrar fusões de duplicados, preservando origem, destino, usuário, data e campos incorporados. | Now |

### A.2.4 SaaS, planos e limites

| ID | Requisito | Fase |
|---|---|---|
| RF-SAA-001 | O sistema deve cadastrar planos, módulos habilitados, limites de uso e período de vigência da assinatura. | Next |
| RF-SAA-002 | O sistema deve bloquear ou alertar o uso de recursos conforme limites contratados, sem apagar dados. | Next |
| RF-SAA-003 | O sistema deve registrar consumo por organização, módulo, canal e período para medição do SaaS. | Next |

### A.2.5 Segurança e privacidade organizacional

| ID | Requisito | Fase |
|---|---|---|
| RF-SEC-001 | O sistema deve suportar MFA para perfis administrativos e permitir política de obrigatoriedade por organização. | Now |
| RF-SEC-002 | O sistema deve aplicar rate limiting, bloqueio progressivo e monitoramento de tentativas de autenticação. | Now |
| RF-SEC-003 | O sistema deve suportar integração SSO quando prevista no plano ou contrato. | Later |
| RF-LGP-006 | O sistema deve registrar o papel de controlador, operador e suboperador por organização e integração, conforme contrato e avaliação jurídica. | Now |
| RF-LGP-007 | O sistema deve manter processo de resposta a incidentes, registro de incidente e comunicação conforme política aprovada. | Now |
| RF-LGP-008 | O sistema deve suportar avaliação de impacto à proteção de dados (RIPD) como artefato de governança quando aplicável. | Next |

## A.3 Requisitos não funcionais verificáveis

Os requisitos abaixo substituem formulações abertas como “definir no levantamento”. Os números são metas iniciais e devem ser confirmados no estudo de volume; qualquer alteração deve ser registrada como decisão.

| ID | Categoria | Meta inicial verificável | Fase |
|---|---|---|---|
| RNF-016 | Performance | 95% das consultas de busca global e abertura de cadastro devem responder em até 2,5 s, excluindo indisponibilidade de provedor externo. | Now |
| RNF-017 | Performance | 95% do carregamento do dashboard operacional deve responder em até 4 s para uma organização com até 100 mil contatos. | Next |
| RNF-018 | Disponibilidade | Disponibilidade mensal mínima de 99,5% para a aplicação, excluindo janelas comunicadas com antecedência. | Now |
| RNF-019 | Recuperação | RPO máximo de 24 h e RTO máximo de 4 h para dados transacionais do MVP. | Now |
| RNF-020 | Acessibilidade | Interface web deve atender WCAG 2.1 nível AA para as jornadas Now. | Now |
| RNF-021 | Segurança | MFA obrigatório para administradores, rate limiting configurado e bloqueio progressivo após tentativas falhas. | Now |
| RNF-022 | Criptografia | Dados em trânsito devem usar TLS 1.2+; segredos e dados classificados como sensíveis devem ser criptografados em repouso. | Now |
| RNF-023 | Isolamento | Testes automatizados devem comprovar que uma organização não acessa dados de outra por UI, API, exportação, busca ou job. | Now |
| RNF-024 | Observabilidade | 99% das requisições e processamentos assíncronos devem possuir identificador de correlação e logs consultáveis. | Now |
| RNF-025 | Integrações | Eventos externos duplicados não devem criar fatos duplicados; a taxa de duplicação aceitável é zero em testes de idempotência. | Now |
| RNF-026 | Migração | Cada lote importado deve produzir relatório de sucesso, rejeição, motivo e linha de origem. | Now |

Práticas como uso de ORM, biblioteca de CSRF ou padrão específico de código permanecem decisões técnicas e não são requisitos funcionais deste documento.

## A.4 Critérios de aceite dos requisitos críticos

### Distribuição de lead

- Dado um lead elegível e uma regra ativa, quando o lead for criado, então deve ser atribuído a exatamente um responsável ou enviado a uma fila de exceção.
- A atribuição deve registrar regra aplicada, data/hora, usuário/sistema e equipe.
- Se não houver capacidade, o lead não pode desaparecer: deve permanecer em fila com motivo visível.

### Qualificação lead → oportunidade

- O sistema deve exigir os critérios configurados antes da conversão.
- A conversão deve preservar `cd_lead`, respostas de qualificação e usuário responsável.
- O sistema deve impedir duas oportunidades acidentalmente duplicadas para o mesmo ciclo sem alerta explícito.

### Janela e template do WhatsApp

- Mensagem iniciada pela empresa fora da janela deve exigir template aprovado.
- Mensagem sem opt-in válido deve ser bloqueada ou encaminhada para fluxo de regularização.
- A tentativa deve registrar motivo de bloqueio, sem falhar silenciosamente.

### “Não Contatar”

- Ao marcar um titular como “Não Contatar”, novas ações automáticas devem ser bloqueadas.
- Campanhas e filas devem excluir o titular antes do disparo.
- A exceção manual, se permitida juridicamente, deve exigir justificativa e auditoria.

### SLA

- O cálculo deve ignorar fins de semana, feriados e períodos fora do horário configurado.
- Pausas e transferências devem permanecer no histórico.
- A tela deve exibir tempo restante, status e responsável atual.

## A.5 KPIs: baseline e metas

Antes de medir evolução, o levantamento deverá coletar uma linha de base por pelo menos duas semanas ou pelo período disponível. As metas abaixo são hipóteses iniciais, não compromissos comerciais:

| KPI | Baseline | Meta inicial após 90 dias | Fonte |
|---|---|---|---|
| Tempo até primeiro contato | A medir | Redução de 30% | Lead + primeira mensagem |
| Leads dentro do SLA | A medir | ≥ 90% | Lead + SLA |
| Conversão lead → oportunidade | A medir | Aumento de 15% relativo | Lead + oportunidade |
| Conversão oportunidade → venda | A medir | Aumento de 10% relativo | Oportunidade + venda |
| Conversas sem resposta no SLA | A medir | < 5% | Conversa + SLA |
| Uso de planilhas paralelas | A medir | Redução de 50% | Entrevistas e auditoria |

## A.6 Stakeholders, dependências e riscos do projeto

### Stakeholders

- Patrocinador/empresário: objetivo de receita e decisão de escopo;
- Gestor comercial: regras de funil, distribuição, metas e operação;
- Vendedor/SDR: usabilidade, rotina, scripts e atendimento real;
- Atendimento/CS: filas, SLA e pós-venda;
- Financeiro: venda, pagamento e comissão;
- Jurídico/DPO: LGPD, WhatsApp, telemarketing, gravação e contratos;
- Tecnologia/arquitetura: integrações, segurança, escalabilidade e operação;
- Marketing: origem, campanhas e consentimento.

### Dependências externas

- Provedor oficial de WhatsApp e aprovação de templates;
- Provedor de identidade/e-mail;
- Serviço de armazenamento de arquivos;
- Definição jurídica de controlador/operador;
- Dados legados e qualidade das fontes de migração;
- Definição de calendário comercial, feriados e horários;
- Disponibilidade de APIs e limites dos provedores.

### Riscos e respostas

| Risco | Impacto | Resposta |
|---|---|---|
| MVP genérico demais | Alto | Escolher segmento e jornada âncora antes do backlog |
| Dependência de provedor WhatsApp | Alto | Spike técnico e validação de regras/custos no início |
| Dados legados ruins | Alto | Perfilamento, lote piloto, relatório de erros e plano de saneamento |
| Regras de qualificação indefinidas | Alto | Workshop com gestor e vendedores; versionar critérios |
| Vazamento entre tenants | Crítico | Testes negativos, isolamento por tenant e revisão de segurança |
| Escopo de IA/telefonia antecipado | Alto | Manter Later até validar jornada principal |
| Meta sem baseline | Médio | Instrumentar eventos antes de prometer ganhos |

## A.7 Checklist de decisão antes do desenvolvimento

- [ ] Segmento âncora escolhido.
- [ ] Jornada e persona prioritárias validadas.
- [ ] Provedor oficial de WhatsApp escolhido.
- [ ] Regras de opt-in, templates e janela validadas pelo jurídico.
- [ ] Critérios de qualificação definidos.
- [ ] Regras de roteamento e SLA definidas.
- [ ] Volume de dados e usuários estimado.
- [ ] Dados legados identificados e amostra recebida.
- [ ] Controlador, operador e suboperadores definidos contratualmente.
- [ ] Métricas de baseline coletadas.
- [ ] Backlog Now aprovado sem itens Next/Later escondidos.
