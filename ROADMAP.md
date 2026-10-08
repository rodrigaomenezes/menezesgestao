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
- [ ] Fase 3 — Ligações e fila
- [ ] Fase 4 — Operação
- [ ] Fase 5 — Receita e qualidade
- [ ] Fase 6 — White-label
- [ ] Fase 7 — Endurecimento

## Pendências fora das fases

- [!] Homologação automática: depende de ativar **PR Environments** no Railway (ação no painel).
- [!] E-mail real: depende de criar `SMTP_URL` e `EMAIL_REMETENTE` no Railway.
- [ ] Backup do PostgreSQL de produção: ativar e testar restauração (ver `TECH_DEBT.md` #8).

## Ficou para fases seguintes

- Mensagens modelo (templates) da API oficial para falar fora da janela de 24 h; mídia em S3/R2.
- Fase 6: marca por domínio (usa `empresa.slug`), painel da plataforma (planos e módulos), vocabulário na interface,
  assistente de primeiro acesso, ícones do PWA a partir do logo, edição do vocabulário (com plural) na tela.
- Fase 7: duas etapas, Web Push, leitura offline, logs de negócio estruturados, limite de conexões de tempo real.
