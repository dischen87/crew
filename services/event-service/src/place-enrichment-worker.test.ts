import { describe, expect, test } from "bun:test";
import type {
	PlaceEnrichmentClaim,
	PlaceEnrichmentField,
} from "./place-enrichment";
import type { PlaceEnrichmentProviderPermit } from "./place-enrichment-jobs";
import {
	createPlaceEnrichmentWorker,
	type PlaceEnrichmentJobs,
} from "./place-enrichment-worker";
import type { PlaceEnrichmentWorkerConfig } from "./place-enrichment-worker-config";

describe("place enrichment worker", () => {
	test("runs bounded Exa before LLM and persists validated field provenance", async () => {
		const harness = workerHarness();
		const requests: {
			url: URL;
			headers: Headers;
			body: unknown;
			redirect: RequestRedirect | undefined;
		}[] = [];
		const worker = createPlaceEnrichmentWorker(harness.config, harness.jobs, {
			now: () => new Date("2026-07-19T08:00:00.000Z"),
			fetch: async (input, init) => {
				const request = {
					url: new URL(input instanceof Request ? input.url : input),
					headers: new Headers(init?.headers),
					body: JSON.parse(String(init?.body)),
					redirect: init?.redirect,
				};
				requests.push(request);
				if (request.url.pathname === "/search") {
					return Response.json({
						requestId: "exa-request-secret",
						costDollars: { total: 0.005 },
						results: [
							{
								title: "Carya Golf Club",
								url: "https://caryagolf.com/",
								highlights: ["Carya is a floodlit golf course in Belek."],
							},
						],
					});
				}
				return Response.json({
					id: "llm-request-secret",
					choices: [
						{
							message: {
								content: JSON.stringify({
									fields: [
										{
											name: "websiteUrl",
											value: "https://caryagolf.com/",
											sourceUrl: "https://caryagolf.com/",
										},
										{
											name: "summary",
											value: "Floodlit golf course in Belek.",
											sourceUrl: "https://caryagolf.com/",
										},
									],
								}),
							},
						},
					],
					usage: { prompt_tokens: 500, completion_tokens: 40 },
				});
			},
		});

		expect(await worker.processOne()).toBe(true);
		expect(requests.map(({ url }) => url.pathname)).toEqual([
			"/search",
			"/v1/chat/completions",
		]);
		expect(requests.map(({ redirect }) => redirect)).toEqual([
			"error",
			"error",
		]);
		expect(requests[0]?.body).toMatchObject({
			type: "fast",
			numResults: 3,
			moderation: true,
			contents: { highlights: true },
		});
		expect(requests[0]?.headers.get("idempotency-key")).toMatch(/^pec_/);
		expect(requests[1]?.body).toMatchObject({
			model: "test-model",
			max_completion_tokens: 512,
			response_format: { type: "json_schema" },
		});
		expect(harness.providerRecords.map(({ status }) => status)).toEqual([
			"succeeded",
			"succeeded",
		]);
		expect(harness.completedFields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "name",
					value: "Carya Golf Club",
					sourceKind: "candidate",
					approvalState: "auto_approved",
				}),
				expect.objectContaining({
					name: "summary",
					sourceUrl: "https://caryagolf.com/",
					model: "test-model",
					promptVersion: "place-test-v1",
					validationState: "passed",
					approvalState: "pending_review",
				}),
			]),
		);
		expect(harness.failedCode).toBeNull();
	});

	test("enriches a search miss without inventing deterministic candidate facts", async () => {
		const harness = workerHarness({ claim: searchMissClaim() });
		const worker = createPlaceEnrichmentWorker(harness.config, harness.jobs, {
			fetch: async (input) => {
				const url = new URL(input instanceof Request ? input.url : input);
				if (url.pathname === "/search") {
					return Response.json({
						results: [
							{
								title: "New Belek Club",
								url: "https://new-belek.example/",
								highlights: ["Golf club in Belek, Turkiye."],
							},
						],
					});
				}
				return Response.json({
					choices: [
						{
							message: {
								content: JSON.stringify({
									fields: [
										{
											name: "name",
											value: "New Belek Club",
											sourceUrl: "https://new-belek.example/",
										},
										{
											name: "countryCode",
											value: "TR",
											sourceUrl: "https://new-belek.example/",
										},
									],
								}),
							},
						},
					],
					usage: { prompt_tokens: 100, completion_tokens: 20 },
				});
			},
		});

		expect(await worker.processOne()).toBe(true);
		expect(harness.completedFields).toHaveLength(2);
		expect(harness.completedFields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "name",
					sourceKind: "exa_llm",
					approvalState: "pending_review",
				}),
				expect.objectContaining({
					name: "countryCode",
					sourceKind: "exa_llm",
					approvalState: "pending_review",
				}),
			]),
		);
		expect(harness.failedCode).toBeNull();
	});

	test("does no provider work after the durable budget is exhausted", async () => {
		const harness = workerHarness({ reservation: "budget_exhausted" });
		let calls = 0;
		const worker = createPlaceEnrichmentWorker(harness.config, harness.jobs, {
			fetch: async () => {
				calls += 1;
				return Response.json({});
			},
		});

		expect(await worker.processOne()).toBe(true);
		expect(calls).toBe(0);
		expect(harness.failedCode).toBe("ENRICHMENT_BUDGET_EXHAUSTED");
	});

	test("audits a retryable provider failure and schedules bounded retry", async () => {
		const harness = workerHarness();
		const worker = createPlaceEnrichmentWorker(harness.config, harness.jobs, {
			fetch: async () => Response.json({}, { status: 429 }),
		});

		expect(await worker.processOne()).toBe(true);
		expect(harness.providerRecords).toEqual([
			expect.objectContaining({
				status: "failed",
				code: "ENRICHMENT_EXA_RATE_LIMITED",
			}),
		]);
		expect(harness.retryCode).toBe("ENRICHMENT_EXA_RATE_LIMITED");
		expect(harness.retryDelay).toBe(1_000);
		expect(harness.failedCode).toBeNull();
	});

	test("redacts rejected redirect failures behind a safe retry code", async () => {
		const harness = workerHarness();
		const secretFailure =
			"redirected to https://wrong.example/?provider-key=secret";
		const worker = createPlaceEnrichmentWorker(harness.config, harness.jobs, {
			fetch: async (_input, init) => {
				expect(init?.redirect).toBe("error");
				throw new Error(secretFailure);
			},
		});

		expect(await worker.processOne()).toBe(true);
		expect(harness.providerRecords).toEqual([
			{
				status: "failed",
				code: "ENRICHMENT_EXA_UNAVAILABLE",
			},
		]);
		expect(JSON.stringify(harness.providerRecords)).not.toContain(
			secretFailure,
		);
		expect(harness.retryCode).toBe("ENRICHMENT_EXA_UNAVAILABLE");
		expect(harness.failedCode).toBeNull();
	});

	test("rejects LLM facts whose citation was not returned by Exa", async () => {
		const harness = workerHarness();
		const worker = createPlaceEnrichmentWorker(harness.config, harness.jobs, {
			fetch: async (input) => {
				const url = new URL(input instanceof Request ? input.url : input);
				if (url.pathname === "/search") {
					return Response.json({
						results: [
							{
								title: "Carya",
								url: "https://caryagolf.com/",
								highlights: ["Golf course"],
							},
						],
					});
				}
				return Response.json({
					choices: [
						{
							message: {
								content: JSON.stringify({
									fields: [
										{
											name: "summary",
											value: "Invented fact",
											sourceUrl: "https://invented.example/",
										},
									],
								}),
							},
						},
					],
					usage: { prompt_tokens: 100, completion_tokens: 20 },
				});
			},
		});

		expect(await worker.processOne()).toBe(true);
		expect(harness.providerRecords.at(-1)).toMatchObject({
			status: "invalid",
			code: "ENRICHMENT_LLM_FACTS_INVALID",
		});
		expect(harness.failedCode).toBe("ENRICHMENT_LLM_FACTS_INVALID");
	});
});

