CREATE TABLE agent_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  project_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  name varchar(100) NOT NULL,
  prefix varchar(20) NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  scopes text[] NOT NULL CHECK (scopes <@ ARRAY['read', 'drafts']::text[]),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)
);
CREATE INDEX agent_keys_project_active ON agent_keys (company_id, project_id, created_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE agent_key_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id uuid NOT NULL REFERENCES agent_keys(id),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  operation varchar(80) NOT NULL,
  idempotency_key varchar(160) NOT NULL,
  request_hash char(64) NOT NULL,
  resource_type varchar(32),
  resource_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key_id, project_id, operation, idempotency_key),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)
);

CREATE TABLE agent_key_rate_limits (
  key_id uuid NOT NULL REFERENCES agent_keys(id),
  window_started_at timestamptz NOT NULL,
  calls integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  PRIMARY KEY (key_id, window_started_at)
);

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_agent_key_fk FOREIGN KEY (actor_agent_key_id) REFERENCES agent_keys(id);
