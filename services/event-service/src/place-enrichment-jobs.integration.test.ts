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
import { type Actor, DomainError } from "./domain";
import { EventNotificationPayloadCodec } from "./event-notification-payload";
import type {
	PlaceEnrichmentClaim,
	PlaceEnrichmentField,
	PlaceEnrichmentPolicy,
} from "./place-enrichment";
import { PostgresPlaceEnrichmentJobs } from "./place-enrichment-jobs";
import { createPlaceEnrichmentWorker } from "./place-enrichment-worker";
import type { PlaceEnrichmentWorkerConfig } from "./place-enrichment-worker-config";
import { PostgresPlaceCandidateRepository } from "./postgres-place-candidate-repository";
import { PostgresEventRepository } from "./postgres-repository";

const databaseUrl = Bun.env.PLACE_ENRICHMENT_TEST_DATABASE_URL;
const owner: Actor = { id: "usr_00000000000000000000000000000a00" };
const managerA: Actor = { id: "usr_00000000000000000000000000000a01" };
const managerB: Actor = { id: "usr_00000000000000000000000000000a02" };
const rootA = "evt_place_enrichment_admission_a";
const rootB = "evt_place_enrichment_admission_b";

if (!databaseUrl) {
	test.skip("place-enrichment PostgreSQL integration (set PLACE_ENRICHMENT_TEST_DATABASE_URL)", () => {});
} else {
	describe("budgeted place enrichment jobs against PostgreSQL 17", () => {
		let sql: Sql;
		let jobs: PostgresPlaceEnrichmentJobs;
		let candidateId: string;
		const notificationPayloads = new EventNotificationPayloadCodec({
			kid: "place-enrichment-admission-test-v1",
			key: "AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM",
		});

		beforeAll(async () => {
			sql = postgres(databaseUrl, { max: 12 });
			await migrate(sql);
			jobs = new PostgresPlaceEnrichmentJobs(sql);
		});

		beforeEach(async () => {
			await sql`TRUNCATE event_roots, place_enrichment_jobs, place_candidates, place_enrichment_worker_health CASCADE`;
			await createGolfRoot(sql, rootA, managerA.id);
			const [imported] = await new PostgresPlaceCandidateRepository(
				sql,
			).importBatch([candidate("carya-v1")]);
			if (!imported) throw new Error("Expected place candidate fixture");
			candidateId = imported.candidate.id;
		});

		afterAll(async () => {
			await sql.end();
		});

		function admitSearchMiss(
			actor: Actor,
			rootEventId: string,
			query: string,
			targetPolicy = policy(),
		) {
			return sql.begin((transaction) =>
				new PostgresEventRepository(
					transaction as unknown as Sql,
					notificationPayloads,
					true,
				).requestPlaceEnrichmentSearchMiss(
					actor,
					{
						rootEventId,
						eventId: rootEventId,
						capabilityType: "golf",
					},
					{ query, kind: "golf_course", countryCode: "CH" },
					targetPolicy,
				),
			) as Promise<
				Awaited<
					ReturnType<
						PostgresEventRepository["requestPlaceEnrichmentSearchMiss"]
					>
				>
			>;
		}

		test("reports only a current database heartbeat as worker health", async () => {
			expect(await jobs.workerHealthy()).toBe(false);
			await jobs.heartbeat("place-enrichment-integration-worker", 60_000);
			expect(await jobs.workerHealthy()).toBe(true);
			await sql`
				UPDATE place_enrichment_worker_health
				SET healthy_until = clock_timestamp() - interval '1 second',
					updated_at = clock_timestamp() - interval '2 seconds'
			`;
			expect(await jobs.workerHealthy()).toBe(false);
		});

		test("deduplicates concurrent candidate and normalized search-miss requests", async () => {
			const candidateJobs = await Promise.all(
				Array.from({ length: 8 }, () =>
					jobs.enqueueCandidate(candidateId, policy()),
				),
			);
			expect(new Set(candidateJobs.map(({ id }) => id)).size).toBe(1);

			const misses = await Promise.all(
				["  missing   belek course ", "missing belek course"].map((query) =>
					jobs.enqueueSearchMiss(
						{ query, kind: "golf_course", countryCode: "TR" },
						policy(),
					),
				),
			);
			expect(misses[0]?.id).toBe(misses[1]?.id);
			const [count] = await sql<{ count: number }[]>`
				SELECT count(*)::int AS count FROM place_enrichment_jobs
			`;
			expect(count?.count).toBe(2);

			const [updated] = await new PostgresPlaceCandidateRepository(
				sql,
			).importBatch([
				candidate("carya-v1", {
					name: "Carya Golf Club Updated",
					retrievedAt: new Date("2030-01-02T00:00:00.000Z"),
				}),
			]);
			if (!updated) throw new Error("Expected updated candidate");
			const refreshed = await jobs.enqueueCandidate(candidateId, policy());
			expect(refreshed.id).not.toBe(candidateJobs[0]?.id);
		});

		test("charges one sponsor and associates a shared global duplicate for zero", async () => {
			await createGolfRoot(sql, rootB, managerB.id);
			const first = await admitSearchMiss(
				managerA,
				rootA,
				"shared admission course",
			);
			const replay = await admitSearchMiss(
				managerA,
				rootA,
				"shared admission course",
			);
			const shared = await admitSearchMiss(
				managerB,
				rootB,
				"shared admission course",
			);
			expect(replay.id).toBe(first.id);
			expect(shared.id).toBe(first.id);
			const associations = await sql<
				{ actorId: string; reservedCostMicros: number }[]
			>`
				SELECT actor_id AS "actorId",
					reserved_cost_micros AS "reservedCostMicros"
				FROM place_enrichment_job_associations
				WHERE job_id = ${first.id}
				ORDER BY actor_id
			`;
			expect([...associations]).toEqual([
				{ actorId: managerA.id, reservedCostMicros: 50_000 },
				{ actorId: managerB.id, reservedCostMicros: 0 },
			]);
		});

		test("serializes concurrent admissions at actor limits without leaking counts", async () => {
			const results = await Promise.allSettled(
				Array.from({ length: 4 }, (_, index) =>
					admitSearchMiss(managerA, rootA, `capacity course ${index}`),
				),
			);
			expect(
				results.filter(({ status }) => status === "fulfilled"),
			).toHaveLength(3);
			const [rejected] = results.filter(
				(result): result is PromiseRejectedResult =>
					result.status === "rejected",
			);
			expect(rejected?.reason).toBeInstanceOf(DomainError);
			expect(rejected?.reason).toMatchObject({
				status: 409,
				code: "PLACE_ENRICHMENT_CAPACITY",
				headers: { "Retry-After": "60" },
				details: undefined,
			});
			const [ledger] = await sql<{ count: number; reserved: number }[]>`
				SELECT count(*)::int AS count,
					sum(reserved_cost_micros)::int AS reserved
				FROM place_enrichment_job_associations
				WHERE actor_id = ${managerA.id}
			`;
			expect(ledger).toEqual({ count: 3, reserved: 150_000 });
		});

		test("enforces the global outstanding limit independently from daily spend", async () => {
			const seeded = await Promise.all(
				Array.from({ length: 100 }, (_, index) =>
					jobs.enqueueSearchMiss(
						{
							query: `global outstanding course ${index}`,
							kind: "golf_course",
							countryCode: "CH",
						},
						policy(),
					),
				),
			);
			await Promise.all(
				seeded.map((job, index) =>
					sponsorAs(
						sql,
						job.id,
						`usr_${(0xc00 + index).toString(16).padStart(32, "0")}`,
						1,
					),
				),
			);
			await expect(
				admitSearchMiss(managerA, rootA, "global outstanding rejected course"),
			).rejects.toMatchObject({ code: "PLACE_ENRICHMENT_CAPACITY" });
			const [daily] = await sql<{ reserved: number }[]>`
				SELECT sum(reserved_cost_micros)::int AS reserved
				FROM place_enrichment_job_associations
			`;
			expect(daily?.reserved).toBe(100);
		});

		test("does not spend another actor slot for the same active job on a second root", async () => {
			const first = await admitSearchMiss(managerA, rootA, "same job course");
			await admitSearchMiss(managerA, rootA, "actor slot course one");
			await admitSearchMiss(managerA, rootA, "actor slot course two");
			await createGolfRoot(sql, rootB, managerA.id);

			const shared = await admitSearchMiss(managerA, rootB, "same job course");
			expect(shared.id).toBe(first.id);
			const [association] = await sql<{ count: number; reserved: number }[]>`
				SELECT count(*)::int AS count,
					sum(reserved_cost_micros)::int AS reserved
				FROM place_enrichment_job_associations
				WHERE job_id = ${first.id} AND actor_id = ${managerA.id}
			`;
			expect(association).toEqual({ count: 2, reserved: 50_000 });
		});

		test("enforces the actor UTC-day reservation cap", async () => {
			const dailyPolicy = policy({ maxCostMicros: 100_000 });
			const first = await admitSearchMiss(
				managerA,
				rootA,
				"actor daily course one",
				dailyPolicy,
			);
			await admitSearchMiss(
				managerA,
				rootA,
				"actor daily course two",
				dailyPolicy,
			);
			await expect(
				admitSearchMiss(
					managerA,
					rootA,
					"actor daily course three",
					dailyPolicy,
				),
			).rejects.toMatchObject({
				code: "PLACE_ENRICHMENT_CAPACITY",
				headers: { "Retry-After": "60" },
			});
			await sql`
				UPDATE place_enrichment_job_associations
				SET created_at =
					date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC')
						AT TIME ZONE 'UTC' - interval '1 second'
				WHERE job_id = ${first.id} AND actor_id = ${managerA.id}
			`;
			await expect(
				admitSearchMiss(
					managerA,
					rootA,
					"actor daily course three",
					dailyPolicy,
				),
			).resolves.toMatchObject({ status: "pending" });
		});

		test("enforces the global UTC-day reservation cap", async () => {
			const seededPolicy = policy({ maxCostMicros: 990_000 });
			const seeded: string[] = [];
			for (let index = 0; index < 5; index += 1) {
				const job = await jobs.enqueueSearchMiss(
					{
						query: `global daily seeded course ${index}`,
						kind: "golf_course",
						countryCode: "CH",
					},
					seededPolicy,
				);
				seeded.push(job.id);
				await sponsorAs(
					sql,
					job.id,
					`usr_${(0xb00 + index).toString(16).padStart(32, "0")}`,
					990_000,
				);
			}
			const dailyPolicy = policy({ maxCostMicros: 100_000 });
			await expect(
				admitSearchMiss(
					managerA,
					rootA,
					"global daily rejected course",
					dailyPolicy,
				),
			).rejects.toMatchObject({ code: "PLACE_ENRICHMENT_CAPACITY" });
			const firstSeeded = seeded[0];
			if (!firstSeeded) throw new Error("Expected seeded global reservation");
			await sql`
				UPDATE place_enrichment_job_associations
				SET created_at =
					date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC')
						AT TIME ZONE 'UTC' - interval '1 second'
				WHERE job_id = ${firstSeeded}
			`;
			await expect(
				admitSearchMiss(
					managerA,
					rootA,
					"global daily rejected course",
					dailyPolicy,
				),
			).resolves.toMatchObject({ status: "pending" });
		});

		test("maps unsafe search control characters to the public input error", async () => {
			for (const query of ["zero\u200Bwidth", "null\u0000byte"]) {
				await expect(
					admitSearchMiss(managerA, rootA, query),
				).rejects.toMatchObject({
					status: 400,
					code: "PLACE_ENRICHMENT_INPUT_INVALID",
				});
			}
		});

		test("checks current manager and exact live create scope with a share lock", async () => {
			const repository = new PostgresEventRepository(sql, notificationPayloads);
			const scope = {
				rootEventId: rootA,
				eventId: rootA,
				capabilityType: "golf" as const,
			};
			await expect(
				repository.assertPlaceEnrichmentCreateScope(managerA, scope),
			).resolves.toBeUndefined();
			await sql`
				INSERT INTO event_memberships (root_event_id, user_id, role, status)
				VALUES (${rootA}, ${managerB.id}, 'participant', 'active')
			`;
			await expect(
				repository.assertPlaceEnrichmentCreateScope(managerB, scope),
			).rejects.toMatchObject({ status: 403 });
			await sql`
				INSERT INTO event_places (
					id, root_event_id, name, country_code
				) VALUES ('plc_admission_review', ${rootA}, 'Review Course', 'CH')
			`;
			await sql`
				UPDATE event_capabilities SET config = jsonb_set(
					config, '{coursePlaceId}', '"plc_admission_review"'::jsonb
				)
				WHERE root_event_id = ${rootA} AND event_id = ${rootA}
					AND capability_type = 'golf'
			`;
			await expect(
				repository.assertPlaceEnrichmentCreateScope(managerA, scope),
			).rejects.toMatchObject({ code: "PLACE_ENRICHMENT_SCOPE_INVALID" });
		});

		test("conceals unassociated and revoked access and never associates on retry", async () => {
			await createGolfRoot(sql, rootB, managerB.id);
			await sql`
				INSERT INTO event_memberships (root_event_id, user_id, role, status)
				VALUES (${rootA}, ${managerB.id}, 'participant', 'active')
			`;
			const admitted = await admitSearchMiss(
				managerA,
				rootA,
				"private associated course",
			);
			const associated = await new PostgresEventRepository(
				sql,
				notificationPayloads,
			).getPlaceEnrichment(managerA, rootA, admitted.id);
			expect(associated?.job.id).toBe(admitted.id);
			expect(
				await new PostgresEventRepository(
					sql,
					notificationPayloads,
				).getPlaceEnrichment(managerB, rootA, admitted.id),
			).toBeNull();
			await expect(
				sql.begin((transaction) =>
					new PostgresEventRepository(
						transaction as unknown as Sql,
						notificationPayloads,
						true,
					).requestPlaceEnrichmentRetry(managerB, rootA, admitted.id),
				),
			).rejects.toMatchObject({ status: 404 });
			const [before] = await sql<{ count: number }[]>`
				SELECT count(*)::int AS count
				FROM place_enrichment_job_associations WHERE job_id = ${admitted.id}
			`;
			expect(before?.count).toBe(1);

			await sql`
				UPDATE event_memberships SET status = 'removed', version = version + 1
				WHERE root_event_id = ${rootA} AND user_id = ${managerA.id}
			`;
			await expect(
				new PostgresEventRepository(
					sql,
					notificationPayloads,
				).getPlaceEnrichment(managerA, rootA, admitted.id),
			).rejects.toMatchObject({ status: 404 });
		});

		test("does not claim an unassociated legacy job", async () => {
			await jobs.enqueueSearchMiss(
				{ query: "orphan course", kind: "golf_course", countryCode: "CH" },
				policy(),
			);
			expect(
				await jobs.claim({ workerId: "fail-closed-worker", leaseMs: 5_000 }),
			).toBeNull();
		});

		test("requires a charged sponsor before reserving a provider call", async () => {
			const queued = await jobs.enqueueSearchMiss(
				{
					query: "manual processing orphan",
					kind: "golf_course",
					countryCode: "CH",
				},
				policy(),
			);
			await sql.begin(async (transaction) => {
				const tx = transaction as unknown as Sql;
				await tx`
					UPDATE place_enrichment_jobs SET status = 'processing', attempts = 1,
						lease_owner = 'manual-worker',
						lease_until = clock_timestamp() + interval '1 minute', fence = 1
					WHERE id = ${queued.id}
				`;
				await tx`
					INSERT INTO place_enrichment_attempts (
						job_id, attempt, worker_id, fence
					) VALUES (${queued.id}, 1, 'manual-worker', 1)
				`;
			});
			const processing = await jobs.get(queued.id);
			if (!processing) throw new Error("Expected processing orphan");
			const claim = {
				...processing.job,
				workerId: "manual-worker",
				fence: "1",
				attempt: 1,
			};
			expect(
				await jobs.reserveProviderCall(claim, reservation("exa", "a")),
			).toBe("stale");
			await sponsor(sql, queued.id, policy().maxCostMicros);
			expect(
				await jobs.reserveProviderCall(claim, reservation("exa", "b")),
			).toMatchObject({ jobId: queued.id, provider: "exa" });
		});

		test("fences expired workers and records every attempt outcome", async () => {
			const queued = await jobs.enqueueSearchMiss(
				{ query: "fenced course", kind: "golf_course", countryCode: "TR" },
				policy({ maxAttempts: 3 }),
			);
			await sponsor(sql, queued.id, policy().maxCostMicros);
			const claims = await Promise.all([
				jobs.claim({ workerId: "worker-a", leaseMs: 5_000 }),
				jobs.claim({ workerId: "worker-b", leaseMs: 5_000 }),
			]);
			const first = claims.find((claim) => claim !== null);
			expect(claims.filter(Boolean)).toHaveLength(1);
			if (!first) throw new Error("Expected first enrichment claim");

			await sql`
				UPDATE place_enrichment_jobs SET lease_until = clock_timestamp() - interval '1 second'
				WHERE id = ${first.id}
			`;
			const replacement = await jobs.claim({
				workerId: "worker-c",
				leaseMs: 5_000,
			});
			if (!replacement) throw new Error("Expected replacement claim");
			expect(replacement.attempt).toBe(2);
			expect(BigInt(replacement.fence)).toBeGreaterThan(BigInt(first.fence));
			expect(
				await jobs.reserveProviderCall(first, reservation("exa", "1")),
			).toBe("stale");

			const [oldAttempt] = await sql<
				{ outcomeCode: string; finished: boolean }[]
			>`
				SELECT outcome_code AS "outcomeCode", finished_at IS NOT NULL AS finished
				FROM place_enrichment_attempts WHERE job_id = ${first.id} AND attempt = 1
			`;
			expect(oldAttempt).toEqual({
				outcomeCode: "ENRICHMENT_LEASE_EXPIRED",
				finished: true,
			});
			expect(await jobs.fail(first, "ENRICHMENT_STALE_WORKER")).toBe(false);
			await sql`
				UPDATE place_enrichment_jobs SET lease_until = clock_timestamp() - interval '1 second'
				WHERE id = ${replacement.id}
			`;
			expect(await jobs.complete(replacement, enrichedFields())).toBe(false);
			const [fieldCount] = await sql<{ count: number }[]>`
				SELECT count(*)::int AS count FROM place_enrichment_fields
				WHERE job_id = ${replacement.id}
			`;
			expect(fieldCount?.count).toBe(0);
		});

		test("reserves hard cumulative budgets and persists auditable field provenance", async () => {
			const queued = await jobs.enqueueSearchMiss(
				{ query: "audit course", kind: "golf_course", countryCode: "TR" },
				policy({
					maxExaCalls: 1,
					maxLlmCalls: 1,
					maxInputTokens: 1_000,
					maxOutputTokens: 64,
					maxCostMicros: 2_000,
				}),
			);
			await sponsor(sql, queued.id, 2_000);
			const claim = requiredClaim(
				await jobs.claim({ workerId: "budget-worker", leaseMs: 5_000 }),
			);
			const exa = await jobs.reserveProviderCall(
				claim,
				reservation("exa", "2", { costMicros: 1_000 }),
			);
			if (typeof exa === "string") throw new Error("Expected Exa permit");
			expect(
				await jobs.reserveProviderCall(
					claim,
					reservation("exa", "3", { costMicros: 1 }),
				),
			).toBe("budget_exhausted");
			expect(
				await jobs.recordProviderCall(exa, {
					status: "succeeded",
					code: "ENRICHMENT_EXA_COMPLETED",
					responseBytes: 1_024,
					costMicros: 800,
					providerRequestId: "must-never-persist-raw",
				}),
			).toBe(true);

			const llm = await jobs.reserveProviderCall(
				claim,
				reservation("llm", "4", {
					inputTokens: 900,
					outputTokens: 64,
					costMicros: 900,
				}),
			);
			if (typeof llm === "string") throw new Error("Expected LLM permit");
			expect(
				await jobs.reserveProviderCall(
					claim,
					reservation("llm", "5", { inputTokens: 1 }),
				),
			).toBe("budget_exhausted");
			await jobs.recordProviderCall(llm, {
				status: "succeeded",
				code: "ENRICHMENT_LLM_COMPLETED",
				responseBytes: 2_048,
				inputTokens: 700,
				outputTokens: 40,
				costMicros: 600,
				providerRequestId: "also-hashed",
			});

			expect(await jobs.complete(claim, enrichedFields())).toBe(true);
			expect(await jobs.complete(claim, enrichedFields())).toBe(false);
			const result = await jobs.get(queued.id);
			expect(result?.job).toMatchObject({
				status: "succeeded",
				outcomeCode: "ENRICHMENT_COMPLETED",
				budget: {
					exaCallsReserved: 1,
					llmCallsReserved: 1,
					inputTokensReserved: 900,
					outputTokensReserved: 64,
					costMicrosReserved: 1_900,
				},
			});
			expect(result?.fields).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: "summary",
						sourceUrl: "https://evidence.example/course",
						model: "test-model",
						promptVersion: "place-test-v1",
						validatorVersion: "place-field-v1",
						validationState: "passed",
						approvalState: "pending_review",
					}),
				]),
			);

			const calls = await sql<
				{
					status: string;
					requestFingerprint: string;
					providerRequestIdHash: string;
				}[]
			>`
				SELECT status, request_fingerprint AS "requestFingerprint",
					provider_request_id_hash AS "providerRequestIdHash"
				FROM place_enrichment_provider_calls WHERE job_id = ${queued.id}
				ORDER BY sequence
			`;
			expect(calls).toHaveLength(2);
			expect(calls.every(({ status }) => status === "succeeded")).toBe(true);
			expect(
				calls.every(
					({ requestFingerprint, providerRequestIdHash }) =>
						/^[a-f0-9]{64}$/.test(requestFingerprint) &&
						/^[a-f0-9]{64}$/.test(providerRequestIdHash),
				),
			).toBe(true);
			expect(JSON.stringify(calls)).not.toContain("must-never-persist-raw");
		});

		test("keeps retry history and terminates at the frozen attempt ceiling", async () => {
			const queued = await jobs.enqueueSearchMiss(
				{ query: "retry course", kind: "golf_course", countryCode: "TR" },
				policy({ maxAttempts: 2 }),
			);
			await sponsor(sql, queued.id, policy().maxCostMicros);
			const first = requiredClaim(
				await jobs.claim({ workerId: "retry-worker-1", leaseMs: 5_000 }),
			);
			expect(await jobs.retry(first, "ENRICHMENT_EXA_UNAVAILABLE", 100)).toBe(
				"retry",
			);
			await sql`
				UPDATE place_enrichment_jobs SET available_at = clock_timestamp()
				WHERE id = ${queued.id}
			`;
			const second = requiredClaim(
				await jobs.claim({ workerId: "retry-worker-2", leaseMs: 5_000 }),
			);
			expect(await jobs.retry(second, "ENRICHMENT_LLM_UNAVAILABLE", 100)).toBe(
				"dead",
			);
			const result = await jobs.get(queued.id);
			expect(result?.job).toMatchObject({
				status: "dead",
				attempts: 2,
				outcomeCode: "ENRICHMENT_ATTEMPTS_EXHAUSTED",
			});
			const attempts = await sql<{ attempt: number; outcomeCode: string }[]>`
				SELECT attempt, outcome_code AS "outcomeCode"
				FROM place_enrichment_attempts WHERE job_id = ${queued.id}
				ORDER BY attempt
			`;
			expect([...attempts]).toEqual([
				{ attempt: 1, outcomeCode: "ENRICHMENT_EXA_UNAVAILABLE" },
				{ attempt: 2, outcomeCode: "ENRICHMENT_ATTEMPTS_EXHAUSTED" },
			]);
		});

		test("runs the complete candidate-to-provenance pipeline without a request-path provider call", async () => {
			const queued = await jobs.enqueueCandidate(candidateId, policy());
			await sponsor(sql, queued.id, policy().maxCostMicros);
			const providerOrder: string[] = [];
			const worker = createPlaceEnrichmentWorker(workerConfig(), jobs, {
				now: () => new Date("2026-07-19T08:00:00.000Z"),
				fetch: async (input) => {
					const path = new URL(input instanceof Request ? input.url : input)
						.pathname;
					providerOrder.push(path);
					if (path === "/search") {
						return Response.json({
							requestId: "exa-e2e-request",
							costDollars: { total: 0.005 },
							results: [
								{
									title: "Carya Golf Club",
									url: "https://caryagolf.com/",
									highlights: ["Carya Golf Club is in Belek."],
								},
							],
						});
					}
					return Response.json({
						id: "llm-e2e-request",
						choices: [
							{
								message: {
									content: JSON.stringify({
										fields: [
											{
												name: "summary",
												value: "Golf course in Belek.",
												sourceUrl: "https://caryagolf.com/",
											},
										],
									}),
								},
							},
						],
						usage: { prompt_tokens: 300, completion_tokens: 30 },
					});
				},
			});

			expect(await worker.processOne()).toBe(true);
			expect(providerOrder).toEqual(["/search", "/v1/chat/completions"]);
			expect(await jobs.get(queued.id)).toMatchObject({
				job: { status: "succeeded", outcomeCode: "ENRICHMENT_COMPLETED" },
				fields: expect.arrayContaining([
					expect.objectContaining({
						name: "name",
						sourceKind: "candidate",
						approvalState: "auto_approved",
					}),
					expect.objectContaining({
						name: "summary",
						sourceKind: "exa_llm",
						approvalState: "pending_review",
					}),
				]),
			});
		});
	});
}

