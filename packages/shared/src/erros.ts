// Padrão único de erro da API: { error: { code, message, details } }.
// O código é estável (o front decide por ele); a mensagem é para a pessoa ler.
import { z } from "zod";

export const CODIGOS_ERRO = [
  "NAO_AUTENTICADO",
  "SEM_PERMISSAO",
  "EMPRESA_NAO_SELECIONADA",
  "MODULO_INATIVO",
  "NAO_ENCONTRADO",
  "DADOS_INVALIDOS",
  "CONFLITO",
  "LIMITE_EXCEDIDO",
  "CSRF_INVALIDO",
  "CORPO_GRANDE",
  "LOGIN_INVALIDO",
  "LOGIN_BLOQUEADO",
  "SEM_ACESSO_LIBERADO",
  "LINK_INVALIDO",
  "PERFIL_PROTEGIDO",
  "ULTIMO_DONO",
  "PERIODO_FECHADO",
  "CODIGO_INVALIDO",
  "DUAS_ETAPAS_OBRIGATORIAS",
  "ERRO_INTERNO",
] as const;

export type CodigoErro = (typeof CODIGOS_ERRO)[number];

export const RespostaErro = z.object({
  error: z.object({
    code: z.enum(CODIGOS_ERRO),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type RespostaErro = z.infer<typeof RespostaErro>;
