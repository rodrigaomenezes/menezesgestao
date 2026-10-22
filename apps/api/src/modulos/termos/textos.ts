// Textos legais (MINUTA para revisão jurídica). Mudou o texto? Suba a versão em VERSOES_DOCUMENTOS (termos.servico.ts):
// cada pessoa aceita de novo no próximo acesso. Marcadores: {plataforma}, {versao}, {vigencia}, {encarregado}.

export const TERMOS = `# Termos de Uso

**MINUTA PARA REVISÃO JURÍDICA — não vale como texto final até ser revisada.**

Versão {versao} · em vigor desde {vigencia}

## 1. Quem somos e o que oferecemos
{plataforma} é um software de gestão comercial oferecido como serviço (SaaS): CRM, conversas por WhatsApp,
telefonia, fila de ligações, rotina e desempenho da equipe, vendas e cobrança. A empresa que contrata ("Cliente")
usa o sistema para atender os próprios clientes dela.

## 2. Conta, acesso e segurança
- O Cliente indica um administrador, que cadastra as pessoas da equipe e define o que cada uma pode ver e fazer.
- Cada pessoa usa login próprio. Senhas e códigos de verificação em duas etapas são pessoais e intransferíveis.
- O Cliente avisa o suporte assim que souber de acesso indevido.

## 3. Planos, teste e pagamento
- O serviço é cobrado por empresa, em plano mensal fixo, com os limites de cada plano (pessoas, canais,
  armazenamento e módulos) mostrados na tela de plano.
- O período de teste é gratuito e não exige cartão.
- A fatura vence todo mês. Com atraso, o sistema avisa; depois de 7 dias de atraso, passa a funcionar só para
  consulta (nenhum dado é apagado); com o pagamento, volta ao normal na hora.
- O Cliente pode trocar de plano ou cancelar a qualquer momento, pela própria tela de plano.

## 4. Uso permitido
O Cliente não pode usar o sistema para: enviar mensagens em massa sem consentimento ou contra as regras do
WhatsApp; contatar quem pediu para não ser contatado; armazenar conteúdo ilegal; tentar acessar dados de outras
empresas; ou sobrecarregar o serviço de propósito.

## 5. Dados do Cliente
Os dados que o Cliente coloca no sistema são dele. Tratamos esses dados só para prestar o serviço, conforme o
Contrato de Tratamento de Dados e a Política de Privacidade. O Cliente pode exportar os dados a qualquer momento.
Ao cancelar, os dados ficam disponíveis para exportação por 90 dias e depois são excluídos, salvo obrigação legal.

## 6. Disponibilidade e suporte
Buscamos manter o serviço disponível 24 horas por dia, com a situação publicada na página de status. Manutenções
programadas são avisadas com antecedência. O suporte atende pelos canais indicados na central de ajuda.

## 7. Fornecedores do Cliente
Integrações como WhatsApp (Meta), telefonia, provedores de cobrança e inteligência artificial dependem de contas que
o próprio Cliente contrata. O uso dessas contas segue os termos de cada fornecedor.

## 8. Responsabilidade
Não respondemos por decisões comerciais tomadas com base em sugestões do sistema (inclusive as da inteligência
artificial, que sugere e não decide), nem por falhas de serviços de terceiros contratados pelo Cliente.

## 9. Mudanças nestes termos
Quando estes termos mudarem, avisamos dentro do sistema e pedimos um novo aceite no próximo acesso.

## 10. Foro
Fica eleito o foro da comarca da sede de {plataforma}, salvo regra legal diferente.
`;

