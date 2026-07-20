import type { Sql } from "postgres";
import type {
	CommunityFeedbackDetail,
	CommunityFeedbackDuplicateSuggestionItem,
	CommunityFeedbackDuplicateSuggestionPage,
	CommunityFeedbackDuplicateSuggestionPageKey,
	CommunityFeedbackFollow,
	CommunityFeedbackListItem,
	CommunityFeedbackPage,
	CommunityFeedbackPageKey,
	CommunityFeedbackResolution,
	CommunityFeedbackStatus,
	CommunityFeedbackUpdateItem,
	CommunityFeedbackUpdatePage,
	CommunityFeedbackUpdatePageKey,
} from "./community-feedback-domain";
import { type Actor, DomainError } from "./domain";
import type { FeedbackStatus } from "./feedback-domain";
import { lockFeedbackDuplicateScopes } from "./feedback-lock";

type CommunityFeedbackRow = CommunityFeedbackListItem;
type FeedbackLinkRow = {
	id: string;
	status: FeedbackStatus;
	duplicateOfFeedbackId: string | null;
};

const COMMENT_LIMIT = 1_000;
const COLLECTION_PROJECTION_LIMIT = 20;
const DUPLICATE_SUGGESTION_LIMIT = 5;
const LIST_LIMIT = 10;
const UPDATE_LIMIT = 50;

export async function listCommunityFeedback(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	page: {
		limit: number;
		after: CommunityFeedbackPageKey | null;
		status: CommunityFeedbackStatus | null;
		followedOnly: boolean;
	},
): Promise<CommunityFeedbackPage> {
	await requireActiveMembership(tx, actor, rootEventId);
	const limit = Math.min(page.limit, LIST_LIMIT);
	const rows = await communityRows(tx, actor, rootEventId, {
		limit: limit + 1,
		after: page.after,
		status: page.status,
		followedOnly: page.followedOnly,
		id: null,
	});
	return slice(rows, limit);
}

export async function listCommunityFeedbackDuplicateSuggestions(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	search: {
		tokens: string[];
		limit: number;
		after: CommunityFeedbackDuplicateSuggestionPageKey | null;
	},
): Promise<CommunityFeedbackDuplicateSuggestionPage> {
	await requireActiveMembership(tx, actor, rootEventId);
	const limit = Math.min(search.limit, DUPLICATE_SUGGESTION_LIMIT);
	// ponytail: a bounded root-local scan avoids a search service; add a stored
	// search vector only if real roots grow enough for this query to become slow.
	const rows = await tx<CommunityFeedbackDuplicateSuggestionItem[]>`
		WITH candidates AS (
			SELECT feedback.id, feedback.title, feedback.status,
				feedback.updated_at AS sort_updated_at,
				(
					cardinality(${search.tokens}::text[]) - (
						SELECT count(*)::int
						FROM unnest(${search.tokens}::text[]) token
						WHERE strpos(
							lower(normalize(feedback.title, NFKC)), token
						) > 0
					)
				)::int AS "cursorRank",
				(
					SELECT count(DISTINCT vote.user_id)::int
					FROM event_feedback member
					JOIN event_feedback_votes vote ON vote.feedback_id = member.id
					WHERE member.root_event_id = ${rootEventId}
						AND member.visibility = 'public'
						AND (
							member.id = feedback.id OR
							(member.status = 'duplicate'
								AND member.duplicate_of_feedback_id = feedback.id)
						)
				) AS "voteCount"
			FROM event_feedback feedback
			WHERE feedback.root_event_id = ${rootEventId}
				AND feedback.visibility = 'public'
				AND feedback.status <> 'duplicate'
				AND NOT EXISTS (
					SELECT 1 FROM unnest(${search.tokens}::text[]) token
					WHERE strpos(
						lower(normalize(feedback.title || ' ' || feedback.body, NFKC)),
						token
					) = 0
				)
		)
		SELECT id, title, status, "voteCount", "cursorRank",
			sort_updated_at::text AS "cursorUpdatedAt"
		FROM candidates
		WHERE TRUE
			${
				search.after
					? tx`AND (
						"cursorRank" > ${search.after.rank} OR
						("cursorRank" = ${search.after.rank}
							AND sort_updated_at < ${search.after.updatedAt}::text::timestamptz) OR
						("cursorRank" = ${search.after.rank}
							AND sort_updated_at = ${search.after.updatedAt}::text::timestamptz
							AND id < ${search.after.id})
					)`
					: tx``
			}
		ORDER BY "cursorRank", sort_updated_at DESC, id DESC
		LIMIT ${limit + 1}
	`;
	return slice(rows, limit);
}

