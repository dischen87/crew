import type { components } from "@crew/mobile-client";
import type { SqlDatabase, SqlExecutor } from "./database.ts";

export type SyncTeamAssignmentData =
	components["schemas"]["EventServiceSyncTeamAssignmentData"];
export type SyncTeamAssignmentRosterData =
	components["schemas"]["EventServiceSyncTeamAssignmentRosterData"];
export type SyncTeamAssignmentSetData =
	components["schemas"]["EventServiceSyncTeamAssignmentSetData"];
export type SyncTeamDecisionData =
	components["schemas"]["EventServiceSyncTeamDecisionData"];
export type SyncTeamResponseData =
	components["schemas"]["EventServiceSyncTeamResponseData"];
export type SyncTeamPublicTeamData =
	components["schemas"]["EventServiceSyncTeamPublicTeamData"];

export type TeamSyncEntityType =
	| "teamAssignmentSet"
	| "teamAssignmentRoster"
	| "teamAssignment"
	| "teamDecision"
	| "teamResponse";

export type TeamSyncData =
	| SyncTeamAssignmentSetData
	| SyncTeamAssignmentRosterData
	| SyncTeamAssignmentData
	| SyncTeamDecisionData
	| SyncTeamResponseData;

export interface TeamAssignmentReadModel {
	rootEventId: string;
	eventId: string;
	version: number;
	teams: readonly SyncTeamPublicTeamData[];
	roster:
		| readonly (SyncTeamPublicTeamData & {
				memberUserIds: readonly string[];
		  })[]
		| null;
	ownTeam: SyncTeamPublicTeamData | null;
	canManage: boolean;
}

export interface TeamDecisionReadModel {
	rootEventId: string;
	eventId: string;
	id: string;
	title: string;
	state: "draft" | "open" | "closed";
	version: number;
	aggregateVersion: number;
	responseCount: number;
	options: readonly {
		id: string;
		label: string;
		responseCount: number;
	}[];
	authoritativeOptionId: string | null;
	selectedOptionId: string | null;
	responseSyncState:
		| "pending"
		| "awaiting_pull"
		| "needs_attention"
		| "synced"
		| null;
	responseMutationId: string | null;
	canManage: boolean;
	canRespond: boolean;
	createdAt: string;
	updatedAt: string;
}

interface MembershipRow {
	role: "owner" | "organizer" | "participant" | "viewer";
	status: "active" | "left" | "removed";
}

interface AssignmentSetRow {
	root_event_id: string;
	event_id: string;
	version: number;
}

interface TeamRow {
	id: string;
	name: string;
	color: string | null;
	sort_position: number;
}

interface RosterRow extends TeamRow {
	user_id: string;
}

interface DecisionRow {
	root_event_id: string;
	event_id: string;
	id: string;
	title: string;
	state: TeamDecisionReadModel["state"];
	version: number;
	aggregate_version: number;
	response_count: number;
	created_at: string;
	updated_at: string;
}

interface DecisionOptionRow {
	id: string;
	label: string;
	response_count: number;
	sort_position: number;
}

interface ResponseRow {
	option_id: string;
}

interface OutboxResponseRow {
	client_mutation_id: string;
	command_json: string;
	state: "pending" | "sending" | "awaiting_pull" | "blocked" | "dead_letter";
	client_sequence: number;
}

const USER_ID = /^usr_[a-f0-9]{32}$/;
const EVENT_ID = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const TEAM_ID = /^ttm_[A-Za-z0-9._:-]{1,96}$/;
const DECISION_ID = /^tdc_[A-Za-z0-9._:-]{1,96}$/;
const OPTION_ID = /^tdo_[A-Za-z0-9._:-]{1,96}$/;
const RESPONSE_ID = /^trp_[A-Za-z0-9._:-]{1,220}$/;
const COLOR = /^#[0-9A-F]{6}$/;
const DECIMAL = /^[1-9]\d*$/;

