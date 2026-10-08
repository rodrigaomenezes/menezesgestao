-- Fase 2 — Conversas. Aditiva e idempotente.
-- Canais (demonstração, API oficial, QR), conversas deduplicadas por telefone e ids externos, mensagens com id
-- externo único por canal (webhook repetido não duplica), respostas rápidas e mensagens automáticas.

-- Canais --------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canal (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES empresa(id),
  nome                  text NOT NULL,
  provedor              text NOT NULL CHECK (provedor IN ('demonstracao', 'cloud_api', 'qr')),
  -- Número conectado (E.164), quando conhecido.
  numero                text CHECK (numero IS NULL OR numero ~ '^\+[1-9][0-9]{7,14}$'),
  -- Id do número no provedor (phone_number_id da API oficial; JID na conexão por QR).
  identificador_externo text,
  -- Credenciais cifradas (AES-256-GCM com CRM_CHAVE). Nunca saem pela API.
  credenciais           text,
  status                text NOT NULL DEFAULT 'desconectado'
                        CHECK (status IN ('desconectado', 'conectando', 'aguardando_qr', 'conectado', 'erro')),
  status_detalhe        text,
  status_em             timestamptz(3) NOT NULL DEFAULT now(),
  -- Horário de atendimento: { "dias": [1..7], "inicio": "08:00", "fim": "18:00" } no fuso da empresa.
  horario               jsonb NOT NULL DEFAULT '{"dias":[1,2,3,4,5],"inicio":"08:00","fim":"18:00"}',
  equipe_id             uuid REFERENCES equipe(id),
  criado_por            uuid REFERENCES usuario(id),
  criado_em             timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em         timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em          timestamptz(3)
);
-- Um número do provedor pertence a um canal só (em qualquer empresa).
CREATE UNIQUE INDEX IF NOT EXISTS canal_externo_uk ON canal (provedor, identificador_externo)
  WHERE identificador_externo IS NOT NULL AND arquivado_em IS NULL;

-- Estado de autenticação da conexão por QR (chaves do protocolo), cifrado item a item.
CREATE TABLE IF NOT EXISTS canal_sessao (
  canal_id     uuid NOT NULL REFERENCES canal(id),
  empresa_id   uuid NOT NULL REFERENCES empresa(id),
  chave        text NOT NULL,
  valor        text NOT NULL,
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (canal_id, chave)
);

-- Conversas -----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversa (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL REFERENCES empresa(id),
  canal_id             uuid NOT NULL REFERENCES canal(id),
  contato_id           uuid REFERENCES contato(id),
  telefone             text CHECK (telefone IS NULL OR telefone ~ '^\+[1-9][0-9]{7,14}$'),
  -- Identificadores do cliente no provedor (wa_id, JID, LID…): a resposta cai aqui mesmo que o canal mude o id.
  ids_externos         text[] NOT NULL DEFAULT '{}',
  atribuida_a          uuid REFERENCES usuario(id),
  equipe_id            uuid REFERENCES equipe(id),
  status               text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta', 'aguardando', 'resolvida')),
  nao_lidas            integer NOT NULL DEFAULT 0 CHECK (nao_lidas >= 0),
  ultima_mensagem_em   timestamptz(3),
  ultima_mensagem      text,
  ultima_entrada_em    timestamptz(3),
  -- Junção de duplicadas: a conversa absorvida aponta para a que ficou (nada é apagado).
  mesclada_em_id       uuid REFERENCES conversa(id),
  criado_em            timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em        timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em         timestamptz(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS conversa_telefone_uk ON conversa (canal_id, telefone)
  WHERE telefone IS NOT NULL AND mesclada_em_id IS NULL;
CREATE INDEX IF NOT EXISTS conversa_ids_externos_idx ON conversa USING gin (ids_externos);
CREATE INDEX IF NOT EXISTS conversa_caixa_idx ON conversa (empresa_id, status, ultima_mensagem_em DESC, id DESC)
  WHERE mesclada_em_id IS NULL;
CREATE INDEX IF NOT EXISTS conversa_atribuida_idx ON conversa (empresa_id, atribuida_a) WHERE mesclada_em_id IS NULL;
CREATE INDEX IF NOT EXISTS conversa_contato_idx ON conversa (contato_id);

-- Mensagens -----------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mensagem (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  conversa_id   uuid NOT NULL REFERENCES conversa(id),
  canal_id      uuid NOT NULL REFERENCES canal(id),
  -- nota = nota interna (o cliente não vê).
  direcao       text NOT NULL CHECK (direcao IN ('entrada', 'saida', 'nota')),
  tipo          text NOT NULL CHECK (tipo IN ('texto', 'imagem', 'audio', 'video', 'documento', 'sistema')),
  texto         text,
  arquivo_id    uuid REFERENCES arquivo(id),
  midia_nome    text,
  midia_mime    text,
  -- Mídia recebida ainda não baixada do provedor (referência do provedor; baixada por job).
  midia_pendente jsonb,
  status        text NOT NULL CHECK (status IN ('pendente', 'enviada', 'entregue', 'lida', 'falhou', 'recebida')),
  erro          text,
  id_externo    text,
  autor_id      uuid REFERENCES usuario(id),
  automacao     text,
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now()
);
-- Webhook repetido nunca duplica: o id do provedor é único por canal.
CREATE UNIQUE INDEX IF NOT EXISTS mensagem_externo_uk ON mensagem (canal_id, id_externo) WHERE id_externo IS NOT NULL;
CREATE INDEX IF NOT EXISTS mensagem_conversa_idx ON mensagem (conversa_id, criado_em DESC, id DESC);

-- Respostas rápidas e mensagens automáticas ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resposta_rapida (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  atalho        text NOT NULL CHECK (atalho ~ '^[a-z0-9][a-z0-9_-]{0,29}$'),
  texto         text NOT NULL,
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now(),
  arquivado_em  timestamptz(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS resposta_rapida_atalho_uk ON resposta_rapida (empresa_id, atalho) WHERE arquivado_em IS NULL;

CREATE TABLE IF NOT EXISTS automacao (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresa(id),
  tipo          text NOT NULL CHECK (tipo IN ('boas_vindas', 'fora_horario', 'follow_up')),
  texto         text NOT NULL,
  -- follow_up: horas sem resposta do cliente até enviar.
  horas         integer CHECK (horas IS NULL OR horas BETWEEN 1 AND 720),
  ativa         boolean NOT NULL DEFAULT true,
  criado_por    uuid REFERENCES usuario(id),
  criado_em     timestamptz(3) NOT NULL DEFAULT now(),
  atualizado_em timestamptz(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS automacao_tipo_uk ON automacao (empresa_id, tipo);

-- Row Level Security e permissões ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['canal', 'canal_sessao', 'conversa', 'mensagem', 'resposta_rapida', 'automacao'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS isolamento ON %I', t);
    EXECUTE format(
      'CREATE POLICY isolamento ON %I USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO mg_app', t);
  END LOOP;
END $$;
-- Chaves do protocolo da conexão por QR são substituídas e removidas pela própria biblioteca.
GRANT DELETE ON canal_sessao TO mg_app;
