import { createHmac } from "node:crypto";
import type { RateLimitDecision, RateLimiter } from "./security";

type RedisCommands = {
	send(command: string, args: string[]): Promise<unknown>;
};

const ACTIVE_KEY = "crew:gateway:rate:v1:{gateway}:active";
const BUCKET_PREFIX = "crew:gateway:rate:v1:{gateway}:bucket:";

const CONSUME_SCRIPT = `
local active_key = KEYS[1]
local bucket_key = KEYS[2]
local limit = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local max_entries = tonumber(ARGV[3])
local member = ARGV[4]
local clock = redis.call('TIME')
local now_ms = (tonumber(clock[1]) * 1000) + math.floor(tonumber(clock[2]) / 1000)
local function expire_active_index()
  local latest = redis.call('ZRANGE', active_key, -1, -1, 'WITHSCORES')
  if latest[2] then
    redis.call('PEXPIREAT', active_key, math.ceil(tonumber(latest[2])))
  end
end

redis.call('ZREMRANGEBYSCORE', active_key, '-inf', now_ms)
local ttl_ms = redis.call('PTTL', bucket_key)

if ttl_ms < 1 then
  if redis.call('ZCARD', active_key) >= max_entries then
    local earliest = redis.call('ZRANGE', active_key, 0, 0, 'WITHSCORES')
    local retry_ms = window_ms
    if earliest[2] then
      retry_ms = math.max(1, tonumber(earliest[2]) - now_ms)
    end
    return {0, 0, retry_ms}
  end
  redis.call('SET', bucket_key, 1, 'PX', window_ms)
  redis.call('ZADD', active_key, now_ms + window_ms, member)
  expire_active_index()
  return {1, limit - 1, window_ms}
end

redis.call('ZADD', active_key, now_ms + ttl_ms, member)
expire_active_index()
local count = tonumber(redis.call('GET', bucket_key))
if count >= limit then
  return {0, 0, ttl_ms}
end
count = redis.call('INCR', bucket_key)
return {1, limit - count, ttl_ms}
`;

export class RedisRateLimiter implements RateLimiter {
	constructor(
		private readonly redis: RedisCommands,
		private readonly limit: number,
		private readonly windowMs: number,
		private readonly maxEntries: number,
		private readonly keySecret: string,
		private readonly commandTimeoutMs: number,
	) {
		if (
			!Number.isInteger(limit) ||
			limit < 1 ||
			!Number.isInteger(windowMs) ||
			windowMs < 1 ||
			!Number.isInteger(maxEntries) ||
			maxEntries < 1 ||
			keySecret.length < 32 ||
			!Number.isInteger(commandTimeoutMs) ||
			commandTimeoutMs < 1
		) {
			throw new Error("Invalid Redis rate-limit configuration");
		}
	}

	async consume(key: string, _now?: number): Promise<RateLimitDecision> {
		const digest = createHmac("sha256", this.keySecret)
			.update(key)
			.digest("hex");
		try {
			const result = await withTimeout(
				this.redis.send("EVAL", [
					CONSUME_SCRIPT,
					"2",
					ACTIVE_KEY,
					`${BUCKET_PREFIX}${digest}`,
					String(this.limit),
					String(this.windowMs),
					String(this.maxEntries),
					digest,
				]),
				this.commandTimeoutMs,
			);
			return decision(result);
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

function decision(value: unknown): RateLimitDecision {
	if (!Array.isArray(value) || value.length !== 3) {
		throw new Error("Invalid Redis rate-limit response");
	}
	const allowed = Number(value[0]);
	const remaining = Number(value[1]);
	const ttlMs = Number(value[2]);
	if (
		(allowed !== 0 && allowed !== 1) ||
		!Number.isSafeInteger(remaining) ||
		remaining < 0 ||
		!Number.isFinite(ttlMs) ||
		ttlMs < 1
	) {
		throw new Error("Invalid Redis rate-limit response");
	}
	return allowed === 1
		? { allowed: true, remaining }
		: {
				allowed: false,
				retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1_000)),
			};
}
