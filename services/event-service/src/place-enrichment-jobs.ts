import type { Sql } from "postgres";
import { type CapabilityType, DomainError } from "./domain";
import type {
	PlaceCandidateInput,
	PlaceCandidateKind,
} from "./place-candidate";
import {
	canonicalEvidenceUrl,
	globalPlaceId,
	hashText,
	normalizePlaceSearchQuery,
	PLACE_ENRICHMENT_VALIDATOR_VERSION,
	type PlaceEnrichmentClaim,
	type PlaceEnrichmentField,
	type PlaceEnrichmentJob,
	type PlaceEnrichmentPolicy,
	type PlaceEnrichmentReviewDecision,
	type PlaceEnrichmentStatus,
	type PlaceEnrichmentTarget,
	PlaceEnrichmentValidationError,
	placeEnrichmentIdentity,
	reviewedPlaceCandidateSource,
	safeEnrichmentCode,
	validatePlaceEnrichmentFieldValue,
} from "./place-enrichment";
import { PostgresPlaceCandidateRepository } from "./postgres-place-candidate-repository";

type Tx = Sql;

type JobRow = {
	id: string;
	requestHash: string;
	targetType: "candidate" | "search_miss";
	candidateId: string | null;
	candidateSnapshotHash: string | null;
	candidateSource: string | null;
	candidateSourceUrl: string | null;
	searchQuery: string | null;
	kind: PlaceCandidateKind;
	name: string | null;
	locality: string | null;
	region: string | null;
	countryCode: string;
	latitude: number | null;
	longitude: number | null;
	pipelineVersion: string;
	model: string;
	promptVersion: string;
	maxAttempts: number;
	maxExaCalls: number;
	maxLlmCalls: number;
	maxInputTokens: number;
	maxOutputTokens: number;
	maxCostMicros: number;
	providerTimeoutMs: number;
	maxResponseBytes: number;
	exaCallsReserved: number;
	llmCallsReserved: number;
	inputTokensReserved: number;
	outputTokensReserved: number;
	costMicrosReserved: number;
	status: PlaceEnrichmentStatus;
	attempts: number;
	outcomeCode: string | null;
	createdAt: Date;
	updatedAt: Date;
	completedAt: Date | null;
};

type CandidateSeedRow = {
	id: string;
	snapshotHash: string;
	source: string;
	sourceRecordUrl: string | null;
	kind: PlaceCandidateKind;
	name: string;
	locality: string | null;
	region: string | null;
	countryCode: string;
	latitude: number | null;
	longitude: number | null;
};

type Admission = {
	actorId: string;
	rootEventId: string;
	eventId: string;
	capabilityType: CapabilityType;
	expectedKind: PlaceCandidateKind;
};

const ACTIVE_STATUSES: readonly PlaceEnrichmentStatus[] = [
	"pending",
	"processing",
	"retry",
];
const ACTOR_OUTSTANDING_LIMIT = 3;
const GLOBAL_OUTSTANDING_LIMIT = 100;
const ACTOR_DAILY_COST_LIMIT = 250_000;
const GLOBAL_DAILY_COST_LIMIT = 5_000_000;

export type PlaceEnrichmentProvider = "exa" | "llm";

export type PlaceEnrichmentProviderPermit = {
	id: string;
	jobId: string;
	attempt: number;
	provider: PlaceEnrichmentProvider;
	inputTokensReserved: number;
	outputTokensReserved: number;
	costMicrosReserved: number;
	timeoutMs: number;
	maxResponseBytes: number;
};

export class PostgresPlaceEnrichmentJobs {
	constructor(
		private readonly sql: Sql,
		private readonly inTransaction = false,
	) {}

	async heartbeat(workerId: string, ttlMs: number) {
		if (
			workerId.length < 1 ||
			workerId.length > 128 ||
			!Number.isInteger(ttlMs) ||
			ttlMs < 1_000 ||
			ttlMs > 300_000
		) {
			throw new Error("Place-enrichment worker heartbeat is invalid");
		}
		await this.sql`
			INSERT INTO place_enrichment_worker_health (
				singleton, worker_id, healthy_until, updated_at
			) VALUES (
				TRUE, ${workerId},
				clock_timestamp() + (${ttlMs} * interval '1 millisecond'),
				clock_timestamp()
			)
			ON CONFLICT (singleton) DO UPDATE SET
				worker_id = EXCLUDED.worker_id,
				healthy_until = EXCLUDED.healthy_until,
				updated_at = EXCLUDED.updated_at
		`;
	}

	async workerHealthy() {
		const [health] = await this.sql<{ healthy: boolean }[]>`
			SELECT TRUE AS healthy
			FROM place_enrichment_worker_health
			WHERE singleton AND healthy_until > clock_timestamp()
		`;
		return health?.healthy === true;
	}

	async enqueueCandidate(
		candidateId: string,
		policy: PlaceEnrichmentPolicy,
	): Promise<PlaceEnrichmentJob> {
		validatePolicy(policy);
		if (!/^pcd_[a-f0-9]{64}$/.test(candidateId)) throw candidateNotFound();
		return this.enqueue(await candidateTarget(this.sql, candidateId), policy);
	}

	admitCandidate(
		candidateId: string,
		policy: PlaceEnrichmentPolicy,
		admission: Admission,
	): Promise<PlaceEnrichmentJob> {
		validatePolicy(policy);
		if (!/^pcd_[a-f0-9]{64}$/.test(candidateId)) throw candidateNotFound();
		return this.transaction(async (tx) => {
			const target = await candidateTarget(tx, candidateId);
			assertExpectedKind(target.kind, admission.expectedKind);
			return this.admit(tx, target, policy, admission);
		});
	}

	enqueueSearchMiss(
		input: {
			query: string;
			kind: PlaceCandidateKind;
			countryCode: string;
		},
		policy: PlaceEnrichmentPolicy,
	) {
		validatePolicy(policy);
		validateSearchMiss(input);
		return this.enqueue(
			{
				type: "search_miss",
				query: normalizedSearchMissQuery(input.query),
				kind: input.kind,
				countryCode: input.countryCode,
			},
			policy,
		);
	}

