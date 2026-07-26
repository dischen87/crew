import { isIP } from "node:net";
import { z } from "zod";
import { isDeliveryPayloadKey } from "./delivery-payload";

const DEVELOPMENT_REFRESH_KEY = "crew-development-refresh-key-change-me";
const DEVELOPMENT_IDEMPOTENCY_PAYLOAD_KEY =
	"crew-development-idempotency-payload-key-change-me";
const DEVELOPMENT_DATABASE_URL =
	"postgres://crew_user:crew_user@localhost:5433/crew_user";
const DEVELOPMENT_RATE_LIMIT_REDIS_URL = "redis://localhost:6379";
const DEVELOPMENT_RATE_LIMIT_KEY =
	"DAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg";
const DEVELOPMENT_DELIVERY_PAYLOAD_KEY =
	"eKOfuEuHFGQeOZltcgU4hlzp3jYpRNrp3xvjzwjJkSE";
const DEVELOPMENT_PUSH_PAYLOAD_KEY =
	"TxsYmFtlYMVPT1UZKmSGicjfoc8lhZ0kGQ3FgIZavhs";
const DEVELOPMENT_EVENT_NOTIFICATION_SERVICE_AUTH_KEY =
	"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const DEVELOPMENT_MEMBER_DIRECTORY_SERVICE_AUTH_KEY =
	"AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI";
const DEFAULT_MAGIC_LINK_APP_URL = "https://crew-haus.com/auth/redeem";
const PUSH_DELIVERY_ACK_BUFFER_MS = 250;

const Environment = z.enum(["development", "test", "production"]);
const KeyId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const PayloadKey = z.string().refine(isDeliveryPayloadKey);
const IpAddress = z.string().refine((value) => isIP(value) !== 0, "Invalid IP");
const RedisUrl = z
	.string()
	.url()
	.refine((value) => {
		const protocol = new URL(value).protocol;
		return protocol === "redis:" || protocol === "rediss:";
	}, "Rate-limit store must use redis:// or rediss://");

