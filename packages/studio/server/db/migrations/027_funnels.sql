-- Os funis desenhados na aba Funis: por projeto, o desenho (etapas e setas) em jsonb. As
-- etapas que viram página guardam o id da página criada; a página continua sendo uma página
-- comum do projeto, com rota, versão e publicação próprias.
CREATE TABLE funnels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  graph jsonb NOT NULL DEFAULT '{"nos":[],"setas":[]}'::jsonb,
  model_id text,
  lock_version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX funnels_project ON funnels (company_id, project_id, updated_at DESC) WHERE deleted_at IS NULL;
