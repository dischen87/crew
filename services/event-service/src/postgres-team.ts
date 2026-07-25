import type { Sql } from "postgres";
import { type Actor, DomainError, type Role } from "./domain";
import type { SystemFeedPayload } from "./system-feed";
import {
	sameTeamAssignmentSet,
	sameTeamDecision,
	type TeamAssignmentSetInput,
	type TeamAssignmentSetRecord,
	type TeamDecisionInput,
	type TeamDecisionRecord,
	type TeamResponseRecord,
	teamAssignmentEntityId,
	teamAssignmentRosterEntityId,
	teamResponseEntityId,
	validateTeamAssignmentSet,
	validateTeamDecision,
	validateTeamResponse,
} from "./team-domain";

type RootAccess = { revision: string; role: Role };
type AssignmentSetRow = {
	version: number;
	createdAt: Date;
	updatedAt: Date;
};
type ResponseRow = TeamResponseRecord;
export type TeamSystemFeedAppender = (
	revision: string,
	ordinal: number,
	payload: SystemFeedPayload,
) => Promise<void>;

export async function publishTeamAssignments(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	eventId: string,
	baseVersion: number,
	rawInput: TeamAssignmentSetInput,
	appendSystemFeed: TeamSystemFeedAppender,
) {
	await lockRoot(tx, actor, rootEventId, "manager");
	const capability = await requireTeamCapability(tx, rootEventId, eventId);
	if (!capability.visible)
		throw conflict(
			"TEAM_EVENT_NOT_PUBLISHED",
			"Team assignments can only be published for a member-visible event.",
		);
	const input = validateTeamAssignmentSet(rawInput, capability.capacityPerTeam);
	await requireAssignableMemberships(tx, rootEventId, input);
	const current = await findTeamAssignmentSet(tx, rootEventId, eventId);
	if (current && sameTeamAssignmentSet(current, input)) {
		return {
			assignments: current,
			rootRevision: await rootRevision(tx, rootEventId),
			unchanged: true,
		};
	}
	if (!current && baseVersion !== 0) throw versionConflict(0);
	if (current && current.version !== baseVersion)
		throw versionConflict(current.version);

	const priorUserIds = new Set(
		current?.teams.flatMap(({ memberUserIds }) => memberUserIds) ?? [],
	);
	const version = (current?.version ?? 0) + 1;
	if (!current) {
		await tx`
			INSERT INTO event_team_assignment_sets (root_event_id, event_id)
			VALUES (${rootEventId}, ${eventId})
		`;
	} else {
		await tx`
			UPDATE event_team_assignment_sets
			SET version = ${version}, updated_at = now()
			WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
		`;
		await tx`
			DELETE FROM event_team_members
			WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
		`;
		await tx`
			DELETE FROM event_team_teams
			WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
		`;
	}
	for (const [sortPosition, team] of input.teams.entries()) {
		await tx`
			INSERT INTO event_team_teams (
				id, root_event_id, event_id, name, color, sort_position, version
			) VALUES (
				${team.id}, ${rootEventId}, ${eventId}, ${team.name}, ${team.color},
				${sortPosition}, ${version}
			)
		`;
		for (const userId of team.memberUserIds) {
			await tx`
				INSERT INTO event_team_members (
					root_event_id, event_id, team_id, user_id
				) VALUES (${rootEventId}, ${eventId}, ${team.id}, ${userId})
			`;
		}
	}

	const revision = await nextRevision(tx, rootEventId);
	const assignments = required(
		await findTeamAssignmentSet(tx, rootEventId, eventId),
	);
	await appendChange(
		tx,
		rootEventId,
		revision,
		0,
		"teamAssignmentSet",
		eventId,
		assignments.version,
		teamAssignmentSetSync(assignments),
		"members",
	);
	await appendChange(
		tx,
		rootEventId,
		revision,
		1,
		"teamAssignmentRoster",
		teamAssignmentRosterEntityId(eventId),
		assignments.version,
		teamAssignmentRosterSync(assignments),
		"managers",
	);
	const assignedUserIds = assignments.teams.flatMap(
		({ memberUserIds }) => memberUserIds,
	);
	for (const [index, userId] of assignedUserIds.entries()) {
		await appendChange(
			tx,
			rootEventId,
			revision,
			index + 2,
			"teamAssignment",
			teamAssignmentEntityId(eventId, userId),
			assignments.version,
			required(teamMemberAssignmentSync(assignments, userId)),
			"actor",
			userId,
		);
		priorUserIds.delete(userId);
	}
	for (const [index, userId] of [...priorUserIds].sort().entries()) {
		const id = teamAssignmentEntityId(eventId, userId);
		await appendTombstone(
			tx,
			rootEventId,
			revision,
			assignedUserIds.length + index + 2,
			"teamAssignment",
			id,
			assignments.version,
			{
				entityType: "teamAssignment",
				id,
				rootEventId,
				eventId,
				version: assignments.version,
				deletedAt: assignments.updatedAt,
			},
			"actor",
			userId,
		);
	}
	await appendSystemFeed(
		revision,
		assignedUserIds.length + priorUserIds.size + 2,
		{
			schemaVersion: 1,
			type: "team.assignments.published",
			actorUserId: actor.id,
			eventId,
			entityVersion: assignments.version,
		},
	);
	return { assignments, rootRevision: revision, unchanged: false };
}

