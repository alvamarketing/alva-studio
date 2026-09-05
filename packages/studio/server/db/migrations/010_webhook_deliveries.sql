CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  form_id uuid NOT NULL,
  submission_id uuid NOT NULL REFERENCES form_submissions(id),
  url text NOT NULL,
  event jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'dead')),
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, project_id, submission_id),
  FOREIGN KEY (company_id, project_id, form_id) REFERENCES forms(company_id, project_id, id)
);
CREATE INDEX webhook_deliveries_due ON webhook_deliveries (status, next_attempt_at) WHERE status = 'pending';
CREATE INDEX webhook_deliveries_project ON webhook_deliveries (company_id, project_id, created_at DESC);

CREATE TABLE webhook_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES webhook_deliveries(id),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  outcome varchar(30) NOT NULL,
  detail text,
  UNIQUE (delivery_id, attempt_number)
);
CREATE INDEX webhook_delivery_attempts_delivery ON webhook_delivery_attempts (delivery_id, attempt_number);
