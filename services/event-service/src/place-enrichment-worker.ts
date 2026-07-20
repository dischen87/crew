import type { BoundedFetch } from "./bounded-fetch";
import {
	candidatePlaceFields,
	canonicalEvidenceUrl,
	mergeValidatedPlaceFields,
	needsPlaceEnrichmentFallback,
	type PlaceEnrichmentField,
	PlaceEnrichmentValidationError,
} from "./place-enrichment";
import type { PostgresPlaceEnrichmentJobs } from "./place-enrichment-jobs";
import {
	extractPlaceFields,
	maximumLlmCostMicros,
	type PlaceEnrichmentEvidence,
	PlaceEnrichmentProviderError,
	prepareExaRequest,
	prepareLlmRequest,
	searchExa,
} from "./place-enrichment-providers";
import type { PlaceEnrichmentWorkerConfig } from "./place-enrichment-worker-config";

type WorkerConfig = Omit<
	PlaceEnrichmentWorkerConfig,
	"databaseUrl" | "environment"
>;
export type PlaceEnrichmentJobs = Pick<
	PostgresPlaceEnrichmentJobs,
	| "claim"
	| "reserveProviderCall"
	| "recordProviderCall"
	| "complete"
	| "retry"
	| "fail"
>;

export function createPlaceEnrichmentWorker(
	config: WorkerConfig,
	jobs: PlaceEnrichmentJobs,
	dependencies: { fetch?: BoundedFetch; now?: () => Date } = {},
) {
	const now = dependencies.now ?? (() => new Date());
	const fetcher = dependencies.fetch ?? fetch;

	async function processOne() {
		const claim = await jobs.claim({
			workerId: config.workerId,
			leaseMs: config.leaseMs,
		});
		if (!claim) return false;

		const observedAt = now();
		const deterministic = candidatePlaceFields(claim, observedAt);
		if (!needsPlaceEnrichmentFallback(deterministic)) {
			await jobs.complete(claim, deterministic);
			return true;
		}

		const exaRequest = prepareExaRequest(claim, config.exaMaxResults);
		const exaPermit = await jobs.reserveProviderCall(claim, {
			provider: "exa",
			requestFingerprint: exaRequest.fingerprint,
			inputTokens: 0,
			outputTokens: 0,
			costMicros: config.exaMaxCostMicrosPerCall,
		});
		if (typeof exaPermit === "string") {
			if (exaPermit === "budget_exhausted") {
				await jobs.fail(claim, "ENRICHMENT_BUDGET_EXHAUSTED");
			}
			return true;
		}

		let exa: Awaited<ReturnType<typeof searchExa>>;
		try {
			exa = await searchExa(exaRequest, exaPermit, {
				baseUrl: config.exaBaseUrl,
				apiKey: config.exaApiKey,
				fetch: fetcher,
			});
		} catch (error) {
			await providerFailure(jobs, claim, exaPermit, error, config);
			return true;
		}
		if (
			exa.costMicros !== undefined &&
			exa.costMicros > exaPermit.costMicrosReserved
		) {
			await jobs.recordProviderCall(exaPermit, {
				status: "invalid",
				code: "ENRICHMENT_PROVIDER_BUDGET_VIOLATION",
				responseBytes: exa.responseBytes,
				costMicros: exa.costMicros,
				...(exa.providerRequestId
					? { providerRequestId: exa.providerRequestId }
					: {}),
			});
			await jobs.fail(claim, "ENRICHMENT_PROVIDER_BUDGET_VIOLATION");
			return true;
		}
		if (exa.evidence.length === 0) {
			await jobs.recordProviderCall(exaPermit, {
				status: "succeeded",
				code: "ENRICHMENT_EXA_COMPLETED",
				responseBytes: exa.responseBytes,
				...(exa.costMicros !== undefined ? { costMicros: exa.costMicros } : {}),
				...(exa.providerRequestId
					? { providerRequestId: exa.providerRequestId }
					: {}),
			});
			await jobs.fail(claim, "ENRICHMENT_SOURCE_NOT_FOUND");
			return true;
		}
		const exaRecorded = await jobs.recordProviderCall(exaPermit, {
			status: "succeeded",
			code: "ENRICHMENT_EXA_COMPLETED",
			responseBytes: exa.responseBytes,
			...(exa.costMicros !== undefined ? { costMicros: exa.costMicros } : {}),
			...(exa.providerRequestId
				? { providerRequestId: exa.providerRequestId }
				: {}),
		});
		if (!exaRecorded) return true;
		const evidence = boundEvidence(exa.evidence, config.maxEvidenceCharacters);
		const llmOutputTokens = Math.min(
			config.llmMaxOutputTokensPerCall,
			claim.policy.maxOutputTokens - claim.budget.outputTokensReserved,
		);
		if (llmOutputTokens < 64) {
			await jobs.fail(claim, "ENRICHMENT_BUDGET_EXHAUSTED");
			return true;
		}
		const llmRequest = prepareLlmRequest(claim, evidence, llmOutputTokens);
		const llmCost = maximumLlmCostMicros(
			llmRequest.inputTokenUpperBound,
			llmOutputTokens,
			config.llmInputCostMicrosPerMillionTokens,
			config.llmOutputCostMicrosPerMillionTokens,
		);
		const llmPermit = await jobs.reserveProviderCall(claim, {
			provider: "llm",
			requestFingerprint: llmRequest.fingerprint,
			inputTokens: llmRequest.inputTokenUpperBound,
			outputTokens: llmOutputTokens,
			costMicros: llmCost,
		});
		if (typeof llmPermit === "string") {
			if (llmPermit === "budget_exhausted") {
				await jobs.fail(claim, "ENRICHMENT_BUDGET_EXHAUSTED");
			}
			return true;
		}

		let llm: Awaited<ReturnType<typeof extractPlaceFields>>;
		try {
			llm = await extractPlaceFields(llmRequest, llmPermit, {
				url: config.llmUrl,
				apiKey: config.llmApiKey,
				inputCostMicrosPerMillionTokens:
					config.llmInputCostMicrosPerMillionTokens,
				outputCostMicrosPerMillionTokens:
					config.llmOutputCostMicrosPerMillionTokens,
				fetch: fetcher,
			});
		} catch (error) {
			await providerFailure(jobs, claim, llmPermit, error, config);
			return true;
		}
		if (
			(llm.inputTokens !== undefined &&
				llm.inputTokens > llmPermit.inputTokensReserved) ||
			(llm.outputTokens !== undefined &&
				llm.outputTokens > llmPermit.outputTokensReserved) ||
			(llm.costMicros !== undefined &&
				llm.costMicros > llmPermit.costMicrosReserved)
		) {
			await jobs.recordProviderCall(llmPermit, {
				status: "invalid",
				code: "ENRICHMENT_PROVIDER_BUDGET_VIOLATION",
				responseBytes: llm.responseBytes,
				...(llm.inputTokens !== undefined
					? { inputTokens: llm.inputTokens }
					: {}),
				...(llm.outputTokens !== undefined
					? { outputTokens: llm.outputTokens }
					: {}),
				...(llm.costMicros !== undefined ? { costMicros: llm.costMicros } : {}),
				...(llm.providerRequestId
					? { providerRequestId: llm.providerRequestId }
					: {}),
			});
			await jobs.fail(claim, "ENRICHMENT_PROVIDER_BUDGET_VIOLATION");
			return true;
		}

		let fields: PlaceEnrichmentField[];
		try {
			fields = mergeValidatedPlaceFields(
				claim,
				deterministic,
				llm.fields,
				new Set(evidence.map(({ url }) => canonicalEvidenceUrl(url))),
				observedAt,
			);
		} catch (error) {
			await jobs.recordProviderCall(llmPermit, {
				status: "invalid",
				code:
					error instanceof PlaceEnrichmentValidationError
						? "ENRICHMENT_LLM_FACTS_INVALID"
						: "ENRICHMENT_LLM_OUTPUT_INVALID",
				responseBytes: llm.responseBytes,
				...(llm.inputTokens !== undefined
					? { inputTokens: llm.inputTokens }
					: {}),
				...(llm.outputTokens !== undefined
					? { outputTokens: llm.outputTokens }
					: {}),
				...(llm.costMicros !== undefined ? { costMicros: llm.costMicros } : {}),
				...(llm.providerRequestId
					? { providerRequestId: llm.providerRequestId }
					: {}),
			});
			await jobs.fail(claim, "ENRICHMENT_LLM_FACTS_INVALID");
			return true;
		}

		const recorded = await jobs.recordProviderCall(llmPermit, {
			status: "succeeded",
			code: "ENRICHMENT_LLM_COMPLETED",
			responseBytes: llm.responseBytes,
			...(llm.inputTokens !== undefined
				? { inputTokens: llm.inputTokens }
				: {}),
			...(llm.outputTokens !== undefined
				? { outputTokens: llm.outputTokens }
				: {}),
			...(llm.costMicros !== undefined ? { costMicros: llm.costMicros } : {}),
			...(llm.providerRequestId
				? { providerRequestId: llm.providerRequestId }
				: {}),
		});
		if (!recorded) return true;
		await jobs.complete(claim, fields);
		return true;
	}

	return {
		id: config.workerId,
		processOne,
		tick: processOne,
		async run(signal: AbortSignal) {
			while (!signal.aborted) {
				try {
					await processOne();
				} catch {
					console.error("Place enrichment worker tick failed", {
						workerId: config.workerId,
						code: "PLACE_ENRICHMENT_WORKER_TICK_FAILED",
					});
				}
				if (!signal.aborted) await Bun.sleep(config.pollIntervalMs);
			}
		},
	};
}

