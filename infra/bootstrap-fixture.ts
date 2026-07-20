type Fetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export type FixtureConfig = {
	gatewayUrl: string;
	providerSinkUrl: string;
	providerSinkFixtureBearer: string;
	localFixtureEnabled: boolean;
	scenario?: FixtureScenario;
	offlineFlowPlatform?: FixturePlatform | null;
};

export type FixtureScenario = "golf-tour" | "team-event";

export type FixturePlatform = "ios" | "android";

export type FixtureOfflineFlow = {
	scenario: FixtureScenario;
	platform: FixturePlatform;
	actor: "participant";
	rootEventId: string;
	deviceId: string;
	clientMutationId: string;
	phases: readonly {
		connectivity: "online" | "offline";
		action:
			| "sync.bootstrap"
			| "queue.intent"
			| "sync.push"
			| "sync.push.replay"
			| "sync.pull";
		requestId: string | null;
	}[];
	queuedIntent: {
		kind: "golf.score.set" | "feed.entry.create";
		entityId: string;
		payload: Record<string, unknown>;
	};
};

export type FixtureResult = {
	userId: string;
	rootEventId: string;
	eventIds: readonly string[];
	organizerUserId?: string;
	participantUserId?: string;
};

export function fixtureLogSummary(
	result: FixtureResult,
	scenario: FixtureScenario,
) {
	return {
		scenario,
		rootEventId: result.rootEventId,
		eventCount: result.eventIds.length,
	};
}

const golfEmail = "crew.local@example.test";
const golfRootEventId = "evt_local_turkey_golf_2026";
const golfEventIds = {
	root: golfRootEventId,
	arrival: "evt_local_turkey_golf_2026_arrival",
	lodging: "evt_local_turkey_golf_2026_lodging",
	round: "evt_local_turkey_golf_2026_round",
} as const;
const golfRoundEventIds = {
	carya: golfEventIds.round,
	gloria: "evt_local_turkey_golf_2026_round_gloria",
	montgomerie: "evt_local_turkey_golf_2026_round_montgomerie",
	national: "evt_local_turkey_golf_2026_round_national",
	sueno: "evt_local_turkey_golf_2026_round_sueno",
} as const;
const golfExpectedEventIds = [
	...Object.values(golfEventIds),
	...Object.values(golfRoundEventIds).slice(1),
] as const;
const golfOrganizerEmail = "crew.golf.organizer.local@example.test";
const golfParticipantEmail = "crew.golf.participant.local@example.test";
const golfOrganizerInvitationId = "inv_local_turkey_golf_organizer";
const golfParticipantInvitationId = "inv_local_turkey_golf_participant";
const golfLiveFeedId = "fed_local_turkey_golf_transfer_update";
const golfLiveFeedBody =
	"The Antalya transfer meeting point is confirmed at the arrivals group sign.";
const golfRoundDeviceId = "dvc_00000000-0000-4000-8000-000000007101";
const golfRoundMutationId = "00000000-0000-4000-8000-000000007101";
const golfTeamId = "gtm_local_turkey_golf_carya";
const golfPlaceIds = {
	zurichAirport: "plc_local_turkey_golf_zurich_airport",
	antalyaAirport: "plc_local_turkey_golf_antalya_airport",
	hotel: "plc_local_turkey_golf_hotel",
	dinner: "plc_local_turkey_golf_dinner",
} as const;
const golfCourses = [
	{
		key: "carya",
		query: "Carya Belek",
		candidateId:
			"pcd_1e13ca178f90af118e97f076d7d6811c707d37c293d1bc5fa92f653f66f2e92d",
		sourceRecordId: "way/169450196",
		placeId: "plc_local_turkey_golf_carya",
		eventId: golfRoundEventIds.carya,
		title: "Carya Golf Club",
		teeTime: "2026-10-05T08:30:00.000+03:00",
		endsAt: "2026-10-05T13:00:00.000+03:00",
	},
	{
		key: "gloria",
		query: "Gloria Golf Belek",
		candidateId:
			"pcd_a28d40b066df83f51263114f4643e913abe67eb9e8463e9a1e56c77c491d4013",
		sourceRecordId: "way/169451380",
		placeId: "plc_local_turkey_golf_gloria",
		eventId: golfRoundEventIds.gloria,
		title: "Gloria Golf Club",
		teeTime: "2026-10-06T09:00:00.000+03:00",
		endsAt: "2026-10-06T13:30:00.000+03:00",
	},
	{
		key: "montgomerie",
		query: "Montgomerie Belek",
		candidateId:
			"pcd_08cff91c182b33817c8536a8c55bfd540268b289414922a9dc078146fc594894",
		sourceRecordId: "way/169451379",
		placeId: "plc_local_turkey_golf_montgomerie",
		eventId: golfRoundEventIds.montgomerie,
		title: "The Montgomerie Maxx Royal Golf Club",
		teeTime: "2026-10-08T08:40:00.000+03:00",
		endsAt: "2026-10-08T13:10:00.000+03:00",
	},
	{
		key: "national",
		query: "National Golf Belek",
		candidateId:
			"pcd_1ea7bde672b7f92d70ecff1c7b09e86efca6f6ff936c2035adeb917948cf779d",
		sourceRecordId: "way/126258746",
		placeId: "plc_local_turkey_golf_national",
		eventId: golfRoundEventIds.national,
		title: "National Golf Club",
		teeTime: "2026-10-09T09:10:00.000+03:00",
		endsAt: "2026-10-09T13:40:00.000+03:00",
	},
	{
		key: "sueno",
		query: "Sueno Golf Belek",
		candidateId:
			"pcd_3f08b614bbee6d3665cae3efb205dd95685f40d9b22e4d0fe82fc074bf793fd8",
		sourceRecordId: "relation/3872398",
		placeId: "plc_local_turkey_golf_sueno",
		eventId: golfRoundEventIds.sueno,
		title: "Sueno Hotels Golf Belek",
		teeTime: "2026-10-10T08:20:00.000+03:00",
		endsAt: "2026-10-10T12:50:00.000+03:00",
	},
] as const;
const teamEmail = "crew.team.local@example.test";
const teamParticipantEmail = "crew.team.participant.local@example.test";
const teamRootEventId = "evt_local_team_day_2026";
const teamEventIds = {
	root: teamRootEventId,
	workshopOne: "evt_local_team_day_2026_workshop_one",
	challenge: "evt_local_team_day_2026_challenge",
	arrival: "evt_local_team_day_2026_arrival",
	workshopTwo: "evt_local_team_day_2026_workshop_two",
	lunch: "evt_local_team_day_2026_lunch",
	decisions: "evt_local_team_day_2026_decisions",
	wrapUp: "evt_local_team_day_2026_wrap_up",
} as const;
const teamTemplateEventIds = {
	root: teamEventIds.root,
	agenda: teamEventIds.workshopOne,
	activity: teamEventIds.challenge,
} as const;
const teamVenueId = "plc_local_team_day_venue";
const teamInvitationId = "inv_local_team_day_participant";
const teamDecisionFeedId = "fed_local_team_day_decisions";
const teamParticipantFeedBody =
	"Participant reconnect check: option B is ready.";
const LOCAL_HOSTS = new Set([
	"127.0.0.1",
	"localhost",
	"api-gateway",
	"provider-sink",
]);

const offlineFlowIds = {
	"golf-tour": {
		ios: {
			deviceId: "dvc_00000000-0000-4000-8000-000000007201",
			clientMutationId: "00000000-0000-4000-8000-000000007201",
		},
		android: {
			deviceId: "dvc_00000000-0000-4000-8000-000000007202",
			clientMutationId: "00000000-0000-4000-8000-000000007202",
		},
	},
	"team-event": {
		ios: {
			deviceId: "dvc_00000000-0000-4000-8000-000000007301",
			clientMutationId: "00000000-0000-4000-8000-000000007301",
		},
		android: {
			deviceId: "dvc_00000000-0000-4000-8000-000000007302",
			clientMutationId: "00000000-0000-4000-8000-000000007302",
		},
	},
} as const;

export function fixtureOfflineFlows(
	scenario: FixtureScenario,
): readonly FixtureOfflineFlow[] {
	const rootEventId =
		scenario === "golf-tour" ? golfRootEventId : teamRootEventId;
	return (["ios", "android"] as const).map((platform) => {
		const ids = offlineFlowIds[scenario][platform];
		const requestPrefix = `fixture.e2e.${scenario}.${platform}`;
		return {
			scenario,
			platform,
			actor: "participant",
			rootEventId,
			...ids,
			phases: [
				{
					connectivity: "online",
					action: "sync.bootstrap",
					requestId: `${requestPrefix}.bootstrap.v1`,
				},
				{
					connectivity: "offline",
					action: "queue.intent",
					requestId: null,
				},
				{
					connectivity: "online",
					action: "sync.push",
					requestId: `${requestPrefix}.push.v1`,
				},
				{
					connectivity: "online",
					action: "sync.push.replay",
					requestId: `${requestPrefix}.push.replay.v1`,
				},
				{
					connectivity: "online",
					action: "sync.pull",
					requestId: `${requestPrefix}.pull.v1`,
				},
			],
			queuedIntent:
				scenario === "golf-tour"
					? {
							kind: "golf.score.set",
							entityId: `gsc_${golfRoundEventIds.carya}:<participant-user-id>:1`,
							payload: {
								eventId: golfRoundEventIds.carya,
								hole: 1,
								strokes: 4,
								putts: 2,
							},
						}
					: {
							kind: "feed.entry.create",
							entityId: `fed_local_team_day_participant_${platform}_offline`,
							payload: {
								eventId: teamEventIds.decisions,
								parentEntryId: null,
								kind: "message",
								content: teamParticipantFeedBody,
							},
						},
		};
	});
}

function requiredOfflineFlow(
	scenario: FixtureScenario,
	platform: FixturePlatform,
) {
	const flow = fixtureOfflineFlows(scenario).find(
		(candidate) => candidate.platform === platform,
	);
	if (!flow) throw new Error("Fixture offline flow is missing");
	return flow;
}

