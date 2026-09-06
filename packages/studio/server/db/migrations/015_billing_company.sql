CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(80) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  currency char(3) NOT NULL CHECK (currency = 'BRL'),
  price_cents integer NOT NULL CHECK (price_cents > 0),
  interval varchar(20) NOT NULL CHECK (interval = 'monthly'),
  project_limit integer NOT NULL CHECK (project_limit > 0),
  member_limit integer NOT NULL CHECK (member_limit > 0),
  published_domain_limit integer NOT NULL CHECK (published_domain_limit > 0),
  status varchar(20) NOT NULL CHECK (status IN ('draft', 'active')),
  created_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz
);

INSERT INTO plans (code, name, currency, price_cents, interval, project_limit, member_limit, published_domain_limit, status)
VALUES ('studio-essential-v1', 'Alva Studio Essencial', 'BRL', 9900, 'monthly', 5, 10, 5, 'draft');

CREATE TABLE billing_activation (
  environment varchar(20) PRIMARY KEY CHECK (environment IN ('sandbox', 'production')),
  enforcement_enabled boolean NOT NULL DEFAULT false,
  plan_code varchar(80) REFERENCES plans(code),
  approved_price_cents integer CHECK (approved_price_cents > 0),
  approved_by_user_id uuid REFERENCES users(id),
  approved_at timestamptz,
  checklist_completed_at timestamptz,
  grace_days integer CHECK (grace_days >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE billing_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  provider varchar(20) NOT NULL DEFAULT 'asaas' CHECK (provider = 'asaas'),
  provider_customer_id varchar(160),
  environment varchar(20) NOT NULL CHECK (environment IN ('sandbox', 'production')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, environment),
  UNIQUE (company_id, environment, id)
);
CREATE UNIQUE INDEX billing_accounts_provider_customer_environment
  ON billing_accounts (environment, provider_customer_id) WHERE provider_customer_id IS NOT NULL;

CREATE TABLE payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  requested_by_user_id uuid NOT NULL,
  plan_id uuid NOT NULL REFERENCES plans(id),
  plan_code varchar(80) NOT NULL,
  plan_name varchar(120) NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL CHECK (currency = 'BRL'),
  interval varchar(20) NOT NULL CHECK (interval = 'monthly'),
  limits jsonb NOT NULL,
  environment varchar(20) NOT NULL CHECK (environment IN ('sandbox', 'production')),
  external_reference varchar(180) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'creating' CHECK (status IN ('creating', 'submitting', 'pending', 'paid', 'failed', 'cancelled', 'expired', 'review_required')),
  provider_checkout_id varchar(160),
  checkout_url text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, external_reference),
  UNIQUE (company_id, id),
  UNIQUE (company_id, environment, id),
  UNIQUE (environment, id),
  FOREIGN KEY (company_id, requested_by_user_id) REFERENCES company_memberships(company_id, user_id),
  CONSTRAINT payment_orders_external_reference_format CHECK (external_reference = 'alva-studio:' || environment || ':' || id::text)
);
CREATE UNIQUE INDEX payment_orders_open_company_environment
  ON payment_orders (company_id, environment) WHERE status IN ('creating', 'submitting', 'pending');
CREATE UNIQUE INDEX payment_orders_checkout_environment
  ON payment_orders (environment, provider_checkout_id) WHERE provider_checkout_id IS NOT NULL;

CREATE OR REPLACE FUNCTION payment_orders_keep_external_reference()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.external_reference IS DISTINCT FROM OLD.external_reference THEN
    RAISE EXCEPTION 'Referência externa do pedido é imutável.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_orders_keep_external_reference
  BEFORE UPDATE OF external_reference ON payment_orders
  FOR EACH ROW EXECUTE FUNCTION payment_orders_keep_external_reference();

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  plan_id uuid NOT NULL REFERENCES plans(id),
  plan_code varchar(80) NOT NULL,
  plan_name varchar(120) NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL CHECK (currency = 'BRL'),
  interval varchar(20) NOT NULL CHECK (interval = 'monthly'),
  limits jsonb NOT NULL,
  provider_subscription_id varchar(160),
  environment varchar(20) NOT NULL CHECK (environment IN ('sandbox', 'production')),
  status varchar(30) NOT NULL CHECK (status IN ('pending_checkout', 'active', 'past_due', 'cancel_at_period_end', 'canceled', 'suspended')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_until timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at timestamptz,
  last_payment_id varchar(160),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, id),
  UNIQUE (company_id, environment, id),
  UNIQUE (environment, id),
  CONSTRAINT subscriptions_grace_until_past_due CHECK ((status = 'past_due') OR grace_until IS NULL)
);
CREATE UNIQUE INDEX subscriptions_provider_environment
  ON subscriptions (environment, provider_subscription_id) WHERE provider_subscription_id IS NOT NULL;
