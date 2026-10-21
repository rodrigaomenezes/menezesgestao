// Provedor de cobrança: cada empresa conecta o dela (a chave fica cifrada no banco). Trocar de provedor ou somar um
// novo é criar outro arquivo aqui, sem mexer em vendas.
export interface CredenciaisCobranca {
  chave: string | null;
  ambiente: "teste" | "producao";
}

export interface PedidoCobranca {
  /** Nosso id: volta no aviso do provedor como referência. */
  referencia: string;
  forma: "pix" | "boleto" | "link";
  valorCentavos: number;
  vencimento: string;
  descricao: string;
  pagador: { nome: string; documento: string | null; telefone: string | null; email: string | null };
}

export interface CobrancaCriada {
  idExterno: string;
  link: string | null;
  pixCopiaCola: string | null;
}

/** O que um aviso (webhook) do provedor significa para nós. */
export interface AvisoCobranca {
  idEvento: string;
  idExterno: string;
  status: "paga" | "vencida" | "cancelada" | "estornada" | null;
}

export interface ProvedorRecebimento {
  testar(c: CredenciaisCobranca): Promise<void>;
  criar(c: CredenciaisCobranca, p: PedidoCobranca): Promise<CobrancaCriada>;
  cancelar(c: CredenciaisCobranca, idExterno: string): Promise<void>;
  interpretar(corpo: unknown): AvisoCobranca | null;
}

/** Erro do provedor com mensagem para a pessoa (sem dados sensíveis). */
export class ErroCobranca extends Error {}
