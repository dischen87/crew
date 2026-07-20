import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { loadPushWorkerConfig } from "./config";
import { createWebhookPushSender } from "./push-delivery";
import {
	PostgresPushOutboxRepository,
	PushDeliveryWorker,
	type PushWorkerStats,
} from "./push-outbox";
import { createPushPayloadKeyring } from "./push-payload";
import { logSafeFailure } from "./safe-error-log";

export async function runPushWorker(input: {
	worker: PushDeliveryWorker;
	workerId: string;
	pollMs: number;
	signal: AbortSignal;
	onStats?: (stats: PushWorkerStats) => void;
}) {
	while (!input.signal.aborted) {
		try {
			const stats = await input.worker.runOnce();
			input.onStats?.(stats);
			if (stats.claimed === 0 && stats.expired === 0) {
				await wait(input.pollMs, input.signal);
			}
		} catch {
			logSafeFailure("pushWorker", input.workerId);
			if (!input.signal.aborted) await wait(input.pollMs, input.signal);
		}
	}
}

if (import.meta.main) {
	const config = loadPushWorkerConfig();
	const sql = postgres(config.databaseUrl, { max: 10, onnotice: () => {} });
	const abort = new AbortController();
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => abort.abort());
	}
	const workerId = `user-push-${process.pid}-${randomUUID()}`;
	const worker = new PushDeliveryWorker({
		repository: new PostgresPushOutboxRepository(sql),
		payloads: createPushPayloadKeyring({
			current: {
				id: config.pushPayloadCurrentKeyId,
				key: config.pushPayloadCurrentKey,
			},
			...(config.pushPayloadPreviousKeyId && config.pushPayloadPreviousKey
				? {
						previous: {
							id: config.pushPayloadPreviousKeyId,
							key: config.pushPayloadPreviousKey,
						},
					}
				: {}),
		}),
		sendPushNotification: createWebhookPushSender({
			endpoint: config.pushDeliveryUrl,
			bearer: config.pushDeliveryBearer,
			timeoutMs: config.pushDeliveryTimeoutMs,
		}),
		workerId,
		batchSize: config.pushWorkerBatchSize,
		leaseMs: config.pushWorkerLeaseMs,
		deliveryTimeoutMs: config.pushDeliveryTimeoutMs,
		maxAttempts: config.pushMaxAttempts,
		baseBackoffMs: config.pushBaseBackoffMs,
		maxBackoffMs: config.pushMaxBackoffMs,
		terminalRetentionMs: config.pushTerminalRetentionSeconds * 1_000,
	});
	try {
		await runPushWorker({
			worker,
			workerId,
			pollMs: config.pushWorkerPollMs,
			signal: abort.signal,
			onStats: (stats) => {
				if (Object.values(stats).some((value) => value > 0)) {
					console.info("User push worker batch", stats);
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
