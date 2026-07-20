import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { createCipheriv, randomBytes } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { migrate } from "../scripts/migrate";
import { createApp } from "./app";
import type { EventInput } from "./domain";
import { EventNotificationIngressClient } from "./event-notification-ingress";
import { PostgresEventNotificationOutbox } from "./event-notification-outbox";
import {
	type EventNotificationPayload,
	EventNotificationPayloadCodec,
} from "./event-notification-payload";
import { createEventNotificationWorker } from "./event-notification-worker";
import { PostgresEventRepository } from "./postgres-repository";
import { EventService } from "./service";
import { installPublishedRootFixtures } from "./test-published-root-fixture";

const databaseUrl =
	Bun.env.EVENT_TEST_DATABASE_URL ?? "postgres://localhost/crew_event_test";
const keyV1 = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI";
const keyV2 = "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM";
const userId = (value: number) => `usr_${value.toString(16).padStart(32, "0")}`;
const owner = { id: userId(1) };

let sql: Sql;
let codec: EventNotificationPayloadCodec;
let service: EventService;
let outbox: PostgresEventNotificationOutbox;

beforeAll(async () => {
	sql = postgres(databaseUrl, { max: 12, onnotice: () => {} });
	await migrate(sql);
});

beforeEach(async () => {
	await sql`
		TRUNCATE event_notification_outbox, event_idempotency_records, event_roots CASCADE
	`;
	codec = new EventNotificationPayloadCodec(
		{ kid: "payload-v2", key: keyV2 },
		{ kid: "payload-v1", key: keyV1 },
	);
	service = new EventService(
		new PostgresEventRepository(sql, codec),
		"event-notification-test-invitation-key",
	);
	installPublishedRootFixtures(service, sql);
	outbox = new PostgresEventNotificationOutbox(sql);
});

afterAll(async () => {
	await sql.end();
});

