import {
	type GatewayClient,
	GatewayClientError,
	type GatewayRequest,
	type GatewayResponseData,
} from "@crew/mobile-client";
import type { SqlDatabase, SqlExecutor } from "./database.ts";
import {
	acknowledgeGolfScoreIntent,
	enqueueGolfScoreIntent,
	findGolfScoreIntentByOutboxMutation,
	type GolfScoreIntent,
	type GolfScoreIntentInput,
	golfScoreEntityId,
	linkGolfScoreIntentToOutbox,
} from "./golfOffline.ts";
import { sha256Hex } from "./sha256.ts";
import { MobileDataStore } from "./store.ts";

export type RootCreateCommand = GatewayRequest<"eventsCreate">["body"];
export type SyncPushBody = GatewayRequest<"syncMutationsApply">["body"];
export type SyncPushResponse = GatewayResponseData<"syncMutationsApply">;
export type SyncMutation = SyncPushBody["mutations"][number];
type WithoutMutationIdentity<Mutation> = Mutation extends unknown
	? Omit<Mutation, "clientMutationId" | "clientSequence">
	: never;
export type SyncMutationDraft = WithoutMutationIdentity<SyncMutation>;
type GolfScoreMutationDraft = Extract<
	SyncMutationDraft,
	{ kind: "golf.score.set" }
>;
type AttachmentCommitDraft = Extract<
	SyncMutationDraft,
	{ kind: "attachment.commit" }
>;
type TeamAssignmentsMutationDraft = Extract<
	SyncMutationDraft,
	{ kind: "team.assignments.publish" }
>;
type TeamDecisionMutationDraft = Extract<
	SyncMutationDraft,
	{ kind: "team.decision.replace" }
>;
type TeamResponseMutationDraft = Extract<
	SyncMutationDraft,
	{ kind: "team.response.set" }
>;

export type OutboxState =
	| "pending"
	| "sending"
	| "awaiting_pull"
	| "blocked"
	| "dead_letter";

export type SyncFailureCode =
	| "auth_required"
	| "blocked"
	| "conflict"
	| "deleted"
	| "invalid"
	| "network"
	| "permission"
	| "rate_limited"
	| "retry_exhausted"
	| "sequence"
	| "service_unavailable"
	| "unknown";

export interface OutboxItem {
	accountUserId: string;
	clientMutationId: string;
	rootEventId: string;
	deviceId: string;
	clientSequence: number;
	operationId: "eventsCreate" | "syncMutationsApply";
	command: RootCreateCommand | SyncMutation;
	optimisticOverlay: unknown;
	state: OutboxState;
	attempts: number;
	nextAttemptAt: string | null;
	appliedRootRevision: string | null;
	serverConsumed: boolean;
	lastError: {
		code: SyncFailureCode;
		requestId: string | null;
		currentVersion: number | null;
		authoritativeOrder: readonly string[] | null;
	} | null;
	createdAt: string;
	updatedAt: string;
}

export interface GolfScoreEnqueueResult {
	intent: GolfScoreIntent;
	outbox: OutboxItem | null;
}

export interface SyncStatus {
	state:
		| "synced"
		| "pending"
		| "syncing"
		| "waiting_retry"
		| "blocked"
		| "needs_attention"
		| "resetting";
	summary: string;
	pendingCount: number;
	attentionCount: number;
	nextAttemptAt: string | null;
}

export interface OutboxEvidenceRow {
	state: OutboxState;
	mutationKind: SyncMutation["kind"];
	clientSequence: number;
	commandBodyFingerprint: string;
	requestBodyFingerprint: string | null;
	idempotencyKeyFingerprint: string | null;
}

export interface OutboxEvidence {
	pendingCount: number;
	attentionCount: number;
	pullCursorFingerprint: string | null;
	truncated: boolean;
	rows: readonly OutboxEvidenceRow[];
}

export interface MobileSyncEngineOptions {
	activeAccountUserId: () => string | null | Promise<string | null>;
	assertMutationStreamIdentity?: (
		executor: SqlExecutor,
		accountUserId: string,
		rootEventId: string,
		deviceId: string,
	) => void | Promise<void>;
	onRootReadStarted?: (
		accountUserId: string,
		rootEventId: string,
	) => string | Promise<string>;
	onRootReadFinished?: (
		accountUserId: string,
		rootEventId: string,
		verificationId: string,
	) => void | Promise<void>;
	onRootPurged?: (
		accountUserId: string,
		rootEventId: string,
	) => void | Promise<void>;
	now?: () => Date;
	random?: () => number;
	randomUUID: () => string;
	sha256?: (value: string) => string | Promise<string>;
}

export interface SequenceFailureRecoveryOptions {
	newDeviceId: () => string;
	randomUUID: () => string;
	now?: () => Date;
	rootEventId?: string;
	sha256?: (value: string) => string | Promise<string>;
}

interface OutboxRow {
	account_user_id: string;
	client_mutation_id: string;
	root_event_id: string;
	device_id: string;
	client_sequence: number;
	operation_id: OutboxItem["operationId"];
	command_json: string;
	command_fingerprint: string;
	optimistic_overlay_json: string;
	http_idempotency_key: string | null;
	state: OutboxState;
	attempts: number;
	next_attempt_at: string | null;
	lease_owner: string | null;
	lease_expires_at: string | null;
	applied_root_revision: string | null;
	server_consumed: number;
	blocked_until_pull: number;
	last_error_code: SyncFailureCode | null;
	last_request_id: string | null;
	current_version: number | null;
	authoritative_order_json: string | null;
	created_at: string;
	updated_at: string;
}

interface PushBatchRow {
	account_user_id: string;
	root_event_id: string;
	device_id: string;
	idempotency_key: string;
	body_json: string;
	body_fingerprint: string;
	mutation_ids_json: string;
	lease_owner: string | null;
	lease_expires_at: string | null;
	created_at: string;
}

interface GolfIntentRecoveryRow {
	account_user_id: string;
	client_intent_id: string;
	root_event_id: string;
	event_id: string;
	score_id: string;
	user_id: string;
	hole: number;
	client_sequence: number;
	outbox_client_mutation_id: string | null;
	base_version: number;
	strokes: number | null;
	putts: number | null;
	playing_handicap: number;
	handicap_strokes: number;
	net_strokes: number | null;
	stableford_points: number;
	command_json: string;
	state: GolfScoreIntent["state"];
	applied_entity_version: number | null;
	created_at: string;
	updated_at: string;
}

type OutboxEvidenceSourceRow = Pick<
	OutboxRow,
	| "account_user_id"
	| "client_mutation_id"
	| "client_sequence"
	| "operation_id"
	| "command_json"
	| "command_fingerprint"
	| "http_idempotency_key"
	| "state"
>;
type PushBatchEvidenceSourceRow = Pick<
	PushBatchRow,
	"idempotency_key" | "body_json" | "body_fingerprint" | "mutation_ids_json"
>;

interface ClaimedPushBatch {
	row: PushBatchRow;
	body: SyncPushBody;
	mutationIds: string[];
	leaseOwner: string;
}

const MAX_SYNC_BODY_BYTES = 1024 * 1024;
const MAX_SYNC_MUTATIONS = 100;
const MAX_OUTBOX_EVIDENCE_ROWS = 100;
const MAX_CLIENT_SEQUENCE = Number.MAX_SAFE_INTEGER - 1;
const LEASE_MS = 2 * 60 * 1000;
const MAX_RETRY_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 20;
const MAX_RETRY_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();
const userIdPattern = /^usr_[a-f0-9]{32}$/;
const rootIdPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const attachmentIdPattern = /^att_[A-Za-z0-9._:-]{1,96}$/;
const uploadIdPattern = /^upl_[A-Za-z0-9._:-]{1,96}$/;
const eventIdPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const teamIdPattern = /^ttm_[A-Za-z0-9._:-]{1,96}$/;
const decisionIdPattern = /^tdc_[A-Za-z0-9._:-]{1,96}$/;
const optionIdPattern = /^tdo_[A-Za-z0-9._:-]{1,96}$/;
const teamColorPattern = /^#[0-9A-F]{6}$/;
const deviceIdPattern =
	/^dvc_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const uuidV4Pattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class MobileSyncAccountChangedError extends Error {
	constructor() {
		super("Active account changed during sync");
		this.name = "MobileSyncAccountChangedError";
	}
}

export class MobileSyncRootAccessDeniedError extends Error {
	constructor() {
		super("Event access is unavailable");
		this.name = "MobileSyncRootAccessDeniedError";
	}
}

export class MobileSyncPublicationInProgressError extends Error {
	constructor() {
		super("Event publication must finish before another local change");
		this.name = "MobileSyncPublicationInProgressError";
	}
}

export class SequenceFailureRecoveryDeferredError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SequenceFailureRecoveryDeferredError";
	}
}

/**
 * Stored `sequence` failures cover non-consuming stream-integrity rejections.
 * Rotate that root's transport identity and replace only a provably safe
 * rejected/unconsumed tail so shipped failures do not remain permanently stuck.
 */
