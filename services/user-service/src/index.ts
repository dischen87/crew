import { RedisClient } from "bun";
import postgres from "postgres";
import { createApp, createClientKey } from "./app";
import { createTokenServiceFromPem } from "./auth";
import { loadConfig } from "./config";
import { createDeliveryPayloadKeyring } from "./delivery-payload";
import { PostgresUserRepository } from "./postgres-repository";
import { createPushPayloadKeyring } from "./push-payload";
import { RedisAuthRateLimiter } from "./rate-limit";
import {
	createEventNotificationServiceAuth,
	createMemberDirectoryServiceAuth,
} from "./service-auth";

const config = loadConfig();
const [privateKeyPem, publicKeyPem] = await Promise.all([
	Bun.file(config.jwtPrivateKeyPath).text(),
	Bun.file(config.jwtPublicKeyPath).text(),
]);
const previousPublicKeyPem = config.jwtPreviousPublicKeyPath
	? await Bun.file(config.jwtPreviousPublicKeyPath).text()
	: undefined;
const tokens = await createTokenServiceFromPem(privateKeyPem, publicKeyPem, {
	issuer: config.jwtIssuer,
	audience: config.jwtAudience,
	keyId: config.jwtKeyId,
	accessTokenTtlSeconds: config.accessTokenTtlSeconds,
	...(config.jwtPreviousKeyId && previousPublicKeyPem
		? {
				previous: {
					keyId: config.jwtPreviousKeyId,
					publicKeyPem: previousPublicKeyPem,
				},
			}
		: {}),
});
const sql = postgres(config.databaseUrl, { max: 10, onnotice: () => {} });
const redis = new RedisClient(config.rateLimitRedisUrl, {
	connectionTimeout: config.rateLimitConnectionTimeoutMs,
	enableOfflineQueue: false,
	maxRetries: 1,
});
try {
	await redis.connect();
} catch {
	throw new Error("User-service rate-limit store is unavailable");
}
const app = createApp(
	{
		repository: new PostgresUserRepository(sql),
		tokens,
		deliveryPayloads: createDeliveryPayloadKeyring({
			current: {
				id: config.deliveryPayloadCurrentKeyId,
				key: config.deliveryPayloadCurrentKey,
			},
		}),
		pushPayloads: createPushPayloadKeyring({
			current: {
				id: config.pushPayloadCurrentKeyId,
				key: config.pushPayloadCurrentKey,
			},
		}),
		eventNotificationServiceVerifier: createEventNotificationServiceAuth({
			issuer: config.eventNotificationServiceIssuer,
			audience: config.eventNotificationServiceAudience,
			current: {
				id: config.eventNotificationServiceCurrentKeyId,
				key: config.eventNotificationServiceCurrentKey,
			},
			...(config.eventNotificationServicePreviousKeyId &&
			config.eventNotificationServicePreviousKey
				? {
						previous: {
							id: config.eventNotificationServicePreviousKeyId,
							key: config.eventNotificationServicePreviousKey,
						},
					}
				: {}),
		}),
		memberDirectoryServiceVerifier: createMemberDirectoryServiceAuth({
			issuer: config.memberDirectoryServiceIssuer,
			audience: config.memberDirectoryServiceAudience,
			current: {
				id: config.memberDirectoryServiceCurrentKeyId,
				key: config.memberDirectoryServiceCurrentKey,
			},
			...(config.memberDirectoryServicePreviousKeyId &&
			config.memberDirectoryServicePreviousKey
				? {
						previous: {
							id: config.memberDirectoryServicePreviousKeyId,
							key: config.memberDirectoryServicePreviousKey,
						},
					}
				: {}),
		}),
		authRateLimiter: new RedisAuthRateLimiter(
			redis,
			{
				magicRequest: { windowMs: 60_000 },
				magicRedeem: { windowMs: 60_000 },
				refresh: { windowMs: 60_000 },
			},
			config.rateLimitMaxEntries,
			config.rateLimitKey,
			config.rateLimitCommandTimeoutMs,
		),
		clientKey: createClientKey(config.trustedGatewayIp),
		magicLinkTtlSeconds: config.magicLinkTtlSeconds,
		refreshTokenTtlSeconds: config.refreshTokenTtlSeconds,
		refreshTokenKey: config.refreshTokenKey,
		idempotencyPayloadKeys: {
			current: {
				id: config.idempotencyPayloadCurrentKeyId,
				key: config.idempotencyPayloadCurrentKey,
			},
			...(config.idempotencyPayloadPreviousKeyId &&
			config.idempotencyPayloadPreviousKey
				? {
						previous: {
							id: config.idempotencyPayloadPreviousKeyId,
							key: config.idempotencyPayloadPreviousKey,
						},
					}
				: {}),
		},
	},
	async () => {
		try {
			await Promise.all([sql`SELECT 1`, redis.send("PING", [])]);
			return true;
		} catch {
			return false;
		}
	},
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, async () => {
		redis.close();
		await sql.end({ timeout: 5 });
		process.exit(0);
	});
}

console.info(`Crew user service listening on ${config.host}:${config.port}`);

export default { hostname: config.host, port: config.port, fetch: app.fetch };