describe("event notification outbox and worker", () => {
	test("bounds terminal purge and expired sweeps while reporting backlog age", async () => {
		const createdAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1_000);
		const completedAt = new Date(createdAt.getTime() + 30 * 60 * 1_000);
		const terminalStatuses = [
			"delivered",
			"suppressed",
			"invalid",
			"dead",
			"expired",
		] as const;
		for (const [index, status] of terminalStatuses.entries()) {
			await sql`
				INSERT INTO event_notification_outbox (
					id, payload_kid, payload_ciphertext, expires_at, status,
					outcome_code, created_at, updated_at, completed_at
				) VALUES (
					${`job_${(index + 1).toString(16).padStart(32, "0")}`},
					'payload-v2', ${"x".repeat(32)},
					${new Date(createdAt.getTime() + 60 * 60 * 1_000)}, ${status},
					${`NOTIFICATION_${status.toUpperCase()}`},
					${createdAt}, ${completedAt}, ${completedAt}
				)
			`;
		}
		const activeCreatedAt = new Date(Date.now() - 2 * 60 * 60 * 1_000);
		await sql`
			INSERT INTO event_notification_outbox (
				id, payload_kid, payload_ciphertext, expires_at,
				created_at, updated_at
			) VALUES (
				'job_00000000000000000000000000000010', 'payload-v2',
				${"y".repeat(32)}, ${new Date(Date.now() + 60 * 60 * 1_000)},
				${activeCreatedAt}, ${activeCreatedAt}
			)
		`;

		const first = await outbox.maintain({
			retentionSeconds: 30 * 24 * 60 * 60,
			limit: 2,
		});
		expect(
			first.purgedDelivered +
				first.purgedSuppressed +
				first.purgedInvalid +
				first.purgedDead +
				first.purgedExpired,
		).toBe(2);
		expect(first.backlog).toBe(1);
		expect(first.oldestActiveAgeSeconds).toBeGreaterThanOrEqual(7_199);

		await sql`TRUNCATE event_notification_outbox`;
		for (let index = 0; index < 3; index++) {
			const expiredCreatedAt = new Date(Date.now() - (index + 2) * 60_000);
			await sql`
				INSERT INTO event_notification_outbox (
					id, payload_kid, payload_ciphertext, expires_at,
					created_at, updated_at
				) VALUES (
					${`job_${(index + 20).toString(16).padStart(32, "0")}`},
					'payload-v2', ${"z".repeat(32)},
					${new Date(expiredCreatedAt.getTime() + 30_000)},
					${expiredCreatedAt}, ${expiredCreatedAt}
				)
			`;
		}
		expect(
			await outbox.claim({
				workerId: "bounded-sweep-worker",
				leaseMs: 5_000,
				maxAttempts: 3,
				maintenanceLimit: 1,
			}),
		).toBeNull();
		const [expired] = await sql<{ count: number }[]>`
			SELECT count(*)::int AS count FROM event_notification_outbox
			WHERE status = 'expired'
		`;
		expect(expired?.count).toBe(1);
	});

	test("atomically fans out encrypted strict payloads and replays without duplicates", async () => {
		const rootEventId = "evt_notify-atomic";
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		const organizer = userId(2);
		const participant = userId(3);
		const viewer = userId(4);
		await addMember(rootEventId, organizer, "organizer");
		await addMember(rootEventId, participant, "participant");
		await addMember(rootEventId, viewer, "viewer");
		await service.createRoot(
			{ id: userId(50) },
			rootInput("evt_notify-foreign", "published"),
		);
		await addMember("evt_notify-foreign", userId(5), "participant");

		const app = createApp({
			service,
			verifyUserToken: async (token) => ({ id: token }),
		});
		const body = {
			id: "fed_notify-atomic",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "private feed text must never enter the outbox",
		};
		const send = (requestId: string) =>
			app.request(`/v1/event-roots/${rootEventId}/feed`, {
				method: "POST",
				headers: commandHeaders(owner.id, "notify-command-0001", requestId),
				body: JSON.stringify(body),
			});
		expect((await send("source-request-original")).status).toBe(201);
		const firstRows = await notificationRows();
		expect((await send("source-request-replay")).status).toBe(201);

		const rows = await notificationRows();
		expect(rows).toEqual(firstRows);
		expect(rows).toHaveLength(3);
		expect(JSON.stringify(rows)).not.toContain(body.body);
		for (const recipient of [organizer, participant, viewer])
			expect(JSON.stringify(rows)).not.toContain(recipient);
		const payloads = rows.map(openRow);
		expect(payloads.map((item) => item.recipientUserId).sort()).toEqual(
			[organizer, participant, viewer].sort(),
		);
		for (const payload of payloads) {
			expect(payload).toMatchObject({
				category: "feed_update",
				templateKey: "feed_entry_created",
				deepLink: {
					rootEventId,
					feedEntryId: body.id,
				},
				causationRequestId: "source-request-original",
			});
			expect(payload.requestId).toMatch(/^job_[a-f0-9]{32}$/);
			expect(rows.some((row) => row.id === payload.requestId)).toBe(true);
			expect(Date.parse(payload.expiresAt) - Date.now()).toBeLessThanOrEqual(
				23 * 60 * 60 * 1000,
			);
		}
	});

	test("rolls feed, revision, root change, outbox and idempotency back on fanout failure", async () => {
		const rootEventId = "evt_notify-rollback";
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await addMember(rootEventId, userId(6), "participant");
		await addMember(rootEventId, userId(7), "viewer");
		const [before] = await sql<
			{ revision: string; changes: number; entries: number; jobs: number }[]
		>`
			SELECT revision::text AS revision,
				(SELECT count(*)::int FROM event_root_changes
				 WHERE root_event_id = ${rootEventId}) AS changes,
				(SELECT count(*)::int FROM event_feed_entries
				 WHERE root_event_id = ${rootEventId}) AS entries,
				(SELECT count(*)::int FROM event_notification_outbox) AS jobs
			FROM event_roots WHERE root_event_id = ${rootEventId}
		`;
		await sql.unsafe(`
			CREATE FUNCTION fail_notification_fanout() RETURNS TRIGGER LANGUAGE plpgsql AS $$
			BEGIN
				IF EXISTS (SELECT 1 FROM event_notification_outbox) THEN
					RAISE EXCEPTION 'forced notification fanout rollback';
				END IF;
				RETURN NEW;
			END;
			$$;
			CREATE TRIGGER fail_notification_fanout_trigger
				BEFORE INSERT ON event_notification_outbox
				FOR EACH ROW EXECUTE FUNCTION fail_notification_fanout();
		`);
		const logs: unknown[][] = [];
		const original = console.error;
		console.error = (...values: unknown[]) => logs.push(values);
		try {
			const app = createApp({
				service,
				verifyUserToken: async (token) => ({ id: token }),
			});
			const response = await app.request(
				`/v1/event-roots/${rootEventId}/feed`,
				{
					method: "POST",
					headers: commandHeaders(
						owner.id,
						"notify-rollback-0001",
						"notify-rollback-request",
					),
					body: JSON.stringify({
						id: "fed_notify-rollback",
						eventId: null,
						parentEntryId: null,
						kind: "message",
						body: "rollback-secret-body",
					}),
				},
			);
			expect(response.status).toBe(500);
			expect(JSON.stringify(logs)).not.toContain("rollback-secret-body");
			const [after] = await sql<
				{
					revision: string;
					changes: number;
					entries: number;
					jobs: number;
					idempotency: number;
				}[]
			>`
				SELECT revision::text AS revision,
					(SELECT count(*)::int FROM event_root_changes
					 WHERE root_event_id = ${rootEventId}) AS changes,
					(SELECT count(*)::int FROM event_feed_entries
					 WHERE root_event_id = ${rootEventId}) AS entries,
					(SELECT count(*)::int FROM event_notification_outbox) AS jobs,
					(SELECT count(*)::int FROM event_idempotency_records
					 WHERE idempotency_key = 'notify-rollback-0001') AS idempotency
				FROM event_roots WHERE root_event_id = ${rootEventId}
			`;
			if (!before) throw new Error("Expected root proof before rollback");
			expect(after).toEqual({ ...before, idempotency: 0 });
		} finally {
			console.error = original;
			await sql.unsafe(`
				DROP TRIGGER IF EXISTS fail_notification_fanout_trigger
					ON event_notification_outbox;
				DROP FUNCTION IF EXISTS fail_notification_fanout();
			`);
		}
	});

	test("matches feed visibility for draft managers and published participants and viewers", async () => {
		const rootEventId = "evt_notify-visibility";
		const organizer = userId(10);
		const participant = userId(11);
		const viewer = userId(12);
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await addMember(rootEventId, organizer, "organizer");
		await addMember(rootEventId, participant, "participant");
		await addMember(rootEventId, viewer, "viewer");
		await service.createEvent(
			owner,
			rootEventId,
			rootEventId,
			rootInput("evt_notify-draft", "draft"),
		);
		await service.createEvent(
			owner,
			rootEventId,
			rootEventId,
			rootInput("evt_notify-published", "published"),
		);
		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_notify-draft",
			eventId: "evt_notify-draft",
			parentEntryId: null,
			kind: "message",
			body: "Manager draft",
		});
		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_notify-published",
			eventId: "evt_notify-published",
			parentEntryId: null,
			kind: "message",
			body: "Published update",
		});
		const payloads = (await notificationRows()).map(openRow);
		expect(
			payloads
				.filter((item) => item.deepLink.feedEntryId === "fed_notify-draft")
				.map((item) => item.recipientUserId),
		).toEqual([organizer]);
		expect(
			payloads
				.filter((item) => item.deepLink.feedEntryId === "fed_notify-published")
				.map((item) => item.recipientUserId)
				.sort(),
		).toEqual([organizer, participant, viewer].sort());
		expect(payloads.some((item) => item.recipientUserId === owner.id)).toBe(
			false,
		);
	});

	test("rejects 501 visible recipients before any feed or revision mutation", async () => {
		const rootEventId = "evt_notify-cap";
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await sql`
			INSERT INTO event_memberships (root_event_id, user_id, role, status)
			SELECT ${rootEventId}, 'usr_' || lpad(to_hex(value), 32, '0'),
				'participant', 'active'
			FROM generate_series(1000, 1500) value
		`;
		const [before] = await rootMutationProof(rootEventId);
		await expect(
			service.createFeedEntry(owner, rootEventId, {
				id: "fed_notify-cap",
				eventId: null,
				parentEntryId: null,
				kind: "message",
				body: "Must reject atomically",
			}),
		).rejects.toMatchObject({
			status: 409,
			code: "FEED_NOTIFICATION_RECIPIENT_LIMIT_REACHED",
		});
		const [after] = await rootMutationProof(rootEventId);
		expect(after).toEqual(before);
	});

	test("suppresses role, removal, tombstone and archived-root races and expires without a rollout key", async () => {
		const draftRoot = "evt_notify-race-draft";
		const manager = userId(20);
		await service.createRoot(owner, rootInput(draftRoot, "published"));
		await addMember(draftRoot, manager, "organizer");
		await service.createEvent(
			owner,
			draftRoot,
			draftRoot,
			rootInput("evt_notify-race-child", "draft"),
		);
		await service.createFeedEntry(owner, draftRoot, {
			id: "fed_notify-race-draft",
			eventId: "evt_notify-race-child",
			parentEntryId: null,
			kind: "message",
			body: "Draft race",
		});
		await sql`
			UPDATE event_memberships SET role = 'viewer', version = version + 1
			WHERE root_event_id = ${draftRoot} AND user_id = ${manager}
		`;
		expect(await claimAndRecheck("draft-role-worker")).toBe("suppressed");

		const removalRoot = "evt_notify-race-removal";
		const removed = userId(21);
		await service.createRoot(owner, rootInput(removalRoot, "published"));
		await addMember(removalRoot, removed, "participant");
		await service.createFeedEntry(owner, removalRoot, {
			id: "fed_notify-race-removal",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "Removal race",
		});
		await sql`
			UPDATE event_memberships SET status = 'removed', removed_by = ${owner.id},
				removal_reason = 'test', version = version + 1
			WHERE root_event_id = ${removalRoot} AND user_id = ${removed}
		`;
		expect(await claimAndRecheck("removal-worker")).toBe("suppressed");

		const ancestorRoot = "evt_notify-race-ancestor";
		await service.createRoot(owner, rootInput(ancestorRoot, "published"));
		await addMember(ancestorRoot, userId(211), "participant");
		await service.createEvent(
			owner,
			ancestorRoot,
			ancestorRoot,
			rootInput("evt_notify-race-ancestor-parent", "published"),
		);
		await service.createEvent(
			owner,
			ancestorRoot,
			"evt_notify-race-ancestor-parent",
			rootInput("evt_notify-race-ancestor-child", "published"),
		);
		await service.createFeedEntry(owner, ancestorRoot, {
			id: "fed_notify-race-ancestor",
			eventId: "evt_notify-race-ancestor-child",
			parentEntryId: null,
			kind: "message",
			body: "Ancestor draft race",
		});
		const currentAncestor = await service.getEvent(
			owner,
			ancestorRoot,
			"evt_notify-race-ancestor-parent",
		);
		await service.updateEvent(
			owner,
			ancestorRoot,
			"evt_notify-race-ancestor-parent",
			currentAncestor.version,
			{ status: "draft" },
		);
		expect(await claimAndRecheck("ancestor-worker")).toBe("suppressed");

		const tombstoneRoot = "evt_notify-race-tombstone";
		await service.createRoot(owner, rootInput(tombstoneRoot, "published"));
		await addMember(tombstoneRoot, userId(22), "viewer");
		const tombstone = await service.createFeedEntry(owner, tombstoneRoot, {
			id: "fed_notify-race-tombstone",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "Tombstone race",
		});
		await service.removeFeedEntry(
			owner,
			tombstoneRoot,
			tombstone.id,
			tombstone.version,
		);
		expect(await claimAndRecheck("tombstone-worker")).toBe("suppressed");

		const archivedRoot = "evt_notify-race-archive";
		await service.createRoot(owner, rootInput(archivedRoot, "published"));
		await addMember(archivedRoot, userId(23), "organizer");
		await addMember(archivedRoot, userId(230), "participant");
		await addMember(archivedRoot, userId(231), "viewer");
		await service.createFeedEntry(owner, archivedRoot, {
			id: "fed_notify-race-archive",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "Archive race",
		});
		await service.archiveEvent(owner, archivedRoot, archivedRoot, 1);
		for (const suffix of ["manager", "participant", "viewer"])
			expect(await claimAndRecheck(`archive-worker-${suffix}`)).toBe(
				"suppressed",
			);

		const deletedEventRoot = "evt_notify-race-deleted-event";
		await service.createRoot(owner, rootInput(deletedEventRoot, "published"));
		await addMember(deletedEventRoot, userId(232), "organizer");
		await service.createEvent(
			owner,
			deletedEventRoot,
			deletedEventRoot,
			rootInput("evt_notify-race-deleted-child", "published"),
		);
		await service.createFeedEntry(owner, deletedEventRoot, {
			id: "fed_notify-race-deleted-event",
			eventId: "evt_notify-race-deleted-child",
			parentEntryId: null,
			kind: "message",
			body: "Deleted event race",
		});
		await service.tombstoneEvent(
			owner,
			deletedEventRoot,
			"evt_notify-race-deleted-child",
			1,
			false,
		);
		expect(await claimAndRecheck("deleted-event-worker")).toBe("suppressed");

		const expiryRoot = "evt_notify-race-expiry";
		await service.createRoot(owner, rootInput(expiryRoot, "published"));
		await addMember(expiryRoot, userId(24), "participant");
		await service.createFeedEntry(owner, expiryRoot, {
			id: "fed_notify-race-expiry",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "Expiry race",
		});
		await sql`
			UPDATE event_notification_outbox SET payload_kid = 'unknown-rollout-kid',
				created_at = clock_timestamp() - interval '2 hours',
				expires_at = clock_timestamp() - interval '1 hour',
				available_at = clock_timestamp() - interval '1 hour'
			WHERE status = 'pending'
		`;
		expect(
			await outbox.claim({
				workerId: "expiry-worker",
				leaseMs: 5_000,
				maxAttempts: 3,
			}),
		).toBeNull();
		const [expired] = await sql<{ status: string; attempts: number }[]>`
			SELECT status, attempts FROM event_notification_outbox
			WHERE payload_kid = 'unknown-rollout-kid'
		`;
		expect(expired).toEqual({ status: "expired", attempts: 0 });
	});

	test("fences two workers so a stale owner cannot call or acknowledge", async () => {
		const rootEventId = "evt_notify-fence";
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await addMember(rootEventId, userId(30), "participant");
		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_notify-fence",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "Fence race",
		});
		const first = await outbox.claim({
			workerId: "worker-a",
			leaseMs: 5_000,
			maxAttempts: 3,
		});
		if (!first) throw new Error("Expected first notification claim");
		await sql`
			UPDATE event_notification_outbox
			SET lease_until = clock_timestamp() - interval '1 millisecond'
			WHERE id = ${first.id}
		`;
		const second = await outbox.claim({
			workerId: "worker-b",
			leaseMs: 5_000,
			maxAttempts: 3,
		});
		if (!second) throw new Error("Expected recovered notification claim");
		expect(Number(second.fence)).toBeGreaterThan(Number(first.fence));
		const firstPayload = openClaim(first);
		expect(
			await outbox.renewForDelivery(first, firstPayload, {
				leaseMs: 5_000,
				minimumRemainingMs: 500,
				maxAttempts: 3,
			}),
		).toBe("stale");
		let downstreamCalls = 0;
		const secondClaim = second;
		const permit = await outbox.renewForDelivery(
			secondClaim,
			openClaim(secondClaim),
			{ leaseMs: 5_000, minimumRemainingMs: 500, maxAttempts: 3 },
		);
		expect(typeof permit).not.toBe("string");
		if (typeof permit !== "string") {
			expect(Number(permit.fence)).toBeGreaterThan(Number(secondClaim.fence));
			downstreamCalls++;
			expect(await outbox.complete(permit, 202)).toBe(true);
		}
		expect(await outbox.complete({ ...first, attempt: 1 }, 202)).toBe(false);
		expect(downstreamCalls).toBe(1);
	});

	test("linearizes a blocked membership removal before replacement suppression", async () => {
		const rootEventId = "evt_notify-blocked-recheck";
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await addMember(rootEventId, userId(31), "participant");
		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_notify-blocked-recheck",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "Blocked recheck",
		});
		const first = await outbox.claim({
			workerId: "blocked-worker-a",
			leaseMs: 1_000,
			maxAttempts: 3,
		});
		if (!first) throw new Error("Expected blocked notification claim");

		const blocker = postgres(databaseUrl, { max: 1, onnotice: () => {} });
		let releaseLock = () => {};
		const release = new Promise<void>((resolve) => {
			releaseLock = resolve;
		});
		let lockAcquired = () => {};
		const acquired = new Promise<void>((resolve) => {
			lockAcquired = resolve;
		});
		const lockedTransaction = blocker.begin(async (transaction) => {
			const tx = transaction as unknown as Sql;
			await tx`
				SELECT root_event_id FROM event_roots
				WHERE root_event_id = ${rootEventId}
				FOR UPDATE
			`;
			await tx`
				UPDATE event_memberships SET status = 'removed',
					removed_by = ${owner.id}, removal_reason = 'blocked race',
					version = version + 1, updated_at = clock_timestamp()
				WHERE root_event_id = ${rootEventId} AND user_id = ${userId(31)}
			`;
			lockAcquired();
			await release;
		});
		try {
			await acquired;
			let downstreamCalls = 0;
			const observed: {
				renewalResult: Awaited<
					ReturnType<typeof outbox.renewForDelivery>
				> | null;
			} = { renewalResult: null };
			const claimedOutbox = {
				async claim() {
					return first;
				},
				async renewForDelivery(
					...args: Parameters<typeof outbox.renewForDelivery>
				) {
					observed.renewalResult = await outbox.renewForDelivery(...args);
					return observed.renewalResult;
				},
			} as unknown as PostgresEventNotificationOutbox;
			const staleProcessing = createEventNotificationWorker(
				workerConfig("blocked-worker-a"),
				claimedOutbox,
				codec,
				{
					async deliver() {
						downstreamCalls++;
						return { status: 202 as const };
					},
				},
			).processOne();
			await Bun.sleep(1_100);
			releaseLock();
			await lockedTransaction;
			expect(await staleProcessing).toBe(true);
			expect(observed.renewalResult).toBe("stale");
			expect(downstreamCalls).toBe(0);

			const replacement = await outbox.claim({
				workerId: "blocked-worker-b",
				leaseMs: 5_000,
				maxAttempts: 3,
			});
			if (!replacement) throw new Error("Expected replacement claim");
			expect(Number(replacement.fence)).toBeGreaterThan(Number(first.fence));
			const replacementResult = await outbox.renewForDelivery(
				replacement,
				openClaim(replacement),
				{ leaseMs: 5_000, minimumRemainingMs: 500, maxAttempts: 3 },
			);
			expect(replacementResult).toBe("suppressed");
			expect(downstreamCalls).toBe(0);
			const [job] = await sql<{ status: string; attempts: number }[]>`
				SELECT status, attempts FROM event_notification_outbox
				WHERE id = ${first.id}
			`;
			expect(job).toEqual({ status: "suppressed", attempts: 0 });
		} finally {
			releaseLock();
			await lockedTransaction;
			await blocker.end();
		}
	});

	test("rejects a request ID that differs from the durable claim job ID before HTTP", async () => {
		const jobId = "job_000000000000000000000000000000aa";
		const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
		const mismatched: EventNotificationPayload = {
			recipientUserId: userId(60),
			category: "feed_update",
			templateKey: "feed_entry_created",
			deepLink: {
				rootEventId: "evt_notify-job-binding",
				feedEntryId: "fed_notify-job-binding",
			},
			expiresAt,
			requestId: "job_000000000000000000000000000000bb",
			causationRequestId: "job-binding-source",
		};
		expect(() => codec.seal(jobId, mismatched)).toThrow(
			"Invalid event notification payload",
		);
		await sql`
			INSERT INTO event_notification_outbox (
				id, payload_kid, payload_ciphertext, expires_at
			) VALUES (
				${jobId}, 'payload-v2', ${sealMismatched(jobId, mismatched)}, ${expiresAt}
			)
		`;
		let downstreamCalls = 0;
		await worker("job-binding-worker", codec, {
			async deliver() {
				downstreamCalls++;
				return { status: 202 as const };
			},
		}).processOne();
		expect(downstreamCalls).toBe(0);
		const [job] = await sql<{ status: string; attempts: number }[]>`
			SELECT status, attempts FROM event_notification_outbox WHERE id = ${jobId}
		`;
		expect(job).toEqual({ status: "invalid", attempts: 0 });
	});

	test("survives payload-key rollout, rejects tampering and reuses the job ID after HTTP 408", async () => {
		const rootEventId = "evt_notify-rollout";
		const recipient = userId(40);
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await addMember(rootEventId, recipient, "participant");
		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_notify-rollout",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "Rollout",
		});
		let downstreamCalls = 0;
		const ingress = {
			async deliver() {
				downstreamCalls++;
				return { status: 202 as const };
			},
		};
		await worker(
			"old-key-worker",
			new EventNotificationPayloadCodec({ kid: "payload-v1", key: keyV1 }),
			ingress,
		).processOne();
		const [waiting] = await sql<
			{ status: string; attempts: number; keyFailures: number }[]
		>`
			SELECT status, attempts, key_failures AS "keyFailures"
			FROM event_notification_outbox
		`;
		expect(waiting).toEqual({ status: "retry", attempts: 0, keyFailures: 1 });
		expect(downstreamCalls).toBe(0);
		await makeRetriesAvailable();
		await worker("rollout-worker", codec, ingress).processOne();
		expect(downstreamCalls).toBe(1);

		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_notify-tamper",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "Tamper",
		});
		await sql`
			UPDATE event_notification_outbox SET
				payload_ciphertext = overlay(
					payload_ciphertext placing
					CASE substring(payload_ciphertext FROM 5 FOR 1)
						WHEN 'A' THEN 'B' ELSE 'A' END
					FROM 5 FOR 1
				)
			WHERE status = 'pending'
		`;
		await worker("tamper-worker", codec, ingress).processOne();
		const [invalid] = await sql<{ status: string; attempts: number }[]>`
			SELECT status, attempts FROM event_notification_outbox
			WHERE status = 'invalid'
		`;
		expect(invalid).toEqual({ status: "invalid", attempts: 0 });
		expect(downstreamCalls).toBe(1);

		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_notify-timeout",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "Timeout",
		});
		const requestIds: {
			idempotencyKey: string | null;
			requestId: string | null;
		}[] = [];
		const timeoutIngress = new EventNotificationIngressClient(
			{
				baseUrl: "https://user-service.internal",
				timeoutMs: 1_000,
				issuer: "crew-event-service",
				audience: "crew-user-service",
				serviceAuthKeyId: "service-current-v2",
				serviceAuthKey: "BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ",
			},
			(async (
				_input: Parameters<typeof fetch>[0],
				init?: Parameters<typeof fetch>[1],
			) => {
				const headers = new Headers(init?.headers);
				requestIds.push({
					idempotencyKey: headers.get("idempotency-key"),
					requestId: headers.get("x-request-id"),
				});
				return new Response(null, {
					status: requestIds.length === 1 ? 408 : 202,
				});
			}) as unknown as typeof fetch,
		);
		const timeoutWorker = worker("timeout-worker", codec, timeoutIngress);
		await timeoutWorker.processOne();
		const [retrying] = await sql<
			{
				status: string;
				attempts: number;
				outcomeCode: string;
				delayed: boolean;
			}[]
		>`
			SELECT status, attempts, outcome_code AS "outcomeCode",
				available_at > updated_at AS delayed
			FROM event_notification_outbox WHERE status = 'retry'
		`;
		expect(retrying).toEqual({
			status: "retry",
			attempts: 1,
			outcomeCode: "NOTIFICATION_INGRESS_UNAVAILABLE",
			delayed: true,
		});
		await makeRetriesAvailable();
		await timeoutWorker.processOne();
		expect(requestIds).toHaveLength(2);
		expect(new Set(requestIds.map(({ requestId }) => requestId)).size).toBe(1);
		expect(requestIds[0]?.idempotencyKey).toBe(requestIds[0]?.requestId);
		expect(requestIds[1]?.idempotencyKey).toBe(requestIds[1]?.requestId);
		const deliveredId = requestIds[0]?.requestId;
		if (!deliveredId) throw new Error("Expected timeout retry request ID");
		expect(deliveredId).toMatch(/^job_[0-9a-f]{32}$/);
		const [delivered] = await sql<{ status: string; attempts: number }[]>`
			SELECT status, attempts FROM event_notification_outbox
			WHERE id = ${deliveredId}
		`;
		expect(delivered).toEqual({ status: "delivered", attempts: 2 });
	});

	test("logs only fixed worker metadata when a tick fails", async () => {
		const controller = new AbortController();
		const unsafe = "private-body-recipient-token";
		const failingOutbox = {
			async claim() {
				controller.abort();
				throw new Error(unsafe);
			},
		} as unknown as PostgresEventNotificationOutbox;
		const logs: unknown[][] = [];
		const original = console.error;
		console.error = (...values: unknown[]) => logs.push(values);
		try {
			await createEventNotificationWorker(
				workerConfig("safe-log-worker"),
				failingOutbox,
				codec,
				{
					async deliver() {
						return { status: 202 as const };
					},
				},
			).run(controller.signal);
		} finally {
			console.error = original;
		}
		expect(logs).toEqual([
			[
				"Event notification worker tick failed",
				{
					workerId: "safe-log-worker",
					code: "EVENT_NOTIFICATION_WORKER_TICK_FAILED",
				},
			],
		]);
		expect(JSON.stringify(logs)).not.toContain(unsafe);
	});
});

