CREATE TABLE analytics_websites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  tracker_public_id varchar(32) NOT NULL,
  environment varchar(20) NOT NULL DEFAULT 'production',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tracker_public_id),
  UNIQUE (company_id, project_id, environment),
  UNIQUE (company_id, project_id, id),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)
);
CREATE INDEX analytics_websites_project ON analytics_websites (company_id, project_id);

CREATE TABLE analytics_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  website_id uuid NOT NULL,
  visitor_hash varchar(64) NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  hostname varchar(255),
  browser varchar(60),
  os varchar(60),
  device varchar(30),
  screen_size varchar(20),
  language varchar(20),
  country varchar(2),
  region varchar(100),
  city varchar(100),
  referrer_domain varchar(255),
  utm_source varchar(255),
  utm_medium varchar(255),
  utm_campaign varchar(255),
  utm_term varchar(255),
  utm_content varchar(255),
  click_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, project_id, id),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id),
  FOREIGN KEY (company_id, project_id, website_id) REFERENCES analytics_websites(company_id, project_id, id)
);
CREATE INDEX analytics_sessions_website ON analytics_sessions (company_id, project_id, website_id, last_seen_at DESC);

CREATE TABLE analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  website_id uuid NOT NULL,
  session_id uuid,
  event_at timestamptz NOT NULL DEFAULT now(),
  event_type varchar(20) NOT NULL CHECK (event_type IN ('pageview', 'custom')),
  url_path text NOT NULL,
  url_query text,
  referrer text,
  event_name varchar(100),
  tracking_event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, project_id, id),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id),
  FOREIGN KEY (company_id, project_id, website_id) REFERENCES analytics_websites(company_id, project_id, id),
  FOREIGN KEY (company_id, project_id, session_id) REFERENCES analytics_sessions(company_id, project_id, id)
);
CREATE INDEX analytics_events_project ON analytics_events (company_id, project_id, event_at DESC);

CREATE TABLE analytics_event_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  event_id uuid NOT NULL,
  data_key varchar(100) NOT NULL,
  data_value text,
  data_type varchar(20) NOT NULL DEFAULT 'string',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id),
  FOREIGN KEY (company_id, project_id, event_id) REFERENCES analytics_events(company_id, project_id, id)
);
CREATE INDEX analytics_event_data_event ON analytics_event_data (company_id, project_id, event_id);

CREATE TABLE analytics_daily_rollup (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  website_id uuid NOT NULL,
  rollup_date date NOT NULL,
  url_path text NOT NULL DEFAULT '',
  referrer_domain varchar(255) NOT NULL DEFAULT '',
  event_type varchar(20) NOT NULL CHECK (event_type IN ('pageview', 'custom')),
  event_count integer NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, project_id, website_id, rollup_date, url_path, referrer_domain, event_type),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id),
  FOREIGN KEY (company_id, project_id, website_id) REFERENCES analytics_websites(company_id, project_id, id)
);
CREATE INDEX analytics_daily_rollup_project ON analytics_daily_rollup (company_id, project_id, rollup_date DESC);