function offlineRequestId(
	flow: FixtureOfflineFlow,
	action: FixtureOfflineFlow["phases"][number]["action"],
) {
	const requestId = flow.phases.find(
		(phase) => phase.action === action,
	)?.requestId;
	if (!requestId) throw new Error(`Fixture ${action} request ID is missing`);
	return requestId;
}

function materializeOfflineEntityId(
	flow: FixtureOfflineFlow,
	participantUserId: string,
) {
	return flow.queuedIntent.entityId.replace(
		"<participant-user-id>",
		participantUserId,
	);
}

export async function bootstrapFixture(
	config: FixtureConfig,
	options: {
		fetch?: Fetch;
		sleep?: (milliseconds: number) => Promise<void>;
	} = {},
): Promise<FixtureResult> {
	if (!config.localFixtureEnabled) {
		throw new Error("Local fixture execution is disabled");
	}
	const gateway = localUrl(config.gatewayUrl, "/core/v1/");
	const provider = localUrl(config.providerSinkUrl, "/");
	if (config.providerSinkFixtureBearer.length < 16) {
		throw new Error("Fixture bearer must contain at least 16 characters");
	}
	const fetcher = options.fetch ?? fetch;
	const sleep = options.sleep ?? ((milliseconds) => Bun.sleep(milliseconds));
	const scenario = config.scenario ?? "golf-tour";
	const offlineFlowPlatform =
		config.offlineFlowPlatform === undefined
			? scenario === "golf-tour"
				? "ios"
				: "android"
			: config.offlineFlowPlatform;
	const operationPrefix = scenario === "golf-tour" ? "fixture" : "fixture.team";
	const operationId = (name: string, replay = false) =>
		`${operationPrefix}.${name}${replay ? ".replay" : ""}.v1`;
	const email = scenario === "golf-tour" ? golfEmail : teamEmail;
	const rootEventId =
		scenario === "golf-tour" ? golfRootEventId : teamRootEventId;
	const expectedEventIds =
		scenario === "golf-tour"
			? golfExpectedEventIds
			: Object.values(teamEventIds);

	const session = await signInLocalUser(
		fetcher,
		gateway,
		provider,
		config.providerSinkFixtureBearer,
		email,
		operationId,
		sleep,
	);
	const { accessToken, userId } = session;

	const me = await requestJson(fetcher, gateway, "me", {
		method: "GET",
		requestId: operationId("me.read"),
		accessToken,
		expectedStatus: 200,
	});
	const profile = record(record(me.value, "user").profile, "user.profile");
	const profileVersion = requiredPositiveInteger(
		profile.version,
		"user.profile.version",
	);
	const profileUpdate = await requestJson(fetcher, gateway, "me", {
		method: "PATCH",
		requestId: operationId("me.update"),
		idempotencyKey: operationId("me.update"),
		accessToken,
		body: {
			baseVersion: profileVersion,
			changes: {
				displayName: "Local Crew Organizer",
				locale: "de-CH",
				timeZone: "Europe/Zurich",
			},
		},
		expectedStatus: 200,
	});
	const profileReplay = await requestJson(fetcher, gateway, "me", {
		method: "PATCH",
		requestId: operationId("me.update", true),
		idempotencyKey: operationId("me.update"),
		accessToken,
		body: {
			baseVersion: profileVersion,
			changes: {
				displayName: "Local Crew Organizer",
				locale: "de-CH",
				timeZone: "Europe/Zurich",
			},
		},
		expectedStatus: 200,
	});
	assertReplay(profileUpdate, profileReplay, "profile update");
	const updatedProfile = record(profileUpdate.value, "updated profile");
	if (
		updatedProfile.displayName !== "Local Crew Organizer" ||
		requiredPositiveInteger(
			updatedProfile.version,
			"updated profile.version",
		) !==
			profileVersion + 1
	) {
		throw new Error("Fixture profile update returned an unexpected profile");
	}

	const rootBody =
		scenario === "golf-tour"
			? {
					id: rootEventId,
					kind: "trip",
					title: "Turkey Golf Tour 2026",
					description: "Deterministic local Crew development fixture.",
					timeZone: "Europe/Istanbul",
					startsAt: "2026-10-04T12:00:00.000+03:00",
					endsAt: "2026-10-11T12:00:00.000+03:00",
					status: "draft",
					template: {
						id: "golf-tour",
						version: 1,
						eventIds: golfEventIds,
					},
				}
			: {
					id: rootEventId,
					kind: "team_event",
					title: "Crew Team Day 2026",
					description:
						"One-day team event with a shared agenda and decision log.",
					timeZone: "Europe/Zurich",
					startsAt: "2026-09-18T08:30:00.000+02:00",
					endsAt: "2026-09-18T17:30:00.000+02:00",
					status: "draft",
					template: {
						id: "team-event",
						version: 1,
						eventIds: teamTemplateEventIds,
					},
				};
	const created = await requestJson(fetcher, gateway, "event-roots", {
		method: "POST",
		requestId: operationId("event.create"),
		idempotencyKey: operationId("event.create"),
		accessToken,
		body: rootBody,
		expectedStatus: 201,
	});
	const createdReplay = await requestJson(fetcher, gateway, "event-roots", {
		method: "POST",
		requestId: operationId("event.create", true),
		idempotencyKey: operationId("event.create"),
		accessToken,
		body: rootBody,
		expectedStatus: 201,
	});
	assertReplay(created, createdReplay, "event creation");
	assertCreatedRoot(created.value, rootEventId);

	let scenarioMembers:
		| { organizerUserId: string; participantUserId: string }
		| { participantUserId: string }
		| undefined;
	if (scenario === "golf-tour") {
		scenarioMembers = await bootstrapGolfTour(
			fixtureRequest(fetcher, gateway, accessToken),
			{
				fetcher,
				gateway,
				provider,
				providerSinkFixtureBearer: config.providerSinkFixtureBearer,
				operationId,
				offlineFlowPlatform,
				ownerUserId: userId,
				sleep,
			},
		);
	} else {
		scenarioMembers = await bootstrapTeamEvent(
			fixtureRequest(fetcher, gateway, accessToken),
			{
				fetcher,
				gateway,
				provider,
				providerSinkFixtureBearer: config.providerSinkFixtureBearer,
				operationId,
				offlineFlowPlatform,
				userId,
				sleep,
			},
		);
	}

	const readRoot = await requestJson(
		fetcher,
		gateway,
		`event-roots/${rootEventId}`,
		{
			method: "GET",
			requestId: operationId("event.read"),
			accessToken,
			expectedStatus: 200,
		},
	);
	assertRoot(readRoot.value, rootEventId, expectedEventIds, scenario);

	return {
		userId,
		rootEventId,
		eventIds: expectedEventIds,
		...scenarioMembers,
	};
}

type JsonResult = {
	value: unknown;
	raw: string;
	headers: Headers;
};

type AuthenticatedFixtureRequest = (
	path: string,
	options: {
		method: string;
		requestId: string;
		expectedStatus: number;
		idempotencyKey?: string;
		body?: unknown;
	},
) => Promise<JsonResult>;

type OperationId = (name: string, replay?: boolean) => string;

async function signInLocalUser(
	fetcher: Fetch,
	gateway: URL,
	provider: URL,
	providerSinkFixtureBearer: string,
	email: string,
	operationId: OperationId,
	sleep: (milliseconds: number) => Promise<void>,
) {
	const started = await requestJson(fetcher, gateway, "auth/magic-links", {
		method: "POST",
		requestId: operationId("auth.start"),
		idempotencyKey: operationId("auth.start"),
		body: { email },
		expectedStatus: 202,
	});
	const startReplay = await requestJson(fetcher, gateway, "auth/magic-links", {
		method: "POST",
		requestId: operationId("auth.start", true),
		idempotencyKey: operationId("auth.start"),
		body: { email },
		expectedStatus: 202,
	});
	assertReplay(started, startReplay, "magic-link start");
	const token = await consumeMagicLink(
		fetcher,
		provider,
		providerSinkFixtureBearer,
		email,
		sleep,
	);
	const redeemed = await requestJson(
		fetcher,
		gateway,
		"auth/magic-links/redeem",
		{
			method: "POST",
			requestId: operationId("auth.redeem"),
			idempotencyKey: operationId("auth.redeem"),
			body: { token },
			expectedStatus: 200,
		},
	);
	const redeemReplay = await requestJson(
		fetcher,
		gateway,
		"auth/magic-links/redeem",
		{
			method: "POST",
			requestId: operationId("auth.redeem", true),
			idempotencyKey: operationId("auth.redeem"),
			body: { token },
			expectedStatus: 200,
		},
	);
	assertReplay(redeemed, redeemReplay, "magic-link redemption");
	const session = record(redeemed.value, "session");
	const userId = requiredString(
		record(session.user, "session.user").id,
		"session.user.id",
	);
	if (!/^usr_[a-f0-9]{32}$/.test(userId)) {
		throw new Error("Fixture session returned an invalid user ID");
	}
	return {
		accessToken: requiredString(session.accessToken, "session.accessToken"),
		userId,
	};
}

function fixtureRequest(
	fetcher: Fetch,
	gateway: URL,
	accessToken: string,
): AuthenticatedFixtureRequest {
	return (path, options) =>
		requestJson(fetcher, gateway, path, { ...options, accessToken });
}

function replayWriter(
	request: AuthenticatedFixtureRequest,
	operationId: OperationId,
) {
	return async (
		path: string,
		input: {
			name: string;
			method: string;
			body: unknown;
			expectedStatus: number;
		},
	) => {
		const first = await request(path, {
			method: input.method,
			requestId: operationId(input.name),
			idempotencyKey: operationId(input.name),
			body: input.body,
			expectedStatus: input.expectedStatus,
		});
		const replay = await request(path, {
			method: input.method,
			requestId: operationId(input.name, true),
			idempotencyKey: operationId(input.name),
			body: input.body,
			expectedStatus: input.expectedStatus,
		});
		assertReplay(first, replay, input.name);
		return first.value;
	};
}

