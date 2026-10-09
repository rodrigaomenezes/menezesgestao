// Peças da receita: valor em reais ↔ centavos, escolha de contato por busca e o vocabulário de oferta/entrega.
import { useEffect, useState } from "react";
import type { ContatoDto, Pagina } from "@mg/shared";
import { get, query } from "../../app/api";
import { useEu } from "../../app/sessao";
import { plural } from "../crm/comum";

/** "1.234,56" ou "1234.56" → 123456 centavos (null se inválido). */
export function paraCentavos(texto: string): number | null {
  const limpo = texto.trim().replace(/[^\d,.-]/g, "");
  if (!limpo) return null;
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export const paraReais = (centavos: number | null | undefined) => (centavos == null ? "" : (centavos / 100).toFixed(2).replace(".", ","));

const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Termos da empresa para oferta, entrega e prestador (ex.: curso, turma, professor). */
export function useTermosReceita() {
  const v = useEu().empresa?.vocabulario ?? {};
  const oferta = (v.oferta ?? "oferta").toLowerCase();
  const entrega = (v.entrega ?? "entrega").toLowerCase();
  const prestador = (v.prestador ?? "prestador").toLowerCase();
  return {
    oferta,
    Oferta: maiuscula(oferta),
    Ofertas: maiuscula(plural(oferta)),
    entrega,
    Entrega: maiuscula(entrega),
    Entregas: maiuscula(plural(entrega)),
    prestador,
    Prestador: maiuscula(prestador),
  };
}

/** Busca de contato por nome ou telefone (para vender, incluir numa entrega…). */
export function EscolherContato({ rotulo, nome, aoEscolher }: { rotulo: string; nome: string; aoEscolher(c: { id: string; nome: string } | null): void }) {
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<ContatoDto[]>([]);
  const [escolhido, setEscolhido] = useState<{ id: string; nome: string } | null>(null);
  useEffect(() => {
    if (escolhido || busca.trim().length < 2) return setAchados([]);
    const t = window.setTimeout(() => {
      get<Pagina<ContatoDto>>(`/contatos${query({ busca, limite: 6 })}`).then((p) => setAchados(p.itens), () => setAchados([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [busca, escolhido]);
  if (escolhido)
    return (
      <div className="campo">
        <span className="rotulo">{rotulo}</span>
        <div className="form-linha">
          <strong>{escolhido.nome}</strong>
          <button type="button" className="link-secundario" onClick={() => (setEscolhido(null), aoEscolher(null), setBusca(""))}>
            Trocar
          </button>
        </div>
      </div>
    );
  return (
    <div className="campo">
      <label htmlFor={`campo-${nome}`}>{rotulo}</label>
      <input id={`campo-${nome}`} type="search" value={busca} placeholder="Nome ou telefone" onChange={(e) => setBusca(e.target.value)} autoComplete="off" />
      {achados.length > 0 && (
        <ul className="sugestoes-contato" aria-label="Contatos encontrados">
          {achados.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => (setEscolhido({ id: c.id, nome: c.nome }), aoEscolher({ id: c.id, nome: c.nome }))}>
                {c.nome}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
