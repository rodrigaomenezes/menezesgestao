# Plataforma de Operações Comerciais — especificação white-label

Oct 7, 2026 · @Rodrigo Menezes

## Visão geral

A plataforma é um sistema único para pequenas e médias empresas que vendem por WhatsApp e telefone: agenda da equipe, CRM com funil, conversas, telefonia, fila de ligações, metas e qualidade, num só lugar. Nasceu da operação real de uma escola de idiomas e aqui está descrita sem marca, sem regras daquela empresa e pronta para ser configurada para outros negócios (escolas, clínicas, imobiliárias, prestadores de serviço, varejo com venda consultiva).

**Problema que resolve:** a equipe comercial usa 5 a 8 ferramentas soltas (CRM, WhatsApp, planilhas de ligação, agenda, controle de horas, metas). O gestor não vê o que acontece e o vendedor perde tempo trocando de tela. A plataforma junta tudo e registra cada contato com o cliente automaticamente.

**Princípios do produto:**

- **Configurável, não programável:** cada empresa ajusta nomes, etapas, campos, bases, metas e módulos pela tela de administração, sem código.
- **Modular:** cada módulo liga e desliga por empresa e por plano; o núcleo funciona sozinho.
- **Multiempresa desde o início:** um servidor atende várias empresas, com dados totalmente isolados.
- **Provedores trocáveis:** WhatsApp, telefonia, avisos, armazenamento e IA ficam atrás de interfaces; trocar de fornecedor não muda o sistema.
- **Registro automático:** toda mensagem, ligação e mudança no funil vira histórico e indicador sem o vendedor digitar nada.
- **Celular primeiro:** funciona no navegador e como app instalável (PWA) no Android, iPhone e computador.
- **Português claro na tela:** textos curtos, sem jargão técnico, pensados para quem não é de tecnologia.

## Perfis e permissões

O sistema trabalha com **perfis-base** que cada empresa pode renomear, copiar e ajustar. A permissão é sempre por **módulo × ação** (ver, criar, editar, excluir/arquivar, exportar, administrar) e por **escopo de dados** (só o que é meu, da minha equipe, de toda a unidade, de toda a empresa).

| Perfil-base | Para quem | Escopo padrão |
| --- | --- | --- |
| **Dono / Administrador** | Quem contrata e configura a plataforma | Toda a empresa, inclusive configurações, faturamento e auditoria |
| **Gestor** | Coordenação comercial ou de operação | Equipe(s) que coordena; aprova horas, metas e redistribui carteira |
| **Vendedor / Atendente** | Linha de frente: funil, conversas, ligações | Só os próprios contatos e os da fila que pegou |
| **Operação / Prestador** | Quem executa o serviço vendido (professor, técnico, consultor) | Própria agenda, próprias turmas/atendimentos |
| **Financeiro** | Conferência de vendas, comissões e horas | Leitura ampla; edição só em vendas, comissões e fechamento |

### Matriz padrão de acesso por módulo

Legenda: **A** administra · **E** edita · **V** vê · **P** só o próprio · — sem acesso.

| Módulo | Dono | Gestor | Vendedor | Operação | Financeiro |
| --- | --- | --- | --- | --- | --- |
| Usuários e permissões | A | V | — | — | — |
| Configurações da empresa / marca | A | — | — | — | — |
| CRM e funil | A | E | P | — | V |
| Conversas (WhatsApp) | A | E | P | — | — |
| Central de telefonia | A | E | P | — | — |
| Fila de ligações | A | E | P | — | — |
| Agenda, escala e horas | A | E | P | P | V |
| Rotina diária / tarefas | A | E | P | P | — |
| Desempenho e metas | A | E | P | P | V |
| Mapa de atividades | A | E | P | P | — |
| Biblioteca de scripts | A | E | V | V | — |
| Monitoramento de qualidade | A | E | P | — | — |
| Vendas e comissões | A | E | P | — | E |
| Turmas / serviços | A | E | V | P | V |
| Pesquisa de mercado | A | E | V | — | — |
| Auditoria e relatórios | A | V | — | — | V |

### Regras gerais

- **Nada some:** excluir é sempre arquivar (lixeira com restauração). Exclusão definitiva só para o administrador, com confirmação e registro na auditoria.
- **Dono do registro:** todo contato, conversa e ligação tem um responsável. Transferir carteira é uma ação explícita do gestor e fica registrada.
- **Permissão no servidor:** a interface esconde o que o perfil não pode fazer, mas a checagem que vale é a da API.
- **Perfis personalizados:** a empresa pode criar perfis novos (ex.: "SDR", "Supervisor de unidade") partindo de um perfil-base.

## Catálogo de módulos

Cada módulo pode ser ligado ou desligado por empresa (e por plano). O **núcleo** é obrigatório; o resto é opcional. Abaixo, o que cada um faz e o que não pode faltar.

### Núcleo (obrigatório)

