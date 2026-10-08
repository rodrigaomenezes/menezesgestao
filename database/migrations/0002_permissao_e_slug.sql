-- Fase 0.1 — permissões em tabela própria e identificador (slug) da empresa. Aditiva e idempotente.
-- A coluna perfil.permissoes (JSON) deixa de ser usada pelo código; será removida numa migração futura (ADR-006).

CREATE TABLE IF NOT EXISTS permissao (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresa(id),
  perfil_id  uuid NOT NULL REFERENCES perfil(id),
  modulo     text NOT NULL CHECK (modulo IN (
    'usuarios', 'configuracoes', 'auditoria', 'crm', 'conversas', 'telefonia', 'fila', 'agenda', 'rotina',
    'desempenho', 'mapa', 'scripts', 'qualidade', 'vendas', 'servicos', 'pesquisa')),
  acao       text NOT NULL CHECK (acao IN ('ver', 'criar', 'editar', 'arquivar', 'exportar', 'administrar')),
  escopo     text NOT NULL CHECK (escopo IN ('proprio', 'equipe', 'unidade', 'empresa')),
  criado_em  timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE (perfil_id, modulo, acao)
);
CREATE INDEX IF NOT EXISTS permissao_empresa_idx ON permissao (empresa_id);

-- Copia as permissões que estavam no JSON do perfil (só as válidas).
INSERT INTO permissao (empresa_id, perfil_id, modulo, acao, escopo)
SELECT p.empresa_id, p.id, m.key, a.key, a.value #>> '{}'
  FROM perfil p
  CROSS JOIN LATERAL jsonb_each(p.permissoes) m
  CROSS JOIN LATERAL jsonb_each(m.value) a
 WHERE jsonb_typeof(m.value) = 'object'
   AND m.key IN ('usuarios', 'configuracoes', 'auditoria', 'crm', 'conversas', 'telefonia', 'fila', 'agenda', 'rotina',
                 'desempenho', 'mapa', 'scripts', 'qualidade', 'vendas', 'servicos', 'pesquisa')
   AND a.key IN ('ver', 'criar', 'editar', 'arquivar', 'exportar', 'administrar')
   AND a.value #>> '{}' IN ('proprio', 'equipe', 'unidade', 'empresa')
ON CONFLICT (perfil_id, modulo, acao) DO NOTHING;

ALTER TABLE permissao ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS isolamento ON permissao;
CREATE POLICY isolamento ON permissao USING (empresa_id = app_empresa_id()) WITH CHECK (empresa_id = app_empresa_id());
-- Trocar as permissões de um perfil remove linhas: o antes/depois fica na auditoria (ADR-006).
GRANT SELECT, INSERT, DELETE ON permissao TO mg_app;

-- Slug da empresa: preenchido a partir do nome, único.
ALTER TABLE empresa ADD COLUMN IF NOT EXISTS slug text;

UPDATE empresa e
   SET slug = coalesce(nullif(trim(BOTH '-' FROM left(regexp_replace(lower(translate(e.nome,
       'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
       'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')), '[^a-z0-9]+', '-', 'g'), 40)), ''), 'empresa')
 WHERE e.slug IS NULL;

-- Em caso de nomes iguais, os seguintes ganham um sufixo do próprio id.
UPDATE empresa e
   SET slug = e.slug || '-' || left(e.id::text, 8)
  FROM (SELECT id, row_number() OVER (PARTITION BY slug ORDER BY criado_em, id) AS n FROM empresa) d
 WHERE d.id = e.id AND d.n > 1;

ALTER TABLE empresa ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS empresa_slug_uk ON empresa (slug);