export const PRIVACIDADE = `# Política de Privacidade

**MINUTA PARA REVISÃO JURÍDICA — não vale como texto final até ser revisada.**

Versão {versao} · em vigor desde {vigencia}

Esta política explica como {plataforma} trata dados pessoais, segundo a Lei Geral de Proteção de Dados (Lei
13.709/2018 — LGPD).

## 1. Dois papéis
- **Dados das pessoas da equipe do Cliente** (nome, e-mail, telefone, registros de acesso): somos **controladores**.
- **Dados dos clientes do Cliente** (contatos, conversas, ligações, vendas): o Cliente é o **controlador** e nós
  somos **operadores**, seguindo as instruções dele (veja o Contrato de Tratamento de Dados).

## 2. O que coletamos e por quê
| Dado | Para quê | Base legal |
| --- | --- | --- |
| Nome, e-mail e telefone da equipe | Criar o acesso e avisar sobre a conta | Execução de contrato |
| Registros de acesso (data, IP, aparelho) | Segurança e Marco Civil da Internet | Obrigação legal |
| Dados de cobrança da empresa | Emitir e receber as faturas | Execução de contrato |
| Uso do sistema (telas, erros) | Corrigir falhas e melhorar o serviço | Legítimo interesse |

## 3. Com quem compartilhamos
Só com fornecedores necessários para o serviço (hospedagem, envio de e-mail, avisos no celular, cobrança e, quando o
Cliente liga, inteligência artificial e WhatsApp), sempre com contrato e só o necessário. Não vendemos dados.

## 4. Inteligência artificial
Quando o Cliente usa a IA, trechos de conversas são enviados ao fornecedor de IA só para gerar a sugestão pedida, sem
uso para treino. Quem pediu para não ser contatado ou foi anonimizado nunca é enviado. O Cliente pode ligar o
mascaramento de dados pessoais (telefone, e-mail, documentos, nome e endereço) antes do envio.

## 5. Por quanto tempo guardamos
Enquanto a conta existir e, depois do cancelamento, por 90 dias para exportação. Registros de acesso: 6 meses
(Marco Civil). O Cliente define a retenção do histórico dos clientes dele na tela de LGPD.

## 6. Segurança
Conexão cifrada (HTTPS), senhas guardadas com hash forte, segredos e credenciais cifrados (AES-256-GCM), isolamento
dos dados de cada empresa no banco, verificação em duas etapas e cópias de segurança.

## 7. Seus direitos
Você pode pedir confirmação, acesso, correção, anonimização, portabilidade e exclusão dos seus dados, e saber com
quem compartilhamos. Pedidos sobre dados de clientes de uma empresa usuária devem ir para essa empresa; nós ajudamos
a empresa a atender.

## 8. Encarregado de dados (DPO)
{encarregado}
`;

export const CONTRATO = `# Contrato de Tratamento de Dados

**MINUTA PARA REVISÃO JURÍDICA — não vale como texto final até ser revisada.**

Versão {versao} · em vigor desde {vigencia}

Este contrato complementa os Termos de Uso e vale entre o Cliente (**controlador**) e {plataforma} (**operador**)
para os dados pessoais dos clientes do Cliente tratados no sistema.

## 1. Objeto
O operador trata os dados só para prestar o serviço contratado e segundo as instruções do controlador, dadas pela
configuração do sistema e por escrito.

## 2. Obrigações do operador
- Não usar os dados para fins próprios, nem vendê-los ou cedê-los.
- Manter as medidas de segurança da Política de Privacidade e isolar os dados de cada empresa.
- Garantir sigilo por todas as pessoas com acesso.
- Avisar o controlador sobre incidente de segurança que possa causar risco ou dano relevante, em até 48 horas
  depois de saber dele, com o que for conhecido.
- Ajudar o controlador a atender pedidos dos titulares (exportação e anonimização já estão disponíveis na ficha).
- Usar suboperadores (hospedagem, e-mail, avisos, IA, WhatsApp, cobrança) só com contrato que dê proteção
  equivalente; a lista fica disponível sob pedido.

## 3. Obrigações do controlador
- Ter base legal para os dados que coloca no sistema e para as mensagens que envia.
- Respeitar quem pediu para não ser contatado.
- Configurar a retenção e o mascaramento de dados conforme a própria política.

## 4. Fim do contrato
Ao fim, o controlador pode exportar os dados por 90 dias; depois disso o operador exclui ou anonimiza os dados,
salvo guarda exigida por lei.

## 5. Transferência internacional
Alguns suboperadores podem tratar dados fora do Brasil; nesse caso, só com as garantias previstas na LGPD.
`;
