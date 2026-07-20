import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPair } from "jose";
import postgres, { type Sql } from "postgres";
import { createApp as createGatewayApp } from "../services/api-gateway/src/app";
import { loadConfig as loadGatewayConfig } from "../services/api-gateway/src/config";
import { MemoryRateLimiter } from "../services/api-gateway/src/security";
import { migrate as migrateEvent } from "../services/event-service/scripts/migrate";
import { createApp as createEventApp } from "../services/event-service/src/app";
import { createJwtVerifier as createEventJwtVerifier } from "../services/event-service/src/auth";
import { EventNotificationPayloadCodec } from "../services/event-service/src/event-notification-payload";
import {
	type PlaceSearchResult,
	PlaceSearchService,
} from "../services/event-service/src/place-search";
import { PostgresEventRepository } from "../services/event-service/src/postgres-repository";
import { EventService } from "../services/event-service/src/service";
import { migrate as migrateUser } from "../services/user-service/scripts/migrate";
import { createApp as createUserApp } from "../services/user-service/src/app";
import { createTokenService } from "../services/user-service/src/auth";
import { createWebhookMagicLinkSender } from "../services/user-service/src/delivery";
import {
	MagicLinkDeliveryWorker,
	PostgresDeliveryOutboxRepository,
} from "../services/user-service/src/delivery-outbox";
import { createDeliveryPayloadKeyring } from "../services/user-service/src/delivery-payload";
import { PostgresUserRepository } from "../services/user-service/src/postgres-repository";
import { createPushPayloadKeyring } from "../services/user-service/src/push-payload";
import { MemoryAuthRateLimiter } from "../services/user-service/src/rate-limit";
import { createEventNotificationServiceAuth } from "../services/user-service/src/service-auth";
import {
	bootstrapFixture,
	type FixtureOfflineFlow,
	fixtureOfflineFlows,
} from "./bootstrap-fixture";
import { createProviderSinkHandler } from "./provider-sink";

const userDatabaseUrl = Bun.env.FIXTURE_USER_DATABASE_URL;
const eventDatabaseUrl = Bun.env.FIXTURE_EVENT_DATABASE_URL;
const issuer = "crew-fixture-user-service";
const audience = "crew-fixture-mobile";
const userIdPattern = /^usr_[a-f0-9]{32}$/;
const deliveryKey = "eKOfuEuHFGQeOZltcgU4hlzp3jYpRNrp3xvjzwjJkSE";
const pushKey = "TxsYmFtlYMVPT1UZKmSGicjfoc8lhZ0kGQ3FgIZavhs";
const serviceKey = "BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ";
const deliveryBearer = "fixture-delivery-bearer-2026";
const fixtureBearer = "fixture-consumer-bearer-2026";
const belekCourses = [
	course(
		"pcd_1e13ca178f90af118e97f076d7d6811c707d37c293d1bc5fa92f653f66f2e92d",
		"Carya Golf Club",
		"way/169450196",
		36.8665457,
		31.0116798,
	),
	course(
		"pcd_a28d40b066df83f51263114f4643e913abe67eb9e8463e9a1e56c77c491d4013",
		"Gloria Golf Club",
		"way/169451380",
		36.8483584,
		31.0950659,
	),
	course(
		"pcd_08cff91c182b33817c8536a8c55bfd540268b289414922a9dc078146fc594894",
		"The Montgomerie Maxx Royal Golf Club",
		"way/169451379",
		36.8549985,
		31.0650442,
	),
	course(
		"pcd_1ea7bde672b7f92d70ecff1c7b09e86efca6f6ff936c2035adeb917948cf779d",
		"National Golf Club",
		"way/126258746",
		36.8694094,
		30.9831748,
	),
	course(
		"pcd_3f08b614bbee6d3665cae3efb205dd95685f40d9b22e4d0fe82fc074bf793fd8",
		"Sueno Hotels Golf Belek",
		"relation/3872398",
		36.8620925,
		31.0347405,
	),
];

function course(
	id: string,
	name: string,
	sourceRecordId: string,
	latitude: number,
	longitude: number,
): PlaceSearchResult {
	return {
		id,
		kind: "golf_course",
		name,
		locality: "Belek",
		region: "Antalya",
		countryCode: "TR",
		latitude,
		longitude,
		status: "pending",
		source: "osm",
		sourceRecordUrl: `https://www.openstreetmap.org/${sourceRecordId}`,
		licenseCode: "ODbL-1.0",
		licenseUrl: "https://www.openstreetmap.org/copyright",
		attribution: "© OpenStreetMap contributors",
		retrievedAt: "2026-07-19T00:00:00.000Z",
		confidence: 0.9,
		version: 1,
	};
}

