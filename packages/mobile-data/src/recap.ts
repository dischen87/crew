import {
	type GatewayClient,
	GatewayClientError,
	type GatewayRequest,
	type GatewayResponseData,
	type GatewaySessionSubject,
} from "@crew/mobile-client";
import type { SqlDatabase } from "./database.ts";
import { sha256Hex } from "./sha256.ts";

export type EventRecap = GatewayResponseData<"eventRecapsGet">["recap"];
export type EventRecapExternalConsent =
	GatewayResponseData<"eventRecapsGet">["externalConsent"];
export type EventRecapRole = "owner" | "organizer" | "participant" | "viewer";
export type EventRecapShare = GatewayResponseData<"eventRecapShareLinksCreate">;
export type EventRecapShareLink = EventRecapShare["shareLink"];
export type EventRecapExternalField =
	GatewayRequest<"eventRecapExternalShareLinksCreate">["body"]["fields"][number];
export type EventRecapExternalShare =
	GatewayResponseData<"eventRecapExternalShareLinksCreate">;

export interface EventRecapSnapshot {
	externalConsent: EventRecapExternalConsent;
	recap: EventRecap;
	refreshedAt: string;
	role: EventRecapRole;
}

export interface EventRecapControllerOptions {
	idempotencyKey?: () => string;
	isOnline?: () => boolean;
	now?: () => Date;
}

type RecapAction = "generate" | "publish" | "remove" | "share" | "revoke";

interface MembershipRow {
	role: EventRecapRole;
}

interface RecapCacheRow {
	refreshed_at: string;
	snapshot_json: string;
}

interface CommandAttemptRow {
	fingerprint: string;
	idempotency_key: string;
}

interface ExternalCommandAttemptRow {
	idempotency_key: string;
	request_fingerprint: string;
}

interface GenerationStateRow {
	snapshot_revision: string | null;
}

interface GenerationSourceRow {
	id: string;
	version: number;
}

interface RecapQueues {
	remote: Map<string, Promise<void>>;
}

type RecapGatewayClient = Pick<
	GatewayClient,
	"assertSessionSubject" | "requestAsUser" | "sessionSubject"
>;

const queuesByDatabase = new WeakMap<SqlDatabase, RecapQueues>();
const accountPattern = /^usr_[a-f0-9]{32}$/;
const feedEntryPattern = /^fed_[A-Za-z0-9._:-]{1,96}$/;
const rootPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const shareLinkPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const idempotencyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const revisionPattern = /^(0|[1-9][0-9]*)$/;

export class EventRecapAccountChangedError extends Error {
	constructor() {
		super("Active account changed during recap request");
		this.name = "EventRecapAccountChangedError";
	}
}

export class EventRecapRootAccessDeniedError extends Error {
	constructor() {
		super("This recap is unavailable");
		this.name = "EventRecapRootAccessDeniedError";
	}
}

export class EventRecapManagerRequiredError extends Error {
	constructor() {
		super("This recap action requires an organizer");
		this.name = "EventRecapManagerRequiredError";
	}
}

export class EventRecapOnlineRequiredError extends Error {
	constructor() {
		super("This recap action requires a connection");
		this.name = "EventRecapOnlineRequiredError";
	}
}

export class EventRecapExternalApprovalsRequiredError extends Error {
	constructor() {
		super("External recap approvals are not confirmed");
		this.name = "EventRecapExternalApprovalsRequiredError";
	}
}

export class EventRecapUnavailableError extends Error {
	constructor() {
		super("This recap is unavailable");
		this.name = "EventRecapUnavailableError";
	}
}

export class EventRecapController {
	readonly #idempotencyKey: () => string;
	readonly #isOnline: () => boolean;
	readonly #now: () => Date;
	readonly #queues: Map<string, Promise<void>>;

	constructor(
		private readonly database: SqlDatabase,
		private readonly client: RecapGatewayClient,
		options: EventRecapControllerOptions = {},
	) {
		this.#idempotencyKey = options.idempotencyKey ?? secureIdentifier;
		this.#isOnline = options.isOnline ?? (() => true);
		this.#now = options.now ?? (() => new Date());
		let queues = queuesByDatabase.get(database);
		if (!queues) {
			queues = { remote: new Map() };
			queuesByDatabase.set(database, queues);
		}
		this.#queues = queues.remote;
	}

