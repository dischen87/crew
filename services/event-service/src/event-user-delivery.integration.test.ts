import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPair } from "jose";
import postgres, { type Sql } from "postgres";
import { migrate as migrateUser } from "../../user-service/scripts/migrate";
import { createApp as createUserApp } from "../../user-service/src/app";
import { createTokenService } from "../../user-service/src/auth";
import { createDeliveryPayloadKeyring } from "../../user-service/src/delivery-payload";
import { PostgresUserRepository } from "../../user-service/src/postgres-repository";
import { createPushPayloadKeyring } from "../../user-service/src/push-payload";
import { MemoryAuthRateLimiter } from "../../user-service/src/rate-limit";
import { createEventNotificationServiceAuth } from "../../user-service/src/service-auth";
import { migrate as migrateEvent } from "../scripts/migrate";
import { createApp as createEventApp } from "./app";
import { EventNotificationIngressClient } from "./event-notification-ingress";
import { PostgresEventNotificationOutbox } from "./event-notification-outbox";
import { EventNotificationPayloadCodec } from "./event-notification-payload";
import { createEventNotificationWorker } from "./event-notification-worker";
import { PostgresEventRepository } from "./postgres-repository";
import { EventService } from "./service";
import { installPublishedRootFixtures } from "./test-published-root-fixture";

const EXPECTED_EVENT_DATABASE = "crew_event_user_composition_event_test";
const EXPECTED_USER_DATABASE = "crew_event_user_composition_user_test";
const configuredEventDatabaseUrl =
	Bun.env.EVENT_USER_COMPOSITION_EVENT_DATABASE_URL;
const configuredUserDatabaseUrl =
	Bun.env.EVENT_USER_COMPOSITION_USER_DATABASE_URL;
const ownerId = "usr_00000000000000000000000000000001";
const acceptedUserId = "usr_00000000000000000000000000000002";
const suppressedUserId = "usr_00000000000000000000000000000003";
const serviceAuth = {
	id: "composition-service-v1",
	key: "BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ",
};
const notificationPayloadKey = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI";
const pushPayloadKey = "TxsYmFtlYMVPT1UZKmSGicjfoc8lhZ0kGQ3FgIZavhs";
const deliveryPayloadKey = "eKOfuEuHFGQeOZltcgU4hlzp3jYpRNrp3xvjzwjJkSE";