async function createGolfRoot(
	sql: Sql,
	rootEventId: string,
	managerId: string,
) {
	await sql.begin(async (transaction) => {
		const tx = transaction as unknown as Sql;
		await tx`INSERT INTO event_roots (root_event_id) VALUES (${rootEventId})`;
		await tx`
			INSERT INTO events (
				id, root_event_id, kind, title, description, time_zone, status
			) VALUES (
				${rootEventId}, ${rootEventId}, 'golf', 'Admission test',
				'Admission test event', 'Europe/Zurich', 'draft'
			)
		`;
		await tx`
			INSERT INTO event_memberships (root_event_id, user_id, role, status)
			VALUES
				(${rootEventId}, ${owner.id}, 'owner', 'active'),
				(${rootEventId}, ${managerId}, 'organizer', 'active')
		`;
		await tx`
			INSERT INTO event_capabilities (
				root_event_id, event_id, capability_type, schema_version, config
			) VALUES (
				${rootEventId}, ${rootEventId}, 'golf', 1,
				${tx.json({
					coursePlaceId: null,
					handicapMode: "optional",
					roundState: "planned",
					scoringMode: "stableford",
					teeFormat: "individual",
				})}
			)
		`;
	});
}

async function sponsor(sql: Sql, jobId: string, reservedCostMicros: number) {
	return sponsorAs(sql, jobId, managerA.id, reservedCostMicros);
}

