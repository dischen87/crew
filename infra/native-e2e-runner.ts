import { createHash } from "node:crypto";
import { RedisClient } from "bun";
import { generateKeyPair } from "jose";
import postgres, { type Sql } from "postgres";
import { createApp as createGatewayApp } from "../services/api-gateway/src/app";
import { loadConfig as loadGatewayConfig } from "../services/api-gateway/src/config";
import { RedisRateLimiter } from "../services/api-gateway/src/redis-rate-limit";
import { migrate as migrateEvent } from "../services/event-service/scripts/migrate";
import { createApp as createEventApp } from "../services/event-service/src/app";
import { PostgresAttachmentJobRepository } from "../services/event-service/src/attachment-jobs";
import { createAttachmentWorker } from "../services/event-service/src/attachment-worker";
import { createJwtVerifier as createEventJwtVerifier } from "../services/event-service/src/auth";
import { EventNotificationPayloadCodec } from "../services/event-service/src/event-notification-payload";
import {
	BunS3PrivateObjectStore,
	UploadGrantCodec,
} from "../services/event-service/src/object-store";
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
import { RedisAuthRateLimiter } from "../services/user-service/src/rate-limit";
import {
	createEventNotificationServiceAuth,
	createMemberDirectoryServiceAuth,
} from "../services/user-service/src/service-auth";
import {
	bootstrapFixture,
	type FixtureResult,
	type FixtureScenario,
} from "./bootstrap-fixture";
import { createProviderSinkHandler } from "./provider-sink";

const PUBLIC_PORT = 3000;
const MAX_CONTROL_BODY_BYTES = 4_096;
const MAX_SYNC_BODY_BYTES = 1_048_576;
const MAX_ALLOWED_REQUEST_IDS = 64;
const MAX_TRACE_RECORDS = 256;
const SAFE_REQUEST_ID =
	/^(?:crew-e2e\.(?:ios|android)|fixture\.e2e\.(?:golf-tour|team-event)\.(?:ios|android)\.(?:bootstrap|push(?:\.replay)?|pull)\.v1)$/;
const SENSITIVE_IDENTIFIER =
	/(?:^|[.:-])(?:cin[_-]|crs[_-]|ml[_-]|rt[_-]|at[_-]|access[_-]|refresh[_-]|bearer[_-]|eyJ|gh[pousr][_-]|github[_-]?pat[_-]|sk[-_]|pk[-_]|api[_-]?key|token[_-]|secret[_-]|session[_-]|password[_-]|passwd[_-]|private[_-]|jwt[_-])/i;
const RESERVED_CONTROL_PORTS = new Set([
	PUBLIC_PORT,
	3001,
	3002,
	3010,
	5432,
	5433,
	6379,
	6380,
	8081,
	8082,
]);

const issuer = "crew-native-e2e-user-service";
const audience = "crew-native-e2e-mobile";
const deliveryPayloadKey = "eKOfuEuHFGQeOZltcgU4hlzp3jYpRNrp3xvjzwjJkSE";
const pushPayloadKey = "TxsYmFtlYMVPT1UZKmSGicjfoc8lhZ0kGQ3FgIZavhs";
const notificationPayloadKey = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const eventNotificationKey = "BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ";
const memberDirectoryKey = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI";
const gatewayRateLimitKey = "BAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg";
const userRateLimitKey = "DAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg";
const fixtureActors = {
	"golf-tour": {
		ownerEmail: "crew.local@example.test",
		participantEmail: "crew.golf.participant.local@example.test",
	},
	"team-event": {
		ownerEmail: "crew.team.local@example.test",
		participantEmail: "crew.team.participant.local@example.test",
	},
} as const;

const fixtureRootEventIds = [
	"evt_local_turkey_golf_2026",
	"evt_local_team_day_2026",
] as const;

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
] as const;

export const nativeE2EFixtureScope = Object.freeze({
	emails: Object.freeze([
		fixtureActors["golf-tour"].ownerEmail,
		"crew.golf.organizer.local@example.test",
		fixtureActors["golf-tour"].participantEmail,
		fixtureActors["team-event"].ownerEmail,
		fixtureActors["team-event"].participantEmail,
	]),
	rootEventIds: Object.freeze([...fixtureRootEventIds]),
	placeCandidateIds: Object.freeze(belekCourses.map(({ id }) => id)),
	idempotencyKeyPrefix: "fixture.",
	eventNotificationPayloadKeyId: "native-e2e-notification-1",
});

export type NativeE2ERunnerConfig = {
	userDatabaseUrl: string;
	eventDatabaseUrl: string;
	redisUrl: string;
	controlPort: number;
	controlBearer: string;
	fixtureBearer: string;
	deliveryBearer: string;
	attachments?: {
		publicEndpoint: string;
		localEndpoint: string;
		apiAccessKeyId: string;
		apiSecretAccessKey: string;
		workerAccessKeyId: string;
		workerSecretAccessKey: string;
		grantKey: string;
	};
};

export type NativeE2ETrace = {
	sequence: number;
	requestId: string | null;
	requestFingerprint: string;
	operation: "feedback-create" | "sync-push";
	bodyFingerprint: string;
	feedbackFingerprint: string | null;
	idempotencyFingerprint: string | null;
	replayed: boolean;
	outcome: "forwarded" | "success-suppressed" | "transport-detached";
	downstreamStatus: number | null;
	facadeStatus: number;
};

type SetupSummary = {
	scenario: FixtureScenario;
	rootEventId: string;
	owner: { email: string; userId: string };
	participant: { email: string; userId: string };
};

