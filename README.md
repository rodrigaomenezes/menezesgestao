# Menezes Gestão

Plataforma white-label de operações comerciais: CRM com funil, conversas de WhatsApp, central de telefonia,
fila de ligações, rotina, metas e qualidade — configurável para empresas de qualquer segmento.

- Especificação: [`ESPECIFICACAO.md`](ESPECIFICACAO.md)
- Regras para quem desenvolve (inclusive o Claude Code): [`CLAUDE.md`](CLAUDE.md)
- Próximos passos: [`ROADMAP.md`](ROADMAP.md)

## Rodar localmente
```bash
cp .env.example .env
npm install
npm run dev        # http://localhost:3000/api/health
npm test
```

## Publicar no Railway
1. New Project → Deploy from GitHub repo → `menezesgestao`.
2. + New → Database → PostgreSQL.
3. Variables do serviço: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `SESSION_SECRET`, `CRM_CHAVE`
   (gere cada um com `openssl rand -hex 32`), `NODE_ENV=production`.
4. Settings → Networking → Generate Domain.
