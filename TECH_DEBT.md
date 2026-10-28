# Dívida técnica

Registro do que ficou para depois, com classificação (Prompt Mestre §160). Item resolvido sai daqui e vai para o
histórico do git.

| # | Item | Classe | Onde | Plano |
| --- | --- | --- | --- | --- |
| 1 | Coluna `perfil.permissoes` (JSON) obsoleta desde a migração 0002 | BAIXA | `database/migrations` | Remover numa migração futura, depois de uma versão estável sem uso (ADR-006) |
| 4 | Sem limite de conexões de tempo real por pessoa | MÉDIA | `modulos/eventos/tempo-real.ts` | Limitar por sessão e fechar as mais antigas |
| 10 | Kanban mostra até 50 oportunidades por etapa (o resto, pela busca) | BAIXA | `modulos/crm/oportunidades.servico.ts` | "Carregar mais" por coluna |
| 11 | Mudanças de configuração do CRM não chegam em tempo real a perfis de escopo "próprio" | BAIXA | `modulos/eventos/tempo-real.ts` | Evento de configuração com destino "todos que têm o módulo" |
| 13 | Mensagem modelo (template da API oficial) só sai pela automação BRE; quem escreve na conversa fora da janela de 24 h ainda vê o aviso de erro | MÉDIA | `apps/web/src/features/conversas/Chat.tsx` | Escolher um modelo aprovado no próprio chat quando a janela fechou |
| 14 | Conexão por QR segura o socket no processo: com mais de uma réplica, só uma pode ter `WHATSAPP_QR_ATIVO` | MÉDIA | `conversas/provedores/qr.ts` | Trava distribuída (advisory lock) por canal |
| 15 | Mensagens enviadas direto pelo celular (fora do sistema) na conexão por QR não entram no histórico | BAIXA | `conversas/provedores/qr.ts` | Gravar `fromMe` como saída, deduplicando pelo id |
| 16 | Status "enviada" que chega antes de o job gravar o id externo é perdido (o "entregue" seguinte corrige) | BAIXA | `conversas/entrada.servico.ts` | Guardar status órfãos por alguns minutos |
| 17 | Mídia de conversas fica no PostgreSQL (limite de 16 MB por arquivo) | MÉDIA | `modulos/arquivos` | Provedor S3/R2 (o mesmo do item 9) |
| 18 | Cliente que chega só com LID (sem telefone) gera contato sem telefone; a conversa é juntada depois, o contato não | BAIXA | `conversas/entrada.servico.ts` | Junção de contatos quando o telefone aparecer |
| 19 | Listas de respostas rápidas e canais limitadas a 500/100 itens, sem paginação | BAIXA | `conversas/*.rotas.ts` | Paginar se alguma empresa passar disso |
| 20 | Ramal SIP sem prefixo de discagem configurável (o número vai em E.164 sem o "+") | BAIXA | `apps/web/src/features/telefonia/sip.ts` | Campo de prefixo/formato na configuração de telefonia |
| 21 | A escolha "Ligar por" vale só enquanto a tela está aberta (não é salva) | BAIXA | `apps/web/src/features/telefonia/Telefone.tsx` | Guardar a preferência no perfil da pessoa, no servidor |
| 22 | Gravação de ligação SIP não é feita no navegador (só recebe upload) | MÉDIA | `modulos/telefonia` | Gravar o áudio da sessão WebRTC ou buscar no PABX por webhook |
| 23 | Ligação que fica aberta (navegador fechado no meio) não é encerrada sozinha | BAIXA | `modulos/telefonia` | Job que encerra ligações sem mudança há mais de 4 h |
| 24 | Horários digitados (agenda, horas, atividades) usam o fuso do aparelho; exibição usa o da empresa | BAIXA | `apps/web/src/features/operacao/comum.ts` | Converter com o fuso da empresa ao montar o instante |
| 25 | Indicadores e mapa somados na consulta; empresas com muito volume podem sentir | MÉDIA | `modulos/operacao/indicadores.ts` | Visão materializada por dia × pessoa, atualizada por job (ADR-019) |
| 26 | Scripts ainda não se ligam a oferta (o catálogo chega na fase 5) | BAIXA | `modulos/operacao/scripts.servico.ts` | Coluna `oferta_id` aditiva na fase 5 |
| 27 | Retornos da rotina só aparecem para quem registrou o último resultado do item | BAIXA | `modulos/operacao/rotina.servico.ts` | Opção de "retorno da equipe" para o gestor |
| 28 | Pesquisa pública aceita várias respostas da mesma pessoa (só o limite por IP segura) | BAIXA | `modulos/pesquisa` | Token de resposta por convite, quando a pesquisa for enviada a contatos |
| 29 | Indicadores de metas ainda não contam vendas confirmadas (usam oportunidade ganha) | BAIXA | `modulos/operacao/indicadores.ts` | Indicador "vendas confirmadas" com estorno no cancelamento |
| 30 | Escolher prestador e pessoas no catálogo usa a lista de usuários (precisa de "Usuários: ver") | BAIXA | `apps/web/src/features/receita/Catalogo.tsx` | Rota de opções de pessoas por módulo |
| 31 | Assinatura em atraso só mostra aviso, não bloqueia | MÉDIA | `modulos/cobranca` | Bloquear escrita após N dias de atraso quando houver provedor real |
| 32 | Cobrança só tem o provedor de demonstração | ALTA | `modulos/cobranca` | Provedor real (Asaas/Stripe/Mercado Pago) com webhook de pagamento antes de cobrar clientes |
| 33 | A tela de automações cria só uma condição por regra (a API aceita várias) | BAIXA | `apps/web/src/features/whitelabel/Automacoes.tsx` | Lista de condições na tela |
| 34 | Domínio próprio precisa ser adicionado à mão no Railway | BAIXA | Railway | API do Railway para cadastrar o domínio ao salvar |
| 35 | Cache de domínio por instância (60 s): troca de domínio demora até 1 min em todas as réplicas | BAIXA | `modulos/marca/dominio.ts` | Invalidar por `pg_notify` |
| 36 | Anonimizar não alcança a observação de vendas nem textos livres sem vínculo com o contato (atividade manual, títulos de notificações) | BAIXA | `modulos/lgpd` | Vínculo de contato na atividade manual; busca por nome nas notificações |
| 37 | Administrador da empresa não redefine as duas etapas de alguém (só o suporte, pelo terminal) | BAIXA | `cli/desligar-duas-etapas.ts` | Fluxo de redefinição com confirmação por e-mail da própria pessoa |
| 38 | Offline é só leitura: o que a pessoa faz sem conexão não é guardado para enviar depois | MÉDIA | `apps/web/src/app/offline.ts` | Fila local de ações com reenvio e resolução de conflito |
| 39 | Push depende das chaves VAPID; trocar as chaves desfaz as inscrições dos aparelhos | BAIXA | `modulos/push` | Avisar no app quando a inscrição sumir e pedir para ligar de novo |
| 40 | Retenção não apaga o conteúdo antigo do histórico (`evento.dados`), só de mensagens e de contatos anonimizados | BAIXA | `modulos/lgpd` | Prazo para os resumos de mensagens nos eventos |
| 41 | Dados gravados com nome genérico não seguem o vocabulário (etapa "Novo contato" do funil inicial, contato "Contato do WhatsApp", "Contato anonimizado") | BAIXA | `modulos/crm`, `conversas`, `lgpd` | São dados editáveis; renomear na troca de segmento quando ainda forem o padrão |
| 42 | Nomes dos perfis-base ("Vendedor / Atendente", "Operação / Prestador") não usam o vocabulário | BAIXA | `packages/shared/src/catalogo.ts` | Perfis são renomeáveis; criar com o termo de colaborador e prestador do segmento |
| 43 | Termo personalizado sem gênero escolhido usa a terminação da palavra ("dia" sairia feminino) | BAIXA | `packages/shared/src/vocabulario.ts` | A tela já pede o gênero; tornar obrigatório quando o termo mudar |
| 44 | Resumos da documentação da API (OpenAPI) usam os nomes internos (contato, oportunidade) | BAIXA | `modulos/*/…rotas.ts` | Intencional: é documentação técnica; rever se a API for aberta a clientes (Fase 14) |
| 45 | Início padrão só automático: o administrador não monta o padrão de um perfil | BAIXA | `modulos/inicio` | Coluna aditiva no perfil com a ordem padrão, se pedirem |
| 46 | Blocos de funil, ranking e comissão fazem uma consulta cada ao abrir o Início | BAIXA | `apps/web/src/features/inicio` | Rota de resumo única para o Início, se pesar |
| 47 | Personalizar usa setas (subir/descer), sem arrastar | BAIXA | `apps/web/src/features/inicio` | Arrastar com teclado acessível, mantendo as setas |
| 48 | Conversa vai aberta para a IA nos primeiros testes (decisão de 21/10/2026). O mascaramento já existe por empresa (telefone, e-mail, CPF, CNPJ, CEP, nome do cliente e endereços), desligado por padrão. Antes do uso real: ligar o mascaramento, base legal, aviso ao titular, contrato sem uso para treino e prazo de retenção | ALTA | `modulos/bre` | Ligar por empresa antes de produção |
| 49 | Estado do cliente usa a data da venda confirmada como data da entrega | BAIXA | `modulos/bre/bre.servico.ts` | Usar a data de entrega real quando a venda tiver entrega/expedição |
| 51 | Fila do dia ordena por cadastro do cliente, não por prioridade (reentrada vencida, estado) | BAIXA | `modulos/bre/bre.servico.ts` | Cursor por prioridade quando houver volume |
| 57 | Sem campos de inteligência marcados, o pilar Inteligência usa os campos do registro (emoção, interesse, produto, "sim") | BAIXA | `modulos/bre/desempenho.servico.ts` | Pacotes de segmento já trazendo campos de inteligência marcados |
| 58 | SQ-BRE: o supervisor dá a nota por pilar (0 a 20); os pontos por item do livro ficam como guia na tela (PROPOSTA da ETR) | BAIXA | `apps/web/src/features/qualidade/SqBre.tsx` | Checklist por item, se o autor da doutrina fechar os pontos |
| 59 | "Compatível" no lançamento e no alerta de estoque = já comprou da mesma categoria; não usa interesse declarado nem preferência | BAIXA | `modulos/bre/automacao.servico.ts` | Campo de interesse no cadastro ou oportunidade ligada a item do catálogo |
| 60 | Estoque baixa na venda confirmada e volta no cancelamento; não há reserva para venda aguardando pagamento nem entrada de mercadoria com histórico | BAIXA | `modulos/receita/vendas.servico.ts` | Movimentações de estoque próprias, se a empresa precisar |
| 62 | Cobrança dos clientes: só Asaas como provedor real, e ainda não testado com conta de verdade (só contra servidor falso) | MÉDIA | `modulos/recebimentos/provedores` | Testar no sandbox do Asaas ao contratar; somar Mercado Pago, Pagar.me e Stripe pela mesma interface |
| 63 | Cobrança sem envio automático pelo WhatsApp nem lembrete antes do vencimento; parcelamento e juros/multa ficam no padrão do provedor | BAIXA | `apps/web/src/features/receita/Cobranca.tsx` | Botão "Enviar pelo WhatsApp" e lembrete pela fila de jobs |
| 64 | Termos, privacidade e contrato de dados são minutas: precisam de revisão jurídica e do encarregado de dados antes de vender | ALTA | `apps/api/src/modulos/termos/textos.ts` | Revisar com advogado; ao mudar o sentido, subir a versão em `VERSOES_DOCUMENTOS` |
| 65 | Assinatura da plataforma ainda no provedor de demonstração; sem webhook de pagamento real | ALTA | `modulos/cobranca` | Ligar o provedor escolhido pelo analista (o conector Asaas da 8.6 pode ser reaproveitado) |
| 66 | Domínio próprio da empresa ainda manual (DNS e Railway) | MÉDIA | — | Cadastro do domínio na tela + API do Railway |
| 67 | Aceite de termos é exigido na tela, não em cada rota da API | BAIXA | `apps/web/src/main.tsx` | Exigir no servidor se houver integração externa usando sessão de pessoa |
| 68 | Dados de exemplo envelhecem: o "hoje" (agenda, tarefas, retornos, ponto) é o dia da geração | BAIXA | `modulos/demonstracao/gerador.ts` | "Gerar de novo" antes de apresentar; se incomodar, deslocar as datas na hora de entrar |
| 69 | Gerador insere direto no banco: tabela nova que precise de dados de exemplo exige ajuste no gerador | BAIXA | `modulos/demonstracao/gerador.ts` | Teste de integração confere os números principais; ampliar quando entrar módulo novo |
| 70 | Painel de ligações filtra por `empresa_id` + `iniciada_em` sem índice próprio (os índices são por pessoa e contato, em `criado_em`) | BAIXA | `modulos/telefonia/painel-ligacoes.servico.ts` | Medir com volume real; se pesar, índice aditivo `ligacao (empresa_id, iniciada_em)` |
| 71 | Conversão entre etapas calcula o alcance de cada oportunidade da coorte com subconsulta nos eventos (uma por oportunidade) | BAIXA | `modulos/crm/alcance-funil.ts` | Medir com volume real; se pesar, gravar `alcance_ordem` na oportunidade ao mudar de etapa (coluna aditiva + preenchimento) |
| 72 | Limite de etiquetas e campos conta e depois insere: dois cadastros no mesmo instante podem passar 1 do limite | BAIXA | `modulos/crm/configuracao.servico.ts` | Trava por empresa (advisory lock) na criação, se o limite virar cobrança |
| 73 | Importação de planilha ainda não lê CPF/CNPJ (o cadastro e a edição já aceitam) | BAIXA | `modulos/crm/importacao.servico.ts` | Coluna "Documento" no mapeamento, com a mesma validação e o hash contra repetido |
