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
import { lockFeedbackDuplicateScopes } from "./feedback-lock";
import {
	addCommunityFeedbackComment,
	getCommunityFeedback,
	listCommunityFeedback,
	listCommunityFeedbackUpdates,
	setCommunityFeedbackFollow,
	setCommunityFeedbackVote,
} from "./postgres-community-feedback";
import { PostgresEventRepository } from "./postgres-repository";
import { EventService } from "./service";
import { installPublishedRootFixtures } from "./test-published-root-fixture";

const databaseUrl =
	Bun.env.EVENT_TEST_DATABASE_URL ?? "postgres://localhost/crew_event_test";
const userId = (value: number) => `usr_${value.toString(16).padStart(32, "0")}`;
const owner = { id: userId(1_001) };
const organizer = { id: userId(1_002) };
const participant = { id: userId(1_003) };
const outsider = { id: userId(1_004) };
const reader = { id: userId(1_005) };

let sql: Sql;
let service: EventService;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
	sql = postgres(databaseUrl, { max: 12, onnotice: () => {} });
	await migrate(sql);
	service = new EventService(
		new PostgresEventRepository(
			sql,
			new EventNotificationPayloadCodec({
				kid: "community-feedback-test-v1",
				key: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
			}),
		),
		"community-feedback-test-invitation-key-at-least-32-characters",
	);
	installPublishedRootFixtures(service, sql);
	app = createApp({
		service,
		verifyUserToken: async (token) => ({ id: token }),
	});
});

beforeEach(async () => {
	await sql`TRUNCATE event_idempotency_records, event_roots CASCADE`;
});

afterAll(async () => {
	await sql.end();
});

