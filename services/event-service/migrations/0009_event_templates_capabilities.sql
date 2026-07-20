CREATE FUNCTION event_capability_config_is_valid(
  target_type TEXT,
  target_config JSONB
) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(
    jsonb_typeof(target_config) = 'object' AND
    CASE target_type
      WHEN 'travel' THEN
        (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(target_config) AS keys(key))
          = ARRAY['homePlaceId', 'travelerReferenceLabel']::TEXT[]
        AND (
          target_config->'homePlaceId' = 'null'::jsonb OR
          target_config->>'homePlaceId' ~ '^plc_[A-Za-z0-9._:-]{1,96}$'
        )
        AND (
          target_config->'travelerReferenceLabel' = 'null'::jsonb OR
          (
            jsonb_typeof(target_config->'travelerReferenceLabel') = 'string' AND
            char_length(target_config->>'travelerReferenceLabel') BETWEEN 1 AND 120 AND
            target_config->>'travelerReferenceLabel' !~ '^[[:space:]]' AND
            target_config->>'travelerReferenceLabel' !~ '[[:space:]]$'
          )
        )
      WHEN 'lodging' THEN
        (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(target_config) AS keys(key))
          = ARRAY['checkInPolicy', 'checkOutPolicy', 'propertyPlaceId', 'roomAssignmentMode']::TEXT[]
        AND (
          target_config->'propertyPlaceId' = 'null'::jsonb OR
          target_config->>'propertyPlaceId' ~ '^plc_[A-Za-z0-9._:-]{1,96}$'
        )
        AND target_config->>'checkInPolicy' IN ('fixed', 'flexible')
        AND target_config->>'checkOutPolicy' IN ('fixed', 'flexible')
        AND target_config->>'roomAssignmentMode' IN ('organizer', 'self_service')
      WHEN 'transport' THEN
        (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(target_config) AS keys(key))
          = ARRAY['meetingPlaceId', 'participantMode']::TEXT[]
        AND (
          target_config->'meetingPlaceId' = 'null'::jsonb OR
          target_config->>'meetingPlaceId' ~ '^plc_[A-Za-z0-9._:-]{1,96}$'
        )
        AND target_config->>'participantMode' IN ('self_arranged', 'shared', 'mixed')
      WHEN 'golf' THEN
        (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(target_config) AS keys(key))
          = ARRAY['coursePlaceId', 'handicapMode', 'roundState', 'scoringMode', 'teeFormat']::TEXT[]
        AND (
          target_config->'coursePlaceId' = 'null'::jsonb OR
          target_config->>'coursePlaceId' ~ '^plc_[A-Za-z0-9._:-]{1,96}$'
        )
        AND target_config->>'teeFormat' IN ('individual', 'pairs', 'fourball')
        AND target_config->>'handicapMode' IN ('none', 'optional', 'required')
        AND target_config->>'scoringMode' IN ('none', 'stroke_play', 'stableford')
        AND target_config->>'roundState' IN ('planned', 'open', 'closed')
      WHEN 'team' THEN
        (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(target_config) AS keys(key))
          = ARRAY['assignmentMode', 'capacityPerTeam', 'facilitator', 'venuePlaceId']::TEXT[]
        AND (
          target_config->'venuePlaceId' = 'null'::jsonb OR
          target_config->>'venuePlaceId' ~ '^plc_[A-Za-z0-9._:-]{1,96}$'
        )
        AND target_config->>'assignmentMode' IN ('organizer', 'self_select', 'random')
        AND (
          target_config->'capacityPerTeam' = 'null'::jsonb OR
          (
            jsonb_typeof(target_config->'capacityPerTeam') = 'number' AND
            (target_config->>'capacityPerTeam')::numeric BETWEEN 1 AND 1000 AND
            trunc((target_config->>'capacityPerTeam')::numeric)
              = (target_config->>'capacityPerTeam')::numeric
          )
        )
        AND (
          target_config->'facilitator' = 'null'::jsonb OR
          (
            jsonb_typeof(target_config->'facilitator') = 'string' AND
            char_length(target_config->>'facilitator') BETWEEN 1 AND 160 AND
            target_config->>'facilitator' !~ '^[[:space:]]' AND
            target_config->>'facilitator' !~ '[[:space:]]$'
          )
        )
      ELSE FALSE
    END,
    FALSE
  );
$$;

CREATE FUNCTION event_capability_primary_place_id(
  target_type TEXT,
  target_config JSONB
) RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE target_type
    WHEN 'travel' THEN target_config->>'homePlaceId'
    WHEN 'lodging' THEN target_config->>'propertyPlaceId'
    WHEN 'transport' THEN target_config->>'meetingPlaceId'
    WHEN 'golf' THEN target_config->>'coursePlaceId'
    WHEN 'team' THEN target_config->>'venuePlaceId'
  END;
$$;

