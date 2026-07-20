CREATE TABLE event_recap_share_links (
  id TEXT PRIMARY KEY CHECK (id ~ '^rsh_[A-Za-z0-9_-]{24}$'),
  root_event_id TEXT NOT NULL,
  recap_version INTEGER NOT NULL CHECK (recap_version > 0),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  created_by TEXT NOT NULL CHECK (created_by ~ '^usr_[a-f0-9]{32}$'),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT CHECK (
    revoked_by IS NULL OR revoked_by ~ '^usr_[a-f0-9]{32}$'
  ),
  FOREIGN KEY (root_event_id, recap_version)
    REFERENCES event_recap_snapshots(root_event_id, version),
  CHECK (
    expires_at > created_at AND
    expires_at <= created_at + interval '7 days'
  ),
  CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL) OR
    (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoked_at >= created_at)
  )
);

CREATE UNIQUE INDEX event_recap_share_links_one_active_per_root
  ON event_recap_share_links (root_event_id)
  WHERE revoked_at IS NULL;
