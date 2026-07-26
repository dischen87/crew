import {
	type GatewayClient,
	GatewayClientError,
	type GatewayRequest,
	type GatewayResponseData,
	type GatewaySessionSubject,
} from "@crew/mobile-client";
import type { SqlDatabase, SqlExecutor } from "./database.ts";
import {
	type FeedbackScreenshotFailure,
	type FeedbackScreenshotRow,
	type FeedbackScreenshotState,
	selectFeedbackScreenshot,
	validateAttachmentId,
} from "./feedbackAttachments.ts";
import { sha256Hex } from "./sha256.ts";

type FeedbackCreateCommand = GatewayRequest<"feedbackCreate">["body"];
type GeneratedDiagnostics = NonNullable<FeedbackCreateCommand["diagnostics"]>;
type AttachmentPrepareData =
	GatewayResponseData<"eventAttachmentUploadsPrepare">;
type AttachmentFinalizeData =
	GatewayResponseData<"eventAttachmentUploadsFinalize">;
type AttachmentUploadGrant = AttachmentPrepareData["grant"];

export type FeedbackSubmissionDiagnostics = Pick<
	GeneratedDiagnostics,
	"appVersion" | "buildNumber" | "locale" | "osVersion" | "platform"
>;

export interface FeedbackSubmissionInput {
	id: FeedbackCreateCommand["id"];
	title: FeedbackCreateCommand["title"];
	body: FeedbackCreateCommand["body"];
	visibility: FeedbackCreateCommand["visibility"];
	rootEventId?: string | null;
	eventId?: string | null;
	screenKey?: string | null;
	diagnostics?: FeedbackSubmissionDiagnostics | null;
	attachmentId?: string | null;
}

export type FeedbackAttachmentUploadFailure =
	| "missing_file"
	| "storage"
	| "unavailable"
	| "unsafe";

export interface FeedbackAttachmentUploadInput {
	accountUserId: string;
	attachmentId: string;
	retainedFileKey: string;
	contentType: "image/png";
	byteCount: number;
	sha256: string;
	grant: Readonly<AttachmentUploadGrant>;
}

export interface FeedbackAttachmentUploadTransport {
	upload(input: FeedbackAttachmentUploadInput): Promise<void>;
}

export class FeedbackAttachmentUploadError extends Error {
	constructor(
		readonly failure: FeedbackAttachmentUploadFailure,
		readonly retryable = false,
	) {
		super(`Feedback screenshot upload failed: ${failure}`);
		this.name = "FeedbackAttachmentUploadError";
	}
}

export type FeedbackSubmissionState =
	| "pending"
	| "sending"
	| "attention"
	| "delivered";

export type FeedbackSubmissionFailure =
	| "auth_required"
	| "denied"
	| "invalid"
	| "invalid_response"
	| "network"
	| "rate_limited"
	| "retry_exhausted"
	| "service_unavailable"
	| "unknown";

export interface FeedbackSubmissionReceipt {
	accountUserId: string;
	feedbackId: string;
	state: FeedbackSubmissionState;
	attempts: number;
	failure: FeedbackSubmissionFailure | null;
	nextAttemptAt: string | null;
	createdAt: string;
	updatedAt: string;
	deliveredAt: string | null;
}

export interface FeedbackSubmissionEvidenceRow {
	state: FeedbackSubmissionState;
	screenshotState: FeedbackScreenshotState | null;
	submissionFingerprint: string;
	idempotencyFingerprint: string;
	screenshotFingerprint: string | null;
	commandFingerprintMatches: boolean | null;
	screenshotBindingMatches: boolean;
	screenshotMetadataMatches: boolean | null;
}

export interface FeedbackSubmissionEvidence {
	pendingCount: number;
	sendingCount: number;
	attentionCount: number;
	deliveredCount: number;
	truncated: boolean;
	rows: readonly FeedbackSubmissionEvidenceRow[];
}

export interface FeedbackSubmissionControllerOptions {
	activeAccountUserId: () => string | null | Promise<string | null>;
	attachmentUploadTransport?: FeedbackAttachmentUploadTransport | null;
	now?: () => Date;
	randomUUID?: () => string;
	sha256?: (value: string) => Promise<string>;
}

type FeedbackGatewayClient = Pick<
	GatewayClient,
	"assertSessionSubject" | "requestAsUser" | "sessionSubject"
>;

interface FeedbackSubmissionRow {
	account_user_id: string;
	feedback_id: string;
	screenshot_attachment_id: string | null;
	root_event_id: string | null;
	command_json: string | null;
	command_fingerprint: string;
	idempotency_key: string;
	state: FeedbackSubmissionState;
	attempts: number;
	next_attempt_at: string | null;
	lease_owner: string | null;
	lease_expires_at: string | null;
	last_error_code: FeedbackSubmissionFailure | null;
	created_at: string;
	updated_at: string;
	delivered_at: string | null;
}

interface FeedbackSubmissionEvidenceSourceRow {
	state: FeedbackSubmissionState;
	command_json: string | null;
	command_fingerprint: string;
	idempotency_key: string;
	screenshot_attachment_id: string | null;
	screenshot_feedback_id: string | null;
	screenshot_retained_file_key: string | null;
	screenshot_content_type: string | null;
	screenshot_byte_count: number | null;
	screenshot_sha256: string | null;
	screenshot_was_normalized: number | null;
	screenshot_state: FeedbackScreenshotState | null;
}

interface DeliveryFailure {
	code: FeedbackSubmissionFailure;
	retryAfterSeconds: number | null;
	retryable: boolean;
}

const accountPattern = /^usr_[a-f0-9]{32}$/;
const feedbackPattern = /^fbk_[A-Za-z0-9._:-]{1,96}$/;
const eventPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const screenPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const appVersionPattern = /^\d+(?:\.\d+){0,3}(?:[-+][A-Za-z0-9.-]{1,32}){0,2}$/;
const buildNumberPattern = /^\d+(?:\.\d+){0,3}$/;
const localePattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
const osVersionPattern = /^\d+(?:\.\d+){0,4}(?:-[A-Za-z0-9._-]{1,24})?$/;
const LEASE_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 20;
const MAX_RETRY_MS = 15 * 60 * 1000;
const MAX_RETRY_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FEEDBACK_EVIDENCE_ROWS = 100;
const EVIDENCE_COMMAND_DOMAIN = "crew.feedback.command.evidence.v1";
const EVIDENCE_IDEMPOTENCY_DOMAIN = "crew.feedback.idempotency.evidence.v1";
const EVIDENCE_SCREENSHOT_DOMAIN = "crew.feedback.screenshot.evidence.v1";
const feedbackEvidenceStates = new Set<FeedbackSubmissionState>([
	"pending",
	"sending",
	"attention",
	"delivered",
]);
const feedbackScreenshotEvidenceStates = new Set<FeedbackScreenshotState>([
	"retained",
	"consented",
	"prepared",
	"uploaded",
	"committed",
	"attention",
	"omitted",
]);

const flightsByDatabase = new WeakMap<
	SqlDatabase,
	Map<string, Promise<readonly FeedbackSubmissionReceipt[]>>
