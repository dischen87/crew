import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { VerifyUserToken } from "./auth";
import type {
	CommunityFeedbackDetail,
	CommunityFeedbackDuplicateSuggestion,
	CommunityFeedbackResolution,
	CommunityFeedbackSummary,
	CommunityFeedbackUpdate,
} from "./community-feedback-domain";
import {
	type Actor,
	type CapabilityRecord,
	DomainError,
	type ErrorDetail,
	type EventInput,
	type EventPatch,
	type EventRecord,
	type EventRootSummary,
	eventPublishReadinessReasonCodes,
	type InvitationAdminSummary,
	type InvitationRecord,
	type ItineraryInput,
	type ItineraryPatch,
	type ItineraryRecord,
	type MembershipRecord,
	type PlacePatch,
	type PlaceRecord,
} from "./domain";
import {
	type AttachmentRecord,
	type AttachmentTarget,
	type AttachmentUploadRecord,
	attachmentContentTypes,
	type DownloadGrant,
	type FeedEntryRecord,
	type FeedReactionRecord,
	feedReactions,
	type UploadGrant,
} from "./feed-domain";
import type { FeedbackInput, FeedbackRecord } from "./feedback-domain";
import {
	MAX_PLACE_CANDIDATE_BODY_BYTES,
	MAX_PLACE_CANDIDATE_IMPORT_RECORDS,
	MAX_PLACE_CANDIDATE_PAGE_SIZE,
	type PlaceCandidateRecord,
	type PlaceCandidateService,
} from "./place-candidate";
import type {
	PlaceCandidateServiceScope,
	VerifyPlaceCandidateServiceToken,
} from "./place-candidate-auth";
import {
	PLACE_CANDIDATE_READ_SCOPE,
	PLACE_CANDIDATE_WRITE_SCOPE,
} from "./place-candidate-auth";
import { placeEnrichmentResponse } from "./place-enrichment-api";
import {
	MAX_PLACE_SEARCH_PAGE_SIZE,
	type PlaceSearchService,
} from "./place-search";
import { RECAP_CAPTION_FIELD_REF_PATTERN } from "./recap-caption-field-ref";
import type {
	EventRecap,
	EventRecapShareLink,
	RecapExternalField,
	RecapExternalGrantDecisionInput,
	RecapSourceInput,
} from "./recap-domain";
import type { EventService } from "./service";
import { MAX_SYNC_BODY_BYTES, MAX_SYNC_MUTATIONS } from "./sync";

const SERVICE = "event-service";
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SENSITIVE_IDENTIFIER =
	/^(?:cin_|crs_|rt_|at_|access[_-]|refresh[_-]|bearer[_-]|eyJ)/i;
const EVENT_ID = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const ITINERARY_ID = /^iti_[A-Za-z0-9._:-]{1,96}$/;
const PLACE_ID = /^plc_[A-Za-z0-9._:-]{1,96}$/;
const PLACE_CANDIDATE_ID = /^pcd_[a-f0-9]{64}$/;
const PLACE_ENRICHMENT_JOB_ID = /^pej_[a-f0-9]{64}$/;
const GLOBAL_PLACE_ID = /^gpl_[a-f0-9]{64}$/;
const PLACE_CANDIDATE_SOURCE = /^[a-z][a-z0-9._-]{0,63}$/;
const INVITATION_ID = /^inv_[A-Za-z0-9._:-]{1,96}$/;
const FEED_ID = /^fed_[A-Za-z0-9._:-]{1,96}$/;
const FEEDBACK_ID = /^fbk_[A-Za-z0-9._:-]{1,96}$/;
const FEEDBACK_COMMENT_ID = /^fbc_[A-Za-z0-9._:-]{1,96}$/;
const ATTACHMENT_ID = /^att_[A-Za-z0-9._:-]{1,96}$/;
const UPLOAD_ID = /^upl_[A-Za-z0-9._:-]{1,96}$/;
const USER_ID = /^usr_[a-f0-9]{32}$/;
const GOLF_SCORE_ID =
	/^gsc_evt_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}:(?:[1-9]|1[0-8])$/;
const GOLF_PLAYER_ID = /^gpl_evt_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}$/;
const GOLF_LEADERBOARD_ID = /^glb_evt_[A-Za-z0-9._:-]{1,96}$/;
const GOLF_ROSTER_ID = /^gro_evt_[A-Za-z0-9._:-]{1,96}$/;
const GOLF_TEAM_ID = /^gtm_[A-Za-z0-9._:-]{1,96}$/;
const TEAM_ASSIGNMENT_TEAM_ID = /^ttm_[A-Za-z0-9._:-]{1,96}$/;
const TEAM_ASSIGNMENT_ROSTER_ID = /^tro_evt_[A-Za-z0-9._:-]{1,96}$/;
const TEAM_ASSIGNMENT_ID = /^tma_evt_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}$/;
const TEAM_DECISION_ID = /^tdc_[A-Za-z0-9._:-]{1,96}$/;
const TEAM_DECISION_OPTION_ID = /^tdo_[A-Za-z0-9._:-]{1,96}$/;
const TEAM_RESPONSE_ID = /^trp_tdc_[A-Za-z0-9._:-]{1,96}:usr_[a-f0-9]{32}$/;
const CAPABILITY_ID =
	/^evt_[A-Za-z0-9._:-]{1,96}:(travel|lodging|transport|golf|team)$/;
const CLIENT_MUTATION_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IDEMPOTENCY_KEY =
	/^(?!(?:cin_|crs_|rt_|at_|access[_-]|refresh[_-]|bearer[_-]|eyJ))[A-Za-z0-9][A-Za-z0-9._:-]+$/;
const DEVICE_ID =
	/^dvc_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECAP_SHARE_RESOLVE_PATHS = new Set([
	"/v1/recap-share-links/resolve",
	"/v1/recap-external-share-links/resolve",
]);

function isRecapShareResolvePath(path: string) {
	return RECAP_SHARE_RESOLVE_PATHS.has(path);
}

type Variables = { requestId: string; actor?: Actor; service?: EventService };
type EventEnv = { Variables: Variables };

export type AppOptions = {
	service?: EventService;
	placeCandidates?: PlaceCandidateService;
	placeSearch?: PlaceSearchService;
	verifyUserToken?: VerifyUserToken;
	verifyPlaceCandidateServiceToken?: VerifyPlaceCandidateServiceToken;
	readiness?: () => boolean | Promise<boolean>;
};

const ErrorDetailSchema = z
	.object({
		code: z.string(),
		path: z.string().optional(),
		message: z.string(),
		meta: z
			.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
			.optional(),
	})
	.strict()
	.openapi("ErrorDetail");

const ErrorEnvelopeSchema = z
	.object({
		error: z
			.object({
				code: z.string(),
				message: z.string(),
				requestId: z.string(),
				retryable: z.boolean(),
				details: z.array(ErrorDetailSchema).optional(),
			})
			.strict(),
	})
	.strict()
	.openapi("ErrorEnvelope");

const RequestIdHeader = {
	description: "Crew request correlation identifier",
	schema: { type: "string" as const },
};
const LocationHeader = {
	description: "Canonical resource URL",
	schema: { type: "string" as const },
};
const ReplayHeader = {
	description: "True when the stored idempotent response was replayed",
	schema: { type: "string" as const },
};
const PendingReplayHeader = {
	description: "Pending verification is never a stored terminal replay",
	schema: { type: "string" as const, enum: ["false"] },
};
const RetryAfterHeader = {
	description: "Seconds until the request may be retried",
	schema: { type: "string" as const },
};
const PrivateNoStoreHeader = {
	description: "Sensitive responses must not be stored by HTTP caches",
	schema: {
		type: "string" as const,
		enum: ["private, no-store"],
	},
};
const jsonError = (description: string, retry = false) => ({
	description,
	headers: {
		"X-Request-ID": RequestIdHeader,
		...(retry ? { "Retry-After": RetryAfterHeader } : {}),
	},
	content: { "application/json": { schema: ErrorEnvelopeSchema } },
});
const privateJsonError = (description: string, retry = false) => {
	const value = jsonError(description, retry);
	return {
		...value,
		headers: {
			...value.headers,
			"Cache-Control": PrivateNoStoreHeader,
		},
	};
};
const errors = {
	400: jsonError("Invalid request"),
	401: jsonError("Authentication required"),
	403: jsonError("Role does not permit this action"),
	404: jsonError("Resource not found"),
	409: jsonError("Conflict", true),
	503: jsonError("Service unavailable", true),
	500: jsonError("Unexpected failure"),
};
const feedbackErrors = {
	400: privateJsonError("Invalid request"),
	401: privateJsonError("Authentication required"),
	403: privateJsonError("Role does not permit this action"),
	404: privateJsonError("Resource not found"),
	409: privateJsonError("Conflict", true),
	500: privateJsonError("Unexpected failure"),
};
const cursorExpiredError = jsonError("Cursor expired");
const payloadTooLargeError = jsonError("Payload too large");

const EventIdSchema = z.string().regex(EVENT_ID);
const ItineraryIdSchema = z.string().regex(ITINERARY_ID);
const PlaceIdSchema = z.string().regex(PLACE_ID);
const InvitationIdSchema = z.string().regex(INVITATION_ID);
const FeedIdSchema = z.string().regex(FEED_ID);
const FeedbackIdSchema = z.string().regex(FEEDBACK_ID);
const FeedbackCommentIdSchema = z.string().regex(FEEDBACK_COMMENT_ID);
const AttachmentIdSchema = z.string().regex(ATTACHMENT_ID);
const UploadIdSchema = z.string().regex(UPLOAD_ID);
const UserIdSchema = z.string().regex(USER_ID);
const GolfScoreIdSchema = z.string().regex(GOLF_SCORE_ID);
const GolfPlayerIdSchema = z.string().regex(GOLF_PLAYER_ID);
const GolfLeaderboardIdSchema = z.string().regex(GOLF_LEADERBOARD_ID);
const GolfRosterIdSchema = z.string().regex(GOLF_ROSTER_ID);
const GolfTeamIdSchema = z.string().regex(GOLF_TEAM_ID);
const DateTimeSchema = z.string().datetime({ offset: true });
const SortKeySchema = z.string().regex(/^[1-9]\d*$/);
const IanaTimeZoneSchema = z
	.string()
	.min(1)
	.max(100)
	.refine(isIanaTimeZone, "Invalid IANA time zone");
const IdempotencyHeadersSchema = z
	.object({
		"idempotency-key": z.string().min(8).max(128).regex(IDEMPOTENCY_KEY),
	})
	.passthrough();
const PaginationQuerySchema = z
	.object({
		limit: z.coerce.number().int().min(1).max(200).default(50),
		cursor: z.string().min(16).max(4096).optional(),
	})
	.strict();
const PageInfoSchema = z
	.object({
		nextCursor: z.string().nullable(),
		hasMore: z.boolean(),
	})
	.strict();
const rootParams = z.object({ rootEventId: EventIdSchema }).strict();
const eventParams = z
	.object({ rootEventId: EventIdSchema, eventId: EventIdSchema })
	.strict();
const itemParams = z
	.object({ rootEventId: EventIdSchema, itemId: ItineraryIdSchema })
	.strict();
const placeParams = z
	.object({ rootEventId: EventIdSchema, placeId: PlaceIdSchema })
	.strict();
const userParams = z
	.object({
		rootEventId: EventIdSchema,
		userId: UserIdSchema,
	})
	.strict();
const feedParams = z
	.object({ rootEventId: EventIdSchema, entryId: FeedIdSchema })
	.strict();
const feedbackParams = z.object({ feedbackId: FeedbackIdSchema }).strict();
const communityFeedbackParams = z
	.object({ rootEventId: EventIdSchema, feedbackId: FeedbackIdSchema })
	.strict();
const uploadParams = z
	.object({ rootEventId: EventIdSchema, uploadId: UploadIdSchema })
	.strict();
const attachmentParams = z
	.object({ rootEventId: EventIdSchema, attachmentId: AttachmentIdSchema })
	.strict();
const CapabilityTypeSchema = z.enum([
	"travel",
	"lodging",
	"transport",
	"golf",
	"team",
]);
const capabilityParams = z
	.object({
		rootEventId: EventIdSchema,
		eventId: EventIdSchema,
		capabilityType: CapabilityTypeSchema,
	})
	.strict();

const EventKindSchema = z.enum([
	"trip",
	"day",
	"golf",
	"team_event",
	"session",
	"activity",
	"other",
]);
const EventStatusSchema = z.enum([
	"draft",
	"published",
	"cancelled",
	"archived",
]);
const EventSchema = z
	.object({
		id: EventIdSchema,
		rootEventId: EventIdSchema,
		parentEventId: EventIdSchema.nullable(),
		kind: EventKindSchema,
		title: z.string(),
		description: z.string().nullable(),
		timeZone: IanaTimeZoneSchema,
		startsAt: DateTimeSchema.nullable(),
		endsAt: DateTimeSchema.nullable(),
		sortKey: SortKeySchema,
		childOrderVersion: z.number().int().positive(),
		itineraryOrderVersion: z.number().int().positive(),
		status: EventStatusSchema,
		version: z.number().int().positive(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("Event");
const EventResponseSchema = z.object({ event: EventSchema }).strict();
const EventListResponseSchema = z
	.object({ parent: EventSchema, events: z.array(EventSchema) })
	.strict();
const EventRootSummarySchema = z
	.object({
		rootEventId: EventIdSchema,
		kind: EventKindSchema,
		title: z.string().trim().min(1).max(160),
		timeZone: IanaTimeZoneSchema,
		startsAt: DateTimeSchema.nullable(),
		endsAt: DateTimeSchema.nullable(),
		status: EventStatusSchema,
		version: z.number().int().positive(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
		role: z.enum(["owner", "organizer", "participant", "viewer"]),
		membershipStatus: z.enum(["active", "left", "removed"]),
	})
	.strict()
	.openapi("EventRootSummary");
const EventRootPageResponseSchema = z
	.object({
		items: z.array(EventRootSummarySchema).max(200),
		pageInfo: PageInfoSchema,
	})
	.strict();
const TravelCapabilitySchema = z
	.object({
		type: z.literal("travel"),
		schemaVersion: z.literal(1),
		config: z
			.object({
				homePlaceId: PlaceIdSchema.nullable(),
				travelerReferenceLabel: z.string().trim().min(1).max(120).nullable(),
			})
			.strict(),
	})
	.strict();
const LodgingCapabilitySchema = z
	.object({
		type: z.literal("lodging"),
		schemaVersion: z.literal(1),
		config: z
			.object({
				propertyPlaceId: PlaceIdSchema.nullable(),
				checkInPolicy: z.enum(["fixed", "flexible"]),
				checkOutPolicy: z.enum(["fixed", "flexible"]),
				roomAssignmentMode: z.enum(["organizer", "self_service"]),
			})
			.strict(),
	})
	.strict();
const TransportCapabilitySchema = z
	.object({
		type: z.literal("transport"),
		schemaVersion: z.literal(1),
		config: z
			.object({
				meetingPlaceId: PlaceIdSchema.nullable(),
				participantMode: z.enum(["self_arranged", "shared", "mixed"]),
			})
			.strict(),
	})
	.strict();
const GolfCapabilitySchema = z
	.object({
		type: z.literal("golf"),
		schemaVersion: z.literal(1),
		config: z
			.object({
				coursePlaceId: PlaceIdSchema.nullable(),
				teeFormat: z.enum(["individual", "pairs", "fourball"]),
				handicapMode: z.enum(["none", "optional", "required"]),
				scoringMode: z.enum(["none", "stroke_play", "stableford"]),
				roundState: z.enum(["planned", "open", "closed"]),
			})
			.strict(),
	})
	.strict();
const TeamCapabilitySchema = z
	.object({
		type: z.literal("team"),
		schemaVersion: z.literal(1),
		config: z
			.object({
				venuePlaceId: PlaceIdSchema.nullable(),
				assignmentMode: z.enum(["organizer", "self_select", "random"]),
				capacityPerTeam: z.number().int().min(1).max(1000).nullable(),
				facilitator: z.string().trim().min(1).max(160).nullable(),
			})
			.strict(),
	})
	.strict();
const CapabilityInputSchema = z.discriminatedUnion("type", [
	TravelCapabilitySchema,
	LodgingCapabilitySchema,
	TransportCapabilitySchema,
	GolfCapabilitySchema,
	TeamCapabilitySchema,
]);
const capabilityRecordFields = {
	rootEventId: EventIdSchema,
	eventId: EventIdSchema,
	version: z.number().int().positive(),
	createdAt: DateTimeSchema,
	updatedAt: DateTimeSchema,
};
const CapabilitySchema = z
	.discriminatedUnion("type", [
		TravelCapabilitySchema.extend(capabilityRecordFields),
		LodgingCapabilitySchema.extend(capabilityRecordFields),
		TransportCapabilitySchema.extend(capabilityRecordFields),
		GolfCapabilitySchema.extend(capabilityRecordFields),
		TeamCapabilitySchema.extend(capabilityRecordFields),
	])
	.openapi("EventCapability");
const CapabilityResponseSchema = z
	.object({ capability: CapabilitySchema })
	.strict();
const RootResponseSchema = z
	.object({
		rootEventId: EventIdSchema,
		rootRevision: z.string(),
		events: z.array(EventSchema),
		capabilities: z.array(CapabilitySchema),
	})
	.strict();

const EventTemplateSchema = z
	.object({
		id: z.enum(["travel", "golf-tour", "team-event"]),
		version: z.literal(1),
		title: z.string(),
		summary: z.string(),
		events: z.array(
			z
				.object({
					logicalKey: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
					parentLogicalKey: z
						.string()
						.regex(/^[a-z][a-z0-9-]{0,31}$/)
						.nullable(),
					kind: EventKindSchema,
					title: z.string(),
					capabilities: z.array(CapabilityInputSchema),
				})
				.strict(),
		),
	})
	.strict()
	.openapi("EventTemplate");
const EventTemplatesResponseSchema = z
	.object({ templates: z.array(EventTemplateSchema).min(3).max(3) })
	.strict();
const TemplateEventIdsSchema = z
	.record(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), EventIdSchema)
	.superRefine((eventIds, context) => {
		const ids = Object.values(eventIds);
		if (ids.length > 16)
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "A template may map at most 16 event IDs",
			});
		if (new Set(ids).size !== ids.length)
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Template event IDs must be unique",
			});
	})
	.openapi({
		maxProperties: 16,
	});
const EventTemplateRequestSchema = z
	.object({
		id: z.string().trim().min(1).max(64),
		version: z.number().int().positive(),
		eventIds: TemplateEventIdsSchema,
	})
	.strict();

const EventFieldsSchema = z
	.object({
		id: EventIdSchema,
		kind: EventKindSchema,
		title: z.string().trim().min(1).max(160),
		description: z.string().max(20_000).nullable().default(null),
		timeZone: IanaTimeZoneSchema,
		startsAt: DateTimeSchema.nullable().default(null),
		endsAt: DateTimeSchema.nullable().default(null),
		status: EventStatusSchema.default("draft"),
	})
	.strict();
const RootEventFieldsSchema = EventFieldsSchema.extend({
	status: z.literal("draft").default("draft"),
	template: EventTemplateRequestSchema.optional(),
});
const EventPatchSchema = z
	.object({
		baseVersion: z.number().int().positive(),
		changes: z
			.object({
				title: z.string().trim().min(1).max(160).optional(),
				description: z.string().max(20_000).nullable().optional(),
				timeZone: IanaTimeZoneSchema.optional(),
				startsAt: DateTimeSchema.nullable().optional(),
				endsAt: DateTimeSchema.nullable().optional(),
				status: EventStatusSchema.optional(),
			})
			.strict()
			.refine(
				(value) => Object.keys(value).length > 0,
				"At least one change is required",
			),
	})
	.strict();