export async function listCommunityFeedbackUpdates(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	page: {
		limit: number;
		after: CommunityFeedbackUpdatePageKey | null;
		followedOnly: boolean;
	},
): Promise<CommunityFeedbackUpdatePage> {
	await requireActiveMembership(tx, actor, rootEventId);
	const limit = Math.min(page.limit, UPDATE_LIMIT);
	const rows = await tx<CommunityFeedbackUpdateItem[]>`
		SELECT feedback.id AS "feedbackId", feedback.title, history.version,
			history.from_status AS "fromStatus", history.to_status AS "toStatus",
			history.note, history.changed_at AS "changedAt",
			history.changed_at::text AS "cursorChangedAt"
		FROM event_feedback_status_history history
		JOIN event_feedback feedback ON feedback.id = history.feedback_id
		WHERE feedback.root_event_id = ${rootEventId}
			AND feedback.visibility = 'public'
			AND feedback.status <> 'duplicate'
			AND history.from_status IS NOT NULL
			AND history.from_status <> 'duplicate'
			AND history.to_status <> 'duplicate'
			${
				page.followedOnly
					? tx`AND ${followedGroup(tx, actor.id, rootEventId)}`
					: tx``
			}
			${
				page.after
					? tx`AND (
					history.changed_at < ${page.after.changedAt}::text::timestamptz OR
					(history.changed_at = ${page.after.changedAt}::text::timestamptz
						AND feedback.id < ${page.after.feedbackId}) OR
					(history.changed_at = ${page.after.changedAt}::text::timestamptz
							AND feedback.id = ${page.after.feedbackId}
							AND history.version < ${page.after.version})
					)`
					: tx``
			}
		ORDER BY history.changed_at DESC, feedback.id DESC, history.version DESC
		LIMIT ${limit + 1}
	`;
	return slice(rows, limit);
}

export async function getCommunityFeedback(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	feedbackId: string,
): Promise<CommunityFeedbackResolution> {
	await requireActiveMembership(tx, actor, rootEventId);
	const canonicalId = await requiredCanonicalId(tx, rootEventId, feedbackId);
	return {
		feedback: await requiredDetail(tx, actor, rootEventId, canonicalId),
		redirectedFromFeedbackId: canonicalId === feedbackId ? null : feedbackId,
	};
}

export async function setCommunityFeedbackVote(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	feedbackId: string,
	present: boolean,
): Promise<CommunityFeedbackResolution> {
	await requireActiveMembership(tx, actor, rootEventId);
	const canonicalId = await lockCanonicalGroup(tx, rootEventId, feedbackId);
	await tx`
		DELETE FROM event_feedback_votes vote
		USING event_feedback member
		WHERE vote.feedback_id = member.id AND vote.user_id = ${actor.id}
			AND member.root_event_id = ${rootEventId}
			AND member.visibility = 'public'
			AND (
				member.id = ${canonicalId} OR
				(member.status = 'duplicate'
					AND member.duplicate_of_feedback_id = ${canonicalId})
			)
	`;
	if (present) {
		await tx`
			INSERT INTO event_feedback_votes (feedback_id, user_id)
			VALUES (${canonicalId}, ${actor.id})
			ON CONFLICT DO NOTHING
		`;
	}
	return {
		feedback: await requiredDetail(tx, actor, rootEventId, canonicalId),
		redirectedFromFeedbackId: canonicalId === feedbackId ? null : feedbackId,
	};
}

