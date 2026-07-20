import { createHmac } from "node:crypto";

export type AuthOperation = "magicRequest" | "magicRedeem" | "refresh";

export type RateLimitDecision =
	| { allowed: true }
	| { allowed: false; retryAfterSeconds: number };

export interface AuthRateLimiter {
	consume(
		operation: AuthOperation,
		scopes: readonly { key: string; limit: number }[],
		now?: number,
	): RateLimitDecision | Promise<RateLimitDecision>;
}

type Policy = { windowMs: number };
type RedisCommands = {
	send(command: string, args: string[]): Promise<unknown>;
};

const ACTIVE_KEY = "crew:user:rate:v1:{user}:active";
const BUCKET_PREFIX = "crew:user:rate:v1:{user}:bucket:";
const CONSUME_SCRIPT = `
local active_key = KEYS[1]
local max_entries = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local scope_count = tonumber(ARGV[3])
local clock = redis.call('TIME')
local now_ms = (tonumber(clock[1]) * 1000) + math.floor(tonumber(clock[2]) / 1000)
local ttls = {}
local new_count = 0
local function expire_active_index()
  local latest = redis.call('ZRANGE', active_key, -1, -1, 'WITHSCORES')
  if latest[2] then
    redis.call('PEXPIREAT', active_key, math.ceil(tonumber(latest[2])))
  end
end

redis.call('ZREMRANGEBYSCORE', active_key, '-inf', now_ms)
for index = 1, scope_count do
  local ttl_ms = redis.call('PTTL', KEYS[index + 1])
  ttls[index] = ttl_ms
  local arg_index = 4 + ((index - 1) * 2)
  local member = ARGV[arg_index + 1]
  if ttl_ms < 1 then
    new_count = new_count + 1
  else
    redis.call('ZADD', active_key, now_ms + ttl_ms, member)
  end
end

if redis.call('ZCARD', active_key) + new_count > max_entries then
  local earliest = redis.call('ZRANGE', active_key, 0, 0, 'WITHSCORES')
  local retry_ms = window_ms
  if earliest[2] then
    retry_ms = math.max(1, tonumber(earliest[2]) - now_ms)
  end
  return {0, retry_ms}
end

local blocked_retry_ms = 0
for index = 1, scope_count do
  if ttls[index] > 0 then
    local count = tonumber(redis.call('GET', KEYS[index + 1]))
    local arg_index = 4 + ((index - 1) * 2)
    local limit = tonumber(ARGV[arg_index])
    if count >= limit then
      blocked_retry_ms = math.max(blocked_retry_ms, ttls[index])
    end
  end
end
if blocked_retry_ms > 0 then
	expire_active_index()
  return {0, blocked_retry_ms}
end

for index = 1, scope_count do
  local arg_index = 4 + ((index - 1) * 2)
  local member = ARGV[arg_index + 1]
  if ttls[index] < 1 then
    redis.call('SET', KEYS[index + 1], 1, 'PX', window_ms)
    redis.call('ZADD', active_key, now_ms + window_ms, member)
  else
    redis.call('INCR', KEYS[index + 1])
  end
end
expire_active_index()
return {1, 0}
`;

export class MemoryAuthRateLimiter implements AuthRateLimiter {
	private readonly buckets = new Map<
		string,
		{ count: number; windowStartedAt: number; windowMs: number }
	>();

	constructor(
		private readonly policies: Record<AuthOperation, Policy>,
		private readonly maxEntries: number,
	) {
		if (maxEntries < 2) throw new Error("Rate limiter requires two entries");
	}

	consume(
		operation: AuthOperation,
		scopes: readonly { key: string; limit: number }[],
		now = Date.now(),
	): RateLimitDecision {
		const policy = this.policies[operation];
		this.pruneExpired(now);
		const limits = new Map<string, number>();
		for (const scope of scopes) {
			if (!Number.isInteger(scope.limit) || scope.limit < 1)
				throw new Error("Rate-limit scope requires a positive integer limit");
			const key = `${operation}:${scope.key}`;
			limits.set(key, Math.min(limits.get(key) ?? scope.limit, scope.limit));
		}
		const newKeys = [...limits.keys()].filter((key) => !this.buckets.has(key));
		if (this.buckets.size + newKeys.length > this.maxEntries) {
			return {
				allowed: false,
				retryAfterSeconds: this.capacityRetryAfter(now),
			};
		}

		const buckets = [...limits].map(([key, limit]) => ({
			limit,
			bucket: this.buckets.get(key) ?? {
				count: 0,
				windowStartedAt: now,
				windowMs: policy.windowMs,
			},
			key,
		}));

		const blocked = buckets.filter(
			({ bucket, limit }) => bucket.count >= limit,
		);
		if (blocked.length) {
			return {
				allowed: false,
				retryAfterSeconds: Math.max(
					1,
					...blocked.map(({ bucket }) =>
						Math.ceil(
							(bucket.windowMs - (now - bucket.windowStartedAt)) / 1_000,
						),
					),
				),
			};
		}

		for (const entry of buckets) {
			entry.bucket.count += 1;
			this.buckets.set(entry.key, entry.bucket);
		}
		return { allowed: true };
	}

