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
