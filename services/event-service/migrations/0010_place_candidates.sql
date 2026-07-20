CREATE TABLE place_candidates (
	id TEXT PRIMARY KEY CHECK (id ~ '^pcd_[a-f0-9]{64}$'),
	source TEXT NOT NULL CHECK (
		source ~ '^[a-z][a-z0-9._-]{0,63}$'
	),
	source_record_id TEXT NOT NULL CHECK (
		char_length(source_record_id) BETWEEN 1 AND 512
		AND source_record_id = btrim(source_record_id)
		AND source_record_id !~ '[[:cntrl:]]'
	),
	kind TEXT NOT NULL CHECK (kind IN ('golf_course', 'venue')),
	name TEXT NOT NULL CHECK (
		char_length(name) BETWEEN 1 AND 200 AND name = btrim(name)
	),
	locality TEXT CHECK (
		locality IS NULL OR (
			char_length(locality) BETWEEN 1 AND 200 AND locality = btrim(locality)
		)
	),
	region TEXT CHECK (
		region IS NULL OR (
			char_length(region) BETWEEN 1 AND 200 AND region = btrim(region)
		)
	),
	country_code TEXT NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
	latitude DOUBLE PRECISION CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
	longitude DOUBLE PRECISION CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
	source_record_url TEXT CHECK (
		source_record_url IS NULL OR char_length(source_record_url) BETWEEN 1 AND 2048
	),
	license_code TEXT NOT NULL CHECK (
		char_length(license_code) BETWEEN 1 AND 128 AND license_code = btrim(license_code)
	),
	license_url TEXT CHECK (
		license_url IS NULL OR char_length(license_url) BETWEEN 1 AND 2048
	),
	attribution TEXT NOT NULL CHECK (
		char_length(attribution) BETWEEN 1 AND 500 AND attribution = btrim(attribution)
	),
	search_index_allowed BOOLEAN NOT NULL,
	retrieved_at TIMESTAMPTZ NOT NULL,
	confidence DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
	expires_at TIMESTAMPTZ,
	retired_at TIMESTAMPTZ,
	retirement_reason TEXT CHECK (
		retirement_reason IS NULL OR retirement_reason IN (
			'source_removed', 'license_revoked', 'invalid_record', 'superseded'
		)
	),
	snapshot_hash TEXT NOT NULL CHECK (snapshot_hash ~ '^[a-f0-9]{64}$'),
	version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
	created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
	UNIQUE (source, source_record_id),
	CHECK ((latitude IS NULL) = (longitude IS NULL)),
	CHECK (expires_at IS NULL OR expires_at > retrieved_at),
	CHECK ((retired_at IS NULL) = (retirement_reason IS NULL)),
	CHECK (retired_at IS NULL OR retired_at <= retrieved_at)
);

CREATE INDEX place_candidates_active_feed_idx
	ON place_candidates(id)
	WHERE retired_at IS NULL AND search_index_allowed;
