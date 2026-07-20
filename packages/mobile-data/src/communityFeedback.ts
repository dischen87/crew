import {
	type GatewayClient,
	GatewayClientError,
	type GatewayRequest,
	type GatewayResponseData,
	type GatewaySessionSubject,
} from "@crew/mobile-client";
import type { SqlDatabase, SqlExecutor } from "./database.ts";

export type CommunityFeedbackPage = GatewayResponseData<"eventFeedbackList">;
export type CommunityFeedbackSummary = CommunityFeedbackPage["items"][number];
export type CommunityFeedbackStatus = CommunityFeedbackSummary["status"];
export type CommunityFeedbackResolution =
	GatewayResponseData<"eventFeedbackGet">;
export type CommunityFeedback = CommunityFeedbackResolution["feedback"];
export type CommunityFeedbackUpdatePage =
	GatewayResponseData<"eventFeedbackUpdatesList">;
export type CommunityFeedbackUpdate =
	CommunityFeedbackUpdatePage["items"][number];
export type CommunityFeedbackFollow =
	GatewayResponseData<"eventFeedbackFollowsSet">;
export type CommunityFeedbackCommentInput =
	GatewayRequest<"eventFeedbackCommentsCreate">["body"];

export interface CommunityFeedbackPageQuery {
	limit?: number;
	cursor?: string;
	status?: CommunityFeedbackStatus;
	followedOnly?: boolean;
}

export interface CommunityFeedbackUpdatePageQuery {
	limit?: number;
	cursor?: string;
	followedOnly?: boolean;
}

export interface CommunityFeedbackFilter {
	statuses?: readonly CommunityFeedbackStatus[];
	followedOnly?: boolean;
	query?: string;
}

export interface CommunityFeedbackControllerOptions {
	now?: () => Date;
}

interface CachedFeedbackRow {
	summary_json: string;
	followed: number;
}

interface CachedDetailRow extends CachedFeedbackRow {
	detail_json: string | null;
}

interface CachedUpdateRow {
	payload_json: string;
}

interface CommunityFeedbackQueues {
	remote: Map<string, Promise<void>>;
	database: Map<string, Promise<void>>;
}

const queuesByDatabase = new WeakMap<SqlDatabase, CommunityFeedbackQueues>();

const accountPattern = /^usr_[a-f0-9]{32}$/;
const rootPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const feedbackPattern = /^fbk_[A-Za-z0-9._:-]{1,96}$/;

export class CommunityFeedbackAccountChangedError extends Error {
	constructor() {
		super("Active account changed during community feedback request");
		this.name = "CommunityFeedbackAccountChangedError";
	}
}

export class CommunityFeedbackController {
	readonly #now: () => Date;
	readonly #queues: Map<string, Promise<void>>;
	readonly #databaseQueues: Map<string, Promise<void>>;

	constructor(
		private readonly database: SqlDatabase,
		private readonly client: GatewayClient,
		options: CommunityFeedbackControllerOptions = {},
	) {
		const queues = queuesFor(database);
		this.#queues = queues.remote;
		this.#databaseQueues = queues.database;
		this.#now = options.now ?? (() => new Date());
	}

