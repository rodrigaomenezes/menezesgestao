// Regras de autenticação: login com bloqueio progressivo, sessões, troca de empresa, recuperação de senha
// e aceite de convite. Não conhece HTTP: recebe os dados do cliente e devolve o token da sessão criada.
import { MARCA_PADRAO, SENHA_MINIMO, type EuDto, type Pagina, type SessaoDto } from "@mg/shared";
import { comoSistema, type Tx } from "../../infra/banco.js";
import { ErroApp, invalido, naoEncontrado } from "../../infra/erros.js";
import { iso, montarPagina } from "../../infra/paginacao.js";
import { hashToken, novoToken } from "../../infra/seguranca/cripto.js";
import {
  conferirSenha,
  gerarHashSenha,
  hashParaComparacaoFicticia,
  minutosDeBloqueio,
} from "../../infra/seguranca/senha.js";
import type { Servicos } from "../../app.js";
import { DURACAO_SESSAO_DIAS, type Contexto } from "../acesso/acesso.js";
import { auditar, registrar, type Origem } from "../auditoria/registro.js";
import { notificar } from "../notificacoes/notificar.js";
import * as repo from "./auth.repositorio.js";

const VALIDADE_RECUPERACAO_MIN = 60;

/** Quem está pedindo: IP, navegador e o token de sessão que já estiver no cookie. */
export interface Cliente {
  ip: string | null;
  dispositivo: string | null;
  tokenAtual?: string;
}

const origem = (c: Cliente, empresaId: string | null, atorId: string | null): Origem => ({
  empresaId,
  atorId,
  ip: c.ip,
  dispositivo: c.dispositivo,
});

