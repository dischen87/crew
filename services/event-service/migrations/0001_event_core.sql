CREATE TABLE event_roots (
  root_event_id TEXT PRIMARY KEY,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  root_event_id TEXT NOT NULL REFERENCES event_roots(root_event_id),
  parent_event_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('trip', 'day', 'golf', 'team_event', 'session', 'activity', 'other')),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description TEXT,
  time_zone TEXT NOT NULL,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  sort_position BIGINT NOT NULL DEFAULT 1024,
  child_order_version INTEGER NOT NULL DEFAULT 1 CHECK (child_order_version > 0),
  itinerary_order_version INTEGER NOT NULL DEFAULT 1 CHECK (itinerary_order_version > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled', 'archived')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (root_event_id, id),
  CONSTRAINT event_root_shape CHECK (
    (id = root_event_id AND parent_event_id IS NULL) OR
    (id <> root_event_id AND parent_event_id IS NOT NULL)
  ),
  CONSTRAINT event_time_order CHECK (
    starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at
  ),
  CONSTRAINT event_deleted_shape CHECK (
    deleted_at IS NULL OR status = 'archived'
  ),
  FOREIGN KEY (root_event_id, parent_event_id)
    REFERENCES events(root_event_id, id)
    DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX events_tree_idx
  ON events(root_event_id, parent_event_id, sort_position, id);

CREATE FUNCTION enforce_event_parent() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  parent_deleted_at TIMESTAMPTZ;
  reaches_self BOOLEAN;
BEGIN
  IF NEW.parent_event_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT deleted_at INTO parent_deleted_at
  FROM events
  WHERE root_event_id = NEW.root_event_id AND id = NEW.parent_event_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'event parent does not exist in root' USING ERRCODE = '23503';
  END IF;
  IF parent_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'event parent is deleted' USING ERRCODE = '23514';
  END IF;

  WITH RECURSIVE ancestors(id, parent_event_id, path) AS (
    SELECT id, parent_event_id, ARRAY[id]
    FROM events
    WHERE root_event_id = NEW.root_event_id AND id = NEW.parent_event_id
    UNION ALL
    SELECT event.id, event.parent_event_id, ancestors.path || event.id
    FROM events event
    JOIN ancestors ON event.id = ancestors.parent_event_id
    WHERE event.root_event_id = NEW.root_event_id
      AND NOT event.id = ANY(ancestors.path)
  )
  SELECT EXISTS(SELECT 1 FROM ancestors WHERE id = NEW.id) INTO reaches_self;

  IF reaches_self THEN
    RAISE EXCEPTION 'event hierarchy cycle' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER events_parent_guard
  BEFORE INSERT OR UPDATE OF root_event_id, parent_event_id ON events
  FOR EACH ROW EXECUTE FUNCTION enforce_event_parent();

CREATE TABLE event_memberships (
  root_event_id TEXT NOT NULL REFERENCES event_roots(root_event_id),
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'organizer', 'participant', 'viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left', 'removed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_by TEXT,
  removal_reason TEXT,
  PRIMARY KEY (root_event_id, user_id)
);

CREATE UNIQUE INDEX event_one_active_owner_idx
  ON event_memberships(root_event_id)
  WHERE role = 'owner' AND status = 'active';

CREATE FUNCTION enforce_exactly_one_owner() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_root TEXT;
  owner_count INTEGER;
BEGIN
  target_root := COALESCE(NEW.root_event_id, OLD.root_event_id);
  IF EXISTS (SELECT 1 FROM event_roots WHERE root_event_id = target_root) THEN
    SELECT count(*) INTO owner_count
    FROM event_memberships
    WHERE root_event_id = target_root AND role = 'owner' AND status = 'active';
    IF owner_count <> 1 THEN
      RAISE EXCEPTION 'root must have exactly one active owner' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER membership_owner_guard
  AFTER INSERT OR UPDATE OR DELETE ON event_memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_exactly_one_owner();

CREATE CONSTRAINT TRIGGER root_owner_guard
  AFTER INSERT OR UPDATE ON event_roots
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_exactly_one_owner();

CREATE TABLE event_invitations (
  id TEXT PRIMARY KEY,
  root_event_id TEXT NOT NULL REFERENCES event_roots(root_event_id),
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('organizer', 'participant', 'viewer')),
  created_by TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 10000),
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count BETWEEN 0 AND max_uses),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (root_event_id, id)
);

CREATE TABLE event_invitation_redemptions (
  invitation_id TEXT NOT NULL REFERENCES event_invitations(id),
  user_id TEXT NOT NULL,
  membership_version INTEGER NOT NULL,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (invitation_id, user_id)
);

CREATE TABLE event_places (
  id TEXT PRIMARY KEY,
  root_event_id TEXT NOT NULL REFERENCES event_roots(root_event_id),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  locality TEXT,
  country_code TEXT NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (root_event_id, id),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE TABLE event_itinerary_items (
  id TEXT PRIMARY KEY,
  root_event_id TEXT NOT NULL REFERENCES event_roots(root_event_id),
  event_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  notes TEXT,
  time_zone TEXT NOT NULL,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  all_day BOOLEAN NOT NULL DEFAULT FALSE,
  sort_position BIGINT NOT NULL DEFAULT 1024,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'archived')),
  details JSONB NOT NULL,
  place_id TEXT,
  place_snapshot JSONB,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (root_event_id, id),
  FOREIGN KEY (root_event_id, event_id) REFERENCES events(root_event_id, id),
  FOREIGN KEY (root_event_id, place_id) REFERENCES event_places(root_event_id, id),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at),
  CHECK ((place_id IS NULL) = (place_snapshot IS NULL)),
  CHECK (deleted_at IS NULL OR status = 'archived')
);

CREATE INDEX itinerary_order_idx
  ON event_itinerary_items(root_event_id, event_id, sort_position, id);

CREATE TABLE event_root_changes (
  root_event_id TEXT NOT NULL REFERENCES event_roots(root_event_id),
  root_revision BIGINT NOT NULL CHECK (root_revision > 0),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('upsert', 'tombstone')),
  entity_version INTEGER NOT NULL CHECK (entity_version > 0),
  data JSONB,
  tombstone JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (root_event_id, root_revision, ordinal),
  CHECK (
    (operation = 'upsert' AND data IS NOT NULL AND tombstone IS NULL) OR
    (operation = 'tombstone' AND data IS NULL AND tombstone IS NOT NULL)
  )
);

CREATE INDEX root_changes_entity_idx
  ON event_root_changes(root_event_id, entity_type, entity_id, root_revision DESC);

CREATE TABLE event_idempotency_records (
  actor_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  state TEXT NOT NULL CHECK (state IN ('processing', 'complete')),
  response_status INTEGER,
  response_body JSONB,
  response_headers JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  PRIMARY KEY (actor_id, operation_id, idempotency_key),
  CHECK (
    (state = 'processing' AND response_status IS NULL AND response_body IS NULL AND response_headers IS NULL AND completed_at IS NULL) OR
    (state = 'complete' AND response_status BETWEEN 200 AND 299 AND response_body IS NOT NULL AND response_headers IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CHECK (expires_at >= created_at + interval '30 days')
);

CREATE INDEX event_idempotency_expiry_idx ON event_idempotency_records(expires_at);
