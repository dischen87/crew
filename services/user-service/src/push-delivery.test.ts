import { describe, expect, test } from "bun:test";
import { createWebhookPushSender, PushDeliveryError } from "./push-delivery";

describe("push webhook delivery", () => {
	test("refuses redirects and propagates stable routing without leaking elsewhere", async () => {
		let target: string | undefined;
		let init: RequestInit | undefined;
		const sender = createWebhookPushSender({
			endpoint: "https://push.example/send",
			bearer: "provider-secret-not-service-auth",
			fetch: (async (input, requestInit) => {
				target = String(input);
				init = requestInit;
				return new Response(null, { status: 307 });
			}) as typeof fetch,
		});
		await expect(
			sender({
				pushToken: "private-device-token",
				category: "event_update",
				templateKey: "event_updated",
				deepLink: { rootEventId: "evt_root0001" },
				locale: "de-CH",
				expiresAt: new Date("2026-07-18T13:00:00.000Z"),
				requestId: "event.ingress.request",
				causationRequestId: "event.domain.command",
				deliveryKey: "pjob_00000000000000000000000000000001",
			}),
		).rejects.toBeInstanceOf(PushDeliveryError);

		expect(target).toBe("https://push.example/send");
		expect(init?.redirect).toBe("error");
		const headers = new Headers(init?.headers);
		expect(headers.get("Idempotency-Key")).toBe(
			"pjob_00000000000000000000000000000001",
		);
		expect(headers.get("X-Request-ID")).toBe("event.ingress.request");
		expect(headers.get("X-Causation-Request-ID")).toBe("event.domain.command");
		expect(headers.get("Authorization")).toBe(
			"Bearer provider-secret-not-service-auth",
		);
		expect(await new Response(init?.body).text()).toContain(
			"private-device-token",
		);
	});

	test("honors Retry-After without reading provider response bodies", async () => {
		const sender = createWebhookPushSender({
			endpoint: "https://push.example/send",
			bearer: "provider-secret-not-service-auth",
			fetch: (async () =>
				new Response("private provider detail", {
					status: 429,
					headers: { "Retry-After": "5" },
				})) as unknown as typeof fetch,
		});
		try {
			await sender({
				pushToken: "private-device-token",
				category: "event_reminder",
				templateKey: "event_starts_soon",
				deepLink: { rootEventId: "evt_root0001" },
				locale: "en",
				expiresAt: new Date(Date.now() + 60_000),
				requestId: "request-1",
				causationRequestId: "cause-1",
				deliveryKey: "pjob_00000000000000000000000000000001",
			});
			throw new Error("Expected provider failure");
		} catch (error) {
			expect(error).toBeInstanceOf(PushDeliveryError);
			expect((error as PushDeliveryError).code).toBe("provider_429");
			expect((error as PushDeliveryError).retryAfterMs).toBe(5_000);
			expect(error instanceof Error ? error.message : "").not.toContain(
				"private provider detail",
			);
		}
	});
});
