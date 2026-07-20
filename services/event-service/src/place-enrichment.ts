import { createHash } from "node:crypto";
import type { PlaceCandidateKind } from "./place-candidate";

export const PLACE_ENRICHMENT_VALIDATOR_VERSION = "place-field-v1";

export type PlaceEnrichmentStatus =
	| "pending"
	| "processing"
	| "retry"
	| "succeeded"
	| "failed"
	| "dead";

export type PlaceEnrichmentFieldName =
	| "name"
	| "locality"
	| "region"
	| "countryCode"
	| "latitude"
	| "longitude"
	| "address"
	| "websiteUrl"
	| "summary";

export type PlaceEnrichmentPolicy = {
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
};

export type PlaceEnrichmentTarget =
	| {
			type: "candidate";
			candidateId: string;
			candidateSnapshotHash: string;
			candidateSource: string;
			candidateSourceUrl: string | null;
			kind: PlaceCandidateKind;
			name: string;
			locality: string | null;
			region: string | null;
			countryCode: string;
			latitude: number | null;
			longitude: number | null;
	  }
	| {
			type: "search_miss";
			query: string;
			kind: PlaceCandidateKind;
			countryCode: string;
	  };

export type PlaceEnrichmentJob = {
	id: string;
	requestHash: string;
	target: PlaceEnrichmentTarget;
	policy: PlaceEnrichmentPolicy;
	status: PlaceEnrichmentStatus;
	attempts: number;
	budget: {
		exaCallsReserved: number;
		llmCallsReserved: number;
		inputTokensReserved: number;
		outputTokensReserved: number;
		costMicrosReserved: number;
	};
	outcomeCode: string | null;
	createdAt: Date;
	updatedAt: Date;
	completedAt: Date | null;
};

export type PlaceEnrichmentClaim = PlaceEnrichmentJob & {
	workerId: string;
	fence: string;
	attempt: number;
};

export type PlaceEnrichmentField = {
	name: PlaceEnrichmentFieldName;
	value: string;
	sourceKind: "candidate" | "exa_llm";
	sourceUrl: string | null;
	observedAt: Date;
	model: string | null;
	promptVersion: string | null;
	validatorVersion: typeof PLACE_ENRICHMENT_VALIDATOR_VERSION;
	validationState: "passed";
	approvalState: "auto_approved" | "pending_review";
};

export type LlmPlaceField = {
	name: PlaceEnrichmentFieldName;
	value: string;
	sourceUrl: string;
};

export class PlaceEnrichmentValidationError extends Error {}

export function normalizePlaceSearchQuery(value: string) {
	const normalized = value.trim().replace(/\s+/g, " ");
	if (
		normalized.length < 2 ||
		normalized.length > 200 ||
		/[\p{Cc}\p{Cf}]/u.test(normalized)
	) {
		throw new PlaceEnrichmentValidationError("Search query is invalid");
	}
	return normalized;
}

export function placeEnrichmentIdentity(
	target: PlaceEnrichmentTarget,
	policy: PlaceEnrichmentPolicy,
) {
	const targetIdentity =
		target.type === "candidate"
			? ["candidate", target.candidateId, target.candidateSnapshotHash]
			: ["search_miss", target.query, target.kind, target.countryCode];
	const requestHash = hashJson([
		"crew:place-enrichment:v1",
		targetIdentity,
		[
			policy.pipelineVersion,
			policy.model,
			policy.promptVersion,
			policy.maxAttempts,
			policy.maxExaCalls,
			policy.maxLlmCalls,
			policy.maxInputTokens,
			policy.maxOutputTokens,
			policy.maxCostMicros,
			policy.providerTimeoutMs,
			policy.maxResponseBytes,
		],
	]);
	return { requestHash, id: `pej_${requestHash}` };
}

export function candidatePlaceFields(
	claim: PlaceEnrichmentClaim,
	observedAt: Date,
): PlaceEnrichmentField[] {
	if (claim.target.type !== "candidate") return [];
	const target = claim.target;
	const values: [PlaceEnrichmentFieldName, string | null][] = [
		["name", target.name],
		["locality", target.locality],
		["region", target.region],
		["countryCode", target.countryCode],
		["latitude", coordinate(target.latitude)],
		["longitude", coordinate(target.longitude)],
	];
	return values.flatMap(([name, value]) =>
		value === null
			? []
			: [
					{
						name,
						value,
						sourceKind: "candidate" as const,
						sourceUrl: target.candidateSourceUrl,
						observedAt,
						model: null,
						promptVersion: null,
						validatorVersion: PLACE_ENRICHMENT_VALIDATOR_VERSION,
						validationState: "passed" as const,
						approvalState: "auto_approved" as const,
					},
				],
	);
}

