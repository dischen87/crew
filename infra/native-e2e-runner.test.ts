import { describe, expect, test } from "bun:test";
import postgres, { type Sql } from "postgres";
import { migrate as migrateEvent } from "../services/event-service/scripts/migrate";
import { migrate as migrateUser } from "../services/user-service/scripts/migrate";
import {
	assertNativeE2ERunnerConfig,
	claimRunnerRedis,
	cleanupRunnerRedis,
	clearFixtureRows,
	createNativeE2EControlPlane,
	createSharedStop,
	nativeE2EFixtureScope,
	stopRunnerServers,
} from "./native-e2e-runner";

const controlBearer = "native-e2e-control-bearer-long-enough";
const fixtureBearer = "native-e2e-fixture-bearer-long-enough";
const auth = { Authorization: `Bearer ${controlBearer}` };

function control(path: string, init: RequestInit = {}) {
	return new Request(`http://127.0.0.1:3101${path}`, {
		...init,
		headers: { ...auth, ...init.headers },
	});
}

function post(path: string, body?: unknown) {
	return control(path, {
		method: "POST",
		...(body === undefined
			? {}
			: {
					body: JSON.stringify(body),
					headers: { ...auth, "Content-Type": "application/json" },
				}),
	});
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function gatedPost(path: string, body: unknown, gate: Promise<void>) {
	const payload = new TextEncoder().encode(JSON.stringify(body));
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			void gate.then(() => {
				controller.enqueue(payload);
				controller.close();
			});
		},
	});
	return control(path, {
		method: "POST",
		body: stream,
		duplex: "half",
		headers: { ...auth, "Content-Type": "application/json" },
	} as RequestInit & { duplex: "half" });
}

function setupResult(scenario: "golf-tour" | "team-event") {
	return {
		scenario,
		rootEventId: "evt_test",
		owner: {
			email: "owner@example.test",
			userId: `usr_${"a".repeat(32)}`,
		},
		participant: {
			email: "participant@example.test",
			userId: `usr_${"b".repeat(32)}`,
		},
	};
}

