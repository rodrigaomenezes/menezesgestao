// Leitura de planilhas (CSV ou XLSX) para a importação. Devolve sempre texto: a validação vem depois.
import { readSheet } from "read-excel-file/node";
import { invalido } from "../../infra/erros.js";

export const LIMITE_LINHAS = 20_000;
export const LIMITE_BYTES = 10 * 1024 * 1024;

export interface Planilha {
  colunas: string[];
  linhas: string[][];
}

/** CSV vindo do Excel brasileiro costuma ser Windows-1252 e usar ";". */
function decodificar(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

function separadorProvavel(primeiraLinha: string): string {
  const candidatos = [";", ",", "\t"];
  return candidatos.reduce((melhor, c) => (primeiraLinha.split(c).length > primeiraLinha.split(melhor).length ? c : melhor), ";");
}

/** CSV com aspas (inclusive quebras de linha dentro de aspas). */
export function lerCsv(texto: string): string[][] {
  const fimPrimeira = texto.search(/\r?\n/);
  const sep = separadorProvavel(fimPrimeira === -1 ? texto : texto.slice(0, fimPrimeira));
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      linha.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += c;
  }
  if (campo !== "" || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas;
}

function celulaParaTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).trim();
}

function tipoDoArquivo(nome: string, conteudo: Buffer): "xlsx" | "csv" {
  // XLSX é um ZIP (começa com "PK").
  if (conteudo[0] === 0x50 && conteudo[1] === 0x4b) return "xlsx";
  if (/\.xlsx$/i.test(nome)) return "xlsx";
  return "csv";
}

export async function lerPlanilha(nome: string, conteudo: Buffer): Promise<Planilha> {
  if (conteudo.length > LIMITE_BYTES) throw invalido("A planilha passou de 10 MB. Divida em arquivos menores.");
  let brutas: string[][];
  if (tipoDoArquivo(nome, conteudo) === "xlsx") {
    try {
      const dados = await readSheet(conteudo);
      brutas = dados.map((linha) => linha.map(celulaParaTexto));
    } catch {
      throw invalido("Não foi possível ler a planilha. Salve como .xlsx ou .csv e tente de novo.");
    }
  } else {
    brutas = lerCsv(decodificar(conteudo)).map((l) => l.map((c) => c.trim()));
  }
  const naoVazias = brutas.filter((l) => l.some((c) => c !== ""));
  if (!naoVazias.length) throw invalido("A planilha está vazia.");
  const [cabecalho, ...linhas] = naoVazias;
  const colunas = cabecalho.map((c, i) => c || `Coluna ${i + 1}`);
  if (new Set(colunas).size !== colunas.length) throw invalido("Há colunas com o mesmo nome no cabeçalho. Renomeie para continuar.");
  if (!linhas.length) throw invalido("A planilha só tem o cabeçalho, sem linhas de dados.");
  if (linhas.length > LIMITE_LINHAS) throw invalido(`A planilha tem mais de ${LIMITE_LINHAS.toLocaleString("pt-BR")} linhas. Divida em arquivos menores.`);
  return { colunas, linhas: linhas.map((l) => colunas.map((_, i) => l[i] ?? "")) };
}
