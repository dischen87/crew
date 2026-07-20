import type { Sql } from "postgres";
import { attachmentCommittedKey } from "./attachment-keys";
import type { AttachmentUploadRecord } from "./feed-domain";

type Tx = Sql;

export type AttachmentVerificationClaim = {
	upload: AttachmentUploadRecord;
	committedObjectKey: string;
	workerId: string;
	fence: string;
	attempt: number;
};

export type AttachmentCleanupClaim = {
	upload: AttachmentUploadRecord;
	committedObjectKey: string | null;
	workerId: string;
	fence: string;
	attempt: number;
};

export type AttachmentJobMaintenance = {
	verificationExhausted: number;
	cleanupExhausted: number;
	verificationBacklog: number;
	cleanupBacklog: number;
	oldestVerificationAgeSeconds: number;
	oldestCleanupAgeSeconds: number;
};

export class PostgresAttachmentJobRepository {
	constructor(private readonly sql: Sql) {}

	async maintain(input: {
		verificationMaxAttempts: number;
		cleanupMaxAttempts: number;
		cleanupRetentionSeconds: number;
		limit: number;
	}): Promise<AttachmentJobMaintenance> {
		return this.sql.begin(async (transaction) => {
			const tx = transaction as unknown as Tx;
			const verificationExhausted = await tx<{ uploadId: string }[]>`
				WITH exhausted AS (
					SELECT upload_id
					FROM event_attachment_verify_jobs
					WHERE attempts >= ${input.verificationMaxAttempts} AND (
						(status IN ('pending', 'retry') AND available_at <= now()) OR
						(status = 'processing' AND lease_until <= now())
					)
					ORDER BY COALESCE(lease_until, available_at), upload_id
					FOR UPDATE SKIP LOCKED LIMIT ${input.limit}
				)
				UPDATE event_attachment_verify_jobs AS jobs SET
					status = 'dead', error_code = 'ATTACHMENT_VERIFICATION_LEASE_EXHAUSTED',
					lease_owner = NULL, lease_until = NULL,
					completed_at = now(), updated_at = now()
				FROM exhausted
				WHERE jobs.upload_id = exhausted.upload_id
				RETURNING jobs.upload_id AS "uploadId"
			`;
			const cleanupExhausted = await tx<{ uploadId: string }[]>`
				WITH exhausted AS (
					SELECT job.upload_id
					FROM event_attachment_cleanup_jobs job
					JOIN event_attachment_uploads upload ON upload.id = job.upload_id
					WHERE job.attempts >= ${input.cleanupMaxAttempts}
						AND upload.created_at <= now()
							- (${input.cleanupRetentionSeconds} * interval '1 second')
						AND (
							(job.status IN ('pending', 'retry') AND job.available_at <= now()) OR
							(job.status = 'processing' AND job.lease_until <= now())
						)
						AND NOT EXISTS (
							SELECT 1 FROM event_attachment_verify_jobs verify
							WHERE verify.upload_id = job.upload_id
								AND verify.status IN ('pending', 'processing', 'retry')
						)
					ORDER BY COALESCE(job.lease_until, job.available_at), job.upload_id
					FOR UPDATE OF job SKIP LOCKED LIMIT ${input.limit}
				)
				UPDATE event_attachment_cleanup_jobs AS jobs SET
					status = 'dead', error_code = 'ATTACHMENT_CLEANUP_LEASE_EXHAUSTED',
					lease_owner = NULL, lease_until = NULL,
					completed_at = now(), updated_at = now()
				FROM exhausted
				WHERE jobs.upload_id = exhausted.upload_id
				RETURNING jobs.upload_id AS "uploadId"
			`;
			const [health] = await tx<
				{
					verificationBacklog: number;
					cleanupBacklog: number;
					oldestVerificationAgeSeconds: number;
					oldestCleanupAgeSeconds: number;
				}[]
			>`
				SELECT
					count(*) FILTER (
						WHERE kind = 'verification' AND status IN ('pending', 'processing', 'retry')
					)::int AS "verificationBacklog",
					count(*) FILTER (
						WHERE kind = 'cleanup' AND status IN ('pending', 'processing', 'retry')
					)::int AS "cleanupBacklog",
					COALESCE(GREATEST(0, floor(EXTRACT(EPOCH FROM (
						clock_timestamp() - (min(created_at) FILTER (
							WHERE kind = 'verification' AND status IN ('pending', 'processing', 'retry')
						))
					))))::int, 0) AS "oldestVerificationAgeSeconds",
					COALESCE(GREATEST(0, floor(EXTRACT(EPOCH FROM (
						clock_timestamp() - (min(created_at) FILTER (
							WHERE kind = 'cleanup' AND status IN ('pending', 'processing', 'retry')
						))
					))))::int, 0) AS "oldestCleanupAgeSeconds"
				FROM (
					SELECT 'verification'::text AS kind, status, created_at
					FROM event_attachment_verify_jobs
					UNION ALL
					SELECT 'cleanup'::text AS kind, status, created_at
					FROM event_attachment_cleanup_jobs
				) jobs
			`;
			return {
				verificationExhausted: verificationExhausted.length,
				cleanupExhausted: cleanupExhausted.length,
				verificationBacklog: health?.verificationBacklog ?? 0,
				cleanupBacklog: health?.cleanupBacklog ?? 0,
				oldestVerificationAgeSeconds: health?.oldestVerificationAgeSeconds ?? 0,
				oldestCleanupAgeSeconds: health?.oldestCleanupAgeSeconds ?? 0,
			};
		}) as Promise<AttachmentJobMaintenance>;
	}

