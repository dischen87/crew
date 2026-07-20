import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	GatewayClient,
	type Session,
	type SessionStore,
} from "@crew/mobile-client";
import { putGolfSyncProjection } from "../src/golfOffline.ts";
import type {
	DraftRecord,
	EventRecord,
	FeedRecord,
	ItineraryRecord,
	MembershipRecord,
	OutboxItem,
	RootCreateCommand,
	RootSyncState,
	SqlDatabase,
	SqlExecutor,
	SqlValue,
	SyncBootstrapPage,
	SyncMutationDraft,
	SyncPullPage,
	SyncPushBody,
} from "../src/index.ts";
import {
	assertMutationStreamIdentity,
	discardUnboundMutationStreamIdentity,
	getOrCreateMutationStreamIdentity,
	initializeMutationStreamIdentities,
	LocalAttachmentStore,
	MobileDataStore,
	MobileSyncEngine,
	MobileSyncRootAccessDeniedError,
	migrate,
	migrations,
	recoverSequenceFailureStreams,
	sha256Hex,
} from "../src/index.ts";
import { putTeamSyncProjection } from "../src/teamOffline.ts";

class BunDatabase implements SqlDatabase {
	readonly sqlite: Database;

	constructor(path = ":memory:") {
		this.sqlite = new Database(path, { create: true });
	}

	async exec(sql: string): Promise<void> {
		this.sqlite.exec(sql);
	}

	async run(sql: string, parameters: readonly SqlValue[] = []): Promise<void> {
		this.sqlite.query(sql).run(...parameters);
	}

	async all<Row>(
		sql: string,
		parameters: readonly SqlValue[] = [],
	): Promise<readonly Row[]> {
		return this.sqlite.query(sql).all(...parameters) as Row[];
	}

	async first<Row>(
		sql: string,
		parameters: readonly SqlValue[] = [],
	): Promise<Row | null> {
		return (this.sqlite.query(sql).get(...parameters) as Row | null) ?? null;
	}

	async transaction<Result>(
		work: (transaction: SqlExecutor) => Promise<Result>,
	): Promise<Result> {
		this.sqlite.exec("BEGIN IMMEDIATE");
		try {
			const result = await work(this);
			this.sqlite.exec("COMMIT");
			return result;
		} catch (error) {
			this.sqlite.exec("ROLLBACK");
			throw error;
		}
	}

	close(): void {
		this.sqlite.close();
	}
}

class FaultInjectingDatabase extends BunDatabase {
	failAfterV2Sql = false;
	failAfterV4Sql = false;

	override async exec(sql: string): Promise<void> {
		await super.exec(sql);
		if (
			this.failAfterV2Sql &&
			sql.includes("CREATE TABLE root_sync_state_v2")
		) {
			this.failAfterV2Sql = false;
			throw new Error("injected v2 migration failure");
		}
		if (this.failAfterV4Sql && sql.includes("CREATE TABLE feed_entries_v4")) {
			this.failAfterV4Sql = false;
			throw new Error("injected v4 migration failure");
		}
	}
}

const temporaryDirectories: string[] = [];
const runtimeCryptoDescriptor = Object.getOwnPropertyDescriptor(
	globalThis,
	"crypto",
);

function installCryptoWithoutSubtle(): void {
	const runtimeCrypto = globalThis.crypto;
	Object.defineProperty(globalThis, "crypto", {
		configurable: true,
		enumerable: true,
		writable: true,
		value: {
			getRandomValues: runtimeCrypto.getRandomValues.bind(runtimeCrypto),
			randomUUID: runtimeCrypto.randomUUID.bind(runtimeCrypto),
		} as Crypto,
	});
}