const RoleSchema = z.enum(["owner", "organizer", "participant", "viewer"]);
const MembershipSchema = z
	.object({
		rootEventId: EventIdSchema,
		userId: UserIdSchema,
		role: RoleSchema,
		status: z.enum(["active", "left", "removed"]),
		version: z.number().int().positive(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("EventMembership");
const MembershipResponseSchema = z
	.object({ membership: MembershipSchema })
	.strict();
const MembershipsResponseSchema = z
	.object({ memberships: z.array(MembershipSchema) })
	.strict();
const MembershipPageResponseSchema = z
	.object({
		items: z.array(MembershipSchema),
		pageInfo: PageInfoSchema,
	})
	.strict();
const MemberDirectorySourceResponseSchema = z
	.object({
		schemaVersion: z.literal(1),
		rootEventId: EventIdSchema,
		userIds: z.array(UserIdSchema).max(200),
		pageInfo: PageInfoSchema,
	})
	.strict();

const InvitationSchema = z
	.object({
		id: InvitationIdSchema,
		rootEventId: EventIdSchema,
		role: z.enum(["organizer", "participant", "viewer"]),
		normalizedEmailHint: z.string().email().nullable(),
		expiresAt: DateTimeSchema,
		maxUses: z.number().int().positive(),
		useCount: z.number().int().nonnegative(),
		status: z.enum(["active", "revoked"]),
		version: z.number().int().positive(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("EventInvitation");
const InvitationResponseSchema = z
	.object({ invitation: InvitationSchema, token: z.string().optional() })
	.strict();
const InvitationAdminSummarySchema = z
	.object({
		id: InvitationIdSchema,
		rootEventId: EventIdSchema,
		role: z.enum(["organizer", "participant", "viewer"]),
		emailBound: z.boolean(),
		expiresAt: DateTimeSchema,
		maxUses: z.number().int().min(1).max(10_000),
		useCount: z.number().int().nonnegative(),
		status: z.enum(["active", "revoked"]),
		version: z.number().int().positive(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("EventInvitationAdminSummary");
const InvitationAdminPageResponseSchema = z
	.object({
		items: z.array(InvitationAdminSummarySchema).max(200),
		pageInfo: PageInfoSchema,
	})
	.strict();

const PlaceSchema = z
	.object({
		id: PlaceIdSchema,
		rootEventId: EventIdSchema,
		name: z.string(),
		locality: z.string().nullable(),
		countryCode: z.string().length(2),
		latitude: z.number().nullable(),
		longitude: z.number().nullable(),
		version: z.number().int().positive(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("EventPlace");
const PlaceResponseSchema = z.object({ place: PlaceSchema }).strict();
const PlacesResponseSchema = z
	.object({ items: z.array(PlaceSchema), pageInfo: PageInfoSchema })
	.strict();
const PlaceFieldsSchema = z
	.object({
		id: PlaceIdSchema,
		name: z.string().trim().min(1).max(200),
		locality: z.string().max(200).nullable().default(null),
		countryCode: z
			.string()
			.length(2)
			.transform((value) => value.toUpperCase()),
		latitude: z.number().min(-90).max(90).nullable().default(null),
		longitude: z.number().min(-180).max(180).nullable().default(null),
	})
	.strict()
	.refine(
		(value) => (value.latitude === null) === (value.longitude === null),
		"Coordinates must be supplied together",
	);
const PlaceChangesSchema = z
	.object({
		name: z.string().trim().min(1).max(200).optional(),
		locality: z.string().max(200).nullable().optional(),
		countryCode: z
			.string()
			.length(2)
			.transform((value) => value.toUpperCase())
			.optional(),
		latitude: z.number().min(-90).max(90).nullable().optional(),
		longitude: z.number().min(-180).max(180).nullable().optional(),
	})
	.strict()
	.refine(
		(value) => Object.keys(value).length > 0,
		"At least one change is required",
	);

const PlaceCandidateIdSchema = z.string().regex(PLACE_CANDIDATE_ID);
const PlaceCandidateRetirementReasonSchema = z.enum([
	"source_removed",
	"license_revoked",
	"invalid_record",
	"superseded",
]);
const PlaceCandidateLicenseSchema = z
	.object({
		code: z.string().min(1).max(128).refine(isTrimmed),
		url: z.string().url().max(2048).nullable().default(null),
		attribution: z.string().min(1).max(500).refine(isTrimmed),
		allowsSearchIndex: z.boolean(),
	})
	.strict();
const PlaceCandidateRetirementSchema = z
	.object({
		retiredAt: DateTimeSchema,
		reason: PlaceCandidateRetirementReasonSchema,
	})
	.strict();
const PlaceCandidateInputSchema = z
	.object({
		source: z.string().regex(PLACE_CANDIDATE_SOURCE),
		sourceRecordId: z
			.string()
			.min(1)
			.max(512)
			.refine(isTrimmed)
			.refine(hasNoControlCharacters, "Control characters are not permitted"),
		kind: z.enum(["golf_course", "venue"]),
		name: z.string().min(1).max(200).refine(isTrimmed),
		locality: z
			.string()
			.min(1)
			.max(200)
			.refine(isTrimmed)
			.nullable()
			.default(null),
		region: z
			.string()
			.min(1)
			.max(200)
			.refine(isTrimmed)
			.nullable()
			.default(null),
		countryCode: z.string().regex(/^[A-Z]{2}$/),
		latitude: z.number().min(-90).max(90).nullable().default(null),
		longitude: z.number().min(-180).max(180).nullable().default(null),
		sourceRecordUrl: z.string().url().max(2048).nullable().default(null),
		license: PlaceCandidateLicenseSchema,
		retrievedAt: DateTimeSchema,
		confidence: z.number().min(0).max(1),
		expiresAt: DateTimeSchema.nullable().default(null),
		retirement: PlaceCandidateRetirementSchema.nullable().default(null),
	})
	.strict()
	.superRefine((value, context) => {
		if ((value.latitude === null) !== (value.longitude === null)) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["latitude"],
				message: "Coordinates must be supplied together",
			});
		}
		const retrievedAt = Date.parse(value.retrievedAt);
		if (
			value.expiresAt !== null &&
			Date.parse(value.expiresAt) <= retrievedAt
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["expiresAt"],
				message: "expiresAt must be later than retrievedAt",
			});
		}
		if (
			value.retirement !== null &&
			Date.parse(value.retirement.retiredAt) > retrievedAt
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["retirement", "retiredAt"],
				message: "retiredAt cannot be later than retrievedAt",
			});
		}
	});
const PlaceCandidateSchema = z
	.object({
		id: PlaceCandidateIdSchema,
		source: z.string().regex(PLACE_CANDIDATE_SOURCE),
		sourceRecordId: z.string(),
		kind: z.enum(["golf_course", "venue"]),
		name: z.string(),
		locality: z.string().nullable(),
		region: z.string().nullable(),
		countryCode: z.string().regex(/^[A-Z]{2}$/),
		latitude: z.number().nullable(),
		longitude: z.number().nullable(),
		sourceRecordUrl: z.string().nullable(),
		license: PlaceCandidateLicenseSchema,
		retrievedAt: DateTimeSchema,
		confidence: z.number().min(0).max(1),
		expiresAt: DateTimeSchema.nullable(),
		retirement: PlaceCandidateRetirementSchema.nullable(),
		version: z.number().int().positive(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("PlaceCandidate");
const PlaceCandidateImportRequestSchema = z
	.object({
		candidates: z
			.array(PlaceCandidateInputSchema)
			.min(1)
			.max(MAX_PLACE_CANDIDATE_IMPORT_RECORDS),
	})
	.strict();
const PlaceCandidateImportResponseSchema = z
	.object({
		results: z.array(
			z
				.object({
					outcome: z.enum(["inserted", "updated", "unchanged", "stale"]),
					candidate: PlaceCandidateSchema,
				})
				.strict(),
		),
	})
	.strict();
const PlaceCandidateFeedResponseSchema = z
	.object({
		items: z.array(PlaceCandidateSchema),
		pageInfo: PageInfoSchema,
	})
	.strict();

const PlaceSearchResultSchema = z
	.object({
		id: z.string().min(1).max(128),
		kind: z.enum(["golf_course", "venue"]),
		name: z.string().min(1).max(300),
		locality: z.string().min(1).max(200).nullable(),
		region: z.string().min(1).max(200).nullable(),
		countryCode: z.string().regex(/^[A-Z]{2}$/),
		latitude: z.number().min(-90).max(90).nullable(),
		longitude: z.number().min(-180).max(180).nullable(),
		status: z.enum(["pending", "enriched"]),
		source: z.string().regex(PLACE_CANDIDATE_SOURCE),
		sourceRecordUrl: z.string().url().max(2048).nullable(),
		licenseCode: z.string().min(1).max(128),
		licenseUrl: z.string().url().max(2048).nullable(),
		attribution: z.string().min(1).max(500),
		retrievedAt: DateTimeSchema,
		confidence: z.number().min(0).max(1),
		version: z.number().int().positive(),
	})
	.strict()
	.openapi("PlaceSearchResult");
const PlaceSearchResponseSchema = z
	.object({
		items: z.array(PlaceSearchResultSchema).max(MAX_PLACE_SEARCH_PAGE_SIZE),
		pageInfo: PageInfoSchema,
	})
	.strict();

const PlaceEnrichmentJobIdSchema = z.string().regex(PLACE_ENRICHMENT_JOB_ID);
const PlaceEnrichmentRequestSchema = z.discriminatedUnion("target", [
	z
		.object({
			target: z.literal("candidate"),
			candidateId: PlaceCandidateIdSchema,
		})
		.strict(),
	z
		.object({
			target: z.literal("search_miss"),
			query: z.string().trim().min(2).max(200),
			kind: z.enum(["golf_course", "venue"]),
			countryCode: z.string().regex(/^[A-Z]{2}$/),
		})
		.strict(),
]);
const PlaceEnrichmentSchema = z
	.object({
		id: PlaceEnrichmentJobIdSchema,
		status: z.enum([
			"pending",
			"processing",
			"retry",
			"succeeded",
			"failed",
			"dead",
		]),
		pollAfterSeconds: z.number().int().min(1).max(30).nullable(),
		retryAllowed: z.boolean(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
		completedAt: DateTimeSchema.nullable(),
	})
	.strict()
	.openapi("PlaceEnrichment");
const EnrichedPlaceSchema = z
	.object({
		id: z.string().regex(GLOBAL_PLACE_ID),
		sourceCandidateId: PlaceCandidateIdSchema,
		kind: z.enum(["golf_course", "venue"]),
		name: z.string().min(1).max(200),
		locality: z.string().min(1).max(200).nullable(),
		region: z.string().min(1).max(200).nullable(),
		countryCode: z.string().regex(/^[A-Z]{2}$/),
		latitude: z.number().min(-90).max(90).nullable(),
		longitude: z.number().min(-180).max(180).nullable(),
		address: z.string().min(1).max(500).nullable(),
		websiteUrl: z.string().url().max(2048).nullable(),
		summary: z.string().min(1).max(1_000).nullable(),
	})
	.strict()
	.openapi("EnrichedPlace");
const PlaceEnrichmentResponseSchema = z
	.object({
		enrichment: PlaceEnrichmentSchema,
		place: EnrichedPlaceSchema.nullable(),
	})
	.strict();

const PlaceSnapshotSchema = z
	.object({
		id: PlaceIdSchema,
		name: z.string(),
		locality: z.string().nullable(),
		countryCode: z.string(),
		latitude: z.number().nullable(),
		longitude: z.number().nullable(),
	})
	.strict();
const NoteDetailsSchema = z
	.object({ schemaVersion: z.literal(1), type: z.literal("note") })
	.strict();
const ActivityDetailsSchema = z
	.object({
		schemaVersion: z.literal(1),
		type: z.literal("activity"),
		bookingReference: z.string().max(300).optional(),
	})
	.strict();
const FlightDetailsInputSchema = z
	.object({
		schemaVersion: z.literal(1),
		type: z.literal("flight"),
		originPlaceId: PlaceIdSchema,
		destinationPlaceId: PlaceIdSchema,
		flightDesignator: z.string().max(20).optional(),
	})
	.strict();
const RailDetailsInputSchema = z
	.object({
		schemaVersion: z.literal(1),
		type: z.literal("rail"),
		originPlaceId: PlaceIdSchema,
		destinationPlaceId: PlaceIdSchema,
		serviceDesignator: z.string().max(50).optional(),
	})
	.strict();
const RoadDetailsInputSchema = z
	.object({
		schemaVersion: z.literal(1),
		type: z.literal("road_transfer"),
		originPlaceId: PlaceIdSchema,
		destinationPlaceId: PlaceIdSchema,
		pickupInstructions: z.string().max(1000).optional(),
	})
	.strict();
const LodgingDetailsSchema = z
	.object({
		schemaVersion: z.literal(1),
		type: z.literal("lodging"),
		propertyName: z.string().min(1).max(200),
		checkInAt: DateTimeSchema,
		checkOutAt: DateTimeSchema,
	})
	.strict();
const MealDetailsSchema = z
	.object({
		schemaVersion: z.literal(1),
		type: z.literal("meal"),
		reservationNote: z.string().max(1000).optional(),
	})
	.strict();
const GolfDetailsSchema = z
	.object({
		schemaVersion: z.literal(1),
		type: z.literal("golf_round"),
		roundReference: z.string().min(1).max(120),
		teeTime: DateTimeSchema,
	})
	.strict();
const SessionDetailsSchema = z
	.object({
		schemaVersion: z.literal(1),
		type: z.literal("session"),
		room: z.string().max(120).optional(),
		descendantEventId: EventIdSchema.optional(),
	})
	.strict();
const DetailsInputSchema = z.discriminatedUnion("type", [
	NoteDetailsSchema,
	ActivityDetailsSchema,
	FlightDetailsInputSchema,
	RailDetailsInputSchema,
	RoadDetailsInputSchema,
	LodgingDetailsSchema,
	MealDetailsSchema,
	GolfDetailsSchema,
	SessionDetailsSchema,
]);
const DetailsSchema = z.discriminatedUnion("type", [
	NoteDetailsSchema,
	ActivityDetailsSchema,
	FlightDetailsInputSchema.extend({
		originPlaceSnapshot: PlaceSnapshotSchema,
		destinationPlaceSnapshot: PlaceSnapshotSchema,
	}),
	RailDetailsInputSchema.extend({
		originPlaceSnapshot: PlaceSnapshotSchema,
		destinationPlaceSnapshot: PlaceSnapshotSchema,
	}),
	RoadDetailsInputSchema.extend({
		originPlaceSnapshot: PlaceSnapshotSchema,
		destinationPlaceSnapshot: PlaceSnapshotSchema,
	}),
	LodgingDetailsSchema,
	MealDetailsSchema,
	GolfDetailsSchema,
	SessionDetailsSchema,
]);
const ItinerarySchema = z
	.object({
		id: ItineraryIdSchema,
		rootEventId: EventIdSchema,
		eventId: EventIdSchema,
		title: z.string(),
		notes: z.string().nullable(),
		timeZone: IanaTimeZoneSchema,
		startsAt: DateTimeSchema.nullable(),
		endsAt: DateTimeSchema.nullable(),
		allDay: z.boolean(),
		sortKey: SortKeySchema,
		status: z.enum(["active", "cancelled", "archived"]),
		details: DetailsSchema,
		placeId: PlaceIdSchema.nullable(),
		placeSnapshot: PlaceSnapshotSchema.nullable(),
		version: z.number().int().positive(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("ItineraryItem");
const ItineraryResponseSchema = z.object({ item: ItinerarySchema }).strict();
const ItineraryItemsResponseSchema = z
	.object({ items: z.array(ItinerarySchema), pageInfo: PageInfoSchema })
	.strict();
const ItineraryListResponseSchema = z
	.object({ event: EventSchema, items: z.array(ItinerarySchema) })
	.strict();
const ItineraryFieldsSchema = z
	.object({
		id: ItineraryIdSchema,
		eventId: EventIdSchema,
		title: z.string().trim().min(1).max(200),
		notes: z.string().max(20_000).nullable().default(null),
		timeZone: IanaTimeZoneSchema,
		startsAt: DateTimeSchema.nullable().default(null),
		endsAt: DateTimeSchema.nullable().default(null),
		allDay: z.boolean().default(false),
		status: z.enum(["active", "cancelled", "archived"]).default("active"),
		details: DetailsInputSchema,
		placeId: PlaceIdSchema.nullable().default(null),
	})
	.strict();
const ItineraryChangesSchema = z
	.object({
		title: z.string().trim().min(1).max(200).optional(),
		notes: z.string().max(20_000).nullable().optional(),
		timeZone: IanaTimeZoneSchema.optional(),
		startsAt: DateTimeSchema.nullable().optional(),
		endsAt: DateTimeSchema.nullable().optional(),
		allDay: z.boolean().optional(),
		status: z.enum(["active", "cancelled", "archived"]).optional(),
		details: DetailsInputSchema.optional(),
		placeId: PlaceIdSchema.nullable().optional(),
	})
	.strict()
	.refine(
		(value) => Object.keys(value).length > 0,
		"At least one change is required",
	);

const AttachmentContentTypeSchema = z.enum(attachmentContentTypes);
const FeedAttachmentTargetSchema = z
	.object({ kind: z.literal("feedEntry"), entryId: FeedIdSchema })
	.strict();
const FeedbackAttachmentTargetSchema = z
	.object({ kind: z.literal("feedback"), feedbackId: FeedbackIdSchema })
	.strict();
const AttachmentTargetSchema = z
	.discriminatedUnion("kind", [
		FeedAttachmentTargetSchema,
		FeedbackAttachmentTargetSchema,
	])
	.openapi("AttachmentTarget");
const AttachmentSchema = z
	.object({
		id: AttachmentIdSchema,
		rootEventId: EventIdSchema,
		target: AttachmentTargetSchema,
		targetEntryId: FeedIdSchema.nullable().openapi({
			description:
				"Legacy feed-entry projection. Null for feedback-bound attachments; use target for new integrations.",
		}),
		contentType: AttachmentContentTypeSchema,
		byteCount: z
			.number()
			.int()
			.min(1)
			.max(20 * 1024 * 1024),
		sha256: z.string().regex(/^[a-f0-9]{64}$/),
		caption: z.string().min(1).max(1000).nullable(),
		integrityStatus: z.literal("integrity_verified"),
		version: z.number().int().positive(),
		rootRevision: z.string().regex(/^[1-9]\d*$/),
		createdAt: DateTimeSchema,
	})
	.strict();
const ReactionSummarySchema = z
	.object({
		reaction: z.enum(feedReactions),
		count: z.number().int().positive(),
		viewerPresent: z.boolean(),
	})
	.strict();
const FeedEntrySchema = z
	.object({
		id: FeedIdSchema,
		rootEventId: EventIdSchema,
		eventId: EventIdSchema.nullable(),
		parentEntryId: FeedIdSchema.nullable(),
		authorUserId: UserIdSchema.nullable(),
		kind: z.enum(["message", "comment", "system"]),
		payloadSchemaVersion: z.literal(1),
		body: z.string().min(1).max(10_000).nullable(),
		version: z.number().int().positive(),
		rootRevision: z.string().regex(/^[1-9]\d*$/),
		createdRootRevision: z.string().regex(/^[1-9]\d*$/),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
		deletedAt: DateTimeSchema.nullable(),
		tombstoneReason: z.union([z.enum(["author", "moderation"]), z.null()]),
		reactions: z.array(ReactionSummarySchema),
		attachments: z.array(AttachmentSchema),
	})
	.strict();
const FeedEntryResponseSchema = z.object({ entry: FeedEntrySchema }).strict();
const FeedListResponseSchema = z
	.object({ items: z.array(FeedEntrySchema), pageInfo: PageInfoSchema })
	.strict();
const FeedReactionSchema = z
	.object({
		rootEventId: EventIdSchema,
		entryId: FeedIdSchema,
		userId: UserIdSchema,
		reaction: z.enum(feedReactions),
		present: z.boolean(),
		version: z.number().int().positive(),
		rootRevision: z.string().regex(/^[1-9]\d*$/),
		updatedAt: DateTimeSchema,
	})
	.strict();
const FeedbackStatusSchema = z.enum([
	"open",
	"planned",
	"in_progress",
	"completed",
	"declined",
	"duplicate",
]);
const FeedbackDiagnosticsSchema = z
	.object({
		appVersion: z.string().trim().min(1).max(64).optional(),
		buildNumber: z.string().trim().min(1).max(32).optional(),
		platform: z.enum(["ios", "android"]).optional(),
		osVersion: z.string().trim().min(1).max(64).optional(),
		deviceModel: z.string().trim().min(1).max(120).optional(),
		locale: z.string().trim().min(2).max(35).optional(),
	})
	.strict()
	.refine(
		(value) => Object.keys(value).length > 0,
		"Diagnostics cannot be empty",
	)
	.openapi("FeedbackDiagnostics");
const FeedbackContextSchema = z
	.object({
		rootEventId: EventIdSchema.nullable(),
		eventId: EventIdSchema.nullable(),
		screenKey: z
			.string()
			.regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/)
			.nullable(),
	})
	.strict()
	.openapi("FeedbackContext");
const FeedbackCommentSchema = z
	.object({
		id: FeedbackCommentIdSchema,
		authorUserId: z.union([UserIdSchema, z.null()]).openapi({
			description:
				"Null for every public reader other than the feedback author or a current root owner/organizer.",
		}),
		body: z.string().min(1).max(5_000),
		createdAt: DateTimeSchema,
	})
	.strict()
	.openapi("FeedbackComment");
const FeedbackStatusChangeSchema = z
	.object({
		version: z.number().int().positive().max(1_000),
		fromStatus: z.union([FeedbackStatusSchema, z.null()]),
		toStatus: FeedbackStatusSchema,
		changedBy: z.union([UserIdSchema, z.null()]).openapi({
			description:
				"Null for every public reader other than the feedback author or a current root owner/organizer.",
		}),
		note: z.string().min(1).max(1_000).nullable(),
		changedAt: DateTimeSchema,
	})
	.strict()
	.openapi("FeedbackStatusChange");
const FeedbackAttachmentSchema = z
	.object({
		id: AttachmentIdSchema,
		contentType: AttachmentContentTypeSchema,
		byteCount: z
			.number()
			.int()
			.min(1)
			.max(20 * 1024 * 1024),
		sha256: z.string().regex(/^[a-f0-9]{64}$/),
		caption: z.string().min(1).max(1_000).nullable(),
		createdAt: DateTimeSchema,
	})
	.strict()
	.openapi("FeedbackAttachment");
const FeedbackSchema = z
	.object({
		id: FeedbackIdSchema,
		title: z.string().min(1).max(160),
		body: z.string().min(1).max(10_000),
		visibility: z.enum(["public", "private"]),
		context: FeedbackContextSchema.nullable(),
		diagnostics: FeedbackDiagnosticsSchema.nullable().openapi({
			description:
				"Returned only to the author or a current event owner/organizer; null for every other reader.",
		}),
		authorUserId: z.union([UserIdSchema, z.null()]).openapi({
			description:
				"Null for every public reader other than the feedback author or a current root owner/organizer.",
		}),
		status: FeedbackStatusSchema,
		duplicateOfFeedbackId: FeedbackIdSchema.nullable(),
		version: z.number().int().positive().max(1_000),
		voteCount: z.number().int().nonnegative(),
		viewerHasVoted: z.boolean(),
		attachments: z.array(FeedbackAttachmentSchema).max(5).openapi({
			description:
				"Committed same-root assets. Empty when the reader no longer has current event access.",
		}),
		comments: z.array(FeedbackCommentSchema).max(20),
		commentCount: z.number().int().nonnegative(),
		commentsHasMore: z.boolean(),
		statusHistory: z.array(FeedbackStatusChangeSchema).max(20),
		statusHistoryCount: z.number().int().nonnegative(),
		statusHistoryHasMore: z.boolean(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("Feedback");
const FeedbackResponseSchema = z.object({ feedback: FeedbackSchema }).strict();
const CommunityFeedbackStatusSchema = z.enum([
	"open",
	"planned",
	"in_progress",
	"completed",
	"declined",
]);
const CommunityFeedbackSummaryShape = {
	id: FeedbackIdSchema,
	title: z.string().min(1).max(160),
	body: z.string().min(1).max(10_000),
	status: CommunityFeedbackStatusSchema,
	version: z.number().int().positive().max(1_000),
	voteCount: z.number().int().nonnegative().openapi({
		description:
			"Unique authenticated voters across the canonical item and its current duplicates.",
	}),
	duplicateCount: z.number().int().nonnegative(),
	viewerHasVoted: z.boolean(),
	followed: z.boolean(),
	createdAt: DateTimeSchema,
	updatedAt: DateTimeSchema,
};
const CommunityFeedbackSummarySchema = z
	.object(CommunityFeedbackSummaryShape)
	.strict()
	.openapi("CommunityFeedbackSummary");
const CommunityFeedbackCommentSchema = z
	.object({
		id: FeedbackCommentIdSchema,
		body: z.string().min(1).max(5_000),
		createdAt: DateTimeSchema,
	})
	.strict()
	.openapi("CommunityFeedbackComment");
const CommunityFeedbackStatusChangeSchema = z
	.object({
		version: z.number().int().positive().max(1_000),
		fromStatus: z.union([CommunityFeedbackStatusSchema, z.null()]),
		toStatus: CommunityFeedbackStatusSchema,
		note: z.string().min(1).max(1_000).nullable(),
		changedAt: DateTimeSchema,
	})
	.strict()
	.openapi("CommunityFeedbackStatusChange");
const CommunityFeedbackDetailSchema = z
	.object({
		...CommunityFeedbackSummaryShape,
		comments: z.array(CommunityFeedbackCommentSchema).max(20),
		commentCount: z.number().int().nonnegative(),
		commentsHasMore: z.boolean(),
		statusHistory: z.array(CommunityFeedbackStatusChangeSchema).max(20),
		statusHistoryCount: z.number().int().nonnegative(),
		statusHistoryHasMore: z.boolean(),
	})
	.strict()
	.openapi("CommunityFeedbackDetail");
const CommunityFeedbackResolutionSchema = z
	.object({
		feedback: CommunityFeedbackDetailSchema,
		redirectedFromFeedbackId: FeedbackIdSchema.nullable(),
	})
	.strict();
const CommunityFeedbackListResponseSchema = z
	.object({
		items: z.array(CommunityFeedbackSummarySchema).max(10),
		pageInfo: PageInfoSchema,
	})
	.strict();
const CommunityFeedbackDuplicateSuggestionSchema = z
	.object({
		id: FeedbackIdSchema,
		title: z.string().min(1).max(160),
		status: CommunityFeedbackStatusSchema,
		voteCount: z.number().int().nonnegative(),
	})
	.strict()
	.openapi("CommunityFeedbackDuplicateSuggestion");
const CommunityFeedbackDuplicateSuggestionsResponseSchema = z
	.object({
		items: z.array(CommunityFeedbackDuplicateSuggestionSchema).max(5),
		pageInfo: PageInfoSchema,
	})
	.strict();
const CommunityFeedbackUpdateSchema = z
	.object({
		feedbackId: FeedbackIdSchema,
		title: z.string().min(1).max(160),
		version: z.number().int().positive().max(1_000),
		fromStatus: CommunityFeedbackStatusSchema,
		toStatus: CommunityFeedbackStatusSchema,
		note: z.string().min(1).max(1_000).nullable(),
		changedAt: DateTimeSchema,
	})
	.strict()
	.openapi("CommunityFeedbackUpdate");
const CommunityFeedbackUpdatesResponseSchema = z
	.object({
		items: z.array(CommunityFeedbackUpdateSchema).max(50),
		pageInfo: PageInfoSchema,
	})
	.strict();
const CommunityFeedbackFollowSchema = z
	.object({ feedbackId: FeedbackIdSchema, followed: z.boolean() })
	.strict();
const CommunityFeedbackListQuerySchema = PaginationQuerySchema.extend({
	limit: z.coerce.number().int().min(1).max(10).default(10),
	status: CommunityFeedbackStatusSchema.optional(),
	followedOnly: z.enum(["true", "false"]).default("false"),
}).strict();
const CommunityFeedbackDuplicateSuggestionsQuerySchema =
	PaginationQuerySchema.extend({
		q: z.string().trim().min(2).max(500),
		limit: z.coerce.number().int().min(1).max(5).default(5),
	}).strict();
const CommunityFeedbackUpdatesQuerySchema = PaginationQuerySchema.extend({
	limit: z.coerce.number().int().min(1).max(50).default(50),
	followedOnly: z.enum(["true", "false"]).default("false"),
}).strict();
const FeedbackCreateSchema = z
	.object({
		id: FeedbackIdSchema,
		title: z.string().trim().min(1).max(160),
		body: z.string().trim().min(1).max(10_000),
		visibility: z.enum(["public", "private"]),
		rootEventId: EventIdSchema.nullable().default(null),
		eventId: EventIdSchema.nullable().default(null),
		screenKey: z
			.string()
			.regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/)
			.nullable()
			.default(null),
		diagnostics: FeedbackDiagnosticsSchema.nullable().default(null),
		attachmentIds: z
			.array(AttachmentIdSchema)
			.max(5)
			.default([])
			.refine(
				(value) => new Set(value).size === value.length,
				"Attachment IDs must be unique",
			),
	})
	.strict()
	.superRefine((value, context) => {
		if (value.eventId !== null && value.rootEventId === null)
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "eventId requires rootEventId",
				path: ["eventId"],
			});
		if (value.attachmentIds.length > 0 && value.rootEventId === null)
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "attachmentIds require rootEventId",
				path: ["attachmentIds"],
			});
	});
const UploadMetadataSchema = z
	.object({
		id: UploadIdSchema,
		attachmentId: AttachmentIdSchema,
		rootEventId: EventIdSchema,
		target: AttachmentTargetSchema,
		targetEntryId: FeedIdSchema.nullable().openapi({
			description:
				"Legacy feed-entry projection. Null for feedback-bound uploads; use target for new integrations.",
		}),
		contentType: AttachmentContentTypeSchema,
		byteCount: z
			.number()
			.int()
			.min(1)
			.max(20 * 1024 * 1024),
		sha256: z.string().regex(/^[a-f0-9]{64}$/),
		state: z.enum(["prepared", "committed", "expired"]),
		expiresAt: DateTimeSchema,
		createdAt: DateTimeSchema,
	})
	.strict();
const UploadPrepareFields = {
	attachmentId: AttachmentIdSchema,
	contentType: AttachmentContentTypeSchema,
	byteCount: z
		.number()
		.int()
		.min(1)
		.max(20 * 1024 * 1024),
	sha256: z.string().regex(/^[a-f0-9]{64}$/),
};
const UploadPrepareSchema = z
	.union([
		z.object({ ...UploadPrepareFields, targetEntryId: FeedIdSchema }).strict(),
		z
			.object({ ...UploadPrepareFields, target: AttachmentTargetSchema })
			.strict(),
	])
	.openapi("AttachmentUploadPrepare");
const UploadGrantSchema = z
	.object({
		method: z.literal("POST"),
		url: z.string().url(),
		fields: z.record(z.string(), z.string()),
		expiresAt: DateTimeSchema,
	})
	.strict();
const DownloadGrantSchema = z
	.object({
		method: z.literal("GET"),
		url: z.string().url(),
		headers: z.record(z.string(), z.string()),
		expiresAt: DateTimeSchema,
	})
	.strict();
const UploadResponseSchema = z
	.object({ upload: UploadMetadataSchema, grant: UploadGrantSchema })
	.strict();
const AttachmentResponseSchema = z
	.object({ attachment: AttachmentSchema })
	.strict();
const AttachmentFinalizePendingSchema = z
	.object({
		uploadId: UploadIdSchema,
		verification: z
			.object({
				state: z.enum(["pending", "processing", "retry"]),
				retryable: z.literal(true),
			})
			.strict(),
	})
	.strict();
const DownloadResponseSchema = z
	.object({ attachment: AttachmentSchema, download: DownloadGrantSchema })
	.strict();

const SyncSafeIntegerSchema = z
	.number()
	.int()
	.positive()
	.max(Number.MAX_SAFE_INTEGER);
const SyncClientSequenceSchema = z
	.number()
	.int()
	.positive()
	.max(Number.MAX_SAFE_INTEGER - 1);
const SyncClientMutationIdSchema = z.string().uuid().regex(CLIENT_MUTATION_ID);
const SyncRevisionSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const EventPublishReadinessReasonSchema = z
	.object({
		code: z.enum(eventPublishReadinessReasonCodes),
		path: z.string().min(1).max(300),
		message: z.string().min(1).max(200),
		meta: z
			.object({
				eventId: EventIdSchema.optional(),
				capabilityType: CapabilityTypeSchema.optional(),
				capabilityVersion: z
					.number()
					.int()
					.nonnegative()
					.max(Number.MAX_SAFE_INTEGER)
					.optional(),
			})
			.strict()
			.optional(),
	})
	.strict()
	.openapi("EventPublishReadinessReason");
const EventPublishReadinessSchema = z
	.object({
		schemaVersion: z.literal(1),
		rootEventId: EventIdSchema,
		rootStatus: EventStatusSchema.openapi({
			description:
				"Authoritative current root status from the same locked readiness read.",
		}),
		rootVersion: z.number().int().positive().openapi({
			description:
				"Optimistic version of the root event row; send it as baseVersion when publishing.",
		}),
		rootRevision: SyncRevisionSchema.openapi({
			description:
				"Aggregate revision covering readiness-affecting capability, place and graph changes; send it as baseRevision when publishing.",
		}),
		template: z
			.object({
				id: z.enum(["travel", "golf-tour", "team-event"]),
				version: z.literal(1),
			})
			.strict()
			.nullable(),
		ready: z.boolean().openapi({
			description:
				"Authoritative server result; clients must not derive publish readiness locally.",
		}),
		reasons: z.array(EventPublishReadinessReasonSchema).max(2508),
	})
	.strict()
	.openapi("EventPublishReadiness");
const EventTemplateAdoptionResponseSchema = z
	.object({
		event: EventSchema,
		rootRevision: SyncRevisionSchema,
		template: z
			.object({
				id: z.enum(["travel", "golf-tour", "team-event"]),
				version: z.literal(1),
			})
			.strict(),
	})
	.strict()
	.openapi("EventTemplateAdoptionResponse");
const RecapVersionSchema = z.number().int().positive().max(2_147_483_647);
const RecapEventProvenanceSchema = z
	.object({
		sourceType: z.literal("event"),
		sourceId: EventIdSchema,
		sourceVersion: RecapVersionSchema,
		sourceRevision: SyncRevisionSchema,
		visibility: z.literal("members"),
		consentBasis: z.literal("event-publication"),
	})
	.strict();
const RecapFeedProvenanceSchema = z
	.object({
		sourceType: z.literal("feedEntry"),
		sourceId: FeedIdSchema,
		sourceVersion: RecapVersionSchema,
		sourceRevision: SyncRevisionSchema,
		visibility: z.literal("members"),
		consentBasis: z.literal("source-author"),
	})
	.strict();
const RecapProvenanceSchema = z
	.discriminatedUnion("sourceType", [
		RecapEventProvenanceSchema,
		RecapFeedProvenanceSchema,
	])
	.openapi("EventRecapProvenance");
const EventRecapItemSchema = z
	.object({
		ordinal: z.number().int().min(0).max(49),
		sourceTitle: z.string().min(1).max(160).nullable(),
		sourceBody: z.string().min(1).max(5_000).nullable(),
		provenance: RecapProvenanceSchema,
	})
	.strict()
	.refine((item) => item.sourceTitle !== null || item.sourceBody !== null)
	.openapi("EventRecapItem");
const EventRecapSchema = z
	.object({
		schemaVersion: z.literal(1),
		rootEventId: EventIdSchema,
		version: RecapVersionSchema.openapi({
			description: "Immutable recap snapshot version.",
		}),
		lifecycleVersion: RecapVersionSchema.openapi({
			description:
				"Optimistic version for publish and remove transitions; separate from immutable content version.",
		}),
		state: z.enum(["draft", "published"]),
		publishedVersion: RecapVersionSchema.nullable(),
		sourceRootRevision: SyncRevisionSchema,
		generatedAt: DateTimeSchema,
		publishedAt: DateTimeSchema.nullable(),
		title: z.string().min(1).max(160),
		titleProvenance: RecapEventProvenanceSchema,
		items: z.array(EventRecapItemSchema).max(50).openapi({
			description:
				"Only currently authorized exact source projections; revoked items are omitted as a whole.",
		}),
	})
	.strict()
	.openapi("EventRecap");
const EventRecapResponseSchema = z.object({ recap: EventRecapSchema }).strict();
const RecapExternalDecisionStateSchema = z.enum([
	"grant",
	"withdraw",
	"unknown",
]);
const EventRecapExternalConsentFieldBase = {
	ordinal: z.number().int().min(0).max(49),
	requiredAuthorities: z
		.array(z.enum(["author", "manager"]))
		.min(1)
		.max(2)
		.openapi({
			description:
				"Event bodies require manager; feed bodies and attachment captions require author then manager.",
		}),
	authorDecision: RecapExternalDecisionStateSchema.openapi({
		description:
			"Current exact source-author or attachment-creator decision. Event bodies report unknown because author authority is not required.",
	}),
	managerDecision: RecapExternalDecisionStateSchema,
	actorCanDecide: z
		.array(z.enum(["author", "manager"]))
		.max(2)
		.openapi({
			description:
				"Authority kinds the active caller may decide; contains no actor identity.",
		}),
};
const EventRecapExternalConsentFieldSchema = z
	.discriminatedUnion("field", [
		z
			.object({
				...EventRecapExternalConsentFieldBase,
				field: z.literal("body"),
			})
			.strict(),
		z
			.object({
				...EventRecapExternalConsentFieldBase,
				field: z.literal("caption"),
				fieldRef: z.string().regex(RECAP_CAPTION_FIELD_REF_PATTERN).openapi({
					description:
						"Opaque exact-caption reference. Current refs are issued on reads; a bounded previous HMAC key may validate older refs during rotation without exposing attachment identity.",
				}),
				attachmentOrdinal: z.number().int().min(0).max(9),
				attachmentVersion: RecapVersionSchema,
				caption: z.string().min(1).max(1_000),
			})
			.strict(),
	])
	.openapi("EventRecapExternalConsentField");
const EventRecapExternalConsentSchema = z
	.object({
		fields: z.array(EventRecapExternalConsentFieldSchema).max(550),
	})
	.strict()
	.openapi("EventRecapExternalConsent");
const EventRecapReadResponseSchema = z
	.object({
		recap: EventRecapSchema,
		externalConsent: EventRecapExternalConsentSchema.nullable().openapi({
			description:
				"Current exact body and caption consent state, or null for a draft, old, archived, removed or source-drifted recap. Caption projection never includes media bytes, URLs, hashes or metadata.",
		}),
	})
	.strict();
const EventRecapRemovalResponseSchema = z
	.object({ removed: z.literal(true), lifecycleVersion: RecapVersionSchema })
	.strict();
const RecapSourceInputSchema = z.discriminatedUnion("type", [
	z
		.object({
			type: z.literal("event"),
			sourceId: EventIdSchema,
			sourceVersion: RecapVersionSchema,
			consentBasis: z.literal("event-publication"),
		})
		.strict(),
	z
		.object({
			type: z.literal("feedEntry"),
			sourceId: FeedIdSchema,
			sourceVersion: RecapVersionSchema,
			consentBasis: z.literal("source-author"),
		})
		.strict(),
]);
const RecapGenerateSchema = z
	.object({
		baseRevision: SyncRevisionSchema,
		sources: z.array(RecapSourceInputSchema).max(50),
	})
	.strict()
	.superRefine((value, context) => {
		const keys = new Set<string>();
		for (const [index, source] of value.sources.entries()) {
			const key = `${source.type}:${source.sourceId}`;
			if (keys.has(key))
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Recap sources must be unique",
					path: ["sources", index],
				});
			keys.add(key);
		}
	});
const RecapPublishSchema = z
	.object({
		recapVersion: RecapVersionSchema,
		baseLifecycleVersion: RecapVersionSchema,
	})
	.strict();
const RecapRemoveSchema = z
	.object({ baseLifecycleVersion: RecapVersionSchema })
	.strict();
const RecapShareCreateSchema = z
	.object({
		recapVersion: RecapVersionSchema,
		projectionConsent: z.literal("title-only-reviewed"),
	})
	.strict()
	.openapi("RecapShareCreate");
const RecapExternalFieldSchema = z
	.union([
		z
			.object({
				sourceType: z.literal("event"),
				sourceId: EventIdSchema,
				sourceVersion: RecapVersionSchema,
				field: z.literal("body"),
			})
			.strict(),
		z
			.object({
				sourceType: z.literal("feedEntry"),
				sourceId: FeedIdSchema,
				sourceVersion: RecapVersionSchema,
				field: z.literal("body"),
			})
			.strict(),
		z
			.object({
				sourceType: z.literal("feedEntry"),
				sourceId: FeedIdSchema,
				sourceVersion: RecapVersionSchema,
				field: z.literal("caption"),
				fieldRef: z.string().regex(RECAP_CAPTION_FIELD_REF_PATTERN),
			})
			.strict(),
	])
	.openapi("RecapExternalField");
const RecapExternalGrantDecisionSchema = z
	.union([
		z
			.object({
				recapVersion: RecapVersionSchema,
				sourceType: z.literal("event"),
				sourceId: EventIdSchema,
				sourceVersion: RecapVersionSchema,
				field: z.literal("body"),
				authority: z.literal("manager"),
				decision: z.enum(["grant", "withdraw"]),
			})
			.strict(),
		z
			.object({
				recapVersion: RecapVersionSchema,
				sourceType: z.literal("feedEntry"),
				sourceId: FeedIdSchema,
				sourceVersion: RecapVersionSchema,
				field: z.literal("body"),
				authority: z.enum(["author", "manager"]),
				decision: z.enum(["grant", "withdraw"]),
			})
			.strict(),
		z
			.object({
				recapVersion: RecapVersionSchema,
				sourceType: z.literal("feedEntry"),
				sourceId: FeedIdSchema,
				sourceVersion: RecapVersionSchema,
				field: z.literal("caption"),
				fieldRef: z.string().regex(RECAP_CAPTION_FIELD_REF_PATTERN),
				authority: z.enum(["author", "manager"]),
				decision: z.enum(["grant", "withdraw"]),
			})
			.strict(),
	])
	.openapi("RecapExternalGrantDecision");
const RecapExternalGrantDecisionResponseSchema = z
	.object({ decision: z.enum(["grant", "withdraw"]) })
	.strict();
const RecapExternalShareCreateSchema = z
	.object({
		recapVersion: RecapVersionSchema,
		projectionConsent: z.literal("exact-fields-reviewed-v1"),
		fields: z.array(RecapExternalFieldSchema).min(1).max(50),
	})
	.strict()
	.superRefine((value, context) => {
		const keys = new Set<string>();
		for (const [index, field] of value.fields.entries()) {
			const key =
				field.field === "body"
					? `${field.sourceType}:${field.sourceId}:${field.sourceVersion}:body`
					: `${field.sourceType}:${field.sourceId}:${field.sourceVersion}:caption:${field.fieldRef}`;
			if (keys.has(key))
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "External recap fields must be unique",
					path: ["fields", index],
				});
			keys.add(key);
		}
	})
	.openapi("RecapExternalShareCreate");
const RecapVersionQuerySchema = z
	.object({
		version: z.coerce.number().int().positive().max(2_147_483_647).optional(),
	})
	.strict();
const RecapShareLinkIdSchema = z.string().regex(/^rsh_[A-Za-z0-9_-]{24}$/);
const RecapShareTokenSchema = z.string().regex(/^crs_[A-Za-z0-9_-]{43}$/);
const recapShareLinkParams = z
	.object({
		rootEventId: EventIdSchema,
		shareLinkId: RecapShareLinkIdSchema,
	})
	.strict();
const EventRecapShareLinkSchema = z
	.object({
		id: RecapShareLinkIdSchema,
		recapVersion: RecapVersionSchema,
		createdAt: DateTimeSchema,
		expiresAt: DateTimeSchema,
	})
	.strict()
	.openapi("EventRecapShareLink");
const EventRecapShareLinkResponseSchema = z
	.object({
		shareLink: EventRecapShareLinkSchema,
		token: RecapShareTokenSchema,
	})
	.strict();
const EventRecapShareRevocationResponseSchema = z
	.object({ revoked: z.literal(true) })
	.strict();
const EventRecapShareItemSchema = z
	.object({
		ordinal: z.number().int().min(0).max(49),
		title: z.string().min(1).max(160),
	})
	.strict()
	.openapi("EventRecapShareItem");
const EventRecapShareSchema = z
	.object({
		title: z.string().min(1).max(160),
		items: z.array(EventRecapShareItemSchema).max(50),
	})
	.strict()
	.openapi("EventRecapShare");
const EventRecapShareResolveSchema = z
	.object({ token: RecapShareTokenSchema })
	.strict();
const EventRecapShareResponseSchema = z
	.object({ recap: EventRecapShareSchema })
	.strict();
const EventRecapExternalShareItemBase = {
	ordinal: z.number().int().min(0).max(49),
	captions: z.array(z.string().min(1).max(1_000)).max(10),
};
const EventRecapExternalShareItemSchema = z
	.union([
		z
			.object({
				...EventRecapExternalShareItemBase,
				title: z.string().min(1).max(160),
				body: z.string().min(1).max(5000).nullable(),
			})
			.strict(),
		z
			.object({
				...EventRecapExternalShareItemBase,
				title: z.null(),
				body: z.string().min(1).max(5000),
			})
			.strict(),
		z
			.object({
				...EventRecapExternalShareItemBase,
				title: z.null(),
				body: z.null(),
				captions: EventRecapExternalShareItemBase.captions.min(1),
			})
			.strict(),
	])
	.openapi("EventRecapExternalShareItem");
const EventRecapExternalShareSchema = z
	.object({
		title: z.string().min(1).max(160),
		items: z.array(EventRecapExternalShareItemSchema).max(50),
	})
	.strict()
	.openapi("EventRecapExternalShare");
const EventRecapExternalShareResponseSchema = z
	.object({ recap: EventRecapExternalShareSchema })
	.strict();
const SyncCursorSchema = z.string().min(16).max(4096);
const SyncMutationIdentity = {
	clientMutationId: SyncClientMutationIdSchema,
	clientSequence: SyncClientSequenceSchema,
};
const SyncBaseVersion = { baseVersion: SyncSafeIntegerSchema };
const SyncNonnegativeBaseVersion = {
	baseVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
};
const SyncEmptyPayloadSchema = z.object({}).strict();
const SyncEventCreatePayloadSchema = EventFieldsSchema.omit({
	id: true,
}).extend({
	parentEventId: EventIdSchema,
});
const SyncPlaceCreatePayloadSchema = z
	.object({
		name: z.string().trim().min(1).max(200),
		locality: z.string().max(200).nullable().default(null),
		countryCode: z
			.string()
			.length(2)
			.transform((value) => value.toUpperCase()),
		latitude: z.number().min(-90).max(90).nullable().default(null),
		longitude: z.number().min(-180).max(180).nullable().default(null),
	})
	.strict()
	.refine(
		(value) => (value.latitude === null) === (value.longitude === null),
		"Coordinates must be supplied together",
	);
const SyncItineraryCreatePayloadSchema = ItineraryFieldsSchema.omit({
	id: true,
});
const SyncCapabilityReplacePayloadSchema = z.discriminatedUnion("type", [
	TravelCapabilitySchema.extend({ eventId: EventIdSchema }),
	LodgingCapabilitySchema.extend({ eventId: EventIdSchema }),
	TransportCapabilitySchema.extend({ eventId: EventIdSchema }),
	GolfCapabilitySchema.extend({ eventId: EventIdSchema }),
	TeamCapabilitySchema.extend({ eventId: EventIdSchema }),
]);
const SyncFeedContentSchema = z.string().trim().min(1).max(10_000);
const SyncGolfRoundHoleInputSchema = z
	.object({
		hole: z.number().int().min(1).max(18),
		par: z.number().int().min(3).max(6),
		strokeIndex: z.number().int().min(1).max(18),
	})
	.strict();
const SyncGolfRoundPlayerInputSchema = z
	.object({
		userId: UserIdSchema,
		playingHandicap: z.number().int().min(-99).max(99),
	})
	.strict();
const SyncGolfRoundTeamInputSchema = z
	.object({
		id: GolfTeamIdSchema,
		name: z.string().trim().min(1).max(80),
		color: z
			.string()
			.regex(/^#[0-9A-F]{6}$/)
			.nullable(),
		memberUserIds: z.array(UserIdSchema).min(1).max(4),
	})
	.strict();
const SyncGolfRoundReplacePayloadSchema = z
	.object({
		eventId: EventIdSchema,
		holes: z.array(SyncGolfRoundHoleInputSchema).length(18),
		players: z.array(SyncGolfRoundPlayerInputSchema).min(1).max(500),
		teams: z.array(SyncGolfRoundTeamInputSchema).max(50),
	})
	.strict()
	.superRefine((value, context) => {
		if (
			new Set(value.holes.map(({ hole }) => hole)).size !== 18 ||
			new Set(value.holes.map(({ strokeIndex }) => strokeIndex)).size !== 18
		) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Hole numbers and stroke indices must each be unique",
				path: ["holes"],
			});
		}
		const playerIds = new Set(value.players.map(({ userId }) => userId));
		if (playerIds.size !== value.players.length) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Golf players must be unique",
				path: ["players"],
			});
		}
		const teamIds = new Set<string>();
		const assigned = new Set<string>();
		for (const [teamIndex, team] of value.teams.entries()) {
			if (teamIds.has(team.id)) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Golf teams must be unique",
					path: ["teams", teamIndex, "id"],
				});
			}
			teamIds.add(team.id);
			const teamMembers = new Set<string>();
			for (const [memberIndex, userId] of team.memberUserIds.entries()) {
				if (
					!playerIds.has(userId) ||
					teamMembers.has(userId) ||
					assigned.has(userId)
				) {
					context.addIssue({
						code: z.ZodIssueCode.custom,
						message: "Team members must be unique eligible players",
						path: ["teams", teamIndex, "memberUserIds", memberIndex],
					});
				}
				teamMembers.add(userId);
				assigned.add(userId);
			}
		}
	});
