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
	ActorEventRootIndexAccessDeniedError,
	ActorEventRootIndexAccountChangedError,
	type ActorEventRootIndexEntry,
	ActorEventRootIndexStore,
	MemberDirectoryStore,
	MobileDataStore,
	migrate,
	type SqlDatabase,
	type SqlExecutor,
	type SqlValue,
} from "../src/index.ts";

type RootPage = GatewayResponseData<"eventRootsList">;

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
const rootA = "evt_actor_root_a";
const rootB = "evt_actor_root_b";
const refreshedAt = "2026-07-19T12:00:00.000Z";

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

describe("actor event-root index", () => {
	test("persists paginated duplicate-title roots and selection across restart by root ID", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-actor-roots-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "mobile.sqlite");
		let database = new BunDatabase(path);
		await migrate(database);
		const calls: unknown[] = [];
		const store = new ActorEventRootIndexStore(
			database,
			clientFromPages(
				[
					page([root(rootA, "Weekend", { version: 1 })], "page-2"),
					page([
						root(rootB, "Weekend"),
						root(rootA, "Server rename", { version: 2 }),
						root("evt_archived", "Archived", { status: "archived" }),
						root("evt_removed", "Removed", {
							membershipStatus: "removed",
						}),
					]),
				],
				calls,
			),
			{ now: () => new Date(refreshedAt) },
		);

		expect(await store.refresh(accountA)).toEqual({
			accountUserId: accountA,
			schemaVersion: 1,
			cacheVersion: 1,
			refreshedAt,
		});
		expect(calls).toEqual([
			{ query: { includeArchived: "false", limit: 200 } },
			{ query: { cursor: "page-2", includeArchived: "false", limit: 200 } },
		]);
		expect(await store.list(accountA)).toEqual([
			activeRoot(rootA, "Server rename", { version: 2 }),
			activeRoot(rootB, "Weekend"),
		]);
		await store.select(accountA, rootB);
		expect(await store.list(accountB)).toEqual([]);
		database.close();

		database = new BunDatabase(path);
		await migrate(database);
		const reopened = new ActorEventRootIndexStore(database);
		expect(await reopened.getState(accountA)).toEqual({
			accountUserId: accountA,
			schemaVersion: 1,
			cacheVersion: 1,
			refreshedAt,
		});
		expect(await reopened.getSelection(accountA)).toEqual({
			accountUserId: accountA,
			rootEventId: rootB,
			selectedAt: refreshedAt,
		});
		expect(
			(await reopened.list(accountA)).map((item) => item.rootEventId),
		).toEqual([rootA, rootB]);
		database.close();
	});

	test("atomically removes absent roots with projections, directory and selection while preserving other scopes", async () => {
		const database = new BunDatabase();
		await migrate(database);
		for (const account of [accountA, accountB]) {
			await seedProjection(database, account, rootA);
		}
		await seedProjection(database, accountA, rootB);
		await new MemberDirectoryStore(database, directoryClient(accountA)).refresh(
			accountA,
			rootA,
		);

		const initialA = new ActorEventRootIndexStore(
			database,
			clientFromPages([page([root(rootA, "A"), root(rootB, "B")])]),
		);
		await initialA.refresh(accountA);
		await initialA.select(accountA, rootA);
		await new ActorEventRootIndexStore(
			database,
			clientFromPages([page([root(rootA, "Other account")])]),
		).refresh(accountB);

		const removed = new ActorEventRootIndexStore(
			database,
			clientFromPages([page([root(rootB, "B")])]),
		);
		expect(await removed.refresh(accountA)).toEqual(
			expect.objectContaining({ cacheVersion: 2 }),
		);
		expect(await removed.get(accountA, rootA)).toBeNull();
		expect(await removed.getSelection(accountA)).toBeNull();
		expect(
			await new MobileDataStore(database).getRootSyncState(accountA, rootA),
		).toBeNull();
		expect(
			await new MemberDirectoryStore(database).list(accountA, rootA),
		).toEqual([]);
		expect(
			await new MobileDataStore(database).getRootSyncState(accountA, rootB),
		).not.toBeNull();
		expect(await removed.get(accountB, rootA)).not.toBeNull();
		expect(
			await new MobileDataStore(database).getRootSyncState(accountB, rootA),
		).not.toBeNull();

		const reinvited = new ActorEventRootIndexStore(
			database,
			clientFromPages([page([root(rootA, "A again"), root(rootB, "B")])]),
		);
		await reinvited.refresh(accountA);
		expect(await reinvited.get(accountA, rootA)).toEqual(
			expect.objectContaining({ title: "A again" }),
		);
		expect(
			await new MobileDataStore(database).getRootSyncState(accountA, rootA),
		).toBeNull();
		expect(await reinvited.getSelection(accountA)).toBeNull();
		database.close();
	});

	test("retains the last complete cache on malformed, bounded or switched refreshes", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await new ActorEventRootIndexStore(
			database,
			clientFromPages([page([root(rootA, "Cached")])]),
		).refresh(accountA);

		const malformed = new ActorEventRootIndexStore(
			database,
			clientFromPages([
				page([root(rootB, "Partial")], "same"),
				page([], "same"),
			]),
		);
		await expect(malformed.refresh(accountA)).rejects.toThrow(
			"pagination is invalid",
		);
		expect(await malformed.list(accountA)).toEqual([
			activeRoot(rootA, "Cached"),
		]);

		let calls = 0;
		const bounded = new ActorEventRootIndexStore(database, {
			request: () => {
				calls += 1;
				return Promise.resolve(
					response(page([], `cursor-${calls.toString().padStart(2, "0")}`)),
				);
			},
		} as unknown as Pick<GatewayClient, "request">);
		await expect(bounded.refresh(accountA)).rejects.toThrow(
			"exceeds the local pagination limit",
		);
		expect(calls).toBe(50);
		expect(await bounded.list(accountA)).toEqual([activeRoot(rootA, "Cached")]);

		let activeAccount: string | null = accountA;
		let release!: (value: ReturnType<typeof response>) => void;
		const pending = new Promise<ReturnType<typeof response>>((resolve) => {
			release = resolve;
		});
		const switched = new ActorEventRootIndexStore(
			database,
			{ request: () => pending } as unknown as Pick<GatewayClient, "request">,
			{ activeAccountUserId: () => activeAccount },
		);
		const refresh = switched.refresh(accountA);
		await Promise.resolve();
		activeAccount = accountB;
		release(response(page([root(rootB, "Wrong account")])));
		await expect(refresh).rejects.toBeInstanceOf(
			ActorEventRootIndexAccountChangedError,
		);
		expect(await switched.list(accountA)).toEqual([
			activeRoot(rootA, "Cached"),
		]);
		database.close();
	});

	test("authoritative collection denial purges only the denied account and exposes no details", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedProjection(database, accountA, rootA);
		await seedProjection(database, accountB, rootB);
		for (const [account, item] of [
			[accountA, root(rootA, "Private A")],
			[accountB, root(rootB, "Private B")],
		] as const) {
			const index = new ActorEventRootIndexStore(
				database,
				clientFromPages([page([item])]),
			);
			await index.refresh(account);
			await index.select(account, item.rootEventId);
		}

		const denied = new ActorEventRootIndexStore(database, {
			request: () =>
				Promise.reject(
					new GatewayClientError({
						operationId: "eventRootsList",
						status: 404,
						requestId: "request-secret-index",
						code: "NOT_FOUND",
						retryable: false,
						retryAfterSeconds: null,
					}),
				),
		} as unknown as Pick<GatewayClient, "request">);
		let failure: unknown;
		try {
			await denied.refresh(accountA);
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(ActorEventRootIndexAccessDeniedError);
		const exposed = `${failure instanceof Error ? failure.message : failure}:${JSON.stringify(failure)}`;
		for (const secret of [rootA, "request-secret-index", "NOT_FOUND"]) {
			expect(exposed).not.toContain(secret);
		}
		expect(await denied.list(accountA)).toEqual([]);
		expect(await denied.getState(accountA)).toBeNull();
		expect(await denied.getSelection(accountA)).toBeNull();
		expect(
			await new MobileDataStore(database).getRootSyncState(accountA, rootA),
		).toBeNull();
		expect(await denied.list(accountB)).toEqual([
			activeRoot(rootB, "Private B"),
		]);
		expect(await denied.getSelection(accountB)).not.toBeNull();
		expect(
			await new MobileDataStore(database).getRootSyncState(accountB, rootB),
		).not.toBeNull();

		await new MobileDataStore(database).clearUserData(accountB);
		expect(await denied.list(accountB)).toEqual([]);
		expect(await denied.getSelection(accountB)).toBeNull();
		database.close();
	});
});

