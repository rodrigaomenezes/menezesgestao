// Pessoas da empresa (vínculos), convites e equipes. Regras: escopo de visão, perfil que administra só por
// quem administra, ninguém troca o próprio perfil nem se arquiva, e sempre sobra um Dono ativo.
import {
  perfilAdministra,
  temPermissao,
  type EquipeDto,
  type Escopo,
  type OpcoesUsuarioDto,
  type Pagina,
  type UsuarioDto,
} from "@mg/shared";
import { comEmpresa, type Tx } from "../../infra/banco.js";
import { conflito, invalido, naoEncontrado, semPermissao } from "../../infra/erros.js";
import { iso, montarPagina } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import { lerPermissoes } from "../permissoes/permissoes.repositorio.js";
import { convidar, validarLotacao, type DadosConvite } from "./convites.js";
import * as repo from "./usuarios.repositorio.js";

const usuarioDto = (u: repo.LinhaUsuario): UsuarioDto => ({ ...u, criadoEm: iso(u.criadoEm), arquivadoEm: iso(u.arquivadoEm) });
const equipeDto = (e: repo.LinhaEquipe): EquipeDto => ({ ...e, criadoEm: iso(e.criadoEm), arquivadoEm: iso(e.arquivadoEm) });

const podeAdministrarUsuarios = (ctx: ContextoEmpresa) => Boolean(temPermissao(ctx.permissoes, "usuarios", "administrar"));

/** Garante que sempre reste ao menos uma pessoa ativa com o perfil protegido (Dono). */
async function garantirOutroDono(tx: Tx, empresaId: string, alvo: repo.LinhaUsuario): Promise<void> {
  if (!(await repo.perfilEhProtegido(tx, alvo.perfilId))) return;
  if ((await repo.contarDonosAtivosExceto(tx, empresaId, alvo.id)) === 0) {
    throw conflito("Esta é a única pessoa com perfil de Dono. Dê esse perfil a outra pessoa antes.");
  }
}

