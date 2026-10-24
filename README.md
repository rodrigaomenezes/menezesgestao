# Menezes Gestão

Plataforma white-label de operações comerciais: CRM com funil, conversas de WhatsApp, central de telefonia,
fila de ligações, rotina, metas e qualidade — configurável para empresas de qualquer segmento.

| Documento | Para quê |
| --- | --- |
| [`PROMPT_MESTRE.md`](PROMPT_MESTRE.md) | Instrução permanente de desenvolvimento (princípios, estrutura, definição de pronto) |
| [`ESPECIFICACAO.md`](ESPECIFICACAO.md) | O produto: módulos, regras, roteiro de fases |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Como o sistema está montado |
| [`DECISIONS.md`](DECISIONS.md) | Decisões de arquitetura (ADR) |
| [`ROADMAP.md`](ROADMAP.md) / [`TECH_DEBT.md`](TECH_DEBT.md) | Estado das fases / dívida registrada |
| [`CLAUDE.md`](CLAUDE.md) | Regras para quem desenvolve (inclusive o Claude Code) |

## Rodar localmente

Pré-requisitos: Node.js 20.19+ e PostgreSQL 16 (ou Docker).

```bash
git clone https://github.com/rodrigaomenezes/menezesgestao.git && cd menezesgestao
docker compose up -d          # PostgreSQL com os bancos menezesgestao e menezesgestao_teste
cp .env.example .env          # preencha SESSION_SECRET e CRM_CHAVE (openssl rand -hex 32) e SENHA_EXEMPLO
npm install
npm run db:migrate            # aplica as migrações (o servidor também aplica ao iniciar)
npm run db:seed               # duas empresas fictícias, uma pessoa por perfil e contatos/funil de exemplo
npm run build && npm start    # http://localhost:3000
```

Desenvolvimento com recarga automática, em dois terminais: `npm run dev` (API, porta 3000) e `npm run dev:web`
(front, porta 5173). Pessoas de exemplo: `database/seeds/exemplo.json` (ex.: `dono@escola.example.com`).

Sem `SMTP_URL`, os e-mails (convites e senha) ficam na caixa de demonstração: `npm run caixa-de-saida`.
Criar uma empresa e convidar o dono: `npm run empresa:criar -- --nome "Empresa" --email dono@empresa.com.br --dono "Nome" --plano completo`
(sem SMTP, o comando já mostra o link do convite).

A documentação da API (OpenAPI) fica em `/api/openapi.json`.

### CRM (fase 1)

Menu **Contatos** (ou o termo da empresa: "Alunos", "Pacientes"…), **Funil**, **Tarefas**, **Importar planilha** e
**Configurar CRM** (administrador). Empresa nova já nasce com o funil "Vendas" e motivos de perda.

- O telefone (E.164, regra do nono dígito) identifica a pessoa: o mesmo número em outro formato não cria duplicado.
- Importação: `.xlsx` ou `.csv` (até 10 MB / 20 mil linhas) → conferir colunas → processa em fila → relatório.
  Importar a mesma planilha de novo não duplica ninguém; quem está na lixeira ou na carteira de outra pessoa é
  ignorado com o motivo no relatório.
- Vendedor vê só a própria carteira; gestor, a da equipe; dono, a da empresa (escopos do perfil).

### Conversas (fase 2)

Menu **Conversas** (caixa de entrada) e **Canais e automações** (administrador). Três tipos de canal:

| Tipo | Para quê | Como conectar |
| --- | --- | --- |
| Demonstração | Testar sem número real | Criar → Conectar → "Simular cliente" faz o papel do celular |
| API oficial (Meta) | Operação séria | Cadastrar Phone number ID, token permanente e chave secreta do app (ficam cifrados) → Conectar; no painel da Meta, cadastrar a URL e o token de verificação mostrados no canal e assinar "messages" |
| QR code | Começar rápido | Conectar → ler o QR no celular (Aparelhos conectados). Biblioteca não oficial: risco de bloqueio do número (ADR-016) |

