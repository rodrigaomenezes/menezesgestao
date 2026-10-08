// Uma regra, um lugar: validação dos valores de campos personalizados (formulário, importação e etapas).
import type { TipoCampo } from "@mg/shared";
import { invalido } from "../../infra/erros.js";

export interface DefinicaoCampo {
  chave: string;
  rotulo: string;
  tipo: TipoCampo;
  opcoes: string[];
  obrigatorio: boolean;
}

function converter(def: DefinicaoCampo, valor: unknown): { ok: true; valor: unknown } | { ok: false; motivo: string } {
  if (valor === null || valor === undefined || valor === "") return { ok: true, valor: null };
  switch (def.tipo) {
    case "texto":
      return { ok: true, valor: String(valor).trim().slice(0, 1000) };
    case "numero": {
      const n = typeof valor === "number" ? valor : Number(String(valor).replace(/\./g, "").replace(",", "."));
      return Number.isFinite(n) ? { ok: true, valor: n } : { ok: false, motivo: `${def.rotulo}: informe um número.` };
    }
    case "data": {
      const texto = String(valor).trim();
      const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
      const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : texto.slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(iso))
        ? { ok: true, valor: iso }
        : { ok: false, motivo: `${def.rotulo}: use uma data como 31/12/2026.` };
    }
    case "lista": {
      const texto = String(valor).trim();
      const opcao = def.opcoes.find((o) => o.toLowerCase() === texto.toLowerCase());
      return opcao ? { ok: true, valor: opcao } : { ok: false, motivo: `${def.rotulo}: escolha uma das opções (${def.opcoes.join(", ")}).` };
    }
    case "sim_nao": {
      if (typeof valor === "boolean") return { ok: true, valor };
      const t = String(valor).trim().toLowerCase();
      if (["sim", "s", "true", "1", "yes"].includes(t)) return { ok: true, valor: true };
      if (["não", "nao", "n", "false", "0", "no"].includes(t)) return { ok: true, valor: false };
      return { ok: false, motivo: `${def.rotulo}: responda sim ou não.` };
    }
  }
}

/**
 * Valida e normaliza valores contra as definições ativas. Chaves desconhecidas são descartadas.
 * `exigirObrigatorios`: no cadastro completo, campo obrigatório vazio é erro.
 */
export function validarCampos(
  definicoes: DefinicaoCampo[],
  valores: Record<string, unknown>,
  opcoes: { exigirObrigatorios: boolean; atuais?: Record<string, unknown> },
): Record<string, unknown> {
  const resultado: Record<string, unknown> = { ...(opcoes.atuais ?? {}) };
  const problemas: string[] = [];
  for (const def of definicoes) {
    if (def.chave in valores) {
      const r = converter(def, valores[def.chave]);
      if (!r.ok) problemas.push(r.motivo);
      else if (r.valor === null) delete resultado[def.chave];
      else resultado[def.chave] = r.valor;
    }
    if (opcoes.exigirObrigatorios && def.obrigatorio && (resultado[def.chave] === undefined || resultado[def.chave] === null)) {
      problemas.push(`${def.rotulo}: preencha (campo obrigatório).`);
    }
  }
  if (problemas.length) throw invalido(problemas[0], { problemas });
  return resultado;
}

/** Para importação: mesma conversão, mas devolve o motivo em vez de lançar. */
export function converterCampoImportado(def: DefinicaoCampo, valor: unknown) {
  return converter(def, valor);
}
