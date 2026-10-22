-- Empresas de exemplo para apresentar o sistema (tela /demonstracao, só com DEMONSTRACAO_CHAVE no servidor).
-- A marca "demonstracao" isola: só elas aceitam a entrada com um clique; ficam fora do painel e da cobrança.
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS demonstracao boolean NOT NULL DEFAULT false;

-- Pedidos de geração (a fila de jobs gera; a tela acompanha). Só o caminho do sistema lê e grava.
CREATE TABLE IF NOT EXISTS demonstracao (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segmento     text NOT NULL,
  empresa_id   uuid REFERENCES empresa(id),
  status       text NOT NULL DEFAULT 'gerando' CHECK (status IN ('gerando','pronta','falhou','arquivada')),
  erro         text,
  resumo       jsonb NOT NULL DEFAULT '{}',
  criado_em    timestamptz(3) NOT NULL DEFAULT now(),
  concluido_em timestamptz(3)
);
-- Reserva do pedido pelo trabalhador: a fila pode repetir o job, mas só a primeira execução gera a empresa.
ALTER TABLE demonstracao ADD COLUMN IF NOT EXISTS iniciado_em timestamptz(3);
CREATE UNIQUE INDEX IF NOT EXISTS demonstracao_gerando_uk ON demonstracao (segmento) WHERE status = 'gerando';
ALTER TABLE demonstracao ENABLE ROW LEVEL SECURITY;