	admitSearchMiss(
		input: {
			query: string;
			kind: PlaceCandidateKind;
			countryCode: string;
		},
		policy: PlaceEnrichmentPolicy,
		admission: Admission,
	): Promise<PlaceEnrichmentJob> {
		validatePolicy(policy);
		validateSearchMiss(input);
		assertExpectedKind(input.kind, admission.expectedKind);
		const query = normalizedSearchMissQuery(input.query);
		return this.transaction((tx) =>
			this.admit(
				tx,
				{
					type: "search_miss",
					query,
					kind: input.kind,
					countryCode: input.countryCode,
				},
				policy,
				admission,
			),
		);
	}

	async claim(input: {
		workerId: string;
		leaseMs: number;
	}): Promise<PlaceEnrichmentClaim | null> {
		if (
			input.workerId.length < 1 ||
			input.workerId.length > 128 ||
			!Number.isInteger(input.leaseMs) ||
			input.leaseMs < 1_000 ||
			input.leaseMs > 300_000
		) {
			throw new Error("Place-enrichment claim policy is invalid");
		}
		return this.sql.begin(async (transaction) => {
			const tx = transaction as unknown as Tx;
			await tx`
				UPDATE place_enrichment_attempts attempt SET
					finished_at = clock_timestamp(), outcome_code = 'ENRICHMENT_LEASE_EXPIRED'
				FROM place_enrichment_jobs job
				WHERE attempt.job_id = job.id AND attempt.attempt = job.attempts
					AND attempt.finished_at IS NULL AND job.status = 'processing'
					AND job.lease_until <= clock_timestamp()
			`;
			await tx`
				UPDATE place_enrichment_jobs SET
					status = 'dead', outcome_code = 'ENRICHMENT_ATTEMPTS_EXHAUSTED',
					lease_owner = NULL, lease_until = NULL,
					completed_at = clock_timestamp(), updated_at = clock_timestamp()
				WHERE attempts >= max_attempts AND (
					(status IN ('pending', 'retry') AND available_at <= clock_timestamp()) OR
					(status = 'processing' AND lease_until <= clock_timestamp())
				)
			`;
			const [candidate] = await tx<{ id: string }[]>`
				SELECT id FROM place_enrichment_jobs
				WHERE attempts < max_attempts AND (
					(status IN ('pending', 'retry') AND available_at <= clock_timestamp()) OR
					(status = 'processing' AND lease_until <= clock_timestamp())
				)
				AND EXISTS (
					SELECT 1 FROM place_enrichment_job_associations association
					WHERE association.job_id = place_enrichment_jobs.id
						AND association.reserved_cost_micros > 0
				)
				ORDER BY COALESCE(lease_until, available_at), id
				FOR UPDATE SKIP LOCKED LIMIT 1
			`;
			if (!candidate) return null;
			const [claimed] = await tx<(JobRow & { fence: string })[]>`
				UPDATE place_enrichment_jobs SET
					status = 'processing', attempts = attempts + 1,
					lease_owner = ${input.workerId},
					lease_until = clock_timestamp() + (${input.leaseMs} * interval '1 millisecond'),
					fence = fence + 1, outcome_code = NULL, completed_at = NULL,
					updated_at = clock_timestamp()
				WHERE id = ${candidate.id}
				RETURNING ${jobColumns(tx)}, fence::text AS fence
			`;
			if (!claimed) throw new Error("Place-enrichment claim invariant failed");
			await tx`
				INSERT INTO place_enrichment_attempts (
					job_id, attempt, worker_id, fence
				) VALUES (
					${claimed.id}, ${claimed.attempts}, ${input.workerId}, ${claimed.fence}
				)
			`;
			return {
				...jobRecord(claimed),
				workerId: input.workerId,
				fence: claimed.fence,
				attempt: claimed.attempts,
			};
		}) as Promise<PlaceEnrichmentClaim | null>;
	}

