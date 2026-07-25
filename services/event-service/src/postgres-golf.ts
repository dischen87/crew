import type { Sql } from "postgres";
import { type Actor, DomainError, type Role } from "./domain";
import {
	calculateGolfScore,
	type GolfHoleInput,
	type GolfLeaderboard,
	type GolfRoundRecord,
	type GolfRoundSetupInput,
	type GolfScoreInput,
	type GolfScoreRecord,
	golfLeaderboardEntityId,
	golfPlayerEntityId,
	golfRosterEntityId,
	golfScoreEntityId,
	sameGolfRoundSetup,
	validateGolfRoundSetup,
} from "./golf-domain";

type RootAccess = { revision: string; role: Role };
type RoundRow = {
	version: number;
	leaderboardVersion: number;
	createdAt: Date;
	updatedAt: Date;
};
type ScoreRow = Omit<GolfScoreRecord, "rootRevision"> & {
	rootRevision: string;
};

export async function replaceGolfRound(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	eventId: string,
	baseVersion: number,
	rawInput: GolfRoundSetupInput,
) {
	const input = validateGolfRoundSetup(rawInput);
	await lockRoot(tx, actor, rootEventId, "manager");
	const visibility = await requireGolfCapability(
		tx,
		rootEventId,
		eventId,
		"setup",
	);
	await requireEligibleMemberships(tx, rootEventId, input);
	const current = await findGolfRound(tx, rootEventId, eventId);
	if (current && sameGolfRoundSetup(current, input)) {
		return {
			round: current,
			leaderboard: await readGolfLeaderboard(tx, rootEventId, eventId),
			rootRevision: await rootRevision(tx, rootEventId),
			unchanged: true,
		};
	}
	if (!current && baseVersion !== 0) throw versionConflict(0);
	if (current && current.version !== baseVersion)
		throw versionConflict(current.version);

	const hasScores = current
		? await golfRoundHasScores(tx, rootEventId, eventId)
		: false;
	const roundShapeChanged =
		!current ||
		JSON.stringify({ holes: current.holes, players: current.players }) !==
			JSON.stringify({ holes: input.holes, players: input.players });
	const inputPlayerIds = new Set(input.players.map(({ userId }) => userId));
	const removedPlayers = roundShapeChanged
		? (current?.players.filter(({ userId }) => !inputPlayerIds.has(userId)) ??
			[])
		: [];
	if (current && hasScores && roundShapeChanged) {
		throw conflict(
			"GOLF_ROUND_IMPACT_REVIEW_REQUIRED",
			"Resolve existing scores before changing holes or playing handicaps.",
		);
	}

	const version = (current?.version ?? 0) + 1;
	if (!current) {
		await tx`
			INSERT INTO event_golf_rounds (root_event_id, event_id)
			VALUES (${rootEventId}, ${eventId})
		`;
	} else {
		await tx`
			UPDATE event_golf_rounds SET version = ${version},
				leaderboard_version = leaderboard_version + 1, updated_at = now()
			WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
		`;
	}
	if (!current || (!hasScores && roundShapeChanged)) {
		await tx`
			DELETE FROM event_golf_round_team_members
			WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
		`;
		await tx`
			DELETE FROM event_golf_round_teams
			WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
		`;
		await tx`
			DELETE FROM event_golf_round_players
			WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
		`;
		await tx`
			DELETE FROM event_golf_round_holes
			WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
		`;
		for (const hole of input.holes) {
			await tx`
				INSERT INTO event_golf_round_holes (
					root_event_id, event_id, hole, par, stroke_index
				) VALUES (
					${rootEventId}, ${eventId}, ${hole.hole}, ${hole.par}, ${hole.strokeIndex}
				)
			`;
		}
		for (const player of input.players) {
			await tx`
				INSERT INTO event_golf_round_players (
					root_event_id, event_id, user_id, playing_handicap, version
				) VALUES (
					${rootEventId}, ${eventId}, ${player.userId},
					${player.playingHandicap}, ${version}
				)
			`;
		}
	} else {
		await tx`
			DELETE FROM event_golf_round_team_members
			WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
		`;
		await tx`
			DELETE FROM event_golf_round_teams
			WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
		`;
	}
	for (const [sortPosition, team] of input.teams.entries()) {
		await tx`
			INSERT INTO event_golf_round_teams (
				id, root_event_id, event_id, name, color, sort_position, version
			) VALUES (
				${team.id}, ${rootEventId}, ${eventId}, ${team.name}, ${team.color},
				${sortPosition}, ${version}
			)
		`;
		for (const userId of team.memberUserIds) {
			await tx`
				INSERT INTO event_golf_round_team_members (
					root_event_id, event_id, team_id, user_id
				) VALUES (${rootEventId}, ${eventId}, ${team.id}, ${userId})
			`;
		}
	}

	const revision = await nextRevision(tx, rootEventId);
	const round = required(await findGolfRound(tx, rootEventId, eventId));
	const leaderboard = await readGolfLeaderboard(tx, rootEventId, eventId);
	const audience = visibility ? "members" : "managers";
	await appendChange(
		tx,
		rootEventId,
		revision,
		0,
		"golfRound",
		eventId,
		round.version,
		golfRoundSync(round),
		audience,
	);
	await appendChange(
		tx,
		rootEventId,
		revision,
		1,
		"golfLeaderboard",
		golfLeaderboardEntityId(eventId),
		leaderboard.version,
		leaderboard,
		audience,
	);
	await appendChange(
		tx,
		rootEventId,
		revision,
		2,
		"golfRoster",
		golfRosterEntityId(eventId),
		round.version,
		golfRosterSync(round),
		"managers",
	);
	if (visibility && roundShapeChanged) {
		for (const [index, player] of round.players.entries()) {
			await appendChange(
				tx,
				rootEventId,
				revision,
				index + 3,
				"golfPlayer",
				golfPlayerEntityId(eventId, player.userId),
				round.version,
				{
					rootEventId,
					eventId,
					...player,
					version: round.version,
				},
				"actor",
				player.userId,
			);
		}
	}
	for (const [index, player] of removedPlayers.entries()) {
		await appendGolfPlayerTombstone(
			tx,
			rootEventId,
			revision,
			3 + round.players.length + index,
			eventId,
			player.userId,
			round.version,
			round.updatedAt,
		);
	}
	return { round, leaderboard, rootRevision: revision, unchanged: false };
}

