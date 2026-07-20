import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GatewayClient } from "@crew/mobile-client";
import {
	MobileSyncEngine,
	migrate,
	type OutboxState,
	type SqlDatabase,
	type SqlExecutor,
	type SqlValue,
	sha256Hex,
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

	close(): void {
		this.sqlite.close();
	}
}

const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0)) {
		rmSync(directory, { force: true, recursive: true });
	}
});

const accountA = "usr_00000000000000000000000000000001";
const accountB = "usr_00000000000000000000000000000002";
const rootA = "evt_evidence_a";
const rootB = "evt_evidence_b";
const deviceId = "dvc_00000000-0000-4000-8000-000000000001";
const now = "2026-07-19T12:00:00.000Z";

describe("read-only outbox evidence", () => {
	test("keeps exact fingerprints stable across restart and changes them only with persisted bytes or key", async () => {
		const directory = mkdtempSync(join(tmpdir(), "crew-outbox-evidence-"));
		directories.push(directory);
		const path = join(directory, "mobile.sqlite");
		let database = new BunDatabase(path);
		await migrate(database);
		await seedScope(database, accountA, rootA, "cursor-private-alpha");
		const first = await insertMutation(database, accountA, rootA, 1, {
			kind: "golf.score.set",
			entityId: "gsc_evidence_1",
			baseVersion: 0,
			payload: { hole: 1, strokes: 4, putts: 2 },
		});
		const second = await insertMutation(database, accountA, rootA, 2, {
			kind: "feed.entry.create",
			entityId: "fed_evidence_2",
			payload: { content: "private command body" },
		});
		await insertBatch(
			database,
			accountA,
			rootA,
			[first, second],
			"sync-key-one",
		);

		const beforeRestart = await engine(database, accountA).readOutboxEvidence(
			accountA,
			rootA,
		);
		expect(beforeRestart).toMatchObject({
			pendingCount: 2,
			attentionCount: 0,
			pullCursorFingerprint: await sha256Hex("cursor-private-alpha"),
			truncated: false,
		});
		expect(beforeRestart.rows.map((row) => row.mutationKind)).toEqual([
			"golf.score.set",
			"feed.entry.create",
		]);
		expect(beforeRestart.rows.map((row) => row.clientSequence)).toEqual([1, 2]);
		expect(beforeRestart.rows[0]?.commandBodyFingerprint).toBe(
			await sha256Hex(JSON.stringify(first.command)),
		);
		expect(beforeRestart.rows[0]?.commandBodyFingerprint).not.toBe(
			beforeRestart.rows[1]?.commandBodyFingerprint,
		);
		expect(beforeRestart.rows[0]?.requestBodyFingerprint).toBe(
			beforeRestart.rows[1]?.requestBodyFingerprint,
		);
		expect(beforeRestart.rows[0]?.idempotencyKeyFingerprint).toBe(
			await sha256Hex("sync-key-one"),
		);

		database.close();
		database = new BunDatabase(path);
		const afterRestart = await engine(database, accountA).readOutboxEvidence(
			accountA,
			rootA,
		);
		expect(afterRestart).toEqual(beforeRestart);

		await database.run(
			"UPDATE sync_push_batches SET idempotency_key = ? WHERE account_user_id = ? AND root_event_id = ?",
			["sync-key-two", accountA, rootA],
		);
		const changedKey = await engine(database, accountA).readOutboxEvidence(
			accountA,
			rootA,
		);
		expect(changedKey.rows[0]?.commandBodyFingerprint).toBe(
			afterRestart.rows[0]?.commandBodyFingerprint,
		);
		expect(changedKey.rows[0]?.requestBodyFingerprint).toBe(
			afterRestart.rows[0]?.requestBodyFingerprint,
		);
		expect(changedKey.rows[0]?.idempotencyKeyFingerprint).toBe(
			await sha256Hex("sync-key-two"),
		);

		const changedBody = JSON.stringify({ changed: true });
		await database.run(
			"UPDATE sync_push_batches SET body_json = ?, body_fingerprint = ? WHERE account_user_id = ? AND root_event_id = ?",
			[changedBody, await sha256Hex(changedBody), accountA, rootA],
		);
		const changedRequest = await engine(database, accountA).readOutboxEvidence(
			accountA,
			rootA,
		);
		expect(changedRequest.rows[0]?.commandBodyFingerprint).toBe(
			changedKey.rows[0]?.commandBodyFingerprint,
		);
		expect(changedRequest.rows[0]?.requestBodyFingerprint).not.toBe(
			changedKey.rows[0]?.requestBodyFingerprint,
		);
		database.close();
	});

	test("isolates account and root, orders deterministically, and caps rows", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedScope(database, accountA, rootA, null);
		await seedScope(database, accountA, rootB, null);
		await seedScope(database, accountB, rootA, null);
		for (let sequence = 102; sequence >= 1; sequence -= 1) {
			await insertMutation(
				database,
				accountA,
				rootA,
				sequence,
				{
					kind: "feed.entry.create",
					entityId: `fed_${sequence}`,
					payload: { content: `body-${sequence}` },
				},
				sequence > 100 ? "dead_letter" : "pending",
			);
		}
		await insertMutation(database, accountA, rootB, 103, {
			kind: "feed.entry.create",
			entityId: "fed_foreign_root",
			payload: {},
		});
		await insertMutation(database, accountB, rootA, 1, {
			kind: "feed.entry.create",
			entityId: "fed_foreign_account",
			payload: {},
		});

		const evidence = await engine(database, accountA).readOutboxEvidence(
			accountA,
			rootA,
		);
		expect(evidence).toMatchObject({
			pendingCount: 100,
			attentionCount: 2,
			truncated: true,
		});
		expect(evidence.rows).toHaveLength(100);
		expect(evidence.rows[0]?.clientSequence).toBe(1);
		expect(evidence.rows[99]?.clientSequence).toBe(100);
		expect(
			(await engine(database, accountA).readOutboxEvidence(accountA, rootB))
				.pendingCount,
		).toBe(1);
		expect(
			(await engine(database, accountB).readOutboxEvidence(accountB, rootA))
				.pendingCount,
		).toBe(1);
		database.close();
	});

	test("rejects invalid scope before reads and performs no writes or secret disclosure", async () => {
		const database = new BunDatabase();
		await migrate(database);
		await seedScope(database, accountA, rootA, "raw-cursor-secret");
		const mutation = await insertMutation(database, accountA, rootA, 1, {
			kind: "feed.entry.create",
			entityId: "fed_private",
			payload: { content: "raw-body-secret" },
		});
		await insertBatch(database, accountA, rootA, [mutation], "raw-key-secret");
		let reads = 0;
		let writes = 0;
		const readOnly: SqlDatabase = {
			all: async <Row>(sql: string, parameters?: readonly SqlValue[]) => {
				reads += 1;
				return database.all<Row>(sql, parameters);
			},
			first: async <Row>(sql: string, parameters?: readonly SqlValue[]) => {
				reads += 1;
				return database.first<Row>(sql, parameters);
			},
			exec: async () => {
				writes += 1;
				throw new Error("write attempted");
			},
			run: async () => {
				writes += 1;
				throw new Error("write attempted");
			},
			transaction: async () => {
				writes += 1;
				throw new Error("write attempted");
			},
		};
		const oracle = engine(readOnly, accountA);
		await expect(oracle.readOutboxEvidence("invalid", rootA)).rejects.toThrow(
			"Invalid account user ID",
		);
		await expect(
			oracle.readOutboxEvidence(accountA, "invalid"),
		).rejects.toThrow("Invalid root event ID");
		expect(reads).toBe(0);

		const evidence = await oracle.readOutboxEvidence(accountA, rootA);
		expect(reads).toBe(4);
		expect(writes).toBe(0);
		const sanitized = JSON.stringify(evidence);
		for (const secret of [
			"raw-cursor-secret",
			"raw-key-secret",
			"raw-body-secret",
			mutation.clientMutationId,
			deviceId,
		]) {
			expect(sanitized).not.toContain(secret);
		}
		database.close();
	});
});