describe("root-scoped community feedback against PostgreSQL", () => {
	test("lists only canonical public feedback for active root members", async () => {
		const rootEventId = "evt_community_list01";
		const otherRootEventId = "evt_community_list02";
		await root(rootEventId);
		await root(otherRootEventId);
		await member(rootEventId, participant.id, "participant");
		await feedback(participant, rootEventId, "fbk_community_public01", {
			title: "Public root idea",
		});
		await feedback(participant, rootEventId, "fbk_community_private01", {
			title: "Private diagnostic",
			visibility: "private",
		});
		await feedback(owner, otherRootEventId, "fbk_community_other01", {
			title: "Other tenant idea",
		});

		const page = await listCommunityFeedback(sql, participant, rootEventId, {
			limit: 50,
			after: null,
			status: "open",
			followedOnly: false,
		});
		expect(page).toMatchObject({
			hasMore: false,
			items: [
				{
					id: "fbk_community_public01",
					title: "Public root idea",
					status: "open",
					voteCount: 0,
					duplicateCount: 0,
					viewerHasVoted: false,
					followed: false,
				},
			],
		});
		expect(JSON.stringify(page)).not.toContain("Private diagnostic");
		expect(JSON.stringify(page)).not.toContain("Other tenant idea");
		await expect(
			listCommunityFeedback(sql, outsider, rootEventId, {
				limit: 50,
				after: null,
				status: null,
				followedOnly: false,
			}),
		).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
	});

	test("merges duplicate signal by unique voter and canonicalizes writes", async () => {
		const rootEventId = "evt_community_merge01";
		const canonicalId = "fbk_community_canonical01";
		const duplicateId = "fbk_community_duplicate01";
		await root(rootEventId);
		await member(rootEventId, organizer.id, "organizer");
		await member(rootEventId, participant.id, "participant");
		await feedback(participant, rootEventId, canonicalId, {
			title: "Canonical community idea",
		});
		await feedback(participant, rootEventId, duplicateId, {
			title: "Same idea reported twice",
		});
		await service.setFeedbackVote(participant, canonicalId, true);
		await service.setFeedbackVote(organizer, canonicalId, true);
		await service.setFeedbackVote(organizer, duplicateId, true);
		await service.setFeedbackVote(owner, duplicateId, true);
		await service.markFeedbackDuplicate(
			owner,
			duplicateId,
			canonicalId,
			"Same root cause.",
		);

		const before = await listCommunityFeedback(sql, participant, rootEventId, {
			limit: 50,
			after: null,
			status: null,
			followedOnly: false,
		});
		expect(before.items).toHaveLength(1);
		expect(before.items[0]).toMatchObject({
			id: canonicalId,
			voteCount: 3,
			duplicateCount: 1,
			viewerHasVoted: true,
		});

		await setCommunityFeedbackFollow(
			sql,
			participant,
			rootEventId,
			duplicateId,
			true,
		);
		await setCommunityFeedbackVote(
			sql,
			participant,
			rootEventId,
			duplicateId,
			false,
		);
		const commented = await addCommunityFeedbackComment(
			sql,
			participant,
			rootEventId,
			duplicateId,
			{
				id: "fbc_community_canonical01",
				body: "The canonical item has this context too.",
			},
		);
		expect(commented).toMatchObject({
			redirectedFromFeedbackId: duplicateId,
			feedback: {
				id: canonicalId,
				voteCount: 2,
				followed: true,
				comments: [
					{
						id: "fbc_community_canonical01",
						body: "The canonical item has this context too.",
					},
				],
			},
		});
		expect(commented.feedback.statusHistory).toEqual([
			expect.objectContaining({
				version: 1,
				fromStatus: null,
				toStatus: "open",
			}),
		]);
		expect(
			(
				await listCommunityFeedbackUpdates(sql, participant, rootEventId, {
					limit: 50,
					after: null,
					followedOnly: false,
				})
			).items,
		).toEqual([]);
		const serialized = JSON.stringify(commented);
		expect(serialized).not.toContain("usr_");
		expect(serialized).not.toContain("authorUserId");
		expect(serialized).not.toContain("changedBy");
		expect(serialized).not.toContain("diagnostics");
		expect(serialized).not.toContain("attachments");
		expect(serialized).not.toContain('"context":');
	});

	test("flattens duplicate chains without losing grouped votes or follows", async () => {
		const rootEventId = "evt_community_flatten01";
		const canonicalId = "fbk_community_flatten_b";
		const intermediateId = "fbk_community_flatten_a";
		const childId = "fbk_community_flatten_c";
		await root(rootEventId);
		await member(rootEventId, organizer.id, "organizer");
		await member(rootEventId, participant.id, "participant");
		for (const id of [canonicalId, intermediateId, childId]) {
			await feedback(participant, rootEventId, id, { title: id });
		}

		await service.setFeedbackVote(participant, childId, true);
		await service.setFeedbackVote(participant, intermediateId, true);
		await service.setFeedbackVote(organizer, intermediateId, true);
		await service.setFeedbackVote(owner, canonicalId, true);
		await setCommunityFeedbackFollow(
			sql,
			participant,
			rootEventId,
			childId,
			true,
		);
		await setCommunityFeedbackFollow(
			sql,
			organizer,
			rootEventId,
			intermediateId,
			true,
		);
		await setCommunityFeedbackFollow(
			sql,
			owner,
			rootEventId,
			canonicalId,
			true,
		);

		await service.markFeedbackDuplicate(
			owner,
			childId,
			intermediateId,
			"First merge.",
		);
		await service.markFeedbackDuplicate(
			owner,
			intermediateId,
			canonicalId,
			"Flatten the duplicate group.",
		);

		const links = await sql<
			{ id: string; duplicateOfFeedbackId: string | null }[]
		>`
			SELECT id, duplicate_of_feedback_id AS "duplicateOfFeedbackId"
			FROM event_feedback WHERE id IN (${canonicalId}, ${intermediateId}, ${childId})
			ORDER BY id
		`;
		expect([...links]).toEqual([
			{ id: intermediateId, duplicateOfFeedbackId: canonicalId },
			{ id: canonicalId, duplicateOfFeedbackId: null },
			{ id: childId, duplicateOfFeedbackId: canonicalId },
		]);

		const resolved = await getCommunityFeedback(
			sql,
			participant,
			rootEventId,
			childId,
		);
		expect(resolved).toMatchObject({
			redirectedFromFeedbackId: childId,
			feedback: {
				id: canonicalId,
				voteCount: 3,
				duplicateCount: 2,
				viewerHasVoted: true,
				followed: true,
			},
		});
		const followed = await listCommunityFeedback(
			sql,
			participant,
			rootEventId,
			{
				limit: 50,
				after: null,
				status: null,
				followedOnly: true,
			},
		);
		expect(followed.items.map((item) => item.id)).toEqual([canonicalId]);
		expect(
			await sql`
				SELECT DISTINCT user_id FROM event_feedback_follows
				WHERE root_event_id = ${rootEventId}
			`,
		).toHaveLength(3);
	});

	test("serializes concurrent duplicate-group writes across two connections", async () => {
		const rootEventId = "evt_community_lock01";
		const canonicalId = "fbk_community_lock_z";
		const leftId = "fbk_community_lock_a";
		const rightId = "fbk_community_lock_b";
		await root(rootEventId);
		await member(rootEventId, organizer.id, "organizer");
		await member(rootEventId, participant.id, "participant");
		for (const id of [canonicalId, leftId, rightId]) {
			await feedback(participant, rootEventId, id, { title: id });
		}
		await service.markFeedbackDuplicate(owner, leftId, canonicalId, "Left.");
		await service.markFeedbackDuplicate(owner, rightId, canonicalId, "Right.");

		const firstSql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
		const secondSql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
		let signalLocked: (() => void) | null = null;
		const locked = new Promise<void>((resolve) => {
			signalLocked = resolve;
		});
		try {
			const first = firstSql.begin(async (tx) => {
				const scoped = tx as unknown as Sql;
				await lockFeedbackDuplicateScopes(scoped, [rootEventId]);
				signalLocked?.();
				await Bun.sleep(50);
				return setCommunityFeedbackVote(
					scoped,
					participant,
					rootEventId,
					leftId,
					true,
				);
			});
			await locked;
			const second = secondSql.begin((tx) =>
				setCommunityFeedbackFollow(
					tx as unknown as Sql,
					organizer,
					rootEventId,
					rightId,
					true,
				),
			);
			const [vote, follow] = await withTimeout(
				Promise.all([first, second]),
				2_000,
			);
			expect(vote.feedback).toMatchObject({
				id: canonicalId,
				viewerHasVoted: true,
			});
			expect(follow).toEqual({ feedbackId: canonicalId, followed: true });
		} finally {
			await Promise.all([firstSql.end(), secondSql.end()]);
		}
	});

	test("keeps direct generic and community details on one database snapshot", async () => {
		const rootEventId = "evt_community_snapshot01";
		const genericId = "fbk_community_snapshot_generic";
		const communityId = "fbk_community_snapshot_public";
		await root(rootEventId);
		await member(rootEventId, participant.id, "participant");
		await feedback(participant, rootEventId, genericId);
		await feedback(participant, rootEventId, communityId);

		const readerSql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
		const writerSql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
		const readerRepository = new PostgresEventRepository(
			readerSql,
			new EventNotificationPayloadCodec({
				kid: "community-feedback-snapshot-test-v1",
				key: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
			}),
		);
		const [readerBackend] = await readerSql<{ pid: number }[]>`
			SELECT pg_backend_pid() AS pid
		`;
		if (!readerBackend) throw new Error("Missing feedback reader backend.");

		const acrossMembershipBarrier = async <T>(
			read: () => Promise<T>,
			mutate: (tx: Sql) => Promise<void>,
		) => {
			const pending: { read?: Promise<T> } = {};
			await writerSql.begin(async (transaction) => {
				const tx = transaction as unknown as Sql;
				await tx`
					SELECT user_id FROM event_memberships
					WHERE root_event_id = ${rootEventId}
						AND user_id = ${participant.id}
					FOR UPDATE
				`;
				pending.read = read();
				await waitForDatabaseLock(tx, readerBackend.pid);
				await mutate(tx);
			});
			if (!pending.read)
				throw new Error("Feedback snapshot read did not start.");
			return pending.read;
		};

		try {
			const generic = await acrossMembershipBarrier(
				() => readerRepository.getFeedback(participant, genericId),
				async (tx) => {
					await tx`
						INSERT INTO event_feedback_comments (
							id, feedback_id, author_user_id, body
						) VALUES (
							'fbc_snapshot_generic', ${genericId}, ${participant.id},
							'Committed while the detail reader is blocked.'
						)
					`;
					await tx`
						INSERT INTO event_feedback_votes (feedback_id, user_id)
						VALUES (${genericId}, ${participant.id})
					`;
					await tx`
						UPDATE event_feedback SET status = 'planned', version = 2,
							updated_at = now()
						WHERE id = ${genericId}
					`;
					await tx`
						INSERT INTO event_feedback_status_history (
							feedback_id, version, from_status, to_status, changed_by, note
						) VALUES (
							${genericId}, 2, 'open', 'planned', ${owner.id},
							'Committed while the detail reader is blocked.'
						)
					`;
				},
			);
			expect(generic).toMatchObject({
				status: "open",
				version: 1,
				voteCount: 0,
				comments: [],
				commentCount: 0,
				statusHistoryCount: 1,
			});
			expect(generic.statusHistory).toHaveLength(1);

			const community = await acrossMembershipBarrier(
				() =>
					readerRepository.getCommunityFeedback(
						participant,
						rootEventId,
						communityId,
					),
				async (tx) => {
					await tx`
						INSERT INTO event_feedback_comments (
							id, feedback_id, author_user_id, body
						) VALUES (
							'fbc_snapshot_community', ${communityId}, ${participant.id},
							'Committed while the community reader is blocked.'
						)
					`;
					await tx`
						INSERT INTO event_feedback_votes (feedback_id, user_id)
						VALUES (${communityId}, ${participant.id})
					`;
					await tx`
						INSERT INTO event_feedback_follows (
							root_event_id, feedback_id, user_id
						) VALUES (${rootEventId}, ${communityId}, ${participant.id})
					`;
					await tx`
						UPDATE event_feedback SET status = 'planned', version = 2,
							updated_at = now()
						WHERE id = ${communityId}
					`;
					await tx`
						INSERT INTO event_feedback_status_history (
							feedback_id, version, from_status, to_status, changed_by, note
						) VALUES (
							${communityId}, 2, 'open', 'planned', ${owner.id},
							'Committed while the community reader is blocked.'
						)
					`;
				},
			);
			expect(community).toMatchObject({
				redirectedFromFeedbackId: null,
				feedback: {
					status: "open",
					version: 1,
					voteCount: 0,
					followed: false,
					comments: [],
					commentCount: 0,
					statusHistoryCount: 1,
				},
			});
			expect(community.feedback.statusHistory).toHaveLength(1);

			expect(
				await readerRepository.getCommunityFeedback(
					participant,
					rootEventId,
					communityId,
				),
			).toMatchObject({
				feedback: {
					status: "planned",
					version: 2,
					voteCount: 1,
					followed: true,
					commentCount: 1,
					statusHistoryCount: 2,
				},
			});
		} finally {
			await Promise.all([readerSql.end(), writerSql.end()]);
		}
	});

	test("bounds list, comments, history and escaped detail below the gateway cap", async () => {
		const rootEventId = "evt_community_bounds01";
		const feedbackIds = Array.from(
			{ length: 11 },
			(_, index) => `fbk_community_bounds_${index.toString().padStart(2, "0")}`,
		);
		await root(rootEventId);
		await member(rootEventId, organizer.id, "organizer");
		await member(rootEventId, participant.id, "participant");
		for (const id of feedbackIds) {
			await feedback(participant, rootEventId, id, { title: id });
		}
		const page = await listCommunityFeedback(sql, participant, rootEventId, {
			limit: 50,
			after: null,
			status: null,
			followedOnly: false,
		});
		expect(page.items).toHaveLength(10);
		expect(page.hasMore).toBe(true);

		const feedbackId = feedbackIds[0] as string;
		await sql`
			INSERT INTO event_feedback_comments (
				id, feedback_id, author_user_id, body, created_at
			)
			SELECT 'fbc_bounds_' || lpad(value::text, 2, '0'), ${feedbackId},
				${participant.id}, repeat(chr(1), 5000),
				now() + value * interval '1 microsecond'
			FROM generate_series(1, 21) value
		`;
		await sql`
			INSERT INTO event_feedback_status_history (
				feedback_id, version, from_status, to_status, changed_by, note
			)
			SELECT ${feedbackId}, value,
				CASE WHEN value % 2 = 0 THEN 'open' ELSE 'planned' END,
				CASE WHEN value % 2 = 0 THEN 'planned' ELSE 'open' END,
				${owner.id}, repeat(chr(1), 1000)
			FROM generate_series(2, 21) value
		`;
		await sql`
			UPDATE event_feedback SET status = 'open', version = 21
			WHERE id = ${feedbackId}
		`;

		const resolution = await getCommunityFeedback(
			sql,
			participant,
			rootEventId,
			feedbackId,
		);
		expect(resolution.feedback.comments).toHaveLength(20);
		expect(resolution.feedback).toMatchObject({
			commentCount: 21,
			commentsHasMore: true,
			statusHistoryCount: 21,
			statusHistoryHasMore: true,
		});
		expect(resolution.feedback.statusHistory).toHaveLength(20);
		expect(Buffer.byteLength(JSON.stringify(resolution))).toBeLessThan(
			1_048_576,
		);
		await expect(
			(async () => {
				await sql`
				INSERT INTO event_feedback_comments (
					id, feedback_id, author_user_id, body
				) VALUES (
					'fbc_bounds_too_long', ${feedbackId}, ${participant.id},
					${"x".repeat(5_001)}
				)
				`;
			})(),
		).rejects.toMatchObject({ code: "23514" });
	});

	test("exposes followed public status updates without actor identity", async () => {
		const rootEventId = "evt_community_updates01";
		const feedbackId = "fbk_community_updates01";
		await root(rootEventId);
		await member(rootEventId, organizer.id, "organizer");
		await member(rootEventId, participant.id, "participant");
		await feedback(participant, rootEventId, feedbackId, {
			title: "Progress is visible",
		});
		await setCommunityFeedbackFollow(
			sql,
			participant,
			rootEventId,
			feedbackId,
			true,
		);
		await service.setFeedbackStatus(
			organizer,
			feedbackId,
			"planned",
			"Scheduled for the next release.",
		);

		const page = await listCommunityFeedbackUpdates(
			sql,
			participant,
			rootEventId,
			{
				limit: 50,
				after: null,
				followedOnly: true,
			},
		);
		expect(page).toMatchObject({
			hasMore: false,
			items: [
				{
					feedbackId,
					title: "Progress is visible",
					version: 2,
					fromStatus: "open",
					toStatus: "planned",
					note: "Scheduled for the next release.",
				},
			],
		});
		expect(JSON.stringify(page)).not.toContain("usr_");
		expect(JSON.stringify(page)).not.toContain("changedBy");

		await sql`
			UPDATE event_memberships SET status = 'removed', version = version + 1,
				updated_at = now(), removed_by = ${owner.id}, removal_reason = 'test'
			WHERE root_event_id = ${rootEventId} AND user_id = ${participant.id}
		`;
		await expect(
			getCommunityFeedback(sql, participant, rootEventId, feedbackId),
		).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
	});

	test("suggests only same-root canonical public feedback with Unicode-safe ranking", async () => {
		const rootEventId = "evt_feedback_suggest01";
		const otherRootEventId = "evt_feedback_suggest02";
		const titleMatchId = "fbk_feedback_suggest_title_z";
		const secondTitleMatchId = "fbk_feedback_suggest_title_a";
		const bodyMatchId = "fbk_feedback_suggest_body";
		const privateId = "fbk_feedback_suggest_private";
		const otherRootId = "fbk_feedback_suggest_other";
		await root(rootEventId);
		await root(otherRootEventId);
		await member(rootEventId, participant.id, "participant");
		await member(rootEventId, reader.id, "participant");
		await member(otherRootEventId, reader.id, "participant");
		await feedback(participant, rootEventId, titleMatchId, {
			title: "Ｃｈｅｃｋ‑ｉｎ Café",
			body: "The arrival flow should be clearer.",
		});
		await feedback(participant, rootEventId, secondTitleMatchId, {
			title: "Check-in café details",
			body: "The second title-ranked candidate.",
		});
		await feedback(participant, rootEventId, bodyMatchId, {
			title: "Arrival flow",
			body: "Please make the check-in café instructions clearer.",
		});
		await feedback(participant, rootEventId, privateId, {
			title: "Check-in private diagnostic",
			visibility: "private",
		});
		await feedback(owner, otherRootEventId, otherRootId, {
			title: "Check-in from another root",
		});
		await service.setFeedbackVote(participant, titleMatchId, true);
		await sql`
			UPDATE event_feedback SET updated_at =
				'2026-07-19 08:09:10.123456+00'::timestamptz
			WHERE id IN (${titleMatchId}, ${secondTitleMatchId})
		`;

		const first = await app.request(
			`/v1/event-roots/${rootEventId}/feedback/duplicate-suggestions?q=${encodeURIComponent("check in café")}&limit=1`,
			{ headers: authorization(reader.id) },
		);
		expect(first.status).toBe(200);
		expect(first.headers.get("cache-control")).toBe("private, no-store");
		const firstBody = await first.json();
		expect(firstBody).toMatchObject({
			items: [
				{
					id: titleMatchId,
					title: "Ｃｈｅｃｋ‑ｉｎ Café",
					status: "open",
					voteCount: 1,
				},
			],
			pageInfo: { hasMore: true },
		});
		expect(Object.keys(firstBody.items[0]).sort()).toEqual([
			"id",
			"status",
			"title",
			"voteCount",
		]);
		const serialized = JSON.stringify(firstBody);
		for (const forbidden of [
			privateId,
			otherRootId,
			"author",
			"diagnostics",
			"attachments",
			"context",
			"rootEventId",
			"duplicateOf",
			"cursorRank",
			"cursorUpdatedAt",
			"usr_",
		]) {
			expect(serialized).not.toContain(forbidden);
		}

		const cursor = firstBody.pageInfo.nextCursor as string;
		const cursorPayload = JSON.parse(
			Buffer.from(cursor.split(".")[0] as string, "base64url").toString("utf8"),
		) as { last: { rank: string; updatedAt: string; id: string } };
		expect(cursorPayload.last).toMatchObject({ rank: "0", id: titleMatchId });
		expect(cursorPayload.last.updatedAt).toContain(".123456");
		const second = await app.request(
			`/v1/event-roots/${rootEventId}/feedback/duplicate-suggestions?q=${encodeURIComponent("ＣＨＥＣＫ IN CAFE\u0301")}&limit=5&cursor=${encodeURIComponent(cursor)}`,
			{ headers: authorization(reader.id) },
		);
		expect(second.status).toBe(200);
		expect(await second.json()).toMatchObject({
			items: [{ id: secondTitleMatchId }, { id: bodyMatchId }],
			pageInfo: { hasMore: false, nextCursor: null },
		});

		for (const [path, actorId] of [
			[
				`/v1/event-roots/${rootEventId}/feedback/duplicate-suggestions?q=another%20query&limit=1&cursor=${encodeURIComponent(cursor)}`,
				reader.id,
			],
			[
				`/v1/event-roots/${rootEventId}/feedback/duplicate-suggestions?q=check%20in%20caf%C3%A9&limit=1&cursor=${encodeURIComponent(cursor)}`,
				participant.id,
			],
			[
				`/v1/event-roots/${otherRootEventId}/feedback/duplicate-suggestions?q=check%20in%20caf%C3%A9&limit=1&cursor=${encodeURIComponent(cursor)}`,
				reader.id,
			],
			[
				`/v1/event-roots/${rootEventId}/feedback/duplicate-suggestions?q=check%20in%20caf%C3%A9&limit=1&cursor=x${encodeURIComponent(cursor.slice(1))}`,
				reader.id,
			],
		] as const) {
			expect(
				(await app.request(path, { headers: authorization(actorId) })).status,
			).toBe(400);
		}
		const concealmentHeaders = (actorId: string) => ({
			...authorization(actorId),
			"X-Request-ID": "feedback.duplicate.concealment",
		});
		const concealed: string[] = [];
		for (const [candidateRootId, actorId] of [
			[rootEventId, outsider.id],
			["evt_feedback_suggest_missing", reader.id],
		] as const) {
			const response = await app.request(
				`/v1/event-roots/${candidateRootId}/feedback/duplicate-suggestions?q=check%20in`,
				{ headers: concealmentHeaders(actorId) },
			);
			expect(response.status).toBe(404);
			expect(response.headers.get("cache-control")).toBe("private, no-store");
			concealed.push(await response.text());
		}
		expect(new Set(concealed).size).toBe(1);

		const malformed: string[] = [];
		for (const [candidateRootId, actorId, query] of [
			[rootEventId, reader.id, ""],
			[rootEventId, outsider.id, ""],
			["evt_feedback_suggest_missing", reader.id, ""],
			[rootEventId, reader.id, "?q=x"],
			[rootEventId, outsider.id, "?q=x"],
			["evt_feedback_suggest_missing", reader.id, "?q=x"],
			[rootEventId, reader.id, "?q=---"],
			[rootEventId, outsider.id, "?q=---"],
			["evt_feedback_suggest_missing", reader.id, "?q=---"],
		] as const) {
			const response = await app.request(
				`/v1/event-roots/${candidateRootId}/feedback/duplicate-suggestions${query}`,
				{ headers: concealmentHeaders(actorId) },
			);
			expect(response.status).toBe(400);
			expect(response.headers.get("cache-control")).toBe("private, no-store");
			malformed.push(await response.text());
		}
		expect(new Set(malformed.slice(0, 3)).size).toBe(1);
		expect(new Set(malformed.slice(3, 6)).size).toBe(1);
		expect(new Set(malformed.slice(6, 9)).size).toBe(1);

		await service.markFeedbackDuplicate(
			owner,
			titleMatchId,
			bodyMatchId,
			"Same arrival issue.",
		);
		await service.markFeedbackDuplicate(
			owner,
			secondTitleMatchId,
			bodyMatchId,
			"Same arrival issue.",
		);
		const afterMerge = await app.request(
			`/v1/event-roots/${rootEventId}/feedback/duplicate-suggestions?q=check%20in%20caf%C3%A9`,
			{ headers: authorization(reader.id) },
		);
		expect(await afterMerge.json()).toMatchObject({
			items: [{ id: bodyMatchId }],
		});
		const staleSelection = await app.request(
			`/v1/event-roots/${rootEventId}/feedback/${titleMatchId}`,
			{ headers: authorization(reader.id) },
		);
		expect(await staleSelection.json()).toMatchObject({
			feedback: { id: bodyMatchId },
			redirectedFromFeedbackId: titleMatchId,
		});

		await sql`
			UPDATE event_memberships SET status = 'removed', version = version + 1,
				updated_at = now(), removed_by = ${owner.id}, removal_reason = 'test'
			WHERE root_event_id = ${rootEventId} AND user_id = ${reader.id}
		`;
		const removed = await app.request(
			`/v1/event-roots/${rootEventId}/feedback/duplicate-suggestions?q=check%20in`,
			{ headers: authorization(reader.id) },
		);
		expect(removed.status).toBe(404);
		expect(await removed.text()).not.toContain(bodyMatchId);
	});

	test("bounds duplicate suggestion input and accepts long normalized Unicode", async () => {
		const rootEventId = "evt_feedback_suggest_long";
		const feedbackId = "fbk_feedback_suggest_long";
		const longWord = "旅".repeat(200);
		await root(rootEventId);
		await member(rootEventId, reader.id, "participant");
		await feedback(owner, rootEventId, feedbackId, {
			title: "Long Unicode report",
			body: `${longWord} needs clearer coordination`,
		});

		const response = await app.request(
			`/v1/event-roots/${rootEventId}/feedback/duplicate-suggestions?q=${encodeURIComponent(longWord)}`,
			{ headers: authorization(reader.id) },
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			items: [{ id: feedbackId }],
		});
		for (const query of ["---", "x", "旅".repeat(501)]) {
			expect(
				(
					await app.request(
						`/v1/event-roots/${rootEventId}/feedback/duplicate-suggestions?q=${encodeURIComponent(query)}`,
						{ headers: authorization(reader.id) },
					)
				).status,
			).toBe(400);
		}
	});

	test("serves signed sanitized community pages and reauthorizes command replay", async () => {
		const rootEventId = "evt_community_api01";
		const otherRootEventId = "evt_community_api02";
		const feedbackId = "fbk_community_api01";
		await root(rootEventId);
		await root(otherRootEventId);
		await member(rootEventId, organizer.id, "organizer");
		await member(rootEventId, participant.id, "participant");
		await member(rootEventId, reader.id, "participant");
		await member(otherRootEventId, reader.id, "participant");
		await feedback(participant, rootEventId, feedbackId, {
			title: "Sanitized API item",
		});
		await feedback(participant, rootEventId, "fbk_community_api02", {
			title: "Second page item",
		});
		await sql`
			UPDATE event_feedback
			SET updated_at = CASE id
				WHEN ${feedbackId} THEN '2026-07-19 01:02:03.123100+00'::timestamptz
				ELSE '2026-07-19 01:02:03.123900+00'::timestamptz
			END
			WHERE id IN (${feedbackId}, 'fbk_community_api02')
		`;

		const first = await app.request(
			`/v1/event-roots/${rootEventId}/feedback?limit=1`,
			{ headers: authorization(reader.id) },
		);
		expect(first.status).toBe(200);
		expect(first.headers.get("cache-control")).toBe("private, no-store");
		const firstBody = await first.json();
		expect(firstBody.items).toHaveLength(1);
		expect(firstBody.pageInfo).toMatchObject({ hasMore: true });
		const cursor = firstBody.pageInfo.nextCursor as string;
		expect(cursor).toBeString();
		expect(JSON.stringify(firstBody)).not.toContain("usr_");
		expect(JSON.stringify(firstBody)).not.toContain("cursorUpdatedAt");
		const cursorPayload = JSON.parse(
			Buffer.from(cursor.split(".")[0] as string, "base64url").toString("utf8"),
		) as { last: { updatedAt: string; id: string } };
		expect(cursorPayload.last.updatedAt).toContain(".1239");
		expect(cursorPayload.last.id).toBe("fbk_community_api02");
		expect(
			[
				...(await sql<{ id: string; cursorUpdatedAt: string }[]>`
					SELECT id, updated_at::text AS "cursorUpdatedAt"
					FROM event_feedback WHERE root_event_id = ${rootEventId}
					ORDER BY updated_at DESC, id DESC
				`),
			].map((item) => [item.id, item.cursorUpdatedAt]),
		).toEqual([
			["fbk_community_api02", expect.stringContaining(".1239")],
			[feedbackId, expect.stringContaining(".1231")],
		]);
		expect(
			(
				await listCommunityFeedback(sql, reader, rootEventId, {
					limit: 1,
					after: cursorPayload.last,
					status: null,
					followedOnly: false,
				})
			).items.map((item) => item.id),
		).toEqual([feedbackId]);

		const second = await app.request(
			`/v1/event-roots/${rootEventId}/feedback?limit=1&cursor=${encodeURIComponent(cursor)}`,
			{ headers: authorization(reader.id) },
		);
		expect(second.status).toBe(200);
		expect(await second.json()).toMatchObject({
			items: [{ title: "Sanitized API item" }],
			pageInfo: { hasMore: false, nextCursor: null },
		});
		const tamperedCursor = `x${cursor.slice(1)}`;
		for (const [path, actorId] of [
			[
				`/v1/event-roots/${rootEventId}/feedback?limit=1&followedOnly=true&cursor=${encodeURIComponent(cursor)}`,
				reader.id,
			],
			[
				`/v1/event-roots/${rootEventId}/feedback?limit=1&status=open&cursor=${encodeURIComponent(cursor)}`,
				reader.id,
			],
			[
				`/v1/event-roots/${rootEventId}/feedback?limit=1&cursor=${encodeURIComponent(cursor)}`,
				participant.id,
			],
			[
				`/v1/event-roots/${otherRootEventId}/feedback?limit=1&cursor=${encodeURIComponent(cursor)}`,
				reader.id,
			],
			[
				`/v1/event-roots/${rootEventId}/feedback?limit=1&cursor=${encodeURIComponent(tamperedCursor)}`,
				reader.id,
			],
		] as const) {
			expect(
				(
					await app.request(path, {
						headers: authorization(actorId),
					})
				).status,
			).toBe(400);
		}

		const followPath = `/v1/event-roots/${rootEventId}/feedback/${feedbackId}/follow`;
		const firstFollow = await apiCommand(
			reader.id,
			followPath,
			"PUT",
			"community-follow-api-0001",
			{ followed: true },
		);
		expect(firstFollow.status).toBe(200);
		expect(firstFollow.headers.get("idempotency-replayed")).toBe("false");
		const firstFollowText = await firstFollow.clone().text();
		expect(await firstFollow.json()).toEqual({ feedbackId, followed: true });
		const replay = await apiCommand(
			reader.id,
			followPath,
			"PUT",
			"community-follow-api-0001",
			{ followed: true },
		);
		expect(replay.headers.get("idempotency-replayed")).toBe("true");
		expect(await replay.text()).toBe(firstFollowText);
		expect(
			(
				await apiCommand(
					reader.id,
					followPath,
					"PUT",
					"community-follow-api-0001",
					{ followed: false },
				)
			).status,
		).toBe(409);

		await service.setFeedbackStatus(
			organizer,
			feedbackId,
			"planned",
			"Public progress note.",
		);
		const updates = await app.request(
			`/v1/event-roots/${rootEventId}/feedback/updates?followedOnly=true`,
			{ headers: authorization(reader.id) },
		);
		expect(updates.status).toBe(200);
		expect(await updates.json()).toMatchObject({
			items: [
				{
					feedbackId,
					fromStatus: "open",
					toStatus: "planned",
					note: "Public progress note.",
				},
			],
		});
		await service.setFeedbackStatus(
			organizer,
			feedbackId,
			"in_progress",
			"Implementation started.",
		);
		await sql`
			UPDATE event_feedback_status_history
			SET changed_at = CASE version
				WHEN 2 THEN '2026-07-19 01:02:04.456100+00'::timestamptz
				ELSE '2026-07-19 01:02:04.456900+00'::timestamptz
			END
			WHERE feedback_id = ${feedbackId} AND version IN (2, 3)
		`;
		const firstUpdatePage = await app.request(
			`/v1/event-roots/${rootEventId}/feedback/updates?limit=1&followedOnly=true`,
			{ headers: authorization(reader.id) },
		);
		expect(firstUpdatePage.status).toBe(200);
		const firstUpdateBody = await firstUpdatePage.json();
		expect(firstUpdateBody).toMatchObject({
			items: [{ version: 3, toStatus: "in_progress" }],
			pageInfo: { hasMore: true },
		});
		expect(JSON.stringify(firstUpdateBody)).not.toContain("cursorChangedAt");
		const updateCursor = firstUpdateBody.pageInfo.nextCursor as string;
		const secondUpdatePage = await app.request(
			`/v1/event-roots/${rootEventId}/feedback/updates?limit=1&followedOnly=true&cursor=${encodeURIComponent(updateCursor)}`,
			{ headers: authorization(reader.id) },
		);
		expect(secondUpdatePage.status).toBe(200);
		expect(await secondUpdatePage.json()).toMatchObject({
			items: [{ version: 2, toStatus: "planned" }],
			pageInfo: { hasMore: false, nextCursor: null },
		});
		const tamperedUpdateCursor = `x${updateCursor.slice(1)}`;
		for (const [path, actorId] of [
			[
				`/v1/event-roots/${rootEventId}/feedback/updates?limit=1&cursor=${encodeURIComponent(updateCursor)}`,
				reader.id,
			],
			[
				`/v1/event-roots/${rootEventId}/feedback/updates?limit=1&followedOnly=true&cursor=${encodeURIComponent(updateCursor)}`,
				participant.id,
			],
			[
				`/v1/event-roots/${otherRootEventId}/feedback/updates?limit=1&followedOnly=true&cursor=${encodeURIComponent(updateCursor)}`,
				reader.id,
			],
			[
				`/v1/event-roots/${rootEventId}/feedback/updates?limit=1&followedOnly=true&cursor=${encodeURIComponent(tamperedUpdateCursor)}`,
				reader.id,
			],
		] as const) {
			expect(
				(
					await app.request(path, {
						headers: authorization(actorId),
					})
				).status,
			).toBe(400);
		}

		const vote = await apiCommand(
			reader.id,
			`/v1/event-roots/${rootEventId}/feedback/${feedbackId}/vote`,
			"PUT",
			"community-vote-api-0001",
			{ present: true },
		);
		expect(vote.status).toBe(200);
		const voteText = await vote.text();
		expect(voteText).not.toContain("usr_");
		expect(voteText).not.toContain("authorUserId");
		expect(voteText).not.toContain("changedBy");
		const commentPath = `/v1/event-roots/${rootEventId}/feedback/${feedbackId}/comments`;
		const commentBody = {
			id: "fbc_community_api01",
			body: "Sanitized replay proof.",
		};
		const comment = await apiCommand(
			reader.id,
			commentPath,
			"POST",
			"community-comment-api-0001",
			commentBody,
		);
		expect(comment.status).toBe(201);
		expect(await comment.text()).not.toContain("usr_");

		await sql`
			UPDATE event_memberships SET status = 'removed', version = version + 1,
				updated_at = now(), removed_by = ${owner.id}, removal_reason = 'test'
			WHERE root_event_id = ${rootEventId} AND user_id = ${reader.id}
		`;
		const concealedReplay = await apiCommand(
			reader.id,
			followPath,
			"PUT",
			"community-follow-api-0001",
			{ followed: true },
		);
		expect(concealedReplay.status).toBe(404);
		expect(await concealedReplay.text()).not.toContain("Sanitized API item");
		for (const [path, method, key, body] of [
			[
				`/v1/event-roots/${rootEventId}/feedback/${feedbackId}/vote`,
				"PUT",
				"community-vote-api-0001",
				{ present: true },
			],
			[commentPath, "POST", "community-comment-api-0001", commentBody],
		] as const) {
			const removedReplay = await apiCommand(
				reader.id,
				path,
				method,
				key,
				body,
			);
			expect(removedReplay.status).toBe(404);
			expect(await removedReplay.text()).not.toContain("Sanitized API item");
		}
	});

	test("conceals root feedback from outsiders and redacts global public identities", async () => {
		const rootEventId = "evt_community_legacy01";
		const rootFeedbackId = "fbk_community_legacy01";
		const globalFeedbackId = "fbk_community_global01";
		await root(rootEventId);
		await member(rootEventId, organizer.id, "organizer");
		await member(rootEventId, participant.id, "participant");
		await member(rootEventId, reader.id, "participant");
		await feedback(participant, rootEventId, rootFeedbackId, {
			title: "Member-only public root item",
		});
		await service.addFeedbackComment(participant, rootFeedbackId, {
			id: "fbc_community_legacy01",
			body: "Member context.",
		});
		await service.setFeedbackStatus(
			organizer,
			rootFeedbackId,
			"planned",
			"Root progress.",
		);

		const memberRead = await app.request(`/v1/feedback/${rootFeedbackId}`, {
			headers: authorization(reader.id),
		});
		expect(memberRead.status).toBe(200);
		expect(await memberRead.json()).toMatchObject({
			feedback: {
				authorUserId: null,
				comments: [{ authorUserId: null }],
				statusHistory: [{ changedBy: null }, { changedBy: null }],
			},
		});
		expect(
			(
				await app.request(`/v1/feedback/${rootFeedbackId}`, {
					headers: authorization(outsider.id),
				})
			).status,
		).toBe(404);
		expect(
			(
				await apiCommand(
					outsider.id,
					`/v1/feedback/${rootFeedbackId}/vote`,
					"PUT",
					"community-root-outsider-vote-01",
					{ present: true },
				)
			).status,
		).toBe(404);
		expect(
			(
				await apiCommand(
					outsider.id,
					`/v1/feedback/${rootFeedbackId}/comments`,
					"POST",
					"community-root-outsider-comment-01",
					{ id: "fbc_community_outsider01", body: "Must not land." },
				)
			).status,
		).toBe(404);

		await service.createFeedback(owner, {
			id: globalFeedbackId,
			title: "Global product idea",
			body: "Global signed-in community remains available.",
			visibility: "public",
			rootEventId: null,
			eventId: null,
			screenKey: "settings.feedback",
			diagnostics: { deviceModel: "must-stay-private" },
			attachmentIds: [],
		});
		await service.addFeedbackComment(participant, globalFeedbackId, {
			id: "fbc_community_global01",
			body: "Global comment.",
		});
		await service.setFeedbackStatus(
			owner,
			globalFeedbackId,
			"planned",
			"Global progress.",
		);
		const globalRead = await app.request(`/v1/feedback/${globalFeedbackId}`, {
			headers: authorization(outsider.id),
		});
		expect(globalRead.status).toBe(200);
		expect(await globalRead.json()).toMatchObject({
			feedback: {
				authorUserId: null,
				diagnostics: null,
				comments: [{ authorUserId: null }],
				statusHistory: [{ changedBy: null }, { changedBy: null }],
			},
		});
		const globalVote = await apiCommand(
			outsider.id,
			`/v1/feedback/${globalFeedbackId}/vote`,
			"PUT",
			"community-global-vote-01",
			{ present: true },
		);
		expect(globalVote.status).toBe(200);
		expect((await globalVote.json()).feedback).toMatchObject({
			authorUserId: null,
			viewerHasVoted: true,
		});
		const globalComment = await apiCommand(
			outsider.id,
			`/v1/feedback/${globalFeedbackId}/comments`,
			"POST",
			"community-global-comment-01",
			{ id: "fbc_community_global02", body: "Another global comment." },
		);
		expect(globalComment.status).toBe(201);
		expect(JSON.stringify((await globalComment.json()).feedback)).not.toContain(
			"usr_",
		);
	});

	test("publishes the complete sanitized community contract", async () => {
		const document = await (await app.request("/docs/openapi.json")).json();
		for (const [path, method, operationId] of [
			["/v1/event-roots/{rootEventId}/feedback", "get", "eventFeedbackList"],
			[
				"/v1/event-roots/{rootEventId}/feedback/duplicate-suggestions",
				"get",
				"eventFeedbackDuplicateSuggestionsList",
			],
			[
				"/v1/event-roots/{rootEventId}/feedback/updates",
				"get",
				"eventFeedbackUpdatesList",
			],
			[
				"/v1/event-roots/{rootEventId}/feedback/{feedbackId}",
				"get",
				"eventFeedbackGet",
			],
			[
				"/v1/event-roots/{rootEventId}/feedback/{feedbackId}/vote",
				"put",
				"eventFeedbackVotesSet",
			],
			[
				"/v1/event-roots/{rootEventId}/feedback/{feedbackId}/comments",
				"post",
				"eventFeedbackCommentsCreate",
			],
			[
				"/v1/event-roots/{rootEventId}/feedback/{feedbackId}/follow",
				"put",
				"eventFeedbackFollowsSet",
			],
		] as const) {
			expect(document.paths[path][method].operationId).toBe(operationId);
		}
		const schemas = JSON.stringify({
			duplicateSuggestion:
				document.components.schemas.CommunityFeedbackDuplicateSuggestion,
			summary: document.components.schemas.CommunityFeedbackSummary,
			detail: document.components.schemas.CommunityFeedbackDetail,
			comment: document.components.schemas.CommunityFeedbackComment,
			history: document.components.schemas.CommunityFeedbackStatusChange,
			update: document.components.schemas.CommunityFeedbackUpdate,
		});
		for (const forbidden of [
			"authorUserId",
			"changedBy",
			"diagnostics",
			"attachments",
			"rootEventId",
			"eventId",
			"sourceFeedbackId",
		]) {
			expect(schemas).not.toContain(forbidden);
		}
		const detail = document.components.schemas.CommunityFeedbackDetail;
		expect(detail.allOf).toBeUndefined();
		expect(detail.additionalProperties).toBe(false);
		expect(detail.required).toEqual(
			expect.arrayContaining(["id", "comments", "statusHistory"]),
		);
		expect(detail.properties.comments.maxItems).toBe(20);
		expect(detail.properties.statusHistory.maxItems).toBe(20);
		expect(
			document.paths[
				"/v1/event-roots/{rootEventId}/feedback/duplicate-suggestions"
			].get.parameters.find(
				(parameter: { name: string }) => parameter.name === "limit",
			).schema.maximum,
		).toBe(5);
		expect(
			document.paths[
				"/v1/event-roots/{rootEventId}/feedback"
			].get.parameters.find(
				(parameter: { name: string }) => parameter.name === "limit",
			).schema.maximum,
		).toBe(10);
		expect(
			document.paths[
				"/v1/event-roots/{rootEventId}/feedback/updates"
			].get.parameters.find(
				(parameter: { name: string }) => parameter.name === "limit",
			).schema.maximum,
		).toBe(50);
	});
});

