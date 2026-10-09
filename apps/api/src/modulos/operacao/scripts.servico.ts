// Biblioteca de scripts: roteiros por funil/etapa, abertos de dentro da conversa e da ligação.
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Pagina, ScriptDto } from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { etapa, funil, oportunidade, script } from "../../infra/esquema.js";
import { invalido, naoEncontrado } from "../../infra/erros.js";
import { condicaoCursor, iso, lerCursor, montarPagina } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { registrar, type Origem } from "../auditoria/registro.js";

type Uso = "todos" | "conversa" | "ligacao";
type Dados = { titulo?: string; texto?: string; uso?: Uso; funilId?: string | null; etapaId?: string | null; ordem?: number; arquivar?: boolean };

export function criarServicoScripts(s: Servicos) {
  const { banco } = s;

  function consulta(tx: Tx) {
    return tx.db
      .select({
        id: script.id,
        titulo: script.titulo,
        texto: script.texto,
        uso: script.uso,
        funilId: script.funilId,
        funilNome: funil.nome,
        etapaId: script.etapaId,
        etapaNome: etapa.nome,
        ordem: script.ordem,
        criadoEm: script.criadoEm,
        arquivadoEm: script.arquivadoEm,
      })
      .from(script)
      .leftJoin(funil, eq(funil.id, script.funilId))
      .leftJoin(etapa, eq(etapa.id, script.etapaId));
  }
  type Linha = Awaited<ReturnType<ReturnType<typeof consulta>["execute"]>>[number];
  const dto = ({ criadoEm: _c, ...l }: Linha): ScriptDto => ({ ...l, arquivadoEm: iso(l.arquivadoEm) });

  /** Etapa da oportunidade aberta mais recente do contato (para sugerir o roteiro certo). */
  async function etapaDoContato(tx: Tx, empresaId: string, contatoId: string): Promise<string | null> {
    const [o] = await tx.db
      .select({ etapaId: oportunidade.etapaId })
      .from(oportunidade)
      .where(and(eq(oportunidade.empresaId, empresaId), eq(oportunidade.contatoId, contatoId), eq(oportunidade.status, "aberta"), isNull(oportunidade.arquivadoEm)))
      .orderBy(desc(oportunidade.atualizadoEm))
      .limit(1);
    return o?.etapaId ?? null;
  }

  async function listar(
    ctx: ContextoEmpresa,
    f: { uso?: "conversa" | "ligacao"; contatoId?: string; etapaId?: string; busca?: string; arquivados: "sim" | "nao"; cursor?: string; limite: number },
  ): Promise<Pagina<ScriptDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const base = and(
        eq(script.empresaId, ctx.empresaId),
        f.arquivados === "sim" ? isNotNull(script.arquivadoEm) : isNull(script.arquivadoEm),
        f.uso ? inArray(script.uso, ["todos", f.uso]) : undefined,
        f.busca ? or(ilike(script.titulo, `%${f.busca}%`), ilike(script.texto, `%${f.busca}%`)) : undefined,
      );
      const etapaId = f.etapaId ?? (f.contatoId ? await etapaDoContato(tx, ctx.empresaId, f.contatoId) : null);
      if (f.contatoId || f.etapaId) {
        // No contexto de um contato: os da etapa primeiro, depois os do funil, depois os gerais (lista curta, sem páginas).
        let funilId: string | null = null;
        if (etapaId) {
          const [e] = await tx.db.select({ funilId: etapa.funilId }).from(etapa).where(and(eq(etapa.id, etapaId), eq(etapa.empresaId, ctx.empresaId)));
          funilId = e?.funilId ?? null;
        }
        const linhas = await consulta(tx)
          .where(
            and(
              base,
              or(
                etapaId ? eq(script.etapaId, etapaId) : undefined,
                and(isNull(script.etapaId), funilId ? or(isNull(script.funilId), eq(script.funilId, funilId)) : isNull(script.funilId)),
              ),
            ),
          )
          .orderBy(
            sql`${script.etapaId} IS NOT DISTINCT FROM ${etapaId}::uuid DESC`,
            sql`${script.funilId} IS NOT NULL DESC`,
            asc(script.ordem),
            asc(script.titulo),
          )
          .limit(f.limite);
        return { itens: linhas.map(dto), proximoCursor: null };
      }
      const linhas = await consulta(tx)
        .where(and(base, condicaoCursor(script.criadoEm, script.id, lerCursor(f.cursor))))
        .orderBy(desc(script.criadoEm), desc(script.id))
        .limit(f.limite + 1);
      return montarPagina(linhas, f.limite, dto);
    });
  }

  async function obter(ctx: ContextoEmpresa, id: string): Promise<ScriptDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const [l] = await consulta(tx).where(and(eq(script.id, id), eq(script.empresaId, ctx.empresaId)));
      if (!l) throw naoEncontrado("Script");
      return dto(l);
    });
  }

  /** Funil e etapa precisam ser da empresa e combinar entre si; só a etapa já define o funil. */
  async function validarLugar(tx: Tx, ctx: ContextoEmpresa, funilId: string | null, etapaId: string | null) {
    if (etapaId) {
      const [e] = await tx.db.select({ funilId: etapa.funilId }).from(etapa).where(and(eq(etapa.id, etapaId), eq(etapa.empresaId, ctx.empresaId)));
      if (!e) throw invalido("Etapa não encontrada.");
      if (funilId && funilId !== e.funilId) throw invalido("A etapa escolhida é de outro funil.");
      return { funilId: e.funilId, etapaId };
    }
    if (funilId) {
      const [f] = await tx.db.select({ id: funil.id }).from(funil).where(and(eq(funil.id, funilId), eq(funil.empresaId, ctx.empresaId)));
      if (!f) throw invalido("Funil não encontrado.");
    }
    return { funilId, etapaId: null };
  }

  async function salvar(ctx: ContextoEmpresa, origem: Origem, id: string | null, d: Dados): Promise<ScriptDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      let scriptId = id;
      if (!scriptId) {
        const lugar = await validarLugar(tx, ctx, d.funilId ?? null, d.etapaId ?? null);
        const [n] = await tx.db
          .insert(script)
          .values({ empresaId: ctx.empresaId, titulo: d.titulo!, texto: d.texto!, uso: d.uso ?? "todos", ...lugar, ordem: d.ordem ?? 0, criadoPor: ctx.usuarioId })
          .returning({ id: script.id });
        scriptId = n.id;
      } else {
        const [antes] = await tx.db.select().from(script).where(and(eq(script.id, scriptId), eq(script.empresaId, ctx.empresaId)));
        if (!antes) throw naoEncontrado("Script");
        const mexeuLugar = d.funilId !== undefined || d.etapaId !== undefined;
        const lugar = mexeuLugar
          ? await validarLugar(tx, ctx, d.funilId !== undefined ? d.funilId : antes.funilId, d.etapaId !== undefined ? d.etapaId : antes.etapaId)
          : {};
        await tx.db
          .update(script)
          .set({
            ...(d.titulo !== undefined ? { titulo: d.titulo } : {}),
            ...(d.texto !== undefined ? { texto: d.texto } : {}),
            ...(d.uso !== undefined ? { uso: d.uso } : {}),
            ...(d.ordem !== undefined ? { ordem: d.ordem } : {}),
            ...lugar,
            ...(d.arquivar !== undefined ? { arquivadoEm: d.arquivar ? new Date() : null } : {}),
            atualizadoEm: new Date(),
          })
          .where(eq(script.id, scriptId));
      }
      await registrar(tx, origem, {
        acao: !id ? "script.criado" : d.arquivar === true ? "script.arquivado" : d.arquivar === false ? "script.restaurado" : "script.atualizado",
        entidade: "script",
        entidadeId: scriptId,
        depois: { ...d, texto: d.texto ? `${d.texto.length} caracteres` : undefined },
        dados: { titulo: d.titulo },
      });
      const [l] = await consulta(tx).where(eq(script.id, scriptId));
      return dto(l);
    });
  }

  return { listar, obter, salvar };
}
