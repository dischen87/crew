export const feedbackStatuses = [
	"open",
	"planned",
	"in_progress",
	"completed",
	"declined",
	"duplicate",
] as const;

export type FeedbackStatus = (typeof feedbackStatuses)[number];
export type FeedbackVisibility = "public" | "private";

export type FeedbackDiagnostics = {
	appVersion?: string;
	buildNumber?: string;
	platform?: "ios" | "android";
	osVersion?: string;
	deviceModel?: string;
	locale?: string;
};

export type FeedbackContext = {
	rootEventId: string | null;
	eventId: string | null;
	screenKey: string | null;
};

export type FeedbackAttachment = {
	id: string;
	contentType: "image/jpeg" | "image/png" | "image/webp";
	byteCount: number;
	sha256: string;
	caption: string | null;
	createdAt: Date;
};

export type FeedbackComment = {
	id: string;
	authorUserId: string | null;
	body: string;
	createdAt: Date;
};

export type FeedbackStatusChange = {
	version: number;
	fromStatus: FeedbackStatus | null;
	toStatus: FeedbackStatus;
	changedBy: string | null;
	note: string | null;
	changedAt: Date;
};

export type FeedbackRecord = {
	id: string;
	title: string;
	body: string;
	visibility: FeedbackVisibility;
	context: FeedbackContext | null;
	diagnostics: FeedbackDiagnostics | null;
	authorUserId: string | null;
	status: FeedbackStatus;
	duplicateOfFeedbackId: string | null;
	version: number;
	voteCount: number;
	viewerHasVoted: boolean;
	attachments: FeedbackAttachment[];
	comments: FeedbackComment[];
	commentCount: number;
	commentsHasMore: boolean;
	statusHistory: FeedbackStatusChange[];
	statusHistoryCount: number;
	statusHistoryHasMore: boolean;
	createdAt: Date;
	updatedAt: Date;
};

export type FeedbackInput = {
	id: string;
	title: string;
	body: string;
	visibility: FeedbackVisibility;
	rootEventId: string | null;
	eventId: string | null;
	screenKey: string | null;
	diagnostics: FeedbackDiagnostics | null;
	attachmentIds: string[];
};
