import type { Sql } from "postgres";
import { MagicLinkDeliveryError, type SendMagicLink } from "./delivery";
import {
	type DeliveryPayloadKeyring,
	DeliveryPayloadKeyUnavailableError,
	type MagicLinkDeliveryPayload,
} from "./delivery-payload";

const KEY_SKEW_RETRY_MIN_MS = 10_000;
const KEY_SKEW_RETRY_MAX_MS = 60_000;

export type ClaimedDeliveryJob = {
	id: string;
	sealedPayload: string;
	expiresAt: Date;
	attemptCount: number;
	leaseUntil: Date;
};

export type DeliveryClaim = {
	jobs: ClaimedDeliveryJob[];
	expired: number;
	exhausted: number;
};

export type DeliveryFailureResult = "retried" | "dead_lettered" | "stale";

export type DeliveryOutboxMaintenance = {
	purgedDelivered: number;
	purgedDeadLetter: number;
	backlog: number;
	oldestActiveAgeSeconds: number;
};

export interface DeliveryOutboxRepository {
	maintain?(input: {
		now: Date;
		retentionMs: number;
		limit: number;
	}): Promise<DeliveryOutboxMaintenance>;
	claimDue(input: {
		workerId: string;
		now: Date;
		leaseMs: number;
		limit: number;
		maxAttempts: number;
	}): Promise<DeliveryClaim>;
	complete(input: {
		jobId: string;
		workerId: string;
		now: Date;
	}): Promise<boolean>;
	fail(input: {
		jobId: string;
		workerId: string;
		now: Date;
		retryAt: Date | null;
		failureCode: string;
		preserveAttempt?: boolean;
	}): Promise<DeliveryFailureResult>;
}

type DeliveryJobRow = {
	id: string;
	sealedPayload: string;
	expiresAt: Date;
	attemptCount: number;
	leaseUntil: Date;
};

