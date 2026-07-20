ALTER TABLE event_roots
  ADD COLUMN authorization_scope_version BIGINT NOT NULL DEFAULT 1
    CHECK (authorization_scope_version > 0),
  ADD COLUMN minimum_sync_revision BIGINT NOT NULL DEFAULT 0
    CHECK (minimum_sync_revision >= 0 AND minimum_sync_revision <= revision),
  ADD COLUMN minimum_sync_ordinal INTEGER NOT NULL DEFAULT -1
    CHECK (minimum_sync_ordinal BETWEEN -1 AND 2147483647);

ALTER TABLE event_root_changes
  -- Fail closed for old writers during a rolling deploy. Sync-aware writers
  -- always provide the precise audience explicitly.
  ADD COLUMN audience TEXT NOT NULL DEFAULT 'managers'
    CHECK (audience IN ('members', 'managers', 'actor')),
  ADD COLUMN audience_user_id TEXT
    CHECK (audience_user_id IS NULL OR audience_user_id ~ '^usr_[a-f0-9]{32}$'),
  ADD CONSTRAINT event_root_change_audience_shape CHECK (
    (audience = 'actor' AND audience_user_id IS NOT NULL) OR
    (audience <> 'actor' AND audience_user_id IS NULL)
  );

CREATE FUNCTION event_sync_event_is_member_visible(
  target_root_event_id TEXT,
  target_event_id TEXT
) RETURNS BOOLEAN LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT EXISTS (
    WITH RECURSIVE visible AS (
      SELECT id FROM events
      WHERE root_event_id = target_root_event_id AND id = target_root_event_id
        AND status = 'published' AND deleted_at IS NULL
      UNION ALL
      SELECT child.id FROM events child
      JOIN visible parent ON child.parent_event_id = parent.id
      WHERE child.root_event_id = target_root_event_id
        AND child.status = 'published' AND child.deleted_at IS NULL
    )
    SELECT 1 FROM visible WHERE id = target_event_id
  );
$$;

CREATE FUNCTION event_sync_feed_is_member_visible(
  target_root_event_id TEXT,
  target_entry_id TEXT
) RETURNS BOOLEAN LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT EXISTS (
    SELECT 1 FROM event_feed_entries entry
    WHERE entry.root_event_id = target_root_event_id
      AND entry.id = target_entry_id
      AND event_sync_event_is_member_visible(
        entry.root_event_id, COALESCE(entry.event_id, entry.root_event_id)
      )
  );
$$;

CREATE FUNCTION event_sync_itinerary_is_member_visible(
  target_root_event_id TEXT,
  target_item_id TEXT
) RETURNS BOOLEAN LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT EXISTS (
    SELECT 1 FROM event_itinerary_items item
    WHERE item.root_event_id = target_root_event_id
      AND item.id = target_item_id
      AND item.deleted_at IS NULL AND item.status <> 'archived'
      AND event_sync_event_is_member_visible(item.root_event_id, item.event_id)
      AND (
        item.details->>'type' IS DISTINCT FROM 'session'
        OR item.details->>'descendantEventId' IS NULL
        OR event_sync_event_is_member_visible(
          item.root_event_id, item.details->>'descendantEventId'
        )
      )
  );
$$;

CREATE FUNCTION event_sync_place_is_member_visible(
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
  );
$$;

UPDATE event_root_changes change
SET audience = 'managers'
WHERE change.entity_type = 'invitation'
  OR (
    change.entity_type = 'membership'
    AND COALESCE(change.data, change.tombstone)->>'status' IS DISTINCT FROM 'active'
  )
  OR (
    change.entity_type = 'event'
    AND NOT event_sync_event_is_member_visible(
      change.root_event_id, change.entity_id
    )
  )
  OR (
    change.entity_type = 'itineraryItem'
    AND NOT event_sync_itinerary_is_member_visible(
      change.root_event_id, change.entity_id
    )
  )
  OR (
    change.entity_type = 'feedEntry'
    AND NOT event_sync_feed_is_member_visible(
      change.root_event_id, change.entity_id
    )
  )
  OR (
    change.entity_type = 'feedReaction'
    AND NOT event_sync_feed_is_member_visible(
      change.root_event_id,
      COALESCE(change.data, change.tombstone)->>'entryId'
    )
  )
  OR (
    change.entity_type = 'attachment'
    AND NOT event_sync_feed_is_member_visible(
      change.root_event_id,
      COALESCE(change.data, change.tombstone)#>>'{target,entityId}'
    )
  )
  OR (
    change.entity_type = 'place'
    AND NOT event_sync_place_is_member_visible(
      change.root_event_id, change.entity_id
    )
  );

