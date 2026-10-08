// Critério de pronto da fase 0: um usuário da empresa A não lê nem altera nada da empresa B.
// O teste percorre TODAS as rotas registradas (rotas novas entram automaticamente), logado como
// Dono de A (o perfil com mais permissões), trocando cada :id por cada identificador conhecido de B.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { comoSistema } from "./db/banco.js";
import { notificar } from "./nucleo/notificacoes.js";
import {
  email,
  logado,
  montarTeste,
  semearDuasEmpresas,
  type AmbienteTeste,
  type Cliente,
  type EmpresasTeste,
} from "./teste/app-teste.js";

let t: AmbienteTeste;
let e: EmpresasTeste;
let idsB: string[];
let marcasDeB: string[];
let sessaoB: string;

// Rotas que não fazem sentido no varrimento (encerram a própria sessão ou ficam abertas).
const FORA = new Set(["POST /api/auth/sair", "GET /api/tempo-real"]);

beforeAll(async () => {
  t = await montarTeste();
  e = await semearDuasEmpresas(t.banco);

  // Dados extras em B: uma notificação e uma sessão aberta.
  await comoSistema(t.banco, (tx) =>
    notificar(tx, { empresaId: e.b.empresaId, atorId: null, ip: null, dispositivo: null }, {
      usuarioId: e.b.pessoas.dono.usuarioId,
      titulo: "Segredo da empresa B",
    }),
  );
  await logado(t.app, email(e.b, "dono"));
  const { rows } = await t.banco.pool.query<{ id: string }>("SELECT id FROM sessao WHERE usuario_id = $1 LIMIT 1", [
    e.b.pessoas.dono.usuarioId,
  ]);
  sessaoB = rows[0].id;

  // A consultora pertence às duas empresas: os dados pessoais dela são legítimos em A.
  const pessoasSoDeB = Object.entries(e.b.pessoas).filter(([chave]) => chave !== "consultor");
  const { rows: notif } = await t.banco.pool.query<{ id: string }>("SELECT id FROM notificacao WHERE empresa_id = $1", [
    e.b.empresaId,
  ]);
  idsB = [
    e.b.empresaId,
    ...Object.values(e.b.perfis),
    ...Object.values(e.b.unidades),
    ...Object.values(e.b.equipes),
    ...pessoasSoDeB.flatMap(([, p]) => [p.usuarioId, p.vinculoId]),
    e.b.pessoas.consultor.vinculoId,
    ...notif.map((n) => n.id),
    sessaoB,
  ];
  marcasDeB = [
    ...idsB,
    e.b.d.nome,
    "Segredo da empresa B",
    ...Object.keys(e.b.equipes),
    ...e.b.d.pessoas.filter((p) => p.chave !== "consultor").flatMap((p) => [p.email, p.nome]),
  ];
});
afterAll(() => t.fechar());

/** Retrato de tudo o que pertence a B, para provar que nada mudou. */
async function retratoDeB(): Promise<Record<string, string>> {
  const { rows: tabelas } = await t.banco.pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'empresa_id' ORDER BY table_name`,
  );
  const retrato: Record<string, string> = {};
  for (const { table_name: tabela } of tabelas) {
    const coluna = tabela === "sessao" ? "ultimo_uso" : null;
    const { rows } = await t.banco.pool.query<{ h: string | null }>(
      `SELECT md5(string_agg((to_jsonb(x) ${coluna ? `- '${coluna}'` : ""})::text, '|' ORDER BY x.id)) AS h
         FROM ${tabela} x WHERE empresa_id = $1`,
      [e.b.empresaId],
    );
    retrato[tabela] = rows[0].h ?? "";
  }
  const empresa = await t.banco.pool.query("SELECT to_jsonb(x)::text AS j FROM empresa x WHERE id = $1", [e.b.empresaId]);
  retrato.empresa = empresa.rows[0].j;
  const usuarios = await t.banco.pool.query(
    "SELECT md5(string_agg(to_jsonb(u)::text, '|' ORDER BY u.id)) AS h FROM usuario u WHERE id IN (SELECT usuario_id FROM vinculo WHERE empresa_id = $1)",
    [e.b.empresaId],
  );
  retrato.usuario = usuarios.rows[0].h;
  return retrato;
}

/** Corpo genérico que tenta apontar tudo para B. */
function corpoInvasor(): Record<string, unknown> {
  return {
    nome: "Invasão",
    email: `invasao.${Date.now()}@teste.example.com`,
    senha: "uma senha qualquer longa",
    token: "x".repeat(43),
    empresaId: e.b.empresaId,
    perfilId: e.b.perfis.dono,
    copiarDe: e.b.perfis.dono,
    unidadeId: e.b.unidades.Matriz,
    equipeId: Object.values(e.b.equipes)[0],
    gestorId: e.b.pessoas.gestor.usuarioId,
    permissoes: { usuarios: { ver: "empresa" } },
  };
}

function semVazamento(rota: string, corpo: string) {
  for (const marca of marcasDeB) {
    expect(corpo.includes(marca), `${rota} vazou "${marca}"`).toBe(false);
  }
}

describe("isolamento entre empresas", () => {
  let dono: Cliente;
  beforeAll(async () => {
    dono = await logado(t.app, email(e.a, "dono"));
  });

  it("a varredura cobre todas as rotas da API", () => {
    expect(t.rotas.length).toBeGreaterThanOrEqual(30);
    for (const r of t.rotas) expect(r.acesso, `${r.metodo} ${r.url}`).toBeDefined();
  });

  it("nenhuma rota devolve ou altera dados de B, mesmo recebendo ids de B", async () => {
    const antes = await retratoDeB();
    let chamadas = 0;

    for (const rota of t.rotas) {
      const nome = `${rota.metodo} ${rota.url}`;
      if (FORA.has(nome)) continue;
      const comId = rota.url.includes(":id");
      const urls = comId ? idsB.map((id) => rota.url.replace(":id", id)) : [rota.url];

      for (const url of urls) {
        const res = await dono.pedir(rota.metodo as "GET", url, rota.metodo === "GET" ? undefined : corpoInvasor());
        chamadas++;
        semVazamento(`${nome} (${url})`, res.body);
        if (comId) {
          expect(res.statusCode, `${nome} com id de B respondeu ${res.statusCode}: ${res.body}`).toBeGreaterThanOrEqual(400);
        }
      }
    }

    expect(chamadas).toBeGreaterThan(200);
    expect(await retratoDeB()).toEqual(antes);
  });

  it("listagens devolvem só dados de A", async () => {
    for (const url of ["/api/usuarios", "/api/equipes", "/api/unidades", "/api/perfis", "/api/auditoria"]) {
      const res = await dono.get(url);
      expect(res.statusCode, url).toBe(200);
      expect(res.json().itens.length, url).toBeGreaterThan(0);
      semVazamento(url, res.body);
    }
  });

  it("a sessão aberta em B não é visível nem encerrável por A", async () => {
    expect((await dono.delete(`/api/auth/sessoes/${sessaoB}`)).statusCode).toBe(404);
    const { rows } = await t.banco.pool.query("SELECT encerrada_em FROM sessao WHERE id = $1", [sessaoB]);
    expect(rows[0].encerrada_em).toBeNull();
  });
});