async function sponsorAs(
	sql: Sql,
	jobId: string,
	actorId: string,
	reservedCostMicros: number,
) {
	await sql`
		INSERT INTO place_enrichment_job_associations (
			job_id, actor_id, root_event_id, reserved_cost_micros
		) VALUES (${jobId}, ${actorId}, ${rootA}, ${reservedCostMicros})
	`;
}

function policy(
	override: Partial<PlaceEnrichmentPolicy> = {},
): PlaceEnrichmentPolicy {
	return {
		pipelineVersion: "place-test-v1",
		model: "test-model",
		promptVersion: "place-test-v1",
		maxAttempts: 3,
		maxExaCalls: 2,
		maxLlmCalls: 2,
		maxInputTokens: 20_000,
		maxOutputTokens: 512,
		maxCostMicros: 50_000,
		providerTimeoutMs: 1_000,
		maxResponseBytes: 262_144,
		...override,
	};
}

function reservation(
	provider: "exa" | "llm",
	fingerprintCharacter: string,
	override: Partial<{
		inputTokens: number;
		outputTokens: number;
		costMicros: number;
	}> = {},
) {
	return {
		provider,
		requestFingerprint: fingerprintCharacter.repeat(64),
		inputTokens: 0,
		outputTokens: 0,
		costMicros: 0,
		...override,
	};
}

