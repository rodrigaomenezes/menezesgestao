// Pesquisas com link público: o cliente responde sem login (/p/<token>); a empresa vê os resultados agregados.
import { randomBytes } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Pagina, Pergunta, PesquisaDto, PesquisaPublicaDto, ResultadoPesquisaDto } from "@mg/shared";
import { comEmpresa, comoSistema, type Tx } from "../../infra/banco.js";
import { empresa, pesquisa, respostaPesquisa } from "../../infra/esquema.js";
import { ErroApp, invalido, naoEncontrado } from "../../infra/erros.js";
import { condicaoCursor, iso, lerCursor, montarPagina } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import { publicar } from "../eventos/publicar.js";

// Coluna qualificada à mão: sem join, o Drizzle escreve só "id", que dentro da subconsulta seria r.id.
const respondidas = sql<number>`(SELECT count(*)::int FROM resposta_pesquisa r WHERE r.pesquisa_id = ${sql.raw('"pesquisa"."id"')})`;

/** Confere as respostas contra as perguntas: obrigatórias, opções válidas e notas de 0 a 10. */
export function validarRespostas(perguntas: Pergunta[], respostas: Record<string, string | number>): Record<string, string | number> {
  const limpas: Record<string, string | number> = {};
  for (const p of perguntas) {
    const v = respostas[p.id];
    const vazio = v === undefined || v === null || (typeof v === "string" && !v.trim());
    if (vazio) {
      if (p.obrigatoria) throw invalido(`Responda: “${p.texto}”.`, { pergunta: p.id });
      continue;
    }
    if (p.tipo === "nota") {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 10) throw invalido(`“${p.texto}”: escolha uma nota de 0 a 10.`, { pergunta: p.id });
      limpas[p.id] = n;
    } else if (p.tipo === "escolha") {
      if (typeof v !== "string" || !p.opcoes?.includes(v)) throw invalido(`“${p.texto}”: escolha uma das opções.`, { pergunta: p.id });
      limpas[p.id] = v;
    } else {
      limpas[p.id] = String(v).trim().slice(0, 2000);
    }
  }
  return limpas;
}