const ConfigSchema = z
	.object({
		environment: Environment,
		host: z.string().min(1),
		port: z.coerce.number().int().min(1).max(65_535),
		databaseUrl: z.string().url(),
		jwtIssuer: z.string().min(1),
		jwtAudience: z.string().min(1),
		jwtKeyId: KeyId,
		jwtPrivateKeyPath: z.string().min(1),
		jwtPublicKeyPath: z.string().min(1),
		jwtPreviousKeyId: KeyId.optional(),
		jwtPreviousPublicKeyPath: z.string().min(1).optional(),
		accessTokenTtlSeconds: z.coerce.number().int().min(60).max(3_600),
		refreshTokenTtlSeconds: z.coerce.number().int().min(3_600).max(31_536_000),
		refreshTokenKey: z.string().min(32),
		rateLimitRedisUrl: RedisUrl,
		rateLimitKey: PayloadKey,
		rateLimitMaxEntries: z.coerce.number().int().min(2).max(1_000_000),
		rateLimitConnectionTimeoutMs: z.coerce.number().int().min(100).max(10_000),
		rateLimitCommandTimeoutMs: z.coerce.number().int().min(10).max(5_000),
		trustedGatewayIp: IpAddress.optional(),
		idempotencyPayloadCurrentKeyId: KeyId,
		idempotencyPayloadCurrentKey: z.string().min(32).max(512),
		idempotencyPayloadPreviousKeyId: KeyId.optional(),
		idempotencyPayloadPreviousKey: z.string().min(32).max(512).optional(),
		magicLinkTtlSeconds: z.coerce.number().int().min(60).max(3_600),
		magicLinkAppUrl: z.string().url(),
		deliveryPayloadCurrentKeyId: KeyId,
		deliveryPayloadCurrentKey: PayloadKey,
		pushPayloadCurrentKeyId: KeyId,
		pushPayloadCurrentKey: PayloadKey,
		eventNotificationServiceIssuer: z.string().min(1).max(200),
		eventNotificationServiceAudience: z.string().min(1).max(200),
		eventNotificationServiceCurrentKeyId: KeyId,
		eventNotificationServiceCurrentKey: PayloadKey,
		eventNotificationServicePreviousKeyId: KeyId.optional(),
		eventNotificationServicePreviousKey: PayloadKey.optional(),
		memberDirectoryServiceIssuer: z.string().min(1).max(200),
		memberDirectoryServiceAudience: z.string().min(1).max(200),
		memberDirectoryServiceCurrentKeyId: KeyId,
		memberDirectoryServiceCurrentKey: PayloadKey,
		memberDirectoryServicePreviousKeyId: KeyId.optional(),
		memberDirectoryServicePreviousKey: PayloadKey.optional(),
	})
	.superRefine((value, context) => {
		validateOptionalKeyPair(
			value.idempotencyPayloadPreviousKeyId,
			value.idempotencyPayloadPreviousKey,
			"IDEMPOTENCY_PAYLOAD_PREVIOUS_KEY",
			"idempotencyPayloadPreviousKeyId",
			context,
		);
		if (
			value.idempotencyPayloadPreviousKeyId ===
			value.idempotencyPayloadCurrentKeyId
		) {
			issue(
				context,
				"Idempotency payload key IDs must be unique",
				"idempotencyPayloadPreviousKeyId",
			);
		}
		if (
			value.idempotencyPayloadPreviousKey === value.idempotencyPayloadCurrentKey
		) {
			issue(
				context,
				"Idempotency payload key material must be unique",
				"idempotencyPayloadPreviousKey",
			);
		}
		if (
			Boolean(value.jwtPreviousKeyId) !==
			Boolean(value.jwtPreviousPublicKeyPath)
		) {
			issue(
				context,
				"JWT_PREVIOUS_KEY_ID and JWT_PREVIOUS_PUBLIC_KEY_PATH must be set together",
				"jwtPreviousKeyId",
			);
		}
		if (value.jwtPreviousKeyId === value.jwtKeyId) {
			issue(
				context,
				"JWT verification key IDs must be unique",
				"jwtPreviousKeyId",
			);
		}
		validateOptionalKeyPair(
			value.eventNotificationServicePreviousKeyId,
			value.eventNotificationServicePreviousKey,
			"EVENT_NOTIFICATION_SERVICE_PREVIOUS_KEY",
			"eventNotificationServicePreviousKeyId",
			context,
		);
		if (
			value.eventNotificationServicePreviousKeyId ===
			value.eventNotificationServiceCurrentKeyId
		) {
			issue(
				context,
				"Service-auth key IDs must be unique",
				"eventNotificationServicePreviousKeyId",
			);
		}
		if (
			value.eventNotificationServicePreviousKey ===
			value.eventNotificationServiceCurrentKey
		) {
			issue(
				context,
				"Current and previous event-notification service-auth keys must differ",
				"eventNotificationServicePreviousKey",
			);
		}
		validateOptionalKeyPair(
			value.memberDirectoryServicePreviousKeyId,
			value.memberDirectoryServicePreviousKey,
			"MEMBER_DIRECTORY_SERVICE_PREVIOUS_KEY",
			"memberDirectoryServicePreviousKeyId",
			context,
		);
		if (
			value.memberDirectoryServicePreviousKeyId ===
			value.memberDirectoryServiceCurrentKeyId
		) {
			issue(
				context,
				"Service-auth key IDs must be unique",
				"memberDirectoryServicePreviousKeyId",
			);
		}
		if (
			value.memberDirectoryServicePreviousKey ===
			value.memberDirectoryServiceCurrentKey
		) {
			issue(
				context,
				"Current and previous member-directory service-auth keys must differ",
				"memberDirectoryServicePreviousKey",
			);
		}
		const eventNotificationKeys = [
			value.eventNotificationServiceCurrentKey,
			value.eventNotificationServicePreviousKey,
		];
		const memberDirectoryKeys = [
			value.memberDirectoryServiceCurrentKey,
			value.memberDirectoryServicePreviousKey,
		];
		if (
			eventNotificationKeys.some(
				(eventKey) =>
					eventKey !== undefined && memberDirectoryKeys.includes(eventKey),
			)
		) {
			issue(
				context,
				"Event-notification and member-directory service auth must use separate secret domains",
				"memberDirectoryServiceCurrentKey",
			);
		}
		const deliveryDomainKeys = [
			value.deliveryPayloadCurrentKey,
			value.pushPayloadCurrentKey,
			...eventNotificationKeys,
			...memberDirectoryKeys,
		].filter((key): key is string => key !== undefined);
		if (new Set(deliveryDomainKeys).size !== deliveryDomainKeys.length) {
			issue(
				context,
				"Delivery, push and service-auth keys must use separate secret domains",
				"pushPayloadCurrentKey",
			);
		}
		const idempotencyKeys = [
			value.idempotencyPayloadCurrentKey,
			value.idempotencyPayloadPreviousKey,
		];
		const otherSecretDomains = [
			value.refreshTokenKey,
			value.deliveryPayloadCurrentKey,
			value.pushPayloadCurrentKey,
			...eventNotificationKeys,
			...memberDirectoryKeys,
		];
		if (
			idempotencyKeys.some(
				(key) => key !== undefined && otherSecretDomains.includes(key),
			)
		) {
			issue(
				context,
				"Idempotency payload encryption must use a separate secret domain",
				"idempotencyPayloadCurrentKey",
			);
		}
		if (
			[
				value.refreshTokenKey,
				...idempotencyKeys,
				...otherSecretDomains.slice(1),
			].includes(value.rateLimitKey)
		) {
			issue(
				context,
				"Rate limiting must use a separate secret domain",
				"rateLimitKey",
			);
		}
		if (value.environment !== "production") return;
		const redisUrl = new URL(value.rateLimitRedisUrl);
		if (
			redisUrl.protocol !== "rediss:" ||
			!redisUrl.username ||
			!redisUrl.password
		) {
			issue(
				context,
				"Production rate-limit Redis must use TLS and authenticated ACL credentials",
				"rateLimitRedisUrl",
			);
		}
		if (value.rateLimitKey === DEVELOPMENT_RATE_LIMIT_KEY) {
			issue(
				context,
				"RATE_LIMIT_KEY must be set in production",
				"rateLimitKey",
			);
		}
		if (new URL(value.magicLinkAppUrl).protocol !== "https:") {
			issue(
				context,
				"MAGIC_LINK_APP_URL must use HTTPS in production",
				"magicLinkAppUrl",
			);
		}
		if (value.refreshTokenKey === DEVELOPMENT_REFRESH_KEY) {
			issue(
				context,
				"REFRESH_TOKEN_KEY must be set in production",
				"refreshTokenKey",
			);
		}
		if (
			value.idempotencyPayloadCurrentKey ===
				DEVELOPMENT_IDEMPOTENCY_PAYLOAD_KEY ||
			value.idempotencyPayloadPreviousKey ===
				DEVELOPMENT_IDEMPOTENCY_PAYLOAD_KEY
		) {
			issue(
				context,
				"IDEMPOTENCY_PAYLOAD_CURRENT_KEY and previous key must not use development material in production",
				"idempotencyPayloadCurrentKey",
			);
		}
		if (value.databaseUrl === DEVELOPMENT_DATABASE_URL) {
			issue(context, "DATABASE_URL must be set in production", "databaseUrl");
		}
		if (value.deliveryPayloadCurrentKey === DEVELOPMENT_DELIVERY_PAYLOAD_KEY) {
			issue(
				context,
				"DELIVERY_PAYLOAD_CURRENT_KEY must be set in production",
				"deliveryPayloadCurrentKey",
			);
		}
		if (value.pushPayloadCurrentKey === DEVELOPMENT_PUSH_PAYLOAD_KEY) {
			issue(
				context,
				"PUSH_PAYLOAD_CURRENT_KEY must be set in production",
				"pushPayloadCurrentKey",
			);
		}
		if (
			value.eventNotificationServiceCurrentKey ===
			DEVELOPMENT_EVENT_NOTIFICATION_SERVICE_AUTH_KEY
		) {
			issue(
				context,
				"EVENT_NOTIFICATION_SERVICE_CURRENT_KEY must be set in production",
				"eventNotificationServiceCurrentKey",
			);
		}
		if (
			value.memberDirectoryServiceCurrentKey ===
			DEVELOPMENT_MEMBER_DIRECTORY_SERVICE_AUTH_KEY
		) {
			issue(
				context,
				"MEMBER_DIRECTORY_SERVICE_CURRENT_KEY must be set in production",
				"memberDirectoryServiceCurrentKey",
			);
		}
	});

