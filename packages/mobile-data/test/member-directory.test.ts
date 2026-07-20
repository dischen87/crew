import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type GatewayClient,
	GatewayClientError,
	type GatewayResponseData,
} from "@crew/mobile-client";
import {
	MemberDirectoryAccountChangedError,
	MemberDirectoryRootAccessDeniedError,
	MemberDirectoryStore,
	MobileDataStore,
	migrate,
	type SqlDatabase,
	type SqlExecutor,
	type SqlValue,
} from "../src/index.ts";

type DirectoryPage = GatewayResponseData<"eventMemberDirectoryGet">;

class BunDatabase implements SqlDatabase {
	readonly sqlite: Database;

	constructor(path = ":memory:") {
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

	close() {
		this.sqlite.close();
	}
}

const temporaryDirectories: string[] = [];
const accountA = userId(1);
const accountB = userId(2);
const memberC = userId(3);
const rootEventId = "evt_member_directory";
const refreshedAt = "2026-07-19T12:00:00.000Z";

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("sanitized member directory cache", () => {
	test("persists paginated names across restart and replaces removed or re-invited members per account", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-member-directory-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "mobile.sqlite");
		let database = new BunDatabase(path);
		await migrate(database);
		await seedRoot(database, accountA);
		await seedRoot(database, accountB);

		const firstCalls: unknown[] = [];
		const first = new MemberDirectoryStore(
			database,
			clientFromPages(
				[
					page(
						[
							{ userId: accountA, displayName: "Ada" },
							{ userId: accountB, displayName: null },
						],
						"directory-cursor-2",
					),
					page([{ userId: memberC, displayName: "Cara" }]),
				],
				firstCalls,
			),
			{ now: () => new Date(refreshedAt) },
		);
		expect(await first.refresh(accountA, rootEventId)).toEqual({
			accountUserId: accountA,
			rootEventId,
			cacheVersion: 1,
			refreshedAt,
		});
		expect(firstCalls).toEqual([
			{
				path: { rootEventId },
				query: { limit: 200 },
			},
			{
				path: { rootEventId },
				query: { cursor: "directory-cursor-2", limit: 200 },
			},
		]);
		expect(await first.list(accountA, rootEventId)).toEqual([
			{ userId: accountA, displayName: "Ada" },
			{ userId: accountB, displayName: null },
			{ userId: memberC, displayName: "Cara" },
		]);
		database.close();

		database = new BunDatabase(path);
		await migrate(database);
		const reopened = new MemberDirectoryStore(database);
		expect(await reopened.get(accountA, rootEventId, accountB)).toEqual({
			userId: accountB,
			displayName: null,
		});

		const forB = new MemberDirectoryStore(
			database,
			clientFromPages([page([{ userId: accountB, displayName: "Bert" }])]),
		);
		await forB.refresh(accountB, rootEventId);
		expect(await forB.list(accountB, rootEventId)).toEqual([
			{ userId: accountB, displayName: "Bert" },
		]);

		const removed = new MemberDirectoryStore(
			database,
			clientFromPages([page([{ userId: accountB, displayName: null }])]),
			{ now: () => new Date("2026-07-19T12:01:00.000Z") },
		);
		expect(await removed.refresh(accountA, rootEventId)).toEqual(
			expect.objectContaining({ cacheVersion: 2 }),
		);
		expect(await removed.list(accountA, rootEventId)).toEqual([
			{ userId: accountB, displayName: null },
		]);
		expect(await removed.list(accountB, rootEventId)).toEqual([
			{ userId: accountB, displayName: "Bert" },
		]);

		const reinvited = new MemberDirectoryStore(
			database,
			clientFromPages([
				page([
					{ userId: accountA, displayName: "Ada zurück" },
					{ userId: accountB, displayName: null },
				]),
			]),
		);
		expect(await reinvited.refresh(accountA, rootEventId)).toEqual(
			expect.objectContaining({ cacheVersion: 3 }),
		);
		expect(await reinvited.list(accountA, rootEventId)).toEqual([
			{ userId: accountA, displayName: "Ada zurück" },
			{ userId: accountB, displayName: null },
		]);

		await new MobileDataStore(database).clearUserData(accountA);
		expect(await reinvited.list(accountA, rootEventId)).toEqual([]);
		expect(await reinvited.list(accountB, rootEventId)).toEqual([
			{ userId: accountB, displayName: "Bert" },
		]);
		database.close();
	});