type ControlPlaneOptions = {
	controlBearer: string;
	fixtureBearer: string;
	providerConsume: (request: Request) => Promise<Response>;
	setup: (scenario: FixtureScenario) => Promise<SetupSummary>;
	gatewayFetch: (request: Request) => Promise<Response>;
};

type SetupState =
	| { status: "idle" }
	| { status: "running"; scenario: FixtureScenario }
	| { status: "ready"; value: SetupSummary }
	| { status: "failed"; scenario: FixtureScenario };

export type NativeE2EControlPlane = {
	publicFetch(request: Request): Promise<Response>;
	controlFetch(request: Request): Promise<Response>;
	detach(): void;
	traces(): readonly NativeE2ETrace[];
};

export type NativeE2ERunner = {
	publicUrl: "http://127.0.0.1:3000";
	controlUrl: string;
	/** Clears runner-owned fixture rows and Redis keys; caller owns the databases. */
	stop(): Promise<void>;
};

export function createSharedStop(cleanup: () => Promise<void>) {
	let promise: Promise<void> | undefined;
	return () => (promise ??= cleanup());
}

type RedisCommandClient = Pick<RedisClient, "send">;
type RunnerServer = Pick<ReturnType<typeof Bun.serve>, "stop">;

export async function claimRunnerRedis(redis: RedisCommandClient) {
	const size = Number(await redis.send("DBSIZE", []));
	if (size !== 0) {
		throw new Error("Native E2E Redis database must be empty at startup");
	}
	return true as const;
}

export async function cleanupRunnerRedis(
	redis: RedisCommandClient,
	owned: boolean,
) {
	if (owned) await removeRunnerRedisKeys(redis);
}

export function stopRunnerServers(
	servers: readonly (RunnerServer | undefined)[],
) {
	return Promise.allSettled(
		servers.flatMap((server) =>
			server ? [Promise.resolve().then(() => server.stop(true))] : [],
		),
	);
}

export function assertNativeE2ERunnerConfig(config: NativeE2ERunnerConfig) {
	assertTestDatabaseUrl(config.userDatabaseUrl, "user");
	assertTestDatabaseUrl(config.eventDatabaseUrl, "event");
	assertIsolatedRedisUrl(config.redisUrl);
	if (
		!Number.isInteger(config.controlPort) ||
		config.controlPort < 1_024 ||
		config.controlPort > 65_535 ||
		RESERVED_CONTROL_PORTS.has(config.controlPort)
	) {
		throw new Error("Native E2E control port is invalid or reserved");
	}
	const bearers = [
		config.controlBearer,
		config.fixtureBearer,
		config.deliveryBearer,
	];
	if (
		bearers.some((value) => value.length < 32) ||
		new Set(bearers).size !== 3
	) {
		throw new Error(
			"Native E2E bearers must be distinct and at least 32 bytes",
		);
	}
	if (config.attachments) {
		const publicEndpoint = new URL(config.attachments.publicEndpoint);
		const localEndpoint = new URL(config.attachments.localEndpoint);
		if (
			publicEndpoint.protocol !== "https:" ||
			publicEndpoint.username !== "" ||
			publicEndpoint.password !== "" ||
			publicEndpoint.pathname !== "/" ||
			publicEndpoint.search !== "" ||
			publicEndpoint.hash !== "" ||
			localEndpoint.protocol !== "http:" ||
			!["127.0.0.1", "localhost", "::1"].includes(localEndpoint.hostname) ||
			localEndpoint.username !== "" ||
			localEndpoint.password !== "" ||
			localEndpoint.pathname !== "/" ||
			localEndpoint.search !== "" ||
			localEndpoint.hash !== "" ||
			config.attachments.apiAccessKeyId.length < 3 ||
			config.attachments.apiSecretAccessKey.length < 16 ||
			config.attachments.workerAccessKeyId.length < 3 ||
			config.attachments.workerSecretAccessKey.length < 16 ||
			config.attachments.grantKey.length < 32 ||
			config.attachments.apiAccessKeyId === config.attachments.workerAccessKeyId
		) {
			throw new Error("Native E2E attachment configuration is unsafe");
		}
	}
	return config;
}

