// O Início de cada pessoa: a ordem dos blocos que ela escolheu ou, sem escolha, o padrão do perfil. Só blocos
// que o perfil pode ver entram e saem — perder uma permissão tira o bloco sem apagar a escolha.
import { and, eq, sql } from "drizzle-orm";
import { blocoPermitido, inicioPadrao, type BlocoInicioId, type InicioDto } from "@mg/shared";
import type { Servicos } from "../../app.js";
import { comEmpresa } from "../../infra/banco.js";
import { inicioPessoa } from "../../infra/esquema.js";
import { invalido } from "../../infra/erros.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { registrar, type Origem } from "../auditoria/registro.js";

export function criarServicoInicio(s: Servicos) {
  const { banco } = s;
  const permitido = (ctx: ContextoEmpresa, id: string) => blocoPermitido(id, ctx.permissoes, ctx.modulos);

  async function ver(ctx: ContextoEmpresa): Promise<InicioDto> {
    const [linha] = await comEmpresa(banco, ctx.empresaId, (tx) =>
      tx.db
        .select({ blocos: inicioPessoa.blocos })
        .from(inicioPessoa)
        .where(and(eq(inicioPessoa.empresaId, ctx.empresaId), eq(inicioPessoa.usuarioId, ctx.usuarioId))),
    );
    if (!linha?.blocos) return { blocos: inicioPadrao(ctx.permissoes, ctx.modulos), padrao: true };
    return { blocos: linha.blocos.filter((id) => permitido(ctx, id)) as BlocoInicioId[], padrao: false };
  }

  /** blocos null = voltar ao padrão do perfil (a linha fica, com a escolha vazia). */
  async function salvar(ctx: ContextoEmpresa, origem: Origem, blocos: BlocoInicioId[] | null): Promise<InicioDto> {
    const proibido = blocos?.find((id) => !permitido(ctx, id));
    if (proibido) throw invalido("Esse bloco não está disponível para o seu perfil.");
    await comEmpresa(banco, ctx.empresaId, async (tx) => {
      await tx.db
        .insert(inicioPessoa)
        .values({ empresaId: ctx.empresaId, usuarioId: ctx.usuarioId, blocos })
        .onConflictDoUpdate({ target: [inicioPessoa.empresaId, inicioPessoa.usuarioId], set: { blocos: sql`excluded.blocos`, atualizadoEm: new Date() } });
      await registrar(tx, origem, {
        acao: blocos ? "inicio.personalizado" : "inicio.padrao_restaurado",
        entidade: "usuario",
        entidadeId: ctx.usuarioId,
        paraUsuarioId: ctx.usuarioId,
        depois: { blocos },
      });
    });
    return ver(ctx);
  }

  return { ver, salvar };
}
