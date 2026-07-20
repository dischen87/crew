import type { SqlDatabase, SqlExecutor } from "./database.ts";
import {
	type GolfSyncData,
	type GolfSyncEntityType,
	putGolfSyncProjection,
	validateGolfSyncRecord,
} from "./golfOffline.ts";
import {
	putTeamSyncProjection,
	type SyncTeamAssignmentData,
	type SyncTeamAssignmentRosterData,
	type SyncTeamAssignmentSetData,
	type SyncTeamDecisionData,
	type SyncTeamResponseData,
	type TeamSyncData,
	type TeamSyncEntityType,
	validateTeamSyncRecord,
} from "./teamOffline.ts";

export type SyncEntityType =
	| "event"
	| "membership"
	| "invitation"
	| "place"
	| "capability"
	| "itineraryItem"
	| "feedEntry"
	| "feedReaction"
	| "attachment"
	| GolfSyncEntityType
	| TeamSyncEntityType;

export type SyncReaction =
	| "like"
	| "love"
	| "celebrate"
	| "laugh"
	| "surprised"
	| "sad";

export interface SyncPlaceSnapshot {
	id: string;
	name: string;
	locality: string | null;
	countryCode: string;
	latitude: number | null;
	longitude: number | null;
}

type DetailsBase<T extends string> = { schemaVersion: 1; type: T };
type TravelDetails<T extends "flight" | "rail" | "road_transfer"> =
	DetailsBase<T> & {
		originPlaceId: string;
		destinationPlaceId: string;
		originPlaceSnapshot: SyncPlaceSnapshot;
		destinationPlaceSnapshot: SyncPlaceSnapshot;
	};

export type SyncItineraryDetails =
	| DetailsBase<"note">
	| (DetailsBase<"activity"> & { bookingReference?: string })
	| (TravelDetails<"flight"> & { flightDesignator?: string })
	| (TravelDetails<"rail"> & { serviceDesignator?: string })
	| (TravelDetails<"road_transfer"> & { pickupInstructions?: string })
	| (DetailsBase<"lodging"> & {
			propertyName: string;
			checkInAt: string;
			checkOutAt: string;
	  })
	| (DetailsBase<"meal"> & { reservationNote?: string })
	| (DetailsBase<"golf_round"> & {
			roundReference: string;
			teeTime: string;
	  })
	| (DetailsBase<"session"> & {
			room?: string;
			descendantEventId?: string;
	  });

export interface SyncEventData {
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
	childOrderVersion: number;
	itineraryOrderVersion: number;
	status: "draft" | "published" | "cancelled" | "archived";
	version: number;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
}

export interface SyncMembershipData {
	rootEventId: string;
	userId: string;
	role: "owner" | "organizer" | "participant" | "viewer";
	status: "active" | "left" | "removed";
	version: number;
	createdAt: string;
	updatedAt: string;
}

