import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	GatewayClient,
	type Session,
	type SessionStore,
} from "@crew/mobile-client";
import type {
	SqlDatabase,
	SqlExecutor,
	SqlValue,
	SyncBootstrapPage,
	SyncGolfLeaderboardData,
	SyncGolfPlayerData,
	SyncGolfRosterData,
	SyncGolfRoundData,
	SyncGolfScoreData,
	SyncMutationDraft,
	SyncPullPage,
	SyncPushBody,
} from "../src/index.ts";
import {
	GolfOfflineStore,
	golfScoreEntityId,
	golfScoreServerAdapterStatus,
	MobileDataStore,
	MobileSyncEngine,
	migrate,
} from "../src/index.ts";

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
const now = "2026-07-19T08:00:00.000Z";
const rootEventId = "evt_golfmobile1";
const alice = "usr_00000000000000000000000000000001";
const bob = "usr_00000000000000000000000000000002";
const charlie = "usr_00000000000000000000000000000003";
const deviceId = "dvc_00000000-0000-4000-8000-000000000001";

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0))
		rmSync(directory, { force: true, recursive: true });
});

describe("golf mobile offline data", () => {
	test("isolates accounts and keeps one immediate plus-handicap intent across restart", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-golf-offline-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "golf.sqlite");
		let database = new BunDatabase(path);
		await migrate(database);
		await bootstrap(database, alice);
		await bootstrap(database, bob);
		let golf = fixedGolfStore(database);

		expect(golfScoreServerAdapterStatus).toBe("mutation_outbox");
		expect((await golf.getRound(alice, rootEventId))?.teams[0]).toEqual({
			id: "gtm_mobile",
			name: "Mobile Flight",
			color: "#00AA55",
			memberUserIds: [alice, bob],
		});
		const input = {
			accountUserId: alice,
			clientIntentId: "gsi_alice_hole_18",
			rootEventId,
			eventId: rootEventId,
			hole: 18,
			strokes: 4,
			putts: 2,
			baseVersion: 0,
		};
		const first = await golf.enqueueScore(input);
		expect(first).toMatchObject({
			clientSequence: 1,
			playingHandicap: -2,
			handicapStrokes: -1,
			netStrokes: 5,
			stablefordPoints: 1,
			state: "pending",
		});
		expect(await golf.enqueueScore(input)).toEqual(first);
		expect(await golf.listScoreIntents(alice, rootEventId)).toHaveLength(1);
		await expect(golf.enqueueScore({ ...input, strokes: 5 })).rejects.toThrow(
			"intent ID was reused",
		);

		expect((await golf.listScorecard(alice, rootEventId))[17]).toMatchObject({
			hole: 18,
			strokes: 4,
			handicapStrokes: -1,
			netStrokes: 5,
			stablefordPoints: 1,
			isPending: true,
			authoritativeStrokes: null,
			authoritativePutts: null,
			authoritativeStablefordPoints: null,
		});
		expect(await golf.listRanking(alice, rootEventId)).toEqual([
			{
				rank: 1,
				userId: alice,
				teamId: "gtm_mobile",
				stablefordPoints: 1,
				holesCompleted: 1,
			},
			{
				rank: 2,
				userId: bob,
				teamId: "gtm_mobile",
				stablefordPoints: 0,
				holesCompleted: 0,
			},
		]);
		expect(await golf.listRanking(bob, rootEventId)).toEqual([
			{
				rank: 1,
				userId: alice,
				teamId: "gtm_mobile",
				stablefordPoints: 0,
				holesCompleted: 0,
			},
			{
				rank: 1,
				userId: bob,
				teamId: "gtm_mobile",
				stablefordPoints: 0,
				holesCompleted: 0,
			},
		]);

		database.close();
		database = new BunDatabase(path);
		await migrate(database);
		golf = fixedGolfStore(database);
		expect(await golf.listScoreIntents(alice, rootEventId)).toEqual([first]);
		expect(await golf.enqueueScore(input)).toEqual(first);

		await new MobileDataStore(database).clearUserData(alice);
		expect(await golf.getRound(alice, rootEventId)).toBeNull();
		expect(await golf.listScoreIntents(alice, rootEventId)).toEqual([]);
		expect(await golf.getRound(bob, rootEventId)).not.toBeNull();
		database.close();
	});

	test("uses one gap-free outbox stream and replays one linked golf enqueue", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await bootstrap(database, alice);
		const engine = testGolfSyncEngine(database, noFetch);
		await engine.enqueueMutation(
			alice,
			rootEventId,
			deviceId,
			feedCreate("fed_before_golf", "Before"),
			{},
		);
		const input = golfIntent("gsi_linked_hole_18");
		const first = await engine.enqueueGolfScore(input, deviceId);
		const golfOutbox = requiredTest(first.outbox);
		const replay = await engine.enqueueGolfScore(input, deviceId);
		expect(replay).toEqual(first);
		expect(first.intent.outboxClientMutationId).toBe(
			golfOutbox.clientMutationId,
		);
		await expect(
			engine.enqueueMutation(
				alice,
				rootEventId,
				deviceId,
				{
					kind: "golf.score.set",
					entityId: first.intent.scoreId,
					baseVersion: 0,
					payload: { eventId: rootEventId, hole: 18, strokes: 4, putts: 2 },
				} satisfies SyncMutationDraft,
				{},
			),
		).rejects.toThrow("Use enqueueGolfScore");
		await engine.enqueueMutation(
			alice,
			rootEventId,
			deviceId,
			feedCreate("fed_after_golf", "After"),
			{},
		);

		const outbox = await engine.listOutbox(alice, rootEventId);
		expect(outbox.map(({ clientSequence }) => clientSequence)).toEqual([
			1, 2, 3,
		]);
		expect(outbox[1]?.command).toEqual({
			kind: "golf.score.set",
			entityId: first.intent.scoreId,
			baseVersion: 0,
			payload: { eventId: rootEventId, hole: 18, strokes: 4, putts: 2 },
			clientMutationId: golfOutbox.clientMutationId,
			clientSequence: 2,
		});
		const wireJson = JSON.stringify(outbox[1]?.command);
		expect(wireJson).not.toContain("userId");
		expect(wireJson).not.toContain("handicap");
		expect(wireJson).not.toContain("stableford");
		expect(
			await fixedGolfStore(database).listScoreIntents(alice, rootEventId),
		).toHaveLength(1);
		database.close();
	});

	test("keeps a score clear unplayed through optimistic state, pull and restart", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-golf-clear-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "golf.sqlite");
		let database = new BunDatabase(path);
		await migrate(database);
		const store = await bootstrap(database, alice);
		await store.applyPullPage(
			alice,
			"cursor-bootstrap",
			pullPage("cursor-score-set", [
				scoreUpsert("2", 0, golfScore(1, 4, 1, "2")),
				leaderboardUpsert("2", 1, leaderboard(2, 1)),
			]),
		);
		let golf = fixedGolfStore(database);
		await golf.enqueueScore({
			accountUserId: alice,
			clientIntentId: "gsi_clear_hole_18",
			rootEventId,
			eventId: rootEventId,
			hole: 18,
			strokes: null,
			putts: null,
			baseVersion: 1,
		});
		expect((await golf.listScorecard(alice, rootEventId))[17]).toMatchObject({
			strokes: null,
			putts: null,
			netStrokes: null,
			stablefordPoints: 0,
			isPending: true,
			authoritativeStrokes: 4,
		});
		expect((await golf.listRanking(alice, rootEventId))[0]).toMatchObject({
			stablefordPoints: 0,
			holesCompleted: 0,
		});
		database.close();

		database = new BunDatabase(path);
		await migrate(database);
		golf = fixedGolfStore(database);
		expect((await golf.listScorecard(alice, rootEventId))[17]).toMatchObject({
			strokes: null,
			stablefordPoints: 0,
			isPending: true,
			authoritativeStrokes: 4,
		});
		expect((await golf.listRanking(alice, rootEventId))[0]).toMatchObject({
			stablefordPoints: 0,
			holesCompleted: 0,
		});
		const [clearIntent] = await golf.listScoreIntents(alice, rootEventId);
		if (!clearIntent) throw new Error("clear intent is missing after restart");
		await golf.markIntentAwaitingPull(alice, clearIntent.clientIntentId, 2);
		await new MobileDataStore(database).applyPullPage(
			alice,
			"cursor-score-set",
			pullPage("cursor-score-cleared", [
				scoreUpsert("3", 0, golfScore(2, null, 0, "3")),
				leaderboardUpsert("3", 1, leaderboard(3, 0)),
			]),
		);
		expect(await golf.listScoreIntents(alice, rootEventId)).toEqual([]);
		expect((await golf.listScorecard(alice, rootEventId))[17]).toMatchObject({
			strokes: null,
			stablefordPoints: 0,
			isPending: false,
			authoritativeStrokes: null,
			authoritativeStablefordPoints: 0,
		});
		database.close();

		database = new BunDatabase(path);
		await migrate(database);
		golf = fixedGolfStore(database);
		expect(await golf.listScoreIntents(alice, rootEventId)).toEqual([]);
		expect((await golf.listScorecard(alice, rootEventId))[17]).toMatchObject({
			strokes: null,
			stablefordPoints: 0,
			isPending: false,
			authoritativeStrokes: null,
		});
		expect((await golf.listRanking(alice, rootEventId))[0]).toMatchObject({
			stablefordPoints: 0,
			holesCompleted: 0,
		});
		database.close();
	});

	test("sends manager round replacement through the shared outbox with an exact retry body", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await bootstrap(database, alice);
		const attempts: Array<{ body: string; idempotencyKey: string }> = [];
		const engine = testGolfSyncEngine(database, async (input, init) => {
			if (new URL(String(input)).pathname.endsWith("/sync/push")) {
				attempts.push({
					body: String(init?.body),
					idempotencyKey: requiredTest(
						new Headers(init?.headers).get("idempotency-key"),
					),
				});
				throw new Error("connection dropped after round replacement");
			}
			throw new Error("unexpected request");
		});
		await engine.enqueueMutation(
			alice,
			rootEventId,
			deviceId,
			feedCreate("fed_before_round", "Before round"),
			{},
		);
		const roundDraft = {
			kind: "golf.round.replace",
			entityId: rootEventId,
			baseVersion: 1,
			payload: {
				eventId: rootEventId,
				holes: Array.from({ length: 18 }, (_, index) => ({
					hole: index + 1,
					par: 4,
					strokeIndex: index + 1,
				})),
				players: [
					{ userId: alice, playingHandicap: -2 },
					{ userId: bob, playingHandicap: 18 },
				],
				teams: [
					{
						id: "gtm_mobile",
						name: "Mobile Flight",
						color: "#00AA55",
						memberUserIds: [alice, bob],
					},
				],
			},
		} satisfies SyncMutationDraft;
		const queued = await engine.enqueueMutation(
			alice,
			rootEventId,
			deviceId,
			roundDraft,
			{ kind: "golfRound", eventId: rootEventId },
		);
		await engine.enqueueMutation(
			alice,
			rootEventId,
			deviceId,
			feedCreate("fed_after_round", "After round"),
			{},
		);
		const outbox = await engine.listOutbox(alice, rootEventId);
		expect(outbox.map(({ clientSequence }) => clientSequence)).toEqual([
			1, 2, 3,
		]);
		expect(outbox[1]?.command).toEqual({
			...roundDraft,
			clientMutationId: queued.clientMutationId,
			clientSequence: 2,
		});

		expect(await engine.syncRoot(alice, rootEventId)).toMatchObject({
			state: "waiting_retry",
		});
		await engine.retryNow(alice, rootEventId);
		expect(await engine.syncRoot(alice, rootEventId)).toMatchObject({
			state: "waiting_retry",
		});
		expect(attempts).toHaveLength(2);
		expect(attempts[1]).toEqual(attempts[0]);
		const replayed = JSON.parse(requiredTest(attempts[0]).body) as SyncPushBody;
		expect(JSON.stringify(replayed.mutations[1])).toBe(
			JSON.stringify(outbox[1]?.command),
		);
		database.close();
	});

	test("rolls the intent and both sequence streams back when outbox persistence fails", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await bootstrap(database, alice);
		const broken = testGolfSyncEngine(database, noFetch, {
			sha256: () => "A".repeat(64),
		});
		await expect(
			broken.enqueueGolfScore(golfIntent("gsi_atomic_rollback"), deviceId),
		).rejects.toThrow("invalid lowercase digest");
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM golf_score_intents",
			),
		).toEqual({ count: 0 });
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM mutation_outbox",
			),
		).toEqual({ count: 0 });

		const working = testGolfSyncEngine(database, noFetch);
		const enqueued = await working.enqueueGolfScore(
			golfIntent("gsi_atomic_rollback"),
			deviceId,
		);
		expect(enqueued.intent.clientSequence).toBe(1);
		expect(enqueued.outbox?.clientSequence).toBe(1);
		database.close();
	});

	test("acknowledges through the linked intent and converges on pull", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await bootstrap(database, alice);
		const pushed: SyncPushBody[] = [];
		const engine = testGolfSyncEngine(database, async (input, init) => {
			const pathname = new URL(String(input)).pathname;
			if (pathname.endsWith("/sync/push")) {
				const body = JSON.parse(String(init?.body)) as SyncPushBody;
				pushed.push(body);
				const mutation = requiredTest(body.mutations[0]);
				return gatewayJson(init, 200, {
					protocolVersion: 1,
					rootEventId,
					deviceId,
					results: [
						{
							clientMutationId: mutation.clientMutationId,
							clientSequence: mutation.clientSequence,
							outcome: "applied",
							replayed: false,
							rootRevision: "2",
							entity: {
								entityType: "golfScore",
								entityId: mutation.entityId,
								version: 1,
							},
						},
					],
					nextExpectedClientSequence: mutation.clientSequence + 1,
				});
			}
			if (pathname.endsWith("/sync/pull")) {
				return gatewayJson(
					init,
					200,
					pullPage("cursor-golf-ack-01", [
						scoreUpsert("2", 0, golfScore(1, 4, 1, "2")),
					]),
				);
			}
			throw new Error("unexpected request");
		});
		await engine.enqueueGolfScore(golfIntent("gsi_ack_then_pull"), deviceId);
		expect(await engine.syncRoot(alice, rootEventId)).toMatchObject({
			state: "synced",
			pendingCount: 0,
		});
		expect(pushed[0]?.mutations[0]).toMatchObject({
			kind: "golf.score.set",
			payload: { eventId: rootEventId, hole: 18, strokes: 4, putts: 2 },
		});
		expect(
			await fixedGolfStore(database).listScoreIntents(alice, rootEventId),
		).toEqual([]);
		expect(await engine.listOutbox(alice, rootEventId)).toEqual([]);
		database.close();
	});

	test("atomically replaces a consumed conflict without a ghost intent after restart", async () => {
		const directory = mkdtempSync(
			join(tmpdir(), "crew-golf-conflict-requeue-"),
		);
		temporaryDirectories.push(directory);
		const path = join(directory, "golf.sqlite");
		let database = new BunDatabase(path);
		await migrate(database);
		const store = await bootstrap(database, alice);
		await store.applyPullPage(
			alice,
			"cursor-bootstrap",
			pullPage("cursor-authoritative-score", [
				scoreUpsert("2", 0, golfScore(1, 5, 0, "2")),
			]),
		);
		let pushCount = 0;
		const engine = testGolfSyncEngine(database, async (input, init) => {
			const pathname = new URL(String(input)).pathname;
			if (pathname.endsWith("/sync/push")) {
				pushCount += 1;
				const body = JSON.parse(String(init?.body)) as SyncPushBody;
				const mutation = requiredTest(body.mutations[0]);
				return gatewayJson(init, 200, {
					protocolVersion: 1,
					rootEventId,
					deviceId,
					results:
						pushCount === 1
							? [
									{
										clientMutationId: mutation.clientMutationId,
										clientSequence: mutation.clientSequence,
										outcome: "rejected",
										replayed: false,
										error: {
											code: "VERSION_CONFLICT",
											message: "Conflict",
											retryable: false,
											currentVersion: 1,
										},
									},
								]
							: [
									{
										clientMutationId: mutation.clientMutationId,
										clientSequence: mutation.clientSequence,
										outcome: "applied",
										replayed: false,
										rootRevision: "3",
										entity: {
											entityType: "golfScore",
											entityId: mutation.entityId,
											version: 2,
										},
									},
								],
					nextExpectedClientSequence: mutation.clientSequence + 1,
				});
			}
			if (pathname.endsWith("/sync/pull")) {
				return gatewayJson(
					init,
					200,
					pushCount === 1
						? pullPage("cursor-after-conflict", [])
						: pullPage("cursor-after-replacement", [
								scoreUpsert("3", 0, golfScore(2, 4, 1, "3")),
								leaderboardUpsert("3", 1, leaderboard(3, 1)),
							]),
				);
			}
			throw new Error("unexpected request");
		});
		const original = await engine.enqueueGolfScore(
			golfIntent("gsi_conflict_original"),
			deviceId,
		);
		const originalMutationId = requiredTest(original.outbox).clientMutationId;
		expect(await engine.syncRoot(alice, rootEventId)).toMatchObject({
			state: "needs_attention",
		});
		expect((await engine.listOutbox(alice, rootEventId))[0]).toMatchObject({
			clientMutationId: originalMutationId,
			state: "dead_letter",
			serverConsumed: true,
		});
		await expect(
			engine.discardDeadLetter(alice, originalMutationId),
		).rejects.toThrow("identical durable replacement");
		expect(
			await fixedGolfStore(database).listScoreIntents(alice, rootEventId),
		).toEqual([
			expect.objectContaining({ clientIntentId: "gsi_conflict_original" }),
		]);
		expect(await engine.listOutbox(alice, rootEventId)).toEqual([
			expect.objectContaining({ clientMutationId: originalMutationId }),
		]);

		const replacement = await engine.enqueueGolfScore(
			{
				...golfIntent("gsi_conflict_replacement"),
				baseVersion: 1,
			},
			deviceId,
		);
		const replacementMutationId = requiredTest(
			replacement.outbox,
		).clientMutationId;
		await engine.discardDeadLetter(alice, originalMutationId);
		expect(await engine.listOutbox(alice, rootEventId)).toEqual([
			expect.objectContaining({
				clientMutationId: replacementMutationId,
				state: "pending",
			}),
		]);
		expect(
			await fixedGolfStore(database).listScoreIntents(alice, rootEventId),
		).toEqual([
			expect.objectContaining({
				clientIntentId: "gsi_conflict_replacement",
				strokes: 4,
			}),
		]);
		expect(await engine.syncRoot(alice, rootEventId)).toMatchObject({
			state: "synced",
			pendingCount: 0,
		});
		expect(await engine.listOutbox(alice, rootEventId)).toEqual([]);
		expect(
			await fixedGolfStore(database).listScoreIntents(alice, rootEventId),
		).toEqual([]);
		database.close();

		database = new BunDatabase(path);
		await migrate(database);
		const restartedEngine = testGolfSyncEngine(database, noFetch);
		const restartedGolf = fixedGolfStore(database);
		expect(await restartedEngine.listOutbox(alice, rootEventId)).toEqual([]);
		expect(await restartedGolf.listScoreIntents(alice, rootEventId)).toEqual(
			[],
		);
		expect(
			(await restartedGolf.listScorecard(alice, rootEventId))[17],
		).toMatchObject({
			strokes: 4,
			version: 2,
			stablefordPoints: 1,
			isPending: false,
			authoritativeStrokes: 4,
		});
		expect(
			(await restartedGolf.listRanking(alice, rootEventId))[0],
		).toMatchObject({ stablefordPoints: 1, holesCompleted: 1 });
		database.close();
	});

	test("converges when authoritative score pull arrives before the outbox acknowledgement", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const store = await bootstrap(database, alice);
		const engine = testGolfSyncEngine(database, async (input, init) => {
			const pathname = new URL(String(input)).pathname;
			if (pathname.endsWith("/sync/push")) {
				const body = JSON.parse(String(init?.body)) as SyncPushBody;
				const mutation = requiredTest(body.mutations[0]);
				return gatewayJson(init, 200, {
					protocolVersion: 1,
					rootEventId,
					deviceId,
					results: [
						{
							clientMutationId: mutation.clientMutationId,
							clientSequence: mutation.clientSequence,
							outcome: "applied",
							replayed: true,
							rootRevision: "3",
							entity: {
								entityType: "golfScore",
								entityId: mutation.entityId,
								version: 1,
							},
						},
					],
					nextExpectedClientSequence: mutation.clientSequence + 1,
				});
			}
			if (pathname.endsWith("/sync/pull")) {
				return gatewayJson(
					init,
					200,
					pullPage("cursor-golf-after-ack", [
						leaderboardUpsert("3", 0, leaderboard(2, 1)),
					]),
				);
			}
			throw new Error("unexpected request");
		});
		await engine.enqueueGolfScore(
			golfIntent("gsi_pull_before_outbox_ack"),
			deviceId,
		);
		await store.applyPullPage(
			alice,
			"cursor-bootstrap",
			pullPage("cursor-score-before-ack", [
				scoreUpsert("2", 0, golfScore(1, 4, 1, "2")),
			]),
		);
		expect(
			(await fixedGolfStore(database).listScoreIntents(alice, rootEventId))[0]
				?.state,
		).toBe("pending");
		expect(await engine.syncRoot(alice, rootEventId)).toMatchObject({
			state: "synced",
			pendingCount: 0,
		});
		expect(
			await fixedGolfStore(database).listScoreIntents(alice, rootEventId),
		).toEqual([]);
		expect(await engine.listOutbox(alice, rootEventId)).toEqual([]);
		database.close();
	});

	test("purges score state when acknowledgement arrives before the player tombstone", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await bootstrap(database, alice);
		const engine = testGolfSyncEngine(database, async (input, init) => {
			const pathname = new URL(String(input)).pathname;
			if (pathname.endsWith("/sync/push")) {
				const body = JSON.parse(String(init?.body)) as SyncPushBody;
				const mutation = requiredTest(body.mutations[0]);
				return gatewayJson(init, 200, {
					protocolVersion: 1,
					rootEventId,
					deviceId,
					results: [
						{
							clientMutationId: mutation.clientMutationId,
							clientSequence: mutation.clientSequence,
							outcome: "applied",
							replayed: false,
							rootRevision: "2",
							entity: {
								entityType: "golfScore",
								entityId: mutation.entityId,
								version: 1,
							},
						},
					],
					nextExpectedClientSequence: mutation.clientSequence + 1,
				});
			}
			if (pathname.endsWith("/sync/pull")) {
				return gatewayJson(
					init,
					200,
					pullPage("cursor-ack-before-tombstone", [
						scoreUpsert("2", 0, golfScore(1, 4, 1, "2")),
						playerTombstone("3", 0, alice, 2),
					]),
				);
			}
			throw new Error("unexpected request");
		});
		await engine.enqueueGolfScore(
			golfIntent("gsi_ack_before_player_tombstone"),
			deviceId,
		);
		expect(await engine.syncRoot(alice, rootEventId)).toMatchObject({
			state: "synced",
			pendingCount: 0,
		});
		expect(
			await database.first<{
				players: number;
				scores: number;
				intents: number;
			}>(
				`SELECT
  (SELECT COUNT(*) FROM golf_players WHERE account_user_id = ?) AS players,
  (SELECT COUNT(*) FROM golf_scores WHERE account_user_id = ?) AS scores,
  (SELECT COUNT(*) FROM golf_score_intents WHERE account_user_id = ?) AS intents`,
				[alice, alice, alice],
			),
		).toEqual({ players: 0, scores: 0, intents: 0 });
		expect(await engine.listOutbox(alice, rootEventId)).toEqual([]);
		database.close();
	});

	test("accepts an in-flight applied acknowledgement after the player tombstone and restart", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-golf-ack-race-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "golf.sqlite");
		let database = new BunDatabase(path);
		await migrate(database);
		const store = await bootstrap(database, alice);
		const engine = testGolfSyncEngine(database, async (input, init) => {
			const pathname = new URL(String(input)).pathname;
			if (pathname.endsWith("/sync/push")) {
				const body = JSON.parse(String(init?.body)) as SyncPushBody;
				const mutation = requiredTest(body.mutations[0]);
				await store.applyPullPage(
					alice,
					"cursor-bootstrap",
					pullPage("cursor-tombstone-before-ack", [
						playerTombstone("3", 0, alice, 2),
					]),
				);
				return gatewayJson(init, 200, {
					protocolVersion: 1,
					rootEventId,
					deviceId,
					results: [
						{
							clientMutationId: mutation.clientMutationId,
							clientSequence: mutation.clientSequence,
							outcome: "applied",
							replayed: false,
							rootRevision: "2",
							entity: {
								entityType: "golfScore",
								entityId: mutation.entityId,
								version: 1,
							},
						},
					],
					nextExpectedClientSequence: mutation.clientSequence + 1,
				});
			}
			if (pathname.endsWith("/sync/pull")) {
				return gatewayJson(
					init,
					200,
					pullPage("cursor-after-tombstone-ack", [
						leaderboardUpsert("4", 0, leaderboard(2, 0)),
					]),
				);
			}
			throw new Error("unexpected request");
		});
		await engine.enqueueGolfScore(
			golfIntent("gsi_player_tombstone_before_ack"),
			deviceId,
		);
		expect(await engine.syncRoot(alice, rootEventId)).toMatchObject({
			state: "synced",
			pendingCount: 0,
		});
		expect(await engine.listOutbox(alice, rootEventId)).toEqual([]);
		expect(
			await fixedGolfStore(database).listScoreIntents(alice, rootEventId),
		).toEqual([]);
		database.close();

		database = new BunDatabase(path);
		await migrate(database);
		expect(
			await database.first<{
				players: number;
				scores: number;
				intents: number;
			}>(
				`SELECT
  (SELECT COUNT(*) FROM golf_players WHERE account_user_id = ?) AS players,
  (SELECT COUNT(*) FROM golf_scores WHERE account_user_id = ?) AS scores,
  (SELECT COUNT(*) FROM golf_score_intents WHERE account_user_id = ?) AS intents`,
				[alice, alice, alice],
			),
		).toEqual({ players: 0, scores: 0, intents: 0 });
		expect(await database.all("PRAGMA foreign_key_check")).toEqual([]);
		database.close();
	});

	test("rejects a mismatched score acknowledgement and stores version zero as absent", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await bootstrap(database, alice);
		let mismatch = true;
		const pushBodies: string[] = [];
		const engine = testGolfSyncEngine(database, async (input, init) => {
			const pathname = new URL(String(input)).pathname;
			if (pathname.endsWith("/sync/push")) {
				pushBodies.push(String(init?.body));
				const body = JSON.parse(
					requiredTest(pushBodies.at(-1)),
				) as SyncPushBody;
				const mutation = requiredTest(body.mutations[0]);
				return gatewayJson(init, 200, {
					protocolVersion: 1,
					rootEventId,
					deviceId,
					results: mismatch
						? [
								{
									clientMutationId: mutation.clientMutationId,
									clientSequence: mutation.clientSequence,
									outcome: "applied",
									replayed: false,
									rootRevision: "2",
									entity: {
										entityType: "golfScore",
										entityId: "gsc_wrong",
										version: 1,
									},
								},
							]
						: [
								{
									clientMutationId: mutation.clientMutationId,
									clientSequence: mutation.clientSequence,
									outcome: "rejected",
									replayed: true,
									error: {
										code: "VERSION_CONFLICT",
										message: "Conflict",
										retryable: false,
										currentVersion: 0,
									},
								},
							],
					nextExpectedClientSequence: mutation.clientSequence + 1,
				});
			}
			if (pathname.endsWith("/sync/pull")) {
				return gatewayJson(init, 200, pullPage("cursor-golf-conflict", []));
			}
			throw new Error("unexpected request");
		});
		await engine.enqueueGolfScore(golfIntent("gsi_invalid_ack"), deviceId);
		expect(await engine.syncRoot(alice, rootEventId)).toMatchObject({
			state: "waiting_retry",
		});
		expect(
			(await fixedGolfStore(database).listScoreIntents(alice, rootEventId))[0]
				?.state,
		).toBe("pending");
		mismatch = false;
		await engine.retryNow(alice, rootEventId);
		expect(await engine.syncRoot(alice, rootEventId)).toMatchObject({
			state: "needs_attention",
		});
		expect(pushBodies[1]).toBe(pushBodies[0]);
		expect((await engine.listOutbox(alice, rootEventId))[0]?.lastError).toEqual(
			{
				code: "conflict",
				requestId: "request-golf-000002",
				currentVersion: null,
				authoritativeOrder: null,
			},
		);
		database.close();
	});

	test("materializes pull once and ignores a delayed older golf version", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const store = await bootstrap(database, alice);
		const golf = fixedGolfStore(database);
		const input = {
			accountUserId: alice,
			clientIntentId: "gsi_pull_hole_18",
			rootEventId,
			eventId: rootEventId,
			hole: 18,
			strokes: 4,
			putts: 2,
			baseVersion: 0,
		};
		const intent = await golf.enqueueScore(input);
		await golf.markIntentAwaitingPull(alice, intent.clientIntentId, 1);

		const versionOne = golfScore(1, 4, 1, "2");
		const applied = pullPage("cursor-score-1", [
			scoreUpsert("2", 0, versionOne),
			leaderboardUpsert("2", 1, leaderboard(2, 1)),
		]);
		expect(
			await store.applyPullPage(alice, "cursor-bootstrap", applied),
		).toEqual({ replayed: false });
		expect(await golf.listScoreIntents(alice, rootEventId)).toEqual([]);
		const converged = await golf.markIntentAwaitingPull(
			alice,
			intent.clientIntentId,
			1,
		);
		expect(converged.state).toBe("converged");
		expect(await golf.enqueueScore(input)).toEqual(converged);
		await expect(golf.enqueueScore({ ...input, strokes: 5 })).rejects.toThrow(
			"intent ID was reused",
		);
		expect((await golf.listScorecard(alice, rootEventId))[17]).toMatchObject({
			version: 1,
			stablefordPoints: 1,
			isPending: false,
			authoritativeStrokes: 4,
			authoritativePutts: 2,
			authoritativeStablefordPoints: 1,
		});
		expect(
			await store.applyPullPage(alice, "cursor-bootstrap", applied),
		).toEqual({ replayed: true });

		const versionTwo = golfScore(2, 5, 0, "3");
		await store.applyPullPage(
			alice,
			"cursor-score-1",
			pullPage("cursor-score-2", [
				scoreUpsert("3", 0, versionTwo),
				leaderboardUpsert("3", 1, leaderboard(3, 0)),
			]),
		);
		await store.applyPullPage(
			alice,
			"cursor-score-2",
			pullPage("cursor-delayed", [
				scoreUpsert("4", 0, versionOne),
				leaderboardUpsert("4", 1, leaderboard(2, 1)),
			]),
		);
		expect((await golf.listScorecard(alice, rootEventId))[17]).toMatchObject({
			version: 2,
			strokes: 5,
			stablefordPoints: 0,
			authoritativeStrokes: 5,
			authoritativePutts: 2,
			authoritativeStablefordPoints: 0,
		});
		expect((await golf.listRanking(alice, rootEventId))[0]).toMatchObject({
			userId: alice,
			stablefordPoints: 0,
		});
		database.close();
	});

	test("orders manager roster bootstrap, isolates accounts, and rejects participant roster data", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const aliceStore = new MobileDataStore(database);
		const managerPage = authorizedBootstrapPage(
			alice,
			"snp_manager_roster",
			"1",
			"1",
			"organizer",
			golfRoster(1),
		);
		await aliceStore.applyBootstrapPage(alice, null, managerPage);
		expect(
			(await fixedGolfStore(database).getRound(alice, rootEventId))?.players,
		).toEqual([
			{
				rootEventId,
				eventId: rootEventId,
				userId: alice,
				playingHandicap: -2,
				version: 1,
			},
			{
				rootEventId,
				eventId: rootEventId,
				userId: bob,
				playingHandicap: 18,
				version: 1,
			},
		]);

		const bobStore = new MobileDataStore(database);
		const forbiddenBootstrap = authorizedBootstrapPage(
			bob,
			"snp_participant_forbidden",
			"1",
			"1",
			"participant",
			golfRoster(1),
		);
		await expect(
			bobStore.applyBootstrapPage(bob, null, forbiddenBootstrap),
		).rejects.toThrow("golf roster requires manager access");
		expect(await bobStore.getRootSyncState(bob, rootEventId)).toBeNull();

		const participantPage = authorizedBootstrapPage(
			bob,
			"snp_participant_clean",
			"1",
			"1",
			"participant",
			null,
		);
		await bobStore.applyBootstrapPage(bob, null, participantPage);
		expect(
			(await fixedGolfStore(database).getRound(bob, rootEventId))?.players,
		).toEqual([
			{
				rootEventId,
				eventId: rootEventId,
				userId: bob,
				playingHandicap: 18,
				version: 1,
			},
		]);
		expect(
			await database.all<{ account_user_id: string; count: number }>(
				`SELECT account_user_id, COUNT(*) AS count FROM golf_roster_players
GROUP BY account_user_id ORDER BY account_user_id`,
			),
		).toEqual([{ account_user_id: alice, count: 2 }]);

		await expect(
			bobStore.applyPullPage(
				bob,
				participantPage.syncCursor,
				pullPage("cursor-participant-roster", [
					rosterUpsert("2", 0, golfRoster(2)),
				]),
			),
		).rejects.toThrow("golf roster requires manager access");
		expect(
			(await bobStore.getRootSyncState(bob, rootEventId))?.pullCursor,
		).toBe(participantPage.syncCursor);
		database.close();
	});

	test("atomically replaces manager rosters while retaining scores and ignoring replay or stale data", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const store = new MobileDataStore(database);
		const initial = authorizedBootstrapPage(
			alice,
			"snp_roster_replace",
			"1",
			"1",
			"owner",
			golfRoster(1),
		);
		await store.applyBootstrapPage(alice, null, initial);
		await store.applyPullPage(
			alice,
			initial.syncCursor,
			pullPage("cursor-roster-score", [
				scoreUpsert("2", 0, golfScore(1, 4, 1, "2")),
			]),
		);

		const replacement = pullPage("cursor-roster-v2", [
			rosterUpsert(
				"3",
				0,
				golfRoster(2, [
					{ userId: alice, playingHandicap: -1 },
					{ userId: charlie, playingHandicap: 11 },
				]),
			),
		]);
		expect(
			await store.applyPullPage(alice, "cursor-roster-score", replacement),
		).toEqual({ replayed: false });
		expect(
			(
				await fixedGolfStore(database).getRound(alice, rootEventId)
			)?.players.map(({ userId, playingHandicap, version }) => ({
				userId,
				playingHandicap,
				version,
			})),
		).toEqual([
			{ userId: alice, playingHandicap: -1, version: 2 },
			{ userId: charlie, playingHandicap: 11, version: 2 },
		]);
		expect(
			(await fixedGolfStore(database).listScorecard(alice, rootEventId))[17],
		).toMatchObject({ version: 1, strokes: 4, stablefordPoints: 1 });
		expect(
			await store.applyPullPage(alice, "cursor-roster-score", replacement),
		).toEqual({ replayed: true });

		await store.applyPullPage(
			alice,
			"cursor-roster-v2",
			pullPage("cursor-roster-stale", [rosterUpsert("4", 0, golfRoster(1))]),
		);
		expect(
			(
				await fixedGolfStore(database).getRound(alice, rootEventId)
			)?.players.map(({ userId }) => userId),
		).toEqual([alice, charlie]);

		const invalid = golfRoster(3, [
			{ userId: alice, playingHandicap: -1 },
			{ userId: alice, playingHandicap: 12 },
		]);
		await expect(
			store.applyPullPage(
				alice,
				"cursor-roster-stale",
				pullPage("cursor-roster-invalid", [rosterUpsert("5", 0, invalid)]),
			),
		).rejects.toThrow("invalid golf roster");
		expect((await store.getRootSyncState(alice, rootEventId))?.pullCursor).toBe(
			"cursor-roster-stale",
		);
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM golf_scores WHERE account_user_id = ?",
				[alice],
			),
		).toEqual({ count: 1 });
		database.close();
	});

	test("purges the manager roster when a replacement snapshot downgrades to participant", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const store = new MobileDataStore(database);
		const manager = authorizedBootstrapPage(
			alice,
			"snp_roster_manager",
			"1",
			"1",
			"owner",
			golfRoster(1),
		);
		await store.applyBootstrapPage(alice, null, manager);
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM golf_roster_players WHERE account_user_id = ?",
				[alice],
			),
		).toEqual({ count: 2 });

		const participant = authorizedBootstrapPage(
			alice,
			"snp_roster_participant",
			"5",
			"2",
			"participant",
			null,
		);
		await store.applyBootstrapPage(alice, null, participant);
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM golf_roster_players WHERE account_user_id = ?",
				[alice],
			),
		).toEqual({ count: 0 });
		expect(
			(
				await fixedGolfStore(database).getRound(alice, rootEventId)
			)?.players.map(({ userId }) => userId),
		).toEqual([alice]);
		database.close();
	});

	test("deletes only the self player projection and blocks stale resurrection after restart", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-golf-tombstone-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "golf.sqlite");
		let database = new BunDatabase(path);
		await migrate(database);
		let store = new MobileDataStore(database);
		const manager = authorizedBootstrapPage(
			alice,
			"snp_player_tombstone",
			"1",
			"1",
			"owner",
			golfRoster(1),
		);
		await store.applyBootstrapPage(alice, null, manager);
		await bootstrap(database, bob);
		const engine = testGolfSyncEngine(database, noFetch);
		await engine.enqueueGolfScore(golfIntent("gsi_player_tombstone"), deviceId);
		await store.applyPullPage(
			alice,
			manager.syncCursor,
			pullPage("cursor-player-score", [
				scoreUpsert("2", 0, golfScore(1, 4, 1, "2")),
			]),
		);

		const foreign = playerTombstone("3", 0, bob, 2);
		await expect(
			store.applyPullPage(
				alice,
				"cursor-player-score",
				pullPage("cursor-foreign-player-tombstone", [foreign]),
			),
		).rejects.toThrow("golf player tombstone must target the current account");
		expect((await store.getRootSyncState(alice, rootEventId))?.pullCursor).toBe(
			"cursor-player-score",
		);

		await store.applyPullPage(
			alice,
			"cursor-player-score",
			pullPage("cursor-player-tombstone", [playerTombstone("3", 0, alice, 2)]),
		);
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM golf_players WHERE account_user_id = ?",
				[alice],
			),
		).toEqual({ count: 0 });
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM golf_scores WHERE account_user_id = ?",
				[alice],
			),
		).toEqual({ count: 0 });
		expect(
			await fixedGolfStore(database).listScoreIntents(alice, rootEventId),
		).toEqual([]);
		expect(await engine.listOutbox(alice, rootEventId)).toHaveLength(1);
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM golf_roster_players WHERE account_user_id = ?",
				[alice],
			),
		).toEqual({ count: 2 });
		expect(
			(await fixedGolfStore(database).getRound(bob, rootEventId))?.players.map(
				({ userId }) => userId,
			),
		).toEqual([bob]);

		database.close();
		database = new BunDatabase(path);
		await migrate(database);
		store = new MobileDataStore(database);
		await store.applyPullPage(
			alice,
			"cursor-player-tombstone",
			pullPage("cursor-player-stale", [
				playerUpsert("4", 0, golfPlayer(alice)),
			]),
		);
		expect(
			await database.first<{ count: number }>(
				"SELECT COUNT(*) AS count FROM golf_players WHERE account_user_id = ?",
				[alice],
			),
		).toEqual({ count: 0 });
		await store.applyPullPage(
			alice,
			"cursor-player-stale",
			pullPage("cursor-player-restored", [
				playerUpsert("5", 0, { ...golfPlayer(alice), version: 3 }),
			]),
		);
		expect(
			await database.first<{ user_id: string; version: number }>(
				`SELECT user_id, version FROM golf_players
WHERE account_user_id = ? AND event_id = ?`,
				[alice, rootEventId],
			),
		).toEqual({ user_id: alice, version: 3 });
		expect(
			await database.first<{ count: number }>(
				`SELECT COUNT(*) AS count FROM sync_tombstones
WHERE account_user_id = ? AND entity_type = 'golfPlayer'`,
				[alice],
			),
		).toEqual({ count: 0 });
		database.close();
	});

	test("converges when pull wins the race with the score acknowledgement", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const store = await bootstrap(database, alice);
		const golf = fixedGolfStore(database);
		const intent = await golf.enqueueScore({
			accountUserId: alice,
			clientIntentId: "gsi_pull_before_ack",
			rootEventId,
			eventId: rootEventId,
			hole: 18,
			strokes: 4,
			putts: 2,
			baseVersion: 0,
		});
		const score = golfScore(1, 4, 1, "2");
		await expect(
			store.applyPullPage(
				alice,
				"cursor-bootstrap",
				pullPage("cursor-tampered-score", [
					scoreUpsert("2", 0, { ...score, stablefordPoints: 2 }),
				]),
			),
		).rejects.toThrow("golf score calculation mismatch");
		expect((await store.getRootSyncState(alice, rootEventId))?.pullCursor).toBe(
			"cursor-bootstrap",
		);
		await store.applyPullPage(
			alice,
			"cursor-bootstrap",
			pullPage("cursor-pull-before-ack", [scoreUpsert("2", 0, score)]),
		);
		expect(await golf.listScoreIntents(alice, rootEventId)).toHaveLength(1);
		expect(
			await golf.markIntentAwaitingPull(alice, intent.clientIntentId, 1),
		).toMatchObject({ state: "converged", appliedEntityVersion: 1 });
		expect(
			await golf.markIntentAwaitingPull(alice, intent.clientIntentId, 1),
		).toMatchObject({ state: "converged", appliedEntityVersion: 1 });
		expect(await golf.listScoreIntents(alice, rootEventId)).toEqual([]);
		expect((await golf.listScorecard(alice, rootEventId))[17]).toMatchObject({
			version: 1,
			stablefordPoints: 1,
			isPending: false,
		});
		expect((await golf.listRanking(alice, rootEventId))[0]).toMatchObject({
			userId: alice,
			stablefordPoints: 1,
			holesCompleted: 1,
		});
		database.close();
	});

	test("keeps a pending overlay through an atomic bootstrap replacement", async () => {
		const database = new BunDatabase();
		await migrate(database);
		const store = await bootstrap(database, alice);
		const golf = fixedGolfStore(database);
		await golf.enqueueScore({
			accountUserId: alice,
			clientIntentId: "gsi_snapshot_hole_18",
			rootEventId,
			eventId: rootEventId,
			hole: 18,
			strokes: 4,
			putts: 2,
			baseVersion: 0,
		});
		const replacement = bootstrapPage(alice, "snp_golf_replacement", "8");
		replacement.syncCursor = "cursor-replacement";
		expect(await store.applyBootstrapPage(alice, null, replacement)).toEqual({
			completed: true,
			nextCursor: null,
		});
		expect(await golf.listScoreIntents(alice, rootEventId)).toHaveLength(1);
		expect((await golf.listScorecard(alice, rootEventId))[17]).toMatchObject({
			stablefordPoints: 1,
			isPending: true,
		});
		database.close();
	});

	test("finishes a split out-of-order golf bootstrap after restart", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-golf-bootstrap-"));
		temporaryDirectories.push(directory);
		const path = join(directory, "golf.sqlite");
		let database = new BunDatabase(path);
		await migrate(database);
		let store = new MobileDataStore(database);
		const page = bootstrapPage(alice, "snp_golf_split", "2");
		const [eventRecord, roundRecord, playerRecord, leaderboardRecord] =
			page.records;
		if (!eventRecord || !roundRecord || !playerRecord || !leaderboardRecord)
			throw new Error("golf bootstrap fixture is incomplete");
		const score = golfScore(1, 4, 1, "2");
		expect(
			await store.applyBootstrapPage(alice, null, {
				...page,
				records: [
					{
						entityType: "golfScore",
						entityId: score.id,
						entityVersion: score.version,
						data: score,
					},
					leaderboardRecord,
				],
				pageInfo: { nextCursor: "golf-bootstrap-page-2", hasMore: true },
			}),
		).toEqual({ completed: false, nextCursor: "golf-bootstrap-page-2" });
		database.close();

		database = new BunDatabase(path);
		await migrate(database);
		store = new MobileDataStore(database);
		expect(
			await store.applyBootstrapPage(alice, "golf-bootstrap-page-2", {
				...page,
				records: [playerRecord, roundRecord, eventRecord],
				pageInfo: { nextCursor: null, hasMore: false },
			}),
		).toEqual({ completed: true, nextCursor: null });
		const golf = fixedGolfStore(database);
		expect((await golf.listScorecard(alice, rootEventId))[17]).toMatchObject({
			version: 1,
			stablefordPoints: 1,
			isPending: false,
		});
		expect((await golf.listRanking(alice, rootEventId))[0]).toMatchObject({
			userId: alice,
			stablefordPoints: 1,
			holesCompleted: 1,
		});
		expect(await database.all("PRAGMA foreign_key_check")).toEqual([]);
		database.close();
	});
});

