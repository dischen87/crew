import {
	type CapabilityInput,
	DomainError,
	type EventInput,
	type EventRecord,
} from "./domain";

export type EventTemplateId = "travel" | "golf-tour" | "team-event";
export type EventTemplateDefinition = {
	id: EventTemplateId;
	version: 1;
	title: string;
	summary: string;
	events: readonly {
		logicalKey: string;
		parentLogicalKey: string | null;
		kind: EventRecord["kind"];
		title: string;
		capabilities: readonly CapabilityInput[];
	}[];
};
export type EventTemplateIdentity = Pick<
	EventTemplateDefinition,
	"id" | "version"
>;
export type EventTemplateRequest = {
	id: string;
	version: number;
	eventIds: Record<string, string>;
};
export type EventTemplateInstantiation = {
	definition: EventTemplateDefinition;
	eventIds: Readonly<Record<string, string>>;
};

export const EVENT_TEMPLATES = [
	{
		id: "travel",
		version: 1,
		title: "Travel",
		summary: "Arrival, lodging and participant transport.",
		events: [
			{
				logicalKey: "root",
				parentLogicalKey: null,
				kind: "trip",
				title: "Trip",
				capabilities: [
					{
						type: "travel",
						schemaVersion: 1,
						config: {
							homePlaceId: null,
							travelerReferenceLabel: "Travel reference",
						},
					},
				],
			},
			{
				logicalKey: "arrival",
				parentLogicalKey: "root",
				kind: "day",
				title: "Arrival",
				capabilities: [
					{
						type: "transport",
						schemaVersion: 1,
						config: { meetingPlaceId: null, participantMode: "mixed" },
					},
				],
			},
			{
				logicalKey: "lodging",
				parentLogicalKey: "root",
				kind: "day",
				title: "Lodging",
				capabilities: [
					{
						type: "lodging",
						schemaVersion: 1,
						config: {
							propertyPlaceId: null,
							checkInPolicy: "flexible",
							checkOutPolicy: "flexible",
							roomAssignmentMode: "organizer",
						},
					},
				],
			},
		],
	},
	{
		id: "golf-tour",
		version: 1,
		title: "Golf tour",
		summary: "Travel, lodging, transport, courses and golf rounds.",
		events: [
			{
				logicalKey: "root",
				parentLogicalKey: null,
				kind: "trip",
				title: "Golf tour",
				capabilities: [
					{
						type: "travel",
						schemaVersion: 1,
						config: {
							homePlaceId: null,
							travelerReferenceLabel: "Travel reference",
						},
					},
				],
			},
			{
				logicalKey: "arrival",
				parentLogicalKey: "root",
				kind: "day",
				title: "Arrival",
				capabilities: [
					{
						type: "transport",
						schemaVersion: 1,
						config: { meetingPlaceId: null, participantMode: "mixed" },
					},
				],
			},
			{
				logicalKey: "lodging",
				parentLogicalKey: "root",
				kind: "day",
				title: "Lodging",
				capabilities: [
					{
						type: "lodging",
						schemaVersion: 1,
						config: {
							propertyPlaceId: null,
							checkInPolicy: "flexible",
							checkOutPolicy: "flexible",
							roomAssignmentMode: "organizer",
						},
					},
				],
			},
			{
				logicalKey: "round",
				parentLogicalKey: "root",
				kind: "golf",
				title: "Golf round",
				capabilities: [
					{
						type: "golf",
						schemaVersion: 1,
						config: {
							coursePlaceId: null,
							teeFormat: "individual",
							handicapMode: "optional",
							scoringMode: "stableford",
							roundState: "planned",
						},
					},
				],
			},
		],
	},
	{
		id: "team-event",
		version: 1,
		title: "Team event",
		summary: "Venue, agenda, activities and team assignment.",
		events: [
			{
				logicalKey: "root",
				parentLogicalKey: null,
				kind: "team_event",
				title: "Team event",
				capabilities: [
					{
						type: "team",
						schemaVersion: 1,
						config: {
							venuePlaceId: null,
							assignmentMode: "organizer",
							capacityPerTeam: null,
							facilitator: null,
						},
					},
				],
			},
			{
				logicalKey: "agenda",
				parentLogicalKey: "root",
				kind: "session",
				title: "Agenda",
				capabilities: [],
			},
			{
				logicalKey: "activity",
				parentLogicalKey: "root",
				kind: "activity",
				title: "Team activity",
				capabilities: [],
			},
		],
	},
] as const satisfies readonly EventTemplateDefinition[];

export function resolveEventTemplate(
	request: EventTemplateRequest,
	root: Pick<EventInput, "id" | "kind">,
	allowOtherRootKind = false,
): EventTemplateInstantiation {
	const definition = EVENT_TEMPLATES.find((item) => item.id === request.id);
	if (!definition)
		throw new DomainError(
			400,
			"EVENT_TEMPLATE_INVALID",
			"The requested event template does not exist.",
		);
	if (request.version !== definition.version)
		throw new DomainError(
			409,
			"EVENT_TEMPLATE_VERSION_CONFLICT",
			"The requested event template version is not available.",
		);

	const expected = definition.events.map((event) => event.logicalKey).sort();
	const supplied = Object.keys(request.eventIds).sort();
	const ids = Object.values(request.eventIds);
	if (
		supplied.length > 16 ||
		expected.length !== supplied.length ||
		expected.some((key, index) => key !== supplied[index]) ||
		new Set(ids).size !== ids.length ||
		ids.some((id) => !/^evt_[A-Za-z0-9._:-]{1,96}$/.test(id))
	)
		throw new DomainError(
			400,
			"EVENT_TEMPLATE_IDS_INVALID",
			"Template eventIds must map every logical key exactly once.",
		);
	if (request.eventIds.root !== root.id)
		throw new DomainError(
			400,
			"EVENT_TEMPLATE_ROOT_ID_MISMATCH",
			"The root logical key must map to the root event ID.",
		);
	const rootBlueprint = definition.events.find(
		(event) => event.logicalKey === "root",
	);
	if (
		!rootBlueprint ||
		(rootBlueprint.kind !== root.kind &&
			!(allowOtherRootKind && root.kind === "other"))
	)
		throw new DomainError(
			allowOtherRootKind ? 409 : 400,
			"EVENT_TEMPLATE_ROOT_KIND_MISMATCH",
			"The root event kind does not match the template.",
		);
	return { definition, eventIds: request.eventIds };
}

export function capabilityEntityId(
	eventId: string,
	type: CapabilityInput["type"],
) {
	return `${eventId}:${type}`;
}
