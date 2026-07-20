import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPair } from "jose";
import { type AppDependencies, createApp } from "./app";
import { createTokenService, type TokenService } from "./auth";
import { createDeliveryPayloadKeyring } from "./delivery-payload";
import {
	createPushPayloadKeyring,
	type PushPayloadKeyring,
} from "./push-payload";
import { MemoryAuthRateLimiter } from "./rate-limit";
import {
	defaultProfile,
	InMemoryUserRepository,
	type PushNotificationIngressInput,
} from "./repository";
import {
	createEventNotificationServiceAuth,
	issueEventNotificationServiceToken,
} from "./service-auth";

const serviceKey = {
	id: "event-service-test",
	key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};
const payloadKey = "TxsYmFtlYMVPT1UZKmSGicjfoc8lhZ0kGQ3FgIZavhs";
const userId = "usr_00000000000000000000000000000001";
const clock = new Date("2026-07-18T12:00:00.000Z");
let tokens: TokenService;
let serviceToken: string;
let repository: InMemoryUserRepository;
let pushPayloads: PushPayloadKeyring;

beforeAll(async () => {
	const keys = await generateKeyPair("RS256");
	tokens = await createTokenService(keys.privateKey, keys.publicKey, {
		issuer: "crew-user-service",
		audience: "crew-mobile",
		keyId: "push-ingress-test",
		accessTokenTtlSeconds: 900,
	});
	serviceToken = await issueEventNotificationServiceToken({
		issuer: "crew-event-service",
		audience: "crew-user-service",
		key: serviceKey,
	});
});

beforeEach(() => {
	repository = new InMemoryUserRepository();
	pushPayloads = createPushPayloadKeyring({
		current: { id: "push-test", key: payloadKey },
	});
});

