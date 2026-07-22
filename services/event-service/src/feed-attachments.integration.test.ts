import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { createHash } from "node:crypto";
import postgres, { type Sql } from "postgres";
import sharp from "sharp";
import { migrate } from "../scripts/migrate";
import { createApp } from "./app";
import { PostgresAttachmentJobRepository } from "./attachment-jobs";
import { attachmentCommittedKey } from "./attachment-keys";
import { createAttachmentWorker } from "./attachment-worker";
import type { EventInput } from "./domain";
import { EventNotificationPayloadCodec } from "./event-notification-payload";
import type { DownloadGrant, UploadGrant } from "./feed-domain";
import {
	type CommittedFeedbackDeleteSpec,
	ObjectVerificationError,
	type PrivateObjectStore,
	type QuarantineDeleteSpec,
	UploadGrantCodec,
	type UploadObjectSpec,
	verifyAttachmentBytes,
} from "./object-store";
import { PostgresEventRepository } from "./postgres-repository";
import { EventService } from "./service";
import { installPublishedRootFixtures } from "./test-published-root-fixture";

const databaseUrl =
	Bun.env.EVENT_TEST_DATABASE_URL ?? "postgres://localhost/crew_event_test";
const userId = (value: number) => `usr_${value.toString(16).padStart(32, "0")}`;
const owner = { id: userId(101) };
const participant = { id: userId(102) };
const viewer = { id: userId(103) };
const outsider = { id: userId(104) };
const attachmentApiAclRole = "crew_attachment_cleanup_api_acl_test";
const attachmentWorkerAclRole = "crew_attachment_cleanup_worker_acl_test";
const attachmentOtherWorkerAclRole =
	"crew_attachment_cleanup_other_worker_acl_test";

let sql: Sql;
let store: MemoryObjectStore;
let service: EventService;
let png: Buffer;

beforeAll(async () => {
	sql = postgres(databaseUrl, { max: 12 });
	await migrate(sql);
	await sql.unsafe(`
		DO $body$
		BEGIN
			IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${attachmentApiAclRole}') THEN
				CREATE ROLE ${attachmentApiAclRole} NOLOGIN;
			END IF;
			IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${attachmentWorkerAclRole}') THEN
				CREATE ROLE ${attachmentWorkerAclRole} NOLOGIN;
			END IF;
			IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${attachmentOtherWorkerAclRole}') THEN
				CREATE ROLE ${attachmentOtherWorkerAclRole} NOLOGIN;
			END IF;
		END;
		$body$;
		GRANT USAGE ON SCHEMA public TO
			${attachmentApiAclRole}, ${attachmentWorkerAclRole},
			${attachmentOtherWorkerAclRole};
		GRANT SELECT, INSERT ON event_attachments TO ${attachmentApiAclRole};
		GRANT SELECT, UPDATE ON event_attachment_verify_jobs,
			event_attachment_cleanup_jobs, event_attachment_uploads
			TO ${attachmentWorkerAclRole};
		GRANT SELECT ON event_attachments, event_feedback_attachments
			TO ${attachmentWorkerAclRole};
		REVOKE EXECUTE ON FUNCTION delete_claimed_feedback_attachment(
			TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
		) FROM ${attachmentApiAclRole}, ${attachmentWorkerAclRole},
			${attachmentOtherWorkerAclRole};
		GRANT EXECUTE ON FUNCTION delete_claimed_feedback_attachment(
			TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT
		) TO ${attachmentWorkerAclRole};
	`);
	png = await sharp({
		create: {
			width: 2,
			height: 2,
			channels: 4,
			background: { r: 20, g: 40, b: 60, alpha: 1 },
		},
	})
		.png()
		.toBuffer();
});

beforeEach(async () => {
	await sql`TRUNCATE event_idempotency_records, event_roots CASCADE`;
	store = new MemoryObjectStore();
	service = new EventService(
		new PostgresEventRepository(
			sql,
			new EventNotificationPayloadCodec({
				kid: "test-v1",
				key: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
			}),
		),
		"feed-test-invitation-key-with-at-least-32-characters",
		{
			objectStore: store,
			grantCodec: new UploadGrantCodec(
				"current-v2",
				"current-feed-upload-grant-key-at-least-32-characters",
				[
					{
						kid: "previous-v1",
						secret: "previous-feed-upload-grant-key-at-least-32-characters",
					},
				],
			),
			uploadTtlSeconds: 300,
			downloadTtlSeconds: 60,
		},
	);
	installPublishedRootFixtures(service, sql);
});

afterAll(async () => {
	await sql.unsafe(`
		DROP OWNED BY ${attachmentApiAclRole};
		DROP OWNED BY ${attachmentWorkerAclRole};
		DROP OWNED BY ${attachmentOtherWorkerAclRole};
		DROP ROLE ${attachmentApiAclRole};
		DROP ROLE ${attachmentWorkerAclRole};
		DROP ROLE ${attachmentOtherWorkerAclRole};
	`);
	await sql.end();
});

