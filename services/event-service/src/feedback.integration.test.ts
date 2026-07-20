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
import { PostgresEventRepository } from "./postgres-repository";
import { EventService } from "./service";
import { installPublishedRootFixtures } from "./test-published-root-fixture";

const databaseUrl =
	Bun.env.EVENT_TEST_DATABASE_URL ?? "postgres://localhost/crew_event_test";
const userId = (value: number) => `usr_${value.toString(16).padStart(32, "0")}`;
const owner = { id: userId(801) };
const organizer = { id: userId(802) };
const participant = { id: userId(803) };
const outsider = { id: userId(804) };
const otherOwner = { id: userId(805) };
const reader = { id: userId(806) };

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
				kid: "feedback-test-v1",
				key: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
			}),
		),
		"feedback-test-invitation-key-with-at-least-32-characters",
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

describe("community feedback against PostgreSQL 17", () => {
	test("creates contextual public/private feedback and conceals diagnostics and event assets", async () => {
		const rootEventId = "evt_feedback_root01";
		const otherRootEventId = "evt_feedback_root02";
		await service.createRoot(owner, rootInput(rootEventId));
		await service.createRoot(otherOwner, rootInput(otherRootEventId));
		await addMember(rootEventId, organizer.id, "organizer");
		await addMember(rootEventId, participant.id, "participant");
		await addMember(rootEventId, reader.id, "participant");
		const attachmentId = await committedAttachment(
			rootEventId,
			owner.id,
			"fed_feedback_asset01",
			"att_feedback_asset01",
			"upl_feedback_asset01",
		);
		const otherAttachmentId = await committedAttachment(
			otherRootEventId,
			otherOwner.id,
			"fed_feedback_asset02",
			"att_feedback_asset02",
			"upl_feedback_asset02",
		);

		const privatePayload = {
			id: "fbk_private_context01",
			title: "Offline image issue",
			body: "The selected image did not appear after reconnecting.",
			visibility: "private",
			rootEventId,
			eventId: rootEventId,
			screenKey: "feed.composer",
			diagnostics: {
				appVersion: "1.0.0",
				buildNumber: "42",
				platform: "ios",
				osVersion: "26.0",
				deviceModel: "iPhone",
				locale: "de-CH",
			},
			attachmentIds: [attachmentId],
		};
		const first = await createFeedback(
			participant.id,
			"feedback-private-create-01",
			privatePayload,
		);
		expect(first.status).toBe(201);
		expect(first.headers.get("location")).toBe(
			"/v1/feedback/fbk_private_context01",
		);
		expect(first.headers.get("cache-control")).toBe("private, no-store");
		expect(first.headers.get("idempotency-replayed")).toBe("false");
		const firstText = await first.clone().text();
		expect(await first.json()).toMatchObject({
			feedback: {
				id: privatePayload.id,
				context: {
					rootEventId,
					eventId: rootEventId,
					screenKey: "feed.composer",
				},
				diagnostics: { appVersion: "1.0.0", platform: "ios" },
				attachments: [{ id: attachmentId, contentType: "image/jpeg" }],
				status: "open",
				version: 1,
				statusHistory: [
					{
						version: 1,
						fromStatus: null,
						toStatus: "open",
						changedBy: participant.id,
					},
				],
			},
		});

		const replay = await createFeedback(
			participant.id,
			"feedback-private-create-01",
			privatePayload,
		);
		expect(replay.headers.get("idempotency-replayed")).toBe("true");
		expect(await replay.text()).toBe(firstText);

		const managerRead = await readFeedback(organizer.id, privatePayload.id);
		expect(managerRead.status).toBe(200);
		expect(await managerRead.json()).toMatchObject({
			feedback: {
				diagnostics: { buildNumber: "42" },
				attachments: [{ id: attachmentId }],
			},
		});
		const outsiderPrivate = await readFeedback(outsider.id, privatePayload.id);
		expect(outsiderPrivate.status).toBe(404);
		expect(outsiderPrivate.headers.get("cache-control")).toBe(
			"private, no-store",
		);

		const publicPayload = {
			...privatePayload,
			id: "fbk_public_context01",
			visibility: "public",
			title: "Improve the offline composer",
		};
		expect(
			(
				await createFeedback(
					participant.id,
					"feedback-public-create-01",
					publicPayload,
				)
			).status,
		).toBe(201);
		const outsiderPublic = await readFeedback(outsider.id, publicPayload.id);
		expect(outsiderPublic.status).toBe(404);
		const readerPublic = await readFeedback(reader.id, publicPayload.id);
		expect(readerPublic.status).toBe(200);
		expect(await readerPublic.json()).toMatchObject({
			feedback: {
				authorUserId: null,
				visibility: "public",
				context: {
					rootEventId,
					eventId: rootEventId,
					screenKey: "feed.composer",
				},
				diagnostics: null,
				attachments: [{ id: attachmentId }],
				statusHistory: [{ changedBy: null }],
			},
		});

		const crossRoot = await createFeedback(
			participant.id,
			"feedback-cross-root-01",
			{
				...publicPayload,
				id: "fbk_cross_root_asset01",
				attachmentIds: [otherAttachmentId],
			},
		);
		expect(crossRoot.status).toBe(404);
		expect(
			await sql`SELECT id FROM event_feedback WHERE id = 'fbk_cross_root_asset01'`,
		).toHaveLength(0);

		await service.removeFeedEntry(
			owner,
			rootEventId,
			"fed_feedback_asset01",
			1,
		);
		const removedSourceRead = await readFeedback(
			participant.id,
			publicPayload.id,
		);
		expect(removedSourceRead.status).toBe(200);
		expect(await removedSourceRead.json()).toMatchObject({
			feedback: { attachments: [] },
		});

		await sql`
			UPDATE event_memberships SET status = 'removed', version = version + 1,
				updated_at = now(), removed_by = ${owner.id}, removal_reason = 'test'
			WHERE root_event_id = ${rootEventId} AND user_id = ${participant.id}
		`;
		const removedAuthorRead = await readFeedback(
			participant.id,
			publicPayload.id,
		);
		expect(removedAuthorRead.status).toBe(200);
		expect(await removedAuthorRead.json()).toMatchObject({
			feedback: {
				authorUserId: participant.id,
				statusHistory: [{ changedBy: participant.id }],
			},
		});
		const staleAssetReplay = await createFeedback(
			participant.id,
			"feedback-private-create-01",
			privatePayload,
		);
		expect(staleAssetReplay.status).toBe(404);
		expect(await staleAssetReplay.text()).not.toContain(attachmentId);
	});

	test("stores one vote per user, comments, duplicates and manager-only status history", async () => {
		const rootEventId = "evt_feedback_flow01";
		await service.createRoot(owner, rootInput(rootEventId));
		await addMember(rootEventId, organizer.id, "organizer");
		await addMember(rootEventId, participant.id, "participant");
		await addMember(rootEventId, reader.id, "participant");
		for (const [id, title, key] of [
			["fbk_flow_source01", "First report", "feedback-flow-source-01"],
			[
				"fbk_flow_canonical01",
				"Canonical report",
				"feedback-flow-canonical-01",
			],
		] as const) {
			const response = await createFeedback(participant.id, key, {
				id,
				title,
				body: "A durable community report.",
				visibility: "public",
				rootEventId,
				eventId: null,
				screenKey: "settings.feedback",
				diagnostics: null,
				attachmentIds: [],
			});
			expect(response.status).toBe(201);
		}

		const voted = await commandRequest(
			reader.id,
			"/v1/feedback/fbk_flow_source01/vote",
			"PUT",
			"feedback-vote-outsider-01",
			{ present: true },
		);
		expect(voted.status).toBe(200);
		expect(await voted.json()).toMatchObject({
			feedback: { voteCount: 1, viewerHasVoted: true },
		});
		const secondKeySameVote = await commandRequest(
			reader.id,
			"/v1/feedback/fbk_flow_source01/vote",
			"PUT",
			"feedback-vote-outsider-02",
			{ present: true },
		);
		expect(await secondKeySameVote.json()).toMatchObject({
			feedback: { voteCount: 1, viewerHasVoted: true },
		});

		const commented = await commandRequest(
			reader.id,
			"/v1/feedback/fbk_flow_source01/comments",
			"POST",
			"feedback-comment-outsider-01",
			{ id: "fbc_flow_comment01", body: "This also happens on Android." },
		);
		expect(commented.status).toBe(201);
		expect(commented.headers.get("location")).toBe(
			"/v1/feedback/fbk_flow_source01/comments/fbc_flow_comment01",
		);
		expect(await commented.json()).toMatchObject({
			feedback: {
				comments: [{ id: "fbc_flow_comment01", authorUserId: null }],
			},
		});

		const participantStatus = await commandRequest(
			participant.id,
			"/v1/feedback/fbk_flow_source01/status",
			"PUT",
			"feedback-status-participant-01",
			{ status: "planned", note: "Self promotion must not be accepted." },
		);
		expect(participantStatus.status).toBe(403);

		for (const [index, status] of [
			"planned",
			"in_progress",
			"completed",
		].entries()) {
			const response = await commandRequest(
				organizer.id,
				"/v1/feedback/fbk_flow_source01/status",
				"PUT",
				`feedback-status-manager-0${index + 1}`,
				{ status, note: `Manager transition ${index + 1}` },
			);
			expect(response.status).toBe(200);
		}
		const reopened = await commandRequest(
			organizer.id,
			"/v1/feedback/fbk_flow_source01/status",
			"PUT",
			"feedback-status-manager-04",
			{ status: "open", note: "Regression confirmed." },
		);
		expect(reopened.status).toBe(200);

		const duplicated = await commandRequest(
			organizer.id,
			"/v1/feedback/fbk_flow_source01/duplicate",
			"POST",
			"feedback-duplicate-manager-01",
			{
				canonicalFeedbackId: "fbk_flow_canonical01",
				note: "Same root cause.",
			},
		);
		expect(duplicated.status).toBe(200);
		expect(await duplicated.json()).toMatchObject({
			feedback: {
				status: "duplicate",
				duplicateOfFeedbackId: "fbk_flow_canonical01",
				version: 6,
				voteCount: 1,
				comments: [{ id: "fbc_flow_comment01" }],
				statusHistory: [
					{ version: 1, fromStatus: null, toStatus: "open" },
					{ version: 2, fromStatus: "open", toStatus: "planned" },
					{ version: 3, fromStatus: "planned", toStatus: "in_progress" },
					{ version: 4, fromStatus: "in_progress", toStatus: "completed" },
					{ version: 5, fromStatus: "completed", toStatus: "open" },
					{ version: 6, fromStatus: "open", toStatus: "duplicate" },
				],
			},
		});

		const proof = await sql<
			{
				votes: number;
				comments: number;
				history: number;
				posthogColumns: number;
			}[]
		>`
			SELECT
				(SELECT count(*)::int FROM event_feedback_votes
					WHERE feedback_id = 'fbk_flow_source01') AS votes,
				(SELECT count(*)::int FROM event_feedback_comments
					WHERE feedback_id = 'fbk_flow_source01') AS comments,
				(SELECT count(*)::int FROM event_feedback_status_history
					WHERE feedback_id = 'fbk_flow_source01') AS history,
				(SELECT count(*)::int FROM information_schema.columns
					WHERE table_name LIKE 'event_feedback%'
						AND column_name LIKE '%posthog%') AS "posthogColumns"
		`;
		expect(proof[0]).toEqual({
			votes: 1,
			comments: 1,
			history: 6,
			posthogColumns: 0,
		});
	});

	test("does not replay manager-visible identities after organizer demotion", async () => {
		const rootEventId = "evt_feedback_replay_priv01";
		const feedbackId = "fbk_feedback_replay_priv01";
		await service.createRoot(owner, rootInput(rootEventId));
		await addMember(rootEventId, organizer.id, "organizer");
		await addMember(rootEventId, participant.id, "participant");
		expect(
			(
				await createFeedback(
					participant.id,
					"feedback-replay-private-create-01",
					{
						id: feedbackId,
						title: "Replay redaction",
						body: "The manager response must not survive demotion.",
						visibility: "public",
						rootEventId,
						eventId: null,
						screenKey: "settings.feedback",
						diagnostics: null,
						attachmentIds: [],
					},
				)
			).status,
		).toBe(201);

		const votePath = `/v1/feedback/${feedbackId}/vote`;
		const voteBody = { present: true };
		const firstVote = await commandRequest(
			organizer.id,
			votePath,
			"PUT",
			"feedback-replay-manager-vote-01",
			voteBody,
		);
		expect(firstVote.status).toBe(200);
		expect(await firstVote.json()).toMatchObject({
			feedback: {
				authorUserId: participant.id,
				statusHistory: [{ changedBy: participant.id }],
			},
		});

		const commentPath = `/v1/feedback/${feedbackId}/comments`;
		const commentBody = {
			id: "fbc_feedback_replay_priv01",
			body: "Manager-visible replay proof.",
		};
		const firstComment = await commandRequest(
			organizer.id,
			commentPath,
			"POST",
			"feedback-replay-manager-comment-01",
			commentBody,
		);
		expect(firstComment.status).toBe(201);
		expect(await firstComment.json()).toMatchObject({
			feedback: {
				authorUserId: participant.id,
				comments: [{ authorUserId: organizer.id }],
			},
		});

		await sql`
			UPDATE event_memberships
			SET role = 'participant', version = version + 1, updated_at = now()
			WHERE root_event_id = ${rootEventId} AND user_id = ${organizer.id}
		`;
		const voteReplay = await commandRequest(
			organizer.id,
			votePath,
			"PUT",
			"feedback-replay-manager-vote-01",
			voteBody,
		);
		expect(voteReplay.status).toBe(403);
		expect(await voteReplay.text()).not.toContain(participant.id);
		const commentReplay = await commandRequest(
			organizer.id,
			commentPath,
			"POST",
			"feedback-replay-manager-comment-01",
			commentBody,
		);
		expect(commentReplay.status).toBe(403);
		const commentReplayText = await commentReplay.text();
		expect(commentReplayText).not.toContain(participant.id);
		expect(commentReplayText).not.toContain(organizer.id);
	});

	test("normalizes legacy successful feedback replays without deleting domain data", async () => {
		const feedbackId = "fbk_feedback_legacy_replay01";
		const key = "feedback-legacy-replay-create-01";
		const payload = {
			id: feedbackId,
			title: "Legacy replay",
			body: "Normalize only the stored response projection.",
			visibility: "public",
			rootEventId: null,
			eventId: null,
			screenKey: "settings.feedback",
			diagnostics: null,
			attachmentIds: [],
		};
		const created = await createFeedback(outsider.id, key, payload);
		expect(created.status).toBe(201);
		const legacy = (await created.json()) as {
			feedback: Record<string, unknown>;
		};
		for (const field of [
			"commentCount",
			"commentsHasMore",
			"statusHistoryCount",
			"statusHistoryHasMore",
		]) {
			delete legacy.feedback[field];
		}
		legacy.feedback.comments = Array.from({ length: 25 }, (_, index) => ({
			id: `fbc_legacy_${(index + 1).toString().padStart(2, "0")}`,
			authorUserId: outsider.id,
			body: `Legacy comment ${index + 1}`,
			createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
		}));
		legacy.feedback.statusHistory = Array.from({ length: 25 }, (_, index) => ({
			version: index + 1,
			fromStatus: index === 0 ? null : "open",
			toStatus: index % 2 === 0 ? "open" : "planned",
			changedBy: outsider.id,
			note: null,
			changedAt: new Date(Date.UTC(2026, 0, 1, 0, 1, index)).toISOString(),
		}));
		await sql`
			UPDATE event_idempotency_records SET response_body = ${sql.json(legacy as never)}
			WHERE actor_id = ${outsider.id} AND operation_id = 'feedbackCreate'
				AND idempotency_key = ${key}
		`;

		const migration = await Bun.file(
			new URL("../migrations/0023_feedback_community.sql", import.meta.url),
		).text();
		const normalization = migration.match(
			/-- feedback replay normalization begin\n([\s\S]*?)\n-- feedback replay normalization end/,
		)?.[1];
		expect(normalization).toBeString();
		await sql.unsafe(normalization as string);

		const replay = await createFeedback(outsider.id, key, payload);
		expect(replay.status).toBe(201);
		expect(replay.headers.get("idempotency-replayed")).toBe("true");
		const feedback = (await replay.json()).feedback;
		expect(feedback).toMatchObject({
			commentCount: 25,
			commentsHasMore: true,
			statusHistoryCount: 25,
			statusHistoryHasMore: true,
		});
		expect(feedback.comments).toHaveLength(20);
		expect(feedback.comments[0].id).toBe("fbc_legacy_06");
		expect(feedback.statusHistory).toHaveLength(20);
		expect(feedback.statusHistory[0].version).toBe(6);
		expect(
			await sql`SELECT id FROM event_feedback WHERE id = ${feedbackId}`,
		).toHaveLength(1);
	});

	test("enforces comment capacity without blocking vote removal", async () => {
		const feedbackId = "fbk_feedback_capacity01";
		expect(
			(
				await createFeedback(outsider.id, "feedback-capacity-create-01", {
					id: feedbackId,
					title: "Capacity regression",
					body: "Comment capacity must not affect vote removal.",
					visibility: "public",
					rootEventId: null,
					eventId: null,
					screenKey: "settings.feedback",
					diagnostics: null,
					attachmentIds: [],
				})
			).status,
		).toBe(201);
		expect(
			(
				await commandRequest(
					outsider.id,
					`/v1/feedback/${feedbackId}/vote`,
					"PUT",
					"feedback-capacity-vote-01",
					{ present: true },
				)
			).status,
		).toBe(200);
		expect(
			(
				await commandRequest(
					outsider.id,
					`/v1/feedback/${feedbackId}/comments`,
					"POST",
					"feedback-capacity-comment-too-long-01",
					{ id: "fbc_capacity_too_long", body: "x".repeat(5_001) },
				)
			).status,
		).toBe(400);
		await sql`
			INSERT INTO event_feedback_comments (
				id, feedback_id, author_user_id, body, created_at
			)
			SELECT 'fbc_capacity_' || lpad(value::text, 4, '0'), ${feedbackId},
				${outsider.id}, 'seed', now() + value * interval '1 microsecond'
			FROM generate_series(1, 1000) value
		`;

		const unvoted = await commandRequest(
			outsider.id,
			`/v1/feedback/${feedbackId}/vote`,
			"PUT",
			"feedback-capacity-vote-02",
			{ present: false },
		);
		expect(unvoted.status).toBe(200);
		expect((await unvoted.json()).feedback).toMatchObject({
			voteCount: 0,
			viewerHasVoted: false,
			commentCount: 1_000,
			commentsHasMore: true,
		});

		const overflow = await commandRequest(
			outsider.id,
			`/v1/feedback/${feedbackId}/comments`,
			"POST",
			"feedback-capacity-comment-01",
			{ id: "fbc_capacity_overflow", body: "one too many" },
		);
		expect(overflow.status).toBe(409);
		expect((await overflow.json()).error.code).toBe(
			"FEEDBACK_COMMENT_LIMIT_REACHED",
		);
	});

	test("publishes the complete feedback OpenAPI without an analytics dependency", async () => {
		const document = await (await app.request("/docs/openapi.json")).json();
		expect(document.paths["/v1/feedback"].post).toMatchObject({
			operationId: "feedbackCreate",
			"x-idempotency": "required",
			"x-source-of-truth": "event-service-postgresql",
		});
		for (const [path, method] of [
			["/v1/feedback/{feedbackId}", "get"],
			["/v1/feedback/{feedbackId}/vote", "put"],
			["/v1/feedback/{feedbackId}/comments", "post"],
			["/v1/feedback/{feedbackId}/duplicate", "post"],
			["/v1/feedback/{feedbackId}/status", "put"],
		] as const) {
			expect(document.paths[path][method]).toBeDefined();
		}
		expect(JSON.stringify(document.paths["/v1/feedback"].post)).toContain(
			"PostHog",
		);
	});
});