export class TeamOfflineStore {
	constructor(private readonly database: SqlDatabase) {}

	async getAssignments(
		accountUserId: string,
		rootEventId: string,
		eventId: string,
	): Promise<TeamAssignmentReadModel | null> {
		const set = await this.database.first<AssignmentSetRow>(
			`SELECT root_event_id, event_id, version FROM team_assignment_sets
WHERE account_user_id = ? AND root_event_id = ? AND event_id = ?`,
			[accountUserId, rootEventId, eventId],
		);
		if (!set) return null;
		const membership = await activeMembership(
			this.database,
			accountUserId,
			rootEventId,
		);
		if (!membership) return null;
		const teams = await this.database.all<TeamRow>(
			`SELECT id, name, color, sort_position FROM team_assignment_teams
WHERE account_user_id = ? AND root_event_id = ? AND event_id = ?
ORDER BY sort_position, id`,
			[accountUserId, rootEventId, eventId],
		);
		const publicTeams = teams.map(publicTeam);
		const canManage = manager(membership.role);
		let roster: TeamAssignmentReadModel["roster"] = null;
		if (canManage) {
			const rows = await this.database.all<RosterRow>(
				`SELECT team.id, team.name, team.color, team.sort_position, member.user_id
FROM team_assignment_teams team
LEFT JOIN team_assignment_roster_members member
  ON member.account_user_id = team.account_user_id
 AND member.event_id = team.event_id AND member.team_id = team.id
WHERE team.account_user_id = ? AND team.root_event_id = ? AND team.event_id = ?
ORDER BY team.sort_position, team.id, member.user_id`,
				[accountUserId, rootEventId, eventId],
			);
			roster = teams.map((team) => ({
				...publicTeam(team),
				memberUserIds: rows
					.filter((row) => row.id === team.id && row.user_id !== null)
					.map((row) => row.user_id),
			}));
		}
		const own =
			membership.role === "viewer"
				? null
				: await this.database.first<TeamRow>(
						`SELECT team.id, team.name, team.color, team.sort_position
FROM team_own_assignments own
JOIN team_assignment_teams team
  ON team.account_user_id = own.account_user_id
 AND team.event_id = own.event_id AND team.id = own.team_id
WHERE own.account_user_id = ? AND own.root_event_id = ? AND own.event_id = ?
  AND own.user_id = ?`,
						[accountUserId, rootEventId, eventId, accountUserId],
					);
		return {
			rootEventId: set.root_event_id,
			eventId: set.event_id,
			version: Number(set.version),
			teams: publicTeams,
			roster,
			ownTeam: own ? publicTeam(own) : null,
			canManage,
		};
	}

	async getDecision(
		accountUserId: string,
		rootEventId: string,
		decisionId: string,
	): Promise<TeamDecisionReadModel | null> {
		const decision = await this.database.first<DecisionRow>(
			`SELECT root_event_id, event_id, id, title, state, version,
  aggregate_version, response_count, created_at, updated_at
FROM team_decisions
WHERE account_user_id = ? AND root_event_id = ? AND id = ?`,
			[accountUserId, rootEventId, decisionId],
		);
		if (!decision) return null;
		const membership = await activeMembership(
			this.database,
			accountUserId,
			rootEventId,
		);
		if (!membership) return null;
		const options = await this.database.all<DecisionOptionRow>(
			`SELECT id, label, response_count, sort_position
FROM team_decision_options
WHERE account_user_id = ? AND root_event_id = ? AND decision_id = ?
ORDER BY sort_position, id`,
			[accountUserId, rootEventId, decisionId],
		);
		const canRespond =
			membership.role !== "viewer" && decision.state === "open";
		const response =
			membership.role === "viewer"
				? null
				: await this.database.first<ResponseRow>(
						`SELECT option_id FROM team_own_responses
WHERE account_user_id = ? AND root_event_id = ? AND decision_id = ?
  AND user_id = ?`,
						[accountUserId, rootEventId, decisionId, accountUserId],
					);
		const local =
			membership.role === "viewer"
				? null
				: await latestLocalResponse(
						this.database,
						accountUserId,
						rootEventId,
						decisionId,
					);
		return {
			rootEventId: decision.root_event_id,
			eventId: decision.event_id,
			id: decision.id,
			title: decision.title,
			state: decision.state,
			version: Number(decision.version),
			aggregateVersion: Number(decision.aggregate_version),
			responseCount: Number(decision.response_count),
			options: options.map((option) => ({
				id: option.id,
				label: option.label,
				responseCount: Number(option.response_count),
			})),
			authoritativeOptionId: response?.option_id ?? null,
			selectedOptionId: local?.optionId ?? response?.option_id ?? null,
			responseSyncState:
				local?.syncState ?? (response === null ? null : "synced"),
			responseMutationId: local?.mutationId ?? null,
			canManage: manager(membership.role),
			canRespond,
			createdAt: decision.created_at,
			updatedAt: decision.updated_at,
		};
	}
}

