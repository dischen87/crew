import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPair } from "jose";
import postgres, { type Sql } from "postgres";
import { migrate } from "../scripts/migrate";
import { createApp } from "./app";
import {
	createId,
	createOpaqueSecret,
	createTokenService,
	hashSecret,
} from "./auth";
import { MagicLinkDeliveryError } from "./delivery";
import {
	MagicLinkDeliveryWorker,
	PostgresDeliveryOutboxRepository,
} from "./delivery-outbox";
import {
	createDeliveryPayloadKeyring,
	type DeliveryPayloadKeyring,
} from "./delivery-payload";
import { PostgresUserRepository } from "./postgres-repository";
import { MemoryAuthRateLimiter } from "./rate-limit";

const databaseUrl = Bun.env.USER_DATABASE_URL;
const oldKey = "eKOfuEuHFGQeOZltcgU4hlzp3jYpRNrp3xvjzwjJkSE";
const newKey = "TxsYmFtlYMVPT1UZKmSGicjfoc8lhZ0kGQ3FgIZavhs";

if (!databaseUrl) {
	test.skip("Postgres delivery outbox (set USER_DATABASE_URL)", () => {});
} else {
	describe("Postgres delivery outbox", () => {
		let sql: Sql;
		let users: PostgresUserRepository;
		let outbox: PostgresDeliveryOutboxRepository;
		let tokens: Awaited<ReturnType<typeof createTokenService>>;
		const suffix = crypto.randomUUID();
		const emails = new Set<string>();
		const currentPayloads = createDeliveryPayloadKeyring({
			current: { id: "current", key: newKey },
		});

		beforeAll(async () => {
			sql = postgres(databaseUrl, { max: 20 });
			await migrate(sql);
			users = new PostgresUserRepository(sql);
			outbox = new PostgresDeliveryOutboxRepository(sql);
			const keys = await generateKeyPair("RS256");
			tokens = await createTokenService(keys.privateKey, keys.publicKey, {
				issuer: "crew-user-service",
				audience: "crew-mobile",
				keyId: "outbox-integration",
				accessTokenTtlSeconds: 900,
			});
		});

		afterAll(async () => {
			if (emails.size > 0) {
				await sql`DELETE FROM user_magic_links WHERE email IN ${sql([...emails])}`;
			}
			await sql`
				DELETE FROM user_idempotency_records
				WHERE idempotency_key LIKE ${`%${suffix}%`}
			`;
			await sql.end();
		});

		test("commits one ciphertext job with the exact 202 replay and rolls back atomically", async () => {
			const email = emailFor("atomic");
			const idempotencyKey = `outbox-${suffix}`;
			const app = createApp({
				repository: users,
				tokens,
				deliveryPayloads: currentPayloads,
				authRateLimiter: rateLimiter(),
				clientKey: () => "outbox-integration-client",
				magicLinkTtlSeconds: 900,
				refreshTokenTtlSeconds: 2_592_000,
				refreshTokenKey: "outbox-integration-refresh-key-at-least-32-bytes",
				idempotencyPayloadKeys: {
					current: {
						id: "outbox-idempotency-v1",
						key: "outbox-idempotency-payload-key-at-least-32-bytes",
					},
				},
			});
			const request = (requestId: string) =>
				app.request("/v1/auth/magic-links", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Idempotency-Key": idempotencyKey,
						"X-Request-ID": requestId,
					},
					body: JSON.stringify({ email }),
				});

			const first = await request("outbox.atomic.first");
			expect(first.status).toBe(202);
			expect(await first.json()).toEqual({ accepted: true });
			const replay = await request("outbox.atomic.replay");
			expect(replay.status).toBe(202);
			expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
			expect(replay.headers.get("X-Request-ID")).toBe("outbox.atomic.replay");
			expect(await replay.json()).toEqual({ accepted: true });

			const rows = await sql<
				{
					id: string;
					sealedPayload: string;
					expiresAt: Date;
					tokenHash: string;
				}[]
			>`
				SELECT
					jobs.id,
					jobs.sealed_payload AS "sealedPayload",
					jobs.token_expires_at AS "expiresAt",
					links.token_hash AS "tokenHash"
				FROM user_delivery_outbox AS jobs
				JOIN user_magic_links AS links ON links.id = jobs.magic_link_id
				WHERE links.email = ${email}
			`;
			expect(rows).toHaveLength(1);
			const row = rows[0];
			if (!row) throw new Error("Expected durable delivery job");
			const payload = currentPayloads.open({
				jobId: row.id,
				sealedPayload: row.sealedPayload,
				expiresAt: row.expiresAt,
			});
			expect(hashSecret(payload.token)).toBe(row.tokenHash);
			expect(row.sealedPayload).not.toContain(email);
			expect(row.sealedPayload).not.toContain(payload.token);
			expect(row.sealedPayload).not.toContain("auth/redeem");

			const rollbackEmail = emailFor("rollback");
			const rollback = deliveryInput(rollbackEmail, currentPayloads);
			await expect(
				users.executeIdempotent(
					{
						scope: `rollback:${suffix}`,
						operationId: "identityMagicLinksCreate",
						key: `rollback-${suffix}`,
						fingerprint: hashSecret(`rollback-${suffix}`),
						now: rollback.delivery.createdAt,
						expiresAt: new Date(
							rollback.delivery.createdAt.getTime() + 30 * 24 * 60 * 60 * 1_000,
						),
					},
					async (transaction) => {
						await transaction.createMagicLinkWithDelivery(rollback);
						throw new Error("rollback proof");
					},
				),
			).rejects.toThrow("rollback proof");
			const [rollbackCount] = await sql<{ count: number }[]>`
				SELECT count(*)::int AS count
				FROM user_magic_links
				WHERE email = ${rollbackEmail}
			`;
			expect(rollbackCount?.count).toBe(0);
			const [storedIdempotency] = await sql<{ idempotencyCount: number }[]>`
				SELECT count(*)::int AS "idempotencyCount"
				FROM user_idempotency_records
				WHERE idempotency_key = ${`rollback-${suffix}`}
			`;
			expect(storedIdempotency?.idempotencyCount).toBe(0);

			const rejectedEmail = emailFor("rejected-enqueue");
			const invalidApp = createApp({
				repository: users,
				tokens,
				deliveryPayloads: {
					seal: () => "not-ciphertext",
					open: () => {
						throw new Error("not used");
					},
				},
				authRateLimiter: rateLimiter(),
				clientKey: () => "outbox-rejection-client",
				magicLinkTtlSeconds: 900,
				refreshTokenTtlSeconds: 2_592_000,
				refreshTokenKey: "outbox-rejection-refresh-key-at-least-32-bytes",
				idempotencyPayloadKeys: {
					current: {
						id: "outbox-rejection-idempotency-v1",
						key: "outbox-rejection-idempotency-key-at-least-32-bytes",
					},
				},
			});
			const rejected = await invalidApp.request("/v1/auth/magic-links", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": `rejected-${suffix}`,
				},
				body: JSON.stringify({ email: rejectedEmail }),
			});
			expect(rejected.status).toBe(500);
			const [rejectedCount] = await sql<{ count: number }[]>`
				SELECT count(*)::int AS count
				FROM user_magic_links
				WHERE email = ${rejectedEmail}
			`;
			expect(rejectedCount?.count).toBe(0);
			const [rejectedIdempotency] = await sql<{ count: number }[]>`
				SELECT count(*)::int AS count
				FROM user_idempotency_records
				WHERE idempotency_key = ${`rejected-${suffix}`}
			`;
			expect(rejectedIdempotency?.count).toBe(0);

			const cleanup = await outbox.claimDue({
				workerId: "atomic-cleanup-worker",
				now: new Date(),
				leaseMs: 1_000,
				limit: 10,
				maxAttempts: 3,
			});
			for (const job of cleanup.jobs) {
				await outbox.complete({
					jobId: job.id,
					workerId: "atomic-cleanup-worker",
					now: new Date(),
				});
			}
		});

		test("claims concurrently without overlap, recovers an expired lease and rejects a late ack", async () => {
			const now = new Date();
			for (const label of ["claim-a", "claim-b", "claim-c"]) {
				await users.createMagicLinkWithDelivery(
					deliveryInput(emailFor(label), currentPayloads, now),
				);
			}
			const [first, second] = await Promise.all([
				outbox.claimDue({
					workerId: "claim-worker-a",
					now,
					leaseMs: 1_000,
					limit: 2,
					maxAttempts: 3,
				}),
				outbox.claimDue({
					workerId: "claim-worker-b",
					now,
					leaseMs: 1_000,
					limit: 2,
					maxAttempts: 3,
				}),
			]);
			const claimed = [...first.jobs, ...second.jobs];
			expect(claimed).toHaveLength(3);
			expect(new Set(claimed.map(({ id }) => id)).size).toBe(3);
			const owned = first.jobs[0];
			if (!owned) throw new Error("Expected first worker claim");
			const recoveredAt = new Date(now.getTime() + 1_001);
			const recovery = await outbox.claimDue({
				workerId: "claim-worker-recovery",
				now: recoveredAt,
				leaseMs: 1_000,
				limit: 3,
				maxAttempts: 3,
			});
			expect(recovery.jobs.map(({ id }) => id)).toContain(owned.id);
			expect(
				await outbox.complete({
					jobId: owned.id,
					workerId: "claim-worker-a",
					now: recoveredAt,
				}),
			).toBe(false);
			for (const job of recovery.jobs) {
				expect(
					await outbox.complete({
						jobId: job.id,
						workerId: "claim-worker-recovery",
						now: new Date(recoveredAt.getTime() + 1),
					}),
				).toBe(true);
			}
		});

		test("retries an accepted timeout with one stable provider side effect", async () => {
			let clock = new Date();
			const input = deliveryInput(emailFor("dedupe"), currentPayloads, clock);
			await users.createMagicLinkWithDelivery(input);
			const calls: string[] = [];
			const effects = new Set<string>();
			const worker = () =>
				new MagicLinkDeliveryWorker({
					repository: outbox,
					payloads: currentPayloads,
					sendMagicLink: async ({ deliveryKey, signal }) => {
						calls.push(deliveryKey);
						effects.add(deliveryKey);
						if (calls.length === 1) {
							await new Promise<void>((resolve) =>
								signal?.addEventListener("abort", () => resolve(), {
									once: true,
								}),
							);
						}
					},
					workerId: `dedupe-worker-${calls.length}`,
					batchSize: 1,
					leaseMs: 1_000,
					deliveryTimeoutMs: 10,
					maxAttempts: 3,
					baseBackoffMs: 100,
					maxBackoffMs: 1_000,
					random: () => 0.5,
					now: () => new Date(clock),
				});
			expect(await worker().runOnce()).toMatchObject({ retried: 1 });
			clock = new Date(clock.getTime() + 101);
			expect(await worker().runOnce()).toMatchObject({ delivered: 1 });
			expect(calls).toEqual([input.delivery.id, input.delivery.id]);
			expect(effects.size).toBe(1);
			const [stored] = await sql<{ state: string; attemptCount: number }[]>`
				SELECT state, attempt_count AS "attemptCount"
				FROM user_delivery_outbox
				WHERE id = ${input.delivery.id}
			`;
			expect(stored).toEqual({ state: "delivered", attemptCount: 2 });
		});

		test("honors Retry-After, expires tokens, and never sends after the final crashed attempt", async () => {
			let clock = new Date();
			const retry = deliveryInput(emailFor("retry"), currentPayloads, clock);
			await users.createMagicLinkWithDelivery(retry);
			const retryWorker = new MagicLinkDeliveryWorker({
				repository: outbox,
				payloads: currentPayloads,
				sendMagicLink: async () => {
					throw new MagicLinkDeliveryError("provider_429", 5_000);
				},
				workerId: "retry-worker",
				batchSize: 1,
				leaseMs: 10_000,
				deliveryTimeoutMs: 1_000,
				maxAttempts: 2,
				baseBackoffMs: 100,
				maxBackoffMs: 10_000,
				now: () => new Date(clock),
			});
			expect(await retryWorker.runOnce()).toMatchObject({ retried: 1 });
			const [scheduled] = await sql<{ availableAt: Date }[]>`
				SELECT available_at AS "availableAt"
				FROM user_delivery_outbox WHERE id = ${retry.delivery.id}
			`;
			expect(scheduled?.availableAt.getTime()).toBe(clock.getTime() + 5_000);
			clock = new Date(clock.getTime() + 5_001);
			expect(await retryWorker.runOnce()).toMatchObject({ deadLettered: 1 });

			const expiringAt = new Date();
			const expiring = deliveryInput(
				emailFor("expired"),
				currentPayloads,
				expiringAt,
				new Date(expiringAt.getTime() + 10),
			);
			await users.createMagicLinkWithDelivery(expiring);
			const expired = await outbox.claimDue({
				workerId: "expiry-worker",
				now: new Date(expiringAt.getTime() + 11),
				leaseMs: 1_000,
				limit: 1,
				maxAttempts: 2,
			});
			expect(expired).toMatchObject({ jobs: [], expired: 1 });

			const crashAt = new Date();
			const crashed = deliveryInput(
				emailFor("crashed-final"),
				currentPayloads,
				crashAt,
			);
			await users.createMagicLinkWithDelivery(crashed);
			const finalClaim = await outbox.claimDue({
				workerId: "crashed-worker",
				now: crashAt,
				leaseMs: 100,
				limit: 1,
				maxAttempts: 1,
			});
			expect(finalClaim.jobs.map(({ id }) => id)).toEqual([
				crashed.delivery.id,
			]);
			let providerEffects = 0;
			providerEffects += 1;
			const afterCrash = await outbox.claimDue({
				workerId: "after-crash-worker",
				now: new Date(crashAt.getTime() + 101),
				leaseMs: 100,
				limit: 1,
				maxAttempts: 1,
			});
			expect(afterCrash).toMatchObject({ jobs: [], exhausted: 1 });
			expect(providerEffects).toBe(1);
		});

		test("delivers rows sealed by the previous key after rotation", async () => {
			const oldPayloads = createDeliveryPayloadKeyring({
				current: { id: "old", key: oldKey },
			});
			const rotatedPayloads = createDeliveryPayloadKeyring({
				current: { id: "new", key: newKey },
				previous: { id: "old", key: oldKey },
			});
			const now = new Date();
			const input = deliveryInput(emailFor("rotation"), oldPayloads, now);
			await users.createMagicLinkWithDelivery(input);
			let deliveredToken: string | undefined;
			const worker = new MagicLinkDeliveryWorker({
				repository: outbox,
				payloads: rotatedPayloads,
				sendMagicLink: async ({ token }) => {
					deliveredToken = token;
				},
				workerId: "rotation-worker",
				batchSize: 1,
				leaseMs: 1_000,
				deliveryTimeoutMs: 100,
				maxAttempts: 2,
				baseBackoffMs: 100,
				maxBackoffMs: 1_000,
				now: () => new Date(now),
			});
			expect(await worker.runOnce()).toMatchObject({ delivered: 1 });
			expect(deliveredToken).toBe(input.token);
		});

		test("retries a K2 job on a K1-only worker and delivers once after rolling upgrade", async () => {
			const k1Only = createDeliveryPayloadKeyring({
				current: { id: "K1", key: oldKey },
			});
			const k2Only = createDeliveryPayloadKeyring({
				current: { id: "K2", key: newKey },
			});
			const upgraded = createDeliveryPayloadKeyring({
				current: { id: "K2", key: newKey },
				previous: { id: "K1", key: oldKey },
			});
			let clock = new Date();
			const email = emailFor("rolling-key-skew");
			const nextApi = createApp({
				repository: users,
				tokens,
				deliveryPayloads: k2Only,
				authRateLimiter: rateLimiter(),
				clientKey: () => "rolling-key-api-client",
				magicLinkTtlSeconds: 600,
				refreshTokenTtlSeconds: 2_592_000,
				refreshTokenKey: "rolling-key-refresh-key-at-least-32-bytes",
				idempotencyPayloadKeys: {
					current: {
						id: "rolling-idempotency-v1",
						key: "rolling-idempotency-payload-key-at-least-32-bytes",
					},
				},
				now: () => new Date(clock),
			});
			const accepted = await nextApi.request("/v1/auth/magic-links", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": `rolling-key-${suffix}`,
				},
				body: JSON.stringify({ email }),
			});
			expect(accepted.status).toBe(202);
			const [apiJob] = await sql<{ id: string }[]>`
				SELECT jobs.id
				FROM user_delivery_outbox AS jobs
				JOIN user_magic_links AS links ON links.id = jobs.magic_link_id
				WHERE links.email = ${email}
			`;
			if (!apiJob) throw new Error("Expected K2 API delivery job");
			let deliveries = 0;
			const worker = (payloads: DeliveryPayloadKeyring, workerId: string) =>
				new MagicLinkDeliveryWorker({
					repository: outbox,
					payloads,
					sendMagicLink: async () => {
						deliveries += 1;
					},
					workerId,
					batchSize: 1,
					leaseMs: 1_000,
					deliveryTimeoutMs: 100,
					maxAttempts: 8,
					baseBackoffMs: 100,
					maxBackoffMs: 1_000,
					now: () => new Date(clock),
				});

			expect(await worker(k1Only, "rolling-worker-k1").runOnce()).toMatchObject(
				{
					retried: 1,
					deadLettered: 0,
				},
			);
			expect(deliveries).toBe(0);
			const [pending] = await sql<
				{
					state: string;
					failureCode: string;
					availableAt: Date;
					attemptCount: number;
				}[]
			>`
				SELECT
					state,
					failure_code AS "failureCode",
					available_at AS "availableAt",
					attempt_count AS "attemptCount"
				FROM user_delivery_outbox
				WHERE id = ${apiJob.id}
			`;
			expect(pending).toMatchObject({
				state: "pending",
				failureCode: "payload_key_unavailable",
				attemptCount: 0,
			});
			if (!pending) throw new Error("Expected pending key-skew job");
			expect(pending.availableAt.getTime() - clock.getTime()).toBe(10_000);
			clock = new Date(pending.availableAt.getTime() + 1);
			expect(
				await worker(upgraded, "rolling-worker-k2").runOnce(),
			).toMatchObject({ delivered: 1 });
			expect(deliveries).toBe(1);
			const [delivered] = await sql<{ state: string; attemptCount: number }[]>`
				SELECT state, attempt_count AS "attemptCount"
				FROM user_delivery_outbox
				WHERE id = ${apiJob.id}
			`;
			expect(delivered).toEqual({ state: "delivered", attemptCount: 1 });
		});

		function emailFor(label: string) {
			const email = `${label}-${suffix}@example.com`;
			emails.add(email);
			return email;
		}
	});
}

function deliveryInput(
	email: string,
	payloads: DeliveryPayloadKeyring,
	createdAt = new Date(),
	expiresAt = new Date(createdAt.getTime() + 60_000),
) {
	const token = createOpaqueSecret("ml");
	const jobId = createId("job");
	return {
		link: {
			id: createId("ml"),
			email,
			tokenHash: hashSecret(token),
			expiresAt,
		},
		delivery: {
			id: jobId,
			sealedPayload: payloads.seal(jobId, { email, token, expiresAt }),
			createdAt,
		},
		token,
	};
}

function rateLimiter() {
	return new MemoryAuthRateLimiter(
		{
			magicRequest: { windowMs: 60_000 },
			magicRedeem: { windowMs: 60_000 },
			refresh: { windowMs: 60_000 },
		},
		1_000,
	);
}
