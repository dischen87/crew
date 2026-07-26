import type { Sql } from "postgres";
import { DomainError } from "./domain";
import {
	type PlaceCandidateImportResult,
	type PlaceCandidateIndexRecord,
	type PlaceCandidateInput,
	type PlaceCandidatePage,
	type PlaceCandidateRecord,
	type PlaceCandidateRepository,
	type PlaceCandidateRetirementReason,
	placeCandidateId,
	placeCandidateSnapshotHash,
} from "./place-candidate";

type Tx = Sql;

type CandidateRow = {
	id: string;
	source: string;
	sourceRecordId: string;
	kind: "golf_course" | "venue";
	name: string;
	locality: string | null;
	region: string | null;
	countryCode: string;
	latitude: number | null;
	longitude: number | null;
	sourceRecordUrl: string | null;
	licenseCode: string;
	licenseUrl: string | null;
	attribution: string;
	allowsSearchIndex: boolean;
	retrievedAt: Date;
	confidence: number;
	expiresAt: Date | null;
	retiredAt: Date | null;
	retirementReason: PlaceCandidateRetirementReason | null;
	snapshotHash: string;
	version: number;
	createdAt: Date;
	updatedAt: Date;
};

type CandidateIndexRow = CandidateRow & {
	status: PlaceCandidateIndexRecord["status"];
};

export class PostgresPlaceCandidateRepository
	implements PlaceCandidateRepository
{
	constructor(private readonly sql: Sql) {}

	async importBatch(
		candidates: PlaceCandidateInput[],
	): Promise<PlaceCandidateImportResult[]> {
		return this.sql.begin(async (transaction) => {
			const tx = transaction as unknown as Tx;
			const prepared = candidates.map((input) => ({
				id: placeCandidateId(input.source, input.sourceRecordId),
				hash: placeCandidateSnapshotHash(input),
				input,
			}));
			const ids = [...new Set(prepared.map(({ id }) => id))].sort();
			for (const id of ids) {
				await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:place-candidate:${id}`}, 0))`;
			}

			const results: PlaceCandidateImportResult[] = [];
			for (const candidate of prepared) {
				const [current] = await tx<CandidateRow[]>`
					SELECT ${candidateColumns(tx)} FROM place_candidates
					WHERE id = ${candidate.id} FOR UPDATE
				`;
				if (!current) {
					const [inserted] = await tx<CandidateRow[]>`
						INSERT INTO place_candidates (
							id, source, source_record_id, kind, name, locality, region,
							country_code, latitude, longitude, source_record_url,
							license_code, license_url, attribution, search_index_allowed,
							retrieved_at, confidence, expires_at, retired_at,
							retirement_reason, snapshot_hash
						) VALUES (
							${candidate.id}, ${candidate.input.source},
							${candidate.input.sourceRecordId}, ${candidate.input.kind},
							${candidate.input.name}, ${candidate.input.locality},
							${candidate.input.region}, ${candidate.input.countryCode},
							${candidate.input.latitude}, ${candidate.input.longitude},
							${candidate.input.sourceRecordUrl}, ${candidate.input.license.code},
							${candidate.input.license.url}, ${candidate.input.license.attribution},
							${candidate.input.license.allowsSearchIndex},
							${candidate.input.retrievedAt}, ${candidate.input.confidence},
							${candidate.input.expiresAt},
							${candidate.input.retirement?.retiredAt ?? null},
							${candidate.input.retirement?.reason ?? null}, ${candidate.hash}
						) RETURNING ${candidateColumns(tx)}
					`;
					if (!inserted)
						throw new Error("Place-candidate insert invariant failed");
					results.push({
						outcome: "inserted",
						candidate: candidateRecord(inserted),
					});
					continue;
				}

				const chronology =
					candidate.input.retrievedAt.getTime() - current.retrievedAt.getTime();
				if (chronology < 0) {
					results.push({
						outcome: "stale",
						candidate: candidateRecord(current),
					});
					continue;
				}
				if (chronology === 0) {
					if (current.snapshotHash !== candidate.hash) {
						throw new DomainError(
							409,
							"PLACE_CANDIDATE_SNAPSHOT_CONFLICT",
							"The source identity already has different facts at this retrieval time.",
						);
					}
					results.push({
						outcome: "unchanged",
						candidate: candidateRecord(current),
					});
					continue;
				}

				const [updated] = await tx<CandidateRow[]>`
					UPDATE place_candidates SET
						kind = ${candidate.input.kind}, name = ${candidate.input.name},
						locality = ${candidate.input.locality}, region = ${candidate.input.region},
						country_code = ${candidate.input.countryCode},
						latitude = ${candidate.input.latitude}, longitude = ${candidate.input.longitude},
						source_record_url = ${candidate.input.sourceRecordUrl},
						license_code = ${candidate.input.license.code},
						license_url = ${candidate.input.license.url},
						attribution = ${candidate.input.license.attribution},
						search_index_allowed = ${candidate.input.license.allowsSearchIndex},
						retrieved_at = ${candidate.input.retrievedAt},
						confidence = ${candidate.input.confidence}, expires_at = ${candidate.input.expiresAt},
						retired_at = ${candidate.input.retirement?.retiredAt ?? null},
						retirement_reason = ${candidate.input.retirement?.reason ?? null},
						snapshot_hash = ${candidate.hash}, version = version + 1,
						updated_at = clock_timestamp()
					WHERE id = ${candidate.id}
					RETURNING ${candidateColumns(tx)}
				`;
				if (!updated)
					throw new Error("Place-candidate update invariant failed");
				results.push({
					outcome: "updated",
					candidate: candidateRecord(updated),
				});
			}
			return results;
		}) as Promise<PlaceCandidateImportResult[]>;
	}

	async listActive(input: {
		limit: number;
		afterId: string | null;
		now: Date;
	}): Promise<PlaceCandidatePage> {
		const rows = await this.sql<CandidateIndexRow[]>`
			SELECT ${candidateColumns(this.sql)},
				CASE WHEN EXISTS (
					SELECT 1 FROM place_enrichment_jobs job
					WHERE job.candidate_id = place_candidates.id
						AND job.candidate_snapshot_hash = place_candidates.snapshot_hash
						AND job.status = 'succeeded'
				) THEN 'enriched' ELSE 'pending' END AS status
			FROM place_candidates
			WHERE retired_at IS NULL AND search_index_allowed
				AND (expires_at IS NULL OR expires_at > ${input.now})
				${input.afterId ? this.sql`AND id > ${input.afterId}` : this.sql``}
			ORDER BY id
			LIMIT ${input.limit + 1}
		`;
		return {
			items: rows.slice(0, input.limit).map((row) => ({
				...candidateRecord(row),
				status: row.status,
			})),
			hasMore: rows.length > input.limit,
		};
	}
}

