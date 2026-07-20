import { describe, expect, test } from "bun:test";
import {
	RateLimiterUnavailableError,
	RedisRateLimiter,
} from "./redis-rate-limit";
import { MemoryRateLimiter } from "./security";

describe("RedisRateLimiter boundary", () => {
	test("uses one cluster slot and never sends a raw client key", async () => {
		let command = "";
		let args: string[] = [];
		const limiter = new RedisRateLimiter(
			{
				async send(nextCommand, nextArgs) {
					command = nextCommand;
					args = nextArgs;
					return [1, 0, 60_000];
				},
			},
			1,
			60_000,
			10,
			"test-gateway-rate-limit-key-that-is-long-enough",
			100,
		);
		const rawKey = "request:ip:unknown";

		expect(await limiter.consume(rawKey)).toEqual({
			allowed: true,
			remaining: 0,
		});
		expect(command).toBe("EVAL");
		expect(args[1]).toBe("2");
		expect(args[2]).toContain("{gateway}");
		expect(args[3]).toContain("{gateway}");
		expect(JSON.stringify(args.slice(2))).not.toContain(rawKey);
		expect(JSON.stringify(args.slice(2))).not.toContain("unknown");
	});

	test("bounds a stalled Redis command and returns only a safe failure", async () => {
		const limiter = new RedisRateLimiter(
			{ send: () => new Promise(() => {}) },
			1,
			60_000,
			10,
			"test-gateway-rate-limit-key-that-is-long-enough",
			10,
		);
		const startedAt = Date.now();

		await expect(
			limiter.consume("request:ip:198.51.100.9"),
		).rejects.toBeInstanceOf(RateLimiterUnavailableError);
		expect(Date.now() - startedAt).toBeLessThan(250);
	});
});

describe("MemoryRateLimiter test seam", () => {
	test("fails closed at capacity without evicting active clients", () => {
		const limiter = new MemoryRateLimiter(2, 60_000, 2);

		expect(limiter.consume("first", 0)).toEqual({
			allowed: true,
			remaining: 1,
		});
		expect(limiter.consume("second", 0)).toMatchObject({ allowed: true });
		expect(limiter.consume("attacker", 0)).toEqual({
			allowed: false,
			retryAfterSeconds: 60,
		});
		expect(limiter.consume("first", 0)).toEqual({
			allowed: true,
			remaining: 0,
		});
	});
});
