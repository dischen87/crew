import { z } from "zod";

const DEVELOPMENT_DATABASE_URL = "postgres://localhost/crew_event";
const DEVELOPMENT_OBJECT_ENDPOINT = "http://localhost:9000";
const DEVELOPMENT_OBJECT_ACCESS_KEY = "crew-development-object-access";
const DEVELOPMENT_OBJECT_SECRET_KEY = "crew-development-object-secret";

const AttachmentWorkerConfigSchema = z
	.object({
		environment: z.enum(["development", "test", "production"]),
		databaseUrl: z.string().url(),
		workerId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
		pollIntervalMs: z.coerce.number().int().min(100).max(60_000),
		verifyLeaseSeconds: z.coerce.number().int().min(5).max(900),
		verifyMaxAttempts: z.coerce.number().int().min(2).max(10),
		verifyConcurrency: z.coerce.number().int().min(1).max(4),
		cleanupLeaseSeconds: z.coerce.number().int().min(5).max(900),
		cleanupMaxAttempts: z.coerce.number().int().min(2).max(10),
		maintenanceBatchSize: z.coerce.number().int().min(1).max(1_000),
		objectIoTimeoutMs: z.coerce.number().int().min(100).max(300_000),
		cleanupRetentionSeconds: z.coerce
			.number()
			.int()
			.min(24 * 60 * 60)
			.max(30 * 24 * 60 * 60),
		objectStoreEndpoint: z.string().url(),
		objectStoreRegion: z.string().min(1).max(64),
		objectStoreBucket: z.string().min(3).max(63),
		objectStoreAccessKeyId: z.string().min(8).max(256),
		objectStoreSecretAccessKey: z.string().min(16).max(512),
	})
	.superRefine((value, context) => {
		if (
			value.objectIoTimeoutMs + 250 >=
			Math.min(value.verifyLeaseSeconds, value.cleanupLeaseSeconds) * 1_000
		)
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["objectIoTimeoutMs"],
				message:
					"Attachment object-I/O timeout plus acknowledgment buffer must be shorter than both leases",
			});
		if (
			value.environment === "production" &&
			new URL(value.objectStoreEndpoint).protocol !== "https:"
		)
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["objectStoreEndpoint"],
				message:
					"EVENT_ATTACHMENT_WORKER_OBJECT_STORE_ENDPOINT must use HTTPS in production",
			});
	});

export type AttachmentWorkerConfig = z.infer<
	typeof AttachmentWorkerConfigSchema
>;

export function loadAttachmentWorkerConfig(
	env: Record<string, string | undefined> = Bun.env,
): AttachmentWorkerConfig {
	const environment = env.NODE_ENV ?? "development";
	const local = environment !== "production";
	return AttachmentWorkerConfigSchema.parse({
		environment,
		databaseUrl:
			env.EVENT_ATTACHMENT_WORKER_DATABASE_URL ??
			(local
				? (env.EVENT_DATABASE_URL ??
					env.DATABASE_URL ??
					DEVELOPMENT_DATABASE_URL)
				: undefined),
		workerId:
			env.EVENT_ATTACHMENT_WORKER_ID ??
			`event-attachment-worker-${crypto.randomUUID()}`,
		pollIntervalMs: env.EVENT_ATTACHMENT_WORKER_POLL_INTERVAL_MS ?? "1000",
		verifyLeaseSeconds:
			env.EVENT_ATTACHMENT_WORKER_VERIFY_LEASE_SECONDS ?? "300",
		verifyMaxAttempts: env.EVENT_ATTACHMENT_WORKER_VERIFY_MAX_ATTEMPTS ?? "5",
		verifyConcurrency: env.EVENT_ATTACHMENT_WORKER_VERIFY_CONCURRENCY ?? "2",
		cleanupLeaseSeconds:
			env.EVENT_ATTACHMENT_WORKER_CLEANUP_LEASE_SECONDS ?? "120",
		cleanupMaxAttempts: env.EVENT_ATTACHMENT_WORKER_CLEANUP_MAX_ATTEMPTS ?? "5",
		maintenanceBatchSize:
			env.EVENT_ATTACHMENT_WORKER_MAINTENANCE_BATCH_SIZE ?? "100",
		objectIoTimeoutMs:
			env.EVENT_ATTACHMENT_WORKER_OBJECT_IO_TIMEOUT_MS ?? "30000",
		cleanupRetentionSeconds:
			env.EVENT_ATTACHMENT_WORKER_CLEANUP_RETENTION_SECONDS ??
			String(24 * 60 * 60),
		objectStoreEndpoint:
			env.EVENT_ATTACHMENT_WORKER_OBJECT_STORE_ENDPOINT ??
			(local ? DEVELOPMENT_OBJECT_ENDPOINT : undefined),
		objectStoreRegion:
			env.EVENT_ATTACHMENT_WORKER_OBJECT_STORE_REGION ??
			(local ? "us-east-1" : undefined),
		objectStoreBucket:
			env.EVENT_ATTACHMENT_WORKER_OBJECT_STORE_BUCKET ??
			(local ? "crew-event-development" : undefined),
		objectStoreAccessKeyId:
			env.EVENT_ATTACHMENT_WORKER_OBJECT_STORE_ACCESS_KEY_ID ??
			(local ? DEVELOPMENT_OBJECT_ACCESS_KEY : undefined),
		objectStoreSecretAccessKey:
			env.EVENT_ATTACHMENT_WORKER_OBJECT_STORE_SECRET_ACCESS_KEY ??
			(local ? DEVELOPMENT_OBJECT_SECRET_KEY : undefined),
	});
}
