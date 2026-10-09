# Roteiro

Legenda: `[ ]` não iniciado · `[-]` em desenvolvimento · `[x]` concluído · `[!]` bloqueado.
Detalhes e critérios de pronto de cada fase: `ESPECIFICACAO.md` ("Roteiro de construção") e `PROMPT_MESTRE.md` (§86–94).

- [x] Esqueleto: Fastify + TypeScript, healthcheck, CI e deploy no Railway
- [x] Fase 0 — Fundação (autenticação, multiempresa, perfis e permissões, auditoria, eventos, tempo real, tema, PWA)
- [x] Fase 0.1 — Alinhamento ao Prompt Mestre (monorepo, módulos por domínio, contrato Zod/DTO/OpenAPI, erro
      padrão, permissões em tabela, slug, isolamento A ↔ B, e2e em 5 larguras, dead-letter, documentação)
- [x] Fase 1 — CRM (contatos com dedup por telefone, carteira por escopo, etiquetas, campos personalizados,
      funis/etapas configuráveis, kanban com campos obrigatórios e motivo de perda, oportunidades, tarefas, notas,
      histórico, lixeira, ações em massa, importação CSV/XLSX idempotente em fila, vocabulário da empresa na tela)
- [x] Fase 2 — Conversas (canais demonstração, API oficial e QR; caixa de entrada por pessoa/equipe com atribuição
      e status; texto, mídia e áudio gravado no navegador com velocidade; notas internas; respostas rápidas com
      variáveis; boas-vindas, fora do horário e follow-up; deduplicação em cascata; junção de duplicadas)
- [x] Fase 3 — Ligações e fila (telefone no navegador: treino, celular do vendedor e ramal SIP; ligações com
      estados, resultados configuráveis e histórico automático; gravação cifrada com link temporário e retenção;
      filas com reserva exclusiva, ordem de chegada, pausa e escopo de carteira; importação e ação em massa
      alimentam a fila; conversão para o funil)
- [x] Fase 4 — Operação (rotina diária no Início com ponto, check-list por perfil, metas, compromissos, tarefas,
      retornos e conversas sem resposta; agenda com lembrete; escala e horas com validação do gestor e fechamento
      do mês travado no banco; metas e painel de desempenho e mapa de atividades calculados só dos eventos;
      atividades manuais corrigíveis; biblioteca de scripts aberta na conversa e na ligação)
- [x] Fase 5 — Receita e qualidade (catálogo de ofertas e entregas com vagas travadas no banco e prestador; vendas
      ligando contato, oferta e vendedor; regras de comissão percentual ou por faixa, prévia e fechamento mensal
      pelo financeiro com retrato gravado; monitoramento de qualidade com critérios e nota ponderada; pesquisas
      com link público e resultados agregados)
- [x] Fase 6 — White-label (marca pelo endereço — subdomínio ou domínio próprio —, com cores validadas por
      contraste, logos, ícone e app instalado da marca; vocabulário com plural; cadastro aberto com teste de 14 dias
      e assistente de 5 passos com segmentos prontos e dados de exemplo; planos que escondem módulos sem apagar;
      cobrança atrás de interface com provedor de demonstração; automações quando/se/então)
- [x] Fase 7 — Endurecimento (login em duas etapas por app ou e-mail com códigos de recuperação e regra da empresa;
      LGPD: exportar e anonimizar o titular, "não contatar" em toda saída, prazos de retenção com limpeza diária;
      backup com restauração testada no CI e roteiro; logs estruturados sem dados pessoais e alerta de canal
      desconectado por sino, e-mail e push; avisos no celular para quem está fora, ligação só no celular; leitura
      offline com cache limpo no login/logout; modo escuro e teclado conferidos nas telas principais)

## Próximas fases (planejadas, não iniciadas)

Plano aprovado só como documentação; cada fase começa com um plano detalhado e o ok do analista. Sprints de 2
semanas (estimativa de ordem de grandeza, com um desenvolvedor: ~21 sprints, cerca de 10 meses). Todos os itens
de `TECH_DEBT.md` que viram funcionalidade e os temas novos levantados no documento comercial estão abaixo.
Marcos: **primeiro cliente pagante** ao fim da Fase 8 · **venda em escala** ao fim da 10 · **produto completo** ao fim da 14.

- [ ] Sprint 0 — Produção configurada (1 semana, sem código): as pendências da seção seguinte.
      Pronto quando: um convite chega por e-mail, um aviso chega no celular e uma cópia do banco é restaurada e conferida.
- [ ] Fase 8 — Pronto para vender (3 sprints): provedor de cobrança real com webhook; bloqueio gradual por
      atraso (aviso → só leitura, nunca apagar); limites por plano (usuários, canais, armazenamento) e preço por
      usuário, se decidido; painel da plataforma (todas as empresas, assinaturas, uso, saúde); domínio próprio
      cadastrado sozinho no Railway; termos de uso, política de privacidade e contrato de dados em páginas públicas
      com aceite versionado; central de ajuda, suporte e página de status; administrador redefine as duas etapas
      de alguém com confirmação da pessoa.
      Pronto quando: empresa nova se cadastra, paga por Pix ou cartão e a assinatura ativa sozinha; vencida, avisa e
      depois bloqueia a escrita; ninguém passa do limite do plano.
