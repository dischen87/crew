import { describe, expect, test } from "bun:test";
import { PushDeliveryError } from "./push-delivery";
import {
	type ClaimedPushJob,
	PushDeliveryWorker,
	type PushEligibilityResult,
	type PushFailureResult,
	type PushOutboxRepository,
} from "./push-outbox";
import { createPushPayloadKeyring } from "./push-payload";

const currentKey = "TxsYmFtlYMVPT1UZKmSGicjfoc8lhZ0kGQ3FgIZavhs";
const oldKey = "eKOfuEuHFGQeOZltcgU4hlzp3jYpRNrp3xvjzwjJkSE";
const payloads = createPushPayloadKeyring({
	current: { id: "worker-current", key: currentKey },
});
const baseTime = new Date("2026-07-18T12:00:00.000Z");

describe("push delivery worker", () => {
	test("rechecks and starts a bounded claimed batch in parallel with stable routing", async () => {
		const jobs = [job(1), job(2)];
		const jobIds = jobs.map(({ id }) => id);
		const repository = new FakePushOutbox(jobs);
		const calls: Array<{
			deliveryKey: string;
			requestId: string;
			causationRequestId: string;
		}> = [];
		let release: (() => void) | undefined;
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		let bothStarted: (() => void) | undefined;
		const started = new Promise<void>((resolve) => {
			bothStarted = resolve;
		});
		const worker = workerWith(repository, async (input) => {
			calls.push(input);
			if (calls.length === 2) bothStarted?.();
			await released;
		});
		const running = worker.runOnce();
		await started;
		expect(repository.rechecks).toHaveLength(2);
		expect(calls.map(({ deliveryKey }) => deliveryKey).sort()).toEqual(
			jobIds.sort(),
		);
		expect(calls[0]).toMatchObject({
			requestId: "event.request.1",
			causationRequestId: "event.cause.1",
		});
		release?.();
		expect(await running).toMatchObject({ claimed: 2, delivered: 2 });
	});

	test("suppresses an ineligible token snapshot before any provider call", async () => {
		const repository = new FakePushOutbox([job(3)]);
		repository.eligibility = { kind: "suppressed" };
		let providerCalls = 0;
		const stats = await workerWith(repository, async () => {
			providerCalls += 1;
		}).runOnce();
		expect(stats).toMatchObject({ suppressed: 1, delivered: 0 });
		expect(providerCalls).toBe(0);
		expect(repository.rechecks[0]?.pushToken).toBe("private-token-3");
	});

	test("retries rollout key skew without consuming an attempt and rejects tampering", async () => {
		const oldPayloads = createPushPayloadKeyring({
			current: { id: "worker-old", key: oldKey },
		});
		const skewed = job(4, {}, oldPayloads);
		const skewRepository = new FakePushOutbox([skewed]);
		expect(
			await workerWith(skewRepository, async () => {}).runOnce(),
		).toMatchObject({ retried: 1, payloadKeyUnavailable: 1 });
		expect(skewRepository.failures[0]).toMatchObject({
			outcomeCode: "payload_key_unavailable",
			preserveAttempt: true,
		});

		const invalidRepository = new FakePushOutbox([
			job(5, { sealedPayload: "v1.worker-current.bad.bad.bad" }),
		]);
		let sent = false;
		expect(
			await workerWith(invalidRepository, async () => {
				sent = true;
			}).runOnce(),
		).toMatchObject({ deadLettered: 1 });
		expect(sent).toBe(false);
		expect(invalidRepository.failures[0]?.outcomeCode).toBe("payload_invalid");
	});

	test("honors Retry-After and actually times out before the lease", async () => {
		const retryJob = job(6);
		const retryRepository = new FakePushOutbox([retryJob]);
		expect(
			await workerWith(retryRepository, async () => {
				throw new PushDeliveryError("provider_429", 5_000);
			}).runOnce(),
		).toMatchObject({ retried: 1, retryRateLimited: 1 });
		expect(retryRepository.failures[0]?.retryAt).toEqual(
			new Date(baseTime.getTime() + 5_000),
		);

		const timeoutRepository = new FakePushOutbox([job(7)]);
		let aborted = false;
		const stats = await workerWith(
			timeoutRepository,
			async ({ signal }) => {
				await new Promise<void>((resolve) => {
					signal?.addEventListener(
						"abort",
						() => {
							aborted = true;
							resolve();
						},
						{ once: true },
					);
				});
			},
			{ deliveryTimeoutMs: 10, leaseMs: 500 },
		).runOnce();
		expect(aborted).toBe(true);
		expect(stats).toMatchObject({ retried: 1, retryTimeout: 1 });
	});

	test("dead-letters exhausted or expiring work and rejects unsafe leases", async () => {
		const exhaustedRepository = new FakePushOutbox([
			job(8, { attemptCount: 3 }),
		]);
		expect(
			await workerWith(exhaustedRepository, async () => {
				throw new Error("provider unavailable");
			}).runOnce(),
		).toMatchObject({ deadLettered: 1 });
		expect(exhaustedRepository.failures[0]?.retryAt).toBeNull();

		const expiringRepository = new FakePushOutbox([
			job(9, { expiresAt: new Date(baseTime.getTime() + 1_500) }),
		]);
		expect(
			await workerWith(expiringRepository, async () => {
				throw new PushDeliveryError("provider_503", 5_000);
			}).runOnce(),
		).toMatchObject({ deadLettered: 1 });
		expect(expiringRepository.failures[0]?.retryAt).toBeNull();

		expect(() =>
			workerWith(new FakePushOutbox([]), async () => {}, {
				deliveryTimeoutMs: 100,
				leaseMs: 100,
			}),
		).toThrow("shorter than the lease");
	});
});

