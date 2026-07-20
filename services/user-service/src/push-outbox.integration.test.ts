import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { generateKeyPair } from "jose";
import postgres, { type Sql } from "postgres";
import { migrate } from "../scripts/migrate";
import { type AppDependencies, createApp } from "./app";
import { createTokenService, type TokenService } from "./auth";
import { createDeliveryPayloadKeyring } from "./delivery-payload";
import { PostgresUserRepository } from "./postgres-repository";
import {
	PostgresPushOutboxRepository,
	PushDeliveryWorker,
} from "./push-outbox";
import {
	createPushPayloadKeyring,
	type PushPayloadKeyring,
} from "./push-payload";
import { MemoryAuthRateLimiter } from "./rate-limit";
import type {
	IdempotencyInput,
	IdempotencyResult,
	StoredResponse,
	UserRepository,
} from "./repository";
import { PushFanoutLimitExceededError } from "./repository";
import {
	createEventNotificationServiceAuth,
	issueEventNotificationServiceToken,
} from "./service-auth";

const databaseUrl = Bun.env.USER_DATABASE_URL;
const key1 = "eKOfuEuHFGQeOZltcgU4hlzp3jYpRNrp3xvjzwjJkSE";
const key2 = "TxsYmFtlYMVPT1UZKmSGicjfoc8lhZ0kGQ3FgIZavhs";
const serviceKey = {
	id: "pg-event-service",
	key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};

