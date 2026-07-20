import { describe, expect, test } from "bun:test";
import {
	GatewayClient,
	GatewayClientError,
	type GatewayDiagnostic,
	type GatewayRequest,
	type Session,
	type SessionStore,
} from "../src/index.ts";

class MemorySessionStore implements SessionStore {
	session: Session | null;
	sets = 0;
	clears = 0;
	clearShouldFail = false;
	getShouldFail = false;

	constructor(session: Session | null) {
		this.session = session;
	}

	async get(): Promise<Session | null> {
		if (this.getShouldFail)
			throw new Error("session store leaked access-old-secret");
		return this.session;
	}

	async compareAndSet(
		expected: Session | null,
		replacement: Session | null,
	): Promise<boolean> {
		if (replacement === null && this.clearShouldFail) {
			this.clears += 1;
			throw new Error("persistent clear failed");
		}
		if (!sameStoredSession(this.session, expected)) return false;
		if (replacement === null) this.clears += 1;
		else this.sets += 1;
		this.session = replacement;
		return true;
	}
}

class DeferredGetSessionStore extends MemorySessionStore {
	#deferNext = false;
	#release: (() => void) | undefined;
	#started: (() => void) | undefined;
	started = Promise.resolve();

	deferNextGet() {
		this.#deferNext = true;
		this.started = new Promise<void>((resolve) => {
			this.#started = resolve;
		});
	}

	releaseGet() {
		this.#release?.();
	}

	override async get(): Promise<Session | null> {
		if (this.#deferNext) {
			this.#deferNext = false;
			this.#started?.();
			await new Promise<void>((resolve) => {
				this.#release = resolve;
			});
		}
		return super.get();
	}
}

const oldSession = session("access-old-secret", "refresh-old-secret");
const newSession = session("access-new-secret", "refresh-new-secret");
const otherSession = sessionForUser(
	"access-other-secret",
	"refresh-other-secret",
	"usr_abcdefabcdefabcdefabcdefabcdefab",
);