function candidateColumns(sql: Tx) {
	return sql`
		id, source, source_record_id AS "sourceRecordId", kind, name, locality, region,
		country_code AS "countryCode", latitude, longitude,
		source_record_url AS "sourceRecordUrl", license_code AS "licenseCode",
		license_url AS "licenseUrl", attribution,
		search_index_allowed AS "allowsSearchIndex", retrieved_at AS "retrievedAt",
		confidence, expires_at AS "expiresAt", retired_at AS "retiredAt",
		retirement_reason AS "retirementReason", snapshot_hash AS "snapshotHash",
		version, created_at AS "createdAt", updated_at AS "updatedAt"
	`;
}

function candidateRecord(row: CandidateRow): PlaceCandidateRecord {
	if ((row.retiredAt === null) !== (row.retirementReason === null)) {
		throw new Error("Place-candidate retirement invariant failed");
	}
	return {
		id: row.id,
		source: row.source,
		sourceRecordId: row.sourceRecordId,
		kind: row.kind,
		name: row.name,
		locality: row.locality,
		region: row.region,
		countryCode: row.countryCode,
		latitude: row.latitude,
		longitude: row.longitude,
		sourceRecordUrl: row.sourceRecordUrl,
		license: {
			code: row.licenseCode,
			url: row.licenseUrl,
			attribution: row.attribution,
			allowsSearchIndex: row.allowsSearchIndex,
		},
		retrievedAt: row.retrievedAt,
		confidence: row.confidence,
		expiresAt: row.expiresAt,
		retirement: row.retiredAt
			? {
					retiredAt: row.retiredAt,
					reason: row.retirementReason as PlaceCandidateRetirementReason,
				}
			: null,
		version: row.version,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}
