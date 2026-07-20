import {
	calculateStableford,
	strokesReceivedOnHole,
} from "@crew/shared/stableford";
import type { SqlDatabase, SqlExecutor } from "./database.ts";
import type {
	SyncGolfLeaderboardData,
	SyncGolfPlayerData,
	SyncGolfRosterData,
	SyncGolfRoundData,
	SyncGolfScoreData,
} from "./sync.ts";

export type GolfSyncEntityType =
	| "golfRound"
	| "golfRoster"
	| "golfPlayer"
	| "golfScore"
	| "golfLeaderboard";

export type GolfSyncData =
	| SyncGolfRoundData
	| SyncGolfRosterData
	| SyncGolfPlayerData
	| SyncGolfScoreData
	| SyncGolfLeaderboardData;

export interface GolfRoundReadModel {
	accountUserId: string;
	rootEventId: string;
	eventId: string;
	version: number;
	updatedAt: string;
	holes: SyncGolfRoundData["holes"];
	players: SyncGolfPlayerData[];
	teams: SyncGolfRoundData["teams"];
}

export interface GolfScorecardHole {
	hole: number;
	par: number;
	strokeIndex: number;
	strokes: number | null;
	putts: number | null;
	handicapStrokes: number;
	netStrokes: number | null;
	stablefordPoints: number;
	version: number;
	isPending: boolean;
	authoritativeStrokes: number | null;
	authoritativePutts: number | null;
	authoritativeStablefordPoints: number | null;
}

export interface GolfRankingEntry {
	rank: number;
	userId: string;
	teamId: string | null;
	stablefordPoints: number;
	holesCompleted: number;
}

export interface GolfScoreIntentInput {
	accountUserId: string;
	clientIntentId: string;
	rootEventId: string;
	eventId: string;
	hole: number;
	strokes: number | null;
	putts: number | null;
	baseVersion: number;
}

export interface GolfScoreIntent extends GolfScoreIntentInput {
	scoreId: string;
	clientSequence: number;
	outboxClientMutationId: string | null;
	playingHandicap: number;
	handicapStrokes: number;
	netStrokes: number | null;
	stablefordPoints: number;
	state: "pending" | "awaiting_pull" | "converged";
	appliedEntityVersion: number | null;
	createdAt: string;
	updatedAt: string;
}

interface IntentRow {
	account_user_id: string;
	client_intent_id: string;
	root_event_id: string;
	event_id: string;
	score_id: string;
	user_id: string;
	hole: number;
	client_sequence: number;
	outbox_client_mutation_id: string | null;
	base_version: number;
	strokes: number | null;
	putts: number | null;
	playing_handicap: number;
	handicap_strokes: number;
	net_strokes: number | null;
	stableford_points: number;
	command_json: string;
	state: GolfScoreIntent["state"];
	applied_entity_version: number | null;
	created_at: string;
	updated_at: string;
}

interface ScoreRow {
	id: string;
	hole: number;
	strokes: number | null;
	putts: number | null;
	handicap_strokes: number;
	net_strokes: number | null;
	stableford_points: number;
	version: number;
}

const CLIENT_INTENT_ID = /^gsi_[A-Za-z0-9._:-]{1,96}$/;
const EVENT_ID = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const TEAM_ID = /^gtm_[A-Za-z0-9._:-]{1,96}$/;
const USER_ID = /^usr_[a-f0-9]{32}$/;
const HEX_COLOR = /^#[0-9A-F]{6}$/;
const POSITIVE_DECIMAL = /^[1-9]\d*$/;
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER - 1;

export const golfScoreServerAdapterStatus = "mutation_outbox" as const;

export class GolfOfflineStore {
	constructor(
		private readonly database: SqlDatabase,
		private readonly now: () => Date = () => new Date(),
	) {}

