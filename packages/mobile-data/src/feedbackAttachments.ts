import type { SqlDatabase, SqlExecutor } from "./database.ts";

export type FeedbackScreenshotState =
	| "retained"
	| "consented"
	| "prepared"
	| "uploaded"
	| "committed"
	| "attention"
	| "omitted";

export type FeedbackScreenshotFailure =
	| "attachment_missing"
	| "attachment_storage"
	| "attachment_unavailable"
	| "attachment_unsafe"
	| "auth_required"
	| "denied"
	| "invalid"
	| "invalid_response"
	| "network"
	| "rate_limited"
	| "retry_exhausted"
	| "service_unavailable"
	| "unknown"
	| "upload_expired"
	| "verification_pending";

export interface RetainedFeedbackScreenshot {
	accountUserId: string;
	feedbackId: string;
	rootEventId: string;
	attachmentId: string;
	retainedFileKey: string;
	contentType: "image/png";
	byteCount: number;
	sha256: string;
	pixelWidth: number;
	pixelHeight: number;
	wasNormalized: true;
	retainedAt: string;
}

export interface FeedbackScreenshotReceipt extends RetainedFeedbackScreenshot {
	state: FeedbackScreenshotState;
	attempts: number;
	failure: FeedbackScreenshotFailure | null;
	consentedAt: string | null;
	committedAt: string | null;
	omittedAt: string | null;
	feedbackSendStartedAt: string | null;
	updatedAt: string;
}

export interface FeedbackScreenshotRow {
	account_user_id: string;
	feedback_id: string;
	root_event_id: string;
	attachment_id: string;
	retained_file_key: string;
	content_type: "image/png";
	byte_count: number;
	sha256: string;
	pixel_width: number;
	pixel_height: number;
	was_normalized: number;
	state: FeedbackScreenshotState;
	upload_generation: number;
	upload_id: string | null;
	attempts: number;
	last_error_code: FeedbackScreenshotFailure | null;
	retained_at: string;
	consented_at: string | null;
	committed_at: string | null;
	omitted_at: string | null;
	feedback_send_started_at: string | null;
	created_at: string;
	updated_at: string;
}

const accountPattern = /^usr_[a-f0-9]{32}$/;
const feedbackPattern = /^fbk_[A-Za-z0-9._:-]{1,96}$/;
const attachmentPattern = /^att_[A-Za-z0-9._:-]{1,96}$/;
const rootPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const digestPattern = /^[a-f0-9]{64}$/;

export class FeedbackScreenshotStore {
	constructor(private readonly database: SqlDatabase) {}

	async retain(
		screenshot: RetainedFeedbackScreenshot,
	): Promise<FeedbackScreenshotReceipt> {
		validateScreenshot(screenshot);
		return this.database.transaction(async (transaction) => {
			const existing = await selectFeedbackScreenshot(
				transaction,
				screenshot.accountUserId,
				screenshot.feedbackId,
			);
			if (existing) {
				if (!sameIdentity(existing, screenshot)) {
					throw new Error(
						"Feedback screenshot identity already has different retained bytes",
					);
				}
				return feedbackScreenshotReceipt(existing);
			}
			const submitted = await transaction.first<{ present: number }>(
				`SELECT 1 AS present FROM feedback_submissions
WHERE account_user_id = ? AND feedback_id = ?`,
				[screenshot.accountUserId, screenshot.feedbackId],
			);
			if (submitted) {
				throw new Error("Feedback identity is already submitted");
			}
			await transaction.run(
				`INSERT INTO feedback_screenshot_attachments (
  account_user_id, feedback_id, root_event_id, attachment_id,
  retained_file_key, content_type, byte_count, sha256, pixel_width,
  pixel_height, was_normalized, state, retained_at, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'retained', ?, ?, ?)`,
				[
					screenshot.accountUserId,
					screenshot.feedbackId,
					screenshot.rootEventId,
					screenshot.attachmentId,
					screenshot.retainedFileKey,
					screenshot.contentType,
					screenshot.byteCount,
					screenshot.sha256,
					screenshot.pixelWidth,
					screenshot.pixelHeight,
					screenshot.retainedAt,
					screenshot.retainedAt,
					screenshot.retainedAt,
				],
			);
			return feedbackScreenshotReceipt({
				account_user_id: screenshot.accountUserId,
				feedback_id: screenshot.feedbackId,
				root_event_id: screenshot.rootEventId,
				attachment_id: screenshot.attachmentId,
				retained_file_key: screenshot.retainedFileKey,
				content_type: screenshot.contentType,
				byte_count: screenshot.byteCount,
				sha256: screenshot.sha256,
				pixel_width: screenshot.pixelWidth,
				pixel_height: screenshot.pixelHeight,
				was_normalized: 1,
				state: "retained",
				upload_generation: 1,
				upload_id: null,
				attempts: 0,
				last_error_code: null,
				retained_at: screenshot.retainedAt,
				consented_at: null,
				committed_at: null,
				omitted_at: null,
				feedback_send_started_at: null,
				created_at: screenshot.retainedAt,
				updated_at: screenshot.retainedAt,
			});
		});
	}