afterEach(() => {
	if (runtimeCryptoDescriptor) {
		Object.defineProperty(globalThis, "crypto", runtimeCryptoDescriptor);
	}
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

const now = "2026-07-18T12:00:00.000Z";

async function migrateV1(database: BunDatabase): Promise<void> {
	const v1 = migrations[0];
	if (v1?.version !== 1) throw new Error("v1 migration missing");
	await database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
	await database.exec(`
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);
	await database.exec(v1.sql);
	await database.run(
		"INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
		[v1.version, v1.name],
	);
}

async function migrateThrough(
	database: BunDatabase,
	targetVersion: number,
): Promise<void> {
	await database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
	await database.exec(`
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`);
	for (const migration of migrations) {
		if (migration.version > targetVersion) break;
		await database.transaction(async (transaction) => {
			await transaction.exec(migration.sql);
			for (const statement of migration.copyStatements ?? []) {
				await transaction.run(statement);
			}
			if (migration.finalizeSql) {
				await transaction.exec(migration.finalizeSql);
			}
			await transaction.run(
				"INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
				[migration.version, migration.name],
			);
		});
	}
}

function rootState(accountUserId: string): RootSyncState {
	return {
		accountUserId,
		rootEventId: "evt_trip",
		pullCursor: "cursor-12",
		snapshotId: "snp_12",
		snapshotRevision: "12",
		authorizationScopeVersion: "2",
		lastCompletedSyncAt: now,
	};
}

function event(
	accountUserId: string,
	id: string,
	parentEventId: string | null,
	sortKey: string,
	title = id,
): EventRecord {
	return {
		accountUserId,
		id,
		rootEventId: "evt_trip",
		parentEventId,
		kind: parentEventId === null ? "trip" : "activity",
		title,
		description: null,
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		sortKey,
		childOrderVersion: "1",
		itineraryOrderVersion: "1",
		status: "published",
		version: 1,
		createdAt: now,
		updatedAt: now,
		deletedAt: null,
	};
}

function itinerary(
	accountUserId: string,
	id: string,
	startsAt: string | null,
	sortKey: string,
): ItineraryRecord {
	return {
		accountUserId,
		id,
		rootEventId: "evt_trip",
		eventId: "evt_trip",
		title: id,
		notes: null,
		timeZone: "Europe/Zurich",
		startsAt,
		endsAt: null,
		allDay: false,
		sortKey,
		status: "active",
		detailsSchemaVersion: 1,
		detailsJson: '{"type":"activity"}',
		placeId: null,
		placeSnapshotJson: null,
		version: 1,
		createdAt: now,
		updatedAt: now,
		deletedAt: null,
	};
}

function feed(
	accountUserId: string,
	id: string,
	rootRevision: string,
): FeedRecord {
	return {
		accountUserId,
		id,
		rootEventId: "evt_trip",
		eventId: "evt_day_a",
		parentEntryId: null,
		actorUserId: accountUserId,
		kind: "message",
		payloadSchemaVersion: 1,
		payloadJson: '{"content":"Meet at nine"}',
		rootRevision,
		createdRootRevision: rootRevision,
		revisionOrdinal: 0,
		version: 1,
		createdAt: now,
		updatedAt: now,
		deletedAt: null,
	};
}

const hugeRevision = "900719925474099312345678901234567890";
const reactionEntityId = `fer_${"a".repeat(64)}`;

function bootstrapPages(
	actorUserId: string,
	snapshotId = "snp_complete_1",
): readonly [SyncBootstrapPage, SyncBootstrapPage] {
	const common = {
		protocolVersion: 1 as const,
		rootEventId: "evt_trip",
		authorizationScopeVersion: `${hugeRevision}1`,
		snapshotId,
		snapshotRevision: hugeRevision,
		syncCursor: "bootstrap-checkpoint-0001",
	};
	const first: SyncBootstrapPage = {
		...common,
		records: [
			{
				entityType: "attachment",
				entityId: "att_photo",
				entityVersion: 1,
				data: {
					id: "att_photo",
					rootEventId: "evt_trip",
					target: { entityType: "feedEntry", entityId: "fed_notice" },
					contentType: "image/jpeg",
					byteCount: 2048,
					sha256: "b".repeat(64),
					caption: "Arrival",
					version: 1,
					createdAt: now,
				},
			},
			{
				entityType: "capability",
				entityId: "evt_day_a:travel",
				entityVersion: 1,
				data: {
					rootEventId: "evt_trip",
					eventId: "evt_day_a",
					type: "travel",
					schemaVersion: 1,
					config: {
						homePlaceId: "plc_station",
						travelerReferenceLabel: "Rail pass",
					},
					version: 1,
					createdAt: now,
					updatedAt: now,
					deletedAt: null,
				},
			},
			{
				entityType: "feedReaction",
				entityId: reactionEntityId,
				entityVersion: 1,
				data: {
					entryId: "fed_notice",
					rootEventId: "evt_trip",
					userId: actorUserId,
					reaction: "like",
					present: true,
					version: 1,
					updatedAt: now,
				},
			},
			{
				entityType: "itineraryItem",
				entityId: "iti_arrival",
				entityVersion: 1,
				data: {
					id: "iti_arrival",
					rootEventId: "evt_trip",
					eventId: "evt_day_a",
					title: "Arrival",
					notes: null,
					timeZone: "Europe/Zurich",
					startsAt: "2026-07-19T09:00:00.000Z",
					endsAt: null,
					allDay: false,
					sortKey: "1024",
					status: "active",
					details: { schemaVersion: 1, type: "activity" },
					placeId: "plc_station",
					placeSnapshot: {
						id: "plc_station",
						name: "Zürich HB",
						locality: "Zürich",
						countryCode: "CH",
						latitude: 47.3779,
						longitude: 8.5402,
					},
					version: 1,
					createdAt: now,
					updatedAt: now,
					deletedAt: null,
				},
			},
		],
		pageInfo: {
			hasMore: true,
			nextCursor: "bootstrap-page-cursor-2",
		},
	};
	const second: SyncBootstrapPage = {
		...common,
		records: [
			{
				entityType: "feedEntry",
				entityId: "fed_notice",
				entityVersion: 1,
				data: {
					id: "fed_notice",
					rootEventId: "evt_trip",
					eventId: "evt_day_a",
					parentEntryId: null,
					actorUserId,
					kind: "message",
					payloadSchemaVersion: 1,
					payload: { text: "Meet at nine" },
					rootRevision: hugeRevision,
					createdRootRevision: hugeRevision,
					version: 1,
					createdAt: now,
					updatedAt: now,
					deletedAt: null,
				},
			},
			{
				entityType: "event",
				entityId: "evt_trip",
				entityVersion: 2,
				data: {
					id: "evt_trip",
					rootEventId: "evt_trip",
					parentEventId: null,
					kind: "trip",
					title: "Canonical trip",
					description: null,
					timeZone: "Europe/Zurich",
					startsAt: null,
					endsAt: null,
					sortKey: "1024",
					childOrderVersion: 2,
					itineraryOrderVersion: 2,
					status: "published",
					version: 2,
					createdAt: now,
					updatedAt: now,
					deletedAt: null,
				},
			},
			{
				entityType: "event",
				entityId: "evt_day_a",
				entityVersion: 1,
				data: {
					id: "evt_day_a",
					rootEventId: "evt_trip",
					parentEventId: "evt_trip",
					kind: "activity",
					title: "Arrival day",
					description: null,
					timeZone: "Europe/Zurich",
					startsAt: null,
					endsAt: null,
					sortKey: "1024",
					childOrderVersion: 1,
					itineraryOrderVersion: 1,
					status: "published",
					version: 1,
					createdAt: now,
					updatedAt: now,
					deletedAt: null,
				},
			},
			{
				entityType: "membership",
				entityId: actorUserId,
				entityVersion: 1,
				data: {
					rootEventId: "evt_trip",
					userId: actorUserId,
					role: "owner",
					status: "active",
					version: 1,
					createdAt: now,
					updatedAt: now,
				},
			},
			{
				entityType: "invitation",
				entityId: "inv_trip_01",
				entityVersion: 1,
				data: {
					id: "inv_trip_01",
					rootEventId: "evt_trip",
					role: "participant",
					emailBound: false,
					expiresAt: "2026-08-18T12:00:00.000Z",
					maxUses: 8,
					useCount: 1,
					status: "active",
					version: 1,
					createdAt: now,
					updatedAt: now,
				},
			},
			{
				entityType: "place",
				entityId: "plc_station",
				entityVersion: 1,
				data: {
					id: "plc_station",
					rootEventId: "evt_trip",
					name: "Zürich HB",
					locality: "Zürich",
					countryCode: "CH",
					latitude: 47.3779,
					longitude: 8.5402,
					version: 1,
					createdAt: now,
					updatedAt: now,
					deletedAt: null,
				},
			},
		],
		pageInfo: { hasMore: false, nextCursor: null },
	};
	return [first, second];
}

async function completeBootstrap(
	store: MobileDataStore,
	accountUserId: string,
	snapshotId?: string,
): Promise<void> {
	const [first, second] = bootstrapPages(accountUserId, snapshotId);
	await store.applyBootstrapPage(accountUserId, null, first);
	await store.applyBootstrapPage(
		accountUserId,
		first.pageInfo.nextCursor,
		second,
	);
}

function tombstonePullPage(actorUserId: string): SyncPullPage {
	const rootRevision = `${hugeRevision}1`;
	const deletedAt = "2026-07-18T13:00:00.000Z";
	return {
		protocolVersion: 1,
		rootEventId: "evt_trip",
		authorizationScopeVersion: `${hugeRevision}1`,
		changes: [
			{
				rootRevision,
				ordinal: 0,
				entityVersion: 2,
				entityType: "event",
				entityId: "evt_day_a",
				operation: "tombstone",
				tombstone: {
					entityType: "event",
					id: "evt_day_a",
					rootEventId: "evt_trip",
					eventId: "evt_day_a",
					version: 2,
					deletedAt,
				},
			},
			{
				rootRevision,
				ordinal: 1,
				entityVersion: 2,
				entityType: "itineraryItem",
				entityId: "iti_arrival",
				operation: "tombstone",
				tombstone: {
					entityType: "itineraryItem",
					id: "iti_arrival",
					rootEventId: "evt_trip",
					eventId: "evt_day_a",
					version: 2,
					deletedAt,
				},
			},
			{
				rootRevision,
				ordinal: 2,
				entityVersion: 2,
				entityType: "capability",
				entityId: "evt_day_a:travel",
				operation: "tombstone",
				tombstone: {
					entityType: "capability",
					id: "evt_day_a:travel",
					rootEventId: "evt_trip",
					eventId: "evt_day_a",
					type: "travel",
					version: 2,
					deletedAt,
				},
			},
			{
				rootRevision,
				ordinal: 3,
				entityVersion: 2,
				entityType: "feedEntry",
				entityId: "fed_notice",
				operation: "tombstone",
				tombstone: {
					id: "fed_notice",
					rootEventId: "evt_trip",
					eventId: "evt_day_a",
					version: 2,
					deletedAt,
				},
			},
			{
				rootRevision,
				ordinal: 4,
				entityVersion: 2,
				entityType: "feedReaction",
				entityId: reactionEntityId,
				operation: "tombstone",
				tombstone: {
					entryId: "fed_notice",
					rootEventId: "evt_trip",
					userId: actorUserId,
					reaction: "like",
					version: 2,
					deletedAt,
				},
			},
			{
				rootRevision,
				ordinal: 5,
				entityVersion: 2,
				entityType: "invitation",
				entityId: "inv_trip_01",
				operation: "tombstone",
				tombstone: {
					entityType: "invitation",
					id: "inv_trip_01",
					rootEventId: "evt_trip",
					eventId: "evt_trip",
					version: 2,
					deletedAt,
				},
			},
		],
		checkpointCursor: "pull-checkpoint-tombstones-0001",
		pageInfo: { hasMore: false, nextCursor: null },
	};
}

function invitationUpsertPage(
	version: number,
	rootRevision: string,
	checkpointCursor: string,
): SyncPullPage {
	return {
		protocolVersion: 1,
		rootEventId: "evt_trip",
		authorizationScopeVersion: `${hugeRevision}1`,
		changes: [
			{
				rootRevision,
				ordinal: 0,
				entityVersion: version,
				entityType: "invitation",
				entityId: "inv_trip_01",
				operation: "upsert",
				data: {
					id: "inv_trip_01",
					rootEventId: "evt_trip",
					role: "viewer",
					emailBound: true,
					expiresAt: "2026-09-18T12:00:00.000Z",
					maxUses: 3,
					useCount: 2,
					status: "active",
					version,
					createdAt: now,
					updatedAt: "2026-07-18T14:00:00.000Z",
				},
			},
		],
		checkpointCursor,
		pageInfo: { hasMore: false, nextCursor: null },
	};
}

async function seedAccount(
	database: BunDatabase,
	accountUserId: string,
): Promise<MobileDataStore> {
	const store = new MobileDataStore(database);
	await store.putRootSyncState(rootState(accountUserId));
	await store.putEvent(
		event(accountUserId, "evt_trip", null, "1024", `Trip for ${accountUserId}`),
	);
	await store.putEvent(event(accountUserId, "evt_day_b", "evt_trip", "2048"));
	await store.putEvent(event(accountUserId, "evt_day_a", "evt_trip", "1024"));
	await store.putEvent(
		event(accountUserId, "evt_session", "evt_day_a", "1024"),
	);

	const membership: MembershipRecord = {
		accountUserId,
		rootEventId: "evt_trip",
		memberUserId: accountUserId,
		role: "owner",
		status: "active",
		version: 1,
		createdAt: now,
		updatedAt: now,
	};
	await store.putMembership(membership);

	const draft: DraftRecord = {
		accountUserId,
		id: "draft-note",
		rootEventId: "evt_trip",
		eventId: "evt_day_a",
		entityType: "feedEntry",
		contentJson: '{"content":"offline note"}',
		createdAt: now,
		updatedAt: now,
	};
	await store.putDraft(draft);

	await store.putFeedEntry(feed(accountUserId, "fed_notice", "12"));
	return store;
}

describe("mobile SQLite read models", () => {
	test("versioned migration is idempotent", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await migrate(database);

		const applied = await database.all<{ version: number; name: string }>(
			"SELECT version, name FROM schema_migrations ORDER BY version",
		);
		expect(applied).toEqual([
			{ version: 1, name: "local_read_models" },
			{ version: 2, name: "lossless_sync_read_models" },
			{ version: 3, name: "complete_event_sync_projection" },
			{ version: 4, name: "lossless_feed_tombstone_references" },
			{ version: 5, name: "durable_mutation_outbox" },
			{ version: 6, name: "retained_attachment_media" },
			{ version: 7, name: "community_feedback_cache" },
			{ version: 8, name: "golf_offline_read_models" },
			{ version: 9, name: "golf_intent_outbox_link" },
			{ version: 10, name: "golf_manager_roster_projection" },
			{ version: 11, name: "golf_player_tombstones" },
			{ version: 12, name: "sanitized_root_community_feedback" },
			{ version: 13, name: "team_collaboration_read_models" },
			{ version: 14, name: "sanitized_member_directory" },
			{ version: 15, name: "authorized_recap_snapshots" },
			{ version: 16, name: "actor_event_root_index" },
			{ version: 17, name: "durable_feedback_submissions" },
			{ version: 18, name: "event_publish_readiness" },
			{ version: 19, name: "feedback_screenshot_delivery" },
			{ version: 20, name: "feedback_duplicate_suggestion_cache" },
			{ version: 21, name: "recap_external_command_attempts" },
			{ version: 22, name: "root_scoped_mutation_stream_identity" },
		]);
		expect(
			await database.first<{ foreign_keys: number }>("PRAGMA foreign_keys"),
		).toEqual({ foreign_keys: 1 });
		database.close();
	});

	test("purges the legacy PII cache when upgrading to root-scoped community feedback", async () => {
		const database = new BunDatabase();
		await migrateThrough(database, 11);
		await database.run(
			`INSERT INTO community_feedback_cache (
  account_user_id, feedback_id, visibility, status, payload_json, refreshed_at
) VALUES (?, ?, 'public', 'open', ?, ?)`,
			[
				"usr_legacy",
				"fbk_legacy",
				JSON.stringify({
					authorUserId: "usr_private",
					diagnostics: { deviceModel: "private-device" },
				}),
				now,
			],
		);
		await database.run(
			`INSERT INTO community_feedback_follows (
  account_user_id, feedback_id, followed_at
) VALUES (?, ?, ?)`,
			["usr_legacy", "fbk_legacy", now],
		);

		await migrate(database);

		expect(
			await database.first<{ count: number }>(
				"SELECT count(*) AS count FROM community_feedback_cache",
			),
		).toEqual({ count: 0 });
		expect(
			await database.first(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'community_feedback_follows'",
			),
		).toBeNull();
		expect(
			(
				await database.all<{ name: string }>(
					"PRAGMA table_info(community_feedback_cache)",
				)
			).map(({ name }) => name),
		).toContain("root_event_id");
		expect(
			await database.first<{ name: string }>(
				"SELECT name FROM schema_migrations WHERE version = 12",
			),
		).toEqual({ name: "sanitized_root_community_feedback" });
		database.close();
	});

	test("upgrades staged snapshots and tombstones into SQL-TEAM without row loss", async () => {
		const database = new BunDatabase();
		await migrateThrough(database, 12);
		const accountUserId = `usr_${"a".repeat(32)}`;
		const rootEventId = "evt_team_upgrade";
		await database.run(
			`INSERT INTO root_sync_state (
  account_user_id, root_event_id, pull_cursor, snapshot_id, snapshot_revision,
  authorization_scope_version, last_completed_sync_at
) VALUES (?, ?, 'cursor-live', 'snp_live', '7', '1', ?)`,
			[accountUserId, rootEventId, now],
		);
		await database.run(
			`INSERT INTO sync_snapshot_staging (
  account_user_id, root_event_id, snapshot_id, snapshot_revision,
  authorization_scope_version, sync_cursor, next_page_cursor, base_pull_cursor
) VALUES (?, ?, 'snp_staged', '8', '1', 'cursor-staged', NULL, 'cursor-live')`,
			[accountUserId, rootEventId],
		);
		await database.run(
			`INSERT INTO sync_snapshot_records (
  account_user_id, root_event_id, snapshot_id, entity_type, entity_id,
  entity_version, data_json
) VALUES (?, ?, 'snp_staged', 'event', ?, 1, '{}')`,
			[accountUserId, rootEventId, rootEventId],
		);
		await database.run(
			`INSERT INTO sync_tombstones (
  account_user_id, root_event_id, entity_type, entity_id, entity_version,
  root_revision, ordinal, deleted_at, tombstone_json
) VALUES (?, ?, 'event', 'evt_deleted', 1, '7', 0, ?, '{}')`,
			[accountUserId, rootEventId, now],
		);

		await migrate(database);

		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM sync_snapshot_records",
			),
		).toEqual({ count: 1 });
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM sync_tombstones",
			),
		).toEqual({ count: 1 });
		expect(
			await database.first<{ name: string }>(
				"SELECT name FROM schema_migrations WHERE version = 13",
			),
		).toEqual({ name: "team_collaboration_read_models" });
		expect(await database.all("PRAGMA foreign_key_check")).toEqual([]);
		database.close();
	});

	test("retains normalized byte identity across a database restart", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-attachment-media-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "account.sqlite");
		const accountUserId = `usr_${"a".repeat(32)}`;
		const sha256 = "b".repeat(64);
		const attachment = {
			accountUserId,
			attachmentId: "att_restart",
			rootEventId: "evt_trip",
			targetEntryId: "fed_pending",
			retainedFileKey: `${sha256}.jpg`,
			contentType: "image/jpeg" as const,
			byteCount: 1_024_000,
			sha256,
			pixelWidth: 3024,
			pixelHeight: 4032,
			wasNormalized: true,
			retainedAt: now,
		};

		let database = new BunDatabase(path);
		await migrate(database);
		await new MobileDataStore(database).putRootSyncState(
			rootState(accountUserId),
		);
		const firstStore = new LocalAttachmentStore(database);
		await firstStore.retain(attachment);
		await firstStore.retain({
			...attachment,
			attachmentId: "att_restart_copy",
		});
		database.close();

		database = new BunDatabase(path);
		await migrate(database);
		const store = new LocalAttachmentStore(database);
		expect(await store.get(accountUserId, attachment.attachmentId)).toEqual(
			attachment,
		);
		expect(await store.listRetainedFileKeys(accountUserId)).toEqual([
			attachment.retainedFileKey,
		]);
		expect(
			await store.retain({
				...attachment,
				retainedAt: "2026-07-18T13:00:00.000Z",
			}),
		).toEqual(attachment);
		await expect(
			store.retain({
				...attachment,
				sha256: "c".repeat(64),
				retainedFileKey: `${"c".repeat(64)}.jpg`,
			}),
		).rejects.toThrow("different retained bytes");
		const columns = await database.all<{ name: string }>(
			"PRAGMA table_info(local_attachment_media)",
		);
		expect(columns.map(({ name }) => name)).not.toContain("source_uri");
		database.close();
	});

	test("upgrades populated v1 data losslessly with foreign keys enabled", async () => {
		const database = new BunDatabase();
		await migrateV1(database);
		await database.exec(`
INSERT INTO root_sync_state VALUES (
  'usr_upgrade', 'evt_upgrade', 'cursor-v1', 'snp_v1',
  '900719925474099312345', 9007199254740993, '2026-07-17T10:00:00.000Z'
);
INSERT INTO events VALUES (
  'usr_upgrade', 'evt_upgrade', 'evt_upgrade', NULL, 'trip', 'Upgrade', NULL,
  'Europe/Zurich', NULL, NULL, '10', 'published', 3,
  '2026-07-17T08:00:00.000Z', '2026-07-17T09:00:00.000Z', NULL
);
INSERT INTO events VALUES (
  'usr_upgrade', 'evt_upgrade_child', 'evt_upgrade', 'evt_upgrade', 'activity',
  'Child', NULL, 'Europe/Zurich', NULL, NULL, '2', 'published', 1,
  '2026-07-17T08:10:00.000Z', '2026-07-17T09:10:00.000Z', NULL
);
INSERT INTO memberships VALUES (
  'usr_upgrade', 'evt_upgrade', 'usr_upgrade', 'owner', 'active', 4,
  '2026-07-17T09:20:00.000Z'
);
INSERT INTO itinerary_items VALUES (
  'usr_upgrade', 'iti_upgrade', 'evt_upgrade', 'evt_upgrade_child', 'Activity',
  NULL, 'Europe/Zurich', NULL, NULL, 0, '10', 'active', 1,
  '{"type":"activity"}', NULL, NULL, 2,
  '2026-07-17T08:30:00.000Z', '2026-07-17T09:30:00.000Z', NULL
);
INSERT INTO feed_entries VALUES (
  'usr_upgrade', 'fed_upgrade', 'evt_upgrade', 'evt_upgrade_child',
  'usr_upgrade', 'message', 1, '{"text":"hello"}',
  '900719925474099312345', 7, 5,
  '2026-07-17T08:40:00.000Z', NULL
);
INSERT INTO local_drafts VALUES (
  'usr_upgrade', 'draft_upgrade', 'evt_upgrade', 'evt_upgrade_child',
  'feedEntry', '{"text":"offline"}',
  '2026-07-17T08:50:00.000Z', '2026-07-17T09:50:00.000Z'
);
INSERT INTO public_places VALUES (
  'plc_upgrade', 'Zürich', 'Zürich', 'CH', 47.37, 8.54,
  '{"source":"v1"}', '2026-07-17T10:00:00.000Z'
);
`);

		await migrate(database);
		const store = new MobileDataStore(database);
		expect(
			await store.getRootSyncState("usr_upgrade", "evt_upgrade"),
		).toMatchObject({
			snapshotRevision: "900719925474099312345",
			authorizationScopeVersion: "9007199254740993",
		});
		expect(
			(await store.listEventTree("usr_upgrade", "evt_upgrade")).map(
				({ id, childOrderVersion, itineraryOrderVersion }) => [
					id,
					childOrderVersion,
					itineraryOrderVersion,
				],
			),
		).toEqual([
			["evt_upgrade", "1", "1"],
			["evt_upgrade_child", "1", "1"],
		]);
		expect(
			(await store.listMemberships("usr_upgrade", "evt_upgrade"))[0],
		).toMatchObject({
			createdAt: "2026-07-17T09:20:00.000Z",
			updatedAt: "2026-07-17T09:20:00.000Z",
		});
		expect(
			(await store.listTimeline("usr_upgrade", "evt_upgrade"))[0]?.id,
		).toBe("iti_upgrade");
		expect(
			(await store.listFeed("usr_upgrade", "evt_upgrade"))[0],
		).toMatchObject({
			id: "fed_upgrade",
			parentEntryId: null,
			rootRevision: "900719925474099312345",
			createdRootRevision: "900719925474099312345",
			revisionOrdinal: 7,
			updatedAt: "2026-07-17T08:40:00.000Z",
		});
		expect((await store.listDrafts("usr_upgrade", "evt_upgrade"))[0]?.id).toBe(
			"draft_upgrade",
		);
		expect((await store.getPublicPlace("plc_upgrade"))?.name).toBe("Zürich");
		expect(await database.all("PRAGMA foreign_key_check")).toEqual([]);
		expect(
			await database.first<{ type: string }>(
				"SELECT type FROM pragma_table_info('root_sync_state') WHERE name = 'authorization_scope_version'",
			),
		).toEqual({ type: "TEXT" });
		await database.run(
			"DELETE FROM events WHERE account_user_id = 'usr_upgrade' AND id = 'evt_upgrade_child'",
		);
		expect((await store.listDrafts("usr_upgrade", "evt_upgrade"))[0]?.id).toBe(
			"draft_upgrade",
		);
		expect(await database.all("PRAGMA foreign_key_check")).toEqual([]);
		database.close();
	});

	test("rolls back schema-valid v1 sort keys that cannot be copied losslessly", async () => {
		for (const [index, sortKey] of ["02", "", "rank-a"].entries()) {
			const database = new BunDatabase();
			await migrateV1(database);
			const accountUserId = `usr_invalid_${index}`;
			const rootEventId = `evt_invalid_${index}`;
			await database.run(
				`INSERT INTO root_sync_state (
  account_user_id, root_event_id, pull_cursor, snapshot_id, snapshot_revision,
  authorization_scope_version, last_completed_sync_at
) VALUES (?, ?, NULL, NULL, NULL, 1, NULL)`,
				[accountUserId, rootEventId],
			);
			await database.run(
				`INSERT INTO events (
  account_user_id, id, root_event_id, parent_event_id, kind, title,
  description, time_zone, starts_at, ends_at, sort_key, status, version,
  created_at, updated_at, deleted_at
) VALUES (?, ?, ?, NULL, 'trip', 'Legacy', NULL, 'Europe/Zurich', NULL, NULL,
  ?, 'published', 1, ?, ?, NULL)`,
				[accountUserId, rootEventId, rootEventId, sortKey, now, now],
			);

			await expect(migrate(database)).rejects.toThrow(
				"CHECK constraint failed",
			);
			expect(
				await database.first<{ sort_key: string }>(
					"SELECT sort_key FROM events WHERE account_user_id = ? AND id = ?",
					[accountUserId, rootEventId],
				),
			).toEqual({ sort_key: sortKey });
			expect(
				await database.first<{ count: number }>(
					"SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 2",
				),
			).toEqual({ count: 0 });
			expect(
				await database.first<{ count: number }>(
					"SELECT COUNT(*) AS count FROM sqlite_master WHERE name = 'events_v2'",
				),
			).toEqual({ count: 0 });

			await database.run(
				"UPDATE events SET sort_key = '1' WHERE account_user_id = ? AND id = ?",
				[accountUserId, rootEventId],
			);
			await migrate(database);
			expect(
				(
					await new MobileDataStore(database).listEventTree(
						accountUserId,
						rootEventId,
					)
				)[0]?.sortKey,
			).toBe("1");
			database.close();
		}
	});

	test("rolls back a failed v2 upgrade, retries once, and rejects downgrade drift", async () => {
		const database = new FaultInjectingDatabase();
		await migrateV1(database);
		await database.exec(`
INSERT INTO root_sync_state VALUES (
  'usr_rollback', 'evt_rollback', NULL, NULL, '7', 8, NULL
);
INSERT INTO events VALUES (
  'usr_rollback', 'evt_rollback', 'evt_rollback', NULL, 'trip', 'Rollback',
  NULL, 'Europe/Zurich', NULL, NULL, '1', 'published', 1,
  '${now}', '${now}', NULL
);
`);
		database.failAfterV2Sql = true;
		await expect(migrate(database)).rejects.toThrow(
			"injected v2 migration failure",
		);
		expect(
			await database.all<{ version: number }>(
				"SELECT version FROM schema_migrations ORDER BY version",
			),
		).toEqual([{ version: 1 }]);
		expect(
			await database.first<{ title: string }>(
				"SELECT title FROM events WHERE id = 'evt_rollback'",
			),
		).toEqual({ title: "Rollback" });
		expect(
			await database.first(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'root_sync_state_v2'",
			),
		).toBeNull();

		await migrate(database);
		await migrate(database);
		expect(
			await database.all<{ version: number }>(
				"SELECT version FROM schema_migrations ORDER BY version",
			),
		).toEqual([
			{ version: 1 },
			{ version: 2 },
			{ version: 3 },
			{ version: 4 },
			{ version: 5 },
			{ version: 6 },
			{ version: 7 },
			{ version: 8 },
			{ version: 9 },
			{ version: 10 },
			{ version: 11 },
			{ version: 12 },
			{ version: 13 },
			{ version: 14 },
			{ version: 15 },
			{ version: 16 },
			{ version: 17 },
			{ version: 18 },
			{ version: 19 },
			{ version: 20 },
			{ version: 21 },
			{ version: 22 },
		]);
		await database.run(
			"INSERT INTO schema_migrations (version, name) VALUES (23, 'future_schema')",
		);
		await expect(migrate(database)).rejects.toThrow(
			"Unknown or renamed SQLite migration 23:future_schema",
		);
		database.close();
	});

	test("upgrades populated v3 feed relations without losing dependent rows", async () => {
		const database = new FaultInjectingDatabase();
		database.failAfterV4Sql = true;
		await expect(migrate(database)).rejects.toThrow(
			"injected v4 migration failure",
		);
		expect(
			await database.all<{ version: number }>(
				"SELECT version FROM schema_migrations ORDER BY version",
			),
		).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);

		await seedAccount(database, "usr_alice");
		await database.run(
			`INSERT INTO feed_reactions VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)`,
			[
				"usr_alice",
				reactionEntityId,
				"evt_trip",
				"fed_notice",
				"usr_alice",
				"like",
				now,
			],
		);
		await database.run(
			`INSERT INTO attachments VALUES (?, ?, ?, 'feedEntry', ?, 'image/jpeg', 10, ?, NULL, 1, ?)`,
			[
				"usr_alice",
				"att_upgrade",
				"evt_trip",
				"fed_notice",
				"c".repeat(64),
				now,
			],
		);

		await migrate(database);
		const feedForeignKeys = await database.all<{ table: string }>(
			"PRAGMA foreign_key_list(feed_entries)",
		);
		expect(feedForeignKeys).toHaveLength(2);
		expect(new Set(feedForeignKeys.map(({ table }) => table))).toEqual(
			new Set(["root_sync_state"]),
		);
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM feed_entries",
			),
		).toEqual({ count: 1 });
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM feed_reactions",
			),
		).toEqual({ count: 1 });
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM attachments",
			),
		).toEqual({ count: 1 });
		expect(await database.all("PRAGMA foreign_key_check")).toEqual([]);
		database.close();
	});

	test("bootstraps live feed rows with tombstoned parent or event references", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const store = new MobileDataStore(database);
		const [, canonicalFinalPage] = bootstrapPages("usr_alice", "snp_orphans");
		const root = canonicalFinalPage.records.find(
			(record) =>
				record.entityType === "event" && record.entityId === "evt_trip",
		);
		if (!root) throw new Error("root snapshot fixture missing");
		const page: SyncBootstrapPage = {
			...canonicalFinalPage,
			records: [
				root,
				{
					entityType: "feedEntry",
					entityId: "fed_orphan_parent",
					entityVersion: 1,
					data: {
						id: "fed_orphan_parent",
						rootEventId: "evt_trip",
						eventId: "evt_trip",
						parentEntryId: "fed_deleted_parent",
						actorUserId: "usr_alice",
						kind: "comment",
						payloadSchemaVersion: 1,
						payload: { text: "Parent was removed" },
						rootRevision: "12",
						createdRootRevision: "10",
						version: 1,
						createdAt: now,
						updatedAt: now,
						deletedAt: null,
					},
				},
				{
					entityType: "feedEntry",
					entityId: "fed_orphan_event",
					entityVersion: 1,
					data: {
						id: "fed_orphan_event",
						rootEventId: "evt_trip",
						eventId: "evt_deleted",
						parentEntryId: null,
						actorUserId: "usr_alice",
						kind: "message",
						payloadSchemaVersion: 1,
						payload: { text: "Event was removed" },
						rootRevision: "13",
						createdRootRevision: "11",
						version: 1,
						createdAt: now,
						updatedAt: now,
						deletedAt: null,
					},
				},
			],
			pageInfo: { hasMore: false, nextCursor: null },
		};

		expect(await store.applyBootstrapPage("usr_alice", null, page)).toEqual({
			completed: true,
			nextCursor: null,
		});
		expect(await store.listFeed("usr_alice", "evt_trip")).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "fed_orphan_parent",
					eventId: "evt_trip",
					parentEntryId: "fed_deleted_parent",
				}),
				expect.objectContaining({
					id: "fed_orphan_event",
					eventId: "evt_deleted",
					parentEntryId: null,
				}),
			]),
		);
		await expect(
			store.putFeedEntry({
				...feed("usr_alice", "fed_wrong_root", "14"),
				rootEventId: "evt_missing",
				eventId: null,
			}),
		).rejects.toThrow();
		expect(await database.all("PRAGMA foreign_key_check")).toEqual([]);
		database.close();
	});

	test("finishes an FK-hostile bootstrap across restart without exposing partial state", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-mobile-bootstrap-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "crew.sqlite");
		const firstConnection = new BunDatabase(path);
		await migrate(firstConnection);
		const firstStore = await seedAccount(firstConnection, "usr_alice");
		const [firstPage, secondPage] = bootstrapPages("usr_alice");

		expect(
			await firstStore.applyBootstrapPage("usr_alice", null, firstPage),
		).toEqual({
			completed: false,
			nextCursor: "bootstrap-page-cursor-2",
		});
		expect(
			(await firstStore.listEventTree("usr_alice", "evt_trip"))[0]?.title,
		).toBe("Trip for usr_alice");
		expect(
			await firstConnection.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM sync_snapshot_records WHERE account_user_id = 'usr_alice'",
			),
		).toEqual({ count: firstPage.records.length });
		firstConnection.close();

		const reopenedConnection = new BunDatabase(path);
		await migrate(reopenedConnection);
		const reopened = new MobileDataStore(reopenedConnection);
		expect(
			(await reopened.listEventTree("usr_alice", "evt_trip"))[0]?.title,
		).toBe("Trip for usr_alice");
		expect(
			await reopened.applyBootstrapPage(
				"usr_alice",
				firstPage.pageInfo.nextCursor,
				secondPage,
			),
		).toEqual({ completed: true, nextCursor: null });

		expect(
			await reopened.getRootSyncState("usr_alice", "evt_trip"),
		).toMatchObject({
			pullCursor: "bootstrap-checkpoint-0001",
			snapshotId: "snp_complete_1",
			snapshotRevision: hugeRevision,
			authorizationScopeVersion: `${hugeRevision}1`,
		});
		expect(
			(await reopened.listEventTree("usr_alice", "evt_trip")).map(
				({ id }) => id,
			),
		).toEqual(["evt_trip", "evt_day_a"]);
		expect(
			(await reopened.listInvitations("usr_alice", "evt_trip")).map(
				({ id }) => id,
			),
		).toEqual(["inv_trip_01"]);
		expect(
			(await reopened.listEventPlaces("usr_alice", "evt_trip")).map(
				({ id }) => id,
			),
		).toEqual(["plc_station"]);
		expect(
			(await reopened.listCapabilities("usr_alice", "evt_trip")).map(
				({ entityId }) => entityId,
			),
		).toEqual(["evt_day_a:travel"]);
		expect(
			(await reopened.listTimeline("usr_alice", "evt_trip")).map(
				({ id }) => id,
			),
		).toEqual(["iti_arrival"]);
		expect((await reopened.listFeed("usr_alice", "evt_trip"))[0]).toMatchObject(
			{
				id: "fed_notice",
				rootRevision: hugeRevision,
				createdRootRevision: hugeRevision,
				revisionOrdinal: null,
			},
		);
		expect(
			(await reopened.listFeedReactions("usr_alice", "evt_trip")).map(
				({ entityId }) => entityId,
			),
		).toEqual([reactionEntityId]);
		expect(
			(await reopened.listAttachments("usr_alice", "evt_trip")).map(
				({ id }) => id,
			),
		).toEqual(["att_photo"]);
		expect(
			(await reopened.listDrafts("usr_alice", "evt_trip")).map(({ id }) => id),
		).toEqual(["draft-note"]);
		expect(
			await reopenedConnection.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM sync_snapshot_staging WHERE account_user_id = 'usr_alice'",
			),
		).toEqual({ count: 0 });
		expect(await reopenedConnection.all("PRAGMA foreign_key_check")).toEqual(
			[],
		);
		reopenedConnection.close();
	});

	test("rolls back a broken final bootstrap page and keeps the prior graph", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const store = await seedAccount(database, "usr_alice");
		const [firstPage, secondPage] = bootstrapPages("usr_alice", "snp_broken_1");
		const brokenFinalPage: SyncBootstrapPage = {
			...secondPage,
			records: secondPage.records.filter(
				(record) => record.entityType !== "feedEntry",
			),
		};

		await store.applyBootstrapPage("usr_alice", null, firstPage);
		await expect(
			store.applyBootstrapPage(
				"usr_alice",
				firstPage.pageInfo.nextCursor,
				brokenFinalPage,
			),
		).rejects.toThrow();
		expect((await store.listEventTree("usr_alice", "evt_trip"))[0]?.title).toBe(
			"Trip for usr_alice",
		);
		expect(
			(await store.getRootSyncState("usr_alice", "evt_trip"))?.pullCursor,
		).toBe("cursor-12");
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM sync_snapshot_records WHERE account_user_id = 'usr_alice' AND snapshot_id = 'snp_broken_1'",
			),
		).toEqual({ count: firstPage.records.length });
		expect(await database.all("PRAGMA foreign_key_check")).toEqual([]);
		database.close();
	});

	test("applies ordered pull tombstones once and gates stale resurrection", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const store = new MobileDataStore(database);
		await completeBootstrap(store, "usr_alice");
		await store.putDraft({
			accountUserId: "usr_alice",
			id: "draft-after-bootstrap",
			rootEventId: "evt_trip",
			eventId: "evt_day_a",
			entityType: "feedEntry",
			contentJson: '{"text":"offline survives"}',
			createdAt: now,
			updatedAt: now,
		});
		const tombstones = tombstonePullPage("usr_alice");

		expect(
			await store.applyPullPage(
				"usr_alice",
				"bootstrap-checkpoint-0001",
				tombstones,
			),
		).toEqual({ replayed: false });
		expect(
			(await store.listEventTree("usr_alice", "evt_trip")).map(({ id }) => id),
		).toEqual(["evt_trip"]);
		expect(await store.listTimeline("usr_alice", "evt_trip")).toEqual([]);
		expect(await store.listFeed("usr_alice", "evt_trip")).toEqual([]);
		expect(await store.listInvitations("usr_alice", "evt_trip")).toEqual([]);
		expect(await store.listCapabilities("usr_alice", "evt_trip")).toEqual([]);
		expect(await store.listFeedReactions("usr_alice", "evt_trip")).toEqual([]);
		expect(await store.listAttachments("usr_alice", "evt_trip")).toEqual([]);
		expect(
			(await store.listDrafts("usr_alice", "evt_trip")).map(({ id }) => id),
		).toEqual(["draft-after-bootstrap"]);
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM sync_tombstones WHERE account_user_id = 'usr_alice'",
			),
		).toEqual({ count: 6 });
		const reactionTombstone = await database.first<{
			root_revision: string;
			tombstone_json: string;
		}>(
			"SELECT root_revision, tombstone_json FROM sync_tombstones WHERE account_user_id = 'usr_alice' AND entity_type = 'feedReaction'",
		);
		expect(reactionTombstone?.root_revision).toBe(`${hugeRevision}1`);
		expect(JSON.parse(reactionTombstone?.tombstone_json ?? "null")).toEqual(
			tombstones.changes[4]?.operation === "tombstone"
				? tombstones.changes[4].tombstone
				: null,
		);

		expect(
			await store.applyPullPage(
				"usr_alice",
				"bootstrap-checkpoint-0001",
				tombstones,
			),
		).toEqual({ replayed: true });
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM sync_tombstones WHERE account_user_id = 'usr_alice'",
			),
		).toEqual({ count: 6 });

		const stale = invitationUpsertPage(
			1,
			`${hugeRevision}2`,
			"pull-checkpoint-stale-0002",
		);
		await store.applyPullPage(
			"usr_alice",
			"pull-checkpoint-tombstones-0001",
			stale,
		);
		expect(await store.listInvitations("usr_alice", "evt_trip")).toEqual([]);
		const fresh = invitationUpsertPage(
			3,
			`${hugeRevision}3`,
			"pull-checkpoint-fresh-0003",
		);
		await store.applyPullPage("usr_alice", "pull-checkpoint-stale-0002", fresh);
		expect(
			(await store.listInvitations("usr_alice", "evt_trip"))[0],
		).toMatchObject({ id: "inv_trip_01", role: "viewer", version: 3 });
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM sync_tombstones WHERE account_user_id = 'usr_alice' AND entity_type = 'invitation'",
			),
		).toEqual({ count: 0 });

		const ordered = invitationUpsertPage(
			4,
			`${hugeRevision}5`,
			"pull-checkpoint-invalid-0004",
		);
		const [newerChange] = ordered.changes;
		if (!newerChange) throw new Error("invitation change fixture missing");
		const outOfOrder: SyncPullPage = {
			...ordered,
			changes: [
				{ ...newerChange, ordinal: 1 },
				{ ...newerChange, rootRevision: `${hugeRevision}4`, ordinal: 0 },
			],
		};
		await expect(
			store.applyPullPage(
				"usr_alice",
				"pull-checkpoint-fresh-0003",
				outOfOrder,
			),
		).rejects.toThrow();
		expect(await store.getRootSyncState("usr_alice", "evt_trip")).toMatchObject(
			{
				pullCursor: "pull-checkpoint-fresh-0003",
				snapshotRevision: hugeRevision,
			},
		);
		expect(
			(await store.listInvitations("usr_alice", "evt_trip"))[0]?.version,
		).toBe(3);
		expect(await database.all("PRAGMA foreign_key_check")).toEqual([]);
		database.close();
	});

	test("cold-start and airplane-mode reads reopen the same SQLite source of truth", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-mobile-data-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "crew.sqlite");
		const firstConnection = new BunDatabase(path);
		await migrate(firstConnection);
		expect(
			await firstConnection.first<{ journal_mode: string }>(
				"PRAGMA journal_mode",
			),
		).toEqual({ journal_mode: "wal" });
		const firstStore = await seedAccount(firstConnection, "usr_alice");
		await firstStore.putItineraryItem(
			itinerary("usr_alice", "iti_later", "2026-07-19T09:00:00.000Z", "1024"),
		);
		firstConnection.close();

		// Reopening passes only a SQLite adapter; there is no HTTP or cache fallback.
		const reopenedConnection = new BunDatabase(path);
		await migrate(reopenedConnection);
		const reopened = new MobileDataStore(reopenedConnection);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (() => {
			throw new Error("network unavailable in airplane mode");
		}) as unknown as typeof fetch;

		try {
			expect(
				(await reopened.getRootSyncState("usr_alice", "evt_trip"))?.pullCursor,
			).toBe("cursor-12");
			expect(
				(await reopened.listEventTree("usr_alice", "evt_trip")).map(
					({ id }) => id,
				),
			).toEqual(["evt_trip", "evt_day_a", "evt_session", "evt_day_b"]);
			expect(
				(await reopened.listMemberships("usr_alice", "evt_trip")).map(
					({ role }) => role,
				),
			).toEqual(["owner"]);
			expect(
				(await reopened.listDrafts("usr_alice", "evt_trip")).map(
					({ id }) => id,
				),
			).toEqual(["draft-note"]);
			expect(
				(await reopened.listFeed("usr_alice", "evt_trip")).map(({ id }) => id),
			).toEqual(["fed_notice"]);
			expect(
				(await reopened.listTimeline("usr_alice", "evt_trip")).map(
					({ id }) => id,
				),
			).toEqual(["iti_later"]);
		} finally {
			globalThis.fetch = originalFetch;
			reopenedConnection.close();
		}
	});

	test("recursive tree and ancestors stay deterministic across multiple depths", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const store = await seedAccount(database, "usr_alice");

		const tree = await store.listEventTree("usr_alice", "evt_trip");
		expect(tree.map(({ id, depth }) => [id, depth])).toEqual([
			["evt_trip", 0],
			["evt_day_a", 1],
			["evt_session", 2],
			["evt_day_b", 1],
		]);
		expect(
			(
				await store.listEventAncestors("usr_alice", "evt_trip", "evt_session")
			).map(({ id }) => id),
		).toEqual(["evt_trip", "evt_day_a"]);

		await store.putEvent({
			...event("usr_alice", "evt_trip", null, "1024", "Current title"),
			version: 2,
			childOrderVersion: "900719925474099312345",
			itineraryOrderVersion: "900719925474099312346",
		});
		await store.putEvent(
			event("usr_alice", "evt_trip", null, "1024", "Stale title"),
		);
		expect(await store.listEventTree("usr_alice", "evt_trip")).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "evt_trip",
					title: "Current title",
					childOrderVersion: "900719925474099312345",
					itineraryOrderVersion: "900719925474099312346",
				}),
			]),
		);
		database.close();
	});

	test("round-trips decimal counters beyond JavaScript and SQLite integer precision", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const store = await seedAccount(database, "usr_alice");
		const huge = "900719925474099312345678901234567890";
		await store.putRootSyncState({
			...rootState("usr_alice"),
			snapshotRevision: huge,
			authorizationScopeVersion: `${huge}1`,
		});
		await store.putEvent({
			...event("usr_alice", "evt_trip", null, huge),
			version: 2,
			childOrderVersion: `${huge}2`,
			itineraryOrderVersion: `${huge}3`,
		});

		expect(await store.getRootSyncState("usr_alice", "evt_trip")).toMatchObject(
			{
				snapshotRevision: huge,
				authorizationScopeVersion: `${huge}1`,
			},
		);
		expect(
			(await store.listEventTree("usr_alice", "evt_trip"))[0],
		).toMatchObject({
			sortKey: huge,
			childOrderVersion: `${huge}2`,
			itineraryOrderVersion: `${huge}3`,
		});
		database.close();
	});

	test("orders 10+ event siblings and itinerary items by decimal sort key", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const store = await seedAccount(database, "usr_alice");
		for (let value = 12; value >= 1; value -= 1) {
			const suffix = value.toString().padStart(2, "0");
			await store.putEvent(
				event("usr_alice", `evt_sibling_${suffix}`, "evt_trip", String(value)),
			);
			await store.putItineraryItem(
				itinerary("usr_alice", `iti_numeric_${suffix}`, null, String(value)),
			);
		}
		const expectedEvents = Array.from(
			{ length: 12 },
			(_, index) => `evt_sibling_${String(index + 1).padStart(2, "0")}`,
		);
		const expectedItinerary = Array.from(
			{ length: 12 },
			(_, index) => `iti_numeric_${String(index + 1).padStart(2, "0")}`,
		);
		expect(
			(await store.listEventTree("usr_alice", "evt_trip"))
				.map(({ id }) => id)
				.filter((id) => id.startsWith("evt_sibling_")),
		).toEqual(expectedEvents);
		expect(
			(await store.listTimeline("usr_alice", "evt_trip")).map(({ id }) => id),
		).toEqual(expectedItinerary);
		await expect(
			store.putEvent(event("usr_alice", "evt_leading_zero", "evt_trip", "02")),
		).rejects.toThrow();
		await expect(
			store.putItineraryItem(
				itinerary("usr_alice", "iti_leading_zero", null, "02"),
			),
		).rejects.toThrow();
		database.close();
	});

	test("timeline orders scheduled instants then unscheduled sort keys with ID tie-breakers", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const store = await seedAccount(database, "usr_alice");
		for (const item of [
			itinerary("usr_alice", "iti_same_b", "2026-07-19T09:00:00.000Z", "2048"),
			itinerary("usr_alice", "iti_unscheduled_b2", null, "2048"),
			itinerary("usr_alice", "iti_early", "2026-07-19T08:00:00.000Z", "9999"),
			itinerary("usr_alice", "iti_same_a", "2026-07-19T09:00:00.000Z", "1024"),
			itinerary("usr_alice", "iti_unscheduled_b1", null, "2048"),
			itinerary("usr_alice", "iti_unscheduled_a", null, "1024"),
		]) {
			await store.putItineraryItem(item);
		}

		expect(
			(await store.listTimeline("usr_alice", "evt_trip")).map(({ id }) => id),
		).toEqual([
			"iti_early",
			"iti_same_a",
			"iti_same_b",
			"iti_unscheduled_a",
			"iti_unscheduled_b1",
			"iti_unscheduled_b2",
		]);
		await expect(
			store.putItineraryItem({
				...itinerary("usr_alice", "iti_broken_place", null, "1024"),
				placeId: "place_missing_snapshot",
			}),
		).rejects.toThrow();
		database.close();
	});

	test("feed uses canonical positive decimal root revisions and numeric order", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const store = await seedAccount(database, "usr_alice");
		await store.putFeedEntry(feed("usr_alice", "fed_ten", "10"));
		await store.putFeedEntry(feed("usr_alice", "fed_two", "2"));

		expect(
			(await store.listFeed("usr_alice", "evt_trip")).map(({ id }) => id),
		).toEqual(["fed_notice", "fed_ten", "fed_two"]);
		await expect(
			store.putFeedEntry(feed("usr_alice", "fed_leading_zero", "02")),
		).rejects.toThrow();
		database.close();
	});

	test("feed edits preserve immutable creation chronology and stale writes lose", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const store = await seedAccount(database, "usr_alice");
		const oldEntry: FeedRecord = {
			...feed("usr_alice", "fed_old", "2"),
			parentEntryId: "fed_notice",
		};
		const newEntry = feed("usr_alice", "fed_new", "10");
		await store.putFeedEntry(oldEntry);
		await store.putFeedEntry(newEntry);
		expect(
			(await store.listFeed("usr_alice", "evt_trip")).map(({ id }) => id),
		).toEqual(["fed_notice", "fed_new", "fed_old"]);

		const editedAt = "2026-07-18T13:00:00.000Z";
		await store.putFeedEntry({
			...oldEntry,
			parentEntryId: null,
			payloadJson: '{"content":"edited"}',
			rootRevision: "999999999999999999999999",
			createdRootRevision: "1000",
			version: 2,
			createdAt: editedAt,
			updatedAt: editedAt,
		});
		let records = await store.listFeed("usr_alice", "evt_trip");
		expect(records.map(({ id }) => id)).toEqual([
			"fed_notice",
			"fed_new",
			"fed_old",
		]);
		expect(records.find(({ id }) => id === "fed_old")).toMatchObject({
			parentEntryId: "fed_notice",
			payloadJson: '{"content":"edited"}',
			rootRevision: "999999999999999999999999",
			createdRootRevision: "2",
			version: 2,
			createdAt: now,
			updatedAt: editedAt,
		});

		await store.putFeedEntry({
			...oldEntry,
			payloadJson: '{"content":"stale"}',
			rootRevision: "1000000000000000000000000",
			updatedAt: "2026-07-18T14:00:00.000Z",
		});
		records = await store.listFeed("usr_alice", "evt_trip");
		expect(records.find(({ id }) => id === "fed_old")).toMatchObject({
			payloadJson: '{"content":"edited"}',
			version: 2,
			updatedAt: editedAt,
		});
		database.close();
	});

	test("logout removes one user's private graph while preserving another user and public places", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const alice = await seedAccount(database, "usr_alice");
		const bob = await seedAccount(database, "usr_bob");
		await completeBootstrap(alice, "usr_alice", "snp_alice");
		await completeBootstrap(bob, "usr_bob", "snp_bob");
		await alice.putPublicPlace({
			id: "place_zurich_hb",
			name: "Zürich HB",
			locality: "Zürich",
			countryCode: "CH",
			latitude: 47.3779,
			longitude: 8.5402,
			provenanceJson: '{"source":"event-service"}',
			updatedAt: now,
		});
		await alice.applyPullPage(
			"usr_alice",
			"bootstrap-checkpoint-0001",
			tombstonePullPage("usr_alice"),
		);
		const [pendingAlicePage] = bootstrapPages(
			"usr_alice",
			"snp_pending_logout",
		);
		await alice.applyBootstrapPage("usr_alice", null, pendingAlicePage);
		for (const accountUserId of ["usr_alice", "usr_bob"]) {
			await database.run(
				`INSERT INTO community_feedback_cache (
  account_user_id, root_event_id, feedback_id, status, version, followed,
  updated_at, summary_json, detail_json, refreshed_at
) VALUES (?, 'evt_trip', ?, 'open', 1, 1, ?, '{}', NULL, ?)`,
				[accountUserId, `fbk_${accountUserId}`, now, now],
			);
			await database.run(
				`INSERT INTO community_feedback_updates (
  account_user_id, root_event_id, feedback_id, version, changed_at,
  payload_json, refreshed_at
) VALUES (?, 'evt_trip', ?, 1, ?, '{}', ?)`,
				[accountUserId, `fbk_${accountUserId}`, now, now],
			);
		}

		await alice.clearUserData("usr_alice");

		expect(await alice.getRootSyncState("usr_alice", "evt_trip")).toBeNull();
		expect(await alice.listEventTree("usr_alice", "evt_trip")).toEqual([]);
		expect(await alice.listMemberships("usr_alice", "evt_trip")).toEqual([]);
		expect(await alice.listTimeline("usr_alice", "evt_trip")).toEqual([]);
		expect(await alice.listFeed("usr_alice", "evt_trip")).toEqual([]);
		expect(await alice.listInvitations("usr_alice", "evt_trip")).toEqual([]);
		expect(await alice.listEventPlaces("usr_alice", "evt_trip")).toEqual([]);
		expect(await alice.listCapabilities("usr_alice", "evt_trip")).toEqual([]);
		expect(await alice.listFeedReactions("usr_alice", "evt_trip")).toEqual([]);
		expect(await alice.listAttachments("usr_alice", "evt_trip")).toEqual([]);
		expect(await alice.listDrafts("usr_alice", "evt_trip")).toEqual([]);
		expect((await bob.listEventTree("usr_bob", "evt_trip"))[0]?.title).toBe(
			"Canonical trip",
		);
		expect(
			(await bob.listTimeline("usr_bob", "evt_trip")).map(({ id }) => id),
		).toEqual(["iti_arrival"]);
		expect(
			(await bob.listInvitations("usr_bob", "evt_trip")).map(({ id }) => id),
		).toEqual(["inv_trip_01"]);
		expect(
			(await bob.listFeedReactions("usr_bob", "evt_trip"))[0],
		).toMatchObject({ entityId: reactionEntityId, userId: "usr_bob" });
		for (const table of [
			"root_sync_state",
			"events",
			"memberships",
			"itinerary_items",
			"feed_entries",
			"local_drafts",
			"invitations",
			"event_places",
			"event_capabilities",
			"feed_reactions",
			"attachments",
			"sync_tombstones",
			"sync_snapshot_staging",
			"sync_snapshot_records",
			"mutation_streams",
			"mutation_outbox",
			"sync_push_batches",
			"community_feedback_cache",
			"community_feedback_updates",
			"feedback_submissions",
			"golf_rounds",
			"golf_holes",
			"golf_roster_players",
			"golf_players",
			"golf_teams",
			"golf_team_members",
			"golf_scores",
			"golf_leaderboards",
			"golf_rankings",
			"golf_intent_streams",
			"golf_score_intents",
		]) {
			expect(
				await database.first<{ count: number }>(
					`SELECT COUNT(*) AS count FROM ${table} WHERE account_user_id = 'usr_alice'`,
				),
			).toEqual({ count: 0 });
		}
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM community_feedback_cache WHERE account_user_id = 'usr_bob'",
			),
		).toEqual({ count: 1 });
		expect((await bob.getPublicPlace("place_zurich_hb"))?.name).toBe(
			"Zürich HB",
		);
		expect(await database.all("PRAGMA foreign_key_check")).toEqual([]);
		database.close();
	});
});

const syncAccount = "usr_00000000000000000000000000000001";
const syncDevice = "dvc_00000000-0000-4000-8000-000000000001";
const alternateSyncDevice = "dvc_00000000-0000-4000-8000-000000000002";
const freshSyncDevice = "dvc_00000000-0000-4000-8000-000000000099";

describe("root-scoped mutation stream identity", () => {
	test("migrates each legacy root without changing its sequence", async () => {
		const database = new BunDatabase();
		await migrateThrough(database, 21);
		await seedAccount(database, syncAccount);
		await seedMinimalRoot(database, syncAccount, "evt_other");
		const engine = testSyncEngine(database, syncAccount, noFetch);
		await engine.enqueueMutation(
			syncAccount,
			"evt_trip",
			syncDevice,
			feedCreate("fed_legacy_a", "Legacy A"),
			{},
		);
		await engine.enqueueMutation(
			syncAccount,
			"evt_trip",
			alternateSyncDevice,
			feedCreate("fed_legacy_b", "Legacy B"),
			{},
		);
		await engine.enqueueMutation(
			syncAccount,
			"evt_other",
			syncDevice,
			feedCreate("fed_legacy_other", "Other root"),
			{},
		);

		await migrate(database);
		let legacyReads = 0;
		await initializeMutationStreamIdentities(
			database,
			syncAccount,
			async () => {
				legacyReads += 1;
				return alternateSyncDevice;
			},
			() => freshSyncDevice,
		);

		expect(legacyReads).toBe(1);
		expect(
			await database.all(
				`SELECT root_event_id, device_id FROM mutation_stream_identities
WHERE account_user_id = ? ORDER BY root_event_id`,
				[syncAccount],
			),
		).toEqual([
			{ root_event_id: "evt_other", device_id: syncDevice },
			{ root_event_id: "evt_trip", device_id: alternateSyncDevice },
		]);
		const resumed = await engine.enqueueMutation(
			syncAccount,
			"evt_trip",
			alternateSyncDevice,
			feedCreate("fed_legacy_resumed", "Resumed"),
			{},
		);
		expect(resumed.clientSequence).toBe(2);
		database.close();
	});

	test("coalesces concurrent creation and never revives retained Keychain on fresh SQLite", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedAccount(database, syncAccount);
		let legacyReads = 0;
		let generations = 0;
		const acquire = () =>
			getOrCreateMutationStreamIdentity(
				database,
				syncAccount,
				"evt_trip",
				async () => {
					legacyReads += 1;
					return syncDevice;
				},
				() => {
					generations += 1;
					return freshSyncDevice;
				},
			);
		const [first, second] = await Promise.all([acquire(), acquire()]);

		expect(first).toBe(freshSyncDevice);
		expect(second).toBe(first);
		expect(legacyReads).toBe(1);
		expect(generations).toBe(1);
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM mutation_stream_identities",
			),
		).toEqual({ count: 1 });
		database.close();
	});

	test("rejects non-canonical persisted stream identities", async () => {
		const database = new BunDatabase();
		await migrate(database);
		for (const invalid of [
			"dvc_00000000-0000-1000-8000-000000000001",
			"dvc_00000000-0000-4000-7000-000000000001",
			"dvc_00000000-0000-4000-8000-00000000000A",
		]) {
			await expect(
				database.run(
					`INSERT INTO mutation_stream_identities (
  account_user_id, root_event_id, device_id
) VALUES (?, 'evt_invalid', ?)`,
					[syncAccount, invalid],
				),
			).rejects.toThrow();
		}
		database.close();
	});

	test("rotates only the purged root and passes a server-like sequence ledger", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedAccount(database, syncAccount);
		await seedMinimalRoot(database, syncAccount, "evt_survivor");
		const legacy = async () => syncDevice;
		await getOrCreateMutationStreamIdentity(
			database,
			syncAccount,
			"evt_trip",
			legacy,
			() => syncDevice,
		);
		await getOrCreateMutationStreamIdentity(
			database,
			syncAccount,
			"evt_survivor",
			legacy,
			() => alternateSyncDevice,
		);

		await new MobileDataStore(database).clearRootData(syncAccount, "evt_trip");
		expect(
			await database.first(
				`SELECT 1 FROM mutation_stream_identities
WHERE account_user_id = ? AND root_event_id = 'evt_trip'`,
				[syncAccount],
			),
		).toBeNull();
		expect(
			await database.first<{ device_id: string }>(
				`SELECT device_id FROM mutation_stream_identities
WHERE account_user_id = ? AND root_event_id = 'evt_survivor'`,
				[syncAccount],
			),
		).toEqual({ device_id: alternateSyncDevice });

		await seedMinimalRoot(database, syncAccount, "evt_trip");
		const rotated = await getOrCreateMutationStreamIdentity(
			database,
			syncAccount,
			"evt_trip",
			legacy,
			() => freshSyncDevice,
		);
		expect(rotated).toBe(freshSyncDevice);
		const engine = testSyncEngine(database, syncAccount, noFetch, {
			assertMutationStreamIdentity,
		});
		await expect(
			engine.enqueueMutation(
				syncAccount,
				"evt_trip",
				syncDevice,
				feedCreate("fed_stale_identity", "Must not persist"),
				{},
			),
		).rejects.toThrow("Mutation stream identity changed");
		expect(
			await database.first<{ count: number }>(
				`SELECT COUNT(*) AS count FROM mutation_outbox
WHERE account_user_id = ? AND root_event_id = 'evt_trip'`,
				[syncAccount],
			),
		).toEqual({ count: 0 });
		const queued = await engine.enqueueMutation(
			syncAccount,
			"evt_trip",
			rotated,
			feedCreate("fed_reinstalled", "Reinstalled"),
			{},
		);
		const ledger = new Map([[`${syncAccount}:evt_trip:${syncDevice}`, 2]]);
		const accept = (deviceId: string, sequence: number) => {
			const key = `${syncAccount}:evt_trip:${deviceId}`;
			const expected = ledger.get(key) ?? 1;
			if (sequence !== expected) throw new Error("SEQUENCE_REUSED");
			ledger.set(key, expected + 1);
		};
		expect(() => accept(syncDevice, 1)).toThrow("SEQUENCE_REUSED");
		expect(() => accept(queued.deviceId, queued.clientSequence)).not.toThrow();
		expect(ledger.get(`${syncAccount}:evt_trip:${freshSyncDevice}`)).toBe(2);
		database.close();
	});

	test("replaces a persisted sequence failure tail exactly once", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedAccount(database, syncAccount);
		await seedMinimalRoot(database, syncAccount, "evt_other");
		await getOrCreateMutationStreamIdentity(
			database,
			syncAccount,
			"evt_trip",
			async () => null,
			() => syncDevice,
		);
		await getOrCreateMutationStreamIdentity(
			database,
			syncAccount,
			"evt_other",
			async () => null,
			() => alternateSyncDevice,
		);
		const engine = testSyncEngine(database, syncAccount, noFetch, {
			randomUUID: uuidSequence(700),
		});
		const first = await engine.enqueueMutation(
			syncAccount,
			"evt_trip",
			syncDevice,
			feedCreate("fed_sequence_first", "First intent"),
			{ local: "first" },
		);
		const second = await engine.enqueueMutation(
			syncAccount,
			"evt_trip",
			syncDevice,
			feedCreate("fed_sequence_second", "Second intent"),
			{ local: "second", replacementFor: first.clientMutationId },
		);
		const unrelated = await engine.enqueueMutation(
			syncAccount,
			"evt_other",
			alternateSyncDevice,
			feedCreate("fed_unrelated_conflict", "Unrelated conflict"),
			{ local: "unrelated" },
		);
		await database.run(
			`UPDATE mutation_outbox SET state = 'dead_letter', server_consumed = 1,
  last_error_code = 'sequence', last_request_id = 'request-old-sequence'
WHERE account_user_id = ? AND client_mutation_id = ?`,
			[syncAccount, first.clientMutationId],
		);
		await database.run(
			`UPDATE mutation_outbox SET state = 'blocked', server_consumed = 0,
  blocked_until_pull = 1, last_error_code = 'blocked'
WHERE account_user_id = ? AND client_mutation_id = ?`,
			[syncAccount, second.clientMutationId],
		);
		await database.run(
			`UPDATE mutation_outbox SET state = 'dead_letter', server_consumed = 1,
  last_error_code = 'conflict'
WHERE account_user_id = ? AND client_mutation_id = ?`,
			[syncAccount, unrelated.clientMutationId],
		);

		expect(
			await recoverSequenceFailureStreams(database, syncAccount, {
				newDeviceId: () => freshSyncDevice,
				now: () => new Date("2026-07-20T12:00:00.000Z"),
				randomUUID: uuidSequence(900),
			}),
		).toBe(1);
		const recovered = await engine.listOutbox(syncAccount, "evt_trip");
		expect(recovered).toHaveLength(2);
		expect(
			recovered.map((item) => ({
				deviceId: item.deviceId,
				sequence: item.clientSequence,
				state: item.state,
			})),
		).toEqual([
			{ deviceId: freshSyncDevice, sequence: 1, state: "pending" },
			{ deviceId: freshSyncDevice, sequence: 2, state: "pending" },
		]);
		const domainCommand = (item: OutboxItem) => {
			const command = item.command as SyncPushBody["mutations"][number];
			const {
				clientMutationId: _id,
				clientSequence: _sequence,
				...domain
			} = command;
			return domain;
		};
		expect(domainCommand(requiredTest(recovered[0]))).toEqual(
			domainCommand(first),
		);
		expect(domainCommand(requiredTest(recovered[1]))).toEqual(
			domainCommand(second),
		);
		expect(recovered[0]?.optimisticOverlay).toEqual({ local: "first" });
		expect(recovered[1]?.optimisticOverlay).toEqual({
			local: "second",
			replacementFor: null,
		});
		expect(recovered[0]).toMatchObject({
			createdAt: first.createdAt,
			lastError: null,
			serverConsumed: false,
			updatedAt: first.updatedAt,
		});
		expect(recovered[1]).toMatchObject({
			createdAt: second.createdAt,
			lastError: null,
			serverConsumed: false,
			updatedAt: second.updatedAt,
		});
		for (const row of await database.all<{
			command_fingerprint: string;
			command_json: string;
		}>(
			`SELECT command_json, command_fingerprint FROM mutation_outbox
WHERE account_user_id = ? AND root_event_id = 'evt_trip'`,
			[syncAccount],
		)) {
			expect(row.command_fingerprint).toBe(await sha256Hex(row.command_json));
		}
		expect(
			await database.first<{ device_id: string }>(
				`SELECT device_id FROM mutation_stream_identities
WHERE account_user_id = ? AND root_event_id = 'evt_trip'`,
				[syncAccount],
			),
		).toEqual({ device_id: freshSyncDevice });
		expect(await engine.listOutbox(syncAccount, "evt_other")).toEqual([
			expect.objectContaining({
				clientMutationId: unrelated.clientMutationId,
				lastError: expect.objectContaining({ code: "conflict" }),
				state: "dead_letter",
			}),
		]);
		expect(
			await recoverSequenceFailureStreams(database, syncAccount, {
				newDeviceId: () => {
					throw new Error("must not generate another device");
				},
				randomUUID: () => {
					throw new Error("must not generate another mutation");
				},
			}),
		).toBe(0);
		expect(await engine.listOutbox(syncAccount, "evt_trip")).toEqual(recovered);

		const ledger = new Map([[`${syncAccount}:evt_trip:${syncDevice}`, 3]]);
		const accept = (deviceId: string, sequence: number) => {
			const key = `${syncAccount}:evt_trip:${deviceId}`;
			const expected = ledger.get(key) ?? 1;
			if (sequence !== expected) throw new Error("SEQUENCE_REUSED");
			ledger.set(key, expected + 1);
		};
		expect(() => accept(syncDevice, 1)).toThrow("SEQUENCE_REUSED");
		for (const item of recovered) {
			expect(() => accept(item.deviceId, item.clientSequence)).not.toThrow();
		}
		expect(await database.all("PRAGMA foreign_key_check")).toEqual([]);
		database.close();
	});

	test("rolls back sequence recovery when the stream or UUID source is ambiguous", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedAccount(database, syncAccount);
		await getOrCreateMutationStreamIdentity(
			database,
			syncAccount,
			"evt_trip",
			async () => null,
			() => syncDevice,
		);
		const engine = testSyncEngine(database, syncAccount, noFetch, {
			randomUUID: uuidSequence(930),
		});
		const failed = await engine.enqueueMutation(
			syncAccount,
			"evt_trip",
			syncDevice,
			feedCreate("fed_ambiguous_first", "First"),
			{},
		);
		const active = await engine.enqueueMutation(
			syncAccount,
			"evt_trip",
			syncDevice,
			feedCreate("fed_ambiguous_second", "Second"),
			{},
		);
		await database.run(
			`UPDATE mutation_outbox SET state = 'dead_letter', server_consumed = 1,
  last_error_code = 'sequence'
WHERE account_user_id = ? AND client_mutation_id = ?`,
			[syncAccount, failed.clientMutationId],
		);
		await database.run(
			`UPDATE mutation_outbox SET state = 'sending', lease_owner = 'lease-live',
  lease_expires_at = '2026-07-20T13:00:00.000Z'
WHERE account_user_id = ? AND client_mutation_id = ?`,
			[syncAccount, active.clientMutationId],
		);
		const before = await database.all(
			`SELECT * FROM mutation_outbox WHERE account_user_id = ?
ORDER BY root_event_id, client_sequence`,
			[syncAccount],
		);
		await expect(
			recoverSequenceFailureStreams(database, syncAccount, {
				newDeviceId: () => freshSyncDevice,
				randomUUID: uuidSequence(940),
			}),
		).rejects.toThrow("uncertain outcome");
		expect(
			await database.all(
				`SELECT * FROM mutation_outbox WHERE account_user_id = ?
ORDER BY root_event_id, client_sequence`,
				[syncAccount],
			),
		).toEqual(before);
		expect(await engine.getStatus(syncAccount, "evt_trip")).toMatchObject({
			attentionCount: 1,
			state: "needs_attention",
		});

		await database.run(
			`UPDATE mutation_outbox SET state = 'blocked', lease_owner = NULL,
  lease_expires_at = NULL, last_error_code = 'blocked'
WHERE account_user_id = ? AND client_mutation_id = ?`,
			[syncAccount, active.clientMutationId],
		);
		const batchBodyJson = JSON.stringify({
			deviceId: syncDevice,
			mutations: [failed.command, active.command],
			protocolVersion: 1,
			rootEventId: "evt_trip",
		});
		await database.run(
			`INSERT INTO sync_push_batches (
  account_user_id, root_event_id, device_id, idempotency_key, body_json,
  body_fingerprint, mutation_ids_json, created_at
) VALUES (?, 'evt_trip', ?, 'sync-ambiguous', ?, ?, ?, ?)`,
			[
				syncAccount,
				syncDevice,
				batchBodyJson,
				await sha256Hex(batchBodyJson),
				JSON.stringify([failed.clientMutationId, active.clientMutationId]),
				now,
			],
		);
		await expect(
			recoverSequenceFailureStreams(database, syncAccount, {
				newDeviceId: () => freshSyncDevice,
				randomUUID: uuidSequence(950),
			}),
		).rejects.toThrow("uncertain outcome");
		expect(
			await database.first<{ idempotency_key: string }>(
				"SELECT idempotency_key FROM sync_push_batches",
			),
		).toEqual({ idempotency_key: "sync-ambiguous" });
		await database.run(
			`DELETE FROM sync_push_batches
WHERE account_user_id = ? AND root_event_id = 'evt_trip'`,
			[syncAccount],
		);
		const beforeInvalidUuid = await database.all(
			`SELECT * FROM mutation_outbox WHERE account_user_id = ?
ORDER BY root_event_id, client_sequence`,
			[syncAccount],
		);
		await expect(
			recoverSequenceFailureStreams(database, syncAccount, {
				newDeviceId: () => freshSyncDevice,
				randomUUID: () => "not-a-uuid",
			}),
		).rejects.toThrow("identity is invalid");
		expect(
			await database.all(
				`SELECT * FROM mutation_outbox WHERE account_user_id = ?
ORDER BY root_event_id, client_sequence`,
				[syncAccount],
			),
		).toEqual(beforeInvalidUuid);
		expect(
			await database.first<{ device_id: string }>(
				`SELECT device_id FROM mutation_stream_identities
WHERE account_user_id = ? AND root_event_id = 'evt_trip'`,
				[syncAccount],
			),
		).toEqual({ device_id: syncDevice });
		database.close();
	});

	test("atomically relinks a pending golf intent to its recovered mutation", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedAccount(database, syncAccount);
		await database.transaction(async (transaction) => {
			await putGolfSyncProjection(transaction, syncAccount, "golfRound", {
				rootEventId: "evt_trip",
				eventId: "evt_day_a",
				holes: [{ hole: 1, par: 4, strokeIndex: 1 }],
				teams: [],
				version: 1,
				updatedAt: now,
			});
			await putGolfSyncProjection(transaction, syncAccount, "golfRoster", {
				rootEventId: "evt_trip",
				eventId: "evt_day_a",
				players: [{ userId: syncAccount, playingHandicap: 18 }],
				version: 1,
				updatedAt: now,
			});
			await putGolfSyncProjection(transaction, syncAccount, "golfPlayer", {
				rootEventId: "evt_trip",
				eventId: "evt_day_a",
				userId: syncAccount,
				playingHandicap: 18,
				version: 1,
			});
		});
		await getOrCreateMutationStreamIdentity(
			database,
			syncAccount,
			"evt_trip",
			async () => null,
			() => syncDevice,
		);
		const engine = testSyncEngine(database, syncAccount, noFetch, {
			randomUUID: uuidSequence(960),
		});
		const queued = await engine.enqueueGolfScore(
			{
				accountUserId: syncAccount,
				baseVersion: 0,
				clientIntentId: "gsi_sequence_recovery",
				eventId: "evt_day_a",
				hole: 1,
				putts: 2,
				rootEventId: "evt_trip",
				strokes: 5,
			},
			syncDevice,
		);
		const failed = requiredTest(queued.outbox);
		await database.run(
			`UPDATE mutation_outbox SET state = 'dead_letter', server_consumed = 1,
  last_error_code = 'sequence'
WHERE account_user_id = ? AND client_mutation_id = ?`,
			[syncAccount, failed.clientMutationId],
		);
		expect(
			await recoverSequenceFailureStreams(database, syncAccount, {
				newDeviceId: () => freshSyncDevice,
				now: () => new Date("2026-07-20T12:00:00.000Z"),
				randomUUID: uuidSequence(970),
			}),
		).toBe(1);
		const [replacement] = await engine.listOutbox(syncAccount, "evt_trip");
		expect(replacement).toMatchObject({
			clientMutationId: "00000000-0000-4000-8000-000000000970",
			clientSequence: 1,
			deviceId: freshSyncDevice,
			state: "pending",
		});
		expect(
			await database.first<{
				client_intent_id: string;
				outbox_client_mutation_id: string;
				state: string;
			}>(
				`SELECT client_intent_id, outbox_client_mutation_id, state
FROM golf_score_intents WHERE account_user_id = ? AND client_intent_id = ?`,
				[syncAccount, "gsi_sequence_recovery"],
			),
		).toEqual({
			client_intent_id: "gsi_sequence_recovery",
			outbox_client_mutation_id: requiredTest(replacement).clientMutationId,
			state: "pending",
		});
		expect(await database.all("PRAGMA foreign_key_check")).toEqual([]);
		database.close();
	});

	test("removes only an unbound failed root-create identity", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await getOrCreateMutationStreamIdentity(
			database,
			syncAccount,
			"evt_failed_create",
			async () => syncDevice,
			() => freshSyncDevice,
		);
		await discardUnboundMutationStreamIdentity(
			database,
			syncAccount,
			"evt_failed_create",
		);
		expect(
			await database.first(
				`SELECT 1 FROM mutation_stream_identities
WHERE account_user_id = ? AND root_event_id = 'evt_failed_create'`,
				[syncAccount],
			),
		).toBeNull();

		await seedMinimalRoot(database, syncAccount, "evt_bound_create");
		await getOrCreateMutationStreamIdentity(
			database,
			syncAccount,
			"evt_bound_create",
			async () => syncDevice,
			() => alternateSyncDevice,
		);
		await discardUnboundMutationStreamIdentity(
			database,
			syncAccount,
			"evt_bound_create",
		);
		expect(
			await database.first(
				`SELECT 1 FROM mutation_stream_identities
WHERE account_user_id = ? AND root_event_id = 'evt_bound_create'`,
				[syncAccount],
			),
		).not.toBeNull();
		database.close();
	});
});

describe("durable optimistic mutation outbox", () => {
	test("allocates a gap-free sequence atomically when an insert rolls back", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedAccount(database, syncAccount);
		const duplicateUuid = () => "00000000-0000-4000-8000-000000000001";
		const firstEngine = testSyncEngine(database, syncAccount, noFetch, {
			randomUUID: duplicateUuid,
		});
		await firstEngine.enqueueMutation(
			syncAccount,
			"evt_trip",
			syncDevice,
			feedCreate("fed_atomic_one", "One"),
			{ feedEntryId: "fed_atomic_one", text: "One" },
		);
		await expect(
			firstEngine.enqueueMutation(
				syncAccount,
				"evt_trip",
				syncDevice,
				feedCreate("fed_atomic_duplicate", "Duplicate"),
				{ feedEntryId: "fed_atomic_duplicate", text: "Duplicate" },
			),
		).rejects.toThrow();

		const secondEngine = testSyncEngine(database, syncAccount, noFetch, {
			randomUUID: () => "00000000-0000-4000-8000-000000000002",
		});
		await secondEngine.enqueueMutation(
			syncAccount,
			"evt_trip",
			syncDevice,
			feedCreate("fed_atomic_two", "Two"),
			{ feedEntryId: "fed_atomic_two", text: "Two" },
		);

		const items = await secondEngine.listOutbox(syncAccount, "evt_trip");
		expect(items.map(({ clientSequence }) => clientSequence)).toEqual([1, 2]);
		expect(items.map(({ optimisticOverlay }) => optimisticOverlay)).toEqual([
			{ feedEntryId: "fed_atomic_one", text: "One" },
			{ feedEntryId: "fed_atomic_two", text: "Two" },
		]);
		database.close();
	});

	test("rejects non-canonical device and mutation identifiers before enqueue", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedAccount(database, syncAccount);
		const uppercaseDevice = testSyncEngine(database, syncAccount, noFetch);
		await expect(
			uppercaseDevice.enqueueMutation(
				syncAccount,
				"evt_trip",
				syncDevice.toUpperCase(),
				feedCreate("fed_uppercase_device", "Invalid"),
				{},
			),
		).rejects.toThrow("Invalid device ID");

		const uppercaseMutation = testSyncEngine(database, syncAccount, noFetch, {
			randomUUID: () => "00000000-0000-4000-8000-00000000000A",
		});
		await expect(
			uppercaseMutation.enqueueMutation(
				syncAccount,
				"evt_trip",
				syncDevice,
				feedCreate("fed_uppercase_mutation", "Invalid"),
				{},
			),
		).rejects.toThrow("invalid lowercase UUID v4");
		for (const invalidUuid of [
			"00000000-0000-1000-8000-000000000001",
			"00000000-0000-4000-7000-000000000001",
		]) {
			const invalidUuidEngine = testSyncEngine(database, syncAccount, noFetch, {
				randomUUID: () => invalidUuid,
			});
			await expect(
				invalidUuidEngine.enqueueMutation(
					syncAccount,
					"evt_trip",
					syncDevice,
					feedCreate(
						`fed_invalid_${invalidUuid[14]}_${invalidUuid[19]}`,
						"Invalid",
					),
					{},
				),
			).rejects.toThrow("invalid lowercase UUID v4");
		}
		const invalidDigest = testSyncEngine(database, syncAccount, noFetch, {
			sha256: () => "A".repeat(64),
		});
		await expect(
			invalidDigest.enqueueMutation(
				syncAccount,
				"evt_trip",
				syncDevice,
				feedCreate("fed_invalid_digest", "Invalid"),
				{},
			),
		).rejects.toThrow("invalid lowercase digest");
		expect(await invalidDigest.listOutbox(syncAccount, "evt_trip")).toEqual([]);
		database.close();
	});

	test("whitelists attachment commit through persistence, restart, and push", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-attachment-outbox-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "crew.sqlite");
		const firstDatabase = new BunDatabase(path);
		await migrate(firstDatabase);
		await seedAccount(firstDatabase, syncAccount);
		const firstEngine = testSyncEngine(firstDatabase, syncAccount, noFetch);
		const polluted = {
			kind: "attachment.commit" as const,
			entityId: "att_camera",
			sourceUri: "file:///private/IMG_0042.HEIC",
			bytes: "private-image-bytes",
			retainedFileKey: "private.jpg",
			toJSON: () => ({
				kind: "attachment.commit",
				entityId: "att_camera",
				sourceUri: "file:///private/to-json.HEIC",
				bytes: "to-json-private-bytes",
				payload: { uploadId: "upl_camera", caption: "bypassed" },
			}),
			payload: {
				uploadId: "upl_camera",
				caption: "  Great day  ",
				sourceUri: "file:///private/IMG_0042.HEIC",
				bytes: [1, 2, 3],
				retainedFileKey: "private.jpg",
			},
		} as unknown as SyncMutationDraft;
		const enqueued = await firstEngine.enqueueMutation(
			syncAccount,
			"evt_trip",
			syncDevice,
			polluted,
			{ attachmentId: "att_camera" },
		);
		const row = requiredTest(
			await firstDatabase.first<{ command_json: string }>(
				"SELECT command_json FROM mutation_outbox WHERE client_mutation_id = ?",
				[enqueued.clientMutationId],
			),
		);
		const expectedMutation = {
			kind: "attachment.commit" as const,
			entityId: "att_camera",
			payload: { uploadId: "upl_camera", caption: "Great day" },
			clientMutationId: enqueued.clientMutationId,
			clientSequence: 1,
		};
		expect(JSON.parse(row.command_json)).toEqual(expectedMutation);
		expect(row.command_json).not.toContain("file://");
		expect(row.command_json).not.toContain("private-image-bytes");
		expect(row.command_json).not.toContain("to-json-private-bytes");
		expect(row.command_json).not.toContain("retainedFileKey");
		firstDatabase.close();

		const pushedBodies: SyncPushBody[] = [];
		let rawPushBody = "";
		const secondDatabase = new BunDatabase(path);
		const secondEngine = testSyncEngine(
			secondDatabase,
			syncAccount,
			async (input, init) => {
				if (new URL(String(input)).pathname.endsWith("/sync/push")) {
					rawPushBody = String(init?.body);
					pushedBodies.push(JSON.parse(rawPushBody) as SyncPushBody);
					throw new Error("stop after observing push");
				}
				throw new Error("unexpected request");
			},
		);
		expect((await secondEngine.syncRoot(syncAccount, "evt_trip")).state).toBe(
			"waiting_retry",
		);
		expect(requiredTest(pushedBodies[0]).mutations).toEqual([expectedMutation]);
		expect(rawPushBody).not.toContain("file://");
		expect(rawPushBody).not.toContain("private-image-bytes");
		expect(rawPushBody).not.toContain("to-json-private-bytes");
		expect(rawPushBody).not.toContain("retainedFileKey");
		secondDatabase.close();
	});

	test("survives disconnect and restart without crypto.subtle, then replays the exact batch once", async () => {
		installCryptoWithoutSubtle();
		expect(globalThis.crypto.subtle).toBeUndefined();
		const directory = mkdtempSync(join(tmpdir(), "crew-outbox-restart-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "crew.sqlite");
		const clock = { value: new Date("2026-07-18T12:00:00.000Z") };
		const nextUuid = uuidSequence();
		const attempts: Array<{ body: string; key: string }> = [];
		let serverEffects = 0;
		const firstDatabase = new BunDatabase(path);
		await migrate(firstDatabase);
		await seedAccount(firstDatabase, syncAccount);
		const firstEngine = testSyncEngine(
			firstDatabase,
			syncAccount,
			async (input, init) => {
				if (new URL(String(input)).pathname.endsWith("/sync/push")) {
					attempts.push(requestAttempt(init));
					serverEffects += 1;
					throw new Error("connection dropped after commit");
				}
				throw new Error("unexpected request");
			},
			{ clock, randomUUID: nextUuid },
		);
		const queued = await firstEngine.enqueueMutation(
			syncAccount,
			"evt_trip",
			syncDevice,
			feedCreate("fed_offline", "Saved offline"),
			{ feedEntryId: "fed_offline", text: "Saved offline" },
		);
		expect((await firstEngine.syncRoot(syncAccount, "evt_trip")).state).toBe(
			"waiting_retry",
		);
		const identitySql = `SELECT m.command_json, m.command_fingerprint,
  b.body_json, b.body_fingerprint, b.idempotency_key
FROM mutation_outbox m
JOIN sync_push_batches b
  ON b.account_user_id = m.account_user_id
  AND b.root_event_id = m.root_event_id
WHERE m.account_user_id = ? AND m.client_mutation_id = ?`;
		const persistedIdentity = requiredTest(
			await firstDatabase.first<{
				command_json: string;
				command_fingerprint: string;
				body_json: string;
				body_fingerprint: string;
				idempotency_key: string;
			}>(identitySql, [syncAccount, queued.clientMutationId]),
		);
		const firstAttempt = requiredTest(attempts[0]);
		expect(persistedIdentity.body_json).toBe(firstAttempt.body);
		expect(persistedIdentity.idempotency_key).toBe(firstAttempt.key);
		expect(persistedIdentity.command_fingerprint).toBe(
			new Bun.CryptoHasher("sha256")
				.update(persistedIdentity.command_json)
				.digest("hex"),
		);
		expect(persistedIdentity.body_fingerprint).toBe(
			new Bun.CryptoHasher("sha256")
				.update(persistedIdentity.body_json)
				.digest("hex"),
		);
		firstDatabase.close();

		clock.value = new Date("2026-07-18T12:00:02.000Z");
		const secondDatabase = new BunDatabase(path);
		expect(
			await secondDatabase.first<typeof persistedIdentity>(identitySql, [
				syncAccount,
				queued.clientMutationId,
			]),
		).toEqual(persistedIdentity);
		const secondEngine = testSyncEngine(
			secondDatabase,
			syncAccount,
			async (input, init) => {
				const pathname = new URL(String(input)).pathname;
				if (pathname.endsWith("/sync/push")) {
					attempts.push(requestAttempt(init));
					const body = JSON.parse(String(init?.body)) as SyncPushBody;
					const mutation = requiredTest(body.mutations[0]);
					return gatewayJson(init, 200, {
						protocolVersion: 1,
						rootEventId: body.rootEventId,
						deviceId: body.deviceId,
						results: [
							{
								clientMutationId: mutation.clientMutationId,
								clientSequence: mutation.clientSequence,
								outcome: "applied",
								replayed: true,
								rootRevision: "13",
								entity: {
									entityType: "feedEntry",
									entityId: mutation.entityId,
									version: 1,
								},
							},
						],
						nextExpectedClientSequence: mutation.clientSequence + 1,
					});
				}
				if (pathname.endsWith("/sync/pull")) {
					return gatewayJson(
						init,
						200,
						pullPage("evt_trip", "2", "cursor-replay-0013", [
							feedUpsert("fed_offline", "Saved offline", "13"),
						]),
					);
				}
				throw new Error("unexpected request");
			},
			{ clock, randomUUID: nextUuid },
		);
		const status = await secondEngine.syncRoot(syncAccount, "evt_trip");

		expect(status).toMatchObject({ state: "synced", pendingCount: 0 });
		expect(attempts).toHaveLength(2);
		expect(attempts[1]).toEqual(attempts[0]);
		expect(serverEffects).toBe(1);
		expect(await secondEngine.listOutbox(syncAccount, "evt_trip")).toEqual([]);
		expect(
			(
				await new MobileDataStore(secondDatabase).listFeed(
					syncAccount,
					"evt_trip",
				)
			).find(({ id }) => id === "fed_offline")?.payloadJson,
		).toBe('{"text":"Saved offline"}');
		secondDatabase.close();
	});

	test("keeps an account-switched response uncommitted and replays it safely", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedAccount(database, syncAccount);
		let activeAccount = syncAccount;
		let pushCount = 0;
		const attempts: Array<{ body: string; key: string }> = [];
		const engine = testSyncEngine(
			database,
			syncAccount,
			async (input, init) => {
				const pathname = new URL(String(input)).pathname;
				if (pathname.endsWith("/sync/push")) {
					pushCount += 1;
					attempts.push(requestAttempt(init));
					const body = JSON.parse(String(init?.body)) as SyncPushBody;
					const mutation = requiredTest(body.mutations[0]);
					if (pushCount === 1) {
						activeAccount = "usr_00000000000000000000000000000002";
					}
					return gatewayJson(init, 200, {
						protocolVersion: 1,
						rootEventId: body.rootEventId,
						deviceId: body.deviceId,
						results: [
							{
								clientMutationId: mutation.clientMutationId,
								clientSequence: mutation.clientSequence,
								outcome: "applied",
								replayed: pushCount > 1,
								rootRevision: "13",
								entity: {
									entityType: "feedEntry",
									entityId: mutation.entityId,
									version: 1,
								},
							},
						],
						nextExpectedClientSequence: mutation.clientSequence + 1,
					});
				}
				if (pathname.endsWith("/sync/pull")) {
					return gatewayJson(
						init,
						200,
						pullPage("evt_trip", "2", "cursor-account-0013", [
							feedUpsert("fed_account_switch", "Retained", "13"),
						]),
					);
				}
				throw new Error("unexpected request");
			},
			{
				activeAccountUserId: () => activeAccount,
				randomUUID: uuidSequence(50),
			},
		);
		await engine.enqueueMutation(
			syncAccount,
			"evt_trip",
			syncDevice,
			feedCreate("fed_account_switch", "Retained"),
			{ feedEntryId: "fed_account_switch", text: "Retained" },
		);

		const switched = await engine.syncRoot(syncAccount, "evt_trip");
		expect(switched).toMatchObject({
			state: "blocked",
			summary: "Sign in to save changes",
			pendingCount: 1,
		});
		expect((await engine.listOutbox(syncAccount, "evt_trip"))[0]).toMatchObject(
			{
				state: "pending",
				attempts: 0,
				lastError: { code: "auth_required" },
			},
		);

		activeAccount = syncAccount;
		expect(await engine.syncRoot(syncAccount, "evt_trip")).toMatchObject({
			state: "synced",
			pendingCount: 0,
		});
		expect(attempts).toHaveLength(2);
		expect(attempts[1]).toEqual(attempts[0]);
		expect(await engine.listOutbox(syncAccount, "evt_trip")).toEqual([]);
		database.close();
	});

	test("persists root creation as a standalone generated command before bootstrap", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-root-outbox-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "crew.sqlite");
		const rootEventId = "evt_offline_root";
		const command: RootCreateCommand = {
			id: rootEventId,
			kind: "team_event",
			title: "Offline offsite",
			timeZone: "Europe/Zurich",
		};
		const nextUuid = uuidSequence(100);
		const firstDatabase = new BunDatabase(path);
		await migrate(firstDatabase);
		const firstEngine = testSyncEngine(firstDatabase, syncAccount, noFetch, {
			randomUUID: nextUuid,
		});
		await firstEngine.enqueueRootCreate(syncAccount, syncDevice, command, {
			title: "Offline offsite",
		});
		firstDatabase.close();

		const seen: string[] = [];
		const rootCreateKeys: string[] = [];
		const secondDatabase = new BunDatabase(path);
		const secondEngine = testSyncEngine(
			secondDatabase,
			syncAccount,
			async (input, init) => {
				const pathname = new URL(String(input)).pathname;
				seen.push(pathname);
				if (pathname.endsWith("/event-roots")) {
					expect(JSON.parse(String(init?.body))).toEqual(command);
					rootCreateKeys.push(
						requiredTest(new Headers(init?.headers).get("idempotency-key")),
					);
					return gatewayJson(init, 201, {
						event: gatewayEvent(rootEventId, "Offline offsite"),
					});
				}
				if (pathname.endsWith("/sync/bootstrap")) {
					return gatewayJson(
						init,
						200,
						bootstrapPage(rootEventId, "1", "Offline offsite"),
					);
				}
				if (pathname.endsWith("/sync/pull")) {
					return gatewayJson(
						init,
						200,
						pullPage(rootEventId, "1", "root-pull-cursor-0002"),
					);
				}
				throw new Error("unexpected request");
			},
			{ randomUUID: nextUuid },
		);
		const resumed = (await secondEngine.listRootCreations(syncAccount))[0];
		expect(resumed).toMatchObject({
			operationId: "eventsCreate",
			clientSequence: 0,
			state: "pending",
			rootEventId,
			command,
		});
		expect((await secondEngine.syncRoot(syncAccount, rootEventId)).state).toBe(
			"synced",
		);
		expect(seen).toEqual([
			"/core/v1/event-roots",
			"/core/v1/sync/bootstrap",
			"/core/v1/sync/pull",
		]);
		expect(rootCreateKeys).toEqual([`root-${resumed?.clientMutationId}`]);
		expect(await secondEngine.listOutbox(syncAccount, rootEventId)).toEqual([]);
		expect(await secondEngine.listRootCreations(syncAccount)).toEqual([]);
		expect(
			(
				await new MobileDataStore(secondDatabase).listEventTree(
					syncAccount,
					rootEventId,
				)
			)[0]?.title,
		).toBe("Offline offsite");
		secondDatabase.close();
	});

	test("canonicalizes root creation before durable persistence", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const engine = testSyncEngine(database, syncAccount, noFetch);
		await engine.enqueueRootCreate(syncAccount, syncDevice, {
			id: "evt_canonical_root",
			kind: "other",
			title: "  Canonical crew board  ",
			description: null,
			timeZone: "Europe/Zurich",
			status: "draft",
			privateField: "must not persist",
		} as RootCreateCommand);

		expect((await engine.listRootCreations(syncAccount))[0]?.command).toEqual({
			id: "evt_canonical_root",
			kind: "other",
			title: "Canonical crew board",
			description: null,
			timeZone: "Europe/Zurich",
			status: "draft",
		});
		database.close();
	});

	test("replays the exact root create without crypto.subtle after a lost response and database restart", async () => {
		installCryptoWithoutSubtle();
		expect(globalThis.crypto.subtle).toBeUndefined();
		const directory = mkdtempSync(join(tmpdir(), "crew-root-replay-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "crew.sqlite");
		const rootEventId = "evt_committed_before_restart";
		const command: RootCreateCommand = {
			id: rootEventId,
			kind: "team_event",
			title: "Committed before restart",
			timeZone: "Europe/Zurich",
		};
		const attempts: Array<{ body: string; key: string }> = [];
		const firstDatabase = new BunDatabase(path);
		await migrate(firstDatabase);
		const firstEngine = testSyncEngine(
			firstDatabase,
			syncAccount,
			async (input, init) => {
				if (!new URL(String(input)).pathname.endsWith("/event-roots")) {
					throw new Error("Lost response must stop before bootstrap");
				}
				attempts.push(requestAttempt(init));
				throw new Error("connection lost after server commit");
			},
			{ randomUUID: uuidSequence(120) },
		);
		const queued = await firstEngine.enqueueRootCreate(
			syncAccount,
			syncDevice,
			command,
		);
		const identitySql = `SELECT command_json AS body, command_fingerprint AS fingerprint,
  http_idempotency_key AS idempotency_key
FROM mutation_outbox
WHERE account_user_id = ? AND client_mutation_id = ?`;
		const persistedIdentity = requiredTest(
			await firstDatabase.first<{
				body: string;
				fingerprint: string;
				idempotency_key: string;
			}>(identitySql, [syncAccount, queued.clientMutationId]),
		);
		expect(persistedIdentity).toEqual({
			body: JSON.stringify(command),
			fingerprint: new Bun.CryptoHasher("sha256")
				.update(JSON.stringify(command))
				.digest("hex"),
			idempotency_key: `root-${queued.clientMutationId}`,
		});
		expect(await firstEngine.syncRoot(syncAccount, rootEventId)).toMatchObject({
			state: "waiting_retry",
			pendingCount: 1,
		});
		firstDatabase.close();

		const secondDatabase = new BunDatabase(path);
		expect(
			await secondDatabase.first<typeof persistedIdentity>(identitySql, [
				syncAccount,
				queued.clientMutationId,
			]),
		).toEqual(persistedIdentity);
		const secondEngine = testSyncEngine(
			secondDatabase,
			syncAccount,
			async (input, init) => {
				const pathname = new URL(String(input)).pathname;
				if (pathname.endsWith("/event-roots")) {
					attempts.push(requestAttempt(init));
					return gatewayJson(init, 201, {
						event: gatewayEvent(rootEventId, command.title),
					});
				}
				if (pathname.endsWith("/sync/bootstrap")) {
					return gatewayJson(
						init,
						200,
						bootstrapPage(rootEventId, "1", command.title),
					);
				}
				if (pathname.endsWith("/sync/pull")) {
					return gatewayJson(
						init,
						200,
						pullPage(rootEventId, "1", "root-replay-cursor-0002"),
					);
				}
				throw new Error("unexpected request");
			},
			{ randomUUID: uuidSequence(130) },
		);
		expect(
			(await secondEngine.listRootCreations(syncAccount))[0],
		).toMatchObject({
			command,
			rootEventId,
			state: "pending",
		});
		expect(
			await secondEngine.syncRoot(syncAccount, rootEventId, { force: true }),
		).toMatchObject({ state: "synced", pendingCount: 0 });
		expect(attempts).toHaveLength(2);
		expect(attempts[1]).toEqual(attempts[0]);
		expect(await secondEngine.listRootCreations(syncAccount)).toEqual([]);
		secondDatabase.close();
	});

	test("retains a rejected root creation until a reviewed command replaces it", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-root-review-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "crew.sqlite");
		const rootEventId = "evt_rejected_draft";
		const rejected: RootCreateCommand = {
			id: rootEventId,
			kind: "team_event",
			title: "Stale setup",
			timeZone: "Europe/Zurich",
		};
		const reviewed: RootCreateCommand = {
			...rejected,
			description: "Setup geprüft",
			title: "Reviewed setup",
		};
		const attempts: Array<{ body: string; key: string }> = [];
		let acceptReviewed = false;
		const request = async (input: RequestInfo | URL, init?: RequestInit) => {
			const pathname = new URL(String(input)).pathname;
			if (pathname.endsWith("/event-roots")) {
				attempts.push(requestAttempt(init));
				return acceptReviewed
					? gatewayJson(init, 201, {
							event: {
								...gatewayEvent(rootEventId, reviewed.title),
								description: reviewed.description,
							},
						})
					: gatewayError(init, 409, "EVENT_TEMPLATE_VERSION_CONFLICT", false);
			}
			if (pathname.endsWith("/sync/bootstrap")) {
				return gatewayJson(
					init,
					200,
					bootstrapPage(rootEventId, "1", reviewed.title),
				);
			}
			if (pathname.endsWith("/sync/pull")) {
				return gatewayJson(
					init,
					200,
					pullPage(rootEventId, "1", "root-review-cursor-0002"),
				);
			}
			throw new Error(`unexpected request ${pathname}`);
		};
		const firstDatabase = new BunDatabase(path);
		await migrate(firstDatabase);
		const firstEngine = testSyncEngine(firstDatabase, syncAccount, request, {
			randomUUID: uuidSequence(140),
		});
		const queued = await firstEngine.enqueueRootCreate(
			syncAccount,
			syncDevice,
			rejected,
		);
		expect(await firstEngine.syncRoot(syncAccount, rootEventId)).toMatchObject({
			state: "needs_attention",
			attentionCount: 1,
		});
		expect(await firstEngine.syncRoot(syncAccount, rootEventId)).toMatchObject({
			state: "needs_attention",
			attentionCount: 1,
		});
		expect(attempts).toHaveLength(1);
		firstDatabase.close();

		const secondDatabase = new BunDatabase(path);
		const secondEngine = testSyncEngine(secondDatabase, syncAccount, request, {
			randomUUID: uuidSequence(150),
		});
		expect(
			(await secondEngine.listRootCreations(syncAccount))[0],
		).toMatchObject({
			clientMutationId: queued.clientMutationId,
			command: rejected,
			rootEventId,
			state: "dead_letter",
			lastError: { code: "invalid" },
		});
		const revisedItem = await secondEngine.reviseFailedRootCreate(
			syncAccount,
			queued.clientMutationId,
			reviewed,
			{ title: reviewed.title },
		);
		expect(revisedItem.clientMutationId).not.toBe(queued.clientMutationId);
		expect(
			(await secondEngine.listRootCreations(syncAccount))[0],
		).toMatchObject({
			clientMutationId: revisedItem.clientMutationId,
			command: reviewed,
			state: "pending",
			attempts: 0,
			lastError: null,
		});
		acceptReviewed = true;
		expect(await secondEngine.syncRoot(syncAccount, rootEventId)).toMatchObject(
			{
				state: "synced",
				pendingCount: 0,
			},
		);
		expect(attempts).toHaveLength(2);
		expect(attempts[1]?.body).toBe(JSON.stringify(reviewed));
		expect(attempts[1]?.key).not.toBe(attempts[0]?.key);
		expect(await secondEngine.listRootCreations(syncAccount)).toEqual([]);
		secondDatabase.close();
	});

	test("never accepts or bootstraps a mismatched root creation response", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const attempts: Array<{ body: string; key: string }> = [];
		const engine = testSyncEngine(
			database,
			syncAccount,
			async (input, init) => {
				const pathname = new URL(String(input)).pathname;
				if (!pathname.endsWith("/event-roots")) {
					throw new Error("Creation mismatch must stop before bootstrap");
				}
				attempts.push({
					body: String(init?.body),
					key: requiredTest(new Headers(init?.headers).get("idempotency-key")),
				});
				return gatewayJson(init, 201, {
					event: gatewayEvent("evt_expected_root", "Wrong echo"),
				});
			},
		);
		const command: RootCreateCommand = {
			id: "evt_expected_root",
			kind: "team_event",
			title: "Expected root",
			timeZone: "Europe/Zurich",
		};
		await engine.enqueueRootCreate(syncAccount, syncDevice, command);

		expect(
			await engine.syncRoot(syncAccount, command.id, { force: true }),
		).toMatchObject({ state: "waiting_retry", pendingCount: 1 });
		expect(
			await engine.syncRoot(syncAccount, command.id, { force: true }),
		).toMatchObject({ state: "waiting_retry", pendingCount: 1 });
		expect(attempts).toHaveLength(2);
		expect(attempts[1]).toEqual(attempts[0]);
		expect((await engine.listRootCreations(syncAccount))[0]).toMatchObject({
			rootEventId: command.id,
			state: "pending",
			attempts: 2,
			lastError: { code: "network" },
		});
		database.close();
	});

	test("honors retry delay, exhausts visibly, and retries the same mutation", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedAccount(database, syncAccount);
		const clock = { value: new Date("2026-07-18T12:00:00.000Z") };
		let pushCount = 0;
		const attempts: Array<{ body: string; key: string }> = [];
		const engine = testSyncEngine(
			database,
			syncAccount,
			async (input, init) => {
				const pathname = new URL(String(input)).pathname;
				if (pathname.endsWith("/sync/push")) {
					pushCount += 1;
					attempts.push(requestAttempt(init));
					const body = JSON.parse(String(init?.body)) as SyncPushBody;
					const mutation = requiredTest(body.mutations[0]);
					return gatewayJson(init, 200, {
						protocolVersion: 1,
						rootEventId: body.rootEventId,
						deviceId: body.deviceId,
						results: [
							{
								clientMutationId: mutation.clientMutationId,
								clientSequence: mutation.clientSequence,
								outcome: "retry",
								replayed: false,
								retryAfterSeconds: 60,
								error: {
									code: "ATTACHMENT_PROCESSING",
									message: "private processing detail",
									retryable: true,
								},
							},
						],
						nextExpectedClientSequence: mutation.clientSequence,
					});
				}
				if (pathname.endsWith("/sync/pull")) {
					return gatewayJson(
						init,
						200,
						pullPage(
							"evt_trip",
							"2",
							`cursor-retry-${String(pushCount).padStart(4, "0")}`,
						),
					);
				}
				throw new Error("unexpected request");
			},
			{ clock, randomUUID: uuidSequence(150) },
		);
		const queued = await engine.enqueueMutation(
			syncAccount,
			"evt_trip",
			syncDevice,
			feedCreate("fed_retry", "Retry me"),
			{ feedEntryId: "fed_retry", text: "Retry me" },
		);

		expect(await engine.syncRoot(syncAccount, "evt_trip")).toMatchObject({
			state: "waiting_retry",
			pendingCount: 1,
			nextAttemptAt: "2026-07-18T12:01:00.000Z",
		});
		await database.run(
			`UPDATE mutation_outbox SET attempts = 19, next_attempt_at = NULL
WHERE account_user_id = ? AND client_mutation_id = ?`,
			[syncAccount, queued.clientMutationId],
		);
		expect(await engine.syncRoot(syncAccount, "evt_trip")).toMatchObject({
			state: "needs_attention",
			pendingCount: 0,
			attentionCount: 1,
		});
		const exhausted = requiredTest(
			(await engine.listOutbox(syncAccount, "evt_trip"))[0],
		);
		expect(exhausted).toMatchObject({
			clientMutationId: queued.clientMutationId,
			state: "dead_letter",
			attempts: 20,
			serverConsumed: false,
			lastError: { code: "retry_exhausted" },
		});
		expect(JSON.stringify(exhausted)).not.toContain(
			"private processing detail",
		);
		expect(attempts).toHaveLength(2);
		expect(attempts[1]?.body).toBe(attempts[0]?.body);
		expect(attempts[1]?.key).not.toBe(attempts[0]?.key);

		await engine.retryExhausted(syncAccount, "evt_trip");
		const retried = requiredTest(
			(await engine.listOutbox(syncAccount, "evt_trip"))[0],
		);
		expect(retried).toMatchObject({
			clientMutationId: queued.clientMutationId,
			command: queued.command,
			state: "pending",
			attempts: 0,
			lastError: null,
		});
		database.close();
	});

	test("matches reordered outcomes and preserves a 409 proposal as a dead letter", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedAccount(database, syncAccount);
		const engine = testSyncEngine(
			database,
			syncAccount,
			async (input, init) => {
				const pathname = new URL(String(input)).pathname;
				if (pathname.endsWith("/sync/push")) {
					const body = JSON.parse(String(init?.body)) as SyncPushBody;
					const [first, second, third] = body.mutations;
					return gatewayJson(init, 200, {
						protocolVersion: 1,
						rootEventId: body.rootEventId,
						deviceId: body.deviceId,
						results: [
							blockedResult(requiredTest(third)),
							blockedResult(requiredTest(second)),
							{
								clientMutationId: requiredTest(first).clientMutationId,
								clientSequence: requiredTest(first).clientSequence,
								outcome: "rejected",
								replayed: false,
								error: {
									code: "VERSION_CONFLICT",
									message: "private server value must not persist",
									retryable: false,
									currentVersion: 7,
								},
							},
						],
						nextExpectedClientSequence: requiredTest(second).clientSequence,
					});
				}
				if (pathname.endsWith("/sync/pull")) {
					return gatewayJson(
						init,
						200,
						pullPage("evt_trip", "2", "cursor-conflict-0001"),
					);
				}
				throw new Error("unexpected request");
			},
			{ randomUUID: uuidSequence(200) },
		);
		for (const title of ["Mine one", "Mine two", "Mine three"]) {
			await engine.enqueueMutation(
				syncAccount,
				"evt_trip",
				syncDevice,
				{
					kind: "event.update",
					entityId: "evt_trip",
					baseVersion: 1,
					payload: { changes: { title } },
				},
				{ eventId: "evt_trip", title },
			);
		}

		const status = await engine.syncRoot(syncAccount, "evt_trip");
		const items = await engine.listOutbox(syncAccount, "evt_trip");
		expect(status).toMatchObject({
			state: "needs_attention",
			pendingCount: 2,
			attentionCount: 1,
		});
		expect(items.map(({ state }) => state)).toEqual([
			"dead_letter",
			"pending",
			"pending",
		]);
		expect(items[0]?.lastError).toMatchObject({
			code: "conflict",
			currentVersion: 7,
		});
		expect(JSON.stringify(items)).not.toContain("private server value");
		database.close();
	});

	test("rejects duplicate result identities and retains the exact batch for retry", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedAccount(database, syncAccount);
		const sent: Array<{ body: string; key: string }> = [];
		const engine = testSyncEngine(
			database,
			syncAccount,
			async (_input, init) => {
				const attempt = requestAttempt(init);
				sent.push(attempt);
				const body = JSON.parse(attempt.body) as SyncPushBody;
				const first = requiredTest(body.mutations[0]);
				const duplicate = {
					clientMutationId: first.clientMutationId,
					clientSequence: first.clientSequence,
					outcome: "applied",
					replayed: false,
					rootRevision: "13",
				};
				return gatewayJson(init, 200, {
					protocolVersion: 1,
					rootEventId: body.rootEventId,
					deviceId: body.deviceId,
					results: [duplicate, duplicate],
					nextExpectedClientSequence: 3,
				});
			},
			{ randomUUID: uuidSequence(300) },
		);
		for (const id of ["fed_duplicate_one", "fed_duplicate_two"]) {
			await engine.enqueueMutation(
				syncAccount,
				"evt_trip",
				syncDevice,
				feedCreate(id, id),
				{ feedEntryId: id },
			);
		}

		expect((await engine.syncRoot(syncAccount, "evt_trip")).state).toBe(
			"waiting_retry",
		);
		const stored = await database.first<{
			body_json: string;
			idempotency_key: string;
		}>("SELECT body_json, idempotency_key FROM sync_push_batches");
		const attempt = requiredTest(sent[0]);
		expect(stored).toEqual({
			body_json: attempt.body,
			idempotency_key: attempt.key,
		});
		expect(
			(await engine.listOutbox(syncAccount, "evt_trip")).map(
				({ state }) => state,
			),
		).toEqual(["pending", "pending"]);
		database.close();
	});

	test("handles CURSOR_EXPIRED with atomic snapshot reset while overlays survive", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedAccount(database, syncAccount);
		const seen: string[] = [];
		const engine = testSyncEngine(
			database,
			syncAccount,
			async (input, init) => {
				const pathname = new URL(String(input)).pathname;
				seen.push(pathname);
				if (pathname.endsWith("/sync/pull")) {
					return gatewayError(init, 410, "CURSOR_EXPIRED", false);
				}
				if (pathname.endsWith("/sync/bootstrap")) {
					return gatewayJson(
						init,
						200,
						bootstrapPage("evt_trip", "2", "Reset canonical title", "21"),
					);
				}
				throw new Error("unexpected request");
			},
			{ randomUUID: uuidSequence(400) },
		);
		for (const title of ["Already applied", "Still local"]) {
			await engine.enqueueMutation(
				syncAccount,
				"evt_trip",
				syncDevice,
				{
					kind: "event.update",
					entityId: "evt_trip",
					baseVersion: 1,
					payload: { changes: { title } },
				},
				{ eventId: "evt_trip", title },
			);
		}
		const [applied, pending] = await engine.listOutbox(syncAccount, "evt_trip");
		await database.run(
			`UPDATE mutation_outbox SET state = 'awaiting_pull',
  applied_root_revision = '20', server_consumed = 1
WHERE account_user_id = ? AND client_mutation_id = ?`,
			[syncAccount, requiredTest(applied).clientMutationId],
		);
		await database.run(
			`UPDATE mutation_outbox SET state = 'blocked', blocked_until_pull = 1,
  last_error_code = 'blocked'
WHERE account_user_id = ? AND client_mutation_id = ?`,
			[syncAccount, requiredTest(pending).clientMutationId],
		);

		const status = await engine.syncRoot(syncAccount, "evt_trip");
		const remaining = await engine.listOutbox(syncAccount, "evt_trip");
		expect(seen).toEqual(["/core/v1/sync/pull", "/core/v1/sync/bootstrap"]);
		expect(status).toMatchObject({ state: "pending", pendingCount: 1 });
		expect(remaining).toHaveLength(1);
		expect(remaining[0]).toMatchObject({
			clientMutationId: requiredTest(pending).clientMutationId,
			state: "pending",
			optimisticOverlay: { eventId: "evt_trip", title: "Still local" },
		});
		expect(
			(
				await new MobileDataStore(database).listEventTree(
					syncAccount,
					"evt_trip",
				)
			)[0]?.title,
		).toBe("Reset canonical title");
		expect(await database.all("PRAGMA foreign_key_check")).toEqual([]);
		database.close();
	});

	test("retains a rejected feed entry through a participant to viewer scope reset", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedAccount(database, syncAccount);
		await database.run(
			"UPDATE memberships SET role = 'participant' WHERE account_user_id = ? AND root_event_id = ?",
			[syncAccount, "evt_trip"],
		);
		const base = bootstrapPage("evt_trip", "2", "Viewer trip", "21");
		const viewerPage = {
			...base,
			records: [
				...base.records,
				{
					entityType: "membership",
					entityId: syncAccount,
					entityVersion: 2,
					data: {
						rootEventId: "evt_trip",
						userId: syncAccount,
						role: "viewer",
						status: "active",
						version: 2,
						createdAt: now,
						updatedAt: now,
					},
				},
			],
		} as SyncBootstrapPage;
		const seen: string[] = [];
		const engine = testSyncEngine(
			database,
			syncAccount,
			async (input, init) => {
				const pathname = new URL(String(input)).pathname;
				seen.push(pathname);
				if (pathname.endsWith("/sync/push")) {
					const body = JSON.parse(String(init?.body)) as SyncPushBody;
					const mutation = requiredTest(body.mutations[0]);
					return gatewayJson(init, 200, {
						protocolVersion: 1,
						rootEventId: body.rootEventId,
						deviceId: body.deviceId,
						results: [
							{
								clientMutationId: mutation.clientMutationId,
								clientSequence: mutation.clientSequence,
								outcome: "rejected",
								replayed: false,
								error: {
									code: "FORBIDDEN",
									message: "private role detail",
									retryable: false,
								},
							},
						],
						nextExpectedClientSequence: mutation.clientSequence + 1,
					});
				}
				if (pathname.endsWith("/sync/pull")) {
					return gatewayError(init, 410, "CURSOR_EXPIRED", false);
				}
				if (pathname.endsWith("/sync/bootstrap")) {
					return gatewayJson(init, 200, viewerPage);
				}
				throw new Error("unexpected request");
			},
			{ randomUUID: uuidSequence(450) },
		);
		const queued = await engine.enqueueMutation(
			syncAccount,
			"evt_trip",
			syncDevice,
			feedCreate("fed_role_downgrade", "Bleibt lokal erhalten."),
			{ feedEntryId: "fed_role_downgrade" },
		);

		expect(await engine.syncRoot(syncAccount, "evt_trip")).toMatchObject({
			state: "needs_attention",
			pendingCount: 0,
			attentionCount: 1,
		});
		expect(seen).toEqual([
			"/core/v1/sync/push",
			"/core/v1/sync/pull",
			"/core/v1/sync/bootstrap",
		]);
		expect(await engine.listOutbox(syncAccount, "evt_trip")).toEqual([
			expect.objectContaining({
				clientMutationId: queued.clientMutationId,
				command: expect.objectContaining({
					entityId: "fed_role_downgrade",
				}),
				lastError: expect.objectContaining({ code: "permission" }),
				serverConsumed: true,
				state: "dead_letter",
			}),
		]);
		expect(
			(
				await new MobileDataStore(database).listMemberships(
					syncAccount,
					"evt_trip",
				)
			)[0]?.role,
		).toBe("viewer");
		expect(
			JSON.stringify(await engine.listOutbox(syncAccount, "evt_trip")),
		).not.toContain("private role detail");
		database.close();
	});

	test("converges a team event through the shared offline graph and outbox", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const rootEventId = "evt_team_mobile";
		const sessionId = "evt_team_strategy";
		const activityId = "evt_team_challenge";
		const placeId = "plc_team_venue";
		const itineraryId = "iti_team_strategy";
		const root = {
			...gatewayEvent(rootEventId, "Crew Team Day"),
			status: "published" as const,
			deletedAt: null,
		};
		const session = {
			...root,
			id: sessionId,
			parentEventId: rootEventId,
			kind: "session" as const,
			title: "Strategy workshop",
		};
		const activity = {
			...root,
			id: activityId,
			parentEventId: sessionId,
			kind: "activity" as const,
			title: "Team challenge",
		};
		const decision = feedUpsert(
			"fed_team_decision",
			"Decision: owners and next steps",
			"9",
			rootEventId,
			sessionId,
		).data;
		const system = feedUpsert(
			"fed_team_published",
			"Team day published",
			"10",
			rootEventId,
			null,
			"system",
			null,
		).data;
		const bootstrap = {
			protocolVersion: 1,
			rootEventId,
			authorizationScopeVersion: "1",
			snapshotId: "snp_team_mobile",
			snapshotRevision: "10",
			records: [
				{
					entityType: "feedEntry",
					entityId: system.id,
					entityVersion: 1,
					data: system,
				},
				{
					entityType: "feedEntry",
					entityId: decision.id,
					entityVersion: 1,
					data: decision,
				},
				{
					entityType: "itineraryItem",
					entityId: itineraryId,
					entityVersion: 1,
					data: {
						id: itineraryId,
						rootEventId,
						eventId: rootEventId,
						title: "Strategy workshop",
						notes: null,
						timeZone: "Europe/Zurich",
						startsAt: "2026-09-18T07:00:00.000Z",
						endsAt: "2026-09-18T08:30:00.000Z",
						allDay: false,
						sortKey: "1",
						status: "active",
						details: {
							schemaVersion: 1,
							type: "session",
							descendantEventId: sessionId,
							room: "Workshop A",
						},
						placeId,
						placeSnapshot: {
							id: placeId,
							name: "Crew Hall",
							locality: "Zurich",
							countryCode: "CH",
							latitude: 47.3769,
							longitude: 8.5417,
						},
						version: 1,
						createdAt: now,
						updatedAt: now,
						deletedAt: null,
					},
				},
				{
					entityType: "capability",
					entityId: `${rootEventId}:team`,
					entityVersion: 1,
					data: {
						rootEventId,
						eventId: rootEventId,
						type: "team",
						config: {
							venuePlaceId: placeId,
							assignmentMode: "organizer",
							capacityPerTeam: 6,
							facilitator: "Mathias",
						},
						schemaVersion: 1,
						version: 1,
						createdAt: now,
						updatedAt: now,
						deletedAt: null,
					},
				},
				{
					entityType: "place",
					entityId: placeId,
					entityVersion: 1,
					data: {
						id: placeId,
						rootEventId,
						name: "Crew Hall",
						locality: "Zurich",
						countryCode: "CH",
						latitude: 47.3769,
						longitude: 8.5417,
						version: 1,
						createdAt: now,
						updatedAt: now,
						deletedAt: null,
					},
				},
				...([root, session, activity].map((data) => ({
					entityType: "event" as const,
					entityId: data.id,
					entityVersion: 1,
					data,
				})) satisfies SyncBootstrapPage["records"]),
			],
			syncCursor: "team-bootstrap-cursor-0010",
			pageInfo: { nextCursor: null, hasMore: false },
		} satisfies SyncBootstrapPage;
		const store = new MobileDataStore(database);
		expect(
			await store.applyBootstrapPage(syncAccount, null, bootstrap),
		).toEqual({
			completed: true,
			nextCursor: null,
		});
		expect(
			(await store.listEventTree(syncAccount, rootEventId)).map(
				({ id, kind, depth }) => ({ id, kind, depth }),
			),
		).toEqual([
			{ id: rootEventId, kind: "team_event", depth: 0 },
			{ id: sessionId, kind: "session", depth: 1 },
			{ id: activityId, kind: "activity", depth: 2 },
		]);
		expect((await store.listEventPlaces(syncAccount, rootEventId))[0]?.id).toBe(
			placeId,
		);
		expect(
			JSON.parse(
				requiredTest((await store.listTimeline(syncAccount, rootEventId))[0])
					.detailsJson,
			),
		).toMatchObject({ type: "session", descendantEventId: sessionId });
		expect(
			(await store.listCapabilities(syncAccount, rootEventId)).map(
				({ type }) => type,
			),
		).toEqual(["team"]);
		expect(
			(await store.listFeed(syncAccount, rootEventId)).map(({ kind }) => kind),
		).toEqual(["system", "message"]);

		let connected = false;
		const attempts: Array<{ body: string; key: string }> = [];
		const engine = testSyncEngine(
			database,
			syncAccount,
			async (input, init) => {
				const pathname = new URL(String(input)).pathname;
				if (pathname.endsWith("/sync/push")) {
					attempts.push(requestAttempt(init));
					if (!connected) throw new Error("offline");
					const body = JSON.parse(String(init?.body)) as SyncPushBody;
					const mutation = requiredTest(body.mutations[0]);
					return gatewayJson(init, 200, {
						protocolVersion: 1,
						rootEventId,
						deviceId: body.deviceId,
						results: [
							{
								clientMutationId: mutation.clientMutationId,
								clientSequence: mutation.clientSequence,
								outcome: "applied",
								replayed: false,
								rootRevision: "11",
								entity: {
									entityType: "feedEntry",
									entityId: mutation.entityId,
									version: 1,
								},
							},
						],
						nextExpectedClientSequence: mutation.clientSequence + 1,
					});
				}
				if (pathname.endsWith("/sync/pull")) {
					return gatewayJson(
						init,
						200,
						pullPage(rootEventId, "1", "team-pull-cursor-0011", [
							feedUpsert(
								"fed_team_offline_decision",
								"Decision: use option B",
								"11",
								rootEventId,
								sessionId,
							),
						]),
					);
				}
				throw new Error("unexpected request");
			},
			{ randomUUID: uuidSequence(500) },
		);
		await engine.enqueueMutation(
			syncAccount,
			rootEventId,
			syncDevice,
			{
				kind: "feed.entry.create",
				entityId: "fed_team_offline_decision",
				payload: {
					eventId: sessionId,
					parentEntryId: null,
					kind: "message",
					content: "Decision: use option B",
				},
			},
			{ feedEntryId: "fed_team_offline_decision" },
		);
		expect(await engine.syncRoot(syncAccount, rootEventId)).toMatchObject({
			state: "waiting_retry",
			pendingCount: 1,
		});
		connected = true;
		expect(
			await engine.syncRoot(syncAccount, rootEventId, { force: true }),
		).toMatchObject({ state: "synced", pendingCount: 0 });
		expect(attempts).toHaveLength(2);
		expect(attempts[1]).toEqual(attempts[0]);
		expect(attempts[0]?.body).not.toContain("golf");
		expect(await engine.listOutbox(syncAccount, rootEventId)).toEqual([]);
		expect(
			(await store.listFeed(syncAccount, rootEventId)).map(({ id }) => id),
		).toEqual([
			"fed_team_offline_decision",
			"fed_team_published",
			"fed_team_decision",
		]);
		expect(await database.all("PRAGMA foreign_key_check")).toEqual([]);
		database.close();
	});
});

const deniedRootScopedTables = [
	"root_sync_state",
	"actor_event_root_index_entries",
	"actor_event_root_selection",
	"events",
	"memberships",
	"itinerary_items",
	"feed_entries",
	"local_drafts",
	"invitations",
	"event_places",
	"event_capabilities",
	"feed_reactions",
	"attachments",
	"sync_tombstones",
	"sync_snapshot_staging",
	"sync_snapshot_records",
	"mutation_streams",
	"mutation_stream_identities",
	"mutation_outbox",
	"sync_push_batches",
	"local_attachment_media",
	"community_feedback_cache",
	"community_feedback_updates",
	"golf_rounds",
	"golf_holes",
	"golf_roster_players",
	"golf_players",
	"golf_teams",
	"golf_team_members",
	"golf_scores",
	"golf_leaderboards",
	"golf_rankings",
	"golf_intent_streams",
	"golf_score_intents",
	"team_assignment_sets",
	"team_assignment_teams",
	"team_assignment_roster_members",
	"team_own_assignments",
	"team_decisions",
	"team_decision_options",
	"team_own_responses",
] as const;

describe("authoritative root access denial", () => {
	test("atomically purges the complete scoped graph, survives restart, and permits a later re-invite", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-denied-root-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "crew.sqlite");
		const survivorRoot = "evt_survivor";
		const otherAccount = "usr_00000000000000000000000000000002";
		const deniedFileKey = `${"d".repeat(64)}.jpg`;
		const survivorFileKey = `${"e".repeat(64)}.jpg`;
		let database = new BunDatabase(path);
		await migrate(database);
		await seedDeniedRootGraph(database, deniedFileKey);
		await seedMinimalRoot(database, syncAccount, survivorRoot);
		await getOrCreateMutationStreamIdentity(
			database,
			syncAccount,
			"evt_trip",
			async () => syncDevice,
			() => syncDevice,
		);
		await getOrCreateMutationStreamIdentity(
			database,
			syncAccount,
			survivorRoot,
			async () => syncDevice,
			() => alternateSyncDevice,
		);
		await retainLocalAttachment(
			database,
			syncAccount,
			survivorRoot,
			"att_survivor",
			"fed_survivor",
			"e".repeat(64),
		);
		await seedMinimalRoot(database, otherAccount, "evt_trip");

		for (const table of deniedRootScopedTables) {
			expect(
				await rootRowCount(database, table, syncAccount, "evt_trip"),
			).toBeGreaterThan(0);
		}

		const armed: string[] = [];
		const disarmed: string[] = [];
		const retainedAfterPurge: string[][] = [];
		let denial: unknown;
		const engine = testSyncEngine(
			database,
			syncAccount,
			async (_input, init) => gatewayError(init, 404, "NOT_FOUND", false),
			{
				onRootReadStarted(accountUserId, rootEventId) {
					armed.push(`${accountUserId}:${rootEventId}`);
					return "verification-denied";
				},
				onRootReadFinished(accountUserId, rootEventId, verificationId) {
					disarmed.push(`${accountUserId}:${rootEventId}:${verificationId}`);
				},
				async onRootPurged(accountUserId) {
					retainedAfterPurge.push([
						...(await new LocalAttachmentStore(database).listRetainedFileKeys(
							accountUserId,
						)),
					]);
				},
			},
		);
		try {
			await engine.syncRoot(syncAccount, "evt_trip");
		} catch (error) {
			denial = error;
		}

		expect(denial).toBeInstanceOf(MobileSyncRootAccessDeniedError);
		const publicError = denial as Error & Record<string, unknown>;
		const exposed = `${publicError.name}:${
			publicError.message
		}:${JSON.stringify(publicError)}`;
		for (const secret of [
			"evt_trip",
			"request-sync-000001",
			"NOT_FOUND",
			"FORBIDDEN",
		]) {
			expect(exposed).not.toContain(secret);
		}
		expect(publicError.rootEventId).toBeUndefined();
		expect(publicError.requestId).toBeUndefined();
		expect(publicError.code).toBeUndefined();
		expect(armed).toEqual([`${syncAccount}:evt_trip`]);
		expect(disarmed).toEqual([`${syncAccount}:evt_trip:verification-denied`]);
		expect(retainedAfterPurge).toEqual([[survivorFileKey]]);

		for (const table of deniedRootScopedTables) {
			expect(await rootRowCount(database, table, syncAccount, "evt_trip")).toBe(
				0,
			);
		}
		expect(
			await rootRowCount(
				database,
				"root_sync_state",
				syncAccount,
				survivorRoot,
			),
		).toBe(1);
		expect(
			await database.first<{ device_id: string }>(
				`SELECT device_id FROM mutation_stream_identities
WHERE account_user_id = ? AND root_event_id = ?`,
				[syncAccount, survivorRoot],
			),
		).toEqual({ device_id: alternateSyncDevice });
		expect(
			await rootRowCount(database, "root_sync_state", otherAccount, "evt_trip"),
		).toBe(1);
		expect(
			await new LocalAttachmentStore(database).listRetainedFileKeys(
				syncAccount,
			),
		).toEqual([survivorFileKey]);
		expect(
			(
				await new LocalAttachmentStore(database).listRetainedFileKeys(
					syncAccount,
				)
			).includes(deniedFileKey),
		).toBe(false);
		expect(await database.all("PRAGMA foreign_key_check")).toEqual([]);
		database.close();

		database = new BunDatabase(path);
		await migrate(database);
		expect(
			await new MobileDataStore(database).getRootSyncState(
				syncAccount,
				"evt_trip",
			),
		).toBeNull();
		expect(
			await rootRowCount(
				database,
				"root_sync_state",
				syncAccount,
				survivorRoot,
			),
		).toBe(1);
		expect(
			await rootRowCount(database, "root_sync_state", otherAccount, "evt_trip"),
		).toBe(1);

		const base = bootstrapPage("evt_trip", "4", "Re-invited trip");
		const reinvitePage = {
			...base,
			records: [
				...base.records,
				{
					entityType: "membership",
					entityId: syncAccount,
					entityVersion: 1,
					data: {
						rootEventId: "evt_trip",
						userId: syncAccount,
						role: "participant",
						status: "active",
						version: 1,
						createdAt: now,
						updatedAt: now,
					},
				},
			],
		} as SyncBootstrapPage;
		let reinviteVerification = 0;
		const reinviteDisarms: string[] = [];
		const reinvited = testSyncEngine(
			database,
			syncAccount,
			async (input, init) => {
				const pathname = new URL(String(input)).pathname;
				if (pathname.endsWith("/sync/bootstrap")) {
					return gatewayJson(init, 200, reinvitePage);
				}
				if (pathname.endsWith("/sync/pull")) {
					return gatewayJson(
						init,
						200,
						pullPage("evt_trip", "4", "cursor-reinvited-0001"),
					);
				}
				throw new Error("unexpected request");
			},
			{
				onRootReadStarted() {
					reinviteVerification += 1;
					return `verification-success-${reinviteVerification}`;
				},
				onRootReadFinished(accountUserId, rootEventId, verificationId) {
					reinviteDisarms.push(
						`${accountUserId}:${rootEventId}:${verificationId}`,
					);
				},
			},
		);
		expect(await reinvited.syncRoot(syncAccount, "evt_trip")).toMatchObject({
			state: "synced",
		});
		expect(reinviteDisarms).toEqual([
			`${syncAccount}:evt_trip:verification-success-1`,
			`${syncAccount}:evt_trip:verification-success-2`,
		]);
		expect(
			(
				await new MobileDataStore(database).listEventTree(
					syncAccount,
					"evt_trip",
				)
			)[0]?.title,
		).toBe("Re-invited trip");
		expect(
			await new MobileDataStore(database).listMemberships(
				syncAccount,
				"evt_trip",
			),
		).toEqual([expect.objectContaining({ status: "active" })]);
		expect(
			await new LocalAttachmentStore(database).listRetainedFileKeys(
				syncAccount,
			),
		).toEqual([survivorFileKey]);
		database.close();
	});

	test("rolls back staging deletion when the root cascade cannot commit", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedAccount(database, syncAccount);
		await seedSnapshotStaging(database, syncAccount, "evt_trip");
		await database.exec(`
CREATE TRIGGER block_denied_root_delete
BEFORE DELETE ON root_sync_state
WHEN OLD.account_user_id = '${syncAccount}' AND OLD.root_event_id = 'evt_trip'
BEGIN
  SELECT RAISE(ABORT, 'blocked root delete');
END;`);

		await expect(
			new MobileDataStore(database).clearRootData(syncAccount, "evt_trip"),
		).rejects.toThrow("blocked root delete");
		expect(
			await rootRowCount(
				database,
				"sync_snapshot_staging",
				syncAccount,
				"evt_trip",
			),
		).toBe(1);
		expect(
			await rootRowCount(database, "root_sync_state", syncAccount, "evt_trip"),
		).toBe(1);
		database.close();
	});

	test("purges on a pull FORBIDDEN but retains cache on a transient bootstrap failure", async () => {
		const pullDatabase = new BunDatabase();
		await migrate(pullDatabase);
		await seedAccount(pullDatabase, syncAccount);
		const pullPurges: string[] = [];
		const denied = testSyncEngine(
			pullDatabase,
			syncAccount,
			async (_input, init) => gatewayError(init, 403, "FORBIDDEN", false),
			{
				onRootPurged(accountUserId, rootEventId) {
					pullPurges.push(`${accountUserId}:${rootEventId}`);
				},
			},
		);
		await expect(
			denied.syncRoot(syncAccount, "evt_trip"),
		).rejects.toBeInstanceOf(MobileSyncRootAccessDeniedError);
		expect(pullPurges).toEqual([`${syncAccount}:evt_trip`]);
		expect(
			await new MobileDataStore(pullDatabase).getRootSyncState(
				syncAccount,
				"evt_trip",
			),
		).toBeNull();
		pullDatabase.close();

		const networkDatabase = new BunDatabase();
		await migrate(networkDatabase);
		const cached = await seedAccount(networkDatabase, syncAccount);
		await networkDatabase.run(
			`UPDATE root_sync_state SET pull_cursor = NULL
WHERE account_user_id = ? AND root_event_id = ?`,
			[syncAccount, "evt_trip"],
		);
		const verificationEvents: string[] = [];
		const offline = testSyncEngine(
			networkDatabase,
			syncAccount,
			async () => {
				throw new Error("offline");
			},
			{
				onRootReadStarted(accountUserId, rootEventId) {
					verificationEvents.push(`arm:${accountUserId}:${rootEventId}`);
					return "verification-network";
				},
				onRootReadFinished(accountUserId, rootEventId, verificationId) {
					verificationEvents.push(
						`finish:${accountUserId}:${rootEventId}:${verificationId}`,
					);
				},
			},
		);
		await offline.syncRoot(syncAccount, "evt_trip");
		expect(verificationEvents).toEqual([
			`arm:${syncAccount}:evt_trip`,
			`finish:${syncAccount}:evt_trip:verification-network`,
		]);
		expect(
			(await cached.listEventTree(syncAccount, "evt_trip"))[0]?.title,
		).toBe(`Trip for ${syncAccount}`);
		expect(await cached.listDrafts(syncAccount, "evt_trip")).toHaveLength(1);
		networkDatabase.close();
	});

	test("purges the denied account during an in-flight switch without touching the new account", async () => {
		const database = new BunDatabase();
		const accountB = "usr_00000000000000000000000000000002";
		await migrate(database);
		await seedAccount(database, syncAccount);
		await seedAccount(database, accountB);
		let activeAccount = syncAccount;
		const purged: string[] = [];
		const verifications: string[] = [];
		const engine = testSyncEngine(
			database,
			syncAccount,
			async (_input, init) => {
				activeAccount = accountB;
				return gatewayError(init, 404, "NOT_FOUND", false);
			},
			{
				activeAccountUserId: () => activeAccount,
				onRootReadStarted(accountUserId, rootEventId) {
					verifications.push(`arm:${accountUserId}:${rootEventId}`);
					return "verification-account-a";
				},
				onRootReadFinished(accountUserId, rootEventId, verificationId) {
					verifications.push(
						`finish:${accountUserId}:${rootEventId}:${verificationId}`,
					);
				},
				onRootPurged(accountUserId, rootEventId) {
					purged.push(`${accountUserId}:${rootEventId}`);
				},
			},
		);

		await expect(
			engine.syncRoot(syncAccount, "evt_trip"),
		).rejects.toBeInstanceOf(MobileSyncRootAccessDeniedError);
		expect(purged).toEqual([`${syncAccount}:evt_trip`]);
		expect(verifications).toEqual([
			`arm:${syncAccount}:evt_trip`,
			`finish:${syncAccount}:evt_trip:verification-account-a`,
		]);
		expect(
			await rootRowCount(database, "root_sync_state", syncAccount, "evt_trip"),
		).toBe(0);
		expect(
			await rootRowCount(database, "root_sync_state", accountB, "evt_trip"),
		).toBe(1);
		database.close();
	});

	test("does not treat a mutation permission response as a read-side denial", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedAccount(database, syncAccount);
		let denialCallbacks = 0;
		const engine = testSyncEngine(
			database,
			syncAccount,
			async (_input, init) => gatewayError(init, 403, "FORBIDDEN", false),
			{
				onRootReadStarted() {
					denialCallbacks += 1;
					return "verification-unexpected";
				},
				onRootReadFinished() {
					denialCallbacks += 1;
				},
				onRootPurged() {
					denialCallbacks += 1;
				},
			},
		);
		await engine.enqueueMutation(
			syncAccount,
			"evt_trip",
			syncDevice,
			feedCreate("fed_permission", "Keep root"),
			{},
		);

		await engine.syncRoot(syncAccount, "evt_trip");
		expect(denialCallbacks).toBe(0);
		expect(
			await rootRowCount(database, "root_sync_state", syncAccount, "evt_trip"),
		).toBe(1);
		database.close();
	});

	test("does not send a root read when its durable verification marker cannot be armed", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const cached = await seedAccount(database, syncAccount);
		let requests = 0;
		let finishes = 0;
		const engine = testSyncEngine(
			database,
			syncAccount,
			async () => {
				requests += 1;
				throw new Error("request must stay fenced");
			},
			{
				onRootReadStarted() {
					throw new Error("protected marker write failed");
				},
				onRootReadFinished() {
					finishes += 1;
				},
			},
		);

		await engine.syncRoot(syncAccount, "evt_trip");
		expect(requests).toBe(0);
		expect(finishes).toBe(0);
		expect(
			(await cached.listEventTree(syncAccount, "evt_trip"))[0]?.title,
		).toBe(`Trip for ${syncAccount}`);
		database.close();
	});
});

async function seedDeniedRootGraph(
	database: BunDatabase,
	deniedFileKey: string,
): Promise<void> {
	const store = await seedAccount(database, syncAccount);
	await database.run(
		`INSERT INTO actor_event_root_index_state (
  account_user_id, schema_version, cache_version, refreshed_at
) VALUES (?, 1, 1, ?)`,
		[syncAccount, now],
	);
	await database.run(
		`INSERT INTO actor_event_root_index_entries (
  account_user_id, root_event_id, kind, title, time_zone, starts_at, ends_at,
  status, version, created_at, updated_at, role, membership_status
) VALUES (?, 'evt_trip', 'trip', 'Denied trip', 'Europe/Zurich', NULL, NULL,
  'published', 1, ?, ?, 'participant', 'active')`,
		[syncAccount, now, now],
	);
	await database.run(
		`INSERT INTO actor_event_root_selection (
  account_user_id, root_event_id, selected_at
) VALUES (?, 'evt_trip', ?)`,
		[syncAccount, now],
	);
	await completeBootstrap(store, syncAccount, "snp_denied_complete");
	await store.putDraft({
		accountUserId: syncAccount,
		id: "draft-denied",
		rootEventId: "evt_trip",
		eventId: "evt_day_a",
		entityType: "feedEntry",
		contentJson: '{"content":"pending private draft"}',
		createdAt: now,
		updatedAt: now,
	});

	await database.transaction(async (transaction) => {
		await putGolfSyncProjection(transaction, syncAccount, "golfRound", {
			rootEventId: "evt_trip",
			eventId: "evt_day_a",
			holes: [{ hole: 1, par: 4, strokeIndex: 1 }],
			teams: [
				{
					id: "gtm_denied",
					name: "Denied flight",
					color: "#00AA55",
					memberUserIds: [syncAccount],
				},
			],
			version: 1,
			updatedAt: now,
		});
		await putGolfSyncProjection(transaction, syncAccount, "golfRoster", {
			rootEventId: "evt_trip",
			eventId: "evt_day_a",
			players: [{ userId: syncAccount, playingHandicap: 18 }],
			version: 1,
			updatedAt: now,
		});
		await putGolfSyncProjection(transaction, syncAccount, "golfPlayer", {
			rootEventId: "evt_trip",
			eventId: "evt_day_a",
			userId: syncAccount,
			playingHandicap: 18,
			version: 1,
		});
		await putGolfSyncProjection(transaction, syncAccount, "golfScore", {
			id: `gsc_evt_day_a:${syncAccount}:1`,
			rootEventId: "evt_trip",
			eventId: "evt_day_a",
			userId: syncAccount,
			hole: 1,
			strokes: 5,
			putts: 2,
			playingHandicap: 18,
			handicapStrokes: 1,
			netStrokes: 4,
			stablefordPoints: 2,
			version: 1,
			rootRevision: "13",
			createdAt: now,
			updatedAt: now,
		});
		await putGolfSyncProjection(transaction, syncAccount, "golfLeaderboard", {
			rootEventId: "evt_trip",
			eventId: "evt_day_a",
			version: 1,
			entries: [
				{
					userId: syncAccount,
					teamId: "gtm_denied",
					rank: 1,
					stablefordPoints: 2,
					holesCompleted: 1,
				},
			],
		});

		const team = { id: "ttm_denied", name: "Denied team", color: "#AA0055" };
		await putTeamSyncProjection(transaction, syncAccount, "teamAssignmentSet", {
			rootEventId: "evt_trip",
			eventId: "evt_day_a",
			teams: [team],
			version: 1,
			updatedAt: now,
		});
		await putTeamSyncProjection(
			transaction,
			syncAccount,
			"teamAssignmentRoster",
			{
				rootEventId: "evt_trip",
				eventId: "evt_day_a",
				teams: [{ ...team, memberUserIds: [syncAccount] }],
				version: 1,
				updatedAt: now,
			},
		);
		await putTeamSyncProjection(transaction, syncAccount, "teamAssignment", {
			rootEventId: "evt_trip",
			eventId: "evt_day_a",
			userId: syncAccount,
			team,
			version: 1,
			updatedAt: now,
		});
		await putTeamSyncProjection(transaction, syncAccount, "teamDecision", {
			id: "tdc_denied",
			rootEventId: "evt_trip",
			eventId: "evt_day_a",
			title: "Private decision",
			state: "open",
			options: [
				{ id: "tdo_denied", label: "Private option", responseCount: 1 },
			],
			responseCount: 1,
			version: 1,
			aggregateVersion: 1,
			createdAt: now,
			updatedAt: now,
		});
		await putTeamSyncProjection(transaction, syncAccount, "teamResponse", {
			id: `trp_tdc_denied:${syncAccount}`,
			rootEventId: "evt_trip",
			eventId: "evt_day_a",
			decisionId: "tdc_denied",
			userId: syncAccount,
			optionId: "tdo_denied",
			version: 1,
			rootRevision: "13",
			createdAt: now,
			updatedAt: now,
		});
	});

	await database.run(
		`INSERT INTO community_feedback_cache (
  account_user_id, root_event_id, feedback_id, status, version, followed,
  updated_at, summary_json, detail_json, refreshed_at
) VALUES (?, 'evt_trip', 'fbk_denied', 'open', 1, 1, ?, '{}', NULL, ?)`,
		[syncAccount, now, now],
	);
	await database.run(
		`INSERT INTO community_feedback_updates (
  account_user_id, root_event_id, feedback_id, version, changed_at,
  payload_json, refreshed_at
) VALUES (?, 'evt_trip', 'fbk_denied', 1, ?, '{}', ?)`,
		[syncAccount, now, now],
	);
	await retainLocalAttachment(
		database,
		syncAccount,
		"evt_trip",
		"att_local_denied",
		"fed_notice",
		deniedFileKey.slice(0, 64),
	);

	const pending = testSyncEngine(database, syncAccount, async () => {
		throw new Error("offline");
	});
	await pending.enqueueGolfScore(
		{
			accountUserId: syncAccount,
			clientIntentId: "gsi_denied_pending",
			rootEventId: "evt_trip",
			eventId: "evt_day_a",
			hole: 1,
			strokes: 6,
			putts: 2,
			baseVersion: 1,
		},
		syncDevice,
	);
	await pending.syncRoot(syncAccount, "evt_trip");
	await seedSnapshotStaging(database, syncAccount, "evt_trip");
	await database.run(
		`INSERT INTO sync_tombstones (
  account_user_id, root_event_id, entity_type, entity_id, entity_version,
  root_revision, ordinal, deleted_at, tombstone_json
) VALUES (?, 'evt_trip', 'event', 'evt_deleted_denied', 1, '13', 0, ?, '{}')`,
		[syncAccount, now],
	);
}

async function seedMinimalRoot(
	database: BunDatabase,
	accountUserId: string,
	rootEventId: string,
): Promise<void> {
	const store = new MobileDataStore(database);
	await store.putRootSyncState({
		accountUserId,
		rootEventId,
		pullCursor: `cursor-${rootEventId}`,
		snapshotId: `snp_${rootEventId.slice(4)}`,
		snapshotRevision: "1",
		authorizationScopeVersion: "1",
		lastCompletedSyncAt: now,
	});
	await store.putEvent({
		accountUserId,
		id: rootEventId,
		rootEventId,
		parentEventId: null,
		kind: "team_event",
		title: `Survivor ${rootEventId}`,
		description: null,
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		sortKey: "1",
		childOrderVersion: "1",
		itineraryOrderVersion: "1",
		status: "published",
		version: 1,
		createdAt: now,
		updatedAt: now,
		deletedAt: null,
	});
	await store.putMembership({
		accountUserId,
		rootEventId,
		memberUserId: accountUserId,
		role: "owner",
		status: "active",
		version: 1,
		createdAt: now,
		updatedAt: now,
	});
	await store.putFeedEntry({
		accountUserId,
		id: `fed_${rootEventId.slice(4)}`,
		rootEventId,
		eventId: rootEventId,
		parentEntryId: null,
		actorUserId: accountUserId,
		kind: "message",
		payloadSchemaVersion: 1,
		payloadJson: '{"text":"survivor"}',
		rootRevision: "1",
		createdRootRevision: "1",
		revisionOrdinal: 0,
		version: 1,
		createdAt: now,
		updatedAt: now,
		deletedAt: null,
	});
}

async function retainLocalAttachment(
	database: BunDatabase,
	accountUserId: string,
	rootEventId: string,
	attachmentId: string,
	targetEntryId: string,
	sha256: string,
): Promise<void> {
	await new LocalAttachmentStore(database).retain({
		accountUserId,
		attachmentId,
		rootEventId,
		targetEntryId,
		retainedFileKey: `${sha256}.jpg`,
		contentType: "image/jpeg",
		byteCount: 2048,
		sha256,
		pixelWidth: 1200,
		pixelHeight: 800,
		wasNormalized: true,
		retainedAt: now,
	});
}

async function seedSnapshotStaging(
	database: BunDatabase,
	accountUserId: string,
	rootEventId: string,
): Promise<void> {
	await database.run(
		`INSERT INTO sync_snapshot_staging (
  account_user_id, root_event_id, snapshot_id, snapshot_revision,
  authorization_scope_version, sync_cursor, next_page_cursor, base_pull_cursor
) VALUES (?, ?, 'snp_denied_staged', '14', '2', 'cursor-staged', NULL, 'cursor-live')`,
		[accountUserId, rootEventId],
	);
	await database.run(
		`INSERT INTO sync_snapshot_records (
  account_user_id, root_event_id, snapshot_id, entity_type, entity_id,
  entity_version, data_json
) VALUES (?, ?, 'snp_denied_staged', 'event', 'evt_staged_denied', 1, '{}')`,
		[accountUserId, rootEventId],
	);
}

async function rootRowCount(
	database: BunDatabase,
	table: (typeof deniedRootScopedTables)[number],
	accountUserId: string,
	rootEventId: string,
): Promise<number> {
	return Number(
		(
			await database.first<{ count: number }>(
				`SELECT COUNT(*) AS count FROM ${table}
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, rootEventId],
			)
		)?.count ?? 0,
	);
}