function rootInput(id: string, status: EventInput["status"]): EventInput {
	return {
		id,
		kind: "team_event",
		title: id,
		description: null,
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		status,
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

function commandHeaders(
	actorId: string,
	idempotencyKey: string,
	requestId: string,
) {
	return {
		Authorization: `Bearer ${actorId}`,
		"Content-Type": "application/json",
		"Idempotency-Key": idempotencyKey,
		"X-Request-ID": requestId,
	};
}

type NotificationRow = {
	id: string;
	payloadKid: string;
	payloadCiphertext: string;
	expiresAt: Date;
};

function notificationRows() {
	return sql<NotificationRow[]>`
		SELECT id, payload_kid AS "payloadKid",
			payload_ciphertext AS "payloadCiphertext", expires_at AS "expiresAt"
		FROM event_notification_outbox ORDER BY id
	`;
}

function openRow(row: NotificationRow) {
	return codec.open(
		row.id,
		row.payloadKid,
		row.payloadCiphertext,
		row.expiresAt.toISOString(),
	);
}

function openClaim(claim: {
	id: string;
	payloadKid: string;
	payloadCiphertext: string;
	expiresAt: Date;
}) {
	return codec.open(
		claim.id,
		claim.payloadKid,
		claim.payloadCiphertext,
		claim.expiresAt.toISOString(),
	);
}

async function claimAndRecheck(workerId: string) {
	const claim = await outbox.claim({
		workerId,
		leaseMs: 5_000,
		maxAttempts: 3,
	});
	if (!claim) throw new Error("Expected notification claim");
	return outbox.renewForDelivery(claim, openClaim(claim), {
		leaseMs: 5_000,
		minimumRemainingMs: 500,
		maxAttempts: 3,
	});
}

function rootMutationProof(rootEventId: string) {
	return sql<
		{ revision: string; changes: number; entries: number; jobs: number }[]
	>`
		SELECT revision::text AS revision,
			(SELECT count(*)::int FROM event_root_changes
			 WHERE root_event_id = ${rootEventId}) AS changes,
			(SELECT count(*)::int FROM event_feed_entries
			 WHERE root_event_id = ${rootEventId}) AS entries,
			(SELECT count(*)::int FROM event_notification_outbox) AS jobs
		FROM event_roots WHERE root_event_id = ${rootEventId}
	`;
}

function workerConfig(workerId: string) {
	return {
		workerId,
		pollIntervalMs: 50,
		leaseMs: 5_000,
		timeoutMs: 100,
		maxAttempts: 3,
		baseBackoffMs: 100,
		maxBackoffMs: 1_000,
	};
}

function worker(
	workerId: string,
	payloadCodec: EventNotificationPayloadCodec,
	ingress: {
		deliver(payload: EventNotificationPayload): Promise<{ status: 202 | 204 }>;
	},
) {
	return createEventNotificationWorker(
		workerConfig(workerId),
		outbox,
		payloadCodec,
		ingress,
	);
}

async function makeRetriesAvailable() {
	await sql`
		UPDATE event_notification_outbox SET available_at = clock_timestamp()
		WHERE status = 'retry'
	`;
}

function sealMismatched(jobId: string, payload: EventNotificationPayload) {
	const iv = randomBytes(12);
	const cipher = createCipheriv(
		"aes-256-gcm",
		Buffer.from(keyV2, "base64url"),
		iv,
	);
	cipher.setAAD(
		Buffer.from(
			[
				"crew:event-service:notification:v1",
				"payload-v2",
				jobId,
				payload.expiresAt,
			].join("\0"),
			"utf8",
		),
	);
	const encrypted = Buffer.concat([
		cipher.update(JSON.stringify(payload), "utf8"),
		cipher.final(),
	]);
	return [iv, cipher.getAuthTag(), encrypted]
		.map((part) => part.toString("base64url"))
		.join(".");
}
