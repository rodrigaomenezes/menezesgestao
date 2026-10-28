import { describe, expect, it } from "vitest";
import { errosDeCampo, mostrarResumo } from "./erros-campo";

describe("erros de campo vindos do servidor", () => {
  it("usa o caminho como chave, tira o rótulo e fica com o primeiro erro de cada campo", () => {
    const e = errosDeCampo({
      campos: [
        { campo: "nome", mensagem: "Nome: preencha." },
        { campo: "nome", mensagem: "Nome: no máximo 120 caracteres." },
        { campo: "campos/cpf", mensagem: "CPF inválido." },
      ],
    });
    expect(e).toEqual({ nome: "Preencha.", "campos.cpf": "CPF inválido." });
  });

  it("ignora detalhes sem campos e decide quando mostrar o resumo no topo", () => {
    expect(errosDeCampo(undefined)).toEqual({});
    expect(errosDeCampo({ contatoId: "x" })).toEqual({});
    const tela = ["a", "b", "c", "d"];
    expect(mostrarResumo({}, tela)).toBe(true);
    expect(mostrarResumo({ a: "1", b: "2", c: "3" }, tela)).toBe(false);
    expect(mostrarResumo({ a: "1", b: "2", c: "3", d: "4" }, tela)).toBe(true);
    // Erro num campo que a tela não mostra: o resumo continua no topo.
    expect(mostrarResumo({ opcoes: "Escolha ao menos uma." }, tela)).toBe(true);
  });
});
