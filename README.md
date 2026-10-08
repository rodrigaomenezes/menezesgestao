# Menezes Gestão

Plataforma white-label de operações comerciais: CRM com funil, conversas de WhatsApp, central de telefonia,
fila de ligações, rotina, metas e qualidade — configurável para empresas de qualquer segmento.

- Especificação: [`ESPECIFICACAO.md`](ESPECIFICACAO.md)
- Regras para quem desenvolve (inclusive o Claude Code): [`CLAUDE.md`](CLAUDE.md)
- Próximos passos: [`ROADMAP.md`](ROADMAP.md)
- Decisões de arquitetura: [`docs/decisoes/`](docs/decisoes/)

## O que já funciona (fase 0 — Fundação)

- **Multiempresa:** toda consulta de negócio passa por `comEmpresa()`, que usa o papel `mg_app` do PostgreSQL com
  Row Level Security. Um teste varre todas as rotas da API com identificadores de outra empresa.
- **Acesso:** login com e-mail e senha (Argon2id), bloqueio progressivo, limite por IP, convite e recuperação de senha
  por e-mail, troca de empresa sem sair, lista de dispositivos conectados.
- **Permissões:** perfis-base da matriz da especificação (Dono, Gestor, Vendedor, Operação, Financeiro), perfis
  personalizados, permissão por módulo × ação × escopo (próprio, equipe, unidade, empresa) checada no servidor.
- **Cadastros:** empresa e marca, unidades, equipes, usuários e perfis, sempre com arquivar e restaurar.
- **Registro automático:** auditoria e eventos somente inserção; eventos chegam em tempo real (SSE) a quem pode ver.
- **App:** React + PWA instalável, celular primeiro (360 px), tema claro/escuro com as cores da empresa.

## Rodar localmente

Pré-requisitos: Node.js 20.19 ou mais novo e PostgreSQL 16 (ou Docker).

```bash
docker compose up -d          # PostgreSQL com os bancos menezesgestao e menezesgestao_teste
cp .env.example .env          # preencha SESSION_SECRET, CRM_CHAVE (openssl rand -hex 32) e SENHA_EXEMPLO
npm install
npm run dados:exemplo         # duas empresas fictícias, uma pessoa por perfil (senha = SENHA_EXEMPLO)
npm run build                 # compila servidor e front
npm start                     # http://localhost:3000
```

Para desenvolver com recarga automática, rode em dois terminais `npm run dev` (servidor, porta 3000) e
`npm run dev:web` (front, porta 5173, conversando com o servidor).

Pessoas de exemplo: veja `dados/exemplo.json` (ex.: `dono@escola.example.com`, `vendas@escola.example.com`,
`consultoria@example.com`, que está nas duas empresas).

Sem `SMTP_URL`, os e-mails (convites e senha) ficam na caixa de demonstração: `npm run caixa-de-saida` mostra os últimos.

Para criar uma empresa de verdade e convidar o dono: `npm run empresa:criar -- --nome "Empresa" --email dono@empresa.com.br --dono "Nome" --plano completo`.

## Testes

```bash
npm run lint && npm run typecheck
npm test            # unidade + integração com PostgreSQL real (usa DATABASE_URL_TESTE e APAGA esse banco)
npm run build && npm run test:e2e   # Playwright no celular (360 px) e no computador
```

`DATABASE_URL_TESTE` precisa apontar para um banco com "teste" no nome: os testes recriam o banco a cada execução e
se recusam a rodar em outro.

Testes que provam os critérios de pronto da fase 0:

| Critério | Onde |
| --- | --- |
| Usuário da empresa A não lê nada da B | `src/isolamento.test.ts` (todas as rotas, ids de B) e `src/db/rls.test.ts` (direto no banco) |
| Login funciona no celular | `e2e/acesso.spec.ts`, projeto `celular` (360 × 740) |
| Deploy automático em homologação | PR Environments do Railway (ver abaixo) |

## Variáveis de ambiente

