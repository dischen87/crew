import type { SqlDatabase } from "./database.ts";
import {
	applyBootstrapPage as applyBootstrapSyncPage,
	applyPullPage as applySyncPullPage,
	type SyncBootstrapPage,
	type SyncPullPage,
	type SyncReaction,
} from "./sync.ts";

export interface RootSyncState {
	accountUserId: string;
	rootEventId: string;
	pullCursor: string | null;
	snapshotId: string | null;
	snapshotRevision: string | null;
	authorizationScopeVersion: string;
	lastCompletedSyncAt: string | null;
}

export interface EventRecord {
	accountUserId: string;
	id: string;
	rootEventId: string;
	parentEventId: string | null;
	kind:
		| "trip"
		| "day"
		| "golf"
		| "team_event"
		| "session"
		| "activity"
		| "other";
	title: string;
	description: string | null;
	timeZone: string;
	startsAt: string | null;
	endsAt: string | null;
	sortKey: string;
	childOrderVersion: string;
	itineraryOrderVersion: string;
	status: "draft" | "published" | "cancelled" | "archived";
	version: number;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
}

export interface EventTreeNode extends EventRecord {
	depth: number;
}

export interface MembershipRecord {
	accountUserId: string;
	rootEventId: string;
	memberUserId: string;
	role: "owner" | "organizer" | "participant" | "viewer";
	status: "active" | "left" | "removed";
	version: number;
	createdAt: string;
	updatedAt: string;
}

export interface ItineraryRecord {
	accountUserId: string;
	id: string;
	rootEventId: string;
	eventId: string;
	title: string;
	notes: string | null;
	timeZone: string;
	startsAt: string | null;
	endsAt: string | null;
	allDay: boolean;
	sortKey: string;
	status: "active" | "cancelled" | "archived";
	detailsSchemaVersion: number;
	detailsJson: string;
	placeId: string | null;
	placeSnapshotJson: string | null;
	version: number;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
}

export interface FeedRecord {
	accountUserId: string;
	id: string;
	rootEventId: string;
	eventId: string | null;
	parentEntryId: string | null;
	actorUserId: string | null;
	kind: string;
	payloadSchemaVersion: number;
	payloadJson: string;
	rootRevision: string;
	createdRootRevision: string;
	revisionOrdinal: number | null;
	version: number;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
}

export interface DraftRecord {
	accountUserId: string;
	id: string;
	rootEventId: string;
	eventId: string | null;
	entityType: string;
	contentJson: string;
	createdAt: string;
	updatedAt: string;
}

export interface PublicPlaceRecord {
	id: string;
	name: string;
	locality: string | null;
	countryCode: string | null;
	latitude: number | null;
	longitude: number | null;
	provenanceJson: string;
	updatedAt: string;
}

export interface InvitationRecord {
	accountUserId: string;
	id: string;
	rootEventId: string;
	role: "organizer" | "participant" | "viewer";
	emailBound: boolean;
	expiresAt: string;
	maxUses: number;
	useCount: number;
	status: "active" | "revoked";
	version: number;
	createdAt: string;
	updatedAt: string;
}

export interface EventPlaceRecord {
	accountUserId: string;
	id: string;
	rootEventId: string;
	name: string;
	locality: string | null;
	countryCode: string;
	latitude: number | null;
	longitude: number | null;
	version: number;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
}

export interface CapabilityRecord {
	accountUserId: string;
	entityId: string;
	rootEventId: string;
	eventId: string;
	type: "travel" | "lodging" | "transport" | "golf" | "team";
	schemaVersion: number;
	configJson: string;
	version: number;
	createdAt: string;
	updatedAt: string;
	deletedAt: null;
}

export interface FeedReactionRecord {
	accountUserId: string;
	entityId: string;
	rootEventId: string;
	entryId: string;
	userId: string;
	reaction: SyncReaction;
	present: true;
	version: number;
	updatedAt: string;
}

export interface AttachmentRecord {
	accountUserId: string;
	id: string;
	rootEventId: string;
	target: { entityType: "feedEntry"; entityId: string };
	contentType: "image/jpeg" | "image/png" | "image/webp";
	byteCount: number;
	sha256: string;
	caption: string | null;
	version: number;
	createdAt: string;
}

