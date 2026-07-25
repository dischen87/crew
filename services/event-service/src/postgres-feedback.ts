import type { Sql } from "postgres";
import { type Actor, DomainError, type Role } from "./domain";
import type {
	FeedbackAttachment,
	FeedbackComment,
	FeedbackDiagnostics,
	FeedbackInput,
	FeedbackRecord,
	FeedbackStatus,
	FeedbackStatusChange,
	FeedbackVisibility,
} from "./feedback-domain";
import { lockFeedbackDuplicateScopes } from "./feedback-lock";

type FeedbackRow = {
	id: string;
	rootEventId: string | null;
	eventId: string | null;
	screenKey: string | null;
	title: string;
	body: string;
	visibility: FeedbackVisibility;
	diagnostics: FeedbackDiagnostics | null;
	authorUserId: string;
	status: FeedbackStatus;
	duplicateOfFeedbackId: string | null;
	version: number;
	createdAt: Date;
	updatedAt: Date;
	membershipRole: Role | null;
	membershipActive: boolean;
	voteCount: number;
	viewerHasVoted: boolean;
};

const FEEDBACK_HISTORY_LIMIT = 1_000;
const FEEDBACK_COMMENT_LIMIT = 1_000;
const FEEDBACK_COLLECTION_PROJECTION_LIMIT = 20;

export async function assertFeedbackAccess(
	tx: Sql,
	actor: Actor,
	feedbackId: string,
	access: "read" | "member" | "manage",
) {
	const row = await feedbackRow(tx, actor, feedbackId);
	if (!row) throw notFound();
	if (access !== "read") await lockFeedbackRootsNext(tx, [feedbackId]);
	await lockCurrentMembership(tx, row, actor);
	authorize(row, actor, access);
}

export async function createFeedback(
	tx: Sql,
	actor: Actor,
	input: FeedbackInput,
) {
	await tx`SELECT pg_advisory_xact_lock(hashtextextended(${input.id}, 0))`;
	await tx`SELECT id FROM event_feedback WHERE id = ${input.id} FOR SHARE`;
	const existing = await feedbackRow(tx, actor, input.id);
	if (existing) {
		await lockFeedbackRootsNext(tx, [input.id]);
		const attachmentIds = await feedbackAttachmentIds(tx, input.id);
		if (
			existing.authorUserId === actor.id &&
			sameFeedback(existing, input, attachmentIds)
		) {
			await lockCurrentMembership(tx, existing, actor);
			return feedbackRecord(tx, actor, existing);
		}
		throw conflict("ID_COLLISION", "The feedback ID is already in use.");
	}
	const role = await validateContext(
		tx,
		actor,
		input.rootEventId,
		input.eventId,
	);
	const attachmentBindings = await validateAttachments(
		tx,
		actor,
		input.id,
		input.rootEventId,
		role,
		input.attachmentIds,
	);
	await tx`
		INSERT INTO event_feedback (
			id, root_event_id, event_id, screen_key, title, body, visibility,
			diagnostics, author_user_id
		) VALUES (
			${input.id}, ${input.rootEventId}, ${input.eventId}, ${input.screenKey},
			${input.title}, ${input.body}, ${input.visibility},
			${input.diagnostics ? tx.json(input.diagnostics as never) : null}, ${actor.id}
		)
	`;
	await tx`
		INSERT INTO event_feedback_status_history (
			feedback_id, version, from_status, to_status, changed_by
		) VALUES (${input.id}, 1, NULL, 'open', ${actor.id})
	`;
	for (const [ordinal, attachmentId] of input.attachmentIds.entries()) {
		const binding = attachmentBindings.get(attachmentId);
		if (!binding)
			throw new Error("Feedback attachment binding invariant failed");
		await tx`
			INSERT INTO event_feedback_attachments (
				feedback_id, root_event_id, attachment_id, ordinal,
				attachment_target_type, attachment_target_feedback_id
			) VALUES (
				${input.id}, ${input.rootEventId}, ${attachmentId}, ${ordinal},
				${binding.targetType}, ${binding.targetFeedbackId}
			)
		`;
	}
	return getFeedback(tx, actor, input.id);
}