const SyncGolfScoreSetPayloadSchema = z
	.object({
		eventId: EventIdSchema,
		hole: z.number().int().min(1).max(18),
		strokes: z.number().int().min(1).max(99).nullable(),
		putts: z.number().int().min(0).max(99).nullable(),
	})
	.strict()
	.refine(
		(value) => value.strokes !== null || value.putts === null,
		"Putts must be null for a picked-up hole",
	);
const SyncTeamAssignmentInputSchema = z
	.object({
		id: z.string().regex(TEAM_ASSIGNMENT_TEAM_ID),
		name: z.string().trim().min(1).max(80),
		color: z
			.string()
			.regex(/^#[0-9A-F]{6}$/)
			.nullable(),
		memberUserIds: z.array(UserIdSchema).min(1).max(1_000),
	})
	.strict();
const SyncTeamAssignmentsPublishPayloadSchema = z
	.object({
		eventId: EventIdSchema,
		teams: z.array(SyncTeamAssignmentInputSchema).min(1).max(100),
	})
	.strict()
	.superRefine((value, context) => {
		const teamIds = new Set<string>();
		const assigned = new Set<string>();
		for (const [teamIndex, team] of value.teams.entries()) {
			if (teamIds.has(team.id)) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Team IDs must be unique",
					path: ["teams", teamIndex, "id"],
				});
			}
			teamIds.add(team.id);
			const local = new Set<string>();
			for (const [memberIndex, userId] of team.memberUserIds.entries()) {
				if (local.has(userId) || assigned.has(userId)) {
					context.addIssue({
						code: z.ZodIssueCode.custom,
						message: "Each member can belong to only one team",
						path: ["teams", teamIndex, "memberUserIds", memberIndex],
					});
				}
				local.add(userId);
				assigned.add(userId);
			}
		}
		if (assigned.size > 1_000) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				message: "An assignment set cannot contain more than 1000 members",
				path: ["teams"],
			});
		}
	});
const SyncTeamDecisionOptionInputSchema = z
	.object({
		id: z.string().regex(TEAM_DECISION_OPTION_ID),
		label: z.string().trim().min(1).max(160),
	})
	.strict();
const SyncTeamDecisionReplacePayloadSchema = z
	.object({
		eventId: EventIdSchema,
		title: z.string().trim().min(1).max(240),
		state: z.enum(["draft", "open", "closed"]),
		options: z.array(SyncTeamDecisionOptionInputSchema).min(2).max(20),
	})
	.strict()
	.superRefine((value, context) => {
		const ids = new Set<string>();
		const labels = new Set<string>();
		for (const [index, option] of value.options.entries()) {
			const label = option.label.toLocaleLowerCase("en-US");
			if (ids.has(option.id) || labels.has(label)) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Decision option IDs and labels must be unique",
					path: ["options", index],
				});
			}
			ids.add(option.id);
			labels.add(label);
		}
	});
const SyncTeamResponseSetPayloadSchema = z
	.object({
		eventId: EventIdSchema,
		decisionId: z.string().regex(TEAM_DECISION_ID),
		optionId: z.string().regex(TEAM_DECISION_OPTION_ID),
	})
	.strict();

const SyncMutationSchema = z.discriminatedUnion("kind", [
	z
		.object({
			...SyncMutationIdentity,
			kind: z.literal("event.create"),
			entityId: EventIdSchema,
			payload: SyncEventCreatePayloadSchema,
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			...SyncNonnegativeBaseVersion,
			kind: z.literal("team.assignments.publish"),
			entityId: EventIdSchema,
			payload: SyncTeamAssignmentsPublishPayloadSchema,
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			...SyncNonnegativeBaseVersion,
			kind: z.literal("team.decision.replace"),
			entityId: z.string().regex(TEAM_DECISION_ID),
			payload: SyncTeamDecisionReplacePayloadSchema,
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			...SyncNonnegativeBaseVersion,
			kind: z.literal("team.response.set"),
			entityId: z.string().regex(TEAM_RESPONSE_ID),
			payload: SyncTeamResponseSetPayloadSchema,
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			...SyncBaseVersion,
			kind: z.literal("event.update"),
			entityId: EventIdSchema,
			payload: z.object({ changes: EventPatchSchema.shape.changes }).strict(),
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			...SyncBaseVersion,
			kind: z.literal("event.reparent"),
			entityId: EventIdSchema,
			payload: z.object({ parentEventId: EventIdSchema }).strict(),
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			...SyncBaseVersion,
			kind: z.literal("event.children.reorder"),
			entityId: EventIdSchema,
			payload: z
				.object({ orderedIds: z.array(EventIdSchema).max(500) })
				.strict(),
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			...SyncBaseVersion,
			kind: z.literal("event.archive"),
			entityId: EventIdSchema,
			payload: SyncEmptyPayloadSchema,
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			...SyncBaseVersion,
			kind: z.literal("event.delete"),
			entityId: EventIdSchema,
			payload: z.object({ subtree: z.boolean().default(false) }).strict(),
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			kind: z.literal("place.create"),
			entityId: PlaceIdSchema,
			payload: SyncPlaceCreatePayloadSchema,
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			...SyncBaseVersion,
			kind: z.literal("place.update"),
			entityId: PlaceIdSchema,
			payload: z.object({ changes: PlaceChangesSchema }).strict(),
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			...SyncNonnegativeBaseVersion,
			kind: z.literal("capability.replace"),
			entityId: z.string().regex(CAPABILITY_ID),
			payload: SyncCapabilityReplacePayloadSchema,
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			...SyncBaseVersion,
			kind: z.literal("capability.remove"),
			entityId: z.string().regex(CAPABILITY_ID),
			payload: z
				.object({ eventId: EventIdSchema, type: CapabilityTypeSchema })
				.strict(),
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			kind: z.literal("itinerary.create"),
			entityId: ItineraryIdSchema,
			payload: SyncItineraryCreatePayloadSchema,
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			...SyncBaseVersion,
			kind: z.literal("itinerary.update"),
			entityId: ItineraryIdSchema,
			payload: z.object({ changes: ItineraryChangesSchema }).strict(),
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			...SyncBaseVersion,
			kind: z.literal("itinerary.reorder"),
			entityId: EventIdSchema,
			payload: z
				.object({ orderedIds: z.array(ItineraryIdSchema).max(500) })
				.strict(),
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			kind: z.literal("feed.entry.create"),
			entityId: FeedIdSchema,
			payload: z
				.object({
					eventId: EventIdSchema.nullable().default(null),
					parentEntryId: FeedIdSchema.nullable().default(null),
					kind: z.enum(["message", "comment"]).default("message"),
					content: SyncFeedContentSchema,
				})
				.strict(),
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			...SyncBaseVersion,
			kind: z.literal("feed.entry.revise"),
			entityId: FeedIdSchema,
			payload: z.object({ content: SyncFeedContentSchema }).strict(),
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			...SyncBaseVersion,
			kind: z.literal("feed.entry.remove"),
			entityId: FeedIdSchema,
			payload: SyncEmptyPayloadSchema,
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			kind: z.literal("feed.reaction.set"),
			entityId: FeedIdSchema,
			payload: z
				.object({
					reaction: z.enum(feedReactions),
					present: z.boolean(),
				})
				.strict(),
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			...SyncNonnegativeBaseVersion,
			kind: z.literal("golf.round.replace"),
			entityId: EventIdSchema,
			payload: SyncGolfRoundReplacePayloadSchema,
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			...SyncNonnegativeBaseVersion,
			kind: z.literal("golf.score.set"),
			entityId: GolfScoreIdSchema,
			payload: SyncGolfScoreSetPayloadSchema,
		})
		.strict(),
	z
		.object({
			...SyncMutationIdentity,
			kind: z.literal("attachment.commit"),
			entityId: AttachmentIdSchema,
			payload: z
				.object({
					uploadId: UploadIdSchema,
					caption: z.string().trim().min(1).max(1000).nullable().default(null),
				})
				.strict(),
		})
		.strict(),
]);

const SyncPushRequestSchema = z
	.object({
		protocolVersion: z.literal(1),
		rootEventId: EventIdSchema,
		deviceId: z.string().regex(DEVICE_ID),
		mutations: z.array(SyncMutationSchema).min(1).max(MAX_SYNC_MUTATIONS),
	})
	.strict()
	.superRefine((value, context) => {
		const sequenceCounts = new Map<number, number>();
		const mutationIdCounts = new Map<string, number>();
		for (const mutation of value.mutations) {
			sequenceCounts.set(
				mutation.clientSequence,
				(sequenceCounts.get(mutation.clientSequence) ?? 0) + 1,
			);
			mutationIdCounts.set(
				mutation.clientMutationId,
				(mutationIdCounts.get(mutation.clientMutationId) ?? 0) + 1,
			);
		}
		for (const [index, mutation] of value.mutations.entries()) {
			if ((sequenceCounts.get(mutation.clientSequence) ?? 0) > 1) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "clientSequence must be unique within the envelope",
					path: ["mutations", index, "clientSequence"],
				});
			}
			if ((mutationIdCounts.get(mutation.clientMutationId) ?? 0) > 1) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message: "clientMutationId must be unique within the envelope",
					path: ["mutations", index, "clientMutationId"],
				});
			}
		}
	});

const SyncMutationErrorFields = {
	code: z.string(),
	message: z.string(),
	currentVersion: z
		.number()
		.int()
		.nonnegative()
		.max(Number.MAX_SAFE_INTEGER)
		.optional(),
	authoritativeOrder: z.array(z.string()).optional(),
};
const SyncEntityTypeSchema = z.enum([
	"event",
	"membership",
	"invitation",
	"place",
	"capability",
	"itineraryItem",
	"feedEntry",
	"feedReaction",
	"attachment",
	"golfRound",
	"golfRoster",
	"golfPlayer",
	"golfScore",
	"golfLeaderboard",
	"teamAssignmentSet",
	"teamAssignmentRoster",
	"teamAssignment",
	"teamDecision",
	"teamResponse",
]);
const SyncMutationResultFields = {
	clientMutationId: SyncClientMutationIdSchema,
	clientSequence: SyncClientSequenceSchema,
};
const SyncMutationEntitySchema = z
	.object({
		entityType: SyncEntityTypeSchema,
		entityId: z.string(),
		version: SyncSafeIntegerSchema,
	})
	.strict();
const SyncMutationResultSchema = z.discriminatedUnion("outcome", [
	z
		.object({
			...SyncMutationResultFields,
			outcome: z.literal("applied"),
			replayed: z.boolean(),
			rootRevision: SyncRevisionSchema,
			entity: SyncMutationEntitySchema.optional(),
		})
		.strict(),
	z
		.object({
			...SyncMutationResultFields,
			outcome: z.literal("rejected"),
			replayed: z.boolean(),
			error: z
				.object({ ...SyncMutationErrorFields, retryable: z.literal(false) })
				.strict(),
		})
		.strict(),
	z
		.object({
			...SyncMutationResultFields,
			outcome: z.literal("retry"),
			replayed: z.literal(false),
			error: z
				.object({ ...SyncMutationErrorFields, retryable: z.literal(true) })
				.strict(),
			retryAfterSeconds: SyncSafeIntegerSchema,
		})
		.strict(),
	z
		.object({
			...SyncMutationResultFields,
			outcome: z.literal("blocked"),
			replayed: z.literal(false),
			error: z
				.object({ ...SyncMutationErrorFields, retryable: z.literal(false) })
				.strict(),
		})
		.strict(),
]);
const SyncPushResponseSchema = z
	.object({
		protocolVersion: z.literal(1),
		rootEventId: EventIdSchema,
		deviceId: z.string().regex(DEVICE_ID),
		results: z.array(SyncMutationResultSchema),
		nextExpectedClientSequence: SyncSafeIntegerSchema,
	})
	.strict()
	.openapi("SyncPushResponse");

const SyncChangeFields = {
	rootRevision: SyncRevisionSchema,
	ordinal: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
	entityVersion: SyncSafeIntegerSchema,
};
const SyncEventDataSchema = z
	.object({
		id: EventIdSchema,
		rootEventId: EventIdSchema,
		parentEventId: EventIdSchema.nullable(),
		kind: EventKindSchema,
		title: z.string(),
		description: z.string().nullable(),
		timeZone: IanaTimeZoneSchema,
		startsAt: DateTimeSchema.nullable(),
		endsAt: DateTimeSchema.nullable(),
		sortKey: SortKeySchema,
		childOrderVersion: SyncSafeIntegerSchema,
		itineraryOrderVersion: SyncSafeIntegerSchema,
		status: EventStatusSchema,
		version: SyncSafeIntegerSchema,
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
		deletedAt: DateTimeSchema.nullable(),
	})
	.strict()
	.openapi("SyncEventData");
