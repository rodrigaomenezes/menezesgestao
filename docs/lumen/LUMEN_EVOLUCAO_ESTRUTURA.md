# Lumen Operações — evolução da estrutura (junto com a entrada do BRE)

> **Para quem é:** para o agente (ou a pessoa) que vai mexer no repositório `lumenoperacoes`.
> **O que é:** as boas práticas que o Menezes Gestão segue, traduzidas para o que o Lumen é hoje (JavaScript puro,
> Express, SQLite), em etapas pequenas que cabem em PRs separados e que preparam o terreno para o motor BRE.
> **Documento irmão:** [`LUMEN_IMPLANTACAO_BRE.md`](./LUMEN_IMPLANTACAO_BRE.md) — a implantação do BRE em cima desta base.

## 0. Como usar este documento

1. Copie esta pasta (`docs/lumen/`) para `docs/` do repositório do Lumen.
2. Abra uma sessão de desenvolvimento no Lumen e cole o pedido abaixo:

```text
Leia docs/LUMEN_EVOLUCAO_ESTRUTURA.md e docs/LUMEN_IMPLANTACAO_BRE.md inteiros.
Comece pela Etapa E0 do primeiro documento. Antes de cada etapa, apresente o plano curto
(arquivos, tabelas, testes) e espere meu ok. Uma etapa = um PR. Não mude a pilha (nada de
TypeScript, Postgres ou framework novo) sem me perguntar. Ao fim de cada etapa: npm test verde,
README atualizado e o relatório da seção 12 (arquivos, responsabilidades, dependências,
otimizações e testes executados).
```

3. Quando as etapas E0 a E4 estiverem no ar, siga para o documento do BRE (ele usa o que elas criam).

## 1. Onde o Lumen está hoje (diagnóstico honesto)

O que já é bom e **deve ser mantido**:

| Ponto | Onde |
| --- | --- |
| Tudo num servidor só, simples de publicar (Railway + Volume `DATA_DIR`) | `server.js`, `railway.json` |
| SQLite com WAL e `foreign_keys = ON`, consultas preparadas (sem SQL montado com texto do usuário) | `db/index.js` |
| Esquema idempotente (`CREATE TABLE IF NOT EXISTS`) e tabela `migracoes` para correções de dados que rodam uma vez | `db/schema.sql`, `db/crm.sql`, `db/index.js` |
| Permissões por nome checadas no servidor (`requirePermission("crm.usar")`) | `middleware/auth.js` |
| Auditoria (`audit_logs`) e histórico do cliente (`crm_timeline`) | `middleware/audit.js`, `lib/crm.js` |
| Telefone normalizado (`normalizarTelefone`, `chaveTelefone`) como chave do contato | `lib/comum.js` |
| Segredos cifrados no banco (`cifrar`/`decifrar`) | `lib/comum.js` |
| Tempo real por SSE (`publicar`, `crm.avisar`) e push (`lib/push.js`) | `lib/comum.js`, `lib/push.js` |
| Excluir = arquivar com lixeira e motivo | `routes/crm.js` |
| Textos de erro em português dizendo o que fazer | rotas |

O que **trava a evolução** (e o que o BRE vai cobrar):