if (!configuredEventDatabaseUrl || !configuredUserDatabaseUrl) {
	test.skip(`Event-to-User delivery composition (set EVENT_USER_COMPOSITION_EVENT_DATABASE_URL to ${EXPECTED_EVENT_DATABASE} and EVENT_USER_COMPOSITION_USER_DATABASE_URL to ${EXPECTED_USER_DATABASE})`, () => {});
} else {
	const eventDatabaseUrl = configuredEventDatabaseUrl;
	const userDatabaseUrl = configuredUserDatabaseUrl;

	describe("Event-to-User delivery composition against two PostgreSQL databases", () => {
		let eventSql: Sql;
		let userSql: Sql;

		beforeAll(async () => {
			expect(databaseName(eventDatabaseUrl)).toBe(EXPECTED_EVENT_DATABASE);
			expect(databaseName(userDatabaseUrl)).toBe(EXPECTED_USER_DATABASE);
			expect(eventDatabaseUrl).not.toBe(userDatabaseUrl);

			eventSql = postgres(eventDatabaseUrl, { max: 8, onnotice: () => {} });
			userSql = postgres(userDatabaseUrl, { max: 8, onnotice: () => {} });
			const [eventDatabase, userDatabase] = await Promise.all([
				eventSql<{ name: string }[]>`
					SELECT current_database() AS name
				`,
				userSql<{ name: string }[]>`
					SELECT current_database() AS name
				`,
			]);
			expect([...eventDatabase]).toEqual([{ name: EXPECTED_EVENT_DATABASE }]);
			expect([...userDatabase]).toEqual([{ name: EXPECTED_USER_DATABASE }]);

			await Promise.all([migrateEvent(eventSql), migrateUser(userSql)]);
			await Promise.all([
				eventSql`
					TRUNCATE event_notification_outbox, event_idempotency_records,
						event_roots CASCADE
				`,
				userSql`
					TRUNCATE user_idempotency_records, user_push_outbox, users CASCADE
				`,
			]);
		});

		afterAll(async () => {
			await eventSql?.end();
			await userSql?.end();
		});

		test("retries lost committed 202 and 204 responses without duplicate receipts or fanout", async () => {
			const now = new Date();
			await userSql`
				INSERT INTO users (id, email, email_verified_at, created_at)
				VALUES
					(${acceptedUserId}, 'accepted@composition.example', ${now}, ${now}),
					(${suppressedUserId}, 'suppressed@composition.example', ${now}, ${now})
			`;
			await userSql`
				INSERT INTO user_profiles (user_id, event_reminders, updated_at)
				VALUES
					(${acceptedUserId}, TRUE, ${now}),
					(${suppressedUserId}, TRUE, ${now})
			`;
			await userSql`
				INSERT INTO user_devices (
					id, user_id, installation_id, platform, push_token, locale,
					time_zone, app_version, notifications_enabled, updated_at
				) VALUES (
					'dev_00000000000000000000000000000001', ${acceptedUserId},
					'composition-installation-1', 'ios', 'composition-provider-token-1',
					'de-CH', 'Europe/Zurich', '1.0.0', TRUE, ${now}
				)
			`;

			const rsa = await generateKeyPair("RS256", { modulusLength: 2048 });
			const userApp = createUserApp({
				repository: new PostgresUserRepository(userSql),
				tokens: await createTokenService(rsa.privateKey, rsa.publicKey, {
					issuer: "crew-user-service",
					audience: "crew-mobile",
					keyId: "composition-user-rsa",
					accessTokenTtlSeconds: 600,
				}),
				deliveryPayloads: createDeliveryPayloadKeyring({
					current: { id: "composition-delivery", key: deliveryPayloadKey },
				}),
				pushPayloads: createPushPayloadKeyring({
					current: { id: "composition-push", key: pushPayloadKey },
				}),
				eventNotificationServiceVerifier: createEventNotificationServiceAuth({
					issuer: "crew-event-service",
					audience: "crew-user-service",
					current: serviceAuth,
				}),
				authRateLimiter: new MemoryAuthRateLimiter(
					{
						magicRequest: { windowMs: 60_000 },
						magicRedeem: { windowMs: 60_000 },
						refresh: { windowMs: 60_000 },
					},
					100,
				),
				magicLinkTtlSeconds: 600,
				refreshTokenTtlSeconds: 3_600,
				refreshTokenKey:
					"composition-refresh-token-key-with-at-least-32-characters",
				idempotencyPayloadKeys: {
					current: {
						id: "composition-idempotency-v1",
						key: "composition-idempotency-key-with-at-least-32-characters",
					},
				},
			});
			const userServer = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch: (request) => userApp.fetch(request),
			});

			const codec = new EventNotificationPayloadCodec({
				kid: "composition-notification",
				key: notificationPayloadKey,
			});
			const eventService = new EventService(
				new PostgresEventRepository(eventSql, codec),
				"composition-invitation-key-with-at-least-32-characters",
			);
			installPublishedRootFixtures(eventService, eventSql);
			const eventApp = createEventApp({
				service: eventService,
				verifyUserToken: async (token) => ({ id: token }),
			});
			const eventServer = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch: (request) => eventApp.fetch(request),
			});

			try {
				const eventUrl = `http://127.0.0.1:${eventServer.port}`;
				await createNotification(
					eventService,
					eventUrl,
					"evt_composition_202",
					"fed_composition_202",
					acceptedUserId,
					"composition.cause.202",
				);
				await createNotification(
					eventService,
					eventUrl,
					"evt_composition_204",
					"fed_composition_204",
					suppressedUserId,
					"composition.cause.204",
				);

				const jobs = await eventSql<
					{
						id: string;
						payloadKid: string;
						payloadCiphertext: string;
						expiresAt: Date;
					}[]
				>`
					SELECT id, payload_kid AS "payloadKid",
						payload_ciphertext AS "payloadCiphertext",
						expires_at AS "expiresAt"
					FROM event_notification_outbox ORDER BY id
				`;
				expect(jobs).toHaveLength(2);
				const jobByRecipient = new Map(
					jobs.map((job) => [
						codec.open(
							job.id,
							job.payloadKid,
							job.payloadCiphertext,
							job.expiresAt.toISOString(),
						).recipientUserId,
						job.id,
					]),
				);
				const acceptedJobId = requiredJob(jobByRecipient, acceptedUserId);
				const suppressedJobId = requiredJob(jobByRecipient, suppressedUserId);
				const attempts: DeliveryAttempt[] = [];
				const lostResponses = new Set<string>();
				const lossyFetch = (async (
					input: Parameters<typeof fetch>[0],
					init?: Parameters<typeof fetch>[1],
				) => {
					const headers = new Headers(init?.headers);
					const jobId = headers.get("idempotency-key");
					if (!jobId || typeof init?.body !== "string") {
						throw new Error("Expected a canonical notification request");
					}
					const response = await fetch(input, init);
					attempts.push({
						jobId,
						requestId: headers.get("x-request-id"),
						causationRequestId: headers.get("x-causation-request-id"),
						body: init.body,
						status: response.status,
						replayed: response.headers.get("idempotency-replayed"),
					});
					if (!lostResponses.has(jobId)) {
						lostResponses.add(jobId);
						await response.arrayBuffer();
						throw new TypeError("simulated committed response loss");
					}
					return response;
				}) as typeof fetch;
				const ingress = new EventNotificationIngressClient(
					{
						baseUrl: `http://127.0.0.1:${userServer.port}`,
						timeoutMs: 1_000,
						issuer: "crew-event-service",
						audience: "crew-user-service",
						serviceAuthKeyId: serviceAuth.id,
						serviceAuthKey: serviceAuth.key,
					},
					lossyFetch,
				);
				const worker = createEventNotificationWorker(
					{
						workerId: "composition-worker",
						pollIntervalMs: 50,
						leaseMs: 5_000,
						timeoutMs: 1_000,
						maxAttempts: 3,
						baseBackoffMs: 100,
						maxBackoffMs: 1_000,
					},
					new PostgresEventNotificationOutbox(eventSql),
					codec,
					ingress,
				);

				expect(await worker.processOne()).toBe(true);
				expect(await worker.processOne()).toBe(true);
				const retrying = await eventSql<
					{ id: string; status: string; attempts: number }[]
				>`
					SELECT id, status, attempts FROM event_notification_outbox
					ORDER BY id
				`;
				expect([...retrying]).toEqual(
					jobs.map(({ id }) => ({ id, status: "retry", attempts: 1 })),
				);
				await eventSql`
					UPDATE event_notification_outbox
					SET available_at = clock_timestamp() WHERE status = 'retry'
				`;
				expect(await worker.processOne()).toBe(true);
				expect(await worker.processOne()).toBe(true);

				assertExactRetry(
					attempts.filter(({ jobId }) => jobId === acceptedJobId),
					acceptedJobId,
					"composition.cause.202",
					202,
				);
				assertExactRetry(
					attempts.filter(({ jobId }) => jobId === suppressedJobId),
					suppressedJobId,
					"composition.cause.204",
					204,
				);

				const eventProof = await eventSql<
					{
						id: string;
						status: string;
						attempts: number;
						outcomeCode: string;
					}[]
				>`
					SELECT id, status, attempts, outcome_code AS "outcomeCode"
					FROM event_notification_outbox ORDER BY id
				`;
				expect([...eventProof]).toEqual(
					[
						{
							id: acceptedJobId,
							status: "delivered",
							attempts: 2,
							outcomeCode: "NOTIFICATION_ACCEPTED",
						},
						{
							id: suppressedJobId,
							status: "suppressed",
							attempts: 2,
							outcomeCode: "NOTIFICATION_SUPPRESSED",
						},
					].sort((left, right) => left.id.localeCompare(right.id)),
				);
				const receiptProof = await userSql<
					{ id: string; status: number; receipts: number }[]
				>`
					SELECT idempotency_key AS id, response_status::int AS status,
						count(*)::int AS receipts
					FROM user_idempotency_records
					WHERE operation_id = 'identityEventNotificationsCreate'
						AND idempotency_key IN ${userSql([acceptedJobId, suppressedJobId])}
					GROUP BY idempotency_key, response_status ORDER BY idempotency_key
				`;
				expect([...receiptProof]).toEqual(
					[
						{ id: acceptedJobId, status: 202, receipts: 1 },
						{ id: suppressedJobId, status: 204, receipts: 1 },
					].sort((left, right) => left.id.localeCompare(right.id)),
				);
				const fanoutProof = await userSql<{ id: string; fanout: number }[]>`
					SELECT event_job_id AS id, count(*)::int AS fanout
					FROM user_push_outbox
					WHERE event_job_id IN ${userSql([acceptedJobId, suppressedJobId])}
					GROUP BY event_job_id ORDER BY event_job_id
				`;
				expect([...fanoutProof]).toEqual([{ id: acceptedJobId, fanout: 1 }]);
			} finally {
				eventServer.stop(true);
				userServer.stop(true);
			}
		});

		async function createNotification(
			eventService: EventService,
			eventUrl: string,
			rootEventId: string,
			feedEntryId: string,
			recipientUserId: string,
			causationRequestId: string,
		) {
			const root = await eventService.createRoot(
				{ id: ownerId },
				{
					id: rootEventId,
					kind: "team_event",
					title: rootEventId,
					description: null,
					timeZone: "Europe/Zurich",
					startsAt: null,
					endsAt: null,
					status: "published",
				},
			);
			expect(root.status).toBe("published");
			await eventSql`
				INSERT INTO event_memberships (root_event_id, user_id, role, status)
				VALUES (${rootEventId}, ${recipientUserId}, 'participant', 'active')
			`;
			const feed = await fetch(
				`${eventUrl}/v1/event-roots/${rootEventId}/feed`,
				{
					method: "POST",
					headers: commandHeaders(
						`composition-feed-${feedEntryId}`,
						causationRequestId,
					),
					body: JSON.stringify({
						id: feedEntryId,
						eventId: null,
						parentEntryId: null,
						kind: "message",
						body: "Composition proof",
					}),
				},
			);
			expect(feed.status).toBe(201);
		}
	});
}

