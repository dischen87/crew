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
import type { CapabilityInput, EventInput, ItineraryInput } from "./domain";
import { EventNotificationPayloadCodec } from "./event-notification-payload";
import { PostgresEventRepository } from "./postgres-repository";
import { EventService } from "./service";
import { installPublishedRootFixtures } from "./test-published-root-fixture";

const databaseUrl =
	Bun.env.EVENT_TEST_DATABASE_URL ?? "postgres://localhost/crew_event_test";
const userId = (value: number) => `usr_${value.toString(16).padStart(32, "0")}`;
const owner = { id: userId(91) };
const participant = { id: userId(92) };
const viewer = { id: userId(93) };
const notificationPayloads = () =>
	new EventNotificationPayloadCodec({
		kid: "test-v1",
		key: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
	});
let sql: Sql;
let service: EventService;

beforeAll(async () => {
	sql = postgres(databaseUrl, { max: 12 });
	await migrate(sql);
	service = new EventService(
		new PostgresEventRepository(sql, notificationPayloads()),
		"test-invitation-key-with-at-least-32-characters",
	);
	installPublishedRootFixtures(service, sql);
});

beforeEach(async () => {
	await sql`TRUNCATE event_idempotency_records, event_roots CASCADE`;
});

afterAll(async () => {
	await sql.end();
});

