import { describe, expect, test } from "bun:test";
import { MagicLinkDeliveryError } from "./delivery";
import {
	type ClaimedDeliveryJob,
	type DeliveryFailureResult,
	type DeliveryOutboxRepository,
	MagicLinkDeliveryWorker,
} from "./delivery-outbox";
import { createDeliveryPayloadKeyring } from "./delivery-payload";

const payloads = createDeliveryPayloadKeyring({
	current: {
		id: "worker-test",
		key: "eKOfuEuHFGQeOZltcgU4hlzp3jYpRNrp3xvjzwjJkSE",
	},
});
const baseTime = new Date("2026-07-18T12:00:00.000Z");

describe("magic-link delivery worker", () => {
	test("starts a claimed batch in parallel inside one lease", async () => {
		const jobs = [job(1), job(2)];
		const repository = new FakeOutbox(jobs);
		let started = 0;
		let release: (() => void) | undefined;
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		let bothStarted: (() => void) | undefined;
		const startedPromise = new Promise<void>((resolve) => {
			bothStarted = resolve;
		});
		const worker = workerWith(repository, async () => {
			started += 1;
			if (started === 2) bothStarted?.();
			await released;
		});
		const running = worker.runOnce();
		await startedPromise;
		expect(started).toBe(2);
		release?.();
		expect(await running).toMatchObject({ claimed: 2, delivered: 2 });
		expect(repository.completed).toHaveLength(2);
	});

	test("honors Retry-After with bounded backoff and a stable delivery key", async () => {
		const queued = job(3);
		const repository = new FakeOutbox([queued]);
		let deliveryKey: string | undefined;
		const worker = workerWith(repository, async (input) => {
			deliveryKey = input.deliveryKey;
			throw new MagicLinkDeliveryError("provider_429", 5_000);
		});
		expect(await worker.runOnce()).toMatchObject({
			retried: 1,
			retryRateLimited: 1,
		});
		expect(deliveryKey).toBe(queued.id);
		expect(repository.failures[0]?.retryAt).toEqual(
			new Date(baseTime.getTime() + 5_000),
		);
	});

	test("actually times out the provider call before the lease", async () => {
		const repository = new FakeOutbox([job(4)]);
		let aborted = false;
		const worker = workerWith(
			repository,
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
			{ deliveryTimeoutMs: 10, leaseMs: 100 },
		);
		const stats = await worker.runOnce();
		expect(aborted).toBe(true);
		expect(stats).toMatchObject({ retried: 1, retryTimeout: 1 });
	});

	test("dead-letters when retry would outlive the token or attempts are spent", async () => {
		const expiring = job(5, {
			expiresAt: new Date(baseTime.getTime() + 500),
		});
		const repository = new FakeOutbox([expiring]);
		const worker = workerWith(repository, async () => {
			throw new MagicLinkDeliveryError("provider_503", 5_000);
		});
		expect(await worker.runOnce()).toMatchObject({ deadLettered: 1 });
		expect(repository.failures[0]?.retryAt).toBeNull();

		const exhaustedRepository = new FakeOutbox([job(6, { attemptCount: 3 })]);
		const exhausted = workerWith(exhaustedRepository, async () => {
			throw new Error("down");
		});
		expect(await exhausted.runOnce()).toMatchObject({ deadLettered: 1 });
	});

	test("rejects timeout configurations that can outlive a lease", () => {
		expect(() =>
			workerWith(new FakeOutbox([]), async () => {}, {
				deliveryTimeoutMs: 100,
				leaseMs: 100,
			}),
		).toThrow("shorter than the lease");
	});
});

class FakeOutbox implements DeliveryOutboxRepository {
	readonly completed: string[] = [];
	readonly failures: Array<{ retryAt: Date | null; failureCode: string }> = [];

	constructor(private readonly jobs: ClaimedDeliveryJob[]) {}

	async claimDue() {
		return { jobs: this.jobs.splice(0), expired: 0, exhausted: 0 };
	}

	async complete(input: { jobId: string }) {
		this.completed.push(input.jobId);
		return true;
	}

	async fail(input: {
		retryAt: Date | null;
		failureCode: string;
	}): Promise<DeliveryFailureResult> {
		this.failures.push(input);
		return input.retryAt ? "retried" : "dead_lettered";
	}
}

function job(
	sequence: number,
	overrides: Partial<ClaimedDeliveryJob> = {},
): ClaimedDeliveryJob {
	const id = `job_${sequence.toString(16).padStart(32, "0")}`;
	const expiresAt =
		overrides.expiresAt ?? new Date(baseTime.getTime() + 60_000);
	return {
		id,
		sealedPayload: payloads.seal(id, {
			email: `person-${sequence}@example.com`,
			token: `ml_${sequence.toString().padStart(43, "a")}`,
			expiresAt,
		}),
		expiresAt,
		attemptCount: 1,
		leaseUntil: new Date(baseTime.getTime() + 10_000),
		...overrides,
	};
}

function workerWith(
	repository: DeliveryOutboxRepository,
	sendMagicLink: ConstructorParameters<
		typeof MagicLinkDeliveryWorker
	>[0]["sendMagicLink"],
	overrides: Partial<
		ConstructorParameters<typeof MagicLinkDeliveryWorker>[0]
	> = {},
) {
	return new MagicLinkDeliveryWorker({
		repository,
		payloads,
		sendMagicLink,
		workerId: "worker-test-1",
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
