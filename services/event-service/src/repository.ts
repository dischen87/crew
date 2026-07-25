import type {
	CommunityFeedbackDuplicateSuggestionPage,
	CommunityFeedbackDuplicateSuggestionPageKey,
	CommunityFeedbackFollow,
	CommunityFeedbackPage,
	CommunityFeedbackPageKey,
	CommunityFeedbackResolution,
	CommunityFeedbackStatus,
	CommunityFeedbackUpdatePage,
	CommunityFeedbackUpdatePageKey,
} from "./community-feedback-domain";
import type {
	Actor,
	CapabilityInput,
	CapabilityRecord,
	CapabilityType,
	EventInput,
	EventPatch,
	EventPublishReadiness,
	EventRecord,
	EventRootPageKey,
	EventRootSummary,
	InvitationAdminSummary,
	InvitationPageKey,
	InvitationRecord,
	InvitePreview,
	ItineraryInput,
	ItineraryPageKey,
	ItineraryPatch,
	ItineraryRecord,
	MembershipPageKey,
	MembershipRecord,
	MembershipStatus,
	PageSlice,
	PlaceInput,
	PlacePageKey,
	PlacePatch,
	PlaceRecord,
	Role,
	RootCutoverOwnership,
	RootCutoverOwnershipAuditEntry,
	RootCutoverOwnershipState,
	RootView,
} from "./domain";
import type {
	EventTemplateIdentity,
	EventTemplateInstantiation,
	EventTemplateRequest,
} from "./event-templates";
import type {
	AttachmentFinalizePrecondition,
	AttachmentRecord,
	AttachmentTarget,
	AttachmentUploadRecord,
	FeedEntryRecord,
	FeedKind,
	FeedPageKey,
	FeedReactionRecord,
} from "./feed-domain";
import type {
	FeedbackInput,
	FeedbackRecord,
	FeedbackStatus,
} from "./feedback-domain";
import type {
	GolfLeaderboard,
	GolfRoundRecord,
	GolfRoundSetupInput,
	GolfScoreInput,
	GolfScoreRecord,
} from "./golf-domain";
import type { PlaceCandidateKind } from "./place-candidate";
import type {
	PlaceEnrichmentField,
	PlaceEnrichmentJob,
	PlaceEnrichmentPolicy,
} from "./place-enrichment";
import type {
	EventRecap,
	EventRecapExternalGrantDecision,
	EventRecapExternalShare,
	EventRecapRead,
	EventRecapRemoval,
	EventRecapShare,
	EventRecapShareLink,
	EventRecapShareRevocation,
	RecapExternalField,
	RecapExternalGrantDecisionInput,
	RecapSourceInput,
} from "./recap-domain";
import type {
	BootstrapCursor,
	SyncAppliedMutation,
	SyncBootstrapPage,
	SyncChangePage,
	SyncMutation,
	SyncPushInput,
	SyncPushResponse,
} from "./sync";
import type {
	TeamAssignmentSetInput,
	TeamAssignmentSetRecord,
	TeamDecisionInput,
	TeamDecisionRecord,
	TeamResponseRecord,
} from "./team-domain";

