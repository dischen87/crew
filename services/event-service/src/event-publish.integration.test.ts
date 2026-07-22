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
import {
	type EventInput,
	type EventPublishReadiness,
	eventPublishReadinessReasonCodes,
} from "./domain";
import { EventNotificationPayloadCodec } from "./event-notification-payload";
import { resolveEventTemplate } from "./event-templates";
import { PostgresEventRepository } from "./postgres-repository";
import { EventService } from "./service";
import type { SyncPushResponse } from "./sync";

const databaseUrl =
	Bun.env.EVENT_TEST_DATABASE_URL ?? "postgres://localhost/crew_event_test";
const userId = (value: number) => `usr_${value.toString(16).padStart(32, "0")}`;
const owner = { id: userId(401), email: "owner.private@example.test" };
const organizer = { id: userId(402) };
const participant = { id: userId(403) };
const outsider = { id: userId(404) };
const notificationPayloads = () =>
	new EventNotificationPayloadCodec({
		kid: "event-publish-test-v1",
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

let sql: Sql;
let repository: PostgresEventRepository;
let service: EventService;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
	sql = postgres(databaseUrl, { max: 12, onnotice: () => {} });
	await migrate(sql);
	repository = new PostgresEventRepository(sql, notificationPayloads());
	service = new EventService(
		repository,
		"event-publish-test-invitation-key-with-at-least-32-characters",
	);
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

describe("authoritative event publication against PostgreSQL 17", () => {
	test("allows only draft root creation at HTTP, service and repository boundaries", async () => {
		const published = {
			...genericDraft("evt_publish_create_http"),
			status: "published" as const,
		};
		const route = await app.request("/v1/event-roots", {
			method: "POST",
			headers: commandAuth(owner.id, "publish-create-http-01"),
			body: JSON.stringify(published),
		});
		expect(route.status).toBe(400);
		expect(((await route.json()) as ErrorBody).error.code).toBe(
			"VALIDATION_FAILED",
		);

		expect(() =>
			service.createRoot(owner, {
				...published,
				id: "evt_publish_create_service",
			}),
		).toThrow("A new root must start draft.");
		await expect(
			repository.createRoot(owner, {
				...published,
				id: "evt_publish_create_repository",
			}),
		).rejects.toMatchObject({ status: 400, code: "INVALID_ROOT_STATUS" });
		const publishedTemplate = {
			...published,
			id: "evt_publish_create_template",
		};
		await expect(
			repository.createRootFromTemplate(
				owner,
				publishedTemplate,
				resolveEventTemplate(
					{
						id: "team-event",
						version: 1,
						eventIds: {
							root: publishedTemplate.id,
							agenda: `${publishedTemplate.id}_agenda`,
							activity: `${publishedTemplate.id}_activity`,
						},
					},
					publishedTemplate,
				),
			),
		).rejects.toMatchObject({ status: 400, code: "INVALID_ROOT_STATUS" });

		const [proof] = await sql<{ count: number }[]>`
			SELECT count(*)::int AS count FROM event_roots
		`;
		expect(proof?.count).toBe(0);

		const draft = await app.request("/v1/event-roots", {
			method: "POST",
			headers: commandAuth(owner.id, "publish-create-draft-01"),
			body: JSON.stringify({
				...genericDraft("evt_publish_create_draft"),
				status: undefined,
			}),
		});
		expect(draft.status).toBe(201);
		expect((await draft.json()).event).toMatchObject({ status: "draft" });
	});

	test("returns finite actionable reasons and applies identical tenant concealment to read and publish", async () => {
		const rootEventId = "evt_publish_incomplete01";
		await service.createRoot(owner, genericDraft(rootEventId));
		await addMember(rootEventId, organizer.id, "organizer");
		await addMember(rootEventId, participant.id, "participant");

		const readinessResponse = await app.request(
			`/v1/event-roots/${rootEventId}/publish-readiness`,
			{ headers: auth(owner.id) },
		);
		expect(readinessResponse.status).toBe(200);
		const readiness = (await readinessResponse.json()) as EventPublishReadiness;
		expect(readiness).toMatchObject({
			schemaVersion: 1,
			rootEventId,
			rootStatus: "draft",
			rootVersion: 1,
			rootRevision: "1",
			template: null,
			ready: false,
		});
		expect(readiness.reasons.map(({ code }) => code)).toEqual([
			"EVENT_TEMPLATE_REQUIRED",
			"EVENT_DESCRIPTION_REQUIRED",
			"EVENT_START_REQUIRED",
			"EVENT_END_REQUIRED",
			"EVENT_CAPABILITY_REQUIRED",
		]);
		expect(
			readiness.reasons.find(
				({ code }) => code === "EVENT_CAPABILITY_REQUIRED",
			),
		).not.toHaveProperty("meta");
		expect(
			readiness.reasons.every(({ code }) =>
				eventPublishReadinessReasonCodes.includes(code),
			),
		).toBe(true);
		const serializedReadiness = JSON.stringify(readiness);
		expect(serializedReadiness).not.toContain("PRIVATE launch title");
		expect(serializedReadiness).not.toContain("owner.private@example.test");

		const notReady = await publishRequest(
			owner.id,
			rootEventId,
			"publish-not-ready-01",
			readiness,
		);
		expect(notReady.status).toBe(409);
		const notReadyText = await notReady.text();
		const notReadyBody = JSON.parse(notReadyText) as ErrorBody;
		expect(notReadyBody.error.code).toBe("EVENT_PUBLISH_NOT_READY");
		expect(notReadyBody.error.details?.map(({ code }) => code)).toEqual(
			readiness.reasons.map(({ code }) => code),
		);
		const notReadyReplay = await publishRequest(
			owner.id,
			rootEventId,
			"publish-not-ready-01",
			readiness,
		);
		expect(notReadyReplay.headers.get("idempotency-replayed")).toBe("true");
		expect(normalizeError((await notReadyReplay.json()) as ErrorBody)).toEqual(
			normalizeError(notReadyBody),
		);

		const participantRead = await app.request(
			`/v1/event-roots/${rootEventId}/publish-readiness`,
			{ headers: auth(participant.id) },
		);
		const participantPublish = await publishRequest(
			participant.id,
			rootEventId,
			"publish-participant-01",
			readiness,
		);
		expect([participantRead.status, participantPublish.status]).toEqual([
			403, 403,
		]);

		const unknownRoot = "evt_publish_unknown01";
		const outsiderReadExisting = await errorResponse(
			app.request(`/v1/event-roots/${rootEventId}/publish-readiness`, {
				headers: auth(outsider.id),
			}),
		);
		const outsiderReadUnknown = await errorResponse(
			app.request(`/v1/event-roots/${unknownRoot}/publish-readiness`, {
				headers: auth(outsider.id),
			}),
		);
		expect(outsiderReadExisting.status).toBe(404);
		expect(outsiderReadUnknown.status).toBe(404);
		expect(normalizeError(outsiderReadExisting.body)).toEqual(
			normalizeError(outsiderReadUnknown.body),
		);

		const outsiderPublishExisting = await errorResponse(
			publishRequest(
				outsider.id,
				rootEventId,
				"publish-outsider-existing-01",
				readiness,
			),
		);
		const outsiderPublishUnknown = await errorResponse(
			publishRequest(
				outsider.id,
				unknownRoot,
				"publish-outsider-unknown-01",
				readiness,
			),
		);
		expect(outsiderPublishExisting.status).toBe(404);
		expect(outsiderPublishUnknown.status).toBe(404);
		expect(normalizeError(outsiderPublishExisting.body)).toEqual(
			normalizeError(outsiderPublishUnknown.body),
		);
		expect(normalizeError(outsiderPublishExisting.body)).toEqual(
			normalizeError(outsiderReadExisting.body),
		);
	});

	test("targets the selected template root capability when all capabilities are missing", async () => {
		const rootEventId = "evt_publish_restore_root";
		await createTeamTemplateDraft(rootEventId);
		await service.removeCapability(owner, rootEventId, rootEventId, "team", 1);

		const response = await app.request(
			`/v1/event-roots/${rootEventId}/publish-readiness`,
			{ headers: auth(owner.id) },
		);
		expect(response.status).toBe(200);
		const readiness = (await response.json()) as EventPublishReadiness;
		expect(
			readiness.reasons.find(
				({ code }) => code === "EVENT_CAPABILITY_REQUIRED",
			),
		).toEqual({
			code: "EVENT_CAPABILITY_REQUIRED",
			path: "capabilities",
			message: "Configure at least one event capability before publishing.",
			meta: {
				eventId: rootEventId,
				capabilityType: "team",
				capabilityVersion: 2,
			},
		});

		const restored = await app.request(
			`/v1/event-roots/${rootEventId}/events/${rootEventId}/capabilities/team`,
			{
				method: "PUT",
				headers: commandAuth(owner.id, "restore-publish-capability-01"),
				body: JSON.stringify({
					baseVersion: 2,
					capability: {
						type: "team",
						schemaVersion: 1,
						config: {
							venuePlaceId: null,
							assignmentMode: "organizer",
							capacityPerTeam: null,
							facilitator: null,
						},
					},
				}),
			},
		);
		expect(restored.status).toBe(200);
		expect(await restored.json()).toMatchObject({
			capability: { eventId: rootEventId, type: "team", version: 3 },
		});
		const afterRestore = await service.getPublishReadiness(owner, rootEventId);
		expect(afterRestore.reasons).not.toContainEqual(
			expect.objectContaining({ code: "EVENT_CAPABILITY_REQUIRED" }),
		);
		expect(afterRestore.reasons).toContainEqual(
			expect.objectContaining({
				code: "EVENT_CAPABILITY_PLACE_REQUIRED",
				meta: { eventId: rootEventId, capabilityType: "team" },
			}),
		);
	});

	test("publishes once under concurrent commands and replays the winning response byte-for-byte", async () => {
		const rootEventId = "evt_publish_concurrent01";
		await createTeamTemplateDraft(rootEventId);
		await addMember(rootEventId, organizer.id, "organizer");
		await makeTeamTemplateReady(rootEventId);

		const readinessResponse = await app.request(
			`/v1/event-roots/${rootEventId}/publish-readiness`,
			{ headers: auth(organizer.id) },
		);
		expect(readinessResponse.status).toBe(200);
		const readiness = (await readinessResponse.json()) as EventPublishReadiness;
		expect(readiness).toMatchObject({
			rootVersion: 1,
			rootRevision: "3",
			template: { id: "team-event", version: 1 },
			ready: true,
			reasons: [],
		});

		const attempts = await Promise.all([
			publishRequest(organizer.id, rootEventId, "publish-race-a-01", readiness),
			publishRequest(organizer.id, rootEventId, "publish-race-b-01", readiness),
		]);
		expect(attempts.map(({ status }) => status).sort()).toEqual([200, 409]);
		const winner = attempts.find(({ status }) => status === 200);
		const loser = attempts.find(({ status }) => status === 409);
		if (!winner || !loser) throw new Error("Expected one publish winner");
		const winnerKey =
			winner === attempts[0] ? "publish-race-a-01" : "publish-race-b-01";
		const winnerText = await winner.clone().text();
		expect(((await loser.json()) as ErrorBody).error.code).toBe(
			"VERSION_CONFLICT",
		);

		const replay = await publishRequest(
			organizer.id,
			rootEventId,
			winnerKey,
			readiness,
		);
		expect(replay.status).toBe(200);
		expect(replay.headers.get("idempotency-replayed")).toBe("true");
		expect(await replay.text()).toBe(winnerText);

		const changedReplay = await publishRequest(
			organizer.id,
			rootEventId,
			winnerKey,
			{
				...readiness,
				rootRevision: String(Number(readiness.rootRevision) + 10),
			},
		);
		expect(changedReplay.status).toBe(409);
		expect(((await changedReplay.json()) as ErrorBody).error.code).toBe(
			"IDEMPOTENCY_KEY_REUSED",
		);

		const [proof] = await sql<
			{
				status: string;
				version: number;
				revision: string;
				eventChanges: number;
				publishEntries: number;
				feedChanges: number;
			}[]
		>`
			SELECT event.status, event.version, root.revision::text AS revision,
				(SELECT count(*)::int FROM event_root_changes change
					WHERE change.root_event_id = ${rootEventId}
						AND change.root_revision = root.revision
						AND change.entity_type = 'event'
						AND change.entity_id = ${rootEventId}) AS "eventChanges",
				(SELECT count(*)::int FROM event_feed_entries entry
					JOIN event_feed_entry_current current
						ON current.root_event_id = entry.root_event_id
						AND current.entry_id = entry.id
					WHERE entry.root_event_id = ${rootEventId}
						AND entry.kind = 'system'
						AND current.body::jsonb ->> 'type' = 'event.published') AS "publishEntries",
				(SELECT count(*)::int FROM event_root_changes change
					WHERE change.root_event_id = ${rootEventId}
						AND change.root_revision = root.revision
						AND change.entity_type = 'feedEntry') AS "feedChanges"
			FROM event_roots root
			JOIN events event ON event.root_event_id = root.root_event_id
				AND event.id = root.root_event_id
			WHERE root.root_event_id = ${rootEventId}
		`;
		expect(proof).toEqual({
			status: "published",
			version: 2,
			revision: "4",
			eventChanges: 1,
			publishEntries: 1,
			feedChanges: 1,
		});
	});

	test("distinguishes aggregate revision drift from root row version drift", async () => {
		const rootEventId = "evt_publish_versions01";
		await createTeamTemplateDraft(rootEventId);
		await makeTeamTemplateReady(rootEventId);
		const reviewed = await service.getPublishReadiness(owner, rootEventId);
		expect(reviewed).toMatchObject({ rootVersion: 1, rootRevision: "3" });

		await service.replaceCapability(owner, rootEventId, rootEventId, 2, {
			type: "team",
			schemaVersion: 1,
			config: {
				venuePlaceId: `plc_${rootEventId.slice(4)}_venue`,
				assignmentMode: "organizer",
				capacityPerTeam: 8,
				facilitator: null,
			},
		});
		const aggregateChanged = await service.getPublishReadiness(
			owner,
			rootEventId,
		);
		expect(aggregateChanged).toMatchObject({
			rootVersion: 1,
			rootRevision: "4",
			ready: true,
		});
		const staleRevision = await publishRequest(
			owner.id,
			rootEventId,
			"publish-stale-revision-01",
			reviewed,
		);
		expect(staleRevision.status).toBe(409);
		expect(((await staleRevision.json()) as ErrorBody).error).toMatchObject({
			code: "ROOT_REVISION_CONFLICT",
			details: [{ code: "CURRENT_ROOT_REVISION" }],
		});

		await service.updateEvent(owner, rootEventId, rootEventId, 1, {
			description: "Updated launch description",
		});
		const rootChanged = await service.getPublishReadiness(owner, rootEventId);
		expect(rootChanged).toMatchObject({
			rootVersion: 2,
			rootRevision: "5",
			ready: true,
		});
		const staleVersion = await publishRequest(
			owner.id,
			rootEventId,
			"publish-stale-version-01",
			{ ...rootChanged, rootVersion: 1 },
		);
		expect(staleVersion.status).toBe(409);
		expect(((await staleVersion.json()) as ErrorBody).error).toMatchObject({
			code: "VERSION_CONFLICT",
			details: [{ code: "CURRENT_VERSION" }],
		});
	});

	test("blocks root publication through both generic PATCH and sync mutation paths", async () => {
		const rootEventId = "evt_publish_guard01";
		await service.createRoot(owner, genericDraft(rootEventId));

		const patch = await app.request(
			`/v1/event-roots/${rootEventId}/events/${rootEventId}`,
			{
				method: "PATCH",
				headers: commandAuth(owner.id, "publish-generic-patch-01"),
				body: JSON.stringify({
					baseVersion: 1,
					changes: { status: "published" },
				}),
			},
		);
		expect(patch.status).toBe(409);
		expect(((await patch.json()) as ErrorBody).error.code).toBe(
			"PUBLISH_COMMAND_REQUIRED",
		);

		const sync = await app.request("/v1/sync/push", {
			method: "POST",
			headers: commandAuth(owner.id, "publish-generic-sync-01"),
			body: JSON.stringify({
				protocolVersion: 1,
				rootEventId,
				deviceId: "dvc_00000000-0000-4000-8000-000000000401",
				mutations: [
					{
						clientMutationId: "00000000-0000-4000-8000-000000000401",
						clientSequence: 1,
						kind: "event.update",
						entityId: rootEventId,
						baseVersion: 1,
						payload: { changes: { status: "published" } },
					},
				],
			}),
		});
		expect(sync.status).toBe(200);
		const syncBody = (await sync.json()) as SyncPushResponse;
		expect(syncBody.results[0]).toMatchObject({
			outcome: "rejected",
			error: { code: "PUBLISH_COMMAND_REQUIRED" },
		});

		const stored = await service.getEvent(owner, rootEventId, rootEventId);
		expect(stored).toMatchObject({ status: "draft", version: 1 });
	});
});

function auth(user: string) {
	return { Authorization: `Bearer ${user}` };
}

function commandAuth(user: string, key: string) {
	return {
		...auth(user),
		"Content-Type": "application/json",
		"Idempotency-Key": key,
	};
}

async function publishRequest(
	actorId: string,
	rootEventId: string,
	idempotencyKey: string,
	readiness: Pick<EventPublishReadiness, "rootVersion" | "rootRevision">,
) {
	return app.request(`/v1/event-roots/${rootEventId}/publish`, {
		method: "POST",
		headers: commandAuth(actorId, idempotencyKey),
		body: JSON.stringify({
			baseVersion: readiness.rootVersion,
			baseRevision: readiness.rootRevision,
		}),
	});
}

async function errorResponse(responsePromise: Response | Promise<Response>) {
	const response = await responsePromise;
	return {
		status: response.status,
		body: (await response.json()) as ErrorBody,
	};
}

function normalizeError(body: ErrorBody) {
	const { requestId: _requestId, ...error } = body.error;
	return error;
}

function genericDraft(id: string): EventInput {
	return {
		id,
		kind: "team_event",
		title: "PRIVATE launch title",
		description: null,
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		status: "draft",
	};
}

async function createTeamTemplateDraft(rootEventId: string) {
	const response = await app.request("/v1/event-roots", {
		method: "POST",
		headers: commandAuth(owner.id, `create-${rootEventId}`),
		body: JSON.stringify({
			id: rootEventId,
			kind: "team_event",
			title: "Publishable team event",
			description: "A complete server-reviewed event.",
			timeZone: "Europe/Zurich",
			startsAt: "2026-08-01T08:00:00+02:00",
			endsAt: "2026-08-01T18:00:00+02:00",
			status: "draft",
			template: {
				id: "team-event",
				version: 1,
				eventIds: {
					root: rootEventId,
					agenda: `${rootEventId}_agenda`,
					activity: `${rootEventId}_activity`,
				},
			},
		}),
	});
	expect(response.status).toBe(201);
}

async function makeTeamTemplateReady(rootEventId: string) {
	const placeId = `plc_${rootEventId.slice(4)}_venue`;
	await service.createPlace(owner, rootEventId, {
		id: placeId,
		name: "Publish venue",
		locality: "Zurich",
		countryCode: "CH",
		latitude: null,
		longitude: null,
	});
	await service.replaceCapability(owner, rootEventId, rootEventId, 1, {
		type: "team",
		schemaVersion: 1,
		config: {
			venuePlaceId: placeId,
			assignmentMode: "organizer",
			capacityPerTeam: 6,
			facilitator: null,
		},
	});
}

async function addMember(
	rootEventId: string,
	actorId: string,
	role: "organizer" | "participant",
) {
	await sql`
		INSERT INTO event_memberships (root_event_id, user_id, role, status)
		VALUES (${rootEventId}, ${actorId}, ${role}, 'active')
	`;
}
