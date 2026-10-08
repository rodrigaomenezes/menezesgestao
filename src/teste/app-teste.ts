// App completo para testes de integração: banco real, jobs, tempo real e provedor de avisos de demonstração.
import { randomBytes } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { criarApp, type AppMontado } from "../app.js";
import { provedorDemonstracao } from "../avisos/avisos.js";
import { criarBanco, type Banco } from "../db/banco.js";
import { iniciarJobs, type Jobs } from "../jobs/jobs.js";
import { TempoReal } from "../nucleo/tempo-real.js";
import { semearEmpresa, type DescricaoEmpresa, type EmpresaSemeada } from "../nucleo/semear.js";
import { gerarHashSenha } from "../seguranca/senha.js";
import { configTeste } from "./ambiente.js";
import type { Config } from "../config.js";

export const SENHA_TESTE = randomBytes(12).toString("base64url");

export interface AmbienteTeste extends AppMontado {
  config: Config;
  banco: Banco;
  jobs: Jobs;
  tempoReal: TempoReal;
  fechar(): Promise<void>;
}

export async function montarTeste(extra: Record<string, string> = {}): Promise<AmbienteTeste> {
  const config = configTeste(extra);
  const banco = criarBanco(config.databaseUrl);
  const jobs = await iniciarJobs(config, provedorDemonstracao(banco));
  const tempoReal = new TempoReal(banco, config.databaseUrl);
  await tempoReal.iniciar();
  const montado = await criarApp({ config, banco, jobs, tempoReal });
  await montado.app.ready();
  return {
    ...montado,
    config,
    banco,
    jobs,
    tempoReal,
    async fechar() {
      await tempoReal.parar();
      await montado.app.close();
      await jobs.parar();
      await banco.pool.end();
    },
  };
}

let contador = 0;

/** Duas empresas de segmentos diferentes, com e-mails únicos por arquivo de teste. */
export function descricoesTeste(): { a: DescricaoEmpresa; b: DescricaoEmpresa } {
  const s = `${Date.now().toString(36)}${(contador++).toString(36)}`;
  const a: DescricaoEmpresa = {
    nome: `Escola A ${s}`,
    plano: "completo",
    vocabulario: { contato: "aluno" },
    unidades: ["Centro", "Bairro"],
    equipes: [
      { nome: `Equipe A1 ${s}`, unidade: "Centro", gestor: "gestor" },
      { nome: `Equipe A2 ${s}`, unidade: "Bairro" },
    ],
    pessoas: [
      { chave: "dono", nome: "Dona A", email: `dono.a.${s}@teste.example.com`, perfil: "dono", unidade: "Centro" },
      { chave: "gestor", nome: "Gestor A", email: `gestor.a.${s}@teste.example.com`, perfil: "gestor", unidade: "Centro" },
      { chave: "vendedor", nome: "Vendedor A1", email: `vend.a1.${s}@teste.example.com`, perfil: "vendedor", unidade: "Centro", equipe: `Equipe A1 ${s}` },
      { chave: "vendedor2", nome: "Vendedor A2", email: `vend.a2.${s}@teste.example.com`, perfil: "vendedor", unidade: "Bairro", equipe: `Equipe A2 ${s}` },
      { chave: "financeiro", nome: "Financeiro A", email: `fin.a.${s}@teste.example.com`, perfil: "financeiro" },
      { chave: "consultor", nome: "Consultora", email: `consultora.${s}@teste.example.com`, perfil: "gestor" },
    ],
  };
  const b: DescricaoEmpresa = {
    nome: `Clinica B ${s}`,
    plano: "comercial",
    vocabulario: { contato: "paciente" },
    unidades: ["Matriz"],
    equipes: [{ nome: `Equipe B1 ${s}`, unidade: "Matriz", gestor: "gestor" }],
    pessoas: [
      { chave: "dono", nome: "Dono B", email: `dono.b.${s}@teste.example.com`, perfil: "dono", unidade: "Matriz" },
      { chave: "gestor", nome: "Gestor B", email: `gestor.b.${s}@teste.example.com`, perfil: "gestor", unidade: "Matriz" },
      { chave: "vendedor", nome: "Vendedor B", email: `vend.b.${s}@teste.example.com`, perfil: "vendedor", equipe: `Equipe B1 ${s}` },
      { chave: "consultor", nome: "Consultora", email: `consultora.${s}@teste.example.com`, perfil: "financeiro" },
    ],
  };
  return { a, b };
}

