import { describe, expect, test } from "bun:test";
import type { BoundedFetch } from "./bounded-fetch";
import {
	createPlaceCandidateServiceAuth,
	PLACE_CANDIDATE_READ_SCOPE,
} from "./place-candidate-auth";
import { reindexPlaceSearch } from "./place-search-reindex";
import { loadPlaceSearchReindexConfig } from "./place-search-reindex-config";

const SERVICE_KEY = "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg";
const firstCandidate = candidate("a", "Golf Club Zürich", "Zürich", 0.95);
const secondCandidate = candidate("b", "Zurich Convention Hall", null, 0.8);

describe("place-search reindex", () => {
	test("imports an authenticated bounded feed, verifies the version and swaps once", async () => {
		const fake = new RepresentativeTypesense();
		const result = await reindexPlaceSearch(config(), {
			fetch: fake.fetch,
			now: () => new Date("2026-07-18T12:34:56.789Z"),
			randomId: () => "run-atomic-001",
		});

		expect(result).toEqual({
			alias: "crew_places",
			collectionName: "crew_places_20260718123456789_runatomic001",
			previousCollectionName: "crew_places_previous",
			documentCount: 2,
		});
		expect(fake.authenticatedFeedRequests).toBe(2);
		expect(fake.aliases.get("crew_places")).toBe(result.collectionName);
		expect(fake.collections.has("crew_places_previous")).toBe(true);
		expect(
			[...(fake.collections.get(result.collectionName)?.values() ?? [])].map(
				(document) => document.status,
			),
		).toEqual(["pending", "enriched"]);
		expect(fake.placeSchema?.fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "kind", facet: true }),
				expect.objectContaining({ name: "countryCode", facet: true }),
				expect.objectContaining({ name: "status", facet: true }),
				expect.objectContaining({ name: "sortId", sort: true }),
			]),
		);
		const swap = fake.operations.indexOf("alias:put");
		expect(swap).toBeGreaterThan(fake.operations.indexOf("collection:probe"));
		expect(swap).toBeGreaterThan(fake.operations.indexOf("document:probe"));
		expect(
			fake.operations.filter((operation) => operation === "alias:put"),
		).toHaveLength(1);
	});

	test("keeps the previous alias live and cleans an unverified version on import failure", async () => {
		const fake = new RepresentativeTypesense(true);
		await expect(
			reindexPlaceSearch(config(), {
				fetch: fake.fetch,
				now: () => new Date("2026-07-18T12:34:56.789Z"),
				randomId: () => "run-failure-001",
			}),
		).rejects.toThrow("document-import result");

		expect(fake.aliases.get("crew_places")).toBe("crew_places_previous");
		expect(fake.operations).not.toContain("alias:put");
		expect(fake.operations).toContain("collection:delete");
		expect(
			[...fake.collections.keys()].filter((name) =>
				name.startsWith("crew_places_2026"),
			),
		).toEqual([]);
	});

	test("loads a least-privilege runtime without API search or database secrets", () => {
		const value = loadPlaceSearchReindexConfig({
			PLACE_SEARCH_REINDEX_TYPESENSE_ADMIN_API_KEY: "admin-key-123456789",
			PLACE_SEARCH_REINDEX_SERVICE_KEY: SERVICE_KEY,
			PLACE_SEARCH_REINDEX_SERVICE_KEY_ID: "reindex-v1",
			PLACE_SEARCH_REINDEX_EVENT_SERVICE_URL: "http://event.test",
			PLACE_SEARCH_REINDEX_TYPESENSE_URL: "http://typesense.test",
			EVENT_DATABASE_URL: "must-not-be-read",
			PLACE_SEARCH_TYPESENSE_SEARCH_API_KEY: "must-not-be-read",
		});
		expect(value).toMatchObject({
			typesenseAdminApiKey: "admin-key-123456789",
			serviceKeyId: "reindex-v1",
			batchSize: 100,
			maxDocuments: 50_000,
		});
		expect(JSON.stringify(value)).not.toContain("must-not-be-read");
	});
});

