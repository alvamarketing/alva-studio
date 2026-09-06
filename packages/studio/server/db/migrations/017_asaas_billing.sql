CREATE TABLE billing_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment varchar(20) NOT NULL CHECK (environment IN ('sandbox', 'production')),
  code varchar(80) NOT NULL,
  name varchar(160) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  amount_cents integer CHECK (amount_cents > 0),
  currency char(3) NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  billing_interval varchar(20) NOT NULL DEFAULT 'monthly' CHECK (billing_interval = 'monthly'),
  limits jsonb NOT NULL DEFAULT '{"projects":5,"members":10,"domains":5}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, code),
  CHECK ((status <> 'active') OR amount_cents IS NOT NULL),
  CHECK ((limits ? 'projects') AND (limits ? 'members') AND (limits ? 'domains'))
);

CREATE TABLE billing_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  environment varchar(20) NOT NULL CHECK (environment IN ('sandbox', 'production')),
  provider varchar(20) NOT NULL DEFAULT 'asaas' CHECK (provider = 'asaas'),
  external_customer_id varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, environment),
  UNIQUE (environment, provider, external_customer_id)
);

CREATE TABLE payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  environment varchar(20) NOT NULL CHECK (environment IN ('sandbox', 'production')),
  plan_id uuid NOT NULL REFERENCES billing_plans(id),
  plan_code varchar(80) NOT NULL,
  plan_name varchar(160) NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL CHECK (currency = 'BRL'),
  billing_interval varchar(20) NOT NULL CHECK (billing_interval = 'monthly'),
  limits jsonb NOT NULL,
  idempotency_key varchar(120) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'creating' CHECK (status IN ('creating', 'submitting', 'pending', 'paid', 'failed', 'cancelled', 'expired', 'review')),
  external_reference uuid NOT NULL UNIQUE,
  checkout_id varchar(120),
  checkout_url text,
  external_subscription_id varchar(120),
  expires_at timestamptz,
  cancel_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, environment, idempotency_key),
  UNIQUE (environment, checkout_id),
  UNIQUE (environment, external_subscription_id)
);
CREATE INDEX payment_orders_company_environment ON payment_orders (company_id, environment, created_at DESC);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  environment varchar(20) NOT NULL CHECK (environment IN ('sandbox', 'production')),
  plan_id uuid NOT NULL REFERENCES billing_plans(id),
  payment_order_id uuid NOT NULL REFERENCES payment_orders(id),
  external_subscription_id varchar(120) NOT NULL,
  status varchar(30) NOT NULL CHECK (status IN ('active', 'cancel_at_period_end', 'cancelled', 'past_due', 'review')),
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, external_subscription_id),
  UNIQUE (company_id, environment)
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  environment varchar(20) NOT NULL CHECK (environment IN ('sandbox', 'production')),
  payment_order_id uuid NOT NULL REFERENCES payment_orders(id),
  provider varchar(20) NOT NULL DEFAULT 'asaas' CHECK (provider = 'asaas'),
  provider_payment_id varchar(120) NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL CHECK (currency = 'BRL'),
  provider_status varchar(60) NOT NULL,
  due_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, provider, provider_payment_id)
);

CREATE TABLE entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  environment varchar(20) NOT NULL CHECK (environment IN ('sandbox', 'production')),
  plan_id uuid REFERENCES billing_plans(id),
  status varchar(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'cancel_at_period_end', 'cancelled', 'review')),
  limits jsonb NOT NULL DEFAULT '{"projects":5,"members":10,"domains":5}'::jsonb,
  current_period_end timestamptz,
  source_payment_id uuid REFERENCES payments(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, environment)
);

CREATE TABLE billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment varchar(20) NOT NULL CHECK (environment IN ('sandbox', 'production')),
  provider varchar(20) NOT NULL DEFAULT 'asaas',
  provider_event_id varchar(120) NOT NULL,
  payload_hash char(64) NOT NULL,
  event_type varchar(100) NOT NULL,
  provider_payment_id varchar(120),
  provider_subscription_id varchar(120),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'retry', 'review', 'dead')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claim_token uuid,
  lease_expires_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error varchar(240),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (environment, provider, provider_event_id)
);
CREATE INDEX billing_events_due ON billing_events (status, available_at, received_at);

CREATE TABLE billing_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment varchar(20) NOT NULL CHECK (environment IN ('sandbox', 'production')),
  provider_payment_id varchar(120),
  payment_order_id uuid REFERENCES payment_orders(id),
  reason varchar(100) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, provider_payment_id, reason)
);

INSERT INTO billing_plans (environment, code, name, status, amount_cents, currency, billing_interval, limits)
VALUES
  ('sandbox', 'professional-v1', 'Alva Studio Profissional', 'active', 4900, 'BRL', 'monthly', '{"projects":5,"members":10,"domains":5}'::jsonb),
  ('production', 'professional-v1', 'Alva Studio Profissional', 'draft', 4900, 'BRL', 'monthly', '{"projects":5,"members":10,"domains":5}'::jsonb)
ON CONFLICT (environment, code) DO NOTHING;
