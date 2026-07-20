CREATE TABLE user_idempotency_records (
  scope TEXT NOT NULL CHECK (scope <> ''),
  operation_id TEXT NOT NULL CHECK (operation_id ~ '^[a-z][A-Za-z0-9]+$'),
  idempotency_key TEXT NOT NULL
    CHECK (
      length(idempotency_key) BETWEEN 8 AND 128
      AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$'
    ),
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed')),
  response_status SMALLINT CHECK (response_status BETWEEN 200 AND 499),
  response_payload TEXT,
  response_headers JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, operation_id, idempotency_key),
  CHECK (expires_at >= created_at + INTERVAL '30 days'),
  CHECK (
    (state = 'pending'
      AND response_status IS NULL
      AND response_payload IS NULL
      AND response_headers IS NULL
      AND completed_at IS NULL)
    OR
    (state = 'completed'
      AND response_status IS NOT NULL
      AND response_payload IS NOT NULL
      AND response_headers IS NOT NULL
      AND completed_at IS NOT NULL)
  )
);

CREATE INDEX user_idempotency_records_expires_idx
  ON user_idempotency_records (expires_at);