	async claimVerification(input: {
		workerId: string;
		leaseSeconds: number;
		maxAttempts: number;
	}): Promise<AttachmentVerificationClaim | null> {
		return this.sql.begin(async (transaction) => {
			const tx = transaction as unknown as Tx;
			const [candidate] = await tx<{ uploadId: string }[]>`
				SELECT upload_id AS "uploadId" FROM event_attachment_verify_jobs
				WHERE attempts < ${input.maxAttempts} AND (
					(status IN ('pending', 'retry') AND available_at <= now()) OR
					(status = 'processing' AND lease_until <= now())
				)
				ORDER BY COALESCE(lease_until, available_at), upload_id
				FOR UPDATE SKIP LOCKED LIMIT 1
			`;
			if (!candidate) return null;
			const [job] = await tx<{ attempt: number; fence: string }[]>`
				UPDATE event_attachment_verify_jobs SET
					status = 'processing', attempts = attempts + 1,
					lease_owner = ${input.workerId},
					lease_until = now() + (${input.leaseSeconds} * interval '1 second'),
					fence = fence + 1, updated_at = now()
				WHERE upload_id = ${candidate.uploadId}
				RETURNING attempts AS attempt, fence::text AS fence
			`;
			const upload = await loadUpload(tx, candidate.uploadId, true);
			if (!job || !upload)
				throw new Error("Attachment verification claim invariant failed");
			return {
				upload,
				committedObjectKey: attachmentCommittedKey(upload),
				workerId: input.workerId,
				fence: job.fence,
				attempt: job.attempt,
			};
		}) as Promise<AttachmentVerificationClaim | null>;
	}

	async completeVerification(claim: AttachmentVerificationClaim) {
		const rows = await this.sql`
			UPDATE event_attachment_verify_jobs SET
				status = 'verified', result_object_key = ${claim.committedObjectKey},
				error_code = NULL, lease_owner = NULL, lease_until = NULL,
				completed_at = now(), updated_at = now()
			WHERE upload_id = ${claim.upload.id} AND status = 'processing'
				AND lease_owner = ${claim.workerId} AND fence = ${claim.fence}
				AND lease_until > now()
			RETURNING upload_id
		`;
		return rows.length === 1;
	}

	async rejectVerification(
		claim: AttachmentVerificationClaim,
		errorCode: string,
	) {
		const rows = await this.sql`
			UPDATE event_attachment_verify_jobs SET
				status = 'rejected', result_object_key = NULL,
				error_code = ${errorCode}, lease_owner = NULL, lease_until = NULL,
				completed_at = now(), updated_at = now()
			WHERE upload_id = ${claim.upload.id} AND status = 'processing'
				AND lease_owner = ${claim.workerId} AND fence = ${claim.fence}
				AND lease_until > now()
			RETURNING upload_id
		`;
		return rows.length === 1;
	}