interface EventRow {
	account_user_id: string;
	id: string;
	root_event_id: string;
	parent_event_id: string | null;
	kind: EventRecord["kind"];
	title: string;
	description: string | null;
	time_zone: string;
	starts_at: string | null;
	ends_at: string | null;
	sort_key: string;
	child_order_version: string;
	itinerary_order_version: string;
	status: EventRecord["status"];
	version: number;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
	depth?: number;
}

interface ItineraryRow {
	account_user_id: string;
	id: string;
	root_event_id: string;
	event_id: string;
	title: string;
	notes: string | null;
	time_zone: string;
	starts_at: string | null;
	ends_at: string | null;
	all_day: number;
	sort_key: string;
	status: ItineraryRecord["status"];
	details_schema_version: number;
	details_json: string;
	place_id: string | null;
	place_snapshot_json: string | null;
	version: number;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
}

function mapEvent(row: EventRow): EventRecord {
	return {
		accountUserId: row.account_user_id,
		id: row.id,
		rootEventId: row.root_event_id,
		parentEventId: row.parent_event_id,
		kind: row.kind,
		title: row.title,
		description: row.description,
		timeZone: row.time_zone,
		startsAt: row.starts_at,
		endsAt: row.ends_at,
		sortKey: row.sort_key,
		childOrderVersion: row.child_order_version,
		itineraryOrderVersion: row.itinerary_order_version,
		status: row.status,
		version: Number(row.version),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		deletedAt: row.deleted_at,
	};
}

function mapItinerary(row: ItineraryRow): ItineraryRecord {
	return {
		accountUserId: row.account_user_id,
		id: row.id,
		rootEventId: row.root_event_id,
		eventId: row.event_id,
		title: row.title,
		notes: row.notes,
		timeZone: row.time_zone,
		startsAt: row.starts_at,
		endsAt: row.ends_at,
		allDay: row.all_day === 1,
		sortKey: row.sort_key,
		status: row.status,
		detailsSchemaVersion: Number(row.details_schema_version),
		detailsJson: row.details_json,
		placeId: row.place_id,
		placeSnapshotJson: row.place_snapshot_json,
		version: Number(row.version),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		deletedAt: row.deleted_at,
	};
}

export class MobileDataStore {
	constructor(private readonly database: SqlDatabase) {}

	async applyBootstrapPage(
		accountUserId: string,
		expectedPageCursor: string | null,
		page: SyncBootstrapPage,
	): Promise<{ completed: boolean; nextCursor: string | null }> {
		return applyBootstrapSyncPage(
			this.database,
			accountUserId,
			expectedPageCursor,
			page,
		);
	}

	async applyPullPage(
		accountUserId: string,
		expectedPullCursor: string,
		page: SyncPullPage,
	): Promise<{ replayed: boolean }> {
		return applySyncPullPage(
			this.database,
			accountUserId,
			expectedPullCursor,
			page,
		);
	}

	async putRootSyncState(state: RootSyncState): Promise<void> {
		await this.database.run(
			`INSERT INTO root_sync_state (
  account_user_id, root_event_id, pull_cursor, snapshot_id, snapshot_revision,
  authorization_scope_version, last_completed_sync_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, root_event_id) DO UPDATE SET
  pull_cursor = excluded.pull_cursor,
  snapshot_id = excluded.snapshot_id,
  snapshot_revision = excluded.snapshot_revision,
  authorization_scope_version = excluded.authorization_scope_version,
  last_completed_sync_at = excluded.last_completed_sync_at`,
			[
				state.accountUserId,
				state.rootEventId,
				state.pullCursor,
				state.snapshotId,
				state.snapshotRevision,
				state.authorizationScopeVersion,
				state.lastCompletedSyncAt,
			],
		);
	}