function enrichedFields(): PlaceEnrichmentField[] {
	const observedAt = new Date("2026-07-19T08:00:00.000Z");
	return [
		{
			name: "name",
			value: "Audit Golf Club",
			sourceKind: "exa_llm",
			sourceUrl: "https://evidence.example/course",
			observedAt,
			model: "test-model",
			promptVersion: "place-test-v1",
			validatorVersion: "place-field-v1",
			validationState: "passed",
			approvalState: "pending_review",
		},
		{
			name: "countryCode",
			value: "TR",
			sourceKind: "exa_llm",
			sourceUrl: "https://evidence.example/course",
			observedAt,
			model: "test-model",
			promptVersion: "place-test-v1",
			validatorVersion: "place-field-v1",
			validationState: "passed",
			approvalState: "pending_review",
		},
		{
			name: "summary",
			value: "Auditable bounded enrichment.",
			sourceKind: "exa_llm",
			sourceUrl: "https://evidence.example/course",
			observedAt,
			model: "test-model",
			promptVersion: "place-test-v1",
			validatorVersion: "place-field-v1",
			validationState: "passed",
			approvalState: "pending_review",
		},
	];
}

function requiredClaim(claim: PlaceEnrichmentClaim | null) {
	if (!claim) throw new Error("Expected place-enrichment claim");
	return claim;
}

