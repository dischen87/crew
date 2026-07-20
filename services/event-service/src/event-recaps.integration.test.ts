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
import { migrate } from "../scripts/migrate";
import { createApp } from "./app";
import type { EventInput } from "./domain";
import { EventNotificationPayloadCodec } from "./event-notification-payload";
import { PostgresEventRepository } from "./postgres-repository";
import type { EventRecap, EventRecapExternalConsent } from "./recap-domain";
import { RecapShareTokenCodec } from "./recap-share-token";
import { EventService } from "./service";
import { installPublishedRootFixtures } from "./test-published-root-fixture";

const databaseUrl =
	Bun.env.EVENT_TEST_DATABASE_URL ?? "postgres://localhost/crew_event_test";
const invitationKey =
	"event-recap-test-invitation-key-with-at-least-32-characters";
const userId = (value: number) => `usr_${value.toString(16).padStart(32, "0")}`;
const owner = { id: userId(701), email: "owner.private@example.test" };
const organizer = { id: userId(702) };
const participant = { id: userId(703) };
const viewer = { id: userId(704) };
const outsider = { id: userId(705) };
const notificationPayloads = () =>
	new EventNotificationPayloadCodec({
		kid: "event-recap-test-v1",
		key: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
	});

type ErrorBody = {
	error: {
		code: string;
		message: string;
		requestId: string;
		retryable: boolean;
		details?: { code: string; path?: string; meta?: Record<string, unknown> }[];
	};
};
type RecapBody = { recap: EventRecapJson };
type RecapReadBody = RecapBody & {
	externalConsent: EventRecapExternalConsent | null;
};
type EventRecapJson = Omit<EventRecap, "generatedAt" | "publishedAt"> & {
	generatedAt: string;
	publishedAt: string | null;
};
type RecapShareLinkBody = {
	shareLink: {
		id: string;
		recapVersion: number;
		createdAt: string;
		expiresAt: string;
	};
	token: string;
};
type PublicRecapBody = {
	recap: {
		title: string;
		items: Array<{ ordinal: number; title: string }>;
	};
};
type PublicExternalRecapBody = {
	recap: {
		title: string;
		items: Array<{
			ordinal: number;
			title: string | null;
			body: string | null;
		}>;
	};
};

let sql: Sql;
let service: EventService;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
	sql = postgres(databaseUrl, { max: 16, onnotice: () => {} });
	await migrate(sql);
	installService();
});

beforeEach(async () => {
	await sql`TRUNCATE event_idempotency_records, event_roots CASCADE`;
});

afterAll(async () => {
	await sql.end();
});