	async getRootSyncState(
		accountUserId: string,
		rootEventId: string,
	): Promise<RootSyncState | null> {
		const row = await this.database.first<{
			account_user_id: string;
			root_event_id: string;
			pull_cursor: string | null;
			snapshot_id: string | null;
			snapshot_revision: string | null;
			authorization_scope_version: string;
			last_completed_sync_at: string | null;
		}>(
			`SELECT account_user_id, root_event_id, pull_cursor, snapshot_id, snapshot_revision,
       authorization_scope_version, last_completed_sync_at
FROM root_sync_state WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
		return row
			? {
					accountUserId: row.account_user_id,
					rootEventId: row.root_event_id,
					pullCursor: row.pull_cursor,
					snapshotId: row.snapshot_id,
					snapshotRevision: row.snapshot_revision,
					authorizationScopeVersion: row.authorization_scope_version,
					lastCompletedSyncAt: row.last_completed_sync_at,
				}
			: null;
	}

	async putEvent(event: EventRecord): Promise<void> {
		await this.database.run(
			`INSERT INTO events (
  account_user_id, id, root_event_id, parent_event_id, kind, title, description,
  time_zone, starts_at, ends_at, sort_key, child_order_version,
  itinerary_order_version, status, version, created_at, updated_at, deleted_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, id) DO UPDATE SET
  root_event_id = excluded.root_event_id,
  parent_event_id = excluded.parent_event_id,
  kind = excluded.kind,
  title = excluded.title,
  description = excluded.description,
  time_zone = excluded.time_zone,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  sort_key = excluded.sort_key,
  child_order_version = excluded.child_order_version,
  itinerary_order_version = excluded.itinerary_order_version,
  status = excluded.status,
  version = excluded.version,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at,
  deleted_at = excluded.deleted_at
WHERE excluded.version > events.version`,
			[
				event.accountUserId,
				event.id,
				event.rootEventId,
				event.parentEventId,
				event.kind,
				event.title,
				event.description,
				event.timeZone,
				event.startsAt,
				event.endsAt,
				event.sortKey,
				event.childOrderVersion,
				event.itineraryOrderVersion,
				event.status,
				event.version,
				event.createdAt,
				event.updatedAt,
				event.deletedAt,
			],
		);
	}

	async listEventTree(
		accountUserId: string,
		rootEventId: string,
	): Promise<readonly EventTreeNode[]> {
		const rows = await this.database.all<EventRow & { depth: number }>(
			`WITH RECURSIVE tree AS (
  SELECT e.*, 0 AS depth,
         printf('%020d', length(e.sort_key)) || e.sort_key || ':' || hex(e.id)
           AS order_path,
         ',' || hex(e.id) || ',' AS visited
  FROM events e
  WHERE e.account_user_id = ? AND e.root_event_id = ? AND e.id = ? AND e.deleted_at IS NULL
  UNION ALL
  SELECT child.*, tree.depth + 1,
         tree.order_path || '/' || printf('%020d', length(child.sort_key)) ||
           child.sort_key || ':' || hex(child.id),
         tree.visited || hex(child.id) || ','
  FROM events child
  JOIN tree
    ON child.account_user_id = tree.account_user_id
   AND child.root_event_id = tree.root_event_id
   AND child.parent_event_id = tree.id
  WHERE child.deleted_at IS NULL
    AND instr(tree.visited, ',' || hex(child.id) || ',') = 0
)
SELECT * FROM tree ORDER BY order_path`,
			[accountUserId, rootEventId, rootEventId],
		);
		return rows.map((row) => ({ ...mapEvent(row), depth: Number(row.depth) }));
	}

	async listEventAncestors(
		accountUserId: string,
		rootEventId: string,
		eventId: string,
	): Promise<readonly EventRecord[]> {
		const rows = await this.database.all<EventRow & { depth: number }>(
			`WITH RECURSIVE ancestors AS (
  SELECT e.*, 0 AS depth, ',' || hex(e.id) || ',' AS visited
  FROM events e
  WHERE e.account_user_id = ? AND e.root_event_id = ? AND e.id = ? AND e.deleted_at IS NULL
  UNION ALL
  SELECT parent.*, ancestors.depth + 1, ancestors.visited || hex(parent.id) || ','
  FROM events parent
  JOIN ancestors
    ON parent.account_user_id = ancestors.account_user_id
   AND parent.root_event_id = ancestors.root_event_id
   AND parent.id = ancestors.parent_event_id
  WHERE parent.deleted_at IS NULL
    AND instr(ancestors.visited, ',' || hex(parent.id) || ',') = 0
)
SELECT * FROM ancestors WHERE depth > 0 ORDER BY depth DESC`,
			[accountUserId, rootEventId, eventId],
		);
		return rows.map(mapEvent);
	}

	async putMembership(membership: MembershipRecord): Promise<void> {
		await this.database.run(
			`INSERT INTO memberships (
  account_user_id, root_event_id, member_user_id, role, status, version,
  created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, root_event_id, member_user_id) DO UPDATE SET
  role = excluded.role,
  status = excluded.status,
  version = excluded.version,
  updated_at = excluded.updated_at
WHERE excluded.version > memberships.version`,
			[
				membership.accountUserId,
				membership.rootEventId,
				membership.memberUserId,
				membership.role,
				membership.status,
				membership.version,
				membership.createdAt,
				membership.updatedAt,
			],
		);
	}

	async listMemberships(
		accountUserId: string,
		rootEventId: string,
	): Promise<readonly MembershipRecord[]> {
		const rows = await this.database.all<{
			account_user_id: string;
			root_event_id: string;
			member_user_id: string;
			role: MembershipRecord["role"];
			status: MembershipRecord["status"];
			version: number;
			created_at: string;
			updated_at: string;
		}>(
			`SELECT * FROM memberships
WHERE account_user_id = ? AND root_event_id = ?
ORDER BY status, role, member_user_id`,
			[accountUserId, rootEventId],
		);
		return rows.map((row) => ({
			accountUserId: row.account_user_id,
			rootEventId: row.root_event_id,
			memberUserId: row.member_user_id,
			role: row.role,
			status: row.status,
			version: Number(row.version),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}));
	}

	async putItineraryItem(item: ItineraryRecord): Promise<void> {
		await this.database.run(
			`INSERT INTO itinerary_items (
  account_user_id, id, root_event_id, event_id, title, notes, time_zone, starts_at, ends_at,
  all_day, sort_key, status, details_schema_version, details_json, place_id,
  place_snapshot_json, version, created_at, updated_at, deleted_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, id) DO UPDATE SET
  root_event_id = excluded.root_event_id,
  event_id = excluded.event_id,
  title = excluded.title,
  notes = excluded.notes,
  time_zone = excluded.time_zone,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  all_day = excluded.all_day,
  sort_key = excluded.sort_key,
  status = excluded.status,
  details_schema_version = excluded.details_schema_version,
  details_json = excluded.details_json,
  place_id = excluded.place_id,
  place_snapshot_json = excluded.place_snapshot_json,
  version = excluded.version,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at,
  deleted_at = excluded.deleted_at
WHERE excluded.version > itinerary_items.version`,
			[
				item.accountUserId,
				item.id,
				item.rootEventId,
				item.eventId,
				item.title,
				item.notes,
				item.timeZone,
				item.startsAt,
				item.endsAt,
				item.allDay ? 1 : 0,
				item.sortKey,
				item.status,
				item.detailsSchemaVersion,
				item.detailsJson,
				item.placeId,
				item.placeSnapshotJson,
				item.version,
				item.createdAt,
				item.updatedAt,
				item.deletedAt,
			],
		);
	}

	async listTimeline(
		accountUserId: string,
		rootEventId: string,
	): Promise<readonly ItineraryRecord[]> {
		const rows = await this.database.all<ItineraryRow>(
			`SELECT item.* FROM itinerary_items item
	JOIN events event
	  ON event.account_user_id = item.account_user_id
	 AND event.id = item.event_id
	 AND event.root_event_id = item.root_event_id
	WHERE item.account_user_id = ? AND item.root_event_id = ?
	  AND item.deleted_at IS NULL AND event.deleted_at IS NULL
	ORDER BY item.starts_at IS NULL,
	         CASE WHEN item.starts_at IS NOT NULL THEN item.starts_at END,
	         length(item.sort_key),
	         item.sort_key,
	         item.id`,
			[accountUserId, rootEventId],
		);
		return rows.map(mapItinerary);
	}

	async putFeedEntry(entry: FeedRecord): Promise<void> {
		await this.database.run(
			`INSERT INTO feed_entries (
  account_user_id, id, root_event_id, event_id, parent_entry_id, actor_user_id,
  kind, payload_schema_version, payload_json, root_revision,
  created_root_revision, revision_ordinal, version, created_at, updated_at,
  deleted_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, id) DO UPDATE SET
  event_id = excluded.event_id,
  payload_schema_version = excluded.payload_schema_version,
  payload_json = excluded.payload_json,
  root_revision = excluded.root_revision,
  revision_ordinal = excluded.revision_ordinal,
  version = excluded.version,
  updated_at = excluded.updated_at,
  deleted_at = excluded.deleted_at
WHERE excluded.version > feed_entries.version`,
			[
				entry.accountUserId,
				entry.id,
				entry.rootEventId,
				entry.eventId,
				entry.parentEntryId,
				entry.actorUserId,
				entry.kind,
				entry.payloadSchemaVersion,
				entry.payloadJson,
				entry.rootRevision,
				entry.createdRootRevision,
				entry.revisionOrdinal,
				entry.version,
				entry.createdAt,
				entry.updatedAt,
				entry.deletedAt,
			],
		);
	}

	async listFeed(
		accountUserId: string,
		rootEventId: string,
	): Promise<readonly FeedRecord[]> {
		const rows = await this.database.all<{
			account_user_id: string;
			id: string;
			root_event_id: string;
			event_id: string | null;
			parent_entry_id: string | null;
			actor_user_id: string | null;
			kind: string;
			payload_schema_version: number;
			payload_json: string;
			root_revision: string;
			created_root_revision: string;
			revision_ordinal: number | null;
			version: number;
			created_at: string;
			updated_at: string;
			deleted_at: string | null;
		}>(
			`SELECT entry.* FROM feed_entries entry
	LEFT JOIN events event
	  ON event.account_user_id = entry.account_user_id
	 AND event.id = entry.event_id
	 AND event.root_event_id = entry.root_event_id
	WHERE entry.account_user_id = ? AND entry.root_event_id = ?
	  AND entry.deleted_at IS NULL
	  AND (entry.event_id IS NULL OR event.deleted_at IS NULL)
	ORDER BY length(entry.created_root_revision) DESC,
	         entry.created_root_revision DESC, entry.id DESC`,
			[accountUserId, rootEventId],
		);
		return rows.map((row) => ({
			accountUserId: row.account_user_id,
			id: row.id,
			rootEventId: row.root_event_id,
			eventId: row.event_id,
			parentEntryId: row.parent_entry_id,
			actorUserId: row.actor_user_id,
			kind: row.kind,
			payloadSchemaVersion: Number(row.payload_schema_version),
			payloadJson: row.payload_json,
			rootRevision: row.root_revision,
			createdRootRevision: row.created_root_revision,
			revisionOrdinal:
				row.revision_ordinal === null ? null : Number(row.revision_ordinal),
			version: Number(row.version),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			deletedAt: row.deleted_at,
		}));
	}

	async putDraft(draft: DraftRecord): Promise<void> {
		await this.database.run(
			`INSERT INTO local_drafts (
  account_user_id, id, root_event_id, event_id, entity_type, content_json, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, id) DO UPDATE SET
  root_event_id = excluded.root_event_id,
  event_id = excluded.event_id,
  entity_type = excluded.entity_type,
  content_json = excluded.content_json,
  updated_at = excluded.updated_at`,
			[
				draft.accountUserId,
				draft.id,
				draft.rootEventId,
				draft.eventId,
				draft.entityType,
				draft.contentJson,
				draft.createdAt,
				draft.updatedAt,
			],
		);
	}

	async listDrafts(
		accountUserId: string,
		rootEventId: string,
	): Promise<readonly DraftRecord[]> {
		const rows = await this.database.all<{
			account_user_id: string;
			id: string;
			root_event_id: string;
			event_id: string | null;
			entity_type: string;
			content_json: string;
			created_at: string;
			updated_at: string;
		}>(
			`SELECT * FROM local_drafts
WHERE account_user_id = ? AND root_event_id = ?
ORDER BY updated_at, id`,
			[accountUserId, rootEventId],
		);
		return rows.map((row) => ({
			accountUserId: row.account_user_id,
			id: row.id,
			rootEventId: row.root_event_id,
			eventId: row.event_id,
			entityType: row.entity_type,
			contentJson: row.content_json,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}));
	}

	async listInvitations(
		accountUserId: string,
		rootEventId: string,
	): Promise<readonly InvitationRecord[]> {
		const rows = await this.database.all<{
			account_user_id: string;
			id: string;
			root_event_id: string;
			role: InvitationRecord["role"];
			email_bound: number;
			expires_at: string;
			max_uses: number;
			use_count: number;
			status: InvitationRecord["status"];
			version: number;
			created_at: string;
			updated_at: string;
		}>(
			`SELECT * FROM invitations
WHERE account_user_id = ? AND root_event_id = ?
ORDER BY status, expires_at, id`,
			[accountUserId, rootEventId],
		);
		return rows.map((row) => ({
			accountUserId: row.account_user_id,
			id: row.id,
			rootEventId: row.root_event_id,
			role: row.role,
			emailBound: row.email_bound === 1,
			expiresAt: row.expires_at,
			maxUses: Number(row.max_uses),
			useCount: Number(row.use_count),
			status: row.status,
			version: Number(row.version),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}));
	}

	async listEventPlaces(
		accountUserId: string,
		rootEventId: string,
	): Promise<readonly EventPlaceRecord[]> {
		const rows = await this.database.all<{
			account_user_id: string;
			id: string;
			root_event_id: string;
			name: string;
			locality: string | null;
			country_code: string;
			latitude: number | null;
			longitude: number | null;
			version: number;
			created_at: string;
			updated_at: string;
			deleted_at: string | null;
		}>(
			`SELECT * FROM event_places
WHERE account_user_id = ? AND root_event_id = ? AND deleted_at IS NULL
ORDER BY name, id`,
			[accountUserId, rootEventId],
		);
		return rows.map((row) => ({
			accountUserId: row.account_user_id,
			id: row.id,
			rootEventId: row.root_event_id,
			name: row.name,
			locality: row.locality,
			countryCode: row.country_code,
			latitude: row.latitude,
			longitude: row.longitude,
			version: Number(row.version),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			deletedAt: row.deleted_at,
		}));
	}

	async listCapabilities(
		accountUserId: string,
		rootEventId: string,
	): Promise<readonly CapabilityRecord[]> {
		const rows = await this.database.all<{
			account_user_id: string;
			entity_id: string;
			root_event_id: string;
			event_id: string;
			type: CapabilityRecord["type"];
			schema_version: number;
			config_json: string;
			version: number;
			created_at: string;
			updated_at: string;
			deleted_at: null;
		}>(
			`SELECT capability.* FROM event_capabilities capability
JOIN events event
  ON event.account_user_id = capability.account_user_id
 AND event.id = capability.event_id
 AND event.root_event_id = capability.root_event_id
WHERE capability.account_user_id = ? AND capability.root_event_id = ?
  AND capability.deleted_at IS NULL AND event.deleted_at IS NULL
ORDER BY capability.event_id, capability.type`,
			[accountUserId, rootEventId],
		);
		return rows.map((row) => ({
			accountUserId: row.account_user_id,
			entityId: row.entity_id,
			rootEventId: row.root_event_id,
			eventId: row.event_id,
			type: row.type,
			schemaVersion: Number(row.schema_version),
			configJson: row.config_json,
			version: Number(row.version),
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			deletedAt: null,
		}));
	}

	async listFeedReactions(
		accountUserId: string,
		rootEventId: string,
		entryId?: string,
	): Promise<readonly FeedReactionRecord[]> {
		const rows = await this.database.all<{
			account_user_id: string;
			entity_id: string;
			root_event_id: string;
			entry_id: string;
			user_id: string;
			reaction: SyncReaction;
			present: number;
			version: number;
			updated_at: string;
		}>(
			`SELECT reaction.* FROM feed_reactions reaction
JOIN feed_entries entry
  ON entry.account_user_id = reaction.account_user_id
 AND entry.id = reaction.entry_id
 AND entry.root_event_id = reaction.root_event_id
LEFT JOIN events event
  ON event.account_user_id = entry.account_user_id
 AND event.id = entry.event_id
 AND event.root_event_id = entry.root_event_id
WHERE reaction.account_user_id = ? AND reaction.root_event_id = ?
  AND (? IS NULL OR reaction.entry_id = ?)
  AND entry.deleted_at IS NULL
  AND (entry.event_id IS NULL OR event.deleted_at IS NULL)
ORDER BY reaction.entry_id, reaction.reaction, reaction.user_id`,
			[accountUserId, rootEventId, entryId ?? null, entryId ?? null],
		);
		return rows.map((row) => ({
			accountUserId: row.account_user_id,
			entityId: row.entity_id,
			rootEventId: row.root_event_id,
			entryId: row.entry_id,
			userId: row.user_id,
			reaction: row.reaction,
			present: true,
			version: Number(row.version),
			updatedAt: row.updated_at,
		}));
	}

	async listAttachments(
		accountUserId: string,
		rootEventId: string,
		targetEntryId?: string,
	): Promise<readonly AttachmentRecord[]> {
		const rows = await this.database.all<{
			account_user_id: string;
			id: string;
			root_event_id: string;
			target_entity_type: "feedEntry";
			target_entity_id: string;
			content_type: AttachmentRecord["contentType"];
			byte_count: number;
			sha256: string;
			caption: string | null;
			version: number;
			created_at: string;
		}>(
			`SELECT attachment.* FROM attachments attachment
JOIN feed_entries entry
  ON entry.account_user_id = attachment.account_user_id
 AND entry.id = attachment.target_entity_id
 AND entry.root_event_id = attachment.root_event_id
LEFT JOIN events event
  ON event.account_user_id = entry.account_user_id
 AND event.id = entry.event_id
 AND event.root_event_id = entry.root_event_id
WHERE attachment.account_user_id = ? AND attachment.root_event_id = ?
  AND (? IS NULL OR attachment.target_entity_id = ?)
  AND entry.deleted_at IS NULL
  AND (entry.event_id IS NULL OR event.deleted_at IS NULL)
ORDER BY attachment.target_entity_id, attachment.id`,
			[
				accountUserId,
				rootEventId,
				targetEntryId ?? null,
				targetEntryId ?? null,
			],
		);
		return rows.map((row) => ({
			accountUserId: row.account_user_id,
			id: row.id,
			rootEventId: row.root_event_id,
			target: {
				entityType: row.target_entity_type,
				entityId: row.target_entity_id,
			},
			contentType: row.content_type,
			byteCount: Number(row.byte_count),
			sha256: row.sha256,
			caption: row.caption,
			version: Number(row.version),
			createdAt: row.created_at,
		}));
	}

	async putPublicPlace(place: PublicPlaceRecord): Promise<void> {
		await this.database.run(
			`INSERT INTO public_places (
  id, name, locality, country_code, latitude, longitude, provenance_json, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  locality = excluded.locality,
  country_code = excluded.country_code,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  provenance_json = excluded.provenance_json,
  updated_at = excluded.updated_at`,
			[
				place.id,
				place.name,
				place.locality,
				place.countryCode,
				place.latitude,
				place.longitude,
				place.provenanceJson,
				place.updatedAt,
			],
		);
	}

	async getPublicPlace(id: string): Promise<PublicPlaceRecord | null> {
		const row = await this.database.first<{
			id: string;
			name: string;
			locality: string | null;
			country_code: string | null;
			latitude: number | null;
			longitude: number | null;
			provenance_json: string;
			updated_at: string;
		}>("SELECT * FROM public_places WHERE id = ?", [id]);
		return row
			? {
					id: row.id,
					name: row.name,
					locality: row.locality,
					countryCode: row.country_code,
					latitude: row.latitude,
					longitude: row.longitude,
					provenanceJson: row.provenance_json,
					updatedAt: row.updated_at,
				}
			: null;
	}

	async clearUserData(accountUserId: string): Promise<void> {
		await this.database.transaction(async (transaction) => {
			await transaction.run(
				"DELETE FROM feedback_screenshot_attachments WHERE account_user_id = ?",
				[accountUserId],
			);
			await transaction.run(
				"DELETE FROM feedback_submissions WHERE account_user_id = ?",
				[accountUserId],
			);
			await transaction.run(
				"DELETE FROM actor_event_root_index_state WHERE account_user_id = ?",
				[accountUserId],
			);
			await transaction.run(
				"DELETE FROM community_feedback_updates WHERE account_user_id = ?",
				[accountUserId],
			);
			await transaction.run(
				"DELETE FROM community_feedback_manager_write_attempts WHERE account_user_id = ?",
				[accountUserId],
			);
			await transaction.run(
				"DELETE FROM community_feedback_cache WHERE account_user_id = ?",
				[accountUserId],
			);
			await transaction.run(
				"DELETE FROM sync_snapshot_staging WHERE account_user_id = ?",
				[accountUserId],
			);
			await transaction.run(
				"DELETE FROM root_sync_state WHERE account_user_id = ?",
				[accountUserId],
			);
		});
	}

	async clearRootData(
		accountUserId: string,
		rootEventId: string,
	): Promise<void> {
		await this.database.transaction(async (transaction) => {
			await transaction.run(
				`DELETE FROM community_feedback_manager_write_attempts
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, rootEventId],
			);
			await transaction.run(
				`DELETE FROM feedback_submissions
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, rootEventId],
			);
			await transaction.run(
				`DELETE FROM sync_snapshot_staging
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, rootEventId],
			);
			await transaction.run(
				`DELETE FROM root_sync_state
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, rootEventId],
			);
			await transaction.run(
				`DELETE FROM actor_event_root_index_entries
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, rootEventId],
			);
		});
	}
}