- **Empresas e unidades:** cadastro da empresa, filiais/unidades, fuso horário, feriados, horário comercial.
- **Usuários, perfis e equipes:** convite por e-mail, login com senha forte, recuperação de acesso, sessões por dispositivo, equipes com gestor.
- **Notificações:** sino dentro do sistema, avisos em tempo real (SSE ou WebSocket) e push no celular quando o usuário está fora.
- **Auditoria:** quem fez o quê, quando e de onde, em todo módulo.
- **Importação e exportação:** planilhas (CSV/XLSX) com pré-visualização, mapeamento de colunas e relatório do que entra, do que atualiza e do que é ignorado.

### CRM e funil de vendas

- Contatos (pessoa e empresa), com **telefone normalizado como chave única** (DDI + DDD + número, tratando o nono dígito) para nunca duplicar.
- **Funis configuráveis:** a empresa cria quantos funis quiser, com etapas, cores, motivos de perda e campos obrigatórios por etapa.
- Visão **kanban** (arrastar entre etapas) e **lista** (filtros, busca, ações em massa).
- Tarefas e lembretes ligados ao contato; histórico único (conversas, ligações, notas, mudanças de etapa).
- **Carteira:** cada contato tem um responsável; o gestor redistribui.
- Etiquetas, campos personalizados e origem do lead.
- **Arquivar e lixeira:** cadastro errado sai da visão sem apagar o histórico; restauração em um clique.

### Conversas (WhatsApp e outros canais)

- Conectores trocáveis: **API oficial** (Cloud API), **conexão por QR code** (para empresas pequenas) e **modo demonstração** sem número real.
- Caixa de entrada por usuário e por equipe, com atribuição, transferência e status (aberta, aguardando, resolvida).
- Texto, imagem, documento e **áudio com controle de velocidade**; gravação de áudio no navegador.
- **Notas internas** que o cliente não vê.
- **Respostas rápidas** com variáveis (`{nome}`, `{produto}`, `{vendedor}`) e **mensagens automáticas** (boas-vindas, fora do horário, follow-up).
- **Deduplicação de conversa:** a resposta do cliente sempre cai na mesma conversa, mesmo que o canal mude o identificador (com/sem nono dígito, IDs internos do provedor). Rotina de junção para duplicadas antigas.

### Central de telefonia

- Ligações pelo navegador (**VoIP/SIP via WebRTC**), pelo **celular do vendedor** (abre o discador e registra) e **modo treino** sem custo.
- Estados da chamada: criada, discando, tocando, em ligação, em espera, encerrada; mudo, espera, DTMF.
- Registro automático no histórico do contato, com duração e resultado.
- **Gravação opcional, criptografada**, com aviso ao cliente e acesso registrado.
- Clique para ligar a partir do funil, das conversas e da fila.

### Fila de ligações (discagem ativa)

- **Várias filas**, cada uma com nome, tipo de base (configurável pela empresa) e status ativa/pausada/encerrada.
- Cada importação pode criar uma fila nova ou alimentar uma existente; o relatório separa novos, atualizados, já em outra fila e já ligados.
- **Reserva exclusiva:** o vendedor pega o próximo lead e ninguém mais liga para ele ao mesmo tempo; reserva expira sozinha.
- Resultados padronizados (atendeu, não atendeu, número errado, retornar em…, convertido) com reagendamento automático.
- Conversão direta para o funil.

### Agenda, escala e horas

- Escala de trabalho por pessoa e unidade; registro de horas (entrada/saída ou por atividade).
- **Validação pelo gestor** e fechamento do período para o financeiro.
- Agenda de compromissos com o cliente (visitas, aulas experimentais, reuniões).

### Rotina diária

- Lista do dia de cada pessoa: tarefas vencidas, retornos agendados, conversas sem resposta, metas do dia.
- Check-list configurável por perfil (ex.: "abrir caixa de entrada", "40 ligações").

### Desempenho e metas

- Metas por pessoa, equipe e período (ligações, conversas, vendas, valor).
- Painel com ranking, funil de conversão e evolução; tudo calculado do registro automático, sem digitação.

### Mapa de atividades

- Linha do tempo/heatmap do que cada pessoa fez em cada hora do dia, a partir dos eventos do sistema e de lançamentos manuais.
- Lançamentos manuais podem ser corrigidos ou removidos por quem lançou ou pelo gestor.

### Biblioteca de scripts

- Roteiros de abordagem, objeções e respostas, organizados por produto e etapa.
- Acesso rápido de dentro da conversa e da ligação.

### Monitoramento de qualidade

- Gestor avalia conversas e ligações com critérios configuráveis (nota por item) e devolve feedback ao vendedor.

### Vendas e comissões

- Registro da venda ligado ao contato e ao produto/serviço, com valor, forma de pagamento e status.
- Regras de comissão configuráveis (percentual, faixa, por produto) e fechamento mensal.

### Serviços, turmas e entregas

- Catálogo de produtos/serviços da empresa; para quem vende capacidade (turmas, vagas, agenda), controle de ocupação e de quem executa.
- O vocabulário muda por segmento: "turma" numa escola, "projeto" numa consultoria, "agenda" numa clínica.

### Pesquisa de mercado

- Questionários simples para clientes e leads, com link público e resultados agregados.

### App no celular (PWA)

