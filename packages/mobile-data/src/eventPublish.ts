import {
	type GatewayClient,
	GatewayClientError,
	type GatewayResponseData,
	type GatewaySessionSubject,
} from "@crew/mobile-client";
import type { SqlDatabase, SqlExecutor } from "./database.ts";
import type { SyncStatus } from "./outbox.ts";
import { MobileDataStore } from "./store.ts";

export type EventPublishReadiness =
	GatewayResponseData<"eventPublishReadinessGet">;
export type EventPublishRole = "owner" | "organizer";
export type EventPublishResponse = GatewayResponseData<"eventsPublish">;

export interface EventPublishConflict {
	attempted: EventPublishReadiness;
	current: EventPublishReadiness;
	conflictedAt: string;
}

export interface EventPublishSnapshot {
	conflict: EventPublishConflict | null;
	eventTitle: string;
	localRootStatus: "archived" | "cancelled" | "draft" | "published";
	planItemCount: number;
	planItems: readonly EventPublishPreviewItem[];
	readiness: EventPublishReadiness;
	refreshedAt: string;
	role: EventPublishRole;
	schedule: {
		endsAt: string | null;
		startsAt: string | null;
		timeZone: string;
	};
}

export interface EventPublishPreviewItem {
	id: string;
	startsAt: string | null;
	title: string;
}

export interface EventPublishResult extends EventPublishResponse {
	refreshPending: boolean;
	syncStatus: SyncStatus | null;
}

export interface EventPublishControllerOptions {
	idempotencyKey(): string;
	isOnline?: () => boolean;
	now?: () => Date;
	onRootPurged?: (
		accountUserId: string,
		rootEventId: string,
	) => void | Promise<void>;
	onRootReadFinished?: (
		accountUserId: string,
		rootEventId: string,
		verificationId: string,
	) => void | Promise<void>;
	onRootReadStarted?: (
		accountUserId: string,
		rootEventId: string,
	) => string | Promise<string>;
}

type EventPublishGatewayClient = Pick<
	GatewayClient,
	"assertSessionSubject" | "requestAsUser" | "sessionSubject"
>;

export interface EventPublishSync {
	getStatus(accountUserId: string, rootEventId: string): Promise<SyncStatus>;
	syncRoot(
		accountUserId: string,
		rootEventId: string,
		options?: { force?: boolean },
	): Promise<SyncStatus>;
}

interface CacheRow {
	refreshed_at: string;
	snapshot_json: string;
}

interface AttemptRow {
	attempted_readiness_json: string;
	conflicted_at: string | null;
	fingerprint: string;
	idempotency_key: string;
}

interface RootContextRow {
	ends_at: string | null;
	plan_item_count: number;
	starts_at: string | null;
	status: string;
	time_zone: string;
	title: string;
}

interface PreviewItemRow {
	id: string;
	starts_at: string | null;
	title: string;
}

interface MembershipRow {
	role: string;
}

interface EventPublishQueues {
	remote: Map<string, Promise<void>>;
}

const queuesByDatabase = new WeakMap<SqlDatabase, EventPublishQueues>();
const accountPattern = /^usr_[a-f0-9]{32}$/;
const rootPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const revisionPattern = /^[1-9][0-9]*$/;
const publishGuardLeaseMs = 5 * 60_000;
const publishGuardRenewMs = 60_000;
const readinessCodes = new Set<
	EventPublishReadiness["reasons"][number]["code"]
>([
	"EVENT_TEMPLATE_REQUIRED",
	"EVENT_TITLE_REQUIRED",
	"EVENT_DESCRIPTION_REQUIRED",
	"EVENT_START_REQUIRED",
	"EVENT_END_REQUIRED",
	"EVENT_CAPABILITY_REQUIRED",
	"EVENT_CAPABILITY_PLACE_REQUIRED",
	"EVENT_STATUS_NOT_DRAFT",
]);

export class EventPublishAccountChangedError extends Error {
	constructor() {
		super("Active account changed during event publication");
		this.name = "EventPublishAccountChangedError";
	}
}