export function createNativeE2EControlPlane(
	options: ControlPlaneOptions,
): NativeE2EControlPlane {
	let attached = true;
	let fault: {
		operation: NativeE2ETrace["operation"];
		requestId: string;
	} | null = null;
	let setupState: SetupState = { status: "idle" };
	let traceSequence = 0;
	const allowedRequestIds = new Set<string>();
	const traceRecords: NativeE2ETrace[] = [];

	const recordTrace = (trace: Omit<NativeE2ETrace, "sequence">) => {
		traceRecords.push({ sequence: ++traceSequence, ...trace });
		if (traceRecords.length > MAX_TRACE_RECORDS) traceRecords.shift();
	};

	const publicFetch = async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		if (
			url.pathname !== "/internal/live" &&
			url.pathname !== "/internal/ready" &&
			!url.pathname.startsWith("/core/v1/")
		) {
			return noStoreJson({ error: "not_found" }, 404);
		}
		if (request.method === "GET" && url.pathname === "/internal/live") {
			return noStoreJson({ service: "native-e2e-facade", status: "ok" });
		}
		if (request.method === "GET" && url.pathname === "/internal/ready") {
			return attached
				? noStoreJson({ service: "native-e2e-facade", status: "ready" })
				: retryableResponse(requestId(request), "Transport is detached.");
		}

		const id = requestId(request);
		const operation = traceOperation(request, url);
		const traceable =
			operation !== null && id !== null && allowedRequestIds.has(id);
		let bodyFingerprint: string | null = null;
		let feedbackFingerprint: string | null = null;
		let idempotencyFingerprint: string | null = null;
		if (traceable) {
			const fingerprints = await requestFingerprints(request, operation);
			if (!fingerprints) {
				return errorResponse(id, 413, "PAYLOAD_TOO_LARGE", false);
			}
			({ bodyFingerprint, feedbackFingerprint } = fingerprints);
			const key = request.headers.get("idempotency-key");
			idempotencyFingerprint = key ? fingerprint(key) : null;
		}

		if (!attached) {
			if (traceable && bodyFingerprint) {
				recordTrace({
					requestId: operation === "sync-push" ? id : null,
					requestFingerprint: fingerprint(id),
					operation,
					bodyFingerprint,
					feedbackFingerprint,
					idempotencyFingerprint,
					replayed: false,
					outcome: "transport-detached",
					downstreamStatus: null,
					facadeStatus: 503,
				});
			}
			return retryableResponse(id, "Transport is detached.");
		}

		let response: Response;
		try {
			response = await options.gatewayFetch(request);
		} catch {
			return retryableResponse(id, "Gateway transport failed.");
		}
		const replayed = response.headers.get("idempotency-replayed") === "true";
		const suppressCommittedSuccess =
			traceable &&
			bodyFingerprint &&
			fault?.requestId === id &&
			fault.operation === operation &&
			response.headers.get("x-request-id") === id &&
			response.status >= 200 &&
			response.status < 300;
		if (suppressCommittedSuccess) {
			// Claim the one-shot fault before consuming a potentially streaming body.
			fault = null;
			await response.arrayBuffer();
			recordTrace({
				requestId: operation === "sync-push" ? id : null,
				requestFingerprint: fingerprint(id),
				operation,
				bodyFingerprint,
				feedbackFingerprint,
				idempotencyFingerprint,
				replayed,
				outcome: "success-suppressed",
				downstreamStatus: response.status,
				facadeStatus: 503,
			});
			return retryableResponse(
				id,
				"Committed response intentionally suppressed.",
			);
		}
		if (traceable && bodyFingerprint) {
			recordTrace({
				requestId: operation === "sync-push" ? id : null,
				requestFingerprint: fingerprint(id),
				operation,
				bodyFingerprint,
				feedbackFingerprint,
				idempotencyFingerprint,
				replayed,
				outcome: "forwarded",
				downstreamStatus: response.status,
				facadeStatus: response.status,
			});
		}
		return response;
	};

	const controlFetch = async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		if (request.method === "GET" && url.pathname === "/internal/live") {
			return noStoreJson({ service: "native-e2e-control", status: "ok" });
		}
		if (
			request.method === "POST" &&
			url.pathname === "/internal/magic-links/consume"
		) {
			if (
				request.headers.get("authorization") !==
				`Bearer ${options.fixtureBearer}`
			) {
				return noStoreJson({ error: "unauthorized" }, 401);
			}
			return options.providerConsume(request);
		}
		if (
			request.headers.get("authorization") !== `Bearer ${options.controlBearer}`
		) {
			return noStoreJson({ error: "unauthorized" }, 401);
		}
		if (request.method === "GET" && url.pathname === "/v1/status") {
			return noStoreJson({
				transport: attached ? "attached" : "detached",
				fault: fault ? "armed" : "idle",
				setup: setupState.status,
				traceCount: traceRecords.length,
			});
		}
		if (request.method === "GET" && url.pathname === "/v1/traces") {
			return noStoreJson({ traces: traceRecords });
		}
		if (request.method === "DELETE" && url.pathname === "/v1/traces") {
			traceRecords.length = 0;
			allowedRequestIds.clear();
			fault = null;
			return new Response(null, { status: 204 });
		}
		if (request.method === "POST" && url.pathname === "/v1/transport/detach") {
			const invalidBody = await requireEmptyControlBody(request);
			if (invalidBody) return invalidBody;
			attached = false;
			return noStoreJson({ transport: "detached" });
		}
		if (request.method === "POST" && url.pathname === "/v1/transport/attach") {
			const invalidBody = await requireEmptyControlBody(request);
			if (invalidBody) return invalidBody;
			attached = true;
			return noStoreJson({ transport: "attached" });
		}
		if (request.method === "POST" && url.pathname === "/v1/traces/allow") {
			const body = await readControlJson(request);
			if (body instanceof Response) return body;
			const ids = body.requestIds;
			if (
				Object.keys(body).join(",") !== "requestIds" ||
				!Array.isArray(ids) ||
				ids.length < 1 ||
				ids.length > 16 ||
				ids.some((value) => !safeRequestId(value)) ||
				new Set([...allowedRequestIds, ...(ids as string[])]).size >
					MAX_ALLOWED_REQUEST_IDS
			) {
				return noStoreJson({ error: "invalid_request" }, 400);
			}
			for (const id of ids as string[]) allowedRequestIds.add(id);
			return noStoreJson({ allowed: allowedRequestIds.size });
		}
		const faultOperation =
			url.pathname === "/v1/faults/sync-push-once"
				? "sync-push"
				: url.pathname === "/v1/faults/feedback-create-once"
					? "feedback-create"
					: null;
		if (request.method === "POST" && faultOperation) {
			if (fault) return noStoreJson({ error: "fault_already_armed" }, 409);
			const body = await readControlJson(request);
			if (body instanceof Response) return body;
			if (
				Object.keys(body).join(",") !== "requestId" ||
				!safeRequestId(body.requestId)
			) {
				return noStoreJson({ error: "invalid_request" }, 400);
			}
			if (!allowedRequestIds.has(body.requestId)) {
				return noStoreJson({ error: "request_id_not_allowlisted" }, 409);
			}
			if (fault) return noStoreJson({ error: "fault_already_armed" }, 409);
			fault = {
				operation: faultOperation,
				requestId: body.requestId as string,
			};
			return noStoreJson({ fault: "armed" }, 201);
		}
		if (request.method === "POST" && url.pathname === "/v1/setup") {
			if (!attached || setupState.status !== "idle") {
				return noStoreJson({ error: "setup_not_available" }, 409);
			}
			const body = await readControlJson(request);
			if (body instanceof Response) return body;
			if (
				Object.keys(body).join(",") !== "scenario" ||
				(body.scenario !== "golf-tour" && body.scenario !== "team-event")
			) {
				return noStoreJson({ error: "invalid_request" }, 400);
			}
			const scenario = body.scenario;
			if (!attached || setupState.status !== "idle") {
				return noStoreJson({ error: "setup_not_available" }, 409);
			}
			setupState = { status: "running", scenario };
			try {
				const value = await options.setup(scenario);
				setupState = { status: "ready", value };
				return noStoreJson(value, 201);
			} catch {
				setupState = { status: "failed", scenario };
				return noStoreJson({ error: "setup_failed" }, 500);
			}
		}
		return noStoreJson({ error: "not_found" }, 404);
	};

	return {
		publicFetch,
		controlFetch,
		detach() {
			attached = false;
		},
		traces: () => traceRecords.map((trace) => ({ ...trace })),
	};
}

