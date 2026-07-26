import type { SqlDatabase, SqlExecutor } from "./database.ts";

export type AttachmentContentType = "image/jpeg" | "image/png" | "image/webp";

export interface RetainedLocalAttachment {
	accountUserId: string;
	attachmentId: string;
	rootEventId: string;
	targetEntryId: string;
	retainedFileKey: string;
	contentType: AttachmentContentType;
	byteCount: number;
	sha256: string;
	pixelWidth: number;
	pixelHeight: number;
	wasNormalized: boolean;
	retainedAt: string;
}

interface RetainedLocalAttachmentRow {
	account_user_id: string;
	attachment_id: string;
	root_event_id: string;
	target_entry_id: string;
	retained_file_key: string;
	content_type: AttachmentContentType;
	byte_count: number;
	sha256: string;
	pixel_width: number;
	pixel_height: number;
	was_normalized: number;
	retained_at: string;
}

export type FeedPhotoLifecycleState = "selected" | "feed_queued";

export interface FeedPhotoLifecycle {
	attachment: RetainedLocalAttachment;
	eventId: string | null;
	state: FeedPhotoLifecycleState;
	uploadGeneration: number;
	uploadId: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface FeedPhotoCleanupPlan {
	attachmentIds: readonly string[];
	purgeFileKeys: readonly string[];
}

export interface FeedPhotoReconciliation {
	photos: readonly FeedPhotoLifecycle[];
	cleanup: FeedPhotoCleanupPlan;
}

interface FeedPhotoRow extends RetainedLocalAttachmentRow {
	event_id: string | null;
	state: FeedPhotoLifecycleState | "cleanup_pending";
	upload_generation: number;
	upload_id: string | null;
	created_at: string;
	updated_at: string;
}

const accountPattern = /^usr_[a-f0-9]{32}$/;
const attachmentPattern = /^att_[A-Za-z0-9._:-]{1,96}$/;
const rootPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const feedEntryPattern = /^fed_[A-Za-z0-9._:-]{1,96}$/;
const eventPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const uploadPattern = /^upl_[A-Za-z0-9._:-]{1,96}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const extensionByContentType = {
	"image/jpeg": ".jpg",
	"image/png": ".png",
	"image/webp": ".webp",
} as const satisfies Record<AttachmentContentType, string>;

export class LocalAttachmentStore {
	constructor(private readonly database: SqlDatabase) {}

	async retain(
		attachment: RetainedLocalAttachment,
	): Promise<RetainedLocalAttachment> {
		validateAttachment(attachment);
		return this.database.transaction((transaction) =>
			retainAttachment(transaction, attachment),
		);
	}

	async retainFeedPhoto(
		attachment: RetainedLocalAttachment,
		eventId: string | null,
	): Promise<FeedPhotoLifecycle> {
		validateAttachment(attachment);
		validateEventId(eventId);
		return this.database.transaction(async (transaction) => {
			const retained = await retainAttachment(transaction, attachment);
			const existing = await selectFeedPhoto(
				transaction,
				attachment.accountUserId,
				attachment.attachmentId,
			);
			if (existing) {
				const lifecycle = mapFeedPhoto(existing);
				if (
					!sameIdentity(lifecycle.attachment, attachment) ||
					lifecycle.eventId !== eventId
				) {
					throw new Error("Feed photo identity already has another binding");
				}
				return lifecycle;
			}
			await transaction.run(
				`INSERT INTO local_feed_photo_lifecycle (
  account_user_id, attachment_id, event_id, state, upload_generation,
  upload_id, created_at, updated_at
) VALUES (?, ?, ?, 'selected', 1, NULL, ?, ?)`,
				[
					attachment.accountUserId,
					attachment.attachmentId,
					eventId,
					attachment.retainedAt,
					attachment.retainedAt,
				],
			);
			return {
				attachment: retained,
				eventId,
				state: "selected",
				uploadGeneration: 1,
				uploadId: null,
				createdAt: attachment.retainedAt,
				updatedAt: attachment.retainedAt,
			};
		});
	}