A resposta do cliente cai sempre na mesma conversa (id do provedor, telefone com e sem nono dígito, contato) e
webhook repetido não duplica nada. Conversa sem dono fica na fila de todos que atendem; quem responde assume.

### Ligações e fila (fase 3)

Menu **Fila de ligações**, **Ligações** e **Configurar telefonia** (administrador). Formas de ligar (campo
"Ligar por"):

| Forma | Para quê | Como funciona |
| --- | --- | --- |
| Treino | Aprender sem gastar ligação | O painel simula atender, não atender e desligar |
| Celular do vendedor | Começar sem PABX | Abre o discador do celular; ao voltar, a pessoa informa se atendeu e quanto durou |
| Ramal SIP | PABX/operadora com WebRTC | Administrador cadastra o servidor `wss://`, o domínio e o ramal de cada pessoa (senha cifrada) |

- Fila: **Pegar o próximo** reserva o contato só para você (por alguns minutos; 20 pessoas ao mesmo tempo nunca
  pegam o mesmo). O resultado decide o que acontece: reagendar, encerrar, descartar ou converter (cria a
  oportunidade no funil da fila). Contato com "não contatar" ou fora da sua carteira não aparece.
- Planilha importada ou contatos selecionados podem ir direto para uma fila; quem já está em outra fila ou já foi
  ligado aparece no relatório.
- Gravação (quando ativada): guardada cifrada, ouvida por link de 5 minutos, cada acesso fica na auditoria e o
  conteúdo é apagado depois do prazo de retenção configurado.

### Operação (fase 4)

O **Início** vira a rotina do dia: botão de ponto, check-list do perfil (configurado em **Configurar rotina**),
metas, compromissos, tarefas vencidas, retornos da fila e conversas esperando resposta. Menus novos: **Agenda**,
**Horas**, **Desempenho e metas**, **Mapa de atividades** e **Scripts**.

- Horas: a pessoa bate o ponto (ou lança entrada e saída); o gestor valida ou recusa com motivo — ninguém valida
  as próprias horas. O administrador fecha o mês: a partir daí nada daquele mês muda (trava no banco) até ser
  reaberto, com motivo registrado. A escala semanal (montada pelo gestor) dá o previsto do mês.
- Metas, painel de desempenho e mapa de atividades são contados das ações registradas (ligações encerradas,
  mensagens enviadas, funil, fila, tarefas). Ninguém digita resultado; o que não passa pelo sistema (reunião,
  visita) é lançado à mão no mapa e pode ser corrigido (fica na auditoria).
- Scripts: roteiros por funil/etapa e por canal; na conversa, "Usar na mensagem" preenche o texto com o nome do
  cliente; na ligação, o painel mostra o roteiro da etapa em que o contato está.

### Receita e qualidade (fase 5)

Menus **Vendas**, **Comissões**, **Catálogo**, **Qualidade** e **Pesquisas**. Os nomes seguem o vocabulário da
empresa (`oferta` → "curso", `entrega` → "turma", `prestador` → "professor").

- Venda: pela ficha do contato ("Registrar venda") ou na tela de vendas; liga contato, oferta e vendedor e pode
  reservar a vaga numa entrega (vagas travadas no banco: duas vendas ao mesmo tempo não estouram a turma). O
  vendedor registra; quem confere o pagamento (financeiro) confirma ou cancela.
- Comissão: uma regra geral e, se quiser, uma por oferta — percentual fixo ou por faixa do total vendido no mês
  (o percentual da faixa alcançada vale para o total). Só vendas confirmadas contam. O financeiro fecha o mês:
  o resultado fica gravado e as vendas daquele mês não mudam até a reabertura (com motivo).
- Qualidade: o gestor avalia uma ligação (em Ligações) ou conversa com nota por critério (com peso); a pessoa
  avaliada recebe o feedback no sino.
- Pesquisa: o link público `/p/<código>` abre sem login; respostas não guardam IP nem identificam a pessoa.

### White-label (fase 6)

Menus **Empresa e marca**, **Plano e cobrança** e **Automações**; tela aberta **Cadastre sua empresa**.

