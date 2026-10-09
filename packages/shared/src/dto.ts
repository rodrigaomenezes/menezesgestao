// Contrato da API: entradas (validadas no servidor) e saídas (DTOs). O servidor usa estes esquemas para
// validar e para recortar as respostas; o front usa os tipos. A documentação OpenAPI nasce deles.
import { z } from "zod";
import { ACOES, ESCOPOS, IDS_MODULOS, type Permissoes } from "./catalogo.js";
import { SENHA_MAXIMO, SENHA_MINIMO } from "./limites.js";
import { COR_HEX } from "./marca.js";
import { SLUG_MAXIMO, SLUG_REGEX } from "./slug.js";

// Peças -------------------------------------------------------------------------------------------

export const Id = z.uuid({ error: "Identificador inválido." });
export const DataIso = z.string();
const texto = (max: number, rotulo = "Este campo") =>
  z.string().trim().min(1, { error: `${rotulo}: preencha.` }).max(max, { error: `${rotulo}: no máximo ${max} caracteres.` });
export const Email = z.email({ error: "Informe um e-mail válido." }).max(200);
export const SenhaNova = z
  .string()
  .min(SENHA_MINIMO, { error: `A senha precisa ter pelo menos ${SENHA_MINIMO} caracteres.` })
  .max(SENHA_MAXIMO, { error: `A senha pode ter no máximo ${SENHA_MAXIMO} caracteres.` });
export const Token = z.string().min(20).max(200);
export const IdOpcional = Id.nullish();

export const ParamId = z.object({ id: Id });
export const Ok = z.object({ ok: z.literal(true) });

export const Paginacao = z.object({
  cursor: z.string().max(200).optional(),
  limite: z.coerce.number().int().min(1).max(100).default(50),
});
export const FiltroLista = Paginacao.extend({
  arquivados: z.enum(["sim", "nao"]).default("nao"),
  busca: z.string().trim().max(100).optional(),
});

export function pagina<T extends z.ZodType>(item: T) {
  return z.object({ itens: z.array(item), proximoCursor: z.string().nullable() });
}
export interface Pagina<T> {
  itens: T[];
  proximoCursor: string | null;
}

export const PermissoesDto = z.partialRecord(
  z.enum(IDS_MODULOS as [string, ...string[]]),
  z.partialRecord(z.enum(ACOES), z.enum(ESCOPOS)),
) as unknown as z.ZodType<Permissoes>;

export const MarcaDto = z.object({
  nomeProduto: z.string(),
  corPrimaria: z.string(),
  corDestaque: z.string(),
  logoClaro: z.string().nullable().optional(),
  logoEscuro: z.string().nullable().optional(),
});

// Autenticação -------------------------------------------------------------------------------------

export const EntrarEntrada = z.object({
  email: Email,
  senha: z.string().min(1, { error: "Informe a senha." }).max(SENHA_MAXIMO),
  empresaId: Id.optional(),
});
export const TrocarEmpresaEntrada = z.object({ empresaId: Id });
export const EsqueciEntrada = z.object({ email: Email });
export const RedefinirEntrada = z.object({ token: Token, senha: SenhaNova });
export const ConviteConsulta = z.object({ token: Token });
export const AceitarConviteEntrada = z.object({
  token: Token,
  nome: z.string().trim().min(2).max(120).optional(),
  senha: SenhaNova.optional(),
});

export const EuDto = z.object({
  usuario: z.object({ id: Id, nome: z.string(), email: z.string() }),
  empresa: z
    .object({
      id: Id,
      nome: z.string(),
      slug: z.string(),
      plano: z.string(),
      fuso: z.string(),
      modulos: z.array(z.string()),
      /** Termos próprios da empresa (ex.: { contato: "aluno" }). */
      vocabulario: z.record(z.string(), z.string()),
    })
    .nullable(),
  perfil: z.object({ id: Id, nome: z.string() }).nullable(),
  permissoes: PermissoesDto,
  marca: MarcaDto,
  empresas: z.array(z.object({ id: Id, nome: z.string() })),
});
export type EuDto = z.infer<typeof EuDto>;

export const ConviteInfoDto = z.object({
  empresaNome: z.string(),
  email: z.string(),
  nome: z.string(),
  precisaSenha: z.boolean(),
});
export type ConviteInfoDto = z.infer<typeof ConviteInfoDto>;

export const SessaoDto = z.object({
  id: Id,
  dispositivo: z.string().nullable(),
  ip: z.string().nullable(),
  criadoEm: DataIso,
  ultimoUso: DataIso,
  atual: z.boolean(),
});
export type SessaoDto = z.infer<typeof SessaoDto>;

// Empresa e unidades -------------------------------------------------------------------------------

export const EmpresaDto = z.object({
  id: Id,
  nome: z.string(),
  slug: z.string(),
  fuso: z.string(),
  plano: z.string(),
  modulos: z.array(z.string()),
  marca: z.object({ nomeProduto: z.string().optional(), corPrimaria: z.string(), corDestaque: z.string() }),
});
export type EmpresaDto = z.infer<typeof EmpresaDto>;

