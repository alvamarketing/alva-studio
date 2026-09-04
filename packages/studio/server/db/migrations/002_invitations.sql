CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  email varchar(320) NOT NULL CHECK (email = lower(email)),
  role varchar(20) NOT NULL CHECK (role IN ('admin', 'editor', 'analyst')),
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  invited_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  FOREIGN KEY (company_id, invited_by) REFERENCES company_memberships(company_id, user_id)
);
CREATE INDEX invitations_company_email ON invitations (company_id, lower(email));
CREATE INDEX invitations_pending_expiration ON invitations (expires_at) WHERE accepted_at IS NULL;
