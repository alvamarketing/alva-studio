-- Um quiz passa a ser uma página com uma marca, em vez de um tipo de conteúdo separado
-- com editor próprio. O padrão 'page' preserva tudo o que já existe.
ALTER TABLE pages ADD COLUMN kind varchar(20) NOT NULL DEFAULT 'page'
  CHECK (kind IN ('page', 'quiz'));
CREATE INDEX pages_project_kind ON pages (company_id, project_id, kind) WHERE deleted_at IS NULL;