describe("native E2E runner guards", () => {
	test("accepts only exact disposable databases and isolated Redis 6380", () => {
		const valid = {
			userDatabaseUrl:
				"postgres://crew:secret@127.0.0.1:5432/crew_native_e2e_user_test_0719",
			eventDatabaseUrl:
				"postgres://crew:secret@localhost:5432/crew_native_e2e_event_test_0719",
			redisUrl: "redis://127.0.0.1:6380/15",
			controlPort: 3101,
			controlBearer,
			fixtureBearer,
			deliveryBearer: "native-e2e-delivery-bearer-long-enough",
		};
		expect(assertNativeE2ERunnerConfig(valid)).toBe(valid);
		expect(
			assertNativeE2ERunnerConfig({
				...valid,
				attachments: {
					publicEndpoint: "https://objects.example.test",
					localEndpoint: "http://127.0.0.1:9002",
					apiAccessKeyId: "crewapi",
					apiSecretAccessKey: "api-secret-long-enough",
					workerAccessKeyId: "crewworker",
					workerSecretAccessKey: "worker-secret-long-enough",
					grantKey: "attachment-grant-key-long-enough-2026",
				},
			}),
		).toBeTruthy();
		for (const attachments of [
			{
				publicEndpoint: "http://objects.example.test",
				localEndpoint: "http://127.0.0.1:9002",
			},
			{
				publicEndpoint: "https://objects.example.test",
				localEndpoint: "http://object-store.internal:9002",
			},
		]) {
			expect(() =>
				assertNativeE2ERunnerConfig({
					...valid,
					attachments: {
						...attachments,
						apiAccessKeyId: "crewapi",
						apiSecretAccessKey: "api-secret-long-enough",
						workerAccessKeyId: "crewworker",
						workerSecretAccessKey: "worker-secret-long-enough",
						grantKey: "attachment-grant-key-long-enough-2026",
					},
				}),
			).toThrow("Native E2E attachment configuration is unsafe");
		}
		for (const override of [
			{
				userDatabaseUrl: "postgres://crew:secret@db/crew_native_e2e_user_test",
			},
			{ eventDatabaseUrl: "postgres://crew:secret@localhost/crew_event" },
			{ redisUrl: "redis://127.0.0.1:6379/15" },
			{ redisUrl: "redis://127.0.0.1:6380/0" },
			...[3000, 3001, 3002, 3010, 5432, 5433, 6379, 6380, 8081, 8082].map(
				(controlPort) => ({ controlPort }),
			),
		]) {
			expect(() =>
				assertNativeE2ERunnerConfig({ ...valid, ...override }),
			).toThrow();
		}
	});

	test("reserves both external ports before stores and uses exact transactional cleanup", async () => {
		const source = await Bun.file(
			new URL("./native-e2e-runner.ts", import.meta.url),
		).text();
		const start = source.indexOf("export async function startNativeE2ERunner");
		const publicReservation = source.indexOf("port: PUBLIC_PORT", start);
		const controlReservation = source.indexOf(
			"port: config.controlPort",
			start,
		);
		const postgresOpen = source.indexOf("userSql = postgres", start);
		expect(start).toBeGreaterThan(-1);
		expect(publicReservation).toBeGreaterThan(start);
		expect(controlReservation).toBeGreaterThan(publicReservation);
		expect(publicReservation).toBeLessThan(postgresOpen);
		expect(controlReservation).toBeLessThan(postgresOpen);
		expect(source.slice(start).match(/await clearFixtureRows/g)).toHaveLength(
			2,
		);
		const cleanup = source.slice(
			source.indexOf("export async function clearFixtureRows"),
			source.indexOf("async function removeRunnerRedisKeys"),
		);
		expect(cleanup).not.toContain("TRUNCATE");
		expect(cleanup.match(/sql\.begin/g)).toHaveLength(2);
		const deletes = cleanup.match(/DELETE FROM[\s\S]*?`;/g) ?? [];
		expect(deletes.length).toBeGreaterThan(20);
		for (const statement of deletes) expect(statement).toContain("WHERE");

		expect(nativeE2EFixtureScope.emails).not.toContain(
			"foreign.sentinel@example.test",
		);
		expect(nativeE2EFixtureScope.rootEventIds).not.toContain(
			"evt_foreign_sentinel",
		);
		expect(nativeE2EFixtureScope.emails).toContain("crew.local@example.test");
		expect(nativeE2EFixtureScope.rootEventIds).toContain(
			"evt_local_turkey_golf_2026",
		);
	});

	test("shares one in-flight stop promise across concurrent callers", async () => {
		let release = () => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let cleanups = 0;
		const stop = createSharedStop(async () => {
			cleanups += 1;
			await gate;
		});
		const first = stop();
		const second = stop();
		expect(second).toBe(first);
		expect(cleanups).toBe(1);
		release();
		await first;
		expect(stop()).toBe(first);
	});

	test("does not scan or delete a nonempty Redis sentinel", async () => {
		const commands: string[] = [];
		const keys = new Set(["foreign:sentinel"]);
		const redis = {
			async send(command: string, args: string[]) {
				commands.push(command);
				if (command === "DBSIZE") return keys.size;
				if (command === "SCAN") return ["0", [...keys]];
				if (command === "DEL") {
					for (const key of args) keys.delete(key);
					return args.length;
				}
				throw new Error(`unexpected ${command}`);
			},
		};
		let owned = false;
		await claimRunnerRedis(redis as never)
			.then((value) => {
				owned = value;
			})
			.catch(() => {});
		await cleanupRunnerRedis(redis as never, owned);
		expect(owned).toBe(false);
		expect(commands).toEqual(["DBSIZE"]);
		expect(keys).toEqual(new Set(["foreign:sentinel"]));
	});

	test("awaits all four server stops before lifecycle cleanup can continue", async () => {
		const gates = Array.from({ length: 4 }, deferred);
		const calls: number[] = [];
		const stopping = stopRunnerServers(
			gates.map((gate, index) => ({
				stop(closeActiveConnections?: boolean) {
					expect(closeActiveConnections).toBe(true);
					calls.push(index);
					return gate.promise;
				},
			})),
		);
		await Promise.resolve();
		expect(calls).toEqual([0, 1, 2, 3]);
		let settled = false;
		void stopping.then(() => {
			settled = true;
		});
		for (const gate of gates.slice(0, 3)) gate.resolve();
		await Promise.resolve();
		expect(settled).toBe(false);
		gates[3]?.resolve();
		await stopping;
		expect(settled).toBe(true);

		const source = await Bun.file(
			new URL("./native-e2e-runner.ts", import.meta.url),
		).text();
		const stopStart = source.indexOf("const stop = createSharedStop");
		const serversStopped = source.indexOf("await stopRunnerServers", stopStart);
		const storesCleaned = source.indexOf("await clearFixtureRows", stopStart);
		expect(serversStopped).toBeGreaterThan(stopStart);
		expect(serversStopped).toBeLessThan(storesCleaned);
		const main = source.slice(source.indexOf("if (import.meta.main)"));
		expect(main).toContain("process.on(signal");
		expect(main).not.toContain("process.once(signal");
		expect(main).toContain("process.exit(1)");
	});
});

describe("native E2E facade and control plane", () => {
	test("checks fixture auth before invoking the delivery side effect", async () => {
		let providerCalls = 0;
		const plane = createNativeE2EControlPlane({
			controlBearer,
			fixtureBearer,
			providerConsume: async () => {
				providerCalls += 1;
				return new Response(null, { status: 204 });
			},
			setup: async () => {
				throw new Error("not used");
			},
			gatewayFetch: async () => new Response(null, { status: 204 }),
		});
		const consume = (bearer: string) =>
			new Request("http://127.0.0.1:3101/internal/magic-links/consume", {
				method: "POST",
				headers: { Authorization: `Bearer ${bearer}` },
			});
		expect(
			(await plane.controlFetch(consume("wrong-fixture-bearer"))).status,
		).toBe(401);
		expect(providerCalls).toBe(0);
		expect((await plane.controlFetch(consume(fixtureBearer))).status).toBe(204);
		expect(providerCalls).toBe(1);
	});

	test("atomically claims parallel setup and fault-arm requests after parsing", async () => {
		const setupBodyGate = deferred();
		const setupStarted = deferred();
		const setupRelease = deferred();
		let setupCalls = 0;
		const plane = createNativeE2EControlPlane({
			controlBearer,
			fixtureBearer,
			providerConsume: async () => new Response(null, { status: 404 }),
			gatewayFetch: async () => new Response(null, { status: 204 }),
			setup: async (scenario) => {
				setupCalls += 1;
				setupStarted.resolve();
				await setupRelease.promise;
				return setupResult(scenario);
			},
		});
		const setupResponses = [
			plane.controlFetch(
				gatedPost(
					"/v1/setup",
					{ scenario: "golf-tour" },
					setupBodyGate.promise,
				),
			),
			plane.controlFetch(
				gatedPost(
					"/v1/setup",
					{ scenario: "golf-tour" },
					setupBodyGate.promise,
				),
			),
		];
		setupBodyGate.resolve();
		await setupStarted.promise;
		expect(setupCalls).toBe(1);
		setupRelease.resolve();
		expect(
			(await Promise.all(setupResponses)).map(({ status }) => status).sort(),
		).toEqual([201, 409]);

		const requestId = "crew-e2e.ios";
		await plane.controlFetch(
			post("/v1/traces/allow", { requestIds: [requestId] }),
		);
		const armBodyGate = deferred();
		const armResponses = [
			plane.controlFetch(
				gatedPost(
					"/v1/faults/sync-push-once",
					{ requestId },
					armBodyGate.promise,
				),
			),
			plane.controlFetch(
				gatedPost(
					"/v1/faults/sync-push-once",
					{ requestId },
					armBodyGate.promise,
				),
			),
		];
		armBodyGate.resolve();
		expect(
			(await Promise.all(armResponses)).map(({ status }) => status).sort(),
		).toEqual([201, 409]);
	});

	test("validates and atomically arms the exact one-shot publish barrier", async () => {
		const plane = createNativeE2EControlPlane({
			controlBearer,
			fixtureBearer,
			providerConsume: async () => new Response(null, { status: 404 }),
			setup: async () => {
				throw new Error("not used");
			},
			gatewayFetch: async () => new Response(null, { status: 204 }),
		});
		const requestId = "crew-e2e.ios";
		const rootEventId = "evt_publish_basics_final";
		const barrierPath = "/v1/barriers/events-publish-once";
		const arm = { requestId, rootEventId };

		expect((await plane.controlFetch(post(barrierPath, arm))).status).toBe(409);
		await plane.controlFetch(
			post("/v1/traces/allow", { requestIds: [requestId] }),
		);
		for (const invalid of [
			{ requestId, rootEventId: "evt_token_secret" },
			{ requestId, rootEventId: "wrong_root" },
			{ ...arm, extra: true },
		]) {
			expect(
				(await plane.controlFetch(post(barrierPath, invalid))).status,
			).toBe(400);
		}
		expect(
			(
				await plane.controlFetch(
					post(barrierPath, { requestId, rootEventId: "x".repeat(4_097) }),
				)
			).status,
		).toBe(413);

		const bodyGate = deferred();
		const responses = [
			plane.controlFetch(gatedPost(barrierPath, arm, bodyGate.promise)),
			plane.controlFetch(gatedPost(barrierPath, arm, bodyGate.promise)),
		];
		bodyGate.resolve();
		expect(
			(await Promise.all(responses)).map(({ status }) => status).sort(),
		).toEqual([201, 409]);
		expect(
			(
				await plane.controlFetch(
					post("/v1/barriers/events-publish-once/release"),
				)
			).status,
		).toBe(409);
		expect((await plane.controlFetch(control(barrierPath))).status).toBe(200);
		expect(
			await (await plane.controlFetch(control(barrierPath))).json(),
		).toEqual({ publishBarrier: "armed" });
		expect(
			(await plane.controlFetch(control(barrierPath, { method: "DELETE" })))
				.status,
		).toBe(204);
	});

	test("holds only the exact eventsPublish request, releases it unchanged, and is one-shot", async () => {
		const requestId = "crew-e2e.ios";
		const rootEventId = "evt_publish_basics_final";
		const secretBody = JSON.stringify({
			baseRevision: "5",
			baseVersion: 3,
			private: "never-retain-publish-body",
		});
		const secretToken = "Bearer never-retain-publish-token";
		const idempotencyKey = "never-retain-publish-idempotency";
		const forwarded: Array<{
			authorization: string | null;
			body: string;
			method: string;
			path: string;
		}> = [];
		const plane = createNativeE2EControlPlane({
			controlBearer,
			fixtureBearer,
			providerConsume: async () => new Response(null, { status: 404 }),
			setup: async () => {
				throw new Error("not used");
			},
			gatewayFetch: async (request) => {
				forwarded.push({
					authorization: request.headers.get("authorization"),
					body: await request.text(),
					method: request.method,
					path: new URL(request.url).pathname,
				});
				return new Response(null, {
					status: 409,
					headers: { "X-Request-ID": requestId },
				});
			},
		});
		await plane.controlFetch(
			post("/v1/traces/allow", { requestIds: [requestId] }),
		);
		expect(
			(
				await plane.controlFetch(
					post("/v1/barriers/events-publish-once", {
						requestId,
						rootEventId,
					}),
				)
			).status,
		).toBe(201);

		const publish = (id = requestId, root = rootEventId) =>
			new Request(`http://127.0.0.1:3000/core/v1/event-roots/${root}/publish`, {
				method: "POST",
				headers: {
					Authorization: secretToken,
					"Content-Type": "application/json",
					"Idempotency-Key": idempotencyKey,
					"X-Request-ID": id,
				},
				body: secretBody,
			});
		const blocked = plane.publicFetch(publish());
		expect(forwarded).toHaveLength(0);
		const status = await plane.controlFetch(control("/v1/status"));
		const barrierStatus = await plane.controlFetch(
			control("/v1/barriers/events-publish-once"),
		);
		expect(await barrierStatus.json()).toEqual({ publishBarrier: "reached" });
		const retained = JSON.stringify({
			barrier: await status.json(),
			traces: plane.traces(),
		});
		for (const value of [secretBody, secretToken, idempotencyKey]) {
			expect(retained).not.toContain(value);
		}
		expect(plane.traces()).toHaveLength(0);

		expect((await plane.publicFetch(publish())).status).toBe(503);
		expect(forwarded).toHaveLength(0);
		expect(
			(
				await plane.controlFetch(
					post("/v1/barriers/events-publish-once/release"),
				)
			).status,
		).toBe(200);
		expect((await blocked).status).toBe(409);
		expect(forwarded).toEqual([
			{
				authorization: secretToken,
				body: secretBody,
				method: "POST",
				path: `/core/v1/event-roots/${rootEventId}/publish`,
			},
		]);
		expect((await plane.publicFetch(publish())).status).toBe(409);
		expect(forwarded).toHaveLength(2);
	});

	test("does not block adjacent publish routes and cancels a reached barrier fail closed", async () => {
		const requestId = "crew-e2e.android";
		const rootEventId = "evt_publish_basics_final";
		let gatewayCalls = 0;
		const plane = createNativeE2EControlPlane({
			controlBearer,
			fixtureBearer,
			providerConsume: async () => new Response(null, { status: 404 }),
			setup: async () => {
				throw new Error("not used");
			},
			gatewayFetch: async () => {
				gatewayCalls += 1;
				return new Response(null, { status: 204 });
			},
		});
		await plane.controlFetch(
			post("/v1/traces/allow", { requestIds: [requestId] }),
		);
		const arm = () =>
			plane.controlFetch(
				post("/v1/barriers/events-publish-once", {
					requestId,
					rootEventId,
				}),
			);
		const request = (path: string, method = "POST", id = requestId) =>
			new Request(`http://127.0.0.1:3000${path}`, {
				method,
				headers: { "X-Request-ID": id },
				body: method === "POST" ? "{}" : undefined,
			});
		await arm();
		for (const adjacent of [
			request(`/core/v1/event-roots/${rootEventId}/publish`, "GET"),
			request("/core/v1/event-roots/evt_other/publish"),
			request(`/core/v1/event-roots/${rootEventId}/recap/publish`),
			request(
				`/core/v1/event-roots/${rootEventId}/publish`,
				"POST",
				"crew-e2e.ios",
			),
		]) {
			expect((await plane.publicFetch(adjacent)).status).toBe(204);
		}
		expect(gatewayCalls).toBe(4);

		const exact = () => request(`/core/v1/event-roots/${rootEventId}/publish`);
		const cancelled = plane.publicFetch(exact());
		plane.cancelPublishBarrier();
		expect((await cancelled).status).toBe(503);
		expect(gatewayCalls).toBe(4);
		expect(
			await (await plane.controlFetch(control("/v1/status"))).json(),
		).toMatchObject({ publishBarrier: "idle" });

		await arm();
		const cancelledByControl = plane.publicFetch(exact());
		expect(
			(
				await plane.controlFetch(
					control("/v1/barriers/events-publish-once", {
						method: "DELETE",
					}),
				)
			).status,
		).toBe(204);
		expect((await cancelledByControl).status).toBe(503);
		expect(gatewayCalls).toBe(4);
	});

	test("publish barrier state has no request or credential storage fields", async () => {
		const source = await Bun.file(
			new URL("./native-e2e-runner.ts", import.meta.url),
		).text();
		const start = source.indexOf("type PublishBarrierState");
		const end = source.indexOf("export type NativeE2EControlPlane", start);
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		expect(source.slice(start, end)).not.toMatch(
			/\b(?:Request|Headers|body|authorization|idempotency|token|secret)\b/i,
		);
	});

	test("suppresses one committed success and records sanitized exact replay proof", async () => {
		let gatewayCalls = 0;
		const setupCalls: string[] = [];
		const plane = createNativeE2EControlPlane({
			controlBearer,
			fixtureBearer,
			providerConsume: async () => Response.json({ token: "test-only" }),
			setup: async (scenario) => {
				setupCalls.push(scenario);
				return {
					scenario,
					rootEventId: "evt_test",
					owner: {
						email: "owner@example.test",
						userId: `usr_${"a".repeat(32)}`,
					},
					participant: {
						email: "participant@example.test",
						userId: `usr_${"b".repeat(32)}`,
					},
				};
			},
			gatewayFetch: async (request) => {
				gatewayCalls += 1;
				return Response.json(
					{ committed: true },
					{
						headers: {
							"X-Request-ID": request.headers.get("X-Request-ID") ?? "missing",
							...(gatewayCalls > 1 ? { "Idempotency-Replayed": "true" } : {}),
						},
					},
				);
			},
		});

		expect(
			(await plane.controlFetch(new Request("http://127.0.0.1:3101/v1/status")))
				.status,
		).toBe(401);
		expect(
			(await plane.controlFetch(post("/v1/setup", { scenario: "golf-tour" })))
				.status,
		).toBe(201);
		expect(setupCalls).toEqual(["golf-tour"]);
		expect(
			(await plane.controlFetch(post("/v1/setup", { scenario: "team-event" })))
				.status,
		).toBe(409);

		const firstId = "crew-e2e.ios";
		const replayId = "crew-e2e.android";
		expect(
			(
				await plane.controlFetch(
					post("/v1/faults/sync-push-once", { requestId: firstId }),
				)
			).status,
		).toBe(409);
		expect(
			(
				await plane.controlFetch(
					post("/v1/faults/sync-push-once", { requestId: firstId }),
				)
			).status,
		).toBe(409);
		await plane.controlFetch(
			post("/v1/traces/allow", {
				requestIds: [firstId, replayId, "fixture.e2e.golf-tour.ios.push.v1"],
			}),
		);
		expect(
			(
				await plane.controlFetch(
					post("/v1/faults/sync-push-once", { requestId: firstId }),
				)
			).status,
		).toBe(201);

		const body = JSON.stringify({ mutations: [{ private: "never-store-me" }] });
		const idempotencyKey = "private-idempotency-key-never-store-me";
		const syncRequest = (id: string) =>
			new Request("http://127.0.0.1:3000/core/v1/sync/push", {
				method: "POST",
				headers: {
					Authorization: "Bearer private-access-token-never-store-me",
					"Content-Type": "application/json",
					"Idempotency-Key": idempotencyKey,
					"X-Request-ID": id,
				},
				body,
			});

		const suppressed = await plane.publicFetch(syncRequest(firstId));
		expect(suppressed.status).toBe(503);
		expect(suppressed.headers.get("X-Request-ID")).toBe(firstId);
		expect((await suppressed.json()).error.retryable).toBe(true);
		const replay = await plane.publicFetch(syncRequest(replayId));
		expect(replay.status).toBe(200);
		expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
		expect(gatewayCalls).toBe(2);

		const traces = plane.traces();
		expect(traces).toHaveLength(2);
		expect(traces[0]).toMatchObject({
			requestId: firstId,
			replayed: false,
			outcome: "success-suppressed",
			downstreamStatus: 200,
			facadeStatus: 503,
		});
		expect(traces[1]).toMatchObject({
			requestId: replayId,
			replayed: true,
			outcome: "forwarded",
			downstreamStatus: 200,
			facadeStatus: 200,
		});
		expect(traces[0]?.bodyFingerprint).toBe(traces[1]?.bodyFingerprint);
		expect(traces[0]?.idempotencyFingerprint).toBe(
			traces[1]?.idempotencyFingerprint,
		);
		const serialized = JSON.stringify(traces);
		for (const secret of [
			"never-store-me",
			"private-access-token",
			idempotencyKey,
		]) {
			expect(serialized).not.toContain(secret);
		}
		for (const requestId of [
			"sk-secret",
			"api_key.secret",
			"token_value",
			"session-secret",
			"password_reset",
			"private_key",
			"jwt_token",
			"trace.token_value",
			"trace.eyJfake",
			"trace.ghp_example",
			"trace.password_reset",
			"native.e2e.trace.eyJfake",
			"fixture.e2e.trace.ghp-example",
		]) {
			expect(
				(
					await plane.controlFetch(
						post("/v1/traces/allow", { requestIds: [requestId] }),
					)
				).status,
			).toBe(400);
		}
	});

	test("binds the one-shot feedback fault to the exact create route and retains only fingerprints", async () => {
		const requestId = "crew-e2e.ios";
		const feedbackId = "fbk_00000000-0000-4000-8000-000000000001";
		const idempotencyKey = `feedback-${feedbackId}`;
		let gatewayCalls = 0;
		let feedbackCalls = 0;
		const plane = createNativeE2EControlPlane({
			controlBearer,
			fixtureBearer,
			providerConsume: async () => new Response(null, { status: 404 }),
			setup: async () => {
				throw new Error("not used");
			},
			gatewayFetch: async (request) => {
				gatewayCalls += 1;
				if (
					request.method === "POST" &&
					new URL(request.url).pathname === "/core/v1/feedback"
				) {
					feedbackCalls += 1;
				}
				return Response.json(
					{ feedback: { id: feedbackId } },
					{
						status: 201,
						headers: {
							"X-Request-ID": request.headers.get("X-Request-ID") ?? "missing",
							...(feedbackCalls > 1 ? { "Idempotency-Replayed": "true" } : {}),
						},
					},
				);
			},
		});
		await plane.controlFetch(
			post("/v1/traces/allow", { requestIds: [requestId] }),
		);
		expect(
			(
				await plane.controlFetch(
					post("/v1/faults/feedback-create-once", { requestId }),
				)
			).status,
		).toBe(201);

		const body = JSON.stringify({
			body: "private feedback body never retained",
			id: feedbackId,
			title: "private title never retained",
			visibility: "private",
		});
		const request = (path: string, method = "POST") =>
			new Request(`http://127.0.0.1:3000${path}`, {
				method,
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": idempotencyKey,
					"X-Request-ID": requestId,
				},
				body: method === "POST" ? body : undefined,
			});

		expect(
			(await plane.publicFetch(request("/core/v1/sync/push"))).status,
		).toBe(201);
		expect(
			(await plane.publicFetch(request("/core/v1/feedback", "PUT"))).status,
		).toBe(201);
		expect((await plane.publicFetch(request("/core/v1/feedback"))).status).toBe(
			503,
		);
		expect((await plane.publicFetch(request("/core/v1/feedback"))).status).toBe(
			201,
		);
		expect(gatewayCalls).toBe(4);

		const feedbackTraces = plane
			.traces()
			.filter(({ operation }) => operation === "feedback-create");
		expect(feedbackTraces).toHaveLength(2);
		expect(feedbackTraces.map(({ outcome }) => outcome)).toEqual([
			"success-suppressed",
			"forwarded",
		]);
		expect(feedbackTraces[0]?.replayed).toBe(false);
		expect(feedbackTraces[1]?.replayed).toBe(true);
		expect(feedbackTraces[0]?.bodyFingerprint).toBe(
			feedbackTraces[1]?.bodyFingerprint,
		);
		expect(feedbackTraces[0]?.idempotencyFingerprint).toBe(
			feedbackTraces[1]?.idempotencyFingerprint,
		);
		expect(feedbackTraces[0]?.feedbackFingerprint).toBe(
			feedbackTraces[1]?.feedbackFingerprint,
		);
		const retained = JSON.stringify(feedbackTraces);
		for (const raw of [
			requestId,
			feedbackId,
			idempotencyKey,
			"private feedback body",
			"private title",
		]) {
			expect(retained).not.toContain(raw);
		}
	});

	test("leaves an allowlisted feedback fault armed for a different request channel", async () => {
		const allowedRequestId = "crew-e2e.ios";
		const otherRequestId = "crew-e2e.android";
		let gatewayCalls = 0;
		const plane = createNativeE2EControlPlane({
			controlBearer,
			fixtureBearer,
			providerConsume: async () => new Response(null, { status: 404 }),
			setup: async () => {
				throw new Error("not used");
			},
			gatewayFetch: async (request) => {
				gatewayCalls += 1;
				return Response.json(
					{ feedback: { id: "fbk_request_channel" } },
					{
						status: 201,
						headers: {
							"X-Request-ID": request.headers.get("X-Request-ID") ?? "missing",
						},
					},
				);
			},
		});
		await plane.controlFetch(
			post("/v1/traces/allow", { requestIds: [allowedRequestId] }),
		);
		await plane.controlFetch(
			post("/v1/faults/feedback-create-once", {
				requestId: allowedRequestId,
			}),
		);
		const create = (requestId: string) =>
			new Request("http://127.0.0.1:3000/core/v1/feedback", {
				method: "POST",
				headers: {
					"Idempotency-Key": "feedback-request-channel-safe-key",
					"X-Request-ID": requestId,
				},
				body: JSON.stringify({
					body: "bounded",
					id: "fbk_request_channel",
					title: "Request channel",
					visibility: "private",
				}),
			});

		expect((await plane.publicFetch(create(otherRequestId))).status).toBe(201);
		const status = await plane.controlFetch(control("/v1/status"));
		expect((await status.json()).fault).toBe("armed");
		expect((await plane.publicFetch(create(allowedRequestId))).status).toBe(
			503,
		);
		expect(gatewayCalls).toBe(2);
		expect(plane.traces()).toHaveLength(1);
		expect(plane.traces()[0]?.outcome).toBe("success-suppressed");
	});

	test("suppresses exactly one of two parallel feedback creates", async () => {
		const requestId = "crew-e2e.android";
		const responseBodyGate = deferred();
		const bothGatewayCalls = deferred();
		let gatewayCalls = 0;
		const plane = createNativeE2EControlPlane({
			controlBearer,
			fixtureBearer,
			providerConsume: async () => new Response(null, { status: 404 }),
			setup: async () => {
				throw new Error("not used");
			},
			gatewayFetch: async (request) => {
				gatewayCalls += 1;
				if (gatewayCalls === 2) bothGatewayCalls.resolve();
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							void responseBodyGate.promise.then(() => {
								controller.enqueue(new TextEncoder().encode("committed"));
								controller.close();
							});
						},
					}),
					{
						status: 201,
						headers: {
							"X-Request-ID": request.headers.get("X-Request-ID") ?? "missing",
						},
					},
				);
			},
		});
		await plane.controlFetch(
			post("/v1/traces/allow", { requestIds: [requestId] }),
		);
		await plane.controlFetch(
			post("/v1/faults/feedback-create-once", { requestId }),
		);
		const create = () =>
			new Request("http://127.0.0.1:3000/core/v1/feedback", {
				method: "POST",
				headers: {
					"Idempotency-Key": "feedback-parallel-safe-key",
					"X-Request-ID": requestId,
				},
				body: JSON.stringify({
					body: "bounded",
					id: "fbk_parallel",
					title: "Parallel",
					visibility: "private",
				}),
			});
		const responses = [
			plane.publicFetch(create()),
			plane.publicFetch(create()),
		];
		await bothGatewayCalls.promise;
		responseBodyGate.resolve();
		expect(
			(await Promise.all(responses)).map(({ status }) => status).sort(),
		).toEqual([201, 503]);
		expect(gatewayCalls).toBe(2);
		expect(
			plane
				.traces()
				.map(({ outcome }) => outcome)
				.sort(),
		).toEqual(["forwarded", "success-suppressed"]);
	});

	test("claims one parallel committed-success suppression before reading bodies", async () => {
		const requestId = "crew-e2e.ios";
		const responseBodyGate = deferred();
		const bothGatewayCalls = deferred();
		let gatewayCalls = 0;
		const plane = createNativeE2EControlPlane({
			controlBearer,
			fixtureBearer,
			providerConsume: async () => new Response(null, { status: 404 }),
			setup: async () => {
				throw new Error("not used");
			},
			gatewayFetch: async (request) => {
				gatewayCalls += 1;
				if (gatewayCalls === 2) bothGatewayCalls.resolve();
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							void responseBodyGate.promise.then(() => {
								controller.enqueue(new TextEncoder().encode("committed"));
								controller.close();
							});
						},
					}),
					{
						headers: {
							"X-Request-ID": request.headers.get("X-Request-ID") ?? "missing",
						},
					},
				);
			},
		});
		await plane.controlFetch(
			post("/v1/traces/allow", { requestIds: [requestId] }),
		);
		await plane.controlFetch(post("/v1/faults/sync-push-once", { requestId }));
		const push = () =>
			new Request("http://127.0.0.1:3000/core/v1/sync/push", {
				method: "POST",
				headers: {
					"Idempotency-Key": "native-e2e-parallel-key",
					"X-Request-ID": requestId,
				},
				body: "{}",
			});
		const responses = [plane.publicFetch(push()), plane.publicFetch(push())];
		await bothGatewayCalls.promise;
		await Promise.resolve();
		const status = await plane.controlFetch(control("/v1/status"));
		expect((await status.json()).fault).toBe("idle");
		responseBodyGate.resolve();
		expect(
			(await Promise.all(responses)).map(({ status }) => status).sort(),
		).toEqual([200, 503]);
		expect(gatewayCalls).toBe(2);
		expect(
			plane
				.traces()
				.map(({ outcome }) => outcome)
				.sort(),
		).toEqual(["forwarded", "success-suppressed"]);
	});

	test("keeps the fault armed when downstream correlation does not match", async () => {
		let gatewayCalls = 0;
		const requestId = "crew-e2e.ios";
		const plane = createNativeE2EControlPlane({
			controlBearer,
			fixtureBearer,
			providerConsume: async () => new Response(null, { status: 404 }),
			setup: async () => {
				throw new Error("not used");
			},
			gatewayFetch: async () => {
				gatewayCalls += 1;
				return Response.json(
					{ committed: true },
					{
						headers: {
							"X-Request-ID": gatewayCalls === 1 ? "wrong-id" : requestId,
						},
					},
				);
			},
		});
		await plane.controlFetch(
			post("/v1/traces/allow", { requestIds: [requestId] }),
		);
		await plane.controlFetch(post("/v1/faults/sync-push-once", { requestId }));
		const push = () =>
			new Request("http://127.0.0.1:3000/core/v1/sync/push", {
				method: "POST",
				headers: {
					"Idempotency-Key": "native-e2e-correlation-key",
					"X-Request-ID": requestId,
				},
				body: "{}",
			});
		expect((await plane.publicFetch(push())).status).toBe(200);
		expect((await plane.publicFetch(push())).status).toBe(503);
		expect(plane.traces().map(({ outcome }) => outcome)).toEqual([
			"forwarded",
			"success-suppressed",
		]);
	});

	test("detach blocks downstream until the idempotent attach endpoint restores it", async () => {
		let gatewayCalls = 0;
		const plane = createNativeE2EControlPlane({
			controlBearer,
			fixtureBearer,
			providerConsume: async () => new Response(null, { status: 404 }),
			setup: async () => {
				throw new Error("not used");
			},
			gatewayFetch: async (request) => {
				gatewayCalls += 1;
				return new Response(null, {
					status: 204,
					headers: {
						"X-Request-ID": request.headers.get("X-Request-ID") ?? "x",
					},
				});
			},
		});
		const request = () =>
			new Request("http://127.0.0.1:3000/core/v1/me", {
				headers: { "X-Request-ID": "crew-e2e.ios" },
			});
		expect(
			(await plane.controlFetch(post("/v1/transport/detach", {}))).status,
		).toBe(400);
		expect((await plane.publicFetch(request())).status).toBe(204);
		expect(
			(
				await plane.controlFetch(
					post("/v1/transport/detach", "x".repeat(4_097)),
				)
			).status,
		).toBe(413);
		expect((await plane.publicFetch(request())).status).toBe(204);
		await plane.controlFetch(post("/v1/transport/detach"));
		expect((await plane.publicFetch(request())).status).toBe(503);
		expect(gatewayCalls).toBe(2);
		expect(
			(await plane.controlFetch(post("/v1/transport/attach", {}))).status,
		).toBe(400);
		expect((await plane.publicFetch(request())).status).toBe(503);
		expect(
			(
				await plane.controlFetch(
					post("/v1/transport/attach", "x".repeat(4_097)),
				)
			).status,
		).toBe(413);
		await plane.controlFetch(post("/v1/transport/attach"));
		expect((await plane.publicFetch(request())).status).toBe(204);
		expect(gatewayCalls).toBe(3);
	});
});

