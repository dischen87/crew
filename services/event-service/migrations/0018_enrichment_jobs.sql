CREATE TABLE place_enrichment_jobs (
	id TEXT PRIMARY KEY CHECK (id ~ '^pej_[a-f0-9]{64}$'),
	request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
	target_type TEXT NOT NULL CHECK (target_type IN ('candidate', 'search_miss')),
	candidate_id TEXT REFERENCES place_candidates(id),
	candidate_snapshot_hash TEXT CHECK (
		candidate_snapshot_hash IS NULL OR candidate_snapshot_hash ~ '^[a-f0-9]{64}$'
	),
	candidate_source TEXT CHECK (
		candidate_source IS NULL OR candidate_source ~ '^[a-z][a-z0-9._-]{0,63}$'
	),
	candidate_source_url TEXT CHECK (
		candidate_source_url IS NULL OR (
			char_length(candidate_source_url) BETWEEN 1 AND 2048
			AND candidate_source_url ~ '^https?://'
		)
	),
	search_query TEXT CHECK (
		search_query IS NULL OR (
			char_length(search_query) BETWEEN 2 AND 200
			AND search_query = btrim(search_query)
			AND search_query !~ '[[:cntrl:]]'
		)
	),
	kind TEXT NOT NULL CHECK (kind IN ('golf_course', 'venue')),
	name TEXT CHECK (
		name IS NULL OR (
			char_length(name) BETWEEN 1 AND 200
			AND name = btrim(name)
			AND name !~ '[[:cntrl:]]'
		)
	),
	locality TEXT CHECK (
		locality IS NULL OR (
			char_length(locality) BETWEEN 1 AND 200
			AND locality = btrim(locality)
			AND locality !~ '[[:cntrl:]]'
		)
	),
	region TEXT CHECK (
		region IS NULL OR (
			char_length(region) BETWEEN 1 AND 200
			AND region = btrim(region)
			AND region !~ '[[:cntrl:]]'
		)
	),
	country_code TEXT NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
	latitude DOUBLE PRECISION CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
	longitude DOUBLE PRECISION CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
	pipeline_version TEXT NOT NULL CHECK (pipeline_version ~ '^[A-Za-z0-9._-]{1,64}$'),
	model TEXT NOT NULL CHECK (char_length(model) BETWEEN 1 AND 128),
	prompt_version TEXT NOT NULL CHECK (prompt_version ~ '^[A-Za-z0-9._-]{1,64}$'),
	max_attempts SMALLINT NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
	max_exa_calls SMALLINT NOT NULL CHECK (max_exa_calls BETWEEN 0 AND 4),
	max_llm_calls SMALLINT NOT NULL CHECK (max_llm_calls BETWEEN 0 AND 4),
	max_input_tokens INTEGER NOT NULL CHECK (max_input_tokens BETWEEN 1 AND 100000),
	max_output_tokens INTEGER NOT NULL CHECK (max_output_tokens BETWEEN 1 AND 4096),
	max_cost_micros INTEGER NOT NULL CHECK (max_cost_micros BETWEEN 1 AND 1000000),
	provider_timeout_ms INTEGER NOT NULL CHECK (provider_timeout_ms BETWEEN 100 AND 30000),
	max_response_bytes INTEGER NOT NULL CHECK (max_response_bytes BETWEEN 1024 AND 1048576),
	exa_calls_reserved SMALLINT NOT NULL DEFAULT 0 CHECK (exa_calls_reserved BETWEEN 0 AND 4),
	llm_calls_reserved SMALLINT NOT NULL DEFAULT 0 CHECK (llm_calls_reserved BETWEEN 0 AND 4),
	input_tokens_reserved INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens_reserved >= 0),
	output_tokens_reserved INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens_reserved >= 0),
	cost_micros_reserved INTEGER NOT NULL DEFAULT 0 CHECK (cost_micros_reserved >= 0),
	status TEXT NOT NULL DEFAULT 'pending' CHECK (
		status IN ('pending', 'processing', 'retry', 'succeeded', 'failed', 'dead')
	),
	attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 10),
	available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
	lease_owner TEXT CHECK (
		lease_owner IS NULL OR char_length(lease_owner) BETWEEN 1 AND 128
	),
	lease_until TIMESTAMPTZ,
	fence BIGINT NOT NULL DEFAULT 0 CHECK (fence >= 0),
	outcome_code TEXT CHECK (
		outcome_code IS NULL OR outcome_code ~ '^[A-Z][A-Z0-9_]{1,127}$'
	),
	created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
	completed_at TIMESTAMPTZ,
	CHECK (id = 'pej_' || request_hash),
	CHECK ((latitude IS NULL) = (longitude IS NULL)),
	CHECK (
		(target_type = 'candidate'
			AND candidate_id IS NOT NULL
			AND candidate_snapshot_hash IS NOT NULL
			AND candidate_source IS NOT NULL
			AND search_query IS NULL
			AND name IS NOT NULL)
		OR
		(target_type = 'search_miss'
			AND candidate_id IS NULL
			AND candidate_snapshot_hash IS NULL
			AND candidate_source IS NULL
			AND candidate_source_url IS NULL
			AND search_query IS NOT NULL
			AND name IS NULL
			AND locality IS NULL
			AND region IS NULL
			AND latitude IS NULL
			AND longitude IS NULL)
	),
	CHECK (exa_calls_reserved <= max_exa_calls),
	CHECK (llm_calls_reserved <= max_llm_calls),
	CHECK (input_tokens_reserved <= max_input_tokens),
	CHECK (output_tokens_reserved <= max_output_tokens),
	CHECK (cost_micros_reserved <= max_cost_micros),
	CHECK (attempts <= max_attempts),
	CHECK (
		(status = 'processing' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL)
		OR
		(status <> 'processing' AND lease_owner IS NULL AND lease_until IS NULL)
	),
	CHECK (
		(status = 'succeeded' AND outcome_code = 'ENRICHMENT_COMPLETED'
			AND completed_at IS NOT NULL)
		OR
		(status IN ('failed', 'dead') AND outcome_code IS NOT NULL
			AND completed_at IS NOT NULL)
		OR
		(status = 'retry' AND outcome_code IS NOT NULL AND completed_at IS NULL)
		OR
		(status IN ('pending', 'processing') AND outcome_code IS NULL
			AND completed_at IS NULL)
	)
);