	async refreshList(
		rootEventId: string,
		query: CommunityFeedbackPageQuery = {},
	): Promise<CommunityFeedbackPage> {
		return this.#runForRoot(rootEventId, async (subject, accountUserId) => {
			const response = await this.client.requestAsUser(
				subject,
				"eventFeedbackList",
				{
					path: { rootEventId },
					...requestQuery(listQuery(query)),
				},
			);
			await this.#assertSubject(subject);
			const page = sanitizeFeedbackPage(response.data);
			const refreshedAt = this.#timestamp();
			await this.#transaction(
				subject,
				accountUserId,
				rootEventId,
				async (transaction) => {
					await reconcileCompleteFeedbackPage(
						transaction,
						accountUserId,
						rootEventId,
						query,
						page,
					);
					for (const feedback of page.items) {
						await cacheSummary(
							transaction,
							accountUserId,
							rootEventId,
							feedback,
							refreshedAt,
						);
					}
				},
			);
			return page;
		});
	}

	async refreshUpdates(
		rootEventId: string,
		query: CommunityFeedbackUpdatePageQuery = {},
	): Promise<CommunityFeedbackUpdatePage> {
		return this.#runForRoot(rootEventId, async (subject, accountUserId) => {
			const response = await this.client.requestAsUser(
				subject,
				"eventFeedbackUpdatesList",
				{
					path: { rootEventId },
					...requestQuery(updateQuery(query)),
				},
			);
			await this.#assertSubject(subject);
			const page = sanitizeUpdatePage(response.data);
			const refreshedAt = this.#timestamp();
			await this.#transaction(
				subject,
				accountUserId,
				rootEventId,
				async (transaction) => {
					await reconcileCompleteUpdatePage(
						transaction,
						accountUserId,
						rootEventId,
						query,
						page,
					);
					for (const update of page.items) {
						await cacheUpdate(
							transaction,
							accountUserId,
							rootEventId,
							update,
							refreshedAt,
						);
					}
				},
			);
			return page;
		});
	}

	async refresh(
		rootEventId: string,
		feedbackId: string,
	): Promise<CommunityFeedbackResolution> {
		validateFeedbackId(feedbackId);
		return this.#runForRoot(rootEventId, async (subject, accountUserId) => {
			const response = await this.client.requestAsUser(
				subject,
				"eventFeedbackGet",
				{ path: { rootEventId, feedbackId } },
			);
			await this.#assertSubject(subject);
			const resolution = sanitizeResolution(response.data);
			await this.#cacheResolution(
				subject,
				accountUserId,
				rootEventId,
				resolution,
				feedbackId,
			);
			return resolution;
		});
	}

	async setVote(
		rootEventId: string,
		feedbackId: string,
		present: boolean,
		idempotencyKey?: string,
	): Promise<CommunityFeedbackResolution> {
		validateFeedbackId(feedbackId);
		return this.#runForRoot(rootEventId, (subject, accountUserId) =>
			this.#writeResolution(
				subject,
				accountUserId,
				rootEventId,
				feedbackId,
				() =>
					this.client.requestAsUser(subject, "eventFeedbackVotesSet", {
						path: { rootEventId, feedbackId },
						body: { present },
						...idempotencyHeader(idempotencyKey),
					}),
			),
		);
	}

	async addComment(
		rootEventId: string,
		feedbackId: string,
		comment: CommunityFeedbackCommentInput,
		idempotencyKey?: string,
	): Promise<CommunityFeedbackResolution> {
		validateFeedbackId(feedbackId);
		return this.#runForRoot(rootEventId, (subject, accountUserId) =>
			this.#writeResolution(
				subject,
				accountUserId,
				rootEventId,
				feedbackId,
				() =>
					this.client.requestAsUser(subject, "eventFeedbackCommentsCreate", {
						path: { rootEventId, feedbackId },
						body: comment,
						...idempotencyHeader(idempotencyKey),
					}),
			),
		);
	}

	async setFollowed(
		rootEventId: string,
		feedbackId: string,
		followed: boolean,
		idempotencyKey?: string,
	): Promise<CommunityFeedbackFollow> {
		validateFeedbackId(feedbackId);
		return this.#runForRoot(rootEventId, async (subject, accountUserId) => {
			const response = await this.client.requestAsUser(
				subject,
				"eventFeedbackFollowsSet",
				{
					path: { rootEventId, feedbackId },
					body: { followed },
					...idempotencyHeader(idempotencyKey),
				},
			);
			await this.#assertSubject(subject);
			const follow = sanitizeFollow(response.data);
			const canonicalResponse = await this.client.requestAsUser(
				subject,
				"eventFeedbackGet",
				{
					path: { rootEventId, feedbackId: follow.feedbackId },
				},
			);
			await this.#assertSubject(subject);
			const canonical = sanitizeResolution(canonicalResponse.data);
			await this.#cacheResolution(
				subject,
				accountUserId,
				rootEventId,
				canonical,
				feedbackId,
			);
			return follow;
		});
	}

	async list(
		rootEventId: string,
		filter: CommunityFeedbackFilter = {},
	): Promise<readonly CommunityFeedbackSummary[]> {
		return this.#readForRoot(rootEventId, async (subject, accountUserId) => {
			await this.#assertSubject(subject);
			const rows = await this.database.all<CachedFeedbackRow>(
				`SELECT summary_json, followed FROM community_feedback_cache
WHERE account_user_id = ? AND root_event_id = ?
ORDER BY updated_at DESC, feedback_id DESC
LIMIT 200`,
				[accountUserId, rootEventId],
			);
			await this.#assertSubject(subject);
			const statuses = filter.statuses ? new Set(filter.statuses) : null;
			const query = filter.query?.trim().toLocaleLowerCase() ?? "";
			return rows
				.map((row) => cachedSummary(row))
				.filter((feedback) => !statuses || statuses.has(feedback.status))
				.filter((feedback) => !filter.followedOnly || feedback.followed)
				.filter(
					(feedback) =>
						!query ||
						feedback.title.toLocaleLowerCase().includes(query) ||
						feedback.body.toLocaleLowerCase().includes(query),
				);
		});
	}

	async getCached(
		rootEventId: string,
		feedbackId: string,
	): Promise<CommunityFeedback | null> {
		validateFeedbackId(feedbackId);
		return this.#readForRoot(rootEventId, async (subject, accountUserId) => {
			await this.#assertSubject(subject);
			const row = await this.database.first<CachedDetailRow>(
				`SELECT summary_json, detail_json, followed
FROM community_feedback_cache
WHERE account_user_id = ? AND root_event_id = ? AND feedback_id = ?`,
				[accountUserId, rootEventId, feedbackId],
			);
			await this.#assertSubject(subject);
			if (!row?.detail_json) return null;
			const detail = sanitizeDetail(
				JSON.parse(row.detail_json) as CommunityFeedback,
			);
			const summary = cachedSummary(row);
			return { ...detail, ...summary };
		});
	}

	async changelog(
		rootEventId: string,
	): Promise<readonly CommunityFeedbackUpdate[]> {
		return this.#readForRoot(rootEventId, async (subject, accountUserId) => {
			await this.#assertSubject(subject);
			const rows = await this.database.all<CachedUpdateRow>(
				`SELECT payload_json FROM community_feedback_updates
WHERE account_user_id = ? AND root_event_id = ?
ORDER BY changed_at DESC, feedback_id DESC, version DESC
LIMIT 200`,
				[accountUserId, rootEventId],
			);
			await this.#assertSubject(subject);
			return rows.map((row) =>
				sanitizeUpdate(JSON.parse(row.payload_json) as CommunityFeedbackUpdate),
			);
		});
	}

	async #writeResolution(
		subject: GatewaySessionSubject,
		accountUserId: string,
		rootEventId: string,
		feedbackId: string,
		request: () => Promise<{ data: CommunityFeedbackResolution }>,
	): Promise<CommunityFeedbackResolution> {
		const response = await request();
		await this.#assertSubject(subject);
		const resolution = sanitizeResolution(response.data);
		await this.#cacheResolution(
			subject,
			accountUserId,
			rootEventId,
			resolution,
			feedbackId,
		);
		return resolution;
	}

	async #cacheResolution(
		subject: GatewaySessionSubject,
		accountUserId: string,
		rootEventId: string,
		resolution: CommunityFeedbackResolution,
		requestedFeedbackId: string,
	): Promise<void> {
		await this.#transaction(
			subject,
			accountUserId,
			rootEventId,
			async (transaction) => {
				if (resolution.feedback.id !== requestedFeedbackId) {
					await deleteCachedFeedback(
						transaction,
						accountUserId,
						rootEventId,
						requestedFeedbackId,
					);
				}
				if (
					resolution.redirectedFromFeedbackId &&
					resolution.redirectedFromFeedbackId !== requestedFeedbackId
				) {
					await deleteCachedFeedback(
						transaction,
						accountUserId,
						rootEventId,
						resolution.redirectedFromFeedbackId,
					);
				}
				await cacheDetail(
					transaction,
					accountUserId,
					rootEventId,
					resolution.feedback,
					this.#timestamp(),
				);
			},
		);
	}

	async #runForRoot<Result>(
		rootEventId: string,
		work: (
			subject: GatewaySessionSubject,
			accountUserId: string,
		) => Promise<Result>,
	): Promise<Result> {
		const subject = await this.#subject(rootEventId);
		return this.#serialize(subject.userId, rootEventId, async () => {
			try {
				await this.#assertSubject(subject);
				const result = await work(subject, subject.userId);
				await this.#assertSubject(subject);
				return result;
			} catch (error) {
				this.#rethrow(error);
			}
		});
	}

	async #readForRoot<Result>(
		rootEventId: string,
		work: (
			subject: GatewaySessionSubject,
			accountUserId: string,
		) => Promise<Result>,
	): Promise<Result> {
		const subject = await this.#subject(rootEventId);
		try {
			return await this.#databaseLock(subject.userId, rootEventId, async () => {
				await this.#assertSubject(subject);
				const result = await work(subject, subject.userId);
				await this.#assertSubject(subject);
				return result;
			});
		} catch (error) {
			this.#rethrow(error);
		}
	}

	async #subject(rootEventId: string): Promise<GatewaySessionSubject> {
		validateRoot(rootEventId);
		const subject = await this.client.sessionSubject();
		if (!subject) {
			throw new Error("Community feedback requires an account");
		}
		if (!accountPattern.test(subject.userId)) {
			throw new Error("Invalid community feedback account ID");
		}
		return subject;
	}

	#rethrow(error: unknown): never {
		if (
			error instanceof GatewayClientError &&
			(error.code === "session_changed" || error.code === "unauthenticated")
		) {
			throw new CommunityFeedbackAccountChangedError();
		}
		throw error;
	}

	async #assertSubject(subject: GatewaySessionSubject): Promise<void> {
		await this.client.assertSessionSubject(subject);
	}

	async #transaction<Result>(
		subject: GatewaySessionSubject,
		accountUserId: string,
		rootEventId: string,
		work: (transaction: SqlExecutor) => Promise<Result>,
	): Promise<Result> {
		return this.#databaseLock(accountUserId, rootEventId, async () => {
			await this.#assertSubject(subject);
			const result = await this.database.transaction(async (transaction) => {
				await this.#assertSubject(subject);
				const value = await work(transaction);
				await this.#assertSubject(subject);
				return value;
			});
			await this.#assertSubject(subject);
			return result;
		});
	}

	async #serialize<Result>(
		accountUserId: string,
		rootEventId: string,
		work: () => Promise<Result>,
	): Promise<Result> {
		const key = `${accountUserId}\u0000${rootEventId}`;
		return this.#lock(this.#queues, key, work);
	}

	async #databaseLock<Result>(
		accountUserId: string,
		rootEventId: string,
		work: () => Promise<Result>,
	): Promise<Result> {
		const key = `${accountUserId}\u0000${rootEventId}`;
		return this.#lock(this.#databaseQueues, key, work);
	}

	async #lock<Result>(
		queues: Map<string, Promise<void>>,
		key: string,
		work: () => Promise<Result>,
	): Promise<Result> {
		const previous = queues.get(key) ?? Promise.resolve();
		let release = () => {};
		const lock = new Promise<void>((resolve) => {
			release = resolve;
		});
		const tail = previous.then(
			() => lock,
			() => lock,
		);
		queues.set(key, tail);
		await previous.catch(() => {});
		try {
			return await work();
		} finally {
			release();
			if (queues.get(key) === tail) queues.delete(key);
		}
	}

	#timestamp() {
		return this.#now().toISOString();
	}
}

