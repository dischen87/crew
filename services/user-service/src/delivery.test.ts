import { describe, expect, test } from "bun:test";
import { createWebhookMagicLinkSender } from "./delivery";

describe("magic-link webhook delivery", () => {
	test("refuses redirects so credentials and sign-in links stay on the configured endpoint", async () => {
		let redirect: RequestRedirect | undefined;
		let deliveryKey: string | null | undefined;
		const sender = createWebhookMagicLinkSender({
			endpoint: "https://delivery.example/send",
			bearer: "secret",
			appUrl: "https://crew.example/auth/redeem",
			fetch: (async (_input, init) => {
				redirect = init?.redirect;
				deliveryKey = new Headers(init?.headers).get("Idempotency-Key");
				return new Response(null, { status: 307 });
			}) as typeof fetch,
		});

		await expect(
			sender({
				email: "person@example.com",
				token: "ml_secret",
				expiresAt: new Date("2026-07-18T12:15:00.000Z"),
				requestId: "request-1",
				deliveryKey: "job_0123456789abcdef0123456789abcdef",
			}),
		).rejects.toThrow("Magic-link delivery failed");
		expect(redirect).toBe("error");
		expect(deliveryKey).toBe("job_0123456789abcdef0123456789abcdef");
	});
});