function config() {
	return loadPlaceSearchReindexConfig({
		NODE_ENV: "test",
		PLACE_SEARCH_REINDEX_EVENT_SERVICE_URL: "https://event.example.test",
		PLACE_SEARCH_REINDEX_TYPESENSE_URL: "https://typesense.example.test",
		PLACE_SEARCH_REINDEX_TYPESENSE_ADMIN_API_KEY: "admin-key-123456789",
		PLACE_SEARCH_REINDEX_ALIAS: "crew_places",
		PLACE_SEARCH_REINDEX_SERVICE_ISSUER: "crew-place-catalog",
		PLACE_SEARCH_REINDEX_SERVICE_AUDIENCE: "crew-event-service",
		PLACE_SEARCH_REINDEX_SERVICE_KEY_ID: "reindex-v1",
		PLACE_SEARCH_REINDEX_SERVICE_KEY: SERVICE_KEY,
		PLACE_SEARCH_REINDEX_BATCH_SIZE: "1",
	});
}

function candidate(
	idSuffix: string,
	name: string,
	locality: string | null,
	confidence: number,
) {
	return {
		id: `pcd_${idSuffix.repeat(64)}`,
		source: "crew-fixture",
		sourceRecordId: `source-${idSuffix}`,
		kind: idSuffix === "a" ? "golf_course" : "venue",
		name,
		locality,
		region: locality ? "Zürich" : null,
		countryCode: "CH",
		latitude: locality ? 47.3769 : null,
		longitude: locality ? 8.5417 : null,
		sourceRecordUrl: `https://example.test/${idSuffix}`,
		license: {
			code: "CC-BY-4.0",
			url: "https://creativecommons.org/licenses/by/4.0/",
			attribution: "Crew fixture",
			allowsSearchIndex: true,
		},
		retrievedAt: "2026-07-18T10:00:00.000Z",
		confidence,
		expiresAt: null,
		retirement: null,
		version: 1,
		createdAt: "2026-07-18T10:00:00.000Z",
		updatedAt: "2026-07-18T10:00:00.000Z",
		status: idSuffix === "a" ? ("pending" as const) : ("enriched" as const),
	};
}

class RepresentativeTypesense {
	readonly operations: string[] = [];
	readonly collections = new Map<string, Map<string, Record<string, unknown>>>([
		["crew_places_previous", new Map()],
	]);
	readonly aliases = new Map([["crew_places", "crew_places_previous"]]);
	authenticatedFeedRequests = 0;
	placeSchema?: { fields: Array<Record<string, unknown>> };
	private readonly locks = new Map<
		string,
		{ id: string; runId: string; expiresAt: number }
	>();
	private readonly verifier = createPlaceCandidateServiceAuth({
		issuer: "crew-place-catalog",
		audience: "crew-event-service",
		current: { id: "reindex-v1", key: SERVICE_KEY },
	});

	constructor(private readonly failImport = false) {}

