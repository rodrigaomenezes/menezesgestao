-- Fase 4 — Operação: agenda, escala, horas com fechamento, atividades manuais, metas, check-list da rotina e
-- biblioteca de scripts. Aditiva e idempotente. Metas, desempenho e mapa de atividades NÃO têm tabela de números:
-- são calculados da tabela evento (somente inserção) na hora da consulta.

-- Agenda ---------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS compromisso (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresa(id),
  usuario_id       uuid NOT NULL REFERENCES usuario(id),
  contato_id       uuid REFERENCES contato(id),
  titulo           text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 200),
  descricao        text CHECK (descricao IS NULL OR length(descricao) <= 2000),
  local            text CHECK (local IS NULL OR length(local) <= 200),
  inicio           timestamptz(3) NOT NULL,
  fim              timestamptz(3) NOT NULL,
  lembrete_minutos integer CHECK (lembrete_minutos IS NULL OR lembrete_minutos BETWEEN 0 AND 1440),
  criado_por       uuid REFERENCES usuario(id),
  criado_em        timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em    timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em     timestamptz(3),
  CHECK (fim > inicio)
);
CREATE INDEX IF NOT EXISTS compromisso_agenda_idx ON compromisso (empresa_id, usuario_id, inicio) WHERE arquivado_em IS NULL;

-- Escala semanal (horas previstas): vários intervalos por dia. Trocar a escala arquiva a anterior.
CREATE TABLE IF NOT EXISTS escala (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  usuario_id    uuid NOT NULL REFERENCES usuario(id),
  dia_semana    smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  inicio        time NOT NULL,
  fim           time NOT NULL,
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3),
  CHECK (fim > inicio)
);
CREATE INDEX IF NOT EXISTS escala_usuario_idx ON escala (empresa_id, usuario_id) WHERE arquivado_em IS NULL;

-- Registro de horas: "aberto" (ponto batido, sem saída) → pendente → validado/recusado pelo gestor.
CREATE TABLE IF NOT EXISTS registro_horas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  usuario_id    uuid NOT NULL REFERENCES usuario(id),
  -- Dia no fuso da empresa (define o mês do fechamento).
  data          date NOT NULL,
  entrada       timestamptz(3) NOT NULL,
  saida         timestamptz(3),
  observacao    text CHECK (observacao IS NULL OR length(observacao) <= 500),
  status        text NOT NULL DEFAULT 'pendente' CHECK (status IN ('aberto', 'pendente', 'validado', 'recusado')),
  validado_por  uuid REFERENCES usuario(id),
  validado_em   timestamptz(3),
  motivo        text CHECK (motivo IS NULL OR length(motivo) <= 500),
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3),
  CHECK (saida IS NULL OR saida > entrada),
  CHECK (saida IS NULL OR saida - entrada <= interval '24 hours'),
  CHECK ((status = 'aberto') = (saida IS NULL))
);
CREATE INDEX IF NOT EXISTS registro_horas_idx ON registro_horas (empresa_id, usuario_id, data);
-- Um ponto aberto por pessoa.
CREATE UNIQUE INDEX IF NOT EXISTS registro_horas_aberto_uk ON registro_horas (empresa_id, usuario_id)
  WHERE status = 'aberto' AND arquivado_em IS NULL;

-- Fechamento do mês: bloqueia qualquer mudança nos registros daquele mês (trava no banco, não só na tela).
CREATE TABLE IF NOT EXISTS fechamento_horas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL REFERENCES empresa(id),
  mes          date NOT NULL CHECK (extract(day FROM mes) = 1),
  fechado_por  uuid REFERENCES usuario(id),
  fechado_em   timestamptz(3) NOT NULL DEFAULT now(),
  reaberto_por uuid REFERENCES usuario(id),
  reaberto_em  timestamptz(3),
  motivo_reabertura text CHECK (motivo_reabertura IS NULL OR length(motivo_reabertura) <= 500)
);
CREATE UNIQUE INDEX IF NOT EXISTS fechamento_horas_uk ON fechamento_horas (empresa_id, mes) WHERE reaberto_em IS NULL;

CREATE OR REPLACE FUNCTION bloquear_periodo_fechado() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM fechamento_horas f
             WHERE f.empresa_id = NEW.empresa_id AND f.reaberto_em IS NULL
               AND f.mes = date_trunc('month', NEW.data)::date) THEN
    RAISE EXCEPTION 'PERIODO_FECHADO' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM fechamento_horas f
             WHERE f.empresa_id = OLD.empresa_id AND f.reaberto_em IS NULL
               AND f.mes = date_trunc('month', OLD.data)::date) THEN
    RAISE EXCEPTION 'PERIODO_FECHADO' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS registro_horas_periodo ON registro_horas;