describe("event templates and capabilities against PostgreSQL 17", () => {
	test("lists exactly three deterministic authenticated built-ins", async () => {
		const app = testApp();
		const unauthenticated = await app.request("/v1/event-templates");
		expect(unauthenticated.status).toBe(401);

		const first = await app.request("/v1/event-templates", {
			headers: auth(owner.id),
		});
		const second = await app.request("/v1/event-templates", {
			headers: auth(owner.id),
		});
		expect(first.status).toBe(200);
		expect(await second.clone().json()).toEqual(await first.clone().json());
		const body = await first.json();
		expect(
			body.templates.map((template: { id: string }) => template.id),
		).toEqual(["travel", "golf-tour", "team-event"]);
		expect(
			body.templates.every(
				(template: { version: number }) => template.version === 1,
			),
		).toBe(true);
		const team = body.templates[2];
		expect(
			team.events.map((event: { logicalKey: string }) => event.logicalKey),
		).toEqual(["root", "agenda", "activity"]);
		expect(
			team.events.flatMap((event: { capabilities: CapabilityInput[] }) =>
				event.capabilities.map((capability) => capability.type),
			),
		).toEqual(["team"]);
	});

	test("creates one exact atomic template revision and stores success and stale-version replay", async () => {
		const app = testApp();
		const rootEventId = "evt_tpl_golf01";
		const payload = templateRoot(rootEventId, "trip", "golf-tour", {
			root: rootEventId,
			arrival: "evt_tpl_arrival01",
			lodging: "evt_tpl_lodging01",
			round: "evt_tpl_round01",
		});
		const send = (body: unknown, key: string) =>
			app.request("/v1/event-roots", {
				method: "POST",
				headers: commandAuth(owner.id, key),
				body: JSON.stringify(body),
			});

		const created = await send(payload, "template-golf-create-01");
		expect(created.status).toBe(201);
		expect(created.headers.get("idempotency-replayed")).toBe("false");
		const createdText = await created.text();
		const replay = await send(payload, "template-golf-create-01");
		expect(replay.status).toBe(201);
		expect(replay.headers.get("idempotency-replayed")).toBe("true");
		const replayText = await replay.text();
		expect(replayText).toBe(createdText);
		expect(JSON.parse(replayText)).toEqual(JSON.parse(createdText));

		const [proof] = await sql<
			{
				revision: string;
				events: number;
				capabilities: number;
				itinerary: number;
				ordinals: number[];
				entityTypes: string[];
			}[]
		>`
			SELECT root.revision::text AS revision,
				(SELECT count(*)::int FROM events WHERE root_event_id = ${rootEventId}) AS events,
				(SELECT count(*)::int FROM event_capabilities WHERE root_event_id = ${rootEventId}) AS capabilities,
				(SELECT count(*)::int FROM event_itinerary_items WHERE root_event_id = ${rootEventId}) AS itinerary,
				(SELECT array_agg(ordinal ORDER BY ordinal) FROM event_root_changes WHERE root_event_id = ${rootEventId}) AS ordinals,
				(SELECT array_agg(entity_type ORDER BY ordinal) FROM event_root_changes WHERE root_event_id = ${rootEventId}) AS "entityTypes"
			FROM event_roots root WHERE root.root_event_id = ${rootEventId}
		`;
		expect(proof).toMatchObject({
			revision: "1",
			events: 4,
			capabilities: 4,
			itinerary: 0,
			ordinals: [0, 1, 2, 3, 4, 5, 6, 7, 8],
			entityTypes: [
				"event",
				"event",
				"event",
				"event",
				"membership",
				"capability",
				"capability",
				"capability",
				"capability",
			],
		});
		const view = await service.getRoot(owner, rootEventId);
		expect(
			view.capabilities.map((capability) => capability.type).sort(),
		).toEqual(["golf", "lodging", "transport", "travel"]);

		const staleRoot = "evt_tpl_stale01";
		const stale = {
			...templateRoot(staleRoot, "team_event", "team-event", {
				root: staleRoot,
				agenda: "evt_tpl_stale_agenda",
				activity: "evt_tpl_stale_activity",
			}),
			template: {
				id: "team-event",
				version: 2,
				eventIds: {
					root: staleRoot,
					agenda: "evt_tpl_stale_agenda",
					activity: "evt_tpl_stale_activity",
				},
			},
		};
		const staleFirst = await send(stale, "template-stale-version-01");
		expect(staleFirst.status).toBe(409);
		expect((await staleFirst.clone().json()).error.code).toBe(
			"EVENT_TEMPLATE_VERSION_CONFLICT",
		);
		const staleReplay = await send(stale, "template-stale-version-01");
		expect(staleReplay.status).toBe(409);
		expect(staleReplay.headers.get("idempotency-replayed")).toBe("true");
		expect((await staleReplay.json()).error).toMatchObject({
			code: "EVENT_TEMPLATE_VERSION_CONFLICT",
			message: "The requested event template version is not available.",
			retryable: false,
		});
		expect(
			(await sql`SELECT 1 FROM event_roots WHERE root_event_id = ${staleRoot}`)
				.length,
		).toBe(0);
	});

	test("rolls a forced mid-template failure back with its idempotency claim", async () => {
		const app = testApp();
		const rootEventId = "evt_tpl_rollback01";
		await sql.unsafe(`
			CREATE FUNCTION crew_test_fail_golf_capability()
			RETURNS TRIGGER LANGUAGE plpgsql AS $$
			BEGIN
				IF NEW.capability_type = 'golf' THEN
					RAISE EXCEPTION 'forced template rollback';
				END IF;
				RETURN NEW;
			END;
			$$;
			CREATE TRIGGER crew_test_fail_golf_capability_trigger
			BEFORE INSERT ON event_capabilities
			FOR EACH ROW EXECUTE FUNCTION crew_test_fail_golf_capability();
		`);
		try {
			const response = await app.request("/v1/event-roots", {
				method: "POST",
				headers: commandAuth(owner.id, "template-forced-rollback-01"),
				body: JSON.stringify(
					templateRoot(rootEventId, "trip", "golf-tour", {
						root: rootEventId,
						arrival: "evt_tpl_rb_arrival",
						lodging: "evt_tpl_rb_lodging",
						round: "evt_tpl_rb_round",
					}),
				),
			});
			expect(response.status).toBe(500);
		} finally {
			await sql.unsafe(`
				DROP TRIGGER crew_test_fail_golf_capability_trigger ON event_capabilities;
				DROP FUNCTION crew_test_fail_golf_capability();
			`);
		}
		const [proof] = await sql<
			{
				roots: number;
				events: number;
				capabilities: number;
				changes: number;
				claims: number;
			}[]
		>`
			SELECT
				(SELECT count(*)::int FROM event_roots WHERE root_event_id = ${rootEventId}) AS roots,
				(SELECT count(*)::int FROM events WHERE root_event_id = ${rootEventId}) AS events,
				(SELECT count(*)::int FROM event_capabilities WHERE root_event_id = ${rootEventId}) AS capabilities,
				(SELECT count(*)::int FROM event_root_changes WHERE root_event_id = ${rootEventId}) AS changes,
				(SELECT count(*)::int FROM event_idempotency_records WHERE idempotency_key = 'template-forced-rollback-01') AS claims
		`;
		expect(proof).toEqual({
			roots: 0,
			events: 0,
			capabilities: 0,
			changes: 0,
			claims: 0,
		});
	});

	test("enforces role, place, dependency, identity and concurrent replace invariants", async () => {
		const rootEventId = "evt_capability01";
		const childEventId = "evt_capability_child";
		await service.createRoot(owner, rootInput(rootEventId));
		await service.createEvent(owner, rootEventId, rootEventId, {
			...rootInput(childEventId),
			kind: "golf",
			title: "Golf day",
		});
		await sql`
			INSERT INTO event_memberships (root_event_id, user_id, role, status)
			VALUES (${rootEventId}, ${participant.id}, 'participant', 'active'),
				(${rootEventId}, ${viewer.id}, 'viewer', 'active')
		`;
		await service.createPlace(owner, rootEventId, {
			id: "plc_cap_course01",
			name: "Course",
			locality: "Belek",
			countryCode: "TR",
			latitude: 36.8,
			longitude: 31.1,
		});
		await service.createPlace(owner, rootEventId, {
			id: "plc_cap_dest01",
			name: "Hotel",
			locality: "Belek",
			countryCode: "TR",
			latitude: 36.9,
			longitude: 31.2,
		});
		await service.createRoot(owner, rootInput("evt_cap_other01"));
		await service.createPlace(owner, "evt_cap_other01", {
			id: "plc_cap_other01",
			name: "Other",
			locality: null,
			countryCode: "CH",
			latitude: null,
			longitude: null,
		});

		const golf = await service.replaceCapability(
			owner,
			rootEventId,
			childEventId,
			0,
			golfCapability("plc_cap_course01"),
		);
		expect(golf.version).toBe(1);
		await service.replaceCapability(owner, rootEventId, childEventId, 0, {
			type: "lodging",
			schemaVersion: 1,
			config: {
				propertyPlaceId: "plc_cap_dest01",
				checkInPolicy: "fixed",
				checkOutPolicy: "fixed",
				roomAssignmentMode: "organizer",
			},
		});
		await service.replaceCapability(owner, rootEventId, childEventId, 0, {
			type: "transport",
			schemaVersion: 1,
			config: { meetingPlaceId: "plc_cap_course01", participantMode: "shared" },
		});
		await expect(
			service.replaceCapability(
				participant,
				rootEventId,
				childEventId,
				1,
				golfCapability("plc_cap_course01"),
			),
		).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
		await expect(
			service.replaceCapability(
				viewer,
				rootEventId,
				childEventId,
				1,
				golfCapability("plc_cap_course01"),
			),
		).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
		await expect(
			service.replaceCapability(
				owner,
				rootEventId,
				childEventId,
				1,
				golfCapability("plc_cap_other01"),
			),
		).rejects.toMatchObject({ status: 400, code: "PLACE_INVALID" });

		await service.createItineraryItem(
			owner,
			rootEventId,
			itineraryInput("iti_cap_golf01", childEventId, {
				schemaVersion: 1,
				type: "golf_round",
				roundReference: "round-1",
				teeTime: "2026-10-12T08:00:00Z",
			}),
		);
		await service.createItineraryItem(
			owner,
			rootEventId,
			itineraryInput("iti_cap_lodging01", childEventId, {
				schemaVersion: 1,
				type: "lodging",
				propertyName: "Hotel",
				checkInAt: "2026-10-12T14:00:00Z",
				checkOutAt: "2026-10-14T10:00:00Z",
			}),
		);
		await service.createItineraryItem(
			owner,
			rootEventId,
			itineraryInput("iti_cap_transfer01", childEventId, {
				schemaVersion: 1,
				type: "road_transfer",
				originPlaceId: "plc_cap_course01",
				destinationPlaceId: "plc_cap_dest01",
				pickupInstructions: "Lobby",
			}),
		);
		await expect(
			service.removeCapability(owner, rootEventId, childEventId, "golf", 1),
		).rejects.toMatchObject({
			status: 409,
			code: "CAPABILITY_DEPENDENCIES_EXIST",
		});
		await expect(
			service.removeCapability(owner, rootEventId, childEventId, "lodging", 1),
		).rejects.toMatchObject({
			status: 409,
			code: "CAPABILITY_DEPENDENCIES_EXIST",
		});
		await expect(
			service.removeCapability(
				owner,
				rootEventId,
				childEventId,
				"transport",
				1,
			),
		).rejects.toMatchObject({
			status: 409,
			code: "CAPABILITY_DEPENDENCIES_EXIST",
		});

		const race = await Promise.allSettled([
			service.replaceCapability(owner, rootEventId, childEventId, 1, {
				...golfCapability("plc_cap_course01"),
				config: {
					...golfCapability("plc_cap_course01").config,
					teeFormat: "pairs",
				},
			}),
			service.replaceCapability(owner, rootEventId, childEventId, 1, {
				...golfCapability("plc_cap_course01"),
				config: {
					...golfCapability("plc_cap_course01").config,
					teeFormat: "fourball",
				},
			}),
		]);
		expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(
			1,
		);
		expect(
			(
				race.find(
					(result) => result.status === "rejected",
				) as PromiseRejectedResult
			).reason,
		).toMatchObject({ status: 409, code: "VERSION_CONFLICT" });

		await expectSqlState(
			"23514",
			() =>
				sql`UPDATE event_capabilities SET event_id = ${rootEventId}
				WHERE root_event_id = ${rootEventId} AND event_id = ${childEventId}
					AND capability_type = 'golf'`,
		);
		await expectSqlState(
			"23514",
			() =>
				sql`UPDATE event_capabilities SET config = '{"coursePlaceId":null}'::jsonb
				WHERE root_event_id = ${rootEventId} AND event_id = ${childEventId}
					AND capability_type = 'golf'`,
		);
		await expectSqlState(
			"23514",
			() =>
				sql`UPDATE events SET status = 'archived', deleted_at = now()
				WHERE root_event_id = ${rootEventId} AND id = ${childEventId}`,
		);

		const deletedEventId = "evt_capability_deleted";
		await service.createEvent(owner, rootEventId, rootEventId, {
			...rootInput(deletedEventId),
			kind: "session",
			title: "Deleted capability target",
		});
		await sql`UPDATE events SET status = 'archived', deleted_at = now()
			WHERE root_event_id = ${rootEventId} AND id = ${deletedEventId}`;
		await expectSqlState(
			"23514",
			() => sql`
				INSERT INTO event_capabilities (
					root_event_id, event_id, capability_type, schema_version, config
				) VALUES (
					${rootEventId}, ${deletedEventId}, 'travel', 1,
					'{"homePlaceId":null,"travelerReferenceLabel":null}'::jsonb
				)
			`,
		);
		await expectSqlState(
			"23514",
			() => sql`
				INSERT INTO event_capabilities (
					root_event_id, event_id, capability_type, schema_version, config
				) VALUES (
					${rootEventId}, ${childEventId}, 'travel', 1,
					jsonb_build_object(
						'homePlaceId', null,
						'travelerReferenceLabel', E'\t'
					)
				)
			`,
		);
		await expectSqlState(
			"23514",
			() => sql`
				INSERT INTO event_capabilities (
					root_event_id, event_id, capability_type, schema_version, config
				) VALUES (
					${rootEventId}, ${childEventId}, 'team', 1,
					'{"assignmentMode":"organizer","capacityPerTeam":null,"facilitator":" ","venuePlaceId":null}'::jsonb
				)
			`,
		);

		const currentChild = (
			await service.getRoot(owner, rootEventId)
		).events.find((event) => event.id === childEventId);
		expect(currentChild).toBeDefined();
		await service.tombstoneEvent(
			owner,
			rootEventId,
			childEventId,
			currentChild?.version ?? 0,
			true,
		);
		const [tombstoneProof] = await sql<
			{
				eventDeleted: boolean;
				liveCapabilities: number;
				eventTombstones: number;
				capabilityTombstones: number;
			}[]
		>`
			SELECT
				(SELECT deleted_at IS NOT NULL FROM events
					WHERE root_event_id = ${rootEventId} AND id = ${childEventId}) AS "eventDeleted",
				(SELECT count(*)::int FROM event_capabilities
					WHERE root_event_id = ${rootEventId} AND event_id = ${childEventId}
						AND deleted_at IS NULL) AS "liveCapabilities",
				(SELECT count(*)::int FROM event_root_changes
					WHERE root_event_id = ${rootEventId} AND entity_type = 'event'
						AND entity_id = ${childEventId} AND operation = 'tombstone') AS "eventTombstones",
				(SELECT count(*)::int FROM event_root_changes
					WHERE root_event_id = ${rootEventId} AND entity_type = 'capability'
						AND entity_id LIKE ${`${childEventId}:%`} AND operation = 'tombstone') AS "capabilityTombstones"
		`;
		expect(tombstoneProof).toEqual({
			eventDeleted: true,
			liveCapabilities: 0,
			eventTombstones: 1,
			capabilityTombstones: 3,
		});
	});

	test("projects published capability places, invalidates scope and syncs replace plus tombstone", async () => {
		const rootEventId = "evt_cap_sync01";
		const childEventId = "evt_cap_sync_child";
		await service.createRoot(owner, rootInput(rootEventId));
		await service.createEvent(owner, rootEventId, rootEventId, {
			...rootInput(childEventId),
			kind: "session",
			title: "Session",
		});
		await sql`
			INSERT INTO event_memberships (root_event_id, user_id, role, status)
			VALUES (${rootEventId}, ${participant.id}, 'participant', 'active')
		`;
		await service.createPlace(owner, rootEventId, {
			id: "plc_cap_venue01",
			name: "Venue",
			locality: "Zurich",
			countryCode: "CH",
			latitude: null,
			longitude: null,
		});
		await service.replaceCapability(owner, rootEventId, childEventId, 0, {
			type: "team",
			schemaVersion: 1,
			config: {
				venuePlaceId: "plc_cap_venue01",
				assignmentMode: "organizer",
				capacityPerTeam: 6,
				facilitator: null,
			},
		});
		const participantBootstrap = await service.syncBootstrap(
			participant,
			rootEventId,
			undefined,
			200,
		);
		expect(
			participantBootstrap.records.some(
				(record) =>
					record.entityType === "capability" &&
					record.entityId === `${childEventId}:team`,
			),
		).toBe(true);
		expect(
			participantBootstrap.records.some(
				(record) =>
					record.entityType === "place" &&
					record.entityId === "plc_cap_venue01",
			),
		).toBe(true);

		await service.updateEvent(owner, rootEventId, childEventId, 1, {
			status: "draft",
		});
		await expect(
			service.syncPull(
				participant,
				rootEventId,
				participantBootstrap.syncCursor,
				50,
			),
		).rejects.toMatchObject({ status: 410, code: "CURSOR_EXPIRED" });
		expect(
			(await service.getRoot(participant, rootEventId)).capabilities,
		).toEqual([]);
		expect((await service.listPlaces(participant, rootEventId)).items).toEqual(
			[],
		);
		await service.updateEvent(owner, rootEventId, childEventId, 2, {
			status: "published",
		});
		expect(
			(await service.getRoot(participant, rootEventId)).capabilities,
		).toHaveLength(1);
		await service.removeCapability(owner, rootEventId, childEventId, "team", 1);
		const [audience] = await sql<{ audience: string; operation: string }[]>`
			SELECT audience, operation FROM event_root_changes
			WHERE root_event_id = ${rootEventId} AND entity_type = 'capability'
			ORDER BY root_revision DESC, ordinal DESC LIMIT 1
		`;
		expect(audience).toEqual({ audience: "members", operation: "tombstone" });

		const syncRoot = "evt_cap_push01";
		await service.createRoot(owner, rootInput(syncRoot));
		const bootstrap = await service.syncBootstrap(
			owner,
			syncRoot,
			undefined,
			200,
		);
		const app = testApp();
		const push = async (body: unknown, key: string) => {
			const response = await app.request("/v1/sync/push", {
				method: "POST",
				headers: commandAuth(owner.id, key),
				body: JSON.stringify(body),
			});
			return { response, body: await response.json() };
		};
		const deviceId = "dvc_00000000-0000-4000-8000-000000000091";
		const replaced = await push(
			{
				protocolVersion: 1,
				rootEventId: syncRoot,
				deviceId,
				mutations: [
					{
						clientMutationId: "00000000-0000-4000-8000-000000000091",
						clientSequence: 1,
						kind: "capability.replace",
						entityId: `${syncRoot}:travel`,
						baseVersion: 0,
						payload: {
							eventId: syncRoot,
							type: "travel",
							schemaVersion: 1,
							config: {
								homePlaceId: null,
								travelerReferenceLabel: "Reference",
							},
						},
					},
				],
			},
			"sync-capability-replace-01",
		);
		expect(replaced.response.status).toBe(200);
		expect(replaced.body.results[0]).toMatchObject({
			outcome: "applied",
			entity: {
				entityType: "capability",
				entityId: `${syncRoot}:travel`,
				version: 1,
			},
		});
		const pullAfterReplace = await service.syncPull(
			owner,
			syncRoot,
			bootstrap.syncCursor,
			50,
		);
		expect(pullAfterReplace.changes[0]).toMatchObject({
			entityType: "capability",
			operation: "upsert",
		});
		const removed = await push(
			{
				protocolVersion: 1,
				rootEventId: syncRoot,
				deviceId,
				mutations: [
					{
						clientMutationId: "00000000-0000-4000-8000-000000000092",
						clientSequence: 2,
						kind: "capability.remove",
						entityId: `${syncRoot}:travel`,
						baseVersion: 1,
						payload: { eventId: syncRoot, type: "travel" },
					},
				],
			},
			"sync-capability-remove-01",
		);
		expect(removed.body.results[0]).toMatchObject({ outcome: "applied" });
		const pullAfterRemove = await service.syncPull(
			owner,
			syncRoot,
			pullAfterReplace.checkpointCursor,
			50,
		);
		expect(pullAfterRemove.changes[0]).toMatchObject({
			entityType: "capability",
			operation: "tombstone",
			tombstone: { eventId: syncRoot, type: "travel", version: 2 },
		});
	});

	test("serializes concurrent capability references against event and place tombstones", async () => {
		const rootEventId = "evt_cap_race_root";
		const eventId = "evt_cap_race_event";
		const placeEventId = "evt_cap_race_place_event";
		const placeId = "plc_cap_race_place";
		await service.createRoot(owner, rootInput(rootEventId));
		await service.createEvent(owner, rootEventId, rootEventId, {
			...rootInput(eventId),
			kind: "session",
		});
		await service.createEvent(owner, rootEventId, rootEventId, {
			...rootInput(placeEventId),
			kind: "session",
		});
		await service.createPlace(owner, rootEventId, {
			id: placeId,
			name: "Race venue",
			locality: "Zurich",
			countryCode: "CH",
			latitude: null,
			longitude: null,
		});

		const eventInserted = Promise.withResolvers<void>();
		const releaseEventInsert = Promise.withResolvers<void>();
		const eventInsert = sql.begin(async (transaction) => {
			const tx = transaction as unknown as Sql;
			await tx`
				INSERT INTO event_capabilities (
					root_event_id, event_id, capability_type, schema_version, config
				) VALUES (
					${rootEventId}, ${eventId}, 'travel', 1,
					'{"homePlaceId":null,"travelerReferenceLabel":null}'::jsonb
				)
			`;
			eventInserted.resolve();
			await releaseEventInsert.promise;
		});
		await eventInserted.promise;
		let eventTombstoneSettled = false;
		const eventTombstone = Promise.resolve(sql`
			UPDATE events SET status = 'archived', deleted_at = now()
			WHERE root_event_id = ${rootEventId} AND id = ${eventId}
		`);
		void eventTombstone
			.finally(() => {
				eventTombstoneSettled = true;
			})
			.catch(() => {});
		await Bun.sleep(20);
		expect(eventTombstoneSettled).toBe(false);
		releaseEventInsert.resolve();
		await eventInsert;
		await expectSqlState("23514", () => eventTombstone);

		const placeInserted = Promise.withResolvers<void>();
		const releasePlaceInsert = Promise.withResolvers<void>();
		const placeInsert = sql.begin(async (transaction) => {
			const tx = transaction as unknown as Sql;
			await tx`
				INSERT INTO event_capabilities (
					root_event_id, event_id, capability_type, schema_version, config
				) VALUES (
					${rootEventId}, ${placeEventId}, 'team', 1,
					jsonb_build_object(
						'assignmentMode', 'organizer',
						'capacityPerTeam', null,
						'facilitator', null,
						'venuePlaceId', ${placeId}::text
					)
				)
			`;
			placeInserted.resolve();
			await releasePlaceInsert.promise;
		});
		await placeInserted.promise;
		let placeTombstoneSettled = false;
		const placeTombstone = Promise.resolve(sql`
			UPDATE event_places SET deleted_at = now()
			WHERE root_event_id = ${rootEventId} AND id = ${placeId}
		`);
		void placeTombstone
			.finally(() => {
				placeTombstoneSettled = true;
			})
			.catch(() => {});
		await Bun.sleep(20);
		expect(placeTombstoneSettled).toBe(false);
		releasePlaceInsert.resolve();
		await placeInsert;
		await expectSqlState("23514", () => placeTombstone);

		const [proof] = await sql<
			{
				eventDeleted: boolean;
				placeDeleted: boolean;
				liveCapabilities: number;
			}[]
		>`
			SELECT
				(SELECT deleted_at IS NOT NULL FROM events
					WHERE root_event_id = ${rootEventId} AND id = ${eventId}) AS "eventDeleted",
				(SELECT deleted_at IS NOT NULL FROM event_places
					WHERE root_event_id = ${rootEventId} AND id = ${placeId}) AS "placeDeleted",
				(SELECT count(*)::int FROM event_capabilities
					WHERE root_event_id = ${rootEventId} AND deleted_at IS NULL) AS "liveCapabilities"
		`;
		expect(proof).toEqual({
			eventDeleted: false,
			placeDeleted: false,
			liveCapabilities: 2,
		});
	});
});

