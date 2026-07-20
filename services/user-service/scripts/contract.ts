import { fileURLToPath } from "node:url";
import { generateKeyPair } from "jose";
import { createApp } from "../src/app";
import { createTokenService } from "../src/auth";
import { createDeliveryPayloadKeyring } from "../src/delivery-payload";
import { MemoryAuthRateLimiter } from "../src/rate-limit";
import { InMemoryUserRepository } from "../src/repository";

const keys = await generateKeyPair("RS256");
const tokens = await createTokenService(keys.privateKey, keys.publicKey, {
	issuer: "crew-user-service",
	audience: "crew-mobile",
	keyId: "contract-key",
	accessTokenTtlSeconds: 900,
});
const app = createApp({
	repository: new InMemoryUserRepository(),
	tokens,
	deliveryPayloads: createDeliveryPayloadKeyring({
		current: {
			id: "contract-1",
			key: "eKOfuEuHFGQeOZltcgU4hlzp3jYpRNrp3xvjzwjJkSE",
		},
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
	refreshTokenKey: "contract-refresh-key-at-least-32-bytes",
	idempotencyPayloadKeys: {
		current: {
			id: "contract-idempotency-v1",
			key: "contract-idempotency-payload-key-at-least-32-bytes",
		},
	},
});
const path = fileURLToPath(new URL("../openapi/openapi.json", import.meta.url));
const response = await app.request("/docs/openapi.json");
const output = `${JSON.stringify(await response.json(), null, 2)}\n`;

if (process.argv.includes("--check")) {
	if (
		!(await Bun.file(path).exists()) ||
		(await Bun.file(path).text()) !== output
	) {
		throw new Error(
			"openapi/openapi.json is stale; run bun run contract:export",
		);
	}
} else {
	await Bun.write(path, output);
}
