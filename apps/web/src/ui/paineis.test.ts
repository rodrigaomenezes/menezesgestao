import { describe, expect, it } from "vitest";
import { variacao } from "./paineis";
import { atalhosDePeriodo, nomeDoIntervalo, somarDias } from "../app/filtros-url";

describe("variação contra o período anterior", () => {
  it("texto curto e completo, sem depender de cor", () => {
    expect(variacao(12, 10)).toEqual({ curto: "+20%", resto: "vs. período anterior", sentido: "sobe" });
    expect(variacao(5, 10)).toEqual({ curto: "-50%", resto: "vs. período anterior", sentido: "desce" });
    expect(variacao(7, 7)).toEqual({ curto: "igual", resto: "ao período anterior", sentido: "igual" });
    expect(variacao(3, 0)).toEqual({ curto: "novo", resto: "no período", sentido: "sobe" });
    expect(variacao(1001, 1000)).toEqual({ curto: "≈ 0%", resto: "vs. período anterior", sentido: "sobe" });
  });
});

describe("atalhos de período", () => {
  it("hoje, 7 e 30 dias, este mês e mês passado; nome do intervalo livre", () => {
    const a = Object.fromEntries(atalhosDePeriodo("2026-03-10").map((x) => [x.id, x.intervalo]));
    expect(a["7d"]).toEqual({ inicio: "2026-03-04", fim: "2026-03-10" });
    expect(a["mes"]).toEqual({ inicio: "2026-03-01", fim: "2026-03-10" });
    expect(a["mes-passado"]).toEqual({ inicio: "2026-02-01", fim: "2026-02-28" });
    expect(nomeDoIntervalo({ inicio: "2026-03-04", fim: "2026-03-10" }, "2026-03-10")).toBe("7 dias");
    expect(nomeDoIntervalo({ inicio: "2026-01-05", fim: "2026-01-09" }, "2026-03-10")).toBe("05/01 a 09/01/2026");
    expect(somarDias("2026-02-28", 1)).toBe("2026-03-01");
  });
});
