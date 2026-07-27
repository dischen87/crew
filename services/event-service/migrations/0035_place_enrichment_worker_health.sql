CREATE TABLE place_enrichment_worker_health (
	singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
	worker_id TEXT NOT NULL CHECK (char_length(worker_id) BETWEEN 1 AND 128),
	healthy_until TIMESTAMPTZ NOT NULL,
	updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
	CHECK (healthy_until > updated_at)
);