	async getRound(
		accountUserId: string,
		eventId: string,
	): Promise<GolfRoundReadModel | null> {
		const round = await this.database.first<{
			root_event_id: string;
			version: number;
			updated_at: string;
		}>(
			`SELECT root_event_id, version, updated_at FROM golf_rounds
WHERE account_user_id = ? AND event_id = ?`,
			[accountUserId, eventId],
		);
		if (!round) return null;
		const holes = await this.database.all<{
			hole: number;
			par: number;
			stroke_index: number;
		}>(
			`SELECT hole, par, stroke_index FROM golf_holes
WHERE account_user_id = ? AND event_id = ? ORDER BY hole`,
			[accountUserId, eventId],
		);
		const rosterPlayers = await this.database.all<{
			user_id: string;
			playing_handicap: number;
			roster_version: number;
		}>(
			`SELECT user_id, playing_handicap, roster_version
FROM golf_roster_players
WHERE account_user_id = ? AND event_id = ? ORDER BY user_id`,
			[accountUserId, eventId],
		);
		const selfPlayers = rosterPlayers.length
			? []
			: await this.database.all<{
					user_id: string;
					playing_handicap: number;
					version: number;
				}>(
					`SELECT user_id, playing_handicap, version FROM golf_players
WHERE account_user_id = ? AND event_id = ? ORDER BY user_id`,
					[accountUserId, eventId],
				);
		const players: SyncGolfPlayerData[] = rosterPlayers.length
			? rosterPlayers.map((player) => ({
					rootEventId: round.root_event_id,
					eventId,
					userId: player.user_id,
					playingHandicap: Number(player.playing_handicap),
					version: Number(player.roster_version),
				}))
			: selfPlayers.map((player) => ({
					rootEventId: round.root_event_id,
					eventId,
					userId: player.user_id,
					playingHandicap: Number(player.playing_handicap),
					version: Number(player.version),
				}));
		const teams = await this.database.all<{
			id: string;
			name: string;
			color: string | null;
		}>(
			`SELECT id, name, color FROM golf_teams
WHERE account_user_id = ? AND event_id = ? ORDER BY sort_position, id`,
			[accountUserId, eventId],
		);
		const members = await this.database.all<{
			team_id: string;
			user_id: string;
		}>(
			`SELECT team_id, user_id FROM golf_team_members
WHERE account_user_id = ? AND event_id = ? ORDER BY team_id, user_id`,
			[accountUserId, eventId],
		);
		return {
			accountUserId,
			rootEventId: round.root_event_id,
			eventId,
			version: Number(round.version),
			updatedAt: round.updated_at,
			holes: holes.map((hole) => ({
				hole: Number(hole.hole),
				par: Number(hole.par),
				strokeIndex: Number(hole.stroke_index),
			})),
			players,
			teams: teams.map((team) => ({
				...team,
				memberUserIds: members
					.filter((member) => member.team_id === team.id)
					.map((member) => member.user_id),
			})),
		};
	}

	async enqueueScore(input: GolfScoreIntentInput): Promise<GolfScoreIntent> {
		return this.database.transaction((transaction) =>
			enqueueGolfScoreIntent(transaction, input, this.now().toISOString()),
		);
	}

	async listScoreIntents(
		accountUserId: string,
		rootEventId: string,
	): Promise<readonly GolfScoreIntent[]> {
		const rows = await this.database.all<IntentRow>(
			`SELECT * FROM golf_score_intents
WHERE account_user_id = ? AND root_event_id = ? AND state <> 'converged'
ORDER BY client_sequence, client_intent_id`,
			[accountUserId, rootEventId],
		);
		return rows.map(mapIntent);
	}

	async markIntentAwaitingPull(
		accountUserId: string,
		clientIntentId: string,
		appliedEntityVersion: number,
	): Promise<GolfScoreIntent> {
		return this.database.transaction((transaction) =>
			acknowledgeGolfScoreIntent(
				transaction,
				accountUserId,
				clientIntentId,
				appliedEntityVersion,
				this.now().toISOString(),
			),
		);
	}

	async listScorecard(
		accountUserId: string,
		eventId: string,
		userId = accountUserId,
	): Promise<readonly GolfScorecardHole[]> {
		const holes = await this.database.all<{
			hole: number;
			par: number;
			stroke_index: number;
		}>(
			`SELECT hole, par, stroke_index FROM golf_holes
WHERE account_user_id = ? AND event_id = ? ORDER BY hole`,
			[accountUserId, eventId],
		);
		const player = await this.database.first<{ playing_handicap: number }>(
			`SELECT playing_handicap FROM golf_players
WHERE account_user_id = ? AND event_id = ? AND user_id = ?`,
			[accountUserId, eventId, userId],
		);
		if (!player && holes.length > 0)
			throw new Error("Golf player is unavailable for this account");
		const scores = await this.database.all<ScoreRow>(
			`SELECT id, hole, strokes, putts, handicap_strokes, net_strokes,
  stableford_points, version FROM golf_scores
WHERE account_user_id = ? AND event_id = ? AND user_id = ?`,
			[accountUserId, eventId, userId],
		);
		const scoreByHole = new Map(
			scores.map((score) => [Number(score.hole), score]),
		);
		const intentByHole = new Map<number, IntentRow>();
		if (userId === accountUserId) {
			const intents = await this.database.all<IntentRow>(
				`SELECT * FROM golf_score_intents
WHERE account_user_id = ? AND event_id = ? AND user_id = ?
  AND state <> 'converged'
ORDER BY client_sequence`,
				[accountUserId, eventId, userId],
			);
			for (const intent of intents)
				intentByHole.set(Number(intent.hole), intent);
		}
		return holes.map((hole) => {
			const intent = intentByHole.get(Number(hole.hole));
			const score = scoreByHole.get(Number(hole.hole));
			const handicapStrokes = strokesReceivedOnHole(
				Number(player?.playing_handicap ?? 0),
				Number(hole.stroke_index),
			);
			return {
				hole: Number(hole.hole),
				par: Number(hole.par),
				strokeIndex: Number(hole.stroke_index),
				strokes: intent ? intent.strokes : (score?.strokes ?? null),
				putts: intent ? intent.putts : (score?.putts ?? null),
				handicapStrokes: intent
					? Number(intent.handicap_strokes)
					: Number(score?.handicap_strokes ?? handicapStrokes),
				netStrokes: intent ? intent.net_strokes : (score?.net_strokes ?? null),
				stablefordPoints: Number(
					intent?.stableford_points ?? score?.stableford_points ?? 0,
				),
				version: Number(score?.version ?? 0),
				isPending: intent !== undefined,
				authoritativeStrokes: score?.strokes ?? null,
				authoritativePutts: score?.putts ?? null,
				authoritativeStablefordPoints:
					score === undefined ? null : Number(score.stableford_points),
			};
		});
	}

