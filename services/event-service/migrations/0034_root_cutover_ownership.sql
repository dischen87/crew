ALTER TABLE event_roots
  ADD COLUMN ownership_state TEXT NOT NULL DEFAULT 'next',
  ADD COLUMN ownership_revision BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN ownership_actor_id TEXT NOT NULL DEFAULT 'system:migration-0034',
  ADD COLUMN ownership_reason TEXT NOT NULL DEFAULT 'Existing Crew Next root',
  ADD COLUMN ownership_source_release TEXT NOT NULL DEFAULT 'crew-next-pre-ledger',
  ADD COLUMN ownership_target_release TEXT NOT NULL DEFAULT 'crew-next',
  ADD COLUMN ownership_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD CONSTRAINT event_root_ownership_state_check
    CHECK (ownership_state IN ('legacy', 'migration_locked', 'next', 'archived')),
  ADD CONSTRAINT event_root_ownership_revision_check
    CHECK (ownership_revision >= 1),
  ADD CONSTRAINT event_root_ownership_actor_check
    CHECK (char_length(ownership_actor_id) BETWEEN 1 AND 200),
  ADD CONSTRAINT event_root_ownership_reason_check
    CHECK (char_length(ownership_reason) BETWEEN 1 AND 500),
  ADD CONSTRAINT event_root_ownership_source_release_check
    CHECK (char_length(ownership_source_release) BETWEEN 1 AND 200),
  ADD CONSTRAINT event_root_ownership_target_release_check
    CHECK (char_length(ownership_target_release) BETWEEN 1 AND 200);

CREATE TABLE event_root_ownership_audit (
  transition_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  root_event_id TEXT NOT NULL REFERENCES event_roots(root_event_id),
  ownership_revision BIGINT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_release TEXT NOT NULL,
  target_release TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_state IS NULL OR from_state IN ('legacy', 'migration_locked', 'next')),
  CHECK (to_state IN ('legacy', 'migration_locked', 'next', 'archived')),
  CHECK (ownership_revision >= 1),
  CHECK (char_length(actor_id) BETWEEN 1 AND 200),
  CHECK (char_length(reason) BETWEEN 1 AND 500),
  CHECK (char_length(source_release) BETWEEN 1 AND 200),
  CHECK (char_length(target_release) BETWEEN 1 AND 200),
  UNIQUE (root_event_id, ownership_revision)
);

CREATE INDEX event_root_ownership_audit_root_idx
  ON event_root_ownership_audit(root_event_id, transition_id);

INSERT INTO event_root_ownership_audit (
  root_event_id, ownership_revision, from_state, to_state, actor_id, reason,
  source_release, target_release, changed_at
)
SELECT root_event_id, ownership_revision, NULL, ownership_state,
  ownership_actor_id, ownership_reason,
  ownership_source_release, ownership_target_release, ownership_changed_at
FROM event_roots;

CREATE FUNCTION enforce_event_root_ownership_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ownership_state = OLD.ownership_state THEN
    IF (
      NEW.ownership_actor_id,
      NEW.ownership_reason,
      NEW.ownership_source_release,
      NEW.ownership_target_release,
      NEW.ownership_changed_at,
      NEW.ownership_revision
    ) IS DISTINCT FROM (
      OLD.ownership_actor_id,
      OLD.ownership_reason,
      OLD.ownership_source_release,
      OLD.ownership_target_release,
      OLD.ownership_changed_at,
      OLD.ownership_revision
    ) THEN
      RAISE EXCEPTION 'ownership metadata cannot change without a state transition'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.ownership_revision <> OLD.ownership_revision + 1 THEN
    RAISE EXCEPTION 'ownership revision must advance exactly once per transition'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (
    (OLD.ownership_state = 'legacy' AND NEW.ownership_state = 'migration_locked') OR
    (OLD.ownership_state = 'migration_locked' AND NEW.ownership_state = 'legacy') OR
    (OLD.ownership_state = 'migration_locked' AND NEW.ownership_state = 'next') OR
    (OLD.ownership_state = 'next' AND NEW.ownership_state = 'archived')
  ) THEN
    RAISE EXCEPTION 'invalid event root ownership transition'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_root_ownership_transition_guard
  BEFORE UPDATE OF ownership_state, ownership_revision, ownership_actor_id,
    ownership_reason, ownership_source_release, ownership_target_release,
    ownership_changed_at
  ON event_roots
  FOR EACH ROW EXECUTE FUNCTION enforce_event_root_ownership_transition();

CREATE FUNCTION append_event_root_ownership_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.event_root_ownership_audit (
    root_event_id, ownership_revision, from_state, to_state, actor_id, reason,
    source_release, target_release, changed_at
  ) VALUES (
    NEW.root_event_id,
    NEW.ownership_revision,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.ownership_state END,
    NEW.ownership_state,
    NEW.ownership_actor_id,
    NEW.ownership_reason,
    NEW.ownership_source_release,
    NEW.ownership_target_release,
    NEW.ownership_changed_at
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_root_ownership_audit_append
  AFTER INSERT OR UPDATE OF ownership_state ON event_roots
  FOR EACH ROW EXECUTE FUNCTION append_event_root_ownership_audit();

CREATE FUNCTION reject_event_root_ownership_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'event root ownership audit is immutable'
    USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER event_root_ownership_audit_immutable
  BEFORE UPDATE OR DELETE ON event_root_ownership_audit
  FOR EACH ROW EXECUTE FUNCTION reject_event_root_ownership_audit_mutation();