	readonly fetch: BoundedFetch = async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : input);
		if (url.hostname === "event.example.test") return this.feed(url, init);
		if (url.hostname !== "typesense.example.test")
			return new Response(null, { status: 404 });
		if (
			new Headers(init?.headers).get("x-typesense-api-key") !==
			"admin-key-123456789"
		)
			return Response.json({}, { status: 401 });
		return this.typesense(url, init);
	};

	private async feed(url: URL, init?: RequestInit) {
		const token = /^Bearer (.+)$/.exec(
			new Headers(init?.headers).get("authorization") ?? "",
		)?.[1];
		if (!token || !(await this.verifier(token, PLACE_CANDIDATE_READ_SCOPE)))
			return Response.json({}, { status: 401 });
		this.authenticatedFeedRequests += 1;
		const cursor = url.searchParams.get("cursor");
		return Response.json(
			cursor
				? {
						items: [secondCandidate],
						pageInfo: { hasMore: false, nextCursor: null },
					}
				: {
						items: [firstCandidate],
						pageInfo: {
							hasMore: true,
							nextCursor: "cGFnZS10d28tY3Vyc29y",
						},
					},
		);
	}

	private async typesense(url: URL, init?: RequestInit) {
		const method = init?.method ?? "GET";
		const parts = url.pathname
			.split("/")
			.filter(Boolean)
			.map(decodeURIComponent);
		if (method === "POST" && url.pathname === "/collections") {
			const body = JSON.parse(String(init?.body)) as {
				name: string;
				fields: Array<Record<string, unknown>>;
			};
			if (this.collections.has(body.name))
				return Response.json({}, { status: 409 });
			this.collections.set(body.name, new Map());
			if (body.name !== "crew_place_reindex_locks") {
				this.placeSchema = body;
				this.operations.push("collection:create");
			}
			return Response.json({ name: body.name }, { status: 201 });
		}
		if (parts[0] === "aliases" && parts[1]) {
			const alias = parts[1];
			if (method === "GET") {
				const collection = this.aliases.get(alias);
				return collection
					? Response.json({ name: alias, collection_name: collection })
					: Response.json({}, { status: 404 });
			}
			if (method === "PUT") {
				const { collection_name: collection } = JSON.parse(
					String(init?.body),
				) as {
					collection_name: string;
				};
				this.aliases.set(alias, collection);
				this.operations.push("alias:put");
				return Response.json({ name: alias, collection_name: collection });
			}
		}
		if (parts[0] !== "collections" || !parts[1])
			return Response.json({}, { status: 404 });
		const requestedCollection = parts[1];
		const collectionName =
			this.aliases.get(requestedCollection) ?? requestedCollection;
		const documents = this.collections.get(collectionName);
		if (method === "DELETE" && parts.length === 2) {
			this.collections.delete(collectionName);
			this.operations.push("collection:delete");
			return Response.json({ name: collectionName });
		}
		if (method === "GET" && parts.length === 2) {
			return documents
				? Response.json({
						name: collectionName,
						num_documents: documents.size,
					})
				: Response.json({}, { status: 404 });
		}
		if (collectionName === "crew_place_reindex_locks") {
			return this.lock(parts, method, init);
		}
		if (!documents) return Response.json({}, { status: 404 });
		if (
			method === "POST" &&
			parts[2] === "documents" &&
			parts[3] === "import"
		) {
			const inputs = String(init?.body)
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as Record<string, unknown>);
			if (this.failImport)
				return new Response('{"success":false,"error":"fixture"}\n');
			for (const document of inputs)
				documents.set(String(document.id), document);
			this.operations.push("documents:import");
			return new Response(
				`${inputs.map(({ id }) => JSON.stringify({ success: true, id })).join("\n")}\n`,
			);
		}
		if (method === "GET" && parts[2] === "documents" && parts[3] === "search") {
			this.operations.push("collection:probe");
			const hits = [...documents.values()].slice(0, 1).map((document) => ({
				document: { id: document.id },
			}));
			return Response.json({ found: documents.size, hits });
		}
		if (method === "GET" && parts[2] === "documents" && parts[3]) {
			this.operations.push("document:probe");
			const document = documents.get(parts[3]);
			return document
				? Response.json(document)
				: Response.json({}, { status: 404 });
		}
		return Response.json({}, { status: 404 });
	}

	private lock(parts: string[], method: string, init?: RequestInit) {
		const id = parts[3];
		if (method === "POST" && parts[2] === "documents") {
			const value = JSON.parse(String(init?.body)) as {
				id: string;
				runId: string;
				expiresAt: number;
			};
			if (this.locks.has(value.id)) return Response.json({}, { status: 409 });
			this.locks.set(value.id, value);
			return Response.json(value, { status: 201 });
		}
		if (!id) return Response.json({}, { status: 404 });
		if (method === "GET") {
			const value = this.locks.get(id);
			return value ? Response.json(value) : Response.json({}, { status: 404 });
		}
		if (method === "DELETE") {
			this.locks.delete(id);
			return Response.json({ id });
		}
		return Response.json({}, { status: 404 });
	}
}