	async listRanking(
		accountUserId: string,
		eventId: string,
	): Promise<readonly GolfRankingEntry[]> {
		const rows = await this.database.all<{
			user_id: string;
			team_id: string | null;
			stableford_points: number;
			holes_completed: number;
		}>(
			`SELECT user_id, team_id, stableford_points, holes_completed
FROM golf_rankings WHERE account_user_id = ? AND event_id = ?`,
			[accountUserId, eventId],
		);
		const entries = new Map(
			rows.map((row) => [
				row.user_id,
				{
					rank: 0,
					userId: row.user_id,
					teamId: row.team_id,
					stablefordPoints: Number(row.stableford_points),
					holesCompleted: Number(row.holes_completed),
				},
			]),
		);
		if (!entries.has(accountUserId)) {
			const player = await this.database.first<{ team_id: string | null }>(
				`SELECT member.team_id FROM golf_players player
LEFT JOIN golf_team_members member
  ON member.account_user_id = player.account_user_id
 AND member.event_id = player.event_id AND member.user_id = player.user_id
WHERE player.account_user_id = ? AND player.event_id = ? AND player.user_id = ?`,
				[accountUserId, eventId, accountUserId],
			);
			if (player)
				entries.set(accountUserId, {
					rank: 0,
					userId: accountUserId,
					teamId: player.team_id,
					stablefordPoints: 0,
					holesCompleted: 0,
				});
		}
		const local = entries.get(accountUserId);
		if (local) {
			const authoritative = await this.database.all<ScoreRow>(
				`SELECT id, hole, strokes, putts, handicap_strokes, net_strokes,
  stableford_points, version FROM golf_scores
WHERE account_user_id = ? AND event_id = ? AND user_id = ?`,
				[accountUserId, eventId, accountUserId],
			);
			const authoritativeByHole = new Map(
				authoritative.map((score) => [Number(score.hole), score]),
			);
			local.stablefordPoints = authoritative.reduce(
				(total, score) => total + Number(score.stableford_points),
				0,
			);
			local.holesCompleted = authoritative.reduce(
				(total, score) => total + (score.strokes === null ? 0 : 1),
				0,
			);
			const latest = new Map<number, IntentRow>();
			for (const intent of await this.database.all<IntentRow>(
				`SELECT * FROM golf_score_intents
WHERE account_user_id = ? AND event_id = ? AND state <> 'converged'
ORDER BY client_sequence`,
				[accountUserId, eventId],
			))
				latest.set(Number(intent.hole), intent);
			for (const [hole, intent] of latest) {
				const stored = authoritativeByHole.get(hole);
				local.stablefordPoints +=
					Number(intent.stableford_points) -
					Number(stored?.stableford_points ?? 0);
				local.holesCompleted +=
					(intent.strokes === null ? 0 : 1) -
					(stored?.strokes === null || stored === undefined ? 0 : 1);
			}
		}
		const sorted = [...entries.values()].sort(
			(left, right) =>
				right.stablefordPoints - left.stablefordPoints ||
				left.userId.localeCompare(right.userId),
		);
		let rank = 0;
		let priorPoints: number | null = null;
		return sorted.map((entry, index) => {
			if (entry.stablefordPoints !== priorPoints) rank = index + 1;
			priorPoints = entry.stablefordPoints;
			return { ...entry, rank };
		});
	}
}