const DeliveryWorkerConfigSchema = z
	.object({
		environment: Environment,
		databaseUrl: z.string().url(),
		magicLinkAppUrl: z.string().url(),
		magicLinkDeliveryUrl: z.string().url(),
		magicLinkDeliveryBearer: z.string().min(16),
		deliveryPayloadCurrentKeyId: KeyId,
		deliveryPayloadCurrentKey: PayloadKey,
		deliveryPayloadPreviousKeyId: KeyId.optional(),
		deliveryPayloadPreviousKey: PayloadKey.optional(),
		deliveryWorkerBatchSize: z.coerce.number().int().min(1).max(100),
		deliveryWorkerLeaseMs: z.coerce.number().int().min(1_000).max(300_000),
		deliveryTimeoutMs: z.coerce.number().int().min(100).max(60_000),
		deliveryWorkerPollMs: z.coerce.number().int().min(50).max(60_000),
		deliveryMaxAttempts: z.coerce.number().int().min(1).max(20),
		deliveryBaseBackoffMs: z.coerce.number().int().min(100).max(300_000),
		deliveryMaxBackoffMs: z.coerce.number().int().min(100).max(3_600_000),
		deliveryTerminalRetentionSeconds: z.coerce
			.number()
			.int()
			.min(3_600)
			.max(31_536_000),
	})
	.superRefine((value, context) => {
		validateOptionalKeyPair(
			value.deliveryPayloadPreviousKeyId,
			value.deliveryPayloadPreviousKey,
			"DELIVERY_PAYLOAD_PREVIOUS_KEY",
			"deliveryPayloadPreviousKeyId",
			context,
		);
		if (
			value.deliveryPayloadPreviousKeyId === value.deliveryPayloadCurrentKeyId
		) {
			issue(
				context,
				"Delivery payload key IDs must be unique",
				"deliveryPayloadPreviousKeyId",
			);
		}
		if (value.deliveryPayloadPreviousKey === value.deliveryPayloadCurrentKey) {
			issue(
				context,
				"Current and previous delivery payload keys must differ",
				"deliveryPayloadPreviousKey",
			);
		}
		validateWorkerTiming(
			value.deliveryTimeoutMs,
			value.deliveryWorkerLeaseMs,
			value.deliveryBaseBackoffMs,
			value.deliveryMaxBackoffMs,
			"MAGIC_LINK_DELIVERY_TIMEOUT_MS",
			"deliveryTimeoutMs",
			context,
		);
		if (value.environment !== "production") return;
		if (value.deliveryPayloadPreviousKey === DEVELOPMENT_DELIVERY_PAYLOAD_KEY) {
			issue(
				context,
				"DELIVERY_PAYLOAD_PREVIOUS_KEY must not use development material in production",
				"deliveryPayloadPreviousKey",
			);
		}
		validateProductionWorker(
			value.databaseUrl,
			value.magicLinkDeliveryUrl,
			value.deliveryPayloadCurrentKey,
			DEVELOPMENT_DELIVERY_PAYLOAD_KEY,
			"MAGIC_LINK_DELIVERY_URL",
			"magicLinkDeliveryUrl",
			"DELIVERY_PAYLOAD_CURRENT_KEY",
			"deliveryPayloadCurrentKey",
			context,
		);
		if (new URL(value.magicLinkAppUrl).protocol !== "https:") {
			issue(
				context,
				"MAGIC_LINK_APP_URL must use HTTPS in production",
				"magicLinkAppUrl",
			);
		}
	});

