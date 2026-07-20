export type Actor = { id: string; email?: string };
export type Role = "owner" | "organizer" | "participant" | "viewer";
export type MembershipStatus = "active" | "left" | "removed";
export type EventStatus = "draft" | "published" | "cancelled" | "archived";
export type CapabilityType =
	| "travel"
	| "lodging"
	| "transport"
	| "golf"
	| "team";
export type ErrorDetail = {
	code: string;
	message: string;
	path?: string;
	meta?: Record<string, string | number | boolean | null>;
};

export const eventPublishReadinessReasonCodes = [
	"EVENT_TEMPLATE_REQUIRED",
	"EVENT_TITLE_REQUIRED",
	"EVENT_DESCRIPTION_REQUIRED",
	"EVENT_START_REQUIRED",
	"EVENT_END_REQUIRED",
	"EVENT_CAPABILITY_REQUIRED",
	"EVENT_CAPABILITY_PLACE_REQUIRED",
	"EVENT_STATUS_NOT_DRAFT",
] as const;
export type EventPublishReadinessReasonCode =
	(typeof eventPublishReadinessReasonCodes)[number];
export type EventPublishReadinessReason = ErrorDetail & {
	code: EventPublishReadinessReasonCode;
	path: string;
};
export type EventPublishReadiness = {
	schemaVersion: 1;
	rootEventId: string;
	rootVersion: number;
	rootRevision: string;
	template: { id: string; version: number } | null;
	ready: boolean;
	reasons: EventPublishReadinessReason[];
};

export class DomainError extends Error {
	constructor(
		readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 503,
		readonly code: string,
		message: string,
		readonly headers: Record<string, string> = {},
		readonly details?: ErrorDetail[],
	) {
		super(message);
	}
}

export type EventRecord = {
	id: string;
	rootEventId: string;
	parentEventId: string | null;
	kind:
		| "trip"
		| "day"
		| "golf"
		| "team_event"
		| "session"
		| "activity"
		| "other";
	title: string;
	description: string | null;
	timeZone: string;
	startsAt: Date | null;
	endsAt: Date | null;
	sortPosition: string;
	childOrderVersion: number;
	itineraryOrderVersion: number;
	status: EventStatus;
	version: number;
	createdAt: Date;
	updatedAt: Date;
	deletedAt: Date | null;
};

export type MembershipRecord = {
	rootEventId: string;
	userId: string;
	role: Role;
	status: MembershipStatus;
	version: number;
	createdAt: Date;
	updatedAt: Date;
};

export type InvitationRecord = {
	id: string;
	rootEventId: string;
	tokenKeyId: string;
	role: Exclude<Role, "owner">;
	normalizedEmailHint: string | null;
	expiresAt: Date;
	maxUses: number;
	useCount: number;
	status: "active" | "revoked";
	version: number;
	createdAt: Date;
	updatedAt: Date;
};

export type InvitationAdminSummary = Pick<
	InvitationRecord,
	| "id"
	| "rootEventId"
	| "role"
	| "expiresAt"
	| "maxUses"
	| "useCount"
	| "status"
	| "version"
	| "createdAt"
	| "updatedAt"
> & { emailBound: boolean };

export type PlaceRecord = {
	id: string;
	rootEventId: string;
	name: string;
	locality: string | null;
	countryCode: string;
	latitude: number | null;
	longitude: number | null;
	version: number;
	createdAt: Date;
	updatedAt: Date;
	deletedAt: Date | null;
};

export type CapabilityInput =
	| {
			type: "travel";
			schemaVersion: 1;
			config: {
				homePlaceId: string | null;
				travelerReferenceLabel: string | null;
			};
	  }
	| {
			type: "lodging";
			schemaVersion: 1;
			config: {
				propertyPlaceId: string | null;
				checkInPolicy: "fixed" | "flexible";
				checkOutPolicy: "fixed" | "flexible";
				roomAssignmentMode: "organizer" | "self_service";
			};
	  }
	| {
			type: "transport";
			schemaVersion: 1;
			config: {
				meetingPlaceId: string | null;
				participantMode: "self_arranged" | "shared" | "mixed";
			};
	  }
	| {
			type: "golf";
			schemaVersion: 1;
			config: {
				coursePlaceId: string | null;
				teeFormat: "individual" | "pairs" | "fourball";
				handicapMode: "none" | "optional" | "required";
				scoringMode: "none" | "stroke_play" | "stableford";
				roundState: "planned" | "open" | "closed";
			};
	  }
	| {
			type: "team";
			schemaVersion: 1;
			config: {
				venuePlaceId: string | null;
				assignmentMode: "organizer" | "self_select" | "random";
				capacityPerTeam: number | null;
				facilitator: string | null;
			};
	  };

export type CapabilityRecord = CapabilityInput & {
	rootEventId: string;
	eventId: string;
	version: number;
	createdAt: Date;
	updatedAt: Date;
	deletedAt: Date | null;
};

export type PlaceSnapshot = Pick<
	PlaceRecord,
	"id" | "name" | "locality" | "countryCode" | "latitude" | "longitude"
