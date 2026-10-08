// Perfis personalizados e suas permissões. O perfil de Dono é protegido: sempre existe alguém que administra.
import { limparPermissoes, type Pagina, type PerfilDto, type Permissoes } from "@mg/shared";
import { comEmpresa } from "../../infra/banco.js";
import { ErroApp, conflito, naoEncontrado } from "../../infra/erros.js";
import { iso, montarPagina } from "../../infra/paginacao.js";
import type { Servicos } from "../../app.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import * as repo from "./permissoes.repositorio.js";

type LinhaPerfil = Awaited<ReturnType<typeof repo.buscarPerfil>> & {};

const paraDto = (p: LinhaPerfil, permissoes: Permissoes): PerfilDto => ({
  id: p.id,
  nome: p.nome,
  base: p.base,
  protegido: p.protegido,
  permissoes,
  criadoEm: iso(p.criadoEm),
  arquivadoEm: iso(p.arquivadoEm),
});

const perfilProtegido = () =>
  new ErroApp(
    403,
    "PERFIL_PROTEGIDO",
    "O perfil de Dono não pode ser alterado: ele garante que sempre exista alguém com acesso total.",
  );

export function criarServicoPerfis(s: Servicos) {
  const { banco } = s;

  async function listar(
    ctx: ContextoEmpresa,
    f: { arquivados: "sim" | "nao"; busca?: string; cursor?: string; limite: number },
  ): Promise<Pagina<PerfilDto>> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const linhas = await repo.listarPerfis(tx, ctx.empresaId, f);
      const permissoes = await repo.lerPermissoes(tx, linhas.map((l) => l.id));
      return montarPagina(linhas, f.limite, (l) => paraDto(l, permissoes.get(l.id) ?? {}));
    });
  }

  async function obter(ctx: ContextoEmpresa, id: string): Promise<PerfilDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const p = await repo.buscarPerfil(tx, ctx.empresaId, id);
      if (!p) throw naoEncontrado("Perfil");
      return paraDto(p, (await repo.lerPermissoes(tx, [id])).get(id) ?? {});
    });
  }

  /** Perfil novo parte de outro (ex.: "SDR" a partir de Vendedor). */
  async function criar(ctx: ContextoEmpresa, origem: Origem, dados: { nome: string; copiarDe: string }): Promise<PerfilDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const base = await repo.buscarPerfil(tx, ctx.empresaId, dados.copiarDe);
      if (!base) throw naoEncontrado("Perfil de partida");
      const permissoes = (await repo.lerPermissoes(tx, [base.id])).get(base.id) ?? {};
      const novo = await repo.inserirPerfil(tx, {
        empresaId: ctx.empresaId,
        nome: dados.nome,
        base: base.base,
        criadoPor: ctx.usuarioId,
      });
      await repo.gravarPermissoes(tx, ctx.empresaId, novo.id, permissoes);
      await registrar(tx, origem, {
        acao: "perfil.criado",
        entidade: "perfil",
        entidadeId: novo.id,
        depois: { nome: novo.nome, copiadoDe: base.id, permissoes },
      });
      return paraDto(novo, permissoes);
    });
  }

  async function atualizar(
    ctx: ContextoEmpresa,
    origem: Origem,
    id: string,
    dados: { nome?: string; permissoes?: Record<string, unknown> },
  ): Promise<PerfilDto> {
    return comEmpresa(banco, ctx.empresaId, async (tx) => {
      const antes = await repo.buscarPerfil(tx, ctx.empresaId, id);
      if (!antes) throw naoEncontrado("Perfil");
      if (antes.protegido) throw perfilProtegido();
      const permissoesAntes = (await repo.lerPermissoes(tx, [id])).get(id) ?? {};
      const permissoes = dados.permissoes ? limparPermissoes(dados.permissoes) : permissoesAntes;
      if (dados.nome) await repo.atualizarPerfil(tx, ctx.empresaId, id, { nome: dados.nome });
      if (dados.permissoes) await repo.gravarPermissoes(tx, ctx.empresaId, id, permissoes);
      await registrar(tx, origem, {
        acao: "perfil.atualizado",
        entidade: "perfil",
        entidadeId: id,
        antes: { nome: antes.nome, permissoes: permissoesAntes },
        depois: { nome: dados.nome ?? antes.nome, permissoes },
      });
      return paraDto({ ...antes, nome: dados.nome ?? antes.nome }, permissoes);
    });
  }

  async function alternarArquivo(ctx: ContextoEmpresa, origem: Origem, id: string, arquivar: boolean): Promise<void> {
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      const alvo = await repo.buscarPerfil(tx, ctx.empresaId, id);
      if (!alvo) throw naoEncontrado("Perfil");
      if (alvo.protegido) throw perfilProtegido();
      if (arquivar) {
        const emUso = await repo.contarVinculosAtivosDoPerfil(tx, id);
        if (emUso > 0) {
          throw conflito(`Este perfil está em uso por ${emUso} pessoa(s). Troque o perfil delas antes de arquivar.`);
        }
      }
      await repo.atualizarPerfil(tx, ctx.empresaId, id, { arquivadoEm: arquivar ? new Date() : null });
      await registrar(tx, origem, {
        acao: arquivar ? "perfil.arquivado" : "perfil.restaurado",
        entidade: "perfil",
        entidadeId: id,
      });
    });
  }

  return { listar, obter, criar, atualizar, alternarArquivo };
}
