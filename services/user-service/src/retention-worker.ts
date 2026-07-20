import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { loadIdentityRetentionWorkerConfig } from "./config";
import {
	type IdentityRetentionStats,
	PostgresIdentityRetention,
} from "./identity-retention";
import { logSafeFailure } from "./safe-error-log";

export async function runIdentityRetentionWorker(input: {
	retention: PostgresIdentityRetention;
	workerId: string;
	batchSize: number;
	magicLinkRetentionSeconds: number;
	sessionRetentionSeconds: number;
	pollMs: number;
	signal: AbortSignal;
	onStats?: (stats: IdentityRetentionStats) => void;
}) {
	while (!input.signal.aborted) {
		try {
			const stats = await input.retention.purgeOnce(input);
			input.onStats?.(stats);
			if (!Object.values(stats).some((value) => value > 0)) {
				await wait(input.pollMs, input.signal);
			}
		} catch {
			logSafeFailure("retentionWorker", input.workerId);
			if (!input.signal.aborted) await wait(input.pollMs, input.signal);
		}
	}
}

if (import.meta.main) {
	const config = loadIdentityRetentionWorkerConfig();
	const sql = postgres(config.databaseUrl, { max: 2, onnotice: () => {} });
	const abort = new AbortController();
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => abort.abort());
	}
	const workerId = `user-retention-${process.pid}-${randomUUID()}`;
	try {
		await runIdentityRetentionWorker({
			retention: new PostgresIdentityRetention(sql),
			workerId,
			batchSize: config.batchSize,
			magicLinkRetentionSeconds: config.magicLinkRetentionSeconds,
			sessionRetentionSeconds: config.sessionRetentionSeconds,
			pollMs: config.pollMs,
			signal: abort.signal,
			onStats: (stats) => {
				if (Object.values(stats).some((value) => value > 0)) {
					console.info("User identity retention batch", stats);
				}
			},
		});
	} finally {
		await sql.end({ timeout: 5 });
	}
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
