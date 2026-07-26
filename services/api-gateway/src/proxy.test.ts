import { describe, expect, test } from "bun:test";
import { jwtVerify } from "jose";
import contractLock from "../contracts/contracts.lock.json";
import eventContract from "../contracts/event-service.openapi.json";
import userContract from "../contracts/user-service.openapi.json";
import { createApp } from "./app";
import { loadConfig } from "./config";
import type { Fetch } from "./proxy";
import { MemoryRateLimiter } from "./security";

const requestId = "crew.gateway.proxy.test";
const ACTOR_A = "usr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ACTOR_B = "usr_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const config = loadConfig({
	USER_SERVICE_URL: "https://user.test",
	EVENT_SERVICE_URL: "https://event.test",
	DOWNSTREAM_TIMEOUT_MS: "100",
});
const verifyUserToken = async (token: string) => {
	if (!token.startsWith("good")) throw new Error("invalid");
	return { id: token.endsWith("b") ? ACTOR_B : ACTOR_A };
};

function gateway(
	fetcher: Fetch,
	rateLimiter?: MemoryRateLimiter,
	gatewayConfig = config,
) {
	return createApp({
		config: gatewayConfig,
		fetch: fetcher,
		verifyUserToken,
		clientIp: () => "198.51.100.7",
		rateLimiter: rateLimiter ?? new MemoryRateLimiter(10_000, 60_000, 10_000),
	});
}

function upstreamJson(
	body: unknown,
	status: number,
	headers: Record<string, string> = {},
): Response {
	return Response.json(body, {
		status,
		headers: { "X-Request-ID": requestId, ...headers },
	});
}

function errorEnvelope(code: string, message: string, retryable = false) {
	return { error: { code, message, requestId, retryable } };
}

const event = {
	id: "evt_root",
	rootEventId: "evt_root",
	parentEventId: null,
	kind: "trip",
	title: "Crew trip",
	description: null,
	timeZone: "Europe/Zurich",
	startsAt: "2026-07-18T08:00:00.000Z",
	endsAt: null,
	sortKey: "1",
	childOrderVersion: 1,
	itineraryOrderVersion: 1,
	status: "draft",
	version: 1,
	createdAt: "2026-07-18T08:00:00.000Z",
	updatedAt: "2026-07-18T08:00:00.000Z",
};

const user = {
	id: ACTOR_A,
	email: "crew@example.test",
	profile: {
		displayName: "Crew",
		avatarUrl: null,
		locale: "de-CH",
		timeZone: "Europe/Zurich",
		reduceMotion: false,
		eventReminders: true,
		productUpdates: false,
		version: 1,
		updatedAt: "2026-07-18T08:00:00.000Z",
	},
};