| Variável | Obrigatória | Para quê |
| --- | --- | --- |
| `DATABASE_URL` | sim | PostgreSQL |
| `SESSION_SECRET` | sim | Assina os tokens de sessão e de links (≥ 32 caracteres; `openssl rand -hex 32`) |
| `CRM_CHAVE` | sim | Chave AES-256-GCM dos dados cifrados (64 hex; `openssl rand -hex 32`) |
| `APP_URL` | em produção | Endereço público, usado nos links dos e-mails; `https://` liga o cookie `Secure` |
| `PRODUTO_NOME` | não | Nome do produto na tela de entrada e no app instalado (padrão: Menezes Gestão) |
| `SMTP_URL`, `EMAIL_REMETENTE` | não | Envio real de e-mail. Sem elas, provedor de demonstração |
| `LIMITE_REQ_MINUTO`, `LIMITE_LOGIN_MINUTO` | não | Limites por IP (padrão 300 e 10 por minuto) |
| `DATABASE_URL_TESTE` | só testes | Banco descartável dos testes |
| `SENHA_EXEMPLO` | só `dados:exemplo` | Senha das pessoas de exemplo |

O servidor não sobe se faltar alguma obrigatória ou se o formato estiver errado.

## Publicar no Railway

1. New Project → Deploy from GitHub repo → `menezesgestao`.
2. + New → Database → PostgreSQL.
3. Variables do serviço: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `SESSION_SECRET`, `CRM_CHAVE`
   (gere cada um com `openssl rand -hex 32`), `APP_URL` (o domínio gerado, com `https://`), `NODE_ENV=production`
   e, quando tiver, `SMTP_URL` e `EMAIL_REMETENTE`.
4. Settings → Networking → Generate Domain.
5. **Homologação:** Project Settings → Environments → ative **PR Environments**. Cada PR ganha um ambiente
   temporário com o próprio banco; o merge na `main` publica em produção. Nos ambientes de PR, defina `APP_URL`
   com o domínio do ambiente.

A cada início o servidor aplica as migrações pendentes (aditivas e idempotentes, com trava para duas instâncias)
e sobe a fila de jobs. Healthcheck: `/api/health`.

## Estrutura

```
migracoes/            SQL versionado (fonte da verdade do banco, inclusive RLS)
src/
  app.ts, server.ts   montagem do Fastify e inicialização
  compartilhado/      catálogo de módulos/permissões e marca (usado também pelo front)
  db/                 conexão, camada comEmpresa/comoSistema, espelho Drizzle, migrações
  nucleo/             acesso, auditoria/eventos, escopo, paginação, tempo real, convites
  rotas/              rotas da API por assunto
  avisos/, jobs/      interface de avisos (demonstração e SMTP) e fila pg-boss
  scripts/            dados de exemplo, criar empresa, caixa de saída
web/                  front React + Vite (PWA)
e2e/                  testes Playwright
```

## Decisões tomadas na fase 0

Resumo; detalhes em [`docs/decisoes/0001-fundacao.md`](docs/decisoes/0001-fundacao.md).

- **Drizzle** para consultas; o banco é definido por **migrações SQL escritas à mão** (RLS, papéis e gatilhos
  ficam explícitos e idempotentes).
- **RLS com papel próprio (`mg_app`)** em vez de `FORCE ROW LEVEL SECURITY`: o dono das tabelas fica para o caminho
  do sistema (login, migrações, jobs), e toda rota de empresa usa o papel restrito.
- **Permissões do perfil em JSON** (`perfil.permissoes`) em vez de uma tabela `permissao`: troca atômica e auditada
  com antes/depois.
- **Um serviço só**: o Fastify serve a API e o front compilado.
- **Toda rota declara o acesso** (`config.acesso`); o servidor não sobe com rota sem declaração.
- **E-mail pela fila de jobs**, enfileirado dentro da transação e com o conteúdo cifrado.
- A caixa de saída de demonstração **não tem rota na API** (reúne e-mails de todas as empresas); só o script lê.
