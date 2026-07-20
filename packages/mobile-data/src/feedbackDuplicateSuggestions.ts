import {
	type GatewayClient,
	GatewayClientError,
	type GatewayResponseData,
	type GatewaySessionSubject,
} from "@crew/mobile-client";
import type { SqlDatabase, SqlExecutor } from "./database.ts";
import { sha256Hex } from "./sha256.ts";

export type FeedbackDuplicateSuggestion =
	GatewayResponseData<"eventFeedbackDuplicateSuggestionsList">["items"][number];

export interface FeedbackDuplicateSuggestionResult {
	items: readonly FeedbackDuplicateSuggestion[];
	refreshedAt: string | null;
	source: "cache" | "network";
}

export interface FeedbackDuplicateSuggestionOptions {
	activeAccountUserId(): string | null | Promise<string | null>;
	now?: () => Date;
	sha256?: (value: string) => Promise<string>;
}

type SuggestionClient = Pick<
	GatewayClient,
	"assertSessionSubject" | "requestAsUser" | "sessionSubject"
>;

interface SuggestionRow {
	feedback_id: string;
	refreshed_at: string;
	status: FeedbackDuplicateSuggestion["status"];
	title: string;
	vote_count: number;
}

const accountPattern = /^usr_[a-f0-9]{32}$/;
const rootPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const feedbackPattern = /^fbk_[A-Za-z0-9._:-]{1,96}$/;
const queryHashPattern = /^[a-f0-9]{64}$/;
const statuses = new Set<FeedbackDuplicateSuggestion["status"]>([
	"open",
	"planned",
	"in_progress",
	"completed",
	"declined",
]);

export class FeedbackDuplicateSuggestionAccountChangedError extends Error {
	constructor() {
		super("Active account changed during feedback duplicate search");
		this.name = "FeedbackDuplicateSuggestionAccountChangedError";
	}
}

export class FeedbackDuplicateSuggestionAccessDeniedError extends Error {
	constructor() {
		super("Feedback duplicate suggestions are unavailable");
		this.name = "FeedbackDuplicateSuggestionAccessDeniedError";
	}
}

export class FeedbackDuplicateSuggestionController {
	readonly #activeAccountUserId: FeedbackDuplicateSuggestionOptions["activeAccountUserId"];
	readonly #now: () => Date;
	readonly #sha256: (value: string) => Promise<string>;

	constructor(
		private readonly database: SqlDatabase,
		private readonly client: SuggestionClient | null,
		options: FeedbackDuplicateSuggestionOptions,
	) {
		this.#activeAccountUserId = options.activeAccountUserId;
		this.#now = options.now ?? (() => new Date());
		this.#sha256 = options.sha256 ?? sha256Hex;
	}

	async search(
		accountUserId: string,
		rootEventId: string,
		input: string,
		online: boolean,
		signal?: AbortSignal,
	): Promise<FeedbackDuplicateSuggestionResult> {
		const query = validateScopeAndQuery(accountUserId, rootEventId, input);
		if (!online || !this.client) {
			return this.cached(accountUserId, rootEventId, query);
		}
		try {
			return await this.#refresh(accountUserId, rootEventId, query, signal);
		} catch (error) {
			if (
				error instanceof FeedbackDuplicateSuggestionAccessDeniedError ||
				error instanceof FeedbackDuplicateSuggestionAccountChangedError ||
				signal?.aborted ||
				(error instanceof GatewayClientError && error.code === "aborted")
			) {
				throw error;
			}
			const cached = await this.cached(accountUserId, rootEventId, query);
			if (cached.items.length > 0) return cached;
			throw error;
		}
	}

	async cached(
		accountUserId: string,
		rootEventId: string,
		input: string,
	): Promise<FeedbackDuplicateSuggestionResult> {
		const query = validateScopeAndQuery(accountUserId, rootEventId, input);
		await this.#assertActive(accountUserId);
		const queryHash = await this.#queryHash(query);
		await this.#assertActive(accountUserId);
		const authorized = await this.database.first(
			`SELECT 1 FROM memberships
WHERE account_user_id = ? AND root_event_id = ?
  AND member_user_id = ? AND status = 'active'`,
			[accountUserId, rootEventId, accountUserId],
		);
		if (!authorized) {
			await this.clearRoot(accountUserId, rootEventId);
			return { items: [], refreshedAt: null, source: "cache" };
		}
		const rows = await this.database.all<SuggestionRow>(
			`SELECT feedback_id, title, status, vote_count, refreshed_at
FROM feedback_duplicate_suggestion_cache
WHERE account_user_id = ? AND root_event_id = ? AND query_hash = ?
ORDER BY rank`,
			[accountUserId, rootEventId, queryHash],
		);
		await this.#assertActive(accountUserId);
		return {
			items: rows.map(suggestionFromRow),
			refreshedAt: cachedRefreshedAt(rows),
			source: "cache",
		};
	}