async function publishFixtureRoot(
	request: AuthenticatedFixtureRequest,
	operationId: OperationId,
	rootEventId: string,
) {
	const readinessResponse = await request(
		`event-roots/${rootEventId}/publish-readiness`,
		{
			method: "GET",
			requestId: operationId("event.publish-readiness"),
			expectedStatus: 200,
		},
	);
	const readiness = record(readinessResponse.value, "publish readiness");
	if (readiness.ready !== true) {
		throw new Error("Fixture event is not ready to publish");
	}
	const published = record(
		await replayWriter(request, operationId)(
			`event-roots/${rootEventId}/publish`,
			{
				name: "event.publish",
				method: "POST",
				expectedStatus: 200,
				body: {
					baseVersion: requiredPositiveInteger(
						readiness.rootVersion,
						"publish readiness.rootVersion",
					),
					baseRevision: requiredRevision(
						readiness.rootRevision,
						"publish readiness.rootRevision",
					),
				},
			},
		),
		"published root",
	);
	if (record(published.event, "published event").status !== "published") {
		throw new Error("Fixture event was not published");
	}
}

async function bootstrapGolfTour(
	request: AuthenticatedFixtureRequest,
	context: {
		fetcher: Fetch;
		gateway: URL;
		provider: URL;
		providerSinkFixtureBearer: string;
		operationId: OperationId;
		offlineFlowPlatform: FixturePlatform | null;
		ownerUserId: string;
		sleep: (milliseconds: number) => Promise<void>;
	},
) {
	const write = replayWriter(request, context.operationId);
	const discoveredCourses: Record<string, unknown>[] = [];
	for (const course of golfCourses) {
		const search = await request(
			`places/search?q=${encodeURIComponent(course.query)}&kind=golf_course&countryCode=TR&limit=20`,
			{
				method: "GET",
				requestId: context.operationId(`course.${course.key}.search`),
				expectedStatus: 200,
			},
		);
		const match = records(
			record(search.value, "course search").items,
			"course search.items",
		).find((item) => item.id === course.candidateId);
		if (
			!match ||
			match.name !== course.title ||
			match.kind !== "golf_course" ||
			match.countryCode !== "TR" ||
			match.source !== "osm" ||
			match.sourceRecordUrl !==
				`https://www.openstreetmap.org/${course.sourceRecordId}` ||
			match.licenseCode !== "ODbL-1.0" ||
			match.attribution !== "© OpenStreetMap contributors"
		) {
			throw new Error(`Fixture course ${course.key} did not resolve safely`);
		}
		discoveredCourses.push(match);
	}

	const templateEvents = [
		{
			id: golfEventIds.arrival,
			title: "Arrival and airport transfers",
			description:
				"Outbound flight and shared transfers between Antalya and Belek.",
			startsAt: "2026-10-04T15:00:00.000+03:00",
			endsAt: "2026-10-11T10:30:00.000+03:00",
		},
		{
			id: golfEventIds.lodging,
			title: "Belek lodging",
			description: "Seven-night shared lodging window.",
			startsAt: "2026-10-04T17:00:00.000+03:00",
			endsAt: "2026-10-11T08:00:00.000+03:00",
		},
		{
			id: golfEventIds.round,
			title: golfCourses[0].title,
			description: "Stableford round one.",
			startsAt: golfCourses[0].teeTime,
			endsAt: golfCourses[0].endsAt,
		},
	] as const;
	for (const event of templateEvents) {
		const { id, ...changes } = event;
		await write(`event-roots/${golfRootEventId}/events/${id}`, {
			name: `event.${id.slice("evt_local_turkey_golf_2026_".length)}.update`,
			method: "PATCH",
			expectedStatus: 200,
			body: {
				baseVersion: 1,
				changes: { ...changes, status: "published" },
			},
		});
	}
	for (const course of golfCourses.slice(1)) {
		await write(`event-roots/${golfRootEventId}/events`, {
			name: `event.round-${course.key}.create`,
			method: "POST",
			expectedStatus: 201,
			body: {
				id: course.eventId,
				parentEventId: golfRootEventId,
				kind: "golf",
				title: course.title,
				description: `Stableford round at ${course.title}.`,
				timeZone: "Europe/Istanbul",
				startsAt: course.teeTime,
				endsAt: course.endsAt,
				status: "published",
			},
		});
	}

	for (const place of [
		{
			id: golfPlaceIds.zurichAirport,
			name: "Zurich Airport",
			locality: "Zurich",
			countryCode: "CH",
			latitude: null,
			longitude: null,
		},
		{
			id: golfPlaceIds.antalyaAirport,
			name: "Antalya Airport",
			locality: "Antalya",
			countryCode: "TR",
			latitude: null,
			longitude: null,
		},
		{
			id: golfPlaceIds.hotel,
			name: "Local Belek Tour Hotel",
			locality: "Belek",
			countryCode: "TR",
			latitude: null,
			longitude: null,
		},
		{
			id: golfPlaceIds.dinner,
			name: "Local Belek Dinner Venue",
			locality: "Belek",
			countryCode: "TR",
			latitude: null,
			longitude: null,
		},
	]) {
		await write(`event-roots/${golfRootEventId}/places`, {
			name: `place.${place.id.slice("plc_local_turkey_golf_".length)}.create`,
			method: "POST",
			expectedStatus: 201,
			body: place,
		});
	}
	for (const [index, course] of golfCourses.entries()) {
		const discovered = discoveredCourses[index] as Record<string, unknown>;
		await write(`event-roots/${golfRootEventId}/places`, {
			name: `place.course-${course.key}.create`,
			method: "POST",
			expectedStatus: 201,
			body: {
				id: course.placeId,
				name: requiredString(discovered.name, `course ${course.key} name`),
				locality: nullableString(
					discovered.locality,
					`course ${course.key} locality`,
				),
				countryCode: requiredString(
					discovered.countryCode,
					`course ${course.key} country`,
				),
				latitude: nullableNumber(
					discovered.latitude,
					`course ${course.key} latitude`,
				),
				longitude: nullableNumber(
					discovered.longitude,
					`course ${course.key} longitude`,
				),
			},
		});
	}

	for (const capability of [
		{
			eventId: golfRootEventId,
			type: "travel",
			baseVersion: 1,
			config: {
				homePlaceId: golfPlaceIds.zurichAirport,
				travelerReferenceLabel: "Turkey Golf Tour booking reference",
			},
		},
		{
			eventId: golfEventIds.arrival,
			type: "transport",
			baseVersion: 1,
			config: {
				meetingPlaceId: golfPlaceIds.antalyaAirport,
				participantMode: "shared",
			},
		},
		{
			eventId: golfEventIds.lodging,
			type: "lodging",
			baseVersion: 1,
			config: {
				propertyPlaceId: golfPlaceIds.hotel,
				checkInPolicy: "fixed",
				checkOutPolicy: "fixed",
				roomAssignmentMode: "organizer",
			},
		},
	] as const) {
		await write(
			`event-roots/${golfRootEventId}/events/${capability.eventId}/capabilities/${capability.type}`,
			{
				name: `capability.${capability.type}.update`,
				method: "PUT",
				expectedStatus: 200,
				body: {
					baseVersion: capability.baseVersion,
					capability: {
						type: capability.type,
						schemaVersion: 1,
						config: capability.config,
					},
				},
			},
		);
	}
	for (const [index, course] of golfCourses.entries()) {
		await write(
			`event-roots/${golfRootEventId}/events/${course.eventId}/capabilities/golf`,
			{
				name: `capability.golf-${course.key}.update`,
				method: "PUT",
				expectedStatus: 200,
				body: {
					baseVersion: index === 0 ? 1 : 0,
					capability: {
						type: "golf",
						schemaVersion: 1,
						config: {
							coursePlaceId: course.placeId,
							teeFormat: "individual",
							handicapMode: "optional",
							scoringMode: "stableford",
							roundState: index === 0 ? "open" : "planned",
						},
					},
				},
			},
		);
	}

	const itinerary = [
		{
			id: "iti_local_turkey_golf_flight_out",
			eventId: golfRootEventId,
			title: "Flight to Antalya",
			notes: "Deterministic fixture flight; no live booking is implied.",
			timeZone: "Europe/Zurich",
			startsAt: "2026-10-04T09:00:00.000+02:00",
			endsAt: "2026-10-04T13:15:00.000+03:00",
			allDay: false,
			status: "active",
			details: {
				schemaVersion: 1,
				type: "flight",
				originPlaceId: golfPlaceIds.zurichAirport,
				destinationPlaceId: golfPlaceIds.antalyaAirport,
				flightDesignator: "FIXTURE-OUT",
			},
			placeId: golfPlaceIds.antalyaAirport,
		},
		{
			id: "iti_local_turkey_golf_transfer_in",
			eventId: golfEventIds.arrival,
			title: "Shared transfer to Belek",
			notes: null,
			timeZone: "Europe/Istanbul",
			startsAt: "2026-10-04T14:00:00.000+03:00",
			endsAt: "2026-10-04T15:00:00.000+03:00",
			allDay: false,
			status: "active",
			details: {
				schemaVersion: 1,
				type: "road_transfer",
				originPlaceId: golfPlaceIds.antalyaAirport,
				destinationPlaceId: golfPlaceIds.hotel,
				pickupInstructions: "Meet at the fixture group sign in arrivals.",
			},
			placeId: golfPlaceIds.antalyaAirport,
		},
		{
			id: "iti_local_turkey_golf_lodging",
			eventId: golfEventIds.lodging,
			title: "Seven-night lodging",
			notes: null,
			timeZone: "Europe/Istanbul",
			startsAt: "2026-10-04T17:00:00.000+03:00",
			endsAt: "2026-10-11T08:00:00.000+03:00",
			allDay: false,
			status: "active",
			details: {
				schemaVersion: 1,
				type: "lodging",
				propertyName: "Local Belek Tour Hotel",
				checkInAt: "2026-10-04T17:00:00.000+03:00",
				checkOutAt: "2026-10-11T08:00:00.000+03:00",
			},
			placeId: golfPlaceIds.hotel,
		},
		{
			id: "iti_local_turkey_golf_welcome_dinner",
			eventId: golfRootEventId,
			title: "Welcome dinner",
			notes: null,
			timeZone: "Europe/Istanbul",
			startsAt: "2026-10-04T19:30:00.000+03:00",
			endsAt: "2026-10-04T21:30:00.000+03:00",
			allDay: false,
			status: "active",
			details: {
				schemaVersion: 1,
				type: "meal",
				reservationNote: "Welcome dinner fixture reservation.",
			},
			placeId: golfPlaceIds.dinner,
		},
		{
			id: "iti_local_turkey_golf_farewell_dinner",
			eventId: golfRootEventId,
			title: "Farewell dinner",
			notes: null,
			timeZone: "Europe/Istanbul",
			startsAt: "2026-10-10T19:30:00.000+03:00",
			endsAt: "2026-10-10T21:30:00.000+03:00",
			allDay: false,
			status: "active",
			details: {
				schemaVersion: 1,
				type: "meal",
				reservationNote: "Farewell dinner fixture reservation.",
			},
			placeId: golfPlaceIds.dinner,
		},
		{
			id: "iti_local_turkey_golf_transfer_out",
			eventId: golfEventIds.arrival,
			title: "Shared transfer to Antalya Airport",
			notes: null,
			timeZone: "Europe/Istanbul",
			startsAt: "2026-10-11T08:30:00.000+03:00",
			endsAt: "2026-10-11T09:30:00.000+03:00",
			allDay: false,
			status: "active",
			details: {
				schemaVersion: 1,
				type: "road_transfer",
				originPlaceId: golfPlaceIds.hotel,
				destinationPlaceId: golfPlaceIds.antalyaAirport,
				pickupInstructions: "Meet in the fixture hotel lobby.",
			},
			placeId: golfPlaceIds.hotel,
		},
	] as const;
	for (const item of itinerary) {
		await write(`event-roots/${golfRootEventId}/itinerary`, {
			name: `itinerary.${item.id.slice("iti_local_turkey_golf_".length)}.create`,
			method: "POST",
			expectedStatus: 201,
			body: item,
		});
	}
	for (const course of golfCourses) {
		await write(`event-roots/${golfRootEventId}/itinerary`, {
			name: `itinerary.round-${course.key}.create`,
			method: "POST",
			expectedStatus: 201,
			body: {
				id: `iti_local_turkey_golf_round_${course.key}`,
				eventId: course.eventId,
				title: `Golf round: ${course.title}`,
				notes: `Course source: https://www.openstreetmap.org/${course.sourceRecordId} — © OpenStreetMap contributors, ODbL-1.0.`,
				timeZone: "Europe/Istanbul",
				startsAt: course.teeTime,
				endsAt: course.endsAt,
				allDay: false,
				status: "active",
				details: {
					schemaVersion: 1,
					type: "golf_round",
					roundReference: course.sourceRecordId,
					teeTime: course.teeTime,
				},
				placeId: course.placeId,
			},
		});
	}

	const organizerInvitation = record(
		await write(`event-roots/${golfRootEventId}/invitations`, {
			name: "invitation.organizer.create",
			method: "POST",
			expectedStatus: 201,
			body: {
				id: golfOrganizerInvitationId,
				role: "organizer",
				normalizedEmailHint: golfOrganizerEmail,
				expiresAt: "2035-12-31T23:59:59.000Z",
				maxUses: 1,
			},
		}),
		"organizer invitation",
	);
	const participantInvitation = record(
		await write(`event-roots/${golfRootEventId}/invitations`, {
			name: "invitation.participant.create",
			method: "POST",
			expectedStatus: 201,
			body: {
				id: golfParticipantInvitationId,
				role: "participant",
				normalizedEmailHint: golfParticipantEmail,
				expiresAt: "2035-12-31T23:59:59.000Z",
				maxUses: 1,
			},
		}),
		"participant invitation",
	);
	const memberSession = async (
		role: "organizer" | "participant",
		email: string,
	) =>
		signInLocalUser(
			context.fetcher,
			context.gateway,
			context.provider,
			context.providerSinkFixtureBearer,
			email,
			(name, replay) => context.operationId(`${role}.${name}`, replay),
			context.sleep,
		);
	const organizer = await memberSession("organizer", golfOrganizerEmail);
	const participant = await memberSession("participant", golfParticipantEmail);
	for (const member of [
		{
			role: "organizer",
			session: organizer,
			token: requiredString(
				organizerInvitation.token,
				"organizer invitation token",
			),
		},
		{
			role: "participant",
			session: participant,
			token: requiredString(
				participantInvitation.token,
				"participant invitation token",
			),
		},
	] as const) {
		const memberOperationId = (name: string, replay = false) =>
			context.operationId(`${member.role}.${name}`, replay);
		const redeemed = await replayWriter(
			fixtureRequest(
				context.fetcher,
				context.gateway,
				member.session.accessToken,
			),
			memberOperationId,
		)("invitations/redeem", {
			name: "invitation.redeem",
			method: "POST",
			expectedStatus: 200,
			body: { token: member.token },
		});
		assertMembership(
			redeemed,
			golfRootEventId,
			member.session.userId,
			member.role,
		);
	}

	const organizerRequest = fixtureRequest(
		context.fetcher,
		context.gateway,
		organizer.accessToken,
	);
	const participantRequest = fixtureRequest(
		context.fetcher,
		context.gateway,
		participant.accessToken,
	);
	const organizerWrite = replayWriter(organizerRequest, (name, replay) =>
		context.operationId(`organizer.${name}`, replay),
	);
	await participantRequest(
		`event-roots/${golfRootEventId}/itinerary/iti_local_turkey_golf_transfer_in`,
		{
			method: "PATCH",
			requestId: context.operationId("participant.itinerary.update.denied"),
			idempotencyKey: context.operationId(
				"participant.itinerary.update.denied",
			),
			body: {
				baseVersion: 1,
				changes: { notes: "Participant changes are not authoritative." },
			},
			expectedStatus: 403,
		},
	);
	const updatedArrival = record(
		record(
			await organizerWrite(
				`event-roots/${golfRootEventId}/events/${golfEventIds.arrival}`,
				{
					name: "event.arrival.live-update",
					method: "PATCH",
					expectedStatus: 200,
					body: {
						baseVersion: 4,
						changes: {
							description:
								"Organizer confirmed the Antalya arrival meeting point.",
						},
					},
				},
			),
			"organizer event update",
		).event,
		"organizer updated event",
	);
	if (
		updatedArrival.id !== golfEventIds.arrival ||
		updatedArrival.description !==
			"Organizer confirmed the Antalya arrival meeting point."
	) {
		throw new Error("Fixture organizer hierarchy update did not persist");
	}
	const updatedTransfer = record(
		record(
			await organizerWrite(
				`event-roots/${golfRootEventId}/itinerary/iti_local_turkey_golf_transfer_in`,
				{
					name: "itinerary.transfer.live-update",
					method: "PATCH",
					expectedStatus: 200,
					body: {
						baseVersion: 1,
						changes: {
							notes:
								"Meet at the arrivals group sign before the Belek transfer.",
						},
					},
				},
			),
			"organizer itinerary update",
		).item,
		"organizer updated itinerary item",
	);
	if (
		updatedTransfer.id !== "iti_local_turkey_golf_transfer_in" ||
		updatedTransfer.notes !==
			"Meet at the arrivals group sign before the Belek transfer."
	) {
		throw new Error("Fixture organizer itinerary update did not persist");
	}

	const scoringEventId = golfCourses[0].eventId;
	const roundSetup = {
		holes: Array.from({ length: 18 }, (_, index) => ({
			hole: index + 1,
			par: 4,
			strokeIndex: index + 1,
		})),
		players: [
			{ userId: context.ownerUserId, playingHandicap: -2 },
			{ userId: organizer.userId, playingHandicap: 7 },
			{ userId: participant.userId, playingHandicap: 18 },
		],
		teams: [
			{
				id: golfTeamId,
				name: "Carya Flight",
				color: "#00AA55",
				memberUserIds: [
					context.ownerUserId,
					organizer.userId,
					participant.userId,
				],
			},
		],
	};
	assertSyncMutationApplied(
		await write("sync/push", {
			name: "golf.round.create",
			method: "POST",
			expectedStatus: 200,
			body: {
				protocolVersion: 1,
				rootEventId: golfRootEventId,
				deviceId: golfRoundDeviceId,
				mutations: [
					{
						clientMutationId: golfRoundMutationId,
						clientSequence: 1,
						kind: "golf.round.replace",
						entityId: scoringEventId,
						baseVersion: 0,
						payload: { eventId: scoringEventId, ...roundSetup },
					},
				],
			},
		}),
		"golf round setup",
		golfRootEventId,
		golfRoundDeviceId,
		golfRoundMutationId,
		"golfRound",
		scoringEventId,
	);

	await publishFixtureRoot(request, context.operationId, golfRootEventId);

	const liveFeedEntry = record(
		record(
			await organizerWrite(`event-roots/${golfRootEventId}/feed`, {
				name: "feed.transfer-update.create",
				method: "POST",
				expectedStatus: 201,
				body: {
					id: golfLiveFeedId,
					eventId: golfEventIds.arrival,
					parentEntryId: null,
					kind: "message",
					body: golfLiveFeedBody,
				},
			}),
			"organizer feed update",
		).entry,
		"organizer feed entry",
	);
	if (
		liveFeedEntry.id !== golfLiveFeedId ||
		liveFeedEntry.authorUserId !== organizer.userId ||
		liveFeedEntry.body !== golfLiveFeedBody
	) {
		throw new Error("Fixture organizer feed update did not persist");
	}
	const participantDomainWrite = replayWriter(
		participantRequest,
		(name, replay) => context.operationId(`participant.${name}`, replay),
	);
	const liveReaction = record(
		record(
			await participantDomainWrite(
				`event-roots/${golfRootEventId}/feed/${golfLiveFeedId}/reaction`,
				{
					name: "feed.transfer-update.react",
					method: "PUT",
					expectedStatus: 200,
					body: { reaction: "celebrate", present: true },
				},
			),
			"participant feed reaction",
		).reaction,
		"participant reaction",
	);
	if (
		liveReaction.entryId !== golfLiveFeedId ||
		liveReaction.userId !== participant.userId ||
		liveReaction.reaction !== "celebrate" ||
		liveReaction.present !== true
	) {
		throw new Error("Fixture participant feed reaction did not persist");
	}
	const participantFlow = context.offlineFlowPlatform
		? requiredOfflineFlow("golf-tour", context.offlineFlowPlatform)
		: null;
	if (participantFlow) {
		const participantBootstrap = await participantRequest(
			`sync/bootstrap?rootEventId=${golfRootEventId}&limit=200`,
			{
				method: "GET",
				requestId: offlineRequestId(participantFlow, "sync.bootstrap"),
				expectedStatus: 200,
			},
		);
		const participantCursor = assertParticipantGolfBootstrap(
			participantBootstrap.value,
			scoringEventId,
			participant.userId,
		);
		const scoreId = materializeOfflineEntityId(
			participantFlow,
			participant.userId,
		);
		const participantWrite = replayWriter(participantRequest, (_name, replay) =>
			offlineRequestId(
				participantFlow,
				replay ? "sync.push.replay" : "sync.push",
			),
		);
		assertSyncMutationApplied(
			await participantWrite("sync/push", {
				name: "golf.score.set",
				method: "POST",
				expectedStatus: 200,
				body: {
					protocolVersion: 1,
					rootEventId: golfRootEventId,
					deviceId: participantFlow.deviceId,
					mutations: [
						{
							clientMutationId: participantFlow.clientMutationId,
							clientSequence: 1,
							kind: "golf.score.set",
							entityId: scoreId,
							baseVersion: 0,
							payload: participantFlow.queuedIntent.payload,
						},
					],
				},
			}),
			"participant golf score",
			golfRootEventId,
			participantFlow.deviceId,
			participantFlow.clientMutationId,
			"golfScore",
			scoreId,
		);
		const participantPull = await participantRequest(
			`sync/pull?rootEventId=${golfRootEventId}&cursor=${encodeURIComponent(participantCursor)}&limit=200`,
			{
				method: "GET",
				requestId: offlineRequestId(participantFlow, "sync.pull"),
				expectedStatus: 200,
			},
		);
		assertParticipantGolfPull(
			participantPull.value,
			scoringEventId,
			participant.userId,
			scoreId,
		);
	}

	const [
		memberships,
		invitations,
		places,
		snapshot,
		organizerRoot,
		participantRoot,
		participantItinerary,
		participantFeed,
	] = await Promise.all([
		request(`event-roots/${golfRootEventId}/memberships?limit=50`, {
			method: "GET",
			requestId: context.operationId("memberships.read"),
			expectedStatus: 200,
		}),
		request(`event-roots/${golfRootEventId}/invitations?limit=50`, {
			method: "GET",
			requestId: context.operationId("invitations.read"),
			expectedStatus: 200,
		}),
		request(`event-roots/${golfRootEventId}/places?limit=50`, {
			method: "GET",
			requestId: context.operationId("places.read"),
			expectedStatus: 200,
		}),
		request(`sync/bootstrap?rootEventId=${golfRootEventId}&limit=200`, {
			method: "GET",
			requestId: context.operationId("sync.bootstrap"),
			expectedStatus: 200,
		}),
		fixtureRequest(
			context.fetcher,
			context.gateway,
			organizer.accessToken,
		)(`event-roots/${golfRootEventId}`, {
			method: "GET",
			requestId: context.operationId("organizer.event.read"),
			expectedStatus: 200,
		}),
		fixtureRequest(
			context.fetcher,
			context.gateway,
			participant.accessToken,
		)(`event-roots/${golfRootEventId}`, {
			method: "GET",
			requestId: context.operationId("participant.event.read"),
			expectedStatus: 200,
		}),
		participantRequest(
			`event-roots/${golfRootEventId}/events/${golfEventIds.arrival}/itinerary?limit=50`,
			{
				method: "GET",
				requestId: context.operationId("participant.itinerary.read"),
				expectedStatus: 200,
			},
		),
		participantRequest(`event-roots/${golfRootEventId}/feed?limit=50`, {
			method: "GET",
			requestId: context.operationId("participant.feed.read"),
			expectedStatus: 200,
		}),
	]);
	assertRoot(
		organizerRoot.value,
		golfRootEventId,
		golfExpectedEventIds,
		"golf-tour",
	);
	assertRoot(
		participantRoot.value,
		golfRootEventId,
		golfExpectedEventIds,
		"golf-tour",
	);
	assertGolfReadback(
		memberships.value,
		invitations.value,
		places.value,
		snapshot.value,
		participantItinerary.value,
		participantFeed.value,
		{
			ownerUserId: context.ownerUserId,
			organizerUserId: organizer.userId,
			participantUserId: participant.userId,
		},
		participantFlow !== null,
	);
	return {
		organizerUserId: organizer.userId,
		participantUserId: participant.userId,
	};
}