	async getCached(
		rootEventId: string,
		version?: number,
	): Promise<EventRecapSnapshot | null> {
		validateVersion(version);
		return this.#runForRoot(rootEventId, async (subject, accountUserId) => {
			const role = await this.#activeRole(subject, accountUserId, rootEventId);
			const row = await this.database.first<RecapCacheRow>(
				`SELECT snapshot_json, refreshed_at FROM authorized_recap_cache
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, rootEventId],
			);
			await this.#assertSubject(subject);
			if (!row) return null;
			let recap: EventRecap;
			try {
				recap = parseCachedRecap(row.snapshot_json, rootEventId);
			} catch {
				await this.#purgeRecap(accountUserId, rootEventId);
				return null;
			}
			if (version !== undefined && recap.version !== version) return null;
			if (!isManager(role) && recap.state !== "published") {
				await this.#purgeRecap(accountUserId, rootEventId);
				return null;
			}
			return {
				externalConsent: null,
				recap,
				refreshedAt: row.refreshed_at,
				role,
			};
		});
	}

	async getRole(rootEventId: string): Promise<EventRecapRole> {
		return this.#runForRoot(rootEventId, (subject, accountUserId) =>
			this.#activeRole(subject, accountUserId, rootEventId),
		);
	}

	async refresh(
		rootEventId: string,
		version?: number,
	): Promise<EventRecapSnapshot | null> {
		validateVersion(version);
		return this.#runForRoot(rootEventId, async (subject, accountUserId) => {
			const role = await this.#activeRole(subject, accountUserId, rootEventId);
			try {
				const response = await this.client.requestAsUser(
					subject,
					"eventRecapsGet",
					{
						path: { rootEventId },
						...(version === undefined ? {} : { query: { version } }),
					},
				);
				await this.#assertSubject(subject);
				const recap = validateRecap(response.data.recap, rootEventId, version);
				if (!isManager(role) && recap.state !== "published") {
					await this.#purgeRecap(accountUserId, rootEventId);
					throw new EventRecapUnavailableError();
				}
				const refreshedAt = this.#timestamp();
				await this.#cache(
					subject,
					accountUserId,
					rootEventId,
					recap,
					refreshedAt,
				);
				return {
					externalConsent: validateExternalConsent(
						response.data.externalConsent,
						recap,
					),
					recap,
					refreshedAt,
					role,
				};
			} catch (error) {
				if (
					isAuthoritativeUnavailable(error) ||
					error instanceof EventRecapUnavailableError
				) {
					await this.#purgeRecap(accountUserId, rootEventId);
					return null;
				}
				this.#rethrow(error);
			}
		});
	}

	async generate(rootEventId: string): Promise<EventRecapSnapshot> {
		this.#requireOnline();
		return this.#runForRoot(rootEventId, async (subject, accountUserId) => {
			const role = await this.#managerRole(subject, accountUserId, rootEventId);
			const request = await this.#generationRequest(accountUserId, rootEventId);
			const fingerprint = JSON.stringify(request.body);
			const idempotencyKey = await this.#commandKey(
				accountUserId,
				rootEventId,
				"generate",
				fingerprint,
			);
			try {
				const response = await this.client.requestAsUser(
					subject,
					"eventRecapsGenerate",
					{
						...request,
						headers: { "idempotency-key": idempotencyKey },
					},
				);
				await this.#assertSubject(subject);
				const recap = validateRecap(response.data.recap, rootEventId);
				if (recap.state !== "draft") throw new EventRecapUnavailableError();
				const refreshedAt = this.#timestamp();
				await this.#cache(
					subject,
					accountUserId,
					rootEventId,
					recap,
					refreshedAt,
				);
				return { externalConsent: null, recap, refreshedAt, role };
			} catch (error) {
				return this.#handleMutationError(error, accountUserId, rootEventId);
			}
		});
	}

	async publish(
		rootEventId: string,
		recapVersion: number,
		baseLifecycleVersion: number,
	): Promise<EventRecapSnapshot> {
		this.#requireOnline();
		validatePositiveInteger(recapVersion, "recap version");
		validatePositiveInteger(baseLifecycleVersion, "lifecycle version");
		return this.#runForRoot(rootEventId, async (subject, accountUserId) => {
			const role = await this.#managerRole(subject, accountUserId, rootEventId);
			const body = { baseLifecycleVersion, recapVersion };
			const idempotencyKey = await this.#commandKey(
				accountUserId,
				rootEventId,
				"publish",
				JSON.stringify(body),
			);
			try {
				const response = await this.client.requestAsUser(
					subject,
					"eventRecapsPublish",
					{
						path: { rootEventId },
						body,
						headers: { "idempotency-key": idempotencyKey },
					},
				);
				await this.#assertSubject(subject);
				const recap = validateRecap(response.data.recap, rootEventId);
				if (
					recap.state !== "published" ||
					recap.version !== recapVersion ||
					recap.publishedVersion !== recapVersion
				) {
					throw new EventRecapUnavailableError();
				}
				const refreshedAt = this.#timestamp();
				await this.#cache(
					subject,
					accountUserId,
					rootEventId,
					recap,
					refreshedAt,
				);
				return { externalConsent: null, recap, refreshedAt, role };
			} catch (error) {
				return this.#handleMutationError(error, accountUserId, rootEventId);
			}
		});
	}

	async remove(
		rootEventId: string,
		baseLifecycleVersion: number,
	): Promise<GatewayResponseData<"eventRecapsRemove">> {
		this.#requireOnline();
		validatePositiveInteger(baseLifecycleVersion, "lifecycle version");
		return this.#runForRoot(rootEventId, async (subject, accountUserId) => {
			await this.#managerRole(subject, accountUserId, rootEventId);
			const body = { baseLifecycleVersion };
			const idempotencyKey = await this.#commandKey(
				accountUserId,
				rootEventId,
				"remove",
				JSON.stringify(body),
			);
			try {
				const response = await this.client.requestAsUser(
					subject,
					"eventRecapsRemove",
					{
						path: { rootEventId },
						body,
						headers: { "idempotency-key": idempotencyKey },
					},
				);
				await this.#assertSubject(subject);
				await this.database.transaction(async (transaction) => {
					await this.#assertSubject(subject);
					await transaction.run(
						`DELETE FROM authorized_recap_cache
WHERE account_user_id = ? AND root_event_id = ?`,
						[accountUserId, rootEventId],
					);
					await transaction.run(
						`DELETE FROM recap_command_attempts
WHERE account_user_id = ? AND root_event_id = ? AND action IN ('generate', 'publish', 'share')`,
						[accountUserId, rootEventId],
					);
					await transaction.run(
						`DELETE FROM recap_external_command_attempts
WHERE account_user_id = ? AND root_event_id = ?`,
						[accountUserId, rootEventId],
					);
					await this.#assertSubject(subject);
				});
				return response.data;
			} catch (error) {
				return this.#handleMutationError(error, accountUserId, rootEventId);
			}
		});
	}

	async createShareLink(
		rootEventId: string,
		recapVersion: number,
	): Promise<EventRecapShare> {
		this.#requireOnline();
		validatePositiveInteger(recapVersion, "recap version");
		return this.#runForRoot(rootEventId, async (subject, accountUserId) => {
			await this.#managerRole(subject, accountUserId, rootEventId);
			await this.#requireReviewedPublishedVersion(
				accountUserId,
				rootEventId,
				recapVersion,
			);
			const body = {
				projectionConsent: "title-only-reviewed" as const,
				recapVersion,
			};
			const idempotencyKey = await this.#commandKey(
				accountUserId,
				rootEventId,
				"share",
				JSON.stringify(body),
			);
			try {
				const response = await this.client.requestAsUser(
					subject,
					"eventRecapShareLinksCreate",
					{
						path: { rootEventId },
						body,
						headers: { "idempotency-key": idempotencyKey },
					},
				);
				await this.#assertSubject(subject);
				validateShare(response.data, recapVersion);
				return response.data;
			} catch (error) {
				return this.#handleMutationError(error, accountUserId, rootEventId);
			}
		});
	}

	async decideExternalBody(
		rootEventId: string,
		recapVersion: number,
		field: EventRecapExternalField,
		authority: "author" | "manager",
		decision: "grant" | "withdraw",
	): Promise<GatewayResponseData<"eventRecapExternalGrantsDecide">> {
		this.#requireOnline();
		validatePositiveInteger(recapVersion, "recap version");
		if (authority !== "author" && authority !== "manager") {
			throw new TypeError("Invalid recap external grant authority");
		}
		if (field.sourceType === "event" && authority === "author") {
			throw new TypeError("Event recap bodies do not require author authority");
		}
		if (decision !== "grant" && decision !== "withdraw") {
			throw new TypeError("Invalid recap external grant decision");
		}
		return this.#runForRoot(rootEventId, async (subject, accountUserId) => {
			await this.#activeRole(subject, accountUserId, rootEventId);
			const exactField = await this.#requireReviewedExactField(
				accountUserId,
				rootEventId,
				recapVersion,
				field,
			);
			const body: GatewayRequest<"eventRecapExternalGrantsDecide">["body"] = {
				...(exactField.sourceType === "event"
					? { ...exactField, authority: "manager" as const }
					: { ...exactField, authority }),
				decision,
				recapVersion,
			};
			const idempotencyKey = await this.#externalCommandKey(
				accountUserId,
				rootEventId,
				recapVersion,
				JSON.stringify(["external-decision", recapVersion, exactField]),
				JSON.stringify(body),
			);
			try {
				const response = await this.client.requestAsUser(
					subject,
					"eventRecapExternalGrantsDecide",
					{
						path: { rootEventId },
						body,
						headers: { "idempotency-key": idempotencyKey },
					},
				);
				await this.#assertSubject(subject);
				if (response.data.decision !== decision) {
					throw new EventRecapUnavailableError();
				}
				await this.#clearExternalShareAttempt(
					accountUserId,
					rootEventId,
					recapVersion,
				);
				return response.data;
			} catch (error) {
				return this.#handleMutationError(error, accountUserId, rootEventId);
			}
		});
	}

	async createExactBodyShareLink(
		rootEventId: string,
		recapVersion: number,
		fields: readonly EventRecapExternalField[],
	): Promise<EventRecapExternalShare> {
		this.#requireOnline();
		validatePositiveInteger(recapVersion, "recap version");
		return this.#runForRoot(rootEventId, async (subject, accountUserId) => {
			await this.#managerRole(subject, accountUserId, rootEventId);
			const exactFields = await this.#requireReviewedExactFields(
				accountUserId,
				rootEventId,
				recapVersion,
				fields,
			);
			const body: GatewayRequest<"eventRecapExternalShareLinksCreate">["body"] =
				{
					fields: exactFields,
					projectionConsent: "exact-fields-reviewed-v1",
					recapVersion,
				};
			const idempotencyKey = await this.#externalCommandKey(
				accountUserId,
				rootEventId,
				recapVersion,
				externalShareScope(recapVersion),
				JSON.stringify(body),
			);
			try {
				const response = await this.client.requestAsUser(
					subject,
					"eventRecapExternalShareLinksCreate",
					{
						path: { rootEventId },
						body,
						headers: { "idempotency-key": idempotencyKey },
					},
				);
				await this.#assertSubject(subject);
				validateShare(response.data, recapVersion);
				return response.data;
			} catch (error) {
				if (error instanceof GatewayClientError && error.status === 409) {
					throw new EventRecapExternalApprovalsRequiredError();
				}
				return this.#handleMutationError(error, accountUserId, rootEventId);
			}
		});
	}

	async revokeShareLink(
		rootEventId: string,
		shareLinkId: string,
	): Promise<GatewayResponseData<"eventRecapShareLinksRevoke">> {
		this.#requireOnline();
		if (!shareLinkPattern.test(shareLinkId)) {
			throw new TypeError("Invalid recap share-link ID");
		}
		return this.#runForRoot(rootEventId, async (subject, accountUserId) => {
			await this.#managerRole(subject, accountUserId, rootEventId);
			const idempotencyKey = await this.#commandKey(
				accountUserId,
				rootEventId,
				"revoke",
				shareLinkId,
			);
			try {
				const response = await this.client.requestAsUser(
					subject,
					"eventRecapShareLinksRevoke",
					{
						path: { rootEventId, shareLinkId },
						headers: { "idempotency-key": idempotencyKey },
					},
				);
				await this.#assertSubject(subject);
				return response.data;
			} catch (error) {
				return this.#handleMutationError(error, accountUserId, rootEventId);
			}
		});
	}

	async #generationRequest(
		accountUserId: string,
		rootEventId: string,
	): Promise<GatewayRequest<"eventRecapsGenerate">> {
		const [state, sources] = await Promise.all([
			this.database.first<GenerationStateRow>(
				`SELECT snapshot_revision FROM root_sync_state
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, rootEventId],
			),
			this.database.all<GenerationSourceRow>(
				`SELECT id, version FROM events
WHERE account_user_id = ? AND root_event_id = ?
  AND status = 'published' AND deleted_at IS NULL
ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END,
  length(sort_key), sort_key, id
LIMIT 50`,
				[accountUserId, rootEventId, rootEventId],
			),
		]);
		if (
			!state?.snapshot_revision ||
			!revisionPattern.test(state.snapshot_revision) ||
			sources.length === 0
		) {
			throw new EventRecapUnavailableError();
		}
		return {
			path: { rootEventId },
			body: {
				baseRevision: state.snapshot_revision,
				sources: sources.map((source) => ({
					consentBasis: "event-publication" as const,
					sourceId: source.id,
					sourceVersion: Number(source.version),
					type: "event" as const,
				})),
			},
			headers: { "idempotency-key": "placeholder-key" },
		};
	}

	async #activeRole(
		subject: GatewaySessionSubject,
		accountUserId: string,
		rootEventId: string,
	): Promise<EventRecapRole> {
		const row = await this.database.first<MembershipRow>(
			`SELECT role FROM memberships
WHERE account_user_id = ? AND root_event_id = ?
  AND member_user_id = ? AND status = 'active'`,
			[accountUserId, rootEventId, accountUserId],
		);
		await this.#assertSubject(subject);
		if (!row || !isRole(row.role)) {
			await this.#purgeRecap(accountUserId, rootEventId);
			throw new EventRecapRootAccessDeniedError();
		}
		return row.role;
	}

	async #managerRole(
		subject: GatewaySessionSubject,
		accountUserId: string,
		rootEventId: string,
	): Promise<"owner" | "organizer"> {
		const role = await this.#activeRole(subject, accountUserId, rootEventId);
		if (!isManager(role)) throw new EventRecapManagerRequiredError();
		return role;
	}

	async #cache(
		subject: GatewaySessionSubject,
		accountUserId: string,
		rootEventId: string,
		recap: EventRecap,
		refreshedAt: string,
	): Promise<void> {
		await this.database.transaction(async (transaction) => {
			await this.#assertSubject(subject);
			await transaction.run(
				`INSERT INTO authorized_recap_cache (
  account_user_id, root_event_id, recap_version, lifecycle_version,
  state, snapshot_json, refreshed_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, root_event_id) DO UPDATE SET
  recap_version = excluded.recap_version,
  lifecycle_version = excluded.lifecycle_version,
  state = excluded.state,
  snapshot_json = excluded.snapshot_json,
  refreshed_at = excluded.refreshed_at`,
				[
					accountUserId,
					rootEventId,
					recap.version,
					recap.lifecycleVersion,
					recap.state,
					JSON.stringify(recap),
					refreshedAt,
				],
			);
			await transaction.run(
				`DELETE FROM recap_external_command_attempts
WHERE account_user_id = ? AND root_event_id = ? AND recap_version <> ?`,
				[accountUserId, rootEventId, recap.version],
			);
			await this.#assertSubject(subject);
		});
	}

	async #commandKey(
		accountUserId: string,
		rootEventId: string,
		action: RecapAction,
		fingerprint: string,
	): Promise<string> {
		const existing = await this.database.first<CommandAttemptRow>(
			`SELECT fingerprint, idempotency_key FROM recap_command_attempts
WHERE account_user_id = ? AND root_event_id = ? AND action = ?`,
			[accountUserId, rootEventId, action],
		);
		if (existing?.fingerprint === fingerprint) return existing.idempotency_key;
		const key = this.#idempotencyKey();
		if (!idempotencyPattern.test(key)) {
			throw new TypeError("Invalid recap idempotency key");
		}
		await this.database.run(
			`INSERT INTO recap_command_attempts (
  account_user_id, root_event_id, action, fingerprint, idempotency_key, created_at
) VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, root_event_id, action) DO UPDATE SET
  fingerprint = excluded.fingerprint,
  idempotency_key = excluded.idempotency_key,
  created_at = excluded.created_at`,
			[accountUserId, rootEventId, action, fingerprint, key, this.#timestamp()],
		);
		return key;
	}

	async #externalCommandKey(
		accountUserId: string,
		rootEventId: string,
		recapVersion: number,
		commandScope: string,
		requestFingerprint: string,
	): Promise<string> {
		const [commandScopeHash, fingerprint] = await Promise.all([
			sha256Hex(commandScope),
			sha256Hex(requestFingerprint),
		]);
		const existing = await this.database.first<ExternalCommandAttemptRow>(
			`SELECT request_fingerprint, idempotency_key
FROM recap_external_command_attempts
WHERE account_user_id = ? AND root_event_id = ? AND command_scope_hash = ?`,
			[accountUserId, rootEventId, commandScopeHash],
		);
		if (existing?.request_fingerprint === fingerprint) {
			return existing.idempotency_key;
		}
		const key = this.#idempotencyKey();
		if (!idempotencyPattern.test(key)) {
			throw new TypeError("Invalid recap idempotency key");
		}
		await this.database.run(
			`INSERT INTO recap_external_command_attempts (
  account_user_id, root_event_id, recap_version, command_scope_hash,
  request_fingerprint, idempotency_key, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (account_user_id, root_event_id, command_scope_hash) DO UPDATE SET
  recap_version = excluded.recap_version,
  request_fingerprint = excluded.request_fingerprint,
  idempotency_key = excluded.idempotency_key,
  created_at = excluded.created_at`,
			[
				accountUserId,
				rootEventId,
				recapVersion,
				commandScopeHash,
				fingerprint,
				key,
				this.#timestamp(),
			],
		);
		return key;
	}

	async #clearExternalShareAttempt(
		accountUserId: string,
		rootEventId: string,
		recapVersion: number,
	): Promise<void> {
		const commandScopeHash = await sha256Hex(externalShareScope(recapVersion));
		await this.database.run(
			`DELETE FROM recap_external_command_attempts
WHERE account_user_id = ? AND root_event_id = ? AND command_scope_hash = ?`,
			[accountUserId, rootEventId, commandScopeHash],
		);
	}

	async #requireReviewedPublishedVersion(
		accountUserId: string,
		rootEventId: string,
		recapVersion: number,
	): Promise<EventRecap> {
		const row = await this.database.first<RecapCacheRow>(
			`SELECT snapshot_json, refreshed_at FROM authorized_recap_cache
WHERE account_user_id = ? AND root_event_id = ?`,
			[accountUserId, rootEventId],
		);
		if (!row) throw new EventRecapUnavailableError();
		const recap = parseCachedRecap(row.snapshot_json, rootEventId);
		if (
			recap.state !== "published" ||
			recap.version !== recapVersion ||
			recap.publishedVersion !== recapVersion
		) {
			throw new EventRecapUnavailableError();
		}
		return recap;
	}

	async #requireReviewedExactField(
		accountUserId: string,
		rootEventId: string,
		recapVersion: number,
		field: EventRecapExternalField,
	): Promise<EventRecapExternalField> {
		const fields = await this.#requireReviewedExactFields(
			accountUserId,
			rootEventId,
			recapVersion,
			[field],
		);
		const exactField = fields[0];
		if (!exactField) throw new EventRecapUnavailableError();
		return exactField;
	}

	async #requireReviewedExactFields(
		accountUserId: string,
		rootEventId: string,
		recapVersion: number,
		fields: readonly EventRecapExternalField[],
	): Promise<EventRecapExternalField[]> {
		if (fields.length < 1 || fields.length > 50) {
			throw new TypeError("Invalid recap external field selection");
		}
		const requested = new Map<string, EventRecapExternalField>();
		for (const field of fields) {
			const key = externalFieldKey(field);
			if (requested.has(key)) {
				throw new TypeError("Duplicate recap external field");
			}
			requested.set(key, field);
		}
		const recap = await this.#requireReviewedPublishedVersion(
			accountUserId,
			rootEventId,
			recapVersion,
		);
		const exactFields: EventRecapExternalField[] = [];
		for (const item of recap.items) {
			const exactField = externalFieldFromItem(item);
			if (!exactField) continue;
			const key = externalFieldKey(exactField);
			if (!requested.delete(key)) continue;
			exactFields.push(exactField);
		}
		if (requested.size > 0 || exactFields.length !== fields.length) {
			throw new EventRecapUnavailableError();
		}
		return exactFields;
	}

	async #purgeRecap(accountUserId: string, rootEventId: string): Promise<void> {
		await this.database.transaction(async (transaction) => {
			await transaction.run(
				`DELETE FROM authorized_recap_cache
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, rootEventId],
			);
			await transaction.run(
				`DELETE FROM recap_command_attempts
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, rootEventId],
			);
			await transaction.run(
				`DELETE FROM recap_external_command_attempts
WHERE account_user_id = ? AND root_event_id = ?`,
				[accountUserId, rootEventId],
			);
		});
	}

	async #handleMutationError(
		error: unknown,
		accountUserId: string,
		rootEventId: string,
	): Promise<never> {
		if (
			isAuthoritativeUnavailable(error) ||
			error instanceof EventRecapUnavailableError
		) {
			await this.#purgeRecap(accountUserId, rootEventId);
			if (error instanceof EventRecapUnavailableError) throw error;
			throw error instanceof GatewayClientError && error.status === 403
				? new EventRecapRootAccessDeniedError()
				: new EventRecapUnavailableError();
		}
		this.#rethrow(error);
	}

	async #runForRoot<Result>(
		rootEventId: string,
		work: (
			subject: GatewaySessionSubject,
			accountUserId: string,
		) => Promise<Result>,
	): Promise<Result> {
		validateRoot(rootEventId);
		const subject = await this.client.sessionSubject();
		if (!subject) throw new EventRecapAccountChangedError();
		if (!accountPattern.test(subject.userId)) {
			throw new TypeError("Invalid recap account ID");
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
		if (!this.#isOnline()) throw new EventRecapOnlineRequiredError();
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
			throw new EventRecapAccountChangedError();
		}
		throw error;
	}

	#timestamp(): string {
		return this.#now().toISOString();
	}
}

