import { RedisClient } from "bun";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { RedisRateLimiter } from "./redis-rate-limit";

const config = loadConfig();
const redis = new RedisClient(config.rateLimitRedisUrl, {
	connectionTimeout: config.rateLimitConnectionTimeoutMs,
	enableOfflineQueue: false,
	maxRetries: 1,
});
try {
	await redis.connect();
} catch {
	throw new Error("Gateway rate-limit store is unavailable");
}
const app = createApp({
	config,
	authenticationRateLimiter: new RedisRateLimiter(
		redis,
		config.authenticationRateLimitMax,
		config.rateLimitWindowMs,
		config.rateLimitMaxEntries,
		config.rateLimitKey,
		config.rateLimitCommandTimeoutMs,
	),
	rateLimiter: new RedisRateLimiter(
		redis,
		config.rateLimitMax,
		config.rateLimitWindowMs,
		config.rateLimitMaxEntries,
		config.rateLimitKey,
		config.rateLimitCommandTimeoutMs,
	),
	readiness: async () => {
		try {
			return (await redis.send("PING", [])) === "PONG";
		} catch {
			return false;
		}
	},
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		redis.close();
		process.exit(0);
	});
}

console.info(`Crew API gateway listening on ${config.host}:${config.port}`);

export default { hostname: config.host, port: config.port, fetch: app.fetch };