	async retryVerification(
		claim: AttachmentVerificationClaim,
		input: { errorCode: string; maxAttempts: number; delaySeconds: number },
	) {
		const dead = claim.attempt >= input.maxAttempts;
		const rows = await this.sql<{ status: "retry" | "dead" }[]>`
			UPDATE event_attachment_verify_jobs SET
				status = ${dead ? "dead" : "retry"}, result_object_key = NULL,
				error_code = ${input.errorCode}, lease_owner = NULL, lease_until = NULL,
				available_at = now() + (${boundedDelay(input.delaySeconds)} * interval '1 second'),
				completed_at = CASE WHEN ${dead} THEN now() ELSE NULL END, updated_at = now()
			WHERE upload_id = ${claim.upload.id} AND status = 'processing'
				AND lease_owner = ${claim.workerId} AND fence = ${claim.fence}
				AND lease_until > now()
			RETURNING status
		`;
		return rows[0]?.status ?? null;
	}

	async claimCleanup(input: {
		workerId: string;
		leaseSeconds: number;
		retentionSeconds: number;
		maxAttempts: number;
	}): Promise<AttachmentCleanupClaim | null> {
		return this.sql.begin(async (transaction) => {
			const tx = transaction as unknown as Tx;
			const [candidate] = await tx<{ uploadId: string }[]>`
				SELECT job.upload_id AS "uploadId"
				FROM event_attachment_cleanup_jobs job
				JOIN event_attachment_uploads upload ON upload.id = job.upload_id
				WHERE job.attempts < ${input.maxAttempts}
					AND upload.created_at <= now() - (${input.retentionSeconds} * interval '1 second')
					AND (
						(job.status IN ('pending', 'retry') AND job.available_at <= now()) OR
						(job.status = 'processing' AND job.lease_until <= now())
					)
					AND NOT EXISTS (
						SELECT 1 FROM event_attachments attachment
						WHERE attachment.object_key = upload.quarantine_object_key
					)
					AND NOT EXISTS (
						SELECT 1 FROM event_attachment_verify_jobs verify
						WHERE verify.upload_id = job.upload_id
							AND verify.status IN ('pending', 'processing', 'retry')
					)
				ORDER BY COALESCE(job.lease_until, job.available_at), job.upload_id
				FOR UPDATE OF job SKIP LOCKED LIMIT 1
			`;
			if (!candidate) return null;
			const [job] = await tx<{ attempt: number; fence: string }[]>`
				UPDATE event_attachment_cleanup_jobs SET
					status = 'processing', attempts = attempts + 1,
					lease_owner = ${input.workerId},
					lease_until = now() + (${input.leaseSeconds} * interval '1 second'),
					fence = fence + 1, updated_at = now()
				WHERE upload_id = ${candidate.uploadId}
				RETURNING attempts AS attempt, fence::text AS fence
			`;
			const upload = await loadUpload(tx, candidate.uploadId, true);
			if (!job || !upload)
				throw new Error("Attachment cleanup claim invariant failed");
			const committedObjectKey =
				upload.target.kind === "feedback" && upload.state === "committed"
					? await feedbackOrphanObjectKey(tx, upload)
					: null;
			return {
				upload,
				committedObjectKey,
				workerId: input.workerId,
				fence: job.fence,
				attempt: job.attempt,
			};
		}) as Promise<AttachmentCleanupClaim | null>;
	}

	async completeCleanup(claim: AttachmentCleanupClaim) {
		return this.sql.begin(async (transaction) => {
			const tx = transaction as unknown as Tx;
			const [job] = await tx<{ uploadId: string }[]>`
				SELECT upload_id AS "uploadId" FROM event_attachment_cleanup_jobs
				WHERE upload_id = ${claim.upload.id} AND status = 'processing'
					AND lease_owner = ${claim.workerId} AND fence = ${claim.fence}
					AND lease_until > now()
				FOR UPDATE
			`;
			if (!job) return false;
			if (claim.committedObjectKey !== null) {
				const removed = await tx`
					DELETE FROM event_attachments attachment
					WHERE attachment.upload_id = ${claim.upload.id}
						AND attachment.target_type = 'feedback'
						AND attachment.object_key = ${claim.committedObjectKey}
						AND NOT EXISTS (
							SELECT 1 FROM event_feedback_attachments link
							WHERE link.root_event_id = attachment.root_event_id
								AND link.attachment_id = attachment.id
						)
					RETURNING attachment.id
				`;
				if (removed.length !== 1)
					throw new Error(
						"Feedback attachment cleanup binding invariant failed",
					);
				await tx`
					UPDATE event_attachment_uploads
					SET state = 'expired', committed_at = NULL
					WHERE id = ${claim.upload.id} AND state = 'committed'
				`;
			}
			await tx`
				UPDATE event_attachment_cleanup_jobs SET
					status = 'done', error_code = NULL,
					lease_owner = NULL, lease_until = NULL,
					completed_at = now(), updated_at = now()
				WHERE upload_id = ${claim.upload.id}
			`;
			return true;
		}) as Promise<boolean>;
	}