describe("durable event feed and attachments", () => {
	test("conceals stored feed errors when their target is hidden or moderated", async () => {
		const rootEventId = "evt_feederror1";
		const childEventId = "evt_feederror2";
		const entryId = "fed_errorguard1";
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await addMember(rootEventId, participant.id, "participant");
		await service.createEvent(
			owner,
			rootEventId,
			rootEventId,
			rootInput(childEventId, "published"),
		);
		await service.createFeedEntry(participant, rootEventId, {
			id: entryId,
			eventId: childEventId,
			parentEntryId: null,
			kind: "message",
			body: "Original",
		});
		const revised = await service.reviseFeedEntry(
			participant,
			rootEventId,
			entryId,
			1,
			"Current",
		);
		const app = createApp({
			service,
			verifyUserToken: async (token) => ({ id: token }),
		});
		const request = (body: string, requestId: string) =>
			app.request(`/v1/event-roots/${rootEventId}/feed/${entryId}`, {
				method: "PATCH",
				headers: commandHeaders(
					participant.id,
					"feed-error-guard-0001",
					requestId,
				),
				body: JSON.stringify({ baseVersion: 1, body }),
			});

		const first = await request("Stale revision", "feed-error-first");
		expect(first.status).toBe(409);
		const firstText = await first.text();
		expect(firstText).toContain("VERSION_CONFLICT");

		await service.updateEvent(owner, rootEventId, childEventId, 1, {
			status: "draft",
		});
		const hidden = await request("Stale revision", "feed-error-hidden");
		expect(hidden.status).toBe(404);
		expect(hidden.headers.get("idempotency-replayed")).toBeNull();
		expect(await hidden.text()).not.toContain("VERSION_CONFLICT");
		const changed = await request("Changed revision", "feed-error-changed");
		expect(changed.status).toBe(409);
		expect(await changed.json()).toMatchObject({
			error: { code: "IDEMPOTENCY_KEY_REUSED" },
		});

		await service.updateEvent(owner, rootEventId, childEventId, 2, {
			status: "published",
		});
		const visibleReplay = await request("Stale revision", "feed-error-visible");
		expect(visibleReplay.status).toBe(409);
		expect(visibleReplay.headers.get("idempotency-replayed")).toBe("true");
		expect(await visibleReplay.text()).toContain("VERSION_CONFLICT");

		const removed = await service.removeFeedEntry(
			owner,
			rootEventId,
			entryId,
			revised.version,
		);
		expect(removed.tombstoneReason).toBe("moderation");
		const moderated = await request("Stale revision", "feed-error-moderated");
		expect(moderated.status).toBe(404);
		expect(moderated.headers.get("idempotency-replayed")).toBeNull();
		expect(await moderated.text()).not.toContain("VERSION_CONFLICT");
	});

	test("serializes feed appends, tombstones reactions and conceals draft and cross-root entries", async () => {
		await service.createRoot(owner, rootInput("evt_feedroot1", "published"));
		await addMember("evt_feedroot1", participant.id, "participant");
		await addMember("evt_feedroot1", viewer.id, "viewer");

		const [first, second] = await Promise.all([
			service.createFeedEntry(owner, "evt_feedroot1", {
				id: "fed_concurrent1",
				eventId: null,
				parentEntryId: null,
				kind: "message",
				body: "Owner update",
			}),
			service.createFeedEntry(participant, "evt_feedroot1", {
				id: "fed_concurrent2",
				eventId: null,
				parentEntryId: null,
				kind: "message",
				body: "Participant update",
			}),
		]);
		expect(first.createdRootRevision).not.toBe(second.createdRootRevision);

		const reactions = await Promise.all([
			service.setFeedReaction(
				participant,
				"evt_feedroot1",
				first.id,
				"celebrate",
				true,
			),
			service.setFeedReaction(
				participant,
				"evt_feedroot1",
				first.id,
				"celebrate",
				true,
			),
		]);
		expect(reactions[0]?.version).toBe(1);
		expect(reactions[1]?.version).toBe(1);
		const [reactionFact] = await sql<{ count: number; version: number }[]>`
			SELECT count(*)::int AS count, max(version)::int AS version
			FROM event_feed_reactions
			WHERE entry_id = ${first.id} AND user_id = ${participant.id}
		`;
		expect(reactionFact).toEqual({ count: 1, version: 1 });

		const page1 = await service.listFeedEntries(participant, "evt_feedroot1", {
			limit: 1,
		});
		expect(page1.items).toHaveLength(1);
		expect(page1.pageInfo.hasMore).toBe(true);
		const page2 = await service.listFeedEntries(participant, "evt_feedroot1", {
			limit: 1,
			cursor: page1.pageInfo.nextCursor as string,
		});
		expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);
		await expect(
			service.listFeedEntries(owner, "evt_feedroot1", {
				limit: 1,
				cursor: page1.pageInfo.nextCursor as string,
			}),
		).rejects.toMatchObject({ code: "CURSOR_INVALID" });

		await service.createEvent(
			owner,
			"evt_feedroot1",
			"evt_feedroot1",
			rootInput("evt_feeddraft1", "draft"),
		);
		await service.createFeedEntry(owner, "evt_feedroot1", {
			id: "fed_draftonly1",
			eventId: "evt_feeddraft1",
			parentEntryId: null,
			kind: "message",
			body: "Organizer draft",
		});
		await expect(
			service.getFeedEntry(participant, "evt_feedroot1", "fed_draftonly1"),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			service.createFeedEntry(viewer, "evt_feedroot1", {
				id: "fed_viewerwrite1",
				eventId: null,
				parentEntryId: null,
				kind: "message",
				body: "Not allowed",
			}),
		).rejects.toMatchObject({ status: 403 });

		await service.createRoot(owner, rootInput("evt_feedroot2", "published"));
		await expect(
			service.getFeedEntry(owner, "evt_feedroot2", first.id),
		).rejects.toMatchObject({ status: 404 });

		const revised = await service.reviseFeedEntry(
			owner,
			"evt_feedroot1",
			first.id,
			1,
			"Owner update revised",
		);
		const removed = await service.removeFeedEntry(
			owner,
			"evt_feedroot1",
			first.id,
			revised.version,
		);
		expect(removed).toMatchObject({
			body: null,
			version: 3,
			tombstoneReason: "author",
		});
		const history = await sql<{ body: string | null; reason: string | null }[]>`
			SELECT body, tombstone_reason AS reason
			FROM event_feed_entry_revisions WHERE entry_id = ${first.id} ORDER BY version
		`;
		expect(history.map(({ body, reason }) => ({ body, reason }))).toEqual([
			{ body: "Owner update", reason: null },
			{ body: "Owner update revised", reason: null },
			{ body: null, reason: "author" },
		]);
		const [tombstone] = await sql<
			{ data: unknown; tombstone: Record<string, unknown> }[]
		>`
			SELECT data, tombstone FROM event_root_changes
			WHERE entity_type = 'feedEntry' AND entity_id = ${first.id}
				AND operation = 'tombstone'
		`;
		expect(tombstone?.data).toBeNull();
		expect(JSON.stringify(tombstone?.tombstone)).not.toContain("Owner update");
	});

	test("keeps signed grants out of idempotency storage and isolates committed bytes from quarantine overwrite", async () => {
		await service.createRoot(owner, rootInput("evt_attachroot1", "published"));
		await service.createFeedEntry(owner, "evt_attachroot1", {
			id: "fed_attachentry1",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "Photo update",
		});
		const app = createApp({
			service,
			verifyUserToken: async (token) => ({ id: token }),
		});
		const digest = sha256(png);
		const prepareBody = {
			attachmentId: "att_picture0001",
			targetEntryId: "fed_attachentry1",
			contentType: "image/png",
			byteCount: png.byteLength,
			sha256: digest,
		};
		const prepare = (requestId: string) =>
			app.request("/v1/event-roots/evt_attachroot1/attachments/uploads", {
				method: "POST",
				headers: commandHeaders(owner.id, "prepare-upload-0001", requestId),
				body: JSON.stringify(prepareBody),
			});
		const firstPrepare = await prepare("prepare-first");
		expect(firstPrepare.status).toBe(201);
		const prepared = (await firstPrepare.json()) as {
			upload: { id: string };
			grant: {
				method: "POST";
				url: string;
				fields: Record<string, string>;
			};
		};
		expect(firstPrepare.headers.get("cache-control")).toBe("private, no-store");
		expect(prepared.grant.method).toBe("POST");
		expect(prepared.grant.url).toContain("grant-secret");
		expect(prepared.grant.fields).toMatchObject({
			"Content-Type": "image/png",
			"x-amz-checksum-algorithm": "SHA256",
			"x-amz-checksum-sha256": Buffer.from(digest, "hex").toString("base64"),
		});
		const replayPrepare = await prepare("prepare-replay");
		expect(replayPrepare.headers.get("cache-control")).toBe(
			"private, no-store",
		);
		expect(replayPrepare.headers.get("x-request-id")).toBe("prepare-replay");
		expect(await replayPrepare.json()).toEqual(prepared);

		const [storedPrepare] = await sql<
			{ body: string; cipher: string; quarantineKey: string }[]
		>`
			SELECT record.response_body::text AS body,
				upload.grant_ciphertext AS cipher,
				upload.quarantine_object_key AS "quarantineKey"
			FROM event_idempotency_records record
			JOIN event_attachment_uploads upload ON upload.id = ${prepared.upload.id}
			WHERE record.operation_id = 'eventAttachmentUploadsPrepare'
		`;
		expect(storedPrepare?.body).not.toContain("grant-secret");
		expect(storedPrepare?.body).not.toContain("X-Amz-Signature");
		expect(storedPrepare?.body).not.toContain("Policy");
		expect(storedPrepare?.cipher).not.toContain("grant-secret");
		store.put(storedPrepare?.quarantineKey as string, png);

		const finalizeBody = { caption: "First tee" };
		const finalize = (idempotencyKey: string, requestId: string) =>
			app.request(
				`/v1/event-roots/evt_attachroot1/attachments/uploads/${prepared.upload.id}/finalize`,
				{
					method: "POST",
					headers: commandHeaders(owner.id, idempotencyKey, requestId),
					body: JSON.stringify(finalizeBody),
				},
			);
		const [pendingA, pendingB] = await Promise.all([
			finalize("finalize-upload-0001", "finalize-a"),
			finalize("finalize-upload-0001", "finalize-b"),
		]);
		expect([pendingA.status, pendingB.status]).toEqual([202, 202]);
		expect(pendingA.headers.get("idempotency-replayed")).toBe("false");
		expect(pendingA.headers.get("retry-after")).toBe("1");
		expect(
			(await finalize("finalize-upload-0002", "finalize-fresh-pending")).status,
		).toBe(202);
		expect(await pendingA.json()).toMatchObject({
			uploadId: prepared.upload.id,
			verification: { retryable: true },
		});
		expect(store.verifyCalls).toBe(0);
		const [pendingProof] = await sql<{ jobs: number; idempotency: number }[]>`
			SELECT
				(SELECT count(*)::int FROM event_attachment_verify_jobs
				 WHERE upload_id = ${prepared.upload.id}) AS jobs,
				(SELECT count(*)::int FROM event_idempotency_records
				 WHERE operation_id = 'eventAttachmentUploadsFinalize') AS idempotency
		`;
		expect(pendingProof).toEqual({ jobs: 1, idempotency: 0 });
		await Promise.all([
			attachmentWorker("verify-worker-a").tick(),
			attachmentWorker("verify-worker-b").tick(),
		]);
		expect(store.verifyCalls).toBe(1);

		const [finalizedA, finalizedB] = await Promise.all([
			finalize("finalize-upload-0001", "finalize-ready-a"),
			finalize("finalize-upload-0002", "finalize-ready-b"),
		]);
		expect([finalizedA.status, finalizedB.status]).toEqual([200, 200]);
		const bodyA = await finalizedA.json();
		expect(await finalizedB.json()).toEqual(bodyA);
		const [commitProof] = await sql<{ attachments: number; changes: number }[]>`
			SELECT
				(SELECT count(*)::int FROM event_attachments WHERE id = 'att_picture0001') AS attachments,
				(SELECT count(*)::int FROM event_root_changes
				 WHERE entity_type = 'attachment' AND entity_id = 'att_picture0001') AS changes
		`;
		expect(commitProof).toEqual({ attachments: 1, changes: 1 });

		const committedKey = store.committedKeys[0] as string;
		expect(committedKey).toStartWith("committed/");
		store.put(
			storedPrepare?.quarantineKey as string,
			Buffer.from("overwritten"),
		);
		const verificationsBeforeReplay = store.verifyCalls;
		const replayFinalize = await finalize(
			"finalize-upload-0001",
			"finalize-replay",
		);
		expect(replayFinalize.status).toBe(200);
		expect(store.verifyCalls).toBe(verificationsBeforeReplay);
		const freshFinalize = await finalize(
			"finalize-upload-0003",
			"finalize-fresh-committed",
		);
		expect(freshFinalize.status).toBe(200);
		expect(store.verifyCalls).toBe(verificationsBeforeReplay);

		const download = await app.request(
			"/v1/event-roots/evt_attachroot1/attachments/att_picture0001/download",
			{ headers: { Authorization: `Bearer ${owner.id}` } },
		);
		expect(download.status).toBe(200);
		expect(download.headers.get("cache-control")).toBe("private, no-store");
		expect(
			((await download.json()) as { download: DownloadGrant }).download,
		).toMatchObject({ method: "GET", headers: {} });
		expect(store.lastDownloadKey).toBe(committedKey);
		expect(sha256(store.get(committedKey))).toBe(digest);
		const downloads = store.downloadCalls;
		const concealed = await app.request(
			"/v1/event-roots/evt_attachroot1/attachments/att_picture0001/download",
			{ headers: { Authorization: `Bearer ${outsider.id}` } },
		);
		expect(concealed.status).toBe(404);
		expect(store.downloadCalls).toBe(downloads);
	});

	test("prebinds a consented feedback screenshot without a feed row or sync projection", async () => {
		const rootEventId = "evt_feedbackshot1";
		const feedbackId = "fbk_feedbackshot1";
		const attachmentId = "att_feedbackshot1";
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await addMember(rootEventId, participant.id, "participant");
		await addMember(rootEventId, viewer.id, "viewer");
		const app = createApp({
			service,
			verifyUserToken: async (token) => ({ id: token }),
		});
		const [rootBefore] = await sql<{ revision: string }[]>`
			SELECT revision::text AS revision FROM event_roots
			WHERE root_event_id = ${rootEventId}
		`;
		if (!rootBefore) throw new Error("Missing feedback attachment root");
		const prepare = await app.request(
			`/v1/event-roots/${rootEventId}/attachments/uploads`,
			{
				method: "POST",
				headers: commandHeaders(
					participant.id,
					"feedback-shot-prepare-01",
					"feedback-shot-prepare",
				),
				body: JSON.stringify({
					attachmentId,
					target: { kind: "feedback", feedbackId },
					contentType: "image/png",
					byteCount: png.byteLength,
					sha256: sha256(png),
				}),
			},
		);
		expect(prepare.status).toBe(201);
		const prepared = (await prepare.json()) as {
			upload: {
				id: string;
				target: { kind: string; feedbackId: string };
				targetEntryId: null;
			};
		};
		expect(prepared.upload).toMatchObject({
			target: { kind: "feedback", feedbackId },
			targetEntryId: null,
		});
		const [stored] = await sql<{ quarantineObjectKey: string }[]>`
			SELECT quarantine_object_key AS "quarantineObjectKey"
			FROM event_attachment_uploads WHERE id = ${prepared.upload.id}
		`;
		store.put(stored?.quarantineObjectKey as string, png);
		const finalize = (key: string) =>
			app.request(
				`/v1/event-roots/${rootEventId}/attachments/uploads/${prepared.upload.id}/finalize`,
				{
					method: "POST",
					headers: commandHeaders(participant.id, key, `${key}-request`),
					body: JSON.stringify({ caption: "Current screen" }),
				},
			);
		expect((await finalize("feedback-shot-finalize-01")).status).toBe(202);
		await attachmentWorker("feedback-shot-verify").tick();
		const finalized = await finalize("feedback-shot-finalize-01");
		expect(finalized.status).toBe(200);
		expect(await finalized.json()).toMatchObject({
			attachment: {
				id: attachmentId,
				target: { kind: "feedback", feedbackId },
				targetEntryId: null,
			},
		});
		const finalizedReplay = await finalize("feedback-shot-finalize-01");
		expect(finalizedReplay.status).toBe(200);
		expect(finalizedReplay.headers.get("idempotency-replayed")).toBe("true");
		const [projectionProof] = await sql<
			{ revision: string; changes: number; feedRows: number }[]
		>`
			SELECT revision::text AS revision,
				(SELECT count(*)::int FROM event_root_changes
				 WHERE root_event_id = ${rootEventId}
					AND entity_type = 'attachment' AND entity_id = ${attachmentId}) AS changes,
				(SELECT count(*)::int FROM event_feed_entries
				 WHERE root_event_id = ${rootEventId}) AS "feedRows"
			FROM event_roots WHERE root_event_id = ${rootEventId}
		`;
		expect(projectionProof).toEqual({
			revision: rootBefore.revision,
			changes: 0,
			feedRows: 0,
		});

		const create = await app.request("/v1/feedback", {
			method: "POST",
			headers: commandHeaders(
				participant.id,
				"feedback-shot-create-01",
				"feedback-shot-create",
			),
			body: JSON.stringify({
				id: feedbackId,
				title: "Screenshot issue",
				body: "The current screen shows the problem.",
				visibility: "public",
				rootEventId,
				eventId: rootEventId,
				screenKey: "feedback.compose",
				diagnostics: null,
				attachmentIds: [attachmentId],
			}),
		});
		expect(create.status).toBe(201);
		expect(await create.json()).toMatchObject({
			feedback: { id: feedbackId, attachments: [{ id: attachmentId }] },
		});
		const downloadPath = `/v1/event-roots/${rootEventId}/attachments/${attachmentId}/download`;
		expect(
			(
				await app.request(downloadPath, {
					headers: { Authorization: `Bearer ${viewer.id}` },
				})
			).status,
		).toBe(200);
		expect(
			(
				await app.request(downloadPath, {
					headers: { Authorization: `Bearer ${outsider.id}` },
				})
			).status,
		).toBe(404);
		await sql`
			UPDATE event_feedback SET visibility = 'private' WHERE id = ${feedbackId}
		`;
		expect(
			(
				await app.request(downloadPath, {
					headers: { Authorization: `Bearer ${viewer.id}` },
				})
			).status,
		).toBe(404);
		expect(
			(
				await app.request(downloadPath, {
					headers: { Authorization: `Bearer ${owner.id}` },
				})
			).status,
		).toBe(200);
		const wrongFeedback = await app.request("/v1/feedback", {
			method: "POST",
			headers: commandHeaders(
				participant.id,
				"feedback-shot-cross-01",
				"feedback-shot-cross",
			),
			body: JSON.stringify({
				id: "fbk_feedbackshot2",
				title: "Wrong binding",
				body: "This must not reuse another feedback target.",
				visibility: "private",
				rootEventId,
				eventId: rootEventId,
				screenKey: null,
				diagnostics: null,
				attachmentIds: [attachmentId],
			}),
		});
		expect(wrongFeedback.status).toBe(404);
	});

	test("deletes only unbound committed feedback screenshots after retention", async () => {
		const rootEventId = "evt_feedbackgc01";
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await addMember(rootEventId, participant.id, "participant");
		const commit = async (feedbackId: string, attachmentId: string) => {
			const upload = await service.prepareAttachmentUpload(participant, {
				rootEventId,
				attachmentId,
				target: { kind: "feedback" as const, feedbackId },
				contentType: "image/png" as const,
				byteCount: png.byteLength,
				sha256: sha256(png),
			});
			store.put(upload.quarantineObjectKey, png);
			await service.ensureAttachmentVerification(
				participant,
				rootEventId,
				upload.id,
			);
			await attachmentWorker(`verify-${attachmentId}`).tick();
			const attachment = await service.commitAttachment(
				participant,
				rootEventId,
				upload.id,
				"Current screen",
			);
			return {
				upload,
				attachment,
				committedKey: store.committedKeys.at(-1) as string,
			};
		};

		const orphan = await commit("fbk_feedbackgc01", "att_feedbackgc01");
		await sql`
			UPDATE event_attachment_uploads SET created_at = now() - interval '25 hours'
			WHERE id = ${orphan.upload.id}
		`;
		await sql`
			UPDATE event_attachment_cleanup_jobs SET available_at = now()
			WHERE upload_id = ${orphan.upload.id}
		`;
		const orphanCleanup = await attachmentWorker(
			"feedback-orphan-cleanup",
		).tick();
		expect(orphanCleanup).toMatchObject({
			cleanupClaimed: 1,
			orphanCleanupCompleted: 1,
		});
		expect(store.has(orphan.upload.quarantineObjectKey)).toBe(false);
		expect(store.has(orphan.committedKey)).toBe(false);
		const [orphanProof] = await sql<
			{ state: string; committedAt: Date | null; attachments: number }[]
		>`
			SELECT upload.state, upload.committed_at AS "committedAt",
				(SELECT count(*)::int FROM event_attachments attachment
				 WHERE attachment.upload_id = upload.id) AS attachments
			FROM event_attachment_uploads upload WHERE upload.id = ${orphan.upload.id}
		`;
		expect(orphanProof).toEqual({
			state: "expired",
			committedAt: null,
			attachments: 0,
		});

		const linked = await commit("fbk_feedbackgc02", "att_feedbackgc02");
		await service.createFeedback(participant, {
			id: "fbk_feedbackgc02",
			title: "Bound screenshot",
			body: "Keep the committed object after binding.",
			visibility: "private",
			rootEventId,
			eventId: rootEventId,
			screenKey: "feedback.compose",
			diagnostics: null,
			attachmentIds: [linked.attachment.id],
		});
		await sql`
			UPDATE event_attachment_uploads SET created_at = now() - interval '25 hours'
			WHERE id = ${linked.upload.id}
		`;
		await sql`
			UPDATE event_attachment_cleanup_jobs SET available_at = now()
			WHERE upload_id = ${linked.upload.id}
		`;
		const linkedCleanup = await attachmentWorker(
			"feedback-linked-cleanup",
		).tick();
		expect(linkedCleanup.orphanCleanupCompleted).toBe(1);
		expect(store.has(linked.upload.quarantineObjectKey)).toBe(false);
		expect(store.has(linked.committedKey)).toBe(true);
		expect(
			await sql`
				SELECT id FROM event_attachments WHERE id = ${linked.attachment.id}
			`,
		).toHaveLength(1);
	});

	test("limits committed feedback cleanup to the exact fenced worker claim", async () => {
		const rootEventId = "evt_feedbackacl01";
		const foreignRootEventId = "evt_feedbackacl02";
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await service.createRoot(owner, rootInput(foreignRootEventId, "published"));
		await addMember(rootEventId, participant.id, "participant");
		await service.createFeedEntry(participant, rootEventId, {
			id: "fed_feedbackacl01",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "Attachment ACL fixture",
		});

		const commitFeed = async () => {
			const upload = await service.prepareAttachmentUpload(participant, {
				rootEventId,
				attachmentId: "att_feedbackacl_feed",
				targetEntryId: "fed_feedbackacl01",
				contentType: "image/png",
				byteCount: png.byteLength,
				sha256: sha256(png),
			});
			store.put(upload.quarantineObjectKey, png);
			await service.ensureAttachmentVerification(
				participant,
				rootEventId,
				upload.id,
			);
			await attachmentWorker("acl-feed-verify").tick();
			const attachment = await service.commitAttachment(
				participant,
				rootEventId,
				upload.id,
				"Feed caption",
			);
			return { upload, attachment };
		};
		const commitFeedback = async (feedbackId: string, attachmentId: string) => {
			const upload = await service.prepareAttachmentUpload(participant, {
				rootEventId,
				attachmentId,
				target: { kind: "feedback", feedbackId },
				contentType: "image/png",
				byteCount: png.byteLength,
				sha256: sha256(png),
			});
			store.put(upload.quarantineObjectKey, png);
			await service.ensureAttachmentVerification(
				participant,
				rootEventId,
				upload.id,
			);
			await attachmentWorker(`acl-${attachmentId}-verify`).tick();
			const attachment = await service.commitAttachment(
				participant,
				rootEventId,
				upload.id,
				"Feedback caption",
			);
			return {
				upload,
				attachment,
				committedObjectKey: attachmentCommittedKey(upload),
			};
		};

		const feed = await commitFeed();
		const orphan = await commitFeedback(
			"fbk_feedbackacl_orphan",
			"att_feedbackacl_orphan",
		);
		const linked = await commitFeedback(
			"fbk_feedbackacl_linked",
			"att_feedbackacl_linked",
		);
		await service.createFeedback(participant, {
			id: "fbk_feedbackacl_linked",
			title: "Linked screenshot",
			body: "The cleanup function must retain this attachment.",
			visibility: "private",
			rootEventId,
			eventId: rootEventId,
			screenKey: "feedback.compose",
			diagnostics: null,
			attachmentIds: [linked.attachment.id],
		});

		const jobs = new PostgresAttachmentJobRepository(sql);
		const claim = async (uploadId: string, workerId: string) => {
			await sql`
				UPDATE event_attachment_uploads
				SET created_at = now() - interval '25 hours'
				WHERE id = ${uploadId}
			`;
			await sql`
				UPDATE event_attachment_cleanup_jobs SET available_at = now()
				WHERE upload_id = ${uploadId}
			`;
			return jobs.claimCleanup({
				workerId,
				leaseSeconds: 30,
				retentionSeconds: 86_400,
				maxAttempts: 3,
			});
		};
		const orphanClaim = await claim(orphan.upload.id, "acl-orphan-worker");
		expect(orphanClaim?.upload.id).toBe(orphan.upload.id);
		const linkedClaim = await claim(linked.upload.id, "acl-linked-worker");
		expect(linkedClaim?.upload.id).toBe(linked.upload.id);
		expect(linkedClaim?.committedObjectKey).toBeNull();

		const [privileges] = await sql<
			{
				workerSelect: boolean;
				workerInsert: boolean;
				workerUpdate: boolean;
				workerDelete: boolean;
				workerTruncate: boolean;
				workerReferences: boolean;
				workerTrigger: boolean;
				workerMaintain: boolean;
				workerExecute: boolean;
				apiSelect: boolean;
				apiInsert: boolean;
				apiUpdate: boolean;
				apiDelete: boolean;
				apiTruncate: boolean;
				apiReferences: boolean;
				apiTrigger: boolean;
				apiMaintain: boolean;
				apiExecute: boolean;
				otherExecute: boolean;
				publicExecute: boolean;
			}[]
		>`
			SELECT
				has_table_privilege(
					${attachmentWorkerAclRole}, 'event_attachments', 'SELECT'
				) AS "workerSelect",
				has_table_privilege(
					${attachmentWorkerAclRole}, 'event_attachments', 'INSERT'
				) AS "workerInsert",
				has_table_privilege(
					${attachmentWorkerAclRole}, 'event_attachments', 'UPDATE'
				) AS "workerUpdate",
				has_table_privilege(
					${attachmentWorkerAclRole}, 'event_attachments', 'DELETE'
				) AS "workerDelete",
				has_table_privilege(
					${attachmentWorkerAclRole}, 'event_attachments', 'TRUNCATE'
				) AS "workerTruncate",
				has_table_privilege(
					${attachmentWorkerAclRole}, 'event_attachments', 'REFERENCES'
				) AS "workerReferences",
				has_table_privilege(
					${attachmentWorkerAclRole}, 'event_attachments', 'TRIGGER'
				) AS "workerTrigger",
				has_table_privilege(
					${attachmentWorkerAclRole}, 'event_attachments', 'MAINTAIN'
				) AS "workerMaintain",
				has_function_privilege(
					${attachmentWorkerAclRole},
					'delete_claimed_feedback_attachment(text,text,text,text,text,bigint)',
					'EXECUTE'
				) AS "workerExecute",
				has_table_privilege(
					${attachmentApiAclRole}, 'event_attachments', 'SELECT'
				) AS "apiSelect",
				has_table_privilege(
					${attachmentApiAclRole}, 'event_attachments', 'INSERT'
				) AS "apiInsert",
				has_table_privilege(
					${attachmentApiAclRole}, 'event_attachments', 'UPDATE'
				) AS "apiUpdate",
				has_table_privilege(
					${attachmentApiAclRole}, 'event_attachments', 'DELETE'
				) AS "apiDelete",
				has_table_privilege(
					${attachmentApiAclRole}, 'event_attachments', 'TRUNCATE'
				) AS "apiTruncate",
				has_table_privilege(
					${attachmentApiAclRole}, 'event_attachments', 'REFERENCES'
				) AS "apiReferences",
				has_table_privilege(
					${attachmentApiAclRole}, 'event_attachments', 'TRIGGER'
				) AS "apiTrigger",
				has_table_privilege(
					${attachmentApiAclRole}, 'event_attachments', 'MAINTAIN'
				) AS "apiMaintain",
				has_function_privilege(
					${attachmentApiAclRole},
					'delete_claimed_feedback_attachment(text,text,text,text,text,bigint)',
					'EXECUTE'
				) AS "apiExecute",
				has_function_privilege(
					${attachmentOtherWorkerAclRole},
					'delete_claimed_feedback_attachment(text,text,text,text,text,bigint)',
					'EXECUTE'
				) AS "otherExecute",
				has_function_privilege(
					'public',
					'delete_claimed_feedback_attachment(text,text,text,text,text,bigint)',
					'EXECUTE'
				) AS "publicExecute"
		`;
		expect(privileges).toEqual({
			workerSelect: true,
			workerInsert: false,
			workerUpdate: false,
			workerDelete: false,
			workerTruncate: false,
			workerReferences: false,
			workerTrigger: false,
			workerMaintain: false,
			workerExecute: true,
			apiSelect: true,
			apiInsert: true,
			apiUpdate: false,
			apiDelete: false,
			apiTruncate: false,
			apiReferences: false,
			apiTrigger: false,
			apiMaintain: false,
			apiExecute: false,
			otherExecute: false,
			publicExecute: false,
		});

		expect(
			await databaseErrorCode(() =>
				asDatabaseRole(
					attachmentWorkerAclRole,
					(tx) => tx`INSERT INTO event_attachments DEFAULT VALUES`,
				),
			),
		).toBe("42501");
		expect(
			await databaseErrorCode(() =>
				asDatabaseRole(
					attachmentWorkerAclRole,
					(tx) =>
						tx`DELETE FROM event_attachments WHERE id = ${feed.attachment.id}`,
				),
			),
		).toBe("42501");
		expect(
			await databaseErrorCode(() =>
				asDatabaseRole(
					attachmentWorkerAclRole,
					(tx) => tx`TRUNCATE TABLE event_attachments`,
				),
			),
		).toBe("42501");
		expect(
			await sql`SELECT id FROM event_attachments WHERE id = ${feed.attachment.id}`,
		).toHaveLength(1);
		expect(
			await databaseErrorCode(() =>
				asDatabaseRole(
					attachmentWorkerAclRole,
					(tx) =>
						tx`
						UPDATE event_attachments SET object_key = object_key
						WHERE id = ${feed.attachment.id}
					`,
				),
			),
		).toBe("42501");
		expect(
			await databaseErrorCode(() =>
				asDatabaseRole(
					attachmentApiAclRole,
					(tx) =>
						tx`DELETE FROM event_attachments WHERE id = ${feed.attachment.id}`,
				),
			),
		).toBe("42501");
		expect(
			await sql`SELECT id FROM event_attachments WHERE id = ${feed.attachment.id}`,
		).toHaveLength(1);
		expect(
			await databaseErrorCode(() =>
				asDatabaseRole(
					attachmentApiAclRole,
					(tx) => tx`TRUNCATE TABLE event_attachments`,
				),
			),
		).toBe("42501");
		expect(
			await sql`SELECT id FROM event_attachments WHERE id = ${feed.attachment.id}`,
		).toHaveLength(1);
		expect(
			await databaseErrorCode(() =>
				asDatabaseRole(
					attachmentApiAclRole,
					(tx) =>
						tx`
						UPDATE event_attachments SET object_key = object_key
						WHERE id = ${feed.attachment.id}
					`,
				),
			),
		).toBe("42501");
		expect(
			await sql`SELECT id FROM event_attachments WHERE id = ${feed.attachment.id}`,
		).toHaveLength(1);

		const invoke = (
			role: string,
			input: {
				uploadId: string;
				rootEventId: string;
				attachmentId: string;
				objectKey: string;
				workerId: string;
				fence: string;
			},
		) =>
			asDatabaseRole(role, async (tx) => {
				const [result] = await tx<{ removed: boolean }[]>`
					SELECT delete_claimed_feedback_attachment(
						${input.uploadId}, ${input.rootEventId}, ${input.attachmentId},
						${input.objectKey}, ${input.workerId}, ${input.fence}::bigint
					) AS removed
				`;
				return result?.removed ?? false;
			});
		const orphanInput = {
			uploadId: orphan.upload.id,
			rootEventId,
			attachmentId: orphan.attachment.id,
			objectKey: orphan.committedObjectKey,
			workerId: orphanClaim?.workerId as string,
			fence: orphanClaim?.fence as string,
		};
		expect(
			await databaseErrorCode(() => invoke(attachmentApiAclRole, orphanInput)),
		).toBe("42501");
		expect(
			await databaseErrorCode(() =>
				invoke(attachmentOtherWorkerAclRole, orphanInput),
			),
		).toBe("42501");
		expect(
			await invoke(attachmentWorkerAclRole, {
				...orphanInput,
				rootEventId: foreignRootEventId,
			}),
		).toBe(false);
		expect(
			await invoke(attachmentWorkerAclRole, {
				...orphanInput,
				uploadId: linked.upload.id,
			}),
		).toBe(false);
		expect(
			await invoke(attachmentWorkerAclRole, {
				uploadId: linked.upload.id,
				rootEventId,
				attachmentId: linked.attachment.id,
				objectKey: linked.committedObjectKey,
				workerId: linkedClaim?.workerId as string,
				fence: linkedClaim?.fence as string,
			}),
		).toBe(false);
		expect(await invoke(attachmentWorkerAclRole, orphanInput)).toBe(true);
		expect(await invoke(attachmentWorkerAclRole, orphanInput)).toBe(false);
		expect(
			await sql`
				SELECT id FROM event_attachments
				WHERE id IN (${orphan.attachment.id}, ${linked.attachment.id})
				ORDER BY id
			`,
		).toHaveLength(1);
	});

	test("rechecks current participant visibility and bounds concurrent live leases", async () => {
		await service.createRoot(owner, rootInput("evt_leaseroot01", "published"));
		await addMember("evt_leaseroot01", participant.id, "participant");
		await service.createEvent(
			owner,
			"evt_leaseroot01",
			"evt_leaseroot01",
			rootInput("evt_leasechild1", "published"),
		);
		await service.createFeedEntry(participant, "evt_leaseroot01", {
			id: "fed_leaseentry1",
			eventId: "evt_leasechild1",
			parentEntryId: null,
			kind: "message",
			body: "Participant media",
		});
		const digest = sha256(png);
		const attempts = await Promise.allSettled(
			Array.from({ length: 6 }, (_, index) =>
				service.prepareAttachmentUpload(participant, {
					rootEventId: "evt_leaseroot01",
					attachmentId: `att_lease000${index}`,
					targetEntryId: "fed_leaseentry1",
					contentType: "image/png",
					byteCount: png.byteLength,
					sha256: digest,
				}),
			),
		);
		expect(
			attempts.filter((value) => value.status === "fulfilled"),
		).toHaveLength(5);
		const rejection = attempts.find(
			(value): value is PromiseRejectedResult => value.status === "rejected",
		);
		expect(rejection?.reason).toMatchObject({ code: "UPLOAD_LIMIT_REACHED" });
		const first = attempts.find(
			(
				value,
			): value is PromiseFulfilledResult<
				Awaited<ReturnType<typeof service.prepareAttachmentUpload>>
			> => value.status === "fulfilled",
		)?.value;
		expect(first).toBeDefined();

		await service.updateEvent(owner, "evt_leaseroot01", "evt_leasechild1", 1, {
			status: "draft",
		});
		await expect(
			service.attachmentUploadGrant(
				participant,
				"evt_leaseroot01",
				first?.id as string,
			),
		).rejects.toMatchObject({ status: 404 });
		await service.updateEvent(owner, "evt_leaseroot01", "evt_leasechild1", 2, {
			status: "published",
		});
		await sql`
			UPDATE event_memberships SET role = 'viewer', version = version + 1
			WHERE root_event_id = 'evt_leaseroot01' AND user_id = ${participant.id}
		`;
		await expect(
			service.attachmentUploadGrant(
				participant,
				"evt_leaseroot01",
				first?.id as string,
			),
		).rejects.toMatchObject({ status: 403 });
	});

	test("recovers an expired verification lease and fences every late acknowledgement", async () => {
		const rootEventId = "evt_joblease01";
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_joblease01",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "Lease recovery",
		});
		const upload = await service.prepareAttachmentUpload(owner, {
			rootEventId,
			attachmentId: "att_joblease01",
			targetEntryId: "fed_joblease01",
			contentType: "image/png",
			byteCount: png.byteLength,
			sha256: sha256(png),
		});
		store.put(upload.quarantineObjectKey, png);
		expect(
			await service.ensureAttachmentVerification(owner, rootEventId, upload.id),
		).toMatchObject({ state: "pending" });

		const jobs = new PostgresAttachmentJobRepository(sql);
		const first = await jobs.claimVerification({
			workerId: "lease-worker-a",
			leaseSeconds: 30,
			maxAttempts: 3,
		});
		expect(first).not.toBeNull();
		expect(store.verifyCalls).toBe(0);
		await sql`
			UPDATE event_attachment_verify_jobs SET lease_until = now() - interval '1 second'
			WHERE upload_id = ${upload.id}
		`;
		expect(
			await jobs.completeVerification(first as NonNullable<typeof first>),
		).toBe(false);

		const recovered = await jobs.claimVerification({
			workerId: "lease-worker-b",
			leaseSeconds: 30,
			maxAttempts: 3,
		});
		expect(recovered).toMatchObject({ attempt: 2, workerId: "lease-worker-b" });
		expect(recovered?.fence).not.toBe(first?.fence);
		await store.verifyAndCommit({
			quarantineKey: recovered?.upload.quarantineObjectKey as string,
			committedKey: recovered?.committedObjectKey as string,
			contentType: recovered?.upload.contentType as "image/png",
			byteCount: recovered?.upload.byteCount as number,
			sha256: recovered?.upload.sha256 as string,
		});
		expect(
			await jobs.completeVerification(first as NonNullable<typeof first>),
		).toBe(false);
		expect(
			await jobs.completeVerification(
				recovered as NonNullable<typeof recovered>,
			),
		).toBe(true);
		const callsBeforeCommit = store.verifyCalls;
		const attachment = await service.commitAttachment(
			owner,
			rootEventId,
			upload.id,
			null,
		);
		expect(attachment.id).toBe("att_joblease01");
		expect(store.verifyCalls).toBe(callsBeforeCommit);
	});

	test("rejects invalid media permanently and bounds transient retries into a dead letter", async () => {
		const rootEventId = "evt_jobresult1";
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_jobresult1",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "Worker outcomes",
		});
		const app = createApp({
			service,
			verifyUserToken: async (token) => ({ id: token }),
		});
		const finalize = (uploadId: string, key: string) =>
			app.request(
				`/v1/event-roots/${rootEventId}/attachments/uploads/${uploadId}/finalize`,
				{
					method: "POST",
					headers: commandHeaders(owner.id, key, `${key}-request`),
					body: JSON.stringify({ caption: null }),
				},
			);

		const invalidBytes = Buffer.from("not-an-image");
		const invalid = await service.prepareAttachmentUpload(owner, {
			rootEventId,
			attachmentId: "att_invalid001",
			targetEntryId: "fed_jobresult1",
			contentType: "image/png",
			byteCount: invalidBytes.byteLength,
			sha256: sha256(invalidBytes),
		});
		store.put(invalid.quarantineObjectKey, invalidBytes);
		expect((await finalize(invalid.id, "finalize-invalid-01")).status).toBe(
			202,
		);
		await attachmentWorker("result-worker", { verifyMaxAttempts: 2 }).tick();
		const rejected = await finalize(invalid.id, "finalize-invalid-01");
		expect(rejected.status).toBe(409);
		expect(await rejected.json()).toMatchObject({
			error: { code: "ATTACHMENT_TYPE_MISMATCH", retryable: false },
		});
		const rejectedReplay = await finalize(invalid.id, "finalize-invalid-01");
		expect(rejectedReplay.headers.get("idempotency-replayed")).toBe("true");

		const transient = await service.prepareAttachmentUpload(owner, {
			rootEventId,
			attachmentId: "att_transient01",
			targetEntryId: "fed_jobresult1",
			contentType: "image/png",
			byteCount: png.byteLength,
			sha256: sha256(png),
		});
		store.put(transient.quarantineObjectKey, png);
		store.failNextVerification(new Error("temporary object-store failure"));
		expect((await finalize(transient.id, "finalize-transient-01")).status).toBe(
			202,
		);
		await attachmentWorker("result-worker", { verifyMaxAttempts: 2 }).tick();
		const [retry] = await sql<
			{ status: string; attempts: number; delayed: boolean }[]
		>`
			SELECT status, attempts, available_at > now() AS delayed
			FROM event_attachment_verify_jobs WHERE upload_id = ${transient.id}
		`;
		expect(retry).toEqual({ status: "retry", attempts: 1, delayed: true });
		await sql`
			UPDATE event_attachment_verify_jobs SET available_at = now()
			WHERE upload_id = ${transient.id}
		`;
		await attachmentWorker("result-worker", { verifyMaxAttempts: 2 }).tick();
		const callsBeforeFinalize = store.verifyCalls;
		expect((await finalize(transient.id, "finalize-transient-01")).status).toBe(
			200,
		);
		expect(store.verifyCalls).toBe(callsBeforeFinalize);

		const dead = await service.prepareAttachmentUpload(owner, {
			rootEventId,
			attachmentId: "att_deadletter1",
			targetEntryId: "fed_jobresult1",
			contentType: "image/png",
			byteCount: png.byteLength,
			sha256: sha256(png),
		});
		store.put(dead.quarantineObjectKey, png);
		store.failNextVerification(new Error("store unavailable once"));
		store.failNextVerification(new Error("store unavailable twice"));
		expect((await finalize(dead.id, "finalize-dead-0001")).status).toBe(202);
		const deadWorker = attachmentWorker("dead-worker", {
			verifyMaxAttempts: 2,
		});
		await deadWorker.tick();
		await sql`
			UPDATE event_attachment_verify_jobs SET available_at = now()
			WHERE upload_id = ${dead.id}
		`;
		await deadWorker.tick();
		const [deadJob] = await sql<
			{ status: string; attempts: number; errorCode: string }[]
		>`
			SELECT status, attempts, error_code AS "errorCode"
			FROM event_attachment_verify_jobs WHERE upload_id = ${dead.id}
		`;
		expect(deadJob).toEqual({
			status: "dead",
			attempts: 2,
			errorCode: "ATTACHMENT_STORE_UNAVAILABLE",
		});
		const callsAtDeadLetter = store.verifyCalls;
		await deadWorker.tick();
		expect(store.verifyCalls).toBe(callsAtDeadLetter);
		const deadResponse = await finalize(dead.id, "finalize-dead-0001");
		expect(deadResponse.status).toBe(409);
		expect(await deadResponse.json()).toMatchObject({
			error: { code: "ATTACHMENT_VERIFICATION_DEAD", retryable: false },
		});
	});

	test("retains quarantine for 24 hours, skips active verification and never deletes committed keys", async () => {
		const rootEventId = "evt_cleanup001";
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_cleanup001",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "Cleanup invariants",
		});
		const cleanupWorker = attachmentWorker("cleanup-worker");
		const jobs = new PostgresAttachmentJobRepository(sql);
		const orphan = await service.prepareAttachmentUpload(owner, {
			rootEventId,
			attachmentId: "att_cleanup001",
			targetEntryId: "fed_cleanup001",
			contentType: "image/png",
			byteCount: png.byteLength,
			sha256: sha256(png),
		});
		store.put(orphan.quarantineObjectKey, png);
		expect(
			await jobs.claimCleanup({
				workerId: "too-early",
				leaseSeconds: 30,
				retentionSeconds: 86_400,
				maxAttempts: 3,
			}),
		).toBeNull();
		await sql`
			UPDATE event_attachment_uploads SET created_at = now() - interval '25 hours'
			WHERE id = ${orphan.id}
		`;
		await sql`
			UPDATE event_attachment_cleanup_jobs SET available_at = now()
			WHERE upload_id = ${orphan.id}
		`;
		const staleCleanup = await jobs.claimCleanup({
			workerId: "stale-cleanup",
			leaseSeconds: 30,
			retentionSeconds: 86_400,
			maxAttempts: 3,
		});
		expect(staleCleanup?.upload.id).toBe(orphan.id);
		await sql`
			UPDATE event_attachment_cleanup_jobs SET lease_until = now() - interval '1 second'
			WHERE upload_id = ${orphan.id}
		`;
		expect(
			await jobs.completeCleanup(
				staleCleanup as NonNullable<typeof staleCleanup>,
			),
		).toBe(false);
		store.failNextCleanup(new Error("temporary cleanup store failure"));
		const retryStats = await cleanupWorker.tick();
		expect(retryStats).toMatchObject({
			cleanupClaimed: 1,
			cleanupRetried: 1,
		});
		const [cleanupRetry] = await sql<{ status: string; delayed: boolean }[]>`
			SELECT status, available_at > now() AS delayed
			FROM event_attachment_cleanup_jobs WHERE upload_id = ${orphan.id}
		`;
		expect(cleanupRetry).toEqual({ status: "retry", delayed: true });
		expect(store.has(orphan.quarantineObjectKey)).toBe(true);
		await sql`
			UPDATE event_attachment_cleanup_jobs SET available_at = now()
			WHERE upload_id = ${orphan.id}
		`;
		const cleanupStats = await cleanupWorker.tick();
		expect(cleanupStats).toMatchObject({
			cleanupClaimed: 1,
			orphanCleanupCompleted: 1,
		});
		expect(store.deletedKeys).toContain(orphan.quarantineObjectKey);
		expect(store.has(orphan.quarantineObjectKey)).toBe(false);

		const committed = await service.prepareAttachmentUpload(owner, {
			rootEventId,
			attachmentId: "att_cleanup002",
			targetEntryId: "fed_cleanup001",
			contentType: "image/png",
			byteCount: png.byteLength,
			sha256: sha256(png),
		});
		store.put(committed.quarantineObjectKey, png);
		await service.ensureAttachmentVerification(
			owner,
			rootEventId,
			committed.id,
		);
		await sql`
			UPDATE event_attachment_uploads SET created_at = now() - interval '25 hours'
			WHERE id = ${committed.id}
		`;
		await sql`
			UPDATE event_attachment_cleanup_jobs SET available_at = now()
			WHERE upload_id = ${committed.id}
		`;
		const verifyClaim = await jobs.claimVerification({
			workerId: "cleanup-verify",
			leaseSeconds: 30,
			maxAttempts: 3,
		});
		expect(verifyClaim?.upload.id).toBe(committed.id);
		expect(
			await jobs.claimCleanup({
				workerId: "cleanup-race",
				leaseSeconds: 30,
				retentionSeconds: 86_400,
				maxAttempts: 3,
			}),
		).toBeNull();
		await store.verifyAndCommit({
			quarantineKey: verifyClaim?.upload.quarantineObjectKey as string,
			committedKey: verifyClaim?.committedObjectKey as string,
			contentType: verifyClaim?.upload.contentType as "image/png",
			byteCount: verifyClaim?.upload.byteCount as number,
			sha256: verifyClaim?.upload.sha256 as string,
		});
		expect(
			await jobs.completeVerification(
				verifyClaim as NonNullable<typeof verifyClaim>,
			),
		).toBe(true);
		await service.commitAttachment(owner, rootEventId, committed.id, null);
		const committedKey = verifyClaim?.committedObjectKey as string;
		let metadataConstraintError: unknown;
		try {
			await sql`
				UPDATE event_attachments SET object_key = ${committed.quarantineObjectKey}
				WHERE id = ${committed.attachmentId}
			`;
		} catch (error) {
			metadataConstraintError = error;
		}
		expect(metadataConstraintError).toMatchObject({ code: "23514" });
		await cleanupWorker.tick();
		expect(store.deletedKeys).toContain(committed.quarantineObjectKey);
		expect(store.deletedKeys).not.toContain(committedKey);
		expect(store.has(committedKey)).toBe(true);
	});

	test("bounds attachment exhaustion maintenance and reports active age", async () => {
		const rootEventId = "evt_jobmaintenance";
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_jobmaintenance",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "Maintenance bounds",
		});
		for (let index = 0; index < 3; index++) {
			const upload = await service.prepareAttachmentUpload(owner, {
				rootEventId,
				attachmentId: `att_maintenance${index}`,
				targetEntryId: "fed_jobmaintenance",
				contentType: "image/png",
				byteCount: png.byteLength,
				sha256: sha256(png),
			});
			await service.ensureAttachmentVerification(owner, rootEventId, upload.id);
			await sql`
				UPDATE event_attachment_verify_jobs SET
					status = 'retry', attempts = 3,
					error_code = 'ATTACHMENT_STORE_UNAVAILABLE',
					available_at = now(), created_at = now() - interval '2 hours',
					updated_at = now() - interval '2 hours'
				WHERE upload_id = ${upload.id}
			`;
		}
		const stats = await new PostgresAttachmentJobRepository(sql).maintain({
			verificationMaxAttempts: 3,
			cleanupMaxAttempts: 3,
			cleanupRetentionSeconds: 86_400,
			limit: 1,
		});
		expect(stats).toMatchObject({
			verificationExhausted: 1,
			verificationBacklog: 2,
		});
		expect(stats.oldestVerificationAgeSeconds).toBeGreaterThanOrEqual(7_199);
		const [dead] = await sql<{ count: number }[]>`
			SELECT count(*)::int AS count FROM event_attachment_verify_jobs
			WHERE status = 'dead'
		`;
		expect(dead?.count).toBe(1);
	});

	test("caps active verification admission without consuming finalize idempotency", async () => {
		const rootEventId = "evt_jobcapacity";
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_jobcapacity",
			eventId: null,
			parentEntryId: null,
			kind: "message",
			body: "Capacity",
		});
		const uploads = [];
		for (let index = 0; index < 5; index++) {
			const upload = await service.prepareAttachmentUpload(owner, {
				rootEventId,
				attachmentId: `att_capacity0${index}`,
				targetEntryId: "fed_jobcapacity",
				contentType: "image/png",
				byteCount: png.byteLength,
				sha256: sha256(png),
			});
			uploads.push(upload);
			await service.ensureAttachmentVerification(owner, rootEventId, upload.id);
		}
		expect(
			await service.ensureAttachmentVerification(
				owner,
				rootEventId,
				uploads[0]?.id as string,
			),
		).toMatchObject({ state: "pending" });
		await sql`
			UPDATE event_attachment_uploads SET
				created_at = now() - interval '10 minutes',
				expires_at = now() - interval '1 minute'
			WHERE id = ${uploads[0]?.id as string}
		`;
		const overflow = await service.prepareAttachmentUpload(owner, {
			rootEventId,
			attachmentId: "att_capacity05",
			targetEntryId: "fed_jobcapacity",
			contentType: "image/png",
			byteCount: png.byteLength,
			sha256: sha256(png),
		});
		const app = createApp({
			service,
			verifyUserToken: async (token) => ({ id: token }),
		});
		const response = await app.request(
			`/v1/event-roots/${rootEventId}/attachments/uploads/${overflow.id}/finalize`,
			{
				method: "POST",
				headers: commandHeaders(
					owner.id,
					"finalize-capacity-0001",
					"capacity-request",
				),
				body: JSON.stringify({ caption: null }),
			},
		);
		expect(response.status).toBe(409);
		expect(response.headers.get("retry-after")).toBe("5");
		expect(await response.json()).toMatchObject({
			error: {
				code: "ATTACHMENT_VERIFICATION_CAPACITY",
				retryable: true,
			},
		});
		const [proof] = await sql<{ jobs: number; idempotency: number }[]>`
			SELECT
				(SELECT count(*)::int FROM event_attachment_verify_jobs
				 WHERE upload_id = ${overflow.id}) AS jobs,
				(SELECT count(*)::int FROM event_idempotency_records
				 WHERE idempotency_key = 'finalize-capacity-0001') AS idempotency
		`;
		expect(proof).toEqual({ jobs: 0, idempotency: 0 });
	});

	test("rechecks mutation authority after visibility and role changes without replay side effects", async () => {
		const rootEventId = "evt_authroot01";
		const childEventId = "evt_authchild1";
		await service.createRoot(owner, rootInput(rootEventId, "published"));
		await addMember(rootEventId, participant.id, "participant");
		await service.createEvent(
			owner,
			rootEventId,
			rootEventId,
			rootInput(childEventId, "published"),
		);
		for (const id of [
			"fed_authrevise1",
			"fed_authremove1",
			"fed_authreaction1",
			"fed_authattach1",
			"fed_authmanager1",
			"fed_authreplay1",
		]) {
			await service.createFeedEntry(participant, rootEventId, {
				id,
				eventId: childEventId,
				parentEntryId: null,
				kind: "message",
				body: id,
			});
		}
		await service.createFeedEntry(owner, rootEventId, {
			id: "fed_authowner1",
			eventId: childEventId,
			parentEntryId: null,
			kind: "message",
			body: "Owner entry",
		});

		const digest = sha256(png);
		const replayUpload = await service.prepareAttachmentUpload(participant, {
			rootEventId,
			attachmentId: "att_authreplay1",
			targetEntryId: "fed_authattach1",
			contentType: "image/png",
			byteCount: png.byteLength,
			sha256: digest,
		});
		const blockedUpload = await service.prepareAttachmentUpload(participant, {
			rootEventId,
			attachmentId: "att_authblocked1",
			targetEntryId: "fed_authattach1",
			contentType: "image/png",
			byteCount: png.byteLength,
			sha256: digest,
		});
		store.put(replayUpload.quarantineObjectKey, png);
		store.put(blockedUpload.quarantineObjectKey, png);
		const app = createApp({
			service,
			verifyUserToken: async (token) => ({ id: token }),
		});
		const reviseReplay = (body: string, requestId: string) =>
			app.request(`/v1/event-roots/${rootEventId}/feed/fed_authreplay1`, {
				method: "PATCH",
				headers: commandHeaders(
					participant.id,
					"auth-revise-replay-0001",
					requestId,
				),
				body: JSON.stringify({ baseVersion: 1, body }),
			});
		const revised = await reviseReplay(
			"Replay-only message",
			"auth-revise-first",
		);
		expect(revised.status).toBe(200);
		expect(revised.headers.get("idempotency-replayed")).toBe("false");
		const revisedBody = await revised.json();
		const finalize = (
			uploadId: string,
			idempotencyKey: string,
			requestId: string,
		) =>
			app.request(
				`/v1/event-roots/${rootEventId}/attachments/uploads/${uploadId}/finalize`,
				{
					method: "POST",
					headers: commandHeaders(participant.id, idempotencyKey, requestId),
					body: JSON.stringify({ caption: "Authority proof" }),
				},
			);
		const pendingFinalize = await finalize(
			replayUpload.id,
			"auth-finalize-replay-0001",
			"auth-finalize-first",
		);
		expect(pendingFinalize.status).toBe(202);
		await attachmentWorker("auth-verify-worker").tick();
		const finalized = await finalize(
			replayUpload.id,
			"auth-finalize-replay-0001",
			"auth-finalize-ready",
		);
		expect(finalized.status).toBe(200);
		const finalizedBody = await finalized.json();
		const verificationCalls = store.verifyCalls;
		const committedKeys = [...store.committedKeys];
		const finalizeIdempotencyRecord = async () => {
			const [record] = await sql<{ value: string }[]>`
				SELECT to_jsonb(snapshot)::text AS value
				FROM (
					SELECT actor_id, operation_id, idempotency_key, request_hash, state,
						response_status, response_body, response_headers,
						created_at::text, completed_at::text, expires_at::text
					FROM event_idempotency_records
					WHERE actor_id = ${participant.id}
						AND operation_id = 'eventAttachmentUploadsFinalize'
						AND idempotency_key = 'auth-finalize-replay-0001'
				) snapshot
			`;
			if (!record) throw new Error("Finalize idempotency invariant failed");
			return record.value;
		};
		const finalizedIdempotency = await finalizeIdempotencyRecord();

		await service.updateEvent(owner, rootEventId, childEventId, 1, {
			status: "draft",
		});
		const [draftStart] = await sql<{ revision: string }[]>`
			SELECT revision::text AS revision FROM event_roots
			WHERE root_event_id = ${rootEventId}
		`;
		await expect(
			service.reviseFeedEntry(
				participant,
				rootEventId,
				"fed_authrevise1",
				1,
				"Hidden revision",
			),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			service.removeFeedEntry(participant, rootEventId, "fed_authremove1", 1),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			service.setFeedReaction(
				participant,
				rootEventId,
				"fed_authreaction1",
				"like",
				true,
			),
		).rejects.toMatchObject({ status: 404 });
		await expect(
			service.attachmentUploadGrant(participant, rootEventId, blockedUpload.id),
		).rejects.toMatchObject({ status: 404 });

		const removeRequest = (requestId: string) =>
			app.request(
				`/v1/event-roots/${rootEventId}/feed/fed_authremove1?baseVersion=1`,
				{
					method: "DELETE",
					headers: commandHeaders(
						participant.id,
						"auth-remove-draft-0001",
						requestId,
					),
				},
			);
		const draftRemove = await removeRequest("auth-remove-first");
		expect(draftRemove.status).toBe(404);
		expect(draftRemove.headers.get("idempotency-replayed")).toBe("false");
		const draftRemoveBody = (await draftRemove.json()) as {
			error: { code: string; requestId: string };
		};
		expect(draftRemoveBody.error.code).toBe("NOT_FOUND");

		const blockedFinalizeDraft = await finalize(
			blockedUpload.id,
			"auth-finalize-blocked-draft",
			"auth-finalize-draft",
		);
		expect(blockedFinalizeDraft.status).toBe(404);
		expect(store.verifyCalls).toBe(verificationCalls);
		const revisedReplayDraft = await reviseReplay(
			"Replay-only message",
			"auth-revise-draft",
		);
		expect(revisedReplayDraft.status).toBe(404);
		const revisedReplayDraftBody = await revisedReplayDraft.json();
		expect(revisedReplayDraftBody).toMatchObject({
			error: { code: "NOT_FOUND" },
		});
		expect(revisedReplayDraftBody).not.toEqual(revisedBody);
		expect(JSON.stringify(revisedReplayDraftBody)).not.toContain(
			"Replay-only message",
		);
		const changedRevisedReplayDraft = await reviseReplay(
			"Changed replay message",
			"auth-revise-changed",
		);
		expect(changedRevisedReplayDraft.status).toBe(409);
		expect(await changedRevisedReplayDraft.json()).toMatchObject({
			error: { code: "IDEMPOTENCY_KEY_REUSED" },
		});
		const finalizedReplayDraft = await finalize(
			replayUpload.id,
			"auth-finalize-replay-0001",
			"auth-finalize-replay-draft",
		);
		expect(finalizedReplayDraft.status).toBe(404);
		expect(finalizedReplayDraft.headers.get("idempotency-replayed")).toBeNull();
		expect(finalizedReplayDraft.headers.get("x-request-id")).toBe(
			"auth-finalize-replay-draft",
		);
		const finalizedReplayDraftBody = await finalizedReplayDraft.json();
		expect(finalizedReplayDraftBody).toMatchObject({
			error: { code: "NOT_FOUND" },
		});
		expect(finalizedReplayDraftBody).not.toEqual(finalizedBody);
		expect(JSON.stringify(finalizedReplayDraftBody)).not.toContain(
			"att_authreplay1",
		);
		const changedFinalizeReplayDraft = await app.request(
			`/v1/event-roots/${rootEventId}/attachments/uploads/${replayUpload.id}/finalize`,
			{
				method: "POST",
				headers: commandHeaders(
					participant.id,
					"auth-finalize-replay-0001",
					"auth-finalize-replay-changed",
				),
				body: JSON.stringify({ caption: "Changed authority proof" }),
			},
		);
		expect(changedFinalizeReplayDraft.status).toBe(409);
		expect(await changedFinalizeReplayDraft.json()).toMatchObject({
			error: { code: "IDEMPOTENCY_KEY_REUSED" },
		});
		expect(store.verifyCalls).toBe(verificationCalls);
		expect(store.committedKeys).toEqual(committedKeys);
		expect(await finalizeIdempotencyRecord()).toBe(finalizedIdempotency);

		const [draftEnd] = await sql<{ revision: string }[]>`
			SELECT revision::text AS revision FROM event_roots
			WHERE root_event_id = ${rootEventId}
		`;
		expect(draftEnd?.revision).toBe(draftStart?.revision);
		const managerRemoval = await service.removeFeedEntry(
			owner,
			rootEventId,
			"fed_authmanager1",
			1,
		);
		expect(managerRemoval.tombstoneReason).toBe("moderation");
		const ownerRemoval = await service.removeFeedEntry(
			owner,
			rootEventId,
			"fed_authowner1",
			1,
		);
		expect(ownerRemoval.tombstoneReason).toBe("author");

		await service.updateEvent(owner, rootEventId, childEventId, 2, {
			status: "published",
		});
		const [publishedStart] = await sql<{ revision: string }[]>`
			SELECT revision::text AS revision FROM event_roots
			WHERE root_event_id = ${rootEventId}
		`;
		if (!publishedStart) throw new Error("Root revision invariant failed");
		const removeReplay = await removeRequest("auth-remove-replay");
		expect(removeReplay.status).toBe(404);
		expect(removeReplay.headers.get("idempotency-replayed")).toBe("true");
		expect(removeReplay.headers.get("x-request-id")).toBe("auth-remove-replay");
		expect(
			((await removeReplay.json()) as { error: { requestId: string } }).error
				.requestId,
		).toBe("auth-remove-replay");
		await expect(
			service.removeFeedEntry(
				participant,
				rootEventId,
				"fed_authowner1",
				ownerRemoval.version,
			),
		).rejects.toMatchObject({ status: 403 });
		const [publishedEnd] = await sql<{ revision: string }[]>`
			SELECT revision::text AS revision FROM event_roots
			WHERE root_event_id = ${rootEventId}
		`;
		expect(publishedEnd?.revision).toBe(publishedStart.revision);

		await sql`
			UPDATE event_memberships SET role = 'viewer', version = version + 1
			WHERE root_event_id = ${rootEventId} AND user_id = ${participant.id}
		`;
		await expect(
			service.reviseFeedEntry(
				participant,
				rootEventId,
				"fed_authrevise1",
				1,
				"Viewer revision",
			),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			service.removeFeedEntry(participant, rootEventId, "fed_authremove1", 1),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			service.setFeedReaction(
				participant,
				rootEventId,
				"fed_authreaction1",
				"like",
				true,
			),
		).rejects.toMatchObject({ status: 403 });
		await expect(
			service.attachmentUploadGrant(participant, rootEventId, blockedUpload.id),
		).rejects.toMatchObject({ status: 403 });
		const blockedFinalizeViewer = await finalize(
			blockedUpload.id,
			"auth-finalize-blocked-viewer",
			"auth-finalize-viewer",
		);
		expect(blockedFinalizeViewer.status).toBe(403);
		expect(store.verifyCalls).toBe(verificationCalls);
		const viewerRead = await app.request(
			`/v1/event-roots/${rootEventId}/attachments/att_authreplay1/download`,
			{
				headers: {
					Authorization: `Bearer ${participant.id}`,
					"X-Request-ID": "auth-attachment-viewer-read",
				},
			},
		);
		expect(viewerRead.status).toBe(200);
		expect(viewerRead.headers.get("x-request-id")).toBe(
			"auth-attachment-viewer-read",
		);
		expect(await viewerRead.json()).toMatchObject({
			attachment: { id: "att_authreplay1" },
		});
		const downloadCalls = store.downloadCalls;
		const finalizedReplayViewer = await finalize(
			replayUpload.id,
			"auth-finalize-replay-0001",
			"auth-finalize-replay-viewer",
		);
		expect(finalizedReplayViewer.status).toBe(200);
		expect(finalizedReplayViewer.headers.get("idempotency-replayed")).toBe(
			"true",
		);
		expect(finalizedReplayViewer.headers.get("x-request-id")).toBe(
			"auth-finalize-replay-viewer",
		);
		expect(await finalizedReplayViewer.json()).toEqual(finalizedBody);
		expect(store.verifyCalls).toBe(verificationCalls);
		expect(store.downloadCalls).toBe(downloadCalls);
		expect(store.committedKeys).toEqual(committedKeys);
		expect(await finalizeIdempotencyRecord()).toBe(finalizedIdempotency);

		let attachmentMutationError: unknown;
		try {
			await sql`
				UPDATE event_attachments
				SET upload_id = ${blockedUpload.id},
					object_key = 'committed/' || root_event_id || '/' || id || '/' ||
						${blockedUpload.id} || '/' || sha256
				WHERE root_event_id = ${rootEventId} AND id = 'att_authreplay1'
			`;
		} catch (error) {
			attachmentMutationError = error;
		}
		expect(attachmentMutationError).toMatchObject({ code: "23514" });
		expect(store.verifyCalls).toBe(verificationCalls);
		expect(store.downloadCalls).toBe(downloadCalls);
		expect(store.committedKeys).toEqual(committedKeys);
		expect(await finalizeIdempotencyRecord()).toBe(finalizedIdempotency);

		await sql`
			UPDATE event_memberships SET status = 'removed', version = version + 1
			WHERE root_event_id = ${rootEventId} AND user_id = ${participant.id}
		`;
		const removedReplay = await finalize(
			replayUpload.id,
			"auth-finalize-replay-0001",
			"auth-finalize-replay-removed",
		);
		expect(removedReplay.status).toBe(404);
		expect(removedReplay.headers.get("idempotency-replayed")).toBeNull();
		expect(removedReplay.headers.get("x-request-id")).toBe(
			"auth-finalize-replay-removed",
		);
		const removedReplayBody = await removedReplay.json();
		expect(removedReplayBody).toMatchObject({ error: { code: "NOT_FOUND" } });
		expect(removedReplayBody).not.toEqual(finalizedBody);
		expect(JSON.stringify(removedReplayBody)).not.toContain("att_authreplay1");
		expect(store.verifyCalls).toBe(verificationCalls);
		expect(store.downloadCalls).toBe(downloadCalls);
		expect(store.committedKeys).toEqual(committedKeys);
		expect(await finalizeIdempotencyRecord()).toBe(finalizedIdempotency);
		const [proof] = await sql<
			{
				revision: string;
				removed: boolean;
				reactions: number;
				blockedAttachments: number;
			}[]
		>`
			SELECT root.revision::text AS revision,
				current.deleted_at IS NOT NULL AS removed,
				(SELECT count(*)::int FROM event_feed_reactions
				 WHERE entry_id = 'fed_authreaction1') AS reactions,
				(SELECT count(*)::int FROM event_attachments
				 WHERE id = 'att_authblocked1') AS "blockedAttachments"
			FROM event_roots root
			JOIN event_feed_entry_current current
				ON current.root_event_id = root.root_event_id
				AND current.entry_id = 'fed_authremove1'
			WHERE root.root_event_id = ${rootEventId}
		`;
		expect(proof).toEqual({
			revision: publishedStart.revision,
			removed: false,
			reactions: 0,
			blockedAttachments: 0,
		});
	});

	test("rolls feed state, root revision and idempotency claim back and sanitizes internal logs", async () => {
		await service.createRoot(owner, rootInput("evt_rollback01", "published"));
		await sql.unsafe(`
			CREATE FUNCTION fail_private_feed_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
			BEGIN
				IF NEW.entity_type = 'feedEntry' AND NEW.entity_id = 'fed_rollback1' THEN
					RAISE EXCEPTION 'forced feed rollback'
						USING DETAIL = (SELECT body FROM event_feed_entry_current WHERE entry_id = NEW.entity_id);
				END IF;
				RETURN NEW;
			END;
			$$;
			CREATE TRIGGER fail_private_feed_change_trigger
				BEFORE INSERT ON event_root_changes
				FOR EACH ROW EXECUTE FUNCTION fail_private_feed_change();
		`);
		const calls: unknown[][] = [];
		const original = console.error;
		console.error = (...values: unknown[]) => calls.push(values);
		try {
			const app = createApp({
				service,
				verifyUserToken: async (token) => ({ id: token }),
			});
			const response = await app.request(
				"/v1/event-roots/evt_rollback01/feed",
				{
					method: "POST",
					headers: commandHeaders(
						owner.id,
						"rollback-feed-0001",
						"rollback-request",
					),
					body: JSON.stringify({
						id: "fed_rollback1",
						eventId: null,
						parentEntryId: null,
						kind: "message",
						body: "private-feed-body-must-not-log",
					}),
				},
			);
			expect(response.status).toBe(500);
			expect(JSON.stringify(await response.json())).not.toContain(
				"private-feed-body",
			);
			expect(JSON.stringify(calls)).not.toContain("private-feed-body");
			expect(calls[0]?.[1]).toEqual({
				requestId: "rollback-request",
				code: "INTERNAL_ERROR",
			});
			const [proof] = await sql<
				{ revision: string; entries: number; idem: number }[]
			>`
				SELECT revision::text AS revision,
					(SELECT count(*)::int FROM event_feed_entries WHERE id = 'fed_rollback1') AS entries,
					(SELECT count(*)::int FROM event_idempotency_records
					 WHERE idempotency_key = 'rollback-feed-0001') AS idem
				FROM event_roots WHERE root_event_id = 'evt_rollback01'
			`;
			expect(proof).toEqual({ revision: "1", entries: 0, idem: 0 });
		} finally {
			console.error = original;
			await sql.unsafe(`
				DROP TRIGGER IF EXISTS fail_private_feed_change_trigger ON event_root_changes;
				DROP FUNCTION IF EXISTS fail_private_feed_change();
			`);
		}
	});
});