export function criarServicoPesquisa(s: Servicos) {
  const { banco } = s;

  const colunas = {
    id: pesquisa.id,
    titulo: pesquisa.titulo,
    descricao: pesquisa.descricao,
    perguntas: pesquisa.perguntas,
    token: pesquisa.token,
    aberta: pesquisa.aberta,
    respostas: respondidas,
    arquivadoEm: pesquisa.arquivadoEm,
    criadoEm: pesquisa.criadoEm,
  };
  type Linha = { id: string; titulo: string; descricao: string | null; perguntas: Pergunta[]; token: string; aberta: boolean; respostas: number; arquivadoEm: Date | null; criadoEm: Date };
  const dto = (l: Linha): PesquisaDto => ({ ...l, respostas: Number(l.respostas), arquivadoEm: iso(l.arquivadoEm), criadoEm: iso(l.criadoEm) });

  async function carregar(tx: Tx, ctx: ContextoEmpresa, id: string): Promise<Linha> {
    const [l] = await tx.db.select(colunas).from(pesquisa).where(and(eq(pesquisa.id, id), eq(pesquisa.empresaId, ctx.empresaId)));
    if (!l) throw naoEncontrado("Pesquisa");
    return l as Linha;
  }

  async function listar(ctx: ContextoEmpresa, f: { arquivados: "sim" | "nao"; cursor?: string; limite: number }): Promise<Pagina<PesquisaDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = await tx.db
        .select(colunas)
        .from(pesquisa)
        .where(
          and(
            eq(pesquisa.empresaId, ctx.empresaId),
            f.arquivados === "sim" ? isNotNull(pesquisa.arquivadoEm) : isNull(pesquisa.arquivadoEm),
            condicaoCursor(pesquisa.criadoEm, pesquisa.id, lerCursor(f.cursor)),
          ),
        )
        .orderBy(desc(pesquisa.criadoEm), desc(pesquisa.id))
        .limit(f.limite + 1);
      return montarPagina(linhas as Linha[], f.limite, dto);
    });
  }

  async function obter(ctx: ContextoEmpresa, id: string): Promise<PesquisaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => dto(await carregar(tx, ctx, id)));
  }

  async function criar(ctx: ContextoEmpresa, origem: Origem, d: { titulo: string; descricao: string | null; perguntas: Pergunta[] }): Promise<PesquisaDto> {
    if (new Set(d.perguntas.map((p) => p.id)).size !== d.perguntas.length) throw invalido("Duas perguntas têm o mesmo identificador.");
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [{ id }] = await tx.db
        .insert(pesquisa)
        .values({ empresaId: ctx.empresaId, titulo: d.titulo, descricao: d.descricao, perguntas: d.perguntas, token: randomBytes(18).toString("base64url"), criadoPor: ctx.usuarioId })
        .returning({ id: pesquisa.id });
      await registrar(tx, origem, { acao: "pesquisa.criada", entidade: "pesquisa", entidadeId: id, depois: { titulo: d.titulo, perguntas: d.perguntas.length } });
      return dto(await carregar(tx, ctx, id));
    });
  }

  async function atualizar(ctx: ContextoEmpresa, origem: Origem, id: string, d: { titulo?: string; descricao?: string | null; aberta?: boolean; arquivar?: boolean }): Promise<PesquisaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await carregar(tx, ctx, id);
      await tx.db
        .update(pesquisa)
        .set({
          ...(d.titulo !== undefined ? { titulo: d.titulo } : {}),
          ...(d.descricao !== undefined ? { descricao: d.descricao } : {}),
          ...(d.aberta !== undefined ? { aberta: d.aberta } : {}),
          ...(d.arquivar !== undefined ? { arquivadoEm: d.arquivar ? new Date() : null } : {}),
          atualizadoEm: new Date(),
        })
        .where(eq(pesquisa.id, id));
      await registrar(tx, origem, { acao: d.arquivar ? "pesquisa.arquivada" : "pesquisa.atualizada", entidade: "pesquisa", entidadeId: id, depois: d });
      return dto(await carregar(tx, ctx, id));
    });
  }

  async function resultados(ctx: ContextoEmpresa, id: string): Promise<ResultadoPesquisaDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const p = await carregar(tx, ctx, id);
      const perguntas: ResultadoPesquisaDto["perguntas"] = [];
      for (const q of p.perguntas) {
        const valor = sql`${respostaPesquisa.respostas}->>${q.id}`;
        const base = and(eq(respostaPesquisa.pesquisaId, id), sql`${respostaPesquisa.respostas} ? ${q.id}`);
        const [{ n }] = await tx.db.select({ n: sql<number>`count(*)::int` }).from(respostaPesquisa).where(base);
        const item: ResultadoPesquisaDto["perguntas"][number] = { id: q.id, texto: q.texto, tipo: q.tipo, respondidas: Number(n) };
        if (q.tipo === "escolha") {
          const linhas = await tx.db.select({ opcao: sql<string>`${valor}`, total: sql<number>`count(*)::int` }).from(respostaPesquisa).where(base).groupBy(sql`1`);
          item.opcoes = (q.opcoes ?? []).map((o) => ({ opcao: o, total: Number(linhas.find((l) => l.opcao === o)?.total ?? 0) }));
        } else if (q.tipo === "nota") {
          const [m] = await tx.db.select({ media: sql<string | null>`round(avg((${valor})::numeric), 1)` }).from(respostaPesquisa).where(base);
          item.media = m.media === null ? null : Number(m.media);
        } else {
          const linhas = await tx.db.select({ texto: sql<string>`${valor}` }).from(respostaPesquisa).where(base).orderBy(desc(respostaPesquisa.criadoEm)).limit(20);
          item.ultimas = linhas.map((l) => l.texto);
        }
        perguntas.push(item);
      }
      return { total: Number(p.respostas), perguntas };
    });
  }

  // Público ---------------------------------------------------------------------------------------------

  async function porToken(token: string) {
    const [p] = await comoSistema(banco, (tx) =>
      tx.db
        .select({ id: pesquisa.id, empresaId: pesquisa.empresaId, titulo: pesquisa.titulo, descricao: pesquisa.descricao, perguntas: pesquisa.perguntas, aberta: pesquisa.aberta, empresa: empresa.nome })
        .from(pesquisa)
        .innerJoin(empresa, eq(empresa.id, pesquisa.empresaId))
        .where(and(eq(pesquisa.token, token), isNull(pesquisa.arquivadoEm), isNull(empresa.arquivadoEm))),
    );
    if (!p) throw naoEncontrado("Pesquisa");
    return p;
  }

  async function publica(token: string): Promise<PesquisaPublicaDto> {
    const p = await porToken(token);
    return { titulo: p.titulo, descricao: p.descricao, empresa: p.empresa, perguntas: p.perguntas, aberta: p.aberta };
  }

  async function responder(token: string, respostas: Record<string, string | number>): Promise<{ ok: true }> {
    const p = await porToken(token);
    if (!p.aberta) throw new ErroApp(409, "CONFLITO", "Esta pesquisa foi encerrada e não recebe mais respostas. Obrigado pelo interesse!");
    const limpas = validarRespostas(p.perguntas, respostas);
    if (!Object.keys(limpas).length) throw invalido("Responda pelo menos uma pergunta.");
    await comEmpresa(banco, p.empresaId, async (tx) => {
      const [{ id }] = await tx.db.insert(respostaPesquisa).values({ empresaId: p.empresaId, pesquisaId: p.id, respostas: limpas }).returning({ id: respostaPesquisa.id });
      await publicar(tx, { empresaId: p.empresaId, atorId: null, ip: null, dispositivo: null }, { tipo: "pesquisa.respondida", entidade: "pesquisa", entidadeId: p.id, dados: { respostaId: id } });
    });
    return { ok: true as const };
  }

  return { listar, obter, criar, atualizar, resultados, publica, responder };
}
