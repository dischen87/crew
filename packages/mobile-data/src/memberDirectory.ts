import {
	type GatewayClient,
	GatewayClientError,
	type GatewayResponse,
	type GatewayResponseData,
} from "@crew/mobile-client";
import type { SqlDatabase } from "./database.ts";

const userIdPattern = /^usr_[a-f0-9]{32}$/;
const rootIdPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const pageSize = 200;
const maxPages = 50;

export interface MemberDirectoryEntry {
	userId: string;
	displayName: string | null;
}

export interface MemberDirectoryState {
	accountUserId: string;
	rootEventId: string;
	cacheVersion: number;
	refreshedAt: string;
}

export interface MemberDirectoryStoreOptions {
	activeAccountUserId?: () => string | null | Promise<string | null>;
	now?: () => Date;
}

export class MemberDirectoryAccountChangedError extends Error {
	constructor() {
		super("Active account changed during member directory refresh");
		this.name = "MemberDirectoryAccountChangedError";
	}
}

export class MemberDirectoryRootAccessDeniedError extends Error {
	constructor() {
		super("Member directory access is unavailable");
		this.name = "MemberDirectoryRootAccessDeniedError";
	}
}

export class MemberDirectoryStore {
	readonly #activeAccountUserId: MemberDirectoryStoreOptions["activeAccountUserId"];
	readonly #now: () => Date;
	readonly #refreshes = new Map<string, Promise<MemberDirectoryState>>();

	constructor(
		private readonly database: SqlDatabase,
		private readonly client?: Pick<GatewayClient, "request">,
		options: MemberDirectoryStoreOptions = {},
	) {
		this.#activeAccountUserId = options.activeAccountUserId;
		this.#now = options.now ?? (() => new Date());
	}

	async list(
		accountUserId: string,
		rootEventId: string,
	): Promise<readonly MemberDirectoryEntry[]> {
		validateScope(accountUserId, rootEventId);
		const rows = await this.database.all<MemberDirectoryEntryRow>(
			`SELECT user_id, display_name
FROM member_directory_entries
WHERE account_user_id = ? AND root_event_id = ?
ORDER BY user_id`,
			[accountUserId, rootEventId],
		);
		return rows.map((row) => ({
			userId: row.user_id,
			displayName: row.display_name,
		}));
	}

	async get(
		accountUserId: string,
		rootEventId: string,
		userId: string,
	): Promise<MemberDirectoryEntry | null> {
		validateScope(accountUserId, rootEventId);
		validateUserId(userId);
		const row = await this.database.first<MemberDirectoryEntryRow>(
			`SELECT user_id, display_name
FROM member_directory_entries
WHERE account_user_id = ? AND root_event_id = ? AND user_id = ?`,
			[accountUserId, rootEventId, userId],
		);
		return row ? { userId: row.user_id, displayName: row.display_name } : null;
	}