export interface EventRepository {
	ready(): Promise<boolean>;
	findIdempotent<T extends Record<string, unknown>>(
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
	): Promise<{
		status: number;
		body: T;
		headers: Record<string, string>;
		replayed: true;
	} | null>;
	runIdempotent<T extends Record<string, unknown>>(
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
	): Promise<{
		status: number;
		body: T;
		headers: Record<string, string>;
		replayed: boolean;
	}>;
	assertSyncRootVisible(actor: Actor, rootEventId: string): Promise<void>;
	assertSyncPushReplaySafe(actor: Actor, input: SyncPushInput): Promise<void>;
	assertRootReplaySafe(
		actor: Actor,
		rootEventId: string,
		access: "member" | "manager" | "writer",
	): Promise<void>;
	assertFeedReplaySafe(
		actor: Actor,
		rootEventId: string,
		entryId: string,
		expectedVersion: number | null,
		expectedRootRevision: string | null,
		requireLive: boolean,
	): Promise<void>;
	assertAttachmentReplaySafe(
		actor: Actor,
		rootEventId: string,
		attachmentId: string | null,
	): Promise<void>;
	assertAttachmentTargetReplaySafe(
		actor: Actor,
		rootEventId: string,
		target: AttachmentTarget,
	): Promise<void>;
	assertAttachmentUploadReplaySafe(
		actor: Actor,
		rootEventId: string,
		uploadId: string,
	): Promise<void>;
	assertAttachmentFinalizeReplaySafe(
		actor: Actor,
		rootEventId: string,
		uploadId: string,
		attachmentId: string,
	): Promise<void>;
	assertRecapReplaySafe(
		actor: Actor,
		rootEventId: string,
		recapVersion: number | null,
	): Promise<void>;
	assertRecapShareLinkReplaySafe(
		actor: Actor,
		rootEventId: string,
		shareLinkId: string | null,
	): Promise<string | null>;
	assertRecapExternalGrantReplaySafe(
		actor: Actor,
		rootEventId: string,
		recapVersion: number,
		input: RecapExternalGrantDecisionInput,
	): Promise<void>;
	readSyncRootRevision(actor: Actor, rootEventId: string): Promise<string>;
	runSyncPush(
		actor: Actor,
		input: SyncPushInput,
		apply: (
			repository: EventRepository,
			mutation: SyncMutation,
		) => Promise<SyncAppliedMutation>,
	): Promise<SyncPushResponse>;
	listSyncChanges(
		actor: Actor,
		rootEventId: string,
		after: { rootRevision: string; ordinal: number },
		authorizationScopeVersion: string,
		limit: number,
	): Promise<SyncChangePage>;
	readSyncBootstrap(
		actor: Actor,
		rootEventId: string,
		cursor: BootstrapCursor | null,
		limit: number,
	): Promise<SyncBootstrapPage>;
	replaceGolfRound(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseVersion: number,
		input: GolfRoundSetupInput,
	): Promise<{
		round: GolfRoundRecord;
		leaderboard: GolfLeaderboard;
		rootRevision: string;
		unchanged: boolean;
	}>;
	setGolfScore(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		entityId: string,
		baseVersion: number,
		input: GolfScoreInput,
	): Promise<{
		score: GolfScoreRecord;
		leaderboard: GolfLeaderboard;
		rootRevision: string;
		unchanged: boolean;
	}>;
	publishTeamAssignments(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseVersion: number,
		input: TeamAssignmentSetInput,
	): Promise<{
		assignments: TeamAssignmentSetRecord;
		rootRevision: string;
		unchanged: boolean;
	}>;
	replaceTeamDecision(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		decisionId: string,
		baseVersion: number,
		input: TeamDecisionInput,
	): Promise<{
		decision: TeamDecisionRecord;
		rootRevision: string;
		unchanged: boolean;
	}>;
	setTeamResponse(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		decisionId: string,
		entityId: string,
		baseVersion: number,
		optionId: string,
	): Promise<{
		response: TeamResponseRecord;
		decision: TeamDecisionRecord;
		rootRevision: string;
		unchanged: boolean;
	}>;
	createRoot(actor: Actor, input: EventInput): Promise<EventRecord>;
	createRootFromTemplate(
		actor: Actor,
		input: EventInput,
		template: EventTemplateInstantiation,
	): Promise<EventRecord>;
	adoptRootTemplate(
		actor: Actor,
		rootEventId: string,
		baseVersion: number,
		baseRevision: string,
		template: EventTemplateRequest,
	): Promise<{
		event: EventRecord;
		rootRevision: string;
		template: EventTemplateIdentity;
	}>;
	listRoots(
		actor: Actor,
		query: {
			includeArchived: boolean;
			limit: number;
			after: EventRootPageKey | null;
		},
	): Promise<PageSlice<EventRootSummary>>;
	getRoot(actor: Actor, rootEventId: string): Promise<RootView>;
	getRootCutoverOwnership(
		actor: Actor,
		rootEventId: string,
	): Promise<{
		ownership: RootCutoverOwnership;
		audit: RootCutoverOwnershipAuditEntry[];
	}>;
	transitionRootCutoverOwnership(
		actor: Actor,
		rootEventId: string,
		input: {
			state: RootCutoverOwnershipState;
			expectedRevision: string;
			reason: string;
			sourceRelease: string;
			targetRelease: string;
		},
	): Promise<RootCutoverOwnership>;
	assertRootWriteAuthority(
		rootEventId: string,
		authority: "legacy" | "next",
	): Promise<void>;
	getPublishReadiness(
		actor: Actor,
		rootEventId: string,
	): Promise<EventPublishReadiness>;
	publishRoot(
		actor: Actor,
		rootEventId: string,
		baseVersion: number,
		baseRevision: string,
	): Promise<EventRecord>;
	generateRecap(
		actor: Actor,
		rootEventId: string,
		baseRevision: string,
		sources: RecapSourceInput[],
	): Promise<EventRecap>;
	getRecap(
		actor: Actor,
		rootEventId: string,
		version?: number,
	): Promise<EventRecapRead>;
	publishRecap(
		actor: Actor,
		rootEventId: string,
		recapVersion: number,
		baseLifecycleVersion: number,
	): Promise<EventRecap>;
	removeRecap(
		actor: Actor,
		rootEventId: string,
		baseLifecycleVersion: number,
	): Promise<EventRecapRemoval>;
	createRecapShareLink(
		actor: Actor,
		rootEventId: string,
		input: {
			id: string;
			recapVersion: number;
			tokenHash: string;
			tokenKeyId: string;
			projectionConsent: "title-only-reviewed";
		},
	): Promise<EventRecapShareLink>;
	revokeRecapShareLink(
		actor: Actor,
		rootEventId: string,
		shareLinkId: string,
	): Promise<EventRecapShareRevocation>;
	resolveRecapShareLink(tokenHash: string): Promise<EventRecapShare>;
	decideRecapExternalGrant(
		actor: Actor,
		rootEventId: string,
		recapVersion: number,
		input: RecapExternalGrantDecisionInput,
	): Promise<EventRecapExternalGrantDecision>;
	createRecapExternalShareLink(
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
	): Promise<EventRecapShareLink>;
	resolveRecapExternalShareLink(
		tokenHash: string,
	): Promise<EventRecapExternalShare>;
	getEvent(
		actor: Actor,
		rootEventId: string,
		eventId: string,
	): Promise<EventRecord>;
	createEvent(
		actor: Actor,
		rootEventId: string,
		parentEventId: string,
		input: EventInput,
	): Promise<EventRecord>;
	updateEvent(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseVersion: number,
		patch: EventPatch,
	): Promise<EventRecord>;
	reparentEvent(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		parentEventId: string,
		baseVersion: number,
	): Promise<EventRecord>;
	reorderEvents(
		actor: Actor,
		rootEventId: string,
		parentEventId: string,
		baseOrderVersion: number,
		orderedIds: string[],
	): Promise<{ parent: EventRecord; events: EventRecord[] }>;
	archiveEvent(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseVersion: number,
	): Promise<EventRecord>;
	tombstoneEvent(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseVersion: number,
		subtree: boolean,
	): Promise<void>;
	listMemberships(
		actor: Actor,
		rootEventId: string,
		page: { limit: number; after: MembershipPageKey | null },
	): Promise<PageSlice<MembershipRecord>>;
	listActiveMembershipUserIds(
		actor: Actor,
		rootEventId: string,
		page: { limit: number; after: MembershipPageKey | null },
	): Promise<PageSlice<MembershipPageKey>>;
	updateMembership(
		actor: Actor,
		rootEventId: string,
		userId: string,
		baseVersion: number,
		role: Role,
		status: MembershipStatus,
		reason: string | null,
	): Promise<MembershipRecord>;
	transferOwnership(
		actor: Actor,
		rootEventId: string,
		userId: string,
		ownerBaseVersion: number,
		targetBaseVersion: number,
	): Promise<MembershipRecord[]>;
	listInvitations(
		actor: Actor,
		rootEventId: string,
		page: { limit: number; after: InvitationPageKey | null },
	): Promise<PageSlice<InvitationAdminSummary>>;
	createInvitation(
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
	): Promise<InvitationRecord>;
	invitationTokenKeyId(
		actor: Actor,
		rootEventId: string,
		invitationId: string,
	): Promise<string | null>;
	previewInvitation(
		tokenHash: string,
		now: Date,
	): Promise<InvitePreview | null>;
	redeemInvitation(
		actor: Actor,
		tokenHash: string,
		now: Date,
	): Promise<MembershipRecord>;
	revokeInvitation(
		actor: Actor,
		rootEventId: string,
		invitationId: string,
		baseVersion: number,
	): Promise<InvitationRecord>;
	createPlace(
		actor: Actor,
		rootEventId: string,
		input: PlaceInput,
	): Promise<PlaceRecord>;
	listPlaces(
		actor: Actor,
		rootEventId: string,
		page: { limit: number; after: PlacePageKey | null },
	): Promise<PageSlice<PlaceRecord>>;
	updatePlace(
		actor: Actor,
		rootEventId: string,
		placeId: string,
		baseVersion: number,
		patch: PlacePatch,
	): Promise<PlaceRecord>;
	replaceCapability(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseVersion: number,
		input: CapabilityInput,
	): Promise<CapabilityRecord>;
	removeCapability(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		type: CapabilityType,
		baseVersion: number,
	): Promise<void>;
	createItineraryItem(
		actor: Actor,
		rootEventId: string,
		input: ItineraryInput,
	): Promise<ItineraryRecord>;
	listItinerary(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		page: { limit: number; after: ItineraryPageKey | null },
	): Promise<PageSlice<ItineraryRecord>>;
	updateItineraryItem(
		actor: Actor,
		rootEventId: string,
		itemId: string,
		baseVersion: number,
		patch: ItineraryPatch,
	): Promise<ItineraryRecord>;
	reorderItinerary(
		actor: Actor,
		rootEventId: string,
		eventId: string,
		baseOrderVersion: number,
		orderedIds: string[],
	): Promise<{ event: EventRecord; items: ItineraryRecord[] }>;
	createFeedEntry(
		actor: Actor,
		rootEventId: string,
		input: {
			id: string;
			eventId: string | null;
			parentEntryId: string | null;
			kind: Exclude<FeedKind, "system">;
			body: string;
		},
		causationRequestId: string,
	): Promise<FeedEntryRecord>;
	listFeedEntries(
		actor: Actor,
		rootEventId: string,
		page: {
			limit: number;
			after: FeedPageKey | null;
			eventId: string | null;
			kind: FeedKind | null;
		},
	): Promise<PageSlice<FeedEntryRecord>>;
	getFeedEntry(
		actor: Actor,
		rootEventId: string,
		entryId: string,
	): Promise<FeedEntryRecord>;
	reviseFeedEntry(
		actor: Actor,
		rootEventId: string,
		entryId: string,
		baseVersion: number,
		body: string,
	): Promise<FeedEntryRecord>;
	removeFeedEntry(
		actor: Actor,
		rootEventId: string,
		entryId: string,
		baseVersion: number,
	): Promise<FeedEntryRecord>;
	setFeedReaction(
		actor: Actor,
		rootEventId: string,
		entryId: string,
		reaction: string,
		present: boolean,
	): Promise<FeedReactionRecord>;
	createAttachmentUpload(
		actor: Actor,
		input: Omit<
			AttachmentUploadRecord,
			"createdBy" | "state" | "committedAt" | "createdAt"
		>,
	): Promise<AttachmentUploadRecord>;
	getAttachmentUpload(
		actor: Actor,
		rootEventId: string,
		uploadId: string,
	): Promise<AttachmentUploadRecord>;
	ensureAttachmentVerification(
		actor: Actor,
		rootEventId: string,
		uploadId: string,
	): Promise<AttachmentFinalizePrecondition>;
	commitAttachment(
		actor: Actor,
		rootEventId: string,
		uploadId: string,
		caption: string | null,
	): Promise<AttachmentRecord>;
	getAttachment(
		actor: Actor,
		rootEventId: string,
		attachmentId: string,
	): Promise<AttachmentRecord & { objectKey: string }>;
	assertFeedbackReplaySafe(
		actor: Actor,
		feedbackId: string,
		access: "read" | "member" | "manage",
	): Promise<void>;
	createFeedback(actor: Actor, input: FeedbackInput): Promise<FeedbackRecord>;
	getFeedback(actor: Actor, feedbackId: string): Promise<FeedbackRecord>;
	setFeedbackVote(
		actor: Actor,
		feedbackId: string,
		present: boolean,
	): Promise<FeedbackRecord>;
	addFeedbackComment(
		actor: Actor,
		feedbackId: string,
		input: { id: string; body: string },
	): Promise<FeedbackRecord>;
	markFeedbackDuplicate(
		actor: Actor,
		feedbackId: string,
		canonicalFeedbackId: string,
		note: string | null,
	): Promise<FeedbackRecord>;
	setFeedbackStatus(
		actor: Actor,
		feedbackId: string,
		status: Exclude<FeedbackStatus, "duplicate">,
		note: string | null,
	): Promise<FeedbackRecord>;
	assertCommunityFeedbackReplaySafe(
		actor: Actor,
		rootEventId: string,
		feedbackId: string,
		expectedCanonicalId: string,
	): Promise<void>;
	listCommunityFeedback(
		actor: Actor,
		rootEventId: string,
		page: {
			limit: number;
			after: CommunityFeedbackPageKey | null;
			status: CommunityFeedbackStatus | null;
			followedOnly: boolean;
		},
	): Promise<CommunityFeedbackPage>;
	listCommunityFeedbackDuplicateSuggestions(
		actor: Actor,
		rootEventId: string,
		search: {
			tokens: string[];
			limit: number;
			after: CommunityFeedbackDuplicateSuggestionPageKey | null;
		},
	): Promise<CommunityFeedbackDuplicateSuggestionPage>;
	listCommunityFeedbackUpdates(
		actor: Actor,
		rootEventId: string,
		page: {
			limit: number;
			after: CommunityFeedbackUpdatePageKey | null;
			followedOnly: boolean;
		},
	): Promise<CommunityFeedbackUpdatePage>;
	getCommunityFeedback(
		actor: Actor,
		rootEventId: string,
		feedbackId: string,
	): Promise<CommunityFeedbackResolution>;
	setCommunityFeedbackVote(
		actor: Actor,
		rootEventId: string,
		feedbackId: string,
		present: boolean,
	): Promise<CommunityFeedbackResolution>;
	addCommunityFeedbackComment(
		actor: Actor,
		rootEventId: string,
		feedbackId: string,
		input: { id: string; body: string },
	): Promise<CommunityFeedbackResolution>;
	setCommunityFeedbackFollow(
		actor: Actor,
		rootEventId: string,
		feedbackId: string,
		followed: boolean,
	): Promise<CommunityFeedbackFollow>;
	requestPlaceEnrichmentCandidate(
		candidateId: string,
		policy: PlaceEnrichmentPolicy,
	): Promise<PlaceEnrichmentJob>;
	requestPlaceEnrichmentSearchMiss(
		input: { query: string; kind: PlaceCandidateKind; countryCode: string },
		policy: PlaceEnrichmentPolicy,
	): Promise<PlaceEnrichmentJob>;
	getPlaceEnrichment(id: string): Promise<{
		job: PlaceEnrichmentJob;
		fields: PlaceEnrichmentField[];
		globalPlaceId: string | null;
	} | null>;
	requestPlaceEnrichmentRetry(id: string): Promise<PlaceEnrichmentJob>;
}