	async get(
		accountUserId: string,
		attachmentId: string,
	): Promise<RetainedLocalAttachment | null> {
		validateAccountId(accountUserId);
		validateAttachmentId(attachmentId);
		const row = await this.database.first<RetainedLocalAttachmentRow>(
			`SELECT * FROM local_attachment_media
WHERE account_user_id = ? AND attachment_id = ?`,
			[accountUserId, attachmentId],
		);
		return row ? mapRow(row) : null;
	}

	async listRetainedFileKeys(
		accountUserId: string,
	): Promise<readonly string[]> {
		validateAccountId(accountUserId);
		const rows = await this.database.all<{ retained_file_key: string }>(
			`SELECT retained_file_key FROM (
  SELECT retained_file_key FROM local_attachment_media
  WHERE account_user_id = ?
  UNION
  SELECT retained_file_key FROM feedback_screenshot_attachments
  WHERE account_user_id = ? AND state NOT IN ('committed', 'omitted')
) ORDER BY retained_file_key`,
			[accountUserId, accountUserId],
		);
		return rows.map(({ retained_file_key }) => retained_file_key);
	}

	async getFeedPhoto(
		accountUserId: string,
		attachmentId: string,
	): Promise<FeedPhotoLifecycle | null> {
		validateAccountId(accountUserId);
		validateAttachmentId(attachmentId);
		const row = await selectFeedPhoto(
			this.database,
			accountUserId,
			attachmentId,
		);
		return row && row.state !== "cleanup_pending" ? mapFeedPhoto(row) : null;
	}

	async markFeedPhotoQueued(
		accountUserId: string,
		attachmentId: string,
		updatedAt: string,
	): Promise<FeedPhotoLifecycle> {
		return this.database.transaction(async (transaction) => {
			const current = await requiredFeedPhoto(
				transaction,
				accountUserId,
				attachmentId,
			);
			if (!["selected", "feed_queued"].includes(current.state)) {
				throw new Error("Feed photo lifecycle changed");
			}
			if (current.state === "selected") {
				await transitionState(
					transaction,
					current,
					"feed_queued",
					validTimestamp(updatedAt),
				);
			}
			return mapFeedPhoto(
				await requiredFeedPhoto(transaction, accountUserId, attachmentId),
			);
		});
	}

	async bindFeedPhotoUpload(
		accountUserId: string,
		attachmentId: string,
		uploadGeneration: number,
		uploadId: string,
		updatedAt: string,
	): Promise<FeedPhotoLifecycle> {
		validateUpload(uploadGeneration, uploadId);
		return this.database.transaction(async (transaction) => {
			const current = await requiredFeedPhoto(
				transaction,
				accountUserId,
				attachmentId,
			);
			if (
				current.state !== "feed_queued" ||
				current.upload_generation !== uploadGeneration ||
				(current.upload_id !== null && current.upload_id !== uploadId)
			) {
				throw new Error("Feed photo upload binding changed");
			}
			if (current.upload_id === null) {
				await transaction.run(
					`UPDATE local_feed_photo_lifecycle
SET upload_id = ?, updated_at = ?
WHERE account_user_id = ? AND attachment_id = ?
  AND state = 'feed_queued' AND upload_generation = ? AND upload_id IS NULL`,
					[
						uploadId,
						validTimestamp(updatedAt),
						accountUserId,
						attachmentId,
						uploadGeneration,
					],
				);
			}
			return mapFeedPhoto(
				await requiredFeedPhoto(transaction, accountUserId, attachmentId),
			);
		});
	}

