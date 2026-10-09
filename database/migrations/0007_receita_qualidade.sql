-- Fase 5 — Receita e qualidade: catálogo de ofertas, entregas (turmas/agendas/projetos) com capacidade e
-- prestador, vendas, regras e fechamento de comissão, monitoramento de qualidade e pesquisas com link público.
-- Aditiva e idempotente.

-- Catálogo -------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oferta (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  nome            text NOT NULL CHECK (length(nome) BETWEEN 1 AND 120),
  descricao       text CHECK (descricao IS NULL OR length(descricao) <= 2000),
  preco_centavos  bigint CHECK (preco_centavos IS NULL OR preco_centavos >= 0),
  criado_por      uuid REFERENCES usuario(id),
  criado_em       timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em   timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em    timestamptz(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS oferta_nome_uk ON oferta (empresa_id, lower(nome)) WHERE arquivado_em IS NULL;

-- Entrega: turma, agenda, projeto… (o nome vem do vocabulário da empresa).
CREATE TABLE IF NOT EXISTS entrega (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresa(id),
  oferta_id      uuid NOT NULL REFERENCES oferta(id),
  nome           text NOT NULL CHECK (length(nome) BETWEEN 1 AND 120),
  prestador_id   uuid REFERENCES usuario(id),
  capacidade     integer CHECK (capacidade IS NULL OR capacidade > 0),
  inicio         date,
  fim            date,
  horario        text CHECK (horario IS NULL OR length(horario) <= 200),
  status         text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'encerrada')),
  criado_por     uuid REFERENCES usuario(id),
  criado_em      timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em  timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em   timestamptz(3),
  CHECK (fim IS NULL OR inicio IS NULL OR fim >= inicio)
);
CREATE INDEX IF NOT EXISTS entrega_oferta_idx ON entrega (empresa_id, oferta_id) WHERE arquivado_em IS NULL;

CREATE TABLE IF NOT EXISTS entrega_participante (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  entrega_id    uuid NOT NULL REFERENCES entrega(id),
  contato_id    uuid NOT NULL REFERENCES contato(id),
  venda_id      uuid,
  status        text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'cancelado')),
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now()
);
-- O mesmo contato ocupa uma vaga só por entrega.
CREATE UNIQUE INDEX IF NOT EXISTS entrega_participante_uk ON entrega_participante (entrega_id, contato_id) WHERE status = 'ativo';

-- Vendas ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS venda (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresa(id),
  contato_id         uuid NOT NULL REFERENCES contato(id),
  oferta_id          uuid NOT NULL REFERENCES oferta(id),
  vendedor_id        uuid NOT NULL REFERENCES usuario(id),
  oportunidade_id    uuid REFERENCES oportunidade(id),
  entrega_id         uuid REFERENCES entrega(id),
  valor_centavos     bigint NOT NULL CHECK (valor_centavos > 0),
  forma_pagamento    text NOT NULL CHECK (forma_pagamento IN ('pix', 'cartao', 'boleto', 'dinheiro', 'transferencia', 'outro')),
  parcelas           integer NOT NULL DEFAULT 1 CHECK (parcelas BETWEEN 1 AND 60),
  status             text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'confirmada', 'cancelada')),
  -- Dia da venda no fuso da empresa: define o mês da comissão.
  data_venda         date NOT NULL,
  observacao         text CHECK (observacao IS NULL OR length(observacao) <= 1000),
  motivo_cancelamento text CHECK (motivo_cancelamento IS NULL OR length(motivo_cancelamento) <= 500),
  criado_por         uuid REFERENCES usuario(id),
  criado_em          timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em      timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS venda_mes_idx ON venda (empresa_id, data_venda, vendedor_id);
CREATE INDEX IF NOT EXISTS venda_contato_idx ON venda (empresa_id, contato_id);
-- Uma venda por oportunidade.
CREATE UNIQUE INDEX IF NOT EXISTS venda_oportunidade_uk ON venda (oportunidade_id) WHERE oportunidade_id IS NOT NULL AND status <> 'cancelada';

-- Comissão: regra por oferta (ou geral), percentual fixo ou por faixa do total vendido no mês.
CREATE TABLE IF NOT EXISTS regra_comissao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  nome          text NOT NULL CHECK (length(nome) BETWEEN 1 AND 120),
  oferta_id     uuid REFERENCES oferta(id),
  tipo          text NOT NULL CHECK (tipo IN ('percentual', 'faixa')),
  percentual    numeric(5, 2) CHECK (percentual IS NULL OR (percentual >= 0 AND percentual <= 100)),
  -- [{ "ateCentavos": 1000000 | null, "percentual": 5 }] em ordem crescente; a última sem teto.
  faixas        jsonb,
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3),
  CHECK ((tipo = 'percentual') = (percentual IS NOT NULL)),
  CHECK ((tipo = 'faixa') = (faixas IS NOT NULL))
);
-- Uma regra ativa por oferta e uma geral.
CREATE UNIQUE INDEX IF NOT EXISTS regra_comissao_uk ON regra_comissao (
  empresa_id, COALESCE(oferta_id, '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE arquivado_em IS NULL;

CREATE TABLE IF NOT EXISTS fechamento_comissao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresa(id),
  mes            date NOT NULL CHECK (extract(day FROM mes) = 1),
  total_centavos bigint NOT NULL DEFAULT 0,
  fechado_por    uuid REFERENCES usuario(id),
  fechado_em     timestamptz(3) NOT NULL DEFAULT now(),
  reaberto_por   uuid REFERENCES usuario(id),
  reaberto_em    timestamptz(3),
  motivo_reabertura text CHECK (motivo_reabertura IS NULL OR length(motivo_reabertura) <= 500)
);
CREATE UNIQUE INDEX IF NOT EXISTS fechamento_comissao_uk ON fechamento_comissao (empresa_id, mes) WHERE reaberto_em IS NULL;

-- Retrato da comissão no fechamento (o cálculo não muda se a regra mudar depois).
CREATE TABLE IF NOT EXISTS comissao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  fechamento_id   uuid NOT NULL REFERENCES fechamento_comissao(id),
  vendedor_id     uuid NOT NULL REFERENCES usuario(id),
  regra_id        uuid REFERENCES regra_comissao(id),
  regra_nome      text NOT NULL,
  vendas          integer NOT NULL,
  base_centavos   bigint NOT NULL,
  percentual      numeric(5, 2) NOT NULL,
  valor_centavos  bigint NOT NULL,
  criado_em       timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comissao_fechamento_idx ON comissao (fechamento_id);

-- Mês de comissão fechado: vendas daquele mês não mudam (trava no banco).
CREATE OR REPLACE FUNCTION bloquear_venda_mes_fechado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM fechamento_comissao f
             WHERE f.empresa_id = NEW.empresa_id AND f.reaberto_em IS NULL
               AND f.mes = date_trunc('month', NEW.data_venda)::date) THEN
    RAISE EXCEPTION 'PERIODO_FECHADO' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM fechamento_comissao f
             WHERE f.empresa_id = OLD.empresa_id AND f.reaberto_em IS NULL
               AND f.mes = date_trunc('month', OLD.data_venda)::date) THEN
    RAISE EXCEPTION 'PERIODO_FECHADO' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS venda_periodo ON venda;
