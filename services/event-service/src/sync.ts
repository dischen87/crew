import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SYNC_PROTOCOL_VERSION = 1 as const;
export const MAX_SYNC_MUTATIONS = 100;
export const MAX_SYNC_BODY_BYTES = 1024 * 1024;
export const SYNC_SNAPSHOT_TTL_MS = 15 * 60 * 1000;
export const SYNC_CONTRACT_MAJOR = 1 as const;

export type SyncMutationKind =
	| "event.create"
	| "event.update"
	| "event.reparent"
	| "event.children.reorder"
	| "event.archive"
	| "event.delete"
	| "place.create"
	| "place.update"
	| "capability.replace"
	| "capability.remove"
	| "itinerary.create"
	| "itinerary.update"
	| "itinerary.reorder"
	| "feed.entry.create"
	| "feed.entry.revise"
	| "feed.entry.remove"
	| "feed.reaction.set"
	| "golf.round.replace"
	| "golf.score.set"
	| "team.assignments.publish"
	| "team.decision.replace"
	| "team.response.set"
	| "attachment.commit";

export type SyncEntityType =
	| "event"
	| "membership"
	| "invitation"
	| "place"
	| "capability"
	| "itineraryItem"
	| "feedEntry"
	| "feedReaction"
	| "attachment"
	| "golfRound"
	| "golfRoster"
	| "golfPlayer"
	| "golfScore"
	| "golfLeaderboard"
	| "teamAssignmentSet"
	| "teamAssignmentRoster"
	| "teamAssignment"
	| "teamDecision"
	| "teamResponse";

export type SyncMutation = {
	clientMutationId: string;
	clientSequence: number;
	kind: SyncMutationKind;
	entityId: string;
	baseVersion?: number | undefined;
	payload: Record<string, unknown>;
};

export type SyncPushInput = {
	protocolVersion: typeof SYNC_PROTOCOL_VERSION;
	rootEventId: string;
	deviceId: string;
	mutations: SyncMutation[];
};

export type SyncMutationError = {
	code: string;
	message: string;
	retryable: boolean;
	currentVersion?: number | undefined;
	authoritativeOrder?: string[] | undefined;
};

export type SyncMutationResult = {
	clientMutationId: string;
	clientSequence: number;
	outcome: "applied" | "rejected" | "retry" | "blocked";
	replayed: boolean;
	rootRevision?: string | undefined;
	entity?:
		| { entityType: SyncEntityType; entityId: string; version: number }
		| undefined;
	error?: SyncMutationError | undefined;
	retryAfterSeconds?: number | undefined;
};

export type SyncPushResponse = {
	protocolVersion: typeof SYNC_PROTOCOL_VERSION;
	rootEventId: string;
	deviceId: string;
	results: SyncMutationResult[];
	nextExpectedClientSequence: number;
};

export type SyncAppliedMutation = {
	rootRevision: string;
	entity?:
		| { entityType: SyncEntityType; entityId: string; version: number }
		| undefined;
};

export type SyncRootAccess = {
	rootRevision: string;
	authorizationScopeVersion: string;
	minimumSyncRevision: string;
	minimumSyncOrdinal: number;
	role: "owner" | "organizer" | "participant" | "viewer";
};

export type SyncChangePage = {
	access: SyncRootAccess;
	changes: SyncChange[];
	checkpoint: { rootRevision: string; ordinal: number };
	hasMore: boolean;
};

export type SyncChange = {
	rootRevision: string;
	ordinal: number;
	entityType: SyncEntityType;
	entityId: string;
	entityVersion: number;
} & (
	| { operation: "upsert"; data: Record<string, unknown> }
	| { operation: "tombstone"; tombstone: Record<string, unknown> }
);

export type SyncPullResponse = {
	protocolVersion: typeof SYNC_PROTOCOL_VERSION;
	rootEventId: string;
	authorizationScopeVersion: string;
	changes: SyncChange[];
	checkpointCursor: string;
	pageInfo: { nextCursor: string | null; hasMore: boolean };
};

