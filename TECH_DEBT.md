# Dívida técnica

Registro do que ficou para depois, com classificação (Prompt Mestre §160). Item resolvido sai daqui e vai para o
histórico do git.

| # | Item | Classe | Onde | Plano |
| --- | --- | --- | --- | --- |
| 1 | Coluna `perfil.permissoes` (JSON) obsoleta desde a migração 0002 | BAIXA | `database/migrations` | Remover numa migração futura, depois de uma versão estável sem uso (ADR-006) |
| 2 | Filtro de período da auditoria usa a meia-noite do navegador, não a do fuso da empresa | BAIXA | `apps/web/src/features/auditoria` | Calcular os limites no servidor a partir de datas sem hora + fuso da empresa |
| 4 | Sem limite de conexões de tempo real por pessoa | MÉDIA | `modulos/eventos/tempo-real.ts` | Limitar por sessão e fechar as mais antigas |
| 10 | Kanban mostra até 50 oportunidades por etapa (o resto, pela busca) | BAIXA | `modulos/crm/oportunidades.servico.ts` | "Carregar mais" por coluna |
| 11 | Mudanças de configuração do CRM não chegam em tempo real a perfis de escopo "próprio" | BAIXA | `modulos/eventos/tempo-real.ts` | Evento de configuração com destino "todos que têm o módulo" |
| 13 | Sem mensagens modelo (templates) da API oficial: fora da janela de 24 h o envio falha com aviso claro | MÉDIA | `conversas/provedores/cloud-api.ts` | Cadastro de modelos aprovados e envio por modelo |
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