CREATE INDEX place_enrichment_jobs_claim_idx
	ON place_enrichment_jobs(available_at, id)
	WHERE status IN ('pending', 'retry');

CREATE INDEX place_enrichment_jobs_lease_idx
	ON place_enrichment_jobs(lease_until, id)
	WHERE status = 'processing';

CREATE INDEX place_enrichment_jobs_candidate_idx
	ON place_enrichment_jobs(candidate_id, created_at DESC)
	WHERE candidate_id IS NOT NULL;

CREATE TABLE place_enrichment_attempts (
	job_id TEXT NOT NULL REFERENCES place_enrichment_jobs(id) ON DELETE CASCADE,
	attempt SMALLINT NOT NULL CHECK (attempt BETWEEN 1 AND 10),
	worker_id TEXT NOT NULL CHECK (char_length(worker_id) BETWEEN 1 AND 128),
	fence BIGINT NOT NULL CHECK (fence > 0),
	started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
	finished_at TIMESTAMPTZ,
	outcome_code TEXT CHECK (
		outcome_code IS NULL OR outcome_code ~ '^[A-Z][A-Z0-9_]{1,127}$'
	),
	PRIMARY KEY (job_id, attempt),
	CHECK ((finished_at IS NULL) = (outcome_code IS NULL)),
	CHECK (finished_at IS NULL OR finished_at >= started_at)
);

