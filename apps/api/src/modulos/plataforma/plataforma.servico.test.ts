import { describe, expect, it } from "vitest";
import { saudeDaEmpresa } from "./plataforma.servico.js";

const agora = Date.parse("2026-10-22T12:00:00Z");
const base = { status: "ativa" as const, dias_atraso: 0, pessoas: 2, canais: 1, armazenamento: "0", plano: "completo", ultima_atividade: new Date("2026-10-21T12:00:00Z") };

describe("saúde da empresa no painel da plataforma", () => {
  it("em dia e usando = boa; parada 7 dias ou perto do limite = atenção; só consulta ou parada 30 dias = risco", () => {
    expect(saudeDaEmpresa(base, agora).saude).toBe("boa");
    expect(saudeDaEmpresa({ ...base, ultima_atividade: new Date("2026-10-10T12:00:00Z") }, agora)).toEqual({ saude: "atencao", motivo: "Parada há 12 dias." });
    expect(saudeDaEmpresa({ ...base, pessoas: 28 }, agora).saude).toBe("atencao");
    expect(saudeDaEmpresa({ ...base, dias_atraso: 3, status: "atrasada" }, agora).motivo).toBe("Pagamento 3 dia(s) atrasado.");
    expect(saudeDaEmpresa({ ...base, dias_atraso: 9, status: "atrasada" }, agora)).toEqual({ saude: "risco", motivo: "Só para consulta por atraso." });
    expect(saudeDaEmpresa({ ...base, ultima_atividade: null }, agora)).toEqual({ saude: "risco", motivo: "Nunca usou." });
  });
});
