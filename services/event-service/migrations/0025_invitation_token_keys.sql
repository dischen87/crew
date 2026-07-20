ALTER TABLE event_invitations
  ADD COLUMN token_key_id TEXT;

UPDATE event_invitations
SET token_key_id = 'legacy-invitation-v1'
WHERE token_key_id IS NULL;

ALTER TABLE event_invitations
  ALTER COLUMN token_key_id SET DEFAULT 'legacy-invitation-v1',
  ALTER COLUMN token_key_id SET NOT NULL,
  ADD CONSTRAINT event_invitations_token_key_id_format
    CHECK (token_key_id ~ '^[A-Za-z0-9_-]{1,64}$');
