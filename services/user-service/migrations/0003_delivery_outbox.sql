CREATE TABLE user_delivery_outbox (
  id TEXT PRIMARY KEY CHECK (id ~ '^job_[a-f0-9]{32}$'),
  magic_link_id TEXT NOT NULL UNIQUE
    REFERENCES user_magic_links(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind = 'magic_link'),
  sealed_payload TEXT NOT NULL
    CHECK (
      sealed_payload ~ '^v1\.[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
      AND octet_length(sealed_payload) <= 4096
    ),
  token_expires_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'processing', 'delivered', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempt_count BETWEEN 0 AND 1000000),
  available_at TIMESTAMPTZ NOT NULL,
  lease_owner TEXT,
  lease_until TIMESTAMPTZ,
  failure_code TEXT CHECK (failure_code ~ '^[a-z0-9_]{1,64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ,
  CHECK (token_expires_at > created_at),
  CHECK (
    (state = 'pending'
      AND lease_owner IS NULL
      AND lease_until IS NULL
      AND delivered_at IS NULL
      AND dead_lettered_at IS NULL)
    OR
    (state = 'processing'
      AND lease_owner IS NOT NULL
      AND lease_until IS NOT NULL
      AND delivered_at IS NULL
      AND dead_lettered_at IS NULL)
    OR
    (state = 'delivered'
      AND lease_owner IS NULL
      AND lease_until IS NULL
      AND delivered_at IS NOT NULL
      AND dead_lettered_at IS NULL)
    OR
    (state = 'dead_letter'
      AND lease_owner IS NULL
      AND lease_until IS NULL
      AND delivered_at IS NULL
      AND dead_lettered_at IS NOT NULL
      AND failure_code IS NOT NULL)
  )
);

CREATE INDEX user_delivery_outbox_due_idx
  ON user_delivery_outbox (available_at, created_at, id)
  WHERE state = 'pending';

CREATE INDEX user_delivery_outbox_expired_lease_idx
  ON user_delivery_outbox (lease_until, id)
  WHERE state = 'processing';

CREATE INDEX user_delivery_outbox_token_expiry_idx
  ON user_delivery_outbox (token_expires_at, id)
  WHERE state IN ('pending', 'processing');