export async function enqueueGolfScoreIntent(
	executor: SqlExecutor,
	input: GolfScoreIntentInput,
	timestamp: string,
): Promise<GolfScoreIntent> {
	validateIntentInput(input);
	const commandJson = scoreCommandJson(input);
	const existing = await executor.first<IntentRow>(
		`SELECT * FROM golf_score_intents
WHERE account_user_id = ? AND client_intent_id = ?`,
		[input.accountUserId, input.clientIntentId],
	);
	if (existing) {
		if (existing.command_json !== commandJson)
			throw new Error(
				"Golf score intent ID was reused with a different command",
			);
		return mapIntent(existing);
	}
	const context = await executor.first<{
		par: number;
		stroke_index: number;
		playing_handicap: number;
	}>(
		`SELECT hole.par, hole.stroke_index, player.playing_handicap
FROM golf_holes hole
JOIN golf_players player
  ON player.account_user_id = hole.account_user_id
 AND player.event_id = hole.event_id
WHERE hole.account_user_id = ? AND hole.root_event_id = ?
  AND hole.event_id = ? AND hole.hole = ? AND player.user_id = ?`,
		[
			input.accountUserId,
			input.rootEventId,
			input.eventId,
			input.hole,
			input.accountUserId,
		],
	);
	if (!context) throw new Error("Golf round or eligible player is unavailable");
	const handicapStrokes = strokesReceivedOnHole(
		Number(context.playing_handicap),
		Number(context.stroke_index),
	);
	const calculated =
		input.strokes === null
			? { netStrokes: null, stablefordPoints: 0 }
			: {
					netStrokes: input.strokes - handicapStrokes,
					stablefordPoints: calculateStableford(
						input.strokes,
						Number(context.par),
						handicapStrokes,
					),
				};
	await executor.run(
		`INSERT INTO golf_intent_streams (
  account_user_id, root_event_id, next_sequence
) VALUES (?, ?, 1) ON CONFLICT (account_user_id, root_event_id) DO NOTHING`,
		[input.accountUserId, input.rootEventId],
	);
	const stream = await executor.first<{ next_sequence: number }>(
		`SELECT next_sequence FROM golf_intent_streams
WHERE account_user_id = ? AND root_event_id = ?`,
		[input.accountUserId, input.rootEventId],
	);
	const clientSequence = Number(stream?.next_sequence);
	if (!Number.isSafeInteger(clientSequence) || clientSequence > MAX_SEQUENCE)
		throw new Error("Golf score intent sequence is exhausted");
	await executor.run(
		`UPDATE golf_intent_streams SET next_sequence = next_sequence + 1
WHERE account_user_id = ? AND root_event_id = ?`,
		[input.accountUserId, input.rootEventId],
	);
	const scoreId = golfScoreEntityId(
		input.eventId,
		input.accountUserId,
		input.hole,
	);
	await executor.run(
		`INSERT INTO golf_score_intents (
  account_user_id, client_intent_id, root_event_id, event_id, score_id,
  user_id, hole, client_sequence, base_version, strokes, putts,
  playing_handicap, handicap_strokes, net_strokes, stableford_points,
  command_json, state, applied_entity_version, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
		[
			input.accountUserId,
			input.clientIntentId,
			input.rootEventId,
			input.eventId,
			scoreId,
			input.accountUserId,
			input.hole,
			clientSequence,
			input.baseVersion,
			input.strokes,
			input.putts,
			Number(context.playing_handicap),
			handicapStrokes,
			calculated.netStrokes,
			calculated.stablefordPoints,
			commandJson,
			timestamp,
			timestamp,
		],
	);
	const inserted = await executor.first<IntentRow>(
		`SELECT * FROM golf_score_intents
WHERE account_user_id = ? AND client_intent_id = ?`,
		[input.accountUserId, input.clientIntentId],
	);
	if (!inserted) throw new Error("Golf score intent was not persisted");
	return mapIntent(inserted);
}

export async function linkGolfScoreIntentToOutbox(
	executor: SqlExecutor,
	accountUserId: string,
	clientIntentId: string,
	clientMutationId: string,
): Promise<GolfScoreIntent> {
	const current = await executor.first<IntentRow>(
		`SELECT * FROM golf_score_intents
WHERE account_user_id = ? AND client_intent_id = ?`,
		[accountUserId, clientIntentId],
	);
	if (!current) throw new Error("Golf score intent was not found");
	if (current.outbox_client_mutation_id !== null) {
		if (current.outbox_client_mutation_id !== clientMutationId)
			throw new Error("Golf score intent is linked to a different mutation");
		return mapIntent(current);
	}
	await executor.run(
		`UPDATE golf_score_intents SET outbox_client_mutation_id = ?
WHERE account_user_id = ? AND client_intent_id = ?
  AND outbox_client_mutation_id IS NULL`,
		[clientMutationId, accountUserId, clientIntentId],
	);
	const linked = await executor.first<IntentRow>(
		`SELECT * FROM golf_score_intents
WHERE account_user_id = ? AND client_intent_id = ?`,
		[accountUserId, clientIntentId],
	);
	if (!linked) throw new Error("Golf score intent was not found");
	return mapIntent(linked);
}

export async function findGolfScoreIntentByOutboxMutation(
	executor: SqlExecutor,
	accountUserId: string,
	clientMutationId: string,
): Promise<GolfScoreIntent | null> {
	const row = await executor.first<IntentRow>(
		`SELECT * FROM golf_score_intents
WHERE account_user_id = ? AND outbox_client_mutation_id = ?`,
		[accountUserId, clientMutationId],
	);
	return row ? mapIntent(row) : null;
}

export async function acknowledgeGolfScoreIntent(
	executor: SqlExecutor,
	accountUserId: string,
	clientIntentId: string,
	appliedEntityVersion: number,
	timestamp: string,
): Promise<GolfScoreIntent> {
	positiveInteger(appliedEntityVersion, "appliedEntityVersion");
	const current = await executor.first<IntentRow>(
		`SELECT * FROM golf_score_intents
WHERE account_user_id = ? AND client_intent_id = ?`,
		[accountUserId, clientIntentId],
	);
	if (!current) throw new Error("Golf score intent was not found");
	if (current.state !== "pending") {
		if (Number(current.applied_entity_version) !== appliedEntityVersion)
			throw new Error("Golf score intent acknowledgement changed");
		return mapIntent(current);
	}
	const score = await executor.first<{ version: number }>(
		`SELECT version FROM golf_scores
WHERE account_user_id = ? AND id = ?`,
		[accountUserId, current.score_id],
	);
	const state =
		score && Number(score.version) >= appliedEntityVersion
			? "converged"
			: "awaiting_pull";
	await executor.run(
		`UPDATE golf_score_intents SET state = ?,
  applied_entity_version = ?, updated_at = ?
WHERE account_user_id = ? AND client_intent_id = ?`,
		[state, appliedEntityVersion, timestamp, accountUserId, clientIntentId],
	);
	const updated = await executor.first<IntentRow>(
		`SELECT * FROM golf_score_intents
WHERE account_user_id = ? AND client_intent_id = ?`,
		[accountUserId, clientIntentId],
	);
	if (!updated) throw new Error("Golf score intent was not found");
	return mapIntent(updated);
}

export function golfScoreEntityId(
	eventId: string,
	userId: string,
	hole: number,
) {
	return `gsc_${eventId}:${userId}:${hole}`;
}

export function validateGolfSyncRecord(
	entityType: GolfSyncEntityType,
	entityId: string,
	data: GolfSyncData,
): void {
	switch (entityType) {
		case "golfRound": {
			const round = data as SyncGolfRoundData;
			valid(entityId === round.eventId, "golf round identity mismatch");
			valid(round.holes.length === 18, "golf round must contain 18 holes");
			const holes = [...round.holes].sort(
				(left, right) => left.hole - right.hole,
			);
			valid(
				holes.every(
					(hole, index) =>
						hole.hole === index + 1 &&
						integerBetween(hole.par, 3, 6) &&
						integerBetween(hole.strokeIndex, 1, 18),
				) && new Set(holes.map((hole) => hole.strokeIndex)).size === 18,
				"invalid golf scorecard",
			);
			const assigned = new Set<string>();
			const teamIds = new Set<string>();
			valid(
				round.teams.length <= 50 &&
					round.teams.every((team) => {
						if (
							!TEAM_ID.test(team.id) ||
							teamIds.has(team.id) ||
							team.name !== team.name.trim() ||
							team.name.length < 1 ||
							team.name.length > 80 ||
							(team.color !== null && !HEX_COLOR.test(team.color)) ||
							team.memberUserIds.length < 1 ||
							team.memberUserIds.length > 4
						)
							return false;
						teamIds.add(team.id);
						for (const userId of team.memberUserIds) {
							if (!USER_ID.test(userId) || assigned.has(userId)) return false;
							assigned.add(userId);
						}
						return true;
					}),
				"invalid golf teams",
			);
			break;
		}
		case "golfRoster": {
			valid("players" in data, "invalid golf roster");
			const roster = data;
			const users = new Set<string>();
			valid(
				exactKeys(roster, [
					"rootEventId",
					"eventId",
					"players",
					"version",
					"updatedAt",
				]) &&
					entityId === `gro_${roster.eventId}` &&
					EVENT_ID.test(roster.rootEventId) &&
					EVENT_ID.test(roster.eventId) &&
					Number.isSafeInteger(roster.version) &&
					roster.version > 0 &&
					Number.isFinite(Date.parse(roster.updatedAt)) &&
					Array.isArray(roster.players) &&
					roster.players.length >= 1 &&
					roster.players.length <= 500 &&
					roster.players.every((player) => {
						const acceptable =
							exactKeys(player, ["userId", "playingHandicap"]) &&
							USER_ID.test(player.userId) &&
							!users.has(player.userId) &&
							integerBetween(player.playingHandicap, -99, 99);
						users.add(player.userId);
						return acceptable;
					}),
				"invalid golf roster",
			);
			break;
		}
		case "golfPlayer": {
			const player = data as SyncGolfPlayerData;
			valid(
				entityId === `gpl_${player.eventId}:${player.userId}` &&
					USER_ID.test(player.userId) &&
					integerBetween(player.playingHandicap, -99, 99),
				"invalid golf player",
			);
			break;
		}
		case "golfScore": {
			const score = data as SyncGolfScoreData;
			valid(
				entityId === score.id &&
					entityId ===
						golfScoreEntityId(score.eventId, score.userId, score.hole) &&
					USER_ID.test(score.userId) &&
					POSITIVE_DECIMAL.test(score.rootRevision) &&
					integerBetween(score.hole, 1, 18) &&
					integerBetween(score.playingHandicap, -99, 99) &&
					integerBetween(score.handicapStrokes, -99, 99) &&
					integerBetween(score.stablefordPoints, 0, 6) &&
					((score.strokes === null &&
						score.putts === null &&
						score.netStrokes === null &&
						score.stablefordPoints === 0) ||
						(score.strokes !== null &&
							integerBetween(score.strokes, 1, 99) &&
							(score.putts === null || integerBetween(score.putts, 0, 99)) &&
							score.netStrokes === score.strokes - score.handicapStrokes)),
				"invalid golf score",
			);
			break;
		}
		case "golfLeaderboard": {
			const leaderboard = data as SyncGolfLeaderboardData;
			valid(
				entityId === `glb_${leaderboard.eventId}`,
				"golf leaderboard identity mismatch",
			);
			let previousPoints: number | null = null;
			let previousUserId = "";
			let expectedRank = 0;
			const users = new Set<string>();
			valid(
				leaderboard.entries.length <= 500 &&
					leaderboard.entries.every((entry, index) => {
						if (entry.stablefordPoints !== previousPoints)
							expectedRank = index + 1;
						const ordered =
							previousPoints === null ||
							entry.stablefordPoints < previousPoints ||
							(entry.stablefordPoints === previousPoints &&
								entry.userId > previousUserId);
						const validEntry =
							!users.has(entry.userId) &&
							USER_ID.test(entry.userId) &&
							(entry.teamId === null || TEAM_ID.test(entry.teamId)) &&
							entry.rank === expectedRank &&
							integerBetween(entry.stablefordPoints, 0, 108) &&
							integerBetween(entry.holesCompleted, 0, 18) &&
							ordered;
						users.add(entry.userId);
						previousPoints = entry.stablefordPoints;
						previousUserId = entry.userId;
						return validEntry;
					}),
				"invalid golf leaderboard",
			);
			break;
		}
	}
}

export async function putGolfSyncProjection(
	executor: SqlExecutor,
	accountUserId: string,
	entityType: GolfSyncEntityType,
	data: GolfSyncData,
): Promise<void> {
	switch (entityType) {
		case "golfRound":
			await putRound(executor, accountUserId, data as SyncGolfRoundData);
			break;
		case "golfRoster":
			valid("players" in data, "invalid golf roster");
			await putRoster(executor, accountUserId, data);
			break;
		case "golfPlayer":
			await putPlayer(executor, accountUserId, data as SyncGolfPlayerData);
			break;
		case "golfScore":
			await putScore(executor, accountUserId, data as SyncGolfScoreData);
			break;
		case "golfLeaderboard":
			await putLeaderboard(
				executor,
				accountUserId,
				data as SyncGolfLeaderboardData,
			);
			break;
	}
}

async function putRoster(
	executor: SqlExecutor,
	accountUserId: string,
	roster: SyncGolfRosterData,
) {
	const manager = await executor.first(
		`SELECT 1 FROM memberships
WHERE account_user_id = ? AND root_event_id = ? AND member_user_id = ?
  AND status = 'active' AND role IN ('owner', 'organizer')`,
		[accountUserId, roster.rootEventId, accountUserId],
	);
	valid(manager, "golf roster requires manager access");
	const current = await executor.first<{ roster_version: number }>(
		`SELECT roster_version FROM golf_roster_players
WHERE account_user_id = ? AND event_id = ? LIMIT 1`,
		[accountUserId, roster.eventId],
	);
	if (current && Number(current.roster_version) >= roster.version) return;
	await executor.run(
		"DELETE FROM golf_roster_players WHERE account_user_id = ? AND event_id = ?",
		[accountUserId, roster.eventId],
	);
	for (const player of roster.players) {
		await executor.run(
			`INSERT INTO golf_roster_players (
  account_user_id, root_event_id, event_id, user_id, playing_handicap,
  roster_version, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				accountUserId,
				roster.rootEventId,
				roster.eventId,
				player.userId,
				player.playingHandicap,
				roster.version,
				roster.updatedAt,
			],
		);
	}
}