export function validateTeamSyncRecord(
	entityType: TeamSyncEntityType,
	entityId: string,
	data: TeamSyncData,
	entityVersion: number,
): void {
	assertRecord(data, "team data");
	assert(EVENT_ID.test(data.rootEventId), "invalid team rootEventId");
	assert(EVENT_ID.test(data.eventId), "invalid team eventId");
	assertPositive(data.version, "team data.version");
	assertDate(data.updatedAt, "team updatedAt");
	switch (entityType) {
		case "teamAssignmentSet": {
			const value = data as SyncTeamAssignmentSetData;
			assert(
				entityId === value.eventId,
				"team assignment-set identity mismatch",
			);
			assert(
				value.version === entityVersion,
				"team assignment-set version mismatch",
			);
			validatePublicTeams(value.teams);
			break;
		}
		case "teamAssignmentRoster": {
			const value = data as SyncTeamAssignmentRosterData;
			assert(
				entityId === `tro_${value.eventId}`,
				"team assignment-roster identity mismatch",
			);
			assert(value.version === entityVersion, "team roster version mismatch");
			validateRosterTeams(value.teams);
			break;
		}
		case "teamAssignment": {
			const value = data as SyncTeamAssignmentData;
			assert(USER_ID.test(value.userId), "invalid team assignment userId");
			assert(
				entityId === `tma_${value.eventId}:${value.userId}`,
				"team assignment identity mismatch",
			);
			assert(
				value.version === entityVersion,
				"team assignment version mismatch",
			);
			validatePublicTeams([value.team]);
			break;
		}
		case "teamDecision": {
			const value = data as SyncTeamDecisionData;
			assert(DECISION_ID.test(value.id), "invalid team decision ID");
			assert(entityId === value.id, "team decision identity mismatch");
			assertPositive(value.aggregateVersion, "team aggregateVersion");
			assert(
				value.aggregateVersion === entityVersion,
				"team decision aggregate version mismatch",
			);
			assert(
				["draft", "open", "closed"].includes(value.state),
				"invalid team decision state",
			);
			assertText(value.title, 240, "team decision title");
			assertDate(value.createdAt, "team decision createdAt");
			assertNonnegative(value.responseCount, "team responseCount");
			validateDecisionOptions(value.options);
			assert(
				value.options.reduce((sum, option) => sum + option.responseCount, 0) ===
					value.responseCount,
				"team decision aggregate count mismatch",
			);
			break;
		}
		case "teamResponse": {
			const value = data as SyncTeamResponseData;
			assert(RESPONSE_ID.test(value.id), "invalid team response ID");
			assert(DECISION_ID.test(value.decisionId), "invalid response decisionId");
			assert(OPTION_ID.test(value.optionId), "invalid response optionId");
			assert(USER_ID.test(value.userId), "invalid response userId");
			assert(
				value.id === `trp_${value.decisionId}:${value.userId}` &&
					entityId === value.id,
				"team response identity mismatch",
			);
			assert(value.version === entityVersion, "team response version mismatch");
			assert(DECIMAL.test(value.rootRevision), "invalid response rootRevision");
			assertDate(value.createdAt, "team response createdAt");
			break;
		}
	}
}

