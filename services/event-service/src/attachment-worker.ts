import type {
	AttachmentJobMaintenance,
	PostgresAttachmentJobRepository,
} from "./attachment-jobs";
import {
	attachmentCommittedKey,
	attachmentQuarantineKey,
	hasExpectedQuarantineKey,
} from "./attachment-keys";
import type { AttachmentWorkerConfig } from "./attachment-worker-config";
import {
	type AttachmentWorkerObjectStore,
	isPermanentObjectVerificationError,
	ObjectVerificationError,
	UnsafeCommittedFeedbackKeyError,
	UnsafeQuarantineKeyError,
} from "./object-store";

type WorkerConfig = Pick<
	AttachmentWorkerConfig,
	| "workerId"
	| "pollIntervalMs"
	| "verifyLeaseSeconds"
	| "verifyMaxAttempts"
	| "verifyConcurrency"
	| "cleanupLeaseSeconds"
	| "cleanupRetentionSeconds"
> &
	Partial<
		Pick<
			AttachmentWorkerConfig,
			"cleanupMaxAttempts" | "maintenanceBatchSize" | "objectIoTimeoutMs"
		>
	> & { random?: () => number };

export type AttachmentWorkerStats = AttachmentJobMaintenance & {
	verificationClaimed: number;
	verificationCompleted: number;
	verificationRejected: number;
	verificationRetried: number;
	verificationDead: number;
	verificationTimeouts: number;
	verificationStaleResults: number;
	cleanupClaimed: number;
	orphanCleanupCompleted: number;
	cleanupRetried: number;
	cleanupDead: number;
	cleanupTimeouts: number;
	cleanupStaleResults: number;
};

export function createAttachmentWorker(
	config: WorkerConfig,
	jobs: PostgresAttachmentJobRepository,
	objectStore: AttachmentWorkerObjectStore,
) {
	const cleanupMaxAttempts =
		config.cleanupMaxAttempts ?? config.verifyMaxAttempts;
	const objectIoTimeoutMs =
		config.objectIoTimeoutMs ??
		Math.max(
			100,
			Math.min(
				30_000,
				Math.min(config.verifyLeaseSeconds, config.cleanupLeaseSeconds) *
					1_000 -
					251,
			),
		);
	validateWorker(config, cleanupMaxAttempts, objectIoTimeoutMs);

	async function verifyOne(stats: AttachmentWorkerStats) {
		const claim = await jobs.claimVerification({
			workerId: config.workerId,
			leaseSeconds: config.verifyLeaseSeconds,
			maxAttempts: config.verifyMaxAttempts,
		});
		if (!claim) return;
		stats.verificationClaimed += 1;
		try {
			await withTimeout(objectIoTimeoutMs, (signal) =>
				objectStore.verifyAndCommit(
					{
						quarantineKey: claim.upload.quarantineObjectKey,
						committedKey: claim.committedObjectKey,
						contentType: claim.upload.contentType,
						byteCount: claim.upload.byteCount,
						sha256: claim.upload.sha256,
					},
					signal,
				),
			);
		} catch (error) {
			if (isPermanentObjectVerificationError(error)) {
				const rejected = await jobs.rejectVerification(claim, error.code);
				if (rejected) stats.verificationRejected += 1;
				else stats.verificationStaleResults += 1;
				return;
			}
			const timedOut = error instanceof ObjectIoTimeoutError;
			const result = await jobs.retryVerification(claim, {
				errorCode: timedOut
					? "ATTACHMENT_STORE_TIMEOUT"
					: verificationErrorCode(error),
				maxAttempts: config.verifyMaxAttempts,
				delaySeconds: retryDelaySeconds(
					claim.attempt,
					config.random ?? Math.random,
				),
			});
			if (result === "retry") stats.verificationRetried += 1;
			else if (result === "dead") stats.verificationDead += 1;
			else stats.verificationStaleResults += 1;
			if (timedOut && result) stats.verificationTimeouts += 1;
			return;
		}
		const completed = await jobs.completeVerification(claim);
		if (completed) stats.verificationCompleted += 1;
		else stats.verificationStaleResults += 1;
	}

	async function cleanupOne(stats: AttachmentWorkerStats) {
		const claim = await jobs.claimCleanup({
			workerId: config.workerId,
			leaseSeconds: config.cleanupLeaseSeconds,
			retentionSeconds: config.cleanupRetentionSeconds,
			maxAttempts: cleanupMaxAttempts,
		});
		if (!claim) return;
		stats.cleanupClaimed += 1;
		const expectedKey = attachmentQuarantineKey(claim.upload);
		if (!hasExpectedQuarantineKey(claim.upload)) {
			const rejected = await jobs.rejectCleanup(
				claim,
				"ATTACHMENT_CLEANUP_KEY_INVALID",
			);
			if (rejected) stats.cleanupDead += 1;
			else stats.cleanupStaleResults += 1;
			return;
		}
		try {
			await withTimeout(objectIoTimeoutMs, (signal) =>
				objectStore.deleteQuarantine(
					{
						key: claim.upload.quarantineObjectKey,
						expectedKey,
					},
					signal,
				),
			);
			if (claim.committedObjectKey !== null) {
				const committedObjectKey = claim.committedObjectKey;
				await withTimeout(objectIoTimeoutMs, (signal) =>
					objectStore.deleteCommittedFeedback(
						{
							key: committedObjectKey,
							expectedKey: attachmentCommittedKey(claim.upload),
						},
						signal,
					),
				);
			}
		} catch (error) {
			if (
				error instanceof UnsafeQuarantineKeyError ||
				error instanceof UnsafeCommittedFeedbackKeyError
			) {
				const rejected = await jobs.rejectCleanup(
					claim,
					"ATTACHMENT_CLEANUP_KEY_INVALID",
				);
				if (rejected) stats.cleanupDead += 1;
				else stats.cleanupStaleResults += 1;
				return;
			}
			const timedOut = error instanceof ObjectIoTimeoutError;
			const result = await jobs.retryCleanup(claim, {
				errorCode: timedOut
					? "ATTACHMENT_CLEANUP_STORE_TIMEOUT"
					: "ATTACHMENT_CLEANUP_STORE_UNAVAILABLE",
				maxAttempts: cleanupMaxAttempts,
				delaySeconds: retryDelaySeconds(
					claim.attempt,
					config.random ?? Math.random,
				),
			});
			if (result === "retry") stats.cleanupRetried += 1;
			else if (result === "dead") stats.cleanupDead += 1;
			else stats.cleanupStaleResults += 1;
			if (timedOut && result) stats.cleanupTimeouts += 1;
			return;
		}
		const completed = await jobs.completeCleanup(claim);
		if (completed) stats.orphanCleanupCompleted += 1;
		else stats.cleanupStaleResults += 1;
	}

	async function tick(): Promise<AttachmentWorkerStats> {
		const maintenance =
			typeof jobs.maintain === "function"
				? await jobs.maintain({
						verificationMaxAttempts: config.verifyMaxAttempts,
						cleanupMaxAttempts,
						cleanupRetentionSeconds: config.cleanupRetentionSeconds,
						limit: config.maintenanceBatchSize ?? 100,
					})
				: emptyMaintenance();
		const stats = { ...emptyStats(), ...maintenance };
		await Promise.all([
			...Array.from({ length: config.verifyConcurrency }, () =>
				verifyOne(stats),
			),
			cleanupOne(stats),
		]);
		return stats;
	}

	return {
		id: config.workerId,
		tick,
		async run(signal: AbortSignal) {
			while (!signal.aborted) {
				try {
					const stats = await tick();
					if (Object.values(stats).some((value) => value > 0))
						console.info("Attachment worker batch", stats);
				} catch {
					console.error("Attachment worker tick failed", {
						workerId: config.workerId,
						code: "ATTACHMENT_WORKER_TICK_FAILED",
					});
				}
				if (!signal.aborted) await wait(config.pollIntervalMs, signal);
			}
		},
	};
}