async function cacheSummary(
	executor: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
	feedback: CommunityFeedbackSummary,
	refreshedAt: string,
) {
	const safe = sanitizeSummary(feedback);
	await executor.run(
		`INSERT INTO community_feedback_cache (
  account_user_id, root_event_id, feedback_id, status, version, followed,
  updated_at, summary_json, detail_json, refreshed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
ON CONFLICT (account_user_id, root_event_id, feedback_id) DO UPDATE SET
  status = excluded.status,
  version = excluded.version,
  followed = excluded.followed,
  updated_at = excluded.updated_at,
  summary_json = excluded.summary_json,
  detail_json = CASE
    WHEN community_feedback_cache.version = excluded.version
      THEN community_feedback_cache.detail_json
    ELSE NULL
  END,
  refreshed_at = excluded.refreshed_at`,
		[
			accountUserId,
			rootEventId,
			safe.id,
			safe.status,
			safe.version,
			safe.followed ? 1 : 0,
			safe.updatedAt,
			JSON.stringify(safe),
			refreshedAt,
		],
	);
}

async function reconcileCompleteFeedbackPage(
	executor: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
	query: CommunityFeedbackPageQuery,
	page: CommunityFeedbackPage,
) {
	if (query.cursor !== undefined || page.pageInfo.hasMore) return;
	const parameters: string[] = [accountUserId, rootEventId];
	const statusClause = query.status ? " AND status = ?" : "";
	if (query.status) parameters.push(query.status);
	if (query.followedOnly) {
		await executor.run(
			`UPDATE community_feedback_cache SET followed = 0
WHERE account_user_id = ? AND root_event_id = ?${statusClause}`,
			parameters,
		);
		return;
	}
	const visible = new Set(page.items.map(({ id }) => id));
	const rows = await executor.all<{ feedback_id: string }>(
		`SELECT feedback_id FROM community_feedback_cache
WHERE account_user_id = ? AND root_event_id = ?${statusClause}`,
		parameters,
	);
	for (const row of rows) {
		if (!visible.has(row.feedback_id)) {
			await deleteCachedFeedback(
				executor,
				accountUserId,
				rootEventId,
				row.feedback_id,
			);
		}
	}
}