const PushWorkerConfigSchema = z
	.object({
		environment: Environment,
		databaseUrl: z.string().url(),
		pushDeliveryUrl: z.string().url(),
		pushDeliveryBearer: z.string().min(16),
		pushPayloadCurrentKeyId: KeyId,
		pushPayloadCurrentKey: PayloadKey,
		pushPayloadPreviousKeyId: KeyId.optional(),
		pushPayloadPreviousKey: PayloadKey.optional(),
		pushWorkerBatchSize: z.coerce.number().int().min(1).max(100),
		pushWorkerLeaseMs: z.coerce.number().int().min(1_000).max(300_000),
		pushDeliveryTimeoutMs: z.coerce.number().int().min(100).max(60_000),
		pushWorkerPollMs: z.coerce.number().int().min(50).max(60_000),
		pushMaxAttempts: z.coerce.number().int().min(1).max(20),
		pushBaseBackoffMs: z.coerce.number().int().min(100).max(300_000),
		pushMaxBackoffMs: z.coerce.number().int().min(100).max(3_600_000),
		pushTerminalRetentionSeconds: z.coerce
			.number()
			.int()
			.min(3_600)
			.max(31_536_000),
	})
	.superRefine((value, context) => {
		validateOptionalKeyPair(
			value.pushPayloadPreviousKeyId,
			value.pushPayloadPreviousKey,
			"PUSH_PAYLOAD_PREVIOUS_KEY",
			"pushPayloadPreviousKeyId",
			context,
		);
		if (value.pushPayloadPreviousKeyId === value.pushPayloadCurrentKeyId) {
			issue(
				context,
				"Push payload key IDs must be unique",
				"pushPayloadPreviousKeyId",
			);
		}
		if (value.pushPayloadPreviousKey === value.pushPayloadCurrentKey) {
			issue(
				context,
				"Current and previous push payload keys must differ",
				"pushPayloadPreviousKey",
			);
		}
		validateWorkerTiming(
			value.pushDeliveryTimeoutMs,
			value.pushWorkerLeaseMs,
			value.pushBaseBackoffMs,
			value.pushMaxBackoffMs,
			"PUSH_DELIVERY_TIMEOUT_MS",
			"pushDeliveryTimeoutMs",
			context,
			PUSH_DELIVERY_ACK_BUFFER_MS,
		);
		if (value.environment !== "production") return;
		if (value.pushPayloadPreviousKey === DEVELOPMENT_PUSH_PAYLOAD_KEY) {
			issue(
				context,
				"PUSH_PAYLOAD_PREVIOUS_KEY must not use development material in production",
				"pushPayloadPreviousKey",
			);
		}
		validateProductionWorker(
			value.databaseUrl,
			value.pushDeliveryUrl,
			value.pushPayloadCurrentKey,
			DEVELOPMENT_PUSH_PAYLOAD_KEY,
			"PUSH_DELIVERY_URL",
			"pushDeliveryUrl",
			"PUSH_PAYLOAD_CURRENT_KEY",
			"pushPayloadCurrentKey",
			context,
		);
	});