function candidate(
	sourceRecordId: string,
	override: Partial<{
		name: string;
		retrievedAt: Date;
	}> = {},
) {
	return {
		source: "curated",
		sourceRecordId,
		kind: "golf_course" as const,
		name: override.name ?? "Carya Golf Club",
		locality: "Belek",
		region: "Antalya",
		countryCode: "TR",
		latitude: 36.87,
		longitude: 31.06,
		sourceRecordUrl: "https://catalog.example/carya",
		license: {
			code: "curated-test",
			url: "https://catalog.example/license",
			attribution: "Crew test fixture",
			allowsSearchIndex: true,
		},
		retrievedAt: override.retrievedAt ?? new Date("2030-01-01T00:00:00.000Z"),
		confidence: 0.9,
		expiresAt: null,
		retirement: null,
	};
}

function workerConfig(): Omit<
	PlaceEnrichmentWorkerConfig,
	"databaseUrl" | "environment"
> {
	return {
		workerId: "integration-worker",
		pollIntervalMs: 100,
		leaseMs: 5_000,
		pipelineVersion: "place-test-v1",
		model: "test-model",
		promptVersion: "place-test-v1",
		maxAttempts: 3,
		maxExaCalls: 2,
		maxLlmCalls: 2,
		maxInputTokens: 20_000,
		maxOutputTokens: 512,
		maxCostMicros: 50_000,
		providerTimeoutMs: 1_000,
		maxResponseBytes: 262_144,
		exaBaseUrl: "https://api.exa.test",
		exaApiKey: "test-exa-api-key",
		exaMaxResults: 3,
		exaMaxCostMicrosPerCall: 10_000,
		llmUrl: "https://llm.test/v1/chat/completions",
		llmApiKey: "test-llm-api-key",
		llmMaxOutputTokensPerCall: 512,
		llmInputCostMicrosPerMillionTokens: 150_000,
		llmOutputCostMicrosPerMillionTokens: 600_000,
		maxEvidenceCharacters: 12_000,
		baseBackoffMs: 1_000,
		maxBackoffMs: 60_000,
	};
}
