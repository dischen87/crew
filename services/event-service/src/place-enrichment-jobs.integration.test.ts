import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import postgres, { type Sql } from "postgres";
import { migrate } from "../scripts/migrate";
import type {
	PlaceEnrichmentClaim,
	PlaceEnrichmentField,
	PlaceEnrichmentPolicy,
} from "./place-enrichment";
import { PostgresPlaceEnrichmentJobs } from "./place-enrichment-jobs";
import { createPlaceEnrichmentWorker } from "./place-enrichment-worker";
import type { PlaceEnrichmentWorkerConfig } from "./place-enrichment-worker-config";
import { PostgresPlaceCandidateRepository } from "./postgres-place-candidate-repository";

const databaseUrl = Bun.env.PLACE_ENRICHMENT_TEST_DATABASE_URL;

if (!databaseUrl) {
	test.skip("place-enrichment PostgreSQL integration (set PLACE_ENRICHMENT_TEST_DATABASE_URL)", () => {});
} else {
	describe("budgeted place enrichment jobs against PostgreSQL 17", () => {
		let sql: Sql;
		let jobs: PostgresPlaceEnrichmentJobs;
		let candidateId: string;

		beforeAll(async () => {
			sql = postgres(databaseUrl, { max: 12 });
			await migrate(sql);
			jobs = new PostgresPlaceEnrichmentJobs(sql);
		});

		beforeEach(async () => {
			await sql`TRUNCATE place_enrichment_jobs, place_candidates CASCADE`;
			const [imported] = await new PostgresPlaceCandidateRepository(
				sql,
			).importBatch([candidate("carya-v1")]);
			if (!imported) throw new Error("Expected place candidate fixture");
			candidateId = imported.candidate.id;
		});

		afterAll(async () => {
			await sql.end();
		});

		test("deduplicates concurrent candidate and normalized search-miss requests", async () => {
			const candidateJobs = await Promise.all(
				Array.from({ length: 8 }, () =>
					jobs.enqueueCandidate(candidateId, policy()),
				),
			);
			expect(new Set(candidateJobs.map(({ id }) => id)).size).toBe(1);

			const misses = await Promise.all(
				["  missing   belek course ", "missing belek course"].map((query) =>
					jobs.enqueueSearchMiss(
						{ query, kind: "golf_course", countryCode: "TR" },
						policy(),
					),
				),
			);
			expect(misses[0]?.id).toBe(misses[1]?.id);
			const [count] = await sql<{ count: number }[]>`
				SELECT count(*)::int AS count FROM place_enrichment_jobs
			`;
			expect(count?.count).toBe(2);

			const [updated] = await new PostgresPlaceCandidateRepository(
				sql,
			).importBatch([
				candidate("carya-v1", {
					name: "Carya Golf Club Updated",
					retrievedAt: new Date("2030-01-02T00:00:00.000Z"),
				}),
			]);
			if (!updated) throw new Error("Expected updated candidate");
			const refreshed = await jobs.enqueueCandidate(candidateId, policy());
			expect(refreshed.id).not.toBe(candidateJobs[0]?.id);
		});

		test("fences expired workers and records every attempt outcome", async () => {
			await jobs.enqueueSearchMiss(
				{ query: "fenced course", kind: "golf_course", countryCode: "TR" },
				policy({ maxAttempts: 3 }),
			);
			const claims = await Promise.all([
				jobs.claim({ workerId: "worker-a", leaseMs: 5_000 }),
				jobs.claim({ workerId: "worker-b", leaseMs: 5_000 }),
			]);
			const first = claims.find((claim) => claim !== null);
			expect(claims.filter(Boolean)).toHaveLength(1);
			if (!first) throw new Error("Expected first enrichment claim");

			await sql`
				UPDATE place_enrichment_jobs SET lease_until = clock_timestamp() - interval '1 second'
				WHERE id = ${first.id}
			`;
			const replacement = await jobs.claim({
				workerId: "worker-c",
				leaseMs: 5_000,
			});
			if (!replacement) throw new Error("Expected replacement claim");
			expect(replacement.attempt).toBe(2);
			expect(BigInt(replacement.fence)).toBeGreaterThan(BigInt(first.fence));
			expect(
				await jobs.reserveProviderCall(first, reservation("exa", "1")),
			).toBe("stale");

			const [oldAttempt] = await sql<
				{ outcomeCode: string; finished: boolean }[]
			>`
				SELECT outcome_code AS "outcomeCode", finished_at IS NOT NULL AS finished
				FROM place_enrichment_attempts WHERE job_id = ${first.id} AND attempt = 1
			`;
			expect(oldAttempt).toEqual({
				outcomeCode: "ENRICHMENT_LEASE_EXPIRED",
				finished: true,
			});
			expect(await jobs.fail(first, "ENRICHMENT_STALE_WORKER")).toBe(false);
			await sql`
				UPDATE place_enrichment_jobs SET lease_until = clock_timestamp() - interval '1 second'
				WHERE id = ${replacement.id}
			`;
			expect(await jobs.complete(replacement, enrichedFields())).toBe(false);
			const [fieldCount] = await sql<{ count: number }[]>`
				SELECT count(*)::int AS count FROM place_enrichment_fields
				WHERE job_id = ${replacement.id}
			`;
			expect(fieldCount?.count).toBe(0);
		});

		test("reserves hard cumulative budgets and persists auditable field provenance", async () => {
			const queued = await jobs.enqueueSearchMiss(
				{ query: "audit course", kind: "golf_course", countryCode: "TR" },
				policy({
					maxExaCalls: 1,
					maxLlmCalls: 1,
					maxInputTokens: 1_000,
					maxOutputTokens: 64,
					maxCostMicros: 2_000,
				}),
			);
			const claim = requiredClaim(
				await jobs.claim({ workerId: "budget-worker", leaseMs: 5_000 }),
			);
			const exa = await jobs.reserveProviderCall(
				claim,
				reservation("exa", "2", { costMicros: 1_000 }),
			);
			if (typeof exa === "string") throw new Error("Expected Exa permit");
			expect(
				await jobs.reserveProviderCall(
					claim,
					reservation("exa", "3", { costMicros: 1 }),
				),
			).toBe("budget_exhausted");
			expect(
				await jobs.recordProviderCall(exa, {
					status: "succeeded",
					code: "ENRICHMENT_EXA_COMPLETED",
					responseBytes: 1_024,
					costMicros: 800,
					providerRequestId: "must-never-persist-raw",
				}),
			).toBe(true);

			const llm = await jobs.reserveProviderCall(
				claim,
				reservation("llm", "4", {
					inputTokens: 900,
					outputTokens: 64,
					costMicros: 900,
				}),
			);
			if (typeof llm === "string") throw new Error("Expected LLM permit");
			expect(
				await jobs.reserveProviderCall(
					claim,
					reservation("llm", "5", { inputTokens: 1 }),
				),
			).toBe("budget_exhausted");
			await jobs.recordProviderCall(llm, {
				status: "succeeded",
				code: "ENRICHMENT_LLM_COMPLETED",
				responseBytes: 2_048,
				inputTokens: 700,
				outputTokens: 40,
				costMicros: 600,
				providerRequestId: "also-hashed",
			});

			expect(await jobs.complete(claim, enrichedFields())).toBe(true);
			expect(await jobs.complete(claim, enrichedFields())).toBe(false);
			const result = await jobs.get(queued.id);
			expect(result?.job).toMatchObject({
				status: "succeeded",
				outcomeCode: "ENRICHMENT_COMPLETED",
				budget: {
					exaCallsReserved: 1,
					llmCallsReserved: 1,
					inputTokensReserved: 900,
					outputTokensReserved: 64,
					costMicrosReserved: 1_900,
				},
			});
			expect(result?.fields).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "summary",
						sourceUrl: "https://evidence.example/course",
						model: "test-model",
						promptVersion: "place-test-v1",
						validatorVersion: "place-field-v1",
						validationState: "passed",
						approvalState: "pending_review",
					}),
				]),
			);

			const calls = await sql<
				{
					status: string;
					requestFingerprint: string;
					providerRequestIdHash: string;
				}[]
			>`
				SELECT status, request_fingerprint AS "requestFingerprint",
					provider_request_id_hash AS "providerRequestIdHash"
				FROM place_enrichment_provider_calls WHERE job_id = ${queued.id}
				ORDER BY sequence
			`;
			expect(calls).toHaveLength(2);
			expect(calls.every(({ status }) => status === "succeeded")).toBe(true);
			expect(
				calls.every(
					({ requestFingerprint, providerRequestIdHash }) =>
						/^[a-f0-9]{64}$/.test(requestFingerprint) &&
						/^[a-f0-9]{64}$/.test(providerRequestIdHash),
				),
			).toBe(true);
			expect(JSON.stringify(calls)).not.toContain("must-never-persist-raw");
		});

		test("keeps retry history and terminates at the frozen attempt ceiling", async () => {
			const queued = await jobs.enqueueSearchMiss(
				{ query: "retry course", kind: "golf_course", countryCode: "TR" },
				policy({ maxAttempts: 2 }),
			);
			const first = requiredClaim(
				await jobs.claim({ workerId: "retry-worker-1", leaseMs: 5_000 }),
			);
			expect(await jobs.retry(first, "ENRICHMENT_EXA_UNAVAILABLE", 100)).toBe(
				"retry",
			);
			await sql`
				UPDATE place_enrichment_jobs SET available_at = clock_timestamp()
				WHERE id = ${queued.id}
			`;
			const second = requiredClaim(
				await jobs.claim({ workerId: "retry-worker-2", leaseMs: 5_000 }),
			);
			expect(await jobs.retry(second, "ENRICHMENT_LLM_UNAVAILABLE", 100)).toBe(
				"dead",
			);
			const result = await jobs.get(queued.id);
			expect(result?.job).toMatchObject({
				status: "dead",
				attempts: 2,
				outcomeCode: "ENRICHMENT_ATTEMPTS_EXHAUSTED",
			});
			const attempts = await sql<{ attempt: number; outcomeCode: string }[]>`
				SELECT attempt, outcome_code AS "outcomeCode"
				FROM place_enrichment_attempts WHERE job_id = ${queued.id}
				ORDER BY attempt
			`;
			expect([...attempts]).toEqual([
				{ attempt: 1, outcomeCode: "ENRICHMENT_EXA_UNAVAILABLE" },
				{ attempt: 2, outcomeCode: "ENRICHMENT_ATTEMPTS_EXHAUSTED" },
			]);
		});

		test("runs the complete candidate-to-provenance pipeline without a request-path provider call", async () => {
			const queued = await jobs.enqueueCandidate(candidateId, policy());
			const providerOrder: string[] = [];
			const worker = createPlaceEnrichmentWorker(workerConfig(), jobs, {
				now: () => new Date("2026-07-19T08:00:00.000Z"),
				fetch: async (input) => {
					const path = new URL(input instanceof Request ? input.url : input)
						.pathname;
					providerOrder.push(path);
					if (path === "/search") {
						return Response.json({
							requestId: "exa-e2e-request",
							costDollars: { total: 0.005 },
							results: [
								{
									title: "Carya Golf Club",
									url: "https://caryagolf.com/",
									highlights: ["Carya Golf Club is in Belek."],
								},
							],
						});
					}
					return Response.json({
						id: "llm-e2e-request",
						choices: [
							{
								message: {
									content: JSON.stringify({
										fields: [
											{
												name: "summary",
												value: "Golf course in Belek.",
												sourceUrl: "https://caryagolf.com/",
											},
										],
									}),
								},
							},
						],
						usage: { prompt_tokens: 300, completion_tokens: 30 },
					});
				},
			});

			expect(await worker.processOne()).toBe(true);
			expect(providerOrder).toEqual(["/search", "/v1/chat/completions"]);
			expect(await jobs.get(queued.id)).toMatchObject({
				job: { status: "succeeded", outcomeCode: "ENRICHMENT_COMPLETED" },
				fields: expect.arrayContaining([
					expect.objectContaining({
						name: "name",
						sourceKind: "candidate",
						approvalState: "auto_approved",
					}),
					expect.objectContaining({
						name: "summary",
						sourceKind: "exa_llm",
						approvalState: "pending_review",
					}),
				]),
			});
		});
	});
}