const SyncMembershipDataSchema = z
	.object({
		rootEventId: EventIdSchema,
		userId: UserIdSchema,
		role: RoleSchema,
		status: z.enum(["active", "left", "removed"]),
		version: SyncSafeIntegerSchema,
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("SyncMembershipData");
const SyncInvitationDataSchema = z
	.object({
		id: InvitationIdSchema,
		rootEventId: EventIdSchema,
		role: z.enum(["organizer", "participant", "viewer"]),
		emailBound: z.boolean(),
		expiresAt: DateTimeSchema,
		maxUses: SyncSafeIntegerSchema,
		useCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
		status: z.enum(["active", "revoked"]),
		version: SyncSafeIntegerSchema,
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("SyncInvitationData");
const SyncPlaceDataSchema = z
	.object({
		id: PlaceIdSchema,
		rootEventId: EventIdSchema,
		name: z.string(),
		locality: z.string().nullable(),
		countryCode: z.string().length(2),
		latitude: z.number().nullable(),
		longitude: z.number().nullable(),
		version: SyncSafeIntegerSchema,
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
		deletedAt: DateTimeSchema.nullable(),
	})
	.strict()
	.openapi("SyncPlaceData");
const syncCapabilityRecordFields = {
	rootEventId: EventIdSchema,
	eventId: EventIdSchema,
	version: SyncSafeIntegerSchema,
	createdAt: DateTimeSchema,
	updatedAt: DateTimeSchema,
	deletedAt: z.null(),
};
const SyncCapabilityDataSchema = z
	.discriminatedUnion("type", [
		TravelCapabilitySchema.extend(syncCapabilityRecordFields),
		LodgingCapabilitySchema.extend(syncCapabilityRecordFields),
		TransportCapabilitySchema.extend(syncCapabilityRecordFields),
		GolfCapabilitySchema.extend(syncCapabilityRecordFields),
		TeamCapabilitySchema.extend(syncCapabilityRecordFields),
	])
	.openapi("SyncCapabilityData");
const SyncItineraryDataSchema = z
	.object({
		id: ItineraryIdSchema,
		rootEventId: EventIdSchema,
		eventId: EventIdSchema,
		title: z.string(),
		notes: z.string().nullable(),
		timeZone: IanaTimeZoneSchema,
		startsAt: DateTimeSchema.nullable(),
		endsAt: DateTimeSchema.nullable(),
		allDay: z.boolean(),
		sortKey: SortKeySchema,
		status: z.enum(["active", "cancelled", "archived"]),
		details: DetailsSchema,
		placeId: PlaceIdSchema.nullable(),
		placeSnapshot: PlaceSnapshotSchema.nullable(),
		version: SyncSafeIntegerSchema,
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
		deletedAt: DateTimeSchema.nullable(),
	})
	.strict()
	.openapi("SyncItineraryData");
const SyncFeedEntryDataSchema = z
	.object({
		id: FeedIdSchema,
		rootEventId: EventIdSchema,
		eventId: EventIdSchema.nullable(),
		parentEntryId: FeedIdSchema.nullable(),
		actorUserId: UserIdSchema.nullable(),
		kind: z.enum(["message", "comment", "system"]),
		payloadSchemaVersion: z.literal(1),
		payload: z.object({ text: z.string().nullable() }).strict(),
		rootRevision: SyncRevisionSchema,
		createdRootRevision: SyncRevisionSchema,
		version: SyncSafeIntegerSchema,
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
		deletedAt: z.null(),
	})
	.strict()
	.openapi("SyncFeedEntryData");
const SyncFeedReactionDataSchema = z
	.object({
		entryId: FeedIdSchema,
		rootEventId: EventIdSchema,
		userId: UserIdSchema,
		reaction: z.enum(feedReactions),
		present: z.literal(true),
		version: SyncSafeIntegerSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("SyncFeedReactionData");
const SyncAttachmentDataSchema = z
	.object({
		id: AttachmentIdSchema,
		rootEventId: EventIdSchema,
		target: z
			.object({ entityType: z.literal("feedEntry"), entityId: FeedIdSchema })
			.strict(),
		contentType: AttachmentContentTypeSchema,
		byteCount: z
			.number()
			.int()
			.min(1)
			.max(20 * 1024 * 1024),
		sha256: z.string().regex(/^[a-f0-9]{64}$/),
		caption: z.string().min(1).max(1000).nullable(),
		version: SyncSafeIntegerSchema,
		createdAt: DateTimeSchema,
	})
	.strict()
	.openapi("SyncAttachmentData");
const SyncGolfHoleDataSchema = z
	.object({
		hole: z.number().int().min(1).max(18),
		par: z.number().int().min(3).max(6),
		strokeIndex: z.number().int().min(1).max(18),
	})
	.strict()
	.openapi("SyncGolfHoleData");
const SyncGolfTeamDataSchema = z
	.object({
		id: GolfTeamIdSchema,
		name: z.string().min(1).max(80),
		color: z
			.string()
			.regex(/^#[0-9A-F]{6}$/)
			.nullable(),
		memberUserIds: z.array(UserIdSchema).min(1).max(4),
	})
	.strict()
	.openapi("SyncGolfTeamData");
const SyncGolfRoundDataSchema = z
	.object({
		rootEventId: EventIdSchema,
		eventId: EventIdSchema,
		holes: z.array(SyncGolfHoleDataSchema).length(18),
		teams: z.array(SyncGolfTeamDataSchema).max(50),
		version: SyncSafeIntegerSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("SyncGolfRoundData");
const SyncGolfPlayerDataSchema = z
	.object({
		rootEventId: EventIdSchema,
		eventId: EventIdSchema,
		userId: UserIdSchema,
		playingHandicap: z.number().int().min(-99).max(99),
		version: SyncSafeIntegerSchema,
	})
	.strict()
	.openapi("SyncGolfPlayerData");
const SyncGolfRosterDataSchema = z
	.object({
		rootEventId: EventIdSchema,
		eventId: EventIdSchema,
		players: z.array(SyncGolfRoundPlayerInputSchema).min(1).max(500),
		version: SyncSafeIntegerSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("SyncGolfRosterData");
const SyncGolfScoreDataSchema = z
	.object({
		id: GolfScoreIdSchema,
		rootEventId: EventIdSchema,
		eventId: EventIdSchema,
		userId: UserIdSchema,
		hole: z.number().int().min(1).max(18),
		strokes: z.number().int().min(1).max(99).nullable(),
		putts: z.number().int().min(0).max(99).nullable(),
		playingHandicap: z.number().int().min(-99).max(99),
		handicapStrokes: z.number().int().min(-6).max(6),
		netStrokes: z.number().int().min(-5).max(105).nullable(),
		stablefordPoints: z.number().int().min(0).max(6),
		version: SyncSafeIntegerSchema,
		rootRevision: SyncRevisionSchema,
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("SyncGolfScoreData");
const SyncGolfLeaderboardEntryDataSchema = z
	.object({
		rank: z.number().int().min(1).max(500),
		userId: UserIdSchema,
		teamId: GolfTeamIdSchema.nullable(),
		stablefordPoints: z.number().int().min(0).max(108),
		holesCompleted: z.number().int().min(0).max(18),
	})
	.strict()
	.openapi("SyncGolfLeaderboardEntryData");
const SyncGolfLeaderboardDataSchema = z
	.object({
		rootEventId: EventIdSchema,
		eventId: EventIdSchema,
		version: SyncSafeIntegerSchema,
		entries: z.array(SyncGolfLeaderboardEntryDataSchema).max(500),
	})
	.strict()
	.openapi("SyncGolfLeaderboardData");
const SyncTeamPublicTeamDataSchema = z
	.object({
		id: z.string().regex(TEAM_ASSIGNMENT_TEAM_ID),
		name: z.string().min(1).max(80),
		color: z
			.string()
			.regex(/^#[0-9A-F]{6}$/)
			.nullable(),
	})
	.strict()
	.openapi("SyncTeamPublicTeamData");
const SyncTeamAssignmentSetDataSchema = z
	.object({
		rootEventId: EventIdSchema,
		eventId: EventIdSchema,
		teams: z.array(SyncTeamPublicTeamDataSchema).min(1).max(100),
		version: SyncSafeIntegerSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("SyncTeamAssignmentSetData");
const SyncTeamAssignmentRosterDataSchema = z
	.object({
		rootEventId: EventIdSchema,
		eventId: EventIdSchema,
		teams: z.array(SyncTeamAssignmentInputSchema).min(1).max(100),
		version: SyncSafeIntegerSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("SyncTeamAssignmentRosterData");
const SyncTeamAssignmentDataSchema = z
	.object({
		rootEventId: EventIdSchema,
		eventId: EventIdSchema,
		userId: UserIdSchema,
		team: SyncTeamPublicTeamDataSchema,
		version: SyncSafeIntegerSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("SyncTeamAssignmentData");
const SyncTeamDecisionOptionDataSchema = z
	.object({
		id: z.string().regex(TEAM_DECISION_OPTION_ID),
		label: z.string().min(1).max(160),
		responseCount: z.number().int().min(0).max(1_000),
	})
	.strict()
	.openapi("SyncTeamDecisionOptionData");
const SyncTeamDecisionDataSchema = z
	.object({
		id: z.string().regex(TEAM_DECISION_ID),
		rootEventId: EventIdSchema,
		eventId: EventIdSchema,
		title: z.string().min(1).max(240),
		state: z.enum(["draft", "open", "closed"]),
		options: z.array(SyncTeamDecisionOptionDataSchema).min(2).max(20),
		responseCount: z.number().int().min(0).max(1_000),
		version: SyncSafeIntegerSchema,
		aggregateVersion: SyncSafeIntegerSchema,
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("SyncTeamDecisionData");
const SyncTeamResponseDataSchema = z
	.object({
		id: z.string().regex(TEAM_RESPONSE_ID),
		rootEventId: EventIdSchema,
		eventId: EventIdSchema,
		decisionId: z.string().regex(TEAM_DECISION_ID),
		userId: UserIdSchema,
		optionId: z.string().regex(TEAM_DECISION_OPTION_ID),
		version: SyncSafeIntegerSchema,
		rootRevision: SyncRevisionSchema,
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.strict()
	.openapi("SyncTeamResponseData");

const syncUpsertChange = <T extends z.infer<typeof SyncEntityTypeSchema>>(
	entityType: T,
	entityId: z.ZodTypeAny,
	data: z.ZodTypeAny,
) =>
	z
		.object({
			...SyncChangeFields,
			entityType: z.literal(entityType),
			entityId,
			operation: z.literal("upsert"),
			data,
		})
		.strict();
const SyncUpsertChangeSchema = z.discriminatedUnion("entityType", [
	syncUpsertChange("event", EventIdSchema, SyncEventDataSchema),
	syncUpsertChange("membership", UserIdSchema, SyncMembershipDataSchema),
	syncUpsertChange("invitation", InvitationIdSchema, SyncInvitationDataSchema),
	syncUpsertChange("place", PlaceIdSchema, SyncPlaceDataSchema),
	syncUpsertChange(
		"capability",
		z.string().regex(CAPABILITY_ID),
		SyncCapabilityDataSchema,
	),
	syncUpsertChange("itineraryItem", ItineraryIdSchema, SyncItineraryDataSchema),
	syncUpsertChange("feedEntry", FeedIdSchema, SyncFeedEntryDataSchema),
	syncUpsertChange(
		"feedReaction",
		z.string().regex(/^fer_[a-f0-9]{64}$/),
		SyncFeedReactionDataSchema,
	),
	syncUpsertChange("attachment", AttachmentIdSchema, SyncAttachmentDataSchema),
	syncUpsertChange("golfRound", EventIdSchema, SyncGolfRoundDataSchema),
	syncUpsertChange("golfRoster", GolfRosterIdSchema, SyncGolfRosterDataSchema),
	syncUpsertChange("golfPlayer", GolfPlayerIdSchema, SyncGolfPlayerDataSchema),
	syncUpsertChange("golfScore", GolfScoreIdSchema, SyncGolfScoreDataSchema),
	syncUpsertChange(
		"golfLeaderboard",
		GolfLeaderboardIdSchema,
		SyncGolfLeaderboardDataSchema,
	),
	syncUpsertChange(
		"teamAssignmentSet",
		EventIdSchema,
		SyncTeamAssignmentSetDataSchema,
	),
	syncUpsertChange(
		"teamAssignmentRoster",
		z.string().regex(TEAM_ASSIGNMENT_ROSTER_ID),
		SyncTeamAssignmentRosterDataSchema,
	),
	syncUpsertChange(
		"teamAssignment",
		z.string().regex(TEAM_ASSIGNMENT_ID),
		SyncTeamAssignmentDataSchema,
	),
	syncUpsertChange(
		"teamDecision",
		z.string().regex(TEAM_DECISION_ID),
		SyncTeamDecisionDataSchema,
	),
	syncUpsertChange(
		"teamResponse",
		z.string().regex(TEAM_RESPONSE_ID),
		SyncTeamResponseDataSchema,
	),
]);
const syncDeletedEntityTombstone = (
	entityType:
		| "event"
		| "itineraryItem"
		| "invitation"
		| "golfPlayer"
		| "teamAssignment",
	id: z.ZodTypeAny,
) =>
	z
		.object({
			entityType: z.literal(entityType),
			id,
			rootEventId: EventIdSchema,
			eventId: EventIdSchema,
			version: SyncSafeIntegerSchema,
			deletedAt: DateTimeSchema,
		})
		.strict();
const SyncFeedEntryTombstoneSchema = z
	.object({
		id: FeedIdSchema,
		rootEventId: EventIdSchema,
		eventId: EventIdSchema.nullable(),
		version: SyncSafeIntegerSchema,
		deletedAt: DateTimeSchema,
	})
	.strict();
const SyncFeedReactionTombstoneSchema = z
	.object({
		entryId: FeedIdSchema,
		rootEventId: EventIdSchema,
		userId: UserIdSchema,
		reaction: z.enum(feedReactions),
		version: SyncSafeIntegerSchema,
		deletedAt: DateTimeSchema,
	})
	.strict();
const SyncCapabilityTombstoneSchema = z
	.object({
		entityType: z.literal("capability"),
		id: z.string().regex(CAPABILITY_ID),
		rootEventId: EventIdSchema,
		eventId: EventIdSchema,
		type: CapabilityTypeSchema,
		version: SyncSafeIntegerSchema,
		deletedAt: DateTimeSchema,
	})
	.strict();
const SyncTombstoneChangeSchema = z.discriminatedUnion("entityType", [
	z
		.object({
			...SyncChangeFields,
			entityType: z.literal("event"),
			entityId: EventIdSchema,
			operation: z.literal("tombstone"),
			tombstone: syncDeletedEntityTombstone("event", EventIdSchema),
		})
		.strict(),
	z
		.object({
			...SyncChangeFields,
			entityType: z.literal("teamAssignment"),
			entityId: z.string().regex(TEAM_ASSIGNMENT_ID),
			operation: z.literal("tombstone"),
			tombstone: syncDeletedEntityTombstone(
				"teamAssignment",
				z.string().regex(TEAM_ASSIGNMENT_ID),
			),
		})
		.strict(),
	z
		.object({
			...SyncChangeFields,
			entityType: z.literal("invitation"),
			entityId: InvitationIdSchema,
			operation: z.literal("tombstone"),
			tombstone: syncDeletedEntityTombstone("invitation", InvitationIdSchema),
		})
		.strict(),
	z
		.object({
			...SyncChangeFields,
			entityType: z.literal("itineraryItem"),
			entityId: ItineraryIdSchema,
			operation: z.literal("tombstone"),
			tombstone: syncDeletedEntityTombstone("itineraryItem", ItineraryIdSchema),
		})
		.strict(),
	z
		.object({
			...SyncChangeFields,
			entityType: z.literal("golfPlayer"),
			entityId: GolfPlayerIdSchema,
			operation: z.literal("tombstone"),
			tombstone: syncDeletedEntityTombstone("golfPlayer", GolfPlayerIdSchema),
		})
		.strict(),
	z
		.object({
			...SyncChangeFields,
			entityType: z.literal("capability"),
			entityId: z.string().regex(CAPABILITY_ID),
			operation: z.literal("tombstone"),
			tombstone: SyncCapabilityTombstoneSchema,
		})
		.strict(),
	z
		.object({
			...SyncChangeFields,
			entityType: z.literal("feedEntry"),
			entityId: FeedIdSchema,
			operation: z.literal("tombstone"),
			tombstone: SyncFeedEntryTombstoneSchema,
		})
		.strict(),
	z
		.object({
			...SyncChangeFields,
			entityType: z.literal("feedReaction"),
			entityId: z.string().regex(/^fer_[a-f0-9]{64}$/),
			operation: z.literal("tombstone"),
			tombstone: SyncFeedReactionTombstoneSchema,
		})
		.strict(),
]);
const SyncChangeSchema = z.union([
	SyncUpsertChangeSchema,
	SyncTombstoneChangeSchema,
]);
const SyncPageInfoSchema = z
	.object({ nextCursor: SyncCursorSchema.nullable(), hasMore: z.boolean() })
	.strict();
const SyncPullResponseSchema = z
	.object({
		protocolVersion: z.literal(1),
		rootEventId: EventIdSchema,
		authorizationScopeVersion: SyncRevisionSchema,
		changes: z.array(SyncChangeSchema),
		checkpointCursor: SyncCursorSchema,
		pageInfo: SyncPageInfoSchema,
	})
	.strict()
	.openapi("SyncPullResponse");
const syncSnapshotRecord = <T extends z.infer<typeof SyncEntityTypeSchema>>(
	entityType: T,
	entityId: z.ZodTypeAny,
	data: z.ZodTypeAny,
) =>
	z
		.object({
			entityType: z.literal(entityType),
			entityId,
			entityVersion: SyncSafeIntegerSchema,
			data,
		})
		.strict();
const SyncSnapshotRecordSchema = z.discriminatedUnion("entityType", [
	syncSnapshotRecord("event", EventIdSchema, SyncEventDataSchema),
	syncSnapshotRecord("membership", UserIdSchema, SyncMembershipDataSchema),
	syncSnapshotRecord(
		"invitation",
		InvitationIdSchema,
		SyncInvitationDataSchema,
	),
	syncSnapshotRecord("place", PlaceIdSchema, SyncPlaceDataSchema),
	syncSnapshotRecord(
		"capability",
		z.string().regex(CAPABILITY_ID),
		SyncCapabilityDataSchema,
	),
	syncSnapshotRecord(
		"itineraryItem",
		ItineraryIdSchema,
		SyncItineraryDataSchema,
	),
	syncSnapshotRecord("feedEntry", FeedIdSchema, SyncFeedEntryDataSchema),
	syncSnapshotRecord(
		"feedReaction",
		z.string().regex(/^fer_[a-f0-9]{64}$/),
		SyncFeedReactionDataSchema,
	),
	syncSnapshotRecord(
		"attachment",
		AttachmentIdSchema,
		SyncAttachmentDataSchema,
	),
	syncSnapshotRecord("golfRound", EventIdSchema, SyncGolfRoundDataSchema),
	syncSnapshotRecord(
		"golfRoster",
		GolfRosterIdSchema,
		SyncGolfRosterDataSchema,
	),
	syncSnapshotRecord(
		"golfPlayer",
		GolfPlayerIdSchema,
		SyncGolfPlayerDataSchema,
	),
	syncSnapshotRecord("golfScore", GolfScoreIdSchema, SyncGolfScoreDataSchema),
	syncSnapshotRecord(
		"golfLeaderboard",
		GolfLeaderboardIdSchema,
		SyncGolfLeaderboardDataSchema,
	),
	syncSnapshotRecord(
		"teamAssignmentSet",
		EventIdSchema,
		SyncTeamAssignmentSetDataSchema,
	),
	syncSnapshotRecord(
		"teamAssignmentRoster",
		z.string().regex(TEAM_ASSIGNMENT_ROSTER_ID),
		SyncTeamAssignmentRosterDataSchema,
	),
	syncSnapshotRecord(
		"teamAssignment",
		z.string().regex(TEAM_ASSIGNMENT_ID),
		SyncTeamAssignmentDataSchema,
	),
	syncSnapshotRecord(
		"teamDecision",
		z.string().regex(TEAM_DECISION_ID),
		SyncTeamDecisionDataSchema,
	),
	syncSnapshotRecord(
		"teamResponse",
		z.string().regex(TEAM_RESPONSE_ID),
		SyncTeamResponseDataSchema,
	),
]);
const SyncBootstrapResponseSchema = z
	.object({
		protocolVersion: z.literal(1),
		rootEventId: EventIdSchema,
		authorizationScopeVersion: SyncRevisionSchema,
		snapshotId: z.string().regex(/^snp_[A-Za-z0-9._:-]{1,96}$/),
		snapshotRevision: SyncRevisionSchema,
		records: z.array(SyncSnapshotRecordSchema),
		syncCursor: SyncCursorSchema,
		pageInfo: SyncPageInfoSchema,
	})
	.strict()
	.openapi("SyncBootstrapResponse");

const commandHeaders = {
	"X-Request-ID": RequestIdHeader,
	"Idempotency-Replayed": ReplayHeader,
};
const readHeaders = { "X-Request-ID": RequestIdHeader };
const createdHeaders = { ...commandHeaders, Location: LocationHeader };
const privateCreatedHeaders = {
	...createdHeaders,
	"Cache-Control": PrivateNoStoreHeader,
};
const privateCommandHeaders = {
	...commandHeaders,
	"Cache-Control": PrivateNoStoreHeader,
};
const privateReadHeaders = {
	...readHeaders,
	"Cache-Control": PrivateNoStoreHeader,
};
const response = (
	schema: z.ZodTypeAny,
	description: string,
	created = false,
) => ({
	description,
	headers: created ? createdHeaders : commandHeaders,
	content: { "application/json": { schema } },
});
const readResponse = (schema: z.ZodTypeAny, description: string) => ({
	description,
	headers: readHeaders,
	content: { "application/json": { schema } },
});
const privateCreatedResponse = (schema: z.ZodTypeAny, description: string) => ({
	description,
	headers: privateCreatedHeaders,
	content: { "application/json": { schema } },
});
const privateResponse = (schema: z.ZodTypeAny, description: string) => ({
	description,
	headers: privateCommandHeaders,
	content: { "application/json": { schema } },
});
const privateReadResponse = (schema: z.ZodTypeAny, description: string) => ({
	description,
	headers: privateReadHeaders,
	content: { "application/json": { schema } },
});
const retryResponse = (schema: z.ZodTypeAny, description: string) => ({
	description,
	headers: {
		"X-Request-ID": RequestIdHeader,
		"Idempotency-Replayed": PendingReplayHeader,
		"Retry-After": RetryAfterHeader,
	},
	content: { "application/json": { schema } },
});
const enrichmentAcceptedResponse = (
	schema: z.ZodTypeAny,
	description: string,
) => ({
	description,
	headers: { ...createdHeaders, "Retry-After": RetryAfterHeader },
	content: { "application/json": { schema } },
});

const listEventTemplatesRoute = createRoute({
	method: "get",
	path: "/v1/event-templates",
	operationId: "eventTemplatesList",
	tags: ["events"],
	summary: "List deterministic built-in event templates",
	security: [{ userBearer: [] }],
	responses: {
		200: readResponse(EventTemplatesResponseSchema, "Event templates"),
		401: errors[401],
		500: errors[500],
	},
	"x-idempotency": "none",
});
const listRootsRoute = createRoute({
	method: "get",
	path: "/v1/event-roots",
	operationId: "eventRootsList",
	tags: ["events"],
	summary: "List root events with an active membership for the caller",
	security: [{ userBearer: [] }],
	request: {
		query: PaginationQuerySchema.extend({
			includeArchived: z.enum(["true", "false"]).default("false"),
		}).strict(),
	},
	responses: {
		200: readResponse(EventRootPageResponseSchema, "Visible root events"),
		400: errors[400],
		401: errors[401],
		500: errors[500],
	},
	"x-idempotency": "none",
	"x-pagination": {
		strategy: "signed-keyset",
		defaultLimit: 50,
		maxLimit: 200,
		order: "rootEventId ASC",
		cursorBinding: ["principal", "operation", "includeArchived"],
	},
});
const createRootRoute = createRoute({
	method: "post",
	path: "/v1/event-roots",
	operationId: "eventsCreate",
	tags: ["events"],
	summary: "Create a root event and owner membership",
	security: [{ userBearer: [] }],
	request: {
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: { "application/json": { schema: RootEventFieldsSchema } },
		},
	},
	responses: {
		201: response(EventResponseSchema, "Root event created", true),
		...errors,
	},
	"x-idempotency": "required",
});
const adoptRootTemplateRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/template",
	operationId: "eventTemplateAdopt",
	tags: ["events"],
	summary: "Adopt one supported template on an existing draft root",
	description:
		"The server locks the aggregate and caller-stable template IDs, compares both versions, preserves existing content and expands the template atomically.",
	security: [{ userBearer: [] }],
	request: {
		params: rootParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							baseVersion: z.number().int().positive(),
							baseRevision: SyncRevisionSchema,
							template: EventTemplateRequestSchema,
						})
						.strict(),
				},
			},
		},
	},
	responses: {
		200: response(
			EventTemplateAdoptionResponseSchema,
			"Template adopted atomically",
		),
		...errors,
	},
	"x-idempotency": "required",
});
const getRootRoute = createRoute({
	method: "get",
	path: "/v1/event-roots/{rootEventId}",
	operationId: "eventsTreeGet",
	tags: ["events"],
	summary: "Read the visible recursive event graph",
	security: [{ userBearer: [] }],
	request: { params: rootParams },
	responses: {
		200: readResponse(RootResponseSchema, "Visible event graph"),
		401: errors[401],
		404: errors[404],
		409: errors[409],
		500: errors[500],
	},
	"x-idempotency": "none",
	"x-collection-policy": {
		strategy: "aggregate-bootstrap",
		maxItems: 500,
		overflow: "409 ROOT_GRAPH_LIMIT_EXCEEDED",
	},
});
const getPublishReadinessRoute = createRoute({
	method: "get",
	path: "/v1/event-roots/{rootEventId}/publish-readiness",
	operationId: "eventPublishReadinessGet",
	tags: ["events"],
	summary: "Read the authoritative versioned root publish checklist",
	description:
		"Owner and organizer clients render these finite reason codes and must not derive readiness locally.",
	security: [{ userBearer: [] }],
	request: { params: rootParams },
	responses: {
		200: readResponse(
			EventPublishReadinessSchema,
			"Authoritative publish readiness",
		),
		401: errors[401],
		403: errors[403],
		404: errors[404],
		500: errors[500],
	},
	"x-idempotency": "none",
});
const publishRootRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/publish",
	operationId: "eventsPublish",
	tags: ["events"],
	summary: "Publish a ready draft root atomically",
	description:
		"The server locks the aggregate, compares both versions and recomputes readiness before changing status.",
	security: [{ userBearer: [] }],
	request: {
		params: rootParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							baseVersion: z.number().int().positive().openapi({
								description: "rootVersion returned by the readiness endpoint.",
							}),
							baseRevision: SyncRevisionSchema.openapi({
								description:
									"rootRevision returned by the same readiness snapshot.",
							}),
						})
						.strict(),
				},
			},
		},
	},
	responses: {
		200: response(EventResponseSchema, "Root event published"),
		...errors,
	},
	"x-idempotency": "required",
});
const getRecapRoute = createRoute({
	method: "get",
	path: "/v1/event-roots/{rootEventId}/recap",
	operationId: "eventRecapsGet",
	tags: ["events"],
	summary: "Read one currently authorized immutable recap projection",
	description:
		"Managers may read non-removed versions; participants and viewers receive only the current published version. Every source is revalidated before content is returned.",
	security: [{ userBearer: [] }],
	request: { params: rootParams, query: RecapVersionQuerySchema },
	responses: {
		200: privateReadResponse(
			EventRecapReadResponseSchema,
			"Authorized recap projection",
		),
		401: errors[401],
		404: errors[404],
		500: errors[500],
	},
	"x-idempotency": "none",
});
const generateRecapRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/recap/generate",
	operationId: "eventRecapsGenerate",
	tags: ["events"],
	summary: "Generate an immutable recap draft from authoritative sources",
	description:
		"The server copies bounded exact published source fields. Client-authored recap text and provider generation are not accepted by this operation.",
	security: [{ userBearer: [] }],
	request: {
		params: rootParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: { "application/json": { schema: RecapGenerateSchema } },
		},
	},
	responses: {
		201: privateCreatedResponse(
			EventRecapResponseSchema,
			"Immutable recap draft generated",
		),
		...errors,
	},
	"x-idempotency": "required",
});
const publishRecapRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/recap/publish",
	operationId: "eventRecapsPublish",
	tags: ["events"],
	summary: "Publish the latest privacy-revalidated recap snapshot",
	description:
		"Publication compares the recap lifecycle version and revalidates every exact source version, visibility and consent boundary in one transaction.",
	security: [{ userBearer: [] }],
	request: {
		params: rootParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: { "application/json": { schema: RecapPublishSchema } },
		},
	},
	responses: {
		200: privateResponse(EventRecapResponseSchema, "Recap published"),
		...errors,
	},
	"x-idempotency": "required",
});
const removeRecapRoute = createRoute({
	method: "delete",
	path: "/v1/event-roots/{rootEventId}/recap",
	operationId: "eventRecapsRemove",
	tags: ["events"],
	summary: "Tombstone all currently generated recap versions",
	description:
		"Removal revokes every generated version through the current head while retaining immutable audit rows internally.",
	security: [{ userBearer: [] }],
	request: {
		params: rootParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: { "application/json": { schema: RecapRemoveSchema } },
		},
	},
	responses: {
		200: privateResponse(EventRecapRemovalResponseSchema, "Recap removed"),
		...errors,
	},
	"x-idempotency": "required",
});
const createRecapShareLinkRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/recap/share-links",
	operationId: "eventRecapShareLinksCreate",
	tags: ["events"],
	summary: "Create or rotate the bounded external recap share link",
	description:
		"After the manager reviews the exact title-only projection, creates one seven-day link for the requested current published recap version and atomically revokes every prior active link. The opaque token is returned only in this response or an authorized exact replay.",
	security: [{ userBearer: [] }],
	request: {
		params: rootParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: { "application/json": { schema: RecapShareCreateSchema } },
		},
	},
	responses: {
		201: privateCreatedResponse(
			EventRecapShareLinkResponseSchema,
			"External recap share link created",
		),
		...errors,
	},
	"x-idempotency": "required",
});
const decideRecapExternalGrantRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/recap/external-grants",
	operationId: "eventRecapExternalGrantsDecide",
	tags: ["events"],
	summary: "Grant or withdraw one exact external recap text field",
	description:
		"Appends one exact recap/source-version body or attachment-caption decision. Event bodies require manager authority; feed bodies and captions require separate author/creator and manager decisions. No source content is copied into the decision record.",
	security: [{ userBearer: [] }],
	request: {
		params: rootParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": { schema: RecapExternalGrantDecisionSchema },
			},
		},
	},
	responses: {
		200: privateResponse(
			RecapExternalGrantDecisionResponseSchema,
			"External recap grant decision appended",
		),
		...errors,
	},
	"x-idempotency": "required",
});
const createRecapExternalShareLinkRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/recap/external-share-links",
	operationId: "eventRecapExternalShareLinksCreate",
	tags: ["events"],
	summary: "Create a reviewed exact-field external recap link",
	description:
		"After all exact body and caption fields have current source-author or attachment-creator and manager grants, creates one seven-day text-only link bound to those immutable field identities and rotates every prior active recap link. Media bytes, URLs, hashes and metadata remain unavailable.",
	security: [{ userBearer: [] }],
	request: {
		params: rootParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": { schema: RecapExternalShareCreateSchema },
			},
		},
	},
	responses: {
		201: privateCreatedResponse(
			EventRecapShareLinkResponseSchema,
			"Exact-field external recap share link created",
		),
		...errors,
	},
	"x-idempotency": "required",
});
const revokeRecapShareLinkRoute = createRoute({
	method: "delete",
	path: "/v1/event-roots/{rootEventId}/recap/share-links/{shareLinkId}",
	operationId: "eventRecapShareLinksRevoke",
	tags: ["events"],
	summary: "Revoke one external recap share link",
	description:
		"Revocation is immediate and idempotent for the identified link. Unknown resources remain concealed.",
	security: [{ userBearer: [] }],
	request: {
		params: recapShareLinkParams,
		headers: IdempotencyHeadersSchema,
	},
	responses: {
		200: privateResponse(
			EventRecapShareRevocationResponseSchema,
			"External recap share link revoked",
		),
		...errors,
	},
	"x-idempotency": "required",
});
const resolveRecapShareLinkRoute = createRoute({
	method: "post",
	path: "/v1/recap-share-links/resolve",
	operationId: "eventRecapShareLinksResolve",
	tags: ["events"],
	summary: "Resolve one opaque external recap share token",
	description:
		"Returns a redacted exact published recap while the link, root, creator authority, title, sources, consent and removal policy remain valid. Malformed, unknown, revoked, rotated, expired and concealed links share one response.",
	security: [],
	request: {
		body: {
			required: true,
			content: {
				"application/json": { schema: EventRecapShareResolveSchema },
			},
		},
	},
	responses: {
		200: privateReadResponse(
			EventRecapShareResponseSchema,
			"Redacted external recap projection",
		),
		404: privateJsonError("Resource not found"),
		500: privateJsonError("Unexpected failure"),
	},
	"x-idempotency": "none",
});
const resolveRecapExternalShareLinkRoute = createRoute({
	method: "post",
	path: "/v1/recap-external-share-links/resolve",
	operationId: "eventRecapExternalShareLinksResolve",
	tags: ["events"],
	summary: "Resolve one reviewed exact-field external recap token",
	description:
		"Returns only the public recap title, event item titles and explicitly selected body or attachment-caption text fields while the exact link, recap, sources, author grants, manager grants and authority memberships remain current. Caption selection returns text only, never the image or attachment metadata. It never returns identities, membership, provenance, internal IDs, media or tokens. Every invalid state is the same concealed 404.",
	security: [],
	request: {
		body: {
			required: true,
			content: {
				"application/json": { schema: EventRecapShareResolveSchema },
			},
		},
	},
	responses: {
		200: privateReadResponse(
			EventRecapExternalShareResponseSchema,
			"Approved exact-field external recap projection",
		),
		404: privateJsonError("Resource not found"),
		500: privateJsonError("Unexpected failure"),
	},
	"x-idempotency": "none",
});
const getEventRoute = createRoute({
	method: "get",
	path: "/v1/event-roots/{rootEventId}/events/{eventId}",
	operationId: "eventsGet",
	tags: ["events"],
	summary: "Read one visible event",
	security: [{ userBearer: [] }],
	request: { params: eventParams },
	responses: {
		200: readResponse(EventResponseSchema, "Event"),
		401: errors[401],
		404: errors[404],
		500: errors[500],
	},
	"x-idempotency": "none",
});
const createEventRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/events",
	operationId: "eventChildrenCreate",
	tags: ["events"],
	summary: "Create a descendant event",
	security: [{ userBearer: [] }],
	request: {
		params: rootParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: EventFieldsSchema.extend({ parentEventId: EventIdSchema }),
				},
			},
		},
	},
	responses: {
		201: response(EventResponseSchema, "Event created", true),
		...errors,
	},
	"x-idempotency": "required",
});
const updateEventRoute = createRoute({
	method: "patch",
	path: "/v1/event-roots/{rootEventId}/events/{eventId}",
	operationId: "eventsUpdate",
	tags: ["events"],
	summary: "Update event editable state; root publish uses its command",
	security: [{ userBearer: [] }],
	request: {
		params: eventParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: { "application/json": { schema: EventPatchSchema } },
		},
	},
	responses: { 200: response(EventResponseSchema, "Event updated"), ...errors },
	"x-idempotency": "required",
});
const reparentRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/events/{eventId}/reparent",
	operationId: "eventsReparent",
	tags: ["events"],
	summary: "Move an event below another event in the same root",
	security: [{ userBearer: [] }],
	request: {
		params: eventParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							parentEventId: EventIdSchema,
							baseVersion: z.number().int().positive(),
						})
						.strict(),
				},
			},
		},
	},
	responses: { 200: response(EventResponseSchema, "Event moved"), ...errors },
	"x-idempotency": "required",
});
const eventReorderRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/events/{eventId}/children/reorder",
	operationId: "eventChildrenReorder",
	tags: ["events"],
	summary: "Replace one parent's authoritative child order",
	security: [{ userBearer: [] }],
	request: {
		params: eventParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							baseOrderVersion: z.number().int().positive(),
							orderedIds: z.array(EventIdSchema).max(500),
						})
						.strict(),
				},
			},
		},
	},
	responses: {
		200: response(EventListResponseSchema, "Children reordered"),
		...errors,
	},
	"x-idempotency": "required",
});
const archiveEventRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/events/{eventId}/archive",
	operationId: "eventsArchive",
	tags: ["events"],
	summary: "Archive an event without removing descendants",
	security: [{ userBearer: [] }],
	request: {
		params: eventParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({ baseVersion: z.number().int().positive() })
						.strict(),
				},
			},
		},
	},
	responses: {
		200: response(EventResponseSchema, "Event archived"),
		...errors,
	},
	"x-idempotency": "required",
});
const deleteEventRoute = createRoute({
	method: "delete",
	path: "/v1/event-roots/{rootEventId}/events/{eventId}",
	operationId: "eventsDelete",
	tags: ["events"],
	summary: "Tombstone an event or its full subtree",
	security: [{ userBearer: [] }],
	request: {
		params: eventParams,
		headers: IdempotencyHeadersSchema,
		query: z
			.object({
				baseVersion: z.coerce.number().int().positive(),
				subtree: z.enum(["true", "false"]).default("false"),
			})
			.strict(),
	},
	responses: {
		200: response(
			z.object({ deleted: z.literal(true) }).strict(),
			"Event tombstoned",
		),
		...errors,
	},
	"x-idempotency": "required",
});