function retryDelaySeconds(attempt: number, random: () => number) {
	const exponential = Math.min(15 * 60, 5 * 2 ** Math.max(0, attempt - 1));
	const unit = Math.max(0, Math.min(1, random()));
	return Math.max(1, Math.floor(exponential * (0.75 + unit * 0.5)));
}

function verificationErrorCode(error: unknown) {
	if (
		error instanceof ObjectVerificationError &&
		retryableVerificationCodes.has(error.code)
	)
		return error.code;
	return "ATTACHMENT_STORE_UNAVAILABLE";
}

const retryableVerificationCodes = new Set([
	"ATTACHMENT_COMMIT_MISMATCH",
	"ATTACHMENT_OBJECT_MISSING",
	"ATTACHMENT_STORE_UNAVAILABLE",
]);

class ObjectIoTimeoutError extends Error {
	constructor() {
		super("Attachment object I/O timed out");
	}
}

async function withTimeout<T>(
	timeoutMs: number,
	operation: (signal: AbortSignal) => Promise<T>,
) {
	const controller = new AbortController();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const timedOut = new Promise<never>((_, reject) => {
		timeout = setTimeout(() => {
			const error = new ObjectIoTimeoutError();
			controller.abort(error);
			reject(error);
		}, timeoutMs);
	});
	try {
		return await Promise.race([operation(controller.signal), timedOut]);
	} finally {
		if (timeout) clearTimeout(timeout);
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

function validateWorker(
	config: WorkerConfig,
	cleanupMaxAttempts: number,
	objectIoTimeoutMs: number,
) {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(config.workerId))
		throw new Error("Invalid attachment worker ID");
	if (
		!Number.isInteger(cleanupMaxAttempts) ||
		cleanupMaxAttempts < 2 ||
		cleanupMaxAttempts > 10
	)
		throw new Error("Invalid attachment cleanup retry limit");
	if (
		!Number.isInteger(objectIoTimeoutMs) ||
		objectIoTimeoutMs < 100 ||
		objectIoTimeoutMs + 250 >=
			Math.min(config.verifyLeaseSeconds, config.cleanupLeaseSeconds) * 1_000
	)
		throw new Error(
			"Attachment object-I/O timeout must be shorter than leases",
		);
}

function emptyMaintenance(): AttachmentJobMaintenance {
	return {
		verificationExhausted: 0,
		cleanupExhausted: 0,
		verificationBacklog: 0,
		cleanupBacklog: 0,
		oldestVerificationAgeSeconds: 0,
		oldestCleanupAgeSeconds: 0,
	};
}

function emptyStats(): AttachmentWorkerStats {
	return {
		...emptyMaintenance(),
		verificationClaimed: 0,
		verificationCompleted: 0,
		verificationRejected: 0,
		verificationRetried: 0,
		verificationDead: 0,
		verificationTimeouts: 0,
		verificationStaleResults: 0,
		cleanupClaimed: 0,
		orphanCleanupCompleted: 0,
		cleanupRetried: 0,
		cleanupDead: 0,
		cleanupTimeouts: 0,
		cleanupStaleResults: 0,
	};
}