export interface SyncInvitationData {
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

export interface SyncPlaceData extends SyncPlaceSnapshot {
	rootEventId: string;
	version: number;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
}

export type SyncCapabilityConfig =
	| {
			type: "travel";
			config: {
				homePlaceId: string | null;
				travelerReferenceLabel: string | null;
			};
	  }
	| {
			type: "lodging";
			config: {
				propertyPlaceId: string | null;
				checkInPolicy: "fixed" | "flexible";
				checkOutPolicy: "fixed" | "flexible";
				roomAssignmentMode: "organizer" | "self_service";
			};
	  }
	| {
			type: "transport";
			config: {
				meetingPlaceId: string | null;
				participantMode: "self_arranged" | "shared" | "mixed";
			};
	  }
	| {
			type: "golf";
			config: {
				coursePlaceId: string | null;
				teeFormat: "individual" | "pairs" | "fourball";
				handicapMode: "none" | "optional" | "required";
				scoringMode: "none" | "stroke_play" | "stableford";
				roundState: "planned" | "open" | "closed";
			};
	  }
	| {
			type: "team";
			config: {
				venuePlaceId: string | null;
				assignmentMode: "organizer" | "self_select" | "random";
				capacityPerTeam: number | null;
				facilitator: string | null;
			};
	  };

export type SyncCapabilityData = SyncCapabilityConfig & {
	rootEventId: string;
	eventId: string;
	schemaVersion: 1;
	version: number;
	createdAt: string;
	updatedAt: string;
	deletedAt: null;
};

export interface SyncItineraryData {
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
	details: SyncItineraryDetails;
	placeId: string | null;
	placeSnapshot: SyncPlaceSnapshot | null;
	version: number;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
}

export interface SyncFeedEntryData {
	id: string;
	rootEventId: string;
	eventId: string | null;
	parentEntryId: string | null;
	actorUserId: string | null;
	kind: "message" | "comment" | "system";
	payloadSchemaVersion: 1;
	payload: { text: string | null };
	rootRevision: string;
	createdRootRevision: string;
	version: number;
	createdAt: string;
	updatedAt: string;
	deletedAt: null;
}

export interface SyncFeedReactionData {
	entryId: string;
	rootEventId: string;
	userId: string;
	reaction: SyncReaction;
	present: true;
	version: number;
	updatedAt: string;
}

export interface SyncAttachmentData {
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

export interface SyncGolfHoleData {
	hole: number;
	par: number;
	strokeIndex: number;
}

export interface SyncGolfTeamData {
	id: string;
	name: string;
	color: string | null;
	memberUserIds: string[];
}

export interface SyncGolfRoundData {
	rootEventId: string;
	eventId: string;
	holes: SyncGolfHoleData[];
	teams: SyncGolfTeamData[];
	version: number;
	updatedAt: string;
}

export interface SyncGolfRosterPlayerData {
	userId: string;
	playingHandicap: number;
}

export interface SyncGolfRosterData {
	rootEventId: string;
	eventId: string;
	players: SyncGolfRosterPlayerData[];
	version: number;
	updatedAt: string;
}

export interface SyncGolfPlayerData {
	rootEventId: string;
	eventId: string;
	userId: string;
	playingHandicap: number;
	version: number;
}

export interface SyncGolfScoreData {
	id: string;
	rootEventId: string;
	eventId: string;
	userId: string;
	hole: number;
	strokes: number | null;
	putts: number | null;
	playingHandicap: number;
	handicapStrokes: number;
	netStrokes: number | null;
	stablefordPoints: number;
	version: number;
	rootRevision: string;
	createdAt: string;
	updatedAt: string;
}

export interface SyncGolfLeaderboardEntryData {
	rank: number;
	userId: string;
	teamId: string | null;
	stablefordPoints: number;
	holesCompleted: number;
}

export interface SyncGolfLeaderboardData {
	rootEventId: string;
	eventId: string;
	version: number;
	entries: SyncGolfLeaderboardEntryData[];
}

export interface SyncDataByEntity {
	event: SyncEventData;
	membership: SyncMembershipData;
	invitation: SyncInvitationData;
	place: SyncPlaceData;
	capability: SyncCapabilityData;
	itineraryItem: SyncItineraryData;
	feedEntry: SyncFeedEntryData;
	feedReaction: SyncFeedReactionData;
	attachment: SyncAttachmentData;
	golfRound: SyncGolfRoundData;
	golfRoster: SyncGolfRosterData;
	golfPlayer: SyncGolfPlayerData;
	golfScore: SyncGolfScoreData;
	golfLeaderboard: SyncGolfLeaderboardData;
	teamAssignmentSet: SyncTeamAssignmentSetData;
	teamAssignmentRoster: SyncTeamAssignmentRosterData;
	teamAssignment: SyncTeamAssignmentData;
	teamDecision: SyncTeamDecisionData;
	teamResponse: SyncTeamResponseData;
}

export type SyncSnapshotRecord = {
	[K in SyncEntityType]: {
		entityType: K;
		entityId: string;
		entityVersion: number;
		data: SyncDataByEntity[K];
	};
}[SyncEntityType];

export type SyncUpsertChange = {
	[K in SyncEntityType]: {
		rootRevision: string;
		ordinal: number;
		entityType: K;
		entityId: string;
		operation: "upsert";
		entityVersion: number;
		data: SyncDataByEntity[K];
	};
}[SyncEntityType];

interface DeletedEntityTombstone {
	entityType:
		| "event"
		| "invitation"
		| "itineraryItem"
		| "golfPlayer"
		| "teamAssignment";
	id: string;
	rootEventId: string;
	eventId: string;
	version: number;
	deletedAt: string;
}

export type SyncTombstoneChange =
	| {
			rootRevision: string;
			ordinal: number;
			entityType: "event" | "invitation" | "itineraryItem" | "golfPlayer";
			entityId: string;
			operation: "tombstone";
			entityVersion: number;
			tombstone: DeletedEntityTombstone;
	  }
	| {
			rootRevision: string;
			ordinal: number;
			entityType: "teamAssignment";
			entityId: string;
			operation: "tombstone";
			entityVersion: number;
			tombstone: DeletedEntityTombstone;
	  }
	| {
			rootRevision: string;
			ordinal: number;
			entityType: "capability";
			entityId: string;
			operation: "tombstone";
			entityVersion: number;
			tombstone: {
				entityType: "capability";
				id: string;
				rootEventId: string;
				eventId: string;
				type: SyncCapabilityData["type"];
				version: number;
				deletedAt: string;
			};
	  }
	| {
			rootRevision: string;
			ordinal: number;
			entityType: "feedEntry";
			entityId: string;
			operation: "tombstone";
			entityVersion: number;
			tombstone: {
				id: string;
				rootEventId: string;
				eventId: string | null;
				version: number;
				deletedAt: string;
			};
	  }
	| {
			rootRevision: string;
			ordinal: number;
			entityType: "feedReaction";
			entityId: string;
			operation: "tombstone";
			entityVersion: number;
			tombstone: {
				entryId: string;
				rootEventId: string;
				userId: string;
				reaction: SyncReaction;
				version: number;
				deletedAt: string;
			};
	  };

export type SyncChange = SyncUpsertChange | SyncTombstoneChange;

export interface SyncBootstrapPage {
	protocolVersion: 1;
	rootEventId: string;
	authorizationScopeVersion: string;
	snapshotId: string;
	snapshotRevision: string;
	records: SyncSnapshotRecord[];
	syncCursor: string;
	pageInfo: { nextCursor: string | null; hasMore: boolean };
}

export interface SyncPullPage {
	protocolVersion: 1;
	rootEventId: string;
	authorizationScopeVersion: string;
	changes: SyncChange[];
	checkpointCursor: string;
	pageInfo: { nextCursor: string | null; hasMore: boolean };
}

const DECIMAL = /^(0|[1-9]\d*)$/;
const POSITIVE_DECIMAL = /^[1-9]\d*$/;
const typeOrder: Record<SyncEntityType, number> = {
	event: 0,
	membership: 1,
	invitation: 2,
	place: 3,
	capability: 4,
	itineraryItem: 5,
	feedEntry: 6,
	feedReaction: 7,
	attachment: 8,
	golfRound: 9,
	golfRoster: 10,
	golfPlayer: 11,
	golfScore: 12,
	golfLeaderboard: 13,
	teamAssignmentSet: 14,
	teamAssignmentRoster: 15,
	teamAssignment: 16,
	teamDecision: 17,
	teamResponse: 18,
};

function invariant(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Invalid sync page: ${message}`);
}

function safePositive(value: number, field: string) {
	invariant(
		Number.isSafeInteger(value) && value > 0,
		`${field} must be a positive safe integer`,
	);
}

function safeOrdinal(value: number) {
	invariant(
		Number.isSafeInteger(value) && value >= 0,
		"ordinal must be a nonnegative safe integer",
	);
}

function compareDecimal(left: string, right: string) {
	if (left.length !== right.length) return left.length < right.length ? -1 : 1;
	return left < right ? -1 : left > right ? 1 : 0;
}

function sameCursor(left: string | null, right: string | null) {
	return left === right;
}

async function reconcileOutbox(
	executor: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
	coveredRevision: string | null,
	snapshotReset: boolean,
) {
	if (coveredRevision !== null) {
		await executor.run(
			`DELETE FROM mutation_outbox
WHERE account_user_id = ? AND root_event_id = ? AND state = 'awaiting_pull'
  AND applied_root_revision IS NOT NULL
  AND (
    length(applied_root_revision) < length(?) OR
    (length(applied_root_revision) = length(?) AND applied_root_revision <= ?)
  )`,
			[
				accountUserId,
				rootEventId,
				coveredRevision,
				coveredRevision,
				coveredRevision,
			],
		);
	}
	if (snapshotReset) {
		await executor.run(
			`DELETE FROM mutation_outbox
WHERE account_user_id = ? AND root_event_id = ?
  AND operation_id = 'eventsCreate' AND state = 'awaiting_pull'`,
			[accountUserId, rootEventId],
		);
	}
	await executor.run(
		`UPDATE mutation_outbox SET state = 'pending', blocked_until_pull = 0,
  next_attempt_at = NULL, last_error_code = NULL, updated_at = ?
WHERE account_user_id = ? AND root_event_id = ?
  AND state = 'blocked' AND blocked_until_pull = 1`,
		[new Date().toISOString(), accountUserId, rootEventId],
	);
}

function validatePageInfo(pageInfo: {
	nextCursor: string | null;
	hasMore: boolean;
}) {
	invariant(
		pageInfo.hasMore === (pageInfo.nextCursor !== null),
		"pageInfo.hasMore and nextCursor disagree",
	);
}

function validateRecord(
	rootEventId: string,
	record: SyncSnapshotRecord | SyncUpsertChange,
) {
	safePositive(record.entityVersion, "entityVersion");
	const data = record.data as SyncDataByEntity[SyncEntityType];
	invariant(data.rootEventId === rootEventId, "entity rootEventId mismatch");
	safePositive(data.version, "data.version");
	if (record.entityType !== "teamDecision") {
		invariant(data.version === record.entityVersion, "entityVersion mismatch");
	}
	switch (record.entityType) {
		case "event": {
			const value = record.data as SyncEventData;
			invariant(record.entityId === value.id, "event identity mismatch");
			invariant(POSITIVE_DECIMAL.test(value.sortKey), "invalid event sortKey");
			break;
		}
		case "membership": {
			const value = record.data as SyncMembershipData;
			invariant(
				record.entityId === value.userId,
				"membership identity mismatch",
			);
			break;
		}
		case "invitation": {
			const value = record.data as SyncInvitationData;
			invariant(record.entityId === value.id, "invitation identity mismatch");
			break;
		}
		case "place": {
			const value = record.data as SyncPlaceData;
			invariant(record.entityId === value.id, "place identity mismatch");
			break;
		}
		case "capability": {
			const value = record.data as SyncCapabilityData;
			invariant(
				record.entityId === `${value.eventId}:${value.type}`,
				"capability identity mismatch",
			);
			break;
		}
		case "itineraryItem": {
			const value = record.data as SyncItineraryData;
			invariant(record.entityId === value.id, "itinerary identity mismatch");
			invariant(
				POSITIVE_DECIMAL.test(value.sortKey),
				"invalid itinerary sortKey",
			);
			break;
		}
		case "feedEntry": {
			const value = record.data as SyncFeedEntryData;
			invariant(record.entityId === value.id, "feed identity mismatch");
			invariant(DECIMAL.test(value.rootRevision), "invalid feed rootRevision");
			invariant(
				DECIMAL.test(value.createdRootRevision),
				"invalid feed createdRootRevision",
			);
			break;
		}
		case "feedReaction":
			invariant(
				record.entityId.startsWith("fer_"),
				"invalid reaction identity",
			);
			break;
		case "attachment": {
			const value = record.data as SyncAttachmentData;
			invariant(record.entityId === value.id, "attachment identity mismatch");
			invariant(
				value.target.entityType === "feedEntry",
				"invalid attachment target",
			);
			break;
		}
		case "golfRound":
		case "golfRoster":
		case "golfPlayer":
		case "golfScore":
		case "golfLeaderboard":
			validateGolfSyncRecord(
				record.entityType,
				record.entityId,
				record.data as GolfSyncData,
			);
			break;
		case "teamAssignmentSet":
		case "teamAssignmentRoster":
		case "teamAssignment":
		case "teamDecision":
		case "teamResponse":
			validateTeamSyncRecord(
				record.entityType,
				record.entityId,
				record.data as TeamSyncData,
				record.entityVersion,
			);
			break;
	}
}

function validateTombstone(
	rootEventId: string,
	accountUserId: string,
	change: SyncTombstoneChange,
) {
	safePositive(change.entityVersion, "entityVersion");
	safeOrdinal(change.ordinal);
	invariant(DECIMAL.test(change.rootRevision), "invalid rootRevision");
	invariant(
		change.tombstone.rootEventId === rootEventId,
		"tombstone root mismatch",
	);
	invariant(
		change.tombstone.version === change.entityVersion,
		"tombstone entityVersion mismatch",
	);
	switch (change.entityType) {
		case "event":
		case "invitation":
		case "itineraryItem":
		case "golfPlayer":
		case "teamAssignment":
			invariant(
				change.tombstone.entityType === change.entityType,
				"tombstone type mismatch",
			);
			invariant(
				change.tombstone.id === change.entityId,
				"tombstone identity mismatch",
			);
			if (change.entityType === "golfPlayer") {
				invariant(
					change.entityId ===
						`gpl_${change.tombstone.eventId}:${accountUserId}`,
					"golf player tombstone must target the current account",
				);
			}
			if (change.entityType === "teamAssignment") {
				invariant(
					change.entityId ===
						`tma_${change.tombstone.eventId}:${accountUserId}`,
					"team assignment tombstone must target the current account",
				);
			}
			break;
		case "capability":
			invariant(
				change.tombstone.id === change.entityId,
				"capability tombstone identity mismatch",
			);
			invariant(
				change.entityId ===
					`${change.tombstone.eventId}:${change.tombstone.type}`,
				"capability tombstone key mismatch",
			);
			break;
		case "feedEntry":
			invariant(
				change.tombstone.id === change.entityId,
				"feed tombstone identity mismatch",
			);
			break;
		case "feedReaction":
			invariant(
				change.entityId.startsWith("fer_"),
				"reaction tombstone identity mismatch",
			);
			break;
	}
}

async function putUpsert(
	executor: SqlExecutor,
	accountUserId: string,
	entityType: SyncEntityType,
	entityId: string,
	data: SyncDataByEntity[SyncEntityType],
	revisionOrdinal: number | null,
) {
	switch (entityType) {
		case "event": {
			const value = data as SyncEventData;
			await executor.run(
				`INSERT INTO events (
  account_user_id, id, root_event_id, parent_event_id, kind, title, description,
  time_zone, starts_at, ends_at, sort_key, child_order_version,
  itinerary_order_version, status, version, created_at, updated_at, deleted_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, id) DO UPDATE SET
  root_event_id = excluded.root_event_id, parent_event_id = excluded.parent_event_id,
  kind = excluded.kind, title = excluded.title, description = excluded.description,
  time_zone = excluded.time_zone, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
  sort_key = excluded.sort_key, child_order_version = excluded.child_order_version,
  itinerary_order_version = excluded.itinerary_order_version, status = excluded.status,
  version = excluded.version, created_at = excluded.created_at,
  updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
WHERE excluded.version > events.version`,
				[
					accountUserId,
					value.id,
					value.rootEventId,
					value.parentEventId,
					value.kind,
					value.title,
					value.description,
					value.timeZone,
					value.startsAt,
					value.endsAt,
					value.sortKey,
					String(value.childOrderVersion),
					String(value.itineraryOrderVersion),
					value.status,
					value.version,
					value.createdAt,
					value.updatedAt,
					value.deletedAt,
				],
			);
			break;
		}
		case "membership": {
			const value = data as SyncMembershipData;
			await executor.run(
				`INSERT INTO memberships (
  account_user_id, root_event_id, member_user_id, role, status, version,
  created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, root_event_id, member_user_id) DO UPDATE SET
  role = excluded.role, status = excluded.status, version = excluded.version,
  updated_at = excluded.updated_at
WHERE excluded.version > memberships.version`,
				[
					accountUserId,
					value.rootEventId,
					value.userId,
					value.role,
					value.status,
					value.version,
					value.createdAt,
					value.updatedAt,
				],
			);
			break;
		}
		case "invitation": {
			const value = data as SyncInvitationData;
			await executor.run(
				`INSERT INTO invitations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, id) DO UPDATE SET
  role = excluded.role, email_bound = excluded.email_bound,
  expires_at = excluded.expires_at, max_uses = excluded.max_uses,
  use_count = excluded.use_count, status = excluded.status,
  version = excluded.version, updated_at = excluded.updated_at
WHERE excluded.version > invitations.version`,
				[
					accountUserId,
					value.id,
					value.rootEventId,
					value.role,
					value.emailBound ? 1 : 0,
					value.expiresAt,
					value.maxUses,
					value.useCount,
					value.status,
					value.version,
					value.createdAt,
					value.updatedAt,
				],
			);
			break;
		}
		case "place": {
			const value = data as SyncPlaceData;
			await executor.run(
				`INSERT INTO event_places VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, id) DO UPDATE SET
  name = excluded.name, locality = excluded.locality,
  country_code = excluded.country_code, latitude = excluded.latitude,
  longitude = excluded.longitude, version = excluded.version,
  updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
WHERE excluded.version > event_places.version`,
				[
					accountUserId,
					value.id,
					value.rootEventId,
					value.name,
					value.locality,
					value.countryCode,
					value.latitude,
					value.longitude,
					value.version,
					value.createdAt,
					value.updatedAt,
					value.deletedAt,
				],
			);
			break;
		}
		case "capability": {
			const value = data as SyncCapabilityData;
			await executor.run(
				`INSERT INTO event_capabilities VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, entity_id) DO UPDATE SET
  schema_version = excluded.schema_version, config_json = excluded.config_json,
  version = excluded.version, updated_at = excluded.updated_at,
  deleted_at = excluded.deleted_at
