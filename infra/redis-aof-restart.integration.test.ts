import { describe, expect, test } from "bun:test";
import { RedisClient } from "bun";
import { RedisRateLimiter } from "../services/api-gateway/src/redis-rate-limit";

const redisUrl = Bun.env.REDIS_AOF_TEST_URL;
const phase = Bun.env.REDIS_AOF_TEST_PHASE;
const secret = "gateway-aof-restart-hmac-secret-long-enough";
const rawKey = "request:ip:198.51.100.91";

if (!redisUrl || (phase !== "seed" && phase !== "verify")) {
	test.skip("Redis AOF restart (set REDIS_AOF_TEST_URL and REDIS_AOF_TEST_PHASE)", () => {});
} else {
	describe(`rate-limit Redis AOF ${phase}`, () => {
		test("retains an active window across a Redis process restart", async () => {
			assertDedicatedDatabase(redisUrl);
			const admin = new RedisClient(redisUrl);
			await admin.connect();
			const limiter = new RedisRateLimiter(
				admin,
				1,
				60_000,
				100,
				secret,
				1_000,
			);

			try {
				if (phase === "seed") {
					await admin.send("FLUSHDB", []);
					await admin.send("CONFIG", ["SET", "appendonly", "yes"]);
					await admin.send("CONFIG", ["SET", "appendfsync", "always"]);
					const config = (await admin.send("CONFIG", [
						"GET",
						"appendonly",
						"appendfsync",
					])) as Record<string, string>;
					expect(config).toEqual({ appendfsync: "always", appendonly: "yes" });
					expect(await limiter.consume(rawKey, -8_000_000_000_000_000)).toEqual(
						{ allowed: true, remaining: 0 },
					);
					return;
				}

				expect(
					await limiter.consume(rawKey, 8_000_000_000_000_000),
				).toMatchObject({ allowed: false });
				const state = JSON.stringify(
					await admin.send("KEYS", ["crew:gateway:rate:v1:*"]),
				);
				expect(state).not.toContain(rawKey);
				expect(state).not.toContain("198.51.100.91");
				await admin.send("FLUSHDB", []);
			} finally {
				admin.close();
			}
		});
	});
}

function assertDedicatedDatabase(url: string) {
	const parsed = new URL(url);
	if (
		!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
		parsed.pathname !== "/12"
	) {
		throw new Error("Redis AOF tests require loopback Redis database 12");
	}
}