export async function replaceTeamDecision(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	eventId: string,
	decisionId: string,
	baseVersion: number,
	rawInput: TeamDecisionInput,
	appendSystemFeed: TeamSystemFeedAppender,
) {
	const input = validateTeamDecision(decisionId, rawInput);
	await lockRoot(tx, actor, rootEventId, "manager");
	const capability = await requireTeamCapability(tx, rootEventId, eventId);
	if (!capability.visible)
		throw conflict(
			"TEAM_EVENT_NOT_PUBLISHED",
			"Decisions can only be published for a member-visible event.",
		);
	const current = await findTeamDecision(tx, rootEventId, eventId, decisionId);
	if (current && sameTeamDecision(current, input)) {
		return {
			decision: current,
			rootRevision: await rootRevision(tx, rootEventId),
			unchanged: true,
		};
	}
	if (!current && baseVersion !== 0) throw versionConflict(0);
	if (current && current.version !== baseVersion)
		throw versionConflict(current.version);
	if (current?.state === "closed")
		throw conflict(
			"TEAM_DECISION_CLOSED",
			"A closed decision cannot be reopened or edited.",
		);
	if (current?.state === "open" && input.state === "draft")
		throw conflict(
			"TEAM_DECISION_STATE_INVALID",
			"An open decision cannot return to draft.",
		);
	if (
		current?.responseCount &&
		(current.title !== input.title || !sameDecisionOptions(current, input))
	) {
		throw conflict(
			"TEAM_DECISION_IMPACT_REVIEW_REQUIRED",
			"A decision with responses can only change lifecycle state.",
		);
	}

	if (!current) {
		await tx`
			INSERT INTO event_team_decisions (
				id, root_event_id, event_id, title, state, created_by
			) VALUES (
				${decisionId}, ${rootEventId}, ${eventId}, ${input.title},
				${input.state}, ${actor.id}
			)
		`;
	} else {
		await tx`
			UPDATE event_team_decisions SET title = ${input.title}, state = ${input.state},
				version = version + 1, aggregate_version = aggregate_version + 1,
				updated_at = now()
			WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
				AND id = ${decisionId} AND version = ${baseVersion}
		`;
		if (!sameDecisionOptions(current, input)) {
			await tx`
				DELETE FROM event_team_decision_options
				WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
					AND decision_id = ${decisionId}
			`;
		}
	}
	if (!current || !sameDecisionOptions(current, input)) {
		for (const [sortPosition, option] of input.options.entries()) {
			await tx`
				INSERT INTO event_team_decision_options (
					id, root_event_id, event_id, decision_id, label, sort_position
				) VALUES (
					${option.id}, ${rootEventId}, ${eventId}, ${decisionId},
					${option.label}, ${sortPosition}
				)
			`;
		}
	}
	const revision = await nextRevision(tx, rootEventId);
	const decision = required(
		await findTeamDecision(tx, rootEventId, eventId, decisionId),
	);
	await appendChange(
		tx,
		rootEventId,
		revision,
		0,
		"teamDecision",
		decision.id,
		decision.aggregateVersion,
		teamDecisionSync(decision),
		decision.state === "draft" ? "managers" : "members",
	);
	if (decision.state !== "draft") {
		await appendSystemFeed(revision, 1, {
			schemaVersion: 1,
			type:
				decision.state === "open"
					? "team.decision.opened"
					: "team.decision.closed",
			actorUserId: actor.id,
			eventId,
			decisionId,
			entityVersion: decision.version,
		});
	}
	return { decision, rootRevision: revision, unchanged: false };
}