function policy(
	override: Partial<PlaceEnrichmentPolicy> = {},
): PlaceEnrichmentPolicy {
	return {
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
		...override,
	};
}

function reservation(
	provider: "exa" | "llm",
	fingerprintCharacter: string,
	override: Partial<{
		inputTokens: number;
		outputTokens: number;
		costMicros: number;
	}> = {},
) {
	return {
		provider,
		requestFingerprint: fingerprintCharacter.repeat(64),
		inputTokens: 0,
		outputTokens: 0,
		costMicros: 0,
		...override,
	};
}

function enrichedFields(): PlaceEnrichmentField[] {
	const observedAt = new Date("2026-07-19T08:00:00.000Z");
	return [
		{
			name: "name",
			value: "Audit Golf Club",
			sourceKind: "exa_llm",
			sourceUrl: "https://evidence.example/course",
			observedAt,
			model: "test-model",
			promptVersion: "place-test-v1",
			validatorVersion: "place-field-v1",
			validationState: "passed",
			approvalState: "pending_review",
		},
		{
			name: "countryCode",
			value: "TR",
			sourceKind: "exa_llm",
			sourceUrl: "https://evidence.example/course",
			observedAt,
			model: "test-model",
			promptVersion: "place-test-v1",
			validatorVersion: "place-field-v1",
			validationState: "passed",
			approvalState: "pending_review",
		},
		{
			name: "summary",
			value: "Auditable bounded enrichment.",
			sourceKind: "exa_llm",
			sourceUrl: "https://evidence.example/course",
			observedAt,
			model: "test-model",
			promptVersion: "place-test-v1",
			validatorVersion: "place-field-v1",
			validationState: "passed",
			approvalState: "pending_review",
		},
	];
}

function requiredClaim(claim: PlaceEnrichmentClaim | null) {
	if (!claim) throw new Error("Expected place-enrichment claim");
	return claim;
}

function candidate(
	sourceRecordId: string,
	override: Partial<{
		name: string;
		retrievedAt: Date;
	}> = {},
) {
	return {
		source: "curated",
		sourceRecordId,
		kind: "golf_course" as const,
		name: override.name ?? "Carya Golf Club",
		locality: "Belek",
		region: "Antalya",
		countryCode: "TR",
		latitude: 36.87,
		longitude: 31.06,
		sourceRecordUrl: "https://catalog.example/carya",
		license: {
			code: "curated-test",
			url: "https://catalog.example/license",
			attribution: "Crew test fixture",
			allowsSearchIndex: true,
		},
		retrievedAt: override.retrievedAt ?? new Date("2030-01-01T00:00:00.000Z"),
		confidence: 0.9,
		expiresAt: null,
		retirement: null,
	};
}

function workerConfig(): Omit<
	PlaceEnrichmentWorkerConfig,
	"databaseUrl" | "environment"
> {
	return {
		workerId: "integration-worker",
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
