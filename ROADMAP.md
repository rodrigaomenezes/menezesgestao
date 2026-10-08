# Roteiro

- [x] Esqueleto: Fastify + TypeScript, healthcheck, teste, CI e deploy no Railway
- [x] Fase 0 — Fundação (autenticação, multiempresa, perfis e permissões, auditoria, eventos, tempo real, tema, PWA)
- [ ] Fase 1 — CRM
- [ ] Fase 2 — Conversas
- [ ] Fase 3 — Ligações e fila
- [ ] Fase 4 — Operação
- [ ] Fase 5 — Receita e qualidade
- [ ] Fase 6 — White-label
- [ ] Fase 7 — Endurecimento

Detalhes e critérios de pronto de cada fase: `ESPECIFICACAO.md`, seção "Roteiro de construção".

## Ficou para depois (anotado na fase 0)

Para a fase 1:
- `campo_personalizado` (entra com o CRM, onde é usado).
- Teste de isolamento já cobre rotas novas automaticamente; as tabelas novas precisam de RLS (o teste
  `src/db/rls.test.ts` falha se faltar) e de `GRANT` explícito para `mg_app`.

Para a fase 6 (white-label):
- Marca por domínio (manifesto e tela de entrada com a marca da empresa antes do login; hoje vem de `PRODUTO_NOME`).
- Painel da plataforma para criar empresas e mudar plano/módulos (hoje: `npm run empresa:criar`).
- Vocabulário aplicado aos rótulos da interface (o campo já existe em `empresa.vocabulario`).
- Ícones do PWA gerados a partir do logo da empresa.

Para a fase 7 (endurecimento):
- Verificação em duas etapas; push (Web Push) e leitura offline, com limpeza de cache no login/logout.
- Logs sem dados pessoais também nas mensagens de erro do banco; alerta de canal desconectado.
- Limite de conexões de tempo real por pessoa.
- Caixa de saída de demonstração: cifrar o conteúdo ou limpar automaticamente.

Pequenos, quando houver demanda:
- Editar o próprio nome e e-mail.
- Reenviar convite tem botão próprio (hoje: convidar de novo o mesmo e-mail gera um link novo).
- Bloqueio por excesso de tentativas revela que o e-mail existe depois de 5 erros (troca consciente por proteção
  contra força bruta).