const listMembershipsRoute = createRoute({
	method: "get",
	path: "/v1/event-roots/{rootEventId}/memberships",
	operationId: "eventMembershipsList",
	tags: ["memberships"],
	summary: "List memberships visible to the caller",
	security: [{ userBearer: [] }],
	request: { params: rootParams, query: PaginationQuerySchema },
	responses: {
		200: readResponse(MembershipPageResponseSchema, "Memberships"),
		400: errors[400],
		401: errors[401],
		404: errors[404],
		500: errors[500],
	},
	"x-idempotency": "none",
	"x-pagination": {
		strategy: "signed-keyset",
		defaultLimit: 50,
		maxLimit: 200,
		order: "userId ASC",
	},
});
const memberDirectorySourceRoute = createRoute({
	method: "get",
	path: "/v1/event-roots/{rootEventId}/member-directory-source",
	operationId: "eventMemberDirectorySourceGet",
	tags: ["memberships"],
	summary:
		"Return one authorized page of active member IDs for Gateway composition",
	security: [{ userBearer: [] }],
	request: { params: rootParams, query: PaginationQuerySchema },
	responses: {
		200: privateReadResponse(
			MemberDirectorySourceResponseSchema,
			"Authorized active member IDs",
		),
		400: errors[400],
		401: errors[401],
		404: errors[404],
		500: errors[500],
	},
	"x-gateway-compose-only": true,
	"x-idempotency": "none",
	"x-pagination": {
		strategy: "signed-keyset",
		defaultLimit: 50,
		maxLimit: 200,
		order: "userId ASC",
	},
});
const updateMembershipRoute = createRoute({
	method: "patch",
	path: "/v1/event-roots/{rootEventId}/memberships/{userId}",
	operationId: "eventMembershipsUpdate",
	tags: ["memberships"],
	summary: "Change a non-owner membership",
	security: [{ userBearer: [] }],
	request: {
		params: userParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							baseVersion: z.number().int().positive(),
							role: z.enum(["organizer", "participant", "viewer"]),
							status: z.enum(["active", "left", "removed"]),
							reason: z.string().max(500).nullable().default(null),
						})
						.strict(),
				},
			},
		},
	},
	responses: {
		200: response(MembershipResponseSchema, "Membership updated"),
		...errors,
	},
	"x-idempotency": "required",
});
const transferOwnerRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/ownership/transfer",
	operationId: "eventOwnershipTransfer",
	tags: ["memberships"],
	summary: "Transfer the single active owner role",
	security: [{ userBearer: [] }],
	request: {
		params: rootParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							userId: UserIdSchema,
							ownerBaseVersion: z.number().int().positive(),
							targetBaseVersion: z.number().int().positive(),
						})
						.strict(),
				},
			},
		},
	},
	responses: {
		200: response(MembershipsResponseSchema, "Ownership transferred"),
		...errors,
	},
	"x-idempotency": "required",
});

const listInvitationsRoute = createRoute({
	method: "get",
	path: "/v1/event-roots/{rootEventId}/invitations",
	operationId: "eventInvitationsList",
	tags: ["invitations"],
	summary: "List sanitized invitation administration state",
	security: [{ userBearer: [] }],
	request: { params: rootParams, query: PaginationQuerySchema },
	responses: {
		200: readResponse(
			InvitationAdminPageResponseSchema,
			"Sanitized invitation administration page",
		),
		400: errors[400],
		401: errors[401],
		404: errors[404],
		500: errors[500],
	},
	"x-idempotency": "none",
	"x-pagination": {
		strategy: "signed-keyset",
		defaultLimit: 50,
		maxLimit: 200,
		order: "id ASC",
		cursorBinding: ["principal", "rootEventId", "operation"],
	},
});
const createInvitationRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/invitations",
	operationId: "eventInvitationsCreate",
	tags: ["invitations"],
	summary:
		"Create a hashed invitation; the deterministic token is returned only here or on exact replay",
	security: [{ userBearer: [] }],
	request: {
		params: rootParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							id: InvitationIdSchema,
							role: z.enum(["organizer", "participant", "viewer"]),
							normalizedEmailHint: z
								.string()
								.trim()
								.email()
								.max(254)
								.transform((value) => value.toLowerCase())
								.nullable()
								.default(null),
							expiresAt: DateTimeSchema,
							maxUses: z.number().int().min(1).max(10_000),
						})
						.strict(),
				},
			},
		},
	},
	responses: {
		201: privateCreatedResponse(InvitationResponseSchema, "Invitation created"),
		...errors,
	},
	"x-idempotency": "required",
});
const previewInvitationRoute = createRoute({
	method: "post",
	path: "/v1/invitations/preview",
	operationId: "eventInvitationsPreview",
	tags: ["invitations"],
	summary: "Read safe invitation branding without authentication",
	security: [],
	request: {
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z.object({ token: z.string().min(20).max(200) }).strict(),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Safe invitation preview",
			headers: { "X-Request-ID": RequestIdHeader },
			content: {
				"application/json": {
					schema: z
						.object({
							rootEventId: EventIdSchema,
							title: z.string(),
							startsAt: DateTimeSchema.nullable(),
							endsAt: DateTimeSchema.nullable(),
							role: z.enum(["organizer", "participant", "viewer"]),
							emailBound: z.boolean(),
							usable: z.boolean(),
						})
						.strict(),
				},
			},
		},
		400: errors[400],
		404: errors[404],
		500: errors[500],
	},
	"x-idempotency": "none",
});
const redeemInvitationRoute = createRoute({
	method: "post",
	path: "/v1/invitations/redeem",
	operationId: "eventInvitationsRedeem",
	tags: ["invitations"],
	summary: "Redeem an invitation as the authenticated user",
	security: [{ userBearer: [] }],
	request: {
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z.object({ token: z.string().min(20).max(200) }).strict(),
				},
			},
		},
	},
	responses: {
		200: response(MembershipResponseSchema, "Invitation redeemed"),
		...errors,
	},
	"x-idempotency": "required",
});
const revokeInvitationRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/invitations/{invitationId}/revoke",
	operationId: "eventInvitationsRevoke",
	tags: ["invitations"],
	summary: "Revoke an invitation",
	security: [{ userBearer: [] }],
	request: {
		params: z
			.object({ rootEventId: EventIdSchema, invitationId: InvitationIdSchema })
			.strict(),
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({ baseVersion: z.number().int().positive() })
						.strict(),
				},
			},
		},
	},
	responses: {
		200: response(InvitationResponseSchema, "Invitation revoked"),
		...errors,
	},
	"x-idempotency": "required",
});

const createPlaceRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/places",
	operationId: "eventPlacesCreate",
	tags: ["places"],
	summary: "Create a root-scoped place",
	security: [{ userBearer: [] }],
	request: {
		params: rootParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: { "application/json": { schema: PlaceFieldsSchema } },
		},
	},
	responses: {
		201: response(PlaceResponseSchema, "Place created", true),
		...errors,
	},
	"x-idempotency": "required",
});
const listPlacesRoute = createRoute({
	method: "get",
	path: "/v1/event-roots/{rootEventId}/places",
	operationId: "eventPlacesList",
	tags: ["places"],
	summary: "List live root-scoped places",
	security: [{ userBearer: [] }],
	request: { params: rootParams, query: PaginationQuerySchema },
	responses: {
		200: readResponse(PlacesResponseSchema, "Places"),
		400: errors[400],
		401: errors[401],
		404: errors[404],
		500: errors[500],
	},
	"x-idempotency": "none",
	"x-pagination": {
		strategy: "signed-keyset",
		defaultLimit: 50,
		maxLimit: 200,
		order: "name ASC, id ASC",
	},
});
const updatePlaceRoute = createRoute({
	method: "patch",
	path: "/v1/event-roots/{rootEventId}/places/{placeId}",
	operationId: "eventPlacesUpdate",
	tags: ["places"],
	summary: "Update a place without rewriting existing itinerary snapshots",
	security: [{ userBearer: [] }],
	request: {
		params: placeParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							baseVersion: z.number().int().positive(),
							changes: PlaceChangesSchema,
						})
						.strict(),
				},
			},
		},
	},
	responses: { 200: response(PlaceResponseSchema, "Place updated"), ...errors },
	"x-idempotency": "required",
});
const replaceCapabilityRoute = createRoute({
	method: "put",
	path: "/v1/event-roots/{rootEventId}/events/{eventId}/capabilities/{capabilityType}",
	operationId: "eventCapabilitiesReplace",
	tags: ["capabilities"],
	summary: "Create, restore or atomically replace a typed capability",
	security: [{ userBearer: [] }],
	request: {
		params: capabilityParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							baseVersion: z.number().int().nonnegative(),
							capability: CapabilityInputSchema,
						})
						.strict(),
				},
			},
		},
	},
	responses: {
		200: response(CapabilityResponseSchema, "Capability replaced"),
		...errors,
	},
	"x-idempotency": "required",
});
const removeCapabilityRoute = createRoute({
	method: "delete",
	path: "/v1/event-roots/{rootEventId}/events/{eventId}/capabilities/{capabilityType}",
	operationId: "eventCapabilitiesRemove",
	tags: ["capabilities"],
	summary: "Tombstone a capability when no live itinerary depends on it",
	security: [{ userBearer: [] }],
	request: {
		params: capabilityParams,
		headers: IdempotencyHeadersSchema,
		query: z
			.object({ baseVersion: z.coerce.number().int().positive() })
			.strict(),
	},
	responses: {
		200: response(
			z.object({ deleted: z.literal(true) }).strict(),
			"Capability tombstoned",
		),
		...errors,
	},
	"x-idempotency": "required",
});
const createItineraryRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/itinerary",
	operationId: "eventItineraryItemsCreate",
	tags: ["itinerary"],
	summary: "Create an ordered itinerary item and immutable place snapshot",
	security: [{ userBearer: [] }],
	request: {
		params: rootParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: { "application/json": { schema: ItineraryFieldsSchema } },
		},
	},
	responses: {
		201: response(ItineraryResponseSchema, "Itinerary item created", true),
		...errors,
	},
	"x-idempotency": "required",
});
const listItineraryRoute = createRoute({
	method: "get",
	path: "/v1/event-roots/{rootEventId}/events/{eventId}/itinerary",
	operationId: "eventItineraryItemsList",
	tags: ["itinerary"],
	summary: "List one visible event's ordered itinerary",
	security: [{ userBearer: [] }],
	request: { params: eventParams, query: PaginationQuerySchema },
	responses: {
		200: readResponse(ItineraryItemsResponseSchema, "Itinerary items"),
		400: errors[400],
		401: errors[401],
		404: errors[404],
		500: errors[500],
	},
	"x-idempotency": "none",
	"x-pagination": {
		strategy: "signed-keyset",
		defaultLimit: 50,
		maxLimit: 200,
		order: "numeric sortKey ASC, id ASC",
	},
});
const updateItineraryRoute = createRoute({
	method: "patch",
	path: "/v1/event-roots/{rootEventId}/itinerary/{itemId}",
	operationId: "eventItineraryItemsUpdate",
	tags: ["itinerary"],
	summary: "Update an itinerary item using its observed version",
	security: [{ userBearer: [] }],
	request: {
		params: itemParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							baseVersion: z.number().int().positive(),
							changes: ItineraryChangesSchema,
						})
						.strict(),
				},
			},
		},
	},
	responses: {
		200: response(ItineraryResponseSchema, "Itinerary item updated"),
		...errors,
	},
	"x-idempotency": "required",
});
const reorderItineraryRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/events/{eventId}/itinerary/reorder",
	operationId: "eventItineraryItemsReorder",
	tags: ["itinerary"],
	summary: "Replace one event's authoritative itinerary order",
	security: [{ userBearer: [] }],
	request: {
		params: eventParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							baseOrderVersion: z.number().int().positive(),
							orderedIds: z.array(ItineraryIdSchema).max(500),
						})
						.strict(),
				},
			},
		},
	},
	responses: {
		200: response(ItineraryListResponseSchema, "Itinerary reordered"),
		...errors,
	},
	"x-idempotency": "required",
});

