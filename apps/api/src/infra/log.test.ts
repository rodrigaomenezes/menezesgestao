import { describe, expect, it } from "vitest";
import { erroSeguro } from "./log.js";

describe("erro seguro para o log", () => {
  it("erro do banco perde o detail com os valores", () => {
    const pgErro = Object.assign(new Error('duplicate key value violates unique constraint "contato_telefone_uk"'), {
      code: "23505",
      detail: "Key (empresa_id, telefone)=(x, +5511999990000) already exists.",
      table: "contato",
      constraint: "contato_telefone_uk",
    });
    const drizzle = Object.assign(new Error('Failed query: insert into "contato" ... params: Maria,+5511999990000'), { cause: pgErro });
    const r = erroSeguro(drizzle);
    expect(r).toMatchObject({ tipo: "banco", codigo: "23505", tabela: "contato", restricao: "contato_telefone_uk" });
    expect(JSON.stringify(r)).not.toContain("+5511999990000");
    expect(JSON.stringify(r)).not.toContain("Maria");
  });

  it("erro comum mantém a mensagem, sem parâmetros de consulta", () => {
    const r = erroSeguro(new Error("Failed query: select 1 params: segredo@exemplo.com"));
    expect(JSON.stringify(r)).not.toContain("segredo@exemplo.com");
    expect(erroSeguro(new Error("quebrou"))).toMatchObject({ tipo: "Error", mensagem: "quebrou" });
  });
});
