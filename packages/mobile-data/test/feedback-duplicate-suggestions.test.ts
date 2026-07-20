import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	GatewayClientError,
	type GatewaySessionSubject,
} from "@crew/mobile-client";
import {
	FeedbackDuplicateSuggestionAccessDeniedError,
	FeedbackDuplicateSuggestionAccountChangedError,
	FeedbackDuplicateSuggestionController,
	migrate,
	normalizeFeedbackDuplicateQuery,
	type SqlDatabase,
	type SqlExecutor,
	type SqlValue,
} from "../src/index.ts";

const accountA = "usr_0123456789abcdef0123456789abcdef";
const accountB = "usr_abcdefabcdefabcdefabcdefabcdefab";
const rootA = "evt_duplicate_root_a";
const rootB = "evt_duplicate_root_b";
const now = "2026-07-19T12:00:00.000Z";
const temporaryDirectories: string[] = [];

class BunDatabase implements SqlDatabase {
	readonly sqlite: Database;

	constructor(path: string) {
		this.sqlite = new Database(path, { create: true });
	}

	async exec(sql: string): Promise<void> {
		this.sqlite.exec(sql);
	}

	async run(sql: string, parameters: readonly SqlValue[] = []): Promise<void> {
		this.sqlite.query(sql).run(...parameters);
	}

	async all<Row>(
		sql: string,
		parameters: readonly SqlValue[] = [],
	): Promise<readonly Row[]> {
		return this.sqlite.query(sql).all(...parameters) as Row[];
	}

	async first<Row>(
		sql: string,
		parameters: readonly SqlValue[] = [],
	): Promise<Row | null> {
		return (this.sqlite.query(sql).get(...parameters) as Row | null) ?? null;
	}

	async transaction<Result>(
		work: (transaction: SqlExecutor) => Promise<Result>,
	): Promise<Result> {
		this.sqlite.exec("BEGIN IMMEDIATE");
		try {
			const result = await work(this);
			this.sqlite.exec("COMMIT");
			return result;
		} catch (error) {
			this.sqlite.exec("ROLLBACK");
			throw error;
		}
	}