- Instalável em Android e iOS pela tela inicial, sem loja.
- Push de novas mensagens, ligações e tarefas; leitura offline dos dados recentes, com cache limpo a cada login/logout.

## Arquitetura

&#91;embedded content: arquitetura em camadas · clientes, API, provedores, dados\]

A regra que sustenta o produto: **nenhum módulo conhece o fornecedor**. O módulo de conversas chama `mensagens.enviar()`, não a API de um provedor específico; a central chama `telefonia.discar()`. Trocar de fornecedor ou atender um cliente com outro contrato é escrever um provedor novo, sem tocar no núcleo.

### Pilha recomendada (ajustável)

| Camada | Escolha sugerida | Por quê |
| --- | --- | --- |
| Servidor | Node.js + TypeScript (Fastify ou NestJS) | Mesma linguagem no front e no back; bom ecossistema para WhatsApp, SIP e push |
| Banco | PostgreSQL (SQLite só para demonstração local) | Multiempresa com isolamento por linha, JSONB para campos personalizados |
| ORM e migrações | Prisma ou Drizzle | Migrações versionadas e reversíveis |
| Front-end | React + Vite, PWA | Componentes reaproveitáveis por módulo e tema por empresa |
| Tempo real | SSE (simples) ou WebSocket | Avisos de mensagem, ligação e fila sem recarregar a tela |
| Tarefas agendadas | Fila de jobs (BullMQ ou pg-boss) | Lembretes, mensagens automáticas, expiração de reservas |
| Arquivos | Disco local ou S3 compatível | Interface única; criptografia antes de gravar |
| Testes | Vitest + Playwright | Unidade por serviço e fluxo ponta a ponta no navegador e no celular |

### Interfaces de provedor

| Interface | Operações mínimas | Implementações iniciais |
| --- | --- | --- |
| **Mensagens** | conectar, status, enviar (texto, mídia, áudio), receber (webhook ou socket), normalizar identificador | API oficial, conexão por QR, demonstração |
| **Telefonia** | recursos, pronto, sessão, discar, desligar, espera, mudo, DTMF, eventos de estado | SIP/WebRTC, celular do vendedor, treino |
| **Avisos** | inscrever dispositivo, enviar, remover inscrição inválida | Web Push (VAPID), e-mail (SMTP) |
| **Arquivos** | gravar, ler, apagar, URL temporária | disco local, S3 |

Cada provedor declara seus **recursos** (ex.: "gravação", "espera", "mídia"), e a interface só mostra o botão quando o recurso existe. Todo provedor tem uma versão **de demonstração** que funciona sem conta, para testes automáticos e para apresentar o sistema a um cliente novo.

### Eventos internos

Toda ação relevante publica um evento (`contato.criado`, `conversa.mensagem_recebida`, `ligacao.encerrada`, `fila.lead_reservado`…). Os eventos alimentam ao mesmo tempo o histórico do contato, o mapa de atividades, as metas, o tempo real e as automações. É isso que garante o princípio de **registro automático**: ninguém digita o que o sistema já sabe.

## Customização e multiempresa

O que diferencia uma empresa da outra fica em **configuração**, nunca em código. Se uma demanda de cliente exige `if (empresa === "X")`, ela vira uma opção configurável ou um módulo novo.

### Isolamento entre empresas

- Toda tabela de negócio tem `empresa_id`; toda consulta passa por uma camada que injeta o filtro (e, no PostgreSQL, **Row Level Security** como segunda barreira).
- Um usuário pode pertencer a mais de uma empresa (ex.: consultor que atende várias), com perfil diferente em cada uma, e troca de empresa sem sair.
- Identificadores públicos são opacos (UUID), para que ninguém adivinhe registros de outra empresa.
- Modo **instância dedicada** (um banco por cliente) para quem exige isolamento físico, usando o mesmo código.

### Marca (white-label)

| Item | Configurável por empresa |
| --- | --- |
| Nome do produto | Exibido no topo, na aba do navegador, no app instalado e nos e-mails |
| Logo e ícone | Logo claro/escuro, ícone do PWA (gerado em todos os tamanhos), favicon |
| Cores | Cor primária e de destaque; o tema claro/escuro deriva delas com contraste verificado |
| Domínio | Subdomínio (`empresa.seuproduto.com`) ou domínio próprio com HTTPS automático |
| Remetentes | Nome e e-mail de envio, assinatura das mensagens automáticas |
| Textos legais | Termos de uso, política de privacidade, aviso de gravação de ligação |

### Vocabulário

Cada segmento chama as coisas de um jeito. Um **dicionário por empresa** troca os rótulos da interface sem mudar o modelo de dados:

| Conceito interno | Escola / cursos | Clínica | Consultoria | Varejo B2B |
| --- | --- | --- | --- | --- |
| contato | aluno / interessado | paciente | cliente | comprador |
| oferta | curso | procedimento | projeto | produto |
| entrega | turma | consulta | sessão | pedido |
| prestador | professor | profissional | consultor | representante |

### Estrutura configurável

