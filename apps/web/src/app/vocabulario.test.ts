// Guarda: nenhuma tela escreve "contato", "oportunidade", "unidade"… fixos. Todo texto que fala desses
// conceitos passa pelo vocabulário (termos.t("{Novo contato}")), senão a clínica veria "Contatos" em vez de "Pacientes".
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { termosDe } from "./vocabulario";

const RAIZ = join(import.meta.dirname, "..");
const TERMO_FIXO = /(?<![\w.\-{|:])(contatos?|oportunidades?|ofertas?|entregas?|prestador(?:es)?|colaborador(?:es)?|unidades?|clientes?|vendedor(?:es)?)(?![\w.\-}|:])/i;
/** Frases em que a palavra não é o conceito configurável. */
const PERMITIDAS = new Set(["Primeiro contato com esta pessoa."]);

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return arquivos(p);
    return /\.tsx?$/.test(n) && !n.endsWith(".test.ts") ? [p] : [];
  });
}

/** Textos que uma pessoa pode ler: literais com espaço ou inicial maiúscula e texto entre tags JSX. */
function textosVisiveis(codigo: string): string[] {
  const semComentarios = codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/\s.*$/gm, "");
  const achados: string[] = [];
  for (const linha of semComentarios.split("\n")) {
    if (/^\s*import\s/.test(linha)) continue;
    for (const m of linha.matchAll(/"([^"\n]*)"|`([^`\n]*)`|>([^<>{}\n]+)</g)) {
      const t = (m[1] ?? m[2] ?? m[3] ?? "").trim();
      if (!t || /^[\w./:${}-]*$/.test(t) || t.startsWith("/")) continue;
      // Partes ${...} de um template não são texto.
      achados.push(t.replace(/\$\{[^}]*\}/g, "…"));
    }
  }
  return achados;
}

describe("vocabulário nas telas", () => {
  it("nenhuma tela usa termo fixo de cliente, oportunidade, oferta, entrega, prestador, colaborador ou unidade", () => {
    const problemas: string[] = [];
    for (const arq of arquivos(RAIZ)) {
      if (arq.endsWith(join("app", "vocabulario.ts"))) continue;
      for (const t of textosVisiveis(readFileSync(arq, "utf8"))) {
        if (!PERMITIDAS.has(t) && TERMO_FIXO.test(t)) problemas.push(`${relative(RAIZ, arq)}: ${t}`);
      }
    }
    expect(problemas, "Use termos.t(\"{Contato} …\") com o vocabulário da empresa").toEqual([]);
  });

  it("monta formas e frases com o vocabulário da empresa", () => {
    const t = termosDe({ contato: "paciente", unidade: "clínica" });
    expect(t.Contatos).toBe("Pacientes");
    expect(t.t("{Nova unidade}")).toBe("Nova clínica");
    expect(termosDe({}).Oportunidades).toBe("Oportunidades");
  });
});