describe("GatewayClient request mapping", () => {
	test("maps path, query, contract headers, auth and the central request ID", async () => {
		const store = new MemorySessionStore(oldSession);
		const seen: Array<{ url: string; init: RequestInit }> = [];
		const client = clientWith(store, async (input, init) => {
			seen.push({ url: String(input), init: init ?? {} });
			return jsonResponse(200, { deleted: true });
		});

		const result = await client.request("eventsDelete", {
			path: { rootEventId: "root/with space", eventId: "event?one" },
			query: { baseVersion: 7, subtree: "true" },
			headers: { "idempotency-key": "idem-explicit-0001" },
		});

		expect(result.data).toEqual({ deleted: true });
		expect(seen).toHaveLength(1);
		expect(seen[0]?.url).toBe(
			"https://gateway.test/core/v1/event-roots/root%2Fwith%20space/events/event%3Fone?baseVersion=7&subtree=true",
		);
		const headers = new Headers(seen[0]?.init.headers);
		expect(headers.get("authorization")).toBe("Bearer access-old-secret");
		expect(headers.get("idempotency-key")).toBe("idem-explicit-0001");
		expect(headers.get("x-request-id")).toBe("request-00000001");
		expect(seen[0]?.init.redirect).toBe("error");
		expect(seen[0]?.init.body).toBeUndefined();
	});

	test("maps the generated minimal member directory page", async () => {
		const seen: string[] = [];
		const client = clientWith(
			new MemorySessionStore(oldSession),
			async (input) => {
				seen.push(String(input));
				return jsonResponse(200, {
					items: [
						{
							userId: "usr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
							displayName: "Ada",
						},
					],
					pageInfo: { nextCursor: null, hasMore: false },
				});
			},
		);
		const result = await client.request("eventMemberDirectoryGet", {
			path: { rootEventId: "evt_directory" },
			query: { limit: 25, cursor: "signed-directory-cursor" },
		});
		expect(seen).toEqual([
			"https://gateway.test/core/v1/event-roots/evt_directory/member-directory?cursor=signed-directory-cursor&limit=25",
		]);
		expect(result.data).toEqual({
			items: [
				{
					userId: "usr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					displayName: "Ada",
				},
			],
			pageInfo: { nextCursor: null, hasMore: false },
		});
	});

	test("maps the generated privacy-safe duplicate suggestion read", async () => {
		const seen: string[] = [];
		const responseBody = {
			items: [
				{
					id: "fbk_mobile_duplicate",
					title: "Check-in flow",
					status: "open" as const,
					voteCount: 3,
				},
			],
			pageInfo: { nextCursor: null, hasMore: false },
		};
		const client = clientWith(
			new MemorySessionStore(oldSession),
			async (input) => {
				seen.push(String(input));
				return jsonResponse(200, responseBody);
			},
		);
		const result = await client.request(
			"eventFeedbackDuplicateSuggestionsList",
			{
				path: { rootEventId: "evt_mobile_duplicates" },
				query: { q: "check in", limit: 5, cursor: "signed-cursor" },
			},
		);
		expect(seen).toEqual([
			"https://gateway.test/core/v1/event-roots/evt_mobile_duplicates/feedback/duplicate-suggestions?cursor=signed-cursor&limit=5&q=check+in",
		]);
		expect(result.data).toEqual(responseBody);
	});

	test("maps a JSON body and creates required idempotency centrally", async () => {
		const seen: RequestInit[] = [];
		const client = clientWith(
			new MemorySessionStore(null),
			async (_input, init) => {
				seen.push(init ?? {});
				return jsonResponse(202, { accepted: true });
			},
		);

		await client.request("identityMagicLinksCreate", {
			body: { email: "crew@example.com" },
		});

		const headers = new Headers(seen[0]?.headers);
		expect(headers.get("authorization")).toBeNull();
		expect(headers.get("content-type")).toBe("application/json");
		expect(headers.get("idempotency-key")).toBe("idempotency-0001");
		expect(seen[0]?.body).toBe('{"email":"crew@example.com"}');
	});

	test("maps the generated existing-root template-adoption command", async () => {
		const rootEventId = "evt_mobile_template_adopt";
		const body = {
			baseVersion: 1,
			baseRevision: "1",
			template: {
				id: "team-event",
				version: 1,
				eventIds: {
					root: rootEventId,
					agenda: "evt_mobile_template_agenda",
					activity: "evt_mobile_template_activity",
				},
			},
		};
		const responseBody = {
			event: {
				id: rootEventId,
				rootEventId,
				parentEventId: null,
				kind: "team_event" as const,
				title: "Crew team event",
				description: null,
				timeZone: "Europe/Zurich",
				startsAt: null,
				endsAt: null,
				sortKey: "1024",
				childOrderVersion: 2,
				itineraryOrderVersion: 1,
				status: "draft" as const,
				version: 2,
				createdAt: "2026-07-19T08:00:00.000Z",
				updatedAt: "2026-07-19T08:01:00.000Z",
			},
			rootRevision: "2",
			template: { id: "team-event" as const, version: 1 as const },
		};
		const seen: Array<{ url: string; init: RequestInit }> = [];
		const client = clientWith(
			new MemorySessionStore(oldSession),
			async (input, init) => {
				seen.push({ url: String(input), init: init ?? {} });
				return jsonResponse(200, responseBody);
			},
		);

		const result = await client.request("eventTemplateAdopt", {
			path: { rootEventId },
			body,
		});

		expect(result.data).toEqual(responseBody);
		expect(seen[0]?.url).toBe(
			`https://gateway.test/core/v1/event-roots/${rootEventId}/template`,
		);
		expect(seen[0]?.init.body).toBe(JSON.stringify(body));
		const headers = new Headers(seen[0]?.init.headers);
		expect(headers.get("authorization")).toBe("Bearer access-old-secret");
		expect(headers.get("idempotency-key")).toBe("idempotency-0001");
	});

	test("maps the generated golf score mutation without client-derived scoring fields", async () => {
		const rootEventId = "evt_mobilegolf001";
		const actorId = oldSession.user.id;
		const deviceId = "dvc_00000000-0000-4000-8000-000000000001";
		const clientMutationId = "00000000-0000-4000-8000-000000000730";
		const entityId = `gsc_${rootEventId}:${actorId}:1`;
		const body = {
			protocolVersion: 1 as const,
			rootEventId,
			deviceId,
			mutations: [
				{
					clientMutationId,
					clientSequence: 1,
					kind: "golf.score.set" as const,
					entityId,
					baseVersion: 0,
					payload: { eventId: rootEventId, hole: 1, strokes: 4, putts: 2 },
				},
			],
		};
		const responseBody = {
			protocolVersion: 1 as const,
			rootEventId,
			deviceId,
			results: [
				{
					clientMutationId,
					clientSequence: 1,
					outcome: "applied" as const,
					replayed: false,
					rootRevision: "7",
					entity: {
						entityType: "golfScore" as const,
						entityId,
						version: 1,
					},
				},
			],
			nextExpectedClientSequence: 2,
		};
		const seen: RequestInit[] = [];
		const client = clientWith(
			new MemorySessionStore(oldSession),
			async (_input, init) => {
				seen.push(init ?? {});
				return jsonResponse(200, responseBody);
			},
		);

		const result = await client.request("syncMutationsApply", { body });

		expect(result.data).toEqual(responseBody);
		expect(JSON.parse(String(seen[0]?.body))).toEqual(body);
		expect(JSON.stringify(body)).not.toContain("playingHandicap");
		expect(JSON.stringify(body)).not.toContain("stablefordPoints");
		const headers = new Headers(seen[0]?.headers);
		expect(headers.get("authorization")).toBe("Bearer access-old-secret");
		expect(headers.get("idempotency-key")).toBe("idempotency-0001");
	});

	test("maps the strict generated manager golf round replacement unchanged", async () => {
		const rootEventId = "evt_mobilegolfround001";
		const deviceId = "dvc_00000000-0000-4000-8000-000000000001";
		const clientMutationId = "00000000-0000-4000-8000-000000000731";
		const body = {
			protocolVersion: 1 as const,
			rootEventId,
			deviceId,
			mutations: [
				{
					clientMutationId,
					clientSequence: 1,
					kind: "golf.round.replace" as const,
					entityId: rootEventId,
					baseVersion: 1,
					payload: {
						eventId: rootEventId,
						holes: Array.from({ length: 18 }, (_, index) => ({
							hole: index + 1,
							par: 4,
							strokeIndex: index + 1,
						})),
						players: [
							{ userId: oldSession.user.id, playingHandicap: -2 },
							{ userId: otherSession.user.id, playingHandicap: 18 },
						],
						teams: [
							{
								id: "gtm_managerflight",
								name: "Manager Flight",
								color: "#00AA55",
								memberUserIds: [oldSession.user.id, otherSession.user.id],
							},
						],
					},
				},
			],
		} satisfies GatewayRequest<"syncMutationsApply">["body"];
		const responseBody = {
			protocolVersion: 1 as const,
			rootEventId,
			deviceId,
			results: [
				{
					clientMutationId,
					clientSequence: 1,
					outcome: "applied" as const,
					replayed: false,
					rootRevision: "8",
					entity: {
						entityType: "golfRound" as const,
						entityId: rootEventId,
						version: 2,
					},
				},
			],
			nextExpectedClientSequence: 2,
		};
		const seen: RequestInit[] = [];
		const client = clientWith(
			new MemorySessionStore(oldSession),
			async (_input, init) => {
				seen.push(init ?? {});
				return jsonResponse(200, responseBody);
			},
		);

		const result = await client.request("syncMutationsApply", { body });

		expect(result.data).toEqual(responseBody);
		expect(seen[0]?.body).toBe(JSON.stringify(body));
		const headers = new Headers(seen[0]?.headers);
		expect(headers.get("authorization")).toBe("Bearer access-old-secret");
		expect(headers.get("idempotency-key")).toBe("idempotency-0001");
	});

	test("maps all generated team collaboration mutations unchanged", async () => {
		const rootEventId = "evt_mobileteam001";
		const eventId = "evt_mobileteamactivity001";
		const deviceId = "dvc_00000000-0000-4000-8000-000000000001";
		const decisionId = "tdc_mobileteamlunch001";
		const responseId = `trp_${decisionId}:${oldSession.user.id}`;
		const body = {
			protocolVersion: 1 as const,
			rootEventId,
			deviceId,
			mutations: [
				{
					clientMutationId: "00000000-0000-4000-8000-000000000741",
					clientSequence: 1,
					kind: "team.assignments.publish" as const,
					entityId: eventId,
					baseVersion: 0,
					payload: {
						eventId,
						teams: [
							{
								id: "ttm_alpha",
								name: "Alpha",
								color: "#00AA55",
								memberUserIds: [oldSession.user.id, otherSession.user.id],
							},
						],
					},
				},
				{
					clientMutationId: "00000000-0000-4000-8000-000000000742",
					clientSequence: 2,
					kind: "team.decision.replace" as const,
					entityId: decisionId,
					baseVersion: 0,
					payload: {
						eventId,
						title: "What should we eat?",
						state: "open" as const,
						options: [
							{ id: "tdo_pizza", label: "Pizza" },
							{ id: "tdo_salad", label: "Salad" },
						],
					},
				},
				{
					clientMutationId: "00000000-0000-4000-8000-000000000743",
					clientSequence: 3,
					kind: "team.response.set" as const,
					entityId: responseId,
					baseVersion: 0,
					payload: { eventId, decisionId, optionId: "tdo_pizza" },
				},
			],
		} satisfies GatewayRequest<"syncMutationsApply">["body"];
		const responseBody = {
			protocolVersion: 1 as const,
			rootEventId,
			deviceId,
			results: [
				{
					clientMutationId: "00000000-0000-4000-8000-000000000741",
					clientSequence: 1,
					outcome: "applied" as const,
					replayed: false,
					rootRevision: "11",
					entity: {
						entityType: "teamAssignmentSet" as const,
						entityId: eventId,
						version: 1,
					},
				},
				{
					clientMutationId: "00000000-0000-4000-8000-000000000742",
					clientSequence: 2,
					outcome: "applied" as const,
					replayed: false,
					rootRevision: "12",
					entity: {
						entityType: "teamDecision" as const,
						entityId: decisionId,
						version: 1,
					},
				},
				{
					clientMutationId: "00000000-0000-4000-8000-000000000743",
					clientSequence: 3,
					outcome: "applied" as const,
					replayed: false,
					rootRevision: "13",
					entity: {
						entityType: "teamResponse" as const,
						entityId: responseId,
						version: 1,
					},
				},
			],
			nextExpectedClientSequence: 4,
		};
		const seen: RequestInit[] = [];
		const client = clientWith(
			new MemorySessionStore(oldSession),
			async (input, init) => {
				expect(String(input)).toBe("https://gateway.test/core/v1/sync/push");
				seen.push(init ?? {});
				return jsonResponse(200, responseBody);
			},
		);

		const result = await client.request("syncMutationsApply", { body });

		expect(result.data).toEqual(responseBody);
		expect(seen[0]?.body).toBe(JSON.stringify(body));
		const headers = new Headers(seen[0]?.headers);
		expect(headers.get("authorization")).toBe("Bearer access-old-secret");
		expect(headers.get("idempotency-key")).toBe("idempotency-0001");
	});

	test("accepts scoped team records and rejects a leaked roster", async () => {
		const rootEventId = "evt_mobileteamprojection001";
		const eventId = "evt_mobileteamprojectionactivity001";
		const decisionId = "tdc_mobileteamprojection001";
		const actorId = oldSession.user.id;
		const team = { id: "ttm_alpha", name: "Alpha", color: "#00AA55" };
		const updatedAt = "2026-07-19T08:00:00.000Z";
		const assignmentSet = {
			entityType: "teamAssignmentSet",
			entityId: eventId,
			entityVersion: 1,
			data: { rootEventId, eventId, teams: [team], version: 1, updatedAt },
		};
		const assignment = {
			entityType: "teamAssignment",
			entityId: `tma_${eventId}:${actorId}`,
			entityVersion: 1,
			data: {
				rootEventId,
				eventId,
				userId: actorId,
				team,
				version: 1,
				updatedAt,
			},
		};
		const decision = {
			entityType: "teamDecision",
			entityId: decisionId,
			entityVersion: 2,
			data: {
				id: decisionId,
				rootEventId,
				eventId,
				title: "What should we eat?",
				state: "open",
				options: [
					{ id: "tdo_pizza", label: "Pizza", responseCount: 1 },
					{ id: "tdo_salad", label: "Salad", responseCount: 0 },
				],
				responseCount: 1,
				version: 2,
				aggregateVersion: 2,
				createdAt: updatedAt,
				updatedAt,
			},
		};
		const responseId = `trp_${decisionId}:${actorId}`;
		const response = {
			entityType: "teamResponse",
			entityId: responseId,
			entityVersion: 1,
			data: {
				id: responseId,
				rootEventId,
				eventId,
				decisionId,
				userId: actorId,
				optionId: "tdo_pizza",
				version: 1,
				rootRevision: "13",
				createdAt: updatedAt,
				updatedAt,
			},
		};
		const bootstrap = (records: unknown[]) => ({
			protocolVersion: 1,
			rootEventId,
			authorizationScopeVersion: "3",
			snapshotId: "snp_mobileteamprojection001",
			snapshotRevision: "13",
			records,
			syncCursor: "cursor-mobile-team-projection-0001",
			pageInfo: { nextCursor: null, hasMore: false },
		});
		const body = bootstrap([assignmentSet, assignment, decision, response]);
		const seen: Array<{ url: string; init: RequestInit }> = [];
		const client = clientWith(
			new MemorySessionStore(oldSession),
			async (input, init) => {
				seen.push({ url: String(input), init: init ?? {} });
				return jsonResponse(200, body);
			},
		);

		const result = await client.request("syncBootstrapRead", {
			query: { rootEventId, limit: 5 },
		});

		expect(result.data as unknown).toEqual(body);
		expect(seen[0]?.url).toBe(
			`https://gateway.test/core/v1/sync/bootstrap?limit=5&rootEventId=${rootEventId}`,
		);
		const headers = new Headers(seen[0]?.init.headers);
		expect(headers.get("authorization")).toBe("Bearer access-old-secret");
		expect(headers.get("idempotency-key")).toBeNull();

		const leaked = bootstrap([
			assignmentSet,
			{
				...assignment,
				data: {
					...assignment.data,
					team: {
						...team,
						memberUserIds: [actorId, otherSession.user.id],
					},
				},
			},
			decision,
			response,
		]);
		const error = (await captured(
			clientWith(new MemorySessionStore(oldSession), async () =>
				jsonResponse(200, leaked),
			).request("syncBootstrapRead", {
				query: { rootEventId, limit: 5 },
			}),
		)) as GatewayClientError;
		expect(error.code).toBe("invalid_response");
		expect(JSON.stringify(error)).not.toContain(otherSession.user.id);
	});

	test("maps candidate selection and validates the bounded enrichment projection", async () => {
		const seen: Array<{ url: string; init: RequestInit }> = [];
		const candidateId = `pcd_${"a".repeat(64)}`;
		const placeId = `gpl_${"c".repeat(64)}`;
		const jobId = `pej_${"b".repeat(64)}`;
		const response = {
			enrichment: {
				id: jobId,
				status: "pending" as const,
				pollAfterSeconds: 2,
				retryAllowed: false,
				createdAt: "2026-07-18T20:00:00.000Z",
				updatedAt: "2026-07-18T20:00:00.000Z",
				completedAt: null,
			},
			place: {
				id: placeId,
				sourceCandidateId: candidateId,
				kind: "golf_course" as const,
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
		};
		const client = clientWith(
			new MemorySessionStore(oldSession),
			async (input, init) => {
				seen.push({ url: String(input), init: init ?? {} });
				return jsonResponse(202, response);
			},
		);

		const result = await client.request("placeEnrichmentJobsCreate", {
			body: { target: "candidate", candidateId },
		});

		expect(result.data).toEqual(response);
		expect(seen[0]?.url).toBe(
			"https://gateway.test/core/v1/places/enrichment-jobs",
		);
		const headers = new Headers(seen[0]?.init.headers);
		expect(headers.get("authorization")).toBe("Bearer access-old-secret");
		expect(headers.get("idempotency-key")).toBe("idempotency-0001");
		expect(seen[0]?.init.body).toBe(
			JSON.stringify({ target: "candidate", candidateId }),
		);
	});

	test("maps manager recap-share creation and resolves the title-only public projection without a session", async () => {
		const store = new MemorySessionStore(oldSession);
		const seen: Array<{ url: string; init: RequestInit }> = [];
		const shareLink = {
			id: `rsh_${"A".repeat(24)}`,
			recapVersion: 3,
			createdAt: "2026-07-18T08:00:00.000Z",
			expiresAt: "2026-07-25T08:00:00.000Z",
		};
		const token = `crs_${"B".repeat(43)}`;
		const recap = {
			title: "Crew trip recap",
			items: [
				{ ordinal: 0, title: "Arrival" },
				{ ordinal: 1, title: "Dinner" },
			],
		};
		const client = clientWith(store, async (input, init) => {
			const url = String(input);
			seen.push({ url, init: init ?? {} });
			return url.endsWith("/recap/share-links")
				? jsonResponse(201, { shareLink, token })
				: jsonResponse(200, { recap });
		});

		const created = await client.request("eventRecapShareLinksCreate", {
			path: { rootEventId: "evt_root" },
			body: {
				recapVersion: 3,
				projectionConsent: "title-only-reviewed",
			},
		});
		expect(created.data).toEqual({ shareLink, token });
		store.getShouldFail = true;
		const resolved = await client.request("eventRecapShareLinksResolve", {
			body: { token },
		});
		expect(resolved.data).toEqual({ recap });

		expect(seen.map(({ url }) => url)).toEqual([
			"https://gateway.test/core/v1/event-roots/evt_root/recap/share-links",
			"https://gateway.test/core/v1/recap-share-links/resolve",
		]);
		const createHeaders = new Headers(seen[0]?.init.headers);
		expect(createHeaders.get("authorization")).toBe("Bearer access-old-secret");
		expect(createHeaders.get("idempotency-key")).toBe("idempotency-0001");
		expect(seen[0]?.init.body).toBe(
			JSON.stringify({
				recapVersion: 3,
				projectionConsent: "title-only-reviewed",
			}),
		);
		const resolveHeaders = new Headers(seen[1]?.init.headers);
		expect(resolveHeaders.get("authorization")).toBeNull();
		expect(resolveHeaders.get("idempotency-key")).toBeNull();
		expect(resolveHeaders.get("content-type")).toBe("application/json");
		expect(seen[1]?.init.body).toBe(JSON.stringify({ token }));

		const concealedGap = await captured(
			clientWith(store, async () =>
				jsonResponse(200, {
					recap: {
						...recap,
						items: [
							{ ordinal: 0, title: "Arrival" },
							{ ordinal: 2, title: "Hidden position leak" },
						],
					},
				}),
			).request("eventRecapShareLinksResolve", { body: { token } }),
		);
		expect(concealedGap).toMatchObject({ code: "invalid_response" });
		expect(JSON.stringify(concealedGap)).not.toContain("Hidden position leak");
	});

	test("maps authenticated recap consent state and rejects identity-bearing projections", async () => {
		const provenance = {
			sourceType: "event" as const,
			sourceId: "evt_root",
			sourceVersion: 3,
			sourceRevision: "7",
			visibility: "members" as const,
			consentBasis: "event-publication" as const,
		};
		const recap = {
			schemaVersion: 1 as const,
			rootEventId: "evt_root",
			version: 3,
			lifecycleVersion: 4,
			state: "published" as const,
			publishedVersion: 3,
			sourceRootRevision: "7",
			generatedAt: "2026-07-18T08:00:00.000Z",
			publishedAt: "2026-07-18T08:05:00.000Z",
			title: "Crew trip recap",
			titleProvenance: provenance,
			items: [
				{
					ordinal: 0,
					sourceTitle: "Dinner",
					sourceBody: "Reviewed dinner body",
					provenance,
				},
			],
		};
		const externalConsent = {
			fields: [
				{
					ordinal: 0,
					field: "body" as const,
					requiredAuthorities: ["manager" as const],
					authorDecision: "unknown" as const,
					managerDecision: "grant" as const,
					actorCanDecide: ["manager" as const],
				},
			],
		};
		const seen: Array<{ url: string; init: RequestInit }> = [];
		const client = clientWith(
			new MemorySessionStore(oldSession),
			async (input, init) => {
				seen.push({ url: String(input), init: init ?? {} });
				return jsonResponse(200, { recap, externalConsent });
			},
		);

		const response = await client.request("eventRecapsGet", {
			path: { rootEventId: "evt_root" },
			query: { version: 3 },
		});
		expect(response.data).toEqual({ recap, externalConsent });
		expect(seen[0]?.url).toBe(
			"https://gateway.test/core/v1/event-roots/evt_root/recap?version=3",
		);
		expect(new Headers(seen[0]?.init.headers).get("authorization")).toBe(
			"Bearer access-old-secret",
		);

		const nullState = await clientWith(
			new MemorySessionStore(oldSession),
			async () => jsonResponse(200, { recap, externalConsent: null }),
		).request("eventRecapsGet", { path: { rootEventId: "evt_root" } });
		expect(nullState.data.externalConsent).toBeNull();

		for (const unsafeConsent of [
			{
				fields: [
					{
						...externalConsent.fields[0],
						actorId: "usr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
					},
				],
			},
			{
				fields: [
					{
						...externalConsent.fields[0],
						managerDecision: "granted",
					},
				],
			},
		]) {
			const concealed = await captured(
				clientWith(new MemorySessionStore(oldSession), async () =>
					jsonResponse(200, { recap, externalConsent: unsafeConsent }),
				).request("eventRecapsGet", {
					path: { rootEventId: "evt_root" },
				}),
			);
			expect(concealed).toMatchObject({ code: "invalid_response" });
			expect(JSON.stringify(concealed)).not.toContain("usr_aaaaaaaa");
		}
	});

	test("maps exact recap grants and accepts only the redacted contiguous public body projection", async () => {
		const store = new MemorySessionStore(oldSession);
		const seen: Array<{ url: string; init: RequestInit }> = [];
		const shareLink = {
			id: `rsh_${"E".repeat(24)}`,
			recapVersion: 3,
			createdAt: "2026-07-18T08:00:00.000Z",
			expiresAt: "2026-07-25T08:00:00.000Z",
		};
		const token = `crs_${"F".repeat(43)}`;
		const field = {
			sourceType: "feedEntry" as const,
			sourceId: "fed_external_client",
			sourceVersion: 2,
			field: "body" as const,
		};
		const recap = {
			title: "Crew trip recap",
			items: [
				{ ordinal: 0, title: "Arrival", body: null },
				{ ordinal: 1, title: null, body: "Approved dinner moment" },
			],
		};
		const client = clientWith(store, async (input, init) => {
			const url = String(input);
			seen.push({ url, init: init ?? {} });
			if (url.endsWith("/recap/external-grants"))
				return jsonResponse(200, { decision: "grant" });
			if (url.endsWith("/recap/external-share-links"))
				return jsonResponse(201, { shareLink, token });
			return jsonResponse(200, { recap });
		});

		const grant = await client.request("eventRecapExternalGrantsDecide", {
			path: { rootEventId: "evt_root" },
			body: {
				recapVersion: 3,
				...field,
				authority: "manager",
				decision: "grant",
			},
		});
		expect(grant.data).toEqual({ decision: "grant" });
		const created = await client.request("eventRecapExternalShareLinksCreate", {
			path: { rootEventId: "evt_root" },
			body: {
				recapVersion: 3,
				projectionConsent: "exact-fields-reviewed-v1",
				fields: [field],
			},
		});
		expect(created.data).toEqual({ shareLink, token });
		store.getShouldFail = true;
		const resolved = await client.request(
			"eventRecapExternalShareLinksResolve",
			{ body: { token } },
		);
		expect(resolved.data).toEqual({ recap });

		expect(seen.map(({ url }) => url)).toEqual([
			"https://gateway.test/core/v1/event-roots/evt_root/recap/external-grants",
			"https://gateway.test/core/v1/event-roots/evt_root/recap/external-share-links",
			"https://gateway.test/core/v1/recap-external-share-links/resolve",
		]);
		for (const index of [0, 1]) {
			const headers = new Headers(seen[index]?.init.headers);
			expect(headers.get("authorization")).toBe("Bearer access-old-secret");
			expect(headers.get("idempotency-key")).toBe("idempotency-0001");
		}
		const publicHeaders = new Headers(seen[2]?.init.headers);
		expect(publicHeaders.get("authorization")).toBeNull();
		expect(publicHeaders.get("idempotency-key")).toBeNull();

		for (const unsafeRecap of [
			{ ...recap, rootEventId: "evt_internal" },
			{
				...recap,
				items: [
					recap.items[0],
					{ ordinal: 3, title: null, body: "Hidden position leak" },
				],
			},
			{
				...recap,
				items: [{ ordinal: 0, title: null, body: null }],
			},
		]) {
			const concealed = await captured(
				clientWith(store, async () =>
					jsonResponse(200, { recap: unsafeRecap }),
				).request("eventRecapExternalShareLinksResolve", {
					body: { token },
				}),
			);
			expect(concealed).toMatchObject({ code: "invalid_response" });
			expect(JSON.stringify(concealed)).not.toContain("evt_internal");
			expect(JSON.stringify(concealed)).not.toContain("Hidden position leak");
		}
	});
});

describe("GatewayClient transport security", () => {
	test("allows HTTP only for exact loopback hosts", () => {
		const store = new MemorySessionStore(null);
		expect(
			() =>
				new GatewayClient({
					baseUrl: "http://api.example.com",
					sessionStore: store,
				}),
		).toThrow("Gateway base URL must use HTTPS");
		for (const baseUrl of [
			"https://api.example.com",
			"http://localhost:3000",
			"http://127.0.0.1:3000",
			"http://[::1]:3000",
		]) {
			expect(
				() => new GatewayClient({ baseUrl, sessionStore: store }),
			).not.toThrow();
		}
	});

	test("307 and 308 redirects cannot receive a refresh-token body", async () => {
		for (const status of [307, 308]) {
			let sinkRequests = 0;
			const sink = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				async fetch(request) {
					sinkRequests += 1;
					await request.text();
					return jsonResponse(200, newSession);
				},
			});
			const gateway = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch(request) {
					if (new URL(request.url).pathname.endsWith("/auth/refresh")) {
						return new Response(null, {
							status,
							headers: {
								Location: `http://127.0.0.1:${sink.port}/capture`,
							},
						});
					}
					return jsonResponse(401, errorBody());
				},
			});
			try {
				const store = new MemorySessionStore(oldSession);
				const client = new GatewayClient({
					baseUrl: `http://127.0.0.1:${gateway.port}`,
					sessionStore: store,
					requestId: () => "request-00000001",
					idempotencyKey: () => "idempotency-0001",
				});
				const error = await captured(
					client.request("eventsGet", {
						path: { rootEventId: "root", eventId: "event" },
					}),
				);

				expect(error).toBeInstanceOf(GatewayClientError);
				expect(sinkRequests).toBe(0);
			} finally {
				gateway.stop(true);
				sink.stop(true);
			}
		}
	});
});

