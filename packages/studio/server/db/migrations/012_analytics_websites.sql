INSERT INTO analytics_websites (company_id, project_id, tracker_public_id, environment)
SELECT project.company_id, project.id, replace(gen_random_uuid()::text, '-', ''), 'production'
  FROM projects project
 WHERE project.status = 'active'
ON CONFLICT (company_id, project_id, environment) DO NOTHING;

CREATE OR REPLACE FUNCTION provision_analytics_website()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  LOOP
    BEGIN
      INSERT INTO analytics_websites (company_id, project_id, tracker_public_id, environment)
      VALUES (NEW.company_id, NEW.id, replace(gen_random_uuid()::text, '-', ''), 'production')
      ON CONFLICT (company_id, project_id, environment) DO NOTHING;
      RETURN NEW;
    EXCEPTION WHEN unique_violation THEN
      -- Colisão do id público global é improvável, mas não pode deixar um projeto sem tracker.
    END;
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS projects_provision_analytics_website ON projects;
CREATE TRIGGER projects_provision_analytics_website
AFTER INSERT OR UPDATE OF status ON projects
FOR EACH ROW EXECUTE FUNCTION provision_analytics_website();
