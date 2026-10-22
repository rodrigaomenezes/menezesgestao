// Central de ajuda: artigos curtos por tela, no próprio app (funcionam offline com o resto do PWA).
// `telas` liga o artigo às rotas: a ajuda aberta numa tela mostra primeiro o que é dela.
export interface ArtigoAjuda {
  id: string;
  titulo: string;
  telas: string[];
  passos: string[];
}

export const ARTIGOS_AJUDA: ArtigoAjuda[] = [
  {
    id: "primeiros-passos",
    titulo: "Primeiros passos",
    telas: ["/"],
    passos: [
      "Convide a equipe em Usuários: cada pessoa recebe um e-mail para criar a senha.",
      "Ajuste o funil, os campos e os resultados de ligação em Configurar CRM.",
      "Conecte o WhatsApp em Canais e automações.",
      "Monte o seu Início em \"Personalizar início\".",
    ],
  },
  {
    id: "contatos",
    titulo: "Cadastrar e encontrar contatos",
    telas: ["/contatos"],
    passos: [
      "Use \"Novo\" para cadastrar; o telefone é a chave: o mesmo número nunca vira dois cadastros.",
      "A busca procura por nome, telefone e e-mail.",
      "Na ficha ficam o histórico, as conversas, as ligações, as vendas e as tarefas.",
      "Arquivar não apaga: o cadastro vai para Arquivados e pode ser restaurado.",
    ],
  },
  {
    id: "funil",
    titulo: "Funil de vendas",
    telas: ["/funil", "/oportunidades"],
    passos: [
      "Arraste o cartão (ou use \"Mover\" no celular) para trocar de etapa.",
      "Etapas podem exigir campos antes de avançar; o sistema avisa o que falta.",
      "Ganhar ou perder pede o motivo, que alimenta os relatórios.",
    ],
  },
  {
    id: "conversas",
    titulo: "Conversas pelo WhatsApp",
    telas: ["/conversas"],
    passos: [
      "Conversas esperando resposta aparecem primeiro.",
      "Atribua a conversa a quem vai atender; respostas rápidas ficam no botão de modelos.",
      "Na API oficial, depois de 24 horas sem mensagem do cliente só sai mensagem modelo aprovada na Meta.",
    ],
  },
  {
    id: "canais",
    titulo: "Conectar o WhatsApp",
    telas: ["/conversas/canais"],
    passos: [
      "Escolha QR (celular da empresa) ou API oficial da Meta.",
      "No QR, abra o WhatsApp no celular → Aparelhos conectados → Conectar e leia o código.",
      "Na API oficial, cole o identificador do número e o token; a tela mostra o endereço do webhook para cadastrar na Meta.",
    ],
  },
  {
    id: "ligacoes",
    titulo: "Ligações e fila",
    telas: ["/ligacoes", "/fila", "/telefonia/configuracoes"],
    passos: [
      "A fila mostra quem ligar agora, já sem quem pediu para não ser contatado.",
      "Ao terminar a ligação, informe o resultado: ele conta nas metas e no histórico.",
      "Para ligar pelo navegador, configure o ramal em Configurar telefonia.",
    ],
  },
  {
    id: "rotina",
    titulo: "Rotina: agenda, tarefas, check-list e ponto",
    telas: ["/agenda", "/tarefas", "/rotina/configuracoes"],
    passos: [
      "Tarefas e retornos com data aparecem no Início no dia certo.",
      "O check-list do dia é definido pelo gestor em Configurar rotina.",
      "O ponto registra entrada, pausas e saída.",
    ],
  },
  {
    id: "metas",
    titulo: "Metas e desempenho",
    telas: ["/desempenho", "/mapa"],
    passos: [
      "As metas contam sozinhas a partir do que a equipe registra (ligações, conversas, vendas).",
      "O mapa de atividades mostra o volume por hora e por pessoa.",
    ],
  },
  {
    id: "vendas",
    titulo: "Vendas e comissões",
    telas: ["/vendas", "/comissoes"],
    passos: [
      "Registre a venda pela ficha ou em Vendas; quem confere o pagamento confirma.",
      "Com a conta de cobrança conectada, gere Pix, boleto ou link na própria venda: o pagamento confirma a venda sozinho.",
      "A comissão do mês é calculada pelas regras e pode ser fechada; mês fechado não muda mais.",
    ],
  },
  {
    id: "catalogo",
    titulo: "Catálogo",
    telas: ["/catalogo"],
    passos: [
      "Cadastre o que a empresa vende, com preço, categoria, estoque e data de lançamento.",
      "Com estoque preenchido, cada venda confirmada baixa uma unidade.",
    ],
  },
  {
    id: "bre",
    titulo: "Motor BRE",
    telas: ["/bre"],
    passos: [
      "Registre cada conversa em 30 segundos: resultado, temperatura e próxima ação.",
      "A fila do dia mostra quem pode ser contatado hoje pelo método.",
      "Automações só ligam quando o painel IA × equipe está liberado.",
    ],
  },
  {
    id: "plano",
    titulo: "Plano, limites e pagamento",
    telas: ["/plano"],
    passos: [
      "A tela de plano mostra o uso de pessoas, canais e armazenamento contra o limite do plano.",
      "Com fatura em atraso, o sistema avisa; depois de 7 dias fica só para consulta, sem apagar nada.",
      "Ao pagar, tudo volta ao normal na hora.",
    ],
  },
  {
    id: "seguranca",
    titulo: "Senha e duas etapas",
    telas: ["/seguranca", "/usuarios"],
    passos: [
      "Ative as duas etapas com um aplicativo autenticador ou por e-mail.",
      "Perdeu o celular? Use um código de recuperação ou peça ao administrador para redefinir: você confirma pelo e-mail.",
    ],
  },
  {
    id: "lgpd",
    titulo: "LGPD: exportar e anonimizar",
    telas: ["/contatos", "/lgpd"],
    passos: [
      "Na ficha, \"Exportar dados\" gera o arquivo do titular.",
      "\"Anonimizar\" troca os dados pessoais por marcações, mantendo os números dos relatórios.",
      "A retenção do histórico é configurada pela empresa.",
    ],
  },
];

/** Artigos da tela primeiro, depois o resto; com busca, só os que batem no título ou nos passos. */
export function artigosPara(rota: string, busca = ""): ArtigoAjuda[] {
  const termo = busca.trim().toLowerCase();
  const daTela = (a: ArtigoAjuda) => a.telas.some((t) => (t === "/" ? rota === "/" : rota.startsWith(t)));
  return ARTIGOS_AJUDA.filter((a) => !termo || a.titulo.toLowerCase().includes(termo) || a.passos.some((p) => p.toLowerCase().includes(termo))).sort(
    (a, b) => Number(daTela(b)) - Number(daTela(a)),
  );
}
