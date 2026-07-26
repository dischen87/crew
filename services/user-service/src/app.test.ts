import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPair } from "jose";
import { type AppDependencies, createApp, resolveClientKey } from "./app";
import { createTokenService, type TokenService } from "./auth";
import {
	loadConfig,
	loadDeliveryWorkerConfig,
	loadIdentityRetentionWorkerConfig,
	loadPushWorkerConfig,
} from "./config";
import {
	createDeliveryPayloadKeyring,
	type DeliveryPayloadKeyring,
} from "./delivery-payload";
import { MemoryAuthRateLimiter } from "./rate-limit";
import { InMemoryUserRepository } from "./repository";

let tokens: TokenService;
let repository: InMemoryUserRepository;
let deliveryPayloads: DeliveryPayloadKeyring;
let clock: Date;
let keySequence: number;

beforeAll(async () => {
	const keys = await generateKeyPair("RS256");
	tokens = await createTokenService(keys.privateKey, keys.publicKey, {
		issuer: "crew-user-service",
		audience: "crew-mobile",
		keyId: "test-key-1",
		accessTokenTtlSeconds: 900,
	});
});

beforeEach(() => {
	repository = new InMemoryUserRepository();
	deliveryPayloads = createDeliveryPayloadKeyring({
		current: {
			id: "test-1",
			key: "eKOfuEuHFGQeOZltcgU4hlzp3jYpRNrp3xvjzwjJkSE",
		},
	});
	clock = new Date("2026-07-18T12:00:00.000Z");
	keySequence = 0;
});

function nextKey(prefix = "request") {
	keySequence += 1;
	return `${prefix}-${keySequence.toString().padStart(4, "0")}`;
}

function dependencies(): AppDependencies {
	return {
		repository,
		tokens,
		deliveryPayloads,
		authRateLimiter: new MemoryAuthRateLimiter(
			{
				magicRequest: { windowMs: 60_000 },
				magicRedeem: { windowMs: 60_000 },
				refresh: { windowMs: 60_000 },
			},
			100,
		),
		clientKey: () => "unit-test-client",
		magicLinkTtlSeconds: 900,
		refreshTokenTtlSeconds: 2_592_000,
		refreshTokenKey: "test-refresh-key-that-is-at-least-32-bytes",
		idempotencyPayloadKeys: {
			current: {
				id: "test-idempotency-v1",
				key: "test-idempotency-payload-key-at-least-32-bytes",
			},
		},
		now: () => new Date(clock),
	};
}

async function requestLink(
	app: ReturnType<typeof createApp>,
	email = "Person@Example.com",
	idempotencyKey = nextKey("magic-request"),
) {
	const response = await app.request("/v1/auth/magic-links", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Idempotency-Key": idempotencyKey,
		},
		body: JSON.stringify({ email }),
	});
	expect(response.status).toBe(202);
	expect(await response.json()).toEqual({ accepted: true });
	const job = [...repository.deliveryJobs.values()].at(-1);
	return job
		? deliveryPayloads.open({
				jobId: job.id,
				sealedPayload: job.sealedPayload,
				expiresAt: job.expiresAt,
			}).token
		: undefined;
}

async function redeem(
	app: ReturnType<typeof createApp>,
	token: string,
	idempotencyKey = nextKey("magic-redeem"),
) {
	const response = await app.request("/v1/auth/magic-links/redeem", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"Idempotency-Key": idempotencyKey,
		},
		body: JSON.stringify({ token }),
	});
	expect(response.status).toBe(200);
	return response.json() as Promise<{
		accessToken: string;
		refreshToken: string;
		user: { id: string; email: string; profile: { version: number } };
	}>;
}