>;

type DetailsBase<T extends string> = { schemaVersion: 1; type: T };
type TravelDetailsInput<T extends "flight" | "rail" | "road_transfer"> =
	DetailsBase<T> & {
		originPlaceId: string;
		destinationPlaceId: string;
	};

export type ItineraryDetailsInput =
	| DetailsBase<"note">
	| (DetailsBase<"activity"> & { bookingReference?: string | undefined })
	| (TravelDetailsInput<"flight"> & { flightDesignator?: string | undefined })
	| (TravelDetailsInput<"rail"> & { serviceDesignator?: string | undefined })
	| (TravelDetailsInput<"road_transfer"> & {
			pickupInstructions?: string | undefined;
	  })
	| (DetailsBase<"lodging"> & {
			propertyName: string;
			checkInAt: string;
			checkOutAt: string;
	  })
	| (DetailsBase<"meal"> & { reservationNote?: string | undefined })
	| (DetailsBase<"golf_round"> & {
			roundReference: string;
			teeTime: string;
	  })
	| (DetailsBase<"session"> & {
			room?: string | undefined;
			descendantEventId?: string | undefined;
	  });

type MaterializedTravelDetails<
	T extends TravelDetailsInput<"flight" | "rail" | "road_transfer">,
> = T & {
	originPlaceSnapshot: PlaceSnapshot;
	destinationPlaceSnapshot: PlaceSnapshot;
};

export type ItineraryDetails =
	| Exclude<
			ItineraryDetailsInput,
			TravelDetailsInput<"flight" | "rail" | "road_transfer">
	  >
	| MaterializedTravelDetails<
			Extract<ItineraryDetailsInput, { type: "flight" }>
	  >
	| MaterializedTravelDetails<Extract<ItineraryDetailsInput, { type: "rail" }>>
	| MaterializedTravelDetails<
			Extract<ItineraryDetailsInput, { type: "road_transfer" }>
	  >;

export type ItineraryRecord = {
	id: string;
	rootEventId: string;
	eventId: string;
	title: string;
	notes: string | null;
	timeZone: string;
	startsAt: Date | null;
	endsAt: Date | null;
	allDay: boolean;
	sortPosition: string;
	status: "active" | "cancelled" | "archived";
	details: ItineraryDetails;
	placeId: string | null;
	placeSnapshot: PlaceSnapshot | null;
	version: number;
	createdAt: Date;
	updatedAt: Date;
	deletedAt: Date | null;
};

export type EventInput = Pick<
	EventRecord,
	| "id"
	| "kind"
	| "title"
	| "description"
	| "timeZone"
	| "startsAt"
	| "endsAt"
	| "status"
>;

export function assertRootCreationStatus(input: Pick<EventInput, "status">) {
	if (input.status !== "draft") {
		throw new DomainError(
			400,
			"INVALID_ROOT_STATUS",
			"A new root must start draft.",
		);
	}
}

export type EventPatch = Partial<
	Pick<
		EventRecord,
		"title" | "description" | "timeZone" | "startsAt" | "endsAt" | "status"
	>
>;

export type PlaceInput = Pick<
	PlaceRecord,
	"id" | "name" | "locality" | "countryCode" | "latitude" | "longitude"
>;

export type PlacePatch = Partial<Omit<PlaceInput, "id">>;

export type ItineraryInput = Omit<
	Pick<
		ItineraryRecord,
		| "id"
		| "eventId"
		| "title"
		| "notes"
		| "timeZone"
		| "startsAt"
		| "endsAt"
		| "allDay"
		| "status"
		| "details"
		| "placeId"
	>,
	"details"
> & { details: ItineraryDetailsInput };

export type ItineraryPatch = Partial<Omit<ItineraryInput, "id" | "eventId">>;

export type RootView = {
	rootEventId: string;
	rootRevision: string;
	events: EventRecord[];
	capabilities: CapabilityRecord[];
};

export type EventRootSummary = Pick<
	EventRecord,
	| "rootEventId"
	| "kind"
	| "title"
	| "timeZone"
	| "startsAt"
	| "endsAt"
	| "status"
	| "version"
	| "createdAt"
	| "updatedAt"
> & {
	role: Role;
	membershipStatus: MembershipStatus;
};

export type CursorQuery = {
	limit?: number | undefined;
	cursor?: string | undefined;
};
export type CursorPage<T> = {
	items: T[];
	pageInfo: { nextCursor: string | null; hasMore: boolean };
};
export type PageSlice<T> = { items: T[]; hasMore: boolean };
export type EventRootPageKey = { rootEventId: string };
export type InvitationPageKey = { id: string };
export type MembershipPageKey = { userId: string };
export type PlacePageKey = { name: string; id: string };
export type ItineraryPageKey = { sortPosition: string; id: string };

export type InvitePreview = {
	rootEventId: string;
	title: string;
	startsAt: Date | null;
	endsAt: Date | null;
	role: Exclude<Role, "owner">;
	emailBound: boolean;
	usable: boolean;
};
