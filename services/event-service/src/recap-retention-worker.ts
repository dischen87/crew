import postgres from "postgres";
import { z } from "zod";
import {
	createRecapExternalRetentionWorker,
	PostgresRecapExternalRetention,
} from "./recap-external-retention";

const DEVELOPMENT_DATABASE_URL = "postgres://localhost/crew_event";

const RecapRetentionWorkerConfig = z
	.object({
		environment: z.enum(["development", "test", "production"]),
		databaseUrl: z.string().url(),
		workerId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
		pollIntervalMs: z.coerce.number().int().min(50).max(3_600_000),
		batchSize: z.coerce.number().int().min(1).max(1_000),
	})
	.superRefine((value, context) => {
		if (
			value.environment === "production" &&
			value.databaseUrl === DEVELOPMENT_DATABASE_URL
		)
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["databaseUrl"],
				message:
					"Recap retention worker database must be configured in production",
			});
	});

export type RecapRetentionWorkerConfig = z.infer<
	typeof RecapRetentionWorkerConfig
>;

export function loadRecapRetentionWorkerConfig(
	env: Record<string, string | undefined> = Bun.env,
): RecapRetentionWorkerConfig {
	const environment = env.NODE_ENV ?? "development";
	const local = environment !== "production";
	return RecapRetentionWorkerConfig.parse({
		environment,
		databaseUrl:
			env.EVENT_RECAP_RETENTION_WORKER_DATABASE_URL ??
			(local
				? (env.EVENT_DATABASE_URL ?? DEVELOPMENT_DATABASE_URL)
				: undefined),
		workerId:
			env.EVENT_RECAP_RETENTION_WORKER_ID ??
			`recap-retention-worker-${crypto.randomUUID()}`,
		pollIntervalMs:
			env.EVENT_RECAP_RETENTION_WORKER_POLL_INTERVAL_MS ?? "60000",
		batchSize: env.EVENT_RECAP_RETENTION_WORKER_BATCH_SIZE ?? "100",
	});
}

if (import.meta.main) {
	const config = loadRecapRetentionWorkerConfig();
	const sql = postgres(config.databaseUrl, { max: 1, onnotice: () => {} });
	const worker = createRecapExternalRetentionWorker(
		config,
		new PostgresRecapExternalRetention(sql),
	);
	const controller = new AbortController();
	process.once("SIGINT", () => controller.abort());
	process.once("SIGTERM", () => controller.abort());
	console.info("Crew recap external retention worker started");
	try {
		await worker.run(controller.signal);
	} finally {
		await sql.end({ timeout: 5 });
	}
}