const IdentityRetentionWorkerConfigSchema = z
	.object({
		environment: Environment,
		databaseUrl: z.string().url(),
		batchSize: z.coerce.number().int().min(1).max(1_000),
		pollMs: z.coerce.number().int().min(1_000).max(86_400_000),
		magicLinkRetentionSeconds: z.coerce
			.number()
			.int()
			.min(3_600)
			.max(31_536_000),
		sessionRetentionSeconds: z.coerce.number().int().min(3_600).max(31_536_000),
	})
	.superRefine((value, context) => {
		if (
			value.environment === "production" &&
			value.databaseUrl === DEVELOPMENT_DATABASE_URL
		) {
			issue(context, "DATABASE_URL must be set in production", "databaseUrl");
		}
	});

export type Config = z.infer<typeof ConfigSchema>;
export type DeliveryWorkerConfig = z.infer<typeof DeliveryWorkerConfigSchema>;
export type PushWorkerConfig = z.infer<typeof PushWorkerConfigSchema>;
export type IdentityRetentionWorkerConfig = z.infer<
	typeof IdentityRetentionWorkerConfigSchema
>;

export function loadConfig(
	env: Record<string, string | undefined> = Bun.env,
): Config {
	return ConfigSchema.parse({
		environment: env.NODE_ENV ?? "development",
		host: env.HOST ?? "0.0.0.0",
		port: env.PORT ?? "3001",
		databaseUrl: env.DATABASE_URL ?? DEVELOPMENT_DATABASE_URL,
		jwtIssuer: env.JWT_ISSUER ?? "crew-user-service",
		jwtAudience: env.JWT_AUDIENCE ?? "crew-mobile",
		jwtKeyId: env.JWT_KEY_ID ?? "crew-development-1",
		jwtPrivateKeyPath:
			env.JWT_PRIVATE_KEY_PATH ?? "./secrets/user-jwt-private.pem",
		jwtPublicKeyPath:
			env.JWT_PUBLIC_KEY_PATH ?? "./secrets/user-jwt-public.pem",
		jwtPreviousKeyId: emptyToUndefined(env.JWT_PREVIOUS_KEY_ID),
		jwtPreviousPublicKeyPath: emptyToUndefined(
			env.JWT_PREVIOUS_PUBLIC_KEY_PATH,
		),
		accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS ?? "900",
		refreshTokenTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS ?? "2592000",
		refreshTokenKey: env.REFRESH_TOKEN_KEY ?? DEVELOPMENT_REFRESH_KEY,
		rateLimitRedisUrl:
			env.RATE_LIMIT_REDIS_URL ??
			env.REDIS_URL ??
			DEVELOPMENT_RATE_LIMIT_REDIS_URL,
		rateLimitKey: env.RATE_LIMIT_KEY ?? DEVELOPMENT_RATE_LIMIT_KEY,
		rateLimitMaxEntries: env.RATE_LIMIT_MAX_ENTRIES ?? "10000",
		rateLimitConnectionTimeoutMs:
			env.RATE_LIMIT_CONNECTION_TIMEOUT_MS ?? "1000",
		rateLimitCommandTimeoutMs: env.RATE_LIMIT_COMMAND_TIMEOUT_MS ?? "250",
		trustedGatewayIp: emptyToUndefined(env.TRUSTED_GATEWAY_IP),
		idempotencyPayloadCurrentKeyId:
			env.IDEMPOTENCY_PAYLOAD_CURRENT_KEY_ID ?? "development-v1",
		idempotencyPayloadCurrentKey:
			env.IDEMPOTENCY_PAYLOAD_CURRENT_KEY ??
			DEVELOPMENT_IDEMPOTENCY_PAYLOAD_KEY,
		idempotencyPayloadPreviousKeyId: emptyToUndefined(
			env.IDEMPOTENCY_PAYLOAD_PREVIOUS_KEY_ID,
		),
		idempotencyPayloadPreviousKey: emptyToUndefined(
			env.IDEMPOTENCY_PAYLOAD_PREVIOUS_KEY,
		),
		magicLinkTtlSeconds: env.MAGIC_LINK_TTL_SECONDS ?? "900",
		magicLinkAppUrl: env.MAGIC_LINK_APP_URL ?? DEFAULT_MAGIC_LINK_APP_URL,
		deliveryPayloadCurrentKeyId:
			env.DELIVERY_PAYLOAD_CURRENT_KEY_ID ?? "development-1",
		deliveryPayloadCurrentKey:
			env.DELIVERY_PAYLOAD_CURRENT_KEY ?? DEVELOPMENT_DELIVERY_PAYLOAD_KEY,
		pushPayloadCurrentKeyId:
			env.PUSH_PAYLOAD_CURRENT_KEY_ID ?? "development-push-1",
		pushPayloadCurrentKey:
			env.PUSH_PAYLOAD_CURRENT_KEY ?? DEVELOPMENT_PUSH_PAYLOAD_KEY,
		eventNotificationServiceIssuer:
			env.EVENT_NOTIFICATION_SERVICE_ISSUER ?? "crew-event-service",
		eventNotificationServiceAudience:
			env.EVENT_NOTIFICATION_SERVICE_AUDIENCE ?? "crew-user-service",
		eventNotificationServiceCurrentKeyId:
			env.EVENT_NOTIFICATION_SERVICE_CURRENT_KEY_ID ?? "development-event-1",
		eventNotificationServiceCurrentKey:
			env.EVENT_NOTIFICATION_SERVICE_CURRENT_KEY ??
			DEVELOPMENT_EVENT_NOTIFICATION_SERVICE_AUTH_KEY,
		eventNotificationServicePreviousKeyId:
			env.EVENT_NOTIFICATION_SERVICE_PREVIOUS_KEY_ID,
		eventNotificationServicePreviousKey:
			env.EVENT_NOTIFICATION_SERVICE_PREVIOUS_KEY,
		memberDirectoryServiceIssuer:
			env.MEMBER_DIRECTORY_SERVICE_ISSUER ?? "crew-api-gateway",
		memberDirectoryServiceAudience:
			env.MEMBER_DIRECTORY_SERVICE_AUDIENCE ?? "crew-user-service",
		memberDirectoryServiceCurrentKeyId:
			env.MEMBER_DIRECTORY_SERVICE_CURRENT_KEY_ID ?? "development-gateway-1",
		memberDirectoryServiceCurrentKey:
			env.MEMBER_DIRECTORY_SERVICE_CURRENT_KEY ??
			DEVELOPMENT_MEMBER_DIRECTORY_SERVICE_AUTH_KEY,
		memberDirectoryServicePreviousKeyId: emptyToUndefined(
			env.MEMBER_DIRECTORY_SERVICE_PREVIOUS_KEY_ID,
		),
		memberDirectoryServicePreviousKey: emptyToUndefined(
			env.MEMBER_DIRECTORY_SERVICE_PREVIOUS_KEY,
		),
	});
}