WHERE excluded.version > event_capabilities.version`,
				[
					accountUserId,
					entityId,
					value.rootEventId,
					value.eventId,
					value.type,
					value.schemaVersion,
					JSON.stringify(value.config),
					value.version,
					value.createdAt,
					value.updatedAt,
					value.deletedAt,
				],
			);
			break;
		}
		case "itineraryItem": {
			const value = data as SyncItineraryData;
			await executor.run(
				`INSERT INTO itinerary_items (
  account_user_id, id, root_event_id, event_id, title, notes, time_zone,
  starts_at, ends_at, all_day, sort_key, status, details_schema_version,
  details_json, place_id, place_snapshot_json, version, created_at,
  updated_at, deleted_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, id) DO UPDATE SET
  event_id = excluded.event_id, title = excluded.title, notes = excluded.notes,
  time_zone = excluded.time_zone, starts_at = excluded.starts_at,
  ends_at = excluded.ends_at, all_day = excluded.all_day,
  sort_key = excluded.sort_key, status = excluded.status,
  details_schema_version = excluded.details_schema_version,
  details_json = excluded.details_json, place_id = excluded.place_id,
  place_snapshot_json = excluded.place_snapshot_json, version = excluded.version,
  updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
WHERE excluded.version > itinerary_items.version`,
				[
					accountUserId,
					value.id,
					value.rootEventId,
					value.eventId,
					value.title,
					value.notes,
					value.timeZone,
					value.startsAt,
					value.endsAt,
					value.allDay ? 1 : 0,
					value.sortKey,
					value.status,
					value.details.schemaVersion,
					JSON.stringify(value.details),
					value.placeId,
					value.placeSnapshot === null
						? null
						: JSON.stringify(value.placeSnapshot),
					value.version,
					value.createdAt,
					value.updatedAt,
					value.deletedAt,
				],
			);
			break;
		}
		case "feedEntry": {
			const value = data as SyncFeedEntryData;
			await executor.run(
				`INSERT INTO feed_entries (
  account_user_id, id, root_event_id, event_id, parent_entry_id, actor_user_id,
  kind, payload_schema_version, payload_json, root_revision,
  created_root_revision, revision_ordinal, version, created_at, updated_at,
  deleted_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, id) DO UPDATE SET
  event_id = excluded.event_id, payload_schema_version = excluded.payload_schema_version,
  payload_json = excluded.payload_json, root_revision = excluded.root_revision,
  revision_ordinal = excluded.revision_ordinal, version = excluded.version,
  updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
