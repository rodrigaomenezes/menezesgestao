import { describe, expect, it } from "vitest";
import { cnpjValido, cpfValido, finalDoDocumento, formatarDocumento, mascararDigitando, mascararDocumento, normalizarDocumento } from "./documento.js";

describe("CPF e CNPJ", () => {
  it("valida pelos dígitos verificadores e recusa sequências repetidas", () => {
    expect(cpfValido("52998224725")).toBe(true);
    expect(cpfValido("52998224724")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
    expect(cnpjValido("11222333000181")).toBe(true);
    expect(cnpjValido("11222333000182")).toBe(false);
    expect(cnpjValido("00000000000000")).toBe(false);
  });

  it("normaliza o que foi digitado, com ou sem pontuação", () => {
    expect(normalizarDocumento("529.982.247-25")).toEqual({ tipo: "cpf", digitos: "52998224725" });
    expect(normalizarDocumento("11.222.333/0001-81")).toEqual({ tipo: "cnpj", digitos: "11222333000181" });
    expect(normalizarDocumento("123")).toBeNull();
    expect(normalizarDocumento("529.982.247-24")).toBeNull();
  });

  it("mascara só com o final guardado e formata o inteiro", () => {
    expect(mascararDocumento("cpf", finalDoDocumento("cpf", "52998224725"))).toBe("•••.•••.247-25");
    expect(mascararDocumento("cnpj", finalDoDocumento("cnpj", "11222333000181"))).toBe("••.•••.•••/0001-81");
    expect(formatarDocumento("cpf", "52998224725")).toBe("529.982.247-25");
    expect(formatarDocumento("cnpj", "11222333000181")).toBe("11.222.333/0001-81");
  });

  it("máscara enquanto digita: CPF até 11 dígitos, CNPJ acima", () => {
    expect(mascararDigitando("529")).toBe("529");
    expect(mascararDigitando("5299822")).toBe("529.982.2");
    expect(mascararDigitando("52998224725")).toBe("529.982.247-25");
    expect(mascararDigitando("112223330001")).toBe("11.222.333/0001");
    expect(mascararDigitando("11222333000181")).toBe("11.222.333/0001-81");
    expect(mascararDigitando("11.222.333/0001-81 extra 99")).toBe("11.222.333/0001-81");
  });
});