export async function recoverSequenceFailureStreams(
	database: SqlDatabase,
	accountUserId: string,
	options: SequenceFailureRecoveryOptions,
): Promise<number> {
	validateAccount(accountUserId);
	if (options.rootEventId) validateRoot(options.rootEventId);
	const timestamp = recoveryTimestamp(options.now ?? (() => new Date()));
	const digest = options.sha256 ?? sha256Hex;
	const sha256 = async (value: string) => {
		const result = await digest(value);
		if (!/^[a-f0-9]{64}$/.test(result)) {
			throw new Error("SHA-256 provider returned an invalid lowercase digest");
		}
		return result;
	};

	return database.transaction(async (transaction) => {
		const failures = await transaction.all<{
			device_id: string;
			failure_count: number;
			first_sequence: number;
			root_event_id: string;
		}>(
			options.rootEventId
				? `SELECT root_event_id, device_id, COUNT(*) AS failure_count,
  MIN(client_sequence) AS first_sequence
FROM mutation_outbox
WHERE account_user_id = ? AND root_event_id = ?
  AND operation_id = 'syncMutationsApply' AND state = 'dead_letter'
  AND last_error_code = 'sequence'
GROUP BY root_event_id, device_id
ORDER BY root_event_id, device_id`
				: `SELECT root_event_id, device_id, COUNT(*) AS failure_count,
  MIN(client_sequence) AS first_sequence
FROM mutation_outbox
WHERE account_user_id = ? AND operation_id = 'syncMutationsApply'
  AND state = 'dead_letter' AND last_error_code = 'sequence'
GROUP BY root_event_id, device_id
ORDER BY root_event_id, device_id`,
			options.rootEventId
				? [accountUserId, options.rootEventId]
				: [accountUserId],
		);
		const recoveredRoots = new Set<string>();
		for (const failure of failures) {
			validateRoot(failure.root_event_id);
			validateDevice(failure.device_id);
			if (recoveredRoots.has(failure.root_event_id)) {
				throw new SequenceFailureRecoveryDeferredError(
					"Multiple compromised mutation streams share one root",
				);
			}
			if (Number(failure.failure_count) !== 1) {
				throw new SequenceFailureRecoveryDeferredError(
					"Compromised mutation stream has multiple failures",
				);
			}
			const firstSequence = Number(failure.first_sequence);
			if (!Number.isSafeInteger(firstSequence) || firstSequence < 1) {
				throw new Error("Invalid compromised mutation sequence");
			}
			const identity = await transaction.first<{ device_id: string }>(
				`SELECT device_id FROM mutation_stream_identities
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, failure.root_event_id],
			);
			if (identity?.device_id !== failure.device_id) {
				throw new SequenceFailureRecoveryDeferredError(
					"Compromised mutation stream is no longer current",
				);
			}
			const ambiguous = await transaction.first(
				`SELECT 1 FROM mutation_outbox
WHERE account_user_id = ? AND root_event_id = ? AND device_id = ?
  AND operation_id = 'syncMutationsApply'
  AND (
    (server_consumed = 1 AND NOT (
      state = 'dead_letter' AND last_error_code = 'sequence'
    )) OR
    state IN ('sending', 'awaiting_pull') OR
    lease_owner IS NOT NULL OR lease_expires_at IS NOT NULL
  )
LIMIT 1`,
				[accountUserId, failure.root_event_id, failure.device_id],
			);
			const persistedBatch = await transaction.first(
				`SELECT 1 FROM sync_push_batches
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, failure.root_event_id],
			);
			if (ambiguous || persistedBatch) {
				throw new SequenceFailureRecoveryDeferredError(
					"Compromised mutation stream has an uncertain outcome",
				);
			}
			const uncertain = await transaction.first(
				`SELECT 1 FROM mutation_outbox
WHERE account_user_id = ? AND root_event_id = ? AND device_id = ?
  AND operation_id = 'syncMutationsApply' AND server_consumed = 0
  AND (
    client_sequence < ? OR
    (client_sequence >= ? AND state NOT IN ('pending', 'blocked', 'dead_letter'))
  )
LIMIT 1`,
				[
					accountUserId,
					failure.root_event_id,
					failure.device_id,
					firstSequence,
					firstSequence,
				],
			);
			if (uncertain) {
				throw new SequenceFailureRecoveryDeferredError(
					"Compromised mutation stream has an uncertain outcome",
				);
			}
			const rows = await transaction.all<OutboxRow>(
				`SELECT * FROM mutation_outbox
WHERE account_user_id = ? AND root_event_id = ? AND device_id = ?
  AND operation_id = 'syncMutationsApply' AND client_sequence >= ?
  AND (
    (state = 'dead_letter' AND last_error_code = 'sequence') OR
    (server_consumed = 0 AND state IN ('pending', 'blocked'))
  )
ORDER BY client_sequence, client_mutation_id`,
				[
					accountUserId,
					failure.root_event_id,
					failure.device_id,
					firstSequence,
				],
			);
			if (
				rows.length === 0 ||
				rows[0]?.state !== "dead_letter" ||
				rows[0]?.last_error_code !== "sequence" ||
				Number(rows[0]?.client_sequence) !== firstSequence
			) {
				throw new Error("Compromised mutation stream head is missing");
			}
			const recoverableCount = await transaction.first<{ count: number }>(
				`SELECT COUNT(*) AS count FROM mutation_outbox
WHERE account_user_id = ? AND root_event_id = ? AND device_id = ?
  AND operation_id = 'syncMutationsApply' AND client_sequence >= ?`,
				[
					accountUserId,
					failure.root_event_id,
					failure.device_id,
					firstSequence,
				],
			);
			if (Number(recoverableCount?.count) !== rows.length) {
				throw new SequenceFailureRecoveryDeferredError(
					"Compromised mutation stream tail is not recoverable",
				);
			}
			if (
				rows.some(
					(row, index) => Number(row.client_sequence) !== firstSequence + index,
				)
			) {
				throw new SequenceFailureRecoveryDeferredError(
					"Compromised mutation stream tail has a sequence gap",
				);
			}
			if (rows.length >= MAX_CLIENT_SEQUENCE) {
				throw new SequenceFailureRecoveryDeferredError(
					"Replacement mutation stream is exhausted",
				);
			}

			const replacementDeviceId = recoveryDeviceId(options.newDeviceId);
			if (replacementDeviceId === failure.device_id) {
				throw new SequenceFailureRecoveryDeferredError(
					"Replacement mutation stream identity was reused",
				);
			}
			const occupiedDevice = await transaction.first(
				`SELECT 1 FROM mutation_streams
WHERE account_user_id = ? AND device_id = ?
UNION ALL
SELECT 1 FROM mutation_stream_identities
WHERE account_user_id = ? AND device_id = ?
LIMIT 1`,
				[
					accountUserId,
					replacementDeviceId,
					accountUserId,
					replacementDeviceId,
				],
			);
			if (occupiedDevice) {
				throw new SequenceFailureRecoveryDeferredError(
					"Replacement mutation stream identity already exists",
				);
			}

			const replacedMutationIds = new Set(
				rows.map((row) => row.client_mutation_id),
			);
			const replacements: Array<{
				commandJson: string;
				fingerprint: string;
				golfIntent: GolfIntentRecoveryRow | null;
				id: string;
				overlayJson: string;
				row: OutboxRow;
				sequence: number;
			}> = [];
			for (const [index, row] of rows.entries()) {
				await verifyRow(row, sha256);
				const persisted = canonicalizePersistedMutation(
					parseJson<unknown>(row.command_json),
					accountUserId,
				);
				if (
					persisted.clientMutationId !== row.client_mutation_id ||
					persisted.clientSequence !== Number(row.client_sequence)
				) {
					throw new Error("Persisted mutation identity mismatch");
				}
				const overlayJson = recoveredOverlayJson(
					row.optimistic_overlay_json,
					replacedMutationIds,
				);
				const id = recoveryUuid(options.randomUUID);
				const occupiedMutation = await transaction.first(
					`SELECT 1 FROM mutation_outbox
WHERE account_user_id = ? AND client_mutation_id = ?`,
					[accountUserId, id],
				);
				if (occupiedMutation || replacements.some((item) => item.id === id)) {
					throw new SequenceFailureRecoveryDeferredError(
						"Replacement mutation identity already exists",
					);
				}
				const sequence = index + 1;
				const commandJson = serializeJson({
					...canonicalizeMutationDraft(persisted, accountUserId),
					clientMutationId: id,
					clientSequence: sequence,
				} satisfies SyncMutation);
				const golfIntent = await transaction.first<GolfIntentRecoveryRow>(
					`SELECT * FROM golf_score_intents
WHERE account_user_id = ? AND outbox_client_mutation_id = ?`,
					[accountUserId, row.client_mutation_id],
				);
				if (
					golfIntent &&
					(golfIntent.state !== "pending" ||
						persisted.kind !== "golf.score.set")
				) {
					throw new Error("Compromised golf score intent cannot be replaced");
				}
				replacements.push({
					commandJson,
					fingerprint: await sha256(commandJson),
					golfIntent,
					id,
					overlayJson,
					row,
					sequence,
				});
			}

			for (const replacement of replacements) {
				if (replacement.golfIntent) {
					await transaction.run(
						`DELETE FROM golf_score_intents
WHERE account_user_id = ? AND client_intent_id = ?`,
						[accountUserId, replacement.golfIntent.client_intent_id],
					);
				}
				await transaction.run(
					`DELETE FROM mutation_outbox
WHERE account_user_id = ? AND client_mutation_id = ?`,
					[accountUserId, replacement.row.client_mutation_id],
				);
			}
			await transaction.run(
				`INSERT INTO mutation_streams (
  account_user_id, root_event_id, device_id, next_client_sequence
) VALUES (?, ?, ?, ?)`,
				[
					accountUserId,
					failure.root_event_id,
					replacementDeviceId,
					replacements.length + 1,
				],
			);
			await transaction.run(
				`INSERT INTO mutation_stream_identities (
  account_user_id, root_event_id, device_id, created_at
) VALUES (?, ?, ?, ?)
ON CONFLICT (account_user_id, root_event_id) DO UPDATE SET
  device_id = excluded.device_id, created_at = excluded.created_at`,
				[accountUserId, failure.root_event_id, replacementDeviceId, timestamp],
			);
			for (const replacement of replacements) {
				await transaction.run(
					`INSERT INTO mutation_outbox (
  account_user_id, client_mutation_id, root_event_id, device_id,
  client_sequence, operation_id, command_json, command_fingerprint,
  optimistic_overlay_json, state, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, 'syncMutationsApply', ?, ?, ?, 'pending', ?, ?)`,
					[
						accountUserId,
						replacement.id,
						failure.root_event_id,
						replacementDeviceId,
						replacement.sequence,
						replacement.commandJson,
						replacement.fingerprint,
						replacement.overlayJson,
						replacement.row.created_at,
						replacement.row.updated_at,
					],
				);
				if (replacement.golfIntent) {
					await insertRecoveredGolfIntent(
						transaction,
						replacement.golfIntent,
						replacement.id,
					);
				}
			}
			await transaction.run(
				`DELETE FROM mutation_streams
WHERE account_user_id = ? AND root_event_id = ? AND device_id = ?
  AND NOT EXISTS (
    SELECT 1 FROM mutation_outbox
    WHERE account_user_id = ? AND root_event_id = ? AND device_id = ?
  )
  AND NOT EXISTS (
    SELECT 1 FROM sync_push_batches
    WHERE account_user_id = ? AND root_event_id = ? AND device_id = ?
  )`,
				[
					accountUserId,
					failure.root_event_id,
					failure.device_id,
					accountUserId,
					failure.root_event_id,
					failure.device_id,
					accountUserId,
					failure.root_event_id,
					failure.device_id,
				],
			);
			recoveredRoots.add(failure.root_event_id);
		}
		return recoveredRoots.size;
	});
}

export class MobileSyncEngine {
	readonly #store: MobileDataStore;
	readonly #activeAccountUserId: MobileSyncEngineOptions["activeAccountUserId"];
	readonly #assertMutationStreamIdentity: NonNullable<
		MobileSyncEngineOptions["assertMutationStreamIdentity"]
	>;
	readonly #onRootReadStarted: MobileSyncEngineOptions["onRootReadStarted"];
	readonly #onRootReadFinished: MobileSyncEngineOptions["onRootReadFinished"];
	readonly #onRootPurged: NonNullable<MobileSyncEngineOptions["onRootPurged"]>;
	readonly #now: () => Date;
	readonly #random: () => number;
	readonly #randomUUID: () => string;
	readonly #sha256: (value: string) => Promise<string>;
	readonly #flights = new Map<string, Promise<SyncStatus>>();