	async reserveProviderCall(
		claim: PlaceEnrichmentClaim,
		input: {
			provider: PlaceEnrichmentProvider;
			requestFingerprint: string;
			inputTokens: number;
			outputTokens: number;
			costMicros: number;
		},
	): Promise<PlaceEnrichmentProviderPermit | "stale" | "budget_exhausted"> {
		for (const value of [
			input.inputTokens,
			input.outputTokens,
			input.costMicros,
		]) {
			if (!Number.isSafeInteger(value) || value < 0) {
				throw new Error("Place-enrichment provider reservation is invalid");
			}
		}
		if (!/^[a-f0-9]{64}$/.test(input.requestFingerprint)) {
			throw new Error("Place-enrichment request fingerprint is invalid");
		}
		return this.sql.begin(async (transaction) => {
			const tx = transaction as unknown as Tx;
			const [job] = await tx<
				{
					maxExaCalls: number;
					maxLlmCalls: number;
					maxInputTokens: number;
					maxOutputTokens: number;
					maxCostMicros: number;
					exaCallsReserved: number;
					llmCallsReserved: number;
					inputTokensReserved: number;
					outputTokensReserved: number;
					costMicrosReserved: number;
					providerTimeoutMs: number;
					maxResponseBytes: number;
				}[]
			>`
				SELECT max_exa_calls AS "maxExaCalls", max_llm_calls AS "maxLlmCalls",
					max_input_tokens AS "maxInputTokens",
					max_output_tokens AS "maxOutputTokens",
					max_cost_micros AS "maxCostMicros",
					exa_calls_reserved AS "exaCallsReserved",
					llm_calls_reserved AS "llmCallsReserved",
					input_tokens_reserved AS "inputTokensReserved",
					output_tokens_reserved AS "outputTokensReserved",
					cost_micros_reserved AS "costMicrosReserved",
					provider_timeout_ms AS "providerTimeoutMs",
					max_response_bytes AS "maxResponseBytes"
				FROM place_enrichment_jobs
				WHERE ${ownedLease(tx, claim)}
					AND EXISTS (
						SELECT 1 FROM place_enrichment_job_associations association
						WHERE association.job_id = place_enrichment_jobs.id
							AND association.reserved_cost_micros > 0
					)
				FOR UPDATE
			`;
			if (!job) return "stale" as const;
			const calls =
				input.provider === "exa" ? job.exaCallsReserved : job.llmCallsReserved;
			const callLimit =
				input.provider === "exa" ? job.maxExaCalls : job.maxLlmCalls;
			if (
				calls + 1 > callLimit ||
				job.inputTokensReserved + input.inputTokens > job.maxInputTokens ||
				job.outputTokensReserved + input.outputTokens > job.maxOutputTokens ||
				job.costMicrosReserved + input.costMicros > job.maxCostMicros
			) {
				return "budget_exhausted" as const;
			}
			const sequence = job.exaCallsReserved + job.llmCallsReserved + 1;
			const id = `pec_${hashText(
				JSON.stringify([
					"crew:place-enrichment-call:v1",
					claim.id,
					claim.attempt,
					sequence,
					input.provider,
				]),
			)}`;
			const reserved = await tx`
				UPDATE place_enrichment_jobs SET
					exa_calls_reserved = exa_calls_reserved + ${input.provider === "exa" ? 1 : 0},
					llm_calls_reserved = llm_calls_reserved + ${input.provider === "llm" ? 1 : 0},
					input_tokens_reserved = input_tokens_reserved + ${input.inputTokens},
					output_tokens_reserved = output_tokens_reserved + ${input.outputTokens},
					cost_micros_reserved = cost_micros_reserved + ${input.costMicros},
					updated_at = clock_timestamp()
				WHERE ${ownedLease(tx, claim)}
				RETURNING id
			`;
			if (reserved.length !== 1) return "stale" as const;
			await tx`
				INSERT INTO place_enrichment_provider_calls (
					id, job_id, attempt, sequence, provider, request_fingerprint,
					input_tokens_reserved, output_tokens_reserved, cost_micros_reserved,
					timeout_ms, max_response_bytes
				) VALUES (
					${id}, ${claim.id}, ${claim.attempt}, ${sequence}, ${input.provider},
					${input.requestFingerprint}, ${input.inputTokens}, ${input.outputTokens},
					${input.costMicros}, ${job.providerTimeoutMs}, ${job.maxResponseBytes}
				)
			`;
			return {
				id,
				jobId: claim.id,
				attempt: claim.attempt,
				provider: input.provider,
				inputTokensReserved: input.inputTokens,
				outputTokensReserved: input.outputTokens,
				costMicrosReserved: input.costMicros,
				timeoutMs: job.providerTimeoutMs,
				maxResponseBytes: job.maxResponseBytes,
			};
		}) as Promise<PlaceEnrichmentProviderPermit | "stale" | "budget_exhausted">;
	}

	async recordProviderCall(
		permit: PlaceEnrichmentProviderPermit,
		result: {
			status: "succeeded" | "failed" | "invalid";
			code: string;
			responseBytes?: number;
			inputTokens?: number;
			outputTokens?: number;
			costMicros?: number;
			providerRequestId?: string;
		},
	) {
		const rows = await this.sql`
			UPDATE place_enrichment_provider_calls SET
				status = ${result.status}, outcome_code = ${safeEnrichmentCode(result.code)},
				response_bytes = ${boundedActual(result.responseBytes)},
				input_tokens_actual = ${boundedActual(result.inputTokens)},
				output_tokens_actual = ${boundedActual(result.outputTokens)},
				cost_micros_actual = ${boundedActual(result.costMicros)},
				provider_request_id_hash = ${result.providerRequestId ? hashText(result.providerRequestId) : null},
				completed_at = clock_timestamp()
			WHERE id = ${permit.id} AND job_id = ${permit.jobId}
				AND attempt = ${permit.attempt} AND status = 'reserved'
			RETURNING id
		`;
		return rows.length === 1;
	}

	async complete(claim: PlaceEnrichmentClaim, fields: PlaceEnrichmentField[]) {
		if (
			fields.length < 2 ||
			fields.length > 9 ||
			new Set(fields.map(({ name }) => name)).size !== fields.length ||
			fields.some(
				(field) =>
					field.approvalState !==
					(field.sourceKind === "candidate"
						? "auto_approved"
						: "pending_review"),
			)
		) {
			throw new Error("Place-enrichment field set is invalid");
		}
		return this.sql.begin(async (transaction) => {
			const tx = transaction as unknown as Tx;
			const completed = await tx`
				UPDATE place_enrichment_jobs SET
					status = 'succeeded', outcome_code = 'ENRICHMENT_COMPLETED',
					lease_owner = NULL, lease_until = NULL,
					completed_at = clock_timestamp(), updated_at = clock_timestamp()
				WHERE ${ownedLease(tx, claim)} RETURNING id
			`;
			if (completed.length !== 1) return false;
			for (const field of fields) {
				await tx`
					INSERT INTO place_enrichment_fields (
						job_id, field_name, value_text, source_kind, source_url,
						observed_at, model, prompt_version, validator_version,
						validation_state, approval_state, attempt
					) VALUES (
						${claim.id}, ${field.name}, ${field.value}, ${field.sourceKind},
						${field.sourceUrl}, ${field.observedAt}, ${field.model},
						${field.promptVersion}, ${field.validatorVersion},
						${field.validationState}, ${field.approvalState}, ${claim.attempt}
					)
				`;
			}
			await finishAttempt(tx, claim, "ENRICHMENT_COMPLETED");
			return true;
		}) as Promise<boolean>;
	}

