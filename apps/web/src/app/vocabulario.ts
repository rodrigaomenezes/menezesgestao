// Vocabulário da empresa nas telas: um só ponto para "Alunos", "Nova matrícula", "Paciente não encontrado"…
// Todo texto que fala de cliente, oportunidade, oferta, entrega, prestador, colaborador ou unidade passa por aqui.
import { useMemo } from "react";
import { CHAVES_TERMOS, maiuscula, termo, texto, type ChaveTermo, type Vocabulario } from "@mg/shared";
import { useSessao } from "./sessao";

type Formas = Record<ChaveTermo | `${ChaveTermo}s` | Capitalize<ChaveTermo> | `${Capitalize<ChaveTermo>}s`, string>;

export interface Termos extends Formas {
  /** Monta uma frase com marcadores: t("{Novo contato}") → "Novo aluno"; t("{Oportunidade} ganh{o|a:oportunidade}"). */
  t(modelo: string): string;
}

export function termosDe(v: Vocabulario): Termos {
  const formas = {} as Formas;
  for (const chave of CHAVES_TERMOS) {
    const { singular, plural } = termo(v, chave);
    const k = maiuscula(chave) as Capitalize<ChaveTermo>;
    formas[chave] = singular;
    formas[`${chave}s`] = plural;
    formas[k] = maiuscula(singular);
    formas[`${k}s`] = maiuscula(plural);
  }
  return { ...formas, t: (modelo: string) => texto(modelo, v) };
}

/** Funciona também fora da sessão (login, páginas públicas): usa os termos padrão. */
export function useVocabulario(): Termos {
  const v = useSessao().eu?.empresa?.vocabulario;
  return useMemo(() => termosDe(v ?? {}), [v]);
}