	constructor(
		private readonly database: SqlDatabase,
		private readonly client: Pick<GatewayClient, "request">,
		options: MobileSyncEngineOptions,
	) {
		this.#store = new MobileDataStore(database);
		this.#activeAccountUserId = options.activeAccountUserId;
		this.#assertMutationStreamIdentity =
			options.assertMutationStreamIdentity ?? (() => undefined);
		if (
			Boolean(options.onRootReadStarted) !== Boolean(options.onRootReadFinished)
		) {
			throw new Error("Root read verification hooks must be paired");
		}
		this.#onRootReadStarted = options.onRootReadStarted;
		this.#onRootReadFinished = options.onRootReadFinished;
		this.#onRootPurged = options.onRootPurged ?? (() => undefined);
		this.#now = options.now ?? (() => new Date());
		this.#random = options.random ?? Math.random;
		this.#randomUUID = options.randomUUID;
		const digest = options.sha256 ?? sha256Hex;
		this.#sha256 = async (value) => {
			const result = await digest(value);
			if (!/^[a-f0-9]{64}$/.test(result)) {
				throw new Error(
					"SHA-256 provider returned an invalid lowercase digest",
				);
			}
			return result;
		};
	}

	async enqueueRootCreate(
		accountUserId: string,
		deviceId: string,
		command: RootCreateCommand,
		optimisticOverlay: unknown = command,
	): Promise<OutboxItem> {
		validateAccount(accountUserId);
		const canonicalCommand = canonicalizeRootCreateCommand(command);
		validateRoot(canonicalCommand.id);
		validateDevice(deviceId);
		const clientMutationId = this.#newUuid();
		const commandJson = serializeJson(canonicalCommand);
		const overlayJson = serializeJson(optimisticOverlay);
		const fingerprint = await this.#sha256(commandJson);
		const timestamp = this.#timestamp();
		await this.database.transaction(async (transaction) => {
			await transaction.run(
				`INSERT INTO root_sync_state (
  account_user_id, root_event_id, pull_cursor, snapshot_id, snapshot_revision,
  authorization_scope_version, last_completed_sync_at
) VALUES (?, ?, NULL, NULL, NULL, '1', NULL)
ON CONFLICT (account_user_id, root_event_id) DO NOTHING`,
				[accountUserId, canonicalCommand.id],
			);
			await this.#assertMutationStreamIdentity(
				transaction,
				accountUserId,
				canonicalCommand.id,
				deviceId,
			);
			await ensureStream(
				transaction,
				accountUserId,
				canonicalCommand.id,
				deviceId,
			);
			await transaction.run(
				`INSERT INTO mutation_outbox (
  account_user_id, client_mutation_id, root_event_id, device_id,
  client_sequence, operation_id, command_json, command_fingerprint,
  optimistic_overlay_json, http_idempotency_key, state, created_at, updated_at
) VALUES (?, ?, ?, ?, 0, 'eventsCreate', ?, ?, ?, ?, 'pending', ?, ?)`,
				[
					accountUserId,
					clientMutationId,
					canonicalCommand.id,
					deviceId,
					commandJson,
					fingerprint,
					overlayJson,
					`root-${clientMutationId}`,
					timestamp,
					timestamp,
				],
			);
		});
		return this.#requiredItem(accountUserId, clientMutationId);
	}

	async enqueueMutation(
		accountUserId: string,
		rootEventId: string,
		deviceId: string,
		command: SyncMutationDraft,
		optimisticOverlay: unknown,
	): Promise<OutboxItem> {
		validateAccount(accountUserId);
		validateRoot(rootEventId);
		validateDevice(deviceId);
		if (command.kind === "golf.score.set") {
			throw new Error("Use enqueueGolfScore for golf score mutations");
		}
		const clientMutationId = this.#newUuid();
		const timestamp = this.#timestamp();
		await this.database.transaction((transaction) =>
			this.#enqueueMutationRow(
				transaction,
				accountUserId,
				rootEventId,
				deviceId,
				clientMutationId,
				command,
				optimisticOverlay,
				timestamp,
			),
		);
		return this.#requiredItem(accountUserId, clientMutationId);
	}

	async enqueueTeamAssignments(
		accountUserId: string,
		rootEventId: string,
		deviceId: string,
		input: {
			eventId: string;
			baseVersion: number;
			teams: TeamAssignmentsMutationDraft["payload"]["teams"];
		},
	): Promise<OutboxItem> {
		const command: TeamAssignmentsMutationDraft = {
			kind: "team.assignments.publish",
			entityId: input.eventId,
			baseVersion: input.baseVersion,
			payload: { eventId: input.eventId, teams: input.teams },
		};
		const canonical = canonicalizeMutationDraft(
			command,
			accountUserId,
		) as TeamAssignmentsMutationDraft;
		return this.enqueueMutation(
			accountUserId,
			rootEventId,
			deviceId,
			canonical,
			canonical,
		);
	}

	async enqueueTeamDecision(
		accountUserId: string,
		rootEventId: string,
		deviceId: string,
		input: {
			eventId: string;
			decisionId: string;
			baseVersion: number;
			title: string;
			state: TeamDecisionMutationDraft["payload"]["state"];
			options: TeamDecisionMutationDraft["payload"]["options"];
		},
	): Promise<OutboxItem> {
		const command: TeamDecisionMutationDraft = {
			kind: "team.decision.replace",
			entityId: input.decisionId,
			baseVersion: input.baseVersion,
			payload: {
				eventId: input.eventId,
				title: input.title,
				state: input.state,
				options: input.options,
			},
		};
		const canonical = canonicalizeMutationDraft(
			command,
			accountUserId,
		) as TeamDecisionMutationDraft;
		return this.enqueueMutation(
			accountUserId,
			rootEventId,
			deviceId,
			canonical,
			canonical,
		);
	}

	async enqueueTeamResponse(
		accountUserId: string,
		rootEventId: string,
		deviceId: string,
		input: {
			eventId: string;
			decisionId: string;
			optionId: string;
			baseVersion: number;
		},
	): Promise<OutboxItem> {
		const command: TeamResponseMutationDraft = {
			kind: "team.response.set",
			entityId: teamResponseEntityId(input.decisionId, accountUserId),
			baseVersion: input.baseVersion,
			payload: {
				eventId: input.eventId,
				decisionId: input.decisionId,
				optionId: input.optionId,
			},
		};
		const canonical = canonicalizeMutationDraft(
			command,
			accountUserId,
		) as TeamResponseMutationDraft;
		return this.enqueueMutation(
			accountUserId,
			rootEventId,
			deviceId,
			canonical,
			canonical,
		);
	}

	async enqueueGolfScore(
		input: GolfScoreIntentInput,
		deviceId: string,
	): Promise<GolfScoreEnqueueResult> {
		validateAccount(input.accountUserId);
		validateRoot(input.rootEventId);
		validateDevice(deviceId);
		const timestamp = this.#timestamp();
		const linked = await this.database.transaction(async (transaction) => {
			const intent = await enqueueGolfScoreIntent(
				transaction,
				input,
				timestamp,
			);
			if (intent.outboxClientMutationId !== null) {
				const outbox = await transaction.first(
					`SELECT 1 FROM mutation_outbox
WHERE account_user_id = ? AND client_mutation_id = ?`,
					[input.accountUserId, intent.outboxClientMutationId],
				);
				if (!outbox && intent.state !== "converged") {
					throw new Error("Golf score intent outbox mutation is missing");
				}
				return {
					intent,
					clientMutationId: outbox ? intent.outboxClientMutationId : null,
				};
			}
			if (intent.state !== "pending") {
				if (intent.state !== "converged")
					throw new Error(
						"Golf score intent is acknowledged without an outbox link",
					);
				return { intent, clientMutationId: null };
			}
			const clientMutationId = this.#newUuid();
			const command: GolfScoreMutationDraft = {
				kind: "golf.score.set",
				entityId: intent.scoreId,
				baseVersion: intent.baseVersion,
				payload: {
					eventId: intent.eventId,
					hole: intent.hole,
					strokes: intent.strokes,
					putts: intent.putts,
				},
			};
			await this.#enqueueMutationRow(
				transaction,
				input.accountUserId,
				input.rootEventId,
				deviceId,
				clientMutationId,
				command,
				{ kind: "golfScoreIntent", clientIntentId: input.clientIntentId },
				timestamp,
			);
			return {
				intent: await linkGolfScoreIntentToOutbox(
					transaction,
					input.accountUserId,
					input.clientIntentId,
					clientMutationId,
				),
				clientMutationId,
			};
		});
		return {
			intent: linked.intent,
			outbox:
				linked.clientMutationId === null
					? null
					: await this.#requiredItem(
							input.accountUserId,
							linked.clientMutationId,
						),
		};
	}

	async #enqueueMutationRow(
		transaction: SqlExecutor,
		accountUserId: string,
		rootEventId: string,
		deviceId: string,
		clientMutationId: string,
		command: SyncMutationDraft,
		optimisticOverlay: unknown,
		timestamp: string,
	): Promise<void> {
		const root = await transaction.first(
			`SELECT 1 FROM root_sync_state
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
		if (!root) throw new Error("Root must be bootstrapped before enqueue");
		await this.#assertMutationStreamIdentity(
			transaction,
			accountUserId,
			rootEventId,
			deviceId,
		);
		await transaction.run(
			`DELETE FROM event_publish_guards
WHERE account_user_id = ? AND root_event_id = ? AND expires_at <= ?`,
			[accountUserId, rootEventId, timestamp],
		);
		const publication = await transaction.first(
			`SELECT 1 FROM event_publish_guards
WHERE account_user_id = ? AND root_event_id = ?
UNION ALL
SELECT 1 FROM event_publish_attempts
WHERE account_user_id = ? AND root_event_id = ? AND conflicted_at IS NULL
LIMIT 1`,
			[accountUserId, rootEventId, accountUserId, rootEventId],
		);
		if (publication) throw new MobileSyncPublicationInProgressError();
		const canonicalCommand = canonicalizeMutationDraft(command, accountUserId);
		await assertTeamMutationAuthorized(
			transaction,
			accountUserId,
			rootEventId,
			canonicalCommand,
		);
		await ensureStream(transaction, accountUserId, rootEventId, deviceId);
		const stream = await transaction.first<{ next_client_sequence: number }>(
			`SELECT next_client_sequence FROM mutation_streams
WHERE account_user_id = ? AND root_event_id = ? AND device_id = ?`,
			[accountUserId, rootEventId, deviceId],
		);
		const clientSequence = Number(stream?.next_client_sequence);
		if (
			!Number.isSafeInteger(clientSequence) ||
			clientSequence < 1 ||
			clientSequence > MAX_CLIENT_SEQUENCE
		) {
			throw new Error("Client mutation sequence is exhausted");
		}
		const mutation = {
			...canonicalCommand,
			clientMutationId,
			clientSequence,
		} as SyncMutation;
		const commandJson = serializeJson(mutation);
		const envelope = serializeJson({
			protocolVersion: 1,
			rootEventId,
			deviceId,
			mutations: [mutation],
		} satisfies SyncPushBody);
		if (encoder.encode(envelope).byteLength > MAX_SYNC_BODY_BYTES) {
			throw new Error("Mutation exceeds the sync request size limit");
		}
		await transaction.run(
			`INSERT INTO mutation_outbox (
  account_user_id, client_mutation_id, root_event_id, device_id,
  client_sequence, operation_id, command_json, command_fingerprint,
  optimistic_overlay_json, state, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, 'syncMutationsApply', ?, ?, ?, 'pending', ?, ?)`,
			[
				accountUserId,
				clientMutationId,
				rootEventId,
				deviceId,
				clientSequence,
				commandJson,
				await this.#sha256(commandJson),
				serializeJson(optimisticOverlay),
				timestamp,
				timestamp,
			],
		);
		await transaction.run(
			`UPDATE mutation_streams SET next_client_sequence = ?
WHERE account_user_id = ? AND root_event_id = ? AND device_id = ?`,
			[clientSequence + 1, accountUserId, rootEventId, deviceId],
		);
	}

	async listOutbox(
		accountUserId: string,
		rootEventId: string,
	): Promise<readonly OutboxItem[]> {
		validateAccount(accountUserId);
		validateRoot(rootEventId);
		const rows = await this.database.all<OutboxRow>(
			`SELECT * FROM mutation_outbox
WHERE account_user_id = ? AND root_event_id = ?
ORDER BY client_sequence, client_mutation_id`,
			[accountUserId, rootEventId],
		);
		return Promise.all(rows.map((row) => mapOutboxItem(row, this.#sha256)));
	}

	async listRootCreations(
		accountUserId: string,
	): Promise<readonly OutboxItem[]> {
		validateAccount(accountUserId);
		const rows = await this.database.all<OutboxRow>(
			`SELECT * FROM mutation_outbox
WHERE account_user_id = ? AND operation_id = 'eventsCreate'
ORDER BY created_at, client_mutation_id`,
			[accountUserId],
		);
		return Promise.all(rows.map((row) => mapOutboxItem(row, this.#sha256)));
	}

	async listOptimisticMutations(
		accountUserId: string,
		rootEventId: string,
	): Promise<readonly OutboxItem[]> {
		return (await this.listOutbox(accountUserId, rootEventId)).filter(
			(item) => item.state !== "dead_letter",
		);
	}

	async readOutboxEvidence(
		accountUserId: string,
		rootEventId: string,
	): Promise<OutboxEvidence> {
		validateAccount(accountUserId);
		validateRoot(rootEventId);
		await this.#assertActiveAccount(accountUserId);
		const counts = await this.database.first<{
			pending_count: number;
			attention_count: number;
		}>(
			`SELECT
  COALESCE(SUM(CASE WHEN state IN ('pending', 'sending', 'awaiting_pull', 'blocked') THEN 1 ELSE 0 END), 0) AS pending_count,
  COALESCE(SUM(CASE WHEN state = 'dead_letter' THEN 1 ELSE 0 END), 0) AS attention_count
FROM mutation_outbox WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
		const syncState = await this.database.first<{ pull_cursor: string | null }>(
			`SELECT pull_cursor FROM root_sync_state
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
		const persistedRows = await this.database.all<OutboxEvidenceSourceRow>(
			`SELECT account_user_id, client_mutation_id, client_sequence, operation_id,
       command_json, command_fingerprint, http_idempotency_key, state
FROM mutation_outbox
WHERE account_user_id = ? AND root_event_id = ?
ORDER BY client_sequence, client_mutation_id
LIMIT ?`,
			[accountUserId, rootEventId, MAX_OUTBOX_EVIDENCE_ROWS + 1],
		);
		const batch = await this.database.first<PushBatchEvidenceSourceRow>(
			`SELECT idempotency_key, body_json, body_fingerprint, mutation_ids_json
FROM sync_push_batches
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
		const batchMutationIds = new Set(
			batch ? parseStringArray(batch.mutation_ids_json) : [],
		);
		const batchBodyFingerprint = batch
			? await this.#sha256(batch.body_json)
			: null;
		if (batch && batchBodyFingerprint !== batch.body_fingerprint) {
			throw new Error("Persisted sync batch fingerprint mismatch");
		}
		const batchKeyFingerprint = batch
			? await this.#sha256(batch.idempotency_key)
			: null;
		const rows = await Promise.all(
			persistedRows.slice(0, MAX_OUTBOX_EVIDENCE_ROWS).map(async (row) => {
				await verifyRow(row, this.#sha256);
				validateEvidenceRow(row);
				const inBatch = batchMutationIds.has(row.client_mutation_id);
				const rootCreate = row.operation_id === "eventsCreate";
				return {
					state: row.state,
					mutationKind: evidenceMutationKind(row),
					clientSequence: Number(row.client_sequence),
					commandBodyFingerprint: row.command_fingerprint,
					requestBodyFingerprint: rootCreate
						? row.command_fingerprint
						: inBatch
							? batchBodyFingerprint
							: null,
					idempotencyKeyFingerprint: rootCreate
						? await this.#sha256(required(row.http_idempotency_key))
						: inBatch
							? batchKeyFingerprint
							: null,
				} satisfies OutboxEvidenceRow;
			}),
		);
		const pullCursorFingerprint =
			syncState?.pull_cursor === null || syncState === null
				? null
				: await this.#sha256(syncState.pull_cursor);
		await this.#assertActiveAccount(accountUserId);
		return {
			pendingCount: evidenceCount(counts?.pending_count),
			attentionCount: evidenceCount(counts?.attention_count),
			pullCursorFingerprint,
			truncated: persistedRows.length > MAX_OUTBOX_EVIDENCE_ROWS,
			rows,
		};
	}

	async getStatus(
		accountUserId: string,
		rootEventId: string,
	): Promise<SyncStatus> {
		validateAccount(accountUserId);
		validateRoot(rootEventId);
		const counts = await this.database.first<{
			pending_count: number;
			sending_count: number;
			awaiting_count: number;
			blocked_count: number;
			attention_count: number;
			auth_count: number;
			next_attempt_at: string | null;
		}>(
			`SELECT
  COALESCE(SUM(CASE WHEN state = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
  COALESCE(SUM(CASE WHEN state = 'sending' THEN 1 ELSE 0 END), 0) AS sending_count,
  COALESCE(SUM(CASE WHEN state = 'awaiting_pull' THEN 1 ELSE 0 END), 0) AS awaiting_count,
  COALESCE(SUM(CASE WHEN state = 'blocked' THEN 1 ELSE 0 END), 0) AS blocked_count,
  COALESCE(SUM(CASE WHEN state = 'dead_letter' THEN 1 ELSE 0 END), 0) AS attention_count,
  COALESCE(SUM(CASE WHEN last_error_code = 'auth_required' THEN 1 ELSE 0 END), 0) AS auth_count,
  MIN(CASE WHEN state IN ('pending', 'blocked') THEN next_attempt_at END) AS next_attempt_at
FROM mutation_outbox WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
		const staging = await this.database.first<{ count: number }>(
			`SELECT COUNT(*) AS count FROM sync_snapshot_staging
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
		const pending = Number(counts?.pending_count ?? 0);
		const sending = Number(counts?.sending_count ?? 0);
		const awaiting = Number(counts?.awaiting_count ?? 0);
		const blocked = Number(counts?.blocked_count ?? 0);
		const attention = Number(counts?.attention_count ?? 0);
		const auth = Number(counts?.auth_count ?? 0);
		const pendingCount = pending + sending + awaiting + blocked;
		if (Number(staging?.count ?? 0) > 0) {
			return status(
				"resetting",
				"Eventdaten werden aktualisiert",
				pendingCount,
				attention,
				counts?.next_attempt_at ?? null,
			);
		}
		if (attention > 0) {
			return status(
				"needs_attention",
				"Aktion erforderlich",
				pendingCount,
				attention,
				counts?.next_attempt_at ?? null,
			);
		}
		if (auth > 0) {
			return status("blocked", "Anmeldung erforderlich", pendingCount, 0, null);
		}
		if (blocked > 0) {
			return status(
				"blocked",
				"Wird abgeglichen",
				pendingCount,
				0,
				counts?.next_attempt_at ?? null,
			);
		}
		if (sending + awaiting > 0) {
			return status(
				"syncing",
				"Wird gespeichert",
				pendingCount,
				0,
				counts?.next_attempt_at ?? null,
			);
		}
		if (pending > 0 && counts?.next_attempt_at) {
			return status(
				"waiting_retry",
				"Neuer Versuch geplant",
				pendingCount,
				0,
				counts.next_attempt_at,
			);
		}
		if (pending > 0) {
			return status("pending", "Wartet auf Verbindung", pendingCount, 0, null);
		}
		return status("synced", "Synchronisiert", 0, 0, null);
	}

	async retryNow(accountUserId: string, rootEventId: string): Promise<void> {
		validateAccount(accountUserId);
		validateRoot(rootEventId);
		await this.database.run(
			`UPDATE mutation_outbox SET next_attempt_at = NULL, updated_at = ?
WHERE account_user_id = ? AND root_event_id = ?
  AND state IN ('pending', 'blocked') AND blocked_until_pull = 0`,
			[this.#timestamp(), accountUserId, rootEventId],
		);
	}

	async retryExhausted(
		accountUserId: string,
		rootEventId: string,
	): Promise<void> {
		validateAccount(accountUserId);
		validateRoot(rootEventId);
		await this.database.run(
			`UPDATE mutation_outbox SET state = 'pending', attempts = 0,
  next_attempt_at = NULL, blocked_until_pull = 0, last_error_code = NULL,
  last_request_id = NULL, updated_at = ?
WHERE account_user_id = ? AND root_event_id = ?
  AND last_error_code = 'retry_exhausted'
  AND state IN ('dead_letter', 'blocked')`,
			[this.#timestamp(), accountUserId, rootEventId],
		);
	}

	async reviseFailedRootCreate(
		accountUserId: string,
		clientMutationId: string,
		command: RootCreateCommand,
		optimisticOverlay: unknown = command,
	): Promise<OutboxItem> {
		validateAccount(accountUserId);
		const canonicalCommand = canonicalizeRootCreateCommand(command);
		validateRoot(canonicalCommand.id);
		const commandJson = serializeJson(canonicalCommand);
		const overlayJson = serializeJson(optimisticOverlay);
		const nextClientMutationId = this.#newUuid();
		const timestamp = this.#timestamp();
		await this.database.transaction(async (transaction) => {
			const row = await transaction.first<OutboxRow>(
				`SELECT * FROM mutation_outbox
WHERE account_user_id = ? AND client_mutation_id = ?`,
				[accountUserId, clientMutationId],
			);
			if (
				row?.operation_id !== "eventsCreate" ||
				row.state !== "dead_letter" ||
				row.server_consumed !== 0 ||
				row.last_error_code !== "invalid"
			) {
				throw new Error("Only rejected root creations can be revised");
			}
			await verifyRow(row, this.#sha256);
			const previous = parseJson<RootCreateCommand>(row.command_json);
			if (
				previous.id !== canonicalCommand.id ||
				row.root_event_id !== canonicalCommand.id
			) {
				throw new Error(
					"Revised root creation must preserve its root identity",
				);
			}
			await transaction.run(
				`DELETE FROM mutation_outbox
WHERE account_user_id = ? AND client_mutation_id = ?`,
				[accountUserId, clientMutationId],
			);
			await transaction.run(
				`INSERT INTO mutation_outbox (
  account_user_id, client_mutation_id, root_event_id, device_id,
  client_sequence, operation_id, command_json, command_fingerprint,
  optimistic_overlay_json, http_idempotency_key, state, created_at, updated_at
) VALUES (?, ?, ?, ?, 0, 'eventsCreate', ?, ?, ?, ?, 'pending', ?, ?)`,
				[
					accountUserId,
					nextClientMutationId,
					canonicalCommand.id,
					row.device_id,
					commandJson,
					await this.#sha256(commandJson),
					overlayJson,
					`root-${nextClientMutationId}`,
					timestamp,
					timestamp,
				],
			);
		});
		return this.#requiredItem(accountUserId, nextClientMutationId);
	}

	async discardDeadLetter(
		accountUserId: string,
		clientMutationId: string,
	): Promise<void> {
		validateAccount(accountUserId);
		await this.database.transaction(async (transaction) => {
			const item = await transaction.first<{
				state: OutboxState;
				server_consumed: number;
			}>(
				`SELECT state, server_consumed FROM mutation_outbox
WHERE account_user_id = ? AND client_mutation_id = ?`,
				[accountUserId, clientMutationId],
			);
			if (item?.state !== "dead_letter" || item.server_consumed !== 1) {
				throw new Error("Only server-consumed dead letters can be discarded");
			}
			const golfIntent = await transaction.first<{
				client_sequence: number;
				event_id: string;
				hole: number;
				putts: number | null;
				root_event_id: string;
				score_id: string;
				state: GolfScoreIntent["state"];
				strokes: number | null;
			}>(
				`SELECT client_sequence, event_id, hole, putts, root_event_id,
  score_id, state, strokes FROM golf_score_intents
WHERE account_user_id = ? AND outbox_client_mutation_id = ?`,
				[accountUserId, clientMutationId],
			);
			if (golfIntent && golfIntent.state !== "pending") {
				throw new Error("Only pending golf score intents can be discarded");
			}
			if (golfIntent) {
				const replacement = await transaction.first(
					`SELECT 1 FROM golf_score_intents intent
JOIN mutation_outbox outbox
  ON outbox.account_user_id = intent.account_user_id
 AND outbox.client_mutation_id = intent.outbox_client_mutation_id
WHERE intent.account_user_id = ? AND intent.root_event_id = ?
  AND intent.event_id = ? AND intent.score_id = ? AND intent.hole = ?
  AND intent.strokes IS ? AND intent.putts IS ?
  AND intent.client_sequence > ? AND intent.state IN ('pending', 'awaiting_pull')
  AND outbox.operation_id = 'syncMutationsApply'
  AND outbox.state IN ('pending', 'sending', 'awaiting_pull')
LIMIT 1`,
					[
						accountUserId,
						golfIntent.root_event_id,
						golfIntent.event_id,
						golfIntent.score_id,
						golfIntent.hole,
						golfIntent.strokes,
						golfIntent.putts,
						golfIntent.client_sequence,
					],
				);
				if (!replacement) {
					throw new Error(
						"Golf score conflicts require an identical durable replacement",
					);
				}
				await transaction.run(
					`DELETE FROM golf_score_intents
WHERE account_user_id = ? AND outbox_client_mutation_id = ?`,
					[accountUserId, clientMutationId],
				);
			}
			await transaction.run(
				`DELETE FROM mutation_outbox
WHERE account_user_id = ? AND client_mutation_id = ?`,
				[accountUserId, clientMutationId],
			);
		});
	}

	async syncRoot(
		accountUserId: string,
		rootEventId: string,
		options: { force?: boolean } = {},
	): Promise<SyncStatus> {
		validateAccount(accountUserId);
		validateRoot(rootEventId);
		const key = `${accountUserId}:${rootEventId}`;
		const active = this.#flights.get(key);
		if (active) return active;
		const flight = this.#runSync(
			accountUserId,
			rootEventId,
			options.force === true,
		);
		this.#flights.set(key, flight);
		try {
			return await flight;
		} finally {
			if (this.#flights.get(key) === flight) this.#flights.delete(key);
		}
	}

	async #runSync(
		accountUserId: string,
		rootEventId: string,
		force: boolean,
	): Promise<SyncStatus> {
		await this.#assertActiveAccount(accountUserId);
		if (await this.#rootCreateBlocksBootstrap(accountUserId, rootEventId)) {
			return this.getStatus(accountUserId, rootEventId);
		}
		if (force) await this.retryNow(accountUserId, rootEventId);
		const rootResult = await this.#sendRootCreate(accountUserId, rootEventId);
		if (rootResult === "paused")
			return this.getStatus(accountUserId, rootEventId);

		const staged = await this.#stagedCursor(accountUserId, rootEventId);
		let state = await this.#store.getRootSyncState(accountUserId, rootEventId);
		if (staged !== undefined || !state?.pullCursor) {
			const reset = await this.#bootstrap(accountUserId, rootEventId, staged);
			if (!reset) return this.getStatus(accountUserId, rootEventId);
			state = await this.#store.getRootSyncState(accountUserId, rootEventId);
		}
		if (!state?.pullCursor) return this.getStatus(accountUserId, rootEventId);

		const pushResult = await this.#pushOnce(accountUserId, rootEventId);
		if (pushResult === "paused")
			return this.getStatus(accountUserId, rootEventId);
		await this.#pull(accountUserId, rootEventId);
		return this.getStatus(accountUserId, rootEventId);
	}

	async #sendRootCreate(
		accountUserId: string,
		rootEventId: string,
	): Promise<"idle" | "sent" | "paused"> {
		const leaseOwner = this.#newUuid();
		const row = await this.#claimRootCreate(
			accountUserId,
			rootEventId,
			leaseOwner,
		);
		if (!row) return "idle";
		try {
			await this.#assertActiveAccount(accountUserId);
			const command = parseJson<RootCreateCommand>(row.command_json);
			const response = await this.client.request("eventsCreate", {
				body: command,
				headers: { "idempotency-key": required(row.http_idempotency_key) },
			});
			await this.#assertActiveAccount(accountUserId);
			validateRootCreateResponse(command, response.data);
			await this.database.run(
				`UPDATE mutation_outbox SET state = 'awaiting_pull', attempts = 0,
  next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
  last_error_code = NULL, last_request_id = ?, updated_at = ?
WHERE account_user_id = ? AND client_mutation_id = ?
  AND state = 'sending' AND lease_owner = ?`,
				[
					response.requestId,
					this.#timestamp(),
					accountUserId,
					row.client_mutation_id,
					leaseOwner,
				],
			);
			return "sent";
		} catch (error) {
			await this.#recordRootFailure(row, leaseOwner, error);
			return "paused";
		}
	}

	async #rootCreateBlocksBootstrap(
		accountUserId: string,
		rootEventId: string,
	): Promise<boolean> {
		const row = await this.database.first<{
			server_consumed: number;
			state: OutboxState;
		}>(
			`SELECT state, server_consumed FROM mutation_outbox
WHERE account_user_id = ? AND root_event_id = ?
  AND operation_id = 'eventsCreate'`,
			[accountUserId, rootEventId],
		);
		return Boolean(
			row &&
				row.server_consumed === 0 &&
				(row.state === "dead_letter" || row.state === "blocked"),
		);
	}

	async #claimRootCreate(
		accountUserId: string,
		rootEventId: string,
		leaseOwner: string,
	): Promise<OutboxRow | null> {
		const now = this.#timestamp();
		const leaseExpiresAt = new Date(
			this.#now().getTime() + LEASE_MS,
		).toISOString();
		return this.database.transaction(async (transaction) => {
			const row = await transaction.first<OutboxRow>(
				`SELECT * FROM mutation_outbox
WHERE account_user_id = ? AND root_event_id = ? AND operation_id = 'eventsCreate'`,
				[accountUserId, rootEventId],
			);
			if (
				!row ||
				["awaiting_pull", "dead_letter", "blocked"].includes(row.state)
			) {
				return null;
			}
			if (row.next_attempt_at && row.next_attempt_at > now) return null;
			if (
				row.state === "sending" &&
				row.lease_expires_at &&
				row.lease_expires_at > now
			) {
				return null;
			}
			await verifyRow(row, this.#sha256);
			await transaction.run(
				`UPDATE mutation_outbox SET state = 'sending', next_attempt_at = NULL,
  lease_owner = ?, lease_expires_at = ?, updated_at = ?
WHERE account_user_id = ? AND client_mutation_id = ?`,
				[
					leaseOwner,
					leaseExpiresAt,
					now,
					accountUserId,
					row.client_mutation_id,
				],
			);
			return { ...row, state: "sending", lease_owner: leaseOwner };
		});
	}

	async #recordRootFailure(
		row: OutboxRow,
		leaseOwner: string,
		error: unknown,
	): Promise<void> {
		const failure = classifyGatewayFailure(error);
		const timestamp = this.#timestamp();
		const attempts = row.attempts + (failure.auth ? 0 : 1);
		const exhausted = this.#exhausted(row.created_at, attempts);
		if (failure.rotateIdempotency && !exhausted) {
			await this.database.run(
				`UPDATE mutation_outbox SET state = 'pending', http_idempotency_key = ?,
  attempts = ?, next_attempt_at = ?, lease_owner = NULL, lease_expires_at = NULL,
  last_error_code = ?, last_request_id = ?, updated_at = ?
WHERE account_user_id = ? AND client_mutation_id = ? AND lease_owner = ?`,
				[
					`root-${this.#newUuid()}`,
					attempts,
					this.#retryAt(attempts, failure.retryAfterSeconds),
					failure.code,
					failure.requestId,
					timestamp,
					row.account_user_id,
					row.client_mutation_id,
					leaseOwner,
				],
			);
			return;
		}
		const retry = (failure.retryable || failure.auth) && !exhausted;
		await this.database.transaction(async (transaction) => {
			await transaction.run(
				`UPDATE mutation_outbox SET state = ?, attempts = ?, next_attempt_at = ?,
  lease_owner = NULL, lease_expires_at = NULL, last_error_code = ?,
  last_request_id = ?, updated_at = ?
WHERE account_user_id = ? AND client_mutation_id = ? AND lease_owner = ?`,
				[
					retry ? "pending" : "dead_letter",
					Math.min(attempts, MAX_ATTEMPTS),
					retry && !failure.auth
						? this.#retryAt(attempts, failure.retryAfterSeconds)
						: null,
					exhausted ? "retry_exhausted" : failure.code,
					failure.requestId,
					timestamp,
					row.account_user_id,
					row.client_mutation_id,
					leaseOwner,
				],
			);
			if (!retry) {
				await transaction.run(
					`UPDATE mutation_outbox SET state = 'blocked', blocked_until_pull = 0,
  last_error_code = ?, updated_at = ?
WHERE account_user_id = ? AND root_event_id = ?
  AND operation_id = 'syncMutationsApply' AND state = 'pending'`,
					[
						exhausted ? "retry_exhausted" : "blocked",
						timestamp,
						row.account_user_id,
						row.root_event_id,
					],
				);
			}
		});
	}

	async #pushOnce(
		accountUserId: string,
		rootEventId: string,
	): Promise<"idle" | "sent" | "paused"> {
		const leaseOwner = this.#newUuid();
		const batch = await this.#claimPushBatch(
			accountUserId,
			rootEventId,
			leaseOwner,
		);
		if (!batch) return "idle";
		try {
			await this.#assertActiveAccount(accountUserId);
			const response = await this.client.request("syncMutationsApply", {
				body: batch.body,
				headers: { "idempotency-key": batch.row.idempotency_key },
			});
			await this.#assertActiveAccount(accountUserId);
			validatePushResponse(batch.body, response.data);
			await this.#completePush(batch, response.data, response.requestId);
			return "sent";
		} catch (error) {
			await this.#recordBatchFailure(batch, error);
			return "paused";
		}
	}

	async #claimPushBatch(
		accountUserId: string,
		rootEventId: string,
		leaseOwner: string,
	): Promise<ClaimedPushBatch | null> {
		const now = this.#timestamp();
		const leaseExpiresAt = new Date(
			this.#now().getTime() + LEASE_MS,
		).toISOString();
		return this.database.transaction(async (transaction) => {
			const existing = await transaction.first<PushBatchRow>(
				`SELECT * FROM sync_push_batches
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, rootEventId],
			);
			if (existing) {
				if (existing.lease_expires_at && existing.lease_expires_at > now)
					return null;
				const body = parseJson<SyncPushBody>(existing.body_json);
				const mutationIds = parseStringArray(existing.mutation_ids_json);
				if (
					(await this.#sha256(existing.body_json)) !== existing.body_fingerprint
				) {
					throw new Error("Persisted sync batch fingerprint mismatch");
				}
				const rows = await rowsByIds(transaction, accountUserId, mutationIds);
				if (
					rows.length !== mutationIds.length ||
					rows.some(
						(row) => row.next_attempt_at !== null && row.next_attempt_at > now,
					)
				) {
					return null;
				}
				for (const row of rows) await verifyRow(row, this.#sha256);
				await transaction.run(
					`UPDATE sync_push_batches SET lease_owner = ?, lease_expires_at = ?
WHERE account_user_id = ? AND root_event_id = ?`,
					[leaseOwner, leaseExpiresAt, accountUserId, rootEventId],
				);
				await markSending(
					transaction,
					accountUserId,
					mutationIds,
					leaseOwner,
					leaseExpiresAt,
					now,
				);
				return {
					row: { ...existing, lease_owner: leaseOwner },
					body,
					mutationIds,
					leaseOwner,
				};
			}

			const rows = await transaction.all<OutboxRow>(
				`SELECT * FROM mutation_outbox
WHERE account_user_id = ? AND root_event_id = ?
  AND operation_id = 'syncMutationsApply'
ORDER BY client_sequence`,
				[accountUserId, rootEventId],
			);
			const selected: OutboxRow[] = [];
			let deviceId: string | null = null;
			for (const row of rows) {
				if (
					row.state === "awaiting_pull" ||
					(row.state === "dead_letter" && row.server_consumed === 1)
				) {
					continue;
				}
				if (
					row.state === "dead_letter" ||
					(row.state === "blocked" && row.blocked_until_pull === 1) ||
					(row.next_attempt_at !== null && row.next_attempt_at > now) ||
					(row.state === "sending" &&
						row.lease_expires_at !== null &&
						row.lease_expires_at > now)
				) {
					break;
				}
				if (deviceId !== null && row.device_id !== deviceId) break;
				deviceId = row.device_id;
				await verifyRow(row, this.#sha256);
				const candidate = [...selected, row];
				const body = pushBody(rootEventId, deviceId, candidate);
				if (
					encoder.encode(serializeJson(body)).byteLength > MAX_SYNC_BODY_BYTES
				)
					break;
				selected.push(row);
				if (selected.length === MAX_SYNC_MUTATIONS) break;
			}
			if (selected.length === 0 || deviceId === null) return null;
			const body = pushBody(rootEventId, deviceId, selected);
			const bodyJson = serializeJson(body);
			const mutationIds = selected.map((row) => row.client_mutation_id);
			const idempotencyKey = `sync-${this.#newUuid()}`;
			await transaction.run(
				`INSERT INTO sync_push_batches (
  account_user_id, root_event_id, device_id, idempotency_key, body_json,
  body_fingerprint, mutation_ids_json, lease_owner, lease_expires_at, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					accountUserId,
					rootEventId,
					deviceId,
					idempotencyKey,
					bodyJson,
					await this.#sha256(bodyJson),
					serializeJson(mutationIds),
					leaseOwner,
					leaseExpiresAt,
					now,
				],
			);
			await markSending(
				transaction,
				accountUserId,
				mutationIds,
				leaseOwner,
				leaseExpiresAt,
				now,
			);
			return {
				row: {
					account_user_id: accountUserId,
					root_event_id: rootEventId,
					device_id: deviceId,
					idempotency_key: idempotencyKey,
					body_json: bodyJson,
					body_fingerprint: await this.#sha256(bodyJson),
					mutation_ids_json: serializeJson(mutationIds),
					lease_owner: leaseOwner,
					lease_expires_at: leaseExpiresAt,
					created_at: now,
				},
				body,
				mutationIds,
				leaseOwner,
			};
		});
	}

	async #completePush(
		batch: ClaimedPushBatch,
		response: SyncPushResponse,
		requestId: string,
	): Promise<void> {
		const byId = new Map(
			response.results.map((result) => [result.clientMutationId, result]),
		);
		const timestamp = this.#timestamp();
		await this.database.transaction(async (transaction) => {
			const live = await transaction.first<{ lease_owner: string | null }>(
				`SELECT lease_owner FROM sync_push_batches
WHERE account_user_id = ? AND root_event_id = ?`,
				[batch.row.account_user_id, batch.row.root_event_id],
			);
			if (live?.lease_owner !== batch.leaseOwner) return;
			let blockedUntilPull = false;
			let retryAt: string | null = null;
			for (const mutation of batch.body.mutations) {
				const result = required(byId.get(mutation.clientMutationId));
				switch (result.outcome) {
					case "applied": {
						if (mutation.kind === "golf.score.set") {
							const entity = required(result.entity);
							if (entity.entityType !== "golfScore") {
								throw new Error("Golf score acknowledgement type mismatch");
							}
							const intent = await findGolfScoreIntentByOutboxMutation(
								transaction,
								batch.row.account_user_id,
								mutation.clientMutationId,
							);
							if (intent) {
								if (intent.scoreId !== entity.entityId) {
									throw new Error("Golf score intent outbox link mismatch");
								}
								await acknowledgeGolfScoreIntent(
									transaction,
									batch.row.account_user_id,
									intent.clientIntentId,
									entity.version,
									timestamp,
								);
							} else {
								const expectedId = golfScoreEntityId(
									mutation.payload.eventId,
									batch.row.account_user_id,
									mutation.payload.hole,
								);
								const livePlayer = await transaction.first(
									`SELECT 1 FROM golf_players
WHERE account_user_id = ? AND root_event_id = ? AND event_id = ?
  AND user_id = ?`,
									[
										batch.row.account_user_id,
										batch.row.root_event_id,
										mutation.payload.eventId,
										batch.row.account_user_id,
									],
								);
								if (entity.entityId !== expectedId || livePlayer) {
									throw new Error("Golf score intent outbox link mismatch");
								}
							}
						}
						await updateOutcome(transaction, batch, mutation.clientMutationId, {
							state: "awaiting_pull",
							appliedRootRevision: result.rootRevision,
							serverConsumed: true,
							requestId,
							timestamp,
						});
						break;
					}
					case "rejected":
						blockedUntilPull = true;
						await updateOutcome(transaction, batch, mutation.clientMutationId, {
							state: "dead_letter",
							serverConsumed: true,
							errorCode: safeFailureCode(result.error.code),
							requestId,
							currentVersion:
								(result.error.currentVersion ?? 0) > 0
									? (result.error.currentVersion ?? null)
									: null,
							authoritativeOrder: result.error.authoritativeOrder ?? null,
							timestamp,
						});
						break;
					case "retry": {
						const row = await requiredOutboxRow(
							transaction,
							batch.row.account_user_id,
							mutation.clientMutationId,
						);
						const attempts = row.attempts + 1;
						const exhausted = this.#exhausted(row.created_at, attempts);
						retryAt = exhausted
							? null
							: this.#retryAt(attempts, result.retryAfterSeconds);
						await updateOutcome(transaction, batch, mutation.clientMutationId, {
							state: exhausted ? "dead_letter" : "pending",
							attempts,
							nextAttemptAt: retryAt,
							errorCode: exhausted
								? "retry_exhausted"
								: safeFailureCode(result.error.code),
							requestId,
							timestamp,
						});
						break;
					}
					case "blocked":
						await updateOutcome(transaction, batch, mutation.clientMutationId, {
							state: "blocked",
							blockedUntilPull,
							nextAttemptAt: blockedUntilPull ? null : retryAt,
							errorCode: blockedUntilPull
								? "blocked"
								: safeFailureCode(result.error.code),
							requestId,
							timestamp,
						});
						break;
				}
			}
			await transaction.run(
				`DELETE FROM sync_push_batches
WHERE account_user_id = ? AND root_event_id = ? AND lease_owner = ?`,
				[batch.row.account_user_id, batch.row.root_event_id, batch.leaseOwner],
			);
		});
	}

	async #recordBatchFailure(
		batch: ClaimedPushBatch,
		error: unknown,
	): Promise<void> {
		const failure = classifyGatewayFailure(error);
		const timestamp = this.#timestamp();
		await this.database.transaction(async (transaction) => {
			const live = await transaction.first<PushBatchRow>(
				`SELECT * FROM sync_push_batches
WHERE account_user_id = ? AND root_event_id = ?`,
				[batch.row.account_user_id, batch.row.root_event_id],
			);
			if (live?.lease_owner !== batch.leaseOwner) return;
			const rows = await rowsByIds(
				transaction,
				batch.row.account_user_id,
				batch.mutationIds,
			);
			const first = rows.sort(
				(left, right) => left.client_sequence - right.client_sequence,
			)[0];
			if (!first) return;
			const attempts = first.attempts + (failure.auth ? 0 : 1);
			const exhausted = this.#exhausted(first.created_at, attempts);
			if (failure.rotateIdempotency && !exhausted) {
				await transaction.run(
					`UPDATE sync_push_batches SET idempotency_key = ?, lease_owner = NULL,
  lease_expires_at = NULL WHERE account_user_id = ? AND root_event_id = ?`,
					[
						`sync-${this.#newUuid()}`,
						batch.row.account_user_id,
						batch.row.root_event_id,
					],
				);
			}
			if (
				(failure.retryable || failure.auth || failure.rotateIdempotency) &&
				!exhausted
			) {
				const nextAttemptAt = failure.auth
					? null
					: this.#retryAt(attempts, failure.retryAfterSeconds);
				for (const row of rows) {
					await transaction.run(
						`UPDATE mutation_outbox SET state = 'pending', attempts = ?,
  next_attempt_at = ?, lease_owner = NULL, lease_expires_at = NULL,
  last_error_code = ?, last_request_id = ?, updated_at = ?
WHERE account_user_id = ? AND client_mutation_id = ? AND lease_owner = ?`,
						[
							attempts,
							nextAttemptAt,
							failure.code,
							failure.requestId,
							timestamp,
							row.account_user_id,
							row.client_mutation_id,
							batch.leaseOwner,
						],
					);
				}
				await transaction.run(
					`UPDATE sync_push_batches SET lease_owner = NULL, lease_expires_at = NULL
WHERE account_user_id = ? AND root_event_id = ?`,
					[batch.row.account_user_id, batch.row.root_event_id],
				);
				return;
			}

			for (const [index, row] of rows.entries()) {
				await transaction.run(
					`UPDATE mutation_outbox SET state = ?, attempts = ?, next_attempt_at = NULL,
  lease_owner = NULL, lease_expires_at = NULL, blocked_until_pull = 0,
  last_error_code = ?, last_request_id = ?, updated_at = ?
WHERE account_user_id = ? AND client_mutation_id = ? AND lease_owner = ?`,
					[
						index === 0 ? "dead_letter" : "blocked",
						Math.min(attempts, MAX_ATTEMPTS),
						exhausted ? "retry_exhausted" : failure.code,
						failure.requestId,
						timestamp,
						row.account_user_id,
						row.client_mutation_id,
						batch.leaseOwner,
					],
				);
			}
			await transaction.run(
				`DELETE FROM sync_push_batches
WHERE account_user_id = ? AND root_event_id = ? AND lease_owner = ?`,
				[batch.row.account_user_id, batch.row.root_event_id, batch.leaseOwner],
			);
		});
	}

	async #pull(accountUserId: string, rootEventId: string): Promise<boolean> {
		let cursor = (
			await this.#store.getRootSyncState(accountUserId, rootEventId)
		)?.pullCursor;
		if (!cursor) return false;
		while (cursor) {
			let verificationId: string | null = null;
			try {
				await this.#assertActiveAccount(accountUserId);
				verificationId = await this.#startRootRead(accountUserId, rootEventId);
				await this.#assertActiveAccount(accountUserId);
				const response = await this.client.request("syncChangesList", {
					query: { rootEventId, cursor, limit: 200 },
				});
				await this.#assertActiveAccount(accountUserId);
				await this.#store.applyPullPage(accountUserId, cursor, response.data);
				await this.#finishRootRead(accountUserId, rootEventId, verificationId);
				verificationId = null;
				if (!response.data.pageInfo.hasMore) return true;
				cursor = (
					await this.#store.getRootSyncState(accountUserId, rootEventId)
				)?.pullCursor;
			} catch (error) {
				if (authoritativeRootDenial(error, "syncChangesList")) {
					return this.#concealDeniedRoot(
						accountUserId,
						rootEventId,
						verificationId,
					);
				}
				await this.#finishRootReadQuietly(
					accountUserId,
					rootEventId,
					verificationId,
				);
				if (
					error instanceof GatewayClientError &&
					error.code === "CURSOR_EXPIRED"
				) {
					return this.#bootstrap(accountUserId, rootEventId, null);
				}
				return false;
			}
		}
		return true;
	}

	async #bootstrap(
		accountUserId: string,
		rootEventId: string,
		resumeCursor: string | null | undefined,
	): Promise<boolean> {
		let cursor = resumeCursor ?? null;
		let restarted = false;
		while (true) {
			let verificationId: string | null = null;
			try {
				await this.#assertActiveAccount(accountUserId);
				verificationId = await this.#startRootRead(accountUserId, rootEventId);
				await this.#assertActiveAccount(accountUserId);
				const response = await this.client.request("syncBootstrapRead", {
					query: {
						rootEventId,
						limit: 200,
						...(cursor ? { cursor } : {}),
					},
				});
				await this.#assertActiveAccount(accountUserId);
				const applied = await this.#store.applyBootstrapPage(
					accountUserId,
					cursor,
					response.data,
				);
				await this.#finishRootRead(accountUserId, rootEventId, verificationId);
				verificationId = null;
				if (applied.completed) return true;
				cursor = applied.nextCursor;
			} catch (error) {
				if (authoritativeRootDenial(error, "syncBootstrapRead")) {
					return this.#concealDeniedRoot(
						accountUserId,
						rootEventId,
						verificationId,
					);
				}
				await this.#finishRootReadQuietly(
					accountUserId,
					rootEventId,
					verificationId,
				);
				if (
					!restarted &&
					cursor !== null &&
					error instanceof GatewayClientError &&
					error.code === "CURSOR_EXPIRED"
				) {
					await this.database.run(
						`DELETE FROM sync_snapshot_staging
WHERE account_user_id = ? AND root_event_id = ?`,
						[accountUserId, rootEventId],
					);
					cursor = null;
					restarted = true;
					continue;
				}
				return false;
			}
		}
	}

	async #stagedCursor(
		accountUserId: string,
		rootEventId: string,
	): Promise<string | null | undefined> {
		const row = await this.database.first<{ next_page_cursor: string | null }>(
			`SELECT next_page_cursor FROM sync_snapshot_staging
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
		return row ? row.next_page_cursor : undefined;
	}

	async #requiredItem(
		accountUserId: string,
		clientMutationId: string,
	): Promise<OutboxItem> {
		const row = await this.database.first<OutboxRow>(
			`SELECT * FROM mutation_outbox
WHERE account_user_id = ? AND client_mutation_id = ?`,
			[accountUserId, clientMutationId],
		);
		return mapOutboxItem(required(row), this.#sha256);
	}

	async #assertActiveAccount(accountUserId: string): Promise<void> {
		if ((await this.#activeAccountUserId()) !== accountUserId) {
			throw new MobileSyncAccountChangedError();
		}
	}

	async #concealDeniedRoot(
		accountUserId: string,
		rootEventId: string,
		verificationId: string | null,
	): Promise<never> {
		try {
			await this.#store.clearRootData(accountUserId, rootEventId);
		} catch {
			// The preflight marker completes the purge when this account reopens.
			throw new MobileSyncRootAccessDeniedError();
		}
		try {
			await this.#onRootPurged(accountUserId, rootEventId);
			await this.#finishRootRead(accountUserId, rootEventId, verificationId);
		} catch {
			// Startup repeats reconciliation while the preflight marker remains armed.
		}
		throw new MobileSyncRootAccessDeniedError();
	}

	async #startRootRead(
		accountUserId: string,
		rootEventId: string,
	): Promise<string | null> {
		if (!this.#onRootReadStarted) return null;
		const verificationId = await this.#onRootReadStarted(
			accountUserId,
			rootEventId,
		);
		if (!verificationId || verificationId.length > 256) {
			throw new Error("Invalid root read verification");
		}
		return verificationId;
	}

	async #finishRootRead(
		accountUserId: string,
		rootEventId: string,
		verificationId: string | null,
	): Promise<void> {
		if (verificationId === null || !this.#onRootReadFinished) return;
		await this.#onRootReadFinished(accountUserId, rootEventId, verificationId);
	}

	async #finishRootReadQuietly(
		accountUserId: string,
		rootEventId: string,
		verificationId: string | null,
	): Promise<void> {
		try {
			await this.#finishRootRead(accountUserId, rootEventId, verificationId);
		} catch {
			// A stale marker causes conservative concealment on the next bootstrap.
		}
	}

	#newUuid(): string {
		const value = this.#randomUUID();
		if (!uuidV4Pattern.test(value))
			throw new Error("UUID factory returned an invalid lowercase UUID v4");
		return value;
	}

	#timestamp(): string {
		const value = this.#now();
		if (!Number.isFinite(value.getTime()))
			throw new Error("Clock returned an invalid date");
		return value.toISOString();
	}

	#retryAt(attempts: number, retryAfterSeconds: number | null): string {
		const random = this.#random();
		if (!Number.isFinite(random) || random < 0 || random >= 1) {
			throw new Error("Random source must return a value in [0, 1)");
		}
		const ceiling = Math.min(
			MAX_RETRY_MS,
			2_000 * 2 ** Math.max(0, attempts - 1),
		);
		const jitter = Math.floor(random * ceiling);
		const retryAfter = Math.max(0, retryAfterSeconds ?? 0) * 1_000;
		return new Date(
			this.#now().getTime() + Math.max(jitter, retryAfter),
		).toISOString();
	}

	#exhausted(createdAt: string, attempts: number): boolean {
		return (
			attempts >= MAX_ATTEMPTS ||
			this.#now().getTime() - Date.parse(createdAt) >= MAX_RETRY_AGE_MS
		);
	}
}

async function insertRecoveredGolfIntent(
	executor: SqlExecutor,
	intent: GolfIntentRecoveryRow,
	clientMutationId: string,
): Promise<void> {
	await executor.run(
		`INSERT INTO golf_score_intents (
  account_user_id, client_intent_id, root_event_id, event_id, score_id,
  user_id, hole, client_sequence, base_version, strokes, putts,
  playing_handicap, handicap_strokes, net_strokes, stableford_points,
  command_json, state, applied_entity_version, created_at, updated_at,
  outbox_client_mutation_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			intent.account_user_id,
			intent.client_intent_id,
			intent.root_event_id,
			intent.event_id,
			intent.score_id,
			intent.user_id,
			intent.hole,
			intent.client_sequence,
			intent.base_version,
			intent.strokes,
			intent.putts,
			intent.playing_handicap,
			intent.handicap_strokes,
			intent.net_strokes,
			intent.stableford_points,
			intent.command_json,
			intent.state,
			intent.applied_entity_version,
			intent.created_at,
			intent.updated_at,
			clientMutationId,
		],
	);
}

