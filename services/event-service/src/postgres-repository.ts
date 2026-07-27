import { randomBytes } from "node:crypto";
import type { Sql } from "postgres";
import { attachmentCommittedKey } from "./attachment-keys";
import {
	type Actor,
	assertRootCreationStatus,
	type CapabilityInput,
	type CapabilityRecord,
	type CapabilityType,
	DomainError,
	type EventInput,
	type EventPatch,
	type EventPublishReadiness,
	type EventPublishReadinessReason,
	type EventRecord,
	type EventRootSummary,
	type InvitationAdminSummary,
	type InvitationRecord,
	type InvitePreview,
	type ItineraryDetails,
	type ItineraryDetailsInput,
	type ItineraryInput,
	type ItineraryPatch,
	type ItineraryRecord,
	type MembershipRecord,
	type MembershipStatus,
	type PlaceInput,
	type PlacePatch,
	type PlaceRecord,
	type PlaceSnapshot,
	type Role,
	type RootView,
} from "./domain";
import {
	type EventNotificationPayload,
	type EventNotificationPayloadCodec,
	eventNotificationJobId,
} from "./event-notification-payload";
import {
	capabilityEntityId,
	EVENT_TEMPLATES,
	type EventTemplateIdentity,
	type EventTemplateInstantiation,
	type EventTemplateRequest,
	resolveEventTemplate,
} from "./event-templates";
import {
	type AttachmentFinalizePrecondition,
	type AttachmentRecord,
	type AttachmentTarget,
	type AttachmentUploadRecord,
	type AttachmentVerificationStatus,
	type FeedEntryRecord,
	type FeedKind,
	type FeedReactionRecord,
	feedReactionEntityId,
	type ReactionSummary,
} from "./feed-domain";
import type { FeedbackInput, FeedbackStatus } from "./feedback-domain";
import type { GolfRoundSetupInput, GolfScoreInput } from "./golf-domain";
import type { PlaceCandidateKind } from "./place-candidate";
import { globalPlaceId, type PlaceEnrichmentPolicy } from "./place-enrichment";
import { PostgresPlaceEnrichmentJobs } from "./place-enrichment-jobs";
import {
	assertCommunityFeedbackAccess,
	addCommunityFeedbackComment as communityFeedbackCommentAdd,
	listCommunityFeedbackDuplicateSuggestions as communityFeedbackDuplicateSuggestionsList,
	setCommunityFeedbackFollow as communityFeedbackFollowSet,
	getCommunityFeedback as communityFeedbackGet,
	listCommunityFeedback as communityFeedbackList,
	listCommunityFeedbackUpdates as communityFeedbackUpdatesList,
	setCommunityFeedbackVote as communityFeedbackVoteSet,
} from "./postgres-community-feedback";
import {
	assertFeedbackAccess,
	addFeedbackComment as feedbackCommentAdd,
	createFeedback as feedbackCreate,
	getFeedback as feedbackGet,
	markFeedbackDuplicate as feedbackMarkDuplicate,
	setFeedbackStatus as feedbackStatusSet,
	setFeedbackVote as feedbackVoteSet,
} from "./postgres-feedback";
import {
	appendGolfPlayerRemovalChanges,
	assertGolfRoundReplaySafe,
	assertGolfScoreReplaySafe,
	replaceGolfRound as golfRoundReplace,
	setGolfScore as golfScoreSet,
	golfSnapshotRecords,
} from "./postgres-golf";
import {
	assertTeamAssignmentsReplaySafe,
	assertTeamDecisionReplaySafe,
	assertTeamResponseReplaySafe,
	publishTeamAssignments as teamAssignmentsPublish,
	replaceTeamDecision as teamDecisionReplace,
	setTeamResponse as teamResponseSet,
	teamSnapshotRecords,
} from "./postgres-team";
import type {
	RecapCaptionFieldRefCodec,
	RecapCaptionFieldRefInput,
} from "./recap-caption-field-ref";
import type {
	EventRecap,
	EventRecapExternalConsent,
	EventRecapExternalGrantDecision,
	EventRecapExternalShare,
	EventRecapItem,
	EventRecapProvenance,
	EventRecapRead,
	EventRecapRemoval,
	EventRecapShare,
	EventRecapShareLink,
	EventRecapShareRevocation,
	RecapExternalDecisionState,
	RecapExternalField,
	RecapExternalGrantDecisionInput,
	RecapSourceInput,
} from "./recap-domain";
import type { EventRepository, PlaceEnrichmentScope } from "./repository";
import {
	type BootstrapCursor,
	type SyncAppliedMutation,
	type SyncBootstrapPage,
	type SyncChange,
	type SyncChangePage,
	type SyncEntityType,
	type SyncMutation,
	type SyncMutationResult,
	type SyncPushInput,
	type SyncPushResponse,
	type SyncRootAccess,
	type SyncSnapshotRecord,
	syncMutationFingerprint,
} from "./sync";
import {
	type SystemFeedPayload,
	systemFeedEntryId,
	systemFeedPayloadJson,
} from "./system-feed";
import type { TeamAssignmentSetInput, TeamDecisionInput } from "./team-domain";

type Tx = Sql;
type RootRow = {
	revision: string;
	status: "active" | "archived";
	templateId: EventTemplateIdentity["id"] | null;
	templateVersion: 1 | null;
};
type RecapHeadRow = {
	latestVersion: number;
	publishedVersion: number | null;
	lifecycleVersion: number;
	removedThroughVersion: number;
	publishedAt: Date | null;
};
type RecapSnapshotRow = {
	rootEventId: string;
	version: number;
	sourceRootRevision: string;
	title: string;
	titleSourceVersion: number;
	titleSourceRevision: string;
	generatedAt: Date;
};
type RecapShareLinkRow = {
	id: string;
	rootEventId: string;
	recapVersion: number;
	tokenKeyId: string;
	projectionConsent:
		| "legacy-unreviewed"
		| "title-only-reviewed"
		| "exact-fields-reviewed-v1";
	createdBy: string;
	createdByMembershipVersion: number | null;
	createdAt: Date;
	expiresAt: Date;
	revokedAt: Date | null;
	unexpired: boolean;
};
type RecapExternalGrantDecisionRow = {
	id: string;
	recapOrdinal: number;
	sourceType: "event" | "feedEntry";
	sourceId: string;
	sourceVersion: number;
	fieldName: string;
	authority: "author" | "manager";
	decision: "grant" | "withdraw";
	actorId: string;
	actorMembershipVersion: number;
};
type RecapExternalGrantReadRow = RecapExternalGrantDecisionRow & {
	membershipRole: Role | null;
	membershipStatus: MembershipStatus | null;
	currentMembershipVersion: number | null;
};
type RecapExternalShareFieldRow = {
	recapOrdinal: number;
	sourceType: "event" | "feedEntry";
	sourceId: string;
	sourceVersion: number;
	fieldName: string;
};
type RecapItemRow = {
	ordinal: number;
	sourceType: "event" | "feedEntry";
	sourceId: string;
	sourceVersion: number;
	sourceRevision: string;
	sourceVisibility: "members";
	consentBasis: "event-publication" | "source-author";
	consentedByUserId: string | null;
	consentMembershipVersion: number | null;
	sourceTitle: string | null;
	sourceBody: string | null;
};
type RecapSourceProjection = RecapItemRow;
type RecapCaptionRow = {
	id: string;
	targetEntryId: string;
	version: number;
	rootRevision: string;
	createdBy: string;
	caption: string;
};
type RecapExternalFieldTarget =
	| {
			field: "body";
			item: RecapItemRow;
			storageFieldName: "body";
	  }
	| {
			field: "caption";
			item: RecapItemRow;
			attachment: RecapCaptionRow;
			attachmentOrdinal: number;
			storageFieldName: string;
	  };
type RecapEventSource = {
	sourceId: string;
	sourceVersion: number;
	sourceRevision: string;
	sourceTitle: string;
	sourceBody: string | null;
};
type RecapFeedSource = {
	sourceId: string;
	sourceVersion: number;
	sourceRevision: string;
	sourceBody: string;
	authorUserId: string;
	consentActive: boolean;
	consentMembershipVersion: number | null;
};
type RecapSourceIssue = {
	code:
		| "RECAP_SOURCE_UNAVAILABLE"
		| "RECAP_SOURCE_VERSION_CHANGED"
		| "RECAP_SOURCE_CONSENT_REQUIRED"
		| "RECAP_SOURCE_CONTENT_TOO_LARGE";
	message: string;
	path: string;
};
const ROOT_EVENT_LIMIT = 500;
const EVENT_ITINERARY_LIMIT = 500;
const ROOT_GRAPH_LIMIT = ROOT_EVENT_LIMIT;
const ATTACHMENTS_PER_ENTRY_LIMIT = 10;
const ATTACHMENTS_PER_FEEDBACK_LIMIT = 5;
const LIVE_UPLOADS_PER_ACTOR_LIMIT = 5;
const PENDING_VERIFY_PER_ACTOR_ROOT_LIMIT = 5;
const PENDING_VERIFY_PER_ROOT_LIMIT = 500;
const PENDING_VERIFY_GLOBAL_LIMIT = 10_000;
const MAX_NOTIFICATION_RECIPIENTS_PER_FEED = 500;
const RECAP_SOURCE_LIMIT = 50;
const RECAP_SOURCE_BODY_LIMIT = 5_000;
const RECAP_VERSION_LIMIT = 2_147_483_647;
type FeedNotificationAudience = "visible" | "managers";

async function cleanupExpiredIdempotency(
	tx: Tx,
	input: {
		actor: Actor;
		operationId: string;
		idempotencyKey: string;
	},
) {
	await tx`
		DELETE FROM event_idempotency_records
		WHERE actor_id = ${input.actor.id}
			AND operation_id = ${input.operationId}
			AND idempotency_key = ${input.idempotencyKey}
			AND expires_at <= clock_timestamp()
	`;
	await tx`
		DELETE FROM event_idempotency_records
		WHERE ctid IN (
			SELECT ctid FROM event_idempotency_records
			WHERE expires_at <= clock_timestamp()
			ORDER BY expires_at
			LIMIT 100
			FOR UPDATE SKIP LOCKED
		)
	`;
}

export class PostgresEventRepository implements EventRepository {
	constructor(
		private readonly sql: Sql,
		private readonly notificationPayloads: EventNotificationPayloadCodec,
		private readonly inTransaction = false,
		private readonly recapCaptions?: {
			enabled: boolean;
			fieldRefs: RecapCaptionFieldRefCodec;
		},
	) {}

	async findIdempotent<T extends Record<string, unknown>>(
		input: {
			actor: Actor;
			operationId: string;
			idempotencyKey: string;
			requestHash: string;
		},
		replayGuard?:
			| ((
					repository: EventRepository,
					replay: {
						status: number;
						body: T;
						headers: Record<string, string>;
					},
			  ) => Promise<void>)
			| undefined,
	) {
		return this.transaction(async (tx) => {
			await cleanupExpiredIdempotency(tx, input);
			const [record] = await tx<
				{
					requestHash: string;
					state: "processing" | "complete";
					responseStatus: number | null;
					responseBody: T | null;
					responseHeaders: Record<string, string> | null;
				}[]
			>`
				SELECT request_hash AS "requestHash", state,
					response_status AS "responseStatus", response_body AS "responseBody",
					response_headers AS "responseHeaders"
				FROM event_idempotency_records
				WHERE actor_id = ${input.actor.id}
					AND operation_id = ${input.operationId}
					AND idempotency_key = ${input.idempotencyKey}
					AND expires_at > clock_timestamp()
			`;
			if (!record) return null;
			if (record.requestHash !== input.requestHash)
				throw conflict(
					"IDEMPOTENCY_KEY_REUSED",
					"The idempotency key was already used for a different request.",
				);
			if (
				record.state !== "complete" ||
				record.responseStatus === null ||
				record.responseBody === null ||
				record.responseHeaders === null
			)
				throw conflict(
					"IDEMPOTENCY_IN_PROGRESS",
					"The original request is still in progress.",
					{ "Retry-After": "1" },
				);
			const replay = {
				status: record.responseStatus,
				body: record.responseBody,
				headers: record.responseHeaders,
			};
			await replayGuard?.(
				new PostgresEventRepository(
					tx,
					this.notificationPayloads,
					true,
					this.recapCaptions,
				),
				replay,
			);
			return { ...replay, replayed: true as const };
		});
	}