	async resetExpiredFeedPhotoUpload(
		accountUserId: string,
		attachmentId: string,
		uploadGeneration: number,
		uploadId: string,
		updatedAt: string,
	): Promise<FeedPhotoLifecycle> {
		validateUpload(uploadGeneration, uploadId);
		if (uploadGeneration >= 20) {
			throw new Error("Feed photo upload retry limit reached");
		}
		return this.database.transaction(async (transaction) => {
			const current = await requiredFeedPhoto(
				transaction,
				accountUserId,
				attachmentId,
			);
			if (
				current.state !== "feed_queued" ||
				current.upload_generation !== uploadGeneration ||
				current.upload_id !== uploadId
			) {
				throw new Error("Feed photo upload generation changed");
			}
			await transaction.run(
				`UPDATE local_feed_photo_lifecycle
SET upload_generation = upload_generation + 1, upload_id = NULL, updated_at = ?
WHERE account_user_id = ? AND attachment_id = ?
  AND state = 'feed_queued' AND upload_generation = ? AND upload_id = ?`,
				[
					validTimestamp(updatedAt),
					accountUserId,
					attachmentId,
					uploadGeneration,
					uploadId,
				],
			);
			return mapFeedPhoto(
				await requiredFeedPhoto(transaction, accountUserId, attachmentId),
			);
		});
	}

	async planConfirmedFeedPhotoCleanup(
		accountUserId: string,
		attachmentId: string,
		uploadGeneration: number,
		uploadId: string,
		updatedAt: string,
	): Promise<FeedPhotoCleanupPlan> {
		validateUpload(uploadGeneration, uploadId);
		return this.database.transaction(async (transaction) => {
			const current = await requiredFeedPhoto(
				transaction,
				accountUserId,
				attachmentId,
			);
			if (
				current.state !== "feed_queued" ||
				current.upload_generation !== uploadGeneration ||
				current.upload_id !== uploadId
			) {
				throw new Error("Feed photo confirmation binding changed");
			}
			await transitionState(
				transaction,
				current,
				"cleanup_pending",
				validTimestamp(updatedAt),
			);
			return cleanupPlan(transaction, accountUserId, current.root_event_id);
		});
	}

	async planFeedPhotoDiscard(
		accountUserId: string,
		attachmentId: string,
		updatedAt: string,
	): Promise<FeedPhotoCleanupPlan> {
		validateAccountId(accountUserId);
		validateAttachmentId(attachmentId);
		return this.database.transaction(async (transaction) => {
			const current = await requiredFeedPhoto(
				transaction,
				accountUserId,
				attachmentId,
			);
			if (current.state !== "cleanup_pending") {
				await transitionState(
					transaction,
					current,
					"cleanup_pending",
					validTimestamp(updatedAt),
				);
			}
			return cleanupPlan(transaction, accountUserId, current.root_event_id);
		});
	}

	async reconcileFeedPhotos(
		accountUserId: string,
		rootEventId: string,
		updatedAt: string,
	): Promise<FeedPhotoReconciliation> {
		validateAccountId(accountUserId);
		if (!rootPattern.test(rootEventId)) throw new Error("Invalid root ID");
		const timestamp = validTimestamp(updatedAt);
		return this.database.transaction(async (transaction) => {
			const rows = await selectFeedPhotosByRoot(
				transaction,
				accountUserId,
				rootEventId,
			);
			for (const row of rows) {
				if (row.state === "cleanup_pending") continue;
				const canonical = await canonicalAttachment(
					transaction,
					accountUserId,
					rootEventId,
					row,
				);
				if (canonical) {
					await transitionState(transaction, row, "cleanup_pending", timestamp);
					continue;
				}
				const feed = await feedTargetState(transaction, row);
				if (row.state === "selected" && feed.active) {
					await transitionState(transaction, row, "feed_queued", timestamp);
				} else if (
					feed.deadLetter ||
					(row.state === "feed_queued" && !feed.active)
				) {
					await transitionState(transaction, row, "cleanup_pending", timestamp);
				}
			}
			const current = await selectFeedPhotosByRoot(
				transaction,
				accountUserId,
				rootEventId,
			);
			return {
				photos: current
					.filter(
						(
							row,
						): row is FeedPhotoRow & {
							state: FeedPhotoLifecycleState;
						} => row.state !== "cleanup_pending",
					)
					.map(mapFeedPhoto),
				cleanup: await cleanupPlan(transaction, accountUserId, rootEventId),
			};
		});
	}