function recoveredOverlayJson(
	value: string,
	replacedMutationIds: ReadonlySet<string>,
): string {
	const overlay = parseJson<unknown>(value);
	if (
		isRecord(overlay) &&
		typeof overlay.replacementFor === "string" &&
		replacedMutationIds.has(overlay.replacementFor)
	) {
		return serializeJson({ ...overlay, replacementFor: null });
	}
	return value;
}

function recoveryTimestamp(now: () => Date): string {
	const value = now();
	if (!Number.isFinite(value.getTime())) {
		throw new Error("Clock returned an invalid date");
	}
	return value.toISOString();
}

function recoveryDeviceId(newDeviceId: () => string): string {
	let value: string;
	try {
		value = newDeviceId();
	} catch {
		throw new SequenceFailureRecoveryDeferredError(
			"Replacement mutation stream identity is unavailable",
		);
	}
	if (!value.startsWith("dvc_") || !uuidV4Pattern.test(value.slice(4))) {
		throw new SequenceFailureRecoveryDeferredError(
			"Replacement mutation stream identity is invalid",
		);
	}
	return value;
}

function recoveryUuid(randomUUID: () => string): string {
	let value: string;
	try {
		value = randomUUID();
	} catch {
		throw new SequenceFailureRecoveryDeferredError(
			"Replacement mutation identity is unavailable",
		);
	}
	if (!uuidV4Pattern.test(value)) {
		throw new SequenceFailureRecoveryDeferredError(
			"Replacement mutation identity is invalid",
		);
	}
	return value;
}