export class PostgresDeliveryOutboxRepository
	implements DeliveryOutboxRepository
{
	constructor(private readonly sql: Sql) {}

	async maintain(input: {
		now: Date;
		retentionMs: number;
		limit: number;
	}): Promise<DeliveryOutboxMaintenance> {
		return this.sql.begin(async (transaction) => {
			const sql = transaction as unknown as Sql;
			const purged = await sql<{ state: "delivered" | "dead_letter" }[]>`
				WITH purgeable AS (
					SELECT id
					FROM user_delivery_outbox
					WHERE state IN ('delivered', 'dead_letter')
						AND COALESCE(delivered_at, dead_lettered_at, updated_at)
							<= ${input.now} - ${input.retentionMs} * INTERVAL '1 millisecond'
					ORDER BY COALESCE(delivered_at, dead_lettered_at, updated_at), id
					FOR UPDATE SKIP LOCKED
					LIMIT ${input.limit}
				)
				DELETE FROM user_delivery_outbox AS jobs
				USING purgeable
				WHERE jobs.id = purgeable.id
				RETURNING jobs.state
			`;
			const [health] = await sql<
				{ backlog: number; oldestActiveAgeSeconds: number }[]
			>`
				SELECT
					count(*)::int AS backlog,
					COALESCE(
						GREATEST(
							0,
							floor(EXTRACT(EPOCH FROM (${input.now}::timestamptz - min(created_at))))
						)::int,
						0
					) AS "oldestActiveAgeSeconds"
				FROM user_delivery_outbox
				WHERE state IN ('pending', 'processing')
			`;
			return {
				purgedDelivered: purged.filter(({ state }) => state === "delivered")
					.length,
				purgedDeadLetter: purged.filter(({ state }) => state === "dead_letter")
					.length,
				backlog: health?.backlog ?? 0,
				oldestActiveAgeSeconds: health?.oldestActiveAgeSeconds ?? 0,
			};
		}) as Promise<DeliveryOutboxMaintenance>;
	}

	async claimDue(input: {
		workerId: string;
		now: Date;
		leaseMs: number;
		limit: number;
		maxAttempts: number;
	}): Promise<DeliveryClaim> {
		return this.sql.begin(async (transaction) => {
			const sql = transaction as unknown as Sql;
			const expired = await sql<{ id: string }[]>`
				WITH expired_jobs AS (
					SELECT id
					FROM user_delivery_outbox
					WHERE state IN ('pending', 'processing')
						AND token_expires_at <= ${input.now}
					FOR UPDATE SKIP LOCKED
					LIMIT 1000
				)
				UPDATE user_delivery_outbox AS jobs
				SET state = 'dead_letter',
					lease_owner = NULL,
					lease_until = NULL,
					failure_code = 'token_expired',
					dead_lettered_at = ${input.now},
					updated_at = ${input.now}
				FROM expired_jobs
				WHERE jobs.id = expired_jobs.id
				RETURNING jobs.id
			`;
			const exhausted = await sql<{ id: string }[]>`
				WITH exhausted_jobs AS (
					SELECT id
					FROM user_delivery_outbox
					WHERE attempt_count >= ${input.maxAttempts}
						AND (
							state = 'pending'
							OR
							(state = 'processing' AND lease_until <= ${input.now})
						)
					FOR UPDATE SKIP LOCKED
					LIMIT 1000
				)
				UPDATE user_delivery_outbox AS jobs
				SET state = 'dead_letter',
					lease_owner = NULL,
					lease_until = NULL,
					failure_code = 'attempts_exhausted',
					dead_lettered_at = ${input.now},
					updated_at = ${input.now}
				FROM exhausted_jobs
				WHERE jobs.id = exhausted_jobs.id
				RETURNING jobs.id
			`;
			const jobs = await sql<DeliveryJobRow[]>`
				WITH claimable AS (
					SELECT id
					FROM user_delivery_outbox
					WHERE token_expires_at > ${input.now}
						AND attempt_count < ${input.maxAttempts}
						AND (
							(state = 'pending' AND available_at <= ${input.now})
							OR
							(state = 'processing' AND lease_until <= ${input.now})
						)
					ORDER BY available_at, created_at, id
					FOR UPDATE SKIP LOCKED
					LIMIT ${input.limit}
				)
				UPDATE user_delivery_outbox AS jobs
				SET state = 'processing',
					attempt_count = jobs.attempt_count + 1,
					lease_owner = ${input.workerId},
					lease_until = ${input.now} + ${input.leaseMs} * INTERVAL '1 millisecond',
					updated_at = ${input.now}
				FROM claimable
				WHERE jobs.id = claimable.id
				RETURNING
					jobs.id,
					jobs.sealed_payload AS "sealedPayload",
					jobs.token_expires_at AS "expiresAt",
					jobs.attempt_count AS "attemptCount",
					jobs.lease_until AS "leaseUntil"
			`;
			return {
				jobs,
				expired: expired.length,
				exhausted: exhausted.length,
			};
		}) as Promise<DeliveryClaim>;
	}

	async complete(input: { jobId: string; workerId: string; now: Date }) {
		const completed = await this.sql<{ id: string }[]>`
			UPDATE user_delivery_outbox
			SET state = 'delivered',
				lease_owner = NULL,
				lease_until = NULL,
				failure_code = NULL,
				delivered_at = ${input.now},
				updated_at = ${input.now}
			WHERE id = ${input.jobId}
				AND state = 'processing'
				AND lease_owner = ${input.workerId}
				AND lease_until > ${input.now}
				AND token_expires_at > ${input.now}
			RETURNING id
		`;
		return completed.length === 1;
	}

	async fail(input: {
		jobId: string;
		workerId: string;
		now: Date;
		retryAt: Date | null;
		failureCode: string;
		preserveAttempt?: boolean;
	}): Promise<DeliveryFailureResult> {
		const [failed] = await this.sql<{ state: "pending" | "dead_letter" }[]>`
			UPDATE user_delivery_outbox
			SET state = ${input.retryAt ? "pending" : "dead_letter"},
				available_at = ${input.retryAt ?? input.now},
				lease_owner = NULL,
				lease_until = NULL,
				attempt_count = attempt_count - ${input.retryAt && input.preserveAttempt ? 1 : 0},
				failure_code = ${input.failureCode},
				dead_lettered_at = ${input.retryAt ? null : input.now},
				updated_at = ${input.now}
			WHERE id = ${input.jobId}
				AND state = 'processing'
				AND lease_owner = ${input.workerId}
				AND lease_until > ${input.now}
			RETURNING state
		`;
		if (!failed) return "stale";
		return failed.state === "pending" ? "retried" : "dead_lettered";
	}
}

export type DeliveryWorkerStats = {
	claimed: number;
	delivered: number;
	retried: number;
	deadLettered: number;
	expired: number;
	staleResults: number;
	payloadKeyUnavailable: number;
	invalidPayload: number;
	retryTimeout: number;
	retryRateLimited: number;
	retryProvider: number;
	purgedDelivered: number;
	purgedDeadLetter: number;
	backlog: number;
	oldestActiveAgeSeconds: number;
};