	async get(
		accountUserId: string,
		feedbackId: string,
	): Promise<FeedbackScreenshotReceipt | null> {
		validateAccountId(accountUserId);
		validateFeedbackId(feedbackId);
		const row = await selectFeedbackScreenshot(
			this.database,
			accountUserId,
			feedbackId,
		);
		return row ? feedbackScreenshotReceipt(row) : null;
	}

	async discard(accountUserId: string, feedbackId: string): Promise<boolean> {
		validateAccountId(accountUserId);
		validateFeedbackId(feedbackId);
		return this.database.transaction(async (transaction) => {
			const row = await selectFeedbackScreenshot(
				transaction,
				accountUserId,
				feedbackId,
			);
			if (!row) return false;
			const submitted = await transaction.first<{ present: number }>(
				`SELECT 1 AS present FROM feedback_submissions
WHERE account_user_id = ? AND feedback_id = ?`,
				[accountUserId, feedbackId],
			);
			if (submitted || !["retained", "consented"].includes(row.state)) {
				throw new Error("Feedback screenshot can no longer be discarded");
			}
			await transaction.run(
				`DELETE FROM feedback_screenshot_attachments
WHERE account_user_id = ? AND feedback_id = ?`,
				[accountUserId, feedbackId],
			);
			return true;
		});
	}

	async listRetainedFileKeys(
		accountUserId: string,
	): Promise<readonly string[]> {
		validateAccountId(accountUserId);
		const rows = await this.database.all<{ retained_file_key: string }>(
			`SELECT DISTINCT retained_file_key
FROM feedback_screenshot_attachments
WHERE account_user_id = ? AND state NOT IN ('committed', 'omitted')
ORDER BY retained_file_key`,
			[accountUserId],
		);
		return rows.map(({ retained_file_key }) => retained_file_key);
	}
}

export async function listFeedbackScreenshotFileKeysForPurge(
	database: SqlExecutor,
	accountUserId: string,
): Promise<readonly string[]> {
	validateAccountId(accountUserId);
	const rows = await database.all<{ retained_file_key: string }>(
		`SELECT DISTINCT retained_file_key
FROM feedback_screenshot_attachments
WHERE account_user_id = ?
ORDER BY retained_file_key`,
		[accountUserId],
	);
	return rows.map(({ retained_file_key }) => retained_file_key);
}

export async function purgeFeedbackScreenshots(
	database: SqlExecutor,
	accountUserId: string,
): Promise<void> {
	validateAccountId(accountUserId);
	await database.run(
		"DELETE FROM feedback_screenshot_attachments WHERE account_user_id = ?",
		[accountUserId],
	);
}

export async function selectFeedbackScreenshot(
	database: SqlExecutor,
	accountUserId: string,
	feedbackId: string,
): Promise<FeedbackScreenshotRow | null> {
	return database.first<FeedbackScreenshotRow>(
		`SELECT * FROM feedback_screenshot_attachments
WHERE account_user_id = ? AND feedback_id = ?`,
		[accountUserId, feedbackId],
	);
}

