ALTER TABLE publication_runtime_manifests
  ADD COLUMN contents jsonb NOT NULL DEFAULT '[]'::jsonb;