describe("internal event-notification ingress", () => {
	test("authenticates the caller and atomically queues one sealed job per current device", async () => {
		await seedRecipient(2);
		const app = createApp(dependencies());
		const unauthenticated = await ingress(app, 1, {}, { authorization: "" });
		expect(unauthenticated.status).toBe(401);
		expect((await unauthenticated.json()).error).toMatchObject({
			code: "UNAUTHENTICATED",
			message: "Service authentication is required.",
		});
		expect(repository.pushJobs.size).toBe(0);

		const accepted = await ingress(app, 1);
		expect(accepted.status).toBe(202);
		expect(await accepted.json()).toEqual({
			accepted: true,
			queuedDevices: 2,
		});
		expect(repository.pushJobs.size).toBe(2);
		for (const job of repository.pushJobs.values()) {
			expect(job.requestId).toBe("event.ingress.1");
			expect(job.causationRequestId).toBe("event.command.1");
			expect(job.sealedPayload).not.toContain("private-token");
			expect(job.sealedPayload).not.toContain("evt_root0001");
			const payload = pushPayloads.open({
				jobId: job.id,
				eventJobId: job.eventJobId,
				recipientUserId: job.recipientUserId,
				deviceId: job.deviceId,
				requestId: job.requestId,
				causationRequestId: job.causationRequestId,
				expiresAt: job.expiresAt,
				sealedPayload: job.sealedPayload,
			});
			expect(payload).toMatchObject({
				category: "event_reminder",
				templateKey: "event_starts_soon",
				deepLink: { rootEventId: "evt_root0001" },
			});
		}
	});

	test("replays exact 202/204 outcomes and rejects mismatched or concurrent commands", async () => {
		await seedRecipient(1);
		const app = createApp(dependencies());
		expect((await ingress(app, 2)).status).toBe(202);
		const replay = await ingress(app, 2, {}, { requestId: "event.replay.2" });
		expect(replay.status).toBe(202);
		expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
		expect(replay.headers.get("X-Request-ID")).toBe("event.replay.2");
		expect(repository.pushJobs.size).toBe(1);
		const mismatch = await ingress(app, 2, { category: "feed_update" });
		expect(mismatch.status).toBe(409);
		expect((await mismatch.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");

		const emptyRepository = new InMemoryUserRepository();
		const emptyApp = createApp(dependencies({ repository: emptyRepository }));
		const suppressed = await ingress(emptyApp, 3);
		expect(suppressed.status).toBe(204);
		expect(await suppressed.text()).toBe("");
		await seedRecipient(1, emptyRepository);
		const suppressedReplay = await ingress(emptyApp, 3);
		expect(suppressedReplay.status).toBe(204);
		expect(suppressedReplay.headers.get("Idempotency-Replayed")).toBe("true");
		expect(emptyRepository.pushJobs.size).toBe(0);

		const delayedRepository = new DelayedPushRepository();
		await seedRecipient(1, delayedRepository);
		const delayedApp = createApp(
			dependencies({ repository: delayedRepository }),
		);
		const first = ingress(delayedApp, 4);
		await delayedRepository.started;
		const concurrent = await ingress(delayedApp, 4);
		expect(concurrent.status).toBe(409);
		expect((await concurrent.json()).error.code).toBe(
			"IDEMPOTENCY_IN_PROGRESS",
		);
		delayedRepository.release();
		expect((await first).status).toBe(202);
	});

	test("enforces expiry and device admission without truncating fanout", async () => {
		await seedRecipient(21);
		const app = createApp(dependencies());
		const capped = await ingress(app, 5);
		expect(capped.status).toBe(409);
		expect((await capped.json()).error.code).toBe(
			"DEVICE_FANOUT_LIMIT_EXCEEDED",
		);
		expect(repository.pushJobs.size).toBe(0);
		const device = [...repository.devices.values()][0];
		if (!device) throw new Error("Expected seeded device");
		await repository.upsertDevice(
			userId,
			{ ...device, pushToken: null, notificationsEnabled: false },
			clock,
		);
		const cappedReplay = await ingress(app, 5);
		expect(cappedReplay.status).toBe(409);
		expect(cappedReplay.headers.get("Idempotency-Replayed")).toBe("true");

		const tooFar = await ingress(app, 6, {
			expiresAt: new Date(
				clock.getTime() + 24 * 60 * 60 * 1_000 + 1,
			).toISOString(),
		});
		expect(tooFar.status).toBe(400);
		expect((await tooFar.json()).error.code).toBe("EXPIRY_TOO_FAR");
		const expired = await ingress(app, 7, {
			expiresAt: new Date(clock.getTime() - 1).toISOString(),
		});
		expect(expired.status).toBe(204);
	});

	test("requires correlation headers and rejects unknown or oversized payload fields", async () => {
		await seedRecipient(1);
		const app = createApp(dependencies());
		const headers = {
			Authorization: `Bearer ${serviceToken}`,
			"Content-Type": "application/json",
			"Idempotency-Key": "job_00000000000000000000000000000009",
			"X-Request-ID": "event.ingress.validation",
		};
		const body = {
			recipientUserId: userId,
			category: "event_update",
			templateKey: "event_updated",
			deepLink: { rootEventId: "evt_root0001" },
			expiresAt: new Date(clock.getTime() + 60_000).toISOString(),
		};
		const missingCausation = await app.request(
			"/internal/v1/event-notifications",
			{ method: "POST", headers, body: JSON.stringify(body) },
		);
		expect(missingCausation.status).toBe(400);

		const completeHeaders = {
			...headers,
			"X-Causation-Request-ID": "event.cause.validation",
		};
		const extraField = await app.request("/internal/v1/event-notifications", {
			method: "POST",
			headers: completeHeaders,
			body: JSON.stringify({ ...body, title: "private preview" }),
		});
		expect(extraField.status).toBe(400);
		const oversized = await app.request("/internal/v1/event-notifications", {
			method: "POST",
			headers: completeHeaders,
			body: JSON.stringify({ ...body, padding: "x".repeat(8_192) }),
		});
		expect(oversized.status).toBe(413);
		expect(repository.pushJobs.size).toBe(0);
	});

	test("rolls back failed sealing and logs no token or private payload", async () => {
		await seedRecipient(2);
		let seals = 0;
		const failingPayloads: PushPayloadKeyring = {
			seal(metadata, payload) {
				seals += 1;
				if (seals === 2) {
					throw new Error(
						`provider secret ${payload.pushToken} ${payload.deepLink.rootEventId}`,
					);
				}
				return pushPayloads.seal(metadata, payload);
			},
			open: pushPayloads.open,
		};
		const logs: unknown[][] = [];
		const original = console.error;
		console.error = (...args: unknown[]) => logs.push(args);
		try {
			const response = await ingress(
				createApp(dependencies({ pushPayloads: failingPayloads })),
				8,
			);
			expect(response.status).toBe(500);
		} finally {
			console.error = original;
		}
		expect(repository.pushJobs.size).toBe(0);
		const rendered = JSON.stringify(logs);
		expect(rendered).not.toContain("private-token");
		expect(rendered).not.toContain("evt_root0001");
		expect(rendered).not.toContain("provider secret");
		expect(rendered).toContain("INTERNAL_ERROR");
	});
});

function dependencies(
	overrides: Partial<AppDependencies> = {},
): AppDependencies {
	return {
		repository,
		tokens,
		deliveryPayloads: createDeliveryPayloadKeyring({
			current: {
				id: "delivery-test",
				key: "eKOfuEuHFGQeOZltcgU4hlzp3jYpRNrp3xvjzwjJkSE",
			},
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
		refreshTokenKey: "push-ingress-refresh-key-at-least-32-bytes",
		idempotencyPayloadKeys: {
			current: {
				id: "push-ingress-idempotency-v1",
				key: "push-ingress-idempotency-key-at-least-32-bytes",
			},
		},
		now: () => new Date(clock),
		...overrides,
	};
}

async function seedRecipient(
	deviceCount: number,
	target: InMemoryUserRepository = repository,
) {
	target.users.set(userId, {
		id: userId,
		email: "recipient@example.com",
		createdAt: clock,
	});
	target.profiles.set(userId, defaultProfile(userId, clock));
	for (let index = 0; index < deviceCount; index += 1) {
		await target.upsertDevice(
			userId,
			{
				installationId: `dvc_installation_${index.toString().padStart(8, "0")}`,
				platform: index % 2 === 0 ? "ios" : "android",
				pushToken: `private-token-${index.toString().padStart(16, "0")}`,
				locale: "de-CH",
				timeZone: "Europe/Zurich",
				appVersion: "1.0.0",
				notificationsEnabled: true,
			},
			clock,
		);
	}
}

async function ingress(
	app: ReturnType<typeof createApp>,
	sequence: number,
	bodyOverrides: Record<string, unknown> = {},
	headerOverrides: { authorization?: string; requestId?: string } = {},
) {
	return app.request("/internal/v1/event-notifications", {
		method: "POST",
		headers: {
			Authorization: headerOverrides.authorization ?? `Bearer ${serviceToken}`,
			"Content-Type": "application/json",
			"Idempotency-Key": `job_${sequence.toString(16).padStart(32, "0")}`,
			"X-Request-ID": headerOverrides.requestId ?? `event.ingress.${sequence}`,
			"X-Causation-Request-ID": `event.command.${sequence}`,
		},
		body: JSON.stringify({
			recipientUserId: userId,
			category: "event_reminder",
			templateKey: "event_starts_soon",
			deepLink: { rootEventId: "evt_root0001" },
			expiresAt: new Date(clock.getTime() + 60 * 60 * 1_000).toISOString(),
			...bodyOverrides,
		}),
	});
}

class DelayedPushRepository extends InMemoryUserRepository {
	private start: (() => void) | undefined;
	private resume: (() => void) | undefined;
	readonly started = new Promise<void>((resolve) => {
		this.start = resolve;
	});
	private readonly released = new Promise<void>((resolve) => {
		this.resume = resolve;
	});

	release() {
		this.resume?.();
	}

	override async enqueuePushNotification(input: PushNotificationIngressInput) {
		this.start?.();
		await this.released;
		return super.enqueuePushNotification(input);
	}
}