	async retry(claim: PlaceEnrichmentClaim, code: string, delayMs: number) {
		const boundedDelay = Math.max(
			100,
			Math.min(3_600_000, Math.floor(delayMs)),
		);
		return this.sql.begin(async (transaction) => {
			const tx = transaction as unknown as Tx;
			const [job] = await tx<{ maxAttempts: number }[]>`
				SELECT max_attempts AS "maxAttempts" FROM place_enrichment_jobs
				WHERE ${ownedLease(tx, claim)} FOR UPDATE
			`;
			if (!job) return "stale" as const;
			const dead = claim.attempt >= job.maxAttempts;
			const outcome = dead
				? "ENRICHMENT_ATTEMPTS_EXHAUSTED"
				: safeEnrichmentCode(code);
			const updated = await tx`
				UPDATE place_enrichment_jobs SET
					status = ${dead ? "dead" : "retry"}, outcome_code = ${outcome},
					available_at = clock_timestamp() + (${boundedDelay} * interval '1 millisecond'),
					lease_owner = NULL, lease_until = NULL,
					completed_at = CASE WHEN ${dead} THEN clock_timestamp() ELSE NULL END,
					updated_at = clock_timestamp()
				WHERE ${ownedLease(tx, claim)}
				RETURNING id
			`;
			if (updated.length !== 1) return "stale" as const;
			await finishAttempt(tx, claim, outcome);
			return dead ? ("dead" as const) : ("retry" as const);
		}) as Promise<"stale" | "dead" | "retry">;
	}

	async fail(claim: PlaceEnrichmentClaim, code: string) {
		const outcome = safeEnrichmentCode(code);
		return this.sql.begin(async (transaction) => {
			const tx = transaction as unknown as Tx;
			const rows = await tx`
				UPDATE place_enrichment_jobs SET
					status = 'failed', outcome_code = ${outcome},
					lease_owner = NULL, lease_until = NULL,
					completed_at = clock_timestamp(), updated_at = clock_timestamp()
				WHERE ${ownedLease(tx, claim)} RETURNING id
			`;
			if (rows.length !== 1) return false;
			await finishAttempt(tx, claim, outcome);
			return true;
		}) as Promise<boolean>;
	}

	async get(id: string) {
		const [row] = await this.sql<JobRow[]>`
			SELECT ${jobColumns(this.sql)} FROM place_enrichment_jobs WHERE id = ${id}
		`;
		if (!row) return null;
		const fields = await enrichmentFields(this.sql, id);
		const job = jobRecord(row);
		const [globalPlace] =
			job.target.type === "candidate"
				? await this.sql<{ id: string }[]>`
						SELECT id FROM global_places
						WHERE candidate_id = ${job.target.candidateId}
					`
				: await this.sql<{ id: string }[]>`
						SELECT place.id FROM place_enrichment_reviews review
						JOIN global_places place
							ON place.candidate_id = review.candidate_id
						WHERE review.job_id = ${id} AND review.decision = 'approve'
					`;
		return {
			job,
			fields,
			globalPlaceId: globalPlace?.id ?? null,
		};
	}

	async getAssociated(actorId: string, rootEventId: string, id: string) {
		const [association] = await this.sql<{ found: boolean }[]>`
			SELECT TRUE AS found FROM place_enrichment_job_associations
			WHERE job_id = ${id} AND actor_id = ${actorId}
				AND root_event_id = ${rootEventId}
		`;
		const scopes = association
			? await this.sql<
					{
						eventId: string;
						capabilityType: CapabilityType;
					}[]
				>`
					SELECT event_id AS "eventId", capability_type AS "capabilityType"
					FROM place_enrichment_job_scopes
					WHERE job_id = ${id} AND actor_id = ${actorId}
						AND root_event_id = ${rootEventId}
				`
			: [];
		const result = association ? await this.get(id) : null;
		return result
			? {
					...result,
					associationScopes: scopes.map((scope) => ({
						rootEventId,
						eventId: scope.eventId,
						capabilityType: scope.capabilityType,
					})),
				}
			: null;
	}

	async reviewAssociated(
		actorId: string,
		rootEventId: string,
		eventId: string,
		capabilityType: CapabilityType,
		id: string,
		decision: PlaceEnrichmentReviewDecision,
		expectedKind: PlaceCandidateKind,
	) {
		return this.transaction(async (tx) => {
			const [association] = await tx<{ found: boolean }[]>`
				SELECT TRUE AS found FROM place_enrichment_job_scopes
				WHERE job_id = ${id} AND actor_id = ${actorId}
					AND root_event_id = ${rootEventId}
					AND event_id = ${eventId}
					AND capability_type = ${capabilityType}
			`;
			if (!association) throw enrichmentNotFound();
			const [row] = await tx<JobRow[]>`
				SELECT ${jobColumns(tx)} FROM place_enrichment_jobs
				WHERE id = ${id} FOR UPDATE
			`;
			if (!row) throw enrichmentNotFound();
			const job = jobRecord(row);
			const [review] = await tx<{ decision: PlaceEnrichmentReviewDecision }[]>`
				SELECT decision FROM place_enrichment_reviews WHERE job_id = ${id}
			`;
			if (review) {
				if (review.decision !== decision) throw enrichmentReviewConflict();
				return reviewResult(tx, id);
			}
			if (
				job.target.type !== "search_miss" ||
				job.target.kind !== expectedKind ||
				job.status !== "succeeded" ||
				job.outcomeCode !== "ENRICHMENT_COMPLETED" ||
				job.completedAt === null
			) {
				throw enrichmentReviewUnavailable();
			}

			const [usage] = await tx<
				{
					exaCalls: number;
					llmCalls: number;
					inputTokens: number;
					outputTokens: number;
					costMicros: number;
					openCalls: number;
				}[]
			>`
				SELECT
					count(*) FILTER (WHERE provider = 'exa')::int AS "exaCalls",
					count(*) FILTER (WHERE provider = 'llm')::int AS "llmCalls",
					COALESCE(sum(input_tokens_actual), 0)::int AS "inputTokens",
					COALESCE(sum(output_tokens_actual), 0)::int AS "outputTokens",
					COALESCE(sum(cost_micros_actual), 0)::int AS "costMicros",
					count(*) FILTER (WHERE status = 'reserved')::int AS "openCalls"
				FROM place_enrichment_provider_calls WHERE job_id = ${id}
			`;
			if (
				!usage ||
				usage.openCalls > 0 ||
				usage.exaCalls > job.policy.maxExaCalls ||
				usage.llmCalls > job.policy.maxLlmCalls ||
				usage.inputTokens > job.policy.maxInputTokens ||
				usage.outputTokens > job.policy.maxOutputTokens ||
				usage.costMicros > job.policy.maxCostMicros
			) {
				throw enrichmentReviewUnavailable();
			}

			const fields = await enrichmentFields(tx, id);
			assertReviewableFields(job, fields);
			if (decision === "reject") {
				await setReviewState(tx, id, fields.length, "rejected");
				await insertReview(
					tx,
					id,
					actorId,
					rootEventId,
					eventId,
					capabilityType,
					decision,
					null,
				);
				return reviewResult(tx, id);
			}

			const input = reviewedCandidateInput(job, fields);
			const [materialized] = await new PostgresPlaceCandidateRepository(
				tx,
				true,
			).importBatch([input]);
			if (!materialized || materialized.outcome === "stale") {
				throw enrichmentReviewUnavailable();
			}
			const candidateId = materialized.candidate.id;
			const placeId = globalPlaceId(candidateId);
			const [place] = await tx<{ id: string }[]>`
				INSERT INTO global_places (id, candidate_id)
				VALUES (${placeId}, ${candidateId})
				ON CONFLICT (candidate_id) DO UPDATE
					SET candidate_id = EXCLUDED.candidate_id
				RETURNING id
			`;
			if (place?.id !== placeId) throw enrichmentReviewUnavailable();
			await setReviewState(tx, id, fields.length, "human_approved");
			await insertReview(
				tx,
				id,
				actorId,
				rootEventId,
				eventId,
				capabilityType,
				decision,
				candidateId,
			);
			return reviewResult(tx, id);
		});
	}

