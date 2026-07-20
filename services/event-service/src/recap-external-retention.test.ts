import { describe, expect, test } from "bun:test";
import {
	createRecapExternalRetentionWorker,
	type PostgresRecapExternalRetention,
	type RecapExternalRetentionStats,
} from "./recap-external-retention";
import { loadRecapRetentionWorkerConfig } from "./recap-retention-worker";

const stats: RecapExternalRetentionStats = {
	leaseAcquired: 1,
	scannedLinks: 4,
	scannedGrantDecisions: 5,
	purgedLinks: 1,
	purgedFields: 2,
	purgedAuditEvents: 2,
	purgedGrantDecisions: 3,
	ambiguousLinks: 6,
	scanSaturated: 1,
	oldestScannedAgeSeconds: 7_776_000,
};

describe("recap external retention worker", () => {
	test("reports only fixed aggregate stats and applies the bounded batch", async () => {
		let limit = 0;
		const worker = createRecapExternalRetentionWorker(
			{
				workerId: "recap-retention-safe",
				pollIntervalMs: 60_000,
				batchSize: 7,
			},
			{
				async purge(value) {
					limit = value;
					return stats;
				},
			} as Pick<PostgresRecapExternalRetention, "purge">,
		);

		expect(await worker.tick()).toEqual(stats);
		expect(limit).toBe(7);
		expect(
			Object.keys(stats).every((key) => !key.toLowerCase().includes("id")),
		).toBe(true);
	});

	test("validates direct factory input and interrupts idle polling", async () => {
		const retention = {
			async purge() {
				return Object.fromEntries(
					Object.keys(stats).map((key) => [key, 0]),
				) as RecapExternalRetentionStats;
			},
		} as Pick<PostgresRecapExternalRetention, "purge">;
		for (const config of [
			{ workerId: "bad id", pollIntervalMs: 60_000, batchSize: 100 },
			{ workerId: "valid", pollIntervalMs: 0, batchSize: 100 },
			{ workerId: "valid", pollIntervalMs: 60_000, batchSize: 0 },
		])
			expect(() =>
				createRecapExternalRetentionWorker(config, retention),
			).toThrow();

		const worker = createRecapExternalRetentionWorker(
			{ workerId: "valid", pollIntervalMs: 60_000, batchSize: 100 },
			retention,
		);
		const controller = new AbortController();
		const started = performance.now();
		const run = worker.run(controller.signal);
		setTimeout(() => controller.abort(), 20);
		await run;
		expect(performance.now() - started).toBeLessThan(500);
	});

	test("requires a dedicated production database and bounds configuration", () => {
		expect(
			loadRecapRetentionWorkerConfig({
				EVENT_RECAP_RETENTION_WORKER_ID: "configured-worker",
			}),
		).toMatchObject({
			workerId: "configured-worker",
			pollIntervalMs: 60_000,
			batchSize: 100,
		});
		expect(() =>
			loadRecapRetentionWorkerConfig({
				NODE_ENV: "production",
				EVENT_DATABASE_URL: "postgres://api.internal/crew_event",
			}),
		).toThrow();
		expect(
			loadRecapRetentionWorkerConfig({
				NODE_ENV: "production",
				EVENT_RECAP_RETENTION_WORKER_DATABASE_URL:
					"postgres://recap-retention.internal/crew_event",
				EVENT_RECAP_RETENTION_WORKER_BATCH_SIZE: "1000",
			}),
		).toMatchObject({ batchSize: 1_000 });
		expect(() =>
			loadRecapRetentionWorkerConfig({
				EVENT_RECAP_RETENTION_WORKER_BATCH_SIZE: "1001",
			}),
		).toThrow();
	});
});