function workerHarness(
	input: {
		claim?: PlaceEnrichmentClaim;
		reservation?: "budget_exhausted";
	} = {},
) {
	const claim = input.claim ?? candidateClaim();
	let reservationSequence = 0;
	const providerRecords: {
		status: "succeeded" | "failed" | "invalid";
		code: string;
	}[] = [];
	let completedFields: PlaceEnrichmentField[] = [];
	let failedCode: string | null = null;
	let retryCode: string | null = null;
	let retryDelay: number | null = null;
	const jobs: PlaceEnrichmentJobs = {
		claim: async () => claim,
		reserveProviderCall: async (_claim, reservation) => {
			if (input.reservation) return input.reservation;
			reservationSequence += 1;
			return {
				id: `pec_${String(reservationSequence).padStart(64, "0")}`,
				jobId: claim.id,
				attempt: claim.attempt,
				provider: reservation.provider,
				inputTokensReserved: reservation.inputTokens,
				outputTokensReserved: reservation.outputTokens,
				costMicrosReserved: reservation.costMicros,
				timeoutMs: claim.policy.providerTimeoutMs,
				maxResponseBytes: claim.policy.maxResponseBytes,
			} satisfies PlaceEnrichmentProviderPermit;
		},
		recordProviderCall: async (_permit, result) => {
			providerRecords.push({ status: result.status, code: result.code });
			return true;
		},
		complete: async (_claim, fields) => {
			completedFields = fields;
			return true;
		},
		retry: async (_claim, code, delay) => {
			retryCode = code;
			retryDelay = delay;
			return "retry";
		},
		fail: async (_claim, code) => {
			failedCode = code;
			return true;
		},
	};
	return {
		config: workerConfig(),
		jobs,
		providerRecords,
		get completedFields() {
			return completedFields;
		},
		get failedCode() {
			return failedCode;
		},
		get retryCode() {
			return retryCode;
		},
		get retryDelay() {
			return retryDelay;
		},
	};
}

