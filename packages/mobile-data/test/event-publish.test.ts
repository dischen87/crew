import { Database } from "bun:sqlite";
import { describe, expect, mock, test } from "bun:test";
import {
	GatewayClientError,
	type GatewaySessionSubject,
} from "@crew/mobile-client";
import {
	EventPublishAccountChangedError,
	EventPublishBusyError,
	EventPublishConflictError,
	EventPublishController,
	EventPublishManagerRequiredError,
	EventPublishNotReadyError,
	EventPublishOnlineRequiredError,
	type EventPublishReadiness,
	EventPublishRootAccessDeniedError,
	EventPublishSyncRequiredError,
	MobileSyncEngine,
	MobileSyncPublicationInProgressError,
	migrate,
	type SqlDatabase,
	type SqlExecutor,
	type SqlValue,
	type SyncMutationDraft,
	type SyncStatus,
} from "../src/index.ts";

const accountA = `usr_${"1".repeat(32)}`;
const accountB = `usr_${"2".repeat(32)}`;
const rootEventId = "evt_publish_mobile";
const deviceId = "dvc_00000000-0000-4000-8000-000000000001";
const now = "2026-07-19T12:00:00.000Z";

class BunDatabase implements SqlDatabase {
	readonly sqlite = new Database(":memory:", { create: true });
	failGuardRelease = false;

	async exec(sql: string): Promise<void> {
		this.sqlite.exec(sql);
	}