function emptyToUndefined(value: string | undefined) {
	return value || undefined;
}

export function loadDeliveryWorkerConfig(
	env: Record<string, string | undefined> = Bun.env,
): DeliveryWorkerConfig {
	if (!env.MAGIC_LINK_DELIVERY_URL || !env.MAGIC_LINK_DELIVERY_BEARER) {
		throw new Error(
			"Magic-link delivery worker requires provider configuration",
		);
	}
	return DeliveryWorkerConfigSchema.parse({
		environment: env.NODE_ENV ?? "development",
		databaseUrl: env.DATABASE_URL ?? DEVELOPMENT_DATABASE_URL,
		magicLinkAppUrl: env.MAGIC_LINK_APP_URL ?? DEFAULT_MAGIC_LINK_APP_URL,
		magicLinkDeliveryUrl: env.MAGIC_LINK_DELIVERY_URL,
		magicLinkDeliveryBearer: env.MAGIC_LINK_DELIVERY_BEARER,
		deliveryPayloadCurrentKeyId:
			env.DELIVERY_PAYLOAD_CURRENT_KEY_ID ?? "development-1",
		deliveryPayloadCurrentKey:
			env.DELIVERY_PAYLOAD_CURRENT_KEY ?? DEVELOPMENT_DELIVERY_PAYLOAD_KEY,
		deliveryPayloadPreviousKeyId: env.DELIVERY_PAYLOAD_PREVIOUS_KEY_ID,
		deliveryPayloadPreviousKey: env.DELIVERY_PAYLOAD_PREVIOUS_KEY,
		deliveryWorkerBatchSize: env.DELIVERY_WORKER_BATCH_SIZE ?? "20",
		deliveryWorkerLeaseMs: env.DELIVERY_WORKER_LEASE_MS ?? "15000",
		deliveryTimeoutMs: env.MAGIC_LINK_DELIVERY_TIMEOUT_MS ?? "3000",
		deliveryWorkerPollMs: env.DELIVERY_WORKER_POLL_MS ?? "1000",
		deliveryMaxAttempts: env.DELIVERY_MAX_ATTEMPTS ?? "8",
		deliveryBaseBackoffMs: env.DELIVERY_BASE_BACKOFF_MS ?? "1000",
		deliveryMaxBackoffMs: env.DELIVERY_MAX_BACKOFF_MS ?? "300000",
		deliveryTerminalRetentionSeconds:
			env.DELIVERY_TERMINAL_RETENTION_SECONDS ?? "2592000",
	});
}