function expectedFlowTraces(flow: FixtureOfflineFlow) {
	return flow.phases.flatMap(({ action, requestId }) => {
		if (!requestId) return [];
		const operation = action.startsWith("sync.push")
			? "sync/push"
			: action === "sync.bootstrap"
				? "sync/bootstrap"
				: "sync/pull";
		return [{ operation, requestId }];
	});
}

export function assertFixtureTestDatabaseUrl(
	value: string,
	service: "user" | "event",
) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`Invalid ${service} fixture test database URL`);
	}
	const databaseName = `crew_fixture_${service}_test`;
	if (
		(url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
		!new Set(["localhost", "127.0.0.1", "[::1]"]).has(url.hostname) ||
		!new RegExp(`^/${databaseName}(?:_[a-z0-9_]+)?$`).test(url.pathname) ||
		url.search !== "" ||
		url.hash !== ""
	) {
		throw new Error(
			`${service} fixture database must be a loopback ${databaseName} database`,
		);
	}
	return value;
}

describe("fixture test database URL guard", () => {
	test("accepts only explicit loopback fixture-test databases", () => {
		for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
			const value = `postgres://fixture:secret@${host}:5432/crew_fixture_user_test_0711`;
			expect(assertFixtureTestDatabaseUrl(value, "user")).toBe(value);
		}
	});

	test("rejects remote, ordinary, cross-service and socket-overridden databases", () => {
		for (const value of [
			"postgres://fixture:secret@db.internal/crew_fixture_user_test_0711",
			"postgres://fixture:secret@localhost/crew_user",
			"postgres://fixture:secret@localhost/crew_fixture_event_test_0711",
			"postgres:///crew_fixture_user_test_0711?host=/var/run/postgresql",
			"postgres://fixture:secret@localhost/crew_fixture_user_test_0711?host=/var/run/postgresql",
		]) {
			expect(() => assertFixtureTestDatabaseUrl(value, "user")).toThrow(
				"fixture",
			);
		}
	});
});