describe("first-party identity and sessions", () => {
	test("normalizes a verified email into one stable global user", async () => {
		const app = createApp(dependencies());
		const firstToken = await requestLink(app);
		if (!firstToken) throw new Error("Expected delivered magic link");
		const first = await redeem(app, firstToken);
		expect(first.user.email).toBe("person@example.com");
		expect(first.user.id).toMatch(/^usr_[a-f0-9]{32}$/);
		expect(first.refreshToken).toMatch(/^rt_[A-Za-z0-9_-]{43}$/);
		expect(await tokens.verifyAccessToken(first.accessToken)).toMatchObject({
			userId: first.user.id,
			email: "person@example.com",
		});

		const secondToken = await requestLink(app, "person@example.com");
		if (!secondToken) throw new Error("Expected second magic link");
		const second = await redeem(app, secondToken);
		expect(second.user.id).toBe(first.user.id);
		expect(repository.users.size).toBe(1);
	});

	test("consumes a magic link once without revealing account existence", async () => {
		const app = createApp(dependencies());
		const magicToken = await requestLink(app);
		if (!magicToken) throw new Error("Expected magic link");
		await redeem(app, magicToken);
		const replay = await app.request("/v1/auth/magic-links/redeem", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": nextKey("magic-redeem"),
			},
			body: JSON.stringify({ token: magicToken }),
		});
		expect(replay.status).toBe(401);
		expect((await replay.json()).error.code).toBe("MAGIC_LINK_INVALID");
	});

	test("replays credentials only while their returned session remains active", async () => {
		const app = createApp(dependencies());
		const magicToken = await requestLink(app, "active@example.com");
		const alternateToken = await requestLink(app, "alternate@example.com");
		if (!magicToken || !alternateToken) throw new Error("Expected magic links");
		const key = nextKey("magic-redeem");
		const request = (token: string, requestId: string) =>
			app.request("/v1/auth/magic-links/redeem", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": key,
					"X-Request-ID": requestId,
				},
				body: JSON.stringify({ token }),
			});
		const first = await request(magicToken, "redeem.active.first");
		expect(first.status).toBe(200);
		expect(first.headers.get("Cache-Control")).toBe("private, no-store");
		const firstBody = await first.json();
		const replay = await request(magicToken, "redeem.active.replay");
		expect(replay.status).toBe(200);
		expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
		expect(replay.headers.get("Cache-Control")).toBe("private, no-store");
		expect(await replay.json()).toEqual(firstBody);

		const logout = await app.request("/v1/auth/logout", {
			method: "POST",
			headers: { Authorization: `Bearer ${firstBody.accessToken}` },
		});
		expect(logout.status).toBe(204);
		const revoked = await request(magicToken, "redeem.revoked");
		expect(revoked.status).toBe(401);
		expect(revoked.headers.get("Idempotency-Replayed")).toBeNull();
		const revokedText = await revoked.text();
		expect(revokedText).not.toContain(firstBody.accessToken);
		expect(revokedText).not.toContain(firstBody.refreshToken);

		const changed = await request(alternateToken, "redeem.changed");
		expect(changed.status).toBe(409);
		expect((await changed.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
	});

	test("enqueues a magic link once for an exact idempotent replay", async () => {
		const app = createApp(dependencies());
		const key = nextKey("magic-request");
		const request = (requestId: string) =>
			app.request("/v1/auth/magic-links", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": key,
					"X-Request-ID": requestId,
				},
				body: JSON.stringify({ email: "person@example.com" }),
			});
		expect((await request("magic.first")).status).toBe(202);
		const replay = await request("magic.replay");
		expect(replay.status).toBe(202);
		expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
		expect(replay.headers.get("X-Request-ID")).toBe("magic.replay");
		expect(repository.deliveryJobs.size).toBe(1);
		const changed = await app.request("/v1/auth/magic-links", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": key,
			},
			body: JSON.stringify({ email: "changed@example.com" }),
		});
		expect(changed.status).toBe(409);
		expect((await changed.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
		expect(repository.deliveryJobs.size).toBe(1);
	});

	test("returns in-progress while the first durable enqueue owns the claim", async () => {
		const deps = dependencies();
		let deliveryStarted: (() => void) | undefined;
		let releaseDelivery: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			deliveryStarted = resolve;
		});
		const released = new Promise<void>((resolve) => {
			releaseDelivery = resolve;
		});
		const createMagicLinkWithDelivery =
			repository.createMagicLinkWithDelivery.bind(repository);
		repository.createMagicLinkWithDelivery = async (input) => {
			deliveryStarted?.();
			await released;
			await createMagicLinkWithDelivery(input);
		};
		const app = createApp(deps);
		const key = nextKey("magic-request");
		const request = () =>
			app.request("/v1/auth/magic-links", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": key,
				},
				body: JSON.stringify({ email: "person@example.com" }),
			});
		const first = request();
		await started;
		const concurrent = await request();
		expect(concurrent.status).toBe(409);
		expect(concurrent.headers.get("Retry-After")).toBe("1");
		expect((await concurrent.json()).error.code).toBe(
			"IDEMPOTENCY_IN_PROGRESS",
		);
		releaseDelivery?.();
		expect((await first).status).toBe(202);
	});

	test("replays only the same refresh command and revokes unmatched reuse", async () => {
		const app = createApp(dependencies());
		const magicToken = await requestLink(app);
		if (!magicToken) throw new Error("Expected magic link");
		const session = await redeem(app, magicToken);

		const refresh = (
			refreshToken: string,
			idempotencyKey: string,
			requestId: string,
		) =>
			app.request("/v1/auth/refresh", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": idempotencyKey,
					"X-Request-ID": requestId,
				},
				body: JSON.stringify({ refreshToken }),
			});
		const commandKey = nextKey("refresh");
		const first = await refresh(
			session.refreshToken,
			commandKey,
			"refresh.first",
		);
		const firstBody = await first.json();
		const replay = await refresh(
			session.refreshToken,
			commandKey,
			"refresh.replay",
		);
		const replayBody = await replay.json();
		expect(first.status).toBe(200);
		expect(replay.status).toBe(200);
		expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
		expect(replay.headers.get("X-Request-ID")).toBe("refresh.replay");
		expect(first.headers.get("Cache-Control")).toBe("private, no-store");
		expect(replay.headers.get("Cache-Control")).toBe("private, no-store");
		expect(replayBody).toEqual(firstBody);
		expect(replayBody.refreshToken).toBe(firstBody.refreshToken);
		expect(
			(await tokens.verifyAccessToken(replayBody.accessToken)).sessionId,
		).toBe((await tokens.verifyAccessToken(firstBody.accessToken)).sessionId);

		const changed = await refresh(
			firstBody.refreshToken,
			commandKey,
			"refresh.changed",
		);
		expect(changed.status).toBe(409);
		expect((await changed.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");

		const reuse = await refresh(
			session.refreshToken,
			nextKey("refresh"),
			"refresh.reuse",
		);
		expect(reuse.status).toBe(401);
		expect((await reuse.json()).error.code).toBe("SESSION_REVOKED");
		const revokedReplay = await refresh(
			session.refreshToken,
			commandKey,
			"refresh.revoked-replay",
		);
		expect(revokedReplay.status).toBe(401);
		expect(revokedReplay.headers.get("Idempotency-Replayed")).toBeNull();
		const revokedReplayText = await revokedReplay.text();
		expect(revokedReplayText).not.toContain(firstBody.accessToken);
		expect(revokedReplayText).not.toContain(firstBody.refreshToken);

		const revokedFamily = await app.request("/v1/auth/refresh", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": nextKey("refresh"),
			},
			body: JSON.stringify({ refreshToken: firstBody.refreshToken }),
		});
		expect(revokedFamily.status).toBe(401);
	});

	test("publishes only the public RSA verification key", async () => {
		const app = createApp(dependencies());
		const response = await app.request("/.well-known/jwks.json");
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.keys).toHaveLength(1);
		expect(body.keys[0]).toMatchObject({
			alg: "RS256",
			kid: "test-key-1",
			kty: "RSA",
			use: "sig",
		});
		expect(body.keys[0].d).toBeUndefined();
	});

	test("does not return or cache 202 when the durable enqueue fails", async () => {
		const deps = dependencies();
		let attempts = 0;
		let logged: unknown[] = [];
		const consoleError = console.error;
		console.error = (...input) => {
			logged = input;
		};
		const createMagicLinkWithDelivery =
			repository.createMagicLinkWithDelivery.bind(repository);
		repository.createMagicLinkWithDelivery = async (input) => {
			attempts += 1;
			if (attempts === 1) {
				throw new Error(
					"person@example.com ml_secret must never reach structured logs",
				);
			}
			await createMagicLinkWithDelivery(input);
		};
		const app = createApp(deps);
		const idempotencyKey = nextKey("magic-request");
		const request = () =>
			app.request("/v1/auth/magic-links", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": idempotencyKey,
				},
				body: JSON.stringify({ email: "person@example.com" }),
			});
		try {
			const response = await request();
			expect(response.status).toBe(500);
			expect(await response.json()).toMatchObject({
				error: { code: "INTERNAL_ERROR", retryable: false },
			});
			expect(JSON.stringify(logged)).toContain("INTERNAL_ERROR");
			expect(JSON.stringify(logged)).not.toContain("person@example.com");
			expect(JSON.stringify(logged)).not.toContain("ml_secret");
			expect((await request()).status).toBe(202);
			expect(attempts).toBe(2);
			expect(repository.deliveryJobs.size).toBe(1);
		} finally {
			console.error = consoleError;
		}
	});

	test("requires idempotency, bounds auth bodies and rate limits email abuse", async () => {
		const app = createApp(dependencies());
		const missingKey = await app.request("/v1/auth/magic-links", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "person@example.com" }),
		});
		expect(missingKey.status).toBe(400);

		const malformed = await app.request("/v1/auth/magic-links", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": nextKey("magic-request"),
			},
			body: '{"email":',
		});
		expect(malformed.status).toBe(400);
		expect((await malformed.json()).error.code).toBe("VALIDATION_FAILED");

		const oversized = await app.request("/v1/auth/magic-links", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": nextKey("magic-request"),
			},
			body: JSON.stringify({ email: `${"a".repeat(5_000)}@example.com` }),
		});
		expect(oversized.status).toBe(413);
		expect((await oversized.json()).error.code).toBe("PAYLOAD_TOO_LARGE");

		for (let attempt = 0; attempt < 3; attempt += 1) {
			expect(
				(
					await app.request("/v1/auth/magic-links", {
						method: "POST",
						headers: {
							"Content-Type": "application/json",
							"Idempotency-Key": nextKey("magic-request"),
						},
						body: JSON.stringify({ email: "rate@example.com" }),
					})
				).status,
			).toBe(202);
		}
		const limited = await app.request("/v1/auth/magic-links", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": nextKey("magic-request"),
			},
			body: JSON.stringify({ email: "rate@example.com" }),
		});
		expect(limited.status).toBe(429);
		expect(limited.headers.get("Retry-After")).toBe("60");
		expect((await limited.json()).error.code).toBe("RATE_LIMITED");
	});

	test("fails closed when the auth rate-limit store is unavailable", async () => {
		const inspected: string[] = [];
		const failure = new Error();
		for (const property of ["message", "stack"] as const) {
			Object.defineProperty(failure, property, {
				get() {
					inspected.push(property);
					return "private@example.test token_private";
				},
			});
		}
		const deps = dependencies();
		deps.authRateLimiter = {
			consume() {
				throw failure;
			},
		};
		const response = await createApp(deps).request("/v1/auth/magic-links", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": nextKey("unavailable"),
			},
			body: JSON.stringify({ email: "private@example.test" }),
		});

		expect(response.status).toBe(503);
		expect(response.headers.get("Retry-After")).toBe("1");
		expect(await response.json()).toMatchObject({
			error: { code: "SERVICE_UNAVAILABLE", retryable: true },
		});
		expect(inspected).toEqual([]);
	});

	test("trusts one valid client address only from the configured Gateway", () => {
		const trusted = "172.30.0.10";
		expect(resolveClientKey("172.30.0.10", "198.51.100.9", trusted)).toBe(
			"198.51.100.9",
		);
		expect(resolveClientKey("172.30.0.10", "2001:db8::1", trusted)).toBe(
			"2001:db8::1",
		);
		expect(resolveClientKey("172.30.0.11", "198.51.100.9", trusted)).toBe(
			"172.30.0.11",
		);
		for (const forwarded of [
			undefined,
			"",
			"198.51.100.9, 203.0.113.8",
			"198.51.100.9:443",
			"not-an-ip",
		]) {
			expect(resolveClientKey("172.30.0.10", forwarded, trusted)).toBe(
				"172.30.0.10",
			);
		}
	});
});

