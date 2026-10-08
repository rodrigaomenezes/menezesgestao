// Convite por e-mail: cria (ou reaproveita) o usuário global, o vínculo com a empresa e o link de acesso.
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { perfilAdministra } from "@mg/shared";
import { comoSistema, type Banco, type Tx } from "../../infra/banco.js";
import { empresa, equipe, perfil, tokenAcesso, unidade, usuario, vinculo } from "../../infra/esquema.js";
import type { Config } from "../../config.js";
import type { Jobs } from "../../infra/jobs.js";
import { hashToken, novoToken } from "../../infra/seguranca/cripto.js";
import { conflito, invalido, semPermissao } from "../../infra/erros.js";
import { registrar, type Origem } from "../auditoria/registro.js";
import { lerPermissoes } from "../permissoes/permissoes.repositorio.js";

export const VALIDADE_CONVITE_DIAS = 7;

export interface DadosConvite {
  email: string;
  nome: string;
  perfilId: string;
  unidadeId?: string | null;
  equipeId?: string | null;
}

/** Usuário é global: busca por e-mail em todas as empresas, por isso usa o caminho do sistema. */
export async function garantirUsuario(banco: Banco, email: string, nome: string): Promise<string> {
  return comoSistema(banco, async (tx) => {
    const { rows } = await tx.cliente.query<{ id: string }>(
      `INSERT INTO usuario (email, nome) VALUES ($1, $2)
       ON CONFLICT ((lower(email))) DO NOTHING RETURNING id`,
      [email.trim(), nome.trim()],
    );
    if (rows[0]) return rows[0].id;
    const existente = await tx.cliente.query<{ id: string }>("SELECT id FROM usuario WHERE lower(email) = lower($1)", [
      email.trim(),
    ]);
    return existente.rows[0].id;
  });
}

interface Dependencias {
  banco: Banco;
  config: Config;
  jobs: Jobs;
}

/**
 * Convida dentro de uma transação da empresa (`tx` de comEmpresa ou do sistema com origem.empresaId).
 * `podeAdministrar`: quem convida pode dar um perfil que administra algum módulo?
 */
export async function convidar(
  deps: Dependencias,
  tx: Tx,
  origem: Origem & { empresaId: string },
  dados: DadosConvite,
  podeAdministrar: boolean,
): Promise<{ vinculoId: string; usuarioId: string }> {
  const empresaId = origem.empresaId;
  const [p] = await tx.db
    .select({ id: perfil.id })
    .from(perfil)
    .where(and(eq(perfil.id, dados.perfilId), eq(perfil.empresaId, empresaId), isNull(perfil.arquivadoEm)));
  if (!p) throw invalido("Escolha um perfil válido para a pessoa convidada.");
  const permissoes = (await lerPermissoes(tx, [p.id])).get(p.id) ?? {};
  if (perfilAdministra(permissoes) && !podeAdministrar) throw semPermissao();
  await validarLotacao(tx, empresaId, dados.unidadeId ?? null, dados.equipeId ?? null);

  const usuarioId = await garantirUsuario(deps.banco, dados.email, dados.nome);
  const [existente] = await tx.db
    .select()
    .from(vinculo)
    .where(and(eq(vinculo.empresaId, empresaId), eq(vinculo.usuarioId, usuarioId)));

  let vinculoId: string;
  if (existente) {
    if (existente.arquivadoEm) {
      throw conflito("Esta pessoa está arquivada. Restaure o cadastro dela na lista de usuários.");
    }
    if (existente.status === "ativo") throw conflito("Esta pessoa já faz parte da empresa.");
    vinculoId = existente.id;
    await tx.db
      .update(vinculo)
      .set({
        perfilId: p.id,
        unidadeId: dados.unidadeId ?? null,
        equipeId: dados.equipeId ?? null,
        convidadoPor: origem.atorId,
        atualizadoEm: new Date(),
      })
      .where(eq(vinculo.id, vinculoId));
  } else {
    vinculoId = randomUUID();
    await tx.db.insert(vinculo).values({
      id: vinculoId,
      empresaId,
      usuarioId,
      perfilId: p.id,
      unidadeId: dados.unidadeId ?? null,
      equipeId: dados.equipeId ?? null,
      status: "convidado",
      convidadoPor: origem.atorId,
    });
  }

  const token = novoToken();
  await tx.db.insert(tokenAcesso).values({
    id: randomUUID(),
    tipo: "convite",
    tokenHash: hashToken(deps.config.sessionSecret, token),
    usuarioId,
    empresaId,
    expiraEm: new Date(Date.now() + VALIDADE_CONVITE_DIAS * 24 * 60 * 60_000),
  });

  const [emp] = await tx.db.select({ nome: empresa.nome }).from(empresa).where(eq(empresa.id, empresaId));
  const [quem] = origem.atorId
    ? await tx.db.select({ nome: usuario.nome }).from(usuario).where(eq(usuario.id, origem.atorId))
    : [];
  await deps.jobs.enviarEmail(tx, {
    para: dados.email.trim(),
    assunto: `Convite para ${emp?.nome ?? "a empresa"} no ${deps.config.produtoNome}`,
    texto: [
      `Olá, ${dados.nome.trim()}!`,
      "",
      `${quem?.nome ?? "A administração"} convidou você para usar o ${deps.config.produtoNome} na empresa ${emp?.nome ?? ""}.`,
      `Para criar sua senha e entrar, abra o link abaixo (ele vale por ${VALIDADE_CONVITE_DIAS} dias):`,
      "",
      `${deps.config.appUrl}/convite?token=${token}`,
      "",
      "Se você não esperava este convite, pode ignorar este e-mail.",
    ].join("\n"),
  });

  await registrar(tx, origem, {
    acao: "usuario.convidado",
    entidade: "usuario",
    entidadeId: usuarioId,
    responsavelId: usuarioId,
    depois: { email: dados.email, perfilId: p.id, unidadeId: dados.unidadeId ?? null, equipeId: dados.equipeId ?? null },
  });
  return { vinculoId, usuarioId };
}

/** Unidade e equipe informadas precisam existir na empresa (o RLS já esconde as de outras). */
export async function validarLotacao(
  tx: Tx,
  empresaId: string,
  unidadeId: string | null,
  equipeId: string | null,
): Promise<void> {
  if (unidadeId) {
    const [u] = await tx.db
      .select({ id: unidade.id })
      .from(unidade)
      .where(and(eq(unidade.id, unidadeId), eq(unidade.empresaId, empresaId), isNull(unidade.arquivadoEm)));
    if (!u) throw invalido("A unidade escolhida não existe ou foi arquivada.");
  }
  if (equipeId) {
    const [e] = await tx.db
      .select({ id: equipe.id })
      .from(equipe)
      .where(and(eq(equipe.id, equipeId), eq(equipe.empresaId, empresaId), isNull(equipe.arquivadoEm)));
    if (!e) throw invalido("A equipe escolhida não existe ou foi arquivada.");
  }
}