	async requestRetryAssociated(
		actorId: string,
		rootEventId: string,
		id: string,
	) {
		const [association] = await this.sql<{ found: boolean }[]>`
			SELECT true AS found FROM place_enrichment_job_associations
			WHERE job_id = ${id} AND actor_id = ${actorId}
				AND root_event_id = ${rootEventId}
		`;
		if (!association) throw enrichmentNotFound();
		return this.requestRetry(id);
	}

	async requestRetry(id: string) {
		return this.transaction(async (tx) => {
			const [job] = await tx<JobRow[]>`
				SELECT ${jobColumns(tx)} FROM place_enrichment_jobs
				WHERE id = ${id} FOR UPDATE
			`;
			if (!job) throw enrichmentNotFound();
			if (job.status === "failed" || job.status === "dead") {
				throw new DomainError(
					409,
					"PLACE_ENRICHMENT_RETRY_UNAVAILABLE",
					"This place enrichment cannot be retried.",
				);
			}
			if (job.status !== "retry") return jobRecord(job);
			const [updated] = await tx<JobRow[]>`
				UPDATE place_enrichment_jobs SET
					available_at = clock_timestamp(), updated_at = clock_timestamp()
				WHERE id = ${id} AND status = 'retry'
				RETURNING ${jobColumns(tx)}
			`;
			if (!updated) throw new Error("Place-enrichment retry invariant failed");
			return jobRecord(updated);
		});
	}

	private async enqueue(
		target: PlaceEnrichmentTarget,
		policy: PlaceEnrichmentPolicy,
	) {
		return jobRecord(await insertJob(this.sql, target, policy));
	}

	private async admit(
		tx: Tx,
		target: PlaceEnrichmentTarget,
		policy: PlaceEnrichmentPolicy,
		admission: Admission,
	) {
		const identity = placeEnrichmentIdentity(target, policy);
		// ponytail: global serialization keeps exact quotas; shard by admission bucket if contention becomes measurable.
		await tx`
			SELECT pg_advisory_xact_lock(
				hashtextextended('place-enrichment-admission:v1', 0)
			)
		`;
		const [existing] = await tx<JobRow[]>`
			SELECT ${jobColumns(tx)} FROM place_enrichment_jobs
			WHERE id = ${identity.id}
		`;
		const [replay] = await tx<{ found: boolean }[]>`
			SELECT true AS found FROM place_enrichment_job_associations
			WHERE job_id = ${identity.id} AND actor_id = ${admission.actorId}
				AND root_event_id = ${admission.rootEventId}
		`;
		if (replay) {
			if (!existing)
				throw new Error("Place-enrichment association invariant failed");
			await insertAssociationScope(tx, identity.id, admission);
			return jobRecord(existing);
		}

		const active = !existing || ACTIVE_STATUSES.includes(existing.status);
		const [charged] = existing
			? await tx<{ found: boolean }[]>`
					SELECT true AS found FROM place_enrichment_job_associations
					WHERE job_id = ${identity.id} AND reserved_cost_micros > 0
				`
			: [];
		const [actorJobAssociation] = existing
			? await tx<{ found: boolean }[]>`
					SELECT true AS found FROM place_enrichment_job_associations
					WHERE job_id = ${identity.id} AND actor_id = ${admission.actorId}
					LIMIT 1
				`
			: [];
		const reservedCostMicros =
			active && !charged
				? (existing?.maxCostMicros ?? policy.maxCostMicros)
				: 0;
		const [usage] = await tx<
			{
				actorOutstanding: number;
				globalOutstanding: number;
				actorDailyCost: number;
				globalDailyCost: number;
			}[]
		>`
			SELECT
				(
					SELECT count(DISTINCT association.job_id)::int
					FROM place_enrichment_job_associations association
					JOIN place_enrichment_jobs job ON job.id = association.job_id
					WHERE association.actor_id = ${admission.actorId}
						AND job.status IN ('pending', 'processing', 'retry')
				) AS "actorOutstanding",
				(
					SELECT count(*)::int FROM place_enrichment_jobs job
					WHERE job.status IN ('pending', 'processing', 'retry')
						AND EXISTS (
							SELECT 1 FROM place_enrichment_job_associations association
							WHERE association.job_id = job.id
								AND association.reserved_cost_micros > 0
						)
				) AS "globalOutstanding",
				(
					SELECT COALESCE(sum(reserved_cost_micros), 0)::int
					FROM place_enrichment_job_associations
					WHERE actor_id = ${admission.actorId}
						AND reserved_cost_micros > 0
						AND created_at >= date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC')
							AT TIME ZONE 'UTC'
				) AS "actorDailyCost",
				(
					SELECT COALESCE(sum(reserved_cost_micros), 0)::int
					FROM place_enrichment_job_associations
					WHERE reserved_cost_micros > 0
						AND created_at >= date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC')
						AT TIME ZONE 'UTC'
				) AS "globalDailyCost"
		`;
		if (
			!usage ||
			(active &&
				!actorJobAssociation &&
				usage.actorOutstanding >= ACTOR_OUTSTANDING_LIMIT) ||
			(reservedCostMicros > 0 &&
				(usage.globalOutstanding >= GLOBAL_OUTSTANDING_LIMIT ||
					usage.actorDailyCost + reservedCostMicros > ACTOR_DAILY_COST_LIMIT ||
					usage.globalDailyCost + reservedCostMicros > GLOBAL_DAILY_COST_LIMIT))
		) {
			throw enrichmentCapacity();
		}

		const row = existing ?? (await insertJob(tx, target, policy));
		await tx`
			INSERT INTO place_enrichment_job_associations (
				job_id, actor_id, root_event_id, reserved_cost_micros
			) VALUES (
				${row.id}, ${admission.actorId}, ${admission.rootEventId},
				${reservedCostMicros}
			)
		`;
		await insertAssociationScope(tx, row.id, admission);
		return jobRecord(row);
	}