export class EventPublishManagerRequiredError extends Error {
	constructor() {
		super("Event publication requires an owner or organizer");
		this.name = "EventPublishManagerRequiredError";
	}
}

export class EventPublishOnlineRequiredError extends Error {
	constructor() {
		super("Event publication requires a connection");
		this.name = "EventPublishOnlineRequiredError";
	}
}

export class EventPublishRootAccessDeniedError extends Error {
	constructor() {
		super("This event publication is unavailable");
		this.name = "EventPublishRootAccessDeniedError";
	}
}

export class EventPublishUnavailableError extends Error {
	constructor() {
		super("Event publication is unavailable");
		this.name = "EventPublishUnavailableError";
	}
}

export class EventPublishBusyError extends Error {
	constructor() {
		super("Another event publication is already running");
		this.name = "EventPublishBusyError";
	}
}

export class EventPublishNotReadyError extends Error {
	constructor(readonly readiness: EventPublishReadiness) {
		super("The event is not ready to publish");
		this.name = "EventPublishNotReadyError";
	}
}

export class EventPublishSyncRequiredError extends Error {
	constructor(readonly syncStatus: SyncStatus) {
		super("Event changes must sync before publication");
		this.name = "EventPublishSyncRequiredError";
	}
}

export class EventPublishConflictError extends Error {
	constructor(readonly conflict: EventPublishConflict) {
		super("Event publication changed during review");
		this.name = "EventPublishConflictError";
	}
}

export class EventPublishController {
	readonly #idempotencyKey: () => string;
	readonly #isOnline: () => boolean;
	readonly #now: () => Date;
	readonly #onRootPurged: NonNullable<
		EventPublishControllerOptions["onRootPurged"]
	>;
	readonly #onRootReadFinished: EventPublishControllerOptions["onRootReadFinished"];
	readonly #onRootReadStarted: EventPublishControllerOptions["onRootReadStarted"];
	readonly #queues: Map<string, Promise<void>>;

	constructor(
		private readonly database: SqlDatabase,
		private readonly client: EventPublishGatewayClient,
		private readonly sync: EventPublishSync,
		options: EventPublishControllerOptions,
	) {
		this.#idempotencyKey = options.idempotencyKey;
		this.#isOnline = options.isOnline ?? (() => true);
		this.#now = options.now ?? (() => new Date());
		if (
			Boolean(options.onRootReadStarted) !== Boolean(options.onRootReadFinished)
		) {
			throw new Error("Root read verification hooks must be paired");
		}
		this.#onRootPurged = options.onRootPurged ?? (() => undefined);
		this.#onRootReadFinished = options.onRootReadFinished;
		this.#onRootReadStarted = options.onRootReadStarted;
		let queues = queuesByDatabase.get(database);
		if (!queues) {
			queues = { remote: new Map() };
			queuesByDatabase.set(database, queues);
		}
		this.#queues = queues.remote;
	}