async function seedProjection(
	database: SqlDatabase,
	accountUserId: string,
	rootEventId: string,
) {
	const store = new MobileDataStore(database);
	await store.putRootSyncState({
		accountUserId,
		rootEventId,
		pullCursor: null,
		snapshotId: null,
		snapshotRevision: null,
		authorizationScopeVersion: "1",
		lastCompletedSyncAt: refreshedAt,
	});
	await store.putEvent({
		accountUserId,
		id: rootEventId,
		rootEventId,
		parentEventId: null,
		kind: "trip",
		title: `Projection ${rootEventId}`,
		description: null,
		timeZone: "Europe/Zurich",
		startsAt: "2026-09-20T08:00:00.000Z",
		endsAt: "2026-09-24T18:00:00.000Z",
		sortKey: "1",
		childOrderVersion: "1",
		itineraryOrderVersion: "1",
		status: "published",
		version: 1,
		createdAt: refreshedAt,
		updatedAt: refreshedAt,
		deletedAt: null,
	});
}

function root(
	rootEventId: string,
	title: string,
	overrides: Partial<RootPage["items"][number]> = {},
): RootPage["items"][number] {
	return {
		rootEventId,
		kind: "trip",
		title,
		timeZone: "Europe/Zurich",
		startsAt: "2026-09-20T08:00:00.000Z",
		endsAt: "2026-09-24T18:00:00.000Z",
		status: "published",
		version: 1,
		createdAt: refreshedAt,
		updatedAt: refreshedAt,
		role: "participant",
		membershipStatus: "active",
		...overrides,
	};
}