async function root(rootEventId: string) {
	await service.createRoot(owner, rootInput(rootEventId));
}

async function member(
	rootEventId: string,
	memberUserId: string,
	role: "organizer" | "participant",
) {
	await sql`
		INSERT INTO event_memberships (root_event_id, user_id, role, status)
		VALUES (${rootEventId}, ${memberUserId}, ${role}, 'active')
	`;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number) {
	let timeout: ReturnType<typeof setTimeout> | null = null;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error("Concurrent feedback write timed out.")),
					milliseconds,
				);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

async function waitForDatabaseLock(tx: Sql, backendPid: number) {
	let lastActivity: { waitEventType: string | null; query: string } | undefined;
	for (let attempt = 0; attempt < 200; attempt += 1) {
		const [activity] = await tx<
			{ waitEventType: string | null; query: string }[]
		>`
			SELECT wait_event_type AS "waitEventType", query
			FROM pg_stat_activity WHERE pid = ${backendPid}
		`;
		lastActivity = activity;
		if (activity?.waitEventType === "Lock") return;
		await Bun.sleep(5);
	}
	throw new Error(
		`Feedback reader did not reach the membership lock barrier: ${JSON.stringify(lastActivity)}`,
	);
}

function authorization(actorId: string) {
	return { Authorization: `Bearer ${actorId}` };
}

function apiCommand(
	actorId: string,
	path: string,
	method: "POST" | "PUT",
	idempotencyKey: string,
	body: Record<string, unknown>,
) {
	return app.request(path, {
		method,
		headers: {
			...authorization(actorId),
			"Content-Type": "application/json",
			"Idempotency-Key": idempotencyKey,
		},
		body: JSON.stringify(body),
	});
}

async function feedback(
	actor: { id: string },
	rootEventId: string,
	id: string,
	overrides: {
		title?: string;
		body?: string;
		visibility?: "public" | "private";
	} = {},
) {
	return service.createFeedback(actor, {
		id,
		title: overrides.title ?? id,
		body: overrides.body ?? "Durable community feedback body.",
		visibility: overrides.visibility ?? "public",
		rootEventId,
		eventId: null,
		screenKey: "settings.feedback",
		diagnostics: { deviceModel: "must-never-be-public" },
		attachmentIds: [],
	});
}

function rootInput(id: string): EventInput {
	return {
		id,
		kind: "team_event",
		title: id,
		description: "Community feedback root",
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		status: "published",
	};
}