function validateRecap(
	recap: EventRecap,
	rootEventId: string,
	version?: number,
): EventRecap {
	if (
		recap.rootEventId !== rootEventId ||
		(version !== undefined && recap.version !== version) ||
		!Number.isSafeInteger(recap.version) ||
		recap.version < 1 ||
		!Number.isSafeInteger(recap.lifecycleVersion) ||
		recap.lifecycleVersion < 1
	) {
		throw new EventRecapUnavailableError();
	}
	return recap;
}

function parseCachedRecap(value: string, rootEventId: string): EventRecap {
	try {
		return validateRecap(JSON.parse(value) as EventRecap, rootEventId);
	} catch {
		throw new EventRecapUnavailableError();
	}
}

function validateExternalConsent(
	value: EventRecapExternalConsent,
	recap: EventRecap,
): EventRecapExternalConsent {
	if (!value || recap.state !== "published") return null;
	const bodyItems = new Map<
		number,
		EventRecap["items"][number]["provenance"]["sourceType"]
	>();
	for (const item of recap.items) {
		if (item.sourceBody === null) continue;
		if (bodyItems.has(item.ordinal)) return null;
		bodyItems.set(item.ordinal, item.provenance.sourceType);
	}
	if (value.fields.length !== bodyItems.size) return null;
	const seen = new Set<number>();
	for (const field of value.fields) {
		const sourceType = bodyItems.get(field.ordinal);
		if (!sourceType || seen.has(field.ordinal)) return null;
		seen.add(field.ordinal);
		const requiredAuthorities =
			sourceType === "event"
				? (["manager"] as const)
				: (["author", "manager"] as const);
		if (
			field.requiredAuthorities.length !== requiredAuthorities.length ||
			field.requiredAuthorities.some(
				(authority, index) => authority !== requiredAuthorities[index],
			) ||
			(sourceType === "event" && field.authorDecision !== "unknown")
		) {
			return null;
		}
		const actorAuthorities = new Set(field.actorCanDecide);
		if (
			actorAuthorities.size !== field.actorCanDecide.length ||
			field.actorCanDecide.some(
				(authority) =>
					!requiredAuthorities.some((required) => required === authority),
			)
		) {
			return null;
		}
	}
	return value;
}