export async function setGolfScore(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	eventId: string,
	entityId: string,
	baseVersion: number,
	input: GolfScoreInput,
) {
	await lockRoot(tx, actor, rootEventId, "participant");
	await requireGolfCapability(tx, rootEventId, eventId, "score");
	const expectedId = golfScoreEntityId(eventId, actor.id, input.hole);
	if (entityId !== expectedId)
		throw conflict(
			"SYNC_ENTITY_ID_MISMATCH",
			"The golf score ID does not match its event, player and hole.",
		);
	const [context] = await tx<
		{
			par: number;
			strokeIndex: number;
			playingHandicap: number;
			leaderboardVersion: number;
		}[]
	>`
		SELECT hole.par, hole.stroke_index AS "strokeIndex",
			player.playing_handicap AS "playingHandicap",
			round.leaderboard_version AS "leaderboardVersion"
		FROM event_golf_rounds round
		JOIN event_golf_round_holes hole
			ON hole.root_event_id = round.root_event_id AND hole.event_id = round.event_id
		JOIN event_golf_round_players player
			ON player.root_event_id = round.root_event_id AND player.event_id = round.event_id
		WHERE round.root_event_id = ${rootEventId} AND round.event_id = ${eventId}
			AND hole.hole = ${input.hole} AND player.user_id = ${actor.id}
		FOR UPDATE OF round
	`;
	if (!context) throw notFound();
	const calculated = calculateGolfScore(
		input,
		{ hole: input.hole, par: context.par, strokeIndex: context.strokeIndex },
		context.playingHandicap,
	);
	const current = await findGolfScore(
		tx,
		rootEventId,
		eventId,
		actor.id,
		input.hole,
	);
	if (current && sameGolfScore(current, input, calculated)) {
		return {
			score: current,
			leaderboard: await readGolfLeaderboard(tx, rootEventId, eventId),
			rootRevision: current.rootRevision,
			unchanged: true,
		};
	}
	if (!current && baseVersion !== 0) throw versionConflict(0);
	if (current && current.version !== baseVersion)
		throw versionConflict(current.version);

	const revision = await nextRevision(tx, rootEventId);
	const [score] = current
		? await tx<ScoreRow[]>`
			UPDATE event_golf_scores SET strokes = ${input.strokes}, putts = ${input.putts},
				playing_handicap = ${context.playingHandicap},
				handicap_strokes = ${calculated.handicapStrokes},
				net_strokes = ${calculated.netStrokes},
				stableford_points = ${calculated.stablefordPoints},
				version = version + 1, root_revision = ${revision}::bigint, updated_at = now()
			WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
				AND user_id = ${actor.id} AND hole = ${input.hole} AND version = ${baseVersion}
			RETURNING ${scoreColumns(tx)}
		`
		: await tx<ScoreRow[]>`
			INSERT INTO event_golf_scores (
				id, root_event_id, event_id, user_id, hole, strokes, putts,
				playing_handicap, handicap_strokes, net_strokes, stableford_points,
				root_revision
			) VALUES (
				${entityId}, ${rootEventId}, ${eventId}, ${actor.id}, ${input.hole},
				${input.strokes}, ${input.putts}, ${context.playingHandicap},
				${calculated.handicapStrokes}, ${calculated.netStrokes},
				${calculated.stablefordPoints}, ${revision}::bigint
			)
			RETURNING ${scoreColumns(tx)}
		`;
	if (!score) throw new Error("Golf score write invariant failed");
	const [round] = await tx<{ leaderboardVersion: number }[]>`
		UPDATE event_golf_rounds SET leaderboard_version = leaderboard_version + 1,
			updated_at = now()
		WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
		RETURNING leaderboard_version AS "leaderboardVersion"
	`;
	if (!round) throw new Error("Golf leaderboard write invariant failed");
	const leaderboard = await readGolfLeaderboard(tx, rootEventId, eventId);
	await appendChange(
		tx,
		rootEventId,
		revision,
		0,
		"golfScore",
		entityId,
		score.version,
		golfScoreSync(score),
		"actor",
		actor.id,
	);
	await appendChange(
		tx,
		rootEventId,
		revision,
		1,
		"golfLeaderboard",
		golfLeaderboardEntityId(eventId),
		leaderboard.version,
		leaderboard,
		"members",
	);
	return { score, leaderboard, rootRevision: revision, unchanged: false };
}