CREATE TRIGGER venda_periodo BEFORE INSERT OR UPDATE ON venda
  FOR EACH ROW EXECUTE FUNCTION bloquear_venda_mes_fechado();

-- Qualidade ----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS criterio_qualidade (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  nome          text NOT NULL CHECK (length(nome) BETWEEN 1 AND 120),
  descricao     text CHECK (descricao IS NULL OR length(descricao) <= 500),
  peso          integer NOT NULL DEFAULT 1 CHECK (peso BETWEEN 1 AND 10),
  ordem         integer NOT NULL DEFAULT 0,
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);

CREATE TABLE IF NOT EXISTS avaliacao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  avaliado_id   uuid NOT NULL REFERENCES usuario(id),
  avaliador_id  uuid NOT NULL REFERENCES usuario(id),
  conversa_id   uuid REFERENCES conversa(id),
  ligacao_id    uuid REFERENCES ligacao(id),
  -- [{ "criterioId", "nome", "peso", "nota" (0 a 10) }]: retrato dos critérios no momento da avaliação.
  notas         jsonb NOT NULL,
  nota_final    numeric(4, 2) NOT NULL CHECK (nota_final BETWEEN 0 AND 10),
  feedback      text CHECK (feedback IS NULL OR length(feedback) <= 2000),
  lida_em       timestamptz(3),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3),
  CHECK ((conversa_id IS NOT NULL) <> (ligacao_id IS NOT NULL)),
  CHECK (avaliado_id <> avaliador_id)
);
CREATE INDEX IF NOT EXISTS avaliacao_avaliado_idx ON avaliacao (empresa_id, avaliado_id, criado_em DESC);

-- Pesquisas ----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pesquisa (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  titulo        text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 160),
  descricao     text CHECK (descricao IS NULL OR length(descricao) <= 1000),
  -- [{ "id", "tipo": "texto" | "escolha" | "nota", "texto", "opcoes"?, "obrigatoria" }]
  perguntas     jsonb NOT NULL,
  -- Link público: /p/<token>. Sem o token ninguém responde nem vê a pesquisa.
  token         text NOT NULL CHECK (token ~ '^[A-Za-z0-9_-]{20,64}$'),
  aberta        boolean NOT NULL DEFAULT true,
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS pesquisa_token_uk ON pesquisa (token);

CREATE TABLE IF NOT EXISTS resposta_pesquisa (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL REFERENCES empresa(id),
  pesquisa_id  uuid NOT NULL REFERENCES pesquisa(id),
  respostas    jsonb NOT NULL,
  criado_em    timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resposta_pesquisa_idx ON resposta_pesquisa (pesquisa_id, criado_em DESC);

-- Row Level Security e permissões ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['oferta', 'entrega', 'entrega_participante', 'venda', 'regra_comissao', 'fechamento_comissao',
                           'comissao', 'criterio_qualidade', 'avaliacao', 'pesquisa', 'resposta_pesquisa'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS isolamento ON %I', t);
    EXECUTE format(
      'CREATE POLICY isolamento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO mg_app', t);
  END LOOP;
END $$;
-- O retrato da comissão e as respostas de pesquisa não se alteram.
REVOKE UPDATE ON comissao FROM mg_app;
REVOKE UPDATE ON resposta_pesquisa FROM mg_app;

-- Critérios iniciais de qualidade para as empresas que ainda não têm (as novas recebem o mesmo ao serem criadas).
DO $$
DECLARE
  e record;
BEGIN
  FOR e IN SELECT id FROM empresa WHERE NOT EXISTS (SELECT 1 FROM criterio_qualidade c WHERE c.empresa_id = empresa.id) LOOP
    INSERT INTO criterio_qualidade (empresa_id, nome, peso, ordem) VALUES
      (e.id, 'Abertura e apresentação', 1, 0),
      (e.id, 'Entendeu a necessidade', 2, 10),
      (e.id, 'Apresentou a solução', 2, 20),
      (e.id, 'Tratou objeções', 2, 30),
      (e.id, 'Próximo passo combinado', 1, 40);
  END LOOP;
END $$;