describe("privacy-safe event recaps against PostgreSQL 17", () => {
	test("generates only exact authoritative sources and conceals tenant and consent boundaries", async () => {
		const rootEventId = "evt_recap_generate01";
		await createPublishedRoot(rootEventId);
		await addMember(rootEventId, organizer.id, "organizer");
		await addMember(rootEventId, participant.id, "participant");
		await addMember(rootEventId, viewer.id, "viewer");
		const ownerFeed = await service.createFeedEntry(owner, rootEventId, {
			id: "fed_recap_owner01",
			eventId: rootEventId,
			parentEntryId: null,
			kind: "message",
			body: "Owner-approved recap moment",
		});
		const participantFeed = await service.createFeedEntry(
			participant,
			rootEventId,
			{
				id: "fed_recap_private01",
				eventId: rootEventId,
				parentEntryId: null,
				kind: "message",
				body: "Participant private source text",
			},
		);
		const baseRevision = await currentRootRevision(rootEventId);

		const generated = await generateRequest(
			owner.id,
			rootEventId,
			"recap-generate-owner-01",
			baseRevision,
			[
				{
					type: "event",
					sourceId: rootEventId,
					sourceVersion: 1,
					consentBasis: "event-publication",
				},
				{
					type: "feedEntry",
					sourceId: ownerFeed.id,
					sourceVersion: ownerFeed.version,
					consentBasis: "source-author",
				},
			],
		);
		expect(generated.status).toBe(201);
		expect(generated.headers.get("location")).toBe(
			`/v1/event-roots/${rootEventId}/recap?version=1`,
		);
		expect(generated.headers.get("cache-control")).toBe("private, no-store");
		const generatedText = await generated.clone().text();
		const body = (await generated.json()) as RecapBody;
		expect(body.recap).toMatchObject({
			schemaVersion: 1,
			rootEventId,
			version: 1,
			lifecycleVersion: 1,
			state: "draft",
			publishedVersion: null,
			sourceRootRevision: baseRevision,
			title: "Private source-safe event title",
			titleProvenance: {
				sourceType: "event",
				sourceId: rootEventId,
				sourceVersion: 1,
				sourceRevision: "1",
				visibility: "members",
				consentBasis: "event-publication",
			},
		});
		expect(body.recap.items).toEqual([
			{
				ordinal: 0,
				sourceTitle: "Private source-safe event title",
				sourceBody: "Published event description",
				provenance: {
					sourceType: "event",
					sourceId: rootEventId,
					sourceVersion: 1,
					sourceRevision: "1",
					visibility: "members",
					consentBasis: "event-publication",
				},
			},
			{
				ordinal: 1,
				sourceTitle: null,
				sourceBody: "Owner-approved recap moment",
				provenance: {
					sourceType: "feedEntry",
					sourceId: ownerFeed.id,
					sourceVersion: ownerFeed.version,
					sourceRevision: ownerFeed.rootRevision,
					visibility: "members",
					consentBasis: "source-author",
				},
			},
		]);
		const serialized = JSON.stringify(body);
		expect(serialized).not.toContain(owner.email);
		expect(serialized).not.toContain(participant.id);
		expect(serialized).not.toContain("Participant private source text");
		const generatedReplay = await generateRequest(
			owner.id,
			rootEventId,
			"recap-generate-owner-01",
			baseRevision,
			[
				{
					type: "event",
					sourceId: rootEventId,
					sourceVersion: 1,
					consentBasis: "event-publication",
				},
				{
					type: "feedEntry",
					sourceId: ownerFeed.id,
					sourceVersion: ownerFeed.version,
					consentBasis: "source-author",
				},
			],
		);
		expect(generatedReplay.headers.get("idempotency-replayed")).toBe("true");
		expect(generatedReplay.headers.get("cache-control")).toBe(
			"private, no-store",
		);
		expect(await generatedReplay.text()).toBe(generatedText);

		for (const actorId of [participant.id, viewer.id]) {
			expect((await getRecap(actorId, rootEventId)).status).toBe(404);
		}
		const organizerRead = await getRecap(organizer.id, rootEventId);
		expect(organizerRead.status).toBe(200);
		expect(organizerRead.headers.get("cache-control")).toBe(
			"private, no-store",
		);
		expect(
			(
				await generateRequest(
					participant.id,
					rootEventId,
					"recap-generate-participant-01",
					baseRevision,
					[],
				)
			).status,
		).toBe(403);

		const consentDenied = await generateRequest(
			owner.id,
			rootEventId,
			"recap-generate-no-consent-01",
			baseRevision,
			[
				{
					type: "feedEntry",
					sourceId: participantFeed.id,
					sourceVersion: participantFeed.version,
					consentBasis: "source-author",
				},
			],
		);
		expect(consentDenied.status).toBe(409);
		const consentText = await consentDenied.text();
		expect((JSON.parse(consentText) as ErrorBody).error).toMatchObject({
			code: "RECAP_GENERATION_SOURCE_INVALID",
			details: [{ code: "RECAP_SOURCE_CONSENT_REQUIRED", path: "sources.0" }],
		});
		expect(consentText).not.toContain(participantFeed.id);
		expect(consentText).not.toContain("Participant private source text");

		const unknownRoot = "evt_recap_unknown01";
		const existing = await errorResponse(getRecap(outsider.id, rootEventId));
		const unknown = await errorResponse(getRecap(outsider.id, unknownRoot));
		expect(existing.status).toBe(404);
		expect(unknown.status).toBe(404);
		expect(normalizeError(existing.body)).toEqual(normalizeError(unknown.body));
		const generateExisting = await errorResponse(
			generateRequest(
				outsider.id,
				rootEventId,
				"recap-generate-outsider-existing-01",
				baseRevision,
				[],
			),
		);
		const generateUnknown = await errorResponse(
			generateRequest(
				outsider.id,
				unknownRoot,
				"recap-generate-outsider-unknown-01",
				"1",
				[],
			),
		);
		expect(generateExisting.status).toBe(404);
		expect(generateUnknown.status).toBe(404);
		expect(normalizeError(generateExisting.body)).toEqual(
			normalizeError(generateUnknown.body),
		);

		const duplicate = await generateRequest(
			owner.id,
			rootEventId,
			"recap-generate-duplicate-01",
			baseRevision,
			[
				{
					type: "event",
					sourceId: rootEventId,
					sourceVersion: 1,
					consentBasis: "event-publication",
				},
				{
					type: "event",
					sourceId: rootEventId,
					sourceVersion: 1,
					consentBasis: "event-publication",
				},
			],
		);
		expect(duplicate.status).toBe(400);

		const oversizedVersion = await getRecap(
			owner.id,
			rootEventId,
			"9007199254740993",
		);
		expect(oversizedVersion.status).toBe(400);
		expect(((await oversizedVersion.json()) as ErrorBody).error.code).toBe(
			"VALIDATION_FAILED",
		);
		expect((await getRecap(owner.id, rootEventId, "2147483648")).status).toBe(
			400,
		);
		const clientText = await app.request(
			`/v1/event-roots/${rootEventId}/recap/generate`,
			{
				method: "POST",
				headers: commandAuth(owner.id, "recap-generate-client-text-01"),
				body: JSON.stringify({
					baseRevision,
					sources: [],
					summary: "Client or provider-authored recap text",
				}),
			},
		);
		expect(clientText.status).toBe(400);
	});

	test("publishes once under concurrency and keeps participants on the current published snapshot", async () => {
		const rootEventId = "evt_recap_publish01";
		await createPublishedRoot(rootEventId);
		await addMember(rootEventId, organizer.id, "organizer");
		await addMember(rootEventId, participant.id, "participant");
		await addMember(rootEventId, viewer.id, "viewer");
		const revision = await currentRootRevision(rootEventId);
		const draft = await generatedRecap(
			owner.id,
			rootEventId,
			"recap-publish-generate-01",
			revision,
		);

		const attempts = await Promise.all([
			publishRequest(
				organizer.id,
				rootEventId,
				"recap-publish-race-a-01",
				draft.version,
				draft.lifecycleVersion,
			),
			publishRequest(
				organizer.id,
				rootEventId,
				"recap-publish-race-b-01",
				draft.version,
				draft.lifecycleVersion,
			),
		]);
		expect(attempts.map(({ status }) => status).sort()).toEqual([200, 409]);
		const winner = attempts.find(({ status }) => status === 200);
		const loser = attempts.find(({ status }) => status === 409);
		if (!winner || !loser) throw new Error("Expected one recap publish winner");
		expect(winner.headers.get("cache-control")).toBe("private, no-store");
		const winnerKey =
			winner === attempts[0]
				? "recap-publish-race-a-01"
				: "recap-publish-race-b-01";
		const winnerText = await winner.clone().text();
		expect(((await loser.json()) as ErrorBody).error.code).toBe(
			"RECAP_VERSION_CONFLICT",
		);

		const replay = await publishRequest(
			organizer.id,
			rootEventId,
			winnerKey,
			draft.version,
			draft.lifecycleVersion,
		);
		expect(replay.headers.get("idempotency-replayed")).toBe("true");
		expect(replay.headers.get("cache-control")).toBe("private, no-store");
		expect(await replay.text()).toBe(winnerText);
		const changedReplay = await publishRequest(
			organizer.id,
			rootEventId,
			winnerKey,
			draft.version + 1,
			draft.lifecycleVersion,
		);
		expect(changedReplay.status).toBe(409);
		expect(((await changedReplay.json()) as ErrorBody).error.code).toBe(
			"IDEMPOTENCY_KEY_REUSED",
		);

		for (const actorId of [participant.id, viewer.id]) {
			const response = await getRecap(actorId, rootEventId);
			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe("private, no-store");
			expect(((await response.json()) as RecapBody).recap).toMatchObject({
				version: 1,
				state: "published",
				publishedVersion: 1,
			});
		}

		const second = await generatedRecap(
			owner.id,
			rootEventId,
			"recap-publish-generate-02",
			revision,
		);
		expect(second).toMatchObject({
			version: 2,
			lifecycleVersion: 3,
			state: "draft",
			publishedVersion: 1,
		});
		expect(
			(
				(await (
					await getRecap(participant.id, rootEventId)
				).json()) as RecapBody
			).recap.version,
		).toBe(1);
		expect(
			((await (await getRecap(owner.id, rootEventId)).json()) as RecapBody)
				.recap.version,
		).toBe(2);
		const stalePublish = await publishRequest(
			owner.id,
			rootEventId,
			"recap-publish-stale-01",
			1,
			second.lifecycleVersion,
		);
		expect(stalePublish.status).toBe(409);
		expect(((await stalePublish.json()) as ErrorBody).error.code).toBe(
			"RECAP_SNAPSHOT_STALE",
		);

		const unknownRoot = "evt_recap_unknown02";
		const publishExisting = await errorResponse(
			publishRequest(
				outsider.id,
				rootEventId,
				"recap-publish-outsider-existing-01",
				2,
				second.lifecycleVersion,
			),
		);
		const publishUnknown = await errorResponse(
			publishRequest(
				outsider.id,
				unknownRoot,
				"recap-publish-outsider-unknown-01",
				2,
				second.lifecycleVersion,
			),
		);
		expect(publishExisting.status).toBe(404);
		expect(publishUnknown.status).toBe(404);
		expect(normalizeError(publishExisting.body)).toEqual(
			normalizeError(publishUnknown.body),
		);
		const removeExisting = await errorResponse(
			removeRequest(
				outsider.id,
				rootEventId,
				"recap-remove-outsider-existing-01",
				second.lifecycleVersion,
			),
		);
		const removeUnknown = await errorResponse(
			removeRequest(
				outsider.id,
				unknownRoot,
				"recap-remove-outsider-unknown-01",
				second.lifecycleVersion,
			),
		);
		expect(removeExisting.status).toBe(404);
		expect(removeUnknown.status).toBe(404);
		expect(normalizeError(removeExisting.body)).toEqual(
			normalizeError(removeUnknown.body),
		);

		for (const actorId of [participant.id, viewer.id]) {
			expect(
				(
					await publishRequest(
						actorId,
						rootEventId,
						`recap-publish-role-${actorId}`,
						2,
						second.lifecycleVersion,
					)
				).status,
			).toBe(403);
			expect(
				(
					await removeRequest(
						actorId,
						rootEventId,
						`recap-remove-role-${actorId}`,
						second.lifecycleVersion,
					)
				).status,
			).toBe(403);
		}
	});

	test("blocks publication after source drift and omits whole items after consent revocation", async () => {
		const rootEventId = "evt_recap_revoke01";
		await createPublishedRoot(rootEventId);
		await addMember(rootEventId, organizer.id, "organizer");
		await addMember(rootEventId, participant.id, "participant");
		const feed = await service.createFeedEntry(organizer, rootEventId, {
			id: "fed_recap_revoke01",
			eventId: rootEventId,
			parentEntryId: null,
			kind: "message",
			body: "Consent-bearing original moment",
		});
		const draftResponse = await generateRequest(
			organizer.id,
			rootEventId,
			"recap-revoke-generate-01",
			await currentRootRevision(rootEventId),
			[
				{
					type: "feedEntry",
					sourceId: feed.id,
					sourceVersion: 1,
					consentBasis: "source-author",
				},
			],
		);
		expect(draftResponse.status).toBe(201);
		const draft = ((await draftResponse.json()) as RecapBody).recap;
		const revised = await service.reviseFeedEntry(
			organizer,
			rootEventId,
			feed.id,
			1,
			"Consent-bearing revised moment",
		);
		const stalePublish = await publishRequest(
			organizer.id,
			rootEventId,
			"recap-revoke-publish-stale-01",
			draft.version,
			draft.lifecycleVersion,
		);
		expect(stalePublish.status).toBe(409);
		const staleText = await stalePublish.text();
		expect((JSON.parse(staleText) as ErrorBody).error).toMatchObject({
			code: "RECAP_PUBLISH_SOURCE_INVALID",
			details: [{ code: "RECAP_SOURCE_VERSION_CHANGED", path: "items.0" }],
		});
		expect(staleText).not.toContain("Consent-bearing original moment");

		const currentResponse = await generateRequest(
			organizer.id,
			rootEventId,
			"recap-revoke-generate-02",
			await currentRootRevision(rootEventId),
			[
				{
					type: "feedEntry",
					sourceId: feed.id,
					sourceVersion: revised.version,
					consentBasis: "source-author",
				},
			],
		);
		expect(currentResponse.status).toBe(201);
		const current = ((await currentResponse.json()) as RecapBody).recap;
		const published = await publishRequest(
			owner.id,
			rootEventId,
			"recap-revoke-publish-current-01",
			current.version,
			current.lifecycleVersion,
		);
		expect(published.status).toBe(200);
		expect(
			(
				(await (
					await getRecap(participant.id, rootEventId)
				).json()) as RecapBody
			).recap.items,
		).toHaveLength(1);

		const removedMembership = await service.updateMembership(
			owner,
			rootEventId,
			organizer.id,
			1,
			"organizer",
			"removed",
			"recap consent withdrawn",
		);
		const filtered = await getRecap(participant.id, rootEventId);
		expect(filtered.status).toBe(200);
		const filteredText = await filtered.text();
		expect((JSON.parse(filteredText) as RecapBody).recap.items).toEqual([]);
		expect(filteredText).not.toContain("Consent-bearing revised moment");

		const concealedWhileRemoved = await generateRequest(
			organizer.id,
			rootEventId,
			"recap-revoke-generate-02",
			current.sourceRootRevision,
			[
				{
					type: "feedEntry",
					sourceId: feed.id,
					sourceVersion: revised.version,
					consentBasis: "source-author",
				},
			],
		);
		expect(concealedWhileRemoved.status).toBe(404);
		const concealedWhileRemovedText = await concealedWhileRemoved.text();
		expect(concealedWhileRemovedText).not.toContain(rootEventId);
		expect(concealedWhileRemovedText).not.toContain(current.title);
		expect(concealedWhileRemovedText).not.toContain(
			"Consent-bearing revised moment",
		);
		expect(concealedWhileRemovedText).not.toContain('"lifecycleVersion"');

		const rejoinedMembership = await service.updateMembership(
			owner,
			rootEventId,
			organizer.id,
			removedMembership.version,
			"organizer",
			"active",
			null,
		);
		expect(rejoinedMembership.version).toBe(3);
		const stillFiltered = await getRecap(participant.id, rootEventId);
		expect(stillFiltered.status).toBe(200);
		const stillFilteredText = await stillFiltered.text();
		expect((JSON.parse(stillFilteredText) as RecapBody).recap.items).toEqual(
			[],
		);
		expect(stillFilteredText).not.toContain("Consent-bearing revised moment");

		const concealedAfterRejoin = await generateRequest(
			organizer.id,
			rootEventId,
			"recap-revoke-generate-02",
			current.sourceRootRevision,
			[
				{
					type: "feedEntry",
					sourceId: feed.id,
					sourceVersion: revised.version,
					consentBasis: "source-author",
				},
			],
		);
		expect(concealedAfterRejoin.status).toBe(404);
		const concealedAfterRejoinText = await concealedAfterRejoin.text();
		expect(concealedAfterRejoinText).not.toContain(rootEventId);
		expect(concealedAfterRejoinText).not.toContain(current.title);
		expect(concealedAfterRejoinText).not.toContain(
			"Consent-bearing revised moment",
		);

		const concealedPublishReplay = await publishRequest(
			owner.id,
			rootEventId,
			"recap-revoke-publish-current-01",
			current.version,
			current.lifecycleVersion,
		);
		expect(concealedPublishReplay.status).toBe(404);
		const concealedPublishText = await concealedPublishReplay.text();
		expect(concealedPublishText).not.toContain(rootEventId);
		expect(concealedPublishText).not.toContain(current.title);
		expect(concealedPublishText).not.toContain(
			"Consent-bearing revised moment",
		);

		await service.updateEvent(owner, rootEventId, rootEventId, 1, {
			title: "Updated root title invalidates the title provenance",
		});
		const invalidTitle = await getRecap(participant.id, rootEventId);
		expect(invalidTitle.status).toBe(404);
		expect(await invalidTitle.text()).not.toContain(
			"Private source-safe event title",
		);
	});

	test("conceals stored success and error responses after authority loss while preserving key integrity", async () => {
		const publishRootEventId = "evt_recap_publishguard01";
		await createPublishedRoot(publishRootEventId);
		await addMember(publishRootEventId, organizer.id, "organizer");
		const publishDraft = await generatedRecap(
			owner.id,
			publishRootEventId,
			"recap-publisher-guard-generate-01",
			await currentRootRevision(publishRootEventId),
		);
		const organizerPublish = await publishRequest(
			organizer.id,
			publishRootEventId,
			"recap-publisher-guard-publish-01",
			publishDraft.version,
			publishDraft.lifecycleVersion,
		);
		expect(organizerPublish.status).toBe(200);
		expect(organizerPublish.headers.get("cache-control")).toBe(
			"private, no-store",
		);
		const organizerPublishBody = ((await organizerPublish.json()) as RecapBody)
			.recap;
		await service.updateMembership(
			owner,
			publishRootEventId,
			organizer.id,
			1,
			"organizer",
			"removed",
			"publisher authority revoked",
		);
		const concealedPublishAfterRemoval = await publishRequest(
			organizer.id,
			publishRootEventId,
			"recap-publisher-guard-publish-01",
			publishDraft.version,
			publishDraft.lifecycleVersion,
		);
		expect(concealedPublishAfterRemoval.status).toBe(404);
		const concealedPublishAfterRemovalText =
			await concealedPublishAfterRemoval.text();
		expect(concealedPublishAfterRemovalText).not.toContain(publishRootEventId);
		expect(concealedPublishAfterRemovalText).not.toContain(
			organizerPublishBody.title,
		);
		expect(concealedPublishAfterRemovalText).not.toContain(
			"Published event description",
		);
		expect(concealedPublishAfterRemovalText).not.toContain(
			'"lifecycleVersion"',
		);

		const rootEventId = "evt_recap_replayguard01";
		await createPublishedRoot(rootEventId);
		await addMember(rootEventId, organizer.id, "organizer");
		const revision = await currentRootRevision(rootEventId);
		const draft = await generatedRecap(
			owner.id,
			rootEventId,
			"recap-guard-generate-01",
			revision,
		);
		const publishedResponse = await publishRequest(
			owner.id,
			rootEventId,
			"recap-guard-publish-01",
			draft.version,
			draft.lifecycleVersion,
		);
		expect(publishedResponse.status).toBe(200);
		const published = ((await publishedResponse.json()) as RecapBody).recap;
		const removed = await removeRequest(
			organizer.id,
			rootEventId,
			"recap-guard-remove-01",
			published.lifecycleVersion,
		);
		expect(removed.status).toBe(200);
		expect(removed.headers.get("cache-control")).toBe("private, no-store");

		await service.updateEvent(owner, rootEventId, rootEventId, 1, {
			title: "Current title must not revive an old replay",
		});
		const currentRevision = await currentRootRevision(rootEventId);
		const storedError = await generateRequest(
			organizer.id,
			rootEventId,
			"recap-guard-error-01",
			revision,
			[],
		);
		expect(storedError.status).toBe(409);
		expect(((await storedError.json()) as ErrorBody).error.code).toBe(
			"ROOT_REVISION_CONFLICT",
		);

		await service.updateMembership(
			owner,
			rootEventId,
			organizer.id,
			1,
			"organizer",
			"removed",
			"replay authority revoked",
		);

		const removeReplay = await removeRequest(
			organizer.id,
			rootEventId,
			"recap-guard-remove-01",
			published.lifecycleVersion,
		);
		expect(removeReplay.status).toBe(404);
		const removeReplayText = await removeReplay.text();
		expect(removeReplayText).not.toContain(rootEventId);
		expect(removeReplayText).not.toContain(published.title);
		expect(removeReplayText).not.toContain("Published event description");
		expect(removeReplayText).not.toContain('"lifecycleVersion"');

		const errorReplay = await generateRequest(
			organizer.id,
			rootEventId,
			"recap-guard-error-01",
			revision,
			[],
		);
		expect(errorReplay.status).toBe(404);
		const errorReplayText = await errorReplay.text();
		expect(errorReplayText).not.toContain(rootEventId);
		expect(errorReplayText).not.toContain(published.title);
		expect(errorReplayText).not.toContain("Published event description");
		expect(errorReplayText).not.toContain(
			`"currentRevision":"${currentRevision}"`,
		);
		expect(errorReplayText).not.toContain('"lifecycleVersion"');

		const changedRequest = await generateRequest(
			organizer.id,
			rootEventId,
			"recap-guard-error-01",
			currentRevision,
			[],
		);
		expect(changedRequest.status).toBe(409);
		expect(((await changedRequest.json()) as ErrorBody).error.code).toBe(
			"IDEMPOTENCY_KEY_REUSED",
		);
	});

	test("treats expired idempotency bodies as absent and cleans them with a bounded DB-clock batch", async () => {
		const rootEventId = "evt_recap_expiry01";
		const idempotencyKey = "recap-expiry-generate-01";
		await createPublishedRoot(rootEventId);
		const revision = await currentRootRevision(rootEventId);
		const first = await generateRequest(
			owner.id,
			rootEventId,
			idempotencyKey,
			revision,
			[
				{
					type: "event",
					sourceId: rootEventId,
					sourceVersion: 1,
					consentBasis: "event-publication",
				},
			],
		);
		expect(first.status).toBe(201);
		const firstText = await first.text();
		expect(firstText).toContain("Private source-safe event title");
		expect(firstText).toContain("Published event description");

		await sql`
			WITH cutoff AS (SELECT clock_timestamp() AS value)
			UPDATE event_idempotency_records SET
				created_at = cutoff.value - interval '31 days',
				expires_at = cutoff.value - interval '1 day'
			FROM cutoff
			WHERE actor_id = ${owner.id}
				AND operation_id = 'eventRecapsGenerate'
				AND idempotency_key = ${idempotencyKey}
		`;
		await sql`
			WITH cutoff AS (SELECT clock_timestamp() AS value)
			INSERT INTO event_idempotency_records (
				actor_id, operation_id, idempotency_key, request_hash, state,
				response_status, response_body, response_headers, created_at,
				completed_at, expires_at
			)
			SELECT ${owner.id}, 'cleanupProbe', 'expired-cleanup-' || item::text,
				repeat('a', 64), 'complete', 200,
				jsonb_build_object('secret', 'expired-' || item::text), '{}'::jsonb,
				cutoff.value - interval '31 days', cutoff.value - interval '1 day',
				cutoff.value - interval '1 day'
			FROM cutoff CROSS JOIN generate_series(1, 101) AS item
		`;

		await service.updateEvent(owner, rootEventId, rootEventId, 1, {
			title: "New title after idempotency expiry",
		});
		const afterExpiry = await generateRequest(
			owner.id,
			rootEventId,
			idempotencyKey,
			revision,
			[
				{
					type: "event",
					sourceId: rootEventId,
					sourceVersion: 1,
					consentBasis: "event-publication",
				},
			],
		);
		expect(afterExpiry.status).toBe(409);
		expect(afterExpiry.headers.get("idempotency-replayed")).toBe("false");
		const afterExpiryText = await afterExpiry.text();
		expect((JSON.parse(afterExpiryText) as ErrorBody).error.code).toBe(
			"ROOT_REVISION_CONFLICT",
		);
		expect(afterExpiryText).not.toContain("Private source-safe event title");
		expect(afterExpiryText).not.toContain("Published event description");
		const [cleanup] = await sql<
			{
				expired: number;
				responseStatus: number;
				active: boolean;
			}[]
		>`
			SELECT
				(SELECT count(*)::int FROM event_idempotency_records
					WHERE expires_at <= clock_timestamp()) AS expired,
				response_status AS "responseStatus",
				expires_at > clock_timestamp() AS active
			FROM event_idempotency_records
			WHERE actor_id = ${owner.id}
				AND operation_id = 'eventRecapsGenerate'
				AND idempotency_key = ${idempotencyKey}
		`;
		expect(cleanup).toEqual({ expired: 1, responseStatus: 409, active: true });
	});

	test("tombstones every old version while retaining immutable audit snapshots", async () => {
		const rootEventId = "evt_recap_remove01";
		await createPublishedRoot(rootEventId);
		await addMember(rootEventId, participant.id, "participant");
		const revision = await currentRootRevision(rootEventId);
		const draft = await generatedRecap(
			owner.id,
			rootEventId,
			"recap-remove-generate-01",
			revision,
		);
		const publishedResponse = await publishRequest(
			owner.id,
			rootEventId,
			"recap-remove-publish-01",
			draft.version,
			draft.lifecycleVersion,
		);
		expect(publishedResponse.status).toBe(200);
		const published = ((await publishedResponse.json()) as RecapBody).recap;

		const removed = await removeRequest(
			owner.id,
			rootEventId,
			"recap-remove-command-01",
			published.lifecycleVersion,
		);
		expect(removed.status).toBe(200);
		expect(removed.headers.get("cache-control")).toBe("private, no-store");
		expect(await removed.clone().json()).toEqual({
			removed: true,
			lifecycleVersion: 3,
		});
		const removedText = await removed.text();
		const replay = await removeRequest(
			owner.id,
			rootEventId,
			"recap-remove-command-01",
			published.lifecycleVersion,
		);
		expect(replay.headers.get("idempotency-replayed")).toBe("true");
		expect(replay.headers.get("cache-control")).toBe("private, no-store");
		expect(await replay.text()).toBe(removedText);

		for (const actorId of [owner.id, participant.id]) {
			expect((await getRecap(actorId, rootEventId)).status).toBe(404);
			expect((await getRecap(actorId, rootEventId, "1")).status).toBe(404);
		}
		const [audit] = await sql<
			{
				snapshots: number;
				items: number;
				actions: string;
				latestVersion: number;
				publishedVersion: number | null;
				removedThroughVersion: number;
			}[]
		>`
			SELECT
				(SELECT count(*)::int FROM event_recap_snapshots
					WHERE root_event_id = ${rootEventId}) AS snapshots,
				(SELECT count(*)::int FROM event_recap_items
					WHERE root_event_id = ${rootEventId}) AS items,
				(SELECT string_agg(action, ',' ORDER BY lifecycle_version)
					FROM event_recap_audit_events
					WHERE root_event_id = ${rootEventId}) AS actions,
				latest_version AS "latestVersion",
				published_version AS "publishedVersion",
				removed_through_version AS "removedThroughVersion"
			FROM event_recap_heads WHERE root_event_id = ${rootEventId}
		`;
		expect(audit).toEqual({
			snapshots: 1,
			items: 1,
			actions: "generate,publish,remove",
			latestVersion: 1,
			publishedVersion: null,
			removedThroughVersion: 1,
		});
		let snapshotMutationError: unknown;
		try {
			await sql`UPDATE event_recap_snapshots SET title = 'mutated'
				WHERE root_event_id = ${rootEventId} AND version = 1`;
		} catch (error) {
			snapshotMutationError = error;
		}
		expect(snapshotMutationError).toMatchObject({ code: "55000" });
		let itemMutationError: unknown;
		try {
			await sql`DELETE FROM event_recap_items
				WHERE root_event_id = ${rootEventId} AND recap_version = 1`;
		} catch (error) {
			itemMutationError = error;
		}
		expect(itemMutationError).toMatchObject({ code: "55000" });
		let itemInsertError: unknown;
		try {
			await sql`
				INSERT INTO event_recap_items (
					root_event_id, recap_version, ordinal, source_type, source_id,
					source_version, source_revision, source_visibility, consent_basis,
					consented_by_user_id, consent_membership_version, source_title,
					source_body
				) VALUES (
					${rootEventId}, 1, 49, 'event', ${rootEventId},
					1, 1, 'members', 'event-publication', NULL, NULL,
					'Late inserted title', 'Late inserted body'
				)
			`;
		} catch (error) {
			itemInsertError = error;
		}
		expect(itemInsertError).toMatchObject({ code: "55000" });
		let auditMutationError: unknown;
		try {
			await sql`UPDATE event_recap_audit_events SET actor_id = ${participant.id}
				WHERE root_event_id = ${rootEventId} AND lifecycle_version = 2`;
		} catch (error) {
			auditMutationError = error;
		}
		expect(auditMutationError).toMatchObject({ code: "55000" });

		const regenerated = await generatedRecap(
			owner.id,
			rootEventId,
			"recap-remove-generate-02",
			revision,
		);
		expect(regenerated).toMatchObject({
			version: 2,
			lifecycleVersion: 4,
			state: "draft",
			publishedVersion: null,
		});
		expect((await getRecap(owner.id, rootEventId, "1")).status).toBe(404);
		expect((await getRecap(owner.id, rootEventId, "2")).status).toBe(200);
		expect((await getRecap(participant.id, rootEventId)).status).toBe(404);
	});

	test("creates one hash-only title-only share and rotates it under exact idempotency", async () => {
		const rootEventId = "evt_recap_share_contract01";
		const sensitiveMarker = "SENSITIVE_RECAP_BODY_NEVER_PUBLIC_01";
		const childSensitiveMarker = "SENSITIVE_RECAP_BODY_NEVER_PUBLIC_03";
		await createPublishedRoot(rootEventId);
		await addMember(rootEventId, participant.id, "participant");
		const feed = await service.createFeedEntry(owner, rootEventId, {
			id: "fed_recap_share_contract01",
			eventId: rootEventId,
			parentEntryId: null,
			kind: "message",
			body: sensitiveMarker,
		});
		const attachmentId = "att_recap_share_contract01";
		const uploadId = "upl_recap_share_contract01";
		const mediaSha = "c".repeat(64);
		const mediaCaption = "SENSITIVE_MEDIA_CAPTION_NEVER_PUBLIC_01";
		const quarantineObjectKey = `quarantine/${rootEventId}/${attachmentId}/${uploadId}/12-${mediaSha}`;
		const committedObjectKey = `committed/${rootEventId}/${attachmentId}/${uploadId}/${mediaSha}`;
		await sql`
			INSERT INTO event_attachment_uploads (
				id, attachment_id, root_event_id, target_entry_id, created_by,
				quarantine_object_key, content_type, byte_count, sha256,
				grant_kid, grant_ciphertext, state, expires_at, committed_at
			) VALUES (
				${uploadId}, ${attachmentId}, ${rootEventId}, ${feed.id}, ${owner.id},
				${quarantineObjectKey},
				'image/jpeg', 12, ${mediaSha}, 'recap-test-v1', ${"x".repeat(32)},
				'committed', clock_timestamp() + interval '1 hour', clock_timestamp()
			)
		`;
		await sql`
			INSERT INTO event_attachments (
				id, root_event_id, target_entry_id, upload_id, created_by, object_key,
				content_type, byte_count, sha256, caption, root_revision
			) VALUES (
				${attachmentId}, ${rootEventId}, ${feed.id}, ${uploadId}, ${owner.id},
				${committedObjectKey},
				'image/jpeg', 12, ${mediaSha}, ${mediaCaption}, ${feed.rootRevision}
			)
		`;
		const child = await service.createEvent(owner, rootEventId, rootEventId, {
			id: "evt_recap_share_child01",
			kind: "activity",
			title: "Published titled highlight",
			description: childSensitiveMarker,
			timeZone: "Europe/Zurich",
			startsAt: null,
			endsAt: null,
			status: "published",
		});
		const currentRootEvent = await service.getEvent(
			owner,
			rootEventId,
			rootEventId,
		);
		const generatedResponse = await generateRequest(
			owner.id,
			rootEventId,
			"recap-share-contract-generate-01",
			await currentRootRevision(rootEventId),
			[
				{
					type: "event",
					sourceId: rootEventId,
					sourceVersion: currentRootEvent.version,
					consentBasis: "event-publication",
				},
				{
					type: "feedEntry",
					sourceId: feed.id,
					sourceVersion: feed.version,
					consentBasis: "source-author",
				},
				{
					type: "event",
					sourceId: child.id,
					sourceVersion: child.version,
					consentBasis: "event-publication",
				},
			],
		);
		expect(generatedResponse.status).toBe(201);
		const draft = ((await generatedResponse.json()) as RecapBody).recap;
		const publishedResponse = await publishRequest(
			owner.id,
			rootEventId,
			"recap-share-contract-publish-01",
			draft.version,
			draft.lifecycleVersion,
		);
		expect(publishedResponse.status).toBe(200);
		const published = ((await publishedResponse.json()) as RecapBody).recap;
		for (const [index, invalid] of [
			undefined,
			{},
			{ recapVersion: published.version },
			{
				recapVersion: published.version,
				projectionConsent: "not-reviewed",
			},
			{
				recapVersion: published.version,
				projectionConsent: "title-only-reviewed",
				extra: true,
			},
		].entries()) {
			const response = await createShareLinkBody(
				owner.id,
				rootEventId,
				`recap-share-contract-invalid-${index}`,
				invalid,
			);
			expect(response.status).toBe(400);
		}
		expect(
			(
				await sql<{ count: number }[]>`
					SELECT count(*)::int AS count FROM event_recap_share_links
					WHERE root_event_id = ${rootEventId}
				`
			)[0]?.count,
		).toBe(0);

		const firstResponse = await createShareLink(
			owner.id,
			rootEventId,
			"recap-share-contract-create-01",
		);
		expect(firstResponse.status).toBe(201);
		expect(firstResponse.headers.get("cache-control")).toBe(
			"private, no-store",
		);
		const firstText = await firstResponse.clone().text();
		const first = (await firstResponse.json()) as RecapShareLinkBody;
		expect(first.shareLink).toMatchObject({ recapVersion: published.version });
		expect(first.shareLink.id).toMatch(/^rsh_[A-Za-z0-9_-]{24}$/);
		expect(first.token).toMatch(/^crs_[A-Za-z0-9_-]{43}$/);
		expect(firstResponse.headers.get("location")).toBe(
			`/v1/event-roots/${rootEventId}/recap/share-links/${first.shareLink.id}`,
		);
		expect(
			new Date(first.shareLink.expiresAt).getTime() -
				new Date(first.shareLink.createdAt).getTime(),
		).toBe(7 * 24 * 60 * 60 * 1_000);

		const [stored] = await sql<
			{
				projectionConsent: string;
				tokenHash: string;
				responseBody: string;
				responseHeaders: string;
			}[]
		>`
			SELECT link.projection_consent AS "projectionConsent",
				link.token_hash AS "tokenHash",
				command.response_body::text AS "responseBody",
				command.response_headers::text AS "responseHeaders"
			FROM event_recap_share_links link
			JOIN event_idempotency_records command
				ON command.actor_id = ${owner.id}
				AND command.operation_id = 'eventRecapShareLinksCreate'
				AND command.idempotency_key = 'recap-share-contract-create-01'
			WHERE link.id = ${first.shareLink.id}
		`;
		expect(stored?.projectionConsent).toBe("title-only-reviewed");
		expect(stored?.tokenHash).toBe(
			createHash("sha256").update(first.token).digest("hex"),
		);
		expect(stored?.responseBody).not.toContain(first.token);
		expect(stored?.responseHeaders).not.toContain(first.token);
		expect(stored?.responseBody).not.toContain("token");

		let overlongExpiryError: unknown;
		try {
			await sql`
				UPDATE event_recap_share_links
				SET expires_at = created_at + interval '7 days 1 second'
				WHERE id = ${first.shareLink.id}
			`;
		} catch (error) {
			overlongExpiryError = error;
		}
		expect(overlongExpiryError).toMatchObject({ code: "23514" });

		const replayResponse = await createShareLink(
			owner.id,
			rootEventId,
			"recap-share-contract-create-01",
		);
		expect(replayResponse.status).toBe(201);
		expect(replayResponse.headers.get("idempotency-replayed")).toBe("true");
		expect(replayResponse.headers.get("cache-control")).toBe(
			"private, no-store",
		);
		expect(await replayResponse.text()).toBe(firstText);
		const changedVersionReplay = await createShareLinkBody(
			owner.id,
			rootEventId,
			"recap-share-contract-create-01",
			{
				recapVersion: published.version + 1,
				projectionConsent: "title-only-reviewed",
			},
		);
		expect(changedVersionReplay.status).toBe(409);
		expect(((await changedVersionReplay.json()) as ErrorBody).error.code).toBe(
			"IDEMPOTENCY_KEY_REUSED",
		);

		const changedReplay = await createShareLink(
			owner.id,
			"evt_recap_share_changed01",
			"recap-share-contract-create-01",
			published.version,
		);
		expect(changedReplay.status).toBe(409);
		expect(((await changedReplay.json()) as ErrorBody).error.code).toBe(
			"IDEMPOTENCY_KEY_REUSED",
		);

		const publicResponse = await resolveShareLink(first.token);
		expect(publicResponse.status).toBe(200);
		expect(publicResponse.headers.get("cache-control")).toBe(
			"private, no-store",
		);
		const publicText = await publicResponse.clone().text();
		expect((await publicResponse.json()) as PublicRecapBody).toEqual({
			recap: {
				title: "Private source-safe event title",
				items: [
					{ ordinal: 0, title: "Private source-safe event title" },
					{ ordinal: 1, title: "Published titled highlight" },
				],
			},
		});
		for (const concealed of [
			rootEventId,
			feed.id,
			child.id,
			attachmentId,
			uploadId,
			owner.id,
			first.token,
			sensitiveMarker,
			childSensitiveMarker,
			mediaCaption,
			mediaSha,
			quarantineObjectKey,
			committedObjectKey,
			"image/jpeg",
			"Published event description",
			"sourceBody",
			"sourceId",
			"provenance",
		]) {
			expect(publicText).not.toContain(concealed);
		}

		const unauthenticatedR1 = await app.request(
			`/v1/event-roots/${rootEventId}/recap`,
		);
		expect(unauthenticatedR1.status).toBe(401);
		const memberR1 = await getRecap(participant.id, rootEventId);
		expect(memberR1.status).toBe(200);
		expect(await memberR1.text()).toContain(sensitiveMarker);

		const secondResponse = await createShareLink(
			owner.id,
			rootEventId,
			"recap-share-contract-create-02",
		);
		expect(secondResponse.status).toBe(201);
		const second = (await secondResponse.json()) as RecapShareLinkBody;
		expect(second.token).not.toBe(first.token);
		const [rotation] = await sql<{ active: number; revoked: number }[]>`
			SELECT count(*) FILTER (WHERE revoked_at IS NULL)::int AS active,
				count(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked
			FROM event_recap_share_links WHERE root_event_id = ${rootEventId}
		`;
		expect(rotation).toEqual({ active: 1, revoked: 1 });

		const unknown = await errorResponse(
			resolveShareLink(`crs_${"A".repeat(43)}`),
		);
		expect(
			(await resolveShareLink(`crs_${"A".repeat(43)}`)).headers.get(
				"cache-control",
			),
		).toBe("private, no-store");
		const rotated = await errorResponse(resolveShareLink(first.token));
		expect(rotated.status).toBe(404);
		expect(normalizeError(rotated.body)).toEqual(normalizeError(unknown.body));
		const concealedReplay = await errorResponse(
			createShareLink(owner.id, rootEventId, "recap-share-contract-create-01"),
		);
		expect(concealedReplay.status).toBe(404);
		expect(normalizeError(concealedReplay.body)).toEqual(
			normalizeError(unknown.body),
		);
		expect((await resolveShareLink(second.token)).status).toBe(200);
		for (const malformed of [
			await resolveShareLink("not-a-token"),
			await resolveShareBody({}),
			await resolveShareBody({ token: 42 }),
			await resolveShareBody({ token: second.token, extra: true }),
			await resolveShareBodyRaw("{"),
		]) {
			const concealed = await errorResponse(Promise.resolve(malformed));
			expect(concealed.status).toBe(404);
			expect(malformed.headers.get("cache-control")).toBe("private, no-store");
			expect(normalizeError(concealed.body)).toEqual(
				normalizeError(unknown.body),
			);
		}
	});

	test("fails every revoked, expired, stale, removed or concealed share closed as unknown", async () => {
		const unknown = await errorResponse(
			resolveShareLink(`crs_${"B".repeat(43)}`),
		);
		expect(unknown.status).toBe(404);
		const concealedErrors: ErrorBody[] = [];

		const revokeRoot = "evt_recap_share_revoke01";
		await createPublishedRoot(revokeRoot);
		await addMember(revokeRoot, participant.id, "participant");
		await addMember(revokeRoot, viewer.id, "viewer");
		const revokePublished = await publishSimpleRecap(
			revokeRoot,
			"recap-share-revoke",
		);
		const revokeLink = (await (
			await createShareLink(
				owner.id,
				revokeRoot,
				"recap-share-revoke-create-01",
			)
		).json()) as RecapShareLinkBody;
		expect(revokeLink.shareLink.recapVersion).toBe(revokePublished.version);
		for (const [actor, expectedStatus] of [
			[participant, 403],
			[viewer, 403],
			[outsider, 404],
		] as const) {
			const unauthorizedCreate = await createShareLink(
				actor.id,
				revokeRoot,
				`recap-share-role-create-${actor.id}`,
			);
			expect(unauthorizedCreate.status).toBe(expectedStatus);
			const unauthorizedRevoke = await revokeShareLink(
				actor.id,
				revokeRoot,
				revokeLink.shareLink.id,
				`recap-share-role-revoke-${actor.id}`,
			);
			expect(unauthorizedRevoke.status).toBe(expectedStatus);
		}
		const revoked = await revokeShareLink(
			owner.id,
			revokeRoot,
			revokeLink.shareLink.id,
			"recap-share-revoke-command-01",
		);
		expect(revoked.status).toBe(200);
		expect(revoked.headers.get("cache-control")).toBe("private, no-store");
		expect(await revoked.json()).toEqual({ revoked: true });
		const revokedReplay = await revokeShareLink(
			owner.id,
			revokeRoot,
			revokeLink.shareLink.id,
			"recap-share-revoke-command-01",
		);
		expect(revokedReplay.status).toBe(200);
		expect(revokedReplay.headers.get("idempotency-replayed")).toBe("true");
		concealedErrors.push(
			(await errorResponse(resolveShareLink(revokeLink.token))).body,
		);

		const expiryLinkResponse = await createShareLink(
			owner.id,
			revokeRoot,
			"recap-share-expiry-create-01",
		);
		const expiryLink = (await expiryLinkResponse.json()) as RecapShareLinkBody;
		await sql`
			UPDATE event_recap_share_links
			SET created_at = statement_timestamp() - interval '8 days',
				expires_at = statement_timestamp() - interval '1 day'
			WHERE id = ${expiryLink.shareLink.id}
		`;
		concealedErrors.push(
			(await errorResponse(resolveShareLink(expiryLink.token))).body,
		);

		const versionRoot = "evt_recap_share_version01";
		await createPublishedRoot(versionRoot);
		const versionOne = await publishSimpleRecap(
			versionRoot,
			"recap-share-version-one",
		);
		const versionOneLink = (await (
			await createShareLink(
				owner.id,
				versionRoot,
				"recap-share-version-create-01",
			)
		).json()) as RecapShareLinkBody;
		expect(versionOneLink.shareLink.recapVersion).toBe(versionOne.version);
		const versionTwo = await publishSimpleRecap(
			versionRoot,
			"recap-share-version-two",
		);
		expect(versionTwo.version).toBe(2);
		const staleVersionCreate = await createShareLink(
			owner.id,
			versionRoot,
			"recap-share-version-stale-create-01",
			versionOne.version,
		);
		expect(staleVersionCreate.status).toBe(409);
		expect(
			((await staleVersionCreate.json()) as ErrorBody).error,
		).toMatchObject({
			code: "RECAP_SHARE_VERSION_CONFLICT",
			details: [
				{
					code: "CURRENT_RECAP_VERSION",
					meta: { currentRecapVersion: versionTwo.version },
				},
			],
		});
		expect(
			(
				await sql<{ count: number }[]>`
					SELECT count(*)::int AS count FROM event_recap_share_links
					WHERE root_event_id = ${versionRoot}
				`
			)[0]?.count,
		).toBe(1);
		concealedErrors.push(
			(await errorResponse(resolveShareLink(versionOneLink.token))).body,
		);
		const versionTwoLink = (await (
			await createShareLink(
				owner.id,
				versionRoot,
				"recap-share-version-create-02",
			)
		).json()) as RecapShareLinkBody;
		const removed = await removeRequest(
			owner.id,
			versionRoot,
			"recap-share-version-remove-01",
			versionTwo.lifecycleVersion,
		);
		expect(removed.status).toBe(200);
		concealedErrors.push(
			(await errorResponse(resolveShareLink(versionTwoLink.token))).body,
		);

		const sourceRoot = "evt_recap_share_source01";
		const sourceMarker = "SENSITIVE_RECAP_BODY_NEVER_PUBLIC_02";
		await createPublishedRoot(sourceRoot);
		await addMember(sourceRoot, organizer.id, "organizer");
		const sourceFeed = await service.createFeedEntry(organizer, sourceRoot, {
			id: "fed_recap_share_source01",
			eventId: sourceRoot,
			parentEntryId: null,
			kind: "message",
			body: sourceMarker,
		});
		const sourceDraftResponse = await generateRequest(
			organizer.id,
			sourceRoot,
			"recap-share-source-generate-01",
			await currentRootRevision(sourceRoot),
			[
				{
					type: "feedEntry",
					sourceId: sourceFeed.id,
					sourceVersion: sourceFeed.version,
					consentBasis: "source-author",
				},
			],
		);
		expect(sourceDraftResponse.status).toBe(201);
		const sourceDraft = ((await sourceDraftResponse.json()) as RecapBody).recap;
		expect(
			(
				await publishRequest(
					owner.id,
					sourceRoot,
					"recap-share-source-publish-01",
					sourceDraft.version,
					sourceDraft.lifecycleVersion,
				)
			).status,
		).toBe(200);
		const sourceLink = (await (
			await createShareLink(
				owner.id,
				sourceRoot,
				"recap-share-source-create-01",
			)
		).json()) as RecapShareLinkBody;
		const sourcePublic = await resolveShareLink(sourceLink.token);
		expect(sourcePublic.status).toBe(200);
		const sourcePublicText = await sourcePublic.text();
		expect(sourcePublicText).not.toContain(sourceMarker);
		expect(sourcePublicText).not.toContain(sourceFeed.id);
		expect(
			(JSON.parse(sourcePublicText) as PublicRecapBody).recap.items,
		).toEqual([]);
		await service.updateMembership(
			owner,
			sourceRoot,
			organizer.id,
			1,
			"organizer",
			"removed",
			"external recap source consent revoked",
		);
		concealedErrors.push(
			(await errorResponse(resolveShareLink(sourceLink.token))).body,
		);

		const tombstoneRoot = "evt_recap_share_tombstone01";
		const tombstoneMarker = "SENSITIVE_TOMBSTONED_SOURCE_NEVER_PUBLIC_01";
		await createPublishedRoot(tombstoneRoot);
		const tombstoneFeed = await service.createFeedEntry(owner, tombstoneRoot, {
			id: "fed_recap_share_tombstone01",
			eventId: tombstoneRoot,
			parentEntryId: null,
			kind: "message",
			body: tombstoneMarker,
		});
		const tombstoneDraftResponse = await generateRequest(
			owner.id,
			tombstoneRoot,
			"recap-share-tombstone-generate-01",
			await currentRootRevision(tombstoneRoot),
			[
				{
					type: "feedEntry",
					sourceId: tombstoneFeed.id,
					sourceVersion: tombstoneFeed.version,
					consentBasis: "source-author",
				},
			],
		);
		expect(tombstoneDraftResponse.status).toBe(201);
		const tombstoneDraft = ((await tombstoneDraftResponse.json()) as RecapBody)
			.recap;
		expect(
			(
				await publishRequest(
					owner.id,
					tombstoneRoot,
					"recap-share-tombstone-publish-01",
					tombstoneDraft.version,
					tombstoneDraft.lifecycleVersion,
				)
			).status,
		).toBe(200);
		const tombstoneLink = (await (
			await createShareLink(
				owner.id,
				tombstoneRoot,
				"recap-share-tombstone-create-01",
			)
		).json()) as RecapShareLinkBody;
		expect((await resolveShareLink(tombstoneLink.token)).status).toBe(200);
		await service.removeFeedEntry(
			owner,
			tombstoneRoot,
			tombstoneFeed.id,
			tombstoneFeed.version,
		);
		const tombstoned = await errorResponse(
			resolveShareLink(tombstoneLink.token),
		);
		expect(JSON.stringify(tombstoned.body)).not.toContain(tombstoneMarker);
		concealedErrors.push(tombstoned.body);

		const titleRoot = "evt_recap_share_title01";
		await createPublishedRoot(titleRoot);
		await publishSimpleRecap(titleRoot, "recap-share-title");
		const titleLink = (await (
			await createShareLink(owner.id, titleRoot, "recap-share-title-create-01")
		).json()) as RecapShareLinkBody;
		await service.updateEvent(owner, titleRoot, titleRoot, 1, {
			title: "Changed title invalidates the external recap",
		});
		concealedErrors.push(
			(await errorResponse(resolveShareLink(titleLink.token))).body,
		);

		const policyRoot = "evt_recap_share_policy01";
		await createPublishedRoot(policyRoot);
		await addMember(policyRoot, organizer.id, "organizer");
		await publishSimpleRecap(policyRoot, "recap-share-policy");
		const policyLink = (await (
			await createShareLink(
				organizer.id,
				policyRoot,
				"recap-share-policy-create-01",
			)
		).json()) as RecapShareLinkBody;
		await service.updateMembership(
			owner,
			policyRoot,
			organizer.id,
			1,
			"participant",
			"active",
			null,
		);
		concealedErrors.push(
			(await errorResponse(resolveShareLink(policyLink.token))).body,
		);

		const archivedRoot = "evt_recap_share_archive01";
		await createPublishedRoot(archivedRoot);
		await publishSimpleRecap(archivedRoot, "recap-share-archive");
		const archivedLink = (await (
			await createShareLink(
				owner.id,
				archivedRoot,
				"recap-share-archive-create-01",
			)
		).json()) as RecapShareLinkBody;
		await service.archiveEvent(owner, archivedRoot, archivedRoot, 1);
		concealedErrors.push(
			(await errorResponse(resolveShareLink(archivedLink.token))).body,
		);

		for (const concealed of concealedErrors) {
			expect(normalizeError(concealed)).toEqual(normalizeError(unknown.body));
			expect(JSON.stringify(concealed)).not.toContain(sourceMarker);
		}
	});

	test("reconstructs an exact replay across bounded HMAC rotation without storing plaintext", async () => {
		const baselineService = service;
		const baselineApp = app;
		const rootEventId = "evt_recap_share_keyrotate01";
		const idempotencyKey = "recap-share-keyrotate-create-01";
		const firstSecret = "recap-share-first-key-with-at-least-32-chars";
		const secondSecret = "recap-share-second-key-with-at-least-32-chars";
		try {
			await createPublishedRoot(rootEventId);
			await publishSimpleRecap(rootEventId, "recap-share-keyrotate");
			installService(
				new RecapShareTokenCodec({ id: "recap-k1", secret: firstSecret }),
			);

			const firstResponse = await createShareLink(
				owner.id,
				rootEventId,
				idempotencyKey,
			);
			expect(firstResponse.status).toBe(201);
			const firstText = await firstResponse.clone().text();
			const first = (await firstResponse.json()) as RecapShareLinkBody;
			const [stored] = await sql<
				{
					tokenKeyId: string;
					tokenHash: string;
					responseBody: string;
				}[]
			>`
				SELECT link.token_key_id AS "tokenKeyId",
					link.token_hash AS "tokenHash",
					command.response_body::text AS "responseBody"
				FROM event_recap_share_links link
				JOIN event_idempotency_records command
					ON command.actor_id = ${owner.id}
					AND command.operation_id = 'eventRecapShareLinksCreate'
					AND command.idempotency_key = ${idempotencyKey}
				WHERE link.id = ${first.shareLink.id}
			`;
			expect(stored).toEqual({
				tokenKeyId: "recap-k1",
				tokenHash: createHash("sha256").update(first.token).digest("hex"),
				responseBody: expect.not.stringContaining(first.token),
			});
			expect(stored?.responseBody).not.toContain("tokenKeyId");

			installService(
				new RecapShareTokenCodec(
					{ id: "recap-k2", secret: secondSecret },
					{
						id: "recap-k1",
						secret: firstSecret,
						notAfter: new Date(Date.now() + 60_000),
					},
				),
			);
			const rotatedReplay = await createShareLink(
				owner.id,
				rootEventId,
				idempotencyKey,
			);
			expect(rotatedReplay.status).toBe(201);
			expect(rotatedReplay.headers.get("idempotency-replayed")).toBe("true");
			expect(await rotatedReplay.text()).toBe(firstText);

			installService(
				new RecapShareTokenCodec({ id: "recap-k2", secret: secondSecret }),
			);
			const retiredReplay = await errorResponse(
				createShareLink(owner.id, rootEventId, idempotencyKey),
			);
			const unknownReplay = await errorResponse(
				createShareLink(
					owner.id,
					"evt_recap_share_keyunknown01",
					"recap-share-keyrotate-unknown-01",
					1,
				),
			);
			expect(retiredReplay.status).toBe(404);
			expect(retiredReplay.response.headers.get("idempotency-replayed")).toBe(
				null,
			);
			expect(normalizeError(retiredReplay.body)).toEqual(
				normalizeError(unknownReplay.body),
			);
			expect((await resolveShareLink(first.token)).status).toBe(200);

			await sql`
				UPDATE event_recap_share_links
				SET created_at = statement_timestamp() - interval '8 days',
					expires_at = statement_timestamp() - interval '1 day'
				WHERE id = ${first.shareLink.id}
			`;
			const expired = await errorResponse(resolveShareLink(first.token));
			const unknown = await errorResponse(
				resolveShareLink(`crs_${"Z".repeat(43)}`),
			);
			expect(expired.status).toBe(404);
			expect(normalizeError(expired.body)).toEqual(
				normalizeError(unknown.body),
			);
		} finally {
			service = baselineService;
			app = baselineApp;
		}
	});

	test("publishes only an exact event body grant and fails closed after manager withdrawal or removal", async () => {
		const rootEventId = "evt_recap_external_event01";
		await createPublishedRoot(rootEventId);
		await addMember(rootEventId, organizer.id, "organizer");
		await addMember(rootEventId, participant.id, "participant");
		const recap = await publishSimpleRecap(rootEventId, "recap-external-event");
		const field = {
			sourceType: "event",
			sourceId: rootEventId,
			sourceVersion: 1,
			field: "body",
		} as const;

		expect(
			(
				await decideExternalGrant(
					participant.id,
					rootEventId,
					"recap-external-event-participant",
					{
						recapVersion: recap.version,
						...field,
						authority: "manager",
						decision: "grant",
					},
				)
			).status,
		).toBe(404);
		const grantKey = "recap-external-event-manager-grant";
		const granted = await decideExternalGrant(
			organizer.id,
			rootEventId,
			grantKey,
			{
				recapVersion: recap.version,
				...field,
				authority: "manager",
				decision: "grant",
			},
		);
		expect(granted.status).toBe(200);
		expect(await granted.json()).toEqual({ decision: "grant" });

		const createKey = "recap-external-event-link-create";
		const createdResponse = await createExternalShareLink(
			owner.id,
			rootEventId,
			createKey,
			{ recapVersion: recap.version, fields: [field] },
		);
		expect(createdResponse.status).toBe(201);
		const createdText = await createdResponse.clone().text();
		const created = (await createdResponse.json()) as RecapShareLinkBody;
		const publicResponse = await resolveExternalShareLink(created.token);
		expect(publicResponse.status).toBe(200);
		expect(publicResponse.headers.get("cache-control")).toBe(
			"private, no-store",
		);
		const publicText = await publicResponse.clone().text();
		expect((await publicResponse.json()) as PublicExternalRecapBody).toEqual({
			recap: {
				title: "Private source-safe event title",
				items: [
					{
						ordinal: 0,
						title: "Private source-safe event title",
						body: "Published event description",
					},
				],
			},
		});
		for (const forbidden of [
			rootEventId,
			organizer.id,
			created.shareLink.id,
			created.token,
			"sourceType",
			"sourceVersion",
			"provenance",
			"membership",
			"media",
		])
			expect(publicText).not.toContain(forbidden);
		expect((await resolveShareLink(created.token)).status).toBe(404);

		const replay = await createExternalShareLink(
			owner.id,
			rootEventId,
			createKey,
			{ recapVersion: recap.version, fields: [field] },
		);
		expect(replay.headers.get("idempotency-replayed")).toBe("true");
		expect(await replay.text()).toBe(createdText);

		const unknown = await errorResponse(
			resolveExternalShareLink(`crs_${"Z".repeat(43)}`),
		);
		const malformed = await errorResponse(
			resolveExternalShareBody({ token: 7 }),
		);
		expect(malformed.status).toBe(404);
		expect(normalizeError(malformed.body)).toEqual(
			normalizeError(unknown.body),
		);

		const removed = await service.updateMembership(
			owner,
			rootEventId,
			organizer.id,
			1,
			"organizer",
			"removed",
			"external body authority withdrawn",
		);
		expect((await resolveExternalShareLink(created.token)).status).toBe(404);
		expect(
			(
				await createExternalShareLink(owner.id, rootEventId, createKey, {
					recapVersion: recap.version,
					fields: [field],
				})
			).status,
		).toBe(404);
		await service.updateMembership(
			owner,
			rootEventId,
			organizer.id,
			removed.version,
			"organizer",
			"active",
			null,
		);
		expect((await resolveExternalShareLink(created.token)).status).toBe(404);

		expect(
			(
				await decideExternalGrant(
					organizer.id,
					rootEventId,
					"recap-external-event-manager-regrant",
					{
						recapVersion: recap.version,
						...field,
						authority: "manager",
						decision: "grant",
					},
				)
			).status,
		).toBe(200);
		const replacementResponse = await createExternalShareLink(
			owner.id,
			rootEventId,
			"recap-external-event-link-replace",
			{ recapVersion: recap.version, fields: [field] },
		);
		expect(replacementResponse.status).toBe(201);
		const replacement =
			(await replacementResponse.json()) as RecapShareLinkBody;
		expect((await resolveExternalShareLink(created.token)).status).toBe(404);
		expect((await resolveExternalShareLink(replacement.token)).status).toBe(
			200,
		);

		expect(
			(
				await decideExternalGrant(
					organizer.id,
					rootEventId,
					"recap-external-event-manager-withdraw",
					{
						recapVersion: recap.version,
						...field,
						authority: "manager",
						decision: "withdraw",
					},
				)
			).status,
		).toBe(200);
		expect((await resolveExternalShareLink(replacement.token)).status).toBe(
			404,
		);
		expect(
			(
				await decideExternalGrant(organizer.id, rootEventId, grantKey, {
					recapVersion: recap.version,
					...field,
					authority: "manager",
					decision: "grant",
				})
			).status,
		).toBe(404);
		expect(
			(
				await revokeShareLink(
					owner.id,
					rootEventId,
					replacement.shareLink.id,
					"recap-external-event-revoke",
				)
			).status,
		).toBe(200);

		const audit = await sql<{ action: string }[]>`
			SELECT action FROM event_recap_external_share_audit_events
			WHERE root_event_id = ${rootEventId} ORDER BY id
		`;
		expect(audit.map((row) => row.action)).toEqual([
			"create",
			"rotate",
			"create",
			"revoke",
		]);
		const metadataColumns = await sql<{ columnName: string }[]>`
			SELECT column_name AS "columnName" FROM information_schema.columns
			WHERE table_name IN (
				'event_recap_external_grant_decisions',
				'event_recap_external_share_fields'
			)
		`;
		for (const forbiddenColumn of [
			"source_body",
			"source_title",
			"token",
			"token_hash",
			"ip_address",
			"user_agent",
		])
			expect(metadataColumns.map((row) => row.columnName)).not.toContain(
				forbiddenColumn,
			);
		const immutableTriggers = await sql<{ tableName: string }[]>`
			SELECT event_object_table AS "tableName"
			FROM information_schema.triggers
			WHERE trigger_name IN (
				'event_recap_external_grant_decisions_immutable',
				'event_recap_external_share_fields_immutable',
				'event_recap_external_share_audit_events_immutable'
			)
		`;
		expect(
			[...new Set(immutableTriggers.map((row) => row.tableName))].sort(),
		).toEqual([
			"event_recap_external_grant_decisions",
			"event_recap_external_share_audit_events",
			"event_recap_external_share_fields",
		]);
	});

	test("requires distinct feed author and manager grants and invalidates the whole projection on source or consent drift", async () => {
		const rootEventId = "evt_recap_external_feed01";
		const feedMarker = "APPROVED_FEED_BODY_EXTERNAL_01";
		await createPublishedRoot(rootEventId);
		await addMember(rootEventId, organizer.id, "organizer");
		const feed = await service.createFeedEntry(organizer, rootEventId, {
			id: "fed_recap_external_feed01",
			eventId: rootEventId,
			parentEntryId: null,
			kind: "message",
			body: feedMarker,
		});
		const draftResponse = await generateRequest(
			organizer.id,
			rootEventId,
			"recap-external-feed-generate",
			await currentRootRevision(rootEventId),
			[
				{
					type: "event",
					sourceId: rootEventId,
					sourceVersion: 1,
					consentBasis: "event-publication",
				},
				{
					type: "feedEntry",
					sourceId: feed.id,
					sourceVersion: feed.version,
					consentBasis: "source-author",
				},
			],
		);
		expect(draftResponse.status).toBe(201);
		const draft = ((await draftResponse.json()) as RecapBody).recap;
		expect(
			(
				await publishRequest(
					owner.id,
					rootEventId,
					"recap-external-feed-publish",
					draft.version,
					draft.lifecycleVersion,
				)
			).status,
		).toBe(200);
		const field = {
			sourceType: "feedEntry",
			sourceId: feed.id,
			sourceVersion: feed.version,
			field: "body",
		} as const;

		expect(
			(
				await decideExternalGrant(owner.id, rootEventId, "feed-manager", {
					recapVersion: draft.version,
					...field,
					authority: "manager",
					decision: "grant",
				})
			).status,
		).toBe(200);
		const missingAuthor = await createExternalShareLink(
			owner.id,
			rootEventId,
			"feed-link-missing-author",
			{ recapVersion: draft.version, fields: [field] },
		);
		expect(missingAuthor.status).toBe(404);
		const missingAuthorBody = (await missingAuthor.json()) as ErrorBody;
		const missingAuthorReplay = await createExternalShareLink(
			owner.id,
			rootEventId,
			"feed-link-missing-author",
			{ recapVersion: draft.version, fields: [field] },
		);
		expect(missingAuthorReplay.status).toBe(404);
		expect(missingAuthorReplay.headers.get("idempotency-replayed")).toBe(
			"true",
		);
		expect(
			normalizeError((await missingAuthorReplay.json()) as ErrorBody),
		).toEqual(normalizeError(missingAuthorBody));
		expect(
			(
				await decideExternalGrant(organizer.id, rootEventId, "feed-author", {
					recapVersion: draft.version,
					...field,
					authority: "author",
					decision: "grant",
				})
			).status,
		).toBe(200);
		const createdResponse = await createExternalShareLink(
			owner.id,
			rootEventId,
			"feed-link-complete",
			{ recapVersion: draft.version, fields: [field] },
		);
		expect(createdResponse.status).toBe(201);
		const created = (await createdResponse.json()) as RecapShareLinkBody;
		const projectedResponse = await resolveExternalShareLink(created.token);
		expect(projectedResponse.status).toBe(200);
		const projectedText = await projectedResponse.clone().text();
		expect((await projectedResponse.json()) as PublicExternalRecapBody).toEqual(
			{
				recap: {
					title: "Private source-safe event title",
					items: [
						{
							ordinal: 0,
							title: "Private source-safe event title",
							body: null,
						},
						{ ordinal: 1, title: null, body: feedMarker },
					],
				},
			},
		);
		expect(projectedText).not.toContain(feed.id);
		expect(projectedText).not.toContain(organizer.id);

		expect(
			(
				await decideExternalGrant(
					organizer.id,
					rootEventId,
					"feed-author-withdraw",
					{
						recapVersion: draft.version,
						...field,
						authority: "author",
						decision: "withdraw",
					},
				)
			).status,
		).toBe(200);
		const withdrawn = await errorResponse(
			resolveExternalShareLink(created.token),
		);
		const unknown = await errorResponse(
			resolveExternalShareLink(`crs_${"Y".repeat(43)}`),
		);
		expect(normalizeError(withdrawn.body)).toEqual(
			normalizeError(unknown.body),
		);

		expect(
			(
				await decideExternalGrant(
					organizer.id,
					rootEventId,
					"feed-author-regrant",
					{
						recapVersion: draft.version,
						...field,
						authority: "author",
						decision: "grant",
					},
				)
			).status,
		).toBe(200);
		const sourceDriftResponse = await createExternalShareLink(
			owner.id,
			rootEventId,
			"feed-link-source-drift",
			{ recapVersion: draft.version, fields: [field] },
		);
		expect(sourceDriftResponse.status).toBe(201);
		const sourceDriftLink =
			(await sourceDriftResponse.json()) as RecapShareLinkBody;
		await service.reviseFeedEntry(
			organizer,
			rootEventId,
			feed.id,
			feed.version,
			"A new source version is never inherited by the old grant",
		);
		const drifted = await errorResponse(
			resolveExternalShareLink(sourceDriftLink.token),
		);
		expect(normalizeError(drifted.body)).toEqual(normalizeError(unknown.body));
		expect(JSON.stringify(drifted.body)).not.toContain(feedMarker);
	});

	test("reads current exact-body consent without identities and fails closed on membership, recap or source drift", async () => {
		const rootEventId = "evt_recap_external_read01";
		const feedMarker = "EXACT_READ_MODEL_FEED_BODY_01";
		await createPublishedRoot(rootEventId);
		await addMember(rootEventId, organizer.id, "organizer");
		await addMember(rootEventId, participant.id, "participant");
		await addMember(rootEventId, viewer.id, "viewer");
		const feed = await service.createFeedEntry(organizer, rootEventId, {
			id: "fed_recap_external_read01",
			eventId: rootEventId,
			parentEntryId: null,
			kind: "message",
			body: feedMarker,
		});
		const generated = await generateRequest(
			organizer.id,
			rootEventId,
			"recap-external-read-generate",
			await currentRootRevision(rootEventId),
			[
				{
					type: "event",
					sourceId: rootEventId,
					sourceVersion: 1,
					consentBasis: "event-publication",
				},
				{
					type: "feedEntry",
					sourceId: feed.id,
					sourceVersion: feed.version,
					consentBasis: "source-author",
				},
			],
		);
		expect(generated.status).toBe(201);
		const draft = ((await generated.json()) as RecapBody).recap;
		expect(
			(
				await publishRequest(
					owner.id,
					rootEventId,
					"recap-external-read-publish",
					draft.version,
					draft.lifecycleVersion,
				)
			).status,
		).toBe(200);

		const ownerRead = await getRecap(owner.id, rootEventId);
		expect(ownerRead.status).toBe(200);
		const ownerBody = (await ownerRead.json()) as RecapReadBody;
		expect(ownerBody.externalConsent).toEqual({
			fields: [
				{
					ordinal: 0,
					field: "body",
					requiredAuthorities: ["manager"],
					authorDecision: "unknown",
					managerDecision: "unknown",
					actorCanDecide: ["manager"],
				},
				{
					ordinal: 1,
					field: "body",
					requiredAuthorities: ["author", "manager"],
					authorDecision: "unknown",
					managerDecision: "unknown",
					actorCanDecide: ["manager"],
				},
			],
		});
		const consentText = JSON.stringify(ownerBody.externalConsent);
		for (const forbidden of [
			feedMarker,
			feed.id,
			rootEventId,
			owner.id,
			organizer.id,
			"sourceId",
			"sourceVersion",
			"actorId",
			"userId",
			"token",
			"url",
			"provenance",
			"decidedAt",
		])
			expect(consentText).not.toContain(forbidden);

		const authorBody = (await (
			await getRecap(organizer.id, rootEventId)
		).json()) as RecapReadBody;
		expect(
			authorBody.externalConsent?.fields.map((field) => field.actorCanDecide),
		).toEqual([["manager"], ["author", "manager"]]);
		for (const actorId of [participant.id, viewer.id]) {
			const response = await getRecap(actorId, rootEventId);
			expect(response.status).toBe(200);
			const body = (await response.json()) as RecapReadBody;
			expect(
				body.externalConsent?.fields.map((field) => field.actorCanDecide),
			).toEqual([[], []]);
		}
		const outsiderExisting = await errorResponse(
			getRecap(outsider.id, rootEventId),
		);
		const outsiderUnknown = await errorResponse(
			getRecap(outsider.id, "evt_recap_external_read_unknown01"),
		);
		expect(outsiderExisting.status).toBe(404);
		expect(normalizeError(outsiderExisting.body)).toEqual(
			normalizeError(outsiderUnknown.body),
		);

		const eventField = {
			sourceType: "event",
			sourceId: rootEventId,
			sourceVersion: 1,
			field: "body",
		} as const;
		const feedField = {
			sourceType: "feedEntry",
			sourceId: feed.id,
			sourceVersion: feed.version,
			field: "body",
		} as const;
		for (const [key, field, authority, actorId] of [
			["read-event-manager-grant", eventField, "manager", owner.id],
			["read-feed-manager-grant", feedField, "manager", owner.id],
			["read-feed-author-grant", feedField, "author", organizer.id],
		] as const) {
			expect(
				(
					await decideExternalGrant(actorId, rootEventId, key, {
						recapVersion: draft.version,
						...field,
						authority,
						decision: "grant",
					})
				).status,
			).toBe(200);
		}
		const granted = (await (
			await getRecap(participant.id, rootEventId)
		).json()) as RecapReadBody;
		expect(
			granted.externalConsent?.fields.map((field) => [
				field.authorDecision,
				field.managerDecision,
			]),
		).toEqual([
			["unknown", "grant"],
			["grant", "grant"],
		]);
		expect(
			(
				await decideExternalGrant(
					organizer.id,
					rootEventId,
					"read-feed-author-withdraw",
					{
						recapVersion: draft.version,
						...feedField,
						authority: "author",
						decision: "withdraw",
					},
				)
			).status,
		).toBe(200);
		const withdrawn = (await (
			await getRecap(viewer.id, rootEventId)
		).json()) as RecapReadBody;
		expect(withdrawn.externalConsent?.fields[1]).toMatchObject({
			authorDecision: "withdraw",
			managerDecision: "grant",
		});

		await service.updateMembership(
			owner,
			rootEventId,
			participant.id,
			1,
			"participant",
			"removed",
			"read model membership revoked",
		);
		expect((await getRecap(participant.id, rootEventId)).status).toBe(404);

		const replacement = await publishSimpleRecap(
			rootEventId,
			"recap-external-read-replacement",
		);
		expect(replacement.version).toBe(2);
		const staleVersion = (await (
			await getRecap(owner.id, rootEventId, String(draft.version))
		).json()) as RecapReadBody;
		expect(staleVersion.recap.version).toBe(draft.version);
		expect(staleVersion.externalConsent).toBeNull();

		await service.updateEvent(owner, rootEventId, rootEventId, 1, {
			description: "Current source revision changed after recap publication",
		});
		expect((await getRecap(owner.id, rootEventId)).status).toBe(404);
	});

	test("conceals exact-field links after creator, event-source, recap or expiry drift", async () => {
		const unknown = await errorResponse(
			resolveExternalShareLink(`crs_${"X".repeat(43)}`),
		);
		const malformed = await errorResponse(
			resolveExternalShareBody({ token: 1 }),
		);
		expect(malformed.status).toBe(404);
		expect(normalizeError(malformed.body)).toEqual(
			normalizeError(unknown.body),
		);
		const concealed: ErrorBody[] = [];

		const creatorRoot = "evt_recap_external_creator01";
		await createPublishedRoot(creatorRoot);
		await addMember(creatorRoot, organizer.id, "organizer");
		const creatorLink = await createApprovedEventExternalLink(
			creatorRoot,
			"external-creator",
			creatorRoot,
			1,
			organizer.id,
		);
		await service.updateMembership(
			owner,
			creatorRoot,
			organizer.id,
			1,
			"participant",
			"active",
			null,
		);
		concealed.push(
			(await errorResponse(resolveExternalShareLink(creatorLink.token))).body,
		);

		const versionRoot = "evt_recap_external_version01";
		await createPublishedRoot(versionRoot);
		const versionChild = await service.createEvent(
			owner,
			versionRoot,
			versionRoot,
			{
				id: "evt_recap_external_version_child01",
				kind: "activity",
				title: "Reviewed versioned event title",
				description: "REVIEWED_EVENT_VERSION_BODY_01",
				timeZone: "Europe/Zurich",
				startsAt: null,
				endsAt: null,
				status: "published",
			},
		);
		const versionLink = await createApprovedEventExternalLink(
			versionRoot,
			"external-version",
			versionChild.id,
			versionChild.version,
		);
		await service.updateEvent(owner, versionRoot, versionChild.id, 1, {
			description: "A later event version cannot inherit the exact body grant",
		});
		concealed.push(
			(await errorResponse(resolveExternalShareLink(versionLink.token))).body,
		);

		const tombstoneRoot = "evt_recap_external_tombstone01";
		await createPublishedRoot(tombstoneRoot);
		const tombstoneChild = await service.createEvent(
			owner,
			tombstoneRoot,
			tombstoneRoot,
			{
				id: "evt_recap_external_tombstone_child01",
				kind: "activity",
				title: "Reviewed removable event title",
				description: "REVIEWED_EVENT_TOMBSTONE_BODY_01",
				timeZone: "Europe/Zurich",
				startsAt: null,
				endsAt: null,
				status: "published",
			},
		);
		const tombstoneLink = await createApprovedEventExternalLink(
			tombstoneRoot,
			"external-tombstone",
			tombstoneChild.id,
			tombstoneChild.version,
		);
		await service.tombstoneEvent(
			owner,
			tombstoneRoot,
			tombstoneChild.id,
			tombstoneChild.version,
			false,
		);
		concealed.push(
			(await errorResponse(resolveExternalShareLink(tombstoneLink.token))).body,
		);

		const replacementRoot = "evt_recap_external_replace01";
		await createPublishedRoot(replacementRoot);
		const replacementLink = await createApprovedEventExternalLink(
			replacementRoot,
			"external-replace-v1",
			replacementRoot,
			1,
		);
		const replacementRecap = await publishSimpleRecap(
			replacementRoot,
			"external-replace-v2",
		);
		expect(replacementRecap.version).toBe(2);
		concealed.push(
			(await errorResponse(resolveExternalShareLink(replacementLink.token)))
				.body,
		);

		const removalRoot = "evt_recap_external_remove01";
		await createPublishedRoot(removalRoot);
		const removalLink = await createApprovedEventExternalLink(
			removalRoot,
			"external-remove",
			removalRoot,
			1,
		);
		expect(
			(
				await removeRequest(
					owner.id,
					removalRoot,
					"external-remove-recap",
					removalLink.recap.lifecycleVersion,
				)
			).status,
		).toBe(200);
		concealed.push(
			(await errorResponse(resolveExternalShareLink(removalLink.token))).body,
		);

		const expiryRoot = "evt_recap_external_expiry01";
		await createPublishedRoot(expiryRoot);
		const expiryLink = await createApprovedEventExternalLink(
			expiryRoot,
			"external-expiry",
			expiryRoot,
			1,
		);
		await sql`
			UPDATE event_recap_share_links
			SET created_at = statement_timestamp() - interval '8 days',
				expires_at = statement_timestamp() - interval '1 day'
			WHERE id = ${expiryLink.shareLink.id}
		`;
		concealed.push(
			(await errorResponse(resolveExternalShareLink(expiryLink.token))).body,
		);

		for (const body of concealed) {
			expect(normalizeError(body)).toEqual(normalizeError(unknown.body));
			const serialized = JSON.stringify(body);
			for (const forbidden of [
				"REVIEWED_EVENT_VERSION_BODY_01",
				"REVIEWED_EVENT_TOMBSTONE_BODY_01",
				"sourceId",
				"rootEventId",
				"recapVersion",
			])
				expect(serialized).not.toContain(forbidden);
		}
	});
});