- Uma instalação atende várias marcas: o endereço decide a marca. `<slug>.DOMINIO_BASE` (ex.:
  `escola-sol.seudominio.com.br`) ou o domínio próprio da empresa (ex.: `crm.escolasol.com.br`). A tela de entrada,
  o ícone e o app instalado já saem com nome, cores e logo daquela empresa — e o login entra direto nela.
- Marca: cores (o sistema recusa combinações sem contraste suficiente para leitura), logo para fundo claro e
  escuro (PNG, JPG ou WebP até 512 KB) e nome do produto.
- **Segmento e termos** (menu próprio): escola, clínica, consultoria, imobiliária, varejo ou outro. O segmento
  troca os nomes em todo o sistema — 7 termos (cliente, oportunidade, oferta, entrega, prestador, colaborador e
  unidade) com singular, plural e gênero: a escola vê "Alunos" e "Nova matrícula", a clínica vê "Pacientes" e
  "Paciente não encontrado". Também cria os campos típicos (ex.: convênio na clínica). Trocar de segmento só
  renomeia; nada é apagado.
- Cadastro aberto: a empresa cria a conta (14 dias de teste com todos os módulos) e um assistente de 5 passos
  deixa tudo pronto: marca → segmento (funil, termos e motivos de perda prontos) → equipe → canais → contatos
  (planilha ou dados de exemplo, apagáveis com um clique). `CADASTRO_ABERTO=nao` fecha o cadastro.
- Plano: Essencial, Comercial ou Completo. Mudar de plano esconde módulos, não apaga nada. A cobrança está em
  modo de demonstração (nenhum valor é cobrado); a troca por um provedor real é uma interface (ADR-025).
- Automações: "quando [acontecer], se [condição], então [criar tarefa / mover etapa / avisar / enviar mensagem]".
  Rodam em até um minuto; uma automação nunca dispara outra; quem marcou "não contatar" não recebe mensagem.

### Endurecimento (fase 7)

- **Login em duas etapas** (em "Segurança da conta"): app autenticador (Google/Microsoft Authenticator, Authy) ou
  código por e-mail, com 10 códigos de recuperação. Em "Empresa e marca → Segurança", a empresa pode exigir de
  administradores ou de todos; quem ainda não configurou só acessa a configuração. Celular perdido sem códigos:
  `node apps/api/dist/cli/desligar-duas-etapas.js --email pessoa@empresa.com.br` no terminal do servidor.
- **LGPD**: na ficha do contato, "Exportar dados" (tudo o que a empresa guarda sobre o titular) e "Anonimizar"
  (apaga nome, telefone, e-mail, notas, mensagens, gravações; os números de metas e vendas continuam). "Não deseja
  ser contatado" vale para fila, discagem, conversa nova e mensagens automáticas. Prazos de retenção em
  "Empresa e marca → Privacidade"; a limpeza roda todo dia.
- **Avisos no celular**: em "Notificações → Avisos neste aparelho". Chegam quando a pessoa está fora do sistema;
  lembrete de ligação (retorno da fila) só no celular. Precisa das chaves VAPID (veja as variáveis).
- **Sem internet**: o app mostra os dados vistos por último (somente leitura); o cache é apagado ao entrar e ao sair.
- **Backup**: backups diários do Railway + roteiro de restauração testado (`docs/BACKUP.md`, `npm run backup:conferir`).
- **Logs**: uma linha JSON por evento de negócio (tipo, empresa, autor, ids) e por erro — sem dados pessoais.

### Interface (fase 7.6)

- Visual limpo e arejado: fundo claro, uma só cor de destaque (a da marca), fonte Plus Jakarta Sans servida pelo
  próprio app (funciona offline).
- Menu lateral com ícones, em grupos (Dia a dia, Resultados, Configurações, Sua conta). No celular e no tablet,
  barra de baixo com Início, Conversas, Funil, Agenda e Mais.