class StaticSessionStore implements SessionStore {
	constructor(private session: Session | null) {}

	async get(): Promise<Session | null> {
		return this.session;
	}

	async compareAndSet(
		expected: Session | null,
		replacement: Session | null,
	): Promise<boolean> {
		if (
			this.session?.user.id !== expected?.user.id ||
			this.session?.accessToken !== expected?.accessToken ||
			this.session?.refreshToken !== expected?.refreshToken
		)
			return false;
		this.session = replacement;
		return true;
	}
}

function testGolfSyncEngine(
	database: SqlDatabase,
	fetchImplementation: (
		input: string | URL | Request,
		init?: RequestInit,
	) => Promise<Response>,
	options: {
		randomUUID?: () => string;
		sha256?: (value: string) => string | Promise<string>;
	} = {},
) {
	let requestNumber = 0;
	const client = new GatewayClient({
		baseUrl: "https://gateway.test",
		sessionStore: new StaticSessionStore({
			accessToken: "access-golf-secret",
			refreshToken: "refresh-golf-secret",
			tokenType: "Bearer",
			expiresInSeconds: 300,
			user: {
				id: alice,
				email: "golf@example.com",
				profile: {
					displayName: "Golf",
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
		}),
		fetch: fetchImplementation as typeof fetch,
		requestId: () => `request-golf-${String(++requestNumber).padStart(6, "0")}`,
		idempotencyKey: () => "unused-idempotency-key",
	});
	return new MobileSyncEngine(database, client, {
		activeAccountUserId: () => alice,
		now: () => new Date(now),
		random: () => 0.5,
		randomUUID: options.randomUUID ?? uuidSequence(),
		...(options.sha256 ? { sha256: options.sha256 } : {}),
	});
}

function golfIntent(clientIntentId: string) {
	return {
		accountUserId: alice,
		clientIntentId,
		rootEventId,
		eventId: rootEventId,
		hole: 18,
		strokes: 4,
		putts: 2,
		baseVersion: 0,
	};
}

function feedCreate(entityId: string, content: string) {
	return {
		kind: "feed.entry.create" as const,
		entityId,
		payload: {
			eventId: null,
			parentEntryId: null,
			kind: "message" as const,
			content,
		},
	};
}

function uuidSequence() {
	let value = 1;
	return () => `00000000-0000-4000-8000-${String(value++).padStart(12, "0")}`;
}

async function noFetch(): Promise<Response> {
	throw new Error("network must not run");
}

function gatewayJson(
	init: RequestInit | undefined,
	status: number,
	body: unknown,
) {
	const requestId = requiredTest(
		new Headers(init?.headers).get("x-request-id"),
	);
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			"X-Request-ID": requestId,
		},
	});
}

