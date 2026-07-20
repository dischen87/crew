import { createHash } from "node:crypto";

export type FeedKind = "message" | "comment" | "system";
export const feedReactions = [
	"like",
	"love",
	"celebrate",
	"laugh",
	"surprised",
	"sad",
] as const;
export type FeedReaction = (typeof feedReactions)[number];

export type ReactionSummary = {
	reaction: string;
	count: number;
	viewerPresent: boolean;
};

export type AttachmentTarget =
	| { kind: "feedEntry"; entryId: string }
	| { kind: "feedback"; feedbackId: string };

export type AttachmentRecord = {
	id: string;
	rootEventId: string;
	target: AttachmentTarget;
	/** Legacy feed-only projection. Feedback-bound attachments keep this null. */
	targetEntryId: string | null;
	contentType: AttachmentContentType;
	byteCount: number;
	sha256: string;
	caption: string | null;
	version: number;
	rootRevision: string;
	createdAt: Date;
};

export type FeedEntryRecord = {
	id: string;
	rootEventId: string;
	eventId: string | null;
	parentEntryId: string | null;
	authorUserId: string | null;
	kind: FeedKind;
	payloadSchemaVersion: 1;
	body: string | null;
	version: number;
	rootRevision: string;
	createdRootRevision: string;
	createdAt: Date;
	updatedAt: Date;
	deletedAt: Date | null;
	tombstoneReason: "author" | "moderation" | null;
	reactions: ReactionSummary[];
	attachments: AttachmentRecord[];
};

export type FeedPageKey = { rootRevision: string; id: string };

export type FeedReactionRecord = {
	rootEventId: string;
	entryId: string;
	userId: string;
	reaction: string;
	present: boolean;
	version: number;
	rootRevision: string;
	updatedAt: Date;
};

export function feedReactionEntityId(
	entryId: string,
	userId: string,
	reaction: string,
) {
	return `fer_${createHash("sha256")
		.update(
			JSON.stringify(["crew:feed-reaction:v1", entryId, userId, reaction]),
		)
		.digest("hex")}`;
}

export const attachmentContentTypes = [
	"image/jpeg",
	"image/png",
	"image/webp",
] as const;
export type AttachmentContentType = (typeof attachmentContentTypes)[number];

export type AttachmentUploadRecord = {
	id: string;
	attachmentId: string;
	rootEventId: string;
	target: AttachmentTarget;
	/** Legacy feed-only projection. Feedback-bound uploads keep this null. */
	targetEntryId: string | null;
	createdBy: string;
	quarantineObjectKey: string;
	contentType: AttachmentContentType;
	byteCount: number;
	sha256: string;
	grantKid: string;
	grantCiphertext: string;
	state: "prepared" | "committed" | "expired";
	expiresAt: Date;
	committedAt: Date | null;
	createdAt: Date;
};

export type AttachmentVerificationStatus =
	| "pending"
	| "processing"
	| "retry"
	| "verified"
	| "rejected"
	| "dead";

export type AttachmentFinalizePrecondition =
	| { state: "ready" }
	| {
			state: "pending" | "processing" | "retry";
			retryAfterSeconds: number;
	  };

export type UploadGrant = {
	method: "POST";
	url: string;
	fields: Record<string, string>;
	expiresAt: Date;
};

export type DownloadGrant = {
	method: "GET";
	url: string;
	headers: Record<string, string>;
	expiresAt: Date;
};
