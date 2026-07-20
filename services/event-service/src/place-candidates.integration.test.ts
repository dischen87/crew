import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import postgres, { type Sql } from "postgres";
import { migrate } from "../scripts/migrate";
import { createApp } from "./app";
import type { EventInput } from "./domain";
import { EventNotificationPayloadCodec } from "./event-notification-payload";
import {
	MAX_PLACE_CANDIDATE_BODY_BYTES,
	PlaceCandidateService,
	placeCandidateId,
} from "./place-candidate";
import {
	createPlaceCandidateServiceAuth,
	issuePlaceCandidateServiceToken,
	PLACE_CANDIDATE_READ_SCOPE,
	PLACE_CANDIDATE_WRITE_SCOPE,
} from "./place-candidate-auth";
import { PostgresPlaceCandidateRepository } from "./postgres-place-candidate-repository";
import { PostgresEventRepository } from "./postgres-repository";
import { EventService } from "./service";

const databaseUrl = Bun.env.PLACE_CANDIDATE_TEST_DATABASE_URL;
const current = {
	id: "catalog-current",
	key: "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg",
};
const previous = {
	id: "catalog-previous",
	key: "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk",
};
const issuer = "crew-place-catalog-test";
const audience = "crew-event-service-test";
const owner = { id: "usr_00000000000000000000000000000001" };

