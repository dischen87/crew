import { describe, expect, test } from "bun:test";
import { createApp } from "./app";
import { loadConfig } from "./config";
import {
	type PlaceSearchIndex,
	PlaceSearchService,
	TypesensePlaceSearchIndex,
} from "./place-search";

const pending = {
	id: `pcd_${"a".repeat(64)}`,
	kind: "golf_course" as const,
	name: "Golf Club Zürich",
	locality: "Zürich",
	region: "Zürich",
	countryCode: "CH",
	latitude: 47.3769,
	longitude: 8.5417,
	status: "pending" as const,
	source: "swiss-golf",
	sourceRecordUrl: "https://example.test/golf-zurich",
	licenseCode: "CC-BY-4.0",
	licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
	attribution: "Swiss Golf",
	retrievedAt: "2026-07-18T10:00:00.000Z",
	confidence: 0.95,
	version: 1,
};

describe("place search", () => {
	test("uses weighted exact/fuzzy/locality search with bounded filters", async () => {
		let requestUrl: URL | undefined;
		let requestHeaders: Headers | undefined;
		const index = new TypesensePlaceSearchIndex({
			url: "https://typesense.example.test",
			apiKey: "search-only-api-key",
			collectionAlias: "crew_places",
			timeoutMs: 1000,
			fetch: async (input, init) => {
				requestUrl = new URL(input instanceof Request ? input.url : input);
				requestHeaders = new Headers(init?.headers);
				return Response.json({
					found: 2,
					hits: [
						{ document: pending },
						{
							document: {
								...pending,
								id: "enr_zurich_golf",
								status: "enriched",
								version: 2,
							},
						},
					],
				});
			},
		});

		const result = await index.search({
			query: "golf zürich",
			kind: "golf_course",
			countryCode: "CH",
			page: 1,
			limit: 20,
		});

		expect(result.items.map(({ status }) => status)).toEqual([
			"pending",
			"enriched",
		]);
		expect(requestUrl?.pathname).toBe(
			"/collections/crew_places/documents/search",
		);
		expect(requestUrl?.searchParams.get("query_by")).toBe(
			"name,locality,region",
		);
		expect(requestUrl?.searchParams.get("query_by_weights")).toBe("8,3,2");
		expect(requestUrl?.searchParams.get("num_typos")).toBe("2,1,1");
		expect(requestUrl?.searchParams.get("prioritize_exact_match")).toBe("true");
		expect(requestUrl?.searchParams.get("drop_tokens_threshold")).toBe("0");
		expect(requestUrl?.searchParams.get("filter_by")).toBe(
			"kind:=golf_course && countryCode:=CH",
		);
		expect(requestUrl?.searchParams.get("per_page")).toBe("20");
		expect(requestHeaders?.get("x-typesense-api-key")).toBe(
			"search-only-api-key",
		);
	});

	test("binds opaque cursors to principal, normalized filters and sort", async () => {
		const pages: number[] = [];
		const fakeIndex: PlaceSearchIndex = {
			search: async ({ page }) => {
				pages.push(page);
				return { items: [pending], found: 3 };
			},
		};
		const search = new PlaceSearchService(
			fakeIndex,
			"place-search-test-cursor-key-with-32-chars",
		);
		const first = await search.search({
			actorId: "usr_one",
			query: "  golf   zürich ",
			kind: "golf_course",
			countryCode: "CH",
			limit: 2,
		});
		expect(first.pageInfo.hasMore).toBe(true);
		expect(first.pageInfo.nextCursor).not.toContain("page");

		const nextCursor = first.pageInfo.nextCursor;
		expect(nextCursor).not.toBeNull();
		const second = await search.search({
			actorId: "usr_one",
			query: "golf zürich",
			kind: "golf_course",
			countryCode: "CH",
			limit: 2,
			cursor: nextCursor as string,
		});
		expect(second.pageInfo.hasMore).toBe(false);
		expect(pages).toEqual([1, 2]);

		await expect(
			search.search({
				actorId: "usr_other",
				query: "golf zürich",
				kind: "golf_course",
				countryCode: "CH",
				limit: 2,
				cursor: nextCursor as string,
			}),
		).rejects.toMatchObject({ status: 400, code: "CURSOR_INVALID" });
	});

	test("exposes an authenticated public contract and maps dependency failure to 503", async () => {
		const working = new PlaceSearchService(
			{ search: async () => ({ items: [pending], found: 1 }) },
			"place-search-test-cursor-key-with-32-chars",
		);
		const app = createApp({
			placeSearch: working,
			verifyUserToken: async (token) => ({ id: token }),
		});
		expect((await app.request("/v1/places/search?q=Zurich")).status).toBe(401);
		const response = await app.request(
			"/v1/places/search?q=Zurich&kind=golf_course&countryCode=CH",
			{ headers: { Authorization: "Bearer usr_one" } },
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			items: [{ id: pending.id, status: "pending" }],
			pageInfo: { hasMore: false, nextCursor: null },
		});
		expect(
			(
				await app.request("/v1/places/search?q=Zurich&countryCode=ch", {
					headers: { Authorization: "Bearer usr_one" },
				})
			).status,
		).toBe(400);

		const unavailable = new TypesensePlaceSearchIndex({
			url: "https://typesense.example.test",
			apiKey: "search-only-api-key",
			collectionAlias: "crew_places",
			timeoutMs: 100,
			fetch: async () => Response.json({}, { status: 503 }),
		});
		await expect(
			unavailable.search({ query: "Zurich", page: 1, limit: 20 }),
		).rejects.toMatchObject({
			status: 503,
			code: "SERVICE_UNAVAILABLE",
			headers: { "Retry-After": "1" },
		});
	});

	test("keeps the API runtime free of Typesense admin credentials", () => {
		const config = loadConfig({
			PLACE_SEARCH_TYPESENSE_SEARCH_API_KEY: "search-only-key-123456",
			PLACE_SEARCH_CURSOR_KEY: "dedicated-place-search-cursor-key-123456",
			PLACE_SEARCH_REINDEX_TYPESENSE_ADMIN_API_KEY:
				"must-not-be-read-by-event-api",
		});
		expect(config.typesenseSearchApiKey).toBe("search-only-key-123456");
		expect(JSON.stringify(config)).not.toContain("must-not-be-read");
		expect(() =>
			loadConfig({
				PLACE_SEARCH_CURSOR_KEY: "crew-development-sync-cursor-key-change-me",
			}),
		).toThrow("must differ");
	});
});
