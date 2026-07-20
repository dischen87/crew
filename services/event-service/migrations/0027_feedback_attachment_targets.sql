ALTER TABLE event_attachment_uploads
  ADD COLUMN target_type TEXT,
  ADD COLUMN target_feedback_id TEXT;

UPDATE event_attachment_uploads SET target_type = 'feed_entry';

ALTER TABLE event_attachment_uploads
  ALTER COLUMN target_entry_id DROP NOT NULL,
  ALTER COLUMN target_type SET DEFAULT 'feed_entry',
  ALTER COLUMN target_type SET NOT NULL,
  ADD CONSTRAINT event_attachment_upload_target_shape CHECK (
    (
      target_type = 'feed_entry'
      AND target_entry_id IS NOT NULL
      AND target_feedback_id IS NULL
    ) OR (
      target_type = 'feedback'
      AND target_entry_id IS NULL
      AND target_feedback_id ~ '^fbk_[A-Za-z0-9._:-]{1,96}$'
    )
  );

ALTER TABLE event_attachments
  ADD COLUMN target_type TEXT,
  ADD COLUMN target_feedback_id TEXT;

UPDATE event_attachments SET target_type = 'feed_entry';

ALTER TABLE event_attachments
  ALTER COLUMN target_entry_id DROP NOT NULL,
  ALTER COLUMN target_type SET DEFAULT 'feed_entry',
  ALTER COLUMN target_type SET NOT NULL,
  ADD CONSTRAINT event_attachment_target_shape CHECK (
    (
      target_type = 'feed_entry'
      AND target_entry_id IS NOT NULL
      AND target_feedback_id IS NULL
    ) OR (
      target_type = 'feedback'
      AND target_entry_id IS NULL
      AND target_feedback_id ~ '^fbk_[A-Za-z0-9._:-]{1,96}$'
    )
  );

CREATE UNIQUE INDEX event_feedback_attachment_live_upload_identity_idx
  ON event_attachment_uploads(attachment_id)
  WHERE target_type = 'feedback' AND state IN ('prepared', 'committed');

CREATE INDEX event_attachment_upload_feedback_target_idx
  ON event_attachment_uploads(
    root_event_id, target_feedback_id, created_by, created_at, id
  )
  WHERE target_type = 'feedback';

CREATE INDEX event_attachment_feedback_target_idx
  ON event_attachments(
    root_event_id, target_feedback_id, created_by, created_at, id
  )
  WHERE target_type = 'feedback';

ALTER TABLE event_attachments
  ADD CONSTRAINT event_attachment_target_identity UNIQUE (
    root_event_id, id, target_type, target_feedback_id
  );

ALTER TABLE event_feedback_attachments
  ADD COLUMN attachment_target_type TEXT NOT NULL DEFAULT 'feed_entry',
  ADD COLUMN attachment_target_feedback_id TEXT,
  ADD CONSTRAINT event_feedback_attachment_target_shape CHECK (
    (
      attachment_target_type = 'feed_entry'
      AND attachment_target_feedback_id IS NULL
    ) OR (
      attachment_target_type = 'feedback'
      AND attachment_target_feedback_id = feedback_id
    )
  ),
  ADD CONSTRAINT event_feedback_attachment_exact_target_fk FOREIGN KEY (
    root_event_id,
    attachment_id,
    attachment_target_type,
    attachment_target_feedback_id
  ) REFERENCES event_attachments(
    root_event_id,
    id,
    target_type,
    target_feedback_id
  );

CREATE UNIQUE INDEX event_feedback_attachment_prebound_single_binding_idx
  ON event_feedback_attachments(root_event_id, attachment_id)
  WHERE attachment_target_type = 'feedback';