WHERE excluded.version > feed_entries.version`,
				[
					accountUserId,
					value.id,
					value.rootEventId,
					value.eventId,
					value.parentEntryId,
					value.actorUserId,
					value.kind,
					value.payloadSchemaVersion,
					JSON.stringify(value.payload),
					value.rootRevision,
					value.createdRootRevision,
					revisionOrdinal,
					value.version,
					value.createdAt,
					value.updatedAt,
					value.deletedAt,
				],
			);
			break;
		}
		case "feedReaction": {
			const value = data as SyncFeedReactionData;
			await executor.run(
				`INSERT INTO feed_reactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, entity_id) DO UPDATE SET
  present = excluded.present, version = excluded.version,
  updated_at = excluded.updated_at
WHERE excluded.version > feed_reactions.version`,
				[
					accountUserId,
					entityId,
					value.rootEventId,
					value.entryId,
					value.userId,
					value.reaction,
					1,
					value.version,
					value.updatedAt,
				],
			);
			break;
		}
		case "attachment": {
			const value = data as SyncAttachmentData;
			await executor.run(
				`INSERT INTO attachments VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, id) DO UPDATE SET
  content_type = excluded.content_type, byte_count = excluded.byte_count,
  sha256 = excluded.sha256, caption = excluded.caption, version = excluded.version
