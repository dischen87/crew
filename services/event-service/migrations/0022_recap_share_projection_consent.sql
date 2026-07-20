ALTER TABLE event_recap_share_links
  ADD COLUMN projection_consent TEXT NOT NULL DEFAULT 'legacy-unreviewed';

UPDATE event_recap_share_links
SET revoked_at = GREATEST(clock_timestamp(), created_at),
    revoked_by = created_by
WHERE projection_consent = 'legacy-unreviewed'
  AND revoked_at IS NULL;

ALTER TABLE event_recap_share_links
  ALTER COLUMN projection_consent DROP DEFAULT,
  ADD CONSTRAINT event_recap_share_links_projection_consent
    CHECK (projection_consent IN ('legacy-unreviewed', 'title-only-reviewed'));
