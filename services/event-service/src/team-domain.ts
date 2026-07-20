import { DomainError } from "./domain";

export type TeamAssignmentInput = {
	id: string;
	name: string;
	color: string | null;
	memberUserIds: string[];
};

export type TeamAssignmentSetInput = {
	teams: TeamAssignmentInput[];
};

export type TeamAssignmentSetRecord = TeamAssignmentSetInput & {
	rootEventId: string;
	eventId: string;
	capacityPerTeam: number | null;
	version: number;
	createdAt: Date;
	updatedAt: Date;
};

export type TeamDecisionOptionInput = {
	id: string;
	label: string;
};

export type TeamDecisionInput = {
	title: string;
	state: "draft" | "open" | "closed";
	options: TeamDecisionOptionInput[];
};

export type TeamDecisionOptionRecord = TeamDecisionOptionInput & {
	responseCount: number;
};

export type TeamDecisionRecord = {
	id: string;
	rootEventId: string;
	eventId: string;
	title: string;
	state: TeamDecisionInput["state"];
	options: TeamDecisionOptionRecord[];
	responseCount: number;
	version: number;
	aggregateVersion: number;
	createdAt: Date;
	updatedAt: Date;
};

export type TeamResponseRecord = {
	id: string;
	rootEventId: string;
	eventId: string;
	decisionId: string;
	userId: string;
	optionId: string;
	version: number;
	rootRevision: string;
	createdAt: Date;
	updatedAt: Date;
};

const USER_ID = /^usr_[a-f0-9]{32}$/;
const TEAM_ID = /^ttm_[A-Za-z0-9._:-]{1,96}$/;
const DECISION_ID = /^tdc_[A-Za-z0-9._:-]{1,96}$/;
const OPTION_ID = /^tdo_[A-Za-z0-9._:-]{1,96}$/;

export function teamAssignmentEntityId(eventId: string, userId: string) {
	return `tma_${eventId}:${userId}`;
}

export function teamAssignmentRosterEntityId(eventId: string) {
	return `tro_${eventId}`;
}

export function teamResponseEntityId(decisionId: string, userId: string) {
	return `trp_${decisionId}:${userId}`;
}

export function validateTeamAssignmentSet(
	input: TeamAssignmentSetInput,
	capacityPerTeam: number | null,
): TeamAssignmentSetInput {
	if (input.teams.length < 1 || input.teams.length > 100)
		throw invalid(
			"TEAM_ASSIGNMENTS_INVALID",
			"An assignment set must contain between 1 and 100 teams.",
		);
	const teamIds = new Set<string>();
	const assigned = new Set<string>();
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
			memberUserIds.length > (capacityPerTeam ?? 1_000) ||
			new Set(memberUserIds).size !== memberUserIds.length ||
			memberUserIds.some(
				(userId) => !USER_ID.test(userId) || assigned.has(userId),
			)
		) {
			throw invalid(
				"TEAM_ASSIGNMENTS_INVALID",
				"Teams and active members must be unique and capacity-valid.",
			);
		}
		teamIds.add(team.id);
		for (const userId of memberUserIds) assigned.add(userId);
		return { id: team.id, name, color, memberUserIds };
	});
	if (assigned.size > 1_000)
		throw invalid(
			"TEAM_ASSIGNMENTS_INVALID",
			"An assignment set cannot contain more than 1000 members.",
		);
	return { teams };
}

export function validateTeamDecision(
	decisionId: string,
	input: TeamDecisionInput,
): TeamDecisionInput {
	const title = input.title.trim();
	const optionIds = new Set<string>();
	const labels = new Set<string>();
	const options = input.options.map((option) => {
		const label = option.label.trim();
		if (
			!OPTION_ID.test(option.id) ||
			optionIds.has(option.id) ||
			label.length < 1 ||
			label.length > 160 ||
			labels.has(label.toLocaleLowerCase("en-US"))
		) {
			throw invalid(
				"TEAM_DECISION_INVALID",
				"Decision options must have unique IDs and labels.",
			);
		}
		optionIds.add(option.id);
		labels.add(label.toLocaleLowerCase("en-US"));
		return { id: option.id, label };
	});
	if (
		!DECISION_ID.test(decisionId) ||
		title.length < 1 ||
		title.length > 240 ||
		options.length < 2 ||
		options.length > 20
	) {
		throw invalid(
			"TEAM_DECISION_INVALID",
			"A decision must have a valid ID, title and two to twenty options.",
		);
	}
	return { title, state: input.state, options };
}

export function validateTeamResponse(decisionId: string, optionId: string) {
	if (!DECISION_ID.test(decisionId) || !OPTION_ID.test(optionId))
		throw invalid("TEAM_RESPONSE_INVALID", "The decision response is invalid.");
}

export function sameTeamAssignmentSet(
	left: TeamAssignmentSetInput,
	right: TeamAssignmentSetInput,
) {
	return JSON.stringify(left.teams) === JSON.stringify(right.teams);
}

export function sameTeamDecision(
	left: Pick<TeamDecisionRecord, "title" | "state" | "options">,
	right: TeamDecisionInput,
) {
	return (
		left.title === right.title &&
		left.state === right.state &&
		JSON.stringify(left.options.map(({ id, label }) => ({ id, label }))) ===
			JSON.stringify(right.options)
	);
}

function invalid(code: string, message: string) {
	return new DomainError(400, code, message);
}