export async function startNativeE2ERunner(
	unsafeConfig: NativeE2ERunnerConfig,
): Promise<NativeE2ERunner> {
	const config = assertNativeE2ERunnerConfig(unsafeConfig);
	let userSql: Sql | undefined;
	let eventSql: Sql | undefined;
	let userRedis: RedisClient | undefined;
	let gatewayRedis: RedisClient | undefined;
	let userServer: ReturnType<typeof Bun.serve> | undefined;
	let eventServer: ReturnType<typeof Bun.serve> | undefined;
	let publicServer: ReturnType<typeof Bun.serve> | undefined;
	let controlServer: ReturnType<typeof Bun.serve> | undefined;
	let attachmentWorkerController: AbortController | undefined;
	let attachmentWorkerRun: Promise<void> | undefined;
	let fixtureSchemaReady = false;
	let redisOwned = false;
	let publicHandler = async (request: Request) =>
		retryableResponse(requestId(request), "Runner is starting.");
	let controlHandler = async (_request: Request) =>
		noStoreJson({ error: "runner_starting" }, 503);

	const stop = createSharedStop(async () => {
		const cleanupErrors: unknown[] = [];
		attachmentWorkerController?.abort();
		if (attachmentWorkerRun) {
			try {
				await attachmentWorkerRun;
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		const serverStops = await stopRunnerServers([
			publicServer,
			controlServer,
			userServer,
			eventServer,
		]);
		for (const result of serverStops) {
			if (result.status === "rejected") cleanupErrors.push(result.reason);
		}
		if (fixtureSchemaReady && userSql && eventSql) {
			try {
				await clearFixtureRows(userSql, eventSql);
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		if (gatewayRedis) {
			try {
				await cleanupRunnerRedis(gatewayRedis, redisOwned);
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		gatewayRedis?.close();
		userRedis?.close();
		const closes = await Promise.allSettled([
			userSql?.end({ timeout: 5 }),
			eventSql?.end({ timeout: 5 }),
		]);
		for (const result of closes) {
			if (result.status === "rejected") cleanupErrors.push(result.reason);
		}
		if (cleanupErrors.length) {
			throw new AggregateError(cleanupErrors, "Native E2E cleanup failed");
		}
	});

	try {
		publicServer = Bun.serve({
			hostname: "127.0.0.1",
			port: PUBLIC_PORT,
			fetch: (request) => publicHandler(request),
		});
		controlServer = Bun.serve({
			hostname: "127.0.0.1",
			port: config.controlPort,
			fetch: (request) => controlHandler(request),
		});
		userSql = postgres(config.userDatabaseUrl, { max: 8, onnotice: () => {} });
		eventSql = postgres(config.eventDatabaseUrl, {
			max: 12,
			onnotice: () => {},
		});
		userRedis = new RedisClient(config.redisUrl, {
			connectionTimeout: 1_000,
			enableOfflineQueue: false,
			maxRetries: 1,
		});
		gatewayRedis = new RedisClient(config.redisUrl, {
			connectionTimeout: 1_000,
			enableOfflineQueue: false,
			maxRetries: 1,
		});
		await Promise.all([userRedis.connect(), gatewayRedis.connect()]);
		redisOwned = await claimRunnerRedis(gatewayRedis);
		await migrateUser(userSql);
		await migrateEvent(eventSql);
		fixtureSchemaReady = true;
		await clearFixtureRows(userSql, eventSql);

		const rsa = await generateKeyPair("RS256", { modulusLength: 2048 });
		const tokens = await createTokenService(rsa.privateKey, rsa.publicKey, {
			issuer,
			audience,
			keyId: "native-e2e-rsa-1",
			accessTokenTtlSeconds: 3_600,
		});
		const deliveryPayloads = createDeliveryPayloadKeyring({
			current: { id: "native-e2e-delivery-1", key: deliveryPayloadKey },
		});
		const userApp = createUserApp(
			{
				repository: new PostgresUserRepository(userSql),
				tokens,
				deliveryPayloads,
				pushPayloads: createPushPayloadKeyring({
					current: { id: "native-e2e-push-1", key: pushPayloadKey },
				}),
				eventNotificationServiceVerifier: createEventNotificationServiceAuth({
					issuer: "crew-native-e2e-event-service",
					audience: "crew-native-e2e-user-service",
					current: {
						id: "native-e2e-event-service-1",
						key: eventNotificationKey,
					},
				}),
				memberDirectoryServiceVerifier: createMemberDirectoryServiceAuth({
					issuer: "crew-native-e2e-gateway",
					audience: "crew-native-e2e-user-service",
					current: {
						id: "native-e2e-member-directory-1",
						key: memberDirectoryKey,
					},
				}),
				authRateLimiter: new RedisAuthRateLimiter(
					userRedis,
					{
						magicRequest: { windowMs: 60_000 },
						magicRedeem: { windowMs: 60_000 },
						refresh: { windowMs: 60_000 },
					},
					1_000,
					userRateLimitKey,
					1_000,
				),
				clientKey: () => "127.0.0.1",
				magicLinkTtlSeconds: 600,
				refreshTokenTtlSeconds: 3_600,
				refreshTokenKey: "native-e2e-refresh-token-key-2026",
				idempotencyPayloadKeys: {
					current: {
						id: "native-e2e-idempotency-1",
						key: "native-e2e-idempotency-payload-key-2026",
					},
				},
			},
			async () => {
				try {
					await Promise.all([
						userSql?.unsafe("SELECT 1"),
						userRedis?.send("PING", []),
					]);
					return true;
				} catch {
					return false;
				}
			},
		);
		userServer = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: (request) => userApp.fetch(request),
		});
		const userUrl = `http://127.0.0.1:${userServer.port}`;
		const jwksUrl = `${userUrl}/.well-known/jwks.json`;

		const apiObjectStore = config.attachments
			? new BunS3PrivateObjectStore({
					endpoint: config.attachments.publicEndpoint,
					region: "us-east-1",
					bucket: "crew-event-development",
					accessKeyId: config.attachments.apiAccessKeyId,
					secretAccessKey: config.attachments.apiSecretAccessKey,
				})
			: undefined;
		if (config.attachments) {
			const worker = createAttachmentWorker(
				{
					workerId: "native-e2e-attachment-worker",
					pollIntervalMs: 100,
					verifyLeaseSeconds: 10,
					verifyMaxAttempts: 3,
					verifyConcurrency: 1,
					cleanupLeaseSeconds: 10,
					cleanupRetentionSeconds: 3600,
					objectIoTimeoutMs: 5_000,
				},
				new PostgresAttachmentJobRepository(eventSql),
				new BunS3PrivateObjectStore(
					{
						endpoint: config.attachments.localEndpoint,
						region: "us-east-1",
						bucket: "crew-event-development",
						accessKeyId: config.attachments.workerAccessKeyId,
						secretAccessKey: config.attachments.workerSecretAccessKey,
					},
					1,
				),
			);
			attachmentWorkerController = new AbortController();
			attachmentWorkerRun = worker.run(attachmentWorkerController.signal);
		}
		const eventApp = createEventApp({
			service: new EventService(
				new PostgresEventRepository(
					eventSql,
					new EventNotificationPayloadCodec({
						kid: nativeE2EFixtureScope.eventNotificationPayloadKeyId,
						key: notificationPayloadKey,
					}),
				),
				"native-e2e-invitation-key-with-at-least-32-characters",
				apiObjectStore && config.attachments
					? {
							objectStore: apiObjectStore,
							grantCodec: new UploadGrantCodec(
								"native-e2e-attachment-v1",
								config.attachments.grantKey,
							),
							uploadTtlSeconds: 600,
							downloadTtlSeconds: 600,
						}
					: undefined,
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
						const match =
							belekCourses[aliases.findIndex((alias) => query.includes(alias))];
						return { items: match ? [match] : [], found: match ? 1 : 0 };
					},
				},
				"native-e2e-place-search-cursor-key-2026",
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
		const gateway = createGatewayApp({
			rateLimiter: new RedisRateLimiter(
				gatewayRedis,
				1_000,
				60_000,
				1_000,
				gatewayRateLimitKey,
				1_000,
			),
			config: loadGatewayConfig({
				NODE_ENV: "test",
				HOST: "127.0.0.1",
				PORT: String(PUBLIC_PORT),
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
				RATE_LIMIT_REDIS_URL: config.redisUrl,
				RATE_LIMIT_KEY: gatewayRateLimitKey,
				MEMBER_DIRECTORY_SERVICE_ISSUER: "crew-native-e2e-gateway",
				MEMBER_DIRECTORY_SERVICE_AUDIENCE: "crew-native-e2e-user-service",
				MEMBER_DIRECTORY_SERVICE_CURRENT_KEY_ID:
					"native-e2e-member-directory-1",
				MEMBER_DIRECTORY_SERVICE_CURRENT_KEY: memberDirectoryKey,
			}),
			clientIp: () => "127.0.0.1",
			fetch,
			readiness: async () => {
				try {
					return (await gatewayRedis?.send("PING", [])) === "PONG";
				} catch {
					return false;
				}
			},
		});

		const provider = createProviderSinkHandler({
			deliveryBearer: config.deliveryBearer,
			fixtureBearer: config.fixtureBearer,
			log: () => {},
		});
		const providerFetch = Object.assign(
			(input: string | URL | Request, init?: RequestInit) =>
				provider(new Request(input, init)),
			{ preconnect: fetch.preconnect },
		);
		const deliveryWorker = new MagicLinkDeliveryWorker({
			repository: new PostgresDeliveryOutboxRepository(userSql),
			payloads: deliveryPayloads,
			sendMagicLink: createWebhookMagicLinkSender({
				endpoint: "http://provider-sink:3010/magic-links",
				bearer: config.deliveryBearer,
				appUrl: "http://crew.local/auth/redeem",
				timeoutMs: 2_000,
				fetch: providerFetch,
			}),
			workerId: "native-e2e-delivery-worker",
			batchSize: 10,
			leaseMs: 5_000,
			deliveryTimeoutMs: 2_000,
			maxAttempts: 3,
			baseBackoffMs: 100,
			maxBackoffMs: 1_000,
		});

		const controlPlane = createNativeE2EControlPlane({
			controlBearer: config.controlBearer,
			fixtureBearer: config.fixtureBearer,
			gatewayFetch: async (request) => gateway.fetch(request),
			providerConsume: async (request) => {
				await deliveryWorker.runOnce();
				return provider(request);
			},
			setup: async (scenario) =>
				setupSummary(
					scenario,
					await bootstrapFixture(
						{
							gatewayUrl: `http://127.0.0.1:${PUBLIC_PORT}/core/v1/`,
							providerSinkUrl: `http://127.0.0.1:${config.controlPort}/`,
							providerSinkFixtureBearer: config.fixtureBearer,
							localFixtureEnabled: true,
							offlineFlowPlatform: null,
							scenario,
						},
						{ sleep: async () => {} },
					),
				),
		});
		publicHandler = controlPlane.publicFetch;
		controlHandler = controlPlane.controlFetch;

		return {
			publicUrl: "http://127.0.0.1:3000",
			controlUrl: `http://127.0.0.1:${config.controlPort}`,
			stop,
		};
	} catch (error) {
		try {
			await stop();
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				"Native E2E startup and cleanup failed",
			);
		}
		throw error;
	}
}

function setupSummary(
	scenario: FixtureScenario,
	result: FixtureResult,
): SetupSummary {
	if (!result.participantUserId) {
		throw new Error("Setup-only fixture did not create a participant");
	}
	return {
		scenario,
		rootEventId: result.rootEventId,
		owner: { email: fixtureActors[scenario].ownerEmail, userId: result.userId },
		participant: {
			email: fixtureActors[scenario].participantEmail,
			userId: result.participantUserId,
		},
	};
}

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

function assertTestDatabaseUrl(value: string, service: "user" | "event") {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`Invalid native E2E ${service} database URL`);
	}
	if (
		(url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
		!["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
		!new RegExp(`^/crew_native_e2e_${service}_test(?:_[a-z0-9_]+)?$`).test(
			url.pathname,
		) ||
		url.search !== "" ||
		url.hash !== ""
	) {
		throw new Error(
			`Native E2E ${service} database must be an explicit loopback test database`,
		);
	}
}

function assertIsolatedRedisUrl(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Invalid native E2E Redis URL");
	}
	const database = Number(url.pathname.slice(1));
	if (
		url.protocol !== "redis:" ||
		!["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
		url.port !== "6380" ||
		!Number.isInteger(database) ||
		database < 1 ||
		database > 15 ||
		url.search !== "" ||
		url.hash !== ""
	) {
		throw new Error(
			"Native E2E Redis must be loopback port 6380 with a non-zero database",
		);
	}
}

function requestId(request: Request) {
	const value = request.headers.get("x-request-id");
	return safeRequestId(value) ? value : null;
}

function safeRequestId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		SAFE_REQUEST_ID.test(value) &&
		!SENSITIVE_IDENTIFIER.test(value)
	);
}

function fingerprint(value: string | Uint8Array) {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function traceOperation(
	request: Request,
	url: URL,
): NativeE2ETrace["operation"] | null {
	if (request.method !== "POST") return null;
	if (url.pathname === "/core/v1/sync/push") return "sync-push";
	if (url.pathname === "/core/v1/feedback") return "feedback-create";
	return null;
}

async function requestFingerprints(
	request: Request,
	operation: NativeE2ETrace["operation"],
) {
	const body = await boundedRequestBody(request);
	if (!body) return null;
	let feedbackFingerprint: string | null = null;
	if (operation === "feedback-create") {
		try {
			const value: unknown = JSON.parse(new TextDecoder().decode(body));
			const feedbackId =
				value && typeof value === "object" && !Array.isArray(value)
					? (value as Record<string, unknown>).id
					: null;
			if (
				typeof feedbackId === "string" &&
				/^fbk_[A-Za-z0-9._:-]{1,96}$/.test(feedbackId)
			) {
				feedbackFingerprint = fingerprint(feedbackId);
			}
		} catch {
			// The downstream service owns request validation; traces stay sanitized.
		}
	}
	return { bodyFingerprint: fingerprint(body), feedbackFingerprint };
}

async function boundedRequestBody(request: Request) {
	if (!request.body) return new Uint8Array();
	const declared = request.headers.get("content-length");
	if (
		declared &&
		/^\d+$/.test(declared) &&
		Number(declared) > MAX_SYNC_BODY_BYTES
	) {
		return null;
	}
	const reader = request.clone().body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				const body = new Uint8Array(size);
				let offset = 0;
				for (const chunk of chunks) {
					body.set(chunk, offset);
					offset += chunk.byteLength;
				}
				return body;
			}
			size += value.byteLength;
			if (size > MAX_SYNC_BODY_BYTES) {
				await reader.cancel();
				return null;
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
}

async function readControlJson(request: Request) {
	const text = await readControlBody(request);
	if (text instanceof Response) return text;
	if (text.length === 0) return noStoreJson({ error: "invalid_json" }, 400);
	try {
		const value: unknown = JSON.parse(text);
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: noStoreJson({ error: "invalid_json" }, 400);
	} catch {
		return noStoreJson({ error: "invalid_json" }, 400);
	}
}

async function requireEmptyControlBody(request: Request) {
	const body = await readControlBody(request);
	if (body instanceof Response) return body;
	return body.length === 0
		? undefined
		: noStoreJson({ error: "body_must_be_empty" }, 400);
}

async function readControlBody(request: Request) {
	const declared = request.headers.get("content-length");
	if (
		declared &&
		/^\d+$/.test(declared) &&
		Number(declared) > MAX_CONTROL_BODY_BYTES
	) {
		return noStoreJson({ error: "payload_too_large" }, 413);
	}
	if (!request.body) return "";
	const reader = request.body.getReader();
	const decoder = new TextDecoder();
	let bytes = 0;
	let text = "";
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > MAX_CONTROL_BODY_BYTES) {
				await reader.cancel();
				return noStoreJson({ error: "payload_too_large" }, 413);
			}
			text += decoder.decode(value, { stream: true });
		}
		text += decoder.decode();
	} finally {
		reader.releaseLock();
	}
	return text;
}