export async function getFeedback(tx: Sql, actor: Actor, feedbackId: string) {
	const row = await feedbackRow(tx, actor, feedbackId);
	if (!row) throw notFound();
	await lockCurrentMembership(tx, row, actor);
	authorize(row, actor, "read");
	return feedbackRecord(tx, actor, row);
}

export async function setFeedbackVote(
	tx: Sql,
	actor: Actor,
	feedbackId: string,
	present: boolean,
) {
	await lockFeedbackRootsNext(tx, [feedbackId]);
	await lockFeedback(tx, feedbackId);
	await requiredFeedbackRow(tx, actor, feedbackId, "member");
	if (present) {
		await tx`
			INSERT INTO event_feedback_votes (feedback_id, user_id)
			VALUES (${feedbackId}, ${actor.id})
			ON CONFLICT DO NOTHING
		`;
	} else {
		await tx`
			DELETE FROM event_feedback_votes
			WHERE feedback_id = ${feedbackId} AND user_id = ${actor.id}
		`;
	}
	return getFeedback(tx, actor, feedbackId);
}

export async function addFeedbackComment(
	tx: Sql,
	actor: Actor,
	feedbackId: string,
	input: { id: string; body: string },
) {
	await lockFeedbackRootsNext(tx, [feedbackId]);
	await lockFeedback(tx, feedbackId);
	await requiredFeedbackRow(tx, actor, feedbackId, "member");
	await tx`SELECT pg_advisory_xact_lock(hashtextextended(${input.id}, 0))`;
	const [existing] = await tx<
		{ feedbackId: string; authorUserId: string; body: string }[]
	>`
		SELECT feedback_id AS "feedbackId", author_user_id AS "authorUserId", body
		FROM event_feedback_comments WHERE id = ${input.id}
	`;
	if (existing) {
		if (
			existing.feedbackId !== feedbackId ||
			existing.authorUserId !== actor.id ||
			existing.body !== input.body
		)
			throw conflict(
				"ID_COLLISION",
				"The feedback comment ID is already in use.",
			);
	} else {
		const [capacity] = await tx<{ count: number }[]>`
			SELECT count(*)::int AS count FROM event_feedback_comments
			WHERE feedback_id = ${feedbackId}
		`;
		if ((capacity?.count ?? 0) >= FEEDBACK_COMMENT_LIMIT)
			throw conflict(
				"FEEDBACK_COMMENT_LIMIT_REACHED",
				"The feedback cannot contain more comments.",
			);
		await tx`
			INSERT INTO event_feedback_comments (id, feedback_id, author_user_id, body)
			VALUES (${input.id}, ${feedbackId}, ${actor.id}, ${input.body})
		`;
	}
	return getFeedback(tx, actor, feedbackId);
}

export async function markFeedbackDuplicate(
	tx: Sql,
	actor: Actor,
	feedbackId: string,
	canonicalFeedbackId: string,
	note: string | null,
) {
	if (feedbackId === canonicalFeedbackId)
		throw conflict(
			"FEEDBACK_DUPLICATE_INVALID",
			"Feedback cannot be a duplicate of itself.",
		);
	const rootEventIds = await feedbackRootScopes(tx, [
		feedbackId,
		canonicalFeedbackId,
	]);
	await lockFeedbackDuplicateScopes(tx, rootEventIds);
	await lockFeedbackRootScopesNext(tx, rootEventIds);
	await lockFeedbackDuplicateSet(tx, feedbackId, canonicalFeedbackId);
	const source = await requiredFeedbackRow(tx, actor, feedbackId, "manage");
	const canonical = await requiredFeedbackRow(
		tx,
		actor,
		canonicalFeedbackId,
		"read",
	);
	if (
		source.rootEventId !== canonical.rootEventId ||
		source.visibility !== canonical.visibility ||
		canonical.status === "duplicate"
	)
		throw conflict(
			"FEEDBACK_DUPLICATE_INVALID",
			"The canonical feedback must be a non-duplicate in the same visibility scope.",
		);
	if (
		source.status === "duplicate" &&
		source.duplicateOfFeedbackId === canonicalFeedbackId
	)
		return feedbackRecord(tx, actor, source);
	if (source.status === "duplicate")
		throw conflict(
			"FEEDBACK_ALREADY_DUPLICATE",
			"Reopen the feedback before assigning a different canonical item.",
		);
	await tx`
		UPDATE event_feedback
		SET duplicate_of_feedback_id = ${canonicalFeedbackId}, updated_at = now()
		WHERE status = 'duplicate' AND duplicate_of_feedback_id = ${source.id}
	`;
	await transition(tx, actor, source, "duplicate", note, canonicalFeedbackId);
	return getFeedback(tx, actor, feedbackId);
}