async function ensureStream(
	executor: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
	deviceId: string,
): Promise<void> {
	await executor.run(
		`INSERT INTO mutation_streams (
  account_user_id, root_event_id, device_id, next_client_sequence
) VALUES (?, ?, ?, 1)
ON CONFLICT (account_user_id, root_event_id, device_id) DO NOTHING`,
		[accountUserId, rootEventId, deviceId],
	);
}

function pushBody(
	rootEventId: string,
	deviceId: string,
	rows: readonly OutboxRow[],
): SyncPushBody {
	return {
		protocolVersion: 1,
		rootEventId,
		deviceId,
		mutations: rows.map((row) =>
			canonicalizePersistedMutation(
				parseJson<unknown>(row.command_json),
				row.account_user_id,
			),
		),
	};
}

async function markSending(
	executor: SqlExecutor,
	accountUserId: string,
	mutationIds: readonly string[],
	leaseOwner: string,
	leaseExpiresAt: string,
	timestamp: string,
): Promise<void> {
	for (const mutationId of mutationIds) {
		await executor.run(
			`UPDATE mutation_outbox SET state = 'sending', next_attempt_at = NULL,
  lease_owner = ?, lease_expires_at = ?, updated_at = ?
WHERE account_user_id = ? AND client_mutation_id = ?`,
			[leaseOwner, leaseExpiresAt, timestamp, accountUserId, mutationId],
		);
	}
}

