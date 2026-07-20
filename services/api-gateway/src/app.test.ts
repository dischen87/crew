import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { MemoryRateLimiter, type RateLimiter } from "./security";

const ISSUER = "https://identity.crew.test";
const AUDIENCE = "crew-mobile";
const KEY_ID = "test-rsa-1";
const ACTOR_ID = "usr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

let rsaPrivateKey: CryptoKey;
let wrongRsaPrivateKey: CryptoKey;
let ecPrivateKey: CryptoKey;
let jwksServer: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
	const rsa = await generateKeyPair("RS256");
	const wrongRsa = await generateKeyPair("RS256");
	const ec = await generateKeyPair("ES256");
	rsaPrivateKey = rsa.privateKey;
	wrongRsaPrivateKey = wrongRsa.privateKey;
	ecPrivateKey = ec.privateKey;
	const publicJwk = await exportJWK(rsa.publicKey);
	const jwks = {
		keys: [{ ...publicJwk, alg: "RS256", kid: KEY_ID, use: "sig" }],
	};
	jwksServer = Bun.serve({
		port: 0,
		fetch: () => Response.json(jwks),
	});
});

afterAll(() => jwksServer.stop(true));

function app(rateLimiter?: RateLimiter) {
	return createApp({
		config: loadConfig({
			USER_SERVICE_JWKS_URL: `http://127.0.0.1:${jwksServer.port}/.well-known/jwks.json`,
			USER_TOKEN_ISSUER: ISSUER,
			USER_TOKEN_AUDIENCE: AUDIENCE,
			JWKS_COOLDOWN_MS: "1000",
			JWKS_CACHE_MS: "60000",
		}),
		clientIp: () => "198.51.100.7",
		rateLimiter: rateLimiter ?? new MemoryRateLimiter(10_000, 60_000, 10_000),
	});
}

async function token(
	options: {
		algorithm?: "RS256" | "ES256";
		issuer?: string;
		audience?: string;
		subject?: string;
		expiresAt?: number;
		key?: CryptoKey;
		keyId?: string;
	} = {},
) {
	const algorithm = options.algorithm ?? "RS256";
	const now = Math.floor(Date.now() / 1_000);
	return new SignJWT({})
		.setProtectedHeader({ alg: algorithm, kid: options.keyId ?? KEY_ID })
		.setIssuer(options.issuer ?? ISSUER)
		.setAudience(options.audience ?? AUDIENCE)
		.setSubject(options.subject ?? ACTOR_ID)
		.setIssuedAt(now)
		.setExpirationTime(options.expiresAt ?? now + 120)
		.sign(
			options.key ?? (algorithm === "ES256" ? ecPrivateKey : rsaPrivateKey),
		);
}

async function expectUnauthenticated(accessToken: string) {
	const response = await app().request("/core/v1/session", {
		headers: { Authorization: `Bearer ${accessToken}` },
	});
	expect(response.status).toBe(401);
	expect(await response.json()).toMatchObject({
		error: { code: "UNAUTHENTICATED", retryable: false },
	});
}