	private transaction<T>(work: (tx: Tx) => Promise<T>) {
		if (this.inTransaction) return work(this.sql);
		return this.sql.begin((transaction) =>
			work(transaction as unknown as Tx),
		) as Promise<T>;
	}
}

async function candidateTarget(
	tx: Tx,
	candidateId: string,
): Promise<PlaceEnrichmentTarget> {
	const [candidate] = await tx<CandidateSeedRow[]>`
		SELECT id, snapshot_hash AS "snapshotHash", source,
			source_record_url AS "sourceRecordUrl", kind, name, locality, region,
			country_code AS "countryCode", latitude, longitude
		FROM place_candidates
		WHERE id = ${candidateId} AND retired_at IS NULL
			AND (expires_at IS NULL OR expires_at > clock_timestamp())
	`;
	if (!candidate) throw candidateNotFound();
	return {
		type: "candidate",
		candidateId: candidate.id,
		candidateSnapshotHash: candidate.snapshotHash,
		candidateSource: candidate.source,
		candidateSourceUrl: candidate.sourceRecordUrl,
		kind: candidate.kind,
		name: candidate.name,
		locality: candidate.locality,
		region: candidate.region,
		countryCode: candidate.countryCode,
		latitude: candidate.latitude,
		longitude: candidate.longitude,
	};
}

async function insertJob(
	tx: Tx,
	target: PlaceEnrichmentTarget,
	policy: PlaceEnrichmentPolicy,
) {
	const identity = placeEnrichmentIdentity(target, policy);
	const [row] = await tx<JobRow[]>`
		INSERT INTO place_enrichment_jobs (
			id, request_hash, target_type, candidate_id, candidate_snapshot_hash,
			candidate_source, candidate_source_url, search_query, kind, name,
			locality, region, country_code, latitude, longitude, pipeline_version,
			model, prompt_version, max_attempts, max_exa_calls, max_llm_calls,
			max_input_tokens, max_output_tokens, max_cost_micros,
			provider_timeout_ms, max_response_bytes
		) VALUES (
			${identity.id}, ${identity.requestHash}, ${target.type},
			${target.type === "candidate" ? target.candidateId : null},
			${target.type === "candidate" ? target.candidateSnapshotHash : null},
			${target.type === "candidate" ? target.candidateSource : null},
			${target.type === "candidate" ? target.candidateSourceUrl : null},
			${target.type === "search_miss" ? target.query : null}, ${target.kind},
			${target.type === "candidate" ? target.name : null},
			${target.type === "candidate" ? target.locality : null},
			${target.type === "candidate" ? target.region : null},
			${target.countryCode},
			${target.type === "candidate" ? target.latitude : null},
			${target.type === "candidate" ? target.longitude : null},
			${policy.pipelineVersion}, ${policy.model}, ${policy.promptVersion},
			${policy.maxAttempts}, ${policy.maxExaCalls}, ${policy.maxLlmCalls},
			${policy.maxInputTokens}, ${policy.maxOutputTokens}, ${policy.maxCostMicros},
			${policy.providerTimeoutMs}, ${policy.maxResponseBytes}
		)
		ON CONFLICT (id) DO UPDATE SET request_hash = EXCLUDED.request_hash
		RETURNING ${jobColumns(tx)}
	`;
	if (!row) throw new Error("Place-enrichment enqueue invariant failed");
	return row;
}

async function enrichmentFields(tx: Tx, id: string) {
	const fields = await tx<
		{
			name: PlaceEnrichmentField["name"];
			value: string;
			sourceKind: PlaceEnrichmentField["sourceKind"];
			sourceUrl: string | null;
			observedAt: Date;
			model: string | null;
			promptVersion: string | null;
			validatorVersion: string;
			validationState: "passed";
			approvalState: PlaceEnrichmentField["approvalState"];
		}[]
	>`
		SELECT field_name AS name, value_text AS value,
			source_kind AS "sourceKind", source_url AS "sourceUrl",
			observed_at AS "observedAt", model, prompt_version AS "promptVersion",
			validator_version AS "validatorVersion",
			validation_state AS "validationState", approval_state AS "approvalState"
		FROM place_enrichment_fields WHERE job_id = ${id} ORDER BY field_name
	`;
	return fields.map((field): PlaceEnrichmentField => {
		if (field.validatorVersion !== PLACE_ENRICHMENT_VALIDATOR_VERSION) {
			throw new Error("Place-enrichment validator invariant failed");
		}
		return {
			...field,
			validatorVersion: PLACE_ENRICHMENT_VALIDATOR_VERSION,
		};
	});
}