export async function setFeedbackStatus(
	tx: Sql,
	actor: Actor,
	feedbackId: string,
	status: Exclude<FeedbackStatus, "duplicate">,
	note: string | null,
) {
	const rootEventIds = await feedbackRootScopes(tx, [feedbackId]);
	await lockFeedbackDuplicateScopes(tx, rootEventIds);
	await lockFeedbackRootScopesNext(tx, rootEventIds);
	await lockFeedback(tx, feedbackId);
	const current = await requiredFeedbackRow(tx, actor, feedbackId, "manage");
	if (current.status === status) return feedbackRecord(tx, actor, current);
	if (!statusTransitionAllowed(current.status, status))
		throw conflict(
			"FEEDBACK_STATUS_TRANSITION_INVALID",
			"The requested feedback status transition is not allowed.",
		);
	await transition(tx, actor, current, status, note, null);
	return getFeedback(tx, actor, feedbackId);
}

async function transition(
	tx: Sql,
	actor: Actor,
	current: FeedbackRow,
	status: FeedbackStatus,
	note: string | null,
	duplicateOfFeedbackId: string | null,
) {
	if (current.version >= FEEDBACK_HISTORY_LIMIT)
		throw conflict(
			"FEEDBACK_HISTORY_LIMIT_REACHED",
			"The feedback cannot contain more status transitions.",
		);
	const version = current.version + 1;
	await tx`
		UPDATE event_feedback SET status = ${status},
			duplicate_of_feedback_id = ${duplicateOfFeedbackId}, version = ${version},
			updated_at = now()
		WHERE id = ${current.id} AND version = ${current.version}
	`;
	await tx`
		INSERT INTO event_feedback_status_history (
			feedback_id, version, from_status, to_status, changed_by, note
		) VALUES (
			${current.id}, ${version}, ${current.status}, ${status}, ${actor.id}, ${note}
		)
	`;
}

async function validateContext(
	tx: Sql,
	actor: Actor,
	rootEventId: string | null,
	eventId: string | null,
) {
	if (!rootEventId) return null;
	const [membership] = await tx<{ role: Role; ownershipState: string }[]>`
		SELECT membership.role, root.ownership_state AS "ownershipState"
		FROM event_roots root
		JOIN event_memberships membership
			ON membership.root_event_id = root.root_event_id
		WHERE root.root_event_id = ${rootEventId}
			AND membership.user_id = ${actor.id} AND membership.status = 'active'
		FOR UPDATE OF root
	`;
	if (!membership) throw notFound();
	if (membership.ownershipState !== "next")
		throw conflict(
			"ROOT_WRITE_NOT_AUTHORITATIVE",
			"Crew Next is not authoritative for this event root.",
		);
	if (!eventId) return membership.role;
	const [event] = await tx<{ id: string }[]>`
		SELECT id FROM events
		WHERE root_event_id = ${rootEventId} AND id = ${eventId} AND deleted_at IS NULL
		FOR SHARE
	`;
	if (!event) throw notFound();
	return membership.role;
}

