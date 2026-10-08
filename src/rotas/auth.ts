import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Servicos } from "../app.js";
import { comoSistema, type Tx } from "../db/banco.js";
import { empresa, sessao, tokenAcesso, usuario, vinculo } from "../db/esquema.js";
import { MARCA_PADRAO } from "../compartilhado/marca.js";
import {
  COOKIE_SESSAO,
  DURACAO_SESSAO_DIAS,
  dispositivoDe,
  exigirContexto,
  opcoesCookieSessao,
  type Contexto,
} from "../nucleo/acesso.js";
import { ErroHttp, invalido, naoEncontrado } from "../nucleo/erros.js";
import { condicaoCursor, esquemaPaginacao, lerCursor, montarPagina } from "../nucleo/paginacao.js";
import { auditar, registrar } from "../nucleo/registro.js";
import { notificar } from "../nucleo/notificacoes.js";
import { hashToken, novoToken } from "../seguranca/cripto.js";
import {
  SENHA_MAXIMO,
  SENHA_MINIMO,
  conferirSenha,
  gerarHashSenha,
  hashParaComparacaoFicticia,
  minutosDeBloqueio,
} from "../seguranca/senha.js";

const email = z.email({ error: "Informe um e-mail válido." }).max(200);
const senhaNova = z
  .string()
  .min(SENHA_MINIMO, { error: `A senha precisa ter pelo menos ${SENHA_MINIMO} caracteres.` })
  .max(SENHA_MAXIMO, { error: `A senha pode ter no máximo ${SENHA_MAXIMO} caracteres.` });
const token = z.string().min(20).max(200);

const VALIDADE_RECUPERACAO_MIN = 60;

