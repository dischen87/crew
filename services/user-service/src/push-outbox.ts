import type { Sql } from "postgres";
import { DeliveryPayloadKeyUnavailableError } from "./delivery-payload";
import { PushDeliveryError, type SendPushNotification } from "./push-delivery";
import type { PushDeliveryPayload, PushPayloadKeyring } from "./push-payload";

const KEY_SKEW_RETRY_MIN_MS = 10_000;
const KEY_SKEW_RETRY_MAX_MS = 60_000;
export const PUSH_DELIVERY_ACK_BUFFER_MS = 250;

export type ClaimedPushJob = {
	id: string;
	eventJobId: string;
	recipientUserId: string;
	deviceId: string;
	requestId: string;
	causationRequestId: string;
	sealedPayload: string;
	expiresAt: Date;
	attemptCount: number;
	leaseUntil: Date;
	leaseFence: string;
};

export type PushClaim = {
	jobs: ClaimedPushJob[];
	expired: number;
	exhausted: number;
};

export type PushFailureResult = "retried" | "dead_lettered" | "stale";
export type PushOutboxMaintenance = {
	purgedDelivered: number;
	purgedSuppressed: number;
	purgedDeadLetter: number;
	backlog: number;
	oldestActiveAgeSeconds: number;
};
export type PushEligibilityResult =
	| { kind: "eligible"; leaseUntil: Date; leaseFence: string }
	| { kind: "suppressed" }
	| { kind: "stale" };

export interface PushOutboxRepository {
	maintain?(input: {
		now: Date;
		retentionMs: number;
		limit: number;
	}): Promise<PushOutboxMaintenance>;
	claimDue(input: {
		workerId: string;
		now: Date;
		leaseMs: number;
		limit: number;
		maxAttempts: number;
	}): Promise<PushClaim>;
	recheckEligibility(input: {
		jobId: string;
		workerId: string;
		leaseFence: string;
		leaseMs: number;
		deliveryWindowMs: number;
		pushToken: string;
	}): Promise<PushEligibilityResult>;
	complete(input: {
		jobId: string;
		workerId: string;
		leaseFence: string;
	}): Promise<boolean>;
	fail(input: {
		jobId: string;
		workerId: string;
		leaseFence: string;
		now: Date;
		retryAt: Date | null;
		outcomeCode: string;
		preserveAttempt?: boolean;
	}): Promise<PushFailureResult>;
}

export class PostgresPushOutboxRepository implements PushOutboxRepository {
	constructor(private readonly sql: Sql) {}

	async maintain(input: {
		now: Date;
		retentionMs: number;
		limit: number;
	}): Promise<PushOutboxMaintenance> {
		return this.sql.begin(async (transaction) => {
			const sql = transaction as unknown as Sql;
			const purged = await sql<
				{ state: "delivered" | "suppressed" | "dead_letter" }[]
			>`
				WITH purgeable AS (
					SELECT id
					FROM user_push_outbox
					WHERE state IN ('delivered', 'suppressed', 'dead_letter')
						AND COALESCE(delivered_at, suppressed_at, dead_lettered_at, updated_at)
							<= ${input.now} - ${input.retentionMs} * INTERVAL '1 millisecond'
					ORDER BY COALESCE(delivered_at, suppressed_at, dead_lettered_at, updated_at), id
					FOR UPDATE SKIP LOCKED
					LIMIT ${input.limit}
				)
				DELETE FROM user_push_outbox AS jobs
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
				FROM user_push_outbox
				WHERE state IN ('pending', 'processing')
			`;
			return {
				purgedDelivered: purged.filter(({ state }) => state === "delivered")
					.length,
				purgedSuppressed: purged.filter(({ state }) => state === "suppressed")
					.length,
				purgedDeadLetter: purged.filter(({ state }) => state === "dead_letter")
					.length,
				backlog: health?.backlog ?? 0,
				oldestActiveAgeSeconds: health?.oldestActiveAgeSeconds ?? 0,
			};
		}) as Promise<PushOutboxMaintenance>;
	}

