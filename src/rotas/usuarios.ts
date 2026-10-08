import type { FastifyPluginAsync } from "fastify";
import { and, count, desc, eq, ilike, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Servicos } from "../app.js";
import { comEmpresa, type Tx } from "../db/banco.js";
import { equipe, perfil, unidade, usuario, vinculo } from "../db/esquema.js";
import { limparPermissoes, perfilAdministra, temPermissao } from "../compartilhado/catalogo.js";
import { exigirEmpresa, exigirEscopo, origemDe, type ContextoEmpresa } from "../nucleo/acesso.js";
import { convidar, validarLotacao } from "../nucleo/convites.js";
import { conflito, invalido, naoEncontrado, semPermissao } from "../nucleo/erros.js";
import { filtroUsuariosVisiveis } from "../nucleo/escopo.js";
import { condicaoCursor, esquemaPaginacao, lerCursor, montarPagina } from "../nucleo/paginacao.js";
import { registrar } from "../nucleo/registro.js";
import { filtroArquivados } from "./empresa.js";

const idParam = z.object({ id: z.uuid() });
const idOpcional = z.uuid().nullish();
const texto = (max: number) => z.string().trim().min(1, { error: "Preencha este campo." }).max(max);

const podeAdministrarUsuarios = (ctx: ContextoEmpresa) => Boolean(temPermissao(ctx.permissoes, "usuarios", "administrar"));

/** Garante que sempre reste ao menos uma pessoa ativa com o perfil protegido (Dono). */
async function garantirOutroDono(tx: Tx, empresaId: string, vinculoId: string): Promise<void> {
  const [alvo] = await tx.db
    .select({ protegido: perfil.protegido })
    .from(vinculo)
    .innerJoin(perfil, eq(perfil.id, vinculo.perfilId))
    .where(eq(vinculo.id, vinculoId));
  if (!alvo?.protegido) return;
  const [{ total }] = await tx.db
    .select({ total: count() })
    .from(vinculo)
    .innerJoin(perfil, eq(perfil.id, vinculo.perfilId))
    .where(
      and(
        eq(vinculo.empresaId, empresaId),
        eq(perfil.protegido, true),
        eq(vinculo.status, "ativo"),
        isNull(vinculo.arquivadoEm),
        ne(vinculo.id, vinculoId),
      ),
    );
  if (total === 0) {
    throw conflito("Esta é a única pessoa com perfil de Dono. Dê esse perfil a outra pessoa antes.");
  }
}

