import {
	type GatewayClient,
	GatewayClientError,
	type GatewayResponse,
	type GatewayResponseData,
} from "@crew/mobile-client";
import type { SqlDatabase, SqlExecutor } from "./database.ts";

const accountPattern = /^usr_[a-f0-9]{32}$/;
const rootPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const pageSize = 200;
const maxPages = 50;

export interface ActorEventRootIndexEntry {
	rootEventId: string;
	kind:
		| "trip"
		| "day"
		| "golf"
		| "team_event"
		| "session"
		| "activity"
		| "other";
	title: string;
	timeZone: string;
	startsAt: string | null;
	endsAt: string | null;
	status: "draft" | "published" | "cancelled";
	version: number;
	createdAt: string;
	updatedAt: string;
	role: "owner" | "organizer" | "participant" | "viewer";
	membershipStatus: "active";
}

export interface ActorEventRootIndexState {
	accountUserId: string;
	schemaVersion: 1;
	cacheVersion: number;
	refreshedAt: string;
}

export interface ActorEventRootSelection {
	accountUserId: string;
	rootEventId: string;
	selectedAt: string;
}

export interface ActorEventRootIndexOptions {
	activeAccountUserId?: () => string | null | Promise<string | null>;
	now?: () => Date;
}

export class ActorEventRootIndexAccountChangedError extends Error {
	constructor() {
		super("Active account changed during event index refresh");
		this.name = "ActorEventRootIndexAccountChangedError";
	}
}

export class ActorEventRootIndexAccessDeniedError extends Error {
	constructor() {
		super("Event index access is unavailable");
		this.name = "ActorEventRootIndexAccessDeniedError";
	}
}

export class ActorEventRootIndexStore {
	readonly #activeAccountUserId: ActorEventRootIndexOptions["activeAccountUserId"];
	readonly #now: () => Date;
	readonly #refreshes = new Map<string, Promise<ActorEventRootIndexState>>();

	constructor(
		private readonly database: SqlDatabase,
		private readonly client?: Pick<GatewayClient, "request">,
		options: ActorEventRootIndexOptions = {},
	) {
		this.#activeAccountUserId = options.activeAccountUserId;
		this.#now = options.now ?? (() => new Date());
	}

	async list(
		accountUserId: string,
	): Promise<readonly ActorEventRootIndexEntry[]> {
		validateAccount(accountUserId);
		const rows = await this.database.all<ActorEventRootRow>(
			`SELECT * FROM actor_event_root_index_entries
WHERE account_user_id = ?
ORDER BY root_event_id`,
			[accountUserId],
		);
		return rows.map(mapEntry);
	}