export async function putTeamSyncProjection(
	executor: SqlExecutor,
	accountUserId: string,
	entityType: TeamSyncEntityType,
	data: TeamSyncData,
): Promise<void> {
	const membership = await activeMembership(
		executor,
		accountUserId,
		data.rootEventId,
	);
	assert(membership, "team entity requires active membership");
	switch (entityType) {
		case "teamAssignmentSet":
			await putAssignmentSet(
				executor,
				accountUserId,
				data as SyncTeamAssignmentSetData,
			);
			break;
		case "teamAssignmentRoster":
			assert(manager(membership.role), "team roster is manager-only");
			await putAssignmentRoster(
				executor,
				accountUserId,
				data as SyncTeamAssignmentRosterData,
			);
			break;
		case "teamAssignment": {
			const assignment = data as SyncTeamAssignmentData;
			assert(membership.role !== "viewer", "viewer cannot receive assignment");
			assert(
				assignment.userId === accountUserId,
				"foreign team assignment is not materializable",
			);
			await putOwnAssignment(executor, accountUserId, assignment);
			break;
		}
		case "teamDecision": {
			const decision = data as SyncTeamDecisionData;
			assert(
				decision.state !== "draft" || manager(membership.role),
				"draft decision is manager-only",
			);
			await putDecision(executor, accountUserId, decision);
			break;
		}
		case "teamResponse": {
			const response = data as SyncTeamResponseData;
			assert(membership.role !== "viewer", "viewer cannot receive response");
			assert(
				response.userId === accountUserId,
				"foreign team response is not materializable",
			);
			await putOwnResponse(executor, accountUserId, response);
			break;
		}
	}
}