	async runIdempotent<T extends Record<string, unknown>>(
		input: {
			actor: Actor;
			operationId: string;
			idempotencyKey: string;
			requestHash: string;
		},
		work: (
			repository: EventRepository,
		) => Promise<{ status: number; body: T; headers: Record<string, string> }>,
		guard?: ((repository: EventRepository) => Promise<void>) | undefined,
		replayGuard?:
			| ((
					repository: EventRepository,
					replay: {
						status: number;
						body: T;
						headers: Record<string, string>;
					},
			  ) => Promise<void>)
			| undefined,
	) {
		if (this.inTransaction) throw new Error("Nested idempotent command");
		return this.sql.begin(async (transaction) => {
			const tx = transaction as unknown as Tx;
			const [lock] = await tx<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(
          hashtextextended(${`${input.actor.id}:${input.operationId}:${input.idempotencyKey}`}, 0)
        ) AS acquired
      `;
			if (!lock?.acquired) {
				throw conflict(
					"IDEMPOTENCY_IN_PROGRESS",
					"The original request is still in progress.",
					{ "Retry-After": "1" },
				);
			}
			await cleanupExpiredIdempotency(tx, input);
			const repository = new PostgresEventRepository(
				tx,
				this.notificationPayloads,
				true,
				this.recapCaptions,
			);
			await guard?.(repository);
			const inserted = await tx`
        INSERT INTO event_idempotency_records (
          actor_id, operation_id, idempotency_key, request_hash, state
        ) VALUES (
          ${input.actor.id}, ${input.operationId}, ${input.idempotencyKey},
          ${input.requestHash}, 'processing'
        )
        ON CONFLICT DO NOTHING
        RETURNING actor_id
      `;
			if (inserted.length === 0) {
				const [record] = await tx<
					{
						requestHash: string;
						state: "processing" | "complete";
						responseStatus: number | null;
						responseBody: T | null;
						responseHeaders: Record<string, string> | null;
						active: boolean;
					}[]
				>`
		          SELECT request_hash AS "requestHash", state,
		            response_status AS "responseStatus", response_body AS "responseBody",
		            response_headers AS "responseHeaders",
		            expires_at > clock_timestamp() AS active
		          FROM event_idempotency_records
          WHERE actor_id = ${input.actor.id}
            AND operation_id = ${input.operationId}
            AND idempotency_key = ${input.idempotencyKey}
          FOR UPDATE
		        `;
				if (!record) throw new Error("Idempotency claim invariant failed");
				if (!record.active) {
					await tx`
						DELETE FROM event_idempotency_records
						WHERE actor_id = ${input.actor.id}
							AND operation_id = ${input.operationId}
							AND idempotency_key = ${input.idempotencyKey}
					`;
					const replaced = await tx`
						INSERT INTO event_idempotency_records (
							actor_id, operation_id, idempotency_key, request_hash, state
						) VALUES (
							${input.actor.id}, ${input.operationId}, ${input.idempotencyKey},
							${input.requestHash}, 'processing'
						)
						RETURNING actor_id
					`;
					if (replaced.length !== 1)
						throw new Error("Idempotency replacement invariant failed");
				} else {
					if (record.requestHash !== input.requestHash) {
						throw conflict(
							"IDEMPOTENCY_KEY_REUSED",
							"The idempotency key was already used for a different request.",
						);
					}
					if (
						record.state !== "complete" ||
						record.responseStatus === null ||
						record.responseBody === null ||
						record.responseHeaders === null
					) {
						throw conflict(
							"IDEMPOTENCY_IN_PROGRESS",
							"The original request is still in progress.",
							{ "Retry-After": "1" },
						);
					}
					const replay = {
						status: record.responseStatus,
						body: record.responseBody,
						headers: record.responseHeaders,
					};
					await replayGuard?.(repository, replay);
					return { ...replay, replayed: true };
				}
			}

			const result = await work(repository);
			const [stored] = await tx<
				{
					responseBody: T;
					responseHeaders: Record<string, string>;
				}[]
			>`
        UPDATE event_idempotency_records SET
          state = 'complete', response_status = ${result.status},
          response_body = ${tx.json(result.body as never)},
          response_headers = ${tx.json(result.headers as never)}, completed_at = now()
        WHERE actor_id = ${input.actor.id}
          AND operation_id = ${input.operationId}
          AND idempotency_key = ${input.idempotencyKey}
		RETURNING response_body AS "responseBody",
			response_headers AS "responseHeaders"
      `;
			if (!stored) throw new Error("Idempotency completion invariant failed");
			return {
				status: result.status,
				body: stored.responseBody,
				headers: stored.responseHeaders,
				replayed: false,
			};
		});
	}

	async assertSyncRootVisible(actor: Actor, rootEventId: string) {
		await this.transaction(async (tx) => {
			await syncRootAccess(tx, rootEventId, actor, "update");
		});
	}

	async assertSyncPushReplaySafe(actor: Actor, input: SyncPushInput) {
		await this.transaction(async (tx) => {
			await syncRootAccess(tx, input.rootEventId, actor, "update");
			for (const mutation of input.mutations) {
				await assertGolfSyncMutationReplaySafe(
					tx,
					actor,
					input.rootEventId,
					mutation,
				);
				await assertTeamSyncMutationReplaySafe(
					tx,
					actor,
					input.rootEventId,
					mutation,
				);
			}
		});
	}

	async assertRootReplaySafe(
		actor: Actor,
		rootEventId: string,
		access: "member" | "manager" | "writer",
	) {
		await this.transaction(async (tx) => {
			const root = await lockRoot(tx, rootEventId, "share");
			const membership = await requireMembership(tx, rootEventId, actor);
			if (
				(access === "manager" && !isManager(membership.role)) ||
				(access === "writer" &&
					(root.status !== "active" || membership.role === "viewer")) ||
				(access === "member" &&
					root.status !== "active" &&
					!isManager(membership.role))
			)
				throw notFound();
		});
	}

	async assertFeedReplaySafe(
		actor: Actor,
		rootEventId: string,
		entryId: string,
		expectedVersion: number | null,
		expectedRootRevision: string | null,
		requireLive: boolean,
	) {
		await this.transaction(async (tx) => {
			const root = await lockRoot(tx, rootEventId, "share");
			const membership = await requireMembership(tx, rootEventId, actor);
			if (root.status !== "active" || membership.role === "viewer")
				throw notFound();
			if (expectedVersion === null && !requireLive) return;
			const entry = await findVisibleFeedEntry(tx, actor, rootEventId, entryId);
			if (
				!entry ||
				(requireLive && entry.deletedAt !== null) ||
				(expectedVersion !== null &&
					(entry.version !== expectedVersion ||
						entry.rootRevision !== expectedRootRevision))
			)
				throw notFound();
		});
	}

	async assertAttachmentReplaySafe(
		actor: Actor,
		rootEventId: string,
		attachmentId: string | null,
	) {
		if (attachmentId !== null) {
			await this.getAttachment(actor, rootEventId, attachmentId);
			return;
		}
		await this.assertRootReplaySafe(actor, rootEventId, "writer");
	}

	async assertAttachmentTargetReplaySafe(
		actor: Actor,
		rootEventId: string,
		target: AttachmentTarget,
	) {
		await this.transaction(async (tx) => {
			await lockAttachmentTarget(tx, actor, rootEventId, target, {
				feedbackMayExist: true,
			});
		});
	}

	async assertAttachmentUploadReplaySafe(
		actor: Actor,
		rootEventId: string,
		uploadId: string,
	) {
		await this.getAttachmentUpload(actor, rootEventId, uploadId);
	}

	async assertAttachmentFinalizeReplaySafe(
		actor: Actor,
		rootEventId: string,
		uploadId: string,
		attachmentId: string,
	) {
		await this.transaction(async (tx) => {
			const [upload] = await tx<AttachmentUploadRecord[]>`
				SELECT ${uploadColumns(tx)} FROM event_attachment_uploads
				WHERE root_event_id = ${rootEventId} AND id = ${uploadId}
			`;
			if (
				!upload ||
				upload.createdBy !== actor.id ||
				upload.attachmentId !== attachmentId
			)
				throw notFound();
			if (upload.target.kind === "feedEntry") {
				const attachment = await new PostgresEventRepository(
					tx,
					this.notificationPayloads,
					true,
					this.recapCaptions,
				).getAttachment(actor, rootEventId, attachmentId);
				if (!sameAttachmentTarget(upload.target, attachment.target))
					throw notFound();
			} else {
				const context = await lockAttachmentRoot(tx, actor, rootEventId);
				await assertAttachmentTarget(
					tx,
					actor,
					rootEventId,
					upload.target,
					context,
					{ feedbackMayExist: true },
				);
			}
			const [binding] = await tx<{ id: string }[]>`
				SELECT id FROM event_attachments
				WHERE root_event_id = ${rootEventId} AND id = ${attachmentId}
					AND upload_id = ${uploadId}
			`;
			if (!binding) throw notFound();
		});
	}

	async assertRecapReplaySafe(
		actor: Actor,
		rootEventId: string,
		recapVersion: number | null,
	) {
		await this.transaction(async (tx) => {
			await lockRoot(tx, rootEventId, "share");
			const membership = await requireMembership(tx, rootEventId, actor);
			if (!isManager(membership.role)) throw notFound();
			if (recapVersion === null) return;
			const head = await findRecapHead(tx, rootEventId, false);
			if (
				!head ||
				recapVersion > head.latestVersion ||
				recapVersion <= head.removedThroughVersion
			)
				throw notFound();
			const snapshot = await findRecapSnapshot(tx, rootEventId, recapVersion);
			if (!snapshot) throw notFound();
			const validation = await validateRecapSnapshot(tx, rootEventId, snapshot);
			if (!validation.titleValid || validation.issues.length) throw notFound();
		});
	}

	async assertRecapShareLinkReplaySafe(
		actor: Actor,
		rootEventId: string,
		shareLinkId: string | null,
	) {
		return this.transaction(async (tx) => {
			const root = await lockRoot(tx, rootEventId, "share");
			const membership = await requireMembership(tx, rootEventId, actor);
			if (root.status !== "active" || !isManager(membership.role))
				throw notFound();
			if (shareLinkId === null) return null;
			const link = await findRecapShareLinkById(tx, rootEventId, shareLinkId);
			if (!link) throw notFound();
			await validateAnyRecapShareLinkPolicy(
				tx,
				link,
				this.recapCaptions?.enabled === true,
			);
			return link.tokenKeyId;
		});
	}

	async assertRecapExternalGrantReplaySafe(
		actor: Actor,
		rootEventId: string,
		recapVersion: number,
		input: RecapExternalGrantDecisionInput,
	) {
		await this.transaction(async (tx) => {
			const root = await lockRoot(tx, rootEventId, "share");
			if (root.status !== "active") throw notFound();
			const context = await requireCurrentPublishedRecap(
				tx,
				rootEventId,
				recapVersion,
			);
			const target = await requireRecapExternalField(
				tx,
				context.validation.items,
				context.snapshot,
				input,
				this.recapCaptions,
			);
			const membership = await requireRecapExternalGrantAuthority(
				tx,
				actor,
				rootEventId,
				target,
				input.authority,
			);
			const latest = await findLatestRecapExternalGrantDecision(
				tx,
				rootEventId,
				recapVersion,
				target,
				input.authority,
			);
			if (
				!latest ||
				latest.decision !== input.decision ||
				latest.actorId !== actor.id ||
				latest.actorMembershipVersion !== membership.version
			)
				throw notFound();
		});
	}

	async readSyncRootRevision(actor: Actor, rootEventId: string) {
		return this.transaction(
			async (tx) =>
				(await syncRootAccess(tx, rootEventId, actor, "share")).rootRevision,
		);
	}

	async runSyncPush(
		actor: Actor,
		input: SyncPushInput,
		apply: (
			repository: EventRepository,
			mutation: SyncMutation,
		) => Promise<SyncAppliedMutation>,
	): Promise<SyncPushResponse> {
		return this.transaction(async (tx) => {
			await syncRootAccess(tx, input.rootEventId, actor, "update");
			for (const clientMutationId of [
				...new Set(
					input.mutations.map((mutation) => mutation.clientMutationId),
				),
			].sort()) {
				await tx`
					SELECT pg_advisory_xact_lock(
						hashtextextended(
							${`crew:sync-mutation:${actor.id}:${clientMutationId}`}, 0
						)
					)
				`;
			}
			await tx`
				INSERT INTO event_sync_streams (actor_id, device_id, root_event_id)
				VALUES (${actor.id}, ${input.deviceId}, ${input.rootEventId})
				ON CONFLICT DO NOTHING
			`;
			const [stream] = await tx<{ nextClientSequence: string }[]>`
				SELECT next_client_sequence::text AS "nextClientSequence"
				FROM event_sync_streams
				WHERE actor_id = ${actor.id} AND device_id = ${input.deviceId}
					AND root_event_id = ${input.rootEventId}
				FOR UPDATE
			`;
			if (!stream) throw new Error("Sync stream invariant failed");
			let nextExpectedClientSequence = Number(stream.nextClientSequence);
			let stopped = false;
			const results: SyncMutationResult[] = [];
			const mutations = input.mutations
				.map((mutation, index) => ({ mutation, index }))
				.sort(
					(left, right) =>
						left.mutation.clientSequence - right.mutation.clientSequence ||
						left.index - right.index,
				)
				.map(({ mutation }) => mutation);
			const savepoint = <T>(
				work: (repository: EventRepository) => Promise<T>,
			) =>
				(
					tx as unknown as {
						savepoint<T>(work: (sql: Tx) => Promise<T>): Promise<T>;
					}
				).savepoint((sql) =>
					work(
						new PostgresEventRepository(
							sql,
							this.notificationPayloads,
							true,
							this.recapCaptions,
						),
					),
				);

			for (const mutation of mutations) {
				if (stopped) {
					results.push(
						syncBlockedResult(
							mutation,
							"PREVIOUS_MUTATION_BLOCKED",
							"An earlier mutation in this stream needs attention.",
						),
					);
					continue;
				}
				const fingerprint = syncMutationFingerprint(actor.id, input, mutation);
				const [receipt] = await tx<
					{ fingerprint: string; result: SyncMutationResult }[]
				>`
					SELECT fingerprint, result FROM event_sync_mutation_receipts
					WHERE actor_id = ${actor.id}
						AND client_mutation_id = ${mutation.clientMutationId}::uuid
				`;
				if (receipt) {
					if (receipt.fingerprint !== fingerprint) {
						results.push(
							syncIntegrityRejectedResult(
								mutation,
								"IDEMPOTENCY_KEY_REUSED",
								"The mutation ID was already used for different content.",
							),
						);
						stopped = true;
						continue;
					}
					if (receipt.result.outcome === "applied") {
						await assertGolfSyncMutationReplaySafe(
							tx,
							actor,
							input.rootEventId,
							mutation,
						);
						await assertTeamSyncMutationReplaySafe(
							tx,
							actor,
							input.rootEventId,
							mutation,
						);
					}
					const replay = { ...receipt.result, replayed: true };
					results.push(replay);
					if (replay.outcome === "rejected") stopped = true;
					continue;
				}
				const [occupied] = await tx<{ clientMutationId: string }[]>`
					SELECT client_mutation_id::text AS "clientMutationId"
					FROM event_sync_mutation_receipts
					WHERE actor_id = ${actor.id} AND device_id = ${input.deviceId}
						AND root_event_id = ${input.rootEventId}
						AND client_sequence = ${mutation.clientSequence}
				`;
				if (occupied || mutation.clientSequence < nextExpectedClientSequence) {
					results.push(
						syncIntegrityRejectedResult(
							mutation,
							"SEQUENCE_REUSED",
							"The client sequence was already consumed by another mutation.",
						),
					);
					stopped = true;
					continue;
				}
				if (mutation.clientSequence > nextExpectedClientSequence) {
					results.push(
						syncBlockedResult(
							mutation,
							"CAUSAL_GAP",
							`Client sequence ${nextExpectedClientSequence} must be submitted first.`,
						),
					);
					stopped = true;
					continue;
				}

				let outcome: SyncMutationResult;
				try {
					if (mutation.kind === "attachment.commit") {
						const uploadId = mutation.payload.uploadId;
						if (typeof uploadId !== "string")
							throw new DomainError(
								400,
								"SYNC_PAYLOAD_INVALID",
								"The attachment upload ID is invalid.",
							);
						const verification = await savepoint((repository) =>
							repository.ensureAttachmentVerification(
								actor,
								input.rootEventId,
								uploadId,
							),
						);
						if (verification.state !== "ready") {
							outcome = {
								clientMutationId: mutation.clientMutationId,
								clientSequence: mutation.clientSequence,
								outcome: "retry",
								replayed: false,
								retryAfterSeconds: verification.retryAfterSeconds,
								error: {
									code: "ATTACHMENT_VERIFICATION_PENDING",
									message: "Attachment verification is still pending.",
									retryable: true,
								},
							};
							results.push(outcome);
							stopped = true;
							continue;
						}
					}
					const applied = await savepoint((repository) =>
						apply(repository, mutation),
					);
					outcome = {
						clientMutationId: mutation.clientMutationId,
						clientSequence: mutation.clientSequence,
						outcome: "applied",
						replayed: false,
						rootRevision: applied.rootRevision,
						...(applied.entity ? { entity: applied.entity } : {}),
					};
				} catch (error) {
					if (!(error instanceof DomainError)) throw error;
					if (syncDomainRetry(error)) {
						const retryAfterSeconds = Math.max(
							1,
							Number(error.headers["Retry-After"] ?? 1),
						);
						results.push({
							clientMutationId: mutation.clientMutationId,
							clientSequence: mutation.clientSequence,
							outcome: "retry",
							replayed: false,
							retryAfterSeconds,
							error: syncMutationError(error, true),
						});
						stopped = true;
						continue;
					}
					outcome = {
						clientMutationId: mutation.clientMutationId,
						clientSequence: mutation.clientSequence,
						outcome: "rejected",
						replayed: false,
						error: syncMutationError(error, false),
					};
				}

				await tx`
					INSERT INTO event_sync_mutation_receipts (
						actor_id, client_mutation_id, device_id, root_event_id,
						client_sequence, fingerprint, outcome, result
					) VALUES (
						${actor.id}, ${mutation.clientMutationId}::uuid, ${input.deviceId},
						${input.rootEventId}, ${mutation.clientSequence}, ${fingerprint},
						${outcome.outcome}, ${tx.json(outcome as never)}
					)
				`;
				nextExpectedClientSequence = mutation.clientSequence + 1;
				await tx`
					UPDATE event_sync_streams
					SET next_client_sequence = ${nextExpectedClientSequence},
						updated_at = clock_timestamp()
					WHERE actor_id = ${actor.id} AND device_id = ${input.deviceId}
						AND root_event_id = ${input.rootEventId}
				`;
				results.push(outcome);
				if (outcome.outcome === "rejected") stopped = true;
			}

			return {
				protocolVersion: 1,
				rootEventId: input.rootEventId,
				deviceId: input.deviceId,
				results,
				nextExpectedClientSequence,
			};
		});
	}

	async listSyncChanges(
		actor: Actor,
		rootEventId: string,
		after: { rootRevision: string; ordinal: number },
		authorizationScopeVersion: string,
		limit: number,
	): Promise<SyncChangePage> {
		return this.transaction(async (tx) => {
			const access = await syncRootAccess(tx, rootEventId, actor, "share");
			await cleanupExpiredSyncSnapshots(tx);
			if (
				access.authorizationScopeVersion !== authorizationScopeVersion ||
				BigInt(after.rootRevision) < BigInt(access.minimumSyncRevision) ||
				(BigInt(after.rootRevision) === BigInt(access.minimumSyncRevision) &&
					after.ordinal < access.minimumSyncOrdinal)
			)
				throw syncCursorExpired();
			let checkpoint = { ...after };
			const changes: SyncChange[] = [];
			const manager = isManager(access.role);
			let scanned = 0;

			while (true) {
				const rows = await tx<
					{
						rootRevision: string;
						ordinal: number;
						entityType: SyncEntityType;
						entityId: string;
						operation: "upsert" | "tombstone";
						entityVersion: number;
						data: Record<string, unknown> | null;
						tombstone: Record<string, unknown> | null;
						audience: "members" | "managers" | "actor";
						audienceUserId: string | null;
					}[]
				>`
					SELECT root_revision::text AS "rootRevision", ordinal,
						entity_type AS "entityType", entity_id AS "entityId", operation,
						entity_version AS "entityVersion", data, tombstone, audience,
						audience_user_id AS "audienceUserId"
					FROM event_root_changes
					WHERE root_event_id = ${rootEventId}
						AND (
							root_revision > ${checkpoint.rootRevision}::bigint OR
							(root_revision = ${checkpoint.rootRevision}::bigint
								AND ordinal > ${checkpoint.ordinal})
						)
					ORDER BY root_revision, ordinal
					LIMIT 500
				`;
				if (rows.length === 0)
					return { access, changes, checkpoint, hasMore: false };
				for (const row of rows) {
					const visible =
						row.audience === "members" ||
						(row.audience === "managers" && manager) ||
						(row.audience === "actor" && row.audienceUserId === actor.id);
					if (visible && changes.length === limit)
						return { access, changes, checkpoint, hasMore: true };
					checkpoint = {
						rootRevision: row.rootRevision,
						ordinal: row.ordinal,
					};
					scanned += 1;
					if (!visible) continue;
					if (row.operation === "upsert" && row.data) {
						changes.push({
							rootRevision: row.rootRevision,
							ordinal: row.ordinal,
							entityType: row.entityType,
							entityId: row.entityId,
							entityVersion: row.entityVersion,
							operation: "upsert",
							data: row.data,
						});
					} else if (row.operation === "tombstone" && row.tombstone) {
						changes.push({
							rootRevision: row.rootRevision,
							ordinal: row.ordinal,
							entityType: row.entityType,
							entityId: row.entityId,
							entityVersion: row.entityVersion,
							operation: "tombstone",
							tombstone: row.tombstone,
						});
					} else {
						throw new Error("Sync change shape invariant failed");
					}
				}
				if (rows.length < 500)
					return { access, changes, checkpoint, hasMore: false };
				if (scanned >= 2_000)
					return { access, changes, checkpoint, hasMore: true };
			}
		});
	}

	async readSyncBootstrap(
		actor: Actor,
		rootEventId: string,
		cursor: BootstrapCursor | null,
		limit: number,
	): Promise<SyncBootstrapPage> {
		return this.transaction(async (tx) => {
			if (!cursor) {
				await tx`
					SELECT pg_advisory_xact_lock(
						hashtextextended(${`crew:sync-snapshot:${actor.id}:${rootEventId}`}, 0)
					)
				`;
			}
			const access = await syncRootAccess(tx, rootEventId, actor, "share");
			await cleanupExpiredSyncSnapshots(tx);
			if (
				cursor &&
				cursor.authorizationScopeVersion !== access.authorizationScopeVersion
			)
				throw syncCursorExpired();

			let snapshot: {
				id: string;
				rootRevision: string;
				authorizationScopeVersion: string;
				expiresAt: Date;
				recordCount: number;
			} | null = null;
			if (cursor) {
				const [stored] = await tx<
					{
						id: string;
						rootRevision: string;
						authorizationScopeVersion: string;
						expiresAt: Date;
						recordCount: number;
					}[]
				>`
					SELECT id, root_revision::text AS "rootRevision",
						authorization_scope_version::text AS "authorizationScopeVersion",
						expires_at AS "expiresAt", record_count AS "recordCount"
					FROM event_sync_snapshots
					WHERE id = ${cursor.snapshotId} AND actor_id = ${actor.id}
						AND root_event_id = ${rootEventId} AND expires_at > clock_timestamp()
					FOR SHARE
				`;
				snapshot = stored ?? null;
				if (!snapshot) throw syncCursorExpired();
				if (snapshotCutBeforeMinimum(snapshot.rootRevision, access))
					throw syncCursorExpired();
			} else {
				await tx`
					DELETE FROM event_sync_snapshots
					WHERE actor_id = ${actor.id} AND root_event_id = ${rootEventId}
						AND (
							expires_at <= clock_timestamp() OR
							authorization_scope_version <> ${access.authorizationScopeVersion}::bigint OR
							root_revision < ${access.minimumSyncRevision}::bigint OR
							(root_revision = ${access.minimumSyncRevision}::bigint
								AND 2147483647 < ${access.minimumSyncOrdinal})
						)
				`;
				const [stored] = await tx<
					{
						id: string;
						rootRevision: string;
						authorizationScopeVersion: string;
						expiresAt: Date;
						recordCount: number;
					}[]
				>`
					SELECT id, root_revision::text AS "rootRevision",
						authorization_scope_version::text AS "authorizationScopeVersion",
						expires_at AS "expiresAt", record_count AS "recordCount"
					FROM event_sync_snapshots
					WHERE actor_id = ${actor.id} AND root_event_id = ${rootEventId}
						AND expires_at > clock_timestamp()
					FOR SHARE
				`;
				snapshot = stored ?? null;
				if (!snapshot) {
					const id = `snp_${randomBytes(16).toString("hex")}`;
					const [created] = await tx<{ expiresAt: Date }[]>`
						INSERT INTO event_sync_snapshots (
							id, actor_id, root_event_id, authorization_scope_version,
							root_revision, record_count, created_at, expires_at
						) VALUES (
							${id}, ${actor.id}, ${rootEventId},
							${access.authorizationScopeVersion}::bigint,
							${access.rootRevision}::bigint, 0, statement_timestamp(),
							statement_timestamp() + interval '15 minutes'
						)
						RETURNING expires_at AS "expiresAt"
					`;
					if (!created)
						throw new Error("Sync snapshot insert invariant failed");
					const recordCount = await materializeSyncSnapshot(
						tx,
						id,
						rootEventId,
						actor,
						access.role,
					);
					await tx`
						UPDATE event_sync_snapshots SET record_count = ${recordCount}
						WHERE id = ${id}
					`;
					snapshot = {
						id,
						rootRevision: access.rootRevision,
						authorizationScopeVersion: access.authorizationScopeVersion,
						expiresAt: created.expiresAt,
						recordCount,
					};
				}
			}
			if (
				snapshot.authorizationScopeVersion !== access.authorizationScopeVersion
			)
				throw syncCursorExpired();
			if (snapshotCutBeforeMinimum(snapshot.rootRevision, access))
				throw syncCursorExpired();
			const offset = cursor?.offset ?? 0;
			const rows = await tx<SyncSnapshotRecord[]>`
				SELECT entity_type AS "entityType", entity_id AS "entityId",
					entity_version AS "entityVersion", data
				FROM event_sync_snapshot_records
				WHERE snapshot_id = ${snapshot.id} AND ordinal >= ${offset}
				ORDER BY ordinal
				LIMIT ${limit + 1}
			`;
			const records = rows.slice(0, limit);
			const hasMore = rows.length > limit;
			return {
				access,
				snapshotId: snapshot.id,
				snapshotRevision: snapshot.rootRevision,
				expiresAt: snapshot.expiresAt,
				records,
				nextOffset: offset + records.length,
				hasMore,
			};
		});
	}

	async setGolfScore(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		entityId: string,
		baseVersion: number,
		input: GolfScoreInput,
	) {
		return this.transaction((tx) =>
			golfScoreSet(
				tx,
				actor,
				rootEventId,
				eventId,
				entityId,
				baseVersion,
				input,
			),
		);
	}

	async replaceGolfRound(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseVersion: number,
		input: GolfRoundSetupInput,
	) {
		return this.transaction((tx) =>
			golfRoundReplace(tx, actor, rootEventId, eventId, baseVersion, input),
		);
	}

	async publishTeamAssignments(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseVersion: number,
		input: TeamAssignmentSetInput,
	) {
		return this.transaction((tx) =>
			teamAssignmentsPublish(
				tx,
				actor,
				rootEventId,
				eventId,
				baseVersion,
				input,
				(revision, ordinal, payload) =>
					appendSystemFeedEntry(
						tx,
						this.notificationPayloads,
						actor,
						rootEventId,
						eventId,
						revision,
						ordinal,
						payload,
						"visible",
					),
			),
		);
	}

	async replaceTeamDecision(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		decisionId: string,
		baseVersion: number,
		input: TeamDecisionInput,
	) {
		return this.transaction((tx) =>
			teamDecisionReplace(
				tx,
				actor,
				rootEventId,
				eventId,
				decisionId,
				baseVersion,
				input,
				(revision, ordinal, payload) =>
					appendSystemFeedEntry(
						tx,
						this.notificationPayloads,
						actor,
						rootEventId,
						eventId,
						revision,
						ordinal,
						payload,
						"visible",
					),
			),
		);
	}

	async setTeamResponse(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		decisionId: string,
		entityId: string,
		baseVersion: number,
		optionId: string,
	) {
		return this.transaction((tx) =>
			teamResponseSet(
				tx,
				actor,
				rootEventId,
				eventId,
				decisionId,
				entityId,
				baseVersion,
				optionId,
			),
		);
	}

	private transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
		if (this.inTransaction) return work(this.sql);
		return this.sql.begin(async (transaction) =>
			work(transaction as unknown as Tx),
		) as Promise<T>;
	}

	private snapshot<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
		if (this.inTransaction) return work(this.sql);
		return this.sql.begin("isolation level repeatable read", (transaction) =>
			work(transaction as unknown as Tx),
		) as Promise<T>;
	}

	async ready() {
		try {
			await this.sql`SELECT 1`;
			return true;
		} catch {
			return false;
		}
	}

	async placeEnrichmentWorkerHealthy() {
		try {
			return await new PostgresPlaceEnrichmentJobs(this.sql).workerHealthy();
		} catch {
			return false;
		}
	}

	async createRoot(actor: Actor, input: EventInput): Promise<EventRecord> {
		validateTimeZone(input.timeZone);
		validateTimeRange(input.startsAt, input.endsAt);
		assertRootCreationStatus(input);
		return this.transaction(async (tx) => {
			await tx`SELECT pg_advisory_xact_lock(hashtextextended(${input.id}, 0))`;
			const existing = await findEventById(tx, input.id);
			if (existing) {
				const [owner] = await tx<{ userId: string }[]>`
          SELECT user_id AS "userId" FROM event_memberships
          WHERE root_event_id = ${input.id} AND role = 'owner' AND status = 'active'
        `;
				if (
					owner?.userId === actor.id &&
					sameEventInput(existing, input, null)
				) {
					return existing;
				}
				throw conflict("ID_COLLISION", "The event ID is already in use.");
			}

			await tx`
        INSERT INTO event_roots (root_event_id, revision)
        VALUES (${input.id}, 1)
      `;
			const [event] = await tx<EventRecord[]>`
        INSERT INTO events (
          id, root_event_id, parent_event_id, kind, title, description,
          time_zone, starts_at, ends_at, status
        ) VALUES (
          ${input.id}, ${input.id}, NULL, ${input.kind}, ${input.title},
          ${input.description}, ${input.timeZone}, ${input.startsAt},
          ${input.endsAt}, ${input.status}
        )
        RETURNING ${eventColumns(tx)}
      `;
			if (!event) throw new Error("Event insert invariant failed");
			const [ownerMembership] = await tx<MembershipRecord[]>`
        INSERT INTO event_memberships (root_event_id, user_id, role, status)
        VALUES (${input.id}, ${actor.id}, 'owner', 'active')
				RETURNING ${membershipColumns(tx)}
      `;
			if (!ownerMembership)
				throw new Error("Owner membership insert invariant failed");
			await appendChange(
				tx,
				input.id,
				"1",
				0,
				"event",
				event.id,
				"upsert",
				event.version,
				eventSync(event),
			);
			await appendChange(
				tx,
				input.id,
				"1",
				1,
				"membership",
				actor.id,
				"upsert",
				ownerMembership.version,
				membershipSync(ownerMembership),
			);
			return event;
		});
	}

	async createRootFromTemplate(
		actor: Actor,
		input: EventInput,
		template: EventTemplateInstantiation,
	): Promise<EventRecord> {
		validateTimeZone(input.timeZone);
		validateTimeRange(input.startsAt, input.endsAt);
		assertRootCreationStatus(input);
		return this.transaction(async (tx) => {
			const eventIds = Object.values(template.eventIds).sort();
			for (const eventId of eventIds) {
				await tx`SELECT pg_advisory_xact_lock(hashtextextended(${eventId}, 0))`;
			}
			for (const eventId of eventIds) {
				if (await findEventById(tx, eventId))
					throw conflict("ID_COLLISION", "An event ID is already in use.");
			}

			await tx`
				INSERT INTO event_roots (
					root_event_id, revision, template_id, template_version
				)
				VALUES (
					${input.id}, 1, ${template.definition.id}, ${template.definition.version}
				)
			`;
			const events: EventRecord[] = [];
			for (const [index, blueprint] of template.definition.events.entries()) {
				const id = template.eventIds[blueprint.logicalKey];
				if (!id) throw new Error("Template event ID invariant failed");
				let parentEventId: string | null = null;
				if (blueprint.parentLogicalKey) {
					parentEventId = template.eventIds[blueprint.parentLogicalKey] ?? null;
					if (!parentEventId)
						throw new Error("Template parent event ID invariant failed");
				}
				const rootBlueprint = blueprint.logicalKey === "root";
				const [event] = await tx<EventRecord[]>`
					INSERT INTO events (
						id, root_event_id, parent_event_id, kind, title, description,
						time_zone, starts_at, ends_at, sort_position, status
					) VALUES (
						${id}, ${input.id}, ${parentEventId}, ${blueprint.kind},
						${rootBlueprint ? input.title : blueprint.title},
						${rootBlueprint ? input.description : null}, ${input.timeZone},
						${rootBlueprint ? input.startsAt : null},
						${rootBlueprint ? input.endsAt : null}, ${(index + 1) * 1024},
						${input.status}
					)
					RETURNING ${eventColumns(tx)}
				`;
				if (!event) throw new Error("Template event insert invariant failed");
				events.push(event);
			}
			const [ownerMembership] = await tx<MembershipRecord[]>`
				INSERT INTO event_memberships (root_event_id, user_id, role, status)
				VALUES (${input.id}, ${actor.id}, 'owner', 'active')
				RETURNING ${membershipColumns(tx)}
			`;
			if (!ownerMembership)
				throw new Error("Template owner membership insert invariant failed");

			const capabilities: CapabilityRecord[] = [];
			for (const blueprint of template.definition.events) {
				const eventId = template.eventIds[blueprint.logicalKey];
				if (!eventId)
					throw new Error("Template capability event invariant failed");
				for (const inputCapability of blueprint.capabilities) {
					const [capability] = await tx<CapabilityRecord[]>`
						INSERT INTO event_capabilities (
							root_event_id, event_id, capability_type, schema_version, config
						) VALUES (
							${input.id}, ${eventId}, ${inputCapability.type},
							${inputCapability.schemaVersion},
							${tx.json(inputCapability.config as never)}
						)
						RETURNING ${capabilityColumns(tx)}
					`;
					if (!capability)
						throw new Error("Template capability insert invariant failed");
					capabilities.push(capability);
				}
			}

			let ordinal = 0;
			for (const event of events) {
				await appendChange(
					tx,
					input.id,
					"1",
					ordinal++,
					"event",
					event.id,
					"upsert",
					event.version,
					eventSync(event),
				);
			}
			await appendChange(
				tx,
				input.id,
				"1",
				ordinal++,
				"membership",
				actor.id,
				"upsert",
				ownerMembership.version,
				membershipSync(ownerMembership),
			);
			for (const capability of capabilities) {
				await appendChange(
					tx,
					input.id,
					"1",
					ordinal++,
					"capability",
					capabilityEntityId(capability.eventId, capability.type),
					"upsert",
					capability.version,
					capabilitySync(capability),
				);
			}
			const root = events[0];
			if (!root || root.id !== input.id)
				throw new Error("Template root event invariant failed");
			return root;
		});
	}

	async adoptRootTemplate(
		actor: Actor,
		rootEventId: string,
		baseVersion: number,
		baseRevision: string,
		request: EventTemplateRequest,
	) {
		return this.transaction(async (tx) => {
			const root = await lockManagerRoot(tx, rootEventId, actor, "update");
			const current = await requireLiveEvent(tx, rootEventId, rootEventId);
			if (current.status !== "draft")
				throw conflict(
					"EVENT_TEMPLATE_ADOPTION_STATE_INVALID",
					"Only a live draft root can adopt a template.",
				);
			if (root.templateId || root.templateVersion !== null)
				throw conflict(
					"EVENT_TEMPLATE_ALREADY_SET",
					"The event root already has a template.",
				);
			if (current.version !== baseVersion)
				throw versionConflict(current.version);
			if (root.revision !== baseRevision)
				throw rootRevisionConflict(root.revision);
			const template = resolveEventTemplate(request, current, true);
			const eventIds = Object.values(template.eventIds).sort();
			for (const eventId of eventIds) {
				await tx`SELECT pg_advisory_xact_lock(hashtextextended(${eventId}, 0))`;
			}

			const rootBlueprint = template.definition.events.find(
				(blueprint) => blueprint.logicalKey === "root",
			);
			if (!rootBlueprint)
				throw new Error("Template root blueprint invariant failed");
			const children = template.definition.events.filter(
				(blueprint) => blueprint.logicalKey !== "root",
			);
			if (children.some((blueprint) => blueprint.parentLogicalKey !== "root"))
				throw new Error("Template adoption requires a root-flat blueprint");
			const missingChildren = [];
			for (const blueprint of children) {
				const eventId = template.eventIds[blueprint.logicalKey];
				if (!eventId) throw new Error("Template event ID invariant failed");
				const existing = await findEventById(tx, eventId);
				if (!existing) {
					missingChildren.push(blueprint);
					continue;
				}
				if (existing.rootEventId !== rootEventId)
					throw conflict("ID_COLLISION", "An event ID is already in use.");
				if (
					existing.deletedAt ||
					existing.parentEventId !== rootEventId ||
					existing.kind !== blueprint.kind ||
					existing.status !== "draft"
				)
					throw conflict(
						"EVENT_TEMPLATE_CONTENT_COLLISION",
						"Existing event content conflicts with the template.",
					);
			}
			const [capacity] = await tx<{ count: number }[]>`
				SELECT count(*)::int AS count FROM events
				WHERE root_event_id = ${rootEventId} AND deleted_at IS NULL
			`;
			if ((capacity?.count ?? 0) + missingChildren.length > ROOT_EVENT_LIMIT)
				throw collectionLimitReached();
			const missingCapabilities: {
				eventId: string;
				input: CapabilityInput;
			}[] = [];
			for (const blueprint of template.definition.events) {
				const eventId = template.eventIds[blueprint.logicalKey];
				if (!eventId)
					throw new Error("Template capability event invariant failed");
				for (const input of blueprint.capabilities) {
					const existing = await findCapability(
						tx,
						rootEventId,
						eventId,
						input.type,
					);
					if (!existing) {
						missingCapabilities.push({ eventId, input });
						continue;
					}
					if (
						existing.deletedAt ||
						existing.schemaVersion !== input.schemaVersion
					)
						throw conflict(
							"EVENT_TEMPLATE_CONTENT_COLLISION",
							"Existing event content conflicts with the template.",
						);
				}
			}

			const [currentPosition] = await tx<{ value: string }[]>`
				SELECT COALESCE(max(sort_position), 0)::text AS value FROM events
				WHERE root_event_id = ${rootEventId}
					AND parent_event_id = ${rootEventId} AND deleted_at IS NULL
			`;
			const firstPosition = BigInt(currentPosition?.value ?? "0") + 1024n;
			const placements = missingChildren.map((blueprint, index) => {
				const id = template.eventIds[blueprint.logicalKey];
				if (!id) throw new Error("Template event ID invariant failed");
				return {
					blueprint,
					id,
					parentEventId: rootEventId,
					sortPosition: (firstPosition + BigInt(index) * 1024n).toString(),
				};
			});

			const metadata = await tx`
				UPDATE event_roots SET template_id = ${template.definition.id},
					template_version = ${template.definition.version}
				WHERE root_event_id = ${rootEventId} AND template_id IS NULL
					AND template_version IS NULL
				RETURNING root_event_id
			`;
			if (metadata.length !== 1)
				throw new Error("Template metadata update invariant failed");
			const [updatedRoot] = await tx<EventRecord[]>`
				UPDATE events SET kind = ${rootBlueprint.kind},
					child_order_version = child_order_version + ${placements.length > 0 ? 1 : 0},
					version = version + 1, updated_at = now()
				WHERE root_event_id = ${rootEventId} AND id = ${rootEventId}
					AND version = ${baseVersion} AND status = 'draft'
					AND deleted_at IS NULL
				RETURNING ${eventColumns(tx)}
			`;
			if (!updatedRoot)
				throw new Error("Template root update invariant failed");

			const createdEvents: EventRecord[] = [];
			for (const placement of placements) {
				const [event] = await tx<EventRecord[]>`
					INSERT INTO events (
						id, root_event_id, parent_event_id, kind, title, description,
						time_zone, starts_at, ends_at, sort_position, status
					) VALUES (
						${placement.id}, ${rootEventId}, ${placement.parentEventId},
						${placement.blueprint.kind}, ${placement.blueprint.title}, NULL,
						${current.timeZone}, NULL, NULL, ${placement.sortPosition}, 'draft'
					)
					RETURNING ${eventColumns(tx)}
				`;
				if (!event) throw new Error("Template event insert invariant failed");
				createdEvents.push(event);
			}

			const capabilities: CapabilityRecord[] = [];
			for (const { eventId, input } of missingCapabilities) {
				const [capability] = await tx<CapabilityRecord[]>`
					INSERT INTO event_capabilities (
						root_event_id, event_id, capability_type, schema_version, config
					) VALUES (
						${rootEventId}, ${eventId}, ${input.type}, ${input.schemaVersion},
						${tx.json(input.config as never)}
					)
					RETURNING ${capabilityColumns(tx)}
				`;
				if (!capability)
					throw new Error("Template capability insert invariant failed");
				capabilities.push(capability);
			}

			const revision = await nextRevision(tx, rootEventId);
			let ordinal = 0;
			for (const event of [updatedRoot, ...createdEvents]) {
				await appendChange(
					tx,
					rootEventId,
					revision,
					ordinal++,
					"event",
					event.id,
					"upsert",
					event.version,
					eventSync(event),
				);
			}
			for (const capability of capabilities) {
				await appendChange(
					tx,
					rootEventId,
					revision,
					ordinal++,
					"capability",
					capabilityEntityId(capability.eventId, capability.type),
					"upsert",
					capability.version,
					capabilitySync(capability),
				);
			}
			return {
				event: updatedRoot,
				rootRevision: revision,
				template: {
					id: template.definition.id,
					version: template.definition.version,
				},
			};
		});
	}

	async listRoots(
		actor: Actor,
		query: {
			includeArchived: boolean;
			limit: number;
			after: { rootEventId: string } | null;
		},
	) {
		const rows = await this.sql<EventRootSummary[]>`
			SELECT event.root_event_id AS "rootEventId", event.kind, event.title,
				event.time_zone AS "timeZone", event.starts_at AS "startsAt",
				event.ends_at AS "endsAt", event.status, event.version,
				event.created_at AS "createdAt", event.updated_at AS "updatedAt",
				membership.role, membership.status AS "membershipStatus"
			FROM event_memberships membership
			JOIN event_roots root
				ON root.root_event_id = membership.root_event_id
			JOIN events event
				ON event.root_event_id = root.root_event_id
				AND event.id = root.root_event_id
				AND event.parent_event_id IS NULL
			WHERE membership.user_id = ${actor.id}
				AND membership.status = 'active'
				AND event.deleted_at IS NULL
				${
					query.includeArchived
						? this.sql``
						: this
								.sql`AND root.status = 'active' AND event.status <> 'archived'`
				}
				${
					query.after
						? this
								.sql`AND membership.root_event_id > ${query.after.rootEventId}`
						: this.sql``
				}
			ORDER BY membership.root_event_id
			LIMIT ${query.limit + 1}
		`;
		return pageSlice(rows, query.limit);
	}

	async getRoot(actor: Actor, rootEventId: string): Promise<RootView> {
		return this.transaction(async (tx) => {
			const root = await lockReadableRoot(tx, rootEventId, actor, "share");
			const membership = await requireMembership(tx, rootEventId, actor);
			const manager = isManager(membership.role);
			if (!manager && root.status !== "active") throw notFound();
			const events = manager
				? await tx<EventRecord[]>`
					SELECT ${eventColumns(tx)} FROM events
					WHERE root_event_id = ${rootEventId} AND deleted_at IS NULL
					ORDER BY sort_position, id
					LIMIT ${ROOT_GRAPH_LIMIT + 1}
				`
				: await visiblePublishedEvents(tx, rootEventId, ROOT_GRAPH_LIMIT + 1);
			if (!manager && events.length === 0) throw notFound();
			if (events.length > ROOT_GRAPH_LIMIT) {
				throw conflict(
					"ROOT_GRAPH_LIMIT_EXCEEDED",
					"The aggregate is too large for the bounded tree bootstrap.",
				);
			}
			const capabilities = manager
				? await tx<CapabilityRecord[]>`
					SELECT ${capabilityColumns(tx)} FROM event_capabilities capability
					WHERE capability.root_event_id = ${rootEventId}
						AND capability.deleted_at IS NULL
						AND EXISTS (
							SELECT 1 FROM events event
							WHERE event.root_event_id = capability.root_event_id
								AND event.id = capability.event_id AND event.deleted_at IS NULL
						)
					ORDER BY capability.event_id, capability.capability_type
				`
				: await tx<CapabilityRecord[]>`
					SELECT ${capabilityColumns(tx)} FROM event_capabilities capability
					WHERE root_event_id = ${rootEventId} AND deleted_at IS NULL
						AND event_sync_capability_is_member_visible(
							capability.root_event_id, capability.event_id
						)
					ORDER BY event_id, capability_type
				`;
			return {
				rootEventId,
				rootRevision: String(root.revision),
				events,
				capabilities,
			};
		});
	}

	async getPublishReadiness(actor: Actor, rootEventId: string) {
		return this.transaction(async (tx) => {
			await lockManagerRoot(tx, rootEventId, actor, "share");
			return readPublishReadiness(tx, rootEventId);
		});
	}

	async publishRoot(
		actor: Actor,
		rootEventId: string,
		baseVersion: number,
		baseRevision: string,
	) {
		return this.transaction(async (tx) => {
			const root = await lockManagerRoot(tx, rootEventId, actor, "update");
			const current = await requireLiveEvent(tx, rootEventId, rootEventId);
			if (current.version !== baseVersion)
				throw versionConflict(current.version);
			if (root.revision !== baseRevision)
				throw rootRevisionConflict(root.revision);
			if (current.status !== "draft") {
				throw conflict(
					"EVENT_PUBLISH_STATE_INVALID",
					"Only a draft root event can be published.",
				);
			}
			const readiness = await readPublishReadiness(tx, rootEventId);
			if (!readiness.ready) {
				throw new DomainError(
					409,
					"EVENT_PUBLISH_NOT_READY",
					"The event root does not meet the publish requirements.",
					{},
					readiness.reasons,
				);
			}
			const [published] = await tx<EventRecord[]>`
				UPDATE events SET status = 'published', version = version + 1,
					updated_at = now()
				WHERE root_event_id = ${rootEventId} AND id = ${rootEventId}
					AND version = ${baseVersion} AND status = 'draft'
				RETURNING ${eventColumns(tx)}
			`;
			if (!published) throw versionConflict(current.version);
			await assertSessionReferencesValid(tx, rootEventId);
			const revision = await nextRevision(tx, rootEventId);
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"event",
				published.id,
				"upsert",
				published.version,
				eventSync(published),
			);
			await appendSystemFeedEntry(
				tx,
				this.notificationPayloads,
				actor,
				rootEventId,
				null,
				revision,
				1,
				{
					schemaVersion: 1,
					type: "event.published",
					actorUserId: actor.id,
					eventId: published.id,
					entityVersion: published.version,
				},
				"visible",
			);
			return published;
		});
	}

	async generateRecap(
		actor: Actor,
		rootEventId: string,
		baseRevision: string,
		sources: RecapSourceInput[],
	): Promise<EventRecap> {
		assertRecapSourcesBounded(sources);
		return this.transaction(async (tx) => {
			const root = await lockManagerRoot(tx, rootEventId, actor, "update");
			if (root.revision !== baseRevision)
				throw rootRevisionConflict(root.revision);
			const title = await readRecapEventSource(tx, rootEventId, rootEventId);
			if (!title) throw recapRootUnavailable();
			const projected: RecapSourceProjection[] = [];
			const issues: RecapSourceIssue[] = [];
			for (const [ordinal, source] of sources.entries()) {
				const result = await materializeRecapSource(
					tx,
					actor,
					rootEventId,
					ordinal,
					source,
				);
				if ("issue" in result) issues.push(result.issue);
				else projected.push(result.item);
			}
			if (issues.length) throw recapSourcesInvalid("generation", issues);

			const head = await findRecapHead(tx, rootEventId, true);
			const version = (head?.latestVersion ?? 0) + 1;
			const [snapshot] = await tx<RecapSnapshotRow[]>`
				INSERT INTO event_recap_snapshots (
					root_event_id, version, source_root_revision, title,
					title_source_version, title_source_revision, generated_by
				) VALUES (
					${rootEventId}, ${version}, ${root.revision}, ${title.sourceTitle},
					${title.sourceVersion}, ${title.sourceRevision}, ${actor.id}
				)
				RETURNING ${recapSnapshotColumns(tx)}
			`;
			if (!snapshot) throw new Error("Recap snapshot insert invariant failed");
			for (const item of projected) {
				await tx`
					INSERT INTO event_recap_items (
						root_event_id, recap_version, ordinal, source_type, source_id,
						source_version, source_revision, source_visibility, consent_basis,
						consented_by_user_id, consent_membership_version, source_title,
						source_body
					) VALUES (
						${rootEventId}, ${version}, ${item.ordinal}, ${item.sourceType},
						${item.sourceId}, ${item.sourceVersion}, ${item.sourceRevision},
						${item.sourceVisibility}, ${item.consentBasis},
						${item.consentedByUserId}, ${item.consentMembershipVersion},
						${item.sourceTitle}, ${item.sourceBody}
					)
				`;
			}
			const [storedHead] = head
				? await tx<RecapHeadRow[]>`
						UPDATE event_recap_heads SET latest_version = ${version},
							lifecycle_version = lifecycle_version + 1, updated_at = now()
						WHERE root_event_id = ${rootEventId}
						RETURNING ${recapHeadColumns(tx)}
					`
				: await tx<RecapHeadRow[]>`
						INSERT INTO event_recap_heads (root_event_id, latest_version)
						VALUES (${rootEventId}, ${version})
						RETURNING ${recapHeadColumns(tx)}
					`;
			if (!storedHead) throw new Error("Recap head insert invariant failed");
			await tx`
				INSERT INTO event_recap_audit_events (
					root_event_id, lifecycle_version, action, recap_version, actor_id
				) VALUES (
					${rootEventId}, ${storedHead.lifecycleVersion}, 'generate', ${version},
					${actor.id}
				)
			`;
			return projectRecap(tx, rootEventId, snapshot, storedHead);
		});
	}

	async getRecap(
		actor: Actor,
		rootEventId: string,
		version?: number,
	): Promise<EventRecapRead> {
		return this.transaction(async (tx) => {
			const root = await lockRoot(tx, rootEventId, "share");
			const membership = await requireMembership(tx, rootEventId, actor);
			const manager = isManager(membership.role);
			if (!manager && root.status !== "active") throw notFound();
			const head = await findRecapHead(tx, rootEventId, false);
			if (!head) throw notFound();
			const selectedVersion =
				version ?? (manager ? head.latestVersion : head.publishedVersion);
			if (
				selectedVersion === null ||
				selectedVersion <= head.removedThroughVersion ||
				(!manager && selectedVersion !== head.publishedVersion)
			)
				throw notFound();
			const snapshot = await findRecapSnapshot(
				tx,
				rootEventId,
				selectedVersion,
			);
			if (!snapshot) throw notFound();
			const validation = await validateRecapSnapshot(tx, rootEventId, snapshot);
			if (!validation.titleValid) throw notFound();
			return {
				recap: recapFromValidation(snapshot, head, validation),
				externalConsent:
					root.status === "active" &&
					selectedVersion === head.publishedVersion &&
					head.publishedAt !== null &&
					validation.issues.length === 0
						? await readRecapExternalConsent(
								tx,
								actor,
								membership,
								rootEventId,
								selectedVersion,
								snapshot,
								validation.items,
								this.recapCaptions,
							)
						: null,
			};
		});
	}

	async publishRecap(
		actor: Actor,
		rootEventId: string,
		recapVersion: number,
		baseLifecycleVersion: number,
	) {
		return this.transaction(async (tx) => {
			await lockManagerRoot(tx, rootEventId, actor, "update");
			const head = await findRecapHead(tx, rootEventId, true);
			if (!head) throw notFound();
			if (head.lifecycleVersion !== baseLifecycleVersion)
				throw recapVersionConflict(head.lifecycleVersion);
			if (
				recapVersion !== head.latestVersion ||
				recapVersion <= head.removedThroughVersion
			)
				throw recapSnapshotStale(head.latestVersion);
			const snapshot = await findRecapSnapshot(tx, rootEventId, recapVersion);
			if (!snapshot) throw notFound();
			const validation = await validateRecapSnapshot(tx, rootEventId, snapshot);
			if (!validation.titleValid || validation.issues.length) {
				throw recapSourcesInvalid("publication", [
					...(!validation.titleValid
						? [
								{
									code: "RECAP_SOURCE_VERSION_CHANGED" as const,
									message: "The recap title source changed after generation.",
									path: "title",
								},
							]
						: []),
					...validation.issues,
				]);
			}
			const [publishedHead] = await tx<RecapHeadRow[]>`
				UPDATE event_recap_heads SET published_version = ${recapVersion},
					lifecycle_version = lifecycle_version + 1, published_at = now(),
					published_by = ${actor.id}, updated_at = now()
				WHERE root_event_id = ${rootEventId}
				RETURNING ${recapHeadColumns(tx)}
			`;
			if (!publishedHead) throw new Error("Recap publication invariant failed");
			await tx`
				INSERT INTO event_recap_audit_events (
					root_event_id, lifecycle_version, action, recap_version, actor_id
				) VALUES (
					${rootEventId}, ${publishedHead.lifecycleVersion}, 'publish',
					${recapVersion}, ${actor.id}
				)
			`;
			return recapFromValidation(snapshot, publishedHead, validation);
		});
	}

	async removeRecap(
		actor: Actor,
		rootEventId: string,
		baseLifecycleVersion: number,
	): Promise<EventRecapRemoval> {
		return this.transaction(async (tx) => {
			await lockManagerRoot(tx, rootEventId, actor, "update");
			const head = await findRecapHead(tx, rootEventId, true);
			if (!head) throw notFound();
			if (head.lifecycleVersion !== baseLifecycleVersion)
				throw recapVersionConflict(head.lifecycleVersion);
			if (
				head.publishedVersion === null &&
				head.removedThroughVersion >= head.latestVersion
			)
				return { removed: true, lifecycleVersion: head.lifecycleVersion };
			const [removedHead] = await tx<RecapHeadRow[]>`
				UPDATE event_recap_heads SET published_version = NULL,
					published_at = NULL, published_by = NULL,
					removed_through_version = latest_version,
					lifecycle_version = lifecycle_version + 1,
					removed_at = now(), removed_by = ${actor.id}, updated_at = now()
				WHERE root_event_id = ${rootEventId}
				RETURNING ${recapHeadColumns(tx)}
			`;
			if (!removedHead) throw new Error("Recap removal invariant failed");
			await tx`
				INSERT INTO event_recap_audit_events (
					root_event_id, lifecycle_version, action, recap_version, actor_id
				) VALUES (
					${rootEventId}, ${removedHead.lifecycleVersion}, 'remove',
					${head.latestVersion}, ${actor.id}
				)
			`;
			return {
				removed: true,
				lifecycleVersion: removedHead.lifecycleVersion,
			};
		});
	}

	async createRecapShareLink(
		actor: Actor,
		rootEventId: string,
		input: {
			id: string;
			recapVersion: number;
			tokenHash: string;
			tokenKeyId: string;
			projectionConsent: "title-only-reviewed";
		},
	): Promise<EventRecapShareLink> {
		return this.transaction(async (tx) => {
			await lockManagerRoot(tx, rootEventId, actor, "update");
			const head = await findRecapHead(tx, rootEventId, true);
			if (
				!head ||
				head.publishedVersion === null ||
				head.publishedVersion <= head.removedThroughVersion
			)
				throw notFound();
			if (head.publishedVersion !== input.recapVersion)
				throw recapShareVersionConflict(head.publishedVersion);
			const snapshot = await findRecapSnapshot(
				tx,
				rootEventId,
				input.recapVersion,
			);
			if (!snapshot) throw notFound();
			const validation = await validateRecapSnapshot(tx, rootEventId, snapshot);
			if (
				!validation.titleValid ||
				validation.issues.length ||
				head.publishedAt === null
			)
				throw notFound();
			const [policy] = await tx<{ now: Date }[]>`
				SELECT clock_timestamp() AS now
			`;
			if (!policy) throw new Error("Recap share policy clock invariant failed");
			await rotateActiveRecapShareLinks(tx, rootEventId, actor, policy.now);
			const expiresAt = new Date(
				policy.now.getTime() + 7 * 24 * 60 * 60 * 1_000,
			);
			const [link] = await tx<RecapShareLinkRow[]>`
				INSERT INTO event_recap_share_links (
					id, root_event_id, recap_version, token_hash, token_key_id,
					projection_consent, created_by, created_at, expires_at
				) VALUES (
					${input.id}, ${rootEventId}, ${input.recapVersion},
					${input.tokenHash}, ${input.tokenKeyId}, ${input.projectionConsent},
					${actor.id}, ${policy.now}, ${expiresAt}
				)
				RETURNING ${recapShareLinkColumns(tx)},
					expires_at > clock_timestamp() AS unexpired
			`;
			if (!link) throw new Error("Recap share link insert invariant failed");
			return recapShareLink(link);
		});
	}

	async revokeRecapShareLink(
		actor: Actor,
		rootEventId: string,
		shareLinkId: string,
	): Promise<EventRecapShareRevocation> {
		return this.transaction(async (tx) => {
			await lockWritableRoot(tx, rootEventId, actor, "manager", true);
			const link = await findRecapShareLinkById(
				tx,
				rootEventId,
				shareLinkId,
				true,
			);
			if (!link) throw notFound();
			if (link.revokedAt === null) {
				const [revoked] = await tx<{ id: string }[]>`
					UPDATE event_recap_share_links
					SET revoked_at = clock_timestamp(), revoked_by = ${actor.id}
					WHERE root_event_id = ${rootEventId} AND id = ${shareLinkId}
						AND revoked_at IS NULL
					RETURNING id
				`;
				if (revoked && link.projectionConsent === "exact-fields-reviewed-v1")
					await insertRecapExternalShareAudit(
						tx,
						rootEventId,
						shareLinkId,
						"revoke",
						actor,
					);
			}
			return { revoked: true };
		});
	}

	async resolveRecapShareLink(tokenHash: string): Promise<EventRecapShare> {
		return this.transaction(async (tx) => {
			const [candidate] = await tx<{ rootEventId: string }[]>`
				SELECT root_event_id AS "rootEventId"
				FROM event_recap_share_links WHERE token_hash = ${tokenHash}
			`;
			if (!candidate) throw notFound();
			const root = await lockRoot(tx, candidate.rootEventId, "share");
			if (root.status !== "active") throw notFound();
			const link = await findRecapShareLinkByTokenHash(tx, tokenHash);
			if (!link || link.rootEventId !== candidate.rootEventId) throw notFound();
			const { snapshot, validation } = await validateRecapShareLinkPolicy(
				tx,
				link,
			);
			return recapShare(snapshot, validation);
		});
	}

	async decideRecapExternalGrant(
		actor: Actor,
		rootEventId: string,
		recapVersion: number,
		input: RecapExternalGrantDecisionInput,
	): Promise<EventRecapExternalGrantDecision> {
		return this.transaction(async (tx) => {
			const root = await lockRoot(tx, rootEventId, "update");
			if (root.status !== "active")
				throw conflict("ROOT_ARCHIVED", "The event root is archived.");
			const context = await requireCurrentPublishedRecap(
				tx,
				rootEventId,
				recapVersion,
			);
			const target = await requireRecapExternalField(
				tx,
				context.validation.items,
				context.snapshot,
				input,
				this.recapCaptions,
			);
			const membership = await requireRecapExternalGrantAuthority(
				tx,
				actor,
				rootEventId,
				target,
				input.authority,
			);
			await tx`
				INSERT INTO event_recap_external_grant_decisions (
					root_event_id, recap_version, recap_ordinal, source_type,
					source_id, source_version, field_name, authority, decision,
					actor_id, actor_membership_version
				) VALUES (
					${rootEventId}, ${recapVersion}, ${target.item.ordinal}, ${target.item.sourceType},
					${target.item.sourceId}, ${target.item.sourceVersion}, ${target.storageFieldName},
					${input.authority}, ${input.decision}, ${actor.id},
					${membership.version}
				)
			`;
			return { decision: input.decision };
		});
	}

	async createRecapExternalShareLink(
		actor: Actor,
		rootEventId: string,
		input: {
			id: string;
			recapVersion: number;
			tokenHash: string;
			tokenKeyId: string;
			projectionConsent: "exact-fields-reviewed-v1";
			fields: RecapExternalField[];
		},
	): Promise<EventRecapShareLink> {
		return this.transaction(async (tx) => {
			const creator = await lockWritableRoot(tx, rootEventId, actor, "manager");
			const context = await requireCurrentPublishedRecap(
				tx,
				rootEventId,
				input.recapVersion,
			);
			if (input.fields.length < 1 || input.fields.length > RECAP_SOURCE_LIMIT)
				throw new DomainError(
					400,
					"VALIDATION_FAILED",
					"The request is invalid.",
				);
			const keys = new Set<string>();
			const selected: RecapExternalFieldTarget[] = [];
			for (const field of input.fields) {
				const key = recapExternalFieldKey(field);
				if (keys.has(key))
					throw new DomainError(
						400,
						"VALIDATION_FAILED",
						"The request is invalid.",
					);
				keys.add(key);
				const target = await requireRecapExternalField(
					tx,
					context.validation.items,
					context.snapshot,
					field,
					this.recapCaptions,
				);
				await validateRecapExternalFieldGrants(
					tx,
					rootEventId,
					input.recapVersion,
					target,
				);
				selected.push(target);
			}
			const [policy] = await tx<{ now: Date }[]>`
				SELECT clock_timestamp() AS now
			`;
			if (!policy) throw new Error("Recap share policy clock invariant failed");
			await rotateActiveRecapShareLinks(tx, rootEventId, actor, policy.now);
			const expiresAt = new Date(
				policy.now.getTime() + 7 * 24 * 60 * 60 * 1_000,
			);
			const [link] = await tx<RecapShareLinkRow[]>`
				INSERT INTO event_recap_share_links (
					id, root_event_id, recap_version, token_hash, token_key_id,
					projection_consent, created_by, created_by_membership_version,
					created_at, expires_at
				) VALUES (
					${input.id}, ${rootEventId}, ${input.recapVersion},
					${input.tokenHash}, ${input.tokenKeyId}, ${input.projectionConsent},
					${actor.id}, ${creator.version}, ${policy.now}, ${expiresAt}
				)
				RETURNING ${recapShareLinkColumns(tx)},
					expires_at > clock_timestamp() AS unexpired
			`;
			if (!link) throw new Error("Recap share link insert invariant failed");
			for (const target of selected) {
				await tx`
					INSERT INTO event_recap_external_share_fields (
						link_id, root_event_id, recap_version, recap_ordinal,
						source_type, source_id, source_version, field_name
					) VALUES (
						${input.id}, ${rootEventId}, ${input.recapVersion}, ${target.item.ordinal},
						${target.item.sourceType}, ${target.item.sourceId}, ${target.item.sourceVersion},
						${target.storageFieldName}
					)
				`;
			}
			await insertRecapExternalShareAudit(
				tx,
				rootEventId,
				input.id,
				"create",
				actor,
				policy.now,
			);
			return recapShareLink(link);
		});
	}

	async resolveRecapExternalShareLink(
		tokenHash: string,
	): Promise<EventRecapExternalShare> {
		return this.transaction(async (tx) => {
			const [candidate] = await tx<{ rootEventId: string }[]>`
				SELECT root_event_id AS "rootEventId"
				FROM event_recap_share_links WHERE token_hash = ${tokenHash}
			`;
			if (!candidate) throw notFound();
			const root = await lockRoot(tx, candidate.rootEventId, "share");
			if (root.status !== "active") throw notFound();
			const link = await findRecapShareLinkByTokenHash(tx, tokenHash);
			if (!link || link.rootEventId !== candidate.rootEventId) throw notFound();
			const context = await validateRecapExternalShareLinkPolicy(
				tx,
				link,
				this.recapCaptions?.enabled === true,
			);
			return recapExternalShare(
				context.snapshot,
				context.validation,
				context.targets,
			);
		});
	}

	async getEvent(actor: Actor, rootEventId: string, eventId: string) {
		return this.transaction(async (tx) => {
			const root = await lockReadableRoot(tx, rootEventId, actor, "share");
			const membership = await requireMembership(tx, rootEventId, actor);
			const manager = isManager(membership.role);
			if (!manager && root.status !== "active") throw notFound();
			const event = manager
				? await findEvent(tx, rootEventId, eventId)
				: ((await visiblePublishedEvents(tx, rootEventId)).find(
						(item) => item.id === eventId,
					) ?? null);
			if (!event || event.deletedAt) {
				throw notFound();
			}
			return event;
		});
	}

	async createEvent(
		actor: Actor,
		rootEventId: string,
		parentEventId: string,
		input: EventInput,
	) {
		validateTimeZone(input.timeZone);
		validateTimeRange(input.startsAt, input.endsAt);
		return this.transaction(async (tx) => {
			await lockWritableRoot(tx, rootEventId, actor, "manager");
			const parent = await requireLiveEvent(tx, rootEventId, parentEventId);
			await tx`SELECT pg_advisory_xact_lock(hashtextextended(${input.id}, 0))`;
			const existing = await findEventById(tx, input.id);
			if (existing) {
				if (
					existing.rootEventId === rootEventId &&
					sameEventInput(existing, input, parentEventId)
				)
					return existing;
				throw conflict("ID_COLLISION", "The event ID is already in use.");
			}
			await assertRootEventCapacity(tx, rootEventId);
			const [position] = await tx<{ value: string }[]>`
        SELECT COALESCE(max(sort_position), 0) + 1024 AS value
        FROM events
        WHERE root_event_id = ${rootEventId} AND parent_event_id = ${parentEventId} AND deleted_at IS NULL
      `;
			const [event] = await tx<EventRecord[]>`
        INSERT INTO events (
          id, root_event_id, parent_event_id, kind, title, description,
          time_zone, starts_at, ends_at, sort_position, status
        ) VALUES (
          ${input.id}, ${rootEventId}, ${parentEventId}, ${input.kind},
          ${input.title}, ${input.description}, ${input.timeZone}, ${input.startsAt},
          ${input.endsAt}, ${position?.value ?? "1024"}, ${input.status}
        ) RETURNING ${eventColumns(tx)}
			`;
			if (!event) throw new Error("Event insert invariant failed");
			await assertSessionReferencesValid(tx, rootEventId);
			const changedParent = await bumpChildOrder(tx, rootEventId, parent.id);
			const revision = await nextRevision(tx, rootEventId);
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"event",
				event.id,
				"upsert",
				event.version,
				eventSync(event),
			);
			await appendChange(
				tx,
				rootEventId,
				revision,
				1,
				"event",
				changedParent.id,
				"upsert",
				changedParent.version,
				eventSync(changedParent),
			);
			if (event.status === "published") {
				await appendSystemFeedEntry(
					tx,
					this.notificationPayloads,
					actor,
					rootEventId,
					event.id,
					revision,
					2,
					{
						schemaVersion: 1,
						type: "event.published",
						actorUserId: actor.id,
						eventId: event.id,
						entityVersion: event.version,
					},
					"visible",
				);
			}
			return event;
		});
	}

	async updateEvent(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseVersion: number,
		patch: EventPatch,
	) {
		return this.transaction(async (tx) => {
			const membership = await lockWritableRoot(
				tx,
				rootEventId,
				actor,
				"manager",
			);
			if (eventId === rootEventId && patch.status === "published") {
				throw conflict(
					"PUBLISH_COMMAND_REQUIRED",
					"Use the root publish command.",
				);
			}
			if (eventId === rootEventId && patch.status !== undefined) {
				if (patch.status === "archived") {
					throw conflict(
						"ARCHIVE_COMMAND_REQUIRED",
						"Use the root archive command.",
					);
				}
				if (membership.role !== "owner") throw forbidden();
			}
			const current = await findEvent(tx, rootEventId, eventId);
			if (!current) throw notFound();
			if (current.deletedAt) throw entityDeleted();
			const merged = mergeEvent(current, patch);
			if (current.version !== baseVersion) {
				if (sameEditableEvent(current, merged)) return current;
				throw versionConflict(current.version);
			}
			validateTimeRange(merged.startsAt, merged.endsAt);
			validateTimeZone(merged.timeZone);
			const [updated] = await tx<EventRecord[]>`
        UPDATE events SET
          title = ${merged.title}, description = ${merged.description},
          time_zone = ${merged.timeZone}, starts_at = ${merged.startsAt},
          ends_at = ${merged.endsAt}, status = ${merged.status},
          version = version + 1, updated_at = now()
        WHERE root_event_id = ${rootEventId} AND id = ${eventId} AND version = ${baseVersion}
        RETURNING ${eventColumns(tx)}
			`;
			if (!updated) throw versionConflict(current.version);
			await assertSessionReferencesValid(tx, rootEventId);
			const revision = await nextRevision(tx, rootEventId);
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"event",
				updated.id,
				"upsert",
				updated.version,
				eventSync(updated),
			);
			if (current.status !== "published" && updated.status === "published") {
				await appendSystemFeedEntry(
					tx,
					this.notificationPayloads,
					actor,
					rootEventId,
					updated.id === rootEventId ? null : updated.id,
					revision,
					1,
					{
						schemaVersion: 1,
						type: "event.published",
						actorUserId: actor.id,
						eventId: updated.id,
						entityVersion: updated.version,
					},
					"visible",
				);
			}
			return updated;
		});
	}

	async reparentEvent(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		parentEventId: string,
		baseVersion: number,
	) {
		return this.transaction(async (tx) => {
			await lockWritableRoot(tx, rootEventId, actor, "manager");
			if (eventId === rootEventId)
				throw conflict(
					"ROOT_REPARENT_FORBIDDEN",
					"A root event cannot be reparented.",
				);
			const current = await findEvent(tx, rootEventId, eventId);
			if (!current) throw notFound();
			if (current.deletedAt) throw entityDeleted();
			await requireLiveEvent(tx, rootEventId, parentEventId);
			if (current.version !== baseVersion) {
				if (current.parentEventId === parentEventId) return current;
				throw versionConflict(current.version);
			}
			if (current.parentEventId === parentEventId) return current;
			const [cycle] = await tx<{ found: boolean }[]>`
        WITH RECURSIVE descendants AS (
          SELECT id FROM events WHERE root_event_id = ${rootEventId} AND parent_event_id = ${eventId} AND deleted_at IS NULL
          UNION ALL
          SELECT event.id FROM events event JOIN descendants ON event.parent_event_id = descendants.id
          WHERE event.root_event_id = ${rootEventId} AND event.deleted_at IS NULL
        ) SELECT EXISTS(SELECT 1 FROM descendants WHERE id = ${parentEventId}) AS found
      `;
			if (parentEventId === eventId || cycle?.found)
				throw conflict(
					"HIERARCHY_CYCLE",
					"The event cannot be moved below itself.",
				);
			const [position] = await tx<{ value: string }[]>`
        SELECT COALESCE(max(sort_position), 0) + 1024 AS value FROM events
        WHERE root_event_id = ${rootEventId} AND parent_event_id = ${parentEventId} AND deleted_at IS NULL
      `;
			const [updated] = await tx<EventRecord[]>`
        UPDATE events SET parent_event_id = ${parentEventId}, sort_position = ${position?.value ?? "1024"},
          version = version + 1, updated_at = now()
        WHERE root_event_id = ${rootEventId} AND id = ${eventId} AND version = ${baseVersion}
        RETURNING ${eventColumns(tx)}
			`;
			if (!updated) throw versionConflict(current.version);
			await assertSessionReferencesValid(tx, rootEventId);
			const oldParent = current.parentEventId
				? await bumpChildOrder(tx, rootEventId, current.parentEventId)
				: null;
			const newParent = await bumpChildOrder(tx, rootEventId, parentEventId);
			const revision = await nextRevision(tx, rootEventId);
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"event",
				updated.id,
				"upsert",
				updated.version,
				eventSync(updated),
			);
			if (oldParent)
				await appendChange(
					tx,
					rootEventId,
					revision,
					1,
					"event",
					oldParent.id,
					"upsert",
					oldParent.version,
					eventSync(oldParent),
				);
			await appendChange(
				tx,
				rootEventId,
				revision,
				oldParent ? 2 : 1,
				"event",
				newParent.id,
				"upsert",
				newParent.version,
				eventSync(newParent),
			);
			return updated;
		});
	}

	async reorderEvents(
		actor: Actor,
		rootEventId: string,
		parentEventId: string,
		baseOrderVersion: number,
		orderedIds: string[],
	) {
		return this.transaction(async (tx) => {
			await lockWritableRoot(tx, rootEventId, actor, "manager");
			const parent = await requireLiveEvent(tx, rootEventId, parentEventId);
			const current = await childEvents(tx, rootEventId, parentEventId);
			const currentIds = current.map((event) => event.id);
			if (parent.childOrderVersion !== baseOrderVersion) {
				if (sameStrings(currentIds, orderedIds))
					return { parent, events: current };
				throw versionConflict(parent.childOrderVersion, {
					orderedIds: currentIds,
				});
			}
			assertSameSet(currentIds, orderedIds);
			if (sameStrings(currentIds, orderedIds))
				return { parent, events: current };
			for (const [index, id] of orderedIds.entries()) {
				await tx`UPDATE events SET sort_position = ${(index + 1) * 1024}, version = version + 1, updated_at = now()
          WHERE root_event_id = ${rootEventId} AND id = ${id} AND parent_event_id = ${parentEventId}`;
			}
			const [updatedParent] = await tx<EventRecord[]>`
				UPDATE events SET child_order_version = child_order_version + 1,
					version = version + 1, updated_at = now()
        WHERE root_event_id = ${rootEventId} AND id = ${parentEventId}
        RETURNING ${eventColumns(tx)}
      `;
			if (!updatedParent) throw new Error("Parent update invariant failed");
			const events = await childEvents(tx, rootEventId, parentEventId);
			const revision = await nextRevision(tx, rootEventId);
			let ordinal = 0;
			for (const event of events) {
				await appendChange(
					tx,
					rootEventId,
					revision,
					ordinal++,
					"event",
					event.id,
					"upsert",
					event.version,
					eventSync(event),
				);
			}
			await appendChange(
				tx,
				rootEventId,
				revision,
				ordinal,
				"event",
				updatedParent.id,
				"upsert",
				updatedParent.version,
				eventSync(updatedParent),
			);
			return { parent: updatedParent, events };
		});
	}

	async archiveEvent(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseVersion: number,
	) {
		return this.transaction(async (tx) => {
			const level = eventId === rootEventId ? "owner" : "manager";
			await lockWritableRoot(
				tx,
				rootEventId,
				actor,
				level,
				eventId === rootEventId,
			);
			const current = await findEvent(tx, rootEventId, eventId);
			if (!current) throw notFound();
			if (current.deletedAt) throw entityDeleted();
			if (current.version !== baseVersion) {
				if (
					current.status === "archived" &&
					current.version === baseVersion + 1
				)
					return current;
				throw versionConflict(current.version);
			}
			const [updated] = await tx<EventRecord[]>`
        UPDATE events SET status = 'archived', version = version + 1, updated_at = now()
        WHERE root_event_id = ${rootEventId} AND id = ${eventId} AND version = ${baseVersion}
        RETURNING ${eventColumns(tx)}
      `;
			if (!updated) throw versionConflict(current.version);
			if (eventId === rootEventId) {
				await tx`UPDATE event_roots SET status = 'archived' WHERE root_event_id = ${rootEventId}`;
			}
			await assertSessionReferencesValid(tx, rootEventId);
			const revision = await nextRevision(tx, rootEventId);
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"event",
				updated.id,
				"upsert",
				updated.version,
				eventSync(updated),
			);
			return updated;
		});
	}

	async tombstoneEvent(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseVersion: number,
		subtree: boolean,
	) {
		return this.transaction(async (tx) => {
			await lockWritableRoot(tx, rootEventId, actor, "manager");
			if (eventId === rootEventId)
				throw conflict(
					"ROOT_DELETE_FORBIDDEN",
					"A root event cannot be tombstoned.",
				);
			const current = await findEvent(tx, rootEventId, eventId);
			if (!current) throw notFound();
			if (current.deletedAt) {
				if (current.version === baseVersion + 1) return;
				throw versionConflict(current.version);
			}
			if (current.version !== baseVersion)
				throw versionConflict(current.version);
			const descendants = await tx<{ id: string }[]>`
        WITH RECURSIVE subtree AS (
          SELECT id FROM events WHERE root_event_id = ${rootEventId} AND id = ${eventId} AND deleted_at IS NULL
          UNION ALL
          SELECT event.id FROM events event JOIN subtree ON event.parent_event_id = subtree.id
          WHERE event.root_event_id = ${rootEventId} AND event.deleted_at IS NULL
        ) SELECT id FROM subtree ORDER BY id
      `;
			if (!subtree && descendants.length > 1) {
				throw conflict(
					"LIVE_DESCENDANTS",
					"The event still has live descendants.",
				);
			}
			const eventIds = descendants.map((item) => item.id);
			const itinerary = await tx<ItineraryRecord[]>`
        SELECT ${itineraryColumns(tx)} FROM event_itinerary_items
        WHERE root_event_id = ${rootEventId} AND event_id IN ${tx(eventIds)} AND deleted_at IS NULL
        ORDER BY id
      `;
			const capabilities = await tx<CapabilityRecord[]>`
				SELECT ${capabilityColumns(tx)} FROM event_capabilities
				WHERE root_event_id = ${rootEventId} AND event_id IN ${tx(eventIds)}
					AND deleted_at IS NULL
				ORDER BY event_id, capability_type
			`;
			if (!subtree && itinerary.length > 0) {
				throw conflict(
					"LIVE_DEPENDENCIES",
					"The event still has live itinerary items.",
				);
			}
			const now = new Date();
			const changedCapabilities: CapabilityRecord[] = [];
			for (const capability of capabilities) {
				const [changed] = await tx<CapabilityRecord[]>`
					UPDATE event_capabilities SET deleted_at = ${now},
						version = version + 1, updated_at = ${now}
					WHERE root_event_id = ${rootEventId}
						AND event_id = ${capability.eventId}
						AND capability_type = ${capability.type}
					RETURNING ${capabilityColumns(tx)}
				`;
				if (changed) changedCapabilities.push(changed);
			}
			const changedEvents: EventRecord[] = [];
			for (const id of eventIds) {
				const [changed] = await tx<EventRecord[]>`
          UPDATE events SET status = 'archived', deleted_at = ${now}, version = version + 1, updated_at = ${now}
          WHERE root_event_id = ${rootEventId} AND id = ${id}
          RETURNING ${eventColumns(tx)}
        `;
				if (changed) changedEvents.push(changed);
			}
			const changedItems: ItineraryRecord[] = [];
			for (const item of itinerary) {
				const [changed] = await tx<ItineraryRecord[]>`
          UPDATE event_itinerary_items SET status = 'archived', deleted_at = ${now}, version = version + 1, updated_at = ${now}
          WHERE root_event_id = ${rootEventId} AND id = ${item.id}
          RETURNING ${itineraryColumns(tx)}
        `;
				if (changed) changedItems.push(changed);
			}
			await assertSessionReferencesValid(tx, rootEventId);
			const changedParent = current.parentEventId
				? await bumpChildOrder(tx, rootEventId, current.parentEventId)
				: null;
			const revision = await nextRevision(tx, rootEventId);
			let ordinal = 0;
			for (const event of changedEvents) {
				await appendChange(
					tx,
					rootEventId,
					revision,
					ordinal++,
					"event",
					event.id,
					"tombstone",
					event.version,
					tombstone(
						"event",
						event.id,
						rootEventId,
						event.id,
						event.version,
						now,
					),
				);
			}
			for (const item of changedItems) {
				await appendChange(
					tx,
					rootEventId,
					revision,
					ordinal++,
					"itineraryItem",
					item.id,
					"tombstone",
					item.version,
					tombstone(
						"itineraryItem",
						item.id,
						rootEventId,
						item.eventId,
						item.version,
						now,
					),
				);
			}
			for (const capability of changedCapabilities) {
				await appendChange(
					tx,
					rootEventId,
					revision,
					ordinal++,
					"capability",
					capabilityEntityId(capability.eventId, capability.type),
					"tombstone",
					capability.version,
					capabilityTombstone(capability),
				);
			}
			if (changedParent) {
				await appendChange(
					tx,
					rootEventId,
					revision,
					ordinal,
					"event",
					changedParent.id,
					"upsert",
					changedParent.version,
					eventSync(changedParent),
				);
			}
		});
	}

	async listMemberships(
		actor: Actor,
		rootEventId: string,
		page: { limit: number; after: { userId: string } | null },
	) {
		return this.transaction(async (tx) => {
			await lockReadableRoot(tx, rootEventId, actor, "share");
			const membership = await requireMembership(tx, rootEventId, actor);
			const rows = await tx<MembershipRecord[]>`
        SELECT ${membershipColumns(tx)} FROM event_memberships
        WHERE root_event_id = ${rootEventId}
          ${isManager(membership.role) ? tx`` : tx`AND status = 'active'`}
				${page.after ? tx`AND user_id > ${page.after.userId}` : tx``}
				ORDER BY user_id
				LIMIT ${page.limit + 1}
      `;
			return pageSlice(rows, page.limit);
		});
	}

	async listActiveMembershipUserIds(
		actor: Actor,
		rootEventId: string,
		page: { limit: number; after: { userId: string } | null },
	) {
		return this.transaction(async (tx) => {
			await lockReadableRoot(tx, rootEventId, actor, "share");
			await requireMembership(tx, rootEventId, actor);
			const rows = await tx<{ userId: string }[]>`
        SELECT user_id AS "userId" FROM event_memberships
        WHERE root_event_id = ${rootEventId}
          AND status = 'active'
				${page.after ? tx`AND user_id > ${page.after.userId}` : tx``}
				ORDER BY user_id
				LIMIT ${page.limit + 1}
      `;
			return pageSlice(rows, page.limit);
		});
	}

	async updateMembership(
		actor: Actor,
		rootEventId: string,
		userId: string,
		baseVersion: number,
		role: Role,
		status: MembershipStatus,
		reason: string | null,
	) {
		return this.transaction(async (tx) => {
			const actorMembership = await lockWritableRoot(
				tx,
				rootEventId,
				actor,
				"manager",
			);
			const target = await findMembership(tx, rootEventId, userId, true);
			if (!target) throw notFound();
			if (target.role === "owner" || role === "owner") {
				throw conflict(
					"OWNER_TRANSFER_REQUIRED",
					"Use the ownership-transfer command.",
				);
			}
			if (
				actorMembership.role !== "owner" &&
				(target.role === "organizer" || role === "organizer")
			) {
				throw forbidden();
			}
			if (target.version !== baseVersion) {
				if (target.role === role && target.status === status) return target;
				throw versionConflict(target.version);
			}
			const [updated] = await tx<MembershipRecord[]>`
        UPDATE event_memberships SET role = ${role}, status = ${status},
          version = version + 1, updated_at = now(),
          removed_by = ${status === "removed" ? actor.id : null},
          removal_reason = ${status === "removed" ? reason : null}
        WHERE root_event_id = ${rootEventId} AND user_id = ${userId} AND version = ${baseVersion}
        RETURNING ${membershipColumns(tx)}
      `;
			if (!updated) throw versionConflict(target.version);
			const revision = await nextRevision(tx, rootEventId);
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"membership",
				userId,
				"upsert",
				updated.version,
				membershipSync(updated),
			);
			if (updated.role === "viewer" || updated.status !== "active") {
				await appendGolfPlayerRemovalChanges(
					tx,
					rootEventId,
					updated.userId,
					revision,
					1,
					updated.updatedAt,
				);
			}
			return updated;
		});
	}

	async transferOwnership(
		actor: Actor,
		rootEventId: string,
		userId: string,
		ownerBaseVersion: number,
		targetBaseVersion: number,
	) {
		return this.transaction(async (tx) => {
			const owner = await lockWritableRoot(tx, rootEventId, actor, "owner");
			const target = await findMembership(tx, rootEventId, userId, true);
			if (target?.status !== "active") throw notFound();
			if (target.userId === owner.userId) return [owner];
			if (
				owner.version !== ownerBaseVersion ||
				target.version !== targetBaseVersion
			) {
				throw versionConflict(Math.max(owner.version, target.version));
			}
			const [formerOwner] = await tx<MembershipRecord[]>`
        UPDATE event_memberships SET role = 'organizer', version = version + 1, updated_at = now()
        WHERE root_event_id = ${rootEventId} AND user_id = ${owner.userId} AND version = ${ownerBaseVersion}
        RETURNING ${membershipColumns(tx)}
      `;
			const [newOwner] = await tx<MembershipRecord[]>`
        UPDATE event_memberships SET role = 'owner', version = version + 1, updated_at = now()
        WHERE root_event_id = ${rootEventId} AND user_id = ${userId} AND version = ${targetBaseVersion}
        RETURNING ${membershipColumns(tx)}
      `;
			if (!formerOwner || !newOwner)
				throw versionConflict(Math.max(owner.version, target.version));
			const revision = await nextRevision(tx, rootEventId);
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"membership",
				formerOwner.userId,
				"upsert",
				formerOwner.version,
				membershipSync(formerOwner),
			);
			await appendChange(
				tx,
				rootEventId,
				revision,
				1,
				"membership",
				newOwner.userId,
				"upsert",
				newOwner.version,
				membershipSync(newOwner),
			);
			await appendSystemFeedEntry(
				tx,
				this.notificationPayloads,
				actor,
				rootEventId,
				null,
				revision,
				2,
				{
					schemaVersion: 1,
					type: "ownership.transferred",
					actorUserId: actor.id,
					fromUserId: formerOwner.userId,
					toUserId: newOwner.userId,
					entityVersion: newOwner.version,
				},
				"visible",
			);
			return [formerOwner, newOwner];
		});
	}

	async listInvitations(
		actor: Actor,
		rootEventId: string,
		page: { limit: number; after: { id: string } | null },
	) {
		return this.transaction(async (tx) => {
			await lockReadableRoot(tx, rootEventId, actor, "share");
			const membership = await requireMembership(tx, rootEventId, actor);
			if (!isManager(membership.role)) throw notFound();
			const rows = await tx<InvitationAdminSummary[]>`
				SELECT id, root_event_id AS "rootEventId", role,
					(normalized_email_hint IS NOT NULL) AS "emailBound",
					expires_at AS "expiresAt", max_uses AS "maxUses",
					use_count AS "useCount", status, version,
					created_at AS "createdAt", updated_at AS "updatedAt"
				FROM event_invitations
				WHERE root_event_id = ${rootEventId}
					${page.after ? tx`AND id > ${page.after.id}` : tx``}
				ORDER BY id
				LIMIT ${page.limit + 1}
			`;
			return pageSlice(rows, page.limit);
		});
	}

	async createInvitation(
		actor: Actor,
		rootEventId: string,
		input: {
			id: string;
			tokenHash: string;
			tokenKeyId: string;
			role: Exclude<Role, "owner">;
			normalizedEmailHint: string | null;
			expiresAt: Date;
			maxUses: number;
		},
	) {
		return this.transaction(async (tx) => {
			const membership = await lockWritableRoot(
				tx,
				rootEventId,
				actor,
				"manager",
			);
			if (input.role === "organizer" && membership.role !== "owner")
				throw forbidden();
			const existing = await findInvitationById(tx, input.id);
			if (existing) {
				if (
					existing.rootEventId === rootEventId &&
					existing.role === input.role &&
					existing.normalizedEmailHint === input.normalizedEmailHint &&
					existing.expiresAt.getTime() === input.expiresAt.getTime() &&
					existing.maxUses === input.maxUses
				)
					return existing;
				throw conflict("ID_COLLISION", "The invitation ID is already in use.");
			}
			const [invitation] = await tx<InvitationRecord[]>`
        INSERT INTO event_invitations (
          id, root_event_id, token_hash, token_key_id, role, normalized_email_hint,
          created_by, expires_at, max_uses
        ) VALUES (
          ${input.id}, ${rootEventId}, ${input.tokenHash}, ${input.tokenKeyId}, ${input.role},
          ${input.normalizedEmailHint}, ${actor.id}, ${input.expiresAt},
          ${input.maxUses}
        ) RETURNING ${invitationColumns(tx)}
      `;
			if (!invitation) throw new Error("Invitation insert invariant failed");
			const revision = await nextRevision(tx, rootEventId);
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"invitation",
				invitation.id,
				"upsert",
				invitation.version,
				invitationSync(invitation),
			);
			return invitation;
		});
	}

	async invitationTokenKeyId(
		actor: Actor,
		rootEventId: string,
		invitationId: string,
	) {
		return this.transaction(async (tx) => {
			await lockReadableRoot(tx, rootEventId, actor, "share");
			const membership = await requireMembership(tx, rootEventId, actor);
			if (!isManager(membership.role)) throw notFound();
			const [invitation] = await tx<{ tokenKeyId: string }[]>`
				SELECT token_key_id AS "tokenKeyId"
				FROM event_invitations
				WHERE root_event_id = ${rootEventId} AND id = ${invitationId}
			`;
			return invitation?.tokenKeyId ?? null;
		});
	}

	async previewInvitation(
		tokenHash: string,
		now: Date,
	): Promise<InvitePreview | null> {
		const [preview] = await this.sql<InvitePreview[]>`
      SELECT invitation.root_event_id AS "rootEventId", root.title,
        root.starts_at AS "startsAt", root.ends_at AS "endsAt", invitation.role,
		(invitation.normalized_email_hint IS NOT NULL) AS "emailBound",
        (invitation.status = 'active' AND invitation.expires_at > ${now}
          AND invitation.use_count < invitation.max_uses) AS usable
      FROM event_invitations invitation
			JOIN events root ON root.id = invitation.root_event_id
				AND root.root_event_id = invitation.root_event_id
			JOIN event_roots aggregate ON aggregate.root_event_id = invitation.root_event_id
			WHERE invitation.token_hash = ${tokenHash}
				AND aggregate.status = 'active' AND root.deleted_at IS NULL
    `;
		return preview ?? null;
	}

	async redeemInvitation(actor: Actor, tokenHash: string, now: Date) {
		return this.transaction(async (tx) => {
			const [candidate] = await tx<{ rootEventId: string }[]>`
				SELECT root_event_id AS "rootEventId"
				FROM event_invitations WHERE token_hash = ${tokenHash}
			`;
			if (!candidate) {
				throw new DomainError(
					404,
					"INVITATION_INVALID",
					"The invitation is invalid or unavailable.",
				);
			}
			const root = await lockRoot(tx, candidate.rootEventId, "update");
			if (root.status !== "active") {
				throw new DomainError(
					409,
					"INVITATION_UNAVAILABLE",
					"The invitation is no longer available.",
				);
			}
			const [invitation] = await tx<
				(InvitationRecord & { tokenHash: string })[]
			>`
        SELECT ${invitationColumns(tx)}, token_hash AS "tokenHash"
				FROM event_invitations
				WHERE token_hash = ${tokenHash} AND root_event_id = ${candidate.rootEventId}
				FOR UPDATE
      `;
			if (!invitation)
				throw new DomainError(
					404,
					"INVITATION_INVALID",
					"The invitation is invalid or unavailable.",
				);
			const [redemption] = await tx<{ membershipVersion: number }[]>`
        SELECT membership_version AS "membershipVersion"
        FROM event_invitation_redemptions
        WHERE invitation_id = ${invitation.id} AND user_id = ${actor.id}
      `;
			if (redemption) {
				const membership = await findMembership(
					tx,
					invitation.rootEventId,
					actor.id,
					false,
				);
				if (!membership)
					throw new Error("Invitation redemption invariant failed");
				return membership;
			}
			if (
				invitation.normalizedEmailHint !== null &&
				actor.email !== invitation.normalizedEmailHint
			) {
				throw new DomainError(
					403,
					"INVITATION_EMAIL_MISMATCH",
					"This invitation is bound to a different verified email address.",
				);
			}
			if (
				invitation.status !== "active" ||
				invitation.expiresAt <= now ||
				invitation.useCount >= invitation.maxUses
			) {
				throw new DomainError(
					409,
					"INVITATION_UNAVAILABLE",
					"The invitation is no longer available.",
				);
			}
			let membership = await findMembership(
				tx,
				invitation.rootEventId,
				actor.id,
				true,
			);
			let membershipChanged = false;
			let membershipActivated = false;
			if (!membership) {
				const [created] = await tx<MembershipRecord[]>`
          INSERT INTO event_memberships (root_event_id, user_id, role, status)
          VALUES (${invitation.rootEventId}, ${actor.id}, ${invitation.role}, 'active')
          RETURNING ${membershipColumns(tx)}
        `;
				if (!created) throw new Error("Membership insert invariant failed");
				membership = created;
				membershipChanged = true;
				membershipActivated = true;
			} else if (membership.status !== "active") {
				const [reactivated] = await tx<MembershipRecord[]>`
          UPDATE event_memberships SET role = ${invitation.role}, status = 'active',
            version = version + 1, updated_at = ${now}, removed_by = NULL, removal_reason = NULL
          WHERE root_event_id = ${invitation.rootEventId} AND user_id = ${actor.id}
          RETURNING ${membershipColumns(tx)}
        `;
				if (!reactivated) throw new Error("Membership update invariant failed");
				membership = reactivated;
				membershipChanged = true;
				membershipActivated = true;
			} else if (roleRank(invitation.role) > roleRank(membership.role)) {
				const [upgraded] = await tx<MembershipRecord[]>`
					UPDATE event_memberships SET role = ${invitation.role},
						version = version + 1, updated_at = ${now}
					WHERE root_event_id = ${invitation.rootEventId} AND user_id = ${actor.id}
					RETURNING ${membershipColumns(tx)}
				`;
				if (!upgraded) throw new Error("Membership upgrade invariant failed");
				membership = upgraded;
				membershipChanged = true;
			}
			const [updatedInvitation] = await tx<InvitationRecord[]>`
				UPDATE event_invitations SET use_count = use_count + 1,
					version = version + 1, updated_at = ${now}
				WHERE id = ${invitation.id}
				RETURNING ${invitationColumns(tx)}
			`;
			if (!updatedInvitation)
				throw new Error("Invitation update invariant failed");
			await tx`
        INSERT INTO event_invitation_redemptions (invitation_id, user_id, membership_version, redeemed_at)
        VALUES (${invitation.id}, ${actor.id}, ${membership.version}, ${now})
      `;
			const revision = await nextRevision(tx, invitation.rootEventId);
			await appendChange(
				tx,
				invitation.rootEventId,
				revision,
				0,
				"invitation",
				invitation.id,
				"upsert",
				updatedInvitation.version,
				invitationSync(updatedInvitation),
			);
			if (membershipChanged) {
				await appendChange(
					tx,
					invitation.rootEventId,
					revision,
					1,
					"membership",
					actor.id,
					"upsert",
					membership.version,
					membershipSync(membership),
				);
			}
			if (membershipActivated) {
				await appendSystemFeedEntry(
					tx,
					this.notificationPayloads,
					actor,
					invitation.rootEventId,
					null,
					revision,
					2,
					{
						schemaVersion: 1,
						type: "membership.activated",
						actorUserId: actor.id,
						userId: actor.id,
						role: invitation.role,
						entityVersion: membership.version,
					},
					"managers",
				);
			}
			return membership;
		});
	}

	async revokeInvitation(
		actor: Actor,
		rootEventId: string,
		invitationId: string,
		baseVersion: number,
	) {
		return this.transaction(async (tx) => {
			await lockWritableRoot(tx, rootEventId, actor, "manager");
			const invitation = await findInvitation(tx, rootEventId, invitationId);
			if (!invitation) throw notFound();
			if (invitation.version !== baseVersion) {
				if (invitation.status === "revoked") return invitation;
				throw versionConflict(invitation.version);
			}
			const [updated] = await tx<InvitationRecord[]>`
        UPDATE event_invitations SET status = 'revoked', version = version + 1, updated_at = now()
        WHERE root_event_id = ${rootEventId} AND id = ${invitationId} AND version = ${baseVersion}
        RETURNING ${invitationColumns(tx)}
      `;
			if (!updated) throw versionConflict(invitation.version);
			const revision = await nextRevision(tx, rootEventId);
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"invitation",
				invitationId,
				"tombstone",
				updated.version,
				tombstone(
					"invitation",
					invitationId,
					rootEventId,
					rootEventId,
					updated.version,
					updated.updatedAt,
				),
			);
			return updated;
		});
	}

	async createPlace(actor: Actor, rootEventId: string, input: PlaceInput) {
		validatePlace(input);
		return this.transaction(async (tx) => {
			await lockWritableRoot(tx, rootEventId, actor, "manager");
			const existing = await findPlaceById(tx, input.id);
			if (existing) {
				if (
					existing.rootEventId === rootEventId &&
					samePlaceInput(existing, input)
				)
					return existing;
				throw conflict("ID_COLLISION", "The place ID is already in use.");
			}
			const [place] = await tx<PlaceRecord[]>`
        INSERT INTO event_places (
          id, root_event_id, name, locality, country_code, latitude, longitude
        ) VALUES (
          ${input.id}, ${rootEventId}, ${input.name}, ${input.locality},
          ${input.countryCode}, ${input.latitude}, ${input.longitude}
        ) RETURNING ${placeColumns(tx)}
      `;
			if (!place) throw new Error("Place insert invariant failed");
			const revision = await nextRevision(tx, rootEventId);
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"place",
				place.id,
				"upsert",
				place.version,
				placeSync(place),
			);
			return place;
		});
	}

	async listPlaces(
		actor: Actor,
		rootEventId: string,
		page: { limit: number; after: { name: string; id: string } | null },
	) {
		return this.transaction(async (tx) => {
			const root = await lockReadableRoot(tx, rootEventId, actor, "share");
			const membership = await requireMembership(tx, rootEventId, actor);
			if (!isManager(membership.role) && root.status !== "active")
				throw notFound();
			const rows = await tx<PlaceRecord[]>`
				SELECT ${placeColumns(tx)} FROM event_places
				WHERE root_event_id = ${rootEventId} AND deleted_at IS NULL
				${
					isManager(membership.role)
						? tx``
						: tx`AND event_sync_place_is_member_visible(${rootEventId}, id)`
				}
				${
					page.after
						? tx`AND (name > ${page.after.name} OR (name = ${page.after.name} AND id > ${page.after.id}))`
						: tx``
				}
				ORDER BY name, id
				LIMIT ${page.limit + 1}
			`;
			return pageSlice(rows, page.limit);
		});
	}

	async updatePlace(
		actor: Actor,
		rootEventId: string,
		placeId: string,
		baseVersion: number,
		patch: PlacePatch,
	) {
		return this.transaction(async (tx) => {
			await lockWritableRoot(tx, rootEventId, actor, "manager");
			const current = await findPlace(tx, rootEventId, placeId);
			if (!current || current.deletedAt) throw notFound();
			const merged = mergePlace(current, patch);
			validatePlace(merged);
			if (current.version !== baseVersion) {
				if (samePlaceInput(current, { id: current.id, ...merged }))
					return current;
				throw versionConflict(current.version);
			}
			const [updated] = await tx<PlaceRecord[]>`
        UPDATE event_places SET name = ${merged.name}, locality = ${merged.locality},
          country_code = ${merged.countryCode}, latitude = ${merged.latitude}, longitude = ${merged.longitude},
          version = version + 1, updated_at = now()
        WHERE root_event_id = ${rootEventId} AND id = ${placeId} AND version = ${baseVersion}
        RETURNING ${placeColumns(tx)}
      `;
			if (!updated) throw versionConflict(current.version);
			const revision = await nextRevision(tx, rootEventId);
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"place",
				placeId,
				"upsert",
				updated.version,
				placeSync(updated),
			);
			return updated;
		});
	}

	async replaceCapability(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseVersion: number,
		input: CapabilityInput,
	) {
		return this.transaction(async (tx) => {
			await lockWritableRoot(tx, rootEventId, actor, "manager");
			await requireLiveEvent(tx, rootEventId, eventId);
			const placeId = capabilityPlaceId(input);
			if (placeId) await requirePlaceSnapshot(tx, rootEventId, placeId);
			const current = await findCapability(
				tx,
				rootEventId,
				eventId,
				input.type,
			);
			if (!current && baseVersion !== 0) throw versionConflict(0);
			if (current && current.version !== baseVersion)
				throw versionConflict(current.version);
			if (
				input.type === "team" &&
				input.config.capacityPerTeam !== null &&
				(await teamCapacityExceeded(
					tx,
					rootEventId,
					eventId,
					input.config.capacityPerTeam,
				))
			)
				throw conflict(
					"TEAM_CAPACITY_CONFLICT",
					"The configured capacity is below a published team size.",
				);

			const [capability] = current
				? await tx<CapabilityRecord[]>`
					UPDATE event_capabilities SET
						schema_version = ${input.schemaVersion},
						config = ${tx.json(input.config as never)},
						version = version + 1, updated_at = now(), deleted_at = NULL
					WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
						AND capability_type = ${input.type} AND version = ${baseVersion}
					RETURNING ${capabilityColumns(tx)}
				`
				: await tx<CapabilityRecord[]>`
					INSERT INTO event_capabilities (
						root_event_id, event_id, capability_type, schema_version, config
					) VALUES (
						${rootEventId}, ${eventId}, ${input.type}, ${input.schemaVersion},
						${tx.json(input.config as never)}
					)
					RETURNING ${capabilityColumns(tx)}
				`;
			if (!capability) throw new Error("Capability replace invariant failed");
			const revision = await nextRevision(tx, rootEventId);
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"capability",
				capabilityEntityId(eventId, input.type),
				"upsert",
				capability.version,
				capabilitySync(capability),
			);
			return capability;
		});
	}

	async removeCapability(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		type: CapabilityType,
		baseVersion: number,
	) {
		return this.transaction(async (tx) => {
			await lockWritableRoot(tx, rootEventId, actor, "manager");
			await requireLiveEvent(tx, rootEventId, eventId);
			const current = await findCapability(tx, rootEventId, eventId, type);
			if (!current || current.deletedAt) throw notFound();
			if (current.version !== baseVersion)
				throw versionConflict(current.version);
			if (await capabilityHasDependencies(tx, rootEventId, eventId, type))
				throw conflict(
					"CAPABILITY_DEPENDENCIES_EXIST",
					"Live data still depends on this capability.",
				);
			const [removed] = await tx<CapabilityRecord[]>`
				UPDATE event_capabilities SET version = version + 1,
					updated_at = now(), deleted_at = now()
				WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
					AND capability_type = ${type} AND version = ${baseVersion}
					AND deleted_at IS NULL
				RETURNING ${capabilityColumns(tx)}
			`;
			if (!removed) throw versionConflict(current.version);
			const revision = await nextRevision(tx, rootEventId);
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"capability",
				capabilityEntityId(eventId, type),
				"tombstone",
				removed.version,
				capabilityTombstone(removed),
			);
		});
	}

	async createItineraryItem(
		actor: Actor,
		rootEventId: string,
		input: ItineraryInput,
	) {
		validateTimeZone(input.timeZone);
		return this.transaction(async (tx) => {
			await lockWritableRoot(tx, rootEventId, actor, "manager");
			const event = await requireLiveEvent(tx, rootEventId, input.eventId);
			const details = await materializeItineraryDetails(
				tx,
				rootEventId,
				input.eventId,
				input.details,
			);
			const existing = await findItineraryById(tx, input.id);
			if (existing) {
				if (
					existing.rootEventId === rootEventId &&
					sameItineraryInput(existing, { ...input, details })
				)
					return existing;
				throw conflict(
					"ID_COLLISION",
					"The itinerary item ID is already in use.",
				);
			}
			await assertEventItineraryCapacity(tx, rootEventId, input.eventId);
			validateTimeRange(input.startsAt, input.endsAt);
			const snapshot = input.placeId
				? await requirePlaceSnapshot(tx, rootEventId, input.placeId)
				: null;
			const [position] = await tx<{ value: string }[]>`
        SELECT COALESCE(max(sort_position), 0) + 1024 AS value
        FROM event_itinerary_items
        WHERE root_event_id = ${rootEventId} AND event_id = ${input.eventId} AND deleted_at IS NULL
      `;
			const [item] = await tx<ItineraryRecord[]>`
        INSERT INTO event_itinerary_items (
          id, root_event_id, event_id, title, notes, time_zone, starts_at,
          ends_at, all_day, sort_position, status, details, place_id, place_snapshot
        ) VALUES (
          ${input.id}, ${rootEventId}, ${input.eventId}, ${input.title}, ${input.notes},
          ${input.timeZone}, ${input.startsAt}, ${input.endsAt}, ${input.allDay},
			${position?.value ?? "1024"}, ${input.status}, ${tx.json(details as never)},
          ${input.placeId}, ${snapshot ? tx.json(snapshot) : null}
        ) RETURNING ${itineraryColumns(tx)}
			`;
			if (!item) throw new Error("Itinerary insert invariant failed");
			await assertSessionReferencesValid(tx, rootEventId);
			const changedEvent = await bumpItineraryOrder(tx, rootEventId, event.id);
			const revision = await nextRevision(tx, rootEventId);
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"itineraryItem",
				item.id,
				"upsert",
				item.version,
				itinerarySync(item),
			);
			await appendChange(
				tx,
				rootEventId,
				revision,
				1,
				"event",
				changedEvent.id,
				"upsert",
				changedEvent.version,
				eventSync(changedEvent),
			);
			if (
				item.status === "active" &&
				(await itineraryIsMemberVisible(tx, rootEventId, item.id))
			) {
				await appendSystemFeedEntry(
					tx,
					this.notificationPayloads,
					actor,
					rootEventId,
					item.eventId,
					revision,
					2,
					{
						schemaVersion: 1,
						type: "itinerary.added",
						actorUserId: actor.id,
						itineraryItemId: item.id,
						eventId: item.eventId,
						entityVersion: item.version,
					},
					"visible",
				);
			}
			return item;
		});
	}

	async listItinerary(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		page: { limit: number; after: { sortPosition: string; id: string } | null },
	) {
		return this.transaction(async (tx) => {
			const root = await lockReadableRoot(tx, rootEventId, actor, "share");
			const membership = await requireMembership(tx, rootEventId, actor);
			const manager = isManager(membership.role);
			let visibleEventIds: string[] = [];
			if (manager) {
				await requireLiveEvent(tx, rootEventId, eventId);
			} else {
				const visibleEvents =
					root.status === "active"
						? await visiblePublishedEvents(tx, rootEventId)
						: [];
				if (!visibleEvents.some((event) => event.id === eventId))
					throw notFound();
				visibleEventIds = visibleEvents.map((event) => event.id);
			}
			const rows = await tx<ItineraryRecord[]>`
				SELECT ${itineraryColumns(tx)} FROM event_itinerary_items item
				WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
					AND deleted_at IS NULL
				${
					manager
						? tx``
						: tx`AND status <> 'archived'
							AND (
								item.details->>'type' IS DISTINCT FROM 'session'
								OR item.details->>'descendantEventId' IS NULL
								OR item.details->>'descendantEventId' IN ${tx(visibleEventIds)}
							)`
				}
				${
					page.after
						? tx`AND (sort_position > ${page.after.sortPosition}::bigint OR (sort_position = ${page.after.sortPosition}::bigint AND id > ${page.after.id}))`
						: tx``
				}
				ORDER BY sort_position, id
				LIMIT ${page.limit + 1}
			`;
			return pageSlice(rows, page.limit);
		});
	}

	async updateItineraryItem(
		actor: Actor,
		rootEventId: string,
		itemId: string,
		baseVersion: number,
		patch: ItineraryPatch,
	) {
		return this.transaction(async (tx) => {
			await lockWritableRoot(tx, rootEventId, actor, "manager");
			const current = await findItinerary(tx, rootEventId, itemId);
			if (!current) throw notFound();
			if (current.deletedAt) throw entityDeleted();
			const details = Object.hasOwn(patch, "details")
				? await materializeItineraryDetails(
						tx,
						rootEventId,
						current.eventId,
						patch.details as ItineraryDetailsInput,
						current.details,
					)
				: current.details;
			const merged = mergeItinerary(current, { ...patch, details });
			validateTimeRange(merged.startsAt, merged.endsAt);
			validateTimeZone(merged.timeZone);
			const snapshot = Object.hasOwn(patch, "placeId")
				? merged.placeId
					? await requirePlaceSnapshot(tx, rootEventId, merged.placeId)
					: null
				: current.placeSnapshot;
			if (current.version !== baseVersion) {
				if (sameEditableItinerary(current, merged, snapshot)) return current;
				throw versionConflict(current.version);
			}
			const [updated] = await tx<ItineraryRecord[]>`
        UPDATE event_itinerary_items SET
          title = ${merged.title}, notes = ${merged.notes}, time_zone = ${merged.timeZone},
          starts_at = ${merged.startsAt}, ends_at = ${merged.endsAt}, all_day = ${merged.allDay},
			status = ${merged.status}, details = ${tx.json(merged.details as never)}, place_id = ${merged.placeId},
          place_snapshot = ${snapshot ? tx.json(snapshot) : null}, version = version + 1, updated_at = now()
        WHERE root_event_id = ${rootEventId} AND id = ${itemId} AND version = ${baseVersion}
        RETURNING ${itineraryColumns(tx)}
			`;
			if (!updated) throw versionConflict(current.version);
			await assertSessionReferencesValid(tx, rootEventId);
			const revision = await nextRevision(tx, rootEventId);
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"itineraryItem",
				itemId,
				"upsert",
				updated.version,
				itinerarySync(updated),
			);
			if (
				current.status === "active" &&
				updated.status === "cancelled" &&
				(await itineraryIsMemberVisible(tx, rootEventId, updated.id))
			) {
				await appendSystemFeedEntry(
					tx,
					this.notificationPayloads,
					actor,
					rootEventId,
					updated.eventId,
					revision,
					1,
					{
						schemaVersion: 1,
						type: "itinerary.cancelled",
						actorUserId: actor.id,
						itineraryItemId: updated.id,
						eventId: updated.eventId,
						entityVersion: updated.version,
					},
					"visible",
				);
			}
			return updated;
		});
	}

	async reorderItinerary(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseOrderVersion: number,
		orderedIds: string[],
	) {
		return this.transaction(async (tx) => {
			await lockWritableRoot(tx, rootEventId, actor, "manager");
			const event = await requireLiveEvent(tx, rootEventId, eventId);
			const current = await itineraryItems(tx, rootEventId, eventId);
			const currentIds = current.map((item) => item.id);
			if (event.itineraryOrderVersion !== baseOrderVersion) {
				if (sameStrings(currentIds, orderedIds))
					return { event, items: current };
				throw versionConflict(event.itineraryOrderVersion, {
					orderedIds: currentIds,
				});
			}
			assertSameSet(currentIds, orderedIds);
			if (sameStrings(currentIds, orderedIds)) return { event, items: current };
			for (const [index, id] of orderedIds.entries()) {
				await tx`UPDATE event_itinerary_items
          SET sort_position = ${(index + 1) * 1024}, version = version + 1, updated_at = now()
          WHERE root_event_id = ${rootEventId} AND id = ${id} AND event_id = ${eventId}`;
			}
			const [updatedEvent] = await tx<EventRecord[]>`
				UPDATE events SET itinerary_order_version = itinerary_order_version + 1,
					version = version + 1, updated_at = now()
        WHERE root_event_id = ${rootEventId} AND id = ${eventId}
        RETURNING ${eventColumns(tx)}
      `;
			if (!updatedEvent) throw new Error("Event update invariant failed");
			const items = await itineraryItems(tx, rootEventId, eventId);
			const revision = await nextRevision(tx, rootEventId);
			let ordinal = 0;
			for (const item of items) {
				await appendChange(
					tx,
					rootEventId,
					revision,
					ordinal++,
					"itineraryItem",
					item.id,
					"upsert",
					item.version,
					itinerarySync(item),
				);
			}
			await appendChange(
				tx,
				rootEventId,
				revision,
				ordinal,
				"event",
				eventId,
				"upsert",
				updatedEvent.version,
				eventSync(updatedEvent),
			);
			return { event: updatedEvent, items };
		});
	}

	async createFeedEntry(
		actor: Actor,
		rootEventId: string,
		input: {
			id: string;
			eventId: string | null;
			parentEntryId: string | null;
			kind: "message" | "comment";
			body: string;
		},
		causationRequestId: string,
	) {
		validateFeedBody(input.body);
		return this.transaction(async (tx) => {
			const membership = await lockFeedWriter(tx, rootEventId, actor);
			const event = await requireWritableFeedEvent(
				tx,
				rootEventId,
				input.eventId ?? rootEventId,
				membership.role,
			);
			let parent: FeedEntryRecord | null = null;
			if (input.kind === "comment") {
				if (!input.parentEntryId)
					throw new DomainError(
						400,
						"FEED_PARENT_REQUIRED",
						"A comment requires a parent entry.",
					);
				parent = await findFeedEntry(
					tx,
					actor,
					rootEventId,
					input.parentEntryId,
				);
				if (!parent || parent.deletedAt) throw notFound();
				if ((parent.eventId ?? rootEventId) !== event.id)
					throw new DomainError(
						400,
						"FEED_PARENT_CONTEXT_INVALID",
						"The comment parent belongs to another event context.",
					);
			} else if (input.parentEntryId) {
				throw new DomainError(
					400,
					"FEED_PARENT_INVALID",
					"A message cannot have a parent entry.",
				);
			}

			const existing = await findFeedEntryById(tx, actor, input.id);
			if (existing) {
				if (
					existing.rootEventId === rootEventId &&
					existing.eventId === input.eventId &&
					existing.parentEntryId === input.parentEntryId &&
					existing.authorUserId === actor.id &&
					existing.kind === input.kind &&
					existing.version === 1 &&
					existing.body === input.body &&
					!existing.deletedAt
				)
					return existing;
				throw conflict("ID_COLLISION", "The feed entry ID is already in use.");
			}
			const notificationRecipients = await findFeedNotificationRecipients(
				tx,
				actor,
				rootEventId,
				input.eventId,
			);
			if (notificationRecipients.length > MAX_NOTIFICATION_RECIPIENTS_PER_FEED)
				throw conflict(
					"FEED_NOTIFICATION_RECIPIENT_LIMIT_REACHED",
					"The feed entry has too many notification recipients.",
				);

			const revision = await nextRevision(tx, rootEventId);
			await tx`
				INSERT INTO event_feed_entries (
					id, root_event_id, event_id, parent_entry_id, author_user_id,
					kind, created_root_revision
				) VALUES (
					${input.id}, ${rootEventId}, ${input.eventId}, ${input.parentEntryId},
					${actor.id}, ${input.kind}, ${revision}
				)
			`;
			await tx`
				INSERT INTO event_feed_entry_revisions (
					root_event_id, entry_id, version, editor_user_id, body, root_revision
				) VALUES (${rootEventId}, ${input.id}, 1, ${actor.id}, ${input.body}, ${revision})
			`;
			await tx`
				INSERT INTO event_feed_entry_current (
					root_event_id, entry_id, version, body, root_revision
				) VALUES (${rootEventId}, ${input.id}, 1, ${input.body}, ${revision})
			`;
			const entry = await findFeedEntry(tx, actor, rootEventId, input.id);
			if (!entry) throw new Error("Feed insert invariant failed");
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"feedEntry",
				entry.id,
				"upsert",
				entry.version,
				feedEntrySync(entry),
			);
			await enqueueFeedNotifications(
				tx,
				this.notificationPayloads,
				entry,
				causationRequestId,
				notificationRecipients,
			);
			return entry;
		});
	}

	async listFeedEntries(
		actor: Actor,
		rootEventId: string,
		page: {
			limit: number;
			after: { rootRevision: string; id: string } | null;
			eventId: string | null;
			kind: FeedKind | null;
		},
	) {
		return this.transaction(async (tx) => {
			await lockReadableRoot(tx, rootEventId, actor, "share");
			const membership = await requireMembership(tx, rootEventId, actor);
			const rows = await tx<FeedEntryRecord[]>`
				SELECT ${feedEntryColumns(tx)}
				FROM event_feed_entries entry
				JOIN event_feed_entry_current current
					ON current.root_event_id = entry.root_event_id AND current.entry_id = entry.id
				WHERE entry.root_event_id = ${rootEventId}
				${page.eventId ? tx`AND entry.event_id = ${page.eventId}` : tx``}
				${page.kind ? tx`AND entry.kind = ${page.kind}` : tx``}
				${feedVisibilityClause(tx, membership.role)}
				${
					page.after
						? tx`AND (
							entry.created_root_revision < ${page.after.rootRevision} OR
							(entry.created_root_revision = ${page.after.rootRevision} AND entry.id < ${page.after.id})
						)`
						: tx``
				}
				ORDER BY entry.created_root_revision DESC, entry.id DESC
				LIMIT ${page.limit + 1}
			`;
			await hydrateFeedEntries(tx, actor, rows);
			return pageSlice(rows, page.limit);
		});
	}

	async getFeedEntry(actor: Actor, rootEventId: string, entryId: string) {
		return this.transaction(async (tx) => {
			await lockReadableRoot(tx, rootEventId, actor, "share");
			const entry = await findVisibleFeedEntry(tx, actor, rootEventId, entryId);
			if (!entry) throw notFound();
			return entry;
		});
	}

	async reviseFeedEntry(
		actor: Actor,
		rootEventId: string,
		entryId: string,
		baseVersion: number,
		body: string,
	) {
		validateFeedBody(body);
		return this.transaction(async (tx) => {
			const membership = await lockFeedWriter(tx, rootEventId, actor);
			const current = await findFeedEntry(tx, actor, rootEventId, entryId);
			if (!current) throw notFound();
			if (current.deletedAt) throw entityDeleted();
			if (current.kind === "system")
				throw forbidden("System feed entries are immutable.");
			await requireWritableFeedEvent(
				tx,
				rootEventId,
				current.eventId ?? rootEventId,
				membership.role,
			);
			if (current.authorUserId !== actor.id)
				throw forbidden("Only the author can revise this feed entry.");
			if (current.version !== baseVersion) {
				if (current.body === body) return current;
				throw versionConflict(current.version);
			}
			if (current.body === body) return current;
			const revision = await nextRevision(tx, rootEventId);
			const version = current.version + 1;
			await tx`
				INSERT INTO event_feed_entry_revisions (
					root_event_id, entry_id, version, editor_user_id, body, root_revision
				) VALUES (${rootEventId}, ${entryId}, ${version}, ${actor.id}, ${body}, ${revision})
			`;
			await tx`
				UPDATE event_feed_entry_current SET version = ${version}, body = ${body},
					root_revision = ${revision}, updated_at = now()
				WHERE root_event_id = ${rootEventId} AND entry_id = ${entryId}
			`;
			const updated = await findFeedEntry(tx, actor, rootEventId, entryId);
			if (!updated) throw new Error("Feed revision invariant failed");
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"feedEntry",
				entryId,
				"upsert",
				version,
				feedEntrySync(updated),
			);
			return updated;
		});
	}

	async removeFeedEntry(
		actor: Actor,
		rootEventId: string,
		entryId: string,
		baseVersion: number,
	) {
		return this.transaction(async (tx) => {
			const membership = await lockFeedWriter(tx, rootEventId, actor);
			const current = await findFeedEntry(tx, actor, rootEventId, entryId);
			if (!current) throw notFound();
			if (current.kind === "system")
				throw forbidden("System feed entries are immutable.");
			await requireWritableFeedEvent(
				tx,
				rootEventId,
				current.eventId ?? rootEventId,
				membership.role,
			);
			if (current.authorUserId !== actor.id && !isManager(membership.role))
				throw forbidden();
			if (current.deletedAt) return current;
			if (current.version !== baseVersion)
				throw versionConflict(current.version);
			const revision = await nextRevision(tx, rootEventId);
			const version = current.version + 1;
			const reason =
				current.authorUserId === actor.id ? "author" : "moderation";
			await tx`
				INSERT INTO event_feed_entry_revisions (
					root_event_id, entry_id, version, editor_user_id, tombstone_reason, root_revision
				) VALUES (${rootEventId}, ${entryId}, ${version}, ${actor.id}, ${reason}, ${revision})
			`;
			await tx`
				UPDATE event_feed_entry_current SET version = ${version}, body = NULL,
					root_revision = ${revision}, updated_at = now(), deleted_at = now(),
					deleted_by = ${actor.id}, tombstone_reason = ${reason}
				WHERE root_event_id = ${rootEventId} AND entry_id = ${entryId}
			`;
			const removed = await findFeedEntry(tx, actor, rootEventId, entryId);
			if (!removed?.deletedAt)
				throw new Error("Feed tombstone invariant failed");
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"feedEntry",
				entryId,
				"tombstone",
				version,
				feedEntryTombstone(removed),
			);
			return removed;
		});
	}

	async setFeedReaction(
		actor: Actor,
		rootEventId: string,
		entryId: string,
		reaction: string,
		present: boolean,
	) {
		validateReaction(reaction);
		return this.transaction(async (tx) => {
			const membership = await lockFeedWriter(tx, rootEventId, actor);
			const entry = await findFeedEntry(tx, actor, rootEventId, entryId);
			if (!entry || entry.deletedAt) throw notFound();
			await requireWritableFeedEvent(
				tx,
				rootEventId,
				entry.eventId ?? rootEventId,
				membership.role,
			);
			const [current] = await tx<FeedReactionRecord[]>`
				SELECT ${reactionColumns(tx)} FROM event_feed_reactions
				WHERE root_event_id = ${rootEventId} AND entry_id = ${entryId}
					AND user_id = ${actor.id} AND reaction = ${reaction}
				FOR UPDATE
			`;
			if (current?.present === present) return current;
			const revision = await nextRevision(tx, rootEventId);
			const [stored] = await tx<FeedReactionRecord[]>`
				INSERT INTO event_feed_reactions (
					root_event_id, entry_id, user_id, reaction, present, root_revision
				) VALUES (${rootEventId}, ${entryId}, ${actor.id}, ${reaction}, ${present}, ${revision})
				ON CONFLICT (root_event_id, entry_id, user_id, reaction) DO UPDATE SET
					present = EXCLUDED.present, version = event_feed_reactions.version + 1,
					root_revision = EXCLUDED.root_revision, updated_at = now()
				RETURNING ${reactionColumns(tx)}
			`;
			if (!stored) throw new Error("Feed reaction invariant failed");
			await appendChange(
				tx,
				rootEventId,
				revision,
				0,
				"feedReaction",
				feedReactionEntityId(entryId, actor.id, reaction),
				present ? "upsert" : "tombstone",
				stored.version,
				present ? feedReactionSync(stored) : feedReactionTombstone(stored),
			);
			return stored;
		});
	}

	async createAttachmentUpload(
		actor: Actor,
		input: Omit<
			AttachmentUploadRecord,
			"createdBy" | "state" | "committedAt" | "createdAt"
		>,
	) {
		return this.transaction(async (tx) => {
			await lockAttachmentTarget(tx, actor, input.rootEventId, input.target, {
				feedbackMayExist: false,
			});
			await tx`
				UPDATE event_attachment_uploads SET state = 'expired'
				WHERE attachment_id = ${input.attachmentId}
					AND state = 'prepared' AND expires_at <= now()
			`;
			const [capacity] = await tx<
				{
					targetAttachments: number;
					targetUploads: number;
					actorUploads: number;
				}[]
			>`
				SELECT
					(SELECT count(*)::int FROM event_attachments
					 WHERE root_event_id = ${input.rootEventId}
						AND target_type = ${attachmentTargetType(input.target)}
						AND target_entry_id IS NOT DISTINCT FROM ${attachmentTargetEntryId(input.target)}
						AND target_feedback_id IS NOT DISTINCT FROM ${attachmentTargetFeedbackId(input.target)}) AS "targetAttachments",
					(SELECT count(*)::int FROM event_attachment_uploads
					 WHERE root_event_id = ${input.rootEventId}
						AND target_type = ${attachmentTargetType(input.target)}
						AND target_entry_id IS NOT DISTINCT FROM ${attachmentTargetEntryId(input.target)}
						AND target_feedback_id IS NOT DISTINCT FROM ${attachmentTargetFeedbackId(input.target)}
						AND state = 'prepared' AND expires_at > now()) AS "targetUploads",
					(SELECT count(*)::int FROM event_attachment_uploads
					 WHERE root_event_id = ${input.rootEventId} AND created_by = ${actor.id}
						AND state = 'prepared' AND expires_at > now()) AS "actorUploads"
			`;
			const targetLimit =
				input.target.kind === "feedEntry"
					? ATTACHMENTS_PER_ENTRY_LIMIT
					: ATTACHMENTS_PER_FEEDBACK_LIMIT;
			if (
				(capacity?.targetAttachments ?? 0) + (capacity?.targetUploads ?? 0) >=
				targetLimit
			)
				throw conflict(
					"ATTACHMENT_LIMIT_REACHED",
					"The attachment target already has the maximum number of attachments.",
				);
			if ((capacity?.actorUploads ?? 0) >= LIVE_UPLOADS_PER_ACTOR_LIMIT)
				throw conflict(
					"UPLOAD_LIMIT_REACHED",
					"The actor already has the maximum number of active upload leases.",
				);
			const collision = await tx`
				SELECT id FROM event_attachment_uploads
				WHERE id = ${input.id}
					OR (attachment_id = ${input.attachmentId} AND state IN ('prepared', 'committed'))
				UNION ALL SELECT id FROM event_attachments WHERE id = ${input.attachmentId}
				LIMIT 1
			`;
			if (collision.length)
				throw conflict(
					"ID_COLLISION",
					"The upload or attachment ID is already in use.",
				);
			const [upload] = await tx<AttachmentUploadRecord[]>`
				INSERT INTO event_attachment_uploads (
					id, attachment_id, root_event_id, target_type, target_entry_id,
					target_feedback_id, created_by,
					quarantine_object_key, content_type, byte_count, sha256,
					grant_kid, grant_ciphertext, expires_at
				) VALUES (
					${input.id}, ${input.attachmentId}, ${input.rootEventId},
					${attachmentTargetType(input.target)}, ${attachmentTargetEntryId(input.target)},
					${attachmentTargetFeedbackId(input.target)},
					${actor.id}, ${input.quarantineObjectKey}, ${input.contentType},
					${input.byteCount}, ${input.sha256}, ${input.grantKid},
					${input.grantCiphertext}, ${input.expiresAt}
				) RETURNING ${uploadColumns(tx)}
			`;
			if (!upload) throw new Error("Attachment upload invariant failed");
			await tx`
				INSERT INTO event_attachment_cleanup_jobs (upload_id, available_at)
				VALUES (${upload.id}, ${upload.createdAt} + interval '24 hours')
			`;
			return upload;
		});
	}

	async getAttachmentUpload(
		actor: Actor,
		rootEventId: string,
		uploadId: string,
	) {
		return this.transaction(async (tx) => {
			const context = await lockAttachmentRoot(tx, actor, rootEventId);
			const [upload] = await tx<AttachmentUploadRecord[]>`
				SELECT ${uploadColumns(tx)} FROM event_attachment_uploads
				WHERE root_event_id = ${rootEventId} AND id = ${uploadId}
			`;
			if (!upload || upload.createdBy !== actor.id) throw notFound();
			await assertAttachmentTarget(
				tx,
				actor,
				rootEventId,
				upload.target,
				context,
				{ feedbackMayExist: true },
			);
			return upload;
		});
	}

	async ensureAttachmentVerification(
		actor: Actor,
		rootEventId: string,
		uploadId: string,
	): Promise<AttachmentFinalizePrecondition> {
		return this.transaction(async (tx) => {
			const context = await lockAttachmentRoot(tx, actor, rootEventId);
			const [upload] = await tx<AttachmentUploadRecord[]>`
				SELECT ${uploadColumns(tx)} FROM event_attachment_uploads
				WHERE root_event_id = ${rootEventId} AND id = ${uploadId}
				FOR UPDATE
			`;
			if (!upload || upload.createdBy !== actor.id) throw notFound();
			await assertAttachmentTarget(
				tx,
				actor,
				rootEventId,
				upload.target,
				context,
				{ feedbackMayExist: true },
			);

			const [existingJob] = await tx<
				{
					status: AttachmentVerificationStatus;
					availableAt: Date;
					leaseUntil: Date | null;
				}[]
			>`
				SELECT status, available_at AS "availableAt", lease_until AS "leaseUntil"
				FROM event_attachment_verify_jobs WHERE upload_id = ${upload.id}
			`;
			if (
				upload.state === "committed" ||
				existingJob?.status === "verified" ||
				existingJob?.status === "rejected" ||
				existingJob?.status === "dead"
			)
				return { state: "ready" };
			if (existingJob) return pendingVerification(existingJob);
			if (upload.state === "expired" || upload.expiresAt <= new Date()) {
				await tx`
					UPDATE event_attachment_uploads SET state = 'expired'
					WHERE id = ${upload.id} AND state = 'prepared'
				`;
				throw conflict("UPLOAD_EXPIRED", "The upload lease has expired.");
			}
			await tx`
				SELECT pg_advisory_xact_lock(
					hashtextextended('crew:event-attachment-verify-capacity', 0)
				)
			`;
			const [capacity] = await tx<
				{ actorRoot: number; root: number; global: number }[]
			>`
				SELECT
					count(*) FILTER (
						WHERE upload.root_event_id = ${rootEventId}
							AND upload.created_by = ${actor.id}
					)::int AS "actorRoot",
					count(*) FILTER (
						WHERE upload.root_event_id = ${rootEventId}
					)::int AS root,
					count(*)::int AS "global"
				FROM event_attachment_verify_jobs job
				JOIN event_attachment_uploads upload ON upload.id = job.upload_id
				WHERE job.status IN ('pending', 'processing', 'retry')
			`;
			if (
				(capacity?.actorRoot ?? 0) >= PENDING_VERIFY_PER_ACTOR_ROOT_LIMIT ||
				(capacity?.root ?? 0) >= PENDING_VERIFY_PER_ROOT_LIMIT ||
				(capacity?.global ?? 0) >= PENDING_VERIFY_GLOBAL_LIMIT
			)
				throw conflict(
					"ATTACHMENT_VERIFICATION_CAPACITY",
					"Attachment verification capacity is temporarily full.",
					{ "Retry-After": "5" },
				);
			await tx`
				INSERT INTO event_attachment_verify_jobs (upload_id)
				VALUES (${upload.id}) ON CONFLICT (upload_id) DO NOTHING
			`;
			return { state: "pending", retryAfterSeconds: 1 };
		});
	}

	async commitAttachment(
		actor: Actor,
		rootEventId: string,
		uploadId: string,
		caption: string | null,
	) {
		validateCaption(caption);
		return this.transaction(async (tx) => {
			const [preflight] = await tx<AttachmentUploadRecord[]>`
				SELECT ${uploadColumns(tx)} FROM event_attachment_uploads
				WHERE root_event_id = ${rootEventId} AND id = ${uploadId}
			`;
			if (!preflight || preflight.createdBy !== actor.id) throw notFound();
			if (preflight.target.kind === "feedback")
				await lockFeedbackAttachmentId(tx, preflight.target.feedbackId);
			const context = await lockAttachmentRoot(tx, actor, rootEventId);
			const [cleanupJob] = await tx<{ status: string; attempts: number }[]>`
				SELECT status, attempts FROM event_attachment_cleanup_jobs
				WHERE upload_id = ${uploadId} FOR UPDATE
			`;
			const [upload] = await tx<AttachmentUploadRecord[]>`
				SELECT ${uploadColumns(tx)} FROM event_attachment_uploads
				WHERE root_event_id = ${rootEventId} AND id = ${uploadId} FOR UPDATE
			`;
			if (
				!upload ||
				upload.createdBy !== actor.id ||
				!sameAttachmentTarget(upload.target, preflight.target)
			)
				throw notFound();
			const committedObjectKey = attachmentCommittedKey(upload);
			const targetContext = await assertAttachmentTarget(
				tx,
				actor,
				rootEventId,
				upload.target,
				context,
				{ feedbackMayExist: true },
			);
			const [existing] = await tx<(AttachmentRecord & { objectKey: string })[]>`
				SELECT ${attachmentColumns(tx)}, object_key AS "objectKey"
				FROM event_attachments WHERE id = ${upload.attachmentId}
			`;
			if (existing) {
				if (
					existing.rootEventId === rootEventId &&
					sameAttachmentTarget(existing.target, upload.target) &&
					existing.objectKey === committedObjectKey &&
					existing.caption === caption
				)
					return existing;
				throw conflict("ID_COLLISION", "The attachment ID is already in use.");
			}
			if (upload.target.kind === "feedback" && targetContext.feedbackExists)
				throw conflict(
					"FEEDBACK_ATTACHMENT_BINDING_CLOSED",
					"The feedback was created before this attachment was committed.",
				);
			if (
				upload.target.kind === "feedback" &&
				(cleanupJob?.status !== "pending" || cleanupJob.attempts !== 0)
			)
				throw conflict(
					"FEEDBACK_ATTACHMENT_RETENTION_CLOSED",
					"The feedback attachment retention window has closed.",
				);
			const [verification] = await tx<
				{
					status: AttachmentVerificationStatus;
					resultObjectKey: string | null;
					errorCode: string | null;
				}[]
			>`
				SELECT status, result_object_key AS "resultObjectKey", error_code AS "errorCode"
				FROM event_attachment_verify_jobs WHERE upload_id = ${upload.id}
				FOR UPDATE
			`;
			if (verification?.status === "rejected")
				throw conflict(
					verification.errorCode ?? "ATTACHMENT_VERIFICATION_REJECTED",
					"The uploaded image failed integrity validation.",
				);
			if (verification?.status === "dead")
				throw conflict(
					"ATTACHMENT_VERIFICATION_DEAD",
					"Attachment verification exhausted its retry budget.",
				);
			if (
				verification?.status !== "verified" ||
				verification.resultObjectKey !== committedObjectKey
			)
				throw new Error("Attachment verification is not ready");
			if (upload.state !== "prepared")
				throw conflict("UPLOAD_EXPIRED", "The upload lease has expired.");
			const [capacity] = await tx<{ count: number }[]>`
				SELECT count(*)::int AS count FROM event_attachments
				WHERE root_event_id = ${rootEventId}
					AND target_type = ${attachmentTargetType(upload.target)}
					AND target_entry_id IS NOT DISTINCT FROM ${attachmentTargetEntryId(upload.target)}
					AND target_feedback_id IS NOT DISTINCT FROM ${attachmentTargetFeedbackId(upload.target)}
			`;
			const targetLimit =
				upload.target.kind === "feedEntry"
					? ATTACHMENTS_PER_ENTRY_LIMIT
					: ATTACHMENTS_PER_FEEDBACK_LIMIT;
			if ((capacity?.count ?? 0) >= targetLimit)
				throw conflict(
					"ATTACHMENT_LIMIT_REACHED",
					"The attachment target already has the maximum number of attachments.",
				);
			const revision =
				upload.target.kind === "feedEntry"
					? await nextRevision(tx, rootEventId)
					: context.root.revision;
			const [attachment] = await tx<AttachmentRecord[]>`
				INSERT INTO event_attachments (
					id, root_event_id, target_type, target_entry_id, target_feedback_id,
					upload_id, created_by, object_key,
					content_type, byte_count, sha256, caption, root_revision
				) VALUES (
					${upload.attachmentId}, ${rootEventId}, ${attachmentTargetType(upload.target)},
					${attachmentTargetEntryId(upload.target)}, ${attachmentTargetFeedbackId(upload.target)},
					${upload.id},
					${actor.id}, ${committedObjectKey}, ${upload.contentType}, ${upload.byteCount},
					${upload.sha256}, ${caption}, ${revision}
				) RETURNING ${attachmentColumns(tx)}
			`;
			if (!attachment) throw new Error("Attachment commit invariant failed");
			await tx`
				UPDATE event_attachment_uploads SET state = 'committed', committed_at = now()
				WHERE id = ${upload.id}
			`;
			if (attachment.target.kind === "feedEntry")
				await appendChange(
					tx,
					rootEventId,
					revision,
					0,
					"attachment",
					attachment.id,
					"upsert",
					1,
					attachmentSync(attachment),
				);
			return attachment;
		});
	}

	async getAttachment(actor: Actor, rootEventId: string, attachmentId: string) {
		return this.transaction(async (tx) => {
			await lockReadableRoot(tx, rootEventId, actor, "share");
			const membership = await requireMembership(tx, rootEventId, actor);
			const [attachment] = await tx<
				(AttachmentRecord & { objectKey: string })[]
			>`
				SELECT ${selectedAttachmentColumns(tx)}, attachment.object_key AS "objectKey"
				FROM event_attachments attachment
				WHERE attachment.root_event_id = ${rootEventId}
					AND attachment.id = ${attachmentId}
			`;
			if (!attachment) throw notFound();
			if (attachment.target.kind === "feedback") {
				const [linked] = await tx<{ linked: boolean }[]>`
					SELECT EXISTS(
						SELECT 1 FROM event_feedback_attachments link
						WHERE link.root_event_id = ${rootEventId}
							AND link.feedback_id = ${attachment.target.feedbackId}
							AND link.attachment_id = ${attachment.id}
							AND link.attachment_target_type = 'feedback'
					) AS linked
				`;
				if (!linked?.linked) throw notFound();
				await assertFeedbackAccess(
					tx,
					actor,
					attachment.target.feedbackId,
					"member",
				);
				return attachment;
			}
			const [visible] = await tx<{ visible: boolean }[]>`
				SELECT EXISTS(
					SELECT 1 FROM event_feed_entries entry
					JOIN event_feed_entry_current current
						ON current.root_event_id = entry.root_event_id
						AND current.entry_id = entry.id
					WHERE entry.root_event_id = ${rootEventId}
						AND entry.id = ${attachment.target.entryId}
						AND current.deleted_at IS NULL
						${feedVisibilityClause(tx, membership.role)}
				) AS visible
			`;
			if (!visible?.visible) throw notFound();
			return attachment;
		});
	}

	assertFeedbackReplaySafe(
		actor: Actor,
		feedbackId: string,
		access: "read" | "member" | "manage",
	) {
		return this.transaction((tx) =>
			assertFeedbackAccess(tx, actor, feedbackId, access),
		);
	}

	createFeedback(actor: Actor, input: FeedbackInput) {
		return this.transaction((tx) => feedbackCreate(tx, actor, input));
	}

	getFeedback(actor: Actor, feedbackId: string) {
		return this.snapshot((tx) => feedbackGet(tx, actor, feedbackId));
	}

	setFeedbackVote(actor: Actor, feedbackId: string, present: boolean) {
		return this.transaction((tx) =>
			feedbackVoteSet(tx, actor, feedbackId, present),
		);
	}

	addFeedbackComment(
		actor: Actor,
		feedbackId: string,
		input: { id: string; body: string },
	) {
		return this.transaction((tx) =>
			feedbackCommentAdd(tx, actor, feedbackId, input),
		);
	}

	markFeedbackDuplicate(
		actor: Actor,
		feedbackId: string,
		canonicalFeedbackId: string,
		note: string | null,
	) {
		return this.transaction((tx) =>
			feedbackMarkDuplicate(tx, actor, feedbackId, canonicalFeedbackId, note),
		);
	}

	setFeedbackStatus(
		actor: Actor,
		feedbackId: string,
		status: Exclude<FeedbackStatus, "duplicate">,
		note: string | null,
	) {
		return this.transaction((tx) =>
			feedbackStatusSet(tx, actor, feedbackId, status, note),
		);
	}

	assertCommunityFeedbackReplaySafe(
		actor: Actor,
		rootEventId: string,
		feedbackId: string,
		expectedCanonicalId: string,
	) {
		return this.transaction((tx) =>
			assertCommunityFeedbackAccess(
				tx,
				actor,
				rootEventId,
				feedbackId,
				expectedCanonicalId,
			),
		);
	}

	listCommunityFeedback(
		actor: Actor,
		rootEventId: string,
		page: Parameters<EventRepository["listCommunityFeedback"]>[2],
	) {
		return this.transaction((tx) =>
			communityFeedbackList(tx, actor, rootEventId, page),
		);
	}

	listCommunityFeedbackDuplicateSuggestions(
		actor: Actor,
		rootEventId: string,
		search: Parameters<
			EventRepository["listCommunityFeedbackDuplicateSuggestions"]
		>[2],
	) {
		return this.transaction((tx) =>
			communityFeedbackDuplicateSuggestionsList(tx, actor, rootEventId, search),
		);
	}

	listCommunityFeedbackUpdates(
		actor: Actor,
		rootEventId: string,
		page: Parameters<EventRepository["listCommunityFeedbackUpdates"]>[2],
	) {
		return this.transaction((tx) =>
			communityFeedbackUpdatesList(tx, actor, rootEventId, page),
		);
	}

	getCommunityFeedback(actor: Actor, rootEventId: string, feedbackId: string) {
		return this.snapshot((tx) =>
			communityFeedbackGet(tx, actor, rootEventId, feedbackId),
		);
	}

	setCommunityFeedbackVote(
		actor: Actor,
		rootEventId: string,
		feedbackId: string,
		present: boolean,
	) {
		return this.transaction((tx) =>
			communityFeedbackVoteSet(tx, actor, rootEventId, feedbackId, present),
		);
	}

	addCommunityFeedbackComment(
		actor: Actor,
		rootEventId: string,
		feedbackId: string,
		input: { id: string; body: string },
	) {
		return this.transaction((tx) =>
			communityFeedbackCommentAdd(tx, actor, rootEventId, feedbackId, input),
		);
	}

	setCommunityFeedbackFollow(
		actor: Actor,
		rootEventId: string,
		feedbackId: string,
		followed: boolean,
	) {
		return this.transaction((tx) =>
			communityFeedbackFollowSet(tx, actor, rootEventId, feedbackId, followed),
		);
	}

	requestPlaceEnrichmentCandidate(
		actor: Actor,
		scope: PlaceEnrichmentScope,
		candidateId: string,
		policy: PlaceEnrichmentPolicy,
	) {
		if (!this.inTransaction)
			throw new Error("Place selection requires an idempotent command");
		return this.selectPlaceCandidate(actor, scope, candidateId, policy);
	}

	private async selectPlaceCandidate(
		actor: Actor,
		scope: PlaceEnrichmentScope,
		candidateId: string,
		policy: PlaceEnrichmentPolicy,
	) {
		const expectedKind = await requirePlaceEnrichmentCreateScope(
			this.sql,
			actor,
			scope,
			"update",
		);
		const job = await new PostgresPlaceEnrichmentJobs(
			this.sql,
			true,
		).admitCandidate(candidateId, policy, {
			actorId: actor.id,
			rootEventId: scope.rootEventId,
			expectedKind,
		});
		const id = globalPlaceId(candidateId);
		const [place] = await this.sql<{ id: string }[]>`
			INSERT INTO global_places (id, candidate_id)
			VALUES (${id}, ${candidateId})
			ON CONFLICT (candidate_id) DO UPDATE
				SET candidate_id = EXCLUDED.candidate_id
			RETURNING id
		`;
		if (place?.id !== id)
			throw new Error("Global-place identity invariant failed");
		return job;
	}

	requestPlaceEnrichmentSearchMiss(
		actor: Actor,
		scope: PlaceEnrichmentScope,
		input: { query: string; kind: PlaceCandidateKind; countryCode: string },
		policy: PlaceEnrichmentPolicy,
	) {
		if (!this.inTransaction)
			throw new Error("Place enrichment requires an idempotent command");
		return this.transaction(async (tx) => {
			const expectedKind = await requirePlaceEnrichmentCreateScope(
				tx,
				actor,
				scope,
				"update",
			);
			return new PostgresPlaceEnrichmentJobs(tx, true).admitSearchMiss(
				input,
				policy,
				{
					actorId: actor.id,
					rootEventId: scope.rootEventId,
					expectedKind,
				},
			);
		});
	}

	assertPlaceEnrichmentCreateScope(
		actor: Actor,
		scope: PlaceEnrichmentScope,
	): Promise<void> {
		return this.transaction(async (tx) => {
			await requirePlaceEnrichmentCreateScope(tx, actor, scope, "share");
		});
	}

	getPlaceEnrichment(actor: Actor, rootEventId: string, id: string) {
		return this.transaction(async (tx) => {
			await lockReadableRoot(tx, rootEventId, actor, "share");
			return new PostgresPlaceEnrichmentJobs(tx, true).getAssociated(
				actor.id,
				rootEventId,
				id,
			);
		});
	}

	requestPlaceEnrichmentRetry(actor: Actor, rootEventId: string, id: string) {
		if (!this.inTransaction)
			throw new Error("Place enrichment retry requires an idempotent command");
		return this.transaction(async (tx) => {
			await lockReadableRoot(tx, rootEventId, actor, "update");
			return new PostgresPlaceEnrichmentJobs(tx, true).requestRetryAssociated(
				actor.id,
				rootEventId,
				id,
			);
		});
	}
}

function eventColumns(sql: Tx) {
	return sql`
    id, root_event_id AS "rootEventId", parent_event_id AS "parentEventId",
    kind, title, description, time_zone AS "timeZone", starts_at AS "startsAt",
    ends_at AS "endsAt", sort_position::text AS "sortPosition",
    child_order_version AS "childOrderVersion",
    itinerary_order_version AS "itineraryOrderVersion", status, version,
    created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
  `;
}

function membershipColumns(sql: Tx) {
	return sql`
    root_event_id AS "rootEventId", user_id AS "userId", role, status, version,
    created_at AS "createdAt", updated_at AS "updatedAt"
  `;
}

function invitationColumns(sql: Tx) {
	return sql`
    id, root_event_id AS "rootEventId", token_key_id AS "tokenKeyId",
		role, expires_at AS "expiresAt",
		normalized_email_hint AS "normalizedEmailHint",
    max_uses AS "maxUses", use_count AS "useCount", status, version,
    created_at AS "createdAt", updated_at AS "updatedAt"
  `;
}

function placeColumns(sql: Tx) {
	return sql`
    id, root_event_id AS "rootEventId", name, locality,
    country_code AS "countryCode", latitude, longitude, version,
    created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
  `;
}

function capabilityColumns(sql: Tx) {
	return sql`
		root_event_id AS "rootEventId", event_id AS "eventId",
		capability_type AS type, schema_version AS "schemaVersion", config,
		version, created_at AS "createdAt", updated_at AS "updatedAt",
		deleted_at AS "deletedAt"
	`;
}

function recapHeadColumns(sql: Tx) {
	return sql`
		latest_version AS "latestVersion", published_version AS "publishedVersion",
		lifecycle_version AS "lifecycleVersion",
		removed_through_version AS "removedThroughVersion",
		published_at AS "publishedAt"
	`;
}

function recapSnapshotColumns(sql: Tx) {
	return sql`
		root_event_id AS "rootEventId", version,
		source_root_revision::text AS "sourceRootRevision", title,
		title_source_version AS "titleSourceVersion",
		title_source_revision::text AS "titleSourceRevision",
		generated_at AS "generatedAt"
	`;
}

function recapShareLinkColumns(sql: Tx) {
	return sql`
		id, root_event_id AS "rootEventId", recap_version AS "recapVersion",
		token_key_id AS "tokenKeyId",
		projection_consent AS "projectionConsent",
		created_by AS "createdBy",
		created_by_membership_version AS "createdByMembershipVersion",
		created_at AS "createdAt",
		expires_at AS "expiresAt", revoked_at AS "revokedAt"
	`;
}

function itineraryColumns(sql: Tx) {
	return sql`
    id, root_event_id AS "rootEventId", event_id AS "eventId", title, notes,
    time_zone AS "timeZone", starts_at AS "startsAt", ends_at AS "endsAt",
    all_day AS "allDay", sort_position::text AS "sortPosition", status, details,
    place_id AS "placeId", place_snapshot AS "placeSnapshot", version,
    created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
  `;
}

function feedEntryColumns(sql: Tx) {
	return sql`
		entry.id, entry.root_event_id AS "rootEventId", entry.event_id AS "eventId",
		entry.parent_entry_id AS "parentEntryId", entry.author_user_id AS "authorUserId",
		entry.kind, entry.payload_schema_version AS "payloadSchemaVersion",
		current.body, current.version, current.root_revision::text AS "rootRevision",
		entry.created_root_revision::text AS "createdRootRevision",
		entry.created_at AS "createdAt", current.updated_at AS "updatedAt",
		current.deleted_at AS "deletedAt", current.tombstone_reason AS "tombstoneReason"
	`;
}

function reactionColumns(sql: Tx) {
	return sql`
		root_event_id AS "rootEventId", entry_id AS "entryId", user_id AS "userId",
		reaction, present, version, root_revision::text AS "rootRevision",
		updated_at AS "updatedAt"
	`;
}

function uploadColumns(sql: Tx) {
	return sql`
		id, attachment_id AS "attachmentId", root_event_id AS "rootEventId",
		CASE target_type
			WHEN 'feed_entry' THEN jsonb_build_object(
				'kind', 'feedEntry', 'entryId', target_entry_id
			)
			ELSE jsonb_build_object(
				'kind', 'feedback', 'feedbackId', target_feedback_id
			)
		END AS target,
		target_entry_id AS "targetEntryId", created_by AS "createdBy",
		quarantine_object_key AS "quarantineObjectKey", content_type AS "contentType",
		byte_count AS "byteCount", sha256, grant_kid AS "grantKid",
		grant_ciphertext AS "grantCiphertext", state, expires_at AS "expiresAt",
		committed_at AS "committedAt", created_at AS "createdAt"
	`;
}

function attachmentColumns(sql: Tx) {
	return sql`
		id, root_event_id AS "rootEventId",
		CASE target_type
			WHEN 'feed_entry' THEN jsonb_build_object(
				'kind', 'feedEntry', 'entryId', target_entry_id
			)
			ELSE jsonb_build_object(
				'kind', 'feedback', 'feedbackId', target_feedback_id
			)
		END AS target,
		target_entry_id AS "targetEntryId",
		content_type AS "contentType", byte_count AS "byteCount", sha256, caption,
		version, root_revision::text AS "rootRevision", created_at AS "createdAt"
	`;
}

function pendingVerification(input: {
	status: AttachmentVerificationStatus;
	availableAt: Date;
	leaseUntil: Date | null;
}): AttachmentFinalizePrecondition {
	if (
		input.status !== "pending" &&
		input.status !== "processing" &&
		input.status !== "retry"
	)
		return { state: "ready" };
	const retryAt =
		input.status === "processing"
			? (input.leaseUntil ?? input.availableAt)
			: input.availableAt;
	return {
		state: input.status,
		retryAfterSeconds: Math.max(
			1,
			Math.min(30, Math.ceil((retryAt.getTime() - Date.now()) / 1_000)),
		),
	};
}

function selectedAttachmentColumns(sql: Tx) {
	return sql`
		attachment.id, attachment.root_event_id AS "rootEventId",
		CASE attachment.target_type
			WHEN 'feed_entry' THEN jsonb_build_object(
				'kind', 'feedEntry', 'entryId', attachment.target_entry_id
			)
			ELSE jsonb_build_object(
				'kind', 'feedback', 'feedbackId', attachment.target_feedback_id
			)
		END AS target,
		attachment.target_entry_id AS "targetEntryId",
		attachment.content_type AS "contentType", attachment.byte_count AS "byteCount",
		attachment.sha256, attachment.caption, attachment.version,
		attachment.root_revision::text AS "rootRevision",
		attachment.created_at AS "createdAt"
	`;
}

async function syncRootAccess(
	tx: Tx,
	rootEventId: string,
	actor: Actor,
	mode: "share" | "update",
): Promise<SyncRootAccess> {
	const lock = mode === "share" ? tx`FOR SHARE` : tx`FOR UPDATE`;
	const [root] = await tx<
		{
			rootRevision: string;
			status: "active" | "archived";
			authorizationScopeVersion: string;
			minimumSyncRevision: string;
			minimumSyncOrdinal: number;
		}[]
	>`
		SELECT revision::text AS "rootRevision", status,
			authorization_scope_version::text AS "authorizationScopeVersion",
			minimum_sync_revision::text AS "minimumSyncRevision"
			, minimum_sync_ordinal AS "minimumSyncOrdinal"
		FROM event_roots WHERE root_event_id = ${rootEventId} ${lock}
	`;
	if (!root) throw notFound();
	const membership = await requireMembership(tx, rootEventId, actor);
	if (root.status !== "active" && !isManager(membership.role)) throw notFound();
	return {
		rootRevision: root.rootRevision,
		authorizationScopeVersion: root.authorizationScopeVersion,
		minimumSyncRevision: root.minimumSyncRevision,
		minimumSyncOrdinal: root.minimumSyncOrdinal,
		role: membership.role,
	};
}

function snapshotCutBeforeMinimum(
	rootRevision: string,
	access: Pick<SyncRootAccess, "minimumSyncRevision" | "minimumSyncOrdinal">,
) {
	const revision = BigInt(rootRevision);
	const minimum = BigInt(access.minimumSyncRevision);
	return (
		revision < minimum ||
		(revision === minimum && 2_147_483_647 < access.minimumSyncOrdinal)
	);
}

async function cleanupExpiredSyncSnapshots(tx: Tx) {
	await tx`
		WITH expired AS (
			SELECT id FROM event_sync_snapshots
			WHERE expires_at <= clock_timestamp()
			ORDER BY expires_at, id
			LIMIT 100
			FOR UPDATE SKIP LOCKED
		)
		DELETE FROM event_sync_snapshots snapshot
		USING expired WHERE snapshot.id = expired.id
	`;
}

async function assertGolfSyncMutationReplaySafe(
	tx: Tx,
	actor: Actor,
	rootEventId: string,
	mutation: SyncMutation,
) {
	if (mutation.kind === "golf.round.replace") {
		const eventId = mutation.payload.eventId;
		if (typeof eventId !== "string") throw syncPayloadInvalid();
		await assertGolfRoundReplaySafe(tx, actor, rootEventId, eventId);
	}
	if (mutation.kind === "golf.score.set") {
		const eventId = mutation.payload.eventId;
		const hole = mutation.payload.hole;
		if (typeof eventId !== "string" || typeof hole !== "number")
			throw syncPayloadInvalid();
		await assertGolfScoreReplaySafe(
			tx,
			actor,
			rootEventId,
			eventId,
			mutation.entityId,
			hole,
		);
	}
}

async function assertTeamSyncMutationReplaySafe(
	tx: Tx,
	actor: Actor,
	rootEventId: string,
	mutation: SyncMutation,
) {
	if (mutation.kind === "team.assignments.publish") {
		const eventId = mutation.payload.eventId;
		if (typeof eventId !== "string") throw syncPayloadInvalid();
		await assertTeamAssignmentsReplaySafe(tx, actor, rootEventId, eventId);
	}
	if (mutation.kind === "team.decision.replace") {
		const eventId = mutation.payload.eventId;
		if (typeof eventId !== "string") throw syncPayloadInvalid();
		await assertTeamDecisionReplaySafe(
			tx,
			actor,
			rootEventId,
			eventId,
			mutation.entityId,
		);
	}
	if (mutation.kind === "team.response.set") {
		const eventId = mutation.payload.eventId;
		const decisionId = mutation.payload.decisionId;
		if (typeof eventId !== "string" || typeof decisionId !== "string")
			throw syncPayloadInvalid();
		await assertTeamResponseReplaySafe(
			tx,
			actor,
			rootEventId,
			eventId,
			decisionId,
			mutation.entityId,
		);
	}
}

function syncPayloadInvalid() {
	return new DomainError(
		400,
		"SYNC_PAYLOAD_INVALID",
		"The stored sync mutation payload is invalid.",
	);
}

async function materializeSyncSnapshot(
	tx: Tx,
	snapshotId: string,
	rootEventId: string,
	actor: Actor,
	role: Role,
): Promise<number> {
	const manager = isManager(role);
	const [result] = await tx<{ count: number }[]>`
		WITH records(entity_type, entity_id, entity_version, data) AS (
			SELECT 'event'::text, event.id, event.version,
				jsonb_build_object(
					'id', event.id, 'rootEventId', event.root_event_id,
					'parentEventId', event.parent_event_id, 'kind', event.kind,
					'title', event.title, 'description', event.description,
					'timeZone', event.time_zone, 'startsAt', event.starts_at,
					'endsAt', event.ends_at, 'sortKey', event.sort_position::text,
					'childOrderVersion', event.child_order_version,
					'itineraryOrderVersion', event.itinerary_order_version,
					'status', event.status, 'version', event.version,
					'createdAt', event.created_at, 'updatedAt', event.updated_at,
					'deletedAt', event.deleted_at
				)
			FROM events event
			WHERE event.root_event_id = ${rootEventId} AND event.deleted_at IS NULL
				AND (${manager} OR event_sync_event_is_member_visible(${rootEventId}, event.id))

			UNION ALL
			SELECT 'membership', membership.user_id, membership.version,
				jsonb_build_object(
					'rootEventId', membership.root_event_id, 'userId', membership.user_id,
					'role', membership.role, 'status', membership.status,
					'version', membership.version, 'createdAt', membership.created_at,
					'updatedAt', membership.updated_at
				)
			FROM event_memberships membership
			WHERE membership.root_event_id = ${rootEventId}
				AND (${manager} OR membership.status = 'active')

			UNION ALL
			SELECT 'invitation', invitation.id, invitation.version,
				jsonb_build_object(
					'id', invitation.id, 'rootEventId', invitation.root_event_id,
					'role', invitation.role,
					'emailBound', invitation.normalized_email_hint IS NOT NULL,
					'expiresAt', invitation.expires_at, 'maxUses', invitation.max_uses,
					'useCount', invitation.use_count, 'status', invitation.status,
					'version', invitation.version, 'createdAt', invitation.created_at,
					'updatedAt', invitation.updated_at
				)
			FROM event_invitations invitation
			WHERE invitation.root_event_id = ${rootEventId} AND ${manager}
				AND invitation.status = 'active'

			UNION ALL
			SELECT 'place', place.id, place.version,
				jsonb_build_object(
					'id', place.id, 'rootEventId', place.root_event_id,
					'name', place.name, 'locality', place.locality,
					'countryCode', place.country_code, 'latitude', place.latitude,
					'longitude', place.longitude, 'version', place.version,
					'createdAt', place.created_at, 'updatedAt', place.updated_at,
					'deletedAt', place.deleted_at
				)
			FROM event_places place
			WHERE place.root_event_id = ${rootEventId} AND place.deleted_at IS NULL
				AND (${manager} OR event_sync_place_is_member_visible(${rootEventId}, place.id))

			UNION ALL
			SELECT 'capability', capability.event_id || ':' || capability.capability_type,
				capability.version,
				jsonb_build_object(
					'rootEventId', capability.root_event_id,
					'eventId', capability.event_id, 'type', capability.capability_type,
					'schemaVersion', capability.schema_version, 'config', capability.config,
					'version', capability.version, 'createdAt', capability.created_at,
					'updatedAt', capability.updated_at, 'deletedAt', capability.deleted_at
				)
			FROM event_capabilities capability
			WHERE capability.root_event_id = ${rootEventId}
				AND capability.deleted_at IS NULL
				AND EXISTS (
					SELECT 1 FROM events event
					WHERE event.root_event_id = capability.root_event_id
						AND event.id = capability.event_id AND event.deleted_at IS NULL
				)
				AND (
					${manager} OR event_sync_capability_is_member_visible(
						${rootEventId}, capability.event_id
					)
				)

			UNION ALL
			SELECT 'itineraryItem', item.id, item.version,
				jsonb_build_object(
					'id', item.id, 'rootEventId', item.root_event_id,
					'eventId', item.event_id, 'title', item.title, 'notes', item.notes,
					'timeZone', item.time_zone, 'startsAt', item.starts_at,
					'endsAt', item.ends_at, 'allDay', item.all_day,
					'sortKey', item.sort_position::text, 'status', item.status,
					'details', item.details, 'placeId', item.place_id,
					'placeSnapshot', item.place_snapshot, 'version', item.version,
					'createdAt', item.created_at, 'updatedAt', item.updated_at,
					'deletedAt', item.deleted_at
				)
			FROM event_itinerary_items item
			WHERE item.root_event_id = ${rootEventId} AND item.deleted_at IS NULL
				AND (${manager} OR event_sync_itinerary_is_member_visible(${rootEventId}, item.id))

			UNION ALL
			SELECT 'feedEntry', entry.id, current.version,
				jsonb_build_object(
					'id', entry.id, 'rootEventId', entry.root_event_id,
					'eventId', entry.event_id, 'parentEntryId', entry.parent_entry_id,
					'actorUserId', entry.author_user_id, 'kind', entry.kind,
					'payloadSchemaVersion', entry.payload_schema_version,
					'payload', jsonb_build_object('text', current.body),
					'rootRevision', current.root_revision::text,
					'createdRootRevision', entry.created_root_revision::text,
					'version', current.version, 'createdAt', entry.created_at,
					'updatedAt', current.updated_at, 'deletedAt', current.deleted_at
				)
			FROM event_feed_entries entry
			JOIN event_feed_entry_current current
				ON current.root_event_id = entry.root_event_id AND current.entry_id = entry.id
			WHERE entry.root_event_id = ${rootEventId} AND current.deleted_at IS NULL
				AND (${manager} OR event_sync_feed_is_member_visible(${rootEventId}, entry.id))

			UNION ALL
			SELECT 'feedReaction',
				'fer_' || encode(sha256(convert_to(format(
					'["crew:feed-reaction:v1",%s,%s,%s]',
					to_json(reaction.entry_id)::text, to_json(reaction.user_id)::text,
					to_json(reaction.reaction)::text
				), 'UTF8')), 'hex'),
				reaction.version,
				jsonb_build_object(
					'entryId', reaction.entry_id, 'rootEventId', reaction.root_event_id,
					'userId', reaction.user_id, 'reaction', reaction.reaction,
					'present', true, 'version', reaction.version,
					'updatedAt', reaction.updated_at
				)
			FROM event_feed_reactions reaction
			JOIN event_feed_entry_current current
				ON current.root_event_id = reaction.root_event_id
				AND current.entry_id = reaction.entry_id AND current.deleted_at IS NULL
			WHERE reaction.root_event_id = ${rootEventId} AND reaction.present
				AND (${manager} OR event_sync_feed_is_member_visible(${rootEventId}, reaction.entry_id))

			UNION ALL
			SELECT 'attachment', attachment.id, attachment.version,
				jsonb_build_object(
					'id', attachment.id, 'rootEventId', attachment.root_event_id,
					'target', jsonb_build_object(
						'entityType', 'feedEntry', 'entityId', attachment.target_entry_id
					),
					'contentType', attachment.content_type,
					'byteCount', attachment.byte_count, 'sha256', attachment.sha256,
					'caption', attachment.caption, 'version', attachment.version,
					'createdAt', attachment.created_at
				)
			FROM event_attachments attachment
			JOIN event_feed_entry_current current
				ON current.root_event_id = attachment.root_event_id
				AND current.entry_id = attachment.target_entry_id AND current.deleted_at IS NULL
			WHERE attachment.root_event_id = ${rootEventId}
				AND attachment.target_type = 'feed_entry'
				AND (${manager} OR event_sync_feed_is_member_visible(${rootEventId}, attachment.target_entry_id))
		), numbered AS (
			SELECT entity_type, entity_id, entity_version, data,
				(row_number() OVER (ORDER BY entity_type, entity_id) - 1)::int AS ordinal
			FROM records
		), inserted AS (
			INSERT INTO event_sync_snapshot_records (
				snapshot_id, ordinal, entity_type, entity_id, entity_version, data
			)
			SELECT ${snapshotId}, ordinal, entity_type, entity_id, entity_version, data
			FROM numbered ORDER BY ordinal
			RETURNING 1
		)
		SELECT count(*)::int AS count FROM inserted
	`;
	let recordCount = result?.count ?? 0;
	const extraRecords = [
		...(await golfSnapshotRecords(tx, actor, rootEventId)),
		...(await teamSnapshotRecords(tx, actor, rootEventId)),
	].sort(
		(left, right) =>
			left.entityType.localeCompare(right.entityType) ||
			left.entityId.localeCompare(right.entityId),
	);
	for (const record of extraRecords) {
		await tx`
			INSERT INTO event_sync_snapshot_records (
				snapshot_id, ordinal, entity_type, entity_id, entity_version, data
			) VALUES (
				${snapshotId}, ${recordCount}, ${record.entityType}, ${record.entityId},
				${record.entityVersion}, ${tx.json(record.data as never)}
			)
		`;
		recordCount += 1;
	}
	if (extraRecords.length > 0) {
		await tx`
			UPDATE event_sync_snapshot_records SET ordinal = ordinal + ${recordCount}
			WHERE snapshot_id = ${snapshotId}
		`;
		await tx`
			WITH ordered AS (
				SELECT ctid,
					(row_number() OVER (ORDER BY entity_type, entity_id) - 1)::int AS ordinal
				FROM event_sync_snapshot_records WHERE snapshot_id = ${snapshotId}
			)
			UPDATE event_sync_snapshot_records record SET ordinal = ordered.ordinal
			FROM ordered WHERE record.ctid = ordered.ctid
		`;
	}
	return recordCount;
}

async function lockRoot(tx: Tx, rootEventId: string, mode: "share" | "update") {
	const lock = mode === "share" ? tx`FOR SHARE` : tx`FOR UPDATE`;
	const [root] = await tx<RootRow[]>`
		SELECT revision::text AS revision, status,
			template_id AS "templateId", template_version AS "templateVersion"
		FROM event_roots
    WHERE root_event_id = ${rootEventId} ${lock}
  `;
	if (!root) throw notFound();
	return root;
}

async function lockManagerRoot(
	tx: Tx,
	rootEventId: string,
	actor: Actor,
	mode: "share" | "update",
) {
	const root = await lockRoot(tx, rootEventId, mode);
	const membership = await requireMembership(tx, rootEventId, actor);
	if (!isManager(membership.role)) throw forbidden();
	if (mode === "update" && root.status !== "active") {
		throw conflict("ROOT_ARCHIVED", "The event root is archived.");
	}
	return root;
}

async function readPublishReadiness(
	tx: Tx,
	rootEventId: string,
): Promise<EventPublishReadiness> {
	const [context] = await tx<
		{
			rootRevision: string;
			templateId: string | null;
			templateVersion: number | null;
			title: string;
			description: string | null;
			startsAt: Date | null;
			endsAt: Date | null;
			status: EventRecord["status"];
			rootVersion: number;
		}[]
	>`
		SELECT root.revision::text AS "rootRevision",
			root.template_id AS "templateId",
			root.template_version AS "templateVersion",
			event.title, event.description, event.starts_at AS "startsAt",
			event.ends_at AS "endsAt", event.status,
			event.version AS "rootVersion"
		FROM event_roots root
		JOIN events event ON event.root_event_id = root.root_event_id
			AND event.id = root.root_event_id AND event.parent_event_id IS NULL
		WHERE root.root_event_id = ${rootEventId} AND event.deleted_at IS NULL
	`;
	if (!context) throw notFound();
	const capabilities = await tx<
		{
			eventId: string;
			type: CapabilityType;
			primaryPlaceId: string | null;
		}[]
	>`
		SELECT capability.event_id AS "eventId",
			capability.capability_type AS type,
			capability.primary_place_id AS "primaryPlaceId"
		FROM event_capabilities capability
		JOIN events event ON event.root_event_id = capability.root_event_id
			AND event.id = capability.event_id AND event.deleted_at IS NULL
		WHERE capability.root_event_id = ${rootEventId}
			AND capability.deleted_at IS NULL
		ORDER BY capability.event_id, capability.capability_type
	`;
	const reasons: EventPublishReadinessReason[] = [];
	if (!context.templateId || context.templateVersion === null) {
		reasons.push({
			code: "EVENT_TEMPLATE_REQUIRED",
			path: "template",
			message: "Choose a supported event template before publishing.",
		});
	}
	if (!context.title.trim()) {
		reasons.push({
			code: "EVENT_TITLE_REQUIRED",
			path: "title",
			message: "Add an event title before publishing.",
		});
	}
	if (!context.description?.trim()) {
		reasons.push({
			code: "EVENT_DESCRIPTION_REQUIRED",
			path: "description",
			message: "Add an event description before publishing.",
		});
	}
	if (!context.startsAt) {
		reasons.push({
			code: "EVENT_START_REQUIRED",
			path: "startsAt",
			message: "Choose an event start before publishing.",
		});
	}
	if (!context.endsAt) {
		reasons.push({
			code: "EVENT_END_REQUIRED",
			path: "endsAt",
			message: "Choose an event end before publishing.",
		});
	}
	if (capabilities.length === 0) {
		const template = EVENT_TEMPLATES.find(
			(item) =>
				item.id === context.templateId &&
				item.version === context.templateVersion,
		);
		const rootCapabilities = template?.events.find(
			(event) => event.logicalKey === "root",
		)?.capabilities;
		const capability =
			rootCapabilities?.length === 1 ? rootCapabilities[0] : null;
		const [storedCapability] = capability
			? await tx<{ version: number }[]>`
				SELECT version FROM event_capabilities
				WHERE root_event_id = ${rootEventId} AND event_id = ${rootEventId}
					AND capability_type = ${capability.type}
			`
			: [];
		reasons.push({
			code: "EVENT_CAPABILITY_REQUIRED",
			path: "capabilities",
			message: "Configure at least one event capability before publishing.",
			...(capability
				? {
						meta: {
							eventId: rootEventId,
							capabilityType: capability.type,
							capabilityVersion: storedCapability?.version ?? 0,
						},
					}
				: {}),
		});
	}
	for (const capability of capabilities) {
		if (capability.primaryPlaceId) continue;
		reasons.push({
			code: "EVENT_CAPABILITY_PLACE_REQUIRED",
			path: `events.${capability.eventId}.capabilities.${capability.type}.placeId`,
			message: "Choose the capability place before publishing.",
			meta: {
				eventId: capability.eventId,
				capabilityType: capability.type,
			},
		});
	}
	if (context.status !== "draft") {
		reasons.push({
			code: "EVENT_STATUS_NOT_DRAFT",
			path: "status",
			message: "Only a draft root event can be published.",
		});
	}
	return {
		schemaVersion: 1,
		rootEventId,
		rootStatus: context.status,
		rootVersion: context.rootVersion,
		rootRevision: context.rootRevision,
		template:
			context.templateId && context.templateVersion !== null
				? { id: context.templateId, version: context.templateVersion }
				: null,
		ready: reasons.length === 0,
		reasons,
	};
}

async function requiredPlaceEnrichmentKind(
	tx: Tx,
	scope: PlaceEnrichmentScope,
): Promise<PlaceCandidateKind> {
	const readiness = await readPublishReadiness(tx, scope.rootEventId);
	const required = readiness.reasons.some(
		(reason) =>
			reason.code === "EVENT_CAPABILITY_PLACE_REQUIRED" &&
			reason.meta?.eventId === scope.eventId &&
			reason.meta.capabilityType === scope.capabilityType,
	);
	if (!required) {
		throw new DomainError(
			409,
			"PLACE_ENRICHMENT_SCOPE_INVALID",
			"Place enrichment is not available for this event capability.",
		);
	}
	return scope.capabilityType === "golf" ? "golf_course" : "venue";
}

async function requirePlaceEnrichmentCreateScope(
	tx: Tx,
	actor: Actor,
	scope: PlaceEnrichmentScope,
	mode: "share" | "update",
) {
	const root = await lockManagerRoot(tx, scope.rootEventId, actor, mode);
	if (root.status !== "active") throw notFound();
	return requiredPlaceEnrichmentKind(tx, scope);
}

async function findRecapHead(tx: Tx, rootEventId: string, lock: boolean) {
	const suffix = lock ? tx`FOR UPDATE` : tx``;
	const [head] = await tx<RecapHeadRow[]>`
		SELECT ${recapHeadColumns(tx)} FROM event_recap_heads
		WHERE root_event_id = ${rootEventId} ${suffix}
	`;
	return head ?? null;
}

async function findRecapSnapshot(tx: Tx, rootEventId: string, version: number) {
	const [snapshot] = await tx<RecapSnapshotRow[]>`
		SELECT ${recapSnapshotColumns(tx)} FROM event_recap_snapshots
		WHERE root_event_id = ${rootEventId} AND version = ${version}
	`;
	return snapshot ?? null;
}

async function findRecapShareLinkById(
	tx: Tx,
	rootEventId: string,
	shareLinkId: string,
	lock = false,
) {
	const suffix = lock ? tx`FOR UPDATE` : tx``;
	const [link] = await tx<RecapShareLinkRow[]>`
		SELECT ${recapShareLinkColumns(tx)},
			expires_at > clock_timestamp() AS unexpired
		FROM event_recap_share_links
		WHERE root_event_id = ${rootEventId} AND id = ${shareLinkId}
		${suffix}
	`;
	return link ?? null;
}

async function findRecapShareLinkByTokenHash(tx: Tx, tokenHash: string) {
	const [link] = await tx<RecapShareLinkRow[]>`
		SELECT ${recapShareLinkColumns(tx)},
			expires_at > clock_timestamp() AS unexpired
		FROM event_recap_share_links
		WHERE token_hash = ${tokenHash}
	`;
	return link ?? null;
}

async function insertRecapExternalShareAudit(
	tx: Tx,
	rootEventId: string,
	linkId: string,
	action: "create" | "rotate" | "revoke",
	actor: Actor,
	occurredAt?: Date,
) {
	if (occurredAt) {
		await tx`
			INSERT INTO event_recap_external_share_audit_events (
				root_event_id, link_id, action, actor_id, occurred_at
			) VALUES (${rootEventId}, ${linkId}, ${action}, ${actor.id}, ${occurredAt})
		`;
		return;
	}
	await tx`
		INSERT INTO event_recap_external_share_audit_events (
			root_event_id, link_id, action, actor_id
		) VALUES (${rootEventId}, ${linkId}, ${action}, ${actor.id})
	`;
}

async function rotateActiveRecapShareLinks(
	tx: Tx,
	rootEventId: string,
	actor: Actor,
	revokedAt: Date,
) {
	const rotated = await tx<
		Array<{
			id: string;
			projectionConsent: RecapShareLinkRow["projectionConsent"];
		}>
	>`
		UPDATE event_recap_share_links
		SET revoked_at = ${revokedAt}, revoked_by = ${actor.id}
		WHERE root_event_id = ${rootEventId} AND revoked_at IS NULL
		RETURNING id, projection_consent AS "projectionConsent"
	`;
	for (const link of rotated) {
		if (link.projectionConsent !== "exact-fields-reviewed-v1") continue;
		await insertRecapExternalShareAudit(
			tx,
			rootEventId,
			link.id,
			"rotate",
			actor,
			revokedAt,
		);
	}
}

async function readRecapEventSource(
	tx: Tx,
	rootEventId: string,
	eventId: string,
) {
	const [source] = await tx<RecapEventSource[]>`
		SELECT event.id AS "sourceId", event.version AS "sourceVersion",
			change.root_revision::text AS "sourceRevision",
			event.title AS "sourceTitle", event.description AS "sourceBody"
		FROM events event
		JOIN LATERAL (
			SELECT root_revision FROM event_root_changes
			WHERE root_event_id = event.root_event_id
				AND entity_type = 'event' AND entity_id = event.id
				AND entity_version = event.version AND operation = 'upsert'
			ORDER BY root_revision DESC, ordinal DESC LIMIT 1
		) change ON TRUE
		WHERE event.root_event_id = ${rootEventId} AND event.id = ${eventId}
			AND event.deleted_at IS NULL AND event.status = 'published'
			AND event_sync_event_is_member_visible(event.root_event_id, event.id)
	`;
	return source ?? null;
}

async function readRecapFeedSource(
	tx: Tx,
	rootEventId: string,
	entryId: string,
) {
	const [source] = await tx<RecapFeedSource[]>`
		SELECT entry.id AS "sourceId", current.version AS "sourceVersion",
			current.root_revision::text AS "sourceRevision",
			current.body AS "sourceBody", entry.author_user_id AS "authorUserId",
			COALESCE(consent.status = 'active', false) AS "consentActive",
			consent.version AS "consentMembershipVersion"
		FROM event_feed_entries entry
		JOIN event_feed_entry_current current
			ON current.root_event_id = entry.root_event_id
			AND current.entry_id = entry.id
		LEFT JOIN event_memberships consent
			ON consent.root_event_id = entry.root_event_id
			AND consent.user_id = entry.author_user_id
		WHERE entry.root_event_id = ${rootEventId} AND entry.id = ${entryId}
			AND entry.kind IN ('message', 'comment')
			AND entry.author_user_id IS NOT NULL
			AND current.deleted_at IS NULL AND current.body IS NOT NULL
			AND event_sync_feed_is_member_visible(entry.root_event_id, entry.id)
	`;
	return source ?? null;
}

async function materializeRecapSource(
	tx: Tx,
	actor: Actor,
	rootEventId: string,
	ordinal: number,
	input: RecapSourceInput,
): Promise<{ item: RecapSourceProjection } | { issue: RecapSourceIssue }> {
	if (input.type === "event") {
		const source = await readRecapEventSource(tx, rootEventId, input.sourceId);
		if (!source)
			return { issue: recapSourceIssue(ordinal, "RECAP_SOURCE_UNAVAILABLE") };
		if (source.sourceVersion !== input.sourceVersion)
			return {
				issue: recapSourceIssue(ordinal, "RECAP_SOURCE_VERSION_CHANGED"),
			};
		if ((source.sourceBody?.length ?? 0) > RECAP_SOURCE_BODY_LIMIT)
			return {
				issue: recapSourceIssue(ordinal, "RECAP_SOURCE_CONTENT_TOO_LARGE"),
			};
		return {
			item: {
				ordinal,
				sourceType: "event",
				sourceId: source.sourceId,
				sourceVersion: source.sourceVersion,
				sourceRevision: source.sourceRevision,
				sourceVisibility: "members",
				consentBasis: "event-publication",
				consentedByUserId: null,
				consentMembershipVersion: null,
				sourceTitle: source.sourceTitle,
				sourceBody: source.sourceBody || null,
			},
		};
	}

	const source = await readRecapFeedSource(tx, rootEventId, input.sourceId);
	if (!source)
		return { issue: recapSourceIssue(ordinal, "RECAP_SOURCE_UNAVAILABLE") };
	if (source.sourceVersion !== input.sourceVersion)
		return {
			issue: recapSourceIssue(ordinal, "RECAP_SOURCE_VERSION_CHANGED"),
		};
	if (
		source.authorUserId !== actor.id ||
		!source.consentActive ||
		source.consentMembershipVersion === null
	)
		return {
			issue: recapSourceIssue(ordinal, "RECAP_SOURCE_CONSENT_REQUIRED"),
		};
	if (source.sourceBody.length > RECAP_SOURCE_BODY_LIMIT)
		return {
			issue: recapSourceIssue(ordinal, "RECAP_SOURCE_CONTENT_TOO_LARGE"),
		};
	return {
		item: {
			ordinal,
			sourceType: "feedEntry",
			sourceId: source.sourceId,
			sourceVersion: source.sourceVersion,
			sourceRevision: source.sourceRevision,
			sourceVisibility: "members",
			consentBasis: "source-author",
			consentedByUserId: actor.id,
			consentMembershipVersion: source.consentMembershipVersion,
			sourceTitle: null,
			sourceBody: source.sourceBody,
		},
	};
}

async function validateRecapSnapshot(
	tx: Tx,
	rootEventId: string,
	snapshot: RecapSnapshotRow,
) {
	const title = await readRecapEventSource(tx, rootEventId, rootEventId);
	const titleValid =
		title?.sourceVersion === snapshot.titleSourceVersion &&
		title.sourceRevision === snapshot.titleSourceRevision &&
		title.sourceTitle === snapshot.title;
	const rows = await tx<RecapItemRow[]>`
		SELECT ordinal, source_type AS "sourceType", source_id AS "sourceId",
			source_version AS "sourceVersion",
			source_revision::text AS "sourceRevision",
			source_visibility AS "sourceVisibility", consent_basis AS "consentBasis",
			consented_by_user_id AS "consentedByUserId",
			consent_membership_version AS "consentMembershipVersion",
			source_title AS "sourceTitle", source_body AS "sourceBody"
		FROM event_recap_items
		WHERE root_event_id = ${rootEventId} AND recap_version = ${snapshot.version}
		ORDER BY ordinal
	`;
	const items: RecapItemRow[] = [];
	const issues: RecapSourceIssue[] = [];
	for (const row of rows) {
		if (row.sourceType === "event") {
			const current = await readRecapEventSource(tx, rootEventId, row.sourceId);
			if (!current) {
				issues.push(
					recapSourceIssue(row.ordinal, "RECAP_SOURCE_UNAVAILABLE", "items"),
				);
				continue;
			}
			if (
				current.sourceVersion !== row.sourceVersion ||
				current.sourceRevision !== row.sourceRevision ||
				current.sourceTitle !== row.sourceTitle ||
				(current.sourceBody || null) !== row.sourceBody
			) {
				issues.push(
					recapSourceIssue(
						row.ordinal,
						"RECAP_SOURCE_VERSION_CHANGED",
						"items",
					),
				);
				continue;
			}
			items.push(row);
			continue;
		}

		const current = await readRecapFeedSource(tx, rootEventId, row.sourceId);
		if (!current) {
			issues.push(
				recapSourceIssue(row.ordinal, "RECAP_SOURCE_UNAVAILABLE", "items"),
			);
			continue;
		}
		if (
			!current.consentActive ||
			current.authorUserId !== row.consentedByUserId ||
			row.consentMembershipVersion === null ||
			row.consentMembershipVersion <= 0 ||
			current.consentMembershipVersion !== row.consentMembershipVersion
		) {
			issues.push(
				recapSourceIssue(row.ordinal, "RECAP_SOURCE_CONSENT_REQUIRED", "items"),
			);
			continue;
		}
		if (
			current.sourceVersion !== row.sourceVersion ||
			current.sourceRevision !== row.sourceRevision ||
			current.sourceBody !== row.sourceBody
		) {
			issues.push(
				recapSourceIssue(row.ordinal, "RECAP_SOURCE_VERSION_CHANGED", "items"),
			);
			continue;
		}
		items.push(row);
	}
	return { titleValid, items, issues };
}

async function requireCurrentPublishedRecap(
	tx: Tx,
	rootEventId: string,
	recapVersion: number,
) {
	const head = await findRecapHead(tx, rootEventId, false);
	if (
		!head ||
		head.publishedVersion !== recapVersion ||
		recapVersion <= head.removedThroughVersion ||
		head.publishedAt === null
	)
		throw notFound();
	const snapshot = await findRecapSnapshot(tx, rootEventId, recapVersion);
	if (!snapshot) throw notFound();
	const validation = await validateRecapSnapshot(tx, rootEventId, snapshot);
	if (!validation.titleValid || validation.issues.length) throw notFound();
	return { snapshot, head, validation };
}

function recapExternalFieldKey(field: RecapExternalField) {
	return field.field === "body"
		? `${field.sourceType}:${field.sourceId}:${field.sourceVersion}:body`
		: `${field.sourceType}:${field.sourceId}:${field.sourceVersion}:caption:${field.fieldRef}`;
}

function captionStorageFieldName(attachmentId: string, version: number) {
	return `caption|${attachmentId}|${version}`;
}

function parseCaptionStorageFieldName(fieldName: string) {
	const match = /^caption\|(att_[A-Za-z0-9._:-]{1,96})\|([1-9][0-9]*)$/.exec(
		fieldName,
	);
	if (!match) return null;
	const version = Number(match[2]);
	return match[1] && Number.isSafeInteger(version) && version > 0
		? { attachmentId: match[1], version }
		: null;
}

async function readRecapCaptions(
	tx: Tx,
	rootEventId: string,
	sourceRootRevision: string,
	entryIds: string[],
): Promise<RecapCaptionRow[]> {
	if (!entryIds.length) return [];
	return tx<RecapCaptionRow[]>`
		SELECT id, target_entry_id AS "targetEntryId", version,
			root_revision::text AS "rootRevision", created_by AS "createdBy", caption
		FROM event_attachments
		WHERE root_event_id = ${rootEventId} AND target_type = 'feed_entry'
			AND target_entry_id IN ${tx(entryIds)} AND caption IS NOT NULL
			AND root_revision <= ${sourceRootRevision}::bigint
		ORDER BY target_entry_id, root_revision, id
	`;
}

async function requireRecapExternalField(
	tx: Tx,
	items: RecapItemRow[],
	snapshot: RecapSnapshotRow,
	field: RecapExternalField,
	captionPolicy?: {
		enabled: boolean;
		fieldRefs: RecapCaptionFieldRefCodec;
	},
): Promise<RecapExternalFieldTarget> {
	const item = items.find(
		(candidate) =>
			candidate.sourceType === field.sourceType &&
			candidate.sourceId === field.sourceId &&
			candidate.sourceVersion === field.sourceVersion,
	);
	if (!item) throw notFound();
	if (field.field === "body") {
		if (item.sourceBody === null) throw notFound();
		return { field: "body", item, storageFieldName: "body" };
	}
	if (item.sourceType !== "feedEntry" || !captionPolicy?.enabled)
		throw notFound();
	const captions = await readRecapCaptions(
		tx,
		snapshot.rootEventId,
		snapshot.sourceRootRevision,
		[item.sourceId],
	);
	const match = captions.find((attachment) =>
		captionPolicy.fieldRefs.matches(
			field.fieldRef,
			captionFieldRefInput(snapshot, item, attachment),
		),
	);
	if (!match) throw notFound();
	const attachmentOrdinal = captions.indexOf(match);
	return {
		field: "caption",
		item,
		attachment: match,
		attachmentOrdinal,
		storageFieldName: captionStorageFieldName(match.id, match.version),
	};
}

function captionFieldRefInput(
	snapshot: RecapSnapshotRow,
	item: RecapItemRow,
	attachment: RecapCaptionRow,
): RecapCaptionFieldRefInput {
	if (item.sourceType !== "feedEntry")
		throw new Error("Caption source invariant");
	return {
		rootEventId: snapshot.rootEventId,
		recapVersion: snapshot.version,
		recapOrdinal: item.ordinal,
		sourceType: "feedEntry",
		sourceId: item.sourceId,
		sourceVersion: item.sourceVersion,
		attachmentId: attachment.id,
		attachmentVersion: attachment.version,
		attachmentRootRevision: attachment.rootRevision,
		attachmentCreatedBy: attachment.createdBy,
		caption: attachment.caption,
	};
}

async function requireStoredRecapExternalField(
	tx: Tx,
	items: RecapItemRow[],
	snapshot: RecapSnapshotRow,
	field: RecapExternalShareFieldRow,
): Promise<RecapExternalFieldTarget> {
	const item = items.find(
		(candidate) =>
			candidate.ordinal === field.recapOrdinal &&
			candidate.sourceType === field.sourceType &&
			candidate.sourceId === field.sourceId &&
			candidate.sourceVersion === field.sourceVersion,
	);
	if (!item) throw notFound();
	if (field.fieldName === "body") {
		if (item.sourceBody === null) throw notFound();
		return { field: "body", item, storageFieldName: "body" };
	}
	const stored = parseCaptionStorageFieldName(field.fieldName);
	if (!stored || item.sourceType !== "feedEntry") throw notFound();
	const [attachment] = await tx<RecapCaptionRow[]>`
		SELECT id, target_entry_id AS "targetEntryId", version,
			root_revision::text AS "rootRevision", created_by AS "createdBy", caption
		FROM event_attachments
		WHERE root_event_id = ${snapshot.rootEventId}
			AND target_type = 'feed_entry' AND target_entry_id = ${item.sourceId}
			AND id = ${stored.attachmentId} AND version = ${stored.version}
			AND caption IS NOT NULL
			AND root_revision <= ${snapshot.sourceRootRevision}::bigint
	`;
	if (!attachment) throw notFound();
	return {
		field: "caption",
		item,
		attachment,
		attachmentOrdinal: -1,
		storageFieldName: field.fieldName,
	};
}

async function requireRecapExternalGrantAuthority(
	tx: Tx,
	actor: Actor,
	rootEventId: string,
	target: RecapExternalFieldTarget,
	authority: "author" | "manager",
) {
	const membership = await requireMembership(tx, rootEventId, actor);
	if (authority === "manager") {
		if (!isManager(membership.role)) throw notFound();
		return membership;
	}
	const authorId =
		target.field === "caption"
			? target.attachment.createdBy
			: target.item.consentedByUserId;
	if (target.item.sourceType !== "feedEntry" || authorId !== actor.id)
		throw notFound();
	if (
		target.field === "body" &&
		target.item.consentMembershipVersion !== membership.version
	)
		throw notFound();
	return membership;
}

async function findLatestRecapExternalGrantDecision(
	tx: Tx,
	rootEventId: string,
	recapVersion: number,
	target: RecapExternalFieldTarget,
	authority: "author" | "manager",
) {
	const [decision] = await tx<RecapExternalGrantDecisionRow[]>`
		SELECT grant_decision.id::text AS id, recap_ordinal AS "recapOrdinal",
			source_type AS "sourceType", source_id AS "sourceId",
			source_version AS "sourceVersion", field_name AS "fieldName",
			authority, decision,
			actor_id AS "actorId",
			actor_membership_version AS "actorMembershipVersion"
		FROM event_recap_external_grant_decisions grant_decision
		WHERE root_event_id = ${rootEventId}
			AND recap_version = ${recapVersion}
			AND recap_ordinal = ${target.item.ordinal}
			AND source_type = ${target.item.sourceType}
			AND source_id = ${target.item.sourceId}
			AND source_version = ${target.item.sourceVersion}
			AND field_name = ${target.storageFieldName} AND authority = ${authority}
		ORDER BY grant_decision.id DESC LIMIT 1
	`;
	return decision ?? null;
}

async function readRecapExternalConsent(
	tx: Tx,
	actor: Actor,
	membership: MembershipRecord,
	rootEventId: string,
	recapVersion: number,
	snapshot: RecapSnapshotRow,
	items: RecapItemRow[],
	captionPolicy?: {
		enabled: boolean;
		fieldRefs: RecapCaptionFieldRefCodec;
	},
): Promise<EventRecapExternalConsent> {
	const captions = captionPolicy?.enabled
		? await readRecapCaptions(
				tx,
				rootEventId,
				snapshot.sourceRootRevision,
				items.flatMap((item) =>
					item.sourceType === "feedEntry" ? [item.sourceId] : [],
				),
			)
		: [];
	const decisions = await tx<RecapExternalGrantReadRow[]>`
		WITH latest AS (
			SELECT DISTINCT ON (recap_ordinal, field_name, authority)
				grant_decision.id, recap_ordinal, source_type, source_id,
				source_version, field_name, authority, decision, actor_id,
				actor_membership_version
			FROM event_recap_external_grant_decisions grant_decision
			WHERE root_event_id = ${rootEventId}
				AND recap_version = ${recapVersion}
			ORDER BY recap_ordinal, field_name, authority, grant_decision.id DESC
		)
		SELECT latest.id::text AS id, recap_ordinal AS "recapOrdinal",
			source_type AS "sourceType", source_id AS "sourceId",
			source_version AS "sourceVersion", field_name AS "fieldName",
			authority, decision,
			actor_id AS "actorId",
			actor_membership_version AS "actorMembershipVersion",
			membership.role AS "membershipRole",
			membership.status AS "membershipStatus",
			membership.version AS "currentMembershipVersion"
		FROM latest
		LEFT JOIN event_memberships membership
			ON membership.root_event_id = ${rootEventId}
			AND membership.user_id = latest.actor_id
		ORDER BY recap_ordinal, field_name, authority
	`;
	const byFieldAuthority = new Map(
		decisions.map((decision) => [
			`${decision.recapOrdinal}:${decision.fieldName}:${decision.authority}`,
			decision,
		]),
	);
	const captionsByEntry = new Map<string, RecapCaptionRow[]>();
	for (const caption of captions) {
		const current = captionsByEntry.get(caption.targetEntryId) ?? [];
		current.push(caption);
		captionsByEntry.set(caption.targetEntryId, current);
	}
	return {
		fields: items.flatMap((item) => {
			const targets: RecapExternalFieldTarget[] = [];
			if (item.sourceBody !== null)
				targets.push({ field: "body", item, storageFieldName: "body" });
			for (const [attachmentOrdinal, attachment] of (
				captionsByEntry.get(item.sourceId) ?? []
			).entries())
				targets.push({
					field: "caption",
					item,
					attachment,
					attachmentOrdinal,
					storageFieldName: captionStorageFieldName(
						attachment.id,
						attachment.version,
					),
				});
			return targets.map((target) => {
				const requiredAuthorities: Array<"author" | "manager"> =
					target.field === "body" && item.sourceType === "event"
						? ["manager"]
						: ["author", "manager"];
				const actorCanDecide: Array<"author" | "manager"> = [];
				const authorId =
					target.field === "caption"
						? target.attachment.createdBy
						: item.consentedByUserId;
				if (
					item.sourceType === "feedEntry" &&
					authorId === actor.id &&
					(target.field === "caption" ||
						item.consentMembershipVersion === membership.version)
				)
					actorCanDecide.push("author");
				if (isManager(membership.role)) actorCanDecide.push("manager");
				const common = {
					ordinal: item.ordinal,
					requiredAuthorities,
					authorDecision: currentRecapExternalDecision(
						target,
						byFieldAuthority.get(
							`${item.ordinal}:${target.storageFieldName}:author`,
						) ?? null,
					),
					managerDecision: currentRecapExternalDecision(
						target,
						byFieldAuthority.get(
							`${item.ordinal}:${target.storageFieldName}:manager`,
						) ?? null,
					),
					actorCanDecide,
				};
				return target.field === "body"
					? { ...common, field: "body" as const }
					: {
							...common,
							field: "caption" as const,
							fieldRef: issueCaptionFieldRef(
								captionPolicy,
								snapshot,
								item,
								target.attachment,
							),
							attachmentOrdinal: target.attachmentOrdinal,
							attachmentVersion: target.attachment.version,
							caption: target.attachment.caption,
						};
			});
		}),
	};
}

function issueCaptionFieldRef(
	captionPolicy:
		| { enabled: boolean; fieldRefs: RecapCaptionFieldRefCodec }
		| undefined,
	snapshot: RecapSnapshotRow,
	item: RecapItemRow,
	attachment: RecapCaptionRow,
) {
	if (!captionPolicy?.enabled) throw new Error("Caption policy invariant");
	return captionPolicy.fieldRefs.issue(
		captionFieldRefInput(snapshot, item, attachment),
	);
}

function currentRecapExternalDecision(
	target: RecapExternalFieldTarget,
	decision: RecapExternalGrantReadRow | null,
): RecapExternalDecisionState {
	if (
		decision?.membershipStatus !== "active" ||
		decision.currentMembershipVersion !== decision.actorMembershipVersion
	)
		return "unknown";
	if (decision.authority === "manager")
		return decision.membershipRole && isManager(decision.membershipRole)
			? decision.decision
			: "unknown";
	const authorId =
		target.field === "caption"
			? target.attachment.createdBy
			: target.item.consentedByUserId;
	return target.item.sourceType === "feedEntry" &&
		authorId === decision.actorId &&
		(target.field === "caption" ||
			target.item.consentMembershipVersion === decision.actorMembershipVersion)
		? decision.decision
		: "unknown";
}

async function isCurrentRecapExternalGrant(
	tx: Tx,
	rootEventId: string,
	target: RecapExternalFieldTarget,
	decision: RecapExternalGrantDecisionRow | null,
) {
	if (decision?.decision !== "grant") return false;
	const membership = await findMembership(
		tx,
		rootEventId,
		decision.actorId,
		false,
	);
	if (
		membership?.status !== "active" ||
		membership.version !== decision.actorMembershipVersion
	)
		return false;
	if (decision.authority === "manager") return isManager(membership.role);
	const authorId =
		target.field === "caption"
			? target.attachment.createdBy
			: target.item.consentedByUserId;
	return (
		target.item.sourceType === "feedEntry" &&
		authorId === decision.actorId &&
		(target.field === "caption" ||
			target.item.consentMembershipVersion === membership.version)
	);
}

async function validateRecapExternalFieldGrants(
	tx: Tx,
	rootEventId: string,
	recapVersion: number,
	target: RecapExternalFieldTarget,
) {
	const manager = await findLatestRecapExternalGrantDecision(
		tx,
		rootEventId,
		recapVersion,
		target,
		"manager",
	);
	if (!(await isCurrentRecapExternalGrant(tx, rootEventId, target, manager)))
		throw notFound();
	if (target.field === "body" && target.item.sourceType === "event") return;
	const author = await findLatestRecapExternalGrantDecision(
		tx,
		rootEventId,
		recapVersion,
		target,
		"author",
	);
	if (!(await isCurrentRecapExternalGrant(tx, rootEventId, target, author)))
		throw notFound();
}

async function readRecapExternalShareFields(tx: Tx, link: RecapShareLinkRow) {
	return tx<RecapExternalShareFieldRow[]>`
		SELECT recap_ordinal AS "recapOrdinal", source_type AS "sourceType",
			source_id AS "sourceId", source_version AS "sourceVersion",
			field_name AS "fieldName"
		FROM event_recap_external_share_fields
		WHERE link_id = ${link.id} AND root_event_id = ${link.rootEventId}
			AND recap_version = ${link.recapVersion}
		ORDER BY recap_ordinal, field_name
	`;
}

async function validateRecapShareLinkBase(
	tx: Tx,
	link: RecapShareLinkRow,
	projectionConsent: "title-only-reviewed" | "exact-fields-reviewed-v1",
) {
	if (
		link.revokedAt !== null ||
		!link.unexpired ||
		link.projectionConsent !== projectionConsent
	)
		throw notFound();
	const creator = await findMembership(
		tx,
		link.rootEventId,
		link.createdBy,
		false,
	);
	if (creator?.status !== "active" || !isManager(creator.role))
		throw notFound();
	if (
		projectionConsent === "exact-fields-reviewed-v1" &&
		creator.version !== link.createdByMembershipVersion
	)
		throw notFound();
	return requireCurrentPublishedRecap(tx, link.rootEventId, link.recapVersion);
}

async function validateRecapShareLinkPolicy(tx: Tx, link: RecapShareLinkRow) {
	return validateRecapShareLinkBase(tx, link, "title-only-reviewed");
}

async function validateRecapExternalShareLinkPolicy(
	tx: Tx,
	link: RecapShareLinkRow,
	captionsEnabled: boolean,
) {
	const context = await validateRecapShareLinkBase(
		tx,
		link,
		"exact-fields-reviewed-v1",
	);
	const fields = await readRecapExternalShareFields(tx, link);
	if (!fields.length || fields.length > RECAP_SOURCE_LIMIT) throw notFound();
	if (
		!captionsEnabled &&
		fields.some((field) => parseCaptionStorageFieldName(field.fieldName))
	)
		throw notFound();
	const targets: RecapExternalFieldTarget[] = [];
	for (const field of fields) {
		const target = await requireStoredRecapExternalField(
			tx,
			context.validation.items,
			context.snapshot,
			field,
		);
		await validateRecapExternalFieldGrants(
			tx,
			link.rootEventId,
			link.recapVersion,
			target,
		);
		targets.push(target);
	}
	return { ...context, targets };
}

async function validateAnyRecapShareLinkPolicy(
	tx: Tx,
	link: RecapShareLinkRow,
	captionsEnabled: boolean,
) {
	return link.projectionConsent === "exact-fields-reviewed-v1"
		? validateRecapExternalShareLinkPolicy(tx, link, captionsEnabled)
		: validateRecapShareLinkPolicy(tx, link);
}

function recapShareLink(row: RecapShareLinkRow): EventRecapShareLink {
	return {
		id: row.id,
		recapVersion: row.recapVersion,
		createdAt: row.createdAt,
		expiresAt: row.expiresAt,
	};
}

function recapShare(
	snapshot: RecapSnapshotRow,
	validation: Awaited<ReturnType<typeof validateRecapSnapshot>>,
): EventRecapShare {
	return {
		title: snapshot.title,
		items: validation.items
			.flatMap((item) => (item.sourceTitle === null ? [] : [item.sourceTitle]))
			.map((title, ordinal) => ({ ordinal, title })),
	};
}

function recapExternalShare(
	snapshot: RecapSnapshotRow,
	validation: Awaited<ReturnType<typeof validateRecapSnapshot>>,
	targets: RecapExternalFieldTarget[],
): EventRecapExternalShare {
	const projected = validation.items.flatMap((item) => {
		const itemTargets = targets.filter(
			(target) => target.item.ordinal === item.ordinal,
		);
		const bodySelected = itemTargets.some((target) => target.field === "body");
		const captions = itemTargets
			.flatMap((target) =>
				target.field === "caption" ? [target.attachment] : [],
			)
			.sort(
				(left, right) =>
					Number(BigInt(left.rootRevision) - BigInt(right.rootRevision)) ||
					left.id.localeCompare(right.id),
			)
			.map((attachment) => attachment.caption);
		if (item.sourceType === "feedEntry" && !bodySelected && !captions.length)
			return [];
		const title = item.sourceType === "event" ? item.sourceTitle : null;
		const body = bodySelected ? item.sourceBody : null;
		if (title === null && body === null && !captions.length) throw notFound();
		return [{ title, body, captions }];
	});
	return {
		title: snapshot.title,
		items: projected.map((item, ordinal) => ({ ordinal, ...item })),
	};
}

async function projectRecap(
	tx: Tx,
	rootEventId: string,
	snapshot: RecapSnapshotRow,
	head: RecapHeadRow,
) {
	const validation = await validateRecapSnapshot(tx, rootEventId, snapshot);
	if (!validation.titleValid) throw notFound();
	return recapFromValidation(snapshot, head, validation);
}

function recapFromValidation(
	snapshot: RecapSnapshotRow,
	head: RecapHeadRow,
	validation: Awaited<ReturnType<typeof validateRecapSnapshot>>,
): EventRecap {
	const published = snapshot.version === head.publishedVersion;
	return {
		schemaVersion: 1,
		rootEventId: snapshot.rootEventId,
		version: snapshot.version,
		lifecycleVersion: head.lifecycleVersion,
		state: published ? "published" : "draft",
		publishedVersion: head.publishedVersion,
		sourceRootRevision: snapshot.sourceRootRevision,
		generatedAt: snapshot.generatedAt,
		publishedAt: published ? head.publishedAt : null,
		title: snapshot.title,
		titleProvenance: {
			sourceType: "event",
			sourceId: snapshot.rootEventId,
			sourceVersion: snapshot.titleSourceVersion,
			sourceRevision: snapshot.titleSourceRevision,
			visibility: "members",
			consentBasis: "event-publication",
		},
		items: validation.items.map(recapItem),
	};
}

function recapItem(row: RecapItemRow): EventRecapItem {
	const common = {
		sourceId: row.sourceId,
		sourceVersion: row.sourceVersion,
		sourceRevision: row.sourceRevision,
		visibility: row.sourceVisibility,
	};
	const provenance: EventRecapProvenance =
		row.sourceType === "event"
			? {
					...common,
					sourceType: "event",
					consentBasis: "event-publication",
				}
			: {
					...common,
					sourceType: "feedEntry",
					consentBasis: "source-author",
				};
	return {
		ordinal: row.ordinal,
		sourceTitle: row.sourceTitle,
		sourceBody: row.sourceBody,
		provenance,
	};
}

async function lockReadableRoot(
	tx: Tx,
	rootEventId: string,
	actor: Actor,
	mode: "share" | "update",
) {
	const root = await lockRoot(tx, rootEventId, mode);
	await requireMembership(tx, rootEventId, actor);
	return root;
}

async function lockWritableRoot(
	tx: Tx,
	rootEventId: string,
	actor: Actor,
	level: "manager" | "owner",
	allowArchived = false,
) {
	const root = await lockRoot(tx, rootEventId, "update");
	const membership = await requireMembership(tx, rootEventId, actor);
	if (!allowArchived && root.status !== "active") {
		throw conflict("ROOT_ARCHIVED", "The event root is archived.");
	}
	if (
		level === "owner"
			? membership.role !== "owner"
			: !isManager(membership.role)
	)
		throw forbidden();
	return membership;
}

async function lockFeedWriter(tx: Tx, rootEventId: string, actor: Actor) {
	const root = await lockRoot(tx, rootEventId, "update");
	const membership = await requireMembership(tx, rootEventId, actor);
	if (root.status !== "active")
		throw conflict("ROOT_ARCHIVED", "The event root is archived.");
	if (membership.role === "viewer") throw forbidden();
	return membership;
}

type AttachmentRootContext = {
	root: RootRow;
	membership: MembershipRecord;
};

async function lockFeedbackAttachmentId(tx: Tx, feedbackId: string) {
	await tx`SELECT pg_advisory_xact_lock(hashtextextended(${feedbackId}, 0))`;
}

async function lockAttachmentRoot(
	tx: Tx,
	actor: Actor,
	rootEventId: string,
): Promise<AttachmentRootContext> {
	const root = await lockRoot(tx, rootEventId, "update");
	const membership = await requireMembership(tx, rootEventId, actor);
	if (root.status !== "active")
		throw conflict("ROOT_ARCHIVED", "The event root is archived.");
	return { root, membership };
}

async function lockAttachmentTarget(
	tx: Tx,
	actor: Actor,
	rootEventId: string,
	target: AttachmentTarget,
	options: { feedbackMayExist: boolean },
) {
	if (target.kind === "feedback")
		await lockFeedbackAttachmentId(tx, target.feedbackId);
	const context = await lockAttachmentRoot(tx, actor, rootEventId);
	return assertAttachmentTarget(
		tx,
		actor,
		rootEventId,
		target,
		context,
		options,
	);
}

async function assertAttachmentTarget(
	tx: Tx,
	actor: Actor,
	rootEventId: string,
	target: AttachmentTarget,
	context: AttachmentRootContext,
	options: { feedbackMayExist: boolean },
): Promise<{ feedbackExists: boolean }> {
	if (target.kind === "feedback") {
		const [feedback] = await tx<
			{ rootEventId: string | null; authorUserId: string }[]
		>`
			SELECT root_event_id AS "rootEventId", author_user_id AS "authorUserId"
			FROM event_feedback WHERE id = ${target.feedbackId} FOR SHARE
		`;
		if (feedback) {
			if (
				feedback.rootEventId !== rootEventId ||
				feedback.authorUserId !== actor.id
			)
				throw notFound();
			if (!options.feedbackMayExist)
				throw conflict("ID_COLLISION", "The feedback ID is already in use.");
		}
		return { feedbackExists: Boolean(feedback) };
	}
	if (context.membership.role === "viewer") throw forbidden();
	const entry = await findFeedEntry(tx, actor, rootEventId, target.entryId);
	if (!entry || entry.deletedAt || entry.authorUserId !== actor.id)
		throw notFound();
	await requireWritableFeedEvent(
		tx,
		rootEventId,
		entry.eventId ?? rootEventId,
		context.membership.role,
	);
	return { feedbackExists: false };
}

async function requireWritableFeedEvent(
	tx: Tx,
	rootEventId: string,
	eventId: string,
	role: Role,
) {
	const event = await requireLiveEvent(tx, rootEventId, eventId);
	if (!isManager(role)) {
		const visible = await visiblePublishedEvents(
			tx,
			rootEventId,
			ROOT_GRAPH_LIMIT + 1,
		);
		if (!visible.some((item) => item.id === eventId)) throw notFound();
	}
	return event;
}

function feedVisibilityClause(tx: Tx, role: Role) {
	if (isManager(role)) return tx``;
	return tx`
		AND COALESCE(entry.event_id, entry.root_event_id) IN (
			WITH RECURSIVE visible AS (
				SELECT id FROM events
				WHERE root_event_id = entry.root_event_id AND id = entry.root_event_id
					AND status = 'published' AND deleted_at IS NULL
				UNION ALL
				SELECT child.id FROM events child
				JOIN visible parent ON child.parent_event_id = parent.id
				WHERE child.root_event_id = entry.root_event_id
					AND child.status = 'published' AND child.deleted_at IS NULL
			)
			SELECT id FROM visible
		)
	`;
}

async function requireMembership(tx: Tx, rootEventId: string, actor: Actor) {
	const membership = await findMembership(tx, rootEventId, actor.id, false);
	if (membership?.status !== "active") throw notFound();
	return membership;
}

async function findMembership(
	tx: Tx,
	rootEventId: string,
	userId: string,
	lock: boolean,
) {
	const suffix = lock ? tx`FOR UPDATE` : tx``;
	const [membership] = await tx<MembershipRecord[]>`
    SELECT ${membershipColumns(tx)} FROM event_memberships
    WHERE root_event_id = ${rootEventId} AND user_id = ${userId} ${suffix}
  `;
	return membership ?? null;
}

async function findFeedEntry(
	tx: Tx,
	actor: Actor,
	rootEventId: string,
	entryId: string,
) {
	const [entry] = await tx<FeedEntryRecord[]>`
		SELECT ${feedEntryColumns(tx)} FROM event_feed_entries entry
		JOIN event_feed_entry_current current
			ON current.root_event_id = entry.root_event_id AND current.entry_id = entry.id
		WHERE entry.root_event_id = ${rootEventId} AND entry.id = ${entryId}
	`;
	if (!entry) return null;
	await hydrateFeedEntries(tx, actor, [entry]);
	return entry;
}

async function findVisibleFeedEntry(
	tx: Tx,
	actor: Actor,
	rootEventId: string,
	entryId: string,
) {
	const membership = await requireMembership(tx, rootEventId, actor);
	const [entry] = await tx<FeedEntryRecord[]>`
		SELECT ${feedEntryColumns(tx)} FROM event_feed_entries entry
		JOIN event_feed_entry_current current
			ON current.root_event_id = entry.root_event_id AND current.entry_id = entry.id
		WHERE entry.root_event_id = ${rootEventId} AND entry.id = ${entryId}
		${feedVisibilityClause(tx, membership.role)}
	`;
	if (!entry) return null;
	await hydrateFeedEntries(tx, actor, [entry]);
	return entry;
}

async function findFeedEntryById(tx: Tx, actor: Actor, entryId: string) {
	const [entry] = await tx<FeedEntryRecord[]>`
		SELECT ${feedEntryColumns(tx)} FROM event_feed_entries entry
		JOIN event_feed_entry_current current
			ON current.root_event_id = entry.root_event_id AND current.entry_id = entry.id
		WHERE entry.id = ${entryId}
	`;
	if (!entry) return null;
	await hydrateFeedEntries(tx, actor, [entry]);
	return entry;
}

async function hydrateFeedEntries(
	tx: Tx,
	actor: Actor,
	entries: FeedEntryRecord[],
) {
	for (const entry of entries) {
		entry.reactions = [];
		entry.attachments = [];
	}
	if (!entries.length) return;
	const ids = entries.map((entry) => entry.id);
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const reactions = await tx<
		{
			entryId: string;
			reaction: string;
			count: number;
			viewerPresent: boolean;
		}[]
	>`
		SELECT entry_id AS "entryId", reaction, count(*)::int AS count,
			bool_or(user_id = ${actor.id}) AS "viewerPresent"
		FROM event_feed_reactions
		WHERE entry_id IN ${tx(ids)} AND present
		GROUP BY entry_id, reaction
		ORDER BY entry_id, reaction
	`;
	for (const reaction of reactions) {
		const entry = byId.get(reaction.entryId);
		if (!entry?.deletedAt)
			entry?.reactions.push({
				reaction: reaction.reaction,
				count: reaction.count,
				viewerPresent: reaction.viewerPresent,
			} satisfies ReactionSummary);
	}
	const attachments = await tx<
		(AttachmentRecord & { targetEntryId: string })[]
	>`
		SELECT ${attachmentColumns(tx)} FROM event_attachments
		WHERE target_type = 'feed_entry' AND target_entry_id IN ${tx(ids)}
		ORDER BY target_entry_id, created_at, id
	`;
	for (const attachment of attachments) {
		const entry = byId.get(attachment.targetEntryId);
		if (entry && !entry.deletedAt) entry.attachments.push(attachment);
	}
}

async function findEvent(tx: Tx, rootEventId: string, eventId: string) {
	const [event] = await tx<EventRecord[]>`
    SELECT ${eventColumns(tx)} FROM events
    WHERE root_event_id = ${rootEventId} AND id = ${eventId}
  `;
	return event ?? null;
}

async function findEventById(tx: Tx, eventId: string) {
	const [event] = await tx<EventRecord[]>`
    SELECT ${eventColumns(tx)} FROM events WHERE id = ${eventId}
  `;
	return event ?? null;
}

async function requireLiveEvent(tx: Tx, rootEventId: string, eventId: string) {
	const event = await findEvent(tx, rootEventId, eventId);
	if (!event || event.deletedAt) throw notFound();
	return event;
}

async function childEvents(tx: Tx, rootEventId: string, parentEventId: string) {
	return tx<EventRecord[]>`
    SELECT ${eventColumns(tx)} FROM events
    WHERE root_event_id = ${rootEventId} AND parent_event_id = ${parentEventId} AND deleted_at IS NULL
    ORDER BY sort_position, id
  `;
}

async function visiblePublishedEvents(
	tx: Tx,
	rootEventId: string,
	limit?: number,
) {
	return tx<EventRecord[]>`
		WITH RECURSIVE visible AS (
			SELECT event.* FROM events event
			WHERE event.root_event_id = ${rootEventId} AND event.id = ${rootEventId}
				AND event.status = 'published' AND event.deleted_at IS NULL
			UNION ALL
			SELECT child.* FROM events child
			JOIN visible parent ON child.parent_event_id = parent.id
			WHERE child.root_event_id = ${rootEventId}
				AND child.status = 'published' AND child.deleted_at IS NULL
		)
		SELECT ${eventColumns(tx)} FROM visible
		ORDER BY sort_position, id
		${limit ? tx`LIMIT ${limit}` : tx``}
	`;
}

async function enqueueFeedNotifications(
	tx: Tx,
	codec: EventNotificationPayloadCodec,
	entry: FeedEntryRecord,
	causationRequestId: string,
	recipients: { userId: string; expiresAt: Date }[],
) {
	if (!(["message", "comment", "system"] as FeedKind[]).includes(entry.kind))
		return;
	for (const recipient of recipients) {
		const id = eventNotificationJobId();
		const deepLink: EventNotificationPayload["deepLink"] = {
			rootEventId: entry.rootEventId,
			...(entry.eventId ? { eventId: entry.eventId } : {}),
			feedEntryId: entry.id,
		};
		const sealed = codec.seal(id, {
			recipientUserId: recipient.userId,
			category: "feed_update",
			templateKey: "feed_entry_created",
			deepLink,
			expiresAt: recipient.expiresAt.toISOString(),
			requestId: id,
			causationRequestId,
		});
		await tx`
			INSERT INTO event_notification_outbox (
				id, payload_kid, payload_ciphertext, expires_at
			) VALUES (
				${id}, ${sealed.kid}, ${sealed.ciphertext}, ${recipient.expiresAt}
			)
		`;
	}
}

async function appendSystemFeedEntry(
	tx: Tx,
	codec: EventNotificationPayloadCodec,
	actor: Actor,
	rootEventId: string,
	eventId: string | null,
	revision: string,
	ordinal: number,
	payload: SystemFeedPayload,
	notificationAudience: FeedNotificationAudience,
) {
	const id = systemFeedEntryId(rootEventId, payload);
	const body = systemFeedPayloadJson(payload);
	const recipients = await findFeedNotificationRecipients(
		tx,
		actor,
		rootEventId,
		eventId,
		notificationAudience,
	);
	if (recipients.length > MAX_NOTIFICATION_RECIPIENTS_PER_FEED)
		throw conflict(
			"FEED_NOTIFICATION_RECIPIENT_LIMIT_REACHED",
			"The system feed entry has too many notification recipients.",
		);

	await tx`
		INSERT INTO event_feed_entries (
			id, root_event_id, event_id, parent_entry_id, author_user_id,
			kind, payload_schema_version, created_root_revision
		) VALUES (
			${id}, ${rootEventId}, ${eventId}, NULL, NULL, 'system', 1, ${revision}
		)
	`;
	await tx`
		INSERT INTO event_feed_entry_revisions (
			root_event_id, entry_id, version, editor_user_id, body, root_revision
		) VALUES (${rootEventId}, ${id}, 1, NULL, ${body}, ${revision})
	`;
	await tx`
		INSERT INTO event_feed_entry_current (
			root_event_id, entry_id, version, body, root_revision
		) VALUES (${rootEventId}, ${id}, 1, ${body}, ${revision})
	`;
	const entry = await findFeedEntry(tx, actor, rootEventId, id);
	if (!entry) throw new Error("System feed insert invariant failed");
	await appendChange(
		tx,
		rootEventId,
		revision,
		ordinal,
		"feedEntry",
		id,
		"upsert",
		1,
		feedEntrySync(entry),
	);
	await enqueueFeedNotifications(tx, codec, entry, id, recipients);
}

async function findFeedNotificationRecipients(
	tx: Tx,
	actor: Actor,
	rootEventId: string,
	eventId: string | null,
	audience: FeedNotificationAudience = "visible",
) {
	return tx<{ userId: string; expiresAt: Date }[]>`
		SELECT membership.user_id AS "userId",
			clock_timestamp() + interval '23 hours' AS "expiresAt"
		FROM event_memberships membership
		WHERE membership.root_event_id = ${rootEventId}
			AND membership.user_id <> ${actor.id}
			${
				audience === "managers"
					? tx`AND membership.role IN ('owner', 'organizer')`
					: tx``
			}
			AND event_feed_context_recipient_can_read(
				${rootEventId}, ${eventId}, membership.user_id
			)
		ORDER BY membership.user_id
		LIMIT ${MAX_NOTIFICATION_RECIPIENTS_PER_FEED + 1}
	`;
}

async function itineraryIsMemberVisible(
	tx: Tx,
	rootEventId: string,
	itemId: string,
) {
	const [visibility] = await tx<{ visible: boolean }[]>`
		SELECT event_sync_itinerary_is_member_visible(
			${rootEventId}, ${itemId}
		) AS visible
	`;
	return visibility?.visible ?? false;
}

async function assertRootEventCapacity(tx: Tx, rootEventId: string) {
	const [row] = await tx<{ count: number }[]>`
		SELECT count(*)::int AS count FROM events
		WHERE root_event_id = ${rootEventId} AND deleted_at IS NULL
	`;
	if ((row?.count ?? 0) >= ROOT_EVENT_LIMIT) throw collectionLimitReached();
}

async function assertEventItineraryCapacity(
	tx: Tx,
	rootEventId: string,
	eventId: string,
) {
	const [row] = await tx<{ count: number }[]>`
		SELECT count(*)::int AS count FROM event_itinerary_items
		WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
			AND deleted_at IS NULL
	`;
	if ((row?.count ?? 0) >= EVENT_ITINERARY_LIMIT)
		throw collectionLimitReached();
}

async function assertSessionReferencesValid(tx: Tx, rootEventId: string) {
	const [invalid] = await tx<{ itemId: string }[]>`
		WITH RECURSIVE refs AS (
			SELECT item.id AS item_id, item.event_id,
				item.details->>'descendantEventId' AS descendant_event_id,
				item.status
			FROM event_itinerary_items item
			WHERE item.root_event_id = ${rootEventId}
				AND item.deleted_at IS NULL
				AND item.details->>'type' = 'session'
				AND item.details->>'descendantEventId' IS NOT NULL
		), descendants AS (
			SELECT ref.item_id, child.id
			FROM refs ref
			JOIN events child ON child.root_event_id = ${rootEventId}
				AND child.parent_event_id = ref.event_id
				AND child.deleted_at IS NULL
			UNION ALL
			SELECT descendant.item_id, child.id
			FROM descendants descendant
			JOIN events child ON child.root_event_id = ${rootEventId}
				AND child.parent_event_id = descendant.id
				AND child.deleted_at IS NULL
		), visible AS (
			SELECT event.id
			FROM events event
			JOIN event_roots root ON root.root_event_id = event.root_event_id
			WHERE event.root_event_id = ${rootEventId}
				AND event.id = ${rootEventId}
				AND root.status = 'active'
				AND event.status = 'published'
				AND event.deleted_at IS NULL
			UNION ALL
			SELECT child.id
			FROM events child
			JOIN visible parent ON child.parent_event_id = parent.id
			WHERE child.root_event_id = ${rootEventId}
				AND child.status = 'published'
				AND child.deleted_at IS NULL
		)
		SELECT ref.item_id AS "itemId"
		FROM refs ref
		WHERE NOT EXISTS (
			SELECT 1 FROM descendants descendant
			WHERE descendant.item_id = ref.item_id
				AND descendant.id = ref.descendant_event_id
		) OR (
			ref.status <> 'archived'
			AND EXISTS (SELECT 1 FROM visible WHERE id = ref.event_id)
			AND NOT EXISTS (
				SELECT 1 FROM visible WHERE id = ref.descendant_event_id
			)
		)
		LIMIT 1
	`;
	if (invalid) {
		throw conflict(
			"DEPENDENCY_EXISTS",
			"The event change would invalidate a live session reference.",
		);
	}
}

async function findInvitation(
	tx: Tx,
	rootEventId: string,
	invitationId: string,
) {
	const [invitation] = await tx<InvitationRecord[]>`
    SELECT ${invitationColumns(tx)} FROM event_invitations
    WHERE root_event_id = ${rootEventId} AND id = ${invitationId}
  `;
	return invitation ?? null;
}

async function findInvitationById(tx: Tx, invitationId: string) {
	const [invitation] = await tx<InvitationRecord[]>`
    SELECT ${invitationColumns(tx)} FROM event_invitations WHERE id = ${invitationId}
  `;
	return invitation ?? null;
}

async function findPlace(tx: Tx, rootEventId: string, placeId: string) {
	const [place] = await tx<PlaceRecord[]>`
    SELECT ${placeColumns(tx)} FROM event_places
    WHERE root_event_id = ${rootEventId} AND id = ${placeId}
  `;
	return place ?? null;
}

async function findPlaceById(tx: Tx, placeId: string) {
	const [place] = await tx<PlaceRecord[]>`
    SELECT ${placeColumns(tx)} FROM event_places WHERE id = ${placeId}
  `;
	return place ?? null;
}

async function findCapability(
	tx: Tx,
	rootEventId: string,
	eventId: string,
	type: CapabilityType,
) {
	const [capability] = await tx<CapabilityRecord[]>`
		SELECT ${capabilityColumns(tx)} FROM event_capabilities
		WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
			AND capability_type = ${type}
	`;
	return capability ?? null;
}

async function capabilityHasDependencies(
	tx: Tx,
	rootEventId: string,
	eventId: string,
	type: CapabilityType,
) {
	if (type === "team") {
		const [result] = await tx<{ found: boolean }[]>`
			SELECT (
				EXISTS (
					SELECT 1 FROM event_team_assignment_sets
					WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
				) OR EXISTS (
					SELECT 1 FROM event_team_decisions
					WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
				)
			) AS found
		`;
		return result?.found ?? false;
	}
	if (type !== "lodging" && type !== "transport" && type !== "golf")
		return false;
	const dependentTypes =
		type === "lodging"
			? ["lodging"]
			: type === "golf"
				? ["golf_round"]
				: ["flight", "rail", "road_transfer"];
	const [result] = await tx<{ found: boolean }[]>`
		SELECT EXISTS (
			SELECT 1 FROM event_itinerary_items
			WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
				AND deleted_at IS NULL AND status <> 'archived'
				AND details->>'type' = ANY(${dependentTypes}::text[])
		) AS found
	`;
	return result?.found ?? false;
}

async function teamCapacityExceeded(
	tx: Tx,
	rootEventId: string,
	eventId: string,
	capacity: number,
) {
	const [result] = await tx<{ found: boolean }[]>`
		SELECT EXISTS (
			SELECT 1 FROM event_team_members
			WHERE root_event_id = ${rootEventId} AND event_id = ${eventId}
			GROUP BY team_id HAVING count(*) > ${capacity}
		) AS found
	`;
	return result?.found ?? false;
}

async function requirePlaceSnapshot(
	tx: Tx,
	rootEventId: string,
	placeId: string,
): Promise<PlaceSnapshot> {
	const place = await findPlace(tx, rootEventId, placeId);
	if (!place || place.deletedAt)
		throw new DomainError(
			400,
			"PLACE_INVALID",
			"The place is not available in this event.",
		);
	return {
		id: place.id,
		name: place.name,
		locality: place.locality,
		countryCode: place.countryCode,
		latitude: place.latitude,
		longitude: place.longitude,
	};
}

async function materializeItineraryDetails(
	tx: Tx,
	rootEventId: string,
	eventId: string,
	details: ItineraryDetailsInput,
	previous?: ItineraryDetails,
): Promise<ItineraryDetails> {
	if (details.schemaVersion !== 1) {
		throw new DomainError(
			400,
			"DETAILS_SCHEMA_INVALID",
			"Itinerary details must use schemaVersion 1.",
		);
	}
	if (
		details.type === "flight" ||
		details.type === "rail" ||
		details.type === "road_transfer"
	) {
		const previousTravel = isTravelDetails(previous) ? previous : null;
		const originPlaceSnapshot =
			previousTravel?.originPlaceId === details.originPlaceId
				? previousTravel.originPlaceSnapshot
				: await requirePlaceSnapshot(tx, rootEventId, details.originPlaceId);
		const destinationPlaceSnapshot =
			previousTravel?.destinationPlaceId === details.destinationPlaceId
				? previousTravel.destinationPlaceSnapshot
				: await requirePlaceSnapshot(
						tx,
						rootEventId,
						details.destinationPlaceId,
					);
		return { ...details, originPlaceSnapshot, destinationPlaceSnapshot };
	}
	if (details.type === "session" && details.descendantEventId) {
		const [match] = await tx<{ found: boolean }[]>`
			WITH RECURSIVE descendants AS (
				SELECT id FROM events
				WHERE root_event_id = ${rootEventId}
					AND parent_event_id = ${eventId} AND deleted_at IS NULL
				UNION ALL
				SELECT child.id FROM events child
				JOIN descendants parent ON child.parent_event_id = parent.id
				WHERE child.root_event_id = ${rootEventId} AND child.deleted_at IS NULL
			)
			SELECT EXISTS(
				SELECT 1 FROM descendants WHERE id = ${details.descendantEventId}
			) AS found
		`;
		if (!match?.found) {
			throw new DomainError(
				400,
				"DETAILS_REFERENCE_INVALID",
				"The session descendant must belong below the itinerary event.",
			);
		}
	}
	return details;
}

function isTravelDetails(
	details: ItineraryDetails | undefined,
): details is Extract<
	ItineraryDetails,
	{ type: "flight" | "rail" | "road_transfer" }
> {
	return (
		details?.type === "flight" ||
		details?.type === "rail" ||
		details?.type === "road_transfer"
	);
}

async function findItinerary(tx: Tx, rootEventId: string, itemId: string) {
	const [item] = await tx<ItineraryRecord[]>`
    SELECT ${itineraryColumns(tx)} FROM event_itinerary_items
    WHERE root_event_id = ${rootEventId} AND id = ${itemId}
  `;
	return item ?? null;
}

async function findItineraryById(tx: Tx, itemId: string) {
	const [item] = await tx<ItineraryRecord[]>`
    SELECT ${itineraryColumns(tx)} FROM event_itinerary_items WHERE id = ${itemId}
  `;
	return item ?? null;
}

async function itineraryItems(tx: Tx, rootEventId: string, eventId: string) {
	return tx<ItineraryRecord[]>`
    SELECT ${itineraryColumns(tx)} FROM event_itinerary_items
    WHERE root_event_id = ${rootEventId} AND event_id = ${eventId} AND deleted_at IS NULL
    ORDER BY sort_position, id
	`;
}

async function nextRevision(tx: Tx, rootEventId: string) {
	const [root] = await tx<{ revision: string }[]>`
    UPDATE event_roots SET revision = revision + 1
    WHERE root_event_id = ${rootEventId}
    RETURNING revision::text AS revision
  `;
	if (!root) throw new Error("Root revision invariant failed");
	return root.revision;
}

async function appendChange(
	tx: Tx,
	rootEventId: string,
	revision: string,
	ordinal: number,
	entityType: string,
	entityId: string,
	operation: "upsert" | "tombstone",
	entityVersion: number,
	payload: Record<string, unknown>,
) {
	let audience: "members" | "managers" = "members";
	if (entityType === "invitation") {
		audience = "managers";
	} else if (entityType === "membership") {
		if (payload.status !== "active") audience = "managers";
	} else if (entityType === "event") {
		const [visibility] = await tx<{ visible: boolean }[]>`
			SELECT event_sync_event_is_member_visible(
				${rootEventId}, ${entityId}
			) AS visible
		`;
		if (!visibility?.visible) audience = "managers";
	} else if (entityType === "itineraryItem") {
		const [visibility] = await tx<{ visible: boolean }[]>`
			SELECT event_sync_itinerary_is_member_visible(
				${rootEventId}, ${entityId}
			) AS visible
		`;
		if (!visibility?.visible) audience = "managers";
	} else if (entityType === "feedEntry") {
		const [visibility] = await tx<{ visible: boolean }[]>`
			SELECT event_sync_feed_is_member_visible(
				${rootEventId}, ${entityId}
			) AS visible
		`;
		if (!visibility?.visible) audience = "managers";
	} else if (entityType === "feedReaction") {
		const entryId = typeof payload.entryId === "string" ? payload.entryId : "";
		const [visibility] = await tx<{ visible: boolean }[]>`
			SELECT event_sync_feed_is_member_visible(
				${rootEventId}, ${entryId}
			) AS visible
		`;
		if (!visibility?.visible) audience = "managers";
	} else if (entityType === "attachment") {
		const target = payload.target;
		const entryId =
			target && typeof target === "object" && "entityId" in target
				? (target as { entityId?: unknown }).entityId
				: null;
		const [visibility] = await tx<{ visible: boolean }[]>`
			SELECT event_sync_feed_is_member_visible(
				${rootEventId}, ${typeof entryId === "string" ? entryId : ""}
			) AS visible
		`;
		if (!visibility?.visible) audience = "managers";
	} else if (entityType === "capability") {
		const eventId = typeof payload.eventId === "string" ? payload.eventId : "";
		const [visibility] = await tx<{ visible: boolean }[]>`
			SELECT event_sync_capability_is_member_visible(
				${rootEventId}, ${eventId}
			) AS visible
		`;
		if (!visibility?.visible) audience = "managers";
	} else if (entityType === "place") {
		const [visibility] = await tx<{ visible: boolean }[]>`
			SELECT event_sync_place_is_member_visible(
				${rootEventId}, ${entityId}
			) AS visible
		`;
		if (!visibility?.visible) audience = "managers";
	}
	await tx`
    INSERT INTO event_root_changes (
      root_event_id, root_revision, ordinal, entity_type, entity_id,
      operation, entity_version, data, tombstone, audience
    ) VALUES (
      ${rootEventId}, ${revision}, ${ordinal}, ${entityType}, ${entityId},
      ${operation}, ${entityVersion},
			${operation === "upsert" ? tx.json(payload as never) : null},
			${operation === "tombstone" ? tx.json(payload as never) : null},
			${audience}
    )
  `;
}

async function bumpChildOrder(tx: Tx, rootEventId: string, eventId: string) {
	const [event] = await tx<EventRecord[]>`
		UPDATE events SET child_order_version = child_order_version + 1,
			version = version + 1, updated_at = now()
		WHERE root_event_id = ${rootEventId} AND id = ${eventId}
		RETURNING ${eventColumns(tx)}
	`;
	if (!event) throw new Error("Child-order parent invariant failed");
	return event;
}

async function bumpItineraryOrder(
	tx: Tx,
	rootEventId: string,
	eventId: string,
) {
	const [event] = await tx<EventRecord[]>`
		UPDATE events SET itinerary_order_version = itinerary_order_version + 1,
			version = version + 1, updated_at = now()
		WHERE root_event_id = ${rootEventId} AND id = ${eventId}
		RETURNING ${eventColumns(tx)}
	`;
	if (!event) throw new Error("Itinerary-order event invariant failed");
	return event;
}

function mergeEvent(current: EventRecord, patch: EventPatch): EventRecord {
	return {
		...current,
		title: patch.title ?? current.title,
		description: Object.hasOwn(patch, "description")
			? (patch.description ?? null)
			: current.description,
		timeZone: patch.timeZone ?? current.timeZone,
		startsAt: Object.hasOwn(patch, "startsAt")
			? (patch.startsAt ?? null)
			: current.startsAt,
		endsAt: Object.hasOwn(patch, "endsAt")
			? (patch.endsAt ?? null)
			: current.endsAt,
		status: patch.status ?? current.status,
	};
}

function mergePlace(current: PlaceRecord, patch: PlacePatch) {
	return {
		name: patch.name ?? current.name,
		locality: Object.hasOwn(patch, "locality")
			? (patch.locality ?? null)
			: current.locality,
		countryCode: patch.countryCode ?? current.countryCode,
		latitude: Object.hasOwn(patch, "latitude")
			? (patch.latitude ?? null)
			: current.latitude,
		longitude: Object.hasOwn(patch, "longitude")
			? (patch.longitude ?? null)
			: current.longitude,
	};
}

function mergeItinerary(
	current: ItineraryRecord,
	patch: Omit<ItineraryPatch, "details"> & { details?: ItineraryDetails },
): ItineraryRecord {
	return {
		...current,
		title: patch.title ?? current.title,
		notes: Object.hasOwn(patch, "notes")
			? (patch.notes ?? null)
			: current.notes,
		timeZone: patch.timeZone ?? current.timeZone,
		startsAt: Object.hasOwn(patch, "startsAt")
			? (patch.startsAt ?? null)
			: current.startsAt,
		endsAt: Object.hasOwn(patch, "endsAt")
			? (patch.endsAt ?? null)
			: current.endsAt,
		allDay: patch.allDay ?? current.allDay,
		status: patch.status ?? current.status,
		details: patch.details ?? current.details,
		placeId: Object.hasOwn(patch, "placeId")
			? (patch.placeId ?? null)
			: current.placeId,
	};
}

function sameEventInput(
	event: EventRecord,
	input: EventInput,
	parentEventId: string | null,
) {
	return (
		event.parentEventId === parentEventId &&
		event.kind === input.kind &&
		event.title === input.title &&
		event.description === input.description &&
		event.timeZone === input.timeZone &&
		sameDate(event.startsAt, input.startsAt) &&
		sameDate(event.endsAt, input.endsAt) &&
		event.status === input.status &&
		!event.deletedAt
	);
}

function sameEditableEvent(left: EventRecord, right: EventRecord) {
	return (
		left.title === right.title &&
		left.description === right.description &&
		left.timeZone === right.timeZone &&
		sameDate(left.startsAt, right.startsAt) &&
		sameDate(left.endsAt, right.endsAt) &&
		left.status === right.status
	);
}

function samePlaceInput(place: PlaceRecord, input: PlaceInput) {
	return (
		place.name === input.name &&
		place.locality === input.locality &&
		place.countryCode === input.countryCode &&
		place.latitude === input.latitude &&
		place.longitude === input.longitude &&
		!place.deletedAt
	);
}

function sameItineraryInput(
	item: ItineraryRecord,
	input: Omit<ItineraryInput, "details"> & { details: ItineraryDetails },
) {
	return (
		item.eventId === input.eventId &&
		item.title === input.title &&
		item.notes === input.notes &&
		item.timeZone === input.timeZone &&
		sameDate(item.startsAt, input.startsAt) &&
		sameDate(item.endsAt, input.endsAt) &&
		item.allDay === input.allDay &&
		item.status === input.status &&
		item.placeId === input.placeId &&
		JSON.stringify(item.details) === JSON.stringify(input.details) &&
		!item.deletedAt
	);
}

function sameEditableItinerary(
	left: ItineraryRecord,
	right: ItineraryRecord,
	snapshot: PlaceSnapshot | null,
) {
	return (
		left.title === right.title &&
		left.notes === right.notes &&
		left.timeZone === right.timeZone &&
		sameDate(left.startsAt, right.startsAt) &&
		sameDate(left.endsAt, right.endsAt) &&
		left.allDay === right.allDay &&
		left.status === right.status &&
		left.placeId === right.placeId &&
		JSON.stringify(left.details) === JSON.stringify(right.details) &&
		JSON.stringify(left.placeSnapshot) === JSON.stringify(snapshot)
	);
}

function eventSync(event: EventRecord) {
	return {
		id: event.id,
		rootEventId: event.rootEventId,
		parentEventId: event.parentEventId,
		kind: event.kind,
		title: event.title,
		description: event.description,
		timeZone: event.timeZone,
		startsAt: event.startsAt?.toISOString() ?? null,
		endsAt: event.endsAt?.toISOString() ?? null,
		sortKey: event.sortPosition,
		childOrderVersion: event.childOrderVersion,
		itineraryOrderVersion: event.itineraryOrderVersion,
		status: event.status,
		version: event.version,
		createdAt: event.createdAt.toISOString(),
		updatedAt: event.updatedAt.toISOString(),
		deletedAt: event.deletedAt?.toISOString() ?? null,
	};
}

function membershipSync(membership: MembershipRecord) {
	return {
		rootEventId: membership.rootEventId,
		userId: membership.userId,
		role: membership.role,
		status: membership.status,
		version: membership.version,
		createdAt: membership.createdAt.toISOString(),
		updatedAt: membership.updatedAt.toISOString(),
	};
}

function invitationSync(invitation: InvitationRecord) {
	return {
		id: invitation.id,
		rootEventId: invitation.rootEventId,
		role: invitation.role,
		emailBound: invitation.normalizedEmailHint !== null,
		expiresAt: invitation.expiresAt.toISOString(),
		maxUses: invitation.maxUses,
		useCount: invitation.useCount,
		status: invitation.status,
		version: invitation.version,
		createdAt: invitation.createdAt.toISOString(),
		updatedAt: invitation.updatedAt.toISOString(),
	};
}

function placeSync(place: PlaceRecord) {
	return {
		id: place.id,
		rootEventId: place.rootEventId,
		name: place.name,
		locality: place.locality,
		countryCode: place.countryCode,
		latitude: place.latitude,
		longitude: place.longitude,
		version: place.version,
		createdAt: place.createdAt.toISOString(),
		updatedAt: place.updatedAt.toISOString(),
		deletedAt: place.deletedAt?.toISOString() ?? null,
	};
}

function capabilityPlaceId(capability: CapabilityInput) {
	switch (capability.type) {
		case "travel":
			return capability.config.homePlaceId;
		case "lodging":
			return capability.config.propertyPlaceId;
		case "transport":
			return capability.config.meetingPlaceId;
		case "golf":
			return capability.config.coursePlaceId;
		case "team":
			return capability.config.venuePlaceId;
	}
}

function capabilitySync(capability: CapabilityRecord) {
	return {
		rootEventId: capability.rootEventId,
		eventId: capability.eventId,
		type: capability.type,
		schemaVersion: capability.schemaVersion,
		config: capability.config,
		version: capability.version,
		createdAt: capability.createdAt.toISOString(),
		updatedAt: capability.updatedAt.toISOString(),
		deletedAt: capability.deletedAt?.toISOString() ?? null,
	};
}

function capabilityTombstone(capability: CapabilityRecord) {
	return {
		entityType: "capability",
		id: capabilityEntityId(capability.eventId, capability.type),
		rootEventId: capability.rootEventId,
		eventId: capability.eventId,
		type: capability.type,
		version: capability.version,
		deletedAt: capability.deletedAt?.toISOString() ?? new Date().toISOString(),
	};
}

function itinerarySync(item: ItineraryRecord) {
	return {
		id: item.id,
		rootEventId: item.rootEventId,
		eventId: item.eventId,
		title: item.title,
		notes: item.notes,
		timeZone: item.timeZone,
		startsAt: item.startsAt?.toISOString() ?? null,
		endsAt: item.endsAt?.toISOString() ?? null,
		allDay: item.allDay,
		sortKey: item.sortPosition,
		status: item.status,
		details: item.details,
		placeId: item.placeId,
		placeSnapshot: item.placeSnapshot,
		version: item.version,
		createdAt: item.createdAt.toISOString(),
		updatedAt: item.updatedAt.toISOString(),
		deletedAt: item.deletedAt?.toISOString() ?? null,
	};
}

function feedEntrySync(entry: FeedEntryRecord) {
	return {
		id: entry.id,
		rootEventId: entry.rootEventId,
		eventId: entry.eventId,
		parentEntryId: entry.parentEntryId,
		actorUserId: entry.authorUserId,
		kind: entry.kind,
		payloadSchemaVersion: entry.payloadSchemaVersion,
		payload: { text: entry.body },
		rootRevision: entry.rootRevision,
		createdRootRevision: entry.createdRootRevision,
		version: entry.version,
		createdAt: entry.createdAt.toISOString(),
		updatedAt: entry.updatedAt.toISOString(),
		deletedAt: null,
	};
}

function feedEntryTombstone(entry: FeedEntryRecord) {
	return {
		id: entry.id,
		rootEventId: entry.rootEventId,
		eventId: entry.eventId,
		version: entry.version,
		deletedAt: entry.deletedAt?.toISOString() ?? new Date().toISOString(),
	};
}

function feedReactionSync(reaction: FeedReactionRecord) {
	return {
		entryId: reaction.entryId,
		rootEventId: reaction.rootEventId,
		userId: reaction.userId,
		reaction: reaction.reaction,
		present: true,
		version: reaction.version,
		updatedAt: reaction.updatedAt.toISOString(),
	};
}

function feedReactionTombstone(reaction: FeedReactionRecord) {
	return {
		entryId: reaction.entryId,
		rootEventId: reaction.rootEventId,
		userId: reaction.userId,
		reaction: reaction.reaction,
		version: reaction.version,
		deletedAt: reaction.updatedAt.toISOString(),
	};
}

function attachmentSync(attachment: AttachmentRecord) {
	if (attachment.target.kind !== "feedEntry")
		throw new Error("Feedback attachments must not enter event sync");
	return {
		id: attachment.id,
		rootEventId: attachment.rootEventId,
		target: { entityType: "feedEntry", entityId: attachment.target.entryId },
		contentType: attachment.contentType,
		byteCount: attachment.byteCount,
		sha256: attachment.sha256,
		caption: attachment.caption,
		version: attachment.version,
		createdAt: attachment.createdAt.toISOString(),
	};
}

function attachmentTargetType(target: AttachmentTarget) {
	return target.kind === "feedEntry" ? "feed_entry" : "feedback";
}

function attachmentTargetEntryId(target: AttachmentTarget) {
	return target.kind === "feedEntry" ? target.entryId : null;
}

function attachmentTargetFeedbackId(target: AttachmentTarget) {
	return target.kind === "feedback" ? target.feedbackId : null;
}

function sameAttachmentTarget(left: AttachmentTarget, right: AttachmentTarget) {
	return left.kind === "feedEntry"
		? right.kind === "feedEntry" && left.entryId === right.entryId
		: right.kind === "feedback" && left.feedbackId === right.feedbackId;
}

function tombstone(
	entityType: string,
	id: string,
	rootEventId: string,
	eventId: string,
	version: number,
	deletedAt: Date,
) {
	return {
		entityType,
		id,
		rootEventId,
		eventId,
		version,
		deletedAt: deletedAt.toISOString(),
	};
}

function validateTimeRange(startsAt: Date | null, endsAt: Date | null) {
	if (startsAt && endsAt && startsAt >= endsAt) {
		throw new DomainError(
			400,
			"INVALID_TIME_RANGE",
			"The end time must be after the start time.",
		);
	}
}

function validateFeedBody(body: string) {
	if (body.trim() !== body || body.length < 1 || body.length > 10_000)
		throw new DomainError(
			400,
			"FEED_BODY_INVALID",
			"Feed text must contain between 1 and 10000 non-padding characters.",
		);
}

function validateReaction(reaction: string) {
	if (
		!new Set(["like", "love", "celebrate", "laugh", "surprised", "sad"]).has(
			reaction,
		)
	)
		throw new DomainError(400, "REACTION_INVALID", "The reaction is invalid.");
}

function validateCaption(caption: string | null) {
	if (
		caption !== null &&
		(caption.trim() !== caption || caption.length < 1 || caption.length > 1000)
	)
		throw new DomainError(
			400,
			"ATTACHMENT_CAPTION_INVALID",
			"The attachment caption is invalid.",
		);
}

function validatePlace(
	place: Pick<PlaceInput, "countryCode" | "latitude" | "longitude">,
) {
	if (!/^[A-Z]{2}$/.test(place.countryCode)) {
		throw new DomainError(
			400,
			"INVALID_COUNTRY_CODE",
			"The country code must be two uppercase letters.",
		);
	}
	const latitude = place.latitude;
	const longitude = place.longitude;
	const coordinatesPresent = latitude !== null && longitude !== null;
	if (
		(latitude === null) !== (longitude === null) ||
		(coordinatesPresent &&
			(!Number.isFinite(latitude) ||
				!Number.isFinite(longitude) ||
				latitude < -90 ||
				latitude > 90 ||
				longitude < -180 ||
				longitude > 180))
	) {
		throw new DomainError(
			400,
			"INVALID_COORDINATES",
			"Latitude and longitude must be valid and supplied together.",
		);
	}
}

function validateTimeZone(value: string) {
	try {
		new Intl.DateTimeFormat("en", { timeZone: value }).format();
	} catch {
		throw new DomainError(
			400,
			"INVALID_TIME_ZONE",
			"The time zone must be a valid IANA identifier.",
		);
	}
}

function assertSameSet(current: string[], requested: string[]) {
	if (
		new Set(requested).size !== requested.length ||
		current.length !== requested.length ||
		!current.every((id) => requested.includes(id))
	) {
		throw new DomainError(
			400,
			"INVALID_ORDER",
			"The order must contain every live item exactly once.",
		);
	}
}

function sameStrings(left: string[], right: string[]) {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

function pageSlice<T>(rows: T[], limit: number) {
	return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

function sameDate(left: Date | null, right: Date | null) {
	return left?.getTime() === right?.getTime();
}

function isManager(role: Role) {
	return role === "owner" || role === "organizer";
}

function roleRank(role: Role) {
	return { viewer: 0, participant: 1, organizer: 2, owner: 3 }[role];
}

function notFound() {
	return new DomainError(404, "NOT_FOUND", "Resource not found.");
}

function syncCursorExpired() {
	return new DomainError(
		410,
		"CURSOR_EXPIRED",
		"The sync cursor is no longer valid for the current authorization scope.",
		{},
		[
			{
				code: "BOOTSTRAP_REQUIRED",
				message:
					"Discard staged sync data and bootstrap this event root again.",
			},
		],
	);
}

function entityDeleted() {
	return conflict(
		"ENTITY_DELETED",
		"The entity was deleted and cannot be resurrected.",
	);
}

function syncBlockedResult(
	mutation: SyncMutation,
	code: string,
	message: string,
): SyncMutationResult {
	return {
		clientMutationId: mutation.clientMutationId,
		clientSequence: mutation.clientSequence,
		outcome: "blocked",
		replayed: false,
		error: { code, message, retryable: false },
	};
}

function syncIntegrityRejectedResult(
	mutation: SyncMutation,
	code: string,
	message: string,
): SyncMutationResult {
	return {
		clientMutationId: mutation.clientMutationId,
		clientSequence: mutation.clientSequence,
		outcome: "rejected",
		replayed: false,
		error: { code, message, retryable: false },
	};
}

function syncDomainRetry(error: DomainError) {
	return error.code === "ATTACHMENT_VERIFICATION_CAPACITY";
}

function syncMutationError(error: DomainError, retryable: boolean) {
	let currentVersion: number | undefined;
	let authoritativeOrder: string[] | undefined;
	for (const detail of error.details ?? []) {
		if (
			detail.code === "CURRENT_VERSION" &&
			typeof detail.meta?.currentVersion === "number"
		)
			currentVersion = detail.meta.currentVersion;
		if (
			detail.code === "AUTHORITATIVE_ORDER" &&
			typeof detail.meta?.orderedIds === "string"
		)
			authoritativeOrder = detail.meta.orderedIds.split(",");
	}
	return {
		code: error.code,
		message: error.message,
		retryable,
		...(currentVersion !== undefined ? { currentVersion } : {}),
		...(authoritativeOrder ? { authoritativeOrder } : {}),
	};
}

function forbidden(message = "Your event role does not permit this action.") {
	return new DomainError(403, "FORBIDDEN", message);
}

function conflict(
	code: string,
	message: string,
	headers: Record<string, string> = {},
) {
	return new DomainError(409, code, message, headers);
}

function collectionLimitReached() {
	return conflict(
		"COLLECTION_LIMIT_REACHED",
		"The collection cannot contain more than 500 live items.",
	);
}

function versionConflict(
	currentVersion: number,
	meta?: Record<string, unknown>,
) {
	const orderedIds = Array.isArray(meta?.orderedIds)
		? meta.orderedIds.filter((id): id is string => typeof id === "string")
		: [];
	return new DomainError(
		409,
		"VERSION_CONFLICT",
		"The resource changed on another device.",
		{},
		[
			{
				code: "CURRENT_VERSION",
				message: "The current server version is available in meta.",
				meta: { currentVersion },
			},
			...(orderedIds.length
				? [
						{
							code: "AUTHORITATIVE_ORDER",
							message: "The current ordered IDs are comma-separated in meta.",
							meta: { orderedIds: orderedIds.join(",") },
						},
					]
				: []),
		],
	);
}

function rootRevisionConflict(currentRootRevision: string) {
	return new DomainError(
		409,
		"ROOT_REVISION_CONFLICT",
		"The event root changed after readiness was reviewed.",
		{},
		[
			{
				code: "CURRENT_ROOT_REVISION",
				message: "The current root revision is available in meta.",
				meta: { currentRootRevision },
			},
		],
	);
}

function assertRecapSourcesBounded(sources: RecapSourceInput[]) {
	if (sources.length > RECAP_SOURCE_LIMIT)
		throw new DomainError(
			400,
			"RECAP_SOURCE_LIMIT_EXCEEDED",
			"A recap can contain at most 50 source items.",
		);
	const keys = new Set<string>();
	for (const source of sources) {
		if (
			!Number.isSafeInteger(source.sourceVersion) ||
			source.sourceVersion < 1 ||
			source.sourceVersion > RECAP_VERSION_LIMIT
		)
			throw new DomainError(
				400,
				"RECAP_SOURCE_VERSION_INVALID",
				"Each recap source requires a positive safe version.",
			);
		const key = `${source.type}:${source.sourceId}`;
		if (keys.has(key))
			throw new DomainError(
				400,
				"RECAP_SOURCE_DUPLICATE",
				"Each recap source may be selected only once.",
			);
		keys.add(key);
	}
}

function recapSourceIssue(
	ordinal: number,
	code: RecapSourceIssue["code"],
	collection = "sources",
): RecapSourceIssue {
	const message = {
		RECAP_SOURCE_UNAVAILABLE:
			"The selected source is not available in the published event.",
		RECAP_SOURCE_VERSION_CHANGED:
			"The selected source changed after it was reviewed.",
		RECAP_SOURCE_CONSENT_REQUIRED:
			"The source author has not provided current consent.",
		RECAP_SOURCE_CONTENT_TOO_LARGE:
			"The selected source is too large for a bounded recap item.",
	}[code];
	return { code, message, path: `${collection}.${ordinal}` };
}

function recapSourcesInvalid(
	phase: "generation" | "publication",
	issues: RecapSourceIssue[],
) {
	return new DomainError(
		409,
		phase === "generation"
			? "RECAP_GENERATION_SOURCE_INVALID"
			: "RECAP_PUBLISH_SOURCE_INVALID",
		phase === "generation"
			? "One or more recap sources cannot be projected safely."
			: "One or more recap sources changed or lost consent before publication.",
		{},
		issues,
	);
}

function recapRootUnavailable() {
	return conflict(
		"RECAP_ROOT_UNAVAILABLE",
		"A recap requires a currently published root event.",
	);
}

function recapVersionConflict(currentLifecycleVersion: number) {
	return new DomainError(
		409,
		"RECAP_VERSION_CONFLICT",
		"The recap lifecycle changed on another device.",
		{},
		[
			{
				code: "CURRENT_RECAP_LIFECYCLE_VERSION",
				message: "The current recap lifecycle version is available in meta.",
				meta: { currentLifecycleVersion },
			},
		],
	);
}

function recapShareVersionConflict(currentRecapVersion: number) {
	return new DomainError(
		409,
		"RECAP_SHARE_VERSION_CONFLICT",
		"Review the current published recap before creating a share link.",
		{},
		[
			{
				code: "CURRENT_RECAP_VERSION",
				message: "The current published recap version is available in meta.",
				meta: { currentRecapVersion },
			},
		],
	);
}

function recapSnapshotStale(currentRecapVersion: number) {
	return new DomainError(
		409,
		"RECAP_SNAPSHOT_STALE",
		"Only the latest non-removed recap snapshot can be published.",
		{},
		[
			{
				code: "CURRENT_RECAP_VERSION",
				message: "The current recap snapshot version is available in meta.",
				meta: { currentRecapVersion },
			},
		],
	);
}