describe("GatewayClient authentication", () => {
	test("coalesces concurrent 401 responses into one refresh rotation", async () => {
		const store = new MemorySessionStore(oldSession);
		const oldResolvers: Array<(response: Response) => void> = [];
		let refreshes = 0;
		const client = clientWith(store, async (input, init) => {
			const url = String(input);
			const auth = new Headers(init?.headers).get("authorization");
			if (url.endsWith("/auth/refresh")) {
				refreshes += 1;
				return jsonResponse(200, newSession);
			}
			if (auth === "Bearer access-old-secret") {
				return new Promise<Response>((resolve) => {
					oldResolvers.push(resolve);
					if (oldResolvers.length === 2) {
						for (const release of oldResolvers)
							release(jsonResponse(401, errorBody()));
					}
				});
			}
			return jsonResponse(200, eventResponse("event"));
		});

		const requests = [
			client.request("eventsGet", {
				path: { rootEventId: "root", eventId: "one" },
			}),
			client.request("eventsGet", {
				path: { rootEventId: "root", eventId: "two" },
			}),
		];
		const results = await Promise.all(requests);

		expect(results).toHaveLength(2);
		expect(refreshes).toBe(1);
		expect(store.sets).toBe(1);
		expect(store.session?.accessToken).toBe("access-new-secret");
	});

	test("a delayed old-token 401 reuses the rotated session", async () => {
		const store = new MemorySessionStore(oldSession);
		let refreshes = 0;
		let releaseSlow: ((response: Response) => void) | undefined;
		const client = clientWith(store, async (input, init) => {
			const url = String(input);
			const auth = new Headers(init?.headers).get("authorization");
			if (url.endsWith("/auth/refresh")) {
				refreshes += 1;
				return jsonResponse(200, newSession);
			}
			if (auth === "Bearer access-old-secret" && url.endsWith("/slow")) {
				return new Promise<Response>((resolve) => {
					releaseSlow = resolve;
				});
			}
			if (auth === "Bearer access-old-secret")
				return jsonResponse(401, errorBody());
			return jsonResponse(200, eventResponse("event"));
		});

		const slow = client.request("eventsGet", {
			path: { rootEventId: "root", eventId: "slow" },
		});
		const fast = client.request("eventsGet", {
			path: { rootEventId: "root", eventId: "fast" },
		});
		await eventually(() => store.sets === 1);
		releaseSlow?.(jsonResponse(401, errorBody()));
		await Promise.all([slow, fast]);

		expect(refreshes).toBe(1);
		expect(store.sets).toBe(1);
	});

	test("one caller abort cannot cancel a shared refresh flight", async () => {
		const store = new MemorySessionStore(oldSession);
		const controller = new AbortController();
		const oldResolvers: Array<(response: Response) => void> = [];
		let releaseRefresh: ((response: Response) => void) | undefined;
		let refreshes = 0;
		const client = clientWith(store, async (input, init) => {
			const url = String(input);
			const auth = new Headers(init?.headers).get("authorization");
			if (url.endsWith("/auth/refresh")) {
				refreshes += 1;
				return new Promise<Response>((resolve) => {
					releaseRefresh = resolve;
				});
			}
			if (auth === "Bearer access-old-secret") {
				return new Promise<Response>((resolve) => {
					oldResolvers.push(resolve);
					if (oldResolvers.length === 2) {
						for (const release of oldResolvers)
							release(jsonResponse(401, errorBody()));
					}
				});
			}
			return jsonResponse(200, eventResponse("event"));
		});

		const cancelled = client.request("eventsGet", {
			path: { rootEventId: "root", eventId: "cancelled" },
			signal: controller.signal,
		});
		const retained = client.request("eventsGet", {
			path: { rootEventId: "root", eventId: "retained" },
		});
		await eventually(() => refreshes === 1 && releaseRefresh !== undefined);
		controller.abort();
		releaseRefresh?.(jsonResponse(200, newSession));

		const cancelledError = await captured(cancelled);
		await retained;
		expect((cancelledError as GatewayClientError).code).toBe("aborted");
		expect(refreshes).toBe(1);
		expect(store.sets).toBe(1);
		expect(store.session?.accessToken).toBe("access-new-secret");
	});

	test("refresh failure clears the session and exposes no server body", async () => {
		const store = new MemorySessionStore(oldSession);
		const diagnostics: GatewayDiagnostic[] = [];
		const secretBody = {
			error: {
				code: "refresh-old-secret",
				message: "raw body access-old-secret refresh-old-secret",
				requestId: "refresh-old-secret",
				retryable: false,
			},
		};
		const client = clientWith(
			store,
			async (input) =>
				String(input).endsWith("/auth/refresh")
					? jsonResponse(401, secretBody)
					: jsonResponse(401, errorBody()),
			diagnostics,
		);

		const error = await captured(
			client.request("eventsGet", {
				path: { rootEventId: "root", eventId: "event" },
			}),
		);
		const serialized = JSON.stringify({ error, diagnostics });

		expect(error).toBeInstanceOf(GatewayClientError);
		expect((error as GatewayClientError).code).toBe("http_error");
		expect(store.session).toBeNull();
		expect(store.clears).toBe(1);
		expect(serialized).not.toContain("access-old-secret");
		expect(serialized).not.toContain("refresh-old-secret");
		expect(serialized).not.toContain("raw body");
	});

	test("a concurrent account switch cannot consume or be overwritten by an old refresh flight", async () => {
		const store = new MemorySessionStore(oldSession);
		let releaseRefresh: ((response: Response) => void) | undefined;
		let refreshStarted = false;
		const client = clientWith(store, async (input) => {
			if (String(input).endsWith("/auth/refresh")) {
				refreshStarted = true;
				return new Promise<Response>((resolve) => {
					releaseRefresh = resolve;
				});
			}
			return jsonResponse(401, errorBody());
		});

		const request = client.request("eventsGet", {
			path: { rootEventId: "root", eventId: "event" },
		});
		await eventually(() => refreshStarted);
		store.session = otherSession;
		releaseRefresh?.(jsonResponse(200, newSession));
		const error = await captured(request);

		expect(error).toBeInstanceOf(GatewayClientError);
		expect((error as GatewayClientError).code).toBe("session_changed");
		expect(store.session).toBe(otherSession);
		expect(store.sets).toBe(0);
		expect(store.clears).toBe(0);
	});

	test("an ordinary refresh cannot overwrite an in-place token replacement", async () => {
		const mutable = structuredClone(oldSession);
		const store = new MemorySessionStore(mutable);
		let releaseRefresh: (() => void) | undefined;
		let refreshStarted: (() => void) | undefined;
		const refreshInFlight = new Promise<void>((resolve) => {
			refreshStarted = resolve;
		});
		const refreshReleased = new Promise<void>((resolve) => {
			releaseRefresh = resolve;
		});
		const authorizations: Array<string | null> = [];
		const client = clientWith(store, async (input, init) => {
			if (String(input).endsWith("/auth/refresh")) {
				refreshStarted?.();
				await refreshReleased;
				return jsonResponse(200, newSession);
			}
			authorizations.push(new Headers(init?.headers).get("authorization"));
			return jsonResponse(401, errorBody());
		});

		const pending = captured(
			client.request("eventsGet", {
				path: { rootEventId: "evt_root", eventId: "evt_ordinary-cas" },
			}),
		);
		await refreshInFlight;
		mutable.refreshToken = "refresh-replaced-during-ordinary-cas";
		releaseRefresh?.();
		const error = await pending;

		expect((error as GatewayClientError).code).toBe("session_changed");
		expect(store.session).toBe(mutable);
		expect(store.sets).toBe(0);
		expect(authorizations).toEqual(["Bearer access-old-secret"]);
	});

	test("a normal authenticated response is rejected after an account switch", async () => {
		const store = new MemorySessionStore(oldSession);
		let release: ((response: Response) => void) | undefined;
		let started = false;
		const client = clientWith(store, async () => {
			started = true;
			return new Promise<Response>((resolve) => {
				release = resolve;
			});
		});

		const request = client.request("eventsGet", {
			path: { rootEventId: "root", eventId: "event" },
		});
		await eventually(() => started);
		store.session = otherSession;
		release?.(jsonResponse(200, eventResponse("event-from-old-account")));
		const error = await captured(request);

		expect((error as GatewayClientError).code).toBe("session_changed");
		expect(store.session).toBe(otherSession);
	});

	test("an opaque session subject cannot authorize or label another account", async () => {
		const store = new MemorySessionStore(oldSession);
		let fetches = 0;
		const client = clientWith(store, async () => {
			fetches += 1;
			return jsonResponse(200, eventResponse("subject-bound"));
		});
		const subject = await client.sessionSubject();
		if (!subject) throw new Error("session subject missing");
		expect(subject.userId).toBe(oldSession.user.id);

		store.session = otherSession;
		const switched = await captured(
			client.requestAsUser(subject, "eventsGet", {
				path: { rootEventId: "evt_root", eventId: "evt_subject-bound" },
			}),
		);
		expect((switched as GatewayClientError).code).toBe("session_changed");
		expect(fetches).toBe(0);

		store.session = null;
		const loggedOut = await captured(client.assertSessionSubject(subject));
		expect((loggedOut as GatewayClientError).code).toBe("session_changed");
	});

	test("a subject-bound request checks the exact deferred auth read before fetch", async () => {
		const store = new DeferredGetSessionStore(oldSession);
		let fetches = 0;
		const client = clientWith(store, async () => {
			fetches += 1;
			return jsonResponse(200, eventResponse("must-not-fetch"));
		});
		const subject = await client.sessionSubject();
		if (!subject) throw new Error("session subject missing");
		store.deferNextGet();

		const pending = captured(
			client.requestAsUser(subject, "eventsGet", {
				path: { rootEventId: "evt_root", eventId: "evt_must-not-fetch" },
			}),
		);
		await store.started;
		store.session = otherSession;
		store.releaseGet();
		const error = await pending;

		expect((error as GatewayClientError).code).toBe("session_changed");
		expect(fetches).toBe(0);
	});

	test("a session subject fingerprints tokens against in-place store mutation", async () => {
		const mutable = structuredClone(oldSession);
		const store = new MemorySessionStore(mutable);
		let fetches = 0;
		const client = clientWith(store, async () => {
			fetches += 1;
			return jsonResponse(200, eventResponse("must-not-fetch"));
		});
		const subject = await client.sessionSubject();
		if (!subject) throw new Error("session subject missing");
		mutable.accessToken = "access-mutated-in-place";

		const error = await captured(
			client.requestAsUser(subject, "eventsGet", {
				path: { rootEventId: "evt_root", eventId: "evt_must-not-fetch" },
			}),
		);
		expect((error as GatewayClientError).code).toBe("session_changed");
		expect(fetches).toBe(0);
	});

	test("a subject-bound success rejects in-place mutation without advancing its subject", async () => {
		const mutable = structuredClone(oldSession);
		const store = new MemorySessionStore(mutable);
		let release: (() => void) | undefined;
		let started: (() => void) | undefined;
		const requestStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const responseReleased = new Promise<void>((resolve) => {
			release = resolve;
		});
		const authorizations: Array<string | null> = [];
		const client = clientWith(store, async (_input, init) => {
			authorizations.push(new Headers(init?.headers).get("authorization"));
			started?.();
			await responseReleased;
			return jsonResponse(200, eventResponse("must-not-commit"));
		});
		const subject = await client.sessionSubject();
		if (!subject) throw new Error("session subject missing");

		const pending = captured(
			client.requestAsUser(subject, "eventsGet", {
				path: { rootEventId: "evt_root", eventId: "evt_mutated-success" },
			}),
		);
		await requestStarted;
		mutable.accessToken = "access-mutated-during-success";
		mutable.refreshToken = "refresh-mutated-during-success";
		release?.();
		const error = await pending;

		expect((error as GatewayClientError).code).toBe("session_changed");
		expect(authorizations).toEqual(["Bearer access-old-secret"]);
		store.session = structuredClone(oldSession);
		await expect(client.assertSessionSubject(subject)).resolves.toBeUndefined();
	});

	test("a subject-bound retry rejects in-place mutation without advancing its subject", async () => {
		const store = new MemorySessionStore(oldSession);
		let releaseRetry: (() => void) | undefined;
		let retryStarted: (() => void) | undefined;
		const retryInFlight = new Promise<void>((resolve) => {
			retryStarted = resolve;
		});
		const retryReleased = new Promise<void>((resolve) => {
			releaseRetry = resolve;
		});
		let eventRequests = 0;
		const authorizations: Array<string | null> = [];
		const client = clientWith(store, async (input, init) => {
			if (String(input).endsWith("/auth/refresh")) {
				return jsonResponse(200, newSession);
			}
			eventRequests += 1;
			authorizations.push(new Headers(init?.headers).get("authorization"));
			if (eventRequests === 1) return jsonResponse(401, errorBody());
			retryStarted?.();
			await retryReleased;
			return jsonResponse(200, eventResponse("must-not-commit-retry"));
		});
		const subject = await client.sessionSubject();
		if (!subject) throw new Error("session subject missing");

		const pending = captured(
			client.requestAsUser(subject, "eventsGet", {
				path: { rootEventId: "evt_root", eventId: "evt_mutated-retry" },
			}),
		);
		await retryInFlight;
		const replacement = store.session;
		if (!replacement) throw new Error("rotated session missing");
		replacement.accessToken = "access-mutated-during-retry";
		replacement.refreshToken = "refresh-mutated-during-retry";
		releaseRetry?.();
		const error = await pending;

		expect((error as GatewayClientError).code).toBe("session_changed");
		expect(authorizations).toEqual([
			"Bearer access-old-secret",
			"Bearer access-new-secret",
		]);
		store.session = structuredClone(oldSession);
		await expect(client.assertSessionSubject(subject)).resolves.toBeUndefined();
	});

	test("a failed deferred refresh read preserves an in-place replacement", async () => {
		const mutable = structuredClone(oldSession);
		const store = new DeferredGetSessionStore(mutable);
		let firstResponse: (() => void) | undefined;
		const firstResponseReady = new Promise<void>((resolve) => {
			firstResponse = resolve;
		});
		let refreshes = 0;
		const client = clientWith(store, async (input) => {
			if (String(input).endsWith("/auth/refresh")) {
				refreshes += 1;
				return jsonResponse(200, newSession);
			}
			store.deferNextGet();
			firstResponse?.();
			return jsonResponse(401, errorBody());
		});
		const subject = await client.sessionSubject();
		if (!subject) throw new Error("session subject missing");

		const pending = captured(
			client.requestAsUser(subject, "eventsGet", {
				path: { rootEventId: "evt_root", eventId: "evt_failed-refresh-read" },
			}),
		);
		await firstResponseReady;
		await store.started;
		mutable.accessToken = "access-replaced-in-place";
		mutable.refreshToken = "refresh-replaced-in-place";
		store.getShouldFail = true;
		store.releaseGet();
		const error = await pending;

		expect((error as GatewayClientError).code).toBe("session_store_error");
		expect(refreshes).toBe(0);
		expect(store.session).toBe(mutable);
		expect(store.clears).toBe(0);
	});

	test("a subject-bound 401 never adopts an unrelated same-user replacement", async () => {
		const store = new MemorySessionStore(oldSession);
		let release: (() => void) | undefined;
		let started: (() => void) | undefined;
		const requestStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const responseReleased = new Promise<void>((resolve) => {
			release = resolve;
		});
		const authorizations: Array<string | null> = [];
		const client = clientWith(store, async (input, init) => {
			authorizations.push(new Headers(init?.headers).get("authorization"));
			if (String(input).endsWith("/auth/refresh")) {
				return jsonResponse(500, errorBody());
			}
			started?.();
			await responseReleased;
			return jsonResponse(401, errorBody());
		});
		const subject = await client.sessionSubject();
		if (!subject) throw new Error("session subject missing");

		const pending = captured(
			client.requestAsUser(subject, "eventsGet", {
				path: { rootEventId: "evt_root", eventId: "evt_subject-401" },
			}),
		);
		await requestStarted;
		store.session = newSession;
		release?.();
		const error = await pending;

		expect((error as GatewayClientError).code).toBe("session_changed");
		expect(authorizations).toEqual(["Bearer access-old-secret"]);
	});

	test("a subject-bound 401 rejects a refresh-token-only replacement", async () => {
		const store = new MemorySessionStore(oldSession);
		const externalReplacement = sessionForUser(
			oldSession.accessToken,
			"refresh-external-only",
			oldSession.user.id,
		);
		let release: (() => void) | undefined;
		let started: (() => void) | undefined;
		const requestStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const responseReleased = new Promise<void>((resolve) => {
			release = resolve;
		});
		let refreshes = 0;
		let eventRequests = 0;
		const authorizations: Array<string | null> = [];
		const client = clientWith(store, async (input, init) => {
			if (String(input).endsWith("/auth/refresh")) {
				refreshes += 1;
				return jsonResponse(200, newSession);
			}
			eventRequests += 1;
			authorizations.push(new Headers(init?.headers).get("authorization"));
			if (eventRequests === 1) {
				started?.();
				await responseReleased;
				return jsonResponse(401, errorBody());
			}
			return jsonResponse(200, eventResponse("must-not-retry"));
		});
		const subject = await client.sessionSubject();
		if (!subject) throw new Error("session subject missing");

		const pending = captured(
			client.requestAsUser(subject, "eventsGet", {
				path: {
					rootEventId: "evt_root",
					eventId: "evt_refresh-token-only",
				},
			}),
		);
		await requestStarted;
		store.session = externalReplacement;
		release?.();
		const error = await pending;

		expect((error as GatewayClientError).code).toBe("session_changed");
		expect(refreshes).toBe(0);
		expect(store.session).toBe(externalReplacement);
		expect(authorizations).toEqual(["Bearer access-old-secret"]);
	});

	test("a subject advances only through its own verified refresh rotation", async () => {
		const store = new MemorySessionStore(oldSession);
		const client = clientWith(store, async (input, init) => {
			if (String(input).endsWith("/auth/refresh")) {
				return jsonResponse(200, newSession);
			}
			return new Headers(init?.headers).get("authorization") ===
				"Bearer access-old-secret"
				? jsonResponse(401, errorBody())
				: jsonResponse(200, eventResponse("subject-refreshed"));
		});
		const subject = await client.sessionSubject();
		if (!subject) throw new Error("session subject missing");

		const response = await client.requestAsUser(subject, "eventsGet", {
			path: { rootEventId: "evt_root", eventId: "evt_subject-refreshed" },
		});

		expect(response.data.event.id).toBe("evt_subject-refreshed");
		expect(store.session).toEqual(newSession);
		await expect(client.assertSessionSubject(subject)).resolves.toBeUndefined();
	});

	test("a subject-bound request never joins an ordinary unverified refresh flight", async () => {
		const store = new MemorySessionStore(oldSession);
		const externalReplacement = sessionForUser(
			"access-external-same-user",
			"refresh-external-same-user",
			oldSession.user.id,
		);
		let releaseRefresh: (() => void) | undefined;
		let refreshStarted: (() => void) | undefined;
		const refreshInFlight = new Promise<void>((resolve) => {
			refreshStarted = resolve;
		});
		const refreshReleased = new Promise<void>((resolve) => {
			releaseRefresh = resolve;
		});
		const eventAuthorizations: Array<string | null> = [];
		const client = clientWith(store, async (input, init) => {
			if (String(input).endsWith("/auth/refresh")) {
				refreshStarted?.();
				await refreshReleased;
				return jsonResponse(200, newSession);
			}
			const authorization = new Headers(init?.headers).get("authorization");
			eventAuthorizations.push(authorization);
			return authorization === "Bearer access-external-same-user"
				? jsonResponse(200, eventResponse("ordinary-after-external"))
				: jsonResponse(401, errorBody());
		});
		const subject = await client.sessionSubject();
		if (!subject) throw new Error("session subject missing");

		const ordinary = client.request("eventsGet", {
			path: { rootEventId: "evt_root", eventId: "evt_ordinary" },
		});
		await refreshInFlight;
		const exactError = await captured(
			client.requestAsUser(subject, "eventsGet", {
				path: { rootEventId: "evt_root", eventId: "evt_exact" },
			}),
		);
		expect((exactError as GatewayClientError).code).toBe("session_changed");

		store.session = externalReplacement;
		releaseRefresh?.();
		expect((await ordinary).data.event.id).toBe("evt_ordinary-after-external");
		expect(eventAuthorizations).toEqual([
			"Bearer access-old-secret",
			"Bearer access-old-secret",
			"Bearer access-external-same-user",
		]);
	});

	test("a subject-bound refresh fails closed when exact CAS loses", async () => {
		const store = new MemorySessionStore(oldSession);
		const externalReplacement = sessionForUser(
			"access-external-cas-loss",
			"refresh-external-cas-loss",
			oldSession.user.id,
		);
		let releaseRefresh: (() => void) | undefined;
		let refreshStarted: (() => void) | undefined;
		const refreshInFlight = new Promise<void>((resolve) => {
			refreshStarted = resolve;
		});
		const refreshReleased = new Promise<void>((resolve) => {
			releaseRefresh = resolve;
		});
		const eventAuthorizations: Array<string | null> = [];
		const client = clientWith(store, async (input, init) => {
			if (String(input).endsWith("/auth/refresh")) {
				refreshStarted?.();
				await refreshReleased;
				return jsonResponse(200, newSession);
			}
			eventAuthorizations.push(new Headers(init?.headers).get("authorization"));
			return jsonResponse(401, errorBody());
		});
		const subject = await client.sessionSubject();
		if (!subject) throw new Error("session subject missing");

		const pending = captured(
			client.requestAsUser(subject, "eventsGet", {
				path: { rootEventId: "evt_root", eventId: "evt_exact-cas-loss" },
			}),
		);
		await refreshInFlight;
		store.session = externalReplacement;
		releaseRefresh?.();
		const error = await pending;

		expect((error as GatewayClientError).code).toBe("session_changed");
		expect(store.session).toBe(externalReplacement);
		expect(eventAuthorizations).toEqual(["Bearer access-old-secret"]);
	});

	test("a failed old-account refresh cannot clear the new account", async () => {
		const store = new MemorySessionStore(oldSession);
		let releaseRefresh: ((response: Response) => void) | undefined;
		let refreshStarted = false;
		const client = clientWith(store, async (input) => {
			if (String(input).endsWith("/auth/refresh")) {
				refreshStarted = true;
				return new Promise<Response>((resolve) => {
					releaseRefresh = resolve;
				});
			}
			return jsonResponse(401, errorBody());
		});

		const request = client.request("eventsGet", {
			path: { rootEventId: "root", eventId: "event" },
		});
		await eventually(() => refreshStarted);
		store.session = otherSession;
		releaseRefresh?.(jsonResponse(401, errorBody()));
		const error = await captured(request);

		expect((error as GatewayClientError).code).toBe("session_changed");
		expect(store.session).toBe(otherSession);
		expect(store.clears).toBe(0);
	});

	test("a delayed retry 401 cannot clear an account selected after refresh", async () => {
		const store = new MemorySessionStore(oldSession);
		let releaseRetry: ((response: Response) => void) | undefined;
		let retryStarted = false;
		const client = clientWith(store, async (input, init) => {
			const url = String(input);
			const authorization = new Headers(init?.headers).get("authorization");
			if (url.endsWith("/auth/refresh")) return jsonResponse(200, newSession);
			if (authorization === "Bearer access-old-secret") {
				return jsonResponse(401, errorBody());
			}
			retryStarted = true;
			return new Promise<Response>((resolve) => {
				releaseRetry = resolve;
			});
		});

		const request = client.request("eventsGet", {
			path: { rootEventId: "root", eventId: "event" },
		});
		await eventually(() => retryStarted);
		store.session = otherSession;
		releaseRetry?.(jsonResponse(401, errorBody()));
		const error = await captured(request);

		expect((error as GatewayClientError).code).toBe("session_changed");
		expect(store.session).toBe(otherSession);
		expect(store.clears).toBe(0);
	});

	test("a failed persistent clear still invalidates the rejected session locally", async () => {
		const store = new MemorySessionStore(oldSession);
		store.clearShouldFail = true;
		let fetches = 0;
		const client = clientWith(store, async (input) => {
			fetches += 1;
			return String(input).endsWith("/auth/refresh")
				? jsonResponse(401, errorBody())
				: jsonResponse(401, errorBody());
		});

		await captured(
			client.request("eventsGet", {
				path: { rootEventId: "root", eventId: "first" },
			}),
		);
		const fetchesAfterFailure = fetches;
		const secondError = await captured(
			client.request("eventsGet", {
				path: { rootEventId: "root", eventId: "second" },
			}),
		);

		expect(store.session).toBe(oldSession);
		expect(store.clears).toBe(1);
		expect(fetches).toBe(fetchesAfterFailure);
		expect((secondError as GatewayClientError).code).toBe("unauthenticated");
	});
});