type DeliveryOutcomeClass =
	| "payload_key_unavailable"
	| "invalid_payload"
	| "timeout"
	| "rate_limited"
	| "provider";

export class MagicLinkDeliveryWorker {
	constructor(
		private readonly options: {
			repository: DeliveryOutboxRepository;
			payloads: DeliveryPayloadKeyring;
			sendMagicLink: SendMagicLink;
			workerId: string;
			batchSize: number;
			leaseMs: number;
			deliveryTimeoutMs: number;
			maxAttempts: number;
			baseBackoffMs: number;
			maxBackoffMs: number;
			terminalRetentionMs?: number;
			random?: () => number;
			now?: () => Date;
		},
	) {
		validateWorkerOptions(options);
	}

	async runOnce(): Promise<DeliveryWorkerStats> {
		const now = this.options.now ?? (() => new Date());
		const maintenance = this.options.repository.maintain
			? await this.options.repository.maintain({
					now: now(),
					retentionMs:
						this.options.terminalRetentionMs ?? 30 * 24 * 60 * 60 * 1_000,
					limit: this.options.batchSize,
				})
			: emptyMaintenance();
		const claim = await this.options.repository.claimDue({
			workerId: this.options.workerId,
			now: now(),
			leaseMs: this.options.leaseMs,
			limit: this.options.batchSize,
			maxAttempts: this.options.maxAttempts,
		});
		const stats: DeliveryWorkerStats = {
			claimed: claim.jobs.length,
			delivered: 0,
			retried: 0,
			deadLettered: claim.exhausted,
			expired: claim.expired,
			staleResults: 0,
			payloadKeyUnavailable: 0,
			invalidPayload: 0,
			retryTimeout: 0,
			retryRateLimited: 0,
			retryProvider: 0,
			...maintenance,
		};

		await Promise.all(claim.jobs.map((job) => this.deliver(job, stats, now)));
		return stats;
	}

	private async deliver(
		job: ClaimedDeliveryJob,
		stats: DeliveryWorkerStats,
		now: () => Date,
	) {
		let payload: MagicLinkDeliveryPayload;
		try {
			payload = this.options.payloads.open({
				jobId: job.id,
				sealedPayload: job.sealedPayload,
				expiresAt: job.expiresAt,
			});
		} catch (error) {
			const failedAt = now();
			if (error instanceof DeliveryPayloadKeyUnavailableError) {
				await this.recordFailure(
					job,
					stats,
					failedAt,
					this.keySkewRetryAt(job, failedAt),
					"payload_key_unavailable",
					true,
					"payload_key_unavailable",
				);
				return;
			}
			await this.recordFailure(
				job,
				stats,
				failedAt,
				null,
				"payload_invalid",
				false,
				"invalid_payload",
			);
			return;
		}

		const startedAt = now();
		if (
			payload.expiresAt.getTime() - startedAt.getTime() <=
			this.options.deliveryTimeoutMs
		) {
			await this.recordFailure(
				job,
				stats,
				startedAt,
				null,
				"token_expired",
				false,
				"provider",
			);
			return;
		}
		try {
			await this.sendWithTimeout({
				...payload,
				deliveryKey: job.id,
				requestId: job.id,
			});
			const completed = await this.options.repository.complete({
				jobId: job.id,
				workerId: this.options.workerId,
				now: now(),
			});
			if (completed) stats.delivered += 1;
			else stats.staleResults += 1;
		} catch (error) {
			const failedAt = now();
			const failureCode = deliveryFailureCode(error);
			const retryAt = this.retryAt(job, failedAt, error);
			await this.recordFailure(
				job,
				stats,
				failedAt,
				retryAt,
				failureCode,
				false,
				deliveryOutcomeClass(failureCode),
			);
		}
	}

	private keySkewRetryAt(job: ClaimedDeliveryJob, failedAt: Date) {
		const delay = Math.max(
			KEY_SKEW_RETRY_MIN_MS,
			Math.min(this.options.maxBackoffMs, KEY_SKEW_RETRY_MAX_MS),
		);
		const retryAt = new Date(failedAt.getTime() + delay);
		return retryAt < job.expiresAt ? retryAt : null;
	}

