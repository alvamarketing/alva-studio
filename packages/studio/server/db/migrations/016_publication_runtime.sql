CREATE TABLE publication_runtime_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment varchar(20) NOT NULL CHECK (environment IN ('preview', 'production')),
  publication_id varchar(120) NOT NULL,
  snapshot_hash char(64) NOT NULL,
  version integer NOT NULL CHECK (version >= 0),
  origin varchar(253) NOT NULL,
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  providers jsonb NOT NULL DEFAULT '[]'::jsonb,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, project_id, environment, publication_id),
  UNIQUE (publication_id),
  UNIQUE (company_id, project_id, environment, snapshot_hash),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)
);
CREATE INDEX publication_runtime_active ON publication_runtime_manifests (company_id, project_id, environment, revoked_at);

CREATE TABLE publication_runtime_replays (
  publication_id varchar(120) NOT NULL,
  nonce varchar(160) NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (publication_id, nonce)
);
CREATE INDEX publication_runtime_replays_expiry ON publication_runtime_replays (expires_at);
