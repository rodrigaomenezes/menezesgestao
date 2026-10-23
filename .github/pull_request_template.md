## O que muda

## Impacto (Política de Engenharia — `docs/POLITICA_ENGENHARIA.md`)
- Quem usa o que mudou (rotas, eventos, tabelas, telas):
- Contrato quebrado? (se sim: plano de migração e ADR)
- Decisão técnica nova? (`DECISIONS.md`) · Forma do sistema mudou? (`ARCHITECTURE.md`)

## Verificações (resultado real; o que não rodou fica "não executado")
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm run test:e2e`
- [ ] Tela conferida em 360 px

## Revisão do diff
- [ ] Sem vazamento entre empresas; toda rota com permissão no servidor
- [ ] Entrada validada; repetir a ação não duplica; transação onde precisa
- [ ] Nenhum segredo ou dado sensível em código, log ou PR
- [ ] Sem camada, cache, serviço ou dependência nova sem justificativa
- [ ] Documentação e `TECH_DEBT.md` atualizados

## Deficiências encontradas (problema → consequência → correção mínima)