- **Início que cada pessoa monta**: até 13 blocos (atalhos, conversas esperando, metas, fila do dia do BRE, agenda, tarefas,
  retornos, check-list, ponto, funil, ranking, comissão, avisos). "Personalizar início" sobe, desce, tira e
  adiciona; a escolha vale no celular e no computador. Sem escolha, o perfil traz um padrão (atendimento, gestão
  ou financeiro). Só aparecem blocos de módulos que o perfil pode ver.

### Motor BRE (fase 8.1)

Módulo `bre` (plano Completo) que aplica a doutrina BRE (ETR BRE-ETR-001 v0.2). Ainda sem IA: as regras rodam no
servidor e a pessoa registra.
- **Marco BRE na etapa** ("Configurar CRM"): com marcos, o funil só aceita as transições da doutrina.
- **Estado do cliente** (Recente, Ativo, Prestes a dormir, Inativo), recalculado todo dia pelas vendas confirmadas.
- **Fila do dia** em "Motor BRE": só quem pode ser contatado hoje (48 h depois da entrega para o recente, 48 h
  entre tentativas, 3 tentativas por ciclo, 7 dias de silêncio encerram o ciclo, 15 dias entre ciclos sem
  resposta, "não contatar"). Data combinada com o cliente vale mais que o intervalo.
- **Registrar conversa** (na fila e na conversa): resultado, temperatura, estado emocional, os três "sim",
  próxima ação e data do retorno; com Break, categoria, motivo e o que o cliente disse. Gera o retorno, a
  reentrada da categoria e, na venda, o pós-venda D+2, 5, 10, 20 e 30.
- **Limites da empresa** em "Motor BRE" (administrador); motivos de Break pela API (`/api/bre/motivos`).
- **Sugerir com IA** (fase 8.2, no registro aberto pela conversa): a IA lê a conversa e pré-preenche o registro;
  a pessoa confere e salva. O motor descarta desconto para cliente recente ou antes do diagnóstico e oferta antes
  dos três "sim", e diz por quê. Quem pediu "não contatar" ou foi anonimizado nunca vai para a IA. Cada análise
  fica guardada com o provedor e a versão da doutrina.
- **Precisa de uma pessoa** (escalonamento): pronto para comprar, ajuda técnica, VIP ou reclamação, apontado pela IA
  ou pela equipe no registro. Avisa quem responde pelo cliente e o gestor, e nenhuma mensagem automática sai para o
  cliente até alguém marcar como resolvido.
- **SQ-BRE** (Qualidade): na conversa, "SQ-BRE" pede a nota prévia da IA nos 5 pilares (0 a 20) e o supervisor
  confirma, ajustando o que precisar. A prévia fica guardada; só a nota confirmada conta.
- **Desempenho (BPI)** em "Motor BRE": ranking do mês com os pilares Receita 30%, Pipeline 20%, Inteligência 20%,
  Qualidade 20% e Relacionamento 10% (pilar sem dados fica fora) e quem está em coaching. Toda segunda, quem ficou
  abaixo de 70 num pilar por 2 semanas gera aviso ao gestor. A meta de receita por pessoa fica nos limites.
- **Campos de inteligência**: em "Configurar CRM → Campos personalizados", "Contar como inteligência" marca os
  campos do cliente que o método quer saber. O registro mostra o que falta saber, e a completude do BPI passa a
  contar sobre eles.
- **IA × equipe** (administrador, em "Motor BRE"): quanto a IA concorda com o que a equipe registrou e com a nota
  SQ-BRE confirmada, e se a automação já estaria liberada pelo percentual e pela amostra da empresa.
- **Privacidade com a IA**: nos limites do Motor BRE, "Esconder telefone, e-mail, CPF, CNPJ e CEP antes de enviar a
  conversa para a IA" troca esses dados — e também o nome do cliente e endereços — por marcadores. Desligado por
  padrão nos primeiros testes.
- **IA sem travar a tela**: "Sugerir com IA" e a prévia do SQ-BRE vão para a fila; a tela mostra "Analisando…" e
  preenche quando chega. Se a IA falhar, a pessoa preenche (ou o supervisor avalia) normalmente. Limite de análises
  por hora por empresa nos limites do motor.