async function validateAttachments(
	tx: Sql,
	actor: Actor,
	feedbackId: string,
	rootEventId: string | null,
	role: Role | null,
	attachmentIds: string[],
) {
	const bindings = new Map<
		string,
		{ targetType: "feed_entry" | "feedback"; targetFeedbackId: string | null }
	>();
	if (attachmentIds.length === 0) return bindings;
	if (!rootEventId || !role) throw notFound();
	if (!managerRole(role)) {
		await tx`
			SELECT id FROM events WHERE root_event_id = ${rootEventId}
			ORDER BY id FOR SHARE
		`;
	}
	const cleanupJobs = await tx<
		{ attachmentId: string; status: string; attempts: number }[]
	>`
		SELECT attachment.id AS "attachmentId", job.status, job.attempts
		FROM event_attachments attachment
		JOIN event_attachment_cleanup_jobs job ON job.upload_id = attachment.upload_id
		WHERE attachment.root_event_id = ${rootEventId}
			AND attachment.id IN ${tx(attachmentIds)}
		ORDER BY job.upload_id
		FOR UPDATE OF job
	`;
	const cleanupByAttachment = new Map(
		cleanupJobs.map((job) => [job.attachmentId, job]),
	);
	const attachments = await tx<
		{
			id: string;
			targetType: "feed_entry" | "feedback";
			targetFeedbackId: string | null;
			createdBy: string;
			uploadState: "prepared" | "committed" | "expired";
		}[]
	>`
		SELECT attachment.id, attachment.target_type AS "targetType",
			attachment.target_feedback_id AS "targetFeedbackId",
			attachment.created_by AS "createdBy", upload.state AS "uploadState"
		FROM event_attachments attachment
		JOIN event_attachment_uploads upload ON upload.id = attachment.upload_id
		WHERE attachment.root_event_id = ${rootEventId}
			AND attachment.id IN ${tx(attachmentIds)}
		ORDER BY attachment.id
		FOR UPDATE OF attachment, upload
	`;
	if (attachments.length !== attachmentIds.length) throw notFound();
	for (const attachment of attachments) {
		if (attachment.uploadState !== "committed") throw notFound();
		if (attachment.targetType === "feedback") {
			const cleanup = cleanupByAttachment.get(attachment.id);
			if (
				attachment.targetFeedbackId !== feedbackId ||
				attachment.createdBy !== actor.id ||
				cleanup?.status !== "pending" ||
				cleanup.attempts !== 0
			)
				throw notFound();
			bindings.set(attachment.id, {
				targetType: "feedback",
				targetFeedbackId: feedbackId,
			});
			continue;
		}
		const [visibleAttachment] = await tx<{ id: string }[]>`
			SELECT attachment.id
			FROM event_attachments attachment
			JOIN event_feed_entries entry
				ON entry.root_event_id = attachment.root_event_id
				AND entry.id = attachment.target_entry_id
			JOIN event_feed_entry_current current
				ON current.root_event_id = entry.root_event_id
				AND current.entry_id = entry.id
			WHERE attachment.root_event_id = ${rootEventId}
				AND attachment.id = ${attachment.id}
				AND attachment.target_type = 'feed_entry'
				AND current.deleted_at IS NULL
				${attachmentVisibility(tx, role)}
			FOR SHARE OF attachment, entry, current
		`;
		if (!visibleAttachment) throw notFound();
		bindings.set(attachment.id, {
			targetType: "feed_entry",
			targetFeedbackId: null,
		});
	}
	return bindings;
}

async function requiredFeedbackRow(
	tx: Sql,
	actor: Actor,
	feedbackId: string,
	access: "read" | "member" | "manage",
) {
	const row = await feedbackRow(tx, actor, feedbackId);
	if (!row) throw notFound();
	await lockCurrentMembership(tx, row, actor);
	authorize(row, actor, access);
	return row;
}

