-- Pendências da fase 8: o catálogo passa a saber a linha do produto (categoria), o estoque e a data de lançamento,
-- para as automações "lançamento compatível" e "alerta de estoque" do método BRE; e a mensagem pode sair como
-- mensagem modelo aprovada na Meta (único jeito de falar com o cliente fora da janela de 24 horas na API oficial).
ALTER TABLE oferta ADD COLUMN IF NOT EXISTS categoria text CHECK (categoria IS NULL OR length(categoria) BETWEEN 1 AND 60);
ALTER TABLE oferta ADD COLUMN IF NOT EXISTS estoque integer CHECK (estoque IS NULL OR estoque >= 0);
ALTER TABLE oferta ADD COLUMN IF NOT EXISTS lancamento_em date;
CREATE INDEX IF NOT EXISTS oferta_categoria_idx ON oferta (empresa_id, lower(categoria)) WHERE categoria IS NOT NULL;

-- Mensagem modelo: { nome, idioma, parametros[] }. O texto da mensagem guarda a prévia já preenchida.
ALTER TABLE mensagem ADD COLUMN IF NOT EXISTS modelo jsonb;

ALTER TABLE bre_automacao DROP CONSTRAINT IF EXISTS bre_automacao_tipo_check;
ALTER TABLE bre_automacao ADD CONSTRAINT bre_automacao_tipo_check CHECK (tipo IN ('POS_VENDA','ANIVERSARIO','REENTRADA','LANCAMENTO','ESTOQUE'));
ALTER TABLE bre_automacao ADD COLUMN IF NOT EXISTS limite_estoque integer CHECK (limite_estoque IS NULL OR limite_estoque BETWEEN 1 AND 100000);
ALTER TABLE bre_automacao DROP CONSTRAINT IF EXISTS bre_automacao_estoque_check;
ALTER TABLE bre_automacao ADD CONSTRAINT bre_automacao_estoque_check CHECK (tipo <> 'ESTOQUE' OR limite_estoque IS NOT NULL);
ALTER TABLE bre_automacao ADD COLUMN IF NOT EXISTS modelo_nome text CHECK (modelo_nome IS NULL OR (modelo_nome ~ '^[a-z0-9_]+$' AND length(modelo_nome) <= 512));
ALTER TABLE bre_automacao ADD COLUMN IF NOT EXISTS modelo_idioma text NOT NULL DEFAULT 'pt_BR' CHECK (modelo_idioma ~ '^[a-z]{2,3}(_[A-Z]{2})?$');
-- Ordem das variáveis no corpo do modelo ({{1}}, {{2}}…): nomes de {nome, vendedor, produto, empresa}.
ALTER TABLE bre_automacao ADD COLUMN IF NOT EXISTS modelo_parametros text[] NOT NULL DEFAULT '{}';