function auth(user: string) {
	return { Authorization: `Bearer ${user}` };
}

function installService(recapShareTokens?: RecapShareTokenCodec) {
	service = new EventService(
		new PostgresEventRepository(sql, notificationPayloads()),
		invitationKey,
		undefined,
		undefined,
		recapShareTokens,
	);
	installPublishedRootFixtures(service, sql);
	app = createApp({
		service,
		verifyUserToken: async (token) => ({ id: token }),
	});
}

function commandAuth(user: string, key: string) {
	return {
		...auth(user),
		"Content-Type": "application/json",
		"Idempotency-Key": key,
	};
}

function getRecap(actorId: string, rootEventId: string, version?: string) {
	const query = version ? `?version=${version}` : "";
	return app.request(`/v1/event-roots/${rootEventId}/recap${query}`, {
		headers: auth(actorId),
	});
}

function generateRequest(
	actorId: string,
	rootEventId: string,
	idempotencyKey: string,
	baseRevision: string,
	sources: unknown[],
) {
	return app.request(`/v1/event-roots/${rootEventId}/recap/generate`, {
		method: "POST",
		headers: commandAuth(actorId, idempotencyKey),
		body: JSON.stringify({ baseRevision, sources }),
	});
}

async function generatedRecap(
	actorId: string,
	rootEventId: string,
	idempotencyKey: string,
	baseRevision: string,
) {
	const response = await generateRequest(
		actorId,
		rootEventId,
		idempotencyKey,
		baseRevision,
		[
			{
				type: "event",
				sourceId: rootEventId,
				sourceVersion: 1,
				consentBasis: "event-publication",
			},
		],
	);
	expect(response.status).toBe(201);
	return ((await response.json()) as RecapBody).recap;
}