async function feedbackRow(tx: Sql, actor: Actor, feedbackId: string) {
	const [row] = await tx<FeedbackRow[]>`
		SELECT feedback.id, feedback.root_event_id AS "rootEventId",
			feedback.event_id AS "eventId", feedback.screen_key AS "screenKey",
			feedback.title, feedback.body, feedback.visibility, feedback.diagnostics,
			feedback.author_user_id AS "authorUserId", feedback.status,
			feedback.duplicate_of_feedback_id AS "duplicateOfFeedbackId",
			feedback.version, feedback.created_at AS "createdAt",
			feedback.updated_at AS "updatedAt", membership.role AS "membershipRole",
			(membership.status = 'active') AS "membershipActive",
			(SELECT count(*)::int FROM event_feedback_votes vote
				WHERE vote.feedback_id = feedback.id) AS "voteCount",
			EXISTS(SELECT 1 FROM event_feedback_votes vote
				WHERE vote.feedback_id = feedback.id AND vote.user_id = ${actor.id})
				AS "viewerHasVoted"
		FROM event_feedback feedback
		LEFT JOIN event_memberships membership
			ON membership.root_event_id = feedback.root_event_id
			AND membership.user_id = ${actor.id}
		WHERE feedback.id = ${feedbackId}
	`;
	return row ?? null;
}

async function feedbackRecord(tx: Sql, actor: Actor, row: FeedbackRow) {
	authorize(row, actor, "read");
	const [collectionCounts] = await tx<
		{ commentCount: number; statusHistoryCount: number }[]
	>`
		SELECT
			(SELECT count(*)::int FROM event_feedback_comments
				WHERE feedback_id = ${row.id}) AS "commentCount",
			(SELECT count(*)::int FROM event_feedback_status_history
				WHERE feedback_id = ${row.id}) AS "statusHistoryCount"
	`;
	const storedComments = await tx<
		(FeedbackComment & { authorUserId: string })[]
	>`
		SELECT * FROM (
			SELECT id, author_user_id AS "authorUserId", body,
				created_at AS "createdAt"
			FROM event_feedback_comments WHERE feedback_id = ${row.id}
			ORDER BY created_at DESC, id DESC
			LIMIT ${FEEDBACK_COLLECTION_PROJECTION_LIMIT}
		) recent ORDER BY "createdAt", id
	`;
	const storedStatusHistory = await tx<
		(FeedbackStatusChange & { changedBy: string })[]
	>`
		SELECT * FROM (
			SELECT version, from_status AS "fromStatus", to_status AS "toStatus",
				changed_by AS "changedBy", note, changed_at AS "changedAt"
			FROM event_feedback_status_history WHERE feedback_id = ${row.id}
			ORDER BY version DESC
			LIMIT ${FEEDBACK_COLLECTION_PROJECTION_LIMIT}
		) recent ORDER BY version
	`;
	const attachments = row.membershipActive
		? await tx<FeedbackAttachment[]>`
				SELECT id, "contentType", "byteCount", sha256, caption, "createdAt"
				FROM (
					SELECT attachment.id,
						attachment.content_type AS "contentType",
						attachment.byte_count AS "byteCount", attachment.sha256,
						attachment.caption, attachment.created_at AS "createdAt",
						link.ordinal
					FROM event_feedback_attachments link
					JOIN event_attachments attachment
						ON attachment.root_event_id = link.root_event_id
						AND attachment.id = link.attachment_id
					JOIN event_feed_entries entry
						ON entry.root_event_id = attachment.root_event_id
						AND entry.id = attachment.target_entry_id
					JOIN event_feed_entry_current current
						ON current.root_event_id = entry.root_event_id
						AND current.entry_id = entry.id
					WHERE link.feedback_id = ${row.id}
						AND link.attachment_target_type = 'feed_entry'
						AND attachment.target_type = 'feed_entry'
						AND current.deleted_at IS NULL
						${attachmentVisibility(tx, row.membershipRole)}

					UNION ALL

					SELECT attachment.id,
						attachment.content_type AS "contentType",
						attachment.byte_count AS "byteCount", attachment.sha256,
						attachment.caption, attachment.created_at AS "createdAt",
						link.ordinal
					FROM event_feedback_attachments link
					JOIN event_attachments attachment
						ON attachment.root_event_id = link.root_event_id
						AND attachment.id = link.attachment_id
					WHERE link.feedback_id = ${row.id}
						AND link.attachment_target_type = 'feedback'
						AND link.attachment_target_feedback_id = link.feedback_id
						AND attachment.target_type = 'feedback'
						AND attachment.target_feedback_id = link.feedback_id
				) stored
				ORDER BY ordinal
			`
		: [];
	const privileged = isAuthor(row, actor) || isManager(row);
	const comments = storedComments.map((comment) => ({
		...comment,
		authorUserId: privileged ? comment.authorUserId : null,
	}));
	const statusHistory = storedStatusHistory.map((change) => ({
		...change,
		changedBy: privileged ? change.changedBy : null,
	}));
	const contextVisible =
		isAuthor(row, actor) || row.membershipActive || row.rootEventId === null;
	const hasContext =
		row.rootEventId !== null || row.eventId !== null || row.screenKey !== null;
	return {
		id: row.id,
		title: row.title,
		body: row.body,
		visibility: row.visibility,
		context: hasContext
			? {
					rootEventId: contextVisible ? row.rootEventId : null,
					eventId: contextVisible ? row.eventId : null,
					screenKey: row.screenKey,
				}
			: null,
		diagnostics: privileged ? row.diagnostics : null,
		authorUserId: privileged ? row.authorUserId : null,
		status: row.status,
		duplicateOfFeedbackId: row.duplicateOfFeedbackId,
		version: row.version,
		voteCount: row.voteCount,
		viewerHasVoted: row.viewerHasVoted,
		attachments,
		comments,
		commentCount: collectionCounts?.commentCount ?? 0,
		commentsHasMore: (collectionCounts?.commentCount ?? 0) > comments.length,
		statusHistory,
		statusHistoryCount: collectionCounts?.statusHistoryCount ?? 0,
		statusHistoryHasMore:
			(collectionCounts?.statusHistoryCount ?? 0) > statusHistory.length,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	} satisfies FeedbackRecord;
}

