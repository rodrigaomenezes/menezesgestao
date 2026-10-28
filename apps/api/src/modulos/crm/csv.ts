// Planilha CSV para o Excel brasileiro: separador ";", BOM UTF-8 (acentos certos ao abrir) e proteção contra fórmula
// (célula que começa com = + - @ tab ou CR ganha um apóstrofo e não vira fórmula ao abrir — "CSV injection").
const PERIGOSO = /^[=+\-@\t\r]/;

export function celula(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  let texto = String(valor);
  if (PERIGOSO.test(texto)) texto = `'${texto}`;
  return /[";\n\r]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

export function montarCsv(cabecalho: string[], linhas: unknown[][]): string {
  return "﻿" + [cabecalho, ...linhas].map((l) => l.map(celula).join(";")).join("\r\n") + "\r\n";
}
