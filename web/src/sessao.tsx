import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Acao, Modulo, Permissoes } from "../../src/compartilhado/catalogo";
import { MARCA_PADRAO, type Marca } from "../../src/compartilhado/marca";
import { ErroApi, get, post } from "./api";
import { aplicarMarca } from "./tema";

export interface Eu {
  usuario: { id: string; nome: string; email: string };
  empresa: { id: string; nome: string; plano: string; modulos: string[] } | null;
  perfil: { id: string; nome: string } | null;
  permissoes: Permissoes;
  marca: Marca & { nomeProduto: string };
  empresas: { id: string; nome: string }[];
}

interface ValorSessao {
  eu: Eu | null;
  carregando: boolean;
  recarregar(): Promise<void>;
  sair(): Promise<void>;
  trocarEmpresa(empresaId: string): Promise<void>;
  pode(modulo: Modulo, acao: Acao): boolean;
}

const ContextoSessao = createContext<ValorSessao | null>(null);

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [eu, setEu] = useState<Eu | null>(null);
  const [carregando, setCarregando] = useState(true);

  const recarregar = useCallback(async () => {
    try {
      const dados = await get<Eu>("/auth/eu");
      setEu(dados);
      aplicarMarca(dados.marca);
    } catch (err) {
      if (!(err instanceof ErroApi) || err.status !== 401) throw err;
      setEu(null);
      // Antes do login: marca padrão do produto.
      const marca = await get<Marca & { nomeProduto: string }>("/marca").catch(() => ({ ...MARCA_PADRAO, nomeProduto: "" }));
      aplicarMarca(marca);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const sair = useCallback(async () => {
    await post("/auth/sair").catch(() => undefined);
    await recarregar();
  }, [recarregar]);

  const trocarEmpresa = useCallback(
    async (empresaId: string) => {
      await post("/auth/empresa-ativa", { empresaId });
      await recarregar();
    },
    [recarregar],
  );

  const pode = useCallback((modulo: Modulo, acao: Acao) => Boolean(eu?.permissoes[modulo]?.[acao]), [eu]);

  return (
    <ContextoSessao.Provider value={{ eu, carregando, recarregar, sair, trocarEmpresa, pode }}>
      {children}
    </ContextoSessao.Provider>
  );
}

export function useSessao(): ValorSessao {
  const valor = useContext(ContextoSessao);
  if (!valor) throw new Error("useSessao fora do ProvedorSessao");
  return valor;
}

/** Para telas internas: a sessão com certeza existe. */
export function useEu(): Eu {
  const { eu } = useSessao();
  if (!eu) throw new Error("useEu sem sessão");
  return eu;
}