| Risco | Evidência | Por que dói com o BRE |
| --- | --- | --- |
| Não há testes de comportamento: `npm test` só confere sintaxe e o boot | `scripts/verificar.js` | O BRE é feito de regras (bloqueios, ciclos, notas); sem testes, uma mudança quebra a regra sem ninguém ver |
| Migração = lista de `ALTER` em `try/catch` que engole qualquer erro | `db/index.js` linhas 48–117 | Erro de digitação numa coluna nova passa calado e o BRE quebra em produção |
| Rotinas em `setInterval` espalhados, sem registro de quando rodaram | `lib/backup.js:31`, `lib/telefone/index.js:212` | O BRE tem 5 rotinas (diária, horária, semanal, fila da IA); se o servidor reinicia no horário, a rotina não roda e ninguém sabe |
| Módulo que falha em silêncio | `server.js:80` — `try { app.use("/api/fila", …) } catch (e) { console.error(…) }` | A tela abre, a API devolve 404 e parece "bug do front" |
| Validação de entrada à mão em cada rota | `routes/*.js` | O registro BRE tem 8 campos e listas fechadas; validar à mão em cada lugar diverge |
| Rotas grandes que fazem tudo (consulta, regra, efeito) | `routes/crm.js` (869 linhas), `routes/whatsapp.js` (733) | Regra de negócio presa na rota não pode ser testada nem reaproveitada pelo BRE |
| Muito `innerHTML` no front (283 usos, a maioria com `esc()`) | `public/*.js` | Basta um `esc()` esquecido num campo novo (comentário do Break, saída da IA) para abrir XSS |
| Algumas listas sem paginação | rotas de listagem | Fila do dia, breaks e execuções crescem todo dia |

## 2. Princípios trazidos do Menezes Gestão (versão Lumen)

1. **Regra de negócio em módulo puro e testado.** Funções sem banco e sem `req/res` (`lib/<dominio>/regras.js`);
   a rota só valida, chama e responde.
2. **Toda rota checa permissão no servidor** — nunca confiar em botão escondido.
3. **Nada some.** Arquivar com `deleted_at`/motivo; o que é prova (registro, nota, aceite) é só de inserção,
   travado no banco por gatilho.
4. **Migrações aditivas e idempotentes**, numeradas, com erro barulhento.
5. **Uma fila de rotinas só, persistida**, com última execução e último erro visíveis. Sem `setInterval` de regra.
6. **Fornecedor atrás de interface com versão de demonstração** (a IA do BRE funciona sem conta: ver o documento
   irmão).
7. **Registro automático:** cada ação relevante deixa rastro (timeline, auditoria ou tabela própria); painel e
   ranking derivam desses rastros, não de digitação extra.
8. **Telefone normalizado é a chave**; repetir uma chamada (webhook, duplo clique, rotina) nunca duplica nada —
   use índice único e `INSERT OR IGNORE`.
9. **Celular primeiro:** toda tela funciona em 360 px.
10. **Segredo só em variável de ambiente** ou cifrado no banco; nunca em código, log ou conversa.
11. **Sem `innerHTML` com dado de fora, sem lista sem paginação, sem JSON gigante, sem módulo que falha calado.**
12. **Arquitetura:** modular sem fragmentar; regra no módulo dono dela; não recalcular nem reconsultar o que não
    mudou (nada de consulta por linha de lista); a menor alteração que resolve; investigar quem usa antes de mudar.

## 3. Mapa das etapas

| Etapa | O que entrega | Pré-requisito do BRE? | Tamanho |
| --- | --- | --- | --- |
| **E0** | Testes de verdade (`node:test` + SQLite temporário) e CI rodando | **Sim** | P |
| **E1** | Migrações numeradas com erro barulhento | **Sim** | P |
| **E2** | Agendador único persistido (substitui os `setInterval`) | **Sim** | P |
| **E3** | Validação e erro padronizados | **Sim** | P |
| **E4** | Camadas: rota → serviço → regra (começando pelo CRM) | Recomendado | M |
| **E5** | Módulos que falham alto + página de saúde | Recomendado | P |
| **E6** | Front seguro: helper `h()` no lugar de `innerHTML` em dado novo; paginação | Sim para telas do BRE | M (gradual) |
| **E7** | Segredos, LGPD e retenção | Antes de ligar a IA | P |
| **E8** | `CLAUDE.md` do Lumen + checklist de PR | Sim | P |

E0–E3 e E8 são pequenos e destravam o BRE. E4–E6 andam em paralelo, arquivo por arquivo, sempre que alguém mexer
naquele trecho ("deixe o lugar melhor do que encontrou") — **sem reescrita grande**.

---

## 4. E0 — Rede de segurança: testes e CI

**Por quê:** hoje nada impede uma regra de quebrar. O BRE chega com ~25 critérios de aceite que precisam virar
testes automáticos.

