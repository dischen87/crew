CREATE TABLE event_feedback (
  id TEXT PRIMARY KEY CHECK (id ~ '^fbk_[A-Za-z0-9._:-]{1,96}$'),
  root_event_id TEXT REFERENCES event_roots(root_event_id),
  event_id TEXT,
  screen_key TEXT CHECK (
    screen_key IS NULL OR screen_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'
  ),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  diagnostics JSONB CHECK (
    diagnostics IS NULL OR
    (jsonb_typeof(diagnostics) = 'object' AND pg_column_size(diagnostics) <= 4096)
  ),
  author_user_id TEXT NOT NULL CHECK (author_user_id ~ '^usr_[a-f0-9]{32}$'),
  status TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('open', 'planned', 'in_progress', 'completed', 'declined', 'duplicate')
  ),
  duplicate_of_feedback_id TEXT REFERENCES event_feedback(id),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (root_event_id, event_id) REFERENCES events(root_event_id, id),
  CHECK (event_id IS NULL OR root_event_id IS NOT NULL),
  CHECK (duplicate_of_feedback_id IS NULL OR duplicate_of_feedback_id <> id),
  CHECK ((status = 'duplicate') = (duplicate_of_feedback_id IS NOT NULL))
);

CREATE INDEX event_feedback_public_order_idx
  ON event_feedback(created_at DESC, id DESC)
  WHERE visibility = 'public';
CREATE INDEX event_feedback_root_order_idx
  ON event_feedback(root_event_id, created_at DESC, id DESC)
  WHERE root_event_id IS NOT NULL;

CREATE UNIQUE INDEX event_feedback_root_identity_idx
  ON event_feedback(root_event_id, id);
CREATE UNIQUE INDEX event_attachment_root_identity_idx
  ON event_attachments(root_event_id, id);

CREATE TABLE event_feedback_attachments (
  feedback_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  ordinal SMALLINT NOT NULL CHECK (ordinal BETWEEN 0 AND 4),
  PRIMARY KEY (feedback_id, attachment_id),
  UNIQUE (feedback_id, ordinal),
  FOREIGN KEY (root_event_id, feedback_id)
    REFERENCES event_feedback(root_event_id, id),
  FOREIGN KEY (root_event_id, attachment_id)
    REFERENCES event_attachments(root_event_id, id)
);

CREATE TABLE event_feedback_status_history (
  feedback_id TEXT NOT NULL REFERENCES event_feedback(id),
  version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 1000),
  from_status TEXT CHECK (
    from_status IS NULL OR
    from_status IN ('open', 'planned', 'in_progress', 'completed', 'declined', 'duplicate')
  ),
  to_status TEXT NOT NULL CHECK (
    to_status IN ('open', 'planned', 'in_progress', 'completed', 'declined', 'duplicate')
  ),
  changed_by TEXT NOT NULL CHECK (changed_by ~ '^usr_[a-f0-9]{32}$'),
  note TEXT CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 1000),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (feedback_id, version),
  CHECK (from_status IS NULL OR from_status <> to_status)
);

CREATE TABLE event_feedback_votes (
  feedback_id TEXT NOT NULL REFERENCES event_feedback(id),
  user_id TEXT NOT NULL CHECK (user_id ~ '^usr_[a-f0-9]{32}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (feedback_id, user_id)
);

CREATE TABLE event_feedback_comments (
  id TEXT PRIMARY KEY CHECK (id ~ '^fbc_[A-Za-z0-9._:-]{1,96}$'),
  feedback_id TEXT NOT NULL REFERENCES event_feedback(id),
  author_user_id TEXT NOT NULL CHECK (author_user_id ~ '^usr_[a-f0-9]{32}$'),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX event_feedback_comments_order_idx
  ON event_feedback_comments(feedback_id, created_at, id);