const Cor = z.string().regex(COR_HEX, { error: "Use uma cor no formato #RRGGBB." });
export const AtualizarEmpresaEntrada = z.object({
  nome: texto(120, "Nome").optional(),
  slug: z
    .string()
    .trim()
    .min(3, { error: "O identificador precisa de pelo menos 3 caracteres." })
    .max(SLUG_MAXIMO)
    .regex(SLUG_REGEX, { error: "Use só letras minúsculas, números e hífen (ex.: minha-empresa)." })
    .optional(),
  fuso: z.string().max(60).optional(),
  marca: z.object({ nomeProduto: z.string().trim().max(60).optional(), corPrimaria: Cor, corDestaque: Cor }).optional(),
});

export const UnidadeDto = z.object({
  id: Id,
  nome: z.string(),
  endereco: z.string().nullable(),
  criadoEm: DataIso,
  arquivadoEm: DataIso.nullable(),
});
export type UnidadeDto = z.infer<typeof UnidadeDto>;
export const UnidadeEntrada = z.object({ nome: texto(120, "Nome"), endereco: z.string().trim().max(300).nullish() });

// Usuários, convites e equipes ---------------------------------------------------------------------

export const UsuarioDto = z.object({
  id: Id,
  usuarioId: Id,
  nome: z.string(),
  email: z.string(),
  status: z.enum(["convidado", "ativo"]),
  perfilId: Id,
  perfilNome: z.string(),
  unidadeId: Id.nullable(),
  unidadeNome: z.string().nullable(),
  equipeId: Id.nullable(),
  equipeNome: z.string().nullable(),
  criadoEm: DataIso,
  arquivadoEm: DataIso.nullable(),
});
export type UsuarioDto = z.infer<typeof UsuarioDto>;

export const ConvidarEntrada = z.object({
  email: Email,
  nome: texto(120, "Nome"),
  perfilId: z.uuid({ error: "Escolha um perfil." }),
  unidadeId: IdOpcional,
  equipeId: IdOpcional,
});
export const ConviteCriadoDto = z.object({ id: Id, usuarioId: Id });
export const AtualizarUsuarioEntrada = z.object({ perfilId: Id.optional(), unidadeId: IdOpcional, equipeId: IdOpcional });

const Opcao = z.object({ id: Id, nome: z.string() });
export const OpcoesUsuarioDto = z.object({ perfis: z.array(Opcao), unidades: z.array(Opcao), equipes: z.array(Opcao) });
export type OpcoesUsuarioDto = z.infer<typeof OpcoesUsuarioDto>;

export const EquipeDto = z.object({
  id: Id,
  nome: z.string(),
  unidadeId: Id.nullable(),
  unidadeNome: z.string().nullable(),
  gestorId: Id.nullable(),
  gestorNome: z.string().nullable(),
  criadoEm: DataIso,
  arquivadoEm: DataIso.nullable(),
});
export type EquipeDto = z.infer<typeof EquipeDto>;
export const EquipeEntrada = z.object({ nome: texto(120, "Nome"), unidadeId: IdOpcional, gestorId: IdOpcional });

// Perfis e permissões ------------------------------------------------------------------------------

export const PerfilDto = z.object({
  id: Id,
  nome: z.string(),
  base: z.string().nullable(),
  protegido: z.boolean(),
  permissoes: PermissoesDto,
  criadoEm: DataIso,
  arquivadoEm: DataIso.nullable(),
});
export type PerfilDto = z.infer<typeof PerfilDto>;
const NomePerfil = z.string().trim().min(2, { error: "Dê um nome ao perfil." }).max(80);
export const CriarPerfilEntrada = z.object({ nome: NomePerfil, copiarDe: z.uuid({ error: "Escolha o perfil de partida." }) });
export const AtualizarPerfilEntrada = z.object({
  nome: NomePerfil.optional(),
  permissoes: z.record(z.string(), z.unknown()).optional(),
});

// Auditoria e notificações -------------------------------------------------------------------------

export const AuditoriaDto = z.object({
  id: Id,
  acao: z.string(),
  entidade: z.string(),
  entidadeId: Id.nullable(),
  atorId: Id.nullable(),
  atorNome: z.string().nullable(),
  antes: z.unknown(),
  depois: z.unknown(),
  ip: z.string().nullable(),
  dispositivo: z.string().nullable(),
  criadoEm: DataIso,
});
export type AuditoriaDto = z.infer<typeof AuditoriaDto>;
export const FiltroAuditoria = Paginacao.extend({
  atorId: Id.optional(),
  entidade: z.string().max(40).optional(),
  acao: z.string().max(60).optional(),
  de: z.coerce.date().optional(),
  ate: z.coerce.date().optional(),
});

export const NotificacaoDto = z.object({
  id: Id,
  titulo: z.string(),
  texto: z.string().nullable(),
  link: z.string().nullable(),
  lidaEm: DataIso.nullable(),
  criadoEm: DataIso,
});
export type NotificacaoDto = z.infer<typeof NotificacaoDto>;
export const PaginaNotificacoes = pagina(NotificacaoDto).extend({ naoLidas: z.number().int() });
