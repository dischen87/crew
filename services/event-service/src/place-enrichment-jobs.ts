import type { Sql } from "postgres";
import { DomainError } from "./domain";
import type { PlaceCandidateKind } from "./place-candidate";
import {
	hashText,
	normalizePlaceSearchQuery,
	PLACE_ENRICHMENT_VALIDATOR_VERSION,
	type PlaceEnrichmentClaim,
	type PlaceEnrichmentField,
	type PlaceEnrichmentJob,
	type PlaceEnrichmentPolicy,
	type PlaceEnrichmentStatus,
	type PlaceEnrichmentTarget,
	placeEnrichmentIdentity,
	safeEnrichmentCode,
} from "./place-enrichment";

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

export class PlaceEnrichmentService {
	constructor(
		private readonly jobs: PostgresPlaceEnrichmentJobs,
		private readonly policy: PlaceEnrichmentPolicy,
	) {}

	requestCandidate(candidateId: string) {
		return this.jobs.enqueueCandidate(candidateId, this.policy);
	}

	requestSearchMiss(input: {
		query: string;
		kind: PlaceCandidateKind;
		countryCode: string;
	}) {
		return this.jobs.enqueueSearchMiss(input, this.policy);
	}

	async status(id: string) {
		if (!/^pej_[a-f0-9]{64}$/.test(id)) throw enrichmentNotFound();
		const result = await this.jobs.get(id);
		if (!result) throw enrichmentNotFound();
		return result;
	}

	async requestRetry(id: string) {
		if (!/^pej_[a-f0-9]{64}$/.test(id)) throw enrichmentNotFound();
		await this.jobs.requestRetry(id);
		return this.status(id);
	}
}

export class PostgresPlaceEnrichmentJobs {
	constructor(
		private readonly sql: Sql,
		private readonly inTransaction = false,
	) {}

	async enqueueCandidate(
		candidateId: string,
		policy: PlaceEnrichmentPolicy,
	): Promise<PlaceEnrichmentJob> {
		validatePolicy(policy);
		if (!/^pcd_[a-f0-9]{64}$/.test(candidateId)) throw candidateNotFound();
		const [candidate] = await this.sql<CandidateSeedRow[]>`
			SELECT id, snapshot_hash AS "snapshotHash", source,
				source_record_url AS "sourceRecordUrl", kind, name, locality, region,
				country_code AS "countryCode", latitude, longitude
			FROM place_candidates
			WHERE id = ${candidateId} AND retired_at IS NULL
				AND (expires_at IS NULL OR expires_at > clock_timestamp())
		`;
		if (!candidate) throw candidateNotFound();
		return this.enqueue(
			{
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
			},
			policy,
		);
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
		if (!/^[A-Z]{2}$/.test(input.countryCode)) {
			throw new DomainError(
				400,
				"PLACE_ENRICHMENT_INPUT_INVALID",
				"Place enrichment input is invalid.",
			);
		}
		return this.enqueue(
			{
				type: "search_miss",
				query: normalizePlaceSearchQuery(input.query),
				kind: input.kind,
				countryCode: input.countryCode,
			},
			policy,
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
			new Set(fields.map(({ name }) => name)).size !== fields.length
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
		const fields = await this.sql<
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
		const normalizedFields = fields.map((field): PlaceEnrichmentField => {
			if (field.validatorVersion !== PLACE_ENRICHMENT_VALIDATOR_VERSION) {
				throw new Error("Place-enrichment validator invariant failed");
			}
			return {
				...field,
				validatorVersion: PLACE_ENRICHMENT_VALIDATOR_VERSION,
			};
		});
		const job = jobRecord(row);
		const [globalPlace] =
			job.target.type === "candidate"
				? await this.sql<{ id: string }[]>`
						SELECT id FROM global_places
						WHERE candidate_id = ${job.target.candidateId}
					`
				: [];
		return {
			job,
			fields: normalizedFields,
			globalPlaceId: globalPlace?.id ?? null,
		};
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
		const identity = placeEnrichmentIdentity(target, policy);
		const [row] = await this.sql<JobRow[]>`
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
			RETURNING ${jobColumns(this.sql)}
		`;
		if (!row) throw new Error("Place-enrichment enqueue invariant failed");
		return jobRecord(row);
	}

	private transaction<T>(work: (tx: Tx) => Promise<T>) {
		if (this.inTransaction) return work(this.sql);
		return this.sql.begin((transaction) =>
			work(transaction as unknown as Tx),
		) as Promise<T>;
	}
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

function boundedActual(value: number | undefined) {
	if (value === undefined) return null;
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error("Place-enrichment provider usage is invalid");
	}
	return value;
}
