import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	GatewayClient,
	type GatewaySessionSubject,
	type Session,
	type SessionStore,
} from "@crew/mobile-client";
import {
	type CommunityFeedback,
	CommunityFeedbackAccountChangedError,
	CommunityFeedbackController,
	CommunityFeedbackDuplicateTargetUnavailableError,
	CommunityFeedbackManagerUnavailableError,
	type CommunityFeedbackSummary,
	type CommunityFeedbackUpdate,
	MobileDataStore,
	migrate,
	type SqlDatabase,
	type SqlExecutor,
	type SqlValue,
} from "../src/index.ts";

const accountA = "usr_0123456789abcdef0123456789abcdef";
const accountB = "usr_abcdefabcdefabcdefabcdefabcdefab";
const rootA = "evt_community_root_a";
const rootB = "evt_community_root_b";
const canonicalId = "fbk_canonical";
const duplicateId = "fbk_duplicate";
const now = "2026-07-19T10:00:00.000Z";
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

	close() {
		this.sqlite.close();
	}
}

class DeferredDatabase extends BunDatabase {
	#runPattern: string | null = null;
	#releaseRun: (() => void) | undefined;
	#runStarted: (() => void) | undefined;
	#deferAll = false;
	#releaseAll: (() => void) | undefined;
	#allStarted: (() => void) | undefined;
	runStarted = Promise.resolve();
	allStarted = Promise.resolve();

	deferNextRun(pattern: string) {
		this.#runPattern = pattern;
		this.runStarted = new Promise<void>((resolve) => {
			this.#runStarted = resolve;
		});
	}

	releaseRun() {
		this.#releaseRun?.();
	}

	deferNextAll() {
		this.#deferAll = true;
		this.allStarted = new Promise<void>((resolve) => {
			this.#allStarted = resolve;
		});
	}

	releaseAll() {
		this.#releaseAll?.();
	}

	override async run(
		sql: string,
		parameters: readonly SqlValue[] = [],
	): Promise<void> {
		await super.run(sql, parameters);
		if (this.#runPattern && sql.includes(this.#runPattern)) {
			this.#runPattern = null;
			this.#runStarted?.();
			await new Promise<void>((resolve) => {
				this.#releaseRun = resolve;
			});
		}
	}

	override async all<Row>(
		sql: string,
		parameters: readonly SqlValue[] = [],
	): Promise<readonly Row[]> {
		const rows = await super.all<Row>(sql, parameters);
		if (this.#deferAll) {
			this.#deferAll = false;
			this.#allStarted?.();
			await new Promise<void>((resolve) => {
				this.#releaseAll = resolve;
			});
		}
		return rows;
	}
}

class MemorySessionStore implements SessionStore {
	constructor(public session: Session | null) {}

	async get() {
		return this.session;
	}