export interface EmpresasTeste {
  a: EmpresaSemeada & { d: DescricaoEmpresa };
  b: EmpresaSemeada & { d: DescricaoEmpresa };
}

export async function semearDuasEmpresas(banco: Banco): Promise<EmpresasTeste> {
  const { a, b } = descricoesTeste();
  const hash = await gerarHashSenha(SENHA_TESTE);
  return {
    a: { ...(await semearEmpresa(banco, a, hash)), d: a },
    b: { ...(await semearEmpresa(banco, b, hash)), d: b },
  };
}

export function email(e: { d: DescricaoEmpresa }, chave: string): string {
  const p = e.d.pessoas.find((x) => x.chave === chave);
  if (!p) throw new Error(`pessoa ${chave} não existe`);
  return p.email;
}

type Metodo = "GET" | "POST" | "PATCH" | "DELETE" | "PUT";

/** Navegador simulado: guarda cookies e manda o cabeçalho de CSRF em toda escrita. */
export class Cliente {
  readonly cookies = new Map<string, string>();
  constructor(private readonly app: FastifyInstance) {}

  private guardar(res: LightMyRequestResponse) {
    for (const c of res.cookies) {
      if (c.value === "" || (c.expires && c.expires.getTime() < Date.now())) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
  }

  async pedir(metodo: Metodo, url: string, corpo?: unknown, semCsrf = false): Promise<LightMyRequestResponse> {
    if (!this.cookies.has("mg_csrf")) {
      this.guardar(await this.app.inject({ method: "GET", url: "/api/health" }));
    }
    const headers: Record<string, string> = {
      cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      "user-agent": "teste",
    };
    if (metodo !== "GET" && !semCsrf) headers["x-csrf-token"] = this.cookies.get("mg_csrf") ?? "";
    const res = await this.app.inject({
      method: metodo,
      url,
      headers,
      ...(corpo !== undefined ? { payload: corpo as object } : {}),
    });
    this.guardar(res);
    return res;
  }

  get(url: string) {
    return this.pedir("GET", url);
  }
  post(url: string, corpo: unknown = {}) {
    return this.pedir("POST", url, corpo);
  }
  patch(url: string, corpo: unknown = {}) {
    return this.pedir("PATCH", url, corpo);
  }
  delete(url: string) {
    return this.pedir("DELETE", url);
  }

  async entrar(emailLogin: string, senha = SENHA_TESTE, empresaId?: string): Promise<this> {
    const res = await this.post("/api/auth/entrar", { email: emailLogin, senha, empresaId });
    if (res.statusCode !== 200) throw new Error(`login falhou (${res.statusCode}): ${res.body}`);
    return this;
  }
}

export async function logado(app: FastifyInstance, emailLogin: string, empresaId?: string): Promise<Cliente> {
  return new Cliente(app).entrar(emailLogin, SENHA_TESTE, empresaId);
}

/** Espera o job de e-mail chegar na caixa de saída de demonstração. */
export async function esperarEmail(banco: Banco, para: string, depoisDe = new Date(0)): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const { rows } = await banco.pool.query<{ texto: string }>(
      "SELECT texto FROM aviso_saida WHERE lower(para) = lower($1) AND criado_em >= $2 ORDER BY criado_em DESC LIMIT 1",
      [para, depoisDe],
    );
    if (rows[0]) return rows[0].texto;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`nenhum e-mail para ${para}`);
}

export function linkDoEmail(texto: string): string {
  const m = texto.match(/token=([\w-]+)/);
  if (!m) throw new Error("e-mail sem link");
  return m[1];
}