	async getCached(rootEventId: string): Promise<EventPublishSnapshot | null> {
		return this.#runForRoot(rootEventId, async (subject, accountUserId) => {
			const role = await this.#managerRole(subject, accountUserId, rootEventId);
			const row = await this.database.first<CacheRow>(
				`SELECT snapshot_json, refreshed_at
FROM event_publish_readiness_cache
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, rootEventId],
			);
			await this.#assertSubject(subject);
			if (!row) return null;
			try {
				return await this.#snapshot(
					subject,
					accountUserId,
					rootEventId,
					role,
					parseReadiness(row.snapshot_json, rootEventId),
					row.refreshed_at,
				);
			} catch (error) {
				if (error instanceof EventPublishUnavailableError) {
					await this.#purgePublishState(accountUserId, rootEventId);
					return null;
				}
				throw error;
			}
		});
	}

	async refresh(rootEventId: string): Promise<EventPublishSnapshot> {
		this.#requireOnline();
		return this.#runForRoot(rootEventId, async (subject, accountUserId) => {
			const role = await this.#managerRole(subject, accountUserId, rootEventId);
			const cached = await this.#fetchAndCache(
				subject,
				accountUserId,
				rootEventId,
			);
			return this.#snapshot(
				subject,
				accountUserId,
				rootEventId,
				role,
				cached.readiness,
				cached.refreshedAt,
			);
		});
	}

	async acknowledgeConflict(rootEventId: string): Promise<void> {
		return this.#runForRoot(rootEventId, async (subject, accountUserId) => {
			await this.#managerRole(subject, accountUserId, rootEventId);
			await this.database.run(
				`DELETE FROM event_publish_attempts
WHERE account_user_id = ? AND root_event_id = ? AND conflicted_at IS NOT NULL`,
				[accountUserId, rootEventId],
			);
			await this.#assertSubject(subject);
		});
	}

	async publish(rootEventId: string): Promise<EventPublishResult> {
		this.#requireOnline();
		return this.#runForRoot(rootEventId, async (subject, accountUserId) => {
			await this.#managerRole(subject, accountUserId, rootEventId);
			return this.#withPublishGuard(
				subject,
				accountUserId,
				rootEventId,
				async (leaseOwner) => {
					const existing = await this.#readAttempt(
						subject,
						accountUserId,
						rootEventId,
					);
					if (existing) {
						const attempted = parseReadiness(
							existing.attempted_readiness_json,
							rootEventId,
						);
						const fingerprint = readinessFingerprint(attempted);
						if (
							existing.fingerprint !== fingerprint ||
							!idempotencyPattern.test(existing.idempotency_key)
						) {
							await this.#purgePublishState(accountUserId, rootEventId);
							throw new EventPublishUnavailableError();
						}
						if (existing.conflicted_at) {
							const current = await this.#cachedReadiness(
								accountUserId,
								rootEventId,
							);
							throw new EventPublishConflictError({
								attempted,
								conflictedAt: existing.conflicted_at,
								current,
							});
						}
						return this.#sendPublishAttempt(
							subject,
							accountUserId,
							rootEventId,
							attempted,
							fingerprint,
							existing.idempotency_key,
						);
					}

					const preflightStatus = await this.sync.syncRoot(
						accountUserId,
						rootEventId,
						{ force: true },
					);
					await this.#assertSubject(subject);
					this.#requireSynced(preflightStatus);

					const reviewed = await this.#fetchAndCache(
						subject,
						accountUserId,
						rootEventId,
					);
					if (!reviewed.readiness.ready) {
						throw new EventPublishNotReadyError(reviewed.readiness);
					}
					const latestStatus = await this.sync.getStatus(
						accountUserId,
						rootEventId,
					);
					await this.#assertSubject(subject);
					this.#requireSynced(latestStatus);

					const fingerprint = readinessFingerprint(reviewed.readiness);
					const idempotencyKey = await this.#commandKey(
						subject,
						accountUserId,
						rootEventId,
						leaseOwner,
						fingerprint,
						reviewed.readiness,
					);
					return this.#sendPublishAttempt(
						subject,
						accountUserId,
						rootEventId,
						reviewed.readiness,
						fingerprint,
						idempotencyKey,
					);
				},
			);
		});
	}

	async #sendPublishAttempt(
		subject: GatewaySessionSubject,
		accountUserId: string,
		rootEventId: string,
		attempted: EventPublishReadiness,
		fingerprint: string,
		idempotencyKey: string,
	): Promise<EventPublishResult> {
		try {
			const response = await this.client.requestAsUser(
				subject,
				"eventsPublish",
				{
					body: readinessBody(attempted),
					headers: { "idempotency-key": idempotencyKey },
					path: { rootEventId },
				},
			);
			await this.#assertSubject(subject);
			if (
				response.data.event.id !== rootEventId ||
				response.data.event.rootEventId !== rootEventId ||
				response.data.event.status !== "published"
			) {
				throw new EventPublishUnavailableError();
			}
			await this.#purgePublishState(accountUserId, rootEventId);
			let syncStatus: SyncStatus | null = null;
			let refreshPending = true;
			try {
				syncStatus = await this.sync.syncRoot(accountUserId, rootEventId, {
					force: true,
				});
				await this.#assertSubject(subject);
				refreshPending = !fullySynced(syncStatus);
			} catch {
				// Publication is already authoritative. A failed local refresh must not
				// turn the confirmed server result into a false publish failure.
				await this.#assertSubject(subject);
				try {
					syncStatus = await this.sync.getStatus(accountUserId, rootEventId);
					await this.#assertSubject(subject);
				} catch {
					await this.#assertSubject(subject);
					syncStatus = null;
				}
			}
			return { ...response.data, refreshPending, syncStatus };
		} catch (error) {
			if (error instanceof EventPublishUnavailableError) throw error;
			if (error instanceof GatewayClientError && error.status === 409) {
				const current = await this.#fetchAndCache(
					subject,
					accountUserId,
					rootEventId,
				);
				const conflictedAt = this.#timestamp();
				await this.database.run(
					`UPDATE event_publish_attempts SET conflicted_at = ?
WHERE account_user_id = ? AND root_event_id = ? AND fingerprint = ?`,
					[conflictedAt, accountUserId, rootEventId, fingerprint],
				);
				await this.#assertSubject(subject);
				throw new EventPublishConflictError({
					attempted,
					conflictedAt,
					current: current.readiness,
				});
			}
			await this.#handleAuthoritativeError(error, accountUserId, rootEventId);
			this.#rethrow(error);
		}
	}

	async #readAttempt(
		subject: GatewaySessionSubject,
		accountUserId: string,
		rootEventId: string,
	): Promise<AttemptRow | null> {
		const attempt = await this.database.first<AttemptRow>(
			`SELECT attempted_readiness_json, conflicted_at, fingerprint, idempotency_key
FROM event_publish_attempts
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
		await this.#assertSubject(subject);
		return attempt;
	}

	async #cachedReadiness(
		accountUserId: string,
		rootEventId: string,
	): Promise<EventPublishReadiness> {
		const row = await this.database.first<CacheRow>(
			`SELECT snapshot_json, refreshed_at
FROM event_publish_readiness_cache
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
		if (!row) throw new EventPublishUnavailableError();
		return parseReadiness(row.snapshot_json, rootEventId);
	}

	async #withPublishGuard<Result>(
		subject: GatewaySessionSubject,
		accountUserId: string,
		rootEventId: string,
		work: (leaseOwner: string) => Promise<Result>,
	): Promise<Result> {
		const leaseOwner = this.#idempotencyKey();
		if (!idempotencyPattern.test(leaseOwner)) {
			throw new TypeError("Invalid event publish guard ID");
		}
		const startedAt = this.#now();
		const expiresAt = new Date(
			startedAt.getTime() + publishGuardLeaseMs,
		).toISOString();
		await this.database.transaction(async (transaction) => {
			await this.#assertSubject(subject);
			await transaction.run(
				`DELETE FROM event_publish_guards
WHERE account_user_id = ? AND root_event_id = ? AND expires_at <= ?`,
				[accountUserId, rootEventId, startedAt.toISOString()],
			);
			await transaction.run(
				`INSERT INTO event_publish_guards (
  account_user_id, root_event_id, lease_owner, expires_at
) VALUES (?, ?, ?, ?)
ON CONFLICT (account_user_id, root_event_id) DO NOTHING`,
				[accountUserId, rootEventId, leaseOwner, expiresAt],
			);
			const acquired = await transaction.first<{ lease_owner: string }>(
				`SELECT lease_owner FROM event_publish_guards
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, rootEventId],
			);
			if (acquired?.lease_owner !== leaseOwner) {
				throw new EventPublishBusyError();
			}
			await this.#assertSubject(subject);
		});
		const heartbeat = setInterval(() => {
			void this.#renewPublishGuard(
				accountUserId,
				rootEventId,
				leaseOwner,
			).catch(() => {
				// The command transaction verifies ownership before persisting a
				// publish attempt, so a missed heartbeat cannot create a TOCTOU gap.
			});
		}, publishGuardRenewMs);
		try {
			return await work(leaseOwner);
		} finally {
			clearInterval(heartbeat);
			try {
				await this.database.run(
					`DELETE FROM event_publish_guards
WHERE account_user_id = ? AND root_event_id = ? AND lease_owner = ?`,
					[accountUserId, rootEventId, leaseOwner],
				);
			} catch {
				// A stale lease expires. Cleanup must never replace the publication
				// result or the original command error.
			}
		}
	}

	async #renewPublishGuard(
		accountUserId: string,
		rootEventId: string,
		leaseOwner: string,
	): Promise<void> {
		const expiresAt = new Date(
			this.#now().getTime() + publishGuardLeaseMs,
		).toISOString();
		await this.database.run(
			`UPDATE event_publish_guards SET expires_at = ?
WHERE account_user_id = ? AND root_event_id = ? AND lease_owner = ?`,
			[expiresAt, accountUserId, rootEventId, leaseOwner],
		);
	}

	async #fetchAndCache(
		subject: GatewaySessionSubject,
		accountUserId: string,
		rootEventId: string,
	): Promise<{ readiness: EventPublishReadiness; refreshedAt: string }> {
		let verificationId: string | null = null;
		try {
			await this.#assertSubject(subject);
			verificationId =
				(await this.#onRootReadStarted?.(accountUserId, rootEventId)) ?? null;
			await this.#assertSubject(subject);
			const response = await this.client.requestAsUser(
				subject,
				"eventPublishReadinessGet",
				{ path: { rootEventId } },
			);
			await this.#assertSubject(subject);
			const readiness = validateReadiness(response.data, rootEventId);
			const refreshedAt = this.#timestamp();
			await this.#cache(
				subject,
				accountUserId,
				rootEventId,
				readiness,
				refreshedAt,
			);
			const completedVerificationId = verificationId;
			verificationId = null;
			await this.#finishRootRead(
				accountUserId,
				rootEventId,
				completedVerificationId,
			);
			return { readiness, refreshedAt };
		} catch (error) {
			try {
				await this.#handleAuthoritativeError(error, accountUserId, rootEventId);
				this.#rethrow(error);
			} finally {
				await this.#finishRootReadQuietly(
					accountUserId,
					rootEventId,
					verificationId,
				);
			}
		}
	}

	async #cache(
		subject: GatewaySessionSubject,
		accountUserId: string,
		rootEventId: string,
		readiness: EventPublishReadiness,
		refreshedAt: string,
	): Promise<void> {
		const serialized = JSON.stringify(readiness);
		if (serialized.length > 262_144) throw new EventPublishUnavailableError();
		await this.database.transaction(async (transaction) => {
			await this.#assertSubject(subject);
			await transaction.run(
				`INSERT INTO event_publish_readiness_cache (
  account_user_id, root_event_id, root_version, root_revision, ready,
  snapshot_json, refreshed_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, root_event_id) DO UPDATE SET
  root_version = excluded.root_version,
  root_revision = excluded.root_revision,
  ready = excluded.ready,
  snapshot_json = excluded.snapshot_json,
  refreshed_at = excluded.refreshed_at`,
				[
					accountUserId,
					rootEventId,
					readiness.rootVersion,
					readiness.rootRevision,
					readiness.ready ? 1 : 0,
					serialized,
					refreshedAt,
				],
			);
			await this.#assertSubject(subject);
		});
	}

	async #snapshot(
		subject: GatewaySessionSubject,
		accountUserId: string,
		rootEventId: string,
		role: EventPublishRole,
		readiness: EventPublishReadiness,
		refreshedAt: string,
	): Promise<EventPublishSnapshot> {
		const [context, attempt, planItems] = await Promise.all([
			this.database.first<RootContextRow>(
				`SELECT event.title, event.status, event.starts_at, event.ends_at,
  event.time_zone,
  (SELECT COUNT(*) FROM itinerary_items item
    WHERE item.account_user_id = event.account_user_id
      AND item.root_event_id = event.root_event_id
      AND item.status = 'active' AND item.deleted_at IS NULL
  ) AS plan_item_count
FROM events event
WHERE event.account_user_id = ? AND event.root_event_id = ?
  AND event.id = ? AND event.parent_event_id IS NULL AND event.deleted_at IS NULL`,
				[accountUserId, rootEventId, rootEventId],
			),
			this.database.first<AttemptRow>(
				`SELECT attempted_readiness_json, conflicted_at, fingerprint, idempotency_key
FROM event_publish_attempts
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, rootEventId],
			),
			this.database.all<PreviewItemRow>(
				`SELECT id, title, starts_at FROM itinerary_items
WHERE account_user_id = ? AND root_event_id = ?
  AND status = 'active' AND deleted_at IS NULL
ORDER BY CASE WHEN starts_at IS NULL THEN 1 ELSE 0 END, starts_at, id
LIMIT 8`,
				[accountUserId, rootEventId],
			),
		]);
		await this.#assertSubject(subject);
		if (!context || !isRootStatus(context.status)) {
			throw new EventPublishRootAccessDeniedError();
		}
		let conflict: EventPublishConflict | null = null;
		if (attempt?.conflicted_at) {
			try {
				conflict = {
					attempted: parseReadiness(
						attempt.attempted_readiness_json,
						rootEventId,
					),
					conflictedAt: attempt.conflicted_at,
					current: readiness,
				};
			} catch {
				await this.database.run(
					`DELETE FROM event_publish_attempts
WHERE account_user_id = ? AND root_event_id = ?`,
					[accountUserId, rootEventId],
				);
			}
		}
		return {
			conflict,
			eventTitle: context.title.trim() || "Event",
			localRootStatus: context.status,
			planItemCount: Math.max(0, Number(context.plan_item_count)),
			planItems: planItems.map((item) => ({
				id: item.id,
				startsAt: item.starts_at,
				title: item.title,
			})),
			readiness,
			refreshedAt,
			role,
			schedule: {
				endsAt: context.ends_at,
				startsAt: context.starts_at,
				timeZone: context.time_zone,
			},
		};
	}

	async #commandKey(
		subject: GatewaySessionSubject,
		accountUserId: string,
		rootEventId: string,
		leaseOwner: string,
		fingerprint: string,
		readiness: EventPublishReadiness,
	): Promise<string> {
		const existing = await this.database.first<AttemptRow>(
			`SELECT attempted_readiness_json, conflicted_at, fingerprint, idempotency_key
FROM event_publish_attempts
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
		await this.#assertSubject(subject);
		if (existing?.fingerprint === fingerprint) return existing.idempotency_key;
		const idempotencyKey = this.#idempotencyKey();
		if (!idempotencyPattern.test(idempotencyKey)) {
			throw new TypeError("Invalid event publish idempotency key");
		}
		const serialized = JSON.stringify(readiness);
		if (serialized.length > 262_144) throw new EventPublishUnavailableError();
		await this.database.transaction(async (transaction) => {
			await this.#assertSubject(subject);
			const guard = await transaction.first<{ lease_owner: string }>(
				`SELECT lease_owner FROM event_publish_guards
WHERE account_user_id = ? AND root_event_id = ? AND expires_at > ?`,
				[accountUserId, rootEventId, this.#timestamp()],
			);
			if (guard?.lease_owner !== leaseOwner) {
				throw new EventPublishBusyError();
			}
			await transaction.run(
				`INSERT INTO event_publish_attempts (
  account_user_id, root_event_id, fingerprint, idempotency_key,
  attempted_readiness_json, conflicted_at, created_at
) VALUES (?, ?, ?, ?, ?, NULL, ?)
ON CONFLICT (account_user_id, root_event_id) DO UPDATE SET
  fingerprint = excluded.fingerprint,
  idempotency_key = excluded.idempotency_key,
  attempted_readiness_json = excluded.attempted_readiness_json,
  conflicted_at = NULL,
  created_at = excluded.created_at`,
				[
					accountUserId,
					rootEventId,
					fingerprint,
					idempotencyKey,
					serialized,
					this.#timestamp(),
				],
			);
			await this.#assertSubject(subject);
		});
		return idempotencyKey;
	}

	async #managerRole(
		subject: GatewaySessionSubject,
		accountUserId: string,
		rootEventId: string,
	): Promise<EventPublishRole> {
		const row = await this.database.first<MembershipRow>(
			`SELECT role FROM memberships
WHERE account_user_id = ? AND root_event_id = ?
  AND member_user_id = ? AND status = 'active'`,
			[accountUserId, rootEventId, accountUserId],
		);
		await this.#assertSubject(subject);
		if (!row) {
			await this.#purgePublishState(accountUserId, rootEventId);
			throw new EventPublishRootAccessDeniedError();
		}
		if (row.role !== "owner" && row.role !== "organizer") {
			await this.#purgePublishState(accountUserId, rootEventId);
			throw new EventPublishManagerRequiredError();
		}
		return row.role;
	}

	async #handleAuthoritativeError(
		error: unknown,
		accountUserId: string,
		rootEventId: string,
	): Promise<void> {
		if (!(error instanceof GatewayClientError)) return;
		if (error.status === 403) {
			await this.#purgePublishState(accountUserId, rootEventId);
			throw new EventPublishManagerRequiredError();
		}
		if (error.status === 404) {
			await new MobileDataStore(this.database).clearRootData(
				accountUserId,
				rootEventId,
			);
			await this.#onRootPurged(accountUserId, rootEventId);
			throw new EventPublishRootAccessDeniedError();
		}
	}

	async #finishRootRead(
		accountUserId: string,
		rootEventId: string,
		verificationId: string | null,
	): Promise<void> {
		if (verificationId && this.#onRootReadFinished) {
			await this.#onRootReadFinished(
				accountUserId,
				rootEventId,
				verificationId,
			);
		}
	}

	async #finishRootReadQuietly(
		accountUserId: string,
		rootEventId: string,
		verificationId: string | null,
	): Promise<void> {
		try {
			await this.#finishRootRead(accountUserId, rootEventId, verificationId);
		} catch {
			// A later bootstrap repeats the account/root-scoped cleanup safely.
		}
	}

	async #purgePublishState(
		accountUserId: string,
		rootEventId: string,
		executor: SqlExecutor = this.database,
	): Promise<void> {
		await executor.run(
			`DELETE FROM event_publish_attempts
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
		await executor.run(
			`DELETE FROM event_publish_readiness_cache
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
	}

	async #runForRoot<Result>(
		rootEventId: string,
		work: (
			subject: GatewaySessionSubject,
			accountUserId: string,
		) => Promise<Result>,
	): Promise<Result> {
		if (!rootPattern.test(rootEventId)) {
			throw new TypeError("Invalid event publish root ID");
		}
		const subject = await this.client.sessionSubject();
		if (!subject) throw new EventPublishAccountChangedError();
		if (!accountPattern.test(subject.userId)) {
			throw new TypeError("Invalid event publish account ID");
		}
		return this.#lock(subject.userId, rootEventId, async () => {
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

	async #lock<Result>(
		accountUserId: string,
		rootEventId: string,
		work: () => Promise<Result>,
	): Promise<Result> {
		const key = `${accountUserId}\u0000${rootEventId}`;
		const previous = this.#queues.get(key) ?? Promise.resolve();
		let release = () => {};
		const lock = new Promise<void>((resolve) => {
			release = resolve;
		});
		const tail = previous.then(
			() => lock,
			() => lock,
		);
		this.#queues.set(key, tail);
		await previous.catch(() => {});
		try {
			return await work();
		} finally {
			release();
			if (this.#queues.get(key) === tail) this.#queues.delete(key);
		}
	}

	#requireOnline(): void {
		if (!this.#isOnline()) throw new EventPublishOnlineRequiredError();
	}

	#requireSynced(status: SyncStatus): void {
		if (
			status.state !== "synced" ||
			status.pendingCount !== 0 ||
			status.attentionCount !== 0
		) {
			throw new EventPublishSyncRequiredError(status);
		}
	}

	async #assertSubject(subject: GatewaySessionSubject): Promise<void> {
		try {
			await this.client.assertSessionSubject(subject);
		} catch (error) {
			this.#rethrow(error);
		}
	}

	#rethrow(error: unknown): never {
		if (
			error instanceof GatewayClientError &&
			(error.code === "session_changed" || error.code === "unauthenticated")
		) {
			throw new EventPublishAccountChangedError();
		}
		throw error;
	}

	#timestamp(): string {
		return this.#now().toISOString();
	}
}

