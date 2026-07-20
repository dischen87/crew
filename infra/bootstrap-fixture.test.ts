import { describe, expect, test } from "bun:test";
import {
	bootstrapFixture,
	type FixtureConfig,
	fixtureLogSummary,
	fixtureOfflineFlows,
} from "./bootstrap-fixture";

const config: FixtureConfig = {
	gatewayUrl: "http://api-gateway:3000/core/v1/",
	providerSinkUrl: "http://provider-sink:3010/",
	providerSinkFixtureBearer: "fixture-bearer-local-test",
	localFixtureEnabled: true,
};
const token = `ml_${"a".repeat(43)}`;
const accessToken = "private-access-token";
const organizerToken = `ml_${"b".repeat(43)}`;
const organizerAccessToken = "private-organizer-access-token";
const participantToken = `ml_${"c".repeat(43)}`;
const participantAccessToken = "private-participant-access-token";
const user = {
	id: `usr_${"a".repeat(32)}`,
	email: "crew.local@example.test",
	profile: {
		displayName: null,
		avatarUrl: null,
		locale: "de-CH",
		timeZone: "Europe/Zurich",
		reduceMotion: false,
		eventReminders: true,
		productUpdates: false,
		version: 1,
		updatedAt: "2026-07-18T12:00:00.000Z",
	},
};
const eventIds = [
	"evt_local_turkey_golf_2026",
	"evt_local_turkey_golf_2026_arrival",
	"evt_local_turkey_golf_2026_lodging",
	"evt_local_turkey_golf_2026_round",
	"evt_local_turkey_golf_2026_round_gloria",
	"evt_local_turkey_golf_2026_round_montgomerie",
	"evt_local_turkey_golf_2026_round_national",
	"evt_local_turkey_golf_2026_round_sueno",
];
const organizerUser = {
	...user,
	id: `usr_${"b".repeat(32)}`,
	email: "crew.golf.organizer.local@example.test",
};
const participantUser = {
	...user,
	id: `usr_${"c".repeat(32)}`,
	email: "crew.golf.participant.local@example.test",
};
const courseCandidates = [
	[
		"pcd_1e13ca178f90af118e97f076d7d6811c707d37c293d1bc5fa92f653f66f2e92d",
		"Carya Golf Club",
		"way/169450196",
	],
	[
		"pcd_a28d40b066df83f51263114f4643e913abe67eb9e8463e9a1e56c77c491d4013",
		"Gloria Golf Club",
		"way/169451380",
	],
	[
		"pcd_08cff91c182b33817c8536a8c55bfd540268b289414922a9dc078146fc594894",
		"The Montgomerie Maxx Royal Golf Club",
		"way/169451379",
	],
	[
		"pcd_1ea7bde672b7f92d70ecff1c7b09e86efca6f6ff936c2035adeb917948cf779d",
		"National Golf Club",
		"way/126258746",
	],
	[
		"pcd_3f08b614bbee6d3665cae3efb205dd95685f40d9b22e4d0fe82fc074bf793fd8",
		"Sueno Hotels Golf Belek",
		"relation/3872398",
	],
] as const;
const root = {
	rootEventId: eventIds[0],
	rootRevision: "1",
	events: eventIds.map((id) => ({ id })),
	capabilities: [
		{
			rootEventId: eventIds[0],
			eventId: eventIds[0],
			type: "travel",
			schemaVersion: 1,
		},
		{
			rootEventId: eventIds[0],
			eventId: eventIds[1],
			type: "transport",
			schemaVersion: 1,
		},
		{
			rootEventId: eventIds[0],
			eventId: eventIds[2],
			type: "lodging",
			schemaVersion: 1,
		},
		{
			rootEventId: eventIds[0],
			eventId: eventIds[3],
			type: "golf",
			schemaVersion: 1,
		},
		...eventIds.slice(4).map((eventId) => ({
			rootEventId: eventIds[0],
			eventId,
			type: "golf",
			schemaVersion: 1,
		})),
	],
};
const createdRoot = {
	event: { id: eventIds[0], rootEventId: eventIds[0] },
};
const updatedProfile = {
	...user.profile,
	displayName: "Local Crew Organizer",
	version: 2,
};
const teamRootEventId = "evt_local_team_day_2026";
const teamEventIds = [
	teamRootEventId,
	"evt_local_team_day_2026_workshop_one",
	"evt_local_team_day_2026_challenge",
	"evt_local_team_day_2026_arrival",
	"evt_local_team_day_2026_workshop_two",
	"evt_local_team_day_2026_lunch",
	"evt_local_team_day_2026_decisions",
	"evt_local_team_day_2026_wrap_up",
];
const teamUser = {
	...user,
	email: "crew.team.local@example.test",
};
const teamParticipantToken = `ml_${"d".repeat(43)}`;
const teamParticipantAccessToken = "private-team-participant-access-token";
const teamParticipantUser = {
	...user,
	id: `usr_${"d".repeat(32)}`,
	email: "crew.team.participant.local@example.test",
};