export function loadPushWorkerConfig(
	env: Record<string, string | undefined> = Bun.env,
): PushWorkerConfig {
	if (!env.PUSH_DELIVERY_URL || !env.PUSH_DELIVERY_BEARER) {
		throw new Error("Push worker requires provider configuration");
	}
	return PushWorkerConfigSchema.parse({
		environment: env.NODE_ENV ?? "development",
		databaseUrl: env.DATABASE_URL ?? DEVELOPMENT_DATABASE_URL,
		pushDeliveryUrl: env.PUSH_DELIVERY_URL,
		pushDeliveryBearer: env.PUSH_DELIVERY_BEARER,
		pushPayloadCurrentKeyId:
			env.PUSH_PAYLOAD_CURRENT_KEY_ID ?? "development-push-1",
		pushPayloadCurrentKey:
			env.PUSH_PAYLOAD_CURRENT_KEY ?? DEVELOPMENT_PUSH_PAYLOAD_KEY,
		pushPayloadPreviousKeyId: env.PUSH_PAYLOAD_PREVIOUS_KEY_ID,
		pushPayloadPreviousKey: env.PUSH_PAYLOAD_PREVIOUS_KEY,
		pushWorkerBatchSize: env.PUSH_WORKER_BATCH_SIZE ?? "20",
		pushWorkerLeaseMs: env.PUSH_WORKER_LEASE_MS ?? "15000",
		pushDeliveryTimeoutMs: env.PUSH_DELIVERY_TIMEOUT_MS ?? "3000",
		pushWorkerPollMs: env.PUSH_WORKER_POLL_MS ?? "1000",
		pushMaxAttempts: env.PUSH_MAX_ATTEMPTS ?? "8",
		pushBaseBackoffMs: env.PUSH_BASE_BACKOFF_MS ?? "1000",
		pushMaxBackoffMs: env.PUSH_MAX_BACKOFF_MS ?? "300000",
		pushTerminalRetentionSeconds:
			env.PUSH_TERMINAL_RETENTION_SECONDS ?? "2592000",
	});
}