async function cacheDetail(
	executor: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
	feedback: CommunityFeedback,
	refreshedAt: string,
) {
	const safe = sanitizeDetail(feedback);
	const summary = sanitizeSummary(safe);
	await executor.run(
		`INSERT INTO community_feedback_cache (
  account_user_id, root_event_id, feedback_id, status, version, followed,
  updated_at, summary_json, detail_json, refreshed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, root_event_id, feedback_id) DO UPDATE SET
  status = excluded.status,
  version = excluded.version,
  followed = excluded.followed,
  updated_at = excluded.updated_at,
  summary_json = excluded.summary_json,
  detail_json = excluded.detail_json,
  refreshed_at = excluded.refreshed_at`,
		[
			accountUserId,
			rootEventId,
			safe.id,
			safe.status,
			safe.version,
			safe.followed ? 1 : 0,
			safe.updatedAt,
			JSON.stringify(summary),
			JSON.stringify(safe),
			refreshedAt,
		],
	);
}

async function cacheUpdate(
	executor: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
	update: CommunityFeedbackUpdate,
	refreshedAt: string,
) {
	const safe = sanitizeUpdate(update);
	await executor.run(
		`INSERT INTO community_feedback_updates (
  account_user_id, root_event_id, feedback_id, version, changed_at,
  payload_json, refreshed_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, root_event_id, feedback_id, version) DO UPDATE SET
  changed_at = excluded.changed_at,
  payload_json = excluded.payload_json,
  refreshed_at = excluded.refreshed_at`,
		[
			accountUserId,
			rootEventId,
			safe.feedbackId,
			safe.version,
			safe.changedAt,
			JSON.stringify(safe),
			refreshedAt,
		],
	);
}