describe("GatewayClient success contract", () => {
	test("accepts nullable feedback objects and the initial null status", async () => {
		const client = clientWith(new MemorySessionStore(oldSession), async () =>
			jsonResponse(200, feedbackResponse()),
		);
		const response = await client.request("feedbackGet", {
			path: { feedbackId: "fbk_contract" },
		});

		expect(response.data.feedback).toMatchObject({
			id: "fbk_contract",
			context: null,
			diagnostics: { deviceModel: "iPhone" },
			statusHistory: [
				{ fromStatus: null, toStatus: "open" },
				{ fromStatus: "open", toStatus: "planned" },
			],
		});
	});

	test("strictly rejects identity fields and incomplete community details", async () => {
		const valid = communityFeedbackResponse();
		const accepted = clientWith(new MemorySessionStore(oldSession), async () =>
			jsonResponse(200, valid),
		);
		expect(
			(
				await accepted.request("eventFeedbackGet", {
					path: {
						rootEventId: "evt_root",
						feedbackId: "fbk_community_contract",
					},
				})
			).data.feedback.id,
		).toBe("fbk_community_contract");

		const invalidBodies = [
			{
				...valid,
				feedback: { ...valid.feedback, authorUserId: oldSession.user.id },
			},
			{
				...valid,
				feedback: { ...valid.feedback, diagnostics: { platform: "ios" } },
			},
			{
				...valid,
				feedback: { ...valid.feedback, unknown: "must be rejected" },
			},
			{
				...valid,
				feedback: { ...valid.feedback, comments: undefined },
			},
			{
				...valid,
				feedback: { ...valid.feedback, statusHistory: undefined },
			},
		];
		for (const body of invalidBodies) {
			const client = clientWith(new MemorySessionStore(oldSession), async () =>
				jsonResponse(200, body),
			);
			const error = await captured(
				client.request("eventFeedbackGet", {
					path: {
						rootEventId: "evt_root",
						feedbackId: "fbk_community_contract",
					},
				}),
			);
			expect((error as GatewayClientError).code).toBe("invalid_response");
		}
	});

	test("strictly rejects extra duplicate-suggestion fields", async () => {
		const base = {
			id: "fbk_mobile_duplicate",
			title: "Check-in flow",
			status: "open",
			voteCount: 3,
		};
		for (const item of [
			{ ...base, body: "must not cross" },
			{ ...base, authorUserId: oldSession.user.id },
			{ ...base, diagnostics: { platform: "ios" } },
			{ ...base, attachmentIds: ["att_private"] },
			{ ...base, rootEventId: "evt_private" },
		]) {
			const client = clientWith(new MemorySessionStore(oldSession), async () =>
				jsonResponse(200, {
					items: [item],
					pageInfo: { nextCursor: null, hasMore: false },
				}),
			);
			const error = await captured(
				client.request("eventFeedbackDuplicateSuggestionsList", {
					path: { rootEventId: "evt_mobile_duplicates" },
					query: { q: "check in" },
				}),
			);
			expect((error as GatewayClientError).code).toBe("invalid_response");
		}
	});

	test("rejects empty, unlisted and structurally invalid JSON successes", async () => {
		for (const response of [
			new Response(null, { status: 200 }),
			new Response(JSON.stringify(eventResponse("event")), {
				status: 299,
				headers: { "Content-Type": "application/json" },
			}),
			jsonResponse(200, { event: { id: "event" } }),
		]) {
			const client = clientWith(new MemorySessionStore(oldSession), async () =>
				response.clone(),
			);
			const error = await captured(
				client.request("eventsGet", {
					path: { rootEventId: "root", eventId: "event" },
				}),
			);

			expect((error as GatewayClientError).code).toBe("invalid_response");
		}
	});

	test("rejects a valid JSON shape under the wrong media type", async () => {
		const client = clientWith(
			new MemorySessionStore(oldSession),
			async () =>
				new Response(JSON.stringify(eventResponse("event")), {
					status: 200,
					headers: { "Content-Type": "text/plain" },
				}),
		);
		const error = await captured(
			client.request("eventsGet", {
				path: { rootEventId: "root", eventId: "event" },
			}),
		);

		expect((error as GatewayClientError).code).toBe("invalid_response");
	});

	test("accepts a contract-declared empty 204 response", async () => {
		const client = clientWith(
			new MemorySessionStore(oldSession),
			async () => new Response(null, { status: 204 }),
		);
		const response = await client.request("identitySessionsRevoke", {});

		expect(response.status).toBe(204);
		expect(response.data).toBeUndefined();
	});
});