function parseReadiness(
	value: string,
	rootEventId: string,
): EventPublishReadiness {
	try {
		return validateReadiness(JSON.parse(value), rootEventId);
	} catch {
		throw new EventPublishUnavailableError();
	}
}

function readinessBody(readiness: EventPublishReadiness) {
	return {
		baseRevision: readiness.rootRevision,
		baseVersion: readiness.rootVersion,
	};
}

function readinessFingerprint(readiness: EventPublishReadiness): string {
	return JSON.stringify(readinessBody(readiness));
}

function fullySynced(status: SyncStatus): boolean {
	return (
		status.state === "synced" &&
		status.pendingCount === 0 &&
		status.attentionCount === 0
	);
}

function validateReadiness(
	value: unknown,
	rootEventId: string,
): EventPublishReadiness {
	if (!isRecord(value)) throw new EventPublishUnavailableError();
	const reasons = value.reasons;
	if (
		value.schemaVersion !== 1 ||
		value.rootEventId !== rootEventId ||
		typeof value.ready !== "boolean" ||
		!Number.isSafeInteger(value.rootVersion) ||
		Number(value.rootVersion) < 1 ||
		typeof value.rootRevision !== "string" ||
		value.rootRevision.length > 20 ||
		!revisionPattern.test(value.rootRevision) ||
		!Array.isArray(reasons) ||
		reasons.length > 500 ||
		value.ready !== (reasons.length === 0) ||
		!validTemplate(value.template) ||
		!reasons.every(validReason)
	) {
		throw new EventPublishUnavailableError();
	}
	return value as unknown as EventPublishReadiness;
}

