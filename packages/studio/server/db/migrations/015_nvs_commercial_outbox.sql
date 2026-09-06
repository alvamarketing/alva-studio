CREATE TABLE nvs_commercial_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  environment varchar(20) NOT NULL CHECK (environment IN ('preview', 'production')),
  property_id varchar(100) NOT NULL,
  tracking_event_id uuid NOT NULL,
  event_name varchar(40) NOT NULL CHECK (event_name IN ('lead', 'initiate_checkout', 'purchase', 'vsl_start', 'vsl_progress', 'vsl_complete', 'vsl_cta_click')),
  destination varchar(40) NOT NULL DEFAULT 'nvs' CHECK (destination = 'nvs'),
  payload jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'retry', 'running', 'delivered', 'dead')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  lease_expires_at timestamptz,
  last_error varchar(240),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, project_id, property_id, tracking_event_id, event_name, destination),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)
);
CREATE INDEX nvs_commercial_outbox_due ON nvs_commercial_outbox (status, next_attempt_at);
CREATE INDEX nvs_commercial_outbox_project ON nvs_commercial_outbox (company_id, project_id, created_at DESC);
