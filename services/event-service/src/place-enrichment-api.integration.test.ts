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
import { EventNotificationPayloadCodec } from "./event-notification-payload";
import type { PlaceEnrichmentPolicy } from "./place-enrichment";
import { PostgresPlaceEnrichmentJobs } from "./place-enrichment-jobs";
import { PostgresPlaceCandidateRepository } from "./postgres-place-candidate-repository";
import { PostgresEventRepository } from "./postgres-repository";
import { EventService } from "./service";

const databaseUrl = Bun.env.PLACE_ENRICHMENT_API_TEST_DATABASE_URL;
const actorId = "usr_00000000000000000000000000000901";
const memberId = "usr_00000000000000000000000000000902";
const outsiderId = "usr_00000000000000000000000000000903";
const rootEventId = "evt_enrichment_api_root";
const enrichmentScope = {
	rootEventId,
	eventId: rootEventId,
	capabilityType: "golf" as const,
};

if (!databaseUrl) {
	test.skip("place-enrichment API PostgreSQL integration (set PLACE_ENRICHMENT_API_TEST_DATABASE_URL)", () => {});
} else {
	describe("place enrichment API against PostgreSQL 17", () => {
		let sql: Sql;
		let app: ReturnType<typeof createApp>;
		let service: EventService;
		let candidateId: string;

		beforeAll(async () => {
			sql = postgres(databaseUrl, { max: 12, onnotice: () => {} });
			await migrate(sql);
			service = new EventService(
				new PostgresEventRepository(
					sql,
					new EventNotificationPayloadCodec({
						kid: "enrichment-api-test-v1",
						key: "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
					}),
				),
				"enrichment-api-invitation-key-with-at-least-32-characters",
				undefined,
				"enrichment-api-sync-key-with-at-least-32-characters",
				undefined,
				policy(),
			);
			app = createApp({
				service,
				verifyUserToken: async (token) => ({ id: token }),
			});
		});

		beforeEach(async () => {
			await sql`TRUNCATE event_idempotency_records, event_roots, place_candidates, place_enrichment_worker_health CASCADE`;
			await new PostgresPlaceEnrichmentJobs(sql).heartbeat(
				"enrichment-api-test-worker",
				60_000,
			);
			await service.createRoot(
				{ id: actorId },
				{
					id: rootEventId,
					kind: "golf",
					title: "Golf day",
					description: "Place enrichment admission fixture.",
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
			await sql`
				INSERT INTO event_memberships (root_event_id, user_id, role, status)
				VALUES (${rootEventId}, ${memberId}, 'participant', 'active')
			`;
			const [imported] = await new PostgresPlaceCandidateRepository(
				sql,
			).importBatch([candidate()]);
			if (!imported) throw new Error("Expected place candidate fixture");
			candidateId = imported.candidate.id;
		});

		afterAll(async () => {
			await sql.end();
		});

		test("authenticates, returns immediately and deduplicates candidate selection", async () => {
			const unauthenticated = await app.request(
				"/v1/places/enrichment-jobs",
				request(
					"select-unauthenticated",
					{
						...enrichmentScope,
						target: "candidate",
						candidateId,
					},
					false,
				),
			);
			expect(unauthenticated.status).toBe(401);

			const first = await selectCandidate("select-carya-01");
			expect(first.status).toBe(202);
			expect(first.headers.get("retry-after")).toBe("2");
			expect(first.headers.get("idempotency-replayed")).toBe("false");
			const firstText = await first.clone().text();
			const firstBody = await first.json();
			expect(firstBody).toMatchObject({
				enrichment: {
					status: "pending",
					pollAfterSeconds: 2,
					retryAllowed: false,
				},
				place: {
					sourceCandidateId: candidateId,
					name: "Carya Golf Club",
					locality: "Belek",
					countryCode: "TR",
				},
			});
			const jobId = firstBody.enrichment.id as string;
			expect(firstBody.place.id).toMatch(/^gpl_[a-f0-9]{64}$/);
			expect(first.headers.get("location")).toBe(
				`/v1/places/enrichment-jobs/${jobId}?rootEventId=${rootEventId}`,
			);
			expect(firstText).not.toContain("maxCostMicros");
			expect(firstText).not.toContain("fixture-model");

			const replay = await selectCandidate("select-carya-01");
			expect(replay.headers.get("idempotency-replayed")).toBe("true");
			expect(await replay.text()).toBe(firstText);

			const naturalDuplicate = await selectCandidate("select-carya-02");
			expect((await naturalDuplicate.json()).enrichment.id).toBe(jobId);
			const [count] = await sql<{ count: number }[]>`
				SELECT count(*)::int AS count FROM place_enrichment_jobs
			`;
			expect(count?.count).toBe(1);

			const status = await app.request(
				`/v1/places/enrichment-jobs/${jobId}?rootEventId=${rootEventId}`,
				{ headers: { Authorization: `Bearer ${actorId}` } },
			);
			expect(status.status).toBe(200);
			expect(status.headers.get("retry-after")).toBe("2");
			expect(await status.json()).toEqual(firstBody);

			for (const userId of [memberId, outsiderId]) {
				const concealed = await app.request(
					`/v1/places/enrichment-jobs/${jobId}?rootEventId=${rootEventId}`,
					{ headers: { Authorization: `Bearer ${userId}` } },
				);
				expect(concealed.status).toBe(404);
				expect(await concealed.json()).toMatchObject({
					error: { code: "PLACE_ENRICHMENT_NOT_FOUND" },
				});
			}
			const storedErrorRequest = request("stored-create-error-01", {
				...enrichmentScope,
				target: "search_miss",
				query: "Private venue mismatch",
				kind: "venue",
				countryCode: "CH",
			});
			const storedError = await app.request(
				"/v1/places/enrichment-jobs",
				storedErrorRequest,
			);
			expect(storedError.status).toBe(409);
			await service.createPlace({ id: actorId }, rootEventId, {
				id: "plc_enrichment_api_course",
				name: "Selected course",
				locality: "Belek",
				countryCode: "TR",
				latitude: null,
				longitude: null,
			});
			await service.replaceCapability(
				{ id: actorId },
				rootEventId,
				rootEventId,
				1,
				{
					type: "golf",
					schemaVersion: 1,
					config: {
						coursePlaceId: "plc_enrichment_api_course",
						teeFormat: "individual",
						handicapMode: "optional",
						scoringMode: "stableford",
						roundState: "planned",
					},
				},
			);
			const staleWorkflowReplay = await selectCandidate("select-carya-01");
			expect(staleWorkflowReplay.status).toBe(404);
			const staleErrorReplay = await app.request(
				"/v1/places/enrichment-jobs",
				storedErrorRequest,
			);
			expect(staleErrorReplay.status).toBe(404);
			expect(await staleErrorReplay.json()).toMatchObject({
				error: { code: "PLACE_ENRICHMENT_NOT_FOUND" },
			});
			await service.transferOwnership(
				{ id: actorId },
				rootEventId,
				memberId,
				1,
				1,
			);
			await service.updateMembership(
				{ id: memberId },
				rootEventId,
				actorId,
				2,
				"organizer",
				"removed",
				"Lost-membership redaction fixture.",
			);
			const lostMembership = await app.request(
				`/v1/places/enrichment-jobs/${jobId}?rootEventId=${rootEventId}`,
				{ headers: { Authorization: `Bearer ${actorId}` } },
			);
			expect(lostMembership.status).toBe(404);
		});

		test("keeps search-miss text private and never expands retry budgets", async () => {
			const searchMiss = await app.request(
				"/v1/places/enrichment-jobs",
				request("search-miss-01", {
					...enrichmentScope,
					target: "search_miss",
					query: "private organizer wording",
					kind: "golf_course",
					countryCode: "CH",
				}),
			);
			expect(searchMiss.status).toBe(202);
			const searchMissText = await searchMiss.text();
			expect(searchMissText).not.toContain("private organizer wording");
			expect(JSON.parse(searchMissText).place).toBeNull();

			const selected = await selectCandidate("retry-carya-select-01");
			const jobId = (await selected.json()).enrichment.id as string;
			await sql`
				UPDATE place_enrichment_jobs SET
					status = 'retry', outcome_code = 'ENRICHMENT_TRANSIENT',
					available_at = clock_timestamp() + interval '1 hour'
				WHERE id = ${jobId}
			`;
			const retry = await app.request(
				`/v1/places/enrichment-jobs/${jobId}/retry?rootEventId=${rootEventId}`,
				request("retry-carya-01"),
			);
			expect(retry.status).toBe(202);
			expect(retry.headers.get("retry-after")).toBe("5");
			expect(await retry.json()).toMatchObject({
				enrichment: { id: jobId, status: "retry", retryAllowed: true },
			});
			const [after] = await sql<
				{
					available: boolean;
					attempts: number;
					exaCalls: number;
					cost: number;
				}[]
			>`
				SELECT available_at <= clock_timestamp() AS available, attempts,
					exa_calls_reserved AS "exaCalls", cost_micros_reserved AS cost
				FROM place_enrichment_jobs WHERE id = ${jobId}
			`;
			expect(after).toEqual({
				available: true,
				attempts: 0,
				exaCalls: 0,
				cost: 0,
			});

			await sql`
				UPDATE place_enrichment_jobs SET status = 'dead',
					outcome_code = 'ENRICHMENT_ATTEMPTS_EXHAUSTED',
					completed_at = clock_timestamp()
				WHERE id = ${jobId}
			`;
			const terminalRetry = await app.request(
				`/v1/places/enrichment-jobs/${jobId}/retry?rootEventId=${rootEventId}`,
				request("retry-carya-terminal-01"),
			);
			expect(terminalRetry.status).toBe(409);
			expect(await terminalRetry.json()).toMatchObject({
				error: {
					code: "PLACE_ENRICHMENT_RETRY_UNAVAILABLE",
					retryable: false,
				},
			});
		});

		function selectCandidate(idempotencyKey: string) {
			return app.request(
				"/v1/places/enrichment-jobs",
				request(idempotencyKey, {
					...enrichmentScope,
					target: "candidate",
					candidateId,
				}),
			);
		}
	});
}

function request(
	idempotencyKey: string,
	body?: Record<string, unknown>,
	authenticated = true,
): RequestInit {
	return {
		method: "POST",
		headers: {
			...(authenticated ? { Authorization: `Bearer ${actorId}` } : {}),
			"Idempotency-Key": idempotencyKey,
			...(body ? { "Content-Type": "application/json" } : {}),
		},
		...(body ? { body: JSON.stringify(body) } : {}),
	};
}

function policy(): PlaceEnrichmentPolicy {
	return {
		pipelineVersion: "place-test-v1",
		model: "fixture-model",
		promptVersion: "place-test-v1",
		maxAttempts: 3,
		maxExaCalls: 2,
		maxLlmCalls: 2,
		maxInputTokens: 20_000,
		maxOutputTokens: 1_024,
		maxCostMicros: 50_000,
		providerTimeoutMs: 5_000,
		maxResponseBytes: 262_144,
	};
}

function candidate() {
	return {
		source: "fixture",
		sourceRecordId: "carya-api-v1",
		kind: "golf_course" as const,
		name: "Carya Golf Club",
		locality: "Belek",
		region: "Antalya",
		countryCode: "TR",
		latitude: 36.858,
		longitude: 31.055,
		sourceRecordUrl: "https://example.com/carya",
		license: {
			code: "fixture",
			url: "https://example.com/license",
			attribution: "Fixture data",
			allowsSearchIndex: true,
		},
		retrievedAt: new Date("2026-07-18T00:00:00.000Z"),
		confidence: 0.99,
		expiresAt: null,
		retirement: null,
	};
}
