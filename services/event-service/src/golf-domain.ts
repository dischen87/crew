import {
	calculateStableford,
	strokesReceivedOnHole,
} from "@crew/shared/stableford";
import { DomainError } from "./domain";

export type GolfHoleInput = {
	hole: number;
	par: number;
	strokeIndex: number;
};

export type GolfPlayerInput = {
	userId: string;
	/** Receives strokes when positive; a plus-two handicap is represented as -2. */
	playingHandicap: number;
};

export type GolfTeamInput = {
	id: string;
	name: string;
	color: string | null;
	memberUserIds: string[];
};

export type GolfRoundSetupInput = {
	holes: GolfHoleInput[];
	players: GolfPlayerInput[];
	teams: GolfTeamInput[];
};

export type GolfRoundRecord = GolfRoundSetupInput & {
	rootEventId: string;
	eventId: string;
	version: number;
	leaderboardVersion: number;
	createdAt: Date;
	updatedAt: Date;
};

export type GolfScoreInput = {
	hole: number;
	/** Null records a completed pick-up/no-score hole worth zero points. */
	strokes: number | null;
	putts: number | null;
};

export type GolfScoreRecord = {
	id: string;
	rootEventId: string;
	eventId: string;
	userId: string;
	hole: number;
	strokes: number | null;
	putts: number | null;
	playingHandicap: number;
	handicapStrokes: number;
	netStrokes: number | null;
	stablefordPoints: number;
	version: number;
	rootRevision: string;
	createdAt: Date;
	updatedAt: Date;
};

export type GolfLeaderboardEntry = {
	rank: number;
	userId: string;
	teamId: string | null;
	stablefordPoints: number;
	holesCompleted: number;
};

export type GolfLeaderboard = {
	rootEventId: string;
	eventId: string;
	version: number;
	entries: GolfLeaderboardEntry[];
};

const USER_ID = /^usr_[a-f0-9]{32}$/;
const TEAM_ID = /^gtm_[A-Za-z0-9._:-]{1,96}$/;

export function golfScoreEntityId(
	eventId: string,
	userId: string,
	hole: number,
) {
	return `gsc_${eventId}:${userId}:${hole}`;
}

export function golfPlayerEntityId(eventId: string, userId: string) {
	return `gpl_${eventId}:${userId}`;
}

export function golfLeaderboardEntityId(eventId: string) {
	return `glb_${eventId}`;
}

export function golfRosterEntityId(eventId: string) {
	return `gro_${eventId}`;
}

export function validateGolfRoundSetup(
	input: GolfRoundSetupInput,
): GolfRoundSetupInput {
	if (input.holes.length !== 18)
		throw invalid("GOLF_SCORECARD_INVALID", "A golf round must have 18 holes.");
	const holes = input.holes
		.map((hole) => ({ ...hole }))
		.sort((left, right) => left.hole - right.hole);
	if (
		holes.some(
			(hole, index) =>
				hole.hole !== index + 1 ||
				!Number.isSafeInteger(hole.par) ||
				hole.par < 3 ||
				hole.par > 6 ||
				!Number.isSafeInteger(hole.strokeIndex) ||
				hole.strokeIndex < 1 ||
				hole.strokeIndex > 18,
		) ||
		new Set(holes.map((hole) => hole.strokeIndex)).size !== 18
	) {
		throw invalid(
			"GOLF_SCORECARD_INVALID",
			"Hole numbers and stroke indices must each contain 1 through 18 exactly once.",
		);
	}

	if (input.players.length < 1 || input.players.length > 500)
		throw invalid(
			"GOLF_PLAYERS_INVALID",
			"A golf round must have between 1 and 500 eligible players.",
		);
	const players = input.players
		.map((player) => ({ ...player }))
		.sort((left, right) => left.userId.localeCompare(right.userId));
	if (
		players.some(
			(player) =>
				!USER_ID.test(player.userId) ||
				!Number.isSafeInteger(player.playingHandicap) ||
				player.playingHandicap < -99 ||
				player.playingHandicap > 99,
		) ||
		new Set(players.map((player) => player.userId)).size !== players.length
	) {
		throw invalid(
			"GOLF_PLAYERS_INVALID",
			"Eligible players and signed playing handicaps must be unique and valid.",
		);
	}

	if (input.teams.length > 50)
		throw invalid(
			"GOLF_TEAMS_INVALID",
			"A round cannot have more than 50 teams.",
		);
	const eligible = new Set(players.map((player) => player.userId));
	const assigned = new Set<string>();
	const teamIds = new Set<string>();
	const teams = input.teams.map((team) => {
		const name = team.name.trim();
		const color = team.color?.toUpperCase() ?? null;
		const memberUserIds = [...team.memberUserIds].sort();
		if (
			!TEAM_ID.test(team.id) ||
			teamIds.has(team.id) ||
			name.length < 1 ||
			name.length > 80 ||
			(color !== null && !/^#[0-9A-F]{6}$/.test(color)) ||
			memberUserIds.length < 1 ||
			memberUserIds.length > 4 ||
			new Set(memberUserIds).size !== memberUserIds.length ||
			memberUserIds.some(
				(userId) => !eligible.has(userId) || assigned.has(userId),
			)
		) {
			throw invalid(
				"GOLF_TEAMS_INVALID",
				"Teams must be unique flights of one to four eligible players.",
			);
		}
		teamIds.add(team.id);
		for (const userId of memberUserIds) assigned.add(userId);
		return { id: team.id, name, color, memberUserIds };
	});
	return { holes, players, teams };
}

export function calculateGolfScore(
	input: GolfScoreInput,
	hole: GolfHoleInput,
	playingHandicap: number,
) {
	if (
		!Number.isSafeInteger(input.hole) ||
		input.hole < 1 ||
		input.hole > 18 ||
		input.hole !== hole.hole ||
		(input.strokes !== null &&
			(!Number.isSafeInteger(input.strokes) ||
				input.strokes < 1 ||
				input.strokes > 99)) ||
		(input.putts !== null &&
			(!Number.isSafeInteger(input.putts) ||
				input.putts < 0 ||
				input.putts > 99)) ||
		(input.strokes === null && input.putts !== null)
	) {
		throw invalid("GOLF_SCORE_INVALID", "The golf score is invalid.");
	}
	const handicapStrokes = strokesReceivedOnHole(
		playingHandicap,
		hole.strokeIndex,
	);
	if (input.strokes === null) {
		return { handicapStrokes, netStrokes: null, stablefordPoints: 0 };
	}
	return {
		handicapStrokes,
		netStrokes: input.strokes - handicapStrokes,
		stablefordPoints: calculateStableford(
			input.strokes,
			hole.par,
			handicapStrokes,
		),
	};
}

export function sameGolfRoundSetup(
	left: GolfRoundSetupInput,
	right: GolfRoundSetupInput,
) {
	return (
		JSON.stringify({
			holes: left.holes,
			players: left.players,
			teams: left.teams,
		}) ===
		JSON.stringify({
			holes: right.holes,
			players: right.players,
			teams: right.teams,
		})
	);
}

function invalid(code: string, message: string) {
	return new DomainError(400, code, message);
}
