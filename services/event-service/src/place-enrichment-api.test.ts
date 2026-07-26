import { describe, expect, test } from "bun:test";
import { createApp } from "./app";
import { DomainError } from "./domain";
import type {
	PlaceEnrichmentField,
	PlaceEnrichmentJob,
	PlaceEnrichmentPolicy,
} from "./place-enrichment";
import { placeEnrichmentResponse } from "./place-enrichment-api";
import type { EventRepository } from "./repository";
import { EventService } from "./service";

const actorId = "usr_00000000000000000000000000000901";
const rootEventId = "evt_enrichment_root";
const eventId = "evt_enrichment_event";
const candidateId =
	"pcd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const scope = { rootEventId, eventId, capabilityType: "golf" as const };

describe("place enrichment API projection", () => {
	test("returns immediate candidate facts without provider policy or budgets", () => {
		const response = placeEnrichmentResponse({
			job: candidateJob(),
			fields: [],
			globalPlaceId:
				"gpl_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
		});

		expect(response).toEqual({
			enrichment: {
				id: "pej_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				status: "pending",
				pollAfterSeconds: 2,
				retryAllowed: false,
				createdAt: "2026-07-18T20:00:00.000Z",
				updatedAt: "2026-07-18T20:00:00.000Z",
				completedAt: null,
			},
			place: {
				id: "gpl_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
				sourceCandidateId:
					"pcd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				kind: "golf_course",
				name: "Carya Golf Club",
				locality: "Belek",
				region: "Antalya",
				countryCode: "TR",
				latitude: 36.858,
				longitude: 31.055,
				address: null,
				websiteUrl: null,
				summary: null,
			},
		});
		expect(JSON.stringify(response)).not.toContain("budget");
		expect(JSON.stringify(response)).not.toContain("model");
	});

	test("exposes only approved facts and bounded retry polling", () => {
		const job = candidateJob();
		job.status = "retry";
		const fields: PlaceEnrichmentField[] = [
			field("address", "Kadriye, Belek", "auto_approved"),
			field("summary", "Unreviewed provider text", "pending_review"),
		];

		const response = placeEnrichmentResponse({
			job,
			fields,
			globalPlaceId:
				"gpl_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
		});

		expect(response.enrichment.pollAfterSeconds).toBe(5);
		expect(response.enrichment.retryAllowed).toBe(true);
		expect(response.place?.address).toBe("Kadriye, Belek");
		expect(response.place?.summary).toBeNull();
	});

	test("does not disclose a search-miss query", () => {
		const job = candidateJob();
		job.target = {
			type: "search_miss",
			query: "private organizer wording",
			kind: "venue",
			countryCode: "CH",
		};

		const response = placeEnrichmentResponse({
			job,
			fields: [],
			globalPlaceId: null,
		});

		expect(response.place).toBeNull();
		expect(JSON.stringify(response)).not.toContain("private organizer wording");
	});

	test("replays a completed command after the worker feature is disabled", async () => {
		let scopeChecks = 0;
		let associationChecks = 0;
		const projection = placeEnrichmentResponse({
			job: candidateJob(),
			fields: [],
			globalPlaceId:
				"gpl_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
		});
		const repository = {
			findIdempotent: async (
				_input: unknown,
				guard: (
					repository: EventRepository,
					replay: {
						status: number;
						body: typeof projection;
						headers: Record<string, string>;
					},
				) => Promise<void>,
			) => {
				const replay = {
					status: 202,
					body: projection,
					headers: {
						Location: `/v1/places/enrichment-jobs/${projection.enrichment.id}?rootEventId=${rootEventId}`,
						"Retry-After": "2",
					},
					replayed: true,
				};
				await guard(repository as EventRepository, replay);
				return replay;
			},
			assertPlaceEnrichmentCreateScope: async () => {
				scopeChecks += 1;
			},
			getPlaceEnrichment: async () => {
				associationChecks += 1;
				return enrichmentResult();
			},
			runIdempotent: async () => {
				throw new Error("A completed replay must not start new work");
			},
		} as unknown as EventRepository;
		const app = createApp({
			service: new EventService(
				repository,
				"place-enrichment-disabled-test-key-with-at-least-32-characters",
			),
			verifyUserToken: async (token) => ({ id: token }),
		});
		const response = await app.request("/v1/places/enrichment-jobs", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${actorId}`,
				"Idempotency-Key": "completed-enrichment-01",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				...scope,
				target: "candidate",
				candidateId:
					"pcd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			}),
		});

		expect(response.status).toBe(202);
		expect(response.headers.get("idempotency-replayed")).toBe("true");
		expect(await response.json()).toEqual(projection);
		expect(scopeChecks).toBe(1);
		expect(associationChecks).toBe(1);
	});

	test("returns 503 before enqueue or retry when the worker feature is disabled", async () => {
		const repository = {
			findIdempotent: async () => null,
			runIdempotent: async () => {
				throw new Error("Disabled enrichment must not claim idempotency");
			},
		} as unknown as EventRepository;
		const app = createApp({
			service: new EventService(
				repository,
				"place-enrichment-disabled-test-key-with-at-least-32-characters",
			),
			verifyUserToken: async (token) => ({ id: token }),
		});
		const headers = {
			Authorization: `Bearer ${actorId}`,
			"Idempotency-Key": "disabled-enrichment-01",
			"Content-Type": "application/json",
		};
		for (const [path, body] of [
			[
				"/v1/places/enrichment-jobs",
				{
					...scope,
					target: "search_miss",
					query: "Belek golf course",
					kind: "golf_course",
					countryCode: "TR",
				},
			],
			[
				`/v1/places/enrichment-jobs/pej_${"a".repeat(64)}/retry?rootEventId=${rootEventId}`,
				undefined,
			],
		] as const) {
			const response = await app.request(path, {
				method: "POST",
				headers,
				...(body ? { body: JSON.stringify(body) } : {}),
			});
			expect(response.status).toBe(503);
			expect(response.headers.get("retry-after")).toBe("60");
			expect(await response.json()).toMatchObject({
				error: { code: "SERVICE_UNAVAILABLE", retryable: true },
			});
		}
	});

	test("requires a strict root, event and capability scope", async () => {
		const app = createApp({
			verifyUserToken: async (token) => ({ id: token }),
		});
		const headers = {
			Authorization: `Bearer ${actorId}`,
			"Idempotency-Key": "strict-enrichment-01",
			"Content-Type": "application/json",
		};
		for (const body of [
			{
				target: "candidate",
				candidateId:
					"pcd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			},
			{
				...scope,
				target: "candidate",
				candidateId:
					"pcd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				unexpected: true,
			},
		]) {
			const response = await app.request("/v1/places/enrichment-jobs", {
				method: "POST",
				headers,
				body: JSON.stringify(body),
			});
			expect(response.status).toBe(400);
		}
		for (const path of [
			`/v1/places/enrichment-jobs/pej_${"a".repeat(64)}`,
			`/v1/places/enrichment-jobs/pej_${"a".repeat(64)}?rootEventId=${rootEventId}&unexpected=true`,
			`/v1/places/enrichment-jobs/pej_${"a".repeat(64)}/retry`,
		]) {
			const response = await app.request(path, {
				method: path.endsWith("/retry") ? "POST" : "GET",
				headers,
			});
			expect(response.status).toBe(400);
		}
		const document = await (
			await createApp().request("/docs/openapi.json")
		).json();
		expect(
			document.paths["/v1/places/enrichment-jobs/{jobId}"].get.responses["200"]
				.headers["Retry-After"],
		).toEqual({
			description: "Seconds until the request may be retried",
			schema: { type: "string" },
		});
	});

	test("forwards actor and scope through create, read and retry", async () => {
		const calls: unknown[][] = [];
		const repository = {
			findIdempotent: async () => null,
			runIdempotent: async (
				_input: unknown,
				work: (repository: EventRepository) => Promise<{
					status: number;
					body: Record<string, unknown>;
					headers: Record<string, string>;
				}>,
			) => ({
				...(await work(repository as EventRepository)),
				replayed: false,
			}),
			requestPlaceEnrichmentCandidate: async (...args: unknown[]) => {
				calls.push(["create", ...args.slice(0, 3)]);
				return candidateJob();
			},
			getPlaceEnrichment: async (...args: unknown[]) => {
				calls.push(["get", ...args]);
				return enrichmentResult();
			},
			requestPlaceEnrichmentRetry: async (...args: unknown[]) => {
				calls.push(["retry", ...args]);
				return candidateJob();
			},
		} as unknown as EventRepository;
		const app = enabledApp(repository);
		const create = await app.request("/v1/places/enrichment-jobs", {
			method: "POST",
			headers: commandHeaders("scope-create-01"),
			body: JSON.stringify({
				...scope,
				target: "candidate",
				candidateId:
					"pcd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			}),
		});
		expect(create.status).toBe(202);
		expect(create.headers.get("location")).toBe(
			`/v1/places/enrichment-jobs/${candidateJob().id}?rootEventId=${rootEventId}`,
		);

		const read = await app.request(
			`/v1/places/enrichment-jobs/${candidateJob().id}?rootEventId=${rootEventId}`,
			{ headers: { Authorization: `Bearer ${actorId}` } },
		);
		expect(read.status).toBe(200);

		const retry = await app.request(
			`/v1/places/enrichment-jobs/${candidateJob().id}/retry?rootEventId=${rootEventId}`,
			{ method: "POST", headers: commandHeaders("scope-retry-01") },
		);
		expect(retry.status).toBe(202);
		expect(calls).toContainEqual([
			"create",
			{ id: actorId },
			scope,
			candidateId,
		]);
		expect(calls.filter(([kind]) => kind === "get")).toEqual(
			Array(3).fill(["get", { id: actorId }, rootEventId, candidateJob().id]),
		);
		expect(calls).toContainEqual([
			"retry",
			{ id: actorId },
			rootEventId,
			candidateJob().id,
		]);
	});

	test("does not cache place-enrichment capacity responses", async () => {
		let stored:
			| {
					status: number;
					body: Record<string, unknown>;
					headers: Record<string, string>;
			  }
			| undefined;
		let attempts = 0;
		const repository = {
			findIdempotent: async () => null,
			runIdempotent: async (
				_input: unknown,
				work: (repository: EventRepository) => Promise<{
					status: number;
					body: Record<string, unknown>;
					headers: Record<string, string>;
				}>,
			) => {
				if (stored) return { ...stored, replayed: true };
				stored = await work(repository as EventRepository);
				return { ...stored, replayed: false };
			},
			requestPlaceEnrichmentCandidate: async () => {
				attempts += 1;
				throw new DomainError(
					409,
					"PLACE_ENRICHMENT_CAPACITY",
					"Place enrichment capacity is temporarily exhausted.",
					{ "Retry-After": "60" },
				);
			},
		} as unknown as EventRepository;
		const app = enabledApp(repository);
		for (let index = 0; index < 2; index += 1) {
			const response = await app.request("/v1/places/enrichment-jobs", {
				method: "POST",
				headers: commandHeaders("capacity-enrichment-01"),
				body: JSON.stringify({
					...scope,
					target: "candidate",
					candidateId:
						"pcd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				}),
			});
			expect(response.status).toBe(409);
			expect(response.headers.get("retry-after")).toBe("60");
			expect(await response.json()).toMatchObject({
				error: { code: "PLACE_ENRICHMENT_CAPACITY", retryable: true },
			});
		}
		expect(stored).toBeUndefined();
		expect(attempts).toBe(2);
	});

	test("conceals lost create replay authority as not found", async () => {
		const projection = placeEnrichmentResponse(enrichmentResult());
		const replay = {
			status: 202,
			body: projection,
			headers: {},
			replayed: true,
		};
		const app = createApp({
			service: new EventService(
				{
					findIdempotent: async (
						_input: unknown,
						guard: (
							repository: EventRepository,
							replay: {
								status: number;
								body: typeof projection;
								headers: Record<string, string>;
								replayed: boolean;
							},
						) => Promise<void>,
					) => {
						const repository = {
							getPlaceEnrichment: async () => enrichmentResult(),
							assertPlaceEnrichmentCreateScope: async () => {
								throw new DomainError(403, "FORBIDDEN", "Forbidden");
							},
						} as unknown as EventRepository;
						await guard(repository, replay);
						return replay;
					},
					getPlaceEnrichment: async () => enrichmentResult(),
					assertPlaceEnrichmentCreateScope: async () => {
						throw new DomainError(403, "FORBIDDEN", "Forbidden");
					},
				} as unknown as EventRepository,
				"replay-redaction-key-with-at-least-32-characters",
			),
			verifyUserToken: async (token) => ({ id: token }),
		});
		const response = await app.request("/v1/places/enrichment-jobs", {
			method: "POST",
			headers: commandHeaders("replay-redaction-01"),
			body: JSON.stringify({
				...scope,
				target: "candidate",
				candidateId:
					"pcd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			}),
		});
		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({
			error: { code: "PLACE_ENRICHMENT_NOT_FOUND" },
		});
	});

	test("revalidates stored create errors after authority or scope loss", async () => {
		for (const failure of [
			new DomainError(403, "FORBIDDEN", "Forbidden"),
			new DomainError(
				409,
				"PLACE_ENRICHMENT_SCOPE_INVALID",
				"Place enrichment is no longer required.",
			),
		]) {
			let associationChecks = 0;
			const replay = {
				status: 409,
				body: {
					error: {
						code: "PLACE_ENRICHMENT_KIND_MISMATCH",
						message: "The candidate kind does not match.",
						retryable: false,
					},
				},
				headers: {},
				replayed: true,
			};
			const guardedRepository = {
				assertPlaceEnrichmentCreateScope: async () => {
					throw failure;
				},
				getPlaceEnrichment: async () => {
					associationChecks += 1;
					return enrichmentResult();
				},
			} as unknown as EventRepository;
			const app = createApp({
				service: new EventService(
					{
						findIdempotent: async (
							_input: unknown,
							guard: (
								repository: EventRepository,
								storedReplay: typeof replay,
							) => Promise<void>,
						) => {
							await guard(guardedRepository, replay);
							return replay;
						},
					} as unknown as EventRepository,
					"error-replay-redaction-key-with-at-least-32-characters",
				),
				verifyUserToken: async (token) => ({ id: token }),
			});
			const response = await app.request("/v1/places/enrichment-jobs", {
				method: "POST",
				headers: commandHeaders("error-replay-redaction-01"),
				body: JSON.stringify({
					...scope,
					target: "candidate",
					candidateId,
				}),
			});
			expect(response.status).toBe(404);
			expect(await response.json()).toMatchObject({
				error: { code: "PLACE_ENRICHMENT_NOT_FOUND" },
			});
			expect(associationChecks).toBe(0);
		}
	});
});

function enabledApp(repository: EventRepository) {
	return createApp({
		service: new EventService(
			repository,
			"place-enrichment-test-key-with-at-least-32-characters",
			undefined,
			"place-enrichment-sync-key-with-at-least-32-characters",
			undefined,
			policy(),
		),
		verifyUserToken: async (token) => ({ id: token }),
	});
}

function commandHeaders(idempotencyKey: string) {
	return {
		Authorization: `Bearer ${actorId}`,
		"Idempotency-Key": idempotencyKey,
		"Content-Type": "application/json",
	};
}

function policy(): PlaceEnrichmentPolicy {
	return candidateJob().policy;
}

function enrichmentResult() {
	return {
		job: candidateJob(),
		fields: [],
		globalPlaceId:
			"gpl_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
	};
}

function candidateJob(): PlaceEnrichmentJob {
	const now = new Date("2026-07-18T20:00:00.000Z");
	return {
		id: "pej_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		requestHash:
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		target: {
			type: "candidate",
			candidateId:
				"pcd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			candidateSnapshotHash:
				"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
			candidateSource: "fixture",
			candidateSourceUrl: "https://example.com/carya",
			kind: "golf_course",
			name: "Carya Golf Club",
			locality: "Belek",
			region: "Antalya",
			countryCode: "TR",
			latitude: 36.858,
			longitude: 31.055,
		},
		policy: {
			pipelineVersion: "place-v1",
			model: "fixture-model",
			promptVersion: "place-v1",
			maxAttempts: 3,
			maxExaCalls: 2,
			maxLlmCalls: 2,
			maxInputTokens: 20_000,
			maxOutputTokens: 1_024,
			maxCostMicros: 50_000,
			providerTimeoutMs: 5_000,
			maxResponseBytes: 262_144,
		},
		status: "pending",
		attempts: 0,
		budget: {
			exaCallsReserved: 0,
			llmCallsReserved: 0,
			inputTokensReserved: 0,
			outputTokensReserved: 0,
			costMicrosReserved: 0,
		},
		outcomeCode: null,
		createdAt: now,
		updatedAt: now,
		completedAt: null,
	};
}

function field(
	name: PlaceEnrichmentField["name"],
	value: string,
	approvalState: PlaceEnrichmentField["approvalState"],
): PlaceEnrichmentField {
	return {
		name,
		value,
		sourceKind: "candidate",
		sourceUrl: "https://example.com/carya",
		observedAt: new Date("2026-07-18T20:00:00.000Z"),
		model: null,
		promptVersion: null,
		validatorVersion: "place-field-v1",
		validationState: "passed",
		approvalState,
	};
}
