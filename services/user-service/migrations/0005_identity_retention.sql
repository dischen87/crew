CREATE INDEX user_magic_links_retention_expires_idx
  ON user_magic_links (expires_at, id);

CREATE INDEX user_magic_links_retention_consumed_idx
  ON user_magic_links (consumed_at, id)
  WHERE consumed_at IS NOT NULL;

CREATE INDEX user_sessions_retention_expires_idx
  ON user_sessions (expires_at, id);

CREATE INDEX user_sessions_retention_rotated_idx
  ON user_sessions (rotated_at, id)
  WHERE rotated_at IS NOT NULL;

CREATE INDEX user_sessions_retention_revoked_idx
  ON user_sessions (revoked_at, id)
  WHERE revoked_at IS NOT NULL;

CREATE INDEX user_sessions_replaced_by_idx
  ON user_sessions (replaced_by_session_id)
  WHERE replaced_by_session_id IS NOT NULL;

CREATE INDEX user_session_families_retention_idx
  ON user_session_families (COALESCE(revoked_at, created_at), id);