async function bootstrapTeamEvent(
	request: AuthenticatedFixtureRequest,
	context: {
		fetcher: Fetch;
		gateway: URL;
		provider: URL;
		providerSinkFixtureBearer: string;
		operationId: (name: string, replay?: boolean) => string;
		offlineFlowPlatform: FixturePlatform | null;
		userId: string;
		sleep: (milliseconds: number) => Promise<void>;
	},
) {
	const write = replayWriter(request, context.operationId);

	await write(
		`event-roots/${teamRootEventId}/events/${teamEventIds.workshopOne}`,
		{
			name: "event.workshop-one.update",
			method: "PATCH",
			expectedStatus: 200,
			body: {
				baseVersion: 1,
				changes: {
					title: "Workshop 1",
					description: "Align on the problem and the desired outcome.",
					startsAt: "2026-09-18T09:00:00.000+02:00",
					endsAt: "2026-09-18T10:30:00.000+02:00",
					status: "published",
				},
			},
		},
	);
	await write(
		`event-roots/${teamRootEventId}/events/${teamEventIds.challenge}`,
		{
			name: "event.challenge.update",
			method: "PATCH",
			expectedStatus: 200,
			body: {
				baseVersion: 1,
				changes: {
					title: "Team challenge",
					description: "Apply the workshop outcome in mixed teams.",
					startsAt: "2026-09-18T13:00:00.000+02:00",
					endsAt: "2026-09-18T15:00:00.000+02:00",
					status: "published",
				},
			},
		},
	);

	const children = [
		{
			id: teamEventIds.arrival,
			kind: "session",
			title: "Arrival window",
			description: "Coffee, badges and a clear start for everyone.",
			startsAt: "2026-09-18T08:30:00.000+02:00",
			endsAt: "2026-09-18T09:00:00.000+02:00",
		},
		{
			id: teamEventIds.workshopTwo,
			kind: "session",
			title: "Workshop 2",
			description: "Turn the first workshop into concrete options.",
			startsAt: "2026-09-18T10:45:00.000+02:00",
			endsAt: "2026-09-18T12:00:00.000+02:00",
		},
		{
			id: teamEventIds.lunch,
			kind: "activity",
			title: "Lunch",
			description: "Shared lunch at the venue.",
			startsAt: "2026-09-18T12:00:00.000+02:00",
			endsAt: "2026-09-18T13:00:00.000+02:00",
		},
		{
			id: teamEventIds.decisions,
			kind: "session",
			title: "Decisions",
			description: "Confirm owners, decisions and next steps.",
			startsAt: "2026-09-18T15:15:00.000+02:00",
			endsAt: "2026-09-18T16:30:00.000+02:00",
		},
		{
			id: teamEventIds.wrapUp,
			kind: "session",
			title: "Wrap-up",
			description: "Close the day with owners and the first follow-up.",
			startsAt: "2026-09-18T16:30:00.000+02:00",
			endsAt: "2026-09-18T17:00:00.000+02:00",
		},
	] as const;
	for (const child of children) {
		await write(`event-roots/${teamRootEventId}/events`, {
			name: `event.${child.id.slice("evt_local_team_day_2026_".length)}.create`,
			method: "POST",
			expectedStatus: 201,
			body: {
				...child,
				parentEventId: teamRootEventId,
				timeZone: "Europe/Zurich",
				status: "published",
			},
		});
	}

	await write(`event-roots/${teamRootEventId}/places`, {
		name: "place.venue.create",
		method: "POST",
		expectedStatus: 201,
		body: {
			id: teamVenueId,
			name: "Crew Workshop Venue",
			locality: "Zurich",
			countryCode: "CH",
			latitude: null,
			longitude: null,
		},
	});
	await write(
		`event-roots/${teamRootEventId}/events/${teamRootEventId}/capabilities/team`,
		{
			name: "capability.team.update",
			method: "PUT",
			expectedStatus: 200,
			body: {
				baseVersion: 1,
				capability: {
					type: "team",
					schemaVersion: 1,
					config: {
						venuePlaceId: teamVenueId,
						assignmentMode: "organizer",
						capacityPerTeam: 6,
						facilitator: "Local Crew Organizer",
					},
				},
			},
		},
	);
	const participantInvitation = record(
		await write(`event-roots/${teamRootEventId}/invitations`, {
			name: "invitation.participant.create",
			method: "POST",
			expectedStatus: 201,
			body: {
				id: teamInvitationId,
				role: "participant",
				normalizedEmailHint: teamParticipantEmail,
				expiresAt: "2035-12-31T23:59:59.000Z",
				maxUses: 1,
			},
		}),
		"team participant invitation",
	);
	const participant = await signInLocalUser(
		context.fetcher,
		context.gateway,
		context.provider,
		context.providerSinkFixtureBearer,
		teamParticipantEmail,
		(name, replay) => context.operationId(`participant.${name}`, replay),
		context.sleep,
	);
	const participantRequest = fixtureRequest(
		context.fetcher,
		context.gateway,
		participant.accessToken,
	);
	const redeemed = await replayWriter(participantRequest, (name, replay) =>
		context.operationId(`participant.${name}`, replay),
	)("invitations/redeem", {
		name: "invitation.redeem",
		method: "POST",
		expectedStatus: 200,
		body: {
			token: requiredString(
				participantInvitation.token,
				"team participant invitation token",
			),
		},
	});
	assertMembership(
		redeemed,
		teamRootEventId,
		participant.userId,
		"participant",
	);

	const agenda = [
		["arrival", teamEventIds.arrival, "Arrival window", "08:30", "09:00"],
		["workshop-one", teamEventIds.workshopOne, "Workshop 1", "09:00", "10:30"],
		["workshop-two", teamEventIds.workshopTwo, "Workshop 2", "10:45", "12:00"],
		["lunch", teamEventIds.lunch, "Lunch", "12:00", "13:00"],
		["challenge", teamEventIds.challenge, "Team challenge", "13:00", "15:00"],
		["decisions", teamEventIds.decisions, "Decisions", "15:15", "16:30"],
		["wrap-up", teamEventIds.wrapUp, "Wrap-up", "16:30", "17:00"],
	] as const;
	for (const [key, descendantEventId, title, startsAt, endsAt] of agenda) {
		await write(`event-roots/${teamRootEventId}/itinerary`, {
			name: `itinerary.${key}.create`,
			method: "POST",
			expectedStatus: 201,
			body: {
				id: `iti_local_team_day_${key.replaceAll("-", "_")}`,
				eventId: teamRootEventId,
				title,
				notes: null,
				timeZone: "Europe/Zurich",
				startsAt: `2026-09-18T${startsAt}:00.000+02:00`,
				endsAt: `2026-09-18T${endsAt}:00.000+02:00`,
				allDay: false,
				status: "active",
				details: {
					schemaVersion: 1,
					type: "session",
					descendantEventId,
				},
				placeId: teamVenueId,
			},
		});
	}
	await write(`event-roots/${teamRootEventId}/feed`, {
		name: "feed.decision.create",
		method: "POST",
		expectedStatus: 201,
		body: {
			id: teamDecisionFeedId,
			eventId: teamEventIds.decisions,
			parentEntryId: null,
			kind: "message",
			body: "Decision log: owners and next steps are confirmed here.",
		},
	});
	await publishFixtureRoot(request, context.operationId, teamRootEventId);

	const participantFlow = context.offlineFlowPlatform
		? requiredOfflineFlow("team-event", context.offlineFlowPlatform)
		: null;
	const participantFeedId = participantFlow
		? materializeOfflineEntityId(participantFlow, participant.userId)
		: null;
	if (participantFlow && participantFeedId) {
		const participantBootstrap = await participantRequest(
			`sync/bootstrap?rootEventId=${teamRootEventId}&limit=200`,
			{
				method: "GET",
				requestId: offlineRequestId(participantFlow, "sync.bootstrap"),
				expectedStatus: 200,
			},
		);
		const participantCursor = assertTeamParticipantBootstrap(
			participantBootstrap.value,
			participant.userId,
		);
		const participantWrite = replayWriter(participantRequest, (_name, replay) =>
			offlineRequestId(
				participantFlow,
				replay ? "sync.push.replay" : "sync.push",
			),
		);
		assertSyncMutationApplied(
			await participantWrite("sync/push", {
				name: "participant offline feed",
				method: "POST",
				expectedStatus: 200,
				body: {
					protocolVersion: 1,
					rootEventId: teamRootEventId,
					deviceId: participantFlow.deviceId,
					mutations: [
						{
							clientMutationId: participantFlow.clientMutationId,
							clientSequence: 1,
							kind: participantFlow.queuedIntent.kind,
							entityId: participantFeedId,
							payload: participantFlow.queuedIntent.payload,
						},
					],
				},
			}),
			"team participant offline feed",
			teamRootEventId,
			participantFlow.deviceId,
			participantFlow.clientMutationId,
			"feedEntry",
			participantFeedId,
		);
		const participantPull = await participantRequest(
			`sync/pull?rootEventId=${teamRootEventId}&cursor=${encodeURIComponent(participantCursor)}&limit=200`,
			{
				method: "GET",
				requestId: offlineRequestId(participantFlow, "sync.pull"),
				expectedStatus: 200,
			},
		);
		assertTeamParticipantPull(
			participantPull.value,
			participantFeedId,
			participant.userId,
		);
	}

	const [memberships, places, itinerary, feed] = await Promise.all([
		request(`event-roots/${teamRootEventId}/memberships?limit=50`, {
			method: "GET",
			requestId: context.operationId("memberships.read"),
			expectedStatus: 200,
		}),
		request(`event-roots/${teamRootEventId}/places?limit=50`, {
			method: "GET",
			requestId: context.operationId("places.read"),
			expectedStatus: 200,
		}),
		request(
			`event-roots/${teamRootEventId}/events/${teamRootEventId}/itinerary?limit=50`,
			{
				method: "GET",
				requestId: context.operationId("itinerary.read"),
				expectedStatus: 200,
			},
		),
		request(`event-roots/${teamRootEventId}/feed?limit=50`, {
			method: "GET",
			requestId: context.operationId("feed.read"),
			expectedStatus: 200,
		}),
	]);
	assertTeamReadback(
		memberships.value,
		places.value,
		itinerary.value,
		feed.value,
		context.userId,
		participant.userId,
		participantFeedId,
	);
	return { participantUserId: participant.userId };
}

