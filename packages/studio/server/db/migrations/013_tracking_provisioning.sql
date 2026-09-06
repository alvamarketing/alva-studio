CREATE TABLE tracking_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment varchar(20) NOT NULL CHECK (environment IN ('preview', 'production')),
  engine varchar(20) NOT NULL CHECK (engine IN ('umami', 'nvs')),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'provisioning', 'ready', 'dead')),
  encrypted_remote_reference text,
  public_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  provision_attempt_count integer NOT NULL DEFAULT 0 CHECK (provision_attempt_count >= 0),
  last_error varchar(240),
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, project_id, environment, engine),
  UNIQUE (company_id, project_id, id),
  UNIQUE (company_id, project_id, environment, id),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)
);
CREATE INDEX tracking_bindings_scope ON tracking_bindings (company_id, project_id, environment, status);

CREATE TABLE tracking_provision_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  binding_id uuid NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'retry', 'succeeded', 'dead')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  lease_expires_at timestamptz,
  last_error varchar(240),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (binding_id),
  FOREIGN KEY (company_id, project_id, binding_id) REFERENCES tracking_bindings(company_id, project_id, id)
);
CREATE INDEX tracking_provision_jobs_due ON tracking_provision_jobs (status, next_attempt_at);

CREATE OR REPLACE FUNCTION enqueue_tracking_provisioning_for_project(project_company_id uuid, target_project_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO tracking_bindings (company_id, project_id, environment, engine)
  SELECT project_company_id, target_project_id, environment, engine
    FROM (VALUES ('preview'::varchar, 'umami'::varchar), ('preview', 'nvs'), ('production', 'umami'), ('production', 'nvs')) AS required(environment, engine)
  ON CONFLICT (company_id, project_id, environment, engine) DO NOTHING;

  INSERT INTO tracking_provision_jobs (company_id, project_id, binding_id)
  SELECT binding.company_id, binding.project_id, binding.id
    FROM tracking_bindings binding
   WHERE binding.company_id = project_company_id AND binding.project_id = target_project_id
  ON CONFLICT (binding_id) DO NOTHING;
END;
$$;

SELECT enqueue_tracking_provisioning_for_project(project.company_id, project.id)
  FROM projects project WHERE project.status = 'active';

CREATE OR REPLACE FUNCTION projects_enqueue_tracking_provisioning()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'active' THEN
    PERFORM enqueue_tracking_provisioning_for_project(NEW.company_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_enqueue_tracking_provisioning ON projects;
CREATE TRIGGER projects_enqueue_tracking_provisioning
AFTER INSERT OR UPDATE OF status ON projects
FOR EACH ROW EXECUTE FUNCTION projects_enqueue_tracking_provisioning();

CREATE TABLE tracking_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment varchar(20) NOT NULL CHECK (environment IN ('preview', 'production')),
  provider varchar(20) NOT NULL CHECK (provider IN ('meta', 'tiktok', 'google', 'linkedin', 'taboola')),
  binding_id uuid NOT NULL,
  encrypted_configuration text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, project_id, environment, provider),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id),
  FOREIGN KEY (company_id, project_id, environment, binding_id) REFERENCES tracking_bindings(company_id, project_id, environment, id)
);