**O que fazer:**
- Usar o executor que já vem no Node 20: `node:test` + `node:assert/strict`. **Nenhuma dependência nova.**
- Pasta `test/`, um arquivo `*.test.js` por módulo. Regras puras testam sem banco; o que toca banco usa um SQLite
  em memória montado pelo mesmo `db/*.sql` de produção.
- `package.json`:

```json
"scripts": {
  "start": "node server.js",
  "seed": "node db/seed.js",
  "verificar": "node scripts/verificar.js",
  "test": "node scripts/verificar.js && node --test"
}
```

> `node --test` sem argumento acha `test/**/*.test.js` sozinho. Não passe a pasta (`node --test test/`): em
> versões novas do Node isso falha.

- Ajudante de banco para testes (`test/ajuda/banco.js`):

```js
"use strict";
// SQLite novo, em memória, com o MESMO esquema de produção. Cada teste começa limpo.
const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");

function bancoDeTeste(arquivos = ["schema.sql", "crm.sql"]) {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  for (const a of arquivos) db.exec(fs.readFileSync(path.join(__dirname, "../../db", a), "utf8"));
  return db;
}
module.exports = { bancoDeTeste };
```

- Para testar rotas sem subir porta: exportar o `app` do Express num `app.js` (o `server.js` só faz `listen`) e usar
  `fetch` contra `app.listen(0)` no teste. Para isso o `db/index.js` precisa aceitar `DATA_DIR` de teste (um
  diretório temporário com `fs.mkdtempSync`).
- CI (`.github/workflows/*.yml`) já roda `npm test`: passa a rodar os testes de verdade sem mudar o arquivo.

**Pronto quando:** `npm test` roda pelo menos um teste de regra pura e um de rota com banco; CI verde.

## 5. E1 — Migrações numeradas com erro barulhento

**Por quê:** `try { db.exec("ALTER …") } catch (e) { /* já existe */ }` engole também erro de digitação, de tabela
inexistente e de disco cheio.

**O que fazer:** manter o que funciona (os `.sql` idempotentes rodando no boot) e trocar **só** os `ALTER` soltos
por uma pasta numerada com executor que **só ignora o erro esperado**:

```
db/migracoes/
  001_colunas_existentes.js   ← move a lista atual de ALTERs para cá, sem mudar nada
  002_bre_colunas.js          ← primeira migração nova (do BRE)
```

```js
// db/migrar.js — roda no boot, depois dos .sql idempotentes.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

/** Adiciona a coluna só se não existir. Qualquer outro erro derruba o boot (nada falha em silêncio). */
function adicionarColuna(db, tabela, coluna, definicao) {
  const existe = db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`).get(tabela, coluna);
  if (!existe) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
}