export async function assertGolfRoundReplaySafe(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	eventId: string,
) {
	await lockRoot(tx, actor, rootEventId, "manager");
	await requireGolfCapability(tx, rootEventId, eventId, "setup");
	required(await findGolfRound(tx, rootEventId, eventId));
}

export async function assertGolfScoreReplaySafe(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	eventId: string,
	entityId: string,
	hole: number,
) {
	await lockRoot(tx, actor, rootEventId, "participant");
	await requireGolfCapability(tx, rootEventId, eventId, "score");
	if (entityId !== golfScoreEntityId(eventId, actor.id, hole))
		throw conflict(
			"SYNC_ENTITY_ID_MISMATCH",
			"The golf score ID does not match its event, player and hole.",
		);
	await readGolfPlayerVersion(tx, rootEventId, eventId, actor.id);
}

export async function appendGolfPlayerRemovalChanges(
	tx: Sql,
	rootEventId: string,
	userId: string,
	revision: string,
	startOrdinal: number,
	deletedAt: Date,
) {
	const players = await tx<{ eventId: string; version: number }[]>`
		SELECT event_id AS "eventId", version
		FROM event_golf_round_players
		WHERE root_event_id = ${rootEventId} AND user_id = ${userId}
		ORDER BY event_id
	`;
	for (const [index, player] of players.entries()) {
		await appendGolfPlayerTombstone(
			tx,
			rootEventId,
			revision,
			startOrdinal + index,
			player.eventId,
			userId,
			player.version + 1,
			deletedAt,
		);
	}
	return players.length;
}