WHERE excluded.version > attachments.version`,
				[
					accountUserId,
					value.id,
					value.rootEventId,
					value.target.entityType,
					value.target.entityId,
					value.contentType,
					value.byteCount,
					value.sha256,
					value.caption,
					value.version,
					value.createdAt,
				],
			);
			break;
		}
		case "golfRound":
		case "golfRoster":
		case "golfPlayer":
		case "golfScore":
		case "golfLeaderboard":
			await putGolfSyncProjection(
				executor,
				accountUserId,
				entityType,
				data as GolfSyncData,
			);
			break;
		case "teamAssignmentSet":
		case "teamAssignmentRoster":
		case "teamAssignment":
		case "teamDecision":
		case "teamResponse":
			await putTeamSyncProjection(
				executor,
				accountUserId,
				entityType,
				data as TeamSyncData,
			);
			break;
	}
}

async function entityVersion(
	executor: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
	change: SyncTombstoneChange,
) {
	if (change.entityType === "teamAssignment") {
		const row = await executor.first<{ version: number }>(
			`SELECT version FROM team_own_assignments
WHERE account_user_id = ? AND root_event_id = ? AND event_id = ?
  AND user_id = ?`,
			[accountUserId, rootEventId, change.tombstone.eventId, accountUserId],
		);
		return row ? Number(row.version) : null;
	}
	if (change.entityType === "golfPlayer") {
		const row = await executor.first<{ version: number }>(
			`SELECT version FROM golf_players
WHERE account_user_id = ? AND root_event_id = ? AND event_id = ?
  AND user_id = ?`,
			[accountUserId, rootEventId, change.tombstone.eventId, accountUserId],
		);
		return row ? Number(row.version) : null;
	}
	const tableAndKey = {
		event: ["events", "id"],
		invitation: ["invitations", "id"],
		capability: ["event_capabilities", "entity_id"],
		itineraryItem: ["itinerary_items", "id"],
		feedEntry: ["feed_entries", "id"],
		feedReaction: ["feed_reactions", "entity_id"],
	} as const;
	const [table, key] = tableAndKey[change.entityType];
	const row = await executor.first<{ version: number }>(
		`SELECT version FROM ${table} WHERE account_user_id = ? AND root_event_id = ? AND ${key} = ?`,
		[accountUserId, rootEventId, change.entityId],
	);
	return row ? Number(row.version) : null;
}

async function applyTombstone(
	executor: SqlExecutor,
	accountUserId: string,
	change: SyncTombstoneChange,
) {
	const rootEventId = change.tombstone.rootEventId;
	const stored = await executor.first<{ entity_version: number }>(
		`SELECT entity_version FROM sync_tombstones