class MemoryObjectStore implements PrivateObjectStore {
	private readonly objects = new Map<string, Buffer>();
	private readonly verificationFailures: unknown[] = [];
	private readonly cleanupFailures: unknown[] = [];
	readonly committedKeys: string[] = [];
	verifyCalls = 0;
	downloadCalls = 0;
	lastDownloadKey: string | null = null;
	readonly deletedKeys: string[] = [];

	async createUploadGrant(input: {
		key: string;
		contentType: "image/jpeg" | "image/png" | "image/webp";
		byteCount: number;
		sha256: string;
		expiresAt: Date;
	}): Promise<UploadGrant> {
		const checksum = Buffer.from(input.sha256, "hex").toString("base64");
		const fields = {
			key: input.key,
			"Content-Type": input.contentType,
			"x-amz-checksum-algorithm": "SHA256",
			"x-amz-checksum-sha256": checksum,
			bucket: "crew-memory-private",
			"X-Amz-Algorithm": "AWS4-HMAC-SHA256",
			"X-Amz-Credential": "memory-access/20260718/us-east-1/s3/aws4_request",
			"X-Amz-Date": "20260718T120000Z",
		};
		return {
			method: "POST",
			url: `https://objects.test/upload?key=${encodeURIComponent(
				input.key,
			)}&grant-secret=upload`,
			fields: {
				...fields,
				Policy: Buffer.from(
					JSON.stringify({
						expiration: input.expiresAt.toISOString(),
						conditions: [
							["content-length-range", input.byteCount, input.byteCount],
							{ "Content-Type": input.contentType },
							{ "x-amz-checksum-algorithm": "SHA256" },
							{ "x-amz-checksum-sha256": checksum },
							{ bucket: fields.bucket },
							{ "X-Amz-Algorithm": fields["X-Amz-Algorithm"] },
							{ "X-Amz-Credential": fields["X-Amz-Credential"] },
							{ "X-Amz-Date": fields["X-Amz-Date"] },
							{ key: input.key },
						],
					}),
				).toString("base64"),
				"X-Amz-Signature": "a".repeat(64),
			},
			expiresAt: input.expiresAt,
		};
	}

