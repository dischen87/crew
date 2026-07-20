import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import postgres, { type Sql } from "postgres";
import { migrate } from "../scripts/migrate";
import { createApp } from "./app";
import type { EventInput } from "./domain";
import { EventNotificationPayloadCodec } from "./event-notification-payload";
import {
	type GolfRoundSetupInput,
	golfPlayerEntityId,
	golfScoreEntityId,
} from "./golf-domain";
import { PostgresEventRepository } from "./postgres-repository";
import { EventService } from "./service";
import type {
	SyncBootstrapResponse,
	SyncMutation,
	SyncPullResponse,
	SyncPushInput,
	SyncPushResponse,
} from "./sync";
import { SyncCursorCodec } from "./sync";
import { installPublishedRootFixtures } from "./test-published-root-fixture";

const databaseUrl =
	Bun.env.EVENT_TEST_DATABASE_URL ?? "postgres://localhost/crew_event_test";
const userId = (value: number) => `usr_${value.toString(16).padStart(32, "0")}`;
const owner = { id: userId(801) };
const participant = { id: userId(802) };
const viewer = { id: userId(803) };
const outsider = { id: userId(804) };
const organizer = { id: userId(805) };
const removedGolfer = { id: userId(806) };
const devices = {
	primary: "dvc_00000000-0000-4000-8000-000000000001",
	second: "dvc_00000000-0000-4000-8000-000000000002",
	third: "dvc_00000000-0000-4000-8000-000000000003",
} as const;
const invitationKey = "sync-test-invitation-key-with-at-least-32-characters";
const syncCursorKey =
	"sync-test-dedicated-cursor-key-with-at-least-32-characters";

let sql: Sql;
let service: EventService;
let app: ReturnType<typeof createApp>;
let httpKey = 0;

beforeAll(async () => {
	sql = postgres(databaseUrl, { max: 20 });
	await migrate(sql);
});

beforeEach(async () => {
	await sql`TRUNCATE event_idempotency_records, event_roots CASCADE`;
	httpKey = 0;
	service = new EventService(
		new PostgresEventRepository(
			sql,
			new EventNotificationPayloadCodec({
				kid: "sync-test-v1",
				key: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
			}),
		),
		invitationKey,
		undefined,
		syncCursorKey,
	);
	installPublishedRootFixtures(service, sql);
	app = createApp({
		service,
		verifyUserToken: async (token) => ({ id: token }),
	});
});

afterAll(async () => {
	await sql.end();
});

