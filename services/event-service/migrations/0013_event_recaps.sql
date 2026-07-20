CREATE TABLE event_recap_snapshots (
  root_event_id TEXT NOT NULL REFERENCES event_roots(root_event_id),
  version INTEGER NOT NULL CHECK (version > 0),
  source_root_revision BIGINT NOT NULL CHECK (source_root_revision > 0),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  title_source_version INTEGER NOT NULL CHECK (title_source_version > 0),
  title_source_revision BIGINT NOT NULL CHECK (title_source_revision > 0),
  generated_by TEXT NOT NULL CHECK (generated_by ~ '^usr_[a-f0-9]{32}$'),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (root_event_id, version)
);

CREATE TABLE event_recap_items (
  root_event_id TEXT NOT NULL,
  recap_version INTEGER NOT NULL,
  ordinal SMALLINT NOT NULL CHECK (ordinal BETWEEN 0 AND 49),
  source_type TEXT NOT NULL CHECK (source_type IN ('event', 'feedEntry')),
  source_id TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version > 0),
  source_revision BIGINT NOT NULL CHECK (source_revision > 0),
  source_visibility TEXT NOT NULL CHECK (source_visibility = 'members'),
  consent_basis TEXT NOT NULL CHECK (
    consent_basis IN ('event-publication', 'source-author')
  ),
  consented_by_user_id TEXT CHECK (
    consented_by_user_id IS NULL OR
    consented_by_user_id ~ '^usr_[a-f0-9]{32}$'
  ),
  source_title TEXT CHECK (
    source_title IS NULL OR char_length(source_title) BETWEEN 1 AND 160
  ),
  source_body TEXT CHECK (
    source_body IS NULL OR char_length(source_body) BETWEEN 1 AND 5000
  ),
  PRIMARY KEY (root_event_id, recap_version, ordinal),
  FOREIGN KEY (root_event_id, recap_version)
    REFERENCES event_recap_snapshots(root_event_id, version),
  CHECK (source_title IS NOT NULL OR source_body IS NOT NULL),
  CHECK (
    (
      source_type = 'event' AND source_id ~ '^evt_[A-Za-z0-9._:-]{1,96}$' AND
      consent_basis = 'event-publication' AND consented_by_user_id IS NULL
    ) OR (
      source_type = 'feedEntry' AND source_id ~ '^fed_[A-Za-z0-9._:-]{1,96}$' AND
      consent_basis = 'source-author' AND consented_by_user_id IS NOT NULL
    )
  )
);

CREATE TABLE event_recap_heads (
  root_event_id TEXT PRIMARY KEY REFERENCES event_roots(root_event_id),
  latest_version INTEGER NOT NULL CHECK (latest_version > 0),
  published_version INTEGER,
  lifecycle_version INTEGER NOT NULL DEFAULT 1 CHECK (lifecycle_version > 0),
  removed_through_version INTEGER NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  published_by TEXT CHECK (
    published_by IS NULL OR published_by ~ '^usr_[a-f0-9]{32}$'
  ),
  removed_at TIMESTAMPTZ,
  removed_by TEXT CHECK (
    removed_by IS NULL OR removed_by ~ '^usr_[a-f0-9]{32}$'
  ),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (root_event_id, latest_version)
    REFERENCES event_recap_snapshots(root_event_id, version),
  FOREIGN KEY (root_event_id, published_version)
    REFERENCES event_recap_snapshots(root_event_id, version),
  CHECK (removed_through_version BETWEEN 0 AND latest_version),
  CHECK (
    published_version IS NULL OR
    (
      published_version <= latest_version AND
      published_version > removed_through_version
    )
  ),
  CHECK (
    (published_version IS NULL AND published_at IS NULL AND published_by IS NULL) OR
    (published_version IS NOT NULL AND published_at IS NOT NULL AND published_by IS NOT NULL)
  ),
  CHECK (
    (removed_through_version = 0 AND removed_at IS NULL AND removed_by IS NULL) OR
    (removed_through_version > 0 AND removed_at IS NOT NULL AND removed_by IS NOT NULL)
  )
);

CREATE FUNCTION reject_event_recap_snapshot_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'event recap snapshots are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER event_recap_snapshots_immutable
  BEFORE UPDATE OR DELETE ON event_recap_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_event_recap_snapshot_mutation();

CREATE TRIGGER event_recap_items_immutable
  BEFORE UPDATE OR DELETE ON event_recap_items
  FOR EACH ROW EXECUTE FUNCTION reject_event_recap_snapshot_mutation();