CREATE TRIGGER registro_horas_periodo BEFORE INSERT OR UPDATE ON registro_horas
  FOR EACH ROW EXECUTE FUNCTION bloquear_periodo_fechado();

-- Mapa de atividades: o que não passa pelo sistema (reunião, visita, treinamento), lançado e corrigível.
CREATE TABLE IF NOT EXISTS atividade_manual (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  usuario_id    uuid NOT NULL REFERENCES usuario(id),
  tipo          text NOT NULL CHECK (tipo IN ('reuniao', 'treinamento', 'visita', 'atendimento', 'pausa', 'outro')),
  descricao     text CHECK (descricao IS NULL OR length(descricao) <= 300),
  inicio        timestamptz(3) NOT NULL,
  fim           timestamptz(3) NOT NULL,
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3),
  CHECK (fim > inicio),
  CHECK (fim - inicio <= interval '16 hours')
);
CREATE INDEX IF NOT EXISTS atividade_manual_idx ON atividade_manual (empresa_id, usuario_id, inicio) WHERE arquivado_em IS NULL;

-- Metas: alvo (pessoa, equipe ou empresa) × indicador × período, valendo a partir de uma data.
CREATE TABLE IF NOT EXISTS meta (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  alvo          text NOT NULL CHECK (alvo IN ('pessoa', 'equipe', 'empresa')),
  usuario_id    uuid REFERENCES usuario(id),
  equipe_id     uuid REFERENCES equipe(id),
  indicador     text NOT NULL CHECK (length(indicador) BETWEEN 1 AND 60),
  periodo       text NOT NULL CHECK (periodo IN ('dia', 'semana', 'mes')),
  valor         numeric(14, 2) NOT NULL CHECK (valor > 0),
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3),
  CHECK ((alvo = 'pessoa') = (usuario_id IS NOT NULL)),
  CHECK ((alvo = 'equipe') = (equipe_id IS NOT NULL))
);
-- Uma meta ativa por alvo, indicador e período.
CREATE UNIQUE INDEX IF NOT EXISTS meta_alvo_uk ON meta (
  empresa_id, alvo, COALESCE(usuario_id, equipe_id, '00000000-0000-0000-0000-000000000000'::uuid), indicador, periodo
) WHERE arquivado_em IS NULL;

-- Check-list da rotina diária (por perfil ou para todos) e as marcações de cada dia.
CREATE TABLE IF NOT EXISTS checklist_item (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  perfil_id     uuid REFERENCES perfil(id),
  texto         text NOT NULL CHECK (length(texto) BETWEEN 1 AND 200),
  ordem         integer NOT NULL DEFAULT 0,
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);
CREATE TABLE IF NOT EXISTS checklist_marcacao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  item_id       uuid NOT NULL REFERENCES checklist_item(id),
  usuario_id    uuid NOT NULL REFERENCES usuario(id),
  data          date NOT NULL,
  feito         boolean NOT NULL,
  atualizado_em timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS checklist_marcacao_uk ON checklist_marcacao (item_id, usuario_id, data);

-- Biblioteca de scripts: roteiro por funil/etapa (e por oferta, quando o catálogo chegar na fase 5).
CREATE TABLE IF NOT EXISTS script (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  titulo        text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 120),
  texto         text NOT NULL CHECK (length(texto) BETWEEN 1 AND 20000),
  uso           text NOT NULL DEFAULT 'todos' CHECK (uso IN ('todos', 'conversa', 'ligacao')),
  funil_id      uuid REFERENCES funil(id),
  etapa_id      uuid REFERENCES etapa(id),
  ordem         integer NOT NULL DEFAULT 0,
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);
CREATE INDEX IF NOT EXISTS script_etapa_idx ON script (empresa_id, etapa_id) WHERE arquivado_em IS NULL;

-- Indicadores e mapa são contados direto dos eventos: índices por tipo e por quem fez.
CREATE INDEX IF NOT EXISTS evento_tipo_idx ON evento (empresa_id, tipo, criado_em);
CREATE INDEX IF NOT EXISTS evento_ator_idx ON evento (empresa_id, ator_id, criado_em) WHERE ator_id IS NOT NULL;

-- Row Level Security e permissões ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['compromisso', 'escala', 'registro_horas', 'fechamento_horas', 'atividade_manual', 'meta',
                           'checklist_item', 'checklist_marcacao', 'script'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS isolamento ON %I', t);
    EXECUTE format(
      'CREATE POLICY isolamento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO mg_app', t);
  END LOOP;
END $$;
