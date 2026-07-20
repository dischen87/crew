import type { PageSlice } from "./domain";
import type { FeedbackStatus } from "./feedback-domain";

export type CommunityFeedbackStatus = Exclude<FeedbackStatus, "duplicate">;

export type CommunityFeedbackSummary = {
	id: string;
	title: string;
	body: string;
	status: CommunityFeedbackStatus;
	version: number;
	voteCount: number;
	duplicateCount: number;
	viewerHasVoted: boolean;
	followed: boolean;
	createdAt: Date;
	updatedAt: Date;
};

export type CommunityFeedbackComment = {
	id: string;
	body: string;
	createdAt: Date;
};

export type CommunityFeedbackStatusChange = {
	version: number;
	fromStatus: FeedbackStatus | null;
	toStatus: FeedbackStatus;
	note: string | null;
	changedAt: Date;
};

export type CommunityFeedbackDetail = CommunityFeedbackSummary & {
	comments: CommunityFeedbackComment[];
	commentCount: number;
	commentsHasMore: boolean;
	statusHistory: CommunityFeedbackStatusChange[];
	statusHistoryCount: number;
	statusHistoryHasMore: boolean;
};

export type CommunityFeedbackResolution = {
	feedback: CommunityFeedbackDetail;
	redirectedFromFeedbackId: string | null;
};

export type CommunityFeedbackFollow = {
	feedbackId: string;
	followed: boolean;
};

export type CommunityFeedbackUpdate = {
	feedbackId: string;
	title: string;
	version: number;
	fromStatus: FeedbackStatus;
	toStatus: FeedbackStatus;
	note: string | null;
	changedAt: Date;
};

export type CommunityFeedbackListItem = CommunityFeedbackSummary & {
	cursorUpdatedAt: string;
};

export type CommunityFeedbackUpdateItem = CommunityFeedbackUpdate & {
	cursorChangedAt: string;
};

export type CommunityFeedbackPageKey = { updatedAt: string; id: string };
export type CommunityFeedbackUpdatePageKey = {
	changedAt: string;
	feedbackId: string;
	version: number;
};

export type CommunityFeedbackDuplicateSuggestion = {
	id: string;
	title: string;
	status: CommunityFeedbackStatus;
	voteCount: number;
};

export type CommunityFeedbackDuplicateSuggestionItem =
	CommunityFeedbackDuplicateSuggestion & {
		cursorRank: number;
		cursorUpdatedAt: string;
	};

export type CommunityFeedbackDuplicateSuggestionPageKey = {
	rank: number;
	updatedAt: string;
	id: string;
};

export type CommunityFeedbackPage = PageSlice<CommunityFeedbackListItem>;
export type CommunityFeedbackUpdatePage =
	PageSlice<CommunityFeedbackUpdateItem>;
export type CommunityFeedbackDuplicateSuggestionPage =
	PageSlice<CommunityFeedbackDuplicateSuggestionItem>;

const DUPLICATE_SEARCH_TOKEN_LIMIT = 12;

export function normalizeCommunityFeedbackSearch(value: string) {
	const query = value
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
		.trim()
		.replace(/\s+/gu, " ");
	const tokens = [...new Set(query.split(" ").filter(Boolean))].slice(
		0,
		DUPLICATE_SEARCH_TOKEN_LIMIT,
	);
	return { query, tokens };
}
