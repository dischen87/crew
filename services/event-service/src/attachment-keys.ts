import type { AttachmentUploadRecord } from "./feed-domain";

type UploadKeyFields = Pick<
	AttachmentUploadRecord,
	"id" | "attachmentId" | "rootEventId" | "byteCount" | "sha256"
>;

export function attachmentQuarantineKey(upload: UploadKeyFields) {
	return [
		"quarantine",
		upload.rootEventId,
		upload.attachmentId,
		upload.id,
		`${upload.byteCount}-${upload.sha256}`,
	].join("/");
}

export function attachmentCommittedKey(upload: UploadKeyFields) {
	return [
		"committed",
		upload.rootEventId,
		upload.attachmentId,
		upload.id,
		upload.sha256,
	].join("/");
}

export function hasExpectedQuarantineKey(
	upload: UploadKeyFields & { quarantineObjectKey: string },
) {
	return upload.quarantineObjectKey === attachmentQuarantineKey(upload);
}