describe("GatewayClient cancellation and diagnostics", () => {
	test("rejects share tokens as correlation or idempotency identifiers before fetch", async () => {
		const token = `crs_${"S".repeat(43)}`;
		let fetches = 0;
		const fetchImplementation = (async () => {
			fetches += 1;
			return jsonResponse(500, {});
		}) as unknown as typeof fetch;

		const correlationError = await captured(
			new GatewayClient({
				baseUrl: "https://gateway.test",
				sessionStore: new MemorySessionStore(null),
				requestId: () => token,
				fetch: fetchImplementation,
			}).request("eventRecapShareLinksResolve", { body: { token } }),
		);
		expect(correlationError).toBeInstanceOf(TypeError);

		const diagnostics: GatewayDiagnostic[] = [];
		const idempotencyError = await captured(
			new GatewayClient({
				baseUrl: "https://gateway.test",
				sessionStore: new MemorySessionStore(oldSession),
				requestId: () => "request-00000001",
				idempotencyKey: () => token,
				onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
				fetch: fetchImplementation,
			}).request("eventRecapShareLinksCreate", {
				path: { rootEventId: "evt_root" },
				body: {
					recapVersion: 3,
					projectionConsent: "title-only-reviewed",
				},
			}),
		);
		expect(idempotencyError).toMatchObject({ code: "invalid_request" });
		expect(fetches).toBe(0);
		expect(
			JSON.stringify({ correlationError, idempotencyError, diagnostics }),
		).not.toContain(token);
	});

	test("rejects responses whose request ID is missing, malformed or belongs to another request", async () => {
		for (const responseRequestId of [
			null,
			"bad request id",
			"different-request-0001",
		]) {
			const diagnostics: GatewayDiagnostic[] = [];
			const client = new GatewayClient({
				baseUrl: "https://gateway.test",
				sessionStore: new MemorySessionStore(null),
				requestId: () => "request-00000001",
				idempotencyKey: () => "idempotency-0001",
				onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
				fetch: (async (_input: string | URL | Request, _init?: RequestInit) =>
					new Response(JSON.stringify({ accepted: true }), {
						status: 202,
						headers: {
							"Content-Type": "application/json",
							...(responseRequestId
								? { "X-Request-ID": responseRequestId }
								: {}),
						},
					})) as typeof fetch,
			});

			const error = (await captured(
				client.request("identityMagicLinksCreate", {
					body: { email: "crew@example.com" },
				}),
			)) as GatewayClientError;
			expect(error).toMatchObject({
				code: "invalid_response",
				requestId: "request-00000001",
			});
		}
	});

	test("the timeout covers a response body that never completes", async () => {
		const client = clientWith(new MemorySessionStore(null), async () => {
			return new Response(new ReadableStream({ start() {} }), { status: 202 });
		});

		const error = await captured(
			client.request("identityMagicLinksCreate", {
				body: { email: "crew@example.com" },
				timeoutMs: 20,
			}),
		);

		expect(error).toBeInstanceOf(GatewayClientError);
		expect((error as GatewayClientError).code).toBe("timeout");
	});

	test("a caller abort stops an in-flight fetch", async () => {
		const controller = new AbortController();
		const client = clientWith(
			new MemorySessionStore(null),
			async () => new Promise<Response>(() => undefined),
		);
		setTimeout(() => controller.abort(), 10);

		const error = await captured(
			client.request("identityMagicLinksCreate", {
				body: { email: "crew@example.com" },
				signal: controller.signal,
			}),
		);

		expect(error).toBeInstanceOf(GatewayClientError);
		expect((error as GatewayClientError).code).toBe("aborted");
	});

	test("raw error bodies and tokens never enter errors or diagnostics", async () => {
		const diagnostics: GatewayDiagnostic[] = [];
		const client = clientWith(
			new MemorySessionStore(oldSession),
			async () =>
				new Response(
					JSON.stringify({
						error: {
							code: "REFRESH_SUPERSECRET123456789",
							message:
								"top-secret-raw-message access-old-secret refresh-old-secret crew@example.com +41790000000",
							requestId: "refresh-old-secret",
							retryable: true,
						},
					}),
					{
						status: 500,
						headers: {
							"Content-Type": "application/json",
							"X-Request-ID": "refresh-old-secret",
						},
					},
				),
			diagnostics,
		);

		const error = await captured(
			client.request("eventsGet", {
				path: { rootEventId: "root", eventId: "event" },
			}),
		);
		const serialized = `${String(error)}${JSON.stringify({ error, diagnostics })}`;

		expect(serialized).not.toContain("access-old-secret");
		expect(serialized).not.toContain("refresh-old-secret");
		expect(serialized).not.toContain("top-secret-raw-message");
		expect(serialized).not.toContain("REFRESH_SUPERSECRET123456789");
		expect(serialized).not.toContain("crew@example.com");
		expect(serialized).not.toContain("+41790000000");
		expect((error as GatewayClientError).requestId).toBe("request-00000001");
		expect(diagnostics[0]).toMatchObject({
			operationId: "eventsGet",
			status: 500,
			code: "invalid_response",
			retryable: false,
		});
	});

	test("session-store failures are converted to safe client errors", async () => {
		const store = new MemorySessionStore(oldSession);
		store.getShouldFail = true;
		const diagnostics: GatewayDiagnostic[] = [];
		const client = clientWith(
			store,
			async () => {
				throw new Error("fetch must not run");
			},
			diagnostics,
		);

		const error = (await captured(
			client.request("eventsGet", {
				path: { rootEventId: "root", eventId: "event" },
			}),
		)) as GatewayClientError;

		expect(error.code).toBe("session_store_error");
		expect(JSON.stringify({ error, diagnostics })).not.toContain(
			"access-old-secret",
		);
	});

	test("validated gateway error context includes code, request ID and bounded Retry-After", async () => {
		const diagnostics: GatewayDiagnostic[] = [];
		const client = clientWith(
			new MemorySessionStore(null),
			async () =>
				new Response(
					JSON.stringify({
						error: {
							code: "IDEMPOTENCY_KEY_REUSED",
							message: "ignored raw message",
							requestId: "ignored-body-request",
							retryable: true,
						},
					}),
					{
						status: 429,
						headers: {
							"Content-Type": "application/json",
							"Retry-After": "17",
							"X-Request-ID": "request-00000001",
						},
					},
				),
			diagnostics,
		);

		const error = (await captured(
			client.request("identityMagicLinksCreate", {
				body: { email: "crew@example.com" },
			}),
		)) as GatewayClientError;

		expect(error).toMatchObject({
			code: "IDEMPOTENCY_KEY_REUSED",
			requestId: "request-00000001",
			retryable: true,
			retryAfterSeconds: 17,
		});
		expect(diagnostics[0]).toMatchObject({
			code: "IDEMPOTENCY_KEY_REUSED",
			requestId: "request-00000001",
			retryAfterSeconds: 17,
		});
	});
});

