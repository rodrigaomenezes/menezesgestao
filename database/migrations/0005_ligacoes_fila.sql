-- Fase 3 — Ligações e fila. Aditiva e idempotente.
-- Telefonia (configuração, ramais SIP, ligações e seus estados, gravação cifrada) e filas de discagem ativa
-- (tipos de base, filas, lotes de importação, itens com reserva exclusiva, resultados configuráveis).

-- Configuração da telefonia (uma linha por empresa) -------------------------------------------------------
CREATE TABLE IF NOT EXISTS telefonia_config (
  empresa_id      uuid PRIMARY KEY REFERENCES empresa(id),
  -- SIP/WebRTC: servidor WebSocket seguro (wss://…) e domínio SIP.
  sip_servidor    text CHECK (sip_servidor IS NULL OR sip_servidor ~ '^wss://'),
  sip_dominio     text,
  gravacao_ativa  boolean NOT NULL DEFAULT false,
  aviso_gravacao  text NOT NULL DEFAULT 'Esta ligação pode ser gravada para garantir a qualidade do atendimento.',
  retencao_dias   integer NOT NULL DEFAULT 90 CHECK (retencao_dias BETWEEN 1 AND 3650),
  atualizado_em   timestamptz(3) NOT NULL DEFAULT now()
);

-- Ramal SIP de cada pessoa (senha cifrada com CRM_CHAVE; só a própria pessoa recebe, para o navegador registrar).
CREATE TABLE IF NOT EXISTS ramal (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  usuario_id    uuid NOT NULL REFERENCES usuario(id),
  login         text NOT NULL,
  senha         text NOT NULL,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, usuario_id)
);

-- Resultados de ligação (lista editável com ação associada) -------------------------------------------------
CREATE TABLE IF NOT EXISTS resultado_ligacao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  nome          text NOT NULL,
  -- nenhuma: só registra; reagendar: volta à fila em N horas (ou na data escolhida, se horas vazio);
  -- encerrar: tira da fila; descartar: tira da fila como inválido; converter: cria oportunidade no funil.
  acao          text NOT NULL CHECK (acao IN ('nenhuma', 'reagendar', 'encerrar', 'descartar', 'converter')),
  horas         integer CHECK (horas IS NULL OR horas BETWEEN 1 AND 8760),
  atendida      boolean NOT NULL DEFAULT false,
  ordem         integer NOT NULL DEFAULT 0,
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);

-- Filas --------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tipo_base (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  nome          text NOT NULL,
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);

CREATE TABLE IF NOT EXISTS fila (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresa(id),
  nome             text NOT NULL,
  tipo_base_id     uuid REFERENCES tipo_base(id),
  status           text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa', 'pausada', 'encerrada')),
  -- Conversão: oportunidade nasce neste funil/etapa (vazio = primeira etapa do primeiro funil).
  funil_id         uuid REFERENCES funil(id),
  etapa_id         uuid REFERENCES etapa(id),
  reserva_minutos  integer NOT NULL DEFAULT 15 CHECK (reserva_minutos BETWEEN 1 AND 240),
  max_tentativas   integer NOT NULL DEFAULT 5 CHECK (max_tentativas BETWEEN 1 AND 50),
  criado_por       uuid REFERENCES usuario(id),
  criado_em        timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em    timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em     timestamptz(3)
);

-- Cada importação que alimenta uma fila gera um lote com o relatório.
CREATE TABLE IF NOT EXISTS fila_lote (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresa(id),
  fila_id        uuid NOT NULL REFERENCES fila(id),
  importacao_id  uuid REFERENCES importacao(id),
  novos          integer NOT NULL DEFAULT 0,
  atualizados    integer NOT NULL DEFAULT 0,
  em_outra_fila  integer NOT NULL DEFAULT 0,
  ja_ligados     integer NOT NULL DEFAULT 0,
  ignorados      integer NOT NULL DEFAULT 0,
  criado_em      timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fila_item (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresa(id),
  fila_id             uuid NOT NULL REFERENCES fila(id),
  contato_id          uuid NOT NULL REFERENCES contato(id),
  lote_id             uuid REFERENCES fila_lote(id),
  prioridade          integer NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'reservado', 'concluido', 'descartado')),
  reservado_por       uuid REFERENCES usuario(id),
  reservado_ate       timestamptz(3),
  tentativas          integer NOT NULL DEFAULT 0,
  ultimo_resultado_id uuid REFERENCES resultado_ligacao(id),
  retornar_em         timestamptz(3),
  criado_em           timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em       timestamptz(3) NOT NULL DEFAULT now(),
  -- Reservado tem dono e prazo; os outros estados não.
  CHECK ((status = 'reservado') = (reservado_por IS NOT NULL AND reservado_ate IS NOT NULL))
);
-- O mesmo contato entra uma vez só em cada fila.
CREATE UNIQUE INDEX IF NOT EXISTS fila_item_contato_uk ON fila_item (fila_id, contato_id);
-- Próximo da fila: pendentes (ou reservas vencidas) por prioridade e ordem de chegada.
CREATE INDEX IF NOT EXISTS fila_item_proximo_idx ON fila_item (fila_id, status, retornar_em, prioridade DESC, criado_em);
CREATE INDEX IF NOT EXISTS fila_item_contato_idx ON fila_item (contato_id);

