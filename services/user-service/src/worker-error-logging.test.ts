import { expect, test } from "bun:test";
import type { MagicLinkDeliveryWorker } from "./delivery-outbox";
import type { PostgresIdentityRetention } from "./identity-retention";
import type { PushDeliveryWorker } from "./push-outbox";
import { runPushWorker } from "./push-worker";
import { runIdentityRetentionWorker } from "./retention-worker";
import { runDeliveryWorker } from "./worker";

test("worker loops classify failures without inspecting raw exceptions", async () => {
	const secrets = [
		"person@example.com",
		"provider-token-private",
		"duplicate key row=(usr_private, sealed_payload)",
	];
	const inspected: string[] = [];
	const failure = new Error();
	for (const property of ["message", "detail", "stack", "row"] as const) {
		Object.defineProperty(failure, property, {
			configurable: true,
			get() {
				inspected.push(property);
				return secrets.join(" ");
			},
		});
	}
	Object.defineProperty(failure, "toJSON", {
		configurable: true,
		value() {
			inspected.push("toJSON");
			return { secrets };
		},
	});

	const logs: unknown[][] = [];
	const original = console.error;
	console.error = (...values: unknown[]) => logs.push(values);
	try {
		const deliveryAbort = new AbortController();
		const deliveryWorker = {
			async runOnce() {
				deliveryAbort.abort();
				throw failure;
			},
		} as unknown as MagicLinkDeliveryWorker;
		await runDeliveryWorker({
			worker: deliveryWorker,
			workerId: "user-delivery-safe-worker",
			pollMs: 1,
			signal: deliveryAbort.signal,
		});

		const pushAbort = new AbortController();
		const pushWorker = {
			async runOnce() {
				pushAbort.abort();
				throw failure;
			},
		} as unknown as PushDeliveryWorker;
		await runPushWorker({
			worker: pushWorker,
			workerId: "user-push-safe-worker",
			pollMs: 1,
			signal: pushAbort.signal,
		});

		const retentionAbort = new AbortController();
		const retention = {
			async purgeOnce() {
				retentionAbort.abort();
				throw failure;
			},
		} as unknown as PostgresIdentityRetention;
		await runIdentityRetentionWorker({
			retention,
			workerId: "user-retention-safe-worker",
			batchSize: 10,
			magicLinkRetentionSeconds: 86_400,
			sessionRetentionSeconds: 86_400,
			pollMs: 1,
			signal: retentionAbort.signal,
		});
	} finally {
		console.error = original;
	}

	expect(logs).toEqual([
		[
			"User delivery worker tick failed",
			{
				code: "USER_DELIVERY_WORKER_TICK_FAILED",
				workerId: "user-delivery-safe-worker",
			},
		],
		[
			"User push worker tick failed",
			{
				code: "USER_PUSH_WORKER_TICK_FAILED",
				workerId: "user-push-safe-worker",
			},
		],
		[
			"User identity retention worker tick failed",
			{
				code: "USER_IDENTITY_RETENTION_WORKER_TICK_FAILED",
				workerId: "user-retention-safe-worker",
			},
		],
	]);
	expect(inspected).toEqual([]);
	const output = JSON.stringify(logs);
	for (const secret of secrets) expect(output).not.toContain(secret);
});
