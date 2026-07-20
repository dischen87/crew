import { createHash } from "node:crypto";
import { DomainError } from "./domain";

export const MAX_PLACE_CANDIDATE_IMPORT_RECORDS = 100;
export const MAX_PLACE_CANDIDATE_BODY_BYTES = 1_048_576;
export const MAX_PLACE_CANDIDATE_PAGE_SIZE = 100;

const CANDIDATE_ID = /^pcd_[a-f0-9]{64}$/;

export type PlaceCandidateKind = "golf_course" | "venue";
export type PlaceCandidateRetirementReason =
	| "source_removed"
	| "license_revoked"
	| "invalid_record"
	| "superseded";

export type PlaceCandidateInput = {
	source: string;
	sourceRecordId: string;
	kind: PlaceCandidateKind;
	name: string;
	locality: string | null;
	region: string | null;
	countryCode: string;
	latitude: number | null;
	longitude: number | null;
	sourceRecordUrl: string | null;
	license: {
		code: string;
		url: string | null;
		attribution: string;
		allowsSearchIndex: boolean;
	};
	retrievedAt: Date;
	confidence: number;
	expiresAt: Date | null;
	retirement: {
		retiredAt: Date;
		reason: PlaceCandidateRetirementReason;
	} | null;
};

export type PlaceCandidateRecord = PlaceCandidateInput & {
	id: string;
	version: number;
	createdAt: Date;
	updatedAt: Date;
};

export type PlaceCandidateImportOutcome =
	| "inserted"
	| "updated"
	| "unchanged"
	| "stale";

export type PlaceCandidateImportResult = {
	outcome: PlaceCandidateImportOutcome;
	candidate: PlaceCandidateRecord;
};

export type PlaceCandidatePage = {
	items: PlaceCandidateRecord[];
	hasMore: boolean;
};

export interface PlaceCandidateRepository {
	importBatch(
		candidates: PlaceCandidateInput[],
	): Promise<PlaceCandidateImportResult[]>;
	listActive(input: {
		limit: number;
		afterId: string | null;
		now: Date;
	}): Promise<PlaceCandidatePage>;
}

export class PlaceCandidateService {
	constructor(private readonly repository: PlaceCandidateRepository) {}

	importBatch(candidates: PlaceCandidateInput[]) {
		if (
			candidates.length < 1 ||
			candidates.length > MAX_PLACE_CANDIDATE_IMPORT_RECORDS
		) {
			throw new DomainError(
				400,
				"PLACE_CANDIDATE_BATCH_INVALID",
				`A candidate batch must contain 1 to ${MAX_PLACE_CANDIDATE_IMPORT_RECORDS} records.`,
			);
		}
		return this.repository.importBatch(candidates);
	}

	async indexFeed(input: { limit: number; cursor?: string; now?: Date }) {
		if (input.limit < 1 || input.limit > MAX_PLACE_CANDIDATE_PAGE_SIZE) {
			throw new DomainError(
				400,
				"PLACE_CANDIDATE_PAGE_INVALID",
				`A candidate page must contain 1 to ${MAX_PLACE_CANDIDATE_PAGE_SIZE} records.`,
			);
		}
		const page = await this.repository.listActive({
			limit: input.limit,
			afterId: input.cursor ? decodePlaceCandidateCursor(input.cursor) : null,
			now: input.now ?? new Date(),
		});
		const last = page.items.at(-1);
		return {
			items: page.items,
			pageInfo: {
				hasMore: page.hasMore,
				nextCursor:
					page.hasMore && last ? encodePlaceCandidateCursor(last.id) : null,
			},
		};
	}
}

export function placeCandidateId(source: string, sourceRecordId: string) {
	return `pcd_${createHash("sha256")
		.update(JSON.stringify(["crew:place-candidate:v1", source, sourceRecordId]))
		.digest("hex")}`;
}

export function placeCandidateSnapshotHash(input: PlaceCandidateInput) {
	return createHash("sha256")
		.update(
			JSON.stringify({
				source: input.source,
				sourceRecordId: input.sourceRecordId,
				kind: input.kind,
				name: input.name,
				locality: input.locality,
				region: input.region,
				countryCode: input.countryCode,
				latitude: input.latitude,
				longitude: input.longitude,
				sourceRecordUrl: input.sourceRecordUrl,
				license: {
					code: input.license.code,
					url: input.license.url,
					attribution: input.license.attribution,
					allowsSearchIndex: input.license.allowsSearchIndex,
				},
				retrievedAt: input.retrievedAt.toISOString(),
				confidence: input.confidence,
				expiresAt: input.expiresAt?.toISOString() ?? null,
				retirement: input.retirement
					? {
							retiredAt: input.retirement.retiredAt.toISOString(),
							reason: input.retirement.reason,
						}
					: null,
			}),
		)
		.digest("hex");
}

function encodePlaceCandidateCursor(id: string) {
	return Buffer.from(
		JSON.stringify({ version: 1, afterId: id }),
		"utf8",
	).toString("base64url");
}

function decodePlaceCandidateCursor(cursor: string) {
	try {
		if (!/^[A-Za-z0-9_-]{16,512}$/.test(cursor)) throw new Error("shape");
		const bytes = Buffer.from(cursor, "base64url");
		if (bytes.toString("base64url") !== cursor) throw new Error("canonical");
		const value: unknown = JSON.parse(bytes.toString("utf8"));
		if (
			!value ||
			typeof value !== "object" ||
			Array.isArray(value) ||
			Object.keys(value).sort().join(",") !== "afterId,version" ||
			(value as { version?: unknown }).version !== 1 ||
			typeof (value as { afterId?: unknown }).afterId !== "string" ||
			!CANDIDATE_ID.test((value as { afterId: string }).afterId)
		) {
			throw new Error("payload");
		}
		return (value as { afterId: string }).afterId;
	} catch {
		throw new DomainError(
			400,
			"CURSOR_INVALID",
			"The place-candidate cursor is invalid.",
		);
	}
}