	async claimDue(input: {
		workerId: string;
		now: Date;
		leaseMs: number;
		limit: number;
		maxAttempts: number;
	}): Promise<PushClaim> {
		return this.sql.begin(async (transaction) => {
			const sql = transaction as unknown as Sql;
			const expired = await sql<{ id: string }[]>`
				WITH expired_jobs AS (
					SELECT id
					FROM user_push_outbox
					WHERE state IN ('pending', 'processing')
						AND expires_at <= ${input.now}
					FOR UPDATE SKIP LOCKED
					LIMIT 1000
				)
				UPDATE user_push_outbox AS jobs
				SET state = 'dead_letter',
					lease_owner = NULL,
					lease_until = NULL,
					outcome_code = 'notification_expired',
					dead_lettered_at = ${input.now},
					updated_at = ${input.now}
				FROM expired_jobs
				WHERE jobs.id = expired_jobs.id
				RETURNING jobs.id
			`;
			const exhausted = await sql<{ id: string }[]>`
				WITH exhausted_jobs AS (
					SELECT id
					FROM user_push_outbox
					WHERE attempt_count >= ${input.maxAttempts}
						AND (
							state = 'pending'
							OR (state = 'processing' AND lease_until <= ${input.now})
						)
					FOR UPDATE SKIP LOCKED
					LIMIT 1000
				)
				UPDATE user_push_outbox AS jobs
				SET state = 'dead_letter',
					lease_owner = NULL,
					lease_until = NULL,
					outcome_code = 'attempts_exhausted',
					dead_lettered_at = ${input.now},
					updated_at = ${input.now}
				FROM exhausted_jobs
				WHERE jobs.id = exhausted_jobs.id
				RETURNING jobs.id
			`;
			const jobs = await sql<ClaimedPushJob[]>`
				WITH claimable AS (
					SELECT id
					FROM user_push_outbox
					WHERE expires_at > ${input.now}
						AND attempt_count < ${input.maxAttempts}
						AND (
							(state = 'pending' AND available_at <= ${input.now})
							OR (state = 'processing' AND lease_until <= ${input.now})
						)
					ORDER BY available_at, created_at, id
					FOR UPDATE SKIP LOCKED
					LIMIT ${input.limit}
				)
				UPDATE user_push_outbox AS jobs
				SET state = 'processing',
					attempt_count = jobs.attempt_count + 1,
					lease_owner = ${input.workerId},
					lease_until = ${input.now} + ${input.leaseMs} * INTERVAL '1 millisecond',
					lease_fence = jobs.lease_fence + 1,
					updated_at = ${input.now}
				FROM claimable
				WHERE jobs.id = claimable.id
				RETURNING
					jobs.id,
					jobs.event_job_id AS "eventJobId",
					jobs.recipient_user_id AS "recipientUserId",
					jobs.device_id AS "deviceId",
					jobs.request_id AS "requestId",
					jobs.causation_request_id AS "causationRequestId",
					jobs.sealed_payload AS "sealedPayload",
					jobs.expires_at AS "expiresAt",
					jobs.attempt_count AS "attemptCount",
					jobs.lease_until AS "leaseUntil",
					jobs.lease_fence::text AS "leaseFence"
			`;
			return {
				jobs,
				expired: expired.length,
				exhausted: exhausted.length,
			};
		}) as Promise<PushClaim>;
	}