describe("profile and device isolation", () => {
	test("derives /me only from the verified token and uses profile CAS", async () => {
		const app = createApp(dependencies());
		const magicToken = await requestLink(app);
		if (!magicToken) throw new Error("Expected magic link");
		const session = await redeem(app, magicToken);
		const headers = {
			Authorization: `Bearer ${session.accessToken}`,
			"Content-Type": "application/json",
			"X-User-ID": "usr_spoofed",
		};

		const me = await app.request("/v1/me", { headers });
		expect(me.status).toBe(200);
		expect(me.headers.get("Cache-Control")).toBe("private, no-store");
		expect((await me.json()).id).toBe(session.user.id);

		const updateKey = nextKey("profile");
		const updateBody = JSON.stringify({
			baseVersion: 1,
			changes: { displayName: "Mathias", locale: "de-CH" },
		});
		const update = (requestId: string) =>
			app.request("/v1/me", {
				method: "PATCH",
				headers: {
					...headers,
					"Idempotency-Key": updateKey,
					"X-Request-ID": requestId,
				},
				body: updateBody,
			});
		const updated = await update("profile.first");
		expect(updated.status).toBe(200);
		expect(updated.headers.get("Cache-Control")).toBe("private, no-store");
		const updatedBody = await updated.json();
		expect(updatedBody).toMatchObject({
			displayName: "Mathias",
			locale: "de-CH",
			version: 2,
		});
		const replayed = await update("profile.replay");
		expect(replayed.status).toBe(200);
		expect(replayed.headers.get("Idempotency-Replayed")).toBe("true");
		expect(replayed.headers.get("Cache-Control")).toBe("private, no-store");
		expect(await replayed.json()).toEqual(updatedBody);

		const keyReuse = await app.request("/v1/me", {
			method: "PATCH",
			headers: { ...headers, "Idempotency-Key": updateKey },
			body: JSON.stringify({
				baseVersion: 2,
				changes: { displayName: "Different" },
			}),
		});
		expect(keyReuse.status).toBe(409);
		expect((await keyReuse.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");

		const staleKey = nextKey("profile");
		const stale = await app.request("/v1/me", {
			method: "PATCH",
			headers: {
				...headers,
				"Idempotency-Key": staleKey,
				"X-Request-ID": "profile.stale.first",
			},
			body: JSON.stringify({
				baseVersion: 1,
				changes: { displayName: "Stale" },
			}),
		});
		expect(stale.status).toBe(409);
		expect((await stale.json()).error.code).toBe("VERSION_CONFLICT");
		const staleReplay = await app.request("/v1/me", {
			method: "PATCH",
			headers: {
				...headers,
				"Idempotency-Key": staleKey,
				"X-Request-ID": "profile.stale.replay",
			},
			body: JSON.stringify({
				baseVersion: 1,
				changes: { displayName: "Stale" },
			}),
		});
		expect(staleReplay.status).toBe(409);
		expect(staleReplay.headers.get("Idempotency-Replayed")).toBe("true");
		expect((await staleReplay.json()).error.requestId).toBe(
			"profile.stale.replay",
		);
	});

	test("scopes identical installation IDs to the authenticated user", async () => {
		const app = createApp(dependencies());
		const tokenA = await requestLink(app, "a@example.com");
		if (!tokenA) throw new Error("Expected first link");
		const userA = await redeem(app, tokenA);
		const tokenB = await requestLink(app, "b@example.com");
		if (!tokenB) throw new Error("Expected second link");
		const userB = await redeem(app, tokenB);
		const body = JSON.stringify({
			platform: "ios",
			pushToken: "push-token-1234567890",
			locale: "de-CH",
			timeZone: "Europe/Zurich",
			appVersion: "1.0.0",
			notificationsEnabled: true,
		});
		const put = (accessToken: string) =>
			app.request("/v1/me/devices/dvc_installation-123", {
				method: "PUT",
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/json",
				},
				body,
			});
		expect((await put(userA.accessToken)).status).toBe(200);
		expect((await put(userB.accessToken)).status).toBe(200);

		const listA = await app.request("/v1/me/devices", {
			headers: { Authorization: `Bearer ${userA.accessToken}` },
		});
		const listB = await app.request("/v1/me/devices", {
			headers: { Authorization: `Bearer ${userB.accessToken}` },
		});
		expect((await listA.json()).items).toHaveLength(1);
		expect((await listB.json()).items).toHaveLength(1);
		expect(repository.devices.size).toBe(2);
	});

	test("rejects missing or client-invented authentication", async () => {
		const app = createApp(dependencies());
		const response = await app.request("/v1/me", {
			headers: { "X-User-ID": "usr_fake" },
		});
		expect(response.status).toBe(401);
		expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
	});
});

describe("member directory profile resolution", () => {
	test("returns an exact ordered minimal set and reflects profile changes", async () => {
		const app = createApp({
			...dependencies(),
			memberDirectoryServiceVerifier: {
				verify: async (token) => token === "good-service",
			},
		});
		const firstLink = await requestLink(app, "directory-a@example.com");
		const secondLink = await requestLink(app, "directory-b@example.com");
		if (!firstLink || !secondLink) throw new Error("Expected directory links");
		const first = await redeem(app, firstLink);
		const second = await redeem(app, secondLink);
		await repository.updateProfile(
			first.user.id,
			1,
			{ displayName: "Ada" },
			clock,
		);

		const body = {
			schemaVersion: 1,
			rootEventId: "evt_directory",
			userIds: [second.user.id, first.user.id],
		};
		const resolve = () =>
			app.request("/v1/member-directory-profiles/resolve", {
				method: "POST",
				headers: {
					Authorization: "Bearer good-service",
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
			});
		const response = await resolve();
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		expect(await response.json()).toEqual({
			schemaVersion: 1,
			rootEventId: body.rootEventId,
			profiles: [
				{ userId: second.user.id, displayName: null, profileVersion: 1 },
				{ userId: first.user.id, displayName: "Ada", profileVersion: 2 },
			],
		});

		await repository.updateProfile(
			first.user.id,
			2,
			{ displayName: "Ada Updated" },
			new Date(clock.getTime() + 1_000),
		);
		expect((await (await resolve()).json()).profiles[1]).toEqual({
			userId: first.user.id,
			displayName: "Ada Updated",
			profileVersion: 3,
		});
	});

	test("requires purpose auth and rejects duplicate or incomplete sets atomically", async () => {
		const app = createApp({
			...dependencies(),
			memberDirectoryServiceVerifier: {
				verify: async (token) => token === "good-service",
			},
		});
		const path = "/v1/member-directory-profiles/resolve";
		const missingUserId = `usr_${"f".repeat(32)}`;
		const request = (
			userIds: string[],
			authorization = "Bearer good-service",
		) =>
			app.request(path, {
				method: "POST",
				headers: {
					Authorization: authorization,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					schemaVersion: 1,
					rootEventId: "evt_directory",
					userIds,
				}),
			});
		expect((await request([missingUserId], "Bearer wrong")).status).toBe(401);
		expect((await request([missingUserId, missingUserId])).status).toBe(400);
		const incomplete = await request([missingUserId]);
		expect(incomplete.status).toBe(409);
		expect((await incomplete.json()).error.code).toBe(
			"DIRECTORY_PROFILE_SET_INCOMPLETE",
		);
	});
});

describe("configuration and contract", () => {
	test("separates API, magic worker and push worker credentials", () => {
		const apiDevelopment = loadConfig({
			MAGIC_LINK_DELIVERY_URL: "https://mail.test/send",
		});
		expect(apiDevelopment.magicLinkAppUrl).toBe(
			"https://crew-haus.com/auth/redeem",
		);
		expect(apiDevelopment.memberDirectoryServiceCurrentKey).not.toBe(
			apiDevelopment.eventNotificationServiceCurrentKey,
		);
		expect(apiDevelopment).not.toHaveProperty("magicLinkDeliveryUrl");
		expect(apiDevelopment).not.toHaveProperty("deliveryWorkerLeaseMs");
		expect(() => loadConfig({ ACCESS_TOKEN_TTL_SECONDS: "59" })).toThrow();
		expect(
			loadConfig({ TRUSTED_GATEWAY_IP: "172.30.0.10" }).trustedGatewayIp,
		).toBe("172.30.0.10");
		expect(() => loadConfig({ TRUSTED_GATEWAY_IP: "not-an-ip" })).toThrow();
		expect(() => loadConfig({ NODE_ENV: "production" })).toThrow();
		const apiProduction = {
			NODE_ENV: "production",
			DATABASE_URL: "postgres://crew:secret@postgres/crew",
			RATE_LIMIT_REDIS_URL:
				"rediss://crew_user:production-secret@redis.example:6380/0",
			RATE_LIMIT_KEY: "EwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg",
			REFRESH_TOKEN_KEY: "production-refresh-key-that-is-long-enough",
			IDEMPOTENCY_PAYLOAD_CURRENT_KEY_ID: "production-idempotency-1",
			IDEMPOTENCY_PAYLOAD_CURRENT_KEY:
				"production-idempotency-payload-key-that-is-long-enough",
			MAGIC_LINK_APP_URL: "https://crew.example/auth/redeem",
			DELIVERY_PAYLOAD_CURRENT_KEY_ID: "production-1",
			DELIVERY_PAYLOAD_CURRENT_KEY:
				"TxsYmFtlYMVPT1UZKmSGicjfoc8lhZ0kGQ3FgIZavhs",
			PUSH_PAYLOAD_CURRENT_KEY_ID: "production-push-1",
			PUSH_PAYLOAD_CURRENT_KEY: "eKOfuEuHFGQeOZltcgU4hlzp3jYpRNrp3xvjzwjJkSE",
			EVENT_NOTIFICATION_SERVICE_CURRENT_KEY_ID: "production-event-1",
			EVENT_NOTIFICATION_SERVICE_CURRENT_KEY:
				"BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ",
			MEMBER_DIRECTORY_SERVICE_CURRENT_KEY_ID: "production-gateway-1",
			MEMBER_DIRECTORY_SERVICE_CURRENT_KEY:
				"AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
		};
		expect(() =>
			loadConfig({
				...apiProduction,
				MAGIC_LINK_APP_URL: "http://crew.example",
			}),
		).toThrow();
		expect(() =>
			loadConfig({
				...apiProduction,
				MEMBER_DIRECTORY_SERVICE_PREVIOUS_KEY_ID: "old",
			}),
		).toThrow();
		expect(() =>
			loadConfig({
				...apiProduction,
				MEMBER_DIRECTORY_SERVICE_CURRENT_KEY:
					apiProduction.EVENT_NOTIFICATION_SERVICE_CURRENT_KEY,
			}),
		).toThrow("separate secret domains");
		expect(() =>
			loadConfig({
				...apiProduction,
				PUSH_PAYLOAD_CURRENT_KEY: apiProduction.DELIVERY_PAYLOAD_CURRENT_KEY,
			}),
		).toThrow("separate secret domains");
		expect(() =>
			loadConfig({
				...apiProduction,
				MEMBER_DIRECTORY_SERVICE_PREVIOUS_KEY_ID: "old",
				MEMBER_DIRECTORY_SERVICE_PREVIOUS_KEY:
					apiProduction.MEMBER_DIRECTORY_SERVICE_CURRENT_KEY,
			}),
		).toThrow("must differ");
		expect(
			loadConfig({
				...apiProduction,
				MEMBER_DIRECTORY_SERVICE_PREVIOUS_KEY_ID: "old",
				MEMBER_DIRECTORY_SERVICE_PREVIOUS_KEY:
					"CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg",
			}).memberDirectoryServicePreviousKeyId,
		).toBe("old");
		expect(loadConfig(apiProduction).environment).toBe("production");
		expect(() =>
			loadConfig({
				...apiProduction,
				RATE_LIMIT_REDIS_URL: "redis://redis.example:6379/0",
			}),
		).toThrow("TLS and authenticated ACL");
		expect(() =>
			loadConfig({
				...apiProduction,
				RATE_LIMIT_REDIS_URL: "rediss://redis.example:6380/0",
			}),
		).toThrow("TLS and authenticated ACL");
		expect(() =>
			loadConfig({
				...apiProduction,
				RATE_LIMIT_KEY: apiProduction.DELIVERY_PAYLOAD_CURRENT_KEY,
			}),
		).toThrow("separate secret domain");
		expect(() =>
			loadConfig({
				...apiProduction,
				EVENT_NOTIFICATION_SERVICE_PREVIOUS_KEY_ID: "old",
			}),
		).toThrow();
		expect(() =>
			loadConfig({
				...apiProduction,
				IDEMPOTENCY_PAYLOAD_PREVIOUS_KEY_ID: "old",
			}),
		).toThrow("set together");
		expect(() =>
			loadConfig({
				...apiProduction,
				IDEMPOTENCY_PAYLOAD_PREVIOUS_KEY_ID:
					apiProduction.IDEMPOTENCY_PAYLOAD_CURRENT_KEY_ID,
				IDEMPOTENCY_PAYLOAD_PREVIOUS_KEY:
					"old-idempotency-payload-key-that-is-long-enough",
			}),
		).toThrow("IDs must be unique");
		expect(() =>
			loadConfig({
				...apiProduction,
				IDEMPOTENCY_PAYLOAD_PREVIOUS_KEY_ID: "old",
				IDEMPOTENCY_PAYLOAD_PREVIOUS_KEY:
					apiProduction.IDEMPOTENCY_PAYLOAD_CURRENT_KEY,
			}),
		).toThrow("material must be unique");
		expect(() =>
			loadConfig({
				...apiProduction,
				IDEMPOTENCY_PAYLOAD_PREVIOUS_KEY_ID: "old",
				IDEMPOTENCY_PAYLOAD_PREVIOUS_KEY:
					"crew-development-idempotency-payload-key-change-me",
			}),
		).toThrow("development material");
		expect(() =>
			loadConfig({
				...apiProduction,
				IDEMPOTENCY_PAYLOAD_CURRENT_KEY: apiProduction.REFRESH_TOKEN_KEY,
			}),
		).toThrow("separate secret domain");

		const magicWorkerProduction = {
			NODE_ENV: "production",
			DATABASE_URL: apiProduction.DATABASE_URL,
			MAGIC_LINK_APP_URL: apiProduction.MAGIC_LINK_APP_URL,
			MAGIC_LINK_DELIVERY_URL: "https://mail.example/send",
			MAGIC_LINK_DELIVERY_BEARER: "production-delivery-bearer",
			DELIVERY_PAYLOAD_CURRENT_KEY_ID:
				apiProduction.DELIVERY_PAYLOAD_CURRENT_KEY_ID,
			DELIVERY_PAYLOAD_CURRENT_KEY: apiProduction.DELIVERY_PAYLOAD_CURRENT_KEY,
		};
		expect(() =>
			loadDeliveryWorkerConfig({
				...magicWorkerProduction,
				MAGIC_LINK_DELIVERY_URL: "http://mail.example/send",
			}),
		).toThrow();
		expect(() =>
			loadDeliveryWorkerConfig({
				...magicWorkerProduction,
				DELIVERY_WORKER_LEASE_MS: "3000",
				MAGIC_LINK_DELIVERY_TIMEOUT_MS: "3000",
			}),
		).toThrow();
		expect(() =>
			loadDeliveryWorkerConfig({
				...magicWorkerProduction,
				DELIVERY_PAYLOAD_PREVIOUS_KEY_ID: "old",
			}),
		).toThrow();
		expect(() =>
			loadDeliveryWorkerConfig({
				...magicWorkerProduction,
				DELIVERY_PAYLOAD_PREVIOUS_KEY_ID: "old",
				DELIVERY_PAYLOAD_PREVIOUS_KEY:
					magicWorkerProduction.DELIVERY_PAYLOAD_CURRENT_KEY,
			}),
		).toThrow("must differ");
		const magicConfig = loadDeliveryWorkerConfig(magicWorkerProduction);
		expect(magicConfig).not.toHaveProperty("refreshTokenKey");
		expect(magicConfig).not.toHaveProperty("jwtPrivateKeyPath");
		const forbiddenDeliveryReads = new Set([
			"REFRESH_TOKEN_KEY",
			"JWT_PRIVATE_KEY_PATH",
			"JWT_PUBLIC_KEY_PATH",
			"JWT_ISSUER",
			"JWT_AUDIENCE",
			"IDEMPOTENCY_PAYLOAD_CURRENT_KEY",
		]);
		const inspectedDeliverySecrets: string[] = [];
		const guardedMagicWorkerEnvironment = new Proxy(magicWorkerProduction, {
			get(target, property, receiver) {
				if (
					typeof property === "string" &&
					forbiddenDeliveryReads.has(property)
				) {
					inspectedDeliverySecrets.push(property);
					throw new Error(`Delivery worker read API secret ${property}`);
				}
				return Reflect.get(target, property, receiver);
			},
		});
		expect(
			loadDeliveryWorkerConfig(guardedMagicWorkerEnvironment).environment,
		).toBe("production");
		expect(inspectedDeliverySecrets).toEqual([]);

		const retentionConfig = loadIdentityRetentionWorkerConfig({
			NODE_ENV: "production",
			DATABASE_URL: apiProduction.DATABASE_URL,
		});
		expect(retentionConfig).toEqual({
			environment: "production",
			databaseUrl: apiProduction.DATABASE_URL,
			batchSize: 100,
			pollMs: 60_000,
			magicLinkRetentionSeconds: 2_592_000,
			sessionRetentionSeconds: 2_592_000,
		});
		expect(retentionConfig).not.toHaveProperty("refreshTokenKey");
		expect(retentionConfig).not.toHaveProperty("jwtPrivateKeyPath");

		const pushWorkerProduction = {
			NODE_ENV: "production",
			DATABASE_URL: apiProduction.DATABASE_URL,
			PUSH_DELIVERY_URL: "https://push.example/send",
			PUSH_DELIVERY_BEARER: "production-push-bearer",
			PUSH_PAYLOAD_CURRENT_KEY_ID: apiProduction.PUSH_PAYLOAD_CURRENT_KEY_ID,
			PUSH_PAYLOAD_CURRENT_KEY: apiProduction.PUSH_PAYLOAD_CURRENT_KEY,
		};
		expect(() => loadDeliveryWorkerConfig(apiProduction)).toThrow(
			"requires provider configuration",
		);
		expect(() => loadPushWorkerConfig(apiProduction)).toThrow(
			"requires provider configuration",
		);
		const pushConfig = loadPushWorkerConfig(pushWorkerProduction);
		expect(pushConfig.environment).toBe("production");
		expect(pushConfig).not.toHaveProperty("refreshTokenKey");
		expect(pushConfig).not.toHaveProperty("magicLinkDeliveryBearer");
		expect(() =>
			loadPushWorkerConfig({
				...pushWorkerProduction,
				PUSH_WORKER_LEASE_MS: "1000",
				PUSH_DELIVERY_TIMEOUT_MS: "750",
			}),
		).toThrow("plus ack buffer");
		expect(() =>
			loadPushWorkerConfig({
				...pushWorkerProduction,
				PUSH_PAYLOAD_PREVIOUS_KEY_ID: "old",
				PUSH_PAYLOAD_PREVIOUS_KEY:
					pushWorkerProduction.PUSH_PAYLOAD_CURRENT_KEY,
			}),
		).toThrow("must differ");
	});

	test("serves probes, request IDs and the OpenAPI 3.1 identity contract", async () => {
		const app = createApp(dependencies());
		const live = await app.request("/internal/live", {
			headers: { "X-Request-ID": "crew.user.test" },
		});
		expect(live.status).toBe(200);
		expect(live.headers.get("X-Request-ID")).toBe("crew.user.test");
		const document = await (await app.request("/docs/openapi.json")).json();
		expect(document.openapi).toBe("3.1.0");
		expect(document.paths["/internal/live"]).toBeUndefined();
		expect(document.paths["/v1/me"].get.security).toEqual([{ userBearer: [] }]);
		expect(
			document.paths["/internal/v1/event-notifications"].post.security,
		).toEqual([{ serviceBearer: [] }]);
		expect(
			document.paths["/v1/member-directory-profiles/resolve"].post,
		).toMatchObject({
			operationId: "usersMemberDirectoryProfilesResolve",
			security: [{ serviceBearer: [] }],
			"x-gateway-compose-only": true,
		});
		expect(document.components.securitySchemes.serviceBearer).toMatchObject({
			type: "http",
			scheme: "bearer",
			bearerFormat: "JWT",
		});
		expect(document.paths["/.well-known/jwks.json"].get.security).toEqual([]);
		const magicCreate = document.paths["/v1/auth/magic-links"].post;
		expect(magicCreate["x-idempotency"]).toBe("required");
		expect(magicCreate.parameters).toContainEqual(
			expect.objectContaining({
				in: "header",
				name: "idempotency-key",
				required: true,
			}),
		);
		expect(Object.keys(magicCreate.responses)).toEqual(
			expect.arrayContaining(["409", "413", "429"]),
		);
	});

	test("never reflects token-shaped request IDs into responses or logs", async () => {
		const tokenShapedIds = [
			`ml_${"A".repeat(43)}`,
			`rt_${"B".repeat(43)}`,
			`cin_${"C".repeat(43)}`,
			`crs_${"D".repeat(43)}`,
			"eyJhbGciOiJSUzI1NiJ9.private.signature",
		];
		const logs: unknown[][] = [];
		const original = console.error;
		console.error = (...values: unknown[]) => logs.push(values);
		try {
			for (const token of tokenShapedIds) {
				const response = await createApp(dependencies(), () => {
					throw new Error("database row must stay private");
				}).request("/internal/ready", {
					headers: { "X-Request-ID": token },
				});
				const responseText = await response.text();
				const requestId = response.headers.get("X-Request-ID");

				expect(response.status).toBe(500);
				expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
				expect(responseText).not.toContain(token);
				expect(JSON.stringify(logs.at(-1))).toBe(
					JSON.stringify([
						"Unhandled request error",
						{ code: "INTERNAL_ERROR", requestId },
					]),
				);
			}
			const output = JSON.stringify(logs);
			for (const token of tokenShapedIds) expect(output).not.toContain(token);
		} finally {
			console.error = original;
		}
	});
});
