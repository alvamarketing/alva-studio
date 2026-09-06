CREATE TABLE project_tracking_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment varchar(20) NOT NULL CHECK (environment IN ('preview', 'production')),
  privacy_policy_url varchar(2048) NOT NULL CHECK (privacy_policy_url ~ '^https://[^[:space:]]+$'),
  policy_version varchar(120) NOT NULL CHECK (length(btrim(policy_version)) > 0),
  consent_expiry_days integer NOT NULL DEFAULT 365 CHECK (consent_expiry_days = 365),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, project_id, environment),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)
);
CREATE INDEX project_tracking_policies_project ON project_tracking_policies (company_id, project_id);

CREATE TABLE analytics_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  website_id uuid NOT NULL,
  purpose varchar(30) NOT NULL CHECK (purpose = 'advertising'),
  consent_token_hash char(64) NOT NULL CHECK (consent_token_hash ~ '^[a-f0-9]{64}$'),
  policy_version varchar(120) NOT NULL CHECK (length(btrim(policy_version)) > 0),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  expires_at timestamptz NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > granted_at),
  CHECK (COALESCE(
    jsonb_typeof(evidence) = 'object'
    AND evidence->>'source' = 'banner'
    AND jsonb_typeof(evidence->'publicationId') = 'string'
    AND evidence->>'publicationId' ~ '^[A-Za-z0-9_-]{1,96}$',
    false
  )),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id),
  FOREIGN KEY (company_id, project_id, website_id) REFERENCES analytics_websites(company_id, project_id, id)
);
CREATE UNIQUE INDEX analytics_consents_one_active_token
  ON analytics_consents (website_id, purpose, consent_token_hash)
  WHERE revoked_at IS NULL;
CREATE INDEX analytics_consents_website ON analytics_consents (company_id, project_id, website_id, purpose, expires_at);

CREATE TABLE tracking_proxy_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment varchar(20) NOT NULL CHECK (environment IN ('preview', 'production')),
  tracking_proxy_key_id char(32) NOT NULL CHECK (tracking_proxy_key_id ~ '^[a-f0-9]{32}$'),
  current_secret_name varchar(120) NOT NULL CHECK (length(btrim(current_secret_name)) > 0),
  current_secret_version integer NOT NULL CHECK (current_secret_version > 0),
  previous_secret_name varchar(120),
  previous_secret_version integer CHECK (previous_secret_version > 0),
  previous_secret_expires_at timestamptz,
  vercel_master_env_id varchar(120) NOT NULL,
  vercel_previous_master_env_id varchar(120),
  vercel_key_id_env_id varchar(120) NOT NULL,
  vercel_origin_env_id varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, project_id, environment),
  UNIQUE (tracking_proxy_key_id),
  CHECK ((previous_secret_name IS NULL) = (previous_secret_version IS NULL)),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)
);

ALTER TABLE deployment_runs
  ADD CONSTRAINT deployment_runs_company_project_environment_id_unique UNIQUE (company_id, project_id, environment, id),
  ADD CONSTRAINT deployment_runs_id_snapshot_hash_unique UNIQUE (id, snapshot_hash);

CREATE TABLE publication_build_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id varchar(96) NOT NULL UNIQUE,
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment varchar(20) NOT NULL CHECK (environment IN ('preview', 'production')),
  deployment_run_id uuid,
  state varchar(20) NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'claimed', 'failed', 'expired', 'superseded')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  failed_at timestamptz,
  superseded_at timestamptz,
  UNIQUE (id, deployment_run_id),
  UNIQUE (deployment_run_id),
  CHECK (expires_at > created_at),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id),
  FOREIGN KEY (company_id, project_id, environment, deployment_run_id)
    REFERENCES deployment_runs(company_id, project_id, environment, id)
);
CREATE INDEX publication_build_reservations_cleanup ON publication_build_reservations (expires_at) WHERE state IN ('reserved', 'failed', 'expired');

CREATE TABLE tracking_proxy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES publication_build_reservations(id),
  request_id varchar(120) NOT NULL CHECK (length(btrim(request_id)) > 0),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response_status integer NOT NULL CHECK (response_status BETWEEN 100 AND 599),
  response_body jsonb NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (publication_id, request_id),
  CHECK (expires_at > consumed_at)
);
CREATE INDEX tracking_proxy_requests_cleanup ON tracking_proxy_requests (expires_at);

CREATE TABLE publication_tracking_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid NOT NULL,
  deployment_run_id uuid NOT NULL,
  snapshot_hash char(64) NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
  manifest jsonb NOT NULL,
  tracking_public jsonb NOT NULL,
  asset_versions jsonb NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('ready', 'safe', 'failed')),
  safe_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reservation_id),
  CHECK ((status = 'safe') = (safe_at IS NOT NULL)),
  FOREIGN KEY (reservation_id, deployment_run_id)
    REFERENCES publication_build_reservations(id, deployment_run_id),
  FOREIGN KEY (deployment_run_id, snapshot_hash)
    REFERENCES deployment_runs(id, snapshot_hash)
);
CREATE INDEX publication_tracking_artifacts_rollback
  ON publication_tracking_artifacts (safe_at DESC) WHERE safe_at IS NOT NULL;

CREATE FUNCTION prevent_publication_tracking_artifact_mutation() RETURNS trigger AS $$
BEGIN
  IF NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
     OR NEW.deployment_run_id IS DISTINCT FROM OLD.deployment_run_id
     OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
     OR NEW.manifest IS DISTINCT FROM OLD.manifest
     OR NEW.tracking_public IS DISTINCT FROM OLD.tracking_public
     OR NEW.asset_versions IS DISTINCT FROM OLD.asset_versions THEN
    RAISE EXCEPTION 'artefato de tracking é imutável';
  END IF;
  IF OLD.status = 'safe' THEN
    RAISE EXCEPTION 'artefato de tracking homologado é imutável';
  END IF;
  IF OLD.status <> 'ready' OR NEW.status NOT IN ('safe', 'failed') THEN
    RAISE EXCEPTION 'transição de artefato inválida';
  END IF;
  IF (NEW.status = 'safe') <> (NEW.safe_at IS NOT NULL) THEN
    RAISE EXCEPTION 'homologação do artefato inválida';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER publication_tracking_artifacts_immutable
  BEFORE UPDATE ON publication_tracking_artifacts
  FOR EACH ROW EXECUTE FUNCTION prevent_publication_tracking_artifact_mutation();
