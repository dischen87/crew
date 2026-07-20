import { describe, expect, test } from "bun:test";
import { RedisClient } from "bun";
import { RedisRateLimiter } from "../services/api-gateway/src/redis-rate-limit";
import { RedisAuthRateLimiter } from "../services/user-service/src/rate-limit";

const adminUrl = Bun.env.REDIS_RATE_LIMIT_BOUNDARY_TEST_ADMIN_URL;
const gatewayUser = "crew_gateway_boundary_test";
const userUser = "crew_user_boundary_test";
const gatewayPassword = "gateway_boundary_test_password_2026";
const userPassword = "user_boundary_test_password_2026";
const commands = [
	"+select",
	"+ping",
	"+eval",
	"+time",
	"+zremrangebyscore",
	"+pttl",
	"+zcard",
	"+zrange",
	"+set",
	"+zadd",
	"+pexpireat",
	"+get",
	"+incr",
];

if (!adminUrl) {
	test.skip("Redis ACL boundary (set REDIS_RATE_LIMIT_BOUNDARY_TEST_ADMIN_URL)", () => {});
} else {
	describe("rate-limit Redis ACL boundary", () => {
		test("allows each limiter only its own namespace and exact commands", async () => {
			assertDedicatedDatabase(adminUrl);
			const admin = new RedisClient(adminUrl);
			await admin.connect();
			await admin.send("FLUSHDB", []);
			await admin.send("ACL", ["DELUSER", gatewayUser, userUser]);
			await createUser(
				admin,
				gatewayUser,
				gatewayPassword,
				"~crew:gateway:rate:v1:*",
			);
			await createUser(admin, userUser, userPassword, "~crew:user:rate:v1:*");

			const gateway = new RedisClient(
				authenticatedUrl(adminUrl, gatewayUser, gatewayPassword),
			);
			const user = new RedisClient(
				authenticatedUrl(adminUrl, userUser, userPassword),
			);
			try {
				await Promise.all([gateway.connect(), user.connect()]);
				const gatewayLimiter = new RedisRateLimiter(
					gateway,
					2,
					60_000,
					100,
					"gateway-boundary-hmac-secret-long-enough",
					1_000,
				);
				const userLimiter = new RedisAuthRateLimiter(
					user,
					{
						magicRequest: { windowMs: 60_000 },
						magicRedeem: { windowMs: 60_000 },
						refresh: { windowMs: 60_000 },
					},
					100,
					"user-boundary-hmac-secret-long-enough",
					1_000,
				);

				expect(await gatewayLimiter.consume("request:ip:unknown")).toEqual({
					allowed: true,
					remaining: 1,
				});
				expect(
					await userLimiter.consume("magicRequest", [
						{ key: "client:unknown", limit: 2 },
					]),
				).toEqual({ allowed: true });

				await expect(
					gateway.send("GET", ["crew:user:rate:v1:{user}:active"]),
				).rejects.toThrow();
				await expect(
					user.send("GET", ["crew:gateway:rate:v1:{gateway}:active"]),
				).rejects.toThrow();
				await expect(
					gateway.send("EVAL", [
						"return redis.call('GET', KEYS[1])",
						"1",
						"crew:user:rate:v1:{user}:active",
					]),
				).rejects.toThrow();
				await expect(
					gateway.send("EVAL", ["return redis.call('FLUSHDB')", "0"]),
				).rejects.toThrow();
				await expect(gateway.send("FLUSHDB", [])).rejects.toThrow();
				await expect(user.send("ACL", ["LIST"])).rejects.toThrow();

				const keys = (await admin.send("KEYS", [
					"crew:*:rate:v1:*",
				])) as string[];
				expect(
					keys.some((key) => key.startsWith("crew:gateway:rate:v1:")),
				).toBe(true);
				expect(keys.some((key) => key.startsWith("crew:user:rate:v1:"))).toBe(
					true,
				);
				expect(JSON.stringify(keys)).not.toContain("unknown");
			} finally {
				gateway.close();
				user.close();
				await admin.send("ACL", ["DELUSER", gatewayUser, userUser]);
				await admin.send("FLUSHDB", []);
				admin.close();
			}
		});
	});
}

async function createUser(
	admin: RedisClient,
	username: string,
	password: string,
	keyPattern: string,
) {
	await admin.send("ACL", [
		"SETUSER",
		username,
		"reset",
		"on",
		`>${password}`,
		"resetkeys",
		keyPattern,
		"resetchannels",
		"-@all",
		...commands,
	]);
}

function authenticatedUrl(url: string, username: string, password: string) {
	const parsed = new URL(url);
	parsed.username = username;
	parsed.password = password;
	return parsed.toString();
}

function assertDedicatedDatabase(url: string) {
	const parsed = new URL(url);
	if (
		!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
		parsed.pathname !== "/13"
	) {
		throw new Error("Redis ACL tests require loopback Redis database 13");
	}
}