function validTemplate(value: unknown): boolean {
	return (
		value === null ||
		(isRecord(value) &&
			(value.id === "travel" ||
				value.id === "golf-tour" ||
				value.id === "team-event") &&
			value.version === 1)
	);
}

function validReason(value: unknown): boolean {
	if (!isRecord(value) || !readinessCodes.has(value.code as never))
		return false;
	if (
		typeof value.message !== "string" ||
		value.message.length < 1 ||
		value.message.length > 1_024 ||
		typeof value.path !== "string" ||
		value.path.length < 1 ||
		value.path.length > 1_024
	) {
		return false;
	}
	if (value.meta === undefined) return true;
	return (
		isRecord(value.meta) &&
		(value.meta.eventId === undefined ||
			(typeof value.meta.eventId === "string" &&
				rootPattern.test(value.meta.eventId))) &&
		(value.meta.capabilityType === undefined ||
			value.meta.capabilityType === "travel" ||
			value.meta.capabilityType === "lodging" ||
			value.meta.capabilityType === "transport" ||
			value.meta.capabilityType === "golf" ||
			value.meta.capabilityType === "team")
	);
}

function isRootStatus(
	value: string,
): value is EventPublishSnapshot["localRootStatus"] {
	return (
		value === "archived" ||
		value === "cancelled" ||
		value === "draft" ||
		value === "published"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
