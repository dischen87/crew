import type { SqlDatabase, SqlExecutor } from "./database.ts";

export interface Migration {
	readonly version: number;
	readonly name: string;
	readonly sql: string;
	readonly copyStatements?: readonly string[];
	readonly finalizeSql?: string;
	readonly preservedTables?: readonly string[];
}

export const migrations: readonly Migration[] = [
	{
		version: 1,
		name: "local_read_models",
		sql: `
CREATE TABLE root_sync_state (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  pull_cursor TEXT,
  snapshot_id TEXT,
  snapshot_revision TEXT CHECK (snapshot_revision IS NULL OR snapshot_revision NOT GLOB '*[^0-9]*'),
  authorization_scope_version INTEGER NOT NULL CHECK (authorization_scope_version > 0),
  last_completed_sync_at TEXT,
  PRIMARY KEY (account_user_id, root_event_id)
);

CREATE TABLE events (
  account_user_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'evt_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  parent_event_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('trip', 'day', 'golf', 'team_event', 'session', 'activity', 'other')),
  title TEXT NOT NULL,
  description TEXT,
  time_zone TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  sort_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'cancelled', 'archived')),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (account_user_id, id),
  UNIQUE (account_user_id, id, root_event_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, parent_event_id, root_event_id)
    REFERENCES events (account_user_id, id, root_event_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (
    (id = root_event_id AND parent_event_id IS NULL) OR
    (id <> root_event_id AND parent_event_id IS NOT NULL)
  ),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);

CREATE INDEX events_tree_order
  ON events (account_user_id, root_event_id, parent_event_id, sort_key, id);

CREATE TRIGGER events_root_immutable
BEFORE UPDATE OF root_event_id ON events
WHEN old.root_event_id <> new.root_event_id
BEGIN
  SELECT RAISE(ABORT, 'event IDs cannot move between roots');
END;

CREATE TABLE memberships (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  member_user_id TEXT NOT NULL CHECK (member_user_id LIKE 'usr_%'),
  role TEXT NOT NULL CHECK (role IN ('owner', 'organizer', 'participant', 'viewer')),
  status TEXT NOT NULL CHECK (status IN ('active', 'left', 'removed')),
  version INTEGER NOT NULL CHECK (version > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, root_event_id, member_user_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);

CREATE INDEX memberships_by_root
  ON memberships (account_user_id, root_event_id, status, role, member_user_id);

CREATE TABLE itinerary_items (
  account_user_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'iti_%'),
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  time_zone TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
  sort_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'cancelled', 'archived')),
  details_schema_version INTEGER NOT NULL CHECK (details_schema_version > 0),
  details_json TEXT NOT NULL,
  place_id TEXT,
  place_snapshot_json TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (account_user_id, id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES events (account_user_id, id, root_event_id) ON DELETE CASCADE,
  CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at),
  CHECK ((place_id IS NULL) = (place_snapshot_json IS NULL))
);

CREATE INDEX itinerary_timeline_order
  ON itinerary_items (account_user_id, root_event_id, starts_at, sort_key, id);

CREATE INDEX itinerary_by_event
  ON itinerary_items (account_user_id, event_id, sort_key, id);

CREATE TRIGGER itinerary_root_immutable
BEFORE UPDATE OF root_event_id ON itinerary_items
WHEN old.root_event_id <> new.root_event_id
BEGIN
  SELECT RAISE(ABORT, 'itinerary IDs cannot move between roots');
END;

CREATE TABLE feed_entries (
  account_user_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'fed_%'),
  root_event_id TEXT NOT NULL,
  event_id TEXT,
  actor_user_id TEXT,
  kind TEXT NOT NULL,
  payload_schema_version INTEGER NOT NULL CHECK (payload_schema_version > 0),
  payload_json TEXT NOT NULL,
  root_revision TEXT NOT NULL CHECK (
    root_revision GLOB '[1-9]*' AND root_revision NOT GLOB '*[^0-9]*'
  ),
  revision_ordinal INTEGER NOT NULL CHECK (revision_ordinal >= 0),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (account_user_id, id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES events (account_user_id, id, root_event_id) ON DELETE CASCADE
);

CREATE INDEX feed_revision_order
  ON feed_entries (account_user_id, root_event_id, root_revision, revision_ordinal, id);

CREATE TABLE local_drafts (
  account_user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  event_id TEXT,
  entity_type TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES events (account_user_id, id, root_event_id) ON DELETE CASCADE
);

CREATE INDEX drafts_by_root
  ON local_drafts (account_user_id, root_event_id, updated_at, id);

CREATE TABLE public_places (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  locality TEXT,
  country_code TEXT,
  latitude REAL,
  longitude REAL,
  provenance_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
`,
	},
	{
		version: 2,
		name: "lossless_sync_read_models",
		sql: `
CREATE TABLE root_sync_state_v2 (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  pull_cursor TEXT,
  snapshot_id TEXT,
  snapshot_revision TEXT CHECK (
    snapshot_revision IS NULL OR snapshot_revision = '0' OR (
      snapshot_revision GLOB '[1-9]*' AND
      snapshot_revision NOT GLOB '*[^0-9]*'
    )
  ),
  authorization_scope_version TEXT NOT NULL CHECK (
    authorization_scope_version GLOB '[1-9]*' AND
    authorization_scope_version NOT GLOB '*[^0-9]*'
  ),
  last_completed_sync_at TEXT,
  PRIMARY KEY (account_user_id, root_event_id)
);

CREATE TABLE events_v2 (
  account_user_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'evt_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  parent_event_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('trip', 'day', 'golf', 'team_event', 'session', 'activity', 'other')),
  title TEXT NOT NULL,
  description TEXT,
  time_zone TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  sort_key TEXT NOT NULL CHECK (
    sort_key GLOB '[1-9]*' AND sort_key NOT GLOB '*[^0-9]*'
  ),
  child_order_version TEXT NOT NULL CHECK (
    child_order_version GLOB '[1-9]*' AND
    child_order_version NOT GLOB '*[^0-9]*'
  ),
  itinerary_order_version TEXT NOT NULL CHECK (
    itinerary_order_version GLOB '[1-9]*' AND
    itinerary_order_version NOT GLOB '*[^0-9]*'
  ),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'cancelled', 'archived')),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (account_user_id, id),
  UNIQUE (account_user_id, id, root_event_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state_v2 (account_user_id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, parent_event_id, root_event_id)
    REFERENCES events_v2 (account_user_id, id, root_event_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (
    (id = root_event_id AND parent_event_id IS NULL) OR
    (id <> root_event_id AND parent_event_id IS NOT NULL)
  ),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);

CREATE TABLE memberships_v2 (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  member_user_id TEXT NOT NULL CHECK (member_user_id LIKE 'usr_%'),
  role TEXT NOT NULL CHECK (role IN ('owner', 'organizer', 'participant', 'viewer')),
  status TEXT NOT NULL CHECK (status IN ('active', 'left', 'removed')),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, root_event_id, member_user_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state_v2 (account_user_id, root_event_id) ON DELETE CASCADE
);

CREATE TABLE itinerary_items_v2 (
  account_user_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'iti_%'),
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT,
  time_zone TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  all_day INTEGER NOT NULL CHECK (all_day IN (0, 1)),
  sort_key TEXT NOT NULL CHECK (
    sort_key GLOB '[1-9]*' AND sort_key NOT GLOB '*[^0-9]*'
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'cancelled', 'archived')),
  details_schema_version INTEGER NOT NULL CHECK (details_schema_version > 0),
  details_json TEXT NOT NULL,
  place_id TEXT,
  place_snapshot_json TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (account_user_id, id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state_v2 (account_user_id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES events_v2 (account_user_id, id, root_event_id) ON DELETE CASCADE,
  CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at),
  CHECK ((place_id IS NULL) = (place_snapshot_json IS NULL))
);

CREATE TABLE feed_entries_v2 (
  account_user_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'fed_%'),
  root_event_id TEXT NOT NULL,
  event_id TEXT,
  parent_entry_id TEXT,
  actor_user_id TEXT,
  kind TEXT NOT NULL,
  payload_schema_version INTEGER NOT NULL CHECK (payload_schema_version > 0),
  payload_json TEXT NOT NULL,
  root_revision TEXT NOT NULL CHECK (
    root_revision GLOB '[1-9]*' AND root_revision NOT GLOB '*[^0-9]*'
  ),
  created_root_revision TEXT NOT NULL CHECK (
    created_root_revision GLOB '[1-9]*' AND
    created_root_revision NOT GLOB '*[^0-9]*'
  ),
  revision_ordinal INTEGER NOT NULL CHECK (revision_ordinal >= 0),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (account_user_id, id),
  UNIQUE (account_user_id, id, root_event_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state_v2 (account_user_id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES events_v2 (account_user_id, id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, parent_entry_id, root_event_id)
    REFERENCES feed_entries_v2 (account_user_id, id, root_event_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE local_drafts_v2 (
  account_user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  event_id TEXT,
  entity_type TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state_v2 (account_user_id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES events_v2 (account_user_id, id, root_event_id) ON DELETE CASCADE
);
`,
		copyStatements: [
			`INSERT INTO root_sync_state_v2
SELECT account_user_id, root_event_id, pull_cursor, snapshot_id,
  snapshot_revision, CAST(authorization_scope_version AS TEXT),
  last_completed_sync_at
FROM root_sync_state`,
			`INSERT INTO events_v2
SELECT account_user_id, id, root_event_id, parent_event_id, kind, title,
  description, time_zone, starts_at, ends_at, sort_key, '1', '1', status,
  version, created_at, updated_at, deleted_at
FROM events`,
			`INSERT INTO memberships_v2
SELECT account_user_id, root_event_id, member_user_id, role, status, version,
  updated_at, updated_at
FROM memberships`,
			`INSERT INTO itinerary_items_v2
SELECT account_user_id, id, root_event_id, event_id, title, notes, time_zone,
  starts_at, ends_at, all_day, sort_key, status, details_schema_version,
  details_json, place_id, place_snapshot_json, version, created_at, updated_at,
  deleted_at
FROM itinerary_items`,
			`INSERT INTO feed_entries_v2
SELECT account_user_id, id, root_event_id, event_id, NULL, actor_user_id, kind,
  payload_schema_version, payload_json, root_revision, root_revision,
  revision_ordinal, version, created_at, created_at, deleted_at
FROM feed_entries`,
			`INSERT INTO local_drafts_v2
SELECT account_user_id, id, root_event_id, event_id, entity_type, content_json,
  created_at, updated_at
FROM local_drafts`,
		],
		preservedTables: [
			"root_sync_state",
			"events",
			"memberships",
			"itinerary_items",
			"feed_entries",
			"local_drafts",
		],
		finalizeSql: `
DROP TABLE local_drafts;
DROP TABLE feed_entries;
DROP TABLE itinerary_items;
DROP TABLE memberships;
DROP TABLE events;
DROP TABLE root_sync_state;

ALTER TABLE root_sync_state_v2 RENAME TO root_sync_state;
ALTER TABLE events_v2 RENAME TO events;
ALTER TABLE memberships_v2 RENAME TO memberships;
ALTER TABLE itinerary_items_v2 RENAME TO itinerary_items;
ALTER TABLE feed_entries_v2 RENAME TO feed_entries;
ALTER TABLE local_drafts_v2 RENAME TO local_drafts;

CREATE INDEX events_tree_order
  ON events (
    account_user_id, root_event_id, parent_event_id,
    length(sort_key), sort_key, id
  );

CREATE TRIGGER events_root_immutable
BEFORE UPDATE OF root_event_id ON events
WHEN old.root_event_id <> new.root_event_id
BEGIN
  SELECT RAISE(ABORT, 'event IDs cannot move between roots');
END;

CREATE INDEX memberships_by_root
  ON memberships (account_user_id, root_event_id, status, role, member_user_id);

CREATE INDEX itinerary_timeline_order
  ON itinerary_items (
    account_user_id, root_event_id, starts_at, length(sort_key), sort_key, id
  );

CREATE INDEX itinerary_by_event
  ON itinerary_items (
    account_user_id, event_id, length(sort_key), sort_key, id
  );

CREATE TRIGGER itinerary_root_immutable
BEFORE UPDATE OF root_event_id ON itinerary_items
WHEN old.root_event_id <> new.root_event_id
BEGIN
  SELECT RAISE(ABORT, 'itinerary IDs cannot move between roots');
END;

CREATE INDEX feed_creation_order
  ON feed_entries (
    account_user_id, root_event_id,
    length(created_root_revision) DESC, created_root_revision DESC, id DESC
  );

CREATE INDEX drafts_by_root
	  ON local_drafts (account_user_id, root_event_id, updated_at, id);
	`,
	},
	{
		version: 3,
		name: "complete_event_sync_projection",
		sql: `
CREATE TABLE feed_entries_v3 (
  account_user_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'fed_%'),
  root_event_id TEXT NOT NULL,
  event_id TEXT,
  parent_entry_id TEXT,
  actor_user_id TEXT,
  kind TEXT NOT NULL,
  payload_schema_version INTEGER NOT NULL CHECK (payload_schema_version > 0),
  payload_json TEXT NOT NULL,
  root_revision TEXT NOT NULL CHECK (
    root_revision GLOB '[1-9]*' AND root_revision NOT GLOB '*[^0-9]*'
  ),
  created_root_revision TEXT NOT NULL CHECK (
    created_root_revision GLOB '[1-9]*' AND
    created_root_revision NOT GLOB '*[^0-9]*'
  ),
  revision_ordinal INTEGER CHECK (revision_ordinal IS NULL OR revision_ordinal >= 0),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (account_user_id, id),
  UNIQUE (account_user_id, id, root_event_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES events (account_user_id, id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, parent_entry_id, root_event_id)
    REFERENCES feed_entries_v3 (account_user_id, id, root_event_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE local_drafts_v3 (
  account_user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  event_id TEXT,
  entity_type TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);
`,
		copyStatements: [
			`INSERT INTO feed_entries_v3
SELECT account_user_id, id, root_event_id, event_id, parent_entry_id,
  actor_user_id, kind, payload_schema_version, payload_json, root_revision,
  created_root_revision, revision_ordinal, version, created_at, updated_at,
  deleted_at
FROM feed_entries`,
			`INSERT INTO local_drafts_v3
SELECT account_user_id, id, root_event_id, event_id, entity_type, content_json,
  created_at, updated_at
FROM local_drafts`,
		],
		preservedTables: ["feed_entries", "local_drafts"],
		finalizeSql: `
DROP TABLE local_drafts;
DROP TABLE feed_entries;

ALTER TABLE feed_entries_v3 RENAME TO feed_entries;
ALTER TABLE local_drafts_v3 RENAME TO local_drafts;

CREATE INDEX feed_creation_order
  ON feed_entries (
    account_user_id, root_event_id,
    length(created_root_revision) DESC, created_root_revision DESC, id DESC
  );

CREATE INDEX drafts_by_root
  ON local_drafts (account_user_id, root_event_id, updated_at, id);

CREATE TABLE invitations (
  account_user_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'inv_%'),
  root_event_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('organizer', 'participant', 'viewer')),
  email_bound INTEGER NOT NULL CHECK (email_bound IN (0, 1)),
  expires_at TEXT NOT NULL,
  max_uses INTEGER NOT NULL CHECK (max_uses > 0),
  use_count INTEGER NOT NULL CHECK (use_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);

CREATE INDEX invitations_by_root
  ON invitations (account_user_id, root_event_id, status, expires_at, id);

CREATE TABLE event_places (
  account_user_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'plc_%'),
  root_event_id TEXT NOT NULL,
  name TEXT NOT NULL,
  locality TEXT,
  country_code TEXT NOT NULL CHECK (length(country_code) = 2),
  latitude REAL,
  longitude REAL,
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (account_user_id, id),
  UNIQUE (account_user_id, id, root_event_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE,
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE INDEX event_places_by_root
  ON event_places (account_user_id, root_event_id, name, id);

CREATE TABLE event_capabilities (
  account_user_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('travel', 'lodging', 'transport', 'golf', 'team')),
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  config_json TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT CHECK (deleted_at IS NULL),
  PRIMARY KEY (account_user_id, entity_id),
  UNIQUE (account_user_id, root_event_id, event_id, type),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES events (account_user_id, id, root_event_id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (entity_id = event_id || ':' || type)
);

CREATE INDEX event_capabilities_by_event
  ON event_capabilities (account_user_id, root_event_id, event_id, type);

CREATE TABLE feed_reactions (
  account_user_id TEXT NOT NULL,
  entity_id TEXT NOT NULL CHECK (entity_id LIKE 'fer_%'),
  root_event_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  user_id TEXT NOT NULL CHECK (user_id LIKE 'usr_%'),
  reaction TEXT NOT NULL CHECK (
    reaction IN ('like', 'love', 'celebrate', 'laugh', 'surprised', 'sad')
  ),
  present INTEGER NOT NULL CHECK (present = 1),
  version INTEGER NOT NULL CHECK (version > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, entity_id),
  UNIQUE (account_user_id, root_event_id, entry_id, user_id, reaction),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, entry_id, root_event_id)
    REFERENCES feed_entries (account_user_id, id, root_event_id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX feed_reactions_by_entry
  ON feed_reactions (account_user_id, root_event_id, entry_id, reaction, user_id);

CREATE TABLE attachments (
  account_user_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'att_%'),
  root_event_id TEXT NOT NULL,
  target_entity_type TEXT NOT NULL CHECK (target_entity_type = 'feedEntry'),
  target_entity_id TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (
    content_type IN ('image/jpeg', 'image/png', 'image/webp')
  ),
  byte_count INTEGER NOT NULL CHECK (byte_count BETWEEN 1 AND 20971520),
  sha256 TEXT NOT NULL CHECK (
    length(sha256) = 64 AND sha256 NOT GLOB '*[^a-f0-9]*'
  ),
  caption TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, target_entity_id, root_event_id)
    REFERENCES feed_entries (account_user_id, id, root_event_id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX attachments_by_target
  ON attachments (account_user_id, root_event_id, target_entity_id, id);

CREATE TABLE sync_tombstones (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (
    entity_type IN (
      'event', 'invitation', 'capability', 'itineraryItem',
      'feedEntry', 'feedReaction'
    )
  ),
  entity_id TEXT NOT NULL,
  entity_version INTEGER NOT NULL CHECK (entity_version > 0),
  root_revision TEXT NOT NULL CHECK (
    root_revision = '0' OR (
      root_revision GLOB '[1-9]*' AND root_revision NOT GLOB '*[^0-9]*'
    )
  ),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  deleted_at TEXT NOT NULL,
  tombstone_json TEXT NOT NULL,
  PRIMARY KEY (account_user_id, root_event_id, entity_type, entity_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);

CREATE INDEX sync_tombstones_by_root
  ON sync_tombstones (
    account_user_id, root_event_id, entity_type, entity_id
  );

CREATE TABLE sync_snapshot_staging (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL CHECK (snapshot_id LIKE 'snp_%'),
  snapshot_revision TEXT NOT NULL CHECK (
    snapshot_revision = '0' OR (
      snapshot_revision GLOB '[1-9]*' AND
      snapshot_revision NOT GLOB '*[^0-9]*'
    )
  ),
  authorization_scope_version TEXT NOT NULL CHECK (
    authorization_scope_version GLOB '[1-9]*' AND
    authorization_scope_version NOT GLOB '*[^0-9]*'
  ),
  sync_cursor TEXT NOT NULL,
  next_page_cursor TEXT,
  base_pull_cursor TEXT,
  PRIMARY KEY (account_user_id, root_event_id),
  UNIQUE (account_user_id, root_event_id, snapshot_id)
);

CREATE TABLE sync_snapshot_records (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (
    entity_type IN (
      'event', 'membership', 'invitation', 'place', 'capability',
      'itineraryItem', 'feedEntry', 'feedReaction', 'attachment'
    )
  ),
  entity_id TEXT NOT NULL,
  entity_version INTEGER NOT NULL CHECK (entity_version > 0),
  data_json TEXT NOT NULL,
  PRIMARY KEY (
    account_user_id, root_event_id, snapshot_id, entity_type, entity_id
  ),
  FOREIGN KEY (account_user_id, root_event_id, snapshot_id)
    REFERENCES sync_snapshot_staging (
      account_user_id, root_event_id, snapshot_id
    ) ON DELETE CASCADE
);

CREATE INDEX sync_snapshot_records_by_type
  ON sync_snapshot_records (
    account_user_id, root_event_id, snapshot_id, entity_type, entity_id
  );
`,
	},
	{
		version: 4,
		name: "lossless_feed_tombstone_references",
		sql: `
CREATE TABLE feed_entries_v4 (
  account_user_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'fed_%'),
  root_event_id TEXT NOT NULL,
  event_id TEXT,
  parent_entry_id TEXT,
  actor_user_id TEXT,
  kind TEXT NOT NULL,
  payload_schema_version INTEGER NOT NULL CHECK (payload_schema_version > 0),
  payload_json TEXT NOT NULL,
  root_revision TEXT NOT NULL CHECK (
    root_revision GLOB '[1-9]*' AND root_revision NOT GLOB '*[^0-9]*'
  ),
  created_root_revision TEXT NOT NULL CHECK (
    created_root_revision GLOB '[1-9]*' AND
    created_root_revision NOT GLOB '*[^0-9]*'
  ),
  revision_ordinal INTEGER CHECK (revision_ordinal IS NULL OR revision_ordinal >= 0),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (account_user_id, id),
  UNIQUE (account_user_id, id, root_event_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);

CREATE TABLE feed_reactions_v4 (
  account_user_id TEXT NOT NULL,
  entity_id TEXT NOT NULL CHECK (entity_id LIKE 'fer_%'),
  root_event_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  user_id TEXT NOT NULL CHECK (user_id LIKE 'usr_%'),
  reaction TEXT NOT NULL CHECK (
    reaction IN ('like', 'love', 'celebrate', 'laugh', 'surprised', 'sad')
  ),
  present INTEGER NOT NULL CHECK (present = 1),
  version INTEGER NOT NULL CHECK (version > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, entity_id),
  UNIQUE (account_user_id, root_event_id, entry_id, user_id, reaction),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, entry_id, root_event_id)
    REFERENCES feed_entries_v4 (account_user_id, id, root_event_id)
    ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE attachments_v4 (
  account_user_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'att_%'),
  root_event_id TEXT NOT NULL,
  target_entity_type TEXT NOT NULL CHECK (target_entity_type = 'feedEntry'),
  target_entity_id TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (
    content_type IN ('image/jpeg', 'image/png', 'image/webp')
  ),
  byte_count INTEGER NOT NULL CHECK (byte_count BETWEEN 1 AND 20971520),
  sha256 TEXT NOT NULL CHECK (
    length(sha256) = 64 AND sha256 NOT GLOB '*[^a-f0-9]*'
  ),
  caption TEXT,
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, target_entity_id, root_event_id)
    REFERENCES feed_entries_v4 (account_user_id, id, root_event_id)
    ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
`,
		copyStatements: [
			`INSERT INTO feed_entries_v4
SELECT account_user_id, id, root_event_id, event_id, parent_entry_id,
  actor_user_id, kind, payload_schema_version, payload_json, root_revision,
  created_root_revision, revision_ordinal, version, created_at, updated_at,
  deleted_at
FROM feed_entries`,
			`INSERT INTO feed_reactions_v4
SELECT account_user_id, entity_id, root_event_id, entry_id, user_id, reaction,
  present, version, updated_at
FROM feed_reactions`,
			`INSERT INTO attachments_v4
SELECT account_user_id, id, root_event_id, target_entity_type,
  target_entity_id, content_type, byte_count, sha256, caption, version,
  created_at
FROM attachments`,
		],
		preservedTables: ["feed_entries", "feed_reactions", "attachments"],
		finalizeSql: `
DROP TABLE attachments;
DROP TABLE feed_reactions;
DROP TABLE feed_entries;

ALTER TABLE feed_entries_v4 RENAME TO feed_entries;
ALTER TABLE feed_reactions_v4 RENAME TO feed_reactions;
ALTER TABLE attachments_v4 RENAME TO attachments;

CREATE INDEX feed_creation_order
  ON feed_entries (
    account_user_id, root_event_id,
    length(created_root_revision) DESC, created_root_revision DESC, id DESC
  );

CREATE INDEX feed_reactions_by_entry
  ON feed_reactions (account_user_id, root_event_id, entry_id, reaction, user_id);

CREATE INDEX attachments_by_target
  ON attachments (account_user_id, root_event_id, target_entity_id, id);
`,
	},
	{
		version: 5,
		name: "durable_mutation_outbox",
		sql: `
CREATE TABLE mutation_streams (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  device_id TEXT NOT NULL CHECK (device_id LIKE 'dvc_%'),
  next_client_sequence INTEGER NOT NULL DEFAULT 1 CHECK (
    next_client_sequence BETWEEN 1 AND 9007199254740991
  ),
  PRIMARY KEY (account_user_id, root_event_id, device_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);

CREATE TABLE mutation_outbox (
  account_user_id TEXT NOT NULL,
  client_mutation_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  client_sequence INTEGER NOT NULL CHECK (
    client_sequence BETWEEN 0 AND 9007199254740990
  ),
  operation_id TEXT NOT NULL CHECK (
    operation_id IN ('eventsCreate', 'syncMutationsApply')
  ),
  command_json TEXT NOT NULL,
  command_fingerprint TEXT NOT NULL CHECK (
    length(command_fingerprint) = 64 AND
    command_fingerprint NOT GLOB '*[^a-f0-9]*'
  ),
  optimistic_overlay_json TEXT NOT NULL,
  http_idempotency_key TEXT,
  state TEXT NOT NULL CHECK (
    state IN ('pending', 'sending', 'awaiting_pull', 'blocked', 'dead_letter')
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  next_attempt_at TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  applied_root_revision TEXT CHECK (
    applied_root_revision IS NULL OR applied_root_revision = '0' OR (
      applied_root_revision GLOB '[1-9]*' AND
      applied_root_revision NOT GLOB '*[^0-9]*'
    )
  ),
  server_consumed INTEGER NOT NULL DEFAULT 0 CHECK (server_consumed IN (0, 1)),
  blocked_until_pull INTEGER NOT NULL DEFAULT 0 CHECK (blocked_until_pull IN (0, 1)),
  last_error_code TEXT CHECK (
    last_error_code IS NULL OR last_error_code IN (
      'auth_required', 'blocked', 'conflict', 'deleted', 'invalid',
      'network', 'permission', 'rate_limited', 'retry_exhausted',
      'sequence', 'service_unavailable', 'unknown'
    )
  ),
  last_request_id TEXT,
  current_version INTEGER CHECK (current_version IS NULL OR current_version > 0),
  authoritative_order_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, client_mutation_id),
  UNIQUE (account_user_id, root_event_id, device_id, client_sequence),
  FOREIGN KEY (account_user_id, root_event_id, device_id)
    REFERENCES mutation_streams (account_user_id, root_event_id, device_id)
    ON DELETE CASCADE,
  CHECK (
    (operation_id = 'eventsCreate' AND client_sequence = 0 AND http_idempotency_key IS NOT NULL) OR
    (operation_id = 'syncMutationsApply' AND client_sequence > 0 AND http_idempotency_key IS NULL)
  )
);

CREATE UNIQUE INDEX mutation_outbox_root_create
  ON mutation_outbox (account_user_id, root_event_id, operation_id)
  WHERE operation_id = 'eventsCreate';

CREATE INDEX mutation_outbox_root_order
  ON mutation_outbox (
    account_user_id, root_event_id, client_sequence, state, next_attempt_at
  );

CREATE TRIGGER mutation_outbox_command_immutable
BEFORE UPDATE OF account_user_id, client_mutation_id, root_event_id, device_id,
  client_sequence, operation_id, command_json, command_fingerprint,
  optimistic_overlay_json, created_at
ON mutation_outbox
BEGIN
  SELECT RAISE(ABORT, 'outbox commands and overlays are immutable');
END;

CREATE TABLE sync_push_batches (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  body_json TEXT NOT NULL,
  body_fingerprint TEXT NOT NULL CHECK (
    length(body_fingerprint) = 64 AND
    body_fingerprint NOT GLOB '*[^a-f0-9]*'
  ),
  mutation_ids_json TEXT NOT NULL,
  lease_owner TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, root_event_id),
  FOREIGN KEY (account_user_id, root_event_id, device_id)
    REFERENCES mutation_streams (account_user_id, root_event_id, device_id)
    ON DELETE CASCADE
);
`,
	},
	{
		version: 6,
		name: "retained_attachment_media",
		sql: `
CREATE TABLE local_attachment_media (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  attachment_id TEXT NOT NULL CHECK (attachment_id LIKE 'att_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  target_entry_id TEXT NOT NULL CHECK (target_entry_id LIKE 'fed_%'),
  retained_file_key TEXT NOT NULL CHECK (
    retained_file_key NOT GLOB '*[\\/]*'
  ),
  content_type TEXT NOT NULL CHECK (
    content_type IN ('image/jpeg', 'image/png', 'image/webp')
  ),
  byte_count INTEGER NOT NULL CHECK (byte_count BETWEEN 1 AND 20971520),
  sha256 TEXT NOT NULL CHECK (
    length(sha256) = 64 AND sha256 NOT GLOB '*[^a-f0-9]*'
  ),
  pixel_width INTEGER NOT NULL CHECK (pixel_width BETWEEN 1 AND 4096),
  pixel_height INTEGER NOT NULL CHECK (pixel_height BETWEEN 1 AND 4096),
  was_normalized INTEGER NOT NULL CHECK (was_normalized IN (0, 1)),
  retained_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, attachment_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE,
  CHECK (
    retained_file_key = sha256 || CASE content_type
      WHEN 'image/jpeg' THEN '.jpg'
      WHEN 'image/png' THEN '.png'
      WHEN 'image/webp' THEN '.webp'
    END
  )
);

CREATE INDEX local_attachment_media_by_target
  ON local_attachment_media (
    account_user_id, root_event_id, target_entry_id, attachment_id
  );
`,
	},
	{
		version: 7,
		name: "community_feedback_cache",
		sql: `
CREATE TABLE community_feedback_cache (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  feedback_id TEXT NOT NULL CHECK (feedback_id LIKE 'fbk_%'),
  visibility TEXT NOT NULL CHECK (visibility IN ('public', 'private')),
  status TEXT NOT NULL CHECK (
    status IN ('open', 'planned', 'in_progress', 'completed', 'declined', 'duplicate')
  ),
  payload_json TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, feedback_id)
);

CREATE INDEX community_feedback_public_order
  ON community_feedback_cache (
    account_user_id, visibility, status, refreshed_at DESC, feedback_id DESC
  );

CREATE TABLE community_feedback_follows (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  feedback_id TEXT NOT NULL CHECK (feedback_id LIKE 'fbk_%'),
  followed_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, feedback_id)
);
`,
	},
	{
		version: 8,
		name: "golf_offline_read_models",
		sql: `
CREATE TABLE sync_snapshot_records_v8 (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (
    entity_type IN (
      'event', 'membership', 'invitation', 'place', 'capability',
      'itineraryItem', 'feedEntry', 'feedReaction', 'attachment',
      'golfRound', 'golfPlayer', 'golfScore', 'golfLeaderboard'
    )
  ),
  entity_id TEXT NOT NULL,
  entity_version INTEGER NOT NULL CHECK (entity_version > 0),
  data_json TEXT NOT NULL,
  PRIMARY KEY (
    account_user_id, root_event_id, snapshot_id, entity_type, entity_id
  ),
  FOREIGN KEY (account_user_id, root_event_id, snapshot_id)
    REFERENCES sync_snapshot_staging (
      account_user_id, root_event_id, snapshot_id
    ) ON DELETE CASCADE
);

CREATE TABLE golf_rounds (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  event_id TEXT NOT NULL CHECK (event_id LIKE 'evt_%'),
  version INTEGER NOT NULL CHECK (version > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, event_id),
  UNIQUE (account_user_id, event_id, root_event_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES events (account_user_id, id, root_event_id) ON DELETE CASCADE
);

CREATE TABLE golf_holes (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  hole INTEGER NOT NULL CHECK (hole BETWEEN 1 AND 18),
  par INTEGER NOT NULL CHECK (par BETWEEN 3 AND 6),
  stroke_index INTEGER NOT NULL CHECK (stroke_index BETWEEN 1 AND 18),
  PRIMARY KEY (account_user_id, event_id, hole),
  UNIQUE (account_user_id, event_id, stroke_index),
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES golf_rounds (account_user_id, event_id, root_event_id)
    ON DELETE CASCADE
);

CREATE TABLE golf_players (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL CHECK (user_id LIKE 'usr_%'),
  playing_handicap INTEGER NOT NULL CHECK (playing_handicap BETWEEN -99 AND 99),
  version INTEGER NOT NULL CHECK (version > 0),
  PRIMARY KEY (account_user_id, event_id, user_id),
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES golf_rounds (account_user_id, event_id, root_event_id)
    ON DELETE CASCADE
);

CREATE TABLE golf_teams (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'gtm_%'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  color TEXT,
  sort_position INTEGER NOT NULL CHECK (sort_position BETWEEN 0 AND 49),
  PRIMARY KEY (account_user_id, event_id, id),
  UNIQUE (account_user_id, event_id, sort_position),
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES golf_rounds (account_user_id, event_id, root_event_id)
    ON DELETE CASCADE,
  CHECK (
    color IS NULL OR color GLOB '#[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]'
  )
);

CREATE TABLE golf_team_members (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL CHECK (user_id LIKE 'usr_%'),
  PRIMARY KEY (account_user_id, event_id, team_id, user_id),
  UNIQUE (account_user_id, event_id, user_id),
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES golf_rounds (account_user_id, event_id, root_event_id)
    ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, event_id, team_id)
    REFERENCES golf_teams (account_user_id, event_id, id) ON DELETE CASCADE
);

CREATE TABLE golf_scores (
  account_user_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'gsc_%'),
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL CHECK (user_id LIKE 'usr_%'),
  hole INTEGER NOT NULL CHECK (hole BETWEEN 1 AND 18),
  strokes INTEGER CHECK (strokes IS NULL OR strokes BETWEEN 1 AND 99),
  putts INTEGER CHECK (putts IS NULL OR putts BETWEEN 0 AND 99),
  playing_handicap INTEGER NOT NULL CHECK (playing_handicap BETWEEN -99 AND 99),
  handicap_strokes INTEGER NOT NULL CHECK (handicap_strokes BETWEEN -99 AND 99),
  net_strokes INTEGER,
  stableford_points INTEGER NOT NULL CHECK (stableford_points BETWEEN 0 AND 6),
  version INTEGER NOT NULL CHECK (version > 0),
  root_revision TEXT NOT NULL CHECK (
    root_revision GLOB '[1-9]*' AND root_revision NOT GLOB '*[^0-9]*'
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, id),
  UNIQUE (account_user_id, event_id, user_id, hole),
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES golf_rounds (account_user_id, event_id, root_event_id)
    ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, event_id, hole)
    REFERENCES golf_holes (account_user_id, event_id, hole) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, event_id, user_id)
    REFERENCES golf_players (account_user_id, event_id, user_id) ON DELETE CASCADE,
  CHECK (
    (strokes IS NULL AND putts IS NULL AND net_strokes IS NULL AND stableford_points = 0) OR
    (strokes IS NOT NULL AND net_strokes = strokes - handicap_strokes)
  ),
  CHECK (id = 'gsc_' || event_id || ':' || user_id || ':' || hole)
);

CREATE INDEX golf_scores_by_player
  ON golf_scores (account_user_id, event_id, user_id, hole);

CREATE TABLE golf_leaderboards (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  PRIMARY KEY (account_user_id, event_id),
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES golf_rounds (account_user_id, event_id, root_event_id)
    ON DELETE CASCADE
);

CREATE TABLE golf_rankings (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL CHECK (user_id LIKE 'usr_%'),
  team_id TEXT,
  rank INTEGER NOT NULL CHECK (rank > 0),
  stableford_points INTEGER NOT NULL CHECK (stableford_points BETWEEN 0 AND 108),
  holes_completed INTEGER NOT NULL CHECK (holes_completed BETWEEN 0 AND 18),
  leaderboard_version INTEGER NOT NULL CHECK (leaderboard_version > 0),
  PRIMARY KEY (account_user_id, event_id, user_id),
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES golf_rounds (account_user_id, event_id, root_event_id)
    ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, event_id)
    REFERENCES golf_leaderboards (account_user_id, event_id) ON DELETE CASCADE
);

CREATE INDEX golf_rankings_order
  ON golf_rankings (
    account_user_id, event_id, stableford_points DESC, user_id
  );

CREATE TABLE golf_intent_streams (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  next_sequence INTEGER NOT NULL DEFAULT 1 CHECK (
    next_sequence BETWEEN 1 AND 9007199254740991
  ),
  PRIMARY KEY (account_user_id, root_event_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);

CREATE TABLE golf_score_intents (
  account_user_id TEXT NOT NULL,
  client_intent_id TEXT NOT NULL CHECK (client_intent_id LIKE 'gsi_%'),
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  score_id TEXT NOT NULL CHECK (score_id LIKE 'gsc_%'),
  user_id TEXT NOT NULL CHECK (user_id LIKE 'usr_%'),
  hole INTEGER NOT NULL CHECK (hole BETWEEN 1 AND 18),
  client_sequence INTEGER NOT NULL CHECK (
    client_sequence BETWEEN 1 AND 9007199254740990
  ),
  base_version INTEGER NOT NULL CHECK (base_version >= 0),
  strokes INTEGER CHECK (strokes IS NULL OR strokes BETWEEN 1 AND 99),
  putts INTEGER CHECK (putts IS NULL OR putts BETWEEN 0 AND 99),
  playing_handicap INTEGER NOT NULL CHECK (playing_handicap BETWEEN -99 AND 99),
  handicap_strokes INTEGER NOT NULL CHECK (handicap_strokes BETWEEN -99 AND 99),
  net_strokes INTEGER,
  stableford_points INTEGER NOT NULL CHECK (stableford_points BETWEEN 0 AND 6),
  command_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'awaiting_pull', 'converged')),
  applied_entity_version INTEGER CHECK (
    applied_entity_version IS NULL OR applied_entity_version > 0
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, client_intent_id),
  UNIQUE (account_user_id, root_event_id, client_sequence),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE,
  CHECK (
    (strokes IS NULL AND putts IS NULL AND net_strokes IS NULL AND stableford_points = 0) OR
    (strokes IS NOT NULL AND net_strokes = strokes - handicap_strokes)
  ),
  CHECK (
    (state = 'pending' AND applied_entity_version IS NULL) OR
    (state IN ('awaiting_pull', 'converged') AND applied_entity_version IS NOT NULL)
  ),
  CHECK (user_id = account_user_id),
  CHECK (score_id = 'gsc_' || event_id || ':' || user_id || ':' || hole)
);

CREATE INDEX golf_score_intents_pending
  ON golf_score_intents (
    account_user_id, root_event_id, state, client_sequence
  );

CREATE TRIGGER golf_score_intent_command_immutable
BEFORE UPDATE OF account_user_id, client_intent_id, root_event_id, event_id,
  score_id, user_id, hole, client_sequence, base_version, strokes, putts,
  playing_handicap, handicap_strokes, net_strokes, stableford_points,
  command_json, created_at
ON golf_score_intents
BEGIN
  SELECT RAISE(ABORT, 'golf score intents are immutable');
END;
`,
		copyStatements: [
			`INSERT INTO sync_snapshot_records_v8
SELECT account_user_id, root_event_id, snapshot_id, entity_type, entity_id,
  entity_version, data_json
FROM sync_snapshot_records`,
		],
		preservedTables: ["sync_snapshot_records"],
		finalizeSql: `
DROP TABLE sync_snapshot_records;
ALTER TABLE sync_snapshot_records_v8 RENAME TO sync_snapshot_records;

CREATE INDEX sync_snapshot_records_by_type
  ON sync_snapshot_records (
    account_user_id, root_event_id, snapshot_id, entity_type, entity_id
  );
`,
	},
	{
		version: 9,
		name: "golf_intent_outbox_link",
		sql: `
ALTER TABLE golf_score_intents ADD COLUMN outbox_client_mutation_id TEXT;

CREATE UNIQUE INDEX golf_score_intents_outbox_link
  ON golf_score_intents (account_user_id, outbox_client_mutation_id)
  WHERE outbox_client_mutation_id IS NOT NULL;

CREATE TRIGGER golf_score_intent_outbox_link_immutable
BEFORE UPDATE OF outbox_client_mutation_id ON golf_score_intents
WHEN old.outbox_client_mutation_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'golf score intent outbox links are immutable');
END;
`,
	},
	{
		version: 10,
		name: "golf_manager_roster_projection",
		sql: `
CREATE TABLE sync_snapshot_records_v10 (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (
    entity_type IN (
      'event', 'membership', 'invitation', 'place', 'capability',
      'itineraryItem', 'feedEntry', 'feedReaction', 'attachment',
      'golfRound', 'golfRoster', 'golfPlayer', 'golfScore', 'golfLeaderboard'
    )
  ),
  entity_id TEXT NOT NULL,
  entity_version INTEGER NOT NULL CHECK (entity_version > 0),
  data_json TEXT NOT NULL,
  PRIMARY KEY (
    account_user_id, root_event_id, snapshot_id, entity_type, entity_id
  ),
  FOREIGN KEY (account_user_id, root_event_id, snapshot_id)
    REFERENCES sync_snapshot_staging (
      account_user_id, root_event_id, snapshot_id
    ) ON DELETE CASCADE
);

CREATE TABLE golf_roster_players (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  event_id TEXT NOT NULL CHECK (event_id LIKE 'evt_%'),
  user_id TEXT NOT NULL CHECK (
    length(user_id) = 36 AND substr(user_id, 1, 4) = 'usr_' AND
    substr(user_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  playing_handicap INTEGER NOT NULL CHECK (playing_handicap BETWEEN -99 AND 99),
  roster_version INTEGER NOT NULL CHECK (
    roster_version BETWEEN 1 AND 9007199254740991
  ),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, event_id, user_id),
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES golf_rounds (account_user_id, event_id, root_event_id)
    ON DELETE CASCADE
);
`,
		copyStatements: [
			`INSERT INTO sync_snapshot_records_v10
SELECT account_user_id, root_event_id, snapshot_id, entity_type, entity_id,
  entity_version, data_json
FROM sync_snapshot_records`,
		],
		preservedTables: ["sync_snapshot_records"],
		finalizeSql: `
DROP TABLE sync_snapshot_records;
ALTER TABLE sync_snapshot_records_v10 RENAME TO sync_snapshot_records;

CREATE INDEX sync_snapshot_records_by_type
  ON sync_snapshot_records (
    account_user_id, root_event_id, snapshot_id, entity_type, entity_id
  );
`,
	},
	{
		version: 11,
		name: "golf_player_tombstones",
		sql: `
CREATE TABLE sync_tombstones_v11 (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (
    entity_type IN (
      'event', 'invitation', 'capability', 'itineraryItem',
      'feedEntry', 'feedReaction', 'golfPlayer'
    )
  ),
  entity_id TEXT NOT NULL,
  entity_version INTEGER NOT NULL CHECK (entity_version > 0),
  root_revision TEXT NOT NULL CHECK (
    root_revision = '0' OR (
      root_revision GLOB '[1-9]*' AND root_revision NOT GLOB '*[^0-9]*'
    )
  ),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  deleted_at TEXT NOT NULL,
  tombstone_json TEXT NOT NULL,
  PRIMARY KEY (account_user_id, root_event_id, entity_type, entity_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);
`,
		copyStatements: [
			`INSERT INTO sync_tombstones_v11
SELECT account_user_id, root_event_id, entity_type, entity_id, entity_version,
  root_revision, ordinal, deleted_at, tombstone_json
FROM sync_tombstones`,
		],
		preservedTables: ["sync_tombstones"],
		finalizeSql: `
DROP TABLE sync_tombstones;
ALTER TABLE sync_tombstones_v11 RENAME TO sync_tombstones;

CREATE INDEX sync_tombstones_by_root
  ON sync_tombstones (
    account_user_id, root_event_id, entity_type, entity_id
  );
`,
	},
	{
		version: 12,
		name: "sanitized_root_community_feedback",
		sql: `
DROP TABLE community_feedback_follows;
DROP TABLE community_feedback_cache;

CREATE TABLE community_feedback_cache (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  feedback_id TEXT NOT NULL CHECK (feedback_id LIKE 'fbk_%'),
  status TEXT NOT NULL CHECK (
    status IN ('open', 'planned', 'in_progress', 'completed', 'declined')
  ),
  version INTEGER NOT NULL CHECK (version > 0),
  followed INTEGER NOT NULL CHECK (followed IN (0, 1)),
  updated_at TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  detail_json TEXT,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, root_event_id, feedback_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);

CREATE INDEX community_feedback_root_order
  ON community_feedback_cache (
    account_user_id, root_event_id, status, updated_at DESC, feedback_id DESC
  );

CREATE TABLE community_feedback_updates (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  feedback_id TEXT NOT NULL CHECK (feedback_id LIKE 'fbk_%'),
  version INTEGER NOT NULL CHECK (version > 0),
  changed_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, root_event_id, feedback_id, version),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);

CREATE INDEX community_feedback_updates_root_order
  ON community_feedback_updates (
    account_user_id, root_event_id,
    changed_at DESC, feedback_id DESC, version DESC
  );
`,
	},
	{
		version: 13,
		name: "team_collaboration_read_models",
		sql: `
CREATE TABLE sync_snapshot_records_v13 (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (
    entity_type IN (
      'event', 'membership', 'invitation', 'place', 'capability',
      'itineraryItem', 'feedEntry', 'feedReaction', 'attachment',
      'golfRound', 'golfRoster', 'golfPlayer', 'golfScore', 'golfLeaderboard',
      'teamAssignmentSet', 'teamAssignmentRoster', 'teamAssignment',
      'teamDecision', 'teamResponse'
    )
  ),
  entity_id TEXT NOT NULL,
  entity_version INTEGER NOT NULL CHECK (entity_version > 0),
  data_json TEXT NOT NULL,
  PRIMARY KEY (
    account_user_id, root_event_id, snapshot_id, entity_type, entity_id
  ),
  FOREIGN KEY (account_user_id, root_event_id, snapshot_id)
    REFERENCES sync_snapshot_staging (
      account_user_id, root_event_id, snapshot_id
    ) ON DELETE CASCADE
);

CREATE TABLE sync_tombstones_v13 (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (
    entity_type IN (
      'event', 'invitation', 'capability', 'itineraryItem',
      'feedEntry', 'feedReaction', 'golfPlayer', 'teamAssignment'
    )
  ),
  entity_id TEXT NOT NULL,
  entity_version INTEGER NOT NULL CHECK (entity_version > 0),
  root_revision TEXT NOT NULL CHECK (
    root_revision = '0' OR (
      root_revision GLOB '[1-9]*' AND root_revision NOT GLOB '*[^0-9]*'
    )
  ),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  deleted_at TEXT NOT NULL,
  tombstone_json TEXT NOT NULL,
  PRIMARY KEY (account_user_id, root_event_id, entity_type, entity_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);

CREATE TABLE team_assignment_sets (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  event_id TEXT NOT NULL CHECK (event_id LIKE 'evt_%'),
  version INTEGER NOT NULL CHECK (version > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, event_id),
  UNIQUE (account_user_id, event_id, root_event_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES events (account_user_id, id, root_event_id) ON DELETE CASCADE
);

CREATE TABLE team_assignment_teams (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'ttm_%'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  color TEXT CHECK (
    color IS NULL OR color GLOB '#[0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F]'
  ),
  sort_position INTEGER NOT NULL CHECK (sort_position BETWEEN 0 AND 99),
  assignment_version INTEGER NOT NULL CHECK (assignment_version > 0),
  PRIMARY KEY (account_user_id, event_id, id),
  UNIQUE (account_user_id, event_id, sort_position),
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES team_assignment_sets (account_user_id, event_id, root_event_id)
    ON DELETE CASCADE
);

CREATE TABLE team_assignment_roster_members (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL CHECK (user_id LIKE 'usr_%'),
  roster_version INTEGER NOT NULL CHECK (roster_version > 0),
  PRIMARY KEY (account_user_id, event_id, user_id),
  FOREIGN KEY (account_user_id, event_id, team_id)
    REFERENCES team_assignment_teams (account_user_id, event_id, id)
    ON DELETE CASCADE
);

CREATE INDEX team_assignment_roster_by_team
  ON team_assignment_roster_members (
    account_user_id, root_event_id, event_id, team_id, user_id
  );

CREATE TABLE team_own_assignments (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL CHECK (user_id = account_user_id),
  team_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, event_id),
  FOREIGN KEY (account_user_id, event_id, team_id)
    REFERENCES team_assignment_teams (account_user_id, event_id, id)
    ON DELETE CASCADE
);

CREATE TABLE team_decisions (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  id TEXT NOT NULL CHECK (id LIKE 'tdc_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  event_id TEXT NOT NULL CHECK (event_id LIKE 'evt_%'),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  state TEXT NOT NULL CHECK (state IN ('draft', 'open', 'closed')),
  version INTEGER NOT NULL CHECK (version > 0),
  aggregate_version INTEGER NOT NULL CHECK (aggregate_version > 0),
  response_count INTEGER NOT NULL CHECK (response_count >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, id),
  UNIQUE (account_user_id, id, root_event_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, event_id, root_event_id)
    REFERENCES events (account_user_id, id, root_event_id) ON DELETE CASCADE
);

CREATE INDEX team_decisions_by_event
  ON team_decisions (
    account_user_id, root_event_id, event_id, state, updated_at, id
  );

CREATE TABLE team_decision_options (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'tdo_%'),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 160),
  response_count INTEGER NOT NULL CHECK (response_count >= 0),
  sort_position INTEGER NOT NULL CHECK (sort_position BETWEEN 0 AND 19),
  aggregate_version INTEGER NOT NULL CHECK (aggregate_version > 0),
  PRIMARY KEY (account_user_id, decision_id, id),
  UNIQUE (account_user_id, decision_id, sort_position),
  FOREIGN KEY (account_user_id, decision_id, root_event_id)
    REFERENCES team_decisions (account_user_id, id, root_event_id)
    ON DELETE CASCADE
);

CREATE TABLE team_own_responses (
  account_user_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id LIKE 'trp_%'),
  root_event_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  user_id TEXT NOT NULL CHECK (user_id = account_user_id),
  option_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  root_revision TEXT NOT NULL CHECK (
    root_revision GLOB '[1-9]*' AND root_revision NOT GLOB '*[^0-9]*'
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, id),
  UNIQUE (account_user_id, decision_id),
  FOREIGN KEY (account_user_id, decision_id, root_event_id)
    REFERENCES team_decisions (account_user_id, id, root_event_id)
    ON DELETE CASCADE,
  FOREIGN KEY (account_user_id, decision_id, option_id)
    REFERENCES team_decision_options (account_user_id, decision_id, id)
    ON DELETE CASCADE,
  CHECK (id = 'trp_' || decision_id || ':' || user_id)
);
`,
		copyStatements: [
			`INSERT INTO sync_snapshot_records_v13
SELECT account_user_id, root_event_id, snapshot_id, entity_type, entity_id,
  entity_version, data_json
FROM sync_snapshot_records`,
			`INSERT INTO sync_tombstones_v13
SELECT account_user_id, root_event_id, entity_type, entity_id, entity_version,
  root_revision, ordinal, deleted_at, tombstone_json
FROM sync_tombstones`,
		],
		preservedTables: ["sync_snapshot_records", "sync_tombstones"],
		finalizeSql: `
DROP TABLE sync_snapshot_records;
ALTER TABLE sync_snapshot_records_v13 RENAME TO sync_snapshot_records;

CREATE INDEX sync_snapshot_records_by_type
  ON sync_snapshot_records (
    account_user_id, root_event_id, snapshot_id, entity_type, entity_id
  );

DROP TABLE sync_tombstones;
ALTER TABLE sync_tombstones_v13 RENAME TO sync_tombstones;

CREATE INDEX sync_tombstones_by_root
  ON sync_tombstones (
    account_user_id, root_event_id, entity_type, entity_id
  );
`,
	},
	{
		version: 14,
		name: "sanitized_member_directory",
		sql: `
CREATE TABLE member_directory_state (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  cache_version INTEGER NOT NULL CHECK (cache_version > 0),
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, root_event_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);

CREATE TABLE member_directory_entries (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL,
  user_id TEXT NOT NULL CHECK (user_id LIKE 'usr_%'),
  display_name TEXT CHECK (
    display_name IS NULL OR length(display_name) BETWEEN 1 AND 120
  ),
  PRIMARY KEY (account_user_id, root_event_id, user_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES member_directory_state (account_user_id, root_event_id)
    ON DELETE CASCADE
);

CREATE INDEX member_directory_entries_by_root
  ON member_directory_entries (account_user_id, root_event_id, user_id);
`,
	},
	{
		version: 15,
		name: "authorized_recap_snapshots",
		sql: `
CREATE TABLE authorized_recap_cache (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  recap_version INTEGER NOT NULL CHECK (recap_version > 0),
  lifecycle_version INTEGER NOT NULL CHECK (lifecycle_version > 0),
  state TEXT NOT NULL CHECK (state IN ('draft', 'published')),
  snapshot_json TEXT NOT NULL,
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, root_event_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);

CREATE TABLE recap_command_attempts (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  action TEXT NOT NULL CHECK (
    action IN ('generate', 'publish', 'remove', 'share', 'revoke')
  ),
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) BETWEEN 1 AND 512),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, root_event_id, action),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);
`,
	},
	{
		version: 16,
		name: "actor_event_root_index",
		sql: `
CREATE TABLE actor_event_root_index_state (
  account_user_id TEXT PRIMARY KEY CHECK (account_user_id LIKE 'usr_%'),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  cache_version INTEGER NOT NULL CHECK (cache_version > 0),
  refreshed_at TEXT NOT NULL
);

CREATE TABLE actor_event_root_index_entries (
  account_user_id TEXT NOT NULL,
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  kind TEXT NOT NULL CHECK (
    kind IN ('trip', 'day', 'golf', 'team_event', 'session', 'activity', 'other')
  ),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  time_zone TEXT NOT NULL CHECK (length(time_zone) BETWEEN 1 AND 100),
  starts_at TEXT,
  ends_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'cancelled')),
  version INTEGER NOT NULL CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  role TEXT NOT NULL CHECK (
    role IN ('owner', 'organizer', 'participant', 'viewer')
  ),
  membership_status TEXT NOT NULL CHECK (membership_status = 'active'),
  PRIMARY KEY (account_user_id, root_event_id),
  FOREIGN KEY (account_user_id)
    REFERENCES actor_event_root_index_state (account_user_id) ON DELETE CASCADE,
  CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);

CREATE INDEX actor_event_root_index_order
  ON actor_event_root_index_entries (account_user_id, root_event_id);

CREATE TABLE actor_event_root_selection (
  account_user_id TEXT PRIMARY KEY,
  root_event_id TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES actor_event_root_index_entries (account_user_id, root_event_id)
    ON DELETE CASCADE
);
`,
	},
	{
		version: 17,
		name: "durable_feedback_submissions",
		sql: `
CREATE TABLE feedback_submissions (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  feedback_id TEXT NOT NULL CHECK (
    feedback_id LIKE 'fbk_%' AND length(feedback_id) BETWEEN 5 AND 100
  ),
  command_json TEXT CHECK (
    command_json IS NULL OR length(command_json) BETWEEN 1 AND 32768
  ),
  command_fingerprint TEXT NOT NULL CHECK (
    length(command_fingerprint) = 64 AND
    command_fingerprint NOT GLOB '*[^a-f0-9]*'
  ),
  idempotency_key TEXT NOT NULL CHECK (
    length(idempotency_key) BETWEEN 8 AND 128
  ),
  state TEXT NOT NULL CHECK (
    state IN ('pending', 'sending', 'attention', 'delivered')
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  next_attempt_at TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  last_error_code TEXT CHECK (
    last_error_code IS NULL OR last_error_code IN (
      'auth_required', 'denied', 'invalid', 'invalid_response', 'network',
      'rate_limited', 'retry_exhausted', 'service_unavailable', 'unknown'
    )
  ),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT,
  PRIMARY KEY (account_user_id, feedback_id),
  UNIQUE (account_user_id, idempotency_key),
  CHECK ((state = 'delivered') = (delivered_at IS NOT NULL)),
  CHECK ((state = 'delivered') = (command_json IS NULL)),
  CHECK (
    (state = 'sending' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (state <> 'sending' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX feedback_submissions_delivery
  ON feedback_submissions (account_user_id, state, next_attempt_at, created_at);

CREATE TRIGGER feedback_submissions_command_immutable
BEFORE UPDATE OF account_user_id, feedback_id, command_fingerprint,
  idempotency_key, created_at
ON feedback_submissions
BEGIN
  SELECT RAISE(ABORT, 'feedback submissions are immutable');
END;

CREATE TRIGGER feedback_submissions_command_redaction_only
BEFORE UPDATE OF command_json ON feedback_submissions
WHEN NOT (
  old.command_json IS NOT NULL AND new.command_json IS NULL AND
  new.state = 'delivered'
)
BEGIN
  SELECT RAISE(ABORT, 'feedback command can only be redacted after delivery');
END;
`,
	},
	{
		version: 18,
		name: "event_publish_readiness",
		sql: `
CREATE TABLE event_publish_readiness_cache (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  root_version INTEGER NOT NULL CHECK (root_version > 0),
  root_revision TEXT NOT NULL CHECK (
    root_revision GLOB '[1-9]*' AND root_revision NOT GLOB '*[^0-9]*'
  ),
  ready INTEGER NOT NULL CHECK (ready IN (0, 1)),
  snapshot_json TEXT NOT NULL CHECK (length(snapshot_json) BETWEEN 1 AND 262144),
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, root_event_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);

CREATE TABLE event_publish_attempts (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) BETWEEN 1 AND 256),
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  attempted_readiness_json TEXT NOT NULL CHECK (
    length(attempted_readiness_json) BETWEEN 1 AND 262144
  ),
  conflicted_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, root_event_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);

CREATE TABLE event_publish_guards (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  lease_owner TEXT NOT NULL CHECK (length(lease_owner) BETWEEN 8 AND 128),
  expires_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, root_event_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);
`,
	},
	{
		version: 19,
		name: "feedback_screenshot_delivery",
		sql: `
CREATE TABLE feedback_screenshot_attachments (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  feedback_id TEXT NOT NULL CHECK (
    feedback_id LIKE 'fbk_%' AND length(feedback_id) BETWEEN 5 AND 100
  ),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  attachment_id TEXT NOT NULL CHECK (
    attachment_id LIKE 'att_%' AND length(attachment_id) BETWEEN 5 AND 100
  ),
  retained_file_key TEXT NOT NULL CHECK (
    retained_file_key NOT GLOB '*[\\/]*'
  ),
  content_type TEXT NOT NULL CHECK (content_type = 'image/png'),
  byte_count INTEGER NOT NULL CHECK (byte_count BETWEEN 1 AND 20971520),
  sha256 TEXT NOT NULL CHECK (
    length(sha256) = 64 AND sha256 NOT GLOB '*[^a-f0-9]*'
  ),
  pixel_width INTEGER NOT NULL CHECK (pixel_width BETWEEN 1 AND 2048),
  pixel_height INTEGER NOT NULL CHECK (pixel_height BETWEEN 1 AND 2048),
  was_normalized INTEGER NOT NULL CHECK (was_normalized = 1),
  state TEXT NOT NULL CHECK (
    state IN (
      'retained', 'consented', 'prepared', 'uploaded', 'committed',
      'attention', 'omitted'
    )
  ),
  upload_generation INTEGER NOT NULL DEFAULT 1 CHECK (
    upload_generation BETWEEN 1 AND 20
  ),
  upload_id TEXT CHECK (
    upload_id IS NULL OR
    (upload_id LIKE 'upl_%' AND length(upload_id) BETWEEN 5 AND 100)
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  last_error_code TEXT CHECK (
    last_error_code IS NULL OR last_error_code IN (
      'attachment_missing', 'attachment_storage', 'attachment_unavailable',
      'attachment_unsafe', 'auth_required', 'denied', 'invalid',
      'invalid_response', 'network', 'rate_limited', 'retry_exhausted',
      'service_unavailable', 'unknown', 'upload_expired',
      'verification_pending'
    )
  ),
  retained_at TEXT NOT NULL,
  consented_at TEXT,
  committed_at TEXT,
  omitted_at TEXT,
  feedback_send_started_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, feedback_id),
  UNIQUE (account_user_id, attachment_id),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE,
  CHECK (retained_file_key = sha256 || '.png'),
  CHECK ((state = 'retained') = (consented_at IS NULL)),
  CHECK (
    (state IN ('prepared', 'uploaded', 'committed') AND upload_id IS NOT NULL)
    OR
    (state IN ('retained', 'consented', 'omitted') AND upload_id IS NULL)
    OR state = 'attention'
  ),
  CHECK ((state = 'committed') = (committed_at IS NOT NULL)),
  CHECK ((state = 'omitted') = (omitted_at IS NOT NULL)),
  CHECK (
    feedback_send_started_at IS NULL OR state IN ('committed', 'omitted')
  )
);

CREATE INDEX feedback_screenshot_attachments_delivery
  ON feedback_screenshot_attachments (
    account_user_id, state, updated_at, feedback_id
  );

ALTER TABLE feedback_submissions ADD COLUMN screenshot_attachment_id TEXT
  CHECK (
    screenshot_attachment_id IS NULL OR
    (
      screenshot_attachment_id LIKE 'att_%' AND
      length(screenshot_attachment_id) BETWEEN 5 AND 100
    )
  );

ALTER TABLE feedback_submissions ADD COLUMN root_event_id TEXT
  CHECK (
    root_event_id IS NULL OR
    (root_event_id LIKE 'evt_%' AND length(root_event_id) BETWEEN 5 AND 100)
  );

UPDATE feedback_submissions
SET root_event_id = json_extract(command_json, '$.rootEventId')
WHERE command_json IS NOT NULL;

CREATE TRIGGER feedback_submission_screenshot_binding_immutable
BEFORE UPDATE OF screenshot_attachment_id ON feedback_submissions
BEGIN
  SELECT RAISE(ABORT, 'feedback screenshot binding is immutable');
END;

CREATE TRIGGER feedback_submission_root_scope_immutable
BEFORE UPDATE OF root_event_id ON feedback_submissions
BEGIN
  SELECT RAISE(ABORT, 'feedback root scope is immutable');
END;

CREATE TRIGGER feedback_screenshot_identity_immutable
BEFORE UPDATE OF account_user_id, feedback_id, root_event_id, attachment_id,
  retained_file_key, content_type, byte_count, sha256, pixel_width,
  pixel_height, was_normalized, retained_at, created_at
ON feedback_screenshot_attachments
BEGIN
  SELECT RAISE(ABORT, 'feedback screenshot identity is immutable');
END;

CREATE TRIGGER feedback_screenshot_choice_frozen
BEFORE UPDATE OF state ON feedback_screenshot_attachments
WHEN old.feedback_send_started_at IS NOT NULL AND new.state <> old.state
BEGIN
  SELECT RAISE(ABORT, 'feedback screenshot choice is already sending');
END;

CREATE TRIGGER feedback_screenshot_send_start_immutable
BEFORE UPDATE OF feedback_send_started_at ON feedback_screenshot_attachments
WHEN old.feedback_send_started_at IS NOT NULL
  AND new.feedback_send_started_at <> old.feedback_send_started_at
BEGIN
  SELECT RAISE(ABORT, 'feedback send start is immutable');
END;

CREATE TRIGGER feedback_screenshot_requires_unbound_feedback
BEFORE INSERT ON feedback_screenshot_attachments
WHEN EXISTS (
  SELECT 1 FROM feedback_submissions submission
  WHERE submission.account_user_id = new.account_user_id
    AND submission.feedback_id = new.feedback_id
)
BEGIN
  SELECT RAISE(ABORT, 'feedback identity is already submitted');
END;
`,
	},
	{
		version: 20,
		name: "feedback_duplicate_suggestion_cache",
		sql: `
CREATE TABLE feedback_duplicate_suggestion_cache (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  query_hash TEXT NOT NULL CHECK (
    length(query_hash) = 64 AND query_hash NOT GLOB '*[^a-f0-9]*'
  ),
  feedback_id TEXT NOT NULL CHECK (
    feedback_id LIKE 'fbk_%' AND length(feedback_id) BETWEEN 5 AND 100
  ),
  rank INTEGER NOT NULL CHECK (rank BETWEEN 0 AND 4),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  status TEXT NOT NULL CHECK (
    status IN ('open', 'planned', 'in_progress', 'completed', 'declined')
  ),
  vote_count INTEGER NOT NULL CHECK (
    vote_count BETWEEN 0 AND 9007199254740991
  ),
  refreshed_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, root_event_id, query_hash, feedback_id),
  UNIQUE (account_user_id, root_event_id, query_hash, rank),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);

CREATE INDEX feedback_duplicate_suggestion_lookup
  ON feedback_duplicate_suggestion_cache (
    account_user_id, root_event_id, query_hash, rank
  );
`,
	},
	{
		version: 21,
		name: "recap_external_command_attempts",
		sql: `
CREATE TABLE recap_external_command_attempts (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  recap_version INTEGER NOT NULL CHECK (recap_version > 0),
  command_scope_hash TEXT NOT NULL CHECK (
    length(command_scope_hash) = 64 AND
    command_scope_hash NOT GLOB '*[^a-f0-9]*'
  ),
  request_fingerprint TEXT NOT NULL CHECK (
    length(request_fingerprint) = 64 AND
    request_fingerprint NOT GLOB '*[^a-f0-9]*'
  ),
  idempotency_key TEXT NOT NULL CHECK (
    length(idempotency_key) BETWEEN 8 AND 128
  ),
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_user_id, root_event_id, command_scope_hash),
  FOREIGN KEY (account_user_id, root_event_id)
    REFERENCES root_sync_state (account_user_id, root_event_id) ON DELETE CASCADE
);
`,
	},
	{
		version: 22,
		name: "root_scoped_mutation_stream_identity",
		sql: `
CREATE TABLE mutation_stream_identities (
  account_user_id TEXT NOT NULL CHECK (account_user_id LIKE 'usr_%'),
  root_event_id TEXT NOT NULL CHECK (root_event_id LIKE 'evt_%'),
  device_id TEXT NOT NULL CHECK (
    length(device_id) = 40 AND
    substr(device_id, 1, 4) = 'dvc_' AND
    substr(device_id, 13, 1) = '-' AND
    substr(device_id, 18, 1) = '-' AND
    substr(device_id, 19, 1) = '4' AND
    substr(device_id, 23, 1) = '-' AND
    substr(device_id, 24, 1) GLOB '[89ab]' AND
    substr(device_id, 28, 1) = '-' AND
    replace(substr(device_id, 5), '-', '') NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_user_id, root_event_id)
);

CREATE TRIGGER mutation_stream_identity_root_purge
AFTER DELETE ON root_sync_state
BEGIN
  DELETE FROM mutation_stream_identities
  WHERE account_user_id = old.account_user_id
    AND root_event_id = old.root_event_id;
END;
`,
	},
];