function retryableResponse(id: string | null, message: string) {
	return errorResponse(id, 503, "SERVICE_UNAVAILABLE", true, message);
}

function errorResponse(
	id: string | null,
	status: number,
	code: string,
	retryable: boolean,
	message = "The request could not be processed.",
) {
	const requestId = id ?? crypto.randomUUID();
	return noStoreJson(
		{ error: { code, message, requestId, retryable } },
		status,
		{
			"X-Request-ID": requestId,
			...(retryable ? { "Retry-After": "1" } : {}),
		},
	);
}

function noStoreJson(
	value: unknown,
	status = 200,
	headers: Record<string, string> = {},
) {
	return Response.json(value, {
		status,
		headers: { "Cache-Control": "no-store", ...headers },
	});
}

export async function clearFixtureRows(userSql: Sql, eventSql: Sql) {
	await Promise.all([
		clearUserFixtureRows(userSql),
		clearEventFixtureRows(eventSql),
	]);
}

async function clearUserFixtureRows(sql: Sql) {
	const emails = [...nativeE2EFixtureScope.emails];
	const idempotencyPrefix = `${nativeE2EFixtureScope.idempotencyKeyPrefix}%`;
	await sql.begin(async (transaction) => {
		const tx = transaction as unknown as Sql;
		await tx`
			DELETE FROM user_idempotency_records
			WHERE idempotency_key LIKE ${idempotencyPrefix}
				OR scope IN (
					SELECT 'user:' || id FROM users WHERE email IN ${tx(emails)}
				)
				OR (
					scope = 'service:event-notifications'
					AND idempotency_key IN (
						SELECT event_job_id FROM user_push_outbox
						WHERE recipient_user_id IN (
							SELECT id FROM users WHERE email IN ${tx(emails)}
						)
					)
				)
		`;
		await tx`
			DELETE FROM user_push_outbox
			WHERE recipient_user_id IN (
				SELECT id FROM users WHERE email IN ${tx(emails)}
			)
		`;
		await tx`DELETE FROM user_magic_links WHERE email IN ${tx(emails)}`;
		await tx`DELETE FROM users WHERE email IN ${tx(emails)}`;
	});
}