function requiredTest<Value>(value: Value | null | undefined): Value {
	if (value === null || value === undefined)
		throw new Error("required test value is missing");
	return value;
}

function fixedGolfStore(database: SqlDatabase) {
	return new GolfOfflineStore(database, () => new Date(now));
}

async function bootstrap(database: SqlDatabase, accountUserId: string) {
	const store = new MobileDataStore(database);
	await store.applyBootstrapPage(
		accountUserId,
		null,
		bootstrapPage(accountUserId, `snp_${accountUserId.slice(4, 12)}`, "1"),
	);
	return store;
}

function bootstrapPage(
	accountUserId: string,
	snapshotId: string,
	snapshotRevision: string,
): SyncBootstrapPage {
	const player = golfPlayer(accountUserId);
	const round = golfRound();
	const board = leaderboard(1, 0);
	return {
		protocolVersion: 1,
		rootEventId,
		authorizationScopeVersion: "1",
		snapshotId,
		snapshotRevision,
		records: [
			{
				entityType: "event",
				entityId: rootEventId,
				entityVersion: 1,
				data: {
					id: rootEventId,
					rootEventId,
					parentEventId: null,
					kind: "golf",
					title: "Mobile Stableford",
					description: null,
					timeZone: "Europe/Zurich",
					startsAt: null,
					endsAt: null,
					sortKey: "1",
					childOrderVersion: 1,
					itineraryOrderVersion: 1,
					status: "published",
					version: 1,
					createdAt: now,
					updatedAt: now,
					deletedAt: null,
				},
			},
			{
				entityType: "golfRound",
				entityId: rootEventId,
				entityVersion: round.version,
				data: round,
			},
			{
				entityType: "golfPlayer",
				entityId: `gpl_${rootEventId}:${accountUserId}`,
				entityVersion: player.version,
				data: player,
			},
			{
				entityType: "golfLeaderboard",
				entityId: `glb_${rootEventId}`,
				entityVersion: board.version,
				data: board,
			},
		],
		syncCursor: "cursor-bootstrap",
		pageInfo: { nextCursor: null, hasMore: false },
	};
}

