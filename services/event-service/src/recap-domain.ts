export const recapSourceTypes = ["event", "feedEntry"] as const;
export type RecapSourceType = (typeof recapSourceTypes)[number];
export type RecapSourceInput =
	| {
			type: "event";
			sourceId: string;
			sourceVersion: number;
			consentBasis: "event-publication";
	  }
	| {
			type: "feedEntry";
			sourceId: string;
			sourceVersion: number;
			consentBasis: "source-author";
	  };

export type EventRecapProvenance =
	| {
			sourceType: "event";
			sourceId: string;
			sourceVersion: number;
			sourceRevision: string;
			visibility: "members";
			consentBasis: "event-publication";
	  }
	| {
			sourceType: "feedEntry";
			sourceId: string;
			sourceVersion: number;
			sourceRevision: string;
			visibility: "members";
			consentBasis: "source-author";
	  };

export type EventRecapItem = {
	ordinal: number;
	sourceTitle: string | null;
	sourceBody: string | null;
	provenance: EventRecapProvenance;
};

export type EventRecap = {
	schemaVersion: 1;
	rootEventId: string;
	version: number;
	lifecycleVersion: number;
	state: "draft" | "published";
	publishedVersion: number | null;
	sourceRootRevision: string;
	generatedAt: Date;
	publishedAt: Date | null;
	title: string;
	titleProvenance: Extract<EventRecapProvenance, { sourceType: "event" }>;
	items: EventRecapItem[];
};

export type RecapExternalDecisionState = "grant" | "withdraw" | "unknown";

export type EventRecapExternalConsent = {
	fields: Array<{
		ordinal: number;
		field: "body";
		requiredAuthorities: Array<"author" | "manager">;
		authorDecision: RecapExternalDecisionState;
		managerDecision: RecapExternalDecisionState;
		actorCanDecide: Array<"author" | "manager">;
	}>;
};

export type EventRecapRead = {
	recap: EventRecap;
	externalConsent: EventRecapExternalConsent | null;
};

export type EventRecapRemoval = {
	removed: true;
	lifecycleVersion: number;
};

export type EventRecapShareLink = {
	id: string;
	recapVersion: number;
	createdAt: Date;
	expiresAt: Date;
};

export type EventRecapShare = {
	title: string;
	items: Array<{ ordinal: number; title: string }>;
};

export type RecapExternalField = {
	sourceType: RecapSourceType;
	sourceId: string;
	sourceVersion: number;
	field: "body";
};

export type RecapExternalGrantDecisionInput = RecapExternalField & {
	authority: "author" | "manager";
	decision: "grant" | "withdraw";
};

export type EventRecapExternalGrantDecision = {
	decision: "grant" | "withdraw";
};

export type EventRecapExternalShare = {
	title: string;
	items: Array<{
		ordinal: number;
		title: string | null;
		body: string | null;
	}>;
};

export type EventRecapShareRevocation = { revoked: true };