- **Funis e etapas:** quantos funis quiser, etapas com cor, ordem, probabilidade, campos obrigatórios e motivos de perda.
- **Tipos de base da fila:** a empresa define as categorias (no lugar de valores fixos) e cada fila escolhe uma.
- **Campos personalizados:** texto, número, data, lista, sim/não, em contato, empresa, venda e entrega; aparecem em formulários, filtros, importação e variáveis de mensagem.
- **Resultados de ligação e motivos:** listas editáveis com ação associada (reagendar em X horas, mover etapa, encerrar).
- **Regras de comissão e metas:** fórmulas simples montadas na tela.
- **Automações:** "quando \[evento\] e \[condição\], então \[ação\]" (enviar mensagem, criar tarefa, mover etapa, avisar gestor).

### Módulos por plano

| Plano | Módulos incluídos |
| --- | --- |
| **Essencial** | Núcleo, CRM e funil, rotina diária, app no celular |
| **Comercial** | Essencial + conversas, fila de ligações, respostas rápidas, desempenho e metas |
| **Completo** | Comercial + central de telefonia, monitoramento de qualidade, vendas e comissões, agenda e horas, mapa de atividades |
| **Sob medida** | Qualquer combinação + instância dedicada e integrações específicas |

Ligar ou desligar um módulo esconde menus, rotas e permissões dele, mas **não apaga dados**: religar traz tudo de volta.

### Primeiro acesso (onboarding)

Um assistente de configuração em 5 passos: dados da empresa e marca → segmento (pré-carrega vocabulário, funil e resultados típicos) → convidar equipe → conectar canais (ou usar demonstração) → importar contatos. Ao final, a empresa já tem um funil funcionando e dados de exemplo que podem ser apagados com um clique.

## Modelo de dados

Entidades principais, agrupadas por módulo. Todas têm `id` (UUID), `empresa_id`, `criado_em`, `atualizado_em` e, quando fizer sentido, `arquivado_em` (lixeira) e `criado_por`.

| Grupo | Entidade | Campos-chave e regras |
| --- | --- | --- |
| Núcleo | `empresa` | nome, marca (JSON), domínio, fuso, plano, módulos ativos, vocabulário (JSON) |
| Núcleo | `unidade` | empresa, nome, endereço, horário comercial |
| Núcleo | `usuario` / `vinculo` | usuário global; vínculo = usuário × empresa × perfil × unidade × equipe |
| Núcleo | `perfil` / `permissao` | perfil-base ou personalizado; permissão = módulo × ação × escopo |
| Núcleo | `campo_personalizado` | entidade-alvo, tipo, opções, obrigatório; valores em JSONB na entidade |
| Núcleo | `evento` | tipo, ator, entidade, dados; **só inserção** — base de histórico, mapa e metas |
| Núcleo | `auditoria` | quem, o quê, antes/depois, IP, dispositivo |
| Núcleo | `dispositivo_push` | usuário, endpoint, chaves, tipo (celular/computador), último uso |
| CRM | `contato` | nome, telefone normalizado (**único por empresa**), e-mail, responsável, origem, etiquetas, campos |
| CRM | `funil` / `etapa` | ordem, cor, probabilidade, campos obrigatórios |
| CRM | `oportunidade` | contato, funil, etapa, valor, oferta, responsável, motivo de perda |
| CRM | `tarefa` | contato/oportunidade, responsável, vencimento, concluída |
| CRM | `nota` | texto, autor, contato |
| Conversas | `canal` | provedor, credenciais **criptografadas**, status de conexão |
| Conversas | `conversa` | canal, contato, identificadores externos (lista), atribuída a, status |
| Conversas | `mensagem` | direção, tipo, conteúdo, mídia, status de entrega, id externo (**único por canal**) |
| Conversas | `resposta_rapida` / `automacao` | atalho, texto com variáveis; gatilho, condição, ação |
| Telefonia | `ligacao` | contato, usuário, provedor, direção, estado, início, fim, duração, resultado |
| Telefonia | `ligacao_evento` / `gravacao` | mudanças de estado; arquivo criptografado, quem acessou |
| Fila | `fila` | nome, tipo de base, status (ativa/pausada/encerrada) |
| Fila | `fila_lote` | fila, arquivo de origem, contagens do relatório de importação |
| Fila | `fila_item` | fila, contato, prioridade, ordem, reservado por/até, tentativas, resultado, retornar em |
| Operação | `escala` / `registro_horas` | pessoa, período, horas, validado por, fechamento |
| Operação | `atividade_manual` | pessoa, início, fim, tipo (alimenta o mapa de atividades) |
| Operação | `meta` | alvo (pessoa/equipe), indicador, período, valor |
| Operação | `script` / `avaliacao` | roteiro por oferta e etapa; avaliação de qualidade com notas por critério |
| Vendas | `oferta` / `entrega` | catálogo; turma/agenda/projeto com capacidade e prestador |
| Vendas | `venda` / `comissao` | contato, oferta, valor, pagamento, status; regra, base, valor, período |
| Pesquisa | `pesquisa` / `resposta` | perguntas (JSON), link público; respostas |

### Regras de integridade que não podem faltar

