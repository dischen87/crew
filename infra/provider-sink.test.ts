import { describe, expect, test } from "bun:test";
import { createProviderSinkHandler } from "./provider-sink";

const deliveryBearer = "delivery-bearer-local-test";
const fixtureBearer = "fixture-bearer-local-test";
const now = Date.parse("2026-07-18T12:00:00.000Z");
const token = `ml_${"a".repeat(43)}`;

function request(
	path: string,
	bearer: string,
	body: unknown,
	headers: Record<string, string> = {},
) {
	return new Request(`http://provider.test${path}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${bearer}`,
			"Content-Type": "application/json",
			...headers,
		},
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

describe("local provider sink", () => {
	test("keeps a delivered magic link out of logs and exposes it once to the fixture principal", async () => {
		const logs: unknown[] = [];
		const handler = createProviderSinkHandler({
			deliveryBearer,
			fixtureBearer,
			now: () => now,
			log: (...values) => logs.push(values),
		});
		const delivery = await handler(
			request(
				"/magic-links",
				deliveryBearer,
				{
					email: " Crew.Local@Example.Test ",
					link: `https://crew.app/auth/redeem?token=${token}`,
					expiresAt: "2026-07-18T12:15:00.000Z",
				},
				{
					"Idempotency-Key": token,
					"X-Request-ID": token,
				},
			),
		);
		expect(delivery.status).toBe(202);
		const serializedLogs = JSON.stringify(logs);
		expect(serializedLogs).not.toContain(token);
		expect(serializedLogs).not.toContain("Crew.Local@Example.Test");
		expect(serializedLogs).not.toContain("auth/redeem");

		const unauthorized = await handler(
			request("/internal/magic-links/consume", deliveryBearer, {
				email: "crew.local@example.test",
			}),
		);
		expect(unauthorized.status).toBe(401);

		const consumed = await handler(
			request("/internal/magic-links/consume", fixtureBearer, {
				email: "crew.local@example.test",
			}),
		);
		expect(consumed.status).toBe(200);
		expect(consumed.headers.get("Cache-Control")).toBe("no-store");
		expect(await consumed.json()).toEqual({ token });

		const consumedAgain = await handler(
			request("/internal/magic-links/consume", fixtureBearer, {
				email: "crew.local@example.test",
			}),
		);
		expect(consumedAgain.status).toBe(404);
	});

	test("rejects invalid, expired and oversized fixture payloads", async () => {
		const handler = createProviderSinkHandler({
			deliveryBearer,
			fixtureBearer,
			now: () => now,
			log: () => {},
		});
		expect(
			(
				await handler(
					request(
						"/magic-links",
						deliveryBearer,
						{
							email: "crew.local@example.test",
							link: `https://crew.app/auth/redeem?token=${token}`,
							expiresAt: "2026-07-18T11:59:59.000Z",
						},
						{ "Idempotency-Key": "delivery.key.123" },
					),
				)
			).status,
		).toBe(400);
		expect(
			(
				await handler(
					request(
						"/internal/magic-links/consume",
						fixtureBearer,
						"x".repeat(1_025),
					),
				)
			).status,
		).toBe(413);
		expect(() =>
			createProviderSinkHandler({
				deliveryBearer,
				fixtureBearer: deliveryBearer,
			}),
		).toThrow("must be different");
	});
});