	async run(sql: string, parameters: readonly SqlValue[] = []): Promise<void> {
		if (
			this.failGuardRelease &&
			sql.includes("DELETE FROM event_publish_guards") &&
			sql.includes("lease_owner = ?")
		) {
			throw new Error("simulated guard cleanup failure");
		}
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
}

describe("authoritative event publish review", () => {
	test("keeps only manager readiness in the account/root cache for offline reading", async () => {
		const database = await seededDatabase(accountA, "organizer");
		await seedRoot(database, accountB, "owner");
		const client = fakeClient();
		client.requestAsUser.mockResolvedValueOnce({
			data: blockedReadiness(),
			requestId: "readiness-a",
			status: 200,
		});
		const controller = eventPublishController(database, client);

		const refreshed = await controller.refresh(rootEventId);
		expect(refreshed).toMatchObject({
			eventTitle: "Crew Retreat",
			planItemCount: 0,
			planItems: [],
			role: "organizer",
			readiness: { ready: false, rootRevision: "7", rootVersion: 3 },
		});
		expect(
			await eventPublishController(database, fakeClient()).getCached(
				rootEventId,
			),
		).toMatchObject({ refreshedAt: now, role: "organizer" });

		const accountBClient = fakeClient(accountB);
		expect(
			await eventPublishController(database, accountBClient).getCached(
				rootEventId,
			),
		).toBeNull();

		await database.run(
			`UPDATE memberships SET role = 'participant'
WHERE account_user_id = ? AND root_event_id = ? AND member_user_id = ?`,
			[accountA, rootEventId, accountA],
		);
		await expect(controller.getCached(rootEventId)).rejects.toBeInstanceOf(
			EventPublishManagerRequiredError,
		);
		expect(
			await database.first(
				"SELECT 1 FROM event_publish_readiness_cache WHERE account_user_id = ?",
				[accountA],
			),
		).toBeNull();
	});

	test("never queues an offline publish and never bypasses unresolved outbox work", async () => {
		const database = await seededDatabase(accountA, "owner");
		const client = fakeClient();
		const offline = eventPublishController(
			database,
			client,
			fakeSync(synced()),
			false,
		);
		await expect(offline.refresh(rootEventId)).rejects.toBeInstanceOf(
			EventPublishOnlineRequiredError,
		);
		await expect(offline.publish(rootEventId)).rejects.toBeInstanceOf(
			EventPublishOnlineRequiredError,
		);
		expect(client.requestAsUser).not.toHaveBeenCalled();

		const pending = syncStatus("pending", 1, 0);
		const sync = fakeSync(pending);
		const online = eventPublishController(database, client, sync);
		await expect(online.publish(rootEventId)).rejects.toBeInstanceOf(
			EventPublishSyncRequiredError,
		);
		expect(sync.syncRoot).toHaveBeenCalledWith(accountA, rootEventId, {
			force: true,
		});
		expect(client.requestAsUser).not.toHaveBeenCalled();
		expect(
			await database.first(
				"SELECT 1 FROM event_publish_attempts WHERE account_user_id = ?",
				[accountA],
			),
		).toBeNull();
	});

	test("refreshes readiness after sync and publishes once with a stable durable key", async () => {
		const database = await seededDatabase(accountA, "owner");
		const client = fakeClient();
		const seenKeys: string[] = [];
		client.requestAsUser.mockImplementation(
			async (_subject, operation, input) => {
				if (operation === "eventPublishReadinessGet") {
					return { data: readyReadiness(), requestId: "ready", status: 200 };
				}
				seenKeys.push(requiredHeader(input));
				return {
					data: { event: publishedEvent() },
					requestId: "published",
					status: 200,
				};
			},
		);
		const sync = fakeSync(synced());
		let keys = 0;
		const controller = new EventPublishController(
			database,
			client as never,
			sync,
			{
				idempotencyKey: () => `publish-command-${++keys}-stable`,
				now: () => new Date(now),
			},
		);

		await expect(controller.publish(rootEventId)).resolves.toMatchObject({
			event: { id: rootEventId, status: "published" },
			refreshPending: false,
			syncStatus: { state: "synced" },
		});
		expect(seenKeys).toEqual(["publish-command-2-stable"]);
		expect(sync.syncRoot).toHaveBeenCalledTimes(2);
		expect(sync.getStatus).toHaveBeenCalledWith(accountA, rootEventId);
		expect(
			await database.first(
				"SELECT 1 FROM event_publish_attempts WHERE account_user_id = ?",
				[accountA],
			),
		).toBeNull();
	});

	test("returns confirmed publication when the follow-up refresh fails", async () => {
		const database = await seededDatabase(accountA, "owner");
		const client = fakeClient();
		client.requestAsUser.mockImplementation(async (_subject, operation) => {
			if (operation === "eventPublishReadinessGet") {
				return { data: readyReadiness(), requestId: "ready", status: 200 };
			}
			return {
				data: { event: publishedEvent() },
				requestId: "published",
				status: 200,
			};
		});
		let syncCalls = 0;
		let statusCalls = 0;
		const localStatus = syncStatus("pending", 0, 0);
		const sync = {
			getStatus: mock(async () => {
				statusCalls += 1;
				return statusCalls === 1 ? synced() : localStatus;
			}),
			syncRoot: mock(async () => {
				syncCalls += 1;
				if (syncCalls === 1) return synced();
				throw gatewayError("eventsPublish", null, "timeout");
			}),
		};
		const controller = eventPublishController(database, client, sync);

		await expect(controller.publish(rootEventId)).resolves.toMatchObject({
			event: { id: rootEventId, status: "published" },
			refreshPending: true,
			syncStatus: { state: "pending" },
		});
		expect(sync.syncRoot).toHaveBeenCalledTimes(2);
		expect(sync.getStatus).toHaveBeenCalledWith(accountA, rootEventId);
		expect(
			await database.first(
				"SELECT 1 FROM event_publish_attempts WHERE account_user_id = ?",
				[accountA],
			),
		).toBeNull();
	});

	test("does not replace a confirmed result when guard cleanup fails", async () => {
		const database = await seededDatabase(accountA, "owner");
		const client = fakeClient();
		client.requestAsUser.mockImplementation(async (_subject, operation) => {
			if (operation === "eventPublishReadinessGet") {
				return { data: readyReadiness(), requestId: "ready", status: 200 };
			}
			return {
				data: { event: publishedEvent() },
				requestId: "published",
				status: 200,
			};
		});
		database.failGuardRelease = true;

		await expect(
			eventPublishController(database, client).publish(rootEventId),
		).resolves.toMatchObject({
			event: { status: "published" },
			refreshPending: false,
		});
		expect(
			await database.first(
				"SELECT 1 FROM event_publish_guards WHERE account_user_id = ?",
				[accountA],
			),
		).not.toBeNull();
	});

	test("replays the persisted command first after a committed response is lost", async () => {
		const database = await seededDatabase(accountA, "owner");
		const firstClient = fakeClient();
		const sent: Array<{ body: unknown; key: string }> = [];
		firstClient.requestAsUser.mockImplementation(
			async (_subject, operation, input) => {
				if (operation === "eventPublishReadinessGet") {
					return { data: readyReadiness(), requestId: "ready", status: 200 };
				}
				sent.push({ body: input.body, key: requiredHeader(input) });
				throw gatewayError("eventsPublish", null, "timeout");
			},
		);
		await expect(
			eventPublishController(database, firstClient).publish(rootEventId),
		).rejects.toMatchObject({ code: "timeout" });

		const persisted = await database.first<{
			attempted_readiness_json: string;
			idempotency_key: string;
		}>(
			`SELECT attempted_readiness_json, idempotency_key
FROM event_publish_attempts WHERE account_user_id = ? AND root_event_id = ?`,
			[accountA, rootEventId],
		);
		expect(persisted?.idempotency_key).toBe("publish-command-2-stable");

		const engine = mutationEngine(database);
		await expect(
			engine.enqueueMutation(
				accountA,
				rootEventId,
				deviceId,
				eventTitleMutation("Must wait"),
				{ eventId: rootEventId, title: "Must wait" },
			),
		).rejects.toBeInstanceOf(MobileSyncPublicationInProgressError);

		const retryClient = fakeClient();
		retryClient.requestAsUser.mockImplementation(
			async (_subject, operation, input) => {
				if (operation === "eventPublishReadinessGet") {
					throw new Error("Retry read readiness before replaying the command");
				}
				sent.push({ body: input.body, key: requiredHeader(input) });
				return {
					data: { event: publishedEvent() },
					requestId: "replayed",
					status: 200,
				};
			},
		);
		const retrySync = fakeSync(synced());
		await expect(
			eventPublishController(database, retryClient, retrySync).publish(
				rootEventId,
			),
		).resolves.toMatchObject({
			event: { status: "published" },
			refreshPending: false,
		});
		expect(sent).toEqual([
			{
				body: { baseRevision: "7", baseVersion: 3 },
				key: "publish-command-2-stable",
			},
			{
				body: { baseRevision: "7", baseVersion: 3 },
				key: "publish-command-2-stable",
			},
		]);
		expect(retrySync.syncRoot).toHaveBeenCalledTimes(1);
		expect(retrySync.getStatus).not.toHaveBeenCalled();
	});

	test("blocks enqueue during publish and aborts if the guard is lost before the command", async () => {
		const database = await seededDatabase(accountA, "owner");
		const client = fakeClient();
		client.requestAsUser.mockImplementation(async (_subject, operation) => {
			if (operation === "eventPublishReadinessGet") {
				return { data: readyReadiness(), requestId: "ready", status: 200 };
			}
			throw new Error("Publish must not be sent after losing its guard");
		});
		const status = deferred<SyncStatus>();
		const statusStarted = deferred<void>();
		const sync = {
			getStatus: mock(async () => {
				statusStarted.resolve();
				return status.promise;
			}),
			syncRoot: mock(async () => synced()),
		};
		const publication = eventPublishController(database, client, sync).publish(
			rootEventId,
		);
		await statusStarted.promise;

		const engine = mutationEngine(database);
		await expect(
			engine.enqueueMutation(
				accountA,
				rootEventId,
				deviceId,
				eventTitleMutation("Blocked while publishing"),
				{ eventId: rootEventId },
			),
		).rejects.toBeInstanceOf(MobileSyncPublicationInProgressError);

		await database.run(
			`UPDATE event_publish_guards SET expires_at = '2026-01-01T00:00:00.000Z'
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountA, rootEventId],
		);
		await engine.enqueueMutation(
			accountA,
			rootEventId,
			deviceId,
			eventTitleMutation("Won the transaction"),
			{ eventId: rootEventId },
		);
		status.resolve(synced());

		await expect(publication).rejects.toBeInstanceOf(EventPublishBusyError);
		expect(
			client.requestAsUser.mock.calls.filter(
				(call) => call[1] === "eventsPublish",
			),
		).toHaveLength(0);
	});

	test("retains attempted and refetched server truth after a version conflict", async () => {
		const database = await seededDatabase(accountA, "organizer");
		const client = fakeClient();
		const responses = [readyReadiness(), readyReadiness({ rootRevision: "8" })];
		client.requestAsUser.mockImplementation(async (_subject, operation) => {
			if (operation === "eventPublishReadinessGet") {
				const readiness = responses.shift();
				if (!readiness) throw new Error("Unexpected readiness request");
				return { data: readiness, requestId: "readiness", status: 200 };
			}
			throw gatewayError("eventsPublish", 409, "ROOT_REVISION_CONFLICT");
		});
		const controller = eventPublishController(database, client);

		let conflict: EventPublishConflictError | null = null;
		try {
			await controller.publish(rootEventId);
		} catch (error) {
			if (error instanceof EventPublishConflictError) conflict = error;
			else throw error;
		}
		expect(conflict?.conflict.attempted.rootRevision).toBe("7");
		expect(conflict?.conflict.current.rootRevision).toBe("8");

		const restarted = eventPublishController(database, fakeClient());
		expect(await restarted.getCached(rootEventId)).toMatchObject({
			conflict: {
				attempted: { rootRevision: "7" },
				current: { rootRevision: "8" },
			},
			readiness: { rootRevision: "8" },
		});
		expect(
			await database.first<{ idempotency_key: string }>(
				"SELECT idempotency_key FROM event_publish_attempts WHERE account_user_id = ?",
				[accountA],
			),
		).toEqual({ idempotency_key: "publish-command-2-stable" });
		await restarted.acknowledgeConflict(rootEventId);
		expect((await restarted.getCached(rootEventId))?.conflict).toBeNull();
	});

	test("never sends a not-ready snapshot and purges authoritative 403/404 reads safely", async () => {
		const database = await seededDatabase(accountA, "owner");
		const client = fakeClient();
		client.requestAsUser.mockResolvedValueOnce({
			data: blockedReadiness(),
			requestId: "blocked",
			status: 200,
		});
		const controller = eventPublishController(database, client);
		await expect(controller.publish(rootEventId)).rejects.toBeInstanceOf(
			EventPublishNotReadyError,
		);
		expect(
			client.requestAsUser.mock.calls.filter(
				(call) => call[1] === "eventsPublish",
			),
		).toHaveLength(0);

		client.requestAsUser.mockRejectedValueOnce(
			gatewayError("eventPublishReadinessGet", 403, "FORBIDDEN"),
		);
		await expect(controller.refresh(rootEventId)).rejects.toBeInstanceOf(
			EventPublishManagerRequiredError,
		);
		expect(
			await database.first(
				"SELECT 1 FROM event_publish_readiness_cache WHERE account_user_id = ?",
				[accountA],
			),
		).toBeNull();

		client.requestAsUser.mockRejectedValueOnce(
			gatewayError("eventPublishReadinessGet", 404, "NOT_FOUND"),
		);
		await expect(controller.refresh(rootEventId)).rejects.toBeInstanceOf(
			EventPublishRootAccessDeniedError,
		);
		expect(
			await database.first(
				"SELECT 1 FROM root_sync_state WHERE account_user_id = ? AND root_event_id = ?",
				[accountA, rootEventId],
			),
		).toBeNull();
	});

	test("drops a stale network result when the authenticated account changes", async () => {
		const database = await seededDatabase(accountA, "owner");
		let activeAccount = accountA;
		const client = fakeClient(accountA, () => activeAccount);
		client.requestAsUser.mockImplementationOnce(async () => {
			activeAccount = accountB;
			return { data: readyReadiness(), requestId: "stale", status: 200 };
		});
		const controller = eventPublishController(database, client);

		await expect(controller.refresh(rootEventId)).rejects.toBeInstanceOf(
			EventPublishAccountChangedError,
		);
		expect(
			await database.first(
				"SELECT 1 FROM event_publish_readiness_cache WHERE account_user_id = ?",
				[accountA],
			),
		).toBeNull();
	});
});

async function seededDatabase(
	accountUserId: string,
	role: "owner" | "organizer" | "participant" | "viewer",
) {
	const database = new BunDatabase();
	await migrate(database);
	await seedRoot(database, accountUserId, role);
	return database;
}

async function seedRoot(
	database: SqlDatabase,
	accountUserId: string,
	role: "owner" | "organizer" | "participant" | "viewer",
) {
	await database.run(
		`INSERT INTO root_sync_state (
  account_user_id, root_event_id, pull_cursor, snapshot_id,
  snapshot_revision, authorization_scope_version, last_completed_sync_at
) VALUES (?, ?, 'cursor-publish', 'snapshot-publish', '7', '1', ?)`,
		[accountUserId, rootEventId, now],
	);
	await database.run(
		`INSERT INTO events (
  account_user_id, id, root_event_id, parent_event_id, kind, title, description,
  time_zone, starts_at, ends_at, sort_key, child_order_version,
  itinerary_order_version, status, version, created_at, updated_at, deleted_at
) VALUES (?, ?, ?, NULL, 'team_event', 'Crew Retreat', 'Ready together',
  'Europe/Zurich', '2026-09-20T08:00:00.000Z', '2026-09-21T17:00:00.000Z',
  '1', '1', '1', 'draft', 3, ?, ?, NULL)`,
		[accountUserId, rootEventId, rootEventId, now, now],
	);
	await database.run(
		`INSERT INTO memberships (
  account_user_id, root_event_id, member_user_id, role, status,
  version, created_at, updated_at
) VALUES (?, ?, ?, ?, 'active', 1, ?, ?)`,
		[accountUserId, rootEventId, accountUserId, role, now, now],
	);
}

function eventPublishController(
	database: SqlDatabase,
	client: ReturnType<typeof fakeClient>,
	sync: ReturnType<typeof fakeSync> = fakeSync(synced()),
	online = true,
) {
	let keys = 0;
	return new EventPublishController(database, client as never, sync, {
		idempotencyKey: () => `publish-command-${++keys}-stable`,
		isOnline: () => online,
		now: () => new Date(now),
	});
}

function fakeClient(
	accountUserId = accountA,
	activeAccount: () => string | null = () => accountUserId,
) {
	const subject = Object.freeze({
		userId: accountUserId,
	}) as GatewaySessionSubject;
	return {
		assertSessionSubject: mock(async (candidate: GatewaySessionSubject) => {
			if (candidate !== subject || activeAccount() !== candidate.userId) {
				throw gatewayError("usersSessionGet", null, "session_changed");
			}
		}),
		requestAsUser: mock(
			async (
				_subject: GatewaySessionSubject,
				_operation: string,
				_input: {
					body?: unknown;
					headers?: Record<string, string | undefined>;
					path?: { rootEventId: string };
				},
			): Promise<{ data: unknown; requestId: string; status: number }> => {
				throw new Error("Unexpected event publish request");
			},
		),
		sessionSubject: mock(async () =>
			activeAccount() === accountUserId ? subject : null,
		),
	};
}

function fakeSync(status: SyncStatus) {
	return {
		getStatus: mock(async () => status),
		syncRoot: mock(async () => status),
	};
}

function mutationEngine(database: SqlDatabase) {
	let uuid = 0;
	return new MobileSyncEngine(
		database,
		{
			request: mock(async () => {
				throw new Error("Unexpected sync request");
			}),
		} as never,
		{
			activeAccountUserId: () => accountA,
			now: () => new Date(now),
			randomUUID: () =>
				`00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
			sha256: () => "a".repeat(64),
		},
	);
}

function eventTitleMutation(title: string): SyncMutationDraft {
	return {
		kind: "event.update",
		entityId: rootEventId,
		baseVersion: 3,
		payload: { changes: { title } },
	};
}

function requiredHeader(input: {
	headers?: Record<string, string | undefined>;
}): string {
	const key = input.headers?.["idempotency-key"];
	if (!key) throw new Error("Missing idempotency key");
	return key;
}

function deferred<Value>() {
	let resolvePromise!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: resolvePromise };
}

function synced() {
	return syncStatus("synced", 0, 0);
}

function syncStatus(
	state: SyncStatus["state"],
	pendingCount: number,
	attentionCount: number,
): SyncStatus {
	return {
		attentionCount,
		nextAttemptAt: null,
		pendingCount,
		state,
		summary: state,
	};
}

function readyReadiness(
	overrides: Partial<EventPublishReadiness> = {},
): EventPublishReadiness {
	return {
		ready: true,
		reasons: [],
		rootEventId,
		rootRevision: "7",
		rootVersion: 3,
		schemaVersion: 1,
		template: { id: "team-event", version: 1 },
		...overrides,
	};
}

function blockedReadiness(): EventPublishReadiness {
	return {
		...readyReadiness(),
		ready: false,
		reasons: [
			{
				code: "EVENT_DESCRIPTION_REQUIRED",
				message: "Add an event description before publishing.",
				path: "description",
			},
		],
	};
}

function publishedEvent() {
	return {
		childOrderVersion: 1,
		createdAt: now,
		description: "Ready together",
		endsAt: "2026-09-21T17:00:00.000Z",
		id: rootEventId,
		itineraryOrderVersion: 1,
		kind: "team_event" as const,
		parentEventId: null,
		rootEventId,
		sortKey: "1",
		startsAt: "2026-09-20T08:00:00.000Z",
		status: "published" as const,
		timeZone: "Europe/Zurich",
		title: "Crew Retreat",
		updatedAt: now,
		version: 4,
	};
}

function gatewayError(
	operationId: "eventPublishReadinessGet" | "eventsPublish" | "usersSessionGet",
	status: number | null,
	code: string,
) {
	return new GatewayClientError({
		code: code as never,
		operationId,
		requestId: "request-error-0001",
		retryable: false,
		retryAfterSeconds: null,
		status,
	});
}
