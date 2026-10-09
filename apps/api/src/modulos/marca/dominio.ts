// De qual empresa é este endereço? Subdomínio (<slug>.DOMINIO_BASE) ou domínio próprio cadastrado pela empresa.
// Serve a marca da tela de entrada, o manifesto do app e a escolha da empresa no login.
import { eq, sql } from "drizzle-orm";
import { lerMarca, type Marca } from "@mg/shared";
import { comoSistema } from "../../infra/banco.js";
import { empresa } from "../../infra/esquema.js";
import type { Servicos } from "../../app.js";

export interface EmpresaDoEndereco {
  id: string;
  slug: string;
  nome: string;
  marca: Marca;
}

const VALIDADE_MS = 60_000;

/** Host sem porta, em minúsculas. */
export const limparHost = (host: string | undefined) => (host ?? "").split(":")[0].trim().toLowerCase();

function criarResolvedor(s: Servicos) {
  const cache = new Map<string, { valor: EmpresaDoEndereco | null; ate: number }>();
  const hostDoApp = limparHost(new URL(s.config.appUrl).host);

  async function buscar(host: string): Promise<EmpresaDoEndereco | null> {
    const base = s.config.dominioBase;
    let condicao;
    if (base && host.endsWith(`.${base}`)) {
      const slug = host.slice(0, -(base.length + 1));
      if (!slug || slug.includes(".")) return null;
      condicao = eq(empresa.slug, slug);
    } else {
      condicao = sql`lower(${empresa.dominio}) = ${host}`;
    }
    const [e] = await comoSistema(s.banco, (tx) =>
      tx.db.select({ id: empresa.id, slug: empresa.slug, nome: empresa.nome, marca: empresa.marca, arquivadoEm: empresa.arquivadoEm }).from(empresa).where(condicao),
    );
    return e && !e.arquivadoEm ? { id: e.id, slug: e.slug, nome: e.nome, marca: lerMarca(e.marca) } : null;
  }

  return {
    async porHost(hostBruto: string | undefined): Promise<EmpresaDoEndereco | null> {
      const host = limparHost(hostBruto);
      if (!host || host === hostDoApp || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
      const guardado = cache.get(host);
      if (guardado && guardado.ate > Date.now()) return guardado.valor;
      const valor = await buscar(host);
      cache.set(host, { valor, ate: Date.now() + VALIDADE_MS });
      return valor;
    },
    /** Depois de a empresa trocar marca, slug ou domínio. */
    esquecer() {
      cache.clear();
    },
  };
}

const resolvedores = new WeakMap<Servicos, ReturnType<typeof criarResolvedor>>();
export function resolvedorDominio(s: Servicos) {
  let r = resolvedores.get(s);
  if (!r) resolvedores.set(s, (r = criarResolvedor(s)));
  return r;
}
