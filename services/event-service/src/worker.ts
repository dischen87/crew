import postgres from "postgres";
import { PostgresAttachmentJobRepository } from "./attachment-jobs";
import { createAttachmentWorker } from "./attachment-worker";
import { loadAttachmentWorkerConfig } from "./attachment-worker-config";
import { BunS3PrivateObjectStore } from "./object-store";

export { createAttachmentWorker } from "./attachment-worker";

if (import.meta.main) {
	const config = loadAttachmentWorkerConfig();
	const sql = postgres(config.databaseUrl, {
		max: config.verifyConcurrency + 2,
		onnotice: () => {},
	});
	const worker = createAttachmentWorker(
		config,
		new PostgresAttachmentJobRepository(sql),
		new BunS3PrivateObjectStore(
			{
				endpoint: config.objectStoreEndpoint,
				region: config.objectStoreRegion,
				bucket: config.objectStoreBucket,
				accessKeyId: config.objectStoreAccessKeyId,
				secretAccessKey: config.objectStoreSecretAccessKey,
			},
			config.verifyConcurrency,
		),
	);
	const controller = new AbortController();
	process.once("SIGINT", () => controller.abort());
	process.once("SIGTERM", () => controller.abort());
	console.info(`Crew attachment worker ${worker.id} started`);
	try {
		await worker.run(controller.signal);
	} finally {
		await sql.end({ timeout: 5 });
	}
}