export function mergeValidatedPlaceFields(
	claim: PlaceEnrichmentClaim,
	deterministic: PlaceEnrichmentField[],
	proposals: LlmPlaceField[],
	evidenceUrls: ReadonlySet<string>,
	observedAt: Date,
) {
	const byName = new Map(deterministic.map((field) => [field.name, field]));
	const proposedNames = new Set<PlaceEnrichmentFieldName>();
	let acceptedProposalCount = 0;
	for (const proposal of proposals) {
		if (proposedNames.has(proposal.name)) {
			throw new PlaceEnrichmentValidationError(
				"LLM output repeated a place field",
			);
		}
		proposedNames.add(proposal.name);
		if (byName.has(proposal.name)) continue;
		const sourceUrl = canonicalEvidenceUrl(proposal.sourceUrl);
		if (!evidenceUrls.has(sourceUrl)) {
			throw new PlaceEnrichmentValidationError(
				"LLM output cited evidence that Exa did not return",
			);
		}
		const value = validateFieldValue(
			proposal.name,
			proposal.value,
			claim.target.countryCode,
		);
		if (proposal.name === "websiteUrl" && !evidenceUrls.has(value)) {
			throw new PlaceEnrichmentValidationError(
				"LLM output invented a website outside the evidence set",
			);
		}
		byName.set(proposal.name, {
			name: proposal.name,
			value,
			sourceKind: "exa_llm",
			sourceUrl,
			observedAt,
			model: claim.policy.model,
			promptVersion: claim.policy.promptVersion,
			validatorVersion: PLACE_ENRICHMENT_VALIDATOR_VERSION,
			validationState: "passed",
			approvalState: "pending_review",
		});
		acceptedProposalCount += 1;
	}

	if (acceptedProposalCount === 0) {
		throw new PlaceEnrichmentValidationError(
			"Enrichment did not add a supported place fact",
		);
	}
	if (!byName.has("name") || !byName.has("countryCode")) {
		throw new PlaceEnrichmentValidationError(
			"Enrichment did not establish a name and country",
		);
	}
	if (byName.has("latitude") !== byName.has("longitude")) {
		throw new PlaceEnrichmentValidationError(
			"Enrichment returned incomplete coordinates",
		);
	}
	return [...byName.values()].sort((left, right) =>
		left.name.localeCompare(right.name),
	);
}

export function needsPlaceEnrichmentFallback(
	fields: readonly PlaceEnrichmentField[],
) {
	const names = new Set(fields.map(({ name }) => name));
	return !(["address", "websiteUrl", "summary"] as const).some((name) =>
		names.has(name),
	);
}

export function placeEnrichmentQuery(target: PlaceEnrichmentTarget) {
	return target.type === "search_miss"
		? `${target.query} ${target.kind.replace("_", " ")} ${target.countryCode}`
		: [
				target.name,
				target.locality,
				target.region,
				target.countryCode,
				target.kind.replace("_", " "),
			]
				.filter(Boolean)
				.join(" ");
}

export function canonicalEvidenceUrl(value: string) {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new PlaceEnrichmentValidationError("Evidence URL is invalid");
	}
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.href.length > 2048
	) {
		throw new PlaceEnrichmentValidationError("Evidence URL is not safe");
	}
	url.hash = "";
	return url.href;
}

export function hashText(value: string) {
	return createHash("sha256").update(value).digest("hex");
}

export function globalPlaceId(candidateId: string) {
	return `gpl_${hashText(
		JSON.stringify(["crew:global-place:v1", candidateId]),
	)}`;
}

export function safeEnrichmentCode(value: string) {
	return /^[A-Z][A-Z0-9_]{1,127}$/.test(value) ? value : "ENRICHMENT_FAILED";
}

function validateFieldValue(
	name: PlaceEnrichmentFieldName,
	input: string,
	expectedCountryCode: string,
) {
	const value = input.trim().replace(/\s+/g, " ");
	if (!value || /[\p{Cc}\p{Cf}]/u.test(value)) {
		throw new PlaceEnrichmentValidationError("Place field is empty or unsafe");
	}
	const maximum =
		name === "summary"
			? 1000
			: name === "address"
				? 500
				: name === "websiteUrl"
					? 2048
					: 200;
	if (value.length > maximum) {
		throw new PlaceEnrichmentValidationError("Place field is too long");
	}
	if (name === "countryCode") {
		if (!/^[A-Z]{2}$/.test(value) || value !== expectedCountryCode) {
			throw new PlaceEnrichmentValidationError("Country code is inconsistent");
		}
		return value;
	}
	if (name === "latitude" || name === "longitude") {
		const number = Number(value);
		const limit = name === "latitude" ? 90 : 180;
		if (!Number.isFinite(number) || number < -limit || number > limit) {
			throw new PlaceEnrichmentValidationError("Coordinate is invalid");
		}
		return coordinate(number) as string;
	}
	if (name === "websiteUrl") return canonicalEvidenceUrl(value);
	return value;
}

function coordinate(value: number | null) {
	if (value === null) return null;
	return String(Object.is(value, -0) ? 0 : value);
}

function hashJson(value: unknown) {
	return hashText(JSON.stringify(value));
}
