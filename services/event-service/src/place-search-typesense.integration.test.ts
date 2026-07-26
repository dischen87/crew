import { describe, expect, test } from "bun:test";
import { createApp } from "./app";
import type {
	PlaceCandidateImportResult,
	PlaceCandidateIndexRecord,
	PlaceCandidateRepository,
} from "./place-candidate";
import { PlaceCandidateService } from "./place-candidate";
import { createPlaceCandidateServiceAuth } from "./place-candidate-auth";
import { TypesensePlaceSearchIndex } from "./place-search";
import { reindexPlaceSearch } from "./place-search-reindex";
import { loadPlaceSearchReindexConfig } from "./place-search-reindex-config";

const typesenseUrl = Bun.env.PLACE_SEARCH_TYPESENSE_TEST_URL;
const adminKey = Bun.env.PLACE_SEARCH_TYPESENSE_TEST_API_KEY;
const serviceKey = "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg";

if (!typesenseUrl || !adminKey) {
	test.skip("Typesense 30.2 place-search integration (set PLACE_SEARCH_TYPESENSE_TEST_URL and PLACE_SEARCH_TYPESENSE_TEST_API_KEY)", () => {});
} else {
	describe("place search against Typesense 30.2", () => {
		test("reindexes through an alias and serves exact, fuzzy, locality and status search", async () => {
			const alias = `crew_places_it_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
			const repository = new FixtureCandidateRepository([
				candidate(
					"a",
					"golf_course",
					"Golf Club Zürich",
					"Zürich",
					"CH",
					"pending",
				),
				candidate(
					"b",
					"venue",
					"Berlin Convention Hall",
					"Berlin",
					"DE",
					"enriched",
				),
			]);
			const app = createApp({
				placeCandidates: new PlaceCandidateService(repository),
				verifyPlaceCandidateServiceToken: createPlaceCandidateServiceAuth({
					issuer: "crew-place-catalog-it",
					audience: "crew-event-service-it",
					current: { id: "it-v1", key: serviceKey },
				}),
			});
			const server = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch: app.fetch,
			});
			let collectionName: string | undefined;
			try {
				const result = await reindexPlaceSearch(
					loadPlaceSearchReindexConfig({
						NODE_ENV: "test",
						PLACE_SEARCH_REINDEX_EVENT_SERVICE_URL: server.url.href,
						PLACE_SEARCH_REINDEX_TYPESENSE_URL: typesenseUrl,
						PLACE_SEARCH_REINDEX_TYPESENSE_ADMIN_API_KEY: adminKey,
						PLACE_SEARCH_REINDEX_ALIAS: alias,
						PLACE_SEARCH_REINDEX_SERVICE_ISSUER: "crew-place-catalog-it",
						PLACE_SEARCH_REINDEX_SERVICE_AUDIENCE: "crew-event-service-it",
						PLACE_SEARCH_REINDEX_SERVICE_KEY_ID: "it-v1",
						PLACE_SEARCH_REINDEX_SERVICE_KEY: serviceKey,
						PLACE_SEARCH_REINDEX_BATCH_SIZE: "1",
					}),
					{ randomId: () => crypto.randomUUID() },
				);
				collectionName = result.collectionName;
				expect(result).toMatchObject({
					alias,
					previousCollectionName: null,
					documentCount: 2,
				});

				const search = new TypesensePlaceSearchIndex({
					url: typesenseUrl,
					apiKey: adminKey,
					collectionAlias: alias,
					timeoutMs: 2000,
				});
				const exact = await search.search({
					query: "Golf Club Zürich",
					page: 1,
					limit: 10,
				});
				expect(exact.items[0]).toMatchObject({
					name: "Golf Club Zürich",
					status: "pending",
				});
				const fuzzy = await search.search({
					query: "Glof Club Zurih",
					page: 1,
					limit: 10,
				});
				expect(fuzzy.items.map(({ name }) => name)).toContain(
					"Golf Club Zürich",
				);
				const locality = await search.search({
					query: "Berlin",
					kind: "venue",
					countryCode: "DE",
					status: "enriched",
					page: 1,
					limit: 10,
				});
				expect(locality.items).toHaveLength(1);
				expect(locality.items[0]).toMatchObject({
					name: "Berlin Convention Hall",
					locality: "Berlin",
					countryCode: "DE",
					status: "enriched",
				});
			} finally {
				server.stop(true);
				await typesenseDelete(`aliases/${encodeURIComponent(alias)}`).catch(
					() => undefined,
				);
				if (collectionName)
					await typesenseDelete(
						`collections/${encodeURIComponent(collectionName)}`,
					).catch(() => undefined);
			}
		}, 30_000);
	});
}

class FixtureCandidateRepository implements PlaceCandidateRepository {
	constructor(private readonly records: PlaceCandidateIndexRecord[]) {}

	importBatch(): Promise<PlaceCandidateImportResult[]> {
		throw new Error("Fixture repository is read-only");
	}

	async listActive(input: { limit: number; afterId: string | null }) {
		const records = this.records
			.filter(({ id }) => input.afterId === null || id > input.afterId)
			.sort((left, right) => left.id.localeCompare(right.id));
		return {
			items: records.slice(0, input.limit),
			hasMore: records.length > input.limit,
		};
	}
}

function candidate(
	idSuffix: string,
	kind: "golf_course" | "venue",
	name: string,
	locality: string,
	countryCode: string,
	status: PlaceCandidateIndexRecord["status"],
): PlaceCandidateIndexRecord {
	const timestamp = new Date("2026-07-18T10:00:00.000Z");
	return {
		id: `pcd_${idSuffix.repeat(64)}`,
		source: "crew-fixture",
		sourceRecordId: `fixture-${idSuffix}`,
		kind,
		name,
		locality,
		region: locality,
		countryCode,
		latitude: null,
		longitude: null,
		sourceRecordUrl: `https://example.test/${idSuffix}`,
		license: {
			code: "CC-BY-4.0",
			url: "https://creativecommons.org/licenses/by/4.0/",
			attribution: "Crew fixture",
			allowsSearchIndex: true,
		},
		retrievedAt: timestamp,
		confidence: idSuffix === "a" ? 0.95 : 0.9,
		expiresAt: null,
		retirement: null,
		version: 1,
		createdAt: timestamp,
		updatedAt: timestamp,
		status,
	};
}

async function typesenseDelete(path: string) {
	const response = await fetch(`${typesenseUrl}/${path}`, {
		method: "DELETE",
		headers: { "X-TYPESENSE-API-KEY": adminKey ?? "" },
	});
	if (!response.ok && response.status !== 404)
		throw new Error(`Typesense cleanup failed with ${response.status}`);
}
