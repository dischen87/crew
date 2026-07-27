import {
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";
import { attachmentQuarantineKey } from "./attachment-keys";
import {
	type CommunityFeedbackStatus,
	normalizeCommunityFeedbackSearch,
} from "./community-feedback-domain";
import {
	type Actor,
	assertRootCreationStatus,
	type CapabilityInput,
	type CapabilityType,
	type CursorPage,
	type CursorQuery,
	DomainError,
	type EventInput,
	type EventPatch,
	type EventPublishReadiness,
	type EventRootSummary,
	type InvitationAdminSummary,
	type ItineraryInput,
	type ItineraryPatch,
	type MembershipStatus,
	type PlaceInput,
	type PlacePatch,
	type Role,
} from "./domain";
import {
	capabilityEntityId,
	EVENT_TEMPLATES,
	type EventTemplateRequest,
	resolveEventTemplate,
} from "./event-templates";
import {
	type AttachmentContentType,
	type AttachmentTarget,
	type FeedKind,
	type FeedPageKey,
	feedReactionEntityId,
} from "./feed-domain";
import type { FeedbackInput, FeedbackStatus } from "./feedback-domain";
import type { GolfRoundSetupInput } from "./golf-domain";
import {
	InvitationTokenCodec,
	InvitationTokenKeyUnavailableError,
} from "./invitation-token";
import type {
	AttachmentApiObjectStore,
	UploadGrantCodec,
} from "./object-store";
import type { PlaceCandidateKind } from "./place-candidate";
import type {
	PlaceEnrichmentPolicy,
	PlaceEnrichmentReviewDecision,
} from "./place-enrichment";
import type {
	RecapExternalField,
	RecapExternalGrantDecisionInput,
	RecapSourceInput,
} from "./recap-domain";
import {
	hashRecapShareToken,
	RecapShareTokenCodec,
	RecapShareTokenKeyUnavailableError,
} from "./recap-share-token";
import type { EventRepository, PlaceEnrichmentScope } from "./repository";
import {
	type BootstrapCursor,
	InvalidSyncCursorError,
	type PullCursor,
	SYNC_CONTRACT_MAJOR,
	SYNC_PROTOCOL_VERSION,
	type SyncAppliedMutation,
	SyncCursorCodec,
	type SyncEntityType,
	type SyncMutation,
	type SyncPushInput,
	type SyncPushResponse,
} from "./sync";
import type { TeamAssignmentSetInput, TeamDecisionInput } from "./team-domain";

type AttachmentDependencies = {
	objectStore: AttachmentApiObjectStore;
	grantCodec: UploadGrantCodec;
	uploadTtlSeconds: number;
	downloadTtlSeconds: number;
};

export class EventService {
	private readonly syncCursors: SyncCursorCodec;
	private readonly recapShareTokens: RecapShareTokenCodec;
	private readonly invitationTokens: InvitationTokenCodec;

	constructor(
		private readonly repository: EventRepository,
		invitationTokens: InvitationTokenCodec | string,
		private readonly attachments?: AttachmentDependencies,
		private readonly syncCursorKey = "crew-development-sync-cursor-key-change-me",
		recapShareTokens?: RecapShareTokenCodec,
		private readonly placeEnrichmentPolicy?: PlaceEnrichmentPolicy,
	) {
		this.invitationTokens =
			typeof invitationTokens === "string"
				? new InvitationTokenCodec({
						id: "legacy-invitation-v1",
						secret: invitationTokens,
					})
				: invitationTokens;
		this.syncCursors = new SyncCursorCodec(syncCursorKey);
		this.recapShareTokens =
			recapShareTokens ??
			new RecapShareTokenCodec({
				id: "legacy-invitation-v1",
				secret:
					typeof invitationTokens === "string"
						? invitationTokens
						: "crew-development-recap-share-token-key-change-me",
			});
	}

	ready() {
		return this.repository.ready();
	}
	command<T extends Record<string, unknown>>(
		actor: Actor,
		operationId: string,
		idempotencyKey: string,
		request: unknown,
		work: (
			service: EventService,
		) => Promise<{ status: number; body: T; headers: Record<string, string> }>,
		replayGuard?: (
			service: EventService,
			replay: { status: number; body: T; headers: Record<string, string> },
		) => Promise<void>,
	) {
		const requestHash = commandHash(actor, operationId, request);
		const scoped = (repository: EventRepository) =>
			new EventService(
				repository,
				this.invitationTokens,
				this.attachments,
				this.syncCursorKey,
				this.recapShareTokens,
				this.placeEnrichmentPolicy,
			);
		return this.repository.runIdempotent(
			{ actor, operationId, idempotencyKey, requestHash },
			(repository) => work(scoped(repository)),
			undefined,
			replayGuard
				? (repository, replay) => replayGuard(scoped(repository), replay)
				: undefined,
		);
	}
	replayCommand<T extends Record<string, unknown>>(
		actor: Actor,
		operationId: string,
		idempotencyKey: string,
		request: unknown,
		replayGuard?: (
			service: EventService,
			replay: { status: number; body: T; headers: Record<string, string> },
		) => Promise<void>,
	) {
		return this.repository.findIdempotent<T>(
			{
				actor,
				operationId,
				idempotencyKey,
				requestHash: commandHash(actor, operationId, request),
			},
			replayGuard
				? (repository, replay) =>
						replayGuard(
							new EventService(
								repository,
								this.invitationTokens,
								this.attachments,
								this.syncCursorKey,
								this.recapShareTokens,
								this.placeEnrichmentPolicy,
							),
							replay,
						)
				: undefined,
		);
	}

	syncPush(actor: Actor, idempotencyKey: string, input: SyncPushInput) {
		const operationId = "syncMutationsApply";
		const requestHash = commandHash(actor, operationId, input);
		return this.repository.runIdempotent<SyncPushResponse>(
			{ actor, operationId, idempotencyKey, requestHash },
			async (repository) => ({
				status: 200,
				body: await repository.runSyncPush(
					actor,
					input,
					(savepointRepository, mutation) =>
						new EventService(
							savepointRepository,
							this.invitationTokens,
							this.attachments,
							this.syncCursorKey,
							this.recapShareTokens,
						).applySyncMutation(actor, input.rootEventId, mutation),
				),
				headers: {},
			}),
			undefined,
			(repository, replay) => {
				const appliedMutationIds = new Set(
					replay.body.results
						.filter(({ outcome }) => outcome === "applied")
						.map(({ clientMutationId }) => clientMutationId),
				);
				return repository.assertSyncPushReplaySafe(actor, {
					...input,
					mutations: input.mutations.filter(({ clientMutationId }) =>
						appliedMutationIds.has(clientMutationId),
					),
				});
			},
		);
	}

	async syncPull(
		actor: Actor,
		rootEventId: string,
		cursor: string,
		limit: number,
	) {
		const decoded = this.decodeSyncPullCursor(cursor, actor, rootEventId);
		const page = await this.repository.listSyncChanges(
			actor,
			rootEventId,
			{
				rootRevision: decoded.rootRevision,
				ordinal: decoded.ordinal,
			},
			decoded.authorizationScopeVersion,
			limit,
		);
		const checkpointCursor = this.syncCursors.encode({
			v: SYNC_CONTRACT_MAJOR,
			op: "pull",
			actorId: actor.id,
			rootEventId,
			authorizationScopeVersion: page.access.authorizationScopeVersion,
			filters: {},
			rootRevision: page.checkpoint.rootRevision,
			ordinal: page.checkpoint.ordinal,
		});
		return {
			protocolVersion: SYNC_PROTOCOL_VERSION,
			rootEventId,
			authorizationScopeVersion: page.access.authorizationScopeVersion,
			changes: page.changes,
			checkpointCursor,
			pageInfo: {
				hasMore: page.hasMore,
				nextCursor: page.hasMore ? checkpointCursor : null,
			},
		};
	}

	async syncBootstrap(
		actor: Actor,
		rootEventId: string,
		cursor: string | undefined,
		limit: number,
	) {
		const decoded = cursor
			? this.decodeSyncBootstrapCursor(cursor, actor, rootEventId)
			: null;
		const page = await this.repository.readSyncBootstrap(
			actor,
			rootEventId,
			decoded,
			limit,
		);
		const syncCursor = this.syncCursors.encode({
			v: SYNC_CONTRACT_MAJOR,
			op: "pull",
			actorId: actor.id,
			rootEventId,
			authorizationScopeVersion: page.access.authorizationScopeVersion,
			filters: {},
			rootRevision: page.snapshotRevision,
			ordinal: 2_147_483_647,
		});
		const nextCursor = page.hasMore
			? this.syncCursors.encode({
					v: SYNC_CONTRACT_MAJOR,
					op: "bootstrap",
					actorId: actor.id,
					rootEventId,
					authorizationScopeVersion: page.access.authorizationScopeVersion,
					filters: {},
					snapshotId: page.snapshotId,
					offset: page.nextOffset,
					expiresAt: page.expiresAt.toISOString(),
				})
			: null;
		return {
			protocolVersion: SYNC_PROTOCOL_VERSION,
			rootEventId,
			authorizationScopeVersion: page.access.authorizationScopeVersion,
			snapshotId: page.snapshotId,
			snapshotRevision: page.snapshotRevision,
			records: page.records,
			syncCursor,
			pageInfo: { nextCursor, hasMore: page.hasMore },
		};
	}

	private async applySyncMutation(
		actor: Actor,
		rootEventId: string,
		mutation: SyncMutation,
	): Promise<SyncAppliedMutation> {
		const payload = mutation.payload;
		let entity:
			| { entityType: SyncEntityType; entityId: string; version: number }
			| undefined;
		switch (mutation.kind) {
			case "event.create": {
				const event = await this.createEvent(
					actor,
					rootEventId,
					payload.parentEventId as string,
					{
						id: mutation.entityId,
						kind: payload.kind as EventInput["kind"],
						title: payload.title as string,
						description: payload.description as string | null,
						timeZone: payload.timeZone as string,
						startsAt: syncDate(payload.startsAt),
						endsAt: syncDate(payload.endsAt),
						status: payload.status as EventInput["status"],
					},
				);
				entity = syncEntity("event", event.id, event.version);
				break;
			}
			case "event.update": {
				const event = await this.updateEvent(
					actor,
					rootEventId,
					mutation.entityId,
					requiredSyncBaseVersion(mutation),
					syncEventPatch(payload.changes as Record<string, unknown>),
				);
				entity = syncEntity("event", event.id, event.version);
				break;
			}
			case "event.reparent": {
				const event = await this.reparentEvent(
					actor,
					rootEventId,
					mutation.entityId,
					payload.parentEventId as string,
					requiredSyncBaseVersion(mutation),
				);
				entity = syncEntity("event", event.id, event.version);
				break;
			}
			case "event.children.reorder": {
				const result = await this.reorderEvents(
					actor,
					rootEventId,
					mutation.entityId,
					requiredSyncBaseVersion(mutation),
					payload.orderedIds as string[],
				);
				entity = syncEntity("event", result.parent.id, result.parent.version);
				break;
			}
			case "event.archive": {
				const event = await this.archiveEvent(
					actor,
					rootEventId,
					mutation.entityId,
					requiredSyncBaseVersion(mutation),
				);
				entity = syncEntity("event", event.id, event.version);
				break;
			}
			case "event.delete":
				await this.tombstoneEvent(
					actor,
					rootEventId,
					mutation.entityId,
					requiredSyncBaseVersion(mutation),
					payload.subtree as boolean,
				);
				break;
			case "place.create": {
				const place = await this.createPlace(actor, rootEventId, {
					id: mutation.entityId,
					name: payload.name as string,
					locality: payload.locality as string | null,
					countryCode: payload.countryCode as string,
					latitude: payload.latitude as number | null,
					longitude: payload.longitude as number | null,
				});
				entity = syncEntity("place", place.id, place.version);
				break;
			}
			case "place.update": {
				const place = await this.updatePlace(
					actor,
					rootEventId,
					mutation.entityId,
					requiredSyncBaseVersion(mutation),
					(payload.changes ?? {}) as PlacePatch,
				);
				entity = syncEntity("place", place.id, place.version);
				break;
			}
			case "capability.replace": {
				const eventId = payload.eventId as string;
				const input = {
					type: payload.type,
					schemaVersion: payload.schemaVersion,
					config: payload.config,
				} as CapabilityInput;
				if (mutation.entityId !== capabilityEntityId(eventId, input.type))
					throw syncEntityIdMismatch();
				const capability = await this.replaceCapability(
					actor,
					rootEventId,
					eventId,
					requiredSyncNonnegativeBaseVersion(mutation),
					input,
				);
				entity = syncEntity(
					"capability",
					mutation.entityId,
					capability.version,
				);
				break;
			}
			case "capability.remove": {
				const eventId = payload.eventId as string;
				const type = payload.type as CapabilityType;
				if (mutation.entityId !== capabilityEntityId(eventId, type))
					throw syncEntityIdMismatch();
				await this.removeCapability(
					actor,
					rootEventId,
					eventId,
					type,
					requiredSyncBaseVersion(mutation),
				);
				break;
			}
			case "itinerary.create": {
				const item = await this.createItineraryItem(
					actor,
					rootEventId,
					syncItineraryInput(mutation.entityId, payload),
				);
				entity = syncEntity("itineraryItem", item.id, item.version);
				break;
			}
			case "itinerary.update": {
				const item = await this.updateItineraryItem(
					actor,
					rootEventId,
					mutation.entityId,
					requiredSyncBaseVersion(mutation),
					syncItineraryPatch(payload.changes as Record<string, unknown>),
				);
				entity = syncEntity("itineraryItem", item.id, item.version);
				break;
			}
			case "itinerary.reorder": {
				const result = await this.reorderItinerary(
					actor,
					rootEventId,
					mutation.entityId,
					requiredSyncBaseVersion(mutation),
					payload.orderedIds as string[],
				);
				entity = syncEntity("event", result.event.id, result.event.version);
				break;
			}
			case "feed.entry.create": {
				const entry = await this.createFeedEntry(
					actor,
					rootEventId,
					{
						id: mutation.entityId,
						eventId: payload.eventId as string | null,
						parentEntryId: payload.parentEntryId as string | null,
						kind: payload.kind as "message" | "comment",
						body: payload.content as string,
					},
					mutation.clientMutationId,
				);
				entity = syncEntity("feedEntry", entry.id, entry.version);
				break;
			}
			case "feed.entry.revise": {
				const entry = await this.reviseFeedEntry(
					actor,
					rootEventId,
					mutation.entityId,
					requiredSyncBaseVersion(mutation),
					payload.content as string,
				);
				entity = syncEntity("feedEntry", entry.id, entry.version);
				break;
			}
			case "feed.entry.remove": {
				const entry = await this.removeFeedEntry(
					actor,
					rootEventId,
					mutation.entityId,
					requiredSyncBaseVersion(mutation),
				);
				entity = syncEntity("feedEntry", entry.id, entry.version);
				break;
			}
			case "feed.reaction.set": {
				const reaction = await this.setFeedReaction(
					actor,
					rootEventId,
					mutation.entityId,
					payload.reaction as string,
					payload.present as boolean,
				);
				entity = syncEntity(
					"feedReaction",
					feedReactionEntityId(
						reaction.entryId,
						reaction.userId,
						reaction.reaction,
					),
					reaction.version,
				);
				break;
			}
			case "golf.round.replace": {
				const eventId = payload.eventId as string;
				if (mutation.entityId !== eventId) throw syncEntityIdMismatch();
				const result = await this.repository.replaceGolfRound(
					actor,
					rootEventId,
					eventId,
					requiredSyncNonnegativeBaseVersion(mutation),
					{
						holes: payload.holes as GolfRoundSetupInput["holes"],
						players: payload.players as GolfRoundSetupInput["players"],
						teams: payload.teams as GolfRoundSetupInput["teams"],
					},
				);
				entity = syncEntity(
					"golfRound",
					result.round.eventId,
					result.round.version,
				);
				break;
			}
			case "golf.score.set": {
				const score = await this.repository.setGolfScore(
					actor,
					rootEventId,
					payload.eventId as string,
					mutation.entityId,
					requiredSyncNonnegativeBaseVersion(mutation),
					{
						hole: payload.hole as number,
						strokes: payload.strokes as number | null,
						putts: payload.putts as number | null,
					},
				);
				entity = syncEntity("golfScore", score.score.id, score.score.version);
				break;
			}
			case "team.assignments.publish": {
				const eventId = payload.eventId as string;
				if (mutation.entityId !== eventId) throw syncEntityIdMismatch();
				const result = await this.repository.publishTeamAssignments(
					actor,
					rootEventId,
					eventId,
					requiredSyncNonnegativeBaseVersion(mutation),
					{ teams: payload.teams as TeamAssignmentSetInput["teams"] },
				);
				entity = syncEntity(
					"teamAssignmentSet",
					result.assignments.eventId,
					result.assignments.version,
				);
				break;
			}
			case "team.decision.replace": {
				const result = await this.repository.replaceTeamDecision(
					actor,
					rootEventId,
					payload.eventId as string,
					mutation.entityId,
					requiredSyncNonnegativeBaseVersion(mutation),
					{
						title: payload.title as string,
						state: payload.state as TeamDecisionInput["state"],
						options: payload.options as TeamDecisionInput["options"],
					},
				);
				entity = syncEntity(
					"teamDecision",
					result.decision.id,
					result.decision.aggregateVersion,
				);
				break;
			}
			case "team.response.set": {
				const result = await this.repository.setTeamResponse(
					actor,
					rootEventId,
					payload.eventId as string,
					payload.decisionId as string,
					mutation.entityId,
					requiredSyncNonnegativeBaseVersion(mutation),
					payload.optionId as string,
				);
				entity = syncEntity(
					"teamResponse",
					result.response.id,
					result.response.version,
				);
				break;
			}
			case "attachment.commit": {
				const attachment = await this.commitAttachment(
					actor,
					rootEventId,
					payload.uploadId as string,
					payload.caption as string | null,
				);
				if (attachment.id !== mutation.entityId)
					throw new DomainError(
						409,
						"ATTACHMENT_ID_MISMATCH",
						"The upload is bound to a different attachment ID.",
					);
				entity = syncEntity("attachment", attachment.id, attachment.version);
				break;
			}
		}
		return {
			rootRevision: await this.repository.readSyncRootRevision(
				actor,
				rootEventId,
			),
			...(entity ? { entity } : {}),
		};
	}

	private decodeSyncPullCursor(
		cursor: string,
		actor: Actor,
		rootEventId: string,
	): PullCursor {
		try {
			const decoded = this.syncCursors.decode<PullCursor>(cursor, "pull");
			if (
				decoded.actorId !== actor.id ||
				decoded.rootEventId !== rootEventId ||
				!emptySyncFilters(decoded.filters) ||
				!/^\d+$/.test(decoded.rootRevision) ||
				!Number.isInteger(decoded.ordinal) ||
				decoded.ordinal < 0
			)
				throw new InvalidSyncCursorError();
			return decoded;
		} catch (error) {
			if (error instanceof InvalidSyncCursorError) throw syncCursorInvalid();
			throw error;
		}
	}

	private decodeSyncBootstrapCursor(
		cursor: string,
		actor: Actor,
		rootEventId: string,
	): BootstrapCursor {
		try {
			const decoded = this.syncCursors.decode<BootstrapCursor>(
				cursor,
				"bootstrap",
			);
			const expiresAt = new Date(decoded.expiresAt);
			if (
				decoded.actorId !== actor.id ||
				decoded.rootEventId !== rootEventId ||
				!emptySyncFilters(decoded.filters) ||
				!/^snp_[a-f0-9]{32}$/.test(decoded.snapshotId) ||
				!Number.isSafeInteger(decoded.offset) ||
				decoded.offset < 0 ||
				Number.isNaN(expiresAt.getTime())
			)
				throw new InvalidSyncCursorError();
			if (expiresAt <= new Date()) throw syncBootstrapExpired();
			return decoded;
		} catch (error) {
			if (error instanceof InvalidSyncCursorError) throw syncCursorInvalid();
			throw error;
		}
	}
	listEventTemplates() {
		return EVENT_TEMPLATES;
	}
	createRoot(
		actor: Actor,
		input: EventInput,
		template?: EventTemplateRequest | undefined,
	) {
		assertRootCreationStatus(input);
		return template
			? this.repository.createRootFromTemplate(
					actor,
					input,
					resolveEventTemplate(template, input),
				)
			: this.repository.createRoot(actor, input);
	}
	adoptRootTemplate(
		actor: Actor,
		rootEventId: string,
		baseVersion: number,
		baseRevision: string,
		template: EventTemplateRequest,
	) {
		return this.repository.adoptRootTemplate(
			actor,
			rootEventId,
			baseVersion,
			baseRevision,
			template,
		);
	}
	async listRoots(
		actor: Actor,
		query: CursorQuery & { includeArchived?: boolean } = {},
	) {
		const limit = pageLimit(query.limit);
		const includeArchived = query.includeArchived ?? false;
		const scope = { filters: { includeArchived: String(includeArchived) } };
		const last = query.cursor
			? this.decodeCursor(query.cursor, actor, "eventRootsList", scope)
			: null;
		const rootEventId = last ? stringField(last, "rootEventId") : null;
		if (last && !rootEventId) throw cursorInvalid();
		const page = await this.repository.listRoots(actor, {
			includeArchived,
			limit,
			after: rootEventId ? { rootEventId } : null,
		});
		return this.cursorPage<EventRootSummary>(
			page,
			actor,
			"eventRootsList",
			scope,
			(item) => ({ rootEventId: item.rootEventId }),
		);
	}
	getRoot(actor: Actor, rootEventId: string) {
		return this.repository.getRoot(actor, rootEventId);
	}
	getPublishReadiness(
		actor: Actor,
		rootEventId: string,
	): Promise<EventPublishReadiness> {
		return this.repository.getPublishReadiness(actor, rootEventId);
	}
	publishRoot(
		actor: Actor,
		rootEventId: string,
		baseVersion: number,
		baseRevision: string,
	) {
		return this.repository.publishRoot(
			actor,
			rootEventId,
			baseVersion,
			baseRevision,
		);
	}
	generateRecap(
		actor: Actor,
		rootEventId: string,
		baseRevision: string,
		sources: RecapSourceInput[],
	) {
		return this.repository.generateRecap(
			actor,
			rootEventId,
			baseRevision,
			sources,
		);
	}
	getRecap(actor: Actor, rootEventId: string, version?: number) {
		return this.repository.getRecap(actor, rootEventId, version);
	}
	assertRecapReplaySafe(
		actor: Actor,
		rootEventId: string,
		recapVersion: number | null,
	) {
		return this.repository.assertRecapReplaySafe(
			actor,
			rootEventId,
			recapVersion,
		);
	}
	assertRootReplaySafe(
		actor: Actor,
		rootEventId: string,
		access: "member" | "manager" | "writer",
	) {
		return this.repository.assertRootReplaySafe(actor, rootEventId, access);
	}
	assertFeedReplaySafe(
		actor: Actor,
		rootEventId: string,
		entryId: string,
		expectedVersion: number | null,
		expectedRootRevision: string | null,
		requireLive: boolean,
	) {
		return this.repository.assertFeedReplaySafe(
			actor,
			rootEventId,
			entryId,
			expectedVersion,
			expectedRootRevision,
			requireLive,
		);
	}
	assertAttachmentReplaySafe(
		actor: Actor,
		rootEventId: string,
		attachmentId: string | null,
	) {
		return this.repository.assertAttachmentReplaySafe(
			actor,
			rootEventId,
			attachmentId,
		);
	}
	publishRecap(
		actor: Actor,
		rootEventId: string,
		recapVersion: number,
		baseLifecycleVersion: number,
	) {
		return this.repository.publishRecap(
			actor,
			rootEventId,
			recapVersion,
			baseLifecycleVersion,
		);
	}
	removeRecap(actor: Actor, rootEventId: string, baseLifecycleVersion: number) {
		return this.repository.removeRecap(
			actor,
			rootEventId,
			baseLifecycleVersion,
		);
	}
	async createRecapShareLink(
		actor: Actor,
		rootEventId: string,
		recapVersion: number,
		projectionConsent: "title-only-reviewed",
	) {
		const id = `rsh_${randomBytes(18).toString("base64url")}`;
		const issued = this.recapShareTokens.issue(id);
		const shareLink = await this.repository.createRecapShareLink(
			actor,
			rootEventId,
			{
				id,
				recapVersion,
				tokenHash: hashRecapShareToken(issued.token),
				tokenKeyId: issued.keyId,
				projectionConsent,
			},
		);
		return { shareLink, token: issued.token };
	}
	revokeRecapShareLink(actor: Actor, rootEventId: string, shareLinkId: string) {
		return this.repository.revokeRecapShareLink(
			actor,
			rootEventId,
			shareLinkId,
		);
	}
	resolveRecapShareLink(token: string) {
		return this.repository.resolveRecapShareLink(hashRecapShareToken(token));
	}
	decideRecapExternalGrant(
		actor: Actor,
		rootEventId: string,
		recapVersion: number,
		input: RecapExternalGrantDecisionInput,
	) {
		return this.repository.decideRecapExternalGrant(
			actor,
			rootEventId,
			recapVersion,
			input,
		);
	}
	async createRecapExternalShareLink(
		actor: Actor,
		rootEventId: string,
		recapVersion: number,
		projectionConsent: "exact-fields-reviewed-v1",
		fields: RecapExternalField[],
	) {
		const id = `rsh_${randomBytes(18).toString("base64url")}`;
		const issued = this.recapShareTokens.issue(id);
		const shareLink = await this.repository.createRecapExternalShareLink(
			actor,
			rootEventId,
			{
				id,
				recapVersion,
				tokenHash: hashRecapShareToken(issued.token),
				tokenKeyId: issued.keyId,
				projectionConsent,
				fields,
			},
		);
		return { shareLink, token: issued.token };
	}
	resolveRecapExternalShareLink(token: string) {
		return this.repository.resolveRecapExternalShareLink(
			hashRecapShareToken(token),
		);
	}
	assertRecapShareLinkReplaySafe(
		actor: Actor,
		rootEventId: string,
		shareLinkId: string | null,
	) {
		return this.repository.assertRecapShareLinkReplaySafe(
			actor,
			rootEventId,
			shareLinkId,
		);
	}
	assertRecapExternalGrantReplaySafe(
		actor: Actor,
		rootEventId: string,
		recapVersion: number,
		input: RecapExternalGrantDecisionInput,
	) {
		return this.repository.assertRecapExternalGrantReplaySafe(
			actor,
			rootEventId,
			recapVersion,
			input,
		);
	}
	getEvent(actor: Actor, rootEventId: string, eventId: string) {
		return this.repository.getEvent(actor, rootEventId, eventId);
	}
	createEvent(
		actor: Actor,
		rootEventId: string,
		parentEventId: string,
		input: EventInput,
	) {
		return this.repository.createEvent(
			actor,
			rootEventId,
			parentEventId,
			input,
		);
	}
	updateEvent(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseVersion: number,
		patch: EventPatch,
	) {
		return this.repository.updateEvent(
			actor,
			rootEventId,
			eventId,
			baseVersion,
			patch,
		);
	}
	reparentEvent(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		parentEventId: string,
		baseVersion: number,
	) {
		return this.repository.reparentEvent(
			actor,
			rootEventId,
			eventId,
			parentEventId,
			baseVersion,
		);
	}
	reorderEvents(
		actor: Actor,
		rootEventId: string,
		parentEventId: string,
		baseOrderVersion: number,
		orderedIds: string[],
	) {
		return this.repository.reorderEvents(
			actor,
			rootEventId,
			parentEventId,
			baseOrderVersion,
			orderedIds,
		);
	}
	archiveEvent(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseVersion: number,
	) {
		return this.repository.archiveEvent(
			actor,
			rootEventId,
			eventId,
			baseVersion,
		);
	}
	tombstoneEvent(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseVersion: number,
		subtree: boolean,
	) {
		return this.repository.tombstoneEvent(
			actor,
			rootEventId,
			eventId,
			baseVersion,
			subtree,
		);
	}
	async listMemberships(
		actor: Actor,
		rootEventId: string,
		query: CursorQuery = {},
	) {
		const limit = pageLimit(query.limit);
		const last = query.cursor
			? this.decodeCursor(query.cursor, actor, "eventMembershipsList", {
					rootEventId,
				})
			: null;
		const after =
			last && stringField(last, "userId")
				? { userId: stringField(last, "userId") as string }
				: null;
		if (last && !after) throw cursorInvalid();
		const page = await this.repository.listMemberships(actor, rootEventId, {
			limit,
			after,
		});
		return this.cursorPage(
			page,
			actor,
			"eventMembershipsList",
			{ rootEventId },
			(item) => ({ userId: item.userId }),
		);
	}
	async listMemberDirectorySource(
		actor: Actor,
		rootEventId: string,
		query: CursorQuery = {},
	) {
		const limit = pageLimit(query.limit);
		const last = query.cursor
			? this.decodeCursor(
					query.cursor,
					actor,
					"eventMemberDirectorySourceGet",
					{
						rootEventId,
					},
				)
			: null;
		const after =
			last && stringField(last, "userId")
				? { userId: stringField(last, "userId") as string }
				: null;
		if (last && !after) throw cursorInvalid();
		const page = await this.repository.listActiveMembershipUserIds(
			actor,
			rootEventId,
			{ limit, after },
		);
		return this.cursorPage(
			page,
			actor,
			"eventMemberDirectorySourceGet",
			{ rootEventId },
			(item) => ({ userId: item.userId }),
		);
	}
	updateMembership(
		actor: Actor,
		rootEventId: string,
		userId: string,
		baseVersion: number,
		role: Role,
		status: MembershipStatus,
		reason: string | null,
	) {
		return this.repository.updateMembership(
			actor,
			rootEventId,
			userId,
			baseVersion,
			role,
			status,
			reason,
		);
	}
	transferOwnership(
		actor: Actor,
		rootEventId: string,
		userId: string,
		ownerBaseVersion: number,
		targetBaseVersion: number,
	) {
		return this.repository.transferOwnership(
			actor,
			rootEventId,
			userId,
			ownerBaseVersion,
			targetBaseVersion,
		);
	}
	async listInvitations(
		actor: Actor,
		rootEventId: string,
		query: CursorQuery = {},
	) {
		const limit = pageLimit(query.limit);
		const last = query.cursor
			? this.decodeCursor(query.cursor, actor, "eventInvitationsList", {
					rootEventId,
				})
			: null;
		const after =
			last && stringField(last, "id")
				? { id: stringField(last, "id") as string }
				: null;
		if (last && !after) throw cursorInvalid();
		const page = await this.repository.listInvitations(actor, rootEventId, {
			limit,
			after,
		});
		return this.cursorPage<InvitationAdminSummary>(
			page,
			actor,
			"eventInvitationsList",
			{ rootEventId },
			(item) => ({ id: item.id }),
		);
	}

	async createInvitation(
		actor: Actor,
		rootEventId: string,
		input: {
			id: string;
			role: Exclude<Role, "owner">;
			normalizedEmailHint?: string | null;
			expiresAt: Date;
			maxUses: number;
		},
	) {
		const { keyId, token } = this.invitationTokens.currentToken(input.id);
		const normalizedEmailHint = input.normalizedEmailHint
			? normalizeEmail(input.normalizedEmailHint)
			: null;
		if (
			normalizedEmailHint &&
			(normalizedEmailHint.length > 254 ||
				!/^[^\s@]+@[^\s@]+$/.test(normalizedEmailHint))
		) {
			throw new DomainError(
				400,
				"INVITATION_EMAIL_INVALID",
				"The invitation email hint is invalid.",
			);
		}
		const invitation = await this.repository.createInvitation(
			actor,
			rootEventId,
			{
				...input,
				normalizedEmailHint,
				tokenHash: hashToken(token),
				tokenKeyId: keyId,
			},
		);
		return {
			invitation,
			token: this.invitationTokens.token(input.id, invitation.tokenKeyId),
		};
	}

	previewInvitation(token: string, now: Date) {
		return this.repository.previewInvitation(hashToken(token), now);
	}
	redeemInvitation(actor: Actor, token: string, now: Date) {
		return this.repository.redeemInvitation(actor, hashToken(token), now);
	}
	revokeInvitation(
		actor: Actor,
		rootEventId: string,
		invitationId: string,
		baseVersion: number,
	) {
		return this.repository.revokeInvitation(
			actor,
			rootEventId,
			invitationId,
			baseVersion,
		);
	}
	createPlace(actor: Actor, rootEventId: string, input: PlaceInput) {
		return this.repository.createPlace(actor, rootEventId, input);
	}
	async listPlaces(actor: Actor, rootEventId: string, query: CursorQuery = {}) {
		const limit = pageLimit(query.limit);
		const last = query.cursor
			? this.decodeCursor(query.cursor, actor, "eventPlacesList", {
					rootEventId,
				})
			: null;
		const name = last ? stringField(last, "name") : null;
		const id = last ? stringField(last, "id") : null;
		if (last && (!name || !id)) throw cursorInvalid();
		const page = await this.repository.listPlaces(actor, rootEventId, {
			limit,
			after: name && id ? { name, id } : null,
		});
		return this.cursorPage(
			page,
			actor,
			"eventPlacesList",
			{ rootEventId },
			(item) => ({ name: item.name, id: item.id }),
		);
	}
	updatePlace(
		actor: Actor,
		rootEventId: string,
		placeId: string,
		baseVersion: number,
		patch: PlacePatch,
	) {
		return this.repository.updatePlace(
			actor,
			rootEventId,
			placeId,
			baseVersion,
			patch,
		);
	}
	replaceCapability(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseVersion: number,
		input: CapabilityInput,
	) {
		return this.repository.replaceCapability(
			actor,
			rootEventId,
			eventId,
			baseVersion,
			input,
		);
	}
	removeCapability(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		type: CapabilityType,
		baseVersion: number,
	) {
		return this.repository.removeCapability(
			actor,
			rootEventId,
			eventId,
			type,
			baseVersion,
		);
	}
	createItineraryItem(
		actor: Actor,
		rootEventId: string,
		input: ItineraryInput,
	) {
		return this.repository.createItineraryItem(actor, rootEventId, input);
	}
	async listItinerary(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		query: CursorQuery = {},
	) {
		const limit = pageLimit(query.limit);
		const last = query.cursor
			? this.decodeCursor(query.cursor, actor, "eventItineraryItemsList", {
					rootEventId,
					eventId,
				})
			: null;
		const sortPosition = last ? stringField(last, "sortPosition") : null;
		const id = last ? stringField(last, "id") : null;
		if (last && (!sortPosition || !/^\d+$/.test(sortPosition) || !id))
			throw cursorInvalid();
		const page = await this.repository.listItinerary(
			actor,
			rootEventId,
			eventId,
			{
				limit,
				after: sortPosition && id ? { sortPosition, id } : null,
			},
		);
		return this.cursorPage(
			page,
			actor,
			"eventItineraryItemsList",
			{ rootEventId, eventId },
			(item) => ({ sortPosition: item.sortPosition, id: item.id }),
		);
	}
	updateItineraryItem(
		actor: Actor,
		rootEventId: string,
		itemId: string,
		baseVersion: number,
		patch: ItineraryPatch,
	) {
		return this.repository.updateItineraryItem(
			actor,
			rootEventId,
			itemId,
			baseVersion,
			patch,
		);
	}
	reorderItinerary(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseOrderVersion: number,
		orderedIds: string[],
	) {
		return this.repository.reorderItinerary(
			actor,
			rootEventId,
			eventId,
			baseOrderVersion,
			orderedIds,
		);
	}

	createFeedEntry(
		actor: Actor,
		rootEventId: string,
		input: {
			id: string;
			eventId: string | null;
			parentEntryId: string | null;
			kind: "message" | "comment";
			body: string;
		},
		causationRequestId: string = crypto.randomUUID(),
	) {
		return this.repository.createFeedEntry(
			actor,
			rootEventId,
			input,
			causationRequestId,
		);
	}

	async listFeedEntries(
		actor: Actor,
		rootEventId: string,
		query: CursorQuery & {
			eventId?: string | undefined;
			kind?: FeedKind | undefined;
		},
	) {
		const limit = pageLimit(query.limit);
		const eventId = query.eventId ?? null;
		const kind = query.kind ?? null;
		const last = query.cursor
			? this.decodeCursor(query.cursor, actor, "eventFeedEntriesList", {
					rootEventId,
					filters: { eventId, kind },
				})
			: null;
		const rootRevision = last ? stringField(last, "rootRevision") : null;
		const id = last ? stringField(last, "id") : null;
		if (last && (!rootRevision || !/^[1-9]\d*$/.test(rootRevision) || !id))
			throw cursorInvalid();
		const page = await this.repository.listFeedEntries(actor, rootEventId, {
			limit,
			after:
				rootRevision && id
					? ({ rootRevision, id } satisfies FeedPageKey)
					: null,
			eventId,
			kind,
		});
		return this.cursorPage(
			page,
			actor,
			"eventFeedEntriesList",
			{ rootEventId, filters: { eventId, kind } },
			(entry) => ({ rootRevision: entry.createdRootRevision, id: entry.id }),
		);
	}

	getFeedEntry(actor: Actor, rootEventId: string, entryId: string) {
		return this.repository.getFeedEntry(actor, rootEventId, entryId);
	}

	reviseFeedEntry(
		actor: Actor,
		rootEventId: string,
		entryId: string,
		baseVersion: number,
		body: string,
	) {
		return this.repository.reviseFeedEntry(
			actor,
			rootEventId,
			entryId,
			baseVersion,
			body,
		);
	}

	removeFeedEntry(
		actor: Actor,
		rootEventId: string,
		entryId: string,
		baseVersion: number,
	) {
		return this.repository.removeFeedEntry(
			actor,
			rootEventId,
			entryId,
			baseVersion,
		);
	}

	setFeedReaction(
		actor: Actor,
		rootEventId: string,
		entryId: string,
		reaction: string,
		present: boolean,
	) {
		return this.repository.setFeedReaction(
			actor,
			rootEventId,
			entryId,
			reaction,
			present,
		);
	}

	async prepareAttachmentUpload(
		actor: Actor,
		input: {
			rootEventId: string;
			attachmentId: string;
			contentType: AttachmentContentType;
			byteCount: number;
			sha256: string;
		} & ({ target: AttachmentTarget } | { targetEntryId: string }),
	) {
		const attachments = this.requiredAttachments();
		const target: AttachmentTarget =
			"target" in input
				? input.target
				: { kind: "feedEntry", entryId: input.targetEntryId };
		const id = opaqueId("upl");
		const quarantineObjectKey = attachmentQuarantineKey({ ...input, id });
		const expiresAt = new Date(
			Date.now() + attachments.uploadTtlSeconds * 1000,
		);
		const grant = await attachments.objectStore.createUploadGrant({
			key: quarantineObjectKey,
			contentType: input.contentType,
			byteCount: input.byteCount,
			sha256: input.sha256,
			expiresAt,
		});
		const scope = {
			id,
			attachmentId: input.attachmentId,
			rootEventId: input.rootEventId,
			target,
			targetEntryId: target.kind === "feedEntry" ? target.entryId : null,
			quarantineObjectKey,
			contentType: input.contentType,
			byteCount: input.byteCount,
			sha256: input.sha256,
		};
		return this.repository.createAttachmentUpload(actor, {
			...scope,
			grantKid: attachments.grantCodec.kid,
			grantCiphertext: attachments.grantCodec.seal(grant, scope),
			expiresAt,
		});
	}

	assertAttachmentTargetReplaySafe(
		actor: Actor,
		rootEventId: string,
		target: AttachmentTarget,
	) {
		return this.repository.assertAttachmentTargetReplaySafe(
			actor,
			rootEventId,
			target,
		);
	}

	assertAttachmentUploadReplaySafe(
		actor: Actor,
		rootEventId: string,
		uploadId: string,
	) {
		return this.repository.assertAttachmentUploadReplaySafe(
			actor,
			rootEventId,
			uploadId,
		);
	}

	assertAttachmentFinalizeReplaySafe(
		actor: Actor,
		rootEventId: string,
		uploadId: string,
		attachmentId: string,
	) {
		return this.repository.assertAttachmentFinalizeReplaySafe(
			actor,
			rootEventId,
			uploadId,
			attachmentId,
		);
	}

	async attachmentUploadGrant(
		actor: Actor,
		rootEventId: string,
		uploadId: string,
	) {
		const upload = await this.repository.getAttachmentUpload(
			actor,
			rootEventId,
			uploadId,
		);
		return {
			upload,
			grant: this.requiredAttachments().grantCodec.open(upload),
		};
	}

	ensureAttachmentVerification(
		actor: Actor,
		rootEventId: string,
		uploadId: string,
	) {
		return this.repository.ensureAttachmentVerification(
			actor,
			rootEventId,
			uploadId,
		);
	}

	commitAttachment(
		actor: Actor,
		rootEventId: string,
		uploadId: string,
		caption: string | null,
	) {
		return this.repository.commitAttachment(
			actor,
			rootEventId,
			uploadId,
			caption,
		);
	}

	async attachmentDownload(
		actor: Actor,
		rootEventId: string,
		attachmentId: string,
	) {
		const attachments = this.requiredAttachments();
		const attachment = await this.repository.getAttachment(
			actor,
			rootEventId,
			attachmentId,
		);
		const expiresAt = new Date(
			Date.now() + attachments.downloadTtlSeconds * 1000,
		);
		const grant = await attachments.objectStore.createDownloadGrant({
			key: attachment.objectKey,
			expiresAt,
		});
		return { attachment, grant };
	}

	assertFeedbackReplaySafe(
		actor: Actor,
		feedbackId: string,
		access: "read" | "member" | "manage",
	) {
		return this.repository.assertFeedbackReplaySafe(actor, feedbackId, access);
	}

	createFeedback(actor: Actor, input: FeedbackInput) {
		return this.repository.createFeedback(actor, input);
	}

	getFeedback(actor: Actor, feedbackId: string) {
		return this.repository.getFeedback(actor, feedbackId);
	}

	setFeedbackVote(actor: Actor, feedbackId: string, present: boolean) {
		return this.repository.setFeedbackVote(actor, feedbackId, present);
	}

	addFeedbackComment(
		actor: Actor,
		feedbackId: string,
		input: { id: string; body: string },
	) {
		return this.repository.addFeedbackComment(actor, feedbackId, input);
	}

	markFeedbackDuplicate(
		actor: Actor,
		feedbackId: string,
		canonicalFeedbackId: string,
		note: string | null,
	) {
		return this.repository.markFeedbackDuplicate(
			actor,
			feedbackId,
			canonicalFeedbackId,
			note,
		);
	}

	setFeedbackStatus(
		actor: Actor,
		feedbackId: string,
		status: Exclude<FeedbackStatus, "duplicate">,
		note: string | null,
	) {
		return this.repository.setFeedbackStatus(actor, feedbackId, status, note);
	}

	assertCommunityFeedbackReplaySafe(
		actor: Actor,
		rootEventId: string,
		feedbackId: string,
		expectedCanonicalId: string,
	) {
		return this.repository.assertCommunityFeedbackReplaySafe(
			actor,
			rootEventId,
			feedbackId,
			expectedCanonicalId,
		);
	}

	async listCommunityFeedback(
		actor: Actor,
		rootEventId: string,
		query: CursorQuery & {
			status?: CommunityFeedbackStatus | undefined;
			followedOnly?: boolean | undefined;
		},
	) {
		const limit = pageLimit(query.limit, 10);
		const status = query.status ?? null;
		const followedOnly = query.followedOnly ?? false;
		const scope = {
			rootEventId,
			filters: { status, followedOnly: String(followedOnly) },
		};
		const last = query.cursor
			? this.decodeCursor(query.cursor, actor, "eventFeedbackList", scope)
			: null;
		const updatedAt = last ? cursorTimestamp(last, "updatedAt") : null;
		const id = last ? stringField(last, "id") : null;
		if (last && (!updatedAt || !id)) throw cursorInvalid();
		const page = await this.repository.listCommunityFeedback(
			actor,
			rootEventId,
			{
				limit,
				after: updatedAt && id ? { updatedAt, id } : null,
				status,
				followedOnly,
			},
		);
		return this.cursorPage(page, actor, "eventFeedbackList", scope, (item) => ({
			updatedAt: item.cursorUpdatedAt,
			id: item.id,
		}));
	}

	async listCommunityFeedbackDuplicateSuggestions(
		actor: Actor,
		rootEventId: string,
		query: CursorQuery & { q: string },
	) {
		const limit = pageLimit(query.limit, 5);
		if (Array.from(query.q).length < 2 || Array.from(query.q).length > 500) {
			throw new DomainError(
				400,
				"FEEDBACK_SEARCH_INVALID",
				"The feedback search query must contain between 2 and 500 characters.",
			);
		}
		const normalized = normalizeCommunityFeedbackSearch(query.q);
		if (!normalized.query || normalized.tokens.length === 0) {
			throw new DomainError(
				400,
				"FEEDBACK_SEARCH_INVALID",
				"The feedback search query must contain letters or numbers.",
			);
		}
		const scope = {
			rootEventId,
			filters: { q: normalized.query },
		};
		const last = query.cursor
			? this.decodeCursor(
					query.cursor,
					actor,
					"eventFeedbackDuplicateSuggestionsList",
					scope,
				)
			: null;
		const rank = last ? nonnegativeIntegerField(last, "rank") : null;
		const updatedAt = last ? cursorTimestamp(last, "updatedAt") : null;
		const id = last ? stringField(last, "id") : null;
		if (last && (rank === null || !updatedAt || !id)) throw cursorInvalid();
		const page =
			await this.repository.listCommunityFeedbackDuplicateSuggestions(
				actor,
				rootEventId,
				{
					limit,
					tokens: normalized.tokens,
					after:
						rank !== null && updatedAt && id ? { rank, updatedAt, id } : null,
				},
			);
		return this.cursorPage(
			page,
			actor,
			"eventFeedbackDuplicateSuggestionsList",
			scope,
			(item) => ({
				rank: String(item.cursorRank),
				updatedAt: item.cursorUpdatedAt,
				id: item.id,
			}),
		);
	}

	async listCommunityFeedbackUpdates(
		actor: Actor,
		rootEventId: string,
		query: CursorQuery & { followedOnly?: boolean | undefined },
	) {
		const limit = pageLimit(query.limit, 50);
		const followedOnly = query.followedOnly ?? false;
		const scope = {
			rootEventId,
			filters: { followedOnly: String(followedOnly) },
		};
		const last = query.cursor
			? this.decodeCursor(
					query.cursor,
					actor,
					"eventFeedbackUpdatesList",
					scope,
				)
			: null;
		const changedAt = last ? cursorTimestamp(last, "changedAt") : null;
		const feedbackId = last ? stringField(last, "feedbackId") : null;
		const version = last ? positiveIntegerField(last, "version") : null;
		if (last && (!changedAt || !feedbackId || !version)) throw cursorInvalid();
		const page = await this.repository.listCommunityFeedbackUpdates(
			actor,
			rootEventId,
			{
				limit,
				after:
					changedAt && feedbackId && version
						? { changedAt, feedbackId, version }
						: null,
				followedOnly,
			},
		);
		return this.cursorPage(
			page,
			actor,
			"eventFeedbackUpdatesList",
			scope,
			(item) => ({
				changedAt: item.cursorChangedAt,
				feedbackId: item.feedbackId,
				version: String(item.version),
			}),
		);
	}

	getCommunityFeedback(actor: Actor, rootEventId: string, feedbackId: string) {
		return this.repository.getCommunityFeedback(actor, rootEventId, feedbackId);
	}

	setCommunityFeedbackVote(
		actor: Actor,
		rootEventId: string,
		feedbackId: string,
		present: boolean,
	) {
		return this.repository.setCommunityFeedbackVote(
			actor,
			rootEventId,
			feedbackId,
			present,
		);
	}

	addCommunityFeedbackComment(
		actor: Actor,
		rootEventId: string,
		feedbackId: string,
		input: { id: string; body: string },
	) {
		return this.repository.addCommunityFeedbackComment(
			actor,
			rootEventId,
			feedbackId,
			input,
		);
	}

	setCommunityFeedbackFollow(
		actor: Actor,
		rootEventId: string,
		feedbackId: string,
		followed: boolean,
	) {
		return this.repository.setCommunityFeedbackFollow(
			actor,
			rootEventId,
			feedbackId,
			followed,
		);
	}

	async requestPlaceEnrichmentCandidate(
		actor: Actor,
		scope: PlaceEnrichmentScope,
		candidateId: string,
	) {
		return concealPlaceEnrichmentAccess(
			this.repository.requestPlaceEnrichmentCandidate(
				actor,
				scope,
				candidateId,
				await this.requiredPlaceEnrichmentPolicy(),
			),
		);
	}

	async assertPlaceEnrichmentAvailable() {
		await this.requiredPlaceEnrichmentPolicy();
	}

	async requestPlaceEnrichmentSearchMiss(
		actor: Actor,
		scope: PlaceEnrichmentScope,
		input: {
			query: string;
			kind: PlaceCandidateKind;
			countryCode: string;
		},
	) {
		return concealPlaceEnrichmentAccess(
			this.repository.requestPlaceEnrichmentSearchMiss(
				actor,
				scope,
				input,
				await this.requiredPlaceEnrichmentPolicy(),
			),
		);
	}

	async getPlaceEnrichment(actor: Actor, rootEventId: string, id: string) {
		if (!/^pej_[a-f0-9]{64}$/.test(id)) throw placeEnrichmentNotFound();
		const result = await concealPlaceEnrichmentAccess(
			this.repository.getPlaceEnrichment(actor, rootEventId, id),
		);
		if (!result) throw placeEnrichmentNotFound();
		return result;
	}

	async assertPlaceEnrichmentCreateReplaySafe(
		actor: Actor,
		scope: PlaceEnrichmentScope,
		id: string | null,
	) {
		try {
			await this.repository.assertPlaceEnrichmentCreateScope(actor, scope);
			if (id !== null) {
				const result = await this.getPlaceEnrichment(
					actor,
					scope.rootEventId,
					id,
				);
				if (
					!result.associationScopes.some(
						(associationScope) =>
							associationScope.eventId === scope.eventId &&
							associationScope.capabilityType === scope.capabilityType,
					)
				) {
					throw placeEnrichmentNotFound();
				}
			}
		} catch (error) {
			if (
				error instanceof DomainError &&
				(error.status === 403 ||
					error.status === 404 ||
					error.code === "PLACE_ENRICHMENT_SCOPE_INVALID")
			)
				throw placeEnrichmentNotFound();
			throw error;
		}
	}

	async requestPlaceEnrichmentRetry(
		actor: Actor,
		rootEventId: string,
		id: string,
	) {
		await this.requiredPlaceEnrichmentPolicy();
		if (!/^pej_[a-f0-9]{64}$/.test(id)) throw placeEnrichmentNotFound();
		await concealPlaceEnrichmentAccess(
			this.repository.requestPlaceEnrichmentRetry(actor, rootEventId, id),
		);
		return this.getPlaceEnrichment(actor, rootEventId, id);
	}

	async reviewPlaceEnrichment(
		actor: Actor,
		scope: PlaceEnrichmentScope,
		id: string,
		decision: PlaceEnrichmentReviewDecision,
	) {
		if (!/^pej_[a-f0-9]{64}$/.test(id)) throw placeEnrichmentNotFound();
		return concealPlaceEnrichmentAccess(
			this.repository.reviewPlaceEnrichment(actor, scope, id, decision),
		);
	}

	async assertPlaceEnrichmentReviewReplaySafe(
		actor: Actor,
		scope: PlaceEnrichmentScope,
		id: string,
		decision: PlaceEnrichmentReviewDecision,
	) {
		await this.assertPlaceEnrichmentCreateReplaySafe(actor, scope, id);
		const result = await this.getPlaceEnrichment(actor, scope.rootEventId, id);
		const expectedState =
			decision === "approve" ? "human_approved" : "rejected";
		if (
			result.job.target.type !== "search_miss" ||
			result.job.status !== "succeeded" ||
			result.fields.length < 2 ||
			result.fields.some(
				({ approvalState }) => approvalState !== expectedState,
			) ||
			(decision === "approve") !== (result.globalPlaceId !== null)
		) {
			throw placeEnrichmentNotFound();
		}
	}

	async tokenForInvitation(
		actor: Actor,
		rootEventId: string,
		invitationId: string,
	) {
		const keyId = await this.repository.invitationTokenKeyId(
			actor,
			rootEventId,
			invitationId,
		);
		if (!keyId) throw new DomainError(404, "NOT_FOUND", "Resource not found.");
		try {
			return this.invitationTokens.token(invitationId, keyId);
		} catch (error) {
			if (!(error instanceof InvitationTokenKeyUnavailableError)) throw error;
			throw new DomainError(404, "NOT_FOUND", "Resource not found.");
		}
	}

	async tokenForRecapShareLink(
		actor: Actor,
		rootEventId: string,
		shareLinkId: string,
	) {
		const keyId = await this.repository.assertRecapShareLinkReplaySafe(
			actor,
			rootEventId,
			shareLinkId,
		);
		if (keyId === null)
			throw new DomainError(404, "NOT_FOUND", "Resource not found.");
		try {
			return this.recapShareTokens.token(shareLinkId, keyId);
		} catch (error) {
			if (!(error instanceof RecapShareTokenKeyUnavailableError)) throw error;
			throw new DomainError(404, "NOT_FOUND", "Resource not found.");
		}
	}

	private cursorPage<T>(
		page: { items: T[]; hasMore: boolean },
		actor: Actor,
		operation: string,
		scope: {
			rootEventId?: string;
			eventId?: string;
			filters?: Record<string, string | null>;
		},
		lastKey: (item: T) => Record<string, string>,
	): CursorPage<T> {
		const last = page.items.at(-1);
		return {
			items: page.items,
			pageInfo: {
				hasMore: page.hasMore,
				nextCursor:
					page.hasMore && last
						? this.encodeCursor(actor, operation, scope, lastKey(last))
						: null,
			},
		};
	}

	private encodeCursor(
		actor: Actor,
		operation: string,
		scope: {
			rootEventId?: string;
			eventId?: string;
			filters?: Record<string, string | null>;
		},
		last: Record<string, string>,
	) {
		const encoded = Buffer.from(
			JSON.stringify({ v: 1, operation, actorId: actor.id, ...scope, last }),
		).toString("base64url");
		const signature = createHmac("sha256", this.syncCursorKey)
			.update(`crew:event-cursor:v1:${encoded}`)
			.digest("base64url");
		return `${encoded}.${signature}`;
	}

	private decodeCursor(
		cursor: string,
		actor: Actor,
		operation: string,
		scope: {
			rootEventId?: string;
			eventId?: string;
			filters?: Record<string, string | null>;
		},
	): Record<string, unknown> {
		try {
			const parts = cursor.split(".");
			if (parts.length !== 2) throw cursorInvalid();
			const [encoded, signature] = parts;
			if (!encoded || !signature) throw cursorInvalid();
			const expected = createHmac("sha256", this.syncCursorKey)
				.update(`crew:event-cursor:v1:${encoded}`)
				.digest();
			const actual = Buffer.from(signature, "base64url");
			if (
				actual.length !== expected.length ||
				!timingSafeEqual(actual, expected)
			)
				throw cursorInvalid();
			const payload = JSON.parse(
				Buffer.from(encoded, "base64url").toString("utf8"),
			) as Record<string, unknown>;
			if (
				payload.v !== 1 ||
				payload.operation !== operation ||
				payload.actorId !== actor.id ||
				payload.rootEventId !== scope.rootEventId ||
				payload.eventId !== scope.eventId ||
				JSON.stringify(payload.filters) !== JSON.stringify(scope.filters) ||
				!payload.last ||
				typeof payload.last !== "object" ||
				Array.isArray(payload.last)
			) {
				throw cursorInvalid();
			}
			return payload.last as Record<string, unknown>;
		} catch (error) {
			if (error instanceof DomainError) throw error;
			throw cursorInvalid();
		}
	}

	private requiredAttachments() {
		if (!this.attachments)
			throw new Error("Attachment dependencies are unavailable");
		return this.attachments;
	}

	private async requiredPlaceEnrichmentPolicy() {
		if (
			!this.placeEnrichmentPolicy ||
			!(await this.repository.placeEnrichmentWorkerHealthy())
		)
			throw new DomainError(
				503,
				"SERVICE_UNAVAILABLE",
				"Place enrichment is not available in this environment.",
				{ "Retry-After": "60" },
			);
		return this.placeEnrichmentPolicy;
	}
}

function hashToken(token: string) {
	return createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(value: string) {
	return value.trim().toLowerCase();
}

function pageLimit(value: number | undefined, maximum = 200) {
	const limit = value ?? Math.min(50, maximum);
	if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
		throw new DomainError(
			400,
			"PAGINATION_INVALID",
			`The page limit must be between 1 and ${maximum}.`,
		);
	}
	return limit;
}

function stringField(value: Record<string, unknown>, key: string) {
	return typeof value[key] === "string" ? value[key] : null;
}

function cursorTimestamp(value: Record<string, unknown>, key: string) {
	const encoded = stringField(value, key);
	if (
		!encoded ||
		!/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?[+-][0-9]{2}(?::[0-9]{2})?$/.test(
			encoded,
		)
	)
		return null;
	return Number.isNaN(new Date(encoded).getTime()) ? null : encoded;
}

function positiveIntegerField(value: Record<string, unknown>, key: string) {
	const encoded = stringField(value, key);
	if (!encoded || !/^[1-9]\d*$/.test(encoded)) return null;
	const parsed = Number(encoded);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function nonnegativeIntegerField(value: Record<string, unknown>, key: string) {
	const encoded = stringField(value, key);
	if (!encoded || !/^\d+$/.test(encoded)) return null;
	const parsed = Number(encoded);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

function cursorInvalid() {
	return new DomainError(
		400,
		"CURSOR_INVALID",
		"The pagination cursor is invalid for this request.",
	);
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
		.join(",")}}`;
}

function commandHash(actor: Actor, operationId: string, request: unknown) {
	return createHash("sha256")
		.update(canonicalJson({ actorId: actor.id, operationId, request }))
		.digest("hex");
}

function opaqueId(prefix: string) {
	return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function requiredSyncBaseVersion(mutation: SyncMutation) {
	if (
		!Number.isSafeInteger(mutation.baseVersion) ||
		(mutation.baseVersion ?? 0) < 1
	)
		throw new DomainError(
			400,
			"SYNC_PAYLOAD_INVALID",
			"This mutation requires a positive base version.",
		);
	return mutation.baseVersion as number;
}

function requiredSyncNonnegativeBaseVersion(mutation: SyncMutation) {
	if (
		!Number.isSafeInteger(mutation.baseVersion) ||
		(mutation.baseVersion ?? -1) < 0
	)
		throw new DomainError(
			400,
			"SYNC_PAYLOAD_INVALID",
			"This mutation requires a nonnegative base version.",
		);
	return mutation.baseVersion as number;
}

function syncEntityIdMismatch() {
	return new DomainError(
		400,
		"SYNC_ENTITY_ID_MISMATCH",
		"The mutation entity ID does not match its payload.",
	);
}

function syncDate(value: unknown) {
	return typeof value === "string" ? new Date(value) : null;
}

function syncEventPatch(value: Record<string, unknown>): EventPatch {
	const patch = { ...value } as EventPatch;
	if (Object.hasOwn(value, "startsAt"))
		patch.startsAt = syncDate(value.startsAt);
	if (Object.hasOwn(value, "endsAt")) patch.endsAt = syncDate(value.endsAt);
	return patch;
}

function syncItineraryInput(
	id: string,
	value: Record<string, unknown>,
): ItineraryInput {
	return {
		id,
		eventId: value.eventId as string,
		title: value.title as string,
		notes: value.notes as string | null,
		timeZone: value.timeZone as string,
		startsAt: syncDate(value.startsAt),
		endsAt: syncDate(value.endsAt),
		allDay: value.allDay as boolean,
		status: value.status as ItineraryInput["status"],
		details: value.details as ItineraryInput["details"],
		placeId: value.placeId as string | null,
	};
}

function syncItineraryPatch(value: Record<string, unknown>): ItineraryPatch {
	const patch = { ...value } as ItineraryPatch;
	if (Object.hasOwn(value, "startsAt"))
		patch.startsAt = syncDate(value.startsAt);
	if (Object.hasOwn(value, "endsAt")) patch.endsAt = syncDate(value.endsAt);
	return patch;
}

function syncEntity(
	entityType: SyncEntityType,
	entityId: string,
	version: number,
) {
	return { entityType, entityId, version };
}

function emptySyncFilters(value: unknown): value is Record<string, never> {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.keys(value).length === 0
	);
}

function syncCursorInvalid() {
	return new DomainError(
		400,
		"CURSOR_INVALID",
		"The sync cursor is invalid for this request.",
	);
}

function syncBootstrapExpired() {
	return new DomainError(
		410,
		"CURSOR_EXPIRED",
		"The bootstrap snapshot lease expired.",
		{},
		[
			{
				code: "BOOTSTRAP_REQUIRED",
				message: "Start a new bootstrap snapshot.",
			},
		],
	);
}

function placeEnrichmentNotFound() {
	return new DomainError(
		404,
		"PLACE_ENRICHMENT_NOT_FOUND",
		"The place enrichment job was not found.",
	);
}

async function concealPlaceEnrichmentAccess<T>(work: Promise<T>) {
	try {
		return await work;
	} catch (error) {
		if (
			error instanceof DomainError &&
			(error.status === 403 || error.status === 404)
		)
			throw placeEnrichmentNotFound();
		throw error;
	}
}