async function putRound(
	executor: SqlExecutor,
	accountUserId: string,
	round: SyncGolfRoundData,
) {
	const current = await executor.first<{ version: number }>(
		"SELECT version FROM golf_rounds WHERE account_user_id = ? AND event_id = ?",
		[accountUserId, round.eventId],
	);
	if (current && Number(current.version) >= round.version) return;
	await executor.run(
		`INSERT INTO golf_rounds (
  account_user_id, root_event_id, event_id, version, updated_at
) VALUES (?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, event_id) DO UPDATE SET
  version = excluded.version, updated_at = excluded.updated_at
WHERE excluded.version > golf_rounds.version`,
		[
			accountUserId,
			round.rootEventId,
			round.eventId,
			round.version,
			round.updatedAt,
		],
	);
	for (const hole of round.holes) {
		await executor.run(
			`INSERT INTO golf_holes (
  account_user_id, root_event_id, event_id, hole, par, stroke_index
) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, event_id, hole) DO UPDATE SET
  par = excluded.par, stroke_index = excluded.stroke_index`,
			[
				accountUserId,
				round.rootEventId,
				round.eventId,
				hole.hole,
				hole.par,
				hole.strokeIndex,
			],
		);
	}
	await executor.run(
		"DELETE FROM golf_team_members WHERE account_user_id = ? AND event_id = ?",
		[accountUserId, round.eventId],
	);
	await executor.run(
		"DELETE FROM golf_teams WHERE account_user_id = ? AND event_id = ?",
		[accountUserId, round.eventId],
	);
	for (const [position, team] of round.teams.entries()) {
		await executor.run(
			`INSERT INTO golf_teams (
  account_user_id, root_event_id, event_id, id, name, color, sort_position
) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[
				accountUserId,
				round.rootEventId,
				round.eventId,
				team.id,
				team.name,
				team.color,
				position,
			],
		);
		for (const userId of team.memberUserIds) {
			await executor.run(
				`INSERT INTO golf_team_members (
  account_user_id, root_event_id, event_id, team_id, user_id
) VALUES (?, ?, ?, ?, ?)`,
				[accountUserId, round.rootEventId, round.eventId, team.id, userId],
			);
		}
	}
}

async function putPlayer(
	executor: SqlExecutor,
	accountUserId: string,
	player: SyncGolfPlayerData,
) {
	valid(player.userId === accountUserId, "golf player account mismatch");
	await executor.run(
		`INSERT INTO golf_players (
  account_user_id, root_event_id, event_id, user_id, playing_handicap, version
) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, event_id, user_id) DO UPDATE SET
  playing_handicap = excluded.playing_handicap, version = excluded.version
WHERE excluded.version > golf_players.version`,
		[
			accountUserId,
			player.rootEventId,
			player.eventId,
			player.userId,
			player.playingHandicap,
			player.version,
		],
	);
}

async function putScore(
	executor: SqlExecutor,
	accountUserId: string,
	score: SyncGolfScoreData,
) {
	valid(score.userId === accountUserId, "golf score account mismatch");
	const context = await executor.first<{
		par: number;
		stroke_index: number;
		playing_handicap: number;
	}>(
		`SELECT hole.par, hole.stroke_index, player.playing_handicap
FROM golf_holes hole
JOIN golf_players player
  ON player.account_user_id = hole.account_user_id
 AND player.event_id = hole.event_id
WHERE hole.account_user_id = ? AND hole.event_id = ? AND hole.hole = ?
  AND player.user_id = ?`,
		[accountUserId, score.eventId, score.hole, score.userId],
	);
	valid(context, "golf score context is missing");
	const handicapStrokes = strokesReceivedOnHole(
		Number(context.playing_handicap),
		Number(context.stroke_index),
	);
	const netStrokes =
		score.strokes === null ? null : score.strokes - handicapStrokes;
	const stablefordPoints =
		score.strokes === null
			? 0
			: calculateStableford(
					score.strokes,
					Number(context.par),
					handicapStrokes,
				);
	valid(
		score.playingHandicap === Number(context.playing_handicap) &&
			score.handicapStrokes === handicapStrokes &&
			score.netStrokes === netStrokes &&
			score.stablefordPoints === stablefordPoints,
		"golf score calculation mismatch",
	);
	await executor.run(
		`INSERT INTO golf_scores (
  account_user_id, id, root_event_id, event_id, user_id, hole, strokes, putts,
  playing_handicap, handicap_strokes, net_strokes, stableford_points, version,
  root_revision, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, id) DO UPDATE SET
  strokes = excluded.strokes, putts = excluded.putts,
  playing_handicap = excluded.playing_handicap,
  handicap_strokes = excluded.handicap_strokes,
  net_strokes = excluded.net_strokes,
  stableford_points = excluded.stableford_points,
  version = excluded.version, root_revision = excluded.root_revision,
  updated_at = excluded.updated_at
WHERE excluded.version > golf_scores.version`,
		[
			accountUserId,
			score.id,
			score.rootEventId,
			score.eventId,
			score.userId,
			score.hole,
			score.strokes,
			score.putts,
			score.playingHandicap,
			score.handicapStrokes,
			score.netStrokes,
			score.stablefordPoints,
			score.version,
			score.rootRevision,
			score.createdAt,
			score.updatedAt,
		],
	);
	await executor.run(
		`UPDATE golf_score_intents SET state = 'converged', updated_at = ?
WHERE account_user_id = ? AND score_id = ? AND state = 'awaiting_pull'
  AND applied_entity_version <= ?`,
		[score.updatedAt, accountUserId, score.id, score.version],
	);
}

async function putLeaderboard(
	executor: SqlExecutor,
	accountUserId: string,
	leaderboard: SyncGolfLeaderboardData,
) {
	const current = await executor.first<{ version: number }>(
		"SELECT version FROM golf_leaderboards WHERE account_user_id = ? AND event_id = ?",
		[accountUserId, leaderboard.eventId],
	);
	if (current && Number(current.version) >= leaderboard.version) return;
	await executor.run(
		`INSERT INTO golf_leaderboards (
  account_user_id, root_event_id, event_id, version
) VALUES (?, ?, ?, ?)
ON CONFLICT (account_user_id, event_id) DO UPDATE SET version = excluded.version
WHERE excluded.version > golf_leaderboards.version`,
		[
			accountUserId,
			leaderboard.rootEventId,
			leaderboard.eventId,
			leaderboard.version,
		],
	);
	await executor.run(
		"DELETE FROM golf_rankings WHERE account_user_id = ? AND event_id = ?",
		[accountUserId, leaderboard.eventId],
	);
	for (const entry of leaderboard.entries) {
		await executor.run(
			`INSERT INTO golf_rankings (
  account_user_id, root_event_id, event_id, user_id, team_id, rank,
  stableford_points, holes_completed, leaderboard_version
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				accountUserId,
				leaderboard.rootEventId,
				leaderboard.eventId,
				entry.userId,
				entry.teamId,
				entry.rank,
				entry.stablefordPoints,
				entry.holesCompleted,
				leaderboard.version,
			],
		);
	}
}

