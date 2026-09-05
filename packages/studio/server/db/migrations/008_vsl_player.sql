CREATE TABLE videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  public_id varchar(32) NOT NULL,
  name varchar(100) NOT NULL,
  source_url text NOT NULL,
  source_type varchar(10) NOT NULL CHECK (source_type IN ('mp4', 'hls')),
  poster_url text,
  captions_url text,
  accent_color varchar(7) NOT NULL DEFAULT '#286eea',
  aspect_ratio varchar(20) NOT NULL DEFAULT '16:9',
  autoplay_muted boolean NOT NULL DEFAULT true,
  resume_enabled boolean NOT NULL DEFAULT true,
  cta_text varchar(200),
  cta_url text,
  cta_seconds integer CHECK (cta_seconds IS NULL OR cta_seconds >= 0),
  milestones jsonb NOT NULL DEFAULT '[]'::jsonb,
  lock_version integer NOT NULL DEFAULT 0 CHECK (lock_version >= 0),
  published_version_id uuid,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (public_id),
  UNIQUE (company_id, id),
  UNIQUE (company_id, project_id, id),
  FOREIGN KEY (company_id, project_id) REFERENCES projects(company_id, id)
);
CREATE INDEX videos_project_active ON videos (company_id, project_id) WHERE deleted_at IS NULL;

CREATE TABLE video_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  project_id uuid NOT NULL,
  video_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  public_id varchar(32) NOT NULL,
  name varchar(100) NOT NULL,
  source_url text NOT NULL,
  source_type varchar(10) NOT NULL CHECK (source_type IN ('mp4', 'hls')),
  poster_url text,
  captions_url text,
  accent_color varchar(7) NOT NULL,
  aspect_ratio varchar(20) NOT NULL,
  autoplay_muted boolean NOT NULL,
  resume_enabled boolean NOT NULL,
  cta_text varchar(200),
  cta_url text,
  cta_seconds integer CHECK (cta_seconds IS NULL OR cta_seconds >= 0),
  milestones jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (video_id, version_number),
  UNIQUE (company_id, id),
  UNIQUE (company_id, project_id, video_id, id),
  FOREIGN KEY (company_id, project_id, video_id) REFERENCES videos(company_id, project_id, id)
);
CREATE INDEX video_versions_video ON video_versions (company_id, video_id, version_number DESC);

ALTER TABLE videos
  ADD CONSTRAINT videos_published_version_company
  FOREIGN KEY (company_id, project_id, id, published_version_id)
  REFERENCES video_versions(company_id, project_id, video_id, id);

CREATE FUNCTION prevent_video_version_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Versões de VSL são imutáveis.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER video_versions_immutable
  BEFORE UPDATE OR DELETE ON video_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_video_version_mutation();