if (!databaseUrl) {
	test.skip("place-candidate PostgreSQL integration (set PLACE_CANDIDATE_TEST_DATABASE_URL)", () => {});
} else {
	describe("worldwide place-candidate catalog against PostgreSQL 17", () => {
		let sql: Sql;
		let app: ReturnType<typeof createApp>;
		let eventService: EventService;
		let writeToken: string;
		let readToken: string;
		let previousReadToken: string;

		beforeAll(async () => {
			sql = postgres(databaseUrl, { max: 12 });
			await migrate(sql);
			const placeCandidates = new PlaceCandidateService(
				new PostgresPlaceCandidateRepository(sql),
			);
			eventService = new EventService(
				new PostgresEventRepository(
					sql,
					new EventNotificationPayloadCodec({
						kid: "candidate-isolation",
						key: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
					}),
				),
				"candidate-isolation-invitation-key-with-32-characters",
			);
			app = createApp({
				service: eventService,
				placeCandidates,
				verifyPlaceCandidateServiceToken: createPlaceCandidateServiceAuth({
					issuer,
					audience,
					current,
					previous,
				}),
			});
			[writeToken, readToken, previousReadToken] = await Promise.all([
				issuePlaceCandidateServiceToken({
					issuer,
					audience,
					key: current,
					scope: PLACE_CANDIDATE_WRITE_SCOPE,
				}),
				issuePlaceCandidateServiceToken({
					issuer,
					audience,
					key: current,
					scope: PLACE_CANDIDATE_READ_SCOPE,
				}),
				issuePlaceCandidateServiceToken({
					issuer,
					audience,
					key: previous,
					scope: PLACE_CANDIDATE_READ_SCOPE,
				}),
			]);
		});

		beforeEach(async () => {
			await sql`TRUNCATE place_candidates, event_idempotency_records, event_roots CASCADE`;
		});

		afterAll(async () => {
			await sql.end();
		});

		test("enforces target-specific auth, route limits and auth-before-buffering", async () => {
			const missing = await app.request(
				"/internal/v1/place-candidates/index-feed",
			);
			expect(missing.status).toBe(401);

			const wrongScope = await importCandidates(
				[candidate("wrong-scope")],
				readToken,
			);
			expect(wrongScope.status).toBe(401);
			const previous = await app.request(
				"/internal/v1/place-candidates/index-feed",
				{ headers: bearer(previousReadToken) },
			);
			expect(previous.status).toBe(200);

			const tooMany = await importCandidates(
				Array.from({ length: 101 }, (_, index) => candidate(`limit-${index}`)),
				writeToken,
			);
			expect(tooMany.status).toBe(400);

			let unauthorizedPulls = 0;
			const unauthorized = await streamedImport(() => {
				unauthorizedPulls += 1;
				return new Uint8Array(MAX_PLACE_CANDIDATE_BODY_BYTES + 1);
			}, null);
			expect(unauthorized.status).toBe(401);
			expect(unauthorizedPulls).toBe(0);

			const oversized = await streamedImport(
				() => new Uint8Array(MAX_PLACE_CANDIDATE_BODY_BYTES + 1),
				writeToken,
			);
			expect(oversized.status).toBe(413);
			expect((await oversized.json()).error.code).toBe("PAYLOAD_TOO_LARGE");

			const pageTooLarge = await app.request(
				"/internal/v1/place-candidates/index-feed?limit=101",
				{ headers: bearer(readToken) },
			);
			expect(pageTooLarge.status).toBe(400);
			const malformedCursor = await app.request(
				"/internal/v1/place-candidates/index-feed?cursor=this-is-not-a-canonical-cursor",
				{ headers: bearer(readToken) },
			);
			expect(malformedCursor.status).toBe(400);
			expect((await malformedCursor.json()).error.code).toBe("CURSOR_INVALID");

			const tenantCoupling = await app.request(
				"/internal/v1/place-candidates/import",
				{
					method: "POST",
					headers: {
						...bearer(writeToken),
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						candidates: [
							{ ...candidate("tenant-field"), rootEventId: "evt_forbidden" },
						],
					}),
				},
			);
			expect(tenantCoupling.status).toBe(400);
		});

		test("keeps exact source identity, chronology and atomic natural idempotence", async () => {
			const firstInput = candidate("identity", {
				name: "Zurich Golf Club",
				license: {
					code: "ODbL-1.0",
					url: "https://opendatacommons.org/licenses/odbl/1-0/",
					attribution: "OpenStreetMap contributors",
					allowsSearchIndex: true,
				},
			});
			const first = await json(
				await importCandidates([firstInput], writeToken),
			);
			expect(first.results[0]).toMatchObject({
				outcome: "inserted",
				candidate: {
					id: placeCandidateId("osm", "identity"),
					source: "osm",
					sourceRecordId: "identity",
					confidence: 0.9,
					license: firstInput.license,
					version: 1,
				},
			});

			const exact = await json(
				await importCandidates(
					[
						{
							...firstInput,
							license: {
								allowsSearchIndex: firstInput.license.allowsSearchIndex,
								attribution: firstInput.license.attribution,
								url: firstInput.license.url,
								code: firstInput.license.code,
							},
						},
					],
					writeToken,
				),
			);
			expect(exact.results[0]).toMatchObject({
				outcome: "unchanged",
				candidate: { version: 1 },
			});

			const newerInput = candidate("identity", {
				...firstInput,
				name: "Zurich Golf & Country Club",
				retrievedAt: "2030-01-02T00:00:00.000Z",
			});
			const newer = await json(
				await importCandidates([newerInput], writeToken),
			);
			expect(newer.results[0]).toMatchObject({
				outcome: "updated",
				candidate: { name: newerInput.name, version: 2 },
			});

			const stale = await json(
				await importCandidates(
					[
						candidate("identity", {
							...firstInput,
							name: "Stale",
							retrievedAt: "2029-12-31T00:00:00.000Z",
						}),
					],
					writeToken,
				),
			);
			expect(stale.results[0]).toMatchObject({
				outcome: "stale",
				candidate: { name: newerInput.name, version: 2 },
			});

			const secondSource = await json(
				await importCandidates(
					[candidate("identity", { source: "swiss-golf" })],
					writeToken,
				),
			);
			expect(secondSource.results[0].candidate.id).toBe(
				placeCandidateId("swiss-golf", "identity"),
			);
			expect(secondSource.results[0].candidate.id).not.toBe(
				first.results[0].candidate.id,
			);

			const conflict = await importCandidates(
				[
					candidate("must-rollback"),
					candidate("identity", {
						...newerInput,
						name: "Conflicting equal-time facts",
					}),
				],
				writeToken,
			);
			expect(conflict.status).toBe(409);
			expect((await conflict.json()).error.code).toBe(
				"PLACE_CANDIDATE_SNAPSHOT_CONFLICT",
			);
			const [rollback] = await sql<{ count: number }[]>`
			SELECT count(*)::int AS count FROM place_candidates
			WHERE source = 'osm' AND source_record_id = 'must-rollback'
		`;
			expect(rollback?.count).toBe(0);

			const concurrent = candidate("concurrent");
			const concurrentResults = await Promise.all(
				Array.from({ length: 8 }, () =>
					importCandidates([concurrent], writeToken),
				),
			);
			expect(
				concurrentResults.every((response) => response.status === 200),
			).toBe(true);
			const [count] = await sql<{ count: number }[]>`
				SELECT count(*)::int AS count FROM place_candidates
				WHERE source = 'osm' AND source_record_id = 'concurrent'
			`;
			expect(count?.count).toBe(1);
		});

		test("feeds only active licensed records through a bounded stable keyset", async () => {
			const active = [
				candidate("active-a"),
				candidate("active-b"),
				candidate("active-c"),
			];
			const excluded = [
				candidate("no-index", {
					license: {
						code: "restricted",
						url: null,
						attribution: "Restricted source",
						allowsSearchIndex: false,
					},
				}),
				candidate("expired", {
					retrievedAt: "2025-01-01T00:00:00.000Z",
					expiresAt: "2025-02-01T00:00:00.000Z",
				}),
				candidate("retired", {
					retirement: {
						retiredAt: "2030-01-01T00:00:00.000Z",
						reason: "source_removed",
					},
				}),
			];
			const imported = await importCandidates(
				[...active, ...excluded],
				writeToken,
			);
			expect(imported.status).toBe(200);

			const seen: string[] = [];
			let cursor: string | null = null;
			for (;;) {
				const response = await app.request(
					`/internal/v1/place-candidates/index-feed?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
					{ headers: bearer(readToken) },
				);
				expect(response.status).toBe(200);
				const page = await json(response);
				seen.push(
					...page.items.map(
						(item: { sourceRecordId: string }) => item.sourceRecordId,
					),
				);
				cursor = page.pageInfo.nextCursor;
				if (!page.pageInfo.hasMore) break;
				expect(cursor).not.toBeNull();
			}
			expect(seen).toEqual(
				active
					.map(({ source, sourceRecordId }) => ({
						id: placeCandidateId(source, sourceRecordId),
						sourceRecordId,
					}))
					.sort((left, right) => left.id.localeCompare(right.id))
					.map(({ sourceRecordId }) => sourceRecordId),
			);
		});

		test("cannot mutate root-owned places, revisions, changes or itinerary snapshots", async () => {
			await eventService.createRoot(
				owner,
				rootInput("evt_candidate_isolation"),
			);
			await eventService.createPlace(owner, "evt_candidate_isolation", {
				id: "plc_candidate_isolation",
				name: "Root-owned venue",
				locality: "Zurich",
				countryCode: "CH",
				latitude: 47.37,
				longitude: 8.54,
			});
			await eventService.createItineraryItem(owner, "evt_candidate_isolation", {
				id: "iti_candidate_isolation",
				eventId: "evt_candidate_isolation",
				title: "Immutable root snapshot",
				notes: null,
				timeZone: "Europe/Zurich",
				startsAt: null,
				endsAt: null,
				allDay: false,
				status: "active",
				details: { schemaVersion: 1, type: "note" },
				placeId: "plc_candidate_isolation",
			});
			const before = await rootProof();

			const response = await importCandidates(
				[candidate("plc_candidate_isolation", { name: "Global candidate" })],
				writeToken,
			);
			expect(response.status).toBe(200);
			expect(await rootProof()).toEqual(before);
		});

		function importCandidates(candidates: unknown[], token: string) {
			return app.request("/internal/v1/place-candidates/import", {
				method: "POST",
				headers: {
					...bearer(token),
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ candidates }),
			});
		}

		function streamedImport(chunk: () => Uint8Array, token: string | null) {
			const body = new ReadableStream<Uint8Array>(
				{
					pull(controller) {
						controller.enqueue(chunk());
						controller.close();
					},
				},
				{ highWaterMark: 0 },
			);
			const init = {
				method: "POST",
				headers: {
					...(token ? bearer(token) : {}),
					"Content-Type": "application/json",
				},
				body,
				duplex: "half" as const,
			};
			return app.fetch(
				new Request(
					"http://localhost/internal/v1/place-candidates/import",
					init,
				),
			);
		}

		async function rootProof() {
			const [proof] = await sql<
				{
					revision: string;
					placeCount: number;
					changeCount: number;
					snapshot: unknown;
				}[]
			>`
				SELECT
					(SELECT revision::text FROM event_roots
					 WHERE root_event_id = 'evt_candidate_isolation') AS revision,
					(SELECT count(*)::int FROM event_places
					 WHERE root_event_id = 'evt_candidate_isolation') AS "placeCount",
					(SELECT count(*)::int FROM event_root_changes
					 WHERE root_event_id = 'evt_candidate_isolation') AS "changeCount",
					(SELECT place_snapshot FROM event_itinerary_items
					 WHERE id = 'iti_candidate_isolation') AS snapshot
			`;
			return proof;
		}
	});
}

function bearer(token: string) {
	return { Authorization: `Bearer ${token}` };
}

function candidate(
	sourceRecordId: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		source: "osm",
		sourceRecordId,
		kind: "venue",
		name: `Candidate ${sourceRecordId}`,
		locality: "Zurich",
		region: "Zurich",
		countryCode: "CH",
		latitude: 47.3769,
		longitude: 8.5417,
		sourceRecordUrl: `https://www.openstreetmap.org/${encodeURIComponent(sourceRecordId)}`,
		license: {
			code: "ODbL-1.0",
			url: "https://opendatacommons.org/licenses/odbl/1-0/",
			attribution: "OpenStreetMap contributors",
			allowsSearchIndex: true,
		},
		retrievedAt: "2030-01-01T00:00:00.000Z",
		confidence: 0.9,
		expiresAt: null,
		retirement: null,
		...overrides,
	};
}

function rootInput(id: string): EventInput {
	return {
		id,
		kind: "team_event",
		title: "Candidate isolation root",
		description: null,
		timeZone: "Europe/Zurich",
		startsAt: null,
		endsAt: null,
		status: "draft",
	};
}

// biome-ignore lint/suspicious/noExplicitAny: tests inspect several independent response envelopes
async function json(response: Response): Promise<any> {
	return response.json();
}
