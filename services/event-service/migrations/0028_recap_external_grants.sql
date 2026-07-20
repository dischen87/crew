ALTER TABLE event_recap_share_links
  DROP CONSTRAINT event_recap_share_links_projection_consent,
  ADD CONSTRAINT event_recap_share_links_projection_consent CHECK (
    projection_consent IN (
      'legacy-unreviewed',
      'title-only-reviewed',
      'exact-fields-reviewed-v1'
    )
  ),
  ADD COLUMN created_by_membership_version INTEGER,
  ADD CONSTRAINT event_recap_share_links_creator_version CHECK (
    (
      projection_consent = 'exact-fields-reviewed-v1' AND
      created_by_membership_version > 0
    ) OR (
      projection_consent <> 'exact-fields-reviewed-v1' AND
      created_by_membership_version IS NULL
    )
  ),
  ADD CONSTRAINT event_recap_share_links_exact_root_identity
    UNIQUE (id, root_event_id),
  ADD CONSTRAINT event_recap_share_links_exact_identity
    UNIQUE (id, root_event_id, recap_version);

ALTER TABLE event_recap_items
  ADD CONSTRAINT event_recap_items_exact_source_identity
    UNIQUE (
      root_event_id,
      recap_version,
      ordinal,
      source_type,
      source_id,
      source_version
    );

CREATE TABLE event_recap_external_grant_decisions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  root_event_id TEXT NOT NULL,
  recap_version INTEGER NOT NULL CHECK (recap_version > 0),
  recap_ordinal SMALLINT NOT NULL CHECK (recap_ordinal BETWEEN 0 AND 49),
  source_type TEXT NOT NULL CHECK (source_type IN ('event', 'feedEntry')),
  source_id TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version > 0),
  field_name TEXT NOT NULL CHECK (field_name = 'body'),
  authority TEXT NOT NULL CHECK (authority IN ('author', 'manager')),
  decision TEXT NOT NULL CHECK (decision IN ('grant', 'withdraw')),
  actor_id TEXT NOT NULL CHECK (actor_id ~ '^usr_[a-f0-9]{32}$'),
  actor_membership_version INTEGER NOT NULL CHECK (actor_membership_version > 0),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (
    root_event_id,
    recap_version,
    recap_ordinal,
    source_type,
    source_id,
    source_version
  ) REFERENCES event_recap_items (
    root_event_id,
    recap_version,
    ordinal,
    source_type,
    source_id,
    source_version
  ),
  CHECK (
    (
      source_type = 'event' AND
      source_id ~ '^evt_[A-Za-z0-9._:-]{1,96}$' AND
      authority = 'manager'
    ) OR (
      source_type = 'feedEntry' AND
      source_id ~ '^fed_[A-Za-z0-9._:-]{1,96}$'
    )
  )
);

CREATE INDEX event_recap_external_grant_decisions_latest
  ON event_recap_external_grant_decisions (
    root_event_id,
    recap_version,
    source_type,
    source_id,
    source_version,
    field_name,
    authority,
    id DESC
  );

CREATE TRIGGER event_recap_external_grant_decisions_immutable
  BEFORE UPDATE OR DELETE ON event_recap_external_grant_decisions
  FOR EACH ROW EXECUTE FUNCTION reject_event_recap_snapshot_mutation();

CREATE TABLE event_recap_external_share_fields (
  link_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  recap_version INTEGER NOT NULL CHECK (recap_version > 0),
  recap_ordinal SMALLINT NOT NULL CHECK (recap_ordinal BETWEEN 0 AND 49),
  source_type TEXT NOT NULL CHECK (source_type IN ('event', 'feedEntry')),
  source_id TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK (source_version > 0),
  field_name TEXT NOT NULL CHECK (field_name = 'body'),
  PRIMARY KEY (link_id, recap_ordinal, field_name),
  FOREIGN KEY (link_id, root_event_id, recap_version)
    REFERENCES event_recap_share_links (id, root_event_id, recap_version),
  FOREIGN KEY (
    root_event_id,
    recap_version,
    recap_ordinal,
    source_type,
    source_id,
    source_version
  ) REFERENCES event_recap_items (
    root_event_id,
    recap_version,
    ordinal,
    source_type,
    source_id,
    source_version
  ),
  CHECK (
    (source_type = 'event' AND source_id ~ '^evt_[A-Za-z0-9._:-]{1,96}$') OR
    (source_type = 'feedEntry' AND source_id ~ '^fed_[A-Za-z0-9._:-]{1,96}$')
  )
);

CREATE TRIGGER event_recap_external_share_fields_immutable
  BEFORE UPDATE OR DELETE ON event_recap_external_share_fields
  FOR EACH ROW EXECUTE FUNCTION reject_event_recap_snapshot_mutation();

CREATE TABLE event_recap_external_share_audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  root_event_id TEXT NOT NULL,
  link_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'rotate', 'revoke')),
  actor_id TEXT NOT NULL CHECK (actor_id ~ '^usr_[a-f0-9]{32}$'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (link_id, root_event_id)
    REFERENCES event_recap_share_links (id, root_event_id)
);

CREATE TRIGGER event_recap_external_share_audit_events_immutable
  BEFORE UPDATE OR DELETE ON event_recap_external_share_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_event_recap_snapshot_mutation();
