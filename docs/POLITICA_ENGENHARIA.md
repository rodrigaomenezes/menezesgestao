# Política Permanente de Engenharia e Evolução do Sistema

> Vale para todos os sistemas do Rodrigo Menezes (Menezes Gestão, Lumen Operações, Estadia e os próximos).
> Texto aprovado em 22/10/2026. A seção "Como cumprir neste projeto", no fim, traduz cada item para este
> repositório. Mudar a política = mudar este arquivo em todos os repositórios.

Trate a arquitetura, a estabilidade, a segurança, a manutenibilidade e a capacidade de evolução como requisitos
permanentes do projeto.

Antes de implementar novas funcionalidades, analise o impacto sobre a arquitetura existente e respeite os seguintes
critérios:

1. **Limites arquiteturais:** cada módulo deve ter responsabilidades definidas, interfaces explícitas e dependências
   controladas. Evite dependências circulares e acesso indevido à implementação interna de outros módulos.
2. **Compatibilidade:** preserve os contratos existentes de APIs, eventos, banco de dados e integrações. Quando uma
   mudança incompatível for necessária, planeje uma migração controlada.
3. **Testabilidade:** novas regras de negócio e correções devem ter testes adequados. Corrija falhas e regressões
   antes de considerar a implementação concluída.
4. **Integridade:** valide entradas e transições de estado, utilize transações quando necessárias e garanta que
   operações críticas não produzam duplicações ou inconsistências.
5. **Segurança:** respeite autenticação, autorização, isolamento de dados, gerenciamento seguro de segredos e
   princípio do menor privilégio.
6. **Eficiência:** evite trabalho redundante, dependências não utilizadas, consultas repetidas e processamento
   desnecessário. Identifique gargalos por evidências e meça os resultados das otimizações relevantes.
7. **Resiliência:** trate falhas de serviços externos, timeouts, tentativas de repetição, concorrência e operações
   idempotentes conforme o risco de cada funcionalidade.
8. **Observabilidade:** implemente logs úteis, tratamento consistente de erros e mecanismos de diagnóstico sem
   registrar credenciais ou dados sensíveis desnecessariamente.
9. **Evolução do banco de dados:** versionar migrações, avaliar compatibilidade com versões anteriores e definir
   procedimentos seguros de recuperação.
10. **Manutenibilidade:** mantenha documentação arquitetural atualizada, código legível, convenções consistentes e
    dependências explícitas.
11. **Entrega segura:** valide alterações por meio de testes, análise estática, verificações de tipos e build,
    conforme as ferramentas existentes. Não declare uma verificação concluída se ela não foi executada.
12. **Mudanças incrementais:** prefira alterações pequenas, rastreáveis e reversíveis. Antes de uma refatoração
    abrangente, apresente o diagnóstico, os riscos e o plano de execução.
13. **Prevenção de complexidade:** não crie camadas, abstrações, serviços, caches ou microserviços sem uma
    justificativa técnica concreta.
14. **Critérios de conclusão:** uma funcionalidade só deve ser considerada pronta quando atender aos requisitos,
    respeitar os contratos arquiteturais, passar pelas verificações aplicáveis e possuir documentação compatível com
    a mudança.

Mantenha um arquivo de arquitetura e um registro das decisões técnicas relevantes. Antes de cada mudança
significativa, consulte esses documentos e atualize-os quando necessário.

Se identificar uma deficiência arquitetural que aumente o risco de novas implementações, não a ignore
silenciosamente. Explique o problema, a consequência e a correção mínima recomendada.

**Objetivo final:** permitir que o sistema cresça em funcionalidades e integrações sem transformar cada nova
implementação em uma fonte crescente de falhas, retrabalho, lentidão ou complexidade.

## Rotina obrigatória de cada mudança

1. **Antes:** ler `ARCHITECTURE.md` e `DECISIONS.md`; listar quem usa o que vai mudar (contratos, eventos, tabelas,
   telas); se a mudança é grande ou incompatível, apresentar diagnóstico, riscos e plano e esperar o ok.
2. **Durante:** a menor alteração que resolve; teste junto com o código; nada de camada, cache ou serviço novo sem
   motivo escrito.
3. **Antes do PR:** rodar todas as verificações do projeto (lista abaixo) e anotar o resultado real de cada uma.
   Verificação não executada é declarada como "não executada", nunca como "ok".