const listFeedRoute = createRoute({
	method: "get",
	path: "/v1/event-roots/{rootEventId}/feed",
	operationId: "eventFeedEntriesList",
	tags: ["feed"],
	summary: "List the root feed in descending creation-revision order",
	security: [{ userBearer: [] }],
	request: {
		params: rootParams,
		query: PaginationQuerySchema.extend({
			eventId: EventIdSchema.optional(),
			kind: z.enum(["message", "comment", "system"]).optional(),
		}).strict(),
	},
	responses: {
		200: readResponse(FeedListResponseSchema, "Feed page"),
		...errors,
	},
	"x-idempotency": "none",
	"x-pagination": {
		strategy: "signed-keyset",
		defaultLimit: 50,
		maxLimit: 200,
		order: "numeric createdRootRevision DESC, id DESC",
	},
});
const getFeedRoute = createRoute({
	method: "get",
	path: "/v1/event-roots/{rootEventId}/feed/{entryId}",
	operationId: "eventFeedEntriesGet",
	tags: ["feed"],
	security: [{ userBearer: [] }],
	request: { params: feedParams },
	responses: {
		200: readResponse(FeedEntryResponseSchema, "Feed entry"),
		...errors,
	},
	"x-idempotency": "none",
});
const createFeedRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/feed",
	operationId: "eventFeedEntriesCreate",
	tags: ["feed"],
	security: [{ userBearer: [] }],
	request: {
		params: rootParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							id: FeedIdSchema,
							eventId: EventIdSchema.nullable(),
							parentEntryId: FeedIdSchema.nullable(),
							kind: z.enum(["message", "comment"]),
							body: z.string().trim().min(1).max(10_000),
						})
						.strict(),
				},
			},
		},
	},
	responses: {
		201: response(FeedEntryResponseSchema, "Feed entry created", true),
		...errors,
	},
	"x-idempotency": "required",
});
const reviseFeedRoute = createRoute({
	method: "patch",
	path: "/v1/event-roots/{rootEventId}/feed/{entryId}",
	operationId: "eventFeedEntriesRevise",
	tags: ["feed"],
	security: [{ userBearer: [] }],
	request: {
		params: feedParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							baseVersion: z.number().int().positive(),
							body: z.string().trim().min(1).max(10_000),
						})
						.strict(),
				},
			},
		},
	},
	responses: {
		200: response(FeedEntryResponseSchema, "Feed entry revised"),
		...errors,
	},
	"x-idempotency": "required",
});
const removeFeedRoute = createRoute({
	method: "delete",
	path: "/v1/event-roots/{rootEventId}/feed/{entryId}",
	operationId: "eventFeedEntriesRemove",
	tags: ["feed"],
	security: [{ userBearer: [] }],
	request: {
		params: feedParams,
		headers: IdempotencyHeadersSchema,
		query: z
			.object({ baseVersion: z.coerce.number().int().positive() })
			.strict(),
	},
	responses: {
		200: response(FeedEntryResponseSchema, "Feed entry tombstoned"),
		...errors,
	},
	"x-idempotency": "required",
});
const setReactionRoute = createRoute({
	method: "put",
	path: "/v1/event-roots/{rootEventId}/feed/{entryId}/reaction",
	operationId: "eventFeedReactionsSet",
	tags: ["feed"],
	security: [{ userBearer: [] }],
	request: {
		params: feedParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({ reaction: z.enum(feedReactions), present: z.boolean() })
						.strict(),
				},
			},
		},
	},
	responses: {
		200: response(
			z.object({ reaction: FeedReactionSchema }).strict(),
			"Reaction fact stored",
		),
		...errors,
	},
	"x-idempotency": "required",
});
const listCommunityFeedbackRoute = createRoute({
	method: "get",
	path: "/v1/event-roots/{rootEventId}/feedback",
	operationId: "eventFeedbackList",
	tags: ["feedback"],
	summary: "List canonical public feedback for one active root member",
	security: [{ userBearer: [] }],
	request: { params: rootParams, query: CommunityFeedbackListQuerySchema },
	responses: {
		200: privateReadResponse(
			CommunityFeedbackListResponseSchema,
			"Canonical community feedback page",
		),
		...feedbackErrors,
	},
	"x-idempotency": "none",
	"x-pagination": {
		strategy: "signed-keyset",
		defaultLimit: 10,
		maxLimit: 10,
		order: "updatedAt DESC, id DESC",
		cursorBinding: ["principal", "rootEventId", "status", "followedOnly"],
	},
});
const listCommunityFeedbackDuplicateSuggestionsRoute = createRoute({
	method: "get",
	path: "/v1/event-roots/{rootEventId}/feedback/duplicate-suggestions",
	operationId: "eventFeedbackDuplicateSuggestionsList",
	tags: ["feedback"],
	summary: "Find likely canonical public feedback duplicates",
	description:
		"Uses a simple deterministic Unicode token match, not semantic similarity. Returns only minimal canonical suggestion fields for an active root member. The API Gateway applies its authenticated-principal rate limit.",
	security: [{ userBearer: [] }],
	request: {
		params: rootParams,
		query: CommunityFeedbackDuplicateSuggestionsQuerySchema,
	},
	responses: {
		200: privateReadResponse(
			CommunityFeedbackDuplicateSuggestionsResponseSchema,
			"Privacy-safe likely duplicate suggestions",
		),
		...feedbackErrors,
	},
	"x-idempotency": "none",
	"x-pagination": {
		strategy: "signed-keyset",
		defaultLimit: 5,
		maxLimit: 5,
		order: "rank ASC, updatedAt DESC, id DESC",
		cursorBinding: ["principal", "rootEventId", "q"],
	},
});
const listCommunityFeedbackUpdatesRoute = createRoute({
	method: "get",
	path: "/v1/event-roots/{rootEventId}/feedback/updates",
	operationId: "eventFeedbackUpdatesList",
	tags: ["feedback"],
	summary: "List canonical public feedback status updates",
	security: [{ userBearer: [] }],
	request: { params: rootParams, query: CommunityFeedbackUpdatesQuerySchema },
	responses: {
		200: privateReadResponse(
			CommunityFeedbackUpdatesResponseSchema,
			"Community feedback update page",
		),
		...feedbackErrors,
	},
	"x-idempotency": "none",
	"x-pagination": {
		strategy: "signed-keyset",
		defaultLimit: 50,
		maxLimit: 50,
		order: "changedAt DESC, feedbackId DESC, version DESC",
		cursorBinding: ["principal", "rootEventId", "followedOnly"],
	},
});
const getCommunityFeedbackRoute = createRoute({
	method: "get",
	path: "/v1/event-roots/{rootEventId}/feedback/{feedbackId}",
	operationId: "eventFeedbackGet",
	tags: ["feedback"],
	summary: "Read a sanitized canonical community feedback item",
	security: [{ userBearer: [] }],
	request: { params: communityFeedbackParams },
	responses: {
		200: privateReadResponse(
			CommunityFeedbackResolutionSchema,
			"Canonical community feedback",
		),
		...feedbackErrors,
	},
	"x-idempotency": "none",
});
const setCommunityFeedbackVoteRoute = createRoute({
	method: "put",
	path: "/v1/event-roots/{rootEventId}/feedback/{feedbackId}/vote",
	operationId: "eventFeedbackVotesSet",
	tags: ["feedback"],
	security: [{ userBearer: [] }],
	request: {
		params: communityFeedbackParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z.object({ present: z.boolean() }).strict(),
				},
			},
		},
	},
	responses: {
		200: privateResponse(
			CommunityFeedbackResolutionSchema,
			"Canonical community vote stored",
		),
		...feedbackErrors,
	},
	"x-idempotency": "required",
});
const createCommunityFeedbackCommentRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/feedback/{feedbackId}/comments",
	operationId: "eventFeedbackCommentsCreate",
	tags: ["feedback"],
	security: [{ userBearer: [] }],
	request: {
		params: communityFeedbackParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							id: FeedbackCommentIdSchema,
							body: z.string().trim().min(1).max(5_000),
						})
						.strict(),
				},
			},
		},
	},
	responses: {
		201: privateCreatedResponse(
			CommunityFeedbackResolutionSchema,
			"Canonical community comment created",
		),
		...feedbackErrors,
	},
	"x-idempotency": "required",
});
const setCommunityFeedbackFollowRoute = createRoute({
	method: "put",
	path: "/v1/event-roots/{rootEventId}/feedback/{feedbackId}/follow",
	operationId: "eventFeedbackFollowsSet",
	tags: ["feedback"],
	security: [{ userBearer: [] }],
	request: {
		params: communityFeedbackParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z.object({ followed: z.boolean() }).strict(),
				},
			},
		},
	},
	responses: {
		200: privateResponse(
			CommunityFeedbackFollowSchema,
			"Canonical community follow state stored",
		),
		...feedbackErrors,
	},
	"x-idempotency": "required",
});
const createFeedbackRoute = createRoute({
	method: "post",
	path: "/v1/feedback",
	operationId: "feedbackCreate",
	tags: ["feedback"],
	summary: "Create durable product or event feedback",
	description:
		"PostgreSQL is authoritative. Optional analytics delivery, including PostHog, must never create or mutate feedback state.",
	security: [{ userBearer: [] }],
	request: {
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: { "application/json": { schema: FeedbackCreateSchema } },
		},
	},
	responses: {
		201: privateCreatedResponse(FeedbackResponseSchema, "Feedback created"),
		...feedbackErrors,
	},
	"x-idempotency": "required",
	"x-source-of-truth": "event-service-postgresql",
});
const getFeedbackRoute = createRoute({
	method: "get",
	path: "/v1/feedback/{feedbackId}",
	operationId: "feedbackGet",
	tags: ["feedback"],
	summary: "Read feedback with votes, comments and status history",
	security: [{ userBearer: [] }],
	request: { params: feedbackParams },
	responses: {
		200: privateReadResponse(FeedbackResponseSchema, "Feedback"),
		...feedbackErrors,
	},
	"x-idempotency": "none",
});
const setFeedbackVoteRoute = createRoute({
	method: "put",
	path: "/v1/feedback/{feedbackId}/vote",
	operationId: "feedbackVotesSet",
	tags: ["feedback"],
	security: [{ userBearer: [] }],
	request: {
		params: feedbackParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z.object({ present: z.boolean() }).strict(),
				},
			},
		},
	},
	responses: {
		200: privateResponse(FeedbackResponseSchema, "Feedback vote stored"),
		...feedbackErrors,
	},
	"x-idempotency": "required",
});
const createFeedbackCommentRoute = createRoute({
	method: "post",
	path: "/v1/feedback/{feedbackId}/comments",
	operationId: "feedbackCommentsCreate",
	tags: ["feedback"],
	security: [{ userBearer: [] }],
	request: {
		params: feedbackParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							id: FeedbackCommentIdSchema,
							body: z.string().trim().min(1).max(5_000),
						})
						.strict(),
				},
			},
		},
	},
	responses: {
		201: privateCreatedResponse(
			FeedbackResponseSchema,
			"Feedback comment created",
		),
		...feedbackErrors,
	},
	"x-idempotency": "required",
});
const markFeedbackDuplicateRoute = createRoute({
	method: "post",
	path: "/v1/feedback/{feedbackId}/duplicate",
	operationId: "feedbackDuplicateMark",
	tags: ["feedback"],
	security: [{ userBearer: [] }],
	request: {
		params: feedbackParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							canonicalFeedbackId: FeedbackIdSchema,
							note: z
								.string()
								.trim()
								.min(1)
								.max(1_000)
								.nullable()
								.default(null),
						})
						.strict(),
				},
			},
		},
	},
	responses: {
		200: privateResponse(FeedbackResponseSchema, "Feedback marked duplicate"),
		...feedbackErrors,
	},
	"x-idempotency": "required",
});
const setFeedbackStatusRoute = createRoute({
	method: "put",
	path: "/v1/feedback/{feedbackId}/status",
	operationId: "feedbackStatusSet",
	tags: ["feedback"],
	security: [{ userBearer: [] }],
	request: {
		params: feedbackParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({
							status: z.enum([
								"open",
								"planned",
								"in_progress",
								"completed",
								"declined",
							]),
							note: z
								.string()
								.trim()
								.min(1)
								.max(1_000)
								.nullable()
								.default(null),
						})
						.strict(),
				},
			},
		},
	},
	responses: {
		200: privateResponse(FeedbackResponseSchema, "Feedback status stored"),
		...feedbackErrors,
	},
	"x-idempotency": "required",
});
const prepareUploadRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/attachments/uploads",
	operationId: "eventAttachmentUploadsPrepare",
	tags: ["attachments"],
	security: [{ userBearer: [] }],
	request: {
		params: rootParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: UploadPrepareSchema,
				},
			},
		},
	},
	responses: {
		201: privateCreatedResponse(
			UploadResponseSchema,
			"Private upload lease prepared",
		),
		...errors,
	},
	"x-idempotency": "required",
});
const finalizeUploadRoute = createRoute({
	method: "post",
	path: "/v1/event-roots/{rootEventId}/attachments/uploads/{uploadId}/finalize",
	operationId: "eventAttachmentUploadsFinalize",
	tags: ["attachments"],
	security: [{ userBearer: [] }],
	request: {
		params: uploadParams,
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": {
					schema: z
						.object({ caption: z.string().trim().min(1).max(1000).nullable() })
						.strict(),
				},
			},
		},
	},
	responses: {
		200: response(
			AttachmentResponseSchema,
			"Integrity-verified attachment committed",
		),
		202: retryResponse(
			AttachmentFinalizePendingSchema,
			"Attachment verification is durably queued or in progress",
		),
		...errors,
	},
	"x-idempotency": "required",
});
const downloadAttachmentRoute = createRoute({
	method: "get",
	path: "/v1/event-roots/{rootEventId}/attachments/{attachmentId}/download",
	operationId: "eventAttachmentsDownload",
	tags: ["attachments"],
	security: [{ userBearer: [] }],
	request: { params: attachmentParams },
	responses: {
		200: privateReadResponse(
			DownloadResponseSchema,
			"Short authorized private download",
		),
		...errors,
	},
	"x-idempotency": "none",
});

const importPlaceCandidatesRoute = createRoute({
	method: "post",
	path: "/internal/v1/place-candidates/import",
	operationId: "placeCandidatesImport",
	tags: ["place-candidates"],
	summary: "Atomically import a bounded source snapshot batch",
	security: [{ serviceBearer: [] }],
	request: {
		body: {
			required: true,
			content: {
				"application/json": { schema: PlaceCandidateImportRequestSchema },
			},
		},
	},
	responses: {
		200: response(
			PlaceCandidateImportResponseSchema,
			"Natural-idempotence outcomes for the complete batch",
		),
		400: errors[400],
		401: errors[401],
		409: errors[409],
		413: payloadTooLargeError,
		500: errors[500],
	},
	"x-idempotency": "natural",
	"x-max-decoded-body-bytes": MAX_PLACE_CANDIDATE_BODY_BYTES,
});
const placeCandidateIndexFeedRoute = createRoute({
	method: "get",
	path: "/internal/v1/place-candidates/index-feed",
	operationId: "placeCandidatesIndexFeed",
	tags: ["place-candidates"],
	summary: "Read active licensed candidate facts for a derived search index",
	security: [{ serviceBearer: [] }],
	request: {
		query: z
			.object({
				limit: z.coerce
					.number()
					.int()
					.min(1)
					.max(MAX_PLACE_CANDIDATE_PAGE_SIZE)
					.default(50),
				cursor: z.string().min(16).max(512).optional(),
			})
			.strict(),
	},
	responses: {
		200: readResponse(
			PlaceCandidateFeedResponseSchema,
			"Active non-expired and search-licensed candidate facts",
		),
		400: errors[400],
		401: errors[401],
		500: errors[500],
	},
	"x-idempotency": "none",
	"x-pagination": {
		strategy: "opaque-keyset",
		defaultLimit: 50,
		maxLimit: MAX_PLACE_CANDIDATE_PAGE_SIZE,
		order: "id ASC",
	},
});

const placeSearchRoute = createRoute({
	method: "get",
	path: "/v1/places/search",
	operationId: "placesSearch",
	tags: ["places"],
	summary: "Search pending and enriched first-party place records",
	security: [{ userBearer: [] }],
	request: {
		query: z
			.object({
				q: z.string().trim().min(1).max(120),
				kind: z.enum(["golf_course", "venue"]).optional(),
				countryCode: z
					.string()
					.regex(/^[A-Z]{2}$/)
					.optional(),
				status: z.enum(["pending", "enriched"]).optional(),
				limit: z.coerce
					.number()
					.int()
					.min(1)
					.max(MAX_PLACE_SEARCH_PAGE_SIZE)
					.default(20),
				cursor: z.string().min(16).max(4096).optional(),
			})
			.strict(),
	},
	responses: {
		200: readResponse(PlaceSearchResponseSchema, "Matching place records"),
		400: errors[400],
		401: errors[401],
		503: errors[503],
		500: errors[500],
	},
	"x-idempotency": "none",
	"x-pagination": {
		strategy: "signed-offset",
		defaultLimit: 20,
		maxLimit: MAX_PLACE_SEARCH_PAGE_SIZE,
		order: "_text_match DESC, confidence DESC, id ASC",
		cursorBinding: "principal, operation, filters, sort",
	},
});
const createPlaceEnrichmentRoute = createRoute({
	method: "post",
	path: "/v1/places/enrichment-jobs",
	operationId: "placeEnrichmentJobsCreate",
	tags: ["places"],
	summary: "Select a candidate or request bounded no-match enrichment",
	description:
		"Persists an idempotent background job and returns immediately without provider work in the request path. Returns 503 unless an operator has enabled the provider-backed worker.",
	security: [{ userBearer: [] }],
	request: {
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: {
				"application/json": { schema: PlaceEnrichmentRequestSchema },
			},
		},
	},
	responses: {
		202: enrichmentAcceptedResponse(
			PlaceEnrichmentResponseSchema,
			"Enrichment accepted; use the bounded polling hint",
		),
		400: errors[400],
		401: errors[401],
		404: errors[404],
		409: errors[409],
		503: errors[503],
		500: errors[500],
	},
	"x-idempotency": "required",
});
const getPlaceEnrichmentRoute = createRoute({
	method: "get",
	path: "/v1/places/enrichment-jobs/{jobId}",
	operationId: "placeEnrichmentJobsGet",
	tags: ["places"],
	summary: "Read safe place-enrichment progress and approved facts",
	security: [{ userBearer: [] }],
	request: {
		params: z.object({ jobId: PlaceEnrichmentJobIdSchema }).strict(),
	},
	responses: {
		200: readResponse(PlaceEnrichmentResponseSchema, "Enrichment status"),
		401: errors[401],
		404: errors[404],
		500: errors[500],
	},
	"x-idempotency": "none",
});
const retryPlaceEnrichmentRoute = createRoute({
	method: "post",
	path: "/v1/places/enrichment-jobs/{jobId}/retry",
	operationId: "placeEnrichmentJobsRetry",
	tags: ["places"],
	summary: "Advance an existing bounded automatic retry",
	description:
		"Never resets attempts or provider budgets; terminal failures require manual recovery.",
	security: [{ userBearer: [] }],
	request: {
		params: z.object({ jobId: PlaceEnrichmentJobIdSchema }).strict(),
		headers: IdempotencyHeadersSchema,
	},
	responses: {
		202: enrichmentAcceptedResponse(
			PlaceEnrichmentResponseSchema,
			"Existing bounded retry accepted",
		),
		401: errors[401],
		404: errors[404],
		409: errors[409],
		503: errors[503],
		500: errors[500],
	},
	"x-idempotency": "required",
});

const syncPushRoute = createRoute({
	method: "post",
	path: "/v1/sync/push",
	operationId: "syncMutationsApply",
	tags: ["sync"],
	summary: "Apply one bounded root mutation stream batch",
	security: [{ userBearer: [] }],
	request: {
		headers: IdempotencyHeadersSchema,
		body: {
			required: true,
			content: { "application/json": { schema: SyncPushRequestSchema } },
		},
	},
	responses: {
		200: response(SyncPushResponseSchema, "Per-mutation sync outcomes"),
		400: errors[400],
		401: errors[401],
		404: errors[404],
		409: errors[409],
		413: payloadTooLargeError,
		500: errors[500],
	},
	"x-idempotency": "required",
	"x-max-decoded-body-bytes": MAX_SYNC_BODY_BYTES,
});
const syncPullRoute = createRoute({
	method: "get",
	path: "/v1/sync/pull",
	operationId: "syncChangesList",
	tags: ["sync"],
	summary: "Read visible root changes after a signed checkpoint",
	security: [{ userBearer: [] }],
	request: {
		query: z
			.object({
				rootEventId: EventIdSchema,
				cursor: SyncCursorSchema,
				limit: z.coerce.number().int().min(1).max(200).default(50),
			})
			.strict(),
	},
	responses: {
		200: readResponse(SyncPullResponseSchema, "Visible ordered root changes"),
		400: errors[400],
		401: errors[401],
		404: errors[404],
		410: cursorExpiredError,
		500: errors[500],
	},
	"x-idempotency": "none",
	"x-pagination": {
		strategy: "signed-checkpoint",
		defaultLimit: 50,
		maxLimit: 200,
		order: "numeric rootRevision ASC, ordinal ASC",
	},
});
const syncBootstrapRoute = createRoute({
	method: "get",
	path: "/v1/sync/bootstrap",
	operationId: "syncBootstrapRead",
	tags: ["sync"],
	summary: "Read an immutable point-in-time root snapshot",
	security: [{ userBearer: [] }],
	request: {
		query: z
			.object({
				rootEventId: EventIdSchema,
				cursor: SyncCursorSchema.optional(),
				limit: z.coerce.number().int().min(1).max(200).default(50),
			})
			.strict(),
	},
	responses: {
		200: readResponse(
			SyncBootstrapResponseSchema,
			"Immutable root snapshot page",
		),
		400: errors[400],
		401: errors[401],
		404: errors[404],
		410: cursorExpiredError,
		500: errors[500],
	},
	"x-idempotency": "none",
	"x-pagination": {
		strategy: "signed-snapshot-offset",
		defaultLimit: 50,
		maxLimit: 200,
		order: "entityType ASC, entityId ASC",
	},
});

