# Roteiro

Legenda: `[ ]` não iniciado · `[-]` em desenvolvimento · `[x]` concluído · `[!]` bloqueado.
Detalhes e critérios de pronto de cada fase: `ESPECIFICACAO.md` ("Roteiro de construção") e `PROMPT_MESTRE.md` (§86–94).

- [x] Esqueleto: Fastify + TypeScript, healthcheck, CI e deploy no Railway
- [x] Fase 0 — Fundação (autenticação, multiempresa, perfis e permissões, auditoria, eventos, tempo real, tema, PWA)
- [x] Fase 0.1 — Alinhamento ao Prompt Mestre (monorepo, módulos por domínio, contrato Zod/DTO/OpenAPI, erro
      padrão, permissões em tabela, slug, isolamento A ↔ B, e2e em 5 larguras, dead-letter, documentação)
- [x] Fase 1 — CRM (contatos com dedup por telefone, carteira por escopo, etiquetas, campos personalizados,
      funis/etapas configuráveis, kanban com campos obrigatórios e motivo de perda, oportunidades, tarefas, notas,
      histórico, lixeira, ações em massa, importação CSV/XLSX idempotente em fila, vocabulário da empresa na tela)
- [x] Fase 2 — Conversas (canais demonstração, API oficial e QR; caixa de entrada por pessoa/equipe com atribuição
      e status; texto, mídia e áudio gravado no navegador com velocidade; notas internas; respostas rápidas com
      variáveis; boas-vindas, fora do horário e follow-up; deduplicação em cascata; junção de duplicadas)
- [x] Fase 3 — Ligações e fila (telefone no navegador: treino, celular do vendedor e ramal SIP; ligações com
      estados, resultados configuráveis e histórico automático; gravação cifrada com link temporário e retenção;
      filas com reserva exclusiva, ordem de chegada, pausa e escopo de carteira; importação e ação em massa
      alimentam a fila; conversão para o funil)
- [x] Fase 4 — Operação (rotina diária no Início com ponto, check-list por perfil, metas, compromissos, tarefas,
      retornos e conversas sem resposta; agenda com lembrete; escala e horas com validação do gestor e fechamento
      do mês travado no banco; metas e painel de desempenho e mapa de atividades calculados só dos eventos;
      atividades manuais corrigíveis; biblioteca de scripts aberta na conversa e na ligação)
- [x] Fase 5 — Receita e qualidade (catálogo de ofertas e entregas com vagas travadas no banco e prestador; vendas
      ligando contato, oferta e vendedor; regras de comissão percentual ou por faixa, prévia e fechamento mensal
      pelo financeiro com retrato gravado; monitoramento de qualidade com critérios e nota ponderada; pesquisas
      com link público e resultados agregados)
- [x] Fase 6 — White-label (marca pelo endereço — subdomínio ou domínio próprio —, com cores validadas por
      contraste, logos, ícone e app instalado da marca; vocabulário com plural; cadastro aberto com teste de 14 dias
      e assistente de 5 passos com segmentos prontos e dados de exemplo; planos que escondem módulos sem apagar;
      cobrança atrás de interface com provedor de demonstração; automações quando/se/então)
- [x] Fase 7 — Endurecimento (login em duas etapas por app ou e-mail com códigos de recuperação e regra da empresa;
      LGPD: exportar e anonimizar o titular, "não contatar" em toda saída, prazos de retenção com limpeza diária;
      backup com restauração testada no CI e roteiro; logs estruturados sem dados pessoais e alerta de canal
      desconectado por sino, e-mail e push; avisos no celular para quem está fora, ligação só no celular; leitura
      offline com cache limpo no login/logout; modo escuro e teclado conferidos nas telas principais)

## Pendências fora das fases

- [!] Homologação automática: depende de ativar **PR Environments** no Railway (ação no painel).
- [!] E-mail real: depende de criar `SMTP_URL` e `EMAIL_REMETENTE` no Railway.
- [!] Domínios: criar `DOMINIO_BASE` e o DNS curinga (`*.dominio`) apontando para o Railway.
- [!] Backup do PostgreSQL de produção: ativar os agendamentos no Railway e fazer o primeiro teste (`docs/BACKUP.md`).
- [!] Avisos no celular: gerar as chaves (`npm run push:chaves`) e criar `VAPID_PUBLICA`/`VAPID_PRIVADA` no Railway.

## Ficou para fases seguintes

- Operação: scripts por oferta (quando o catálogo chegar na fase 5); agenda ligada ao contato pela ficha.
- Telefonia: prefixo de discagem por empresa, URA/fila receptiva, preferência de "Ligar por" salva no servidor.
- Mensagens modelo (templates) da API oficial para falar fora da janela de 24 h; mídia em S3/R2.
- White-label: provedor de cobrança real (Asaas/Stripe/Mercado Pago), bloqueio por atraso, painel da plataforma
  com todas as empresas, mais de uma condição por automação na tela.
- Endurecimento: limite de conexões de tempo real por pessoa, envio de mensagens a partir do modo offline
  (fila local), painel de saúde da plataforma.