export function feedbackScreenshotReceipt(
	row: FeedbackScreenshotRow,
): FeedbackScreenshotReceipt {
	if (Number(row.was_normalized) !== 1) {
		throw new Error("Persisted feedback screenshot is not normalized");
	}
	return {
		accountUserId: row.account_user_id,
		feedbackId: row.feedback_id,
		rootEventId: row.root_event_id,
		attachmentId: row.attachment_id,
		retainedFileKey: row.retained_file_key,
		contentType: row.content_type,
		byteCount: Number(row.byte_count),
		sha256: row.sha256,
		pixelWidth: Number(row.pixel_width),
		pixelHeight: Number(row.pixel_height),
		wasNormalized: true,
		retainedAt: row.retained_at,
		state: row.state,
		attempts: Number(row.attempts),
		failure: row.last_error_code,
		consentedAt: row.consented_at,
		committedAt: row.committed_at,
		omittedAt: row.omitted_at,
		feedbackSendStartedAt: row.feedback_send_started_at,
		updatedAt: row.updated_at,
	};
}

export function validateAttachmentId(value: string): void {
	if (!attachmentPattern.test(value)) {
		throw new TypeError("Invalid feedback screenshot attachment ID");
	}
}

function validateAccountId(value: string): void {
	if (!accountPattern.test(value)) throw new TypeError("Invalid account ID");
}

function validateFeedbackId(value: string): void {
	if (!feedbackPattern.test(value)) throw new TypeError("Invalid feedback ID");
}

function validateScreenshot(screenshot: RetainedFeedbackScreenshot): void {
	validateAccountId(screenshot.accountUserId);
	validateFeedbackId(screenshot.feedbackId);
	validateAttachmentId(screenshot.attachmentId);
	if (!rootPattern.test(screenshot.rootEventId)) {
		throw new TypeError("Invalid feedback screenshot root ID");
	}
	if (screenshot.contentType !== "image/png") {
		throw new TypeError("Feedback screenshots must be PNG images");
	}
	if (!digestPattern.test(screenshot.sha256)) {
		throw new TypeError("Invalid feedback screenshot SHA-256");
	}
	if (screenshot.retainedFileKey !== `${screenshot.sha256}.png`) {
		throw new TypeError("Invalid feedback screenshot file identity");
	}
	if (
		!Number.isSafeInteger(screenshot.byteCount) ||
		screenshot.byteCount < 1 ||
		screenshot.byteCount > 20 * 1024 * 1024
	) {
		throw new TypeError("Invalid feedback screenshot byte count");
	}
	for (const size of [screenshot.pixelWidth, screenshot.pixelHeight]) {
		if (!Number.isSafeInteger(size) || size < 1 || size > 2048) {
			throw new TypeError("Invalid feedback screenshot dimensions");
		}
	}
	if (screenshot.wasNormalized !== true) {
		throw new TypeError("Feedback screenshot must be normalized");
	}
	if (!Number.isFinite(Date.parse(screenshot.retainedAt))) {
		throw new TypeError("Invalid feedback screenshot retention time");
	}
}

function sameIdentity(
	row: FeedbackScreenshotRow,
	screenshot: RetainedFeedbackScreenshot,
): boolean {
	return (
		row.account_user_id === screenshot.accountUserId &&
		row.feedback_id === screenshot.feedbackId &&
		row.root_event_id === screenshot.rootEventId &&
		row.attachment_id === screenshot.attachmentId &&
		row.retained_file_key === screenshot.retainedFileKey &&
		row.content_type === screenshot.contentType &&
		Number(row.byte_count) === screenshot.byteCount &&
		row.sha256 === screenshot.sha256 &&
		Number(row.pixel_width) === screenshot.pixelWidth &&
		Number(row.pixel_height) === screenshot.pixelHeight &&
		Number(row.was_normalized) === 1 &&
		row.retained_at === screenshot.retainedAt
	);
}
