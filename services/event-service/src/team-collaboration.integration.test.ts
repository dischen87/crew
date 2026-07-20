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
import type { Actor } from "./domain";
import { EventNotificationPayloadCodec } from "./event-notification-payload";
import { PostgresEventRepository } from "./postgres-repository";
import { getTeamAssignments, getTeamDecision } from "./postgres-team";
import { EventService } from "./service";
import {
	type TeamAssignmentSetInput,
	teamResponseEntityId,
} from "./team-domain";

const databaseUrl =
	Bun.env.TEAM_COLLABORATION_TEST_DATABASE_URL ??
	Bun.env.EVENT_TEST_DATABASE_URL ??
	"postgres://localhost/crew_event_test";
const userId = (value: number) => `usr_${value.toString(16).padStart(32, "0")}`;
const owner = { id: userId(951) } satisfies Actor;
const organizer = { id: userId(952) } satisfies Actor;
const participant = { id: userId(953) } satisfies Actor;
const secondParticipant = { id: userId(954) } satisfies Actor;
const viewer = { id: userId(955) } satisfies Actor;
const outsider = { id: userId(956) } satisfies Actor;
const rootEventId = "evt_teamcollab1";
const eventId = rootEventId;
const decisionId = "tdc_teamlunch";
const responseId = teamResponseEntityId(decisionId, participant.id);
const ownerDevice = "dvc_00000000-0000-4000-8000-000000000951";
const participantDevice = "dvc_00000000-0000-4000-8000-000000000953";
let sql: Sql;
let repository: PostgresEventRepository;
let service: EventService;

beforeAll(async () => {
	sql = postgres(databaseUrl, { max: 12, onnotice: () => {} });
	await migrate(sql);
});

beforeEach(async () => {
	await sql`TRUNCATE event_idempotency_records, event_roots CASCADE`;
	await transaction(async (tx) => {
		await tx`INSERT INTO event_roots (root_event_id) VALUES (${rootEventId})`;
		await tx`
			INSERT INTO events (id, root_event_id, kind, title, time_zone, status)
			VALUES (
				${eventId}, ${rootEventId}, 'team_event', 'Team Day',
				'Europe/Zurich', 'published'
			)
		`;
		for (const [actor, role] of [
			[owner, "owner"],
			[organizer, "organizer"],
			[participant, "participant"],
			[secondParticipant, "participant"],
			[viewer, "viewer"],
		] as const) {
			await tx`
				INSERT INTO event_memberships (root_event_id, user_id, role)
				VALUES (${rootEventId}, ${actor.id}, ${role})
			`;
		}
		await tx`
			INSERT INTO event_capabilities (
				root_event_id, event_id, capability_type, schema_version, config
			) VALUES (
				${rootEventId}, ${eventId}, 'team', 1,
				${tx.json({
					venuePlaceId: null,
					assignmentMode: "organizer",
					capacityPerTeam: 2,
					facilitator: null,
				} as never)}
			)
		`;
	});
	repository = new PostgresEventRepository(
		sql,
		new EventNotificationPayloadCodec({
			kid: "team-collaboration-test-v1",
			key: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
		}),
	);
	service = new EventService(
		repository,
		"team-collaboration-invitation-key-with-at-least-32-characters",
		undefined,
		"team-collaboration-cursor-key-with-at-least-32-characters",
	);
});

afterAll(async () => {
	await sql.end();
});

