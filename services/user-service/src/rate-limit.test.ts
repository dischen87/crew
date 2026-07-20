import { describe, expect, test } from "bun:test";
import {
	MemoryAuthRateLimiter,
	RateLimiterUnavailableError,
	RedisAuthRateLimiter,
} from "./rate-limit";

describe("MemoryAuthRateLimiter", () => {
	test("fails closed under cardinality churn without evicting active scopes", () => {
		const limiter = new MemoryAuthRateLimiter(
			{
				magicRequest: { windowMs: 60_000 },
				magicRedeem: { windowMs: 60_000 },
				refresh: { windowMs: 60_000 },
			},
			2,
		);
		const protectedScopes = [
			{ key: "client:protected", limit: 2 },
			{ key: "email:protected", limit: 2 },
		];

		expect(limiter.consume("magicRequest", protectedScopes, 0)).toEqual({
			allowed: true,
		});
		expect(
			limiter.consume(
				"magicRequest",
				[
					{ key: "client:attacker", limit: 100 },
					{ key: "email:attacker", limit: 100 },
				],
				1,
			),
		).toEqual({ allowed: false, retryAfterSeconds: 60 });
		expect(limiter.consume("magicRequest", protectedScopes, 2)).toEqual({
			allowed: true,
		});
		expect(limiter.consume("magicRequest", protectedScopes, 3)).toEqual({
			allowed: false,
			retryAfterSeconds: 60,
		});
		expect(
			limiter.consume(
				"magicRequest",
				[
					{ key: "client:after-expiry", limit: 1 },
					{ key: "email:after-expiry", limit: 1 },
				],
				60_001,
			),
		).toEqual({ allowed: true });
	});
});

describe("RedisAuthRateLimiter boundary", () => {
	const policies = {
		magicRequest: { windowMs: 60_000 },
		magicRedeem: { windowMs: 60_000 },
		refresh: { windowMs: 60_000 },
	} as const;

	test("uses one cluster slot and never sends raw auth scopes", async () => {
		let command = "";
		let args: string[] = [];
		const limiter = new RedisAuthRateLimiter(
			{
				async send(nextCommand, nextArgs) {
					command = nextCommand;
					args = nextArgs;
					return [1, 0];
				},
			},
			policies,
			10,
			"test-user-rate-limit-key-that-is-long-enough",
			100,
		);
		const rawScopes = [
			{ key: "client:unknown", limit: 3 },
			{ key: "email:private@example.test", limit: 2 },
		];

		expect(await limiter.consume("magicRequest", rawScopes)).toEqual({
			allowed: true,
		});
		expect(command).toBe("EVAL");
		expect(args[1]).toBe("3");
		for (const key of args.slice(2, 5)) expect(key).toContain("{user}");
		const durableInput = JSON.stringify(args.slice(2));
		expect(durableInput).not.toContain("unknown");
		expect(durableInput).not.toContain("private@example.test");
	});

	test("bounds a stalled Redis command and returns only a safe failure", async () => {
		const limiter = new RedisAuthRateLimiter(
			{ send: () => new Promise(() => {}) },
			policies,
			10,
			"test-user-rate-limit-key-that-is-long-enough",
			10,
		);
		const startedAt = Date.now();

		await expect(
			limiter.consume("magicRequest", [{ key: "client:one", limit: 1 }]),
		).rejects.toBeInstanceOf(RateLimiterUnavailableError);
		expect(Date.now() - startedAt).toBeLessThan(250);
	});
});
