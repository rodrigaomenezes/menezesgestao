// Apoio aos testes de Conversas: canal de demonstração, cliente simulado e espera pelos jobs.
import { expect } from "vitest";
import type { Cliente } from "./app-teste.js";

export async function esperar<T>(fn: () => Promise<T | null | undefined | false>, descricao: string, ms = 15_000): Promise<T> {
  const fim = Date.now() + ms;
  for (;;) {
    const r = await fn();
    if (r) return r;
    if (Date.now() > fim) throw new Error(`tempo esgotado esperando: ${descricao}`);
    await new Promise((res) => setTimeout(res, 150));
  }
}

export async function criarCanalDemo(dono: Cliente, nome = "WhatsApp demonstração"): Promise<string> {
  const criado = await dono.post("/api/canais", { nome, provedor: "demonstracao" });
  expect(criado.statusCode, criado.body).toBe(201);
  const id = criado.json().id as string;
  const conexao = await dono.post(`/api/canais/${id}/conectar`);
  expect(conexao.statusCode, conexao.body).toBe(200);
  expect(conexao.json().canal.status).toBe("conectado");
  return id;
}

export async function simular(dono: Cliente, canalId: string, dados: { telefone: string; texto?: string; nome?: string; idExterno?: string; idMensagem?: string; midia?: { nome: string; mime: string; base64: string } }) {
  const r = await dono.post(`/api/canais/${canalId}/simular`, dados);
  expect(r.statusCode, r.body).toBe(200);
}

export interface ConversaResumo {
  id: string;
  contatoId: string | null;
  telefone: string | null;
  atribuidaA: string | null;
  status: string;
  naoLidas: number;
}

/** Conversa do telefone (E.164) na caixa de quem pergunta. */
export async function conversaDo(cliente: Cliente, telefone: string): Promise<ConversaResumo | undefined> {
  const r = await cliente.get(`/api/conversas?caixa=todas&status=abertas&limite=100&busca=${encodeURIComponent(telefone.replace(/\D/g, ""))}`);
  expect(r.statusCode, r.body).toBe(200);
  return (r.json().itens as ConversaResumo[]).find((c) => c.telefone === telefone);
}
