import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPair } from "jose";
import postgres, { type Sql } from "postgres";
import { migrate } from "../scripts/migrate";
import { createApp } from "./app";
import { createId, createTokenService, hashSecret } from "./auth";
import { createDeliveryPayloadKeyring } from "./delivery-payload";
import { PostgresUserRepository } from "./postgres-repository";
import { MemoryAuthRateLimiter } from "./rate-limit";

const databaseUrl = Bun.env.USER_DATABASE_URL;
const deliveryPayloads = createDeliveryPayloadKeyring({
	current: {
		id: "postgres-test-1",
		key: "eKOfuEuHFGQeOZltcgU4hlzp3jYpRNrp3xvjzwjJkSE",
	},
});

function authRateLimiter() {
	return new MemoryAuthRateLimiter(
		{
			magicRequest: { windowMs: 60_000 },
			magicRedeem: { windowMs: 60_000 },
			refresh: { windowMs: 60_000 },
		},
		1_000,
	);
}

if (!databaseUrl) {
	test.skip("Postgres user repository (set USER_DATABASE_URL)", () => {});
} else {
	describe("PostgresUserRepository", () => {
		let sql: Sql;
		let repository: PostgresUserRepository;
		const suffix = crypto.randomUUID();
		const emailA = `crew-a-${suffix}@example.com`;
		const emailB = `crew-b-${suffix}@example.com`;
		const emailHttp = `crew-http-${suffix}@example.com`;
		const emailSecurity = `crew-security-${suffix}@example.com`;
		const emailLogout = `crew-logout-${suffix}@example.com`;

		beforeAll(async () => {
			sql = postgres(databaseUrl);
			await migrate(sql);
			repository = new PostgresUserRepository(sql);
		});

		afterAll(async () => {
			await sql`DELETE FROM user_idempotency_records`;
			await sql`DELETE FROM user_magic_links WHERE email IN (${emailA}, ${emailB}, ${emailHttp}, ${emailSecurity}, ${emailLogout})`;
			await sql`DELETE FROM users WHERE email IN (${emailA}, ${emailB}, ${emailHttp}, ${emailSecurity}, ${emailLogout})`;
			await sql.end();
		});

		test("atomically redeems one link and keeps a stable normalized identity", async () => {
			const now = new Date();
			const linkId = createId("ml");
			const tokenHash = hashSecret(`magic-${suffix}`);
			await repository.createMagicLink({
				id: linkId,
				email: `  ${emailA.toUpperCase()}  `,
				tokenHash,
				expiresAt: new Date(now.getTime() + 60_000),
			});

			const inputs = [createId("usr"), createId("usr")].map((newUserId) => ({
				tokenHash,
				now,
				newUserId,
				newSessionId: createId("ses"),
				refreshTokenHash: hashSecret(crypto.randomUUID()),
				sessionExpiresAt: new Date(now.getTime() + 3_600_000),
			}));
			const redemptions = await Promise.all(
				inputs.map((input) => repository.redeemMagicLink(input)),
			);
			const authenticated = redemptions.filter((result) => result !== null);
			expect(authenticated).toHaveLength(1);
			expect(authenticated[0]?.user.email).toBe(emailA);

			const existingUserId = authenticated[0]?.user.id;
			if (!existingUserId) throw new Error("Expected redeemed user");
			const secondTokenHash = hashSecret(`magic-again-${suffix}`);
			await repository.createMagicLink({
				id: createId("ml"),
				email: emailA,
				tokenHash: secondTokenHash,
				expiresAt: new Date(now.getTime() + 60_000),
			});
			const second = await repository.redeemMagicLink({
				tokenHash: secondTokenHash,
				now,
				newUserId: createId("usr"),
				newSessionId: createId("ses"),
				refreshTokenHash: hashSecret(crypto.randomUUID()),
				sessionExpiresAt: new Date(now.getTime() + 3_600_000),
			});
			expect(second?.user.id).toBe(existingUserId);
		});

		test("rotates refresh tokens and revokes the family on unmatched reuse", async () => {
			const now = new Date();
			const originalHash = hashSecret(`refresh-${suffix}`);
			await repository.createMagicLink({
				id: createId("ml"),
				email: emailB,
				tokenHash: hashSecret(`magic-b-${suffix}`),
				expiresAt: new Date(now.getTime() + 60_000),
			});
			const auth = await repository.redeemMagicLink({
				tokenHash: hashSecret(`magic-b-${suffix}`),
				now,
				newUserId: createId("usr"),
				newSessionId: createId("ses"),
				refreshTokenHash: originalHash,
				sessionExpiresAt: new Date(now.getTime() + 3_600_000),
			});
			if (!auth) throw new Error("Expected redeemed user");

			const rotatedHash = hashSecret(`refresh-rotated-${suffix}`);
			const replacementSessionId = createId("ses");
			const rotated = await repository.rotateRefreshToken({
				tokenHash: originalHash,
				now,
				newSessionId: replacementSessionId,
				newRefreshTokenHash: rotatedHash,
				sessionExpiresAt: new Date(now.getTime() + 3_600_000),
			});
			expect(rotated.kind).toBe("ok");
			const replayed = await repository.rotateRefreshToken({
				tokenHash: originalHash,
				now: new Date(now.getTime() + 10_000),
				newSessionId: createId("ses"),
				newRefreshTokenHash: hashSecret(crypto.randomUUID()),
				sessionExpiresAt: new Date(now.getTime() + 3_600_000),
			});
			expect(replayed.kind).toBe("reuse");
			expect(
				(
					await repository.rotateRefreshToken({
						tokenHash: rotatedHash,
						now: new Date(now.getTime() + 11_000),
						newSessionId: createId("ses"),
						newRefreshTokenHash: hashSecret(crypto.randomUUID()),
						sessionExpiresAt: new Date(now.getTime() + 3_600_000),
					})
				).kind,
			).toBe("reuse");
		});

		test("keeps profile CAS and devices scoped to their user", async () => {
			const now = new Date();
			const [userA] = await sql<
				{ id: string }[]
			>`SELECT id FROM users WHERE email = ${emailA}`;
			const [userB] = await sql<
				{ id: string }[]
			>`SELECT id FROM users WHERE email = ${emailB}`;
			if (!userA || !userB) throw new Error("Expected test users");

			const updated = await repository.updateProfile(
				userA.id,
				1,
				{ displayName: "Crew A" },
				now,
			);
			expect(updated?.version).toBe(2);
			expect(
				await repository.updateProfile(
					userA.id,
					1,
					{ displayName: "stale" },
					now,
				),
			).toBeNull();
			expect((await repository.getProfile(userB.id))?.displayName).toBeNull();
			const directoryProfiles = await repository.resolveMemberDirectoryProfiles(
				[userB.id, userA.id],
			);
			expect(directoryProfiles).toEqual([
				{ userId: userB.id, displayName: null, version: 1 },
				{ userId: userA.id, displayName: "Crew A", version: 2 },
			]);
			expect(Object.keys(directoryProfiles[0] ?? {}).sort()).toEqual([
				"displayName",
				"userId",
				"version",
			]);

			const input = {
				installationId: `installation-${suffix}`,
				platform: "ios" as const,
				pushToken: `push-${suffix}`,
				locale: "en",
				timeZone: "Europe/Zurich",
				appVersion: "1.0.0",
				notificationsEnabled: true,
			};
			await repository.upsertDevice(userA.id, input, now);
			await repository.upsertDevice(userB.id, input, now);
			expect(await repository.listDevices(userA.id)).toMatchObject([
				{ pushToken: null, notificationsEnabled: false },
			]);
			expect(await repository.listDevices(userB.id)).toMatchObject([
				{ pushToken: input.pushToken, notificationsEnabled: true },
			]);
			expect(
				await repository.removeDevice(userA.id, input.installationId),
			).toBe(true);
			expect(await repository.listDevices(userA.id)).toHaveLength(0);
			expect(await repository.listDevices(userB.id)).toHaveLength(1);
		});

		test("runs magic-link identity through HTTP and real Postgres", async () => {
			const keys = await generateKeyPair("RS256");
			const tokens = await createTokenService(keys.privateKey, keys.publicKey, {
				issuer: "crew-user-service",
				audience: "crew-mobile",
				keyId: "postgres-http-test",
				accessTokenTtlSeconds: 900,
			});
			const app = createApp({
				repository,
				tokens,
				deliveryPayloads,
				authRateLimiter: authRateLimiter(),
				clientKey: () => "postgres-http-client",
				magicLinkTtlSeconds: 900,
				refreshTokenTtlSeconds: 2_592_000,
				refreshTokenKey: "postgres-http-refresh-key-at-least-32-bytes",
				idempotencyPayloadKeys: {
					current: {
						id: "postgres-http-idempotency-v1",
						key: "postgres-http-idempotency-key-at-least-32-bytes",
					},
				},
			});

			const requested = await app.request("/v1/auth/magic-links", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": `magic-request-${suffix}`,
				},
				body: JSON.stringify({ email: emailHttp.toUpperCase() }),
			});
			expect(requested.status).toBe(202);
			const changedRequest = await app.request("/v1/auth/magic-links", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": `magic-request-${suffix}`,
				},
				body: JSON.stringify({ email: emailSecurity }),
			});
			expect(changedRequest.status).toBe(409);
			expect((await changedRequest.json()).error.code).toBe(
				"IDEMPOTENCY_KEY_REUSED",
			);
			const alternateRequest = await app.request("/v1/auth/magic-links", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": `magic-request-alternate-${suffix}`,
				},
				body: JSON.stringify({ email: emailSecurity }),
			});
			expect(alternateRequest.status).toBe(202);
			const alternateMagicToken = await latestMagicToken(sql, emailSecurity);
			if (!alternateMagicToken)
				throw new Error("Expected alternate magic token");
			const magicToken = await latestMagicToken(sql, emailHttp);
			if (!magicToken) throw new Error("Expected delivered magic token");
			const redeemed = await app.request("/v1/auth/magic-links/redeem", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": `magic-redeem-${suffix}`,
				},
				body: JSON.stringify({ token: magicToken }),
			});
			expect(redeemed.status).toBe(200);
			expect(redeemed.headers.get("Cache-Control")).toBe("private, no-store");
			const session = await redeemed.json();
			expect(session.user.email).toBe(emailHttp);
			const changedRedeem = await app.request("/v1/auth/magic-links/redeem", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": `magic-redeem-${suffix}`,
				},
				body: JSON.stringify({ token: alternateMagicToken }),
			});
			expect(changedRedeem.status).toBe(409);
			expect((await changedRedeem.json()).error.code).toBe(
				"IDEMPOTENCY_KEY_REUSED",
			);
			const me = await app.request("/v1/me", {
				headers: { Authorization: `Bearer ${session.accessToken}` },
			});
			expect(me.status).toBe(200);
			expect((await me.json()).id).toBe(session.user.id);
		});

		test("persists exact refresh replay and permanently revokes reuse and logout descendants", async () => {
			const keys = await generateKeyPair("RS256");
			const tokens = await createTokenService(keys.privateKey, keys.publicKey, {
				issuer: "crew-user-service",
				audience: "crew-mobile",
				keyId: "postgres-security-test",
				accessTokenTtlSeconds: 900,
			});
			const oldIdempotencyPayloadKey = {
				id: "postgres-security-idempotency-v1",
				key: "postgres-security-idempotency-key-at-least-32-bytes",
			};
			const application = (idempotencyPayloadKeys: {
				current: { id: string; key: string };
				previous?: { id: string; key: string };
			}) =>
				createApp({
					repository,
					tokens,
					deliveryPayloads,
					authRateLimiter: authRateLimiter(),
					clientKey: () => "postgres-security-client",
					magicLinkTtlSeconds: 900,
					refreshTokenTtlSeconds: 2_592_000,
					refreshTokenKey: "postgres-security-refresh-key-at-least-32-bytes",
					idempotencyPayloadKeys,
				});
			const app = application({ current: oldIdempotencyPayloadKey });
			type SessionBody = {
				accessToken: string;
				refreshToken: string;
				user: { id: string; email: string };
			};
			const signIn = async (email: string, label: string) => {
				const requested = await app.request("/v1/auth/magic-links", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Idempotency-Key": `${label}-request-${suffix}`,
					},
					body: JSON.stringify({ email }),
				});
				expect(requested.status).toBe(202);
				const magicToken = await latestMagicToken(sql, email);
				if (!magicToken) throw new Error("Expected security magic token");
				const redeemed = await app.request("/v1/auth/magic-links/redeem", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Idempotency-Key": `${label}-redeem-${suffix}`,
					},
					body: JSON.stringify({ token: magicToken }),
				});
				expect(redeemed.status).toBe(200);
				return redeemed.json() as Promise<SessionBody>;
			};
			const refresh = async (
				refreshToken: string,
				idempotencyKey: string,
				requestId: string = crypto.randomUUID(),
				targetApp = app,
			) =>
				targetApp.request("/v1/auth/refresh", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Idempotency-Key": idempotencyKey,
						"X-Request-ID": requestId,
					},
					body: JSON.stringify({ refreshToken }),
				});

			const initial = await signIn(emailSecurity, "security");
			const refreshKey = `security-refresh-${suffix}`;
			const first = await refresh(
				initial.refreshToken,
				refreshKey,
				"postgres.refresh.first",
			);
			expect(first.status).toBe(200);
			expect(first.headers.get("Cache-Control")).toBe("private, no-store");
			const firstBody = (await first.json()) as SessionBody;
			const rotatedApp = application({
				current: {
					id: "postgres-security-idempotency-v2",
					key: "postgres-security-idempotency-key-v2-at-least-32-bytes",
				},
				previous: oldIdempotencyPayloadKey,
			});
			const replay = await refresh(
				initial.refreshToken,
				refreshKey,
				"postgres.refresh.replay",
				rotatedApp,
			);
			expect(replay.status).toBe(200);
			expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
			expect(replay.headers.get("Cache-Control")).toBe("private, no-store");
			expect(replay.headers.get("X-Request-ID")).toBe(
				"postgres.refresh.replay",
			);
			expect(await replay.json()).toEqual(firstBody);
			const changedReplay = await refresh(
				firstBody.refreshToken,
				refreshKey,
				"postgres.refresh.changed",
			);
			expect(changedReplay.status).toBe(409);
			expect((await changedReplay.json()).error.code).toBe(
				"IDEMPOTENCY_KEY_REUSED",
			);

			const [stored] = await sql<
				{
					responsePayload: string;
					createdAt: Date;
					expiresAt: Date;
				}[]
			>`
					SELECT
						response_payload AS "responsePayload",
						created_at AS "createdAt",
						expires_at AS "expiresAt"
					FROM user_idempotency_records
					WHERE operation_id = 'identitySessionsRefresh'
						AND idempotency_key = ${refreshKey}
				`;
			if (!stored) throw new Error("Expected stored refresh response");
			expect(stored.responsePayload.startsWith("v1.")).toBe(true);
			expect(stored.responsePayload).toStartWith(
				"v1.postgres-security-idempotency-v1.",
			);
			expect(stored.responsePayload).not.toContain(firstBody.refreshToken);
			expect(stored.responsePayload).not.toContain(firstBody.accessToken);
			expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(
				30 * 24 * 60 * 60 * 1_000,
			);
			const newKeyRequest = await rotatedApp.request("/v1/auth/magic-links", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": `security-key-v2-${suffix}`,
				},
				body: JSON.stringify({ email: emailSecurity }),
			});
			expect(newKeyRequest.status).toBe(202);
			const [newEnvelope] = await sql<{ responsePayload: string }[]>`
				SELECT response_payload AS "responsePayload"
				FROM user_idempotency_records
				WHERE operation_id = 'identityMagicLinksCreate'
					AND idempotency_key = ${`security-key-v2-${suffix}`}
			`;
			expect(newEnvelope?.responsePayload).toStartWith(
				"v1.postgres-security-idempotency-v2.",
			);

			const unmatched = await refresh(
				initial.refreshToken,
				`security-reuse-${suffix}`,
			);
			expect(unmatched.status).toBe(401);
			expect((await unmatched.json()).error.code).toBe("SESSION_REVOKED");
			const revokedReplay = await refresh(
				initial.refreshToken,
				refreshKey,
				"postgres.refresh.revoked-replay",
			);
			expect(revokedReplay.status).toBe(401);
			expect(revokedReplay.headers.get("Idempotency-Replayed")).toBeNull();
			const revokedReplayText = await revokedReplay.text();
			expect(revokedReplayText).not.toContain(firstBody.accessToken);
			expect(revokedReplayText).not.toContain(firstBody.refreshToken);
			const revokedReplacement = await refresh(
				firstBody.refreshToken,
				`security-replacement-${suffix}`,
			);
			expect(revokedReplacement.status).toBe(401);

			const logoutInitial = await signIn(emailLogout, "logout");
			const logoutFirstResponse = await refresh(
				logoutInitial.refreshToken,
				`logout-refresh-one-${suffix}`,
			);
			expect(logoutFirstResponse.status).toBe(200);
			const logoutFirst = (await logoutFirstResponse.json()) as SessionBody;
			const logoutSecondResponse = await refresh(
				logoutFirst.refreshToken,
				`logout-refresh-two-${suffix}`,
			);
			expect(logoutSecondResponse.status).toBe(200);
			const logoutSecond = (await logoutSecondResponse.json()) as SessionBody;
			const logout = await app.request("/v1/auth/logout", {
				method: "POST",
				headers: { Authorization: `Bearer ${logoutFirst.accessToken}` },
			});
			expect(logout.status).toBe(204);
			const afterLogout = await refresh(
				logoutSecond.refreshToken,
				`logout-after-${suffix}`,
			);
			expect(afterLogout.status).toBe(401);
			expect((await afterLogout.json()).error.code).toBe("SESSION_REVOKED");
			const storedAfterLogout = await refresh(
				logoutFirst.refreshToken,
				`logout-refresh-two-${suffix}`,
				"postgres.logout.revoked-replay",
			);
			expect(storedAfterLogout.status).toBe(401);
			expect(storedAfterLogout.headers.get("Idempotency-Replayed")).toBeNull();
			const storedAfterLogoutText = await storedAfterLogout.text();
			expect(storedAfterLogoutText).not.toContain(logoutSecond.accessToken);
			expect(storedAfterLogoutText).not.toContain(logoutSecond.refreshToken);
			const logoutMagicToken = await latestMagicToken(sql, emailLogout);
			if (!logoutMagicToken) throw new Error("Expected logout magic token");
			const redeemedAfterLogout = await app.request(
				"/v1/auth/magic-links/redeem",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Idempotency-Key": `logout-redeem-${suffix}`,
					},
					body: JSON.stringify({ token: logoutMagicToken }),
				},
			);
			expect(redeemedAfterLogout.status).toBe(401);
			expect(
				redeemedAfterLogout.headers.get("Idempotency-Replayed"),
			).toBeNull();
			expect(await redeemedAfterLogout.text()).not.toContain(
				logoutInitial.refreshToken,
			);
		});

		test("uses the database clock and bounded cleanup for expired replay bodies", async () => {
			const scope = `expiry:${suffix}`;
			const operationId = "usersExpiryReplayTest";
			const key = `expiry-${suffix}`;
			const fingerprint = hashSecret(`expiry-fingerprint-${suffix}`);
			await sql`
				INSERT INTO user_idempotency_records (
					scope, operation_id, idempotency_key, fingerprint, state,
					response_status, response_payload, response_headers,
					created_at, completed_at, expires_at
				) VALUES (
					${scope}, ${operationId}, ${key}, ${fingerprint}, 'completed',
					200, 'stale-sensitive-body', '{}'::jsonb,
					clock_timestamp() - interval '32 days',
					clock_timestamp() - interval '31 days',
					clock_timestamp() - interval '2 days'
				)
			`;
			await sql`
				INSERT INTO user_idempotency_records (
					scope, operation_id, idempotency_key, fingerprint, state,
					response_status, response_payload, response_headers,
					created_at, completed_at, expires_at
				)
				SELECT
					${`expiry-fillers:${suffix}`}, 'usersExpiryFillerTest',
					'fill-' || lpad(value::text, 4, '0') || ${suffix},
					${hashSecret(`expiry-fillers-${suffix}`)}, 'completed',
					200, 'expired-filler', '{}'::jsonb,
					clock_timestamp() - interval '31 days',
					clock_timestamp() - interval '30 days',
					clock_timestamp() - interval '1 day'
				FROM generate_series(1, 101) AS value
			`;
			let executions = 0;
			const staleApplicationNow = new Date("2000-01-01T00:00:00.000Z");
			const input = {
				scope,
				operationId,
				key,
				fingerprint,
				now: staleApplicationNow,
				expiresAt: new Date("2000-01-31T00:00:00.000Z"),
			};
			const executed = await repository.executeIdempotent(input, async () => {
				executions += 1;
				return { status: 200, body: "fresh-body", headers: {} };
			});
			expect(executed).toMatchObject({
				kind: "executed",
				response: { body: "fresh-body" },
			});
			const [bounded] = await sql<{ fillerCount: number }[]>`
				SELECT count(*)::int AS "fillerCount"
				FROM user_idempotency_records
				WHERE scope = ${`expiry-fillers:${suffix}`}
			`;
			expect(bounded?.fillerCount).toBeLessThanOrEqual(1);
			const replayed = await repository.executeIdempotent(input, async () => {
				throw new Error("An active record must replay");
			});
			expect(replayed).toMatchObject({
				kind: "replayed",
				response: { body: "fresh-body" },
			});
			expect(executions).toBe(1);
			const [proof] = await sql<
				{ fillerCount: number; exactActive: boolean; exactBody: string }[]
			>`
				SELECT
					(SELECT count(*)::int FROM user_idempotency_records
					 WHERE scope = ${`expiry-fillers:${suffix}`}) AS "fillerCount",
					expires_at > clock_timestamp() AS "exactActive",
					response_payload AS "exactBody"
				FROM user_idempotency_records
				WHERE scope = ${scope} AND operation_id = ${operationId}
					AND idempotency_key = ${key}
			`;
			expect(proof).toEqual({
				fillerCount: 0,
				exactActive: true,
				exactBody: "fresh-body",
			});
		});

		test("returns in-progress for a concurrent Postgres idempotency claim", async () => {
			const now = new Date();
			const input = {
				scope: `integration:${suffix}`,
				operationId: "usersConcurrencyTest",
				key: `concurrency-${suffix}`,
				fingerprint: hashSecret(`fingerprint-${suffix}`),
				now,
				expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
			};
			let operationStarted: (() => void) | undefined;
			let releaseOperation: (() => void) | undefined;
			const started = new Promise<void>((resolve) => {
				operationStarted = resolve;
			});
			const released = new Promise<void>((resolve) => {
				releaseOperation = resolve;
			});
			const first = repository.executeIdempotent(input, async () => {
				operationStarted?.();
				await released;
				return { status: 200, body: "sealed", headers: {} };
			});
			await started;
			expect(
				(
					await repository.executeIdempotent(input, async () => {
						throw new Error("Concurrent operation must not run");
					})
				).kind,
			).toBe("in_progress");
			releaseOperation?.();
			expect((await first).kind).toBe("executed");
			expect(
				(
					await repository.executeIdempotent(input, async () => {
						throw new Error("Replay operation must not run");
					})
				).kind,
			).toBe("replayed");
		});
	});
}

async function latestMagicToken(sql: Sql, email: string) {
	const [job] = await sql<
		{ id: string; sealedPayload: string; expiresAt: Date }[]
	>`
		SELECT
			jobs.id,
			jobs.sealed_payload AS "sealedPayload",
			jobs.token_expires_at AS "expiresAt"
		FROM user_delivery_outbox AS jobs
		JOIN user_magic_links AS links ON links.id = jobs.magic_link_id
		WHERE links.email = ${email.trim().toLowerCase()}
		ORDER BY jobs.created_at DESC, jobs.id DESC
		LIMIT 1
	`;
	return job
		? deliveryPayloads.open({
				jobId: job.id,
				sealedPayload: job.sealedPayload,
				expiresAt: job.expiresAt,
			}).token
		: undefined;
}