async function reconcileCompleteUpdatePage(
	executor: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
	query: CommunityFeedbackUpdatePageQuery,
	page: CommunityFeedbackUpdatePage,
) {
	if (
		query.cursor !== undefined ||
		query.followedOnly ||
		page.pageInfo.hasMore
	) {
		return;
	}
	const visible = new Set(
		page.items.map(({ feedbackId, version }) => `${feedbackId}:${version}`),
	);
	const rows = await executor.all<{
		feedback_id: string;
		version: number;
	}>(
		`SELECT feedback_id, version FROM community_feedback_updates
WHERE account_user_id = ? AND root_event_id = ?`,
		[accountUserId, rootEventId],
	);
	for (const row of rows) {
		if (!visible.has(`${row.feedback_id}:${row.version}`)) {
			await executor.run(
				`DELETE FROM community_feedback_updates
WHERE account_user_id = ? AND root_event_id = ?
  AND feedback_id = ? AND version = ?`,
				[accountUserId, rootEventId, row.feedback_id, row.version],
			);
		}
	}
}

async function deleteCachedFeedback(
	executor: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
	feedbackId: string,
) {
	await executor.run(
		`DELETE FROM community_feedback_cache
WHERE account_user_id = ? AND root_event_id = ? AND feedback_id = ?`,
		[accountUserId, rootEventId, feedbackId],
	);
}

function cachedSummary(row: CachedFeedbackRow): CommunityFeedbackSummary {
	const summary = sanitizeSummary(
		JSON.parse(row.summary_json) as CommunityFeedbackSummary,
	);
	return { ...summary, followed: row.followed === 1 };
}

function sanitizeFeedbackPage(
	page: CommunityFeedbackPage,
): CommunityFeedbackPage {
	return {
		items: page.items.map(sanitizeSummary),
		pageInfo: {
			hasMore: page.pageInfo.hasMore,
			nextCursor: page.pageInfo.nextCursor,
		},
	};
}