- **Início**: bloco "Fila do dia (BRE)" com os primeiros da fila (padrão de quem atende, depois das metas).
- **Automação** (administrador, em "Motor BRE"): pós-venda D+N, aniversário, reentrada do dia, lançamento compatível
  e alerta de estoque, com o texto da empresa ({nome}, {vendedor}, {produto}, {empresa}) pelo canal escolhido.
  "Compatível" = já comprou da mesma categoria do catálogo. Opcionalmente sai como **mensagem modelo** aprovada na
  Meta (nome, idioma e a ordem das variáveis), o que alcança quem está fora da janela de 24 h da API oficial; pelo QR
  e na demonstração vai o texto. Só liga com o painel IA × equipe liberado; pula "não contatar", escalonamento aberto
  e quem está nos limites; nunca repete. Roda às 09:17 e tem "Rodar agora".
- **Cobrança dos clientes** (Vendas): o administrador conecta o provedor de cobrança **da empresa** (Asaas, ou
  demonstração sem conta); a chave é testada, guardada cifrada e nunca volta para a tela. Em cada venda aguardando
  pagamento, quem confere pagamento gera Pix, boleto ou link; o dinheiro cai na conta da empresa. O aviso do provedor
  (webhook com token, endereço mostrado na tela) dá baixa sozinho: a venda é confirmada, o estoque baixa e o BPI
  recalcula. Aviso repetido não muda nada. Na demonstração, "Simular pagamento" passa pelo mesmo caminho.
- **Catálogo**: cada item pode ter categoria, estoque (a venda confirmada baixa uma unidade; o cancelamento devolve)
  e data de lançamento.
- **Motivos de Break** (administrador, em "Motor BRE") e **Encerrar (BRE)** na ficha do cliente, em cada
  oportunidade em andamento: critério, temperatura, checklist e reentrada.

### Pronto para vender (fase 9)

- **Plano e cobrança** mostra o uso de pessoas, canais e armazenamento contra o limite do plano (Essencial 3/1/500 MB,
  Comercial 10/3/2 GB, Completo 30/10/10 GB; sob medida sem limite). Passar do limite nunca apaga: só impede acrescentar,
  com mensagem dizendo o que fazer. Mídia recebida do cliente nunca é recusada.
- **Atraso**: até 7 dias, faixa de aviso em todas as telas; depois, a empresa fica **só para consulta** (o servidor recusa
  gravações; pagar e trocar de plano continuam liberados). Pagou, volta na hora. Nada é apagado.
- **Painel da plataforma** (menu "Plataforma", só para os e-mails em `PLATAFORMA_ADMINS`): todas as empresas com plano,
  situação, uso, última atividade e saúde (boa, atenção, risco); estender teste, trocar plano, suspender e reativar,
  tudo auditado.
- **Termos de uso, política de privacidade e contrato de dados** em `/termos`, `/privacidade` e `/contrato-de-dados`
  (**minutas para revisão jurídica**). Aceite versionado e imutável: cadastro e convite gravam o aceite; versão nova
  pede aceite no próximo acesso (contrato de dados: quem administra a empresa).
- **Ajuda** (ícone "?" no topo): artigos da tela aberta primeiro, busca, e "Falar com o suporte" (`SUPORTE_WHATSAPP`,
  `SUPORTE_EMAIL`). **Situação do serviço** em `/status`.
- **Redefinir duas etapas** (Usuários): o administrador pede, a pessoa confirma pelo link do e-mail; só então as duas
  etapas são desligadas e as sessões encerradas.

### Demonstração (empresas de exemplo)