	close(): void {
		this.sqlite.close();
	}
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("privacy-safe feedback duplicate suggestion cache", () => {
	test("stores only the generated sanitized projection under an account/root/query hash", async () => {
		const database = await databaseWithScopes();
		let activeAccount = accountA;
		let seenQuery = "";
		const controller = new FeedbackDuplicateSuggestionController(
			database,
			client(accountA, async (_subject, _operation, request) => {
				seenQuery = request.query.q;
				return response({
					items: [suggestion()],
					pageInfo: { hasMore: false, nextCursor: null },
				});
			}),
			{
				activeAccountUserId: () => activeAccount,
				now: () => new Date(now),
			},
		);

		const result = await controller.search(
			accountA,
			rootA,
			"ＣＨＥＣＫ check private-draft-token",
			true,
		);
		expect(seenQuery).toBe("check private draft token");
		expect(result).toEqual({
			items: [suggestion()],
			refreshedAt: now,
			source: "network",
		});
		const row = await database.first<Record<string, unknown>>(
			"SELECT * FROM feedback_duplicate_suggestion_cache",
		);
		expect(row).toMatchObject({
			account_user_id: accountA,
			root_event_id: rootA,
			feedback_id: suggestion().id,
			title: suggestion().title,
			status: suggestion().status,
			vote_count: suggestion().voteCount,
			refreshed_at: now,
		});
		expect(row?.query_hash).toMatch(/^[a-f0-9]{64}$/);
		expect(JSON.stringify(row)).not.toContain("private-draft-token");

		expect(
			await controller.cached(accountA, rootB, "check private draft token"),
		).toEqual({ items: [], refreshedAt: null, source: "cache" });
		await controller.search(accountA, rootB, "another duplicate query", true);
		expect(
			await database.first<{ count: number }>(
				`SELECT count(*) AS count
FROM feedback_duplicate_suggestion_cache WHERE account_user_id = ?`,
				[accountA],
			),
		).toEqual({ count: 2 });
		activeAccount = accountB;
		expect(
			await controller.cached(accountB, rootA, "check private draft token"),
		).toEqual({ items: [], refreshedAt: null, source: "cache" });
		await database.run(
			"DELETE FROM root_sync_state WHERE account_user_id = ?",
			[accountA],
		);
		expect(
			await database.first<{ count: number }>(
				`SELECT count(*) AS count
FROM feedback_duplicate_suggestion_cache WHERE account_user_id = ?`,
				[accountA],
			),
		).toEqual({ count: 0 });
		database.close();
	});

	test("uses cache offline only while local active membership still proves the exact scope", async () => {
		const database = await databaseWithScopes();
		const onlineController = controllerWith(
			database,
			accountA,
			suggestionPage(),
		);
		await onlineController.search(accountA, rootA, "check in", true);
		const offline = await onlineController.search(
			accountA,
			rootA,
			"check in",
			false,
		);
		expect(offline.source).toBe("cache");
		expect(offline.items).toEqual([suggestion()]);
		await database.run(
			`UPDATE feedback_duplicate_suggestion_cache
SET refreshed_at = 'not-a-timestamp'`,
		);
		await expect(
			onlineController.search(accountA, rootA, "check in", false),
		).rejects.toThrow("Invalid feedback duplicate suggestion cache timestamp");
		await database.run(
			`UPDATE feedback_duplicate_suggestion_cache SET refreshed_at = ?`,
			[now],
		);

		await database.run(
			`UPDATE memberships SET status = 'removed'
WHERE account_user_id = ? AND root_event_id = ? AND member_user_id = ?`,
			[accountA, rootA, accountA],
		);
		expect(
			await onlineController.search(accountA, rootA, "check in", false),
		).toEqual({ items: [], refreshedAt: null, source: "cache" });

		await database.run(
			"DELETE FROM root_sync_state WHERE account_user_id = ? AND root_event_id = ?",
			[accountA, rootA],
		);
		expect(
			await database.first<{ count: number }>(
				"SELECT count(*) AS count FROM feedback_duplicate_suggestion_cache",
			),
		).toEqual({ count: 0 });
		database.close();
	});

	test("purges concealed roots and rejects malformed or late account-bound responses", async () => {
		const database = await databaseWithScopes();
		await controllerWith(database, accountA, suggestionPage()).search(
			accountA,
			rootA,
			"check in",
			true,
		);
		const deniedController = new FeedbackDuplicateSuggestionController(
			database,
			client(accountA, async () => {
				throw new GatewayClientError({
					code: "NOT_FOUND",
					operationId: "eventFeedbackDuplicateSuggestionsList",
					requestId: "request-concealed",
					retryAfterSeconds: null,
					retryable: false,
					status: 404,
				});
			}),
			{ activeAccountUserId: () => accountA },
		);
		await expect(
			deniedController.search(accountA, rootA, "check in", true),
		).rejects.toBeInstanceOf(FeedbackDuplicateSuggestionAccessDeniedError);
		expect(
			await database.first<{ count: number }>(
				"SELECT count(*) AS count FROM feedback_duplicate_suggestion_cache",
			),
		).toEqual({ count: 0 });

		const malformed = controllerWith(database, accountA, {
			items: [{ ...suggestion(), authorUserId: "usr_secret" }],
			pageInfo: { hasMore: false, nextCursor: null },
		});
		await expect(
			malformed.search(accountA, rootA, "check in", true),
		).rejects.toThrow("Unexpected feedback duplicate suggestion field");

		let activeAccount = accountA;
		let release!: () => void;
		const delayed = new Promise<void>((resolve) => {
			release = resolve;
		});
		const pendingController = new FeedbackDuplicateSuggestionController(
			database,
			client(accountA, async () => {
				await delayed;
				return response(suggestionPage());
			}),
			{ activeAccountUserId: () => activeAccount },
		);
		const pending = pendingController.search(
			accountA,
			rootA,
			"late result",
			true,
		);
		activeAccount = accountB;
		release();
		await expect(pending).rejects.toBeInstanceOf(
			FeedbackDuplicateSuggestionAccountChangedError,
		);
		database.close();
	});

	test("normalizes long Unicode input to the same bounded twelve-token contract", () => {
		expect(
			normalizeFeedbackDuplicateQuery(
				"ＣＨＥＣＫ Check-in",
				"ÜBER über ١ ٢ ٣ four five six seven eight nine ten eleven twelve thirteen",
			),
		).toBe("check in");
		expect(
			normalizeFeedbackDuplicateQuery(
				"🎉",
				"ÜBER über ١ ٢ ٣ four five six seven eight nine ten eleven twelve thirteen",
			),
		).toBe("über ١ ٢ ٣ four five six seven eight nine ten eleven");
		const long = normalizeFeedbackDuplicateQuery("a".repeat(700), "tail");
		expect(long?.length).toBe(500);
		expect(normalizeFeedbackDuplicateQuery("🎉", "—")).toBeNull();
	});

	test("atomically keeps only the current and nineteen most recently refreshed queries per account/root", async () => {
		const database = await databaseWithScopes();
		let tick = 0;
		const controller = new FeedbackDuplicateSuggestionController(
			database,
			client(accountA, async () => response(suggestionPage())),
			{
				activeAccountUserId: () => accountA,
				now: () => new Date(Date.parse(now) + tick++ * 1_000),
			},
		);
		for (let index = 0; index < 25; index += 1) {
			await controller.search(
				accountA,
				rootA,
				`duplicate query ${index}`,
				true,
			);
		}

		expect(
			await database.first<{ count: number }>(
				`SELECT count(DISTINCT query_hash) AS count
FROM feedback_duplicate_suggestion_cache
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountA, rootA],
			),
		).toEqual({ count: 20 });
		expect(
			(await controller.cached(accountA, rootA, "duplicate query 24")).items,
		).toEqual([suggestion()]);
		expect(
			(await controller.cached(accountA, rootA, "duplicate query 0")).items,
		).toEqual([]);
		database.close();
	});
});

async function databaseWithScopes(): Promise<BunDatabase> {
	const database = new BunDatabase(temporaryDatabasePath());
	await migrate(database);
	await seedScope(database, accountA, rootA);
	await seedScope(database, accountA, rootB);
	await seedScope(database, accountB, rootA);
	return database;
}

async function seedScope(
	database: SqlDatabase,
	accountUserId: string,
	rootEventId: string,
): Promise<void> {
	await database.run(
		`INSERT INTO root_sync_state (
  account_user_id, root_event_id, pull_cursor, snapshot_id,
  snapshot_revision, authorization_scope_version, last_completed_sync_at
) VALUES (?, ?, NULL, NULL, NULL, '1', NULL)`,
		[accountUserId, rootEventId],
	);
	await database.run(
		`INSERT INTO memberships (
  account_user_id, root_event_id, member_user_id, role, status,
  version, created_at, updated_at
) VALUES (?, ?, ?, 'participant', 'active', 1, ?, ?)`,
		[accountUserId, rootEventId, accountUserId, now, now],
	);
}

function controllerWith(
	database: SqlDatabase,
	accountUserId: string,
	data: unknown,
): FeedbackDuplicateSuggestionController {
	return new FeedbackDuplicateSuggestionController(
		database,
		client(accountUserId, async () => response(data)),
		{
			activeAccountUserId: () => accountUserId,
			now: () => new Date(now),
		},
	);
}

function client(
	accountUserId: string,
	requestAsUser: (
		subject: GatewaySessionSubject,
		operation: "eventFeedbackDuplicateSuggestionsList",
		request: {
			path: { rootEventId: string };
			query: { limit: number; q: string };
			signal?: AbortSignal;
		},
	) => Promise<{ data: unknown; requestId: string; status: number }>,
): ConstructorParameters<typeof FeedbackDuplicateSuggestionController>[1] {
	const subject = Object.freeze({
		userId: accountUserId,
	}) as GatewaySessionSubject;
	return {
		assertSessionSubject: async (value: GatewaySessionSubject) => {
			if (value !== subject) throw new Error("Session subject changed");
		},
		requestAsUser,
		sessionSubject: async () => subject,
	} as unknown as ConstructorParameters<
		typeof FeedbackDuplicateSuggestionController
	>[1];
}

function suggestion() {
	return {
		id: "fbk_check_in",
		status: "open" as const,
		title: "Check-in verbessern",
		voteCount: 3,
	};
}

function suggestionPage() {
	return {
		items: [suggestion()],
		pageInfo: { hasMore: false, nextCursor: null },
	};
}

function response(data: unknown) {
	return { data, requestId: "request-test", status: 200 };
}

function temporaryDatabasePath(): string {
	const directory = mkdtempSync(join(tmpdir(), "crew-feedback-duplicates-"));
	temporaryDirectories.push(directory);
	return join(directory, "mobile.sqlite");
}