function assertReviewableFields(
	job: PlaceEnrichmentJob,
	fields: readonly PlaceEnrichmentField[],
) {
	if (
		job.target.type !== "search_miss" ||
		fields.length < 2 ||
		fields.length > 9 ||
		new Set(fields.map(({ name }) => name)).size !== fields.length ||
		fields.some(
			(field) =>
				field.sourceKind !== "exa_llm" ||
				field.sourceUrl === null ||
				field.model === null ||
				field.promptVersion === null ||
				field.validationState !== "passed" ||
				field.approvalState !== "pending_review",
		)
	) {
		throw enrichmentReviewUnavailable();
	}
	const names = new Set(fields.map(({ name }) => name));
	if (
		!names.has("name") ||
		!names.has("countryCode") ||
		names.has("latitude") !== names.has("longitude")
	) {
		throw enrichmentReviewUnavailable();
	}
	try {
		for (const field of fields) {
			if (
				canonicalEvidenceUrl(field.sourceUrl as string) !== field.sourceUrl ||
				validatePlaceEnrichmentFieldValue(
					field.name,
					field.value,
					job.target.countryCode,
				) !== field.value
			) {
				throw enrichmentReviewUnavailable();
			}
		}
	} catch (error) {
		if (error instanceof DomainError) throw error;
		if (!(error instanceof PlaceEnrichmentValidationError)) throw error;
		throw enrichmentReviewUnavailable();
	}
}

function reviewedCandidateInput(
	job: PlaceEnrichmentJob,
	fields: readonly PlaceEnrichmentField[],
): PlaceCandidateInput {
	if (job.target.type !== "search_miss") throw enrichmentReviewUnavailable();
	const values = new Map(fields.map((field) => [field.name, field.value]));
	const value = (name: PlaceEnrichmentField["name"]) =>
		values.get(name) ?? null;
	const source = reviewedPlaceCandidateSource(fields);
	const retrievedAt = new Date(
		Math.max(...fields.map(({ observedAt }) => observedAt.getTime())),
	);
	return {
		source: "place_enrichment",
		sourceRecordId: source.sourceRecordId,
		kind: job.target.kind,
		name: value("name") as string,
		locality: value("locality"),
		region: value("region"),
		countryCode: value("countryCode") as string,
		latitude: value("latitude") === null ? null : Number(value("latitude")),
		longitude: value("longitude") === null ? null : Number(value("longitude")),
		sourceRecordUrl: source.sourceRecordUrl,
		license: {
			code: "human-reviewed-citation-v1",
			url: null,
			attribution: "Human-approved cited place facts",
			allowsSearchIndex: false,
		},
		retrievedAt,
		confidence: 1,
		expiresAt: null,
		retirement: null,
	};
}

async function setReviewState(
	tx: Tx,
	id: string,
	expectedFields: number,
	state: "human_approved" | "rejected",
) {
	const updated = await tx`
		UPDATE place_enrichment_fields SET approval_state = ${state}
		WHERE job_id = ${id} AND approval_state = 'pending_review'
		RETURNING field_name
	`;
	if (updated.length !== expectedFields) throw enrichmentReviewUnavailable();
}

async function insertReview(
	tx: Tx,
	id: string,
	actorId: string,
	rootEventId: string,
	eventId: string,
	capabilityType: CapabilityType,
	decision: PlaceEnrichmentReviewDecision,
	candidateId: string | null,
) {
	const inserted = await tx`
		INSERT INTO place_enrichment_reviews (
			job_id, actor_id, root_event_id, event_id, capability_type,
			decision, candidate_id
		) VALUES (
			${id}, ${actorId}, ${rootEventId}, ${eventId}, ${capabilityType},
			${decision}, ${candidateId}
		)
		RETURNING job_id
	`;
	if (inserted.length !== 1)
		throw new Error("Place-enrichment review invariant failed");
}

async function insertAssociationScope(
	tx: Tx,
	id: string,
	admission: Admission,
) {
	await tx`
		INSERT INTO place_enrichment_job_scopes (
			job_id, actor_id, root_event_id, event_id, capability_type
		) VALUES (
			${id}, ${admission.actorId}, ${admission.rootEventId},
			${admission.eventId}, ${admission.capabilityType}
		)
		ON CONFLICT DO NOTHING
	`;
}

async function reviewResult(tx: Tx, id: string) {
	const result = await new PostgresPlaceEnrichmentJobs(tx, true).get(id);
	if (!result) throw new Error("Place-enrichment review invariant failed");
	return result;
}

function jobColumns(sql: Tx) {
	return sql`
		id, request_hash AS "requestHash", target_type AS "targetType",
		candidate_id AS "candidateId", candidate_snapshot_hash AS "candidateSnapshotHash",
		candidate_source AS "candidateSource", candidate_source_url AS "candidateSourceUrl",
		search_query AS "searchQuery", kind, name, locality, region,
		country_code AS "countryCode", latitude, longitude,
		pipeline_version AS "pipelineVersion", model, prompt_version AS "promptVersion",
		max_attempts AS "maxAttempts", max_exa_calls AS "maxExaCalls",
		max_llm_calls AS "maxLlmCalls", max_input_tokens AS "maxInputTokens",
		max_output_tokens AS "maxOutputTokens", max_cost_micros AS "maxCostMicros",
		provider_timeout_ms AS "providerTimeoutMs", max_response_bytes AS "maxResponseBytes",
		exa_calls_reserved AS "exaCallsReserved", llm_calls_reserved AS "llmCallsReserved",
		input_tokens_reserved AS "inputTokensReserved",
		output_tokens_reserved AS "outputTokensReserved",
		cost_micros_reserved AS "costMicrosReserved", status, attempts,
		outcome_code AS "outcomeCode", created_at AS "createdAt",
		updated_at AS "updatedAt", completed_at AS "completedAt"
	`;
}