class StaticSessionStore implements SessionStore {
	constructor(private session: Session | null) {}

	async get(): Promise<Session | null> {
		return this.session;
	}

	async compareAndSet(
		expected: Session | null,
		replacement: Session | null,
	): Promise<boolean> {
		if (
			this.session?.user.id !== expected?.user.id ||
			this.session?.accessToken !== expected?.accessToken ||
			this.session?.refreshToken !== expected?.refreshToken
		) {
			return false;
		}
		this.session = replacement;
		return true;
	}
}

function testSyncEngine(
	database: SqlDatabase,
	accountUserId: string,
	fetchImplementation: (
		input: string | URL | Request,
		init?: RequestInit,
	) => Promise<Response>,
	options: {
		activeAccountUserId?: () => string | null;
		clock?: { value: Date };
		onRootReadStarted?: (
			accountUserId: string,
			rootEventId: string,
		) => string | Promise<string>;
		onRootReadFinished?: (
			accountUserId: string,
			rootEventId: string,
			verificationId: string,
		) => void | Promise<void>;
		onRootPurged?: (
			accountUserId: string,
			rootEventId: string,
		) => void | Promise<void>;
		assertMutationStreamIdentity?: (
			executor: SqlExecutor,
			accountUserId: string,
			rootEventId: string,
			deviceId: string,
		) => void | Promise<void>;
		randomUUID?: () => string;
		sha256?: (value: string) => string | Promise<string>;
	} = {},
): MobileSyncEngine {
	let requestNumber = 0;
	const gateway = new GatewayClient({
		baseUrl: "https://gateway.test",
		sessionStore: new StaticSessionStore(syncSession(accountUserId)),
		fetch: fetchImplementation as typeof fetch,
		requestId: () => `request-sync-${String(++requestNumber).padStart(6, "0")}`,
		idempotencyKey: () => "unused-idempotency-key",
	});
	return new MobileSyncEngine(database, gateway, {
		activeAccountUserId: options.activeAccountUserId ?? (() => accountUserId),
		...(options.assertMutationStreamIdentity
			? {
					assertMutationStreamIdentity: options.assertMutationStreamIdentity,
				}
			: {}),
		...(options.onRootReadStarted
			? { onRootReadStarted: options.onRootReadStarted }
			: {}),
		...(options.onRootReadFinished
			? { onRootReadFinished: options.onRootReadFinished }
			: {}),
		...(options.onRootPurged ? { onRootPurged: options.onRootPurged } : {}),
		now: () => new Date(options.clock?.value ?? now),
		random: () => 0.5,
		randomUUID: options.randomUUID ?? uuidSequence(),
		...(options.sha256 ? { sha256: options.sha256 } : {}),
	});
}