-- Ligações -----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ligacao (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresa(id),
  usuario_id          uuid NOT NULL REFERENCES usuario(id),
  contato_id          uuid REFERENCES contato(id),
  oportunidade_id     uuid REFERENCES oportunidade(id),
  fila_item_id        uuid REFERENCES fila_item(id),
  provedor            text NOT NULL CHECK (provedor IN ('treino', 'celular', 'sip')),
  direcao             text NOT NULL DEFAULT 'saida' CHECK (direcao IN ('saida', 'entrada')),
  numero              text NOT NULL CHECK (numero ~ '^\+[1-9][0-9]{7,14}$'),
  estado              text NOT NULL DEFAULT 'criada'
                      CHECK (estado IN ('criada', 'discando', 'tocando', 'em_ligacao', 'em_espera', 'encerrada')),
  id_externo          text,
  iniciada_em         timestamptz(3) NOT NULL DEFAULT now(),
  atendida_em         timestamptz(3),
  encerrada_em        timestamptz(3),
  duracao_segundos    integer CHECK (duracao_segundos IS NULL OR duracao_segundos >= 0),
  motivo_fim          text,
  resultado_id        uuid REFERENCES resultado_ligacao(id),
  observacao          text,
  gravacao_arquivo_id uuid REFERENCES arquivo(id),
  gravacao_expira_em  timestamptz(3),
  criado_em           timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em       timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ligacao_contato_idx ON ligacao (contato_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS ligacao_usuario_idx ON ligacao (empresa_id, usuario_id, criado_em DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ligacao_externo_uk ON ligacao (empresa_id, provedor, id_externo) WHERE id_externo IS NOT NULL;

-- Linha do tempo de cada ligação (somente inserção).
CREATE TABLE IF NOT EXISTS ligacao_evento (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresa(id),
  ligacao_id  uuid NOT NULL REFERENCES ligacao(id),
  estado      text NOT NULL,
  detalhe     text,
  criado_em   timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ligacao_evento_idx ON ligacao_evento (ligacao_id, criado_em);

-- A importação de contatos pode alimentar (ou criar) uma fila.
ALTER TABLE importacao ADD COLUMN IF NOT EXISTS fila_id uuid REFERENCES fila(id);

-- Row Level Security e permissões ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['telefonia_config', 'ramal', 'resultado_ligacao', 'tipo_base', 'fila', 'fila_lote',
                           'fila_item', 'ligacao', 'ligacao_evento'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS isolamento ON %I', t);
    EXECUTE format(
      'CREATE POLICY isolamento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO mg_app', t);
  END LOOP;
END $$;
-- Linha do tempo da ligação: só inserção.
REVOKE UPDATE ON ligacao_evento FROM mg_app;

-- Listas iniciais para empresas que ainda não têm (as novas recebem o mesmo em criarEmpresa).
DO $$
DECLARE
  e record;
BEGIN
  FOR e IN SELECT id FROM empresa WHERE NOT EXISTS (SELECT 1 FROM resultado_ligacao r WHERE r.empresa_id = empresa.id) LOOP
    INSERT INTO resultado_ligacao (empresa_id, nome, acao, horas, atendida, ordem) VALUES
      (e.id, 'Atendeu — conversa feita', 'encerrar', NULL, true, 0),
      (e.id, 'Não atendeu', 'reagendar', 4, false, 10),
      (e.id, 'Caixa postal', 'reagendar', 24, false, 20),
      (e.id, 'Retornar em…', 'reagendar', NULL, true, 30),
      (e.id, 'Número errado', 'descartar', NULL, false, 40),
      (e.id, 'Sem interesse', 'encerrar', NULL, true, 50),
      (e.id, 'Convertido', 'converter', NULL, true, 60);
  END LOOP;
  FOR e IN SELECT id FROM empresa WHERE NOT EXISTS (SELECT 1 FROM tipo_base t WHERE t.empresa_id = empresa.id) LOOP
    INSERT INTO tipo_base (empresa_id, nome) VALUES (e.id, 'Leads novos'), (e.id, 'Ex-clientes'), (e.id, 'Indicações');
  END LOOP;
END $$;
