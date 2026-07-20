import { describe, expect, test } from "bun:test";
import {
	GatewayClient,
	type GatewaySessionSubject,
	ProductAnalytics,
	type ProductAnalyticsEnvelope,
	type ProductAnalyticsEvent,
	ProductAnalyticsValidationError,
	type Session,
	type SessionStore,
} from "../src/index.ts";

class MemorySessionStore implements SessionStore {
	constructor(public session: Session | null) {}

	async get(): Promise<Session | null> {
		return this.session;
	}

	async compareAndSet(
		expected: Session | null,
		replacement: Session | null,
	): Promise<boolean> {
		if (this.session !== expected) return false;
		this.session = replacement;
		return true;
	}
}

describe("ProductAnalytics", () => {
	test("emits an enum-only envelope for the current authenticated user", async () => {
		const client = gatewayClient(
			new MemorySessionStore(authenticatedSession()),
		);
		const subject = await requiredSubject(client);
		const captured: ProductAnalyticsEnvelope[] = [];
		const analytics = new ProductAnalytics({
			session: client,
			sink: {
				capture: (event) => {
					captured.push(event);
				},
			},
			now: () => new Date("2026-07-19T10:20:30.000Z"),
		});

		const result = await analytics.capture(subject, {
			name: "organizer_start",
			properties: { vertical: "team_event", platform: "ios" },
		});

		expect(result).toBe("delivered");
		expect(captured).toEqual([
			{
				schema_version: 1,
				event_name: "organizer_start",
				actor_user_id: "usr_0123456789abcdef0123456789abcdef",
				properties: { vertical: "team_event", platform: "ios" },
				occurred_at: "2026-07-19T10:20:30.000Z",
			},
		]);
		expect(Object.isFrozen(captured[0])).toBe(true);
		expect(Object.isFrozen(captured[0]?.properties)).toBe(true);
		const serialized = JSON.stringify(captured);
		expect(serialized).not.toContain("access-super-secret");
		expect(serialized).not.toContain("refresh-super-secret");
		expect(serialized).not.toContain("organizer@example.com");
	});

	test("rejects secrets, free text, request bodies, and feedback diagnostics", async () => {
		const client = gatewayClient(
			new MemorySessionStore(authenticatedSession()),
		);
		const subject = await requiredSubject(client);
		let sinkCalls = 0;
		const analytics = new ProductAnalytics({
			session: client,
			sink: {
				capture: () => {
					sinkCalls++;
				},
			},
		});
		const invalidEvents = [
			{
				name: "organizer_start",
				properties: {
					vertical: "team_event",
					platform: "ios",
					access_token: "access-super-secret",
					email: "organizer@example.com",
					invite_token: "invite-super-secret",
					request_body: { title: "Private offsite" },
					message_body: "Private message",
					private_feedback_id: "feedback-private-1",
					feedback_diagnostics: { trace: "private-stack" },
				},
			},
			{
				name: "participant_first_value",
				properties: {
					vertical: "trip",
					entry_surface: "free text private destination",
					platform: "android",
				},
			},
			{
				name: "feedback_submitted",
				properties: { diagnostics: "private-stack" },
			},
		];

		for (const invalidEvent of invalidEvents) {
			const error = await captureError(
				analytics.capture(
					subject,
					invalidEvent as unknown as ProductAnalyticsEvent,
				),
			);
			expect(error).toBeInstanceOf(ProductAnalyticsValidationError);
			expect(String(error)).toBe(
				"ProductAnalyticsValidationError: Invalid product analytics input",
			);
			const serialized = JSON.stringify(error);
			expect(serialized).not.toContain("super-secret");
			expect(serialized).not.toContain("organizer@example.com");
			expect(serialized).not.toContain("Private");
			expect(serialized).not.toContain("private-stack");
		}
		expect(sinkCalls).toBe(0);
	});

	test("rejects forged subjects even when their user ID looks valid", async () => {
		const client = gatewayClient(
			new MemorySessionStore(authenticatedSession()),
		);
		const forged = Object.freeze({
			userId: "usr_0123456789abcdef0123456789abcdef",
		}) as GatewaySessionSubject;
		let sinkCalls = 0;
		const analytics = new ProductAnalytics({
			session: client,
			sink: {
				capture: () => {
					sinkCalls++;
				},
			},
		});

		const error = await captureError(
			analytics.capture(forged, organizerStart()),
		);

		expect(error).toBeInstanceOf(TypeError);
		expect(String(error)).toContain("Invalid GatewayClient session subject");
		expect(sinkCalls).toBe(0);
	});

	test("rejects non-internal actor IDs even if a custom verifier accepts them", async () => {
		const analytics = new ProductAnalytics({
			session: { assertSessionSubject: async () => undefined },
			sink: { capture: () => undefined },
		});
		const unsafeSubject = Object.freeze({
			userId: "organizer@example.com",
		}) as GatewaySessionSubject;

		await expect(
			analytics.capture(unsafeSubject, organizerStart()),
		).rejects.toBeInstanceOf(ProductAnalyticsValidationError);
	});

	test("isolates a sink failure without retaining or exposing its error", async () => {
		const client = gatewayClient(
			new MemorySessionStore(authenticatedSession()),
		);
		const subject = await requiredSubject(client);
		const analytics = new ProductAnalytics({
			session: client,
			sink: {
				capture: () => {
					throw new Error(
						"provider access-super-secret organizer@example.com private-stack",
					);
				},
			},
		});

		await expect(analytics.capture(subject, organizerStart())).resolves.toBe(
			"dropped",
		);
	});
});

function gatewayClient(store: SessionStore): GatewayClient {
	return new GatewayClient({
		baseUrl: "https://gateway.test",
		sessionStore: store,
		fetch: (async () => {
			throw new Error("Analytics must not call the gateway");
		}) as unknown as typeof fetch,
		requestId: () => "analytics-request-0001",
	});
}

async function requiredSubject(
	client: GatewayClient,
): Promise<GatewaySessionSubject> {
	const subject = await client.sessionSubject();
	if (!subject) throw new Error("Expected authenticated test subject");
	return subject;
}

function organizerStart(): ProductAnalyticsEvent {
	return {
		name: "organizer_start",
		properties: { vertical: "team_event", platform: "ios" },
	};
}

function authenticatedSession(): Session {
	return {
		accessToken: "access-super-secret",
		refreshToken: "refresh-super-secret",
		tokenType: "Bearer",
		expiresInSeconds: 300,
		user: {
			id: "usr_0123456789abcdef0123456789abcdef",
			email: "organizer@example.com",
			profile: {
				displayName: "Organizer",
				avatarUrl: null,
				locale: "de-CH",
				timeZone: "Europe/Zurich",
				reduceMotion: false,
				eventReminders: true,
				productUpdates: false,
				version: 1,
				updatedAt: "2026-07-19T00:00:00.000Z",
			},
		},
	};
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
		throw new Error("Expected rejection");
	} catch (error) {
		return error;
	}
}
