import { describe, expect, test } from "bun:test";
import type {
	PlaceEnrichmentField,
	PlaceEnrichmentJob,
} from "./place-enrichment";
import { placeEnrichmentResponse } from "./place-enrichment-api";

describe("place enrichment API projection", () => {
	test("returns immediate candidate facts without provider policy or budgets", () => {
		const response = placeEnrichmentResponse({
			job: candidateJob(),
			fields: [],
			globalPlaceId:
				"gpl_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
		});

		expect(response).toEqual({
			enrichment: {
				id: "pej_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				status: "pending",
				pollAfterSeconds: 2,
				retryAllowed: false,
				createdAt: "2026-07-18T20:00:00.000Z",
				updatedAt: "2026-07-18T20:00:00.000Z",
				completedAt: null,
			},
			place: {
				id: "gpl_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
				sourceCandidateId:
					"pcd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				kind: "golf_course",
				name: "Carya Golf Club",
				locality: "Belek",
				region: "Antalya",
				countryCode: "TR",
				latitude: 36.858,
				longitude: 31.055,
				address: null,
				websiteUrl: null,
				summary: null,
			},
		});
		expect(JSON.stringify(response)).not.toContain("budget");
		expect(JSON.stringify(response)).not.toContain("model");
	});

	test("exposes only approved facts and bounded retry polling", () => {
		const job = candidateJob();
		job.status = "retry";
		const fields: PlaceEnrichmentField[] = [
			field("address", "Kadriye, Belek", "auto_approved"),
			field("summary", "Unreviewed provider text", "pending_review"),
		];

		const response = placeEnrichmentResponse({
			job,
			fields,
			globalPlaceId:
				"gpl_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
		});

		expect(response.enrichment.pollAfterSeconds).toBe(5);
		expect(response.enrichment.retryAllowed).toBe(true);
		expect(response.place?.address).toBe("Kadriye, Belek");
		expect(response.place?.summary).toBeNull();
	});

	test("does not disclose a search-miss query", () => {
		const job = candidateJob();
		job.target = {
			type: "search_miss",
			query: "private organizer wording",
			kind: "venue",
			countryCode: "CH",
		};

		const response = placeEnrichmentResponse({
			job,
			fields: [],
			globalPlaceId: null,
		});

		expect(response.place).toBeNull();
		expect(JSON.stringify(response)).not.toContain("private organizer wording");
	});
});

function candidateJob(): PlaceEnrichmentJob {
	const now = new Date("2026-07-18T20:00:00.000Z");
	return {
		id: "pej_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		requestHash:
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		target: {
			type: "candidate",
			candidateId:
				"pcd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			candidateSnapshotHash:
				"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
			candidateSource: "fixture",
			candidateSourceUrl: "https://example.com/carya",
			kind: "golf_course",
			name: "Carya Golf Club",
			locality: "Belek",
			region: "Antalya",
			countryCode: "TR",
			latitude: 36.858,
			longitude: 31.055,
		},
		policy: {
			pipelineVersion: "place-v1",
			model: "fixture-model",
			promptVersion: "place-v1",
			maxAttempts: 3,
			maxExaCalls: 2,
			maxLlmCalls: 2,
			maxInputTokens: 20_000,
			maxOutputTokens: 1_024,
			maxCostMicros: 50_000,
			providerTimeoutMs: 5_000,
			maxResponseBytes: 262_144,
		},
		status: "pending",
		attempts: 0,
		budget: {
			exaCallsReserved: 0,
			llmCallsReserved: 0,
			inputTokensReserved: 0,
			outputTokensReserved: 0,
			costMicrosReserved: 0,
		},
		outcomeCode: null,
		createdAt: now,
		updatedAt: now,
		completedAt: null,
	};
}

function field(
	name: PlaceEnrichmentField["name"],
	value: string,
	approvalState: PlaceEnrichmentField["approvalState"],
): PlaceEnrichmentField {
	return {
		name,
		value,
		sourceKind: "candidate",
		sourceUrl: "https://example.com/carya",
		observedAt: new Date("2026-07-18T20:00:00.000Z"),
		model: null,
		promptVersion: null,
		validatorVersion: "place-field-v1",
		validationState: "passed",
		approvalState,
	};
}