CREATE UNIQUE INDEX subscriptions_open_company_environment
  ON subscriptions (company_id, environment) WHERE status IN ('pending_checkout', 'active', 'past_due', 'cancel_at_period_end');

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  subscription_id uuid NOT NULL,
  order_id uuid NOT NULL,
  provider varchar(20) NOT NULL DEFAULT 'asaas' CHECK (provider = 'asaas'),
  provider_payment_id varchar(160) NOT NULL,
  provider_status varchar(40) NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency char(3) NOT NULL CHECK (currency = 'BRL'),
  paid_at timestamptz,
  due_date date,
  environment varchar(20) NOT NULL CHECK (environment IN ('sandbox', 'production')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, provider_payment_id),
  FOREIGN KEY (company_id, environment, subscription_id) REFERENCES subscriptions(company_id, environment, id),
  FOREIGN KEY (company_id, environment, order_id) REFERENCES payment_orders(company_id, environment, id)
);

CREATE TABLE billing_webhook_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment varchar(20) NOT NULL CHECK (environment IN ('sandbox', 'production')),
  provider_event_id varchar(160) NOT NULL,
  event_type varchar(80) NOT NULL,
  provider_payment_id varchar(160),
  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  status varchar(20) NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processing', 'processed', 'review_required', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  processed_at timestamptz,
  error_code varchar(80),
  UNIQUE (environment, provider_event_id),
  UNIQUE (environment, id)
);

CREATE TABLE billing_reconciliation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment varchar(20) NOT NULL CHECK (environment IN ('sandbox', 'production')),
  target_type varchar(30) NOT NULL CHECK (target_type IN ('order', 'inbox_event', 'subscription', 'orphaned_event')),
  order_id uuid,
  inbox_event_id uuid,
  subscription_id uuid,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'review_required', 'dead_letter', 'completed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  lease_expires_at timestamptz,
  last_error varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (environment, order_id) REFERENCES payment_orders(environment, id),
  FOREIGN KEY (environment, inbox_event_id) REFERENCES billing_webhook_inbox(environment, id),
  FOREIGN KEY (environment, subscription_id) REFERENCES subscriptions(environment, id),
  CONSTRAINT billing_reconciliation_jobs_target CHECK (
    (target_type = 'order' AND order_id IS NOT NULL AND inbox_event_id IS NULL AND subscription_id IS NULL)
    OR (target_type IN ('inbox_event', 'orphaned_event') AND order_id IS NULL AND inbox_event_id IS NOT NULL AND subscription_id IS NULL)
    OR (target_type = 'subscription' AND order_id IS NULL AND inbox_event_id IS NULL AND subscription_id IS NOT NULL)
  )
);
CREATE INDEX billing_reconciliation_jobs_due
  ON billing_reconciliation_jobs (next_attempt_at) WHERE status = 'pending';
CREATE UNIQUE INDEX billing_reconciliation_jobs_active_target
  ON billing_reconciliation_jobs (environment, target_type, (COALESCE(order_id, inbox_event_id, subscription_id)))
  WHERE status IN ('pending', 'processing');
CREATE UNIQUE INDEX billing_reconciliation_jobs_inbox_event_once
  ON billing_reconciliation_jobs (environment, inbox_event_id)
  WHERE target_type = 'inbox_event';

CREATE TABLE entitlements (
  company_id uuid NOT NULL REFERENCES companies(id),
  environment varchar(20) NOT NULL CHECK (environment IN ('sandbox', 'production')),
  subscription_id uuid,
  access_state varchar(20) NOT NULL CHECK (access_state IN ('active', 'read_only')),
  plan_code varchar(80),
  limits jsonb,
  effective_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, environment),
  FOREIGN KEY (company_id, environment, subscription_id) REFERENCES subscriptions(company_id, environment, id)
);
