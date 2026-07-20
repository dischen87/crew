import type {
	PlaceEnrichmentField,
	PlaceEnrichmentJob,
	PlaceEnrichmentStatus,
} from "./place-enrichment";

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
			.filter(({ approvalState }) => approvalState === "auto_approved")
			.map((field) => [field.name, field.value]),
	);
	const candidate = job.target.type === "candidate" ? job.target : null;
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
		place:
			candidate && input.globalPlaceId
				? {
						id: input.globalPlaceId,
						sourceCandidateId: candidate.candidateId,
						kind: candidate.kind,
						name: value("name", candidate.name) as string,
						locality: value("locality", candidate.locality),
						region: value("region", candidate.region),
						countryCode: value("countryCode", candidate.countryCode) as string,
						latitude: number("latitude", candidate.latitude),
						longitude: number("longitude", candidate.longitude),
						address: value("address", null),
						websiteUrl: value("websiteUrl", null),
						summary: value("summary", null),
					}
				: null,
	};
}

function pollAfterSeconds(status: PlaceEnrichmentStatus) {
	if (!ACTIVE_STATUSES.has(status)) return null;
	return status === "retry" ? 5 : 2;
}