async function rowsByIds(
	executor: SqlExecutor,
	accountUserId: string,
	mutationIds: readonly string[],
): Promise<OutboxRow[]> {
	const rows: OutboxRow[] = [];
	for (const mutationId of mutationIds) {
		const row = await executor.first<OutboxRow>(
			`SELECT * FROM mutation_outbox
WHERE account_user_id = ? AND client_mutation_id = ?`,
			[accountUserId, mutationId],
		);
		if (row) rows.push(row);
	}
	return rows;
}

async function requiredOutboxRow(
	executor: SqlExecutor,
	accountUserId: string,
	mutationId: string,
): Promise<OutboxRow> {
	return required(
		await executor.first<OutboxRow>(
			`SELECT * FROM mutation_outbox
WHERE account_user_id = ? AND client_mutation_id = ?`,
			[accountUserId, mutationId],
		),
	);
}

async function updateOutcome(
	executor: SqlExecutor,
	batch: ClaimedPushBatch,
	mutationId: string,
	value: {
		state: OutboxState;
		attempts?: number;
		nextAttemptAt?: string | null;
		appliedRootRevision?: string | null;
		serverConsumed?: boolean;
		blockedUntilPull?: boolean;
		errorCode?: SyncFailureCode | null;
		requestId: string;
		currentVersion?: number | null;
		authoritativeOrder?: readonly string[] | null;
		timestamp: string;
	},
): Promise<void> {
	await executor.run(
		`UPDATE mutation_outbox SET state = ?, attempts = ?, next_attempt_at = ?,
  lease_owner = NULL, lease_expires_at = NULL, applied_root_revision = ?,
  server_consumed = ?, blocked_until_pull = ?, last_error_code = ?,
  last_request_id = ?, current_version = ?, authoritative_order_json = ?,
  updated_at = ?
WHERE account_user_id = ? AND client_mutation_id = ? AND lease_owner = ?`,
		[
			value.state,
			Math.min(value.attempts ?? 0, MAX_ATTEMPTS),
			value.nextAttemptAt ?? null,
			value.appliedRootRevision ?? null,
			value.serverConsumed ? 1 : 0,
			value.blockedUntilPull ? 1 : 0,
			value.errorCode ?? null,
			value.requestId,
			value.currentVersion ?? null,
			value.authoritativeOrder ? serializeJson(value.authoritativeOrder) : null,
			value.timestamp,
			batch.row.account_user_id,
			mutationId,
			batch.leaseOwner,
		],
	);
}