export const rotasUsuarios =
  (s: Servicos): FastifyPluginAsync =>
  async (app) => {
    const { banco } = s;
    const equipeDoVinculo = alias(equipe, "equipe_do_vinculo");

    const colunas = {
      id: vinculo.id,
      usuarioId: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      status: vinculo.status,
      perfilId: vinculo.perfilId,
      perfilNome: perfil.nome,
      unidadeId: vinculo.unidadeId,
      unidadeNome: unidade.nome,
      equipeId: vinculo.equipeId,
      equipeNome: equipeDoVinculo.nome,
      criadoEm: vinculo.criadoEm,
      arquivadoEm: vinculo.arquivadoEm,
    };

    function consultaUsuarios(tx: Tx) {
      return tx.db
        .select(colunas)
        .from(vinculo)
        .innerJoin(usuario, eq(usuario.id, vinculo.usuarioId))
        .innerJoin(perfil, eq(perfil.id, vinculo.perfilId))
        .leftJoin(unidade, eq(unidade.id, vinculo.unidadeId))
        .leftJoin(equipeDoVinculo, eq(equipeDoVinculo.id, vinculo.equipeId));
    }

    /** Busca um vínculo que a pessoa pode ver (empresa + escopo); 404 se não puder. */
    async function vinculoVisivel(tx: Tx, ctx: ContextoEmpresa, escopo: ReturnType<typeof exigirEscopo>, id: string) {
      const [v] = await consultaUsuarios(tx).where(
        and(
          eq(vinculo.id, id),
          eq(vinculo.empresaId, ctx.empresaId),
          filtroUsuariosVisiveis(ctx, escopo, vinculo.usuarioId),
        ),
      );
      if (!v) throw naoEncontrado("Usuário");
      return v;
    }

    app.get("/api/usuarios", { config: { acesso: { modulo: "usuarios", acao: "ver" } } }, async (req) => {
      const ctx = exigirEmpresa(req);
      const escopo = exigirEscopo(req);
      const { cursor, limite } = esquemaPaginacao.parse(req.query);
      const filtro = filtroArquivados.parse(req.query);
      return comEmpresa(banco, ctx.empresaId, async (tx) => {
        const linhas = await consultaUsuarios(tx)
          .where(
            and(
              eq(vinculo.empresaId, ctx.empresaId),
              filtroUsuariosVisiveis(ctx, escopo, vinculo.usuarioId),
              filtro.arquivados === "sim" ? isNotNull(vinculo.arquivadoEm) : isNull(vinculo.arquivadoEm),
              filtro.busca
                ? or(ilike(usuario.nome, `%${filtro.busca}%`), ilike(usuario.email, `%${filtro.busca}%`))
                : undefined,
              condicaoCursor(vinculo.criadoEm, vinculo.id, lerCursor(cursor)),
            ),
          )
          .orderBy(desc(vinculo.criadoEm), desc(vinculo.id))
          .limit(limite + 1);
        return montarPagina(linhas, limite);
      });
    });

    app.get("/api/usuarios/:id", { config: { acesso: { modulo: "usuarios", acao: "ver" } } }, async (req) => {
      const ctx = exigirEmpresa(req);
      const { id } = idParam.parse(req.params);
      return comEmpresa(banco, ctx.empresaId, (tx) => vinculoVisivel(tx, ctx, exigirEscopo(req), id));
    });

    // Opções para formulários (perfis, unidades e equipes ativos). Listas curtas, com teto.
    app.get("/api/usuarios/opcoes", { config: { acesso: { modulo: "usuarios", acao: "ver" } } }, async (req) => {
      const ctx = exigirEmpresa(req);
      return comEmpresa(banco, ctx.empresaId, async (tx) => {
        // Em sequência: as três consultas usam a mesma conexão da transação.
        const perfis = await tx.db
            .select({ id: perfil.id, nome: perfil.nome })
            .from(perfil)
            .where(and(eq(perfil.empresaId, ctx.empresaId), isNull(perfil.arquivadoEm)))
            .orderBy(perfil.nome)
            .limit(200);
        const unidades = await tx.db
            .select({ id: unidade.id, nome: unidade.nome })
            .from(unidade)
            .where(and(eq(unidade.empresaId, ctx.empresaId), isNull(unidade.arquivadoEm)))
            .orderBy(unidade.nome)
            .limit(200);
        const equipes = await tx.db
            .select({ id: equipe.id, nome: equipe.nome })
            .from(equipe)
            .where(and(eq(equipe.empresaId, ctx.empresaId), isNull(equipe.arquivadoEm)))
            .orderBy(equipe.nome)
            .limit(200);
        return { perfis, unidades, equipes };
      });
    });

    app.post("/api/convites", { config: { acesso: { modulo: "usuarios", acao: "criar" } } }, async (req, reply) => {
      const ctx = exigirEmpresa(req);
      const corpo = z
        .object({
          email: z.email({ error: "Informe um e-mail válido." }).max(200),
          nome: texto(120),
          perfilId: z.uuid({ error: "Escolha um perfil." }),
          unidadeId: idOpcional,
          equipeId: idOpcional,
        })
        .parse(req.body);
      const r = await comEmpresa(banco, ctx.empresaId, (tx) =>
        convidar(s, tx, { ...origemDe(req), empresaId: ctx.empresaId }, corpo, podeAdministrarUsuarios(ctx)),
      );
      return reply.status(201).send({ id: r.vinculoId, usuarioId: r.usuarioId });
    });

    app.patch("/api/usuarios/:id", { config: { acesso: { modulo: "usuarios", acao: "editar" } } }, async (req) => {
      const ctx = exigirEmpresa(req);
      const escopo = exigirEscopo(req);
      const { id } = idParam.parse(req.params);
      const corpo = z.object({ perfilId: z.uuid().optional(), unidadeId: idOpcional, equipeId: idOpcional }).parse(req.body);
      return comEmpresa(banco, ctx.empresaId, async (tx) => {
        const antes = await vinculoVisivel(tx, ctx, escopo, id);
        if (corpo.perfilId && corpo.perfilId !== antes.perfilId) {
          if (id === ctx.vinculoId) throw conflito("Você não pode trocar o próprio perfil. Peça a outro administrador.");
          const [novo] = await tx.db
            .select({ permissoes: perfil.permissoes })
            .from(perfil)
            .where(and(eq(perfil.id, corpo.perfilId), eq(perfil.empresaId, ctx.empresaId), isNull(perfil.arquivadoEm)));
          if (!novo) throw invalido("Escolha um perfil válido.");
          if (perfilAdministra(limparPermissoes(novo.permissoes)) && !podeAdministrarUsuarios(ctx)) throw semPermissao();
          await garantirOutroDono(tx, ctx.empresaId, id);
        }
        await validarLotacao(tx, ctx.empresaId, corpo.unidadeId ?? null, corpo.equipeId ?? null);
        await tx.db
          .update(vinculo)
          .set({ ...corpo, atualizadoEm: new Date() })
          .where(and(eq(vinculo.id, id), eq(vinculo.empresaId, ctx.empresaId)));
        const depois = await vinculoVisivel(tx, ctx, "empresa", id);
        await registrar(tx, origemDe(req), {
          acao: "usuario.atualizado",
          entidade: "usuario",
          entidadeId: antes.usuarioId,
          responsavelId: antes.usuarioId,
          antes: { perfilId: antes.perfilId, unidadeId: antes.unidadeId, equipeId: antes.equipeId },
          depois: { perfilId: depois.perfilId, unidadeId: depois.unidadeId, equipeId: depois.equipeId },
        });
        return depois;
      });
    });

    for (const [rota, arquivar] of [
      ["arquivar", true],
      ["restaurar", false],
    ] as const) {
      app.post(`/api/usuarios/:id/${rota}`, { config: { acesso: { modulo: "usuarios", acao: "arquivar" } } }, async (req) => {
        const ctx = exigirEmpresa(req);
        const { id } = idParam.parse(req.params);
        return comEmpresa(banco, ctx.empresaId, async (tx) => {
          const alvo = await vinculoVisivel(tx, ctx, exigirEscopo(req), id);
          if (arquivar) {
            if (id === ctx.vinculoId) throw conflito("Você não pode arquivar o próprio cadastro.");
            await garantirOutroDono(tx, ctx.empresaId, id);
          }
          await tx.db
            .update(vinculo)
            .set({ arquivadoEm: arquivar ? new Date() : null, atualizadoEm: new Date() })
            .where(and(eq(vinculo.id, id), eq(vinculo.empresaId, ctx.empresaId)));
          await registrar(tx, origemDe(req), {
            acao: arquivar ? "usuario.arquivado" : "usuario.restaurado",
            entidade: "usuario",
            entidadeId: alvo.usuarioId,
            responsavelId: alvo.usuarioId,
          });
          return { ok: true };
        });
      });
    }

    // Equipes -------------------------------------------------------------------------------------

    const gestor = alias(usuario, "gestor");
    const colunasEquipe = {
      id: equipe.id,
      nome: equipe.nome,
      unidadeId: equipe.unidadeId,
      unidadeNome: unidade.nome,
      gestorId: equipe.gestorId,
      gestorNome: gestor.nome,
      criadoEm: equipe.criadoEm,
      arquivadoEm: equipe.arquivadoEm,
    };

    function consultaEquipes(tx: Tx) {
      return tx.db
        .select(colunasEquipe)
        .from(equipe)
        .leftJoin(unidade, eq(unidade.id, equipe.unidadeId))
        .leftJoin(gestor, eq(gestor.id, equipe.gestorId));
    }

    function filtroEquipesVisiveis(ctx: ContextoEmpresa, escopo: ReturnType<typeof exigirEscopo>) {
      const minha = ctx.equipeId ? eq(equipe.id, ctx.equipeId) : sql`false`;
      switch (escopo) {
        case "empresa":
          return sql`true`;
        case "unidade":
          return ctx.unidadeId ? or(eq(equipe.unidadeId, ctx.unidadeId), minha) : minha;
        case "equipe":
          return or(eq(equipe.gestorId, ctx.usuarioId), minha);
        case "proprio":
          return minha;
      }
    }

    app.get("/api/equipes", { config: { acesso: { modulo: "usuarios", acao: "ver" } } }, async (req) => {
      const ctx = exigirEmpresa(req);
      const escopo = exigirEscopo(req);
      const { cursor, limite } = esquemaPaginacao.parse(req.query);
      const filtro = filtroArquivados.parse(req.query);
      return comEmpresa(banco, ctx.empresaId, async (tx) => {
        const linhas = await consultaEquipes(tx)
          .where(
            and(
              eq(equipe.empresaId, ctx.empresaId),
              filtroEquipesVisiveis(ctx, escopo),
              filtro.arquivados === "sim" ? isNotNull(equipe.arquivadoEm) : isNull(equipe.arquivadoEm),
              filtro.busca ? ilike(equipe.nome, `%${filtro.busca}%`) : undefined,
              condicaoCursor(equipe.criadoEm, equipe.id, lerCursor(cursor)),
            ),
          )
          .orderBy(desc(equipe.criadoEm), desc(equipe.id))
          .limit(limite + 1);
        return montarPagina(linhas, limite);
      });
    });

    const corpoEquipe = z.object({ nome: texto(120), unidadeId: idOpcional, gestorId: idOpcional });

    /** O gestor precisa ter vínculo ativo nesta empresa. */
    async function validarGestor(tx: Tx, empresaId: string, gestorId: string | null | undefined) {
      if (!gestorId) return;
      const [v] = await tx.db
        .select({ id: vinculo.id })
        .from(vinculo)
        .where(and(eq(vinculo.empresaId, empresaId), eq(vinculo.usuarioId, gestorId), isNull(vinculo.arquivadoEm)));
      if (!v) throw invalido("O gestor escolhido não faz parte da empresa.");
    }

    app.post("/api/equipes", { config: { acesso: { modulo: "usuarios", acao: "criar" } } }, async (req, reply) => {
      const ctx = exigirEmpresa(req);
      const corpo = corpoEquipe.parse(req.body);
      const criada = await comEmpresa(banco, ctx.empresaId, async (tx) => {
        await validarLotacao(tx, ctx.empresaId, corpo.unidadeId ?? null, null);
        await validarGestor(tx, ctx.empresaId, corpo.gestorId);
        const [e] = await tx.db
          .insert(equipe)
          .values({
            empresaId: ctx.empresaId,
            nome: corpo.nome,
            unidadeId: corpo.unidadeId ?? null,
            gestorId: corpo.gestorId ?? null,
            criadoPor: ctx.usuarioId,
          })
          .returning({ id: equipe.id });
        await registrar(tx, origemDe(req), {
          acao: "equipe.criada",
          entidade: "equipe",
          entidadeId: e.id,
          responsavelId: corpo.gestorId ?? null,
          depois: corpo,
        });
        const [completa] = await consultaEquipes(tx).where(eq(equipe.id, e.id));
        return completa;
      });
      return reply.status(201).send(criada);
    });

    app.patch("/api/equipes/:id", { config: { acesso: { modulo: "usuarios", acao: "editar" } } }, async (req) => {
      const ctx = exigirEmpresa(req);
      const escopo = exigirEscopo(req);
      const { id } = idParam.parse(req.params);
      const corpo = corpoEquipe.partial().parse(req.body);
      return comEmpresa(banco, ctx.empresaId, async (tx) => {
        const condicao = and(eq(equipe.id, id), eq(equipe.empresaId, ctx.empresaId));
        const [antes] = await consultaEquipes(tx).where(and(condicao, filtroEquipesVisiveis(ctx, escopo)));
        if (!antes) throw naoEncontrado("Equipe");
        await validarLotacao(tx, ctx.empresaId, corpo.unidadeId ?? null, null);
        await validarGestor(tx, ctx.empresaId, corpo.gestorId);
        await tx.db.update(equipe).set({ ...corpo, atualizadoEm: new Date() }).where(condicao);
        const [depois] = await consultaEquipes(tx).where(condicao);
        await registrar(tx, origemDe(req), {
          acao: "equipe.atualizada",
          entidade: "equipe",
          entidadeId: id,
          responsavelId: depois.gestorId,
          antes,
          depois,
        });
        return depois;
      });
    });

    for (const [rota, arquivar] of [
      ["arquivar", true],
      ["restaurar", false],
    ] as const) {
      app.post(`/api/equipes/:id/${rota}`, { config: { acesso: { modulo: "usuarios", acao: "arquivar" } } }, async (req) => {
        const ctx = exigirEmpresa(req);
        const escopo = exigirEscopo(req);
        const { id } = idParam.parse(req.params);
        return comEmpresa(banco, ctx.empresaId, async (tx) => {
          const condicao = and(eq(equipe.id, id), eq(equipe.empresaId, ctx.empresaId));
          const [alvo] = await consultaEquipes(tx).where(and(condicao, filtroEquipesVisiveis(ctx, escopo)));
          if (!alvo) throw naoEncontrado("Equipe");
          await tx.db
            .update(equipe)
            .set({ arquivadoEm: arquivar ? new Date() : null, atualizadoEm: new Date() })
            .where(condicao);
          await registrar(tx, origemDe(req), {
            acao: arquivar ? "equipe.arquivada" : "equipe.restaurada",
            entidade: "equipe",
            entidadeId: id,
            responsavelId: alvo.gestorId,
          });
          return { ok: true };
        });
      });
    }
  };
