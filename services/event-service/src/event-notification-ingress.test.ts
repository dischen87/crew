import { describe, expect, test } from "bun:test";
import { decodeProtectedHeader, jwtVerify } from "jose";
import {
	EventNotificationIngressClient,
	EventNotificationIngressError,
} from "./event-notification-ingress";
import type { EventNotificationPayload } from "./event-notification-payload";

const serviceKey = "BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ";
const payload: EventNotificationPayload = {
	recipientUserId: "usr_00000000000000000000000000000002",
	category: "feed_update",
	templateKey: "feed_entry_created",
	deepLink: {
		rootEventId: "evt_notification-unit",
		eventId: "evt_notification-child",
		feedEntryId: "fed_notification-unit",
	},
	expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
	requestId: "job_00000000000000000000000000000001",
	causationRequestId: "feed-command-request-1",
};

describe("event notification user-service ingress", () => {
	test("cancels successful response bodies without reading provider payloads", async () => {
		let cancelled = false;
		const responseBody = new ReadableStream({
			cancel() {
				cancelled = true;
			},
		});
		const client = new EventNotificationIngressClient(
			{
				baseUrl: "https://user-service.internal",
				timeoutMs: 1_000,
				issuer: "crew-event-service",
				audience: "crew-user-service",
				serviceAuthKeyId: "service-current-v2",
				serviceAuthKey: serviceKey,
			},
			(async () =>
				new Response(responseBody, { status: 202 })) as unknown as typeof fetch,
		);

		expect(await client.deliver(payload)).toEqual({ status: 202 });
		expect(cancelled).toBe(true);
	});

	test("sends the exact strict contract with a current-KID target JWT", async () => {
		let request:
			| {
					input: Parameters<typeof fetch>[0];
					init: Parameters<typeof fetch>[1];
			  }
			| undefined;
		const client = new EventNotificationIngressClient(
			{
				baseUrl: "https://user-service.internal/base-path",
				timeoutMs: 1_000,
				issuer: "crew-event-service",
				audience: "crew-user-service",
				serviceAuthKeyId: "service-current-v2",
				serviceAuthKey: serviceKey,
			},
			(async (
				input: Parameters<typeof fetch>[0],
				init?: Parameters<typeof fetch>[1],
			) => {
				request = { input, init };
				return new Response(
					JSON.stringify({ accepted: true, queuedDevices: 1 }),
					{
						status: 202,
					},
				);
			}) as unknown as typeof fetch,
		);

		expect(await client.deliver(payload)).toEqual({ status: 202 });
		expect(String(request?.input)).toBe(
			"https://user-service.internal/internal/v1/event-notifications",
		);
		expect(request?.init?.redirect).toBe("error");
		const headers = new Headers(request?.init?.headers);
		expect(headers.get("idempotency-key")).toBe(payload.requestId);
		expect(headers.get("x-request-id")).toBe(payload.requestId);
		expect(headers.get("x-causation-request-id")).toBe(
			payload.causationRequestId,
		);
		const token = headers.get("authorization")?.replace("Bearer ", "") ?? "";
		expect(decodeProtectedHeader(token)).toEqual({
			alg: "HS256",
			kid: "service-current-v2",
			typ: "JWT",
		});
		const verified = await jwtVerify(
			token,
			new Uint8Array(Buffer.from(serviceKey, "base64url")),
			{
				algorithms: ["HS256"],
				issuer: "crew-event-service",
				audience: "crew-user-service",
			},
		);
		expect(verified.payload).toMatchObject({
			sub: "event-service",
			scope: "user:event-notifications:write",
		});
		expect(
			(verified.payload.exp as number) - (verified.payload.iat as number),
		).toBeLessThanOrEqual(300);
		expect(JSON.parse(String(request?.init?.body))).toEqual({
			recipientUserId: payload.recipientUserId,
			category: "feed_update",
			templateKey: "feed_entry_created",
			deepLink: payload.deepLink,
			expiresAt: payload.expiresAt,
		});
	});

	test("retries only in-progress 409 responses carrying Retry-After", async () => {
		const client = (retryAfter?: string) =>
			new EventNotificationIngressClient(
				{
					baseUrl: "https://user-service.internal",
					timeoutMs: 1_000,
					issuer: "crew-event-service",
					audience: "crew-user-service",
					serviceAuthKeyId: "service-current-v2",
					serviceAuthKey: serviceKey,
				},
				(async () =>
					new Response(null, {
						status: 409,
						headers: retryAfter ? { "Retry-After": retryAfter } : {},
					})) as unknown as typeof fetch,
			);
		await expect(client("1").deliver(payload)).rejects.toMatchObject({
			code: "NOTIFICATION_INGRESS_CONFLICT",
			retryable: true,
			retryAfterMs: 1_000,
		});
		try {
			await client().deliver(payload);
			throw new Error("Expected terminal conflict");
		} catch (error) {
			expect(error).toBeInstanceOf(EventNotificationIngressError);
			expect(error).toMatchObject({
				code: "NOTIFICATION_INGRESS_CONFLICT",
				retryable: false,
			});
		}
	});

	test("retries ambiguous 408 and defensive 425 responses", async () => {
		const client = (status: 408 | 425, retryAfter?: string) =>
			new EventNotificationIngressClient(
				{
					baseUrl: "https://user-service.internal",
					timeoutMs: 1_000,
					issuer: "crew-event-service",
					audience: "crew-user-service",
					serviceAuthKeyId: "service-current-v2",
					serviceAuthKey: serviceKey,
				},
				(async () =>
					new Response(null, {
						status,
						headers: retryAfter ? { "Retry-After": retryAfter } : {},
					})) as unknown as typeof fetch,
			);

		await expect(client(408, "9999999").deliver(payload)).rejects.toMatchObject(
			{
				code: "NOTIFICATION_INGRESS_UNAVAILABLE",
				retryable: true,
				retryAfterMs: 60 * 60 * 1000,
			},
		);
		await expect(client(425).deliver(payload)).rejects.toMatchObject({
			code: "NOTIFICATION_INGRESS_UNAVAILABLE",
			retryable: true,
		});
	});

	test("classifies rate limits without exposing provider response payloads", async () => {
		const client = new EventNotificationIngressClient(
			{
				baseUrl: "https://user-service.internal",
				timeoutMs: 1_000,
				issuer: "crew-event-service",
				audience: "crew-user-service",
				serviceAuthKeyId: "service-current-v2",
				serviceAuthKey: serviceKey,
			},
			(async () =>
				new Response("private provider diagnostics", {
					status: 429,
					headers: { "Retry-After": "2" },
				})) as unknown as typeof fetch,
		);

		await expect(client.deliver(payload)).rejects.toMatchObject({
			code: "NOTIFICATION_INGRESS_RATE_LIMITED",
			retryable: true,
			retryAfterMs: 2_000,
		});
	});
});
