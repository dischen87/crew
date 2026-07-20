ALTER TABLE event_recap_items
  ADD COLUMN consent_membership_version INTEGER;

DROP TRIGGER event_recap_items_immutable ON event_recap_items;

UPDATE event_recap_items
SET consent_membership_version = 0
WHERE source_type = 'feedEntry';

ALTER TABLE event_recap_items
  ADD CONSTRAINT event_recap_items_consent_membership_version_check CHECK (
    (source_type = 'event' AND consent_membership_version IS NULL) OR
    (
      source_type = 'feedEntry' AND
      consent_membership_version IS NOT NULL AND
      consent_membership_version >= 0
    )
  );

CREATE FUNCTION guard_event_recap_item_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (
      SELECT 1 FROM event_recap_heads
      WHERE root_event_id = NEW.root_event_id
        AND latest_version >= NEW.recap_version
    ) THEN
      RAISE EXCEPTION 'finalized event recap items are immutable'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'event recap items are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER event_recap_items_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON event_recap_items
  FOR EACH ROW EXECUTE FUNCTION guard_event_recap_item_mutation();