	private pruneExpired(now: number) {
		for (const [key, bucket] of this.buckets) {
			if (now - bucket.windowStartedAt >= bucket.windowMs) {
				this.buckets.delete(key);
			}
		}
	}

	private capacityRetryAfter(now: number) {
		let earliest = Number.POSITIVE_INFINITY;
		for (const bucket of this.buckets.values()) {
			earliest = Math.min(
				earliest,
				bucket.windowMs - (now - bucket.windowStartedAt),
			);
		}
		return Number.isFinite(earliest)
			? Math.max(1, Math.ceil(earliest / 1_000))
			: 1;
	}
}

export class RedisAuthRateLimiter implements AuthRateLimiter {
	constructor(
		private readonly redis: RedisCommands,
		private readonly policies: Record<AuthOperation, Policy>,
		private readonly maxEntries: number,
		private readonly keySecret: string,
		private readonly commandTimeoutMs: number,
	) {
		if (
			!Number.isInteger(maxEntries) ||
			maxEntries < 2 ||
			keySecret.length < 32 ||
			!Number.isInteger(commandTimeoutMs) ||
			commandTimeoutMs < 1 ||
			Object.values(policies).some(
				({ windowMs }) => !Number.isInteger(windowMs) || windowMs < 1,
			)
		) {
			throw new Error("Invalid Redis auth rate-limit configuration");
		}
	}

	async consume(
		operation: AuthOperation,
		scopes: readonly { key: string; limit: number }[],
		_now?: number,
	): Promise<RateLimitDecision> {
		const limits = new Map<string, { digest: string; limit: number }>();
		for (const scope of scopes) {
			if (!Number.isInteger(scope.limit) || scope.limit < 1) {
				throw new Error("Rate-limit scope requires a positive integer limit");
			}
			const digest = createHmac("sha256", this.keySecret)
				.update(`${operation}\0${scope.key}`)
				.digest("hex");
			const current = limits.get(digest);
			limits.set(digest, {
				digest,
				limit: Math.min(current?.limit ?? scope.limit, scope.limit),
			});
		}
		if (limits.size === 0) {
			throw new Error("At least one rate-limit scope is required");
		}
		const entries = [...limits.values()];
		try {
			const result = await withTimeout(
				this.redis.send("EVAL", [
					CONSUME_SCRIPT,
					String(entries.length + 1),
					ACTIVE_KEY,
					...entries.map(({ digest }) => `${BUCKET_PREFIX}${digest}`),
					String(this.maxEntries),
					String(this.policies[operation].windowMs),
					String(entries.length),
					...entries.flatMap(({ digest, limit }) => [String(limit), digest]),
				]),
				this.commandTimeoutMs,
			);
			return authDecision(result);
		} catch {
			throw new RateLimiterUnavailableError();
		}
	}
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("Rate-limit command timed out")),
			timeoutMs,
		);
		operation.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			() => {
				clearTimeout(timer);
				reject(new Error("Rate-limit command failed"));
			},
		);
	});
}

export class RateLimiterUnavailableError extends Error {
	constructor() {
		super("Rate-limit store is unavailable");
		this.name = "RateLimiterUnavailableError";
	}
}

function authDecision(value: unknown): RateLimitDecision {
	if (!Array.isArray(value) || value.length !== 2) {
		throw new Error("Invalid Redis auth rate-limit response");
	}
	const allowed = Number(value[0]);
	const retryMs = Number(value[1]);
	if (
		(allowed !== 0 && allowed !== 1) ||
		!Number.isFinite(retryMs) ||
		retryMs < 0 ||
		(allowed === 0 && retryMs < 1)
	) {
		throw new Error("Invalid Redis auth rate-limit response");
	}
	return allowed === 1
		? { allowed: true }
		: {
				allowed: false,
				retryAfterSeconds: Math.max(1, Math.ceil(retryMs / 1_000)),
			};
}
