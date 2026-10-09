// Fase 7 — Endurecimento: login em duas etapas, LGPD (titular), retenção e avisos no celular (push).
import { z } from "zod";
import { DataIso } from "./dto.js";

// Duas etapas ----------------------------------------------------------------------------------------------

export const METODOS_DUAS_ETAPAS = ["totp", "email"] as const;
export type MetodoDuasEtapas = (typeof METODOS_DUAS_ETAPAS)[number];
export const NOMES_METODOS_DUAS_ETAPAS: Record<MetodoDuasEtapas, string> = {
  totp: "App autenticador",
  email: "Código por e-mail",
};

/** Quem a empresa obriga a usar duas etapas. */
export const EXIGENCIAS_DUAS_ETAPAS = ["nao", "admins", "todos"] as const;
export type ExigenciaDuasEtapas = (typeof EXIGENCIAS_DUAS_ETAPAS)[number];
export const NOMES_EXIGENCIAS_DUAS_ETAPAS: Record<ExigenciaDuasEtapas, string> = {
  nao: "Opcional para todos",
  admins: "Obrigatória para administradores",
  todos: "Obrigatória para todos",
};

export const QTD_CODIGOS_RECUPERACAO = 10;

/** 6 dígitos (app ou e-mail) ou código de recuperação (xxxx-xxxx). Espaços e hífens são tolerados. */
export const CodigoVerificacao = z
  .string()
  .trim()
  .min(6, { error: "Digite o código de 6 dígitos." })
  .max(20, { error: "Código inválido." });

export const EntrarResposta = z.object({
  ok: z.literal(true),
  /** Presente quando a pessoa usa duas etapas: falta o código. */
  duasEtapas: z.object({ metodo: z.enum(METODOS_DUAS_ETAPAS), destino: z.string().nullable() }).optional(),
});
export type EntrarResposta = z.infer<typeof EntrarResposta>;

export const ConfirmarCodigoEntrada = z.object({ codigo: CodigoVerificacao });
export const IniciarDuasEtapasEntrada = z.object({ metodo: z.enum(METODOS_DUAS_ETAPAS) });
export const SenhaAtualEntrada = z.object({ senha: z.string().min(1, { error: "Informe sua senha." }).max(200) });

export const DuasEtapasDto = z.object({
  ativa: z.boolean(),
  metodo: z.enum(METODOS_DUAS_ETAPAS).nullable(),
  /** A empresa ativa exige duas etapas desta pessoa. */
  obrigatoria: z.boolean(),
  codigosRestantes: z.number().int(),
  ativadaEm: DataIso.nullable(),
});
export type DuasEtapasDto = z.infer<typeof DuasEtapasDto>;

export const IniciarDuasEtapasDto = z.object({
  metodo: z.enum(METODOS_DUAS_ETAPAS),
  /** App autenticador: chave para digitar à mão e o QR code (data URL PNG). */
  segredo: z.string().nullable(),
  qr: z.string().nullable(),
  /** E-mail: para onde o código foi (mascarado). */
  destino: z.string().nullable(),
});
export type IniciarDuasEtapasDto = z.infer<typeof IniciarDuasEtapasDto>;

export const CodigosRecuperacaoDto = z.object({ codigos: z.array(z.string()) });
export type CodigosRecuperacaoDto = z.infer<typeof CodigosRecuperacaoDto>;

export const SegurancaEmpresaDto = z.object({ exigirDuasEtapas: z.enum(EXIGENCIAS_DUAS_ETAPAS) });
export type SegurancaEmpresaDto = z.infer<typeof SegurancaEmpresaDto>;
export const SegurancaEmpresaEntrada = SegurancaEmpresaDto;
