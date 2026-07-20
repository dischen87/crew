CREATE INDEX user_delivery_outbox_terminal_retention_idx
  ON user_delivery_outbox (
    COALESCE(delivered_at, dead_lettered_at, updated_at), id
  )
  WHERE state IN ('delivered', 'dead_letter');

CREATE INDEX user_push_outbox_terminal_retention_idx
  ON user_push_outbox (
    COALESCE(delivered_at, suppressed_at, dead_lettered_at, updated_at), id
  )
  WHERE state IN ('delivered', 'suppressed', 'dead_letter');