function authorizedBootstrapPage(
	accountUserId: string,
	snapshotId: string,
	snapshotRevision: string,
	authorizationScopeVersion: string,
	role: "owner" | "organizer" | "participant" | "viewer",
	roster: SyncGolfRosterData | null,
): SyncBootstrapPage {
	const page = bootstrapPage(accountUserId, snapshotId, snapshotRevision);
	const rosterRecords: SyncBootstrapPage["records"] = roster
		? [
				{
					entityType: "golfRoster",
					entityId: `gro_${roster.eventId}`,
					entityVersion: roster.version,
					data: roster,
				},
			]
		: [];
	return {
		...page,
		authorizationScopeVersion,
		syncCursor: `cursor-${snapshotId}`,
		records: [
			...rosterRecords,
			...page.records.filter(({ entityType }) => entityType === "golfRound"),
			{
				entityType: "membership",
				entityId: accountUserId,
				entityVersion: 1,
				data: {
					rootEventId,
					userId: accountUserId,
					role,
					status: "active",
					version: 1,
					createdAt: now,
					updatedAt: now,
				},
			},
			...page.records.filter(({ entityType }) => entityType !== "golfRound"),
		],
	};
}

function golfRound(): SyncGolfRoundData {
	return {
		rootEventId,
		eventId: rootEventId,
		holes: Array.from({ length: 18 }, (_, index) => ({
			hole: index + 1,
			par: 4,
			strokeIndex: index + 1,
		})),
		teams: [
			{
				id: "gtm_mobile",
				name: "Mobile Flight",
				color: "#00AA55",
				memberUserIds: [alice, bob],
			},
		],
		version: 1,
		updatedAt: now,
	};
}