function publishRequest(
	actorId: string,
	rootEventId: string,
	idempotencyKey: string,
	recapVersion: number,
	baseLifecycleVersion: number,
) {
	return app.request(`/v1/event-roots/${rootEventId}/recap/publish`, {
		method: "POST",
		headers: commandAuth(actorId, idempotencyKey),
		body: JSON.stringify({ recapVersion, baseLifecycleVersion }),
	});
}

function removeRequest(
	actorId: string,
	rootEventId: string,
	idempotencyKey: string,
	baseLifecycleVersion: number,
) {
	return app.request(`/v1/event-roots/${rootEventId}/recap`, {
		method: "DELETE",
		headers: commandAuth(actorId, idempotencyKey),
		body: JSON.stringify({ baseLifecycleVersion }),
	});
}

async function createShareLink(
	actorId: string,
	rootEventId: string,
	idempotencyKey: string,
	recapVersion?: number,
) {
	const version =
		recapVersion ??
		(
			await sql<{ publishedVersion: number | null }[]>`
				SELECT published_version AS "publishedVersion"
				FROM event_recap_heads WHERE root_event_id = ${rootEventId}
			`
		)[0]?.publishedVersion;
	if (version === null || version === undefined)
		throw new Error("Expected a current published recap in test setup");
	return createShareLinkBody(actorId, rootEventId, idempotencyKey, {
		recapVersion: version,
		projectionConsent: "title-only-reviewed",
	});
}

