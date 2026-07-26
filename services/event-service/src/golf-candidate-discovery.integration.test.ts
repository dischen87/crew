import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import postgres, { type Sql } from "postgres";
import { BELEK_OVERPASS_FIXTURE } from "../../../infra/provider-sink";
import { migrate } from "../scripts/migrate";
import { createApp } from "./app";
import { EventNotificationPayloadCodec } from "./event-notification-payload";
import {
	importOsmGolfCandidates,
	loadGolfCandidateImportConfig,
} from "./golf-candidate-source";
import { PlaceCandidateService } from "./place-candidate";
import {
	createPlaceCandidateServiceAuth,
	issuePlaceCandidateServiceToken,
} from "./place-candidate-auth";
import {
	candidatePlaceFields,
	type PlaceEnrichmentPolicy,
} from "./place-enrichment";
import { PostgresPlaceEnrichmentJobs } from "./place-enrichment-jobs";
import { TypesensePlaceSearchIndex } from "./place-search";
import { candidateDocument } from "./place-search-reindex";
import { PostgresPlaceCandidateRepository } from "./postgres-place-candidate-repository";
import { PostgresEventRepository } from "./postgres-repository";
import { EventService } from "./service";

const databaseUrl = Bun.env.GOLF_DISCOVERY_TEST_DATABASE_URL;
const SERVICE_KEY = "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg";
const actorId = "usr_00000000000000000000000000000955";
const rootEventId = "evt_golf_discovery";
const enrichmentScope = {
	rootEventId,
	eventId: rootEventId,
	capabilityType: "golf" as const,
};