function golfRoster(
	version: number,
	players: SyncGolfRosterData["players"] = [
		{ userId: alice, playingHandicap: -2 },
		{ userId: bob, playingHandicap: 18 },
	],
): SyncGolfRosterData {
	return {
		rootEventId,
		eventId: rootEventId,
		players,
		version,
		updatedAt: now,
	};
}

function golfPlayer(accountUserId: string): SyncGolfPlayerData {
	return {
		rootEventId,
		eventId: rootEventId,
		userId: accountUserId,
		playingHandicap: accountUserId === alice ? -2 : 18,
		version: 1,
	};
}

function leaderboard(
	version: number,
	alicePoints: number,
): SyncGolfLeaderboardData {
	const values = [
		{ userId: alice, stablefordPoints: alicePoints },
		{ userId: bob, stablefordPoints: 0 },
	].sort(
		(left, right) =>
			right.stablefordPoints - left.stablefordPoints ||
			left.userId.localeCompare(right.userId),
	);
	let prior: number | null = null;
	let rank = 0;
	return {
		rootEventId,
		eventId: rootEventId,
		version,
		entries: values.map((entry, index) => {
			if (entry.stablefordPoints !== prior) rank = index + 1;
			prior = entry.stablefordPoints;
			return {
				...entry,
				rank,
				teamId: "gtm_mobile",
				holesCompleted: entry.stablefordPoints > 0 ? 1 : 0,
			};
		}),
	};
}