function createFeedback(
	actorId: string,
	idempotencyKey: string,
	body: Record<string, unknown>,
) {
	return commandRequest(actorId, "/v1/feedback", "POST", idempotencyKey, body);
}

function readFeedback(actorId: string, feedbackId: string) {
	return app.request(`/v1/feedback/${feedbackId}`, {
		headers: { Authorization: `Bearer ${actorId}` },
	});
}

function commandRequest(
	actorId: string,
	path: string,
	method: "POST" | "PUT",
	idempotencyKey: string,
	body: Record<string, unknown>,
) {
	return app.request(path, {
		method,
		headers: {
			Authorization: `Bearer ${actorId}`,
			"Content-Type": "application/json",
			"Idempotency-Key": idempotencyKey,
		},
		body: JSON.stringify(body),
	});
}

function rootInput(id: string): EventInput {
	return {
		id,
		kind: "team_event",
		title: id,
		description: "Feedback test root",
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		status: "published",
	};
}

async function addMember(
	rootEventId: string,
	memberId: string,
	role: "organizer" | "participant",
) {
	await sql`
		INSERT INTO event_memberships (root_event_id, user_id, role, status)
		VALUES (${rootEventId}, ${memberId}, ${role}, 'active')
	`;
}

async function committedAttachment(
	rootEventId: string,
	actorId: string,
	entryId: string,
	attachmentId: string,
	uploadId: string,
) {
	await service.createFeedEntry(
		actorId === owner.id ? owner : otherOwner,
		rootEventId,
		{
			id: entryId,
			eventId: rootEventId,
			parentEntryId: null,
			kind: "message",
			body: "Feedback attachment source",
		},
	);
	const sha256 = "a".repeat(64);
	const quarantineObjectKey = `quarantine/${rootEventId}/${attachmentId}/${uploadId}/1024-${sha256}`;
	const objectKey = `committed/${rootEventId}/${attachmentId}/${uploadId}/${sha256}`;
	const [root] = await sql<{ revision: string }[]>`
		SELECT revision::text AS revision FROM event_roots
		WHERE root_event_id = ${rootEventId}
	`;
	if (!root) throw new Error("Missing attachment root fixture");
	await sql`
		INSERT INTO event_attachment_uploads (
			id, attachment_id, root_event_id, target_entry_id, created_by,
			quarantine_object_key, content_type, byte_count, sha256, grant_kid,
			grant_ciphertext, state, expires_at, committed_at
		) VALUES (
			${uploadId}, ${attachmentId}, ${rootEventId}, ${entryId}, ${actorId},
			${quarantineObjectKey}, 'image/jpeg', 1024, ${sha256}, 'test-v1',
			${"x".repeat(32)}, 'committed', now() + interval '1 hour', now()
		)
	`;
	await sql`
		INSERT INTO event_attachments (
			id, root_event_id, target_entry_id, upload_id, created_by, object_key,
			content_type, byte_count, sha256, caption, root_revision
		) VALUES (
			${attachmentId}, ${rootEventId}, ${entryId}, ${uploadId}, ${actorId},
			${objectKey}, 'image/jpeg', 1024, ${sha256}, 'Evidence', ${root.revision}
		)
	`;
	return attachmentId;
}