function jobRecord(row: JobRow): PlaceEnrichmentJob {
	const target: PlaceEnrichmentTarget =
		row.targetType === "candidate"
			? {
					type: "candidate",
					candidateId: required(row.candidateId),
					candidateSnapshotHash: required(row.candidateSnapshotHash),
					candidateSource: required(row.candidateSource),
					candidateSourceUrl: row.candidateSourceUrl,
					kind: row.kind,
					name: required(row.name),
					locality: row.locality,
					region: row.region,
					countryCode: row.countryCode,
					latitude: row.latitude,
					longitude: row.longitude,
				}
			: {
					type: "search_miss",
					query: required(row.searchQuery),
					kind: row.kind,
					countryCode: row.countryCode,
				};
	return {
		id: row.id,
		requestHash: row.requestHash,
		target,
		policy: {
			pipelineVersion: row.pipelineVersion,
			model: row.model,
			promptVersion: row.promptVersion,
			maxAttempts: row.maxAttempts,
			maxExaCalls: row.maxExaCalls,
			maxLlmCalls: row.maxLlmCalls,
			maxInputTokens: row.maxInputTokens,
			maxOutputTokens: row.maxOutputTokens,
			maxCostMicros: row.maxCostMicros,
			providerTimeoutMs: row.providerTimeoutMs,
			maxResponseBytes: row.maxResponseBytes,
		},
		status: row.status,
		attempts: row.attempts,
		budget: {
			exaCallsReserved: row.exaCallsReserved,
			llmCallsReserved: row.llmCallsReserved,
			inputTokensReserved: row.inputTokensReserved,
			outputTokensReserved: row.outputTokensReserved,
			costMicrosReserved: row.costMicrosReserved,
		},
		outcomeCode: row.outcomeCode,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		completedAt: row.completedAt,
	};
}

function ownedLease(tx: Tx, claim: PlaceEnrichmentClaim) {
	return tx`
		id = ${claim.id} AND status = 'processing'
		AND lease_owner = ${claim.workerId} AND fence = ${claim.fence}
		AND attempts = ${claim.attempt} AND lease_until > clock_timestamp()
	`;
}

async function finishAttempt(
	tx: Tx,
	claim: PlaceEnrichmentClaim,
	code: string,
) {
	await tx`
		UPDATE place_enrichment_attempts SET
			finished_at = clock_timestamp(), outcome_code = ${safeEnrichmentCode(code)}
		WHERE job_id = ${claim.id} AND attempt = ${claim.attempt}
			AND worker_id = ${claim.workerId} AND fence = ${claim.fence}
			AND finished_at IS NULL
	`;
}

function validatePolicy(policy: PlaceEnrichmentPolicy) {
	const identifiers = [policy.pipelineVersion, policy.promptVersion];
	if (
		identifiers.some((value) => !/^[A-Za-z0-9._-]{1,64}$/.test(value)) ||
		policy.model.length < 1 ||
		policy.model.length > 128 ||
		!integerBetween(policy.maxAttempts, 1, 10) ||
		!integerBetween(policy.maxExaCalls, 0, 4) ||
		!integerBetween(policy.maxLlmCalls, 0, 4) ||
		!integerBetween(policy.maxInputTokens, 1, 100_000) ||
		!integerBetween(policy.maxOutputTokens, 1, 4_096) ||
		!integerBetween(policy.maxCostMicros, 1, 1_000_000) ||
		!integerBetween(policy.providerTimeoutMs, 100, 30_000) ||
		!integerBetween(policy.maxResponseBytes, 1_024, 1_048_576)
	) {
		throw new Error("Place-enrichment policy is invalid");
	}
}

function validateSearchMiss(input: { countryCode: string }) {
	if (!/^[A-Z]{2}$/.test(input.countryCode)) {
		throw new DomainError(
			400,
			"PLACE_ENRICHMENT_INPUT_INVALID",
			"Place enrichment input is invalid.",
		);
	}
}

function normalizedSearchMissQuery(value: string) {
	try {
		return normalizePlaceSearchQuery(value);
	} catch (error) {
		if (!(error instanceof PlaceEnrichmentValidationError)) throw error;
		throw new DomainError(
			400,
			"PLACE_ENRICHMENT_INPUT_INVALID",
			"Place enrichment input is invalid.",
		);
	}
}

function assertExpectedKind(
	actual: PlaceCandidateKind,
	expected: PlaceCandidateKind,
) {
	if (actual !== expected) throw enrichmentScopeInvalid();
}

function integerBetween(value: number, minimum: number, maximum: number) {
	return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function required(value: string | null) {
	if (value === null)
		throw new Error("Place-enrichment target invariant failed");
	return value;
}

function candidateNotFound() {
	return new DomainError(
		404,
		"PLACE_CANDIDATE_NOT_FOUND",
		"The place candidate was not found.",
	);
}

function enrichmentNotFound() {
	return new DomainError(
		404,
		"PLACE_ENRICHMENT_NOT_FOUND",
		"The place enrichment job was not found.",
	);
}

function enrichmentScopeInvalid() {
	return new DomainError(
		409,
		"PLACE_ENRICHMENT_SCOPE_INVALID",
		"Place enrichment is not available for this event capability.",
	);
}

function enrichmentReviewUnavailable() {
	return new DomainError(
		409,
		"PLACE_ENRICHMENT_REVIEW_UNAVAILABLE",
		"This place enrichment cannot be reviewed.",
	);
}

function enrichmentReviewConflict() {
	return new DomainError(
		409,
		"PLACE_ENRICHMENT_REVIEW_CONFLICT",
		"This place enrichment already has a different review decision.",
	);
}

function enrichmentCapacity() {
	return new DomainError(
		409,
		"PLACE_ENRICHMENT_CAPACITY",
		"Place enrichment capacity is temporarily exhausted.",
		{ "Retry-After": "60" },
	);
}

function boundedActual(value: number | undefined) {
	if (value === undefined) return null;
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error("Place-enrichment provider usage is invalid");
	}
	return value;
}