WHERE account_user_id = ? AND root_event_id = ? AND entity_type = ? AND entity_id = ?`,
		[accountUserId, rootEventId, change.entityType, change.entityId],
	);
	const liveVersion = await entityVersion(
		executor,
		accountUserId,
		rootEventId,
		change,
	);
	if (
		(stored && Number(stored.entity_version) >= change.entityVersion) ||
		(liveVersion !== null && liveVersion > change.entityVersion)
	)
		return;

	switch (change.entityType) {
		case "event":
			await executor.run(
				`UPDATE events SET status = 'archived', version = ?, updated_at = ?, deleted_at = ?
WHERE account_user_id = ? AND root_event_id = ? AND id = ? AND version <= ?`,
				[
					change.entityVersion,
					change.tombstone.deletedAt,
					change.tombstone.deletedAt,
					accountUserId,
					rootEventId,
					change.entityId,
					change.entityVersion,
				],
			);
			break;
		case "invitation":
			await executor.run(
				"DELETE FROM invitations WHERE account_user_id = ? AND root_event_id = ? AND id = ? AND version <= ?",
				[accountUserId, rootEventId, change.entityId, change.entityVersion],
			);
			break;
		case "capability":
			await executor.run(
				"DELETE FROM event_capabilities WHERE account_user_id = ? AND root_event_id = ? AND entity_id = ? AND version <= ?",
				[accountUserId, rootEventId, change.entityId, change.entityVersion],
			);
			break;
		case "itineraryItem":
			await executor.run(
				`UPDATE itinerary_items SET status = 'archived', version = ?, updated_at = ?, deleted_at = ?
WHERE account_user_id = ? AND root_event_id = ? AND id = ? AND version <= ?`,
				[
					change.entityVersion,
					change.tombstone.deletedAt,
					change.tombstone.deletedAt,
					accountUserId,
					rootEventId,
					change.entityId,
					change.entityVersion,
				],
			);
			break;
		case "feedEntry":
			await executor.run(
				"DELETE FROM attachments WHERE account_user_id = ? AND root_event_id = ? AND target_entity_id = ?",
				[accountUserId, rootEventId, change.entityId],
			);
			await executor.run(
				"DELETE FROM feed_reactions WHERE account_user_id = ? AND root_event_id = ? AND entry_id = ?",
				[accountUserId, rootEventId, change.entityId],
			);
			await executor.run(
				`UPDATE feed_entries SET root_revision = ?, revision_ordinal = ?,
  version = ?, updated_at = ?, deleted_at = ?
WHERE account_user_id = ? AND root_event_id = ? AND id = ? AND version <= ?`,
				[
					change.rootRevision,
					change.ordinal,
					change.entityVersion,
					change.tombstone.deletedAt,
					change.tombstone.deletedAt,
					accountUserId,
					rootEventId,
					change.entityId,
					change.entityVersion,
				],
			);
			break;
		case "feedReaction":
			await executor.run(
				"DELETE FROM feed_reactions WHERE account_user_id = ? AND root_event_id = ? AND entity_id = ? AND version <= ?",
				[accountUserId, rootEventId, change.entityId, change.entityVersion],
			);
			break;
		case "golfPlayer":
			await executor.run(
				`DELETE FROM golf_score_intents
WHERE account_user_id = ? AND root_event_id = ? AND event_id = ?
  AND user_id = ?`,
				[accountUserId, rootEventId, change.tombstone.eventId, accountUserId],
			);
			await executor.run(
				`DELETE FROM golf_players
WHERE account_user_id = ? AND root_event_id = ? AND event_id = ?
  AND user_id = ? AND version <= ?`,
				[
					accountUserId,
					rootEventId,
					change.tombstone.eventId,
					accountUserId,
					change.entityVersion,
				],
			);
			break;
		case "teamAssignment":
			await executor.run(
				`DELETE FROM team_own_assignments
WHERE account_user_id = ? AND root_event_id = ? AND event_id = ?
  AND user_id = ? AND version <= ?`,
				[
					accountUserId,
					rootEventId,
					change.tombstone.eventId,
					accountUserId,
					change.entityVersion,
				],
			);
			break;
	}

	await executor.run(
		`INSERT INTO sync_tombstones (
  account_user_id, root_event_id, entity_type, entity_id, entity_version,
  root_revision, ordinal, deleted_at, tombstone_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, root_event_id, entity_type, entity_id) DO UPDATE SET
  entity_version = excluded.entity_version, root_revision = excluded.root_revision,
  ordinal = excluded.ordinal, deleted_at = excluded.deleted_at,
  tombstone_json = excluded.tombstone_json
WHERE excluded.entity_version > sync_tombstones.entity_version`,
		[
			accountUserId,
			rootEventId,
			change.entityType,
			change.entityId,
			change.entityVersion,
			change.rootRevision,
			change.ordinal,
			change.tombstone.deletedAt,
			JSON.stringify(change.tombstone),
		],
	);
}

async function applyUpsert(
	executor: SqlExecutor,
	accountUserId: string,
	change: SyncUpsertChange,
) {
	const tombstone = await executor.first<{ entity_version: number }>(
		`SELECT entity_version FROM sync_tombstones
WHERE account_user_id = ? AND root_event_id = ? AND entity_type = ? AND entity_id = ?`,
		[
			accountUserId,
			change.data.rootEventId,
			change.entityType,
			change.entityId,
		],
	);
	if (tombstone && Number(tombstone.entity_version) >= change.entityVersion)
		return;
	if (tombstone) {
		await executor.run(
			`DELETE FROM sync_tombstones
