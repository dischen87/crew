import { expect, test } from "bun:test";
import type { PostgresAttachmentJobRepository } from "./attachment-jobs";
import { createAttachmentWorker } from "./attachment-worker";
import type { AttachmentWorkerObjectStore } from "./object-store";
import {
	createPlaceEnrichmentWorker,
	type PlaceEnrichmentJobs,
} from "./place-enrichment-worker";

test("worker loops log fixed classifications without inspecting raw failures", async () => {
	const secrets = [
		"private.person@example.com",
		"Bearer provider-secret-token",
		"duplicate key row=(private_payload, token_hash)",
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
		const attachmentAbort = new AbortController();
		const attachmentJobs = {
			async claimVerification() {
				attachmentAbort.abort();
				throw failure;
			},
			async claimCleanup() {
				return null;
			},
		} as unknown as PostgresAttachmentJobRepository;
		await createAttachmentWorker(
			{
				workerId: "event-attachment-safe-worker",
				pollIntervalMs: 1,
				verifyLeaseSeconds: 30,
				verifyMaxAttempts: 3,
				verifyConcurrency: 1,
				cleanupLeaseSeconds: 30,
				cleanupRetentionSeconds: 86_400,
			},
			attachmentJobs,
			{} as AttachmentWorkerObjectStore,
		).run(attachmentAbort.signal);

		const enrichmentAbort = new AbortController();
		const enrichmentJobs = {
			async claim() {
				enrichmentAbort.abort();
				throw failure;
			},
		} as unknown as PlaceEnrichmentJobs;
		await createPlaceEnrichmentWorker(
			{
				workerId: "event-enrichment-safe-worker",
				pollIntervalMs: 1,
			} as Parameters<typeof createPlaceEnrichmentWorker>[0],
			enrichmentJobs,
		).run(enrichmentAbort.signal);
	} finally {
		console.error = original;
	}

	expect(logs).toEqual([
		[
			"Attachment worker tick failed",
			{
				workerId: "event-attachment-safe-worker",
				code: "ATTACHMENT_WORKER_TICK_FAILED",
			},
		],
		[
			"Place enrichment worker tick failed",
			{
				workerId: "event-enrichment-safe-worker",
				code: "PLACE_ENRICHMENT_WORKER_TICK_FAILED",
			},
		],
	]);
	expect(inspected).toEqual([]);
	const output = JSON.stringify(logs);
	for (const secret of secrets) expect(output).not.toContain(secret);
});

test("every production Postgres client suppresses raw server notices", async () => {
	const connectionSources = [
		new URL("./index.ts", import.meta.url),
		new URL("./worker.ts", import.meta.url),
		new URL("./notification-worker.ts", import.meta.url),
		new URL("../scripts/migrate.ts", import.meta.url),
		new URL("../scripts/run-enrichment-worker.ts", import.meta.url),
		new URL("../../user-service/src/index.ts", import.meta.url),
		new URL("../../user-service/src/worker.ts", import.meta.url),
		new URL("../../user-service/src/push-worker.ts", import.meta.url),
		new URL("../../user-service/scripts/migrate.ts", import.meta.url),
	];

	for (const sourceUrl of connectionSources) {
		const source = await Bun.file(sourceUrl).text();
		const clients = source.match(/\bpostgres\(/g) ?? [];
		const safeNoticeHandlers =
			source.match(/\bonnotice:\s*\(\)\s*=>\s*\{\}/g) ?? [];
		expect(clients.length).toBeGreaterThan(0);
		expect(safeNoticeHandlers).toHaveLength(clients.length);
	}
});
