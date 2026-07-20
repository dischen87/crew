import postgres from "postgres";
import { PostgresPlaceEnrichmentJobs } from "../src/place-enrichment-jobs";
import { createPlaceEnrichmentWorker } from "../src/place-enrichment-worker";
import { loadPlaceEnrichmentWorkerConfig } from "../src/place-enrichment-worker-config";

const config = loadPlaceEnrichmentWorkerConfig();
const sql = postgres(config.databaseUrl, { max: 4, onnotice: () => {} });
const worker = createPlaceEnrichmentWorker(
	config,
	new PostgresPlaceEnrichmentJobs(sql),
);
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
console.info(`Crew place enrichment worker ${worker.id} started`);
try {
	await worker.run(controller.signal);
} finally {
	await sql.end({ timeout: 5 });
}