export async function setTeamResponse(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	eventId: string,
	decisionId: string,
	entityId: string,
	baseVersion: number,
	optionId: string,
) {
	validateTeamResponse(decisionId, optionId);
	await lockRoot(tx, actor, rootEventId, "participant");
	const capability = await requireTeamCapability(tx, rootEventId, eventId);
	if (!capability.visible) throw notFound();
	if (entityId !== teamResponseEntityId(decisionId, actor.id))
		throw conflict(
			"SYNC_ENTITY_ID_MISMATCH",
			"The response ID does not match its decision and actor.",
		);
	const decision = required(
		await findTeamDecision(tx, rootEventId, eventId, decisionId),
	);
	const current = await findTeamResponse(
		tx,
		rootEventId,
		eventId,
		decisionId,
		actor.id,
		true,
	);
	if (current?.optionId === optionId) {
		return {
			response: current,
			decision,
			rootRevision: current.rootRevision,
			unchanged: true,
		};
	}
	if (decision.state !== "open")
		throw conflict(
			"TEAM_DECISION_NOT_OPEN",
			"The decision is not open for responses.",
		);
	if (!decision.options.some((option) => option.id === optionId))
		throw new DomainError(
			400,
			"TEAM_RESPONSE_INVALID",
			"The selected decision option is invalid.",
		);
	if (!current && baseVersion !== 0) throw versionConflict(0);
	if (current && current.version !== baseVersion)
		throw versionConflict(current.version);

	const revision = await nextRevision(tx, rootEventId);
	const [response] = current
		? await tx<ResponseRow[]>`
			UPDATE event_team_decision_responses
			SET option_id = ${optionId}, version = version + 1,
				root_revision = ${revision}::bigint, updated_at = now()
			WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
				AND decision_id = ${decisionId} AND user_id = ${actor.id}
				AND version = ${baseVersion}
			RETURNING ${responseColumns(tx)}
		`
		: await tx<ResponseRow[]>`
			INSERT INTO event_team_decision_responses (
				id, root_event_id, event_id, decision_id, user_id, option_id,
				root_revision
			) VALUES (
				${entityId}, ${rootEventId}, ${eventId}, ${decisionId}, ${actor.id},
				${optionId}, ${revision}::bigint
			)
			RETURNING ${responseColumns(tx)}
		`;
	if (!response) throw new Error("Team response write invariant failed");
	await tx`
		UPDATE event_team_decisions
		SET aggregate_version = aggregate_version + 1, updated_at = now()
		WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
			AND id = ${decisionId}
	`;
	const aggregate = required(
		await findTeamDecision(tx, rootEventId, eventId, decisionId),
	);
	await appendChange(
		tx,
		rootEventId,
		revision,
		0,
		"teamResponse",
		response.id,
		response.version,
		teamResponseSync(response),
		"actor",
		actor.id,
	);
	await appendChange(
		tx,
		rootEventId,
		revision,
		1,
		"teamDecision",
		aggregate.id,
		aggregate.aggregateVersion,
		teamDecisionSync(aggregate),
		"members",
	);
	return {
		response,
		decision: aggregate,
		rootRevision: revision,
		unchanged: false,
	};
}

export async function assertTeamAssignmentsReplaySafe(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	eventId: string,
) {
	await lockRoot(tx, actor, rootEventId, "manager");
	await requireTeamCapability(tx, rootEventId, eventId);
	required(await findTeamAssignmentSet(tx, rootEventId, eventId));
}

export async function assertTeamDecisionReplaySafe(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	eventId: string,
	decisionId: string,
) {
	await lockRoot(tx, actor, rootEventId, "manager");
	await requireTeamCapability(tx, rootEventId, eventId);
	required(await findTeamDecision(tx, rootEventId, eventId, decisionId));
}

export async function assertTeamResponseReplaySafe(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	eventId: string,
	decisionId: string,
	entityId: string,
) {
	await lockRoot(tx, actor, rootEventId, "participant");
	await requireTeamCapability(tx, rootEventId, eventId);
	if (entityId !== teamResponseEntityId(decisionId, actor.id))
		throw conflict(
			"SYNC_ENTITY_ID_MISMATCH",
			"The response ID does not match its decision and actor.",
		);
	required(
		await findTeamResponse(
			tx,
			rootEventId,
			eventId,
			decisionId,
			actor.id,
			false,
		),
	);
}

