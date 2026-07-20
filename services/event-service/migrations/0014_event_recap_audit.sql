CREATE TABLE event_recap_audit_events (
  root_event_id TEXT NOT NULL,
  lifecycle_version INTEGER NOT NULL CHECK (lifecycle_version > 0),
  action TEXT NOT NULL CHECK (action IN ('generate', 'publish', 'remove')),
  recap_version INTEGER NOT NULL CHECK (recap_version > 0),
  actor_id TEXT NOT NULL CHECK (actor_id ~ '^usr_[a-f0-9]{32}$'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (root_event_id, lifecycle_version),
  FOREIGN KEY (root_event_id, recap_version)
    REFERENCES event_recap_snapshots(root_event_id, version),
  CHECK (
    (action = 'generate' AND lifecycle_version >= recap_version) OR
    action IN ('publish', 'remove')
  )
);

CREATE TRIGGER event_recap_audit_events_immutable
  BEFORE UPDATE OR DELETE ON event_recap_audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_event_recap_snapshot_mutation();
