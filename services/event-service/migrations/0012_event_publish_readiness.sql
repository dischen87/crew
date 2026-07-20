ALTER TABLE event_roots
  ADD COLUMN template_id TEXT,
  ADD COLUMN template_version INTEGER,
  ADD CONSTRAINT event_root_template_pair CHECK (
    (template_id IS NULL AND template_version IS NULL) OR
    (
      template_id IS NOT NULL AND
      template_version IS NOT NULL AND
      template_id IN ('travel', 'golf-tour', 'team-event') AND
      template_version = 1
    )
  );