function migrar(db, log = console) {
  db.exec("CREATE TABLE IF NOT EXISTS migracoes (nome TEXT PRIMARY KEY, executada_em TEXT NOT NULL DEFAULT (datetime('now')))");
  const pasta = path.join(__dirname, "migracoes");
  for (const arquivo of fs.readdirSync(pasta).filter(a => /^\d{3}_.+\.js$/.test(a)).sort()) {
    const nome = arquivo.replace(/\.js$/, "");
    if (db.prepare("SELECT 1 FROM migracoes WHERE nome = ?").get(nome)) continue;
    const { aplicar } = require(path.join(pasta, arquivo));
    db.transaction(() => {
      aplicar(db, { adicionarColuna: (t, c, d) => adicionarColuna(db, t, c, d) });
      db.prepare("INSERT INTO migracoes (nome) VALUES (?)").run(nome);
    })();
    log.log(`[migração] ${nome} aplicada`);
  }
}
module.exports = { migrar, adicionarColuna };
```

```js
// db/migracoes/001_colunas_existentes.js — a lista que hoje está em db/index.js, sem mudar o efeito.
exports.aplicar = (db, { adicionarColuna }) => {
  adicionarColuna(db, "schedules", "notif_removida_em", "TEXT");
  adicionarColuna(db, "crm_contatos", "excluido_por", "INTEGER");
  // … uma linha por ALTER que existe hoje …
};
```

Regras:
- Migração **nunca** muda depois de publicada; correção = migração nova.
- Só aditiva: adicionar tabela/coluna/índice. Renomear ou apagar coluna exige plano e aprovação.
- Teste: `test/migrar.test.js` roda `migrar` duas vezes num banco de teste e confere que não muda nada na segunda.

**Pronto quando:** `db/index.js` não tem mais `try/catch` vazio em volta de `ALTER`; boot de banco antigo e de
banco novo dão o mesmo esquema (teste compara `sqlite_master`).

## 6. E2 — Agendador único persistido

**Por quê:** `setInterval` perde a rotina quando o servidor reinicia no horário, não registra quando rodou nem
se falhou, e cada módulo inventa o seu. O BRE precisa de 5 rotinas.

**O que fazer:** copiar `lib/agendador.js` (código completo e testado no **Apêndice D** do documento do BRE; ele
cria sozinho a tabela `rotinas`):

- um relógio só (30 s, `.unref()`), iniciado no `server.js` depois do `listen`;
- cada rotina declara a regra (`diaria 03:07`, `horaria :11`, `intervalo 1 min`) e o estado fica na tabela
  `rotinas` (última execução em hora local, último erro, duração);
- rotina atrasada (servidor fora no horário) roda **uma vez** quando ele volta;
- rotina que ainda está rodando não é chamada de novo; erro fica gravado e aparece na página de saúde (E5).

Migrar os dois `setInterval` de regra:

```js
// server.js, depois do app.listen
const { criarAgendador } = require("./lib/agendador");
const agendador = criarAgendador({ db, horaLocal });
agendador.registrar("backup_diario", { tipo: "diaria", hora: "02:17" }, fazerBackupDoDia);
agendador.registrar("telefone_limpeza", { tipo: "intervalo", minutos: 30 }, () => { limparGravacoesAntigas(); fecharAbandonadas(); });
agendador.iniciar();
```

O `setInterval` do SSE (`lib/comum.js:76`, "pulso" a cada 25 s) **fica**: é manutenção de conexão, não rotina.

Horários "quebrados" (02:17, 03:07, :11) são de propósito: evitam tudo rodar junto na hora cheia.

**Requisito:** uma réplica só no Railway (já é a regra do Lumen por causa do SSE em memória). Escrever isso no
README.

**Pronto quando:** `grep -rn setInterval lib services routes` só mostra o pulso do SSE; a página de saúde lista as
rotinas com última execução.

## 7. E3 — Validação e erro padronizados

**Por quê:** cada rota valida de um jeito e o formato do erro varia (`{ error: "texto" }`, `erro(res, …)`). O BRE
precisa devolver **qual campo** falhou para a tela marcar o campo.

**O que fazer (sem dependência nova):**

```js
// lib/http.js
"use strict";
class ErroDeNegocio extends Error {
  constructor(status, codigo, mensagem, detalhes) { super(mensagem); this.status = status; this.codigo = codigo; this.detalhes = detalhes; }
}
const erroDeCampo = (campo, mensagem) => new ErroDeNegocio(400, "dados_invalidos", mensagem, { campo });

/** Envolve a rota: ErroDeNegocio vira resposta; o resto é 500 com log (nunca o stack para o usuário). */
const rota = fn => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    if (e instanceof ErroDeNegocio) return res.status(e.status).json({ error: e.message, codigo: e.codigo, detalhes: e.detalhes || null });
    console.error(`[${req.method} ${req.originalUrl}]`, e);
    res.status(500).json({ error: "Algo deu errado do nosso lado. Tente de novo; se continuar, avise o gestor.", codigo: "erro_interno" });
  }
};

