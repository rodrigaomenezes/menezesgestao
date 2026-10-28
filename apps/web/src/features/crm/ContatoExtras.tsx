// Ficha do contato: telefones e e-mails extras e endereços (Konecta RF-CRM-002). O telefone e o e-mail principais
// ficam nos dados do contato; aqui ficam os outros, com rótulo, e os endereços, com um marcado como principal.
import { useCallback, useEffect, useState } from "react";
import {
  MAX_CANAIS_POR_CONTATO,
  MAX_ENDERECOS_POR_CONTATO,
  NOMES_ROTULOS_CANAL,
  NOMES_ROTULOS_ENDERECO,
  ROTULOS_CANAL,
  ROTULOS_ENDERECO,
  UFS,
  type CanalContatoDto,
  type ContatoDto,
  type EnderecoContatoDto,
} from "@mg/shared";
import { ErroApi, get, patch, post, put } from "../../app/api";
import { useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { useAviso, useConfirmar } from "../../ui/sobreposicoes";
import { Campo, Carregando, Escolha, ListaVazia, Mensagem, useEnvio } from "../../ui/ui";
import { BotaoLigar } from "../telefonia/Telefone";
import { formatarTelefone } from "./comum";

const opcoes = <T extends string>(valores: readonly T[], nomes: Record<T, string>) => valores.map((v) => ({ valor: v, texto: nomes[v] }));

/** Lista curta (com limite por contato) que recarrega quando algo muda no contato. */
function useDoContato<T>(contatoId: string, caminho: string) {
  const [itens, setItens] = useState<T[] | null>(null);
  const [erro, setErro] = useState("");
  const carregar = useCallback(() => {
    get<T[]>(`/contatos/${contatoId}/${caminho}`)
      .then((r) => (setItens(r), setErro("")))
      .catch((e: unknown) => setErro(e instanceof ErroApi ? e.message : "Não foi possível carregar."));
  }, [contatoId, caminho]);
  useEffect(carregar, [carregar]);
  useTempoReal(["contato."], (a) => (a.entidadeId === contatoId ? carregar() : undefined));
  return { itens, erro, carregar };
}

/** A ação de uma linha (tornar principal, tirar, trocar rótulo): erro vira aviso, sucesso recarrega. */
function useAcao(aoMudar: () => void) {
  const avisar = useAviso();
  return async (fazer: () => Promise<unknown>, sucesso: string) => {
    try {
      await fazer();
      avisar(sucesso);
      aoMudar();
    } catch (e) {
      avisar(e instanceof ErroApi ? e.message : "Não foi possível concluir. Tente de novo.", "erro");
    }
  };
}

export function CanaisDoContato({ contato, aoMudarPrincipal }: { contato: ContatoDto; aoMudarPrincipal(): void }) {
  const { pode } = useSessao();
  const confirmar = useConfirmar();
  const { itens, erro, carregar } = useDoContato<CanalContatoDto>(contato.id, "canais");
  const agir = useAcao(carregar);
  const podeEditar = pode("crm", "editar") && !contato.arquivadoEm && !contato.anonimizadoEm;
  const [tipo, setTipo] = useState<CanalContatoDto["tipo"]>("telefone");
  const [valor, setValor] = useState("");
  const [rotulo, setRotulo] = useState<CanalContatoDto["rotulo"]>("celular");
  const incluir = useEnvio(async () => {
    await post(`/contatos/${contato.id}/canais`, { tipo, valor, rotulo });
    setValor("");
    carregar();
  });
  const cheio = (itens?.length ?? 0) >= MAX_CANAIS_POR_CONTATO;

  const tornarPrincipal = (c: CanalContatoDto) =>
    agir(async () => {
      await post(`/contatos/${contato.id}/canais/${c.id}/principal`);
      aoMudarPrincipal();
    }, c.tipo === "telefone" ? "Agora este é o telefone principal." : "Agora este é o e-mail principal.");
  const tirar = async (c: CanalContatoDto) => {
    const texto = c.tipo === "telefone" ? formatarTelefone(c.valor) : c.valor;
    if (!(await confirmar({ titulo: "Tirar da ficha", mensagem: `${texto} sai da ficha. Fica registrado no histórico.`, acao: "Tirar", perigosa: true }))) return;
    await agir(() => post(`/contatos/${contato.id}/canais/${c.id}/arquivar`), "Retirado da ficha.");
  };

  return (
    <section className="cartao" aria-labelledby="titulo-canais">
      <h2 id="titulo-canais">Outros telefones e e-mails</h2>
      <Mensagem tipo="erro">{erro}</Mensagem>
      {itens === null && !erro && <Carregando linhas={2} />}
      {itens?.length === 0 && <ListaVazia>Só o telefone e o e-mail principais.</ListaVazia>}
      <ul className="lista">
        {itens?.map((c) => (
          <li key={c.id} className="item">
            <div className="item-principal">
              {c.tipo === "telefone" ? <strong>{formatarTelefone(c.valor)}</strong> : <a href={`mailto:${c.valor}`}>{c.valor}</a>}
              <span className="item-detalhe">
                {c.tipo === "telefone" ? "Telefone" : "E-mail"} · {NOMES_ROTULOS_CANAL[c.rotulo]}
              </span>
            </div>
            <div className="item-acoes">
              {c.tipo === "telefone" && !contato.naoContatar && (
                <BotaoLigar alvo={{ contatoId: contato.id, nome: contato.nome, numero: c.valor }} rotulo="Ligar" classe="botao botao-secundario" />
              )}
              {podeEditar && (
                <>
                  <label className="sr-only" htmlFor={`rotulo-${c.id}`}>
                    Rótulo de {c.valor}
                  </label>
                  <select
                    id={`rotulo-${c.id}`}
                    value={c.rotulo}
                    onChange={(e) => void agir(() => patch(`/contatos/${contato.id}/canais/${c.id}`, { rotulo: e.target.value }), "Rótulo alterado.")}
                  >
                    {ROTULOS_CANAL.map((r) => (
                      <option key={r} value={r}>
                        {NOMES_ROTULOS_CANAL[r]}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="botao botao-secundario" onClick={() => void tornarPrincipal(c)}>
                    Tornar principal
                  </button>
                  <button type="button" className="botao botao-secundario" onClick={() => void tirar(c)}>
                    Tirar
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {podeEditar && itens !== null && (
        <form className="item-edicao" onSubmit={incluir.enviar}>
          <div className="grade-campos">
            <Escolha
              rotulo="Incluir"
              nome="canal-tipo"
              valor={tipo}
              aoMudar={(v) => (setTipo(v as CanalContatoDto["tipo"]), setRotulo(v === "telefone" ? "celular" : "pessoal"))}
              opcoes={[
                { valor: "telefone", texto: "Telefone" },
                { valor: "email", texto: "E-mail" },
              ]}
            />
            <Campo
              rotulo={tipo === "telefone" ? "Número" : "E-mail"}
              nome="canal-valor"
              tipo={tipo === "telefone" ? "tel" : "email"}
              valor={valor}
              aoMudar={setValor}
              obrigatorio
              dica={tipo === "telefone" ? "Com DDD. Não pode ser de outro cadastro." : undefined}
              erro={incluir.campos.valor}
            />
            <Escolha rotulo="Rótulo" nome="canal-rotulo" valor={rotulo} aoMudar={(v) => setRotulo(v as CanalContatoDto["rotulo"])} opcoes={opcoes(ROTULOS_CANAL, NOMES_ROTULOS_CANAL)} />
          </div>
          <Mensagem tipo="erro">{incluir.resumo(["valor"])}</Mensagem>
          <button type="submit" className="botao" disabled={incluir.enviando || cheio}>
            Incluir
          </button>{" "}
          <span className="item-detalhe">
            {itens.length} de {MAX_CANAIS_POR_CONTATO}
            {cheio && " — tire um para incluir outro"}
          </span>
        </form>
      )}
    </section>
  );
}

type DadosEndereco = Omit<EnderecoContatoDto, "id" | "criadoEm" | "atualizadoEm">;
const VAZIO: DadosEndereco = { rotulo: "residencial", cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", principal: false };
const formatarCep = (cep: string | null) => (cep && cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : (cep ?? ""));

function FormEndereco({ inicial, aoSalvar, aoCancelar, salvar }: { inicial: DadosEndereco; salvar(d: DadosEndereco): Promise<unknown>; aoSalvar(): void; aoCancelar?: () => void }) {
  const [d, setD] = useState<DadosEndereco>({ ...inicial, cep: formatarCep(inicial.cep) });
  const muda = (campo: keyof DadosEndereco) => (v: string) => setD((atual) => ({ ...atual, [campo]: v }));
  const envio = useEnvio(async () => {
    await salvar(d);
    aoSalvar();
  });
  const erros = envio.campos;
  const p = inicial === VAZIO ? "novo-endereco" : "editar-endereco";
  return (
    <form className="item-edicao" onSubmit={envio.enviar}>
      <div className="grade-campos">
        <Campo rotulo="CEP" nome={`${p}-cep`} tipo="text" valor={d.cep ?? ""} aoMudar={muda("cep")} dica="Opcional. Ex.: 01310-100" autoComplete="postal-code" erro={erros.cep} />
        <Campo rotulo="Rua ou avenida" nome={`${p}-logradouro`} valor={d.logradouro} aoMudar={muda("logradouro")} obrigatorio autoComplete="address-line1" erro={erros.logradouro} />
        <Campo rotulo="Número" nome={`${p}-numero`} valor={d.numero ?? ""} aoMudar={muda("numero")} erro={erros.numero} />
        <Campo rotulo="Complemento" nome={`${p}-complemento`} valor={d.complemento ?? ""} aoMudar={muda("complemento")} autoComplete="address-line2" erro={erros.complemento} />
        <Campo rotulo="Bairro" nome={`${p}-bairro`} valor={d.bairro ?? ""} aoMudar={muda("bairro")} erro={erros.bairro} />
        <Campo rotulo="Cidade" nome={`${p}-cidade`} valor={d.cidade} aoMudar={muda("cidade")} obrigatorio autoComplete="address-level2" erro={erros.cidade} />
        <Escolha rotulo="Estado (UF)" nome={`${p}-uf`} valor={d.uf} aoMudar={muda("uf")} opcoes={UFS.map((u) => ({ valor: u, texto: u }))} vazio="Escolha" erro={erros.uf} />
        <Escolha rotulo="Tipo de endereço" nome={`${p}-rotulo`} valor={d.rotulo} aoMudar={muda("rotulo")} opcoes={opcoes(ROTULOS_ENDERECO, NOMES_ROTULOS_ENDERECO)} />
      </div>
      {!inicial.principal && (
        <label className="marcar">
          <input type="checkbox" checked={d.principal} onChange={(e) => setD((atual) => ({ ...atual, principal: e.target.checked }))} />
          Endereço principal
        </label>
      )}
      <Mensagem tipo="erro">{envio.resumo(["cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf"])}</Mensagem>
      <button type="submit" className="botao" disabled={envio.enviando}>
        {envio.enviando ? "Salvando…" : "Salvar endereço"}
      </button>{" "}
      {aoCancelar && (
        <button type="button" className="botao botao-secundario" onClick={aoCancelar}>
          Cancelar
        </button>
      )}
    </form>
  );
}

export function EnderecosDoContato({ contato }: { contato: ContatoDto }) {
  const { pode } = useSessao();
  const confirmar = useConfirmar();
  const avisar = useAviso();
  const { itens, erro, carregar } = useDoContato<EnderecoContatoDto>(contato.id, "enderecos");
  const agir = useAcao(carregar);
  const podeEditar = pode("crm", "editar") && !contato.arquivadoEm && !contato.anonimizadoEm;
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const corpo = (d: DadosEndereco) => ({ ...d, cep: d.cep || null, numero: d.numero || null, complemento: d.complemento || null, bairro: d.bairro || null });
  const cheio = (itens?.length ?? 0) >= MAX_ENDERECOS_POR_CONTATO;
  const salvo = (texto: string) => () => (setEditando(null), avisar(texto), carregar());

  const tirar = async (e: EnderecoContatoDto) => {
    if (!(await confirmar({ titulo: "Tirar endereço", mensagem: `${e.logradouro} sai da ficha. Fica registrado no histórico.`, acao: "Tirar", perigosa: true }))) return;
    await agir(() => post(`/contatos/${contato.id}/enderecos/${e.id}/arquivar`), "Endereço retirado.");
  };

  return (
    <section className="cartao" aria-labelledby="titulo-enderecos">
      <h2 id="titulo-enderecos">Endereços</h2>
      <Mensagem tipo="erro">{erro}</Mensagem>
      {itens === null && !erro && <Carregando linhas={2} />}
      {itens?.length === 0 && <ListaVazia>Nenhum endereço.</ListaVazia>}
      <ul className="lista">
        {itens?.map((e) =>
          editando === e.id ? (
            <li key={e.id} className="item">
              <FormEndereco inicial={e} salvar={(d) => put(`/contatos/${contato.id}/enderecos/${e.id}`, corpo(d))} aoSalvar={salvo("Endereço alterado.")} aoCancelar={() => setEditando(null)} />
            </li>
          ) : (
            <li key={e.id} className="item">
              <div className="item-principal">
                <strong>{[e.logradouro, e.numero].filter(Boolean).join(", ")}</strong>
                <span className="item-detalhe">{[e.complemento, e.bairro, `${e.cidade}/${e.uf}`, formatarCep(e.cep)].filter(Boolean).join(" · ")}</span>
                <span className="item-detalhe">
                  {NOMES_ROTULOS_ENDERECO[e.rotulo]}
                  {e.principal && " · principal"}
                </span>
              </div>
              {podeEditar && (
                <div className="item-acoes">
                  <button type="button" className="botao botao-secundario" onClick={() => setEditando(e.id)}>
                    Editar
                  </button>
                  {!e.principal && (
                    <button
                      type="button"
                      className="botao botao-secundario"
                      onClick={() => void agir(() => put(`/contatos/${contato.id}/enderecos/${e.id}`, corpo({ ...e, principal: true })), "Agora este é o endereço principal.")}
                    >
                      Tornar principal
                    </button>
                  )}
                  <button type="button" className="botao botao-secundario" onClick={() => void tirar(e)}>
                    Tirar
                  </button>
                </div>
              )}
            </li>
          ),
        )}
      </ul>
      {podeEditar && itens !== null && editando === "novo" && (
        <FormEndereco inicial={VAZIO} salvar={(d) => post(`/contatos/${contato.id}/enderecos`, corpo(d))} aoSalvar={salvo("Endereço incluído.")} aoCancelar={() => setEditando(null)} />
      )}
      {podeEditar && itens !== null && editando !== "novo" && (
        <p>
          <button type="button" className="botao botao-secundario" disabled={cheio} onClick={() => setEditando("novo")}>
            Incluir endereço
          </button>{" "}
          <span className="item-detalhe">
            {itens.length} de {MAX_ENDERECOS_POR_CONTATO}
            {cheio && " — tire um para incluir outro"}
          </span>
        </p>
      )}
    </section>
  );
}