export async function addCommunityFeedbackComment(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	feedbackId: string,
	input: { id: string; body: string },
): Promise<CommunityFeedbackResolution> {
	await requireActiveMembership(tx, actor, rootEventId);
	const canonicalId = await lockCanonicalGroup(tx, rootEventId, feedbackId);
	await tx`SELECT pg_advisory_xact_lock(hashtextextended(${input.id}, 0))`;
	const [existing] = await tx<
		{ feedbackId: string; authorUserId: string; body: string }[]
	>`
		SELECT feedback_id AS "feedbackId", author_user_id AS "authorUserId", body
		FROM event_feedback_comments WHERE id = ${input.id}
	`;
	if (existing) {
		if (
			existing.feedbackId !== canonicalId ||
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
			WHERE feedback_id = ${canonicalId}
		`;
		if ((capacity?.count ?? 0) >= COMMENT_LIMIT)
			throw conflict(
				"FEEDBACK_COMMENT_LIMIT_REACHED",
				"The feedback cannot contain more comments.",
			);
		await tx`
			INSERT INTO event_feedback_comments (id, feedback_id, author_user_id, body)
			VALUES (${input.id}, ${canonicalId}, ${actor.id}, ${input.body})
		`;
	}
	return {
		feedback: await requiredDetail(tx, actor, rootEventId, canonicalId),
		redirectedFromFeedbackId: canonicalId === feedbackId ? null : feedbackId,
	};
}

export async function setCommunityFeedbackFollow(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	feedbackId: string,
	followed: boolean,
): Promise<CommunityFeedbackFollow> {
	await requireActiveMembership(tx, actor, rootEventId);
	const canonicalId = await lockCanonicalGroup(tx, rootEventId, feedbackId);
	await tx`
		DELETE FROM event_feedback_follows follow
		USING event_feedback member
		WHERE follow.feedback_id = member.id AND follow.user_id = ${actor.id}
			AND follow.root_event_id = ${rootEventId}
			AND member.root_event_id = ${rootEventId}
			AND member.visibility = 'public'
			AND (
				member.id = ${canonicalId} OR
				(member.status = 'duplicate'
					AND member.duplicate_of_feedback_id = ${canonicalId})
			)
	`;
	if (followed) {
		await tx`
			INSERT INTO event_feedback_follows (
				root_event_id, feedback_id, user_id
			) VALUES (${rootEventId}, ${canonicalId}, ${actor.id})
		`;
	}
	return { feedbackId: canonicalId, followed };
}

export async function assertCommunityFeedbackAccess(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	feedbackId: string,
	expectedCanonicalId: string,
) {
	await requireActiveMembership(tx, actor, rootEventId);
	const canonicalId = await requiredCanonicalId(tx, rootEventId, feedbackId);
	if (canonicalId !== expectedCanonicalId) throw notFound();
}

async function requiredDetail(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	canonicalId: string,
): Promise<CommunityFeedbackDetail> {
	const [summary] = await communityRows(tx, actor, rootEventId, {
		limit: 1,
		after: null,
		status: null,
		followedOnly: false,
		id: canonicalId,
	});
	if (!summary) throw notFound();
	const { cursorUpdatedAt: _, ...publicSummary } = summary;
	const [collectionCounts] = await tx<
		{ commentCount: number; statusHistoryCount: number }[]
	>`
		SELECT
			(SELECT count(*)::int FROM event_feedback_comments
				WHERE feedback_id = ${canonicalId}) AS "commentCount",
			(SELECT count(*)::int FROM event_feedback_status_history
				WHERE feedback_id = ${canonicalId}
					AND to_status <> 'duplicate'
					AND (from_status IS NULL OR from_status <> 'duplicate'))
				AS "statusHistoryCount"
	`;
	const comments = await tx<CommunityFeedbackDetail["comments"]>`
		SELECT * FROM (
			SELECT id, body, created_at AS "createdAt"
			FROM event_feedback_comments
			WHERE feedback_id = ${canonicalId}
			ORDER BY created_at DESC, id DESC
			LIMIT ${COLLECTION_PROJECTION_LIMIT}
		) recent ORDER BY "createdAt", id
	`;
	const statusHistory = await tx<CommunityFeedbackDetail["statusHistory"]>`
		SELECT * FROM (
			SELECT version, from_status AS "fromStatus", to_status AS "toStatus",
				note, changed_at AS "changedAt"
			FROM event_feedback_status_history
			WHERE feedback_id = ${canonicalId}
				AND to_status <> 'duplicate'
				AND (from_status IS NULL OR from_status <> 'duplicate')
			ORDER BY version DESC
			LIMIT ${COLLECTION_PROJECTION_LIMIT}
		) recent ORDER BY version
	`;
	return {
		...publicSummary,
		comments,
		commentCount: collectionCounts?.commentCount ?? 0,
		commentsHasMore: (collectionCounts?.commentCount ?? 0) > comments.length,
		statusHistory,
		statusHistoryCount: collectionCounts?.statusHistoryCount ?? 0,
		statusHistoryHasMore:
			(collectionCounts?.statusHistoryCount ?? 0) > statusHistory.length,
	};
}

async function communityRows(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
	query: {
		limit: number;
		after: CommunityFeedbackPageKey | null;
		status: CommunityFeedbackStatus | null;
		followedOnly: boolean;
		id: string | null;
	},
) {
	return tx<CommunityFeedbackRow[]>`
		SELECT feedback.id, feedback.title, feedback.body, feedback.status,
			feedback.version,
			(
				SELECT count(DISTINCT vote.user_id)::int
				FROM event_feedback member
				JOIN event_feedback_votes vote ON vote.feedback_id = member.id
				WHERE member.root_event_id = ${rootEventId}
					AND member.visibility = 'public'
					AND (
						member.id = feedback.id OR
						(member.status = 'duplicate'
							AND member.duplicate_of_feedback_id = feedback.id)
					)
			) AS "voteCount",
			(
				SELECT count(*)::int FROM event_feedback duplicate
				WHERE duplicate.root_event_id = ${rootEventId}
					AND duplicate.visibility = 'public'
					AND duplicate.status = 'duplicate'
					AND duplicate.duplicate_of_feedback_id = feedback.id
			) AS "duplicateCount",
			EXISTS (
				SELECT 1 FROM event_feedback member
				JOIN event_feedback_votes vote ON vote.feedback_id = member.id
				WHERE vote.user_id = ${actor.id}
					AND member.root_event_id = ${rootEventId}
					AND member.visibility = 'public'
					AND (
						member.id = feedback.id OR
						(member.status = 'duplicate'
							AND member.duplicate_of_feedback_id = feedback.id)
					)
			) AS "viewerHasVoted",
			${followedGroup(tx, actor.id, rootEventId)} AS followed,
			feedback.created_at AS "createdAt", feedback.updated_at AS "updatedAt",
			feedback.updated_at::text AS "cursorUpdatedAt"
		FROM event_feedback feedback
		WHERE feedback.root_event_id = ${rootEventId}
			AND feedback.visibility = 'public'
			AND feedback.status <> 'duplicate'
			${query.id ? tx`AND feedback.id = ${query.id}` : tx``}
			${query.status ? tx`AND feedback.status = ${query.status}` : tx``}
			${
				query.followedOnly
					? tx`AND ${followedGroup(tx, actor.id, rootEventId)}`
					: tx``
			}
			${
				query.after
					? tx`AND (
					feedback.updated_at < ${query.after.updatedAt}::text::timestamptz OR
					(feedback.updated_at = ${query.after.updatedAt}::text::timestamptz
							AND feedback.id < ${query.after.id})
					)`
					: tx``
			}
		ORDER BY feedback.updated_at DESC, feedback.id DESC
		LIMIT ${query.limit}
	`;
}

function followedGroup(tx: Sql, actorId: string, rootEventId: string) {
	return tx`EXISTS (
		SELECT 1
		FROM event_feedback_follows follow
		JOIN event_feedback followed ON followed.id = follow.feedback_id
		WHERE follow.user_id = ${actorId}
			AND follow.root_event_id = ${rootEventId}
			AND followed.root_event_id = ${rootEventId}
			AND followed.visibility = 'public'
			AND (
				followed.id = feedback.id OR
				(followed.status = 'duplicate'
					AND followed.duplicate_of_feedback_id = feedback.id)
			)
	)`;
}

async function lockCanonicalGroup(
	tx: Sql,
	rootEventId: string,
	feedbackId: string,
) {
	await lockFeedbackDuplicateScopes(tx, [rootEventId]);
	const canonicalId = await requiredCanonicalId(tx, rootEventId, feedbackId);
	await tx`
		SELECT id FROM event_feedback
		WHERE root_event_id = ${rootEventId} AND visibility = 'public'
			AND (
				id = ${canonicalId} OR
				(status = 'duplicate' AND duplicate_of_feedback_id = ${canonicalId})
			)
		ORDER BY id FOR UPDATE
	`;
	return canonicalId;
}

async function requiredCanonicalId(
	tx: Sql,
	rootEventId: string,
	feedbackId: string,
) {
	const [source] = await tx<FeedbackLinkRow[]>`
		SELECT id, status, duplicate_of_feedback_id AS "duplicateOfFeedbackId"
		FROM event_feedback
		WHERE id = ${feedbackId} AND root_event_id = ${rootEventId}
			AND visibility = 'public'
	`;
	if (!source) throw notFound();
	const canonicalId =
		source.status === "duplicate" ? source.duplicateOfFeedbackId : source.id;
	if (!canonicalId) throw notFound();
	const [canonical] = await tx<{ id: string }[]>`
		SELECT id FROM event_feedback
		WHERE id = ${canonicalId} AND root_event_id = ${rootEventId}
			AND visibility = 'public' AND status <> 'duplicate'
	`;
	if (!canonical) throw notFound();
	return canonical.id;
}

async function requireActiveMembership(
	tx: Sql,
	actor: Actor,
	rootEventId: string,
) {
	const [membership] = await tx<{ userId: string }[]>`
		SELECT membership.user_id AS "userId"
		FROM event_roots root
		JOIN event_memberships membership
			ON membership.root_event_id = root.root_event_id
		WHERE root.root_event_id = ${rootEventId}
			AND membership.user_id = ${actor.id}
			AND membership.status = 'active'
		FOR SHARE OF root, membership
	`;
	if (!membership) throw notFound();
}

function slice<T>(rows: T[], limit: number) {
	return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

function notFound() {
	return new DomainError(404, "NOT_FOUND", "Resource not found.");
}

function conflict(code: string, message: string) {
	return new DomainError(409, code, message);
}
