import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { RedisClient } from "bun";
import { RedisRateLimiter } from "./redis-rate-limit";

const redisUrl = Bun.env.GATEWAY_RATE_LIMIT_TEST_REDIS_URL;
const keySecret = "test-gateway-rate-limit-key-that-is-long-enough";

if (!redisUrl) {
	test.skip("Redis gateway rate limiter (set GATEWAY_RATE_LIMIT_TEST_REDIS_URL)", () => {});
} else {
	describe("Redis gateway rate limiter", () => {
		let admin: RedisClient;

		beforeAll(async () => {
			assertDedicatedDatabase(redisUrl);
			admin = new RedisClient(redisUrl);
			await admin.connect();
		});

		beforeEach(async () => {
			await admin.send("FLUSHDB", []);
		});

		afterAll(async () => {
			await admin.send("FLUSHDB", []);
			admin.close();
		});

		test("shares limits across replicas and an application restart without storing raw identities", async () => {
			const firstClient = new RedisClient(redisUrl);
			const secondClient = new RedisClient(redisUrl);
			const first = new RedisRateLimiter(
				firstClient,
				2,
				60_000,
				100,
				keySecret,
				1_000,
			);
			const second = new RedisRateLimiter(
				secondClient,
				2,
				60_000,
				100,
				keySecret,
				1_000,
			);
			const rawKey = "request:ip:198.51.100.71";

			expect(await first.consume(rawKey, -8_000_000_000_000_000)).toEqual({
				allowed: true,
				remaining: 1,
			});
			expect(await second.consume(rawKey, 8_000_000_000_000_000)).toEqual({
				allowed: true,
				remaining: 0,
			});
			firstClient.close();

			const restartedClient = new RedisClient(redisUrl);
			const restarted = new RedisRateLimiter(
				restartedClient,
				2,
				60_000,
				100,
				keySecret,
				1_000,
			);
			expect(await restarted.consume(rawKey)).toMatchObject({
				allowed: false,
				retryAfterSeconds: 60,
			});

			const keys = (await admin.send("KEYS", [
				"crew:gateway:rate:v1:*",
			])) as string[];
			const members = (await admin.send("ZRANGE", [
				"crew:gateway:rate:v1:{gateway}:active",
				"0",
				"-1",
			])) as string[];
			const durableState = JSON.stringify({ keys, members });
			expect(keys).toHaveLength(2);
			expect(durableState).not.toContain(rawKey);
			expect(durableState).not.toContain("198.51.100.71");
			for (const key of keys) {
				const ttl = Number(await admin.send("PTTL", [key]));
				expect(Number.isInteger(ttl)).toBe(true);
				expect(ttl).toBeWithin(1, 60_001);
			}

			secondClient.close();
			restartedClient.close();
		});

		test("fails closed under cardinality churn without evicting active buckets", async () => {
			const client = new RedisClient(redisUrl);
			const limiter = new RedisRateLimiter(
				client,
				2,
				60_000,
				2,
				keySecret,
				1_000,
			);

			expect(await limiter.consume("request:ip:unknown")).toMatchObject({
				allowed: true,
			});
			expect(await limiter.consume("principal:second")).toMatchObject({
				allowed: true,
			});
			expect(await limiter.consume("principal:attacker")).toMatchObject({
				allowed: false,
				retryAfterSeconds: 60,
			});
			expect(await limiter.consume("request:ip:unknown")).toEqual({
				allowed: true,
				remaining: 0,
			});
			expect(await limiter.consume("request:ip:unknown")).toMatchObject({
				allowed: false,
			});

			const keys = (await admin.send("KEYS", [
				"crew:gateway:rate:v1:{gateway}:bucket:*",
			])) as string[];
			expect(keys).toHaveLength(2);
			expect(JSON.stringify(keys)).not.toContain("unknown");
			client.close();
		});
	});
}

function assertDedicatedDatabase(url: string) {
	const parsed = new URL(url);
	if (
		!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
		parsed.pathname !== "/14"
	) {
		throw new Error(
			"Gateway rate-limit tests require loopback Redis database 14",
		);
	}
}
