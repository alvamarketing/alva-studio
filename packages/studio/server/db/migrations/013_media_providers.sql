ALTER TABLE videos
  ALTER COLUMN source_type TYPE varchar(20),
  ADD COLUMN provider_video_id varchar(120),
  ADD COLUMN provider_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN storage_key varchar(400),
  ADD COLUMN storage_bytes bigint,
  ADD COLUMN storage_content_type varchar(100),
  ADD COLUMN storage_status varchar(20);

ALTER TABLE videos
  DROP CONSTRAINT videos_source_type_check,
  ADD CONSTRAINT videos_source_type_check CHECK (source_type IN ('mp4', 'hls', 'youtube', 'vimeo', 'panda', 'smartplayer', 'r2', 'r2-hls')),
  ADD CONSTRAINT videos_storage_status_check CHECK (storage_status IS NULL OR storage_status IN ('uploading', 'ready', 'failed')),
  ADD CONSTRAINT videos_media_identity_check CHECK (
    (source_type NOT IN ('youtube', 'vimeo', 'panda', 'smartplayer') OR provider_video_id IS NOT NULL)
    AND (source_type NOT IN ('r2', 'r2-hls') OR storage_key IS NOT NULL)
  );

ALTER TABLE video_versions
  ALTER COLUMN source_type TYPE varchar(20),
  ADD COLUMN provider_video_id varchar(120),
  ADD COLUMN provider_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN storage_key varchar(400),
  ADD COLUMN storage_bytes bigint,
  ADD COLUMN storage_content_type varchar(100),
  ADD COLUMN storage_status varchar(20);

ALTER TABLE video_versions
  DROP CONSTRAINT video_versions_source_type_check,
  ADD CONSTRAINT video_versions_source_type_check CHECK (source_type IN ('mp4', 'hls', 'youtube', 'vimeo', 'panda', 'smartplayer', 'r2', 'r2-hls')),
  ADD CONSTRAINT video_versions_storage_status_check CHECK (storage_status IS NULL OR storage_status IN ('uploading', 'ready', 'failed')),
  ADD CONSTRAINT video_versions_media_identity_check CHECK (
    (source_type NOT IN ('youtube', 'vimeo', 'panda', 'smartplayer') OR provider_video_id IS NOT NULL)
    AND (source_type NOT IN ('r2', 'r2-hls') OR storage_key IS NOT NULL)
  );

UPDATE videos
   SET published_lock_version = lock_version
 WHERE published_version_id IS NOT NULL
   AND published_lock_version IS NULL;