- **Telefone normalizado** é a chave de deduplicação em contato, conversa e fila: E.164, com regra do nono dígito brasileiro e de identificadores alternativos do provedor de mensagens.
- `mensagem.id_externo` único por canal: webhook repetido não duplica mensagem.
- Um `fila_item` só pode estar reservado para um usuário por vez (trava no banco, não só na tela).
- Arquivar nunca apaga filhos; restaurar devolve tudo como estava.
- Migrações sempre **aditivas e idempotentes** em produção; remoção de coluna só em duas etapas (deixar de usar → remover numa versão seguinte).

## Segurança, LGPD e auditoria

### Acesso

- Senhas com hash forte (Argon2id ou bcrypt), política mínima de tamanho, bloqueio progressivo após tentativas erradas.
- **Verificação em duas etapas** opcional (obrigatória para administradores no plano Completo).
- Sessões em cookie `HttpOnly`, `Secure`, `SameSite`; lista de dispositivos conectados com opção de encerrar cada um.
- Proteção CSRF, cabeçalhos de segurança (CSP, HSTS), limite de requisições por usuário e por IP.
- Permissão checada **no servidor** em toda rota, com testes automáticos que tentam acessar dados de outra empresa e de outro vendedor.

### Segredos e criptografia

- Credenciais de canais (WhatsApp, SIP, chaves de push) gravadas **criptografadas** no banco (AES-256-GCM), com a chave-mestra só em variável de ambiente.
- Nenhuma senha, token ou chave em código, log ou mensagem de erro.
- Gravações de ligação e anexos criptografados em repouso; acesso por URL temporária e registrado.
- HTTPS obrigatório, inclusive nos webhooks (com verificação de assinatura do provedor).

### LGPD

| Exigência | Como o sistema atende |
| --- | --- |
| Base legal e finalidade | Campo de origem e consentimento no contato; registro de quando e como foi coletado |
| Direito de acesso | Exportação dos dados de um titular em um clique (JSON/PDF) |
| Correção | Edição com histórico na auditoria |
| Eliminação | **Anonimização** do titular (mantém números agregados, remove dados pessoais), distinta do arquivar |
| Oposição / descadastro | Marca "não contatar" que bloqueia fila, mensagens automáticas e discagem |
| Gravação de ligação | Aviso configurável no início da chamada; retenção com prazo definido pela empresa |
| Retenção | Prazos por tipo de dado (ex.: gravações 90 dias, leads perdidos 2 anos) com limpeza automática |
| Operador × controlador | A empresa cliente é a controladora; o produto é operador — contrato e política deixam isso claro |
| Incidentes | Registro de incidentes e contato do encarregado (DPO) configurável |

### Auditoria

- Toda criação, edição, arquivamento, exclusão, exportação, login e acesso a gravação gera um registro com ator, data, IP, dispositivo e valores antes/depois.
- Registros de auditoria são **somente inserção** e não podem ser editados nem pelo administrador.
- Tela de auditoria com filtros por pessoa, módulo, período e tipo de ação; exportação para o financeiro e o jurídico.

### Operação

- Backup automático diário com teste de restauração mensal; retenção de 30 dias.
- Logs estruturados sem dados pessoais; monitoramento de erros e de saúde dos canais (WhatsApp desconectado avisa o administrador).
- Ambientes separados (desenvolvimento, homologação, produção) e implantação só com testes passando.

## Roteiro de construção

Cada fase entrega algo usável e só termina quando os **critérios de pronto** passam. Não pule a fase 0: multiempresa e permissões colocadas depois custam o dobro.

| Fase | Entrega | Pronto quando… |
| --- | --- | --- |
| **0. Fundação** | Repositório, CI, ambientes, autenticação, empresas/unidades/usuários, perfis e permissões, auditoria, barramento de eventos, tempo real, tema e casca PWA | Teste automático prova que um usuário da empresa A não lê nada da B; deploy automático em homologação; login funciona no celular |
| **1. CRM** | Contatos com telefone normalizado, funis/etapas configuráveis, kanban e lista, tarefas, notas, etiquetas, campos personalizados, importação com pré-visualização, arquivar/lixeira | Importar a mesma planilha duas vezes não duplica ninguém; arrastar no kanban registra evento; restaurar da lixeira devolve histórico |
| **2. Conversas** | Interface de mensagens + provedor demonstração, QR e API oficial; caixa de entrada, atribuição, mídia e áudio, notas internas, respostas rápidas, mensagens automáticas | Resposta do cliente cai sempre na mesma conversa (com e sem nono dígito, IDs alternativos); webhook repetido não duplica; teste ponta a ponta no modo demonstração |
| **3. Ligações** | Interface de telefonia + provedores treino, celular e SIP/WebRTC; registro automático; gravação criptografada; filas de ligação com tipos de base, importação, reserva exclusiva e resultados | Dois vendedores clicando "próximo" ao mesmo tempo nunca recebem o mesmo lead; ligação encerrada aparece no histórico sem digitação |
| **4. Operação** | Rotina diária, agenda/escala/horas com validação, metas e painel de desempenho, mapa de atividades, biblioteca de scripts | Metas e mapa calculados só de eventos; fechamento de horas bloqueia edição do período |
| **5. Receita e qualidade** | Ofertas e entregas (turmas/agendas), vendas, regras de comissão, monitoramento de qualidade, pesquisa de mercado | Comissão do mês confere com cálculo manual de um caso de teste; venda vincula contato, oferta e vendedor |
| **6. White-label** | Marca, domínio, vocabulário, módulos por plano, automações configuráveis, assistente de primeiro acesso, cobrança | Uma empresa nova configura marca e segmento sozinha em menos de 15 minutos; nenhum nome de cliente aparece no código |
| **7. Endurecimento** | LGPD (exportar, anonimizar, não contatar, retenção), duas etapas, backups testados, observabilidade, push e offline no celular | Checklist de qualidade (seção final) 100% marcado; restauração de backup testada |