async function noFetch(): Promise<Response> {
	throw new Error("network must not run");
}

function syncSession(accountUserId: string): Session {
	return {
		accessToken: "access-sync-secret",
		refreshToken: "refresh-sync-secret",
		tokenType: "Bearer",
		expiresInSeconds: 300,
		user: {
			id: accountUserId,
			email: "sync@example.com",
			profile: {
				displayName: "Sync",
				avatarUrl: null,
				locale: "de-CH",
				timeZone: "Europe/Zurich",
				reduceMotion: false,
				eventReminders: true,
				productUpdates: false,
				version: 1,
				updatedAt: now,
			},
		},
	};
}

function uuidSequence(start = 1): () => string {
	let value = start;
	return () => `00000000-0000-4000-8000-${String(value++).padStart(12, "0")}`;
}

function feedCreate(entityId: string, content: string) {
	return {
		kind: "feed.entry.create" as const,
		entityId,
		payload: {
			eventId: null,
			parentEntryId: null,
			kind: "message" as const,
			content,
		},
	};
}

function requestAttempt(init: RequestInit | undefined): {
	body: string;
	key: string;
} {
	return {
		body: String(init?.body),
		key: requiredTest(new Headers(init?.headers).get("idempotency-key")),
	};
}

function gatewayJson(
	init: RequestInit | undefined,
	status: number,
	body: unknown,
): Response {
	const requestId = requiredTest(
		new Headers(init?.headers).get("x-request-id"),
	);
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			"X-Request-ID": requestId,
		},
	});
}