function testApp() {
	return createApp({
		service,
		verifyUserToken: async (token) => ({ id: token }),
	});
}

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

function rootInput(id: string): EventInput {
	return {
		id,
		kind: "team_event",
		title: "Root",
		description: null,
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		status: "published",
	};
}

function templateRoot(
	id: string,
	kind: EventInput["kind"],
	templateId: string,
	eventIds: Record<string, string>,
) {
	return {
		id,
		kind,
		title: "Template root",
		description: null,
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		status: "draft",
		template: { id: templateId, version: 1, eventIds },
	};
}

function golfCapability(
	coursePlaceId: string,
): Extract<CapabilityInput, { type: "golf" }> {
	return {
		type: "golf",
		schemaVersion: 1,
		config: {
			coursePlaceId,
			teeFormat: "individual",
			handicapMode: "optional",
			scoringMode: "stableford",
			roundState: "planned",
		},
	};
}

function itineraryInput(
	id: string,
	eventId: string,
	details: ItineraryInput["details"],
): ItineraryInput {
	return {
		id,
		eventId,
		title: "Dependent item",
		notes: null,
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		allDay: false,
		status: "active",
		details,
		placeId: null,
	};
}

async function expectSqlState(code: string, work: () => PromiseLike<unknown>) {
	try {
		await work();
		throw new Error(`Expected PostgreSQL error ${code}`);
	} catch (error) {
		expect(error).toMatchObject({ code });
	}
}