describe("offline event sync against PostgreSQL", () => {
	test("orders and deduplicates one stream while isolating concurrent devices", async () => {
		const rootEventId = "evt_syncorder1";
		await service.createRoot(owner, rootInput(rootEventId));

		const reordered = await push(owner.id, {
			protocolVersion: 1,
			rootEventId,
			deviceId: devices.primary,
			mutations: [
				feedMutation(2, "fed_syncorder2", "second", mutationId(2)),
				feedMutation(1, "fed_syncorder1", "first", mutationId(1)),
			],
		});
		expect(reordered.response.status).toBe(200);
		expect(
			reordered.body.results.map(({ clientSequence }) => clientSequence),
		).toEqual([1, 2]);
		expect(reordered.body.results.map(({ outcome }) => outcome)).toEqual([
			"applied",
			"applied",
		]);
		expect(reordered.body.nextExpectedClientSequence).toBe(3);

		const concurrentMutation = feedMutation(
			3,
			"fed_syncconcurrent",
			"once",
			mutationId(3),
		);
		const concurrentInput: SyncPushInput = {
			protocolVersion: 1,
			rootEventId,
			deviceId: devices.primary,
			mutations: [concurrentMutation],
		};
		const concurrent = await Promise.all([
			push(owner.id, concurrentInput),
			push(owner.id, concurrentInput),
		]);
		expect(concurrent.map(({ response }) => response.status)).toEqual([
			200, 200,
		]);
		expect(
			concurrent.map(({ body }) => body.results[0]?.replayed).sort(),
		).toEqual([false, true]);

		const duplicate = await push(owner.id, concurrentInput);
		expect(duplicate.body.results[0]).toMatchObject({
			outcome: "applied",
			replayed: true,
		});
		expect(duplicate.body.nextExpectedClientSequence).toBe(4);

		const gap = await push(owner.id, {
			...concurrentInput,
			mutations: [feedMutation(5, "fed_syncgap", "gap", mutationId(5))],
		});
		expect(gap.body.results[0]).toMatchObject({
			outcome: "blocked",
			error: { code: "CAUSAL_GAP" },
		});
		expect(gap.body.nextExpectedClientSequence).toBe(4);

		const deviceWrites = await Promise.all([
			push(owner.id, {
				protocolVersion: 1,
				rootEventId,
				deviceId: devices.second,
				mutations: [
					feedMutation(1, "fed_syncdevice2", "device two", mutationId(21)),
				],
			}),
			push(owner.id, {
				protocolVersion: 1,
				rootEventId,
				deviceId: devices.third,
				mutations: [
					feedMutation(1, "fed_syncdevice3", "device three", mutationId(31)),
				],
			}),
		]);
		expect(
			deviceWrites.map(({ body }) => body.nextExpectedClientSequence),
		).toEqual([2, 2]);

		const [proof] = await sql<
			{ feeds: number; gap: number; receipts: number; streams: number }[]
		>`
			SELECT
				(SELECT count(*)::int FROM event_feed_entries
				 WHERE root_event_id = ${rootEventId} AND kind <> 'system') AS feeds,
				(SELECT count(*)::int FROM event_feed_entries WHERE id = 'fed_syncgap') AS gap,
				(SELECT count(*)::int FROM event_sync_mutation_receipts WHERE root_event_id = ${rootEventId}) AS receipts,
				(SELECT count(*)::int FROM event_sync_streams WHERE root_event_id = ${rootEventId}) AS streams
		`;
		expect(proof).toEqual({ feeds: 5, gap: 0, receipts: 5, streams: 3 });
	});

	test("serializes one actor mutation UUID across roots", async () => {
		const firstRoot = "evt_syncuuidroot1";
		const secondRoot = "evt_syncuuidroot2";
		await service.createRoot(owner, rootInput(firstRoot));
		await service.createRoot(owner, rootInput(secondRoot));
		const sharedId = mutationId(91);
		const attempts = await Promise.all([
			push(owner.id, {
				protocolVersion: 1,
				rootEventId: firstRoot,
				deviceId: devices.primary,
				mutations: [feedMutation(1, "fed_syncuuidroot1", "first", sharedId)],
			}),
			push(owner.id, {
				protocolVersion: 1,
				rootEventId: secondRoot,
				deviceId: devices.primary,
				mutations: [feedMutation(1, "fed_syncuuidroot2", "second", sharedId)],
			}),
		]);
		expect(attempts.map(({ response }) => response.status)).toEqual([200, 200]);
		expect(attempts.map(({ body }) => body.results[0]?.outcome).sort()).toEqual(
			["applied", "rejected"],
		);
		expect(
			attempts.find(({ body }) => body.results[0]?.outcome === "rejected")?.body
				.results[0]?.error?.code,
		).toBe("IDEMPOTENCY_KEY_REUSED");
		const [proof] = await sql<{ feeds: number; receipts: number }[]>`
			SELECT
				(SELECT count(*)::int FROM event_feed_entries
					WHERE root_event_id IN (${firstRoot}, ${secondRoot})
						AND kind <> 'system') AS feeds,
				(SELECT count(*)::int FROM event_sync_mutation_receipts
					WHERE actor_id = ${owner.id}
						AND client_mutation_id = ${sharedId}::uuid) AS receipts
		`;
		expect(proof).toEqual({ feeds: 1, receipts: 1 });
	});

	test("commits an applied prefix, persists terminal rejection, and leaves attachment retry unconsumed", async () => {
		const rootEventId = "evt_syncprefix1";
		await service.createRoot(owner, rootInput(rootEventId));
		const prefix = await push(owner.id, {
			protocolVersion: 1,
			rootEventId,
			deviceId: devices.primary,
			mutations: [
				feedMutation(1, "fed_syncattach", "attachment target", mutationId(101)),
				{
					clientMutationId: mutationId(102),
					clientSequence: 2,
					kind: "event.update",
					entityId: rootEventId,
					baseVersion: 999,
					payload: { changes: { title: "stale update" } },
				},
				feedMutation(3, "fed_syncblocked", "blocked", mutationId(103)),
			],
		});
		expect(prefix.body.results.map(({ outcome }) => outcome)).toEqual([
			"applied",
			"rejected",
			"blocked",
		]);
		expect(prefix.body.results[1]?.error?.code).toBe("VERSION_CONFLICT");
		expect(prefix.body.nextExpectedClientSequence).toBe(3);

		const upload = await seedPreparedUpload(rootEventId);
		const commitMutation: SyncMutation = {
			clientMutationId: mutationId(104),
			clientSequence: 3,
			kind: "attachment.commit",
			entityId: upload.attachmentId,
			payload: { uploadId: upload.uploadId, caption: "Verified photo" },
		};
		const retry = await push(owner.id, {
			protocolVersion: 1,
			rootEventId,
			deviceId: devices.primary,
			mutations: [commitMutation],
		});
		expect(retry.body.results[0]).toMatchObject({
			outcome: "retry",
			replayed: false,
			retryAfterSeconds: 1,
		});
		expect(retry.body.nextExpectedClientSequence).toBe(3);
		const [beforeVerification] = await sql<
			{ receipts: number; attempts: number }[]
		>`
			SELECT
				(SELECT count(*)::int FROM event_sync_mutation_receipts WHERE root_event_id = ${rootEventId}) AS receipts,
				(SELECT attempts::int FROM event_attachment_verify_jobs WHERE upload_id = ${upload.uploadId}) AS attempts
		`;
		expect(beforeVerification).toEqual({ receipts: 2, attempts: 0 });

		await sql`
			UPDATE event_attachment_verify_jobs
			SET status = 'verified', result_object_key = ${upload.committedObjectKey},
				completed_at = clock_timestamp(), updated_at = clock_timestamp()
			WHERE upload_id = ${upload.uploadId}
		`;
		const committed = await push(owner.id, {
			protocolVersion: 1,
			rootEventId,
			deviceId: devices.primary,
			mutations: [commitMutation],
		});
		expect(committed.body.results[0]).toMatchObject({
			outcome: "applied",
			replayed: false,
			entity: {
				entityType: "attachment",
				entityId: upload.attachmentId,
				version: 1,
			},
		});
		expect(committed.body.nextExpectedClientSequence).toBe(4);
		const [afterVerification] = await sql<
			{ attachments: number; blocked: number; receipts: number }[]
		>`
			SELECT
				(SELECT count(*)::int FROM event_attachments WHERE id = ${upload.attachmentId}) AS attachments,
				(SELECT count(*)::int FROM event_feed_entries WHERE id = 'fed_syncblocked') AS blocked,
				(SELECT count(*)::int FROM event_sync_mutation_receipts WHERE root_event_id = ${rootEventId}) AS receipts
		`;
		expect(afterVerification).toEqual({
			attachments: 1,
			blocked: 0,
			receipts: 3,
		});
	});

	test("rejects more than one MiB before parsing or claiming HTTP idempotency", async () => {
		const rootEventId = "evt_syncbody001";
		await service.createRoot(owner, rootInput(rootEventId));
		const idempotencyKey = "sync-oversized-body-001";
		const rawBody = JSON.stringify({
			protocolVersion: 1,
			rootEventId,
			deviceId: devices.primary,
			mutations: [
				feedMutation(
					1,
					"fed_syncoversized",
					"x".repeat(1024 * 1024),
					mutationId(201),
				),
			],
		});
		expect(Buffer.byteLength(rawBody)).toBeGreaterThan(1024 * 1024);
		const response = await app.request("/v1/sync/push", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${owner.id}`,
				"Content-Type": "application/json",
				"Content-Length": String(Buffer.byteLength(rawBody)),
				"Idempotency-Key": idempotencyKey,
			},
			body: rawBody,
		});
		expect(response.status).toBe(413);
		expect((await response.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
		const [proof] = await sql<{ idempotency: number; receipts: number }[]>`
			SELECT
				(SELECT count(*)::int FROM event_idempotency_records WHERE idempotency_key = ${idempotencyKey}) AS idempotency,
				(SELECT count(*)::int FROM event_sync_mutation_receipts WHERE root_event_id = ${rootEventId}) AS receipts
		`;
		expect(proof).toEqual({ idempotency: 0, receipts: 0 });
	});

	test("binds pull cursors and advances a checkpoint across hidden changes", async () => {
		const rootEventId = "evt_synccursor1";
		const otherRootEventId = "evt_synccursor2";
		await service.createRoot(owner, rootInput(rootEventId));
		await addMember(rootEventId, participant.id, "participant");
		await addMember(rootEventId, viewer.id, "viewer");
		await service.createRoot(owner, rootInput(otherRootEventId));
		await addMember(otherRootEventId, participant.id, "participant");

		const initial = await bootstrap(participant.id, rootEventId, 200);
		expect(initial.response.status).toBe(200);
		expect(initial.body.authorizationScopeVersion).toBeString();
		const cursor = initial.body.syncCursor;
		const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("a") ? "b" : "a"}`;
		for (const request of [
			pull(participant.id, rootEventId, tampered),
			pull(viewer.id, rootEventId, cursor),
			pull(participant.id, otherRootEventId, cursor),
		]) {
			const result = await request;
			expect(result.response.status).toBe(400);
			expect((result.body as ErrorBody).error.code).toBe("CURSOR_INVALID");
		}

		await service.createInvitation(owner, rootEventId, {
			id: "inv_synchidden1",
			role: "participant",
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
		});
		const hidden = await pull(participant.id, rootEventId, cursor, 1);
		expect(hidden.response.status).toBe(200);
		expect((hidden.body as SyncPullResponse).changes).toEqual([]);
		expect((hidden.body as SyncPullResponse).checkpointCursor).not.toBe(cursor);

		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_syncvisible1",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "visible after hidden",
		});
		const visible = await pull(
			participant.id,
			rootEventId,
			(hidden.body as SyncPullResponse).checkpointCursor,
			10,
		);
		expect((visible.body as SyncPullResponse).changes).toContainEqual(
			expect.objectContaining({
				entityId: "fed_syncvisible1",
				operation: "upsert",
			}),
		);
	});

	test("invalidates old scope on downgrade and conceals the root after removal", async () => {
		const rootEventId = "evt_syncmember1";
		await service.createRoot(owner, rootInput(rootEventId));
		await addMember(rootEventId, participant.id, "participant");
		const initial = await bootstrap(participant.id, rootEventId, 200);

		await service.updateMembership(
			owner,
			rootEventId,
			participant.id,
			1,
			"viewer",
			"active",
			null,
		);
		const expiredScope = await pull(
			participant.id,
			rootEventId,
			initial.body.syncCursor,
		);
		expect(expiredScope.response.status).toBe(410);
		expect((expiredScope.body as ErrorBody).error.code).toBe("CURSOR_EXPIRED");

		const rejected = await push(participant.id, {
			protocolVersion: 1,
			rootEventId,
			deviceId: devices.primary,
			mutations: [
				feedMutation(1, "fed_syncviewer", "not allowed", mutationId(301)),
			],
		});
		expect(rejected.response.status).toBe(200);
		expect(rejected.body.results[0]).toMatchObject({
			outcome: "rejected",
			error: { code: "FORBIDDEN" },
		});
		expect(rejected.body.nextExpectedClientSequence).toBe(2);

		await service.updateMembership(
			owner,
			rootEventId,
			participant.id,
			2,
			"viewer",
			"removed",
			"sync test",
		);
		const removedKey = "sync-removed-root-001";
		const removed = await push(
			participant.id,
			{
				protocolVersion: 1,
				rootEventId,
				deviceId: devices.primary,
				mutations: [
					feedMutation(2, "fed_syncremoved", "concealed", mutationId(302)),
				],
			},
			removedKey,
		);
		expect(removed.response.status).toBe(404);
		expect((removed.body as unknown as ErrorBody).error.code).toBe("NOT_FOUND");
		const [proof] = await sql<{ receipts: number; idempotency: number }[]>`
			SELECT
				(SELECT count(*)::int FROM event_sync_mutation_receipts WHERE root_event_id = ${rootEventId}) AS receipts,
				(SELECT count(*)::int FROM event_idempotency_records WHERE idempotency_key = ${removedKey}) AS idempotency
		`;
		expect(proof).toEqual({ receipts: 1, idempotency: 0 });
	});

	test("fails old-writer change rows closed during a rolling deploy", async () => {
		const rootEventId = "evt_syncoldwriter";
		const invitationId = "inv_syncoldwriter";
		await service.createRoot(owner, rootInput(rootEventId));
		await addMember(rootEventId, participant.id, "participant");
		const managerStart = await bootstrap(owner.id, rootEventId, 200);
		const memberStart = await bootstrap(participant.id, rootEventId, 200);
		const timestamp = new Date().toISOString();
		await sql.begin(async (transaction) => {
			const tx = transaction as unknown as Sql;
			const [root] = await tx<{ revision: string }[]>`
				UPDATE event_roots SET revision = revision + 1
				WHERE root_event_id = ${rootEventId}
				RETURNING revision::text AS revision
			`;
			if (!root) throw new Error("old-writer root fixture missing");
			await tx`
				INSERT INTO event_root_changes (
					root_event_id, root_revision, ordinal, entity_type, entity_id,
					operation, entity_version, data, tombstone
				) VALUES (
					${rootEventId}, ${root.revision}, 0, 'invitation', ${invitationId},
					'upsert', 1, ${tx.json({
						id: invitationId,
						rootEventId,
						role: "participant",
						emailBound: false,
						expiresAt: new Date(Date.now() + 60_000).toISOString(),
						maxUses: 1,
						useCount: 0,
						status: "active",
						version: 1,
						createdAt: timestamp,
						updatedAt: timestamp,
					})}, NULL
				)
			`;
		});
		const managerChanges = await pull(
			owner.id,
			rootEventId,
			managerStart.body.syncCursor,
		);
		const memberChanges = await pull(
			participant.id,
			rootEventId,
			memberStart.body.syncCursor,
		);
		expect(
			(managerChanges.body as SyncPullResponse).changes.some(
				({ entityId }) => entityId === invitationId,
			),
		).toBe(true);
		expect(
			(memberChanges.body as SyncPullResponse).changes.some(
				({ entityId }) => entityId === invitationId,
			),
		).toBe(false);
		const [stored] = await sql<{ audience: string }[]>`
			SELECT audience FROM event_root_changes
			WHERE root_event_id = ${rootEventId} AND entity_id = ${invitationId}
		`;
		expect(stored?.audience).toBe("managers");
	});

	test("returns 410 after retention and keeps an immutable bootstrap race gap-free", async () => {
		const retentionRoot = "evt_syncretain1";
		await service.createRoot(owner, rootInput(retentionRoot));
		const retainedFrom = await bootstrap(owner.id, retentionRoot, 200);
		await service.createFeedEntry(owner, retentionRoot, {
			id: "fed_syncretain1",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "retained one",
		});
		await service.createFeedEntry(owner, retentionRoot, {
			id: "fed_syncretain2",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "retained two",
		});
		await sql`
			UPDATE event_roots SET minimum_sync_revision = 2
			WHERE root_event_id = ${retentionRoot}
		`;
		const expired = await pull(
			owner.id,
			retentionRoot,
			retainedFrom.body.syncCursor,
		);
		expect(expired.response.status).toBe(410);
		expect((expired.body as ErrorBody).error).toMatchObject({
			code: "CURSOR_EXPIRED",
			retryable: false,
		});
		const rebuilt = await bootstrap(owner.id, retentionRoot, 200);
		expect(rebuilt.response.status).toBe(200);
		expect(rebuilt.body.snapshotId).not.toBe(retainedFrom.body.snapshotId);
		expect(
			rebuilt.body.records
				.filter(({ entityType }) => entityType === "feedEntry")
				.filter(({ entityId }) => !entityId.startsWith("fed_sys_"))
				.map(({ entityId }) => entityId)
				.sort(),
		).toEqual(["fed_syncretain1", "fed_syncretain2"]);

		const tupleRoot = "evt_synctuple01";
		await service.createRoot(owner, rootInput(tupleRoot));
		const [tupleAccess] = await sql<
			{ revision: string; authorizationScopeVersion: string }[]
		>`
			UPDATE event_roots SET minimum_sync_revision = revision,
				minimum_sync_ordinal = 1
			WHERE root_event_id = ${tupleRoot}
			RETURNING revision::text AS revision,
				authorization_scope_version::text AS "authorizationScopeVersion"
		`;
		if (!tupleAccess) throw new Error("tuple root missing");
		const cursorCodec = new SyncCursorCodec(syncCursorKey);
		const staleTupleCursor = cursorCodec.encode({
			v: 1,
			op: "pull",
			actorId: owner.id,
			rootEventId: tupleRoot,
			authorizationScopeVersion: tupleAccess.authorizationScopeVersion,
			filters: {},
			rootRevision: tupleAccess.revision,
			ordinal: 0,
		});
		expect(
			(await pull(owner.id, tupleRoot, staleTupleCursor)).response.status,
		).toBe(410);
		const boundaryCursor = cursorCodec.encode({
			v: 1,
			op: "pull",
			actorId: owner.id,
			rootEventId: tupleRoot,
			authorizationScopeVersion: tupleAccess.authorizationScopeVersion,
			filters: {},
			rootRevision: tupleAccess.revision,
			ordinal: 1,
		});
		expect(
			(await pull(owner.id, tupleRoot, boundaryCursor)).response.status,
		).toBe(200);

		const rootEventId = "evt_syncsnapshot";
		await service.createRoot(owner, rootInput(rootEventId));
		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_syncbefore",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "before snapshot",
		});
		const first = await bootstrap(owner.id, rootEventId, 1);
		expect(first.response.status).toBe(200);
		expect(first.body.pageInfo.hasMore).toBe(true);
		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_syncafter",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "after snapshot",
		});

		const retainedPageCursor = first.body.pageInfo.nextCursor;
		const records = [...first.body.records];
		let nextCursor = first.body.pageInfo.nextCursor;
		while (nextCursor) {
			const page = await bootstrap(owner.id, rootEventId, 1, nextCursor);
			expect(page.response.status).toBe(200);
			expect(page.body).toMatchObject({
				snapshotId: first.body.snapshotId,
				snapshotRevision: first.body.snapshotRevision,
				syncCursor: first.body.syncCursor,
				authorizationScopeVersion: first.body.authorizationScopeVersion,
			});
			records.push(...page.body.records);
			nextCursor = page.body.pageInfo.nextCursor;
		}
		expect(records.some(({ entityId }) => entityId === "fed_syncbefore")).toBe(
			true,
		);
		expect(records.some(({ entityId }) => entityId === "fed_syncafter")).toBe(
			false,
		);
		const after = await pull(owner.id, rootEventId, first.body.syncCursor, 200);
		expect((after.body as SyncPullResponse).changes).toContainEqual(
			expect.objectContaining({
				entityId: "fed_syncafter",
				operation: "upsert",
			}),
		);
		const [currentRoot] = await sql<{ revision: string }[]>`
			UPDATE event_roots SET minimum_sync_revision = revision,
				minimum_sync_ordinal = 2147483647
			WHERE root_event_id = ${rootEventId}
			RETURNING revision::text AS revision
		`;
		if (!currentRoot || !retainedPageCursor)
			throw new Error("snapshot retention fixture missing");
		const stalePage = await bootstrap(
			owner.id,
			rootEventId,
			1,
			retainedPageCursor,
		);
		expect(stalePage.response.status).toBe(410);
		const current = await bootstrap(owner.id, rootEventId, 200);
		expect(current.body.snapshotId).not.toBe(first.body.snapshotId);
		expect(
			current.body.records.some(({ entityId }) => entityId === "fed_syncafter"),
		).toBe(true);
	});

	test("holds a reused snapshot through concurrent expiry cleanup", async () => {
		const rootEventId = "evt_syncsnaprace";
		await service.createRoot(owner, rootInput(rootEventId));
		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_syncsnaprace",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "snapshot race",
		});
		const seeded = await bootstrap(owner.id, rootEventId, 1);
		const [lease] = await sql<{ milliseconds: number }[]>`
			UPDATE event_sync_snapshots
			SET expires_at = clock_timestamp() + interval '1 second'
			WHERE id = ${seeded.body.snapshotId}
			RETURNING GREATEST(
				0,
				extract(epoch FROM (expires_at - clock_timestamp())) * 1000
			)::int AS milliseconds
		`;
		if (!lease) throw new Error("snapshot lease fixture missing");

		const barrierKey = 1_905_198_726;
		await sql.unsafe(`
			ALTER TABLE event_sync_snapshot_records
				RENAME TO event_sync_snapshot_records_race_fixture;
			CREATE FUNCTION event_sync_snapshot_race_barrier()
			RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE AS $$
			BEGIN
				PERFORM pg_advisory_xact_lock(${barrierKey});
				RETURN TRUE;
			END;
			$$;
			CREATE VIEW event_sync_snapshot_records AS
			SELECT fixture.*
			FROM event_sync_snapshot_records_race_fixture fixture
			WHERE event_sync_snapshot_race_barrier();
		`);
		const blocker = postgres(databaseUrl, { max: 1 });
		let pagePromise: ReturnType<typeof bootstrap> | undefined;
		let cleanupPromise: ReturnType<typeof pull> | undefined;
		try {
			await blocker`SELECT pg_advisory_lock(${barrierKey})`;
			pagePromise = bootstrap(owner.id, rootEventId, 1);
			await waitFor(async () => {
				const [activity] = await sql<{ waiting: boolean }[]>`
					SELECT EXISTS (
						SELECT 1 FROM pg_stat_activity
						WHERE datname = current_database()
							AND pid <> pg_backend_pid()
							AND wait_event_type = 'Lock'
							AND query LIKE '%event_sync_snapshot_records%'
					) AS waiting
				`;
				return activity?.waiting ?? false;
			});
			await Bun.sleep(lease.milliseconds + 50);
			cleanupPromise = pull(owner.id, rootEventId, seeded.body.syncCursor);
			const cleanup = await cleanupPromise;
			expect(cleanup.response.status).toBe(200);
			const [locked] = await sql<{ count: number }[]>`
				SELECT count(*)::int AS count FROM event_sync_snapshots
				WHERE id = ${seeded.body.snapshotId}
			`;
			expect(locked?.count).toBe(1);
			await blocker`SELECT pg_advisory_unlock(${barrierKey})`;
			const page = await pagePromise;
			expect(page.response.status).toBe(200);
			expect(page.body.snapshotId).toBe(seeded.body.snapshotId);
			expect(page.body.records).toHaveLength(1);
			const laterCleanup = await pull(
				owner.id,
				rootEventId,
				seeded.body.syncCursor,
			);
			expect(laterCleanup.response.status).toBe(200);
			const [remaining] = await sql<{ count: number }[]>`
				SELECT count(*)::int AS count FROM event_sync_snapshots
				WHERE id = ${seeded.body.snapshotId}
			`;
			expect(remaining?.count).toBe(0);
		} finally {
			await blocker`SELECT pg_advisory_unlock(${barrierKey})`.catch(
				() => undefined,
			);
			await Promise.allSettled([
				pagePromise ?? Promise.resolve(),
				cleanupPromise ?? Promise.resolve(),
			]);
			await blocker.end();
			await sql.unsafe(`
				DROP VIEW IF EXISTS event_sync_snapshot_records;
				ALTER TABLE event_sync_snapshot_records_race_fixture
					RENAME TO event_sync_snapshot_records;
				DROP FUNCTION IF EXISTS event_sync_snapshot_race_barrier();
			`);
		}
	});

	test("checks current membership before replaying a completed HTTP idempotency result", async () => {
		const rootEventId = "evt_syncreplay01";
		await service.createRoot(owner, rootInput(rootEventId));
		await addMember(rootEventId, participant.id, "participant");
		const input: SyncPushInput = {
			protocolVersion: 1,
			rootEventId,
			deviceId: devices.primary,
			mutations: [
				feedMutation(1, "fed_syncreplay01", "stored", mutationId(401)),
			],
		};
		const idempotencyKey = "sync-completed-before-removal";
		const stored = await push(participant.id, input, idempotencyKey);
		expect(stored.response.status).toBe(200);
		expect(stored.response.headers.get("Idempotency-Replayed")).toBe("false");

		await service.updateMembership(
			owner,
			rootEventId,
			participant.id,
			1,
			"participant",
			"removed",
			"replay guard",
		);
		const concealed = await push(participant.id, input, idempotencyKey);
		expect(concealed.response.status).toBe(404);
		expect((concealed.body as unknown as ErrorBody).error.code).toBe(
			"NOT_FOUND",
		);
		const changed = await push(
			participant.id,
			{
				...input,
				mutations: [
					feedMutation(
						1,
						"fed_syncreplay01",
						"changed after removal",
						mutationId(401),
					),
				],
			},
			idempotencyKey,
		);
		expect(changed.response.status).toBe(409);
		expect((changed.body as unknown as ErrorBody).error.code).toBe(
			"IDEMPOTENCY_KEY_REUSED",
		);
		const [proof] = await sql<{ idempotency: number; feeds: number }[]>`
			SELECT
				(SELECT count(*)::int FROM event_idempotency_records
					WHERE idempotency_key = ${idempotencyKey}) AS idempotency,
				(SELECT count(*)::int FROM event_feed_entries
					WHERE id = 'fed_syncreplay01') AS feeds
		`;
		expect(proof).toEqual({ idempotency: 1, feeds: 1 });
	});

	test("rolls back a write made before a terminal DomainError and still records the rejection", async () => {
		const rootEventId = "evt_syncsavepoint";
		await service.createRoot(owner, rootInput(rootEventId));
		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_syncsavepoint",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "expired upload target",
		});
		const uploadId = "upl_syncexpired1";
		const attachmentId = "att_syncexpired1";
		await sql`
			INSERT INTO event_attachment_uploads (
				id, attachment_id, root_event_id, target_entry_id, created_by,
				quarantine_object_key, content_type, byte_count, sha256,
				grant_kid, grant_ciphertext, created_at, expires_at
			) VALUES (
				${uploadId}, ${attachmentId}, ${rootEventId}, 'fed_syncsavepoint',
				${owner.id},
				${`quarantine/${rootEventId}/${attachmentId}/${uploadId}/4-${"b".repeat(64)}`},
				'image/png', 4, ${"b".repeat(64)},
				'sync-test', ${"x".repeat(32)}, clock_timestamp() - interval '10 minutes',
				clock_timestamp() - interval '1 minute'
			)
		`;
		const rejected = await push(owner.id, {
			protocolVersion: 1,
			rootEventId,
			deviceId: devices.primary,
			mutations: [
				{
					clientMutationId: mutationId(402),
					clientSequence: 1,
					kind: "attachment.commit",
					entityId: attachmentId,
					payload: { uploadId, caption: null },
				},
			],
		});
		expect(rejected.body.results[0]).toMatchObject({
			outcome: "rejected",
			error: { code: "UPLOAD_EXPIRED", retryable: false },
		});
		expect(rejected.body.nextExpectedClientSequence).toBe(2);
		const [proof] = await sql<
			{ uploadState: string; receipts: number; attachments: number }[]
		>`
			SELECT
				(SELECT state FROM event_attachment_uploads WHERE id = ${uploadId}) AS "uploadState",
				(SELECT count(*)::int FROM event_sync_mutation_receipts
					WHERE client_mutation_id = ${mutationId(402)}::uuid) AS receipts,
				(SELECT count(*)::int FROM event_attachments
					WHERE id = ${attachmentId}) AS attachments
		`;
		expect(proof).toEqual({
			uploadState: "prepared",
			receipts: 1,
			attachments: 0,
		});
	});

	test("rejects ambiguous or oversized envelopes before any idempotency claim", async () => {
		const rootEventId = "evt_syncenvelope";
		await service.createRoot(owner, rootInput(rootEventId));
		const first = feedMutation(1, "fed_syncdupe01", "first", mutationId(410));
		const second = feedMutation(1, "fed_syncdupe02", "second", mutationId(411));
		for (const [index, mutations] of [
			[first, second],
			[second, first],
		].entries()) {
			const result = await push(
				owner.id,
				{
					protocolVersion: 1,
					rootEventId,
					deviceId: devices.primary,
					mutations,
				},
				`sync-duplicate-sequence-${index}`,
			);
			expect(result.response.status).toBe(400);
			expect((result.body as unknown as ErrorBody).error.code).toBe(
				"VALIDATION_FAILED",
			);
		}
		for (const [index, mutations] of [
			[
				feedMutation(1, "fed_syncdupe03", "first", mutationId(412)),
				feedMutation(2, "fed_syncdupe04", "second", mutationId(412)),
			],
			[
				feedMutation(2, "fed_syncdupe04", "second", mutationId(412)),
				feedMutation(1, "fed_syncdupe03", "first", mutationId(412)),
			],
		].entries()) {
			const result = await push(
				owner.id,
				{
					protocolVersion: 1,
					rootEventId,
					deviceId: devices.primary,
					mutations,
				},
				`sync-duplicate-id-${index}`,
			);
			expect(result.response.status).toBe(400);
		}
		const tooMany = await push(
			owner.id,
			{
				protocolVersion: 1,
				rootEventId,
				deviceId: devices.primary,
				mutations: Array.from({ length: 101 }, (_, index) =>
					feedMutation(
						index + 1,
						`fed_synccap${index}`,
						"bounded",
						mutationId(500 + index),
					),
				),
			},
			"sync-101-mutations",
		);
		expect(tooMany.response.status).toBe(400);
		const uppercaseDevice = await push(
			owner.id,
			{
				protocolVersion: 1,
				rootEventId,
				deviceId: devices.primary.toUpperCase(),
				mutations: [
					feedMutation(1, "fed_syncupperdevice", "invalid", mutationId(620)),
				],
			},
			"sync-uppercase-device",
		);
		expect(uppercaseDevice.response.status).toBe(400);
		const uppercaseMutation = await push(
			owner.id,
			{
				protocolVersion: 1,
				rootEventId,
				deviceId: devices.primary,
				mutations: [
					feedMutation(
						1,
						"fed_syncuppermutation",
						"invalid",
						mutationId(621).toUpperCase(),
					),
				],
			},
			"sync-uppercase-mutation",
		);
		expect(uppercaseMutation.response.status).toBe(400);
		const unsafeNextSequence = await push(
			owner.id,
			{
				protocolVersion: 1,
				rootEventId,
				deviceId: devices.primary,
				mutations: [
					feedMutation(
						Number.MAX_SAFE_INTEGER,
						"fed_syncunsafesequence",
						"invalid",
						mutationId(622),
					),
				],
			},
			"sync-max-sequence",
		);
		expect(unsafeNextSequence.response.status).toBe(400);

		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(700_000).fill(120));
				controller.enqueue(new Uint8Array(700_000).fill(121));
				controller.close();
			},
		});
		const request = new Request("http://localhost/v1/sync/push", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${owner.id}`,
				"Content-Type": "application/json",
				"Content-Length": "10",
				"Idempotency-Key": "sync-chunked-oversized",
			},
			body: stream,
			duplex: "half",
		} as RequestInit & { duplex: "half" });
		const oversized = await app.fetch(request);
		expect(oversized.status).toBe(413);
		expect(oversized.headers.get("X-Request-ID")).toBeString();
		expect((await oversized.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
		const [proof] = await sql<{ idempotency: number; feeds: number }[]>`
			SELECT
				(SELECT count(*)::int FROM event_idempotency_records
					WHERE idempotency_key LIKE 'sync-%') AS idempotency,
				(SELECT count(*)::int FROM event_feed_entries
					WHERE root_event_id = ${rootEventId}
						AND kind <> 'system') AS feeds
		`;
		expect(proof).toEqual({ idempotency: 0, feeds: 0 });
	});

	test("bootstraps place visibility gains and losses across every itinerary reference", async () => {
		const rootEventId = "evt_syncplaces01";
		await service.createRoot(owner, rootInput(rootEventId));
		await addMember(rootEventId, participant.id, "participant");
		const originId = "plc_syncorigin01";
		const destinationId = "plc_syncdestination01";
		const unrelatedId = "plc_syncunrelated01";
		for (const [id, name] of [
			[originId, "Origin"],
			[destinationId, "Destination"],
			[unrelatedId, "Unrelated"],
		] as const) {
			await service.createPlace(owner, rootEventId, {
				id,
				name,
				locality: null,
				countryCode: "CH",
				latitude: null,
				longitude: null,
			});
		}
		const before = await bootstrap(participant.id, rootEventId, 200);
		expect(
			before.body.records.filter(({ entityType }) => entityType === "place"),
		).toEqual([]);

		await service.createItineraryItem(owner, rootEventId, {
			id: "iti_synctravel01",
			eventId: rootEventId,
			title: "Travel",
			notes: null,
			timeZone: "Europe/Zurich",
			startsAt: null,
			endsAt: null,
			allDay: false,
			status: "active",
			details: {
				schemaVersion: 1,
				type: "flight",
				originPlaceId: originId,
				destinationPlaceId: destinationId,
			},
			placeId: null,
		});
		await service.createItineraryItem(owner, rootEventId, {
			id: "iti_syncref02",
			eventId: rootEventId,
			title: "Origin activity",
			notes: null,
			timeZone: "Europe/Zurich",
			startsAt: null,
			endsAt: null,
			allDay: false,
			status: "active",
			details: { schemaVersion: 1, type: "activity" },
			placeId: originId,
		});
		const gained = await bootstrap(participant.id, rootEventId, 200);
		expect(
			gained.body.records
				.filter(({ entityType }) => entityType === "place")
				.map(({ entityId }) => entityId)
				.sort(),
		).toEqual([destinationId, originId].sort());
		expect(
			gained.body.records.some(({ entityId }) => entityId === unrelatedId),
		).toBe(false);
		const canonicalEvent = gained.body.records.find(
			({ entityType, entityId }) =>
				entityType === "event" && entityId === rootEventId,
		);
		expect(canonicalEvent?.data).toMatchObject({
			createdAt: expect.any(String),
			updatedAt: expect.any(String),
			deletedAt: null,
		});

		await service.updateItineraryItem(
			owner,
			rootEventId,
			"iti_synctravel01",
			1,
			{ details: { schemaVersion: 1, type: "note" } },
		);
		const oneReference = await bootstrap(participant.id, rootEventId, 200);
		expect(
			oneReference.body.records
				.filter(({ entityType }) => entityType === "place")
				.map(({ entityId }) => entityId),
		).toEqual([originId]);
		await service.updateItineraryItem(owner, rootEventId, "iti_syncref02", 1, {
			placeId: null,
		});
		const lost = await bootstrap(participant.id, rootEventId, 200);
		expect(
			lost.body.records.filter(({ entityType }) => entityType === "place"),
		).toEqual([]);
		const stale = await pull(
			participant.id,
			rootEventId,
			gained.body.syncCursor,
		);
		expect(stale.response.status).toBe(410);
	});

	test("bounds hidden-row scanning while advancing the checkpoint", async () => {
		const rootEventId = "evt_syncbudget01";
		await service.createRoot(owner, rootInput(rootEventId));
		await addMember(rootEventId, participant.id, "participant");
		const initial = await bootstrap(participant.id, rootEventId, 200);
		await sql.begin(async (transaction) => {
			const tx = transaction as unknown as Sql;
			const [root] = await tx<{ revision: string }[]>`
				SELECT revision::text AS revision FROM event_roots
				WHERE root_event_id = ${rootEventId} FOR UPDATE
			`;
			if (!root) throw new Error("root missing");
			await tx`
				INSERT INTO event_root_changes (
					root_event_id, root_revision, ordinal, entity_type, entity_id,
					operation, entity_version, data, audience
				)
				SELECT ${rootEventId}, ${root.revision}::bigint + value, 0,
					'invitation', 'inv_hidden_' || value::text, 'upsert', 1,
					jsonb_build_object('id', 'inv_hidden_' || value::text), 'managers'
				FROM generate_series(1, 2500) AS value
			`;
			await tx`
				INSERT INTO event_root_changes (
					root_event_id, root_revision, ordinal, entity_type, entity_id,
					operation, entity_version, data, audience
				) VALUES (
					${rootEventId}, ${root.revision}::bigint + 2501, 0, 'feedEntry',
					'fed_syncbudgetvisible', 'upsert', 1,
					${tx.json({ id: "fed_syncbudgetvisible" })}, 'members'
				)
			`;
			await tx`
				UPDATE event_roots SET revision = ${root.revision}::bigint + 2501
				WHERE root_event_id = ${rootEventId}
			`;
		});
		const bounded = await pull(
			participant.id,
			rootEventId,
			initial.body.syncCursor,
			1,
		);
		expect(bounded.response.status).toBe(200);
		expect((bounded.body as SyncPullResponse).changes).toEqual([]);
		expect((bounded.body as SyncPullResponse).pageInfo.hasMore).toBe(true);
		expect((bounded.body as SyncPullResponse).checkpointCursor).not.toBe(
			initial.body.syncCursor,
		);
		const visible = await pull(
			participant.id,
			rootEventId,
			(bounded.body as SyncPullResponse).checkpointCursor,
			1,
		);
		expect((visible.body as SyncPullResponse).changes).toContainEqual(
			expect.objectContaining({ entityId: "fed_syncbudgetvisible" }),
		);
	});

	test("snapshots manager-only invitations without orphan feed metadata and reuses page one", async () => {
		const rootEventId = "evt_syncsnapshot2";
		await service.createRoot(owner, rootInput(rootEventId));
		await addMember(rootEventId, participant.id, "participant");
		await service.createInvitation(owner, rootEventId, {
			id: "inv_syncsnapshot2",
			role: "participant",
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 2,
		});
		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_syncattach",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "soon removed",
		});
		await service.setFeedReaction(
			owner,
			rootEventId,
			"fed_syncattach",
			"like",
			true,
		);
		const upload = await seedPreparedUpload(rootEventId);
		await service.ensureAttachmentVerification(
			owner,
			rootEventId,
			upload.uploadId,
		);
		await sql`
			UPDATE event_attachment_verify_jobs
			SET status = 'verified', result_object_key = ${upload.committedObjectKey},
				completed_at = clock_timestamp(), updated_at = clock_timestamp()
			WHERE upload_id = ${upload.uploadId}
		`;
		await service.commitAttachment(
			owner,
			rootEventId,
			upload.uploadId,
			"orphan check",
		);
		await service.removeFeedEntry(owner, rootEventId, "fed_syncattach", 1);

		const manager = await bootstrap(owner.id, rootEventId, 200);
		const member = await bootstrap(participant.id, rootEventId, 200);
		expect(
			manager.body.records.find(
				({ entityType, entityId }) =>
					entityType === "membership" && entityId === owner.id,
			)?.data,
		).toMatchObject({
			createdAt: expect.any(String),
			updatedAt: expect.any(String),
		});
		expect(
			manager.body.records.find(
				({ entityId }) => entityId === "inv_syncsnapshot2",
			)?.data,
		).toMatchObject({
			createdAt: expect.any(String),
			updatedAt: expect.any(String),
		});
		expect(
			member.body.records.some(
				({ entityId }) => entityId === "inv_syncsnapshot2",
			),
		).toBe(false);
		for (const response of [manager.body, member.body]) {
			expect(
				response.records.some(({ entityId }) =>
					["fed_syncattach", upload.attachmentId].includes(entityId),
				),
			).toBe(false);
			expect(
				response.records.some(
					({ entityType }) => entityType === "feedReaction",
				),
			).toBe(false);
		}

		const parallel = await Promise.all(
			Array.from({ length: 12 }, () => bootstrap(owner.id, rootEventId, 1)),
		);
		expect(new Set(parallel.map(({ body }) => body.snapshotId)).size).toBe(1);
		const [snapshots] = await sql<{ count: number }[]>`
			SELECT count(*)::int AS count FROM event_sync_snapshots
			WHERE actor_id = ${owner.id} AND root_event_id = ${rootEventId}
		`;
		expect(snapshots?.count).toBe(1);
		await sql`
			UPDATE event_sync_snapshots
			SET created_at = clock_timestamp() - interval '20 minutes',
				expires_at = clock_timestamp() - interval '5 minutes 1 second'
			WHERE id = ${member.body.snapshotId}
		`;
		await sql`
			UPDATE event_memberships SET status = 'removed', version = version + 1,
				updated_at = clock_timestamp(), removed_by = ${owner.id}
			WHERE root_event_id = ${rootEventId} AND user_id = ${participant.id}
		`;
		await bootstrap(owner.id, rootEventId, 1);
		const [expiredMemberSnapshot] = await sql<{ count: number }[]>`
			SELECT count(*)::int AS count FROM event_sync_snapshots
			WHERE id = ${member.body.snapshotId}
		`;
		expect(expiredMemberSnapshot?.count).toBe(0);
	});

	test("emits the strict manager-only invitation tombstone after revoke", async () => {
		const rootEventId = "evt_syncinvite01";
		await service.createRoot(owner, rootInput(rootEventId));
		await addMember(rootEventId, participant.id, "participant");
		const managerStart = await bootstrap(owner.id, rootEventId, 200);
		const memberStart = await bootstrap(participant.id, rootEventId, 200);
		await service.createInvitation(owner, rootEventId, {
			id: "inv_syncstrict01",
			role: "participant",
			expiresAt: new Date(Date.now() + 60_000),
			maxUses: 1,
		});
		await service.revokeInvitation(owner, rootEventId, "inv_syncstrict01", 1);
		const managerChanges = await pull(
			owner.id,
			rootEventId,
			managerStart.body.syncCursor,
			20,
		);
		expect((managerChanges.body as SyncPullResponse).changes).toContainEqual(
			expect.objectContaining({
				entityType: "invitation",
				entityId: "inv_syncstrict01",
				operation: "tombstone",
				tombstone: expect.objectContaining({
					entityType: "invitation",
					id: "inv_syncstrict01",
					rootEventId,
					eventId: rootEventId,
					version: 2,
					deletedAt: expect.any(String),
				}),
			}),
		);
		const memberChanges = await pull(
			participant.id,
			rootEventId,
			memberStart.body.syncCursor,
			20,
		);
		expect((memberChanges.body as SyncPullResponse).changes).toEqual([]);
		await sql`
			DELETE FROM event_sync_snapshots
			WHERE actor_id = ${owner.id} AND root_event_id = ${rootEventId}
		`;
		const managerReset = await bootstrap(owner.id, rootEventId, 200);
		expect(
			managerReset.body.records.some(
				({ entityType, entityId }) =>
					entityType === "invitation" && entityId === "inv_syncstrict01",
			),
		).toBe(false);
	});

	test("dispatches reorder and reaction entity IDs and rolls back an attachment ID mismatch", async () => {
		const rootEventId = "evt_syncdispatch1";
		await service.createRoot(owner, rootInput(rootEventId));
		for (const [id, title] of [
			["iti_syncdispatch1", "First"],
			["iti_syncdispatch2", "Second"],
		] as const) {
			await service.createItineraryItem(owner, rootEventId, {
				id,
				eventId: rootEventId,
				title,
				notes: null,
				timeZone: "Europe/Zurich",
				startsAt: null,
				endsAt: null,
				allDay: false,
				status: "active",
				details: { schemaVersion: 1, type: "note" },
				placeId: null,
			});
		}
		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_syncattach",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "dispatch target",
		});
		const upload = await seedPreparedUpload(rootEventId);
		await service.ensureAttachmentVerification(
			owner,
			rootEventId,
			upload.uploadId,
		);
		await sql`
			UPDATE event_attachment_verify_jobs
			SET status = 'verified', result_object_key = ${upload.committedObjectKey},
				completed_at = clock_timestamp(), updated_at = clock_timestamp()
			WHERE upload_id = ${upload.uploadId}
		`;
		const root = await service.getEvent(owner, rootEventId, rootEventId);
		const result = await push(owner.id, {
			protocolVersion: 1,
			rootEventId,
			deviceId: devices.primary,
			mutations: [
				{
					clientMutationId: mutationId(701),
					clientSequence: 1,
					kind: "itinerary.reorder",
					entityId: rootEventId,
					baseVersion: root.itineraryOrderVersion,
					payload: {
						orderedIds: ["iti_syncdispatch2", "iti_syncdispatch1"],
					},
				},
				{
					clientMutationId: mutationId(702),
					clientSequence: 2,
					kind: "feed.reaction.set",
					entityId: "fed_syncattach",
					payload: { reaction: "love", present: true },
				},
				{
					clientMutationId: mutationId(703),
					clientSequence: 3,
					kind: "attachment.commit",
					entityId: "att_syncwrong001",
					payload: { uploadId: upload.uploadId, caption: "wrong binding" },
				},
			],
		});
		expect(result.body.results.map(({ outcome }) => outcome)).toEqual([
			"applied",
			"applied",
			"rejected",
		]);
		expect(result.body.results[2]?.error?.code).toBe("ATTACHMENT_ID_MISMATCH");
		const reactionEntityId = result.body.results[1]?.entity?.entityId;
		expect(reactionEntityId).toMatch(/^fer_[a-f0-9]{64}$/);
		const reactionSnapshot = await bootstrap(owner.id, rootEventId, 200);
		expect(
			reactionSnapshot.body.records.find(
				({ entityType }) => entityType === "feedReaction",
			)?.entityId,
		).toBe(reactionEntityId);
		const [proof] = await sql<
			{
				orderedIds: string[];
				reactions: number;
				attachments: number;
				uploadState: string;
			}[]
		>`
			SELECT
				ARRAY(
					SELECT id FROM event_itinerary_items
					WHERE root_event_id = ${rootEventId}
					ORDER BY sort_position, id
				) AS "orderedIds",
				(SELECT count(*)::int FROM event_feed_reactions
					WHERE root_event_id = ${rootEventId} AND entry_id = 'fed_syncattach'
						AND reaction = 'love' AND present) AS reactions,
				(SELECT count(*)::int FROM event_attachments
					WHERE upload_id = ${upload.uploadId}) AS attachments,
				(SELECT state FROM event_attachment_uploads
					WHERE id = ${upload.uploadId}) AS "uploadState"
		`;
		expect(proof).toEqual({
			orderedIds: ["iti_syncdispatch2", "iti_syncdispatch1"],
			reactions: 1,
			attachments: 0,
			uploadState: "prepared",
		});
	});

	test("lets current managers replace a strict golf round through the single sync stream", async () => {
		const rootEventId = "evt_syncgolfround";
		const otherRootEventId = "evt_syncgolfother";
		await service.createRoot(owner, {
			...rootInput(rootEventId),
			kind: "golf",
		});
		await service.createRoot(owner, {
			...rootInput(otherRootEventId),
			kind: "golf",
		});
		await addMember(rootEventId, organizer.id, "organizer");
		await addMember(rootEventId, participant.id, "participant");
		await addMember(rootEventId, viewer.id, "viewer");
		await addMember(rootEventId, removedGolfer.id, "participant");
		await service.updateMembership(
			owner,
			rootEventId,
			removedGolfer.id,
			1,
			"participant",
			"removed",
			"golf setup eligibility fixture",
		);
		await service.replaceCapability(owner, rootEventId, rootEventId, 0, {
			type: "golf",
			schemaVersion: 1,
			config: {
				coursePlaceId: null,
				teeFormat: "individual",
				handicapMode: "required",
				scoringMode: "stableford",
				roundState: "open",
			},
		});
		const setup = golfRoundSetup();
		const absentVersion = await push(owner.id, {
			protocolVersion: 1,
			rootEventId,
			deviceId: devices.primary,
			mutations: [
				{
					clientMutationId: mutationId(720),
					clientSequence: 1,
					kind: "golf.round.replace",
					entityId: rootEventId,
					baseVersion: 1,
					payload: { eventId: rootEventId, ...setup },
				},
			],
		});
		expect(absentVersion.body.results[0]).toMatchObject({
			outcome: "rejected",
			error: { code: "VERSION_CONFLICT", currentVersion: 0 },
		});

		const createMutation: SyncMutation = {
			clientMutationId: mutationId(721),
			clientSequence: 2,
			kind: "golf.round.replace",
			entityId: rootEventId,
			baseVersion: 0,
			payload: { eventId: rootEventId, ...setup },
		};
		const createInput: SyncPushInput = {
			protocolVersion: 1,
			rootEventId,
			deviceId: devices.primary,
			mutations: [createMutation],
		};
		const created = await push(owner.id, createInput, "sync-golf-round-create");
		expect(created.response.status).toBe(200);
		expect(created.body.results[0]).toMatchObject({
			outcome: "applied",
			replayed: false,
			entity: {
				entityType: "golfRound",
				entityId: rootEventId,
				version: 1,
			},
		});
		const mutationReplay = await push(
			owner.id,
			createInput,
			"sync-golf-round-mutation-replay",
		);
		expect(mutationReplay.body.results[0]).toMatchObject({
			outcome: "applied",
			replayed: true,
			entity: { entityType: "golfRound", entityId: rootEventId, version: 1 },
		});

		const semanticReplay = await push(owner.id, {
			...createInput,
			deviceId: devices.second,
			mutations: [
				{
					...createMutation,
					clientMutationId: mutationId(722),
					clientSequence: 1,
				},
			],
		});
		expect(semanticReplay.body.results[0]).toMatchObject({
			outcome: "applied",
			replayed: false,
			rootRevision: created.body.results[0]?.rootRevision,
			entity: { entityType: "golfRound", entityId: rootEventId, version: 1 },
		});
		const ownerBeforeReplace = await bootstrap(owner.id, rootEventId, 200);
		const ownerGolfRecords = ownerBeforeReplace.body.records.filter(
			({ entityType }) => entityType.startsWith("golf"),
		);
		expect(ownerGolfRecords.map(({ entityType }) => entityType)).toEqual([
			"golfLeaderboard",
			"golfPlayer",
			"golfRoster",
			"golfRound",
		]);
		const ownerRoster = ownerGolfRecords.find(
			({ entityType }) => entityType === "golfRoster",
		);
		expect(ownerRoster).toMatchObject({
			entityId: `gro_${rootEventId}`,
			entityVersion: 1,
			data: { eventId: rootEventId, version: 1 },
		});
		const rosterPlayers = ownerRoster
			? (
					ownerRoster.data as {
						players?: { userId: string; playingHandicap: number }[];
					}
				).players
			: undefined;
		expect([...(rosterPlayers ?? [])].sort(compareGolfPlayers)).toEqual(
			[...setup.players].sort(compareGolfPlayers),
		);
		const participantBeforeReplace = await bootstrap(
			participant.id,
			rootEventId,
			200,
		);
		expect(
			participantBeforeReplace.body.records.some(
				({ entityType }) => entityType === "golfRoster",
			),
		).toBe(false);
		expect(
			participantBeforeReplace.body.records.find(
				({ entityType }) => entityType === "golfPlayer",
			)?.data,
		).toMatchObject({ userId: participant.id, playingHandicap: 18 });
		for (const [ineligibleUser, device, id] of [
			[viewer, syncDeviceId(10), 741],
			[removedGolfer, syncDeviceId(11), 742],
		] as const) {
			const ineligible = await push(owner.id, {
				...createInput,
				deviceId: device,
				mutations: [
					{
						...createMutation,
						clientMutationId: mutationId(id),
						clientSequence: 1,
						baseVersion: 1,
						payload: {
							eventId: rootEventId,
							...setup,
							players: [
								...setup.players,
								{ userId: ineligibleUser.id, playingHandicap: 12 },
							],
						},
					},
				],
			});
			expect(ineligible.body.results[0]).toMatchObject({
				outcome: "rejected",
				error: { code: "GOLF_PLAYERS_INVALID" },
			});
		}

		const organizerSetup: GolfRoundSetupInput = {
			...setup,
			teams: setup.teams.map((team) => ({
				...team,
				name: "Flight Zürich",
				color: "#0066FF",
			})),
		};
		const organizerMutation: SyncMutation = {
			clientMutationId: mutationId(723),
			clientSequence: 1,
			kind: "golf.round.replace",
			entityId: rootEventId,
			baseVersion: 1,
			payload: { eventId: rootEventId, ...organizerSetup },
		};
		const organizerInput: SyncPushInput = {
			protocolVersion: 1,
			rootEventId,
			deviceId: devices.third,
			mutations: [organizerMutation],
		};
		const organizerApplied = await push(
			organizer.id,
			organizerInput,
			"sync-golf-round-organizer",
		);
		expect(organizerApplied.body.results[0]).toMatchObject({
			outcome: "applied",
			replayed: false,
			entity: { entityType: "golfRound", entityId: rootEventId, version: 2 },
		});
		const managerChanges = await pull(
			owner.id,
			rootEventId,
			ownerBeforeReplace.body.syncCursor,
		);
		expect(
			(managerChanges.body as SyncPullResponse).changes.map(
				({ entityType }) => entityType,
			),
		).toEqual(["golfRound", "golfLeaderboard", "golfRoster"]);
		expect(
			(managerChanges.body as SyncPullResponse).changes.find(
				({ entityType }) => entityType === "golfRoster",
			),
		).toMatchObject({
			entityId: `gro_${rootEventId}`,
			entityVersion: 2,
			data: { version: 2 },
		});
		const pulledRosterChange = (
			managerChanges.body as SyncPullResponse
		).changes.find(
			(change) =>
				change.entityType === "golfRoster" && change.operation === "upsert",
		);
		const pulledRoster = (
			(pulledRosterChange?.operation === "upsert"
				? pulledRosterChange.data
				: undefined) as
				| { players: { userId: string; playingHandicap: number }[] }
				| undefined
		)?.players;
		expect([...(pulledRoster ?? [])].sort(compareGolfPlayers)).toEqual(
			[...setup.players].sort(compareGolfPlayers),
		);
		const participantRoundChanges = await pull(
			participant.id,
			rootEventId,
			participantBeforeReplace.body.syncCursor,
		);
		expect(
			(participantRoundChanges.body as SyncPullResponse).changes.map(
				({ entityType }) => entityType,
			),
		).toEqual(["golfRound", "golfLeaderboard"]);

		const stale = await push(owner.id, {
			...createInput,
			mutations: [
				{
					...organizerMutation,
					clientMutationId: mutationId(724),
					clientSequence: 3,
					payload: {
						eventId: rootEventId,
						...organizerSetup,
						teams: organizerSetup.teams.map((team) => ({
							...team,
							name: "Stale Flight",
						})),
					},
				},
			],
		});
		expect(stale.body.results[0]).toMatchObject({
			outcome: "rejected",
			error: { code: "VERSION_CONFLICT", currentVersion: 2 },
		});

		for (const [actor, device, id] of [
			[participant, syncDeviceId(4), 725],
			[viewer, syncDeviceId(5), 726],
		] as const) {
			const forbidden = await push(actor.id, {
				...organizerInput,
				deviceId: device,
				mutations: [
					{
						...organizerMutation,
						clientMutationId: mutationId(id),
					},
				],
			});
			expect(forbidden.body.results[0]).toMatchObject({
				outcome: "rejected",
				error: { code: "FORBIDDEN" },
			});
		}

		const entitySpoof = await push(owner.id, {
			...organizerInput,
			deviceId: syncDeviceId(6),
			mutations: [
				{
					...organizerMutation,
					clientMutationId: mutationId(727),
					entityId: otherRootEventId,
				},
			],
		});
		expect(entitySpoof.body.results[0]).toMatchObject({
			outcome: "rejected",
			error: { code: "SYNC_ENTITY_ID_MISMATCH" },
		});
		const rootSpoof = await push(owner.id, {
			...organizerInput,
			deviceId: syncDeviceId(7),
			mutations: [
				{
					...organizerMutation,
					clientMutationId: mutationId(728),
					entityId: otherRootEventId,
					payload: { eventId: otherRootEventId, ...organizerSetup },
				},
			],
		});
		expect(rootSpoof.body.results[0]).toMatchObject({
			outcome: "rejected",
			error: { code: "NOT_FOUND" },
		});
		const concealed = await push(outsider.id, {
			...organizerInput,
			deviceId: syncDeviceId(8),
			mutations: [
				{
					...organizerMutation,
					clientMutationId: mutationId(729),
				},
			],
		});
		expect(concealed.response.status).toBe(404);

		const invalidTeam = await push(
			owner.id,
			{
				...organizerInput,
				deviceId: syncDeviceId(9),
				mutations: [
					{
						...organizerMutation,
						clientMutationId: mutationId(730),
						payload: {
							eventId: rootEventId,
							...organizerSetup,
							teams: [
								{
									...organizerSetup.teams[0],
									memberUserIds: [
										owner.id,
										organizer.id,
										participant.id,
										viewer.id,
										outsider.id,
									],
								},
							],
						},
					},
				],
			},
			"sync-golf-round-max-four",
		);
		expect(invalidTeam.response.status).toBe(400);
		expect((invalidTeam.body as unknown as ErrorBody).error.code).toBe(
			"VALIDATION_FAILED",
		);
		const invalidSetups: GolfRoundSetupInput[] = [
			{
				...organizerSetup,
				holes: organizerSetup.holes.map((hole, index) =>
					index === 17 ? { ...hole, hole: 1 } : hole,
				),
			},
			{
				...organizerSetup,
				holes: organizerSetup.holes.map((hole, index) =>
					index === 17 ? { ...hole, strokeIndex: 1 } : hole,
				),
			},
			{
				...organizerSetup,
				teams: [
					{
						id: "gtm_sync_duplicate_a",
						name: "Duplicate A",
						color: null,
						memberUserIds: [owner.id, participant.id],
					},
					{
						id: "gtm_sync_duplicate_b",
						name: "Duplicate B",
						color: null,
						memberUserIds: [participant.id, organizer.id],
					},
				],
			},
		];
		for (const [index, invalidSetup] of invalidSetups.entries()) {
			const invalid = await push(
				owner.id,
				{
					...organizerInput,
					deviceId: syncDeviceId(12 + index),
					mutations: [
						{
							...organizerMutation,
							clientMutationId: mutationId(743 + index),
							payload: { eventId: rootEventId, ...invalidSetup },
						},
					],
				},
				`sync-golf-round-invalid-shape-${index}`,
			);
			expect(invalid.response.status).toBe(400);
			expect((invalid.body as unknown as ErrorBody).error.code).toBe(
				"VALIDATION_FAILED",
			);
		}

		const participantSnapshot = participantBeforeReplace;
		const golfRecords = participantSnapshot.body.records.filter(
			({ entityType }) => entityType.startsWith("golf"),
		);
		expect(golfRecords.map(({ entityType }) => entityType)).toEqual([
			"golfLeaderboard",
			"golfPlayer",
			"golfRound",
		]);
		const roundRecord = golfRecords.find(
			({ entityType }) => entityType === "golfRound",
		);
		expect(roundRecord).toMatchObject({
			entityVersion: 1,
			data: {
				eventId: rootEventId,
				teams: [{ name: "Flight Alpha" }],
			},
		});
		const roundData = roundRecord?.data as
			| {
					holes: unknown[];
					teams: { memberUserIds: string[] }[];
			  }
			| undefined;
		expect(roundData?.holes).toHaveLength(18);
		expect([...(roundData?.teams[0]?.memberUserIds ?? [])].sort()).toEqual(
			[owner.id, organizer.id, participant.id].sort(),
		);
		const viewerSnapshot = await bootstrap(viewer.id, rootEventId, 200);
		expect(
			viewerSnapshot.body.records.some(
				({ entityType }) =>
					entityType === "golfPlayer" || entityType === "golfScore",
			),
		).toBe(false);
		const [proof] = await sql<
			{ version: number; ownerHandicap: number; teamMembers: number }[]
		>`
			SELECT
				(SELECT version FROM event_golf_rounds
					WHERE root_event_id = ${rootEventId} AND event_id = ${rootEventId}) AS version,
				(SELECT playing_handicap FROM event_golf_round_players
					WHERE root_event_id = ${rootEventId} AND event_id = ${rootEventId}
						AND user_id = ${owner.id}) AS "ownerHandicap",
				(SELECT count(*)::int FROM event_golf_round_team_members
					WHERE root_event_id = ${rootEventId} AND event_id = ${rootEventId}) AS "teamMembers"
		`;
		expect(proof).toEqual({ version: 2, ownerHandicap: -2, teamMembers: 3 });

		const participantRemoval = await push(owner.id, {
			protocolVersion: 1,
			rootEventId,
			deviceId: syncDeviceId(30),
			mutations: [
				{
					clientMutationId: mutationId(748),
					clientSequence: 1,
					kind: "golf.round.replace",
					entityId: rootEventId,
					baseVersion: 2,
					payload: {
						eventId: rootEventId,
						...organizerSetup,
						players: organizerSetup.players.filter(
							({ userId }) => userId !== participant.id,
						),
						teams: organizerSetup.teams.map((team) => ({
							...team,
							memberUserIds: team.memberUserIds.filter(
								(userId) => userId !== participant.id,
							),
						})),
					},
				},
			],
		});
		expect(participantRemoval.body.results[0]).toMatchObject({
			outcome: "applied",
			entity: { entityType: "golfRound", entityId: rootEventId, version: 3 },
		});
		const participantRemovalPull = await pull(
			participant.id,
			rootEventId,
			(participantRoundChanges.body as SyncPullResponse).checkpointCursor,
		);
		expect(
			(participantRemovalPull.body as SyncPullResponse).changes.map(
				({ entityType }) => entityType,
			),
		).toEqual(["golfRound", "golfLeaderboard", "golfPlayer"]);
		const playerTombstone = (
			participantRemovalPull.body as SyncPullResponse
		).changes.find(({ entityType }) => entityType === "golfPlayer");
		expect(playerTombstone).toMatchObject({
			entityType: "golfPlayer",
			entityId: golfPlayerEntityId(rootEventId, participant.id),
			entityVersion: 3,
			operation: "tombstone",
			tombstone: {
				entityType: "golfPlayer",
				id: golfPlayerEntityId(rootEventId, participant.id),
				rootEventId,
				eventId: rootEventId,
				version: 3,
			},
		});

		await service.updateMembership(
			owner,
			rootEventId,
			organizer.id,
			1,
			"participant",
			"active",
			"golf round replay guard",
		);
		const receiptAfterDemotion = await push(
			organizer.id,
			organizerInput,
			"sync-golf-round-demoted-receipt",
		);
		expect(receiptAfterDemotion.response.status).toBe(403);
		expect((receiptAfterDemotion.body as unknown as ErrorBody).error.code).toBe(
			"FORBIDDEN",
		);
		const httpAfterDemotion = await push(
			organizer.id,
			organizerInput,
			"sync-golf-round-organizer",
		);
		expect(httpAfterDemotion.response.status).toBe(403);
		expect((httpAfterDemotion.body as unknown as ErrorBody).error.code).toBe(
			"FORBIDDEN",
		);
		await service.updateMembership(
			owner,
			rootEventId,
			organizer.id,
			2,
			"viewer",
			"active",
			"golf round replay guard viewer",
		);
		const [viewerTombstone] = await sql<
			{ audience: string; audienceUserId: string; entityVersion: number }[]
		>`
			SELECT audience, audience_user_id AS "audienceUserId",
				entity_version AS "entityVersion"
			FROM event_root_changes
			WHERE root_event_id = ${rootEventId}
				AND entity_type = 'golfPlayer'
				AND entity_id = ${golfPlayerEntityId(rootEventId, organizer.id)}
				AND operation = 'tombstone'
			ORDER BY root_revision DESC, ordinal DESC LIMIT 1
		`;
		expect(viewerTombstone).toEqual({
			audience: "actor",
			audienceUserId: organizer.id,
			entityVersion: 4,
		});
		const organizerViewerSnapshot = await bootstrap(
			organizer.id,
			rootEventId,
			200,
		);
		expect(
			organizerViewerSnapshot.body.records.some(
				({ entityType }) =>
					entityType === "golfPlayer" || entityType === "golfScore",
			),
		).toBe(false);
		const viewerReplay = await push(
			organizer.id,
			organizerInput,
			"sync-golf-round-organizer",
		);
		expect(viewerReplay.response.status).toBe(403);
		await sql`
			UPDATE events SET status = 'archived', version = version + 1,
				updated_at = clock_timestamp()
			WHERE root_event_id = ${rootEventId} AND id = ${rootEventId}
		`;
		const archivedReplay = await push(
			owner.id,
			createInput,
			"sync-golf-round-archived-receipt",
		);
		expect(archivedReplay.response.status).toBe(409);
		expect((archivedReplay.body as unknown as ErrorBody).error.code).toBe(
			"GOLF_ROUND_NOT_WRITABLE",
		);
	});

	test("applies actor-owned golf scores through the single sync stream and converges private scores with the shared board", async () => {
		const rootEventId = "evt_syncgolf001";
		await service.createRoot(owner, {
			...rootInput(rootEventId),
			kind: "golf",
		});
		await addMember(rootEventId, participant.id, "participant");
		await addMember(rootEventId, viewer.id, "viewer");
		await service.replaceCapability(owner, rootEventId, rootEventId, 0, {
			type: "golf",
			schemaVersion: 1,
			config: {
				coursePlaceId: null,
				teeFormat: "individual",
				handicapMode: "required",
				scoringMode: "stableford",
				roundState: "open",
			},
		});
		const round: GolfRoundSetupInput = {
			holes: Array.from({ length: 18 }, (_, index) => ({
				hole: index + 1,
				par: 4,
				strokeIndex: index + 1,
			})),
			players: [
				{ userId: owner.id, playingHandicap: -2 },
				{ userId: participant.id, playingHandicap: 18 },
			],
			teams: [
				{
					id: "gtm_sync_alpha",
					name: "Flight Alpha",
					color: "#00AA55",
					memberUserIds: [owner.id, participant.id],
				},
			],
		};
		const roundApplied = await push(owner.id, {
			protocolVersion: 1,
			rootEventId,
			deviceId: devices.primary,
			mutations: [
				{
					clientMutationId: mutationId(739),
					clientSequence: 1,
					kind: "golf.round.replace",
					entityId: rootEventId,
					baseVersion: 0,
					payload: { eventId: rootEventId, ...round },
				},
			],
		});
		expect(roundApplied.body.results[0]).toMatchObject({
			outcome: "applied",
			entity: { entityType: "golfRound", entityId: rootEventId, version: 1 },
		});

		const participantSnapshot = await bootstrap(
			participant.id,
			rootEventId,
			200,
		);
		expect(participantSnapshot.response.status).toBe(200);
		const snapshotKeys = participantSnapshot.body.records.map(
			(record) => `${record.entityType}:${record.entityId}`,
		);
		expect(snapshotKeys).toEqual([...snapshotKeys].sort());
		expect(
			participantSnapshot.body.records
				.filter(({ entityType }) => entityType.startsWith("golf"))
				.map(({ entityType }) => entityType),
		).toEqual(["golfLeaderboard", "golfPlayer", "golfRound"]);
		expect(
			participantSnapshot.body.records.find(
				({ entityType }) => entityType === "golfPlayer",
			)?.data,
		).toMatchObject({
			userId: participant.id,
			playingHandicap: 18,
		});
		const viewerSnapshot = await bootstrap(viewer.id, rootEventId, 200);
		expect(
			viewerSnapshot.body.records.some(
				({ entityType }) =>
					entityType === "golfPlayer" || entityType === "golfScore",
			),
		).toBe(false);

		const scoreId = golfScoreEntityId(rootEventId, participant.id, 1);
		const scoreMutation: SyncMutation = {
			clientMutationId: mutationId(730),
			clientSequence: 1,
			kind: "golf.score.set",
			entityId: scoreId,
			baseVersion: 0,
			payload: { eventId: rootEventId, hole: 1, strokes: 4, putts: 2 },
		};
		const scoreEnvelope: SyncPushInput = {
			protocolVersion: 1,
			rootEventId,
			deviceId: devices.primary,
			mutations: [scoreMutation],
		};
		const applied = await push(
			participant.id,
			scoreEnvelope,
			"sync-golf-score-applied",
		);
		expect(applied.response.status).toBe(200);
		expect(applied.body.results[0]).toMatchObject({
			outcome: "applied",
			replayed: false,
			entity: { entityType: "golfScore", entityId: scoreId, version: 1 },
		});
		expect(applied.body.nextExpectedClientSequence).toBe(2);
		const replay = await push(participant.id, scoreEnvelope);
		expect(replay.body.results[0]).toMatchObject({
			outcome: "applied",
			replayed: true,
			entity: { entityType: "golfScore", entityId: scoreId, version: 1 },
		});
		const scoreImpactReplacement = await push(owner.id, {
			protocolVersion: 1,
			rootEventId,
			deviceId: devices.second,
			mutations: [
				{
					clientMutationId: mutationId(747),
					clientSequence: 1,
					kind: "golf.round.replace",
					entityId: rootEventId,
					baseVersion: 1,
					payload: {
						eventId: rootEventId,
						...round,
						players: round.players.map((player) =>
							player.userId === participant.id
								? { ...player, playingHandicap: 17 }
								: player,
						),
					},
				},
			],
		});
		expect(scoreImpactReplacement.body.results[0]).toMatchObject({
			outcome: "rejected",
			error: { code: "GOLF_ROUND_IMPACT_REVIEW_REQUIRED" },
		});

		const participantChanges = await pull(
			participant.id,
			rootEventId,
			participantSnapshot.body.syncCursor,
		);
		expect(participantChanges.response.status).toBe(200);
		expect(
			(participantChanges.body as SyncPullResponse).changes.map(
				({ entityType }) => entityType,
			),
		).toEqual(["golfScore", "golfLeaderboard"]);
		const viewerChanges = await pull(
			viewer.id,
			rootEventId,
			viewerSnapshot.body.syncCursor,
		);
		expect(viewerChanges.response.status).toBe(200);
		expect(
			(viewerChanges.body as SyncPullResponse).changes.map(
				({ entityType }) => entityType,
			),
		).toEqual(["golfLeaderboard"]);
		const [stored] = await sql<
			{
				userId: string;
				playingHandicap: number;
				handicapStrokes: number;
				stablefordPoints: number;
			}[]
		>`
			SELECT user_id AS "userId", playing_handicap AS "playingHandicap",
				handicap_strokes AS "handicapStrokes",
				stableford_points AS "stablefordPoints"
			FROM event_golf_scores WHERE id = ${scoreId}
		`;
		expect(stored).toEqual({
			userId: participant.id,
			playingHandicap: 18,
			handicapStrokes: 1,
			stablefordPoints: 3,
		});

		const conflict = await push(participant.id, {
			...scoreEnvelope,
			mutations: [
				{
					...scoreMutation,
					clientMutationId: mutationId(731),
					clientSequence: 2,
					payload: { eventId: rootEventId, hole: 1, strokes: 5, putts: 2 },
				},
			],
		});
		expect(conflict.body.results[0]).toMatchObject({
			outcome: "rejected",
			error: { code: "VERSION_CONFLICT", currentVersion: 1 },
		});
		const missingConflict = await push(participant.id, {
			...scoreEnvelope,
			mutations: [
				{
					clientMutationId: mutationId(732),
					clientSequence: 3,
					kind: "golf.score.set",
					entityId: golfScoreEntityId(rootEventId, participant.id, 2),
					baseVersion: 1,
					payload: { eventId: rootEventId, hole: 2, strokes: 4, putts: 2 },
				},
			],
		});
		expect(missingConflict.body.results[0]).toMatchObject({
			outcome: "rejected",
			error: { code: "VERSION_CONFLICT", currentVersion: 0 },
		});

		const spoofed = await push(participant.id, {
			...scoreEnvelope,
			deviceId: devices.second,
			mutations: [
				{
					...scoreMutation,
					clientMutationId: mutationId(733),
					entityId: golfScoreEntityId(rootEventId, owner.id, 1),
				},
			],
		});
		expect(spoofed.body.results[0]).toMatchObject({
			outcome: "rejected",
			error: { code: "SYNC_ENTITY_ID_MISMATCH" },
		});
		const forbidden = await push(viewer.id, {
			...scoreEnvelope,
			deviceId: devices.third,
			mutations: [
				{
					...scoreMutation,
					clientMutationId: mutationId(734),
					entityId: golfScoreEntityId(rootEventId, viewer.id, 1),
				},
			],
		});
		expect(forbidden.body.results[0]).toMatchObject({
			outcome: "rejected",
			error: { code: "FORBIDDEN" },
		});
		const concealed = await push(outsider.id, {
			...scoreEnvelope,
			deviceId: devices.third,
			mutations: [
				{
					...scoreMutation,
					clientMutationId: mutationId(735),
					entityId: golfScoreEntityId(rootEventId, outsider.id, 1),
				},
			],
		});
		expect(concealed.response.status).toBe(404);
		const clientCalculated = await push(
			participant.id,
			{
				...scoreEnvelope,
				deviceId: devices.second,
				mutations: [
					{
						...scoreMutation,
						clientMutationId: mutationId(736),
						payload: {
							eventId: rootEventId,
							hole: 1,
							strokes: 4,
							putts: 2,
							userId: participant.id,
							playingHandicap: 18,
							stablefordPoints: 3,
						},
					},
				],
			},
			"sync-golf-no-client-calculation",
		);
		expect(clientCalculated.response.status).toBe(400);
		expect((clientCalculated.body as unknown as ErrorBody).error.code).toBe(
			"VALIDATION_FAILED",
		);
		await sql`
			UPDATE event_capabilities
			SET config = jsonb_set(config, '{roundState}', '"closed"'::jsonb),
				updated_at = clock_timestamp()
			WHERE root_event_id = ${rootEventId} AND event_id = ${rootEventId}
				AND capability_type = 'golf'
		`;
		const closedReceiptReplay = await push(
			participant.id,
			scoreEnvelope,
			"sync-golf-score-closed-receipt",
		);
		expect(closedReceiptReplay.response.status).toBe(409);
		expect((closedReceiptReplay.body as unknown as ErrorBody).error.code).toBe(
			"GOLF_ROUND_NOT_OPEN",
		);
		const closedHttpReplay = await push(
			participant.id,
			scoreEnvelope,
			"sync-golf-score-applied",
		);
		expect(closedHttpReplay.response.status).toBe(409);
		await sql`
			UPDATE event_capabilities
			SET config = jsonb_set(config, '{roundState}', '"open"'::jsonb),
				updated_at = clock_timestamp()
			WHERE root_event_id = ${rootEventId} AND event_id = ${rootEventId}
				AND capability_type = 'golf'
		`;
		await service.updateMembership(
			owner,
			rootEventId,
			participant.id,
			1,
			"viewer",
			"active",
			"golf score replay guard",
		);
		const demotedReceiptReplay = await push(
			participant.id,
			scoreEnvelope,
			"sync-golf-score-demoted-receipt",
		);
		expect(demotedReceiptReplay.response.status).toBe(403);
		const demotedHttpReplay = await push(
			participant.id,
			scoreEnvelope,
			"sync-golf-score-applied",
		);
		expect(demotedHttpReplay.response.status).toBe(403);
		await service.updateMembership(
			owner,
			rootEventId,
			participant.id,
			2,
			"participant",
			"active",
			"restore player policy fixture",
		);
		await sql`
			DELETE FROM event_golf_scores
			WHERE root_event_id = ${rootEventId} AND event_id = ${rootEventId}
				AND user_id = ${participant.id}
		`;
		await sql`
			DELETE FROM event_golf_round_players
			WHERE root_event_id = ${rootEventId} AND event_id = ${rootEventId}
				AND user_id = ${participant.id}
		`;
		const missingPlayerReplay = await push(
			participant.id,
			scoreEnvelope,
			"sync-golf-score-missing-player",
		);
		expect(missingPlayerReplay.response.status).toBe(404);
		expect((missingPlayerReplay.body as unknown as ErrorBody).error.code).toBe(
			"NOT_FOUND",
		);
	});

	test("serializes stale edits, returns authoritative order, and never resurrects tombstones", async () => {
		const rootEventId = "evt_syncrace001";
		const childEventId = "evt_syncracechild";
		await service.createRoot(owner, rootInput(rootEventId));
		await service.createEvent(owner, rootEventId, rootEventId, {
			...rootInput(childEventId),
			kind: "activity",
			title: "Original",
		});
		const devicesForRace = [devices.primary, devices.second] as const;
		const edits = await Promise.all(
			devicesForRace.map((deviceId, index) =>
				push(owner.id, {
					protocolVersion: 1,
					rootEventId,
					deviceId,
					mutations: [
						{
							clientMutationId: mutationId(710 + index),
							clientSequence: 1,
							kind: "event.update",
							entityId: childEventId,
							baseVersion: 1,
							payload: { changes: { title: `Winner ${index}` } },
						},
					],
				}),
			),
		);
		expect(edits.map(({ body }) => body.results[0]?.outcome).sort()).toEqual([
			"applied",
			"rejected",
		]);
		const rejected = edits.find(
			({ body }) => body.results[0]?.outcome === "rejected",
		);
		expect(rejected?.body.results[0]?.error).toMatchObject({
			code: "VERSION_CONFLICT",
			currentVersion: 2,
		});
		const winnerIndex = edits.findIndex(
			({ body }) => body.results[0]?.outcome === "applied",
		);
		const winnerDevice = devicesForRace[winnerIndex] as string;
		const [storedEdit] = await sql<{ title: string; version: number }[]>`
			SELECT title, version FROM events WHERE id = ${childEventId}
		`;
		expect(storedEdit).toEqual({
			title: `Winner ${winnerIndex}`,
			version: 2,
		});

		const secondChildId = "evt_syncracesecond";
		await service.createEvent(owner, rootEventId, rootEventId, {
			...rootInput(secondChildId),
			kind: "activity",
			title: "Second",
		});
		const parent = await service.getEvent(owner, rootEventId, rootEventId);
		const staleOrder = await push(owner.id, {
			protocolVersion: 1,
			rootEventId,
			deviceId: devices.third,
			mutations: [
				{
					clientMutationId: mutationId(720),
					clientSequence: 1,
					kind: "event.children.reorder",
					entityId: rootEventId,
					baseVersion: parent.childOrderVersion - 1,
					payload: { orderedIds: [secondChildId, childEventId] },
				},
			],
		});
		expect(staleOrder.body.results[0]).toMatchObject({
			outcome: "rejected",
			error: {
				code: "VERSION_CONFLICT",
				authoritativeOrder: [childEventId, secondChildId],
			},
		});
		const validOrder = await push(owner.id, {
			protocolVersion: 1,
			rootEventId,
			deviceId: devices.third,
			mutations: [
				{
					clientMutationId: mutationId(721),
					clientSequence: 2,
					kind: "event.children.reorder",
					entityId: rootEventId,
					baseVersion: parent.childOrderVersion,
					payload: { orderedIds: [secondChildId, childEventId] },
				},
			],
		});
		expect(validOrder.body.results[0]?.outcome).toBe("applied");

		const deleted = await push(owner.id, {
			protocolVersion: 1,
			rootEventId,
			deviceId: winnerDevice,
			mutations: [
				{
					clientMutationId: mutationId(722),
					clientSequence: 2,
					kind: "event.delete",
					entityId: childEventId,
					baseVersion: 3,
					payload: { subtree: false },
				},
			],
		});
		expect(deleted.body.results[0]?.outcome).toBe("applied");
		const resurrection = await push(owner.id, {
			protocolVersion: 1,
			rootEventId,
			deviceId: winnerDevice,
			mutations: [
				{
					clientMutationId: mutationId(723),
					clientSequence: 3,
					kind: "event.update",
					entityId: childEventId,
					baseVersion: 4,
					payload: { changes: { title: "Resurrected" } },
				},
			],
		});
		expect(resurrection.body.results[0]).toMatchObject({
			outcome: "rejected",
			error: { code: "ENTITY_DELETED" },
		});
		const duplicateDelete = await push(owner.id, {
			protocolVersion: 1,
			rootEventId,
			deviceId: winnerDevice,
			mutations: [
				{
					clientMutationId: mutationId(724),
					clientSequence: 4,
					kind: "event.delete",
					entityId: childEventId,
					baseVersion: 3,
					payload: { subtree: false },
				},
			],
		});
		expect(duplicateDelete.body.results[0]).toMatchObject({
			outcome: "applied",
			rootRevision: deleted.body.results[0]?.rootRevision,
		});
		const [proof] = await sql<
			{
				title: string;
				deleted: boolean;
				tombstones: number;
				orderedIds: string[];
			}[]
		>`
			SELECT
				(SELECT title FROM events WHERE id = ${childEventId}) AS title,
				(SELECT deleted_at IS NOT NULL FROM events WHERE id = ${childEventId}) AS deleted,
				(SELECT count(*)::int FROM event_root_changes
					WHERE root_event_id = ${rootEventId} AND entity_id = ${childEventId}
						AND operation = 'tombstone') AS tombstones,
				ARRAY(
					SELECT id FROM events WHERE root_event_id = ${rootEventId}
						AND parent_event_id = ${rootEventId} AND deleted_at IS NULL
					ORDER BY sort_position, id
				) AS "orderedIds"
		`;
		expect(proof).toEqual({
			title: `Winner ${winnerIndex}`,
			deleted: true,
			tombstones: 1,
			orderedIds: [secondChildId],
		});
	});
});

type ErrorBody = {
	error: { code: string; retryable: boolean };
};

function rootInput(id: string): EventInput {
	return {
		id,
		kind: "team_event",
		title: id,
		description: null,
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		status: "published",
	};
}

function mutationId(value: number) {
	return `00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

function syncDeviceId(value: number) {
	return `dvc_00000000-0000-4000-8000-${value.toString(16).padStart(12, "0")}`;
}

function compareGolfPlayers(
	left: GolfRoundSetupInput["players"][number],
	right: GolfRoundSetupInput["players"][number],
) {
	return left.userId.localeCompare(right.userId);
}

function golfRoundSetup(): GolfRoundSetupInput {
	return {
		holes: Array.from({ length: 18 }, (_, index) => ({
			hole: index + 1,
			par: 4,
			strokeIndex: index + 1,
		})),
		players: [
			{ userId: owner.id, playingHandicap: -2 },
			{ userId: organizer.id, playingHandicap: 7 },
			{ userId: participant.id, playingHandicap: 18 },
		],
		teams: [
			{
				id: "gtm_sync_alpha",
				name: "Flight Alpha",
				color: "#00AA55",
				memberUserIds: [owner.id, organizer.id, participant.id],
			},
		],
	};
}

function feedMutation(
	clientSequence: number,
	entityId: string,
	content: string,
	clientMutationId: string,
): SyncMutation {
	return {
		clientMutationId,
		clientSequence,
		kind: "feed.entry.create",
		entityId,
		payload: {
			eventId: null,
			parentEntryId: null,
			kind: "message",
			content,
		},
	};
}

async function push(
	actorId: string,
	input: SyncPushInput,
	idempotencyKey = `sync-http-${++httpKey}`,
) {
	const response = await app.request("/v1/sync/push", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${actorId}`,
			"Content-Type": "application/json",
			"Idempotency-Key": idempotencyKey,
		},
		body: JSON.stringify(input),
	});
	return {
		response,
		body: (await response.json()) as SyncPushResponse,
	};
}

async function pull(
	actorId: string,
	rootEventId: string,
	cursor: string,
	limit = 50,
) {
	const response = await app.request(
		`/v1/sync/pull?rootEventId=${rootEventId}&cursor=${encodeURIComponent(cursor)}&limit=${limit}`,
		{ headers: { Authorization: `Bearer ${actorId}` } },
	);
	return {
		response,
		body: (await response.json()) as SyncPullResponse | ErrorBody,
	};
}

async function bootstrap(
	actorId: string,
	rootEventId: string,
	limit: number,
	cursor?: string,
) {
	const response = await app.request(
		`/v1/sync/bootstrap?rootEventId=${rootEventId}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
		{ headers: { Authorization: `Bearer ${actorId}` } },
	);
	return {
		response,
		body: (await response.json()) as SyncBootstrapResponse,
	};
}

async function addMember(
	rootEventId: string,
	memberId: string,
	role: "organizer" | "participant" | "viewer",
) {
	await sql`
		INSERT INTO event_memberships (root_event_id, user_id, role, status)
		VALUES (${rootEventId}, ${memberId}, ${role}, 'active')
	`;
}

async function seedPreparedUpload(rootEventId: string) {
	const uploadId = "upl_syncverified1";
	const attachmentId = "att_syncverified1";
	const byteCount = 4;
	const sha256 = "a".repeat(64);
	const quarantineObjectKey = `quarantine/${rootEventId}/${attachmentId}/${uploadId}/${byteCount}-${sha256}`;
	const committedObjectKey = `committed/${rootEventId}/${attachmentId}/${uploadId}/${sha256}`;
	await sql`
		INSERT INTO event_attachment_uploads (
			id, attachment_id, root_event_id, target_entry_id, created_by,
			quarantine_object_key, content_type, byte_count, sha256,
			grant_kid, grant_ciphertext, expires_at
		) VALUES (
			${uploadId}, ${attachmentId}, ${rootEventId}, 'fed_syncattach', ${owner.id},
			${quarantineObjectKey}, 'image/png', ${byteCount}, ${sha256},
			'sync-test', ${"x".repeat(32)}, clock_timestamp() + interval '5 minutes'
		)
	`;
	return { uploadId, attachmentId, committedObjectKey };
}

async function waitFor(
	predicate: () => boolean | Promise<boolean>,
	timeoutMilliseconds = 2_000,
) {
	const deadline = Date.now() + timeoutMilliseconds;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await Bun.sleep(10);
	}
	throw new Error("Timed out waiting for PostgreSQL fixture state");
}