describe("generated gateway proxy", () => {
	test("publishes every pinned operation only below /core/v1", async () => {
		const app = gateway(async () => {
			throw new Error("not called");
		});
		const document = await (await app.request("/docs/openapi.json")).json();
		const expected = new Set([
			"usersSessionGet",
			"eventMemberDirectoryGet",
			...operationIds(userContract),
			...operationIds(eventContract),
		]);
		expected.delete("usersMemberDirectoryProfilesResolve");
		expected.delete("eventMemberDirectorySourceGet");
		const actual = new Set(operationIds(document));

		expect(actual).toEqual(expected);
		expect(
			[...Object.keys(document.paths)].every((path) =>
				path.startsWith("/core/v1"),
			),
		).toBe(true);
		expect(document.paths["/.well-known/jwks.json"]).toBeUndefined();
		expect(
			document.paths[
				"/core/v1/event-roots/{rootEventId}/member-directory-source"
			],
		).toBeUndefined();
		expect(
			document.paths["/core/v1/member-directory-profiles/resolve"],
		).toBeUndefined();
		expect(
			document.components.schemas.UserServiceMemberDirectoryProfile,
		).toBeUndefined();
		expect(JSON.stringify(document)).not.toContain("profileVersion");
		expect(
			Object.keys(document.paths).some((path) => path.startsWith("/internal")),
		).toBe(false);
		const duplicateSuggestions =
			document.paths[
				"/core/v1/event-roots/{rootEventId}/feedback/duplicate-suggestions"
			].get;
		expect(duplicateSuggestions).toMatchObject({
			operationId: "eventFeedbackDuplicateSuggestionsList",
			security: [{ userBearer: [] }],
			"x-idempotency": "none",
			"x-pagination": {
				maxLimit: 5,
				cursorBinding: ["principal", "rootEventId", "q"],
			},
		});
		expect(duplicateSuggestions.responses["429"].headers).toHaveProperty(
			"Retry-After",
		);
		const suggestion =
			document.components.schemas
				.EventServiceCommunityFeedbackDuplicateSuggestion;
		expect(suggestion.additionalProperties).toBe(false);
		expect(Object.keys(suggestion.properties)).toEqual([
			"id",
			"title",
			"status",
			"voteCount",
		]);
		for (const contract of Object.values(contractLock.contracts) as Array<{
			sourceCommit: string | null;
			sourceState: string;
		}>) {
			if (contract.sourceState === "worktree") {
				expect(contract.sourceCommit).toBeNull();
			} else {
				expect(contract.sourceState).toBe("committed");
				expect(contract.sourceCommit).toMatch(/^[a-f0-9]{40}$/);
			}
		}
	});

	test("composes only authorized Event IDs into the minimal current member directory", async () => {
		let displayName = "Ada";
		let userCalls = 0;
		const app = gateway(
			async (input, init) => {
				const url = String(input);
				const headers = new Headers(init?.headers);
				if (url.startsWith("https://event.test/")) {
					expect(url).toBe(
						"https://event.test/v1/event-roots/evt_root/member-directory-source?limit=2&cursor=signed-cursor-1234",
					);
					expect(headers.get("Authorization")).toBe("Bearer good-a");
					return upstreamJson(
						{
							schemaVersion: 1,
							rootEventId: "evt_root",
							userIds: [ACTOR_A, ACTOR_B],
							pageInfo: { nextCursor: "next-signed-cursor", hasMore: true },
						},
						200,
					);
				}
				userCalls += 1;
				expect(url).toBe(
					"https://user.test/v1/member-directory-profiles/resolve",
				);
				expect(headers.get("Authorization")).not.toBe("Bearer good-a");
				const serviceToken = headers
					.get("Authorization")
					?.slice("Bearer ".length);
				if (!serviceToken) throw new Error("Missing service token");
				const verified = await jwtVerify(
					serviceToken,
					Buffer.from(config.memberDirectoryServiceCurrentKey, "base64url"),
					{
						algorithms: ["HS256"],
						issuer: config.memberDirectoryServiceIssuer,
						audience: config.memberDirectoryServiceAudience,
					},
				);
				expect(verified.payload).toMatchObject({
					sub: "api-gateway",
					scope: "user:member-directory:read",
				});
				expect(await new Response(init?.body).json()).toEqual({
					schemaVersion: 1,
					rootEventId: "evt_root",
					userIds: [ACTOR_A, ACTOR_B],
				});
				return upstreamJson(
					{
						schemaVersion: 1,
						rootEventId: "evt_root",
						profiles: [
							{ userId: ACTOR_A, displayName, profileVersion: userCalls },
							{ userId: ACTOR_B, displayName: null, profileVersion: 4 },
						],
					},
					200,
					{ "Cache-Control": "private, no-store" },
				);
			},
			undefined,
			{ ...config, downstreamTimeoutMs: 1_000 },
		);
		const request = () =>
			app.request(
				"/core/v1/event-roots/evt_root/member-directory?limit=2&cursor=signed-cursor-1234",
				{
					headers: {
						Authorization: "Bearer good-a",
						"X-Request-ID": requestId,
					},
				},
			);
		const first = await request();
		expect(first.status).toBe(200);
		expect(first.headers.get("Cache-Control")).toBe("private, no-store");
		expect(await first.json()).toEqual({
			items: [
				{ userId: ACTOR_A, displayName: "Ada" },
				{ userId: ACTOR_B, displayName: null },
			],
			pageInfo: { nextCursor: "next-signed-cursor", hasMore: true },
		});

		displayName = "Ada Updated";
		expect((await (await request()).json()).items[0].displayName).toBe(
			"Ada Updated",
		);
		expect(userCalls).toBe(2);
	});

	test("never accepts caller IDs and fails closed on mixed or private profile sets", async () => {
		let calls = 0;
		const noEnumeration = await gateway(async () => {
			calls += 1;
			return upstreamJson({}, 200);
		}).request(
			`/core/v1/event-roots/evt_root/member-directory?userId=${ACTOR_B}`,
			{
				headers: {
					Authorization: "Bearer good-a",
					"X-Request-ID": requestId,
				},
			},
		);
		expect(noEnumeration.status).toBe(400);
		expect(calls).toBe(0);

		for (const profiles of [
			[{ userId: ACTOR_B, displayName: null, profileVersion: 1 }],
			[
				{
					userId: ACTOR_A,
					displayName: "Ada",
					profileVersion: 1,
					email: "secret@example.test",
				},
			],
		]) {
			const response = await gateway(async (input) => {
				if (String(input).startsWith("https://event.test/")) {
					return upstreamJson(
						{
							schemaVersion: 1,
							rootEventId: "evt_root",
							userIds: [ACTOR_A],
							pageInfo: { nextCursor: null, hasMore: false },
						},
						200,
					);
				}
				return upstreamJson(
					{ schemaVersion: 1, rootEventId: "evt_root", profiles },
					200,
				);
			}).request("/core/v1/event-roots/evt_root/member-directory", {
				headers: {
					Authorization: "Bearer good-a",
					"X-Request-ID": requestId,
				},
			});
			expect(response.status).toBe(502);
			expect((await response.json()).error.code).toBe("UPSTREAM_ERROR");
		}
	});

	test("preserves concealed Event denials and never calls User for empty pages", async () => {
		let userCalled = false;
		const denied = await gateway(async (input) => {
			if (String(input).startsWith("https://user.test/")) userCalled = true;
			return upstreamJson(
				errorEnvelope("NOT_FOUND", "Resource not found."),
				404,
			);
		}).request("/core/v1/event-roots/evt_foreign/member-directory", {
			headers: {
				Authorization: "Bearer good-a",
				"X-Request-ID": requestId,
			},
		});
		expect(denied.status).toBe(404);
		expect(await denied.json()).toEqual(
			errorEnvelope("NOT_FOUND", "Resource not found."),
		);
		expect(userCalled).toBe(false);

		const empty = await gateway(async (input) => {
			if (String(input).startsWith("https://user.test/")) userCalled = true;
			return upstreamJson(
				{
					schemaVersion: 1,
					rootEventId: "evt_root",
					userIds: [],
					pageInfo: { nextCursor: null, hasMore: false },
				},
				200,
			);
		}).request("/core/v1/event-roots/evt_root/member-directory", {
			headers: {
				Authorization: "Bearer good-a",
				"X-Request-ID": requestId,
			},
		});
		expect(empty.status).toBe(200);
		expect(await empty.json()).toEqual({
			items: [],
			pageInfo: { nextCursor: null, hasMore: false },
		});
		expect(userCalled).toBe(false);
	});

	test("keeps one deadline across composition and bounds a stalled User body", async () => {
		const startedAt = performance.now();
		const response = await gateway(async (input) => {
			if (String(input).startsWith("https://event.test/")) {
				return upstreamJson(
					{
						schemaVersion: 1,
						rootEventId: "evt_root",
						userIds: [ACTOR_A],
						pageInfo: { nextCursor: null, hasMore: false },
					},
					200,
				);
			}
			return new Response(
				new ReadableStream<Uint8Array>({
					cancel: () => new Promise<void>(() => undefined),
				}),
				{
					status: 200,
					headers: {
						"Content-Type": "application/json",
						"X-Request-ID": requestId,
					},
				},
			);
		}).request("/core/v1/event-roots/evt_root/member-directory", {
			headers: {
				Authorization: "Bearer good-a",
				"X-Request-ID": requestId,
			},
		});
		expect(response.status).toBe(504);
		expect((await response.json()).error.code).toBe("UPSTREAM_TIMEOUT");
		expect(performance.now() - startedAt).toBeLessThan(500);
	});

	test("maps an unavailable profile resolver without returning a partial page", async () => {
		const response = await gateway(async (input) => {
			if (String(input).startsWith("https://event.test/")) {
				return upstreamJson(
					{
						schemaVersion: 1,
						rootEventId: "evt_root",
						userIds: [ACTOR_A],
						pageInfo: { nextCursor: null, hasMore: false },
					},
					200,
				);
			}
			throw new Error("private network cause");
		}).request("/core/v1/event-roots/evt_root/member-directory", {
			headers: {
				Authorization: "Bearer good-a",
				"X-Request-ID": requestId,
			},
		});
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual(
			errorEnvelope(
				"SERVICE_UNAVAILABLE",
				"A required service is unavailable.",
				true,
			),
		);
	});

	test("maps public auth to user-service without forwarding a caller bearer", async () => {
		const body = '{"email":"crew@example.test"}';
		const responseBody = '{\n  "accepted": true\n}\n';
		const app = gateway(async (input, init) => {
			expect(String(input)).toBe("https://user.test/v1/auth/magic-links");
			expect(init?.redirect).toBe("manual");
			const headers = new Headers(init?.headers);
			expect(headers.get("Authorization")).toBeNull();
			expect(headers.get("Idempotency-Key")).toBe("idem.auth.123");
			expect(headers.get("X-Request-ID")).toBe(requestId);
			expect(headers.get("X-Forwarded-For")).toBe("198.51.100.7");
			expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(body);
			return new Response(responseBody, {
				status: 202,
				headers: {
					"Content-Type": "application/json; charset=utf-8",
					"X-Request-ID": requestId,
					"Idempotency-Replayed": "true",
					"Set-Cookie": "secret=never-forward",
					"X-Upstream-Internal": "never-forward",
				},
			});
		});

		const response = await app.request("/core/v1/auth/magic-links", {
			method: "POST",
			headers: {
				Authorization: "Bearer attacker-supplied",
				"Content-Type": "application/json; charset=utf-8",
				"Idempotency-Key": "idem.auth.123",
				"X-Request-ID": requestId,
				"X-Forwarded-For": "203.0.113.99",
			},
			body,
		});

		expect(response.status).toBe(202);
		expect(await response.text()).toBe(responseBody);
		expect(response.headers.get("Idempotency-Replayed")).toBe("true");
		expect(response.headers.get("Set-Cookie")).toBeNull();
		expect(response.headers.get("X-Upstream-Internal")).toBeNull();
	});

	test("preserves private no-store on replayed credential responses", async () => {
		const token = `ml_${"a".repeat(43)}`;
		const body = JSON.stringify({ token });
		const session = {
			accessToken: "access-token",
			refreshToken: `rt_${"b".repeat(43)}`,
			tokenType: "Bearer",
			expiresInSeconds: 900,
			user,
		};
		const app = gateway(async (input, init) => {
			expect(String(input)).toBe(
				"https://user.test/v1/auth/magic-links/redeem",
			);
			const headers = new Headers(init?.headers);
			expect(headers.get("Authorization")).toBeNull();
			expect(headers.get("Idempotency-Key")).toBe("idem.redeem.123");
			expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(body);
			return upstreamJson(session, 200, {
				"Cache-Control": "private, no-store",
				"Idempotency-Replayed": "true",
			});
		});
		const response = await app.request("/core/v1/auth/magic-links/redeem", {
			method: "POST",
			headers: {
				Authorization: "Bearer attacker-supplied",
				"Content-Type": "application/json",
				"Idempotency-Key": "idem.redeem.123",
				"X-Request-ID": requestId,
			},
			body,
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		expect(response.headers.get("Idempotency-Replayed")).toBe("true");
		expect(await response.json()).toEqual(session);
	});

	test("preserves private no-store for profile reads and invitation tokens", async () => {
		const profile = await gateway(async (input) => {
			expect(String(input)).toBe("https://user.test/v1/me");
			return upstreamJson(user, 200, {
				"Cache-Control": "private, no-store",
			});
		}).request("/core/v1/me", {
			headers: {
				Authorization: "Bearer good-a",
				"X-Request-ID": requestId,
			},
		});
		expect(profile.status).toBe(200);
		expect(profile.headers.get("Cache-Control")).toBe("private, no-store");

		const requestBody = JSON.stringify({
			id: "inv_gateway01",
			role: "participant",
			expiresAt: "2026-07-19T08:00:00.000Z",
			maxUses: 1,
		});
		const invitation = {
			id: "inv_gateway01",
			rootEventId: event.rootEventId,
			role: "participant",
			normalizedEmailHint: null,
			expiresAt: "2026-07-19T08:00:00.000Z",
			maxUses: 1,
			useCount: 0,
			status: "active",
			version: 1,
			createdAt: "2026-07-18T08:00:00.000Z",
			updatedAt: "2026-07-18T08:00:00.000Z",
		};
		const created = await gateway(async (input, init) => {
			expect(String(input)).toBe(
				"https://event.test/v1/event-roots/evt_root/invitations",
			);
			expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(
				requestBody,
			);
			return upstreamJson({ invitation, token: `cin_${"a".repeat(43)}` }, 201, {
				Location:
					"https://event.test/v1/event-roots/evt_root/invitations/inv_gateway01",
				"Cache-Control": "private, no-store",
				"Idempotency-Replayed": "true",
			});
		}).request("/core/v1/event-roots/evt_root/invitations", {
			method: "POST",
			headers: {
				Authorization: "Bearer good-a",
				"Content-Type": "application/json",
				"Idempotency-Key": "idem.invitation.123",
				"X-Request-ID": requestId,
			},
			body: requestBody,
		});
		expect(created.status).toBe(201);
		expect(created.headers.get("Cache-Control")).toBe("private, no-store");
		expect(created.headers.get("Idempotency-Replayed")).toBe("true");
		expect(created.headers.get("Location")).toBe(
			"/core/v1/event-roots/evt_root/invitations/inv_gateway01",
		);
		expect((await created.json()).token).toStartWith("cin_");
	});

	test("forwards protected event writes and rewrites only safe response headers", async () => {
		const body =
			'{"id":"evt_root","kind":"trip","title":"Crew trip","timeZone":"Europe/Zurich"}';
		const app = gateway(async (input, init) => {
			expect(String(input)).toBe("https://event.test/v1/event-roots");
			expect(init?.redirect).toBe("manual");
			const headers = new Headers(init?.headers);
			expect(headers.get("Authorization")).toBe("Bearer good-a");
			expect(headers.get("Idempotency-Key")).toBe("idem.event.123");
			expect(headers.get("X-Request-ID")).toBe(requestId);
			expect(headers.get("X-Forwarded-For")).toBeNull();
			expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(body);
			return upstreamJson({ event }, 201, {
				Location: "https://event.test/v1/event-roots/evt_root?view=tree",
				"Idempotency-Replayed": "true",
				"Cache-Control": "private, no-store",
				"Set-Cookie": "internal=secret",
			});
		});

		const response = await app.request("/core/v1/event-roots", {
			method: "POST",
			headers: {
				Authorization: "Bearer good-a",
				"Content-Type": "application/json",
				"Idempotency-Key": "idem.event.123",
				"X-Request-ID": requestId,
			},
			body,
		});

		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ event });
		expect(response.headers.get("Location")).toBe(
			"/core/v1/event-roots/evt_root?view=tree",
		);
		expect(response.headers.get("Idempotency-Replayed")).toBe("true");
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		expect(response.headers.get("Set-Cookie")).toBeNull();
	});

	test("proxies authoritative readiness and the explicit versioned publish command", async () => {
		const readiness = {
			schemaVersion: 1,
			rootEventId: event.rootEventId,
			rootStatus: "draft" as const,
			rootVersion: event.version,
			rootRevision: "3",
			template: { id: "team-event", version: 1 },
			ready: true,
			reasons: [],
		};
		const publishBody = JSON.stringify({
			baseVersion: readiness.rootVersion,
			baseRevision: readiness.rootRevision,
		});
		const upstreamPaths: string[] = [];
		const app = gateway(async (input, init) => {
			const url = String(input);
			upstreamPaths.push(url);
			const headers = new Headers(init?.headers);
			expect(headers.get("Authorization")).toBe("Bearer good-a");
			if (url.endsWith("/publish-readiness")) {
				expect(init?.method).toBe("GET");
				return upstreamJson(readiness, 200);
			}
			expect(init?.method).toBe("POST");
			expect(headers.get("Idempotency-Key")).toBe("idem.publish.123");
			expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(
				publishBody,
			);
			return upstreamJson(
				{ event: { ...event, status: "published", version: 2 } },
				200,
				{ "Idempotency-Replayed": "false" },
			);
		});

		const read = await app.request(
			`/core/v1/event-roots/${event.rootEventId}/publish-readiness`,
			{
				headers: {
					Authorization: "Bearer good-a",
					"X-Request-ID": requestId,
				},
			},
		);
		expect(read.status).toBe(200);
		expect(await read.json()).toEqual(readiness);

		const publish = await app.request(
			`/core/v1/event-roots/${event.rootEventId}/publish`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer good-a",
					"Content-Type": "application/json",
					"Idempotency-Key": "idem.publish.123",
					"X-Request-ID": requestId,
				},
				body: publishBody,
			},
		);
		expect(publish.status).toBe(200);
		expect(publish.headers.get("Idempotency-Replayed")).toBe("false");
		expect(await publish.json()).toEqual({
			event: { ...event, status: "published", version: 2 },
		});
		expect(upstreamPaths).toEqual([
			`https://event.test/v1/event-roots/${event.rootEventId}/publish-readiness`,
			`https://event.test/v1/event-roots/${event.rootEventId}/publish`,
		]);
	});

	test("proxies the versioned idempotent template-adoption command", async () => {
		const body = {
			baseVersion: 1,
			baseRevision: "1",
			template: {
				id: "team-event",
				version: 1,
				eventIds: {
					root: event.rootEventId,
					agenda: "evt_gateway_template_agenda",
					activity: "evt_gateway_template_activity",
				},
			},
		};
		const responseBody = {
			event: {
				...event,
				kind: "team_event",
				version: 2,
				childOrderVersion: 2,
			},
			rootRevision: "2",
			template: { id: "team-event", version: 1 },
		};
		const app = gateway(async (input, init) => {
			expect(String(input)).toBe(
				`https://event.test/v1/event-roots/${event.rootEventId}/template`,
			);
			expect(init?.method).toBe("POST");
			const headers = new Headers(init?.headers);
			expect(headers.get("Authorization")).toBe("Bearer good-a");
			expect(headers.get("Idempotency-Key")).toBe("idem.template.adopt");
			expect(await new Response(init?.body).json()).toEqual(body);
			return upstreamJson(responseBody, 200, {
				"Idempotency-Replayed": "false",
			});
		});

		const response = await app.request(
			`/core/v1/event-roots/${event.rootEventId}/template`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer good-a",
					"Content-Type": "application/json",
					"Idempotency-Key": "idem.template.adopt",
					"X-Request-ID": requestId,
				},
				body: JSON.stringify(body),
			},
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Idempotency-Replayed")).toBe("false");
		expect(await response.json()).toEqual(responseBody);
	});

	test("proxies the bounded recap lifecycle and rejects rounded unsafe versions locally", async () => {
		const provenance = {
			sourceType: "event",
			sourceId: event.rootEventId,
			sourceVersion: 1,
			sourceRevision: "1",
			visibility: "members",
			consentBasis: "event-publication",
		};
		const draft = {
			schemaVersion: 1,
			rootEventId: event.rootEventId,
			version: 1,
			lifecycleVersion: 1,
			state: "draft",
			publishedVersion: null,
			sourceRootRevision: "3",
			generatedAt: "2026-07-18T08:00:00.000Z",
			publishedAt: null,
			title: "Crew trip recap",
			titleProvenance: provenance,
			items: [
				{
					ordinal: 0,
					sourceTitle: "Crew trip recap",
					sourceBody: "Reviewed event body",
					provenance,
				},
			],
		};
		const published = {
			...draft,
			lifecycleVersion: 2,
			state: "published",
			publishedVersion: 1,
			publishedAt: "2026-07-18T08:05:00.000Z",
		};
		const externalConsent = {
			fields: [
				{
					ordinal: 0,
					field: "body",
					requiredAuthorities: ["manager"],
					authorDecision: "unknown",
					managerDecision: "grant",
					actorCanDecide: ["manager"],
				},
			],
		};
		const generateBody = JSON.stringify({
			baseRevision: "3",
			sources: [
				{
					type: "event",
					sourceId: event.rootEventId,
					sourceVersion: 1,
					consentBasis: "event-publication",
				},
			],
		});
		const publishBody = JSON.stringify({
			recapVersion: 1,
			baseLifecycleVersion: 1,
		});
		const removeBody = JSON.stringify({ baseLifecycleVersion: 2 });
		const calls: string[] = [];
		const app = gateway(async (input, init) => {
			const url = String(input);
			const method = init?.method ?? "GET";
			calls.push(`${method} ${url}`);
			const headers = new Headers(init?.headers);
			expect(headers.get("Authorization")).toBe("Bearer good-a");
			if (method === "GET")
				return upstreamJson({ recap: published, externalConsent }, 200, {
					"Cache-Control": "private, no-store",
				});
			const sentBody = new TextDecoder().decode(init?.body as ArrayBuffer);
			if (url.endsWith("/recap/generate")) {
				expect(headers.get("Idempotency-Key")).toBe("idem.recap.generate");
				expect(sentBody).toBe(generateBody);
				return upstreamJson({ recap: draft }, 201, {
					Location:
						"https://event.test/v1/event-roots/evt_root/recap?version=1",
					"Cache-Control": "private, no-store",
				});
			}
			if (url.endsWith("/recap/publish")) {
				expect(headers.get("Idempotency-Key")).toBe("idem.recap.publish");
				expect(sentBody).toBe(publishBody);
				return upstreamJson({ recap: published }, 200, {
					"Cache-Control": "private, no-store",
				});
			}
			expect(method).toBe("DELETE");
			expect(headers.get("Idempotency-Key")).toBe("idem.recap.remove");
			expect(sentBody).toBe(removeBody);
			return upstreamJson({ removed: true, lifecycleVersion: 3 }, 200, {
				"Cache-Control": "private, no-store",
			});
		});

		const read = await app.request(
			`/core/v1/event-roots/${event.rootEventId}/recap?version=1`,
			{
				headers: { Authorization: "Bearer good-a", "X-Request-ID": requestId },
			},
		);
		expect(read.status).toBe(200);
		expect(read.headers.get("Cache-Control")).toBe("private, no-store");
		expect(await read.json()).toEqual({ recap: published, externalConsent });
		const generated = await app.request(
			`/core/v1/event-roots/${event.rootEventId}/recap/generate`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer good-a",
					"Content-Type": "application/json",
					"Idempotency-Key": "idem.recap.generate",
					"X-Request-ID": requestId,
				},
				body: generateBody,
			},
		);
		expect(generated.status).toBe(201);
		expect(generated.headers.get("Location")).toBe(
			"/core/v1/event-roots/evt_root/recap?version=1",
		);
		expect(generated.headers.get("Cache-Control")).toBe("private, no-store");
		expect(await generated.json()).toEqual({ recap: draft });
		const publish = await app.request(
			`/core/v1/event-roots/${event.rootEventId}/recap/publish`,
			{
				method: "POST",
				headers: {
					Authorization: "Bearer good-a",
					"Content-Type": "application/json",
					"Idempotency-Key": "idem.recap.publish",
					"X-Request-ID": requestId,
				},
				body: publishBody,
			},
		);
		expect(publish.status).toBe(200);
		expect(publish.headers.get("Cache-Control")).toBe("private, no-store");
		expect(await publish.json()).toEqual({ recap: published });
		const remove = await app.request(
			`/core/v1/event-roots/${event.rootEventId}/recap`,
			{
				method: "DELETE",
				headers: {
					Authorization: "Bearer good-a",
					"Content-Type": "application/json",
					"Idempotency-Key": "idem.recap.remove",
					"X-Request-ID": requestId,
				},
				body: removeBody,
			},
		);
		expect(remove.status).toBe(200);
		expect(remove.headers.get("Cache-Control")).toBe("private, no-store");
		expect(await remove.json()).toEqual({
			removed: true,
			lifecycleVersion: 3,
		});
		expect(calls).toEqual([
			"GET https://event.test/v1/event-roots/evt_root/recap?version=1",
			"POST https://event.test/v1/event-roots/evt_root/recap/generate",
			"POST https://event.test/v1/event-roots/evt_root/recap/publish",
			"DELETE https://event.test/v1/event-roots/evt_root/recap",
		]);

		const unsafe = await app.request(
			`/core/v1/event-roots/${event.rootEventId}/recap?version=9007199254740993`,
			{
				headers: { Authorization: "Bearer good-a", "X-Request-ID": requestId },
			},
		);
		expect(unsafe.status).toBe(400);
		expect((await unsafe.json()).error.code).toBe("VALIDATION_FAILED");
		expect(calls).toHaveLength(4);
		const databaseUnsafe = await app.request(
			`/core/v1/event-roots/${event.rootEventId}/recap?version=2147483648`,
			{
				headers: { Authorization: "Bearer good-a", "X-Request-ID": requestId },
			},
		);
		expect(databaseUnsafe.status).toBe(400);
		expect(calls).toHaveLength(4);

		const leaked = await gateway(async () =>
			upstreamJson(
				{
					recap: published,
					externalConsent: {
						fields: [
							{
								...externalConsent.fields[0],
								actorId: ACTOR_A,
							},
						],
					},
				},
				200,
			),
		).request(`/core/v1/event-roots/${event.rootEventId}/recap`, {
			headers: { Authorization: "Bearer good-a", "X-Request-ID": requestId },
		});
		expect(leaked.status).toBe(502);
	});

	test("proxies manager recap shares while keeping the public resolver bearer-free and title-only", async () => {
		const shareLinkId = `rsh_${"A".repeat(24)}`;
		const token = `crs_${"B".repeat(43)}`;
		const shareLink = {
			id: shareLinkId,
			recapVersion: 3,
			createdAt: "2026-07-18T08:00:00.000Z",
			expiresAt: "2026-07-25T08:00:00.000Z",
		};
		const publicRecap = {
			title: "Crew trip recap",
			items: [{ ordinal: 0, title: "Arrival" }],
		};
		const calls: string[] = [];
		const app = gateway(async (input, init) => {
			const url = String(input);
			const method = init?.method ?? "GET";
			const headers = new Headers(init?.headers);
			calls.push(`${method} ${url}`);
			if (url.endsWith("/recap/share-links") && method === "POST") {
				expect(headers.get("Authorization")).toBe("Bearer good-a");
				expect(headers.get("Idempotency-Key")).toBe("idem.recap.share.create");
				expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(
					JSON.stringify({
						recapVersion: 3,
						projectionConsent: "title-only-reviewed",
					}),
				);
				return upstreamJson({ shareLink, token }, 201, {
					Location: `https://event.test/v1/event-roots/evt_root/recap/share-links/${shareLinkId}`,
					"Cache-Control": "private, no-store",
				});
			}
			if (url.endsWith(`/recap/share-links/${shareLinkId}`)) {
				expect(method).toBe("DELETE");
				expect(headers.get("Authorization")).toBe("Bearer good-a");
				expect(headers.get("Idempotency-Key")).toBe("idem.recap.share.revoke");
				return upstreamJson({ revoked: true }, 200, {
					"Cache-Control": "private, no-store",
				});
			}
			expect(url).toBe("https://event.test/v1/recap-share-links/resolve");
			expect(method).toBe("POST");
			expect(headers.get("Authorization")).toBeNull();
			expect(headers.get("Idempotency-Key")).toBeNull();
			expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(
				JSON.stringify({ token }),
			);
			return upstreamJson({ recap: publicRecap }, 200, {
				"Cache-Control": "private, no-store",
			});
		});

		const created = await app.request(
			"/core/v1/event-roots/evt_root/recap/share-links",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer good-a",
					"Content-Type": "application/json",
					"Idempotency-Key": "idem.recap.share.create",
					"X-Request-ID": requestId,
				},
				body: JSON.stringify({
					recapVersion: 3,
					projectionConsent: "title-only-reviewed",
				}),
			},
		);
		expect(created.status).toBe(201);
		expect(created.headers.get("Cache-Control")).toBe("private, no-store");
		expect(created.headers.get("Location")).toBe(
			`/core/v1/event-roots/evt_root/recap/share-links/${shareLinkId}`,
		);
		expect(await created.json()).toEqual({ shareLink, token });

		const resolved = await app.request("/core/v1/recap-share-links/resolve", {
			method: "POST",
			headers: {
				Authorization: "Bearer caller-value-must-not-cross",
				"Content-Type": "application/json",
				"X-Request-ID": requestId,
			},
			body: JSON.stringify({ token }),
		});
		expect(resolved.status).toBe(200);
		expect(resolved.headers.get("Cache-Control")).toBe("private, no-store");
		const resolvedText = await resolved.clone().text();
		expect(await resolved.json()).toEqual({ recap: publicRecap });
		for (const forbidden of [
			"rootEventId",
			"sourceId",
			"sourceBody",
			"provenance",
			"caller-value-must-not-cross",
		]) {
			expect(resolvedText).not.toContain(forbidden);
		}

		const revoked = await app.request(
			`/core/v1/event-roots/evt_root/recap/share-links/${shareLinkId}`,
			{
				method: "DELETE",
				headers: {
					Authorization: "Bearer good-a",
					"Idempotency-Key": "idem.recap.share.revoke",
					"X-Request-ID": requestId,
				},
			},
		);
		expect(revoked.status).toBe(200);
		expect(revoked.headers.get("Cache-Control")).toBe("private, no-store");
		expect(await revoked.json()).toEqual({ revoked: true });
		expect(calls).toEqual([
			"POST https://event.test/v1/event-roots/evt_root/recap/share-links",
			"POST https://event.test/v1/recap-share-links/resolve",
			`DELETE https://event.test/v1/event-roots/evt_root/recap/share-links/${shareLinkId}`,
		]);

		const malformed = await app.request("/core/v1/recap-share-links/resolve", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Request-ID": requestId,
			},
			body: JSON.stringify({ token: "not-a-token" }),
		});
		expect(malformed.status).toBe(404);
		expect(malformed.headers.get("Cache-Control")).toBe("private, no-store");
		expect(await malformed.json()).toEqual(
			errorEnvelope("NOT_FOUND", "Resource not found."),
		);
		expect(calls).toHaveLength(3);

		const concealedSecretHeader = await app.request(
			"/core/v1/recap-share-links/resolve",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": token,
					"X-Request-ID": requestId,
				},
				body: JSON.stringify({ token }),
			},
		);
		expect(concealedSecretHeader.status).toBe(404);
		expect(concealedSecretHeader.headers.get("Cache-Control")).toBe(
			"private, no-store",
		);
		expect(await concealedSecretHeader.json()).toEqual(
			errorEnvelope("NOT_FOUND", "Resource not found."),
		);
		expect(calls).toHaveLength(3);

		const secretIdempotency = await app.request(
			"/core/v1/event-roots/evt_root/recap/share-links",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer good-a",
					"Content-Type": "application/json",
					"Idempotency-Key": token,
					"X-Request-ID": requestId,
				},
				body: JSON.stringify({
					recapVersion: 3,
					projectionConsent: "title-only-reviewed",
				}),
			},
		);
		expect(secretIdempotency.status).toBe(400);
		expect(await secretIdempotency.json()).toEqual(
			errorEnvelope("VALIDATION_FAILED", "The request is invalid."),
		);
		expect(calls).toHaveLength(3);

		const notFound = await gateway(async (_input, init) => {
			expect(new Headers(init?.headers).get("Authorization")).toBeNull();
			return upstreamJson(
				errorEnvelope("NOT_FOUND", "Resource not found."),
				404,
				{ "Cache-Control": "private, no-store" },
			);
		}).request("/core/v1/recap-share-links/resolve", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Request-ID": requestId,
			},
			body: JSON.stringify({ token: `crs_${"C".repeat(43)}` }),
		});
		expect(notFound.status).toBe(404);
		expect(notFound.headers.get("Cache-Control")).toBe("private, no-store");

		const invalidProjection = await gateway(async () =>
			upstreamJson(
				{ recap: { ...publicRecap, sourceBody: "must never cross" } },
				200,
				{ "Cache-Control": "private, no-store" },
			),
		).request("/core/v1/recap-share-links/resolve", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Request-ID": requestId,
			},
			body: JSON.stringify({ token }),
		});
		expect(invalidProjection.status).toBe(502);
		expect(invalidProjection.headers.get("Cache-Control")).toBe(
			"private, no-store",
		);
		expect(await invalidProjection.text()).not.toContain("must never cross");

		const nonContiguousProjection = await gateway(async () =>
			upstreamJson(
				{
					recap: {
						...publicRecap,
						items: [
							{ ordinal: 0, title: "Arrival" },
							{ ordinal: 2, title: "Hidden position leak" },
						],
					},
				},
				200,
				{ "Cache-Control": "private, no-store" },
			),
		).request("/core/v1/recap-share-links/resolve", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Request-ID": requestId,
			},
			body: JSON.stringify({ token }),
		});
		expect(nonContiguousProjection.status).toBe(502);
		expect(nonContiguousProjection.headers.get("Cache-Control")).toBe(
			"private, no-store",
		);
		expect(await nonContiguousProjection.text()).not.toContain(
			"Hidden position leak",
		);
	});

	test("proxies exact recap grants and blocks identities or ordinal gaps at the public edge", async () => {
		const shareLinkId = `rsh_${"E".repeat(24)}`;
		const token = `crs_${"F".repeat(43)}`;
		const field = {
			sourceType: "feedEntry",
			sourceId: "fed_external_edge",
			sourceVersion: 2,
			field: "caption",
			fieldRef: `rcf_${"G".repeat(43)}`,
		};
		const shareLink = {
			id: shareLinkId,
			recapVersion: 3,
			createdAt: "2026-07-18T08:00:00.000Z",
			expiresAt: "2026-07-25T08:00:00.000Z",
		};
		const publicRecap = {
			title: "Crew trip recap",
			items: [
				{ ordinal: 0, title: "Arrival", body: null, captions: [] },
				{
					ordinal: 1,
					title: null,
					body: null,
					captions: ["Approved dinner moment caption"],
				},
			],
		};
		const calls: string[] = [];
		const app = gateway(async (input, init) => {
			const url = String(input);
			const method = init?.method ?? "GET";
			const headers = new Headers(init?.headers);
			calls.push(`${method} ${url}`);
			if (url.endsWith("/recap/external-grants")) {
				expect(headers.get("Authorization")).toBe("Bearer good-a");
				expect(headers.get("Idempotency-Key")).toBe("idem.external.grant");
				expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(
					JSON.stringify({
						recapVersion: 3,
						...field,
						authority: "manager",
						decision: "grant",
					}),
				);
				return upstreamJson({ decision: "grant" }, 200, {
					"Cache-Control": "private, no-store",
				});
			}
			if (url.endsWith("/recap/external-share-links")) {
				expect(headers.get("Authorization")).toBe("Bearer good-a");
				expect(headers.get("Idempotency-Key")).toBe("idem.external.link");
				expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(
					JSON.stringify({
						recapVersion: 3,
						projectionConsent: "exact-fields-reviewed-v1",
						fields: [field],
					}),
				);
				return upstreamJson({ shareLink, token }, 201, {
					Location: `https://event.test/v1/event-roots/evt_root/recap/share-links/${shareLinkId}`,
					"Cache-Control": "private, no-store",
				});
			}
			expect(url).toBe(
				"https://event.test/v1/recap-external-share-links/resolve",
			);
			expect(headers.get("Authorization")).toBeNull();
			expect(headers.get("Idempotency-Key")).toBeNull();
			return upstreamJson({ recap: publicRecap }, 200, {
				"Cache-Control": "private, no-store",
			});
		});

		const grant = await app.request(
			"/core/v1/event-roots/evt_root/recap/external-grants",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer good-a",
					"Content-Type": "application/json",
					"Idempotency-Key": "idem.external.grant",
					"X-Request-ID": requestId,
				},
				body: JSON.stringify({
					recapVersion: 3,
					...field,
					authority: "manager",
					decision: "grant",
				}),
			},
		);
		expect(grant.status).toBe(200);
		expect(await grant.json()).toEqual({ decision: "grant" });

		const created = await app.request(
			"/core/v1/event-roots/evt_root/recap/external-share-links",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer good-a",
					"Content-Type": "application/json",
					"Idempotency-Key": "idem.external.link",
					"X-Request-ID": requestId,
				},
				body: JSON.stringify({
					recapVersion: 3,
					projectionConsent: "exact-fields-reviewed-v1",
					fields: [field],
				}),
			},
		);
		expect(created.status).toBe(201);
		expect(created.headers.get("Location")).toBe(
			`/core/v1/event-roots/evt_root/recap/share-links/${shareLinkId}`,
		);
		expect(await created.json()).toEqual({ shareLink, token });

		const resolved = await app.request(
			"/core/v1/recap-external-share-links/resolve",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer must-not-cross",
					"Content-Type": "application/json",
					"X-Request-ID": requestId,
				},
				body: JSON.stringify({ token }),
			},
		);
		expect(resolved.status).toBe(200);
		expect(resolved.headers.get("Cache-Control")).toBe("private, no-store");
		const resolvedText = await resolved.clone().text();
		expect(await resolved.json()).toEqual({ recap: publicRecap });
		for (const forbidden of [
			"rootEventId",
			"sourceId",
			"sourceVersion",
			"provenance",
			"membership",
			"must-not-cross",
		])
			expect(resolvedText).not.toContain(forbidden);
		expect(calls).toEqual([
			"POST https://event.test/v1/event-roots/evt_root/recap/external-grants",
			"POST https://event.test/v1/event-roots/evt_root/recap/external-share-links",
			"POST https://event.test/v1/recap-external-share-links/resolve",
		]);

		const malformed = await app.request(
			"/core/v1/recap-external-share-links/resolve",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Request-ID": requestId,
				},
				body: JSON.stringify({ token: "bad" }),
			},
		);
		expect(malformed.status).toBe(404);
		expect(await malformed.json()).toEqual(
			errorEnvelope("NOT_FOUND", "Resource not found."),
		);
		expect(calls).toHaveLength(3);

		for (const unsafeRecap of [
			{ ...publicRecap, rootEventId: "evt_internal" },
			{
				...publicRecap,
				items: [
					publicRecap.items[0],
					{ ordinal: 3, title: null, body: "Ordinal leak", captions: [] },
				],
			},
			{
				...publicRecap,
				items: [{ ordinal: 0, title: null, body: null, captions: [] }],
			},
		]) {
			const blocked = await gateway(async () =>
				upstreamJson({ recap: unsafeRecap }, 200, {
					"Cache-Control": "private, no-store",
				}),
			).request("/core/v1/recap-external-share-links/resolve", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Request-ID": requestId,
				},
				body: JSON.stringify({ token }),
			});
			expect(blocked.status).toBe(502);
			expect(blocked.headers.get("Cache-Control")).toBe("private, no-store");
			const blockedText = await blocked.text();
			expect(blockedText).not.toContain("evt_internal");
			expect(blockedText).not.toContain("Ordinal leak");
		}
	});

	test("preserves nullable feed enums without accepting values outside the contract", async () => {
		const entry = {
			id: "fed_decisions",
			rootEventId: "evt_root",
			eventId: "evt_root",
			parentEntryId: null,
			authorUserId: ACTOR_A,
			kind: "message",
			payloadSchemaVersion: 1,
			body: "Decision log",
			version: 1,
			rootRevision: "2",
			createdRootRevision: "2",
			createdAt: "2026-07-18T08:00:00.000Z",
			updatedAt: "2026-07-18T08:00:00.000Z",
			deletedAt: null,
			tombstoneReason: null,
			reactions: [],
			attachments: [],
		};
		const request = () => ({
			method: "POST",
			headers: {
				Authorization: "Bearer good-a",
				"Content-Type": "application/json",
				"Idempotency-Key": "idem.feed.123",
				"X-Request-ID": requestId,
			},
			body: JSON.stringify({
				id: entry.id,
				eventId: entry.eventId,
				parentEntryId: null,
				kind: "message",
				body: entry.body,
			}),
		});

		const valid = await gateway(async () =>
			upstreamJson({ entry }, 201),
		).request("/core/v1/event-roots/evt_root/feed", request());
		expect(valid.status).toBe(201);
		expect((await valid.json()).entry.tombstoneReason).toBeNull();

		const invalid = await gateway(async () =>
			upstreamJson(
				{ entry: { ...entry, tombstoneReason: "private_provider_detail" } },
				201,
			),
		).request("/core/v1/event-roots/evt_root/feed", request());
		expect(invalid.status).toBe(502);
		expect((await invalid.json()).error.code).toBe("UPSTREAM_ERROR");
	});

	test("propagates a validated domain error and Retry-After exactly", async () => {
		const app = gateway(async () =>
			upstreamJson(
				errorEnvelope("VERSION_CONFLICT", "Refresh and retry.", true),
				409,
				{ "Retry-After": "4" },
			),
		);
		const response = await app.request(
			"/core/v1/event-roots/evt_root/events/evt_child",
			{
				method: "PATCH",
				headers: {
					Authorization: "Bearer good-a",
					"Content-Type": "application/json",
					"Idempotency-Key": "idem.patch.123",
					"X-Request-ID": requestId,
				},
				body: '{"baseVersion":1,"changes":{"title":"Updated"}}',
			},
		);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual(
			errorEnvelope("VERSION_CONFLICT", "Refresh and retry.", true),
		);
		expect(response.headers.get("Retry-After")).toBe("4");
	});

	test("preserves a documented 204 without inventing JSON", async () => {
		const app = gateway(async (input) => {
			expect(String(input)).toBe("https://user.test/v1/auth/logout");
			return new Response(null, {
				status: 204,
				headers: { "X-Request-ID": requestId },
			});
		});
		const response = await app.request("/core/v1/auth/logout", {
			method: "POST",
			headers: {
				Authorization: "Bearer good-a",
				"X-Request-ID": requestId,
			},
		});

		expect(response.status).toBe(204);
		expect(response.headers.get("Content-Type")).toBeNull();
		expect(await response.text()).toBe("");
	});

	test("proxies the worst-escape bounded community detail below one MiB", async () => {
		const rootEventId = "evt_communitycap01";
		const feedbackId = "fbk_communitycap01";
		const escaped = "\u0001";
		const feedback = {
			id: feedbackId,
			title: "t".repeat(160),
			body: escaped.repeat(10_000),
			status: "planned",
			version: 21,
			voteCount: 3,
			duplicateCount: 2,
			viewerHasVoted: true,
			followed: true,
			createdAt: "2026-07-19T01:02:03.123Z",
			updatedAt: "2026-07-19T01:02:04.456Z",
			comments: Array.from({ length: 20 }, (_, index) => ({
				id: `fbc_gateway_cap_${index.toString().padStart(2, "0")}`,
				body: escaped.repeat(5_000),
				createdAt: "2026-07-19T01:02:03.123Z",
			})),
			commentCount: 21,
			commentsHasMore: true,
			statusHistory: Array.from({ length: 20 }, (_, index) => ({
				version: index + 2,
				fromStatus: index % 2 === 0 ? "open" : "planned",
				toStatus: index % 2 === 0 ? "planned" : "open",
				note: escaped.repeat(1_000),
				changedAt: "2026-07-19T01:02:04.456Z",
			})),
			statusHistoryCount: 21,
			statusHistoryHasMore: true,
		};
		const responseBody = JSON.stringify({
			feedback,
			redirectedFromFeedbackId: null,
		});
		expect(Buffer.byteLength(responseBody)).toBeGreaterThan(780_000);
		expect(Buffer.byteLength(responseBody)).toBeLessThan(1_048_576);
		const app = gateway(async (input) => {
			expect(String(input)).toBe(
				`https://event.test/v1/event-roots/${rootEventId}/feedback/${feedbackId}`,
			);
			return new Response(responseBody, {
				status: 200,
				headers: {
					"Content-Type": "application/json",
					"X-Request-ID": requestId,
					"Cache-Control": "private, no-store",
				},
			});
		});
		const response = await app.request(
			`/core/v1/event-roots/${rootEventId}/feedback/${feedbackId}`,
			{
				headers: {
					Authorization: "Bearer good-a",
					"X-Request-ID": requestId,
				},
			},
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		expect((await response.json()).feedback).toMatchObject({
			id: feedbackId,
			commentCount: 21,
			statusHistoryCount: 21,
		});
	});

	test("proxies only the strict bounded duplicate-suggestion projection", async () => {
		const rootEventId = "evt_duplicate_suggestions";
		const responseBody = {
			items: [
				{
					id: "fbk_duplicate_suggestion",
					title: "Check-in flow",
					status: "open",
					voteCount: 3,
				},
			],
			pageInfo: { nextCursor: null, hasMore: false },
		};
		let calls = 0;
		const app = gateway(async (input) => {
			calls += 1;
			expect(String(input)).toBe(
				`https://event.test/v1/event-roots/${rootEventId}/feedback/duplicate-suggestions?q=check%20in&limit=5`,
			);
			return upstreamJson(responseBody, 200, {
				"Cache-Control": "private, no-store",
			});
		});
		const path = `/core/v1/event-roots/${rootEventId}/feedback/duplicate-suggestions?q=check%20in&limit=5`;
		const request = {
			headers: {
				Authorization: "Bearer good-a",
				"X-Request-ID": requestId,
			},
		};
		const response = await app.request(path, request);
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		expect(await response.json()).toEqual(responseBody);
		expect(calls).toBe(1);

		for (const body of [
			{
				...responseBody,
				items: [{ ...responseBody.items[0], body: "must not cross" }],
			},
			{
				...responseBody,
				items: [{ ...responseBody.items[0], authorUserId: ACTOR_A }],
			},
		]) {
			const invalid = await gateway(async () =>
				upstreamJson(body, 200),
			).request(path, request);
			expect(invalid.status).toBe(502);
			expect((await invalid.json()).error.code).toBe("UPSTREAM_ERROR");
		}
		for (const invalidPath of [
			`/core/v1/event-roots/${rootEventId}/feedback/duplicate-suggestions`,
			`/core/v1/event-roots/${rootEventId}/feedback/duplicate-suggestions?q=x`,
			`/core/v1/event-roots/${rootEventId}/feedback/duplicate-suggestions?q=check%20in&unknown=value`,
		]) {
			expect((await app.request(invalidPath, request)).status).toBe(400);
		}

		let limitedCalls = 0;
		const limitedApp = gateway(
			async () => {
				limitedCalls += 1;
				return upstreamJson(responseBody, 200);
			},
			new MemoryRateLimiter(1, 60_000, 10),
		);
		expect((await limitedApp.request(path, request)).status).toBe(200);
		const limited = await limitedApp.request(path, request);
		expect(limited.status).toBe(429);
		expect(limited.headers.get("Retry-After")).toBe("60");
		expect(limitedCalls).toBe(1);
	});

	test("proxies the worst-escape bounded generic feedback below one MiB", async () => {
		const feedbackId = "fbk_genericcap01";
		const escaped = "\u0001";
		const feedback = {
			id: feedbackId,
			title: escaped.repeat(160),
			body: escaped.repeat(10_000),
			visibility: "public",
			context: {
				rootEventId: "evt_genericcap01",
				eventId: "evt_genericcap01",
				screenKey: "settings.feedback",
			},
			diagnostics: {
				appVersion: escaped.repeat(64),
				buildNumber: escaped.repeat(32),
				platform: "ios",
				osVersion: escaped.repeat(64),
				deviceModel: escaped.repeat(120),
				locale: escaped.repeat(35),
			},
			authorUserId: ACTOR_A,
			status: "planned",
			duplicateOfFeedbackId: null,
			version: 21,
			voteCount: 3,
			viewerHasVoted: true,
			attachments: Array.from({ length: 5 }, (_, index) => ({
				id: `att_generic_cap_${index}`,
				contentType: "image/jpeg",
				byteCount: 20 * 1024 * 1024,
				sha256: "a".repeat(64),
				caption: escaped.repeat(1_000),
				createdAt: "2026-07-19T01:02:03.123Z",
			})),
			comments: Array.from({ length: 20 }, (_, index) => ({
				id: `fbc_generic_cap_${index.toString().padStart(2, "0")}`,
				authorUserId: ACTOR_A,
				body: escaped.repeat(5_000),
				createdAt: "2026-07-19T01:02:03.123Z",
			})),
			commentCount: 21,
			commentsHasMore: true,
			statusHistory: Array.from({ length: 20 }, (_, index) => ({
				version: index + 2,
				fromStatus: index % 2 === 0 ? "open" : "planned",
				toStatus: index % 2 === 0 ? "planned" : "open",
				changedBy: ACTOR_A,
				note: escaped.repeat(1_000),
				changedAt: "2026-07-19T01:02:04.456Z",
			})),
			statusHistoryCount: 21,
			statusHistoryHasMore: true,
			createdAt: "2026-07-19T01:02:03.123Z",
			updatedAt: "2026-07-19T01:02:04.456Z",
		};
		const responseBody = JSON.stringify({ feedback });
		expect(Buffer.byteLength(responseBody)).toBeGreaterThan(810_000);
		expect(Buffer.byteLength(responseBody)).toBeLessThan(1_048_576);
		const app = gateway(async (input) => {
			expect(String(input)).toBe(
				`https://event.test/v1/feedback/${feedbackId}`,
			);
			return new Response(responseBody, {
				status: 200,
				headers: {
					"Content-Type": "application/json",
					"X-Request-ID": requestId,
					"Cache-Control": "private, no-store",
				},
			});
		});
		const response = await app.request(`/core/v1/feedback/${feedbackId}`, {
			headers: {
				Authorization: "Bearer good-a",
				"X-Request-ID": requestId,
			},
		});
		expect(response.status).toBe(200);
		expect((await response.json()).feedback).toMatchObject({
			id: feedbackId,
			commentCount: 21,
			statusHistoryCount: 21,
		});
	});

	test("conceals malformed success payloads and request-ID mismatches", async () => {
		for (const fetcher of [
			async () => upstreamJson({ id: "db-secret" }, 200),
			async () =>
				Response.json(user, {
					headers: { "X-Request-ID": "different.request" },
				}),
			async () =>
				new Response(new Uint8Array(1_048_577), {
					headers: {
						"Content-Type": "application/json",
						"X-Request-ID": requestId,
					},
				}),
		]) {
			const response = await gateway(fetcher).request("/core/v1/me", {
				headers: {
					Authorization: "Bearer good-a",
					"X-Request-ID": requestId,
				},
			});
			expect(response.status).toBe(502);
			expect(await response.json()).toEqual(
				errorEnvelope(
					"UPSTREAM_ERROR",
					"A required service returned an invalid response.",
					true,
				),
			);
		}
	});

	test("rejects an oversized sync body before calling event-service", async () => {
		let called = false;
		const app = gateway(async () => {
			called = true;
			return upstreamJson({}, 200);
		});
		const response = await app.request("/core/v1/sync/push", {
			method: "POST",
			headers: {
				Authorization: "Bearer good-a",
				"Content-Type": "application/json",
				"Idempotency-Key": "idem.sync.123",
				"X-Request-ID": requestId,
			},
			body: `{"payload":"${"x".repeat(1_048_576)}"}`,
		});

		expect(response.status).toBe(413);
		expect((await response.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
		expect(called).toBe(false);
	});

	test("bounds and rejects bodies on operations without a request body", async () => {
		for (const body of ["{}", "x".repeat(1_048_577)]) {
			let called = false;
			const response = await gateway(async () => {
				called = true;
				return new Response(null, { status: 204 });
			}).request("/core/v1/me/devices/dvc_12345678", {
				method: "DELETE",
				headers: {
					Authorization: "Bearer good-a",
					"Content-Type": "application/json",
					"X-Request-ID": requestId,
				},
				body,
			});

			expect(response.status).toBe(body.length > 1_048_576 ? 413 : 400);
			expect(called).toBe(false);
		}
	});

	test("does not await cancellation of an oversized request stream", async () => {
		let called = false;
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(1_048_577));
			},
			cancel() {
				cancelled = true;
				return new Promise<void>(() => undefined);
			},
		});
		const request = new Request(
			"http://localhost/core/v1/me/devices/dvc_12345678",
			{
				method: "DELETE",
				headers: {
					Authorization: "Bearer good-a",
					"Content-Type": "application/json",
					"X-Request-ID": requestId,
				},
				body,
			},
		);
		const response = await gateway(async () => {
			called = true;
			return new Response(null, { status: 204 });
		}).request(request);

		expect(response.status).toBe(413);
		expect(cancelled).toBe(true);
		expect(called).toBe(false);
	});

	test("accepts only the exact application/json media essence", async () => {
		let requestCalled = false;
		const invalidRequest = await gateway(async () => {
			requestCalled = true;
			return upstreamJson({ event }, 201);
		}).request("/core/v1/event-roots", {
			method: "POST",
			headers: {
				Authorization: "Bearer good-a",
				"Content-Type": "application/jsonp",
				"Idempotency-Key": "idem.media.123",
				"X-Request-ID": requestId,
			},
			body: '{"id":"evt_root","kind":"trip","title":"Crew trip","timeZone":"Europe/Zurich"}',
		});
		expect(invalidRequest.status).toBe(415);
		expect(requestCalled).toBe(false);

		const invalidResponse = await gateway(
			async () =>
				new Response(JSON.stringify(user), {
					headers: {
						"Content-Type": "application/jsonp",
						"X-Request-ID": requestId,
					},
				}),
		).request("/core/v1/me", {
			headers: {
				Authorization: "Bearer good-a",
				"X-Request-ID": requestId,
			},
		});
		expect(invalidResponse.status).toBe(502);
	});

	test("validates a pinned request schema before calling downstream", async () => {
		let called = false;
		const response = await gateway(async () => {
			called = true;
			return upstreamJson({}, 200);
		}).request("/core/v1/event-roots", {
			method: "POST",
			headers: {
				Authorization: "Bearer good-a",
				"Content-Type": "application/json",
				"Idempotency-Key": "idem.invalid.123",
				"X-Request-ID": requestId,
			},
			body: '{"title":"missing required fields","unexpected":true}',
		});

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe("VALIDATION_FAILED");
		expect(called).toBe(false);
	});

	test("rejects root publication through create before calling downstream", async () => {
		let called = false;
		const response = await gateway(async () => {
			called = true;
			return upstreamJson({ event }, 201);
		}).request("/core/v1/event-roots", {
			method: "POST",
			headers: {
				Authorization: "Bearer good-a",
				"Content-Type": "application/json",
				"Idempotency-Key": "idem.root-published.123",
				"X-Request-ID": requestId,
			},
			body: JSON.stringify({
				id: "evt_root",
				kind: "trip",
				title: "Crew trip",
				timeZone: "Europe/Zurich",
				status: "published",
			}),
		});

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe("VALIDATION_FAILED");
		expect(called).toBe(false);
	});

	test("proxies only the actor-derived golf score mutation contract", async () => {
		const rootEventId = "evt_syncgolf001";
		const deviceId = "dvc_00000000-0000-4000-8000-000000000001";
		const clientMutationId = "00000000-0000-4000-8000-000000000730";
		const entityId = `gsc_${rootEventId}:${ACTOR_A}:1`;
		const requestBody = JSON.stringify({
			protocolVersion: 1,
			rootEventId,
			deviceId,
			mutations: [
				{
					clientMutationId,
					clientSequence: 1,
					kind: "golf.score.set",
					entityId,
					baseVersion: 0,
					payload: { eventId: rootEventId, hole: 1, strokes: 4, putts: 2 },
				},
			],
		});
		const responseBody = {
			protocolVersion: 1,
			rootEventId,
			deviceId,
			results: [
				{
					clientMutationId,
					clientSequence: 1,
					outcome: "applied",
					replayed: false,
					rootRevision: "7",
					entity: { entityType: "golfScore", entityId, version: 1 },
				},
			],
			nextExpectedClientSequence: 2,
		};
		const valid = await gateway(async (input, init) => {
			expect(String(input)).toBe("https://event.test/v1/sync/push");
			expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(
				requestBody,
			);
			return upstreamJson(responseBody, 200);
		}).request("/core/v1/sync/push", {
			method: "POST",
			headers: {
				Authorization: "Bearer good-a",
				"Content-Type": "application/json",
				"Idempotency-Key": "idem.golf.sync.123",
				"X-Request-ID": requestId,
			},
			body: requestBody,
		});
		expect(valid.status).toBe(200);
		expect(await valid.json()).toEqual(responseBody);
		const versionZeroBody = {
			...responseBody,
			results: [
				{
					clientMutationId,
					clientSequence: 1,
					outcome: "rejected",
					replayed: false,
					error: {
						code: "VERSION_CONFLICT",
						message: "The entity version changed.",
						retryable: false,
						currentVersion: 0,
					},
				},
			],
		};
		const versionZero = await gateway(async () =>
			upstreamJson(versionZeroBody, 200),
		).request("/core/v1/sync/push", {
			method: "POST",
			headers: {
				Authorization: "Bearer good-a",
				"Content-Type": "application/json",
				"Idempotency-Key": "idem.golf.sync.version-zero",
				"X-Request-ID": requestId,
			},
			body: requestBody,
		});
		expect(versionZero.status).toBe(200);
		expect(await versionZero.json()).toEqual(versionZeroBody);

		let invalidCalled = false;
		const invalid = await gateway(async () => {
			invalidCalled = true;
			return upstreamJson(responseBody, 200);
		}).request("/core/v1/sync/push", {
			method: "POST",
			headers: {
				Authorization: "Bearer good-a",
				"Content-Type": "application/json",
				"Idempotency-Key": "idem.golf.sync.invalid",
				"X-Request-ID": requestId,
			},
			body: requestBody.replace(
				`"putts":2`,
				`"putts":2,"userId":"${ACTOR_A}","playingHandicap":18,"stablefordPoints":3`,
			),
		});
		expect(invalid.status).toBe(400);
		expect((await invalid.json()).error.code).toBe("VALIDATION_FAILED");
		expect(invalidCalled).toBe(false);
	});

	test("proxies the strict manager golf round replacement unchanged", async () => {
		const rootEventId = "evt_syncgolfround001";
		const deviceId = "dvc_00000000-0000-4000-8000-000000000001";
		const clientMutationId = "00000000-0000-4000-8000-000000000731";
		const request = {
			protocolVersion: 1,
			rootEventId,
			deviceId,
			mutations: [
				{
					clientMutationId,
					clientSequence: 1,
					kind: "golf.round.replace",
					entityId: rootEventId,
					baseVersion: 1,
					payload: {
						eventId: rootEventId,
						holes: Array.from({ length: 18 }, (_, index) => ({
							hole: index + 1,
							par: 4,
							strokeIndex: index + 1,
						})),
						players: [
							{ userId: ACTOR_A, playingHandicap: -2 },
							{ userId: ACTOR_B, playingHandicap: 18 },
						],
						teams: [
							{
								id: "gtm_managerflight",
								name: "Manager Flight",
								color: "#00AA55",
								memberUserIds: [ACTOR_A, ACTOR_B],
							},
						],
					},
				},
			],
		};
		const requestBody = JSON.stringify(request);
		const responseBody = {
			protocolVersion: 1,
			rootEventId,
			deviceId,
			results: [
				{
					clientMutationId,
					clientSequence: 1,
					outcome: "applied",
					replayed: false,
					rootRevision: "8",
					entity: {
						entityType: "golfRound",
						entityId: rootEventId,
						version: 2,
					},
				},
			],
			nextExpectedClientSequence: 2,
		};
		const valid = await gateway(async (input, init) => {
			expect(String(input)).toBe("https://event.test/v1/sync/push");
			expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(
				requestBody,
			);
			return upstreamJson(responseBody, 200);
		}).request("/core/v1/sync/push", {
			method: "POST",
			headers: {
				Authorization: "Bearer good-a",
				"Content-Type": "application/json",
				"Idempotency-Key": "idem.golf.round.replace",
				"X-Request-ID": requestId,
			},
			body: requestBody,
		});
		expect(valid.status).toBe(200);
		expect(await valid.json()).toEqual(responseBody);

		let invalidCalled = false;
		const mutation = request.mutations[0];
		const invalid = await gateway(async () => {
			invalidCalled = true;
			return upstreamJson(responseBody, 200);
		}).request("/core/v1/sync/push", {
			method: "POST",
			headers: {
				Authorization: "Bearer good-a",
				"Content-Type": "application/json",
				"Idempotency-Key": "idem.golf.round.invalid",
				"X-Request-ID": requestId,
			},
			body: JSON.stringify({
				...request,
				mutations: [
					{
						...mutation,
						payload: { ...mutation?.payload, stablefordPoints: 72 },
					},
				],
			}),
		});
		expect(invalid.status).toBe(400);
		expect((await invalid.json()).error.code).toBe("VALIDATION_FAILED");
		expect(invalidCalled).toBe(false);
	});

	test("proxies all strict team collaboration mutations unchanged", async () => {
		const rootEventId = "evt_syncteam001";
		const eventId = "evt_syncteamactivity001";
		const deviceId = "dvc_00000000-0000-4000-8000-000000000001";
		const decisionId = "tdc_teamlunch001";
		const responseId = `trp_${decisionId}:${ACTOR_A}`;
		const request = {
			protocolVersion: 1,
			rootEventId,
			deviceId,
			mutations: [
				{
					clientMutationId: "00000000-0000-4000-8000-000000000741",
					clientSequence: 1,
					kind: "team.assignments.publish",
					entityId: eventId,
					baseVersion: 0,
					payload: {
						eventId,
						teams: [
							{
								id: "ttm_alpha",
								name: "Alpha",
								color: "#00AA55",
								memberUserIds: [ACTOR_A, ACTOR_B],
							},
						],
					},
				},
				{
					clientMutationId: "00000000-0000-4000-8000-000000000742",
					clientSequence: 2,
					kind: "team.decision.replace",
					entityId: decisionId,
					baseVersion: 0,
					payload: {
						eventId,
						title: "What should we eat?",
						state: "open",
						options: [
							{ id: "tdo_pizza", label: "Pizza" },
							{ id: "tdo_salad", label: "Salad" },
						],
					},
				},
				{
					clientMutationId: "00000000-0000-4000-8000-000000000743",
					clientSequence: 3,
					kind: "team.response.set",
					entityId: responseId,
					baseVersion: 0,
					payload: { eventId, decisionId, optionId: "tdo_pizza" },
				},
			],
		};
		const responseBody = {
			protocolVersion: 1,
			rootEventId,
			deviceId,
			results: request.mutations.map((mutation, index) => ({
				clientMutationId: mutation.clientMutationId,
				clientSequence: mutation.clientSequence,
				outcome: "applied",
				replayed: false,
				rootRevision: String(index + 11),
				entity: {
					entityType: ["teamAssignmentSet", "teamDecision", "teamResponse"][
						index
					],
					entityId: mutation.entityId,
					version: 1,
				},
			})),
			nextExpectedClientSequence: 4,
		};
		const requestBody = JSON.stringify(request);
		const valid = await gateway(async (input, init) => {
			expect(String(input)).toBe("https://event.test/v1/sync/push");
			expect(init?.method).toBe("POST");
			expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(
				requestBody,
			);
			const headers = new Headers(init?.headers);
			expect(headers.get("Authorization")).toBe("Bearer good-a");
			expect(headers.get("Idempotency-Key")).toBe("idem.team.sync.123");
			return upstreamJson(responseBody, 200, {
				"Idempotency-Replayed": "false",
			});
		}).request("/core/v1/sync/push", {
			method: "POST",
			headers: {
				Authorization: "Bearer good-a",
				"Content-Type": "application/json",
				"Idempotency-Key": "idem.team.sync.123",
				"X-Request-ID": requestId,
			},
			body: requestBody,
		});
		expect(valid.status).toBe(200);
		expect(valid.headers.get("Idempotency-Replayed")).toBe("false");
		expect(await valid.json()).toEqual(responseBody);

		let invalidCalled = false;
		const invalid = await gateway(async () => {
			invalidCalled = true;
			return upstreamJson(responseBody, 200);
		}).request("/core/v1/sync/push", {
			method: "POST",
			headers: {
				Authorization: "Bearer good-a",
				"Content-Type": "application/json",
				"Idempotency-Key": "idem.team.sync.invalid",
				"X-Request-ID": requestId,
			},
			body: requestBody.replace(
				'"optionId":"tdo_pizza"',
				`"optionId":"tdo_pizza","userId":"${ACTOR_A}"`,
			),
		});
		expect(invalid.status).toBe(400);
		expect((await invalid.json()).error.code).toBe("VALIDATION_FAILED");
		expect(invalidCalled).toBe(false);
	});

	test("accepts scoped team projections and conceals an unsanitized assignment", async () => {
		const rootEventId = "evt_syncteamprojection001";
		const eventId = "evt_syncteamprojectionactivity001";
		const decisionId = "tdc_teamprojection001";
		const team = { id: "ttm_alpha", name: "Alpha", color: "#00AA55" };
		const updatedAt = "2026-07-19T08:00:00.000Z";
		const assignmentSet = {
			entityType: "teamAssignmentSet",
			entityId: eventId,
			entityVersion: 1,
			data: { rootEventId, eventId, teams: [team], version: 1, updatedAt },
		};
		const roster = {
			entityType: "teamAssignmentRoster",
			entityId: `tro_${eventId}`,
			entityVersion: 1,
			data: {
				rootEventId,
				eventId,
				teams: [{ ...team, memberUserIds: [ACTOR_A, ACTOR_B] }],
				version: 1,
				updatedAt,
			},
		};
		const assignment = {
			entityType: "teamAssignment",
			entityId: `tma_${eventId}:${ACTOR_B}`,
			entityVersion: 1,
			data: {
				rootEventId,
				eventId,
				userId: ACTOR_B,
				team,
				version: 1,
				updatedAt,
			},
		};
		const decision = {
			entityType: "teamDecision",
			entityId: decisionId,
			entityVersion: 2,
			data: {
				id: decisionId,
				rootEventId,
				eventId,
				title: "What should we eat?",
				state: "open",
				options: [
					{ id: "tdo_pizza", label: "Pizza", responseCount: 1 },
					{ id: "tdo_salad", label: "Salad", responseCount: 0 },
				],
				responseCount: 1,
				version: 2,
				aggregateVersion: 2,
				createdAt: updatedAt,
				updatedAt,
			},
		};
		const response = {
			entityType: "teamResponse",
			entityId: `trp_${decisionId}:${ACTOR_B}`,
			entityVersion: 1,
			data: {
				id: `trp_${decisionId}:${ACTOR_B}`,
				rootEventId,
				eventId,
				decisionId,
				userId: ACTOR_B,
				optionId: "tdo_pizza",
				version: 1,
				rootRevision: "13",
				createdAt: updatedAt,
				updatedAt,
			},
		};
		const bootstrap = (records: unknown[]) => ({
			protocolVersion: 1,
			rootEventId,
			authorizationScopeVersion: "3",
			snapshotId: "snp_teamprojection001",
			snapshotRevision: "13",
			records,
			syncCursor: "cursor-team-projection-0001",
			pageInfo: { nextCursor: null, hasMore: false },
		});
		const managerBody = bootstrap([assignmentSet, roster, decision]);
		const participantBody = bootstrap([
			assignmentSet,
			assignment,
			decision,
			response,
		]);
		let call = 0;
		const app = gateway(async (input, init) => {
			expect(String(input)).toBe(
				`https://event.test/v1/sync/bootstrap?rootEventId=${rootEventId}&limit=5`,
			);
			const headers = new Headers(init?.headers);
			expect(headers.get("Authorization")).toBe(
				call === 0 ? "Bearer good-a" : "Bearer good-b",
			);
			expect(headers.get("Idempotency-Key")).toBeNull();
			return upstreamJson(call++ === 0 ? managerBody : participantBody, 200);
		});
		for (const token of ["good-a", "good-b"]) {
			const result = await app.request(
				`/core/v1/sync/bootstrap?rootEventId=${rootEventId}&limit=5`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
						"X-Request-ID": requestId,
					},
				},
			);
			expect(result.status).toBe(200);
		}

		const leakedAssignment = {
			...assignment,
			data: {
				...assignment.data,
				team: { ...team, memberUserIds: [ACTOR_A, ACTOR_B] },
			},
		};
		const concealed = await gateway(async () =>
			upstreamJson(
				bootstrap([assignmentSet, leakedAssignment, decision, response]),
				200,
			),
		).request(`/core/v1/sync/bootstrap?rootEventId=${rootEventId}&limit=5`, {
			headers: {
				Authorization: "Bearer good-b",
				"X-Request-ID": requestId,
			},
		});
		expect(concealed.status).toBe(502);
		expect(await concealed.json()).toEqual(
			errorEnvelope(
				"UPSTREAM_ERROR",
				"A required service returned an invalid response.",
				true,
			),
		);
	});

	test("maps a bounded downstream timeout without exposing its cause", async () => {
		const app = gateway(() => new Promise<Response>(() => undefined));
		const response = await app.request("/core/v1/me", {
			headers: {
				Authorization: "Bearer good-a",
				"X-Request-ID": requestId,
			},
		});

		expect(response.status).toBe(504);
		expect(await response.json()).toEqual(
			errorEnvelope("UPSTREAM_TIMEOUT", "A required service timed out.", true),
		);
	});

	test("keeps the timeout active while reading the downstream body", async () => {
		let cancelled = false;
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('{"id":"partial'));
			},
			cancel() {
				cancelled = true;
				return new Promise<void>(() => undefined);
			},
		});
		const response = await gateway(
			async () =>
				new Response(stream, {
					headers: {
						"Content-Type": "application/json",
						"X-Request-ID": requestId,
					},
				}),
		).request("/core/v1/me", {
			headers: {
				Authorization: "Bearer good-a",
				"X-Request-ID": requestId,
			},
		});

		expect(response.status).toBe(504);
		expect(cancelled).toBe(true);
	});

	test("does not follow downstream redirects", async () => {
		let calls = 0;
		const response = await gateway(async (_input, init) => {
			calls += 1;
			expect(init?.redirect).toBe("manual");
			return new Response(null, {
				status: 307,
				headers: {
					Location: "https://attacker.test/collect",
					"X-Request-ID": requestId,
				},
			});
		}).request("/core/v1/event-roots", {
			method: "POST",
			headers: {
				Authorization: "Bearer good-a",
				"Content-Type": "application/json",
				"Idempotency-Key": "idem.redirect.123",
				"X-Request-ID": requestId,
			},
			body: '{"id":"evt_root","kind":"trip","title":"Crew trip","timeZone":"Europe/Zurich"}',
		});

		expect(response.status).toBe(502);
		expect(calls).toBe(1);
	});

	test("maps a malformed upstream Location header to 502", async () => {
		const response = await gateway(async () =>
			upstreamJson({ event }, 201, { Location: "http://[" }),
		).request("/core/v1/event-roots", {
			method: "POST",
			headers: {
				Authorization: "Bearer good-a",
				"Content-Type": "application/json",
				"Idempotency-Key": "idem.location.123",
				"X-Request-ID": requestId,
			},
			body: '{"id":"evt_root","kind":"trip","title":"Crew trip","timeZone":"Europe/Zurich"}',
		});

		expect(response.status).toBe(502);
		expect((await response.json()).error.code).toBe("UPSTREAM_ERROR");
	});

	test("validates required headers, path values, and query values before fetch", async () => {
		const requests: Array<[string, RequestInit]> = [
			[
				"/core/v1/event-roots",
				{
					method: "POST",
					headers: {
						Authorization: "Bearer good-a",
						"Content-Type": "application/json",
						"X-Request-ID": requestId,
					},
					body: '{"id":"evt_root","kind":"trip","title":"Crew trip","timeZone":"Europe/Zurich"}',
				},
			],
			[
				"/core/v1/event-roots",
				{
					method: "POST",
					headers: {
						Authorization: "Bearer good-a",
						"Content-Type": "application/json",
						"Idempotency-Key": "bad key",
						"X-Request-ID": requestId,
					},
					body: '{"id":"evt_root","kind":"trip","title":"Crew trip","timeZone":"Europe/Zurich"}',
				},
			],
			[
				"/core/v1/event-roots/not-event",
				{
					method: "GET",
					headers: {
						Authorization: "Bearer good-a",
						"X-Request-ID": requestId,
					},
				},
			],
			[
				"/core/v1/event-roots/evt_root/memberships?limit=nope",
				{
					method: "GET",
					headers: {
						Authorization: "Bearer good-a",
						"X-Request-ID": requestId,
					},
				},
			],
			[
				"/core/v1/sync/pull?cursor=abcdefghijklmnop",
				{
					method: "GET",
					headers: {
						Authorization: "Bearer good-a",
						"X-Request-ID": requestId,
					},
				},
			],
		];

		for (const [path, init] of requests) {
			let called = false;
			const response = await gateway(async () => {
				called = true;
				return upstreamJson({}, 200);
			}).request(path, init);
			expect(response.status).toBe(400);
			expect(called).toBe(false);
		}
	});

	test("validates decoded parameters without rebuilding the raw downstream URL", async () => {
		const rawPath =
			"/core/v1/event-roots/evt_root/memberships?cursor=abcdefghijklmnop+q&cursor=abcdefghijklmnop%2Fq&cursor=abcdefghijklmnop%252F&limit=2";
		const response = await gateway(async (input) => {
			expect(String(input)).toBe(
				"https://event.test/v1/event-roots/evt_root/memberships?cursor=abcdefghijklmnop+q&cursor=abcdefghijklmnop%2Fq&cursor=abcdefghijklmnop%252F&limit=2",
			);
			return upstreamJson(
				{ items: [], pageInfo: { nextCursor: null, hasMore: false } },
				200,
			);
		}).request(rawPath, {
			headers: {
				Authorization: "Bearer good-a",
				"X-Request-ID": requestId,
			},
		});

		expect(response.status).toBe(200);
	});

	test("rate limits public routes by IP and protected routes by principal", async () => {
		let publicCalls = 0;
		const publicApp = gateway(
			async (input) => {
				if (String(input) === "https://user.test/v1/me") {
					return upstreamJson(user, 200);
				}
				publicCalls += 1;
				return upstreamJson({ accepted: true }, 202);
			},
			new MemoryRateLimiter(1, 60_000, 10),
		);
		const publicRequest = {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": "idem.public.123",
				"X-Request-ID": requestId,
			},
			body: '{"email":"crew@example.test"}',
		};
		expect(
			(await publicApp.request("/core/v1/auth/magic-links", publicRequest))
				.status,
		).toBe(202);
		const limited = await publicApp.request(
			"/core/v1/auth/magic-links",
			publicRequest,
		);
		expect(limited.status).toBe(429);
		expect(limited.headers.get("Retry-After")).toBe("60");
		expect(publicCalls).toBe(1);

		const authenticationApp = gateway(
			async () => upstreamJson(user, 200),
			new MemoryRateLimiter(1, 60_000, 10),
		);
		expect((await authenticationApp.request("/core/v1/me")).status).toBe(401);
		expect((await authenticationApp.request("/core/v1/me")).status).toBe(429);

		const protectedApp = gateway(
			async () => upstreamJson(user, 200),
			new MemoryRateLimiter(2, 60_000, 10),
		);
		const protectedRequest = (token: string) => ({
			headers: {
				Authorization: `Bearer ${token}`,
				"X-Request-ID": requestId,
			},
		});
		expect(
			(await protectedApp.request("/core/v1/me", protectedRequest("good-a")))
				.status,
		).toBe(200);
		expect(
			(await protectedApp.request("/core/v1/me", protectedRequest("good-b")))
				.status,
		).toBe(200);
		expect(
			(await protectedApp.request("/core/v1/me", protectedRequest("good-a")))
				.status,
		).toBe(429);
	});
});

function operationIds(document: {
	paths: Record<string, Record<string, { operationId?: string }>>;
}): string[] {
	return Object.values(document.paths).flatMap((path) =>
		Object.values(path).flatMap((operation) =>
			operation?.operationId ? [operation.operationId] : [],
		),
	);
}
