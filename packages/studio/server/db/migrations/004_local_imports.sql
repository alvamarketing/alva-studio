CREATE TABLE local_imports (
  checksum char(64) PRIMARY KEY,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  report jsonb NOT NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)
);

CREATE INDEX local_imports_company_imported
  ON local_imports (company_id, imported_at DESC);