WHERE account_user_id = ? AND root_event_id = ? AND entity_type = ? AND entity_id = ?`,
			[
				accountUserId,
				change.data.rootEventId,
				change.entityType,
				change.entityId,
			],
		);
	}
	await putUpsert(
		executor,
		accountUserId,
		change.entityType,
		change.entityId,
		change.data,
		change.ordinal,
	);
}

async function clearProjection(
	executor: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
) {
	for (const table of [
		"team_own_responses",
		"team_decision_options",
		"team_decisions",
		"team_own_assignments",
		"team_assignment_roster_members",
		"team_assignment_teams",
		"team_assignment_sets",
		"golf_rankings",
		"golf_leaderboards",
		"golf_scores",
		"golf_team_members",
		"golf_teams",
		"golf_roster_players",
		"golf_players",
		"golf_holes",
		"golf_rounds",
		"attachments",
		"feed_reactions",
		"event_capabilities",
		"itinerary_items",
		"feed_entries",
		"invitations",
		"memberships",
		"event_places",
		"events",
		"sync_tombstones",
	]) {
		await executor.run(
			`DELETE FROM ${table} WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
	}
}

interface StagingRow {
	snapshot_id: string;
	snapshot_revision: string;
	authorization_scope_version: string;
	sync_cursor: string;
	next_page_cursor: string | null;
	base_pull_cursor: string | null;
}

export async function applyBootstrapPage(
	database: SqlDatabase,
	accountUserId: string,
	expectedPageCursor: string | null,
	page: SyncBootstrapPage,
): Promise<{ completed: boolean; nextCursor: string | null }> {
	invariant(page.protocolVersion === 1, "unsupported protocolVersion");
	invariant(
		POSITIVE_DECIMAL.test(page.authorizationScopeVersion),
		"invalid authorization scope",
	);
	invariant(DECIMAL.test(page.snapshotRevision), "invalid snapshotRevision");
	invariant(page.snapshotId.startsWith("snp_"), "invalid snapshotId");
	validatePageInfo(page.pageInfo);
	for (const record of page.records) validateRecord(page.rootEventId, record);

	return database.transaction(async (transaction) => {
		let stage = await transaction.first<StagingRow>(
			`SELECT snapshot_id, snapshot_revision, authorization_scope_version,
  sync_cursor, next_page_cursor, base_pull_cursor
FROM sync_snapshot_staging WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, page.rootEventId],
		);
		if (expectedPageCursor === null) {
			await transaction.run(
				"DELETE FROM sync_snapshot_staging WHERE account_user_id = ? AND root_event_id = ?",
				[accountUserId, page.rootEventId],
			);
			const state = await transaction.first<{ pull_cursor: string | null }>(
				"SELECT pull_cursor FROM root_sync_state WHERE account_user_id = ? AND root_event_id = ?",
				[accountUserId, page.rootEventId],
			);
			await transaction.run(
				`INSERT INTO sync_snapshot_staging (
  account_user_id, root_event_id, snapshot_id, snapshot_revision,
  authorization_scope_version, sync_cursor, next_page_cursor, base_pull_cursor
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					accountUserId,
					page.rootEventId,
					page.snapshotId,
					page.snapshotRevision,
					page.authorizationScopeVersion,
					page.syncCursor,
					page.pageInfo.nextCursor,
					state?.pull_cursor ?? null,
				],
			);
			stage = {
				snapshot_id: page.snapshotId,
				snapshot_revision: page.snapshotRevision,
				authorization_scope_version: page.authorizationScopeVersion,
				sync_cursor: page.syncCursor,
				next_page_cursor: page.pageInfo.nextCursor,
				base_pull_cursor: state?.pull_cursor ?? null,
			};
		} else {
			invariant(stage, "bootstrap staging state is missing");
			invariant(
				stage.next_page_cursor === expectedPageCursor,
				"bootstrap page cursor mismatch",
			);
			invariant(
				stage.snapshot_id === page.snapshotId,
				"snapshotId changed between pages",
			);
			invariant(
				stage.snapshot_revision === page.snapshotRevision,
				"snapshotRevision changed between pages",
			);
			invariant(
				stage.authorization_scope_version === page.authorizationScopeVersion,
				"authorization scope changed between pages",
			);
			invariant(
				stage.sync_cursor === page.syncCursor,
				"syncCursor changed between pages",
			);
			await transaction.run(
				`UPDATE sync_snapshot_staging SET next_page_cursor = ?
WHERE account_user_id = ? AND root_event_id = ?`,
				[page.pageInfo.nextCursor, accountUserId, page.rootEventId],
			);
		}

		for (const record of page.records) {
			const dataJson = JSON.stringify(record.data);
			const existing = await transaction.first<{
				entity_version: number;
				data_json: string;
			}>(
				`SELECT entity_version, data_json FROM sync_snapshot_records
WHERE account_user_id = ? AND root_event_id = ? AND snapshot_id = ?
  AND entity_type = ? AND entity_id = ?`,
				[
					accountUserId,
					page.rootEventId,
					page.snapshotId,
					record.entityType,
					record.entityId,
				],
			);
			invariant(
				!existing ||
					(Number(existing.entity_version) === record.entityVersion &&
						existing.data_json === dataJson),
				"snapshot record changed between pages",
			);
			if (!existing) {
				await transaction.run(
					`INSERT INTO sync_snapshot_records VALUES (?, ?, ?, ?, ?, ?, ?)`,
					[
						accountUserId,
						page.rootEventId,
						page.snapshotId,
						record.entityType,
						record.entityId,
						record.entityVersion,
						dataJson,
					],
				);
			}
		}

		if (page.pageInfo.hasMore) {
			return { completed: false, nextCursor: page.pageInfo.nextCursor };
		}

		const rootRecord = await transaction.first<{ count: number }>(
			`SELECT COUNT(*) AS count FROM sync_snapshot_records
WHERE account_user_id = ? AND root_event_id = ? AND snapshot_id = ?
  AND entity_type = 'event' AND entity_id = ?`,
			[accountUserId, page.rootEventId, page.snapshotId, page.rootEventId],
		);
		invariant(rootRecord?.count === 1, "snapshot root event is missing");
		const currentState = await transaction.first<{
			pull_cursor: string | null;
		}>(
			"SELECT pull_cursor FROM root_sync_state WHERE account_user_id = ? AND root_event_id = ?",
			[accountUserId, page.rootEventId],
		);
		invariant(
			sameCursor(currentState?.pull_cursor ?? null, stage.base_pull_cursor),
			"live pull cursor changed while bootstrap was staged",
		);
		const completedAt = new Date().toISOString();
		await transaction.run(
			`INSERT INTO root_sync_state (
  account_user_id, root_event_id, pull_cursor, snapshot_id, snapshot_revision,
  authorization_scope_version, last_completed_sync_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, root_event_id) DO UPDATE SET
  pull_cursor = excluded.pull_cursor, snapshot_id = excluded.snapshot_id,
  snapshot_revision = excluded.snapshot_revision,
  authorization_scope_version = excluded.authorization_scope_version,
  last_completed_sync_at = excluded.last_completed_sync_at`,
			[
				accountUserId,
				page.rootEventId,
				page.syncCursor,
				page.snapshotId,
				page.snapshotRevision,
				page.authorizationScopeVersion,
				completedAt,
			],
		);
		await clearProjection(transaction, accountUserId, page.rootEventId);
		const staged = [
			...(await transaction.all<{
				entity_type: SyncEntityType;
				entity_id: string;
				data_json: string;
			}>(
				`SELECT entity_type, entity_id, data_json FROM sync_snapshot_records
WHERE account_user_id = ? AND root_event_id = ? AND snapshot_id = ?`,
				[accountUserId, page.rootEventId, page.snapshotId],
			)),
		];
		staged.sort(
			(left, right) =>
				typeOrder[left.entity_type] - typeOrder[right.entity_type] ||
				left.entity_id.localeCompare(right.entity_id),
		);
		for (const record of staged) {
			await putUpsert(
				transaction,
				accountUserId,
				record.entity_type,
				record.entity_id,
				JSON.parse(record.data_json) as SyncDataByEntity[SyncEntityType],
				null,
			);
		}
		await reconcileOutbox(
			transaction,
			accountUserId,
			page.rootEventId,
			page.snapshotRevision,
			true,
		);
		await transaction.run(
			"DELETE FROM sync_snapshot_staging WHERE account_user_id = ? AND root_event_id = ?",
			[accountUserId, page.rootEventId],
		);
		return { completed: true, nextCursor: null };
	});
}