function validateShare(value: EventRecapShare, recapVersion: number): void {
	if (
		value.shareLink.recapVersion !== recapVersion ||
		!shareLinkPattern.test(value.shareLink.id) ||
		typeof value.token !== "string" ||
		value.token.length < 20
	) {
		throw new EventRecapUnavailableError();
	}
}

function externalShareScope(recapVersion: number): string {
	return JSON.stringify(["external-share", recapVersion]);
}

function externalFieldKey(field: EventRecapExternalField): string {
	if (
		field.field !== "body" ||
		!Number.isSafeInteger(field.sourceVersion) ||
		field.sourceVersion < 1 ||
		(field.sourceType === "event"
			? !rootPattern.test(field.sourceId)
			: field.sourceType === "feedEntry"
				? !feedEntryPattern.test(field.sourceId)
				: true)
	) {
		throw new TypeError("Invalid recap external field");
	}
	return JSON.stringify([
		field.sourceType,
		field.sourceId,
		field.sourceVersion,
		field.field,
	]);
}

function externalFieldFromItem(
	item: EventRecap["items"][number],
): EventRecapExternalField | null {
	if (item.sourceBody === null) return null;
	const field = {
		field: "body" as const,
		sourceId: item.provenance.sourceId,
		sourceVersion: item.provenance.sourceVersion,
	};
	return item.provenance.sourceType === "event"
		? { ...field, sourceType: "event" }
		: { ...field, sourceType: "feedEntry" };
}

