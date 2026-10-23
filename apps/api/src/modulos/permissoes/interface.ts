// Interface pública do módulo de permissões para outros módulos (criar empresa, convites, usuários).
// O repositório continua interno: quem está fora usa só estas funções (POLITICA_ENGENHARIA, item 1).
import type { Permissoes } from "@mg/shared";
import type { Tx } from "../../infra/banco.js";
import { gravarPermissoes, inserirPerfil, lerPermissoes } from "./permissoes.repositorio.js";

/** Permissões de um perfil (vazio se o perfil não tiver nenhuma). */
export async function permissoesDoPerfil(tx: Tx, perfilId: string): Promise<Permissoes> {
  return (await lerPermissoes(tx, [perfilId])).get(perfilId) ?? {};
}

/** Cria um perfil já com as permissões, na mesma transação de quem chama. */
export async function criarPerfilComPermissoes(
  tx: Tx,
  dados: { empresaId: string; nome: string; base: string | null; protegido?: boolean; criadoPor: string | null },
  permissoes: Permissoes,
) {
  const p = await inserirPerfil(tx, dados);
  await gravarPermissoes(tx, dados.empresaId, p.id, permissoes);
  return p;
}
