# Dívida técnica

Registro do que ficou para depois, com classificação (Prompt Mestre §160). Item resolvido sai daqui e vai para o
histórico do git.

| # | Item | Classe | Onde | Plano |
| --- | --- | --- | --- | --- |
| 1 | Coluna `perfil.permissoes` (JSON) obsoleta desde a migração 0002 | BAIXA | `database/migrations` | Remover numa migração futura, depois de uma versão estável sem uso (ADR-006) |
| 2 | Filtro de período da auditoria usa a meia-noite do navegador, não a do fuso da empresa | BAIXA | `apps/web/src/features/auditoria` | Calcular os limites no servidor a partir de datas sem hora + fuso da empresa |
| 3 | Mensagens de erro do PostgreSQL podem conter dados pessoais no log de erro inesperado | MÉDIA | `apps/api/src/app.ts` | Sanitizar `detail` dos erros do banco antes de registrar (fase 7, observabilidade) |
| 4 | Sem limite de conexões de tempo real por pessoa | MÉDIA | `modulos/eventos/tempo-real.ts` | Limitar por sessão e fechar as mais antigas |
| 5 | Caixa de saída de demonstração guarda o texto do e-mail (com link) sem cifrar | MÉDIA | `modulos/avisos` | Cifrar com `CRM_CHAVE` ou limpar por job após 7 dias |
| 6 | Primeiro acesso em produção depende do terminal (SSH) | MÉDIA | `apps/api/src/cli/criar-empresa.ts` | Assistente de primeiro acesso (fase 6) |
| 7 | Logs de negócio estruturados (evento, empresa, ator, entidade) ainda não existem fora da auditoria | BAIXA | API | Registrar no log os eventos publicados, sem dados pessoais (fase 7) |
| 8 | Backup do PostgreSQL de produção não verificado | ALTA | Railway | Ativar backups do Railway e testar restauração (fase 7; checar já) |
| 9 | Arquivos (planilhas importadas) ficam no PostgreSQL para sempre | BAIXA | `modulos/arquivos` | Job de limpeza das planilhas de importações concluídas há mais de 30 dias; S3/R2 quando chegar mídia (fase 2) |
| 10 | Kanban mostra até 50 oportunidades por etapa (o resto, pela busca) | BAIXA | `modulos/crm/oportunidades.servico.ts` | "Carregar mais" por coluna |
| 11 | Mudanças de configuração do CRM não chegam em tempo real a perfis de escopo "próprio" | BAIXA | `modulos/eventos/tempo-real.ts` | Evento de configuração com destino "todos que têm o módulo" |
| 12 | Plural do vocabulário é uma regra simples (aluno → alunos) | BAIXA | `apps/web/src/features/crm/comum.tsx` | Guardar singular e plural na configuração (fase 6) |
| 13 | Sem mensagens modelo (templates) da API oficial: fora da janela de 24 h o envio falha com aviso claro | MÉDIA | `conversas/provedores/cloud-api.ts` | Cadastro de modelos aprovados e envio por modelo |
| 14 | Conexão por QR segura o socket no processo: com mais de uma réplica, só uma pode ter `WHATSAPP_QR_ATIVO` | MÉDIA | `conversas/provedores/qr.ts` | Trava distribuída (advisory lock) por canal |
| 15 | Mensagens enviadas direto pelo celular (fora do sistema) na conexão por QR não entram no histórico | BAIXA | `conversas/provedores/qr.ts` | Gravar `fromMe` como saída, deduplicando pelo id |
| 16 | Status "enviada" que chega antes de o job gravar o id externo é perdido (o "entregue" seguinte corrige) | BAIXA | `conversas/entrada.servico.ts` | Guardar status órfãos por alguns minutos |
| 17 | Mídia de conversas fica no PostgreSQL (limite de 16 MB por arquivo) | MÉDIA | `modulos/arquivos` | Provedor S3/R2 (o mesmo do item 9) |
| 18 | Cliente que chega só com LID (sem telefone) gera contato sem telefone; a conversa é juntada depois, o contato não | BAIXA | `conversas/entrada.servico.ts` | Junção de contatos quando o telefone aparecer |
| 19 | Listas de respostas rápidas e canais limitadas a 500/100 itens, sem paginação | BAIXA | `conversas/*.rotas.ts` | Paginar se alguma empresa passar disso |