function validateRoot(rootEventId: string): void {
	if (!rootPattern.test(rootEventId))
		throw new TypeError("Invalid recap root ID");
}

function validateVersion(version: number | undefined): void {
	if (version !== undefined) validatePositiveInteger(version, "recap version");
}

function validatePositiveInteger(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new TypeError(`Invalid ${label}`);
	}
}

function isRole(value: string): value is EventRecapRole {
	return (
		value === "owner" ||
		value === "organizer" ||
		value === "participant" ||
		value === "viewer"
	);
}

function isManager(
	role: EventRecapRole,
): role is Extract<EventRecapRole, "owner" | "organizer"> {
	return role === "owner" || role === "organizer";
}

function isAuthoritativeUnavailable(error: unknown): boolean {
	return (
		error instanceof GatewayClientError &&
		(error.status === 403 || error.status === 404)
	);
}

function secureIdentifier(): string {
	const bytes = new Uint8Array(16);
	if (!globalThis.crypto?.getRandomValues) {
		throw new Error("Secure random generation is unavailable");
	}
	globalThis.crypto.getRandomValues(bytes);
	bytes[6] = ((bytes.at(6) ?? 0) % 16) + 64;
	bytes[8] = ((bytes.at(8) ?? 0) % 64) + 128;
	const hex = Array.from(bytes, (value) =>
		value.toString(16).padStart(2, "0"),
	).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
