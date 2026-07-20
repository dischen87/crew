import type { Sql } from "postgres";

export type RecapExternalRetentionStats = {
	leaseAcquired: number;
	scannedLinks: number;
	scannedGrantDecisions: number;
	purgedLinks: number;
	purgedFields: number;
	purgedAuditEvents: number;
	purgedGrantDecisions: number;
	ambiguousLinks: number;
	scanSaturated: number;
	oldestScannedAgeSeconds: number;
};

export class PostgresRecapExternalRetention {
	constructor(private readonly sql: Sql) {}

	async purge(limit: number): Promise<RecapExternalRetentionStats> {
		const [stats] = await this.sql<RecapExternalRetentionStats[]>`
			SELECT
				lease_acquired AS "leaseAcquired",
				scanned_links AS "scannedLinks",
				scanned_grant_decisions AS "scannedGrantDecisions",
				purged_links AS "purgedLinks",
				purged_fields AS "purgedFields",
				purged_audit_events AS "purgedAuditEvents",
				purged_grant_decisions AS "purgedGrantDecisions",
				ambiguous_links AS "ambiguousLinks",
				scan_saturated AS "scanSaturated",
				oldest_scanned_age_seconds AS "oldestScannedAgeSeconds"
			FROM purge_event_recap_external_metadata(${limit})
		`;
		if (!stats) throw new Error("Recap external retention invariant failed");
		return stats;
	}
}

export function createRecapExternalRetentionWorker(
	config: { workerId: string; pollIntervalMs: number; batchSize: number },
	retention: Pick<PostgresRecapExternalRetention, "purge">,
) {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(config.workerId))
		throw new Error("Invalid recap external retention worker ID");
	if (
		!Number.isInteger(config.pollIntervalMs) ||
		config.pollIntervalMs < 50 ||
		config.pollIntervalMs > 3_600_000
	)
		throw new Error("Invalid recap external retention poll interval");
	if (
		!Number.isInteger(config.batchSize) ||
		config.batchSize < 1 ||
		config.batchSize > 1_000
	)
		throw new Error("Invalid recap external retention batch size");

	async function tick() {
		return retention.purge(config.batchSize);
	}

	return {
		id: config.workerId,
		tick,
		async run(signal: AbortSignal) {
			while (!signal.aborted) {
				try {
					const stats = await tick();
					if (Object.values(stats).some((value) => value > 0))
						console.info("Recap external retention worker batch", stats);
				} catch {
					console.error(
						"Recap external retention worker tick failed",
						"RECAP_EXTERNAL_RETENTION_WORKER_TICK_FAILED",
					);
				}
				if (!signal.aborted) await wait(config.pollIntervalMs, signal);
			}
		},
	};
}

function wait(milliseconds: number, signal: AbortSignal) {
	return new Promise<void>((resolve) => {
		if (signal.aborted) return resolve();
		const timeout = setTimeout(done, milliseconds);
		signal.addEventListener("abort", done, { once: true });
		function done() {
			clearTimeout(timeout);
			signal.removeEventListener("abort", done);
			resolve();
		}
	});
}
