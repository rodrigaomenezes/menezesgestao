import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { FUSO_PADRAO, MARCA_PADRAO, formatarDataHora, moduloAtivo, type Acao, type EuDto, type Marca, type Modulo } from "@mg/shared";
import { ErroApi, get, post } from "./api";
import { aplicarMarca } from "./tema";

export type Eu = EuDto;

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

  // Permissão do perfil E módulo contratado no plano (o servidor confere o mesmo em toda rota).
  const pode = useCallback(
    (modulo: Modulo, acao: Acao) => Boolean(eu?.permissoes[modulo]?.[acao]) && moduloAtivo(modulo, eu?.empresa?.modulos ?? []),
    [eu],
  );

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

/** Data e hora no fuso da empresa ativa (o servidor sempre manda UTC). */
export function useDataHora(): (iso: string) => string {
  const { eu } = useSessao();
  const fuso = eu?.empresa?.fuso ?? FUSO_PADRAO;
  return useCallback((iso: string) => formatarDataHora(iso, fuso), [fuso]);
}
