import { describe, expect, it } from "vitest";
import { SEGMENTOS, VocabularioEntrada } from "./dto-whitelabel.js";
import { CHAVES_TERMOS, plural, termo, texto, textoProfundo } from "./vocabulario.js";

const voc = (id: string) => SEGMENTOS.find((s) => s.id === id)!.vocabulario as Record<string, string>;

describe("vocabulário", () => {
  it("plural regular do português", () => {
    expect(["aluno", "sessão", "imóvel", "professor", "profissional", "papel", "item"].map(plural)).toEqual([
      "alunos",
      "sessões",
      "imóveis",
      "professores",
      "profissionais",
      "papéis",
      "itens",
    ]);
  });

  it("sem vocabulário, usa os termos padrão com o gênero certo", () => {
    expect(texto("{Novo contato}", {})).toBe("Novo contato");
    expect(texto("{Nova oportunidade}", {})).toBe("Nova oportunidade");
    expect(texto("{Contatos}", null)).toBe("Contatos");
  });

  it("concorda artigos e adjetivos com o termo da escola", () => {
    const v = voc("escola");
    expect(texto("{Novo contato}", v)).toBe("Novo aluno");
    expect(texto("{Novo oportunidade}", v)).toBe("Nova matrícula");
    expect(texto("{Nenhum contato} ainda.", v)).toBe("Nenhum aluno ainda.");
    expect(texto("{Nenhum oportunidade} aberta.", v)).toBe("Nenhuma matrícula aberta.");
    expect(texto("{Oportunidade} não encontrad{o|a:oportunidade}.", v)).toBe("Matrícula não encontrada.");
    expect(texto("Responsável pelos {novos contatos}", v)).toBe("Responsável pelos novos alunos");
    expect(texto("{Os prestadores} da {unidade}", v)).toBe("Os professores da unidade");
  });

  it("clínica, consultoria, imobiliária e varejo", () => {
    expect(texto("{Contato} não encontrad{o|a:contato}.", voc("clinica"))).toBe("Paciente não encontrado.");
    expect(texto("{Prestadores}", voc("clinica"))).toBe("Profissionais");
    expect(texto("{Nova entrega} com {o prestador}", voc("consultoria"))).toBe("Nova sessão com o consultor");
    expect(texto("{Ofertas}", voc("imobiliaria"))).toBe("Imóveis");
    expect(texto("{Nova entrega}", voc("varejo"))).toBe("Novo pedido");
  });

  it("todo segmento define os 7 termos com gênero resolvido", () => {
    for (const s of SEGMENTOS.filter((x) => x.id !== "outro")) {
      for (const c of CHAVES_TERMOS) {
        expect(s.vocabulario[c], `${s.id}.${c}`).toBeTruthy();
        expect(["o", "a"]).toContain(termo(s.vocabulario as Record<string, string>, c).genero);
      }
    }
  });

  it("gênero configurado vence a dedução pela palavra", () => {
    expect(termo({ entrega: "dia", entrega_genero: "o" }, "entrega").genero).toBe("o");
    expect(termo({ entrega: "turma" }, "entrega").genero).toBe("a");
  });

  it("não toca em variáveis de mensagem nem em chaves desconhecidas", () => {
    expect(texto("Olá {{nome}}, {qualquer}", voc("escola"))).toBe("Olá {{nome}}, {qualquer}");
  });

  it("aplica nos detalhes de um erro", () => {
    const erro = { code: "x", message: "{Contato} sumiu", details: [{ message: "Escolha {um contato}" }] };
    expect(textoProfundo(erro, voc("clinica"))).toEqual({ code: "x", message: "Paciente sumiu", details: [{ message: "Escolha um paciente" }] });
  });

  it("valida a entrada do vocabulário", () => {
    expect(VocabularioEntrada.safeParse({ contato: "aluno", oportunidade_genero: "a", colaborador: "consultora" }).success).toBe(true);
    expect(VocabularioEntrada.safeParse({ contato_genero: "x" }).success).toBe(false);
    expect(VocabularioEntrada.safeParse({ cliente: "aluno" }).success).toBe(false);
    expect(VocabularioEntrada.safeParse({ contato: "a1" }).success).toBe(false);
  });
});
