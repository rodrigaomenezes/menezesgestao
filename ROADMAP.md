# Roteiro

Legenda: `[ ]` não iniciado · `[-]` em desenvolvimento · `[x]` concluído · `[!]` bloqueado.
Detalhes e critérios de pronto de cada fase: `ESPECIFICACAO.md` ("Roteiro de construção") e `PROMPT_MESTRE.md` (§86–94).

- [x] Esqueleto: Fastify + TypeScript, healthcheck, CI e deploy no Railway
- [x] Fase 0 — Fundação (autenticação, multiempresa, perfis e permissões, auditoria, eventos, tempo real, tema, PWA)
- [x] Fase 0.1 — Alinhamento ao Prompt Mestre (monorepo, módulos por domínio, contrato Zod/DTO/OpenAPI, erro
      padrão, permissões em tabela, slug, isolamento A ↔ B, e2e em 5 larguras, dead-letter, documentação)
- [ ] Fase 1 — CRM
- [ ] Fase 2 — Conversas
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

- Fase 1: `campo_personalizado`, `normalizePhone` central (E.164 + nono dígito), `StorageProvider` (upload da importação).
- Fase 6: marca por domínio (usa `empresa.slug`), painel da plataforma (planos e módulos), vocabulário na interface,
  assistente de primeiro acesso, ícones do PWA a partir do logo.
- Fase 7: duas etapas, Web Push, leitura offline, logs de negócio estruturados, limite de conexões de tempo real.