function validateIntentInput(input: GolfScoreIntentInput) {
	valid(USER_ID.test(input.accountUserId), "invalid account user ID");
	valid(
		CLIENT_INTENT_ID.test(input.clientIntentId),
		"invalid client intent ID",
	);
	valid(EVENT_ID.test(input.rootEventId), "invalid root event ID");
	valid(EVENT_ID.test(input.eventId), "invalid golf event ID");
	valid(integerBetween(input.hole, 1, 18), "invalid golf hole");
	valid(
		Number.isSafeInteger(input.baseVersion) && input.baseVersion >= 0,
		"invalid base version",
	);
	valid(
		(input.strokes === null || integerBetween(input.strokes, 1, 99)) &&
			(input.putts === null || integerBetween(input.putts, 0, 99)) &&
			(input.strokes !== null || input.putts === null),
		"invalid golf score",
	);
}

function scoreCommandJson(input: GolfScoreIntentInput) {
	return JSON.stringify({
		rootEventId: input.rootEventId,
		eventId: input.eventId,
		hole: input.hole,
		strokes: input.strokes,
		putts: input.putts,
		baseVersion: input.baseVersion,
	});
}

function mapIntent(row: IntentRow): GolfScoreIntent {
	return {
		accountUserId: row.account_user_id,
		clientIntentId: row.client_intent_id,
		rootEventId: row.root_event_id,
		eventId: row.event_id,
		scoreId: row.score_id,
		hole: Number(row.hole),
		clientSequence: Number(row.client_sequence),
		outboxClientMutationId: row.outbox_client_mutation_id,
		baseVersion: Number(row.base_version),
		strokes: row.strokes,
		putts: row.putts,
		playingHandicap: Number(row.playing_handicap),
		handicapStrokes: Number(row.handicap_strokes),
		netStrokes: row.net_strokes,
		stablefordPoints: Number(row.stableford_points),
		state: row.state,
		appliedEntityVersion:
			row.applied_entity_version === null
				? null
				: Number(row.applied_entity_version),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function positiveInteger(value: number, field: string) {
	valid(Number.isSafeInteger(value) && value > 0, `${field} must be positive`);
}

function integerBetween(value: number, minimum: number, maximum: number) {
	return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function exactKeys(value: object, expected: readonly string[]) {
	const keys = Object.keys(value);
	return (
		keys.length === expected.length && expected.every((key) => key in value)
	);
}

function valid(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Invalid golf data: ${message}`);
}