Sugestão de ritmo: fases 0 a 2 formam o **produto mínimo vendável** (CRM + WhatsApp). As fases seguintes podem ser vendidas como módulos adicionais à medida que ficam prontas.

## Prompt principal

Cole o bloco abaixo como **primeira mensagem** de uma sessão nova do Claude Code (num repositório vazio). Junto, anexe ou cole este documento inteiro: o prompt se refere a ele como "a especificação". Troque os campos entre colchetes.

```text
Você vai construir, do zero, uma plataforma SaaS white-label de operações comerciais
(CRM + WhatsApp + telefonia + fila de ligações + rotina e desempenho da equipe),
em português do Brasil, para ser vendida a várias empresas de segmentos diferentes.
A especificação completa está no documento anexo; ela é a fonte da verdade.

Nome provisório do produto: [NOME DO PRODUTO]
Primeiro cliente-piloto (só para dados de exemplo, nunca no código): [SEGMENTO]
Hospedagem alvo: [Railway | Render | Fly.io | VPS com Docker]

PRINCÍPIOS INEGOCIÁVEIS
1. Multiempresa desde a primeira linha: empresa_id em toda tabela de negócio,
   filtro injetado numa camada única e Row Level Security no PostgreSQL.
2. Nada de regra específica de cliente no código. Diferenças entre empresas =
   configuração (marca, vocabulário, funis, campos, resultados, módulos por plano).
3. Fornecedores atrás de interfaces (mensagens, telefonia, avisos, arquivos).
   Todo provedor tem uma versão de demonstração que funciona sem conta externa.
4. Registro automático: toda ação publica um evento; histórico, metas, mapa de
   atividades e tempo real são derivados dos eventos. Ninguém digita o que o
   sistema já sabe.
5. Nada some: excluir = arquivar com lixeira; exclusão definitiva só por
   administrador, com auditoria. Migrações aditivas e idempotentes.
6. Telefone normalizado (E.164, regra do nono dígito) é a chave de deduplicação
   em contatos, conversas e filas. Webhook repetido nunca duplica nada.
7. Celular primeiro: toda tela funciona em 360 px; app instalável (PWA) com push.
8. Segurança: permissão checada no servidor em toda rota; segredos só em variáveis
   de ambiente ou criptografados (AES-256-GCM) no banco; nunca em código ou log.
9. Interface em português claro, sem jargão técnico; mensagens de erro dizem o
   que a pessoa pode fazer.

PILHA
Node.js + TypeScript, Fastify (ou NestJS), PostgreSQL com Prisma ou Drizzle,
React + Vite como PWA, SSE para tempo real, fila de jobs (pg-boss ou BullMQ),
Vitest para unidade e Playwright para ponta a ponta (desktop e celular).
Se tiver um motivo forte para mudar algo, proponha antes de mudar.

COMO TRABALHAR
- Siga o roteiro de fases da especificação, uma fase por vez, na ordem.
- No início de cada fase: liste o que vai construir, as tabelas novas, as rotas e
  os testes que provam os critérios de pronto. Espere meu ok.
- Durante a fase: commits pequenos e descritivos; testes junto com o código.
- No fim da fase: rode lint, typecheck e todos os testes; mostre o resultado;
  atualize o README (como rodar, variáveis de ambiente, decisões tomadas) e um
  arquivo ROADMAP.md com o que ficou para depois.
- Nunca me peça senhas ou tokens no chat: diga qual variável de ambiente criar.
- Se algo da especificação for ambíguo, escolha o padrão mais simples, siga e
  anote a decisão; só pergunte quando a escolha mudar o modelo de dados.
- Antes de declarar uma fase pronta, releia o próprio diff procurando: vazamento
  entre empresas, rota sem checagem de permissão, duplicação por telefone,
  texto em inglês na interface e tela quebrada no celular.

COMECE PELA FASE 0 (Fundação): monte o repositório, CI, autenticação,
empresas/unidades/usuários, perfis e permissões por módulo × ação × escopo,
auditoria, barramento de eventos, tempo real, tema configurável por empresa e a
casca PWA. Inclua um script de dados de exemplo com duas empresas fictícias de
segmentos diferentes e um teste que prove que uma não enxerga a outra.
Apresente primeiro o plano da fase 0.
```

