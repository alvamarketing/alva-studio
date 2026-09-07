ALTER TABLE page_versions ADD COLUMN capture_schema jsonb NOT NULL DEFAULT '{"forms":[]}'::jsonb;

CREATE TABLE page_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  page_id uuid NOT NULL,
  page_version_id uuid NOT NULL,
  capture_id uuid NOT NULL,
  answers jsonb NOT NULL,
  tracking_event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  tracking_status varchar(20) NOT NULL DEFAULT 'pending',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tracking_event_id),
  UNIQUE (company_id, project_id, page_id, id),
  FOREIGN KEY (company_id, project_id, page_id, page_version_id)
    REFERENCES page_versions(company_id, project_id, page_id, id),
  FOREIGN KEY (company_id, project_id, page_id)
    REFERENCES pages(company_id, project_id, id)
);
CREATE INDEX page_submissions_capture_date ON page_submissions (company_id, project_id, page_id, capture_id, submitted_at DESC);

ALTER TABLE webhook_deliveries
  ADD COLUMN source_kind varchar(10) NOT NULL DEFAULT 'form' CHECK (source_kind IN ('form', 'page')),
  ADD COLUMN page_id uuid,
  ADD COLUMN page_submission_id uuid REFERENCES page_submissions(id);
ALTER TABLE webhook_deliveries ALTER COLUMN form_id DROP NOT NULL;
ALTER TABLE webhook_deliveries ALTER COLUMN submission_id DROP NOT NULL;
ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_source_check CHECK (
    (source_kind = 'form' AND form_id IS NOT NULL AND submission_id IS NOT NULL AND page_id IS NULL AND page_submission_id IS NULL)
    OR (source_kind = 'page' AND form_id IS NULL AND submission_id IS NULL AND page_id IS NOT NULL AND page_submission_id IS NOT NULL)
  );
CREATE UNIQUE INDEX webhook_deliveries_page_submission_unique
  ON webhook_deliveries (company_id, project_id, page_submission_id) WHERE page_submission_id IS NOT NULL;
ALTER TABLE webhook_deliveries
  ADD CONSTRAINT webhook_deliveries_page_submission_scope
  FOREIGN KEY (company_id, project_id, page_id, page_submission_id)
  REFERENCES page_submissions(company_id, project_id, page_id, id);
