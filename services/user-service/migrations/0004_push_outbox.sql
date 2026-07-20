CREATE TABLE user_push_outbox (
  id TEXT PRIMARY KEY CHECK (id ~ '^pjob_[a-f0-9]{32}$'),
  event_job_id TEXT NOT NULL CHECK (event_job_id ~ '^job_[a-f0-9]{32}$'),
  recipient_user_id TEXT NOT NULL CHECK (recipient_user_id ~ '^usr_[a-f0-9]{32}$'),
  device_id TEXT NOT NULL CHECK (device_id ~ '^dev_[a-f0-9]{32}$'),
  request_id TEXT NOT NULL
    CHECK (request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  causation_request_id TEXT NOT NULL
    CHECK (causation_request_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  sealed_payload TEXT NOT NULL
    CHECK (
      sealed_payload ~ '^v1\.[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
      AND octet_length(sealed_payload) <= 8192
    ),
  expires_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'processing', 'delivered', 'suppressed', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempt_count BETWEEN 0 AND 1000000),
  available_at TIMESTAMPTZ NOT NULL,
  lease_owner TEXT,
  lease_until TIMESTAMPTZ,
  lease_fence BIGINT NOT NULL DEFAULT 0 CHECK (lease_fence >= 0),
  outcome_code TEXT CHECK (outcome_code ~ '^[a-z0-9_]{1,64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ,
  suppressed_at TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ,
  UNIQUE (event_job_id, device_id),
  CHECK (expires_at > created_at),
  CHECK (
    (state = 'pending'
      AND lease_owner IS NULL
      AND lease_until IS NULL
      AND delivered_at IS NULL
      AND suppressed_at IS NULL
      AND dead_lettered_at IS NULL)
    OR
    (state = 'processing'
      AND lease_owner IS NOT NULL
      AND lease_until IS NOT NULL
      AND lease_fence > 0
      AND delivered_at IS NULL
      AND suppressed_at IS NULL
      AND dead_lettered_at IS NULL)
    OR
    (state = 'delivered'
      AND lease_owner IS NULL
      AND lease_until IS NULL
      AND delivered_at IS NOT NULL
      AND suppressed_at IS NULL
      AND dead_lettered_at IS NULL)
    OR
    (state = 'suppressed'
      AND lease_owner IS NULL
      AND lease_until IS NULL
      AND delivered_at IS NULL
      AND suppressed_at IS NOT NULL
      AND dead_lettered_at IS NULL
      AND outcome_code IS NOT NULL)
    OR
    (state = 'dead_letter'
      AND lease_owner IS NULL
      AND lease_until IS NULL
      AND delivered_at IS NULL
      AND suppressed_at IS NULL
      AND dead_lettered_at IS NOT NULL
      AND outcome_code IS NOT NULL)
  )
);

CREATE INDEX user_push_outbox_due_idx
  ON user_push_outbox (available_at, created_at, id)
  WHERE state = 'pending';

CREATE INDEX user_push_outbox_expired_lease_idx
  ON user_push_outbox (lease_until, id)
  WHERE state = 'processing';

CREATE INDEX user_push_outbox_expiry_idx
  ON user_push_outbox (expires_at, id)
  WHERE state IN ('pending', 'processing');