**Dica:** se a sessão ficar longa, abra uma nova para cada fase colando o prompt principal + o prompt da fase (próxima seção) + o README atualizado. O README passa a ser a memória do projeto.

## Prompts por fase e checklist de qualidade

Use um destes ao iniciar cada fase (depois do prompt principal, ou numa sessão nova junto com o README).

**Fase 1 — CRM**

```text
Fase 1 (CRM). Construa: contatos (pessoa/empresa) com telefone normalizado E.164 e
único por empresa; funis e etapas configuráveis (cor, ordem, probabilidade, campos
obrigatórios, motivos de perda); visão kanban com arrastar e visão lista com
filtros e ações em massa; tarefas, notas, etiquetas e campos personalizados;
importação CSV/XLSX com mapeamento de colunas, pré-visualização e relatório
(novos, atualizados, ignorados); carteira com responsável e transferência pelo
gestor; arquivar e lixeira com restauração. Tudo publica eventos. Testes: importar
a mesma planilha duas vezes não duplica; vendedor não vê carteira alheia.
```

**Fase 2 — Conversas**

```text
Fase 2 (Conversas). Crie a interface MessagingProvider (conectar, status, enviar
texto/mídia/áudio, receber, normalizar identificador, recursos) e três provedores:
demonstração (simula um celular, para testes), conexão por QR e API oficial do
WhatsApp (Cloud API, com verificação de assinatura do webhook). Caixa de entrada
por usuário/equipe com atribuição e status; áudio com controle de velocidade e
gravação no navegador; notas internas; respostas rápidas com variáveis;
mensagens automáticas (boas-vindas, fora do horário, follow-up). Busca de conversa
em cascata: id externo exato, ids alternativos do provedor, telefone com e sem
nono dígito, contato. Rotina que junta conversas duplicadas antigas. Testes: a
resposta de um contato novo cai na mesma conversa; webhook repetido não duplica.
```

**Fase 3 — Ligações e fila**

```text
Fase 3 (Ligações). Crie a interface PhoneProvider (id, nome, canal, recursos,
pronto, sessão, discar, desligar, espera, mudo, DTMF) com estados criada, discando,
tocando, em_ligacao, em_espera, encerrada, e três provedores: treino (simulado),
celular do vendedor (abre o discador e registra ao voltar) e SIP/WebRTC (JsSIP ou
SIP.js). Registro automático no histórico; gravação opcional criptografada com
aviso e acesso auditado; clique para ligar no funil, nas conversas e na fila.
Filas de ligação: várias filas com nome, tipo de base configurável e status
ativa/pausada/encerrada; importação que cria ou alimenta fila com relatório
(novos, atualizados, em outra fila, já ligados); reserva exclusiva com expiração
(trava no banco); resultados configuráveis com reagendamento; conversão para o
funil. Teste de concorrência: 20 pedidos simultâneos de próximo lead nunca
entregam o mesmo item a duas pessoas.
```

**Fase 4 — Operação**

```text
Fase 4 (Operação). Rotina diária por pessoa (tarefas vencidas, retornos, conversas
sem resposta, check-list por perfil); escala e registro de horas com validação do
gestor e fechamento de período; agenda de compromissos; metas por pessoa/equipe e
painel de desempenho calculado só dos eventos; mapa de atividades por hora
(eventos + lançamentos manuais corrigíveis); biblioteca de scripts por oferta e
etapa, acessível de dentro da conversa e da ligação.
```

**Fase 5 — Receita e qualidade**

```text
Fase 5 (Receita e qualidade). Catálogo de ofertas; entregas com capacidade e
prestador (turma, agenda ou projeto, conforme o vocabulário da empresa); vendas
ligadas a contato, oferta e vendedor; regras de comissão configuráveis
(percentual, faixa, por oferta) com fechamento mensal para o financeiro;
monitoramento de qualidade com critérios e notas; pesquisas com link público.
```

**Fase 6 — White-label**

```text
Fase 6 (White-label). Marca por empresa (nome, logo claro/escuro, ícones do PWA
gerados, cores com contraste verificado, domínio próprio), dicionário de
vocabulário, módulos por plano (desligar esconde sem apagar), automações
"quando/se/então", assistente de primeiro acesso em 5 passos com pacotes por
segmento, cobrança recorrente via interface de pagamento. Prove com teste que duas
empresas com marcas e vocabulários diferentes rodam no mesmo deploy.
```

**Fase 7 — Endurecimento**

```text
Fase 7 (Endurecimento). LGPD: exportar dados do titular, anonimizar, marca "não
contatar" respeitada em fila/automações/discagem, prazos de retenção com limpeza
automática. Duas etapas no login. Backups diários com restauração testada.
Logs estruturados sem dados pessoais e alerta de canal desconectado. PWA: push
quando o usuário está fora (ligação só para celular), leitura offline dos dados
recentes com cache limpo no login/logout. Rode o checklist de qualidade inteiro.
```

### Checklist de qualidade (vale para toda entrega)

