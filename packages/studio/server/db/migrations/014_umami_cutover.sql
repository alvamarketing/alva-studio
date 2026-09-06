ALTER TABLE analytics_websites ADD COLUMN cutover_at timestamptz;

INSERT INTO analytics_websites (company_id, project_id, tracker_public_id, environment)
SELECT project.company_id, project.id, replace(gen_random_uuid()::text, '-', ''), 'preview'
  FROM projects project WHERE project.status = 'active'
ON CONFLICT (company_id, project_id, environment) DO NOTHING;

CREATE OR REPLACE FUNCTION provision_analytics_website()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_environment varchar(20);
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  FOREACH target_environment IN ARRAY ARRAY['preview'::varchar, 'production'::varchar] LOOP
    LOOP
      BEGIN
        INSERT INTO analytics_websites (company_id, project_id, tracker_public_id, environment)
        VALUES (NEW.company_id, NEW.id, replace(gen_random_uuid()::text, '-', ''), target_environment)
        ON CONFLICT (company_id, project_id, environment) DO NOTHING;
        EXIT;
      EXCEPTION WHEN unique_violation THEN END;
    END LOOP;
  END LOOP;
  RETURN NEW;
END;
$$;
