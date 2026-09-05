ALTER TABLE page_versions
  ADD COLUMN published_path varchar(120);

ALTER TABLE form_versions
  ADD COLUMN published_path varchar(120);

ALTER TABLE page_versions
  DISABLE TRIGGER page_versions_immutable;

ALTER TABLE form_versions
  DISABLE TRIGGER form_versions_immutable;

UPDATE page_versions version
SET published_path = route.path
FROM pages page
JOIN project_routes route
  ON route.id = page.route_id
 AND route.company_id = page.company_id
 AND route.project_id = page.project_id
WHERE version.page_id = page.id
  AND version.published_path IS NULL;

UPDATE form_versions version
SET published_path = route.path
FROM forms form
JOIN project_routes route
  ON route.id = form.route_id
 AND route.company_id = form.company_id
 AND route.project_id = form.project_id
WHERE version.form_id = form.id
  AND version.published_path IS NULL;

ALTER TABLE page_versions
  ENABLE TRIGGER page_versions_immutable;

ALTER TABLE form_versions
  ENABLE TRIGGER form_versions_immutable;

CREATE INDEX page_versions_published_path
  ON page_versions (company_id, project_id, lower(published_path));

CREATE INDEX form_versions_published_path
  ON form_versions (company_id, project_id, lower(published_path));