function gatewayError(
	init: RequestInit | undefined,
	status: number,
	code: string,
	retryable: boolean,
): Response {
	const requestId = requiredTest(
		new Headers(init?.headers).get("x-request-id"),
	);
	return gatewayJson(init, status, {
		error: { code, message: "Safe test error", requestId, retryable },
	});
}

function gatewayEvent(id: string, title: string) {
	return {
		id,
		rootEventId: id,
		parentEventId: null,
		kind: "team_event" as const,
		title,
		description: null,
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		sortKey: "1",
		childOrderVersion: 1,
		itineraryOrderVersion: 1,
		status: "draft" as const,
		version: 1,
		createdAt: now,
		updatedAt: now,
	};
}

function bootstrapPage(
	rootEventId: string,
	authorizationScopeVersion: string,
	title: string,
	snapshotRevision = "1",
) {
	return {
		protocolVersion: 1,
		rootEventId,
		authorizationScopeVersion,
		snapshotId: `snp_${rootEventId.slice(4)}`,
		snapshotRevision,
		records: [
			{
				entityType: "event",
				entityId: rootEventId,
				entityVersion: 1,
				data: { ...gatewayEvent(rootEventId, title), deletedAt: null },
			},
		],
		syncCursor: `bootstrap-sync-cursor-${rootEventId}`,
		pageInfo: { nextCursor: null, hasMore: false },
	};
}