async function clearEventFixtureRows(sql: Sql) {
	const rootIds = [...nativeE2EFixtureScope.rootEventIds];
	const candidateIds = [...nativeE2EFixtureScope.placeCandidateIds];
	const idempotencyPrefix = `${nativeE2EFixtureScope.idempotencyKeyPrefix}%`;
	await sql.begin(async (transaction) => {
		const tx = transaction as unknown as Sql;
		await tx`
			DELETE FROM event_idempotency_records
			WHERE idempotency_key LIKE ${idempotencyPrefix}
				OR actor_id IN (
					SELECT user_id FROM event_memberships
					WHERE root_event_id IN ${tx(rootIds)}
				)
		`;
		await tx`
			DELETE FROM event_notification_outbox
			WHERE payload_kid = ${nativeE2EFixtureScope.eventNotificationPayloadKeyId}
		`;

		await tx`
			DELETE FROM event_feedback_follows
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_feedback_attachments
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_feedback_status_history
			WHERE feedback_id IN (
				SELECT id FROM event_feedback
				WHERE root_event_id IN ${tx(rootIds)}
					OR (
						root_event_id IS NULL
						AND author_user_id IN (
							SELECT user_id FROM event_memberships
							WHERE root_event_id IN ${tx(rootIds)}
						)
					)
			)
		`;
		await tx`
			DELETE FROM event_feedback_votes
			WHERE feedback_id IN (
				SELECT id FROM event_feedback
				WHERE root_event_id IN ${tx(rootIds)}
					OR (
						root_event_id IS NULL
						AND author_user_id IN (
							SELECT user_id FROM event_memberships
							WHERE root_event_id IN ${tx(rootIds)}
						)
					)
			)
		`;
		await tx`
			DELETE FROM event_feedback_comments
			WHERE feedback_id IN (
				SELECT id FROM event_feedback
				WHERE root_event_id IN ${tx(rootIds)}
					OR (
						root_event_id IS NULL
						AND author_user_id IN (
							SELECT user_id FROM event_memberships
							WHERE root_event_id IN ${tx(rootIds)}
						)
					)
			)
		`;
		await tx`
			DELETE FROM event_feedback
			WHERE root_event_id IN ${tx(rootIds)}
				OR (
					root_event_id IS NULL
					AND author_user_id IN (
						SELECT user_id FROM event_memberships
						WHERE root_event_id IN ${tx(rootIds)}
					)
				)
		`;

		await tx`
			DELETE FROM event_team_decision_responses
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_team_decision_options
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_team_decisions
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_team_members
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_team_teams
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_team_assignment_sets
			WHERE root_event_id IN ${tx(rootIds)}
		`;

		await tx`
			DELETE FROM event_golf_scores
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_golf_round_team_members
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_golf_round_teams
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_golf_round_players
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_golf_round_holes
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_golf_rounds
			WHERE root_event_id IN ${tx(rootIds)}
		`;

		await tx`
			DELETE FROM event_sync_mutation_receipts
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_sync_streams
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_sync_snapshots
			WHERE root_event_id IN ${tx(rootIds)}
		`;

		await tx`
			DELETE FROM event_attachments WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_attachment_uploads
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_feed_reactions
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_feed_entry_current
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_feed_entry_revisions
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_feed_entries WHERE root_event_id IN ${tx(rootIds)}
		`;

		await tx`
			DELETE FROM event_invitation_redemptions
			WHERE invitation_id IN (
				SELECT id FROM event_invitations WHERE root_event_id IN ${tx(rootIds)}
			)
		`;
		await tx`
			DELETE FROM event_invitations WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_itinerary_items
			WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_capabilities WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_root_changes WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`
			DELETE FROM event_memberships WHERE root_event_id IN ${tx(rootIds)}
		`;
		await tx`DELETE FROM events WHERE root_event_id IN ${tx(rootIds)}`;
		await tx`DELETE FROM event_places WHERE root_event_id IN ${tx(rootIds)}`;
		await tx`
			DELETE FROM event_roots WHERE root_event_id IN ${tx(rootIds)}
		`;

		await tx`
			DELETE FROM global_places WHERE candidate_id IN ${tx(candidateIds)}
		`;
		await tx`
			DELETE FROM place_enrichment_jobs
			WHERE candidate_id IN ${tx(candidateIds)}
		`;
		await tx`DELETE FROM place_candidates WHERE id IN ${tx(candidateIds)}`;
	});
}

async function removeRunnerRedisKeys(redis: RedisCommandClient) {
	for (const pattern of ["crew:gateway:rate:v1:*", "crew:user:rate:v1:*"]) {
		let cursor = "0";
		do {
			const reply = await redis.send("SCAN", [
				cursor,
				"MATCH",
				pattern,
				"COUNT",
				"100",
			]);
			if (
				!Array.isArray(reply) ||
				reply.length !== 2 ||
				!Array.isArray(reply[1])
			) {
				throw new Error("Invalid Redis SCAN response");
			}
			cursor = String(reply[0]);
			const keys = reply[1].map(String);
			if (keys.length) await redis.send("DEL", keys);
		} while (cursor !== "0");
	}
}

if (import.meta.main) {
	const required = (name: string) => {
		const value = Bun.env[name];
		if (!value) throw new Error(`${name} is required`);
		return value;
	};
	const attachmentNames = [
		"NATIVE_E2E_ATTACHMENT_PUBLIC_ENDPOINT",
		"NATIVE_E2E_ATTACHMENT_LOCAL_ENDPOINT",
		"NATIVE_E2E_ATTACHMENT_API_ACCESS_KEY_ID",
		"NATIVE_E2E_ATTACHMENT_API_SECRET_ACCESS_KEY",
		"NATIVE_E2E_ATTACHMENT_WORKER_ACCESS_KEY_ID",
		"NATIVE_E2E_ATTACHMENT_WORKER_SECRET_ACCESS_KEY",
		"NATIVE_E2E_ATTACHMENT_GRANT_KEY",
	] as const;
	const attachmentValues = attachmentNames.map((name) => Bun.env[name]);
	if (
		attachmentValues.some(Boolean) &&
		!attachmentValues.every((value) => Boolean(value))
	) {
		throw new Error("Native E2E attachment configuration must be complete");
	}
	const attachments = attachmentValues.every((value) => Boolean(value))
		? {
				publicEndpoint: required(attachmentNames[0]),
				localEndpoint: required(attachmentNames[1]),
				apiAccessKeyId: required(attachmentNames[2]),
				apiSecretAccessKey: required(attachmentNames[3]),
				workerAccessKeyId: required(attachmentNames[4]),
				workerSecretAccessKey: required(attachmentNames[5]),
				grantKey: required(attachmentNames[6]),
			}
		: undefined;
	const runner = await startNativeE2ERunner({
		userDatabaseUrl: required("NATIVE_E2E_USER_DATABASE_URL"),
		eventDatabaseUrl: required("NATIVE_E2E_EVENT_DATABASE_URL"),
		redisUrl: required("NATIVE_E2E_REDIS_URL"),
		controlPort: Number(required("NATIVE_E2E_CONTROL_PORT")),
		controlBearer: required("NATIVE_E2E_CONTROL_BEARER"),
		fixtureBearer: required("NATIVE_E2E_FIXTURE_BEARER"),
		deliveryBearer: required("NATIVE_E2E_DELIVERY_BEARER"),
		...(attachments ? { attachments } : {}),
	});
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.on(signal, () => {
			void runner.stop().then(
				() => process.exit(0),
				() => {
					console.error("Native E2E runner cleanup failed");
					process.exit(1);
				},
			);
		});
	}
	console.info(
		`Native E2E runner ready at ${runner.publicUrl}; control at ${runner.controlUrl}`,
	);
}
