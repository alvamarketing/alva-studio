CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(320) NOT NULL,
  password_hash text NOT NULL,
  display_name varchar(100) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);
CREATE UNIQUE INDEX users_email_normalized ON users (lower(email));

CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  slug varchar(80) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug),
  UNIQUE (id, slug)
);

CREATE TABLE company_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role varchar(20) NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'analyst')),
  status varchar(20) NOT NULL DEFAULT 'active',
  invited_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id),
  UNIQUE (company_id, id),
  UNIQUE (company_id, user_id, id)
);
CREATE INDEX company_memberships_user_company ON company_memberships (user_id, company_id);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (company_id) REFERENCES companies(id),
  FOREIGN KEY (company_id, user_id, membership_id) REFERENCES company_memberships(company_id, user_id, id)
);
CREATE INDEX sessions_user_active ON sessions (user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  name varchar(100) NOT NULL,
  slug varchar(80) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, slug),
  UNIQUE (company_id, id)
);
CREATE INDEX projects_creator ON projects (company_id, created_by);

CREATE TABLE project_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  path varchar(120) NOT NULL,
  content_type varchar(20) NOT NULL CHECK (content_type IN ('page', 'form')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (company_id, project_id, id),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)
);
CREATE UNIQUE INDEX project_routes_active_path ON project_routes(project_id, lower(path)) WHERE deleted_at IS NULL;

CREATE TABLE project_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  project_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id, project_id),
  FOREIGN KEY (company_id, membership_id) REFERENCES company_memberships(company_id, id),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)
);
CREATE INDEX project_grants_project ON project_grants (company_id, project_id);

CREATE TABLE pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name varchar(100) NOT NULL,
  route_id uuid NOT NULL,
  template varchar(80),
  editor_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  rendered_html text NOT NULL DEFAULT '',
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  published_version_id uuid,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (company_id, id),
  UNIQUE (company_id, project_id, id),
  UNIQUE (route_id),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id),
  FOREIGN KEY (company_id, project_id, route_id) REFERENCES project_routes(company_id, project_id, id)
);
CREATE INDEX pages_project_active ON pages (company_id, project_id) WHERE deleted_at IS NULL;

CREATE TABLE page_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  page_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  editor_state jsonb NOT NULL,
  rendered_html text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, version_number),
  UNIQUE (company_id, id),
  UNIQUE (company_id, project_id, page_id, id),
  FOREIGN KEY (company_id, project_id, page_id) REFERENCES pages(company_id, project_id, id)
);
CREATE INDEX page_versions_page ON page_versions (company_id, page_id, version_number DESC);
ALTER TABLE pages
  ADD CONSTRAINT pages_published_version_company
  FOREIGN KEY (company_id, project_id, id, published_version_id)
  REFERENCES page_versions(company_id, project_id, page_id, id);

CREATE TABLE forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name varchar(100) NOT NULL,
  route_id uuid NOT NULL,
  draft_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  published_version_id uuid,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (company_id, id),
  UNIQUE (company_id, project_id, id),
  UNIQUE (route_id),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id),
  FOREIGN KEY (company_id, project_id, route_id) REFERENCES project_routes(company_id, project_id, id)
);
CREATE INDEX forms_project_active ON forms (company_id, project_id) WHERE deleted_at IS NULL;

CREATE TABLE form_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  form_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  schema jsonb NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (form_id, version_number),
  UNIQUE (company_id, id),
  UNIQUE (company_id, project_id, form_id, id),
  FOREIGN KEY (company_id, project_id, form_id) REFERENCES forms(company_id, project_id, id)
);
CREATE INDEX form_versions_form ON form_versions (company_id, form_id, version_number DESC);
ALTER TABLE forms
  ADD CONSTRAINT forms_published_version_company
  FOREIGN KEY (company_id, project_id, id, published_version_id)
  REFERENCES form_versions(company_id, project_id, form_id, id);

CREATE TABLE form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  form_id uuid NOT NULL,
  form_version_id uuid NOT NULL,
  answers jsonb NOT NULL,
  tracking_event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  tracking_status varchar(20) NOT NULL DEFAULT 'pending',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tracking_event_id),
  FOREIGN KEY (company_id, project_id, form_id) REFERENCES forms(company_id, project_id, id),
  FOREIGN KEY (company_id, project_id, form_id, form_version_id)
    REFERENCES form_versions(company_id, project_id, form_id, id)
);
CREATE INDEX form_submissions_form_date ON form_submissions (company_id, form_id, submitted_at DESC);