export async function getTeamAssignments(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	eventId: string,
) {
	const access = await readRootAccess(tx, actor, rootEventId);
	const capability = await requireTeamCapability(tx, rootEventId, eventId);
	if (!capability.visible && !manager(access.role)) throw notFound();
	const assignments = required(
		await findTeamAssignmentSet(tx, rootEventId, eventId),
	);
	return {
		assignments: teamAssignmentSetSync(assignments),
		roster: manager(access.role) ? teamAssignmentRosterSync(assignments) : null,
		assignment:
			access.role === "viewer"
				? null
				: teamMemberAssignmentSync(assignments, actor.id, false),
	};
}

export async function getTeamDecision(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	eventId: string,
	decisionId: string,
) {
	const access = await readRootAccess(tx, actor, rootEventId);
	const capability = await requireTeamCapability(tx, rootEventId, eventId);
	if (!capability.visible && !manager(access.role)) throw notFound();
	const decision = required(
		await findTeamDecision(tx, rootEventId, eventId, decisionId),
	);
	if (decision.state === "draft" && !manager(access.role)) throw notFound();
	const response =
		access.role === "viewer"
			? null
			: await findTeamResponse(
					tx,
					rootEventId,
					eventId,
					decisionId,
					actor.id,
					false,
				);
	return { decision: teamDecisionSync(decision), response };
}

export async function teamSnapshotRecords(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
) {
	const access = await readRootAccess(tx, actor, rootEventId);
	const managerAccess = manager(access.role);
	const eventRows = await tx<{ eventId: string }[]>`
		SELECT assignment_set.event_id AS "eventId"
		FROM event_team_assignment_sets assignment_set
		JOIN events event ON event.root_event_id = assignment_set.root_event_id
			AND event.id = assignment_set.event_id AND event.deleted_at IS NULL
		WHERE assignment_set.root_event_id = ${rootEventId}
			AND (${managerAccess} OR event_sync_event_is_member_visible(
				assignment_set.root_event_id, assignment_set.event_id
			))
		ORDER BY assignment_set.event_id
	`;
	const records: {
		entityType:
			| "teamAssignmentSet"
			| "teamAssignmentRoster"
			| "teamAssignment"
			| "teamDecision"
			| "teamResponse";
		entityId: string;
		entityVersion: number;
		data: Record<string, unknown>;
	}[] = [];
	for (const { eventId } of eventRows) {
		const assignments = required(
			await findTeamAssignmentSet(tx, rootEventId, eventId),
		);
		records.push({
			entityType: "teamAssignmentSet",
			entityId: eventId,
			entityVersion: assignments.version,
			data: teamAssignmentSetSync(assignments),
		});
		if (managerAccess) {
			records.push({
				entityType: "teamAssignmentRoster",
				entityId: teamAssignmentRosterEntityId(eventId),
				entityVersion: assignments.version,
				data: teamAssignmentRosterSync(assignments),
			});
		}
		if (access.role !== "viewer") {
			const assignment = teamMemberAssignmentSync(assignments, actor.id, false);
			if (assignment) {
				records.push({
					entityType: "teamAssignment",
					entityId: teamAssignmentEntityId(eventId, actor.id),
					entityVersion: assignments.version,
					data: assignment,
				});
			}
		}
	}

	const decisionRows = await tx<{ eventId: string; decisionId: string }[]>`
		SELECT decision.event_id AS "eventId", decision.id AS "decisionId"
		FROM event_team_decisions decision
		JOIN events event ON event.root_event_id = decision.root_event_id
			AND event.id = decision.event_id AND event.deleted_at IS NULL
		WHERE decision.root_event_id = ${rootEventId}
			AND (${managerAccess} OR (
				decision.state <> 'draft' AND event_sync_event_is_member_visible(
					decision.root_event_id, decision.event_id
				)
			))
		ORDER BY decision.event_id, decision.id
	`;
	for (const { eventId, decisionId } of decisionRows) {
		const decision = required(
			await findTeamDecision(tx, rootEventId, eventId, decisionId),
		);
		records.push({
			entityType: "teamDecision",
			entityId: decision.id,
			entityVersion: decision.aggregateVersion,
			data: teamDecisionSync(decision),
		});
		if (access.role !== "viewer") {
			const response = await findTeamResponse(
				tx,
				rootEventId,
				eventId,
				decisionId,
				actor.id,
				false,
			);
			if (response) {
				records.push({
					entityType: "teamResponse",
					entityId: response.id,
					entityVersion: response.version,
					data: teamResponseSync(response),
				});
			}
		}
	}
	return records.sort(
		(left, right) =>
			left.entityType.localeCompare(right.entityType) ||
			left.entityId.localeCompare(right.entityId),
	);
}

