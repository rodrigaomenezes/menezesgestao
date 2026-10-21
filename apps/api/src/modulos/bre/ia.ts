// IA do motor BRE atrás de interface (princípio 3): Claude quando há ANTHROPIC_API_KEY; sem ela, a versão de
// demonstração, que sugere por palavras e funciona sem conta externa. A saída das duas passa pelo mesmo contrato.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { SaidaIaBre } from "@mg/shared";
import type { Config } from "../../config.js";

export interface MensagemAnalise {
  de: "cliente" | "atendente";
  texto: string;
}

export interface ProvedorIaBre {
  nome: string;
  analisar(mensagens: MensagemAnalise[]): Promise<SaidaIaBre>;
}

export class IaIndisponivel extends Error {}

const INSTRUCOES = `Você apoia atendentes que seguem a doutrina comercial BRE. Leia a conversa de WhatsApp entre o atendente e o cliente e preencha o registro pós-conversa com as listas fechadas do esquema.
- resultado: PURCHASED se o cliente comprou; ADVANCED se avançou para o próximo passo; REPLIED_NO_ADVANCE se respondeu sem avançar; NO_REPLY se o cliente não respondeu; OPTED_OUT se pediu para não ser mais contatado.
- sins: só os "sim" que o cliente deu de fato: CONFIRMATION (confirmou a experiência), AGREEMENT (concordou com o que foi dito), VISUALIZATION (se imaginou usando).
- break: preencha só se houve uma quebra (recusa, objeção, adiamento), com a categoria e, em comentario, o que o cliente disse com as palavras dele.
- sugereOferta e sugereDesconto: true só se a conversa pede uma oferta ou um desconto agora.
- escalonamento: READY_TO_BUY, TECHNICAL_HELP, VIP ou COMPLAINT quando a conversa precisa de uma pessoa; senão null.
- sqBre: nota prévia de qualidade do atendente, de 0 a 20 em cada pilar: H (humanização: personalizou, usou o nome, citou a compra, interesse genuíno, tom natural), D (diagnóstico: contexto, uso, preferência, objeções, momento), I (inteligência: quanto a conversa trouxe de dado novo sobre o cliente), V (valor: benefício, diferença, conhecimento, recomendação personalizada, confiança, não vendeu só desconto), P (próximo passo: 20 com ação e data, 10 com ação sem data, 0 sem ação). Um supervisor confirma depois.
- resumo em português, factual, sem inventar preço, estoque, prazo ou dado do cliente. O que não der para saber vai em incertezas.`;

/** Demonstração: regras simples por palavras, para testar o fluxo inteiro sem fornecedor. */
export function provedorDemonstracao(): ProvedorIaBre {
  return {
    nome: "demonstracao",
    async analisar(mensagens) {
      const cliente = mensagens.filter((m) => m.de === "cliente").map((m) => m.texto.toLowerCase()).join(" \n");
      const tem = (re: RegExp) => re.test(cliente);
      const saiu = tem(/não (me )?(mande|envie|chame)|parar de receber|sair da lista|não quero mais/);
      const caro = tem(/caro|preço|desconto|sem dinheiro|orçamento/);
      const comprou = tem(/comprei|fechado|pode mandar|vou levar|quero comprar/);
      const reclamou = tem(/reclama|péssim|horrível|problema com/);
      const respondeu = cliente.trim().length > 0;
      const atendente = mensagens.filter((m) => m.de === "atendente").map((m) => m.texto.toLowerCase()).join(" \n");
      const perguntou = /\?/.test(atendente);
      return SaidaIaBre.parse({
        resumo: respondeu ? "Resumo da demonstração: houve resposta na conversa." : "Sem resposta na conversa.",
        resultado: saiu ? "OPTED_OUT" : comprou ? "PURCHASED" : !respondeu ? "NO_REPLY" : caro ? "REPLIED_NO_ADVANCE" : "ADVANCED",
        temperatura: comprou ? "READY_TO_BUY" : caro ? "WARM" : respondeu ? "HOT" : "COLD",
        estadoEmocional: caro ? "WARY" : respondeu ? "INTERESTED" : null,
        sins: comprou ? ["CONFIRMATION", "AGREEMENT", "VISUALIZATION"] : respondeu ? ["CONFIRMATION"] : [],
        break: caro && !comprou ? { categoria: "C_FINANCIAL", comentario: "Falou de preço." } : null,
        proximaAcao: saiu ? "CLOSE_NO_INTEREST" : caro ? "CALL_BACK" : "SEND_CATALOG",
        retornoEmDias: saiu ? null : caro ? 30 : 3,
        sugereOferta: !saiu && respondeu,
        sugereDesconto: caro,
        escalonamento: reclamou ? "COMPLAINT" : comprou ? "READY_TO_BUY" : null,
        sqBre: { H: atendente ? 12 : 0, D: perguntou ? 12 : 4, I: respondeu ? 8 : 0, V: caro ? 8 : 12, P: saiu ? 0 : 20 },
        incertezas: ["Análise de demonstração por palavras; configure ANTHROPIC_API_KEY para a análise completa."],
      });
    },
  };
}

/** Claude com saída estruturada pelo mesmo esquema Zod; recusa de segurança vira erro claro. */
export function provedorClaude(chave: string, modelo: string): ProvedorIaBre {
  const client = new Anthropic({ apiKey: chave, timeout: 120_000 });
  return {
    nome: `claude:${modelo}`,
    async analisar(mensagens) {
      const conversa = mensagens.map((m) => `${m.de === "cliente" ? "Cliente" : "Atendente"}: ${m.texto}`).join("\n");
      const r = await client.beta.messages.parse({
        model: modelo,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(SaidaIaBre) },
        system: INSTRUCOES,
        messages: [{ role: "user", content: `<conversa>\n${conversa}\n</conversa>` }],
      });
      if (r.stop_reason === "refusal") throw new IaIndisponivel("A IA não analisou esta conversa. Preencha o registro manualmente.");
      if (!r.parsed_output) throw new IaIndisponivel("A IA devolveu uma resposta fora do formato. Preencha o registro manualmente.");
      return SaidaIaBre.parse(r.parsed_output);
    },
  };
}

export const criarProvedorIaBre = (config: Config): ProvedorIaBre =>
  config.iaBre ? provedorClaude(config.iaBre.chave, config.iaBre.modelo) : provedorDemonstracao();