interface AppliedMigrationRow {
	version: number;
	name: string;
}

async function readRowCounts(
	executor: SqlExecutor,
	tables: readonly string[],
): Promise<ReadonlyMap<string, number>> {
	const counts = new Map<string, number>();
	for (const table of tables) {
		if (!/^[a-z_]+$/.test(table)) {
			throw new Error(`Unsafe migration table name: ${table}`);
		}
		const row = await executor.first<{ count: number }>(
			`SELECT COUNT(*) AS count FROM "${table}"`,
		);
		if (!row) throw new Error(`Could not count migration table ${table}`);
		counts.set(table, Number(row.count));
	}
	return counts;
}

export async function migrate(database: SqlDatabase): Promise<void> {
	await database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
	await database.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);

	const appliedRows = await database.all<AppliedMigrationRow>(
		"SELECT version, name FROM schema_migrations ORDER BY version",
	);
	const applied = new Map(
		appliedRows.map((row) => [Number(row.version), row.name]),
	);

	for (const row of appliedRows) {
		const known = migrations.find(
			(migration) => migration.version === Number(row.version),
		);
		if (!known || known.name !== row.name) {
			throw new Error(
				`Unknown or renamed SQLite migration ${row.version}:${row.name}`,
			);
		}
	}

	for (const migration of migrations) {
		if (applied.has(migration.version)) continue;
		await database.transaction(async (transaction) => {
			const preservedTables = migration.preservedTables ?? [];
			const countsBefore = await readRowCounts(transaction, preservedTables);
			await transaction.exec(migration.sql);
			for (const statement of migration.copyStatements ?? []) {
				await transaction.run(statement);
			}
			if (migration.finalizeSql) {
				await transaction.exec(migration.finalizeSql);
			}
			const countsAfter = await readRowCounts(transaction, preservedTables);
			for (const [table, countBefore] of countsBefore) {
				const countAfter = countsAfter.get(table);
				if (countAfter !== countBefore) {
					throw new Error(
						`Migration ${migration.version} changed ${table} row count from ${countBefore} to ${countAfter}`,
					);
				}
			}
			const foreignKeyViolations = await transaction.all(
				"PRAGMA foreign_key_check",
			);
			if (foreignKeyViolations.length > 0) {
				throw new Error(
					`Migration ${migration.version} left ${foreignKeyViolations.length} foreign-key violation(s)`,
				);
			}
			await transaction.run(
				"INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
				[migration.version, migration.name],
			);
		});
	}
}
