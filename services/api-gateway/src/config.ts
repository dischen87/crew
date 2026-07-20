import { z } from "zod";

const DEVELOPMENT_RATE_LIMIT_REDIS_URL = "redis://localhost:6379";
const DEVELOPMENT_RATE_LIMIT_KEY =
	"BAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg";
const KeyId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const ServiceKey = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const RedisUrl = z
	.string()
	.url()
	.refine((value) => {
		const protocol = new URL(value).protocol;
		return protocol === "redis:" || protocol === "rediss:";
	}, "Rate-limit store must use redis:// or rediss://");

const ConfigSchema = z
	.object({
		environment: z.enum(["development", "test", "production"]),
		host: z.string().min(1),
		port: z.coerce.number().int().min(1).max(65_535),
		userServiceUrl: z.string().url(),
		eventServiceUrl: z.string().url(),
		userTokenIssuer: z.string().min(1),
		userTokenAudience: z.string().min(1),
		userServiceJwksUrl: z.string().url(),
		jwksCacheMs: z.coerce.number().int().min(1_000).max(86_400_000),
		jwksCooldownMs: z.coerce.number().int().min(1_000).max(3_600_000),
		jwksTimeoutMs: z.coerce.number().int().min(100).max(30_000),
		downstreamTimeoutMs: z.coerce.number().int().min(100).max(30_000),
		rateLimitMax: z.coerce.number().int().min(1).max(100_000),
		rateLimitWindowMs: z.coerce.number().int().min(1_000).max(3_600_000),
		rateLimitMaxEntries: z.coerce.number().int().min(1).max(1_000_000),
		rateLimitRedisUrl: RedisUrl,
		rateLimitKey: ServiceKey,
		rateLimitConnectionTimeoutMs: z.coerce.number().int().min(100).max(10_000),
		rateLimitCommandTimeoutMs: z.coerce.number().int().min(10).max(5_000),
		memberDirectoryServiceIssuer: z.string().min(1).max(200),
		memberDirectoryServiceAudience: z.string().min(1).max(200),
		memberDirectoryServiceCurrentKeyId: KeyId,
		memberDirectoryServiceCurrentKey: ServiceKey,
	})
	.superRefine((value, context) => {
		if (value.rateLimitKey === value.memberDirectoryServiceCurrentKey) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Rate limiting must use a separate secret domain",
				path: ["rateLimitKey"],
			});
		}
		if (value.environment !== "production") return;
		const redisUrl = new URL(value.rateLimitRedisUrl);
		if (
			redisUrl.protocol !== "rediss:" ||
			!redisUrl.username ||
			!redisUrl.password
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					"Production rate-limit Redis must use TLS and authenticated ACL credentials",
				path: ["rateLimitRedisUrl"],
			});
		}
		if (value.rateLimitKey === DEVELOPMENT_RATE_LIMIT_KEY) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "RATE_LIMIT_KEY must be set in production",
				path: ["rateLimitKey"],
			});
		}
	});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(
	env: Record<string, string | undefined> = Bun.env,
): Config {
	const userServiceUrl = env.USER_SERVICE_URL ?? "http://localhost:3001";
	return ConfigSchema.parse({
		environment: env.NODE_ENV ?? "development",
		host: env.HOST ?? "0.0.0.0",
		port: env.PORT ?? "3000",
		userServiceUrl,
		eventServiceUrl: env.EVENT_SERVICE_URL ?? "http://localhost:3002",
		userTokenIssuer: env.USER_TOKEN_ISSUER ?? "crew-user-service",
		userTokenAudience: env.USER_TOKEN_AUDIENCE ?? "crew-mobile",
		userServiceJwksUrl:
			env.USER_SERVICE_JWKS_URL ??
			new URL("/.well-known/jwks.json", userServiceUrl).toString(),
		jwksCacheMs: env.JWKS_CACHE_MS ?? "300000",
		jwksCooldownMs: env.JWKS_COOLDOWN_MS ?? "30000",
		jwksTimeoutMs: env.JWKS_TIMEOUT_MS ?? "2000",
		downstreamTimeoutMs: env.DOWNSTREAM_TIMEOUT_MS ?? "3000",
		rateLimitMax: env.RATE_LIMIT_MAX ?? "120",
		rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS ?? "60000",
		rateLimitMaxEntries: env.RATE_LIMIT_MAX_ENTRIES ?? "10000",
		rateLimitRedisUrl:
			env.RATE_LIMIT_REDIS_URL ??
			env.REDIS_URL ??
			DEVELOPMENT_RATE_LIMIT_REDIS_URL,
		rateLimitKey: env.RATE_LIMIT_KEY ?? DEVELOPMENT_RATE_LIMIT_KEY,
		rateLimitConnectionTimeoutMs:
			env.RATE_LIMIT_CONNECTION_TIMEOUT_MS ?? "1000",
		rateLimitCommandTimeoutMs: env.RATE_LIMIT_COMMAND_TIMEOUT_MS ?? "250",
		memberDirectoryServiceIssuer:
			env.MEMBER_DIRECTORY_SERVICE_ISSUER ?? "crew-api-gateway",
		memberDirectoryServiceAudience:
			env.MEMBER_DIRECTORY_SERVICE_AUDIENCE ?? "crew-user-service",
		memberDirectoryServiceCurrentKeyId:
			env.MEMBER_DIRECTORY_SERVICE_CURRENT_KEY_ID ?? "development-gateway-1",
		memberDirectoryServiceCurrentKey:
			env.MEMBER_DIRECTORY_SERVICE_CURRENT_KEY ??
			"AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
	});
}