>();

export class FeedbackSubmissionAccountChangedError extends Error {
	constructor() {
		super("Active account changed during feedback delivery");
		this.name = "FeedbackSubmissionAccountChangedError";
	}
}

export class FeedbackSubmissionAuthenticationError extends Error {
	constructor() {
		super("Feedback delivery requires authentication");
		this.name = "FeedbackSubmissionAuthenticationError";
	}
}

class FeedbackSubmissionInvalidResponseError extends Error {}
class FeedbackAttachmentVerificationPendingError extends Error {}
class FeedbackAttachmentUploadExpiredError extends Error {}
class FeedbackSubmissionLeaseLostError extends Error {}

export class FeedbackSubmissionController {
	readonly #activeAccountUserId: FeedbackSubmissionControllerOptions["activeAccountUserId"];
	readonly #attachmentUploadTransport: FeedbackAttachmentUploadTransport | null;
	readonly #now: () => Date;
	readonly #randomUUID: () => string;
	readonly #sha256: (value: string) => Promise<string>;
	readonly #flights: Map<string, Promise<readonly FeedbackSubmissionReceipt[]>>;

	constructor(
		private readonly database: SqlDatabase,
		private readonly client: FeedbackGatewayClient | null,
		options: FeedbackSubmissionControllerOptions,
	) {
		this.#activeAccountUserId = options.activeAccountUserId;
		this.#attachmentUploadTransport = options.attachmentUploadTransport ?? null;
		this.#now = options.now ?? (() => new Date());
		this.#randomUUID = options.randomUUID ?? secureUuid;
		const digest = options.sha256 ?? sha256Hex;
		this.#sha256 = async (value) => {
			const result = await digest(value);
			if (!/^[a-f0-9]{64}$/.test(result)) {
				throw new Error("SHA-256 provider returned an invalid digest");
			}
			return result;
		};
		let flights = flightsByDatabase.get(database);
		if (!flights) {
			flights = new Map();
			flightsByDatabase.set(database, flights);
		}
		this.#flights = flights;
	}

	async enqueue(
		accountUserId: string,
		input: FeedbackSubmissionInput,
	): Promise<FeedbackSubmissionReceipt> {
		validateAccount(accountUserId);
		await this.#assertActive(accountUserId);
		const attachmentId = input.attachmentId ?? null;
		if (attachmentId !== null) validateAttachmentId(attachmentId);
		const command = canonicalCommand(input);
		const commandJson = JSON.stringify(command);
		const commandFingerprint = await this.#sha256(commandJson);
		await this.database.transaction(async (transaction) => {
			await this.#assertActive(accountUserId);
			const screenshot = await selectFeedbackScreenshot(
				transaction,
				accountUserId,
				command.id,
			);
			assertScreenshotSelection(
				screenshot,
				attachmentId,
				command.rootEventId ?? null,
			);
			const existing = await transaction.first<FeedbackSubmissionRow>(
				`SELECT * FROM feedback_submissions
WHERE account_user_id = ? AND feedback_id = ?`,
				[accountUserId, command.id],
			);
			if (existing) {
				if (existing.screenshot_attachment_id !== attachmentId) {
					throw new TypeError(
						"Feedback identity is already bound to a different screenshot choice",
					);
				}
				if (
					existing.command_fingerprint !== commandFingerprint ||
					(existing.command_json !== null &&
						existing.command_json !== commandJson)
				) {
					throw new TypeError(
						"Feedback identity is already bound to different content",
					);
				}
				return;
			}
			const timestamp = this.#timestamp();
			if (screenshot?.state === "retained") {
				await transaction.run(
					`UPDATE feedback_screenshot_attachments SET
  state = 'consented', consented_at = ?, updated_at = ?
WHERE account_user_id = ? AND feedback_id = ? AND state = 'retained'`,
					[timestamp, timestamp, accountUserId, command.id],
				);
			}
			await transaction.run(
				`INSERT INTO feedback_submissions (
  account_user_id, feedback_id, command_json, command_fingerprint,
  idempotency_key, screenshot_attachment_id, root_event_id, state,
  created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
				[
					accountUserId,
					command.id,
					commandJson,
					commandFingerprint,
					`feedback-${command.id}`,
					attachmentId,
					command.rootEventId ?? null,
					timestamp,
					timestamp,
				],
			);
			await this.#assertActive(accountUserId);
		});
		return this.#required(accountUserId, command.id);
	}

	async submit(
		accountUserId: string,
		input: FeedbackSubmissionInput,
	): Promise<FeedbackSubmissionReceipt> {
		const receipt = await this.enqueue(accountUserId, input);
		if (this.client) {
			Promise.resolve()
				.then(() => this.drain(accountUserId))
				.catch(() => undefined);
		}
		return receipt;
	}

	async get(
		accountUserId: string,
		feedbackId: string,
	): Promise<FeedbackSubmissionReceipt | null> {
		validateAccount(accountUserId);
		validateFeedback(feedbackId);
		await this.#assertActive(accountUserId);
		const row = await this.database.first<FeedbackSubmissionRow>(
			`SELECT * FROM feedback_submissions
WHERE account_user_id = ? AND feedback_id = ?`,
			[accountUserId, feedbackId],
		);
		await this.#assertActive(accountUserId);
		return row ? receipt(row) : null;
	}

	async list(
		accountUserId: string,
	): Promise<readonly FeedbackSubmissionReceipt[]> {
		validateAccount(accountUserId);
		await this.#assertActive(accountUserId);
		const rows = await this.database.all<FeedbackSubmissionRow>(
			`SELECT * FROM feedback_submissions
WHERE account_user_id = ?
ORDER BY created_at DESC, feedback_id DESC`,
			[accountUserId],
		);
		await this.#assertActive(accountUserId);
		return rows.map(receipt);
	}

	async readEvidence(
		accountUserId: string,
		rootEventId: string,
	): Promise<FeedbackSubmissionEvidence> {
		validateAccount(accountUserId);
		if (!eventPattern.test(rootEventId)) {
			throw new TypeError("Invalid feedback root event ID");
		}
		await this.#assertActive(accountUserId);
		const { counts, sourceRows } = await this.database.transaction(
			async (transaction) => {
				const counts = await transaction.first<{
					pending_count: number;
					sending_count: number;
					attention_count: number;
					delivered_count: number;
				}>(
					`SELECT
  COALESCE(SUM(CASE WHEN state = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
  COALESCE(SUM(CASE WHEN state = 'sending' THEN 1 ELSE 0 END), 0) AS sending_count,
  COALESCE(SUM(CASE WHEN state = 'attention' THEN 1 ELSE 0 END), 0) AS attention_count,
  COALESCE(SUM(CASE WHEN state = 'delivered' THEN 1 ELSE 0 END), 0) AS delivered_count
FROM feedback_submissions
WHERE account_user_id = ? AND root_event_id = ?`,
					[accountUserId, rootEventId],
				);
				const sourceRows =
					await transaction.all<FeedbackSubmissionEvidenceSourceRow>(
						`SELECT
  submission.state,
  submission.command_json,
  submission.command_fingerprint,
  submission.idempotency_key,
  submission.screenshot_attachment_id,
  screenshot.feedback_id AS screenshot_feedback_id,
  screenshot.retained_file_key AS screenshot_retained_file_key,
  screenshot.content_type AS screenshot_content_type,
  screenshot.byte_count AS screenshot_byte_count,
  screenshot.sha256 AS screenshot_sha256,
  screenshot.was_normalized AS screenshot_was_normalized,
  screenshot.state AS screenshot_state
FROM feedback_submissions submission
LEFT JOIN feedback_screenshot_attachments screenshot
  ON screenshot.account_user_id = submission.account_user_id
 AND screenshot.feedback_id = submission.feedback_id
 AND screenshot.root_event_id = submission.root_event_id
 AND screenshot.attachment_id = submission.screenshot_attachment_id
WHERE submission.account_user_id = ? AND submission.root_event_id = ?
ORDER BY
  CASE submission.state
    WHEN 'attention' THEN 0
    WHEN 'sending' THEN 1
    WHEN 'pending' THEN 2
    ELSE 3
  END,
  submission.created_at DESC,
  submission.feedback_id DESC
LIMIT ?`,
						[accountUserId, rootEventId, MAX_FEEDBACK_EVIDENCE_ROWS + 1],
					);
				return { counts, sourceRows };
			},
		);
		const rows = await Promise.all(
			sourceRows.slice(0, MAX_FEEDBACK_EVIDENCE_ROWS).map(async (row) => {
				validateFeedbackEvidenceRow(row);
				const screenshotFingerprint =
					row.screenshot_sha256 === null
						? null
						: await this.#evidenceFingerprint(
								EVIDENCE_SCREENSHOT_DOMAIN,
								`${row.screenshot_content_type}\u0000${row.screenshot_byte_count}\u0000${row.screenshot_sha256}`,
							);
				const screenshotPresent = row.screenshot_feedback_id !== null;
				return {
					state: row.state,
					screenshotState: row.screenshot_state,
					submissionFingerprint: await this.#evidenceFingerprint(
						EVIDENCE_COMMAND_DOMAIN,
						row.command_fingerprint,
					),
					idempotencyFingerprint: await this.#evidenceFingerprint(
						EVIDENCE_IDEMPOTENCY_DOMAIN,
						row.idempotency_key,
					),
					screenshotFingerprint,
					commandFingerprintMatches:
						row.command_json === null
							? null
							: (await this.#sha256(row.command_json)) ===
								row.command_fingerprint,
					screenshotBindingMatches:
						row.screenshot_attachment_id === null || screenshotPresent,
					screenshotMetadataMatches:
						row.screenshot_sha256 === null
							? null
							: row.screenshot_retained_file_key ===
									`${row.screenshot_sha256}.png` &&
								row.screenshot_content_type === "image/png" &&
								row.screenshot_was_normalized === 1,
				} satisfies FeedbackSubmissionEvidenceRow;
			}),
		);
		await this.#assertActive(accountUserId);
		return {
			pendingCount: feedbackEvidenceCount(counts?.pending_count),
			sendingCount: feedbackEvidenceCount(counts?.sending_count),
			attentionCount: feedbackEvidenceCount(counts?.attention_count),
			deliveredCount: feedbackEvidenceCount(counts?.delivered_count),
			truncated: sourceRows.length > MAX_FEEDBACK_EVIDENCE_ROWS,
			rows,
		};
	}

	async resumeAndDrain(
		accountUserId: string,
	): Promise<readonly FeedbackSubmissionReceipt[]> {
		validateAccount(accountUserId);
		await this.database.transaction(async (transaction) => {
			await this.#assertActive(accountUserId);
			await transaction.run(
				`UPDATE feedback_submissions SET
  state = CASE WHEN state = 'attention' THEN 'pending' ELSE state END,
  next_attempt_at = NULL, last_error_code = NULL, updated_at = ?
WHERE account_user_id = ? AND (
  (state = 'attention' AND last_error_code = 'auth_required') OR
  (state = 'pending' AND last_error_code IN (
    'network', 'service_unavailable', 'unknown'
  ))
)`,
				[this.#timestamp(), accountUserId],
			);
			await transaction.run(
				`UPDATE feedback_screenshot_attachments SET
  last_error_code = NULL, updated_at = ?
WHERE account_user_id = ? AND last_error_code = 'auth_required'`,
				[this.#timestamp(), accountUserId],
			);
			await this.#assertActive(accountUserId);
		});
		return this.drain(accountUserId);
	}

	async sendWithoutScreenshot(
		accountUserId: string,
		feedbackId: string,
	): Promise<FeedbackSubmissionReceipt> {
		validateAccount(accountUserId);
		validateFeedback(feedbackId);
		await this.database.transaction(async (transaction) => {
			await this.#assertActive(accountUserId);
			const submission = await transaction.first<FeedbackSubmissionRow>(
				`SELECT * FROM feedback_submissions
WHERE account_user_id = ? AND feedback_id = ?`,
				[accountUserId, feedbackId],
			);
			const screenshot = await selectFeedbackScreenshot(
				transaction,
				accountUserId,
				feedbackId,
			);
			if (!submission || !screenshot) {
				throw new Error("Feedback screenshot submission was not found");
			}
			if (
				submission.state === "delivered" ||
				submission.state === "sending" ||
				screenshot.feedback_send_started_at !== null
			) {
				throw new Error("Feedback screenshot choice can no longer change");
			}
			if (screenshot.state === "retained") {
				throw new Error("Feedback screenshot was not consented");
			}
			const timestamp = this.#timestamp();
			if (screenshot.state !== "omitted") {
				await transaction.run(
					`UPDATE feedback_screenshot_attachments SET
  state = 'omitted', upload_id = NULL, last_error_code = NULL,
  committed_at = NULL, omitted_at = ?, updated_at = ?
WHERE account_user_id = ? AND feedback_id = ?
  AND feedback_send_started_at IS NULL`,
					[timestamp, timestamp, accountUserId, feedbackId],
				);
			}
			await transaction.run(
				`UPDATE feedback_submissions SET state = 'pending',
  next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
  last_error_code = NULL, updated_at = ?
WHERE account_user_id = ? AND feedback_id = ? AND state IN ('pending', 'attention')`,
				[timestamp, accountUserId, feedbackId],
			);
			await this.#assertActive(accountUserId);
		});
		return this.#required(accountUserId, feedbackId);
	}

	async drain(
		accountUserId: string,
	): Promise<readonly FeedbackSubmissionReceipt[]> {
		validateAccount(accountUserId);
		await this.#assertActive(accountUserId);
		if (!this.client) return this.list(accountUserId);
		const active = this.#flights.get(accountUserId);
		if (active) return active;
		const flight = this.#runDrain(accountUserId);
		this.#flights.set(accountUserId, flight);
		try {
			return await flight;
		} finally {
			if (this.#flights.get(accountUserId) === flight) {
				this.#flights.delete(accountUserId);
			}
		}
	}

	async #runDrain(
		accountUserId: string,
	): Promise<readonly FeedbackSubmissionReceipt[]> {
		const client = this.client;
		if (!client) return this.list(accountUserId);
		const subject = await client.sessionSubject();
		await this.#assertActive(accountUserId);
		if (!subject) {
			await this.#markPendingAuthentication(accountUserId);
			throw new FeedbackSubmissionAuthenticationError();
		}
		if (subject.userId !== accountUserId) {
			throw new FeedbackSubmissionAccountChangedError();
		}
		try {
			await this.#assertSubject(client, subject);
		} catch (error) {
			if (error instanceof FeedbackSubmissionAuthenticationError) {
				await this.#markPendingAuthentication(accountUserId);
			}
			throw error;
		}
		await this.database.transaction(async (transaction) => {
			await this.#assertActive(accountUserId);
			await transaction.run(
				`UPDATE feedback_submissions SET state = 'pending',
  next_attempt_at = NULL, last_error_code = NULL, updated_at = ?
WHERE account_user_id = ? AND state = 'attention'
  AND last_error_code = 'auth_required'`,
				[this.#timestamp(), accountUserId],
			);
			await transaction.run(
				`UPDATE feedback_screenshot_attachments SET
  last_error_code = NULL, updated_at = ?
WHERE account_user_id = ? AND last_error_code = 'auth_required'`,
				[this.#timestamp(), accountUserId],
			);
			await this.#assertActive(accountUserId);
		});

		for (;;) {
			const row = await this.#claim(accountUserId);
			if (!row) break;
			let command: FeedbackCreateCommand;
			try {
				command = parseCommand(
					requiredCommand(row.command_json),
					row.feedback_id,
				);
			} catch {
				await this.#recordFailure(row, {
					code: "invalid",
					retryAfterSeconds: null,
					retryable: false,
				});
				continue;
			}
			try {
				await this.#assertActive(accountUserId);
				const screenshot = await this.#deliverScreenshot(client, subject, row);
				const deliveryCommand: FeedbackCreateCommand =
					screenshot?.state === "committed"
						? { ...command, attachmentIds: [screenshot.attachment_id] }
						: command;
				if (screenshot) await this.#freezeScreenshotChoice(row, screenshot);
				const response = await client.requestAsUser(subject, "feedbackCreate", {
					body: deliveryCommand,
					headers: { "idempotency-key": row.idempotency_key },
				});
				await this.#assertActive(accountUserId);
				await this.#assertSubject(client, subject);
				const returnedFeedbackId = (
					response as { data?: { feedback?: { id?: unknown } } }
				).data?.feedback?.id;
				if (returnedFeedbackId !== row.feedback_id) {
					throw new FeedbackSubmissionInvalidResponseError();
				}
				await this.#complete(row);
			} catch (error) {
				if (isAccountChange(error)) {
					throw new FeedbackSubmissionAccountChangedError();
				}
				if (error instanceof FeedbackSubmissionLeaseLostError) continue;
				await this.#assertActive(accountUserId);
				const failure = classifyFailure(error);
				await this.#recordFailure(
					row,
					failure,
					screenshotFailure(error, failure),
				);
				if (failure.code === "auth_required") {
					throw new FeedbackSubmissionAuthenticationError();
				}
			}
		}
		return this.list(accountUserId);
	}

	async #deliverScreenshot(
		client: FeedbackGatewayClient,
		subject: GatewaySessionSubject,
		submission: FeedbackSubmissionRow,
	): Promise<FeedbackScreenshotRow | null> {
		let screenshot = await selectFeedbackScreenshot(
			this.database,
			submission.account_user_id,
			submission.feedback_id,
		);
		await this.#assertActive(submission.account_user_id);
		if (!screenshot) {
			if (submission.screenshot_attachment_id !== null) {
				throw new FeedbackAttachmentUploadError("missing_file");
			}
			return null;
		}
		if (submission.screenshot_attachment_id !== screenshot.attachment_id) {
			throw new FeedbackSubmissionInvalidResponseError();
		}
		if (screenshot.state === "committed" || screenshot.state === "omitted") {
			return screenshot;
		}
		if (screenshot.state === "retained" || screenshot.state === "attention") {
			throw new FeedbackAttachmentUploadError("unavailable");
		}
		const transport = this.#attachmentUploadTransport;
		if (!transport) throw new FeedbackAttachmentUploadError("unavailable");

		if (screenshot.state === "consented" || screenshot.state === "prepared") {
			const response = await client.requestAsUser(
				subject,
				"eventAttachmentUploadsPrepare",
				{
					path: { rootEventId: screenshot.root_event_id },
					headers: {
						"idempotency-key": prepareIdempotencyKey(screenshot),
					},
					body: {
						attachmentId: screenshot.attachment_id,
						target: {
							kind: "feedback",
							feedbackId: screenshot.feedback_id,
						},
						contentType: screenshot.content_type,
						byteCount: screenshot.byte_count,
						sha256: screenshot.sha256,
					},
				},
			);
			await this.#assertActive(submission.account_user_id);
			await this.#assertSubject(client, subject);
			const prepared = validPreparedUpload(response.data, screenshot);
			screenshot = await this.#markScreenshotPrepared(
				submission,
				screenshot,
				prepared.uploadId,
			);
			if (Date.parse(prepared.grant.expiresAt) <= this.#now().getTime()) {
				await this.#finalizeScreenshot(client, subject, submission, screenshot);
				throw new FeedbackAttachmentUploadExpiredError();
			}
			await transport.upload({
				accountUserId: screenshot.account_user_id,
				attachmentId: screenshot.attachment_id,
				retainedFileKey: screenshot.retained_file_key,
				contentType: screenshot.content_type,
				byteCount: screenshot.byte_count,
				sha256: screenshot.sha256,
				grant: prepared.grant,
			});
			await this.#assertActive(submission.account_user_id);
			await this.#assertSubject(client, subject);
			screenshot = await this.#markScreenshotUploaded(submission, screenshot);
		}

		if (screenshot.state !== "uploaded") {
			throw new FeedbackSubmissionInvalidResponseError();
		}
		return this.#finalizeScreenshot(client, subject, submission, screenshot);
	}

	async #finalizeScreenshot(
		client: FeedbackGatewayClient,
		subject: GatewaySessionSubject,
		submission: FeedbackSubmissionRow,
		screenshot: FeedbackScreenshotRow,
	): Promise<FeedbackScreenshotRow> {
		const uploadId = screenshot.upload_id;
		if (!uploadId) throw new FeedbackSubmissionInvalidResponseError();
		try {
			const response = await client.requestAsUser(
				subject,
				"eventAttachmentUploadsFinalize",
				{
					path: { rootEventId: screenshot.root_event_id, uploadId },
					headers: {
						"idempotency-key": finalizeIdempotencyKey(screenshot),
					},
					body: { caption: null },
				},
			);
			await this.#assertActive(submission.account_user_id);
			await this.#assertSubject(client, subject);
			if (response.status === 202) {
				validPendingVerification(response.data, uploadId);
				throw new FeedbackAttachmentVerificationPendingError();
			}
			if (response.status !== 200) {
				throw new FeedbackSubmissionInvalidResponseError();
			}
			validCommittedAttachment(response.data, screenshot);
			return this.#markScreenshotCommitted(submission, screenshot);
		} catch (error) {
			if (
				error instanceof GatewayClientError &&
				error.code === "UPLOAD_EXPIRED"
			) {
				await this.#resetExpiredScreenshot(submission, screenshot);
				throw new FeedbackAttachmentUploadExpiredError();
			}
			throw error;
		}
	}

	async #markScreenshotPrepared(
		submission: FeedbackSubmissionRow,
		screenshot: FeedbackScreenshotRow,
		uploadId: string,
	): Promise<FeedbackScreenshotRow> {
		return this.database.transaction(async (transaction) => {
			await this.#assertActive(submission.account_user_id);
			await assertDeliveryLease(transaction, submission);
			const current = await requiredScreenshot(transaction, screenshot);
			if (
				current.upload_generation !== screenshot.upload_generation ||
				!["consented", "prepared"].includes(current.state) ||
				(current.upload_id !== null && current.upload_id !== uploadId)
			) {
				throw new FeedbackSubmissionLeaseLostError();
			}
			if (current.state === "consented") {
				await transaction.run(
					`UPDATE feedback_screenshot_attachments SET
  state = 'prepared', upload_id = ?, last_error_code = NULL, updated_at = ?
WHERE account_user_id = ? AND feedback_id = ?
  AND state = 'consented' AND upload_generation = ?`,
					[
						uploadId,
						this.#timestamp(),
						current.account_user_id,
						current.feedback_id,
						current.upload_generation,
					],
				);
			}
			await this.#assertActive(submission.account_user_id);
			return requiredScreenshot(transaction, {
				...current,
				state: "prepared",
				upload_id: uploadId,
			});
		});
	}

	async #markScreenshotUploaded(
		submission: FeedbackSubmissionRow,
		screenshot: FeedbackScreenshotRow,
	): Promise<FeedbackScreenshotRow> {
		return this.database.transaction(async (transaction) => {
			await this.#assertActive(submission.account_user_id);
			await assertDeliveryLease(transaction, submission);
			const current = await requiredScreenshot(transaction, screenshot);
			if (
				current.state !== "prepared" ||
				current.upload_id !== screenshot.upload_id ||
				current.upload_generation !== screenshot.upload_generation
			) {
				throw new FeedbackSubmissionLeaseLostError();
			}
			const timestamp = this.#timestamp();
			await transaction.run(
				`UPDATE feedback_screenshot_attachments SET
  state = 'uploaded', last_error_code = NULL, updated_at = ?
WHERE account_user_id = ? AND feedback_id = ?
  AND state = 'prepared' AND upload_id = ? AND upload_generation = ?`,
				[
					timestamp,
					current.account_user_id,
					current.feedback_id,
					current.upload_id,
					current.upload_generation,
				],
			);
			await this.#assertActive(submission.account_user_id);
			return requiredScreenshot(transaction, {
				...current,
				state: "uploaded",
			});
		});
	}

	async #markScreenshotCommitted(
		submission: FeedbackSubmissionRow,
		screenshot: FeedbackScreenshotRow,
	): Promise<FeedbackScreenshotRow> {
		return this.database.transaction(async (transaction) => {
			await this.#assertActive(submission.account_user_id);
			await assertDeliveryLease(transaction, submission);
			const current = await requiredScreenshot(transaction, screenshot);
			if (
				current.state !== "uploaded" ||
				current.upload_id !== screenshot.upload_id ||
				current.upload_generation !== screenshot.upload_generation
			) {
				throw new FeedbackSubmissionLeaseLostError();
			}
			const timestamp = this.#timestamp();
			await transaction.run(
				`UPDATE feedback_screenshot_attachments SET
  state = 'committed', committed_at = ?, last_error_code = NULL, updated_at = ?
WHERE account_user_id = ? AND feedback_id = ?
  AND state = 'uploaded' AND upload_id = ? AND upload_generation = ?`,
				[
					timestamp,
					timestamp,
					current.account_user_id,
					current.feedback_id,
					current.upload_id,
					current.upload_generation,
				],
			);
			await this.#assertActive(submission.account_user_id);
			return requiredScreenshot(transaction, {
				...current,
				state: "committed",
			});
		});
	}

	async #resetExpiredScreenshot(
		submission: FeedbackSubmissionRow,
		screenshot: FeedbackScreenshotRow,
	): Promise<void> {
		await this.database.transaction(async (transaction) => {
			await this.#assertActive(submission.account_user_id);
			await assertDeliveryLease(transaction, submission);
			const current = await requiredScreenshot(transaction, screenshot);
			if (current.upload_generation >= 20) {
				throw new FeedbackAttachmentUploadError("unavailable");
			}
			if (
				current.upload_generation !== screenshot.upload_generation ||
				current.upload_id !== screenshot.upload_id ||
				!["prepared", "uploaded"].includes(current.state)
			) {
				throw new FeedbackSubmissionLeaseLostError();
			}
			await transaction.run(
				`UPDATE feedback_screenshot_attachments SET
  state = 'consented', upload_generation = upload_generation + 1,
  upload_id = NULL, last_error_code = 'upload_expired', updated_at = ?
WHERE account_user_id = ? AND feedback_id = ?
  AND upload_generation = ? AND upload_id = ?`,
				[
					this.#timestamp(),
					current.account_user_id,
					current.feedback_id,
					current.upload_generation,
					current.upload_id,
				],
			);
			await this.#assertActive(submission.account_user_id);
		});
	}

	async #freezeScreenshotChoice(
		submission: FeedbackSubmissionRow,
		screenshot: FeedbackScreenshotRow,
	): Promise<void> {
		await this.database.transaction(async (transaction) => {
			await this.#assertActive(submission.account_user_id);
			await assertDeliveryLease(transaction, submission);
			const current = await requiredScreenshot(transaction, screenshot);
			if (
				current.state !== screenshot.state ||
				!["committed", "omitted"].includes(current.state)
			) {
				throw new FeedbackSubmissionLeaseLostError();
			}
			if (current.feedback_send_started_at === null) {
				await transaction.run(
					`UPDATE feedback_screenshot_attachments
SET feedback_send_started_at = ?, updated_at = ?
WHERE account_user_id = ? AND feedback_id = ?
  AND feedback_send_started_at IS NULL AND state = ?`,
					[
						this.#timestamp(),
						this.#timestamp(),
						current.account_user_id,
						current.feedback_id,
						current.state,
					],
				);
			}
			await this.#assertActive(submission.account_user_id);
		});
	}

	async #claim(accountUserId: string): Promise<FeedbackSubmissionRow | null> {
		const now = this.#timestamp();
		const leaseOwner = this.#randomUUID();
		const leaseExpiresAt = new Date(
			this.#now().getTime() + LEASE_MS,
		).toISOString();
		return this.database.transaction(async (transaction) => {
			await this.#assertActive(accountUserId);
			const row = await transaction.first<FeedbackSubmissionRow>(
				`SELECT * FROM feedback_submissions
WHERE account_user_id = ? AND (
  (state = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)) OR
  (state = 'sending' AND (lease_expires_at IS NULL OR lease_expires_at <= ?))
)
ORDER BY created_at, feedback_id
LIMIT 1`,
				[accountUserId, now, now],
			);
			if (!row) return null;
			await transaction.run(
				`UPDATE feedback_submissions SET state = 'sending',
  lease_owner = ?, lease_expires_at = ?, updated_at = ?
WHERE account_user_id = ? AND feedback_id = ?`,
				[leaseOwner, leaseExpiresAt, now, accountUserId, row.feedback_id],
			);
			await this.#assertActive(accountUserId);
			return {
				...row,
				state: "sending",
				lease_owner: leaseOwner,
				lease_expires_at: leaseExpiresAt,
				updated_at: now,
			};
		});
	}

	async #complete(row: FeedbackSubmissionRow): Promise<void> {
		const timestamp = this.#timestamp();
		await this.database.transaction(async (transaction) => {
			await this.#assertActive(row.account_user_id);
			await transaction.run(
				`UPDATE feedback_submissions SET state = 'delivered', attempts = ?,
  command_json = NULL,
  next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
  last_error_code = NULL, delivered_at = ?, updated_at = ?
WHERE account_user_id = ? AND feedback_id = ?
  AND state = 'sending' AND lease_owner = ?`,
				[
					Math.min(row.attempts + 1, MAX_ATTEMPTS),
					timestamp,
					timestamp,
					row.account_user_id,
					row.feedback_id,
					row.lease_owner,
				],
			);
			const completed = await transaction.first<{
				command_json: string | null;
				state: FeedbackSubmissionState;
			}>(
				`SELECT state, command_json FROM feedback_submissions
WHERE account_user_id = ? AND feedback_id = ?`,
				[row.account_user_id, row.feedback_id],
			);
			if (completed?.state !== "delivered" || completed.command_json !== null) {
				throw new Error("Feedback delivery lease was lost");
			}
			await this.#assertActive(row.account_user_id);
		});
	}

	async #recordFailure(
		row: FeedbackSubmissionRow,
		failure: DeliveryFailure,
		screenshotCode: FeedbackScreenshotFailure | null = null,
	): Promise<void> {
		const attempts = Math.min(row.attempts + 1, MAX_ATTEMPTS);
		const exhausted =
			attempts >= MAX_ATTEMPTS ||
			this.#now().getTime() - Date.parse(row.created_at) >= MAX_RETRY_AGE_MS;
		const retry = failure.retryable && !exhausted;
		const code = exhausted ? "retry_exhausted" : failure.code;
		const timestamp = this.#timestamp();
		await this.database.transaction(async (transaction) => {
			await this.#assertActive(row.account_user_id);
			await transaction.run(
				`UPDATE feedback_submissions SET state = ?, attempts = ?,
  next_attempt_at = ?, lease_owner = NULL, lease_expires_at = NULL,
  last_error_code = ?, updated_at = ?
WHERE account_user_id = ? AND feedback_id = ?
  AND state = 'sending' AND lease_owner = ?`,
				[
					retry ? "pending" : "attention",
					attempts,
					retry ? this.#retryAt(attempts, failure.retryAfterSeconds) : null,
					code,
					timestamp,
					row.account_user_id,
					row.feedback_id,
					row.lease_owner,
				],
			);
			if (screenshotCode) {
				const screenshot = await selectFeedbackScreenshot(
					transaction,
					row.account_user_id,
					row.feedback_id,
				);
				if (
					screenshot &&
					screenshot.state !== "committed" &&
					screenshot.state !== "omitted"
				) {
					await transaction.run(
						`UPDATE feedback_screenshot_attachments SET
  state = CASE WHEN ? = 1 THEN state ELSE 'attention' END,
  attempts = ?, last_error_code = ?, updated_at = ?
WHERE account_user_id = ? AND feedback_id = ?
  AND feedback_send_started_at IS NULL`,
						[
							retry ? 1 : 0,
							Math.min(screenshot.attempts + 1, MAX_ATTEMPTS),
							exhausted ? "retry_exhausted" : screenshotCode,
							timestamp,
							row.account_user_id,
							row.feedback_id,
						],
					);
				}
			}
			await this.#assertActive(row.account_user_id);
		});
	}

	async #markPendingAuthentication(accountUserId: string): Promise<void> {
		await this.database.transaction(async (transaction) => {
			await this.#assertActive(accountUserId);
			await transaction.run(
				`UPDATE feedback_submissions SET state = 'attention',
  next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
  last_error_code = 'auth_required', updated_at = ?
WHERE account_user_id = ? AND state = 'pending'`,
				[this.#timestamp(), accountUserId],
			);
			await transaction.run(
				`UPDATE feedback_screenshot_attachments SET
  last_error_code = 'auth_required', updated_at = ?
WHERE account_user_id = ? AND state NOT IN ('committed', 'omitted')`,
				[this.#timestamp(), accountUserId],
			);
			await this.#assertActive(accountUserId);
		});
	}

	async #assertSubject(
		client: FeedbackGatewayClient,
		subject: GatewaySessionSubject,
	): Promise<void> {
		try {
			await client.assertSessionSubject(subject);
		} catch (error) {
			if (isAccountChange(error)) {
				throw new FeedbackSubmissionAccountChangedError();
			}
			if (isAuthenticationFailure(error)) {
				throw new FeedbackSubmissionAuthenticationError();
			}
			throw error;
		}
	}

	async #assertActive(accountUserId: string): Promise<void> {
		if ((await this.#activeAccountUserId()) !== accountUserId) {
			throw new FeedbackSubmissionAccountChangedError();
		}
	}

	async #required(
		accountUserId: string,
		feedbackId: string,
	): Promise<FeedbackSubmissionReceipt> {
		const value = await this.get(accountUserId, feedbackId);
		if (!value) throw new Error("Feedback submission was not persisted");
		return value;
	}

	#retryAt(attempts: number, retryAfterSeconds: number | null): string {
		const requested = retryAfterSeconds === null ? 0 : retryAfterSeconds * 1000;
		const exponential = Math.min(
			1000 * 2 ** Math.max(0, attempts - 1),
			MAX_RETRY_MS,
		);
		return new Date(
			this.#now().getTime() +
				Math.min(Math.max(requested, exponential), MAX_RETRY_MS),
		).toISOString();
	}

	#timestamp(): string {
		return this.#now().toISOString();
	}

	#evidenceFingerprint(domain: string, value: string): Promise<string> {
		return this.#sha256(`${domain}\u0000${value}`);
	}
}

function validateFeedbackEvidenceRow(
	row: FeedbackSubmissionEvidenceSourceRow,
): void {
	if (!feedbackEvidenceStates.has(row.state)) {
		throw new Error("Persisted feedback evidence state is invalid");
	}
	if (!/^[a-f0-9]{64}$/.test(row.command_fingerprint)) {
		throw new Error("Persisted feedback command fingerprint is invalid");
	}
	if (
		row.screenshot_state !== null &&
		!feedbackScreenshotEvidenceStates.has(row.screenshot_state)
	) {
		throw new Error("Persisted feedback screenshot state is invalid");
	}
	if (
		(row.screenshot_sha256 === null) !==
			(row.screenshot_feedback_id === null) ||
		(row.screenshot_sha256 !== null &&
			!/^[a-f0-9]{64}$/.test(row.screenshot_sha256))
	) {
		throw new Error("Persisted feedback screenshot evidence is invalid");
	}
}

function feedbackEvidenceCount(value: number | undefined): number {
	const count = Number(value ?? 0);
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new Error("Persisted feedback evidence count is invalid");
	}
	return count;
}

function assertScreenshotSelection(
	screenshot: FeedbackScreenshotRow | null,
	attachmentId: string | null,
	rootEventId: string | null,
): void {
	if (!screenshot) {
		if (attachmentId !== null) {
			throw new TypeError("Feedback screenshot was not retained");
		}
		return;
	}
	if (attachmentId === null) {
		if (screenshot.state === "omitted") return;
		throw new TypeError(
			"Retained feedback screenshot requires explicit consent or discard",
		);
	}
	if (screenshot.attachment_id !== attachmentId) {
		throw new TypeError("Feedback screenshot identity does not match");
	}
	if (rootEventId === null || screenshot.root_event_id !== rootEventId) {
		throw new TypeError("Feedback screenshot root does not match");
	}
}

async function assertDeliveryLease(
	database: SqlExecutor,
	submission: FeedbackSubmissionRow,
): Promise<void> {
	const lease = await database.first<{
		state: FeedbackSubmissionState;
		lease_owner: string | null;
	}>(
		`SELECT state, lease_owner FROM feedback_submissions
WHERE account_user_id = ? AND feedback_id = ?`,
		[submission.account_user_id, submission.feedback_id],
	);
	if (
		lease?.state !== "sending" ||
		lease.lease_owner !== submission.lease_owner
	) {
		throw new FeedbackSubmissionLeaseLostError();
	}
}

async function requiredScreenshot(
	database: SqlExecutor,
	identity: FeedbackScreenshotRow,
): Promise<FeedbackScreenshotRow> {
	const row = await selectFeedbackScreenshot(
		database,
		identity.account_user_id,
		identity.feedback_id,
	);
	if (!row || row.attachment_id !== identity.attachment_id) {
		throw new FeedbackSubmissionLeaseLostError();
	}
	return row;
}

function prepareIdempotencyKey(screenshot: FeedbackScreenshotRow): string {
	return `fbatt-p-${screenshot.upload_generation}-${screenshot.attachment_id}`;
}

function finalizeIdempotencyKey(screenshot: FeedbackScreenshotRow): string {
	return `fbatt-f-${screenshot.upload_generation}-${screenshot.attachment_id}`;
}

function validPreparedUpload(
	value: AttachmentPrepareData,
	screenshot: FeedbackScreenshotRow,
): { grant: AttachmentUploadGrant; uploadId: string } {
	const candidate = value as AttachmentPrepareData | null;
	const upload = candidate?.upload;
	const grant = candidate?.grant;
	if (
		!upload ||
		!grant ||
		!/^upl_[A-Za-z0-9._:-]{1,96}$/.test(upload.id) ||
		upload.attachmentId !== screenshot.attachment_id ||
		upload.rootEventId !== screenshot.root_event_id ||
		upload.target.kind !== "feedback" ||
		upload.target.feedbackId !== screenshot.feedback_id ||
		upload.targetEntryId !== null ||
		upload.contentType !== screenshot.content_type ||
		upload.byteCount !== screenshot.byte_count ||
		upload.sha256 !== screenshot.sha256 ||
		upload.state !== "prepared" ||
		grant.method !== "POST" ||
		!validUploadUrl(grant.url) ||
		!Number.isFinite(Date.parse(grant.expiresAt)) ||
		!validGrantFields(grant.fields)
	) {
		throw new FeedbackSubmissionInvalidResponseError();
	}
	return { grant, uploadId: upload.id };
}

function validPendingVerification(
	value: AttachmentFinalizeData,
	uploadId: string,
): void {
	const candidate = value as {
		uploadId?: unknown;
		verification?: { retryable?: unknown; state?: unknown };
	};
	if (
		candidate.uploadId !== uploadId ||
		candidate.verification?.retryable !== true ||
		!new Set(["pending", "processing", "retry"]).has(
			String(candidate.verification?.state),
		)
	) {
		throw new FeedbackSubmissionInvalidResponseError();
	}
}

function validCommittedAttachment(
	value: AttachmentFinalizeData,
	screenshot: FeedbackScreenshotRow,
): void {
	const attachment = (value as { attachment?: Record<string, unknown> })
		.attachment;
	const target = attachment?.target as
		| { kind?: unknown; feedbackId?: unknown }
		| undefined;
	if (
		!attachment ||
		attachment.id !== screenshot.attachment_id ||
		attachment.rootEventId !== screenshot.root_event_id ||
		attachment.targetEntryId !== null ||
		target?.kind !== "feedback" ||
		target.feedbackId !== screenshot.feedback_id ||
		attachment.contentType !== screenshot.content_type ||
		attachment.byteCount !== screenshot.byte_count ||
		attachment.sha256 !== screenshot.sha256 ||
		attachment.integrityStatus !== "integrity_verified"
	) {
		throw new FeedbackSubmissionInvalidResponseError();
	}
}

function validUploadUrl(value: string): boolean {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

function validGrantFields(value: Record<string, string>): boolean {
	const entries = Object.entries(value);
	return (
		entries.length > 0 &&
		entries.length <= 64 &&
		entries.every(
			([key, field]) =>
				key.length > 0 &&
				key.length <= 128 &&
				typeof field === "string" &&
				field.length <= 8192,
		)
	);
}

export async function purgeFeedbackSubmissions(
	database: SqlExecutor,
	accountUserId: string,
): Promise<void> {
	validateAccount(accountUserId);
	await database.run(
		"DELETE FROM feedback_screenshot_attachments WHERE account_user_id = ?",
		[accountUserId],
	);
	await database.run(
		"DELETE FROM feedback_submissions WHERE account_user_id = ?",
		[accountUserId],
	);
}

export function feedbackSubmissionId(): string {
	return `fbk_${secureUuid()}`;
}

function canonicalCommand(
	input: FeedbackSubmissionInput,
): FeedbackCreateCommand {
	validateFeedback(input.id);
	const rootEventId = nullableEvent(input.rootEventId, "root event");
	const eventId = nullableEvent(input.eventId, "event");
	if (eventId !== null && rootEventId === null) {
		throw new TypeError("Feedback event requires a root event");
	}
	const screenKey = input.screenKey ?? null;
	if (screenKey !== null && !screenPattern.test(screenKey)) {
		throw new TypeError("Invalid feedback screen key");
	}
	if (input.visibility !== "public" && input.visibility !== "private") {
		throw new TypeError("Invalid feedback visibility");
	}
	return {
		id: input.id,
		title: trimmed(input.title, 160, "feedback title"),
		body: trimmed(input.body, 10_000, "feedback body"),
		visibility: input.visibility,
		rootEventId,
		eventId,
		screenKey,
		diagnostics: diagnostics(input.diagnostics),
		attachmentIds: [],
	};
}

function diagnostics(
	value: FeedbackSubmissionDiagnostics | null | undefined,
): FeedbackSubmissionDiagnostics | null {
	if (!value) return null;
	const result: FeedbackSubmissionDiagnostics = {};
	if (value.appVersion !== undefined) {
		result.appVersion = structuredDiagnostic(
			value.appVersion,
			64,
			"app version",
			appVersionPattern,
		);
	}
	if (value.buildNumber !== undefined) {
		result.buildNumber = structuredDiagnostic(
			value.buildNumber,
			32,
			"build number",
			buildNumberPattern,
		);
	}
	if (value.locale !== undefined) {
		result.locale = structuredDiagnostic(
			value.locale,
			35,
			"locale",
			localePattern,
		);
	}
	if (value.osVersion !== undefined) {
		result.osVersion = structuredDiagnostic(
			value.osVersion,
			64,
			"OS version",
			osVersionPattern,
		);
	}
	if (value.platform !== undefined) {
		if (value.platform !== "ios" && value.platform !== "android") {
			throw new TypeError("Invalid feedback platform");
		}
		result.platform = value.platform;
	}
	return Object.keys(result).length > 0 ? result : null;
}

function parseCommand(
	value: string,
	feedbackId: string,
): FeedbackCreateCommand {
	const parsed = JSON.parse(value) as FeedbackSubmissionInput;
	const command = canonicalCommand(parsed);
	if (command.id !== feedbackId || JSON.stringify(command) !== value) {
		throw new TypeError("Invalid persisted feedback command");
	}
	return command;
}

function classifyFailure(error: unknown): DeliveryFailure {
	if (error instanceof FeedbackAttachmentVerificationPendingError) {
		return {
			code: "service_unavailable",
			retryAfterSeconds: 1,
			retryable: true,
		};
	}
	if (error instanceof FeedbackAttachmentUploadExpiredError) {
		return {
			code: "service_unavailable",
			retryAfterSeconds: 1,
			retryable: true,
		};
	}
	if (error instanceof FeedbackAttachmentUploadError) {
		const invalid =
			error.failure === "missing_file" || error.failure === "unsafe";
		return {
			code: invalid ? "invalid" : "service_unavailable",
			retryAfterSeconds: null,
			retryable: error.retryable,
		};
	}
	if (error instanceof FeedbackSubmissionInvalidResponseError) {
		return {
			code: "invalid_response",
			retryAfterSeconds: null,
			retryable: true,
		};
	}
	if (!(error instanceof GatewayClientError)) {
		return { code: "network", retryAfterSeconds: null, retryable: true };
	}
	if (isAuthenticationFailure(error)) {
		return {
			code: "auth_required",
			retryAfterSeconds: null,
			retryable: false,
		};
	}
	if (error.code === "invalid_response") {
		return {
			code: "invalid_response",
			retryAfterSeconds: null,
			retryable: true,
		};
	}
	if (error.code === "network_error" || error.code === "timeout") {
		return {
			code: "network",
			retryAfterSeconds: error.retryAfterSeconds,
			retryable: true,
		};
	}
	if (error.status === 403 || error.status === 404) {
		return { code: "denied", retryAfterSeconds: null, retryable: false };
	}
	if (error.status === 409 && error.code === "IDEMPOTENCY_IN_PROGRESS") {
		return {
			code: "service_unavailable",
			retryAfterSeconds: error.retryAfterSeconds,
			retryable: true,
		};
	}
	if (error.status === 400 || error.status === 409) {
		return { code: "invalid", retryAfterSeconds: null, retryable: false };
	}
	if (error.status === 429) {
		return {
			code: "rate_limited",
			retryAfterSeconds: error.retryAfterSeconds,
			retryable: true,
		};
	}
	if (
		error.retryable ||
		error.status === 502 ||
		error.status === 503 ||
		error.status === 504
	) {
		return {
			code: "service_unavailable",
			retryAfterSeconds: error.retryAfterSeconds,
			retryable: true,
		};
	}
	return { code: "unknown", retryAfterSeconds: null, retryable: true };
}

function screenshotFailure(
	error: unknown,
	failure: DeliveryFailure,
): FeedbackScreenshotFailure {
	if (error instanceof FeedbackAttachmentVerificationPendingError) {
		return "verification_pending";
	}
	if (error instanceof FeedbackAttachmentUploadExpiredError) {
		return "upload_expired";
	}
	if (error instanceof FeedbackAttachmentUploadError) {
		return {
			missing_file: "attachment_missing",
			storage: "attachment_storage",
			unavailable: "attachment_unavailable",
			unsafe: "attachment_unsafe",
		}[error.failure] as FeedbackScreenshotFailure;
	}
	return failure.code;
}

function isAccountChange(error: unknown): boolean {
	return (
		error instanceof FeedbackSubmissionAccountChangedError ||
		(error instanceof GatewayClientError && error.code === "session_changed")
	);
}

function isAuthenticationFailure(error: unknown): boolean {
	return (
		error instanceof FeedbackSubmissionAuthenticationError ||
		(error instanceof GatewayClientError &&
			(error.code === "unauthenticated" || error.status === 401))
	);
}

function receipt(row: FeedbackSubmissionRow): FeedbackSubmissionReceipt {
	return {
		accountUserId: row.account_user_id,
		feedbackId: row.feedback_id,
		state: row.state,
		attempts: Number(row.attempts),
		failure: row.last_error_code,
		nextAttemptAt: row.next_attempt_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		deliveredAt: row.delivered_at,
	};
}

function nullableEvent(value: string | null | undefined, label: string) {
	if (value === undefined || value === null) return null;
	if (!eventPattern.test(value))
		throw new TypeError(`Invalid feedback ${label} ID`);
	return value;
}

function trimmed(value: unknown, maximum: number, label: string): string {
	if (typeof value !== "string") throw new TypeError(`Invalid ${label}`);
	const result = value.trim();
	if (result.length < 1 || result.length > maximum) {
		throw new TypeError(`Invalid ${label}`);
	}
	return result;
}

function structuredDiagnostic(
	value: unknown,
	maximum: number,
	label: string,
	pattern: RegExp,
): string {
	const result = trimmed(value, maximum, label);
	if (!pattern.test(result)) throw new TypeError(`Invalid ${label}`);
	return result;
}

function validateAccount(value: string): void {
	if (!accountPattern.test(value))
		throw new TypeError("Invalid feedback account");
}

function validateFeedback(value: string): void {
	if (!feedbackPattern.test(value)) throw new TypeError("Invalid feedback ID");
}

function secureUuid(): string {
	if (!globalThis.crypto?.randomUUID) {
		throw new Error("Secure random generation is unavailable");
	}
	return globalThis.crypto.randomUUID();
}

function requiredCommand(value: string | null): string {
	if (value === null) throw new TypeError("Feedback command is unavailable");
	return value;
}