	private async sendWithTimeout(
		input: Omit<Parameters<SendMagicLink>[0], "signal">,
	) {
		const controller = new AbortController();
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const timedOut = new Promise<never>((_, reject) => {
			timeout = setTimeout(() => {
				const error = new MagicLinkDeliveryError("provider_timeout");
				reject(error);
				controller.abort(error);
			}, this.options.deliveryTimeoutMs);
		});
		try {
			await Promise.race([
				this.options.sendMagicLink({ ...input, signal: controller.signal }),
				timedOut,
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	}

	private retryAt(job: ClaimedDeliveryJob, failedAt: Date, error: unknown) {
		if (job.attemptCount >= this.options.maxAttempts) return null;
		const exponent = Math.min(job.attemptCount - 1, 30);
		const exponential = Math.min(
			this.options.baseBackoffMs * 2 ** exponent,
			this.options.maxBackoffMs,
		);
		const retryAfter =
			error instanceof MagicLinkDeliveryError ? (error.retryAfterMs ?? 0) : 0;
		const delay = Math.max(
			jitter(exponential, this.options.random ?? Math.random),
			retryAfter,
		);
		const retryAt = new Date(failedAt.getTime() + delay);
		return retryAt < job.expiresAt ? retryAt : null;
	}

	private async recordFailure(
		job: ClaimedDeliveryJob,
		stats: DeliveryWorkerStats,
		now: Date,
		retryAt: Date | null,
		failureCode: string,
		preserveAttempt = false,
		outcomeClass: DeliveryOutcomeClass = "provider",
	) {
		const result = await this.options.repository.fail({
			jobId: job.id,
			workerId: this.options.workerId,
			now,
			retryAt,
			failureCode,
			preserveAttempt,
		});
		if (result === "retried") {
			stats.retried += 1;
			if (outcomeClass === "timeout") stats.retryTimeout += 1;
			else if (outcomeClass === "rate_limited") stats.retryRateLimited += 1;
			else if (outcomeClass === "provider") stats.retryProvider += 1;
		} else if (result === "dead_lettered") stats.deadLettered += 1;
		else stats.staleResults += 1;
		if (result !== "stale" && outcomeClass === "payload_key_unavailable")
			stats.payloadKeyUnavailable += 1;
		if (result !== "stale" && outcomeClass === "invalid_payload")
			stats.invalidPayload += 1;
	}
}

function validateWorkerOptions(options: {
	workerId: string;
	batchSize: number;
	leaseMs: number;
	deliveryTimeoutMs: number;
	maxAttempts: number;
	baseBackoffMs: number;
	maxBackoffMs: number;
	terminalRetentionMs?: number;
}) {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(options.workerId)) {
		throw new Error("Invalid delivery worker ID");
	}
	if (!Number.isInteger(options.batchSize) || options.batchSize < 1) {
		throw new Error("Delivery batch size must be positive");
	}
	if (
		!Number.isInteger(options.deliveryTimeoutMs) ||
		options.deliveryTimeoutMs < 1 ||
		!Number.isInteger(options.leaseMs) ||
		options.deliveryTimeoutMs >= options.leaseMs
	) {
		throw new Error("Delivery timeout must be shorter than the lease");
	}
	if (
		!Number.isInteger(options.maxAttempts) ||
		options.maxAttempts < 1 ||
		options.maxAttempts > 20
	) {
		throw new Error("Delivery max attempts must be between 1 and 20");
	}
	if (
		!Number.isInteger(options.baseBackoffMs) ||
		options.baseBackoffMs < 1 ||
		!Number.isInteger(options.maxBackoffMs) ||
		options.maxBackoffMs < options.baseBackoffMs
	) {
		throw new Error("Invalid delivery retry backoff");
	}
	if (
		options.terminalRetentionMs !== undefined &&
		(!Number.isInteger(options.terminalRetentionMs) ||
			options.terminalRetentionMs < 60 * 60 * 1_000)
	) {
		throw new Error("Delivery terminal retention must be at least one hour");
	}
}

function deliveryFailureCode(error: unknown) {
	return error instanceof MagicLinkDeliveryError &&
		/^[a-z0-9_]{1,64}$/.test(error.code)
		? error.code
		: "provider_failure";
}

function deliveryOutcomeClass(code: string): DeliveryOutcomeClass {
	if (code === "provider_timeout") return "timeout";
	if (code === "provider_429") return "rate_limited";
	return "provider";
}

function jitter(milliseconds: number, random: () => number) {
	const unit = Math.max(0, Math.min(1, random()));
	return Math.max(1, Math.floor(milliseconds * (0.75 + unit * 0.5)));
}

function emptyMaintenance(): DeliveryOutboxMaintenance {
	return {
		purgedDelivered: 0,
		purgedDeadLetter: 0,
		backlog: 0,
		oldestActiveAgeSeconds: 0,
	};
}