	async clearRoot(accountUserId: string, rootEventId: string): Promise<void> {
		validateScope(accountUserId, rootEventId);
		await this.#assertActive(accountUserId);
		await this.database.run(
			`DELETE FROM feedback_duplicate_suggestion_cache
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
		await this.#assertActive(accountUserId);
	}

	async #refresh(
		accountUserId: string,
		rootEventId: string,
		query: string,
		signal?: AbortSignal,
	): Promise<FeedbackDuplicateSuggestionResult> {
		await this.#assertActive(accountUserId);
		const client = this.client;
		if (!client) throw new Error("Feedback duplicate client is unavailable");
		const subject = await this.#subject(client, accountUserId);
		try {
			const response = await client.requestAsUser(
				subject,
				"eventFeedbackDuplicateSuggestionsList",
				{
					path: { rootEventId },
					query: { limit: 5, q: query },
					...(signal ? { signal } : {}),
				},
			);
			await client.assertSessionSubject(subject);
			await this.#assertActive(accountUserId);
			const items = sanitizePage(response.data);
			const refreshedAt = isoTimestamp(this.#now());
			const queryHash = await this.#queryHash(query);
			await this.#cache(
				client,
				subject,
				accountUserId,
				rootEventId,
				queryHash,
				items,
				refreshedAt,
			);
			return { items, refreshedAt, source: "network" };
		} catch (error) {
			if (denied(error)) {
				await this.clearRoot(accountUserId, rootEventId);
				throw new FeedbackDuplicateSuggestionAccessDeniedError();
			}
			this.#rethrowAccountChange(error);
		}
	}

	async #cache(
		client: SuggestionClient,
		subject: GatewaySessionSubject,
		accountUserId: string,
		rootEventId: string,
		queryHash: string,
		items: readonly FeedbackDuplicateSuggestion[],
		refreshedAt: string,
	): Promise<void> {
		await this.database.transaction(async (transaction) => {
			await client.assertSessionSubject(subject);
			await this.#assertActive(accountUserId);
			await transaction.run(
				`DELETE FROM feedback_duplicate_suggestion_cache
WHERE account_user_id = ? AND root_event_id = ? AND query_hash = ?`,
				[accountUserId, rootEventId, queryHash],
			);
			const authorized = await transaction.first(
				`SELECT 1 FROM memberships
WHERE account_user_id = ? AND root_event_id = ?
  AND member_user_id = ? AND status = 'active'`,
				[accountUserId, rootEventId, accountUserId],
			);
			if (!authorized) {
				await transaction.run(
					`DELETE FROM feedback_duplicate_suggestion_cache
WHERE account_user_id = ? AND root_event_id = ?`,
					[accountUserId, rootEventId],
				);
				return;
			}
			for (const [rank, item] of items.entries()) {
				await insertSuggestion(
					transaction,
					accountUserId,
					rootEventId,
					queryHash,
					rank,
					item,
					refreshedAt,
				);
			}
			await evictOldQueries(transaction, accountUserId, rootEventId, queryHash);
			await client.assertSessionSubject(subject);
			await this.#assertActive(accountUserId);
		});
		await client.assertSessionSubject(subject);
		await this.#assertActive(accountUserId);
	}

	async #subject(
		client: SuggestionClient,
		accountUserId: string,
	): Promise<GatewaySessionSubject> {
		const subject = await client.sessionSubject();
		if (!subject || subject.userId !== accountUserId) {
			throw new FeedbackDuplicateSuggestionAccountChangedError();
		}
		return subject;
	}

	async #assertActive(accountUserId: string): Promise<void> {
		if ((await this.#activeAccountUserId()) !== accountUserId) {
			throw new FeedbackDuplicateSuggestionAccountChangedError();
		}
	}

	async #queryHash(query: string): Promise<string> {
		const result = await this.#sha256(query);
		if (!queryHashPattern.test(result)) {
			throw new Error("SHA-256 provider returned an invalid digest");
		}
		return result;
	}

	#rethrowAccountChange(error: unknown): never {
		if (
			error instanceof GatewayClientError &&
			(error.code === "session_changed" || error.code === "unauthenticated")
		) {
			throw new FeedbackDuplicateSuggestionAccountChangedError();
		}
		throw error;
	}
}

export function normalizeFeedbackDuplicateQuery(
	title: string,
	body: string,
): string | null {
	return normalizeQueryPart(title) ?? normalizeQueryPart(body);
}

function normalizeQueryPart(value: string): string | null {
	const tokens = value
		.normalize("NFKC")
		.toLowerCase()
		.match(/[\p{L}\p{M}\p{N}]+/gu);
	if (!tokens) return null;
	const unique: string[] = [];
	const seen = new Set<string>();
	for (const token of tokens) {
		if (seen.has(token)) continue;
		seen.add(token);
		unique.push(token);
		if (unique.length === 12) break;
	}
	let result = "";
	for (const character of unique.join(" ")) {
		if (result.length + character.length > 500) break;
		result += character;
	}
	return result.length >= 2 ? result : null;
}

function cachedRefreshedAt(rows: readonly SuggestionRow[]): string | null {
	if (rows.length === 0) return null;
	const refreshedAt = rows[0]?.refreshed_at;
	if (
		!refreshedAt ||
		rows.some((row) => row.refreshed_at !== refreshedAt) ||
		!isIsoTimestamp(refreshedAt)
	) {
		throw new Error("Invalid feedback duplicate suggestion cache timestamp");
	}
	return refreshedAt;
}

function isIsoTimestamp(value: string): boolean {
	try {
		return new Date(value).toISOString() === value;
	} catch {
		return false;
	}
}

function isoTimestamp(value: Date): string {
	try {
		return value.toISOString();
	} catch {
		throw new Error("Invalid feedback duplicate suggestion timestamp");
	}
}

function validateScopeAndQuery(
	accountUserId: string,
	rootEventId: string,
	input: string,
): string {
	validateScope(accountUserId, rootEventId);
	const query = normalizeFeedbackDuplicateQuery(input, "");
	if (!query) throw new TypeError("Invalid feedback duplicate query");
	return query;
}

function validateScope(accountUserId: string, rootEventId: string): void {
	if (!accountPattern.test(accountUserId) || !rootPattern.test(rootEventId)) {
		throw new TypeError("Invalid feedback duplicate suggestion scope");
	}
}

function sanitizePage(
	value: GatewayResponseData<"eventFeedbackDuplicateSuggestionsList">,
): readonly FeedbackDuplicateSuggestion[] {
	const record = asExactRecord(value, ["items", "pageInfo"]);
	if (!Array.isArray(record.items) || record.items.length > 5) {
		throw new Error("Invalid feedback duplicate suggestion page");
	}
	const pageInfo = asExactRecord(record.pageInfo, ["hasMore", "nextCursor"]);
	if (
		typeof pageInfo.hasMore !== "boolean" ||
		(pageInfo.nextCursor !== null && typeof pageInfo.nextCursor !== "string")
	) {
		throw new Error("Invalid feedback duplicate suggestion page info");
	}
	const seen = new Set<string>();
	return record.items.map((item) => {
		const suggestion = sanitizeSuggestion(item);
		if (seen.has(suggestion.id)) {
			throw new Error("Duplicate feedback suggestion ID");
		}
		seen.add(suggestion.id);
		return suggestion;
	});
}

function sanitizeSuggestion(value: unknown): FeedbackDuplicateSuggestion {
	const record = asExactRecord(value, ["id", "status", "title", "voteCount"]);
	if (
		typeof record.id !== "string" ||
		!feedbackPattern.test(record.id) ||
		typeof record.title !== "string" ||
		Array.from(record.title).length < 1 ||
		Array.from(record.title).length > 160 ||
		typeof record.status !== "string" ||
		!statuses.has(record.status as FeedbackDuplicateSuggestion["status"]) ||
		!Number.isSafeInteger(record.voteCount) ||
		(record.voteCount as number) < 0
	) {
		throw new Error("Invalid feedback duplicate suggestion");
	}
	return {
		id: record.id,
		status: record.status as FeedbackDuplicateSuggestion["status"],
		title: record.title,
		voteCount: record.voteCount as number,
	};
}

function suggestionFromRow(row: SuggestionRow): FeedbackDuplicateSuggestion {
	return sanitizeSuggestion({
		id: row.feedback_id,
		status: row.status,
		title: row.title,
		voteCount: Number(row.vote_count),
	});
}

async function insertSuggestion(
	executor: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
	queryHash: string,
	rank: number,
	item: FeedbackDuplicateSuggestion,
	refreshedAt: string,
): Promise<void> {
	await executor.run(
		`INSERT INTO feedback_duplicate_suggestion_cache (
  account_user_id, root_event_id, query_hash, feedback_id, rank,
  title, status, vote_count, refreshed_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			accountUserId,
			rootEventId,
			queryHash,
			item.id,
			rank,
			item.title,
			item.status,
			item.voteCount,
			refreshedAt,
		],
	);
}

async function evictOldQueries(
	executor: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
	currentQueryHash: string,
): Promise<void> {
	await executor.run(
		`DELETE FROM feedback_duplicate_suggestion_cache
WHERE account_user_id = ? AND root_event_id = ? AND query_hash IN (
  SELECT query_hash
  FROM feedback_duplicate_suggestion_cache
  WHERE account_user_id = ? AND root_event_id = ? AND query_hash <> ?
  GROUP BY query_hash
  ORDER BY MAX(refreshed_at) DESC, query_hash DESC
  LIMIT -1 OFFSET 19
)`,
		[accountUserId, rootEventId, accountUserId, rootEventId, currentQueryHash],
	);
}

function asExactRecord(
	value: unknown,
	keys: readonly string[],
): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Invalid feedback duplicate suggestion response");
	}
	const record = value as Record<string, unknown>;
	const actual = Object.keys(record).sort();
	const expected = [...keys].sort();
	if (
		actual.length !== expected.length ||
		actual.some((key, index) => key !== expected[index])
	) {
		throw new Error("Unexpected feedback duplicate suggestion field");
	}
	return record;
}

function denied(error: unknown): boolean {
	return (
		error instanceof GatewayClientError &&
		(error.status === 403 ||
			error.status === 404 ||
			error.code === "FORBIDDEN" ||
			error.code === "NOT_FOUND")
	);
}