- [ ] Um usuário de outra empresa não consegue ler, editar nem listar nada desta (teste automático).
- [ ] Toda rota checa permissão e escopo no servidor.
- [ ] Nenhum nome de cliente, segredo ou URL fixa no código.
- [ ] Telefone duplicado não gera contato, conversa ou item de fila duplicado.
- [ ] Excluir arquiva; restaurar devolve tudo; exclusão definitiva fica na auditoria.
- [ ] Toda ação relevante gera evento e aparece no histórico sem digitação.
- [ ] Telas funcionam em 360 px, no modo escuro e com teclado.
- [ ] Textos da interface em português claro, respeitando o vocabulário da empresa.
- [ ] Provedores de demonstração permitem rodar todos os testes sem conta externa.
- [ ] Migrações aditivas e idempotentes; rodar duas vezes não quebra nada.
- [ ] Lint, typecheck, testes de unidade e ponta a ponta passando no CI.
- [ ] README e ROADMAP atualizados com decisões e variáveis de ambiente.

## Lições do sistema de origem

A revisão do sistema que deu origem a esta especificação (cerca de 15 mil linhas, 220 rotas, um servidor Express com SQLite e telas em JavaScript sem framework) mostrou o que funcionou e o que a versão nova deve fazer diferente desde o começo.

### O que manter

- **Interfaces de provedor com modo demonstração** (telefonia com treino/celular/SIP, WhatsApp com QR falso): permitiram testar tudo sem conta externa. Manter como regra.
- **Migrações aditivas e idempotentes** rodando a cada início: zero perda de dados em dezenas de deploys.
- **Telefone como chave única** na fila e no CRM: acabou com duplicação na importação.
- **Auditoria em middleware** e credenciais criptografadas (AES-256-GCM) no banco.
- **PWA com push só quando a pessoa está fora** e cache offline limpo no login/logout.

### O que fazer diferente

| Problema encontrado | Efeito | Na versão nova |
| --- | --- | --- |
| Arquivos de tela com 1 a 3 mil linhas e funções globais | Colisão de nomes entre scripts, mudança pequena exige revisão manual do arquivo inteiro | Front em componentes (React + TypeScript), um pacote por módulo, sem variáveis globais |
| Nenhum teste automatizado nem lint no repositório | Cada correção foi validada à mão; regressões só aparecem em produção | CI obrigatório desde a fase 0: lint, typecheck, unidade e ponta a ponta |
| Montagem de HTML por `innerHTML` em centenas de pontos | Risco de XSS sempre que um campo esquecer o escape | Renderização por componentes com escape automático; `innerHTML` proibido no lint |
| Segredo de sessão com valor padrão no código | Se a variável faltar em produção, as sessões ficam forjáveis | Servidor **não sobe** sem os segredos obrigatórios (validação de ambiente no início) |
| Cookie de sessão sem `Secure`/`SameSite` e sem limite de tentativas no login | Exposição a CSRF e a força bruta | Cookie `Secure` + `SameSite=Lax`, token CSRF, limite de tentativas por usuário e IP, cabeçalhos de segurança |
| Corpo JSON de até 15 MB em todas as rotas, mídia em base64 | Uso de memória alto e porta aberta para requisições gigantes | Limite pequeno no JSON; upload de arquivos por multipart ou URL assinada direto no armazenamento |
| Biblioteca de planilhas desatualizada e conector de WhatsApp em versão prévia | Vulnerabilidades conhecidas e quebras sem aviso | Dependências fixadas, verificação automática (Dependabot/Renovate + `npm audit` no CI) |
| Listas carregadas inteiras (consultas sem paginação, `SELECT *`) | Telas ficam lentas conforme a base cresce | Paginação por cursor em toda listagem, colunas explícitas, índices revisados por consulta |
| SQLite num único servidor, sessões no mesmo disco | Não escala horizontalmente; um disco perdido leva tudo | PostgreSQL gerenciado, sessões no banco ou Redis, arquivos em armazenamento de objetos |
| Rotinas periódicas com `setInterval` dentro do servidor web | Com duas instâncias, a rotina roda duas vezes | Fila de jobs com trava (pg-boss/BullMQ) |
| Valores do negócio fixos no código (tipos de base da fila, funis, nomes de produtos, integrações de um fornecedor específico) | Cada empresa nova exigiria mexer no código | Tudo em configuração por empresa (seção de customização) |
| Módulo carregado dentro de `try/catch` para não derrubar o servidor | Falha silenciosa: a tela some sem aviso | Erros de inicialização derrubam o deploy (falha cedo) e aparecem no monitoramento |
| Registro de mudanças e pendências em arquivos soltos | Histórico de decisões disperso | `ROADMAP.md` + registro de decisões (ADR curto) por fase |

### Inclua no prompt principal

Acrescente esta linha ao bloco **PRINCÍPIOS INEGOCIÁVEIS** do prompt principal:

```text
10. Aprenda com o sistema de origem: sem variáveis globais no front, sem innerHTML,
    sem segredo com valor padrão, sem setInterval para rotinas, sem listagem sem
    paginação, sem JSON acima de 1 MB (arquivos vão por upload próprio) e sem
    módulo que falhe em silêncio.
```
