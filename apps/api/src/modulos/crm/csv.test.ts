import { describe, expect, it } from "vitest";
import { celula, montarCsv } from "./csv.js";

describe("CSV para o Excel brasileiro", () => {
  it("aspas só quando precisa e protege contra fórmula", () => {
    expect(celula("Ana")).toBe("Ana");
    expect(celula('Ana "A"; filial')).toBe('"Ana ""A""; filial"');
    expect(celula("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(celula("+5511988887777")).toBe("'+5511988887777");
    expect(celula(null)).toBe("");
  });

  it("começa com BOM, separa por ponto e vírgula e termina linha com CRLF", () => {
    expect(montarCsv(["Nome", "Telefone"], [["Ana", "+5511988887777"]])).toBe("﻿Nome;Telefone\r\nAna;'+5511988887777\r\n");
  });
});