export async function getGolfRound(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	eventId: string,
) {
	const access = await readRootAccess(tx, actor, rootEventId);
	const visible = await requireGolfCapability(tx, rootEventId, eventId, "read");
	if (!visible && !manager(access.role)) throw notFound();
	const round = required(await findGolfRound(tx, rootEventId, eventId));
	return {
		round: manager(access.role)
			? round
			: {
					...round,
					players: round.players.filter((player) => player.userId === actor.id),
				},
		leaderboard: await readGolfLeaderboard(tx, rootEventId, eventId),
	};
}

export async function golfSnapshotRecords(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
) {
	const access = await readRootAccess(tx, actor, rootEventId);
	const rows = await tx<{ eventId: string }[]>`
		SELECT round.event_id AS "eventId"
		FROM event_golf_rounds round
		JOIN events event ON event.root_event_id = round.root_event_id
			AND event.id = round.event_id AND event.deleted_at IS NULL
		JOIN event_capabilities capability
			ON capability.root_event_id = round.root_event_id
			AND capability.event_id = round.event_id
			AND capability.capability_type = 'golf' AND capability.deleted_at IS NULL
		WHERE round.root_event_id = ${rootEventId}
			AND (${manager(access.role)} OR event_sync_event_is_member_visible(
				round.root_event_id, round.event_id
			))
		ORDER BY round.event_id
	`;
	const records: {
		entityType:
			| "golfRound"
			| "golfRoster"
			| "golfPlayer"
			| "golfScore"
			| "golfLeaderboard";
		entityId: string;
		entityVersion: number;
		data: Record<string, unknown>;
	}[] = [];
	for (const { eventId } of rows) {
		const round = required(await findGolfRound(tx, rootEventId, eventId));
		records.push({
			entityType: "golfRound",
			entityId: eventId,
			entityVersion: round.version,
			data: golfRoundSync(round),
		});
		if (manager(access.role)) {
			records.push({
				entityType: "golfRoster",
				entityId: golfRosterEntityId(eventId),
				entityVersion: round.version,
				data: golfRosterSync(round),
			});
		}
		const player =
			access.role === "viewer"
				? undefined
				: round.players.find((item) => item.userId === actor.id);
		if (player) {
			const playerVersion = await readGolfPlayerVersion(
				tx,
				rootEventId,
				eventId,
				actor.id,
			);
			records.push({
				entityType: "golfPlayer",
				entityId: golfPlayerEntityId(eventId, actor.id),
				entityVersion: playerVersion,
				data: { rootEventId, eventId, ...player, version: playerVersion },
			});
		}
		const scores =
			access.role === "viewer"
				? []
				: await tx<ScoreRow[]>`
					SELECT ${scoreColumns(tx)} FROM event_golf_scores
					WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
						AND user_id = ${actor.id}
					ORDER BY hole
				`;
		for (const score of scores) {
			records.push({
				entityType: "golfScore",
				entityId: score.id,
				entityVersion: score.version,
				data: golfScoreSync(score),
			});
		}
		const leaderboard = await readGolfLeaderboard(tx, rootEventId, eventId);
		records.push({
			entityType: "golfLeaderboard",
			entityId: golfLeaderboardEntityId(eventId),
			entityVersion: leaderboard.version,
			data: leaderboard,
		});
	}
	return records.sort(
		(left, right) =>
			left.entityType.localeCompare(right.entityType) ||
			left.entityId.localeCompare(right.entityId),
	);
}