	async recheckEligibility(input: {
		jobId: string;
		workerId: string;
		leaseFence: string;
		leaseMs: number;
		deliveryWindowMs: number;
		pushToken: string;
	}): Promise<PushEligibilityResult> {
		return this.sql.begin(async (transaction) => {
			const sql = transaction as unknown as Sql;
			const [job] = await sql<{ recipientUserId: string; deviceId: string }[]>`
				SELECT
					recipient_user_id AS "recipientUserId",
					device_id AS "deviceId"
				FROM user_push_outbox
				WHERE id = ${input.jobId}
					AND state = 'processing'
					AND lease_owner = ${input.workerId}
					AND lease_fence = ${input.leaseFence}
				FOR UPDATE
			`;
			if (!job) return { kind: "stale" };

			const [eligible] = await sql<{ eligible: true }[]>`
				SELECT TRUE AS eligible
				FROM user_profiles AS p
				JOIN user_devices AS d ON d.user_id = p.user_id
				WHERE p.user_id = ${job.recipientUserId}
					AND p.event_reminders = TRUE
					AND d.id = ${job.deviceId}
					AND d.notifications_enabled = TRUE
					AND d.push_token = ${input.pushToken}
				FOR SHARE OF p, d
			`;
			if (eligible) {
				const [renewed] = await sql<{ leaseUntil: Date; leaseFence: string }[]>`
					UPDATE user_push_outbox
					SET lease_until = clock_timestamp() + ${input.leaseMs} * INTERVAL '1 millisecond',
						lease_fence = lease_fence + 1,
						updated_at = clock_timestamp()
					WHERE id = ${input.jobId}
						AND state = 'processing'
						AND lease_owner = ${input.workerId}
						AND lease_fence = ${input.leaseFence}
						AND lease_until > clock_timestamp()
						AND expires_at > clock_timestamp() + ${input.deliveryWindowMs} * INTERVAL '1 millisecond'
					RETURNING
						lease_until AS "leaseUntil",
						lease_fence::text AS "leaseFence"
				`;
				return renewed ? { kind: "eligible", ...renewed } : { kind: "stale" };
			}

			const suppressed = await sql<{ id: string }[]>`
				UPDATE user_push_outbox
				SET state = 'suppressed',
					lease_owner = NULL,
					lease_until = NULL,
					outcome_code = 'recipient_ineligible',
					suppressed_at = clock_timestamp(),
					updated_at = clock_timestamp()
				WHERE id = ${input.jobId}
					AND state = 'processing'
					AND lease_owner = ${input.workerId}
					AND lease_fence = ${input.leaseFence}
					AND lease_until > clock_timestamp()
					AND expires_at > clock_timestamp()
				RETURNING id
			`;
			return {
				kind: suppressed.length === 1 ? "suppressed" : "stale",
			};
		}) as Promise<PushEligibilityResult>;
	}

	async complete(input: {
		jobId: string;
		workerId: string;
		leaseFence: string;
	}) {
		const completed = await this.sql<{ id: string }[]>`
			UPDATE user_push_outbox
			SET state = 'delivered',
				lease_owner = NULL,
				lease_until = NULL,
				outcome_code = NULL,
				delivered_at = clock_timestamp(),
				updated_at = clock_timestamp()
			WHERE id = ${input.jobId}
				AND state = 'processing'
				AND lease_owner = ${input.workerId}
				AND lease_fence = ${input.leaseFence}
				AND lease_until > clock_timestamp()
				AND expires_at > clock_timestamp()
			RETURNING id
		`;
		return completed.length === 1;
	}

	async fail(input: {
		jobId: string;
		workerId: string;
		leaseFence: string;
		now: Date;
		retryAt: Date | null;
		outcomeCode: string;
		preserveAttempt?: boolean;
	}): Promise<PushFailureResult> {
		const [failed] = await this.sql<{ state: "pending" | "dead_letter" }[]>`
			UPDATE user_push_outbox
			SET state = ${input.retryAt ? "pending" : "dead_letter"},
				available_at = ${input.retryAt ?? input.now},
				lease_owner = NULL,
				lease_until = NULL,
				attempt_count = attempt_count - ${input.retryAt && input.preserveAttempt ? 1 : 0},
				outcome_code = ${input.outcomeCode},
				dead_lettered_at = ${input.retryAt ? null : input.now},
				updated_at = ${input.now}
			WHERE id = ${input.jobId}
				AND state = 'processing'
				AND lease_owner = ${input.workerId}
				AND lease_fence = ${input.leaseFence}
				AND lease_until > clock_timestamp()
			RETURNING state
		`;
		if (!failed) return "stale";
		return failed.state === "pending" ? "retried" : "dead_lettered";
	}
}