	async getState(
		accountUserId: string,
		rootEventId: string,
	): Promise<MemberDirectoryState | null> {
		validateScope(accountUserId, rootEventId);
		const row = await this.database.first<MemberDirectoryStateRow>(
			`SELECT account_user_id, root_event_id, cache_version, refreshed_at
FROM member_directory_state
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
		return row ? mapState(row) : null;
	}

	refresh(
		accountUserId: string,
		rootEventId: string,
	): Promise<MemberDirectoryState> {
		validateScope(accountUserId, rootEventId);
		if (!this.client) {
			return Promise.reject(
				new Error("Member directory client is unavailable"),
			);
		}
		const key = `${accountUserId}:${rootEventId}`;
		const existing = this.#refreshes.get(key);
		if (existing) return existing;

		const refresh = this.#refresh(accountUserId, rootEventId).finally(() => {
			if (this.#refreshes.get(key) === refresh) this.#refreshes.delete(key);
		});
		this.#refreshes.set(key, refresh);
		return refresh;
	}

	async clearRoot(accountUserId: string, rootEventId: string): Promise<void> {
		validateScope(accountUserId, rootEventId);
		await this.database.run(
			`DELETE FROM member_directory_state
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
	}

	async #refresh(
		accountUserId: string,
		rootEventId: string,
	): Promise<MemberDirectoryState> {
		await this.#assertActiveAccount(accountUserId);
		const entries: MemberDirectoryEntry[] = [];
		const seenUsers = new Set<string>();
		const seenCursors = new Set<string>();
		let cursor: string | undefined;

		for (let page = 0; page < maxPages; page += 1) {
			const response = await this.#requestPage(
				accountUserId,
				rootEventId,
				cursor,
			);
			await this.#assertActiveAccount(accountUserId);
			for (const item of response.data.items) {
				validateEntry(item);
				if (seenUsers.has(item.userId)) {
					throw new Error("Member directory contains a duplicate user");
				}
				seenUsers.add(item.userId);
				entries.push({ userId: item.userId, displayName: item.displayName });
			}

			const { hasMore, nextCursor } = response.data.pageInfo;
			if (!hasMore) {
				if (nextCursor !== null) {
					throw new Error("Member directory terminal page has a cursor");
				}
				return this.#replace(accountUserId, rootEventId, entries);
			}
			if (!nextCursor || seenCursors.has(nextCursor)) {
				throw new Error("Member directory pagination is invalid");
			}
			seenCursors.add(nextCursor);
			cursor = nextCursor;
		}
		throw new Error("Member directory exceeds the local pagination limit");
	}

	async #requestPage(
		accountUserId: string,
		rootEventId: string,
		cursor: string | undefined,
	): Promise<GatewayResponse<GatewayResponseData<"eventMemberDirectoryGet">>> {
		try {
			if (!this.client)
				throw new Error("Member directory client is unavailable");
			return await this.client.request("eventMemberDirectoryGet", {
				path: { rootEventId },
				query: cursor ? { cursor, limit: pageSize } : { limit: pageSize },
			});
		} catch (error) {
			await this.#assertActiveAccount(accountUserId);
			if (denied(error)) {
				await this.clearRoot(accountUserId, rootEventId);
				throw new MemberDirectoryRootAccessDeniedError();
			}
			throw error;
		}
	}

	async #replace(
		accountUserId: string,
		rootEventId: string,
		entries: readonly MemberDirectoryEntry[],
	): Promise<MemberDirectoryState> {
		await this.#assertActiveAccount(accountUserId);
		const refreshedAt = this.#now().toISOString();
		let cacheVersion = 1;
		await this.database.transaction(async (transaction) => {
			const existing = await transaction.first<{ cache_version: number }>(
				`SELECT cache_version FROM member_directory_state
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, rootEventId],
			);
			cacheVersion = existing ? Number(existing.cache_version) + 1 : 1;
			await transaction.run(
				`INSERT INTO member_directory_state (
  account_user_id, root_event_id, cache_version, refreshed_at
) VALUES (?, ?, ?, ?)
ON CONFLICT (account_user_id, root_event_id) DO UPDATE SET
  cache_version = excluded.cache_version,
  refreshed_at = excluded.refreshed_at`,
				[accountUserId, rootEventId, cacheVersion, refreshedAt],
			);
			await transaction.run(
				`DELETE FROM member_directory_entries
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, rootEventId],
			);
			for (const entry of [...entries].sort((left, right) =>
				compareText(left.userId, right.userId),
			)) {
				await transaction.run(
					`INSERT INTO member_directory_entries (
  account_user_id, root_event_id, user_id, display_name
) VALUES (?, ?, ?, ?)`,
					[accountUserId, rootEventId, entry.userId, entry.displayName],
				);
			}
		});
		return { accountUserId, rootEventId, cacheVersion, refreshedAt };
	}

	async #assertActiveAccount(accountUserId: string): Promise<void> {
		if (!this.#activeAccountUserId) return;
		if ((await this.#activeAccountUserId()) !== accountUserId) {
			throw new MemberDirectoryAccountChangedError();
		}
	}
}

interface MemberDirectoryEntryRow {
	user_id: string;
	display_name: string | null;
}

interface MemberDirectoryStateRow {
	account_user_id: string;
	root_event_id: string;
	cache_version: number;
	refreshed_at: string;
}

function mapState(row: MemberDirectoryStateRow): MemberDirectoryState {
	return {
		accountUserId: row.account_user_id,
		rootEventId: row.root_event_id,
		cacheVersion: Number(row.cache_version),
		refreshedAt: row.refreshed_at,
	};
}

function validateScope(accountUserId: string, rootEventId: string): void {
	validateUserId(accountUserId);
	if (!rootIdPattern.test(rootEventId)) throw new Error("Invalid root scope");
}

function validateEntry(entry: MemberDirectoryEntry): void {
	validateUserId(entry.userId);
	if (
		entry.displayName !== null &&
		(entry.displayName.length < 1 ||
			entry.displayName.length > 120 ||
			entry.displayName.trim() !== entry.displayName)
	) {
		throw new Error("Invalid member display name");
	}
}

function validateUserId(value: string): void {
	if (!userIdPattern.test(value)) throw new Error("Invalid user scope");
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