function sanitizeUpdatePage(
	page: CommunityFeedbackUpdatePage,
): CommunityFeedbackUpdatePage {
	return {
		items: page.items.map(sanitizeUpdate),
		pageInfo: {
			hasMore: page.pageInfo.hasMore,
			nextCursor: page.pageInfo.nextCursor,
		},
	};
}

function sanitizeResolution(
	resolution: CommunityFeedbackResolution,
): CommunityFeedbackResolution {
	return {
		feedback: sanitizeDetail(resolution.feedback),
		redirectedFromFeedbackId: resolution.redirectedFromFeedbackId,
	};
}

function sanitizeSummary(
	feedback: CommunityFeedbackSummary,
): CommunityFeedbackSummary {
	return {
		id: feedback.id,
		title: feedback.title,
		body: feedback.body,
		status: feedback.status,
		version: feedback.version,
		voteCount: feedback.voteCount,
		duplicateCount: feedback.duplicateCount,
		viewerHasVoted: feedback.viewerHasVoted,
		followed: feedback.followed,
		createdAt: feedback.createdAt,
		updatedAt: feedback.updatedAt,
	};
}

function sanitizeDetail(feedback: CommunityFeedback): CommunityFeedback {
	return {
		...sanitizeSummary(feedback),
		commentCount: feedback.commentCount,
		commentsHasMore: feedback.commentsHasMore,
		comments: feedback.comments.map((comment) => ({
			id: comment.id,
			body: comment.body,
			createdAt: comment.createdAt,
		})),
		statusHistory: feedback.statusHistory.map((change) => ({
			version: change.version,
			fromStatus: change.fromStatus,
			toStatus: change.toStatus,
			note: change.note,
			changedAt: change.changedAt,
		})),
		statusHistoryCount: feedback.statusHistoryCount,
		statusHistoryHasMore: feedback.statusHistoryHasMore,
	};
}

function sanitizeUpdate(
	update: CommunityFeedbackUpdate,
): CommunityFeedbackUpdate {
	return {
		feedbackId: update.feedbackId,
		title: update.title,
		version: update.version,
		fromStatus: update.fromStatus,
		toStatus: update.toStatus,
		note: update.note,
		changedAt: update.changedAt,
	};
}

function sanitizeFollow(
	follow: CommunityFeedbackFollow,
): CommunityFeedbackFollow {
	return { feedbackId: follow.feedbackId, followed: follow.followed };
}

function listQuery(
	query: CommunityFeedbackPageQuery,
): NonNullable<GatewayRequest<"eventFeedbackList">["query"]> {
	return {
		...(query.limit === undefined ? {} : { limit: query.limit }),
		...(query.cursor === undefined ? {} : { cursor: query.cursor }),
		...(query.status === undefined ? {} : { status: query.status }),
		...(query.followedOnly === undefined
			? {}
			: { followedOnly: query.followedOnly ? "true" : "false" }),
	};
}

function updateQuery(
	query: CommunityFeedbackUpdatePageQuery,
): NonNullable<GatewayRequest<"eventFeedbackUpdatesList">["query"]> {
	return {
		...(query.limit === undefined ? {} : { limit: query.limit }),
		...(query.cursor === undefined ? {} : { cursor: query.cursor }),
		...(query.followedOnly === undefined
			? {}
			: { followedOnly: query.followedOnly ? "true" : "false" }),
	};
}

function requestQuery<Query>(query: Query): { query: Query } | object {
	return Object.keys(query as object).length > 0 ? { query } : {};
}

function idempotencyHeader(idempotencyKey?: string) {
	return idempotencyKey
		? { headers: { "idempotency-key": idempotencyKey } }
		: {};
}

function queuesFor(database: SqlDatabase): CommunityFeedbackQueues {
	const existing = queuesByDatabase.get(database);
	if (existing) return existing;
	const queues = {
		remote: new Map<string, Promise<void>>(),
		database: new Map<string, Promise<void>>(),
	};
	queuesByDatabase.set(database, queues);
	return queues;
}

function validateRoot(rootEventId: string) {
	if (!rootPattern.test(rootEventId)) {
		throw new Error("Invalid root event ID");
	}
}

function validateFeedbackId(feedbackId: string) {
	if (!feedbackPattern.test(feedbackId)) {
		throw new Error("Invalid feedback ID");
	}
}