	test("retains the last complete cache on network or malformed pagination and purges it on root denial", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedRoot(database, accountA);
		const cached = new MemberDirectoryStore(
			database,
			clientFromPages([page([{ userId: accountA, displayName: "Ada" }])]),
		);
		await cached.refresh(accountA, rootEventId);

		const offline = new MemberDirectoryStore(
			database,
			clientThrowing(new Error("offline")),
		);
		await expect(offline.refresh(accountA, rootEventId)).rejects.toThrow(
			"offline",
		);
		expect(await offline.list(accountA, rootEventId)).toEqual([
			{ userId: accountA, displayName: "Ada" },
		]);

		const malformed = new MemberDirectoryStore(
			database,
			clientFromPages([
				page([{ userId: accountB, displayName: "Bert" }], "same-cursor"),
				page([{ userId: memberC, displayName: "Cara" }], "same-cursor"),
			]),
		);
		await expect(malformed.refresh(accountA, rootEventId)).rejects.toThrow(
			"pagination is invalid",
		);
		expect(await malformed.list(accountA, rootEventId)).toEqual([
			{ userId: accountA, displayName: "Ada" },
		]);

		const denied = new MemberDirectoryStore(
			database,
			clientThrowing(
				new GatewayClientError({
					operationId: "eventMemberDirectoryGet",
					status: 404,
					requestId: "request-denied",
					code: "NOT_FOUND",
					retryable: false,
					retryAfterSeconds: null,
				}),
			),
		);
		await expect(denied.refresh(accountA, rootEventId)).rejects.toBeInstanceOf(
			MemberDirectoryRootAccessDeniedError,
		);
		expect(await denied.list(accountA, rootEventId)).toEqual([]);
		expect(await denied.getState(accountA, rootEventId)).toBeNull();
		database.close();
	});

	test("does not write a completed response after an account switch and stores no private profile columns", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedRoot(database, accountA);
		let activeAccount: string | null = accountA;
		let release!: (value: ReturnType<typeof response>) => void;
		const pending = new Promise<ReturnType<typeof response>>((resolve) => {
			release = resolve;
		});
		const client = {
			request: () => pending,
		} as unknown as Pick<GatewayClient, "request">;
		const store = new MemberDirectoryStore(database, client, {
			activeAccountUserId: () => activeAccount,
		});
		const refresh = store.refresh(accountA, rootEventId);
		await Promise.resolve();
		activeAccount = accountB;
		release(response(page([{ userId: accountA, displayName: "Ada" }])));
		await expect(refresh).rejects.toBeInstanceOf(
			MemberDirectoryAccountChangedError,
		);
		expect(await store.list(accountA, rootEventId)).toEqual([]);

		const columns = await database.all<{ name: string }>(
			"PRAGMA table_info(member_directory_entries)",
		);
		expect(columns.map(({ name }) => name)).toEqual([
			"account_user_id",
			"root_event_id",
			"user_id",
			"display_name",
		]);
		database.close();
	});
});

async function seedRoot(database: SqlDatabase, accountUserId: string) {
	await new MobileDataStore(database).putRootSyncState({
		accountUserId,
		rootEventId,
		pullCursor: null,
		snapshotId: null,
		snapshotRevision: null,
		authorizationScopeVersion: "1",
		lastCompletedSyncAt: null,
	});
}

function page(
	items: DirectoryPage["items"],
	nextCursor: string | null = null,
): DirectoryPage {
	return {
		items,
		pageInfo: { hasMore: nextCursor !== null, nextCursor },
	};
}

function response(data: DirectoryPage) {
	return { data, status: 200, requestId: "request-directory" };
}

function clientFromPages(pages: DirectoryPage[], calls: unknown[] = []) {
	let index = 0;
	return {
		request: (_operationId: string, request: unknown) => {
			calls.push(request);
			const data = pages[index++];
			if (!data) throw new Error("Unexpected directory request");
			return Promise.resolve(response(data));
		},
	} as unknown as Pick<GatewayClient, "request">;
}

function clientThrowing(error: Error) {
	return {
		request: () => Promise.reject(error),
	} as unknown as Pick<GatewayClient, "request">;
}

function userId(value: number) {
	return `usr_${value.toString(16).padStart(32, "0")}`;
}