export async function readGolfLeaderboard(
	tx: Sql,
	rootEventId: string,
	eventId: string,
): Promise<GolfLeaderboard> {
	const [round] = await tx<{ version: number }[]>`
		SELECT leaderboard_version AS version FROM event_golf_rounds
		WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
	`;
	if (!round) throw notFound();
	const rows = await tx<
		{
			userId: string;
			teamId: string | null;
			stablefordPoints: number;
			holesCompleted: number;
		}[]
	>`
		SELECT player.user_id AS "userId", member.team_id AS "teamId",
			COALESCE(
				sum(score.stableford_points) FILTER (WHERE score.strokes IS NOT NULL),
				0
			)::int AS "stablefordPoints",
			count(score.strokes)::int AS "holesCompleted"
		FROM event_golf_round_players player
		LEFT JOIN event_golf_round_team_members member
			ON member.root_event_id = player.root_event_id
			AND member.event_id = player.event_id AND member.user_id = player.user_id
		LEFT JOIN event_golf_scores score
			ON score.root_event_id = player.root_event_id
			AND score.event_id = player.event_id AND score.user_id = player.user_id
		WHERE player.root_event_id = ${rootEventId} AND player.event_id = ${eventId}
		GROUP BY player.user_id, member.team_id
		ORDER BY "stablefordPoints" DESC, player.user_id
	`;
	let rank = 0;
	let priorPoints: number | null = null;
	const entries = rows.map((row, index) => {
		if (priorPoints !== row.stablefordPoints) rank = index + 1;
		priorPoints = row.stablefordPoints;
		return { rank, ...row };
	});
	return { rootEventId, eventId, version: round.version, entries };
}

async function findGolfRound(
	tx: Sql,
	rootEventId: string,
	eventId: string,
): Promise<GolfRoundRecord | null> {
	const [row] = await tx<RoundRow[]>`
		SELECT version, leaderboard_version AS "leaderboardVersion",
			created_at AS "createdAt", updated_at AS "updatedAt"
		FROM event_golf_rounds
		WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
	`;
	if (!row) return null;
	const holes = await tx<GolfHoleInput[]>`
		SELECT hole, par, stroke_index AS "strokeIndex"
		FROM event_golf_round_holes
		WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
		ORDER BY hole
	`;
	const players = await tx<{ userId: string; playingHandicap: number }[]>`
		SELECT user_id AS "userId", playing_handicap AS "playingHandicap"
		FROM event_golf_round_players
		WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
		ORDER BY user_id
	`;
	const teamRows = await tx<
		{ id: string; name: string; color: string | null; sortPosition: number }[]
	>`
		SELECT id, name, color, sort_position AS "sortPosition"
		FROM event_golf_round_teams
		WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
		ORDER BY sort_position, id
	`;
	const memberships = await tx<{ teamId: string; userId: string }[]>`
		SELECT team_id AS "teamId", user_id AS "userId"
		FROM event_golf_round_team_members
		WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
		ORDER BY team_id, user_id
	`;
	return {
		rootEventId,
		eventId,
		holes,
		players,
		teams: teamRows.map(({ sortPosition: _, ...team }) => ({
			...team,
			memberUserIds: memberships
				.filter((membership) => membership.teamId === team.id)
				.map((membership) => membership.userId),
		})),
		...row,
	};
}

async function findGolfScore(
	tx: Sql,
	rootEventId: string,
	eventId: string,
	userId: string,
	hole: number,
) {
	const [score] = await tx<ScoreRow[]>`
		SELECT ${scoreColumns(tx)} FROM event_golf_scores
		WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
			AND user_id = ${userId} AND hole = ${hole}
		FOR UPDATE
	`;
	return score ?? null;
}

async function readGolfPlayerVersion(
	tx: Sql,
	rootEventId: string,
	eventId: string,
	userId: string,
) {
	const [row] = await tx<{ version: number }[]>`
		SELECT version FROM event_golf_round_players
		WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
			AND user_id = ${userId}
	`;
	if (!row) throw notFound();
	return row.version;
}