function createShareLinkBody(
	actorId: string,
	rootEventId: string,
	idempotencyKey: string,
	body: unknown,
) {
	return app.request(`/v1/event-roots/${rootEventId}/recap/share-links`, {
		method: "POST",
		headers: commandAuth(actorId, idempotencyKey),
		body: JSON.stringify(body),
	});
}

function revokeShareLink(
	actorId: string,
	rootEventId: string,
	shareLinkId: string,
	idempotencyKey: string,
) {
	return app.request(
		`/v1/event-roots/${rootEventId}/recap/share-links/${shareLinkId}`,
		{
			method: "DELETE",
			headers: commandAuth(actorId, idempotencyKey),
		},
	);
}

function resolveShareLink(token: string) {
	return resolveShareBody({ token });
}

function resolveShareBody(body: unknown) {
	return resolveShareBodyRaw(JSON.stringify(body));
}

function resolveShareBodyRaw(body: string) {
	return app.request("/v1/recap-share-links/resolve", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
	});
}

function decideExternalGrant(
	actorId: string,
	rootEventId: string,
	idempotencyKey: string,
	body: unknown,
) {
	return app.request(`/v1/event-roots/${rootEventId}/recap/external-grants`, {
		method: "POST",
		headers: commandAuth(actorId, idempotencyKey),
		body: JSON.stringify(body),
	});
}

