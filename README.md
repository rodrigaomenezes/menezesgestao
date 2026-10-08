# Menezes Gestão

Plataforma white-label de operações comerciais: CRM com funil, conversas de WhatsApp, central de telefonia,
fila de ligações, rotina, metas e qualidade — configurável para empresas de qualquer segmento.

| Documento | Para quê |
| --- | --- |
| [`PROMPT_MESTRE.md`](PROMPT_MESTRE.md) | Instrução permanente de desenvolvimento (princípios, estrutura, definição de pronto) |
| [`ESPECIFICACAO.md`](ESPECIFICACAO.md) | O produto: módulos, regras, roteiro de fases |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Como o sistema está montado |
| [`DECISIONS.md`](DECISIONS.md) | Decisões de arquitetura (ADR) |
| [`ROADMAP.md`](ROADMAP.md) / [`TECH_DEBT.md`](TECH_DEBT.md) | Estado das fases / dívida registrada |
| [`CLAUDE.md`](CLAUDE.md) | Regras para quem desenvolve (inclusive o Claude Code) |

## Rodar localmente

Pré-requisitos: Node.js 20.19+ e PostgreSQL 16 (ou Docker).

```bash
git clone https://github.com/rodrigaomenezes/menezesgestao.git && cd menezesgestao
docker compose up -d          # PostgreSQL com os bancos menezesgestao e menezesgestao_teste
cp .env.example .env          # preencha SESSION_SECRET e CRM_CHAVE (openssl rand -hex 32) e SENHA_EXEMPLO
npm install
npm run db:migrate            # aplica as migrações (o servidor também aplica ao iniciar)
npm run db:seed               # duas empresas fictícias, uma pessoa por perfil e contatos/funil de exemplo
npm run build && npm start    # http://localhost:3000
```

Desenvolvimento com recarga automática, em dois terminais: `npm run dev` (API, porta 3000) e `npm run dev:web`
(front, porta 5173). Pessoas de exemplo: `database/seeds/exemplo.json` (ex.: `dono@escola.example.com`).

Sem `SMTP_URL`, os e-mails (convites e senha) ficam na caixa de demonstração: `npm run caixa-de-saida`.
Criar uma empresa e convidar o dono: `npm run empresa:criar -- --nome "Empresa" --email dono@empresa.com.br --dono "Nome" --plano completo`
(sem SMTP, o comando já mostra o link do convite).

A documentação da API (OpenAPI) fica em `/api/openapi.json`.

### CRM (fase 1)

Menu **Contatos** (ou o termo da empresa: "Alunos", "Pacientes"…), **Funil**, **Tarefas**, **Importar planilha** e
**Configurar CRM** (administrador). Empresa nova já nasce com o funil "Vendas" e motivos de perda.

- O telefone (E.164, regra do nono dígito) identifica a pessoa: o mesmo número em outro formato não cria duplicado.
- Importação: `.xlsx` ou `.csv` (até 10 MB / 20 mil linhas) → conferir colunas → processa em fila → relatório.
  Importar a mesma planilha de novo não duplica ninguém; quem está na lixeira ou na carteira de outra pessoa é
  ignorado com o motivo no relatório.
- Vendedor vê só a própria carteira; gestor, a da equipe; dono, a da empresa (escopos do perfil).

### Conversas (fase 2)

Menu **Conversas** (caixa de entrada) e **Canais e automações** (administrador). Três tipos de canal:

| Tipo | Para quê | Como conectar |
| --- | --- | --- |
| Demonstração | Testar sem número real | Criar → Conectar → "Simular cliente" faz o papel do celular |
| API oficial (Meta) | Operação séria | Cadastrar Phone number ID, token permanente e chave secreta do app (ficam cifrados) → Conectar; no painel da Meta, cadastrar a URL e o token de verificação mostrados no canal e assinar "messages" |
| QR code | Começar rápido | Conectar → ler o QR no celular (Aparelhos conectados). Biblioteca não oficial: risco de bloqueio do número (ADR-016) |

A resposta do cliente cai sempre na mesma conversa (id do provedor, telefone com e sem nono dígito, contato) e
webhook repetido não duplica nada. Conversa sem dono fica na fila de todos que atendem; quem responde assume.

## Testes

```bash
npm run lint && npm run typecheck
npm test                  # unidade + integração (= test:unit + test:integration)
npm run test:unit
npm run test:integration  # PostgreSQL real em DATABASE_URL_TESTE (o banco é APAGADO a cada execução)
npm run build && npm run test:e2e   # Playwright em 360, 390, 768, 1024 e 1440 px
```

`DATABASE_URL_TESTE` precisa apontar para um banco com "teste" no nome; os testes se recusam a rodar em outro.

## Variáveis de ambiente

| Variável | Obrigatória | Para quê |
| --- | --- | --- |
| `DATABASE_URL` | sim | PostgreSQL |
| `SESSION_SECRET` | sim | Assina os tokens de sessão e de links (≥ 32 caracteres; `openssl rand -hex 32`) |
| `CRM_CHAVE` | sim | Chave AES-256-GCM dos dados cifrados (64 hex; `openssl rand -hex 32`). Não troque depois |
| `APP_URL` | em produção | Endereço público (links dos e-mails); `https://` liga o cookie `Secure` |
| `PORT` | não | Porta (padrão 3000; no Railway, a mesma do domínio) |
| `PRODUTO_NOME` | não | Nome do produto na tela de entrada e no app instalado |
| `SMTP_URL`, `EMAIL_REMETENTE` | não | Envio real de e-mail (ex.: `smtps://usuario:senha@smtp.provedor.com:465`) |
| `LIMITE_REQ_MINUTO`, `LIMITE_LOGIN_MINUTO` | não | Limites por IP (padrão 300 e 10 por minuto) |
| `DATABASE_URL_TESTE` | só testes | Banco descartável dos testes |
| `SENHA_EXEMPLO` | só `db:seed` | Senha das pessoas de exemplo |
| `WHATSAPP_QR_ATIVO` | não | `nao` desliga as conexões por QR nesta instância (só **uma** instância pode segurar cada número) |
| `WHATSAPP_GRAPH_URL` | não | Endereço da Graph API da Meta (padrão `https://graph.facebook.com/v21.0`; troque só em testes) |

## Publicar no Railway

O Railway publica a cada merge na `main` (`railway.json`: `npm run build`, `npm start`, healthcheck `/api/health`).

1. Serviço do app → **Variables**: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `SESSION_SECRET`, `CRM_CHAVE`,
   `APP_URL=https://<domínio>`, `NODE_ENV=production`, `PORT` (a do domínio) e, quando tiver, `SMTP_URL` e `EMAIL_REMETENTE`.
2. **Homologação:** Project Settings → Environments → **PR Environments** (cada PR ganha ambiente e banco próprios).
3. **Primeira empresa** (no terminal do serviço: `railway link` e `railway ssh`):
   `node apps/api/dist/cli/criar-empresa.js --nome "Empresa" --email voce@empresa.com.br --dono "Seu Nome" --plano completo`
   — sem SMTP, o comando mostra o link para criar a senha.

## Fluxo de trabalho

`main` + uma branch por fase/correção, um PR por entrega, merge só com CI verde (ADR-010). Commits no padrão
`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