export type SyncSnapshotRecord = {
	entityType: SyncEntityType;
	entityId: string;
	entityVersion: number;
	data: Record<string, unknown>;
};

export type SyncBootstrapResponse = {
	protocolVersion: typeof SYNC_PROTOCOL_VERSION;
	rootEventId: string;
	authorizationScopeVersion: string;
	snapshotId: string;
	snapshotRevision: string;
	records: SyncSnapshotRecord[];
	syncCursor: string;
	pageInfo: { nextCursor: string | null; hasMore: boolean };
};

export type SyncBootstrapPage = {
	access: SyncRootAccess;
	snapshotId: string;
	snapshotRevision: string;
	expiresAt: Date;
	records: SyncSnapshotRecord[];
	nextOffset: number;
	hasMore: boolean;
};

export type PullCursor = {
	v: typeof SYNC_CONTRACT_MAJOR;
	op: "pull";
	actorId: string;
	rootEventId: string;
	authorizationScopeVersion: string;
	filters: Record<string, never>;
	rootRevision: string;
	ordinal: number;
};

export type BootstrapCursor = {
	v: typeof SYNC_CONTRACT_MAJOR;
	op: "bootstrap";
	actorId: string;
	rootEventId: string;
	authorizationScopeVersion: string;
	filters: Record<string, never>;
	snapshotId: string;
	offset: number;
	expiresAt: string;
};

export class InvalidSyncCursorError extends Error {}

export class SyncCursorCodec {
	constructor(private readonly key: string) {
		if (Buffer.byteLength(key) < 32)
			throw new Error("SYNC_CURSOR_KEY must contain at least 32 bytes");
	}

	encode(cursor: PullCursor | BootstrapCursor) {
		const encoded = Buffer.from(canonicalJson(cursor)).toString("base64url");
		const signature = this.signature(cursor.op, encoded).toString("base64url");
		return `${encoded}.${signature}`;
	}

	decode<T extends PullCursor | BootstrapCursor>(
		token: string,
		op: T["op"],
	): T {
		try {
			const parts = token.split(".");
			if (parts.length !== 2) throw new InvalidSyncCursorError();
			const [encoded, supplied] = parts;
			if (!encoded || !supplied) throw new InvalidSyncCursorError();
			const expected = this.signature(op, encoded);
			const actual = Buffer.from(supplied, "base64url");
			if (
				actual.length !== expected.length ||
				!timingSafeEqual(actual, expected)
			)
				throw new InvalidSyncCursorError();
			const value = JSON.parse(
				Buffer.from(encoded, "base64url").toString("utf8"),
			) as T;
			if (value.v !== SYNC_CONTRACT_MAJOR || value.op !== op)
				throw new InvalidSyncCursorError();
			return value;
		} catch (error) {
			if (error instanceof InvalidSyncCursorError) throw error;
			throw new InvalidSyncCursorError();
		}
	}

	private signature(operation: "pull" | "bootstrap", encoded: string) {
		return createHmac("sha256", this.key)
			.update(`crew:event-sync-cursor:v1:${operation}:${encoded}`)
			.digest();
	}
}

export function syncMutationFingerprint(
	actorId: string,
	request: Pick<SyncPushInput, "protocolVersion" | "rootEventId" | "deviceId">,
	mutation: SyncMutation,
) {
	return createHash("sha256")
		.update(
			canonicalJson({
				protocolVersion: request.protocolVersion,
				actorId,
				rootEventId: request.rootEventId,
				deviceId: request.deviceId,
				clientMutationId: mutation.clientMutationId,
				clientSequence: mutation.clientSequence,
				kind: mutation.kind,
				entityId: mutation.entityId,
				baseVersion: mutation.baseVersion ?? null,
				payload: mutation.payload,
			}),
		)
		.digest("hex");
}

export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
		.join(",")}}`;
}