if (!userDatabaseUrl || !eventDatabaseUrl) {
	test.skip("API fixtures through gateway E2E (set FIXTURE_USER_DATABASE_URL and FIXTURE_EVENT_DATABASE_URL)", () => {});
} else {
	describe("API fixtures through real gateway and owning services", () => {
		let userSql: Sql;
		let eventSql: Sql;
		let userServer: ReturnType<typeof Bun.serve>;
		let eventServer: ReturnType<typeof Bun.serve>;
		let gateway: ReturnType<typeof createGatewayApp>;
		let deliveryWorker: MagicLinkDeliveryWorker;
		let provider: ReturnType<typeof createProviderSinkHandler>;
		const downstreamTraces: {
			service: "user-service" | "event-service";
			path: string;
			requestId: string | null;
		}[] = [];
		const gatewayTraces: {
			path: string;
			requestId: string | null;
			responseRequestId: string | null;
		}[] = [];
		const resetFixtureState = async () => {
			await userSql`
					TRUNCATE user_idempotency_records, user_delivery_outbox,
						user_push_outbox, users CASCADE
				`;
			await eventSql`TRUNCATE event_idempotency_records, event_roots CASCADE`;
			downstreamTraces.length = 0;
			gatewayTraces.length = 0;
		};
		const fixtureFetch = async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			const request = new Request(input, init);
			const url = new URL(request.url);
			if (url.hostname === "api-gateway") {
				const requestId = request.headers.get("X-Request-ID");
				const response = await gateway.fetch(request);
				const responseRequestId = response.headers.get("X-Request-ID");
				gatewayTraces.push({
					path: url.pathname,
					requestId,
					responseRequestId,
				});
				expect(responseRequestId).toBe(requestId);
				return response;
			}
			if (url.hostname === "provider-sink") {
				await deliveryWorker.runOnce();
				return provider(request);
			}
			throw new Error(`Unexpected fixture origin ${url.origin}`);
		};

		beforeAll(async () => {
			const safeUserDatabaseUrl = assertFixtureTestDatabaseUrl(
				userDatabaseUrl,
				"user",
			);
			const safeEventDatabaseUrl = assertFixtureTestDatabaseUrl(
				eventDatabaseUrl,
				"event",
			);
			userSql = postgres(safeUserDatabaseUrl, { max: 8 });
			eventSql = postgres(safeEventDatabaseUrl, { max: 12 });
			await migrateUser(userSql);
			await migrateEvent(eventSql);
			await resetFixtureState();

			const rsa = await generateKeyPair("RS256", { modulusLength: 2048 });
			const tokens = await createTokenService(rsa.privateKey, rsa.publicKey, {
				issuer,
				audience,
				keyId: "fixture-rsa-1",
				accessTokenTtlSeconds: 600,
			});
			const deliveryPayloads = createDeliveryPayloadKeyring({
				current: { id: "fixture-delivery-1", key: deliveryKey },
			});
			const userApp = createUserApp({
				repository: new PostgresUserRepository(userSql),
				tokens,
				deliveryPayloads,
				pushPayloads: createPushPayloadKeyring({
					current: { id: "fixture-push-1", key: pushKey },
				}),
				eventNotificationServiceVerifier: createEventNotificationServiceAuth({
					issuer: "crew-event-service",
					audience: "crew-user-service",
					current: { id: "fixture-service-1", key: serviceKey },
				}),
				authRateLimiter: new MemoryAuthRateLimiter(
					{
						magicRequest: { windowMs: 60_000 },
						magicRedeem: { windowMs: 60_000 },
						refresh: { windowMs: 60_000 },
					},
					1_000,
				),
				clientKey: () => "198.51.100.77",
				magicLinkTtlSeconds: 600,
				refreshTokenTtlSeconds: 3_600,
				refreshTokenKey:
					"fixture-refresh-token-key-with-at-least-32-characters",
				idempotencyPayloadKeys: {
					current: {
						id: "fixture-idempotency-v1",
						key: "fixture-idempotency-key-with-at-least-32-characters",
					},
				},
			});
			userServer = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch: (request) => userApp.fetch(request),
			});
			const userUrl = `http://127.0.0.1:${userServer.port}`;
			const jwksUrl = `${userUrl}/.well-known/jwks.json`;

			const eventApp = createEventApp({
				service: new EventService(
					new PostgresEventRepository(
						eventSql,
						new EventNotificationPayloadCodec({
							kid: "fixture-notification-1",
							key: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
						}),
					),
					"fixture-invitation-key-with-at-least-32-characters",
				),
				placeSearch: new PlaceSearchService(
					{
						async search(input) {
							const query = input.query.toLowerCase();
							const aliases = [
								"carya",
								"gloria",
								"montgomerie",
								"national",
								"sueno",
							];
							const index = aliases.findIndex((alias) => query.includes(alias));
							const match = belekCourses[index];
							return { items: match ? [match] : [], found: match ? 1 : 0 };
						},
					},
					"fixture-place-search-cursor-key-2026",
				),
				verifyUserToken: createEventJwtVerifier({
					jwksUrl,
					issuer,
					audience,
					cacheMaxAge: 60_000,
					cooldownDuration: 1_000,
					timeoutDuration: 2_000,
				}),
			});
			eventServer = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch: (request) => eventApp.fetch(request),
			});
			const eventUrl = `http://127.0.0.1:${eventServer.port}`;
			gateway = createGatewayApp({
				rateLimiter: new MemoryRateLimiter(1_000, 60_000, 1_000),
				config: loadGatewayConfig({
					USER_SERVICE_URL: userUrl,
					EVENT_SERVICE_URL: eventUrl,
					USER_SERVICE_JWKS_URL: jwksUrl,
					USER_TOKEN_ISSUER: issuer,
					USER_TOKEN_AUDIENCE: audience,
					JWKS_CACHE_MS: "60000",
					JWKS_COOLDOWN_MS: "1000",
					JWKS_TIMEOUT_MS: "2000",
					DOWNSTREAM_TIMEOUT_MS: "5000",
					RATE_LIMIT_MAX: "1000",
					RATE_LIMIT_MAX_ENTRIES: "1000",
				}),
				clientIp: () => "198.51.100.77",
				fetch: async (input, init) => {
					const request = new Request(input, init);
					const url = new URL(request.url);
					downstreamTraces.push({
						service: url.origin === userUrl ? "user-service" : "event-service",
						path: url.pathname,
						requestId: request.headers.get("X-Request-ID"),
					});
					return fetch(request);
				},
			});

			provider = createProviderSinkHandler({
				deliveryBearer,
				fixtureBearer,
				log: () => {},
			});
			const providerFetch = Object.assign(
				(input: string | URL | Request, init?: RequestInit) =>
					provider(new Request(input, init)),
				{ preconnect: fetch.preconnect },
			);
			deliveryWorker = new MagicLinkDeliveryWorker({
				repository: new PostgresDeliveryOutboxRepository(userSql),
				payloads: deliveryPayloads,
				sendMagicLink: createWebhookMagicLinkSender({
					endpoint: "http://provider-sink:3010/magic-links",
					bearer: deliveryBearer,
					appUrl: "http://crew.local/auth/redeem",
					timeoutMs: 2_000,
					fetch: providerFetch,
				}),
				workerId: "fixture-e2e-worker",
				batchSize: 10,
				leaseMs: 5_000,
				deliveryTimeoutMs: 2_000,
				maxAttempts: 3,
				baseBackoffMs: 100,
				maxBackoffMs: 1_000,
			});
		});

		afterAll(async () => {
			userServer?.stop(true);
			eventServer?.stop(true);
			await userSql?.end();
			await eventSql?.end();
		});

		test("persists one complete non-travel team day through public contracts", async () => {
			const traceRequestId = "fixture.team.trace.auth-start.v1";
			const traceResponse = await gateway.fetch(
				new Request("http://api-gateway:3000/core/v1/auth/magic-links", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Idempotency-Key": traceRequestId,
						"X-Request-ID": traceRequestId,
					},
					body: JSON.stringify({ email: "trace.probe@example.test" }),
				}),
			);
			expect(traceResponse.status).toBe(202);
			expect(traceResponse.headers.get("X-Request-ID")).toBe(traceRequestId);
			await traceResponse.body?.cancel();
			expect(
				downstreamTraces.filter(
					({ requestId }) => requestId === traceRequestId,
				),
			).toEqual([
				{
					service: "user-service",
					path: "/v1/auth/magic-links",
					requestId: traceRequestId,
				},
			]);

			const result = await bootstrapFixture(
				{
					gatewayUrl: "http://api-gateway:3000/core/v1/",
					providerSinkUrl: "http://provider-sink:3010/",
					providerSinkFixtureBearer: fixtureBearer,
					localFixtureEnabled: true,
					scenario: "team-event",
				},
				{
					fetch: fixtureFetch,
					sleep: async () => {},
				},
			);
			expect(result.rootEventId).toBe("evt_local_team_day_2026");
			expect(result.eventIds).toHaveLength(8);
			expect(result.userId).toMatch(userIdPattern);
			expect(result.participantUserId).toMatch(userIdPattern);
			expect(result.participantUserId).not.toBe(result.userId);
			expect(JSON.stringify(result)).not.toContain("token");

			const [proof] = await eventSql<
				{
					events: number;
					rootStatus: string;
					rootVersion: number;
					createdStatus: string;
					memberships: number;
					participants: number;
					places: number;
					itinerary: number;
					invitations: number;
					usedInvitations: number;
					decisionEntries: number;
					participantEntries: number;
					teamCapabilities: number;
					travelCapabilities: number;
					publishCommands: number;
					publishEntries: number;
				}[]
			>`
				SELECT
					(SELECT count(*)::int FROM events WHERE root_event_id = ${result.rootEventId}) AS events,
					(SELECT status FROM events WHERE root_event_id = ${result.rootEventId} AND id = ${result.rootEventId}) AS "rootStatus",
					(SELECT version FROM events WHERE root_event_id = ${result.rootEventId} AND id = ${result.rootEventId}) AS "rootVersion",
					(SELECT response_body -> 'event' ->> 'status' FROM event_idempotency_records WHERE actor_id = ${result.userId} AND operation_id = 'eventsCreate') AS "createdStatus",
					(SELECT count(*)::int FROM event_memberships WHERE root_event_id = ${result.rootEventId} AND status = 'active') AS memberships,
					(SELECT count(*)::int FROM event_memberships WHERE root_event_id = ${result.rootEventId} AND role = 'participant' AND status = 'active') AS participants,
					(SELECT count(*)::int FROM event_places WHERE root_event_id = ${result.rootEventId} AND deleted_at IS NULL) AS places,
					(SELECT count(*)::int FROM event_itinerary_items WHERE root_event_id = ${result.rootEventId} AND deleted_at IS NULL) AS itinerary,
					(SELECT count(*)::int FROM event_invitations WHERE root_event_id = ${result.rootEventId} AND status = 'active') AS invitations,
					(SELECT count(*)::int FROM event_invitations WHERE root_event_id = ${result.rootEventId} AND use_count = 1) AS "usedInvitations",
					(SELECT count(*)::int FROM event_feed_entries WHERE root_event_id = ${result.rootEventId} AND id = 'fed_local_team_day_decisions' AND kind = 'message') AS "decisionEntries",
					(SELECT count(*)::int FROM event_feed_entries WHERE root_event_id = ${result.rootEventId} AND id = 'fed_local_team_day_participant_android_offline' AND author_user_id = ${result.participantUserId}) AS "participantEntries",
					(SELECT count(*)::int FROM event_capabilities WHERE root_event_id = ${result.rootEventId} AND capability_type = 'team' AND deleted_at IS NULL) AS "teamCapabilities",
					(SELECT count(*)::int FROM event_capabilities WHERE root_event_id = ${result.rootEventId} AND capability_type IN ('travel', 'golf') AND deleted_at IS NULL) AS "travelCapabilities",
					(SELECT count(*)::int FROM event_idempotency_records WHERE actor_id = ${result.userId} AND operation_id = 'eventsPublish') AS "publishCommands",
					(SELECT count(*)::int FROM event_feed_entries entry
						JOIN event_feed_entry_current current
							ON current.root_event_id = entry.root_event_id
							AND current.entry_id = entry.id
						WHERE entry.root_event_id = ${result.rootEventId}
							AND entry.kind = 'system'
							AND position('"type":"event.published"' in current.body) > 0
							AND position(${`"eventId":"${result.rootEventId}"`} in current.body) > 0) AS "publishEntries"
			`;
			expect(proof).toMatchObject({
				events: 8,
				rootStatus: "published",
				createdStatus: "draft",
				memberships: 2,
				participants: 1,
				places: 1,
				itinerary: 7,
				invitations: 1,
				usedInvitations: 1,
				decisionEntries: 1,
				participantEntries: 1,
				teamCapabilities: 1,
				travelCapabilities: 0,
				publishCommands: 1,
				publishEntries: 1,
			});
			expect(proof?.rootVersion).toBeGreaterThan(1);
			const publicationTraceIds = new Set([
				"fixture.team.event.create.v1",
				"fixture.team.event.create.replay.v1",
				"fixture.team.event.publish-readiness.v1",
				"fixture.team.event.publish.v1",
				"fixture.team.event.publish.replay.v1",
			]);
			expect(
				downstreamTraces.filter(({ requestId }) =>
					publicationTraceIds.has(String(requestId)),
				),
			).toEqual([
				{
					service: "event-service",
					path: "/v1/event-roots",
					requestId: "fixture.team.event.create.v1",
				},
				{
					service: "event-service",
					path: "/v1/event-roots",
					requestId: "fixture.team.event.create.replay.v1",
				},
				{
					service: "event-service",
					path: `/v1/event-roots/${result.rootEventId}/publish-readiness`,
					requestId: "fixture.team.event.publish-readiness.v1",
				},
				{
					service: "event-service",
					path: `/v1/event-roots/${result.rootEventId}/publish`,
					requestId: "fixture.team.event.publish.v1",
				},
				{
					service: "event-service",
					path: `/v1/event-roots/${result.rootEventId}/publish`,
					requestId: "fixture.team.event.publish.replay.v1",
				},
			]);
			const teamFlow = fixtureOfflineFlows("team-event").find(
				({ platform }) => platform === "android",
			);
			if (!teamFlow) throw new Error("Missing Team Android flow");
			const teamFlowTraces = expectedFlowTraces(teamFlow);
			const teamFlowRequestIds = new Set(
				teamFlowTraces.map(({ requestId }) => requestId),
			);
			expect(
				gatewayTraces.filter(({ requestId }) =>
					teamFlowRequestIds.has(String(requestId)),
				),
			).toEqual(
				teamFlowTraces.map(({ operation, requestId }) => ({
					path: `/core/v1/${operation}`,
					requestId,
					responseRequestId: requestId,
				})),
			);
			expect(
				downstreamTraces.filter(({ requestId }) =>
					teamFlowRequestIds.has(String(requestId)),
				),
			).toEqual(
				teamFlowTraces.map(({ operation, requestId }) => ({
					service: "event-service",
					path: `/v1/${operation}`,
					requestId,
				})),
			);
		});

		test("persists the deterministic Turkey golf tour with real roles and a playable scorecard", async () => {
			const result = await bootstrapFixture(
				{
					gatewayUrl: "http://api-gateway:3000/core/v1/",
					providerSinkUrl: "http://provider-sink:3010/",
					providerSinkFixtureBearer: fixtureBearer,
					localFixtureEnabled: true,
					scenario: "golf-tour",
				},
				{
					fetch: fixtureFetch,
					sleep: async () => {},
				},
			);
			expect(result.rootEventId).toBe("evt_local_turkey_golf_2026");
			expect(result.eventIds).toHaveLength(8);
			expect(result.userId).toMatch(userIdPattern);
			expect(result.organizerUserId).toMatch(userIdPattern);
			expect(result.participantUserId).toMatch(userIdPattern);
			expect(
				new Set([
					result.userId,
					result.organizerUserId,
					result.participantUserId,
				]).size,
			).toBe(3);
			expect(JSON.stringify(result)).not.toContain("token");
			expect(
				downstreamTraces.some(
					({ service, path, requestId }) =>
						service === "event-service" &&
						path === "/v1/places/search" &&
						requestId === "fixture.course.carya.search.v1",
				),
			).toBe(true);
			for (const [requestId, path] of [
				[
					"fixture.participant.itinerary.update.denied.v1",
					`/event-roots/${result.rootEventId}/itinerary/iti_local_turkey_golf_transfer_in`,
				],
				[
					"fixture.organizer.event.arrival.live-update.v1",
					`/event-roots/${result.rootEventId}/events/evt_local_turkey_golf_2026_arrival`,
				],
				[
					"fixture.organizer.event.arrival.live-update.replay.v1",
					`/event-roots/${result.rootEventId}/events/evt_local_turkey_golf_2026_arrival`,
				],
				[
					"fixture.organizer.itinerary.transfer.live-update.v1",
					`/event-roots/${result.rootEventId}/itinerary/iti_local_turkey_golf_transfer_in`,
				],
				[
					"fixture.organizer.itinerary.transfer.live-update.replay.v1",
					`/event-roots/${result.rootEventId}/itinerary/iti_local_turkey_golf_transfer_in`,
				],
				[
					"fixture.organizer.feed.transfer-update.create.v1",
					`/event-roots/${result.rootEventId}/feed`,
				],
				[
					"fixture.organizer.feed.transfer-update.create.replay.v1",
					`/event-roots/${result.rootEventId}/feed`,
				],
				[
					"fixture.participant.feed.transfer-update.react.v1",
					`/event-roots/${result.rootEventId}/feed/fed_local_turkey_golf_transfer_update/reaction`,
				],
				[
					"fixture.participant.feed.transfer-update.react.replay.v1",
					`/event-roots/${result.rootEventId}/feed/fed_local_turkey_golf_transfer_update/reaction`,
				],
				[
					"fixture.participant.itinerary.read.v1",
					`/event-roots/${result.rootEventId}/events/evt_local_turkey_golf_2026_arrival/itinerary`,
				],
				[
					"fixture.participant.feed.read.v1",
					`/event-roots/${result.rootEventId}/feed`,
				],
			] as const) {
				expect(gatewayTraces).toContainEqual({
					path: `/core/v1${path}`,
					requestId,
					responseRequestId: requestId,
				});
				expect(downstreamTraces).toContainEqual({
					service: "event-service",
					path: `/v1${path}`,
					requestId,
				});
			}

			const [proof] = await eventSql<
				{
					events: number;
					publishedEvents: number;
					memberships: number;
					organizers: number;
					participants: number;
					places: number;
					itinerary: number;
					invitations: number;
					usedInvitations: number;
					travelCapabilities: number;
					transportCapabilities: number;
					lodgingCapabilities: number;
					stablefordCapabilities: number;
					golfRounds: number;
					transfers: number;
					meals: number;
					licensedRoundNotes: number;
					golfRoundSetups: number;
					golfRoundHoles: number;
					golfRoundPlayers: number;
					golfRoundTeams: number;
					golfRoundTeamMembers: number;
					golfScores: number;
					participantStablefordPoints: number;
					arrivalEventVersion: number;
					arrivalDescription: string;
					transferVersion: number;
					transferNotes: string;
					liveFeedEntries: number;
					liveFeedReactions: number;
				}[]
			>`
					SELECT
						(SELECT count(*)::int FROM events WHERE root_event_id = ${result.rootEventId}) AS events,
						(SELECT count(*)::int FROM events WHERE root_event_id = ${result.rootEventId} AND status = 'published') AS "publishedEvents",
						(SELECT count(*)::int FROM event_memberships WHERE root_event_id = ${result.rootEventId} AND status = 'active') AS memberships,
						(SELECT count(*)::int FROM event_memberships WHERE root_event_id = ${result.rootEventId} AND role = 'organizer' AND status = 'active') AS organizers,
						(SELECT count(*)::int FROM event_memberships WHERE root_event_id = ${result.rootEventId} AND role = 'participant' AND status = 'active') AS participants,
						(SELECT count(*)::int FROM event_places WHERE root_event_id = ${result.rootEventId} AND deleted_at IS NULL) AS places,
						(SELECT count(*)::int FROM event_itinerary_items WHERE root_event_id = ${result.rootEventId} AND deleted_at IS NULL) AS itinerary,
						(SELECT count(*)::int FROM event_invitations WHERE root_event_id = ${result.rootEventId} AND status = 'active') AS invitations,
						(SELECT count(*)::int FROM event_invitations WHERE root_event_id = ${result.rootEventId} AND use_count = 1) AS "usedInvitations",
						(SELECT count(*)::int FROM event_capabilities WHERE root_event_id = ${result.rootEventId} AND capability_type = 'travel' AND deleted_at IS NULL) AS "travelCapabilities",
						(SELECT count(*)::int FROM event_capabilities WHERE root_event_id = ${result.rootEventId} AND capability_type = 'transport' AND deleted_at IS NULL) AS "transportCapabilities",
						(SELECT count(*)::int FROM event_capabilities WHERE root_event_id = ${result.rootEventId} AND capability_type = 'lodging' AND deleted_at IS NULL) AS "lodgingCapabilities",
						(SELECT count(*)::int FROM event_capabilities WHERE root_event_id = ${result.rootEventId} AND capability_type = 'golf' AND config->>'scoringMode' = 'stableford' AND deleted_at IS NULL) AS "stablefordCapabilities",
						(SELECT count(*)::int FROM event_itinerary_items WHERE root_event_id = ${result.rootEventId} AND details->>'type' = 'golf_round' AND deleted_at IS NULL) AS "golfRounds",
						(SELECT count(*)::int FROM event_itinerary_items WHERE root_event_id = ${result.rootEventId} AND details->>'type' = 'road_transfer' AND deleted_at IS NULL) AS transfers,
							(SELECT count(*)::int FROM event_itinerary_items WHERE root_event_id = ${result.rootEventId} AND details->>'type' = 'meal' AND deleted_at IS NULL) AS meals,
							(SELECT count(*)::int FROM event_itinerary_items WHERE root_event_id = ${result.rootEventId} AND details->>'type' = 'golf_round' AND notes LIKE '%OpenStreetMap contributors, ODbL-1.0.%' AND deleted_at IS NULL) AS "licensedRoundNotes",
							(SELECT count(*)::int FROM event_golf_rounds WHERE root_event_id = ${result.rootEventId}) AS "golfRoundSetups",
							(SELECT count(*)::int FROM event_golf_round_holes WHERE root_event_id = ${result.rootEventId}) AS "golfRoundHoles",
							(SELECT count(*)::int FROM event_golf_round_players WHERE root_event_id = ${result.rootEventId}) AS "golfRoundPlayers",
							(SELECT count(*)::int FROM event_golf_round_teams WHERE root_event_id = ${result.rootEventId}) AS "golfRoundTeams",
							(SELECT count(*)::int FROM event_golf_round_team_members WHERE root_event_id = ${result.rootEventId}) AS "golfRoundTeamMembers",
							(SELECT count(*)::int FROM event_golf_scores WHERE root_event_id = ${result.rootEventId}) AS "golfScores",
							(SELECT COALESCE(sum(stableford_points), 0)::int FROM event_golf_scores WHERE root_event_id = ${result.rootEventId} AND user_id = ${result.participantUserId}) AS "participantStablefordPoints",
							(SELECT version FROM events WHERE root_event_id = ${result.rootEventId} AND id = 'evt_local_turkey_golf_2026_arrival') AS "arrivalEventVersion",
							(SELECT description FROM events WHERE root_event_id = ${result.rootEventId} AND id = 'evt_local_turkey_golf_2026_arrival') AS "arrivalDescription",
							(SELECT version FROM event_itinerary_items WHERE root_event_id = ${result.rootEventId} AND id = 'iti_local_turkey_golf_transfer_in') AS "transferVersion",
							(SELECT notes FROM event_itinerary_items WHERE root_event_id = ${result.rootEventId} AND id = 'iti_local_turkey_golf_transfer_in') AS "transferNotes",
							(SELECT count(*)::int FROM event_feed_entries WHERE root_event_id = ${result.rootEventId} AND id = 'fed_local_turkey_golf_transfer_update' AND author_user_id = ${result.organizerUserId}) AS "liveFeedEntries",
							(SELECT count(*)::int FROM event_feed_reactions WHERE root_event_id = ${result.rootEventId} AND entry_id = 'fed_local_turkey_golf_transfer_update' AND user_id = ${result.participantUserId} AND reaction = 'celebrate' AND present) AS "liveFeedReactions"
					`;
			expect(proof).toEqual({
				events: 8,
				publishedEvents: 8,
				memberships: 3,
				organizers: 1,
				participants: 1,
				places: 9,
				itinerary: 11,
				invitations: 2,
				usedInvitations: 2,
				travelCapabilities: 1,
				transportCapabilities: 1,
				lodgingCapabilities: 1,
				stablefordCapabilities: 5,
				golfRounds: 5,
				transfers: 2,
				meals: 2,
				licensedRoundNotes: 5,
				golfRoundSetups: 1,
				golfRoundHoles: 18,
				golfRoundPlayers: 3,
				golfRoundTeams: 1,
				golfRoundTeamMembers: 3,
				golfScores: 1,
				participantStablefordPoints: 3,
				arrivalEventVersion: 5,
				arrivalDescription:
					"Organizer confirmed the Antalya arrival meeting point.",
				transferVersion: 2,
				transferNotes:
					"Meet at the arrivals group sign before the Belek transfer.",
				liveFeedEntries: 1,
				liveFeedReactions: 1,
			});
			const golfFlow = fixtureOfflineFlows("golf-tour").find(
				({ platform }) => platform === "ios",
			);
			if (!golfFlow) throw new Error("Missing Golf iOS flow");
			const golfFlowTraces = expectedFlowTraces(golfFlow);
			const golfFlowRequestIds = new Set(
				golfFlowTraces.map(({ requestId }) => requestId),
			);
			expect(
				gatewayTraces.filter(({ requestId }) =>
					golfFlowRequestIds.has(String(requestId)),
				),
			).toEqual(
				golfFlowTraces.map(({ operation, requestId }) => ({
					path: `/core/v1/${operation}`,
					requestId,
					responseRequestId: requestId,
				})),
			);
			expect(
				downstreamTraces.filter(({ requestId }) =>
					golfFlowRequestIds.has(String(requestId)),
				),
			).toEqual(
				golfFlowTraces.map(({ operation, requestId }) => ({
					service: "event-service",
					path: `/v1/${operation}`,
					requestId,
				})),
			);
		});

		test("supports clean setup-only handoff and explicit alternate platform flows", async () => {
			const run = (
				scenario: "golf-tour" | "team-event",
				offlineFlowPlatform: "ios" | "android" | null,
			) =>
				bootstrapFixture(
					{
						gatewayUrl: "http://api-gateway:3000/core/v1/",
						providerSinkUrl: "http://provider-sink:3010/",
						providerSinkFixtureBearer: fixtureBearer,
						localFixtureEnabled: true,
						offlineFlowPlatform,
						scenario,
					},
					{ fetch: fixtureFetch, sleep: async () => {} },
				);

			await resetFixtureState();
			const golfSetup = await run("golf-tour", null);
			if (!golfSetup.participantUserId) {
				throw new Error("Golf setup-only participant is missing");
			}
			const [golfSetupProof] = await eventSql<
				{ participantReceipts: number; scores: number }[]
			>`
					SELECT
						(SELECT count(*)::int FROM event_golf_scores WHERE root_event_id = ${golfSetup.rootEventId}) AS scores,
						(SELECT count(*)::int FROM event_sync_mutation_receipts WHERE root_event_id = ${golfSetup.rootEventId} AND actor_id = ${golfSetup.participantUserId}) AS "participantReceipts"
				`;
			expect(golfSetupProof).toEqual({ scores: 0, participantReceipts: 0 });
			expect(
				gatewayTraces.some(({ requestId }) =>
					String(requestId).startsWith("fixture.e2e.golf-tour."),
				),
			).toBe(false);

			await resetFixtureState();
			const teamSetup = await run("team-event", null);
			if (!teamSetup.participantUserId) {
				throw new Error("Team setup-only participant is missing");
			}
			const [teamSetupProof] = await eventSql<
				{ offlineEntries: number; participantReceipts: number }[]
			>`
					SELECT
						(SELECT count(*)::int FROM event_feed_entries WHERE root_event_id = ${teamSetup.rootEventId} AND id IN ('fed_local_team_day_participant_ios_offline', 'fed_local_team_day_participant_android_offline')) AS "offlineEntries",
						(SELECT count(*)::int FROM event_sync_mutation_receipts WHERE root_event_id = ${teamSetup.rootEventId} AND actor_id = ${teamSetup.participantUserId}) AS "participantReceipts"
				`;
			expect(teamSetupProof).toEqual({
				offlineEntries: 0,
				participantReceipts: 0,
			});

			for (const [scenario, platform] of [
				["golf-tour", "android"],
				["team-event", "ios"],
			] as const) {
				await resetFixtureState();
				const result = await run(scenario, platform);
				if (!result.participantUserId) {
					throw new Error(`${scenario} ${platform} participant is missing`);
				}
				const flow = fixtureOfflineFlows(scenario).find(
					(candidate) => candidate.platform === platform,
				);
				if (!flow) throw new Error(`${scenario} ${platform} flow is missing`);
				const [receipt] = await eventSql<
					{ clientMutationId: string; deviceId: string }[]
				>`
						SELECT client_mutation_id::text AS "clientMutationId",
							device_id AS "deviceId"
						FROM event_sync_mutation_receipts
						WHERE root_event_id = ${result.rootEventId}
							AND actor_id = ${result.participantUserId}
					`;
				expect(receipt).toEqual({
					clientMutationId: flow.clientMutationId,
					deviceId: flow.deviceId,
				});
				const expectedRequestIds = expectedFlowTraces(flow).map(
					({ requestId }) => requestId,
				);
				expect(
					gatewayTraces
						.filter(({ requestId }) =>
							expectedRequestIds.includes(String(requestId)),
						)
						.map(({ requestId, responseRequestId }) => ({
							requestId,
							responseRequestId,
						})),
				).toEqual(
					expectedRequestIds.map((requestId) => ({
						requestId,
						responseRequestId: requestId,
					})),
				);
			}
		});
	});
}