async function requestJson(
	fetcher: Fetch,
	baseUrl: URL,
	path: string,
	options: {
		method: string;
		requestId: string;
		expectedStatus: number;
		idempotencyKey?: string;
		accessToken?: string;
		body?: unknown;
	},
): Promise<JsonResult> {
	const headers = new Headers({
		Accept: "application/json",
		"X-Request-ID": options.requestId,
	});
	if (options.idempotencyKey) {
		headers.set("Idempotency-Key", options.idempotencyKey);
	}
	if (options.accessToken) {
		headers.set("Authorization", `Bearer ${options.accessToken}`);
	}
	if (options.body !== undefined)
		headers.set("Content-Type", "application/json");
	const response = await fetcher(new URL(path, baseUrl), {
		method: options.method,
		headers,
		redirect: "error",
		signal: AbortSignal.timeout(5_000),
		...(options.body === undefined
			? {}
			: { body: JSON.stringify(options.body) }),
	});
	if (response.headers.get("X-Request-ID") !== options.requestId) {
		await response.body?.cancel();
		throw new Error(
			`Fixture ${options.method} ${path} did not echo the request ID`,
		);
	}
	if (response.status !== options.expectedStatus) {
		await response.body?.cancel();
		throw new Error(
			`Fixture ${options.method} ${path} returned HTTP ${response.status}`,
		);
	}
	const raw = await readBoundedResponse(
		response,
		1_048_576,
		`Fixture ${options.method} ${path}`,
	);
	try {
		return { value: JSON.parse(raw), raw, headers: response.headers };
	} catch {
		throw new Error(`Fixture ${options.method} ${path} returned invalid JSON`);
	}
}