async function putAssignmentSet(
	executor: SqlExecutor,
	accountUserId: string,
	value: SyncTeamAssignmentSetData,
) {
	const current = await executor.first<{ version: number }>(
		`SELECT version FROM team_assignment_sets
WHERE account_user_id = ? AND root_event_id = ? AND event_id = ?`,
		[accountUserId, value.rootEventId, value.eventId],
	);
	if (current && Number(current.version) >= value.version) return;
	await executor.run(
		`INSERT INTO team_assignment_sets (
  account_user_id, root_event_id, event_id, version, updated_at
) VALUES (?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, event_id) DO UPDATE SET
  version = excluded.version, updated_at = excluded.updated_at
WHERE excluded.version > team_assignment_sets.version`,
		[
			accountUserId,
			value.rootEventId,
			value.eventId,
			value.version,
			value.updatedAt,
		],
	);
	await executor.run(
		`DELETE FROM team_assignment_teams
WHERE account_user_id = ? AND root_event_id = ? AND event_id = ?`,
		[accountUserId, value.rootEventId, value.eventId],
	);
	for (const [index, team] of value.teams.entries()) {
		await executor.run(
			`INSERT INTO team_assignment_teams (
  account_user_id, root_event_id, event_id, id, name, color, sort_position,
  assignment_version
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				accountUserId,
				value.rootEventId,
				value.eventId,
				team.id,
				team.name,
				team.color,
				index,
				value.version,
			],
		);
	}
}

async function putAssignmentRoster(
	executor: SqlExecutor,
	accountUserId: string,
	value: SyncTeamAssignmentRosterData,
) {
	if (!(await currentAssignmentVersion(executor, accountUserId, value))) return;
	await executor.run(
		`DELETE FROM team_assignment_roster_members
WHERE account_user_id = ? AND root_event_id = ? AND event_id = ?`,
		[accountUserId, value.rootEventId, value.eventId],
	);
	for (const team of value.teams) {
		await assertMatchingTeam(executor, accountUserId, value.eventId, team);
		for (const userId of team.memberUserIds) {
			await executor.run(
				`INSERT INTO team_assignment_roster_members (
  account_user_id, root_event_id, event_id, team_id, user_id, roster_version
) VALUES (?, ?, ?, ?, ?, ?)`,
				[
					accountUserId,
					value.rootEventId,
					value.eventId,
					team.id,
					userId,
					value.version,
				],
			);
		}
	}
}

async function putOwnAssignment(
	executor: SqlExecutor,
	accountUserId: string,
	value: SyncTeamAssignmentData,
) {
	if (!(await currentAssignmentVersion(executor, accountUserId, value))) return;
	await assertMatchingTeam(executor, accountUserId, value.eventId, value.team);
	await executor.run(
		`INSERT INTO team_own_assignments (
  account_user_id, root_event_id, event_id, user_id, team_id, version, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, event_id) DO UPDATE SET
  user_id = excluded.user_id, team_id = excluded.team_id,
  version = excluded.version, updated_at = excluded.updated_at
WHERE excluded.version > team_own_assignments.version`,
		[
			accountUserId,
			value.rootEventId,
			value.eventId,
			value.userId,
			value.team.id,
			value.version,
			value.updatedAt,
		],
	);
}

async function putDecision(
	executor: SqlExecutor,
	accountUserId: string,
	value: SyncTeamDecisionData,
) {
	const current = await executor.first<{ aggregate_version: number }>(
		`SELECT aggregate_version FROM team_decisions
WHERE account_user_id = ? AND root_event_id = ? AND id = ?`,
		[accountUserId, value.rootEventId, value.id],
	);
	if (current && Number(current.aggregate_version) >= value.aggregateVersion)
		return;
	const currentOptions = await executor.all<{ id: string }>(
		`SELECT id FROM team_decision_options
WHERE account_user_id = ? AND root_event_id = ? AND decision_id = ?
ORDER BY sort_position, id`,
		[accountUserId, value.rootEventId, value.id],
	);
	const optionsReplaced =
		currentOptions.length > 0 &&
		(currentOptions.length !== value.options.length ||
			currentOptions.some(
				(option, index) => option.id !== value.options[index]?.id,
			));
	assert(
		!optionsReplaced || value.responseCount === 0,
		"responded decision options cannot be replaced",
	);
	await executor.run(
		`INSERT INTO team_decisions (
  account_user_id, id, root_event_id, event_id, title, state, version,
  aggregate_version, response_count, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, id) DO UPDATE SET
  event_id = excluded.event_id, title = excluded.title, state = excluded.state,
  version = excluded.version, aggregate_version = excluded.aggregate_version,
  response_count = excluded.response_count, updated_at = excluded.updated_at
WHERE excluded.aggregate_version > team_decisions.aggregate_version`,
		[
			accountUserId,
			value.id,
			value.rootEventId,
			value.eventId,
			value.title,
			value.state,
			value.version,
			value.aggregateVersion,
			value.responseCount,
			value.createdAt,
			value.updatedAt,
		],
	);
	if (optionsReplaced) {
		await executor.run(
			`DELETE FROM team_decision_options
WHERE account_user_id = ? AND root_event_id = ? AND decision_id = ?`,
			[accountUserId, value.rootEventId, value.id],
		);
	}
	const retained = new Set(value.options.map(({ id }) => id));
	for (const [index, option] of value.options.entries()) {
		await executor.run(
			`INSERT INTO team_decision_options (
  account_user_id, root_event_id, decision_id, id, label, response_count,
  sort_position, aggregate_version
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, decision_id, id) DO UPDATE SET
  label = excluded.label, response_count = excluded.response_count,
  sort_position = excluded.sort_position,
  aggregate_version = excluded.aggregate_version
WHERE excluded.aggregate_version > team_decision_options.aggregate_version`,
			[
				accountUserId,
				value.rootEventId,
				value.id,
				option.id,
				option.label,
				option.responseCount,
				index,
				value.aggregateVersion,
			],
		);
	}
	const existing = await executor.all<{ id: string }>(
		`SELECT id FROM team_decision_options
WHERE account_user_id = ? AND root_event_id = ? AND decision_id = ?`,
		[accountUserId, value.rootEventId, value.id],
	);
	for (const option of existing) {
		if (!retained.has(option.id)) {
			await executor.run(
				`DELETE FROM team_decision_options
WHERE account_user_id = ? AND root_event_id = ? AND decision_id = ? AND id = ?`,
				[accountUserId, value.rootEventId, value.id, option.id],
			);
		}
	}
}

async function putOwnResponse(
	executor: SqlExecutor,
	accountUserId: string,
	value: SyncTeamResponseData,
) {
	const decision = await executor.first<{ event_id: string }>(
		`SELECT event_id FROM team_decisions
WHERE account_user_id = ? AND root_event_id = ? AND id = ?`,
		[accountUserId, value.rootEventId, value.decisionId],
	);
	assert(
		decision?.event_id === value.eventId,
		"team response decision mismatch",
	);
	const option = await executor.first(
		`SELECT 1 FROM team_decision_options
WHERE account_user_id = ? AND root_event_id = ? AND decision_id = ? AND id = ?`,
		[accountUserId, value.rootEventId, value.decisionId, value.optionId],
	);
	assert(option, "team response option is missing");
	await executor.run(
		`INSERT INTO team_own_responses (
  account_user_id, id, root_event_id, event_id, decision_id, user_id,
  option_id, version, root_revision, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, id) DO UPDATE SET
  option_id = excluded.option_id, version = excluded.version,
  root_revision = excluded.root_revision, updated_at = excluded.updated_at
WHERE excluded.version > team_own_responses.version`,
		[
			accountUserId,
			value.id,
			value.rootEventId,
			value.eventId,
			value.decisionId,
			value.userId,
			value.optionId,
			value.version,
			value.rootRevision,
			value.createdAt,
			value.updatedAt,
		],
	);
}

async function currentAssignmentVersion(
	executor: SqlExecutor,
	accountUserId: string,
	value: { rootEventId: string; eventId: string; version: number },
) {
	const set = await executor.first<{ version: number }>(
		`SELECT version FROM team_assignment_sets
WHERE account_user_id = ? AND root_event_id = ? AND event_id = ?`,
		[accountUserId, value.rootEventId, value.eventId],
	);
	assert(set, "team assignment set is missing");
	if (Number(set.version) > value.version) return false;
	assert(
		Number(set.version) === value.version,
		"team assignment projection version mismatch",
	);
	return true;
}

async function assertMatchingTeam(
	executor: SqlExecutor,
	accountUserId: string,
	eventId: string,
	team: SyncTeamPublicTeamData,
) {
	const row = await executor.first<{ name: string; color: string | null }>(
		`SELECT name, color FROM team_assignment_teams
WHERE account_user_id = ? AND event_id = ? AND id = ?`,
		[accountUserId, eventId, team.id],
	);
	assert(
		row?.name === team.name && row.color === team.color,
		"team assignment references an unknown team",
	);
}

async function activeMembership(
	executor: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
): Promise<MembershipRow | null> {
	return executor.first<MembershipRow>(
		`SELECT role, status FROM memberships
WHERE account_user_id = ? AND root_event_id = ? AND member_user_id = ?
  AND status = 'active'`,
		[accountUserId, rootEventId, accountUserId],
	);
}

async function latestLocalResponse(
	executor: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
	decisionId: string,
) {
	const rows = await executor.all<OutboxResponseRow>(
		`SELECT client_mutation_id, command_json, state, client_sequence
FROM mutation_outbox
WHERE account_user_id = ? AND root_event_id = ?
  AND operation_id = 'syncMutationsApply'
ORDER BY client_sequence DESC`,
		[accountUserId, rootEventId],
	);
	for (const row of rows) {
		const command = JSON.parse(row.command_json) as unknown;
		if (
			typeof command === "object" &&
			command !== null &&
			"kind" in command &&
			command.kind === "team.response.set" &&
			"payload" in command &&
			typeof command.payload === "object" &&
			command.payload !== null &&
			"decisionId" in command.payload &&
			command.payload.decisionId === decisionId &&
			"optionId" in command.payload &&
			typeof command.payload.optionId === "string"
		) {
			return {
				optionId: command.payload.optionId,
				mutationId: row.client_mutation_id,
				syncState:
					row.state === "awaiting_pull"
						? ("awaiting_pull" as const)
						: row.state === "blocked" || row.state === "dead_letter"
							? ("needs_attention" as const)
							: ("pending" as const),
			};
		}
	}
	return null;
}

function validatePublicTeams(teams: readonly SyncTeamPublicTeamData[]) {
	assert(teams.length >= 1 && teams.length <= 100, "invalid team count");
	const ids = new Set<string>();
	for (const team of teams) {
		assert(TEAM_ID.test(team.id) && !ids.has(team.id), "invalid team ID");
		assertText(team.name, 80, "team name");
		assert(team.color === null || COLOR.test(team.color), "invalid team color");
		ids.add(team.id);
	}
}

function validateRosterTeams(teams: SyncTeamAssignmentRosterData["teams"]) {
	validatePublicTeams(teams);
	const members = new Set<string>();
	for (const team of teams) {
		assert(
			team.memberUserIds.length >= 1 && team.memberUserIds.length <= 1_000,
			"invalid team roster size",
		);
		for (const userId of team.memberUserIds) {
			assert(
				USER_ID.test(userId) && !members.has(userId),
				"invalid team roster member",
			);
			members.add(userId);
		}
	}
	assert(members.size <= 1_000, "team roster is too large");
}

function validateDecisionOptions(options: SyncTeamDecisionData["options"]) {
	assert(options.length >= 2 && options.length <= 20, "invalid option count");
	const ids = new Set<string>();
	const labels = new Set<string>();
	for (const option of options) {
		const label = option.label.toLocaleLowerCase("en-US");
		assert(
			OPTION_ID.test(option.id) && !ids.has(option.id),
			"invalid option ID",
		);
		assertText(option.label, 160, "option label");
		assert(!labels.has(label), "duplicate option label");
		assertNonnegative(option.responseCount, "option responseCount");
		ids.add(option.id);
		labels.add(label);
	}
}

function publicTeam(row: TeamRow): SyncTeamPublicTeamData {
	return { id: row.id, name: row.name, color: row.color };
}

function manager(role: MembershipRow["role"]) {
	return role === "owner" || role === "organizer";
}

function assertRecord(
	value: unknown,
	field: string,
): asserts value is Record<string, unknown> {
	assert(
		typeof value === "object" && value !== null && !Array.isArray(value),
		`${field} must be an object`,
	);
}

function assertText(value: unknown, max: number, field: string) {
	assert(
		typeof value === "string" &&
			value === value.trim() &&
			value.length >= 1 &&
			value.length <= max,
		`invalid ${field}`,
	);
}

function assertPositive(value: unknown, field: string) {
	assert(Number.isSafeInteger(value) && Number(value) > 0, `invalid ${field}`);
}

function assertNonnegative(value: unknown, field: string) {
	assert(Number.isSafeInteger(value) && Number(value) >= 0, `invalid ${field}`);
}

function assertDate(value: unknown, field: string) {
	assert(
		typeof value === "string" &&
			Number.isFinite(Date.parse(value)) &&
			new Date(value).toISOString() === value,
		`invalid ${field}`,
	);
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(`Invalid sync page: ${message}`);
}