function authorize(
	row: FeedbackRow,
	actor: Actor,
	access: "read" | "member" | "manage",
) {
	const readable =
		isAuthor(row, actor) ||
		isManager(row) ||
		(row.visibility === "public" &&
			(row.rootEventId === null || row.membershipActive));
	if (!readable) throw notFound();
	if (access === "member" && row.rootEventId !== null && !row.membershipActive)
		throw notFound();
	if (access === "manage") {
		const manageable = row.rootEventId ? isManager(row) : isAuthor(row, actor);
		if (!manageable) throw forbidden();
	}
}

async function lockCurrentMembership(tx: Sql, row: FeedbackRow, actor: Actor) {
	if (!row.rootEventId) return;
	const [membership] = await tx<{ role: Role; membershipActive: boolean }[]>`
		SELECT role, (status = 'active') AS "membershipActive"
		FROM event_memberships
		WHERE root_event_id = ${row.rootEventId} AND user_id = ${actor.id}
		FOR SHARE
	`;
	row.membershipRole = membership?.role ?? null;
	row.membershipActive = membership?.membershipActive ?? false;
}

function isAuthor(row: FeedbackRow, actor: Actor) {
	return row.authorUserId === actor.id;
}

function isManager(row: FeedbackRow) {
	return (
		row.membershipActive &&
		(row.membershipRole === "owner" || row.membershipRole === "organizer")
	);
}

async function lockFeedback(tx: Sql, feedbackId: string) {
	await tx`SELECT id FROM event_feedback WHERE id = ${feedbackId} FOR UPDATE`;
}

async function lockFeedbackRootsNext(tx: Sql, feedbackIds: string[]) {
	const roots = await tx<{ rootEventId: string }[]>`
		SELECT root_event_id AS "rootEventId" FROM event_feedback
		WHERE id IN ${tx(feedbackIds)} AND root_event_id IS NOT NULL
		ORDER BY root_event_id
	`;
	await lockFeedbackRootScopesNext(
		tx,
		roots.map((root) => root.rootEventId),
	);
}

