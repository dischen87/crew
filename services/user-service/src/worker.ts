import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { loadDeliveryWorkerConfig } from "./config";
import { createWebhookMagicLinkSender } from "./delivery";
import {
	type DeliveryWorkerStats,
	MagicLinkDeliveryWorker,
	PostgresDeliveryOutboxRepository,
} from "./delivery-outbox";
import { createDeliveryPayloadKeyring } from "./delivery-payload";
import { logSafeFailure } from "./safe-error-log";

export async function runDeliveryWorker(input: {
	worker: MagicLinkDeliveryWorker;
	workerId: string;
	pollMs: number;
	signal: AbortSignal;
	onStats?: (stats: DeliveryWorkerStats) => void;
}) {
	while (!input.signal.aborted) {
		try {
			const stats = await input.worker.runOnce();
			input.onStats?.(stats);
			if (stats.claimed === 0 && stats.expired === 0) {
				await wait(input.pollMs, input.signal);
			}
		} catch {
			logSafeFailure("deliveryWorker", input.workerId);
			if (!input.signal.aborted) await wait(input.pollMs, input.signal);
		}
	}
}

if (import.meta.main) {
	const config = loadDeliveryWorkerConfig();
	const sql = postgres(config.databaseUrl, { max: 10, onnotice: () => {} });
	const abort = new AbortController();
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => abort.abort());
	}
	const workerId = `user-delivery-${process.pid}-${randomUUID()}`;
	const worker = new MagicLinkDeliveryWorker({
		repository: new PostgresDeliveryOutboxRepository(sql),
		payloads: createDeliveryPayloadKeyring({
			current: {
				id: config.deliveryPayloadCurrentKeyId,
				key: config.deliveryPayloadCurrentKey,
			},
			...(config.deliveryPayloadPreviousKeyId &&
			config.deliveryPayloadPreviousKey
				? {
						previous: {
							id: config.deliveryPayloadPreviousKeyId,
							key: config.deliveryPayloadPreviousKey,
						},
					}
				: {}),
		}),
		sendMagicLink: createWebhookMagicLinkSender({
			endpoint: config.magicLinkDeliveryUrl,
			bearer: config.magicLinkDeliveryBearer,
			appUrl: config.magicLinkAppUrl,
			timeoutMs: config.deliveryTimeoutMs,
		}),
		workerId,
		batchSize: config.deliveryWorkerBatchSize,
		leaseMs: config.deliveryWorkerLeaseMs,
		deliveryTimeoutMs: config.deliveryTimeoutMs,
		maxAttempts: config.deliveryMaxAttempts,
		baseBackoffMs: config.deliveryBaseBackoffMs,
		maxBackoffMs: config.deliveryMaxBackoffMs,
		terminalRetentionMs: config.deliveryTerminalRetentionSeconds * 1_000,
	});
	try {
		await runDeliveryWorker({
			worker,
			workerId,
			pollMs: config.deliveryWorkerPollMs,
			signal: abort.signal,
			onStats: (stats) => {
				if (Object.values(stats).some((value) => value > 0)) {
					console.info("User delivery worker batch", stats);
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