function validatePushResponse(
	body: SyncPushBody,
	response: SyncPushResponse,
): void {
	if (
		response.protocolVersion !== 1 ||
		response.rootEventId !== body.rootEventId ||
		response.deviceId !== body.deviceId ||
		response.results.length !== body.mutations.length
	) {
		throw new Error("Sync push response does not match its request");
	}
	const results = new Map<string, SyncPushResponse["results"][number]>();
	for (const result of response.results) {
		if (results.has(result.clientMutationId)) {
			throw new Error("Sync push response repeats a mutation result");
		}
		results.set(result.clientMutationId, result);
	}
	let expectedSequence = body.mutations.at(-1)?.clientSequence ?? 0;
	for (const mutation of body.mutations) {
		const result = results.get(mutation.clientMutationId);
		if (
			!result ||
			result.clientSequence !== mutation.clientSequence ||
			result.clientMutationId !== mutation.clientMutationId
		) {
			throw new Error("Sync push response mutation identity mismatch");
		}
		if (mutation.kind === "golf.score.set" && result.outcome === "applied") {
			if (
				result.entity?.entityType !== "golfScore" ||
				result.entity.entityId !== mutation.entityId ||
				!Number.isSafeInteger(result.entity.version) ||
				result.entity.version < 1
			) {
				throw new Error("Sync golf score acknowledgement is invalid");
			}
		}
		if (mutation.kind.startsWith("team.") && result.outcome === "applied") {
			const expected =
				mutation.kind === "team.assignments.publish"
					? {
							entityType: "teamAssignmentSet",
							entityId: mutation.payload.eventId,
						}
					: mutation.kind === "team.decision.replace"
						? { entityType: "teamDecision", entityId: mutation.entityId }
						: { entityType: "teamResponse", entityId: mutation.entityId };
			if (
				result.entity?.entityType !== expected.entityType ||
				result.entity.entityId !== expected.entityId ||
				!Number.isSafeInteger(result.entity.version) ||
				result.entity.version < 1
			) {
				throw new Error("Sync team acknowledgement is invalid");
			}
		}
		if (result.outcome === "retry" || result.outcome === "blocked") {
			expectedSequence = Math.min(expectedSequence, result.clientSequence);
		}
	}
	if (
		response.nextExpectedClientSequence !==
		(expectedSequence === body.mutations.at(-1)?.clientSequence &&
		!body.mutations.some((mutation) => {
			const outcome = results.get(mutation.clientMutationId)?.outcome;
			return outcome === "retry" || outcome === "blocked";
		})
			? expectedSequence + 1
			: expectedSequence)
	) {
		throw new Error("Sync push next sequence is inconsistent");
	}
}