	async get(
		accountUserId: string,
		rootEventId: string,
	): Promise<ActorEventRootIndexEntry | null> {
		validateAccount(accountUserId);
		validateRoot(rootEventId);
		const row = await this.database.first<ActorEventRootRow>(
			`SELECT * FROM actor_event_root_index_entries
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
		return row ? mapEntry(row) : null;
	}

	async getState(
		accountUserId: string,
	): Promise<ActorEventRootIndexState | null> {
		validateAccount(accountUserId);
		const row = await this.database.first<ActorEventRootStateRow>(
			`SELECT * FROM actor_event_root_index_state
WHERE account_user_id = ?`,
			[accountUserId],
		);
		return row ? mapState(row) : null;
	}

	async getSelection(
		accountUserId: string,
	): Promise<ActorEventRootSelection | null> {
		validateAccount(accountUserId);
		const row = await this.database.first<ActorEventRootSelectionRow>(
			`SELECT account_user_id, root_event_id, selected_at
FROM actor_event_root_selection
WHERE account_user_id = ?`,
			[accountUserId],
		);
		return row
			? {
					accountUserId: row.account_user_id,
					rootEventId: row.root_event_id,
					selectedAt: row.selected_at,
				}
			: null;
	}

	refresh(accountUserId: string): Promise<ActorEventRootIndexState> {
		validateAccount(accountUserId);
		if (!this.client) {
			return Promise.reject(new Error("Event index client is unavailable"));
		}
		const existing = this.#refreshes.get(accountUserId);
		if (existing) return existing;

		const refresh = this.#refresh(accountUserId).finally(() => {
			if (this.#refreshes.get(accountUserId) === refresh) {
				this.#refreshes.delete(accountUserId);
			}
		});
		this.#refreshes.set(accountUserId, refresh);
		return refresh;
	}

	async select(accountUserId: string, rootEventId: string): Promise<void> {
		validateAccount(accountUserId);
		validateRoot(rootEventId);
		await this.#assertActiveAccount(accountUserId);
		const selectedAt = this.#now().toISOString();
		await this.database.transaction(async (transaction) => {
			const entry = await transaction.first(
				`SELECT 1 FROM actor_event_root_index_entries
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, rootEventId],
			);
			if (!entry) throw new Error("Event is not available in the actor index");
			await transaction.run(
				`INSERT INTO actor_event_root_selection (
  account_user_id, root_event_id, selected_at
) VALUES (?, ?, ?)
ON CONFLICT (account_user_id) DO UPDATE SET
  root_event_id = excluded.root_event_id,
  selected_at = excluded.selected_at`,
				[accountUserId, rootEventId, selectedAt],
			);
			await this.#assertActiveAccount(accountUserId);
		});
	}

	async clearAccount(accountUserId: string): Promise<void> {
		validateAccount(accountUserId);
		await this.#purgeAccount(accountUserId);
	}

	async #refresh(accountUserId: string): Promise<ActorEventRootIndexState> {
		await this.#assertActiveAccount(accountUserId);
		const roots = new Map<string, ActorEventRootIndexEntry>();
		const seenCursors = new Set<string>();
		let cursor: string | undefined;

		for (let page = 0; page < maxPages; page += 1) {
			const response = await this.#requestPage(accountUserId, cursor);
			await this.#assertActiveAccount(accountUserId);
			validatePage(response.data);
			for (const item of response.data.items) {
				if (item.membershipStatus !== "active" || item.status === "archived") {
					continue;
				}
				validateEntry(item);
				const current = roots.get(item.rootEventId);
				if (!current || item.version >= current.version) {
					roots.set(item.rootEventId, item);
				}
			}

			const { hasMore, nextCursor } = response.data.pageInfo;
			if (!hasMore) {
				if (nextCursor !== null) {
					throw new Error("Event index terminal page has a cursor");
				}
				return this.#replace(accountUserId, [...roots.values()]);
			}
			if (!nextCursor || seenCursors.has(nextCursor)) {
				throw new Error("Event index pagination is invalid");
			}
			seenCursors.add(nextCursor);
			cursor = nextCursor;
		}
		throw new Error("Event index exceeds the local pagination limit");
	}

	async #requestPage(
		accountUserId: string,
		cursor: string | undefined,
	): Promise<GatewayResponse<GatewayResponseData<"eventRootsList">>> {
		try {
			if (!this.client) throw new Error("Event index client is unavailable");
			return await this.client.request("eventRootsList", {
				query: cursor
					? { cursor, includeArchived: "false", limit: pageSize }
					: { includeArchived: "false", limit: pageSize },
			});
		} catch (error) {
			if (denied(error)) {
				await this.#purgeAccount(accountUserId);
				throw new ActorEventRootIndexAccessDeniedError();
			}
			await this.#assertActiveAccount(accountUserId);
			throw error;
		}
	}

	async #replace(
		accountUserId: string,
		entries: readonly ActorEventRootIndexEntry[],
	): Promise<ActorEventRootIndexState> {
		await this.#assertActiveAccount(accountUserId);
		const refreshedAt = this.#now().toISOString();
		let cacheVersion = 1;
		await this.database.transaction(async (transaction) => {
			const state = await transaction.first<{ cache_version: number }>(
				`SELECT cache_version FROM actor_event_root_index_state
WHERE account_user_id = ?`,
				[accountUserId],
			);
			cacheVersion = state ? Number(state.cache_version) + 1 : 1;
			await transaction.run(
				`INSERT INTO actor_event_root_index_state (
  account_user_id, schema_version, cache_version, refreshed_at
) VALUES (?, 1, ?, ?)
ON CONFLICT (account_user_id) DO UPDATE SET
  schema_version = 1,
  cache_version = excluded.cache_version,
  refreshed_at = excluded.refreshed_at`,
				[accountUserId, cacheVersion, refreshedAt],
			);

			const current = await transaction.all<{ root_event_id: string }>(
				`SELECT root_event_id FROM actor_event_root_index_entries
WHERE account_user_id = ?`,
				[accountUserId],
			);
			const nextIds = new Set(entries.map((entry) => entry.rootEventId));
			for (const { root_event_id: rootEventId } of current) {
				if (nextIds.has(rootEventId)) continue;
				await purgeRoot(transaction, accountUserId, rootEventId);
				await transaction.run(
					`DELETE FROM actor_event_root_index_entries
WHERE account_user_id = ? AND root_event_id = ?`,
					[accountUserId, rootEventId],
				);
			}

			for (const entry of [...entries].sort((left, right) =>
				compareText(left.rootEventId, right.rootEventId),
			)) {
				await upsertEntry(transaction, accountUserId, entry);
			}
			await this.#assertActiveAccount(accountUserId);
		});
		return {
			accountUserId,
			schemaVersion: 1,
			cacheVersion,
			refreshedAt,
		};
	}

	async #purgeAccount(accountUserId: string): Promise<void> {
		await this.database.transaction(async (transaction) => {
			await transaction.run(
				"DELETE FROM sync_snapshot_staging WHERE account_user_id = ?",
				[accountUserId],
			);
			await transaction.run(
				"DELETE FROM root_sync_state WHERE account_user_id = ?",
				[accountUserId],
			);
			await transaction.run(
				"DELETE FROM actor_event_root_index_state WHERE account_user_id = ?",
				[accountUserId],
			);
		});
	}

	async #assertActiveAccount(accountUserId: string): Promise<void> {
		if (!this.#activeAccountUserId) return;
		if ((await this.#activeAccountUserId()) !== accountUserId) {
			throw new ActorEventRootIndexAccountChangedError();
		}
	}
}