export function criarServicoUsuarios(s: Servicos) {
  const { banco } = s;

  async function visivel(tx: Tx, ctx: ContextoEmpresa, escopo: Escopo, id: string) {
    const u = await repo.buscarUsuarioVisivel(tx, ctx.empresaId, ctx, escopo, id);
    if (!u) throw naoEncontrado("Usuário");
    return u;
  }

  async function listar(ctx: ContextoEmpresa, escopo: Escopo, f: repo.FiltroLista): Promise<Pagina<UsuarioDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) =>
      montarPagina(await repo.listarUsuarios(tx, ctx.empresaId, ctx, escopo, f), f.limite, usuarioDto),
    );
  }

  async function obter(ctx: ContextoEmpresa, escopo: Escopo, id: string): Promise<UsuarioDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => usuarioDto(await visivel(tx, ctx, escopo, id)));
  }

  async function opcoes(ctx: ContextoEmpresa): Promise<OpcoesUsuarioDto> {
    return comEmpresa(banco, ctx.empresaId, (tx) => repo.opcoesDeFormulario(tx, ctx.empresaId));
  }

  async function convidarPessoa(ctx: ContextoEmpresa, origem: Origem, dados: DadosConvite) {
    const r = await comEmpresa(banco, ctx.empresaId, (tx) =>
      convidar(s, tx, { ...origem, empresaId: ctx.empresaId }, dados, podeAdministrarUsuarios(ctx)),
    );
    return { id: r.vinculoId, usuarioId: r.usuarioId };
  }

  async function atualizar(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    id: string,
    dados: { perfilId?: string; unidadeId?: string | null; equipeId?: string | null },
  ): Promise<UsuarioDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const antes = await visivel(tx, ctx, escopo, id);
      if (dados.perfilId && dados.perfilId !== antes.perfilId) {
        if (id === ctx.vinculoId) throw conflito("Você não pode trocar o próprio perfil. Peça a outro administrador.");
        const novo = await tx.db.query.perfil.findFirst({
          where: (p, { and, eq, isNull }) => and(eq(p.id, dados.perfilId!), eq(p.empresaId, ctx.empresaId), isNull(p.arquivadoEm)),
          columns: { id: true },
        });
        if (!novo) throw invalido("Escolha um perfil válido.");
        const permissoes = (await lerPermissoes(tx, [novo.id])).get(novo.id) ?? {};
        if (perfilAdministra(permissoes) && !podeAdministrarUsuarios(ctx)) throw semPermissao();
        await garantirOutroDono(tx, ctx.empresaId, antes);
      }
      await validarLotacao(tx, ctx.empresaId, dados.unidadeId ?? null, dados.equipeId ?? null);
      await repo.atualizarVinculo(tx, ctx.empresaId, id, dados);
      const depois = await visivel(tx, ctx, "empresa", id);
      await registrar(tx, origem, {
        acao: "usuario.atualizado",
        entidade: "usuario",
        entidadeId: antes.usuarioId,
        responsavelId: antes.usuarioId,
        antes: { perfilId: antes.perfilId, unidadeId: antes.unidadeId, equipeId: antes.equipeId },
        depois: { perfilId: depois.perfilId, unidadeId: depois.unidadeId, equipeId: depois.equipeId },
      });
      return usuarioDto(depois);
    });
  }

  async function alternarArquivo(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string, arquivar: boolean) {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const alvo = await visivel(tx, ctx, escopo, id);
      if (arquivar) {
        if (id === ctx.vinculoId) throw conflito("Você não pode arquivar o próprio cadastro.");
        await garantirOutroDono(tx, ctx.empresaId, alvo);
      }
      await repo.atualizarVinculo(tx, ctx.empresaId, id, { arquivadoEm: arquivar ? new Date() : null });
      await registrar(tx, origem, {
        acao: arquivar ? "usuario.arquivado" : "usuario.restaurado",
        entidade: "usuario",
        entidadeId: alvo.usuarioId,
        responsavelId: alvo.usuarioId,
      });
    });
  }

  // Equipes ---------------------------------------------------------------------------------------

  async function validarGestor(tx: Tx, empresaId: string, gestorId: string | null | undefined) {
    if (gestorId && !(await repo.pessoaDaEmpresa(tx, empresaId, gestorId))) {
      throw invalido("O gestor escolhido não faz parte da empresa.");
    }
  }

  async function listarEquipes(ctx: ContextoEmpresa, escopo: Escopo, f: repo.FiltroLista): Promise<Pagina<EquipeDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) =>
      montarPagina(await repo.listarEquipes(tx, ctx.empresaId, ctx, escopo, f), f.limite, equipeDto),
    );
  }

  async function criarEquipe(
    ctx: ContextoEmpresa,
    origem: Origem,
    dados: { nome: string; unidadeId?: string | null; gestorId?: string | null },
  ): Promise<EquipeDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      await validarLotacao(tx, ctx.empresaId, dados.unidadeId ?? null, null);
      await validarGestor(tx, ctx.empresaId, dados.gestorId);
      const { id } = await repo.inserirEquipe(tx, {
        empresaId: ctx.empresaId,
        nome: dados.nome,
        unidadeId: dados.unidadeId ?? null,
        gestorId: dados.gestorId ?? null,
        criadoPor: ctx.usuarioId,
      });
      await registrar(tx, origem, { acao: "equipe.criada", entidade: "equipe", entidadeId: id, responsavelId: dados.gestorId ?? null, depois: dados });
      return equipeDto((await repo.buscarEquipeVisivel(tx, ctx.empresaId, ctx, "empresa", id))!);
    });
  }

  async function atualizarEquipe(
    ctx: ContextoEmpresa,
    escopo: Escopo,
    origem: Origem,
    id: string,
    dados: { nome?: string; unidadeId?: string | null; gestorId?: string | null },
  ): Promise<EquipeDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const antes = await repo.buscarEquipeVisivel(tx, ctx.empresaId, ctx, escopo, id);
      if (!antes) throw naoEncontrado("Equipe");
      await validarLotacao(tx, ctx.empresaId, dados.unidadeId ?? null, null);
      await validarGestor(tx, ctx.empresaId, dados.gestorId);
      await repo.atualizarEquipe(tx, ctx.empresaId, id, dados);
      const depois = (await repo.buscarEquipeVisivel(tx, ctx.empresaId, ctx, "empresa", id))!;
      await registrar(tx, origem, { acao: "equipe.atualizada", entidade: "equipe", entidadeId: id, responsavelId: depois.gestorId, antes, depois });
      return equipeDto(depois);
    });
  }

  async function alternarArquivoEquipe(ctx: ContextoEmpresa, escopo: Escopo, origem: Origem, id: string, arquivar: boolean) {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const alvo = await repo.buscarEquipeVisivel(tx, ctx.empresaId, ctx, escopo, id);
      if (!alvo) throw naoEncontrado("Equipe");
      await repo.atualizarEquipe(tx, ctx.empresaId, id, { arquivadoEm: arquivar ? new Date() : null });
      await registrar(tx, origem, {
        acao: arquivar ? "equipe.arquivada" : "equipe.restaurada",
        entidade: "equipe",
        entidadeId: id,
        responsavelId: alvo.gestorId,
      });
    });
  }

  return {
    listar,
    obter,
    opcoes,
    convidarPessoa,
    atualizar,
    alternarArquivo,
    listarEquipes,
    criarEquipe,
    atualizarEquipe,
    alternarArquivoEquipe,
  };
}