CREATE TABLE place_enrichment_provider_calls (
	id TEXT PRIMARY KEY CHECK (id ~ '^pec_[a-f0-9]{64}$'),
	job_id TEXT NOT NULL,
	attempt SMALLINT NOT NULL,
	sequence SMALLINT NOT NULL CHECK (sequence BETWEEN 1 AND 8),
	provider TEXT NOT NULL CHECK (provider IN ('exa', 'llm')),
	request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
	status TEXT NOT NULL DEFAULT 'reserved' CHECK (
		status IN ('reserved', 'succeeded', 'failed', 'invalid')
	),
	input_tokens_reserved INTEGER NOT NULL CHECK (input_tokens_reserved >= 0),
	output_tokens_reserved INTEGER NOT NULL CHECK (output_tokens_reserved >= 0),
	cost_micros_reserved INTEGER NOT NULL CHECK (cost_micros_reserved >= 0),
	timeout_ms INTEGER NOT NULL CHECK (timeout_ms BETWEEN 100 AND 30000),
	max_response_bytes INTEGER NOT NULL CHECK (max_response_bytes BETWEEN 1024 AND 1048576),
	response_bytes INTEGER CHECK (response_bytes IS NULL OR response_bytes >= 0),
	input_tokens_actual INTEGER CHECK (input_tokens_actual IS NULL OR input_tokens_actual >= 0),
	output_tokens_actual INTEGER CHECK (output_tokens_actual IS NULL OR output_tokens_actual >= 0),
	cost_micros_actual INTEGER CHECK (cost_micros_actual IS NULL OR cost_micros_actual >= 0),
	provider_request_id_hash TEXT CHECK (
		provider_request_id_hash IS NULL OR provider_request_id_hash ~ '^[a-f0-9]{64}$'
	),
	outcome_code TEXT CHECK (
		outcome_code IS NULL OR outcome_code ~ '^[A-Z][A-Z0-9_]{1,127}$'
	),
	started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
	completed_at TIMESTAMPTZ,
	FOREIGN KEY (job_id, attempt)
		REFERENCES place_enrichment_attempts(job_id, attempt) ON DELETE CASCADE,
	UNIQUE (job_id, attempt, sequence),
	CHECK (
		(status = 'reserved' AND completed_at IS NULL AND outcome_code IS NULL)
		OR
		(status <> 'reserved' AND completed_at IS NOT NULL AND outcome_code IS NOT NULL)
	),
	CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE TABLE place_enrichment_fields (
	job_id TEXT NOT NULL REFERENCES place_enrichment_jobs(id) ON DELETE CASCADE,
	field_name TEXT NOT NULL CHECK (
		field_name IN (
			'name', 'locality', 'region', 'countryCode', 'latitude', 'longitude',
			'address', 'websiteUrl', 'summary'
		)
	),
	value_text TEXT NOT NULL CHECK (
		char_length(value_text) BETWEEN 1 AND 2000
		AND value_text = btrim(value_text)
		AND value_text !~ '[[:cntrl:]]'
	),
	source_kind TEXT NOT NULL CHECK (source_kind IN ('candidate', 'exa_llm')),
	source_url TEXT CHECK (
		source_url IS NULL OR (
			char_length(source_url) BETWEEN 1 AND 2048
			AND source_url ~ '^https?://'
		)
	),
	observed_at TIMESTAMPTZ NOT NULL,
	model TEXT CHECK (model IS NULL OR char_length(model) BETWEEN 1 AND 128),
	prompt_version TEXT CHECK (
		prompt_version IS NULL OR prompt_version ~ '^[A-Za-z0-9._-]{1,64}$'
	),
	validator_version TEXT NOT NULL CHECK (
		validator_version ~ '^[A-Za-z0-9._-]{1,64}$'
	),
	validation_state TEXT NOT NULL CHECK (validation_state IN ('passed', 'failed')),
	approval_state TEXT NOT NULL CHECK (
		approval_state IN ('auto_approved', 'pending_review', 'human_approved', 'rejected')
	),
	attempt SMALLINT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
	PRIMARY KEY (job_id, field_name),
	FOREIGN KEY (job_id, attempt)
		REFERENCES place_enrichment_attempts(job_id, attempt),
	CHECK (
		(source_kind = 'candidate' AND model IS NULL AND prompt_version IS NULL)
		OR
		(source_kind = 'exa_llm' AND source_url IS NOT NULL
			AND model IS NOT NULL AND prompt_version IS NOT NULL)
	),
	CHECK (field_name <> 'countryCode' OR value_text ~ '^[A-Z]{2}$'),
	CHECK (field_name <> 'websiteUrl' OR value_text ~ '^https://')
);