export function createApp(options: AppOptions = {}) {
	const app = new OpenAPIHono<EventEnv>({
		defaultHook(result, c) {
			if (result.success) return;
			if (isRecapShareResolvePath(c.req.path)) {
				c.header("Cache-Control", "private, no-store");
				return c.json(
					errorBody(
						c.get("requestId"),
						"NOT_FOUND",
						"Resource not found.",
						false,
					),
					404,
				);
			}
			const details = result.error.issues.map((issue) => ({
				code: issue.code.toUpperCase(),
				message: issue.message,
				...(issue.path.length ? { path: `/${issue.path.join("/")}` } : {}),
			}));
			return c.json(
				errorBody(
					c.get("requestId"),
					"VALIDATION_FAILED",
					"The request is invalid.",
					false,
					details,
				),
				400,
			);
		},
	});
	app.use("*", requestIdMiddleware);
	app.use(
		"*",
		createMiddleware<EventEnv>(async (c, next) => {
			if (options.service) c.set("service", options.service);
			await next();
		}),
	);
	const authenticate = createMiddleware<EventEnv>(async (c, next) => {
		if (
			c.req.path === "/v1/invitations/preview" ||
			isRecapShareResolvePath(c.req.path)
		)
			return next();
		const token = /^Bearer ([^\s]+)$/i.exec(
			c.req.header("authorization") ?? "",
		)?.[1];
		if (!token || !options.verifyUserToken)
			throw new DomainError(
				401,
				"UNAUTHENTICATED",
				"Authentication is required.",
			);
		try {
			c.set("actor", await options.verifyUserToken(token));
		} catch {
			throw new DomainError(
				401,
				"UNAUTHENTICATED",
				"Authentication is required.",
			);
		}
		await next();
	});
	const authenticatePlaceCandidateService = (
		requiredScope: PlaceCandidateServiceScope,
	) =>
		createMiddleware<EventEnv>(async (c, next) => {
			const token = /^Bearer ([^\s]+)$/i.exec(
				c.req.header("authorization") ?? "",
			)?.[1];
			if (
				!token ||
				!options.verifyPlaceCandidateServiceToken ||
				!(await options.verifyPlaceCandidateServiceToken(token, requiredScope))
			) {
				throw new DomainError(
					401,
					"UNAUTHENTICATED",
					"Authentication is required.",
				);
			}
			await next();
		});

	app.get("/internal/live", (c) => c.json({ service: SERVICE, status: "ok" }));
	app.get("/internal/ready", async (c) => {
		const ready = options.readiness
			? await options.readiness()
			: options.service
				? await options.service.ready()
				: true;
		return ready
			? c.json({ service: SERVICE, status: "ready" }, 200)
			: c.json(
					errorBody(
						c.get("requestId"),
						"SERVICE_UNAVAILABLE",
						"Service is not ready.",
						true,
					),
					503,
				);
	});
	app.use(
		"/internal/v1/place-candidates/import",
		authenticatePlaceCandidateService(PLACE_CANDIDATE_WRITE_SCOPE),
	);
	app.use(
		"/internal/v1/place-candidates/import",
		boundedBody(MAX_PLACE_CANDIDATE_BODY_BYTES),
	);
	app.use(
		"/internal/v1/place-candidates/index-feed",
		authenticatePlaceCandidateService(PLACE_CANDIDATE_READ_SCOPE),
	);
	app.openapi(importPlaceCandidatesRoute, async (c) => {
		const body = c.req.valid("json");
		const results = await requiredPlaceCandidates(options).importBatch(
			body.candidates.map((candidate) => ({
				...candidate,
				retrievedAt: new Date(candidate.retrievedAt),
				expiresAt:
					candidate.expiresAt === null ? null : new Date(candidate.expiresAt),
				retirement:
					candidate.retirement === null
						? null
						: {
								...candidate.retirement,
								retiredAt: new Date(candidate.retirement.retiredAt),
							},
			})),
		);
		return c.json(
			{
				results: results.map((result) => ({
					outcome: result.outcome,
					candidate: placeCandidateResponse(result.candidate),
				})),
			},
			200,
		);
	});
	app.openapi(placeCandidateIndexFeedRoute, async (c) => {
		const query = c.req.valid("query");
		const page = await requiredPlaceCandidates(options).indexFeed({
			limit: query.limit,
			...(query.cursor ? { cursor: query.cursor } : {}),
		});
		return c.json(
			{
				items: page.items.map(placeCandidateResponse),
				pageInfo: page.pageInfo,
			},
			200,
		);
	});
	app.use("/v1/*", authenticate);
	const privateFeedbackResponse = createMiddleware<EventEnv>(
		async (c, next) => {
			c.header("Cache-Control", "private, no-store");
			await next();
		},
	);
	app.use("/v1/feedback", privateFeedbackResponse);
	app.use("/v1/feedback/*", privateFeedbackResponse);
	app.use("/v1/event-roots/:rootEventId/feedback", privateFeedbackResponse);
	app.use("/v1/event-roots/:rootEventId/feedback/*", privateFeedbackResponse);
	for (const path of RECAP_SHARE_RESOLVE_PATHS)
		app.use(
			path,
			createMiddleware<EventEnv>(async (c, next) => {
				c.header("Cache-Control", "private, no-store");
				await next();
			}),
		);
	app.use("/v1/sync/push", syncPushBodyLimit);
	app.openapi(placeSearchRoute, async (c) => {
		const actor = requiredActor(c);
		const query = c.req.valid("query");
		return c.json(
			await requiredPlaceSearch(options).search({
				actorId: actor.id,
				query: query.q,
				...(query.kind ? { kind: query.kind } : {}),
				...(query.countryCode ? { countryCode: query.countryCode } : {}),
				...(query.status ? { status: query.status } : {}),
				limit: query.limit,
				...(query.cursor ? { cursor: query.cursor } : {}),
			}),
			200,
		);
	});
	app.openapi(createPlaceEnrichmentRoute, async (c) => {
		const actor = requiredActor(c);
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"placeEnrichmentJobsCreate",
			{ body },
			async (service) => {
				const job =
					body.target === "candidate"
						? await service.requestPlaceEnrichmentCandidate(body.candidateId)
						: await service.requestPlaceEnrichmentSearchMiss({
								query: body.query,
								kind: body.kind,
								countryCode: body.countryCode,
							});
				const response = placeEnrichmentResponse(
					await service.getPlaceEnrichment(job.id),
				);
				return enrichmentCommand(response);
			},
			placeEnrichmentReplayGuard(),
			(service) => service.assertPlaceEnrichmentAvailable(),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 202);
	});
	app.openapi(getPlaceEnrichmentRoute, async (c) => {
		const response = placeEnrichmentResponse(
			await requiredService(options).getPlaceEnrichment(
				c.req.valid("param").jobId,
			),
		);
		if (response.enrichment.pollAfterSeconds !== null) {
			c.header("Retry-After", String(response.enrichment.pollAfterSeconds));
		}
		return c.json(response, 200);
	});
	app.openapi(retryPlaceEnrichmentRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const result = await command(
			c,
			actor,
			"placeEnrichmentJobsRetry",
			{ params },
			async (service) =>
				enrichmentCommand(
					placeEnrichmentResponse(
						await service.requestPlaceEnrichmentRetry(params.jobId),
					),
				),
			placeEnrichmentReplayGuard(),
			(service) => service.assertPlaceEnrichmentAvailable(),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 202);
	});

	app.openapi(syncPushRoute, async (c) => {
		const result = await requiredService(options).syncPush(
			requiredActor(c),
			c.req.valid("header")["idempotency-key"],
			c.req.valid("json"),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(syncPullRoute, async (c) => {
		const query = c.req.valid("query");
		return c.json(
			await requiredService(options).syncPull(
				requiredActor(c),
				query.rootEventId,
				query.cursor,
				query.limit,
			),
			200,
		);
	});
	app.openapi(syncBootstrapRoute, async (c) => {
		const query = c.req.valid("query");
		return c.json(
			await requiredService(options).syncBootstrap(
				requiredActor(c),
				query.rootEventId,
				query.cursor,
				query.limit,
			),
			200,
		);
	});

	app.openapi(listEventTemplatesRoute, (c) => {
		requiredActor(c);
		return c.json(
			{ templates: [...requiredService(options).listEventTemplates()] },
			200,
		);
	});
	app.openapi(listRootsRoute, async (c) => {
		const query = c.req.valid("query");
		const page = await requiredService(options).listRoots(requiredActor(c), {
			limit: query.limit,
			includeArchived: query.includeArchived === "true",
			...(query.cursor ? { cursor: query.cursor } : {}),
		});
		return c.json(
			{
				items: page.items.map(eventRootSummaryResponse),
				pageInfo: page.pageInfo,
			},
			200,
		);
	});
	app.openapi(createRootRoute, async (c) => {
		const actor = requiredActor(c);
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventsCreate",
			body,
			async (service) => {
				const event = await service.createRoot(
					actor,
					eventInput(body),
					body.template,
				);
				return {
					status: 201,
					body: { event: eventResponse(event) },
					headers: { Location: `/v1/event-roots/${event.id}` },
				};
			},
			rootReplayGuard(actor, body.id, "manager", false),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 201);
	});
	app.openapi(adoptRootTemplateRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventTemplateAdopt",
			{ params, body },
			async (service) => {
				const adopted = await service.adoptRootTemplate(
					actor,
					params.rootEventId,
					body.baseVersion,
					body.baseRevision,
					body.template,
				);
				return {
					status: 200,
					body: {
						event: eventResponse(adopted.event),
						rootRevision: adopted.rootRevision,
						template: adopted.template,
					},
					headers: {},
				};
			},
			async (service, replay) =>
				service.assertRootReplaySafe(
					actor,
					params.rootEventId,
					replay.status < 400 ? "manager" : "member",
				),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(getRootRoute, async (c) => {
		const view = await requiredService(options).getRoot(
			requiredActor(c),
			c.req.valid("param").rootEventId,
		);
		return c.json(
			{
				...view,
				events: view.events.map(eventResponse),
				capabilities: view.capabilities.map(capabilityResponse),
			},
			200,
		);
	});
	app.openapi(getPublishReadinessRoute, async (c) => {
		const readiness = await requiredService(options).getPublishReadiness(
			requiredActor(c),
			c.req.valid("param").rootEventId,
		);
		return c.json(readiness, 200);
	});
	app.openapi(publishRootRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventsPublish",
			{ params, body },
			async (service) => ({
				status: 200,
				body: {
					event: eventResponse(
						await service.publishRoot(
							actor,
							params.rootEventId,
							body.baseVersion,
							body.baseRevision,
						),
					),
				},
				headers: {},
			}),
			rootReplayGuard(actor, params.rootEventId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(getRecapRoute, async (c) => {
		const params = c.req.valid("param");
		const query = c.req.valid("query");
		const read = await requiredService(options).getRecap(
			requiredActor(c),
			params.rootEventId,
			query.version,
		);
		c.header("Cache-Control", "private, no-store");
		return c.json(
			{
				recap: recapResponse(read.recap),
				externalConsent: read.externalConsent,
			},
			200,
		);
	});
	app.openapi(generateRecapRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventRecapsGenerate",
			{ params, body },
			async (service) => {
				const recap = await service.generateRecap(
					actor,
					params.rootEventId,
					body.baseRevision,
					body.sources as RecapSourceInput[],
				);
				return {
					status: 201,
					body: { recap: recapResponse(recap) },
					headers: {
						Location: `/v1/event-roots/${params.rootEventId}/recap?version=${recap.version}`,
						"Cache-Control": "private, no-store",
					},
				};
			},
			recapReplayGuard(actor, params.rootEventId, true),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 201);
	});
	app.openapi(publishRecapRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventRecapsPublish",
			{ params, body },
			async (service) => ({
				status: 200,
				body: {
					recap: recapResponse(
						await service.publishRecap(
							actor,
							params.rootEventId,
							body.recapVersion,
							body.baseLifecycleVersion,
						),
					),
				},
				headers: { "Cache-Control": "private, no-store" },
			}),
			recapReplayGuard(actor, params.rootEventId, true),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(removeRecapRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventRecapsRemove",
			{ params, body },
			async (service) => ({
				status: 200,
				body: await service.removeRecap(
					actor,
					params.rootEventId,
					body.baseLifecycleVersion,
				),
				headers: { "Cache-Control": "private, no-store" },
			}),
			recapReplayGuard(actor, params.rootEventId, false),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(createRecapShareLinkRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const eventService = requiredService(options);
		const result = await command(
			c,
			actor,
			"eventRecapShareLinksCreate",
			{ params, body },
			async (service) => {
				const { shareLink } = await service.createRecapShareLink(
					actor,
					params.rootEventId,
					body.recapVersion,
					body.projectionConsent,
				);
				return {
					status: 201,
					body: { shareLink: recapShareLinkResponse(shareLink) },
					headers: {
						Location: `/v1/event-roots/${params.rootEventId}/recap/share-links/${shareLink.id}`,
						"Cache-Control": "private, no-store",
					},
				};
			},
			recapShareLinkReplayGuard(actor, params.rootEventId),
		);
		const token = await eventService.tokenForRecapShareLink(
			actor,
			params.rootEventId,
			result.body.shareLink.id,
		);
		applyCommandHeaders(c, result);
		return c.json(
			{
				...result.body,
				token,
			},
			201,
		);
	});
	app.openapi(decideRecapExternalGrantRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const { recapVersion, ...decision } = body;
		const input = decision as RecapExternalGrantDecisionInput;
		const result = await command(
			c,
			actor,
			"eventRecapExternalGrantsDecide",
			{ params, body },
			async (service) => ({
				status: 200,
				body: await service.decideRecapExternalGrant(
					actor,
					params.rootEventId,
					recapVersion,
					input,
				),
				headers: { "Cache-Control": "private, no-store" },
			}),
			recapExternalGrantReplayGuard(
				actor,
				params.rootEventId,
				recapVersion,
				input,
			),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(createRecapExternalShareLinkRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const eventService = requiredService(options);
		const result = await command(
			c,
			actor,
			"eventRecapExternalShareLinksCreate",
			{ params, body },
			async (service) => {
				const { shareLink } = await service.createRecapExternalShareLink(
					actor,
					params.rootEventId,
					body.recapVersion,
					body.projectionConsent,
					body.fields as RecapExternalField[],
				);
				return {
					status: 201,
					body: { shareLink: recapShareLinkResponse(shareLink) },
					headers: {
						Location: `/v1/event-roots/${params.rootEventId}/recap/share-links/${shareLink.id}`,
						"Cache-Control": "private, no-store",
					},
				};
			},
			recapShareLinkReplayGuard(actor, params.rootEventId),
		);
		const token = await eventService.tokenForRecapShareLink(
			actor,
			params.rootEventId,
			result.body.shareLink.id,
		);
		applyCommandHeaders(c, result);
		return c.json({ ...result.body, token }, 201);
	});
	app.openapi(revokeRecapShareLinkRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const result = await command(
			c,
			actor,
			"eventRecapShareLinksRevoke",
			{ params },
			async (service) => ({
				status: 200,
				body: await service.revokeRecapShareLink(
					actor,
					params.rootEventId,
					params.shareLinkId,
				),
				headers: { "Cache-Control": "private, no-store" },
			}),
			rootReplayGuard(actor, params.rootEventId, "manager"),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(resolveRecapShareLinkRoute, async (c) => {
		const recap = await requiredService(options).resolveRecapShareLink(
			c.req.valid("json").token,
		);
		return c.json({ recap }, 200);
	});
	app.openapi(resolveRecapExternalShareLinkRoute, async (c) => {
		const recap = await requiredService(options).resolveRecapExternalShareLink(
			c.req.valid("json").token,
		);
		return c.json({ recap }, 200);
	});
	app.openapi(getEventRoute, async (c) => {
		const params = c.req.valid("param");
		const event = await requiredService(options).getEvent(
			requiredActor(c),
			params.rootEventId,
			params.eventId,
		);
		return c.json({ event: eventResponse(event) }, 200);
	});
	app.openapi(createEventRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventChildrenCreate",
			{ params, body },
			async (service) => {
				const event = await service.createEvent(
					actor,
					params.rootEventId,
					body.parentEventId,
					eventInput(body),
				);
				return {
					status: 201,
					body: { event: eventResponse(event) },
					headers: {
						Location: `/v1/event-roots/${params.rootEventId}/events/${event.id}`,
					},
				};
			},
			rootReplayGuard(actor, params.rootEventId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 201);
	});
	app.openapi(updateEventRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventsUpdate",
			{ params, body },
			async (service) => ({
				status: 200,
				body: {
					event: eventResponse(
						await service.updateEvent(
							actor,
							params.rootEventId,
							params.eventId,
							body.baseVersion,
							parseEventPatch(body.changes),
						),
					),
				},
				headers: {},
			}),
			rootReplayGuard(actor, params.rootEventId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(reparentRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventsReparent",
			{ params, body },
			async (service) => ({
				status: 200,
				body: {
					event: eventResponse(
						await service.reparentEvent(
							actor,
							params.rootEventId,
							params.eventId,
							body.parentEventId,
							body.baseVersion,
						),
					),
				},
				headers: {},
			}),
			rootReplayGuard(actor, params.rootEventId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(eventReorderRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventChildrenReorder",
			{ params, body },
			async (service) => {
				const value = await service.reorderEvents(
					actor,
					params.rootEventId,
					params.eventId,
					body.baseOrderVersion,
					body.orderedIds,
				);
				return {
					status: 200,
					body: {
						parent: eventResponse(value.parent),
						events: value.events.map(eventResponse),
					},
					headers: {},
				};
			},
			rootReplayGuard(actor, params.rootEventId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(archiveEventRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventsArchive",
			{ params, body },
			async (service) => ({
				status: 200,
				body: {
					event: eventResponse(
						await service.archiveEvent(
							actor,
							params.rootEventId,
							params.eventId,
							body.baseVersion,
						),
					),
				},
				headers: {},
			}),
			rootReplayGuard(actor, params.rootEventId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(deleteEventRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const query = c.req.valid("query");
		const result = await command(
			c,
			actor,
			"eventsDelete",
			{ params, query },
			async (service) => {
				await service.tombstoneEvent(
					actor,
					params.rootEventId,
					params.eventId,
					query.baseVersion,
					query.subtree === "true",
				);
				return { status: 200, body: { deleted: true as const }, headers: {} };
			},
			rootReplayGuard(actor, params.rootEventId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});

	app.openapi(listMembershipsRoute, async (c) => {
		const page = await requiredService(options).listMemberships(
			requiredActor(c),
			c.req.valid("param").rootEventId,
			c.req.valid("query"),
		);
		return c.json(
			{
				items: page.items.map(membershipResponse),
				pageInfo: page.pageInfo,
			},
			200,
		);
	});
	app.openapi(memberDirectorySourceRoute, async (c) => {
		const rootEventId = c.req.valid("param").rootEventId;
		const page = await requiredService(options).listMemberDirectorySource(
			requiredActor(c),
			rootEventId,
			c.req.valid("query"),
		);
		c.header("Cache-Control", "private, no-store");
		return c.json(
			{
				schemaVersion: 1 as const,
				rootEventId,
				userIds: page.items.map(({ userId }) => userId),
				pageInfo: page.pageInfo,
			},
			200,
		);
	});
	app.openapi(updateMembershipRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventMembershipsUpdate",
			{ params, body },
			async (service) => ({
				status: 200,
				body: {
					membership: membershipResponse(
						await service.updateMembership(
							actor,
							params.rootEventId,
							params.userId,
							body.baseVersion,
							body.role,
							body.status,
							body.reason,
						),
					),
				},
				headers: {},
			}),
			rootReplayGuard(actor, params.rootEventId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(transferOwnerRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventOwnershipTransfer",
			{ params, body },
			async (service) => ({
				status: 200,
				body: {
					memberships: (
						await service.transferOwnership(
							actor,
							params.rootEventId,
							body.userId,
							body.ownerBaseVersion,
							body.targetBaseVersion,
						)
					).map(membershipResponse),
				},
				headers: {},
			}),
			rootReplayGuard(actor, params.rootEventId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});

	app.openapi(listInvitationsRoute, async (c) => {
		const params = c.req.valid("param");
		const page = await requiredService(options).listInvitations(
			requiredActor(c),
			params.rootEventId,
			c.req.valid("query"),
		);
		return c.json(
			{
				items: page.items.map(invitationAdminSummaryResponse),
				pageInfo: page.pageInfo,
			},
			200,
		);
	});
	app.openapi(createInvitationRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const eventService = requiredService(options);
		const result = await command(
			c,
			actor,
			"eventInvitationsCreate",
			{ params, body },
			async (service) => {
				const value = await service.createInvitation(
					actor,
					params.rootEventId,
					{ ...body, expiresAt: new Date(body.expiresAt) },
				);
				return {
					status: 201,
					body: {
						invitation: invitationResponse(value.invitation),
					},
					headers: {
						Location: `/v1/event-roots/${params.rootEventId}/invitations/${value.invitation.id}`,
						"Cache-Control": "private, no-store",
					},
				};
			},
			rootReplayGuard(actor, params.rootEventId),
		);
		applyCommandHeaders(c, result);
		return c.json(
			{
				...result.body,
				token: await eventService.tokenForInvitation(
					actor,
					params.rootEventId,
					body.id,
				),
			},
			201,
		);
	});
	app.openapi(previewInvitationRoute, async (c) => {
		const preview = await requiredService(options).previewInvitation(
			c.req.valid("json").token,
			new Date(),
		);
		if (!preview)
			throw new DomainError(
				404,
				"INVITATION_INVALID",
				"The invitation is invalid or unavailable.",
			);
		return c.json(
			{
				...preview,
				startsAt: preview.startsAt?.toISOString() ?? null,
				endsAt: preview.endsAt?.toISOString() ?? null,
			},
			200,
		);
	});
	app.openapi(redeemInvitationRoute, async (c) => {
		const actor = requiredActor(c);
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventInvitationsRedeem",
			body,
			async (service) => ({
				status: 200,
				body: {
					membership: membershipResponse(
						await service.redeemInvitation(actor, body.token, new Date()),
					),
				},
				headers: {},
			}),
			invitationRedemptionReplayGuard(actor),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(revokeInvitationRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventInvitationsRevoke",
			{ params, body },
			async (service) => ({
				status: 200,
				body: {
					invitation: invitationResponse(
						await service.revokeInvitation(
							actor,
							params.rootEventId,
							params.invitationId,
							body.baseVersion,
						),
					),
				},
				headers: {},
			}),
			rootReplayGuard(actor, params.rootEventId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});

	app.openapi(createPlaceRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventPlacesCreate",
			{ params, body },
			async (service) => {
				const place = await service.createPlace(
					actor,
					params.rootEventId,
					body,
				);
				return {
					status: 201,
					body: { place: placeResponse(place) },
					headers: {
						Location: `/v1/event-roots/${params.rootEventId}/places/${place.id}`,
					},
				};
			},
			rootReplayGuard(actor, params.rootEventId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 201);
	});
	app.openapi(listPlacesRoute, async (c) => {
		const page = await requiredService(options).listPlaces(
			requiredActor(c),
			c.req.valid("param").rootEventId,
			c.req.valid("query"),
		);
		return c.json(
			{ items: page.items.map(placeResponse), pageInfo: page.pageInfo },
			200,
		);
	});
	app.openapi(updatePlaceRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventPlacesUpdate",
			{ params, body },
			async (service) => ({
				status: 200,
				body: {
					place: placeResponse(
						await service.updatePlace(
							actor,
							params.rootEventId,
							params.placeId,
							body.baseVersion,
							parsePlacePatch(body.changes),
						),
					),
				},
				headers: {},
			}),
			rootReplayGuard(actor, params.rootEventId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(replaceCapabilityRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventCapabilitiesReplace",
			{ params, body },
			async (service) => {
				if (params.capabilityType !== body.capability.type)
					throw new DomainError(
						400,
						"CAPABILITY_TYPE_MISMATCH",
						"The path and capability body types must match.",
					);
				return {
					status: 200,
					body: {
						capability: capabilityResponse(
							await service.replaceCapability(
								actor,
								params.rootEventId,
								params.eventId,
								body.baseVersion,
								body.capability,
							),
						),
					},
					headers: {},
				};
			},
			rootReplayGuard(actor, params.rootEventId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(removeCapabilityRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const query = c.req.valid("query");
		const result = await command(
			c,
			actor,
			"eventCapabilitiesRemove",
			{ params, query },
			async (service) => {
				await service.removeCapability(
					actor,
					params.rootEventId,
					params.eventId,
					params.capabilityType,
					query.baseVersion,
				);
				return { status: 200, body: { deleted: true as const }, headers: {} };
			},
			rootReplayGuard(actor, params.rootEventId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(createItineraryRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventItineraryItemsCreate",
			{ params, body },
			async (service) => {
				const item = await service.createItineraryItem(
					actor,
					params.rootEventId,
					itineraryInput(body),
				);
				return {
					status: 201,
					body: { item: itineraryResponse(item) },
					headers: {
						Location: `/v1/event-roots/${params.rootEventId}/itinerary/${item.id}`,
					},
				};
			},
			rootReplayGuard(actor, params.rootEventId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 201);
	});
	app.openapi(listItineraryRoute, async (c) => {
		const params = c.req.valid("param");
		const page = await requiredService(options).listItinerary(
			requiredActor(c),
			params.rootEventId,
			params.eventId,
			c.req.valid("query"),
		);
		return c.json(
			{ items: page.items.map(itineraryResponse), pageInfo: page.pageInfo },
			200,
		);
	});
	app.openapi(updateItineraryRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventItineraryItemsUpdate",
			{ params, body },
			async (service) => ({
				status: 200,
				body: {
					item: itineraryResponse(
						await service.updateItineraryItem(
							actor,
							params.rootEventId,
							params.itemId,
							body.baseVersion,
							parseItineraryPatch(body.changes),
						),
					),
				},
				headers: {},
			}),
			rootReplayGuard(actor, params.rootEventId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(reorderItineraryRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventItineraryItemsReorder",
			{ params, body },
			async (service) => {
				const value = await service.reorderItinerary(
					actor,
					params.rootEventId,
					params.eventId,
					body.baseOrderVersion,
					body.orderedIds,
				);
				return {
					status: 200,
					body: {
						event: eventResponse(value.event),
						items: value.items.map(itineraryResponse),
					},
					headers: {},
				};
			},
			rootReplayGuard(actor, params.rootEventId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});

	app.openapi(listFeedRoute, async (c) => {
		const params = c.req.valid("param");
		const page = await requiredService(options).listFeedEntries(
			requiredActor(c),
			params.rootEventId,
			c.req.valid("query"),
		);
		return c.json(
			{ items: page.items.map(feedEntryResponse), pageInfo: page.pageInfo },
			200,
		);
	});
	app.openapi(getFeedRoute, async (c) => {
		const params = c.req.valid("param");
		const entry = await requiredService(options).getFeedEntry(
			requiredActor(c),
			params.rootEventId,
			params.entryId,
		);
		return c.json({ entry: feedEntryResponse(entry) }, 200);
	});
	app.openapi(createFeedRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventFeedEntriesCreate",
			{ params, body },
			async (service) => {
				const entry = await service.createFeedEntry(
					actor,
					params.rootEventId,
					body,
					c.get("requestId"),
				);
				return {
					status: 201,
					body: { entry: feedEntryResponse(entry) },
					headers: {
						Location: `/v1/event-roots/${params.rootEventId}/feed/${entry.id}`,
					},
				};
			},
			feedEntryReplayGuard(actor, params.rootEventId, body.id),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 201);
	});
	app.openapi(reviseFeedRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventFeedEntriesRevise",
			{ params, body },
			async (service) => ({
				status: 200,
				body: {
					entry: feedEntryResponse(
						await service.reviseFeedEntry(
							actor,
							params.rootEventId,
							params.entryId,
							body.baseVersion,
							body.body,
						),
					),
				},
				headers: {},
			}),
			feedEntryReplayGuard(actor, params.rootEventId, params.entryId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(removeFeedRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const query = c.req.valid("query");
		const result = await command(
			c,
			actor,
			"eventFeedEntriesRemove",
			{ params, query },
			async (service) => ({
				status: 200,
				body: {
					entry: feedEntryResponse(
						await service.removeFeedEntry(
							actor,
							params.rootEventId,
							params.entryId,
							query.baseVersion,
						),
					),
				},
				headers: {},
			}),
			feedEntryReplayGuard(actor, params.rootEventId, params.entryId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(setReactionRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventFeedReactionsSet",
			{ params, body },
			async (service) => ({
				status: 200,
				body: {
					reaction: feedReactionResponse(
						await service.setFeedReaction(
							actor,
							params.rootEventId,
							params.entryId,
							body.reaction,
							body.present,
						),
					),
				},
				headers: {},
			}),
			feedEntryReplayGuard(actor, params.rootEventId, params.entryId, true),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(listCommunityFeedbackRoute, async (c) => {
		const params = c.req.valid("param");
		const query = c.req.valid("query");
		const page = await requiredService(options).listCommunityFeedback(
			requiredActor(c),
			params.rootEventId,
			{
				limit: query.limit,
				...(query.cursor ? { cursor: query.cursor } : {}),
				...(query.status ? { status: query.status } : {}),
				followedOnly: query.followedOnly === "true",
			},
		);
		return c.json(
			{
				items: page.items.map(communityFeedbackSummaryResponse),
				pageInfo: page.pageInfo,
			},
			200,
		);
	});
	app.openapi(listCommunityFeedbackDuplicateSuggestionsRoute, async (c) => {
		const params = c.req.valid("param");
		const query = c.req.valid("query");
		const page = await requiredService(
			options,
		).listCommunityFeedbackDuplicateSuggestions(
			requiredActor(c),
			params.rootEventId,
			{
				q: query.q,
				limit: query.limit,
				...(query.cursor ? { cursor: query.cursor } : {}),
			},
		);
		return c.json(
			{
				items: page.items.map(communityFeedbackDuplicateSuggestionResponse),
				pageInfo: page.pageInfo,
			},
			200,
		);
	});
	app.openapi(listCommunityFeedbackUpdatesRoute, async (c) => {
		const params = c.req.valid("param");
		const query = c.req.valid("query");
		const page = await requiredService(options).listCommunityFeedbackUpdates(
			requiredActor(c),
			params.rootEventId,
			{
				limit: query.limit,
				...(query.cursor ? { cursor: query.cursor } : {}),
				followedOnly: query.followedOnly === "true",
			},
		);
		return c.json(
			{
				items: page.items.map(communityFeedbackUpdateResponse),
				pageInfo: page.pageInfo,
			},
			200,
		);
	});
	app.openapi(getCommunityFeedbackRoute, async (c) => {
		const params = c.req.valid("param");
		const result = await requiredService(options).getCommunityFeedback(
			requiredActor(c),
			params.rootEventId,
			params.feedbackId,
		);
		return c.json(communityFeedbackResolutionResponse(result), 200);
	});
	app.openapi(setCommunityFeedbackVoteRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventFeedbackVotesSet",
			{ params, body },
			async (service) => ({
				status: 200,
				body: communityFeedbackResolutionResponse(
					await service.setCommunityFeedbackVote(
						actor,
						params.rootEventId,
						params.feedbackId,
						body.present,
					),
				),
				headers: {},
			}),
			communityFeedbackReplayGuard(
				actor,
				params.rootEventId,
				params.feedbackId,
			),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(createCommunityFeedbackCommentRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventFeedbackCommentsCreate",
			{ params, body },
			async (service) => {
				const value = await service.addCommunityFeedbackComment(
					actor,
					params.rootEventId,
					params.feedbackId,
					body,
				);
				return {
					status: 201,
					body: communityFeedbackResolutionResponse(value),
					headers: {
						Location: `/v1/event-roots/${params.rootEventId}/feedback/${value.feedback.id}/comments/${body.id}`,
					},
				};
			},
			communityFeedbackReplayGuard(
				actor,
				params.rootEventId,
				params.feedbackId,
			),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 201);
	});
	app.openapi(setCommunityFeedbackFollowRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"eventFeedbackFollowsSet",
			{ params, body },
			async (service) => ({
				status: 200,
				body: await service.setCommunityFeedbackFollow(
					actor,
					params.rootEventId,
					params.feedbackId,
					body.followed,
				),
				headers: {},
			}),
			communityFeedbackReplayGuard(
				actor,
				params.rootEventId,
				params.feedbackId,
			),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(createFeedbackRoute, async (c) => {
		const actor = requiredActor(c);
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"feedbackCreate",
			body,
			async (service) => {
				const feedback = await service.createFeedback(
					actor,
					feedbackInput(body),
				);
				return {
					status: 201,
					body: { feedback: feedbackResponse(feedback) },
					headers: { Location: `/v1/feedback/${feedback.id}` },
				};
			},
			feedbackReplayGuard(actor, body.id, "read", false),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 201);
	});
	app.openapi(getFeedbackRoute, async (c) => {
		const feedback = await requiredService(options).getFeedback(
			requiredActor(c),
			c.req.valid("param").feedbackId,
		);
		return c.json({ feedback: feedbackResponse(feedback) }, 200);
	});
	app.openapi(setFeedbackVoteRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"feedbackVotesSet",
			{ params, body },
			async (service) => ({
				status: 200,
				body: {
					feedback: feedbackResponse(
						await service.setFeedbackVote(
							actor,
							params.feedbackId,
							body.present,
						),
					),
				},
				headers: {},
			}),
			feedbackReplayGuard(actor, params.feedbackId, "member", false),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(createFeedbackCommentRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"feedbackCommentsCreate",
			{ params, body },
			async (service) => ({
				status: 201,
				body: {
					feedback: feedbackResponse(
						await service.addFeedbackComment(actor, params.feedbackId, body),
					),
				},
				headers: {
					Location: `/v1/feedback/${params.feedbackId}/comments/${body.id}`,
				},
			}),
			feedbackReplayGuard(actor, params.feedbackId, "member", false),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 201);
	});
	app.openapi(markFeedbackDuplicateRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"feedbackDuplicateMark",
			{ params, body },
			async (service) => ({
				status: 200,
				body: {
					feedback: feedbackResponse(
						await service.markFeedbackDuplicate(
							actor,
							params.feedbackId,
							body.canonicalFeedbackId,
							body.note,
						),
					),
				},
				headers: {},
			}),
			feedbackReplayGuard(actor, params.feedbackId, "manage", false),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(setFeedbackStatusRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await command(
			c,
			actor,
			"feedbackStatusSet",
			{ params, body },
			async (service) => ({
				status: 200,
				body: {
					feedback: feedbackResponse(
						await service.setFeedbackStatus(
							actor,
							params.feedbackId,
							body.status,
							body.note,
						),
					),
				},
				headers: {},
			}),
			feedbackReplayGuard(actor, params.feedbackId, "manage", false),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(prepareUploadRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const target = attachmentTargetFromPrepareBody(body);
		const eventService = requiredService(options);
		const result = await command(
			c,
			actor,
			"eventAttachmentUploadsPrepare",
			{ params, body },
			async (service) => {
				const upload = await service.prepareAttachmentUpload(actor, {
					rootEventId: params.rootEventId,
					attachmentId: body.attachmentId,
					target,
					contentType: body.contentType,
					byteCount: body.byteCount,
					sha256: body.sha256,
				});
				return {
					status: 201,
					body: { upload: uploadMetadataResponse(upload) },
					headers: {
						Location: `/v1/event-roots/${params.rootEventId}/attachments/uploads/${upload.id}`,
					},
				};
			},
			attachmentTargetReplayGuard(actor, params.rootEventId, target),
		);
		const value = await eventService.attachmentUploadGrant(
			actor,
			params.rootEventId,
			result.body.upload.id,
		);
		applyCommandHeaders(c, result);
		c.header("Cache-Control", "private, no-store");
		return c.json(
			{ ...result.body, grant: uploadGrantResponse(value.grant) },
			201,
		);
	});
	app.openapi(finalizeUploadRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const body = c.req.valid("json");
		const request = { params, body };
		const eventService = requiredService(options);
		const replay = await eventService.replayCommand<{
			attachment: ReturnType<typeof attachmentResponse>;
		}>(
			actor,
			"eventAttachmentUploadsFinalize",
			c.req.valid("header")["idempotency-key"],
			request,
			attachmentFinalizeReplayGuard(actor, params.rootEventId, params.uploadId),
		);
		if (replay) {
			if (replay.status >= 400)
				throw new StoredCommandResponse(
					replay.status as 400 | 401 | 403 | 404 | 409,
					withRequestId(replay.body, c.get("requestId")),
					replay.headers,
					true,
				);
			applyCommandHeaders(c, replay);
			return c.json(replay.body, 200);
		}
		const verification = await eventService.ensureAttachmentVerification(
			actor,
			params.rootEventId,
			params.uploadId,
		);
		if (verification.state !== "ready") {
			c.header("Retry-After", String(verification.retryAfterSeconds));
			c.header("Idempotency-Replayed", "false");
			return c.json(
				{
					uploadId: params.uploadId,
					verification: { state: verification.state, retryable: true as const },
				},
				202,
			);
		}
		const result = await command(
			c,
			actor,
			"eventAttachmentUploadsFinalize",
			request,
			async (service) => ({
				status: 200,
				body: {
					attachment: attachmentResponse(
						await service.commitAttachment(
							actor,
							params.rootEventId,
							params.uploadId,
							body.caption,
						),
					),
				},
				headers: {},
			}),
			attachmentFinalizeReplayGuard(actor, params.rootEventId, params.uploadId),
		);
		applyCommandHeaders(c, result);
		return c.json(result.body, 200);
	});
	app.openapi(downloadAttachmentRoute, async (c) => {
		const actor = requiredActor(c);
		const params = c.req.valid("param");
		const value = await requiredService(options).attachmentDownload(
			actor,
			params.rootEventId,
			params.attachmentId,
		);
		c.header("Cache-Control", "private, no-store");
		return c.json(
			{
				attachment: attachmentResponse(value.attachment),
				download: downloadGrantResponse(value.grant),
			},
			200,
		);
	});

	app.openAPIRegistry.registerComponent("securitySchemes", "userBearer", {
		type: "http",
		scheme: "bearer",
		bearerFormat: "JWT",
		description:
			"Short-lived RS256 token issued by user-service and verified again here",
	});
	app.openAPIRegistry.registerComponent("securitySchemes", "serviceBearer", {
		type: "http",
		scheme: "bearer",
		bearerFormat: "JWT",
		description:
			"Short-lived target-specific HS256 service token with rotating KID and exact place-candidate scope",
	});
	app.get("/docs/openapi.json", (c) => {
		const document = app.getOpenAPI31Document({
			openapi: "3.1.0",
			info: { title: "Crew Event Service", version: "0.1.0" },
		});
		addTemplateOpenApiBounds(document);
		return c.json(document);
	});
	app.get("/docs", apiReference({ url: "/docs/openapi.json" }));
	app.notFound((c) =>
		c.json(
			errorBody(c.get("requestId"), "NOT_FOUND", "Resource not found.", false),
			404,
		),
	);
	app.onError((error, c) => {
		if (error instanceof StoredCommandResponse) {
			for (const [name, value] of Object.entries(error.headers)) {
				if (name.toLowerCase() !== "x-request-id") c.header(name, value);
			}
			c.header("Idempotency-Replayed", String(error.replayed));
			return c.json(error.body, error.status);
		}
		if (error instanceof DomainError) {
			for (const [name, value] of Object.entries(error.headers))
				c.header(name, value);
			return c.json(
				errorBody(
					c.get("requestId"),
					error.code,
					error.message,
					Object.hasOwn(error.headers, "Retry-After"),
					error.details,
				),
				error.status,
			);
		}
		if (error instanceof HTTPException && error.status === 400) {
			if (isRecapShareResolvePath(c.req.path)) {
				c.header("Cache-Control", "private, no-store");
				return c.json(
					errorBody(
						c.get("requestId"),
						"NOT_FOUND",
						"Resource not found.",
						false,
					),
					404,
				);
			}
			return c.json(
				errorBody(
					c.get("requestId"),
					"VALIDATION_FAILED",
					"The request is invalid.",
					false,
				),
				400,
			);
		}
		console.error("Unhandled request error", {
			requestId: c.get("requestId"),
			code: "INTERNAL_ERROR",
		});
		return c.json(
			errorBody(
				c.get("requestId"),
				"INTERNAL_ERROR",
				"Internal server error.",
				false,
			),
			500,
		);
	});
	return app;
}

type TemplateOpenApiDocument = {
	paths: {
		"/v1/event-roots": {
			post: {
				requestBody: {
					content: {
						"application/json": {
							schema: {
								properties: {
									template: {
										properties: {
											eventIds: Record<string, unknown>;
										};
									};
								};
							};
						};
					};
				};
			};
		};
		"/v1/event-roots/{rootEventId}/template": {
			post: {
				requestBody: {
					content: {
						"application/json": {
							schema: {
								properties: {
									template: {
										properties: {
											eventIds: Record<string, unknown>;
										};
									};
								};
							};
						};
					};
				};
			};
		};
	};
};

function addTemplateOpenApiBounds(document: unknown) {
	const paths = (document as TemplateOpenApiDocument).paths;
	for (const eventIds of [
		paths["/v1/event-roots"].post.requestBody.content["application/json"].schema
			.properties.template.properties.eventIds,
		paths["/v1/event-roots/{rootEventId}/template"].post.requestBody.content[
			"application/json"
		].schema.properties.template.properties.eventIds,
	]) {
		eventIds.propertyNames = {
			type: "string",
			pattern: "^[a-z][a-z0-9-]{0,31}$",
		};
	}
}

const requestIdMiddleware = createMiddleware<EventEnv>(async (c, next) => {
	const incoming = c.req.header("x-request-id");
	const requestId =
		incoming &&
		REQUEST_ID.test(incoming) &&
		!SENSITIVE_IDENTIFIER.test(incoming)
			? incoming
			: crypto.randomUUID();
	c.set("requestId", requestId);
	c.header("X-Request-ID", requestId);
	await next();
});

const syncPushBodyLimit = boundedBody(MAX_SYNC_BODY_BYTES);

function boundedBody(maxBytes: number) {
	return createMiddleware<EventEnv>(async (c, next) => {
		const reject = () =>
			c.json(
				errorBody(
					c.get("requestId"),
					"PAYLOAD_TOO_LARGE",
					"The request body exceeds the 1 MiB limit.",
					false,
				),
				413,
			);
		const declaredLength = c.req.header("content-length");
		if (
			declaredLength &&
			/^\d+$/.test(declaredLength) &&
			Number(declaredLength) > maxBytes
		) {
			return reject();
		}
		const body = c.req.raw.body;
		if (!body) return next();

		const reader = body.getReader();
		const chunks: Uint8Array[] = [];
		let byteCount = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			byteCount += value.byteLength;
			if (byteCount > maxBytes) {
				await reader.cancel().catch(() => undefined);
				return reject();
			}
			chunks.push(value);
		}
		const bytes = new Uint8Array(byteCount);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		const raw = c.req.raw;
		const requestInit = {
			method: raw.method,
			headers: raw.headers,
			body: bytes,
			signal: raw.signal,
			duplex: "half" as const,
		};
		c.req.raw = new Request(raw.url, requestInit);
		await next();
	});
}

function requiredActor(c: { get(name: "actor"): Actor | undefined }) {
	const actor = c.get("actor");
	if (!actor)
		throw new DomainError(
			401,
			"UNAUTHENTICATED",
			"Authentication is required.",
		);
	return actor;
}

function requiredService(options: AppOptions) {
	if (!options.service)
		throw new Error("Event service dependency is unavailable");
	return options.service;
}

function requiredPlaceCandidates(options: AppOptions) {
	if (!options.placeCandidates)
		throw new Error("Place-candidate service dependency is unavailable");
	return options.placeCandidates;
}

function requiredPlaceSearch(options: AppOptions) {
	if (!options.placeSearch)
		throw new Error("Place-search dependency is unavailable");
	return options.placeSearch;
}

async function command<T extends Record<string, unknown>>(
	c: {
		get: {
			(name: "service"): EventService | undefined;
			(name: "requestId"): string;
		};
		req: { valid(target: "header"): { "idempotency-key": string } };
	},
	actor: Actor,
	operationId: string,
	request: unknown,
	work: (
		service: EventService,
	) => Promise<{ status: number; body: T; headers: Record<string, string> }>,
	replayGuard: (
		service: EventService,
		replay: { status: number; body: T; headers: Record<string, string> },
	) => Promise<void>,
	beforeNewCommand?: (service: EventService) => void | Promise<void>,
) {
	const service = c.get("service");
	if (!service) throw new Error("Event service dependency is unavailable");
	const requestHashGuard = (
		scoped: EventService,
		replay: {
			status: number;
			body: Record<string, unknown>;
			headers: Record<string, string>;
		},
	) => replayGuard(scoped, { ...replay, body: replay.body as T });
	if (beforeNewCommand) {
		const replay = await service.replayCommand<Record<string, unknown>>(
			actor,
			operationId,
			c.req.valid("header")["idempotency-key"],
			request,
			requestHashGuard,
		);
		if (replay) return commandResult<T>(c, replay);
		await beforeNewCommand(service);
	}
	const result = await service.command<Record<string, unknown>>(
		actor,
		operationId,
		c.req.valid("header")["idempotency-key"],
		request,
		async (scoped) => {
			try {
				return await work(scoped);
			} catch (error) {
				if (!(error instanceof DomainError)) throw error;
				return {
					status: error.status,
					body: storedErrorBody(
						error.code,
						error.message,
						false,
						error.details,
					),
					headers: error.headers,
				};
			}
		},
		requestHashGuard,
	);
	return commandResult<T>(c, result);
}

function commandResult<T extends Record<string, unknown>>(
	c: { get(name: "requestId"): string },
	result: {
		status: number;
		body: Record<string, unknown>;
		headers: Record<string, string>;
		replayed: boolean;
	},
) {
	if (result.status >= 400) {
		throw new StoredCommandResponse(
			result.status as 400 | 401 | 403 | 404 | 409,
			withRequestId(result.body, c.get("requestId")),
			result.headers,
			result.replayed,
		);
	}
	return { ...result, body: result.body as T };
}

function replayNotFound(): never {
	throw new DomainError(404, "NOT_FOUND", "Resource not found.");
}

function rootReplayGuard(
	actor: Actor,
	rootEventId: string,
	access: "member" | "manager" | "writer" = "manager",
	guardErrors = true,
) {
	return async (
		service: EventService,
		replay: { status: number; body: Record<string, unknown> },
	) => {
		if (replay.status >= 400 && !guardErrors) return;
		await service.assertRootReplaySafe(actor, rootEventId, access);
	};
}

function feedEntryReplayGuard(
	actor: Actor,
	rootEventId: string,
	entryId: string,
	requireLiveEntry = false,
) {
	return async (
		service: EventService,
		replay: { status: number; body: Record<string, unknown> },
	) => {
		let expectedVersion: number | null = null;
		let expectedRootRevision: string | null = null;
		if (replay.status < 400) {
			if (requireLiveEntry) {
				const reaction = replay.body.reaction;
				const replayEntryId =
					typeof reaction === "object" &&
					reaction !== null &&
					"entryId" in reaction
						? reaction.entryId
						: null;
				if (replayEntryId !== entryId) replayNotFound();
			} else {
				const entry = replay.body.entry;
				const replayEntry =
					typeof entry === "object" && entry !== null ? entry : null;
				const replayEntryId =
					replayEntry && "id" in replayEntry ? replayEntry.id : null;
				const version =
					replayEntry && "version" in replayEntry ? replayEntry.version : null;
				const rootRevision =
					replayEntry && "rootRevision" in replayEntry
						? replayEntry.rootRevision
						: null;
				if (
					replayEntryId !== entryId ||
					typeof version !== "number" ||
					!Number.isSafeInteger(version) ||
					version < 1 ||
					typeof rootRevision !== "string" ||
					!/^\d+$/.test(rootRevision)
				)
					replayNotFound();
				expectedVersion = version;
				expectedRootRevision = rootRevision;
			}
		}
		await service.assertFeedReplaySafe(
			actor,
			rootEventId,
			entryId,
			expectedVersion,
			expectedRootRevision,
			requireLiveEntry || replay.status >= 400,
		);
	};
}

function attachmentTargetFromPrepareBody(
	body: z.infer<typeof UploadPrepareSchema>,
): AttachmentTarget {
	return "target" in body
		? body.target
		: { kind: "feedEntry", entryId: body.targetEntryId };
}

function attachmentTargetReplayGuard(
	actor: Actor,
	rootEventId: string,
	target: AttachmentTarget,
) {
	return (service: EventService) =>
		service.assertAttachmentTargetReplaySafe(actor, rootEventId, target);
}

function attachmentFinalizeReplayGuard(
	actor: Actor,
	rootEventId: string,
	uploadId: string,
) {
	return async (
		service: EventService,
		replay: { status: number; body: Record<string, unknown> },
	) => {
		let attachmentId: string | null = null;
		if (replay.status < 400) {
			const attachment = replay.body.attachment;
			const candidate =
				typeof attachment === "object" &&
				attachment !== null &&
				"id" in attachment
					? attachment.id
					: null;
			const parsed = AttachmentIdSchema.safeParse(candidate);
			if (!parsed.success) replayNotFound();
			attachmentId = parsed.data;
		}
		if (attachmentId !== null) {
			await service.assertAttachmentFinalizeReplaySafe(
				actor,
				rootEventId,
				uploadId,
				attachmentId,
			);
			return;
		}
		await service.assertAttachmentUploadReplaySafe(
			actor,
			rootEventId,
			uploadId,
		);
	};
}

function invitationRedemptionReplayGuard(actor: Actor) {
	return async (
		service: EventService,
		replay: { status: number; body: Record<string, unknown> },
	) => {
		if (replay.status >= 400) replayNotFound();
		const membership = replay.body.membership;
		const candidate =
			typeof membership === "object" &&
			membership !== null &&
			"rootEventId" in membership
				? membership.rootEventId
				: null;
		const parsed = EventIdSchema.safeParse(candidate);
		if (!parsed.success) replayNotFound();
		await service.assertRootReplaySafe(actor, parsed.data, "member");
	};
}

function recapReplayGuard(
	actor: Actor,
	rootEventId: string,
	requireRecapVersion: boolean,
) {
	return async (
		service: EventService,
		replay: {
			status: number;
			body: Record<string, unknown>;
			headers: Record<string, string>;
		},
	) => {
		let recapVersion: number | null = null;
		if (requireRecapVersion && replay.status < 400) {
			const recap = replay.body.recap;
			const version =
				typeof recap === "object" && recap !== null && "version" in recap
					? recap.version
					: null;
			if (
				typeof version !== "number" ||
				!Number.isSafeInteger(version) ||
				version < 1 ||
				version > 2_147_483_647
			)
				replayNotFound();
			recapVersion = version;
		}
		await service.assertRecapReplaySafe(actor, rootEventId, recapVersion);
	};
}

function recapShareLinkReplayGuard(actor: Actor, rootEventId: string) {
	return async (
		service: EventService,
		replay: {
			status: number;
			body: Record<string, unknown>;
			headers: Record<string, string>;
		},
	) => {
		let shareLinkId: string | null = null;
		if (replay.status < 400) {
			const shareLink = replay.body.shareLink;
			const candidate =
				typeof shareLink === "object" && shareLink !== null && "id" in shareLink
					? shareLink.id
					: null;
			const parsed = RecapShareLinkIdSchema.safeParse(candidate);
			if (!parsed.success) replayNotFound();
			shareLinkId = parsed.data;
		}
		await service.assertRecapShareLinkReplaySafe(
			actor,
			rootEventId,
			shareLinkId,
		);
	};
}

function recapExternalGrantReplayGuard(
	actor: Actor,
	rootEventId: string,
	recapVersion: number,
	input: RecapExternalGrantDecisionInput,
) {
	return async (service: EventService) => {
		await service.assertRecapExternalGrantReplaySafe(
			actor,
			rootEventId,
			recapVersion,
			input,
		);
	};
}

function communityFeedbackReplayGuard(
	actor: Actor,
	rootEventId: string,
	feedbackId: string,
) {
	return async (
		service: EventService,
		replay: { status: number; body: Record<string, unknown> },
	) => {
		if (replay.status >= 400) return;
		const feedback = replay.body.feedback;
		const canonicalId =
			typeof feedback === "object" && feedback !== null && "id" in feedback
				? feedback.id
				: replay.body.feedbackId;
		if (typeof canonicalId !== "string" || !FEEDBACK_ID.test(canonicalId))
			replayNotFound();
		await service.assertCommunityFeedbackReplaySafe(
			actor,
			rootEventId,
			feedbackId,
			canonicalId,
		);
	};
}

function feedbackReplayGuard(
	actor: Actor,
	feedbackId: string,
	access: "read" | "member" | "manage",
	guardErrors = true,
) {
	return async (
		service: EventService,
		replay: { status: number; body: Record<string, unknown> },
	) => {
		if (replay.status >= 400 && !guardErrors) return;
		let requiredAccess: "read" | "member" | "manage" = access;
		if (replay.status < 400) {
			const feedback = replay.body.feedback;
			const candidate =
				typeof feedback === "object" && feedback !== null && "id" in feedback
					? feedback.id
					: null;
			if (candidate !== feedbackId) replayNotFound();
			if (typeof feedback !== "object" || feedback === null) replayNotFound();
			const authorUserId =
				"authorUserId" in feedback ? feedback.authorUserId : null;
			const diagnostics =
				"diagnostics" in feedback ? feedback.diagnostics : null;
			const attachments =
				"attachments" in feedback ? feedback.attachments : null;
			const comments = "comments" in feedback ? feedback.comments : null;
			const statusHistory =
				"statusHistory" in feedback ? feedback.statusHistory : null;
			const context = "context" in feedback ? feedback.context : null;
			const rootEventId =
				typeof context === "object" &&
				context !== null &&
				"rootEventId" in context
					? context.rootEventId
					: null;
			const containsPrivilegedIdentity =
				typeof authorUserId === "string" ||
				(Array.isArray(comments) &&
					comments.some(
						(comment) =>
							typeof comment === "object" &&
							comment !== null &&
							"authorUserId" in comment &&
							comment.authorUserId !== null,
					)) ||
				(Array.isArray(statusHistory) &&
					statusHistory.some(
						(change) =>
							typeof change === "object" &&
							change !== null &&
							"changedBy" in change &&
							change.changedBy !== null,
					));
			if (
				authorUserId !== actor.id &&
				(diagnostics !== null || containsPrivilegedIdentity)
			)
				requiredAccess = "manage";
			else if (
				requiredAccess === "read" &&
				((Array.isArray(attachments) && attachments.length > 0) ||
					(authorUserId !== actor.id && typeof rootEventId === "string"))
			)
				requiredAccess = "member";
		}
		await service.assertFeedbackReplaySafe(actor, feedbackId, requiredAccess);
	};
}

function placeEnrichmentReplayGuard() {
	return async (
		service: EventService,
		replay: { status: number; body: Record<string, unknown> },
	) => {
		if (replay.status >= 400) return;
		const enrichment = replay.body.enrichment;
		const id =
			typeof enrichment === "object" &&
			enrichment !== null &&
			"id" in enrichment
				? enrichment.id
				: null;
		const parsed = PlaceEnrichmentJobIdSchema.safeParse(id);
		if (!parsed.success) replayNotFound();
		await service.getPlaceEnrichment(parsed.data);
	};
}

function enrichmentCommand(
	body: z.infer<typeof PlaceEnrichmentResponseSchema>,
) {
	const retryAfter = body.enrichment.pollAfterSeconds;
	return {
		status: 202,
		body,
		headers: {
			Location: `/v1/places/enrichment-jobs/${body.enrichment.id}`,
			...(retryAfter === null ? {} : { "Retry-After": String(retryAfter) }),
		},
	};
}

class StoredCommandResponse extends Error {
	constructor(
		readonly status: 400 | 401 | 403 | 404 | 409,
		readonly body: Record<string, unknown>,
		readonly headers: Record<string, string>,
		readonly replayed: boolean,
	) {
		super("Stored idempotent command response");
	}
}

function applyCommandHeaders(
	c: { header(name: string, value: string): void },
	result: { headers: Record<string, string>; replayed: boolean },
) {
	for (const [name, value] of Object.entries(result.headers)) {
		if (name.toLowerCase() !== "x-request-id") c.header(name, value);
	}
	c.header("Idempotency-Replayed", String(result.replayed));
}

function storedErrorBody(
	code: string,
	message: string,
	retryable: boolean,
	details?: ErrorDetail[],
) {
	return {
		error: {
			code,
			message,
			retryable,
			...(details?.length ? { details } : {}),
		},
	};
}

function withRequestId(body: Record<string, unknown>, requestId: string) {
	const error = body.error;
	if (!error || typeof error !== "object" || Array.isArray(error)) return body;
	return { ...body, error: { ...error, requestId } };
}

function errorBody(
	requestId: string,
	code: string,
	message: string,
	retryable: boolean,
	details?: ErrorDetail[],
) {
	return withRequestId(
		storedErrorBody(code, message, retryable, details),
		requestId,
	);
}

function isIanaTimeZone(value: string) {
	try {
		new Intl.DateTimeFormat("en", { timeZone: value }).format();
		return true;
	} catch {
		return false;
	}
}

function isTrimmed(value: string) {
	return value === value.trim();
}

function hasNoControlCharacters(value: string) {
	for (const character of value) {
		const code = character.charCodeAt(0);
		if (code <= 31 || code === 127) return false;
	}
	return true;
}

function eventInput(body: z.infer<typeof EventFieldsSchema>): EventInput {
	return {
		...body,
		startsAt: body.startsAt ? new Date(body.startsAt) : null,
		endsAt: body.endsAt ? new Date(body.endsAt) : null,
	};
}

function parseEventPatch(
	changes: z.infer<typeof EventPatchSchema>["changes"],
): EventPatch {
	return {
		...Object.fromEntries(
			Object.entries(changes).filter((entry) => entry[1] !== undefined),
		),
		...(Object.hasOwn(changes, "startsAt")
			? { startsAt: changes.startsAt ? new Date(changes.startsAt) : null }
			: {}),
		...(Object.hasOwn(changes, "endsAt")
			? { endsAt: changes.endsAt ? new Date(changes.endsAt) : null }
			: {}),
	};
}

function itineraryInput(
	body: z.infer<typeof ItineraryFieldsSchema>,
): ItineraryInput {
	return {
		...body,
		startsAt: body.startsAt ? new Date(body.startsAt) : null,
		endsAt: body.endsAt ? new Date(body.endsAt) : null,
	};
}

function feedbackInput(
	body: z.infer<typeof FeedbackCreateSchema>,
): FeedbackInput {
	return {
		...body,
		diagnostics: body.diagnostics
			? (Object.fromEntries(
					Object.entries(body.diagnostics).filter(
						(entry) => entry[1] !== undefined,
					),
				) as FeedbackInput["diagnostics"])
			: null,
	};
}

function parseItineraryPatch(
	changes: z.infer<typeof ItineraryChangesSchema>,
): ItineraryPatch {
	return {
		...Object.fromEntries(
			Object.entries(changes).filter((entry) => entry[1] !== undefined),
		),
		...(Object.hasOwn(changes, "startsAt")
			? {
					startsAt: changes.startsAt
						? new Date(changes.startsAt as string)
						: null,
				}
			: {}),
		...(Object.hasOwn(changes, "endsAt")
			? { endsAt: changes.endsAt ? new Date(changes.endsAt as string) : null }
			: {}),
	};
}

function parsePlacePatch(
	changes: z.infer<typeof PlaceChangesSchema>,
): PlacePatch {
	return Object.fromEntries(
		Object.entries(changes).filter((entry) => entry[1] !== undefined),
	) as PlacePatch;
}

function eventResponse(event: EventRecord) {
	const { sortPosition, deletedAt: _deletedAt, ...visible } = event;
	return {
		...visible,
		sortKey: sortPosition,
		startsAt: event.startsAt?.toISOString() ?? null,
		endsAt: event.endsAt?.toISOString() ?? null,
		createdAt: event.createdAt.toISOString(),
		updatedAt: event.updatedAt.toISOString(),
	};
}

function recapResponse(recap: EventRecap) {
	return {
		...recap,
		generatedAt: recap.generatedAt.toISOString(),
		publishedAt: recap.publishedAt?.toISOString() ?? null,
	};
}

function recapShareLinkResponse(shareLink: EventRecapShareLink) {
	return {
		id: shareLink.id,
		recapVersion: shareLink.recapVersion,
		createdAt: shareLink.createdAt.toISOString(),
		expiresAt: shareLink.expiresAt.toISOString(),
	};
}

function eventRootSummaryResponse(summary: EventRootSummary) {
	return {
		...summary,
		startsAt: summary.startsAt?.toISOString() ?? null,
		endsAt: summary.endsAt?.toISOString() ?? null,
		createdAt: summary.createdAt.toISOString(),
		updatedAt: summary.updatedAt.toISOString(),
	};
}

function membershipResponse(membership: MembershipRecord) {
	return {
		...membership,
		createdAt: membership.createdAt.toISOString(),
		updatedAt: membership.updatedAt.toISOString(),
	};
}

function invitationResponse(invitation: InvitationRecord) {
	const { tokenKeyId: _tokenKeyId, ...visible } = invitation;
	return {
		...visible,
		expiresAt: invitation.expiresAt.toISOString(),
		createdAt: invitation.createdAt.toISOString(),
		updatedAt: invitation.updatedAt.toISOString(),
	};
}

function invitationAdminSummaryResponse(summary: InvitationAdminSummary) {
	return {
		...summary,
		expiresAt: summary.expiresAt.toISOString(),
		createdAt: summary.createdAt.toISOString(),
		updatedAt: summary.updatedAt.toISOString(),
	};
}

function placeResponse(place: PlaceRecord) {
	const { deletedAt: _deletedAt, ...visible } = place;
	return {
		...visible,
		createdAt: place.createdAt.toISOString(),
		updatedAt: place.updatedAt.toISOString(),
	};
}

function placeCandidateResponse(candidate: PlaceCandidateRecord) {
	return {
		...candidate,
		retrievedAt: candidate.retrievedAt.toISOString(),
		expiresAt: candidate.expiresAt?.toISOString() ?? null,
		retirement: candidate.retirement
			? {
					...candidate.retirement,
					retiredAt: candidate.retirement.retiredAt.toISOString(),
				}
			: null,
		createdAt: candidate.createdAt.toISOString(),
		updatedAt: candidate.updatedAt.toISOString(),
	};
}

function capabilityResponse(capability: CapabilityRecord) {
	const { deletedAt: _deletedAt, ...visible } = capability;
	return {
		...visible,
		createdAt: capability.createdAt.toISOString(),
		updatedAt: capability.updatedAt.toISOString(),
	};
}

function itineraryResponse(item: ItineraryRecord) {
	const { sortPosition, deletedAt: _deletedAt, ...visible } = item;
	return {
		...visible,
		sortKey: sortPosition,
		startsAt: item.startsAt?.toISOString() ?? null,
		endsAt: item.endsAt?.toISOString() ?? null,
		createdAt: item.createdAt.toISOString(),
		updatedAt: item.updatedAt.toISOString(),
	};
}

function feedEntryResponse(entry: FeedEntryRecord) {
	return {
		...entry,
		createdAt: entry.createdAt.toISOString(),
		updatedAt: entry.updatedAt.toISOString(),
		deletedAt: entry.deletedAt?.toISOString() ?? null,
		attachments: entry.attachments.map(attachmentResponse),
	};
}

function feedReactionResponse(reaction: FeedReactionRecord) {
	return { ...reaction, updatedAt: reaction.updatedAt.toISOString() };
}

function communityFeedbackSummaryResponse(feedback: CommunityFeedbackSummary) {
	return {
		id: feedback.id,
		title: feedback.title,
		body: feedback.body,
		status: feedback.status,
		version: feedback.version,
		voteCount: feedback.voteCount,
		duplicateCount: feedback.duplicateCount,
		viewerHasVoted: feedback.viewerHasVoted,
		followed: feedback.followed,
		createdAt: feedback.createdAt.toISOString(),
		updatedAt: feedback.updatedAt.toISOString(),
	};
}

function communityFeedbackDuplicateSuggestionResponse(
	feedback: CommunityFeedbackDuplicateSuggestion,
) {
	return {
		id: feedback.id,
		title: feedback.title,
		status: feedback.status,
		voteCount: feedback.voteCount,
	};
}

function communityFeedbackDetailResponse(feedback: CommunityFeedbackDetail) {
	return {
		...communityFeedbackSummaryResponse(feedback),
		comments: feedback.comments.map((comment) => ({
			id: comment.id,
			body: comment.body,
			createdAt: comment.createdAt.toISOString(),
		})),
		commentCount: feedback.commentCount,
		commentsHasMore: feedback.commentsHasMore,
		statusHistory: feedback.statusHistory.map((change) => ({
			version: change.version,
			fromStatus: change.fromStatus,
			toStatus: change.toStatus,
			note: change.note,
			changedAt: change.changedAt.toISOString(),
		})),
		statusHistoryCount: feedback.statusHistoryCount,
		statusHistoryHasMore: feedback.statusHistoryHasMore,
	};
}

function communityFeedbackResolutionResponse(
	resolution: CommunityFeedbackResolution,
) {
	return {
		feedback: communityFeedbackDetailResponse(resolution.feedback),
		redirectedFromFeedbackId: resolution.redirectedFromFeedbackId,
	};
}

function communityFeedbackUpdateResponse(update: CommunityFeedbackUpdate) {
	return {
		feedbackId: update.feedbackId,
		title: update.title,
		version: update.version,
		fromStatus: update.fromStatus,
		toStatus: update.toStatus,
		note: update.note,
		changedAt: update.changedAt.toISOString(),
	};
}

function feedbackResponse(feedback: FeedbackRecord) {
	return {
		...feedback,
		attachments: feedback.attachments.map((attachment) => ({
			...attachment,
			createdAt: attachment.createdAt.toISOString(),
		})),
		comments: feedback.comments.map((comment) => ({
			...comment,
			createdAt: comment.createdAt.toISOString(),
		})),
		statusHistory: feedback.statusHistory.map((change) => ({
			...change,
			changedAt: change.changedAt.toISOString(),
		})),
		createdAt: feedback.createdAt.toISOString(),
		updatedAt: feedback.updatedAt.toISOString(),
	};
}

function attachmentResponse(attachment: AttachmentRecord) {
	return {
		id: attachment.id,
		rootEventId: attachment.rootEventId,
		target: attachment.target,
		targetEntryId: attachment.targetEntryId,
		contentType: attachment.contentType,
		byteCount: attachment.byteCount,
		sha256: attachment.sha256,
		caption: attachment.caption,
		integrityStatus: "integrity_verified" as const,
		version: attachment.version,
		rootRevision: attachment.rootRevision,
		createdAt: attachment.createdAt.toISOString(),
	};
}

function uploadMetadataResponse(upload: AttachmentUploadRecord) {
	return {
		id: upload.id,
		attachmentId: upload.attachmentId,
		rootEventId: upload.rootEventId,
		target: upload.target,
		targetEntryId: upload.targetEntryId,
		contentType: upload.contentType,
		byteCount: upload.byteCount,
		sha256: upload.sha256,
		state: upload.state,
		expiresAt: upload.expiresAt.toISOString(),
		createdAt: upload.createdAt.toISOString(),
	};
}

function uploadGrantResponse(grant: UploadGrant) {
	return {
		method: grant.method,
		url: grant.url,
		fields: grant.fields,
		expiresAt: grant.expiresAt.toISOString(),
	};
}

function downloadGrantResponse(grant: DownloadGrant) {
	return {
		method: grant.method,
		url: grant.url,
		headers: grant.headers,
		expiresAt: grant.expiresAt.toISOString(),
	};
}