if (!databaseUrl) {
	test.skip("Postgres push outbox (set USER_DATABASE_URL)", () => {});
} else {
	describe("Postgres event-notification ingress and push outbox", () => {
		let sql: Sql;
		let tokens: TokenService;
		let serviceToken: string;
		let clock: Date;
		const users = new Set<string>();
		const eventJobs = new Set<string>();
		const payloads = createPushPayloadKeyring({
			current: { id: "push-k1", key: key1 },
		});

		beforeAll(async () => {
			sql = postgres(databaseUrl, { max: 30 });
			await migrate(sql);
			const keys = await generateKeyPair("RS256");
			tokens = await createTokenService(keys.privateKey, keys.publicKey, {
				issuer: "crew-user-service",
				audience: "crew-mobile",
				keyId: "push-pg-test",
				accessTokenTtlSeconds: 900,
			});
			serviceToken = await issueEventNotificationServiceToken({
				issuer: "crew-event-service",
				audience: "crew-user-service",
				key: serviceKey,
			});
		});

		afterEach(async () => {
			if (eventJobs.size > 0) {
				const ids = [...eventJobs];
				await sql`DELETE FROM user_push_outbox WHERE event_job_id IN ${sql(ids)}`;
				await sql`
					DELETE FROM user_idempotency_records
					WHERE operation_id = 'identityEventNotificationsCreate'
						AND idempotency_key IN ${sql(ids)}
				`;
			}
			if (users.size > 0) {
				await sql`DELETE FROM users WHERE id IN ${sql([...users])}`;
			}
			eventJobs.clear();
			users.clear();
		});

		afterAll(async () => {
			await sql.end();
		});

		test("atomically stores two ciphertext jobs with exact 202/204 replay and no false 202", async () => {
			clock = new Date();
			const recipient = await createRecipient(2);
			const app = appWith(new PostgresUserRepository(sql), payloads);
			const eventJobId = trackedId("job");

			const wrongToken = await issueEventNotificationServiceToken({
				issuer: "crew-event-service",
				audience: "wrong-target",
				key: serviceKey,
			});
			const denied = await requestIngress(app, eventJobId, recipient.userId, {
				authorization: `Bearer ${wrongToken}`,
			});
			expect(denied.status).toBe(401);
			expect(await idempotencyCount(eventJobId)).toBe(0);

			const accepted = await requestIngress(app, eventJobId, recipient.userId);
			expect(accepted.status).toBe(202);
			expect(await accepted.json()).toEqual({
				accepted: true,
				queuedDevices: 2,
			});
			const rows = await sql<
				{
					id: string;
					deviceId: string;
					requestId: string;
					causationRequestId: string;
					sealedPayload: string;
					expiresAt: Date;
				}[]
			>`
				SELECT
					id,
					device_id AS "deviceId",
					request_id AS "requestId",
					causation_request_id AS "causationRequestId",
					sealed_payload AS "sealedPayload",
					expires_at AS "expiresAt"
				FROM user_push_outbox
				WHERE event_job_id = ${eventJobId}
				ORDER BY device_id
			`;
			expect(rows).toHaveLength(2);
			for (const row of rows) {
				expect(row.requestId).toBe(`ingress.${eventJobId}`);
				expect(row.causationRequestId).toBe(`cause.${eventJobId}`);
				const rendered = JSON.stringify(row);
				expect(rendered).not.toContain("provider-token");
				expect(rendered).not.toContain("event_starts_soon");
				expect(rendered).not.toContain("evt_private.root");
				const opened = payloads.open({
					jobId: row.id,
					eventJobId,
					recipientUserId: recipient.userId,
					deviceId: row.deviceId,
					requestId: row.requestId,
					causationRequestId: row.causationRequestId,
					expiresAt: row.expiresAt,
					sealedPayload: row.sealedPayload,
				});
				expect(opened.pushToken).toStartWith("provider-token-");
			}
			const [receipt] = await sql<{ responsePayload: string }[]>`
				SELECT response_payload AS "responsePayload"
				FROM user_idempotency_records
				WHERE operation_id = 'identityEventNotificationsCreate'
					AND idempotency_key = ${eventJobId}
			`;
			expect(receipt?.responsePayload).not.toContain("provider-token");
			expect(receipt?.responsePayload).not.toContain("evt_private.root");

			const replay = await requestIngress(app, eventJobId, recipient.userId, {
				requestId: "ingress.replay",
			});
			expect(replay.status).toBe(202);
			expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
			expect(replay.headers.get("X-Request-ID")).toBe("ingress.replay");
			expect(await outboxCount(eventJobId)).toBe(2);
			const mismatch = await requestIngress(app, eventJobId, recipient.userId, {
				category: "feed_update",
			});
			expect(mismatch.status).toBe(409);

			const noDeviceRecipient = await createRecipient(0);
			const suppressedJob = trackedId("job");
			expect(
				(await requestIngress(app, suppressedJob, noDeviceRecipient.userId))
					.status,
			).toBe(204);
			await insertDevice(noDeviceRecipient.userId, 99);
			const suppressedReplay = await requestIngress(
				app,
				suppressedJob,
				noDeviceRecipient.userId,
			);
			expect(suppressedReplay.status).toBe(204);
			expect(suppressedReplay.headers.get("Idempotency-Replayed")).toBe("true");
			expect(await outboxCount(suppressedJob)).toBe(0);

			const rollbackRecipient = await createRecipient(2);
			let seals = 0;
			const failingPayloads: PushPayloadKeyring = {
				seal(metadata, value) {
					seals += 1;
					if (seals === 2) throw new Error(`private ${value.pushToken}`);
					return payloads.seal(metadata, value);
				},
				open: payloads.open,
			};
			const rollbackJob = trackedId("job");
			const logs: unknown[][] = [];
			const original = console.error;
			console.error = (...args: unknown[]) => logs.push(args);
			try {
				const failed = await requestIngress(
					appWith(new PostgresUserRepository(sql), failingPayloads),
					rollbackJob,
					rollbackRecipient.userId,
				);
				expect(failed.status).toBe(500);
			} finally {
				console.error = original;
			}
			expect(await outboxCount(rollbackJob)).toBe(0);
			expect(await idempotencyCount(rollbackJob)).toBe(0);
			expect(JSON.stringify(logs)).not.toContain("provider-token");
		});

		test("proves concurrent replay and rejects fanout without truncation", async () => {
			clock = new Date();
			const recipient = await createRecipient(1);
			const delayed = new DelayedPostgresRepository(sql);
			const app = appWith(delayed, payloads);
			const eventJobId = trackedId("job");
			const first = requestIngress(app, eventJobId, recipient.userId);
			await delayed.started;
			const concurrent = await requestIngress(
				app,
				eventJobId,
				recipient.userId,
			);
			expect(concurrent.status).toBe(409);
			expect((await concurrent.json()).error.code).toBe(
				"IDEMPOTENCY_IN_PROGRESS",
			);
			delayed.release();
			expect((await first).status).toBe(202);
			expect(await outboxCount(eventJobId)).toBe(1);

			const amplified = await createRecipient(21);
			const cappedJob = trackedId("job");
			const capped = await requestIngress(
				appWith(new PostgresUserRepository(sql), payloads),
				cappedJob,
				amplified.userId,
			);
			expect(capped.status).toBe(409);
			expect((await capped.json()).error.code).toBe(
				"DEVICE_FANOUT_LIMIT_EXCEEDED",
			);
			expect(await outboxCount(cappedJob)).toBe(0);
			expect(await idempotencyCount(cappedJob)).toBe(1);
		});

		test("serializes device registration with the same per-user fanout admission lock", async () => {
			clock = new Date();
			const recipient = await createRecipient(20);
			const repository = new PostgresUserRepository(sql);
			const firstJob = trackedId("job");
			const firstLock = holdFanoutLock(recipient.userId);
			await firstLock.acquired;
			let enqueueSettled = false;
			const enqueue = repository
				.enqueuePushNotification({
					eventJobId: firstJob,
					recipientUserId: recipient.userId,
					category: "event_update",
					templateKey: "event_updated",
					deepLink: { rootEventId: "evt_lock.test" },
					expiresAt: new Date(clock.getTime() + 60_000),
					requestId: "fanout.lock.enqueue",
					causationRequestId: "fanout.lock.cause",
					createdAt: clock,
					payloads,
				})
				.then((value) => {
					enqueueSettled = true;
					return value;
				});
			await Bun.sleep(20);
			expect(enqueueSettled).toBe(false);
			firstLock.release();
			expect(await enqueue).toBe(20);
			await firstLock.done;

			const registrationLock = holdFanoutLock(recipient.userId);
			await registrationLock.acquired;
			let registrationSettled = false;
			const registration = repository
				.upsertDevice(
					recipient.userId,
					{
						installationId: `dvc_race_${crypto.randomUUID()}`,
						platform: "android",
						pushToken: `provider-token-race-${crypto.randomUUID()}`,
						locale: "de-CH",
						timeZone: "Europe/Zurich",
						appVersion: "1.0.0",
						notificationsEnabled: true,
					},
					clock,
				)
				.then((value) => {
					registrationSettled = true;
					return value;
				});
			await Bun.sleep(20);
			expect(registrationSettled).toBe(false);
			registrationLock.release();
			await registration;
			await registrationLock.done;

			const cappedJob = trackedId("job");
			await expect(
				repository.enqueuePushNotification({
					eventJobId: cappedJob,
					recipientUserId: recipient.userId,
					category: "event_update",
					templateKey: "event_updated",
					deepLink: { rootEventId: "evt_lock.test" },
					expiresAt: new Date(clock.getTime() + 60_000),
					requestId: "fanout.lock.capped",
					causationRequestId: "fanout.lock.cause",
					createdAt: clock,
					payloads,
				}),
			).rejects.toBeInstanceOf(PushFanoutLimitExceededError);
			expect(await outboxCount(cappedJob)).toBe(0);
		});

		test("claims disjoint jobs and fences expired owners and late acknowledgements", async () => {
			clock = new Date();
			const recipient = await createRecipient(2);
			const eventJobId = trackedId("job");
			const app = appWith(new PostgresUserRepository(sql), payloads);
			expect(
				(await requestIngress(app, eventJobId, recipient.userId)).status,
			).toBe(202);
			const left = new PostgresPushOutboxRepository(sql);
			const right = new PostgresPushOutboxRepository(sql);
			const [first, second] = await Promise.all([
				left.claimDue({
					workerId: "worker-left",
					now: clock,
					leaseMs: 1_000,
					limit: 1,
					maxAttempts: 5,
				}),
				right.claimDue({
					workerId: "worker-right",
					now: clock,
					leaseMs: 1_000,
					limit: 1,
					maxAttempts: 5,
				}),
			]);
			expect(first.jobs).toHaveLength(1);
			expect(second.jobs).toHaveLength(1);
			expect(first.jobs[0]?.id).not.toBe(second.jobs[0]?.id);

			clock = new Date(clock.getTime() + 1_001);
			const replacement = await right.claimDue({
				workerId: "worker-replacement",
				now: clock,
				leaseMs: 1_000,
				limit: 1,
				maxAttempts: 5,
			});
			expect(replacement.jobs).toHaveLength(1);
			const reclaimed = replacement.jobs[0];
			if (!reclaimed) throw new Error("Expected reclaimed push job");
			const originalWorker =
				reclaimed.id === first.jobs[0]?.id ? "worker-left" : "worker-right";
			expect(
				await left.complete({
					jobId: reclaimed.id,
					workerId: originalWorker,
					leaseFence:
						reclaimed.id === first.jobs[0]?.id
							? (first.jobs[0]?.leaseFence ?? "0")
							: (second.jobs[0]?.leaseFence ?? "0"),
				}),
			).toBe(false);
			expect(
				await right.complete({
					jobId: reclaimed.id,
					workerId: "worker-replacement",
					leaseFence: reclaimed.leaseFence,
				}),
			).toBe(true);
		});

		test("never sends when eligibility unblocks after the old lease expires", async () => {
			clock = new Date();
			const recipient = await createRecipient(1);
			const eventJobId = trackedId("job");
			const app = appWith(new PostgresUserRepository(sql), payloads);
			expect(
				(await requestIngress(app, eventJobId, recipient.userId)).status,
			).toBe(202);

			let markProfileLocked: (() => void) | undefined;
			let releaseProfile: (() => void) | undefined;
			const profileLocked = new Promise<void>((resolve) => {
				markProfileLocked = resolve;
			});
			const profileReleased = new Promise<void>((resolve) => {
				releaseProfile = resolve;
			});
			const blocker = sql.begin(async (transaction) => {
				const tx = transaction as unknown as Sql;
				await tx`
					SELECT user_id
					FROM user_profiles
					WHERE user_id = ${recipient.userId}
					FOR UPDATE
				`;
				markProfileLocked?.();
				await profileReleased;
			});
			await profileLocked;

			const repository = new PostgresPushOutboxRepository(sql);
			let providerCalls = 0;
			const oldWorker = pushWorker(
				repository,
				payloads,
				async () => {
					providerCalls += 1;
				},
				{ deliveryTimeoutMs: 10, leaseMs: 400 },
			);
			const oldRun = oldWorker.runOnce();
			await waitFor(async () => {
				const [row] = await sql<{ state: string }[]>`
					SELECT state
					FROM user_push_outbox
					WHERE event_job_id = ${eventJobId}
				`;
				return row?.state === "processing";
			});
			await Bun.sleep(450);
			releaseProfile?.();
			await blocker;
			expect(await oldRun).toMatchObject({
				delivered: 0,
				staleResults: 1,
			});
			expect(providerCalls).toBe(0);
			const [stale] = await sql<{ state: string; leaseFence: string }[]>`
				SELECT state, lease_fence::text AS "leaseFence"
				FROM user_push_outbox
				WHERE event_job_id = ${eventJobId}
			`;
			expect(stale).toEqual({ state: "processing", leaseFence: "1" });

			clock = new Date();
			const replacement = pushWorker(
				repository,
				payloads,
				async () => {
					providerCalls += 1;
				},
				{ deliveryTimeoutMs: 10, leaseMs: 400 },
			);
			expect(await replacement.runOnce()).toMatchObject({ delivered: 1 });
			expect(providerCalls).toBe(1);
			const [delivered] = await sql<{ state: string; leaseFence: string }[]>`
				SELECT state, lease_fence::text AS "leaseFence"
				FROM user_push_outbox
				WHERE event_job_id = ${eventJobId}
			`;
			expect(delivered).toEqual({ state: "delivered", leaseFence: "3" });
		});

		test("suppresses disabled, removed, rotated and opted-out recipients before provider IO", async () => {
			clock = new Date();
			const cases: Array<{
				recipient: Awaited<ReturnType<typeof createRecipient>>;
				jobId: string;
			}> = [];
			const app = appWith(new PostgresUserRepository(sql), payloads);
			for (let index = 0; index < 4; index += 1) {
				const recipient = await createRecipient(1);
				const jobId = trackedId("job");
				expect(
					(await requestIngress(app, jobId, recipient.userId)).status,
				).toBe(202);
				cases.push({ recipient, jobId });
			}
			await sql`
				UPDATE user_devices
				SET notifications_enabled = FALSE
				WHERE id = ${cases[0]?.recipient.devices[0]?.id ?? ""}
			`;
			await sql`
				DELETE FROM user_devices
				WHERE id = ${cases[1]?.recipient.devices[0]?.id ?? ""}
			`;
			await sql`
				UPDATE user_devices
				SET push_token = ${`rotated-${crypto.randomUUID()}`}
				WHERE id = ${cases[2]?.recipient.devices[0]?.id ?? ""}
			`;
			await sql`
				UPDATE user_profiles
				SET event_reminders = FALSE
				WHERE user_id = ${cases[3]?.recipient.userId ?? ""}
			`;
			let providerCalls = 0;
			const worker = pushWorker(
				new PostgresPushOutboxRepository(sql),
				payloads,
				async () => {
					providerCalls += 1;
				},
			);
			const stats = await worker.runOnce();
			expect(stats).toMatchObject({ claimed: 4, suppressed: 4, delivered: 0 });
			expect(providerCalls).toBe(0);
			const states = await sql<{ state: string; outcomeCode: string }[]>`
				SELECT state, outcome_code AS "outcomeCode"
				FROM user_push_outbox
				WHERE event_job_id IN ${sql(cases.map(({ jobId }) => jobId))}
			`;
			expect(states).toHaveLength(4);
			expect(states.every(({ state }) => state === "suppressed")).toBe(true);
			expect(
				states.every(
					({ outcomeCode }) => outcomeCode === "recipient_ineligible",
				),
			).toBe(true);
		});

		test("retries accept-then-timeout with one stable provider dedupe key", async () => {
			clock = new Date();
			const recipient = await createRecipient(1);
			const eventJobId = trackedId("job");
			const app = appWith(new PostgresUserRepository(sql), payloads);
			expect(
				(await requestIngress(app, eventJobId, recipient.userId)).status,
			).toBe(202);
			const calls: string[] = [];
			const accepted = new Set<string>();
			let logicalAccepts = 0;
			const sender: ConstructorParameters<
				typeof PushDeliveryWorker
			>[0]["sendPushNotification"] = async ({ deliveryKey, signal }) => {
				calls.push(deliveryKey);
				if (accepted.has(deliveryKey)) return;
				accepted.add(deliveryKey);
				logicalAccepts += 1;
				await new Promise<void>((resolve) =>
					signal?.addEventListener("abort", () => resolve(), { once: true }),
				);
			};
			const repository = new PostgresPushOutboxRepository(sql);
			const first = pushWorker(repository, payloads, sender, {
				deliveryTimeoutMs: 10,
				leaseMs: 500,
				random: () => 0.5,
			});
			expect(await first.runOnce()).toMatchObject({ retried: 1 });
			clock = new Date(clock.getTime() + 1_001);
			const second = pushWorker(repository, payloads, sender, {
				deliveryTimeoutMs: 10,
				leaseMs: 500,
				random: () => 0.5,
			});
			expect(await second.runOnce()).toMatchObject({ delivered: 1 });
			expect(calls).toHaveLength(2);
			expect(new Set(calls).size).toBe(1);
			expect(logicalAccepts).toBe(1);
		});

		test("survives KID rollout and permanently rejects invalid ciphertext", async () => {
			clock = new Date();
			const recipient = await createRecipient(1);
			const apiPayloads = createPushPayloadKeyring({
				current: { id: "push-k2", key: key2 },
			});
			const eventJobId = trackedId("job");
			expect(
				(
					await requestIngress(
						appWith(new PostgresUserRepository(sql), apiPayloads),
						eventJobId,
						recipient.userId,
					)
				).status,
			).toBe(202);
			const oldWorkerPayloads = createPushPayloadKeyring({
				current: { id: "push-k1", key: key1 },
			});
			let providerCalls = 0;
			const repository = new PostgresPushOutboxRepository(sql);
			expect(
				await pushWorker(repository, oldWorkerPayloads, async () => {
					providerCalls += 1;
				}).runOnce(),
			).toMatchObject({ retried: 1 });
			const [skewed] = await sql<
				{ state: string; attemptCount: number; outcomeCode: string }[]
			>`
				SELECT
					state,
					attempt_count AS "attemptCount",
					outcome_code AS "outcomeCode"
				FROM user_push_outbox
				WHERE event_job_id = ${eventJobId}
			`;
			expect(skewed).toEqual({
				state: "pending",
				attemptCount: 0,
				outcomeCode: "payload_key_unavailable",
			});
			expect(providerCalls).toBe(0);

			clock = new Date(clock.getTime() + 10_001);
			const rotatedPayloads = createPushPayloadKeyring({
				current: { id: "push-k2", key: key2 },
				previous: { id: "push-k1", key: key1 },
			});
			expect(
				await pushWorker(repository, rotatedPayloads, async () => {
					providerCalls += 1;
				}).runOnce(),
			).toMatchObject({ delivered: 1 });
			expect(providerCalls).toBe(1);

			const invalidRecipient = await createRecipient(1);
			const invalidJob = trackedId("job");
			expect(
				(
					await requestIngress(
						appWith(new PostgresUserRepository(sql), rotatedPayloads),
						invalidJob,
						invalidRecipient.userId,
					)
				).status,
			).toBe(202);
			await sql`
				UPDATE user_push_outbox
				SET sealed_payload = 'v1.push-k2.bad.bad.bad'
				WHERE event_job_id = ${invalidJob}
			`;
			expect(
				await pushWorker(repository, rotatedPayloads, async () => {
					providerCalls += 1;
				}).runOnce(),
			).toMatchObject({ deadLettered: 1 });
			const [invalid] = await sql<{ state: string; outcomeCode: string }[]>`
				SELECT state, outcome_code AS "outcomeCode"
				FROM user_push_outbox
				WHERE event_job_id = ${invalidJob}
			`;
			expect(invalid).toEqual({
				state: "dead_letter",
				outcomeCode: "payload_invalid",
			});
			expect(providerCalls).toBe(1);
		});

		function appWith(
			repository: UserRepository,
			pushPayloads: PushPayloadKeyring,
		) {
			const dependencies: AppDependencies = {
				repository,
				tokens,
				deliveryPayloads: createDeliveryPayloadKeyring({
					current: { id: "delivery-pg", key: key1 },
				}),
				pushPayloads,
				eventNotificationServiceVerifier: createEventNotificationServiceAuth({
					issuer: "crew-event-service",
					audience: "crew-user-service",
					current: serviceKey,
				}),
				authRateLimiter: new MemoryAuthRateLimiter(
					{
						magicRequest: { windowMs: 60_000 },
						magicRedeem: { windowMs: 60_000 },
						refresh: { windowMs: 60_000 },
					},
					100,
				),
				magicLinkTtlSeconds: 900,
				refreshTokenTtlSeconds: 2_592_000,
				refreshTokenKey: "push-pg-refresh-key-at-least-32-bytes",
				idempotencyPayloadKeys: {
					current: {
						id: "push-pg-idempotency-v1",
						key: "push-pg-idempotency-payload-key-at-least-32-bytes",
					},
				},
				now: () => new Date(clock),
			};
			return createApp(dependencies);
		}

		async function createRecipient(deviceCount: number) {
			const userId = trackedId("usr");
			await sql`
				INSERT INTO users (id, email, email_verified_at, created_at)
				VALUES (${userId}, ${`${userId}@example.com`}, ${clock}, ${clock})
			`;
			await sql`
				INSERT INTO user_profiles (user_id, updated_at)
				VALUES (${userId}, ${clock})
			`;
			const devices = [];
			for (let index = 0; index < deviceCount; index += 1) {
				devices.push(await insertDevice(userId, index));
			}
			return { userId, devices };
		}

		async function insertDevice(userId: string, sequence: number) {
			const id = idFor("dev");
			const pushToken = `provider-token-${id}-${sequence}`;
			await sql`
				INSERT INTO user_devices (
					id,
					user_id,
					installation_id,
					platform,
					push_token,
					locale,
					time_zone,
					app_version,
					notifications_enabled,
					updated_at
				)
				VALUES (
					${id},
					${userId},
					${`dvc_${id}_${sequence}`},
					'ios',
					${pushToken},
					'de-CH',
					'Europe/Zurich',
					'1.0.0',
					TRUE,
					${clock}
				)
			`;
			return { id, pushToken };
		}

		async function requestIngress(
			app: ReturnType<typeof createApp>,
			eventJobId: string,
			recipientUserId: string,
			overrides: {
				authorization?: string;
				requestId?: string;
				category?: "event_reminder" | "feed_update";
			} = {},
		) {
			return app.request("/internal/v1/event-notifications", {
				method: "POST",
				headers: {
					Authorization: overrides.authorization ?? `Bearer ${serviceToken}`,
					"Content-Type": "application/json",
					"Idempotency-Key": eventJobId,
					"X-Request-ID": overrides.requestId ?? `ingress.${eventJobId}`,
					"X-Causation-Request-ID": `cause.${eventJobId}`,
				},
				body: JSON.stringify({
					recipientUserId,
					category: overrides.category ?? "event_reminder",
					templateKey: "event_starts_soon",
					deepLink: {
						rootEventId: "evt_private.root",
						eventId: "evt_child:one",
					},
					expiresAt: new Date(clock.getTime() + 60_000).toISOString(),
				}),
			});
		}

		function pushWorker(
			repository: PostgresPushOutboxRepository,
			workerPayloads: PushPayloadKeyring,
			sendPushNotification: ConstructorParameters<
				typeof PushDeliveryWorker
			>[0]["sendPushNotification"],
			overrides: Partial<
				ConstructorParameters<typeof PushDeliveryWorker>[0]
			> = {},
		) {
			return new PushDeliveryWorker({
				repository,
				payloads: workerPayloads,
				sendPushNotification,
				workerId: `push-worker-${crypto.randomUUID()}`,
				batchSize: 20,
				leaseMs: 10_000,
				deliveryTimeoutMs: 1_000,
				maxAttempts: 3,
				baseBackoffMs: 1_000,
				maxBackoffMs: 10_000,
				now: () => new Date(clock),
				...overrides,
			});
		}

		function trackedId(prefix: "usr" | "job") {
			const id = idFor(prefix);
			if (prefix === "usr") users.add(id);
			else eventJobs.add(id);
			return id;
		}

		async function outboxCount(eventJobId: string) {
			const [row] = await sql<{ count: number }[]>`
				SELECT count(*)::int AS count
				FROM user_push_outbox
				WHERE event_job_id = ${eventJobId}
			`;
			return row?.count ?? 0;
		}

		async function idempotencyCount(eventJobId: string) {
			const [row] = await sql<{ count: number }[]>`
				SELECT count(*)::int AS count
				FROM user_idempotency_records
				WHERE operation_id = 'identityEventNotificationsCreate'
					AND idempotency_key = ${eventJobId}
			`;
			return row?.count ?? 0;
		}

		function holdFanoutLock(userId: string) {
			let markAcquired: (() => void) | undefined;
			let unlock: (() => void) | undefined;
			const acquired = new Promise<void>((resolve) => {
				markAcquired = resolve;
			});
			const released = new Promise<void>((resolve) => {
				unlock = resolve;
			});
			const done = sql.begin(async (transaction) => {
				const tx = transaction as unknown as Sql;
				await tx`
					SELECT pg_advisory_xact_lock(
						hashtextextended(${`crew:user-service:push-fanout:${userId}`}, 0)
					)
				`;
				markAcquired?.();
				await released;
			});
			return { acquired, done, release: () => unlock?.() };
		}

		async function waitFor(predicate: () => Promise<boolean>) {
			for (let attempt = 0; attempt < 100; attempt += 1) {
				if (await predicate()) return;
				await Bun.sleep(5);
			}
			throw new Error("Timed out waiting for Postgres state");
		}
	});
}

function idFor(prefix: string) {
	return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

class DelayedPostgresRepository extends PostgresUserRepository {
	private markStarted: (() => void) | undefined;
	private resume: (() => void) | undefined;
	readonly started = new Promise<void>((resolve) => {
		this.markStarted = resolve;
	});
	private readonly released = new Promise<void>((resolve) => {
		this.resume = resolve;
	});

	release() {
		this.resume?.();
	}

	override executeIdempotent(
		input: IdempotencyInput,
		operation: (repository: UserRepository) => Promise<StoredResponse>,
	): Promise<IdempotencyResult> {
		return super.executeIdempotent(input, async (repository) => {
			this.markStarted?.();
			await this.released;
			return operation(repository);
		});
	}
}
