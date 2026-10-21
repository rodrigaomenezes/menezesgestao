// SQ-BRE (fase 8.2): a IA dá a nota prévia por pilar e o supervisor confirma, ajustando o que precisar.
// A prévia fica guardada ao lado da nota confirmada (D-05); só a confirmada conta no BPI.
import { useState } from "react";
import { PILARES_SQ, faixaSq, somaSq, type NotasSq, type SqBreDto } from "@mg/shared";
import { post } from "../../app/api";
import { useDataHora, useSessao } from "../../app/sessao";
import { useTempoReal } from "../../app/tempo-real";
import { Modal, useAviso } from "../../ui/sobreposicoes";
import { CarregarMais, ListaVazia, Mensagem, useEnvio, usePaginado } from "../../ui/ui";
import { usePodeAvaliar } from "./Qualidade";

const PONTOS = Array.from({ length: 21 }, (_, i) => 20 - i);

function ConfirmarSqBre({ avaliacao, aoFechar, aoConfirmar }: { avaliacao: SqBreDto; aoFechar(): void; aoConfirmar(): void }) {
  const avisar = useAviso();
  const [notas, setNotas] = useState<NotasSq>(avaliacao.previa);
  const [feedback, setFeedback] = useState("");
  const total = somaSq(notas);
  const envio = useEnvio(async () => {
    const r = await post<SqBreDto>(`/qualidade/sq-bre/${avaliacao.id}/confirmar`, { notas, feedback: feedback || null });
    avisar(`Nota SQ-BRE confirmada: ${r.nota} (${r.faixa}).`);
    aoConfirmar();
  });
  return (
    <Modal aberto titulo={`SQ-BRE · ${avaliacao.avaliadoNome}`} aoFechar={aoFechar}>
      <form onSubmit={envio.enviar}>
        <p className="dica">
          Prévia da IA: {avaliacao.notaPrevia} ({faixaSq(avaliacao.notaPrevia)}). Ajuste o que precisar; vale a nota que você confirmar.
        </p>
        {PILARES_SQ.map((p) => (
          <div key={p.codigo} className="campo campo-nota">
            <label htmlFor={`sq-${p.codigo}`}>
              {p.nome} <span className="item-detalhe">({p.itens.join(", ")})</span>
            </label>
            <select id={`sq-${p.codigo}`} value={notas[p.codigo]} onChange={(e) => setNotas({ ...notas, [p.codigo]: Number(e.target.value) })}>
              {PONTOS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        ))}
        <p>
          <strong>
            Total: {total} ({faixaSq(total)})
          </strong>
        </p>
        <div className="campo">
          <label htmlFor="sq-feedback">Feedback para a pessoa</label>
          <textarea id="sq-feedback" rows={3} maxLength={2000} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
        </div>
        <Mensagem tipo="erro">{envio.erro}</Mensagem>
        <div className="modal-acoes">
          <button type="button" className="botao botao-secundario" onClick={aoFechar}>
            Cancelar
          </button>
          <button type="submit" className="botao" disabled={envio.enviando}>
            Confirmar nota
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Na conversa: pede a prévia da IA e abre a confirmação. */
export function BotaoSqBre({ conversaId }: { conversaId: string }) {
  const { pode } = useSessao();
  const podeAvaliar = usePodeAvaliar();
  const [avaliacao, setAvaliacao] = useState<SqBreDto | null>(null);
  const envio = useEnvio(async () => setAvaliacao(await post<SqBreDto>("/qualidade/sq-bre", { conversaId })));
  if (!podeAvaliar || !pode("bre", "ver")) return null;
  return (
    <>
      <button type="button" className="botao botao-secundario" disabled={envio.enviando} onClick={() => void envio.enviar()}>
        {envio.enviando ? "Preparando…" : "SQ-BRE"}
      </button>
      {envio.erro && <Mensagem tipo="erro">{envio.erro}</Mensagem>}
      {avaliacao && <ConfirmarSqBre avaliacao={avaliacao} aoFechar={() => setAvaliacao(null)} aoConfirmar={() => setAvaliacao(null)} />}
    </>
  );
}

/** Na Qualidade: prévias esperando confirmação e notas confirmadas. */
export function ListaSqBre() {
  const dataHora = useDataHora();
  const podeAvaliar = usePodeAvaliar();
  const lista = usePaginado<SqBreDto>("/qualidade/sq-bre?limite=30");
  const [aberta, setAberta] = useState<SqBreDto | null>(null);
  useTempoReal(["qualidade.sq_bre"], () => void lista.recarregar());
  return (
    <section className="cartao" aria-labelledby="titulo-sq-bre">
      <h2 id="titulo-sq-bre">SQ-BRE</h2>
      <p className="dica">Para avaliar, abra a conversa e use “SQ-BRE”: a IA sugere a nota de cada pilar e o supervisor confirma.</p>
      <Mensagem tipo="erro">{lista.erro}</Mensagem>
      {!lista.carregando && !lista.itens.length && <ListaVazia>Nenhuma avaliação SQ-BRE ainda.</ListaVazia>}
      <ul className="lista">
        {lista.itens.map((a) => (
          <li key={a.id} className="item">
            <div className="item-principal">
              <strong>
                {a.status === "confirmada" ? `Nota ${a.nota} (${a.faixa})` : `Prévia ${a.notaPrevia}, esperando confirmação`} · {a.avaliadoNome}
              </strong>
              <span className="item-detalhe">
                {a.contatoNome ? `Conversa com ${a.contatoNome} · ` : ""}
                {dataHora(a.criadoEm)}
              </span>
              {a.feedback && <p className="texto-livre">{a.feedback}</p>}
            </div>
            {a.status === "previa" && podeAvaliar && (
              <div className="item-acoes">
                <button type="button" className="botao botao-secundario" onClick={() => setAberta(a)}>
                  Confirmar
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <CarregarMais visivel={lista.temMais} carregando={lista.carregando} aoClicar={() => void lista.carregarMais()} />
      {aberta && (
        <ConfirmarSqBre
          avaliacao={aberta}
          aoFechar={() => setAberta(null)}
          aoConfirmar={() => {
            setAberta(null);
            void lista.recarregar();
          }}
        />
      )}
    </section>
  );
}