export function criarServicoAuth(s: Servicos) {
  const { banco, config } = s;
  const hash = (token: string) => hashToken(config.sessionSecret, token);

  /** Abre uma sessão nova; quem entra de novo no mesmo navegador não deixa a anterior aberta. */
  async function abrirSessao(tx: Tx, cliente: Cliente, usuarioId: string, empresaId: string): Promise<string> {
    if (cliente.tokenAtual) await repo.encerrarSessaoPorHash(tx, hash(cliente.tokenAtual));
    const token = novoToken();
    await repo.inserirSessao(tx, {
      tokenHash: hash(token),
      usuarioId,
      empresaId,
      ip: cliente.ip,
      dispositivo: cliente.dispositivo,
      expiraEm: new Date(Date.now() + DURACAO_SESSAO_DIAS * 24 * 60 * 60_000),
    });
    return token;
  }

  async function entrar(
    cliente: Cliente,
    dados: { email: string; senha: string; empresaId?: string },
  ): Promise<{ token: string }> {
    const resultado = await comoSistema(banco, async (tx) => {
      const u = await repo.buscarUsuarioPorEmail(tx, dados.email);

      if (u?.bloqueadoAte && u.bloqueadoAte > new Date()) {
        const minutos = Math.max(1, Math.ceil((u.bloqueadoAte.getTime() - Date.now()) / 60_000));
        return {
          erro: new ErroApp(
            429,
            "LOGIN_BLOQUEADO",
            `Muitas tentativas erradas. Tente de novo em ${minutos} minuto(s) ou use "Esqueci a senha".`,
          ),
        };
      }

      // Sem usuário (ou sem senha), compara com um hash fictício: o tempo de resposta não revela quem existe.
      const ok = u?.senhaHash
        ? await conferirSenha(u.senhaHash, dados.senha)
        : (await conferirSenha(await hashParaComparacaoFicticia(), dados.senha), false);

      if (!u || !ok) {
        if (u) {
          const tentativas = u.tentativasFalhas + 1;
          const minutos = minutosDeBloqueio(tentativas);
          await repo.registrarFalhaLogin(tx, u.id, tentativas, minutos ? new Date(Date.now() + minutos * 60_000) : null);
        }
        await auditar(tx, origem(cliente, null, u?.id ?? null), { acao: "login.falhou", entidade: "usuario", entidadeId: u?.id });
        return { erro: new ErroApp(401, "LOGIN_INVALIDO", "E-mail ou senha incorretos. Confira e tente de novo.") };
      }

      await repo.zerarFalhasLogin(tx, u.id);
      const empresas = await repo.empresasDoUsuario(tx, u.id);
      const escolhida = empresas.find((e) => e.id === dados.empresaId) ?? empresas[0];
      if (!escolhida) {
        return {
          erro: new ErroApp(
            403,
            "SEM_ACESSO_LIBERADO",
            "Seu acesso ainda não foi liberado em nenhuma empresa. Fale com o administrador.",
          ),
        };
      }
      const token = await abrirSessao(tx, cliente, u.id, escolhida.id);
      await auditar(tx, origem(cliente, escolhida.id, u.id), { acao: "login", entidade: "usuario", entidadeId: u.id });
      return { token };
    });

    // O contador de tentativas fica gravado mesmo quando o login falha: o erro só sai depois do COMMIT.
    if ("erro" in resultado) throw resultado.erro;
    return resultado;
  }

  async function eu(ctx: Contexto): Promise<EuDto> {
    const empresas = await comoSistema(banco, (tx) => repo.empresasDoUsuario(tx, ctx.usuarioId));
    const marca = ctx.marca ?? MARCA_PADRAO;
    return {
      usuario: { id: ctx.usuarioId, nome: ctx.nome, email: ctx.email },
      empresa: ctx.empresaId
        ? {
            id: ctx.empresaId,
            nome: ctx.empresaNome ?? "",
            slug: ctx.empresaSlug ?? "",
            plano: ctx.plano ?? "",
            fuso: ctx.fuso ?? "America/Sao_Paulo",
            modulos: ctx.modulos,
            vocabulario: ctx.vocabulario,
          }
        : null,
      perfil: ctx.perfilId ? { id: ctx.perfilId, nome: ctx.perfilNome ?? "" } : null,
      permissoes: ctx.permissoes,
      marca: {
        nomeProduto: marca.nomeProduto ?? config.produtoNome,
        corPrimaria: marca.corPrimaria,
        corDestaque: marca.corDestaque,
        logoClaro: marca.logoClaroId && ctx.empresaSlug ? `/api/publico/logo/${ctx.empresaSlug}/claro?v=${marca.logoClaroId.slice(0, 8)}` : null,
        logoEscuro: marca.logoEscuroId && ctx.empresaSlug ? `/api/publico/logo/${ctx.empresaSlug}/escuro?v=${marca.logoEscuroId.slice(0, 8)}` : null,
      },
      empresas,
    };
  }

  async function sair(cliente: Cliente, ctx: Contexto): Promise<void> {
    await comoSistema(banco, async (tx) => {
      await repo.encerrarSessao(tx, ctx.sessaoId, ctx.usuarioId);
      await auditar(tx, origem(cliente, ctx.empresaId, ctx.usuarioId), { acao: "logout", entidade: "usuario", entidadeId: ctx.usuarioId });
    });
  }

  async function trocarEmpresa(cliente: Cliente, ctx: Contexto, empresaId: string): Promise<void> {
    await comoSistema(banco, async (tx) => {
      const empresas = await repo.empresasDoUsuario(tx, ctx.usuarioId);
      if (!empresas.some((e) => e.id === empresaId)) throw naoEncontrado("Empresa");
      await repo.trocarEmpresaDaSessao(tx, ctx.sessaoId, empresaId);
      await auditar(tx, origem(cliente, empresaId, ctx.usuarioId), {
        acao: "sessao.trocou_empresa",
        entidade: "usuario",
        entidadeId: ctx.usuarioId,
      });
    });
  }

  async function listarSessoes(ctx: Contexto, cursor: string | undefined, limite: number): Promise<Pagina<SessaoDto>> {
    const linhas = await comoSistema(banco, (tx) => repo.listarSessoesAtivas(tx, ctx.usuarioId, cursor, limite));
    return montarPagina(linhas, limite, (l) => ({
      id: l.id,
      dispositivo: l.dispositivo,
      ip: l.ip,
      criadoEm: iso(l.criadoEm),
      ultimoUso: iso(l.ultimoUso),
      atual: l.id === ctx.sessaoId,
    }));
  }

  async function encerrarSessao(cliente: Cliente, ctx: Contexto, sessaoId: string): Promise<void> {
    await comoSistema(banco, async (tx) => {
      const encerradas = await repo.encerrarSessao(tx, sessaoId, ctx.usuarioId);
      if (!encerradas.length) throw naoEncontrado("Dispositivo");
      await auditar(tx, origem(cliente, ctx.empresaId, ctx.usuarioId), { acao: "sessao.encerrada", entidade: "sessao", entidadeId: sessaoId });
    });
  }

  /** Sempre "ok", exista ou não o e-mail: não revela quem tem cadastro. */
  async function esqueciSenha(cliente: Cliente, email: string): Promise<void> {
    await comoSistema(banco, async (tx) => {
      const u = await repo.buscarUsuarioPorEmail(tx, email);
      if (!u?.senhaHash) return;
      const token = novoToken();
      await repo.inserirToken(tx, {
        tipo: "recuperacao",
        tokenHash: hash(token),
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
          `${config.appUrl}/redefinir-senha?token=${token}`,
          "",
          "Se não foi você, ignore este e-mail: sua senha atual continua valendo.",
        ].join("\n"),
      });
      await auditar(tx, origem(cliente, null, u.id), { acao: "senha.recuperacao_pedida", entidade: "usuario", entidadeId: u.id });
    });
  }

  async function redefinirSenha(cliente: Cliente, token: string, senha: string): Promise<void> {
    const senhaHash = await gerarHashSenha(senha);
    await comoSistema(banco, async (tx) => {
      const t = await repo.buscarTokenValido(tx, "recuperacao", hash(token));
      if (!t) throw new ErroApp(400, "LINK_INVALIDO", 'Este link não vale mais. Peça um novo em "Esqueci a senha".');
      await repo.definirSenha(tx, t.usuarioId, senhaHash);
      await repo.marcarTokenUsado(tx, t.id);
      // Senha nova encerra todas as sessões abertas.
      await repo.encerrarTodasAsSessoes(tx, t.usuarioId);
      await auditar(tx, origem(cliente, null, t.usuarioId), { acao: "senha.redefinida", entidade: "usuario", entidadeId: t.usuarioId });
    });
  }

  const conviteInvalido = () =>
    new ErroApp(404, "LINK_INVALIDO", "Este convite não vale mais. Peça um novo ao administrador da empresa.");

  async function dadosDoConvite(tx: Tx, token: string) {
    const t = await repo.buscarTokenValido(tx, "convite", hash(token));
    if (!t?.empresaId) return null;
    const c = await repo.buscarConvitePendente(tx, t.empresaId, t.usuarioId);
    return c ? { token: t, empresaId: t.empresaId, ...c } : null;
  }

  async function consultarConvite(token: string) {
    const c = await comoSistema(banco, (tx) => dadosDoConvite(tx, token));
    if (!c) throw conviteInvalido();
    return { empresaNome: c.empresaNome, email: c.email, nome: c.nome, precisaSenha: !c.senhaHash };
  }

  async function aceitarConvite(
    cliente: Cliente,
    dados: { token: string; nome?: string; senha?: string },
  ): Promise<{ token: string }> {
    const senhaHash = dados.senha ? await gerarHashSenha(dados.senha) : null;
    return comoSistema(banco, async (tx) => {
      const c = await dadosDoConvite(tx, dados.token);
      if (!c) throw conviteInvalido();
      const usuarioId = c.token.usuarioId;

      if (!c.senhaHash) {
        if (!senhaHash) throw invalido(`Crie uma senha com pelo menos ${SENHA_MINIMO} caracteres.`);
        await repo.definirSenha(tx, usuarioId, senhaHash, dados.nome ?? c.nome);
      }
      await repo.ativarVinculo(tx, c.vinculoId);
      await repo.marcarTokenUsado(tx, c.token.id);

      const o = origem(cliente, c.empresaId, usuarioId);
      await registrar(tx, o, { acao: "usuario.entrou", entidade: "usuario", entidadeId: usuarioId, responsavelId: usuarioId });
      if (c.convidadoPor) {
        await notificar(tx, o, {
          usuarioId: c.convidadoPor,
          titulo: `${dados.nome ?? c.nome} aceitou o convite`,
          texto: "A pessoa já pode entrar e usar o sistema.",
          link: "/usuarios",
        });
      }
      return { token: await abrirSessao(tx, cliente, usuarioId, c.empresaId) };
    });
  }

  return {
    entrar,
    eu,
    sair,
    trocarEmpresa,
    listarSessoes,
    encerrarSessao,
    esqueciSenha,
    redefinirSenha,
    consultarConvite,
    aceitarConvite,
  };
}
