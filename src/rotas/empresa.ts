import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, ilike, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Servicos } from "../app.js";
import { comEmpresa } from "../db/banco.js";
import { empresa, unidade } from "../db/esquema.js";
import { COR_HEX, lerMarca } from "../compartilhado/marca.js";
import { exigirEmpresa, origemDe } from "../nucleo/acesso.js";
import { naoEncontrado } from "../nucleo/erros.js";
import { condicaoCursor, esquemaPaginacao, lerCursor, montarPagina } from "../nucleo/paginacao.js";
import { registrar } from "../nucleo/registro.js";

const FUSOS = new Set(Intl.supportedValuesOf("timeZone"));
const cor = z.string().regex(COR_HEX, { error: "Use uma cor no formato #RRGGBB." });
const idParam = z.object({ id: z.uuid() });
const texto = (max: number) => z.string().trim().min(1, { error: "Preencha este campo." }).max(max);

export const filtroArquivados = z.object({
  arquivados: z.enum(["sim", "nao"]).default("nao"),
  busca: z.string().trim().max(100).optional(),
});

export const rotasEmpresa =
  (s: Servicos): FastifyPluginAsync =>
  async (app) => {
    const { banco } = s;

    app.get("/api/empresa", { config: { acesso: { modulo: "configuracoes", acao: "ver" } } }, async (req) => {
      const ctx = exigirEmpresa(req);
      return comEmpresa(banco, ctx.empresaId, async (tx) => {
        const [e] = await tx.db
          .select({
            id: empresa.id,
            nome: empresa.nome,
            marca: empresa.marca,
            fuso: empresa.fuso,
            plano: empresa.plano,
            modulos: empresa.modulos,
            vocabulario: empresa.vocabulario,
          })
          .from(empresa)
          .where(eq(empresa.id, ctx.empresaId));
        if (!e) throw naoEncontrado("Empresa");
        return { ...e, marca: lerMarca(e.marca) };
      });
    });

    app.patch("/api/empresa", { config: { acesso: { modulo: "configuracoes", acao: "editar" } } }, async (req) => {
      const ctx = exigirEmpresa(req);
      const corpo = z
        .object({
          nome: texto(120).optional(),
          fuso: z.string().refine((f) => FUSOS.has(f), { error: "Fuso horário desconhecido." }).optional(),
          marca: z
            .object({ nomeProduto: z.string().trim().max(60).optional(), corPrimaria: cor, corDestaque: cor })
            .optional(),
        })
        .parse(req.body);
      return comEmpresa(banco, ctx.empresaId, async (tx) => {
        const [antes] = await tx.db.select().from(empresa).where(eq(empresa.id, ctx.empresaId));
        if (!antes) throw naoEncontrado("Empresa");
        const [depois] = await tx.db
          .update(empresa)
          .set({ ...corpo, atualizadoEm: new Date() })
          .where(eq(empresa.id, ctx.empresaId))
          .returning();
        await registrar(tx, origemDe(req), {
          acao: "empresa.atualizada",
          entidade: "empresa",
          entidadeId: ctx.empresaId,
          antes: { nome: antes.nome, fuso: antes.fuso, marca: antes.marca },
          depois: { nome: depois.nome, fuso: depois.fuso, marca: depois.marca },
        });
        return { ok: true };
      });
    });

    // Unidades -----------------------------------------------------------------------------------

    const colunasUnidade = {
      id: unidade.id,
      nome: unidade.nome,
      endereco: unidade.endereco,
      criadoEm: unidade.criadoEm,
      arquivadoEm: unidade.arquivadoEm,
    };

    app.get("/api/unidades", { config: { acesso: { modulo: "configuracoes", acao: "ver" } } }, async (req) => {
      const ctx = exigirEmpresa(req);
      const { cursor, limite } = esquemaPaginacao.parse(req.query);
      const filtro = filtroArquivados.parse(req.query);
      return comEmpresa(banco, ctx.empresaId, async (tx) => {
        const linhas = await tx.db
          .select(colunasUnidade)
          .from(unidade)
          .where(
            and(
              eq(unidade.empresaId, ctx.empresaId),
              filtro.arquivados === "sim" ? isNotNull(unidade.arquivadoEm) : isNull(unidade.arquivadoEm),
              filtro.busca ? ilike(unidade.nome, `%${filtro.busca}%`) : undefined,
              condicaoCursor(unidade.criadoEm, unidade.id, lerCursor(cursor)),
            ),
          )
          .orderBy(desc(unidade.criadoEm), desc(unidade.id))
          .limit(limite + 1);
        return montarPagina(linhas, limite);
      });
    });

    const corpoUnidade = z.object({ nome: texto(120), endereco: z.string().trim().max(300).nullish() });

    app.post("/api/unidades", { config: { acesso: { modulo: "configuracoes", acao: "criar" } } }, async (req, reply) => {
      const ctx = exigirEmpresa(req);
      const corpo = corpoUnidade.parse(req.body);
      const criada = await comEmpresa(banco, ctx.empresaId, async (tx) => {
        const [u] = await tx.db
          .insert(unidade)
          .values({ empresaId: ctx.empresaId, nome: corpo.nome, endereco: corpo.endereco ?? null, criadoPor: ctx.usuarioId })
          .returning(colunasUnidade);
        await registrar(tx, origemDe(req), { acao: "unidade.criada", entidade: "unidade", entidadeId: u.id, depois: u });
        return u;
      });
      return reply.status(201).send(criada);
    });

    app.patch("/api/unidades/:id", { config: { acesso: { modulo: "configuracoes", acao: "editar" } } }, async (req) => {
      const ctx = exigirEmpresa(req);
      const { id } = idParam.parse(req.params);
      const corpo = corpoUnidade.partial().parse(req.body);
      return comEmpresa(banco, ctx.empresaId, async (tx) => {
        const condicao = and(eq(unidade.id, id), eq(unidade.empresaId, ctx.empresaId));
        const [antes] = await tx.db.select(colunasUnidade).from(unidade).where(condicao);
        if (!antes) throw naoEncontrado("Unidade");
        const [depois] = await tx.db
          .update(unidade)
          .set({ ...corpo, atualizadoEm: new Date() })
          .where(condicao)
          .returning(colunasUnidade);
        await registrar(tx, origemDe(req), { acao: "unidade.atualizada", entidade: "unidade", entidadeId: id, antes, depois });
        return depois;
      });
    });

    for (const [rota, arquivar] of [
      ["arquivar", true],
      ["restaurar", false],
    ] as const) {
      app.post(
        `/api/unidades/:id/${rota}`,
        { config: { acesso: { modulo: "configuracoes", acao: "arquivar" } } },
        async (req) => {
          const ctx = exigirEmpresa(req);
          const { id } = idParam.parse(req.params);
          return comEmpresa(banco, ctx.empresaId, async (tx) => {
            const [u] = await tx.db
              .update(unidade)
              .set({ arquivadoEm: arquivar ? new Date() : null, atualizadoEm: new Date() })
              .where(and(eq(unidade.id, id), eq(unidade.empresaId, ctx.empresaId)))
              .returning(colunasUnidade);
            if (!u) throw naoEncontrado("Unidade");
            await registrar(tx, origemDe(req), {
              acao: arquivar ? "unidade.arquivada" : "unidade.restaurada",
              entidade: "unidade",
              entidadeId: id,
            });
            return u;
          });
        },
      );
    }
  };