CREATE TABLE event_capabilities (
  root_event_id TEXT NOT NULL REFERENCES event_roots(root_event_id),
  event_id TEXT NOT NULL,
  capability_type TEXT NOT NULL CHECK (
    capability_type IN ('travel', 'lodging', 'transport', 'golf', 'team')
  ),
  schema_version SMALLINT NOT NULL CHECK (schema_version = 1),
  config JSONB NOT NULL,
  primary_place_id TEXT GENERATED ALWAYS AS (
    event_capability_primary_place_id(capability_type, config)
  ) STORED,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (root_event_id, event_id, capability_type),
  FOREIGN KEY (root_event_id, event_id)
    REFERENCES events(root_event_id, id),
  FOREIGN KEY (root_event_id, primary_place_id)
    REFERENCES event_places(root_event_id, id),
  CHECK (event_capability_config_is_valid(capability_type, config))
);

CREATE INDEX event_capabilities_place_idx
  ON event_capabilities(root_event_id, primary_place_id)
  WHERE deleted_at IS NULL AND primary_place_id IS NOT NULL;

CREATE FUNCTION enforce_event_capability_identity_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.root_event_id IS DISTINCT FROM OLD.root_event_id
    OR NEW.event_id IS DISTINCT FROM OLD.event_id
    OR NEW.capability_type IS DISTINCT FROM OLD.capability_type
  THEN
    RAISE EXCEPTION 'capability identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_capability_identity_guard
  BEFORE UPDATE OF root_event_id, event_id, capability_type
  ON event_capabilities
  FOR EACH ROW EXECUTE FUNCTION enforce_event_capability_identity_immutable();

CREATE FUNCTION enforce_event_capability_live_references()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_place_id TEXT;
BEGIN
  IF NEW.deleted_at IS NULL THEN
    PERFORM 1 FROM events event
    WHERE event.root_event_id = NEW.root_event_id
      AND event.id = NEW.event_id
      AND event.deleted_at IS NULL
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'capability event is not live in root' USING ERRCODE = '23514';
    END IF;

    target_place_id := event_capability_primary_place_id(
      NEW.capability_type, NEW.config
    );
    IF target_place_id IS NOT NULL THEN
      PERFORM 1 FROM event_places place
      WHERE place.root_event_id = NEW.root_event_id
        AND place.id = target_place_id
        AND place.deleted_at IS NULL
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'capability place is not live in root' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_capability_live_references_guard
  BEFORE INSERT OR UPDATE OF root_event_id, event_id, capability_type, config, deleted_at
  ON event_capabilities
  FOR EACH ROW EXECUTE FUNCTION enforce_event_capability_live_references();

CREATE FUNCTION prevent_referenced_capability_event_tombstone()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM event_capabilities capability
    WHERE capability.root_event_id = OLD.root_event_id
      AND capability.event_id = OLD.id
      AND capability.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'event is referenced by a live capability' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_capability_event_tombstone_guard
  BEFORE UPDATE OF deleted_at ON events
  FOR EACH ROW EXECUTE FUNCTION prevent_referenced_capability_event_tombstone();

CREATE FUNCTION prevent_referenced_capability_place_tombstone()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM event_capabilities capability
    WHERE capability.root_event_id = OLD.root_event_id
      AND capability.primary_place_id = OLD.id
      AND capability.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'place is referenced by a live capability' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_capability_place_tombstone_guard
  BEFORE UPDATE OF deleted_at ON event_places
  FOR EACH ROW EXECUTE FUNCTION prevent_referenced_capability_place_tombstone();

CREATE FUNCTION event_sync_capability_is_member_visible(
  target_root_event_id TEXT,
  target_event_id TEXT
) RETURNS BOOLEAN LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT event_sync_event_is_member_visible(target_root_event_id, target_event_id);
$$;

CREATE OR REPLACE FUNCTION event_sync_place_is_member_visible(
  target_root_event_id TEXT,
  target_place_id TEXT
) RETURNS BOOLEAN LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT EXISTS (
    SELECT 1 FROM event_itinerary_items item
    WHERE item.root_event_id = target_root_event_id
      AND event_sync_itinerary_is_member_visible(item.root_event_id, item.id)
      AND (
        item.place_id = target_place_id
        OR item.details->>'originPlaceId' = target_place_id
        OR item.details->>'destinationPlaceId' = target_place_id
      )
    UNION ALL
    SELECT 1 FROM event_capabilities capability
    WHERE capability.root_event_id = target_root_event_id
      AND capability.primary_place_id = target_place_id
      AND capability.deleted_at IS NULL
      AND event_sync_capability_is_member_visible(
        capability.root_event_id, capability.event_id
      )
  );
$$;

CREATE FUNCTION bump_event_sync_scope_for_capability_place()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  old_visible_place TEXT;
  new_visible_place TEXT;
  target_root TEXT;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.deleted_at IS NULL THEN
    old_visible_place := OLD.primary_place_id;
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.deleted_at IS NULL THEN
    new_visible_place := NEW.primary_place_id;
  END IF;
  target_root := COALESCE(NEW.root_event_id, OLD.root_event_id);
  IF old_visible_place IS DISTINCT FROM new_visible_place THEN
    UPDATE event_roots
    SET authorization_scope_version = authorization_scope_version + 1
    WHERE root_event_id = target_root;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER event_sync_capability_place_scope
  AFTER INSERT OR DELETE OR UPDATE OF config, deleted_at
  ON event_capabilities
  FOR EACH ROW EXECUTE FUNCTION bump_event_sync_scope_for_capability_place();