Tela **antes do login** em `/demonstracao`, só para quem tem a chave do servidor (`DEMONSTRACAO_CHAVE`; sem ela a
tela não existe). Para cada segmento — escola, clínica, consultoria, imobiliária e varejo — "Carregar exemplo" cria
uma empresa separada, configurada pelo pacote do segmento e com **90 dias de dados fictícios**: 11 pessoas, 300
contatos, cerca de 210 oportunidades andando pelo funil, 180 conversas com 1.300 mensagens do ramo, 3.400 ligações,
fila com retornos, tarefas, agenda, ponto, check-list, metas, vendas e comissões, avaliações de qualidade, pesquisa
respondida, registros do motor BRE e avisos. Gera em cerca de 2 segundos (fila de tarefas). Depois é só "Entrar como
dono, gestor, vendedor ou financeiro", com um clique, para mostrar cada visão. A entrada sem senha só funciona em
empresa marcada como demonstração; nomes, telefones e e-mails são fictícios (`.example`). "Gerar de novo" cria um
exemplo novo (o "hoje" dos dados é o dia da geração); "Arquivar" tira da lista.

### Painéis do todo ao micro (fase 9.1)

Todo número é uma porta (ADR-043). No **Desempenho**: os números do período (com a variação contra o período
anterior) escolhem o indicador → o gráfico por dia aproxima o dia clicado → "Quem mais fez" foca a pessoa →
"O que está por trás do número" lista cada ação e abre o contato ou a conversa. Período com atalhos (Hoje, 7 dias,
30 dias, Este mês, Mês passado, Outro até 92 dias). Os filtros ficam no endereço: o "voltar" desfaz o último clique,
o link pode ser enviado e cada clique vira uma etiqueta removível. Gráficos com "Ver como tabela", teclado e 360 px.
No **Funil → Painel**: quem entrou, ganhou e perdeu no período, conversão e dias até ganhar → abertas agora por
etapa, motivos de perda, quem ganhou e ganhas por dia → a lista exata (ex.: perdidas por "Preço") → a ficha. Em
**Vendas**: valor confirmado, quantidade, ticket médio, aguardando e canceladas → por dia, por oferta e por vendedor →
a lista das vendas daquele recorte. Em **Ligações**: feitas, atendidas, não atendidas, taxa de atendimento e tempo
falado → por dia, por resultado e quem mais ligou → a lista (com gravação e "Avaliar"). Em **Qualidade**: avaliações,
nota média e feedback não lido → nota por pessoa e por critério (o mais fraco primeiro) → as avaliações. No **Início**,
na **Rotina**, no **BPI** e em **Comissões**, cada linha abre o painel que a explica, já filtrado. No **Motor BRE**,
"Breaks: onde a venda quebra" mostra as quebras por categoria, motivo, dia e quem registrou, até o contato. Contatos, Tarefas,
Conversas e Auditoria guardam o filtro no endereço (abrir e voltar mantém a busca). Em números onde subir é ruim
(perdas, cancelamentos, não atendidas, dias), a cor se inverte.

## Testes

```bash
npm run lint && npm run typecheck
npm test                  # unidade + integração (= test:unit + test:integration)
npm run test:unit
npm run test:integration  # PostgreSQL real em DATABASE_URL_TESTE (o banco é APAGADO a cada execução)
npm run build && npm run test:e2e   # Playwright em 360, 390, 768, 1024 e 1440 px
```

`DATABASE_URL_TESTE` precisa apontar para um banco com "teste" no nome; os testes se recusam a rodar em outro.

## Variáveis de ambiente