-- Audience did not exist when legacy changes were appended. Current visibility
-- cannot safely reconstruct what a member could read at each historical point,
-- so every root that predates this migration must bootstrap at its current cut.
UPDATE event_roots
SET minimum_sync_revision = revision, minimum_sync_ordinal = 2147483647;

CREATE TABLE event_sync_streams (
  actor_id TEXT NOT NULL CHECK (actor_id ~ '^usr_[a-f0-9]{32}$'),
  device_id TEXT NOT NULL CHECK (
    device_id ~ '^dvc_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  root_event_id TEXT NOT NULL REFERENCES event_roots(root_event_id),
  next_client_sequence BIGINT NOT NULL DEFAULT 1 CHECK (
    next_client_sequence BETWEEN 1 AND 9007199254740991
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor_id, device_id, root_event_id)
);

CREATE TABLE event_sync_mutation_receipts (
  actor_id TEXT NOT NULL CHECK (actor_id ~ '^usr_[a-f0-9]{32}$'),
  client_mutation_id UUID NOT NULL,
  device_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL REFERENCES event_roots(root_event_id),
  client_sequence BIGINT NOT NULL CHECK (
    client_sequence BETWEEN 1 AND 9007199254740990
  ),
  fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
  outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'rejected')),
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (actor_id, client_mutation_id),
  UNIQUE (actor_id, device_id, root_event_id, client_sequence),
  FOREIGN KEY (actor_id, device_id, root_event_id)
    REFERENCES event_sync_streams(actor_id, device_id, root_event_id)
);

CREATE INDEX event_sync_receipts_root_idx
  ON event_sync_mutation_receipts(root_event_id, created_at, client_mutation_id);

CREATE TABLE event_sync_snapshots (
  id TEXT PRIMARY KEY CHECK (id ~ '^snp_[a-f0-9]{32}$'),
  actor_id TEXT NOT NULL CHECK (actor_id ~ '^usr_[a-f0-9]{32}$'),
  root_event_id TEXT NOT NULL REFERENCES event_roots(root_event_id) ON DELETE CASCADE,
  authorization_scope_version BIGINT NOT NULL CHECK (authorization_scope_version > 0),
  root_revision BIGINT NOT NULL CHECK (root_revision >= 0),
  record_count INTEGER NOT NULL CHECK (record_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '15 minutes'),
  UNIQUE (actor_id, root_event_id)
);

CREATE INDEX event_sync_snapshots_expiry_idx
  ON event_sync_snapshots(expires_at, id);

CREATE TABLE event_sync_snapshot_records (
  snapshot_id TEXT NOT NULL REFERENCES event_sync_snapshots(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_version INTEGER NOT NULL CHECK (entity_version > 0),
  data JSONB NOT NULL,
  PRIMARY KEY (snapshot_id, ordinal)
);

CREATE FUNCTION bump_event_sync_scope_for_membership()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE event_roots
  SET authorization_scope_version = authorization_scope_version + 1
  WHERE root_event_id = COALESCE(NEW.root_event_id, OLD.root_event_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER event_sync_membership_scope
  AFTER INSERT OR DELETE OR UPDATE OF role, status ON event_memberships
  FOR EACH ROW EXECUTE FUNCTION bump_event_sync_scope_for_membership();

CREATE FUNCTION bump_event_sync_scope_for_visibility()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
    OR NEW.parent_event_id IS DISTINCT FROM OLD.parent_event_id
    OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
  THEN
    UPDATE event_roots
    SET authorization_scope_version = authorization_scope_version + 1
    WHERE root_event_id = NEW.root_event_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER event_sync_event_visibility_scope
  AFTER UPDATE OF status, parent_event_id, deleted_at ON events
  FOR EACH ROW EXECUTE FUNCTION bump_event_sync_scope_for_visibility();

CREATE FUNCTION bump_event_sync_scope_for_itinerary_visibility()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE event_roots
  SET authorization_scope_version = authorization_scope_version + 1
  WHERE root_event_id = COALESCE(NEW.root_event_id, OLD.root_event_id);
  RETURN NULL;
END;
$$;

CREATE TRIGGER event_sync_itinerary_visibility_scope
  AFTER INSERT OR DELETE OR UPDATE OF event_id, status, deleted_at, place_id, details
  ON event_itinerary_items
  FOR EACH ROW EXECUTE FUNCTION bump_event_sync_scope_for_itinerary_visibility();
