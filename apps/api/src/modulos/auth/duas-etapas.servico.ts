// Login em duas etapas: app autenticador (TOTP) ou código por e-mail, com códigos de recuperação.
// O desafio do login vive num cookie HttpOnly próprio (o token nunca passa pelo JavaScript da página).
import { randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import QRCode from "qrcode";
import {
  QTD_CODIGOS_RECUPERACAO,
  type CodigosRecuperacaoDto,
  type DuasEtapasDto,
  type ExigenciaDuasEtapas,
  type IniciarDuasEtapasDto,
  type MetodoDuasEtapas,
} from "@mg/shared";
import { comEmpresa, comoSistema, type Tx } from "../../infra/banco.js";
import { desafioLogin, empresa, usuario } from "../../infra/esquema.js";
import { ErroApp, invalido } from "../../infra/erros.js";
import { cifrar, decifrar, hashToken, novoToken } from "../../infra/seguranca/cripto.js";
import { conferirSenha, minutosDeBloqueio } from "../../infra/seguranca/senha.js";
import {
  conferirTotp,
  normalizarCodigoRecuperacao,
  novoSegredoTotp,
  novosCodigosRecuperacao,
  uriTotp,
} from "../../infra/seguranca/totp.js";
import type { Servicos } from "../../app.js";
import { duasEtapasObrigatoria, type Contexto, type ContextoEmpresa } from "../acesso/acesso.js";
import { auditar, registrar, type Origem } from "../auditoria/registro.js";
import * as repo from "./auth.repositorio.js";

export const COOKIE_DESAFIO = "mg_desafio";
export const VALIDADE_DESAFIO_MIN = 10;
const MAX_TENTATIVAS = 5;
const MAX_ENVIOS = 5;

const codigoInvalido = (restam?: number) =>
  new ErroApp(
    401,
    "CODIGO_INVALIDO",
    restam !== undefined && restam > 0
      ? `Código incorreto. Confira e tente de novo (restam ${restam} tentativa(s)).`
      : "Código incorreto ou vencido. Entre de novo com e-mail e senha para receber outro.",
  );

/** r***@exemplo.com — mostra para onde foi sem expor o endereço inteiro. */
export function mascararEmail(email: string): string {
  const [nome, dominio] = email.split("@");
  return `${nome.slice(0, 1)}***@${dominio ?? ""}`;
}

export function criarServicoDuasEtapas(s: Servicos) {
  const { banco, config } = s;
  const hash = (v: string) => hashToken(config.sessionSecret, v);
  const novoCodigoEmail = () => randomInt(0, 1_000_000).toString().padStart(6, "0");

  async function enviarCodigoEmail(tx: Tx, para: { email: string; nome: string }, codigo: string, motivo: string) {
    await s.jobs.enviarEmail(tx, {
      para: para.email,
      assunto: `Seu código de acesso ao ${config.produtoNome}: ${codigo}`,
      texto: [
        `Olá, ${para.nome}!`,
        "",
        `Seu código para ${motivo} é: ${codigo}`,
        "",
        `Ele vale por ${VALIDADE_DESAFIO_MIN} minutos. Se não foi você, troque sua senha: alguém pode estar tentando entrar.`,
      ].join("\n"),
    });
  }

  /** Senha já conferida: cria o desafio do login. Devolve o token do cookie e para onde o código foi. */
  async function iniciarLogin(
    tx: Tx,
    u: { id: string; email: string; nome: string; duasEtapasMetodo: MetodoDuasEtapas },
    empresaId: string,
  ): Promise<{ token: string; metodo: MetodoDuasEtapas; destino: string | null }> {
    const token = novoToken();
    const codigo = u.duasEtapasMetodo === "email" ? novoCodigoEmail() : null;
    await tx.db.insert(desafioLogin).values({
      tokenHash: hash(token),
      usuarioId: u.id,
      empresaId,
      finalidade: "entrar",
      metodo: u.duasEtapasMetodo,
      codigoHash: codigo ? hash(codigo) : null,
      expiraEm: new Date(Date.now() + VALIDADE_DESAFIO_MIN * 60_000),
    });
    if (codigo) await enviarCodigoEmail(tx, u, codigo, "entrar");
    return { token, metodo: u.duasEtapasMetodo, destino: codigo ? mascararEmail(u.email) : null };
  }

  /**
   * Confere o código (do app, do e-mail ou de recuperação) contra o usuário e o desafio.
   * Recuperação usada sai da lista; passo do app usado não vale de novo.
   */
  async function conferirCodigo(
    tx: Tx,
    u: typeof usuario.$inferSelect,
    d: typeof desafioLogin.$inferSelect,
    codigo: string,
  ): Promise<"app" | "email" | "recuperacao" | null> {
    if (d.metodo === "email" && d.codigoHash && /^\d{6}$/.test(codigo.replace(/\s/g, "")) && hash(codigo.replace(/\s/g, "")) === d.codigoHash) {
      return "email";
    }
    const segredo = d.finalidade === "configurar" ? d.segredoNovo : u.duasEtapasSegredo;
    if (d.metodo === "totp" && segredo) {
      const passo = conferirTotp(decifrar(config.crmChave, segredo), codigo, d.finalidade === "configurar" ? null : (u.duasEtapasUltimoPasso ?? null));
      if (passo !== null) {
        await tx.db.update(usuario).set({ duasEtapasUltimoPasso: passo }).where(eq(usuario.id, u.id));
        return "app";
      }
    }
    if (d.finalidade === "entrar") {
      const h = hash(normalizarCodigoRecuperacao(codigo));
      if (u.duasEtapasRecuperacao.includes(h)) {
        await tx.db
          .update(usuario)
          .set({ duasEtapasRecuperacao: u.duasEtapasRecuperacao.filter((x) => x !== h) })
          .where(eq(usuario.id, u.id));
        return "recuperacao";
      }
    }
    return null;
  }

  /** Segunda etapa do login: devolve a pessoa e a empresa para abrir a sessão. */
  async function confirmarLogin(
    cliente: { ip: string | null; dispositivo: string | null },
    token: string | undefined,
    codigo: string,
    abrirSessao: (tx: Tx, usuarioId: string, empresaId: string) => Promise<string>,
  ): Promise<{ token: string }> {
    const r = await comoSistema(banco, async (tx) => {
      if (!token) return { erro: codigoInvalido() };
      const [d] = await tx.db
        .select()
        .from(desafioLogin)
        .where(and(eq(desafioLogin.tokenHash, hash(token)), eq(desafioLogin.finalidade, "entrar"), isNull(desafioLogin.usadoEm), gt(desafioLogin.expiraEm, new Date())))
        .for("update");
      if (!d || d.tentativas >= MAX_TENTATIVAS || !d.empresaId) return { erro: codigoInvalido() };
      const [u] = await tx.db.select().from(usuario).where(eq(usuario.id, d.usuarioId)).for("update");
      const origem: Origem = { empresaId: d.empresaId, atorId: u.id, ip: cliente.ip, dispositivo: cliente.dispositivo };
      const como = u.duasEtapasMetodo ? await conferirCodigo(tx, u, d, codigo) : null;
      if (!como) {
        const tentativas = d.tentativas + 1;
        await tx.db.update(desafioLogin).set({ tentativas }).where(eq(desafioLogin.id, d.id));
        // Código errado também conta para o bloqueio progressivo da conta.
        const falhas = u.tentativasFalhas + 1;
        const minutos = minutosDeBloqueio(falhas);
        await repo.registrarFalhaLogin(tx, u.id, falhas, minutos ? new Date(Date.now() + minutos * 60_000) : null);
        await auditar(tx, origem, { acao: "login.codigo_errado", entidade: "usuario", entidadeId: u.id });
        return { erro: codigoInvalido(MAX_TENTATIVAS - tentativas) };
      }
      await tx.db.update(desafioLogin).set({ usadoEm: new Date() }).where(eq(desafioLogin.id, d.id));
      await repo.zerarFalhasLogin(tx, u.id);
      const sessao = await abrirSessao(tx, u.id, d.empresaId);
      await auditar(tx, origem, { acao: "login", entidade: "usuario", entidadeId: u.id, depois: { duasEtapas: como } });
      return { token: sessao };
    });
    // A tentativa errada fica gravada: o erro só sai depois do COMMIT.
    if ("erro" in r) throw r.erro;
    return r;
  }

  /** Novo código por e-mail para o mesmo desafio de login. */
  async function reenviarLogin(token: string | undefined): Promise<void> {
    await comoSistema(banco, async (tx) => {
      if (!token) throw codigoInvalido();
      const [d] = await tx.db
        .select()
        .from(desafioLogin)
        .where(and(eq(desafioLogin.tokenHash, hash(token)), isNull(desafioLogin.usadoEm), gt(desafioLogin.expiraEm, new Date())))
        .for("update");
      if (!d || d.metodo !== "email") throw codigoInvalido();
      if (d.envios >= MAX_ENVIOS) throw new ErroApp(429, "LIMITE_EXCEDIDO", "Muitos códigos enviados. Entre de novo com e-mail e senha.");
      const [u] = await tx.db.select().from(usuario).where(eq(usuario.id, d.usuarioId));
      const codigo = novoCodigoEmail();
      await tx.db
        .update(desafioLogin)
        .set({ codigoHash: hash(codigo), envios: d.envios + 1, expiraEm: new Date(Date.now() + VALIDADE_DESAFIO_MIN * 60_000) })
        .where(eq(desafioLogin.id, d.id));
      await enviarCodigoEmail(tx, u, codigo, "entrar");
    });
  }

  // Configuração pela própria pessoa ------------------------------------------------------------------------

  async function estado(ctx: Contexto): Promise<DuasEtapasDto> {
    const [u] = await comoSistema(banco, (tx) => tx.db.select().from(usuario).where(eq(usuario.id, ctx.usuarioId)));
    const exigencia = ctx.empresaId
      ? (await comoSistema(banco, (tx) => tx.db.select({ e: empresa.exigirDuasEtapas }).from(empresa).where(eq(empresa.id, ctx.empresaId as string))))[0]?.e
      : null;
    return {
      ativa: Boolean(u.duasEtapasMetodo),
      metodo: u.duasEtapasMetodo ?? null,
      obrigatoria: duasEtapasObrigatoria(exigencia ?? null, ctx.permissoes),
      codigosRestantes: u.duasEtapasRecuperacao.length,
      ativadaEm: u.duasEtapasAtivadaEm?.toISOString() ?? null,
    };
  }

  async function iniciarConfiguracao(ctx: Contexto, metodo: MetodoDuasEtapas): Promise<IniciarDuasEtapasDto> {
    return comoSistema(banco, async (tx) => {
      const [u] = await tx.db.select().from(usuario).where(eq(usuario.id, ctx.usuarioId));
      // Um desafio de configuração por vez: o anterior deixa de valer.
      await tx.db
        .update(desafioLogin)
        .set({ usadoEm: new Date() })
        .where(and(eq(desafioLogin.usuarioId, u.id), eq(desafioLogin.finalidade, "configurar"), isNull(desafioLogin.usadoEm)));
      const segredo = metodo === "totp" ? novoSegredoTotp() : null;
      const codigo = metodo === "email" ? novoCodigoEmail() : null;
      await tx.db.insert(desafioLogin).values({
        usuarioId: u.id,
        empresaId: ctx.empresaId,
        finalidade: "configurar",
        metodo,
        segredoNovo: segredo ? cifrar(config.crmChave, segredo) : null,
        codigoHash: codigo ? hash(codigo) : null,
        expiraEm: new Date(Date.now() + VALIDADE_DESAFIO_MIN * 60_000),
      });
      if (codigo) await enviarCodigoEmail(tx, u, codigo, "ligar o login em duas etapas");
      const emissor = ctx.marca?.nomeProduto ?? config.produtoNome;
      return {
        metodo,
        segredo,
        qr: segredo ? await QRCode.toDataURL(uriTotp(emissor, u.email, segredo), { margin: 1, width: 240 }) : null,
        destino: codigo ? mascararEmail(u.email) : null,
      };
    });
  }

  async function gerarCodigos(tx: Tx, usuarioId: string): Promise<string[]> {
    const codigos = novosCodigosRecuperacao(QTD_CODIGOS_RECUPERACAO);
    await tx.db
      .update(usuario)
      .set({ duasEtapasRecuperacao: codigos.map((c) => hash(normalizarCodigoRecuperacao(c))), atualizadoEm: new Date() })
      .where(eq(usuario.id, usuarioId));
    return codigos;
  }

  /** Confere o primeiro código: só então o método passa a valer. Devolve os códigos de recuperação (uma vez). */
  async function confirmarConfiguracao(ctx: Contexto, origem: Origem, codigo: string): Promise<CodigosRecuperacaoDto> {
    const r = await comoSistema(banco, async (tx) => {
      const [d] = await tx.db
        .select()
        .from(desafioLogin)
        .where(and(eq(desafioLogin.usuarioId, ctx.usuarioId), eq(desafioLogin.finalidade, "configurar"), isNull(desafioLogin.usadoEm), gt(desafioLogin.expiraEm, new Date())))
        .orderBy(desc(desafioLogin.criadoEm))
        .limit(1)
        .for("update");
      if (!d || d.tentativas >= MAX_TENTATIVAS) {
        return { erro: new ErroApp(400, "CODIGO_INVALIDO", "O código venceu. Comece a configuração de novo.") };
      }
      const [u] = await tx.db.select().from(usuario).where(eq(usuario.id, ctx.usuarioId)).for("update");
      if (!(await conferirCodigo(tx, u, d, codigo))) {
        await tx.db.update(desafioLogin).set({ tentativas: d.tentativas + 1 }).where(eq(desafioLogin.id, d.id));
        return { erro: codigoInvalido(MAX_TENTATIVAS - d.tentativas - 1) };
      }
      await tx.db.update(desafioLogin).set({ usadoEm: new Date() }).where(eq(desafioLogin.id, d.id));
      await tx.db
        .update(usuario)
        .set({ duasEtapasMetodo: d.metodo, duasEtapasSegredo: d.segredoNovo, duasEtapasAtivadaEm: new Date() })
        .where(eq(usuario.id, u.id));
      const codigos = await gerarCodigos(tx, u.id);
      await auditar(tx, origem, { acao: "duas_etapas.ativada", entidade: "usuario", entidadeId: u.id, depois: { metodo: d.metodo } });
      return { codigos };
    });
    if ("erro" in r) throw r.erro;
    return r;
  }

  async function exigirSenha(tx: Tx, usuarioId: string, senha: string) {
    const [u] = await tx.db.select().from(usuario).where(eq(usuario.id, usuarioId));
    if (!u.senhaHash || !(await conferirSenha(u.senhaHash, senha))) {
      throw new ErroApp(401, "LOGIN_INVALIDO", "Senha incorreta. Confira e tente de novo.");
    }
    return u;
  }

  async function desligar(ctx: Contexto, origem: Origem, senha: string): Promise<void> {
    if ((await estado(ctx)).obrigatoria) {
      throw invalido("A empresa exige o login em duas etapas para o seu perfil. Você pode trocar de método, mas não desligar.");
    }
    await comoSistema(banco, async (tx) => {
      await exigirSenha(tx, ctx.usuarioId, senha);
      await tx.db
        .update(usuario)
        .set({ duasEtapasMetodo: null, duasEtapasSegredo: null, duasEtapasUltimoPasso: null, duasEtapasRecuperacao: [], duasEtapasAtivadaEm: null })
        .where(eq(usuario.id, ctx.usuarioId));
      await auditar(tx, origem, { acao: "duas_etapas.desligada", entidade: "usuario", entidadeId: ctx.usuarioId });
    });
  }

  async function novosCodigos(ctx: Contexto, origem: Origem, senha: string): Promise<CodigosRecuperacaoDto> {
    return comoSistema(banco, async (tx) => {
      const u = await exigirSenha(tx, ctx.usuarioId, senha);
      if (!u.duasEtapasMetodo) throw invalido("Ligue o login em duas etapas primeiro.");
      const codigos = await gerarCodigos(tx, u.id);
      await auditar(tx, origem, { acao: "duas_etapas.novos_codigos", entidade: "usuario", entidadeId: u.id });
      return { codigos };
    });
  }

  // Regra da empresa ---------------------------------------------------------------------------------------

  async function exigenciaDaEmpresa(ctx: ContextoEmpresa): Promise<{ exigirDuasEtapas: ExigenciaDuasEtapas }> {
    const [e] = await comEmpresa(banco, ctx.empresaId, (tx) =>
      tx.db.select({ exigirDuasEtapas: empresa.exigirDuasEtapas }).from(empresa).where(eq(empresa.id, ctx.empresaId)),
    );
    return e;
  }

  async function definirExigencia(ctx: ContextoEmpresa, origem: Origem, exigirDuasEtapas: ExigenciaDuasEtapas) {
    // Quem exige dos outros precisa estar protegido antes (e não se tranca fora no meio do caminho).
    if (exigirDuasEtapas !== "nao" && !ctx.duasEtapasAtiva) {
      throw invalido("Ligue o login em duas etapas na sua conta (Segurança da conta) antes de exigir da equipe.");
    }
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await tx.db.update(empresa).set({ exigirDuasEtapas, atualizadoEm: new Date() }).where(eq(empresa.id, ctx.empresaId));
      await registrar(tx, origem, { acao: "empresa.seguranca_alterada", entidade: "empresa", entidadeId: ctx.empresaId, dados: { exigirDuasEtapas } });
      return { exigirDuasEtapas };
    });
  }

  return {
    iniciarLogin,
    confirmarLogin,
    reenviarLogin,
    estado,
    iniciarConfiguracao,
    confirmarConfiguracao,
    desligar,
    novosCodigos,
    exigenciaDaEmpresa,
    definirExigencia,
  };
}