function golfScore(
	version: number,
	strokes: number | null,
	stablefordPoints: number,
	rootRevision: string,
): SyncGolfScoreData {
	return {
		id: golfScoreEntityId(rootEventId, alice, 18),
		rootEventId,
		eventId: rootEventId,
		userId: alice,
		hole: 18,
		strokes,
		putts: strokes === null ? null : 2,
		playingHandicap: -2,
		handicapStrokes: -1,
		netStrokes: strokes === null ? null : strokes + 1,
		stablefordPoints,
		version,
		rootRevision,
		createdAt: now,
		updatedAt: now,
	};
}

function scoreUpsert(
	rootRevision: string,
	ordinal: number,
	data: SyncGolfScoreData,
): SyncPullPage["changes"][number] {
	return {
		rootRevision,
		ordinal,
		entityType: "golfScore",
		entityId: data.id,
		operation: "upsert" as const,
		entityVersion: data.version,
		data,
	};
}

function playerUpsert(
	rootRevision: string,
	ordinal: number,
	data: SyncGolfPlayerData,
): SyncPullPage["changes"][number] {
	return {
		rootRevision,
		ordinal,
		entityType: "golfPlayer",
		entityId: `gpl_${data.eventId}:${data.userId}`,
		operation: "upsert",
		entityVersion: data.version,
		data,
	};
}

