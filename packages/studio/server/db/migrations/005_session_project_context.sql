ALTER TABLE sessions
  ADD COLUMN current_project_id uuid;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_current_project_company
  FOREIGN KEY (company_id, current_project_id)
  REFERENCES projects(company_id, id);

CREATE INDEX sessions_current_project_active
  ON sessions (company_id, current_project_id)
  WHERE revoked_at IS NULL;
