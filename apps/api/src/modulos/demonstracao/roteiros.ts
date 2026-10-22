// Roteiro de cada empresa de exemplo: nome, marca, catálogo e frases típicas do ramo. O gerador sorteia a partir
// daqui; o funil, o vocabulário e os campos vêm do pacote de segmento do próprio sistema (SEGMENTOS).
export type SegmentoDemonstracao = "escola" | "clinica" | "consultoria" | "imobiliaria" | "varejo";

export interface ItemCatalogo {
  nome: string;
  categoria: string;
  precoCentavos: number;
  estoque?: number;
}

export interface Roteiro {
  segmento: SegmentoDemonstracao;
  empresa: string;
  cor: string;
  slogan: string;
  catalogo: ItemCatalogo[];
  /** O que o cliente escreve primeiro ({produto} vira um item do catálogo). */
  entrada: string[];
  /** Respostas da equipe. */
  saida: string[];
  /** Respostas do cliente durante a conversa. */
  respostas: string[];
  tarefas: string[];
  notasLigacao: string[];
  /** Valores dos campos personalizados do pacote do segmento (sorteados por contato/oportunidade). */
  campos: Record<string, string[]>;
}

export const ROTEIROS: Record<SegmentoDemonstracao, Roteiro> = {
  escola: {
    segmento: "escola",
    empresa: "Escola Horizonte de Idiomas",
    cor: "#1d4ed8",
    slogan: "Aprenda no seu ritmo",
    catalogo: [
      { nome: "Inglês Kids", categoria: "Inglês", precoCentavos: 32_000 },
      { nome: "Inglês Teens", categoria: "Inglês", precoCentavos: 36_000 },
      { nome: "Inglês Adultos", categoria: "Inglês", precoCentavos: 39_000 },
      { nome: "Inglês para Negócios", categoria: "Inglês", precoCentavos: 52_000 },
      { nome: "Espanhol Básico", categoria: "Espanhol", precoCentavos: 34_000 },
      { nome: "Espanhol Avançado", categoria: "Espanhol", precoCentavos: 41_000 },
      { nome: "Francês Essencial", categoria: "Francês", precoCentavos: 45_000 },
      { nome: "Preparatório TOEFL", categoria: "Exames", precoCentavos: 78_000 },
      { nome: "Conversação Intensiva", categoria: "Inglês", precoCentavos: 29_000 },
    ],
    entrada: [
      "Oi! Vi o anúncio do {produto}, ainda tem vaga?",
      "Boa tarde, quanto custa a mensalidade do {produto}?",
      "Olá, queria agendar uma aula experimental",
      "Vocês têm turma de {produto} à noite?",
      "Minha filha quer fazer {produto}, como funciona?",
      "Tem desconto para irmãos?",
    ],
    saida: [
      "Olá! Temos sim. Qual o melhor horário para você: manhã, tarde ou noite?",
      "A mensalidade do {produto} fica em {preco}. Posso reservar uma aula experimental gratuita?",
      "Perfeito! Aula experimental marcada. Vou te mandar o endereço e o material.",
      "Que bom que gostou da aula! Posso enviar a proposta de matrícula?",
      "Segue a proposta. Matrícula até sexta tem material didático incluso.",
    ],
    respostas: ["Pode ser à noite", "Ótimo, obrigada!", "Vou conversar com meu marido e te falo", "Pode mandar a proposta", "Fechado, como faço a matrícula?", "Achei um pouco caro"],
    tarefas: ["Confirmar aula experimental", "Enviar proposta de matrícula", "Ligar para o responsável financeiro", "Cobrar documentos da matrícula", "Retornar sobre horário da turma"],
    notasLigacao: ["Pediu horário noturno", "Vai trazer o filho na aula experimental", "Comparando com outra escola", "Quer parcelar o material", "Pediu para ligar depois das 18h"],
    campos: { responsavel: ["Mãe", "Pai", "O próprio aluno"], serie: ["Iniciante", "Básico 2", "Intermediário", "Avançado"], turno: ["Manhã", "Tarde", "Noite", "Sábado"] },
  },
  clinica: {
    segmento: "clinica",
    empresa: "Clínica Bem Viver",
    cor: "#0f766e",
    slogan: "Cuidado que acolhe",
    catalogo: [
      { nome: "Consulta clínica geral", categoria: "Consultas", precoCentavos: 25_000 },
      { nome: "Consulta dermatológica", categoria: "Dermatologia", precoCentavos: 32_000 },
      { nome: "Limpeza de pele", categoria: "Estética", precoCentavos: 18_000 },
      { nome: "Peeling químico", categoria: "Estética", precoCentavos: 45_000 },
      { nome: "Toxina botulínica", categoria: "Estética", precoCentavos: 120_000, estoque: 12 },
      { nome: "Preenchimento labial", categoria: "Estética", precoCentavos: 150_000, estoque: 8 },
      { nome: "Check-up completo", categoria: "Exames", precoCentavos: 89_000 },
      { nome: "Fisioterapia (pacote 10 sessões)", categoria: "Fisioterapia", precoCentavos: 140_000 },
      { nome: "Nutricionista", categoria: "Consultas", precoCentavos: 22_000 },
    ],
    entrada: [
      "Olá, gostaria de agendar {produto}",
      "Vocês atendem convênio?",
      "Qual o valor do {produto}?",
      "Bom dia! Tem horário essa semana para {produto}?",
      "Fiz uma avaliação aí mês passado, queria ver o orçamento",
    ],
    saida: [
      "Olá! Temos horário na quinta às 14h ou sexta às 10h. Qual prefere?",
      "O {produto} fica em {preco}, com parcelamento em até 6x.",
      "Agendado! Enviaremos um lembrete um dia antes.",
      "Seguem as orientações de preparo para o procedimento.",
      "Como você está se sentindo depois do procedimento?",
    ],
    respostas: ["Quinta às 14h fica ótimo", "Aceita Unimed?", "Obrigado pelo lembrete", "Estou bem, adorei o resultado", "Vou ver com meu convênio", "Pode ser na sexta"],
    tarefas: ["Confirmar consulta de amanhã", "Enviar orçamento do procedimento", "Retorno pós-procedimento", "Verificar autorização do convênio", "Remarcar paciente que faltou"],
    notasLigacao: ["Confirmou presença", "Vai verificar cobertura do convênio", "Pediu para remarcar", "Interessada em pacote de sessões", "Perguntou sobre parcelamento"],
    campos: { convenio: ["Particular", "Unimed", "Bradesco Saúde", "SulAmérica", "Amil"], particular: ["sim", "não"] },
  },
  consultoria: {
    segmento: "consultoria",
    empresa: "Vértice Consultoria Empresarial",
    cor: "#7c3aed",
    slogan: "Estratégia que vira resultado",
    catalogo: [
      { nome: "Diagnóstico organizacional", categoria: "Gestão", precoCentavos: 850_000 },
      { nome: "Planejamento estratégico", categoria: "Gestão", precoCentavos: 2_400_000 },
      { nome: "Implantação de CRM", categoria: "Comercial", precoCentavos: 1_800_000 },
      { nome: "Treinamento de vendas", categoria: "Comercial", precoCentavos: 650_000 },
      { nome: "Mentoria para gestores", categoria: "Pessoas", precoCentavos: 480_000 },
      { nome: "Pesquisa de clima", categoria: "Pessoas", precoCentavos: 390_000 },
      { nome: "Revisão de processos financeiros", categoria: "Financeiro", precoCentavos: 1_200_000 },
    ],
    entrada: [
      "Olá, gostaríamos de entender como funciona o {produto}",
      "Bom dia, recebi indicação de vocês para {produto}",
      "Vocês atendem empresas de médio porte?",
      "Podem enviar uma proposta de {produto}?",
    ],
    saida: [
      "Bom dia! Podemos marcar uma conversa de 30 minutos para entender o momento da empresa?",
      "Segue a agenda da reunião de diagnóstico.",
      "Enviamos a proposta do {produto}: investimento de {preco}, em 3 etapas.",
      "Ficou alguma dúvida sobre o escopo? Podemos ajustar o cronograma.",
      "Contrato assinado! Vamos agendar o kick-off.",
    ],
    respostas: ["Pode ser quarta às 10h", "Vou apresentar para a diretoria", "O prazo está apertado para nós", "Podemos dividir em parcelas?", "Aprovado, vamos seguir", "Recebido, obrigado"],
    tarefas: ["Preparar proposta comercial", "Reunião de diagnóstico", "Enviar contrato para assinatura", "Follow-up com o decisor", "Agendar kick-off do projeto"],
    notasLigacao: ["Decisor é o diretor financeiro", "Orçamento aprovado para o próximo trimestre", "Pediu cases do setor", "Concorrência mandou proposta mais barata", "Quer começar no mês que vem"],
    campos: { porte: ["Pequena", "Média", "Grande"], decisor: ["Diretor geral", "Diretor financeiro", "Sócio", "Gerente comercial"] },
  },
  imobiliaria: {
    segmento: "imobiliaria",
    empresa: "Lar Ideal Imóveis",
    cor: "#b45309",
    slogan: "O endereço certo para você",
    catalogo: [
      { nome: "Apartamento 2 quartos — Centro", categoria: "Apartamentos", precoCentavos: 42_000_000 },
      { nome: "Apartamento 3 quartos — Jardins", categoria: "Apartamentos", precoCentavos: 89_000_000 },
      { nome: "Studio — Vila Madalena", categoria: "Apartamentos", precoCentavos: 38_000_000 },
      { nome: "Casa 3 quartos — Condomínio Verde", categoria: "Casas", precoCentavos: 120_000_000 },
      { nome: "Casa térrea — Bairro Novo", categoria: "Casas", precoCentavos: 65_000_000 },
      { nome: "Sala comercial — Av. Paulista", categoria: "Comercial", precoCentavos: 55_000_000 },
      { nome: "Terreno 360 m² — Loteamento Sol", categoria: "Terrenos", precoCentavos: 28_000_000 },
    ],
    entrada: [
      "Olá, o {produto} ainda está disponível?",
      "Gostaria de agendar uma visita no {produto}",
      "Aceita financiamento?",
      "Vi o anúncio do {produto} no portal, qual o valor do condomínio?",
    ],
    saida: [
      "Olá! Está sim. Posso agendar uma visita para sábado de manhã?",
      "O {produto} está por {preco}. Aceita financiamento e FGTS.",
      "Visita confirmada! Te encontro na portaria.",
      "Gostou do imóvel? Posso fazer uma simulação de financiamento.",
      "Proposta registrada, vou levar ao proprietário hoje.",
    ],
    respostas: ["Sábado às 10h pode ser", "Adorei a vista", "O condomínio está alto", "Faz a simulação, por favor", "Vamos fazer uma proposta", "Preciso ver com meu banco"],
    tarefas: ["Agendar visita", "Enviar simulação de financiamento", "Levar proposta ao proprietário", "Cobrar documentação do comprador", "Pedir avaliação do banco"],
    notasLigacao: ["Quer imóvel perto do metrô", "Financiamento pré-aprovado", "Vai vender o imóvel atual primeiro", "Comparando dois imóveis", "Pediu desconto à vista"],
    campos: { finalidade: ["Comprar", "Alugar"], faixa_valor: ["Até R$ 400 mil", "R$ 400–800 mil", "Acima de R$ 800 mil"], financiamento: ["sim", "não"] },
  },
  varejo: {
    segmento: "varejo",
    empresa: "Distribuidora Ponto Certo",
    cor: "#dc2626",
    slogan: "Seu estoque sempre em dia",
    catalogo: [
      { nome: "Café torrado 500 g (caixa com 20)", categoria: "Mercearia", precoCentavos: 38_000, estoque: 120 },
      { nome: "Açúcar refinado 1 kg (fardo 10)", categoria: "Mercearia", precoCentavos: 6_500, estoque: 300 },
      { nome: "Detergente 500 ml (caixa 24)", categoria: "Limpeza", precoCentavos: 5_800, estoque: 4 },
      { nome: "Sabão em pó 1 kg (caixa 12)", categoria: "Limpeza", precoCentavos: 14_400, estoque: 60 },
      { nome: "Papel toalha (fardo 12)", categoria: "Descartáveis", precoCentavos: 7_200, estoque: 85 },
      { nome: "Copo descartável 200 ml (caixa 2500)", categoria: "Descartáveis", precoCentavos: 16_900, estoque: 3 },
      { nome: "Refrigerante 2 L (fardo 6)", categoria: "Bebidas", precoCentavos: 4_900, estoque: 200 },
      { nome: "Água mineral 500 ml (fardo 12)", categoria: "Bebidas", precoCentavos: 1_900, estoque: 400 },
    ],
    entrada: [
      "Bom dia, preciso de orçamento de {produto}",
      "Tem {produto} a pronta entrega?",
      "Qual o prazo de entrega para a zona sul?",
      "Quero repetir o último pedido",
    ],
    saida: [
      "Bom dia! Temos sim. Qual a quantidade?",
      "O {produto} sai por {preco}, entrega em 2 dias úteis.",
      "Pedido registrado! Boleto para 28 dias.",
      "Seu pedido saiu para entrega hoje.",
      "Chegou reposição de {produto}, quer garantir o seu?",
    ],
    respostas: ["10 caixas", "Pode faturar", "Consegue fazer 30 dias?", "Recebi, tudo certo", "Manda junto mais 5 fardos", "Vou fechar com outro fornecedor"],
    tarefas: ["Enviar orçamento", "Confirmar pedido com o comprador", "Cobrar boleto vencido", "Avisar reposição de estoque", "Visitar cliente da região"],
    notasLigacao: ["Compra toda segunda", "Pediu prazo de 30 dias", "Estoque baixo, quer reposição", "Reclamou do atraso na entrega", "Novo comprador da loja"],
    campos: { cnpj: ["12.345.678/0001-90", "23.456.789/0001-01", "34.567.890/0001-12"], prazo_pagamento: ["À vista", "28 dias", "28/56 dias"] },
  },
};

export const SEGMENTOS_DEMONSTRACAO = Object.keys(ROTEIROS) as SegmentoDemonstracao[];