export function loadIdentityRetentionWorkerConfig(
	env: Record<string, string | undefined> = Bun.env,
): IdentityRetentionWorkerConfig {
	return IdentityRetentionWorkerConfigSchema.parse({
		environment: env.NODE_ENV ?? "development",
		databaseUrl: env.DATABASE_URL ?? DEVELOPMENT_DATABASE_URL,
		batchSize: env.IDENTITY_RETENTION_BATCH_SIZE ?? "100",
		pollMs: env.IDENTITY_RETENTION_POLL_MS ?? "60000",
		magicLinkRetentionSeconds: env.MAGIC_LINK_RETENTION_SECONDS ?? "2592000",
		sessionRetentionSeconds: env.SESSION_RETENTION_SECONDS ?? "2592000",
	});
}

function validateOptionalKeyPair(
	id: string | undefined,
	key: string | undefined,
	name: string,
	path: string,
	context: z.RefinementCtx,
) {
	if (Boolean(id) !== Boolean(key)) {
		issue(context, `${name}_ID and ${name} must be set together`, path);
	}
}

function validateWorkerTiming(
	timeoutMs: number,
	leaseMs: number,
	baseBackoffMs: number,
	maxBackoffMs: number,
	timeoutName: string,
	timeoutPath: string,
	context: z.RefinementCtx,
	ackBufferMs = 0,
) {
	if (timeoutMs + ackBufferMs >= leaseMs) {
		issue(
			context,
			`${timeoutName} plus ack buffer must be shorter than the lease`,
			timeoutPath,
		);
	}
	if (baseBackoffMs > maxBackoffMs) {
		issue(
			context,
			"Worker base backoff must not exceed maximum backoff",
			timeoutPath,
		);
	}
}

function validateProductionWorker(
	databaseUrl: string,
	providerUrl: string,
	currentKey: string,
	developmentKey: string,
	providerName: string,
	providerPath: string,
	keyName: string,
	keyPath: string,
	context: z.RefinementCtx,
) {
	if (databaseUrl === DEVELOPMENT_DATABASE_URL) {
		issue(context, "DATABASE_URL must be set in production", "databaseUrl");
	}
	if (new URL(providerUrl).protocol !== "https:") {
		issue(
			context,
			`${providerName} must use HTTPS in production`,
			providerPath,
		);
	}
	if (currentKey === developmentKey) {
		issue(context, `${keyName} must be set in production`, keyPath);
	}
}

function issue(context: z.RefinementCtx, message: string, path: string) {
	context.addIssue({
		code: z.ZodIssueCode.custom,
		message,
		path: [path],
	});
}
