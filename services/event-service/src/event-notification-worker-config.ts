import { z } from "zod";
import { isEventNotificationPayloadKey } from "./event-notification-payload";

const DEVELOPMENT_DATABASE_URL = "postgres://localhost/crew_event";
const DEVELOPMENT_PAYLOAD_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const DEVELOPMENT_SERVICE_AUTH_KEY =
	"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
export const EVENT_NOTIFICATION_ACK_BUFFER_MS = 250;

const KeyId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const Key = z.string().refine(isEventNotificationPayloadKey);

const EventNotificationWorkerConfigSchema = z
	.object({
		environment: z.enum(["development", "test", "production"]),
		databaseUrl: z.string().url(),
		workerId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
		pollIntervalMs: z.coerce.number().int().min(50).max(60_000),
		leaseMs: z.coerce.number().int().min(1_000).max(300_000),
		timeoutMs: z.coerce.number().int().min(100).max(60_000),
		maxAttempts: z.coerce.number().int().min(1).max(20),
		baseBackoffMs: z.coerce.number().int().min(100).max(300_000),
		maxBackoffMs: z.coerce.number().int().min(100).max(3_600_000),
		maintenanceBatchSize: z.coerce.number().int().min(1).max(1_000),
		terminalRetentionSeconds: z.coerce
			.number()
			.int()
			.min(3_600)
			.max(31_536_000),
		userServiceUrl: z.string().url(),
		payloadCurrentKeyId: KeyId,
		payloadCurrentKey: Key,
		payloadPreviousKeyId: KeyId.optional(),
		payloadPreviousKey: Key.optional(),
		serviceAuthIssuer: z.string().min(1).max(200),
		serviceAuthAudience: z.string().min(1).max(200),
		serviceAuthCurrentKeyId: KeyId,
		serviceAuthCurrentKey: Key,
	})
	.superRefine((value, context) => {
		if (
			(value.payloadPreviousKeyId === undefined) !==
			(value.payloadPreviousKey === undefined)
		)
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["payloadPreviousKey"],
				message: "Previous payload key and KID must be configured together",
			});
		if (value.payloadPreviousKeyId === value.payloadCurrentKeyId)
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["payloadPreviousKeyId"],
				message: "Payload key IDs must be unique",
			});
		if (value.payloadPreviousKey === value.payloadCurrentKey)
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["payloadPreviousKey"],
				message: "Current and previous payload key material must differ",
			});
		if (value.timeoutMs + EVENT_NOTIFICATION_ACK_BUFFER_MS >= value.leaseMs)
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["leaseMs"],
				message:
					"Notification timeout plus acknowledgment buffer must be less than the lease",
			});
		if (value.baseBackoffMs > value.maxBackoffMs)
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["baseBackoffMs"],
				message: "Base backoff must not exceed maximum backoff",
			});
		if (
			value.serviceAuthCurrentKey === value.payloadCurrentKey ||
			value.serviceAuthCurrentKey === value.payloadPreviousKey
		)
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["serviceAuthCurrentKey"],
				message: "Service-auth and payload encryption keys must differ",
			});
		if (value.environment !== "production") return;
		if (new URL(value.userServiceUrl).protocol !== "https:")
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["userServiceUrl"],
				message:
					"EVENT_NOTIFICATION_WORKER_USER_SERVICE_URL must use HTTPS in production",
			});
		if (
			value.databaseUrl === DEVELOPMENT_DATABASE_URL ||
			value.payloadCurrentKey === DEVELOPMENT_PAYLOAD_KEY ||
			value.payloadPreviousKey === DEVELOPMENT_PAYLOAD_KEY ||
			value.serviceAuthCurrentKey === DEVELOPMENT_SERVICE_AUTH_KEY
		)
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["databaseUrl"],
				message:
					"Notification worker database and keys must be configured in production",
			});
	});

export type EventNotificationWorkerConfig = z.infer<
	typeof EventNotificationWorkerConfigSchema