async function consumeMagicLink(
	fetcher: Fetch,
	provider: URL,
	bearer: string,
	email: string,
	sleep: (milliseconds: number) => Promise<void>,
) {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const response = await fetcher(
			new URL("internal/magic-links/consume", provider),
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${bearer}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ email }),
				redirect: "error",
				signal: AbortSignal.timeout(2_000),
			},
		);
		if (response.status === 404) {
			await response.body?.cancel();
			await sleep(250);
			continue;
		}
		if (response.status !== 200) {
			await response.body?.cancel();
			throw new Error(
				`Fixture magic-link consume returned HTTP ${response.status}`,
			);
		}
		const raw = await readBoundedResponse(
			response,
			1_024,
			"Fixture magic-link consume",
		);
		let payload: unknown;
		try {
			payload = JSON.parse(raw);
		} catch {
			throw new Error("Fixture magic-link consume returned invalid JSON");
		}
		const magicLinkToken = requiredString(
			record(payload, "magic-link delivery").token,
			"magic-link delivery token",
		);
		if (!/^ml_[A-Za-z0-9_-]{43}$/.test(magicLinkToken)) {
			throw new Error("Fixture provider returned an invalid magic-link token");
		}
		return magicLinkToken;
	}
	throw new Error("Fixture magic-link delivery did not arrive in time");
}

function assertReplay(
	first: JsonResult,
	replay: JsonResult,
	operation: string,
) {
	if (replay.headers.get("Idempotency-Replayed") !== "true") {
		throw new Error(`Fixture ${operation} was not marked as replayed`);
	}
	if (first.raw !== replay.raw) {
		throw new Error(`Fixture ${operation} replay changed the response`);
	}
}

function assertRoot(
	value: unknown,
	rootEventId: string,
	expectedEventIds: readonly string[],
	scenario: FixtureScenario,
) {
	const root = record(value, "event root");
	if (
		root.rootEventId !== rootEventId ||
		!/^\d+$/.test(String(root.rootRevision)) ||
		BigInt(String(root.rootRevision)) < 1n
	) {
		throw new Error("Fixture event root identity or revision is invalid");
	}
	if (!Array.isArray(root.events)) {
		throw new Error("Fixture event root has no event graph");
	}
	const actualIds = root.events
		.map((event) => requiredString(record(event, "event").id, "event.id"))
		.sort();
	const expectedIds = [...expectedEventIds].sort();
	if (actualIds.join("\0") !== expectedIds.join("\0")) {
		throw new Error("Fixture event root has an unexpected graph");
	}
	if (!Array.isArray(root.capabilities)) {
		throw new Error("Fixture event root has no capabilities");
	}
	const expectedCapabilities =
		scenario === "golf-tour"
			? new Map([
					[golfEventIds.root, "travel"],
					[golfEventIds.arrival, "transport"],
					[golfEventIds.lodging, "lodging"],
					...Object.values(golfRoundEventIds).map(
						(eventId) => [eventId, "golf"] as const,
					),
				])
			: new Map([[teamEventIds.root, "team"]]);
	const actualCapabilities = new Map<string, string>();
	let teamConfig: Record<string, unknown> | undefined;
	for (const value of root.capabilities) {
		const capability = record(value, "capability");
		const eventId = requiredString(capability.eventId, "capability.eventId");
		if (
			capability.rootEventId !== rootEventId ||
			capability.schemaVersion !== 1 ||
			actualCapabilities.has(eventId)
		) {
			throw new Error("Fixture event root has an invalid capability");
		}
		actualCapabilities.set(
			eventId,
			requiredString(capability.type, "capability.type"),
		);
		if (capability.type === "team") {
			teamConfig = record(capability.config, "team capability config");
		}
	}
	if (
		actualCapabilities.size !== expectedCapabilities.size ||
		[...expectedCapabilities].some(
			([eventId, type]) => actualCapabilities.get(eventId) !== type,
		)
	) {
		throw new Error("Fixture event root has unexpected capabilities");
	}
	if (
		scenario === "team-event" &&
		(!teamConfig ||
			teamConfig.venuePlaceId !== teamVenueId ||
			teamConfig.assignmentMode !== "organizer" ||
			teamConfig.capacityPerTeam !== 6 ||
			teamConfig.facilitator !== "Local Crew Organizer")
	) {
		throw new Error("Fixture team capability metadata is invalid");
	}
}