export const rotasAuth =
  (s: Servicos): FastifyPluginAsync =>
  async (app) => {
    const { banco, config } = s;
    const limiteLogin = { max: config.limiteLoginMinuto, timeWindow: "1 minute" };

    async function abrirSessao(
      tx: Tx,
      req: FastifyRequest,
      reply: FastifyReply,
      usuarioId: string,
      empresaId: string,
    ): Promise<void> {
      const valor = novoToken();
      await tx.db.insert(sessao).values({
        tokenHash: hashToken(config.sessionSecret, valor),
        usuarioId,
        empresaId,
        ip: req.ip,
        dispositivo: dispositivoDe(req),
        expiraEm: new Date(Date.now() + DURACAO_SESSAO_DIAS * 24 * 60 * 60_000),
      });
      reply.setCookie(COOKIE_SESSAO, valor, opcoesCookieSessao(config));
    }

    /** Empresas em que a pessoa tem vínculo ativo. */
    async function empresasDe(tx: Tx, usuarioId: string) {
      return tx.db
        .select({ id: empresa.id, nome: empresa.nome })
        .from(vinculo)
        .innerJoin(empresa, eq(empresa.id, vinculo.empresaId))
        .where(
          and(
            eq(vinculo.usuarioId, usuarioId),
            eq(vinculo.status, "ativo"),
            isNull(vinculo.arquivadoEm),
            isNull(empresa.arquivadoEm),
          ),
        )
        .orderBy(vinculo.criadoEm)
        .limit(100);
    }

    async function montarEu(ctx: Contexto) {
      const empresas = await comoSistema(banco, (tx) => empresasDe(tx, ctx.usuarioId));
      const marca = ctx.marca ?? MARCA_PADRAO;
      return {
        usuario: { id: ctx.usuarioId, nome: ctx.nome, email: ctx.email },
        empresa: ctx.empresaId
          ? { id: ctx.empresaId, nome: ctx.empresaNome, plano: ctx.plano, modulos: ctx.modulos }
          : null,
        perfil: ctx.perfilId ? { id: ctx.perfilId, nome: ctx.perfilNome } : null,
        permissoes: ctx.permissoes,
        marca: { ...marca, nomeProduto: marca.nomeProduto ?? config.produtoNome },
        empresas,
      };
    }

    app.post(
      "/api/auth/entrar",
      { config: { acesso: { publica: true }, rateLimit: limiteLogin } },
      async (req, reply) => {
        const corpo = z
          .object({ email, senha: z.string().min(1).max(SENHA_MAXIMO), empresaId: z.uuid().optional() })
          .parse(req.body);
        const origemBase = { ip: req.ip, dispositivo: dispositivoDe(req) };

        const resultado = await comoSistema(banco, async (tx) => {
          const [u] = await tx.db
            .select()
            .from(usuario)
            .where(sql`lower(${usuario.email}) = lower(${corpo.email})`);

          if (u?.bloqueadoAte && u.bloqueadoAte > new Date()) {
            const minutos = Math.max(1, Math.ceil((u.bloqueadoAte.getTime() - Date.now()) / 60_000));
            return { erro: new ErroHttp(429, `Muitas tentativas erradas. Tente de novo em ${minutos} minuto(s) ou use "Esqueci a senha".`) };
          }

          const ok = u?.senhaHash
            ? await conferirSenha(u.senhaHash, corpo.senha)
            : (await conferirSenha(await hashParaComparacaoFicticia(), corpo.senha), false);

          if (!u || !ok) {
            if (u) {
              const tentativas = u.tentativasFalhas + 1;
              const minutos = minutosDeBloqueio(tentativas);
              await tx.db
                .update(usuario)
                .set({
                  tentativasFalhas: tentativas,
                  bloqueadoAte: minutos ? new Date(Date.now() + minutos * 60_000) : null,
                })
                .where(eq(usuario.id, u.id));
            }
            await auditar(tx, { ...origemBase, empresaId: null, atorId: u?.id ?? null }, {
              acao: "login.falhou",
              entidade: "usuario",
              entidadeId: u?.id ?? null,
            });
            return { erro: new ErroHttp(401, "E-mail ou senha incorretos. Confira e tente de novo.") };
          }

          await tx.db
            .update(usuario)
            .set({ tentativasFalhas: 0, bloqueadoAte: null })
            .where(eq(usuario.id, u.id));

          const empresas = await empresasDe(tx, u.id);
          const escolhida = empresas.find((e) => e.id === corpo.empresaId) ?? empresas[0];
          if (!escolhida) {
            return {
              erro: new ErroHttp(403, "Seu acesso ainda não foi liberado em nenhuma empresa. Fale com o administrador."),
            };
          }
          await abrirSessao(tx, req, reply, u.id, escolhida.id);
          await auditar(tx, { ...origemBase, empresaId: escolhida.id, atorId: u.id }, {
            acao: "login",
            entidade: "usuario",
            entidadeId: u.id,
          });
          return { erro: null };
        });

        // O contador de tentativas precisa ficar gravado mesmo quando o login falha.
        if (resultado.erro) throw resultado.erro;
        return { ok: true };
      },
    );

    app.get("/api/auth/eu", { config: { acesso: { autenticada: true } } }, async (req) =>
      montarEu(exigirContexto(req)),
    );

    app.post("/api/auth/sair", { config: { acesso: { autenticada: true } } }, async (req, reply) => {
      const ctx = exigirContexto(req);
      await comoSistema(banco, async (tx) => {
        await tx.db.update(sessao).set({ encerradaEm: new Date() }).where(eq(sessao.id, ctx.sessaoId));
        await auditar(tx, { empresaId: ctx.empresaId, atorId: ctx.usuarioId, ip: req.ip, dispositivo: dispositivoDe(req) }, {
          acao: "logout",
          entidade: "usuario",
          entidadeId: ctx.usuarioId,
        });
      });
      reply.clearCookie(COOKIE_SESSAO, { path: "/" });
      return { ok: true };
    });

    app.post("/api/auth/empresa-ativa", { config: { acesso: { autenticada: true } } }, async (req) => {
      const ctx = exigirContexto(req);
      const { empresaId } = z.object({ empresaId: z.uuid() }).parse(req.body);
      await comoSistema(banco, async (tx) => {
        const empresas = await empresasDe(tx, ctx.usuarioId);
        if (!empresas.some((e) => e.id === empresaId)) throw naoEncontrado("Empresa");
        await tx.db.update(sessao).set({ empresaId }).where(eq(sessao.id, ctx.sessaoId));
        await auditar(tx, { empresaId, atorId: ctx.usuarioId, ip: req.ip, dispositivo: dispositivoDe(req) }, {
          acao: "sessao.trocou_empresa",
          entidade: "usuario",
          entidadeId: ctx.usuarioId,
        });
      });
      return { ok: true };
    });

    app.get("/api/auth/sessoes", { config: { acesso: { autenticada: true } } }, async (req) => {
      const ctx = exigirContexto(req);
      const { cursor, limite } = esquemaPaginacao.parse(req.query);
      const linhas = await comoSistema(banco, (tx) =>
        tx.db
          .select({
            id: sessao.id,
            dispositivo: sessao.dispositivo,
            ip: sessao.ip,
            criadoEm: sessao.criadoEm,
            ultimoUso: sessao.ultimoUso,
          })
          .from(sessao)
          .where(
            and(
              eq(sessao.usuarioId, ctx.usuarioId),
              isNull(sessao.encerradaEm),
              gt(sessao.expiraEm, new Date()),
              condicaoCursor(sessao.criadoEm, sessao.id, lerCursor(cursor)),
            ),
          )
          .orderBy(desc(sessao.criadoEm), desc(sessao.id))
          .limit(limite + 1),
      );
      const pagina = montarPagina(linhas, limite);
      return { ...pagina, itens: pagina.itens.map((i) => ({ ...i, atual: i.id === ctx.sessaoId })) };
    });

    app.delete("/api/auth/sessoes/:id", { config: { acesso: { autenticada: true } } }, async (req) => {
      const ctx = exigirContexto(req);
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      await comoSistema(banco, async (tx) => {
        const encerradas = await tx.db
          .update(sessao)
          .set({ encerradaEm: new Date() })
          .where(and(eq(sessao.id, id), eq(sessao.usuarioId, ctx.usuarioId), isNull(sessao.encerradaEm)))
          .returning({ id: sessao.id });
        if (!encerradas.length) throw naoEncontrado("Dispositivo");
        await auditar(tx, { empresaId: ctx.empresaId, atorId: ctx.usuarioId, ip: req.ip, dispositivo: dispositivoDe(req) }, {
          acao: "sessao.encerrada",
          entidade: "sessao",
          entidadeId: id,
        });
      });
      return { ok: true };
    });

    app.post(
      "/api/auth/esqueci",
      { config: { acesso: { publica: true }, rateLimit: limiteLogin } },
      async (req) => {
        const corpo = z.object({ email }).parse(req.body);
        await comoSistema(banco, async (tx) => {
          const [u] = await tx.db
            .select({ id: usuario.id, nome: usuario.nome, email: usuario.email, senhaHash: usuario.senhaHash })
            .from(usuario)
            .where(sql`lower(${usuario.email}) = lower(${corpo.email})`);
          if (!u?.senhaHash) return;
          const valor = novoToken();
          await tx.db.insert(tokenAcesso).values({
            tipo: "recuperacao",
            tokenHash: hashToken(config.sessionSecret, valor),
            usuarioId: u.id,
            expiraEm: new Date(Date.now() + VALIDADE_RECUPERACAO_MIN * 60_000),
          });
          await s.jobs.enviarEmail(tx, {
            para: u.email,
            assunto: `Criar nova senha no ${config.produtoNome}`,
            texto: [
              `Olá, ${u.nome}!`,
              "",
              "Recebemos um pedido para criar uma nova senha. Abra o link abaixo (ele vale por 1 hora):",
              "",
              `${config.appUrl}/redefinir-senha?token=${valor}`,
              "",
              "Se não foi você, ignore este e-mail: sua senha atual continua valendo.",
            ].join("\n"),
          });
          await auditar(tx, { empresaId: null, atorId: u.id, ip: req.ip, dispositivo: dispositivoDe(req) }, {
            acao: "senha.recuperacao_pedida",
            entidade: "usuario",
            entidadeId: u.id,
          });
        });
        // Mesma resposta exista ou não o e-mail: não revela quem tem cadastro.
        return { ok: true };
      },
    );

    /** Busca um token válido (não usado, não vencido) e o trava até o fim da transação. */
    async function tokenValido(tx: Tx, tipo: "convite" | "recuperacao", valor: string) {
      const [t] = await tx.db
        .select()
        .from(tokenAcesso)
        .where(
          and(
            eq(tokenAcesso.tokenHash, hashToken(config.sessionSecret, valor)),
            eq(tokenAcesso.tipo, tipo),
            isNull(tokenAcesso.usadoEm),
            gt(tokenAcesso.expiraEm, new Date()),
          ),
        )
        .for("update");
      return t ?? null;
    }

    app.post(
      "/api/auth/redefinir",
      { config: { acesso: { publica: true }, rateLimit: limiteLogin } },
      async (req) => {
        const corpo = z.object({ token, senha: senhaNova }).parse(req.body);
        const senhaHash = await gerarHashSenha(corpo.senha);
        await comoSistema(banco, async (tx) => {
          const t = await tokenValido(tx, "recuperacao", corpo.token);
          if (!t) throw invalido("Este link não vale mais. Peça um novo em \"Esqueci a senha\".");
          await tx.db
            .update(usuario)
            .set({ senhaHash, tentativasFalhas: 0, bloqueadoAte: null, atualizadoEm: new Date() })
            .where(eq(usuario.id, t.usuarioId));
          await tx.db.update(tokenAcesso).set({ usadoEm: new Date() }).where(eq(tokenAcesso.id, t.id));
          // Senha nova encerra todas as sessões abertas.
          await tx.db
            .update(sessao)
            .set({ encerradaEm: new Date() })
            .where(and(eq(sessao.usuarioId, t.usuarioId), isNull(sessao.encerradaEm)));
          await auditar(tx, { empresaId: null, atorId: t.usuarioId, ip: req.ip, dispositivo: dispositivoDe(req) }, {
            acao: "senha.redefinida",
            entidade: "usuario",
            entidadeId: t.usuarioId,
          });
        });
        return { ok: true };
      },
    );

    async function dadosDoConvite(tx: Tx, valor: string) {
      const t = await tokenValido(tx, "convite", valor);
      if (!t?.empresaId) return null;
      const [linha] = await tx.db
        .select({
          vinculoId: vinculo.id,
          convidadoPor: vinculo.convidadoPor,
          empresaNome: empresa.nome,
          email: usuario.email,
          nome: usuario.nome,
          senhaHash: usuario.senhaHash,
        })
        .from(vinculo)
        .innerJoin(empresa, eq(empresa.id, vinculo.empresaId))
        .innerJoin(usuario, eq(usuario.id, vinculo.usuarioId))
        .where(
          and(
            eq(vinculo.empresaId, t.empresaId),
            eq(vinculo.usuarioId, t.usuarioId),
            eq(vinculo.status, "convidado"),
            isNull(vinculo.arquivadoEm),
            isNull(empresa.arquivadoEm),
          ),
        );
      return linha ? { token: t, ...linha } : null;
    }

    const conviteInvalido = () =>
      new ErroHttp(404, "Este convite não vale mais. Peça um novo ao administrador da empresa.");

    app.get("/api/auth/convite", { config: { acesso: { publica: true } } }, async (req) => {
      const q = z.object({ token }).parse(req.query);
      const c = await comoSistema(banco, (tx) => dadosDoConvite(tx, q.token));
      if (!c) throw conviteInvalido();
      return { empresaNome: c.empresaNome, email: c.email, nome: c.nome, precisaSenha: !c.senhaHash };
    });

    app.post(
      "/api/auth/aceitar-convite",
      { config: { acesso: { publica: true }, rateLimit: limiteLogin } },
      async (req, reply) => {
        const corpo = z
          .object({ token, nome: z.string().trim().min(2).max(120).optional(), senha: senhaNova.optional() })
          .parse(req.body);
        const senhaHash = corpo.senha ? await gerarHashSenha(corpo.senha) : null;

        await comoSistema(banco, async (tx) => {
          const c = await dadosDoConvite(tx, corpo.token);
          if (!c?.token.empresaId) throw conviteInvalido();
          const empresaId = c.token.empresaId;
          const usuarioId = c.token.usuarioId;

          if (!c.senhaHash) {
            if (!senhaHash) throw invalido(`Crie uma senha com pelo menos ${SENHA_MINIMO} caracteres.`);
            await tx.db
              .update(usuario)
              .set({ senhaHash, nome: corpo.nome ?? c.nome, atualizadoEm: new Date() })
              .where(eq(usuario.id, usuarioId));
          }
          await tx.db
            .update(vinculo)
            .set({ status: "ativo", atualizadoEm: new Date() })
            .where(eq(vinculo.id, c.vinculoId));
          await tx.db.update(tokenAcesso).set({ usadoEm: new Date() }).where(eq(tokenAcesso.id, c.token.id));

          const origem = { empresaId, atorId: usuarioId, ip: req.ip, dispositivo: dispositivoDe(req) };
          await registrar(tx, origem, {
            acao: "usuario.entrou",
            entidade: "usuario",
            entidadeId: usuarioId,
            responsavelId: usuarioId,
          });
          if (c.convidadoPor) {
            await notificar(tx, origem, {
              usuarioId: c.convidadoPor,
              titulo: `${corpo.nome ?? c.nome} aceitou o convite`,
              texto: "A pessoa já pode entrar e usar o sistema.",
              link: "/usuarios",
            });
          }
          await abrirSessao(tx, req, reply, usuarioId, empresaId);
        });
        return { ok: true };
      },
    );
  };