- [ ] Fase 9 — WhatsApp em escala (3 sprints): arquivos em S3/R2 (sem limite de 16 MB); mensagens modelo da API
      oficial fora da janela de 24 h; campanhas em massa só pela API oficial, com descadastro, limite de envio e
      "não contatar"; chatbot de triagem por menu; QR com mais de um servidor (trava por canal); mensagens enviadas
      pelo celular (QR) no histórico.
      Pronto quando: campanha para 1.000 contatos sai pela API oficial, quem pediu para sair não recebe, e quem
      escreve fora do horário é triado pelo menu.
- [ ] Fase 10 — Captação e distribuição (3 sprints): rodízio de leads (fila, horário, carga) e prazo de primeira
      resposta com alerta; várias condições por regra na tela de automações; formulários do site, Meta Lead Ads,
      Google Ads e RD Station entrando como contato sem duplicar; agendamento online por link; Google Agenda e
      Outlook sincronizados; agenda ligada ao contato pela ficha; telefonia receptiva (URA, fila de entrada),
      prefixo de discagem e "Ligar por" salvo no perfil; gravação feita no navegador; kanban com "carregar mais";
      horários digitados no fuso da empresa.
      Pronto quando: lead de anúncio chega ao funil em menos de 1 minuto, é distribuído pela regra e, sem resposta no
      prazo, o gestor é avisado.
- [ ] Fase 11 — Omnichannel (2 sprints): Instagram Direct e Messenger como provedores de canal; e-mail como canal
      (receber e responder, com anexos); junção da mesma pessoa vinda por canais diferentes.
      Pronto quando: Instagram e e-mail da mesma pessoa aparecem na mesma ficha e são respondidos na mesma tela.
- [ ] Fase 12 — Inteligência artificial (3 sprints): provedor de IA atrás de interface (com demonstração e limite
      por plano); transcrição e resumo de ligações e conversas; sugestão de resposta e de próximo passo (sugere,
      não envia); nota de qualidade automática revisável; chatbot com IA e passagem para humano.
      Pronto quando: ligação gravada vira resumo na ficha em minutos; nada de quem pediu "não contatar" ou foi
      anonimizado vai para a IA.
- [ ] Fase 13 — Financeiro e cliente final (3 sprints): contrato gerado da venda com assinatura eletrônica; Pix e
      boleto na venda com baixa automática; nota fiscal pela integração de cobrança; metas contando vendas
      confirmadas (com estorno); scripts por oferta; portal do aluno/paciente; pesquisa com uma resposta por pessoa;
      anonimizar também observação de vendas e textos livres.
      Pronto quando: venda gera contrato, o cliente assina e paga pelo link, baixa e nota saem sozinhas e a comissão
      conta só o que foi pago.
- [ ] Fase 14 — Escala e ecossistema (4 sprints): indicadores pré-calculados e limite de conexões de tempo real;
      API pública com chaves e webhooks de saída; relatórios montados pelo cliente e exportação para planilha/BI;
      offline com fila de envio no aparelho; ranking e premiação (gamificação); revendedores e parceiros.
      Pronto quando: empresa com 200 pessoas usa o painel sem lentidão, um ERP recebe as vendas por webhook e um
      parceiro cria e cobra os próprios clientes.

Decisões do analista que destravam as fases: provedor de cobrança, preço por empresa ou por usuário, redação dos
termos e encarregado de dados (Fase 8, até o fim da Sprint 0); central de ajuda própria ou externa (8);
armazenamento S3 ou R2 e campanhas só pela API oficial (9); origens de lead prioritárias (10); serviço de e-mail
de entrada (11); IA no plano ou adicional (12); assinatura eletrônica e portal do cliente (13); venda por
parceiros (14).

## Pendências fora das fases (= Sprint 0)

- [!] Homologação automática: depende de ativar **PR Environments** no Railway (ação no painel).
- [!] E-mail real: depende de criar `SMTP_URL` e `EMAIL_REMETENTE` no Railway.
- [!] Domínios: criar `DOMINIO_BASE` e o DNS curinga (`*.dominio`) apontando para o Railway.
- [!] Backup do PostgreSQL de produção: ativar os agendamentos no Railway e fazer o primeiro teste (`docs/BACKUP.md`).
- [!] Avisos no celular: gerar as chaves (`npm run push:chaves`) e criar `VAPID_PUBLICA`/`VAPID_PRIVADA` no Railway.

## Ficou para fases seguintes

Tudo o que estava aqui entrou nas Fases 8 a 14 acima.