function json(value: unknown, replay = false, status = 200) {
	return new Response(JSON.stringify(value), {
		status,
		headers: {
			"Content-Type": "application/json",
			...(replay ? { "Idempotency-Replayed": "true" } : {}),
		},
	});
}

function echoRequestIds(
	fetcher: (
		input: string | URL | Request,
		init?: RequestInit,
	) => Promise<Response>,
) {
	return async (input: string | URL | Request, init?: RequestInit) => {
		const response = await fetcher(input, init);
		const requestId = new Headers(init?.headers).get("X-Request-ID");
		if (!requestId) return response;
		const headers = new Headers(response.headers);
		headers.set("X-Request-ID", requestId);
		return new Response(response.body, {
			headers,
			status: response.status,
			statusText: response.statusText,
		});
	};
}

describe("local API fixture bootstrap", () => {
	test("authenticates and creates a deterministic golf tour through APIs with exact replay", async () => {
		const createdEvents: Record<string, unknown>[] = [];
		const places: Record<string, unknown>[] = [];
		const itinerary: Record<string, unknown>[] = [];
		const invitations: Record<string, unknown>[] = [];
		const memberships: Record<string, unknown>[] = [
			{ userId: user.id, role: "owner", status: "active" },
		];
		let golfRoundSetup: Record<string, unknown> | undefined;
		let golfScoreApplied = false;
		const fetcher = async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			const url = new URL(String(input));
			const key = `${init?.method ?? "GET"} ${url.pathname}`;
			const headers = new Headers(init?.headers);
			const body = init?.body
				? (JSON.parse(String(init.body)) as Record<string, unknown>)
				: undefined;
			const replay = (headers.get("X-Request-ID") ?? "").includes(".replay.");
			if (key === "POST /internal/magic-links/consume") {
				expect(headers.get("Authorization")).toBe(
					"Bearer fixture-bearer-local-test",
				);
				const delivered = new Map([
					[user.email, token],
					[organizerUser.email, organizerToken],
					[participantUser.email, participantToken],
				]).get(String(body?.email));
				if (!delivered) throw new Error("Unknown fixture email");
				return json({ token: delivered });
			}
			if (key === "POST /core/v1/auth/magic-links") {
				expect(headers.get("Authorization")).toBeNull();
				return json({ accepted: true }, replay, 202);
			}
			if (key === "POST /core/v1/auth/magic-links/redeem") {
				const session = new Map([
					[token, { accessToken, user }],
					[
						organizerToken,
						{ accessToken: organizerAccessToken, user: organizerUser },
					],
					[
						participantToken,
						{ accessToken: participantAccessToken, user: participantUser },
					],
				]).get(String(body?.token));
				if (!session) throw new Error("Unknown fixture token");
				return json(
					{
						...session,
						refreshToken: "private-refresh-token",
						tokenType: "Bearer",
						expiresInSeconds: 900,
					},
					replay,
				);
			}
			if (key === "GET /core/v1/me") return json(user);
			if (key === "PATCH /core/v1/me") {
				expect(body?.baseVersion).toBe(1);
				return json(updatedProfile, replay);
			}
			if (key === "POST /core/v1/event-roots") {
				expect(body?.status).toBe("draft");
				expect(body?.template).toEqual({
					id: "golf-tour",
					version: 1,
					eventIds: {
						root: eventIds[0],
						arrival: eventIds[1],
						lodging: eventIds[2],
						round: eventIds[3],
					},
				});
				return json(createdRoot, replay, 201);
			}
			if (key === "GET /core/v1/places/search") {
				const query = url.searchParams.get("q")?.toLowerCase() ?? "";
				const index = [
					"carya",
					"gloria",
					"montgomerie",
					"national",
					"sueno",
				].findIndex((name) => query.includes(name));
				const candidate = courseCandidates[index];
				if (!candidate) throw new Error("Unknown course query");
				const [id, name, sourceRecordId] = candidate;
				return json({
					items: [
						{
							id,
							kind: "golf_course",
							name,
							locality: "Belek",
							countryCode: "TR",
							latitude: 36.86,
							longitude: 31.02,
							source: "osm",
							sourceRecordUrl: `https://www.openstreetmap.org/${sourceRecordId}`,
							licenseCode: "ODbL-1.0",
							attribution: "© OpenStreetMap contributors",
						},
					],
					pageInfo: { hasMore: false, nextCursor: null },
				});
			}
			if (
				key.startsWith("PATCH /core/v1/event-roots/") &&
				key.includes("/events/")
			) {
				return json({ event: body?.changes }, replay);
			}
			if (key === `POST /core/v1/event-roots/${eventIds[0]}/events`) {
				if (!replay && body) createdEvents.push(body);
				return json({ event: body }, replay, 201);
			}
			if (key === `POST /core/v1/event-roots/${eventIds[0]}/places`) {
				if (!replay && body) places.push(body);
				return json({ place: body }, replay, 201);
			}
			if (key.includes("/capabilities/")) {
				return json({ capability: body?.capability }, replay);
			}
			if (key === `POST /core/v1/event-roots/${eventIds[0]}/itinerary`) {
				if (!replay && body) itinerary.push(body);
				return json({ item: body }, replay, 201);
			}
			if (key === `POST /core/v1/event-roots/${eventIds[0]}/invitations`) {
				const invitation = body as Record<string, unknown>;
				if (!replay) {
					invitations.push({
						...invitation,
						emailBound: true,
						useCount: 1,
					});
				}
				return json(
					{
						invitation,
						token:
							invitation.role === "organizer"
								? "invite-organizer-token-2026"
								: "invite-participant-token-2026",
					},
					replay,
					201,
				);
			}
			if (key === "POST /core/v1/invitations/redeem") {
				const organizer =
					headers.get("Authorization") === `Bearer ${organizerAccessToken}`;
				const membership = {
					rootEventId: eventIds[0],
					userId: organizer ? organizerUser.id : participantUser.id,
					role: organizer ? "organizer" : "participant",
					status: "active",
				};
				if (!replay) memberships.push(membership);
				return json({ membership }, replay);
			}
			if (key.endsWith("/publish-readiness")) {
				return json({ ready: true, rootVersion: 1, rootRevision: "47" });
			}
			if (key.endsWith("/publish")) {
				return json({ event: { status: "published" } }, replay);
			}
			if (key === "POST /core/v1/sync/push") {
				const mutation = (
					body?.mutations as Record<string, unknown>[] | undefined
				)?.[0];
				if (!mutation) throw new Error("Missing sync mutation");
				if (mutation.kind === "golf.round.replace") {
					expect(headers.get("Authorization")).toBe(`Bearer ${accessToken}`);
					const payload = mutation.payload as Record<string, unknown>;
					expect(payload.eventId).toBe(eventIds[3]);
					expect(payload.holes).toHaveLength(18);
					expect(payload.players).toHaveLength(3);
					expect(payload.teams).toHaveLength(1);
					if (!replay) golfRoundSetup = payload;
					return json(
						{
							protocolVersion: 1,
							rootEventId: eventIds[0],
							deviceId: body?.deviceId,
							results: [
								{
									clientMutationId: mutation.clientMutationId,
									clientSequence: 1,
									outcome: "applied",
									replayed: false,
									rootRevision: "49",
									entity: {
										entityType: "golfRound",
										entityId: eventIds[3],
										version: 1,
									},
								},
							],
							nextExpectedClientSequence: 2,
						},
						replay,
					);
				}
				if (mutation.kind === "golf.score.set") {
					expect(headers.get("Authorization")).toBe(
						`Bearer ${participantAccessToken}`,
					);
					const payload = mutation.payload as Record<string, unknown>;
					expect(payload).toEqual({
						eventId: eventIds[3],
						hole: 1,
						strokes: 4,
						putts: 2,
					});
					if (!replay) golfScoreApplied = true;
					return json(
						{
							protocolVersion: 1,
							rootEventId: eventIds[0],
							deviceId: body?.deviceId,
							results: [
								{
									clientMutationId: mutation.clientMutationId,
									clientSequence: 1,
									outcome: "applied",
									replayed: false,
									rootRevision: "50",
									entity: {
										entityType: "golfScore",
										entityId: mutation.entityId,
										version: 1,
									},
								},
							],
							nextExpectedClientSequence: 2,
						},
						replay,
					);
				}
			}
			if (key.endsWith("/memberships")) {
				return json({
					items: memberships,
					pageInfo: { hasMore: false, nextCursor: null },
				});
			}
			if (key.endsWith("/invitations")) {
				return json({
					items: invitations,
					pageInfo: { hasMore: false, nextCursor: null },
				});
			}
			if (key.endsWith("/places")) {
				return json({
					items: places,
					pageInfo: { hasMore: false, nextCursor: null },
				});
			}
			if (key === "GET /core/v1/sync/bootstrap") {
				if (!golfRoundSetup) throw new Error("Golf round was not configured");
				const participantRead =
					headers.get("Authorization") === `Bearer ${participantAccessToken}`;
				const players = golfRoundSetup.players as Record<string, unknown>[];
				const leaderboard = {
					rootEventId: eventIds[0],
					eventId: eventIds[3],
					version: golfScoreApplied ? 2 : 1,
					entries: players.map((player, index) => ({
						rank:
							golfScoreApplied && player.userId === participantUser.id
								? 1
								: golfScoreApplied
									? index + 2
									: index + 1,
						userId: player.userId,
						teamId: "gtm_local_turkey_golf_carya",
						stablefordPoints:
							golfScoreApplied && player.userId === participantUser.id ? 3 : 0,
						holesCompleted:
							golfScoreApplied && player.userId === participantUser.id ? 1 : 0,
					})),
				};
				const golfRecords = [
					{
						entityType: "golfLeaderboard",
						entityId: `glb_${eventIds[3]}`,
						entityVersion: leaderboard.version,
						data: leaderboard,
					},
					{
						entityType: "golfPlayer",
						entityId: `gpl_${eventIds[3]}:${participantRead ? participantUser.id : user.id}`,
						entityVersion: 1,
						data: {
							rootEventId: eventIds[0],
							eventId: eventIds[3],
							userId: participantRead ? participantUser.id : user.id,
							playingHandicap: participantRead ? 18 : -2,
							version: 1,
						},
					},
					...(participantRead
						? []
						: [
								{
									entityType: "golfRoster",
									entityId: `gro_${eventIds[3]}`,
									entityVersion: 1,
									data: {
										rootEventId: eventIds[0],
										eventId: eventIds[3],
										players,
										version: 1,
										updatedAt: "2026-07-19T12:00:00.000Z",
									},
								},
							]),
					{
						entityType: "golfRound",
						entityId: eventIds[3],
						entityVersion: 1,
						data: {
							rootEventId: eventIds[0],
							eventId: eventIds[3],
							holes: golfRoundSetup.holes,
							teams: golfRoundSetup.teams,
							version: 1,
							updatedAt: "2026-07-19T12:00:00.000Z",
						},
					},
				];
				return json({
					protocolVersion: 1,
					rootEventId: eventIds[0],
					records: [
						...eventIds.map((id) => ({ entityType: "event", data: { id } })),
						...memberships.map((data) => ({ entityType: "membership", data })),
						...invitations.map((data) => ({ entityType: "invitation", data })),
						...places.map((data) => ({ entityType: "place", data })),
						...root.capabilities.map((data) => ({
							entityType: "capability",
							data,
						})),
						...itinerary.map((data) => ({ entityType: "itineraryItem", data })),
						...golfRecords,
					],
					syncCursor: "fixture-golf-sync-cursor",
					pageInfo: { hasMore: false, nextCursor: null },
				});
			}
			if (key === "GET /core/v1/sync/pull") {
				expect(headers.get("Authorization")).toBe(
					`Bearer ${participantAccessToken}`,
				);
				if (!golfScoreApplied) throw new Error("Golf score was not applied");
				const scoreId = `gsc_${eventIds[3]}:${participantUser.id}:1`;
				return json({
					protocolVersion: 1,
					rootEventId: eventIds[0],
					changes: [
						{
							rootRevision: "50",
							ordinal: 0,
							entityType: "golfScore",
							entityId: scoreId,
							entityVersion: 1,
							operation: "upsert",
							data: {
								id: scoreId,
								rootEventId: eventIds[0],
								eventId: eventIds[3],
								userId: participantUser.id,
								hole: 1,
								strokes: 4,
								putts: 2,
								playingHandicap: 18,
								handicapStrokes: 1,
								netStrokes: 3,
								stablefordPoints: 3,
								version: 1,
								rootRevision: "50",
								createdAt: "2026-07-19T12:00:00.000Z",
								updatedAt: "2026-07-19T12:00:00.000Z",
							},
						},
						{
							rootRevision: "50",
							ordinal: 1,
							entityType: "golfLeaderboard",
							entityId: `glb_${eventIds[3]}`,
							entityVersion: 2,
							operation: "upsert",
							data: {
								rootEventId: eventIds[0],
								eventId: eventIds[3],
								version: 2,
								entries: [
									{
										rank: 1,
										userId: participantUser.id,
										teamId: "gtm_local_turkey_golf_carya",
										stablefordPoints: 3,
										holesCompleted: 1,
									},
								],
							},
						},
					],
					checkpointCursor: "fixture-golf-pull-cursor",
					pageInfo: { hasMore: false, nextCursor: null },
				});
			}
			if (key === `GET /core/v1/event-roots/${eventIds[0]}`) {
				return json({ ...root, rootRevision: "48" });
			}
			throw new Error(`Unexpected fixture request ${key}`);
		};

		const result = await bootstrapFixture(config, {
			fetch: echoRequestIds(fetcher),
			sleep: async () => {},
		});
		expect(result).toEqual({
			userId: user.id,
			rootEventId: "evt_local_turkey_golf_2026",
			eventIds,
			organizerUserId: organizerUser.id,
			participantUserId: participantUser.id,
		});
		expect(createdEvents).toHaveLength(4);
		expect(places).toHaveLength(9);
		expect(itinerary).toHaveLength(11);
		expect(invitations).toHaveLength(2);
		expect(memberships).toHaveLength(3);
		expect(golfRoundSetup).toBeDefined();
		expect(golfScoreApplied).toBe(true);
		expect(new Set(places.map((place) => place.id)).size).toBe(9);
		expect(new Set(itinerary.map((item) => item.id)).size).toBe(11);
	});

	test("creates the complete team-day tree, agenda and decision log through the same APIs", async () => {
		const calls = new Map<string, number>();
		const consumeAttempts = new Map<string, number>();
		const requestBodies: unknown[] = [];
		const createdChildIds: string[] = [];
		const agendaItems: Record<string, unknown>[] = [];
		let venue: Record<string, unknown> | undefined;
		let decision: Record<string, unknown> | undefined;
		let participantFeed: Record<string, unknown> | undefined;
		const memberships: Record<string, unknown>[] = [
			{ userId: teamUser.id, role: "owner", status: "active" },
		];
		const fetcher = async (
			input: string | URL | Request,
			init?: RequestInit,
		) => {
			const url = new URL(String(input));
			const key = `${init?.method ?? "GET"} ${url.pathname}`;
			const count = calls.get(key) ?? 0;
			calls.set(key, count + 1);
			const headers = new Headers(init?.headers);
			const body = init?.body
				? (JSON.parse(String(init.body)) as Record<string, unknown>)
				: undefined;
			if (body) requestBodies.push(body);
			const requestId = headers.get("X-Request-ID") ?? "";
			const replay = requestId.includes(".replay.");

			if (key === "POST /internal/magic-links/consume") {
				expect(headers.get("Authorization")).toBe(
					"Bearer fixture-bearer-local-test",
				);
				const email = String(body?.email);
				const attempt = consumeAttempts.get(email) ?? 0;
				consumeAttempts.set(email, attempt + 1);
				const delivered = new Map([
					[teamUser.email, token],
					[teamParticipantUser.email, teamParticipantToken],
				]).get(email);
				if (!delivered) throw new Error("Unknown team fixture email");
				return attempt === 0
					? new Response(JSON.stringify({ error: "not_ready" }), {
							status: 404,
							headers: { "Content-Type": "application/json" },
						})
					: json({ token: delivered });
			}
			if (key === "POST /core/v1/auth/magic-links") {
				const email = String(body?.email);
				expect([teamUser.email, teamParticipantUser.email]).toContain(email);
				expect(headers.get("Idempotency-Key")).toBe(
					email === teamUser.email
						? "fixture.team.auth.start.v1"
						: "fixture.team.participant.auth.start.v1",
				);
				return json({ accepted: true }, replay, 202);
			}
			if (key === "POST /core/v1/auth/magic-links/redeem") {
				const participant = body?.token === teamParticipantToken;
				return json(
					{
						accessToken: participant ? teamParticipantAccessToken : accessToken,
						refreshToken: "private-team-refresh-token",
						tokenType: "Bearer",
						expiresInSeconds: 900,
						user: participant ? teamParticipantUser : teamUser,
					},
					replay,
				);
			}
			if (key === "GET /core/v1/me") return json(teamUser);
			if (key === "PATCH /core/v1/me") {
				return json({ ...updatedProfile, email: teamUser.email }, replay);
			}
			if (key === "POST /core/v1/event-roots") {
				expect(body?.status).toBe("draft");
				expect(body?.template).toEqual({
					id: "team-event",
					version: 1,
					eventIds: {
						root: teamEventIds[0],
						agenda: teamEventIds[1],
						activity: teamEventIds[2],
					},
				});
				return json(
					{ event: { id: teamRootEventId, rootEventId: teamRootEventId } },
					replay,
					201,
				);
			}
			if (
				key.startsWith("PATCH /core/v1/event-roots/") &&
				key.includes("/events/")
			) {
				return json({ event: body?.changes }, replay);
			}
			if (key === `POST /core/v1/event-roots/${teamRootEventId}/events`) {
				if (!replay && body) createdChildIds.push(String(body.id));
				return json({ event: body }, replay, 201);
			}
			if (key === `POST /core/v1/event-roots/${teamRootEventId}/places`) {
				if (!replay) venue = body;
				return json({ place: body }, replay, 201);
			}
			if (key.endsWith("/capabilities/team")) {
				expect(body).toEqual({
					baseVersion: 1,
					capability: {
						type: "team",
						schemaVersion: 1,
						config: {
							venuePlaceId: "plc_local_team_day_venue",
							assignmentMode: "organizer",
							capacityPerTeam: 6,
							facilitator: "Local Crew Organizer",
						},
					},
				});
				return json({ capability: body?.capability }, replay);
			}
			if (key === `POST /core/v1/event-roots/${teamRootEventId}/invitations`) {
				expect(body).toEqual({
					id: "inv_local_team_day_participant",
					role: "participant",
					normalizedEmailHint: teamParticipantUser.email,
					expiresAt: "2035-12-31T23:59:59.000Z",
					maxUses: 1,
				});
				return json(
					{ invitation: body, token: "private-invitation-token" },
					replay,
					201,
				);
			}
			if (key === "POST /core/v1/invitations/redeem") {
				expect(headers.get("Authorization")).toBe(
					`Bearer ${teamParticipantAccessToken}`,
				);
				expect(body).toEqual({ token: "private-invitation-token" });
				const membership = {
					rootEventId: teamRootEventId,
					userId: teamParticipantUser.id,
					role: "participant",
					status: "active",
				};
				if (!replay) memberships.push(membership);
				return json({ membership }, replay);
			}
			if (key === `POST /core/v1/event-roots/${teamRootEventId}/itinerary`) {
				if (!replay && body) agendaItems.push(body);
				return json({ item: body }, replay, 201);
			}
			if (key === `POST /core/v1/event-roots/${teamRootEventId}/feed`) {
				if (!replay) decision = body;
				return json({ entry: body }, replay, 201);
			}
			if (
				key === `GET /core/v1/event-roots/${teamRootEventId}/publish-readiness`
			) {
				return json({ ready: true, rootVersion: 1, rootRevision: "37" });
			}
			if (key === `POST /core/v1/event-roots/${teamRootEventId}/publish`) {
				expect(body).toEqual({ baseVersion: 1, baseRevision: "37" });
				return json({ event: { status: "published" } }, replay);
			}
			if (key === "GET /core/v1/sync/bootstrap") {
				expect(headers.get("Authorization")).toBe(
					`Bearer ${teamParticipantAccessToken}`,
				);
				return json({
					protocolVersion: 1,
					rootEventId: teamRootEventId,
					records: [
						...teamEventIds.map((id) => ({
							entityType: "event",
							data: { id },
						})),
						...memberships.map((data) => ({
							entityType: "membership",
							data,
						})),
					],
					syncCursor: "fixture-team-sync-cursor",
					pageInfo: { hasMore: false, nextCursor: null },
				});
			}
			if (key === "POST /core/v1/sync/push") {
				expect(headers.get("Authorization")).toBe(
					`Bearer ${teamParticipantAccessToken}`,
				);
				const mutation = (
					body?.mutations as Record<string, unknown>[] | undefined
				)?.[0];
				if (!mutation) throw new Error("Missing team sync mutation");
				expect(mutation.kind).toBe("feed.entry.create");
				expect(mutation.payload).toEqual({
					eventId: "evt_local_team_day_2026_decisions",
					parentEntryId: null,
					kind: "message",
					content: "Participant reconnect check: option B is ready.",
				});
				if (!replay) {
					participantFeed = {
						authorUserId: teamParticipantUser.id,
						id: mutation.entityId,
						eventId: "evt_local_team_day_2026_decisions",
						kind: "message",
						body: "Participant reconnect check: option B is ready.",
					};
				}
				return json(
					{
						protocolVersion: 1,
						rootEventId: teamRootEventId,
						deviceId: body?.deviceId,
						results: [
							{
								clientMutationId: mutation.clientMutationId,
								clientSequence: 1,
								outcome: "applied",
								replayed: false,
								rootRevision: "39",
								entity: {
									entityType: "feedEntry",
									entityId: mutation.entityId,
									version: 1,
								},
							},
						],
						nextExpectedClientSequence: 2,
					},
					replay,
				);
			}
			if (key === "GET /core/v1/sync/pull") {
				if (!participantFeed) throw new Error("Team feed was not applied");
				return json({
					protocolVersion: 1,
					rootEventId: teamRootEventId,
					changes: [
						{
							entityType: "feedEntry",
							entityId: participantFeed.id,
							data: {
								...participantFeed,
								actorUserId: teamParticipantUser.id,
								payload: {
									text: "Participant reconnect check: option B is ready.",
								},
							},
						},
					],
					checkpointCursor: "fixture-team-pull-cursor",
					pageInfo: { hasMore: false, nextCursor: null },
				});
			}
			if (key === `GET /core/v1/event-roots/${teamRootEventId}/memberships`) {
				return json({
					items: memberships,
					pageInfo: { hasMore: false, nextCursor: null },
				});
			}
			if (key === `GET /core/v1/event-roots/${teamRootEventId}/places`) {
				return json({
					items: venue ? [venue] : [],
					pageInfo: { hasMore: false, nextCursor: null },
				});
			}
			if (
				key ===
				`GET /core/v1/event-roots/${teamRootEventId}/events/${teamRootEventId}/itinerary`
			) {
				return json({
					items: agendaItems,
					pageInfo: { hasMore: false, nextCursor: null },
				});
			}
			if (key === `GET /core/v1/event-roots/${teamRootEventId}/feed`) {
				return json({
					items: [decision, participantFeed].filter(Boolean),
					pageInfo: { hasMore: false, nextCursor: null },
				});
			}
			if (key === `GET /core/v1/event-roots/${teamRootEventId}`) {
				return json({
					rootEventId: teamRootEventId,
					rootRevision: "37",
					events: teamEventIds.map((id) => ({ id })),
					capabilities: [
						{
							rootEventId: teamRootEventId,
							eventId: teamRootEventId,
							type: "team",
							schemaVersion: 1,
							config: {
								venuePlaceId: "plc_local_team_day_venue",
								assignmentMode: "organizer",
								capacityPerTeam: 6,
								facilitator: "Local Crew Organizer",
							},
						},
					],
				});
			}
			throw new Error(`Unexpected fixture request ${key}`);
		};

		const result = await bootstrapFixture(
			{ ...config, scenario: "team-event" },
			{ fetch: echoRequestIds(fetcher), sleep: async () => {} },
		);
		expect(result).toEqual({
			userId: teamUser.id,
			rootEventId: teamRootEventId,
			eventIds: teamEventIds,
			participantUserId: teamParticipantUser.id,
		});
		expect(agendaItems.map((item) => item.title)).toEqual([
			"Arrival window",
			"Workshop 1",
			"Workshop 2",
			"Lunch",
			"Team challenge",
			"Decisions",
			"Wrap-up",
		]);
		expect(createdChildIds).toEqual([
			"evt_local_team_day_2026_arrival",
			"evt_local_team_day_2026_workshop_two",
			"evt_local_team_day_2026_lunch",
			"evt_local_team_day_2026_decisions",
			"evt_local_team_day_2026_wrap_up",
		]);
		expect(
			calls.get(
				`GET /core/v1/event-roots/${teamRootEventId}/publish-readiness`,
			),
		).toBe(1);
		expect(
			calls.get(`POST /core/v1/event-roots/${teamRootEventId}/publish`),
		).toBe(2);
		const payloads = JSON.stringify(requestBodies);
		expect(payloads).not.toContain('"travel"');
		expect(payloads).not.toContain('"golf"');
		expect(JSON.stringify(result)).not.toContain("private-invitation-token");
		expect(memberships).toHaveLength(2);
		expect(participantFeed?.id).toBe(
			"fed_local_team_day_participant_android_offline",
		);
	});

	test("describes exact iOS and Android queue/reconnect phases without claiming an offline request", () => {
		const flows = (["golf-tour", "team-event"] as const).flatMap((scenario) =>
			fixtureOfflineFlows(scenario),
		);
		expect(
			flows.map(({ scenario, platform }) => `${scenario}:${platform}`).sort(),
		).toEqual([
			"golf-tour:android",
			"golf-tour:ios",
			"team-event:android",
			"team-event:ios",
		]);
		expect(new Set(flows.map(({ deviceId }) => deviceId)).size).toBe(4);
		expect(
			new Set(flows.map(({ clientMutationId }) => clientMutationId)).size,
		).toBe(4);
		for (const flow of flows) {
			expect(flow.actor).toBe("participant");
			expect(flow.phases.map(({ action }) => action)).toEqual([
				"sync.bootstrap",
				"queue.intent",
				"sync.push",
				"sync.push.replay",
				"sync.pull",
			]);
			expect(
				flow.phases.find(({ action }) => action === "queue.intent"),
			).toEqual({
				connectivity: "offline",
				action: "queue.intent",
				requestId: null,
			});
			expect(
				flow.phases
					.filter(({ connectivity }) => connectivity === "online")
					.every(({ requestId }) => requestId?.startsWith("fixture.e2e.")),
			).toBe(true);
		}
		expect(JSON.stringify(flows)).not.toMatch(/token|@|accessToken/i);
	});

	test("refuses disabled or non-local execution before any request", async () => {
		let called = false;
		const fetcher = async () => {
			called = true;
			throw new Error("must not call");
		};
		await expect(
			bootstrapFixture(
				{ ...config, localFixtureEnabled: false },
				{ fetch: fetcher },
			),
		).rejects.toThrow("disabled");
		await expect(
			bootstrapFixture(
				{ ...config, gatewayUrl: "https://api.crew.example/core/v1/" },
				{ fetch: fetcher },
			),
		).rejects.toThrow("not an allowed local");
		expect(called).toBe(false);

		let canceled = false;
		const oversizedFetcher = async () =>
			new Response(
				new ReadableStream({
					pull(controller) {
						controller.enqueue(new Uint8Array(524_289));
					},
					cancel() {
						canceled = true;
					},
				}),
				{ status: 202 },
			);
		await expect(
			bootstrapFixture(config, { fetch: echoRequestIds(oversizedFetcher) }),
		).rejects.toThrow("too much data");
		expect(canceled).toBe(true);
	});

	test("requires the gateway to echo the exact request ID", async () => {
		await expect(
			bootstrapFixture(config, {
				fetch: async () => json({ accepted: true }, false, 202),
			}),
		).rejects.toThrow("did not echo the request ID");
		await expect(
			bootstrapFixture(config, {
				fetch: async () =>
					new Response(JSON.stringify({ accepted: true }), {
						headers: {
							"Content-Type": "application/json",
							"X-Request-ID": "fixture.auth.start.wrong.v1",
						},
						status: 202,
					}),
			}),
		).rejects.toThrow("did not echo the request ID");
	});

	test("summarizes completion without user identifiers or credentials", () => {
		const summary = fixtureLogSummary(
			{
				userId: user.id,
				organizerUserId: organizerUser.id,
				participantUserId: participantUser.id,
				rootEventId: eventIds[0],
				eventIds,
			},
			"golf-tour",
		);
		expect(summary).toEqual({
			scenario: "golf-tour",
			rootEventId: eventIds[0],
			eventCount: 8,
		});
		const serialized = JSON.stringify(summary);
		expect(serialized).not.toContain("usr_");
		expect(serialized).not.toContain("token");
		expect(serialized).not.toContain("@");
	});
});