async function providerFailure(
	jobs: PlaceEnrichmentJobs,
	claim: Parameters<PostgresPlaceEnrichmentJobs["retry"]>[0],
	permit: Parameters<PostgresPlaceEnrichmentJobs["recordProviderCall"]>[0],
	error: unknown,
	config: WorkerConfig,
) {
	const providerError =
		error instanceof PlaceEnrichmentProviderError
			? error
			: new PlaceEnrichmentProviderError(
					"ENRICHMENT_PROVIDER_UNAVAILABLE",
					true,
				);
	await jobs.recordProviderCall(permit, {
		status: providerError.code.includes("INVALID") ? "invalid" : "failed",
		code: providerError.code,
		responseBytes: providerError.responseBytes,
	});
	if (providerError.retryable) {
		await jobs.retry(
			claim,
			providerError.code,
			retryDelayMs(claim.attempt, config.baseBackoffMs, config.maxBackoffMs),
		);
	} else {
		await jobs.fail(claim, providerError.code);
	}
}

function boundEvidence(
	evidence: PlaceEnrichmentEvidence[],
	maximumCharacters: number,
) {
	let remaining = maximumCharacters;
	const bounded: PlaceEnrichmentEvidence[] = [];
	for (const item of evidence) {
		if (remaining <= 0) break;
		const title = item.title.slice(0, Math.min(500, remaining));
		remaining -= title.length;
		const highlights: string[] = [];
		for (const highlight of item.highlights) {
			if (remaining <= 0) break;
			const value = highlight.slice(0, remaining);
			highlights.push(value);
			remaining -= value.length;
		}
		bounded.push({ title, url: item.url, highlights });
	}
	return bounded;
}

function retryDelayMs(attempt: number, base: number, maximum: number) {
	return Math.min(maximum, base * 2 ** Math.max(0, attempt - 1));
}