function assertCreatedRoot(value: unknown, rootEventId: string) {
	const event = record(record(value, "event creation").event, "created event");
	if (event.id !== rootEventId || event.rootEventId !== rootEventId) {
		throw new Error("Fixture event creation returned an unexpected root");
	}
}

function assertMembership(
	value: unknown,
	rootEventId: string,
	userId: string,
	role: string,
) {
	const membership = record(
		record(value, "membership response").membership,
		"membership",
	);
	if (
		membership.rootEventId !== rootEventId ||
		membership.userId !== userId ||
		membership.role !== role ||
		membership.status !== "active"
	) {
		throw new Error(`Fixture ${role} membership is invalid`);
	}
}

function assertSyncMutationApplied(
	value: unknown,
	name: string,
	rootEventId: string,
	deviceId: string,
	clientMutationId: string,
	entityType: "golfRound" | "golfScore" | "feedEntry",
	entityId: string,
) {
	const response = record(value, `${name} response`);
	const results = records(response.results, `${name} response.results`);
	const result = results[0];
	const entity = result && record(result.entity, `${name} entity`);
	if (
		response.protocolVersion !== 1 ||
		response.rootEventId !== rootEventId ||
		response.deviceId !== deviceId ||
		response.nextExpectedClientSequence !== 2 ||
		results.length !== 1 ||
		result?.clientMutationId !== clientMutationId ||
		result?.outcome !== "applied" ||
		result.replayed !== false ||
		!entity ||
		entity.entityType !== entityType ||
		entity.entityId !== entityId ||
		entity.version !== 1
	) {
		throw new Error(`Fixture ${name} did not apply`);
	}
}

function assertParticipantGolfBootstrap(
	value: unknown,
	eventId: string,
	participantUserId: string,
) {
	const snapshot = record(value, "participant golf bootstrap");
	const pageInfo = record(
		snapshot.pageInfo,
		"participant golf bootstrap.pageInfo",
	);
	const golfRecords = records(
		snapshot.records,
		"participant golf bootstrap.records",
	).filter(({ entityType }) => String(entityType).startsWith("golf"));
	if (
		snapshot.protocolVersion !== 1 ||
		snapshot.rootEventId !== golfRootEventId ||
		pageInfo.hasMore !== false ||
		golfRecords
			.map(({ entityType }) => String(entityType))
			.sort()
			.join(",") !== "golfLeaderboard,golfPlayer,golfRound"
	) {
		throw new Error("Fixture participant golf bootstrap is incomplete");
	}
	const round = record(
		golfRecords.find(({ entityType }) => entityType === "golfRound")?.data,
		"participant golf round",
	);
	const player = record(
		golfRecords.find(({ entityType }) => entityType === "golfPlayer")?.data,
		"participant golf player",
	);
	const leaderboard = record(
		golfRecords.find(({ entityType }) => entityType === "golfLeaderboard")
			?.data,
		"participant golf leaderboard",
	);
	const participantEntry = records(
		leaderboard.entries,
		"participant golf leaderboard.entries",
	).find(({ userId }) => userId === participantUserId);
	if (
		round.eventId !== eventId ||
		round.version !== 1 ||
		records(round.holes, "participant golf round.holes").length !== 18 ||
		player.eventId !== eventId ||
		player.userId !== participantUserId ||
		player.playingHandicap !== 18 ||
		leaderboard.eventId !== eventId ||
		leaderboard.version !== 1 ||
		participantEntry?.stablefordPoints !== 0 ||
		participantEntry.holesCompleted !== 0
	) {
		throw new Error("Fixture participant golf bootstrap is invalid");
	}
	return requiredString(snapshot.syncCursor, "participant golf sync cursor");
}

function assertParticipantGolfPull(
	value: unknown,
	eventId: string,
	participantUserId: string,
	scoreId: string,
) {
	const pull = record(value, "participant golf pull");
	const pageInfo = record(pull.pageInfo, "participant golf pull.pageInfo");
	const changes = records(pull.changes, "participant golf pull.changes");
	const score = record(
		changes.find(({ entityType }) => entityType === "golfScore")?.data,
		"participant golf score",
	);
	const leaderboard = record(
		changes.find(({ entityType }) => entityType === "golfLeaderboard")?.data,
		"participant pulled golf leaderboard",
	);
	const participantEntry = records(
		leaderboard.entries,
		"participant pulled golf leaderboard.entries",
	).find(({ userId }) => userId === participantUserId);
	if (
		pull.protocolVersion !== 1 ||
		pull.rootEventId !== golfRootEventId ||
		pageInfo.hasMore !== false ||
		changes.map(({ entityType }) => entityType).join(",") !==
			"golfScore,golfLeaderboard" ||
		score.id !== scoreId ||
		score.eventId !== eventId ||
		score.userId !== participantUserId ||
		score.hole !== 1 ||
		score.strokes !== 4 ||
		score.putts !== 2 ||
		score.playingHandicap !== 18 ||
		score.handicapStrokes !== 1 ||
		score.netStrokes !== 3 ||
		score.stablefordPoints !== 3 ||
		score.version !== 1 ||
		leaderboard.eventId !== eventId ||
		leaderboard.version !== 2 ||
		participantEntry?.rank !== 1 ||
		participantEntry.stablefordPoints !== 3 ||
		participantEntry.holesCompleted !== 1
	) {
		throw new Error("Fixture participant golf pull did not converge");
	}
}

function assertTeamParticipantBootstrap(
	value: unknown,
	participantUserId: string,
) {
	const snapshot = record(value, "team participant bootstrap");
	const pageInfo = record(
		snapshot.pageInfo,
		"team participant bootstrap.pageInfo",
	);
	const snapshotRecords = records(
		snapshot.records,
		"team participant bootstrap.records",
	);
	const membership = snapshotRecords.find(
		(item) =>
			item.entityType === "membership" &&
			record(item.data, "team participant membership").userId ===
				participantUserId,
	);
	if (
		snapshot.protocolVersion !== 1 ||
		snapshot.rootEventId !== teamRootEventId ||
		pageInfo.hasMore !== false ||
		!membership ||
		!snapshotRecords.some(
			(item) =>
				item.entityType === "event" &&
				record(item.data, "team participant root").id === teamRootEventId,
		)
	) {
		throw new Error("Fixture team participant bootstrap is incomplete");
	}
	return requiredString(snapshot.syncCursor, "team participant sync cursor");
}

function assertTeamParticipantPull(
	value: unknown,
	feedEntryId: string,
	participantUserId: string,
) {
	const pull = record(value, "team participant pull");
	const pageInfo = record(pull.pageInfo, "team participant pull.pageInfo");
	const feedEntry = record(
		records(pull.changes, "team participant pull.changes").find(
			(item) =>
				item.entityType === "feedEntry" && item.entityId === feedEntryId,
		)?.data,
		"team participant feed entry",
	);
	if (
		pull.protocolVersion !== 1 ||
		pull.rootEventId !== teamRootEventId ||
		pageInfo.hasMore !== false ||
		feedEntry.id !== feedEntryId ||
		feedEntry.actorUserId !== participantUserId ||
		record(feedEntry.payload, "team participant feed payload").text !==
			teamParticipantFeedBody
	) {
		throw new Error("Fixture team participant pull did not converge");
	}
}