async function lockRoot(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	access: "manager" | "participant",
) {
	const [row] = await tx<RootAccess[]>`
		SELECT root.revision::text AS revision, membership.role
		FROM event_roots root
		JOIN event_memberships membership
			ON membership.root_event_id = root.root_event_id
		WHERE root.root_event_id = ${rootEventId} AND root.status = 'active'
			AND membership.user_id = ${actor.id} AND membership.status = 'active'
		FOR UPDATE OF root
	`;
	if (!row) throw notFound();
	if (access === "manager" && !manager(row.role)) throw forbidden();
	if (access === "participant" && row.role === "viewer") throw forbidden();
	return row;
}

async function readRootAccess(tx: Sql, actor: Actor, rootEventId: string) {
	const [row] = await tx<RootAccess[]>`
		SELECT root.revision::text AS revision, membership.role
		FROM event_roots root
		JOIN event_memberships membership
			ON membership.root_event_id = root.root_event_id
		WHERE root.root_event_id = ${rootEventId}
			AND membership.user_id = ${actor.id} AND membership.status = 'active'
	`;
	if (!row) throw notFound();
	return row;
}

async function requireGolfCapability(
	tx: Sql,
	rootEventId: string,
	eventId: string,
	access: "read" | "setup" | "score",
) {
	const [row] = await tx<
		{
			status: string;
			config: { scoringMode?: string; roundState?: string };
			visible: boolean;
		}[]
	>`
		SELECT event.status, capability.config,
			event_sync_event_is_member_visible(event.root_event_id, event.id) AS visible
		FROM events event
		JOIN event_capabilities capability
			ON capability.root_event_id = event.root_event_id
			AND capability.event_id = event.id
			AND capability.capability_type = 'golf'
		WHERE event.root_event_id = ${rootEventId} AND event.id = ${eventId}
			AND event.kind = 'golf' AND event.deleted_at IS NULL
			AND capability.deleted_at IS NULL
		FOR SHARE OF event, capability
	`;
	if (!row) throw notFound();
	if (row.config.scoringMode !== "stableford")
		throw conflict(
			"GOLF_SCORING_MODE_UNSUPPORTED",
			"This scorecard supports standard Stableford rounds.",
		);
	if (
		access === "score" &&
		(row.status !== "published" || row.config.roundState !== "open")
	)
		throw conflict(
			"GOLF_ROUND_NOT_OPEN",
			"The golf round is not open for scoring.",
		);
	if (
		access === "setup" &&
		row.status !== "draft" &&
		row.status !== "published"
	)
		throw conflict(
			"GOLF_ROUND_NOT_WRITABLE",
			"The golf round cannot be configured in its current event state.",
		);
	return row.visible;
}

async function requireEligibleMemberships(
	tx: Sql,
	rootEventId: string,
	input: GolfRoundSetupInput,
) {
	const rows = await tx<{ userId: string }[]>`
		SELECT user_id AS "userId" FROM event_memberships
		WHERE root_event_id = ${rootEventId} AND status = 'active'
			AND role <> 'viewer' AND user_id = ANY(${input.players.map((player) => player.userId)}::text[])
		FOR SHARE
	`;
	if (rows.length !== input.players.length)
		throw new DomainError(
			400,
			"GOLF_PLAYERS_INVALID",
			"Every eligible player must be an active non-viewer root member.",
		);
}

async function golfRoundHasScores(
	tx: Sql,
	rootEventId: string,
	eventId: string,
) {
	const [row] = await tx<{ found: boolean }[]>`
		SELECT EXISTS(
			SELECT 1 FROM event_golf_scores
			WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
		) AS found
	`;
	return row?.found ?? false;
}

async function nextRevision(tx: Sql, rootEventId: string) {
	const [row] = await tx<{ revision: string }[]>`
		UPDATE event_roots SET revision = revision + 1
		WHERE root_event_id = ${rootEventId}
		RETURNING revision::text AS revision
	`;
	if (!row) throw new Error("Golf root revision invariant failed");
	return row.revision;
}

async function rootRevision(tx: Sql, rootEventId: string) {
	const [row] = await tx<{ revision: string }[]>`
		SELECT revision::text AS revision FROM event_roots WHERE root_event_id = ${rootEventId}
	`;
	if (!row) throw notFound();
	return row.revision;
}

