-- Fase 6 — White-label: domínio próprio, assistente de primeiro acesso, automações "quando/se/então" e cobrança
-- recorrente (atrás de interface, com provedor de demonstração). Aditiva e idempotente.

-- Domínio próprio: um por empresa (comparação sem diferenciar maiúsculas).
CREATE UNIQUE INDEX IF NOT EXISTS empresa_dominio_uk ON empresa (lower(dominio)) WHERE dominio IS NOT NULL;
-- Andamento do assistente de primeiro acesso: { "passo": 1..6, "segmento": "...", "concluidoEm": "..." }.
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS onboarding jsonb NOT NULL DEFAULT '{}';
-- Empresas que já existem não passam pelo assistente.
UPDATE empresa SET onboarding = jsonb_build_object('passo', 6, 'concluidoEm', now()) WHERE onboarding = '{}'::jsonb;

-- Automações configuráveis ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS regra_automacao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  nome          text NOT NULL CHECK (length(nome) BETWEEN 1 AND 120),
  -- Quando: tipo de evento do catálogo (ex.: oportunidade.etapa_alterada).
  gatilho       text NOT NULL CHECK (length(gatilho) BETWEEN 1 AND 60),
  -- Se: [{ "campo", "operador", "valor" }], todas precisam valer.
  condicoes     jsonb NOT NULL DEFAULT '[]',
  -- Então: criar_tarefa | mover_etapa | avisar | enviar_mensagem, com os parâmetros da ação.
  acao          text NOT NULL CHECK (acao IN ('criar_tarefa', 'mover_etapa', 'avisar', 'enviar_mensagem')),
  parametros    jsonb NOT NULL DEFAULT '{}',
  ativa         boolean NOT NULL DEFAULT true,
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);
CREATE INDEX IF NOT EXISTS regra_automacao_gatilho_idx ON regra_automacao (empresa_id, gatilho) WHERE ativa AND arquivado_em IS NULL;

-- Cada regra roda uma vez por evento (a varredura pode passar duas vezes pelo mesmo evento sem repetir a ação).
CREATE TABLE IF NOT EXISTS automacao_execucao (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresa(id),
  regra_id    uuid NOT NULL REFERENCES regra_automacao(id),
  evento_id   uuid NOT NULL,
  status      text NOT NULL CHECK (status IN ('executada', 'ignorada', 'falhou')),
  detalhe     text CHECK (detalhe IS NULL OR length(detalhe) <= 500),
  criado_em   timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS automacao_execucao_uk ON automacao_execucao (regra_id, evento_id);
CREATE INDEX IF NOT EXISTS automacao_execucao_regra_idx ON automacao_execucao (regra_id, criado_em DESC);

-- Cobrança ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS assinatura (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES empresa(id),
  plano             text NOT NULL,
  status            text NOT NULL CHECK (status IN ('teste', 'ativa', 'atrasada', 'cancelada')),
  valor_centavos    bigint NOT NULL CHECK (valor_centavos >= 0),
  provedor          text NOT NULL,
  id_externo        text,
  teste_ate         date,
  proxima_cobranca  date,
  criado_em         timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em     timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS assinatura_empresa_uk ON assinatura (empresa_id);

CREATE TABLE IF NOT EXISTS fatura (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresa(id),
  assinatura_id   uuid NOT NULL REFERENCES assinatura(id),
  plano           text NOT NULL,
  valor_centavos  bigint NOT NULL CHECK (valor_centavos >= 0),
  vencimento      date NOT NULL,
  status          text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'paga', 'vencida', 'cancelada')),
  link            text,
  id_externo      text,
  paga_em         timestamptz(3),
  criado_em       timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em   timestamptz(3) NOT NULL DEFAULT now()
);
-- Uma fatura por vencimento (o job de cobrança pode rodar de novo sem duplicar).
CREATE UNIQUE INDEX IF NOT EXISTS fatura_vencimento_uk ON fatura (assinatura_id, vencimento);

-- Row Level Security e permissões ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['regra_automacao', 'automacao_execucao', 'assinatura', 'fatura'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS isolamento ON %I', t);
    EXECUTE format(
      'CREATE POLICY isolamento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO mg_app', t);
  END LOOP;
END $$;
-- O histórico de execuções não se altera.
REVOKE UPDATE ON automacao_execucao FROM mg_app;
