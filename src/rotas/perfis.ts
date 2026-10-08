import type { FastifyPluginAsync } from "fastify";
import { and, count, desc, eq, ilike, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Servicos } from "../app.js";
import { comEmpresa, type Tx } from "../db/banco.js";
import { perfil, vinculo } from "../db/esquema.js";
import { limparPermissoes } from "../compartilhado/catalogo.js";
import { exigirEmpresa, origemDe } from "../nucleo/acesso.js";
import { ErroHttp, conflito, naoEncontrado } from "../nucleo/erros.js";
import { condicaoCursor, esquemaPaginacao, lerCursor, montarPagina } from "../nucleo/paginacao.js";
import { registrar } from "../nucleo/registro.js";
import { filtroArquivados } from "./empresa.js";

const idParam = z.object({ id: z.uuid() });
const nome = z.string().trim().min(2, { error: "Dê um nome ao perfil." }).max(80);

const colunas = {
  id: perfil.id,
  nome: perfil.nome,
  base: perfil.base,
  protegido: perfil.protegido,
  permissoes: perfil.permissoes,
  criadoEm: perfil.criadoEm,
  arquivadoEm: perfil.arquivadoEm,
};

const perfilProtegido = () =>
  new ErroHttp(403, "O perfil de Dono não pode ser alterado: ele garante que sempre exista alguém com acesso total.");

export const rotasPerfis =
  (s: Servicos): FastifyPluginAsync =>
  async (app) => {
    const { banco } = s;

    async function buscar(tx: Tx, empresaId: string, id: string) {
      const [p] = await tx.db
        .select(colunas)
        .from(perfil)
        .where(and(eq(perfil.id, id), eq(perfil.empresaId, empresaId)));
      if (!p) throw naoEncontrado("Perfil");
      return { ...p, permissoes: limparPermissoes(p.permissoes) };
    }

    app.get("/api/perfis", { config: { acesso: { modulo: "usuarios", acao: "ver" } } }, async (req) => {
      const ctx = exigirEmpresa(req);
      const { cursor, limite } = esquemaPaginacao.parse(req.query);
      const filtro = filtroArquivados.parse(req.query);
      return comEmpresa(banco, ctx.empresaId, async (tx) => {
        const linhas = await tx.db
          .select(colunas)
          .from(perfil)
          .where(
            and(
              eq(perfil.empresaId, ctx.empresaId),
              filtro.arquivados === "sim" ? isNotNull(perfil.arquivadoEm) : isNull(perfil.arquivadoEm),
              filtro.busca ? ilike(perfil.nome, `%${filtro.busca}%`) : undefined,
              condicaoCursor(perfil.criadoEm, perfil.id, lerCursor(cursor)),
            ),
          )
          .orderBy(desc(perfil.criadoEm), desc(perfil.id))
          .limit(limite + 1);
        const pagina = montarPagina(linhas, limite);
        return { ...pagina, itens: pagina.itens.map((p) => ({ ...p, permissoes: limparPermissoes(p.permissoes) })) };
      });
    });

    app.get("/api/perfis/:id", { config: { acesso: { modulo: "usuarios", acao: "ver" } } }, async (req) => {
      const ctx = exigirEmpresa(req);
      const { id } = idParam.parse(req.params);
      return comEmpresa(banco, ctx.empresaId, (tx) => buscar(tx, ctx.empresaId, id));
    });

    // Perfil personalizado parte de outro (ex.: "SDR" a partir de Vendedor).
    app.post("/api/perfis", { config: { acesso: { modulo: "usuarios", acao: "administrar" } } }, async (req, reply) => {
      const ctx = exigirEmpresa(req);
      const corpo = z.object({ nome, copiarDe: z.uuid({ error: "Escolha o perfil de partida." }) }).parse(req.body);
      const criado = await comEmpresa(banco, ctx.empresaId, async (tx) => {
        const origemPerfil = await buscar(tx, ctx.empresaId, corpo.copiarDe);
        const [p] = await tx.db
          .insert(perfil)
          .values({
            empresaId: ctx.empresaId,
            nome: corpo.nome,
            base: origemPerfil.base,
            permissoes: origemPerfil.permissoes,
            criadoPor: ctx.usuarioId,
          })
          .returning(colunas);
        await registrar(tx, origemDe(req), {
          acao: "perfil.criado",
          entidade: "perfil",
          entidadeId: p.id,
          depois: { nome: p.nome, copiadoDe: corpo.copiarDe, permissoes: p.permissoes },
        });
        return p;
      });
      return reply.status(201).send(criado);
    });

    app.patch("/api/perfis/:id", { config: { acesso: { modulo: "usuarios", acao: "administrar" } } }, async (req) => {
      const ctx = exigirEmpresa(req);
      const { id } = idParam.parse(req.params);
      const corpo = z.object({ nome: nome.optional(), permissoes: z.record(z.string(), z.unknown()).optional() }).parse(req.body);
      return comEmpresa(banco, ctx.empresaId, async (tx) => {
        const antes = await buscar(tx, ctx.empresaId, id);
        if (antes.protegido) throw perfilProtegido();
        const novo = {
          nome: corpo.nome ?? antes.nome,
          permissoes: corpo.permissoes ? limparPermissoes(corpo.permissoes) : antes.permissoes,
        };
        await tx.db
          .update(perfil)
          .set({ ...novo, atualizadoEm: new Date() })
          .where(and(eq(perfil.id, id), eq(perfil.empresaId, ctx.empresaId)));
        await registrar(tx, origemDe(req), {
          acao: "perfil.atualizado",
          entidade: "perfil",
          entidadeId: id,
          antes: { nome: antes.nome, permissoes: antes.permissoes },
          depois: novo,
        });
        return buscar(tx, ctx.empresaId, id);
      });
    });

    for (const [rota, arquivar] of [
      ["arquivar", true],
      ["restaurar", false],
    ] as const) {
      app.post(`/api/perfis/:id/${rota}`, { config: { acesso: { modulo: "usuarios", acao: "administrar" } } }, async (req) => {
        const ctx = exigirEmpresa(req);
        const { id } = idParam.parse(req.params);
        return comEmpresa(banco, ctx.empresaId, async (tx) => {
          const alvo = await buscar(tx, ctx.empresaId, id);
          if (alvo.protegido) throw perfilProtegido();
          if (arquivar) {
            const [{ total }] = await tx.db
              .select({ total: count() })
              .from(vinculo)
              .where(and(eq(vinculo.perfilId, id), isNull(vinculo.arquivadoEm)));
            if (total > 0) {
              throw conflito(`Este perfil está em uso por ${total} pessoa(s). Troque o perfil delas antes de arquivar.`);
            }
          }
          await tx.db
            .update(perfil)
            .set({ arquivadoEm: arquivar ? new Date() : null, atualizadoEm: new Date() })
            .where(and(eq(perfil.id, id), eq(perfil.empresaId, ctx.empresaId)));
          await registrar(tx, origemDe(req), {
            acao: arquivar ? "perfil.arquivado" : "perfil.restaurado",
            entidade: "perfil",
            entidadeId: id,
          });
          return { ok: true };
        });
      });
    }
  };