CREATE FUNCTION require_active_session_membership() RETURNS trigger AS $$
DECLARE
  membership_status varchar(20);
BEGIN
  SELECT status INTO membership_status
  FROM company_memberships
  WHERE company_id = NEW.company_id AND user_id = NEW.user_id AND id = NEW.membership_id;
  IF membership_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Sessão exige membership ativa.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_require_active_membership
  BEFORE INSERT OR UPDATE OF company_id, user_id, membership_id ON sessions
  FOR EACH ROW EXECUTE FUNCTION require_active_session_membership();

CREATE FUNCTION revoke_sessions_for_inactive_membership() RETURNS trigger AS $$
BEGIN
  IF NEW.status <> 'active' AND OLD.status = 'active' THEN
    UPDATE sessions
    SET revoked_at = COALESCE(revoked_at, now())
    WHERE membership_id = NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER memberships_revoke_sessions_when_inactive
  AFTER UPDATE OF status ON company_memberships
  FOR EACH ROW EXECUTE FUNCTION revoke_sessions_for_inactive_membership();

CREATE FUNCTION require_project_route_type() RETURNS trigger AS $$
DECLARE
  actual_type varchar(20);
  expected_type varchar(20);
BEGIN
  expected_type := CASE TG_TABLE_NAME WHEN 'pages' THEN 'page' ELSE 'form' END;
  SELECT content_type INTO actual_type
  FROM project_routes
  WHERE company_id = NEW.company_id AND project_id = NEW.project_id AND id = NEW.route_id;
  IF actual_type IS DISTINCT FROM expected_type THEN
    RAISE EXCEPTION 'A rota precisa pertencer ao tipo de conteúdo correto.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pages_require_page_route
  BEFORE INSERT OR UPDATE OF company_id, project_id, route_id ON pages
  FOR EACH ROW EXECUTE FUNCTION require_project_route_type();

CREATE TRIGGER forms_require_form_route
  BEFORE INSERT OR UPDATE OF company_id, project_id, route_id ON forms
  FOR EACH ROW EXECUTE FUNCTION require_project_route_type();

CREATE FUNCTION prevent_version_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Versões são imutáveis.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER page_versions_immutable
  BEFORE UPDATE OR DELETE ON page_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_version_mutation();

CREATE TRIGGER form_versions_immutable
  BEFORE UPDATE OR DELETE ON form_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_version_mutation();

CREATE TABLE project_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment varchar(20) NOT NULL CHECK (environment IN ('preview', 'production')),
  domain varchar(253) NOT NULL,
  is_canonical boolean NOT NULL DEFAULT false,
  verification_status varchar(20) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)
);
CREATE UNIQUE INDEX project_domains_unique_domain ON project_domains (lower(domain));
CREATE UNIQUE INDEX project_domains_one_canonical ON project_domains (project_id, environment) WHERE is_canonical;

CREATE TABLE project_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  provider varchar(40) NOT NULL,
  environment varchar(20) NOT NULL CHECK (environment IN ('preview', 'production')),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, provider, environment),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)
);
CREATE INDEX project_integrations_company_project ON project_integrations (company_id, project_id);

CREATE TABLE company_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  provider varchar(40) NOT NULL,
  secret_name varchar(80) NOT NULL,
  encrypted_value text NOT NULL,
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version > 0),
  rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, provider, secret_name, key_version)
);
CREATE INDEX company_secrets_active ON company_secrets (company_id, provider, secret_name, key_version DESC);

CREATE TABLE deployment_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment varchar(20) NOT NULL CHECK (environment IN ('preview', 'production')),
  snapshot_hash char(64) NOT NULL,
  idempotency_key varchar(120) NOT NULL,
  expected_revision integer NOT NULL CHECK (expected_revision >= 0),
  status varchar(20) NOT NULL DEFAULT 'queued',
  external_deployment_id varchar(120),
  external_project_id varchar(120),
  requested_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (project_id, environment, idempotency_key),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)
);
CREATE INDEX deployment_runs_project_status ON deployment_runs (company_id, project_id, status, created_at DESC);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  project_id uuid,
  actor_user_id uuid REFERENCES users(id),
  actor_agent_key_id uuid,
  action varchar(100) NOT NULL,
  resource_type varchar(60) NOT NULL,
  resource_id uuid,
  revision integer,
  result varchar(20) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)
);
CREATE INDEX audit_events_company_created ON audit_events (company_id, created_at DESC);
CREATE INDEX audit_events_project_created ON audit_events (company_id, project_id, created_at DESC);