	async finalizeFeedPhotoCleanup(
		accountUserId: string,
		attachmentIds: readonly string[],
	): Promise<void> {
		validateAccountId(accountUserId);
		const ids = [...new Set(attachmentIds)];
		ids.forEach(validateAttachmentId);
		if (ids.length === 0) return;
		await this.database.transaction(async (transaction) => {
			for (const attachmentId of ids) {
				await transaction.run(
					`DELETE FROM local_attachment_media
WHERE account_user_id = ? AND attachment_id = ?
  AND EXISTS (
    SELECT 1 FROM local_feed_photo_lifecycle lifecycle
    WHERE lifecycle.account_user_id = local_attachment_media.account_user_id
      AND lifecycle.attachment_id = local_attachment_media.attachment_id
      AND lifecycle.state = 'cleanup_pending'
  )`,
					[accountUserId, attachmentId],
				);
			}
		});
	}
}

async function retainAttachment(
	database: SqlExecutor,
	attachment: RetainedLocalAttachment,
): Promise<RetainedLocalAttachment> {
	const existing = await database.first<RetainedLocalAttachmentRow>(
		`SELECT * FROM local_attachment_media
WHERE account_user_id = ? AND attachment_id = ?`,
		[attachment.accountUserId, attachment.attachmentId],
	);
	if (existing) {
		const retained = mapRow(existing);
		if (!sameIdentity(retained, attachment)) {
			throw new Error("Attachment ID already has different retained bytes");
		}
		return retained;
	}
	await database.run(
		`INSERT INTO local_attachment_media (
  account_user_id, attachment_id, root_event_id, target_entry_id,
  retained_file_key, content_type, byte_count, sha256, pixel_width,
  pixel_height, was_normalized, retained_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			attachment.accountUserId,
			attachment.attachmentId,
			attachment.rootEventId,
			attachment.targetEntryId,
			attachment.retainedFileKey,
			attachment.contentType,
			attachment.byteCount,
			attachment.sha256,
			attachment.pixelWidth,
			attachment.pixelHeight,
			attachment.wasNormalized ? 1 : 0,
			attachment.retainedAt,
		],
	);
	return attachment;
}

const feedPhotoSelect = `SELECT media.*, lifecycle.event_id, lifecycle.state,
  lifecycle.upload_generation, lifecycle.upload_id, lifecycle.created_at,
  lifecycle.updated_at
FROM local_feed_photo_lifecycle lifecycle
JOIN local_attachment_media media
  ON media.account_user_id = lifecycle.account_user_id
 AND media.attachment_id = lifecycle.attachment_id`;

async function selectFeedPhoto(
	database: SqlExecutor,
	accountUserId: string,
	attachmentId: string,
): Promise<FeedPhotoRow | null> {
	return database.first<FeedPhotoRow>(
		`${feedPhotoSelect}
WHERE media.account_user_id = ? AND media.attachment_id = ?`,
		[accountUserId, attachmentId],
	);
}

async function selectFeedPhotosByRoot(
	database: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
): Promise<readonly FeedPhotoRow[]> {
	return database.all<FeedPhotoRow>(
		`${feedPhotoSelect}
WHERE media.account_user_id = ? AND media.root_event_id = ?
ORDER BY lifecycle.created_at, media.attachment_id`,
		[accountUserId, rootEventId],
	);
}

async function requiredFeedPhoto(
	database: SqlExecutor,
	accountUserId: string,
	attachmentId: string,
): Promise<FeedPhotoRow> {
	validateAccountId(accountUserId);
	validateAttachmentId(attachmentId);
	const row = await selectFeedPhoto(database, accountUserId, attachmentId);
	if (!row) throw new Error("Feed photo lifecycle is unavailable");
	return row;
}

async function transitionState(
	database: SqlExecutor,
	row: FeedPhotoRow,
	state: FeedPhotoRow["state"],
	updatedAt: string,
): Promise<void> {
	await database.run(
		`UPDATE local_feed_photo_lifecycle
SET state = ?, updated_at = ?
WHERE account_user_id = ? AND attachment_id = ? AND state = ?`,
		[state, updatedAt, row.account_user_id, row.attachment_id, row.state],
	);
}

async function cleanupPlan(
	database: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
): Promise<FeedPhotoCleanupPlan> {
	const rows = await database.all<{
		attachment_id: string;
		retained_file_key: string;
	}>(
		`SELECT media.attachment_id, media.retained_file_key
FROM local_feed_photo_lifecycle lifecycle
JOIN local_attachment_media media
  ON media.account_user_id = lifecycle.account_user_id
 AND media.attachment_id = lifecycle.attachment_id
WHERE media.account_user_id = ? AND media.root_event_id = ?
  AND lifecycle.state = 'cleanup_pending'
ORDER BY media.attachment_id`,
		[accountUserId, rootEventId],
	);
	const purgeFileKeys: string[] = [];
	for (const retainedFileKey of new Set(
		rows.map(({ retained_file_key }) => retained_file_key),
	)) {
		const retained = await database.first<{ present: number }>(
			`SELECT 1 AS present FROM (
  SELECT media.retained_file_key FROM local_attachment_media media
  LEFT JOIN local_feed_photo_lifecycle lifecycle
    ON lifecycle.account_user_id = media.account_user_id
   AND lifecycle.attachment_id = media.attachment_id
  WHERE media.account_user_id = ? AND media.retained_file_key = ?
    AND (lifecycle.state IS NULL OR lifecycle.state <> 'cleanup_pending')
  UNION ALL
  SELECT retained_file_key FROM feedback_screenshot_attachments
  WHERE account_user_id = ? AND retained_file_key = ?
    AND state NOT IN ('committed', 'omitted')
) LIMIT 1`,
			[accountUserId, retainedFileKey, accountUserId, retainedFileKey],
		);
		if (!retained) purgeFileKeys.push(retainedFileKey);
	}
	return {
		attachmentIds: rows.map(({ attachment_id }) => attachment_id),
		purgeFileKeys,
	};
}

async function canonicalAttachment(
	database: SqlExecutor,
	accountUserId: string,
	rootEventId: string,
	row: FeedPhotoRow,
): Promise<boolean> {
	const canonical = await database.first<{
		target_entity_id: string;
		content_type: AttachmentContentType;
		byte_count: number;
		sha256: string;
	}>(
		`SELECT target_entity_id, content_type, byte_count, sha256
FROM attachments
WHERE account_user_id = ? AND root_event_id = ? AND id = ?`,
		[accountUserId, rootEventId, row.attachment_id],
	);
	if (!canonical) return false;
	if (
		canonical.target_entity_id !== row.target_entry_id ||
		canonical.content_type !== row.content_type ||
		Number(canonical.byte_count) !== Number(row.byte_count) ||
		canonical.sha256 !== row.sha256
	) {
		throw new Error("Canonical feed photo identity mismatch");
	}
	return true;
}

async function feedTargetState(
	database: SqlExecutor,
	row: FeedPhotoRow,
): Promise<{ active: boolean; deadLetter: boolean }> {
	const canonical = await database.first<{ present: number }>(
		`SELECT 1 AS present FROM feed_entries
WHERE account_user_id = ? AND root_event_id = ? AND id = ? AND deleted_at IS NULL`,
		[row.account_user_id, row.root_event_id, row.target_entry_id],
	);
	const results = await database.all<{ state: string }>(
		`SELECT state FROM mutation_outbox
WHERE account_user_id = ? AND root_event_id = ?
  AND json_extract(command_json, '$.kind') = 'feed.entry.create'
  AND json_extract(command_json, '$.entityId') = ?
ORDER BY client_sequence DESC`,
		[row.account_user_id, row.root_event_id, row.target_entry_id],
	);
	return {
		active:
			Boolean(canonical) ||
			results.some(({ state }) => state !== "dead_letter"),
		deadLetter:
			!canonical && results.some(({ state }) => state === "dead_letter"),
	};
}

function mapRow(row: RetainedLocalAttachmentRow): RetainedLocalAttachment {
	return {
		accountUserId: row.account_user_id,
		attachmentId: row.attachment_id,
		rootEventId: row.root_event_id,
		targetEntryId: row.target_entry_id,
		retainedFileKey: row.retained_file_key,
		contentType: row.content_type,
		byteCount: Number(row.byte_count),
		sha256: row.sha256,
		pixelWidth: Number(row.pixel_width),
		pixelHeight: Number(row.pixel_height),
		wasNormalized: Number(row.was_normalized) === 1,
		retainedAt: row.retained_at,
	};
}

function mapFeedPhoto(row: FeedPhotoRow): FeedPhotoLifecycle {
	if (row.state === "cleanup_pending") {
		throw new Error("Feed photo cleanup is pending");
	}
	return {
		attachment: mapRow(row),
		eventId: row.event_id,
		state: row.state,
		uploadGeneration: Number(row.upload_generation),
		uploadId: row.upload_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function validateAttachment(attachment: RetainedLocalAttachment): void {
	validateAccountId(attachment.accountUserId);
	validateAttachmentId(attachment.attachmentId);
	if (!rootPattern.test(attachment.rootEventId)) {
		throw new Error("Invalid attachment root ID");
	}
	if (!feedEntryPattern.test(attachment.targetEntryId)) {
		throw new Error("Invalid attachment target ID");
	}
	if (!digestPattern.test(attachment.sha256)) {
		throw new Error("Invalid attachment SHA-256");
	}
	if (
		attachment.retainedFileKey !==
		`${attachment.sha256}${extensionByContentType[attachment.contentType]}`
	) {
		throw new Error("Retained file key does not match attachment bytes");
	}
	if (
		!Number.isSafeInteger(attachment.byteCount) ||
		attachment.byteCount < 1 ||
		attachment.byteCount > 20 * 1024 * 1024
	) {
		throw new Error("Invalid attachment byte count");
	}
	for (const size of [attachment.pixelWidth, attachment.pixelHeight]) {
		if (!Number.isSafeInteger(size) || size < 1 || size > 4096) {
			throw new Error("Invalid attachment dimensions");
		}
	}
	validTimestamp(attachment.retainedAt);
}

function validateAccountId(value: string): void {
	if (!accountPattern.test(value)) throw new Error("Invalid account ID");
}

function validateAttachmentId(value: string): void {
	if (!attachmentPattern.test(value)) throw new Error("Invalid attachment ID");
}

function validateEventId(value: string | null): void {
	if (value !== null && !eventPattern.test(value)) {
		throw new Error("Invalid feed photo event ID");
	}
}

function validateUpload(uploadGeneration: number, uploadId: string): void {
	if (
		!Number.isSafeInteger(uploadGeneration) ||
		uploadGeneration < 1 ||
		uploadGeneration > 20 ||
		!uploadPattern.test(uploadId)
	) {
		throw new Error("Invalid feed photo upload identity");
	}
}

function validTimestamp(value: string): string {
	if (!Number.isFinite(Date.parse(value))) {
		throw new Error("Invalid feed photo timestamp");
	}
	return value;
}

function sameIdentity(
	left: RetainedLocalAttachment,
	right: RetainedLocalAttachment,
): boolean {
	return (
		left.accountUserId === right.accountUserId &&
		left.attachmentId === right.attachmentId &&
		left.rootEventId === right.rootEventId &&
		left.targetEntryId === right.targetEntryId &&
		left.retainedFileKey === right.retainedFileKey &&
		left.contentType === right.contentType &&
		left.byteCount === right.byteCount &&
		left.sha256 === right.sha256 &&
		left.pixelWidth === right.pixelWidth &&
		left.pixelHeight === right.pixelHeight &&
		left.wasNormalized === right.wasNormalized
	);
}