/** Paginação padrão: ?limite (1–100, padrão 30) e ?cursor (id da última linha vista). */
function paginacao(req) {
  const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 30, 1), 100);
  const cursor = req.query.cursor ? parseInt(req.query.cursor, 10) : null;
  return { limite, cursor: Number.isFinite(cursor) ? cursor : null };
}
module.exports = { ErroDeNegocio, erroDeCampo, rota, paginacao };
```

- O formato **continua compatível** com o front atual (`error` é texto), só ganha `codigo` e `detalhes`.
- Validadores ficam junto da regra do domínio, como funções puras que devolvem `{ ok, dados }` ou
  `{ ok: false, campo, erro }` (o BRE já vem assim: `validarRegistro`, `validarEncerramento`, `validarConfig`).
- Toda listagem nova usa `paginacao(req)` e devolve `{ itens, proximoCursor }`.

**Pronto quando:** rotas novas usam `rota()`; teste confere que um erro de negócio volta 400 com `detalhes.campo`
e que uma exceção qualquer volta 500 sem stack.

## 8. E4 — Camadas: rota → serviço → regra

**Por quê:** `routes/crm.js` mistura consulta, regra, efeito colateral e resposta. O BRE precisa "pendurar" efeitos
no mover/ganho/perdido sem duplicar código e sem a rota do CRM conhecer o BRE por dentro.

**Forma alvo de um domínio:**

```
lib/<dominio>/
  regras.js      ← puro: listas, cálculos, validação. Sem banco, sem req/res. 100% testado.
  servico.js     ← orquestra: transação, banco, efeitos (timeline, aviso, auditoria). Recebe { db, usuario }.