async function findTeamAssignmentSet(
	tx: Sql,
	rootEventId: string,
	eventId: string,
): Promise<TeamAssignmentSetRecord | null> {
	const [row] = await tx<AssignmentSetRow[]>`
		SELECT assignment_set.version, assignment_set.created_at AS "createdAt",
			assignment_set.updated_at AS "updatedAt"
		FROM event_team_assignment_sets assignment_set
		WHERE assignment_set.root_event_id = ${rootEventId}
			AND assignment_set.event_id = ${eventId}
	`;
	if (!row) return null;
	const [capability] = await tx<{ capacityPerTeam: number | null }[]>`
		SELECT (config->>'capacityPerTeam')::int AS "capacityPerTeam"
		FROM event_capabilities
		WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
			AND capability_type = 'team' AND deleted_at IS NULL
	`;
	if (!capability) throw notFound();
	const teams = await tx<
		{ id: string; name: string; color: string | null; sortPosition: number }[]
	>`
		SELECT id, name, color, sort_position AS "sortPosition"
		FROM event_team_teams
		WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
		ORDER BY sort_position, id
	`;
	const members = await tx<{ teamId: string; userId: string }[]>`
		SELECT team_id AS "teamId", user_id AS "userId"
		FROM event_team_members
		WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
		ORDER BY team_id, user_id
	`;
	return {
		rootEventId,
		eventId,
		capacityPerTeam: capability.capacityPerTeam,
		teams: teams.map(({ sortPosition: _, ...team }) => ({
			...team,
			memberUserIds: members
				.filter((member) => member.teamId === team.id)
				.map((member) => member.userId),
		})),
		...row,
	};
}

async function findTeamDecision(
	tx: Sql,
	rootEventId: string,
	eventId: string,
	decisionId: string,
): Promise<TeamDecisionRecord | null> {
	const [row] = await tx<
		{
			id: string;
			title: string;
			state: TeamDecisionRecord["state"];
			version: number;
			aggregateVersion: number;
			createdAt: Date;
			updatedAt: Date;
		}[]
	>`
		SELECT id, title, state, version, aggregate_version AS "aggregateVersion",
			created_at AS "createdAt", updated_at AS "updatedAt"
		FROM event_team_decisions
		WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
			AND id = ${decisionId}
	`;
	if (!row) return null;
	const options = await tx<
		{ id: string; label: string; responseCount: number }[]
	>`
		SELECT option.id, option.label, count(response.id)::int AS "responseCount"
		FROM event_team_decision_options option
		LEFT JOIN event_team_decision_responses response
			ON response.root_event_id = option.root_event_id
			AND response.event_id = option.event_id
			AND response.decision_id = option.decision_id
			AND response.option_id = option.id
		WHERE option.root_event_id = ${rootEventId} AND option.event_id = ${eventId}
			AND option.decision_id = ${decisionId}
		GROUP BY option.id, option.label, option.sort_position
		ORDER BY option.sort_position, option.id
	`;
	return {
		rootEventId,
		eventId,
		...row,
		options,
		responseCount: options.reduce(
			(total, option) => total + option.responseCount,
			0,
		),
	};
}