function assertGolfReadback(
	membershipsValue: unknown,
	invitationsValue: unknown,
	placesValue: unknown,
	snapshotValue: unknown,
	participantItineraryValue: unknown,
	participantFeedValue: unknown,
	users: {
		ownerUserId: string;
		organizerUserId: string;
		participantUserId: string;
	},
	offlineMutationApplied: boolean,
) {
	const memberships = records(
		record(membershipsValue, "memberships").items,
		"memberships.items",
	);
	for (const [userId, role] of [
		[users.ownerUserId, "owner"],
		[users.organizerUserId, "organizer"],
		[users.participantUserId, "participant"],
	] as const) {
		if (
			!memberships.some(
				(item) =>
					item.userId === userId &&
					item.role === role &&
					item.status === "active",
			)
		) {
			throw new Error(`Fixture ${role} readback is missing`);
		}
	}
	const invitations = records(
		record(invitationsValue, "invitations").items,
		"invitations.items",
	);
	for (const [id, role] of [
		[golfOrganizerInvitationId, "organizer"],
		[golfParticipantInvitationId, "participant"],
	] as const) {
		if (
			!invitations.some(
				(item) =>
					item.id === id &&
					item.role === role &&
					item.emailBound === true &&
					item.useCount === 1,
			)
		) {
			throw new Error(`Fixture ${role} invitation readback is missing`);
		}
	}
	const places = records(record(placesValue, "places").items, "places.items");
	const expectedPlaceIds = new Set<string>([
		...Object.values(golfPlaceIds),
		...golfCourses.map((course) => course.placeId),
	]);
	if (
		places.length !== expectedPlaceIds.size ||
		places.some(
			(place) => !expectedPlaceIds.has(requiredString(place.id, "place.id")),
		)
	) {
		throw new Error("Fixture golf places readback is invalid");
	}
	const snapshot = record(snapshotValue, "sync bootstrap");
	if (
		snapshot.rootEventId !== golfRootEventId ||
		snapshot.protocolVersion !== 1 ||
		record(snapshot.pageInfo, "sync bootstrap.pageInfo").hasMore !== false
	) {
		throw new Error("Fixture sync bootstrap is incomplete");
	}
	const snapshotRecords = records(snapshot.records, "sync bootstrap.records");
	const dataFor = (entityType: string) =>
		snapshotRecords
			.filter((item) => item.entityType === entityType)
			.map((item) => record(item.data, `${entityType} data`));
	if (
		dataFor("event").length !== golfExpectedEventIds.length ||
		dataFor("membership").length !== 3 ||
		dataFor("invitation").length !== 2 ||
		dataFor("place").length !== expectedPlaceIds.size ||
		dataFor("capability").length !== 8
	) {
		throw new Error("Fixture sync bootstrap has incomplete root records");
	}
	const itinerary = dataFor("itineraryItem");
	const detailTypes = itinerary.map(
		(item) => record(item.details, "itinerary details").type,
	);
	const counts = (type: string) =>
		detailTypes.filter((value) => value === type).length;
	if (
		itinerary.length !== 11 ||
		counts("flight") !== 1 ||
		counts("road_transfer") !== 2 ||
		counts("lodging") !== 1 ||
		counts("meal") !== 2 ||
		counts("golf_round") !== 5
	) {
		throw new Error("Fixture itinerary readback is incomplete");
	}
	const participantItinerary = records(
		record(participantItineraryValue, "participant itinerary").items,
		"participant itinerary.items",
	);
	if (
		!participantItinerary.some(
			(item) =>
				item.id === "iti_local_turkey_golf_transfer_in" &&
				item.notes ===
					"Meet at the arrivals group sign before the Belek transfer." &&
				item.version === 2,
		)
	) {
		throw new Error("Fixture participant itinerary update is missing");
	}
	const participantFeed = records(
		record(participantFeedValue, "participant feed").items,
		"participant feed.items",
	);
	const liveFeed = participantFeed.find(({ id }) => id === golfLiveFeedId);
	const reaction = liveFeed
		? records(liveFeed.reactions, "participant feed reactions")[0]
		: undefined;
	if (
		liveFeed?.eventId !== golfEventIds.arrival ||
		liveFeed.authorUserId !== users.organizerUserId ||
		liveFeed.body !== golfLiveFeedBody ||
		reaction?.reaction !== "celebrate" ||
		reaction.count !== 1 ||
		reaction.viewerPresent !== true
	) {
		throw new Error("Fixture participant feed update is incomplete");
	}
	const roundRecords = dataFor("golfRound");
	const rosterRecords = dataFor("golfRoster");
	const playerRecords = dataFor("golfPlayer");
	const scoreRecords = dataFor("golfScore");
	const leaderboardRecords = dataFor("golfLeaderboard");
	const round = roundRecords[0];
	const roster = rosterRecords[0];
	const ownerPlayer = playerRecords[0];
	const leaderboard = leaderboardRecords[0];
	const rosterPlayers = roster
		? records(roster.players, "owner golf roster.players")
		: [];
	const participantEntry = leaderboard
		? records(leaderboard.entries, "owner golf leaderboard.entries").find(
				({ userId }) => userId === users.participantUserId,
			)
		: undefined;
	if (
		roundRecords.length !== 1 ||
		rosterRecords.length !== 1 ||
		playerRecords.length !== 1 ||
		scoreRecords.length !== 0 ||
		leaderboardRecords.length !== 1 ||
		round?.eventId !== golfRoundEventIds.carya ||
		round.version !== 1 ||
		roster?.eventId !== golfRoundEventIds.carya ||
		roster?.version !== 1 ||
		rosterPlayers.length !== 3 ||
		!rosterPlayers.every(({ userId }) =>
			[
				users.ownerUserId,
				users.organizerUserId,
				users.participantUserId,
			].includes(String(userId)),
		) ||
		ownerPlayer?.eventId !== golfRoundEventIds.carya ||
		ownerPlayer.userId !== users.ownerUserId ||
		leaderboard?.eventId !== golfRoundEventIds.carya ||
		leaderboard.version !== (offlineMutationApplied ? 2 : 1) ||
		(offlineMutationApplied && participantEntry?.rank !== 1) ||
		participantEntry?.stablefordPoints !== (offlineMutationApplied ? 3 : 0) ||
		participantEntry.holesCompleted !== (offlineMutationApplied ? 1 : 0)
	) {
		throw new Error("Fixture owner golf sync readback is incomplete");
	}
}

function assertTeamReadback(
	membershipsValue: unknown,
	placesValue: unknown,
	itineraryValue: unknown,
	feedValue: unknown,
	ownerUserId: string,
	participantUserId: string,
	participantFeedId: string | null,
) {
	const memberships = records(
		record(membershipsValue, "memberships").items,
		"memberships.items",
	);
	for (const [userId, role] of [
		[ownerUserId, "owner"],
		[participantUserId, "participant"],
	] as const) {
		if (
			!memberships.some(
				(item) =>
					item.userId === userId &&
					item.role === role &&
					item.status === "active",
			)
		) {
			throw new Error(`Fixture team ${role} membership is missing`);
		}
	}
	const places = records(record(placesValue, "places").items, "places.items");
	if (
		!places.some(
			(item) =>
				item.id === teamVenueId &&
				item.name === "Crew Workshop Venue" &&
				item.countryCode === "CH",
		)
	) {
		throw new Error("Fixture venue readback is invalid");
	}
	const itinerary = records(
		record(itineraryValue, "itinerary").items,
		"itinerary.items",
	);
	const expectedItineraryIds = new Set([
		"iti_local_team_day_arrival",
		"iti_local_team_day_workshop_one",
		"iti_local_team_day_workshop_two",
		"iti_local_team_day_lunch",
		"iti_local_team_day_challenge",
		"iti_local_team_day_decisions",
		"iti_local_team_day_wrap_up",
	]);
	if (
		itinerary.length !== expectedItineraryIds.size ||
		itinerary.some(
			(item) =>
				!expectedItineraryIds.has(
					requiredString(item.id, "itinerary item ID"),
				) ||
				item.eventId !== teamRootEventId ||
				item.placeId !== teamVenueId,
		)
	) {
		throw new Error("Fixture agenda readback is invalid");
	}
	const feed = records(record(feedValue, "feed").items, "feed.items");
	const offlineFeedIds = new Set(
		fixtureOfflineFlows("team-event").map((flow) =>
			materializeOfflineEntityId(flow, participantUserId),
		),
	);
	const participantFeed = participantFeedId
		? feed.find(({ id }) => id === participantFeedId)
		: undefined;
	if (
		!feed.some(
			(item) =>
				item.id === teamDecisionFeedId &&
				item.eventId === teamEventIds.decisions &&
				item.kind === "message" &&
				item.body === "Decision log: owners and next steps are confirmed here.",
		) ||
		(participantFeedId
			? !participantFeed ||
				participantFeed.eventId !== teamEventIds.decisions ||
				participantFeed.authorUserId !== participantUserId ||
				participantFeed.kind !== "message" ||
				participantFeed.body !== teamParticipantFeedBody
			: feed.some(({ id }) => offlineFeedIds.has(String(id))))
	) {
		throw new Error("Fixture team feed readback is invalid");
	}
}

function localUrl(value: string, requiredPath: string) {
	const url = new URL(value);
	if (
		url.protocol !== "http:" ||
		!LOCAL_HOSTS.has(url.hostname) ||
		url.pathname !== requiredPath ||
		url.username !== "" ||
		url.password !== "" ||
		url.search !== "" ||
		url.hash !== ""
	) {
		throw new Error(
			`Fixture URL is not an allowed local ${requiredPath} endpoint`,
		);
	}
	return url;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Fixture ${name} is invalid`);
	}
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string) {
	if (!Array.isArray(value)) throw new Error(`Fixture ${name} is invalid`);
	return value.map((item, index) => record(item, `${name}[${index}]`));
}

function requiredString(value: unknown, name: string) {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`Fixture ${name} is invalid`);
	}
	return value;
}

function nullableString(value: unknown, name: string) {
	if (value === null) return null;
	return requiredString(value, name);
}

function nullableNumber(value: unknown, name: string) {
	if (value === null) return null;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`Fixture ${name} is invalid`);
	}
	return value;
}

function requiredRevision(value: unknown, name: string) {
	if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
		throw new Error(`Fixture ${name} is invalid`);
	}
	return value;
}

function requiredPositiveInteger(value: unknown, name: string) {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error(`Fixture ${name} is invalid`);
	}
	return value;
}

async function readBoundedResponse(
	response: Response,
	maximumBytes: number,
	context: string,
) {
	const declared = response.headers.get("content-length");
	if (declared && /^\d+$/.test(declared) && Number(declared) > maximumBytes) {
		await response.body?.cancel();
		throw new Error(`${context} returned too much data`);
	}
	if (!response.body) return "";
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let bytesRead = 0;
	let body = "";
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			bytesRead += value.byteLength;
			if (bytesRead > maximumBytes) {
				await reader.cancel();
				throw new Error(`${context} returned too much data`);
			}
			body += decoder.decode(value, { stream: true });
		}
		return body + decoder.decode();
	} finally {
		reader.releaseLock();
	}
}

if (import.meta.main) {
	const requestedScenario = Bun.env.CREW_FIXTURE_SCENARIO ?? "golf-tour";
	if (requestedScenario !== "golf-tour" && requestedScenario !== "team-event") {
		throw new Error("CREW_FIXTURE_SCENARIO must be golf-tour or team-event");
	}
	const requestedOfflinePlatform = Bun.env.CREW_FIXTURE_OFFLINE_PLATFORM;
	if (
		requestedOfflinePlatform !== undefined &&
		requestedOfflinePlatform !== "ios" &&
		requestedOfflinePlatform !== "android" &&
		requestedOfflinePlatform !== "none"
	) {
		throw new Error(
			"CREW_FIXTURE_OFFLINE_PLATFORM must be ios, android, or none",
		);
	}
	const result = await bootstrapFixture({
		gatewayUrl:
			Bun.env.FIXTURE_GATEWAY_URL ?? "http://api-gateway:3000/core/v1/",
		providerSinkUrl:
			Bun.env.FIXTURE_PROVIDER_SINK_URL ?? "http://provider-sink:3010/",
		providerSinkFixtureBearer: Bun.env.PROVIDER_SINK_FIXTURE_BEARER ?? "",
		localFixtureEnabled: Bun.env.CREW_LOCAL_FIXTURE === "1",
		scenario: requestedScenario,
		offlineFlowPlatform:
			requestedOfflinePlatform === "none"
				? null
				: requestedOfflinePlatform === "ios" ||
						requestedOfflinePlatform === "android"
					? requestedOfflinePlatform
					: undefined,
	});
	console.info(
		"Local API fixture ready",
		fixtureLogSummary(result, requestedScenario),
	);
}