	async rejectCleanup(claim: AttachmentCleanupClaim, errorCode: string) {
		const rows = await this.sql`
			UPDATE event_attachment_cleanup_jobs SET
				status = 'dead', error_code = ${errorCode},
				lease_owner = NULL, lease_until = NULL,
				completed_at = now(), updated_at = now()
			WHERE upload_id = ${claim.upload.id} AND status = 'processing'
				AND lease_owner = ${claim.workerId} AND fence = ${claim.fence}
				AND lease_until > now()
			RETURNING upload_id
		`;
		return rows.length === 1;
	}

	async retryCleanup(
		claim: AttachmentCleanupClaim,
		input: { errorCode: string; maxAttempts: number; delaySeconds: number },
	) {
		const dead = claim.attempt >= input.maxAttempts;
		const rows = await this.sql<{ status: "retry" | "dead" }[]>`
			UPDATE event_attachment_cleanup_jobs SET
				status = ${dead ? "dead" : "retry"}, error_code = ${input.errorCode},
				lease_owner = NULL, lease_until = NULL,
				available_at = now() + (${boundedDelay(input.delaySeconds)} * interval '1 second'),
				completed_at = CASE WHEN ${dead} THEN now() ELSE NULL END, updated_at = now()
			WHERE upload_id = ${claim.upload.id} AND status = 'processing'
				AND lease_owner = ${claim.workerId} AND fence = ${claim.fence}
				AND lease_until > now()
			RETURNING status
		`;
		return rows[0]?.status ?? null;
	}
}

async function loadUpload(tx: Tx, uploadId: string, lock = false) {
	const suffix = lock ? tx`FOR UPDATE` : tx``;
	const [upload] = await tx<AttachmentUploadRecord[]>`
		SELECT
			id, attachment_id AS "attachmentId", root_event_id AS "rootEventId",
			CASE target_type
				WHEN 'feed_entry' THEN jsonb_build_object(
					'kind', 'feedEntry', 'entryId', target_entry_id
				)
				ELSE jsonb_build_object(
					'kind', 'feedback', 'feedbackId', target_feedback_id
				)
			END AS target,
			target_entry_id AS "targetEntryId", created_by AS "createdBy",
			quarantine_object_key AS "quarantineObjectKey", content_type AS "contentType",
			byte_count AS "byteCount", sha256, grant_kid AS "grantKid",
			grant_ciphertext AS "grantCiphertext", state, expires_at AS "expiresAt",
			committed_at AS "committedAt", created_at AS "createdAt"
		FROM event_attachment_uploads WHERE id = ${uploadId} ${suffix}
	`;
	return upload ?? null;
}

async function feedbackOrphanObjectKey(tx: Tx, upload: AttachmentUploadRecord) {
	const [orphan] = await tx<{ objectKey: string }[]>`
		SELECT attachment.object_key AS "objectKey"
		FROM event_attachments attachment
		WHERE attachment.upload_id = ${upload.id}
			AND attachment.target_type = 'feedback'
			AND NOT EXISTS (
				SELECT 1 FROM event_feedback_attachments link
				WHERE link.root_event_id = attachment.root_event_id
					AND link.attachment_id = attachment.id
			)
		FOR UPDATE OF attachment
	`;
	return orphan?.objectKey ?? null;
}

function boundedDelay(seconds: number) {
	return Math.max(1, Math.min(15 * 60, Math.floor(seconds)));
}