export async function applyPullPage(
	database: SqlDatabase,
	accountUserId: string,
	expectedPullCursor: string,
	page: SyncPullPage,
): Promise<{ replayed: boolean }> {
	invariant(page.protocolVersion === 1, "unsupported protocolVersion");
	invariant(
		POSITIVE_DECIMAL.test(page.authorizationScopeVersion),
		"invalid authorization scope",
	);
	validatePageInfo(page.pageInfo);
	invariant(
		page.pageInfo.nextCursor === null ||
			page.pageInfo.nextCursor === page.checkpointCursor,
		"pull nextCursor must equal checkpointCursor",
	);
	let previous: { rootRevision: string; ordinal: number } | null = null;
	for (const change of page.changes) {
		safeOrdinal(change.ordinal);
		invariant(DECIMAL.test(change.rootRevision), "invalid rootRevision");
		if (previous) {
			const revisionOrder = compareDecimal(
				previous.rootRevision,
				change.rootRevision,
			);
			invariant(
				revisionOrder < 0 ||
					(revisionOrder === 0 && previous.ordinal < change.ordinal),
				"changes are not strictly increasing",
			);
		}
		previous = change;
		if (change.operation === "upsert") validateRecord(page.rootEventId, change);
		else validateTombstone(page.rootEventId, accountUserId, change);
	}

	return database.transaction(async (transaction) => {
		const state = await transaction.first<{
			pull_cursor: string | null;
			authorization_scope_version: string;
		}>(
			`SELECT pull_cursor, authorization_scope_version FROM root_sync_state
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, page.rootEventId],
		);
		invariant(state, "root sync state is missing");
		invariant(
			state.authorization_scope_version === page.authorizationScopeVersion,
			"authorization scope mismatch",
		);
		if (state.pull_cursor === page.checkpointCursor) return { replayed: true };
		invariant(state.pull_cursor === expectedPullCursor, "pull cursor mismatch");

		for (const change of page.changes) {
			if (change.operation === "upsert")
				await applyUpsert(transaction, accountUserId, change);
			else await applyTombstone(transaction, accountUserId, change);
		}
		await reconcileOutbox(
			transaction,
			accountUserId,
			page.rootEventId,
			previous?.rootRevision ?? null,
			false,
		);
		await transaction.run(
			`UPDATE root_sync_state SET pull_cursor = ?,
  authorization_scope_version = ?, last_completed_sync_at = ?
WHERE account_user_id = ? AND root_event_id = ? AND pull_cursor = ?`,
			[
				page.checkpointCursor,
				page.authorizationScopeVersion,
				new Date().toISOString(),
				accountUserId,
				page.rootEventId,
				expectedPullCursor,
			],
		);
		return { replayed: false };
	});
}