interface ActorEventRootStateRow {
	account_user_id: string;
	schema_version: number;
	cache_version: number;
	refreshed_at: string;
}

interface ActorEventRootRow {
	root_event_id: string;
	kind: ActorEventRootIndexEntry["kind"];
	title: string;
	time_zone: string;
	starts_at: string | null;
	ends_at: string | null;
	status: ActorEventRootIndexEntry["status"];
	version: number;
	created_at: string;
	updated_at: string;
	role: ActorEventRootIndexEntry["role"];
	membership_status: "active";
}

interface ActorEventRootSelectionRow {
	account_user_id: string;
	root_event_id: string;
	selected_at: string;
}

function mapState(row: ActorEventRootStateRow): ActorEventRootIndexState {
	return {
		accountUserId: row.account_user_id,
		schemaVersion: 1,
		cacheVersion: Number(row.cache_version),
		refreshedAt: row.refreshed_at,
	};
}

function mapEntry(row: ActorEventRootRow): ActorEventRootIndexEntry {
	return {
		rootEventId: row.root_event_id,
		kind: row.kind,
		title: row.title,
		timeZone: row.time_zone,
		startsAt: row.starts_at,
		endsAt: row.ends_at,
		status: row.status,
		version: Number(row.version),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		role: row.role,
		membershipStatus: row.membership_status,
	};
}

async function upsertEntry(
	transaction: SqlExecutor,
	accountUserId: string,
	entry: ActorEventRootIndexEntry,
): Promise<void> {
	await transaction.run(
		`INSERT INTO actor_event_root_index_entries (
  account_user_id, root_event_id, kind, title, time_zone, starts_at, ends_at,
  status, version, created_at, updated_at, role, membership_status
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
ON CONFLICT (account_user_id, root_event_id) DO UPDATE SET
  kind = excluded.kind,
  title = excluded.title,
  time_zone = excluded.time_zone,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  status = excluded.status,
  version = excluded.version,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at,
  role = excluded.role,
  membership_status = 'active'`,
		[
			accountUserId,
			entry.rootEventId,
			entry.kind,
			entry.title,
			entry.timeZone,
			entry.startsAt,
			entry.endsAt,
			entry.status,
			entry.version,
			entry.createdAt,
			entry.updatedAt,
			entry.role,
		],
	);
}

async function purgeRoot(
	transaction: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
): Promise<void> {
	await transaction.run(
		`DELETE FROM sync_snapshot_staging
WHERE account_user_id = ? AND root_event_id = ?`,
		[accountUserId, rootEventId],
	);
	await transaction.run(
		`DELETE FROM root_sync_state
WHERE account_user_id = ? AND root_event_id = ?`,
		[accountUserId, rootEventId],
	);
}

function validatePage(data: GatewayResponseData<"eventRootsList">): void {
	if (
		!data ||
		!Array.isArray(data.items) ||
		!data.pageInfo ||
		typeof data.pageInfo.hasMore !== "boolean" ||
		(data.pageInfo.nextCursor !== null &&
			typeof data.pageInfo.nextCursor !== "string")
	) {
		throw new Error("Event index page is invalid");
	}
}

function validateEntry(
	entry: GatewayResponseData<"eventRootsList">["items"][number],
): asserts entry is ActorEventRootIndexEntry {
	validateRoot(entry.rootEventId);
	if (
		![
			"trip",
			"day",
			"golf",
			"team_event",
			"session",
			"activity",
			"other",
		].includes(entry.kind) ||
		entry.title.length < 1 ||
		entry.title.length > 160 ||
		entry.timeZone.length < 1 ||
		entry.timeZone.length > 100 ||
		!["draft", "published", "cancelled"].includes(entry.status) ||
		!["owner", "organizer", "participant", "viewer"].includes(entry.role) ||
		entry.membershipStatus !== "active" ||
		!Number.isSafeInteger(entry.version) ||
		entry.version < 1 ||
		!validDate(entry.createdAt) ||
		!validDate(entry.updatedAt) ||
		!validNullableDate(entry.startsAt) ||
		!validNullableDate(entry.endsAt) ||
		(entry.startsAt !== null &&
			entry.endsAt !== null &&
			Date.parse(entry.startsAt) >= Date.parse(entry.endsAt))
	) {
		throw new Error("Event index entry is invalid");
	}
}

function validDate(value: string): boolean {
	return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validNullableDate(value: string | null): boolean {
	return value === null || validDate(value);
}

function validateAccount(value: string): void {
	if (!accountPattern.test(value)) throw new Error("Invalid account scope");
}

function validateRoot(value: string): void {
	if (!rootPattern.test(value)) throw new Error("Invalid root scope");
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

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