| Variável | Obrigatória | Para quê |
| --- | --- | --- |
| `DATABASE_URL` | sim | PostgreSQL |
| `SESSION_SECRET` | sim | Assina os tokens de sessão e de links (≥ 32 caracteres; `openssl rand -hex 32`) |
| `CRM_CHAVE` | sim | Chave AES-256-GCM dos dados cifrados (64 hex; `openssl rand -hex 32`). Não troque depois |
| `APP_URL` | em produção | Endereço público (links dos e-mails); `https://` liga o cookie `Secure` |
| `PORT` | não | Porta (padrão 3000; no Railway, a mesma do domínio) |
| `PRODUTO_NOME` | não | Nome do produto na tela de entrada e no app instalado |
| `DOMINIO_BASE` | não | Domínio das marcas por subdomínio (ex.: `seudominio.com.br` → `<slug>.seudominio.com.br`) |
| `CADASTRO_ABERTO` | não | `nao` fecha o cadastro de novas empresas (padrão: aberto) |
| `VAPID_PUBLICA`, `VAPID_PRIVADA` | não | Avisos no celular (Web Push). Gere uma vez com `npm run push:chaves`; sem elas, avisos só no sino |
| `VAPID_CONTATO` | não | Contato do remetente dos avisos (padrão: `mailto:` + `EMAIL_REMETENTE`) |
| `SMTP_URL`, `EMAIL_REMETENTE` | não | Envio real de e-mail (ex.: `smtps://usuario:senha@smtp.provedor.com:465`) |
| `LIMITE_REQ_MINUTO`, `LIMITE_LOGIN_MINUTO` | não | Limites por IP (padrão 300 e 10 por minuto) |
| `DATABASE_URL_TESTE` | só testes | Banco descartável dos testes |
| `SENHA_EXEMPLO` | só `db:seed` | Senha das pessoas de exemplo |
| `WHATSAPP_QR_ATIVO` | não | `nao` desliga as conexões por QR nesta instância (só **uma** instância pode segurar cada número) |
| `ANTHROPIC_API_KEY` | não | IA do motor BRE (Claude). Sem ela, "Sugerir com IA" usa a demonstração por palavras |
| `BRE_IA_MODELO` | não | Modelo da IA do motor BRE (padrão `claude-opus-5-5`) |
| `DEMONSTRACAO_CHAVE` | não | Liga a tela `/demonstracao` (empresas de exemplo); pelo menos 16 caracteres (`openssl rand -hex 16`) |
| `PLATAFORMA_ADMINS` | não | E-mails da equipe da plataforma, separados por vírgula: veem o painel de todas as empresas |
| `SUPORTE_WHATSAPP`, `SUPORTE_EMAIL` | não | Canais de suporte mostrados na central de ajuda |
| `ENCARREGADO_DADOS` | não | Encarregado de dados (DPO): nome e contato, publicado na política de privacidade |
| `WHATSAPP_GRAPH_URL` | não | Endereço da Graph API da Meta (padrão `https://graph.facebook.com/v21.0`; troque só em testes) |

## Publicar no Railway

O Railway publica a cada merge na `main` (`railway.json`: `npm run build`, `npm start`, healthcheck `/api/health`).

1. Serviço do app → **Variables**: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `SESSION_SECRET`, `CRM_CHAVE`,
   `APP_URL=https://<domínio>`, `NODE_ENV=production`, `PORT` (a do domínio) e, quando tiver, `SMTP_URL` e `EMAIL_REMETENTE`.
2. **Homologação:** Project Settings → Environments → **PR Environments** (cada PR ganha ambiente e banco próprios).
3. **Primeira empresa** (no terminal do serviço: `railway link` e `railway ssh`):
   `node apps/api/dist/cli/criar-empresa.js --nome "Empresa" --email voce@empresa.com.br --dono "Seu Nome" --plano completo`
   — sem SMTP, o comando mostra o link para criar a senha. (Com o cadastro aberto, também dá para criar pela tela.)
4. **Marcas por endereço:** no DNS do domínio base, crie `*.seudominio.com.br` (CNAME) apontando para o domínio do
   Railway e adicione `*.seudominio.com.br` em Settings → Networking → Custom Domain; defina `DOMINIO_BASE`.
   Para o domínio próprio de uma empresa: ela cadastra em "Empresa e marca", cria o CNAME para o Railway e você
   adiciona o domínio no mesmo lugar do Railway (o certificado sai sozinho).
5. **Backups:** serviço Postgres → **Backups** → agendamentos diário e semanal. Teste a restauração todo mês
   (`docs/BACKUP.md`).
6. **Avisos no celular:** rode `npm run push:chaves` uma vez (no seu computador) e crie `VAPID_PUBLICA` e
   `VAPID_PRIVADA` nas variáveis do serviço.

## Fluxo de trabalho

`main` + uma branch por fase/correção, um PR por entrega, merge só com CI verde (ADR-010). Commits no padrão
`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
