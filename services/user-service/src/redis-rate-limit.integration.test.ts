import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { RedisClient } from "bun";
import { RedisAuthRateLimiter } from "./rate-limit";

const redisUrl = Bun.env.USER_RATE_LIMIT_TEST_REDIS_URL;
const keySecret = "test-user-rate-limit-key-that-is-long-enough";
const policies = {
	magicRequest: { windowMs: 60_000 },
	magicRedeem: { windowMs: 60_000 },
	refresh: { windowMs: 60_000 },
} as const;

if (!redisUrl) {
	test.skip("Redis user rate limiter (set USER_RATE_LIMIT_TEST_REDIS_URL)", () => {});
} else {
	describe("Redis user rate limiter", () => {
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

		test("shares atomic subject limits across replicas and an application restart without storing raw identities", async () => {
			const firstClient = new RedisClient(redisUrl);
			const secondClient = new RedisClient(redisUrl);
			const first = new RedisAuthRateLimiter(
				firstClient,
				policies,
				100,
				keySecret,
				1_000,
			);
			const second = new RedisAuthRateLimiter(
				secondClient,
				policies,
				100,
				keySecret,
				1_000,
			);
			const scopes = [
				{ key: "client:198.51.100.72", limit: 2 },
				{ key: "email:private@example.test", limit: 2 },
			];

			expect(
				await first.consume("magicRequest", scopes, -8_000_000_000_000_000),
			).toEqual({ allowed: true });
			expect(
				await second.consume("magicRequest", scopes, 8_000_000_000_000_000),
			).toEqual({
				allowed: true,
			});
			firstClient.close();

			const restartedClient = new RedisClient(redisUrl);
			const restarted = new RedisAuthRateLimiter(
				restartedClient,
				policies,
				100,
				keySecret,
				1_000,
			);
			expect(await restarted.consume("magicRequest", scopes)).toMatchObject({
				allowed: false,
				retryAfterSeconds: 60,
			});

			const keys = (await admin.send("KEYS", [
				"crew:user:rate:v1:*",
			])) as string[];
			const members = (await admin.send("ZRANGE", [
				"crew:user:rate:v1:{user}:active",
				"0",
				"-1",
			])) as string[];
			const durableState = JSON.stringify({ keys, members });
			expect(keys).toHaveLength(3);
			expect(durableState).not.toContain("198.51.100.72");
			expect(durableState).not.toContain("private@example.test");
			for (const key of keys) {
				const ttl = Number(await admin.send("PTTL", [key]));
				expect(Number.isInteger(ttl)).toBe(true);
				expect(ttl).toBeWithin(1, 60_001);
			}

			secondClient.close();
			restartedClient.close();
		});

		test("fails closed atomically under cardinality churn without partial scopes", async () => {
			const client = new RedisClient(redisUrl);
			const limiter = new RedisAuthRateLimiter(
				client,
				policies,
				4,
				keySecret,
				1_000,
			);
			const first = [
				{ key: "client:first", limit: 2 },
				{ key: "email:first", limit: 2 },
			];
			const second = [
				{ key: "client:second", limit: 2 },
				{ key: "email:second", limit: 2 },
			];
			const attacker = [
				{ key: "client:attacker", limit: 100 },
				{ key: "email:attacker", limit: 100 },
			];

			expect(await limiter.consume("magicRequest", first)).toEqual({
				allowed: true,
			});
			expect(await limiter.consume("magicRequest", second)).toEqual({
				allowed: true,
			});
			expect(await limiter.consume("magicRequest", attacker)).toMatchObject({
				allowed: false,
				retryAfterSeconds: 60,
			});
			expect(await limiter.consume("magicRequest", first)).toEqual({
				allowed: true,
			});
			expect(await limiter.consume("magicRequest", first)).toMatchObject({
				allowed: false,
			});

			const keys = (await admin.send("KEYS", [
				"crew:user:rate:v1:{user}:bucket:*",
			])) as string[];
			expect(keys).toHaveLength(4);
			client.close();
		});
	});
}

function assertDedicatedDatabase(url: string) {
	const parsed = new URL(url);
	if (
		!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
		parsed.pathname !== "/15"
	) {
		throw new Error("User rate-limit tests require loopback Redis database 15");
	}
}
