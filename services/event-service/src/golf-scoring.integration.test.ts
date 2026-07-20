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
import type { GolfRoundSetupInput } from "./golf-domain";
import { golfScoreEntityId } from "./golf-domain";
import {
	getGolfRound,
	golfSnapshotRecords,
	readGolfLeaderboard,
	replaceGolfRound,
	setGolfScore,
} from "./postgres-golf";

const databaseUrl =
	Bun.env.GOLF_SCORING_TEST_DATABASE_URL ??
	Bun.env.EVENT_TEST_DATABASE_URL ??
	"postgres://localhost/crew_event_test";
const userId = (value: number) => `usr_${value.toString(16).padStart(32, "0")}`;
const owner = { id: userId(910) } satisfies Actor;
const participant = { id: userId(911) } satisfies Actor;
const secondParticipant = { id: userId(912) } satisfies Actor;
const fourthPlayer = { id: userId(913) } satisfies Actor;
const fifthPlayer = { id: userId(914) } satisfies Actor;
const rootEventId = "evt_golfscore1";
const eventId = rootEventId;
let sql: Sql;

beforeAll(async () => {
	sql = postgres(databaseUrl, { max: 8 });
	await migrate(sql);
});

beforeEach(async () => {
	await sql`TRUNCATE event_idempotency_records, event_roots CASCADE`;
	await transaction(async (tx) => {
		await tx`INSERT INTO event_roots (root_event_id) VALUES (${rootEventId})`;
		await tx`
			INSERT INTO events (
				id, root_event_id, kind, title, time_zone, status
			) VALUES (
				${eventId}, ${rootEventId}, 'golf', 'Stableford Final',
				'Europe/Zurich', 'published'
			)
		`;
		for (const [actor, role] of [
			[owner, "owner"],
			[participant, "participant"],
			[secondParticipant, "participant"],
			[fourthPlayer, "participant"],
			[fifthPlayer, "participant"],
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
				${rootEventId}, ${eventId}, 'golf', 1,
				${tx.json({
					coursePlaceId: null,
					teeFormat: "individual",
					handicapMode: "required",
					scoringMode: "stableford",
					roundState: "open",
				} as never)}
			)
		`;
	});
});

afterAll(async () => {
	await sql.end();
});

describe("golf scoring against PostgreSQL", () => {
	test("stores one normalized 18-hole round idempotently and enforces flight capacity", async () => {
		const setup = roundSetup();
		const created = await transaction((tx) =>
			replaceGolfRound(tx, owner, rootEventId, eventId, 0, setup),
		);
		expect(created.unchanged).toBe(false);
		expect(created.round.version).toBe(1);
		expect(created.round.holes).toHaveLength(18);
		expect(created.rootRevision).toBe("1");

		const replay = await transaction((tx) =>
			replaceGolfRound(tx, owner, rootEventId, eventId, 0, setup),
		);
		expect(replay.unchanged).toBe(true);
		expect(replay.round.version).toBe(1);
		expect(replay.rootRevision).toBe("1");

		const participantView = await getGolfRound(
			sql,
			participant,
			rootEventId,
			eventId,
		);
		expect(participantView.round.players).toEqual([
			{ userId: participant.id, playingHandicap: 18 },
		]);
		expect(
			(await getGolfRound(sql, owner, rootEventId, eventId)).round.players,
		).toHaveLength(5);

		await expect(
			transaction(async (tx) => {
				await tx`
					INSERT INTO event_golf_round_team_members (
						root_event_id, event_id, team_id, user_id
					) VALUES (
						${rootEventId}, ${eventId}, 'gtm_alpha', ${fifthPlayer.id}
					)
				`;
			}),
		).rejects.toThrow("golf team cannot contain more than four players");

		await expect(
			transaction((tx) =>
				replaceGolfRound(tx, owner, rootEventId, eventId, 1, {
					...setup,
					holes: setup.holes.slice(0, 17),
				}),
			),
		).rejects.toMatchObject({ code: "GOLF_SCORECARD_INVALID", status: 400 });
	});

	test("handles plus handicaps, replay-safe scores and convergent rankings", async () => {
		const setup = roundSetup();
		await transaction((tx) =>
			replaceGolfRound(tx, owner, rootEventId, eventId, 0, setup),
		);

		const participantScore = await score(participant, 1, 4, 0);
		expect(participantScore.score).toMatchObject({
			handicapStrokes: 1,
			netStrokes: 3,
			stablefordPoints: 3,
			version: 1,
		});
		const changeCount = await countChanges();
		const replay = await score(participant, 1, 4, 0);
		expect(replay.unchanged).toBe(true);
		expect(replay.rootRevision).toBe(participantScore.rootRevision);
		expect(await countChanges()).toBe(changeCount);

		await score(secondParticipant, 1, 4, 0);
		const plusScore = await score(owner, 18, 4, 0);
		expect(plusScore.score).toMatchObject({
			handicapStrokes: -1,
			netStrokes: 5,
			stablefordPoints: 1,
		});

		const tied = await readGolfLeaderboard(sql, rootEventId, eventId);
		expect(tied.entries.slice(0, 3)).toEqual([
			{
				rank: 1,
				userId: participant.id,
				teamId: "gtm_alpha",
				stablefordPoints: 3,
				holesCompleted: 1,
			},
			{
				rank: 1,
				userId: secondParticipant.id,
				teamId: "gtm_alpha",
				stablefordPoints: 3,
				holesCompleted: 1,
			},
			{
				rank: 3,
				userId: owner.id,
				teamId: "gtm_alpha",
				stablefordPoints: 1,
				holesCompleted: 1,
			},
		]);

		await expect(score(participant, 1, 5, 0)).rejects.toMatchObject({
			code: "VERSION_CONFLICT",
			status: 409,
		});
		const changed = await score(participant, 1, 5, 1);
		expect(changed.score).toMatchObject({
			version: 2,
			netStrokes: 4,
			stablefordPoints: 2,
		});
		const converged = await readGolfLeaderboard(sql, rootEventId, eventId);
		expect(
			converged.entries
				.slice(0, 3)
				.map(({ userId, rank }) => ({ userId, rank })),
		).toEqual([
			{ userId: secondParticipant.id, rank: 1 },
			{ userId: participant.id, rank: 2 },
			{ userId: owner.id, rank: 3 },
		]);

		const snapshot = await golfSnapshotRecords(sql, participant, rootEventId);
		expect(
			snapshot.filter(({ entityType }) => entityType === "golfScore"),
		).toEqual([
			expect.objectContaining({
				entityId: golfScoreEntityId(eventId, participant.id, 1),
				entityVersion: 2,
			}),
		]);
		expect(
			snapshot.find(({ entityType }) => entityType === "golfLeaderboard")?.data,
		).toEqual(converged);

		const [scoreChange, leaderboardChange] = await sql<
			{
				rootRevision: string;
				ordinal: number;
				entityType: string;
				audience: string;
				audienceUserId: string | null;
			}[]
		>`
			SELECT root_revision::text AS "rootRevision", ordinal,
				entity_type AS "entityType", audience,
				audience_user_id AS "audienceUserId"
			FROM event_root_changes
			WHERE root_event_id = ${rootEventId}
				AND root_revision = ${changed.rootRevision}::bigint
			ORDER BY ordinal
		`;
		expect(scoreChange).toEqual({
			rootRevision: changed.rootRevision,
			ordinal: 0,
			entityType: "golfScore",
			audience: "actor",
			audienceUserId: participant.id,
		});
		expect(leaderboardChange).toEqual({
			rootRevision: changed.rootRevision,
			ordinal: 1,
			entityType: "golfLeaderboard",
			audience: "members",
			audienceUserId: null,
		});
	});

	test("keeps a cleared score unplayed in PostgreSQL and sync projections", async () => {
		await transaction((tx) =>
			replaceGolfRound(tx, owner, rootEventId, eventId, 0, roundSetup()),
		);
		await score(participant, 1, 4, 0);

		const cleared = await score(participant, 1, null, 1);
		expect(cleared.score).toMatchObject({
			strokes: null,
			putts: null,
			netStrokes: null,
			stablefordPoints: 0,
			version: 2,
		});
		expect(
			(await readGolfLeaderboard(sql, rootEventId, eventId)).entries.find(
				({ userId }) => userId === participant.id,
			),
		).toMatchObject({ stablefordPoints: 0, holesCompleted: 0 });
		expect(
			(await golfSnapshotRecords(sql, participant, rootEventId)).find(
				({ entityType }) => entityType === "golfScore",
			)?.data,
		).toMatchObject({
			strokes: null,
			putts: null,
			netStrokes: null,
			stablefordPoints: 0,
			version: 2,
		});
	});

	test("allows team-only edits but protects score-impacting configuration", async () => {
		const setup = roundSetup();
		const alphaTeam = setup.teams[0];
		if (!alphaTeam) throw new Error("Golf fixture team is missing");
		await transaction((tx) =>
			replaceGolfRound(tx, owner, rootEventId, eventId, 0, setup),
		);
		await score(participant, 1, 4, 0);

		const teamEdit = await transaction((tx) =>
			replaceGolfRound(tx, owner, rootEventId, eventId, 1, {
				...setup,
				teams: [
					{ ...alphaTeam, name: "Flight One" },
					{
						id: "gtm_beta",
						name: "Flight Beta",
						color: "#123456",
						memberUserIds: [fifthPlayer.id],
					},
				],
			}),
		);
		expect(teamEdit.round.version).toBe(2);
		expect(
			teamEdit.leaderboard.entries.find(
				({ userId }) => userId === fifthPlayer.id,
			)?.teamId,
		).toBe("gtm_beta");

		await expect(
			transaction((tx) =>
				replaceGolfRound(tx, owner, rootEventId, eventId, 2, {
					...teamEdit.round,
					players: teamEdit.round.players.map((player) =>
						player.userId === participant.id
							? { ...player, playingHandicap: 17 }
							: player,
					),
				}),
			),
		).rejects.toMatchObject({
			code: "GOLF_ROUND_IMPACT_REVIEW_REQUIRED",
			status: 409,
		});

		await sql`
			UPDATE event_capabilities
			SET config = jsonb_set(config, '{roundState}', '"closed"'::jsonb)
			WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
				AND capability_type = 'golf'
		`;
		await expect(
			(async () => {
				await sql`
					UPDATE event_capabilities
					SET config = jsonb_set(config, '{scoringMode}', '"stroke_play"'::jsonb)
					WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
						AND capability_type = 'golf'
				`;
			})(),
		).rejects.toThrow(
			"golf scoring configuration is immutable after scoring starts",
		);
		await expect(
			(async () => {
				await sql`
					UPDATE event_capabilities SET deleted_at = now()
					WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
						AND capability_type = 'golf'
				`;
			})(),
		).rejects.toThrow("golf capability has live round data");
	});
});

function roundSetup(): GolfRoundSetupInput {
	return {
		holes: Array.from({ length: 18 }, (_, index) => ({
			hole: index + 1,
			par: 4,
			strokeIndex: index + 1,
		})),
		players: [
			{ userId: owner.id, playingHandicap: -2 },
			{ userId: participant.id, playingHandicap: 18 },
			{ userId: secondParticipant.id, playingHandicap: 18 },
			{ userId: fourthPlayer.id, playingHandicap: 0 },
			{ userId: fifthPlayer.id, playingHandicap: 0 },
		],
		teams: [
			{
				id: "gtm_alpha",
				name: "Flight Alpha",
				color: "#00AA55",
				memberUserIds: [
					owner.id,
					participant.id,
					secondParticipant.id,
					fourthPlayer.id,
				],
			},
		],
	};
}

async function score(
	actor: Actor,
	hole: number,
	strokes: number | null,
	baseVersion: number,
) {
	return transaction((tx) =>
		setGolfScore(
			tx,
			actor,
			rootEventId,
			eventId,
			golfScoreEntityId(eventId, actor.id, hole),
			baseVersion,
			{ hole, strokes, putts: strokes === null ? null : 2 },
		),
	);
}

async function countChanges() {
	const [row] = await sql<{ count: number }[]>`
		SELECT count(*)::int AS count FROM event_root_changes
		WHERE root_event_id = ${rootEventId}
	`;
	return row?.count ?? 0;
}

function transaction<T>(operation: (tx: Sql) => Promise<T>) {
	return sql.begin((rawTransaction) =>
		operation(rawTransaction as unknown as Sql),
	) as Promise<T>;
}