	async verifyAndCommit(input: UploadObjectSpec) {
		this.verifyCalls++;
		const failure = this.verificationFailures.shift();
		if (failure) throw failure;
		const bytes = this.get(input.quarantineKey);
		await verifyAttachmentBytes(bytes, input);
		this.objects.set(input.committedKey, Buffer.from(bytes));
		this.committedKeys.push(input.committedKey);
	}

	async deleteQuarantine(input: QuarantineDeleteSpec) {
		if (input.key !== input.expectedKey || !input.key.startsWith("quarantine/"))
			throw new Error("unsafe cleanup key");
		const failure = this.cleanupFailures.shift();
		if (failure) throw failure;
		this.deletedKeys.push(input.key);
		this.objects.delete(input.key);
	}

	async deleteCommittedFeedback(input: CommittedFeedbackDeleteSpec) {
		if (input.key !== input.expectedKey || !input.key.startsWith("committed/"))
			throw new Error("unsafe committed cleanup key");
		const failure = this.cleanupFailures.shift();
		if (failure) throw failure;
		this.deletedKeys.push(input.key);
		this.objects.delete(input.key);
	}

	async createDownloadGrant(input: {
		key: string;
		expiresAt: Date;
	}): Promise<DownloadGrant> {
		this.downloadCalls++;
		this.lastDownloadKey = input.key;
		if (!this.objects.has(input.key))
			throw new ObjectVerificationError("ATTACHMENT_OBJECT_MISSING");
		return {
			method: "GET",
			url: `https://objects.test/download?key=${encodeURIComponent(
				input.key,
			)}&grant-secret=download`,
			headers: {},
			expiresAt: input.expiresAt,
		};
	}