async function appendChange(
	tx: Sql,
	rootEventId: string,
	revision: string,
	ordinal: number,
	entityType: string,
	entityId: string,
	entityVersion: number,
	data: Record<string, unknown>,
	audience: "members" | "managers" | "actor",
	audienceUserId: string | null = null,
) {
	await tx`
		INSERT INTO event_root_changes (
			root_event_id, root_revision, ordinal, entity_type, entity_id,
			operation, entity_version, data, audience, audience_user_id
		) VALUES (
			${rootEventId}, ${revision}::bigint, ${ordinal}, ${entityType}, ${entityId},
			'upsert', ${entityVersion}, ${tx.json(data as never)}, ${audience},
			${audienceUserId}
		)
	`;
}

async function appendGolfPlayerTombstone(
	tx: Sql,
	rootEventId: string,
	revision: string,
	ordinal: number,
	eventId: string,
	userId: string,
	version: number,
	deletedAt: Date,
) {
	const id = golfPlayerEntityId(eventId, userId);
	await tx`
		INSERT INTO event_root_changes (
			root_event_id, root_revision, ordinal, entity_type, entity_id,
			operation, entity_version, tombstone, audience, audience_user_id
		) VALUES (
			${rootEventId}, ${revision}::bigint, ${ordinal}, 'golfPlayer', ${id},
			'tombstone', ${version}, ${tx.json({
				entityType: "golfPlayer",
				id,
				rootEventId,
				eventId,
				version,
				deletedAt,
			} as never)}, 'actor', ${userId}
		)
	`;
}

function scoreColumns(sql: Sql) {
	return sql`
		id, root_event_id AS "rootEventId", event_id AS "eventId",
		user_id AS "userId", hole, strokes, putts,
		playing_handicap AS "playingHandicap",
		handicap_strokes AS "handicapStrokes", net_strokes AS "netStrokes",
		stableford_points AS "stablefordPoints", version,
		root_revision::text AS "rootRevision", created_at AS "createdAt",
		updated_at AS "updatedAt"
	`;
}

function golfRoundSync(round: GolfRoundRecord) {
	return {
		rootEventId: round.rootEventId,
		eventId: round.eventId,
		holes: round.holes,
		teams: round.teams,
		version: round.version,
		updatedAt: round.updatedAt,
	};
}

function golfRosterSync(round: GolfRoundRecord) {
	return {
		rootEventId: round.rootEventId,
		eventId: round.eventId,
		players: round.players,
		version: round.version,
		updatedAt: round.updatedAt,
	};
}

function golfScoreSync(score: GolfScoreRecord) {
	return { ...score };
}

function sameGolfScore(
	current: GolfScoreRecord,
	input: GolfScoreInput,
	calculated: {
		handicapStrokes: number;
		netStrokes: number | null;
		stablefordPoints: number;
	},
) {
	return (
		current.strokes === input.strokes &&
		current.putts === input.putts &&
		current.handicapStrokes === calculated.handicapStrokes &&
		current.netStrokes === calculated.netStrokes &&
		current.stablefordPoints === calculated.stablefordPoints
	);
}

function manager(role: Role) {
	return role === "owner" || role === "organizer";
}

function required<T>(value: T | null): T {
	if (!value) throw notFound();
	return value;
}

function notFound() {
	return new DomainError(
		404,
		"NOT_FOUND",
		"The requested resource was not found.",
	);
}

function forbidden() {
	return new DomainError(
		403,
		"FORBIDDEN",
		"The actor cannot perform this operation.",
	);
}

function conflict(code: string, message: string) {
	return new DomainError(409, code, message);
}

function versionConflict(currentVersion: number) {
	return new DomainError(
		409,
		"VERSION_CONFLICT",
		"The entity version changed.",
		{},
		[
			{
				code: "CURRENT_VERSION",
				message: "Retry from the authoritative version.",
				meta: { currentVersion },
			},
		],
	);
}