describe("team collaboration against PostgreSQL", () => {
	test("publishes normalized capacity-safe assignments with scoped projections and CAS", async () => {
		const created = await service.syncPush(owner, "team-assignment-sync-1", {
			protocolVersion: 1,
			rootEventId,
			deviceId: ownerDevice,
			mutations: [
				{
					clientMutationId: mutationId(1),
					clientSequence: 1,
					kind: "team.assignments.publish",
					entityId: eventId,
					baseVersion: 0,
					payload: { eventId, teams: assignmentInput().teams },
				},
			],
		});
		expect(created.body.results[0]).toMatchObject({
			outcome: "applied",
			replayed: false,
			entity: {
				entityType: "teamAssignmentSet",
				entityId: eventId,
				version: 1,
			},
		});
		const replay = await service.syncPush(
			owner,
			"team-assignment-sync-replay",
			{
				protocolVersion: 1,
				rootEventId,
				deviceId: ownerDevice,
				mutations: [
					{
						clientMutationId: mutationId(1),
						clientSequence: 1,
						kind: "team.assignments.publish",
						entityId: eventId,
						baseVersion: 0,
						payload: { eventId, teams: assignmentInput().teams },
					},
				],
			},
		);
		expect(replay.body.results[0]).toMatchObject({
			outcome: "applied",
			replayed: true,
		});

		const participantView = await getTeamAssignments(
			sql,
			participant,
			rootEventId,
			eventId,
		);
		expect(participantView.roster).toBeNull();
		expect(participantView.assignment).toMatchObject({
			userId: participant.id,
			team: { id: "ttm_alpha", name: "Alpha" },
		});
		expect(JSON.stringify(participantView)).not.toContain(secondParticipant.id);
		const managerView = await getTeamAssignments(
			sql,
			organizer,
			rootEventId,
			eventId,
		);
		expect(JSON.stringify(managerView.roster)).toContain(secondParticipant.id);

		const participantSnapshot = await service.syncBootstrap(
			participant,
			rootEventId,
			undefined,
			200,
		);
		expect(
			participantSnapshot.records.some(
				({ entityType }) => entityType === "teamAssignment",
			),
		).toBe(true);
		expect(
			participantSnapshot.records.some(
				({ entityType }) => entityType === "teamAssignmentRoster",
			),
		).toBe(false);
		const managerSnapshot = await service.syncBootstrap(
			organizer,
			rootEventId,
			undefined,
			200,
		);
		expect(
			managerSnapshot.records.some(
				({ entityType }) => entityType === "teamAssignmentRoster",
			),
		).toBe(true);

		await expect(
			repository.publishTeamAssignments(
				viewer,
				rootEventId,
				eventId,
				1,
				assignmentInput(),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
		await expect(
			getTeamAssignments(sql, outsider, rootEventId, eventId),
		).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
		await expect(
			repository.publishTeamAssignments(owner, rootEventId, eventId, 1, {
				teams: [
					{
						id: "ttm_overflow",
						name: "Overflow",
						color: null,
						memberUserIds: [owner.id, participant.id, secondParticipant.id],
					},
				],
			}),
		).rejects.toMatchObject({ code: "TEAM_ASSIGNMENTS_INVALID", status: 400 });
		await expect(
			repository.replaceCapability(owner, rootEventId, eventId, 1, {
				type: "team",
				schemaVersion: 1,
				config: {
					venuePlaceId: null,
					assignmentMode: "organizer",
					capacityPerTeam: 1,
					facilitator: null,
				},
			}),
		).rejects.toMatchObject({ code: "TEAM_CAPACITY_CONFLICT", status: 409 });
		await expect(
			repository.removeCapability(owner, rootEventId, eventId, "team", 1),
		).rejects.toMatchObject({
			code: "CAPABILITY_DEPENDENCIES_EXIST",
			status: 409,
		});
		await expect(
			transaction(
				(tx) => tx`
				INSERT INTO event_team_members (
					root_event_id, event_id, team_id, user_id
				) VALUES (${rootEventId}, ${eventId}, 'ttm_alpha', ${owner.id})
			`,
			),
		).rejects.toThrow("team assignment exceeds configured capacity");

		const concurrent = await Promise.allSettled([
			repository.publishTeamAssignments(owner, rootEventId, eventId, 1, {
				teams: assignmentInput().teams.map((team) => ({
					...team,
					name: `${team.name} One`,
				})),
			}),
			repository.publishTeamAssignments(owner, rootEventId, eventId, 1, {
				teams: assignmentInput().teams.map((team) => ({
					...team,
					name: `${team.name} Two`,
				})),
			}),
		]);
		expect(
			concurrent.filter(({ status }) => status === "fulfilled"),
		).toHaveLength(1);
		expect(
			concurrent.filter(({ status }) => status === "rejected"),
		).toHaveLength(1);

		const feedBodies = await systemFeedBodies();
		expect(
			feedBodies.filter((body) => body.type === "team.assignments.published"),
		).toHaveLength(2);
	});

	test("opens and closes a sanitized decision while response replay survives close", async () => {
		await repository.replaceTeamDecision(
			owner,
			rootEventId,
			eventId,
			decisionId,
			0,
			decision("draft"),
		);
		const draftSnapshot = await service.syncBootstrap(
			secondParticipant,
			rootEventId,
			undefined,
			200,
		);
		expect(
			draftSnapshot.records.some(
				({ entityType }) => entityType === "teamDecision",
			),
		).toBe(false);

		const opened = await repository.replaceTeamDecision(
			organizer,
			rootEventId,
			eventId,
			decisionId,
			1,
			decision("open"),
		);
		expect(opened.decision).toMatchObject({
			state: "open",
			version: 2,
			aggregateVersion: 2,
		});

		const responseInput = {
			protocolVersion: 1 as const,
			rootEventId,
			deviceId: participantDevice,
			mutations: [
				{
					clientMutationId: mutationId(31),
					clientSequence: 1,
					kind: "team.response.set" as const,
					entityId: responseId,
					baseVersion: 0,
					payload: {
						eventId,
						decisionId,
						optionId: "tdo_pizza",
					},
				},
			],
		};
		const responded = await service.syncPush(
			participant,
			"team-response-sync-replay",
			responseInput,
		);
		expect(responded.body.results[0]).toMatchObject({
			outcome: "applied",
			entity: { entityType: "teamResponse", entityId: responseId, version: 1 },
		});

		const aggregate = await getTeamDecision(
			sql,
			secondParticipant,
			rootEventId,
			eventId,
			decisionId,
		);
		expect(aggregate.response).toBeNull();
		expect(aggregate.decision).toMatchObject({
			responseCount: 1,
			options: [
				{ id: "tdo_pizza", responseCount: 1 },
				{ id: "tdo_salad", responseCount: 0 },
			],
		});
		expect(JSON.stringify(aggregate.decision)).not.toContain(participant.id);

		await repository.replaceTeamDecision(
			organizer,
			rootEventId,
			eventId,
			decisionId,
			2,
			decision("closed"),
		);
		const replay = await service.syncPush(
			participant,
			"team-response-sync-1",
			responseInput,
		);
		expect(replay.body.results[0]).toMatchObject({
			outcome: "applied",
			replayed: true,
		});
		const changed = await service.syncPush(
			participant,
			"team-response-sync-2",
			{
				...responseInput,
				mutations: [
					{
						clientMutationId: mutationId(32),
						clientSequence: 2,
						kind: "team.response.set",
						entityId: responseId,
						baseVersion: 1,
						payload: {
							eventId,
							decisionId,
							optionId: "tdo_salad",
						},
					},
				],
			},
		);
		expect(changed.body.results[0]).toMatchObject({
			outcome: "rejected",
			error: { code: "TEAM_DECISION_NOT_OPEN" },
		});
		await expect(
			repository.setTeamResponse(
				viewer,
				rootEventId,
				eventId,
				decisionId,
				teamResponseEntityId(decisionId, viewer.id),
				0,
				"tdo_pizza",
			),
		).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
		await expect(
			getTeamDecision(sql, outsider, rootEventId, eventId, decisionId),
		).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

		const participantSnapshot = await service.syncBootstrap(
			participant,
			rootEventId,
			undefined,
			200,
		);
		expect(
			participantSnapshot.records.filter(
				({ entityType }) => entityType === "teamResponse",
			),
		).toEqual([
			expect.objectContaining({ entityId: responseId, entityVersion: 1 }),
		]);
		const managerSnapshot = await service.syncBootstrap(
			organizer,
			rootEventId,
			undefined,
			200,
		);
		expect(
			managerSnapshot.records.some(
				({ entityType }) => entityType === "teamResponse",
			),
		).toBe(false);

		const feedBodies = await systemFeedBodies();
		expect(feedBodies.map(({ type }) => type)).toEqual([
			"team.decision.opened",
			"team.decision.closed",
		]);
	});
});

function assignmentInput(): TeamAssignmentSetInput {
	return {
		teams: [
			{
				id: "ttm_alpha",
				name: "Alpha",
				color: "#00AA55",
				memberUserIds: [participant.id, secondParticipant.id],
			},
		],
	};
}

function decision(state: "draft" | "open" | "closed") {
	return {
		title: "What should we eat?",
		state,
		options: [
			{ id: "tdo_pizza", label: "Pizza" },
			{ id: "tdo_salad", label: "Salad" },
		],
	};
}

function mutationId(value: number) {
	return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

async function systemFeedBodies() {
	const rows = await sql<{ body: string }[]>`
		SELECT current.body
		FROM event_feed_entries entry
		JOIN event_feed_entry_current current
			ON current.root_event_id = entry.root_event_id
			AND current.entry_id = entry.id
		WHERE entry.root_event_id = ${rootEventId} AND entry.kind = 'system'
		ORDER BY entry.created_at, entry.id
	`;
	return rows.map(({ body }) => JSON.parse(body) as { type: string });
}

function transaction<T>(operation: (tx: Sql) => Promise<T>) {
	return sql.begin((rawTransaction) =>
		operation(rawTransaction as unknown as Sql),
	) as Promise<T>;
}