type DeliveryAttempt = {
	jobId: string;
	requestId: string | null;
	causationRequestId: string | null;
	body: string;
	status: number;
	replayed: string | null;
};

function databaseName(databaseUrl: string) {
	return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\/+/, ""));
}

function requiredJob(jobs: Map<string, string>, recipientUserId: string) {
	const id = jobs.get(recipientUserId);
	if (!id) throw new Error("Expected one event notification job per recipient");
	return id;
}

function commandHeaders(idempotencyKey: string, requestId: string) {
	return {
		Authorization: `Bearer ${ownerId}`,
		"Content-Type": "application/json",
		"Idempotency-Key": idempotencyKey,
		"X-Request-ID": requestId,
	};
}

function assertExactRetry(
	attempts: DeliveryAttempt[],
	jobId: string,
	causationRequestId: string,
	status: 202 | 204,
) {
	expect(attempts).toHaveLength(2);
	expect(attempts.map((attempt) => attempt.jobId)).toEqual([jobId, jobId]);
	expect(attempts.map((attempt) => attempt.requestId)).toEqual([jobId, jobId]);
	expect(attempts.map((attempt) => attempt.causationRequestId)).toEqual([
		causationRequestId,
		causationRequestId,
	]);
	expect(new Set(attempts.map((attempt) => attempt.body)).size).toBe(1);
	expect(attempts.map((attempt) => attempt.status)).toEqual([status, status]);
	expect(attempts.map((attempt) => attempt.replayed)).toEqual([null, "true"]);
}