	put(key: string, value: Uint8Array) {
		this.objects.set(key, Buffer.from(value));
	}

	failNextVerification(error: unknown) {
		this.verificationFailures.push(error);
	}

	failNextCleanup(error: unknown) {
		this.cleanupFailures.push(error);
	}

	has(key: string) {
		return this.objects.has(key);
	}

	get(key: string) {
		const value = this.objects.get(key);
		if (!value) throw new ObjectVerificationError("ATTACHMENT_OBJECT_MISSING");
		return Buffer.from(value);
	}
}

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
	role: "participant" | "viewer",
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

function attachmentWorker(
	workerId: string,
	overrides: Partial<{
		verifyLeaseSeconds: number;
		verifyMaxAttempts: number;
		verifyConcurrency: number;
		cleanupLeaseSeconds: number;
		cleanupRetentionSeconds: number;
	}> = {},
) {
	return createAttachmentWorker(
		{
			workerId,
			pollIntervalMs: 100,
			verifyLeaseSeconds: 30,
			verifyMaxAttempts: 3,
			verifyConcurrency: 1,
			cleanupLeaseSeconds: 30,
			cleanupRetentionSeconds: 86_400,
			...overrides,
		},
		new PostgresAttachmentJobRepository(sql),
		store,
	);
}

async function asDatabaseRole<T>(
	role: string,
	operation: (tx: Sql) => Promise<T>,
) {
	return sql.begin(async (transaction) => {
		const tx = transaction as unknown as Sql;
		await tx.unsafe(`SET LOCAL ROLE ${role}`);
		return operation(tx);
	}) as Promise<T>;
}

async function databaseErrorCode(operation: () => Promise<unknown>) {
	try {
		await operation();
		return null;
	} catch (error) {
		return (error as { code?: string }).code ?? null;
	}
}

function sha256(value: Uint8Array) {
	return createHash("sha256").update(value).digest("hex");
}