function activeRoot(
	rootEventId: string,
	title: string,
	overrides: Partial<ActorEventRootIndexEntry> = {},
): ActorEventRootIndexEntry {
	return {
		rootEventId,
		kind: "trip",
		title,
		timeZone: "Europe/Zurich",
		startsAt: "2026-09-20T08:00:00.000Z",
		endsAt: "2026-09-24T18:00:00.000Z",
		status: "published",
		version: 1,
		createdAt: refreshedAt,
		updatedAt: refreshedAt,
		role: "participant",
		membershipStatus: "active",
		...overrides,
	};
}

function page(
	items: RootPage["items"],
	nextCursor: string | null = null,
): RootPage {
	return {
		items,
		pageInfo: { hasMore: nextCursor !== null, nextCursor },
	};
}

function response(data: RootPage) {
	return { data, status: 200, requestId: "request-roots" };
}

function clientFromPages(pages: RootPage[], calls: unknown[] = []) {
	let index = 0;
	return {
		request: (operationId: string, request: unknown) => {
			if (operationId !== "eventRootsList") {
				throw new Error("Unexpected root-index operation");
			}
			calls.push(request);
			const data = pages[index++];
			if (!data) throw new Error("Unexpected root-index request");
			return Promise.resolve(response(data));
		},
	} as unknown as Pick<GatewayClient, "request">;
}

function directoryClient(userId: string) {
	return {
		request: () =>
			Promise.resolve({
				data: {
					items: [{ userId, displayName: "Private member" }],
					pageInfo: { hasMore: false, nextCursor: null },
				},
				status: 200,
				requestId: "request-directory",
			}),
	} as unknown as Pick<GatewayClient, "request">;
}

function userId(value: number) {
	return `usr_${value.toString(16).padStart(32, "0")}`;
}