function playerTombstone(
	rootRevision: string,
	ordinal: number,
	userId: string,
	version: number,
): SyncPullPage["changes"][number] {
	const entityId = `gpl_${rootEventId}:${userId}`;
	return {
		rootRevision,
		ordinal,
		entityType: "golfPlayer",
		entityId,
		operation: "tombstone",
		entityVersion: version,
		tombstone: {
			entityType: "golfPlayer",
			id: entityId,
			rootEventId,
			eventId: rootEventId,
			version,
			deletedAt: now,
		},
	};
}

function leaderboardUpsert(
	rootRevision: string,
	ordinal: number,
	data: SyncGolfLeaderboardData,
): SyncPullPage["changes"][number] {
	return {
		rootRevision,
		ordinal,
		entityType: "golfLeaderboard",
		entityId: `glb_${rootEventId}`,
		operation: "upsert",
		entityVersion: data.version,
		data,
	};
}

function rosterUpsert(
	rootRevision: string,
	ordinal: number,
	data: SyncGolfRosterData,
): SyncPullPage["changes"][number] {
	return {
		rootRevision,
		ordinal,
		entityType: "golfRoster",
		entityId: `gro_${data.eventId}`,
		operation: "upsert",
		entityVersion: data.version,
		data,
	};
}

function pullPage(
	checkpointCursor: string,
	changes: SyncPullPage["changes"],
): SyncPullPage {
	return {
		protocolVersion: 1,
		rootEventId,
		authorizationScopeVersion: "1",
		changes,
		checkpointCursor,
		pageInfo: { nextCursor: null, hasMore: false },
	};
}
