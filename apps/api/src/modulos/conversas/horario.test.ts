import { describe, expect, it } from "vitest";
import { dentroDoHorario } from "./horario.js";

const comercial = { dias: [1, 2, 3, 4, 5], inicio: "08:00", fim: "18:00" };

describe("horário de atendimento no fuso da empresa", () => {
  it("dia útil dentro do horário (São Paulo, UTC−3)", () => {
    // quarta-feira, 12:00 em São Paulo = 15:00 UTC
    expect(dentroDoHorario(comercial, "America/Sao_Paulo", new Date("2026-10-07T15:00:00Z"))).toBe(true);
  });
  it("fora do horário: 19:00 local, mesmo sendo 22:00 UTC", () => {
    expect(dentroDoHorario(comercial, "America/Sao_Paulo", new Date("2026-10-07T22:00:00Z"))).toBe(false);
  });
  it("o fim é exclusivo e o fim de semana fica fora", () => {
    expect(dentroDoHorario(comercial, "America/Sao_Paulo", new Date("2026-10-07T21:00:00Z"))).toBe(false); // 18:00
    expect(dentroDoHorario(comercial, "America/Sao_Paulo", new Date("2026-10-10T15:00:00Z"))).toBe(false); // sábado
  });
  it("respeita o fuso: 01:00 UTC de quinta ainda é quarta em Manaus", () => {
    expect(dentroDoHorario({ dias: [3], inicio: "20:00", fim: "23:59" }, "America/Manaus", new Date("2026-10-08T01:00:00Z"))).toBe(true);
  });
});