function createExternalShareLink(
	actorId: string,
	rootEventId: string,
	idempotencyKey: string,
	input: { recapVersion: number; fields: unknown[] },
) {
	return app.request(
		`/v1/event-roots/${rootEventId}/recap/external-share-links`,
		{
			method: "POST",
			headers: commandAuth(actorId, idempotencyKey),
			body: JSON.stringify({
				...input,
				projectionConsent: "exact-fields-reviewed-v1",
			}),
		},
	);
}

function resolveExternalShareLink(token: string) {
	return resolveExternalShareBody({ token });
}

function resolveExternalShareBody(body: unknown) {
	return app.request("/v1/recap-external-share-links/resolve", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

async function createApprovedEventExternalLink(
	rootEventId: string,
	keyPrefix: string,
	sourceId: string,
	sourceVersion: number,
	creatorId = owner.id,
) {
	const draftResponse = await generateRequest(
		owner.id,
		rootEventId,
		`${keyPrefix}-generate`,
		await currentRootRevision(rootEventId),
		[
			{
				type: "event",
				sourceId,
				sourceVersion,
				consentBasis: "event-publication",
			},
		],
	);
	expect(draftResponse.status).toBe(201);
	const draft = ((await draftResponse.json()) as RecapBody).recap;
	const publishResponse = await publishRequest(
		owner.id,
		rootEventId,
		`${keyPrefix}-publish`,
		draft.version,
		draft.lifecycleVersion,
	);
	expect(publishResponse.status).toBe(200);
	const recap = ((await publishResponse.json()) as RecapBody).recap;
	const field = {
		sourceType: "event" as const,
		sourceId,
		sourceVersion,
		field: "body" as const,
	};
	const grant = await decideExternalGrant(
		owner.id,
		rootEventId,
		`${keyPrefix}-grant`,
		{
			recapVersion: recap.version,
			...field,
			authority: "manager",
			decision: "grant",
		},
	);
	expect(grant.status).toBe(200);
	const createResponse = await createExternalShareLink(
		creatorId,
		rootEventId,
		`${keyPrefix}-link`,
		{ recapVersion: recap.version, fields: [field] },
	);
	expect(createResponse.status).toBe(201);
	return {
		...((await createResponse.json()) as RecapShareLinkBody),
		recap,
	};
}

async function publishSimpleRecap(rootEventId: string, keyPrefix: string) {
	const draft = await generatedRecap(
		owner.id,
		rootEventId,
		`${keyPrefix}-generate`,
		await currentRootRevision(rootEventId),
	);
	const response = await publishRequest(
		owner.id,
		rootEventId,
		`${keyPrefix}-publish`,
		draft.version,
		draft.lifecycleVersion,
	);
	expect(response.status).toBe(200);
	return ((await response.json()) as RecapBody).recap;
}

async function errorResponse(responsePromise: Response | Promise<Response>) {
	const response = await responsePromise;
	return {
		status: response.status,
		response,
		body: (await response.json()) as ErrorBody,
	};
}

function normalizeError(body: ErrorBody) {
	const { requestId: _requestId, ...error } = body.error;
	return error;
}

async function createPublishedRoot(rootEventId: string) {
	await service.createRoot(owner, publishedRoot(rootEventId));
}

function publishedRoot(id: string): EventInput {
	return {
		id,
		kind: "team_event",
		title: "Private source-safe event title",
		description: "Published event description",
		timeZone: "Europe/Zurich",
		startsAt: new Date("2026-07-01T08:00:00.000Z"),
		endsAt: new Date("2026-07-01T18:00:00.000Z"),
		status: "published",
	};
}

async function currentRootRevision(rootEventId: string) {
	const [root] = await sql<{ revision: string }[]>`
		SELECT revision::text AS revision FROM event_roots
		WHERE root_event_id = ${rootEventId}
	`;
	if (!root) throw new Error("Missing test root");
	return root.revision;
}

async function addMember(
	rootEventId: string,
	actorId: string,
	role: "organizer" | "participant" | "viewer",
) {
	await sql`
		INSERT INTO event_memberships (root_event_id, user_id, role, status)
		VALUES (${rootEventId}, ${actorId}, ${role}, 'active')
	`;
}