function pullPage(
	rootEventId: string,
	authorizationScopeVersion: string,
	checkpointCursor: string,
	changes: unknown[] = [],
) {
	return {
		protocolVersion: 1,
		rootEventId,
		authorizationScopeVersion,
		changes,
		checkpointCursor,
		pageInfo: { nextCursor: null, hasMore: false },
	};
}

function feedUpsert(
	id: string,
	text: string,
	rootRevision: string,
	rootEventId = "evt_trip",
	eventId: string | null = null,
	kind: "message" | "comment" | "system" = "message",
	actorUserId: string | null = syncAccount,
) {
	return {
		rootRevision,
		ordinal: 0,
		entityType: "feedEntry",
		entityId: id,
		operation: "upsert",
		entityVersion: 1,
		data: {
			id,
			rootEventId,
			eventId,
			parentEntryId: null,
			actorUserId,
			kind,
			payloadSchemaVersion: 1 as const,
			payload: { text },
			rootRevision,
			createdRootRevision: rootRevision,
			version: 1,
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
		},
	};
}

function blockedResult(mutation: SyncPushBody["mutations"][number]) {
	return {
		clientMutationId: mutation.clientMutationId,
		clientSequence: mutation.clientSequence,
		outcome: "blocked",
		replayed: false,
		error: {
			code: "PREVIOUS_MUTATION_BLOCKED",
			message: "Blocked",
			retryable: false,
		},
	};
}

function requiredTest<Value>(value: Value | null | undefined): Value {
	if (value === null || value === undefined)
		throw new Error("test value missing");
	return value;
}
