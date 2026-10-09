// Peças comuns das telas do CRM: configuração (funis, etiquetas, campos), vocabulário da empresa,
// dinheiro e o formulário de campos personalizados.
import { useCallback, useEffect, useState } from "react";
import type { CampoPersonalizadoDto, ConfiguracaoCrmDto } from "@mg/shared";
import { get } from "../../app/api";
import { useEu } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";

export { formatarTelefone } from "@mg/shared";

const VAZIA: ConfiguracaoCrmDto = { funis: [], motivosPerda: [], etiquetas: [], campos: [], responsaveis: [] };

/** Funis, etiquetas, motivos, campos e responsáveis (só ativos), para os formulários. */
export function useConfigCrm() {
  const [config, setConfig] = useState<ConfiguracaoCrmDto>(VAZIA);
  const [carregada, setCarregada] = useState(false);
  const recarregar = useCallback(() => {
    get<ConfiguracaoCrmDto>("/crm/configuracao")
      .then((c) => {
        setConfig(c);
        setCarregada(true);
      })
      .catch(() => setCarregada(true));
  }, []);
  useEffect(recarregar, [recarregar]);
  useTempoReal(["funil.", "etapa.", "etiqueta.", "motivo_perda.", "campo_personalizado."], recarregar);
  return { config, carregada, recarregar };
}

const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Plural simples do português para os termos configuráveis (aluno → alunos, cliente → clientes). */
export function plural(s: string): string {
  if (/ão$/i.test(s)) return s.replace(/ão$/i, "ões");
  if (/[aeiou]$/i.test(s)) return `${s}s`;
  if (/[rsz]$/i.test(s)) return `${s}es`;
  if (/l$/i.test(s)) return s.replace(/l$/i, "is");
  if (/m$/i.test(s)) return s.replace(/m$/i, "ns");
  return `${s}s`;
}

/** Termos da empresa: "contato" pode ser "aluno", "paciente", "cliente"… (configuração, nunca código). */
export function useTermos() {
  const eu = useEu();
  const contato = eu.empresa?.vocabulario.contato?.toLowerCase() ?? "contato";
  const oportunidade = eu.empresa?.vocabulario.oportunidade?.toLowerCase() ?? "oportunidade";
  return {
    contato,
    Contato: maiuscula(contato),
    contatos: plural(contato),
    Contatos: maiuscula(plural(contato)),
    oportunidade,
    Oportunidade: maiuscula(oportunidade),
    Oportunidades: maiuscula(plural(oportunidade)),
  };
}

const MOEDA = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatarDinheiro(centavos: number | null | undefined): string {
  return centavos === null || centavos === undefined ? "" : MOEDA.format(centavos / 100);
}

/** "1.500,90" ou "1500.9" → centavos. Vazio → null; inválido → undefined. */
export function lerDinheiro(texto: string): number | null | undefined {
  const limpo = texto.replace(/[R$\s]/g, "");
  if (!limpo) return null;
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normal);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
}

export function centavosParaTexto(centavos: number | null): string {
  return centavos === null ? "" : (centavos / 100).toFixed(2).replace(".", ",");
}

export function Etiquetas({ lista }: { lista: { id: string; nome: string; cor: string }[] }) {
  if (!lista.length) return null;
  return (
    <span className="etiquetas">
      {lista.map((e) => (
        <span key={e.id} className="etiqueta">
          <span className="ponto-cor" style={{ background: e.cor }} aria-hidden="true" />
          {e.nome}
        </span>
      ))}
    </span>
  );
}

/** Escolha de várias etiquetas como caixas de marcar (funciona bem no toque). */
export function EscolhaEtiquetas(props: { etiquetas: { id: string; nome: string; cor: string }[]; marcadas: string[]; aoMudar(ids: string[]): void; rotulo?: string }) {
  if (!props.etiquetas.length) return null;
  return (
    <fieldset className="campo grupo-marcar">
      <legend>{props.rotulo ?? "Etiquetas"}</legend>
      {props.etiquetas.map((e) => (
        <label key={e.id} className="marcar">
          <input
            type="checkbox"
            checked={props.marcadas.includes(e.id)}
            onChange={(ev) => props.aoMudar(ev.target.checked ? [...props.marcadas, e.id] : props.marcadas.filter((x) => x !== e.id))}
          />
          <span className="ponto-cor" style={{ background: e.cor }} aria-hidden="true" />
          {e.nome}
        </label>
      ))}
    </fieldset>
  );
}

export type ValoresCampos = Record<string, string | number | boolean | null>;

/** Campos personalizados da empresa, cada um com o controle certo para o tipo. */
export function CamposPersonalizados(props: { definicoes: CampoPersonalizadoDto[]; valores: Record<string, unknown>; aoMudar(v: ValoresCampos): void; prefixo: string }) {
  const valores = props.valores as ValoresCampos;
  const mudar = (chave: string, valor: string | number | boolean | null) => props.aoMudar({ ...valores, [chave]: valor });
  return (
    <>
      {props.definicoes.map((d) => {
        const id = `${props.prefixo}-campo-${d.chave}`;
        const atual = valores[d.chave];
        const rotulo = `${d.rotulo}${d.obrigatorio ? " *" : ""}`;
        if (d.tipo === "sim_nao") {
          return (
            <label key={d.chave} className="marcar campo">
              <input id={id} type="checkbox" checked={atual === true} onChange={(e) => mudar(d.chave, e.target.checked)} />
              {rotulo}
            </label>
          );
        }
        return (
          <div key={d.chave} className="campo">
            <label htmlFor={id}>{rotulo}</label>
            {d.tipo === "lista" ? (
              <select id={id} value={typeof atual === "string" ? atual : ""} required={d.obrigatorio} onChange={(e) => mudar(d.chave, e.target.value || null)}>
                <option value="">—</option>
                {d.opcoes.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                type={d.tipo === "numero" ? "number" : d.tipo === "data" ? "date" : "text"}
                step={d.tipo === "numero" ? "any" : undefined}
                value={atual === null || atual === undefined ? "" : String(atual)}
                required={d.obrigatorio}
                onChange={(e) => {
                  const v = e.target.value;
                  mudar(d.chave, v === "" ? null : d.tipo === "numero" ? Number(v) : v);
                }}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

/** Mostra os campos personalizados preenchidos, só leitura. */
export function ValoresDosCampos({ definicoes, valores }: { definicoes: CampoPersonalizadoDto[]; valores: Record<string, unknown> }) {
  const preenchidos = definicoes.filter((d) => valores[d.chave] !== undefined && valores[d.chave] !== null && valores[d.chave] !== "");
  if (!preenchidos.length) return null;
  return (
    <dl className="dados">
      {preenchidos.map((d) => (
        <div key={d.chave}>
          <dt>{d.rotulo}</dt>
          <dd>{d.tipo === "sim_nao" ? (valores[d.chave] ? "Sim" : "Não") : d.tipo === "data" ? String(valores[d.chave]).split("-").reverse().join("/") : String(valores[d.chave])}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Link de WhatsApp para o número E.164 (abre o app no celular). */
export function linkWhatsApp(e164: string): string {
  return `https://wa.me/${e164.replace(/\D/g, "")}`;
}
