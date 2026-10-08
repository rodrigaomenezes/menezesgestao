// Carteira: quem pode ser responsável por um registro, conforme o escopo de quem atribui.
// Vendedor (próprio) só atribui a si; gestor (equipe) a quem está na equipe; empresa, a qualquer pessoa ativa.
import { and, eq, isNull } from "drizzle-orm";
import type { Escopo } from "@mg/shared";
import type { Tx } from "../../infra/banco.js";
import { vinculo } from "../../infra/esquema.js";
import { invalido } from "../../infra/erros.js";
import type { ContextoEmpresa } from "../acesso/acesso.js";
import { usuariosVisiveis } from "../acesso/escopo.js";

export async function validarResponsavel(
  tx: Tx,
  ctx: ContextoEmpresa,
  escopo: Escopo,
  responsavelId: string | null | undefined,
): Promise<string> {
  const alvo = responsavelId ?? ctx.usuarioId;
  if (alvo === ctx.usuarioId) return alvo;
  const visiveis = await usuariosVisiveis(tx, ctx, escopo);
  if (visiveis !== "todos" && !visiveis.has(alvo)) {
    throw invalido("Você só pode atribuir a pessoas da sua carteira ou equipe.");
  }
  const [v] = await tx.db
    .select({ id: vinculo.id })
    .from(vinculo)
    .where(and(eq(vinculo.empresaId, ctx.empresaId), eq(vinculo.usuarioId, alvo), eq(vinculo.status, "ativo"), isNull(vinculo.arquivadoEm)));
  if (!v) throw invalido("O responsável escolhido não está ativo na empresa.");
  return alvo;
}
