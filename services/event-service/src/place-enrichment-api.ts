import { placeCandidateId } from "./place-candidate";
import type {
	PlaceEnrichmentField,
	PlaceEnrichmentJob,
	PlaceEnrichmentStatus,
} from "./place-enrichment";
import { reviewedPlaceCandidateSource } from "./place-enrichment";

const ACTIVE_STATUSES = new Set<PlaceEnrichmentStatus>([
	"pending",
	"processing",
	"retry",
]);

export function placeEnrichmentResponse(input: {
	job: PlaceEnrichmentJob;
	fields: readonly PlaceEnrichmentField[];
	globalPlaceId: string | null;
}) {
	const { job } = input;
	const approved = new Map(
		input.fields
			.filter(({ approvalState }) =>
				["auto_approved", "human_approved"].includes(approvalState),
			)
			.map((field) => [field.name, field.value]),
	);
	const candidate = job.target.type === "candidate" ? job.target : null;
	const sourceCandidateId =
		candidate?.candidateId ??
		(input.globalPlaceId
			? placeCandidateId(
					"place_enrichment",
					reviewedPlaceCandidateSource(input.fields).sourceRecordId,
				)
			: null);
	const value = (name: PlaceEnrichmentField["name"], fallback: string | null) =>
		approved.get(name) ?? fallback;
	const number = (name: "latitude" | "longitude", fallback: number | null) => {
		const enriched = approved.get(name);
		return enriched === undefined ? fallback : Number(enriched);
	};

	return {
		enrichment: {
			id: job.id,
			status: job.status,
			pollAfterSeconds: pollAfterSeconds(job.status),
			retryAllowed: job.status === "retry",
			createdAt: job.createdAt.toISOString(),
			updatedAt: job.updatedAt.toISOString(),
			completedAt: job.completedAt?.toISOString() ?? null,
		},
		review: placeEnrichmentReview(job, input.fields),
		place:
			sourceCandidateId && input.globalPlaceId
				? {
						id: input.globalPlaceId,
						sourceCandidateId,
						kind: job.target.kind,
						name: value("name", candidate?.name ?? null) as string,
						locality: value("locality", candidate?.locality ?? null),
						region: value("region", candidate?.region ?? null),
						countryCode: value("countryCode", job.target.countryCode) as string,
						latitude: number("latitude", candidate?.latitude ?? null),
						longitude: number("longitude", candidate?.longitude ?? null),
						address: value("address", null),
						websiteUrl: value("websiteUrl", null),
						summary: value("summary", null),
					}
				: null,
	};
}

function placeEnrichmentReview(
	job: PlaceEnrichmentJob,
	fields: readonly PlaceEnrichmentField[],
) {
	if (job.target.type !== "search_miss" || job.status !== "succeeded")
		return null;
	const states = new Set(fields.map(({ approvalState }) => approvalState));
	if (
		fields.length < 2 ||
		states.size !== 1 ||
		fields.some(
			({ sourceKind, sourceUrl }) =>
				sourceKind !== "exa_llm" || sourceUrl === null,
		) ||
		![...states].every((state) =>
			["pending_review", "human_approved", "rejected"].includes(state),
		)
	) {
		throw new Error("Place-enrichment review invariant failed");
	}
	const state = states.has("pending_review")
		? ("pending" as const)
		: states.has("human_approved")
			? ("approved" as const)
			: ("rejected" as const);
	return {
		state,
		fields: fields.map((field) => ({
			name: field.name,
			value: field.value,
			provenance: {
				sourceKind: "exa_llm" as const,
				sourceUrl: field.sourceUrl as string,
				observedAt: field.observedAt.toISOString(),
			},
		})),
	};
}

function pollAfterSeconds(status: PlaceEnrichmentStatus) {
	if (!ACTIVE_STATUSES.has(status)) return null;
	return status === "retry" ? 5 : 2;
}