4. **Ao fim:** atualizar `ARCHITECTURE.md` (se mudou a forma do sistema), `DECISIONS.md` (se houve decisão
   técnica), o registro de dívidas e o README; responder com arquivos modificados, responsabilidades, dependências
   afetadas, otimizações (com medida, quando relevante), verificações executadas e deficiências encontradas
   (problema → consequência → correção mínima).

## Como cumprir neste projeto (Menezes Gestão)

| Item | Como se cumpre aqui | Verificado por |
| --- | --- | --- |
| 1. Limites | Módulos em `apps/api/src/modulos/<dominio>` (rotas → serviço → repositório); contrato da API em `@mg/shared`. Repositório é interno do módulo: outro módulo usa o serviço | Lint `no-restricted-imports` (7 exceções antigas, TECH_DEBT #70) |
| 2. Compatibilidade | Contrato Zod em `@mg/shared` e OpenAPI; eventos e tabelas só ganham campos; mudança incompatível = ADR + migração em duas etapas (adiciona → migra uso → remove numa versão seguinte) | Typecheck do monorepo; testes de integração das rotas |
| 3. Testes | Vitest (unidade e integração) + Playwright em 5 larguras; correção de bug vem com teste que falhava antes | `npm test`, `npm run test:e2e` |
| 4. Integridade | Zod em toda entrada; transições checadas no serviço; transação no repositório; índice único + idempotência em webhooks e jobs | Testes de integração |
| 5. Segurança | Sessão + permissão no servidor em toda rota; `empresa_id` + RLS; segredos em variável de ambiente ou AES-256-GCM; menor privilégio por perfil | `rls.test`, testes de permissão |
| 6. Eficiência | Sem consulta por linha; paginação; cache só com motivo escrito (ex.: BPI, ADR-037); otimização relevante com medida antes/depois no PR | Revisão do diff |
| 7. Resiliência | Fornecedores atrás de interface; pg-boss com repetição; webhook idempotente; timeouts nos provedores | Testes contra servidor falso |
| 8. Observabilidade | Log do Fastify sem corpo e com tokens ocultados (`ocultarTokens`); erro sempre `{ error: { code, message, details } }`; `/api/health`, `/status` e painel de saúde | `config.test.ts` (logs) |
| 9. Banco | `database/migrations/NNNN_*.sql` numeradas, aditivas e idempotentes; a versão anterior do código roda com o banco novo, então voltar = publicar a versão anterior no Railway; dados: `docs/BACKUP.md` | `npm run db:migrate` nos testes; `npm run backup:conferir` |
| 10. Manutenção | `ARCHITECTURE.md`, `DECISIONS.md`, `TECH_DEBT.md`, `README.md` atualizados na mesma mudança | Revisão do PR |
| 11. Entrega | `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` (o CI repete todos) | CI `verificar` |
| 12. Incremental | PR por fase; commits pequenos; refatoração grande só com diagnóstico, riscos e plano aprovados | — |
| 13. Complexidade | Nova camada, cache, serviço ou dependência só com ADR | `DECISIONS.md` |
| 14. Pronto | Requisitos + contratos + verificações do item 11 executadas + documentação | Checklist do PR (`.github/pull_request_template.md`) |

### Deficiências conhecidas (problema → consequência → correção mínima)

- **Repositório usado por outro módulo** (7 arquivos usam `permissoes.repositorio` ou `crm/contatos.repositorio`) →
  mudar uma consulta de contatos ou permissões pode quebrar Conversas, Receita, Operação, Usuários ou Empresas sem
  aviso → a trava de lint impede casos novos; cada exceção sai quando o módulo for tocado, trocando a importação por
  uma função do serviço dono (TECH_DEBT #70).
- **Sem verificação automática de dependências circulares** → um ciclo de importação pode surgir sem ninguém ver e
  causar valores `undefined` na inicialização → quando houver o primeiro sinal, adicionar `madge --circular` ao CI
  (não adicionado agora para não criar dependência sem necessidade; item 13).
- **Sem medida de desempenho de referência** → não há como provar ganho ou perda de uma otimização → medir no PR
  que otimizar (tempo da rota em `app.inject` ou `EXPLAIN ANALYZE`), sem infraestrutura nova.