function clientWith(
	store: SessionStore,
	fetchImplementation: (
		input: string | URL | Request,
		init?: RequestInit,
	) => Promise<Response>,
	diagnostics?: GatewayDiagnostic[],
): GatewayClient {
	let requestNumber = 0;
	return new GatewayClient({
		baseUrl: "https://gateway.test",
		sessionStore: store,
		fetch: (async (input, init) => {
			const response = await fetchImplementation(input, init);
			if (response.headers.has("X-Request-ID")) return response;
			const requestId = new Headers(init?.headers).get("X-Request-ID");
			if (!requestId) return response;
			const headers = new Headers(response.headers);
			headers.set("X-Request-ID", requestId);
			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers,
			});
		}) as typeof fetch,
		requestId: () => `request-${String(++requestNumber).padStart(8, "0")}`,
		idempotencyKey: () => "idempotency-0001",
		...(diagnostics
			? {
					onDiagnostic: (diagnostic: GatewayDiagnostic) =>
						diagnostics.push(diagnostic),
				}
			: {}),
	});
}

function session(accessToken: string, refreshToken: string): Session {
	return sessionForUser(
		accessToken,
		refreshToken,
		"usr_0123456789abcdef0123456789abcdef",
	);
}

function sessionForUser(
	accessToken: string,
	refreshToken: string,
	userId: string,
): Session {
	return {
		accessToken,
		refreshToken,
		tokenType: "Bearer",
		expiresInSeconds: 300,
		user: {
			id: userId,
			email: "crew@example.com",
			profile: {
				displayName: "Crew",
				avatarUrl: null,
				locale: "de-CH",
				timeZone: "Europe/Zurich",
				reduceMotion: false,
				eventReminders: true,
				productUpdates: false,
				version: 1,
				updatedAt: "2026-07-18T00:00:00.000Z",
			},
		},
	};
}

