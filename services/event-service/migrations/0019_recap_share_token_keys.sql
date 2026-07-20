ALTER TABLE event_recap_share_links
  ADD COLUMN token_key_id TEXT;

UPDATE event_recap_share_links
SET token_key_id = 'legacy-invitation-v1'
WHERE token_key_id IS NULL;

ALTER TABLE event_recap_share_links
  ALTER COLUMN token_key_id SET NOT NULL,
  ADD CONSTRAINT event_recap_share_links_token_key_id_format
    CHECK (token_key_id ~ '^[A-Za-z0-9_-]{1,64}$');
