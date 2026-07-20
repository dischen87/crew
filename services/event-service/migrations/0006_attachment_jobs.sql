ALTER TABLE event_attachment_uploads
	ADD CONSTRAINT event_attachment_upload_quarantine_key_shape CHECK (
		quarantine_object_key =
			'quarantine/' || root_event_id || '/' || attachment_id || '/' || id || '/' ||
			byte_count::text || '-' || sha256
	);

ALTER TABLE event_attachments
	ADD CONSTRAINT event_attachment_committed_key_shape CHECK (
		object_key =
			'committed/' || root_event_id || '/' || id || '/' || upload_id || '/' || sha256
	);

CREATE TABLE event_attachment_verify_jobs (
	upload_id TEXT PRIMARY KEY REFERENCES event_attachment_uploads(id) ON DELETE CASCADE,
	status TEXT NOT NULL DEFAULT 'pending' CHECK (
		status IN ('pending', 'processing', 'retry', 'verified', 'rejected', 'dead')
	),
	attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 32),
	available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	lease_owner TEXT CHECK (lease_owner IS NULL OR char_length(lease_owner) BETWEEN 1 AND 128),
	lease_until TIMESTAMPTZ,
	fence BIGINT NOT NULL DEFAULT 0 CHECK (fence >= 0),
	result_object_key TEXT CHECK (
		result_object_key IS NULL OR char_length(result_object_key) BETWEEN 1 AND 512
	),
	error_code TEXT CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{1,127}$'),
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	completed_at TIMESTAMPTZ,
	CHECK (
		(status = 'processing' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL) OR
		(status <> 'processing' AND lease_owner IS NULL AND lease_until IS NULL)
	),
	CHECK (
		(status = 'verified' AND result_object_key IS NOT NULL AND error_code IS NULL
			AND completed_at IS NOT NULL) OR
		(status IN ('rejected', 'dead') AND result_object_key IS NULL
			AND error_code IS NOT NULL AND completed_at IS NOT NULL) OR
		(status = 'retry' AND result_object_key IS NULL
			AND error_code IS NOT NULL AND completed_at IS NULL) OR
		(status IN ('pending', 'processing') AND result_object_key IS NULL
			AND completed_at IS NULL)
	)
);

CREATE INDEX event_attachment_verify_jobs_claim_idx
	ON event_attachment_verify_jobs(available_at, upload_id)
	WHERE status IN ('pending', 'retry');
CREATE INDEX event_attachment_verify_jobs_lease_idx
	ON event_attachment_verify_jobs(lease_until, upload_id)
	WHERE status = 'processing';
CREATE INDEX event_attachment_verify_jobs_active_capacity_idx
	ON event_attachment_verify_jobs(upload_id)
	WHERE status IN ('pending', 'processing', 'retry');

CREATE TABLE event_attachment_cleanup_jobs (
	upload_id TEXT PRIMARY KEY REFERENCES event_attachment_uploads(id) ON DELETE CASCADE,
	status TEXT NOT NULL DEFAULT 'pending' CHECK (
		status IN ('pending', 'processing', 'retry', 'done', 'dead')
	),
	attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 32),
	available_at TIMESTAMPTZ NOT NULL,
	lease_owner TEXT CHECK (lease_owner IS NULL OR char_length(lease_owner) BETWEEN 1 AND 128),
	lease_until TIMESTAMPTZ,
	fence BIGINT NOT NULL DEFAULT 0 CHECK (fence >= 0),
	error_code TEXT CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{1,127}$'),
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	completed_at TIMESTAMPTZ,
	CHECK (
		(status = 'processing' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL) OR
		(status <> 'processing' AND lease_owner IS NULL AND lease_until IS NULL)
	),
	CHECK (
		(status = 'done' AND error_code IS NULL AND completed_at IS NOT NULL) OR
		(status = 'dead' AND error_code IS NOT NULL AND completed_at IS NOT NULL) OR
		(status = 'retry' AND error_code IS NOT NULL AND completed_at IS NULL) OR
		(status IN ('pending', 'processing') AND completed_at IS NULL)
	)
);

CREATE INDEX event_attachment_cleanup_jobs_claim_idx
	ON event_attachment_cleanup_jobs(available_at, upload_id)
	WHERE status IN ('pending', 'retry');
CREATE INDEX event_attachment_cleanup_jobs_lease_idx
	ON event_attachment_cleanup_jobs(lease_until, upload_id)
	WHERE status = 'processing';

INSERT INTO event_attachment_cleanup_jobs (
	upload_id, available_at, created_at, updated_at
)
SELECT id, created_at + interval '24 hours', created_at, created_at
FROM event_attachment_uploads
ON CONFLICT (upload_id) DO NOTHING;