const cleanupUserDatabaseUrl = Bun.env.NATIVE_E2E_USER_DATABASE_URL;
const cleanupEventDatabaseUrl = Bun.env.NATIVE_E2E_EVENT_DATABASE_URL;

if (!cleanupUserDatabaseUrl || !cleanupEventDatabaseUrl) {
	test.skip("exact fixture cleanup preserves PostgreSQL sentinels (set both NATIVE_E2E database URLs)", () => {});
} else {
	test("exact fixture cleanup removes its namespace and preserves foreign PostgreSQL sentinels", async () => {
		const config = assertNativeE2ERunnerConfig({
			userDatabaseUrl: cleanupUserDatabaseUrl,
			eventDatabaseUrl: cleanupEventDatabaseUrl,
			redisUrl: "redis://127.0.0.1:6380/15",
			controlPort: 3101,
			controlBearer,
			fixtureBearer,
			deliveryBearer: "native-e2e-delivery-bearer-long-enough",
		});
		const userSql = postgres(config.userDatabaseUrl, {
			max: 2,
			onnotice: () => {},
		});
		const eventSql = postgres(config.eventDatabaseUrl, {
			max: 2,
			onnotice: () => {},
		});
		const sentinelUserId = `usr_${"e".repeat(32)}`;
		const fixtureUserId = `usr_${"d".repeat(32)}`;
		const sentinelEmail = "foreign.sentinel@example.test";
		const fixtureEmail = "crew.local@example.test";
		const sentinelRootId = "evt_foreign_sentinel";
		const fixtureRootId = "evt_local_turkey_golf_2026";
		const sentinelPlaceId = "plc_foreign_sentinel";
		const fixturePlaceId = "plc_local_fixture_cleanup";
		const sentinelRootlessFeedbackId = "fbk_foreign_rootless_sentinel";
		const fixtureRootlessFeedbackId = "fbk_fixture_rootless_cleanup";
		const fixtureRootFeedbackId = "fbk_fixture_root_cleanup";
		const sentinelRootFeedbackId = "fbk_foreign_root_sentinel";
		const fixtureActorForeignRootFeedbackId = "fbk_fixture_actor_foreign_root";
		const cleanupFeedbackIds = [
			sentinelRootlessFeedbackId,
			fixtureRootlessFeedbackId,
			fixtureRootFeedbackId,
			sentinelRootFeedbackId,
			fixtureActorForeignRootFeedbackId,
		];

		try {
			await migrateUser(userSql);
			await migrateEvent(eventSql);
			await clearFixtureRows(userSql, eventSql);

			await userSql`
					INSERT INTO users (id, email, email_verified_at, created_at) VALUES
						(${sentinelUserId}, ${sentinelEmail}, now(), now()),
						(${fixtureUserId}, ${fixtureEmail}, now(), now())
				`;
			await userSql`
					INSERT INTO user_magic_links (
						id, email, token_hash, expires_at
					) VALUES
						(${`ml_${"e".repeat(32)}`}, ${sentinelEmail}, ${"e".repeat(64)}, now() + interval '1 hour'),
						(${`ml_${"d".repeat(32)}`}, ${fixtureEmail}, ${"d".repeat(64)}, now() + interval '1 hour')
				`;
			await userSql`
					INSERT INTO user_idempotency_records (
						scope, operation_id, idempotency_key, fingerprint, state,
						response_status, response_payload, response_headers,
						created_at, completed_at, expires_at
					) VALUES
						(
							${`user:${sentinelUserId}`}, 'usersMeUpdate',
							'foreign.sentinel.idempotency', ${"e".repeat(64)},
							'completed', 200, '{}', '{}'::jsonb,
							now(), now(), now() + interval '30 days'
						),
						(
							${`user:${fixtureUserId}`}, 'usersMeUpdate',
							'fixture.cleanup.integration', ${"d".repeat(64)},
							'completed', 200, '{}', '{}'::jsonb,
							now(), now(), now() + interval '30 days'
						)
				`;

			await eventSql.begin(async (transaction) => {
				const tx = transaction as unknown as Sql;
				await tx`
						INSERT INTO event_roots (root_event_id) VALUES
							(${sentinelRootId}), (${fixtureRootId})
					`;
				await tx`
						INSERT INTO events (
							id, root_event_id, kind, title, time_zone
						) VALUES
							(${sentinelRootId}, ${sentinelRootId}, 'trip', 'Foreign sentinel', 'UTC'),
							(${fixtureRootId}, ${fixtureRootId}, 'trip', 'Fixture cleanup', 'UTC')
					`;
				await tx`
						INSERT INTO event_memberships (root_event_id, user_id, role) VALUES
							(${sentinelRootId}, ${sentinelUserId}, 'owner'),
							(${fixtureRootId}, ${fixtureUserId}, 'owner')
					`;
				await tx`
						INSERT INTO event_places (
							id, root_event_id, name, country_code
						) VALUES
							(${sentinelPlaceId}, ${sentinelRootId}, 'Foreign sentinel', 'CH'),
							(${fixturePlaceId}, ${fixtureRootId}, 'Fixture cleanup', 'TR')
					`;
				await tx`
						INSERT INTO event_idempotency_records (
							actor_id, operation_id, idempotency_key, request_hash, state,
							response_status, response_body, response_headers, completed_at
						) VALUES
							(
								${sentinelUserId}, 'eventRootsCreate',
								'foreign.sentinel.idempotency', ${"e".repeat(64)},
								'complete', 201, '{}'::jsonb, '{}'::jsonb, now()
							),
							(
								${fixtureUserId}, 'eventRootsCreate',
								'fixture.cleanup.integration', ${"d".repeat(64)},
								'complete', 201, '{}'::jsonb, '{}'::jsonb, now()
							)
					`;
				await tx`
						INSERT INTO event_feedback (
							id, root_event_id, title, body, visibility, author_user_id
						) VALUES
							(
								${sentinelRootlessFeedbackId}, NULL, 'Foreign rootless',
								'Preserve foreign rootless feedback', 'private', ${sentinelUserId}
							),
							(
								${fixtureRootlessFeedbackId}, NULL, 'Fixture rootless',
								'Remove fixture rootless feedback', 'private', ${fixtureUserId}
							),
							(
								${fixtureRootFeedbackId}, ${fixtureRootId}, 'Fixture root',
								'Remove fixture-root feedback', 'private', ${fixtureUserId}
							),
							(
								${sentinelRootFeedbackId}, ${sentinelRootId}, 'Foreign root',
								'Preserve foreign-root feedback', 'private', ${sentinelUserId}
							),
							(
								${fixtureActorForeignRootFeedbackId}, ${sentinelRootId},
								'Fixture actor foreign root', 'Preserve scoped foreign-root feedback',
								'private', ${fixtureUserId}
							)
					`;
				await tx`
						INSERT INTO event_feedback_status_history (
							feedback_id, version, to_status, changed_by
						) VALUES
							(${sentinelRootlessFeedbackId}, 1, 'open', ${sentinelUserId}),
							(${fixtureRootlessFeedbackId}, 1, 'open', ${fixtureUserId}),
							(${fixtureRootFeedbackId}, 1, 'open', ${fixtureUserId}),
							(${sentinelRootFeedbackId}, 1, 'open', ${sentinelUserId}),
							(${fixtureActorForeignRootFeedbackId}, 1, 'open', ${fixtureUserId})
					`;
				await tx`
						INSERT INTO event_feedback_votes (feedback_id, user_id) VALUES
							(${sentinelRootlessFeedbackId}, ${sentinelUserId}),
							(${fixtureRootlessFeedbackId}, ${fixtureUserId}),
							(${fixtureRootFeedbackId}, ${fixtureUserId}),
							(${sentinelRootFeedbackId}, ${sentinelUserId}),
							(${fixtureActorForeignRootFeedbackId}, ${fixtureUserId})
					`;
				await tx`
						INSERT INTO event_feedback_comments (
							id, feedback_id, author_user_id, body
						) VALUES
							(
								${`fbc_${"a".repeat(32)}`}, ${sentinelRootlessFeedbackId},
								${sentinelUserId}, 'Preserve foreign rootless comment'
							),
							(
								${`fbc_${"b".repeat(32)}`}, ${fixtureRootlessFeedbackId},
								${fixtureUserId}, 'Remove fixture rootless comment'
							),
							(
								${`fbc_${"d".repeat(32)}`}, ${fixtureRootFeedbackId},
								${fixtureUserId}, 'Remove fixture-root comment'
							),
							(
								${`fbc_${"c".repeat(32)}`}, ${sentinelRootFeedbackId},
								${sentinelUserId}, 'Preserve foreign-root comment'
							),
							(
								${`fbc_${"f".repeat(32)}`}, ${fixtureActorForeignRootFeedbackId},
								${fixtureUserId}, 'Preserve fixture-actor foreign-root comment'
							)
					`;
			});

			await clearFixtureRows(userSql, eventSql);
			const [userEvidence] = await userSql<
				{
					sentinelUsers: number;
					fixtureUsers: number;
					sentinelLinks: number;
					fixtureLinks: number;
					sentinelIdempotency: number;
					fixtureIdempotency: number;
				}[]
			>`
					SELECT
						(SELECT count(*)::int FROM users WHERE email = ${sentinelEmail}) AS "sentinelUsers",
						(SELECT count(*)::int FROM users WHERE email = ${fixtureEmail}) AS "fixtureUsers",
						(SELECT count(*)::int FROM user_magic_links WHERE email = ${sentinelEmail}) AS "sentinelLinks",
						(SELECT count(*)::int FROM user_magic_links WHERE email = ${fixtureEmail}) AS "fixtureLinks",
						(SELECT count(*)::int FROM user_idempotency_records WHERE scope = ${`user:${sentinelUserId}`}) AS "sentinelIdempotency",
						(SELECT count(*)::int FROM user_idempotency_records WHERE scope = ${`user:${fixtureUserId}`}) AS "fixtureIdempotency"
				`;
			const [eventEvidence] = await eventSql<
				{
					sentinelRoots: number;
					fixtureRoots: number;
					sentinelPlaces: number;
					fixturePlaces: number;
					sentinelIdempotency: number;
					fixtureIdempotency: number;
					sentinelRootlessFeedback: number;
					fixtureRootlessFeedback: number;
					fixtureRootFeedback: number;
					sentinelRootFeedback: number;
					fixtureActorForeignRootFeedback: number;
					sentinelRootlessDependents: number;
					fixtureRootlessDependents: number;
					fixtureRootDependents: number;
					sentinelRootDependents: number;
					fixtureActorForeignRootDependents: number;
				}[]
			>`
					SELECT
						(SELECT count(*)::int FROM event_roots WHERE root_event_id = ${sentinelRootId}) AS "sentinelRoots",
						(SELECT count(*)::int FROM event_roots WHERE root_event_id = ${fixtureRootId}) AS "fixtureRoots",
						(SELECT count(*)::int FROM event_places WHERE id = ${sentinelPlaceId}) AS "sentinelPlaces",
						(SELECT count(*)::int FROM event_places WHERE id = ${fixturePlaceId}) AS "fixturePlaces",
						(SELECT count(*)::int FROM event_idempotency_records WHERE actor_id = ${sentinelUserId}) AS "sentinelIdempotency",
						(SELECT count(*)::int FROM event_idempotency_records WHERE actor_id = ${fixtureUserId}) AS "fixtureIdempotency",
						(SELECT count(*)::int FROM event_feedback WHERE id = ${sentinelRootlessFeedbackId}) AS "sentinelRootlessFeedback",
						(SELECT count(*)::int FROM event_feedback WHERE id = ${fixtureRootlessFeedbackId}) AS "fixtureRootlessFeedback",
						(SELECT count(*)::int FROM event_feedback WHERE id = ${fixtureRootFeedbackId}) AS "fixtureRootFeedback",
						(SELECT count(*)::int FROM event_feedback WHERE id = ${sentinelRootFeedbackId}) AS "sentinelRootFeedback",
						(SELECT count(*)::int FROM event_feedback WHERE id = ${fixtureActorForeignRootFeedbackId}) AS "fixtureActorForeignRootFeedback",
						(
							(SELECT count(*)::int FROM event_feedback_status_history WHERE feedback_id = ${sentinelRootlessFeedbackId}) +
							(SELECT count(*)::int FROM event_feedback_votes WHERE feedback_id = ${sentinelRootlessFeedbackId}) +
							(SELECT count(*)::int FROM event_feedback_comments WHERE feedback_id = ${sentinelRootlessFeedbackId})
						) AS "sentinelRootlessDependents",
						(
							(SELECT count(*)::int FROM event_feedback_status_history WHERE feedback_id = ${fixtureRootlessFeedbackId}) +
							(SELECT count(*)::int FROM event_feedback_votes WHERE feedback_id = ${fixtureRootlessFeedbackId}) +
							(SELECT count(*)::int FROM event_feedback_comments WHERE feedback_id = ${fixtureRootlessFeedbackId})
						) AS "fixtureRootlessDependents",
						(
							(SELECT count(*)::int FROM event_feedback_status_history WHERE feedback_id = ${fixtureRootFeedbackId}) +
							(SELECT count(*)::int FROM event_feedback_votes WHERE feedback_id = ${fixtureRootFeedbackId}) +
							(SELECT count(*)::int FROM event_feedback_comments WHERE feedback_id = ${fixtureRootFeedbackId})
						) AS "fixtureRootDependents",
						(
							(SELECT count(*)::int FROM event_feedback_status_history WHERE feedback_id = ${sentinelRootFeedbackId}) +
							(SELECT count(*)::int FROM event_feedback_votes WHERE feedback_id = ${sentinelRootFeedbackId}) +
							(SELECT count(*)::int FROM event_feedback_comments WHERE feedback_id = ${sentinelRootFeedbackId})
						) AS "sentinelRootDependents",
						(
							(SELECT count(*)::int FROM event_feedback_status_history WHERE feedback_id = ${fixtureActorForeignRootFeedbackId}) +
							(SELECT count(*)::int FROM event_feedback_votes WHERE feedback_id = ${fixtureActorForeignRootFeedbackId}) +
							(SELECT count(*)::int FROM event_feedback_comments WHERE feedback_id = ${fixtureActorForeignRootFeedbackId})
						) AS "fixtureActorForeignRootDependents"
				`;
			expect(userEvidence).toEqual({
				sentinelUsers: 1,
				fixtureUsers: 0,
				sentinelLinks: 1,
				fixtureLinks: 0,
				sentinelIdempotency: 1,
				fixtureIdempotency: 0,
			});
			expect(eventEvidence).toEqual({
				sentinelRoots: 1,
				fixtureRoots: 0,
				sentinelPlaces: 1,
				fixturePlaces: 0,
				sentinelIdempotency: 1,
				fixtureIdempotency: 0,
				sentinelRootlessFeedback: 1,
				fixtureRootlessFeedback: 0,
				fixtureRootFeedback: 0,
				sentinelRootFeedback: 1,
				fixtureActorForeignRootFeedback: 1,
				sentinelRootlessDependents: 3,
				fixtureRootlessDependents: 0,
				fixtureRootDependents: 0,
				sentinelRootDependents: 3,
				fixtureActorForeignRootDependents: 3,
			});
		} finally {
			await clearFixtureRows(userSql, eventSql).catch(() => {});
			await userSql`
					DELETE FROM user_idempotency_records
					WHERE scope = ${`user:${sentinelUserId}`}
				`;
			await userSql`DELETE FROM user_magic_links WHERE email = ${sentinelEmail}`;
			await userSql`DELETE FROM users WHERE email = ${sentinelEmail}`;
			await eventSql.begin(async (transaction) => {
				const tx = transaction as unknown as Sql;
				await tx`
						DELETE FROM event_feedback_status_history
						WHERE feedback_id IN ${tx(cleanupFeedbackIds)}
					`;
				await tx`
						DELETE FROM event_feedback_votes
						WHERE feedback_id IN ${tx(cleanupFeedbackIds)}
					`;
				await tx`
						DELETE FROM event_feedback_comments
						WHERE feedback_id IN ${tx(cleanupFeedbackIds)}
					`;
				await tx`
						DELETE FROM event_feedback
						WHERE id IN ${tx(cleanupFeedbackIds)}
					`;
				await tx`
						DELETE FROM event_idempotency_records
						WHERE actor_id = ${sentinelUserId}
					`;
				await tx`DELETE FROM event_places WHERE root_event_id = ${sentinelRootId}`;
				await tx`DELETE FROM event_memberships WHERE root_event_id = ${sentinelRootId}`;
				await tx`DELETE FROM events WHERE root_event_id = ${sentinelRootId}`;
				await tx`DELETE FROM event_roots WHERE root_event_id = ${sentinelRootId}`;
			});
			await Promise.all([
				userSql.end({ timeout: 5 }),
				eventSql.end({ timeout: 5 }),
			]);
		}
	}, 30_000);
}
