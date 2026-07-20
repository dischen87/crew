CREATE TABLE event_feed_entries (
  id TEXT PRIMARY KEY CHECK (id ~ '^fed_[A-Za-z0-9._:-]{1,96}$'),
  root_event_id TEXT NOT NULL REFERENCES event_roots(root_event_id),
  event_id TEXT,
  parent_entry_id TEXT,
  author_user_id TEXT CHECK (author_user_id IS NULL OR author_user_id ~ '^usr_[a-f0-9]{32}$'),
  kind TEXT NOT NULL CHECK (kind IN ('message', 'comment', 'system')),
  payload_schema_version SMALLINT NOT NULL DEFAULT 1 CHECK (payload_schema_version = 1),
  created_root_revision BIGINT NOT NULL CHECK (created_root_revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (root_event_id, id),
  FOREIGN KEY (root_event_id, event_id) REFERENCES events(root_event_id, id),
  FOREIGN KEY (root_event_id, parent_entry_id)
    REFERENCES event_feed_entries(root_event_id, id),
  CHECK ((kind = 'comment') = (parent_entry_id IS NOT NULL)),
  CHECK ((kind = 'system') = (author_user_id IS NULL))
);

CREATE INDEX event_feed_order_idx
  ON event_feed_entries(root_event_id, created_root_revision DESC, id DESC);
CREATE INDEX event_feed_event_order_idx
  ON event_feed_entries(root_event_id, event_id, created_root_revision DESC, id DESC);

CREATE TABLE event_feed_entry_revisions (
  root_event_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  editor_user_id TEXT CHECK (editor_user_id IS NULL OR editor_user_id ~ '^usr_[a-f0-9]{32}$'),
  body TEXT,
  tombstone_reason TEXT CHECK (tombstone_reason IN ('author', 'moderation')),
  root_revision BIGINT NOT NULL CHECK (root_revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (root_event_id, entry_id, version),
  FOREIGN KEY (root_event_id, entry_id)
    REFERENCES event_feed_entries(root_event_id, id),
  CHECK (
    (body IS NOT NULL AND char_length(body) BETWEEN 1 AND 10000 AND tombstone_reason IS NULL) OR
    (body IS NULL AND tombstone_reason IS NOT NULL)
  )
);

CREATE INDEX event_feed_revision_history_idx
  ON event_feed_entry_revisions(root_event_id, entry_id, version DESC);

CREATE TABLE event_feed_entry_current (
  root_event_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  body TEXT,
  root_revision BIGINT NOT NULL CHECK (root_revision > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT CHECK (deleted_by IS NULL OR deleted_by ~ '^usr_[a-f0-9]{32}$'),
  tombstone_reason TEXT CHECK (tombstone_reason IN ('author', 'moderation')),
  PRIMARY KEY (root_event_id, entry_id),
  FOREIGN KEY (root_event_id, entry_id)
    REFERENCES event_feed_entries(root_event_id, id),
  CHECK (
    (deleted_at IS NULL AND body IS NOT NULL AND char_length(body) BETWEEN 1 AND 10000
      AND deleted_by IS NULL AND tombstone_reason IS NULL) OR
    (deleted_at IS NOT NULL AND body IS NULL AND deleted_by IS NOT NULL
      AND tombstone_reason IS NOT NULL)
  )
);

CREATE TABLE event_feed_reactions (
  root_event_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  user_id TEXT NOT NULL CHECK (user_id ~ '^usr_[a-f0-9]{32}$'),
  reaction TEXT NOT NULL CHECK (
    reaction IN ('like', 'love', 'celebrate', 'laugh', 'surprised', 'sad')
  ),
  present BOOLEAN NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  root_revision BIGINT NOT NULL CHECK (root_revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (root_event_id, entry_id, user_id, reaction),
  FOREIGN KEY (root_event_id, entry_id)
    REFERENCES event_feed_entries(root_event_id, id)
);

CREATE INDEX event_feed_reactions_present_idx
  ON event_feed_reactions(root_event_id, entry_id, reaction)
  WHERE present;

CREATE TABLE event_attachment_uploads (
  id TEXT PRIMARY KEY CHECK (id ~ '^upl_[A-Za-z0-9._:-]{1,96}$'),
  attachment_id TEXT NOT NULL CHECK (attachment_id ~ '^att_[A-Za-z0-9._:-]{1,96}$'),
  root_event_id TEXT NOT NULL REFERENCES event_roots(root_event_id),
  target_entry_id TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (created_by ~ '^usr_[a-f0-9]{32}$'),
  quarantine_object_key TEXT NOT NULL UNIQUE CHECK (
    char_length(quarantine_object_key) BETWEEN 1 AND 512
  ),
  content_type TEXT NOT NULL CHECK (
    content_type IN ('image/jpeg', 'image/png', 'image/webp')
  ),
  byte_count INTEGER NOT NULL CHECK (byte_count BETWEEN 1 AND 20971520),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  grant_kid TEXT NOT NULL CHECK (char_length(grant_kid) BETWEEN 1 AND 64),
  grant_ciphertext TEXT NOT NULL CHECK (char_length(grant_ciphertext) BETWEEN 32 AND 16384),
  state TEXT NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared', 'committed', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  committed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (root_event_id, target_entry_id)
    REFERENCES event_feed_entries(root_event_id, id),
  CHECK (expires_at > created_at),
  CHECK ((state = 'committed') = (committed_at IS NOT NULL))
);

CREATE INDEX event_attachment_upload_expiry_idx
  ON event_attachment_uploads(expires_at, id)
  WHERE state = 'prepared';
CREATE INDEX event_attachment_upload_target_idx
  ON event_attachment_uploads(root_event_id, target_entry_id, created_at DESC);

CREATE TABLE event_attachments (
  id TEXT PRIMARY KEY CHECK (id ~ '^att_[A-Za-z0-9._:-]{1,96}$'),
  root_event_id TEXT NOT NULL REFERENCES event_roots(root_event_id),
  target_entry_id TEXT NOT NULL,
  upload_id TEXT NOT NULL UNIQUE REFERENCES event_attachment_uploads(id),
  created_by TEXT NOT NULL CHECK (created_by ~ '^usr_[a-f0-9]{32}$'),
  object_key TEXT NOT NULL UNIQUE CHECK (char_length(object_key) BETWEEN 1 AND 512),
  content_type TEXT NOT NULL CHECK (
    content_type IN ('image/jpeg', 'image/png', 'image/webp')
  ),
  byte_count INTEGER NOT NULL CHECK (byte_count BETWEEN 1 AND 20971520),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  caption TEXT CHECK (caption IS NULL OR char_length(caption) BETWEEN 1 AND 1000),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  root_revision BIGINT NOT NULL CHECK (root_revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (root_event_id, target_entry_id)
    REFERENCES event_feed_entries(root_event_id, id)
);

CREATE INDEX event_attachments_target_idx
  ON event_attachments(root_event_id, target_entry_id, created_at, id);