async function seedScope(
	database: SqlDatabase,
	accountUserId: string,
	rootEventId: string,
	pullCursor: string | null,
): Promise<void> {
	await database.run(
		`INSERT INTO root_sync_state (
  account_user_id, root_event_id, pull_cursor, authorization_scope_version
) VALUES (?, ?, ?, '1')`,
		[accountUserId, rootEventId, pullCursor],
	);
	await database.run(
		`INSERT INTO mutation_streams (
  account_user_id, root_event_id, device_id, next_client_sequence
) VALUES (?, ?, ?, 1000)`,
		[accountUserId, rootEventId, deviceId],
	);
}

async function insertMutation(
	database: SqlDatabase,
	accountUserId: string,
	rootEventId: string,
	clientSequence: number,
	command: Record<string, unknown>,
	state: OutboxState = "pending",
): Promise<{ clientMutationId: string; command: Record<string, unknown> }> {
	const clientMutationId = `00000000-0000-4000-8000-${String(clientSequence).padStart(12, "0")}`;
	const persisted = { ...command, clientMutationId, clientSequence };
	const commandJson = JSON.stringify(persisted);
	await database.run(
		`INSERT INTO mutation_outbox (
  account_user_id, client_mutation_id, root_event_id, device_id,
  client_sequence, operation_id, command_json, command_fingerprint,
  optimistic_overlay_json, state, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, 'syncMutationsApply', ?, ?, '{}', ?, ?, ?)`,
		[
			accountUserId,
			clientMutationId,
			rootEventId,
			deviceId,
			clientSequence,
			commandJson,
			await sha256Hex(commandJson),
			state,
			now,
			now,
		],
	);
	return { clientMutationId, command: persisted };
}

async function insertBatch(
	database: SqlDatabase,
	accountUserId: string,
	rootEventId: string,
	mutations: readonly {
		clientMutationId: string;
		command: Record<string, unknown>;
	}[],
	idempotencyKey: string,
): Promise<void> {
	const bodyJson = JSON.stringify({
		protocolVersion: 1,
		rootEventId,
		deviceId,
		mutations: mutations.map(({ command }) => command),
	});
	await database.run(
		`INSERT INTO sync_push_batches (
  account_user_id, root_event_id, device_id, idempotency_key, body_json,
  body_fingerprint, mutation_ids_json, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			accountUserId,
			rootEventId,
			deviceId,
			idempotencyKey,
			bodyJson,
			await sha256Hex(bodyJson),
			JSON.stringify(mutations.map(({ clientMutationId }) => clientMutationId)),
			now,
		],
	);
}

function engine(
	database: SqlDatabase,
	accountUserId: string,
): MobileSyncEngine {
	const request = (async () => {
		throw new Error("network must not run");
	}) as GatewayClient["request"];
	return new MobileSyncEngine(
		database,
		{ request },
		{
			activeAccountUserId: () => accountUserId,
			randomUUID: () => "00000000-0000-4000-8000-000000000999",
		},
	);
}