async function mapOutboxItem(
	row: OutboxRow,
	sha256: (value: string) => Promise<string>,
): Promise<OutboxItem> {
	await verifyRow(row, sha256);
	return {
		accountUserId: row.account_user_id,
		clientMutationId: row.client_mutation_id,
		rootEventId: row.root_event_id,
		deviceId: row.device_id,
		clientSequence: Number(row.client_sequence),
		operationId: row.operation_id,
		command: parseJson<RootCreateCommand | SyncMutation>(row.command_json),
		optimisticOverlay: parseJson<unknown>(row.optimistic_overlay_json),
		state: row.state,
		attempts: Number(row.attempts),
		nextAttemptAt: row.next_attempt_at,
		appliedRootRevision: row.applied_root_revision,
		serverConsumed: row.server_consumed === 1,
		lastError: row.last_error_code
			? {
					code: row.last_error_code,
					requestId: row.last_request_id,
					currentVersion:
						row.current_version === null ? null : Number(row.current_version),
					authoritativeOrder: row.authoritative_order_json
						? parseStringArray(row.authoritative_order_json)
						: null,
				}
			: null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function verifyRow(
	row: Pick<
		OutboxRow,
		"account_user_id" | "command_json" | "command_fingerprint"
	>,
	sha256: (value: string) => Promise<string>,
): Promise<void> {
	if ((await sha256(row.command_json)) !== row.command_fingerprint) {
		throw new Error("Persisted outbox command fingerprint mismatch");
	}
	const value = parseJson<unknown>(row.command_json);
	if (
		isRecord(value) &&
		(value.kind === "attachment.commit" ||
			(typeof value.kind === "string" && value.kind.startsWith("team."))) &&
		serializeJson(canonicalizePersistedMutation(value, row.account_user_id)) !==
			row.command_json
	) {
		throw new Error("Persisted sync mutation is not canonical");
	}
}

function classifyGatewayFailure(error: unknown): {
	retryable: boolean;
	auth: boolean;
	rotateIdempotency: boolean;
	code: SyncFailureCode;
	requestId: string | null;
	retryAfterSeconds: number | null;
} {
	if (error instanceof MobileSyncAccountChangedError) {
		return {
			retryable: false,
			auth: true,
			rotateIdempotency: false,
			code: "auth_required",
			requestId: null,
			retryAfterSeconds: null,
		};
	}
	if (!(error instanceof GatewayClientError)) {
		return {
			retryable: true,
			auth: false,
			rotateIdempotency: false,
			code: "network",
			requestId: null,
			retryAfterSeconds: null,
		};
	}
	const auth = [
		"unauthenticated",
		"session_changed",
		"session_store_error",
	].includes(error.code);
	const rejectedRootCreate =
		error.operationId === "eventsCreate" &&
		(error.status === 400 || error.status === 409) &&
		error.code !== "IDEMPOTENCY_KEY_REUSED" &&
		!error.retryable;
	return {
		retryable:
			error.retryable ||
			["network_error", "timeout", "invalid_response"].includes(error.code),
		auth,
		rotateIdempotency:
			error.status === 409 && error.code === "IDEMPOTENCY_KEY_REUSED",
		code: rejectedRootCreate ? "invalid" : safeFailureCode(error.code),
		requestId: error.requestId,
		retryAfterSeconds: error.retryAfterSeconds,
	};
}

function authoritativeRootDenial(
	error: unknown,
	operationId: "syncBootstrapRead" | "syncChangesList",
): error is GatewayClientError {
	return (
		error instanceof GatewayClientError &&
		error.operationId === operationId &&
		(error.status === 403 || error.status === 404) &&
		(error.code === "FORBIDDEN" || error.code === "NOT_FOUND")
	);
}

function safeFailureCode(code: string): SyncFailureCode {
	if (code === "VERSION_CONFLICT") return "conflict";
	if (code === "ENTITY_DELETED") return "deleted";
	if (["FORBIDDEN", "NOT_FOUND"].includes(code)) return "permission";
	if (
		["CAUSAL_GAP", "SEQUENCE_REUSED", "IDEMPOTENCY_KEY_REUSED"].includes(code)
	) {
		return "sequence";
	}
	if (
		["VALIDATION_FAILED", "invalid_request", "PAYLOAD_TOO_LARGE"].includes(code)
	) {
		return "invalid";
	}
	if (code === "RATE_LIMITED") return "rate_limited";
	if (
		["SERVICE_UNAVAILABLE", "UPSTREAM_ERROR", "UPSTREAM_TIMEOUT"].includes(code)
	) {
		return "service_unavailable";
	}
	if (["network_error", "timeout", "invalid_response"].includes(code))
		return "network";
	if (
		["unauthenticated", "session_changed", "session_store_error"].includes(code)
	) {
		return "auth_required";
	}
	return "unknown";
}

function canonicalizeMutationDraft(
	value: unknown,
	accountUserId?: string,
): SyncMutationDraft {
	if (!isRecord(value)) throw new Error("Invalid sync mutation");
	if (typeof value.kind !== "string")
		throw new Error("Invalid sync mutation kind");
	if (value.kind === "attachment.commit")
		return canonicalizeAttachmentCommit(value);
	if (value.kind === "team.assignments.publish")
		return canonicalizeTeamAssignments(value);
	if (value.kind === "team.decision.replace")
		return canonicalizeTeamDecision(value);
	if (value.kind === "team.response.set") {
		if (!accountUserId) throw new Error("Team response account is required");
		return canonicalizeTeamResponse(value, accountUserId);
	}
	return value as SyncMutationDraft;
}

function canonicalizeRootCreateCommand(value: unknown): RootCreateCommand {
	const command = requiredRecord(value, "root create command");
	const id = requiredPattern(command.id, eventIdPattern, "root event ID");
	const kinds = new Set<RootCreateCommand["kind"]>([
		"trip",
		"day",
		"golf",
		"team_event",
		"session",
		"activity",
		"other",
	]);
	if (typeof command.kind !== "string" || !kinds.has(command.kind as never)) {
		throw new Error("Invalid root event kind");
	}
	const timeZone = ianaTimeZone(command.timeZone);
	const result: RootCreateCommand = {
		id,
		kind: command.kind as RootCreateCommand["kind"],
		title: trimmedText(command.title, 160, "root event title"),
		timeZone,
	};
	if (command.description !== undefined) {
		if (
			command.description !== null &&
			(typeof command.description !== "string" ||
				command.description.length > 20_000)
		) {
			throw new Error("Invalid root event description");
		}
		result.description = command.description as string | null;
	}
	if (command.startsAt !== undefined) {
		result.startsAt = nullableDateTime(command.startsAt, "start time");
	}
	if (command.endsAt !== undefined) {
		result.endsAt = nullableDateTime(command.endsAt, "end time");
	}
	if (command.status !== undefined) {
		if (command.status !== "draft")
			throw new Error("Invalid root event status");
		result.status = "draft";
	}
	if (command.template !== undefined) {
		const template = requiredRecord(command.template, "event template");
		const templateId = trimmedText(template.id, 64, "event template ID");
		if (
			!Number.isSafeInteger(template.version) ||
			Number(template.version) < 1
		) {
			throw new Error("Invalid event template version");
		}
		const rawIds = requiredRecord(template.eventIds, "event template IDs");
		const entries = Object.entries(rawIds);
		if (entries.length < 1 || entries.length > 16) {
			throw new Error("Invalid event template IDs");
		}
		const eventIds: Record<string, string> = {};
		const seen = new Set<string>();
		for (const [logicalKey, rawId] of entries) {
			if (!/^[a-z][a-z0-9-]{0,31}$/.test(logicalKey)) {
				throw new Error("Invalid event template logical key");
			}
			const eventId = requiredPattern(
				rawId,
				eventIdPattern,
				"template event ID",
			);
			if (seen.has(eventId)) throw new Error("Duplicate template event ID");
			seen.add(eventId);
			eventIds[logicalKey] = eventId;
		}
		if (eventIds.root !== id) {
			throw new Error("Template root ID must match root event ID");
		}
		result.template = {
			id: templateId,
			version: Number(template.version),
			eventIds,
		};
	}
	return result;
}

function validateRootCreateResponse(
	command: RootCreateCommand,
	value: GatewayResponseData<"eventsCreate">,
): void {
	const response = requiredRecord(value, "root create response");
	const event = requiredRecord(response.event, "created root event");
	if (
		event.id !== command.id ||
		event.rootEventId !== command.id ||
		event.parentEventId !== null ||
		event.status !== "draft" ||
		event.kind !== command.kind ||
		event.title !== command.title ||
		event.timeZone !== command.timeZone ||
		event.description !== (command.description ?? null) ||
		event.startsAt !== (command.startsAt ?? null) ||
		event.endsAt !== (command.endsAt ?? null)
	) {
		throw new Error("Root creation response does not match its command");
	}
}

function ianaTimeZone(value: unknown): string {
	if (typeof value !== "string" || value.length < 1 || value.length > 100) {
		throw new Error("Invalid IANA time zone");
	}
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
	} catch {
		throw new Error("Invalid IANA time zone");
	}
	return value;
}

function nullableDateTime(value: unknown, field: string): string | null {
	if (value === null) return null;
	if (
		typeof value !== "string" ||
		!/^(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:Z|[+-]\d{2}:\d{2})$/.test(
			value,
		) ||
		Number.isNaN(Date.parse(value))
	) {
		throw new Error(`Invalid root event ${field}`);
	}
	return value;
}

function canonicalizeAttachmentCommit(
	value: Record<string, unknown>,
): AttachmentCommitDraft {
	if (
		typeof value.entityId !== "string" ||
		!attachmentIdPattern.test(value.entityId)
	) {
		throw new Error("Invalid attachment ID");
	}
	if (!isRecord(value.payload)) {
		throw new Error("Invalid attachment commit payload");
	}
	const uploadId = value.payload.uploadId;
	if (typeof uploadId !== "string" || !uploadIdPattern.test(uploadId)) {
		throw new Error("Invalid attachment upload ID");
	}
	const rawCaption = value.payload.caption;
	let caption: string | null = null;
	if (rawCaption !== undefined && rawCaption !== null) {
		if (typeof rawCaption !== "string") {
			throw new Error("Invalid attachment caption");
		}
		caption = rawCaption.trim();
		if (caption.length < 1 || caption.length > 1000) {
			throw new Error("Invalid attachment caption");
		}
	}
	return {
		kind: "attachment.commit",
		entityId: value.entityId,
		payload: { uploadId, caption },
	};
}

function canonicalizePersistedMutation(
	value: unknown,
	accountUserId?: string,
): SyncMutation {
	const draft = canonicalizeMutationDraft(value, accountUserId);
	const persisted = value as Record<string, unknown>;
	if (
		typeof persisted.clientMutationId !== "string" ||
		!uuidV4Pattern.test(persisted.clientMutationId)
	) {
		throw new Error("Invalid sync mutation ID");
	}
	if (
		!Number.isSafeInteger(persisted.clientSequence) ||
		Number(persisted.clientSequence) < 1 ||
		Number(persisted.clientSequence) > MAX_CLIENT_SEQUENCE
	) {
		throw new Error("Invalid sync mutation sequence");
	}
	return {
		...draft,
		clientMutationId: persisted.clientMutationId,
		clientSequence: Number(persisted.clientSequence),
	} as SyncMutation;
}

function canonicalizeTeamAssignments(
	value: Record<string, unknown>,
): TeamAssignmentsMutationDraft {
	const payload = requiredRecord(value.payload, "team assignments payload");
	const eventId = requiredPattern(payload.eventId, eventIdPattern, "event ID");
	if (value.entityId !== eventId)
		throw new Error("Invalid assignment entity ID");
	const baseVersion = nonnegativeVersion(value.baseVersion);
	if (
		!Array.isArray(payload.teams) ||
		payload.teams.length < 1 ||
		payload.teams.length > 100
	)
		throw new Error("Invalid team assignments");
	const teamIds = new Set<string>();
	const assigned = new Set<string>();
	const teams = payload.teams.map((rawTeam) => {
		const team = requiredRecord(rawTeam, "team");
		const id = requiredPattern(team.id, teamIdPattern, "team ID");
		if (teamIds.has(id)) throw new Error("Duplicate team ID");
		teamIds.add(id);
		const name = trimmedText(team.name, 80, "team name");
		const color =
			team.color === null
				? null
				: requiredPattern(
						(typeof team.color === "string" ? team.color : "").toUpperCase(),
						teamColorPattern,
						"team color",
					);
		if (
			!Array.isArray(team.memberUserIds) ||
			team.memberUserIds.length < 1 ||
			team.memberUserIds.length > 1_000
		) {
			throw new Error("Invalid team members");
		}
		const memberUserIds = team.memberUserIds.map((rawUserId) => {
			const userId = requiredPattern(rawUserId, userIdPattern, "team user ID");
			if (assigned.has(userId)) throw new Error("Duplicate team member");
			assigned.add(userId);
			return userId;
		});
		memberUserIds.sort();
		return { id, name, color, memberUserIds };
	});
	if (assigned.size > 1_000) throw new Error("Too many team members");
	return {
		kind: "team.assignments.publish",
		entityId: eventId,
		baseVersion,
		payload: { eventId, teams },
	};
}

function canonicalizeTeamDecision(
	value: Record<string, unknown>,
): TeamDecisionMutationDraft {
	const payload = requiredRecord(value.payload, "team decision payload");
	const decisionId = requiredPattern(
		value.entityId,
		decisionIdPattern,
		"decision ID",
	);
	const eventId = requiredPattern(payload.eventId, eventIdPattern, "event ID");
	const title = trimmedText(payload.title, 240, "decision title");
	if (!(["draft", "open", "closed"] as const).includes(payload.state as never))
		throw new Error("Invalid decision state");
	if (
		!Array.isArray(payload.options) ||
		payload.options.length < 2 ||
		payload.options.length > 20
	)
		throw new Error("Invalid decision options");
	const ids = new Set<string>();
	const labels = new Set<string>();
	const options = payload.options.map((rawOption) => {
		const option = requiredRecord(rawOption, "decision option");
		const id = requiredPattern(option.id, optionIdPattern, "option ID");
		const label = trimmedText(option.label, 160, "option label");
		const folded = label.toLocaleLowerCase("en-US");
		if (ids.has(id) || labels.has(folded))
			throw new Error("Duplicate decision option");
		ids.add(id);
		labels.add(folded);
		return { id, label };
	});
	return {
		kind: "team.decision.replace",
		entityId: decisionId,
		baseVersion: nonnegativeVersion(value.baseVersion),
		payload: {
			eventId,
			title,
			state: payload.state as TeamDecisionMutationDraft["payload"]["state"],
			options,
		},
	};
}

function canonicalizeTeamResponse(
	value: Record<string, unknown>,
	accountUserId: string,
): TeamResponseMutationDraft {
	const payload = requiredRecord(value.payload, "team response payload");
	const eventId = requiredPattern(payload.eventId, eventIdPattern, "event ID");
	const decisionId = requiredPattern(
		payload.decisionId,
		decisionIdPattern,
		"decision ID",
	);
	const optionId = requiredPattern(
		payload.optionId,
		optionIdPattern,
		"option ID",
	);
	const entityId = teamResponseEntityId(decisionId, accountUserId);
	if (value.entityId !== entityId)
		throw new Error("Invalid response entity ID");
	return {
		kind: "team.response.set",
		entityId,
		baseVersion: nonnegativeVersion(value.baseVersion),
		payload: { eventId, decisionId, optionId },
	};
}

async function assertTeamMutationAuthorized(
	executor: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
	command: SyncMutationDraft,
) {
	if (!command.kind.startsWith("team.")) return;
	const membership = await executor.first<{
		role: "owner" | "organizer" | "participant" | "viewer";
	}>(
		`SELECT role FROM memberships
WHERE account_user_id = ? AND root_event_id = ? AND member_user_id = ?
  AND status = 'active'`,
		[accountUserId, rootEventId, accountUserId],
	);
	if (!membership) throw new Error("Active event membership is required");
	if (
		(command.kind === "team.assignments.publish" ||
			command.kind === "team.decision.replace") &&
		!(["owner", "organizer"] as const).includes(membership.role as never)
	) {
		throw new Error("Team management requires an owner or organizer");
	}
	if (command.kind === "team.response.set") {
		if (membership.role === "viewer")
			throw new Error("Viewers cannot respond to team decisions");
		const decision = await executor.first<{ state: string }>(
			`SELECT state FROM team_decisions
WHERE account_user_id = ? AND root_event_id = ? AND event_id = ? AND id = ?`,
			[
				accountUserId,
				rootEventId,
				command.payload.eventId,
				command.payload.decisionId,
			],
		);
		if (decision?.state !== "open")
			throw new Error("Team decision is not open locally");
		const option = await executor.first(
			`SELECT 1 FROM team_decision_options
WHERE account_user_id = ? AND root_event_id = ? AND decision_id = ? AND id = ?`,
			[
				accountUserId,
				rootEventId,
				command.payload.decisionId,
				command.payload.optionId,
			],
		);
		if (!option)
			throw new Error("Team decision option is not available locally");
	}
}

export function teamResponseEntityId(
	decisionId: string,
	accountUserId: string,
) {
	return `trp_${decisionId}:${accountUserId}`;
}

function requiredRecord(
	value: unknown,
	field: string,
): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`Invalid ${field}`);
	return value;
}

function requiredPattern(value: unknown, pattern: RegExp, field: string) {
	if (typeof value !== "string" || !pattern.test(value))
		throw new Error(`Invalid ${field}`);
	return value;
}

function trimmedText(value: unknown, max: number, field: string) {
	if (typeof value !== "string") throw new Error(`Invalid ${field}`);
	const result = value.trim();
	if (result.length < 1 || result.length > max)
		throw new Error(`Invalid ${field}`);
	return result;
}

function nonnegativeVersion(value: unknown) {
	if (!Number.isSafeInteger(value) || Number(value) < 0)
		throw new Error("Invalid base version");
	return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function status(
	state: SyncStatus["state"],
	summary: string,
	pendingCount: number,
	attentionCount: number,
	nextAttemptAt: string | null,
): SyncStatus {
	return { state, summary, pendingCount, attentionCount, nextAttemptAt };
}

function serializeJson(value: unknown): string {
	const result = JSON.stringify(value);
	if (result === undefined) throw new Error("Value is not JSON serializable");
	JSON.parse(result);
	return result;
}

function parseJson<Value>(value: string): Value {
	return JSON.parse(value) as Value;
}

function parseStringArray(value: string): string[] {
	const parsed = parseJson<unknown>(value);
	if (
		!Array.isArray(parsed) ||
		!parsed.every((item) => typeof item === "string")
	) {
		throw new Error("Expected a string array");
	}
	return parsed;
}

const evidenceMutationKinds = new Set<SyncMutation["kind"]>([
	"attachment.commit",
	"capability.remove",
	"capability.replace",
	"event.archive",
	"event.children.reorder",
	"event.create",
	"event.delete",
	"event.reparent",
	"event.update",
	"feed.entry.create",
	"feed.entry.remove",
	"feed.entry.revise",
	"feed.reaction.set",
	"golf.round.replace",
	"golf.score.set",
	"itinerary.create",
	"itinerary.reorder",
	"itinerary.update",
	"place.create",
	"place.update",
	"team.assignments.publish",
	"team.decision.replace",
	"team.response.set",
]);
const evidenceStates = new Set<OutboxState>([
	"pending",
	"sending",
	"awaiting_pull",
	"blocked",
	"dead_letter",
]);

function evidenceMutationKind(
	row: OutboxEvidenceSourceRow,
): SyncMutation["kind"] {
	if (row.operation_id === "eventsCreate") return "event.create";
	const value = parseJson<unknown>(row.command_json);
	if (
		!isRecord(value) ||
		typeof value.kind !== "string" ||
		!evidenceMutationKinds.has(value.kind as SyncMutation["kind"])
	) {
		throw new Error("Persisted outbox mutation kind is invalid");
	}
	return value.kind as SyncMutation["kind"];
}

function validateEvidenceRow(row: OutboxEvidenceSourceRow): void {
	if (!evidenceStates.has(row.state)) {
		throw new Error("Persisted outbox state is invalid");
	}
	const sequence = Number(row.client_sequence);
	if (
		!Number.isSafeInteger(sequence) ||
		(row.operation_id === "eventsCreate" ? sequence !== 0 : sequence < 1)
	) {
		throw new Error("Persisted outbox sequence is invalid");
	}
}

function evidenceCount(value: number | undefined): number {
	const count = Number(value ?? 0);
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new Error("Persisted outbox count is invalid");
	}
	return count;
}

function validateAccount(value: string): void {
	if (!userIdPattern.test(value)) throw new Error("Invalid account user ID");
}

function validateRoot(value: string): void {
	if (!rootIdPattern.test(value)) throw new Error("Invalid root event ID");
}

function validateDevice(value: string): void {
	if (!deviceIdPattern.test(value)) throw new Error("Invalid device ID");
}

function required<Value>(value: Value | null | undefined): Value {
	if (value === null || value === undefined)
		throw new Error("Required value is missing");
	return value;
}