async function findTeamResponse(
	tx: Sql,
	rootEventId: string,
	eventId: string,
	decisionId: string,
	userId: string,
	lock: boolean,
) {
	const suffix = lock ? tx`FOR UPDATE` : tx``;
	const [response] = await tx<ResponseRow[]>`
		SELECT ${responseColumns(tx)} FROM event_team_decision_responses
		WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
			AND decision_id = ${decisionId} AND user_id = ${userId}
		${suffix}
	`;
	return response ?? null;
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
			AND root.ownership_state = 'next'
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

async function requireTeamCapability(
	tx: Sql,
	rootEventId: string,
	eventId: string,
) {
	const [row] = await tx<
		{ capacityPerTeam: number | null; visible: boolean }[]
	>`
		SELECT (capability.config->>'capacityPerTeam')::int AS "capacityPerTeam",
			event_sync_event_is_member_visible(event.root_event_id, event.id) AS visible
		FROM events event
		JOIN event_capabilities capability
			ON capability.root_event_id = event.root_event_id
			AND capability.event_id = event.id
			AND capability.capability_type = 'team'
		WHERE event.root_event_id = ${rootEventId} AND event.id = ${eventId}
			AND event.deleted_at IS NULL AND capability.deleted_at IS NULL
		FOR SHARE OF event, capability
	`;
	if (!row) throw notFound();
	return row;
}

async function requireAssignableMemberships(
	tx: Sql,
	rootEventId: string,
	input: TeamAssignmentSetInput,
) {
	const ids = input.teams.flatMap(({ memberUserIds }) => memberUserIds);
	const rows = await tx<{ userId: string }[]>`
		SELECT user_id AS "userId" FROM event_memberships
		WHERE root_event_id = ${rootEventId} AND status = 'active'
			AND role <> 'viewer' AND user_id = ANY(${ids}::text[])
		FOR SHARE
	`;
	if (rows.length !== ids.length)
		throw new DomainError(
			400,
			"TEAM_ASSIGNMENTS_INVALID",
			"Every assigned person must be an active non-viewer root member.",
		);
}

async function nextRevision(tx: Sql, rootEventId: string) {
	const [row] = await tx<{ revision: string }[]>`
		UPDATE event_roots SET revision = revision + 1
		WHERE root_event_id = ${rootEventId}
		RETURNING revision::text AS revision
	`;
	if (!row) throw new Error("Team root revision invariant failed");
	return row.revision;
}

async function rootRevision(tx: Sql, rootEventId: string) {
	const [row] = await tx<{ revision: string }[]>`
		SELECT revision::text AS revision FROM event_roots
		WHERE root_event_id = ${rootEventId}
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

async function appendTombstone(
	tx: Sql,
	rootEventId: string,
	revision: string,
	ordinal: number,
	entityType: string,
	entityId: string,
	entityVersion: number,
	tombstone: Record<string, unknown>,
	audience: "members" | "managers" | "actor",
	audienceUserId: string | null = null,
) {
	await tx`
		INSERT INTO event_root_changes (
			root_event_id, root_revision, ordinal, entity_type, entity_id,
			operation, entity_version, tombstone, audience, audience_user_id
		) VALUES (
			${rootEventId}, ${revision}::bigint, ${ordinal}, ${entityType}, ${entityId},
			'tombstone', ${entityVersion}, ${tx.json(tombstone as never)}, ${audience},
			${audienceUserId}
		)
	`;
}

function responseColumns(sql: Sql) {
	return sql`
		id, root_event_id AS "rootEventId", event_id AS "eventId",
		decision_id AS "decisionId", user_id AS "userId", option_id AS "optionId",
		version, root_revision::text AS "rootRevision",
		created_at AS "createdAt", updated_at AS "updatedAt"
	`;
}

function teamAssignmentSetSync(assignments: TeamAssignmentSetRecord) {
	return {
		rootEventId: assignments.rootEventId,
		eventId: assignments.eventId,
		teams: assignments.teams.map(({ memberUserIds: _, ...team }) => team),
		version: assignments.version,
		updatedAt: assignments.updatedAt,
	};
}

function teamAssignmentRosterSync(assignments: TeamAssignmentSetRecord) {
	return {
		rootEventId: assignments.rootEventId,
		eventId: assignments.eventId,
		teams: assignments.teams,
		version: assignments.version,
		updatedAt: assignments.updatedAt,
	};
}

function teamMemberAssignmentSync(
	assignments: TeamAssignmentSetRecord,
	userId: string,
	requiredAssignment = true,
): Record<string, unknown> | null {
	const team = assignments.teams.find(({ memberUserIds }) =>
		memberUserIds.includes(userId),
	);
	if (!team) {
		if (requiredAssignment)
			throw new Error("Team member assignment invariant failed");
		return null;
	}
	const { memberUserIds: _, ...publicTeam } = team;
	return {
		rootEventId: assignments.rootEventId,
		eventId: assignments.eventId,
		userId,
		team: publicTeam,
		version: assignments.version,
		updatedAt: assignments.updatedAt,
	};
}

function teamDecisionSync(decision: TeamDecisionRecord) {
	return { ...decision };
}

function teamResponseSync(response: TeamResponseRecord) {
	return { ...response };
}

function sameDecisionOptions(
	current: TeamDecisionRecord,
	input: TeamDecisionInput,
) {
	return (
		JSON.stringify(current.options.map(({ id, label }) => ({ id, label }))) ===
		JSON.stringify(input.options)
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
