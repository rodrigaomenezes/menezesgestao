// Camadas sobre a tela: modal, confirmação de ação relevante e avisos rápidos (toast).
// Um provedor só, no topo do app; as telas usam useConfirmar() e useAviso().
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export function Modal(props: { aberto: boolean; titulo: string; aoFechar(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialogo = ref.current;
    if (!dialogo) return;
    if (props.aberto && !dialogo.open) dialogo.showModal();
    if (!props.aberto && dialogo.open) dialogo.close();
  }, [props.aberto]);
  return (
    <dialog ref={ref} className="modal" aria-labelledby="modal-titulo" onClose={props.aoFechar}>
      <h2 id="modal-titulo">{props.titulo}</h2>
      {props.children}
    </dialog>
  );
}

interface PedidoConfirmacao {
  titulo: string;
  mensagem: string;
  acao: string;
  perigosa?: boolean;
}

type Aviso = { id: number; texto: string; tipo: "sucesso" | "erro" };

interface ValorSobreposicoes {
  confirmar(p: PedidoConfirmacao): Promise<boolean>;
  avisar(texto: string, tipo?: Aviso["tipo"]): void;
}

const Contexto = createContext<ValorSobreposicoes | null>(null);

export function ProvedorSobreposicoes({ children }: { children: ReactNode }) {
  const [pedido, setPedido] = useState<(PedidoConfirmacao & { responder(v: boolean): void }) | null>(null);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const proximoId = useRef(1);

  const confirmar = useCallback(
    (p: PedidoConfirmacao) => new Promise<boolean>((resolver) => setPedido({ ...p, responder: resolver })),
    [],
  );

  const avisar = useCallback((texto: string, tipo: Aviso["tipo"] = "sucesso") => {
    const id = proximoId.current++;
    setAvisos((atuais) => [...atuais, { id, texto, tipo }]);
    setTimeout(() => setAvisos((atuais) => atuais.filter((a) => a.id !== id)), 4000);
  }, []);

  const responder = (valor: boolean) => {
    pedido?.responder(valor);
    setPedido(null);
  };

  return (
    <Contexto.Provider value={{ confirmar, avisar }}>
      {children}
      <Modal aberto={Boolean(pedido)} titulo={pedido?.titulo ?? ""} aoFechar={() => responder(false)}>
        <p>{pedido?.mensagem}</p>
        <div className="modal-acoes">
          <button type="button" className="botao botao-secundario" onClick={() => responder(false)}>
            Cancelar
          </button>
          <button type="button" className={`botao ${pedido?.perigosa ? "botao-perigo" : ""}`} onClick={() => responder(true)}>
            {pedido?.acao}
          </button>
        </div>
      </Modal>
      <div className="avisos" role="status" aria-live="polite">
        {avisos.map((a) => (
          <p key={a.id} className={`aviso aviso-${a.tipo}`}>
            {a.texto}
          </p>
        ))}
      </div>
    </Contexto.Provider>
  );
}

function useSobreposicoes(): ValorSobreposicoes {
  const valor = useContext(Contexto);
  if (!valor) throw new Error("Use dentro do ProvedorSobreposicoes");
  return valor;
}

/** Pede confirmação antes de uma ação relevante. Devolve true se a pessoa confirmou. */
export const useConfirmar = () => useSobreposicoes().confirmar;

/** Aviso rápido do que aconteceu ("Convite enviado.", "Alteração não permitida."). */
export const useAviso = () => useSobreposicoes().avisar;