describe("api-gateway identity edge", () => {
	test("accepts RS256 and derives the actor only from sub", async () => {
		const response = await app().request("/core/v1/session", {
			headers: {
				Authorization: `Bearer ${await token()}`,
				"X-Actor-ID": "usr_spoofed",
				"X-User-ID": "usr_spoofed",
				"X-Request-ID": "crew.request.test",
			},
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("X-Request-ID")).toBe("crew.request.test");
		expect(await response.json()).toEqual({ actor: { id: ACTOR_ID } });
	});

	test("rejects a token with an invalid signature", async () => {
		await expectUnauthenticated(await token({ key: wrongRsaPrivateKey }));
	});

	test("rejects an expired token", async () => {
		await expectUnauthenticated(
			await token({ expiresAt: Math.floor(Date.now() / 1_000) - 1 }),
		);
	});

	test("rejects a token from the wrong issuer", async () => {
		await expectUnauthenticated(
			await token({ issuer: "https://attacker.test" }),
		);
	});

	test("rejects a token for the wrong audience", async () => {
		await expectUnauthenticated(await token({ audience: "other-client" }));
	});

	test("rejects a noncanonical user subject", async () => {
		await expectUnauthenticated(await token({ subject: "usr_real" }));
	});

	test("rejects every signing algorithm except RS256", async () => {
		await expectUnauthenticated(
			await token({ algorithm: "ES256", keyId: "test-ec-1" }),
		);
	});

	test("rejects missing bearer authentication", async () => {
		const response = await app().request("/core/v1/session");
		expect(response.status).toBe(401);
		expect((await response.json()).error.code).toBe("UNAUTHENTICATED");
	});

	test("bounds verification calls before invoking the JWT verifier", async () => {
		let verificationCalls = 0;
		const gateway = createApp({
			config: loadConfig(),
			clientIp: () => "198.51.100.7",
			rateLimiter: new MemoryRateLimiter(1, 60_000, 10),
			verifyUserToken: async () => {
				verificationCalls += 1;
				throw new Error("invalid");
			},
		});
		const headers = { Authorization: "Bearer invalid" };
		expect(
			(await gateway.request("/core/v1/session", { headers })).status,
		).toBe(401);
		const limited = await gateway.request("/core/v1/session", { headers });
		expect(limited.status).toBe(429);
		expect(limited.headers.get("Retry-After")).toBe("60");
		expect(verificationCalls).toBe(1);
	});

	test("rate limits each verified principal with Retry-After", async () => {
		const principalKey = `request:principal:${ACTOR_ID}`;
		const consumed: string[] = [];
		const limiter: RateLimiter = {
			consume(key) {
				consumed.push(key);
				if (
					key === principalKey &&
					consumed.filter((candidate) => candidate === key).length > 1
				) {
					return { allowed: false, retryAfterSeconds: 60 };
				}
				return { allowed: true, remaining: 99 };
			},
		};
		const gateway = app(limiter);
		const headers = { Authorization: `Bearer ${await token()}` };
		expect(
			(await gateway.request("/core/v1/session", { headers })).status,
		).toBe(200);
		const limited = await gateway.request("/core/v1/session", { headers });
		expect(limited.status).toBe(429);
		expect(limited.headers.get("Retry-After")).toBe("60");
		expect(await limited.json()).toMatchObject({
			error: { code: "RATE_LIMITED", retryable: true },
		});
		expect(consumed).toEqual([
			"authentication-attempt:ip:198.51.100.7",
			principalKey,
			"authentication-attempt:ip:198.51.100.7",
			principalKey,
		]);
	});

	test("fails closed when the rate-limit store is unavailable without inspecting its error", async () => {
		const inspected: string[] = [];
		const failure = new Error();
		for (const property of ["message", "stack"] as const) {
			Object.defineProperty(failure, property, {
				get() {
					inspected.push(property);
					return "198.51.100.9 usr_private";
				},
			});
		}
		const gateway = app({
			consume() {
				throw failure;
			},
		});
		const response = await gateway.request("/core/v1/session", {
			headers: { Authorization: `Bearer ${await token()}` },
		});

		expect(response.status).toBe(503);
		expect(response.headers.get("Retry-After")).toBe("1");
		expect(await response.json()).toMatchObject({
			error: { code: "SERVICE_UNAVAILABLE", retryable: true },
		});
		expect(inspected).toEqual([]);
	});
});

describe("api-gateway contract and platform routes", () => {
	test("validates bounded security configuration", () => {
		expect(() => loadConfig({ JWKS_CACHE_MS: "999" })).toThrow();
		expect(() => loadConfig({ RATE_LIMIT_COMMAND_TIMEOUT_MS: "9" })).toThrow();
		expect(
			loadConfig({ DOWNSTREAM_TIMEOUT_MS: "3100" }).downstreamTimeoutMs,
		).toBe(3100);
		const production = {
			NODE_ENV: "production",
			RATE_LIMIT_REDIS_URL:
				"rediss://crew_gateway:production-secret@redis.example:6380/0",
			RATE_LIMIT_KEY: "EAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg",
		};
		expect(loadConfig(production).environment).toBe("production");
		expect(() =>
			loadConfig({
				...production,
				RATE_LIMIT_REDIS_URL: "redis://redis.example:6379/0",
			}),
		).toThrow("TLS and authenticated ACL");
		expect(() =>
			loadConfig({
				...production,
				RATE_LIMIT_REDIS_URL: "rediss://redis.example:6380/0",
			}),
		).toThrow("TLS and authenticated ACL");
		expect(() =>
			loadConfig({
				NODE_ENV: "production",
				RATE_LIMIT_KEY: production.RATE_LIMIT_KEY,
			}),
		).toThrow("TLS and authenticated ACL");
		expect(() =>
			loadConfig({
				...production,
				RATE_LIMIT_KEY: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
			}),
		).toThrow("separate secret domain");
	});

	test("replaces invalid request IDs", async () => {
		for (const requestId of [
			"bad request",
			`cin_${"A".repeat(43)}`,
			`crs_${"B".repeat(43)}`,
		]) {
			const response = await app().request("/internal/live", {
				headers: { "X-Request-ID": requestId },
			});
			expect(response.status).toBe(200);
			expect(response.headers.get("X-Request-ID")).toMatch(
				/^[0-9a-f]{8}-[0-9a-f-]{27}$/,
			);
			expect(response.headers.get("X-Request-ID")).not.toBe(requestId);
		}
	});

	test("uses the common error envelope when unready", async () => {
		const response = await createApp({
			rateLimiter: new MemoryRateLimiter(10_000, 60_000, 10_000),
			readiness: () => false,
		}).request("/internal/ready");
		expect(response.status).toBe(503);
		expect((await response.json()).error.code).toBe("SERVICE_UNAVAILABLE");
		expect(response.headers.get("X-Request-ID")).toBeTruthy();
	});

	test("redacts unhandled errors without inspecting them", async () => {
		const requestId = "crew.request.unhandled";
		const secrets = [
			"person@example.com",
			"Bearer token_secret_123",
			"duplicate key value violates constraint; row=(usr_private)",
		];
		const inspected: string[] = [];
		const failure = new Error();
		for (const property of ["message", "detail", "stack", "row"] as const) {
			Object.defineProperty(failure, property, {
				configurable: true,
				get() {
					inspected.push(property);
					return secrets.join(" ");
				},
			});
		}
		Object.defineProperty(failure, "toJSON", {
			configurable: true,
			value() {
				inspected.push("toJSON");
				return { secrets };
			},
		});

		const logs: unknown[][] = [];
		const originalConsoleError = console.error;
		console.error = (...values: unknown[]) => logs.push(values);
		try {
			const response = await createApp({
				rateLimiter: new MemoryRateLimiter(10_000, 60_000, 10_000),
				readiness: () => {
					throw failure;
				},
			}).request("/internal/ready", {
				headers: { "X-Request-ID": requestId },
			});
			const responseText = await response.text();

			expect(response.status).toBe(500);
			expect(JSON.parse(responseText)).toEqual({
				error: {
					code: "INTERNAL_ERROR",
					message: "Internal server error.",
					requestId,
					retryable: false,
				},
			});
			expect(logs).toEqual([
				["Unhandled request error", { requestId, code: "INTERNAL_ERROR" }],
			]);
			expect(inspected).toEqual([]);
			const publicOutput = `${responseText}\n${JSON.stringify(logs)}`;
			for (const secret of secrets) expect(publicOutput).not.toContain(secret);
		} finally {
			console.error = originalConsoleError;
		}
	});

	test("publishes only canonical /core mobile routes in OpenAPI 3.1", async () => {
		const document = await (await app().request("/docs/openapi.json")).json();
		expect(document.openapi).toBe("3.1.0");
		expect(document.paths["/core/v1/session"].get).toMatchObject({
			operationId: "usersSessionGet",
			security: [{ userBearer: [] }],
		});
		expect(document.paths["/core/v1/auth/magic-links"].post.security).toEqual(
			[],
		);
		expect(document.paths["/core/v1/event-roots"].post.security).toEqual([
			{ userBearer: [] },
		]);
		expect(
			document.paths["/core/v1/sync/push"].post["x-max-decoded-body-bytes"],
		).toBe(1_048_576);
		expect(
			Object.keys(document.paths).every((path) => path.startsWith("/core/v1")),
		).toBe(true);
		expect(
			Object.keys(document.paths).some((path) => path.startsWith("/internal")),
		).toBe(false);
		expect(document.paths["/.well-known/jwks.json"]).toBeUndefined();
		expect(document.paths["/internal/live"]).toBeUndefined();
		expect(document.paths["/v1/session"]).toBeUndefined();
		const recapResolveResponses =
			document.paths["/core/v1/recap-share-links/resolve"].post.responses;
		expect(recapResolveResponses["400"]).toBeUndefined();
		expect(recapResolveResponses["404"]).toBeDefined();
		const externalResolve =
			document.paths["/core/v1/recap-external-share-links/resolve"].post;
		expect(externalResolve.operationId).toBe(
			"eventRecapExternalShareLinksResolve",
		);
		expect(externalResolve.security).toEqual([]);
		expect(externalResolve.responses["400"]).toBeUndefined();
		expect(externalResolve.responses["404"]).toBeDefined();
		expect(
			document.paths["/core/v1/event-roots/{rootEventId}/recap/external-grants"]
				.post.operationId,
		).toBe("eventRecapExternalGrantsDecide");
		expect(
			document.paths[
				"/core/v1/event-roots/{rootEventId}/recap/external-share-links"
			].post.operationId,
		).toBe("eventRecapExternalShareLinksCreate");
		expect(document.components.securitySchemes.userBearer).toMatchObject({
			scheme: "bearer",
			type: "http",
		});
	});

	test("does not serve the legacy unprefixed session route", async () => {
		const response = await app().request("/v1/session", {
			headers: { Authorization: `Bearer ${await token()}` },
		});
		expect(response.status).toBe(404);
	});
});