async function lockFeedbackRootScopesNext(
	tx: Sql,
	rootEventIds: Array<string | null>,
) {
	for (const rootEventId of [
		...new Set(rootEventIds.filter((id): id is string => id !== null)),
	].sort()) {
		const [root] = await tx<{ ownershipState: string }[]>`
			SELECT ownership_state AS "ownershipState" FROM event_roots
			WHERE root_event_id = ${rootEventId} FOR SHARE
		`;
		if (root?.ownershipState !== "next")
			throw conflict(
				"ROOT_WRITE_NOT_AUTHORITATIVE",
				"Crew Next is not authoritative for this event root.",
			);
	}
}

async function lockFeedbackDuplicateSet(
	tx: Sql,
	sourceId: string,
	canonicalId: string,
) {
	await tx`
		SELECT id FROM event_feedback
		WHERE id IN (${sourceId}, ${canonicalId})
			OR (status = 'duplicate' AND duplicate_of_feedback_id = ${sourceId})
		ORDER BY id FOR UPDATE
	`;
}

async function feedbackRootScopes(tx: Sql, feedbackIds: string[]) {
	const rows = await tx<{ rootEventId: string | null }[]>`
		SELECT root_event_id AS "rootEventId"
		FROM event_feedback WHERE id IN ${tx(feedbackIds)}
	`;
	return rows.map((row) => row.rootEventId);
}

function sameFeedback(
	row: FeedbackRow,
	input: FeedbackInput,
	attachmentIds: string[],
) {
	return (
		row.rootEventId === input.rootEventId &&
		row.eventId === input.eventId &&
		row.screenKey === input.screenKey &&
		row.title === input.title &&
		row.body === input.body &&
		row.visibility === input.visibility &&
		sameDiagnostics(row.diagnostics, input.diagnostics) &&
		sameStrings(attachmentIds, input.attachmentIds)
	);
}

async function feedbackAttachmentIds(tx: Sql, feedbackId: string) {
	const rows = await tx<{ id: string }[]>`
		SELECT attachment_id AS id FROM event_feedback_attachments
		WHERE feedback_id = ${feedbackId} ORDER BY ordinal
	`;
	return rows.map((row) => row.id);
}

function sameDiagnostics(
	left: FeedbackDiagnostics | null,
	right: FeedbackDiagnostics | null,
) {
	if (!left || !right) return left === right;
	return (
		left.appVersion === right.appVersion &&
		left.buildNumber === right.buildNumber &&
		left.platform === right.platform &&
		left.osVersion === right.osVersion &&
		left.deviceModel === right.deviceModel &&
		left.locale === right.locale
	);
}

function statusTransitionAllowed(
	from: FeedbackStatus,
	to: Exclude<FeedbackStatus, "duplicate">,
) {
	if (from === "duplicate" || from === "completed" || from === "declined")
		return to === "open";
	return from !== to;
}

function sameStrings(left: string[], right: string[]) {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

function managerRole(role: Role | null) {
	return role === "owner" || role === "organizer";
}

function attachmentVisibility(tx: Sql, role: Role | null) {
	if (managerRole(role)) return tx``;
	return tx`
		AND COALESCE(entry.event_id, entry.root_event_id) IN (
			WITH RECURSIVE visible AS (
				SELECT id FROM events
				WHERE root_event_id = entry.root_event_id
					AND id = entry.root_event_id AND status = 'published'
					AND deleted_at IS NULL
				UNION ALL
				SELECT child.id FROM events child
				JOIN visible parent ON child.parent_event_id = parent.id
				WHERE child.root_event_id = entry.root_event_id
					AND child.status = 'published' AND child.deleted_at IS NULL
			)
			SELECT id FROM visible
		)
	`;
}

function notFound() {
	return new DomainError(404, "NOT_FOUND", "Resource not found.");
}

function forbidden() {
	return new DomainError(
		403,
		"FORBIDDEN",
		"Your role does not permit this feedback action.",
	);
}

function conflict(code: string, message: string) {
	return new DomainError(409, code, message);
}