>;

export function loadEventNotificationWorkerConfig(
	env: Record<string, string | undefined> = Bun.env,
): EventNotificationWorkerConfig {
	const environment = env.NODE_ENV ?? "development";
	const local = environment !== "production";
	return EventNotificationWorkerConfigSchema.parse({
		environment,
		databaseUrl:
			env.EVENT_NOTIFICATION_WORKER_DATABASE_URL ??
			(local
				? (env.EVENT_DATABASE_URL ?? DEVELOPMENT_DATABASE_URL)
				: undefined),
		workerId:
			env.EVENT_NOTIFICATION_WORKER_ID ??
			`event-notification-worker-${crypto.randomUUID()}`,
		pollIntervalMs: env.EVENT_NOTIFICATION_WORKER_POLL_INTERVAL_MS ?? "1000",
		leaseMs: env.EVENT_NOTIFICATION_WORKER_LEASE_MS ?? "15000",
		timeoutMs: env.EVENT_NOTIFICATION_WORKER_TIMEOUT_MS ?? "5000",
		maxAttempts: env.EVENT_NOTIFICATION_WORKER_MAX_ATTEMPTS ?? "5",
		baseBackoffMs: env.EVENT_NOTIFICATION_WORKER_BASE_BACKOFF_MS ?? "1000",
		maxBackoffMs: env.EVENT_NOTIFICATION_WORKER_MAX_BACKOFF_MS ?? "900000",
		maintenanceBatchSize:
			env.EVENT_NOTIFICATION_WORKER_MAINTENANCE_BATCH_SIZE ?? "100",
		terminalRetentionSeconds:
			env.EVENT_NOTIFICATION_WORKER_TERMINAL_RETENTION_SECONDS ?? "2592000",
		userServiceUrl:
			env.EVENT_NOTIFICATION_WORKER_USER_SERVICE_URL ??
			(local ? "http://localhost:3001" : undefined),
		payloadCurrentKeyId:
			env.EVENT_NOTIFICATION_WORKER_PAYLOAD_CURRENT_KEY_ID ??
			(local
				? (env.EVENT_NOTIFICATION_PAYLOAD_CURRENT_KEY_ID ?? "development-v1")
				: undefined),
		payloadCurrentKey:
			env.EVENT_NOTIFICATION_WORKER_PAYLOAD_CURRENT_KEY ??
			(local
				? (env.EVENT_NOTIFICATION_PAYLOAD_CURRENT_KEY ??
					DEVELOPMENT_PAYLOAD_KEY)
				: undefined),
		payloadPreviousKeyId:
			env.EVENT_NOTIFICATION_WORKER_PAYLOAD_PREVIOUS_KEY_ID ??
			(local ? env.EVENT_NOTIFICATION_PAYLOAD_PREVIOUS_KEY_ID : undefined),
		payloadPreviousKey:
			env.EVENT_NOTIFICATION_WORKER_PAYLOAD_PREVIOUS_KEY ??
			(local ? env.EVENT_NOTIFICATION_PAYLOAD_PREVIOUS_KEY : undefined),
		serviceAuthIssuer:
			env.EVENT_NOTIFICATION_WORKER_SERVICE_AUTH_ISSUER ?? "crew-event-service",
		serviceAuthAudience:
			env.EVENT_NOTIFICATION_WORKER_SERVICE_AUTH_AUDIENCE ??
			"crew-user-service",
		serviceAuthCurrentKeyId:
			env.EVENT_NOTIFICATION_WORKER_SERVICE_AUTH_CURRENT_KEY_ID ??
			(local ? "development-event-1" : undefined),
		serviceAuthCurrentKey:
			env.EVENT_NOTIFICATION_WORKER_SERVICE_AUTH_CURRENT_KEY ??
			(local ? DEVELOPMENT_SERVICE_AUTH_KEY : undefined),
	});
}