class FakePushOutbox implements PushOutboxRepository {
	readonly completed: string[] = [];
	readonly rechecks: Array<{ jobId: string; pushToken: string }> = [];
	readonly failures: Array<{
		retryAt: Date | null;
		outcomeCode: string;
		preserveAttempt?: boolean;
	}> = [];
	eligibility: PushEligibilityResult = {
		kind: "eligible",
		leaseUntil: new Date(baseTime.getTime() + 10_000),
		leaseFence: "2",
	};

	constructor(private readonly jobs: ClaimedPushJob[]) {}

	async claimDue() {
		return { jobs: this.jobs.splice(0), expired: 0, exhausted: 0 };
	}

	async recheckEligibility(input: { jobId: string; pushToken: string }) {
		this.rechecks.push(input);
		return this.eligibility;
	}

	async complete(input: { jobId: string }) {
		this.completed.push(input.jobId);
		return true;
	}

	async fail(input: {
		retryAt: Date | null;
		outcomeCode: string;
		preserveAttempt?: boolean;
	}): Promise<PushFailureResult> {
		this.failures.push(input);
		return input.retryAt ? "retried" : "dead_lettered";
	}
}

function job(
	sequence: number,
	overrides: Partial<ClaimedPushJob> = {},
	keyring = payloads,
): ClaimedPushJob {
	const id = `pjob_${sequence.toString(16).padStart(32, "0")}`;
	const eventJobId = `job_${sequence.toString(16).padStart(32, "0")}`;
	const recipientUserId = `usr_${sequence.toString(16).padStart(32, "0")}`;
	const deviceId = `dev_${sequence.toString(16).padStart(32, "0")}`;
	const requestId = `event.request.${sequence}`;
	const causationRequestId = `event.cause.${sequence}`;
	const expiresAt =
		overrides.expiresAt ?? new Date(baseTime.getTime() + 60_000);
	return {
		id,
		eventJobId,
		recipientUserId,
		deviceId,
		requestId,
		causationRequestId,
		sealedPayload: keyring.seal(
			{
				jobId: id,
				eventJobId,
				recipientUserId,
				deviceId,
				requestId,
				causationRequestId,
				expiresAt,
			},
			{
				pushToken: `private-token-${sequence}`,
				category: "event_reminder",
				templateKey: "event_starts_soon",
				deepLink: { rootEventId: `evt_root${sequence}` },
				locale: "de-CH",
				expiresAt,
			},
		),
		expiresAt,
		attemptCount: 1,
		leaseUntil: new Date(baseTime.getTime() + 10_000),
		leaseFence: "1",
		...overrides,
	};
}

function workerWith(
	repository: PushOutboxRepository,
	sendPushNotification: ConstructorParameters<
		typeof PushDeliveryWorker
	>[0]["sendPushNotification"],
	overrides: Partial<ConstructorParameters<typeof PushDeliveryWorker>[0]> = {},
) {
	return new PushDeliveryWorker({
		repository,
		payloads,
		sendPushNotification,
		workerId: "push-worker-test-1",
		batchSize: 10,
		leaseMs: 10_000,
		deliveryTimeoutMs: 1_000,
		maxAttempts: 3,
		baseBackoffMs: 1_000,
		maxBackoffMs: 10_000,
		now: () => new Date(baseTime),
		...overrides,
	});
}