	async compareAndSet(expected: Session | null, replacement: Session | null) {
		if (this.session !== expected) return false;
		this.session = replacement;
		return true;
	}
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("root-scoped community feedback data controller", () => {
	test("passes opaque filters and cursors through while caching sanitized root projections and updates", async () => {
		const path = temporaryDatabasePath();
		const database = new BunDatabase(path);
		await migrate(database);
		await seedRootState(database, accountA, rootA);
		await seedRootState(database, accountA, rootB);
		await seedRootState(database, accountB, rootA);
		const sessionStore = new MemorySessionStore(session(accountA));
		const seenUrls: URL[] = [];
		const client = gatewayClient(async (input) => {
			const url = new URL(String(input));
			seenUrls.push(url);
			if (url.pathname.endsWith("/feedback/updates")) {
				return jsonResponse(200, {
					items: [update()],
					pageInfo: { hasMore: false, nextCursor: null },
				});
			}
			if (url.pathname.endsWith(`/feedback/${duplicateId}`)) {
				return jsonResponse(200, {
					feedback: detail(),
					redirectedFromFeedbackId: duplicateId,
				});
			}
			const rootEventId = url.pathname.split("/").at(-2);
			return jsonResponse(200, {
				items: [
					summary({
						title:
							rootEventId === rootB
								? "Other root title"
								: "Search needs filters",
					}),
				],
				pageInfo: { hasMore: true, nextCursor: "opaque-next-page-token" },
			});
		}, sessionStore);
		const controller = new CommunityFeedbackController(database, client, {
			now: () => new Date(now),
		});

		const page = await controller.refreshList(rootA, {
			limit: 1,
			cursor: "opaque-filter-bound-cursor",
			status: "planned",
			followedOnly: true,
		});
		expect(page.pageInfo).toEqual({
			hasMore: true,
			nextCursor: "opaque-next-page-token",
		});
		expect(seenUrls[0]?.searchParams.get("cursor")).toBe(
			"opaque-filter-bound-cursor",
		);
		expect(seenUrls[0]?.searchParams.get("status")).toBe("planned");
		expect(seenUrls[0]?.searchParams.get("followedOnly")).toBe("true");
		expect(seenUrls[0]?.searchParams.get("limit")).toBe("1");

		const updatePage = await controller.refreshUpdates(rootA, {
			cursor: "opaque-update-cursor",
			followedOnly: true,
		});
		expect(updatePage.items).toEqual([update()]);
		expect(seenUrls[1]?.searchParams.get("cursor")).toBe(
			"opaque-update-cursor",
		);
		expect(seenUrls[1]?.searchParams.get("followedOnly")).toBe("true");

		const resolution = await controller.refresh(rootA, duplicateId);
		expect(resolution.redirectedFromFeedbackId).toBe(duplicateId);
		expect(resolution.feedback.id).toBe(canonicalId);
		expect(await controller.getCached(rootA, canonicalId)).toEqual(detail());
		expect(await controller.getCached(rootA, duplicateId)).toBeNull();
		expect(
			await controller.list(rootA, {
				statuses: ["planned"],
				followedOnly: true,
				query: "search",
			}),
		).toEqual([summary()]);
		expect(await controller.changelog(rootA)).toEqual([update()]);

		await controller.refreshList(rootB);
		expect((await controller.list(rootB))[0]?.title).toBe("Other root title");
		expect((await controller.list(rootA))[0]?.title).toBe(
			"Search needs filters",
		);
		const serializedCache = JSON.stringify({
			feedback: await database.all(
				"SELECT summary_json, detail_json FROM community_feedback_cache",
			),
			updates: await database.all(
				"SELECT payload_json FROM community_feedback_updates",
			),
		});
		for (const forbidden of [
			"authorUserId",
			"changedBy",
			"diagnostics",
			"attachments",
			"rootEventId",
			"eventId",
			"sourceFeedbackId",
		]) {
			expect(serializedCache).not.toContain(forbidden);
		}

		database.close();
		const reopened = new BunDatabase(path);
		await migrate(reopened);
		const afterRestart = new CommunityFeedbackController(reopened, client);
		expect((await afterRestart.list(rootA))[0]).toEqual(summary());
		sessionStore.session = session(accountB);
		expect(await afterRestart.list(rootA)).toEqual([]);
		await afterRestart.refreshList(rootA);
		sessionStore.session = session(accountA);
		await new MobileDataStore(reopened).clearUserData(accountA);
		expect(await afterRestart.list(rootA)).toEqual([]);
		sessionStore.session = session(accountB);
		expect((await afterRestart.list(rootA))[0]?.id).toBe(canonicalId);
		reopened.close();
	});

	test("whitelists the sanitized detail shape at the local storage boundary", async () => {
		const database = new BunDatabase(temporaryDatabasePath());
		await migrate(database);
		await seedRootState(database, accountA, rootA);
		const subject = { userId: accountA } as GatewaySessionSubject;
		const permissiveClient = {
			sessionSubject: async () => subject,
			assertSessionSubject: async () => {},
			requestAsUser: async () => ({
				data: {
					feedback: unsafeDetail(),
					redirectedFromFeedbackId: null,
				},
			}),
		} as unknown as GatewayClient;
		const controller = new CommunityFeedbackController(
			database,
			permissiveClient,
		);

		const resolution = await controller.refresh(rootA, canonicalId);
		const serialized = JSON.stringify({
			resolution,
			cache: await database.all(
				"SELECT summary_json, detail_json FROM community_feedback_cache",
			),
		});
		for (const forbidden of [
			"private-actor",
			"private-device",
			"authorUserId",
			"changedBy",
			"diagnostics",
			"attachments",
			"rootEventId",
		]) {
			expect(serialized).not.toContain(forbidden);
		}
		database.close();
	});

	test("rechecks owner scope, sends caller-stable manager writes, and refreshes only sanitized canonical feedback", async () => {
		const database = new BunDatabase(temporaryDatabasePath());
		await migrate(database);
		await seedRootState(database, accountA, rootA);
		await seedSelfMembership(database, accountA, rootA, "owner");
		const seen: Array<{
			body: unknown;
			key: string | null;
			path: string;
		}> = [];
		let duplicateMarked = false;
		const client = gatewayClient(async (input, init) => {
			const path = new URL(String(input)).pathname;
			const body =
				typeof init?.body === "string" ? JSON.parse(init.body) : null;
			seen.push({
				body,
				key: new Headers(init?.headers).get("idempotency-key"),
				path,
			});
			if (path.endsWith(`/feedback/${duplicateId}/status`)) {
				return jsonResponse(200, { feedback: genericFeedback() });
			}
			if (path.endsWith(`/feedback/${duplicateId}/duplicate`)) {
				duplicateMarked = true;
				return jsonResponse(200, {
					feedback: genericFeedback({
						duplicateOfFeedbackId: canonicalId,
						status: "duplicate",
					}),
				});
			}
			if (path.endsWith(`/feedback/${duplicateId}`)) {
				return duplicateMarked
					? jsonResponse(200, {
							feedback: detail(),
							redirectedFromFeedbackId: duplicateId,
						})
					: jsonResponse(200, {
							feedback: detail({
								id: duplicateId,
								status: "in_progress",
								version: 3,
							}),
							redirectedFromFeedbackId: null,
						});
			}
			return jsonResponse(200, {
				items: [
					summary({ id: duplicateId, title: "Unklare Wegführung" }),
					summary(),
				],
				pageInfo: { hasMore: false, nextCursor: null },
			});
		});
		const controller = new CommunityFeedbackController(database, client);
		await controller.refreshList(rootA);

		await expect(controller.managerRole(rootA)).resolves.toBe("owner");
		await controller.setStatus(
			rootA,
			duplicateId,
			"in_progress",
			"  Wird geprüft.  ",
			"manager-status-stable-0001",
		);
		await controller.setStatus(
			rootA,
			duplicateId,
			"in_progress",
			"Wird geprüft.",
			"manager-status-stable-0001",
		);
		const merged = await controller.markDuplicate(
			rootA,
			duplicateId,
			canonicalId,
			"  Gleicher Bedarf. ",
			"manager-duplicate-stable-0001",
		);

		expect(merged).toEqual({
			kind: "refreshed",
			resolution: {
				feedback: detail(),
				redirectedFromFeedbackId: duplicateId,
			},
		});
		const statusWrites = seen.filter(({ path }) =>
			path.endsWith(`/feedback/${duplicateId}/status`),
		);
		expect(statusWrites).toHaveLength(2);
		expect(statusWrites.map(({ key }) => key)).toEqual([
			"manager-status-stable-0001",
			"manager-status-stable-0001",
		]);
		expect(statusWrites[0]?.body).toEqual({
			note: "Wird geprüft.",
			status: "in_progress",
		});
		expect(
			seen.find(({ path }) =>
				path.endsWith(`/feedback/${duplicateId}/duplicate`),
			),
		).toMatchObject({
			body: {
				canonicalFeedbackId: canonicalId,
				note: "Gleicher Bedarf.",
			},
			key: "manager-duplicate-stable-0001",
		});
		expect(await controller.getCached(rootA, duplicateId)).toBeNull();
		expect(await controller.getCached(rootA, canonicalId)).toEqual(detail());
		const serialized = JSON.stringify(
			await database.all(
				"SELECT summary_json, detail_json FROM community_feedback_cache",
			),
		);
		expect(serialized).not.toContain(accountB);
		expect(serialized).not.toContain("private-device");
		database.close();
	});

	test("persists a committed manager write and suppresses every later write until refresh", async () => {
		const database = new BunDatabase(temporaryDatabasePath());
		await migrate(database);
		await seedRootState(database, accountA, rootA);
		await seedSelfMembership(database, accountA, rootA, "owner");
		const requests: Array<{ operation: string; request: unknown }> = [];
		const subject = { userId: accountA } as GatewaySessionSubject;
		const client = {
			sessionSubject: async () => subject,
			assertSessionSubject: async () => {},
			requestAsUser: async (
				_subject: GatewaySessionSubject,
				operation: string,
				request: unknown,
			) => {
				requests.push({ operation, request });
				if (operation === "eventFeedbackList") {
					return {
						data: {
							items: [
								summary({ id: duplicateId }),
								summary({ id: canonicalId }),
							],
							pageInfo: { hasMore: false, nextCursor: null },
						},
					};
				}
				if (
					operation === "feedbackStatusSet" ||
					operation === "feedbackDuplicateMark"
				) {
					return { data: { feedback: genericFeedback() } };
				}
				throw new Error("private refresh failure detail");
			},
		} as unknown as GatewayClient;
		const controller = new CommunityFeedbackController(database, client);
		await controller.refreshList(rootA);

		await expect(
			controller.setStatus(
				rootA,
				duplicateId,
				"planned",
				null,
				"committed-status-0001",
			),
		).resolves.toEqual({ kind: "committed_refresh_failed" });
		await expect(
			controller.markDuplicate(
				rootA,
				duplicateId,
				canonicalId,
				null,
				"committed-duplicate-0001",
			),
		).resolves.toEqual({ kind: "committed_refresh_failed" });
		expect(
			requests.filter(({ operation }) => operation === "feedbackStatusSet"),
		).toHaveLength(1);
		expect(
			requests.filter(({ operation }) => operation === "feedbackDuplicateMark"),
		).toHaveLength(0);
		expect(
			requests.filter(({ operation }) => operation === "eventFeedbackGet"),
		).toHaveLength(1);
		expect(JSON.stringify(requests)).toContain("committed-status-0001");
		expect(JSON.stringify(requests)).not.toContain("committed-duplicate-0001");
		await expect(
			controller.managerWritePending(rootA, duplicateId),
		).resolves.toBe(true);
		expect(
			JSON.stringify([
				await controller.list(rootA),
				{ kind: "committed_refresh_failed" },
			]),
		).not.toContain("private refresh failure detail");
		database.close();
	});

	test("keeps a committed write locked until authoritative root denial purges its stale cache", async () => {
		const database = new BunDatabase(temporaryDatabasePath());
		await migrate(database);
		await seedRootState(database, accountA, rootA);
		await seedSelfMembership(database, accountA, rootA, "owner");
		let committed = false;
		const client = gatewayClient(async (input) => {
			const requestPath = new URL(String(input)).pathname;
			if (requestPath.endsWith(`/feedback/${duplicateId}/status`)) {
				committed = true;
				return jsonResponse(200, { feedback: genericFeedback() });
			}
			if (requestPath.endsWith(`/feedback/${duplicateId}`)) {
				if (committed) {
					return jsonResponse(404, {
						error: {
							code: "NOT_FOUND",
							message: "Safe test error",
							retryable: false,
						},
					});
				}
				return jsonResponse(200, {
					feedback: detail({ id: duplicateId }),
					redirectedFromFeedbackId: null,
				});
			}
			return jsonResponse(200, {
				items: [summary({ id: duplicateId })],
				pageInfo: { hasMore: false, nextCursor: null },
			});
		});
		const controller = new CommunityFeedbackController(database, client);
		await controller.refreshList(rootA);
		await controller.refresh(rootA, duplicateId);

		await expect(
			controller.setStatus(
				rootA,
				duplicateId,
				"completed",
				null,
				"revoked-manager-key-0001",
			),
		).resolves.toEqual({ kind: "committed_refresh_failed" });
		await expect(
			controller.managerWritePending(rootA, duplicateId),
		).resolves.toBe(true);
		await expect(
			controller.getCached(rootA, duplicateId),
		).resolves.toMatchObject({
			id: duplicateId,
			status: "planned",
		});

		await new MobileDataStore(database).clearRootData(accountA, rootA);
		await expect(controller.getCached(rootA, duplicateId)).resolves.toBeNull();
		await expect(
			controller.managerWritePending(rootA, duplicateId),
		).resolves.toBe(false);
		database.close();
	});

	test("returns the committed outcome without disk residue when a parallel root purge wins before refresh", async () => {
		const database = new BunDatabase(temporaryDatabasePath());
		await migrate(database);
		await seedRootState(database, accountA, rootA);
		await seedSelfMembership(database, accountA, rootA, "owner");
		let detailReads = 0;
		const client = gatewayClient(async (input) => {
			const requestPath = new URL(String(input)).pathname;
			if (requestPath.endsWith(`/feedback/${duplicateId}/status`)) {
				await new MobileDataStore(database).clearRootData(accountA, rootA);
				return jsonResponse(200, { feedback: genericFeedback() });
			}
			if (requestPath.endsWith(`/feedback/${duplicateId}`)) {
				detailReads += 1;
				return jsonResponse(200, {
					feedback: detail({ id: duplicateId }),
					redirectedFromFeedbackId: null,
				});
			}
			return jsonResponse(200, {
				items: [summary({ id: duplicateId })],
				pageInfo: { hasMore: false, nextCursor: null },
			});
		});
		const controller = new CommunityFeedbackController(database, client);
		await controller.refreshList(rootA);
		await controller.refresh(rootA, duplicateId);

		await expect(
			controller.setStatus(
				rootA,
				duplicateId,
				"planned",
				null,
				"parallel-purge-key-0001",
			),
		).resolves.toEqual({ kind: "committed_refresh_failed" });
		expect(detailReads).toBe(1);
		await expect(controller.getCached(rootA, duplicateId)).resolves.toBeNull();
		await expect(
			controller.managerWritePending(rootA, duplicateId),
		).resolves.toBe(false);
		database.close();
	});

	test("restores the manager refresh lock across reopen, isolates accounts and clears it only after an authoritative refresh", async () => {
		const path = temporaryDatabasePath();
		const database = new BunDatabase(path);
		await migrate(database);
		await seedRootState(database, accountA, rootA);
		await seedRootState(database, accountA, rootB);
		await seedRootState(database, accountB, rootA);
		await seedSelfMembership(database, accountA, rootA, "owner");
		await seedSelfMembership(database, accountA, rootB, "owner");
		await seedSelfMembership(database, accountB, rootA, "owner");
		const sessionStore = new MemorySessionStore(session(accountA));
		let refreshAvailable = false;
		const client = gatewayClient(async (input) => {
			const requestPath = new URL(String(input)).pathname;
			if (requestPath.endsWith(`/feedback/${duplicateId}/status`)) {
				return jsonResponse(200, { feedback: genericFeedback() });
			}
			if (requestPath.endsWith(`/feedback/${duplicateId}`)) {
				if (!refreshAvailable) throw new Error("private refresh failure");
				return jsonResponse(200, {
					feedback: detail({
						id: duplicateId,
						status: "planned",
						version: 2,
					}),
					redirectedFromFeedbackId: null,
				});
			}
			return jsonResponse(200, {
				items: [summary({ id: duplicateId })],
				pageInfo: { hasMore: false, nextCursor: null },
			});
		}, sessionStore);
		const controller = new CommunityFeedbackController(database, client);
		await controller.refreshList(rootA);

		await expect(
			controller.setStatus(
				rootA,
				duplicateId,
				"planned",
				"Jane jane@example.com",
				"durable-manager-key-0001",
			),
		).resolves.toEqual({ kind: "committed_refresh_failed" });
		const persisted = await database.first<Record<string, unknown>>(
			"SELECT * FROM community_feedback_manager_write_attempts",
		);
		expect(persisted).toMatchObject({
			account_user_id: accountA,
			feedback_id: duplicateId,
			idempotency_key: "durable-manager-key-0001",
			root_event_id: rootA,
			state: "committed_refresh_required",
		});
		expect(String(persisted?.signature_hash)).toMatch(/^[a-f0-9]{64}$/);
		expect(JSON.stringify(persisted)).not.toContain("Jane");
		expect(JSON.stringify(persisted)).not.toContain("jane@example.com");
		database.close();

		const reopened = new BunDatabase(path);
		await migrate(reopened);
		const reopenedController = new CommunityFeedbackController(
			reopened,
			client,
		);
		await expect(
			reopenedController.managerWritePending(rootA, duplicateId),
		).resolves.toBe(true);
		await expect(
			reopenedController.managerWritePending(rootB, duplicateId),
		).resolves.toBe(false);
		sessionStore.session = session(accountB);
		await expect(
			reopenedController.managerWritePending(rootA, duplicateId),
		).resolves.toBe(false);

		sessionStore.session = session(accountA);
		refreshAvailable = true;
		await expect(
			reopenedController.refresh(rootA, duplicateId),
		).resolves.toMatchObject({
			feedback: { id: duplicateId, status: "planned", version: 2 },
		});
		await expect(
			reopenedController.managerWritePending(rootA, duplicateId),
		).resolves.toBe(false);
		expect(
			await reopened.first<{ count: number }>(
				"SELECT count(*) AS count FROM community_feedback_manager_write_attempts",
			),
		).toEqual({ count: 0 });
		reopened.close();
	});

	test("reuses the durable idempotency key for an uncertain same-signature retry and blocks a different command", async () => {
		const database = new BunDatabase(temporaryDatabasePath());
		await migrate(database);
		await seedRootState(database, accountA, rootA);
		await seedSelfMembership(database, accountA, rootA, "owner");
		const seenKeys: Array<string | null> = [];
		let statusAttempt = 0;
		const client = gatewayClient(async (input, init) => {
			const requestPath = new URL(String(input)).pathname;
			if (requestPath.endsWith(`/feedback/${duplicateId}/status`)) {
				seenKeys.push(new Headers(init?.headers).get("idempotency-key"));
				statusAttempt += 1;
				if (statusAttempt === 1) throw new Error("response lost");
				return jsonResponse(200, { feedback: genericFeedback() });
			}
			if (requestPath.endsWith(`/feedback/${duplicateId}`)) {
				return jsonResponse(200, {
					feedback: detail({
						id: duplicateId,
						status: "planned",
						version: 2,
					}),
					redirectedFromFeedbackId: null,
				});
			}
			return jsonResponse(200, {
				items: [summary({ id: duplicateId })],
				pageInfo: { hasMore: false, nextCursor: null },
			});
		});
		const first = new CommunityFeedbackController(database, client);
		await first.refreshList(rootA);
		await expect(
			first.setStatus(
				rootA,
				duplicateId,
				"planned",
				"Stable note",
				"original-manager-key-0001",
			),
		).rejects.toThrow("Gateway request failed");

		const reopened = new CommunityFeedbackController(database, client);
		await expect(
			reopened.setStatus(
				rootA,
				duplicateId,
				"completed",
				"Different command",
				"different-manager-key-0001",
			),
		).resolves.toEqual({ kind: "committed_refresh_failed" });
		expect(seenKeys).toEqual(["original-manager-key-0001"]);
		await expect(
			reopened.setStatus(
				rootA,
				duplicateId,
				"planned",
				"Stable note",
				"new-caller-key-0001",
			),
		).resolves.toMatchObject({ kind: "refreshed" });
		expect(seenKeys).toEqual([
			"original-manager-key-0001",
			"original-manager-key-0001",
		]);
		await expect(
			reopened.managerWritePending(rootA, duplicateId),
		).resolves.toBe(false);
		database.close();
	});

	test("conceals manager actions from participants and rejects targets outside sanitized same-root projections", async () => {
		const database = new BunDatabase(temporaryDatabasePath());
		await migrate(database);
		await seedRootState(database, accountA, rootA);
		await seedSelfMembership(database, accountA, rootA, "participant");
		let genericWrites = 0;
		const client = gatewayClient(async (input) => {
			const path = new URL(String(input)).pathname;
			if (path.startsWith("/core/v1/feedback/")) genericWrites += 1;
			return jsonResponse(200, {
				items: [summary({ id: duplicateId })],
				pageInfo: { hasMore: false, nextCursor: null },
			});
		});
		const controller = new CommunityFeedbackController(database, client);
		await controller.refreshList(rootA);

		await expect(controller.managerRole(rootA)).resolves.toBeNull();
		await expect(
			controller.setStatus(
				rootA,
				duplicateId,
				"planned",
				null,
				"participant-status-0001",
			),
		).rejects.toBeInstanceOf(CommunityFeedbackManagerUnavailableError);
		await seedSelfMembership(database, accountA, rootA, "organizer", 2);
		await expect(
			controller.markDuplicate(
				rootA,
				duplicateId,
				"fbk_not_sanitized_target",
				null,
				"unsafe-target-0001",
			),
		).rejects.toBeInstanceOf(CommunityFeedbackDuplicateTargetUnavailableError);
		expect(genericWrites).toBe(0);
		database.close();
	});

	test("rejects account changes and reports a committed role-change refresh failure without caching it", async () => {
		for (const change of ["account", "role"] as const) {
			const database = new BunDatabase(temporaryDatabasePath());
			await migrate(database);
			await seedRootState(database, accountA, rootA);
			await seedSelfMembership(database, accountA, rootA, "owner");
			const sessionStore = new MemorySessionStore(session(accountA));
			let release: (() => void) | undefined;
			let started: (() => void) | undefined;
			const requestStarted = new Promise<void>((resolve) => {
				started = resolve;
			});
			const responseReleased = new Promise<void>((resolve) => {
				release = resolve;
			});
			const client = gatewayClient(async (input) => {
				const path = new URL(String(input)).pathname;
				if (path.endsWith(`/feedback/${duplicateId}/status`)) {
					started?.();
					await responseReleased;
					return jsonResponse(200, { feedback: genericFeedback() });
				}
				return jsonResponse(200, {
					items: [summary({ id: duplicateId })],
					pageInfo: { hasMore: false, nextCursor: null },
				});
			}, sessionStore);
			const controller = new CommunityFeedbackController(database, client);
			await controller.refreshList(rootA);
			const pending = controller.setStatus(
				rootA,
				duplicateId,
				"completed",
				null,
				`manager-${change}-0001`,
			);
			await requestStarted;
			if (change === "account") {
				sessionStore.session = session(accountB);
			} else {
				await seedSelfMembership(database, accountA, rootA, "participant", 2);
			}
			release?.();
			if (change === "account") {
				await expect(pending).rejects.toBeInstanceOf(
					CommunityFeedbackAccountChangedError,
				);
			} else {
				await expect(pending).resolves.toEqual({
					kind: "committed_refresh_failed",
				});
			}
			if (change === "account") sessionStore.session = session(accountA);
			expect(await controller.list(rootA)).toEqual([
				summary({ id: duplicateId }),
			]);
			database.close();
		}
	});

	test("uses server-authoritative follows, canonical redirects and caller-stable idempotency", async () => {
		const database = new BunDatabase(temporaryDatabasePath());
		await migrate(database);
		await seedRootState(database, accountA, rootA);
		const seen: Array<{ path: string; key: string | null }> = [];
		const client = gatewayClient(async (input, init) => {
			const path = new URL(String(input)).pathname;
			seen.push({
				path,
				key: new Headers(init?.headers).get("idempotency-key"),
			});
			if (path.endsWith("/follow")) {
				return jsonResponse(200, { feedbackId: canonicalId, followed: true });
			}
			return jsonResponse(path.endsWith("/comments") ? 201 : 200, {
				feedback: detail({ voteCount: 4, viewerHasVoted: true }),
				redirectedFromFeedbackId: duplicateId,
			});
		});
		const controller = new CommunityFeedbackController(database, client);

		await controller.setVote(rootA, duplicateId, true, "community-vote-0001");
		await controller.setVote(rootA, duplicateId, true, "community-vote-0001");
		const commented = await controller.addComment(
			rootA,
			duplicateId,
			{ id: "fbc_community_01", body: "Same context." },
			"community-comment-0001",
		);
		expect(commented.redirectedFromFeedbackId).toBe(duplicateId);
		const followed = await controller.setFollowed(
			rootA,
			duplicateId,
			true,
			"community-follow-0001",
		);
		expect(followed).toEqual({ feedbackId: canonicalId, followed: true });
		expect(seen.map(({ key }) => key)).toEqual([
			"community-vote-0001",
			"community-vote-0001",
			"community-comment-0001",
			"community-follow-0001",
			null,
		]);
		expect((await controller.list(rootA))[0]).toMatchObject({
			id: canonicalId,
			followed: true,
			voteCount: 4,
		});
		expect(
			await database.first<{ count: number }>(
				`SELECT count(*) AS count FROM community_feedback_cache
WHERE account_user_id = ? AND root_event_id = ? AND feedback_id = ?`,
				[accountA, rootA, duplicateId],
			),
		).toEqual({ count: 0 });
		database.close();
	});

	test("persists a cold-cache redirected follow under the canonical item across restart", async () => {
		const path = temporaryDatabasePath();
		const database = new BunDatabase(path);
		await migrate(database);
		await seedRootState(database, accountA, rootA);
		const seenPaths: string[] = [];
		const client = gatewayClient(async (input) => {
			const requestPath = new URL(String(input)).pathname;
			seenPaths.push(requestPath);
			return requestPath.endsWith("/follow")
				? jsonResponse(200, { feedbackId: canonicalId, followed: true })
				: jsonResponse(200, {
						feedback: detail({ followed: true }),
						redirectedFromFeedbackId: null,
					});
		});
		const controller = new CommunityFeedbackController(database, client);

		expect(
			await controller.setFollowed(
				rootA,
				duplicateId,
				true,
				"community-cold-follow-0001",
			),
		).toEqual({ feedbackId: canonicalId, followed: true });
		expect((await controller.list(rootA))[0]).toEqual(
			summary({ followed: true }),
		);
		expect(seenPaths).toEqual([
			`/core/v1/event-roots/${rootA}/feedback/${duplicateId}/follow`,
			`/core/v1/event-roots/${rootA}/feedback/${canonicalId}`,
		]);

		database.close();
		const reopened = new BunDatabase(path);
		await migrate(reopened);
		const afterRestart = new CommunityFeedbackController(reopened, client);
		expect((await afterRestart.list(rootA))[0]).toEqual(
			summary({ followed: true }),
		);
		reopened.close();
	});

	test("reconciles complete canonical pages and cascades cache with the root authorization state", async () => {
		const database = new BunDatabase(temporaryDatabasePath());
		await migrate(database);
		await seedRootState(database, accountA, rootA);
		let listRequest = 0;
		let updateRequest = 0;
		const client = gatewayClient(async (input) => {
			const url = new URL(String(input));
			if (url.pathname.endsWith("/feedback/updates")) {
				updateRequest += 1;
				return jsonResponse(200, {
					items:
						updateRequest === 1
							? [update(), update({ feedbackId: duplicateId, version: 1 })]
							: [update()],
					pageInfo: { hasMore: false, nextCursor: null },
				});
			}
			listRequest += 1;
			const canonical = summary({ followed: listRequest !== 3 });
			return jsonResponse(200, {
				items:
					listRequest === 1
						? [
								canonical,
								summary({
									id: duplicateId,
									title: "Former canonical item",
								}),
							]
						: [canonical],
				pageInfo: { hasMore: false, nextCursor: null },
			});
		});
		const controller = new CommunityFeedbackController(database, client);

		await controller.refreshList(rootA);
		await controller.refreshUpdates(rootA);
		expect(await controller.list(rootA)).toHaveLength(2);
		expect(await controller.changelog(rootA)).toHaveLength(2);

		await controller.refreshList(rootA, { followedOnly: true });
		expect(
			(await controller.list(rootA, { followedOnly: true })).map(
				({ id }) => id,
			),
		).toEqual([canonicalId]);
		expect(await controller.list(rootA)).toHaveLength(2);

		await controller.refreshList(rootA);
		await controller.refreshUpdates(rootA);
		expect(await controller.list(rootA)).toEqual([
			summary({ followed: false }),
		]);
		expect(await controller.changelog(rootA)).toEqual([update()]);

		await database.run(
			"DELETE FROM root_sync_state WHERE account_user_id = ? AND root_event_id = ?",
			[accountA, rootA],
		);
		for (const table of [
			"community_feedback_cache",
			"community_feedback_updates",
		]) {
			expect(
				await database.first<{ count: number }>(
					`SELECT count(*) AS count FROM ${table}`,
				),
			).toEqual({ count: 0 });
		}
		database.close();
	});

	test("serializes every root mutation response while offline reads stay immediate", async () => {
		const database = new BunDatabase(temporaryDatabasePath());
		await migrate(database);
		await seedRootState(database, accountA, rootA);
		let getRequest = 0;
		let releaseList: (() => void) | undefined;
		let listStarted: (() => void) | undefined;
		const deferredListStarted = new Promise<void>((resolve) => {
			listStarted = resolve;
		});
		const listReleased = new Promise<void>((resolve) => {
			releaseList = resolve;
		});
		const seenPaths: string[] = [];
		const client = gatewayClient(async (input) => {
			const requestPath = new URL(String(input)).pathname;
			seenPaths.push(requestPath);
			if (requestPath.endsWith("/feedback")) {
				listStarted?.();
				await listReleased;
				return jsonResponse(200, {
					items: [],
					pageInfo: { hasMore: false, nextCursor: null },
				});
			}
			if (requestPath.endsWith("/vote")) {
				return jsonResponse(200, {
					feedback: detail({ version: 3, voteCount: 4 }),
					redirectedFromFeedbackId: null,
				});
			}
			if (requestPath.endsWith("/comments")) {
				return jsonResponse(201, {
					feedback: detail({ version: 4, commentCount: 2 }),
					redirectedFromFeedbackId: null,
				});
			}
			if (requestPath.endsWith("/follow")) {
				return jsonResponse(200, { feedbackId: canonicalId, followed: true });
			}
			getRequest += 1;
			return jsonResponse(200, {
				feedback: detail({
					version: getRequest === 1 ? 1 : getRequest === 2 ? 2 : 5,
					followed: getRequest === 3,
					voteCount: getRequest === 3 ? 4 : 3,
				}),
				redirectedFromFeedbackId: null,
			});
		});
		const controller = new CommunityFeedbackController(database, client);
		await controller.refresh(rootA, canonicalId);

		const staleCompleteList = controller.refreshList(rootA);
		await deferredListStarted;
		const newerDetail = controller.refresh(rootA, canonicalId);
		const newerVote = controller.setVote(
			rootA,
			canonicalId,
			true,
			"community-race-vote-0001",
		);
		const newerComment = controller.addComment(
			rootA,
			canonicalId,
			{ id: "fbc_community_02", body: "Newer comment." },
			"community-race-comment-0001",
		);
		const newerFollow = controller.setFollowed(
			rootA,
			canonicalId,
			true,
			"community-race-follow-0001",
		);
		await Promise.resolve();
		await Promise.resolve();
		expect(seenPaths).toHaveLength(2);
		let offlineSettled = false;
		const observedOffline = controller.list(rootA).then(
			(value) => {
				offlineSettled = true;
				return { value } as const;
			},
			(error: unknown) => {
				offlineSettled = true;
				return { error } as const;
			},
		);
		await eventually(() => offlineSettled);
		const observed = await observedOffline;
		if ("error" in observed) throw observed.error;
		const offline = observed.value;
		expect(offline).toEqual([summary({ version: 1, followed: false })]);

		releaseList?.();
		await Promise.all([
			staleCompleteList,
			newerDetail,
			newerVote,
			newerComment,
			newerFollow,
		]);
		expect(seenPaths).toEqual([
			`/core/v1/event-roots/${rootA}/feedback/${canonicalId}`,
			`/core/v1/event-roots/${rootA}/feedback`,
			`/core/v1/event-roots/${rootA}/feedback/${canonicalId}`,
			`/core/v1/event-roots/${rootA}/feedback/${canonicalId}/vote`,
			`/core/v1/event-roots/${rootA}/feedback/${canonicalId}/comments`,
			`/core/v1/event-roots/${rootA}/feedback/${canonicalId}/follow`,
			`/core/v1/event-roots/${rootA}/feedback/${canonicalId}`,
		]);
		expect((await controller.list(rootA))[0]).toMatchObject({
			id: canonicalId,
			version: 5,
			voteCount: 4,
			followed: true,
		});
		database.close();
	});

	test("refuses to cache a response after an account switch", async () => {
		const database = new BunDatabase(temporaryDatabasePath());
		await migrate(database);
		await seedRootState(database, accountA, rootA);
		const sessionStore = new MemorySessionStore(session(accountA));
		let release: (() => void) | undefined;
		let started: (() => void) | undefined;
		const requestStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		const responseReleased = new Promise<void>((resolve) => {
			release = resolve;
		});
		const client = gatewayClient(async () => {
			started?.();
			await responseReleased;
			return jsonResponse(200, {
				feedback: detail({ voteCount: 4, viewerHasVoted: true }),
				redirectedFromFeedbackId: null,
			});
		}, sessionStore);
		const controller = new CommunityFeedbackController(database, client);

		const pending = controller.setVote(
			rootA,
			canonicalId,
			true,
			"community-vote-0002",
		);
		await requestStarted;
		sessionStore.session = session(accountB);
		release?.();
		await expect(pending).rejects.toBeInstanceOf(
			CommunityFeedbackAccountChangedError,
		);
		expect(
			await database.first<{ count: number }>(
				"SELECT count(*) AS count FROM community_feedback_cache",
			),
		).toEqual({ count: 0 });
		database.close();
	});

	test("rolls back a deferred cache write on switch, logout or same-user session replacement", async () => {
		for (const replacement of [
			session(accountB),
			null,
			session(accountA, {
				access: "access-same-user-relogin",
				refresh: "refresh-same-user-relogin",
			}),
		]) {
			const database = new DeferredDatabase(temporaryDatabasePath());
			await migrate(database);
			await seedRootState(database, accountA, rootA);
			const sessionStore = new MemorySessionStore(session(accountA));
			const client = gatewayClient(
				async () =>
					jsonResponse(200, {
						feedback: detail({ voteCount: 9, viewerHasVoted: true }),
						redirectedFromFeedbackId: null,
					}),
				sessionStore,
			);
			const controller = new CommunityFeedbackController(database, client);
			database.deferNextRun("INSERT INTO community_feedback_cache");

			const pending = controller.setVote(
				rootA,
				canonicalId,
				true,
				"community-deferred-write-0001",
			);
			await database.runStarted;
			sessionStore.session = replacement;
			database.releaseRun();
			await expect(pending).rejects.toBeInstanceOf(
				CommunityFeedbackAccountChangedError,
			);
			expect(
				await database.first<{ count: number }>(
					"SELECT count(*) AS count FROM community_feedback_cache",
				),
			).toEqual({ count: 0 });
			database.close();
		}
	});

	test("discards a deferred offline read when its exact session logs out", async () => {
		const database = new DeferredDatabase(temporaryDatabasePath());
		await migrate(database);
		await seedRootState(database, accountA, rootA);
		const sessionStore = new MemorySessionStore(session(accountA));
		const client = gatewayClient(
			async () =>
				jsonResponse(200, {
					feedback: detail(),
					redirectedFromFeedbackId: null,
				}),
			sessionStore,
		);
		const controller = new CommunityFeedbackController(database, client);
		await controller.refresh(rootA, canonicalId);
		database.deferNextAll();

		const pending = controller.list(rootA);
		await database.allStarted;
		sessionStore.session = null;
		database.releaseAll();
		await expect(pending).rejects.toBeInstanceOf(
			CommunityFeedbackAccountChangedError,
		);
		database.close();
	});

	test("never returns an uncommitted cache write through an immediate offline read", async () => {
		const database = new DeferredDatabase(temporaryDatabasePath());
		await migrate(database);
		await seedRootState(database, accountA, rootA);
		let responseVersion = 1;
		const client = gatewayClient(async () =>
			jsonResponse(200, {
				feedback: detail({ version: responseVersion }),
				redirectedFromFeedbackId: null,
			}),
		);
		const controller = new CommunityFeedbackController(database, client);
		await controller.refresh(rootA, canonicalId);
		responseVersion = 2;
		database.deferNextRun("INSERT INTO community_feedback_cache");

		const write = controller.setVote(
			rootA,
			canonicalId,
			true,
			"community-db-lock-vote-0001",
		);
		await database.runStarted;
		let readSettled = false;
		const read = controller.list(rootA).then((value) => {
			readSettled = true;
			return value;
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(readSettled).toBe(false);

		database.releaseRun();
		await write;
		expect((await read)[0]?.version).toBe(2);
		database.close();
	});
});

function temporaryDatabasePath() {
	const directory = mkdtempSync(join(tmpdir(), "crew-community-feedback-"));
	temporaryDirectories.push(directory);
	return join(directory, "mobile.sqlite");
}

async function seedRootState(
	database: SqlDatabase,
	accountUserId: string,
	rootEventId: string,
) {
	await database.run(
		`INSERT INTO root_sync_state (
  account_user_id, root_event_id, pull_cursor, snapshot_id,
  snapshot_revision, authorization_scope_version, last_completed_sync_at
) VALUES (?, ?, NULL, NULL, NULL, '1', NULL)`,
		[accountUserId, rootEventId],
	);
}

async function seedSelfMembership(
	database: SqlDatabase,
	accountUserId: string,
	rootEventId: string,
	role: "owner" | "organizer" | "participant" | "viewer",
	version = 1,
) {
	await new MobileDataStore(database).putMembership({
		accountUserId,
		rootEventId,
		memberUserId: accountUserId,
		role,
		status: "active",
		version,
		createdAt: now,
		updatedAt: now,
	});
}

function gatewayClient(
	fetchImplementation: (
		input: string | URL | Request,
		init?: RequestInit,
	) => Promise<Response>,
	sessionStore: MemorySessionStore = new MemorySessionStore(session()),
) {
	let requestNumber = 0;
	return new GatewayClient({
		baseUrl: "https://gateway.test",
		sessionStore,
		fetch: (async (input, init) => {
			const response = await fetchImplementation(input, init);
			const requestId = new Headers(init?.headers).get("x-request-id");
			const headers = new Headers(response.headers);
			if (requestId) headers.set("x-request-id", requestId);
			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers,
			});
		}) as typeof fetch,
		requestId: () => `request-${String(++requestNumber).padStart(8, "0")}`,
		idempotencyKey: () => "idempotency-auto-0001",
	});
}

function session(
	userId = accountA,
	tokens: { access: string; refresh: string } = {
		access: `access-${userId}`,
		refresh: `refresh-${userId}`,
	},
): Session {
	return {
		accessToken: tokens.access,
		refreshToken: tokens.refresh,
		tokenType: "Bearer",
		expiresInSeconds: 300,
		user: {
			id: userId,
			email: "crew@example.com",
			profile: {
				displayName: "Crew",
				avatarUrl: null,
				locale: "de-CH",
				timeZone: "Europe/Zurich",
				reduceMotion: false,
				eventReminders: true,
				productUpdates: false,
				version: 1,
				updatedAt: now,
			},
		},
	};
}

function summary(
	overrides: Partial<CommunityFeedbackSummary> = {},
): CommunityFeedbackSummary {
	return {
		id: canonicalId,
		title: "Search needs filters",
		body: "Let the community filter open feedback.",
		status: "planned",
		version: 2,
		voteCount: 3,
		duplicateCount: 1,
		viewerHasVoted: false,
		followed: true,
		createdAt: "2026-07-19T08:00:00.000Z",
		updatedAt: now,
		...overrides,
	};
}

function detail(overrides: Partial<CommunityFeedback> = {}): CommunityFeedback {
	return {
		...summary(),
		commentCount: 1,
		commentsHasMore: false,
		comments: [
			{
				id: "fbc_community_01",
				body: "Same context.",
				createdAt: "2026-07-19T09:30:00.000Z",
			},
		],
		statusHistory: [
			{
				version: 1,
				fromStatus: null,
				toStatus: "open",
				note: null,
				changedAt: "2026-07-19T08:00:00.000Z",
			},
			{
				version: 2,
				fromStatus: "open",
				toStatus: "planned",
				note: "Scheduled",
				changedAt: "2026-07-19T09:00:00.000Z",
			},
		],
		statusHistoryCount: 2,
		statusHistoryHasMore: false,
		...overrides,
	};
}

function unsafeDetail() {
	const safe = detail();
	return {
		...safe,
		authorUserId: "usr_private-actor",
		diagnostics: { deviceModel: "private-device" },
		attachments: [{ id: "att_private" }],
		rootEventId: rootA,
		comments: safe.comments.map((comment) => ({
			...comment,
			authorUserId: "usr_private-actor",
		})),
		statusHistory: safe.statusHistory.map((change) => ({
			...change,
			changedBy: "usr_private-actor",
		})),
	};
}

function genericFeedback(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		attachments: [],
		authorUserId: accountB,
		body: "Private generic response body",
		commentCount: 0,
		comments: [],
		commentsHasMore: false,
		context: { eventId: null, rootEventId: rootA, screenKey: null },
		createdAt: now,
		diagnostics: { deviceModel: "private-device", platform: "ios" },
		duplicateOfFeedbackId: null,
		id: duplicateId,
		status: "in_progress",
		statusHistory: [],
		statusHistoryCount: 0,
		statusHistoryHasMore: false,
		title: "Private generic response",
		updatedAt: now,
		version: 3,
		viewerHasVoted: false,
		visibility: "public",
		voteCount: 1,
		...overrides,
	};
}

function update(
	overrides: Partial<CommunityFeedbackUpdate> = {},
): CommunityFeedbackUpdate {
	return {
		feedbackId: canonicalId,
		title: "Search needs filters",
		version: 2,
		fromStatus: "open",
		toStatus: "planned",
		note: "Scheduled",
		changedAt: "2026-07-19T09:00:00.000Z",
		...overrides,
	};
}

function jsonResponse(status: number, body: unknown) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

async function eventually(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 1_000;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Condition was not met");
		await Bun.sleep(1);
	}
}
