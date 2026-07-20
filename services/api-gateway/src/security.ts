import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { GatewayEnv } from "./http";
import { ServiceError } from "./http";

export type Actor = { id: string };
export type VerifyUserToken = (token: string) => Promise<Actor>;

export function createJwtVerifier(options: {
	jwksUrl: string;
	issuer: string;
	audience: string;
	cacheMaxAge: number;
	cooldownDuration: number;
	timeoutDuration: number;
}): VerifyUserToken {
	const jwks = createRemoteJWKSet(new URL(options.jwksUrl), {
		cacheMaxAge: options.cacheMaxAge,
		cooldownDuration: options.cooldownDuration,
		timeoutDuration: options.timeoutDuration,
	});

	return async (token) => {
		const { payload } = await jwtVerify(token, jwks, {
			algorithms: ["RS256"],
			issuer: options.issuer,
			audience: options.audience,
			requiredClaims: ["sub", "exp"],
		});
		if (
			typeof payload.sub !== "string" ||
			!/^usr_[a-f0-9]{32}$/.test(payload.sub)
		) {
			throw new Error("Invalid token subject");
		}
		return { id: payload.sub };
	};
}

export function userAuthMiddleware(
	verify: VerifyUserToken,
	beforeVerify?: (context: Context<GatewayEnv>) => void | Promise<void>,
) {
	return createMiddleware<GatewayEnv>(async (c, next) => {
		await beforeVerify?.(c);
		const authorization = c.req.header("authorization");
		const token = /^Bearer ([^\s]+)$/i.exec(authorization ?? "")?.[1];
		try {
			if (!token) throw new Error("Missing bearer token");
			c.set("actor", await verify(token));
			c.set("userAuthorization", authorization);
		} catch {
			throw new ServiceError(
				401,
				"UNAUTHENTICATED",
				"Authentication is required.",
			);
		}
		await next();
	});
}

export type RateLimitDecision =
	| { allowed: true; remaining: number }
	| { allowed: false; retryAfterSeconds: number };

export interface RateLimiter {
	consume(
		key: string,
		now?: number,
	): RateLimitDecision | Promise<RateLimitDecision>;
}

// Test and contract-generation seam only. Production injects RedisRateLimiter.
export class MemoryRateLimiter implements RateLimiter {
	private readonly buckets = new Map<
		string,
		{ count: number; windowStartedAt: number }
	>();

	constructor(
		private readonly limit: number,
		private readonly windowMs: number,
		private readonly maxEntries: number,
	) {}

	consume(key: string, now = Date.now()): RateLimitDecision {
		for (const [candidate, value] of this.buckets) {
			if (now - value.windowStartedAt >= this.windowMs) {
				this.buckets.delete(candidate);
			}
		}
		let bucket = this.buckets.get(key);
		if (!bucket) {
			if (this.buckets.size >= this.maxEntries) {
				const retryMs = Math.min(
					...Array.from(this.buckets.values(), (value) =>
						Math.max(1, this.windowMs - (now - value.windowStartedAt)),
					),
				);
				return {
					allowed: false,
					retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1_000)),
				};
			}
			bucket = { count: 0, windowStartedAt: now };
			this.buckets.set(key, bucket);
		}

		if (bucket.count >= this.limit) {
			return {
				allowed: false,
				retryAfterSeconds: Math.max(
					1,
					Math.ceil((this.windowMs - (now - bucket.windowStartedAt)) / 1_000),
				),
			};
		}

		bucket.count += 1;
		return { allowed: true, remaining: this.limit - bucket.count };
	}
}

export type ClientIp = (context: Context<GatewayEnv>) => string;

function bunClientIp(context: Context<GatewayEnv>): string {
	try {
		return getConnInfo(context).remote.address ?? "unknown";
	} catch {
		return "unknown";
	}
}

export function rateLimitMiddleware(
	limiter: RateLimiter,
	clientIp?: ClientIp,
	scope = "request",
) {
	return createMiddleware<GatewayEnv>(async (c, next) => {
		await enforceRateLimit(c, limiter, clientIp, scope);
		await next();
	});
}

export async function enforceRateLimit(
	context: Context<GatewayEnv>,
	limiter: RateLimiter,
	clientIp?: ClientIp,
	scope = "request",
): Promise<void> {
	const actor = context.get("actor");
	const key = actor
		? `${scope}:principal:${actor.id}`
		: `${scope}:ip:${(clientIp ?? bunClientIp)(context)}`;
	let decision: RateLimitDecision;
	try {
		decision = await limiter.consume(key);
	} catch {
		throw new ServiceError(
			503,
			"SERVICE_UNAVAILABLE",
			"Service is temporarily unavailable.",
			true,
			undefined,
			{ "Retry-After": "1" },
		);
	}
	if (!decision.allowed) {
		throw new ServiceError(
			429,
			"RATE_LIMITED",
			"Too many requests.",
			true,
			undefined,
			{ "Retry-After": String(decision.retryAfterSeconds) },
		);
	}
}