routes/<dominio>.js ← só HTTP: permissão, ler req, chamar serviço, responder.
```

**Como chegar lá sem reescrever:** só quando for mexer. O primeiro caso é o próprio BRE (nasce assim) e o segundo
é extrair de `routes/crm.js` as funções que o BRE precisa chamar:

```js
// lib/crm/servico.js — extraído de routes/crm.js, MESMO comportamento.
function moverNegocio(db, { negocio, etapaId, antesDeId, usuarioId }) { /* código atual da rota */ return { mudouEtapa, de, para }; }
function marcarGanho(db, { negocio, vendaId, usuarioId }) { /* … */ }
function marcarPerdido(db, { negocio, motivo, detalhe, usuarioId }) { /* … */ }
```

A rota passa a ser três linhas e o BRE se liga por **ganchos** (próxima seção), não por `if` dentro do CRM.

**Ganchos (eventos de domínio, em processo):** um emissor simples para os módulos se ouvirem sem se importarem:

```js
// lib/eventos.js
"use strict";
const ouvintes = new Map();
function ouvir(nome, fn) { (ouvintes.get(nome) || ouvintes.set(nome, []).get(nome)).push(fn); }
/** Chama os ouvintes NA MESMA transação de quem publicou (síncrono, better-sqlite3). Erro de ouvinte desfaz tudo. */
function publicarEvento(nome, dados) { for (const fn of ouvintes.get(nome) || []) fn(dados); }
module.exports = { ouvir, publicarEvento };
```

O serviço do CRM publica `crm.negocio_movido`, `crm.negocio_ganho`, `crm.negocio_perdido`, `crm.negocio_reaberto`
dentro da transação; o BRE ouve. Se o BRE estiver desligado, ninguém ouve e o CRM segue igual.

**Pronto quando:** as quatro ações do funil chamam o serviço; um teste move um negócio e confere timeline e evento.

## 9. E5 — Nenhum módulo falha em silêncio + página de saúde

**Por quê:** `server.js:80` carrega a fila dentro de `try/catch`; se falha, o resto sobe e a fila some sem aviso.

**O que fazer:**
- Carregar todo router normalmente. Se um módulo é opcional (depende de algo que pode faltar), declarar isso e
  registrar o motivo num `estadoModulos`:

```js
const estadoModulos = {};
function montar(caminho, modulo, { opcional = false } = {}) {
  try { app.use(caminho, require(modulo)); estadoModulos[caminho] = { ok: true }; }
  catch (e) {
    estadoModulos[caminho] = { ok: false, erro: e.message };
    console.error(`[módulo] ${caminho} NÃO carregou:`, e);
    if (!opcional || process.env.NODE_ENV !== "production") throw e;
  }
}
```

- `/api/health` continua leve (Railway); uma rota nova `/api/saude` (só gestor) mostra módulos, rotinas do
  agendador (última execução e último erro), tamanho do banco, espaço do Volume e fila da IA do BRE.
- O front mostra um aviso amarelo no topo para o gestor quando algo da saúde está vermelho.

**Pronto quando:** derrubar um módulo de propósito em teste faz o boot falhar (ou aparecer vermelho na saúde, se
opcional).

## 10. E6 — Front seguro e leve

**Por quê:** 283 `innerHTML` dependem de ninguém esquecer `esc()`. O BRE mostra texto livre (comentário do Break,
interesse, saída da IA, feedback do SQ) — o lugar exato onde um esquecimento vira XSS.

**Regra daqui para frente:** código **novo** não usa `innerHTML` com dado; usa um ajudante que cria elementos:

```js
// public/h.js — carregado antes dos módulos. Texto entra como textContent: impossível injetar HTML.
function h(tag, atributos, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(atributos || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const f of filhos.flat()) if (f != null && f !== false) el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  return el;
}
```

- Código existente: trocar quando mexer no trecho; não é preciso uma varredura de uma vez.
- Sem variáveis globais novas: cada `public/<modulo>.js` fica dentro de uma IIFE e expõe no máximo um objeto
  (`window.BRE = { abrirRegistro }`).
- Listas grandes (fila do dia, breaks, execuções, ranking) pedem página a página (`cursor`), com "Carregar mais".
- Tempo real: ao receber o evento SSE, recarregar **só** o bloco afetado, não a tela toda; nada de consulta por
  linha (uma consulta traz a lista com o que cada linha precisa).
- 360 px: toda tela nova é conferida no celular (DevTools, largura 360) antes do PR.

**Pronto quando:** as telas do BRE não têm `innerHTML`; `grep -c innerHTML public/*.js` só cai com o tempo.

## 11. E7 — Segredos, LGPD e retenção

- **Segredos:** a chave da IA é `ANTHROPIC_API_KEY` no Railway (Variables). Nunca no código, no banco aberto, no
  log ou no chat. Sem chave, o BRE usa a IA de demonstração.
- O `SESSION_SECRET` do Lumen hoje é gerado num arquivo se faltar (`server.js:43`): em produção, preferir a variável
  de ambiente e falhar o boot se ela não existir.
- **Log:** nunca logar corpo de requisição, conversa ou saída da IA; logar ids e códigos.
- **LGPD (antes de ligar a IA de verdade):** base legal (legítimo interesse ou execução de contrato), aviso no
  primeiro contato/termos da escola, mascaramento ligado (padrão no Lumen: `mascararDadosIa = true`), contrato com
  o provedor sem uso para treino e prazo de retenção (sugestão: análises da IA guardadas 12 meses, depois
  anonimizadas por rotina do agendador).
- "Não contatar" é absoluto: nada vai para a IA, nenhuma automação envia, nenhuma fila lista.

## 12. E8 — `CLAUDE.md` do Lumen e checklist de PR

Crie `CLAUDE.md` na raiz do Lumen (o agente lê sozinho em toda sessão):

```markdown
# Lumen Operações — regras do projeto

Sistema interno da Lumen Idiomas (agenda/horas, turmas, CRM, WhatsApp, fila de ligações, monitoramento comercial
e motor BRE), em português do Brasil. Pilha: Node 20, JavaScript CommonJS, Express 4, SQLite (better-sqlite3),
front em JS puro (PWA). **Não mudar a pilha sem perguntar.**

## Princípios
1. Regra de negócio em `lib/<dominio>/regras.js` (pura e testada); efeitos em `lib/<dominio>/servico.js`;
   rota só faz HTTP.
2. Permissão checada no servidor em toda rota (`requirePermission`). Escopo: vendedor vê só a própria carteira.
3. Nada some: arquivar com `deleted_at` e motivo. Prova (registros BRE, notas, auditoria) é só de inserção.
4. Esquema: `.sql` idempotentes + `db/migracoes/NNN_*.js` numeradas, aditivas, nunca editadas depois de publicadas.
5. Rotinas só pelo agendador único (`lib/agendador.js`). Proibido `setInterval` para regra.
6. Telefone normalizado (`chaveTelefone`) é a chave; repetir uma ação nunca duplica (índice único).
7. Celular primeiro: toda tela em 360 px.
8. Segredo só em variável de ambiente ou `cifrar()` no banco. Nunca em código, log ou chat — diga qual variável criar.
9. Front: sem `innerHTML` com dado (use `h()`), sem global nova, lista sempre paginada.
10. Nenhum módulo falha em silêncio: erro aparece no log e na página de saúde.
11. Fornecedor externo atrás de interface com versão de demonstração (IA do BRE, WhatsApp, telefonia).

## Como trabalhar
- Antes de cada etapa: plano curto (arquivos, tabelas, rotas, testes) e esperar o ok.
- Commits pequenos (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`), testes junto com o código.
- Antes do PR: `npm test` verde e tela conferida em 360 px.
- Modular sem fragmentar; regra no módulo dono dela; não recalcular/reconsultar o que não mudou; a menor
  alteração que resolve; investigar quem usa antes de mudar.
- Ao fim: arquivos modificados, responsabilidades, dependências afetadas, otimizações e testes executados.
- Antes de declarar pronto, reler o diff procurando: rota sem permissão, vendedor vendo carteira alheia,
  duplicação por telefone, texto em inglês na tela, `innerHTML` com dado, lista sem paginação e tela quebrada no
  celular.

## Referências
`docs/LUMEN_EVOLUCAO_ESTRUTURA.md` (estrutura) · `docs/LUMEN_IMPLANTACAO_BRE.md` (motor BRE).
```

**Checklist de PR** (colar na descrição de todo PR):

```markdown
- [ ] `npm test` verde (sintaxe + boot + testes)
- [ ] Toda rota nova tem `requirePermission` e respeita a carteira do vendedor
- [ ] Migração nova é aditiva e numerada; nada editado em migração antiga
- [ ] Nenhum `setInterval` de regra; rotina nova registrada no agendador
- [ ] Nenhum `innerHTML` com dado; listas paginadas
- [ ] Tela conferida em 360 px
- [ ] Nenhum segredo em código, log ou PR
- [ ] Repetir a ação (duplo clique, rotina de novo) não duplica nada
- [ ] Relatório: arquivos, responsabilidades, dependências, otimizações, testes
```

## 13. O que **não** fazer agora

- **Não migrar para TypeScript, Postgres, Fastify ou React.** O ganho do Lumen está em testes, camadas e rotinas,
  não em trocar a pilha. Uma troca de pilha é um projeto à parte, com plano próprio.
- **Não reescrever `routes/crm.js` inteiro.** Extrair só o que o BRE precisa, com teste antes e depois.
- **Não adicionar fila de jobs externa (Redis, pg-boss).** Com uma réplica e SQLite, a tabela-fila + agendador
  único resolvem e não pedem infraestrutura nova.
- **Não multiempresa.** O Lumen é de uma escola só; o BRE no Lumen não tem `empresa_id` (ver documento irmão).
  Se um dia virar produto, o caminho é o Menezes Gestão.

## 14. Ordem sugerida de PRs

1. `test: rede de segurança com node:test e banco em memória` (E0)
2. `refactor: migrações numeradas com erro barulhento` (E1)
3. `refactor: agendador único persistido no lugar dos setInterval` (E2)
4. `feat: erro e paginação padronizados (lib/http.js)` (E3)
5. `docs: CLAUDE.md e checklist de PR` (E8)
6. `refactor: serviço do funil e eventos de domínio` (E4, só o que o BRE usa)
7. `feat: página de saúde e módulos que falham alto` (E5)
8. Daqui em diante: **documento do BRE, Fase B0 em diante.** E6 e E7 entram junto com as telas e a IA do BRE.
