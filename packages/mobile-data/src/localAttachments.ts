import type { SqlDatabase } from "./database.ts";

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

const accountPattern = /^usr_[a-f0-9]{32}$/;
const attachmentPattern = /^att_[A-Za-z0-9._:-]{1,96}$/;
const rootPattern = /^evt_[A-Za-z0-9._:-]{1,96}$/;
const feedEntryPattern = /^fed_[A-Za-z0-9._:-]{1,96}$/;
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
		return this.database.transaction(async (transaction) => {
			const existing = await transaction.first<RetainedLocalAttachmentRow>(
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

			await transaction.run(
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
		});
	}

	async get(
		accountUserId: string,
		attachmentId: string,
	): Promise<RetainedLocalAttachment | null> {
		if (!accountPattern.test(accountUserId))
			throw new Error("Invalid account ID");
		if (!attachmentPattern.test(attachmentId)) {
			throw new Error("Invalid attachment ID");
		}
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
		if (!accountPattern.test(accountUserId)) {
			throw new Error("Invalid account ID");
		}
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
}

function validateAttachment(attachment: RetainedLocalAttachment): void {
	if (!accountPattern.test(attachment.accountUserId)) {
		throw new Error("Invalid attachment account ID");
	}
	if (!attachmentPattern.test(attachment.attachmentId)) {
		throw new Error("Invalid attachment ID");
	}
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
	if (!Number.isFinite(Date.parse(attachment.retainedAt))) {
		throw new Error("Invalid attachment retention time");
	}
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