export type PushWorkerStats = {
	claimed: number;
	delivered: number;
	retried: number;
	deadLettered: number;
	expired: number;
	suppressed: number;
	staleResults: number;
	payloadKeyUnavailable: number;
	invalidPayload: number;
	retryTimeout: number;
	retryRateLimited: number;
	retryProvider: number;
	purgedDelivered: number;
	purgedSuppressed: number;
	purgedDeadLetter: number;
	backlog: number;
	oldestActiveAgeSeconds: number;
};

type PushOutcomeClass =
	| "payload_key_unavailable"
	| "invalid_payload"
	| "timeout"
	| "rate_limited"
	| "provider";

export class PushDeliveryWorker {
	constructor(
		private readonly options: {
			repository: PushOutboxRepository;
			payloads: PushPayloadKeyring;
			sendPushNotification: SendPushNotification;
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

	async runOnce(): Promise<PushWorkerStats> {
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
		const stats: PushWorkerStats = {
			claimed: claim.jobs.length,
			delivered: 0,
			retried: 0,
			deadLettered: claim.exhausted,
			expired: claim.expired,
			suppressed: 0,
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
		job: ClaimedPushJob,
		stats: PushWorkerStats,
		now: () => Date,
	) {
		let payload: PushDeliveryPayload;
		try {
			payload = this.options.payloads.open({
				jobId: job.id,
				eventJobId: job.eventJobId,
				recipientUserId: job.recipientUserId,
				deviceId: job.deviceId,
				requestId: job.requestId,
				causationRequestId: job.causationRequestId,
				expiresAt: job.expiresAt,
				sealedPayload: job.sealedPayload,
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
				"notification_expired",
				false,
				"provider",
			);
			return;
		}
		const eligibility = await this.options.repository.recheckEligibility({
			jobId: job.id,
			workerId: this.options.workerId,
			leaseFence: job.leaseFence,
			leaseMs: this.options.leaseMs,
			deliveryWindowMs:
				this.options.deliveryTimeoutMs + PUSH_DELIVERY_ACK_BUFFER_MS,
			pushToken: payload.pushToken,
		});
		if (eligibility.kind === "suppressed") {
			stats.suppressed += 1;
			return;
		}
		if (eligibility.kind === "stale") {
			stats.staleResults += 1;
			return;
		}
		const authorizedJob = {
			...job,
			leaseFence: eligibility.leaseFence,
			leaseUntil: eligibility.leaseUntil,
		};

		try {
			await this.sendWithTimeout({
				...payload,
				requestId: job.requestId,
				causationRequestId: job.causationRequestId,
				deliveryKey: job.id,
			});
			const completed = await this.options.repository.complete({
				jobId: job.id,
				workerId: this.options.workerId,
				leaseFence: authorizedJob.leaseFence,
			});
			if (completed) stats.delivered += 1;
			else stats.staleResults += 1;
		} catch (error) {
			const failedAt = now();
			const outcomeCode = pushFailureCode(error);
			await this.recordFailure(
				authorizedJob,
				stats,
				failedAt,
				this.retryAt(authorizedJob, failedAt, error),
				outcomeCode,
				false,
				pushOutcomeClass(outcomeCode),
			);
		}
	}

	private async sendWithTimeout(
		input: Omit<Parameters<SendPushNotification>[0], "signal">,
	) {
		const controller = new AbortController();
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const timedOut = new Promise<never>((_, reject) => {
			timeout = setTimeout(() => {
				const error = new PushDeliveryError("provider_timeout");
				reject(error);
				controller.abort(error);
			}, this.options.deliveryTimeoutMs);
		});
		try {
			await Promise.race([
				this.options.sendPushNotification({
					...input,
					signal: controller.signal,
				}),
				timedOut,
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	}

	private retryAt(job: ClaimedPushJob, failedAt: Date, error: unknown) {
		if (job.attemptCount >= this.options.maxAttempts) return null;
		const exponent = Math.min(job.attemptCount - 1, 30);
		const exponential = Math.min(
			this.options.baseBackoffMs * 2 ** exponent,
			this.options.maxBackoffMs,
		);
		const retryAfter =
			error instanceof PushDeliveryError ? (error.retryAfterMs ?? 0) : 0;
		const retryAt = new Date(
			failedAt.getTime() +
				Math.max(
					jitter(exponential, this.options.random ?? Math.random),
					retryAfter,
				),
		);
		return retryAt < job.expiresAt ? retryAt : null;
	}

	private keySkewRetryAt(job: ClaimedPushJob, failedAt: Date) {
		const delay = Math.max(
			KEY_SKEW_RETRY_MIN_MS,
			Math.min(this.options.maxBackoffMs, KEY_SKEW_RETRY_MAX_MS),
		);
		const retryAt = new Date(failedAt.getTime() + delay);
		return retryAt < job.expiresAt ? retryAt : null;
	}

	private async recordFailure(
		job: ClaimedPushJob,
		stats: PushWorkerStats,
		now: Date,
		retryAt: Date | null,
		outcomeCode: string,
		preserveAttempt = false,
		outcomeClass: PushOutcomeClass = "provider",
	) {
		const result = await this.options.repository.fail({
			jobId: job.id,
			workerId: this.options.workerId,
			leaseFence: job.leaseFence,
			now,
			retryAt,
			outcomeCode,
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
		throw new Error("Invalid push worker ID");
	}
	if (!Number.isInteger(options.batchSize) || options.batchSize < 1) {
		throw new Error("Push batch size must be positive");
	}
	if (
		!Number.isInteger(options.deliveryTimeoutMs) ||
		options.deliveryTimeoutMs < 1 ||
		!Number.isInteger(options.leaseMs) ||
		options.deliveryTimeoutMs + PUSH_DELIVERY_ACK_BUFFER_MS >= options.leaseMs
	) {
		throw new Error(
			"Push timeout plus ack buffer must be shorter than the lease",
		);
	}
	if (
		!Number.isInteger(options.maxAttempts) ||
		options.maxAttempts < 1 ||
		options.maxAttempts > 20
	) {
		throw new Error("Push max attempts must be between 1 and 20");
	}
	if (
		!Number.isInteger(options.baseBackoffMs) ||
		options.baseBackoffMs < 1 ||
		!Number.isInteger(options.maxBackoffMs) ||
		options.maxBackoffMs < options.baseBackoffMs
	) {
		throw new Error("Invalid push retry backoff");
	}
	if (
		options.terminalRetentionMs !== undefined &&
		(!Number.isInteger(options.terminalRetentionMs) ||
			options.terminalRetentionMs < 60 * 60 * 1_000)
	) {
		throw new Error("Push terminal retention must be at least one hour");
	}
}

function pushFailureCode(error: unknown) {
	return error instanceof PushDeliveryError &&
		/^[a-z0-9_]{1,64}$/.test(error.code)
		? error.code
		: "provider_failure";
}

function pushOutcomeClass(code: string): PushOutcomeClass {
	if (code === "provider_timeout") return "timeout";
	if (code === "provider_429") return "rate_limited";
	return "provider";
}

function jitter(milliseconds: number, random: () => number) {
	const unit = Math.max(0, Math.min(1, random()));
	return Math.max(1, Math.floor(milliseconds * (0.75 + unit * 0.5)));
}

function emptyMaintenance(): PushOutboxMaintenance {
	return {
		purgedDelivered: 0,
		purgedSuppressed: 0,
		purgedDeadLetter: 0,
		backlog: 0,
		oldestActiveAgeSeconds: 0,
	};
}