function sameStoredSession(
	left: Session | null,
	right: Session | null,
): boolean {
	if (!left || !right) return left === right;
	return (
		left.user.id === right.user.id &&
		left.accessToken === right.accessToken &&
		left.refreshToken === right.refreshToken
	);
}

function eventResponse(id: string): unknown {
	return {
		event: {
			id: `evt_${id}`,
			rootEventId: "evt_root",
			parentEventId: null,
			kind: "trip",
			title: "Crew event",
			description: null,
			timeZone: "Europe/Zurich",
			startsAt: null,
			endsAt: null,
			sortKey: "1",
			childOrderVersion: 1,
			itineraryOrderVersion: 1,
			status: "draft",
			version: 1,
			createdAt: "2026-07-18T00:00:00.000Z",
			updatedAt: "2026-07-18T00:00:00.000Z",
		},
	};
}

function feedbackResponse(): unknown {
	return {
		feedback: {
			id: "fbk_contract",
			title: "Search needs filters",
			body: "Let the community filter open feedback.",
			visibility: "public",
			context: null,
			diagnostics: { deviceModel: "iPhone" },
			authorUserId: "usr_0123456789abcdef0123456789abcdef",
			status: "planned",
			duplicateOfFeedbackId: null,
			version: 1,
			voteCount: 3,
			viewerHasVoted: false,
			attachments: [],
			comments: [],
			commentCount: 0,
			commentsHasMore: false,
			statusHistory: [
				{
					version: 1,
					fromStatus: null,
					toStatus: "open",
					changedBy: "usr_0123456789abcdef0123456789abcdef",
					note: null,
					changedAt: "2026-07-19T08:00:00.000Z",
				},
				{
					version: 2,
					fromStatus: "open",
					toStatus: "planned",
					changedBy: "usr_0123456789abcdef0123456789abcdef",
					note: "Scheduled",
					changedAt: "2026-07-19T09:00:00.000Z",
				},
			],
			statusHistoryCount: 2,
			statusHistoryHasMore: false,
			createdAt: "2026-07-19T08:00:00.000Z",
			updatedAt: "2026-07-19T08:00:00.000Z",
		},
	};
}

function communityFeedbackResponse() {
	return {
		feedback: {
			id: "fbk_community_contract",
			title: "Community feedback",
			body: "A sanitized detail projection.",
			status: "open",
			version: 1,
			voteCount: 2,
			duplicateCount: 0,
			viewerHasVoted: true,
			followed: false,
			createdAt: "2026-07-19T08:00:00.000Z",
			updatedAt: "2026-07-19T08:00:00.000Z",
			comments: [],
			commentCount: 0,
			commentsHasMore: false,
			statusHistory: [
				{
					version: 1,
					fromStatus: null,
					toStatus: "open",
					note: null,
					changedAt: "2026-07-19T08:00:00.000Z",
				},
			],
			statusHistoryCount: 1,
			statusHistoryHasMore: false,
		},
		redirectedFromFeedbackId: null,
	};
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function errorBody(): unknown {
	return {
		error: {
			code: "unauthenticated",
			message: "Authentication required",
			requestId: "server-request-0001",
			retryable: false,
		},
	};
}

async function captured(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
		throw new Error("Expected request to fail");
	} catch (error) {
		return error;
	}
}

async function eventually(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 1_000;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Condition was not met");
		await Bun.sleep(1);
	}
}