if (!databaseUrl) {
	test.skip("golf discovery PostgreSQL integration (set GOLF_DISCOVERY_TEST_DATABASE_URL)", () => {});
} else {
	describe("worldwide golf discovery against PostgreSQL 17", () => {
		let sql: Sql;
		let app: ReturnType<typeof createApp>;
		let service: EventService;

		beforeAll(async () => {
			sql = postgres(databaseUrl, { max: 12, onnotice: () => {} });
			await migrate(sql);
			const placeCandidates = new PlaceCandidateService(
				new PostgresPlaceCandidateRepository(sql),
			);
			service = new EventService(
				new PostgresEventRepository(
					sql,
					new EventNotificationPayloadCodec({
						kid: "golf-discovery-v1",
						key: "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
					}),
				),
				"golf-discovery-invitation-key-with-at-least-32-characters",
				undefined,
				"golf-discovery-sync-key-with-at-least-32-characters",
				undefined,
				policy(),
			);
			app = createApp({
				service,
				placeCandidates,
				verifyUserToken: async (token) => ({ id: token }),
				verifyPlaceCandidateServiceToken: createPlaceCandidateServiceAuth({
					issuer: "crew-place-catalog",
					audience: "crew-event-service",
					current: { id: "golf-import-v1", key: SERVICE_KEY },
				}),
			});
		});

		beforeEach(async () => {
			await sql`TRUNCATE event_idempotency_records, event_roots, place_candidates CASCADE`;
			await service.createRoot(
				{ id: actorId },
				{
					id: rootEventId,
					kind: "golf",
					title: "Golf discovery",
					description: "Golf candidate selection fixture.",
					timeZone: "Europe/Zurich",
					startsAt: null,
					endsAt: null,
					status: "draft",
				},
			);
			await service.replaceCapability(
				{ id: actorId },
				rootEventId,
				rootEventId,
				0,
				{
					type: "golf",
					schemaVersion: 1,
					config: {
						coursePlaceId: null,
						teeFormat: "individual",
						handicapMode: "optional",
						scoringMode: "stableford",
						roundState: "planned",
					},
				},
			);
		});

		afterAll(async () => {
			await sql.end();
		});

		test("imports Belek identities, searches pending, and selects one budgeted job", async () => {
			const config = golfImportConfig();
			const imported = await importOsmGolfCandidates(config, {
				now: () => new Date("2026-07-19T00:00:00.000Z"),
				fetch: async (input, init) => {
					const url = new URL(input instanceof Request ? input.url : input);
					return url.hostname === "overpass.test"
						? Response.json(BELEK_OVERPASS_FIXTURE)
						: app.request(new Request(url, init));
				},
			});
			expect(
				imported.results.map(({ candidate }) => candidate.sourceRecordId),
			).toEqual([
				"relation/3872398",
				"way/126258746",
				"way/169450196",
				"way/169451379",
				"way/169451380",
			]);
			expect(
				new Set(imported.results.map(({ candidate }) => candidate.id)).size,
			).toBe(5);

			const feed = await candidateFeed(config);
			expect(feed.items).toHaveLength(5);
			const carya = feed.items.find(
				(item) => item.sourceRecordId === "way/169450196",
			);
			expect(carya).toMatchObject({
				name: "Carya Golf Club",
				locality: "Belek",
				countryCode: "TR",
				license: {
					code: "ODbL-1.0",
					attribution: "© OpenStreetMap contributors",
					allowsSearchIndex: true,
				},
			});
			if (!carya) throw new Error("Expected the Carya OSM fixture");
			const beforeSelection = await counts();
			expect(beforeSelection).toEqual({ places: 0, jobs: 0 });

			const document = candidateDocument(
				carya as Parameters<typeof candidateDocument>[0],
			);
			const { sortId: _sortId, ...searchDocument } = document;
			let searchUrl: URL | undefined;
			const search = await new TypesensePlaceSearchIndex({
				url: "https://typesense.test",
				apiKey: "search-only-key-123456",
				collectionAlias: "crew_places",
				timeoutMs: 1_000,
				fetch: async (input) => {
					searchUrl = new URL(input instanceof Request ? input.url : input);
					return Response.json({
						found: 1,
						hits: [{ document: searchDocument }],
					});
				},
			}).search({
				query: "Carya Belek",
				kind: "golf_course",
				countryCode: "TR",
				status: "pending",
				page: 1,
				limit: 20,
			});
			expect(search.items).toEqual([
				expect.objectContaining({
					id: carya.id,
					status: "pending",
					source: "osm",
				}),
			]);
			expect(searchUrl?.searchParams.get("filter_by")).toBe(
				"kind:=golf_course && countryCode:=TR && status:=pending",
			);

			const selections = await Promise.all(
				Array.from({ length: 6 }, (_, index) => select(carya.id, index)),
			);
			expect(selections.every((response) => response.status === 202)).toBe(
				true,
			);
			const selectionBodies = await Promise.all(
				selections.map((response) => response.json()),
			);
			const jobIds = selectionBodies.map(
				(body) => (body as { enrichment: { id: string } }).enrichment.id,
			);
			expect(new Set(jobIds).size).toBe(1);
			expect(await counts()).toEqual({ places: 1, jobs: 1 });

			const jobs = new PostgresPlaceEnrichmentJobs(sql);
			const claim = await jobs.claim({
				workerId: "golf-worker",
				leaseMs: 30_000,
			});
			if (!claim) throw new Error("Expected one selected golf enrichment job");
			expect(claim.target).toMatchObject({
				type: "candidate",
				candidateSource: "osm",
				candidateSourceUrl: "https://www.openstreetmap.org/way/169450196",
			});
			const fields = candidatePlaceFields(
				claim,
				new Date("2026-07-19T00:01:00.000Z"),
			);
			expect(fields.every((field) => field.sourceKind === "candidate")).toBe(
				true,
			);
			expect(fields.every((field) => field.model === null)).toBe(true);
			expect(
				fields.every(
					(field) =>
						field.sourceUrl === "https://www.openstreetmap.org/way/169450196",
				),
			).toBe(true);

			const exa = await jobs.reserveProviderCall(claim, {
				provider: "exa",
				requestFingerprint: "a".repeat(64),
				inputTokens: 0,
				outputTokens: 0,
				costMicros: 100,
			});
			expect(exa).toBeObject();
			expect(
				await jobs.reserveProviderCall(claim, {
					provider: "exa",
					requestFingerprint: "b".repeat(64),
					inputTokens: 0,
					outputTokens: 0,
					costMicros: 1,
				}),
			).toBe("budget_exhausted");
			const llm = await jobs.reserveProviderCall(claim, {
				provider: "llm",
				requestFingerprint: "c".repeat(64),
				inputTokens: 100,
				outputTokens: 50,
				costMicros: 900,
			});
			expect(llm).toBeObject();
			expect(
				await jobs.reserveProviderCall(claim, {
					provider: "llm",
					requestFingerprint: "d".repeat(64),
					inputTokens: 1,
					outputTokens: 0,
					costMicros: 1,
				}),
			).toBe("budget_exhausted");
			expect(await jobs.complete(claim, fields)).toBe(true);

			const [budget] = await sql<
				{
					providerCalls: number;
					inputTokens: number;
					outputTokens: number;
					costMicros: number;
					provenanceFields: number;
				}[]
			>`
				SELECT
					(SELECT count(*)::int FROM place_enrichment_provider_calls
						WHERE job_id = ${claim.id}) AS "providerCalls",
					input_tokens_reserved AS "inputTokens",
					output_tokens_reserved AS "outputTokens",
					cost_micros_reserved AS "costMicros",
					(SELECT count(*)::int FROM place_enrichment_fields
						WHERE job_id = ${claim.id} AND source_kind = 'candidate'
						AND source_url = 'https://www.openstreetmap.org/way/169450196'
						AND model IS NULL AND prompt_version IS NULL) AS "provenanceFields"
				FROM place_enrichment_jobs WHERE id = ${claim.id}
			`;
			expect(budget).toEqual({
				providerCalls: 2,
				inputTokens: 100,
				outputTokens: 50,
				costMicros: 1_000,
				provenanceFields: fields.length,
			});
		});

		async function candidateFeed(config: ReturnType<typeof golfImportConfig>) {
			const token = await issuePlaceCandidateServiceToken({
				issuer: config.serviceIssuer,
				audience: config.serviceAudience,
				key: { id: config.serviceKeyId, key: config.serviceKey },
				scope: "event:place-candidates:read",
			});
			const response = await app.request(
				"/internal/v1/place-candidates/index-feed?limit=100",
				{ headers: { Authorization: `Bearer ${token}` } },
			);
			expect(response.status).toBe(200);
			return response.json() as Promise<{
				items: Array<Parameters<typeof candidateDocument>[0]>;
			}>;
		}

		function select(candidateId: string, index: number) {
			return app.request("/v1/places/enrichment-jobs", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${actorId}`,
					"Content-Type": "application/json",
					"Idempotency-Key": `golf-select-${index}`,
				},
				body: JSON.stringify({
					...enrichmentScope,
					target: "candidate",
					candidateId,
				}),
			});
		}

		async function counts() {
			const [row] = await sql<{ places: number; jobs: number }[]>`
				SELECT
					(SELECT count(*)::int FROM global_places) AS places,
					(SELECT count(*)::int FROM place_enrichment_jobs) AS jobs
			`;
			return row;
		}
	});
}

function golfImportConfig() {
	return loadGolfCandidateImportConfig({
		NODE_ENV: "test",
		PLACE_GOLF_IMPORT_EVENT_SERVICE_URL: "https://event.test",
		PLACE_GOLF_IMPORT_OVERPASS_URL: "https://overpass.test/interpreter",
		PLACE_GOLF_IMPORT_BOUNDS: "36.78,30.90,36.95,31.30",
		PLACE_GOLF_IMPORT_COUNTRY_CODE: "TR",
		PLACE_GOLF_IMPORT_LOCALITY: "Belek",
		PLACE_GOLF_IMPORT_REGION: "Antalya",
		PLACE_GOLF_IMPORT_SERVICE_ISSUER: "crew-place-catalog",
		PLACE_GOLF_IMPORT_SERVICE_AUDIENCE: "crew-event-service",
		PLACE_GOLF_IMPORT_SERVICE_KEY_ID: "golf-import-v1",
		PLACE_GOLF_IMPORT_SERVICE_KEY: SERVICE_KEY,
	});
}

function policy(): PlaceEnrichmentPolicy {
	return {
		pipelineVersion: "golf-discovery-v1",
		model: "fixture-model",
		promptVersion: "golf-discovery-v1",
		maxAttempts: 2,
		maxExaCalls: 1,
		maxLlmCalls: 1,
		maxInputTokens: 100,
		maxOutputTokens: 50,
		maxCostMicros: 1_000,
		providerTimeoutMs: 1_000,
		maxResponseBytes: 32_768,
	};
}