function searchMissClaim(): PlaceEnrichmentClaim {
	return {
		...candidateClaim(),
		id: `pej_${"d".repeat(64)}`,
		requestHash: "d".repeat(64),
		target: {
			type: "search_miss",
			query: "new belek club",
			kind: "golf_course",
			countryCode: "TR",
		},
	};
}

function candidateClaim(): PlaceEnrichmentClaim {
	return {
		id: `pej_${"a".repeat(64)}`,
		requestHash: "a".repeat(64),
		target: {
			type: "candidate",
			candidateId: `pcd_${"b".repeat(64)}`,
			candidateSnapshotHash: "c".repeat(64),
			candidateSource: "curated",
			candidateSourceUrl: "https://catalog.example/carya",
			kind: "golf_course",
			name: "Carya Golf Club",
			locality: "Belek",
			region: "Antalya",
			countryCode: "TR",
			latitude: 36.87,
			longitude: 31.06,
		},
		policy: {
			pipelineVersion: "place-test-v1",
			model: "test-model",
			promptVersion: "place-test-v1",
			maxAttempts: 3,
			maxExaCalls: 2,
			maxLlmCalls: 2,
			maxInputTokens: 20_000,
			maxOutputTokens: 512,
			maxCostMicros: 50_000,
			providerTimeoutMs: 1_000,
			maxResponseBytes: 262_144,
		},
		status: "processing",
		attempts: 1,
		budget: {
			exaCallsReserved: 0,
			llmCallsReserved: 0,
			inputTokensReserved: 0,
			outputTokensReserved: 0,
			costMicrosReserved: 0,
		},
		outcomeCode: null,
		createdAt: new Date("2026-07-19T07:59:00.000Z"),
		updatedAt: new Date("2026-07-19T08:00:00.000Z"),
		completedAt: null,
		workerId: "test-worker",
		fence: "1",
		attempt: 1,
	};
}

function workerConfig(): Omit<
	PlaceEnrichmentWorkerConfig,
	"databaseUrl" | "environment"
> {
	return {
		workerId: "test-worker",
		pollIntervalMs: 100,
		leaseMs: 5_000,
		pipelineVersion: "place-test-v1",
		model: "test-model",
		promptVersion: "place-test-v1",
		maxAttempts: 3,
		maxExaCalls: 2,
		maxLlmCalls: 2,
		maxInputTokens: 20_000,
		maxOutputTokens: 512,
		maxCostMicros: 50_000,
		providerTimeoutMs: 1_000,
		maxResponseBytes: 262_144,
		exaBaseUrl: "https://api.exa.test",
		exaApiKey: "test-exa-api-key",
		exaMaxResults: 3,
		exaMaxCostMicrosPerCall: 10_000,
		llmUrl: "https://llm.test/v1/chat/completions",
		llmApiKey: "test-llm-api-key",
		llmMaxOutputTokensPerCall: 512,
		llmInputCostMicrosPerMillionTokens: 150_000,
		llmOutputCostMicrosPerMillionTokens: 600_000,
		maxEvidenceCharacters: 12_000,
		baseBackoffMs: 1_000,
		maxBackoffMs: 60_000,
	};
}
