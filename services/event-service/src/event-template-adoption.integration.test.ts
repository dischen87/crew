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

const databaseUrl =
	Bun.env.EVENT_TEST_DATABASE_URL ?? "postgres://localhost/crew_event_test";
const userId = (value: number) => `usr_${value.toString(16).padStart(32, "0")}`;
const owner = { id: userId(701) };
const organizer = { id: userId(702) };
const participant = { id: userId(703) };
const viewer = { id: userId(704) };
const inactiveOrganizer = { id: userId(705) };
const notificationPayloads = () =>
	new EventNotificationPayloadCodec({
		kid: "template-adoption-test-v1",
		key: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
	});

let sql: Sql;
let service: EventService;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
	sql = postgres(databaseUrl, { max: 12, onnotice: () => {} });
	await migrate(sql);
	service = new EventService(
		new PostgresEventRepository(sql, notificationPayloads()),
		"template-adoption-test-invitation-key-with-at-least-32-characters",
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

describe("existing-root template adoption against PostgreSQL 17", () => {
	test("preserves existing content, emits one deterministic revision and replays owner and organizer success", async () => {
		const rootEventId = "evt_adopt_preserve";
		const existingEventId = "evt_adopt_existing_child";
		await service.createRoot(owner, {
			...draft(rootEventId, "other"),
			title: "Private planning title",
			description: "Keep this description",
			timeZone: "Europe/Lisbon",
			startsAt: new Date("2026-10-01T09:00:00.000Z"),
			endsAt: new Date("2026-10-05T17:00:00.000Z"),
		});
		await service.createEvent(owner, rootEventId, rootEventId, {
			...draft(existingEventId, "activity"),
			title: "Existing custom activity",
			timeZone: "Europe/Lisbon",
		});
		await service.createPlace(owner, rootEventId, {
			id: "plc_adopt_existing",
			name: "Existing venue",
			locality: "Lisbon",
			countryCode: "PT",
			latitude: 38.7223,
			longitude: -9.1393,
		});
		await service.createItineraryItem(owner, rootEventId, {
			id: "iti_adopt_existing",
			eventId: existingEventId,
			title: "Existing itinerary note",
			notes: "Do not replace",
			timeZone: "Europe/Lisbon",
			startsAt: null,
			endsAt: null,
			allDay: false,
			status: "active",
			details: { schemaVersion: 1, type: "note" },
			placeId: null,
		});
		await service.replaceCapability(owner, rootEventId, existingEventId, 0, {
			type: "travel",
			schemaVersion: 1,
			config: {
				homePlaceId: null,
				travelerReferenceLabel: "Existing reference",
			},
		});
		const preservedBefore = await preservedContent(
			rootEventId,
			existingEventId,
		);
		const before = await service.getRoot(owner, rootEventId);
		const beforeRoot = requiredRoot(before.events, rootEventId);
		const body = adoptionBody(
			rootEventId,
			beforeRoot.version,
			before.rootRevision,
		);

		const first = await adopt(
			owner.id,
			rootEventId,
			"adopt-preserve-owner-01",
			body,
		);
		expect(first.status).toBe(200);
		expect(first.headers.get("idempotency-replayed")).toBe("false");
		const firstText = await first.text();
		const adopted = JSON.parse(firstText);
		expect(adopted).toMatchObject({
			rootRevision: (BigInt(before.rootRevision) + 1n).toString(),
			template: { id: "team-event", version: 1 },
			event: {
				id: rootEventId,
				kind: "team_event",
				title: "Private planning title",
				description: "Keep this description",
				timeZone: "Europe/Lisbon",
				startsAt: "2026-10-01T09:00:00.000Z",
				endsAt: "2026-10-05T17:00:00.000Z",
				version: beforeRoot.version + 1,
				childOrderVersion: beforeRoot.childOrderVersion + 1,
			},
		});
		const replay = await adopt(
			owner.id,
			rootEventId,
			"adopt-preserve-owner-01",
			body,
		);
		expect(replay.status).toBe(200);
		expect(replay.headers.get("idempotency-replayed")).toBe("true");
		expect(await replay.text()).toBe(firstText);

		const after = await service.getRoot(owner, rootEventId);
		expect(after.events.map(({ id }) => id).sort()).toEqual(
			[
				rootEventId,
				existingEventId,
				"evt_adopt_agenda",
				"evt_adopt_activity",
			].sort(),
		);
		expect(requiredRoot(after.events, existingEventId)).toEqual(
			requiredRoot(before.events, existingEventId),
		);
		expect(after.capabilities).toHaveLength(2);
		expect(
			after.capabilities.find(({ type }) => type === "team"),
		).toMatchObject({
			eventId: rootEventId,
			type: "team",
			version: 1,
		});
		expect(after.capabilities.find(({ type }) => type === "travel")).toEqual(
			before.capabilities.find(({ type }) => type === "travel"),
		);
		const [preserved] = await sql<
			{
				templateId: string;
				templateVersion: number;
				places: number;
				itinerary: number;
			}[]
		>`
			SELECT root.template_id AS "templateId",
				root.template_version AS "templateVersion",
				(SELECT count(*)::int FROM event_places
					WHERE root_event_id = ${rootEventId}) AS places,
				(SELECT count(*)::int FROM event_itinerary_items
					WHERE root_event_id = ${rootEventId}) AS itinerary
			FROM event_roots root WHERE root.root_event_id = ${rootEventId}
		`;
		expect(preserved).toEqual({
			templateId: "team-event",
			templateVersion: 1,
			places: 1,
			itinerary: 1,
		});
		expect(
			JSON.stringify(await preservedContent(rootEventId, existingEventId)),
		).toBe(JSON.stringify(preservedBefore));
		const changes = await sql<
			{
				ordinal: number;
				entityType: string;
				entityId: string;
				version: number;
			}[]
		>`
			SELECT ordinal, entity_type AS "entityType", entity_id AS "entityId",
				entity_version AS version
			FROM event_root_changes
			WHERE root_event_id = ${rootEventId}
				AND root_revision = ${adopted.rootRevision}::bigint
			ORDER BY ordinal
		`;
		expect([...changes]).toEqual([
			{
				ordinal: 0,
				entityType: "event",
				entityId: rootEventId,
				version: beforeRoot.version + 1,
			},
			{
				ordinal: 1,
				entityType: "event",
				entityId: "evt_adopt_agenda",
				version: 1,
			},
			{
				ordinal: 2,
				entityType: "event",
				entityId: "evt_adopt_activity",
				version: 1,
			},
			{
				ordinal: 3,
				entityType: "capability",
				entityId: `${rootEventId}:team`,
				version: 1,
			},
		]);
		const readiness = await service.getPublishReadiness(owner, rootEventId);
		expect(readiness.template).toEqual({ id: "team-event", version: 1 });
		expect(readiness.reasons.map(({ code }) => code)).not.toContain(
			"EVENT_TEMPLATE_REQUIRED",
		);

		const organizerRoot = "evt_adopt_organizer";
		await service.createRoot(owner, draft(organizerRoot, "team_event"));
		await addMember(organizerRoot, organizer.id, "organizer");
		const organizerResponse = await adopt(
			organizer.id,
			organizerRoot,
			"adopt-organizer-01",
			adoptionBody(organizerRoot, 1, "1", {
				agenda: "evt_adopt_org_agenda",
				activity: "evt_adopt_org_activity",
			}),
		);
		expect(organizerResponse.status).toBe(200);
	});

	test("reuses compatible blueprint content, preserves it exactly and inserts only missing rows", async () => {
		const rootEventId = "evt_adopt_partial";
		const agendaEventId = "evt_adopt_partial_agenda";
		const activityEventId = "evt_adopt_partial_activity";
		await service.createRoot(owner, {
			...draft(rootEventId, "team_event"),
			title: "Existing team event",
			description: "Keep the partial setup",
		});
		await service.createEvent(owner, rootEventId, rootEventId, {
			...draft(agendaEventId, "session"),
			title: "Customer-written agenda",
			description: "Do not replace this session",
			startsAt: new Date("2026-11-03T08:00:00.000Z"),
			endsAt: new Date("2026-11-03T10:00:00.000Z"),
		});
		await service.replaceCapability(owner, rootEventId, rootEventId, 0, {
			type: "team",
			schemaVersion: 1,
			config: {
				venuePlaceId: null,
				assignmentMode: "self_select",
				capacityPerTeam: 8,
				facilitator: "Existing facilitator",
			},
		});
		const before = await service.getRoot(owner, rootEventId);
		const beforeRoot = requiredRoot(before.events, rootEventId);
		const beforeAgenda = requiredRoot(before.events, agendaEventId);
		const beforeTeam = before.capabilities.find(
			(capability) =>
				capability.eventId === rootEventId && capability.type === "team",
		);
		if (!beforeTeam) throw new Error("Missing compatible team capability");
		const body = adoptionBody(
			rootEventId,
			beforeRoot.version,
			before.rootRevision,
			{ agenda: agendaEventId, activity: activityEventId },
		);

		const first = await adopt(
			owner.id,
			rootEventId,
			"adopt-partial-compatible-01",
			body,
		);
		expect(first.status).toBe(200);
		expect(first.headers.get("idempotency-replayed")).toBe("false");
		const firstText = await first.text();
		const adopted = JSON.parse(firstText);
		expect(adopted).toMatchObject({
			rootRevision: (BigInt(before.rootRevision) + 1n).toString(),
			template: { id: "team-event", version: 1 },
			event: {
				id: rootEventId,
				version: beforeRoot.version + 1,
				childOrderVersion: beforeRoot.childOrderVersion + 1,
			},
		});
		const replay = await adopt(
			owner.id,
			rootEventId,
			"adopt-partial-compatible-01",
			body,
		);
		expect(replay.status).toBe(200);
		expect(replay.headers.get("idempotency-replayed")).toBe("true");
		expect(await replay.text()).toBe(firstText);

		const after = await service.getRoot(owner, rootEventId);
		expect(after.events.map(({ id }) => id).sort()).toEqual(
			[rootEventId, agendaEventId, activityEventId].sort(),
		);
		expect(requiredRoot(after.events, agendaEventId)).toEqual(beforeAgenda);
		expect(
			after.capabilities.find(
				(capability) =>
					capability.eventId === rootEventId && capability.type === "team",
			),
		).toEqual(beforeTeam);
		const changes = await sql<
			{
				ordinal: number;
				entityType: string;
				entityId: string;
				version: number;
			}[]
		>`
			SELECT ordinal, entity_type AS "entityType", entity_id AS "entityId",
				entity_version AS version
			FROM event_root_changes
			WHERE root_event_id = ${rootEventId}
				AND root_revision = ${adopted.rootRevision}::bigint
			ORDER BY ordinal
		`;
		expect([...changes]).toEqual([
			{
				ordinal: 0,
				entityType: "event",
				entityId: rootEventId,
				version: beforeRoot.version + 1,
			},
			{
				ordinal: 1,
				entityType: "event",
				entityId: activityEventId,
				version: 1,
			},
		]);
	});

	test("inserts a missing capability without changing an already complete child order", async () => {
		const rootEventId = "evt_adopt_capability_only";
		const agendaEventId = "evt_adopt_cap_only_agenda";
		const activityEventId = "evt_adopt_cap_only_activity";
		await service.createRoot(owner, draft(rootEventId, "team_event"));
		await service.createEvent(
			owner,
			rootEventId,
			rootEventId,
			draft(agendaEventId, "session"),
		);
		await service.createEvent(
			owner,
			rootEventId,
			rootEventId,
			draft(activityEventId, "activity"),
		);
		const before = await service.getRoot(owner, rootEventId);
		const beforeRoot = requiredRoot(before.events, rootEventId);
		const response = await adopt(
			owner.id,
			rootEventId,
			"adopt-capability-only-01",
			adoptionBody(rootEventId, beforeRoot.version, before.rootRevision, {
				agenda: agendaEventId,
				activity: activityEventId,
			}),
		);
		expect(response.status).toBe(200);
		const adopted = await response.json();
		expect(adopted.event.childOrderVersion).toBe(beforeRoot.childOrderVersion);
		const after = await service.getRoot(owner, rootEventId);
		expect(requiredRoot(after.events, agendaEventId)).toEqual(
			requiredRoot(before.events, agendaEventId),
		);
		expect(requiredRoot(after.events, activityEventId)).toEqual(
			requiredRoot(before.events, activityEventId),
		);
		expect(after.capabilities).toHaveLength(1);
		const changes = await sql<{ entityType: string; entityId: string }[]>`
			SELECT entity_type AS "entityType", entity_id AS "entityId"
			FROM event_root_changes
			WHERE root_event_id = ${rootEventId}
				AND root_revision = ${adopted.rootRevision}::bigint
			ORDER BY ordinal
		`;
		expect([...changes]).toEqual([
			{ entityType: "event", entityId: rootEventId },
			{ entityType: "capability", entityId: `${rootEventId}:team` },
		]);
	});

	test("denies participants and viewers and rejects stale, incompatible, templated, colliding and invalid requests", async () => {
		const deniedRoot = "evt_adopt_denied";
		await service.createRoot(owner, draft(deniedRoot));
		await addMember(deniedRoot, participant.id, "participant");
		await addMember(deniedRoot, viewer.id, "viewer");
		const deniedBody = adoptionBody(deniedRoot, 1, "1", {
			agenda: "evt_adopt_denied_agenda",
			activity: "evt_adopt_denied_activity",
		});
		for (const [actorId, key] of [
			[participant.id, "adopt-denied-participant-01"],
			[viewer.id, "adopt-denied-viewer-01"],
		] as const) {
			const denied = await adopt(actorId, deniedRoot, key, deniedBody);
			expect(denied.status).toBe(403);
			const deniedText = await denied.text();
			const replay = await adopt(actorId, deniedRoot, key, deniedBody);
			expect(replay.status).toBe(403);
			expect(replay.headers.get("idempotency-replayed")).toBe("true");
			expect(await replay.text()).toBe(deniedText);
		}
		await sql`
			INSERT INTO event_memberships (root_event_id, user_id, role, status)
			VALUES (${deniedRoot}, ${inactiveOrganizer.id}, 'organizer', 'removed')
		`;
		const inactive = await adopt(
			inactiveOrganizer.id,
			deniedRoot,
			"adopt-denied-inactive-01",
			deniedBody,
		);
		expect(inactive.status).toBe(404);
		expect(await errorCode(inactive)).toBe("NOT_FOUND");
		const unauthorizedTemplateProbe = await adopt(
			participant.id,
			deniedRoot,
			"adopt-denied-template-probe-01",
			{
				...deniedBody,
				template: { ...deniedBody.template, id: "unknown-template" },
			},
		);
		expect(unauthorizedTemplateProbe.status).toBe(403);
		expect(await errorCode(unauthorizedTemplateProbe)).toBe("FORBIDDEN");

		const staleRoot = "evt_adopt_stale";
		await service.createRoot(owner, draft(staleRoot));
		const staleVersion = await adopt(
			owner.id,
			staleRoot,
			"adopt-stale-version-01",
			adoptionBody(staleRoot, 2, "1", {
				agenda: "evt_adopt_stale_v_agenda",
				activity: "evt_adopt_stale_v_activity",
			}),
		);
		expect(await errorCode(staleVersion)).toBe("VERSION_CONFLICT");
		const staleRevision = await adopt(
			owner.id,
			staleRoot,
			"adopt-stale-revision-01",
			adoptionBody(staleRoot, 1, "2", {
				agenda: "evt_adopt_stale_r_agenda",
				activity: "evt_adopt_stale_r_activity",
			}),
		);
		expect(await errorCode(staleRevision)).toBe("ROOT_REVISION_CONFLICT");

		const incompatibleRoot = "evt_adopt_incompatible";
		await service.createRoot(owner, draft(incompatibleRoot, "trip"));
		const incompatible = await adopt(
			owner.id,
			incompatibleRoot,
			"adopt-incompatible-01",
			adoptionBody(incompatibleRoot, 1, "1", {
				agenda: "evt_adopt_incompatible_agenda",
				activity: "evt_adopt_incompatible_activity",
			}),
		);
		expect(await errorCode(incompatible)).toBe(
			"EVENT_TEMPLATE_ROOT_KIND_MISMATCH",
		);

		const templatedRoot = "evt_adopt_already_templated";
		await service.createRoot(
			owner,
			draft(templatedRoot, "team_event"),
			teamTemplate(templatedRoot, {
				agenda: "evt_adopt_templated_agenda",
				activity: "evt_adopt_templated_activity",
			}),
		);
		const templated = await adopt(
			owner.id,
			templatedRoot,
			"adopt-already-templated-01",
			adoptionBody(templatedRoot, 1, "1", {
				agenda: "evt_adopt_second_agenda",
				activity: "evt_adopt_second_activity",
			}),
		);
		expect(await errorCode(templated)).toBe("EVENT_TEMPLATE_ALREADY_SET");

		const collisionId = "evt_adopt_global_collision";
		await service.createRoot(owner, draft(collisionId));
		const collisionRoot = "evt_adopt_collision_root";
		await service.createRoot(owner, draft(collisionRoot));
		const collision = await adopt(
			owner.id,
			collisionRoot,
			"adopt-id-collision-01",
			adoptionBody(collisionRoot, 1, "1", {
				agenda: collisionId,
				activity: "evt_adopt_collision_activity",
			}),
		);
		expect(await errorCode(collision)).toBe("ID_COLLISION");

		const malformed = await adopt(
			owner.id,
			staleRoot,
			"adopt-malformed-ids-01",
			{
				baseVersion: 1,
				baseRevision: "1",
				template: {
					id: "team-event",
					version: 1,
					eventIds: {
						root: staleRoot,
						agenda: "bad",
						activity: "evt_adopt_malformed_activity",
					},
				},
			},
		);
		expect(malformed.status).toBe(400);
		expect(await errorCode(malformed)).toBe("VALIDATION_FAILED");
	});

	test("rejects incompatible, published, deleted and tombstoned partial content without writes", async () => {
		for (const [suffix, prepare] of [
			[
				"wrong_kind",
				(eventId: string) =>
					sql`UPDATE events SET kind = 'activity' WHERE id = ${eventId}`,
			],
			[
				"published_child",
				(eventId: string) =>
					sql`UPDATE events SET status = 'published' WHERE id = ${eventId}`,
			],
			[
				"deleted_child",
				(eventId: string) => sql`
					UPDATE events SET status = 'archived', deleted_at = now()
					WHERE id = ${eventId}
				`,
			],
		] as const) {
			const rootEventId = `evt_adopt_partial_${suffix}`;
			const agendaEventId = `evt_adopt_partial_${suffix}_agenda`;
			const activityEventId = `evt_adopt_partial_${suffix}_activity`;
			await service.createRoot(owner, draft(rootEventId, "team_event"));
			await service.createEvent(
				owner,
				rootEventId,
				rootEventId,
				draft(agendaEventId, "session"),
			);
			await prepare(agendaEventId);
			const view = await service.getRoot(owner, rootEventId);
			const root = requiredRoot(view.events, rootEventId);
			const before = await adoptionState(rootEventId);
			const body = adoptionBody(rootEventId, root.version, view.rootRevision, {
				agenda: agendaEventId,
				activity: activityEventId,
			});
			const response = await adopt(
				owner.id,
				rootEventId,
				`adopt-partial-${suffix}-01`,
				body,
			);
			expect(response.status).toBe(409);
			const responseText = await response.text();
			expect(JSON.parse(responseText).error.code).toBe(
				"EVENT_TEMPLATE_CONTENT_COLLISION",
			);
			const replay = await adopt(
				owner.id,
				rootEventId,
				`adopt-partial-${suffix}-01`,
				body,
			);
			expect(replay.status).toBe(409);
			expect(replay.headers.get("idempotency-replayed")).toBe("true");
			expect(await replay.text()).toBe(responseText);
			expect(await adoptionState(rootEventId)).toEqual(before);
		}

		const capabilityRoot = "evt_adopt_tombstoned_capability";
		await service.createRoot(owner, draft(capabilityRoot, "team_event"));
		await service.replaceCapability(owner, capabilityRoot, capabilityRoot, 0, {
			type: "team",
			schemaVersion: 1,
			config: {
				venuePlaceId: null,
				assignmentMode: "organizer",
				capacityPerTeam: null,
				facilitator: null,
			},
		});
		await sql`
			UPDATE event_capabilities SET deleted_at = now(), version = version + 1
			WHERE root_event_id = ${capabilityRoot}
				AND event_id = ${capabilityRoot} AND capability_type = 'team'
		`;
		const capabilityView = await service.getRoot(owner, capabilityRoot);
		const capabilityBefore = await adoptionState(capabilityRoot);
		const capabilityBody = adoptionBody(
			capabilityRoot,
			requiredRoot(capabilityView.events, capabilityRoot).version,
			capabilityView.rootRevision,
			{
				agenda: "evt_adopt_tomb_cap_agenda",
				activity: "evt_adopt_tomb_cap_activity",
			},
		);
		const capabilityResponse = await adopt(
			owner.id,
			capabilityRoot,
			"adopt-tombstoned-capability-01",
			capabilityBody,
		);
		expect(await errorCode(capabilityResponse)).toBe(
			"EVENT_TEMPLATE_CONTENT_COLLISION",
		);
		expect(await adoptionState(capabilityRoot)).toEqual(capabilityBefore);
	});

	test("rejects published, archived and deleted roots without partial state", async () => {
		for (const [suffix, prepare, expected] of [
			[
				"published",
				(rootEventId: string) =>
					sql`UPDATE events SET status = 'published' WHERE id = ${rootEventId}`,
				"EVENT_TEMPLATE_ADOPTION_STATE_INVALID",
			],
			[
				"archived",
				(rootEventId: string) =>
					sql`UPDATE event_roots SET status = 'archived' WHERE root_event_id = ${rootEventId}`,
				"ROOT_ARCHIVED",
			],
			[
				"deleted",
				(rootEventId: string) => sql`
					UPDATE events SET status = 'archived', deleted_at = now()
					WHERE id = ${rootEventId}
				`,
				"NOT_FOUND",
			],
		] as const) {
			const rootEventId = `evt_adopt_${suffix}`;
			await service.createRoot(owner, draft(rootEventId));
			await prepare(rootEventId);
			const response = await adopt(
				owner.id,
				rootEventId,
				`adopt-state-${suffix}-01`,
				adoptionBody(rootEventId, 1, "1", {
					agenda: `evt_adopt_${suffix}_agenda`,
					activity: `evt_adopt_${suffix}_activity`,
				}),
			);
			expect(await errorCode(response)).toBe(expected);
			const [proof] = await sql<
				{ templateId: string | null; events: number; capabilities: number }[]
			>`
				SELECT root.template_id AS "templateId",
					(SELECT count(*)::int FROM events
						WHERE root_event_id = ${rootEventId}) AS events,
					(SELECT count(*)::int FROM event_capabilities
						WHERE root_event_id = ${rootEventId}) AS capabilities
				FROM event_roots root WHERE root.root_event_id = ${rootEventId}
			`;
			expect(proof).toEqual({ templateId: null, events: 1, capabilities: 0 });
		}
	});

	test("rolls a forced mid-adoption failure and its idempotency claim back", async () => {
		const rootEventId = "evt_adopt_rollback";
		const body = adoptionBody(rootEventId, 1, "1", {
			agenda: "evt_adopt_rollback_agenda",
			activity: "evt_adopt_rollback_activity",
		});
		await service.createRoot(owner, draft(rootEventId));
		await sql.unsafe(`
			CREATE FUNCTION crew_test_fail_template_adoption()
			RETURNS TRIGGER LANGUAGE plpgsql AS $$
			BEGIN
				RAISE EXCEPTION 'forced template adoption rollback';
			END;
			$$;
			CREATE TRIGGER crew_test_fail_template_adoption_trigger
			BEFORE INSERT ON event_capabilities
			FOR EACH ROW EXECUTE FUNCTION crew_test_fail_template_adoption();
		`);
		try {
			const failed = await adopt(
				owner.id,
				rootEventId,
				"adopt-forced-rollback-01",
				body,
			);
			expect(failed.status).toBe(500);
		} finally {
			await sql.unsafe(`
				DROP TRIGGER crew_test_fail_template_adoption_trigger ON event_capabilities;
				DROP FUNCTION crew_test_fail_template_adoption();
			`);
		}
		const [proof] = await sql<
			{
				revision: string;
				templateId: string | null;
				rootVersion: number;
				events: number;
				capabilities: number;
				changes: number;
				claims: number;
			}[]
		>`
			SELECT root.revision::text AS revision,
				root.template_id AS "templateId",
				(SELECT version FROM events WHERE id = ${rootEventId}) AS "rootVersion",
				(SELECT count(*)::int FROM events WHERE root_event_id = ${rootEventId}) AS events,
				(SELECT count(*)::int FROM event_capabilities WHERE root_event_id = ${rootEventId}) AS capabilities,
				(SELECT count(*)::int FROM event_root_changes WHERE root_event_id = ${rootEventId}) AS changes,
				(SELECT count(*)::int FROM event_idempotency_records
					WHERE idempotency_key = 'adopt-forced-rollback-01') AS claims
			FROM event_roots root WHERE root.root_event_id = ${rootEventId}
		`;
		expect(proof).toEqual({
			revision: "1",
			templateId: null,
			rootVersion: 1,
			events: 1,
			capabilities: 0,
			changes: 2,
			claims: 0,
		});
		expect(
			(await adopt(owner.id, rootEventId, "adopt-forced-rollback-01", body))
				.status,
		).toBe(200);
	});

	test("serializes concurrent adoption so exactly one command wins", async () => {
		const rootEventId = "evt_adopt_concurrent";
		const body = adoptionBody(rootEventId, 1, "1", {
			agenda: "evt_adopt_concurrent_agenda",
			activity: "evt_adopt_concurrent_activity",
		});
		await service.createRoot(owner, draft(rootEventId));
		const responses = await Promise.all([
			adopt(owner.id, rootEventId, "adopt-concurrent-a-01", body),
			adopt(owner.id, rootEventId, "adopt-concurrent-b-01", body),
		]);
		const results = await Promise.all(
			responses.map(async (response, index) => ({
				index,
				status: response.status,
				body: await response.json(),
			})),
		);
		expect(results.map(({ status }) => status).sort()).toEqual([200, 409]);
		expect(results.find(({ status }) => status === 409)?.body.error.code).toBe(
			"EVENT_TEMPLATE_ALREADY_SET",
		);
		const loser = results.find(({ status }) => status === 409);
		if (!loser) throw new Error("Concurrent adoption loser invariant failed");
		const loserReplay = await adopt(
			owner.id,
			rootEventId,
			loser.index === 0 ? "adopt-concurrent-a-01" : "adopt-concurrent-b-01",
			body,
		);
		expect(loserReplay.status).toBe(409);
		expect(loserReplay.headers.get("idempotency-replayed")).toBe("true");

		const [proof] = await sql<
			{
				revision: string;
				events: number;
				capabilities: number;
				adoptionChanges: number;
			}[]
		>`
			SELECT root.revision::text AS revision,
				(SELECT count(*)::int FROM events WHERE root_event_id = ${rootEventId}) AS events,
				(SELECT count(*)::int FROM event_capabilities WHERE root_event_id = ${rootEventId}) AS capabilities,
				(SELECT count(*)::int FROM event_root_changes
					WHERE root_event_id = ${rootEventId} AND root_revision = 2) AS "adoptionChanges"
			FROM event_roots root WHERE root.root_event_id = ${rootEventId}
		`;
		expect(proof).toEqual({
			revision: "2",
			events: 3,
			capabilities: 1,
			adoptionChanges: 4,
		});
	});

	test("serializes a caller-stable child ID against a concurrent foreign-root create", async () => {
		const adoptionRoot = "evt_adopt_foreign_race_root";
		const foreignRoot = "evt_adopt_foreign_owner_root";
		const sharedEventId = "evt_adopt_foreign_shared";
		await service.createRoot(owner, draft(adoptionRoot));
		await service.createRoot(owner, draft(foreignRoot));

		const [adoptionResponse, foreignCreate] = await Promise.all([
			adopt(
				owner.id,
				adoptionRoot,
				"adopt-foreign-race-01",
				adoptionBody(adoptionRoot, 1, "1", {
					agenda: sharedEventId,
					activity: "evt_adopt_foreign_activity",
				}),
			),
			service
				.createEvent(owner, foreignRoot, foreignRoot, {
					...draft(sharedEventId, "session"),
					title: "Foreign concurrent event",
				})
				.then(
					(event) => ({ status: "fulfilled" as const, event }),
					(error: unknown) => ({ status: "rejected" as const, error }),
				),
		]);
		const adoptionStatus = adoptionResponse.status;
		const adoptionCode =
			adoptionStatus === 200 ? null : await errorCode(adoptionResponse);
		if (adoptionStatus === 200) {
			expect(foreignCreate).toMatchObject({
				status: "rejected",
				error: { status: 409, code: "ID_COLLISION" },
			});
		} else {
			expect(adoptionStatus).toBe(409);
			expect(adoptionCode).toBe("ID_COLLISION");
			expect(foreignCreate).toMatchObject({
				status: "fulfilled",
				event: { id: sharedEventId, rootEventId: foreignRoot },
			});
		}

		const [identity] = await sql<{ count: number; rootEventId: string }[]>`
			SELECT count(*)::int AS count, min(root_event_id) AS "rootEventId"
			FROM events WHERE id = ${sharedEventId}
		`;
		expect(identity?.count).toBe(1);
		expect(identity?.rootEventId).toBe(
			adoptionStatus === 200 ? adoptionRoot : foreignRoot,
		);
		const [adoptionProof] = await sql<
			{ templateId: string | null; revision: string }[]
		>`
			SELECT template_id AS "templateId", revision::text AS revision
			FROM event_roots WHERE root_event_id = ${adoptionRoot}
		`;
		expect(adoptionProof).toEqual(
			adoptionStatus === 200
				? { templateId: "team-event", revision: "2" }
				: { templateId: null, revision: "1" },
		);
	});
});

function draft(id: string, kind: EventInput["kind"] = "other"): EventInput {
	return {
		id,
		kind,
		title: "Draft root",
		description: null,
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		status: "draft",
	};
}

function teamTemplate(
	rootEventId: string,
	ids: { agenda: string; activity: string },
) {
	return {
		id: "team-event",
		version: 1,
		eventIds: { root: rootEventId, ...ids },
	};
}

function adoptionBody(
	rootEventId: string,
	baseVersion: number,
	baseRevision: string,
	ids: { agenda: string; activity: string } = {
		agenda: "evt_adopt_agenda",
		activity: "evt_adopt_activity",
	},
) {
	return {
		baseVersion,
		baseRevision,
		template: teamTemplate(rootEventId, ids),
	};
}

function adopt(
	actorId: string,
	rootEventId: string,
	key: string,
	body: unknown,
) {
	return app.request(`/v1/event-roots/${rootEventId}/template`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${actorId}`,
			"Content-Type": "application/json",
			"Idempotency-Key": key,
			"X-Request-ID": `request.${key}`,
		},
		body: JSON.stringify(body),
	});
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

async function preservedContent(rootEventId: string, eventId: string) {
	const [content] = await sql<
		{
			event: unknown;
			place: unknown;
			itinerary: unknown;
			capability: unknown;
		}[]
	>`
		SELECT
			(SELECT to_jsonb(event) FROM events event
				WHERE event.root_event_id = ${rootEventId}
					AND event.id = ${eventId}) AS event,
			(SELECT to_jsonb(place) FROM event_places place
				WHERE place.root_event_id = ${rootEventId}
					AND place.id = 'plc_adopt_existing') AS place,
			(SELECT to_jsonb(item) FROM event_itinerary_items item
				WHERE item.root_event_id = ${rootEventId}
					AND item.id = 'iti_adopt_existing') AS itinerary,
			(SELECT to_jsonb(capability) FROM event_capabilities capability
				WHERE capability.root_event_id = ${rootEventId}
					AND capability.event_id = ${eventId}
					AND capability.capability_type = 'travel') AS capability
	`;
	if (!content) throw new Error("Missing preserved content proof");
	return content;
}

async function adoptionState(rootEventId: string) {
	const [state] = await sql<
		{
			templateId: string | null;
			templateVersion: number | null;
			revision: string;
			rootVersion: number;
			childOrderVersion: number;
			events: number;
			capabilities: number;
			changes: number;
		}[]
	>`
		SELECT root.template_id AS "templateId",
			root.template_version AS "templateVersion",
			root.revision::text AS revision,
			event.version AS "rootVersion",
			event.child_order_version AS "childOrderVersion",
			(SELECT count(*)::int FROM events
				WHERE root_event_id = ${rootEventId}) AS events,
			(SELECT count(*)::int FROM event_capabilities
				WHERE root_event_id = ${rootEventId}) AS capabilities,
			(SELECT count(*)::int FROM event_root_changes
				WHERE root_event_id = ${rootEventId}) AS changes
		FROM event_roots root
		JOIN events event ON event.root_event_id = root.root_event_id
			AND event.id = root.root_event_id
		WHERE root.root_event_id = ${rootEventId}
	`;
	if (!state) throw new Error("Missing adoption state proof");
	return state;
}

function requiredRoot<T extends { id: string }>(events: T[], id: string): T {
	const event = events.find((item) => item.id === id);
	if (!event) throw new Error(`Missing event ${id}`);
	return event;
}

async function errorCode(response: Response): Promise<string> {
	return (await response.json()).error.code;
}
